"""Write the loose per-attachment PNGs the Spine editor imports.

The trap this module exists for: the editor's `File -> Import Data` resolves
every attachment as `<skeleton.images>/<attachmentName>.png` relative to the
skeleton JSON and never reads the `.atlas`. An export that ships only the
packed page imports as an empty canvas. These files are what make editor
import work; the atlas stays the runtime and preview path.

The files are the unpacked per-part images, not crops of the packed page: the
page has padding applied, and each part image is already the exact untrimmed
region the attachment geometry was derived from.

Ownership rule: this module only ever deletes PNGs it could have written
itself. Attachment names come from one source — `psd_parser.classify_layer`
runs every layer through `conventions.canonical_bone`, so `part.bone`, the
slot, the attachment and the atlas region all carry a `conventions`
bone name — which makes that closed set the tool's whole namespace. A PNG in
the folder with any other stem belongs to somebody else: it is reported and
left in place, never removed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .conventions import BONE_BY_NAME

#: Every stem this tool can write: the canonical bone names. Layer-name
#: aliases are not included — an alias is resolved to its canonical bone
#: before anything is written, so `body.png` is a file the tool never
#: produced and therefore never deletes.
OWN_IMAGE_STEMS: frozenset[str] = frozenset(BONE_BY_NAME)

#: The folder name written next to the skeleton JSON. Single source of truth:
#: `writer.build_skeleton_json` takes its `images_path` default from here, so
#: the JSON field and the folder on disk cannot drift.
LOOSE_IMAGES_DIR_NAME = "images"


def images_path_for(dir_name: str) -> str:
    """The `skeleton.images` value for a folder sitting next to the JSON."""
    return f"./{dir_name}/"


#: What `skeleton.images` must say for the default folder name.
DEFAULT_IMAGES_PATH = images_path_for(LOOSE_IMAGES_DIR_NAME)


@dataclass
class LooseImages:
    #: Absolute path of the folder the images were written to.
    dir: str = ""
    #: Absolute paths of the written `<attachment>.png` files.
    paths: list[str] = field(default_factory=list)
    #: File names of the stale own-namespace PNGs pruned from the folder.
    removed: list[str] = field(default_factory=list)
    #: File names of the PNGs found in the folder that this tool does not own
    #: and therefore left untouched.
    kept: list[str] = field(default_factory=list)


def _is_same_file(left: Path, right: Path) -> bool:
    """Whether two entries are one file, as `HEAD.PNG` and `head.png` are on a
    case-insensitive filesystem."""
    try:
        return left.samefile(right)
    except OSError:
        return False


def write_loose_images(
    out_dir: str | Path,
    images: dict[str, Any],
    dir_name: str = LOOSE_IMAGES_DIR_NAME,
) -> LooseImages:
    """Write one `<attachment>.png` per image into `out_dir / dir_name`.

    Matching names are overwritten. The editor resolves attachment names
    against this folder, so a leftover from a previous run would be silently
    picked up: every other top-level `*.png` is therefore accounted for. Those
    whose stem is a canonical bone name — a file this tool wrote on an earlier
    run — are deleted and reported in `removed`. Anything else is somebody's
    own artwork: it is reported in `kept` and left exactly where it is.
    Non-PNG files and subdirectories are untouched, and the scan never
    recurses.
    """
    from PIL import Image  # noqa: F401 - lazy, as in atlas_packer.compose_page

    out_root = Path(out_dir).resolve()
    target = (out_root / dir_name).resolve()
    if out_root not in target.parents:
        raise ValueError(
            f"The loose images folder {target} is outside the output directory "
            f"{out_root}; pass a folder name, not a path that escapes it."
        )

    target.mkdir(parents=True, exist_ok=True)

    paths: list[str] = []
    written: set[str] = set()
    written_paths: list[Path] = []
    for name in sorted(images):
        image = images[name]
        if image is None:
            continue
        file_name = f"{name}.png"
        rgba = image.convert("RGBA") if image.mode != "RGBA" else image
        rgba.save(target / file_name)
        written.add(file_name)
        written_paths.append(target / file_name)
        paths.append(str(target / file_name))

    removed: list[str] = []
    kept: list[str] = []
    for existing in sorted(target.iterdir()):
        if not existing.is_file():
            continue
        if existing.suffix.lower() != ".png":
            continue
        if existing.name in written:
            continue
        if any(_is_same_file(existing, path) for path in written_paths):
            # A case-insensitive filesystem kept an older entry name for a
            # file we just overwrote (`HEAD.PNG` for `head.png`). Unlinking it
            # would delete the attachment image written moments ago, which is
            # the blank-canvas bug this module exists to fix.
            continue
        if existing.stem.lower() not in OWN_IMAGE_STEMS:
            # Not a name this tool can produce, so it is not ours to delete.
            # Reporting it is what keeps a stale file from being silent.
            kept.append(existing.name)
            continue
        existing.unlink()
        removed.append(existing.name)

    return LooseImages(dir=str(target), paths=paths, removed=removed, kept=kept)
