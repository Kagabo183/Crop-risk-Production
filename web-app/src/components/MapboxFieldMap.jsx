import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import * as turf from '@turf/turf'
import { ChevronDown, Crosshair, Layers, Minus, Navigation, Plus, Square, Trash2, Upload, Wand2 } from 'lucide-react'

const RWANDA_CENTER = [30.0619, -1.9441]

const LAYER_OPTIONS = [
  { key: 'ndvi', label: 'NDVI', description: 'Normalized Difference Vegetation Index' },
  { key: 'ndre', label: 'NDRE', description: 'Red-Edge Vegetation Index' },
  { key: 'evi', label: 'EVI', description: 'Enhanced Vegetation Index' },
  { key: 'savi', label: 'SAVI', description: 'Soil-Adjusted Vegetation Index' },
]

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
  selectedFieldName = null,
  weatherSummary = null,
  onDrawModeChange,
  activateDraw = false,
  onDrawStarted,
  productivityZones = null,
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
  const [layerMenuOpen, setLayerMenuOpen] = useState(false)
  const [showLegend, setShowLegend] = useState(true)
  const [mapPitch, setMapPitch] = useState(0)
  const [drawMode, setDrawMode] = useState('simple_select')
  const onDrawModeChangeRef = useRef(onDrawModeChange)
  useEffect(() => { onDrawModeChangeRef.current = onDrawModeChange }, [onDrawModeChange])

  // Auto-activate draw mode when activateDraw prop turns true
  useEffect(() => {
    if (!activateDraw || !drawRef.current || !mapRef.current) return
    // Small delay to ensure map & draw are ready
    const timer = setTimeout(() => {
      try {
        drawRef.current.deleteAll()
        drawRef.current.changeMode('draw_polygon')
        mapRef.current.getCanvas().style.cursor = 'crosshair'
        setDrawMode('draw_polygon')
        onDrawModeChangeRef.current?.(true)
        onDrawStarted?.()
      } catch {}
    }, 200)
    return () => clearTimeout(timer)
  }, [activateDraw, onDrawStarted])

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

    // Center on browser location on first load
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 16, speed: 1.2, essential: true })
        },
        () => { /* Permission denied — stay on Rwanda */ },
        { enableHighAccuracy: false, timeout: 5000 }
      )
    }

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
        const mode = evt?.mode || draw.getMode?.() || 'simple_select'
        const drawing = mode.includes('draw_')
        map.getCanvas().style.cursor = drawing ? 'crosshair' : ''
        setDrawMode(mode)
        onDrawModeChangeRef.current?.(drawing)
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
    if (!drawRef.current) return
    if (!initialBoundary) {
      // Clear draw tool when entering "create new field" mode
      drawRef.current.deleteAll()
      lastDrawnIdRef.current = null
      return
    }
    if (!mapRef.current) return
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

    const RASTER_SRC = 'raster-tiles'
    const RASTER_LAYER = 'raster-layer'

    const cleanup = () => {
      try { if (map.getLayer('ndvi-mask-layer')) map.removeLayer('ndvi-mask-layer') } catch {}
      try { if (map.getSource('ndvi-mask-src')) map.removeSource('ndvi-mask-src') } catch {}
      try { if (map.getLayer(RASTER_LAYER)) map.removeLayer(RASTER_LAYER) } catch {}
      try { if (map.getSource(RASTER_SRC)) map.removeSource(RASTER_SRC) } catch {}
    }

    const isDrawing = drawMode.includes('draw_')

    if (!rasterTiles || !rasterTiles.tiles?.length || isDrawing || !rasterVisible) {
      cleanup()
      return cleanup
    }

    if (map.getSource(RASTER_SRC)) cleanup()

    map.addSource(RASTER_SRC, {
      type: 'raster',
      tiles: rasterTiles.tiles,
      tileSize: rasterTiles.tileSize || 256,
      minzoom: rasterTiles.minzoom || 6,
      maxzoom: rasterTiles.maxzoom || 18,
    })

    const belowFields = map.getLayer('fields-selected-glow') ? 'fields-selected-glow'
      : map.getLayer('fields-fill') ? 'fields-fill' : undefined

    map.addLayer({
      id: RASTER_LAYER,
      type: 'raster',
      source: RASTER_SRC,
      paint: {
        'raster-opacity': 0.85,
        'raster-opacity-transition': { duration: 400, delay: 0 },
        'raster-resampling': 'linear',
      },
    }, belowFields)

    // --- Mask: dim everything OUTSIDE the field so NDVI colours don't spill across the map ---
    const field = existingFields.find(f => f.id === selectedFieldId)
    const rawGeom = field?.boundary_geojson
    if (rawGeom && selectedFieldId) {
      try {
        const geom = typeof rawGeom === 'string' ? JSON.parse(rawGeom) : rawGeom
        const fieldFeature = turf.feature(geom)
        // turf.mask returns world polygon with a field-shaped hole, so the fill only covers OUTSIDE
        const maskPoly = turf.mask(fieldFeature)
        map.addSource('ndvi-mask-src', { type: 'geojson', data: maskPoly })
        map.addLayer({
          id: 'ndvi-mask-layer',
          type: 'fill',
          source: 'ndvi-mask-src',
          paint: { 'fill-color': '#0a0e14', 'fill-opacity': 0.62 },
        }, belowFields)
      } catch (err) {
        console.warn('[MapboxFieldMap] mask error:', err)
      }
    }

    return cleanup
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rasterTiles, rasterVisible, drawMode, selectedFieldId, existingFields])

  // ── Productivity zone overlay ──────────────────────────────────────────────
  const zonePopupRef = useRef(null)

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    const ZONE_SRC = 'productivity-zones-src'
    const ZONE_FILL = 'productivity-zones-fill'
    const ZONE_LINE = 'productivity-zones-line'

    const cleanup = () => {
      // Remove popup
      if (zonePopupRef.current) { zonePopupRef.current.remove(); zonePopupRef.current = null }
      try { if (map.getLayer(ZONE_LINE)) map.removeLayer(ZONE_LINE) } catch {}
      try { if (map.getLayer(ZONE_FILL)) map.removeLayer(ZONE_FILL) } catch {}
      try { if (map.getSource(ZONE_SRC)) map.removeSource(ZONE_SRC) } catch {}
    }

    const isDrawing = drawMode.includes('draw_')
    const zones = productivityZones?.zones || productivityZones

    if (!zones || !Array.isArray(zones) || !zones.length || isDrawing || !selectedFieldId) {
      cleanup()
      return cleanup
    }

    // Build FeatureCollection from zone data
    const features = zones
      .filter(z => z.boundary_geojson || z.boundary)
      .map((z, i) => {
        let geom = z.boundary_geojson || z.boundary
        if (typeof geom === 'string') geom = JSON.parse(geom)
        return {
          type: 'Feature',
          geometry: geom,
          properties: {
            zone_class: z.zone_class,
            mean_ndvi: z.mean_ndvi,
            color_hex: z.color_hex || (z.zone_class === 'high' ? '#4CAF50' : z.zone_class === 'medium' ? '#FFC107' : '#F44336'),
            area_ha: z.area_ha,
            zone_index: z.zone_index ?? i,
          },
        }
      })

    if (!features.length) { cleanup(); return cleanup }

    cleanup()

    const fc = { type: 'FeatureCollection', features }

    map.addSource(ZONE_SRC, { type: 'geojson', data: fc })

    // Place zones above raster but below field outlines
    const below = map.getLayer('fields-selected-glow') ? 'fields-selected-glow'
      : map.getLayer('fields-fill') ? 'fields-fill' : undefined

    map.addLayer({
      id: ZONE_FILL,
      type: 'fill',
      source: ZONE_SRC,
      paint: {
        'fill-color': ['get', 'color_hex'],
        'fill-opacity': 0.35,
      },
    }, below)

    map.addLayer({
      id: ZONE_LINE,
      type: 'line',
      source: ZONE_SRC,
      paint: {
        'line-color': ['get', 'color_hex'],
        'line-width': 1.5,
        'line-opacity': 0.7,
      },
    }, below)

    // Hover tooltips
    const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: 'zone-tooltip' })
    zonePopupRef.current = popup

    const onMove = (e) => {
      map.getCanvas().style.cursor = 'pointer'
      const f = e.features?.[0]
      if (!f) return
      const p = f.properties
      const cls = (p.zone_class || '').charAt(0).toUpperCase() + (p.zone_class || '').slice(1)
      const ndvi = p.mean_ndvi != null ? Number(p.mean_ndvi).toFixed(3) : '—'
      const area = p.area_ha != null ? Number(p.area_ha).toFixed(2) + ' ha' : ''
      const rec = p.zone_class === 'low' ? 'Boost inputs' : p.zone_class === 'high' ? 'Reduce inputs' : 'Standard rate'
      popup.setLngLat(e.lngLat).setHTML(
        `<strong>${cls} zone</strong><br/>NDVI: ${ndvi}${area ? '<br/>' + area : ''}<br/><em>${rec}</em>`
      ).addTo(map)
    }
    const onLeave = () => {
      map.getCanvas().style.cursor = ''
      popup.remove()
    }

    map.on('mousemove', ZONE_FILL, onMove)
    map.on('mouseleave', ZONE_FILL, onLeave)

    return () => {
      map.off('mousemove', ZONE_FILL, onMove)
      map.off('mouseleave', ZONE_FILL, onLeave)
      cleanup()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productivityZones, drawMode, selectedFieldId])

  // focus map on selected field with smooth animation
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
    zoomToFeature(mapRef.current, feature, { padding: 60, duration: 900 })
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
    // Use newly created/updated feature from event, not features[0]
    // which could be a stale polygon from a previously selected field
    const evtFeature = e?.features?.[e.features.length - 1]
    const all = draw.getAll()
    const feature = evtFeature || all.features?.[all.features.length - 1]
    if (feature) {
      // Remove all other features so only the latest polygon remains
      const others = all.features.filter(f => f.id !== feature.id)
      others.forEach(f => { try { draw.delete(f.id) } catch {} })
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

  const zoomToFeature = (map, feature, opts = {}) => {
    if (!map || !feature) return
    const bbox = turf.bbox(feature)
    map.fitBounds(
      [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[3]],
      ],
      { padding: 28, ...opts }
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
      try { draw.changeMode('direct_select', { featureId }); return } catch { /* fall back */ }
    }
    draw.changeMode('simple_select')
  }

  const [locating, setLocating] = useState(false)

  const locateMe = () => {
    const map = mapRef.current
    if (!map || !navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        flyTo(map, pos.coords.longitude, pos.coords.latitude, 16)
        handleLocationChange(pos.coords.latitude, pos.coords.longitude)
        setLocating(false)
      },
      () => {
        flyTo(map, RWANDA_CENTER[0], RWANDA_CENTER[1], 12)
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const toggle3D = () => {
    const map = mapRef.current
    if (!map) return
    const newPitch = mapPitch === 0 ? 60 : 0
    map.easeTo({ pitch: newPitch, duration: 600 })
    setMapPitch(newPitch)
  }

  const zoomIn = () => { const map = mapRef.current; if (map) map.zoomIn() }
  const zoomOut = () => { const map = mapRef.current; if (map) map.zoomOut() }

  const clearDrawing = () => {
    if (!drawRef.current) return
    drawRef.current.deleteAll()
    lastDrawnIdRef.current = null
    setAreaHa(null)
    if (onBoundaryChange) onBoundaryChange(null)
    if (onAreaChange) onAreaChange(null)
  }

  const currentLayer = LAYER_OPTIONS.find(l => l.key === (metric || 'ndvi')) || LAYER_OPTIONS[0]

  // Weather data helpers
  const weatherTemp = weatherSummary?.current?.temperature_2m ?? weatherSummary?.daily?.temperature_2m_max?.[0] ?? null
  const weatherRain = weatherSummary?.daily?.precipitation_sum?.[0] ?? 0
  const weatherWind = weatherSummary?.current?.wind_speed_10m ?? weatherSummary?.daily?.wind_speed_10m_max?.[0] ?? null

  if (tokenMissing) {
    return (
      <div style={{ height, border: '1px solid #e5e7eb', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fffbe6', color: '#92400e', padding: 16 }}>
        Set VITE_MAPBOX_TOKEN to use the interactive map.
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: height === '100%' ? '100%' : height }} />

      {/* Mode indicator badge */}
      {drawMode.includes('draw_') && (
        <div className="map-mode-badge map-mode-badge--drawing">
          <Square size={12} style={{ flexShrink: 0 }} />
          Drawing — click to place corners · double-click to finish
        </div>
      )}
      {!drawMode.includes('draw_') && rasterTiles && rasterVisible && selectedFieldId && (
        <div className="map-mode-badge map-mode-badge--analyzing">
          <Layers size={12} style={{ flexShrink: 0 }} />
          NDVI view · {(selectedFieldName || 'Field').slice(0, 20)}
        </div>
      )}

      {/* Top bar — layer selector + field name */}
      <div className="map-top-bar">
        <div className="map-top-bar__left">
          <button
            className="map-top-bar__layer-btn"
            onClick={() => setLayerMenuOpen(p => !p)}
            type="button"
          >
            <Layers size={15} />
            <span className="map-top-bar__layer-name">{currentLayer.label}</span>
            <span className="map-top-bar__layer-sub">heterogeneity</span>
            <ChevronDown size={13} style={{ marginLeft: 2, opacity: 0.7 }} />
          </button>
          {selectedFieldName && (
            <span className="map-top-bar__field-name">{selectedFieldName}</span>
          )}
        </div>

        {/* Layer dropdown flyout */}
        {layerMenuOpen && (
          <div className="map-layer-dropdown" role="menu">
            {LAYER_OPTIONS.map(opt => (
              <button
                key={opt.key}
                type="button"
                className={`map-layer-dropdown__item${metric === opt.key ? ' active' : ''}`}
                onClick={() => {
                  onMetricChange?.(opt.key)
                  onRasterVisibleChange?.(true)
                  setLayerMenuOpen(false)
                }}
                role="menuitem"
              >
                <span className="map-layer-dropdown__label">{opt.label}</span>
                <span className="map-layer-dropdown__desc">{opt.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Left draw controls */}
      {enableDrawing && (
        <div className="map-control-stack" role="group" aria-label="Map drawing controls">
          <button className={`map-ctrl${locating ? ' locating' : ''}`} type="button" onClick={locateMe} title="My location" aria-label="My location" disabled={locating}>
            <Navigation size={18} className={locating ? 'spin' : ''} />
          </button>
          <button className="map-ctrl" type="button" onClick={startDrawing} title="Draw field" aria-label="Draw field">
            <Square size={18} />
          </button>
          {!readOnly && (
            <button className="map-ctrl" type="button" onClick={startEditing} title="Edit field" aria-label="Edit field">
              <Wand2 size={18} />
            </button>
          )}
          <button className="map-ctrl danger" type="button" onClick={clearDrawing} title="Delete drawing" aria-label="Delete drawing">
            <Trash2 size={18} />
          </button>
          <button className="map-ctrl" type="button" onClick={() => onUploadGeoJson?.()} title="Upload GeoJSON" aria-label="Upload GeoJSON">
            <Upload size={18} />
          </button>
        </div>
      )}

      {/* Right nav controls */}
      <div className="map-right-controls">
        <button className="map-ctrl" type="button" onClick={toggle3D} title={mapPitch > 0 ? 'Exit 3D' : '3D view'}>
          <span style={{ fontWeight: 700, fontSize: 12 }}>{mapPitch > 0 ? '2D' : '3D'}</span>
        </button>
        <button className="map-ctrl" type="button" onClick={zoomIn} title="Zoom in" aria-label="Zoom in">
          <Plus size={18} />
        </button>
        <button className="map-ctrl" type="button" onClick={zoomOut} title="Zoom out" aria-label="Zoom out">
          <Minus size={18} />
        </button>
      </div>

      {/* NDVI legend */}
      {showLegend && (
        <div className="map-legend">
          {[['#d92d20','<0.2'],['#f97316','0.2-0.3'],['#fbbf24','0.3-0.4'],['#a3e635','0.4-0.6'],['#166534','>0.6']].map(([c,l]) => (
            <span key={l} className="map-legend__item"><span style={{ background: c }} />{l}</span>
          ))}
        </div>
      )}

      {/* Legend toggle */}
      <button className="map-legend-toggle" type="button" onClick={() => setShowLegend(p => !p)}>
        ◎ {showLegend ? 'Hide' : 'Show'} legend
      </button>

      {/* Productivity zone legend */}
      {productivityZones && (productivityZones.zones || productivityZones)?.length > 0 && !drawMode.includes('draw_') && selectedFieldId && (
        <div className="zone-legend">
          <div className="zone-legend__title">Productivity zones</div>
          {[
            { cls: 'High', color: '#4CAF50' },
            { cls: 'Medium', color: '#FFC107' },
            { cls: 'Low', color: '#F44336' },
          ].map(z => (
            <div key={z.cls} className="zone-legend__item">
              <span className="zone-legend__color" style={{ background: z.color }} />
              {z.cls}
            </div>
          ))}
        </div>
      )}

      {/* Bottom bar — coordinates + weather */}
      <div className="map-bottom-bar">
        <div className="map-bottom-bar__coords">
          <Crosshair size={13} />
          {coord.lat && coord.lon
            ? `${coord.lat.toFixed(5)}, ${coord.lon.toFixed(5)}`
            : 'Draw polygon to measure'}
          {areaHa && <span style={{ marginLeft: 8, opacity: 0.7 }}>· {areaHa.toFixed(2)} ha</span>}
        </div>
        {weatherTemp != null && (
          <div className="map-bottom-bar__weather">
            <span>☁ +{Math.round(weatherTemp)}°</span>
            <span>💧 {Number(weatherRain).toFixed(0)} mm</span>
            {weatherWind != null && <span>💨 {Math.round(weatherWind)} m/s</span>}
          </div>
        )}
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
    // Soft glow ring behind the selected field border
    map.addLayer({
      id: 'fields-selected-glow',
      type: 'line',
      source: 'fields-src',
      paint: {
        'line-color': '#facc15',
        'line-width': 8,
        'line-blur': 6,
        'line-opacity': ['case', ['==', ['get', 'selected'], 1], 0.6, 0],
      },
    })
    map.addLayer({
      id: 'fields-fill',
      type: 'fill',
      source: 'fields-src',
      paint: {
        'fill-color': [
          'case',
          ['==', ['get', 'selected'], 1], '#facc15',
          '#ffffff',
        ],
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false], 0.30,
          ['==', ['get', 'selected'], 1], 0.08,
          0.22,
        ],
      },
    })
    map.addLayer({
      id: 'fields-outline',
      type: 'line',
      source: 'fields-src',
      paint: {
        'line-color': [
          'case',
          ['==', ['get', 'selected'], 1], '#facc15',
          'rgba(255,255,255,0.55)',
        ],
        'line-width': [
          'case',
          ['==', ['get', 'selected'], 1], 2.5,
          1.2,
        ],
      },
    })
  }
}
