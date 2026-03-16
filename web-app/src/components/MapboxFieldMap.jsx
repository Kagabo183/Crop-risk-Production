import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import * as turf from '@turf/turf'
import { Crosshair, Layers, Navigation, Square, Trash2, Upload, Wand2 } from 'lucide-react'

const RWANDA_CENTER = [30.0619, -1.9441]

// Note: polygon styling + raster overlays are handled via Mapbox layers.

export default function MapboxFieldMap({
  height = 440,
  initialBoundary = null,
  onBoundaryChange,
  onAreaChange,
  onLocationChange,
  existingFields = [],
  selectedFieldId = null,
  onSelectField,
  readOnly = false,
  metric = 'ndvi',
  onMetricChange,
  focusOnSelect = false,
  enableDrawing = true,
  rasterTiles = null,
  rasterVisible = true,
  onRasterVisibleChange,
  onUploadGeoJson,
}) {
  const mapRef = useRef(null)
  const containerRef = useRef(null)
  const drawRef = useRef(null)
  const markerRef = useRef(null)
  const hoveredIdRef = useRef(null)
  const lastDrawnIdRef = useRef(null)
  const [areaHa, setAreaHa] = useState(null)
  const [coord, setCoord] = useState({ lat: null, lon: null })
  const [tokenMissing, setTokenMissing] = useState(false)

  // Initialise map
  useEffect(() => {
    const token = import.meta.env.VITE_MAPBOX_TOKEN || ''
    mapboxgl.accessToken = token
    if (!token) {
      setTokenMissing(true)
      return
    }

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: RWANDA_CENTER,
      zoom: 10,
    })

    // Per UX spec: only request browser location when the user presses the Locate button.
    // Map loads centered on Rwanda by default.

    if (enableDrawing) {
      const draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: {},
        defaultMode: 'simple_select',
        modes: MapboxDraw.modes,
      })
      drawRef.current = draw
      map.addControl(draw, 'top-left')

      map.on('draw.create', handleDrawChange)
      map.on('draw.update', handleDrawChange)
      map.on('draw.delete', handleDrawDelete)

      map.on('draw.modechange', (evt) => {
        const mode = evt?.mode || draw.getMode?.() || ''
        if (mode.includes('draw_')) {
          map.getCanvas().style.cursor = 'crosshair'
        } else {
          map.getCanvas().style.cursor = ''
        }
      })

      // preload initial boundary
      if (initialBoundary) {
        addBoundaryToDraw(initialBoundary)
      }
    }

    map.on('load', () => {
      addFieldLayers(map, existingFields, selectedFieldId, metric)
      map.addLayer({
        id: 'fields-label',
        type: 'symbol',
        source: 'fields-src',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 12,
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#f8fafc',
          'text-halo-width': 1.2,
          'text-halo-color': 'rgba(15,23,42,0.8)',
        },
      })
    })

    map.on('click', 'fields-fill', (e) => {
      const feature = e.features?.[0]
      if (!feature) return
      const id = feature.properties?.id
      if (id && onSelectField) onSelectField(Number(id))
      zoomToFeature(map, feature)
    })

    map.on('mousemove', 'fields-fill', (e) => {
      if (drawRef.current?.getMode?.()?.includes('draw_')) return
      map.getCanvas().style.cursor = 'pointer'
      const feature = e.features?.[0]
      if (!feature) return
      const fid = feature.id
      if (hoveredIdRef.current && hoveredIdRef.current !== fid) {
        map.setFeatureState({ source: 'fields-src', id: hoveredIdRef.current }, { hover: false })
      }
      hoveredIdRef.current = fid
      map.setFeatureState({ source: 'fields-src', id: fid }, { hover: true })
    })

    map.on('mouseleave', 'fields-fill', () => {
      if (!drawRef.current?.getMode?.()?.includes('draw_')) {
        map.getCanvas().style.cursor = ''
      }
      if (hoveredIdRef.current != null) {
        map.setFeatureState({ source: 'fields-src', id: hoveredIdRef.current }, { hover: false })
      }
      hoveredIdRef.current = null
    })

    map.on('click', (e) => {
      if (readOnly && !enableDrawing) return
      // only handle bare map clicks (ignore draw active state that sets draw mode)
      if (drawRef.current && drawRef.current.getMode() === 'simple_select') {
        handleLocationChange(e.lngLat.lat, e.lngLat.lng)
      }
    })

    mapRef.current = map
    return () => {
      if (map) map.remove()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep boundary in draw when prop changes (e.g., editing existing farm)
  useEffect(() => {
    if (!initialBoundary || !drawRef.current || !mapRef.current) return
    addBoundaryToDraw(initialBoundary)
  }, [initialBoundary])

  // Update field polygons when list or selection changes
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!map.isStyleLoaded()) {
      map.once('load', () => addFieldLayers(map, existingFields, selectedFieldId, metric))
      return
    }
    addFieldLayers(map, existingFields, selectedFieldId, metric)
  }, [existingFields, selectedFieldId, metric])

  // Handle raster overlays (NDVI/NDRE/EVI/SAVI tiles)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    const sourceId = 'raster-tiles'
    const layerId = 'raster-layer'

    const removeLayer = () => {
      if (map.getLayer(layerId)) map.removeLayer(layerId)
      if (map.getSource(sourceId)) map.removeSource(sourceId)
    }

    if (!rasterTiles || !rasterTiles.tiles?.length) {
      removeLayer()
      return
    }

    if (map.getSource(sourceId)) removeLayer()

    map.addSource(sourceId, {
      type: 'raster',
      tiles: rasterTiles.tiles,
      tileSize: rasterTiles.tileSize || 256,
      minzoom: rasterTiles.minzoom || 6,
      maxzoom: rasterTiles.maxzoom || 18,
    })

    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: {
          'raster-opacity': 0.78,
        },
      }, map.getLayer('fields-fill') ? 'fields-fill' : undefined)
    }

    return removeLayer
  }, [rasterTiles])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const layerId = 'raster-layer'
    if (!map.getLayer(layerId)) return
    try {
      map.setLayoutProperty(layerId, 'visibility', rasterVisible ? 'visible' : 'none')
    } catch {
      /* ignore */
    }
  }, [rasterVisible])

  // focus map when selection changes
  useEffect(() => {
    if (!focusOnSelect || !selectedFieldId || !mapRef.current) return
    const selected = existingFields.find(f => f.id === selectedFieldId)
    if (!selected || !selected.boundary_geojson) return
    const feature = {
      type: 'Feature',
      geometry: typeof selected.boundary_geojson === 'string'
        ? JSON.parse(selected.boundary_geojson)
        : selected.boundary_geojson,
    }
    zoomToFeature(mapRef.current, feature)
  }, [focusOnSelect, selectedFieldId, existingFields])

  const flyTo = (map, lon, lat, zoom = 13) => {
    map.flyTo({ center: [lon, lat], zoom, speed: 0.9, essential: true })
  }

  const handleLocationChange = (lat, lon) => {
    setCoord({ lat, lon })
    if (onLocationChange) onLocationChange(lat, lon)
    const map = mapRef.current
    if (!map) return
    if (!markerRef.current) {
      markerRef.current = new mapboxgl.Marker({ color: '#0ea5e9' })
    }
    markerRef.current.setLngLat([lon, lat]).addTo(map)
  }

  const addBoundaryToDraw = (geometry) => {
    const draw = drawRef.current
    const map = mapRef.current
    if (!draw || !map) return

    draw.deleteAll()
    const feature = {
      type: 'Feature',
      geometry,
      properties: {},
    }
    const added = draw.add(feature)
    const f = draw.get(added[0])
    if (f) {
      zoomToFeature(map, f)
      pushBoundaryUpdates(f)
    }
  }

  const handleDrawChange = (e) => {
    const draw = drawRef.current
    if (!draw) return
    const all = draw.getAll()
    const feature = all.features?.[0]
    if (feature) {
      lastDrawnIdRef.current = feature.id || lastDrawnIdRef.current
      pushBoundaryUpdates(feature)
      zoomToFeature(mapRef.current, feature)
    }
  }

  const handleDrawDelete = () => {
    setAreaHa(null)
    if (onAreaChange) onAreaChange(null)
    if (onBoundaryChange) onBoundaryChange(null)
  }

  const pushBoundaryUpdates = (feature) => {
    const centroid = turf.centroid(feature)
    const [lon, lat] = centroid.geometry.coordinates
    handleLocationChange(lat, lon)

    const area = turf.area(feature) / 10000
    setAreaHa(area)
    if (onAreaChange) onAreaChange(area)
    if (onBoundaryChange) onBoundaryChange(feature.geometry, area)
  }

  const zoomToFeature = (map, feature) => {
    if (!map || !feature) return
    const bbox = turf.bbox(feature)
    map.fitBounds(
      [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[3]],
      ],
      { padding: 28 }
    )
  }

  const startDrawing = () => {
    if (!drawRef.current) return
    drawRef.current.changeMode('draw_polygon')
  }

  const startEditing = () => {
    const draw = drawRef.current
    if (!draw) return
    const all = draw.getAll?.()
    const first = all?.features?.[0]
    const featureId = first?.id || lastDrawnIdRef.current
    if (featureId) {
      try {
        draw.changeMode('direct_select', { featureId })
        return
      } catch {
        /* fall back */
      }
    }
    draw.changeMode('simple_select')
  }

  const locateMe = () => {
    const map = mapRef.current
    if (!map) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        flyTo(map, longitude, latitude, 16)
        handleLocationChange(latitude, longitude)
      },
      () => flyTo(map, RWANDA_CENTER[0], RWANDA_CENTER[1], 12),
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  const clearDrawing = () => {
    if (!drawRef.current) return
    drawRef.current.deleteAll()
    lastDrawnIdRef.current = null
    setAreaHa(null)
    if (onBoundaryChange) onBoundaryChange(null)
    if (onAreaChange) onAreaChange(null)
  }

  if (tokenMissing) {
    return (
      <div style={{ height, border: '1px solid #e5e7eb', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fffbe6', color: '#92400e', padding: 16 }}>
        Set VITE_MAPBOX_TOKEN to use the interactive map.
      </div>
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height, borderRadius: 10, overflow: 'hidden', border: '1px solid #e2e8f0' }}
      />

      {enableDrawing && (
        <div className="map-control-stack" role="group" aria-label="Map controls">
          <button className="map-ctrl" type="button" onClick={locateMe} title="Locate Me" aria-label="Locate Me">
            <Navigation size={18} />
          </button>
          <button className="map-ctrl" type="button" onClick={startDrawing} title="Draw Field" aria-label="Draw Field">
            <Square size={18} />
          </button>
          {!readOnly && (
            <button className="map-ctrl" type="button" onClick={startEditing} title="Edit Field" aria-label="Edit Field">
              <Wand2 size={18} />
            </button>
          )}
          <button className="map-ctrl danger" type="button" onClick={clearDrawing} title="Delete Field" aria-label="Delete Field">
            <Trash2 size={18} />
          </button>
          <button className="map-ctrl" type="button" onClick={() => onUploadGeoJson?.()} title="Upload GeoJSON" aria-label="Upload GeoJSON">
            <Upload size={18} />
          </button>

          {typeof onMetricChange === 'function' && (
            <div className="map-layer-stack" role="group" aria-label="Layer selector">
              <div className="map-layer-stack__title"><Layers size={14} /> Layer</div>
              {['ndvi', 'ndre', 'evi', 'savi'].map((k) => {
                const active = (metric || 'ndvi') === k
                return (
                  <button
                    key={k}
                    type="button"
                    className={`map-layer-btn${active ? ' active' : ''}`}
                    onClick={() => {
                      if (active) {
                        onRasterVisibleChange?.(!rasterVisible)
                      } else {
                        onMetricChange(k)
                        onRasterVisibleChange?.(true)
                      }
                    }}
                    title={`${k.toUpperCase()} overlay`}
                    aria-label={`${k.toUpperCase()} overlay`}
                  >
                    {k.toUpperCase()}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div style={{ position: 'absolute', bottom: 12, right: 12, padding: '6px 10px', background: '#0f172a', color: '#e2e8f0', borderRadius: 6, fontSize: 12, display: 'flex', gap: 12, alignItems: 'center', boxShadow: '0 6px 16px rgba(0,0,0,0.22)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Crosshair size={14} />
          {coord.lat && coord.lon ? `${coord.lat.toFixed(5)}, ${coord.lon.toFixed(5)}` : 'Click map to set location'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <RulerIcon />
          {areaHa ? `${areaHa.toFixed(2)} ha` : 'Draw polygon to measure'}
        </div>
      </div>
    </div>
  )
}

// helper: render field polygons layer
function addFieldLayers(map, fields, selectedId, metric = 'ndvi') {
  if (!map?.getStyle()) return
  const features = (fields || [])
    .filter(f => f.boundary_geojson)
    .map(f => ({
      type: 'Feature',
      geometry: typeof f.boundary_geojson === 'string' ? JSON.parse(f.boundary_geojson) : f.boundary_geojson,
      properties: {
        id: f.id,
        name: f.name,
        selected: f.id === selectedId ? 1 : 0,
      },
      id: f.id,
    }))

  const data = { type: 'FeatureCollection', features }
  if (map.getSource('fields-src')) {
    map.getSource('fields-src').setData(data)
  } else {
    map.addSource('fields-src', { type: 'geojson', data })
    map.addLayer({
      id: 'fields-fill',
      type: 'fill',
      source: 'fields-src',
      paint: {
        'fill-color': '#00ff78',
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false], 0.35,
          ['==', ['get', 'selected'], 1], 0.35,
          0.25,
        ],
      },
    })
    map.addLayer({
      id: 'fields-outline',
      type: 'line',
      source: 'fields-src',
      paint: {
        'line-color': '#ffffff',
        'line-width': [
          'case',
          ['==', ['get', 'selected'], 1], 4,
          2,
        ],
      },
    })
  }
}

function RulerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V3a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v18l4-4h12a2 2 0 0 0 2-2Z" />
      <path d="M7 8h4" />
      <path d="M7 12h2" />
      <path d="M7 16h1" />
    </svg>
  )
}
