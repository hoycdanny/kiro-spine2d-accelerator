"""Layer-naming conventions that turn a PSD into a rig.

The hierarchy is the one Spine's own example rigs use, and the one the
community PSD-to-Spine tools converge on:

    root -> hip -> torso -> chest -> neck -> head
    arms hang off chest, legs off hip

Intermediate bones a PSD does not provide are created as positioned virtual
bones, so a two-layer PSD (``body``, ``head``) still produces a rig whose
head rotates about the neck rather than about the document origin.

Pivots matter more than they look: rotating a limb about the centre of its
image bends it in the middle. Each part therefore pivots at the joint edge,
and an explicit ``<part>[pivot]`` marker layer overrides that when the art
needs it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

#: Where a bone's origin sits inside its own image.
PivotSide = Literal["bottom", "top", "left", "right", "center"]


@dataclass(frozen=True)
class BoneSpec:
    """One bone in the canonical hierarchy."""

    name: str
    parent: str | None
    #: Edge of the part image the bone pivots about.
    pivot: PivotSide
    #: True when the bone is created even without a matching layer.
    virtual_ok: bool = True


#: The canonical spine chain, parents before children.
CORE_CHAIN: tuple[BoneSpec, ...] = (
    BoneSpec("root", None, "center", virtual_ok=True),
    BoneSpec("hip", "root", "center"),
    BoneSpec("torso", "hip", "bottom"),
    BoneSpec("chest", "torso", "bottom"),
    BoneSpec("neck", "chest", "bottom"),
    BoneSpec("head", "neck", "bottom"),
)

#: Limbs, keyed by the bone they hang from.
LIMBS: tuple[BoneSpec, ...] = (
    BoneSpec("shoulder_left", "chest", "right"),
    BoneSpec("arm_left", "shoulder_left", "top"),
    BoneSpec("forearm_left", "arm_left", "top"),
    BoneSpec("hand_left", "forearm_left", "top"),
    BoneSpec("shoulder_right", "chest", "left"),
    BoneSpec("arm_right", "shoulder_right", "top"),
    BoneSpec("forearm_right", "arm_right", "top"),
    BoneSpec("hand_right", "forearm_right", "top"),
    BoneSpec("thigh_left", "hip", "top"),
    BoneSpec("shin_left", "thigh_left", "top"),
    BoneSpec("foot_left", "shin_left", "top"),
    BoneSpec("thigh_right", "hip", "top"),
    BoneSpec("shin_right", "thigh_right", "top"),
    BoneSpec("foot_right", "shin_right", "top"),
)

ALL_BONES: tuple[BoneSpec, ...] = CORE_CHAIN + LIMBS

BONE_BY_NAME: dict[str, BoneSpec] = {bone.name: bone for bone in ALL_BONES}

#: Layer-name aliases, mapped to canonical bone names.
ALIASES: dict[str, str] = {
    "body": "torso",
    "belly": "torso",
    "pelvis": "hip",
    "hips": "hip",
    "waist": "hip",
    "upper_body": "chest",
    "upperbody": "chest",
    "ribs": "chest",
    "skull": "head",
    "face": "head",
    "upper_arm_left": "arm_left",
    "upperarm_left": "arm_left",
    "lower_arm_left": "forearm_left",
    "upper_arm_right": "arm_right",
    "upperarm_right": "arm_right",
    "lower_arm_right": "forearm_right",
    "leg_left": "thigh_left",
    "lower_leg_left": "shin_left",
    "calf_left": "shin_left",
    "leg_right": "thigh_right",
    "lower_leg_right": "shin_right",
    "calf_right": "shin_right",
}

#: Suffix forms that mean "left" / "right".
SIDE_SUFFIXES: dict[str, str] = {
    "l": "left",
    "left": "left",
    "lt": "left",
    "r": "right",
    "right": "right",
    "rt": "right",
}

#: Marker that makes a layer define another layer's pivot.
PIVOT_MARKER = "[pivot]"


def normalize(raw: str) -> str:
    """Lower-case a layer name and collapse separators to underscores."""
    cleaned = raw.strip().lower()
    for char in (" ", "-", ".", "/"):
        cleaned = cleaned.replace(char, "_")
    while "__" in cleaned:
        cleaned = cleaned.replace("__", "_")
    return cleaned.strip("_")


def strip_pivot_marker(raw: str) -> tuple[str, bool]:
    """Split a pivot marker off a layer name.

    Returns the remaining name and whether the marker was present.
    """
    lowered = raw.lower()
    if PIVOT_MARKER in lowered:
        index = lowered.index(PIVOT_MARKER)
        remainder = raw[:index] + raw[index + len(PIVOT_MARKER) :]
        return remainder.strip(), True
    return raw.strip(), False


def canonical_bone(raw: str) -> str | None:
    """Map a layer name onto a canonical bone name, or None when unknown.

    Handles the aliases above plus trailing or leading side markers, so
    ``arm_l``, ``l_arm``, ``left arm`` and ``upper_arm_left`` all land on
    ``arm_left``.
    """
    name = normalize(raw)
    if not name:
        return None

    if name in BONE_BY_NAME:
        return name
    if name in ALIASES:
        return ALIASES[name]

    parts = name.split("_")

    # Trailing side marker: arm_l -> arm_left
    if len(parts) >= 2 and parts[-1] in SIDE_SUFFIXES:
        base = "_".join(parts[:-1])
        side = SIDE_SUFFIXES[parts[-1]]
        candidate = f"{base}_{side}"
        if candidate in BONE_BY_NAME:
            return candidate
        if candidate in ALIASES:
            return ALIASES[candidate]

    # Leading side marker: l_arm -> arm_left
    if len(parts) >= 2 and parts[0] in SIDE_SUFFIXES:
        base = "_".join(parts[1:])
        side = SIDE_SUFFIXES[parts[0]]
        candidate = f"{base}_{side}"
        if candidate in BONE_BY_NAME:
            return candidate
        if candidate in ALIASES:
            return ALIASES[candidate]

    return None


def ancestors_of(bone: str) -> list[str]:
    """Every ancestor of a bone, root first, excluding the bone itself."""
    chain: list[str] = []
    cursor = BONE_BY_NAME.get(bone)
    while cursor is not None and cursor.parent is not None:
        chain.append(cursor.parent)
        cursor = BONE_BY_NAME.get(cursor.parent)
    chain.reverse()
    return chain


def required_bones(bones: list[str]) -> list[str]:
    """Expand a bone list with every ancestor, in parent-before-child order.

    This is what creates the virtual intermediate bones: asking for ``head``
    pulls in ``neck``, ``chest``, ``torso``, ``hip`` and ``root``.
    """
    needed: set[str] = set()
    for bone in bones:
        if bone not in BONE_BY_NAME:
            continue
        needed.add(bone)
        needed.update(ancestors_of(bone))

    ordered = [bone.name for bone in ALL_BONES if bone.name in needed]
    return ordered
