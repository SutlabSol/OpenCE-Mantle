import { useEffect, useMemo, useState } from 'react';
import type {
  DifferenceStatus,
  MapComparisonReport,
  MapDifferenceRow,
} from '../../../core/src/map/map-compare';

interface Props {
  onClose: () => void;
  onSelectLeftTag?: (tagIndex: number) => void;
}

const STATUS_BADGE_COLORS: Record<DifferenceStatus, { bg: string; border: string; text: string; label: string }> = {
  changed: {
    bg: 'rgba(251, 191, 36, 0.16)',
    border: '1px solid rgba(251, 191, 36, 0.45)',
    text: '#fbbf24',
    label: 'CHANGED',
  },
  added: {
    bg: 'rgba(34, 197, 94, 0.16)',
    border: '1px solid rgba(34, 197, 94, 0.45)',
    text: '#4ade80',
    label: 'ADDED (RIGHT)',
  },
  removed: {
    bg: 'rgba(239, 68, 68, 0.16)',
    border: '1px solid rgba(239, 68, 68, 0.45)',
    text: '#f87171',
    label: 'REMOVED (LEFT ONLY)',
  },
  unknown: {
    bg: 'rgba(148, 163, 184, 0.12)',
    border: '1px solid rgba(148, 163, 184, 0.3)',
    text: '#94a3b8',
    label: 'DUPLICATE / OTHER',
  },
};

