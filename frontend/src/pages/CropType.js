import React, { useEffect, useMemo, useState } from 'react';

import {
  API_BASE,
  cropTypeApply,
  cropTypeLatestRun,
  cropTypeRecompute,
  cropTypeRuns,
} from '../api';

import '../styles/common.css';

const parseNumberSafe = (value, fallback) => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const isProbablyAuthError = (message) => {
  const m = String(message || '').toLowerCase();
  return (
    m.includes('not authenticated') ||
    m.includes('not authorized') ||
    m.includes('unauthorized') ||
    m.includes('forbidden') ||
    m.includes('credentials')
  );
};

const copyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

const CropType = () => {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [latest, setLatest] = useState(null);
  const [runs, setRuns] = useState([]);
  const [selectedPredCsv, setSelectedPredCsv] = useState('');

  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Optional: EE project is only needed if you want to bill a specific project.
  const [eeProject, setEeProject] = useState('');
  const [modelDir, setModelDir] = useState('ml/models_radiant_full');
  const [start, setStart] = useState('2024-01-01');
  const [end, setEnd] = useState('2024-12-31');
  const [threshold, setThreshold] = useState('0.60');
  const [overwrite, setOverwrite] = useState(false);

  const thresholdValue = useMemo(() => parseNumberSafe(threshold, 0.6), [threshold]);
  const canRun = useMemo(() => {
    if (!start || !end) return false;
    if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) return false;
    if (Date.parse(start) > Date.parse(end)) return false;
    return thresholdValue >= 0 && thresholdValue <= 1;
  }, [end, start, thresholdValue]);

  const latestPredCsv = latest?.predictions_csv || '';

  async function refresh() {
    const [latestResp, runsResp] = await Promise.all([
      cropTypeLatestRun(),
      cropTypeRuns(30),
    ]);

    const latestRun = latestResp?.run || null;
    setLatest(latestRun);
    setRuns(Array.isArray(runsResp?.runs) ? runsResp.runs : []);

    // Auto-select latest predictions CSV if none selected.
    if (!selectedPredCsv && latestRun?.predictions_csv) {
      setSelectedPredCsv(latestRun.predictions_csv);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        setNotice(null);
        await refresh();
      } catch (e) {
        const msg = e?.message || 'Failed to load crop type tools';
        setError(msg);
        if (isProbablyAuthError(msg)) {
          setNotice('You may need to login first (token missing/expired).');
        }
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onRecompute() {
    if (!canRun) {
      setError('Fix inputs first: valid dates and threshold between 0 and 1.');
      return;
    }

    try {
      setBusy(true);
      setError(null);
      setNotice('Running crop-type recompute (this can take several minutes)…');

      const payload = {
        threshold: thresholdValue,
        overwrite,
        start,
        end,
        model_dir: modelDir,
      };
      if (eeProject && eeProject.trim()) {
        payload.ee_project = eeProject.trim();
      }

      const resp = await cropTypeRecompute(payload);
      await refresh();

      setNotice(
        `Done. Applied ${resp.applied_rows} farms. Crop types: ${resp.crop_type_filled_before} → ${resp.crop_type_filled_after}.`
      );
    } catch (e) {
      const msg = e?.message || 'Recompute failed';
      setError(msg);
      if (isProbablyAuthError(msg)) {
        setNotice('Login is required for this action.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function onApply(predictionsCsv) {
    const csv = predictionsCsv || selectedPredCsv;
    if (!csv) {
      setError('Select a run (predictions CSV) first.');
      return;
    }

    try {
      setBusy(true);
      setError(null);
      setNotice('Applying predictions to farms.crop_type…');

      const resp = await cropTypeApply({
        predictions_csv: csv,
        threshold: thresholdValue,
        overwrite,
      });

      setNotice(
        `Applied ${resp.applied_rows} farms. Crop types: ${resp.crop_type_filled_before} → ${resp.crop_type_filled_after}.`
      );
    } catch (e) {
      const msg = e?.message || 'Apply failed';
      setError(msg);
      if (isProbablyAuthError(msg)) {
        setNotice('Login is required for this action.');
      }
    } finally {
      setBusy(false);
    }
  }

  const latestSummary = useMemo(() => {
    if (!latest) return null;
    return {
      run: latest.run_dir,
      created: latest.created_utc || '-',
      predictions: latest.predictions_csv || '-',
      farmsGeojson: latest.farms_geojson || '-',
      features: latest.farm_features_csv || '-',
    };
  }, [latest]);

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading-state">Loading crop-type tools…</div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Crop Type</h1>
        <p>
          Predict crop types from Sentinel-2 time-series and write results to <strong>farms.crop_type</strong>.
        </p>
        <p style={{ marginTop: 8, color: 'var(--gray-600)' }}>
          Backend: <strong>{API_BASE}</strong>
        </p>
      </div>

      {notice ? (
        <div className="card" style={{ borderLeft: '4px solid var(--primary-500)', marginBottom: 12 }}>
          <strong>Status:</strong> {notice}
        </div>
      ) : null}

      {error ? (
        <div className="error-state" style={{ marginBottom: 12 }}>
          Error: {error}
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="card-title" style={{ margin: 0 }}>Quick start</h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline" onClick={() => (window.location.href = '/')}>
              Dashboard
            </button>
            <button type="button" className="btn btn-outline" onClick={() => (window.location.href = '/farms')}>
              Farms
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={async () => {
                try {
                  setError(null);
                  setNotice('Refreshing runs…');
                  await refresh();
                  setNotice('Runs refreshed.');
                } catch (e) {
                  setError(e?.message || 'Failed to refresh');
                }
              }}
            >
              Refresh
            </button>
          </div>
        </div>
        <div className="card-body">
          <ul style={{ marginTop: 0 }}>
            <li><strong>Recommended:</strong> click “Recompute” to run the full pipeline (EE → predict → apply).</li>
            <li><strong>Fast:</strong> click “Apply” if you already have a run and just want to re-apply with a different threshold.</li>
            <li>
              If you get an Earth Engine auth error, verify the Docker mount: <strong>data/earthengine</strong>.
            </li>
          </ul>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="card-title" style={{ margin: 0 }}>Recompute (full pipeline)</h3>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className="btn btn-outline"
              disabled={busy}
              onClick={() => setAdvancedOpen((v) => !v)}
            >
              {advancedOpen ? 'Hide advanced' : 'Show advanced'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !canRun}
              onClick={onRecompute}
            >
              {busy ? 'Running…' : 'Recompute crop types'}
            </button>
          </div>
        </div>

        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label>
              Start date
              <input
                className="input"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                placeholder="YYYY-MM-DD"
              />
            </label>

            <label>
              End date
              <input
                className="input"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                placeholder="YYYY-MM-DD"
              />
            </label>

            <label>
              Threshold (0–1)
              <input
                className="input"
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
              />
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <input
              id="overwrite"
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            <label htmlFor="overwrite" style={{ margin: 0, fontWeight: 600 }}>
              Overwrite existing crop_type
            </label>
            <span style={{ color: 'var(--gray-600)' }}>
              (If off, only fills missing values)
            </span>
          </div>

          {advancedOpen ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              <label>
                Earth Engine project (optional)
                <input
                  className="input"
                  value={eeProject}
                  onChange={(e) => setEeProject(e.target.value)}
                  placeholder="principal-rhino-…"
                />
              </label>

              <label>
                Model dir
                <input
                  className="input"
                  value={modelDir}
                  onChange={(e) => setModelDir(e.target.value)}
                  placeholder="ml/models_radiant_full"
                />
              </label>
            </div>
          ) : null}

          {!canRun ? (
            <div className="empty-state-text" style={{ marginTop: 12 }}>
              Tip: start must be before end, and threshold must be between 0 and 1.
            </div>
          ) : null}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3 className="card-title" style={{ margin: 0 }}>Latest run</h3>
        </div>
        <div className="card-body">
          {latestSummary ? (
            <div style={{ lineHeight: 1.8 }}>
              <div><strong>Run:</strong> {latestSummary.run}</div>
              <div><strong>Created:</strong> {latestSummary.created}</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div><strong>Predictions:</strong> {latestSummary.predictions}</div>
                {latestPredCsv ? (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={async () => {
                      const ok = await copyToClipboard(latestPredCsv);
                      setNotice(ok ? 'Copied predictions path.' : 'Copy failed.');
                    }}
                  >
                    Copy path
                  </button>
                ) : null}
              </div>
              <div><strong>Farms GeoJSON:</strong> {latestSummary.farmsGeojson}</div>
              <div><strong>Features CSV:</strong> {latestSummary.features}</div>
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy || !latestPredCsv}
                  onClick={() => onApply(latestPredCsv)}
                >
                  Apply latest run (fast)
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state-text">No runs yet. Click “Recompute crop types” above.</div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title" style={{ margin: 0 }}>Runs (apply / inspect)</h3>
        </div>

        <div className="card-body">
          <label>
            Select predictions CSV
            <select
              className="input"
              value={selectedPredCsv}
              onChange={(e) => setSelectedPredCsv(e.target.value)}
            >
              <option value="">Select a run…</option>
              {runs
                .filter((r) => r?.predictions_csv)
                .map((r) => (
                  <option key={r.run_dir} value={r.predictions_csv}>
                    {r.run_dir}
                  </option>
                ))}
            </select>
          </label>

          <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !selectedPredCsv}
              onClick={() => onApply(selectedPredCsv)}
            >
              {busy ? 'Working…' : 'Apply selected run'}
            </button>
            <button
              type="button"
              className="btn btn-outline"
              disabled={!selectedPredCsv}
              onClick={async () => {
                const ok = await copyToClipboard(selectedPredCsv);
                setNotice(ok ? 'Copied selected path.' : 'Copy failed.');
              }}
            >
              Copy selected path
            </button>
          </div>

          <div className="data-table-container" style={{ marginTop: 14 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Created</th>
                  <th>Predictions CSV</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {runs.length === 0 ? (
                  <tr>
                    <td colSpan={4}>
                      <div className="empty-state">
                        <div className="empty-state-text">No runs found.</div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  runs.map((r) => (
                    <tr key={r.run_dir}>
                      <td style={{ fontWeight: 600 }}>{r.run_dir}</td>
                      <td>{r.created_utc || '-'}</td>
                      <td style={{ maxWidth: 420, wordBreak: 'break-all' }}>{r.predictions_csv || '-'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={!r.predictions_csv}
                            onClick={() => {
                              if (r.predictions_csv) setSelectedPredCsv(r.predictions_csv);
                            }}
                          >
                            Select
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline"
                            disabled={!r.predictions_csv}
                            onClick={async () => {
                              if (!r.predictions_csv) return;
                              const ok = await copyToClipboard(r.predictions_csv);
                              setNotice(ok ? 'Copied.' : 'Copy failed.');
                            }}
                          >
                            Copy
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={busy || !r.predictions_csv}
                            onClick={() => onApply(r.predictions_csv)}
                          >
                            Apply
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CropType;
