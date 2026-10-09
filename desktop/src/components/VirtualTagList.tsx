import { useState } from 'react';

export interface VirtualRow {
  originalIndex: number;
  path: string;
  group: string;
  estimatedSize: number | null;
  requiredBy: string[];
}

function formatSize(n: number | null): string {
  if (n === null) return '-';
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

/**
 * Lightweight manual windowing (no extra dependency): only rows within the visible scroll
 * range (+ overscan) are mounted, so the list stays responsive for 2,000+ tag selections.
 */
export function VirtualTagList({ rows, rowHeight = 26, height = 240 }: { rows: VirtualRow[]; rowHeight?: number; height?: number }) {
  const [scrollTop, setScrollTop] = useState(0);
  const overscan = 6;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(height / rowHeight) + overscan * 2;
  const endIndex = Math.min(rows.length, startIndex + visibleCount);
  const visibleRows = rows.slice(startIndex, endIndex);

  return (
    <div
      data-testid="dependency-tag-list"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      style={{ height, overflowY: 'auto', position: 'relative', border: '1px solid var(--border)', background: 'var(--bg-main)' }}
    >
      <div style={{ display: 'flex', position: 'sticky', top: 0, background: 'var(--bg-panel-header)', fontSize: 11, color: 'var(--text-dim)', padding: '4px 10px', zIndex: 1 }}>
        <span style={{ flex: 1 }}>Path</span>
        <span style={{ width: 130 }}>Group</span>
        <span style={{ width: 70, textAlign: 'right' }}>Size</span>
        <span style={{ width: 140 }}>Required by</span>
      </div>
      <div style={{ height: rows.length * rowHeight, position: 'relative' }}>
        {visibleRows.map((row, i) => {
          const top = (startIndex + i) * rowHeight;
          const requiredByLabel = row.requiredBy.length === 0 ? '(selected)' : row.requiredBy[row.requiredBy.length - 1].split('\\').pop();
          return (
            <div
              key={row.originalIndex}
              data-testid={`dependency-tag-row-${row.originalIndex}`}
              style={{
                position: 'absolute',
                top,
                left: 0,
                right: 0,
                height: rowHeight,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '0 10px',
                fontSize: 11.5,
                fontFamily: 'var(--mono-font)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.path}>
                {row.path}
              </span>
              <span style={{ width: 130, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.group}</span>
              <span style={{ width: 70, textAlign: 'right', color: 'var(--text-dim)' }}>{formatSize(row.estimatedSize)}</span>
              <span style={{ width: 140, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.requiredBy.join(', ')}>
                {requiredByLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
