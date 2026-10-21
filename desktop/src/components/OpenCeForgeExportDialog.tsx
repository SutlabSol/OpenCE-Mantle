import React, { useState, useMemo, useEffect } from 'react';
import type { TagEntrySummary, ExtractTagsResult, ProgressEvent } from '../../electron/shared-types';

interface Props {
  open: boolean;
  onClose: () => void;
  allTags: TagEntrySummary[];
  initiallySelectedIndices?: number[];
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
}

type CategoryTab = 'vehi' | 'weap' | 'eqip' | 'scen' | 'devices' | 'selected';

const CATEGORY_GROUPS: Record<'vehi' | 'weap' | 'eqip' | 'scen' | 'devices', string[]> = {
  vehi: ['vehi', 'vehicle', 'unit'],
  weap: ['weap', 'weapon', 'proj'],
  eqip: ['eqip', 'equipment', 'item', 'powerup'],
  scen: ['scen', 'scenery'],
  devices: [
    'mach',
    'device_machine',
    'ctrl',
    'device_control',
    'lifi',
    'device_light_fixture',
    'devi',
    'device',
    'lgtv',
    'light_volume',
    'effe',
    'effect',
    'part',
    'particle',
  ],
};

function formatItemDefaultName(path: string): string {
  const leaf = path.split('\\').pop() ?? path;
  const cleaned = leaf
    .replace(/^mp_/i, '')
    .replace(/_mp$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase()) || leaf;
}

const EMPTY_INITIAL_INDICES: number[] = [];

