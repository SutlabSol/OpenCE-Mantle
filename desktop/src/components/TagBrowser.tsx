import { useMemo, useState } from 'react';
import type { TagEntrySummary } from '../../electron/shared-types';

interface Props {
  tags: TagEntrySummary[];
  onFocusTag: (tag: TagEntrySummary) => void;
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

function slugify(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'group';
}

export default function TagBrowser({ tags, onFocusTag, onNotImplemented }: Props) {
  const [search, setSearch] = useState('');
  const [groupMode, setGroupMode] = useState<GroupMode>('class');
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

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
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setOpenGroups(next);
  };

  const toggleSelect = (index: number) => {
    const next = new Set(selected);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    setSelected(next);
  };

  const focusRow = (t: TagEntrySummary) => {
    setFocusedIndex(t.index);
    onFocusTag(t);
  };

  return (
    <div data-testid="hierarchy-tag-browser" style={{ width: 360, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg-panel)' }}>
      <div style={{ padding: '7px 10px', background: 'var(--bg-panel-header)', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
        Hierarchy
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
        <input
          data-testid="tag-search-input"
          placeholder="Search path, class, or tag ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ background: 'var(--bg-main)', border: '1px solid var(--border)', borderRadius: 2, padding: '5px 8px', color: 'var(--text-primary)', fontSize: 12 }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            data-testid="group-mode-select"
            value={groupMode}
            onChange={(e) => setGroupMode(e.target.value as GroupMode)}
            style={{ flex: 1, background: 'var(--bg-main)', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--text-primary)', fontSize: 12 }}
          >
            <option value="class">By class</option>
            <option value="folder">By folder</option>
          </select>
          <button
            data-testid="extract-selected-button"
            disabled={selected.size === 0}
            onClick={() => onNotImplemented('Extract Tags')}
            style={{
              background: selected.size ? 'var(--accent-cyan)' : 'var(--bg-panel-header)',
              color: selected.size ? '#06202c' : 'var(--text-dim)',
              border: '1px solid var(--border)',
              borderRadius: 2,
              padding: '5px 10px',
              fontSize: 11.5,
              whiteSpace: 'nowrap',
            }}
          >
            Extract ({selected.size})
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }} data-testid="tag-browser-list">
        {groups.map(([key, items]) => {
          const isOpen = effectiveOpen.has(key);
          return (
            <div key={key}>
              <div
                data-testid={`tag-group-${slugify(key)}`}
                onClick={() => toggleGroup(key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 10px',
                  background: 'var(--bg-panel-header)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--accent-cyan)',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <span style={{ fontSize: 10 }}>{isOpen ? '▾' : '▸'}</span>
                <span>{key}</span>
                <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>({items.length})</span>
              </div>
              {isOpen &&
                items.map((t) => (
                  <div
                    key={t.index}
                    data-testid={`tag-row-${t.index}`}
                    onClick={() => focusRow(t)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 10px 4px 22px',
                      fontSize: 12,
                      fontFamily: 'var(--mono-font)',
                      background: focusedIndex === t.index ? 'var(--selection-bg)' : selected.has(t.index) ? 'rgba(56,189,248,0.08)' : 'transparent',
                      borderLeft: focusedIndex === t.index ? '2px solid var(--selection-border)' : '2px solid transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <input type="checkbox" checked={selected.has(t.index)} onChange={() => toggleSelect(t.index)} onClick={(e) => e.stopPropagation()} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={t.path}>
                      {t.path.split('\\').pop()}
                      {t.isExternal && <span style={{ color: 'var(--text-dim)' }}> *</span>}
                    </span>
                    <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{formatSize(t.estimatedSize)}</span>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
