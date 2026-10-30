import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type {
  StringsCsvImportPreview,
  TagEntrySummary,
  UnicodeStringListResult,
} from '../../electron/shared-types';
import {
  HALO_HUD_MARKUP_TOKENS,
  tokenizeHaloHudStringMarkup,
} from '../../../core/src/map/baboon-browser-utils';

interface Props {
  tag: TagEntrySummary;
  onDirtyChange?: (dirty: boolean) => void;
}

export default function UnicodeStringEditorPanel({ tag, onDirtyChange }: Props) {
  const [data, setData] = useState<UnicodeStringListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [rowStatus, setRowStatus] = useState<Record<number, { ok: boolean; message: string }>>({});
  const [csvPreview, setCsvPreview] = useState<StringsCsvImportPreview | null>(null);
  const [csvImportMode, setCsvImportMode] = useState<'amend' | 'replace'>('amend');
  const [rawCsvDraft, setRawCsvDraft] = useState<string>('');
  const [focusedRowIndex, setFocusedRowIndex] = useState<number | null>(null);
  const [bannerStatus, setBannerStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEdits({});
    setRowStatus({});

    void window.opence.getUnicodeStrings(tag.index).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok) {
        setData(res.result);
      } else {
        setError(res.message);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [tag.index]);

  const hasDirty = useMemo(() => Object.keys(edits).length > 0, [edits]);

  useEffect(() => {
    onDirtyChange?.(hasDirty);
  }, [hasDirty, onDirtyChange]);

  const filteredStrings = useMemo(() => {
    if (!data?.strings) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.strings;
    return data.strings.filter((s) =>
      s.index.toString().includes(q) ||
      s.text.toLowerCase().includes(q) ||
      (edits[s.index] !== undefined && edits[s.index].toLowerCase().includes(q))
    );
  }, [data, search, edits]);

  const handleTextChange = (index: number, newText: string) => {
    const original = data?.strings.find((s) => s.index === index)?.text ?? '';
    setEdits((prev) => {
      if (newText === original) {
        const next = { ...prev };
        delete next[index];
        return next;
      }
      return { ...prev, [index]: newText };
    });
    setRowStatus((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const handleSaveString = async (index: number) => {
    const newText = edits[index];
    if (newText === undefined) return;
    setSavingIndex(index);

    const res = await window.opence.setUnicodeString(tag.index, index, newText);
    setSavingIndex(null);

    if (res.ok) {
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          strings: prev.strings.map((s) => (s.index === index ? { ...s, text: res.newText } : s)),
        };
      });
      setEdits((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
      setRowStatus((prev) => ({
        ...prev,
        [index]: { ok: true, message: 'Saved' },
      }));
    } else {
      setRowStatus((prev) => ({
        ...prev,
        [index]: { ok: false, message: res.message },
      }));
    }
  };

  const handleResetString = (index: number) => {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    setRowStatus((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const handleExportCsv = async () => {
    if (typeof window.opence.exportStringsCsv !== 'function') return;
    const res = await window.opence.exportStringsCsv(tag.index);
    if (!res.ok) {
      setBannerStatus(`CSV export failed: ${res.message}`);
      return;
    }
    const blob = new Blob([res.csvText], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tag.path.split('\\').pop() || 'strings'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setBannerStatus(`Exported ${res.rowCount} Unicode strings to CSV.`);
  };

  const handlePickCsvForImport = (mode: 'amend' | 'replace') => {
    setCsvImportMode(mode);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || typeof window.opence.previewStringsCsvImport !== 'function') return;
      const text = await file.text();
      setRawCsvDraft(text);
      const res = await window.opence.previewStringsCsvImport(tag.index, text, mode);
      if (res.ok) {
        setCsvPreview(res.preview);
      } else {
        setBannerStatus(`CSV preview failed: ${res.message}`);
      }
    };
    input.click();
  };

  const handleApplyCsvImport = async () => {
    if (!csvPreview || typeof window.opence.saveUnicodeStringTable !== 'function') return;
    const res = await window.opence.saveUnicodeStringTable(tag.index, csvPreview.mergedStrings);
    if (res.ok) {
      const refreshed = await window.opence.getUnicodeStrings(tag.index);
      if (refreshed.ok) setData(refreshed.result);
      setBannerStatus(
        `Applied CSV (${csvPreview.mode.toUpperCase()}): ${csvPreview.updatedCount} updated, ${csvPreview.appendedCount} appended (${res.entryCount} total strings).`,
      );
      setCsvPreview(null);
    } else {
      setBannerStatus(`Failed to apply CSV import: ${res.message}`);
    }
  };

  const handleInsertHudToken = (token: string) => {
    const targetIdx = focusedRowIndex ?? filteredStrings[0]?.index;
    if (targetIdx === undefined) return;
    const currentText = (edits[targetIdx] !== undefined ? edits[targetIdx] : data?.strings.find((s) => s.index === targetIdx)?.text) ?? '';
    handleTextChange(targetIdx, `${currentText}${token}`);
  };

  const tableHeaderStyle: CSSProperties = {
    padding: '6px 8px',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    color: 'var(--text-dim)',
    borderBottom: '1px solid var(--border)',
    textAlign: 'left',
    background: 'var(--bg-panel-header)',
  };

  return (
    <div data-testid="unicode-string-editor-panel" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          data-testid="unicode-string-search"
          type="text"
          placeholder="Filter strings by text or index..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            minWidth: 160,
            background: 'var(--bg-input, #1e1e1e)',
            border: '1px solid var(--border)',
            borderRadius: 3,
            color: 'var(--text-primary)',
            fontSize: 12,
            padding: '4px 8px',
            fontFamily: 'var(--mono-font)',
          }}
        />
        <button
          type="button"
          data-testid="unicode-export-csv-btn"
          onClick={() => void handleExportCsv()}
          style={{
            padding: '4px 8px',
            fontSize: 11,
            fontWeight: 600,
            background: 'rgba(56, 189, 248, 0.14)',
            border: '1px solid rgba(56, 189, 248, 0.45)',
            color: '#38bdf8',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          📤 Export CSV
        </button>
        <button
          type="button"
          data-testid="unicode-import-csv-amend-btn"
          onClick={() => handlePickCsvForImport('amend')}
          title="Amend strings by index from CSV without deleting unmentioned indices"
          style={{
            padding: '4px 8px',
            fontSize: 11,
            fontWeight: 600,
            background: 'rgba(34, 197, 94, 0.14)',
            border: '1px solid rgba(34, 197, 94, 0.45)',
            color: '#4ade80',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          📥 CSV Amend...
        </button>
        <button
          type="button"
          data-testid="unicode-import-csv-replace-btn"
          onClick={() => handlePickCsvForImport('replace')}
          title="Replace entire string table with rows from CSV"
          style={{
            padding: '4px 8px',
            fontSize: 11,
            fontWeight: 600,
            background: 'rgba(245, 158, 11, 0.14)',
            border: '1px solid rgba(245, 158, 11, 0.45)',
            color: '#fbbf24',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          🔄 CSV Replace...
        </button>
        {data && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
            {filteredStrings.length} of {data.strings.length} string(s)
          </span>
        )}
      </div>

      {/* Token Bar for %button / HUD Markup Autocomplete */}
      <div
        style={{
          padding: '5px 12px',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(0,0,0,0.2)',
          display: 'flex',
          gap: 5,
          alignItems: 'center',
          overflowX: 'auto',
          fontSize: 10.5,
        }}
      >
        <span style={{ color: 'var(--text-dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>Insert HUD Token:</span>
        {Object.entries(HALO_HUD_MARKUP_TOKENS)
          .slice(0, 12)
          .map(([tokenKey, tokenDesc]) => (
            <button
              key={tokenKey}
              type="button"
              title={tokenDesc}
              onClick={() => handleInsertHudToken(tokenKey)}
              style={{
                padding: '2px 6px',
                fontSize: 10,
                fontFamily: 'var(--mono-font)',
                background: 'rgba(56, 189, 248, 0.12)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                color: '#38bdf8',
                borderRadius: 2,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {tokenKey}
            </button>
          ))}
      </div>

      {bannerStatus && (
        <div
          style={{
            padding: '6px 12px',
            fontSize: 11.5,
            background: 'rgba(56, 189, 248, 0.12)',
            borderBottom: '1px solid var(--border)',
            color: 'var(--accent-cyan)',
          }}
        >
          {bannerStatus}
        </div>
      )}

      {csvPreview && (
        <div
          data-testid="unicode-csv-preview-banner"
          style={{
            padding: 12,
            background: 'rgba(15, 23, 42, 0.95)',
            borderBottom: '1px solid var(--accent-cyan)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--accent-cyan)' }}>
              CSV Import Diff Preview ({csvPreview.mode.toUpperCase()} mode) — {csvPreview.updatedCount} updated, {csvPreview.appendedCount} appended, {csvPreview.unchangedCount} unchanged
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={async () => {
                  const nextMode = csvImportMode === 'amend' ? 'replace' : 'amend';
                  setCsvImportMode(nextMode);
                  const res = await window.opence.previewStringsCsvImport(tag.index, rawCsvDraft, nextMode);
                  if (res.ok) setCsvPreview(res.preview);
                }}
                style={{ padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}
              >
                Switch to {csvImportMode === 'amend' ? 'REPLACE' : 'AMEND'}
              </button>
              <button
                type="button"
                onClick={() => setCsvPreview(null)}
                style={{ padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="unicode-csv-apply-btn"
                onClick={() => void handleApplyCsvImport()}
                style={{
                  padding: '3px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  background: 'var(--accent-cyan)',
                  color: '#06202c',
                  border: 'none',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                Apply CSV Changes
              </button>
            </div>
          </div>
          <div style={{ maxHeight: 140, overflowY: 'auto', fontSize: 11, fontFamily: 'var(--mono-font)' }}>
            {csvPreview.diffs
              .filter((d) => d.status !== 'unchanged')
              .slice(0, 40)
              .map((d) => (
                <div key={d.index} style={{ padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ color: d.status === 'appended' ? '#4ade80' : '#fbbf24' }}>
                    [{d.index}] ({d.status}):
                  </span>{' '}
                  {d.oldText !== null && <span style={{ color: '#f87171', textDecoration: 'line-through' }}>{d.oldText}</span>}{' '}
                  <span style={{ color: '#38bdf8' }}>→ {d.newText}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {loading && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, fontStyle: 'italic' }}>
          Loading unicode string table...
        </div>
      )}

      {error && (
        <div data-testid="unicode-string-error" style={{ padding: 16, color: 'var(--error-text, #f87171)', fontSize: 12 }}>
          {error}
        </div>
      )}

      {data?.isExternal && (
        <div data-testid="unicode-string-external-note" style={{ padding: 16, margin: 12, borderRadius: 4, background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', color: 'var(--warn-text, #facc15)', fontSize: 12 }}>
          <strong>External Tag:</strong> {data.externalNote}
        </div>
      )}

      {!loading && !error && !data?.isExternal && data && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredStrings.length === 0 ? (
            <div data-testid="unicode-no-strings-message" style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, fontStyle: 'italic' }}>
              {data.strings.length === 0 ? 'This unicode string list has 0 strings.' : 'No strings match your filter.'}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ ...tableHeaderStyle, width: 44, textAlign: 'right' }}>#</th>
                  <th style={tableHeaderStyle}>String Text</th>
                  <th style={{ ...tableHeaderStyle, width: 110, textAlign: 'center' }}>Length / Max</th>
                  <th style={{ ...tableHeaderStyle, width: 120, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStrings.map((s) => {
                  const currentText = (edits[s.index] !== undefined ? edits[s.index] : s.text) ?? '';
                  const isDirty = edits[s.index] !== undefined;
                  const isSaving = savingIndex === s.index;
                  const currentLen = currentText.length;
                  const isOver = currentLen > (s.maxChars ?? 0);
                  const status = rowStatus[s.index];

                  return (
                    <tr
                      key={s.index}
                      data-testid={`unicode-string-row-${s.index}`}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        background: isDirty ? 'rgba(56,189,248,0.05)' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-dim)', fontFamily: 'var(--mono-font)', fontSize: 11 }}>
                        {s.index}
                      </td>
                      <td style={{ padding: '4px 8px' }}>
                        <input
                          data-testid={`unicode-input-${s.index}`}
                          type="text"
                          value={currentText}
                          onFocus={() => setFocusedRowIndex(s.index)}
                          onChange={(e) => handleTextChange(s.index, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && isDirty && !isOver && !isSaving) {
                              void handleSaveString(s.index);
                            }
                          }}
                          style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            background: 'var(--bg-input, #1e1e1e)',
                            border: `1px solid ${isOver ? 'var(--error-text, #f87171)' : isDirty ? 'var(--accent-cyan)' : 'var(--border)'}`,
                            borderRadius: 3,
                            color: 'var(--text-primary)',
                            fontSize: 12,
                            padding: '4px 6px',
                            fontFamily: 'var(--mono-font)',
                          }}
                        />
                        {currentText.includes('%') && (
                          <div style={{ marginTop: 3, fontSize: 10.5, fontFamily: 'var(--mono-font)', display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                            {tokenizeHaloHudStringMarkup(currentText).map((seg, segIdx) => (
                              <span
                                key={segIdx}
                                title={seg.description}
                                style={{
                                  padding: seg.type !== 'text' ? '0 4px' : undefined,
                                  borderRadius: 2,
                                  background:
                                    seg.type === 'button_token'
                                      ? 'rgba(56, 189, 248, 0.2)'
                                      : seg.type === 'control_token'
                                        ? 'rgba(251, 191, 36, 0.2)'
                                        : 'transparent',
                                  color:
                                    seg.type === 'button_token'
                                      ? '#38bdf8'
                                      : seg.type === 'control_token'
                                        ? '#fbbf24'
                                        : 'var(--text-dim)',
                                }}
                              >
                                {seg.raw}
                              </span>
                            ))}
                          </div>
                        )}
                        {status && (
                          <div
                            data-testid={`status-tag-${s.index}`}
                            style={{
                              fontSize: 10,
                              marginTop: 2,
                              color: status.ok ? 'var(--accent-cyan)' : 'var(--error-text, #f87171)',
                            }}
                          >
                            {status.message}
                          </div>
                        )}
                      </td>
                      <td
                        style={{
                          padding: '6px 8px',
                          textAlign: 'center',
                          fontFamily: 'var(--mono-font)',
                          fontSize: 11,
                          color: isOver ? 'var(--error-text, #f87171)' : currentLen === s.maxChars ? 'var(--warn-text, #facc15)' : 'var(--text-dim)',
                        }}
                      >
                        {currentLen} / {s.maxChars}
                      </td>
                      <td style={{ padding: '4px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {isDirty && (
                          <div style={{ display: 'inline-flex', gap: 4 }}>
                            <button
                              data-testid={`unicode-save-btn-${s.index}`}
                              disabled={isSaving || isOver}
                              onClick={() => void handleSaveString(s.index)}
                              style={{
                                padding: '3px 8px',
                                background: isOver ? 'var(--border)' : 'var(--accent-cyan)',
                                color: isOver ? 'var(--text-dim)' : '#000',
                                border: 'none',
                                borderRadius: 3,
                                fontSize: 11,
                                fontWeight: 600,
                                cursor: isOver || isSaving ? 'not-allowed' : 'pointer',
                              }}
                            >
                              {isSaving ? '...' : 'Save'}
                            </button>
                            <button
                              data-testid={`unicode-reset-btn-${s.index}`}
                              disabled={isSaving}
                              onClick={() => handleResetString(s.index)}
                              style={{
                                padding: '3px 6px',
                                background: 'transparent',
                                color: 'var(--text-dim)',
                                border: '1px solid var(--border)',
                                borderRadius: 3,
                                fontSize: 11,
                                cursor: 'pointer',
                              }}
                            >
                              Undo
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
