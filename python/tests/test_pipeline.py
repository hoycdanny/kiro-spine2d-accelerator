from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import make_part

from spine_psd.atlas_packer import compose_page, next_power_of_two, pack_regions, write_atlas_text
from spine_psd.pipeline import run_pipeline
from spine_psd.psd_parser import PsdDocument, classify_layer
from spine_psd.validator import validate_skeleton
from spine_psd.writer import build_skeleton_json
from spine_psd.rig_builder import build_rig


class TestClassifyLayer:
    def test_a_normal_layer(self) -> None:
        assert classify_layer("head") == ("head", False, None)

    def test_a_pivot_marker(self) -> None:
        assert classify_layer("head[pivot]") == (None, True, "head")

    def test_an_unknown_layer(self) -> None:
        assert classify_layer("cape") == (None, False, None)


class TestPacking:
    def test_next_power_of_two(self) -> None:
        assert next_power_of_two(1) == 1
        assert next_power_of_two(63) == 64
        assert next_power_of_two(64) == 64
        assert next_power_of_two(65) == 128

    def test_regions_fit_inside_the_page(self) -> None:
        sizes = [("a", 60, 100), ("b", 40, 150), ("c", 25, 80)]
        width, height, regions = pack_regions(sizes)
        assert len(regions) == 3
        for region in regions:
            assert region.x >= 0
            assert region.y >= 0
            assert region.x + region.width <= width
            assert region.y + region.height <= height

    def test_regions_do_not_overlap(self) -> None:
        sizes = [(f"part{i}", 30 + i, 40 + i) for i in range(12)]
        _, _, regions = pack_regions(sizes)
        for first in regions:
            for second in regions:
                if first is second:
                    continue
                separated = (
                    first.x + first.width <= second.x
                    or second.x + second.width <= first.x
                    or first.y + first.height <= second.y
                    or second.y + second.height <= first.y
                )
                assert separated, f"{first.name} overlaps {second.name}"

    def test_region_sizes_are_preserved(self) -> None:
        sizes = [("a", 60, 100)]
        _, _, regions = pack_regions(sizes)
        assert (regions[0].width, regions[0].height) == (60, 100)

    def test_an_empty_pack(self) -> None:
        assert pack_regions([]) == (1, 1, [])

    def test_oversized_images_are_rejected(self) -> None:
        with pytest.raises(ValueError, match="do not fit"):
            pack_regions([("huge", 300, 300)], max_size=128)

    def test_atlas_text_uses_the_modern_format(self) -> None:
        from PIL import Image

        images = {"a": Image.new("RGBA", (10, 20), (255, 0, 0, 255))}
        atlas = compose_page("hero.png", images, [("a", 10, 20)])
        text = write_atlas_text(atlas)
        assert text.splitlines()[0] == "hero.png"
        assert "pma: false" in text
        assert any(line.startswith("bounds: ") for line in text.splitlines())

    def test_premultiplied_alpha_is_recorded(self) -> None:
        from PIL import Image

        images = {"a": Image.new("RGBA", (8, 8), (255, 0, 0, 255))}
        atlas = compose_page("hero.png", images, [("a", 8, 8)])
        assert "pma: true" in write_atlas_text(atlas, premultiplied_alpha=True)


class TestWriter:
    def test_skeleton_declares_the_target_spine_version(self, simple_document) -> None:
        skeleton = build_skeleton_json(build_rig(simple_document), "hero")
        assert skeleton["skeleton"]["spine"] == "4.2.37"

    def test_nonessential_data_is_included_for_round_trips(self, simple_document) -> None:
        skeleton = build_skeleton_json(build_rig(simple_document), "hero")
        assert skeleton["skeleton"]["fps"] == 30
        assert skeleton["skeleton"]["images"] == "./images/"

    def test_hash_is_stable_for_identical_input(self, simple_document) -> None:
        first = build_skeleton_json(build_rig(simple_document), "hero")
        second = build_skeleton_json(build_rig(simple_document), "hero")
        assert first["skeleton"]["hash"] == second["skeleton"]["hash"]

    def test_hash_changes_with_the_data(self, simple_document) -> None:
        first = build_skeleton_json(build_rig(simple_document), "hero")
        moved = PsdDocument(
            width=simple_document.width,
            height=simple_document.height,
            parts=[
                make_part("body", (80, 150, 120, 300), order=0),
                make_part("head", (70, 40, 130, 150), order=1),
            ],
        )
        second = build_skeleton_json(build_rig(moved), "hero")
        assert first["skeleton"]["hash"] != second["skeleton"]["hash"]

    def test_bounds_cover_every_attachment(self, simple_document) -> None:
        skeleton = build_skeleton_json(build_rig(simple_document), "hero")
        assert skeleton["skeleton"]["width"] == 60
        assert skeleton["skeleton"]["height"] == 250

    def test_slots_and_skin_agree(self, full_document) -> None:
        skeleton = build_skeleton_json(build_rig(full_document), "hero")
        slot_names = {slot["name"] for slot in skeleton["slots"]}
        skin_slots = set(skeleton["skins"][0]["attachments"].keys())
        assert slot_names == skin_slots


