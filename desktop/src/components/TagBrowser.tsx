import { useMemo, useState } from 'react';
import type { TagEntrySummary } from '../../electron/shared-types';

interface Props {
  tags: TagEntrySummary[];
  onNotImplemented: (feature: string) => void;
}

type GroupMode = 'class' | 'folder';

function formatSize(n: number | null): string {
  if (n === null) return '-';
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

function topFolder(path: string): string {
  const parts = path.split('\\');
  return parts.length > 1 ? parts[0] : '(root)';
}

export default function TagBrowser({ tags, onNotImplemented }: Props) {
  const [search, setSearch] = useState('');
  const [groupMode, setGroupMode] = useState<GroupMode>('class');
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter(
      (t) => t.path.toLowerCase().includes(q) || t.primaryClassName.toLowerCase().includes(q) || t.tagId.toString(16).includes(q),
    );
  }, [tags, search]);

  const groups = useMemo(() => {
    const map = new Map<string, TagEntrySummary[]>();
    for (const t of filtered) {
      const key = groupMode === 'class' ? t.primaryClassName : topFolder(t.path);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, groupMode]);

  const effectiveOpen = search.trim() ? new Set(groups.map(([key]) => key)) : openGroups;

  const toggleGroup = (key: string) => {
    const next = new Set(openGroups);
    next.has(key) ? next.delete(key) : next.add(key);
    setOpenGroups(next);
  };

  const toggleSelect = (index: number) => {
    const next = new Set(selected);
    next.has(index) ? next.delete(index) : next.add(index);
    setSelected(next);
  };

  return (
    <div data-testid="tag-browser" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border-soft)' }}>
        <input
          data-testid="tag-search-input"
          placeholder="Search path, class, or tag ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 5,
            padding: '6px 10px',
            color: 'var(--text-primary)',
            fontSize: 13,
          }}
        />
        <select
          data-testid="group-mode-select"
          value={groupMode}
          onChange={(e) => setGroupMode(e.target.value as GroupMode)}
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-primary)', fontSize: 13 }}
        >
          <option value="class">Group by class</option>
          <option value="folder">Group by folder</option>
        </select>
        <button
          data-testid="extract-selected-button"
          disabled={selected.size === 0}
          onClick={() => onNotImplemented('Extract Tags')}
          style={{
            background: selected.size ? 'var(--accent)' : 'var(--bg-elevated)',
            color: selected.size ? '#1a1406' : 'var(--text-dim)',
            border: '1px solid var(--border)',
            borderRadius: 5,
            padding: '6px 14px',
            fontSize: 13,
          }}
        >
          Extract Selected ({selected.size})
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 160px 90px 90px', padding: '6px 14px', fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', borderBottom: '1px solid var(--border-soft)' }}>
        <div />
        <div>Path</div>
        <div>Class</div>
        <div>Tag ID</div>
        <div>Size</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }} data-testid="tag-browser-list">
        {groups.map(([key, items]) => {
          const isOpen = effectiveOpen.has(key);
          return (
            <div key={key}>
              <div
                data-testid={`tag-group-${key}`}
                onClick={() => toggleGroup(key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 14px',
                  background: 'var(--bg-elevated)',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--accent-strong)',
                }}
              >
                <span>{isOpen ? '▾' : '▸'}</span>
                <span>{key}</span>
                <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>({items.length})</span>
              </div>
              {isOpen &&
                items.map((t) => (
                  <div
                    key={t.index}
                    data-testid={`tag-row-${t.index}`}
                    onClick={() => toggleSelect(t.index)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '28px 1fr 160px 90px 90px',
                      padding: '5px 14px',
                      fontSize: 12.5,
                      fontFamily: 'var(--mono-font)',
                      background: selected.has(t.index) ? 'var(--accent-dim)' : 'transparent',
                      borderBottom: '1px solid var(--border-soft)',
                      cursor: 'pointer',
                    }}
                  >
                    <input type="checkbox" checked={selected.has(t.index)} onChange={() => toggleSelect(t.index)} onClick={(e) => e.stopPropagation()} />
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.path}>
                      {t.path}
                      {t.isExternal && <span style={{ color: 'var(--text-dim)' }}> (external)</span>}
                    </div>
                    <div>{t.primaryClassName}</div>
                    <div>0x{t.tagId.toString(16).padStart(8, '0')}</div>
                    <div>{formatSize(t.estimatedSize)}</div>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
