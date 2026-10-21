from __future__ import annotations

from spine_psd.conventions import (
    BONE_BY_NAME,
    ancestors_of,
    canonical_bone,
    normalize,
    required_bones,
    strip_pivot_marker,
)


class TestNormalize:
    def test_collapses_separators_and_case(self) -> None:
        assert normalize("  Upper Arm-Left  ") == "upper_arm_left"
        assert normalize("arm..left") == "arm_left"
        assert normalize("arm/left") == "arm_left"

    def test_empty_stays_empty(self) -> None:
        assert normalize("   ") == ""


class TestStripPivotMarker:
    def test_removes_the_marker(self) -> None:
        assert strip_pivot_marker("head[pivot]") == ("head", True)
        assert strip_pivot_marker("head [PIVOT]") == ("head", True)

    def test_leaves_other_names_alone(self) -> None:
        assert strip_pivot_marker("head") == ("head", False)


class TestCanonicalBone:
    def test_exact_names(self) -> None:
        assert canonical_bone("head") == "head"
        assert canonical_bone("hip") == "hip"

    def test_aliases(self) -> None:
        assert canonical_bone("body") == "torso"
        assert canonical_bone("pelvis") == "hip"
        assert canonical_bone("face") == "head"

    def test_trailing_side_markers(self) -> None:
        assert canonical_bone("arm_l") == "arm_left"
        assert canonical_bone("arm-R") == "arm_right"
        assert canonical_bone("hand lt") == "hand_left"

    def test_leading_side_markers(self) -> None:
        assert canonical_bone("l_arm") == "arm_left"
        assert canonical_bone("right foot") == "foot_right"

    def test_alias_with_side(self) -> None:
        assert canonical_bone("upper_arm_left") == "arm_left"
        assert canonical_bone("lower_leg_right") == "shin_right"
        assert canonical_bone("leg_l") == "thigh_left"

    def test_unknown_names_return_none(self) -> None:
        assert canonical_bone("cape") is None
        assert canonical_bone("") is None
        assert canonical_bone("background") is None


class TestHierarchy:
    def test_ancestors_run_root_first(self) -> None:
        assert ancestors_of("head") == ["root", "hip", "torso", "chest", "neck"]
        assert ancestors_of("root") == []

    def test_required_bones_adds_missing_ancestors(self) -> None:
        assert required_bones(["head"]) == [
            "root",
            "hip",
            "torso",
            "chest",
            "neck",
            "head",
        ]

    def test_required_bones_keeps_parents_before_children(self) -> None:
        bones = required_bones(["hand_left", "foot_right"])
        for index, name in enumerate(bones):
            parent = BONE_BY_NAME[name].parent
            if parent is not None:
                assert bones.index(parent) < index

    def test_required_bones_ignores_unknown(self) -> None:
        assert required_bones(["nonsense"]) == []
