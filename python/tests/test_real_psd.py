"""End-to-end test against a real PSD file.

The PSD is built here with psd-tools' own layer API rather than shipped as a
binary fixture, so the test exercises the actual PSD reader without
redistributing anyone's artwork.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from PIL import Image
from psd_tools import PSDImage
from psd_tools.api.layers import PixelLayer

from spine_psd.pipeline import run_pipeline
from spine_psd.psd_parser import parse_psd


def _solid(width: int, height: int, color: tuple[int, int, int, int]) -> Image.Image:
    return Image.new("RGBA", (width, height), color)


@pytest.fixture
def character_psd(tmp_path: Path) -> Path:
    """A four-layer character, stacked body-first like an artist would."""
    psd = PSDImage.new("RGBA", (200, 400))

    layers = [
        ("thigh_left", _solid(20, 90, (40, 40, 160, 255)), 120, 85),
        ("body", _solid(60, 120, (200, 60, 60, 255)), 150, 70),
        ("arm_left", _solid(18, 80, (60, 160, 60, 255)), 160, 52),
        ("head", _solid(70, 80, (230, 200, 160, 255)), 70, 65),
    ]

    for name, image, top, left in layers:
        psd.append(PixelLayer.frompil(image, psd, layer_name=name, top=top, left=left))

    path = tmp_path / "character.psd"
    psd.save(path)
    return path


class TestParseRealPsd:
    def test_reads_every_visible_layer(self, character_psd: Path) -> None:
        document = parse_psd(character_psd)
        assert document.width == 200
        assert document.height == 400
        names = [part.raw_name for part in document.parts]
        assert set(names) == {"thigh_left", "body", "arm_left", "head"}

    def test_classifies_layer_names(self, character_psd: Path) -> None:
        document = parse_psd(character_psd)
        by_name = {part.raw_name: part for part in document.parts}
        assert by_name["body"].bone == "torso"
        assert by_name["head"].bone == "head"
        assert by_name["arm_left"].bone == "arm_left"
        assert by_name["thigh_left"].bone == "thigh_left"

    def test_keeps_layer_bounds(self, character_psd: Path) -> None:
        document = parse_psd(character_psd)
        head = next(part for part in document.parts if part.raw_name == "head")
        assert head.bounds == (65, 70, 135, 150)
        assert (head.width, head.height) == (70, 80)

    def test_preserves_draw_order(self, character_psd: Path) -> None:
        document = parse_psd(character_psd)
        ordered = [part.raw_name for part in sorted(document.parts, key=lambda p: p.order)]
        # psd-tools yields layers bottom-up, which is draw order.
        assert ordered[0] == "thigh_left"
        assert ordered[-1] == "head"


class TestPipelineOnRealPsd:
    def test_produces_importable_files(self, character_psd: Path, tmp_path: Path) -> None:
        result = run_pipeline(character_psd, tmp_path / "out", name="character")

        assert result.problems == []
        skeleton_path = Path(result.skeleton_path)
        atlas_path = Path(result.atlas_path)
        page_path = Path(result.page_paths[0])
        assert skeleton_path.exists()
        assert atlas_path.exists()
        assert page_path.exists()

        # The page is a real image of the packed size.
        page = Image.open(page_path)
        assert page.mode == "RGBA"
        assert page.width >= 70

    def test_skeleton_is_well_formed(self, character_psd: Path, tmp_path: Path) -> None:
        result = run_pipeline(character_psd, tmp_path / "out", name="character")
        skeleton = json.loads(Path(result.skeleton_path).read_text(encoding="utf-8"))

        names = [bone["name"] for bone in skeleton["bones"]]
        assert names[0] == "root"
        # The chain to the hand's ancestors is complete.
        assert {"hip", "torso", "chest", "neck", "head", "arm_left", "thigh_left"} <= set(
            names
        )

        # Exactly one root, parents before children.
        assert sum(1 for bone in skeleton["bones"] if "parent" not in bone) == 1
        for index, bone in enumerate(skeleton["bones"]):
            if "parent" in bone:
                assert names.index(bone["parent"]) < index

    def test_atlas_regions_cover_every_attachment(
        self, character_psd: Path, tmp_path: Path
    ) -> None:
        result = run_pipeline(character_psd, tmp_path / "out", name="character")
        atlas_text = Path(result.atlas_path).read_text(encoding="utf-8")

        skeleton = json.loads(Path(result.skeleton_path).read_text(encoding="utf-8"))
        needed = set()
        for slot_attachments in skeleton["skins"][0]["attachments"].values():
            needed.update(slot_attachments.keys())

        for region in needed:
            assert f"\n{region}\n" in f"\n{atlas_text}", f"missing region {region}"

    def test_reports_virtual_bones(self, character_psd: Path, tmp_path: Path) -> None:
        result = run_pipeline(character_psd, tmp_path / "out", name="character")
        # The PSD has no hip/chest/neck layers, so those are virtual.
        assert {"root", "hip", "chest", "neck"} <= set(result.virtual_bones)

    def test_hidden_layers_are_skipped(self, tmp_path: Path) -> None:
        psd = PSDImage.new("RGBA", (100, 200))
        psd.append(
            PixelLayer.frompil(
                _solid(40, 80, (200, 60, 60, 255)), psd, layer_name="body", top=100, left=30
            )
        )
        hidden = PixelLayer.frompil(
            _solid(30, 30, (0, 0, 0, 255)), psd, layer_name="head", top=60, left=35
        )
        hidden.visible = False
        psd.append(hidden)
        path = tmp_path / "hidden.psd"
        psd.save(path)

        document = parse_psd(path)
        assert [part.raw_name for part in document.parts] == ["body"]
        assert any("hidden" in reason for _, reason in document.skipped)
