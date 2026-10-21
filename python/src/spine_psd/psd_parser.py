"""PSD reading: layers in, flat part descriptions out.

Only what the rig builder needs is extracted — name, pixel bounds, draw
order and the trimmed image — so the rest of the pipeline can be tested
without a PSD at all.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .conventions import canonical_bone, normalize, strip_pivot_marker


@dataclass
class LayerPart:
    """One PSD layer that became a rig part."""

    #: Original layer name.
    raw_name: str
    #: Canonical bone name, or None when the layer is unrecognised.
    bone: str | None
    #: Layer bounds in PSD coordinates: left, top, right, bottom.
    bounds: tuple[int, int, int, int]
    #: Draw order index; 0 is drawn first (furthest back).
    order: int
    #: Trimmed RGBA image for this layer.
    image: Any = field(default=None, repr=False)
    #: True when this layer is a pivot marker for another part.
    is_pivot_marker: bool = False
    #: Part the pivot marker belongs to.
    pivot_for: str | None = None

    @property
    def width(self) -> int:
        return self.bounds[2] - self.bounds[0]

    @property
    def height(self) -> int:
        return self.bounds[3] - self.bounds[1]

    @property
    def center(self) -> tuple[float, float]:
        return (
            (self.bounds[0] + self.bounds[2]) / 2,
            (self.bounds[1] + self.bounds[3]) / 2,
        )


@dataclass
class PsdDocument:
    """A parsed PSD, reduced to what the rig builder needs."""

    width: int
    height: int
    parts: list[LayerPart]
    #: Layers that were skipped, with the reason.
    skipped: list[tuple[str, str]] = field(default_factory=list)


def classify_layer(raw_name: str) -> tuple[str | None, bool, str | None]:
    """Classify a layer name.

    Returns ``(bone, is_pivot_marker, pivot_for)``.
    """
    name, has_marker = strip_pivot_marker(raw_name)
    bone = canonical_bone(name)
    if has_marker:
        return (None, True, bone or normalize(name) or None)
    return (bone, False, None)


def parse_psd(path: str | Path) -> PsdDocument:
    """Read a PSD file into a {PsdDocument}.

    Hidden layers are skipped: an artist hiding a layer is an instruction,
    not an accident. Group layers are walked but not themselves parts.
    """
    from psd_tools import PSDImage  # imported lazily to keep import cost off

    psd = PSDImage.open(str(path))
    parts: list[LayerPart] = []
    skipped: list[tuple[str, str]] = []
    order = 0

    def visit(layers: Any) -> None:
        nonlocal order
        for layer in layers:
            if layer.is_group():
                visit(list(layer))
                continue

            if not layer.visible:
                skipped.append((layer.name, "layer is hidden"))
                continue

            bounds = tuple(int(value) for value in layer.bbox)
            if bounds[2] - bounds[0] <= 0 or bounds[3] - bounds[1] <= 0:
                skipped.append((layer.name, "layer has no pixels"))
                continue

            bone, is_marker, pivot_for = classify_layer(layer.name)
            image = layer.composite() if not is_marker else None

            parts.append(
                LayerPart(
                    raw_name=layer.name,
                    bone=bone,
                    bounds=bounds,  # type: ignore[arg-type]
                    order=order,
                    image=image,
                    is_pivot_marker=is_marker,
                    pivot_for=pivot_for,
                )
            )
            order += 1

    # psd_tools yields layers bottom-up, which already matches draw order.
    visit(list(psd))

    return PsdDocument(width=psd.width, height=psd.height, parts=parts, skipped=skipped)
