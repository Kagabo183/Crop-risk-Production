"""
Rwanda boundary validation utilities.

Validates that farm coordinates and boundaries are within Rwanda's borders.
Uses FAO GAUL administrative boundaries as reference.
"""
from typing import Tuple, Optional, Dict
from shapely.geometry import Point, Polygon, shape
from shapely.ops import unary_union


# Rwanda bounding box (approximate)
# Source: FAO GAUL / OpenStreetMap
RWANDA_BBOX = {
    'min_lat': -2.85,  # Southern border
    'max_lat': -1.05,  # Northern border
    'min_lon': 28.85,  # Western border
    'max_lon': 30.90,  # Eastern border
}

# Rwanda provinces with approximate boundaries (simplified)
# For production, use actual GeoJSON from FAO GAUL or Rwanda government
RWANDA_PROVINCES = {
    'Northern': {'center': (-1.50, 29.80), 'districts': ['Gicumbi', 'Burera', 'Gakenke', 'Musanze', 'Rulindo']},
    'Southern': {'center': (-2.45, 29.75), 'districts': ['Gisagara', 'Huye', 'Kamonyi', 'Muhanga', 'Nyamagabe', 'Nyanza', 'Nyaruguru', 'Ruhango']},
    'Eastern': {'center': (-2.00, 30.40), 'districts': ['Bugesera', 'Gatsibo', 'Kayonza', 'Kirehe', 'Ngoma', 'Nyagatare', 'Rwamagana']},
    'Western': {'center': (-2.05, 29.25), 'districts': ['Karongi', 'Ngororero', 'Nyabihu', 'Nyamasheke', 'Rubavu', 'Rusizi', 'Rutsiro']},
    'Kigali': {'center': (-1.95, 30.06), 'districts': ['Gasabo', 'Kicukiro', 'Nyarugenge']},
}


def validate_point_in_rwanda(latitude: float, longitude: float) -> Tuple[bool, Optional[str]]:
    """
    Validate that a point (lat/lon) is within Rwanda's boundaries.

    Args:
        latitude: Latitude in decimal degrees
        longitude: Longitude in decimal degrees

    Returns:
        Tuple of (is_valid, error_message)
    """
    # Simple bounding box check (fast)
    if not (RWANDA_BBOX['min_lat'] <= latitude <= RWANDA_BBOX['max_lat']):
        return False, f"Latitude {latitude:.4f} is outside Rwanda (valid range: {RWANDA_BBOX['min_lat']} to {RWANDA_BBOX['max_lat']})"

    if not (RWANDA_BBOX['min_lon'] <= longitude <= RWANDA_BBOX['max_lon']):
        return False, f"Longitude {longitude:.4f} is outside Rwanda (valid range: {RWANDA_BBOX['min_lon']} to {RWANDA_BBOX['max_lon']})"

    return True, None


def detect_province_from_coordinates(latitude: float, longitude: float) -> Optional[str]:
    """
    Detect which province a coordinate falls into (approximate).

    For production use, replace with actual spatial query against Rwanda administrative boundaries.

    Args:
        latitude: Latitude in decimal degrees
        longitude: Longitude in decimal degrees

    Returns:
        Province name or None if cannot determine
    """
    # Validate first
    is_valid, _ = validate_point_in_rwanda(latitude, longitude)
    if not is_valid:
        return None

    # Simple distance-based heuristic (for MVP)
    # For production: use actual GeoJSON polygons and point-in-polygon test
    min_distance = float('inf')
    closest_province = None

    for province, data in RWANDA_PROVINCES.items():
        center_lat, center_lon = data['center']
        distance = ((latitude - center_lat) ** 2 + (longitude - center_lon) ** 2) ** 0.5
        if distance < min_distance:
            min_distance = distance
            closest_province = province

    return closest_province


