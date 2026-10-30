import { useMemo, useState } from 'react';
import type { OpenMapTabSession } from '../../electron/shared-types';

interface SplitComparePaneProps {
  sessions: OpenMapTabSession[];
  primarySession: OpenMapTabSession | null;
  secondarySession: OpenMapTabSession | null;
  onSelectSecondarySession: (sessionId: string) => void;
  onActivateSessionAsPrimary: (sessionId: string, focusTagPath?: string) => void;
  onFocusMatchingTagInPrimary: (tagPath: string, groupName: string) => void;
  onOpenAnotherMap: () => void;
  onDetachSessionToWindow: (sessionId: string) => void;
  onCloseSplitView: () => void;
}

export default function SplitComparePane({
  sessions,
  primarySession,
  secondarySession,
  onSelectSecondarySession,
  onActivateSessionAsPrimary,
  onFocusMatchingTagInPrimary,
  onOpenAnotherMap,
  onDetachSessionToWindow,
  onCloseSplitView,
}: SplitComparePaneProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [classFilter, setClassFilter] = useState<string>('ALL');
  const [onlyDifferences, setOnlyDifferences] = useState(false);

  const primaryTagPathSet = useMemo(() => {
    const s = new Set<string>();
    if (primarySession?.map?.tags) {
      for (const t of primarySession.map.tags) {
        s.add(`${t.primaryClassName}:${t.path}`);
      }
    }
    return s;
  }, [primarySession]);

  const classGroups = useMemo(() => {
    const counts = new Map<string, number>();
    if (secondarySession?.map?.tags) {
      for (const t of secondarySession.map.tags) {
        counts.set(t.primaryClassName, (counts.get(t.primaryClassName) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [secondarySession]);

  const filteredTags = useMemo(() => {
    if (!secondarySession?.map?.tags) return [];
    const q = searchQuery.trim().toLowerCase();
    return secondarySession.map.tags.filter((t) => {
      if (classFilter !== 'ALL' && t.primaryClassName !== classFilter) return false;
      if (onlyDifferences && primaryTagPathSet.has(`${t.primaryClassName}:${t.path}`)) return false;
      if (!q) return true;
      return t.path.toLowerCase().includes(q) || t.primaryClassName.toLowerCase().includes(q);
    });
  }, [secondarySession, searchQuery, classFilter, onlyDifferences, primaryTagPathSet]);

  if (!secondarySession) {
    return (
      <div
        data-testid="split-compare-pane-empty"
        style={{
          flex: 1,
          background: 'var(--bg-panel)',
          borderLeft: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          gap: 12,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
          Side-by-Side Map Comparison Pane
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 380, textAlign: 'center', lineHeight: 1.45 }}>
          Open a second <code style={{ color: 'var(--accent-cyan)' }}>.map</code> file to compare tag hierarchies,
          header metrics, and unique tags side-by-side with your active map.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onOpenAnotherMap}
            style={{
              padding: '6px 14px',
              background: 'var(--selection-bg)',
              border: '1px solid var(--border-active)',
              color: 'var(--accent-cyan)',
              fontWeight: 600,
              fontSize: 12,
              borderRadius: 2,
            }}
          >
            + Open Second Map...
          </button>
          <button
            onClick={onCloseSplitView}
            style={{
              padding: '6px 14px',
              background: 'var(--bg-control)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              fontSize: 12,
              borderRadius: 2,
            }}
          >
            Close Split View
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="split-compare-pane"
      style={{
        flex: 1,
        background: 'var(--bg-panel)',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      {/* Top Header of Secondary Comparison Pane */}
      <div
        style={{
          padding: '6px 10px',
          background: 'var(--bg-panel-header)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span
            style={{
              fontFamily: 'var(--mono-font)',
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 5px',
              background: 'var(--accent-gold)',
              color: '#060a10',
              borderRadius: 2,
            }}
          >
            RIGHT PANE
          </span>
          <select
            value={secondarySession.sessionId}
            onChange={(e) => onSelectSecondarySession(e.target.value)}
            style={{
              padding: '3px 8px',
              fontSize: 12,
              fontFamily: 'var(--mono-font)',
              background: 'var(--bg-control)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              borderRadius: 2,
            }}
          >
            {sessions.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {s.fileName} ({s.scenarioName})
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <button
            onClick={() => onActivateSessionAsPrimary(secondarySession.sessionId)}
            title="Make this map the active primary editor map"
            style={{
              padding: '3px 8px',
              fontSize: 11,
              background: 'var(--selection-bg)',
              border: '1px solid var(--border-active)',
              color: 'var(--accent-cyan)',
              borderRadius: 2,
            }}
          >
            ⇄ Make Active
          </button>
          <button
            onClick={() => onDetachSessionToWindow(secondarySession.sessionId)}
            title="Tear off this map into a second monitor window"
            style={{
              padding: '3px 8px',
              fontSize: 11,
              background: 'var(--bg-control)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              borderRadius: 2,
            }}
          >
            ↗ 2nd Window
          </button>
          <button
            onClick={onCloseSplitView}
            title="Close side-by-side split view"
            style={{
              padding: '3px 7px',
              fontSize: 11,
              background: 'var(--bg-control)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              borderRadius: 2,
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Header Metrics Comparison Strip */}
      <div
        style={{
          padding: '8px 10px',
          background: 'var(--bg-control)',
          borderBottom: '1px solid var(--border)',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
          fontFamily: 'var(--mono-font)',
          fontSize: 10.5,
        }}
      >
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: 9.5 }}>SCENARIO</div>
          <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            {secondarySession.map.header.scenarioName}
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: 9.5 }}>TAG COUNT</div>
          <div style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>
            {secondarySession.map.tags.length.toLocaleString()} tags
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: 9.5 }}>CRC32</div>
          <div style={{ color: 'var(--text-secondary)' }}>
            0x{(secondarySession.map.header.crc32 >>> 0).toString(16).toUpperCase().padStart(8, '0')}
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: 9.5 }}>SIZE</div>
          <div style={{ color: 'var(--text-secondary)' }}>
            {(secondarySession.map.header.fileSizeOnDisk / (1024 * 1024)).toFixed(2)} MB
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        style={{
          padding: '6px 10px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search tags in right pane..."
          style={{
            flex: 1,
            minWidth: 130,
            padding: '4px 8px',
            fontSize: 11.5,
            background: 'var(--bg-control)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            borderRadius: 2,
            outline: 'none',
          }}
        />
        <select
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          style={{
            padding: '4px 6px',
            fontSize: 11,
            fontFamily: 'var(--mono-font)',
            background: 'var(--bg-control)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            borderRadius: 2,
          }}
        >
          <option value="ALL">All Classes ({secondarySession.map.tags.length})</option>
          {classGroups.map(([cls, count]) => (
            <option key={cls} value={cls}>
              {cls} ({count})
            </option>
          ))}
        </select>
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
            color: onlyDifferences ? 'var(--accent-gold)' : 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={onlyDifferences}
            onChange={(e) => setOnlyDifferences(e.target.checked)}
          />
          Unique to Right Map
        </label>
      </div>

      {/* Tag List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
        {filteredTags.map((tag) => {
          const existsInLeft = primaryTagPathSet.has(`${tag.primaryClassName}:${tag.path}`);
          return (
            <div
              key={tag.index}
              style={{
                padding: '4px 8px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                fontFamily: 'var(--mono-font)',
                fontSize: 11,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                <span
                  style={{
                    padding: '0 4px',
                    background: 'var(--bg-panel-header)',
                    border: '1px solid var(--border)',
                    color: 'var(--accent-cyan)',
                    fontSize: 10,
                    borderRadius: 2,
                    flexShrink: 0,
                  }}
                >
                  {tag.primaryClassName}
                </span>
                <span
                  title={tag.path}
                  style={{
                    color: 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tag.path}
                </span>
                {!existsInLeft && (
                  <span
                    style={{
                      fontSize: 9.5,
                      padding: '0 4px',
                      background: 'var(--warn-bg)',
                      border: '1px solid var(--warn-border)',
                      color: 'var(--warn-text)',
                      borderRadius: 2,
                      flexShrink: 0,
                    }}
                  >
                    UNIQUE
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {existsInLeft && (
                  <button
                    onClick={() => onFocusMatchingTagInPrimary(tag.path, tag.primaryClassName)}
                    title="Select the matching tag in the Left Pane editor"
                    style={{
                      padding: '1px 6px',
                      fontSize: 10,
                      background: 'var(--bg-control)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                      borderRadius: 2,
                    }}
                  >
                    Match Left
                  </button>
                )}
                <button
                  onClick={() => onActivateSessionAsPrimary(secondarySession.sessionId, tag.path)}
                  title="Switch to this map and open this tag in the full editor"
                  style={{
                    padding: '1px 6px',
                    fontSize: 10,
                    background: 'var(--selection-bg)',
                    border: '1px solid var(--border-active)',
                    color: 'var(--accent-cyan)',
                    borderRadius: 2,
                  }}
                >
                  Inspect
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