export default function MapCompareDialog({ onClose, onSelectLeftTag }: Props) {
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [leftFileName, setLeftFileName] = useState<string>('');
  const [rightFileName, setRightFileName] = useState<string>('');
  const [report, setReport] = useState<MapComparisonReport | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | DifferenceStatus>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRow, setSelectedRow] = useState<MapDifferenceRow | null>(null);

  const runPickAndCompare = async () => {
    if (!window.opence.compareWithAnotherMap) {
      setErrorMessage('Map comparison API is not available.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    const res = await window.opence.compareWithAnotherMap();
    setLoading(false);
    if (!res) {
      if (!report) onClose();
      return;
    }
    if (!res.ok) {
      if (res.cancelled && !report) {
        onClose();
        return;
      }
      if (!res.cancelled) setErrorMessage(res.message);
      return;
    }
    setLeftFileName(res.leftFileName);
    setRightFileName(res.rightFileName);
    setReport(res.report);
    setSelectedRow(res.report.rows[0] ?? null);
  };

  useEffect(() => {
    void runPickAndCompare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allCategories = useMemo(() => {
    if (!report) return [];
    const set = new Set<string>();
    for (const r of report.rows) set.add(r.category);
    return Array.from(set).sort();
  }, [report]);

  const filteredRows = useMemo(() => {
    if (!report) return [];
    const q = searchQuery.trim().toLowerCase();
    return report.rows.filter((r) => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (categoryFilter !== 'ALL' && r.category !== categoryFilter) return false;
      if (
        q &&
        !r.subject.toLowerCase().includes(q) &&
        !r.property.toLowerCase().includes(q) &&
        !r.before.toLowerCase().includes(q) &&
        !r.after.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [report, statusFilter, categoryFilter, searchQuery]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.68)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 120,
      }}
    >
      <div
        data-testid="map-compare-dialog"
        style={{
          width: '92vw',
          maxWidth: 1120,
          height: '84vh',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          boxShadow: '0 14px 48px rgba(0,0,0,0.65)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            background: 'var(--bg-panel-header)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--accent-cyan)' }}>
              Semantic Map Diff &amp; Tag Comparison
            </span>
            {report && (
              <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontFamily: 'var(--mono-font)' }}>
                {leftFileName || report.leftScenarioName} (Open Map) vs. {rightFileName || report.rightScenarioName}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              data-testid="map-compare-pick-another-btn"
              onClick={() => void runPickAndCompare()}
              disabled={loading}
              style={{
                padding: '4px 10px',
                fontSize: 11.5,
                fontWeight: 600,
                background: 'rgba(56, 189, 248, 0.16)',
                border: '1px solid rgba(56, 189, 248, 0.45)',
                color: '#38bdf8',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Compare Another .map...
            </button>
            <button
              data-testid="map-compare-close-btn"
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-dim)',
                fontSize: 18,
                cursor: 'pointer',
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        </div>

        {loading && (
          <div style={{ padding: 36, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
            Comparing map headers, tag tables, reflexive blocks, and decoded fields...
          </div>
        )}

        {!loading && errorMessage && (
          <div style={{ padding: 24 }}>
            <div style={{ color: '#f87171', fontWeight: 600, marginBottom: 8 }}>Comparison Error</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 12.5 }}>{errorMessage}</div>
          </div>
        )}

        {!loading && report && (
          <>
            {/* Summary Bar */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                gap: 8,
                padding: '10px 16px',
                background: 'rgba(15, 23, 42, 0.6)',
                borderBottom: '1px solid var(--border)',
                fontSize: 11.5,
              }}
            >
              <div style={{ padding: '6px 10px', background: 'rgba(0,0,0,0.25)', borderRadius: 4, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>CHANGED TAGS</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#fbbf24' }}>{report.changedTags}</div>
              </div>
              <div style={{ padding: '6px 10px', background: 'rgba(0,0,0,0.25)', borderRadius: 4, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>ADDED IN RIGHT MAP</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#4ade80' }}>{report.addedTags}</div>
              </div>
              <div style={{ padding: '6px 10px', background: 'rgba(0,0,0,0.25)', borderRadius: 4, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>ONLY IN OPEN MAP</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#f87171' }}>{report.removedTags}</div>
              </div>
              <div style={{ padding: '6px 10px', background: 'rgba(0,0,0,0.25)', borderRadius: 4, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>IDENTICAL TAGS</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#94a3b8' }}>{report.unchangedTags}</div>
              </div>
              <div style={{ padding: '6px 10px', background: 'rgba(0,0,0,0.25)', borderRadius: 4, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>TAG COUNT DELTA</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8', fontFamily: 'var(--mono-font)' }}>
                  {report.leftTagCount} → {report.rightTagCount}
                </div>
              </div>
            </div>

            {/* Filter Toolbar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 16px',
                borderBottom: '1px solid var(--border)',
                background: 'var(--bg-panel-header)',
              }}
            >
              <select
                data-testid="map-compare-status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'ALL' | DifferenceStatus)}
                style={{
                  padding: '5px 8px',
                  background: '#141820',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  borderRadius: 4,
                  fontSize: 11.5,
                }}
              >
                <option value="ALL">All Differences ({report.rows.length})</option>
                <option value="changed">Changed Fields ({report.rows.filter((r) => r.status === 'changed').length})</option>
                <option value="added">Added in Right ({report.rows.filter((r) => r.status === 'added').length})</option>
                <option value="removed">Only in Open Map ({report.rows.filter((r) => r.status === 'removed').length})</option>
              </select>

              <select
                data-testid="map-compare-group-filter"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                style={{
                  padding: '5px 8px',
                  background: '#141820',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  borderRadius: 4,
                  fontSize: 11.5,
                }}
              >
                <option value="ALL">All Categories ({allCategories.length})</option>
                {allCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <input
                data-testid="map-compare-search-input"
                type="text"
                placeholder="Filter by tag path, field name, or value..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  flex: 1,
                  padding: '5px 10px',
                  background: '#141820',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  borderRadius: 4,
                  fontSize: 11.5,
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                Showing {filteredRows.length} of {report.rows.length}
              </span>
            </div>

            {/* Split List + Inspector */}
            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
              <div
                style={{
                  flex: 1.35,
                  overflowY: 'auto',
                  borderRight: '1px solid var(--border)',
                }}
              >
                {filteredRows.map((row) => {
                  const badge = STATUS_BADGE_COLORS[row.status];
                  const isSelected = selectedRow?.id === row.id;
                  return (
                    <div
                      key={row.id}
                      onClick={() => setSelectedRow(row)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '6px 12px',
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        background: isSelected ? 'var(--selection-bg)' : 'transparent',
                        cursor: 'pointer',
                        fontSize: 11.5,
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontFamily: 'var(--mono-font)',
                            color: 'var(--text-primary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {row.subject}
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>
                          {row.category} • <strong>{row.property}</strong>: {row.before} → {row.after}
                        </div>
                      </div>
                      <span
                        style={{
                          padding: '2px 7px',
                          fontSize: 9.5,
                          fontWeight: 700,
                          borderRadius: 3,
                          background: badge.bg,
                          border: badge.border,
                          color: badge.text,
                          flexShrink: 0,
                        }}
                      >
                        {badge.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Right Inspector */}
              <div style={{ flex: 1, padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {selectedRow ? (
                  <>
                    <div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>{selectedRow.category.toUpperCase()}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--mono-font)', color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                        {selectedRow.subject}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--accent-cyan)', marginTop: 4 }}>
                        Property: <strong>{selectedRow.property}</strong>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div style={{ padding: 10, background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 11.5 }}>
                        <div style={{ fontWeight: 700, color: '#38bdf8', marginBottom: 4 }}>Open Map (Before)</div>
                        <div style={{ fontFamily: 'var(--mono-font)', wordBreak: 'break-all' }}>{selectedRow.before}</div>
                      </div>
                      <div style={{ padding: 10, background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 11.5 }}>
                        <div style={{ fontWeight: 700, color: '#c084fc', marginBottom: 4 }}>Compared Map (After)</div>
                        <div style={{ fontFamily: 'var(--mono-font)', wordBreak: 'break-all' }}>{selectedRow.after}</div>
                      </div>
                    </div>

                    {selectedRow.detail && (
                      <div style={{ padding: 10, background: 'rgba(251, 191, 36, 0.08)', border: '1px solid rgba(251, 191, 36, 0.35)', borderRadius: 4, fontSize: 11.5 }}>
                        {selectedRow.detail}
                      </div>
                    )}

                    {typeof selectedRow.leftTagIndex === 'number' && onSelectLeftTag && (
                      <button
                        data-testid="map-compare-jump-left-tag-btn"
                        onClick={() => {
                          onSelectLeftTag(selectedRow.leftTagIndex!);
                          onClose();
                        }}
                        style={{
                          padding: '7px 12px',
                          fontSize: 12,
                          fontWeight: 600,
                          background: 'rgba(56, 189, 248, 0.2)',
                          border: '1px solid #38bdf8',
                          color: '#38bdf8',
                          borderRadius: 4,
                          cursor: 'pointer',
                          alignSelf: 'flex-start',
                        }}
                      >
                        Inspect Tag in Open Map (#{selectedRow.leftTagIndex})
                      </button>
                    )}
                  </>
                ) : (
                  <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>Select a difference row from the list to inspect its details.</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
