"""Serialize a built rig as Spine 4.2 skeleton JSON.

Nonessential data is written on purpose: these files exist to be imported
into the Spine editor, and without it the import loses information.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from .rig_builder import BuiltRig

#: Spine version the generated data targets. Must match the runtime in use.
TARGET_SPINE_VERSION = "4.2.37"


def build_skeleton_json(
    rig: BuiltRig,
    name: str,
    images_path: str = "./images/",
    fps: int = 30,
) -> dict[str, Any]:
    """Build the skeleton data structure for a rig."""
    bones: list[dict[str, Any]] = []
    for bone in rig.bones:
        entry: dict[str, Any] = {"name": bone.name}
        if bone.parent is not None:
            entry["parent"] = bone.parent
        if bone.x:
            entry["x"] = bone.x
        if bone.y:
            entry["y"] = bone.y
        bones.append(entry)

    slots = [
        {"name": attachment.slot, "bone": attachment.bone, "attachment": attachment.name}
        for attachment in rig.attachments
    ]

    skin_attachments: dict[str, Any] = {}
    for attachment in rig.attachments:
        skin_attachments[attachment.slot] = {
            attachment.name: {
                "x": attachment.x,
                "y": attachment.y,
                "width": attachment.width,
                "height": attachment.height,
            }
        }

    skeleton: dict[str, Any] = {
        "skeleton": {
            "spine": TARGET_SPINE_VERSION,
            "x": 0,
            "y": 0,
            "width": 0,
            "height": 0,
            "fps": fps,
            "images": images_path,
        },
        "bones": bones,
        "slots": slots,
        "skins": [{"name": "default", "attachments": skin_attachments}],
        "animations": {"setup": {}},
    }

    bounds = _bounds_of(rig)
    skeleton["skeleton"]["x"] = bounds[0]
    skeleton["skeleton"]["y"] = bounds[1]
    skeleton["skeleton"]["width"] = bounds[2]
    skeleton["skeleton"]["height"] = bounds[3]

    # A hash lets tools detect changes the way a Spine export does. It is
    # derived from the data, so it is stable for identical input.
    payload = json.dumps(skeleton, sort_keys=True, separators=(",", ":"))
    skeleton["skeleton"]["hash"] = hashlib.sha1(payload.encode("utf-8")).hexdigest()[:22]

    skeleton["_generator"] = {
        "tool": "kiro-spine2d-power/psd_to_skeleton",
        "note": (
            "Generated from a PSD. Import into the Spine editor with spine_import, "
            "then rig weights and animate there."
        ),
    }

    return skeleton


def _bounds_of(rig: BuiltRig) -> tuple[float, float, float, float]:
    """Axis-aligned bounds of every attachment, in Spine coordinates."""
    if not rig.attachments:
        return (0.0, 0.0, 0.0, 0.0)

    world = {bone.name: (bone.world_x, bone.world_y) for bone in rig.bones}
    lefts: list[float] = []
    bottoms: list[float] = []
    rights: list[float] = []
    tops: list[float] = []

    for attachment in rig.attachments:
        bone_x, bone_y = world.get(attachment.bone, (0.0, 0.0))
        center_x = bone_x + attachment.x
        center_y = bone_y + attachment.y
        lefts.append(center_x - attachment.width / 2)
        rights.append(center_x + attachment.width / 2)
        bottoms.append(center_y - attachment.height / 2)
        tops.append(center_y + attachment.height / 2)

    left = min(lefts)
    bottom = min(bottoms)
    return (
        round(left, 2),
        round(bottom, 2),
        round(max(rights) - left, 2),
        round(max(tops) - bottom, 2),
    )


def dump_skeleton_json(skeleton: dict[str, Any]) -> str:
    """Serialize skeleton data as pretty JSON."""
    return json.dumps(skeleton, indent=2) + "\n"
