"""
Pipeline Service - Automated data fetching, processing, and prediction pipeline
Handles:
- Satellite data fetching from Copernicus
- NDVI calculation and storage
- Province/District/Farm level analytics
- Automated and manual trigger support
"""
import os
import json
import tempfile
import zipfile
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
import requests
import numpy as np
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from shapely import wkb
from shapely.ops import transform as shapely_transform

# Try importing rasterio, handle if not available
try:
    import rasterio
    from rasterio.crs import CRS
    from rasterio import features
    from pyproj import Transformer
    RASTERIO_AVAILABLE = True
except ImportError:
    RASTERIO_AVAILABLE = False


class PipelineService:
    """Centralized pipeline for satellite data processing and analysis"""
    
    # Copernicus credentials
    COPERNICUS_USERNAME = "kagaboriziki@gmail.com"
    COPERNICUS_PASSWORD = "Kagaboriziki@183"
    TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
    SEARCH_URL = "https://catalogue.dataspace.copernicus.eu/odata/v1/Products"
    
    # Rwanda bounding box
    RWANDA_BBOX = {
        'min_lon': 28.8,
        'max_lon': 30.9,
        'min_lat': -2.9,
        'max_lat': -1.0
    }
    
    # Rwanda tiles known to cover farms
    RWANDA_TILES = ['T35MQU', 'T35MRU', 'T35MRT', 'T35MQT', 'T36MTD', 'T36MTC', 'T36MTB']
    
    def __init__(self, db_url: str = None):
        self.db_url = db_url or os.environ.get(
            'DATABASE_URL', 
            'postgresql://postgres:1234@localhost:5434/crop_risk_db'
        )
        # Keep the pool conservative; this service may run in multiple processes (web + celery).
        self.engine = create_engine(
            self.db_url,
            pool_size=2,
            max_overflow=3,
            pool_pre_ping=True,
            pool_recycle=3600,
        )
        self.Session = sessionmaker(bind=self.engine)
        self.data_dir = Path("data/sentinel2_real")
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._access_token = None
        self._token_expires = None
    
    def get_access_token(self) -> str:
        """Get or refresh Copernicus access token"""
        now = datetime.now()
        if self._access_token and self._token_expires and now < self._token_expires:
            return self._access_token
        
        response = requests.post(self.TOKEN_URL, data={
            'grant_type': 'password',
            'username': self.COPERNICUS_USERNAME,
            'password': self.COPERNICUS_PASSWORD,
            'client_id': 'cdse-public'
        })
        
        if response.status_code != 200:
            raise Exception(f"Failed to get token: {response.text}")
        
        data = response.json()
        self._access_token = data['access_token']
        self._token_expires = now + timedelta(seconds=data.get('expires_in', 3600) - 60)
        return self._access_token
    
    def search_latest_products(self, max_cloud_cover: float = 20.0, days_back: int = 30) -> List[Dict]:
        """Search for latest Sentinel-2 products over Rwanda"""
        token = self.get_access_token()
        
        start_date = (datetime.now() - timedelta(days=days_back)).strftime('%Y-%m-%dT00:00:00.000Z')
        end_date = datetime.now().strftime('%Y-%m-%dT23:59:59.999Z')
        
        bbox = self.RWANDA_BBOX
        polygon = f"POLYGON(({bbox['min_lon']} {bbox['min_lat']}, {bbox['max_lon']} {bbox['min_lat']}, {bbox['max_lon']} {bbox['max_lat']}, {bbox['min_lon']} {bbox['max_lat']}, {bbox['min_lon']} {bbox['min_lat']}))"
        
        filter_query = (
            f"Collection/Name eq 'SENTINEL-2' and "
            f"Attributes/OData.CSC.DoubleAttribute/any(att:att/Name eq 'cloudCover' and att/OData.CSC.DoubleAttribute/Value lt {max_cloud_cover}) and "
            f"ContentDate/Start ge {start_date} and ContentDate/Start le {end_date} and "
            f"OData.CSC.Intersects(area=geography'SRID=4326;{polygon}')"
        )
        
        params = {
            '$filter': filter_query,
            '$orderby': 'ContentDate/Start desc',
            '$top': 50
        }
        
        response = requests.get(
            self.SEARCH_URL,
            params=params,
            headers={'Authorization': f'Bearer {token}'}
        )
        
        if response.status_code != 200:
            raise Exception(f"Search failed: {response.text}")
        
        return response.json().get('value', [])
    
    def download_product(self, product_id: str, product_name: str) -> Optional[Path]:
        """Download a Sentinel-2 product"""
        token = self.get_access_token()
        
        download_url = f"https://zipper.dataspace.copernicus.eu/odata/v1/Products({product_id})/$value"
        
        with tempfile.TemporaryDirectory() as tmpdir:
            zip_path = Path(tmpdir) / f"{product_name}.zip"
            
            response = requests.get(
                download_url,
                headers={'Authorization': f'Bearer {token}'},
                stream=True
            )
            
            if response.status_code != 200:
                print(f"Download failed for {product_name}: {response.status_code}")
                return None
            
            with open(zip_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            # Extract and process
            extract_dir = Path(tmpdir) / "extracted"
            with zipfile.ZipFile(zip_path, 'r') as zf:
                zf.extractall(extract_dir)
            
            # Calculate NDVI
            return self._process_product(extract_dir, product_name)
    
    def _process_product(self, extract_dir: Path, product_name: str) -> Optional[Path]:
        """Process extracted product and calculate NDVI"""
        if not RASTERIO_AVAILABLE:
            print("Rasterio not available, skipping processing")
            return None
        
        # Find band files (B04=Red, B08=NIR)
        b04_files = list(extract_dir.rglob("*B04*.jp2")) + list(extract_dir.rglob("*B04*.tif"))
        b08_files = list(extract_dir.rglob("*B08*.jp2")) + list(extract_dir.rglob("*B08*.tif"))
        
        # Prefer 10m resolution
        b04 = next((f for f in b04_files if '10m' in str(f)), b04_files[0] if b04_files else None)
        b08 = next((f for f in b08_files if '10m' in str(f)), b08_files[0] if b08_files else None)
        
        if not b04 or not b08:
            print(f"Could not find bands for {product_name}")
            return None
        
        # Extract tile from product name
        tile = None
        for part in product_name.split('_'):
            if len(part) == 6 and part[0] == 'T' and part[1:3].isdigit():
                tile = part
                break
        
        if not tile:
            tile = "UNKNOWN"
        
        ndvi_path = self.data_dir / f"ndvi_{tile}.tif"
        
        with rasterio.open(b04) as red_src, rasterio.open(b08) as nir_src:
            red = red_src.read(1).astype('float32')
            nir = nir_src.read(1).astype('float32')
            
            # Calculate NDVI
            np.seterr(divide='ignore', invalid='ignore')
            ndvi = np.where((nir + red) > 0, (nir - red) / (nir + red), 0)
            ndvi = np.clip(ndvi, -1, 1)
            
            # Save NDVI
            profile = red_src.profile.copy()
            profile.update(dtype='float32', driver='GTiff', compress='lzw')
            
            with rasterio.open(ndvi_path, 'w', **profile) as dst:
                dst.write(ndvi.astype('float32'), 1)
        
        print(f"✅ Saved NDVI: {ndvi_path}")
        return ndvi_path
    
    def extract_ndvi_for_farms(self, ndvi_path: Path, tile: str, farm_id: int | None = None) -> List[Dict]:
        """Extract NDVI values for farms from an NDVI file

        If farm_id is provided, extracts for that farm only.
        """
        if not RASTERIO_AVAILABLE:
            return []
        
        with self.engine.connect() as conn:
            if farm_id is None:
                result = conn.execute(
                    text(
                        """
                        SELECT
                            id,
                            name,
                            location,
                            province,
                            latitude,
                            longitude,
                            ST_AsBinary(boundary) AS boundary_wkb
                        FROM farms
                        WHERE latitude IS NOT NULL OR boundary IS NOT NULL
                        """
                    )
                )
            else:
                result = conn.execute(
                    text(
                        """
                        SELECT
                            id,
                            name,
                            location,
                            province,
                            latitude,
                            longitude,
                            ST_AsBinary(boundary) AS boundary_wkb
                        FROM farms
                        WHERE id = :farm_id AND (latitude IS NOT NULL OR boundary IS NOT NULL)
                        """
                    ),
                    {"farm_id": farm_id},
                )
            farms = [dict(row._mapping) for row in result]
        
        extracted = []
        
        with rasterio.open(ndvi_path) as src:
            transformer = Transformer.from_crs("EPSG:4326", src.crs, always_xy=True)

            def _mean_ndvi_for_polygon(polygon_wgs84) -> Optional[float]:
                # Transform polygon from WGS84 to raster CRS
                project = lambda x, y, z=None: transformer.transform(x, y)
                polygon_projected = shapely_transform(project, polygon_wgs84)

                try:
                    window = features.geometry_window(src, [polygon_projected], pad_x=1, pad_y=1)
                except Exception:
                    return None

                if window.width <= 0 or window.height <= 0:
                    return None

                data = src.read(1, window=window)
                transform = src.window_transform(window)

                mask = features.geometry_mask(
                    [polygon_projected],
                    out_shape=data.shape,
                    transform=transform,
                    invert=True,
                    all_touched=True,
                )

                # Keep only pixels inside polygon
                values = data[mask]
                if values.size == 0:
                    return None

                # Filter invalid values
                values = values.astype("float32")
                values = values[~np.isnan(values)]
                values = values[values != 0]
                if values.size == 0:
                    return None

                return float(np.mean(values))
            
            for farm in farms:
                try:
                    ndvi_value: Optional[float] = None

                    # Prefer polygon mean if available
                    boundary_wkb = farm.get('boundary_wkb')
                    if boundary_wkb:
                        polygon = wkb.loads(bytes(boundary_wkb))
                        if polygon is not None and polygon.geom_type == 'Polygon':
                            ndvi_value = _mean_ndvi_for_polygon(polygon)

                    # Fallback to point sampling
                    if ndvi_value is None:
                        if farm.get('longitude') is None or farm.get('latitude') is None:
                            continue
                        x, y = transformer.transform(farm['longitude'], farm['latitude'])
                        row, col = src.index(x, y)

                        if 0 <= row < src.height and 0 <= col < src.width:
                            ndvi_value = float(src.read(1)[row, col])

                    if ndvi_value is not None and not np.isnan(ndvi_value) and ndvi_value != 0:
                        extracted.append({
                            'farm_id': farm['id'],
                            'farm_name': farm['name'],
                            'district': farm['location'],
                            'province': farm['province'],
                            'ndvi': ndvi_value,
                            'tile': tile
                        })
                except Exception as e:
                    continue
        
        return extracted
    
    def update_satellite_records(self, farm_data: List[Dict], tile: str, date: datetime = None) -> int:
        """Insert or update satellite records for farms.

        Returns the number of affected farm records (inserted + updated).
        """
        if not farm_data:
            return 0
        
        date = date or datetime.now()
        affected = 0
        
        with self.engine.connect() as conn:
            for fd in farm_data:
                # Check if record exists for this farm
                existing = conn.execute(text("""
                    SELECT id FROM satellite_images 
                    WHERE extra_metadata->>'farm_id' = :farm_id 
                    ORDER BY date DESC LIMIT 1
                """), {'farm_id': str(fd['farm_id'])}).fetchone()
                
                meta = {
                    'farm_id': fd['farm_id'],
                    'ndvi_value': round(fd['ndvi'], 4),
                    'source': 'sentinel2_real',
                    'tile': tile,
                    'processed_at': datetime.now().isoformat()
                }
                
                if existing:
                    # Update existing record
                    conn.execute(text("""
                        UPDATE satellite_images 
                        SET date = :date, extra_metadata = CAST(:meta AS jsonb)
                        WHERE id = :id
                    """), {'date': date, 'meta': json.dumps(meta), 'id': existing[0]})
                    affected += 1
                else:
                    # Insert new record
                    conn.execute(text("""
                        INSERT INTO satellite_images (date, region, image_type, file_path, extra_metadata)
                        VALUES (:date, :region, 'NDVI', :path, CAST(:meta AS jsonb))
                    """), {
                        'date': date,
                        'region': fd['district'] or 'Rwanda',
                        'path': str(self.data_dir / f"ndvi_{tile}.tif"),
                        'meta': json.dumps(meta)
                    })
                    affected += 1
            
            conn.commit()
        
        return affected
    
    def run_full_pipeline(self, max_products: int = 5) -> Dict[str, Any]:
        """Run the full data fetching and processing pipeline"""
        result = {
            'status': 'running',
            'started_at': datetime.now().isoformat(),
            'products_searched': 0,
            'products_processed': 0,
            'farms_updated': 0,
            'errors': []
        }
        
        try:
            # Search for products
            products = self.search_latest_products()
            result['products_searched'] = len(products)
            
            # Process unique tiles
            processed_tiles = set()
            
            for product in products[:max_products]:
                product_name = product['Name']
                product_id = product['Id']
                
                # Extract tile
                tile = None
                for part in product_name.split('_'):
                    if len(part) == 6 and part[0] == 'T' and part[1:3].isdigit():
                        tile = part
                        break
                
                if not tile or tile in processed_tiles:
                    continue
                
                if tile not in self.RWANDA_TILES:
                    continue
                
                try:
                    ndvi_path = self.download_product(product_id, product_name)
                    if ndvi_path:
                        farm_data = self.extract_ndvi_for_farms(ndvi_path, tile)
                        count = self.update_satellite_records(farm_data, tile)
                        result['farms_updated'] += count
                        result['products_processed'] += 1
                        processed_tiles.add(tile)
                except Exception as e:
                    result['errors'].append(f"Error processing {tile}: {str(e)}")
            
            result['status'] = 'completed'
            result['completed_at'] = datetime.now().isoformat()
            
        except Exception as e:
            result['status'] = 'failed'
            result['error'] = str(e)
        
        return result
    
    def get_province_analytics(self) -> List[Dict]:
        """Get aggregated analytics by province"""
        with self.engine.connect() as conn:
            result = conn.execute(
                text(
                    """
                    WITH latest_sat AS (
                        SELECT DISTINCT ON (farm_id)
                            farm_id,
                            id,
                            date,
                            extra_metadata,
                            COALESCE(
                                NULLIF((extra_metadata->>'ndvi_value')::float, 0),
                                (extra_metadata->>'ndvi_mean')::float
                            ) AS ndvi
                        FROM (
                            SELECT s.*, (s.extra_metadata->>'farm_id')::int AS farm_id
                            FROM satellite_images s
                            WHERE (s.extra_metadata->>'farm_id') IS NOT NULL
                        ) s
                        ORDER BY farm_id, date DESC, id DESC
                    )
                    SELECT
                        f.province,
                        COUNT(DISTINCT f.id) as farm_count,
                        COUNT(DISTINCT ls.id) as satellite_records,
                        AVG(ls.ndvi) as avg_ndvi,
                        MIN(ls.ndvi) as min_ndvi,
                        MAX(ls.ndvi) as max_ndvi,
                        SUM(f.area) as total_area_ha
                    FROM farms f
                    LEFT JOIN latest_sat ls ON ls.farm_id = f.id
                    WHERE f.province IS NOT NULL
                    GROUP BY f.province
                    ORDER BY f.province
                    """
                )
            )
            
            analytics = []
            for row in result:
                avg_ndvi = row[3] or 0
                analytics.append({
                    'province': row[0],
                    'farm_count': row[1],
                    'satellite_records': row[2],
                    'avg_ndvi': round(avg_ndvi, 4),
                    'min_ndvi': round(row[4] or 0, 4),
                    'max_ndvi': round(row[5] or 0, 4),
                    'total_area_ha': round(row[6] or 0, 2),
                    'health_status': self._get_health_status(avg_ndvi),
                    'risk_level': self._calculate_risk_level(avg_ndvi)
                })
            
            return analytics
    
    def get_district_analytics(self, province: str = None) -> List[Dict]:
        """Get aggregated analytics by district"""
        query = """
            WITH latest_sat AS (
                SELECT DISTINCT ON (farm_id)
                    farm_id,
                    id,
                    date,
                    extra_metadata,
                    COALESCE(
                        NULLIF((extra_metadata->>'ndvi_value')::float, 0),
                        (extra_metadata->>'ndvi_mean')::float
                    ) AS ndvi
                FROM (
                    SELECT s.*, (s.extra_metadata->>'farm_id')::int AS farm_id
                    FROM satellite_images s
                    WHERE (s.extra_metadata->>'farm_id') IS NOT NULL
                ) s
                ORDER BY farm_id, date DESC, id DESC
            )
            SELECT 
                f.province,
                f.location as district,
                COUNT(DISTINCT f.id) as farm_count,
                COUNT(DISTINCT ls.id) as satellite_records,
                AVG(ls.ndvi) as avg_ndvi,
                MIN(ls.ndvi) as min_ndvi,
                MAX(ls.ndvi) as max_ndvi,
                SUM(f.area) as total_area_ha
            FROM farms f
            LEFT JOIN latest_sat ls ON ls.farm_id = f.id
            WHERE f.location IS NOT NULL
        """
        
        params = {}
        if province:
            query += " AND f.province = :province"
            params['province'] = province
        
        query += " GROUP BY f.province, f.location ORDER BY f.province, f.location"
        
        with self.engine.connect() as conn:
            result = conn.execute(text(query), params)
            
            analytics = []
            for row in result:
                avg_ndvi = row[4] or 0
                analytics.append({
                    'province': row[0],
                    'district': row[1],
                    'farm_count': row[2],
                    'satellite_records': row[3],
                    'avg_ndvi': round(avg_ndvi, 4),
                    'min_ndvi': round(row[5] or 0, 4),
                    'max_ndvi': round(row[6] or 0, 4),
                    'total_area_ha': round(row[7] or 0, 2),
                    'health_status': self._get_health_status(avg_ndvi),
                    'risk_level': self._calculate_risk_level(avg_ndvi)
                })
            
            return analytics
    
    def get_farm_analytics(self, province: str = None, district: str = None) -> List[Dict]:
        """Get individual farm analytics"""
        query = """
            WITH latest_sat AS (
                SELECT DISTINCT ON (farm_id)
                    farm_id,
                    id,
                    date,
                    COALESCE(
                        NULLIF((extra_metadata->>'ndvi_value')::float, 0),
                        (extra_metadata->>'ndvi_mean')::float
                    ) AS ndvi,
                    extra_metadata->>'tile' AS tile
                FROM (
                    SELECT s.*, (s.extra_metadata->>'farm_id')::int AS farm_id
                    FROM satellite_images s
                    WHERE (s.extra_metadata->>'farm_id') IS NOT NULL
                ) s
                ORDER BY farm_id, date DESC, id DESC
            )
            SELECT 
                f.id,
                f.name,
                f.location as district,
                f.province,
                f.area,
                f.latitude,
                f.longitude,
                ls.ndvi as ndvi,
                ls.tile as tile,
                ls.date as last_update
            FROM farms f
            LEFT JOIN latest_sat ls ON ls.farm_id = f.id
            WHERE 1=1
        """
        
        params = {}
        if province:
            query += " AND f.province = :province"
            params['province'] = province
        if district:
            query += " AND f.location LIKE :district"
            params['district'] = f"%{district}%"
        
        query += " ORDER BY f.province, f.location, f.name"
        
        with self.engine.connect() as conn:
            result = conn.execute(text(query), params)
            
            analytics = []
            for row in result:
                ndvi = row[7] or 0
                analytics.append({
                    'id': row[0],
                    'name': row[1],
                    'district': row[2],
                    'province': row[3],
                    'area_ha': round(row[4] or 0, 2),
                    'latitude': row[5],
                    'longitude': row[6],
                    'ndvi': round(ndvi, 4),
                    'tile': row[8],
                    'last_update': row[9].isoformat() if row[9] else None,
                    'health_status': self._get_health_status(ndvi),
                    'risk_level': self._calculate_risk_level(ndvi)
                })
            
            return analytics
    
    def get_prediction_summary(self) -> Dict[str, Any]:
        """Get prediction summary for dashboard"""
        province_data = self.get_province_analytics()
        district_data = self.get_district_analytics()
        
        # Calculate overall stats
        total_farms = sum(p['farm_count'] for p in province_data)
        avg_ndvi = np.mean([p['avg_ndvi'] for p in province_data if p['avg_ndvi'] > 0]) if province_data else 0
        
        high_risk = [d for d in district_data if d['risk_level'] in ['high', 'critical']]
        moderate_risk = [d for d in district_data if d['risk_level'] == 'moderate']
        
        return {
            'total_farms': total_farms,
            'total_provinces': len(province_data),
            'total_districts': len(district_data),
            'average_ndvi': round(avg_ndvi, 4),
            'overall_health': self._get_health_status(avg_ndvi),
            'overall_risk': self._calculate_risk_level(avg_ndvi),
            'high_risk_districts': len(high_risk),
            'moderate_risk_districts': len(moderate_risk),
            'provinces': province_data,
            'last_update': datetime.now().isoformat()
        }
    
    def _get_health_status(self, ndvi: float) -> str:
        """Convert NDVI to health status"""
        if ndvi >= 0.6:
            return 'healthy'
        elif ndvi >= 0.4:
            return 'moderate'
        elif ndvi >= 0.2:
            return 'stressed'
        else:
            return 'critical'
    
    def _calculate_risk_level(self, ndvi: float) -> str:
        """Calculate risk level from NDVI"""
        if ndvi >= 0.6:
            return 'low'
        elif ndvi >= 0.4:
            return 'moderate'
        elif ndvi >= 0.2:
            return 'high'
        else:
            return 'critical'


# Singleton instance
_pipeline_service = None

def get_pipeline_service() -> PipelineService:
    global _pipeline_service
    if _pipeline_service is None:
        _pipeline_service = PipelineService()
    return _pipeline_service
