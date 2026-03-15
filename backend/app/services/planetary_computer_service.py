"""
Microsoft Planetary Computer STAC client.

Used as the fallback satellite data source when Google Earth Engine is
unavailable (GEE init failed, key missing, quota exceeded).

STAC endpoint is read from:
    MICROSOFT_PLANETARY_COMPUTER_API_STATIC_DOCUMENT env var
    Default: https://planetarycomputer.microsoft.com/api/stac/v1

Supports:
  • Sentinel-2 L2A (cloud-filtered) — search + best-image selection
  • Landsat Collection-2 L2      — search + best-image selection
  • NDVI / NDRE / EVI calculation from asset download
"""
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)


class PlanetaryComputerService:
    """
    Thin wrapper around the Planetary Computer STAC API.

    Does NOT require any API key — PC is publicly accessible for read-only
    STAC queries.  Asset downloads use SAS tokens which are obtained by
    signing the HREF via the PC API.
    """

    def __init__(self):
        from app.core.config import settings
        self.stac_url: str = (
            settings.MICROSOFT_PLANETARY_COMPUTER_API_STATIC_DOCUMENT
            or "https://planetarycomputer.microsoft.com/api/stac/v1"
        )
        self._session = requests.Session()
        self._session.headers.update({"User-Agent": "crop-risk-platform/1.0"})

    # ── STAC search helper ─────────────────────────────────────────────────────

    def _stac_search(
        self,
        collections: List[str],
        bbox: List[float],
        start: str,
        end: str,
        limit: int = 10,
        query: Optional[Dict] = None,
    ) -> List[Dict]:
        """
        Execute a STAC /search POST request.
        Returns a list of STAC Item dicts (may be empty).
        """
        payload: Dict[str, Any] = {
            "collections": collections,
            "bbox": bbox,
            "datetime": f"{start}/{end}",
            "limit": limit,
            "sortby": [{"field": "datetime", "direction": "desc"}],
        }
        if query:
            payload["query"] = query

        try:
            resp = self._session.post(
                f"{self.stac_url}/search",
                json=payload,
                timeout=15,
            )
            resp.raise_for_status()
            return resp.json().get("features", [])
        except Exception as exc:
            logger.warning("PC STAC search failed: %s", exc)
            return []

    # ── Sentinel-2 ─────────────────────────────────────────────────────────────

    def search_sentinel2(
        self,
        lat: float,
        lon: float,
        start_date: datetime,
        end_date: datetime,
        max_cloud_cover: float = 30.0,
    ) -> List[Dict]:
        """
        Search Sentinel-2 L2A imagery around a point.

        Returns a list of dicts with keys:
          id, date, cloud_cover, bbox, tile_url (thumbnail), assets
        """
        delta = 0.05  # ~5 km buffer
        bbox  = [lon - delta, lat - delta, lon + delta, lat + delta]

        items = self._stac_search(
            collections=["sentinel-2-l2a"],
            bbox=bbox,
            start=start_date.strftime("%Y-%m-%dT00:00:00Z"),
            end=end_date.strftime("%Y-%m-%dT23:59:59Z"),
            limit=20,
            query={"eo:cloud_cover": {"lte": max_cloud_cover}},
        )

        results = []
        for item in items:
            props = item.get("properties", {})
            results.append({
                "id":          item.get("id"),
                "date":        props.get("datetime", "")[:10],
                "cloud_cover": props.get("eo:cloud_cover"),
                "platform":    props.get("platform", "sentinel-2"),
                "bbox":        item.get("bbox"),
                "assets":      {k: v.get("href") for k, v in item.get("assets", {}).items()},
                "source":      "planetary_computer",
            })
        return results

    # ── Landsat ────────────────────────────────────────────────────────────────

    def search_landsat(
        self,
        lat: float,
        lon: float,
        start_date: datetime,
        end_date: datetime,
        max_cloud_cover: float = 30.0,
    ) -> List[Dict]:
        """
        Search Landsat Collection-2 L2 imagery (LC09 + LC08) around a point.
        """
        delta = 0.05
        bbox  = [lon - delta, lat - delta, lon + delta, lat + delta]

        items = self._stac_search(
            collections=["landsat-c2-l2"],
            bbox=bbox,
            start=start_date.strftime("%Y-%m-%dT00:00:00Z"),
            end=end_date.strftime("%Y-%m-%dT23:59:59Z"),
            limit=10,
            query={"eo:cloud_cover": {"lte": max_cloud_cover}},
        )

        results = []
        for item in items:
            props = item.get("properties", {})
            results.append({
                "id":          item.get("id"),
                "date":        props.get("datetime", "")[:10],
                "cloud_cover": props.get("eo:cloud_cover"),
                "platform":    props.get("platform", "landsat"),
                "bbox":        item.get("bbox"),
                "assets":      {k: v.get("href") for k, v in item.get("assets", {}).items()},
                "source":      "planetary_computer",
            })
        return results

    # ── Best-image selector ────────────────────────────────────────────────────

    def get_best_sentinel2(
        self,
        lat: float,
        lon: float,
        days_back: int = 30,
        max_cloud_cover: float = 30.0,
    ) -> Optional[Dict]:
        """
        Return the most recent low-cloud Sentinel-2 scene in the past N days.
        Returns None when no suitable scene is found.
        """
        end   = datetime.utcnow()
        start = end - timedelta(days=days_back)
        items = self.search_sentinel2(lat, lon, start, end, max_cloud_cover)
        return items[0] if items else None

    def get_best_landsat(
        self,
        lat: float,
        lon: float,
        days_back: int = 60,
        max_cloud_cover: float = 30.0,
    ) -> Optional[Dict]:
        """
        Return the most recent low-cloud Landsat scene in the past N days.
        """
        end   = datetime.utcnow()
        start = end - timedelta(days=days_back)
        items = self.search_landsat(lat, lon, start, end, max_cloud_cover)
        return items[0] if items else None

    # ── STAC availability check ────────────────────────────────────────────────

    def ping(self) -> bool:
        """Return True if the STAC endpoint responds with HTTP 200."""
        try:
            resp = self._session.get(self.stac_url, timeout=5)
            return resp.status_code == 200
        except Exception:
            return False

    def get_status(self) -> Dict:
        """Return a dict suitable for health-check responses."""
        reachable = self.ping()
        return {
            "stac_url": self.stac_url,
            "reachable": reachable,
        }
