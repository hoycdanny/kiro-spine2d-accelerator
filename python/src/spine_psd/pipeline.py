"""The PSD to Spine pipeline, as one callable step.

Separated from the CLI so it can be tested directly, and from the parser so
it can be tested with synthetic parts instead of real PSD files.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .atlas_packer import compose_page, write_atlas_text
from .loose_images import LOOSE_IMAGES_DIR_NAME, images_path_for, write_loose_images
from .psd_parser import PsdDocument, parse_psd
from .rig_builder import build_rig
from .validator import validate_skeleton
from .writer import build_skeleton_json, dump_skeleton_json


@dataclass
class PipelineResult:
    skeleton_path: str
    atlas_path: str
    page_paths: list[str]
    bone_count: int
    slot_count: int
    attachment_count: int
    region_names: list[str]
    virtual_bones: list[str]
    unmapped_layers: list[str]
    warnings: list[str] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)
    skeleton: dict[str, Any] | None = None
    #: Folder holding the loose per-attachment PNGs the editor imports.
    #: Empty when emit_loose_images is off.
    images_dir: str = ""
    image_paths: list[str] = field(default_factory=list)
    stale_images_removed: list[str] = field(default_factory=list)


def run_pipeline(
    psd_path: str | Path,
    out_dir: str | Path,
    name: str | None = None,
    padding: int = 2,
    max_size: int = 4096,
    premultiplied_alpha: bool = False,
    emit_loose_images: bool = True,
    document: PsdDocument | None = None,
) -> PipelineResult:
    """Convert a PSD into skeleton JSON, an atlas and a page image.

    With `emit_loose_images` on (the default) the per-attachment PNGs the
    Spine editor's `File -> Import Data` resolves are written next to the
    JSON. Turning it off leaves only the atlas path working.

    `document` is an injection point for tests, which supply synthetic parts
    instead of a real PSD.
    """
    psd_path = Path(psd_path)
    out_dir = Path(out_dir)
    base_name = name or psd_path.stem or "skeleton"

    parsed = document if document is not None else parse_psd(psd_path)
    rig = build_rig(parsed)

    if not rig.bones:
        return PipelineResult(
            skeleton_path="",
            atlas_path="",
            page_paths=[],
            bone_count=0,
            slot_count=0,
            attachment_count=0,
            region_names=[],
            virtual_bones=[],
            unmapped_layers=rig.unmapped,
            warnings=rig.warnings,
            problems=[
                "No layer name matched a known body part, so no rig could be built."
            ],
        )

    images: dict[str, Any] = {}
    sizes: list[tuple[str, int, int]] = []
    for part in parsed.parts:
        if part.is_pivot_marker or part.bone is None or part.image is None:
            continue
        if part.bone in images:
            continue
        images[part.bone] = part.image
        sizes.append((part.bone, part.width, part.height))

    page_name = f"{base_name}.png"
    atlas = compose_page(
        page_name,
        images,
        sizes,
        padding=padding,
        max_size=max_size,
    )
    atlas_text = write_atlas_text(atlas, premultiplied_alpha=premultiplied_alpha)
    region_names = [region.name for region in atlas.regions]

    skeleton = build_skeleton_json(
        rig,
        base_name,
        images_path=images_path_for(LOOSE_IMAGES_DIR_NAME),
    )
    problems = validate_skeleton(skeleton, region_names)

    out_dir.mkdir(parents=True, exist_ok=True)
    skeleton_path = out_dir / f"{base_name}.json"
    atlas_path = out_dir / f"{base_name}.atlas"
    page_path = out_dir / page_name

    skeleton_path.write_text(dump_skeleton_json(skeleton), encoding="utf-8")
    atlas_path.write_text(atlas_text, encoding="utf-8")
    if atlas.image is not None:
        atlas.image.save(page_path)

    extra_warnings: list[str] = []
    loose_dir = ""
    loose_paths: list[str] = []
    loose_removed: list[str] = []
    if emit_loose_images:
        loose = write_loose_images(out_dir, images)
        loose_dir = loose.dir
        loose_paths = loose.paths
        loose_removed = loose.removed
    else:
        extra_warnings.append(
            "Loose per-attachment images were not written, so the Spine editor's "
            "File -> Import Data will not resolve attachments; the atlas path "
            "(runtime/preview) is unaffected."
        )

    return PipelineResult(
        skeleton_path=str(skeleton_path),
        atlas_path=str(atlas_path),
        page_paths=[str(page_path)],
        bone_count=len(rig.bones),
        slot_count=len(rig.attachments),
        attachment_count=len(rig.attachments),
        region_names=region_names,
        virtual_bones=[bone.name for bone in rig.bones if bone.virtual],
        unmapped_layers=rig.unmapped,
        warnings=rig.warnings
        + [f"{name}: {reason}" for name, reason in parsed.skipped]
        + extra_warnings,
        problems=problems,
        skeleton=skeleton,
        images_dir=loose_dir,
        image_paths=loose_paths,
        stale_images_removed=loose_removed,
    )
