"""Compose the labelled documentation images in ``docs/images/``.

Called by ``docs/make-doc-images.mjs``, which produces the raw frames by
running the demo and the server's own tools. This file only arranges those
frames onto light cards and writes the labels, so that

  * a transparent render stays visible on GitHub's dark theme, which a bare
    RGBA frame does not, and
  * the reader can tell which panel is which without reading the caption.

Every pixel it consumes comes from this repository: the procedurally drawn
sample PSD (``demo/make-sample-psd.py``) or output rendered from it. Nothing
here reads Spine's example artwork.

Usage, one subcommand per image shape:

    psd-flat --psd P --out O [--height N]
    strip    --out O [--height N] [--trim] --panel PATH LABEL [--panel PATH LABEL ...]
    grid     --out O --dir D [--cell N] [--cols N]
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from psd_tools import PSDImage

#: Card and text colours, chosen to read on both GitHub themes.
PAGE_BG = (246, 247, 249, 255)
IMAGE_BG = (252, 252, 253, 255)
BORDER = (210, 214, 220, 255)
TEXT = (36, 41, 47, 255)

PAD = 12
INNER = 8
GAP = 12
LABEL_H = 22
FONT_SIZE = 13


def _font(size: int = FONT_SIZE) -> ImageFont.FreeTypeFont:
    """The bundled scalable default font, so no system font is required."""
    return ImageFont.load_default(size=size)


def _scaled_to_height(image: Image.Image, height: int) -> Image.Image:
    if image.height == height:
        return image
    width = max(1, round(image.width * height / image.height))
    return image.resize((width, height), Image.Resampling.LANCZOS)


def _trimmed(image: Image.Image, margin: int = 2) -> Image.Image:
    """Crop transparent padding, keeping a small margin."""
    box = image.getbbox()
    if box is None:
        return image
    left, top, right, bottom = box
    return image.crop(
        (
            max(0, left - margin),
            max(0, top - margin),
            min(image.width, right + margin),
            min(image.height, bottom + margin),
        )
    )


def _label(canvas: Image.Image, text: str, left: int, top: int, width: int) -> None:
    """Centre one label line in a strip `width` wide starting at `left`."""
    draw = ImageDraw.Draw(canvas)
    font = _font()
    text_width = draw.textlength(text, font=font)
    draw.text(
        (left + (width - text_width) / 2, top + 3),
        text,
        font=font,
        fill=TEXT,
    )


def _card(canvas: Image.Image, box: tuple[int, int, int, int]) -> None:
    draw = ImageDraw.Draw(canvas)
    draw.rectangle(box, fill=IMAGE_BG, outline=BORDER, width=1)


def psd_flat(psd_path: Path, out: Path, height: int) -> None:
    """Flatten the sample PSD the way a painting application would show it."""
    composite = PSDImage.open(psd_path).composite()
    flat = _scaled_to_height(_trimmed(composite.convert("RGBA")), height)
    out.parent.mkdir(parents=True, exist_ok=True)
    flat.save(out)


def strip(
    panels: list[tuple[Path, str]], out: Path, height: int, trim: bool = False
) -> None:
    """One row of labelled cards, all images scaled to the same height.

    `trim` crops each panel to its own art before scaling, which is right
    when the panels show different things at different canvas sizes and
    wrong when they are frames of one animation — cropping those per frame
    would cancel out the movement the strip exists to show.
    """
    loaded = [Image.open(path).convert("RGBA") for path, _ in panels]
    images = [
        _scaled_to_height(_trimmed(image) if trim else image, height)
        for image in loaded
    ]
    cell_w = max(image.width for image in images)
    panel_w = cell_w + 2 * INNER
    panel_h = height + 2 * INNER + LABEL_H

    canvas = Image.new(
        "RGBA",
        (
            PAD * 2 + panel_w * len(images) + GAP * (len(images) - 1),
            PAD * 2 + panel_h,
        ),
        PAGE_BG,
    )

    for index, (image, (_, label)) in enumerate(zip(images, panels)):
        left = PAD + index * (panel_w + GAP)
        _card(canvas, (left, PAD, left + panel_w - 1, PAD + height + 2 * INNER - 1))
        canvas.alpha_composite(
            image,
            (left + INNER + (cell_w - image.width) // 2, PAD + INNER),
        )
        _label(canvas, label, left, PAD + height + 2 * INNER, panel_w)

    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out)


def grid(directory: Path, out: Path, cell: int, cols: int) -> None:
    """Every PNG in `directory`, at one shared scale, each under its name.

    One shared scale rather than fit-per-cell: these are the loose
    per-attachment images, and their relative sizes are information — a head
    really is four times a foot.
    """
    paths = sorted(directory.glob("*.png"))
    if not paths:
        raise SystemExit(f"no PNGs in {directory}")

    images = [Image.open(path).convert("RGBA") for path in paths]
    largest = max(max(image.width, image.height) for image in images)
    factor = cell / largest
    scaled = [
        image.resize(
            (max(1, round(image.width * factor)), max(1, round(image.height * factor))),
            Image.Resampling.LANCZOS,
        )
        for image in images
    ]

    panel_w = cell + 2 * INNER
    panel_h = cell + 2 * INNER + LABEL_H
    rows = (len(scaled) + cols - 1) // cols

    canvas = Image.new(
        "RGBA",
        (
            PAD * 2 + panel_w * cols + GAP * (cols - 1),
            PAD * 2 + panel_h * rows + GAP * (rows - 1),
        ),
        PAGE_BG,
    )

    for index, (image, path) in enumerate(zip(scaled, paths)):
        left = PAD + (index % cols) * (panel_w + GAP)
        top = PAD + (index // cols) * (panel_h + GAP)
        _card(canvas, (left, top, left + panel_w - 1, top + cell + 2 * INNER - 1))
        canvas.alpha_composite(
            image,
            (
                left + INNER + (cell - image.width) // 2,
                top + INNER + (cell - image.height) // 2,
            ),
        )
        _label(canvas, path.name, left, top + cell + 2 * INNER, panel_w)

    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)

    flat = subcommands.add_parser("psd-flat")
    flat.add_argument("--psd", type=Path, required=True)
    flat.add_argument("--out", type=Path, required=True)
    flat.add_argument("--height", type=int, default=240)

    row = subcommands.add_parser("strip")
    row.add_argument("--out", type=Path, required=True)
    row.add_argument("--height", type=int, default=240)
    row.add_argument("--trim", action="store_true")
    row.add_argument(
        "--panel",
        nargs=2,
        action="append",
        metavar=("PATH", "LABEL"),
        required=True,
    )

    sheet = subcommands.add_parser("grid")
    sheet.add_argument("--out", type=Path, required=True)
    sheet.add_argument("--dir", type=Path, required=True)
    sheet.add_argument("--cell", type=int, default=104)
    sheet.add_argument("--cols", type=int, default=4)

    args = parser.parse_args()

    if args.command == "psd-flat":
        psd_flat(args.psd, args.out, args.height)
    elif args.command == "strip":
        strip(
            [(Path(path), label) for path, label in args.panel],
            args.out,
            args.height,
            args.trim,
        )
    else:
        grid(args.dir, args.out, args.cell, args.cols)

    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
