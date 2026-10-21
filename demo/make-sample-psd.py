"""Generate the demo's sample PSD.

The PSD is built here rather than committed so the repository carries no
binary art assets, and so the demo exercises the real PSD reader.

Layer names deliberately cover three cases the Power handles differently:
  * recognised parts (head, body, arm_left, thigh_right, ...)
  * an alias (`body` resolves to the `torso` bone)
  * an unrecognised layer (`cape`), which is reported rather than guessed at
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image
from psd_tools import PSDImage
from psd_tools.api.layers import PixelLayer

# name, (width, height), rgba, top, left
LAYERS = [
    ("cape", (120, 200), (90, 40, 120, 200), 150, 60),
    ("thigh_left", (26, 110), (52, 52, 170, 255), 300, 90),
    ("thigh_right", (26, 110), (52, 52, 170, 255), 300, 124),
    ("body", (72, 132), (205, 72, 72, 255), 170, 84),
    ("arm_left", (22, 96), (64, 172, 64, 255), 152, 60),
    ("arm_right", (22, 96), (64, 172, 64, 255), 152, 158),
    ("head", (82, 92), (238, 206, 166, 255), 72, 79),
]


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: make-sample-psd.py <output.psd>", file=sys.stderr)
        return 2

    out = Path(sys.argv[1])
    out.parent.mkdir(parents=True, exist_ok=True)

    psd = PSDImage.new("RGBA", (240, 440))
    for name, size, color, top, left in LAYERS:
        image = Image.new("RGBA", size, color)
        psd.append(PixelLayer.frompil(image, psd, layer_name=name, top=top, left=left))

    psd.save(out)
    print(f"wrote {out} ({len(LAYERS)} layers)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
