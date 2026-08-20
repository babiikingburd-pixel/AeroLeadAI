"""
Vision adapter. Split honestly into two tiers instead of one overclaiming
class:

- image_metadata(): REAL-NOW. Uses Pillow (already present in this
  environment) to genuinely open a file and report real properties —
  format, dimensions, mode. This is real evidence, not a simulation.
- describe_content(): NOT implemented here. Semantic image understanding
  (e.g. "is there hail damage in this photo") requires an actual vision
  model. Calling that path returns an explicit UNIMPLEMENTED result rather
  than a fabricated description — consistent with the Gatekeeper rule that
  a capability the engine doesn't actually have must never be simulated
  silently.
"""
from __future__ import annotations
from typing import Any, Dict

try:
    from PIL import Image
    _PIL_AVAILABLE = True
except ImportError:
    _PIL_AVAILABLE = False


class VisionAdapter:
    def image_metadata(self, path: str) -> Dict[str, Any]:
        if not _PIL_AVAILABLE:
            return {"success": False, "error": "Pillow not installed in this environment"}
        try:
            with Image.open(path) as img:
                return {
                    "success": True,
                    "format": img.format,
                    "size": img.size,
                    "mode": img.mode,
                }
        except Exception as exc:  # noqa: BLE001
            return {"success": False, "error": f"{type(exc).__name__}: {exc}"}

    def describe_content(self, path: str) -> Dict[str, Any]:
        return {
            "success": False,
            "implemented": False,
            "note": (
                "Semantic content description requires a vision-capable model. "
                "This adapter does not fabricate a description — plug in a real "
                "vision model call here to make this REAL-NOW instead of UNKNOWN."
            ),
        }
