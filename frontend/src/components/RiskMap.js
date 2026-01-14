import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, GeoJSON, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import { fetchFarms, fetchEnrichedPredictions, updateFarmBoundary } from '../api';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-measure/dist/leaflet-measure.css';
import 'leaflet-draw';
import 'leaflet-measure';
import './RiskMap.css';

// Fix Leaflet default marker icon issue
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

function MapTools({ showScale, showMeasure }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    // React dev (StrictMode) can mount/unmount effects twice.
    // leaflet-measure has a known issue when removed: it may leave map event
    // listeners behind, then later events call into the control after `_map`
    // was nulled, causing `this._map is null`.
    // Workaround: create the measure control once per map and only hide/show.

    // Scale control is safe to add/remove.
    if (showScale) {
      if (!map.__scaleControl) {
        map.__scaleControl = L.control
          .scale({ metric: true, imperial: false, position: 'bottomleft' })
          .addTo(map);
      }
    } else if (map.__scaleControl) {
      map.removeControl(map.__scaleControl);
      map.__scaleControl = null;
    }

    const ensureMeasureControl = () => {
      if (map.__measureControl) return map.__measureControl;

      // leaflet-measure registers either L.control.measure or L.Control.Measure depending on build.
      const MeasureCtor = (L.Control && L.Control.Measure) || null;
      const measureFactory = (L.control && L.control.measure) || null;

      const options = {
        position: 'topleft',
        primaryLengthUnit: 'kilometers',
        secondaryLengthUnit: 'meters',
        primaryAreaUnit: 'sqkilometers',
        secondaryAreaUnit: 'hectares',
        activeColor: '#1d4ed8',
        completedColor: '#16a34a',
      };

      let control = null;
      if (typeof measureFactory === 'function') {
        control = measureFactory(options).addTo(map);
      } else if (MeasureCtor) {
        control = new MeasureCtor(options);
        control.addTo(map);
      }

      map.__measureControl = control;
      return control;
    };

    if (showMeasure) {
      const c = ensureMeasureControl();
      if (c && c._container) {
        c._container.style.display = '';
      }
    } else if (map.__measureControl && map.__measureControl._container) {
      map.__measureControl._container.style.display = 'none';
    }

    return () => {
      // Avoid removing measure control; just hide it.
      if (map.__measureControl && map.__measureControl._container) {
        map.__measureControl._container.style.display = 'none';
      }
      if (map.__scaleControl) {
        map.removeControl(map.__scaleControl);
        map.__scaleControl = null;
      }
    };
  }, [map, showScale, showMeasure]);

  return null;
}

function MapAutoFocus({ farm, boundary, enabled, fallbackRadiusKm = 2 }) {
  const map = useMap();
  const lastFocusedIdRef = useRef(null);

  useEffect(() => {
    if (!enabled || !map || !farm) return;
    if (farm.id != null && lastFocusedIdRef.current === farm.id) return;

    const lat = farm.latitude;
    const lng = farm.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;

    // Prefer fitting to boundary if available; else fit to a reasonable circle; else flyTo point.
    try {
      if (boundary) {
        const layer = L.geoJSON(boundary);
        const bounds = layer.getBounds();
        if (bounds && bounds.isValid && bounds.isValid()) {
          map.fitBounds(bounds.pad(0.2), { maxZoom: 15, animate: true });
          lastFocusedIdRef.current = farm.id ?? '__focused__';
          return;
        }
      }

      const radiusM = Math.max(0.25, Number(fallbackRadiusKm) || 2) * 1000;
      const circleBounds = L.circle([lat, lng], { radius: radiusM }).getBounds();
      if (circleBounds && circleBounds.isValid && circleBounds.isValid()) {
        map.fitBounds(circleBounds.pad(0.25), { maxZoom: 14, animate: true });
      } else {
        map.flyTo([lat, lng], 14, { animate: true });
      }
      lastFocusedIdRef.current = farm.id ?? '__focused__';
    } catch {
      // ignore
    }
  }, [boundary, enabled, farm, fallbackRadiusKm, map]);

  return null;
}

