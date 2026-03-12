"""
Farmer Advisory Engine.

Generates 3-5 plain-language daily tips for smallholder farmers, based on:
  - Current farm risk score (disease, weather, vegetation anomaly)
  - Recent disease scan results
  - Weather conditions (rainfall, temperature, humidity)
  - Crop growth stage (days after planting)
  - Historical disease patterns for the region

Design principles for African smallholder UX:
  - Plain English, no technical jargon
  - Concrete actions (not vague warnings)
  - Emojis as visual anchors on small screens
  - Maximum 200 characters per message
  - Prioritized: urgent first, info last
"""
import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ── Advisory data class ────────────────────────────────────────────────────────

@dataclass
class Advisory:
    """A single actionable tip for the farmer."""
    category: str           # 'disease' | 'weather' | 'irrigation' | 'harvest' | 'general'
    priority: str           # 'urgent' | 'important' | 'info'
    title: str              # ≤ 60 chars — shown in notification
    message: str            # ≤ 200 chars — full tip text
    emoji: str = ""         # Visual anchor for mobile display
    days_valid: int = 1     # Relevance window in days


# ── Disease action lookup ──────────────────────────────────────────────────────
# Plain-language responses to diseases detected by the image classifier.
# Keys are lowercase substrings that match disease names returned by the model.

DISEASE_ACTIONS: Dict[str, Dict] = {
    "late blight": {
        "title": "Late Blight Risk — Act Now",
        "message": "Spray Mancozeb or copper fungicide on all leaves today. Work when leaves are dry. Repeat in 7 days.",
        "emoji": "🍄",
        "priority": "urgent",
        "days_valid": 3,
    },
    "early blight": {
        "title": "Early Blight Warning",
        "message": "Remove lower spotted leaves and bag them. Apply fungicide before next rain. Keep plants well-spaced.",
        "emoji": "🌿",
        "priority": "urgent",
        "days_valid": 3,
    },
    "bacterial spot": {
        "title": "Bacterial Spot Detected",
        "message": "Stop overhead irrigation immediately. Apply copper spray. Remove badly infected branches.",
        "emoji": "💧",
        "priority": "urgent",
        "days_valid": 2,
    },
    "leaf miner": {
        "title": "Leaf Miners Found",
        "message": "Remove tunnelled leaves. Apply neem oil or spinosad spray. Yellow sticky traps help monitor numbers.",
        "emoji": "🐛",
        "priority": "important",
        "days_valid": 4,
    },
    "mosaic virus": {
        "title": "Viral Disease Detected",
        "message": "Pull out and destroy infected plants — do not compost. Control aphids and whiteflies which spread the virus.",
        "emoji": "🦠",
        "priority": "urgent",
        "days_valid": 2,
    },
    "rust": {
        "title": "Rust Disease Spotted",
        "message": "Apply triazole or mancozeb fungicide immediately. Avoid watering in the evening. Remove severely infected leaves.",
        "emoji": "🟠",
        "priority": "urgent",
        "days_valid": 3,
    },
    "powdery mildew": {
        "title": "Powdery Mildew Found",
        "message": "Spray sulfur or potassium bicarbonate in the morning. Prune to improve airflow between plants.",
        "emoji": "⬜",
        "priority": "important",
        "days_valid": 4,
    },
    "leaf curl": {
        "title": "Leaf Curl Noticed",
        "message": "Check for aphids or mites under curled leaves. Apply insecticidal soap if pests are present.",
        "emoji": "🌀",
        "priority": "important",
        "days_valid": 3,
    },
    "gray mold": {
        "title": "Gray Mold (Botrytis) Risk",
        "message": "Improve airflow. Remove infected plant material carefully. Apply fungicide in dry weather.",
        "emoji": "🩶",
        "priority": "urgent",
        "days_valid": 2,
    },
    "fall armyworm": {
        "title": "Fall Armyworm Found",
        "message": "Check leaf whorls at dawn — armyworms feed at night. Apply spinosad or Bt spray early morning.",
        "emoji": "🐛",
        "priority": "urgent",
        "days_valid": 2,
    },
    "stem borer": {
        "title": "Stem Borer Activity",
        "message": "Look for dead hearts or frass at base. Apply recommended insecticide into the leaf whorl.",
        "emoji": "🪱",
        "priority": "urgent",
        "days_valid": 2,
    },
}

