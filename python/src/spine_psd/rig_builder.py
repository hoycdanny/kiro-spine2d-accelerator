"""Turn classified PSD parts into Spine skeleton data.

Coordinate systems: PSD is y-down with the origin at the top left; Spine is
y-up with the origin wherever the rig puts it. The origin here is the
horizontal centre of the document at the bottom of the lowest part, which is
where a character's feet are, and the point animators expect to be (0, 0).

Bone positions are expressed relative to their parent, as Spine requires,
and each bone sits at its part's joint edge rather than its image centre so
rotation bends where a joint would.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

from .conventions import BONE_BY_NAME, BoneSpec, PivotSide, required_bones
from .psd_parser import LayerPart, PsdDocument


@dataclass
class BuiltBone:
    name: str
    parent: str | None
    #: Position relative to the parent, in Spine coordinates.
    x: float
    y: float
    #: Absolute position in Spine coordinates, kept for attachment maths.
    world_x: float
    world_y: float
    #: True when no PSD layer provided this bone.
    virtual: bool


@dataclass
class BuiltAttachment:
    slot: str
    #: Attachment name, which is also the atlas region name.
    name: str
    bone: str
    #: Offset from the bone, in Spine coordinates.
    x: float
    y: float
    width: int
    height: int
    #: Draw order index.
    order: int


@dataclass
class BuiltRig:
    bones: list[BuiltBone]
    attachments: list[BuiltAttachment]
    #: Slots in draw order, back to front.
    slot_order: list[str]
    warnings: list[str] = field(default_factory=list)
    #: Parts that could not be mapped to a bone.
    unmapped: list[str] = field(default_factory=list)


def _pivot_point(part: LayerPart, pivot: PivotSide) -> tuple[float, float]:
    """The pivot of a part, in PSD coordinates."""
    left, top, right, bottom = part.bounds
    if pivot == "bottom":
        return ((left + right) / 2, bottom)
    if pivot == "top":
        return ((left + right) / 2, top)
    if pivot == "left":
        return (left, (top + bottom) / 2)
    if pivot == "right":
        return (right, (top + bottom) / 2)
    return ((left + right) / 2, (top + bottom) / 2)


def build_rig(document: PsdDocument) -> BuiltRig:
    """Build bones, slots and attachments from a parsed PSD."""
    warnings: list[str] = []

    by_bone: dict[str, LayerPart] = {}
    unmapped: list[str] = []
    pivot_overrides: dict[str, tuple[float, float]] = {}

    for part in document.parts:
        if part.is_pivot_marker:
            if part.pivot_for:
                pivot_overrides[part.pivot_for] = part.center
            else:
                warnings.append(
                    f'Pivot marker "{part.raw_name}" names no part, so it was ignored.'
                )
            continue

        if part.bone is None:
            unmapped.append(part.raw_name)
            continue

        if part.bone in by_bone:
            warnings.append(
                f'More than one layer maps to bone "{part.bone}"; keeping "{by_bone[part.bone].raw_name}" '
                f'and ignoring "{part.raw_name}".'
            )
            continue

        by_bone[part.bone] = part

    if not by_bone:
        return BuiltRig(
            bones=[],
            attachments=[],
            slot_order=[],
            warnings=warnings,
            unmapped=unmapped,
        )

    bone_names = required_bones(list(by_bone.keys()))

    # Origin: horizontal centre of the used area, at the lowest part's bottom.
    used_parts = list(by_bone.values())
    min_left = min(part.bounds[0] for part in used_parts)
    max_right = max(part.bounds[2] for part in used_parts)
    max_bottom = max(part.bounds[3] for part in used_parts)
    origin_x = (min_left + max_right) / 2
    origin_y = max_bottom

    def to_spine(x: float, y: float) -> tuple[float, float]:
        """PSD (y-down) to Spine (y-up), relative to the rig origin."""
        return (x - origin_x, origin_y - y)

    world: dict[str, tuple[float, float]] = {}
    bones: list[BuiltBone] = []

    for name in bone_names:
        spec: BoneSpec = BONE_BY_NAME[name]
        part = by_bone.get(name)

        if name in pivot_overrides:
            psd_point = pivot_overrides[name]
        elif part is not None:
            psd_point = _pivot_point(part, spec.pivot)
        else:
            psd_point = None

        if psd_point is None:
            # A virtual bone sits at the pivot of its nearest real descendant
            # when there is one, so the chain stays geometrically sensible.
            descendant = _nearest_descendant_part(name, by_bone)
            if descendant is not None:
                descendant_spec = BONE_BY_NAME[descendant[0]]
                psd_point = _pivot_point(descendant[1], descendant_spec.pivot)
            else:
                psd_point = (origin_x, origin_y)
            warnings.append(
                f'No layer provided bone "{name}"; it was created as a positioned virtual bone.'
            )

        world_x, world_y = to_spine(*psd_point)
        world[name] = (world_x, world_y)

        parent = spec.parent
        if parent is None or parent not in world:
            local_x, local_y = world_x, world_y
            parent_name = parent
        else:
            parent_x, parent_y = world[parent]
            local_x, local_y = world_x - parent_x, world_y - parent_y
            parent_name = parent

        bones.append(
            BuiltBone(
                name=name,
                parent=parent_name,
                x=round(local_x, 2),
                y=round(local_y, 2),
                world_x=round(world_x, 2),
                world_y=round(world_y, 2),
                virtual=part is None,
            )
        )

    attachments: list[BuiltAttachment] = []
    slot_order: list[str] = []

    # Draw order follows the PSD stacking order, which is what the artist
    # already arranged; Spine slot order is the same concept.
    for part in sorted(
        (part for part in document.parts if not part.is_pivot_marker and part.bone),
        key=lambda item: item.order,
    ):
        bone = part.bone
        assert bone is not None
        if by_bone.get(bone) is not part:
            continue

        center_x, center_y = part.center
        spine_x, spine_y = to_spine(center_x, center_y)
        bone_x, bone_y = world[bone]

        attachments.append(
            BuiltAttachment(
                slot=bone,
                name=bone,
                bone=bone,
                x=round(spine_x - bone_x, 2),
                y=round(spine_y - bone_y, 2),
                width=part.width,
                height=part.height,
                order=part.order,
            )
        )
        slot_order.append(bone)

    return BuiltRig(
        bones=bones,
        attachments=attachments,
        slot_order=slot_order,
        warnings=warnings,
        unmapped=unmapped,
    )


def _nearest_descendant_part(
    bone: str, by_bone: dict[str, LayerPart]
) -> tuple[str, LayerPart] | None:
    """Find a real part whose bone descends from `bone`."""
    for name, part in by_bone.items():
        cursor = BONE_BY_NAME.get(name)
        while cursor is not None and cursor.parent is not None:
            if cursor.parent == bone:
                return (name, part)
            cursor = BONE_BY_NAME.get(cursor.parent)
    return None


def iter_bone_names(rig: BuiltRig) -> Iterable[str]:
    for bone in rig.bones:
        yield bone.name
