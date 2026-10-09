import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import type { TagEntrySummary } from '../../electron/shared-types';

interface Props {
  tags: TagEntrySummary[];
  onFocusTag: (tag: TagEntrySummary) => void;
  selected: Set<number>;
  onSelectedChange: (next: Set<number>) => void;
  onExtractRequested: (indices: number[]) => void;
  /** null = enabled; otherwise the tooltip/disabled reason shown on the Extract button/menu item. */
  extractDisabledReason: string | null;
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

function smallButtonStyle(): CSSProperties {
  return {
    background: 'var(--bg-panel-header)',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 2,
    padding: '5px 8px',
    fontSize: 11,
    whiteSpace: 'nowrap',
  };
}

export default function TagBrowser({ tags, onFocusTag, selected, onSelectedChange, onExtractRequested, extractDisabledReason }: Props) {
  const [search, setSearch] = useState('');
  const [groupMode, setGroupMode] = useState<GroupMode>('class');
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; index: number } | null>(null);

  // A brand new `tags` array means a different map was opened - start fully collapsed again.
  // Does NOT fire on re-renders of the same map (e.g. after closing the dependency dialog).
  useEffect(() => {
    setOpenGroups(new Set());
    setSearch('');
    setFocusedIndex(null);
  }, [tags]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [contextMenu]);

  const isSearching = search.trim().length > 0;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter(
      (t) => t.path.toLowerCase().includes(q) || t.primaryClassName.toLowerCase().includes(q) || t.tagId.toString(16).includes(q),
    );
  }, [tags, search]);

  const groupKeyOf = (t: TagEntrySummary) => (groupMode === 'class' ? t.primaryClassName : topFolder(t.path));

  const groups = useMemo(() => {
    const map = new Map<string, TagEntrySummary[]>();
    for (const t of filtered) {
      const key = groupKeyOf(t);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, groupMode]);

  const allGroupKeys = useMemo(() => new Set(tags.map(groupKeyOf)), [tags, groupMode]);

  // While searching, every group shown already contains only matches (see `filtered` above), so
  // it's always expanded; the manual `openGroups` set underneath is left untouched and takes
  // over again the moment the search is cleared (toggleGroup also no-ops while searching).
  const effectiveOpen = (key: string) => (isSearching ? true : openGroups.has(key));

  const toggleGroup = (key: string) => {
    if (isSearching) return;
    const next = new Set(openGroups);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpenGroups(next);
  };

  const expandAll = () => setOpenGroups(new Set(allGroupKeys));
  const collapseAll = () => setOpenGroups(new Set());

  const toggleSelect = (index: number) => {
    const next = new Set(selected);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    onSelectedChange(next);
  };

  const toggleGroupSelect = (items: TagEntrySummary[]) => {
    const allSelected = items.every((t) => selected.has(t.index));
    const next = new Set(selected);
    for (const t of items) {
      if (allSelected) next.delete(t.index);
      else next.add(t.index);
    }
    onSelectedChange(next);
  };

  const focusRow = (t: TagEntrySummary) => {
    setFocusedIndex(t.index);
    onFocusTag(t);
  };

  const handleRowContextMenu = (e: ReactMouseEvent, t: TagEntrySummary) => {
    e.preventDefault();
    if (!selected.has(t.index)) onSelectedChange(new Set([t.index]));
    setContextMenu({ x: e.clientX, y: e.clientY, index: t.index });
  };

  const requestExtract = () => {
    if (selected.size === 0) return;
    onExtractRequested(Array.from(selected));
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
          <button data-testid="expand-all-button" onClick={expandAll} title="Expand all groups" style={smallButtonStyle()}>
            Expand all
          </button>
          <button data-testid="collapse-all-button" onClick={collapseAll} title="Collapse all groups" style={smallButtonStyle()}>
            Collapse all
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            data-testid="extract-selected-button"
            disabled={selected.size === 0 || !!extractDisabledReason}
            title={extractDisabledReason ?? undefined}
            onClick={requestExtract}
            style={{
              flex: 1,
              background: selected.size && !extractDisabledReason ? 'var(--accent-cyan)' : 'var(--bg-panel-header)',
              color: selected.size && !extractDisabledReason ? '#06202c' : 'var(--text-dim)',
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
          const isOpen = effectiveOpen(key);
          const allSelected = items.length > 0 && items.every((t) => selected.has(t.index));
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
                <input
                  data-testid={`tag-group-select-${slugify(key)}`}
                  type="checkbox"
                  title={`Select all tags under "${key}"`}
                  checked={allSelected}
                  onChange={() => toggleGroupSelect(items)}
                  onClick={(e) => e.stopPropagation()}
                />
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
                    onContextMenu={(e) => handleRowContextMenu(e, t)}
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

      {contextMenu && (
        <div
          data-testid="tag-row-context-menu"
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            boxShadow: '2px 4px 10px rgba(0,0,0,0.5)',
            zIndex: 200,
            minWidth: 220,
          }}
        >
          <button
            data-testid="tag-row-context-extract"
            disabled={!!extractDisabledReason}
            title={extractDisabledReason ?? undefined}
            onClick={() => {
              setContextMenu(null);
              requestExtract();
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              background: 'transparent',
              border: 'none',
              padding: '7px 14px',
              color: extractDisabledReason ? 'var(--text-dim)' : 'var(--text-primary)',
              fontSize: 12.5,
              cursor: extractDisabledReason ? 'default' : 'pointer',
            }}
          >
            Extract (with dependencies)...
          </button>
        </div>
      )}
    </div>
  );
}
