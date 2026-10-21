"""Synthetic PSD fixtures.

Tests build `PsdDocument` objects directly instead of reading PSD files:
the rig maths is what needs covering, and synthetic parts make the expected
geometry obvious.
"""

from __future__ import annotations

import pytest
from PIL import Image

from spine_psd.psd_parser import LayerPart, PsdDocument, classify_layer


def make_part(
    raw_name: str,
    bounds: tuple[int, int, int, int],
    order: int,
    with_image: bool = True,
) -> LayerPart:
    """Build a part the way the parser would, including classification."""
    bone, is_marker, pivot_for = classify_layer(raw_name)
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    image = (
        Image.new("RGBA", (max(width, 1), max(height, 1)), (255, 0, 0, 255))
        if with_image and not is_marker
        else None
    )
    return LayerPart(
        raw_name=raw_name,
        bone=bone,
        bounds=bounds,
        order=order,
        image=image,
        is_pivot_marker=is_marker,
        pivot_for=pivot_for,
    )


@pytest.fixture
def simple_document() -> PsdDocument:
    """A two-part character: body and head, drawn body first."""
    return PsdDocument(
        width=200,
        height=400,
        parts=[
            make_part("body", (80, 150, 120, 300), order=0),
            make_part("head", (70, 50, 130, 150), order=1),
        ],
    )


@pytest.fixture
def full_document() -> PsdDocument:
    """A character with a full limb set."""
    return PsdDocument(
        width=300,
        height=500,
        parts=[
            make_part("thigh_left", (120, 300, 145, 380), order=0),
            make_part("shin_left", (120, 380, 145, 450), order=1),
            make_part("foot_left", (115, 450, 155, 470), order=2),
            make_part("thigh_right", (155, 300, 180, 380), order=3),
            make_part("shin_right", (155, 380, 180, 450), order=4),
            make_part("foot_right", (145, 450, 185, 470), order=5),
            make_part("hip", (115, 270, 185, 310), order=6),
            make_part("torso", (110, 180, 190, 280), order=7),
            make_part("chest", (105, 120, 195, 190), order=8),
            make_part("arm_left", (80, 130, 105, 220), order=9),
            make_part("forearm_left", (75, 220, 100, 290), order=10),
            make_part("hand_left", (70, 290, 105, 320), order=11),
            make_part("arm_right", (195, 130, 220, 220), order=12),
            make_part("head", (120, 30, 180, 120), order=13),
        ],
    )