function MapBoundaryEditor({ enabled, initialBoundaryFeature, onDraftGeometryChange }) {
  const map = useMap();

  useEffect(() => {
    if (!enabled || !map) return;

    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    if (initialBoundaryFeature) {
      try {
        const seed = L.geoJSON(initialBoundaryFeature);
        seed.eachLayer((layer) => drawnItems.addLayer(layer));
      } catch {
        // ignore
      }
    }

    const drawControl = new L.Control.Draw({
      position: 'topleft',
      draw: {
        polygon: {
          allowIntersection: false,
          showArea: true,
          shapeOptions: { color: '#2563eb', weight: 2, fillOpacity: 0.15 },
        },
        polyline: false,
        rectangle: false,
        circle: false,
        marker: false,
        circlemarker: false,
      },
      edit: {
        featureGroup: drawnItems,
        edit: true,
        remove: true,
      },
    });

    map.addControl(drawControl);

    const emitLatestGeometry = () => {
      let lastGeometry = null;
      drawnItems.eachLayer((layer) => {
        try {
          const geo = layer.toGeoJSON();
          if (geo && geo.geometry) lastGeometry = geo.geometry;
        } catch {
          // ignore
        }
      });
      onDraftGeometryChange(lastGeometry);
    };

    const onCreated = (e) => {
      drawnItems.clearLayers();
      drawnItems.addLayer(e.layer);
      emitLatestGeometry();
    };

    const onEdited = () => emitLatestGeometry();
    const onDeleted = () => onDraftGeometryChange(null);

    map.on(L.Draw.Event.CREATED, onCreated);
    map.on(L.Draw.Event.EDITED, onEdited);
    map.on(L.Draw.Event.DELETED, onDeleted);

    // Initialize draft from seeded boundary (if any)
    emitLatestGeometry();

    return () => {
      map.off(L.Draw.Event.CREATED, onCreated);
      map.off(L.Draw.Event.EDITED, onEdited);
      map.off(L.Draw.Event.DELETED, onDeleted);
      try {
        map.removeControl(drawControl);
      } catch {
        // ignore
      }
      try {
        map.removeLayer(drawnItems);
      } catch {
        // ignore
      }
    };
  }, [enabled, initialBoundaryFeature, map, onDraftGeometryChange]);

  return null;
}

