"""Write the loose per-attachment PNGs the Spine editor imports.

The trap this module exists for: the editor's `File -> Import Data` resolves
every attachment as `<skeleton.images>/<attachmentName>.png` relative to the
skeleton JSON and never reads the `.atlas`. An export that ships only the
packed page imports as an empty canvas. These files are what make editor
import work; the atlas stays the runtime and preview path.

The files are the unpacked per-part images, not crops of the packed page: the
page has padding applied, and each part image is already the exact untrimmed
region the attachment geometry was derived from.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

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
    #: File names of the stale PNGs pruned from the folder.
    removed: list[str] = field(default_factory=list)


def write_loose_images(
    out_dir: str | Path,
    images: dict[str, Any],
    dir_name: str = LOOSE_IMAGES_DIR_NAME,
) -> LooseImages:
    """Write one `<attachment>.png` per image into `out_dir / dir_name`.

    Matching names are overwritten. Any other `*.png` sitting directly in the
    folder is deleted and reported, because the editor resolves attachment
    names against this folder and a leftover from a previous run is exactly
    what it would silently pick up. Non-PNG files and subdirectories are left
    alone, and the scan never recurses.
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
    for name in sorted(images):
        image = images[name]
        if image is None:
            continue
        file_name = f"{name}.png"
        rgba = image.convert("RGBA") if image.mode != "RGBA" else image
        rgba.save(target / file_name)
        written.add(file_name)
        paths.append(str(target / file_name))

    removed: list[str] = []
    for existing in sorted(target.iterdir()):
        if not existing.is_file():
            continue
        if existing.suffix.lower() != ".png":
            continue
        if existing.name in written:
            continue
        existing.unlink()
        removed.append(existing.name)

    return LooseImages(dir=str(target), paths=paths, removed=removed)
