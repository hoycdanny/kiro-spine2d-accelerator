"""Pack part images into an atlas page and write the atlas text.

The output follows the 4.0+ atlas format (`bounds` / `offsets`), which is
what the 4.2 runtimes read. Whitespace is not stripped: the rig maths above
is expressed in terms of each layer's full bounds, and stripping would
require re-deriving every attachment offset for no benefit here.

Packing uses rectpack's MaxRects heuristic with a growing page size, so the
page is a power of two large enough to hold everything.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class PackedRegion:
    name: str
    x: int
    y: int
    width: int
    height: int


@dataclass
class PackedAtlas:
    page_name: str
    width: int
    height: int
    regions: list[PackedRegion]
    #: The composed RGBA page image.
    image: Any = None


def next_power_of_two(value: int) -> int:
    size = 1
    while size < value:
        size *= 2
    return size


def pack_regions(
    sizes: list[tuple[str, int, int]],
    padding: int = 2,
    max_size: int = 4096,
) -> tuple[int, int, list[PackedRegion]]:
    """Pack named sizes onto one page.

    Returns the page size and the placed regions. Raises ValueError when the
    images cannot fit within `max_size`.
    """
    from rectpack import newPacker

    if not sizes:
        return (1, 1, [])

    needed_area = sum((w + padding) * (h + padding) for _, w, h in sizes)
    widest = max(w + padding for _, w, h in sizes)
    tallest = max(h + padding for _, w, h in sizes)

    size = next_power_of_two(max(int(needed_area**0.5) + 1, widest, tallest))

    while size <= max_size:
        packer = newPacker(rotation=False)
        for name, width, height in sizes:
            packer.add_rect(width + padding, height + padding, name)
        packer.add_bin(size, size)
        packer.pack()

        placed = packer.rect_list()
        if len(placed) == len(sizes):
            regions = [
                PackedRegion(
                    name=str(rid),
                    x=x + padding // 2,
                    y=y + padding // 2,
                    width=w - padding,
                    height=h - padding,
                )
                for _, x, y, w, h, rid in placed
            ]
            regions.sort(key=lambda region: region.name)
            return (size, size, regions)

        size *= 2

    raise ValueError(
        f"Images do not fit on a single {max_size}x{max_size} page; "
        "reduce the artwork size or raise max_size."
    )


def compose_page(
    page_name: str,
    images: dict[str, Any],
    sizes: list[tuple[str, int, int]],
    padding: int = 2,
    max_size: int = 4096,
) -> PackedAtlas:
    """Pack the images and paste them onto a single RGBA page."""
    from PIL import Image

    width, height, regions = pack_regions(sizes, padding=padding, max_size=max_size)
    page = Image.new("RGBA", (width, height), (0, 0, 0, 0))

    for region in regions:
        image = images.get(region.name)
        if image is None:
            continue
        rgba = image.convert("RGBA") if image.mode != "RGBA" else image
        page.paste(rgba, (region.x, region.y))

    return PackedAtlas(
        page_name=page_name,
        width=width,
        height=height,
        regions=regions,
        image=page,
    )


def write_atlas_text(atlas: PackedAtlas, premultiplied_alpha: bool = False) -> str:
    """Render the atlas as 4.0+ format text."""
    lines = [
        atlas.page_name,
        f"size: {atlas.width}, {atlas.height}",
        "format: RGBA8888",
        "filter: Linear, Linear",
        "repeat: none",
        f"pma: {'true' if premultiplied_alpha else 'false'}",
    ]

    for region in atlas.regions:
        lines.append(region.name)
        lines.append(f"bounds: {region.x}, {region.y}, {region.width}, {region.height}")

    lines.append("")
    return "\n".join(lines)
