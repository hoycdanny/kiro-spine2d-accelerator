"""JSON-over-stdio entry point.

The sidecar is not an MCP server: the TypeScript execution layer owns the
single tool surface and calls this process with one JSON request on stdin,
expecting one JSON response on stdout. Keeping it that way means there is
one place that enforces capability gates and path safety.

Request:
    {"command": "psd_to_skeleton", "psdPath": "...", "outDir": "...",
     "name": "hero", "padding": 2, "maxSize": 4096,
     "premultipliedAlpha": false, "emitLooseImages": true}
    {"command": "probe"}

`emitLooseImages` defaults to true and writes the loose per-attachment PNGs
the Spine editor's `File -> Import Data` resolves; the response then carries
`imagesDir`, `imagePaths`, `staleImagesRemoved` (own PNGs from an earlier run
that the current rig no longer needs) and `foreignImagesKept` (PNGs in that
folder the tool does not own, reported but never deleted).

Response:
    {"ok": true, "data": {..., "imagesDir": ".../out/images",
     "imagePaths": [".../out/images/head.png"], "staleImagesRemoved": [],
     "foreignImagesKept": ["cape.png"]}}
    {"ok": false, "error": {"code": "...", "message": "...", "hint": "..."}}

Diagnostics go to stderr so stdout stays parseable.
"""

from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path
from typing import Any

from .pipeline import run_pipeline

PROTOCOL_VERSION = 1


def _error(code: str, message: str, hint: str) -> dict[str, Any]:
    return {"ok": False, "error": {"code": code, "message": message, "hint": hint}}


def handle_probe() -> dict[str, Any]:
    """Report the sidecar's readiness, including optional dependencies."""
    missing: list[str] = []
    versions: dict[str, str] = {}

    for module, label in (
        ("psd_tools", "psd-tools"),
        ("PIL", "Pillow"),
        ("rectpack", "rectpack"),
    ):
        try:
            imported = __import__(module)
            versions[label] = getattr(imported, "__version__", "unknown")
        except Exception:  # noqa: BLE001 - any import failure means unusable
            missing.append(label)

    return {
        "ok": True,
        "data": {
            "protocolVersion": PROTOCOL_VERSION,
            "python": sys.version.split()[0],
            "dependencies": versions,
            "missing": missing,
            "ready": not missing,
        },
    }


def handle_psd_to_skeleton(request: dict[str, Any]) -> dict[str, Any]:
    psd_path = request.get("psdPath")
    out_dir = request.get("outDir")

    if not isinstance(psd_path, str) or not psd_path:
        return _error(
            "INVALID_ARGUMENT",
            "psdPath is required.",
            "Pass the path of the PSD to convert.",
        )
    if not isinstance(out_dir, str) or not out_dir:
        return _error(
            "INVALID_ARGUMENT",
            "outDir is required.",
            "Pass the directory the generated files should be written to.",
        )
    if not Path(psd_path).exists():
        return _error(
            "INPUT_MISSING",
            f"PSD not found: {psd_path}",
            "Check the path.",
        )

    try:
        result = run_pipeline(
            psd_path,
            out_dir,
            name=request.get("name") or None,
            padding=int(request.get("padding", 2)),
            max_size=int(request.get("maxSize", 4096)),
            premultiplied_alpha=bool(request.get("premultipliedAlpha", False)),
            emit_loose_images=bool(request.get("emitLooseImages", True)),
        )
    except ModuleNotFoundError as error:
        return _error(
            "DEPENDENCY_MISSING",
            f"A sidecar dependency is missing: {error.name}",
            "Install the sidecar dependencies: uv sync --project python",
        )
    except ValueError as error:
        return _error("VALIDATION_FAILED", str(error), "Adjust the inputs and retry.")

    if result.problems:
        return _error(
            "VALIDATION_FAILED",
            "The generated skeleton failed structural validation: "
            + "; ".join(result.problems),
            "This is a bug in the generator or an unusual PSD. The files were still written "
            "so the output can be inspected.",
        )

    return {
        "ok": True,
        "data": {
            "skeletonPath": result.skeleton_path,
            "atlasPath": result.atlas_path,
            "pagePaths": result.page_paths,
            "boneCount": result.bone_count,
            "slotCount": result.slot_count,
            "attachmentCount": result.attachment_count,
            "regionNames": result.region_names,
            "virtualBones": result.virtual_bones,
            "unmappedLayers": result.unmapped_layers,
            "warnings": result.warnings,
            "imagesDir": result.images_dir,
            "imagePaths": result.image_paths,
            "staleImagesRemoved": result.stale_images_removed,
            "foreignImagesKept": result.foreign_images_kept,
        },
    }


def handle(request: dict[str, Any]) -> dict[str, Any]:
    command = request.get("command")
    if command == "probe":
        return handle_probe()
    if command == "psd_to_skeleton":
        return handle_psd_to_skeleton(request)
    return _error(
        "INVALID_ARGUMENT",
        f"Unknown command: {command!r}",
        'Use "probe" or "psd_to_skeleton".',
    )


def main() -> int:
    raw = sys.stdin.read()
    try:
        request = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as error:
        print(
            json.dumps(
                _error(
                    "PARSE_FAILED",
                    f"Request is not valid JSON: {error}",
                    "Send a single JSON object on stdin.",
                )
            )
        )
        return 1

    if not isinstance(request, dict):
        print(
            json.dumps(
                _error(
                    "PARSE_FAILED",
                    "Request must be a JSON object.",
                    "Send a single JSON object on stdin.",
                )
            )
        )
        return 1

    try:
        response = handle(request)
    except Exception as error:  # noqa: BLE001 - last resort, must stay parseable
        traceback.print_exc(file=sys.stderr)
        response = _error(
            "SIDECAR_FAILED",
            f"Unexpected sidecar failure: {error}",
            "The traceback was written to stderr. Report it with the PSD that triggered it.",
        )

    print(json.dumps(response))
    return 0 if response.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
