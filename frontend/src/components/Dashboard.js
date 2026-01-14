import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cropTypeLatestRun,
  fetchSatelliteImageCount,
  fetchSatelliteImageStats,
  fetchFarms,
  fetchAlerts,
  fetchDashboardMetrics,
  fetchEnrichedPredictions,
  fetchRiskByDistrict,
  fetchRiskByProvince,
  runRiskPredictions,
  fetchRiskPredictionStatus,
} from '../api';
import { useNavigate } from 'react-router-dom';
import './Dashboard.css';

const formatNumber = (value, options = {}) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return '--';
  }
  const { maximumFractionDigits = 0, minimumFractionDigits } = options;
  return numeric.toLocaleString('en-US', {
    maximumFractionDigits,
    minimumFractionDigits: minimumFractionDigits ?? Math.min(maximumFractionDigits, 2),
    ...options,
  });
};

const formatCount = (value) => {
  if (value === 'Error') {
    return 'Error';
  }
  if (value == null || value === '--') {
    return '--';
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }
  return formatNumber(numeric);
};

const formatDate = (dateStr) => {
  if (!dateStr) {
    return '-';
  }
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return dateStr;
  }
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

const getRiskLevel = (score) => {
  if (typeof score !== 'number') {
    return 'low';
  }
  if (score >= 60) {
    return 'high';
  }
  if (score >= 30) {
    return 'medium';
  }
  return 'low';
};

const getTimeToImpactMeta = (timeToImpact) => {
  if (!timeToImpact) {
    return null;
  }
  switch (timeToImpact) {
    case '< 7 days':
      return { label: '< 7 days', className: 'status-pill is-immediate' };
    case '7-14 days':
      return { label: '7-14 days', className: 'status-pill is-short' };
    case '14-30 days':
      return { label: '14-30 days', className: 'status-pill is-medium' };
    default:
      return { label: 'Stable', className: 'status-pill is-stable' };
  }
};

const getConfidenceMeta = (confidence) => {
  if (!confidence) {
    return null;
  }
  const normalized = confidence.toLowerCase();
  if (normalized === 'high') {
    return { label: 'High', className: 'status-pill is-positive' };
  }
  if (normalized === 'medium') {
    return { label: 'Medium', className: 'status-pill is-neutral' };
  }
  return { label: 'Low', className: 'status-pill is-critical' };
};

const formatDriverName = (driver) => {
  const mapping = {
    rainfall_deficit: 'Rainfall Deficit',
    heat_stress_days: 'Heat Stress',
    ndvi_trend: 'Vegetation Decline',
    ndvi_anomaly: 'Vegetation Anomaly',
  };
  return mapping[driver] || driver;
};