export default function OpenCeForgeExportDialog({
  open,
  onClose,
  allTags,
  initiallySelectedIndices = EMPTY_INITIAL_INDICES,
  log,
}: Props) {
  const [activeTab, setActiveTab] = useState<CategoryTab>('vehi');
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [itemNames, setItemNames] = useState<Record<number, string>>({});
  const [searchFilter, setSearchFilter] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [progressStage, setProgressStage] = useState('Extracting tags...');
  const [progressPercent, setProgressPercent] = useState(0);
  const [result, setResult] = useState<ExtractTagsResult | null>(null);

  // Initialize selection when dialog opens
  useEffect(() => {
    if (!open) {
      setSelectedIndices(new Set());
      setItemNames({});
      setSearchFilter('');
      setIsExtracting(false);
      setResult(null);
      return;
    }

    const initSet = new Set(initiallySelectedIndices);
    setSelectedIndices(initSet);

    const names: Record<number, string> = {};
    for (const idx of initSet) {
      const tag = allTags[idx];
      if (tag) names[idx] = formatItemDefaultName(tag.path);
    }
    setItemNames(names);

    if (initSet.size > 0) {
      setActiveTab('selected');
    } else {
      setActiveTab('vehi');
    }
  }, [open, initiallySelectedIndices, allTags]);

  // Listen to extraction progress
  useEffect(() => {
    if (!open || !isExtracting) return;
    const unsub = window.opence.onProgress((e: ProgressEvent) => {
      if (e.taskId === 'extract') {
        setProgressStage(e.stage);
        setProgressPercent(e.percent);
      }
    });
    return unsub;
  }, [open, isExtracting]);

  // Group tags by category
  const categorizedTags = useMemo(() => {
    const map: Record<CategoryTab, TagEntrySummary[]> = {
      vehi: [],
      weap: [],
      eqip: [],
      scen: [],
      devices: [],
      selected: [],
    };

    for (const tag of allTags) {
      if (tag.isExternal) continue;
      const grp = (tag.primaryClassName ?? '').toLowerCase();

      if (CATEGORY_GROUPS.vehi.includes(grp)) map.vehi.push(tag);
      else if (CATEGORY_GROUPS.weap.includes(grp)) map.weap.push(tag);
      else if (CATEGORY_GROUPS.eqip.includes(grp)) map.eqip.push(tag);
      else if (CATEGORY_GROUPS.scen.includes(grp)) map.scen.push(tag);
      else if (CATEGORY_GROUPS.devices.includes(grp)) map.devices.push(tag);
    }

    return map;
  }, [allTags]);

  // Tags in selected tab
  const displayedTags = useMemo(() => {
    let list: TagEntrySummary[];
    if (activeTab === 'selected') {
      list = Array.from(selectedIndices)
        .map((idx) => allTags[idx])
        .filter((t): t is TagEntrySummary => Boolean(t));
    } else {
      list = categorizedTags[activeTab] || [];
    }

    if (!searchFilter.trim()) return list;
    const filter = searchFilter.toLowerCase();
    return list.filter(
      (t) =>
        t.path.toLowerCase().includes(filter) ||
        (t.primaryClassName ?? '').toLowerCase().includes(filter) ||
        (itemNames[t.index] ?? '').toLowerCase().includes(filter),
    );
  }, [activeTab, categorizedTags, selectedIndices, allTags, searchFilter, itemNames]);

  if (!open) return null;

  const toggleTag = (tag: TagEntrySummary) => {
    const next = new Set(selectedIndices);
    if (next.has(tag.index)) {
      next.delete(tag.index);
    } else {
      next.add(tag.index);
      if (!itemNames[tag.index]) {
        setItemNames((prev) => ({ ...prev, [tag.index]: formatItemDefaultName(tag.path) }));
      }
    }
    setSelectedIndices(next);
  };

  const handleSelectAllInTab = () => {
    const next = new Set(selectedIndices);
    const nextNames = { ...itemNames };
    for (const t of displayedTags) {
      next.add(t.index);
      if (!nextNames[t.index]) {
        nextNames[t.index] = formatItemDefaultName(t.path);
      }
    }
    setSelectedIndices(next);
    setItemNames(nextNames);
  };

  const handleDeselectAllInTab = () => {
    const next = new Set(selectedIndices);
    for (const t of displayedTags) {
      next.delete(t.index);
    }
    setSelectedIndices(next);
  };

  const handleExport = async () => {
    if (selectedIndices.size === 0) return;
    setIsExtracting(true);
    setProgressStage('Preparing Forge extraction...');
    setProgressPercent(0);

    const indices = Array.from(selectedIndices);
    const firstTag = allTags[indices[0]];
    const singleSuggested = firstTag
      ? `${(itemNames[firstTag.index] || formatItemDefaultName(firstTag.path)).replace(/[^a-z0-9_-]+/gi, '_')}`
      : 'forge_tag';

    try {
      const res = await window.opence.extractTags({
        originalIndices: indices,
        suggestedFileName: singleSuggested,
        itemName: indices.length === 1 ? (itemNames[indices[0]] || formatItemDefaultName(firstTag.path)) : undefined,
        itemNames,
        captureGbxmodelRawData: true,
      });

      setIsExtracting(false);
      if (res.ok) {
        setResult(res);
        log('info', `OpenCE Forge: Successfully exported ${res.tagCount} tag(s) to ${res.outputPath}`);
      } else if (res.code === 'CANCELLED') {
        log('warn', 'OpenCE Forge extraction cancelled.');
      } else {
        log('error', `OpenCE Forge extraction failed: ${res.message}`);
        setResult(res);
      }
    } catch (err) {
      setIsExtracting(false);
      const msg = err instanceof Error ? err.message : String(err);
      log('error', `OpenCE Forge extraction error: ${msg}`);
      setResult({ ok: false, code: 'ERROR', message: msg });
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        fontFamily: 'var(--ui-font)',
      }}
    >
      <div
        style={{
          width: 820,
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
          overflow: 'hidden',
          color: 'var(--text-primary)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-panel-header)',
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Extract to OpenCE Forge</span>
              <span
                style={{
                  fontSize: 10,
                  padding: '2px 6px',
                  background: 'rgba(74, 222, 128, 0.15)',
                  color: '#4ade80',
                  borderRadius: 4,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                }}
              >
                FORGE READY
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
              Exports standalone containers with embedded 3D gbxmodel vertices, triangle strips & catalog metadata.
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isExtracting}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dim)',
              fontSize: 18,
              cursor: isExtracting ? 'default' : 'pointer',
              padding: '0 4px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        {result ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            {result.ok ? (
              <>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🎉</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#4ade80', marginBottom: 8 }}>
                  Exported Successfully for OpenCE Forge!
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 20 }}>
                  Wrote {result.tagCount} item(s) ({(result.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB) to:
                  <div style={{ fontFamily: 'monospace', margin: '8px 0', wordBreak: 'break-all', color: 'var(--text-primary)' }}>
                    {result.outputPath}
                  </div>
                  Items are immediately usable in Forge with automatic <code style={{ color: '#60a5fa' }}>[C]</code> catalog palette prefixes.
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#f87171', marginBottom: 8 }}>
                  Export Failed
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 20 }}>
                  {result.message}
                </div>
              </>
            )}
            <button
              onClick={onClose}
              style={{
                padding: '8px 24px',
                background: 'var(--btn-primary-bg)',
                color: 'var(--btn-primary-text)',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              Close
            </button>
          </div>
        ) : isExtracting ? (
          <div style={{ padding: '40px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{progressStage}</div>
            <div
              style={{
                width: '70%',
                height: 8,
                background: 'var(--border)',
                borderRadius: 4,
                margin: '0 auto 12px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: '100%',
                  background: 'var(--accent)',
                  transition: 'width 0.2s',
                }}
              />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              Capturing gbxmodel part vertices, strip indices, and dependencies ({progressPercent}%)...
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {/* Tabs Bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '6px 12px 0',
                background: 'var(--bg-panel-header)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              {(
                [
                  { id: 'vehi', label: 'Vehicles', count: categorizedTags.vehi.length },
                  { id: 'weap', label: 'Weapons', count: categorizedTags.weap.length },
                  { id: 'eqip', label: 'Equipment', count: categorizedTags.eqip.length },
                  { id: 'scen', label: 'Scenery', count: categorizedTags.scen.length },
                  { id: 'devices', label: 'Devices & Lights', count: categorizedTags.devices.length },
                  { id: 'selected', label: `Selected Items (${selectedIndices.size})`, count: selectedIndices.size },
                ] as const
              ).map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    style={{
                      padding: '8px 14px',
                      background: isActive ? 'var(--bg-panel)' : 'transparent',
                      color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                      border: 'none',
                      borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                      fontWeight: isActive ? 600 : 500,
                      cursor: 'pointer',
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span>{tab.label}</span>
                    <span
                      style={{
                        fontSize: 10,
                        padding: '1px 5px',
                        borderRadius: 8,
                        background: isActive ? 'var(--accent)' : 'var(--border)',
                        color: isActive ? '#fff' : 'var(--text-dim)',
                      }}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Sub-toolbar: Search & Batch actions */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 16px',
                borderBottom: '1px solid var(--border)',
                background: 'var(--bg-panel)',
                gap: 12,
              }}
            >
              <input
                type="text"
                placeholder="Search tags or Forge names..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  background: 'var(--bg-input, rgba(0,0,0,0.2))',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={handleSelectAllInTab}
                  style={{
                    padding: '4px 10px',
                    fontSize: 11.5,
                    background: 'var(--bg-button, rgba(255,255,255,0.06))',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                  }}
                >
                  Select All
                </button>
                <button
                  onClick={handleDeselectAllInTab}
                  style={{
                    padding: '4px 10px',
                    fontSize: 11.5,
                    background: 'var(--bg-button, rgba(255,255,255,0.06))',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  Deselect All
                </button>
              </div>
            </div>

            {/* Tags List */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '8px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: 420,
              }}
            >
              {displayedTags.length === 0 ? (
                <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12.5 }}>
                  {activeTab === 'selected'
                    ? 'No items selected yet. Choose items from the category tabs above.'
                    : 'No matching tags found in this category.'}
                </div>
              ) : (
                displayedTags.map((tag) => {
                  const isChecked = selectedIndices.has(tag.index);
                  const currentName = itemNames[tag.index] ?? formatItemDefaultName(tag.path);

                  return (
                    <div
                      key={tag.index}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        background: isChecked ? 'rgba(96, 165, 250, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                        border: `1px solid ${isChecked ? 'rgba(96, 165, 250, 0.3)' : 'var(--border)'}`,
                        borderRadius: 4,
                        gap: 12,
                      }}
                    >
                      {/* Checkbox and Tag Path Info */}
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          cursor: 'pointer',
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleTag(tag)}
                          style={{ cursor: 'pointer' }}
                        />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span
                              style={{
                                fontSize: 9.5,
                                padding: '1px 5px',
                                background: 'var(--border)',
                                borderRadius: 3,
                                color: 'var(--text-dim)',
                                textTransform: 'uppercase',
                                fontWeight: 700,
                              }}
                            >
                              {tag.primaryClassName}
                            </span>
                            <span
                              style={{
                                fontSize: 12.5,
                                fontWeight: isChecked ? 600 : 400,
                                color: 'var(--text-primary)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              title={tag.path}
                            >
                              {tag.path}
                            </span>
                          </div>
                        </div>
                      </label>

                      {/* Forge Item Name Input & Preview */}
                      {isChecked && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                              Palette Preview:{' '}
                              <strong style={{ color: '#60a5fa' }}>
                                [C] {currentName.trim().toUpperCase()}
                              </strong>
                            </div>
                          </div>
                          <input
                            type="text"
                            placeholder="In Forge Name"
                            value={currentName}
                            onChange={(e) => {
                              const val = e.target.value;
                              setItemNames((prev) => ({ ...prev, [tag.index]: val }));
                            }}
                            style={{
                              width: 170,
                              padding: '4px 8px',
                              background: 'var(--bg-input, rgba(0,0,0,0.3))',
                              border: '1px solid var(--border)',
                              borderRadius: 4,
                              color: 'var(--text-primary)',
                              fontSize: 12,
                              outline: 'none',
                            }}
                            title="Name as it will appear in the Forge Palette"
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer Summary & Action */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 18px',
                borderTop: '1px solid var(--border)',
                background: 'var(--bg-panel-header)',
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {selectedIndices.size === 0 ? (
                  <span>Select items above to export to Forge.</span>
                ) : (
                  <span>
                    <strong>{selectedIndices.size}</strong> item(s) selected for export.
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={onClose}
                  style={{
                    padding: '7px 16px',
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: 12.5,
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleExport}
                  disabled={selectedIndices.size === 0}
                  style={{
                    padding: '7px 20px',
                    background: selectedIndices.size > 0 ? 'var(--btn-primary-bg)' : 'var(--border)',
                    color: selectedIndices.size > 0 ? 'var(--btn-primary-text)' : 'var(--text-dim)',
                    border: 'none',
                    borderRadius: 4,
                    cursor: selectedIndices.size > 0 ? 'pointer' : 'default',
                    fontWeight: 600,
                    fontSize: 12.5,
                  }}
                >
                  Export to OpenCE Forge ({selectedIndices.size})
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
