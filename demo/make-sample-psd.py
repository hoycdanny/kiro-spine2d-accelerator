"""Generate the demo's sample PSD.

The PSD is built here rather than committed so the repository carries no
binary art assets, and so the demo exercises the real PSD reader. Every
pixel below is drawn by Pillow's ImageDraw from the coordinates in this
file: no external image, no traced reference, nothing copied from any Spine
example. It is a stand-in character, not art direction — what it has to do
is survive `File -> Import Data` in the Spine editor and show the rigging
rules on something that reads as a body.

Layer names deliberately cover three cases the Power handles differently:
  * recognised parts (head, chest, arm_left, forearm_left, thigh_right, ...)
  * an alias (`body` resolves to the `torso` bone)
  * an unrecognised layer (`cape`), which is reported rather than guessed at

Two geometry rules the rest of the pipeline depends on, and why the numbers
here look fussy:

  * ``python/src/spine_psd/psd_parser.py`` takes each layer's bounds as the
    part bounds, and ``rig_builder.py`` pivots a bone at the joint edge of
    those bounds — the top edge for a limb, the bottom edge for the spine
    chain. Transparent padding would therefore drag the pivot off the art,
    so each part is drawn on its own document-sized canvas and then cropped
    to ``getbbox()`` with the crop offset folded into ``top``/``left``.
  * A pivot is the *centre* of the joint edge, so every part is kept
    horizontally symmetric about its own joint, and neighbouring parts
    overlap across it. A gap at a joint shows up as a torn limb the moment
    anything rotates.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter
from psd_tools import PSDImage
from psd_tools.api.layers import PixelLayer

#: Document size, in pixels. The character occupies x 44..196, y 36..404.
DOC_SIZE = (240, 440)

#: Everything is drawn at this multiple and scaled back down, because
#: ImageDraw does not antialias. Flat-looking edges were half of why the old
#: sample art looked like a test fixture.
SUPERSAMPLE = 4

#: Line weight of a part's outline, in document pixels.
OUTLINE_PX = 2

#: How much darker an outline is than the fill it encloses.
OUTLINE_DARKEN = 0.42

# --- palette -------------------------------------------------------------
# One named constant per material, so a colour change is one edit.

SKIN = (236, 198, 160, 255)
HAIR = (74, 50, 42, 255)
TUNIC = (198, 74, 68, 255)
TUNIC_LOW = (176, 62, 58, 255)
SLEEVE = (82, 148, 112, 255)
BELT = (96, 74, 58, 255)
TROUSER = (62, 78, 152, 255)
BOOT = (92, 64, 46, 255)
CAPE = (104, 62, 142, 255)
EYE_WHITE = (250, 250, 252, 255)
PUPIL = (44, 38, 54, 255)
MOUTH = (150, 72, 66, 255)

#: The single shading band every part gets, soft and cool, as if the light
#: came from the upper left.
SHADE = (24, 18, 40, 120)

TRANSPARENT = (0, 0, 0, 0)


def darken(rgba: tuple[int, int, int, int], amount: float) -> tuple[int, int, int, int]:
    """A darker version of a colour, keeping its alpha."""
    red, green, blue, alpha = rgba
    keep = 1.0 - amount
    return (int(red * keep), int(green * keep), int(blue * keep), alpha)


@dataclass(frozen=True)
class Shape:
    """One primitive in document coordinates."""

    kind: str
    geom: tuple
    fill: tuple[int, int, int, int] | None = None
    stroke: tuple[int, int, int, int] | None = None
    outline: bool = True
    width: int = OUTLINE_PX
    #: Start and end angle, for arcs only.
    sweep: tuple[float, float] | None = None


def poly(points: tuple, fill: tuple[int, int, int, int], *, outline: bool = True) -> Shape:
    return Shape("polygon", tuple(points), fill=fill, outline=outline)


def ell(box: tuple, fill: tuple[int, int, int, int], *, outline: bool = True, width: int = OUTLINE_PX) -> Shape:
    return Shape("ellipse", box, fill=fill, outline=outline, width=width)


def stroke(points: tuple, colour: tuple[int, int, int, int], width: int = OUTLINE_PX) -> Shape:
    return Shape("line", tuple(points), stroke=colour, width=width)


def arc(box: tuple, start: float, end: float, colour: tuple[int, int, int, int], width: int = OUTLINE_PX) -> Shape:
    return Shape("arc", box, stroke=colour, width=width, sweep=(start, end))


@dataclass(frozen=True)
class Part:
    """A PSD layer: silhouette shapes, then details drawn over the shading."""

    #: Shapes that form the silhouette; the shading band is clipped to them.
    shapes: tuple[Shape, ...]
    #: Shapes drawn after the shading, so faces and seams stay crisp.
    details: tuple[Shape, ...] = field(default_factory=tuple)
    #: Fraction of the part's width at which the shading band starts.
    shade_bias: float = 0.58


# --- the character, in document space ------------------------------------
# Joint seams, so a change here can be checked against its neighbour:
#   neck   y=134   head bottom over chest top (128)
#   waist  y=176   torso top inside chest (..182)
#   hips   y=222   hip top inside torso (..228)
#   knees  y=316   shin top inside thigh (..322)
#   ankles y=378   foot top inside shin (..384)
#   shldrs y=134   arm top inside chest (128..)
#   elbows y=194   forearm top inside arm (..200)
#   wrists y=248   hand top inside forearm (..252)

PARTS: dict[str, Part] = {
    "cape": Part(
        shapes=(
            poly(
                (
                    (62, 128),
                    (178, 128),
                    (196, 300),
                    (158, 330),
                    (120, 318),
                    (82, 330),
                    (44, 300),
                ),
                CAPE,
            ),
        ),
        details=(
            stroke(((120, 138), (120, 312)), darken(CAPE, 0.3)),
            stroke(((80, 150), (92, 300)), darken(CAPE, 0.22)),
            stroke(((160, 150), (148, 300)), darken(CAPE, 0.22)),
        ),
        shade_bias=0.52,
    ),
    "hip": Part(
        shapes=(ell((82, 222, 158, 266), BELT),),
        details=(
            stroke(((86, 236), (154, 236)), darken(BELT, 0.3)),
            ell((112, 230, 128, 244), (182, 148, 74, 255), width=1),
        ),
    ),
    "thigh_left": Part(
        shapes=(poly(((86, 252), (114, 252), (110, 322), (90, 322)), TROUSER),),
    ),
    "thigh_right": Part(
        shapes=(poly(((154, 252), (126, 252), (130, 322), (150, 322)), TROUSER),),
    ),
    "shin_left": Part(
        shapes=(poly(((89, 316), (111, 316), (108, 384), (92, 384)), TROUSER),),
    ),
    "shin_right": Part(
        shapes=(poly(((151, 316), (129, 316), (132, 384), (148, 384)), TROUSER),),
    ),
    "foot_left": Part(
        shapes=(
            poly(
                ((86, 378), (114, 378), (118, 396), (112, 404), (88, 404), (82, 396)),
                BOOT,
            ),
        ),
        details=(stroke(((84, 398), (116, 398)), darken(BOOT, 0.35)),),
    ),
    "foot_right": Part(
        shapes=(
            poly(
                ((154, 378), (126, 378), (122, 396), (128, 404), (152, 404), (158, 396)),
                BOOT,
            ),
        ),
        details=(stroke(((124, 398), (156, 398)), darken(BOOT, 0.35)),),
    ),
    # `body` is the alias case: the rig resolves it to the `torso` bone.
    "body": Part(
        shapes=(
            poly(
                ((84, 176), (156, 176), (152, 206), (148, 228), (92, 228), (88, 206)),
                TUNIC_LOW,
            ),
        ),
        details=(stroke(((92, 220), (148, 220)), darken(TUNIC_LOW, 0.3)),),
    ),
    "chest": Part(
        shapes=(
            poly(
                (
                    (78, 142),
                    (88, 128),
                    (152, 128),
                    (162, 142),
                    (166, 170),
                    (158, 182),
                    (82, 182),
                    (74, 170),
                ),
                TUNIC,
            ),
        ),
        details=(
            poly(((106, 128), (134, 128), (120, 152)), darken(TUNIC, 0.28)),
            stroke(((106, 128), (120, 152), (134, 128)), darken(TUNIC, 0.45)),
        ),
    ),
    "arm_left": Part(
        shapes=(poly(((60, 136), (84, 134), (82, 198), (64, 200)), SLEEVE),),
        details=(stroke(((64, 192), (81, 190)), darken(SLEEVE, 0.32)),),
    ),
    "arm_right": Part(
        shapes=(poly(((180, 136), (156, 134), (158, 198), (176, 200)), SLEEVE),),
        details=(stroke(((176, 192), (159, 190)), darken(SLEEVE, 0.32)),),
    ),
    "forearm_left": Part(
        shapes=(poly(((57, 194), (79, 196), (76, 252), (60, 250)), SKIN),),
    ),
    "forearm_right": Part(
        shapes=(poly(((183, 194), (161, 196), (164, 252), (180, 250)), SKIN),),
    ),
    "hand_left": Part(
        shapes=(ell((55, 248, 81, 278), SKIN),),
        details=(
            stroke(((62, 272), (62, 262)), darken(SKIN, 0.42), 1),
            stroke(((68, 274), (68, 262)), darken(SKIN, 0.42), 1),
            stroke(((74, 272), (74, 262)), darken(SKIN, 0.42), 1),
        ),
    ),
    "hand_right": Part(
        shapes=(ell((159, 248, 185, 278), SKIN),),
        details=(
            stroke(((166, 272), (166, 262)), darken(SKIN, 0.42), 1),
            stroke(((172, 274), (172, 262)), darken(SKIN, 0.42), 1),
            stroke(((178, 272), (178, 262)), darken(SKIN, 0.42), 1),
        ),
    ),
    "head": Part(
        shapes=(
            # Neck stub first: it puts the head's bottom edge — and therefore
            # the neck pivot — at the base of the neck, not at the chin.
            poly(((108, 112), (132, 112), (132, 134), (108, 134)), SKIN),
            ell((82, 42, 158, 126), SKIN),
            poly(
                (
                    (72, 98),
                    (70, 74),
                    (80, 52),
                    (100, 40),
                    (120, 36),
                    (140, 40),
                    (160, 52),
                    (170, 74),
                    (168, 98),
                    (158, 90),
                    (154, 68),
                    (142, 60),
                    (128, 68),
                    (120, 62),
                    (112, 68),
                    (98, 60),
                    (86, 68),
                    (82, 90),
                ),
                HAIR,
            ),
        ),
        details=(
            stroke(((94, 80), (110, 77)), HAIR, 3),
            stroke(((146, 80), (130, 77)), HAIR, 3),
            ell((95, 84, 111, 98), EYE_WHITE, width=1),
            ell((129, 84, 145, 98), EYE_WHITE, width=1),
            ell((100, 87, 108, 96), PUPIL, outline=False),
            ell((132, 87, 140, 96), PUPIL, outline=False),
            arc((110, 100, 130, 114), 20, 160, MOUTH, 2),
            ell((93, 99, 102, 107), (224, 150, 132, 96), outline=False),
            ell((138, 99, 147, 107), (224, 150, 132, 96), outline=False),
        ),
        shade_bias=0.62,
    ),
}

#: Back to front, which is also the PSD stacking order the rig reads as draw
#: order: cloak, then the legs behind the body, then the body, then the arms
#: in front of it, head last.
DRAW_ORDER: tuple[str, ...] = (
    "cape",
    "hip",
    "thigh_left",
    "thigh_right",
    "shin_left",
    "shin_right",
    "foot_left",
    "foot_right",
    "body",
    "chest",
    "arm_left",
    "arm_right",
    "forearm_left",
    "forearm_right",
    "hand_left",
    "hand_right",
    "head",
)


def _points(geom: tuple) -> list[tuple[float, float]]:
    return [(x * SUPERSAMPLE, y * SUPERSAMPLE) for x, y in geom]


def _box(geom: tuple) -> tuple[float, float, float, float]:
    return tuple(value * SUPERSAMPLE for value in geom)  # type: ignore[return-value]


def _paint(canvas: Image.Image, shape: Shape) -> None:
    """Draw one shape onto the part's canvas.

    A shape whose colour is translucent is drawn on a scratch layer and
    composited, because ImageDraw *replaces* pixels instead of blending
    them: drawing the cheek blush straight onto the head would punch a 38%
    alpha hole through the face, which looks like blush over a light page
    and like a dark smudge over a dark one.
    """
    width = max(1, shape.width * SUPERSAMPLE)
    colour = shape.fill if shape.fill is not None else shape.stroke
    translucent = colour is not None and colour[3] < 255
    target = Image.new("RGBA", canvas.size, TRANSPARENT) if translucent else canvas
    draw = ImageDraw.Draw(target)

    if shape.kind == "polygon":
        points = _points(shape.geom)
        draw.polygon(points, fill=shape.fill)
        if shape.outline and shape.fill is not None:
            draw.line(
                points + [points[0]],
                fill=darken(shape.fill, OUTLINE_DARKEN),
                width=width,
                joint="curve",
            )
    elif shape.kind == "ellipse":
        outline = (
            darken(shape.fill, OUTLINE_DARKEN)
            if shape.outline and shape.fill is not None
            else None
        )
        draw.ellipse(_box(shape.geom), fill=shape.fill, outline=outline, width=width)
    elif shape.kind == "line":
        draw.line(_points(shape.geom), fill=shape.stroke, width=width, joint="curve")
    elif shape.kind == "arc":
        assert shape.sweep is not None
        draw.arc(
            _box(shape.geom),
            shape.sweep[0],
            shape.sweep[1],
            fill=shape.stroke,
            width=width,
        )
    else:  # pragma: no cover - the table is a closed set
        raise ValueError(f"unknown shape kind: {shape.kind}")

    if translucent:
        canvas.alpha_composite(target)


def _shade(canvas: Image.Image, bias: float) -> Image.Image:
    """Lay one soft band of shadow over the part, clipped to its silhouette."""
    box = canvas.getbbox()
    if box is None:
        return canvas

    left, top, right, bottom = box
    width = right - left
    pad = 8 * SUPERSAMPLE
    band = [
        (left + width * bias, top - pad),
        (right + pad, top - pad),
        (right + pad, bottom + pad),
        (left + width * min(1.0, bias + 0.12), bottom + pad),
    ]

    shade = Image.new("RGBA", canvas.size, TRANSPARENT)
    ImageDraw.Draw(shade).polygon(band, fill=SHADE)
    shade = shade.filter(ImageFilter.GaussianBlur(radius=3 * SUPERSAMPLE))
    shade.putalpha(
        ImageChops.multiply(shade.getchannel("A"), canvas.getchannel("A"))
    )
    return Image.alpha_composite(canvas, shade)


def render_part(part: Part) -> Image.Image:
    """Draw one part on its own document-sized transparent canvas."""
    size = (DOC_SIZE[0] * SUPERSAMPLE, DOC_SIZE[1] * SUPERSAMPLE)
    canvas = Image.new("RGBA", size, TRANSPARENT)

    for shape in part.shapes:
        _paint(canvas, shape)

    canvas = _shade(canvas, part.shade_bias)

    for shape in part.details:
        _paint(canvas, shape)

    return canvas.resize(DOC_SIZE, Image.Resampling.LANCZOS)


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: make-sample-psd.py <output.psd>", file=sys.stderr)
        return 2

    out = Path(sys.argv[1])
    out.parent.mkdir(parents=True, exist_ok=True)

    psd = PSDImage.new("RGBA", DOC_SIZE)
    for name in DRAW_ORDER:
        image = render_part(PARTS[name])
        box = image.getbbox()
        if box is None:
            print(f"part {name} drew nothing", file=sys.stderr)
            return 2
        # Crop to the art and move the layer to match, so the layer bounds
        # the rig builder pivots on hug the pixels.
        psd.append(
            PixelLayer.frompil(
                image.crop(box), psd, layer_name=name, top=box[1], left=box[0]
            )
        )

    psd.save(out)
    print(f"wrote {out} ({len(DRAW_ORDER)} layers)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