const RiskMap = () => {
  const [searchParams] = useSearchParams();
  const [farms, setFarms] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [selectedFarm, setSelectedFarm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mapView, setMapView] = useState('street'); // 'street' or 'satellite'
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCoverage, setShowCoverage] = useState(true);
  const [coverageRadiusKm, setCoverageRadiusKm] = useState(2);
  const [showScale, setShowScale] = useState(true);
  const [showMeasure, setShowMeasure] = useState(true);
  const [hideWarningFarms, setHideWarningFarms] = useState(false);
  const [editBoundaryMode, setEditBoundaryMode] = useState(false);
  const [draftBoundaryGeometry, setDraftBoundaryGeometry] = useState(null);
  const [savingBoundary, setSavingBoundary] = useState(false);
  const [boundarySaveError, setBoundarySaveError] = useState(null);
  const locationCacheRef = useRef({}); // Cache for geocoded locations

  const farmIdParamRaw = searchParams.get('farmId');
  const focusedFarmId = farmIdParamRaw ? parseInt(farmIdParamRaw, 10) : null;
  const focusOnly = searchParams.get('focus') === '1' || searchParams.get('only') === '1';

  // Reverse geocode coordinates to get location details
  const reverseGeocode = useCallback(async (lat, lng, farmId) => {
    const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    
    // Check cache first
    if (locationCacheRef.current[cacheKey]) {
      return locationCacheRef.current[cacheKey];
    }
    
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
      );
      const data = await response.json();
      
      if (data.address) {
        const locationData = {
          sector: data.address.suburb || data.address.neighbourhood || data.address.quarter || 'Unknown',
          cell: data.address.hamlet || data.address.isolated_dwelling || data.address.locality || 'Unknown',
          village: data.address.village || data.address.town || data.address.city || 'Unknown',
          fullAddress: data.display_name
        };
        
        // Cache the result
        locationCacheRef.current[cacheKey] = locationData;
        
        return locationData;
      }
    } catch (error) {
      console.error('Reverse geocoding error:', error);
    }
    
    return null;
  }, []);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    // Check for farmId parameter in URL
    if (focusedFarmId && farms.length > 0) {
      const farm = farms.find(f => f.id === focusedFarmId);
      if (farm) {
        const coords = getFarmCoordinates(farm, farms.indexOf(farm));
        setSelectedFarm({
          ...farm,
          latitude: coords?.[0] ?? farm.latitude,
          longitude: coords?.[1] ?? farm.longitude,
        });
        // Get location details if coordinates exist
        if (coords) {
          reverseGeocode(coords[0], coords[1], farm.id).then(locationData => {
            if (locationData && !farm.sector) {
              setSelectedFarm(prev => prev ? {
                ...prev,
                sector: locationData.sector,
                cell: locationData.cell,
                village: locationData.village
              } : null);
            }
          });
        }
      }
    }
  }, [focusedFarmId, farms, reverseGeocode]);

  async function loadData() {
    try {
      const [farmsData, predictionsData] = await Promise.all([
        fetchFarms(),
        fetchEnrichedPredictions()
      ]);
      setFarms(farmsData);
      setPredictions(predictionsData);
    } catch (error) {
      console.error('Failed to load map data:', error);
    } finally {
      setLoading(false);
    }
  }

  const getRiskLevel = useCallback((farmId) => {
    const farmPredictions = predictions.filter((p) => p.farm_id === farmId);
    if (farmPredictions.length === 0) return 'unknown';

    const avgRisk = farmPredictions.reduce((sum, p) => sum + (p.risk_score || 0), 0) / farmPredictions.length;

    if (avgRisk >= 75) return 'critical';
    if (avgRisk >= 50) return 'high';
    if (avgRisk >= 25) return 'medium';
    return 'low';
  }, [predictions]);

  const getRiskColor = (riskLevel) => {
    const colors = {
      critical: '#dc3545',
      high: '#fd7e14',
      medium: '#ffc107',
      low: '#198754',
      unknown: '#6c757d'
    };
    return colors[riskLevel] || colors.unknown;
  };

  const getRiskLabel = (riskLevel) => {
    const labels = {
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      unknown: 'No Data'
    };
    return labels[riskLevel] || labels.unknown;
  };

  const getFarmPredictions = (farmId) => {
    return predictions.filter(p => p.farm_id === farmId);
  };

  const predictionByFarmId = useMemo(() => {
    const m = new Map();
    for (const p of predictions) {
      if (p && p.farm_id != null) m.set(p.farm_id, p);
    }
    return m;
  }, [predictions]);

  const getFarmQualityFlags = useCallback(
    (farmId) => {
      const p = predictionByFarmId.get(farmId);
      const flags = p?.data_quality?.flags;
      return Array.isArray(flags) ? flags : [];
    },
    [predictionByFarmId]
  );

  const formatQualityFlag = useCallback((flag) => {
    const map = {
      missing_farm_geometry: 'Missing farm coordinates/boundary (location may be unreliable)',
      farm_out_of_rwanda_bounds: 'Farm coordinates outside Rwanda bounds',
      invalid_farm_coordinates: 'Invalid farm coordinates',
      no_satellite_ndvi: 'No NDVI linked to this farm yet',
      invalid_satellite_ndvi: 'Invalid NDVI values in satellite data',
      ndvi_suspicious_low: 'NDVI very low (could be water/urban/bare soil)',
      ndvi_suspicious_high: 'NDVI unusually high (check data)',
      ndvi_unstable: 'NDVI changed sharply between recent dates',
      missing_farm_record: 'Missing farm record for prediction',
    };
    return map[flag] || flag;
  }, []);

  const getCoverageRadiusMeters = useCallback(
    (farm) => {
      // If farm area is known (hectares), make the circle area match it.
      // area_ha -> m^2 -> radius = sqrt(A/pi)
      const areaHa = Number(farm?.area);
      if (Number.isFinite(areaHa) && areaHa > 0) {
        const areaM2 = areaHa * 10000;
        const r = Math.sqrt(areaM2 / Math.PI);
        // Small visual minimum so tiny farms remain visible/clickable.
        return Math.max(50, r);
      }

      const km = Math.max(0.25, Number(coverageRadiusKm) || 2);
      return km * 1000;
    },
    [coverageRadiusKm]
  );

  const farmRiskStats = useMemo(() => {
    const counts = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      unknown: 0,
    };
    for (const farm of farms) {
      counts[getRiskLevel(farm.id)] += 1;
    }
    return counts;
  }, [farms, getRiskLevel]);

  const visibleFarms = useMemo(() => {
    // In focused mode we always show the farm (even if it has warnings).
    if (focusOnly && focusedFarmId) {
      return farms.filter((f) => f.id === focusedFarmId);
    }

    if (!hideWarningFarms) return farms;

    return farms.filter((farm) => {
      const p = predictionByFarmId.get(farm.id);
      if (!p) return true;
      const flags = p?.data_quality?.flags;
      const hasFlags = Array.isArray(flags) && flags.length > 0;
      const hasWarnings = Boolean(p?.data_quality?.has_warnings) || hasFlags;
      return !hasWarnings;
    });
  }, [farms, focusOnly, focusedFarmId, hideWarningFarms, predictionByFarmId]);

  const focusedBoundary = useMemo(() => {
    if (!focusOnly || !focusedFarmId) return null;
    const farm = farms.find((f) => f.id === focusedFarmId);
    if (draftBoundaryGeometry) return normalizeBoundaryGeoJson(draftBoundaryGeometry);
    return farm ? normalizeBoundaryGeoJson(farm.boundary) : null;
  }, [draftBoundaryGeometry, farms, focusOnly, focusedFarmId]);

  function normalizeBoundaryGeoJson(boundary) {
    if (!boundary) return null;

    let geo = boundary;
    if (typeof geo === 'string') {
      try {
        geo = JSON.parse(geo);
      } catch {
        return null;
      }
    }

    if (!geo || typeof geo !== 'object') return null;

    // Accept Feature/FeatureCollection as-is.
    if (geo.type === 'Feature' || geo.type === 'FeatureCollection') {
      return geo;
    }

    // Accept Geometry objects by wrapping as a Feature.
    if (typeof geo.type === 'string' && geo.coordinates) {
      return {
        type: 'Feature',
        properties: {},
        geometry: geo,
      };
    }

    return null;
  }

  const focusedFarm = useMemo(() => {
    if (!focusOnly || !focusedFarmId) return null;
    return farms.find((f) => f.id === focusedFarmId) || null;
  }, [farms, focusOnly, focusedFarmId]);

  const focusedBoundaryFromFarm = useMemo(() => {
    if (!focusedFarm) return null;
    return normalizeBoundaryGeoJson(focusedFarm.boundary);
  }, [focusedFarm]);

  const saveFocusedBoundary = useCallback(async () => {
    if (!focusedFarmId) return;
    setBoundarySaveError(null);
    setSavingBoundary(true);
    try {
      const updated = await updateFarmBoundary(focusedFarmId, draftBoundaryGeometry);
      setFarms((prev) => prev.map((f) => (f.id === focusedFarmId ? { ...f, ...updated } : f)));
      setSelectedFarm((prev) => (prev && prev.id === focusedFarmId ? { ...prev, ...updated } : prev));
      setEditBoundaryMode(false);
    } catch (e) {
      setBoundarySaveError(e?.message || 'Failed to save boundary');
    } finally {
      setSavingBoundary(false);
    }
  }, [draftBoundaryGeometry, focusedFarmId]);

  const clearFocusedBoundary = useCallback(async () => {
    if (!focusedFarmId) return;
    setBoundarySaveError(null);
    setSavingBoundary(true);
    try {
      const updated = await updateFarmBoundary(focusedFarmId, null);
      setFarms((prev) => prev.map((f) => (f.id === focusedFarmId ? { ...f, ...updated } : f)));
      setSelectedFarm((prev) => (prev && prev.id === focusedFarmId ? { ...prev, ...updated } : prev));
      setDraftBoundaryGeometry(null);
      setEditBoundaryMode(false);
    } catch (e) {
      setBoundarySaveError(e?.message || 'Failed to clear boundary');
    } finally {
      setSavingBoundary(false);
    }
  }, [focusedFarmId]);

  // Get farm coordinates - use actual lat/lng or generate within Rwanda bounds
  function getFarmCoordinates(farm, index) {
    // Rwanda actual bounds - tighter to avoid border areas
    // Using more conservative bounds that stay well within Rwanda's borders
    if (farm.latitude && farm.longitude) {
      return [farm.latitude, farm.longitude];
    }
    
    // Generate coordinates within Rwanda's core territory
    // More accurate Rwanda bounds: lat -2.84 to -1.05, lng 28.86 to 30.88
    // Using even tighter bounds to ensure we stay in Rwanda
    const seed = farm.id || index;
    const lat = -2.5 + ((seed * 137.5) % 140) / 100; // -2.5 to -1.1 (core Rwanda)
    const lng = 29.0 + ((seed * 234.7) % 185) / 100; // 29.0 to 30.85 (core Rwanda)
    return [lat, lng];
  }

  // Create custom marker icons based on risk level
  const createMarkerIcon = (riskLevel) => {
    const colors = {
      critical: '#dc3545',
      high: '#fd7e14',
      medium: '#ffc107',
      low: '#198754',
      unknown: '#6c757d'
    };
    
    const color = colors[riskLevel] || colors.unknown;
    
    return L.divIcon({
      className: 'custom-marker',
      html: `
        <div style="
          background-color: ${color};
          width: 40px;
          height: 40px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 3px solid white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          font-size: 20px;
        ">
          
        </div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
  };

  if (loading) {
    return (
      <div className="risk-map-container">
        <div className="loading-spinner">Loading map data...</div>
      </div>
    );
  }

  return (
    <div className={`risk-map-container ${isFullscreen ? 'fullscreen' : ''}`}>
      <div className="map-header">
        <div className="map-title">
          <h2>Risk Map</h2>
          <p>
            {visibleFarms.length} farm{visibleFarms.length === 1 ? '' : 's'}
            {focusOnly ? ' • Focused view' : " • Rwanda's monitored agricultural areas"}
          </p>
        </div>
        <div className="map-legend">
          <div className="legend-item">
            <div className="legend-color" style={{ background: '#dc3545' }}></div>
            <span>Critical ({farmRiskStats.critical})</span>
          </div>
          <div className="legend-item">
            <div className="legend-color" style={{ background: '#fd7e14' }}></div>
            <span>High ({farmRiskStats.high})</span>
          </div>
          <div className="legend-item">
            <div className="legend-color" style={{ background: '#ffc107' }}></div>
            <span>Medium ({farmRiskStats.medium})</span>
          </div>
          <div className="legend-item">
            <div className="legend-color" style={{ background: '#198754' }}></div>
            <span>Low ({farmRiskStats.low})</span>
          </div>
          <div className="legend-item">
            <div className="legend-color" style={{ background: '#6c757d' }}></div>
            <span>No Data</span>
          </div>
        </div>
      </div>

      {focusOnly && focusedFarmId ? (
        <div className="map-boundary-banner">
          <div className="map-boundary-banner__title">
            <strong>Real boundary:</strong>{' '}
            {focusedBoundaryFromFarm ? 'Saved' : 'Not set'}
            {editBoundaryMode ? ' • Editing' : ''}
          </div>
          <div className="map-boundary-banner__actions">
            {!editBoundaryMode ? (
              <button
                className="boundary-btn"
                onClick={() => {
                  setDraftBoundaryGeometry(null);
                  setBoundarySaveError(null);
                  setEditBoundaryMode(true);
                }}
                disabled={savingBoundary}
              >
                {focusedBoundaryFromFarm ? 'Edit / Replace boundary' : 'Draw boundary'}
              </button>
            ) : (
              <>
                <button
                  className="boundary-btn boundary-btn--primary"
                  onClick={saveFocusedBoundary}
                  disabled={savingBoundary || !draftBoundaryGeometry}
                  title={!draftBoundaryGeometry ? 'Draw a polygon on the map first' : 'Save boundary'}
                >
                  {savingBoundary ? 'Saving…' : 'Save'}
                </button>
                <button
                  className="boundary-btn"
                  onClick={() => {
                    setEditBoundaryMode(false);
                    setDraftBoundaryGeometry(null);
                    setBoundarySaveError(null);
                  }}
                  disabled={savingBoundary}
                >
                  Cancel
                </button>
              </>
            )}

            <button
              className="boundary-btn boundary-btn--danger"
              onClick={clearFocusedBoundary}
              disabled={savingBoundary || (!focusedBoundaryFromFarm && !draftBoundaryGeometry)}
              title="Remove saved boundary and fall back to point + radius"
            >
              Clear
            </button>
          </div>
          {boundarySaveError ? <div className="map-boundary-banner__error">{boundarySaveError}</div> : null}
          {editBoundaryMode ? (
            <div className="map-boundary-banner__hint">
              Use the draw tools on the map to create a polygon around the farm. Then click Save.
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="map-content">
        {/* Map Controls */}
        <div className="map-controls">
          <div className="map-view-toggle">
            <button
              className={`view-btn ${mapView === 'street' ? 'active' : ''}`}
              onClick={() => setMapView('street')}
            >
              Street
            </button>
            <button
              className={`view-btn ${mapView === 'satellite' ? 'active' : ''}`}
              onClick={() => setMapView('satellite')}
            >
              Satellite
            </button>
          </div>

          <div className="map-overlay-controls">
            <label className="overlay-toggle" title="Show colored coverage areas">
              <input
                type="checkbox"
                checked={showCoverage}
                onChange={(e) => setShowCoverage(e.target.checked)}
              />
              Coverage
            </label>

            <label
              className="overlay-toggle"
              title={focusOnly && focusedFarmId ? 'Disabled in focused view' : 'Hide farms with data-quality warnings'}
            >
              <input
                type="checkbox"
                checked={hideWarningFarms}
                onChange={(e) => setHideWarningFarms(e.target.checked)}
                disabled={Boolean(focusOnly && focusedFarmId)}
              />
              Hide warning farms
            </label>

            <label className="overlay-toggle" title="Show a scale bar">
              <input
                type="checkbox"
                checked={showScale}
                onChange={(e) => setShowScale(e.target.checked)}
              />
              Scale
            </label>

            <label className="overlay-toggle" title="Enable measuring distances and areas on the map">
              <input
                type="checkbox"
                checked={showMeasure}
                onChange={(e) => setShowMeasure(e.target.checked)}
              />
              Measure
            </label>

            {showCoverage ? (
              <label className="overlay-radius" title="Coverage radius for farms without boundaries">
                Radius
                <input
                  type="number"
                  min={0.25}
                  max={50}
                  step={0.25}
                  value={coverageRadiusKm}
                  onChange={(e) => setCoverageRadiusKm(Number(e.target.value) || 0)}
                />
                km
              </label>
            ) : null}
          </div>

          <button
            className="fullscreen-btn"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? '⊗' : '⛶'}
          </button>
        </div>

        <MapContainer
          center={[-1.9403, 29.8739]} // Rwanda center
          zoom={9}
          className="leaflet-map"
          style={{ height: '100%', width: '100%' }}
        >
          <MapBoundaryEditor
            enabled={Boolean(editBoundaryMode && focusOnly && focusedFarmId)}
            initialBoundaryFeature={focusedBoundaryFromFarm}
            onDraftGeometryChange={setDraftBoundaryGeometry}
          />
          <MapTools showScale={showScale} showMeasure={showMeasure} />
          <MapAutoFocus
            enabled={focusOnly && Boolean(selectedFarm)}
            farm={selectedFarm}
            boundary={focusedBoundary}
            fallbackRadiusKm={selectedFarm ? getCoverageRadiusMeters(selectedFarm) / 1000 : coverageRadiusKm}
          />

          {/* Conditional TileLayer based on mapView */}
          {mapView === 'street' ? (
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          ) : (
            <TileLayer
              attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
          )}
          
          {visibleFarms.map((farm, index) => {
            const coordinates = getFarmCoordinates(farm, index);
            const riskLevel = getRiskLevel(farm.id);
            const icon = createMarkerIcon(riskLevel);
            const farmPredictions = getFarmPredictions(farm.id);
            const avgRisk = farmPredictions.length > 0
              ? (farmPredictions.reduce((sum, p) => sum + (p.risk_score || 0), 0) / farmPredictions.length).toFixed(1)
              : 'N/A';

            const boundary = (focusOnly && farm.id === focusedFarmId && draftBoundaryGeometry)
              ? normalizeBoundaryGeoJson(draftBoundaryGeometry)
              : normalizeBoundaryGeoJson(farm.boundary);
            const hasBoundary = Boolean(boundary);

            const handleSelectFarm = () => {
              setSelectedFarm({
                ...farm,
                latitude: coordinates[0],
                longitude: coordinates[1]
              });
            };

            return (
              <React.Fragment key={farm.id}>
                {showCoverage && hasBoundary ? (
                  <GeoJSON
                    data={boundary}
                    pathOptions={{
                      color: getRiskColor(riskLevel),
                      weight: selectedFarm?.id === farm.id ? 3 : 2,
                      fillColor: getRiskColor(riskLevel),
                      fillOpacity: 0.2,
                    }}
                    eventHandlers={{
                      click: handleSelectFarm,
                    }}
                  />
                ) : null}

                {showCoverage && !hasBoundary ? (
                  <Circle
                    center={coordinates}
                    radius={getCoverageRadiusMeters(farm)}
                    pathOptions={{
                      color: getRiskColor(riskLevel),
                      weight: selectedFarm?.id === farm.id ? 2 : 1,
                      fillColor: getRiskColor(riskLevel),
                      fillOpacity: 0.12,
                    }}
                    eventHandlers={{
                      click: handleSelectFarm,
                    }}
                  />
                ) : null}

                <Marker
                  position={coordinates}
                  icon={icon}
                  eventHandlers={{
                    click: handleSelectFarm,
                  }}
                >
                  <Popup>
                    <div className="map-popup">
                      <h3>{farm.name}</h3>
                      <div className="popup-content">
                        <p><strong>Crop Type:</strong> {farm.crop_type || 'Unknown'}</p>
                        <p><strong>Location:</strong> {farm.location || 'N/A'}</p>
                        <p><strong>Area:</strong> {farm.area || 'N/A'} ha</p>
                          <p>
                            <strong>Coordinates:</strong>{' '}
                            {farm.latitude && farm.longitude
                              ? `${farm.latitude.toFixed(4)}, ${farm.longitude.toFixed(4)}`
                              : `${coordinates[0].toFixed(4)}, ${coordinates[1].toFixed(4)} (generated)`}
                          </p>
                        <p><strong>Boundary:</strong> {boundary ? 'Available' : 'Not set'}</p>
                        <p><strong>Coverage:</strong> {boundary ? 'Farm boundary polygon' : (farm.area ? `Circle from area (${farm.area} ha)` : `Circle (${coverageRadiusKm} km)`)}</p>
                          {(() => {
                            const flags = getFarmQualityFlags(farm.id);
                            return flags.length ? (
                              <p><strong>Data quality:</strong> {flags.map(formatQualityFlag).join(' • ')}</p>
                            ) : (
                              <p><strong>Data quality:</strong> OK</p>
                            );
                          })()}
                        <p><strong>Risk Level:</strong> <span className={`risk-badge-inline risk-${riskLevel}`}>{getRiskLabel(riskLevel)}</span></p>
                        <p><strong>Average Risk:</strong> {avgRisk}%</p>
                        <p><strong>Active Predictions:</strong> {farmPredictions.length}</p>
                      </div>
                      <button 
                        className="popup-details-btn"
                        onClick={handleSelectFarm}
                      >
                        View Full Details →
                      </button>
                    </div>
                  </Popup>
                </Marker>
              </React.Fragment>
            );
          })}
        </MapContainer>

        {/* Farm details panel */}
        {selectedFarm && (
          <div className="farm-details-panel">
            <div className="panel-header">
              <h3>{selectedFarm.name}</h3>
              <button 
                className="close-btn" 
                onClick={() => setSelectedFarm(null)}
              >
                ✕
              </button>
            </div>
            
            <div className="panel-content">
              <div className="detail-section">
                <h4>Farm Information</h4>
                <div className="detail-row">
                  <span className="detail-label">Crop Type:</span>
                  <span className="detail-value">{selectedFarm.crop_type || 'Unknown'}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Location:</span>
                  <span className="detail-value">{selectedFarm.location || 'N/A'}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Area:</span>
                  <span className="detail-value">{selectedFarm.area || 'N/A'} ha</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Coordinates:</span>
                  <span className="detail-value">
                    {selectedFarm.latitude && selectedFarm.longitude 
                      ? `${selectedFarm.latitude.toFixed(6)}, ${selectedFarm.longitude.toFixed(6)}`
                      : 'N/A'}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Data quality:</span>
                  <span className="detail-value">
                    {(() => {
                      const flags = getFarmQualityFlags(selectedFarm.id);
                      return flags.length ? flags.map(formatQualityFlag).join(' • ') : 'OK';
                    })()}
                  </span>
                </div>
              </div>

              <div className="detail-section">
                <h4>Risk Assessment</h4>
                {getFarmPredictions(selectedFarm.id).slice(0, 5).map((pred, idx) => (
                  <div key={idx} className="prediction-item">
                    <div className="prediction-header">
                      <span className="prediction-crop">{pred.crop_type || 'Unknown Crop'}</span>
                      <span className={`risk-badge risk-${getRiskLevel(selectedFarm.id)}`}>
                        {pred.risk_score || 0}% Risk
                      </span>
                    </div>
                    {pred.primary_drivers && (
                      <div className="prediction-drivers">
                        <small>
                          Drivers: {pred.primary_drivers.slice(0, 2).join(', ')}
                        </small>
                      </div>
                    )}
                  </div>
                ))}
                {getFarmPredictions(selectedFarm.id).length === 0 && (
                  <p className="no-data">No risk predictions available</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RiskMap;