# ── Crop growth stage messages ─────────────────────────────────────────────────
# Context-aware tips based on the crop's current development phase.

STAGE_TIPS: Dict[str, Dict[str, str]] = {
    "potato": {
        "germination":    "Potato seeds sprouting. Keep soil moist but not waterlogged. Watch for late blight in cool wet weather.",
        "seedling":       "Young potato plants. Protect from frost and heavy rain. Thin to one strong shoot per hill.",
        "vegetative":     "Potato plants growing fast. Hilling now improves tuber yield. Scout for blight every 5 days.",
        "tuberization":   "Tubers forming — most critical stage. High late blight risk. Do not miss fungicide spray windows.",
        "maturity":       "Potatoes nearly ready. Reduce watering. Watch for tuber rot. Harvest before extended rains.",
    },
    "maize": {
        "germination":    "Maize germinating. Protect seeds from birds. Check for damping-off if soil stays wet.",
        "vegetative":     "Maize growing fast. Check inside leaf whorls for fall armyworm frass daily.",
        "silking":        "Maize flowering — do NOT spray insecticides now (kills pollinators). Scout for rust on leaves.",
        "grain_fill":     "Grain filling. Protect from stalk borers. Ensure soil moisture for good grain weight.",
        "maturity":       "Maize nearly ready. Watch for aflatoxin mould risk if rains delay harvest.",
    },
    "tomato": {
        "seedling":       "Tomato seedlings. Harden off before transplanting. Water at base — not on leaves.",
        "vegetative":     "Tomato growing. Stake plants now. Pinch suckers to focus energy on fruit.",
        "flowering":      "Tomato flowering — high blight risk period. Inspect leaves daily. Spray fungicide after rain.",
        "fruiting":       "Fruit setting. Reduce nitrogen fertiliser. Scout for bacterial canker and early blight.",
        "maturity":       "Tomatoes ripening. Harvest at first sign of colour to reduce rot and cracking.",
    },
    "beans": {
        "germination":    "Beans germinating. Avoid waterlogging. Check for bean fly damage at cotyledon stage.",
        "vegetative":     "Beans growing. Watch for angular leaf spot brown spots. Remove infected leaves.",
        "flowering":      "Beans flowering. Do NOT spray insecticides now. Water consistently for good pod set.",
        "pod_fill":       "Pods filling. Watch for pod borers. Reduce watering as pods mature.",
        "maturity":       "Beans ready to harvest. Harvest when pods rustle. Dry well before storing to prevent mould.",
    },
    "coffee": {
        "vegetative":     "Coffee growing. Prune dead branches. Watch for coffee berry disease (CBD) on green berries.",
        "flowering":      "Coffee flowering. Ensure adequate moisture for good berry set.",
        "berry_fill":     "Berries filling. Scout for CBD and leaf rust. Apply copper fungicide after rain.",
        "maturity":       "Coffee berries ripening. Harvest only red ripe berries. Process quickly to avoid fermentation.",
    },
    "cassava": {
        "establishment":  "Cassava establishing. Ensure good stem contact with soil. Watch for cassava mosaic disease.",
        "vegetative":     "Cassava growing. Remove mosaic-infected plants immediately to stop spread.",
        "maturity":       "Cassava ready 9-12 months. Harvest before wet season to reduce root rot.",
    },
}

# ── DAP stage boundaries (Days After Planting) ────────────────────────────────

