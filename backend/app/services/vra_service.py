"""
Variable Rate Application (VRA) Service
=========================================
Generates prescription maps from productivity zones + NDVI data.

Prescription types:
  fertilizer : high zones → 75 % of base rate; low zones → 130 %
               (boost underperforming zones with more nutrients)
  seeding    : high zones → 100 %; low zones → 85 %
               (reduce seed density in poor conditions)
  chemical   : high zones → 65 % (low stress); low zones → 140 %
               (spray more where NDVI shows stress)

Output: VraMap record with GeoJSON FeatureCollection + ISOXML-lite export.
"""
from datetime import datetime
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.models.precision_ag import VraMap, PrescriptionType
from app.models.geo_intelligence import ProductivityZone

# ─── Rate multipliers ─────────────────────────────────────────────────────────

RATE_MULTIPLIERS = {
    PrescriptionType.fertilizer: {"high": 0.75, "medium": 1.00, "low": 1.30},
    PrescriptionType.seeding:    {"high": 1.00, "medium": 0.95, "low": 0.85},
    PrescriptionType.chemical:   {"high": 0.65, "medium": 1.00, "low": 1.40},
}

# In VRA, blue = save product (productive zone needs less input),
# red = apply more (underperforming zone needs intervention)
ZONE_FILL = {
    "high":   "#1565C0",
    "medium": "#F57F17",
    "low":    "#B71C1C",
}


def _geometry_to_geojson(geom_col) -> Optional[dict]:
    """Convert a GeoAlchemy2 WKBElement to a GeoJSON geometry dict."""
    try:
        from shapely import wkb
        import json
        shape = wkb.loads(bytes(geom_col.data))
        return json.loads(shape.to_wkt())          # fallback str representation
    except Exception:
        pass
    try:
        from shapely import wkb
        shape = wkb.loads(bytes(geom_col.data))
        return shape.__geo_interface__
    except Exception:
        return None


def generate_vra_map(
    farm_id: int,
    prescription_type: str,
    base_rate: float,
    product_name: str,
    season_id: Optional[int],
    db: Session,
) -> VraMap:
    """Pull stored productivity zones → apply rate logic → persist VraMap."""
    ptype = PrescriptionType(prescription_type)
    mults = RATE_MULTIPLIERS[ptype]

    zones = (
        db.query(ProductivityZone)
        .filter(ProductivityZone.farm_id == farm_id)
        .order_by(desc(ProductivityZone.computed_at))
        .all()
    )

    if not zones:
        raise ValueError(
            f"No productivity zones for farm {farm_id}. "
            "Run POST /geo/farms/{farm_id}/zones/compute first."
        )

    features    = []
    flat_total  = 0.0
    vra_total   = 0.0
    zone_rates  = {}

    for zone in zones:
        cls  = zone.zone_class
        mult = mults.get(cls, 1.0)
        rate = round(base_rate * mult, 2)
        area = zone.area_ha or 0.0

        zone_rates[cls] = rate
        flat_total += base_rate * area
        vra_total  += rate * area

        geo = _geometry_to_geojson(zone.boundary) if zone.boundary else None

        features.append({
            "type": "Feature",
            "geometry": geo,
            "properties": {
                "zone_class":        cls,
                "mean_ndvi":         zone.mean_ndvi,
                "area_ha":           round(area, 3),
                "prescription_rate": rate,
                "rate_unit":         "L/ha" if ptype == PrescriptionType.chemical else "kg/ha",
                "product_name":      product_name,
                "fill_color":        ZONE_FILL.get(cls, "#888"),
                "multiplier":        mult,
            },
        })

    savings_pct      = round((1 - vra_total / flat_total) * 100, 1) if flat_total else 0.0
    total_product_kg = round(vra_total, 1)

    zones_geojson = {"type": "FeatureCollection", "features": features}
    rates_json = {
        cls: {
            "rate":       zone_rates.get(cls),
            "multiplier": mults.get(cls, 1.0),
            "area_ha":    round(sum((z.area_ha or 0) for z in zones if z.zone_class == cls), 3),
        }
        for cls in ["high", "medium", "low"]
    }

    # Keep last 5 VRA maps per farm per prescription type
    existing = (
        db.query(VraMap)
        .filter(VraMap.farm_id == farm_id, VraMap.prescription_type == ptype)
        .order_by(VraMap.generated_at)
        .all()
    )
    if len(existing) >= 5:
        db.delete(existing[0])

    vra = VraMap(
        farm_id=farm_id,
        season_id=season_id,
        prescription_type=ptype,
        zones_geojson=zones_geojson,
        rates_json=rates_json,
        product_name=product_name,
        base_rate=base_rate,
        high_zone_rate=zone_rates.get("high",   base_rate),
        medium_zone_rate=zone_rates.get("medium", base_rate),
        low_zone_rate=zone_rates.get("low",    base_rate),
        total_product_kg=total_product_kg,
        savings_pct=savings_pct,
    )
    db.add(vra)
    db.commit()
    db.refresh(vra)
    return vra


def export_isoxml(vra: VraMap) -> str:
    """
    Return a simplified ISOXML (ISO 11783-10) XML string.
    Full ISOXML compliance requires licensed tools; this covers the
    essential TSK/TZN/VPN elements needed by most FMIS importers.
    """
    import xml.etree.ElementTree as ET
    from xml.dom import minidom

    root = ET.Element("ISO11783_TaskData", {
        "VersionMajor": "4",
        "VersionMinor": "0",
        "DataTransferOrigin": "1",
        "ManagementSoftwareManufacturer": "CropRisk Platform",
        "ManagementSoftwareVersion": "2.0",
    })

    task = ET.SubElement(root, "TSK", {
        "A": str(vra.id),
        "B": f"VRA {vra.prescription_type.value} — {vra.product_name or 'Product'}",
        "G": "1",
    })

    zone_codes = {"high": "1", "medium": "2", "low": "3"}
    for cls, info in (vra.rates_json or {}).items():
        rate = info.get("rate", vra.base_rate)
        tzn  = ET.SubElement(task, "TZN", {
            "A": zone_codes.get(cls, "1"),
            "B": f"{cls.capitalize()} productivity zone",
        })
        ET.SubElement(tzn, "VPN", {
            "A": vra.product_name or "Product",
            "B": str(rate),
            "C": "kg/ha",
        })
        ET.SubElement(tzn, "ASP", {
            "A": str(round(info.get("area_ha", 0) * 10_000)),  # m²
        })

    try:
        dom = minidom.parseString(ET.tostring(root, encoding="unicode"))
        return dom.toprettyxml(indent="  ")
    except Exception:
        return ET.tostring(root, encoding="unicode")