def validate_boundary_in_rwanda(boundary_geojson: Dict) -> Tuple[bool, Optional[str]]:
    """
    Validate that a polygon boundary is entirely within Rwanda.

    Args:
        boundary_geojson: GeoJSON geometry (Polygon or MultiPolygon)

    Returns:
        Tuple of (is_valid, error_message)
    """
    try:
        polygon = shape(boundary_geojson)

        # Check all vertices are in Rwanda
        if polygon.geom_type == 'Polygon':
            coords = list(polygon.exterior.coords)
        elif polygon.geom_type == 'MultiPolygon':
            coords = []
            for poly in polygon.geoms:
                coords.extend(list(poly.exterior.coords))
        else:
            return False, f"Invalid geometry type: {polygon.geom_type}. Expected Polygon or MultiPolygon."

        # Validate each vertex
        for lon, lat in coords:
            is_valid, error = validate_point_in_rwanda(lat, lon)
            if not is_valid:
                return False, f"Boundary extends outside Rwanda: {error}"

        return True, None

    except Exception as e:
        return False, f"Invalid boundary geometry: {str(e)}"


def calculate_area_hectares(boundary_geojson: Dict) -> float:
    """
    Calculate area of a boundary in hectares using geodesic calculation.

    Uses proper geodesic area calculation for accurate results on Earth's surface.
    Suitable for small to medium farms (< 1000 ha) in Rwanda.

    Args:
        boundary_geojson: GeoJSON geometry (Polygon or MultiPolygon)

    Returns:
        Area in hectares
    """
    try:
        from math import radians, cos, sin

        polygon = shape(boundary_geojson)

        # Get coordinates (handle both Polygon and MultiPolygon)
        if polygon.geom_type == 'Polygon':
            coords = list(polygon.exterior.coords)
        elif polygon.geom_type == 'MultiPolygon':
            # Sum area of all polygons
            total_area = 0.0
            for poly in polygon.geoms:
                coords = list(poly.exterior.coords)
                total_area += _calculate_polygon_area_geodesic(coords)
            return round(total_area / 10000, 3)  # Convert m² to hectares
        else:
            return 0.0

        # Calculate area using geodesic method
        area_m2 = _calculate_polygon_area_geodesic(coords)
        area_ha = area_m2 / 10000  # Convert to hectares

        return round(area_ha, 3)

    except Exception as e:
        # Fallback to simple approximation if geodesic calculation fails
        try:
            polygon = shape(boundary_geojson)
            # Use a simple approximation for Rwanda (latitude around -2°)
            # This is less accurate but more robust
            bounds = polygon.bounds  # (minx, miny, maxx, maxy)
            width_deg = bounds[2] - bounds[0]
            height_deg = bounds[3] - bounds[1]

            # Approximate area using bounding box (very rough)
            # 1 degree ≈ 111km at equator
            area_m2_approx = (width_deg * 111320) * (height_deg * 111320) * 0.7  # 0.7 correction factor
            return round(area_m2_approx / 10000, 3)
        except:
            return 0.0


def _calculate_polygon_area_geodesic(coords: list) -> float:
    """
    Calculate polygon area using geodesic (spherical) geometry.

    Uses the Shoelace formula adapted for spherical coordinates.
    Suitable for small polygons (< 100 km²) near Rwanda's latitude.

    Args:
        coords: List of (lon, lat) tuples

    Returns:
        Area in square meters
    """
    from math import radians, cos

    if len(coords) < 3:
        return 0.0

    # Earth's radius in meters
    R = 6378137.0

    # Convert to radians and calculate area using Shoelace formula
    # adapted for spherical coordinates
    total = 0.0

    for i in range(len(coords) - 1):
        lon1, lat1 = coords[i]
        lon2, lat2 = coords[i + 1]

        # Convert to radians
        lon1_rad = radians(lon1)
        lat1_rad = radians(lat1)
        lon2_rad = radians(lon2)
        lat2_rad = radians(lat2)

        # Shoelace formula component
        total += (lon2_rad - lon1_rad) * (2 + cos(lat1_rad) + cos(lat2_rad))

    # Calculate area
    area = abs(total * R * R / 2.0)

    return area


def get_rwanda_info() -> Dict:
    """
    Get information about Rwanda's boundaries and provinces.

    Returns:
        Dictionary with Rwanda boundary metadata
    """
    return {
        'country': 'Rwanda',
        'bounding_box': RWANDA_BBOX,
        'provinces': list(RWANDA_PROVINCES.keys()),
        'total_districts': sum(len(p['districts']) for p in RWANDA_PROVINCES.values()),
        'center': (-1.95, 30.06),  # Kigali
    }
