import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { TagEntrySummary, UnicodeStringItem, UnicodeStringListResult } from '../../electron/shared-types';

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
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          data-testid="unicode-string-search"
          type="text"
          placeholder="Filter strings by text or index..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            background: 'var(--bg-input, #1e1e1e)',
            border: '1px solid var(--border)',
            borderRadius: 3,
            color: 'var(--text-primary)',
            fontSize: 12,
            padding: '4px 8px',
            fontFamily: 'var(--mono-font)',
          }}
        />
        {data && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
            {filteredStrings.length} of {data.strings.length} string(s)
          </span>
        )}
      </div>

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
