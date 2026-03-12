/**
 * Shared health score calculation for vegetation indices.
 * Used by Farms, Dashboard, StressMonitoring, and SatelliteData pages
 * to ensure consistent health badges everywhere.
 *
 * @param {object} sat - Satellite data object with { ndvi, ndre, ndwi, evi, savi }
 * @returns {{ score: number|null, status: string, label: string }}
 */
export function calculateHealthScore(sat) {
    if (!sat) return { score: null, status: 'unknown', label: 'No data' }

    const ndvi = sat.ndvi
    const ndre = sat.ndre
    const ndwi = sat.ndwi
    const evi = sat.evi
    const savi = sat.savi

    const hasIndices = ndvi != null || ndre != null || ndwi != null || evi != null || savi != null
    if (!hasIndices) return { score: null, status: 'unknown', label: 'No data' }

    let healthScore = 0
    let totalWeight = 0

    // NDVI (30% weight) - Primary vegetation health
    if (ndvi != null) {
        const s = ndvi >= 0.6 ? 100 : ndvi >= 0.5 ? 70 : ndvi >= 0.4 ? 50 : ndvi >= 0.3 ? 30 : 10
        healthScore += s * 0.30
        totalWeight += 0.30
    }

    // NDRE (20% weight) - Chlorophyll / nitrogen status
    if (ndre != null) {
        const s = ndre >= 0.5 ? 100 : ndre >= 0.4 ? 70 : ndre >= 0.3 ? 50 : ndre >= 0.2 ? 30 : 10
        healthScore += s * 0.20
        totalWeight += 0.20
    }

    // NDWI (20% weight) - Water content
    if (ndwi != null) {
        const s = ndwi >= 0.3 ? 100 : ndwi >= 0.2 ? 70 : ndwi >= 0.1 ? 50 : ndwi >= 0 ? 30 : 10
        healthScore += s * 0.20
        totalWeight += 0.20
    }

    // EVI (15% weight) - Enhanced vegetation (atmospheric correction)
    if (evi != null) {
        const s = evi >= 0.6 ? 100 : evi >= 0.4 ? 70 : evi >= 0.3 ? 50 : evi >= 0.2 ? 30 : 10
        healthScore += s * 0.15
        totalWeight += 0.15
    }

    // SAVI (15% weight) - Soil-adjusted
    if (savi != null) {
        const s = savi >= 0.5 ? 100 : savi >= 0.4 ? 70 : savi >= 0.3 ? 50 : savi >= 0.2 ? 30 : 10
        healthScore += s * 0.15
        totalWeight += 0.15
    }

    const finalScore = totalWeight > 0 ? healthScore / totalWeight : 0

    if (finalScore >= 70) return { score: finalScore, status: 'healthy', label: 'Healthy' }
    if (finalScore >= 50) return { score: finalScore, status: 'moderate', label: 'Moderate' }
    return { score: finalScore, status: 'high', label: 'Stressed' }
}
