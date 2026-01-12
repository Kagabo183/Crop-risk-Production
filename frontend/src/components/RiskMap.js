import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, GeoJSON } from 'react-leaflet';
import L from 'leaflet';
import { fetchFarms, fetchEnrichedPredictions } from '../api';
import 'leaflet/dist/leaflet.css';
import './RiskMap.css';

// Fix Leaflet default marker icon issue
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

const RiskMap = () => {
  const [searchParams] = useSearchParams();
  const [farms, setFarms] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [selectedFarm, setSelectedFarm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mapView, setMapView] = useState('street'); // 'street' or 'satellite'
  const [isFullscreen, setIsFullscreen] = useState(false);
  const locationCacheRef = useRef({}); // Cache for geocoded locations

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
    const farmIdParam = searchParams.get('farmId');
    if (farmIdParam && farms.length > 0) {
      const farm = farms.find(f => f.id === parseInt(farmIdParam));
      if (farm) {
        setSelectedFarm(farm);
        // Get location details if coordinates exist
        const coords = getFarmCoordinates(farm, farms.indexOf(farm));
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
  }, [searchParams, farms, reverseGeocode]);

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

  const getRiskLevel = (farmId) => {
    const farmPredictions = predictions.filter(p => p.farm_id === farmId);
    if (farmPredictions.length === 0) return 'unknown';
    
    const avgRisk = farmPredictions.reduce((sum, p) => sum + (p.risk_score || 0), 0) / farmPredictions.length;
    
    if (avgRisk >= 75) return 'critical';
    if (avgRisk >= 50) return 'high';
    if (avgRisk >= 25) return 'medium';
    return 'low';
  };

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

  const normalizeBoundaryGeoJson = (boundary) => {
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
  };

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
          <p>{farms.length} farms • Rwanda's monitored agricultural areas</p>
        </div>
        <div className="map-legend">
          <div className="legend-item">
            <div className="legend-color" style={{ background: '#dc3545' }}></div>
            <span>Critical ({predictions.filter(p => getRiskLevel(p.farm_id) === 'critical').length})</span>
          </div>
          <div className="legend-item">
            <div className="legend-color" style={{ background: '#fd7e14' }}></div>
            <span>High ({predictions.filter(p => getRiskLevel(p.farm_id) === 'high').length})</span>
          </div>
          <div className="legend-item">
            <div className="legend-color" style={{ background: '#ffc107' }}></div>
            <span>Medium ({predictions.filter(p => getRiskLevel(p.farm_id) === 'medium').length})</span>
          </div>
          <div className="legend-item">
            <div className="legend-color" style={{ background: '#198754' }}></div>
            <span>Low ({predictions.filter(p => getRiskLevel(p.farm_id) === 'low').length})</span>
          </div>
          <div className="legend-item">
            <div className="legend-color" style={{ background: '#6c757d' }}></div>
            <span>No Data</span>
          </div>
        </div>
      </div>

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
          
          {farms.map((farm, index) => {
            const coordinates = getFarmCoordinates(farm, index);
            const riskLevel = getRiskLevel(farm.id);
            const icon = createMarkerIcon(riskLevel);
            const farmPredictions = getFarmPredictions(farm.id);
            const avgRisk = farmPredictions.length > 0
              ? (farmPredictions.reduce((sum, p) => sum + (p.risk_score || 0), 0) / farmPredictions.length).toFixed(1)
              : 'N/A';

            const boundary = normalizeBoundaryGeoJson(farm.boundary);

            const handleSelectFarm = () => {
              setSelectedFarm({
                ...farm,
                latitude: coordinates[0],
                longitude: coordinates[1]
              });
            };

            return (
              <React.Fragment key={farm.id}>
                {boundary ? (
                  <GeoJSON
                    data={boundary}
                    pathOptions={{
                      color: getRiskColor(riskLevel),
                      weight: selectedFarm?.id === farm.id ? 3 : 2,
                      fillColor: getRiskColor(riskLevel),
                      fillOpacity: 0.15,
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
                        <p><strong>Coordinates:</strong> {farm.latitude && farm.longitude ? `${farm.latitude.toFixed(4)}, ${farm.longitude.toFixed(4)}` : `${coordinates[0].toFixed(4)}, ${coordinates[1].toFixed(4)}`}</p>
                        <p><strong>Boundary:</strong> {boundary ? 'Available' : 'Not set'}</p>
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
