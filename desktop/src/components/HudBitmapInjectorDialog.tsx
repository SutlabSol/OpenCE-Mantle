import React, { useEffect, useState, useMemo, useCallback } from 'react';
import type {
  LiveHudCatalog,
  LiveHudLevel,
  LiveHudElementItem,
  OpenMapSummary,
  TagTestStatus,
} from '../../electron/shared-types';

interface HudBitmapInjectorDialogProps {
  open: boolean;
  onClose: () => void;
  onMapUpdated?: (map: OpenMapSummary) => void;
  initialSelection?: {
    category?: 'weapon' | 'vehicle' | 'general';
    targetTagIndex?: number;
    hudTagIndex?: number;
    elementId?: string;
  } | null;
  tagTestStatus?: TagTestStatus;
}

export const HudBitmapInjectorDialog: React.FC<HudBitmapInjectorDialogProps> = ({
  open,
  onClose,
  onMapUpdated,
  initialSelection,
  tagTestStatus,
}) => {
  const [catalog, setCatalog] = useState<LiveHudCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Step 1: Category & Target Item (Weapon / Vehicle / General HUD)
  const [category, setCategory] = useState<'weapon' | 'vehicle' | 'general'>('weapon');
  const [selectedItemTagIndex, setSelectedItemTagIndex] = useState<number>(-1);

  // Step 2: Selected HUD Element
  const [selectedElementKey, setSelectedElementKey] = useState<string>('');
  const [currentThumbDataUrl, setCurrentThumbDataUrl] = useState<string | null>(null);
  const [currentBitmapMeta, setCurrentBitmapMeta] = useState<{
    width: number;
    height: number;
    formatName: string;
    imageCount: number;
  } | null>(null);

  // Step 3: Chosen replacement PNG & injection options
  const [replacementPngDataUrl, setReplacementPngDataUrl] = useState<string | null>(null);
  const [replacementFileName, setReplacementFileName] = useState<string>('');
  const [replacementDims, setReplacementDims] = useState<{ width: number; height: number } | null>(null);
  const [cloneDedicatedBitmapTag, setCloneDedicatedBitmapTag] = useState<boolean>(true);
  const [injecting, setInjecting] = useState(false);

  const loadCatalog = useCallback(async () => {
    if (!window.opence.inspectLiveHudCatalog) return;
    setLoading(true);
    setError(null);
    try {
      const res = await window.opence.inspectLiveHudCatalog();
      if (!res.ok) {
        setError(res.message);
        setLoading(false);
        return;
      }
      setCatalog(res.catalog);

      const initCat = initialSelection?.category ?? 'weapon';
      setCategory(initCat);
      if (initCat === 'weapon' && res.catalog.weapons.length > 0) {
        const match = res.catalog.weapons.find((w) => w.tagIndex === initialSelection?.targetTagIndex);
        setSelectedItemTagIndex((match ?? res.catalog.weapons[0]).tagIndex);
      } else if (initCat === 'vehicle' && res.catalog.vehicles.length > 0) {
        const match = res.catalog.vehicles.find((v) => v.tagIndex === initialSelection?.targetTagIndex);
        setSelectedItemTagIndex((match ?? res.catalog.vehicles[0]).tagIndex);
      } else {
        const firstGen = res.catalog.unitHuds[0]?.hudTagIndex ?? res.catalog.globalHuds[0]?.hudTagIndex ?? -1;
        setSelectedItemTagIndex(initialSelection?.targetTagIndex ?? firstGen);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [initialSelection]);

  useEffect(() => {
    if (open) {
      setStatusMessage(null);
      setReplacementPngDataUrl(null);
      setReplacementFileName('');
      setReplacementDims(null);
      void loadCatalog();
    }
  }, [open, loadCatalog]);

  // Available items for Step 1 based on Category
  const categoryItems = useMemo(() => {
    if (!catalog) return [];
    if (category === 'weapon') {
      return catalog.weapons.map((w) => ({
        tagIndex: w.tagIndex,
        label: w.displayName,
        sublabel: w.path,
        levels: w.hudChain,
      }));
    }
    if (category === 'vehicle') {
      return catalog.vehicles.map((v) => {
        const levels: LiveHudLevel[] = [];
        if (v.unitHud) levels.push(v.unitHud);
        levels.push(...v.weaponHudChain);
        return {
          tagIndex: v.tagIndex,
          label: v.displayName,
          sublabel: v.path,
          levels,
        };
      });
    }
    return [
      ...catalog.unitHuds.map((u) => ({
        tagIndex: u.hudTagIndex,
        label: u.title,
        sublabel: u.hudTagPath,
        levels: [u],
      })),
      ...catalog.globalHuds.map((g) => ({
        tagIndex: g.hudTagIndex,
        label: g.title,
        sublabel: g.hudTagPath,
        levels: [g],
      })),
    ];
  }, [catalog, category]);

  const activeItem = useMemo(() => {
    if (categoryItems.length === 0) return null;
    return categoryItems.find((i) => i.tagIndex === selectedItemTagIndex) ?? categoryItems[0];
  }, [categoryItems, selectedItemTagIndex]);

  // Flatten all HUD elements that have a bitmap slot for the selected Weapon/Vehicle/General HUD
  const bitmapElements = useMemo(() => {
    if (!activeItem) return [];
    const list: Array<{ key: string; level: LiveHudLevel; element: LiveHudElementItem }> = [];
    for (const lvl of activeItem.levels) {
      for (const el of lvl.elements) {
        if (el.bitmapFieldPath && el.bitmapTagIndex !== null) {
          list.push({
            key: `${lvl.hudTagIndex}:${el.id}`,
            level: lvl,
            element: el,
          });
        }
      }
    }
    return list;
  }, [activeItem]);

  useEffect(() => {
    if (bitmapElements.length > 0 && !bitmapElements.some((b) => b.key === selectedElementKey)) {
      setSelectedElementKey(bitmapElements[0].key);
    }
  }, [bitmapElements, selectedElementKey]);

  const selectedEntry = useMemo(
    () => bitmapElements.find((b) => b.key === selectedElementKey) ?? bitmapElements[0] ?? null,
    [bitmapElements, selectedElementKey],
  );

  // Load current bitmap preview thumbnail whenever selectedEntry changes
  useEffect(() => {
    const bitmIdx = selectedEntry?.element.bitmapTagIndex ?? null;
    if (bitmIdx === null) {
      setCurrentThumbDataUrl(null);
      setCurrentBitmapMeta(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const [infoRes, rgbaRes] = await Promise.all([
          window.opence.getBitmapInfo(bitmIdx),
          window.opence.getBitmapRgba(bitmIdx, 0),
        ]);
        if (cancelled) return;
        if (infoRes.ok && infoRes.summary && infoRes.summary.images[0]) {
          const img0 = infoRes.summary.images[0];
          setCurrentBitmapMeta({
            width: img0.width,
            height: img0.height,
            formatName: img0.formatName,
            imageCount: infoRes.summary.images.length,
          });
        }
        if (rgbaRes.ok && rgbaRes.dataUrl) {
          setCurrentThumbDataUrl(rgbaRes.dataUrl);
        }
      } catch {
        setCurrentThumbDataUrl(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedEntry]);

  // Handle selecting a replacement PNG image via file input
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReplacementFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      setReplacementPngDataUrl(dataUrl);
      const img = new Image();
      img.onload = () => {
        setReplacementDims({ width: img.width, height: img.height });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleInject = async () => {
    if (!selectedEntry || !replacementPngDataUrl || !window.opence.injectHudElementBitmap) return;
    const { level, element } = selectedEntry;
    if (element.bitmapTagIndex === null || !element.bitmapFieldPath) return;

    setInjecting(true);
    setError(null);
    setStatusMessage(null);
    try {
      const res = await window.opence.injectHudElementBitmap({
        hudTagIndex: level.hudTagIndex,
        bitmapFieldPath: element.bitmapFieldPath,
        bitmapTagIndex: element.bitmapTagIndex,
        imageIndex: 0,
        pngDataUrlOrBuffer: replacementPngDataUrl,
        cloneDedicatedBitmapTag,
      });
      if (!res.ok) {
        setError(res.message);
      } else {
        setCatalog(res.catalog);
        onMapUpdated?.(res.map);
        setStatusMessage(
          `Successfully injected ${res.width}×${res.height} HUD bitmap into "${res.bitmapPath}" (embedded in open .map — bitmaps.map untouched!).`,
        );
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setInjecting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      data-testid="hud-bitmap-injector-dialog"
      style={
        {
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(2, 6, 14, 0.84)',
          zIndex: 9800,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          fontFamily: '"Segoe UI", Tahoma, sans-serif',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties
      }
    >
      <div
        style={
          {
            width: 'min(960px, 95vw)',
            maxHeight: '90vh',
            backgroundColor: '#001122',
            border: '2px solid #2896ff',
            borderRadius: 10,
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.85)',
            display: 'flex',
            flexDirection: 'column',
            color: '#e2e8f0',
            overflow: 'hidden',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties
        }
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 18px',
            backgroundColor: '#002244',
            borderBottom: '2px solid #2896ff',
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#ffffff', letterSpacing: '0.04em' }}>
              🖼️ Guided HUD Bitmap Injector (Map-Local Safe Embedding)
            </div>
            <div style={{ fontSize: 11, color: '#7dd3fc', marginTop: 2 }}>
              Select a Weapon, Vehicle, or Player HUD from the open map to replace its HUD sprite/reticle without modifying bitmaps.map
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '5px 12px',
              backgroundColor: '#001122',
              border: '1px solid #2896ff',
              borderRadius: 6,
              color: '#ffffff',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            ✕ Close
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 18,
            display: 'grid',
            gridTemplateColumns: '1fr 1.15fr 1.15fr',
            gap: 16,
          }}
        >
          {/* STEP 1: Category & Open Map Item */}
          <div
            style={{
              backgroundColor: 'rgba(0, 24, 48, 0.72)',
              border: '1px solid rgba(40, 150, 255, 0.45)',
              borderRadius: 8,
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, color: '#2896ff', textTransform: 'uppercase' }}>
              Step 1 — Choose HUD Category
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(
                [
                  { id: 'weapon', label: '🔫 Weapon HUDs', count: catalog?.weapons.length ?? 0 },
                  { id: 'vehicle', label: '🚙 Vehicle HUDs', count: catalog?.vehicles.length ?? 0 },
                  {
                    id: 'general',
                    label: '🛡️ Player / General HUD',
                    count: (catalog?.unitHuds.length ?? 0) + (catalog?.globalHuds.length ?? 0),
                  },
                ] as const
              ).map((cat) => {
                const active = category === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => {
                      setCategory(cat.id);
                      setSelectedItemTagIndex(-1);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      borderRadius: 7,
                      backgroundColor: active ? '#002244' : '#001122',
                      border: active ? '2px solid #2299ff' : '1px solid rgba(40, 150, 255, 0.25)',
                      color: active ? '#ffffff' : '#2896ff',
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    <span>{cat.label}</span>
                    <span style={{ fontSize: 11, opacity: 0.85 }}>({cat.count})</span>
                  </button>
                );
              })}
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, color: '#93c5fd', marginTop: 4 }}>
              Select {category === 'weapon' ? 'Weapon' : category === 'vehicle' ? 'Vehicle' : 'HUD Interface'} in Open Map:
            </div>

            <div
              style={{
                flex: 1,
                maxHeight: 290,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {categoryItems.map((item) => {
                const isSel = activeItem?.tagIndex === item.tagIndex;
                return (
                  <div
                    key={item.tagIndex}
                    onClick={() => setSelectedItemTagIndex(item.tagIndex)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 6,
                      backgroundColor: isSel ? '#002244' : 'rgba(0, 17, 34, 0.65)',
                      border: isSel ? '2px solid #2299ff' : '1px solid transparent',
                      color: isSel ? '#ffffff' : '#2896ff',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{item.label}</div>
                    <div
                      style={{
                        fontSize: 10,
                        color: isSel ? '#93c5fd' : '#64748b',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.sublabel}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* STEP 2: HUD Element & Bitmap Slot Picker */}
          <div
            style={{
              backgroundColor: 'rgba(0, 24, 48, 0.72)',
              border: '1px solid rgba(40, 150, 255, 0.45)',
              borderRadius: 8,
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, color: '#2896ff', textTransform: 'uppercase' }}>
              Step 2 — Select HUD Bitmap Slot
            </div>

            <div
              style={{
                flex: 1,
                maxHeight: 210,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {bitmapElements.length === 0 ? (
                <div style={{ fontSize: 12, color: '#94a3b8', padding: 8 }}>
                  No HUD bitmap slots found on this item.
                </div>
              ) : (
                bitmapElements.map((item) => {
                  const isSel = selectedEntry?.key === item.key;
                  return (
                    <div
                      key={item.key}
                      onClick={() => setSelectedElementKey(item.key)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 6,
                        backgroundColor: isSel ? '#002244' : 'rgba(0, 17, 34, 0.65)',
                        border: isSel ? '2px solid #2299ff' : '1px solid transparent',
                        color: isSel ? '#ffffff' : '#2896ff',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 6,
                      }}
                    >
                      <div style={{ overflow: 'hidden' }}>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>{item.element.label}</div>
                        <div
                          style={{
                            fontSize: 10,
                            color: isSel ? '#bae6fd' : '#64748b',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.element.bitmapPath}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: 9,
                          padding: '2px 5px',
                          borderRadius: 4,
                          backgroundColor: item.element.bitmapIsExternal
                            ? 'rgba(245, 158, 11, 0.2)'
                            : 'rgba(34, 197, 94, 0.2)',
                          color: item.element.bitmapIsExternal ? '#fcd34d' : '#86efac',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.element.bitmapIsExternal ? 'bitmaps.map' : 'In .map'}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            {/* Current Bitmap Preview Card */}
            {selectedEntry && (
              <div
                style={{
                  backgroundColor: '#001122',
                  border: '1px solid rgba(40, 150, 255, 0.35)',
                  borderRadius: 6,
                  padding: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: '#93c5fd' }}>
                  Current Bitmap Preview ({selectedEntry.element.bitmapLeaf})
                </div>
                <div
                  style={{
                    width: 140,
                    height: 110,
                    backgroundColor: '#050b14',
                    border: '1px solid #1e293b',
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {currentThumbDataUrl ? (
                    <img
                      src={currentThumbDataUrl}
                      alt="Current HUD Bitmap"
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                    />
                  ) : (
                    <span style={{ fontSize: 11, color: '#64748b' }}>No preview</span>
                  )}
                </div>
                {currentBitmapMeta && (
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>
                    {currentBitmapMeta.width}×{currentBitmapMeta.height}px • {currentBitmapMeta.formatName} •{' '}
                    {selectedEntry.element.bitmapIsExternal ? 'External (will internalize into .map)' : 'Map-Local'}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* STEP 3: Import Replacement PNG & Inject into Open Map */}
          <div
            style={{
              backgroundColor: 'rgba(0, 24, 48, 0.72)',
              border: '1px solid rgba(40, 150, 255, 0.45)',
              borderRadius: 8,
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, color: '#2896ff', textTransform: 'uppercase' }}>
              Step 3 — Import PNG & Inject into Open Map
            </div>

            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '14px 10px',
                borderRadius: 8,
                border: '2px dashed #2896ff',
                backgroundColor: 'rgba(0, 34, 68, 0.5)',
                color: '#ffffff',
                cursor: 'pointer',
                textAlign: 'center',
                gap: 4,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700 }}>📂 Choose Replacement .PNG Image...</span>
              <span style={{ fontSize: 10, color: '#93c5fd' }}>
                {replacementFileName || 'Supports any transparent or alpha-masked PNG'}
              </span>
              <input type="file" accept="image/png,image/*" onChange={handleFileChange} style={{ display: 'none' }} />
            </label>

            {replacementPngDataUrl && (
              <div
                style={{
                  backgroundColor: '#001122',
                  border: '1px solid #22c55e',
                  borderRadius: 6,
                  padding: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: '#86efac' }}>
                  New Replacement Image {replacementDims ? `(${replacementDims.width}×${replacementDims.height}px)` : ''}
                </div>
                <img
                  src={replacementPngDataUrl}
                  alt="Replacement HUD"
                  style={{ maxWidth: 140, maxHeight: 96, objectFit: 'contain' }}
                />
              </div>
            )}

            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: 8,
                borderRadius: 6,
                backgroundColor: 'rgba(0, 17, 34, 0.75)',
                border: '1px solid rgba(40, 150, 255, 0.3)',
                fontSize: 11,
                color: '#e2e8f0',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={cloneDedicatedBitmapTag}
                onChange={(e) => setCloneDedicatedBitmapTag(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <div>
                <div style={{ fontWeight: 700, color: '#ffffff' }}>
                  Fork Dedicated Map-Local Bitmap Tag for This HUD Element
                </div>
                <div style={{ fontSize: 10, color: '#93c5fd', marginTop: 2 }}>
                  Recommended when multiple weapons share a sprite sheet (e.g., <code>reticles</code>), so only this HUD element gets the new graphic.
                </div>
              </div>
            </label>

            <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.4 }}>
              🔒 <strong>Safe Map-Local Guarantee:</strong> Pixel data is embedded directly into the currently open{' '}
              <code>.map</code> file buffer. Your shared <code>bitmaps.map</code> file is never modified.
            </div>

            <button
              disabled={!selectedEntry || !replacementPngDataUrl || injecting}
              onClick={handleInject}
              style={{
                marginTop: 'auto',
                padding: '10px 14px',
                borderRadius: 7,
                border: '2px solid #2299ff',
                backgroundColor: !selectedEntry || !replacementPngDataUrl ? '#1e293b' : '#002244',
                color: !selectedEntry || !replacementPngDataUrl ? '#64748b' : '#ffffff',
                fontWeight: 800,
                fontSize: 13,
                cursor: !selectedEntry || !replacementPngDataUrl ? 'not-allowed' : 'pointer',
              }}
            >
              {injecting ? 'Injecting into Open .map...' : '✨ Inject HUD Bitmap into Open Map'}
            </button>

            {tagTestStatus?.state === 'running' && (
              <button
                onClick={() => void window.opence.tagTestHotReload()}
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid #22c55e',
                  backgroundColor: '#14532d',
                  color: '#86efac',
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                ⚡ Hot-Reload in Running OpenCE Session
              </button>
            )}
          </div>
        </div>

        {/* Footer Status / Error Bar */}
        {(statusMessage || error || loading) && (
          <div
            style={{
              padding: '10px 18px',
              backgroundColor: error ? 'rgba(127, 29, 29, 0.85)' : 'rgba(20, 83, 45, 0.85)',
              borderTop: '1px solid #2896ff',
              color: error ? '#fecaca' : '#bbf7d0',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {loading ? 'Inspecting open map HUD bitmaps...' : error || statusMessage}
          </div>
        )}
      </div>
    </div>
  );
};
