"""
Image Quality Gate for crop disease detection.

Runs before inference to reject or flag poor-quality photos from the field.
Prevents wasted server compute and misleading low-confidence predictions.

Checks performed (no OpenCV required — uses only PIL + numpy):
  - Blur detection via pixel-gradient variance
  - Brightness (too dark or overexposed)
  - Minimum resolution
  - Color saturation (rejects near-grayscale images)
"""
import logging
from typing import Dict, Any, List
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)


class ImageQualityChecker:
    """
    Validates uploaded images before running disease inference.

    Thresholds are calibrated for typical sub-Saharan field phone photos
    (mid-range Android camera, outdoor lighting, leaf close-ups).
    """

    # ── Thresholds ─────────────────────────────────────────────────────────────
    BLUR_THRESHOLD = 60.0       # pixel-gradient variance; below = too blurry
    MIN_BRIGHTNESS = 35.0       # mean grayscale 0-255; below = too dark
    MAX_BRIGHTNESS = 235.0      # above = overexposed / washed out
    MIN_WIDTH = 80              # minimum pixels wide
    MIN_HEIGHT = 80             # minimum pixels tall
    MIN_COLOR_STD = 8.0         # RGB channel std; below = nearly grayscale

    # ── Farmer-facing feedback messages ────────────────────────────────────────
    MESSAGES = {
        "too_small":    "Photo is too small. Move closer to the crop and retake.",
        "too_dark":     "Photo is too dark. Take photo in daylight or open shade.",
        "overexposed":  "Photo is overexposed. Avoid direct sunlight on the lens.",
        "too_blurry":   "Photo is blurry. Hold your phone steady and tap the leaf to focus.",
        "grayscale":    "Photo appears to be black-and-white. Use a color camera.",
        "ok":           "Image quality is good.",
    }

    def check(self, image_path: str) -> Dict[str, Any]:
        """
        Run all quality checks on an image file.

        Args:
            image_path: Absolute path to the saved image.

        Returns:
            {
                "acceptable":       bool   — True if all blocking checks pass.
                "feedback":         str    — Plain-language message for the farmer.
                "warnings":         list   — Non-blocking issues (still run inference).
                "blocking_issues":  list   — Issues that prevent reliable inference.
                "checks": {
                    "size":       { width, height, passed }
                    "brightness": { mean, passed }
                    "blur":       { score, passed }
                    "color":      { score, passed }
                }
            }
        """
        try:
            from PIL import Image, ImageFilter
        except ImportError:
            logger.warning("Pillow not installed — image quality check skipped")
            return self._skip_result("Pillow not available")

        try:
            img = Image.open(image_path).convert("RGB")
        except Exception as e:
            logger.error(f"Quality check: cannot open image: {e}")
            return {
                "acceptable": False,
                "feedback": "Could not open the image. Please try a different photo.",
                "warnings": [],
                "blocking_issues": ["Cannot open image file"],
                "checks": {},
            }

        img_np = np.array(img, dtype=np.float32)
        checks: Dict[str, Any] = {}
        blocking: List[str] = []
        warnings: List[str] = []

        # ── 1. Size ────────────────────────────────────────────────────────────
        w, h = img.size
        size_ok = w >= self.MIN_WIDTH and h >= self.MIN_HEIGHT
        checks["size"] = {"width": w, "height": h, "passed": size_ok}
        if not size_ok:
            blocking.append(self.MESSAGES["too_small"])

        # ── 2. Brightness ──────────────────────────────────────────────────────
        gray_mean = float(np.mean(img_np))
        brightness_ok = self.MIN_BRIGHTNESS <= gray_mean <= self.MAX_BRIGHTNESS
        checks["brightness"] = {"mean": round(gray_mean, 1), "passed": brightness_ok}
        if gray_mean < self.MIN_BRIGHTNESS:
            blocking.append(self.MESSAGES["too_dark"])
        elif gray_mean > self.MAX_BRIGHTNESS:
            # Overexposed — warn but don't block (model often still works)
            warnings.append(self.MESSAGES["overexposed"])

        # ── 3. Blur — pixel gradient variance (no OpenCV needed) ───────────────
        gray_img = img.convert("L")
        gray_np = np.array(gray_img, dtype=np.float32)
        # Gradient along both axes
        dy = np.diff(gray_np, axis=0)
        dx = np.diff(gray_np, axis=1)
        blur_score = float(np.var(dy) + np.var(dx))
        blur_score = min(blur_score, 50000.0)   # cap outliers from solid-colour patches
        blur_ok = blur_score >= self.BLUR_THRESHOLD
        checks["blur"] = {"score": round(blur_score, 1), "passed": blur_ok}
        if not blur_ok:
            blocking.append(self.MESSAGES["too_blurry"])

        # ── 4. Color saturation ────────────────────────────────────────────────
        r_std = float(np.std(img_np[:, :, 0]))
        g_std = float(np.std(img_np[:, :, 1]))
        b_std = float(np.std(img_np[:, :, 2]))
        color_score = (r_std + g_std + b_std) / 3.0
        color_ok = color_score >= self.MIN_COLOR_STD
        checks["color"] = {"score": round(color_score, 1), "passed": color_ok}
        if not color_ok:
            warnings.append(self.MESSAGES["grayscale"])

        # ── Final verdict ──────────────────────────────────────────────────────
        acceptable = len(blocking) == 0
        if blocking:
            feedback = blocking[0]                  # Surface the first blocking issue
        elif warnings:
            feedback = "Image accepted with warnings: " + warnings[0]
        else:
            feedback = self.MESSAGES["ok"]

        return {
            "acceptable": acceptable,
            "feedback": feedback,
            "warnings": warnings,
            "blocking_issues": blocking,
            "checks": checks,
        }

    # ── Helpers ────────────────────────────────────────────────────────────────

    def _skip_result(self, reason: str) -> Dict[str, Any]:
        """Return a permissive result when the check itself cannot run."""
        return {
            "acceptable": True,
            "feedback": reason,
            "warnings": [reason],
            "blocking_issues": [],
            "checks": {},
        }

    def check_bytes(self, image_bytes: bytes, suffix: str = ".jpg") -> Dict[str, Any]:
        """
        Run quality check on raw image bytes (e.g., from UploadFile.read()).
        Writes to a temp file, checks, then cleans up.
        """
        import tempfile
        import os

        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(image_bytes)
            tmp_path = tmp.name

        try:
            return self.check(tmp_path)
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
