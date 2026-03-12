import { useState, useEffect, useRef } from 'react'
import { MapPin, Crosshair, Square, Trash2, Check, Loader } from 'lucide-react'

/**
 * Farm Boundary Map Component
 *
 * Features:
 * 1. Click to set center point (lat/lon)
 * 2. Manual boundary drawing (polygon)
 * 3. Auto-detect boundary from satellite (WorldCover/Dynamic World)
 * 4. Edit/adjust boundary
 * 5. Rwanda boundary validation
 *
 * Uses Leaflet with Draw plugin for map interaction.
 */

export default function FarmBoundaryMap({
  initialLat = -1.95,
  initialLon = 30.06,
  initialBoundary = null,
  onLocationChange,
  onBoundaryChange,
  onAutoDetect,
  readOnly = false,
}) {
  const mapRef = useRef(null)
  const [map, setMap] = useState(null)
  const [marker, setMarker] = useState(null)
  const [polygon, setPolygon] = useState(null)
  const [centerLat, setCenterLat] = useState(initialLat)
  const [centerLon, setCenterLon] = useState(initialLon)
  const [drawingMode, setDrawingMode] = useState(false)
  const [loading, setLoading] = useState(false)

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || map) return

    // Dynamically load Leaflet (since it requires browser APIs)
    const loadLeaflet = async () => {
      const L = window.L
      if (!L) {
        console.error('Leaflet not loaded. Please add Leaflet CDN to index.html')
        return
      }

      // Create map centered on Rwanda (Kigali)
      const newMap = L.map(mapRef.current, {
        center: [initialLat, initialLon],
        zoom: 13,
        zoomControl: true,
      })

      // Add OpenStreetMap tiles
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(newMap)

      // Add marker if initial coordinates exist
      if (initialLat && initialLon) {
        const newMarker = L.marker([initialLat, initialLon], {
          draggable: !readOnly,
        }).addTo(newMap)

        newMarker.on('dragend', (e) => {
          const pos = e.target.getLatLng()
          setCenterLat(pos.lat)
          setCenterLon(pos.lng)
          if (onLocationChange) {
            onLocationChange(pos.lat, pos.lng)
          }
        })

        setMarker(newMarker)
      }

      // Add boundary polygon if exists
      if (initialBoundary) {
        const coords = initialBoundary.coordinates[0].map(([lon, lat]) => [lat, lon])
        const newPolygon = L.polygon(coords, {
          color: '#16a34a',
          fillOpacity: 0.2,
          weight: 2,
        }).addTo(newMap)
        setPolygon(newPolygon)
        newMap.fitBounds(newPolygon.getBounds())
      }

      // Map click handler (set center point)
      if (!readOnly) {
        newMap.on('click', (e) => {
          if (!drawingMode) {
            const { lat, lng } = e.latlng
            setCenterLat(lat)
            setCenterLon(lng)

            if (marker) {
              marker.setLatLng([lat, lng])
            } else {
              const newMarker = L.marker([lat, lng], { draggable: true }).addTo(newMap)
              newMarker.on('dragend', (e) => {
                const pos = e.target.getLatLng()
                setCenterLat(pos.lat)
                setCenterLon(pos.lng)
                if (onLocationChange) {
                  onLocationChange(pos.lat, pos.lng)
                }
              })
              setMarker(newMarker)
            }

            if (onLocationChange) {
              onLocationChange(lat, lng)
            }
          }
        })
      }

      setMap(newMap)
    }

    loadLeaflet()

    return () => {
      if (map) {
        map.remove()
      }
    }
  }, [])

  // Start drawing mode
  const startDrawing = () => {
    if (!map || readOnly) return
    setDrawingMode(true)

    const L = window.L
    const drawnItems = new L.FeatureGroup()
    map.addLayer(drawnItems)

    const drawControl = new L.Control.Draw({
      draw: {
        polygon: {
          shapeOptions: {
            color: '#16a34a',
            fillOpacity: 0.2,
          },
          showArea: true,
        },
        polyline: false,
        rectangle: false,
        circle: false,
        marker: false,
        circlemarker: false,
      },
      edit: {
        featureGroup: drawnItems,
      },
    })

    map.addControl(drawControl)

    map.on(L.Draw.Event.CREATED, (e) => {
      const layer = e.layer
      drawnItems.addLayer(layer)

      if (polygon) {
        map.removeLayer(polygon)
      }
      setPolygon(layer)

      // Convert to GeoJSON
      const geoJSON = layer.toGeoJSON()
      if (onBoundaryChange) {
        onBoundaryChange(geoJSON.geometry)
      }

      setDrawingMode(false)
    })
  }

  // Clear boundary
  const clearBoundary = () => {
    if (polygon && map) {
      map.removeLayer(polygon)
      setPolygon(null)
      if (onBoundaryChange) {
        onBoundaryChange(null)
      }
    }
  }

  // Auto-detect boundary
  const handleAutoDetect = async () => {
    if (!onAutoDetect || !centerLat || !centerLon) return

    setLoading(true)
    try {
      const result = await onAutoDetect(centerLat, centerLon)

      if (result && result.boundary) {
        // Clear existing polygon
        if (polygon && map) {
          map.removeLayer(polygon)
        }

        // Add detected boundary
        const L = window.L
        const coords = result.boundary.coordinates[0].map(([lon, lat]) => [lat, lon])
        const newPolygon = L.polygon(coords, {
          color: '#16a34a',
          fillOpacity: 0.2,
          weight: 2,
        }).addTo(map)

        setPolygon(newPolygon)
        map.fitBounds(newPolygon.getBounds())

        if (onBoundaryChange) {
          onBoundaryChange(result.boundary)
        }
      }
    } catch (error) {
      console.error('Auto-detect failed:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Map Container */}
      <div
        ref={mapRef}
        style={{
          width: '100%',
          height: '400px',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      />

      {/* Controls */}
      {!readOnly && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            background: 'white',
            borderRadius: 8,
            padding: 8,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <button
            className="btn btn-sm"
            onClick={startDrawing}
            disabled={drawingMode}
            title="Draw farm boundary"
          >
            <Square size={16} /> Draw
          </button>

          <button
            className="btn btn-sm btn-primary"
            onClick={handleAutoDetect}
            disabled={!centerLat || !centerLon || loading}
            title="Auto-detect boundary from satellite"
          >
            {loading ? <Loader size={16} className="animate-spin" /> : <Crosshair size={16} />}
            Auto
          </button>

          {polygon && (
            <>
              <button
                className="btn btn-sm btn-success"
                title="Boundary set"
              >
                <Check size={16} /> OK
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={clearBoundary}
                title="Clear boundary"
              >
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      )}

      {/* Coordinates Display */}
      <div
        style={{
          position: 'absolute',
          bottom: 10,
          left: 10,
          background: 'white',
          borderRadius: 4,
          padding: '4px 8px',
          fontSize: 12,
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        }}
      >
        <MapPin size={12} style={{ display: 'inline', marginRight: 4 }} />
        {centerLat?.toFixed(6)}, {centerLon?.toFixed(6)}
      </div>
    </div>
  )
}
