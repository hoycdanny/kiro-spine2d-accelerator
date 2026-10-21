from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from spine_psd.loose_images import (
    DEFAULT_IMAGES_PATH,
    LOOSE_IMAGES_DIR_NAME,
    images_path_for,
    write_loose_images,
)


def _images() -> dict[str, Image.Image]:
    return {
        "head": Image.new("RGBA", (60, 90), (230, 200, 160, 255)),
        "torso": Image.new("RGBA", (80, 120), (200, 60, 60, 255)),
    }


class TestImagesPath:
    def test_the_default_matches_what_the_writer_emits(self) -> None:
        assert DEFAULT_IMAGES_PATH == "./images/"
        assert images_path_for(LOOSE_IMAGES_DIR_NAME) == DEFAULT_IMAGES_PATH


class TestWriteLooseImages:
    def test_writes_one_png_per_attachment_name(self, tmp_path: Path) -> None:
        result = write_loose_images(tmp_path, _images())

        folder = tmp_path / "images"
        assert Path(result.dir) == folder.resolve()
        assert sorted(path.name for path in folder.iterdir()) == ["head.png", "torso.png"]
        assert sorted(Path(path).name for path in result.paths) == [
            "head.png",
            "torso.png",
        ]
        assert result.removed == []

    def test_written_files_are_rgba_at_the_source_size(self, tmp_path: Path) -> None:
        images = _images()
        write_loose_images(tmp_path, images)

        for name, source in images.items():
            written = Image.open(tmp_path / "images" / f"{name}.png")
            assert written.mode == "RGBA"
            assert (written.width, written.height) == (source.width, source.height)

    def test_a_non_rgba_image_is_converted(self, tmp_path: Path) -> None:
        write_loose_images(tmp_path, {"head": Image.new("RGB", (20, 30), (1, 2, 3))})
        written = Image.open(tmp_path / "images" / "head.png")
        assert written.mode == "RGBA"
        assert (written.width, written.height) == (20, 30)

    def test_a_second_run_overwrites_matching_names(self, tmp_path: Path) -> None:
        write_loose_images(tmp_path, {"head": Image.new("RGBA", (20, 30))})
        result = write_loose_images(tmp_path, {"head": Image.new("RGBA", (40, 50))})

        written = Image.open(tmp_path / "images" / "head.png")
        assert (written.width, written.height) == (40, 50)
        assert result.removed == []

    def test_a_stale_png_is_pruned_and_reported(self, tmp_path: Path) -> None:
        folder = tmp_path / "images"
        folder.mkdir(parents=True)
        Image.new("RGBA", (10, 10)).save(folder / "cape.png")

        result = write_loose_images(tmp_path, _images())

        assert result.removed == ["cape.png"]
        assert not (folder / "cape.png").exists()
        assert (folder / "head.png").exists()

    def test_non_png_files_and_subdirectories_survive(self, tmp_path: Path) -> None:
        folder = tmp_path / "images"
        (folder / "sources").mkdir(parents=True)
        (folder / "notes.txt").write_text("keep me", encoding="utf-8")
        Image.new("RGBA", (10, 10)).save(folder / "sources" / "cape.png")

        result = write_loose_images(tmp_path, _images())

        assert result.removed == []
        assert (folder / "notes.txt").read_text(encoding="utf-8") == "keep me"
        assert (folder / "sources" / "cape.png").exists()

    def test_a_folder_name_escaping_the_output_directory_is_rejected(
        self, tmp_path: Path
    ) -> None:
        with pytest.raises(ValueError, match="outside the output directory"):
            write_loose_images(tmp_path / "out", _images(), dir_name="../elsewhere")

    def test_an_absolute_folder_name_is_rejected(self, tmp_path: Path) -> None:
        with pytest.raises(ValueError, match="outside the output directory"):
            write_loose_images(
                tmp_path / "out", _images(), dir_name=str(tmp_path / "elsewhere")
            )