class TestValidator:
    def test_a_generated_skeleton_validates(self, full_document) -> None:
        rig = build_rig(full_document)
        skeleton = build_skeleton_json(rig, "hero")
        regions = [attachment.name for attachment in rig.attachments]
        assert validate_skeleton(skeleton, regions) == []

    def test_missing_regions_are_reported(self, simple_document) -> None:
        skeleton = build_skeleton_json(build_rig(simple_document), "hero")
        problems = validate_skeleton(skeleton, ["head"])
        assert any("torso" in problem for problem in problems)

    def test_two_roots_are_rejected(self) -> None:
        skeleton = {
            "bones": [{"name": "root"}, {"name": "other"}],
            "slots": [],
            "skins": [{"name": "default", "attachments": {}}],
        }
        problems = validate_skeleton(skeleton, [])
        assert any("exactly one root" in problem for problem in problems)

    def test_a_child_before_its_parent_is_rejected(self) -> None:
        skeleton = {
            "bones": [{"name": "root"}, {"name": "hand", "parent": "arm"}, {"name": "arm", "parent": "root"}],
            "slots": [],
            "skins": [{"name": "default", "attachments": {}}],
        }
        problems = validate_skeleton(skeleton, [])
        assert any("not declared before it" in problem for problem in problems)

    def test_a_slot_on_an_unknown_bone_is_rejected(self) -> None:
        skeleton = {
            "bones": [{"name": "root"}],
            "slots": [{"name": "head", "bone": "ghost"}],
            "skins": [{"name": "default", "attachments": {}}],
        }
        problems = validate_skeleton(skeleton, [])
        assert any("unknown bone" in problem for problem in problems)

    def test_no_bones_is_rejected(self) -> None:
        assert validate_skeleton({"bones": []}, []) == ["Skeleton has no bones."]


class TestRunPipeline:
    def test_writes_skeleton_atlas_and_page(self, tmp_path: Path, simple_document) -> None:
        result = run_pipeline(
            tmp_path / "hero.psd",
            tmp_path / "out",
            name="hero",
            document=simple_document,
        )

        assert result.problems == []
        assert Path(result.skeleton_path).exists()
        assert Path(result.atlas_path).exists()
        assert Path(result.page_paths[0]).exists()

        skeleton = json.loads(Path(result.skeleton_path).read_text(encoding="utf-8"))
        assert [bone["name"] for bone in skeleton["bones"]][0] == "root"
        assert result.bone_count == 6
        assert result.attachment_count == 2
        assert sorted(result.region_names) == ["head", "torso"]
        assert sorted(result.virtual_bones) == ["chest", "hip", "neck", "root"]

    def test_atlas_regions_match_the_attachments(self, tmp_path: Path, full_document) -> None:
        result = run_pipeline(
            tmp_path / "hero.psd",
            tmp_path / "out",
            name="hero",
            document=full_document,
        )
        skeleton = json.loads(Path(result.skeleton_path).read_text(encoding="utf-8"))
        needed = set()
        for slot_attachments in skeleton["skins"][0]["attachments"].values():
            needed.update(slot_attachments.keys())
        assert needed <= set(result.region_names)

    def test_an_unrecognisable_psd_fails_with_an_explanation(self, tmp_path: Path) -> None:
        document = PsdDocument(
            width=10,
            height=10,
            parts=[make_part("background", (0, 0, 10, 10), order=0)],
        )
        result = run_pipeline(
            tmp_path / "x.psd", tmp_path / "out", document=document
        )
        assert result.problems
        assert "No layer name matched" in result.problems[0]
