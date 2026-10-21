"""Structural validation of generated skeleton data.

These are the invariants the Spine data reader and the runtimes rely on. A
file that violates one of them fails to load, so the sidecar checks before
handing anything back rather than letting the editor reject it later.
"""

from __future__ import annotations

from typing import Any


def validate_skeleton(skeleton: dict[str, Any], atlas_regions: list[str]) -> list[str]:
    """Return a list of problems; empty means the data is structurally sound."""
    problems: list[str] = []

    bones = skeleton.get("bones")
    if not isinstance(bones, list) or not bones:
        return ["Skeleton has no bones."]

    names: list[str] = []
    for index, bone in enumerate(bones):
        if not isinstance(bone, dict) or not isinstance(bone.get("name"), str):
            problems.append(f"Bone at index {index} has no name.")
            continue
        names.append(bone["name"])

    duplicates = {name for name in names if names.count(name) > 1}
    for name in sorted(duplicates):
        problems.append(f'Bone name "{name}" is used more than once.')

    roots = [bone for bone in bones if "parent" not in bone]
    if len(roots) != 1:
        problems.append(f"Expected exactly one root bone, found {len(roots)}.")

    # Parents must be declared before their children, as the format requires.
    seen: set[str] = set()
    for bone in bones:
        name = bone.get("name")
        parent = bone.get("parent")
        if parent is not None:
            if parent not in seen:
                problems.append(
                    f'Bone "{name}" lists parent "{parent}", which is not declared before it.'
                )
        if isinstance(name, str):
            seen.add(name)

    bone_names = set(names)
    slots = skeleton.get("slots", [])
    slot_names: list[str] = []

    for slot in slots:
        if not isinstance(slot, dict):
            problems.append("A slot entry is not an object.")
            continue
        name = slot.get("name")
        bone = slot.get("bone")
        if not isinstance(name, str):
            problems.append("A slot has no name.")
            continue
        slot_names.append(name)
        if bone not in bone_names:
            problems.append(f'Slot "{name}" is attached to unknown bone "{bone}".')

    slot_duplicates = {name for name in slot_names if slot_names.count(name) > 1}
    for name in sorted(slot_duplicates):
        problems.append(f'Slot name "{name}" is used more than once.')

    skins = skeleton.get("skins", [])
    if not skins:
        problems.append("Skeleton has no skins, so nothing can be rendered.")

    region_names = set(atlas_regions)
    for skin in skins:
        attachments = skin.get("attachments", {}) if isinstance(skin, dict) else {}
        for slot_name, slot_attachments in attachments.items():
            if slot_name not in slot_names:
                problems.append(
                    f'Skin "{skin.get("name")}" has attachments for unknown slot "{slot_name}".'
                )
            if not isinstance(slot_attachments, dict):
                problems.append(f'Attachments for slot "{slot_name}" are not an object.')
                continue
            for attachment_name, attachment in slot_attachments.items():
                if not isinstance(attachment, dict):
                    problems.append(
                        f'Attachment "{attachment_name}" is not an object.'
                    )
                    continue
                region = attachment.get("path", attachment.get("name", attachment_name))
                if region_names and region not in region_names:
                    problems.append(
                        f'Attachment "{attachment_name}" needs atlas region "{region}", '
                        "which the generated atlas does not contain."
                    )
                for dimension in ("width", "height"):
                    value = attachment.get(dimension)
                    if not isinstance(value, (int, float)) or value <= 0:
                        problems.append(
                            f'Attachment "{attachment_name}" has a non-positive {dimension}.'
                        )

    return problems
