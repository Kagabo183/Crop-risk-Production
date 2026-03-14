import { useState, useRef, useEffect, useCallback } from 'react'
import { searchParcels, findParcelByLocation, saveFarmBoundary } from '../api'
import { Search, MapPin, Check, X, Loader2, Navigation, Redo } from 'lucide-react'
import { getCurrentPosition } from '../utils/native'
import { useLanguage } from '../context/LanguageContext'

/**
 * ParcelLookup – find official LAIS cadastral parcel by UPI or GPS location.
 * Shows the survey-grade boundary on a map and lets the farmer adopt it.
 *
 * Props:
 *   farmId   – ID of the farm to attach the boundary to
 *   farmLat  – farm latitude (for initial map center)
 *   farmLon  – farm longitude
 *   onSaved  – callback(areaHectares) after successful save
 *   onClose  – callback to close the component
 */
export default function ParcelLookup({ farmId, farmLat, farmLon, onSaved, onClose }) {
    const { t } = useLanguage();
    // Search state
    const [upiQuery, setUpiQuery] = useState('')
    const [searching, setSearching] = useState(false)
    const [parcels, setParcels] = useState([])
    const [selectedParcel, setSelectedParcel] = useState(null)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const [error, setError] = useState(null)
    const [gpsSearching, setGpsSearching] = useState(false)

    // Map refs
    const mapRef = useRef(null)
    const mapInstance = useRef(null)
    const parcelLayers = useRef([])
    const selectedLayer = useRef(null)

    // Initialize map
    useEffect(() => {
        if (!mapRef.current || mapInstance.current) return
        const L = window.L
        if (!L) return

        const map = L.map(mapRef.current, {
            center: [farmLat || -1.5, farmLon || 29.6],
            zoom: 16,
            zoomControl: true,
        })

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap',
            maxZoom: 20,
        }).addTo(map)

        // Show farm center
        if (farmLat && farmLon) {
            L.circleMarker([farmLat, farmLon], {
                radius: 8,
                color: '#3b82f6',
                fillColor: '#3b82f6',
                fillOpacity: 0.5,
                weight: 2,
            })
                .addTo(map)
                .bindPopup('Your farm location')
        }

        mapInstance.current = map
        return () => {
            if (mapInstance.current) {
                mapInstance.current.remove()
                mapInstance.current = null
            }
        }
    }, [farmLat, farmLon])

    // Clear parcel layers from map
    const clearLayers = useCallback(() => {
        const map = mapInstance.current
        if (!map) return
        parcelLayers.current.forEach((l) => map.removeLayer(l))
        parcelLayers.current = []
        if (selectedLayer.current) {
            map.removeLayer(selectedLayer.current)
            selectedLayer.current = null
        }
    }, [])

    // Draw parcels on map
    const drawParcels = useCallback(
        (parcelList) => {
            const L = window.L
            const map = mapInstance.current
            if (!L || !map) return

            clearLayers()

            parcelList.forEach((p) => {
                if (!p.boundary_geojson) return
                const layer = L.geoJSON(p.boundary_geojson, {
                    style: {
                        color: '#6366f1',
                        weight: 2,
                        fillColor: '#6366f1',
                        fillOpacity: 0.15,
                    },
                })
                    .addTo(map)
                    .on('click', () => selectParcel(p))

                // Add tooltip
                layer.bindTooltip(
                    `<b>${p.upi || 'No UPI'}</b><br/>${p.village || ''}, ${p.cell || ''}`,
                    { sticky: true }
                )

                parcelLayers.current.push(layer)
            })

            // Fit map to show all parcels
            if (parcelLayers.current.length > 0) {
                const group = L.featureGroup(parcelLayers.current)
                map.fitBounds(group.getBounds().pad(0.1))
            }
        },
        [clearLayers]
    )

    // Select a parcel
    const selectParcel = useCallback(
        (parcel) => {
            const L = window.L
            const map = mapInstance.current
            if (!L || !map) return

            // Remove previous selection highlight
            if (selectedLayer.current) {
                map.removeLayer(selectedLayer.current)
                selectedLayer.current = null
            }

            setSelectedParcel(parcel)

            // Draw selected parcel with highlight
            if (parcel.boundary_geojson) {
                selectedLayer.current = L.geoJSON(parcel.boundary_geojson, {
                    style: {
                        color: '#10b981',
                        weight: 3,
                        fillColor: '#10b981',
                        fillOpacity: 0.3,
                        dashArray: null,
                    },
                }).addTo(map)

                map.fitBounds(selectedLayer.current.getBounds().pad(0.2))
            }
        },
        []
    )

    // Search by UPI
    const handleSearch = async () => {
        if (!upiQuery.trim()) return
        setSearching(true)
        setError(null)
        setParcels([])
        setSelectedParcel(null)

        try {
            const res = await searchParcels(upiQuery.trim())
            const data = res.data
            if (data.length === 0) {
                setError(t('parcel.error_upi') || 'No parcels found matching that UPI. Check the number and try again.')
            } else {
                setParcels(data)
                drawParcels(data)
            }
        } catch (err) {
            setError(err.response?.data?.detail || 'Search failed. Please try again.')
        } finally {
            setSearching(false)
        }
    }

    // Find by GPS location
    const handleGpsSearch = async () => {
        setGpsSearching(true)
        setError(null)
        setParcels([])
        setSelectedParcel(null)

        try {
            const { latitude, longitude } = await getCurrentPosition()
            const res = await findParcelByLocation(latitude, longitude, 100)
            const data = res.data
            if (data.length === 0) {
                setError(t('parcel.error_gps') || 'No registered parcels found at your location. Try searching by UPI instead.')
            } else {
                setParcels(data)
                drawParcels(data)
                if (data.length === 1) {
                    selectParcel(data[0])
                }
            }
        } catch (err) {
            setError(err.response?.data?.detail || err.message || 'Location search failed.')
        } finally {
            setGpsSearching(false)
        }
    }

    // Save selected parcel boundary to farm
    const handleSave = async () => {
        if (!selectedParcel?.boundary_geojson) return
        setSaving(true)
        setError(null)

        try {
            await saveFarmBoundary(farmId, selectedParcel.boundary_geojson)
            setSaved(true)
            if (onSaved) onSaved(selectedParcel.area_hectares)
        } catch (err) {
            setError(err.response?.data?.detail || 'Failed to save boundary.')
        } finally {
            setSaving(false)
        }
    }

    // Reset
    const handleReset = () => {
        clearLayers()
        setParcels([])
        setSelectedParcel(null)
        setSaved(false)
        setError(null)
        setUpiQuery('')
    }

    return (
        <div style={styles.overlay}>
            <div style={styles.container}>
                {/* Header */}
                <div style={styles.header}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <MapPin size={22} color="#6366f1" />
                        <h3 style={styles.title}>{t('parcel.title')}</h3>
                    </div>
                    <button onClick={onClose} style={styles.closeBtn}>
                        <X size={20} />
                    </button>
                </div>

                {/* Search controls */}
                {!saved && (
                    <div style={styles.searchSection}>
                        <p style={styles.hint} dangerouslySetInnerHTML={{ __html: t('parcel.hint') || 'Search by your <b>UPI number</b> or use GPS to find the official parcel at your location.' }}>
                        </p>

                        {/* UPI search */}
                        <div style={styles.searchRow}>
                            <input
                                type="text"
                                value={upiQuery}
                                onChange={(e) => setUpiQuery(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                placeholder={t('parcel.placeholder')}
                                style={styles.input}
                            />
                            <button
                                onClick={handleSearch}
                                disabled={searching || !upiQuery.trim()}
                                style={{
                                    ...styles.searchBtn,
                                    opacity: searching || !upiQuery.trim() ? 0.5 : 1,
                                }}
                            >
                                {searching ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
                                {t('parcel.search')}
                            </button>
                        </div>

                        {/* Divider */}
                        <div style={styles.divider}>
                            <span style={styles.dividerText}>{t('parcel.or')}</span>
                        </div>

                        {/* GPS search */}
                        <button
                            onClick={handleGpsSearch}
                            disabled={gpsSearching}
                            style={{
                                ...styles.gpsBtn,
                                opacity: gpsSearching ? 0.6 : 1,
                            }}
                        >
                            {gpsSearching ? (
                                <Loader2 size={16} className="spin" />
                            ) : (
                                <Navigation size={16} />
                            )}
                            {gpsSearching ? (t('parcel.finding') || 'Finding parcel...') : (t('parcel.find_gps') || 'Find Parcel at My Location')}
                        </button>
                    </div>
                )}

                {/* Error */}
                {error && (
                    <div style={styles.error}>
                        <span>⚠️ {error}</span>
                    </div>
                )}

                {/* Map */}
                <div ref={mapRef} style={styles.map} />

                {/* Results list */}
                {parcels.length > 1 && !selectedParcel && (
                    <div style={styles.resultsList}>
                        <p style={styles.resultsTitle}>
                            {(t('parcel.found_count') || 'Found {count} parcels — tap one to select:').replace('{count}', parcels.length)}
                        </p>
                        {parcels.map((p) => (
                            <button
                                key={p.id}
                                onClick={() => selectParcel(p)}
                                style={styles.resultItem}
                            >
                                <div>
                                    <b>{p.upi || `Parcel #${p.parcel_number}`}</b>
                                    <br />
                                    <span style={{ fontSize: 12, color: '#94a3b8' }}>
                                        {[p.village, p.cell, p.sector].filter(Boolean).join(', ')}
                                    </span>
                                </div>
                                <span style={{ fontSize: 13, color: '#818cf8' }}>
                                    {p.area_hectares ? `${p.area_hectares} ha` : ''}
                                </span>
                            </button>
                        ))}
                    </div>
                )}

                {/* Selected parcel details */}
                {selectedParcel && !saved && (
                    <div style={styles.selectedCard}>
                        <h4 style={{ margin: '0 0 8px', color: '#f1f5f9' }}>{t('parcel.selected')}</h4>
                        <div style={styles.detailGrid}>
                            <div style={styles.detailItem}>
                                <span style={styles.detailLabel}>UPI</span>
                                <span style={styles.detailValue}>{selectedParcel.upi || '—'}</span>
                            </div>
                            <div style={styles.detailItem}>
                                <span style={styles.detailLabel}>Village</span>
                                <span style={styles.detailValue}>{selectedParcel.village || '—'}</span>
                            </div>
                            <div style={styles.detailItem}>
                                <span style={styles.detailLabel}>Cell</span>
                                <span style={styles.detailValue}>{selectedParcel.cell || '—'}</span>
                            </div>
                            <div style={styles.detailItem}>
                                <span style={styles.detailLabel}>Sector</span>
                                <span style={styles.detailValue}>{selectedParcel.sector || '—'}</span>
                            </div>
                            <div style={styles.detailItem}>
                                <span style={styles.detailLabel}>District</span>
                                <span style={styles.detailValue}>{selectedParcel.district || '—'}</span>
                            </div>
                            <div style={styles.detailItem}>
                                <span style={styles.detailLabel}>Area</span>
                                <span style={styles.detailValue}>
                                    {selectedParcel.area_hectares
                                        ? `${selectedParcel.area_hectares} ha`
                                        : '—'}
                                </span>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                            <button onClick={handleSave} disabled={saving} style={styles.saveBtn}>
                                {saving ? (
                                    <Loader2 size={16} className="spin" />
                                ) : (
                                    <Check size={16} />
                                )}
                                {saving ? (t('walk.saving') || 'Saving...') : (t('parcel.use_boundary') || 'Use This Boundary')}
                            </button>
                            <button onClick={handleReset} style={styles.resetBtn}>
                                <Redo size={14} />
                                {t('parcel.search_again')}
                            </button>
                        </div>
                    </div>
                )}

                {/* Saved confirmation */}
                {saved && (
                    <div style={styles.savedCard}>
                        <Check size={32} color="#10b981" />
                        <h4 style={{ margin: '8px 0 4px', color: '#f1f5f9' }}>{t('parcel.saved_title')}</h4>
                        <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>
                            {t('parcel.saved_desc')}
                            {selectedParcel?.area_hectares && (
                                <> {t('walk.area') || 'Area'}: <b>{selectedParcel.area_hectares} ha</b></>
                            )}
                        </p>
                        <button onClick={onClose} style={{ ...styles.saveBtn, marginTop: 12 }}>
                            {t('parcel.done') || 'Done'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}

const styles = {
    overlay: {
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: 16,
    },
    container: {
        background: '#0f172a',
        borderRadius: 16,
        border: '1px solid rgba(99,102,241,0.3)',
        width: '100%',
        maxWidth: 520,
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '16px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
    },
    title: {
        margin: 0,
        fontSize: 18,
        fontWeight: 700,
        color: '#f1f5f9',
    },
    closeBtn: {
        background: 'none',
        border: 'none',
        color: '#94a3b8',
        cursor: 'pointer',
        padding: 4,
    },
    searchSection: {
        padding: '16px 20px',
    },
    hint: {
        color: '#94a3b8',
        fontSize: 13,
        margin: '0 0 12px',
        lineHeight: 1.5,
    },
    searchRow: {
        display: 'flex',
        gap: 8,
    },
    input: {
        flex: 1,
        padding: '10px 14px',
        borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.15)',
        background: 'rgba(255,255,255,0.06)',
        color: '#f1f5f9',
        fontSize: 14,
        outline: 'none',
    },
    searchBtn: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '10px 16px',
        borderRadius: 8,
        border: 'none',
        background: '#6366f1',
        color: '#fff',
        fontSize: 14,
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
    },
    divider: {
        display: 'flex',
        alignItems: 'center',
        margin: '14px 0',
        gap: 12,
    },
    dividerText: {
        color: '#64748b',
        fontSize: 12,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 1,
        width: '100%',
        textAlign: 'center',
        position: 'relative',
    },
    gpsBtn: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        width: '100%',
        padding: '12px 16px',
        borderRadius: 8,
        border: '1px solid rgba(99,102,241,0.3)',
        background: 'rgba(99,102,241,0.1)',
        color: '#818cf8',
        fontSize: 14,
        fontWeight: 600,
        cursor: 'pointer',
    },
    error: {
        margin: '0 20px 12px',
        padding: '10px 14px',
        borderRadius: 8,
        background: 'rgba(239,68,68,0.1)',
        border: '1px solid rgba(239,68,68,0.3)',
        color: '#fca5a5',
        fontSize: 13,
    },
    map: {
        height: 280,
        margin: '0 20px',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.1)',
        overflow: 'hidden',
    },
    resultsList: {
        padding: '12px 20px',
        maxHeight: 200,
        overflowY: 'auto',
    },
    resultsTitle: {
        color: '#94a3b8',
        fontSize: 13,
        margin: '0 0 8px',
    },
    resultItem: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
        padding: '10px 12px',
        marginBottom: 6,
        borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.04)',
        color: '#f1f5f9',
        cursor: 'pointer',
        textAlign: 'left',
        fontSize: 13,
    },
    selectedCard: {
        margin: '12px 20px 20px',
        padding: 16,
        borderRadius: 12,
        background: 'rgba(16,185,129,0.08)',
        border: '1px solid rgba(16,185,129,0.3)',
    },
    detailGrid: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '6px 16px',
    },
    detailItem: {
        display: 'flex',
        flexDirection: 'column',
    },
    detailLabel: {
        fontSize: 11,
        fontWeight: 600,
        color: '#64748b',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    detailValue: {
        fontSize: 14,
        color: '#e2e8f0',
    },
    saveBtn: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        flex: 1,
        padding: '10px 16px',
        borderRadius: 8,
        border: 'none',
        background: '#10b981',
        color: '#fff',
        fontSize: 14,
        fontWeight: 600,
        cursor: 'pointer',
    },
    resetBtn: {
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '10px 14px',
        borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.15)',
        background: 'rgba(255,255,255,0.06)',
        color: '#94a3b8',
        fontSize: 13,
        cursor: 'pointer',
    },
    savedCard: {
        margin: '12px 20px 20px',
        padding: 20,
        borderRadius: 12,
        background: 'rgba(16,185,129,0.08)',
        border: '1px solid rgba(16,185,129,0.3)',
        textAlign: 'center',
    },
}
