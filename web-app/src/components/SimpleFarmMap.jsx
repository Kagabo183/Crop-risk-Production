import { useEffect, useRef } from 'react'

/**
 * Simple Farm Map Component
 *
 * Shows farm location and boundary on OpenStreetMap using Leaflet
 * No complex features - just visualization of detected boundary
 */
export default function SimpleFarmMap({ latitude, longitude, boundary }) {
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const layersRef = useRef({ marker: null, polygon: null })

  useEffect(() => {
    // Only initialize if Leaflet is loaded and we have a map container
    if (!mapRef.current || !window.L) {
      console.warn('Leaflet not loaded. Add Leaflet CDN to index.html')
      return
    }

    // Initialize map if not already done
    if (!mapInstance.current) {
      const L = window.L

      const map = L.map(mapRef.current, {
        center: [latitude || -1.95, longitude || 30.06],
        zoom: 15,
        zoomControl: true,
      })

      // Add OpenStreetMap tiles
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map)

      mapInstance.current = map
    }

    // Update map center and marker
    if (latitude && longitude) {
      const L = window.L
      const map = mapInstance.current

      // Remove old marker if exists
      if (layersRef.current.marker) {
        map.removeLayer(layersRef.current.marker)
      }

      // Add new marker
      const marker = L.marker([latitude, longitude], {
        title: 'Farm Center',
      }).addTo(map)
      marker.bindPopup(`<b>Farm Location</b><br>Lat: ${latitude.toFixed(6)}<br>Lon: ${longitude.toFixed(6)}`)
      layersRef.current.marker = marker

      map.setView([latitude, longitude], 15)
    }

    // Update boundary polygon
    if (boundary) {
      const L = window.L
      const map = mapInstance.current

      try {
        // Remove old polygon if exists
        if (layersRef.current.polygon) {
          map.removeLayer(layersRef.current.polygon)
        }

        // Convert GeoJSON to Leaflet coordinates [lat, lon]
        const coords = boundary.coordinates[0].map(([lon, lat]) => [lat, lon])

        // Add polygon
        const polygon = L.polygon(coords, {
          color: '#16a34a',
          fillColor: '#22c55e',
          fillOpacity: 0.3,
          weight: 2,
        }).addTo(map)

        polygon.bindPopup('<b>Farm Boundary</b><br>Detected from satellite')
        layersRef.current.polygon = polygon

        // Fit map to show entire boundary
        map.fitBounds(polygon.getBounds(), { padding: [50, 50] })
      } catch (error) {
        console.error('Error drawing boundary:', error)
      }
    }

    // Cleanup on unmount
    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove()
        mapInstance.current = null
      }
    }
  }, [latitude, longitude, boundary])

  // Check if Leaflet is available
  if (typeof window !== 'undefined' && !window.L) {
    return (
      <div style={{
        padding: 20,
        textAlign: 'center',
        background: '#fef3c7',
        border: '1px solid #f59e0b',
        borderRadius: 8,
      }}>
        <p style={{ fontSize: 13, color: '#92400e', margin: 0 }}>
          📍 Map not available. Add Leaflet to <code>index.html</code> to visualize boundary.
        </p>
        <p style={{ fontSize: 11, color: '#78350f', marginTop: 4 }}>
          See <a href="https://leafletjs.com/download.html" target="_blank" rel="noopener noreferrer">Leaflet Setup</a>
        </p>
      </div>
    )
  }

  return (
    <div
      ref={mapRef}
      style={{
        width: '100%',
        height: '400px',
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid #e5e7eb',
      }}
    />
  )
}
