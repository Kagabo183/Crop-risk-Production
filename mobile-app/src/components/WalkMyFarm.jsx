import { useState, useEffect, useRef, useCallback } from 'react'
import { Navigation, Square, Save, RotateCcw, X, MapPin, Clock, Ruler } from 'lucide-react'
import { saveFarmBoundary } from '../api'
import { getCurrentPosition, watchPosition } from '../utils/native'
import { useLanguage } from '../context/LanguageContext'

/**
 * Walk My Farm — GPS Boundary Tracking Component
 *
 * The farmer walks the perimeter of their farm.
 * The phone records GPS coordinates continuously.
 * The GPS track becomes the farm polygon.
 *
 * Flow: Start Walking → Walk perimeter → Stop → Review polygon → Save
 */

// Minimum distance (meters) between consecutive GPS points to avoid jitter
const MIN_DISTANCE_M = 10

// Maximum acceptable GPS accuracy (meters) — reject readings worse than this
const MAX_ACCURACY_M = 30

// Calculate distance between two GPS points in meters (Haversine formula)
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLon = ((lon2 - lon1) * Math.PI) / 180
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2)
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Calculate polygon area from GPS coordinates (Shoelace formula, geodesic)
function calculateAreaHectares(points) {
    if (points.length < 3) return 0
    const R = 6378137.0
    let total = 0
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length
        const lon1 = (points[i].lon * Math.PI) / 180
        const lat1 = (points[i].lat * Math.PI) / 180
        const lon2 = (points[j].lon * Math.PI) / 180
        const lat2 = (points[j].lat * Math.PI) / 180
        total += (lon2 - lon1) * (2 + Math.cos(lat1) + Math.cos(lat2))
    }
    const areaM2 = Math.abs((total * R * R) / 2.0)
    return areaM2 / 10000
}

// Calculate total track distance in meters
function totalDistance(points) {
    let dist = 0
    for (let i = 1; i < points.length; i++) {
        dist += haversineDistance(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon)
    }
    return dist
}

