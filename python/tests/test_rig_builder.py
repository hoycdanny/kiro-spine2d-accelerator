from __future__ import annotations

from conftest import make_part
from spine_psd.psd_parser import PsdDocument
from spine_psd.rig_builder import build_rig


def bone(rig, name: str):
    return next(entry for entry in rig.bones if entry.name == name)


class TestHierarchy:
    def test_creates_the_full_chain_from_two_layers(self, simple_document) -> None:
        rig = build_rig(simple_document)
        assert [entry.name for entry in rig.bones] == [
            "root",
            "hip",
            "torso",
            "chest",
            "neck",
            "head",
        ]

    def test_marks_bones_that_had_no_layer(self, simple_document) -> None:
        rig = build_rig(simple_document)
        virtual = {entry.name for entry in rig.bones if entry.virtual}
        assert virtual == {"root", "hip", "chest", "neck"}
        assert any("virtual bone" in warning for warning in rig.warnings)

    def test_parents_come_before_children(self, full_document) -> None:
        rig = build_rig(full_document)
        names = [entry.name for entry in rig.bones]
        for index, entry in enumerate(rig.bones):
            if entry.parent is not None:
                assert names.index(entry.parent) < index

    def test_root_is_the_only_bone_without_a_parent(self, full_document) -> None:
        rig = build_rig(full_document)
        roots = [entry for entry in rig.bones if entry.parent is None]
        assert [entry.name for entry in roots] == ["root"]


class TestCoordinates:
    def test_origin_sits_at_the_bottom_centre(self, simple_document) -> None:
        rig = build_rig(simple_document)
        # Used area spans x 70..130 and bottom y 300, so the origin is
        # (100, 300) in PSD space and (0, 0) in Spine space.
        root = bone(rig, "root")
        assert (root.world_x, root.world_y) == (0.0, 0.0)

    def test_y_axis_is_flipped(self, simple_document) -> None:
        rig = build_rig(simple_document)
        # The head pivots at its bottom edge, PSD y=150, which is 150 above
        # the origin at y=300.
        head = bone(rig, "head")
        assert head.world_y == 150.0

    def test_positions_are_relative_to_the_parent(self, simple_document) -> None:
        rig = build_rig(simple_document)
        head = bone(rig, "head")
        neck = bone(rig, "neck")
        assert head.y == round(head.world_y - neck.world_y, 2)
        assert head.x == round(head.world_x - neck.world_x, 2)

    def test_torso_pivots_at_its_bottom_edge(self, simple_document) -> None:
        rig = build_rig(simple_document)
        torso = bone(rig, "torso")
        # The body layer spans y 150..300; its bottom is the origin line.
        assert torso.world_y == 0.0
        assert torso.world_x == 0.0


class TestPivotOverrides:
    def test_a_marker_layer_sets_the_bone_origin(self) -> None:
        document = PsdDocument(
            width=200,
            height=400,
            parts=[
                make_part("body", (80, 150, 120, 300), order=0),
                make_part("head", (70, 50, 130, 150), order=1),
                # Marker centred at (100, 140): slightly above the head's bottom.
                make_part("head[pivot]", (98, 138, 102, 142), order=2),
            ],
        )
        rig = build_rig(document)
        head = bone(rig, "head")
        assert head.world_y == 160.0

    def test_a_marker_without_a_target_is_reported(self) -> None:
        document = PsdDocument(
            width=100,
            height=100,
            parts=[
                make_part("body", (10, 10, 50, 90), order=0),
                make_part("[pivot]", (20, 20, 24, 24), order=1),
            ],
        )
        rig = build_rig(document)
        assert any("names no part" in warning for warning in rig.warnings)


class TestAttachments:
    def test_one_attachment_per_mapped_layer(self, simple_document) -> None:
        rig = build_rig(simple_document)
        assert [entry.name for entry in rig.attachments] == ["torso", "head"]

    def test_attachment_offset_is_relative_to_its_bone(self, simple_document) -> None:
        rig = build_rig(simple_document)
        head_attachment = next(
            entry for entry in rig.attachments if entry.name == "head"
        )
        # The head image centre is PSD (100, 100) -> Spine (0, 200); the bone
        # sits at (0, 150), so the attachment is 50 above it.
        assert head_attachment.x == 0.0
        assert head_attachment.y == 50.0

    def test_attachment_size_matches_the_layer(self, simple_document) -> None:
        rig = build_rig(simple_document)
        head_attachment = next(
            entry for entry in rig.attachments if entry.name == "head"
        )
        assert (head_attachment.width, head_attachment.height) == (60, 100)

    def test_slot_order_follows_psd_draw_order(self, full_document) -> None:
        rig = build_rig(full_document)
        assert rig.slot_order[0] == "thigh_left"
        assert rig.slot_order[-1] == "head"


class TestDiagnostics:
    def test_unmapped_layers_are_reported_not_guessed(self) -> None:
        document = PsdDocument(
            width=100,
            height=100,
            parts=[
                make_part("body", (10, 10, 50, 90), order=0),
                make_part("mysterious cape", (0, 0, 100, 100), order=1),
            ],
        )
        rig = build_rig(document)
        assert rig.unmapped == ["mysterious cape"]
        assert all(entry.name != "mysterious cape" for entry in rig.attachments)

    def test_duplicate_bones_keep_the_first_layer(self) -> None:
        document = PsdDocument(
            width=100,
            height=200,
            parts=[
                make_part("head", (10, 10, 50, 90), order=0),
                make_part("face", (20, 20, 60, 100), order=1),
            ],
        )
        rig = build_rig(document)
        assert len([entry for entry in rig.attachments if entry.bone == "head"]) == 1
        assert any("More than one layer" in warning for warning in rig.warnings)

    def test_a_document_with_nothing_recognisable_builds_no_rig(self) -> None:
        document = PsdDocument(
            width=10,
            height=10,
            parts=[make_part("background", (0, 0, 10, 10), order=0)],
        )
        rig = build_rig(document)
        assert rig.bones == []
        assert rig.unmapped == ["background"]
