import { useEffect, useState } from 'react';
import type { DeprotectInspectionSummary, DeprotectMapOptions, OpenMapSummary } from '../../electron/shared-types';

interface Props {
  open: boolean;
  onClose: () => void;
  onMapUpdated?: (map: OpenMapSummary) => void;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

export default function DeprotectDialog({ open, onClose, onMapUpdated, log }: Props) {
  const [inspection, setInspection] = useState<DeprotectInspectionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [spoofing, setSpoofing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deprotect options
  const [repairClasses, setRepairClasses] = useState(true);
  const [scrapeScriptPaths, setScrapeScriptPaths] = useState(true);
  const [heuristicRename, setHeuristicRename] = useState(true);
  const [repairBitmaps, setRepairBitmaps] = useState(true);
  const [repairModelStrips, setRepairModelStrips] = useState(true);

  // CRC32 Spoofer state
  const [targetCrcHex, setTargetCrcHex] = useState('');
  const [lastResultLog, setLastResultLog] = useState<string[]>([]);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const loadInspection = async () => {
    if (!window.opence.inspectDeprotect) return;
    setLoading(true);
    setError(null);
    try {
      const res = await window.opence.inspectDeprotect();
      if (res.ok) {
        setInspection(res.report);
        if (!targetCrcHex) {
          setTargetCrcHex(`0x${(res.report.headerCrc32 >>> 0).toString(16).toUpperCase().padStart(8, '0')}`);
        }
      } else {
        setError(res.message);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      void loadInspection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const handleRunDeprotect = async () => {
    if (!window.opence.deprotectMap) return;
    setRunning(true);
    setError(null);
    setStatusBanner(null);
    try {
      const opts: DeprotectMapOptions = {
        repairClasses,
        scrapeScriptPaths,
        heuristicRename,
        repairBitmaps,
        repairModelStrips,
      };
      const res = await window.opence.deprotectMap(opts);
      if (res.ok) {
        setLastResultLog(res.log);
        setStatusBanner(
          `Repaired ${res.classesRepaired} class(es), recovered ${res.scriptPathsRecovered} script path(s), renamed ${res.heuristicPathsRenamed} protected path(s), fixed ${res.bitmapsRepaired} bitmap(s) and ${res.modelPartsRepaired} model part(s) (${res.stripIndicesClamped} strip indices).`,
        );
        onMapUpdated?.(res.map);
        log?.('info', `Deprotect & Integrity repair completed (${res.log.length} action(s)).`);
        await loadInspection();
      } else {
        setError(res.message);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const handleSpoofCrc = async () => {
    if (!window.opence.spoofMapCrc32) return;
    const cleaned = targetCrcHex.trim().replace(/^0x/i, '');
    if (!/^[0-9a-fA-F]{1,8}$/.test(cleaned)) {
      setError('Target CRC32 must be a 1-8 digit hexadecimal value (e.g. 0xDEADBEEF).');
      return;
    }
    const target = parseInt(cleaned, 16) >>> 0;
    setSpoofing(true);
    setError(null);
    setStatusBanner(null);
    try {
      const res = await window.opence.spoofMapCrc32(target);
      if (res.ok) {
        const crcStr = `0x${(res.crc32 >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
        const compStr = `0x${(res.compensationWord >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
        setStatusBanner(`Map CRC32 algebraically spoofed to ${crcStr} (tagFileChecksums = ${compStr}).`);
        onMapUpdated?.(res.map);
        log?.('info', `Spoofed map CRC32 to ${crcStr} (compensation word ${compStr}).`);
        await loadInspection();
      } else {
        setError(res.message);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSpoofing(false);
    }
  };

  return (
    <div
      data-testid="deprotect-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
      }}
    >
      <div
        style={{
          width: 680,
          maxHeight: '86vh',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 12px 36px rgba(0,0,0,0.65)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 16px',
            background: 'var(--bg-panel-header)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
              Deprotect, Asset Integrity &amp; CRC32 Suite
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
              3-Stage Map Deprotector (Classes + HaloScript + Heuristics), Asset Truncation Repairs &amp; GF(2) CRC32 Spoofer
            </div>
          </div>
          <button
            data-testid="deprotect-close-btn"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              borderRadius: 3,
              padding: '4px 10px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && (
            <div
              data-testid="deprotect-error"
              style={{
                padding: '8px 12px',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                borderRadius: 4,
                color: '#f87171',
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}

          {statusBanner && (
            <div
              data-testid="deprotect-status"
              style={{
                padding: '8px 12px',
                background: 'rgba(34, 197, 94, 0.15)',
                border: '1px solid rgba(34, 197, 94, 0.4)',
                borderRadius: 4,
                color: '#4ade80',
                fontSize: 12,
              }}
            >
              {statusBanner}
            </div>
          )}

          {/* Diagnostic Summary */}
          <div
            style={{
              padding: 12,
              background: 'rgba(0, 0, 0, 0.25)',
              border: '1px solid var(--border)',
              borderRadius: 4,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              Map Protection &amp; Asset Integrity Scan
            </div>
            {loading || !inspection ? (
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Scanning open map...</div>
            ) : (
              <>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 8,
                    fontSize: 11.5,
                    fontFamily: 'var(--mono-font)',
                  }}
                >
                  <div>
                    <span style={{ color: 'var(--text-dim)' }}>Total Tags: </span>
                    <strong style={{ color: 'var(--text-primary)' }}>{inspection.totalTags}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-dim)' }}>Obfuscated Classes: </span>
                    <strong style={{ color: inspection.protectedClassCount > 0 ? '#fbbf24' : '#4ade80' }}>
                      {inspection.protectedClassCount}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-dim)' }}>Protected Paths: </span>
                    <strong style={{ color: inspection.protectedNameCount > 0 ? '#fbbf24' : '#4ade80' }}>
                      {inspection.protectedNameCount}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-dim)' }}>Script Recoverable: </span>
                    <strong style={{ color: 'var(--accent-cyan)' }}>{inspection.scriptRecoverableNamesCount}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-dim)' }}>Truncated Bitmaps: </span>
                    <strong style={{ color: inspection.truncatedBitmapCount > 0 ? '#f87171' : '#4ade80' }}>
                      {inspection.truncatedBitmapCount}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-dim)' }}>Bad Model Strips: </span>
                    <strong style={{ color: inspection.corruptedModelPartCount > 0 ? '#f87171' : '#4ade80' }}>
                      {inspection.corruptedModelPartCount}
                    </strong>
                  </div>
                </div>
                {inspection.details.length > 0 && (
                  <ul style={{ margin: '8px 0 0 0', paddingLeft: 18, fontSize: 11, color: 'var(--text-secondary)' }}>
                    {inspection.details.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {/* 3-Stage Deprotector & Asset Repairs */}
          <div
            style={{
              padding: 12,
              background: 'rgba(0, 0, 0, 0.2)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
              3-Stage Deprotector &amp; Asset Integrity Repairs
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={repairClasses} onChange={(e) => setRepairClasses(e.target.checked)} />
              <span>
                <strong>Stage 1 — Root-to-Leaf Tag Class Repair:</strong> Walk from <code>scnr</code> / <code>matg</code> &amp; inspect polymorphic <code>obje</code> / <code>shdr</code> / <code>bitm</code> discriminators
              </span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={scrapeScriptPaths} onChange={(e) => setScrapeScriptPaths(e.target.checked)} />
              <span>
                <strong>Stage 2 — HaloScript Syntax Scraping:</strong> Recover original tag paths from compiled <code>script_syntax_data</code> nodes
              </span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={heuristicRename} onChange={(e) => setHeuristicRename(e.target.checked)} />
              <span>
                <strong>Stage 3 — Heuristic Priority Renaming:</strong> Rename <code>&lt;protected&gt;</code>, <code>&lt;zteam&gt;</code>, and duplicate tag paths into clean folders
              </span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={repairBitmaps} onChange={(e) => setRepairBitmaps(e.target.checked)} />
              <span>
                <strong>Stage 4a — Truncated Bitmap Mipmap Clamping:</strong> Clamp spoofed/truncated mipmap counts &amp; dimensions so OpenCE can draw all bitmaps
              </span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={repairModelStrips} onChange={(e) => setRepairModelStrips(e.target.checked)} />
              <span>
                <strong>Stage 4b — Corrupted Model Part Strip Clamping:</strong> Clamp out-of-range triangle strip indices to valid vertex indices
              </span>
            </label>

            <div style={{ marginTop: 4, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                data-testid="deprotect-run-btn"
                onClick={() => void handleRunDeprotect()}
                disabled={running}
                style={{
                  background: '#0284c7',
                  border: '1px solid #38bdf8',
                  color: '#fff',
                  borderRadius: 4,
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: running ? 'wait' : 'pointer',
                }}
              >
                {running ? 'Running Repairs...' : 'Run Deprotector & Asset Repairs'}
              </button>
            </div>
          </div>

          {/* Algebraic GF(2) CRC32 Spoofer */}
          <div
            style={{
              padding: 12,
              background: 'rgba(0, 0, 0, 0.2)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
              Algebraic GF(2) CRC32 Checksum Spoofer
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              Solves a 32×32 GF(2) linear system over <code>tag_index_header.tagFileChecksums</code> (<code>+0x08</code>) so the map&apos;s actual CRC32 checksum matches any target CRC32 (e.g. stock Blood Gulch <code>0x7B309554</code> for server compatibility).
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--text-secondary)' }}>
                Current CRC32:{' '}
                <strong style={{ color: 'var(--accent-cyan)' }}>
                  {inspection ? `0x${(inspection.headerCrc32 >>> 0).toString(16).toUpperCase().padStart(8, '0')}` : '—'}
                </strong>
              </div>
              <input
                data-testid="deprotect-crc-input"
                type="text"
                value={targetCrcHex}
                onChange={(e) => setTargetCrcHex(e.target.value)}
                placeholder="0xDEADBEEF"
                style={{
                  flex: 1,
                  background: 'var(--bg-input, #1e1e1e)',
                  border: '1px solid var(--border)',
                  borderRadius: 3,
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--mono-font)',
                  fontSize: 12,
                  padding: '5px 8px',
                }}
              />
              <button
                data-testid="deprotect-spoof-crc-btn"
                onClick={() => void handleSpoofCrc()}
                disabled={spoofing}
                style={{
                  background: '#4f46e5',
                  border: '1px solid #818cf8',
                  color: '#fff',
                  borderRadius: 4,
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: spoofing ? 'wait' : 'pointer',
                }}
              >
                {spoofing ? 'Spoofing...' : 'Spoof CRC32'}
              </button>
            </div>
          </div>

          {lastResultLog.length > 0 && (
            <div
              style={{
                padding: 10,
                background: 'rgba(0, 0, 0, 0.35)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                maxHeight: 150,
                overflowY: 'auto',
                fontFamily: 'var(--mono-font)',
                fontSize: 11,
                color: 'var(--text-secondary)',
              }}
            >
              {lastResultLog.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