CROP_STAGES: Dict[str, List[tuple]] = {
    # (dap_start, dap_end, stage_name)
    "potato":  [(0, 14, "germination"), (14, 40, "seedling"), (40, 70, "vegetative"),
                (70, 100, "tuberization"), (100, 130, "maturity")],
    "maize":   [(0, 12, "germination"), (12, 40, "vegetative"), (40, 70, "silking"),
                (70, 100, "grain_fill"), (100, 130, "maturity")],
    "tomato":  [(0, 25, "seedling"), (25, 50, "vegetative"), (50, 75, "flowering"),
                (75, 105, "fruiting"), (105, 130, "maturity")],
    "beans":   [(0, 10, "germination"), (10, 30, "vegetative"), (30, 55, "flowering"),
                (55, 70, "pod_fill"), (70, 90, "maturity")],
    "coffee":  [(0, 60, "vegetative"), (60, 90, "flowering"), (90, 180, "berry_fill"),
                (180, 270, "maturity")],
    "cassava": [(0, 60, "establishment"), (60, 300, "vegetative"), (300, 400, "maturity")],
}


# ── Main engine ────────────────────────────────────────────────────────────────

class FarmerAdvisoryEngine:
    """
    Generates prioritized daily advisory tips for one farm.

    All public methods return plain Python dicts or Advisory objects
    (no SQLAlchemy types) so they are safe to serialize to JSON.
    """

    def generate(
        self,
        farm: Any,
        risk_result: Optional[Dict] = None,
        weather: Optional[Dict] = None,
        recent_scans: Optional[List[Dict]] = None,
        db: Any = None,
    ) -> List[Advisory]:
        """
        Generate up to 5 prioritized advisories for a single farm.

        Args:
            farm:          SQLAlchemy Farm object or plain dict.
            risk_result:   Output from EnsembleRiskScorer.calculate_risk().
            weather:       Dict with keys: rainfall_7d, temp_max, humidity, forecast_rain_days.
            recent_scans:  List of DiseaseClassification dicts (disease, is_healthy, confidence).
            db:            SQLAlchemy session (optional, for future historical queries).

        Returns:
            List[Advisory] sorted urgent → important → info, max 5 items.
        """
        advisories: List[Advisory] = []

        crop_type = self._resolve_crop(farm)
        planting_date = self._resolve_planting_date(farm)

        # --- 1. Disease scan advisories (highest priority) --------------------
        if recent_scans:
            advisories.extend(self._from_recent_scans(recent_scans))

        # --- 2. Risk-score advisories ----------------------------------------
        if risk_result:
            advisories.extend(self._from_risk_score(risk_result, crop_type))

        # --- 3. Weather advisories -------------------------------------------
        if weather:
            advisories.extend(self._from_weather(weather, crop_type))

        # --- 4. Growth stage advisory ----------------------------------------
        if crop_type and planting_date:
            tip = self._from_growth_stage(crop_type, planting_date)
            if tip:
                advisories.append(tip)

        # --- 5. Fallback — always show at least 2 tips -----------------------
        if len(advisories) < 2:
            advisories.extend(self._general_tips(crop_type))

        # --- Deduplicate and sort -------------------------------------------
        seen: set = set()
        unique: List[Advisory] = []
        for adv in advisories:
            if adv.title not in seen:
                seen.add(adv.title)
                unique.append(adv)

        order = {"urgent": 0, "important": 1, "info": 2}
        unique.sort(key=lambda a: order.get(a.priority, 2))
        return unique[:5]

    # ── Serialisation helper ──────────────────────────────────────────────────

    def to_api_response(self, advisories: List[Advisory]) -> List[Dict]:
        """Convert Advisory objects to JSON-serialisable dicts."""
        return [
            {
                "category": a.category,
                "priority": a.priority,
                "title": a.title,
                "message": a.message,
                "emoji": a.emoji,
                "days_valid": a.days_valid,
            }
            for a in advisories
        ]

    # ── Private generators ────────────────────────────────────────────────────

    def _from_recent_scans(self, scans: List[Dict]) -> List[Advisory]:
        """Turn recent disease scan results into actionable tips."""
        advisories: List[Advisory] = []
        for scan in scans[:3]:
            if scan.get("is_healthy"):
                continue
            disease = (scan.get("disease") or "").lower()
            confidence = float(scan.get("confidence", 0))
            if confidence < 0.35:
                continue  # Too uncertain to act on

            action = None
            for key, info in DISEASE_ACTIONS.items():
                if key in disease:
                    action = info
                    break

            if action:
                advisories.append(Advisory(
                    category="disease",
                    priority=action["priority"],
                    title=action["title"],
                    message=action["message"],
                    emoji=action["emoji"],
                    days_valid=action["days_valid"],
                ))
            else:
                plant = scan.get("plant", "crop")
                advisories.append(Advisory(
                    category="disease",
                    priority="important",
                    title=f"Disease on {plant.capitalize()}",
                    message=(
                        f"{scan.get('disease', 'Unknown disease')} detected on your {plant}. "
                        "Consult your agronomist if symptoms spread to more plants."
                    ),
                    emoji="⚠️",
                    days_valid=2,
                ))

        return advisories

    def _from_risk_score(self, risk_result: Dict, crop_type: str) -> List[Advisory]:
        """Turn ensemble risk score into farm-wide advisories."""
        advisories: List[Advisory] = []
        risk_level = risk_result.get("risk_level", "low")
        components = risk_result.get("components", {})
        score = float(risk_result.get("overall_risk_score", 0))

        if risk_level == "critical":
            advisories.append(Advisory(
                category="disease",
                priority="urgent",
                title="URGENT: Your Farm Needs Attention",
                message=(
                    "Multiple risk factors are at critical levels. "
                    "Visit your field today. Contact your agricultural extension officer."
                ),
                emoji="🔴",
                days_valid=1,
            ))

        elif risk_level == "high":
            advisories.append(Advisory(
                category="disease",
                priority="urgent",
                title="High Risk — Inspect Your Crops Today",
                message=(
                    "Your farm shows high disease and stress risk. "
                    "Walk through your field and look for early signs of disease or wilting."
                ),
                emoji="🟠",
                days_valid=1,
            ))

        if components.get("disease_risk", 0) > 55:
            advisories.append(Advisory(
                category="disease",
                priority="urgent" if score > 65 else "important",
                title="Disease Conditions Are Favorable",
                message=(
                    "Weather is ideal for disease spread right now. "
                    "Apply preventive fungicide and inspect leaves daily."
                ),
                emoji="💊",
                days_valid=3,
            ))

        if components.get("weather_stress", 0) > 60:
            advisories.append(Advisory(
                category="weather",
                priority="important",
                title="Weather Stress on Your Crops",
                message=(
                    f"Your {crop_type or 'crops'} may be stressed by recent weather conditions. "
                    "Check soil moisture and watch for wilting or leaf scorch."
                ),
                emoji="🌡️",
                days_valid=2,
            ))

        if components.get("vegetation_anomaly", 0) > 55:
            advisories.append(Advisory(
                category="general",
                priority="important",
                title="Unusual Change in Field Health",
                message=(
                    "Satellite data shows a change in your field's health score. "
                    "Walk the field and check for patches of yellowing or dead plants."
                ),
                emoji="🛰️",
                days_valid=2,
            ))

        return advisories

    def _from_weather(self, weather: Dict, crop_type: str) -> List[Advisory]:
        """Turn raw weather data into practical tips."""
        advisories: List[Advisory] = []
        rainfall_7d = float(weather.get("rainfall_7d", weather.get("rainfall", 0)))
        temp_max = float(weather.get("temp_max", 25))
        humidity = float(weather.get("humidity", 65))
        forecast_rain = int(weather.get("forecast_rain_days", 0))

        # Dry spell
        if rainfall_7d < 10:
            advisories.append(Advisory(
                category="irrigation",
                priority="important",
                title="Dry Spell — Water Your Crops",
                message=(
                    f"Only {rainfall_7d:.0f} mm rain in 7 days. "
                    f"Irrigate your {crop_type or 'crops'} — water at base of plants early morning."
                ),
                emoji="💧",
                days_valid=2,
            ))

        # Rain coming — optimal spray window
        if forecast_rain >= 2 and humidity > 72:
            advisories.append(Advisory(
                category="disease",
                priority="important",
                title="Spray Now — Rain Coming in 2-3 Days",
                message=(
                    "Rain is forecast soon. Apply fungicide today so it dries on the leaves "
                    "before rain washes it off."
                ),
                emoji="🌧️",
                days_valid=2,
            ))

        # Heat stress
        if temp_max > 34:
            advisories.append(Advisory(
                category="weather",
                priority="important",
                title=f"Heat Alert — {temp_max:.0f}°C Expected",
                message=(
                    "Very hot day expected. Water your crops early morning. "
                    "Add mulch around stems to keep roots cool."
                ),
                emoji="☀️",
                days_valid=1,
            ))

        # Fungal risk from high humidity
        if humidity > 85 and rainfall_7d > 30:
            advisories.append(Advisory(
                category="disease",
                priority="important",
                title="High Humidity — Fungal Disease Risk",
                message=(
                    "Hot and humid conditions favour mould and blight. "
                    "Ensure plants are not overcrowded. Check leaves for early spots."
                ),
                emoji="🌫️",
                days_valid=3,
            ))

        return advisories

    def _from_growth_stage(self, crop_type: str, planting_date: Any) -> Optional[Advisory]:
        """Return a stage-specific tip based on days-after-planting."""
        try:
            if isinstance(planting_date, str):
                planting_date = date.fromisoformat(planting_date[:10])
            elif isinstance(planting_date, datetime):
                planting_date = planting_date.date()

            dap = (date.today() - planting_date).days
            if dap < 0:
                return None

            stage = self._dap_to_stage(crop_type.lower(), dap)
            if not stage:
                return None

            tips = STAGE_TIPS.get(crop_type.lower(), {})
            message = tips.get(stage)
            if not message:
                return None

            return Advisory(
                category="general",
                priority="info",
                title=f"{crop_type.capitalize()} — {stage.replace('_', ' ').title()} Stage",
                message=message,
                emoji="🌱",
                days_valid=7,
            )
        except Exception as e:
            logger.debug(f"Growth stage advisory failed: {e}")
            return None

    def _general_tips(self, crop_type: str) -> List[Advisory]:
        """Fallback good-practice tips when no specific signals are available."""
        return [
            Advisory(
                category="general",
                priority="info",
                title="Inspect Your Crop Twice a Week",
                message=(
                    "Walk through your field every 3-4 days. "
                    "Check leaves top and bottom for spots, holes, colour changes, or wilting."
                ),
                emoji="👀",
                days_valid=3,
            ),
            Advisory(
                category="general",
                priority="info",
                title="Take Weekly Crop Photos",
                message=(
                    "Photograph your crops from the same spot each week. "
                    "This helps track changes and get accurate advice."
                ),
                emoji="📷",
                days_valid=7,
            ),
        ]

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _resolve_crop(self, farm: Any) -> str:
        """Extract crop_type from a Farm ORM object or plain dict."""
        ct = (
            getattr(farm, "crop_type", None)
            or (farm.get("crop_type") if isinstance(farm, dict) else None)
            or "crop"
        )
        return str(ct).lower().split(",")[0].strip()

    def _resolve_planting_date(self, farm: Any) -> Optional[Any]:
        """Extract planting_date from ORM object or dict."""
        return (
            getattr(farm, "planting_date", None)
            or (farm.get("planting_date") if isinstance(farm, dict) else None)
        )

    def _dap_to_stage(self, crop_type: str, dap: int) -> Optional[str]:
        """Map days-after-planting to the crop's current growth stage name."""
        for start, end, stage in CROP_STAGES.get(crop_type, []):
            if start <= dap < end:
                return stage
        return None