const Dashboard = () => {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState('dashboard-overview');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [latestCropTypeRun, setLatestCropTypeRun] = useState(null);
  const [satelliteCount, setSatelliteCount] = useState('--');
  const [satelliteStats, setSatelliteStats] = useState(null);
  const [farmCount, setFarmCount] = useState('--');
  const [allFarms, setAllFarms] = useState([]);
  const [predictionCount, setPredictionCount] = useState('--');
  const [alertCount, setAlertCount] = useState('--');
  const [recentPredictions, setRecentPredictions] = useState([]);
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [alertsView, setAlertsView] = useState('risk');
  const [analytics, setAnalytics] = useState(null);
  const [intelligenceMetrics, setIntelligenceMetrics] = useState(null);
  const [allPredictions, setAllPredictions] = useState([]);
  const [selectedFarmId, setSelectedFarmId] = useState(null);
  const [expandedRows, setExpandedRows] = useState([]);
  const [provinceRiskData, setProvinceRiskData] = useState(null);
  const [districtRiskData, setDistrictRiskData] = useState(null);
  const [geoView, setGeoView] = useState('district');
  const [selectedProvince, setSelectedProvince] = useState('');
  const [analyticsView, setAnalyticsView] = useState('hotspots');
  const [isUpdatingRiskPredictions, setIsUpdatingRiskPredictions] = useState(false);
  const [riskPredictionJobError, setRiskPredictionJobError] = useState(null);

  const isRefreshingRef = useRef(false);
  const lastAutoRefreshAtRef = useRef(0);

  const refreshDashboard = useCallback(async () => {
    if (isRefreshingRef.current) return;

    isRefreshingRef.current = true;
    setIsRefreshing(true);

    try {
      const [satRes, satStatsRes, farmsRes, predsRes, metricsRes, alertsRes, provRes, distRes, cropRunRes] = await Promise.allSettled([
        fetchSatelliteImageCount(),
        fetchSatelliteImageStats(),
        fetchFarms(),
        fetchEnrichedPredictions(),
        fetchDashboardMetrics(),
        fetchAlerts(),
        fetchRiskByProvince(),
        fetchRiskByDistrict(),
        cropTypeLatestRun(),
      ]);

    if (satRes.status === 'fulfilled') {
      setSatelliteCount(satRes.value);
    } else {
      setSatelliteCount('Error');
    }

    if (satStatsRes.status === 'fulfilled') {
      setSatelliteStats(satStatsRes.value);
    } else {
      setSatelliteStats(null);
    }

    if (farmsRes.status === 'fulfilled') {
      const farms = farmsRes.value;
      setAllFarms(Array.isArray(farms) ? farms : []);
      setFarmCount(Array.isArray(farms) ? farms.length : 0);
    } else {
      setAllFarms([]);
      setFarmCount('Error');
    }

    if (predsRes.status === 'fulfilled') {
      const preds = Array.isArray(predsRes.value) ? predsRes.value : [];
      setPredictionCount(preds.length);
      setAllPredictions(preds);
      setRecentPredictions(preds.slice(-10).reverse());
    } else {
      setPredictionCount('Error');
      setRecentPredictions([]);
    }

    if (metricsRes.status === 'fulfilled') {
      const metrics = metricsRes.value;
      const high = metrics?.risk_distribution?.high ?? 0;
      const medium = metrics?.risk_distribution?.medium ?? 0;
      const low = metrics?.risk_distribution?.low ?? 0;
      const providedTotal = metrics?.total_predictions ?? 0;
      const derivedTotal = high + medium + low;
      const totalPredictions = providedTotal > 0 ? providedTotal : derivedTotal;
      const safeTotal = totalPredictions > 0 ? totalPredictions : 1;

      const avgRiskScore = (high * 80 + medium * 45 + low * 15) / safeTotal;
      const avgYieldLoss = (metrics?.national_impact?.yield_loss_tons ?? 0) / safeTotal;
      const riskPercent = totalPredictions > 0 ? (high / totalPredictions) * 100 : 0;

      setAnalytics({
        avgRisk: avgRiskScore,
        avgYieldLoss,
        highRisk: high,
        mediumRisk: medium,
        lowRisk: low,
        criticalDiseaseRisk: high,
        riskPercentage: riskPercent,
        totalPredictions,
        latestPredictionAt: metrics?.effective_last_updated_at ?? metrics?.latest_prediction_at ?? null,
        latestPredictionAtRaw: metrics?.latest_prediction_at ?? null,
        latestSatelliteAt: metrics?.latest_satellite_at ?? null,
        metricsSource: metrics?.metrics_source ?? null,
        stalePredictions: Boolean(metrics?.stale_predictions),
      });

      setIntelligenceMetrics({
        immediate: metrics?.time_to_impact?.immediate ?? 0,
        shortTerm: metrics?.time_to_impact?.short_term ?? 0,
        mediumTerm: metrics?.time_to_impact?.medium_term ?? 0,
        stable: metrics?.time_to_impact?.stable ?? 0,
        avgConfidence: metrics?.confidence?.average ?? 0,
        highConfidence: metrics?.confidence?.high_confidence_count ?? 0,
        totalEconomicLoss: metrics?.national_impact?.economic_loss_usd ?? 0,
        totalYieldLoss: metrics?.national_impact?.yield_loss_tons ?? 0,
        totalMealsLost: metrics?.national_impact?.meals_lost ?? 0,
        topDrivers: (metrics?.top_risk_drivers ?? []).map((driver) => ({
          name: driver.name,
          count: driver.count,
        })),
      });
    } else {
      setAnalytics(null);
      setIntelligenceMetrics(null);
    }

    if (alertsRes.status === 'fulfilled') {
      const alerts = Array.isArray(alertsRes.value) ? alertsRes.value : [];
      setAlertCount(alerts.length);
      setRecentAlerts(alerts.slice(-10).reverse());
    } else {
      setAlertCount('Error');
      setRecentAlerts([]);
    }

    if (provRes.status === 'fulfilled') {
      setProvinceRiskData(Array.isArray(provRes.value) ? provRes.value : []);
    } else {
      setProvinceRiskData(null);
    }

    if (distRes.status === 'fulfilled') {
      setDistrictRiskData(Array.isArray(distRes.value) ? distRes.value : []);
    } else {
      setDistrictRiskData(null);
    }

    if (cropRunRes.status === 'fulfilled') {
      setLatestCropTypeRun(cropRunRes.value?.run || null);
    } else {
      // Optional endpoint: ignore if not available.
      setLatestCropTypeRun(null);
    }

      setLastRefreshedAt(new Date().toISOString());
    } finally {
      isRefreshingRef.current = false;
      setIsRefreshing(false);
      setHasLoadedOnce(true);
    }
  }, []);

  useEffect(() => {
    refreshDashboard();
  }, [refreshDashboard]);

  useEffect(() => {
    const throttleMs = 45 * 1000;

    const maybeRefreshOnWake = () => {
      if (document.hidden) return;
      const now = Date.now();
      if (now - lastAutoRefreshAtRef.current < throttleMs) return;
      lastAutoRefreshAtRef.current = now;
      refreshDashboard();
    };

    window.addEventListener('focus', maybeRefreshOnWake);
    document.addEventListener('visibilitychange', maybeRefreshOnWake);

    return () => {
      window.removeEventListener('focus', maybeRefreshOnWake);
      document.removeEventListener('visibilitychange', maybeRefreshOnWake);
    };
  }, [refreshDashboard]);

  useEffect(() => {
    if (!isUpdatingRiskPredictions) return;

    let cancelled = false;
    const startedAt = Date.now();
    const timeoutMs = 2 * 60 * 1000;

    const poll = async () => {
      try {
        const status = await fetchRiskPredictionStatus();
        if (cancelled) return;
        if (!status?.is_running) {
          setIsUpdatingRiskPredictions(false);
          setRiskPredictionJobError(null);
          await refreshDashboard();
          return;
        }
        if (Date.now() - startedAt > timeoutMs) {
          setIsUpdatingRiskPredictions(false);
          setRiskPredictionJobError('Timed out waiting for predictions job');
          return;
        }
      } catch (e) {
        if (cancelled) return;
        setIsUpdatingRiskPredictions(false);
        setRiskPredictionJobError(e?.message || 'Failed to check predictions job status');
      }
    };

    const interval = setInterval(poll, 2000);
    poll();

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUpdatingRiskPredictions]);

  const handleRunRiskPredictions = async () => {
    setRiskPredictionJobError(null);
    setIsUpdatingRiskPredictions(true);
    try {
      await runRiskPredictions({ overwrite: false });
    } catch (e) {
      setIsUpdatingRiskPredictions(false);
      setRiskPredictionJobError(e?.message || 'Failed to start predictions job');
    }
  };

  const localGeoAnalytics = useMemo(() => {
    if (!Array.isArray(allFarms) || allFarms.length === 0) {
      return null;
    }
    if (!Array.isArray(allPredictions) || allPredictions.length === 0) {
      return null;
    }

    const farmById = new Map(allFarms.map((farm) => [farm.id, farm]));

    const districtAgg = new Map();
    const provinceAgg = new Map();

    for (const pred of allPredictions) {
      const farm = farmById.get(pred.farm_id);
      if (!farm) continue;

      const district = (farm.district || '').split(',')[0].trim();
      const province = (farm.province || '').trim();
      const risk = typeof pred.risk_score === 'number' ? pred.risk_score : Number(pred.risk_score);
      if (!Number.isFinite(risk)) continue;

      if (district) {
        const key = `${province}::${district}`;
        const entry = districtAgg.get(key) || { district, province, farm_count: 0, risk_sum: 0 };
        entry.farm_count += 1;
        entry.risk_sum += risk;
        districtAgg.set(key, entry);
      }

      if (province) {
        const entry = provinceAgg.get(province) || { province, farm_count: 0, risk_sum: 0 };
        entry.farm_count += 1;
        entry.risk_sum += risk;
        provinceAgg.set(province, entry);
      }
    }

    const districts = Array.from(districtAgg.values()).map((entry) => {
      const risk_score = entry.farm_count ? entry.risk_sum / entry.farm_count : 0;
      return {
        district: entry.district,
        province: entry.province,
        farm_count: entry.farm_count,
        risk_score,
        risk_level: getRiskLevel(risk_score),
        time_to_impact: null,
      };
    });

    const provinces = Array.from(provinceAgg.values()).map((entry) => {
      const risk_score = entry.farm_count ? entry.risk_sum / entry.farm_count : 0;
      return {
        province: entry.province,
        farm_count: entry.farm_count,
        risk_score,
        risk_level: getRiskLevel(risk_score),
        avg_ndvi: null,
        recommendation: null,
      };
    });

    return { districts, provinces };
  }, [allFarms, allPredictions]);

  const effectiveDistrictData = useMemo(() => {
    if (Array.isArray(districtRiskData)) return districtRiskData;
    return localGeoAnalytics?.districts ?? null;
  }, [districtRiskData, localGeoAnalytics]);

  const effectiveProvinceData = useMemo(() => {
    if (Array.isArray(provinceRiskData)) return provinceRiskData;
    return localGeoAnalytics?.provinces ?? null;
  }, [provinceRiskData, localGeoAnalytics]);

  const availableProvinces = useMemo(() => {
    const source = effectiveProvinceData;
    if (!Array.isArray(source)) return [];
    return source
      .map((row) => (row?.province ?? '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }, [effectiveProvinceData]);

  const filteredDistricts = useMemo(() => {
    if (!Array.isArray(effectiveDistrictData)) return [];
    if (!selectedProvince) return effectiveDistrictData;
    return effectiveDistrictData.filter((row) => (row?.province ?? '').trim() === selectedProvince);
  }, [effectiveDistrictData, selectedProvince]);

  const topGeoRows = useMemo(() => {
    const rows = geoView === 'province' ? effectiveProvinceData : filteredDistricts;
    if (!Array.isArray(rows)) return [];
    return [...rows]
      .filter((row) => typeof row?.risk_score === 'number' || Number.isFinite(Number(row?.risk_score)))
      .map((row) => ({ ...row, risk_score: typeof row.risk_score === 'number' ? row.risk_score : Number(row.risk_score) }))
      .sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0))
      .slice(0, 8);
  }, [effectiveProvinceData, filteredDistricts, geoView]);

  const geoMaxRisk = useMemo(() => {
    if (!topGeoRows.length) return 100;
    const max = Math.max(...topGeoRows.map((row) => row.risk_score || 0));
    return max > 0 ? max : 100;
  }, [topGeoRows]);

  const topHotspot = useMemo(() => {
    if (!topGeoRows.length) return null;
    return topGeoRows[0];
  }, [topGeoRows]);

  const latestPredictionStamp = useMemo(() => {
    if (!allPredictions.length) {
      return null;
    }
    const latest = allPredictions[allPredictions.length - 1];
    return formatDate(latest?.predicted_at);
  }, [allPredictions]);

  const satelliteFreshnessLine = useMemo(() => {
    if (!satelliteStats) return null;
    const dbCount = satelliteStats?.db?.count;
    const dbLatest = satelliteStats?.db?.latest_date;
    const diskCounts = satelliteStats?.disk?.counts;
    const diskLatest = satelliteStats?.disk?.latest_mtime;

    const parts = [];
    if (typeof dbCount === 'number') {
      parts.push(`DB images: ${formatNumber(dbCount)}`);
    }
    if (dbLatest) {
      parts.push(`DB latest: ${dbLatest}`);
    }
    if (diskCounts && (typeof diskCounts.sentinel2_real === 'number' || typeof diskCounts.sentinel2 === 'number')) {
      const s2r = typeof diskCounts.sentinel2_real === 'number' ? formatNumber(diskCounts.sentinel2_real) : '--';
      const s2 = typeof diskCounts.sentinel2 === 'number' ? formatNumber(diskCounts.sentinel2) : '--';
      parts.push(`Disk images: sentinel2_real=${s2r}, sentinel2=${s2}`);
    }
    if (diskLatest && (diskLatest.sentinel2_real || diskLatest.sentinel2)) {
      parts.push(`Disk latest: ${diskLatest.sentinel2_real || diskLatest.sentinel2}`);
    }
    return parts.length ? parts.join(' • ') : null;
  }, [satelliteStats]);

  const totalPredictions = useMemo(() => {
    if (typeof predictionCount === 'number') {
      return predictionCount;
    }
    if (analytics) {
      return analytics.highRisk + analytics.mediumRisk + analytics.lowRisk;
    }
    return 0;
  }, [analytics, predictionCount]);

  const highRiskShare = useMemo(() => {
    if (!analytics) {
      return '0.0%';
    }
    const total = analytics.totalPredictions || analytics.highRisk + analytics.mediumRisk + analytics.lowRisk;
    if (!total) {
      return '0.0%';
    }
    const value = (analytics.highRisk / total) * 100;
    return `${value.toFixed(1)}%`;
  }, [analytics]);

  const distribution = useMemo(() => {
    if (!analytics) {
      return [];
    }
    const total = analytics.totalPredictions || analytics.highRisk + analytics.mediumRisk + analytics.lowRisk;
    if (!total) {
      return [];
    }
    return [
      {
        key: 'low',
        label: 'Low Risk',
        range: '< 30%',
        value: analytics.lowRisk,
        percentage: (analytics.lowRisk / total) * 100,
        className: 'is-low',
      },
      {
        key: 'medium',
        label: 'Medium Risk',
        range: '30-60%',
        value: analytics.mediumRisk,
        percentage: (analytics.mediumRisk / total) * 100,
        className: 'is-medium',
      },
      {
        key: 'high',
        label: 'High Risk',
        range: '> 60%',
        value: analytics.highRisk,
        percentage: (analytics.highRisk / total) * 100,
        className: 'is-high',
      },
    ];
  }, [analytics]);

  const cropTypeDistribution = useMemo(() => {
    if (!Array.isArray(allFarms) || allFarms.length === 0) {
      return [];
    }

    const counts = new Map();
    for (const farm of allFarms) {
      const raw = farm?.crop_type;
      const crop = raw == null || String(raw).trim() === '' ? 'Unknown' : String(raw).trim();
      counts.set(crop, (counts.get(crop) || 0) + 1);
    }

    const total = allFarms.length || 1;
    const rows = Array.from(counts.entries())
      .map(([crop, count]) => ({ crop, count, percentage: (count / total) * 100 }))
      .sort((a, b) => b.count - a.count);

    const top = rows.slice(0, 8);
    const rest = rows.slice(8);
    if (rest.length) {
      const otherCount = rest.reduce((sum, r) => sum + r.count, 0);
      top.push({ crop: 'Other', count: otherCount, percentage: (otherCount / total) * 100 });
    }
    return top;
  }, [allFarms]);

  const cropTypeSummary = useMemo(() => {
    const total = Array.isArray(allFarms) ? allFarms.length : 0;
    if (!total) return { total: 0, filled: 0, unknown: 0 };
    let filled = 0;
    for (const farm of allFarms) {
      const v = farm?.crop_type;
      if (v != null && String(v).trim() !== '') filled += 1;
    }
    return { total, filled, unknown: Math.max(0, total - filled) };
  }, [allFarms]);

  const topDrivers = useMemo(() => (intelligenceMetrics?.topDrivers ?? []).slice(0, 4), [intelligenceMetrics]);

  const navSections = useMemo(
    () =>
      [
        { id: 'dashboard-overview', label: 'Overview', visible: true },
        { id: 'dashboard-analytics', label: 'Analytics', visible: Boolean(analytics) },
        { id: 'dashboard-intelligence', label: 'Intelligence', visible: Boolean(intelligenceMetrics) },
        { id: 'dashboard-drivers', label: 'Drivers', visible: topDrivers.length > 0 },
        { id: 'dashboard-distribution', label: 'Distribution', visible: Boolean(analytics) },
        { id: 'dashboard-assessments', label: 'Assessments', visible: true },
        { id: 'dashboard-alerts', label: 'Alerts', visible: true },
        { id: 'dashboard-actions', label: 'Actions', visible: true },
      ].filter((section) => section.visible),
    [analytics, intelligenceMetrics, topDrivers.length]
  );

  useEffect(() => {
    if (!navSections.some((section) => section.id === activeSection)) {
      setActiveSection('dashboard-overview');
    }
  }, [activeSection, navSections]);

  const { riskAlerts, updateAlerts } = useMemo(() => {
    const updates = recentAlerts.filter((alert) => (alert?.level ?? '').toLowerCase() === 'info');
    const risks = recentAlerts.filter((alert) => (alert?.level ?? '').toLowerCase() !== 'info');
    return { riskAlerts: risks, updateAlerts: updates };
  }, [recentAlerts]);

  const displayedAlerts = alertsView === 'updates' ? updateAlerts : riskAlerts;

  const handleRowToggle = (predictionId, farmId) => {
    setSelectedFarmId(farmId);
    setExpandedRows((prev) => {
      if (prev.includes(predictionId)) {
        return prev.filter((id) => id !== predictionId);
      }
      return [...prev, predictionId];
    });
  };

  const handleViewMap = (farmId) => {
    navigate(`/risk-map?farmId=${farmId}&focus=1`);
  };

  const avgConfidencePercent = useMemo(() => {
    const avg = intelligenceMetrics?.avgConfidence;
    if (typeof avg !== 'number' || Number.isNaN(avg)) {
      return null;
    }
    const raw = avg <= 1 ? avg * 100 : avg;
    const clamped = Math.max(0, Math.min(100, raw));
    return clamped;
  }, [intelligenceMetrics]);

  const trendSeries = useMemo(() => {
    if (!Array.isArray(allPredictions) || allPredictions.length === 0) {
      return [];
    }

    const bucket = new Map();
    for (const pred of allPredictions) {
      const stamp = pred?.predicted_at || pred?.created_at || pred?.timestamp;
      if (!stamp) continue;
      const date = new Date(stamp);
      if (Number.isNaN(date.getTime())) continue;

      const ymd = date.toISOString().slice(0, 10);
      const risk = typeof pred.risk_score === 'number' ? pred.risk_score : Number(pred.risk_score);
      if (!Number.isFinite(risk)) continue;

      const entry = bucket.get(ymd) || { date: ymd, count: 0, sumRisk: 0, highCount: 0 };
      entry.count += 1;
      entry.sumRisk += risk;
      if (risk >= 60) entry.highCount += 1;
      bucket.set(ymd, entry);
    }

    const rows = Array.from(bucket.values()).sort((a, b) => a.date.localeCompare(b.date));
    const tail = rows.slice(Math.max(rows.length - 14, 0));
    return tail.map((row) => {
      const avgRisk = row.count ? row.sumRisk / row.count : 0;
      const highShare = row.count ? (row.highCount / row.count) * 100 : 0;
      return { date: row.date, count: row.count, avgRisk, highShare };
    });
  }, [allPredictions]);

  const trendChart = useMemo(() => {
    if (!trendSeries.length) {
      return null;
    }

    const width = 640;
    const height = 180;
    const padding = { left: 44, right: 16, top: 14, bottom: 28 };
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;

    const maxCount = Math.max(...trendSeries.map((row) => row.count || 0), 1);
    const xStep = innerW / Math.max(trendSeries.length - 1, 1);
    const barW = Math.min(28, Math.max(10, innerW / Math.max(trendSeries.length * 1.8, 1)));

    const pctY = (pct) => padding.top + (1 - Math.max(0, Math.min(100, pct)) / 100) * innerH;
    const countY = (count) => padding.top + (1 - (count || 0) / maxCount) * innerH;

    const pointsPct = trendSeries
      .map((row, idx) => {
        const x = padding.left + idx * xStep;
        const y = pctY(row.highShare || 0);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

    const bars = trendSeries.map((row, idx) => {
      const xCenter = padding.left + idx * xStep;
      const x = xCenter - barW / 2;
      const y = countY(row.count);
      const h = padding.top + innerH - y;
      return { x, y, h, key: row.date, count: row.count };
    });

    const xLabels = trendSeries.map((row, idx) => {
      if (trendSeries.length > 10 && idx % 2 === 1) return null;
      const x = padding.left + idx * xStep;
      return { x, label: formatDate(row.date), key: row.date };
    });

    const grid = [0, 25, 50, 75, 100].map((pct) => ({
      pct,
      y: pctY(pct),
    }));

    return { width, height, padding, pointsPct, bars, xLabels, grid };
  }, [trendSeries]);

  const cropRiskRows = useMemo(() => {
    if (!Array.isArray(allFarms) || allFarms.length === 0) return [];
    if (!Array.isArray(allPredictions) || allPredictions.length === 0) return [];

    const farmById = new Map(allFarms.map((farm) => [farm.id, farm]));
    const agg = new Map();

    for (const pred of allPredictions) {
      const farm = farmById.get(pred.farm_id);
      if (!farm) continue;

      const crop = (farm.crop_type || farm.cropType || '').trim();
      if (!crop) continue;

      const risk = typeof pred.risk_score === 'number' ? pred.risk_score : Number(pred.risk_score);
      if (!Number.isFinite(risk)) continue;

      const entry = agg.get(crop) || { crop, count: 0, sumRisk: 0, highCount: 0 };
      entry.count += 1;
      entry.sumRisk += risk;
      if (risk >= 60) entry.highCount += 1;
      agg.set(crop, entry);
    }

    return Array.from(agg.values())
      .map((row) => ({
        ...row,
        avgRisk: row.count ? row.sumRisk / row.count : 0,
        highShare: row.count ? (row.highCount / row.count) * 100 : 0,
      }))
      .sort((a, b) => (b.avgRisk || 0) - (a.avgRisk || 0));
  }, [allFarms, allPredictions]);

  const topCrops = useMemo(() => cropRiskRows.slice(0, 8), [cropRiskRows]);

  const maxCropRisk = useMemo(() => {
    if (!topCrops.length) return 100;
    const max = Math.max(...topCrops.map((row) => row.avgRisk || 0));
    return max > 0 ? max : 100;
  }, [topCrops]);

  const riskDriverRows = useMemo(() => {
    // Preferred: derive from per-prediction risk_drivers contributions
    const agg = new Map();
    let hasPredictionDrivers = false;

    if (Array.isArray(allPredictions) && allPredictions.length) {
      for (const pred of allPredictions) {
        const drivers = pred?.risk_drivers;
        if (!drivers || typeof drivers !== 'object') continue;
        const entries = Object.entries(drivers);
        if (!entries.length) continue;
        hasPredictionDrivers = true;

        const risk = typeof pred.risk_score === 'number' ? pred.risk_score : Number(pred.risk_score);
        const isHigh = Number.isFinite(risk) && risk >= 60;

        for (const [name, value] of entries) {
          const numeric = typeof value === 'number' ? value : Number(value);
          if (!Number.isFinite(numeric)) continue;
          const key = String(name);
          const entry = agg.get(key) || {
            name: key,
            count: 0,
            sum: 0,
            highCount: 0,
            highSum: 0,
          };
          entry.count += 1;
          entry.sum += numeric;
          if (isHigh) {
            entry.highCount += 1;
            entry.highSum += numeric;
          }
          agg.set(key, entry);
        }
      }
    }

    if (hasPredictionDrivers && agg.size) {
      return {
        mode: 'contribution',
        rows: Array.from(agg.values())
          .map((entry) => ({
            name: entry.name,
            affected: entry.count,
            avgContribution: entry.count ? entry.sum / entry.count : 0,
            highAvgContribution: entry.highCount ? entry.highSum / entry.highCount : 0,
          }))
          .sort((a, b) => (b.highAvgContribution || 0) - (a.highAvgContribution || 0))
          .slice(0, 8),
      };
    }

    // Fallback: use aggregated top drivers from dashboard metrics
    const top = intelligenceMetrics?.topDrivers;
    if (!Array.isArray(top) || !top.length) {
      return { mode: 'none', rows: [] };
    }

    return {
      mode: 'count',
      rows: [...top]
        .map((driver) => ({
          name: driver?.name,
          affected: typeof driver?.count === 'number' ? driver.count : Number(driver?.count),
        }))
        .filter((row) => row.name)
        .sort((a, b) => (b.affected || 0) - (a.affected || 0))
        .slice(0, 8),
    };
  }, [allPredictions, intelligenceMetrics]);

  const maxDriverValue = useMemo(() => {
    if (!riskDriverRows?.rows?.length) return 100;
    const values = riskDriverRows.rows.map((row) => {
      if (riskDriverRows.mode === 'contribution') return row.highAvgContribution || 0;
      return row.affected || 0;
    });
    const max = Math.max(...values);
    return max > 0 ? max : 100;
  }, [riskDriverRows]);

  const confidenceBand = useMemo(() => {
    if (avgConfidencePercent == null) {
      return { label: '—', pill: 'No data' };
    }
    if (avgConfidencePercent >= 75) {
      return { label: 'High', pill: 'High confidence' };
    }
    if (avgConfidencePercent >= 50) {
      return { label: 'Medium', pill: 'Medium confidence' };
    }
    return { label: 'Low', pill: 'Low confidence' };
  }, [avgConfidencePercent]);

  return (
    <div className="dashboard-content">
      <div className="dashboard-header-container">
        <div>
          <h1 className="dashboard-title">Crop Risk Dashboard</h1>
          <p className="dashboard-subtitle">Operational overview for Rwanda crop monitoring</p>
          {satelliteFreshnessLine ? (
            <p className="dashboard-subtitle" style={{ marginTop: 6 }}>
              <strong>Data freshness:</strong> {satelliteFreshnessLine}
            </p>
          ) : null}
          {analytics?.metricsSource === 'satellite' && analytics?.stalePredictions ? (
            <p className="dashboard-subtitle" style={{ marginTop: 6 }}>
              <strong>Note:</strong> Satellite data is newer than stored predictions; dashboard risk metrics are derived from the latest imagery.
            </p>
          ) : null}
          {riskPredictionJobError ? (
            <p className="dashboard-subtitle" style={{ marginTop: 6, color: '#b42318' }}>
              <strong>Prediction update failed:</strong> {riskPredictionJobError}
            </p>
          ) : null}
          <div className="dashboard-meta">
            <div className="meta-pill">
              <div className="meta-label">
                {analytics?.metricsSource === 'satellite' ? 'Last Satellite Update' : 'Last Prediction Run'}
              </div>
              <div className="meta-value">{analytics?.latestPredictionAt ? formatDate(analytics.latestPredictionAt) : (latestPredictionStamp || '--')}</div>
            </div>
            <div className="meta-pill">
              <div className="meta-label">Active Alerts</div>
              <div className="meta-value">{formatCount(alertCount)}</div>
            </div>
            <div className="meta-pill">
              <div className="meta-label">High Risk Share</div>
              <div className="meta-value">{highRiskShare}</div>
            </div>
            <div className="meta-pill">
              <div className="meta-label">Avg Confidence</div>
              <div className="meta-value">
                {avgConfidencePercent == null
                  ? '--'
                  : `${formatNumber(avgConfidencePercent, { maximumFractionDigits: 0 })}%`}
              </div>
            </div>
            <div className="meta-pill">
              <div className="meta-label">Refreshed</div>
              <div className="meta-value">{lastRefreshedAt ? formatDate(lastRefreshedAt) : '--'}</div>
            </div>
          </div>
        </div>
        <div className="dashboard-controls">
          <button type="button" className="btn-tertiary" onClick={refreshDashboard} disabled={isRefreshing}>
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          {analytics?.stalePredictions ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={handleRunRiskPredictions}
              disabled={isRefreshing || isUpdatingRiskPredictions}
              title="Generate fresh predictions from latest satellite imagery"
            >
              {isUpdatingRiskPredictions ? 'Updating predictions…' : 'Update Predictions'}
            </button>
          ) : null}
          <button type="button" className="btn-secondary" onClick={() => navigate('/predictions')}>
            View Predictions
          </button>
          <button type="button" className="btn-primary" onClick={() => navigate('/risk-map')}>
            Open Risk Map
          </button>
        </div>
      </div>

      <div className="dashboard-section-nav" role="navigation" aria-label="Dashboard sections">
        <div className="dashboard-section-nav__inner">
          {navSections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`dashboard-section-nav__button ${activeSection === section.id ? 'is-active' : ''}`}
              onClick={() => {
                setActiveSection(section.id);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              {section.label}
            </button>
          ))}
        </div>
      </div>

      {activeSection === 'dashboard-overview' && (
        <>
          <div className="pipeline-status">
            <div className="pipeline-info">
              <strong>System status:</strong> live metrics and alerts updated from the latest pipeline run.
            </div>
            <div className="dashboard-meta">
              <div className="meta-pill">
                <div className="meta-label">Alerts</div>
                <div className="meta-value">{formatCount(alertCount)}</div>
              </div>
              <div className="meta-pill">
                <div className="meta-label">Farms</div>
                <div className="meta-value">{formatCount(farmCount)}</div>
              </div>
              <div className="meta-pill">
                <div className="meta-label">Crop Types</div>
                <div className="meta-value">
                  {cropTypeSummary.total ? `${formatNumber(cropTypeSummary.filled)}/${formatNumber(cropTypeSummary.total)}` : '--'}
                </div>
              </div>
              <div className="meta-pill">
                <div className="meta-label">Satellite Images</div>
                <div className="meta-value">{formatCount(satelliteCount)}</div>
              </div>
            </div>
          </div>

          <div className="dashboard-widgets">
            <div className="widget">
              <div className="widget-content">
                <div className="widget-value">{formatNumber(satelliteCount)}</div>
                <div className="widget-label">Satellite Images</div>
                <p className="widget-sublabel">Processed and available for analysis</p>
              </div>
            </div>
            <div className="widget">
              <div className="widget-content">
                <div className="widget-value">{formatNumber(farmCount)}</div>
                <div className="widget-label">Farms Monitored</div>
                <p className="widget-sublabel">Registered farms in the system</p>
              </div>
            </div>
            <div className="widget">
              <div className="widget-content">
                <div className="widget-value">{formatNumber(predictionCount)}</div>
                <div className="widget-label">Risk Assessments</div>
                <p className="widget-sublabel">Model runs and forecast outputs</p>
              </div>
            </div>
            <div className="widget widget--alert">
              <div className="widget-content">
                <div className="widget-value">{formatCount(alertCount)}</div>
                <div className="widget-label">Active Alerts</div>
                <p className="widget-sublabel">Priority field notifications</p>
              </div>
            </div>
          </div>
        </>
      )}

      {activeSection === 'dashboard-analytics' && analytics && (
        <section className="dashboard-section analytics-section">
          <div className="section-header">
            <h2 className="section-title">Analytics Snapshot</h2>
            <span className="section-meta">Key risk and yield indicators</span>
          </div>
          <div className="analytics-grid">
            <div className="analytics-card analytics-card--highlight">
              <div>
                <div className="analytics-card__label">High Risk Farms</div>
                <div className="analytics-card__value">{formatNumber(analytics.highRisk)}</div>
                <div className="analytics-card__sublabel">{highRiskShare} of monitored predictions</div>
              </div>
            </div>
            <div className="analytics-card">
              <div>
                <div className="analytics-card__label">Average Risk Score</div>
                <div className="analytics-card__value">{formatNumber(analytics.avgRisk, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%</div>
                <div className="analytics-card__sublabel">Across {formatNumber(totalPredictions)} predictions</div>
              </div>
            </div>
            <div className="analytics-card">
              <div>
                <div className="analytics-card__label">Avg Yield Loss</div>
                <div className="analytics-card__value">{formatNumber(analytics.avgYieldLoss, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%</div>
                <div className="analytics-card__sublabel">Projected near-term impact</div>
              </div>
            </div>
            <div className="analytics-card">
              <div>
                <div className="analytics-card__label">Total Predictions</div>
                <div className="analytics-card__value">{formatNumber(totalPredictions)}</div>
                <div className="analytics-card__sublabel">Latest run: {latestPredictionStamp || '--'}</div>
              </div>
            </div>
          </div>

          <div className="analytics-subnav" role="tablist" aria-label="Analytics views">
            <button
              type="button"
              className={`analytics-subnav__btn ${analyticsView === 'hotspots' ? 'is-active' : ''}`}
              onClick={() => setAnalyticsView('hotspots')}
            >
              Hotspots
            </button>
            <button
              type="button"
              className={`analytics-subnav__btn ${analyticsView === 'trend' ? 'is-active' : ''}`}
              onClick={() => setAnalyticsView('trend')}
            >
              Trend
            </button>
            <button
              type="button"
              className={`analytics-subnav__btn ${analyticsView === 'crops' ? 'is-active' : ''}`}
              onClick={() => setAnalyticsView('crops')}
            >
              Crops
            </button>
            <button
              type="button"
              className={`analytics-subnav__btn ${analyticsView === 'confidence' ? 'is-active' : ''}`}
              onClick={() => setAnalyticsView('confidence')}
            >
              Confidence
            </button>
            <button
              type="button"
              className={`analytics-subnav__btn ${analyticsView === 'drivers' ? 'is-active' : ''}`}
              onClick={() => setAnalyticsView('drivers')}
            >
              Drivers
            </button>
          </div>

          {analyticsView === 'hotspots' && (
          <div className="geo-visual">
            <div className="section-header geo-visual__header">
              <div>
                <h3 className="geo-visual__title">Geographic Hotspots</h3>
                <div className="section-meta">Highest risk areas based on latest model outputs</div>
              </div>
              <div className="geo-visual__controls">
                <div className="geo-toggle" role="tablist" aria-label="Geographic view">
                  <button
                    type="button"
                    className={`geo-toggle__btn ${geoView === 'district' ? 'is-active' : ''}`}
                    onClick={() => setGeoView('district')}
                  >
                    Districts
                  </button>
                  <button
                    type="button"
                    className={`geo-toggle__btn ${geoView === 'province' ? 'is-active' : ''}`}
                    onClick={() => setGeoView('province')}
                  >
                    Provinces
                  </button>
                </div>
                {geoView === 'district' && availableProvinces.length > 0 && (
                  <select
                    className="geo-select"
                    value={selectedProvince}
                    onChange={(e) => setSelectedProvince(e.target.value)}
                    aria-label="Filter by province"
                  >
                    <option value="">All provinces</option>
                    {availableProvinces.map((province) => (
                      <option key={province} value={province}>
                        {province}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {topGeoRows.length === 0 ? (
              <div className="dashboard-empty-state">Geographic analytics are not available yet.</div>
            ) : (
              <div className="geo-visual__grid">
                <div className="geo-chart">
                  <div className="geo-chart__title">Top {geoView === 'district' ? 'Districts' : 'Provinces'} by Risk</div>
                  <div className="bar-list">
                    {topGeoRows.map((row) => {
                      const label = geoView === 'district' ? row.district : row.province;
                      const meta = geoView === 'district' ? row.province : `${formatNumber(row.farm_count)} farms`;
                      const width = Math.max(6, Math.round(((row.risk_score || 0) / geoMaxRisk) * 100));
                      return (
                        <div key={`${geoView}-${label}-${meta}`} className="bar-row">
                          <div className="bar-row__label">
                            <div className="bar-row__name">{label || 'Unknown'}</div>
                            <div className="bar-row__meta">{meta || ''}</div>
                          </div>
                          <div className="bar-row__bar">
                            <div className="bar-row__fill" style={{ width: `${width}%` }} />
                          </div>
                          <div className="bar-row__value">{formatNumber(row.risk_score, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="geo-summary">
                  <div className="geo-summary__title">Highest Risk</div>
                  {topHotspot ? (
                    <div className="geo-summary__body">
                      <div className="geo-summary__name">
                        {geoView === 'district' ? topHotspot.district : topHotspot.province}
                      </div>
                      {geoView === 'district' && topHotspot.province && (
                        <div className="geo-summary__meta">{topHotspot.province}</div>
                      )}
                      <div className="geo-summary__metric">
                        <span>Risk score</span>
                        <strong>{formatNumber(topHotspot.risk_score, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%</strong>
                      </div>
                      <div className="geo-summary__metric">
                        <span>Farms</span>
                        <strong>{formatNumber(topHotspot.farm_count)}</strong>
                      </div>
                      {geoView === 'district' && topHotspot.time_to_impact && (
                        <div className="geo-summary__metric">
                          <span>Time to impact</span>
                          <strong>{topHotspot.time_to_impact}</strong>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="geo-summary__body geo-summary__body--empty">No hotspot data.</div>
                  )}
                </div>
              </div>
            )}
          </div>
          )}

          {analyticsView === 'trend' && (
            <div className="trend-visual">
              <div className="trend-card">
                <div className="trend-card__header">
                  <div>
                    <div className="trend-card__title">Risk Trend (Last 14 days)</div>
                    <div className="trend-card__meta">Daily risk score and volume from assessments</div>
                    <div className="trend-card__hint">
                      An assessment is one model run that scores a farm on a given date (not a weather forecast).
                      Bars = how many assessments happened that day. Line = what % of those were high risk (risk score ≥ 60).
                    </div>
                  </div>
                  <div className="trend-metrics">
                    <div className="trend-metric">
                      <div className="trend-metric__label">Latest avg risk</div>
                      <div className="trend-metric__value">
                        {trendSeries.length
                          ? `${formatNumber(trendSeries[trendSeries.length - 1].avgRisk, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`
                          : '--'}
                      </div>
                    </div>
                    <div className="trend-metric">
                      <div className="trend-metric__label">Latest high-risk share</div>
                      <div className="trend-metric__value">
                        {trendSeries.length
                          ? `${formatNumber(trendSeries[trendSeries.length - 1].highShare, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`
                          : '--'}
                      </div>
                    </div>
                  </div>
                </div>

                {trendSeries.length < 3 ? (
                  <div className="dashboard-empty-state">Not enough historical predictions to render a trend.</div>
                ) : (
                  <div className="trend-card__body">
                    <div className="trend-chart">
                      {trendChart && (
                        <>
                          <div className="trend-legend">
                            <span className="trend-legend__item">
                              <span className="trend-legend__swatch is-bars" /> Assessments
                            </span>
                            <span className="trend-legend__item">
                              <span className="trend-legend__swatch is-line" /> High-risk share (%)
                            </span>
                          </div>
                          <svg
                            className="trend-svg"
                            viewBox={`0 0 ${trendChart.width} ${trendChart.height}`}
                            width="100%"
                            role="img"
                            aria-label="Trend chart: assessment volume (bars) and high-risk share percent (line)"
                          >
                            {trendChart.grid.map((g) => (
                              <g key={g.pct}>
                                <line
                                  x1={trendChart.padding.left}
                                  x2={trendChart.width - trendChart.padding.right}
                                  y1={g.y}
                                  y2={g.y}
                                  className="trend-grid"
                                />
                                <text x={trendChart.padding.left - 8} y={g.y + 4} textAnchor="end" className="trend-axis">
                                  {g.pct}
                                </text>
                              </g>
                            ))}

                            {trendChart.bars.map((b) => (
                              <rect
                                key={b.key}
                                x={b.x}
                                y={b.y}
                                width={Math.max(6, (trendChart.bars.length ? (trendChart.width - trendChart.padding.left - trendChart.padding.right) / trendChart.bars.length : 10) * 0.6)}
                                height={b.h}
                                className="trend-bar"
                                rx="3"
                              />
                            ))}

                            <polyline className="trend-line" fill="none" points={trendChart.pointsPct} />

                            {trendChart.xLabels.filter(Boolean).map((lbl) => (
                              <text key={lbl.key} x={lbl.x} y={trendChart.height - 8} textAnchor="middle" className="trend-x">
                                {lbl.label}
                              </text>
                            ))}
                          </svg>
                        </>
                      )}
                    </div>
                    <div className="trend-table">
                      <table className="data-table trend-mini">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th className="table-center">Assessments</th>
                            <th className="table-center">Avg risk</th>
                            <th className="table-center">High-risk share</th>
                          </tr>
                        </thead>
                        <tbody>
                          {trendSeries.map((row) => (
                            <tr key={row.date}>
                              <td>{formatDate(row.date)}</td>
                              <td className="table-center">{formatNumber(row.count)}</td>
                              <td className="table-center">{formatNumber(row.avgRisk, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%</td>
                              <td className="table-center">{formatNumber(row.highShare, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {analyticsView === 'crops' && (
            <div className="crops-visual">
              <div className="geo-visual__grid">
                <div className="geo-chart">
                  <div className="geo-chart__title">Top Crops by Average Risk</div>
                  {topCrops.length === 0 ? (
                    <div className="dashboard-empty-state">
                      No crop-level risk breakdown yet (this requires risk predictions). Crop types can still be viewed below.
                    </div>
                  ) : (
                    <div className="bar-list">
                      {topCrops.map((row) => {
                        const width = Math.max(6, Math.round(((row.avgRisk || 0) / maxCropRisk) * 100));
                        return (
                          <div key={row.crop} className="bar-row">
                            <div className="bar-row__label">
                              <div className="bar-row__name">{row.crop}</div>
                              <div className="bar-row__meta">{formatNumber(row.count)} assessments</div>
                            </div>
                            <div className="bar-row__bar">
                              <div className="bar-row__fill" style={{ width: `${width}%` }} />
                            </div>
                            <div className="bar-row__value">{formatNumber(row.avgRisk, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="geo-summary">
                  <div className="geo-summary__title">Crop Hotspot</div>
                  {topCrops.length ? (
                    <div className="geo-summary__body">
                      <div className="geo-summary__name">{topCrops[0].crop}</div>
                      <div className="geo-summary__metric">
                        <span>Avg risk</span>
                        <strong>{formatNumber(topCrops[0].avgRisk, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%</strong>
                      </div>
                      <div className="geo-summary__metric">
                        <span>High-risk share</span>
                        <strong>{formatNumber(topCrops[0].highShare, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%</strong>
                      </div>
                      <div className="geo-summary__metric">
                        <span>Assessments</span>
                        <strong>{formatNumber(topCrops[0].count)}</strong>
                      </div>
                    </div>
                  ) : (
                    <div className="geo-summary__body geo-summary__body--empty">No crop data.</div>
                  )}
                </div>
              </div>

              <div className="section-header" style={{ marginTop: 18 }}>
                <h3 className="section-title">Crop Type Distribution</h3>
                <div className="section-meta">
                  From farms.crop_type
                  {latestCropTypeRun?.created_utc ? ` · last run ${formatDate(latestCropTypeRun.created_utc)}` : ''}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <button type="button" className="btn-primary" onClick={() => navigate('/crop-type')}
                >
                  Open Crop Type Tools
                </button>
                <button type="button" className="btn-tertiary" onClick={refreshDashboard} disabled={isRefreshing}>
                  {isRefreshing ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>

              {cropTypeDistribution.length ? (
                <div className="drivers-grid">
                  {cropTypeDistribution.map((row) => (
                    <div key={row.crop} className="driver-card">
                      <div className="driver-card__label">{row.crop}</div>
                      <div className="driver-card__value">{formatNumber(row.count)}</div>
                      <div className="driver-card__meta">{row.percentage.toFixed(1)}% of farms</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="dashboard-empty-state">No crop_type values found in farms yet.</div>
              )}

              {latestCropTypeRun?.predictions_csv ? (
                <div className="dashboard-empty-state" style={{ textAlign: 'left', marginTop: 12 }}>
                  Latest crop-type run: <strong>{latestCropTypeRun.run_dir}</strong>
                  <div style={{ opacity: 0.9, marginTop: 6 }}>Predictions: {latestCropTypeRun.predictions_csv}</div>
                </div>
              ) : null}
            </div>
          )}

          {analyticsView === 'confidence' && (
            <div className="confidence-visual">
              <div className="geo-visual__grid">
                <div className="geo-chart">
                  <div className="geo-chart__title">Model Confidence</div>
                  <div className="confidence-block">
                    <div className="confidence-block__value">
                      {avgConfidencePercent == null
                        ? '--'
                        : `${formatNumber(avgConfidencePercent, { maximumFractionDigits: 0 })}%`}
                    </div>
                    <div className="confidence-block__meta">{confidenceBand.pill}</div>
                    <div className="confidence-bar">
                      <div
                        className="confidence-bar__fill"
                        style={{ width: `${Math.max(0, Math.min(100, avgConfidencePercent ?? 0))}%` }}
                      />
                    </div>
                    <div className="confidence-block__hint">Average confidence across the latest model outputs.</div>
                  </div>
                </div>

                <div className="geo-summary">
                  <div className="geo-summary__title">Operational Impact</div>
                  <div className="geo-summary__body">
                    <div className="geo-summary__metric">
                      <span>High risk farms</span>
                      <strong>{formatNumber(analytics.highRisk)}</strong>
                    </div>
                    <div className="geo-summary__metric">
                      <span>Avg yield loss</span>
                      <strong>{formatNumber(analytics.avgYieldLoss, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%</strong>
                    </div>
                    <div className="geo-summary__metric">
                      <span>Economic loss</span>
                      <strong>
                        {intelligenceMetrics
                          ? `$${formatNumber(intelligenceMetrics.totalEconomicLoss, { maximumFractionDigits: 0 })}`
                          : '--'}
                      </strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {analyticsView === 'drivers' && (
            <div className="drivers-visual">
              <div className="geo-visual__grid">
                <div className="geo-chart">
                  <div className="geo-chart__title">Top Risk Drivers</div>
                  {riskDriverRows.mode === 'none' || riskDriverRows.rows.length === 0 ? (
                    <div className="dashboard-empty-state">No risk-driver breakdown available yet.</div>
                  ) : (
                    <div className="bar-list">
                      {riskDriverRows.rows.map((row) => {
                        const label = formatDriverName(row.name);
                        const value =
                          riskDriverRows.mode === 'contribution'
                            ? row.highAvgContribution
                            : row.affected;
                        const width = Math.max(6, Math.round(((value || 0) / maxDriverValue) * 100));
                        const meta =
                          riskDriverRows.mode === 'contribution'
                            ? `High-risk avg: ${formatNumber(row.highAvgContribution, {
                                maximumFractionDigits: 0,
                                minimumFractionDigits: 0,
                              })}% • Seen in ${formatNumber(row.affected)} records`
                            : `Farms impacted: ${formatNumber(row.affected)}`;

                        return (
                          <div key={row.name} className="bar-row">
                            <div className="bar-row__label">
                              <div className="bar-row__name">{label}</div>
                              <div className="bar-row__meta">{meta}</div>
                            </div>
                            <div className="bar-row__bar">
                              <div className="bar-row__fill" style={{ width: `${width}%` }} />
                            </div>
                            <div className="bar-row__value">
                              {riskDriverRows.mode === 'contribution'
                                ? `${formatNumber(value, { maximumFractionDigits: 0, minimumFractionDigits: 0 })}%`
                                : formatNumber(value)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="geo-summary">
                  <div className="geo-summary__title">What to Watch</div>
                  <div className="geo-summary__body">
                    <div className="geo-summary__metric">
                      <span>Primary driver</span>
                      <strong>
                        {riskDriverRows.rows.length
                          ? formatDriverName(riskDriverRows.rows[0].name)
                          : '--'}
                      </strong>
                    </div>
                    <div className="geo-summary__metric">
                      <span>Data source</span>
                      <strong>
                        {riskDriverRows.mode === 'contribution'
                          ? 'Prediction contributions'
                          : riskDriverRows.mode === 'count'
                          ? 'Dashboard metrics'
                          : '--'}
                      </strong>
                    </div>
                    <div className="geo-summary__metric">
                      <span>Action</span>
                      <strong>Target mitigation</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {activeSection === 'dashboard-analytics' && !analytics && (
        <div className="dashboard-empty-state">
          {isRefreshing || !hasLoadedOnce ? (
            <>Loading analytics…</>
          ) : (
            <>Analytics data is not available right now.</>
          )}
          {!isRefreshing ? (
            <div style={{ marginTop: 12 }}>
              <button type="button" className="btn-tertiary" onClick={refreshDashboard}>
                Refresh
              </button>
            </div>
          ) : null}
        </div>
      )}

      {activeSection === 'dashboard-intelligence' && intelligenceMetrics && (
        <section className="dashboard-section intelligence-section">
          <div className="section-header">
            <h2 className="section-title">Intelligence Brief</h2>
            <span className="section-meta">Time-to-impact, confidence, and national exposure</span>
          </div>
          <div className="intelligence-grid">
            <div className="intelligence-card">
              <h3 className="intelligence-card__title">Time to Impact</h3>
              <ul className="impact-list">
                <li className="impact-item is-critical">
                  <span className="impact-item__label">Immediate (&lt; 7 days)</span>
                  <span className="impact-item__value">{formatNumber(intelligenceMetrics.immediate)}</span>
                </li>
                <li className="impact-item is-warning">
                  <span className="impact-item__label">Short term (7-14 days)</span>
                  <span className="impact-item__value">{formatNumber(intelligenceMetrics.shortTerm)}</span>
                </li>
                <li className="impact-item is-caution">
                  <span className="impact-item__label">Medium term (14-30 days)</span>
                  <span className="impact-item__value">{formatNumber(intelligenceMetrics.mediumTerm)}</span>
                </li>
                <li className="impact-item is-stable">
                  <span className="impact-item__label">Stable</span>
                  <span className="impact-item__value">{formatNumber(intelligenceMetrics.stable)}</span>
                </li>
              </ul>
            </div>

            <div className="intelligence-card">
              <h3 className="intelligence-card__title">Model Confidence</h3>
              <div className="confidence-score">
                {avgConfidencePercent == null ? '--' : formatNumber(avgConfidencePercent, { maximumFractionDigits: 0 })}
              </div>
              <div className="confidence-caption">Average confidence ({confidenceBand.label})</div>
              <div className="confidence-pill">{confidenceBand.pill}</div>
            </div>

            <div className="intelligence-card intelligence-card--impact">
              <h3 className="intelligence-card__title">National Impact</h3>
              <div className="national-metrics">
                <div className="national-metric">
                  <div className="national-metric__label">Projected Economic Loss</div>
                  <div className="national-metric__value">${formatNumber(intelligenceMetrics.totalEconomicLoss, { maximumFractionDigits: 0 })}</div>
                </div>
                <div className="national-metric">
                  <div className="national-metric__label">Yield Loss (tons)</div>
                  <div className="national-metric__value">{formatNumber(intelligenceMetrics.totalYieldLoss, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}</div>
                </div>
                <div className="national-metric">
                  <div className="national-metric__label">Meals at Risk</div>
                  <div className="national-metric__value">{formatNumber(intelligenceMetrics.totalMealsLost)}</div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {activeSection === 'dashboard-intelligence' && !intelligenceMetrics && (
        <div className="dashboard-empty-state">
          {isRefreshing || !hasLoadedOnce ? (
            <>Loading intelligence metrics…</>
          ) : (
            <>Intelligence metrics are not available right now.</>
          )}
          {!isRefreshing ? (
            <div style={{ marginTop: 12 }}>
              <button type="button" className="btn-tertiary" onClick={refreshDashboard}>
                Refresh
              </button>
            </div>
          ) : null}
        </div>
      )}

      {activeSection === 'dashboard-drivers' && topDrivers.length > 0 && (
        <section className="dashboard-section drivers-section">
          <div className="section-header">
            <h2 className="section-title">Top Risk Drivers</h2>
            <span className="section-meta">Leading climate and vegetation stressors</span>
          </div>
          <div className="drivers-grid">
            {topDrivers.map((driver) => (
              <div key={driver.name} className="driver-card">
                <div className="driver-card__label">{formatDriverName(driver.name)}</div>
                <div className="driver-card__value">{formatNumber(driver.count)}</div>
                <div className="driver-card__meta">Farms impacted</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeSection === 'dashboard-drivers' && topDrivers.length === 0 && (
        <div className="dashboard-empty-state">
          No risk drivers available for the current dataset.
        </div>
      )}

      {activeSection === 'dashboard-distribution' && analytics && (
        <section className="dashboard-section distribution-section">
          <div className="section-header">
            <h2 className="section-title">Risk Distribution</h2>
            <span className="section-meta">Across monitored farms</span>
          </div>
          <div className="distribution-bars">
            {distribution.map((item) => (
              <div key={item.key} className="distribution-item">
                <div
                  className={`distribution-bar ${item.className}`}
                  style={{ height: `${Math.max((item.percentage / 100) * 220, 60)}px` }}
                >
                  <span className="distribution-bar__value">{formatNumber(item.value)}</span>
                </div>
                <div className="distribution-caption">
                  <div className="distribution-label">{item.label}</div>
                  <div className="distribution-range">{item.range}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="section-header" style={{ marginTop: 24 }}>
            <h2 className="section-title">Crop Type Distribution</h2>
            <span className="section-meta">From farms.crop_type (refresh after recompute/apply)</span>
          </div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <button type="button" className="btn-primary" onClick={() => navigate('/crop-type')}>
              Open Crop Type Tools
            </button>
            <button type="button" className="btn-tertiary" onClick={refreshDashboard} disabled={isRefreshing}>
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          {cropTypeDistribution.length ? (
            <div className="drivers-grid">
              {cropTypeDistribution.map((row) => (
                <div key={row.crop} className="driver-card">
                  <div className="driver-card__label">{row.crop}</div>
                  <div className="driver-card__value">{formatNumber(row.count)}</div>
                  <div className="driver-card__meta">{row.percentage.toFixed(1)}% of farms</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="dashboard-empty-state">No farms loaded yet.</div>
          )}

          {latestCropTypeRun?.predictions_csv ? (
            <div className="dashboard-empty-state" style={{ textAlign: 'left', marginTop: 12 }}>
              Latest crop-type run: <strong>{latestCropTypeRun.run_dir}</strong>
              <div style={{ opacity: 0.9, marginTop: 6 }}>Predictions: {latestCropTypeRun.predictions_csv}</div>
            </div>
          ) : null}
        </section>
      )}

      {activeSection === 'dashboard-distribution' && !analytics && (
        <div className="dashboard-empty-state">
          {isRefreshing || !hasLoadedOnce ? (
            <>Loading distribution…</>
          ) : (
            <>Distribution data is not available right now.</>
          )}
          {!isRefreshing ? (
            <div style={{ marginTop: 12 }}>
              <button type="button" className="btn-tertiary" onClick={refreshDashboard}>
                Refresh
              </button>
            </div>
          ) : null}
        </div>
      )}

      {activeSection === 'dashboard-assessments' && (
      <section className="dashboard-section table-section">
        <div className="section-header">
          <h3 className="section-title">Recent Risk Assessments</h3>
          <div className="section-meta">Last 10 intelligence runs</div>
        </div>
        <div className="data-table-container">
          <table className="data-table recent-assessments">
            <thead>
              <tr>
                <th>Farm</th>
                <th>Risk</th>
                <th>Time</th>
                <th>Confidence</th>
                <th>Top Driver</th>
                <th className="table-center">Map</th>
              </tr>
            </thead>
            <tbody>
              {recentPredictions.length === 0 && (
                <tr>
                  <td colSpan={6} className="table-empty">No risk assessments available.</td>
                </tr>
              )}
              {recentPredictions.map((prediction) => {
                const riskLevel = getRiskLevel(prediction.risk_score);
                const timeMeta = getTimeToImpactMeta(prediction.time_to_impact);
                const confidenceMeta = getConfidenceMeta(prediction.confidence_level);
                const topDriver = prediction.risk_drivers
                  ? Object.entries(prediction.risk_drivers).sort((a, b) => b[1] - a[1])[0]
                  : null;

                return (
                  <React.Fragment key={prediction.id}>
                    <tr
                      className={`data-table-row ${selectedFarmId === prediction.farm_id ? 'is-selected' : ''}`}
                      onClick={() => handleRowToggle(prediction.id, prediction.farm_id)}
                    >
                      <td>
                        <div className="table-primary">
                          <button
                            type="button"
                            className="btn-link"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleViewMap(prediction.farm_id);
                            }}
                            title="Open focused view on the map"
                          >
                            Farm #{prediction.farm_id}
                          </button>
                        </div>
                        <div className="table-secondary">{formatDate(prediction.predicted_at)}</div>
                      </td>
                      <td>
                        <span className={`risk-pill is-${riskLevel}`}>
                          {formatNumber(prediction.risk_score, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%
                        </span>
                        <div className="table-tertiary">
                          Yield impact: {prediction.yield_loss ? `${formatNumber(prediction.yield_loss, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%` : '-'}
                        </div>
                      </td>
                      <td>
                        {timeMeta ? (
                          <span className={timeMeta.className}>
                            {timeMeta.label}
                          </span>
                        ) : (
                          <span className="status-pill is-neutral">—</span>
                        )}
                      </td>
                      <td>
                        {confidenceMeta ? (
                          <div>
                            <span className={confidenceMeta.className}>{confidenceMeta.label}</span>
                            <div className="table-tertiary">{formatNumber(prediction.confidence_score, { maximumFractionDigits: 0 })}%</div>
                          </div>
                        ) : (
                          <span className="status-pill is-neutral">—</span>
                        )}
                      </td>
                      <td>
                        {topDriver ? (
                          <div>
                            <div className="table-primary">{formatDriverName(topDriver[0])}</div>
                            <div className="table-tertiary">{formatNumber(topDriver[1], { maximumFractionDigits: 0 })}% contribution</div>
                          </div>
                        ) : (
                          <span className="table-tertiary">-</span>
                        )}
                      </td>
                      <td className="table-center">
                        <button
                          type="button"
                          className="btn-tertiary"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleViewMap(prediction.farm_id);
                          }}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                    <tr className={`data-table-detail ${expandedRows.includes(prediction.id) ? 'is-open' : ''}`}>
                      <td colSpan={6}>
                        <div className="detail-grid">
                          <div className="detail-card">
                            <div className="detail-card__title">Risk Explanation</div>
                            <div className="detail-card__body">{prediction.risk_explanation || 'No explanation provided.'}</div>
                          </div>
                          {prediction.recommendations && prediction.recommendations.length > 0 && (
                            <div className="detail-card">
                              <div className="detail-card__title">Recommendations</div>
                              <div className="recommendations-list">
                                {prediction.recommendations.slice(0, 2).map((recommendation, idx) => (
                                  <div
                                    key={`${prediction.id}-rec-${idx}`}
                                    className={`recommendation-item ${recommendation.urgency === 'Immediate' ? 'is-critical' : 'is-warning'}`}
                                  >
                                    <div className="recommendation-item__title">
                                      {recommendation.urgency}: {recommendation.action}
                                    </div>
                                    <div className="recommendation-item__meta">
                                      {recommendation.timeframe} • {recommendation.priority} Priority
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {prediction.impact_metrics && (
                            <div className="detail-card">
                              <div className="detail-card__title">Impact Metrics</div>
                              <ul className="impact-metrics">
                                <li>
                                  Economic: <strong>${formatNumber(prediction.impact_metrics.economic_loss_usd, { maximumFractionDigits: 0 })}</strong>
                                </li>
                                <li>
                                  Yield Loss:{' '}
                                  <strong>
                                    {formatNumber(prediction.impact_metrics.yield_loss_tons, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} tons
                                  </strong>
                                </li>
                                <li>
                                  Meals Lost: <strong>{formatNumber(prediction.impact_metrics.meals_lost)}</strong>
                                </li>
                              </ul>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {activeSection === 'dashboard-alerts' && (
      <section className="dashboard-section alerts-section">
        <div className="section-header">
          <h3 className="section-title">Priority Alerts</h3>
          <div className="section-header-actions">
            <div className="section-meta">Live field notifications</div>
            <div className="view-tabs alerts-tabs" role="tablist" aria-label="Alert filters">
              <button
                type="button"
                className={`view-tab ${alertsView === 'risk' ? 'active' : ''}`}
                onClick={() => setAlertsView('risk')}
              >
                Risk alerts <span className="tab-count">{riskAlerts.length}</span>
              </button>
              <button
                type="button"
                className={`view-tab ${alertsView === 'updates' ? 'active' : ''}`}
                onClick={() => setAlertsView('updates')}
              >
                Data updates <span className="tab-count">{updateAlerts.length}</span>
              </button>
            </div>
          </div>
        </div>
        <div className="alerts-list">
          {displayedAlerts.length === 0 && <div className="alerts-empty">No alerts available.</div>}
          {displayedAlerts.map((alert) => {
            const level = (alert?.level ?? '').toLowerCase();
            let levelClass = 'is-info';
            if (level === 'warning') {
              levelClass = 'is-warning';
            } else if (level === 'critical') {
              levelClass = 'is-critical';
            }
            const key = alert?.id ?? `${alert?.farm_id ?? 'farm'}-${alert?.created_at ?? Math.random()}`;
            return (
              <div key={key} className={`alert-item ${levelClass}`}>
                <div className="alert-item__header">
                  <span className="alert-item__title">Farm #{alert.farm_id}</span>
                  <span className="alert-item__time">{formatDate(alert.created_at)}</span>
                </div>
                <div className="alert-item__message">{alert.message}</div>
                <span className="alert-item__badge">{level || 'info'}</span>
              </div>
            );
          })}
        </div>
      </section>
      )}

      {activeSection === 'dashboard-actions' && (
      <section className="dashboard-section action-section">
        <div className="section-header">
          <h3 className="section-title">Recommended Actions</h3>
          <div className="section-meta">Suggested focus for the next sprint</div>
        </div>
        <ul className="action-list">
          {intelligenceMetrics && intelligenceMetrics.immediate > 0 && (
            <li className="action-list__item is-critical">
              {formatNumber(intelligenceMetrics.immediate)} farms require immediate intervention within 7 days.
            </li>
          )}
          {intelligenceMetrics && intelligenceMetrics.shortTerm > 0 && (
            <li className="action-list__item is-warning">
              {formatNumber(intelligenceMetrics.shortTerm)} farms at risk in 7-14 days — schedule deployments.
            </li>
          )}
          {analytics && analytics.highRisk > 0 && (
            <li className="action-list__item">
              {formatNumber(analytics.highRisk)} farms remain at high risk — coordinate agronomy support teams.
            </li>
          )}
          {intelligenceMetrics && intelligenceMetrics.totalEconomicLoss > 50000 && (
            <li className="action-list__item">
              Economic exposure of ${formatNumber(intelligenceMetrics.totalEconomicLoss, { maximumFractionDigits: 0 })} — evaluate contingency funding.
            </li>
          )}
          {topDrivers.length > 0 && (
            <li className="action-list__item">
              Primary driver: <strong>{formatDriverName(topDrivers[0].name)}</strong> affecting {formatNumber(topDrivers[0].count)} farms — deploy targeted agronomy guidance.
            </li>
          )}
          <li className="action-list__item">Maintain satellite acquisition cadence for high risk districts.</li>
        </ul>
      </section>
      )}
    </div>
  );
};

export default Dashboard;
