"""
Satellite Data Service - Google Earth Engine Integration
Handles satellite imagery download, processing, and vegetation indices calculation
"""
import ee
import requests
from datetime import datetime, timedelta
from typing import Callable, Dict, List, Optional, Tuple
import numpy as np
import os
import threading
import time
from sqlalchemy.orm import Session
from app.models.data import SatelliteImage, VegetationHealth, FarmVegetationMetric
from app.models.farm import Farm
from app.core.config import settings  # Use singleton instance, not Settings class
import logging

logger = logging.getLogger(__name__)


class SatelliteDataService:
    """Service for satellite data acquisition and processing"""
    
    def __init__(self):
        from app.core import gee_manager  # import here to avoid circular at module load
        # Use the app-wide singleton — never re-initialize per request
        self.gee_initialized = gee_manager.is_initialized()
        force_pc = getattr(settings, 'USE_PLANETARY_COMPUTER', False)
        self.use_planetary_computer = force_pc or not self.gee_initialized

    # _initialize_gee is retained only for direct/manual invocation (e.g. scripts).
    def _initialize_gee(self):
        """Initialize Google Earth Engine with service account (singleton wrapper)."""
        from app.core import gee_manager
        success = gee_manager.initialize()
        self.gee_initialized = success
        self.use_planetary_computer = not success
        if not success:
            raise RuntimeError(
                gee_manager.get_error() or "GEE initialization failed"
            )
    
    def fetch_sentinel2_imagery(
        self, 
        lat: float, 
        lon: float, 
        start_date: datetime, 
        end_date: datetime,
        max_cloud_cover: float = 20.0
    ) -> List[Dict]:
        """
        Fetch Sentinel-2 imagery for a location
        
        Args:
            lat: Latitude
            lon: Longitude
            start_date: Start date for imagery search
            end_date: End date for imagery search
            max_cloud_cover: Maximum cloud cover percentage (0-100)
        
        Returns:
            List of imagery metadata dictionaries
        """
        if self.use_planetary_computer:
            return self._fetch_sentinel2_planetary_computer(lat, lon, start_date, end_date, max_cloud_cover)
        else:
            return self._fetch_sentinel2_gee(lat, lon, start_date, end_date, max_cloud_cover)
    
    def _fetch_sentinel2_gee(
        self, 
        lat: float, 
        lon: float, 
        start_date: datetime, 
        end_date: datetime,
        max_cloud_cover: float
    ) -> List[Dict]:
        """Fetch Sentinel-2 data using Google Earth Engine"""
        if not self.gee_initialized:
            raise RuntimeError("Google Earth Engine not initialized")
        
        try:
            # Define point of interest
            point = ee.Geometry.Point([lon, lat])
            
            # Get Sentinel-2 Surface Reflectance collection
            collection = (ee.ImageCollection('COPERNICUS/S2_SR')
                .filterBounds(point)
                .filterDate(start_date.strftime('%Y-%m-%d'), end_date.strftime('%Y-%m-%d'))
                .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', max_cloud_cover))
                .sort('system:time_start', False))
            
            # Get collection size first to avoid toList(0) error
            size = collection.size().getInfo()

            if size == 0:
                logger.warning(f"No Sentinel-2 imagery found for location ({lat}, {lon})")
                return []

            collection_list = collection.toList(min(size, 10))

            imagery_list = []
            for i in range(min(size, 10)):  # Limit to 10 most recent images
                image = ee.Image(collection_list.get(i))
                image_info = image.getInfo()
                
                # Extract metadata
                properties = image_info['properties']
                imagery_list.append({
                    'id': image_info['id'],
                    'date': datetime.fromtimestamp(properties['system:time_start'] / 1000),
                    'cloud_cover': properties.get('CLOUDY_PIXEL_PERCENTAGE', 0),
                    'source': 'sentinel2',
                    'image': image  # Store EE image object for processing
                })
            
            logger.info(f"Found {len(imagery_list)} Sentinel-2 images for location ({lat}, {lon})")
            return imagery_list
            
        except Exception as e:
            logger.error(f"Error fetching Sentinel-2 data from GEE: {e}")
            return []
    
    def _fetch_sentinel2_planetary_computer(
        self, 
        lat: float, 
        lon: float, 
        start_date: datetime, 
        end_date: datetime,
        max_cloud_cover: float
    ) -> List[Dict]:
        """Fetch Sentinel-2 data using Microsoft Planetary Computer"""
        try:
            import pystac_client
            from pystac.extensions.eo import EOExtension
            
            # Connect to Planetary Computer STAC API
            catalog = pystac_client.Client.open(
                "https://planetarycomputer.microsoft.com/api/stac/v1",
                modifier=lambda request: request
            )
            
            # Search for Sentinel-2 L2A data
            search = catalog.search(
                collections=["sentinel-2-l2a"],
                bbox=[lon - 0.01, lat - 0.01, lon + 0.01, lat + 0.01],
                datetime=f"{start_date.isoformat()}/{end_date.isoformat()}",
                query={"eo:cloud_cover": {"lt": max_cloud_cover}}
            )
            
            items = list(search.get_items())
            
            if not items:
                logger.warning(f"No Sentinel-2 imagery found for location ({lat}, {lon})")
                return []
            
            imagery_list = []
            for item in items[:10]:  # Limit to 10 most recent
                eo_ext = EOExtension.ext(item)
                imagery_list.append({
                    'id': item.id,
                    'date': datetime.fromisoformat(item.properties['datetime'].replace('Z', '+00:00')),
                    'cloud_cover': eo_ext.cloud_cover or 0,
                    'source': 'sentinel2',
                    'item': item  # Store STAC item for processing
                })
            
            logger.info(f"Found {len(imagery_list)} Sentinel-2 images from Planetary Computer")
            return imagery_list
            
        except Exception as e:
            logger.error(f"Error fetching Sentinel-2 data from Planetary Computer: {e}")
            return []
    
    def calculate_vegetation_indices(
        self,
        image_data: Dict,
        lat: float,
        lon: float,
        buffer_meters: float = 50,  # REDUCED from 500m to 50m!
        farm_boundary=None,
        farm_area: float = None
    ) -> Dict[str, float]:
        """
        Calculate vegetation indices from satellite imagery, returning summary stats.

        Returns a dict with:
        - ndvi_mean/min/max/std
        - ndre_mean
        - evi_mean
        - savi_mean
        """
        if self.use_planetary_computer:
            return self._calculate_indices_planetary_computer(image_data, lat, lon, buffer_meters, farm_boundary, farm_area)
        else:
            return self._calculate_indices_gee(image_data, lat, lon, buffer_meters, farm_boundary, farm_area)
    
    def _calculate_indices_gee(
        self,
        image_data: Dict,
        lat: float,
        lon: float,
        buffer_meters: float,
        farm_boundary=None,
        farm_area: float = None
    ) -> Dict[str, float]:
        """Calculate vegetation indices using Google Earth Engine"""
        try:
            from geoalchemy2.shape import to_shape
            import json

            # Avoid indefinitely hanging EE requests (best-effort; may be ignored by some environments)
            deadline_ms = int(getattr(settings, 'GEE_REQUEST_DEADLINE_MS', 120000))
            try:
                if hasattr(ee, 'data') and hasattr(ee.data, 'setDeadline'):
                    ee.data.setDeadline(deadline_ms)
            except Exception:
                pass

            image = image_data['image']
            point = ee.Geometry.Point([lon, lat])

            # Use farm boundary if available, otherwise use buffer
            if farm_boundary is not None:
                try:
                    # Convert GeoAlchemy2 geometry to Shapely
                    shapely_geom = to_shape(farm_boundary)
                    # Convert Shapely to GeoJSON
                    geojson = json.loads(json.dumps(shapely_geom.__geo_interface__))
                    # Convert to EE Geometry
                    region = ee.Geometry(geojson)

                    # Calculate actual analyzed area
                    analyzed_area_ha = region.area().divide(10000).getInfo()  # m² to hectares

                    logger.info(f"✓ Using ACTUAL farm boundary polygon (area: {analyzed_area_ha:.2f} ha)")
                    if farm_area and abs(analyzed_area_ha - farm_area) > farm_area * 0.1:
                        logger.warning(f"⚠️ Boundary area ({analyzed_area_ha:.2f} ha) differs from recorded farm area ({farm_area:.2f} ha)")

                except Exception as e:
                    logger.warning(f"Failed to use farm boundary, falling back to buffer: {e}")
                    region = point.buffer(buffer_meters)
                    analyzed_area_ha = (3.14159 * buffer_meters * buffer_meters) / 10000
                    logger.warning(f"⚠️ Using {buffer_meters}m buffer (area: {analyzed_area_ha:.2f} ha) - Farm area: {farm_area:.2f} ha")
                    if farm_area and analyzed_area_ha > farm_area * 2:
                        logger.error(f"🚨 CRITICAL: Buffer area ({analyzed_area_ha:.2f} ha) is {analyzed_area_ha/farm_area:.1f}x larger than farm ({farm_area:.2f} ha)! Data may include forests/neighboring farms!")
            else:
                region = point.buffer(buffer_meters)
                analyzed_area_ha = (3.14159 * buffer_meters * buffer_meters) / 10000

                if farm_area:
                    ratio = analyzed_area_ha / farm_area
                    if ratio > 2:
                        logger.error(f"🚨 CRITICAL: Buffer area ({analyzed_area_ha:.2f} ha) is {ratio:.1f}x LARGER than farm ({farm_area:.2f} ha)! Data contaminated by surrounding land!")
                    elif ratio > 1.5:
                        logger.warning(f"⚠️ WARNING: Buffer area ({analyzed_area_ha:.2f} ha) is {ratio:.1f}x larger than farm ({farm_area:.2f} ha)")
                    else:
                        logger.info(f"Using {buffer_meters}m buffer (area: {analyzed_area_ha:.2f} ha) for farm (area: {farm_area:.2f} ha)")
                else:
                    logger.info(f"Using {buffer_meters}m buffer (area: {analyzed_area_ha:.2f} ha) - no farm area recorded")

            # Select bands (raw DNs 0-10000)
            nir = image.select('B8')  # Near-Infrared
            red = image.select('B4')  # Red
            red_edge = image.select('B5')  # Red Edge
            green = image.select('B3')  # Green
            blue = image.select('B2')  # Blue

            # Scale from DNs (0-10000) to reflectance (0-1) so index values are in the expected range
            scale_factor = 10000
            nir  = nir.divide(scale_factor)
            red  = red.divide(scale_factor)
            red_edge = red_edge.divide(scale_factor)
            green = green.divide(scale_factor)
            blue = blue.divide(scale_factor)

            # Recompute indices on scaled bands
            ndvi = nir.subtract(red).divide(nir.add(red)).rename('NDVI')
            ndre = nir.subtract(red_edge).divide(nir.add(red_edge)).rename('NDRE')
            evi  = nir.subtract(red).divide(
                nir.add(red.multiply(6)).subtract(blue.multiply(7.5)).add(1)
            ).multiply(2.5).rename('EVI')
            L = 0.5
            savi = nir.subtract(red).divide(nir.add(red).add(L)).multiply(1 + L).rename('SAVI')
            indices = ee.Image.cat([ndvi, ndre, evi, savi])

            # Single server round-trip: compute mean/min/max/stddev for all bands.
            # We only use NDVI min/max/std, and means for the rest.
            stats = indices.reduceRegion(
                reducer=(ee.Reducer.mean()
                         .combine(ee.Reducer.minMax(), sharedInputs=True)
                         .combine(ee.Reducer.stdDev(), sharedInputs=True)),
                geometry=region,
                scale=10,
                maxPixels=1e9,
                bestEffort=True,
            ).getInfo()

            result = {
                'ndvi_mean': stats.get('NDVI_mean'),
                'ndvi_min': stats.get('NDVI_min'),
                'ndvi_max': stats.get('NDVI_max'),
                'ndvi_std': stats.get('NDVI_stdDev'),
                'ndre_mean': stats.get('NDRE_mean'),
                'evi_mean':  stats.get('EVI_mean'),
                'savi_mean': stats.get('SAVI_mean'),
            }
            logger.info("✓ GEE vegetation indices for farm: NDVI=%s, NDRE=%s", result['ndvi_mean'], result['ndre_mean'])
            return result

        except Exception as e:
            logger.error(f"🚨 CRITICAL: Error calculating vegetation indices with GEE: {e}", exc_info=True)
            return {
                'ndvi_mean': None,
                'ndvi_min': None,
                'ndvi_max': None,
                'ndvi_std': None,
                'ndre_mean': None,
                'evi_mean': None,
                'savi_mean': None,
                'error': str(e)
            }
    
    def _calculate_indices_planetary_computer(
        self,
        image_data: Dict,
        lat: float,
        lon: float,
        buffer_meters: float,
        farm_boundary=None,
        farm_area: float = None
    ) -> Dict[str, float]:
        """Calculate vegetation indices using Microsoft Planetary Computer"""
        try:
            import rioxarray
            import planetary_computer as pc

            # Best-effort protection against hanging remote COG reads via GDAL.
            # Values are seconds.
            os.environ.setdefault('CPL_VSIL_CURL_CONNECTTIMEOUT', str(getattr(settings, 'PC_COG_CONNECT_TIMEOUT_S', 20)))
            os.environ.setdefault('CPL_VSIL_CURL_TIMEOUT', str(getattr(settings, 'PC_COG_TIMEOUT_S', 120)))
            os.environ.setdefault('GDAL_HTTP_TIMEOUT', str(getattr(settings, 'PC_COG_TIMEOUT_S', 120)))

            item = image_data.get('item')
            if item is None:
                logger.error("No STAC item provided for Planetary Computer index calculation")
                return {}

            # Sign the assets for access
            signed_item = pc.sign(item)

            # Load bands
            nir_href = signed_item.assets['B08'].href
            red_href = signed_item.assets['B04'].href
            red_edge_href = signed_item.assets['B05'].href
            green_href = signed_item.assets['B03'].href
            blue_href = signed_item.assets['B02'].href

            import rioxarray
            import xarray as xr

            # Open bands as DataArrays at 10m resolution
            nir = rioxarray.open_rasterio(nir_href).squeeze()
            red = rioxarray.open_rasterio(red_href).squeeze()
            green = rioxarray.open_rasterio(green_href).squeeze()

            # Red edge and blue may be at 20m; reproject to match 10m
            red_edge = rioxarray.open_rasterio(red_edge_href).squeeze()
            blue = rioxarray.open_rasterio(blue_href).squeeze()

            # Clip to farm area
            from shapely.geometry import Point
            point = Point(lon, lat)
            buffer = point.buffer(buffer_meters / 111320)  # rough degrees

            import geopandas as gpd
            gdf = gpd.GeoDataFrame(geometry=[buffer], crs="EPSG:4326")

            clip_geom = [buffer]
            nir = nir.rio.clip(clip_geom, gdf.crs, drop=True)
            red = red.rio.clip(clip_geom, gdf.crs, drop=True)
            green = green.rio.clip(clip_geom, gdf.crs, drop=True)

            # Convert to float
            nir = nir.astype(float)
            red = red.astype(float)
            green = green.astype(float)

            # NDVI stats
            ndvi_arr = (nir - red) / (nir + red)
            ndvi_mean = float(ndvi_arr.mean().values)
            ndvi_min = float(ndvi_arr.min().values)
            ndvi_max = float(ndvi_arr.max().values)
            ndvi_std = float(ndvi_arr.std().values)

            # EVI
            evi = float((2.5 * (nir - red) / (nir + 6 * red - 7.5 * blue.astype(float).rio.clip(clip_geom, gdf.crs, drop=True) + 1)).mean().values)

            # SAVI (L=0.5)
            savi = float(((nir - red) / (nir + red + 0.5) * 1.5).mean().values)

            # NDRE
            red_edge = red_edge.astype(float).rio.clip(clip_geom, gdf.crs, drop=True)
            ndre = float(((nir - red_edge) / (nir + red_edge)).mean().values)

            logger.info(f"✓ Calculated REAL vegetation indices via Planetary Computer for ({lat}, {lon}) — NDVI: {ndvi_mean:.4f}")

            return {
                'ndvi_mean': round(ndvi_mean, 4),
                'ndvi_min': round(ndvi_min, 4),
                'ndvi_max': round(ndvi_max, 4),
                'ndvi_std': round(ndvi_std, 4),
                'ndre_mean': round(ndre, 4),
                'evi_mean': round(evi, 4),
                'savi_mean': round(savi, 4),
            }
        except ImportError as e:
            logger.error(f"🚨 MISSING DEPENDENCY: {e}. Install rioxarray and planetary-computer (pip install rioxarray planetary-computer).")
            return {
                'ndvi_mean': None,
                'ndvi_min': None,
                'ndvi_max': None,
                'ndvi_std': None,
                'ndre_mean': None,
                'evi_mean': None,
                'savi_mean': None,
                'error': f"Missing dependency: {str(e)}"
            }
        except Exception as e:
            logger.error(f"🚨 CRITICAL: Error calculating vegetation indices with Planetary Computer: {e}", exc_info=True)
            return {
                'ndvi_mean': None,
                'ndvi_min': None,
                'ndvi_max': None,
                'ndvi_std': None,
                'ndre_mean': None,
                'evi_mean': None,
                'savi_mean': None,
                'error': str(e)
            }
    
    def fetch_landsat_imagery(
        self, 
        lat: float, 
        lon: float, 
        start_date: datetime, 
        end_date: datetime,
        max_cloud_cover: float = 20.0
    ) -> List[Dict]:
        """
        Fetch Landsat 8/9 imagery as backup to Sentinel-2
        
        Args:
            lat: Latitude
            lon: Longitude
            start_date: Start date
            end_date: End date
            max_cloud_cover: Maximum cloud cover percentage
        
        Returns:
            List of imagery metadata
        """
        if not self.gee_initialized:
            logger.warning("GEE not initialized, cannot fetch Landsat data")
            return []
        
        try:
            point = ee.Geometry.Point([lon, lat])
            
            # Landsat 8/9 Surface Reflectance
            collection = (ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
                .filterBounds(point)
                .filterDate(start_date.strftime('%Y-%m-%d'), end_date.strftime('%Y-%m-%d'))
                .filter(ee.Filter.lt('CLOUD_COVER', max_cloud_cover))
                .sort('system:time_start', False))
            
            # Get collection size first to avoid toList(0) error
            size = collection.size().getInfo()

            if size == 0:
                return []

            collection_list = collection.toList(min(size, 5))

            imagery_list = []
            for i in range(min(size, 5)):
                image = ee.Image(collection_list.get(i))
                image_info = image.getInfo()
                properties = image_info['properties']
                
                imagery_list.append({
                    'id': image_info['id'],
                    'date': datetime.fromtimestamp(properties['system:time_start'] / 1000),
                    'cloud_cover': properties.get('CLOUD_COVER', 0),
                    'source': 'landsat8',
                    'image': image
                })
            
            logger.info(f"Found {len(imagery_list)} Landsat images")
            return imagery_list
            
        except Exception as e:
            logger.error(f"Error fetching Landsat data: {e}")
            return []
    
    def process_farm_imagery(
        self,
        db: Session,
        farm_id: int,
        days_back: int = 30,
        progress_cb: Optional[Callable[[int, str], None]] = None,
    ) -> List[FarmVegetationMetric]:
        """
        Process satellite imagery for a farm
        
        Args:
            db: Database session
            farm_id: Farm ID
            days_back: Number of days to look back for imagery
        
        Returns:
            List of processed SatelliteImage records
        """
        last_reported_pct = 0

        def progress(percent: int, stage: str) -> None:
            if not progress_cb:
                return
            try:
                nonlocal last_reported_pct
                pct = int(percent)
                if pct < last_reported_pct:
                    pct = last_reported_pct
                last_reported_pct = pct
                progress_cb(pct, stage)
            except Exception:
                return

        def start_heartbeat(
            start_pct: int,
            end_pct: int,
            stage_prefix: str,
            interval_s: float = 10.0,
        ) -> Tuple[threading.Event, threading.Thread]:
            stop_event = threading.Event()

            def _run() -> None:
                if not progress_cb:
                    return
                pct = start_pct
                t0 = time.time()
                while not stop_event.wait(interval_s):
                    elapsed = int(time.time() - t0)
                    if pct < end_pct:
                        pct += 1
                    progress(pct, f"{stage_prefix} (still running: {elapsed}s)")

            thread = threading.Thread(target=_run, daemon=True)
            thread.start()
            return stop_event, thread

        # Get farm
        farm = db.query(Farm).filter(Farm.id == farm_id).first()
        if not farm:
            logger.error(f"Farm {farm_id} not found")
            return []
        
        if not farm.latitude or not farm.longitude:
            logger.error(f"Farm {farm_id} has no coordinates")
            return []
        
        # Fetch imagery — try requested range first, then widen to 90 days
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_back)

        progress(35, 'Querying Sentinel-2 imagery...')

        # Try Sentinel-2 first
        imagery = self.fetch_sentinel2_imagery(
            farm.latitude,
            farm.longitude,
            start_date,
            end_date
        )

        # Fall back to Landsat if no Sentinel-2 data
        if not imagery and self.gee_initialized:
            logger.info("No Sentinel-2 data, trying Landsat")
            progress(38, 'No Sentinel-2 scenes. Querying Landsat...')
            imagery = self.fetch_landsat_imagery(
                farm.latitude,
                farm.longitude,
                start_date,
                end_date
            )

        # If still nothing, widen search to 90 days
        if not imagery and days_back < 90:
            logger.info(f"No imagery in {days_back} days, expanding to 90 days")
            progress(40, 'Expanding search window (up to 90 days)...')
            start_date = end_date - timedelta(days=90)
            progress(42, 'Re-querying Sentinel-2 imagery...')
            imagery = self.fetch_sentinel2_imagery(
                farm.latitude, farm.longitude, start_date, end_date
            )
            if not imagery and self.gee_initialized:
                progress(44, 'Re-querying Landsat imagery...')
                imagery = self.fetch_landsat_imagery(
                    farm.latitude, farm.longitude, start_date, end_date
                )

        if not imagery:
            logger.warning(f"No satellite imagery found for farm {farm_id}")
            return []

        progress(45, f'Found {len(imagery)} scene(s). Computing vegetation indices...')
        
        # Process each image
        processed_metrics = []
        n_imgs = max(1, len(imagery))
        for idx, img_data in enumerate(imagery):
            start_pct = 45 + int((idx / n_imgs) * 14)
            next_start = 45 + int(((idx + 1) / n_imgs) * 14)
            end_pct = min(57, max(start_pct, next_start - 1))

            stage_prefix = f'Computing indices ({idx + 1}/{n_imgs})...'
            progress(start_pct, stage_prefix)

            stop_event, hb_thread = start_heartbeat(
                start_pct=start_pct,
                end_pct=end_pct,
                stage_prefix=stage_prefix,
                interval_s=float(getattr(settings, 'SATELLITE_PROGRESS_HEARTBEAT_S', 10.0)),
            )
            # Calculate vegetation indices using farm boundary if available
            try:
                indices = self.calculate_vegetation_indices(
                    img_data,
                    farm.latitude,
                    farm.longitude,
                    buffer_meters=50,  # REDUCED from 500m to 50m
                    farm_boundary=farm.boundary,  # Use actual farm polygon
                    farm_area=farm.area  # Pass farm area for validation
                )
            finally:
                stop_event.set()
                try:
                    hb_thread.join(timeout=0.2)
                except Exception:
                    pass

            if not indices or indices.get('ndvi_mean') is None:
                logger.warning("Skipping image %s due to missing NDVI", img_data.get('id'))
                continue

            ndvi_mean = indices.get('ndvi_mean')
            health_score = max(0.0, min(100.0, (ndvi_mean + 1) * 50)) if ndvi_mean is not None else None

            metric = FarmVegetationMetric(
                farm_id=farm_id,
                observation_date=img_data['date'].date(),
                ndvi_mean=indices.get('ndvi_mean'),
                ndvi_min=indices.get('ndvi_min'),
                ndvi_max=indices.get('ndvi_max'),
                ndvi_std=indices.get('ndvi_std'),
                ndre_mean=indices.get('ndre_mean'),
                evi_mean=indices.get('evi_mean'),
                savi_mean=indices.get('savi_mean'),
                cloud_cover_percent=img_data.get('cloud_cover'),
                health_score=health_score,
                source=img_data.get('source'),
            )

            db.add(metric)
            processed_metrics.append(metric)

            # Optional: persist legacy SatelliteImage metadata only when explicitly enabled
            if getattr(settings, 'SATELLITE_STORE_RASTERS', False):
                sat_image = SatelliteImage(
                    farm_id=farm_id,
                    date=img_data['date'].date(),
                    acquisition_date=img_data['date'],
                    region=farm.location or "Unknown",
                    image_type="multispectral",
                    file_path=img_data['id'],
                    source=img_data['source'],
                    cloud_cover_percent=img_data['cloud_cover'],
                    processing_status='completed',
                    mean_ndvi=indices.get('ndvi_mean'),
                    mean_ndre=indices.get('ndre_mean'),
                    mean_evi=indices.get('evi_mean'),
                    mean_savi=indices.get('savi_mean'),
                    extra_metadata={'image_id': img_data['id']}
                )
                db.add(sat_image)

        progress(58, 'Saving vegetation metrics...')
        try:
            db.commit()
            logger.info(f"✓ Successfully committed {len(processed_metrics)} metric rows for farm {farm_id}")
        except Exception as commit_error:
            logger.error(f"✗ COMMIT FAILED for farm {farm_id}: {commit_error}")
            db.rollback()
            raise

        progress(60, 'Vegetation metrics saved.')

        return processed_metrics

    def extract_farm_boundary(
        self,
        lat: float,
        lon: float,
        buffer_meters: float = 200,
        days_back: int = 30
    ) -> Dict:
        """
        Automatically detect farm boundary from Dynamic World land cover classification

        Uses Google's Dynamic World dataset to identify crop areas and exclude forests.

        Args:
            lat: Farm latitude
            lon: Farm longitude
            buffer_meters: Search radius around point (default 200m)
            days_back: How many days back to search for classification data

        Returns:
            Dictionary with:
            - boundary: GeoJSON polygon of detected farm boundary
            - area_ha: Area in hectares
            - confidence: Classification confidence (0-1)
            - land_cover: Breakdown of land cover types
            - success: Boolean indicating if boundary was found
        """
        if not self.gee_initialized:
            logger.error("GEE not initialized - cannot extract farm boundary")
            return {
                'success': False,
                'error': 'Google Earth Engine not initialized',
                'boundary': None
            }

        try:
            import json
            from datetime import datetime, timedelta

            logger.info(f"🔍 Auto-detecting farm boundary at ({lat}, {lon})")

            point = ee.Geometry.Point([lon, lat])
            search_area = point.buffer(buffer_meters)

            # Get Dynamic World land cover classification
            # Class 4 = Crops, Class 1 = Trees (forests)
            end_date = datetime.now()
            start_date = end_date - timedelta(days=days_back)

            dw_collection = (ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
                .filterBounds(point)
                .filterDate(start_date.strftime('%Y-%m-%d'), end_date.strftime('%Y-%m-%d'))
                .select(['label', 'crops', 'trees']))

            # Get most common classification (mode)
            dw_mode = dw_collection.select('label').mode()

            # Also get probability layers for confidence
            dw_mean = dw_collection.select(['crops', 'trees']).mean()

            # Create mask for crops (class 4)
            crops_mask = dw_mode.eq(4)

            # Convert crop pixels to vectors (polygons)
            crop_vectors = crops_mask.reduceToVectors(
                geometry=search_area,
                scale=10,  # 10m resolution
                geometryType='polygon',
                eightConnected=False,
                labelProperty='crops',
                maxPixels=1e8
            )

            # Find the polygon that contains the farm center point
            farm_polygon = crop_vectors.filterBounds(point).first()

            if farm_polygon is None:
                logger.warning(f"⚠️ No crop area found at ({lat}, {lon}) - may be forest or other land cover")
                return {
                    'success': False,
                    'error': 'No crop area detected at this location',
                    'boundary': None
                }

            # Get the geometry as GeoJSON
            geom_info = farm_polygon.geometry().getInfo()

            # Calculate area using geodesic calculation (accurate on Earth's surface)
            # Use error margin of 1 meter for robust calculation
            area_m2 = farm_polygon.geometry().area(maxError=1).getInfo()
            area_ha = area_m2 / 10000

            # Get land cover probabilities at farm center for confidence
            probs = dw_mean.sample(point, 10).first().getInfo()
            crop_prob = probs['properties'].get('crops', 0) if probs else 0
            tree_prob = probs['properties'].get('trees', 0) if probs else 0

            # Calculate confidence score
            # High confidence if crops >> trees
            confidence = crop_prob if crop_prob > tree_prob else 0.5

            logger.info(f"✓ Farm boundary detected: {area_ha:.2f} ha (confidence: {confidence:.0%})")
            logger.info(f"  Crop probability: {crop_prob:.0%}, Tree probability: {tree_prob:.0%}")

            return {
                'success': True,
                'boundary': geom_info,  # GeoJSON polygon
                'area_ha': round(area_ha, 2),
                'confidence': round(confidence, 2),
                'land_cover': {
                    'crops': round(crop_prob, 2),
                    'trees': round(tree_prob, 2)
                },
                'method': 'dynamic_world',
                'resolution_m': 10
            }

        except Exception as e:
            logger.error(f"Error extracting farm boundary: {e}")
            return {
                'success': False,
                'error': str(e),
                'boundary': None
            }