export default function WalkMyFarm({ farmId, farmLat, farmLon, onSaved, onClose }) {
    const { t } = useLanguage();
    const [phase, setPhase] = useState('ready') // ready | walking | stopped | saving | saved
    const [points, setPoints] = useState([])
    const [accuracy, setAccuracy] = useState(null)
    const [error, setError] = useState(null)
    const [startTime, setStartTime] = useState(null)
    const [elapsed, setElapsed] = useState(0)

    const watchIdRef = useRef(null)
    const mapRef = useRef(null)
    const mapInstance = useRef(null)
    const polylineRef = useRef(null)
    const polygonRef = useRef(null)
    const markersRef = useRef([])
    const timerRef = useRef(null)

    // Initialize Leaflet map
    useEffect(() => {
        if (!mapRef.current || mapInstance.current) return
        const L = window.L
        if (!L) return

        const map = L.map(mapRef.current, {
            center: [farmLat || -1.95, farmLon || 30.06],
            zoom: 17,
            zoomControl: true,
        })

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
            maxZoom: 20,
        }).addTo(map)

        // Show farm center marker as reference
        if (farmLat && farmLon) {
            L.circleMarker([farmLat, farmLon], {
                radius: 8,
                color: '#3b82f6',
                fillColor: '#3b82f6',
                fillOpacity: 0.5,
                weight: 2,
            })
                .addTo(map)
                .bindPopup('Farm center')
        }

        // Center map on farmer's REAL GPS position (where they are right now)
        getCurrentPosition({ timeout: 5000 })
            .then(({ latitude, longitude }) => map.setView([latitude, longitude], 18))
            .catch(() => { /* keep farm center if GPS fails */ })

        mapInstance.current = map
        return () => {
            if (mapInstance.current) {
                mapInstance.current.remove()
                mapInstance.current = null
            }
        }
    }, [farmLat, farmLon])

    // Timer for elapsed time
    useEffect(() => {
        if (phase === 'walking' && startTime) {
            timerRef.current = setInterval(() => {
                setElapsed(Math.floor((Date.now() - startTime) / 1000))
            }, 1000)
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current)
        }
    }, [phase, startTime])

    // Update polyline on map when points change
    useEffect(() => {
        if (!mapInstance.current || points.length === 0) return
        const L = window.L
        const map = mapInstance.current
        const latLngs = points.map((p) => [p.lat, p.lon])

        // Remove old polyline
        if (polylineRef.current) map.removeLayer(polylineRef.current)

        // Draw new polyline
        polylineRef.current = L.polyline(latLngs, {
            color: '#f97316',
            weight: 4,
            opacity: 0.8,
            dashArray: phase === 'walking' ? '10, 6' : null,
        }).addTo(map)

        // Remove old point markers
        markersRef.current.forEach((m) => map.removeLayer(m))
        markersRef.current = []

        // Add numbered markers for first and last points
        if (points.length >= 1) {
            const startMarker = L.circleMarker([points[0].lat, points[0].lon], {
                radius: 7,
                color: '#16a34a',
                fillColor: '#22c55e',
                fillOpacity: 1,
                weight: 2,
            })
                .addTo(map)
                .bindPopup('Start point')
            markersRef.current.push(startMarker)
        }

        if (points.length >= 2) {
            const last = points[points.length - 1]
            const endMarker = L.circleMarker([last.lat, last.lon], {
                radius: 7,
                color: '#dc2626',
                fillColor: '#ef4444',
                fillOpacity: 1,
                weight: 2,
            })
                .addTo(map)
                .bindPopup(`Point ${points.length} (latest)`)
            markersRef.current.push(endMarker)
        }

        // Pan to latest point and zoom in closely on farmer's real position
        if (phase === 'walking') {
            const lastPt = points[points.length - 1]
            map.setView([lastPt.lat, lastPt.lon], Math.max(map.getZoom(), 18))
        }

        // If stopped, show the closed polygon
        if (phase === 'stopped' && points.length >= 3) {
            if (polygonRef.current) map.removeLayer(polygonRef.current)
            const closedLatLngs = [...latLngs, latLngs[0]]
            polygonRef.current = L.polygon(closedLatLngs, {
                color: '#16a34a',
                fillColor: '#22c55e',
                fillOpacity: 0.25,
                weight: 3,
            }).addTo(map)
            map.fitBounds(polygonRef.current.getBounds(), { padding: [40, 40] })
        }
    }, [points, phase])

    // Start GPS tracking
    const startWalking = useCallback(() => {
        setError(null)
        setPoints([])
        setPhase('walking')
        setStartTime(Date.now())
        setElapsed(0)

        // Clean up old polygon
        if (polygonRef.current && mapInstance.current) {
            mapInstance.current.removeLayer(polygonRef.current)
            polygonRef.current = null
        }

        watchIdRef.current = watchPosition(
            ({ latitude, longitude, accuracy: acc }) => {
                setAccuracy(acc)

                // Reject readings with poor accuracy — they cause fake distance
                if (acc > MAX_ACCURACY_M) return

                setPoints((prev) => {
                    // Skip if too close to last point (GPS jitter filter)
                    if (prev.length > 0) {
                        const last = prev[prev.length - 1]
                        const dist = haversineDistance(last.lat, last.lon, latitude, longitude)
                        if (dist < MIN_DISTANCE_M) return prev
                    }

                    return [...prev, { lat: latitude, lon: longitude, acc, time: Date.now() }]
                })
            },
            (err) => setError(err.message),
            { maximumAge: 0 }
        )
    }, [])

    // Stop GPS tracking
    const stopWalking = useCallback(() => {
        if (watchIdRef.current) {
            watchIdRef.current.clear()
            watchIdRef.current = null
        }
        if (timerRef.current) clearInterval(timerRef.current)
        setPhase('stopped')
    }, [])

    // Reset to start over
    const resetWalk = useCallback(() => {
        if (watchIdRef.current) {
            watchIdRef.current.clear()
            watchIdRef.current = null
        }
        if (timerRef.current) clearInterval(timerRef.current)

        // Clean up map layers
        if (mapInstance.current) {
            if (polylineRef.current) mapInstance.current.removeLayer(polylineRef.current)
            if (polygonRef.current) mapInstance.current.removeLayer(polygonRef.current)
            markersRef.current.forEach((m) => mapInstance.current.removeLayer(m))
        }
        polylineRef.current = null
        polygonRef.current = null
        markersRef.current = []

        setPoints([])
        setPhase('ready')
        setAccuracy(null)
        setElapsed(0)
        setStartTime(null)
        setError(null)
    }, [])

    // Save boundary to backend
    const saveBoundary = useCallback(async () => {
        if (points.length < 3) {
            setError(t('walk.error_min_points') || 'Need at least 3 GPS points to create a farm boundary. Walk more of the perimeter.')
            return
        }

        setPhase('saving')
        setError(null)

        try {
            // Convert points to GeoJSON Polygon (lon, lat order for GeoJSON)
            const coordinates = points.map((p) => [p.lon, p.lat])
            // Close the polygon (last point = first point)
            coordinates.push([points[0].lon, points[0].lat])

            const geoJSON = {
                type: 'Polygon',
                coordinates: [coordinates],
            }

            await saveFarmBoundary(farmId, geoJSON)
            setPhase('saved')
            if (onSaved) onSaved(calculateAreaHectares(points))
        } catch (err) {
            setError(err.response?.data?.detail || t('parcel.error_gps') || 'Failed to save boundary. Please try again.')
            setPhase('stopped')
        }
    }, [points, farmId, onSaved, t])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (watchIdRef.current) watchIdRef.current.clear()
            if (timerRef.current) clearInterval(timerRef.current)
        }
    }, [])

    // Format elapsed time
    const formatTime = (s) => {
        const m = Math.floor(s / 60)
        const sec = s % 60
        return `${m}:${sec.toString().padStart(2, '0')}`
    }

    const area = calculateAreaHectares(points)
    const dist = totalDistance(points)

    return (
        <div
            style={{
                background: 'white',
                borderRadius: 12,
                border: '2px solid #f97316',
                overflow: 'hidden',
            }}
        >
            {/* Header */}
            <div
                style={{
                    padding: '12px 16px',
                    background: 'linear-gradient(135deg, #fff7ed, #ffedd5)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: '1px solid #fed7aa',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 20 }}>🚶</span>
                    <div>
                        <div style={{ fontWeight: 700, fontSize: 15, color: '#9a3412' }}>{t('walk.title')}</div>
                        <div style={{ fontSize: 11, color: '#c2410c' }}>
                            {t('walk.subtitle')}
                        </div>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 4,
                        color: '#9a3412',
                    }}
                    title="Close"
                >
                    <X size={20} />
                </button>
            </div>

            {/* Map */}
            <div ref={mapRef} style={{ width: '100%', height: 300 }} />

            {/* Stats Bar */}
            {(phase === 'walking' || phase === 'stopped') && (
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, 1fr)',
                        gap: 1,
                        background: '#f1f5f9',
                        borderTop: '1px solid #e2e8f0',
                        borderBottom: '1px solid #e2e8f0',
                    }}
                >
                    {[
                        {
                            icon: <MapPin size={14} />,
                            label: t('walk.points') || 'Points',
                            value: points.length,
                            color: '#3b82f6',
                        },
                        {
                            icon: <Clock size={14} />,
                            label: t('walk.time') || 'Time',
                            value: formatTime(elapsed),
                            color: '#8b5cf6',
                        },
                        {
                            icon: <Ruler size={14} />,
                            label: t('walk.distance') || 'Distance',
                            value: dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`,
                            color: '#f97316',
                        },
                        {
                            icon: <Navigation size={14} />,
                            label: t('walk.area') || 'Area',
                            value: area >= 0.01 ? `${area.toFixed(2)} ha` : '—',
                            color: '#16a34a',
                        },
                    ].map((stat) => (
                        <div
                            key={stat.label}
                            style={{
                                background: 'white',
                                padding: '8px 12px',
                                textAlign: 'center',
                            }}
                        >
                            <div
                                style={{
                                    fontSize: 10,
                                    color: '#64748b',
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    gap: 3,
                                }}
                            >
                                {stat.icon} {stat.label}
                            </div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: stat.color, marginTop: 2 }}>
                                {stat.value}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* GPS Accuracy Indicator */}
            {phase === 'walking' && accuracy != null && (
                <div
                    style={{
                        padding: '6px 16px',
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        background: accuracy < 10 ? '#f0fdf4' : accuracy < 30 ? '#fffbeb' : '#fef2f2',
                    }}
                >
                    <div
                        style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: accuracy < 10 ? '#22c55e' : accuracy < 30 ? '#f59e0b' : '#ef4444',
                            animation: 'pulse 1.5s infinite',
                        }}
                    />
                    <span style={{ color: '#64748b' }}>
                        {t('walk.gps_accuracy') || 'GPS accuracy:'} <strong>{Math.round(accuracy)}m</strong>
                        {accuracy < 10
                            ? t('walk.gps_excellent') || ' — Excellent ✓'
                            : accuracy <= 30
                                ? t('walk.gps_good') || ' — Good ✓'
                                : t('walk.gps_poor') || ' — Too poor, skipping! Move outside to open area'}
                    </span>
                </div>
            )}

            {/* Error */}
            {error && (
                <div
                    style={{
                        padding: '10px 16px',
                        background: '#fef2f2',
                        color: '#b91c1c',
                        fontSize: 13,
                        borderTop: '1px solid #fecaca',
                    }}
                >
                    ⚠️ {error}
                </div>
            )}

            {/* Action Buttons */}
            <div style={{ padding: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {phase === 'ready' && (
                    <button
                        onClick={startWalking}
                        style={{
                            flex: 1,
                            padding: '14px 20px',
                            fontSize: 16,
                            fontWeight: 700,
                            background: 'linear-gradient(135deg, #f97316, #ea580c)',
                            color: 'white',
                            border: 'none',
                            borderRadius: 10,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 10,
                            minHeight: 52,
                        }}
                    >
                        <Navigation size={22} />
                        {t('walk.start') || 'Start Walking'}
                    </button>
                )}

                {phase === 'walking' && (
                    <button
                        onClick={stopWalking}
                        disabled={points.length < 3}
                        style={{
                            flex: 1,
                            padding: '14px 20px',
                            fontSize: 16,
                            fontWeight: 700,
                            background:
                                points.length < 3
                                    ? '#d1d5db'
                                    : 'linear-gradient(135deg, #ef4444, #dc2626)',
                            color: 'white',
                            border: 'none',
                            borderRadius: 10,
                            cursor: points.length < 3 ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 10,
                            minHeight: 52,
                        }}
                    >
                        <Square size={22} />
                        {points.length < 3
                            ? (t('walk.walking') || 'Walking... ({pts}/3 min points)').replace('{pts}', points.length)
                            : t('walk.stop') || 'Stop Walking'}
                    </button>
                )}

                {phase === 'stopped' && (
                    <>
                        <button
                            onClick={saveBoundary}
                            style={{
                                flex: 2,
                                padding: '14px 20px',
                                fontSize: 16,
                                fontWeight: 700,
                                background: 'linear-gradient(135deg, #16a34a, #15803d)',
                                color: 'white',
                                border: 'none',
                                borderRadius: 10,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 10,
                                minHeight: 52,
                            }}
                        >
                            <Save size={22} />
                            {t('walk.save') || 'Save Boundary'} ({area.toFixed(2)} ha)
                        </button>
                        <button
                            onClick={resetWalk}
                            style={{
                                flex: 1,
                                padding: '14px 20px',
                                fontSize: 14,
                                fontWeight: 600,
                                background: '#f1f5f9',
                                color: '#475569',
                                border: '1px solid #cbd5e1',
                                borderRadius: 10,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 8,
                                minHeight: 52,
                            }}
                        >
                            <RotateCcw size={18} />
                            {t('walk.redo') || 'Redo'}
                        </button>
                    </>
                )}

                {phase === 'saving' && (
                    <div
                        style={{
                            flex: 1,
                            padding: '14px 20px',
                            fontSize: 15,
                            fontWeight: 600,
                            background: '#f0fdf4',
                            color: '#16a34a',
                            border: '1px solid #bbf7d0',
                            borderRadius: 10,
                            textAlign: 'center',
                            minHeight: 52,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        {t('walk.saving') || 'Saving boundary...'}
                    </div>
                )}

                {phase === 'saved' && (
                    <div
                        style={{
                            flex: 1,
                            padding: '14px 20px',
                            fontSize: 15,
                            fontWeight: 700,
                            background: '#f0fdf4',
                            color: '#16a34a',
                            border: '2px solid #22c55e',
                            borderRadius: 10,
                            textAlign: 'center',
                            minHeight: 52,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 8,
                        }}
                    >
                        {(t('walk.saved') || '✅ Boundary Saved!')} ({area.toFixed(2)} {t('dash.farms.ha')})
                    </div>
                )}
            </div>

            {/* Instructions */}
            {phase === 'ready' && (
                <div
                    style={{
                        padding: '0 16px 16px',
                        fontSize: 12,
                        color: '#64748b',
                        lineHeight: 1.6,
                    }}
                >
                    <strong>{t('walk.how_to') || 'How to use:'}</strong>
                    <ol style={{ margin: '4px 0 0 16px', padding: 0 }}>
                        <li>{t('walk.step1')}</li>
                        <li>{t('walk.step2')}</li>
                        <li>{t('walk.step3')}</li>
                        <li>{t('walk.step4')}</li>
                        <li>{t('walk.step5')}</li>
                    </ol>
                </div>
            )}

            {phase === 'walking' && (
                <div
                    style={{
                        padding: '0 16px 12px',
                        fontSize: 12,
                        color: '#c2410c',
                        fontWeight: 500,
                        textAlign: 'center',
                    }}
                >
                    {t('walk.walking_msg')}
                </div>
            )}

            {/* CSS animation for the GPS pulse */}
            <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.5); }
        }
      `}</style>
        </div>
    )
}
