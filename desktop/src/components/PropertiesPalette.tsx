import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { TagDependencySlot, TagEntrySummary } from '../../electron/shared-types';
import { lookupTagClassByName, NULL_TAG_ID } from '../../../core/src/constants/tag-classes';

interface Props {
  focusedTag: TagEntrySummary | null;
  allTags?: TagEntrySummary[];
}

type Tab = 'overview' | 'swapper';

function Row(label: string, value: string) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 10px', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--text-dim)', fontSize: 11, textTransform: 'uppercase' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--mono-font)', textAlign: 'right', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

function getSlotClassCode(slot: TagDependencySlot): string {
  const groupName = slot.currentGroup ?? slot.allowedClasses[0] ?? '';
  if (!groupName) return 'tag';
  const info = lookupTagClassByName(groupName);
  return info ? info.groupId.trim() : groupName;
}

export default function PropertiesPalette({ focusedTag, allTags = [] }: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const [slots, setSlots] = useState<TagDependencySlot[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedFieldPath, setSelectedFieldPath] = useState<string | null>(null);
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [selectedTagId, setSelectedTagId] = useState<string>('null');
  const [isSwapping, setIsSwapping] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const availableClasses = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTags) {
      if (t.primaryClassName) set.add(t.primaryClassName);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allTags]);

  const tagsForSelectedClass = useMemo(() => {
    if (!selectedClass || selectedClass === '__null__') return [];
    return allTags
      .filter((t) => t.primaryClassName === selectedClass)
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [allTags, selectedClass]);

  const syncControlsToSlot = (slot: TagDependencySlot | undefined, classes: string[], tags: TagEntrySummary[]) => {
    if (!slot) {
      setSelectedClass(classes[0] ?? '__null__');
      setSelectedTagId('null');
      return;
    }
    if (slot.currentTagId !== NULL_TAG_ID && slot.currentGroup) {
      setSelectedClass(slot.currentGroup);
      setSelectedTagId(String(slot.currentTagId));
      return;
    }
    const preferredClass = slot.allowedClasses.find((c) => classes.includes(c)) ?? classes[0] ?? '__null__';
    setSelectedClass(preferredClass);
    if (preferredClass === '__null__') {
      setSelectedTagId('null');
    } else {
      const firstTag = tags
        .filter((t) => t.primaryClassName === preferredClass)
        .sort((a, b) => a.path.localeCompare(b.path))[0];
      setSelectedTagId(firstTag ? String(firstTag.tagId) : 'null');
    }
  };

  // Load dependency slots whenever focusedTag changes
  useEffect(() => {
    if (!focusedTag) {
      setSlots([]);
      setSlotsError(null);
      setSelectedFieldPath(null);
      setStatusMessage(null);
      return;
    }

    let isCancelled = false;
    setIsLoadingSlots(true);
    setSlotsError(null);
    setStatusMessage(null);

    void window.opence.getDependencySlots(focusedTag.index).then((res) => {
      if (isCancelled) return;
      setIsLoadingSlots(false);
      if (res.ok) {
        setSlots(res.slots);
        const first = res.slots[0];
        setSelectedFieldPath(first ? first.fieldPath : null);
        syncControlsToSlot(first, availableClasses, allTags);
      } else {
        setSlots([]);
        setSelectedFieldPath(null);
        setSlotsError(res.message);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [focusedTag]);

  const filteredSlots = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return slots;
    return slots.filter((slot) => {
      const code = getSlotClassCode(slot).toLowerCase();
      const fp = slot.fieldPath.toLowerCase();
      const cur = (slot.currentPath ?? 'nulled out').toLowerCase();
      return code.includes(q) || fp.includes(q) || cur.includes(q);
    });
  }, [slots, search]);

  const selectedSlot = useMemo(
    () => slots.find((s) => s.fieldPath === selectedFieldPath) ?? null,
    [slots, selectedFieldPath],
  );

  const handleSelectSlot = (slot: TagDependencySlot) => {
    setSelectedFieldPath(slot.fieldPath);
    syncControlsToSlot(slot, availableClasses, allTags);
  };

  const handleClassChange = (newClass: string) => {
    setSelectedClass(newClass);
    if (newClass === '__null__') {
      setSelectedTagId('null');
      return;
    }
    const matching = allTags
      .filter((t) => t.primaryClassName === newClass)
      .sort((a, b) => a.path.localeCompare(b.path));
    setSelectedTagId(matching[0] ? String(matching[0].tagId) : 'null');
  };

  const handleApplySwap = async () => {
    if (!focusedTag || !selectedSlot) return;
    setIsSwapping(true);
    setStatusMessage(null);

    const targetTagId =
      selectedClass === '__null__' || selectedTagId === 'null' ? null : Number(selectedTagId);

    const res = await window.opence.setDependencySlot(
      focusedTag.index,
      selectedSlot.fieldPath,
      targetTagId,
    );
    setIsSwapping(false);

    if (res.ok) {
      const isCleared = res.newTagId === NULL_TAG_ID;
      const targetEntry = isCleared ? undefined : allTags.find((t) => t.tagId === res.newTagId);
      const nextPath = targetEntry ? targetEntry.path : null;
      const nextGroup = targetEntry ? targetEntry.primaryClassName : null;

      setSlots((prev) =>
        prev.map((s) =>
          s.fieldPath === res.fieldPath
            ? {
                ...s,
                currentTagId: res.newTagId,
                currentPath: nextPath,
                currentGroup: nextGroup,
              }
            : s,
        ),
      );
      setStatusMessage(
        `Swapped "${res.fieldPath}" -> ${nextPath ?? 'Nulled Out'} (Ctrl+S to save map)`,
      );
    } else {
      setStatusMessage(`Failed to swap "${selectedSlot.fieldPath}": ${res.message}`);
    }
  };

  const selectStyle: CSSProperties = {
    background: 'var(--bg-input, #1e1e1e)',
    border: '1px solid var(--border)',
    borderRadius: 3,
    color: 'var(--text-primary)',
    fontSize: 11.5,
    padding: '4px 6px',
    fontFamily: 'var(--mono-font)',
    width: '100%',
    boxSizing: 'border-box',
  };

  return (
    <div
      data-testid="properties-palette"
      style={{
        width: 320,
        flexShrink: 0,
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg-panel)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div style={{ display: 'flex', background: 'var(--bg-panel-header)', borderBottom: '1px solid var(--border)' }}>
        <button
          data-testid="tab-properties-overview"
          onClick={() => setTab('overview')}
          style={{
            flex: 1,
            padding: '7px 10px',
            background: tab === 'overview' ? 'var(--bg-panel)' : 'transparent',
            border: 'none',
            borderBottom: tab === 'overview' ? '2px solid var(--accent-cyan)' : '2px solid transparent',
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            color: tab === 'overview' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          Properties
        </button>
        <button
          data-testid="tab-properties-swapper"
          onClick={() => setTab('swapper')}
          style={{
            flex: 1,
            padding: '7px 10px',
            background: tab === 'swapper' ? 'var(--bg-panel)' : 'transparent',
            border: 'none',
            borderBottom: tab === 'swapper' ? '2px solid var(--accent-cyan)' : '2px solid transparent',
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            color: tab === 'swapper' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          Dependency Swapper {slots.length > 0 ? `(${slots.length})` : ''}
        </button>
      </div>

      {focusedTag ? (
        tab === 'overview' ? (
          <div data-testid="properties-palette-content" style={{ overflowY: 'auto', flex: 1 }}>
            {Row('Path', focusedTag.path)}
            {Row('Class', focusedTag.primaryClassName)}
            {Row('Tag ID', `0x${focusedTag.tagId.toString(16).padStart(8, '0')}`)}
            {Row('Size', focusedTag.estimatedSize !== null ? `${focusedTag.estimatedSize.toLocaleString()} bytes` : 'Unknown')}
            {Row('Resource Map', focusedTag.isExternal ? 'Yes (external)' : 'No')}

            <div style={{ padding: '10px', marginTop: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 6 }}>Dependencies</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                Switch to the <strong>Dependency Swapper</strong> tab above to view and swap any tag dependency in-place.
              </div>
            </div>
          </div>
        ) : (
          <div data-testid="properties-palette-swapper" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {/* Search filter */}
            <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
              <input
                data-testid="swapper-search-input"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter dependencies..."
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: 'var(--bg-input, #1e1e1e)',
                  border: '1px solid var(--border)',
                  borderRadius: 3,
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  padding: '4px 8px',
                }}
              />
            </div>

            {/* Status message */}
            {statusMessage && (
              <div
                data-testid="swapper-status"
                style={{
                  padding: '6px 10px',
                  fontSize: 11,
                  background: statusMessage.startsWith('Failed') ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                  color: statusMessage.startsWith('Failed') ? '#ef4444' : '#22c55e',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                {statusMessage}
              </div>
            )}

            {/* Column headers */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '115px 1fr',
                padding: '5px 10px',
                background: 'var(--bg-panel-header)',
                borderBottom: '1px solid var(--border)',
                fontSize: 10.5,
                fontWeight: 600,
                textTransform: 'uppercase',
                color: 'var(--text-dim)',
              }}
            >
              <span>Tag / Slot</span>
              <span>Currently</span>
            </div>

            {/* Dependency list */}
            <div data-testid="swapper-slot-list" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {isLoadingSlots ? (
                <div style={{ padding: 16, fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic', textAlign: 'center' }}>
                  Loading dependencies...
                </div>
              ) : slotsError ? (
                <div style={{ padding: 12, fontSize: 12, color: 'var(--warn-text)', fontStyle: 'italic' }}>
                  {slotsError}
                </div>
              ) : filteredSlots.length === 0 ? (
                <div style={{ padding: 16, fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic', textAlign: 'center' }}>
                  {search ? 'No matching dependency slots.' : 'No dependency slots in this tag.'}
                </div>
              ) : (
                filteredSlots.map((slot) => {
                  const isSelected = slot.fieldPath === selectedFieldPath;
                  const code = getSlotClassCode(slot);
                  const isNull = slot.currentTagId === NULL_TAG_ID || slot.currentPath === null;
                  return (
                    <div
                      key={slot.fieldPath}
                      data-testid={`swapper-slot-${slot.fieldPath}`}
                      onClick={() => handleSelectSlot(slot)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '115px 1fr',
                        gap: 6,
                        padding: '5px 10px',
                        borderBottom: '1px solid var(--border)',
                        cursor: 'pointer',
                        background: isSelected ? 'rgba(6, 182, 212, 0.16)' : 'transparent',
                        borderLeft: isSelected ? '3px solid var(--accent-cyan)' : '3px solid transparent',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontFamily: 'var(--mono-font)',
                            fontSize: 11.5,
                            fontWeight: 700,
                            color: isSelected ? 'var(--accent-cyan)' : 'var(--text-primary)',
                          }}
                        >
                          {code}
                        </div>
                        <div
                          title={slot.fieldPath}
                          style={{
                            fontSize: 10,
                            color: 'var(--text-dim)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {slot.fieldPath}
                        </div>
                      </div>
                      <div
                        title={slot.currentPath ?? 'Nulled Out'}
                        style={{
                          fontFamily: 'var(--mono-font)',
                          fontSize: 11,
                          color: isNull ? 'var(--text-dim)' : 'var(--text-primary)',
                          fontStyle: isNull ? 'italic' : 'normal',
                          alignSelf: 'center',
                          wordBreak: 'break-all',
                        }}
                      >
                        {slot.currentPath ?? 'Nulled Out'}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Bottom Swap Controls */}
            <div
              data-testid="swapper-controls"
              style={{
                padding: '10px',
                borderTop: '1px solid var(--border)',
                background: 'var(--bg-panel-header)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Tag and Dependency to Swap With
              </div>
              {selectedSlot && (
                <div style={{ fontSize: 10.5, color: 'var(--text-dim)', fontFamily: 'var(--mono-font)' }}>
                  Slot: {selectedSlot.fieldPath}
                </div>
              )}
              <select
                data-testid="swapper-class-select"
                aria-label="Tag class to swap with"
                disabled={!selectedSlot || isSwapping}
                value={selectedClass}
                onChange={(e) => handleClassChange(e.target.value)}
                style={selectStyle}
              >
                <option value="__null__">(Nulled Out)</option>
                {availableClasses.map((cls) => {
                  const info = lookupTagClassByName(cls);
                  const label = info ? `${info.groupId.trim()} - ${cls}` : cls;
                  return (
                    <option key={cls} value={cls}>
                      {label}
                    </option>
                  );
                })}
              </select>

              <select
                data-testid="swapper-tag-select"
                aria-label="Tag dependency to swap with"
                disabled={!selectedSlot || isSwapping || selectedClass === '__null__'}
                value={selectedClass === '__null__' ? 'null' : selectedTagId}
                onChange={(e) => setSelectedTagId(e.target.value)}
                style={selectStyle}
              >
                <option value="null">Nulled Out</option>
                {tagsForSelectedClass.map((t) => (
                  <option key={t.tagId} value={String(t.tagId)}>
                    {t.path}
                  </option>
                ))}
              </select>

              <button
                data-testid="swapper-apply-button"
                disabled={!selectedSlot || isSwapping}
                onClick={() => void handleApplySwap()}
                style={{
                  marginTop: 2,
                  padding: '6px 10px',
                  background: !selectedSlot || isSwapping ? 'var(--border)' : 'var(--accent-cyan)',
                  color: !selectedSlot || isSwapping ? 'var(--text-dim)' : '#000',
                  border: 'none',
                  borderRadius: 3,
                  fontSize: 11.5,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  cursor: !selectedSlot || isSwapping ? 'not-allowed' : 'pointer',
                }}
              >
                {isSwapping ? 'Swapping...' : 'Swap'}
              </button>
            </div>
          </div>
        )
      ) : (
        <div data-testid="properties-palette-empty" style={{ padding: 16, fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic' }}>
          Select a tag in the hierarchy to view its properties and swap dependencies.
        </div>
      )}
    </div>
  );
}
