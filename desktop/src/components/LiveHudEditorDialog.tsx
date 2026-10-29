import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import type {
  LiveHudCatalog,
  LiveHudLevel,
  LiveHudElementItem,
  LiveWeaponStatField,
  OpenMapSummary,
  TagTestStatus,
} from '../../electron/shared-types';

const HUD_ANCHOR_NAMES = ['TOP LEFT', 'TOP RIGHT', 'BOTTOM LEFT', 'BOTTOM RIGHT', 'CENTRE'] as const;

const STAT_CATEGORY_META: Array<{ id: LiveWeaponStatField['category']; label: string }> = [
  { id: 'weapon', label: 'Weapon' },
  { id: 'trigger0', label: 'Primary trigger' },
  { id: 'trigger1', label: 'Secondary trigger' },
  { id: 'magazine0', label: 'Magazine' },
  { id: 'magazine1', label: 'Second magazine' },
  { id: 'projectile0', label: 'Primary projectile' },
  { id: 'projectile1', label: 'Secondary projectile' },
  { id: 'damage_impact0', label: 'Impact damage' },
  { id: 'damage_stuck0', label: 'Stuck / Detonation damage' },
  { id: 'damage_melee', label: 'Melee damage' },
];

type MenuPage =
  | { kind: 'root' }
  | { kind: 'hud_level'; levelIndex: number }
  | { kind: 'weapon_stats_root' }
  | { kind: 'weapon_stats_cat'; category: LiveWeaponStatField['category']; label: string };

interface DecodedSpriteCacheEntry {
  image: HTMLImageElement;
  width: number;
  height: number;
  sprites: Array<{ left: number; right: number; top: number; bottom: number; regX: number; regY: number }>;
}

interface LiveHudEditorDialogProps {
  open: boolean;
  onClose: () => void;
  onMapUpdated?: (map: OpenMapSummary) => void;
  onOpenBitmapInjector?: (initialSelection?: {
    category: 'weapon' | 'vehicle' | 'general';
    targetTagIndex?: number;
    hudTagIndex?: number;
    elementId?: string;
  }) => void;
  onOpenUiMapStudio?: () => void;
  tagTestStatus?: TagTestStatus;
  onLaunchTagTest?: () => void;
}

function argbToCss(argb: number, alphaOverride?: number): string {
  const a = alphaOverride !== undefined ? alphaOverride : Math.max(0.35, ((argb >>> 24) & 0xff) / 255);
  const r = (argb >>> 16) & 0xff;
  const g = (argb >>> 8) & 0xff;
  const b = argb & 0xff;
  if (r === 0 && g === 0 && b === 0) {
    return `rgba(76, 201, 240, ${a})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function computeAnchorOrigin(
  anchorIndex: number,
  canvasW: number,
  canvasH: number,
): { ax: number; ay: number } {
  switch (anchorIndex) {
    case 0: // TOP LEFT
      return { ax: 36, ay: 32 };
    case 1: // TOP RIGHT
      return { ax: canvasW - 36, ay: 32 };
    case 2: // BOTTOM LEFT
      return { ax: 36, ay: canvasH - 32 };
    case 3: // BOTTOM RIGHT
      return { ax: canvasW - 36, ay: canvasH - 32 };
    case 4: // CENTRE
    default:
      return { ax: canvasW / 2, ay: canvasH / 2 };
  }
}

export const LiveHudEditorDialog: React.FC<LiveHudEditorDialogProps> = ({
  open,
  onClose,
  onMapUpdated,
  onOpenBitmapInjector,
  onOpenUiMapStudio,
  tagTestStatus,
  onLaunchTagTest,
}) => {
  const [catalog, setCatalog] = useState<LiveHudCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusToast, setStatusToast] = useState<string | null>(null);

  // Target selection: weapon, vehicle, unitHud, or globalHud
  const [targetType, setTargetType] = useState<'weapon' | 'vehicle' | 'unit' | 'global'>('weapon');
  const [selectedTargetIdx, setSelectedTargetIdx] = useState<number>(0);

  // Authentic Halo CE Menu Navigation Stack
  const [menuVisible, setMenuVisible] = useState(true);
  const [pageStack, setPageStack] = useState<MenuPage[]>([{ kind: 'root' }]);
  const [selectedRow, setSelectedRow] = useState<number>(0);

  // Scope for shared wphi tags ("THIS ONE" vs "ALL")
  const [editScope, setEditScope] = useState<'this_one' | 'all'>('this_one');

  // Interactive Capture Mode (matching tag_editor.c hud_capturing)
  const [captureElementId, setCaptureElementId] = useState<string | null>(null);
  const [captureScalingMode, setCaptureScalingMode] = useState(false);
  const [blinkUntil, setBlinkUntil] = useState<number>(0);
  const [blinkTick, setBlinkTick] = useState<number>(0);

  // Snapshot of initial element & stat values for Backspace / "Reset HUD" / "Reset weapon"
  const initialElementSnapshots = useRef<
    Map<string, { x: number; y: number; scaleX: number; scaleY: number; hidden: boolean; anchorIndex: number }>
  >(new Map());
  const initialStatSnapshots = useRef<Map<string, number>>(new Map());

  // Canvas & decoded bitmap sprite cache
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [aspectMode, setAspectMode] = useState<'4:3' | '16:9'>('4:3');
  const [showUnitOverlayOnWeapon, setShowUnitOverlayOnWeapon] = useState(true);
  const [autoHotReload, setAutoHotReload] = useState(false);
  const spriteCacheRef = useRef<Map<number, DecodedSpriteCacheEntry>>(new Map());
  const [spriteCacheVersion, setSpriteCacheVersion] = useState(0);

  // Dragging state on canvas
  const dragStateRef = useRef<{
    element: LiveHudElementItem;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const loadCatalog = useCallback(async (preserveSnapshots = false) => {
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

      if (!preserveSnapshots) {
        initialElementSnapshots.current.clear();
        initialStatSnapshots.current.clear();
        const recordLevels = (levels: LiveHudLevel[]) => {
          for (const lvl of levels) {
            for (const el of lvl.elements) {
              const key = `${lvl.hudTagIndex}:${el.id}`;
              if (!initialElementSnapshots.current.has(key)) {
                initialElementSnapshots.current.set(key, {
                  x: el.x,
                  y: el.y,
                  scaleX: el.scaleX,
                  scaleY: el.scaleY,
                  hidden: el.hidden,
                  anchorIndex: lvl.anchorIndex,
                });
              }
            }
          }
        };
        res.catalog.weapons.forEach((w) => {
          recordLevels(w.hudChain);
          w.stats.forEach((st) => {
            const sk = `${w.tagIndex}:${st.key}`;
            if (!initialStatSnapshots.current.has(sk)) {
              initialStatSnapshots.current.set(sk, st.value);
            }
          });
        });
        res.catalog.vehicles.forEach((v) => {
          if (v.unitHud) recordLevels([v.unitHud]);
          recordLevels(v.weaponHudChain);
        });
        recordLevels(res.catalog.unitHuds);
        recordLevels(res.catalog.globalHuds);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      spriteCacheRef.current.clear();
      void loadCatalog(false);
      setPageStack([{ kind: 'root' }]);
      setSelectedRow(0);
      setCaptureElementId(null);
      setMenuVisible(true);
    }
  }, [open, loadCatalog]);

  // Blink timer during 1.2s after entering Capture Mode
  useEffect(() => {
    if (!open || Date.now() >= blinkUntil) return;
    const timer = window.setInterval(() => {
      setBlinkTick((t) => t + 1);
      if (Date.now() >= blinkUntil) {
        window.clearInterval(timer);
      }
    }, 180);
    return () => window.clearInterval(timer);
  }, [open, blinkUntil]);

  // Active target resolution
  const activeWeapon = useMemo(() => {
    if (!catalog || targetType !== 'weapon') return null;
    return catalog.weapons[Math.min(selectedTargetIdx, Math.max(0, catalog.weapons.length - 1))] ?? null;
  }, [catalog, targetType, selectedTargetIdx]);

  const activeVehicle = useMemo(() => {
    if (!catalog || targetType !== 'vehicle') return null;
    return catalog.vehicles[Math.min(selectedTargetIdx, Math.max(0, catalog.vehicles.length - 1))] ?? null;
  }, [catalog, targetType, selectedTargetIdx]);

  const activeHudChain: LiveHudLevel[] = useMemo(() => {
    if (!catalog) return [];
    if (targetType === 'weapon' && activeWeapon) {
      return activeWeapon.hudChain;
    }
    if (targetType === 'vehicle' && activeVehicle) {
      const list: LiveHudLevel[] = [];
      if (activeVehicle.unitHud) list.push(activeVehicle.unitHud);
      list.push(...activeVehicle.weaponHudChain);
      return list;
    }
    if (targetType === 'unit') {
      const u = catalog.unitHuds[Math.min(selectedTargetIdx, Math.max(0, catalog.unitHuds.length - 1))];
      return u ? [u] : [];
    }
    if (targetType === 'global') {
      const g = catalog.globalHuds[Math.min(selectedTargetIdx, Math.max(0, catalog.globalHuds.length - 1))];
      return g ? [g] : [];
    }
    return [];
  }, [catalog, targetType, activeWeapon, activeVehicle, selectedTargetIdx]);

  // Decode referenced bitmaps for all visible HUD elements into HTMLImageElements
  useEffect(() => {
    if (!open || !catalog) return;
    const levelsToDecode = [...activeHudChain];
    if (showUnitOverlayOnWeapon && catalog.unitHuds[0] && targetType === 'weapon') {
      levelsToDecode.push(catalog.unitHuds[0]);
    }
    if (showUnitOverlayOnWeapon && catalog.globalHuds[0] && targetType === 'weapon') {
      levelsToDecode.push(catalog.globalHuds[0]);
    }

    const neededBitmIndices = new Set<number>();
    for (const lvl of levelsToDecode) {
      for (const el of lvl.elements) {
        if (el.bitmapTagIndex !== null && !spriteCacheRef.current.has(el.bitmapTagIndex)) {
          neededBitmIndices.add(el.bitmapTagIndex);
        }
      }
    }
    if (neededBitmIndices.size === 0) return;

    let cancelled = false;
    (async () => {
      for (const bitmIdx of neededBitmIndices) {
        if (cancelled) break;
        try {
          const [infoRes, rgbaRes] = await Promise.all([
            window.opence.getBitmapInfo(bitmIdx),
            window.opence.getBitmapRgba(bitmIdx, 0),
          ]);
          if (cancelled || !rgbaRes.ok || !rgbaRes.dataUrl) continue;

          const baseImg = new Image();
          baseImg.src = rgbaRes.dataUrl;
          await new Promise<void>((resolve) => {
            baseImg.onload = () => resolve();
            baseImg.onerror = () => resolve();
          });

          const w = rgbaRes.width ?? baseImg.width ?? 64;
          const h = rgbaRes.height ?? baseImg.height ?? 64;
          const offCanvas = document.createElement('canvas');
          offCanvas.width = w;
          offCanvas.height = h;
          const ctx = offCanvas.getContext('2d');
          if (!ctx) continue;

          ctx.drawImage(baseImg, 0, 0);
          const imgData = ctx.getImageData(0, 0, w, h);
          const src = imgData.data;
          let anyAlpha = false;
          for (let i = 3; i < src.length; i += 4) {
            if (src[i] > 8) {
              anyAlpha = true;
              break;
            }
          }
          if (!anyAlpha) {
            for (let i = 0; i < src.length; i += 4) {
              src[i + 3] = Math.max(src[i], src[i + 1], src[i + 2]);
            }
            ctx.putImageData(imgData, 0, 0);
          }

          const sprites: DecodedSpriteCacheEntry['sprites'] = [];
          if (infoRes.ok && infoRes.summary) {
            const seqs = (infoRes.summary as unknown as {
              sequences?: Array<{
                sprites?: Array<{
                  left: number;
                  right: number;
                  top: number;
                  bottom: number;
                  registrationPoint?: [number, number];
                }>;
              }>;
            }).sequences ?? [];
            for (const seq of seqs) {
              if (seq.sprites && seq.sprites.length > 0) {
                const sp = seq.sprites[0];
                sprites.push({
                  left: sp.left,
                  right: sp.right,
                  top: sp.top,
                  bottom: sp.bottom,
                  regX: sp.registrationPoint?.[0] ?? 0,
                  regY: sp.registrationPoint?.[1] ?? 0,
                });
              }
            }
          }

          const img = new Image();
          img.src = offCanvas.toDataURL('image/png');
          await new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
          });
          spriteCacheRef.current.set(bitmIdx, {
            image: img,
            width: w,
            height: h,
            sprites,
          });
          if (!cancelled) setSpriteCacheVersion((v) => v + 1);
        } catch {
          // ignore decode error
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, catalog, activeHudChain, showUnitOverlayOnWeapon, targetType]);

  // Currently captured HUD element (if in Capture Mode)
  const capturedElement: { level: LiveHudLevel; element: LiveHudElementItem } | null = useMemo(() => {
    if (!captureElementId) return null;
    for (const lvl of activeHudChain) {
      const found = lvl.elements.find((e) => e.id === captureElementId);
      if (found) return { level: lvl, element: found };
    }
    return null;
  }, [captureElementId, activeHudChain]);

  // Helper to commit a live HUD edit
  const commitHudEdit = useCallback(
    async (
      level: LiveHudLevel,
      patch: {
        editType: 'anchor' | 'element';
        anchorIndex?: number;
        element?: LiveHudElementItem;
        x?: number;
        y?: number;
        scaleX?: number;
        scaleY?: number;
        hidden?: boolean;
      },
    ) => {
      if (!window.opence.applyLiveHudEdit) return;
      const el = patch.element;
      const res = await window.opence.applyLiveHudEdit({
        hudTagIndex: level.hudTagIndex,
        ownerWeaponTagIndex: targetType === 'weapon' && activeWeapon ? activeWeapon.tagIndex : undefined,
        hudLevel: level.level,
        scope: editScope,
        editType: patch.editType,
        anchorIndex: patch.anchorIndex,
        offsetFieldPath: el?.offsetFieldPath,
        scaleXFieldPath: el?.scaleXFieldPath,
        scaleYFieldPath: el?.scaleYFieldPath,
        visibilityFieldPath: el?.visibilityFieldPath,
        visibilityMode: el?.visibilityMode,
        x: patch.x ?? el?.x,
        y: patch.y ?? el?.y,
        scaleX: patch.scaleX ?? el?.scaleX,
        scaleY: patch.scaleY ?? el?.scaleY,
        hidden: patch.hidden,
        rawVisibilityValue: el?.rawVisibilityValue,
      });
      if (res.ok) {
        setCatalog(res.catalog);
        onMapUpdated?.(res.map);
        if (autoHotReload && tagTestStatus?.state === 'running') {
          void window.opence.tagTestHotReload();
        }
      } else {
        setStatusToast(`Edit failed: ${res.message}`);
      }
    },
    [targetType, activeWeapon, editScope, onMapUpdated, autoHotReload, tagTestStatus],
  );

  // Helper to commit a live weapon stat edit
  const commitStatEdit = useCallback(
    async (field: LiveWeaponStatField, newValue: number) => {
      if (!window.opence.applyLiveWeaponStatEdit) return;
      const clamped = Math.max(field.min, Math.min(field.max, Number(newValue.toFixed(4))));
      // Optimistically update local catalog state for instant 60fps spinner feedback
      setCatalog((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          weapons: prev.weapons.map((w) => ({
            ...w,
            stats: w.stats.map((st) =>
              st.targetTagIndex === field.targetTagIndex && st.key === field.key
                ? { ...st, value: clamped }
                : st,
            ),
          })),
        };
      });
      const res = await window.opence.applyLiveWeaponStatEdit({
        targetTagIndex: field.targetTagIndex,
        fieldPath: field.fieldPath,
        boundsIndex: field.boundsIndex,
        value: clamped,
        conversion: field.conversion,
      });
      if (res.ok) {
        onMapUpdated?.(res.map);
        if (autoHotReload && tagTestStatus?.state === 'running') {
          void window.opence.tagTestHotReload();
        }
      }
    },
    [onMapUpdated, autoHotReload, tagTestStatus],
  );

  // Build rows for the current Halo CE menu page
  const currentPage = pageStack[pageStack.length - 1] ?? { kind: 'root' };

  interface HaloMenuRow {
    id: string;
    label: string;
    valueText?: string;
    isFolder?: boolean;
    onEnter?: () => void;
    onLeft?: (stepMult: number) => void;
    onRight?: (stepMult: number) => void;
    elementRef?: { level: LiveHudLevel; element: LiveHudElementItem };
  }

  const targetList = useMemo(() => {
    if (!catalog) return [];
    if (targetType === 'weapon') return catalog.weapons.map((w) => ({ label: w.displayName, path: w.path, tagIndex: w.tagIndex }));
    if (targetType === 'vehicle') return catalog.vehicles.map((v) => ({ label: v.displayName, path: v.path, tagIndex: v.tagIndex }));
    if (targetType === 'unit') return catalog.unitHuds.map((u) => ({ label: u.title, path: u.hudTagPath, tagIndex: u.hudTagIndex }));
    return catalog.globalHuds.map((g) => ({ label: g.title, path: g.hudTagPath, tagIndex: g.hudTagIndex }));
  }, [catalog, targetType]);

  const currentTargetName = targetList[selectedTargetIdx]?.label ?? 'None';

  const menuRows: HaloMenuRow[] = useMemo(() => {
    if (!catalog) return [];

    if (currentPage.kind === 'root') {
      const rows: HaloMenuRow[] = [
        {
          id: 'target_type',
          label: 'Category',
          valueText:
            targetType === 'weapon'
              ? 'WEAPONS'
              : targetType === 'vehicle'
                ? 'VEHICLES'
                : targetType === 'unit'
                  ? 'UNIT HUDS'
                  : 'GLOBAL HUD',
          onLeft: () => {
            const order: Array<typeof targetType> = ['weapon', 'vehicle', 'unit', 'global'];
            const next = order[(order.indexOf(targetType) + order.length - 1) % order.length];
            setTargetType(next);
            setSelectedTargetIdx(0);
          },
          onRight: () => {
            const order: Array<typeof targetType> = ['weapon', 'vehicle', 'unit', 'global'];
            const next = order[(order.indexOf(targetType) + 1) % order.length];
            setTargetType(next);
            setSelectedTargetIdx(0);
          },
        },
        {
          id: 'active_item',
          label: 'Active Target',
          valueText: currentTargetName,
          onLeft: () => {
            if (targetList.length === 0) return;
            setSelectedTargetIdx((i) => (i + targetList.length - 1) % targetList.length);
          },
          onRight: () => {
            if (targetList.length === 0) return;
            setSelectedTargetIdx((i) => (i + 1) % targetList.length);
          },
        },
      ];

      if (activeHudChain.length > 0) {
        rows.push({
          id: 'enter_hud',
          label: 'HUD',
          valueText: `${activeHudChain[0].elements.length} elements`,
          isFolder: true,
          onEnter: () => {
            setPageStack((s) => [...s, { kind: 'hud_level', levelIndex: 0 }]);
            setSelectedRow(0);
          },
        });
      }

      if (targetType === 'weapon' && activeWeapon) {
        rows.push({
          id: 'enter_weapon_stats',
          label: 'Weapon stats',
          valueText: `${activeWeapon.stats.length} fields`,
          isFolder: true,
          onEnter: () => {
            setPageStack((s) => [...s, { kind: 'weapon_stats_root' }]);
            setSelectedRow(0);
          },
        });
      }

      rows.push({
        id: 'inject_hud_bitmap',
        label: 'Inject HUD Bitmap...',
        isFolder: true,
        onEnter: () => {
          onOpenBitmapInjector?.({
            category: targetType === 'weapon' ? 'weapon' : targetType === 'vehicle' ? 'vehicle' : 'general',
            targetTagIndex: targetList[selectedTargetIdx]?.tagIndex,
            hudTagIndex: activeHudChain[0]?.hudTagIndex,
          });
        },
      });

      if (catalog.uiWidgets.length > 0 || catalog.unicodeStringLists.length > 0) {
        rows.push({
          id: 'open_ui_studio',
          label: 'UI.map Menu & String Studio...',
          isFolder: true,
          onEnter: () => {
            onOpenUiMapStudio?.();
          },
        });
      }

      return rows;
    }

    if (currentPage.kind === 'hud_level') {
      const level = activeHudChain[currentPage.levelIndex];
      if (!level) return [];
      const rows: HaloMenuRow[] = [];

      // If there is a parent HUD level (e.g. Parent HUD 1..N in wphi chain, or weapon HUD on vehicle)
      if (currentPage.levelIndex + 1 < activeHudChain.length) {
        const nextLvl = activeHudChain[currentPage.levelIndex + 1];
        rows.push({
          id: `parent_hud_${currentPage.levelIndex + 1}`,
          label: nextLvl.title,
          isFolder: true,
          onEnter: () => {
            setPageStack((s) => [...s, { kind: 'hud_level', levelIndex: currentPage.levelIndex + 1 }]);
            setSelectedRow(0);
          },
        });
      }

      // If this wphi is shared by multiple weapons, show Ultimate Edition's "Edits apply to: THIS ONE / ALL"
      if (level.sharedByPaths.length > 0 && level.level === 0 && targetType === 'weapon') {
        rows.push({
          id: 'hud_scope',
          label: 'Edits apply to',
          valueText: editScope === 'this_one' ? 'THIS ONE' : 'ALL',
          onLeft: () => setEditScope((s) => (s === 'this_one' ? 'all' : 'this_one')),
          onRight: () => setEditScope((s) => (s === 'this_one' ? 'all' : 'this_one')),
        });
      }

      // Anchor row
      rows.push({
        id: 'hud_anchor',
        label: 'Anchor',
        valueText: level.anchorName,
        onLeft: () => {
          const nextAnchor = (level.anchorIndex + HUD_ANCHOR_NAMES.length - 1) % HUD_ANCHOR_NAMES.length;
          void commitHudEdit(level, { editType: 'anchor', anchorIndex: nextAnchor });
        },
        onRight: () => {
          const nextAnchor = (level.anchorIndex + 1) % HUD_ANCHOR_NAMES.length;
          void commitHudEdit(level, { editType: 'anchor', anchorIndex: nextAnchor });
        },
      });

      // Individual HUD element rows (Static, Meter, Number, Crosshair, Overlay)
      for (const el of level.elements) {
        rows.push({
          id: el.id,
          label: el.label,
          valueText: el.hidden ? 'HIDDEN' : `${el.x}, ${el.y}`,
          elementRef: { level, element: el },
          onEnter: () => {
            setCaptureElementId(el.id);
            setCaptureScalingMode(false);
            setBlinkUntil(Date.now() + 1200);
          },
          onLeft: () => {
            void commitHudEdit(level, {
              editType: 'element',
              element: el,
              hidden: !el.hidden,
            });
          },
          onRight: () => {
            void commitHudEdit(level, {
              editType: 'element',
              element: el,
              hidden: !el.hidden,
            });
          },
        });
      }

      // Reset HUD row
      rows.push({
        id: 'reset_hud',
        label: 'Reset HUD',
        onEnter: async () => {
          for (const el of level.elements) {
            const snap = initialElementSnapshots.current.get(`${level.hudTagIndex}:${el.id}`);
            if (snap) {
              await commitHudEdit(level, {
                editType: 'element',
                element: el,
                x: snap.x,
                y: snap.y,
                scaleX: snap.scaleX,
                scaleY: snap.scaleY,
                hidden: snap.hidden,
              });
            }
          }
          const firstEl = level.elements[0];
          const firstSnap = firstEl
            ? initialElementSnapshots.current.get(`${level.hudTagIndex}:${firstEl.id}`)
            : undefined;
          if (firstSnap) {
            await commitHudEdit(level, { editType: 'anchor', anchorIndex: firstSnap.anchorIndex });
          }
          setStatusToast(`Reset ${level.title} to initial snapshot.`);
        },
      });

      return rows;
    }

    if (currentPage.kind === 'weapon_stats_root' && activeWeapon) {
      const rows: HaloMenuRow[] = [];
      for (const cat of STAT_CATEGORY_META) {
        const count = activeWeapon.stats.filter((s) => s.category === cat.id).length;
        if (count > 0) {
          rows.push({
            id: `cat_${cat.id}`,
            label: cat.label,
            valueText: `${count}`,
            isFolder: true,
            onEnter: () => {
              setPageStack((s) => [...s, { kind: 'weapon_stats_cat', category: cat.id, label: cat.label }]);
              setSelectedRow(0);
            },
          });
        }
      }
      rows.push({
        id: 'reset_weapon_stats',
        label: 'Reset weapon',
        onEnter: async () => {
          for (const st of activeWeapon.stats) {
            const orig = initialStatSnapshots.current.get(`${activeWeapon.tagIndex}:${st.key}`);
            if (orig !== undefined && orig !== st.value) {
              await commitStatEdit(st, orig);
            }
          }
          setStatusToast(`Reset ${activeWeapon.displayName} stats to initial values.`);
        },
      });
      return rows;
    }

    if (currentPage.kind === 'weapon_stats_cat' && activeWeapon) {
      const catStats = activeWeapon.stats.filter((s) => s.category === currentPage.category);
      return catStats.map((st) => ({
        id: st.key,
        label: st.label,
        valueText: `${Number.isInteger(st.step) ? Math.round(st.value) : st.value.toFixed(2)}${st.unit ? ` ${st.unit}` : ''}`,
        onLeft: (mult) => {
          void commitStatEdit(st, st.value - st.step * mult);
        },
        onRight: (mult) => {
          void commitStatEdit(st, st.value + st.step * mult);
        },
        onEnter: () => {
          const orig = initialStatSnapshots.current.get(`${activeWeapon.tagIndex}:${st.key}`);
          if (orig !== undefined) {
            void commitStatEdit(st, orig);
          }
        },
      }));
    }

    return [];
  }, [
    catalog,
    currentPage,
    targetType,
    currentTargetName,
    targetList,
    selectedTargetIdx,
    activeHudChain,
    activeWeapon,
    editScope,
    commitHudEdit,
    commitStatEdit,
    onOpenBitmapInjector,
    onOpenUiMapStudio,
  ]);

  // Clamp selectedRow when menuRows changes
  useEffect(() => {
    if (selectedRow >= menuRows.length && menuRows.length > 0) {
      setSelectedRow(menuRows.length - 1);
    }
  }, [menuRows.length, selectedRow]);

  // Keyboard navigation matching Ultimate Edition's tag_editor.c!
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // '|' or '\' key toggles the Halo CE menu overlay open/closed
      if (e.key === '|' || e.key === '\\') {
        e.preventDefault();
        if (captureElementId) {
          setCaptureElementId(null);
        } else {
          setMenuVisible((v) => !v);
        }
        return;
      }

      // If in Capture Mode (moving or scaling a HUD element with unobstructed 4 corners)
      if (capturedElement) {
        const { level, element } = capturedElement;
        const fastMult = e.shiftKey || e.repeat ? 4 : 1;

        if (e.key === 'Escape') {
          e.preventDefault();
          setCaptureElementId(null);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          setCaptureScalingMode((s) => !s);
          return;
        }
        if (e.key === 'Backspace') {
          e.preventDefault();
          const snap = initialElementSnapshots.current.get(`${level.hudTagIndex}:${element.id}`);
          if (snap) {
            void commitHudEdit(level, {
              editType: 'element',
              element,
              x: snap.x,
              y: snap.y,
              scaleX: snap.scaleX,
              scaleY: snap.scaleY,
              hidden: snap.hidden,
            });
          }
          return;
        }

        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
          e.preventDefault();
          if (!captureScalingMode) {
            const dx = e.key === 'ArrowLeft' ? -1 * fastMult : e.key === 'ArrowRight' ? 1 * fastMult : 0;
            const dy = e.key === 'ArrowUp' ? -1 * fastMult : e.key === 'ArrowDown' ? 1 * fastMult : 0;
            void commitHudEdit(level, {
              editType: 'element',
              element,
              x: element.x + dx,
              y: element.y + dy,
            });
          } else {
            const step = 0.02 * fastMult;
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              const dir = e.key === 'ArrowUp' ? 1 : -1;
              void commitHudEdit(level, {
                editType: 'element',
                element,
                scaleX: Number(Math.max(0.1, Math.min(8.0, element.scaleX + dir * step)).toFixed(2)),
                scaleY: Number(Math.max(0.1, Math.min(8.0, element.scaleY + dir * step)).toFixed(2)),
              });
            } else {
              const dir = e.key === 'ArrowRight' ? 1 : -1;
              void commitHudEdit(level, {
                editType: 'element',
                element,
                scaleX: Number(Math.max(0.1, Math.min(8.0, element.scaleX + dir * step)).toFixed(2)),
              });
            }
          }
        }
        return;
      }

      if (!menuVisible) return;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedRow((r) => (menuRows.length > 0 ? (r + menuRows.length - 1) % menuRows.length : 0));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedRow((r) => (menuRows.length > 0 ? (r + 1) % menuRows.length : 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        menuRows[selectedRow]?.onEnter?.();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        menuRows[selectedRow]?.onLeft?.(e.shiftKey ? 10 : 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        menuRows[selectedRow]?.onRight?.(e.shiftKey ? 10 : 1);
      } else if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        if (pageStack.length > 1) {
          setPageStack((s) => s.slice(0, -1));
          setSelectedRow(0);
        } else if (e.key === 'Escape') {
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    open,
    captureElementId,
    capturedElement,
    captureScalingMode,
    menuVisible,
    menuRows,
    selectedRow,
    pageStack.length,
    commitHudEdit,
    onClose,
  ]);

  // Render the interactive Halo CE 640x480 / 854x480 HUD canvas
  const canvasWidth = aspectMode === '16:9' ? 854 : 640;
  const canvasHeight = 480;

  // Store screen bounding boxes for mouse click / drag hit-testing
  const renderedRectsRef = useRef<
    Array<{
      level: LiveHudLevel;
      element: LiveHudElementItem;
      x: number;
      y: number;
      w: number;
      h: number;
    }>
  >([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // 1. Simulated Halo CE Blood Gulch / Canyon environment backdrop so bright cyan/blue HUD elements pop clearly
    const skyGrad = ctx.createLinearGradient(0, 0, 0, canvasHeight * 0.56);
    skyGrad.addColorStop(0, '#0b1829');
    skyGrad.addColorStop(0.6, '#1c3552');
    skyGrad.addColorStop(1, '#365875');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight * 0.56);

    const groundGrad = ctx.createLinearGradient(0, canvasHeight * 0.56, 0, canvasHeight);
    groundGrad.addColorStop(0, '#3a3228');
    groundGrad.addColorStop(0.4, '#2a2620');
    groundGrad.addColorStop(1, '#14120f');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, canvasHeight * 0.56, canvasWidth, canvasHeight * 0.44);

    // Subtle 4:3 safe-area guides & center crosshair guide lines
    ctx.strokeStyle = 'rgba(40, 150, 255, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(canvasWidth / 2, 0);
    ctx.lineTo(canvasWidth / 2, canvasHeight);
    ctx.moveTo(0, canvasHeight / 2);
    ctx.lineTo(canvasWidth, canvasHeight / 2);
    ctx.stroke();

    if (aspectMode === '16:9') {
      const margin = (canvasWidth - 640) / 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(40, 150, 255, 0.22)';
      ctx.strokeRect(margin, 0, 640, canvasHeight);
      ctx.setLineDash([]);
    }

    const hitRects: typeof renderedRectsRef.current = [];
    const hoveredRowElId = !captureElementId && menuVisible ? menuRows[selectedRow]?.elementRef?.element.id : null;
    const isBlinking = Date.now() < blinkUntil && blinkTick % 2 === 1;

    const drawHudLevel = (lvl: LiveHudLevel, isBackgroundLayer = false) => {
      for (const el of lvl.elements) {
        if (el.hidden) continue;
        if (captureElementId === el.id && isBlinking) continue; // Blink off frame!

        // Crosshairs are always centered in Halo CE
        const anchorToUse = el.kind === 'crosshair' ? 4 : lvl.anchorIndex;
        const { ax, ay } = computeAnchorOrigin(anchorToUse, canvasWidth, canvasHeight);
        const drawX = ax + el.x;
        const drawY = ay + el.y;

        const cached = el.bitmapTagIndex !== null ? spriteCacheRef.current.get(el.bitmapTagIndex) : undefined;
        let w = Math.max(24, 64 * Math.abs(el.scaleX || 1));
        let h = Math.max(18, 32 * Math.abs(el.scaleY || 1));

        ctx.save();
        ctx.globalAlpha = isBackgroundLayer ? 0.55 : 0.92;

        if (el.kind === 'number') {
          w = 46 * Math.abs(el.scaleX || 1);
          h = 22 * Math.abs(el.scaleY || 1);
          ctx.fillStyle = 'rgba(0, 17, 34, 0.65)';
          ctx.strokeStyle = argbToCss(el.defaultColorArgb, 0.85);
          ctx.lineWidth = 1.5;
          ctx.fillRect(drawX - w / 2, drawY - h / 2, w, h);
          ctx.strokeRect(drawX - w / 2, drawY - h / 2, w, h);
          ctx.fillStyle = '#bfe6ff';
          ctx.font = `bold ${Math.max(11, Math.round(14 * (el.scaleY || 1)))}px "Segoe UI", monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('60', drawX, drawY);
        } else if (cached) {
          const sp = cached.sprites[el.sequenceIndex] ?? cached.sprites[0];
          if (sp && sp.right > sp.left && sp.bottom > sp.top) {
            const sx = Math.floor(sp.left * cached.width);
            const sy = Math.floor(sp.top * cached.height);
            const sw = Math.max(1, Math.floor((sp.right - sp.left) * cached.width));
            const sh = Math.max(1, Math.floor((sp.bottom - sp.top) * cached.height));
            w = Math.max(16, sw * Math.abs(el.scaleX || 1));
            h = Math.max(16, sh * Math.abs(el.scaleY || 1));
            ctx.drawImage(cached.image, sx, sy, sw, sh, drawX - w / 2, drawY - h / 2, w, h);
          } else {
            w = Math.max(20, Math.min(220, cached.width) * Math.abs(el.scaleX || 1));
            h = Math.max(16, Math.min(140, cached.height) * Math.abs(el.scaleY || 1));
            ctx.drawImage(cached.image, drawX - w / 2, drawY - h / 2, w, h);
          }
        } else {
          // Stylized Halo wireframe HUD box when bitmap is external/undecoded
          ctx.fillStyle = 'rgba(0, 34, 68, 0.55)';
          ctx.strokeStyle = argbToCss(el.defaultColorArgb, 0.85);
          ctx.lineWidth = 1.5;
          ctx.fillRect(drawX - w / 2, drawY - h / 2, w, h);
          ctx.strokeRect(drawX - w / 2, drawY - h / 2, w, h);
          ctx.fillStyle = '#7dd3fc';
          ctx.font = '10px "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(el.bitmapLeaf || el.label.slice(0, 14), drawX, drawY);
        }

        const isSelectedOrCaptured = captureElementId === el.id || hoveredRowElId === el.id;
        if (isSelectedOrCaptured) {
          ctx.strokeStyle = captureElementId === el.id ? '#ffffff' : '#2299ff';
          ctx.lineWidth = 2;
          ctx.strokeRect(drawX - w / 2 - 3, drawY - h / 2 - 3, w + 6, h + 6);

          // Draw corner ticks
          ctx.fillStyle = '#2896ff';
          ctx.fillRect(drawX - w / 2 - 5, drawY - h / 2 - 5, 6, 6);
          ctx.fillRect(drawX + w / 2 - 1, drawY - h / 2 - 5, 6, 6);
          ctx.fillRect(drawX - w / 2 - 5, drawY + h / 2 - 1, 6, 6);
          ctx.fillRect(drawX + w / 2 - 1, drawY + h / 2 - 1, 6, 6);
        }

        ctx.restore();

        if (!isBackgroundLayer) {
          hitRects.push({
            level: lvl,
            element: el,
            x: drawX - w / 2,
            y: drawY - h / 2,
            w,
            h,
          });
        }
      }
    };

    // Draw background Unit HUD & Global HUD layers if previewing a weapon
    if (showUnitOverlayOnWeapon && targetType === 'weapon' && catalog) {
      if (catalog.unitHuds[0]) drawHudLevel(catalog.unitHuds[0], true);
      if (catalog.globalHuds[0]) drawHudLevel(catalog.globalHuds[0], true);
    }

    // Draw active HUD chain (parent levels first, then child level on top)
    for (let i = activeHudChain.length - 1; i >= 0; i--) {
      drawHudLevel(activeHudChain[i], false);
    }

    renderedRectsRef.current = hitRects;
  }, [
    canvasWidth,
    canvasHeight,
    aspectMode,
    activeHudChain,
    catalog,
    targetType,
    showUnitOverlayOnWeapon,
    spriteCacheVersion,
    captureElementId,
    menuVisible,
    menuRows,
    selectedRow,
    blinkUntil,
    blinkTick,
  ]);

  // Canvas mouse down / drag to move HUD elements directly
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;

    // Hit-test topmost element first
    for (let i = renderedRectsRef.current.length - 1; i >= 0; i--) {
      const hit = renderedRectsRef.current[i];
      if (cx >= hit.x - 4 && cx <= hit.x + hit.w + 4 && cy >= hit.y - 4 && cy <= hit.y + hit.h + 4) {
        setCaptureElementId(hit.element.id);
        setCaptureScalingMode(false);
        dragStateRef.current = {
          element: hit.element,
          startClientX: e.clientX,
          startClientY: e.clientY,
          origX: hit.element.x,
          origY: hit.element.y,
        };
        return;
      }
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragStateRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;
    const dx = Math.round((e.clientX - drag.startClientX) * scaleX);
    const dy = Math.round((e.clientY - drag.startClientY) * scaleY);

    const lvl = activeHudChain.find((l) => l.hudTagIndex === drag.element.hudTagIndex);
    if (lvl) {
      void commitHudEdit(lvl, {
        editType: 'element',
        element: drag.element,
        x: drag.origX + dx,
        y: drag.origY + dy,
      });
    }
  };

  const handleCanvasMouseUp = () => {
    dragStateRef.current = null;
  };

  if (!open) return null;

  // Breadcrumb title for the Halo CE menu header
  const headerTitle = (() => {
    if (currentPage.kind === 'root') return `${currentTargetName} — Live Editor`;
    if (currentPage.kind === 'hud_level') {
      const lvl = activeHudChain[currentPage.levelIndex];
      return `${currentTargetName} > ${lvl?.title ?? 'HUD'}`;
    }
    if (currentPage.kind === 'weapon_stats_root') return `${currentTargetName} > Weapon stats`;
    if (currentPage.kind === 'weapon_stats_cat') return `${currentTargetName} > ${currentPage.label}`;
    return 'Live HUD Editor';
  })();

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(2, 6, 14, 0.88)',
        zIndex: 9500,
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
        fontFamily: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
      }}
    >
      {/* Top Control Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          backgroundColor: '#001122',
          borderBottom: '2px solid #2896ff',
          color: '#e2e8f0',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              fontWeight: 800,
              fontSize: 14,
              letterSpacing: '0.06em',
              color: '#2896ff',
              textTransform: 'uppercase',
            }}
          >
            🎯 Halo CE Live HUD & Weapon Tag Editor
          </span>
          <span
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 4,
              backgroundColor: 'rgba(40, 150, 255, 0.16)',
              border: '1px solid rgba(40, 150, 255, 0.45)',
              color: '#93c5fd',
            }}
          >
            Press <strong>|</strong> (Pipe / Backslash) to Toggle Menu Overlay
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Aspect Ratio Switcher */}
          <button
            onClick={() => setAspectMode((m) => (m === '4:3' ? '16:9' : '4:3'))}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 5,
              border: '1px solid #2896ff',
              backgroundColor: '#002244',
              color: '#ffffff',
              cursor: 'pointer',
            }}
          >
            Aspect: {aspectMode} ({canvasWidth}×{canvasHeight})
          </button>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              color: '#93c5fd',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={showUnitOverlayOnWeapon}
              onChange={(e) => setShowUnitOverlayOnWeapon(e.target.checked)}
            />
            Show Shield / Motion Tracker Backdrop
          </label>

          <button
            onClick={() =>
              onOpenBitmapInjector?.({
                category: targetType === 'weapon' ? 'weapon' : targetType === 'vehicle' ? 'vehicle' : 'general',
                targetTagIndex: targetList[selectedTargetIdx]?.tagIndex,
                hudTagIndex: activeHudChain[0]?.hudTagIndex,
              })
            }
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 700,
              borderRadius: 5,
              border: '1px solid #38bdf8',
              backgroundColor: 'rgba(14, 116, 144, 0.35)',
              color: '#e0f2fe',
              cursor: 'pointer',
            }}
          >
            🖼️ Inject HUD Bitmap...
          </button>

          {onLaunchTagTest && (
            <button
              onClick={() => {
                if (tagTestStatus?.state === 'running') {
                  void window.opence.tagTestHotReload();
                  setStatusToast('Hot-reloaded HUD & weapon edits into running OpenCE session!');
                } else {
                  onLaunchTagTest();
                }
              }}
              style={{
                padding: '4px 12px',
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 5,
                border: '1px solid #22c55e',
                backgroundColor: tagTestStatus?.state === 'running' ? '#14532d' : '#052e16',
                color: '#86efac',
                cursor: 'pointer',
              }}
            >
              {tagTestStatus?.state === 'running' ? '⚡ Hot-Reload in OpenCE' : '▶ Launch Dev-Mode OpenCE'}
            </button>
          )}

          {tagTestStatus?.state === 'running' && (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                color: '#86efac',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={autoHotReload}
                onChange={(e) => setAutoHotReload(e.target.checked)}
              />
              Auto-Sync
            </label>
          )}

          <button
            onClick={onClose}
            style={{
              padding: '4px 12px',
              fontSize: 11,
              fontWeight: 700,
              borderRadius: 5,
              border: '1px solid #475569',
              backgroundColor: '#1e293b',
              color: '#f8fafc',
              cursor: 'pointer',
            }}
          >
            ✕ Close
          </button>
        </div>
      </div>

      {/* Main Viewport Container */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          backgroundColor: '#050b14',
        }}
      >
        {loading && (
          <div style={{ color: '#2896ff', fontSize: 16, fontWeight: 700 }}>
            Loading open map HUD & weapon catalog...
          </div>
        )}

        {error && (
          <div
            style={{
              padding: 20,
              backgroundColor: '#001122',
              border: '2px solid #ef4444',
              borderRadius: 8,
              color: '#fca5a5',
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && catalog && (
          <div
            style={{
              position: 'relative',
              width: 'min(94vw, calc((100vh - 76px) * ' + (canvasWidth / canvasHeight).toFixed(3) + '))',
              aspectRatio: `${canvasWidth} / ${canvasHeight}`,
              boxShadow: '0 0 40px rgba(0, 0, 0, 0.85), 0 0 0 2px #002244',
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            {/* Interactive Halo HUD Canvas */}
            <canvas
              ref={canvasRef}
              width={canvasWidth}
              height={canvasHeight}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
              style={{
                width: '100%',
                height: '100%',
                display: 'block',
                cursor: captureElementId ? 'move' : 'crosshair',
              }}
            />

            {/* AUTHENTIC HALO CE LEFT 30% MENU PANEL (Hidden during Capture Mode so all 4 corners are unobstructed!) */}
            {menuVisible && !capturedElement && (
              <div
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (pageStack.length > 1) {
                    setPageStack((s) => s.slice(0, -1));
                    setSelectedRow(0);
                  }
                }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  bottom: 0,
                  width: '34%',
                  minWidth: 270,
                  maxWidth: 380,
                  backgroundColor: 'rgba(0, 0, 0, 0.40)',
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '14px 12px',
                  boxSizing: 'border-box',
                }}
              >
                {/* Header Breadcrumb + Back Arrow */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 6px 8px 6px',
                    color: '#2896ff',
                    fontWeight: 700,
                    fontSize: 13,
                    letterSpacing: '0.03em',
                    borderBottom: '2px solid #2896ff',
                    marginBottom: 8,
                  }}
                >
                  {pageStack.length > 1 && (
                    <span
                      onClick={() => {
                        setPageStack((s) => s.slice(0, -1));
                        setSelectedRow(0);
                      }}
                      title="Back (Esc / Backspace / Right-click)"
                      style={{
                        cursor: 'pointer',
                        color: '#ffffff',
                        padding: '0 4px',
                        fontSize: 14,
                      }}
                    >
                      ◄
                    </span>
                  )}
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {headerTitle}
                  </span>
                </div>

                {/* Scrollable Halo CE Rounded Menu Row Bands */}
                <div
                  style={{
                    flex: 1,
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                    paddingRight: 2,
                  }}
                >
                  {menuRows.map((row, idx) => {
                    const isSelected = idx === selectedRow;
                    return (
                      <div
                        key={row.id}
                        onMouseEnter={() => setSelectedRow(idx)}
                        onClick={() => {
                          setSelectedRow(idx);
                          if (row.onEnter) {
                            row.onEnter();
                          } else if (row.onRight) {
                            row.onRight(1);
                          }
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          minHeight: 30,
                          padding: '4px 10px',
                          borderRadius: 8,
                          backgroundColor: isSelected
                            ? 'rgba(0, 34, 68, 0.90)'
                            : 'rgba(0, 17, 34, 0.72)',
                          border: isSelected ? '2px solid #2299ff' : '2px solid transparent',
                          color: isSelected ? '#ffffff' : '#2896ff',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          transition: 'background-color 0.08s ease',
                        }}
                      >
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: row.valueText ? '56%' : '88%',
                          }}
                        >
                          {row.label}
                        </span>

                        {row.isFolder ? (
                          <span style={{ color: isSelected ? '#ffffff' : '#2896ff', fontSize: 11 }}>
                            {row.valueText ? `${row.valueText}  ►` : '►'}
                          </span>
                        ) : row.valueText !== undefined ? (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              color: '#ffffff',
                              fontSize: 12,
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {row.onLeft && (
                              <span
                                onClick={() => row.onLeft?.(1)}
                                style={{
                                  color: '#2896ff',
                                  padding: '0 3px',
                                  cursor: 'pointer',
                                  fontWeight: 900,
                                }}
                              >
                                ◄
                              </span>
                            )}
                            <span
                              onClick={() => row.onEnter?.()}
                              style={{
                                minWidth: 56,
                                textAlign: 'center',
                                color: row.valueText === 'HIDDEN' ? '#f87171' : '#ffffff',
                              }}
                            >
                              {row.valueText}
                            </span>
                            {row.onRight && (
                              <span
                                onClick={() => row.onRight?.(1)}
                                style={{
                                  color: '#2896ff',
                                  padding: '0 3px',
                                  cursor: 'pointer',
                                  fontWeight: 900,
                                }}
                              >
                                ►
                              </span>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {/* Bottom Halo CE Horizontal Rule + Controller/Keyboard Hint Bar */}
                <div
                  style={{
                    borderTop: '2px solid #2896ff',
                    marginTop: 8,
                    paddingTop: 6,
                    color: '#2896ff',
                    fontSize: 11,
                    lineHeight: 1.45,
                  }}
                >
                  <div>↑↓ Select   ◄► Adjust / Hide   (Enter) Open / Move</div>
                  <div>(Esc/Right-Click) Back   (|) Hide Menu</div>
                </div>
              </div>
            )}

            {/* CAPTURE MODE 2-LINE BOTTOM BAR (When an element is captured for unobstructed Move / Scale) */}
            {capturedElement && (
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  bottom: 14,
                  transform: 'translateX(-50%)',
                  backgroundColor: 'rgba(0, 17, 34, 0.88)',
                  border: '2px solid #2299ff',
                  borderRadius: 8,
                  padding: '8px 20px',
                  minWidth: 460,
                  textAlign: 'center',
                  boxShadow: '0 6px 24px rgba(0, 0, 0, 0.75)',
                }}
              >
                <div
                  style={{
                    color: '#ffffff',
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    marginBottom: 3,
                  }}
                >
                  {capturedElement.element.label.toUpperCase()} &nbsp;&nbsp; X {capturedElement.element.x} &nbsp;&nbsp; Y{' '}
                  {capturedElement.element.y} &nbsp;&nbsp; SCALE {capturedElement.element.scaleX.toFixed(2)} x{' '}
                  {capturedElement.element.scaleY.toFixed(2)}
                </div>
                <div style={{ color: '#2896ff', fontSize: 11, fontWeight: 600 }}>
                  {captureScalingMode
                    ? 'Arrows / D-pad: Scale (↑↓ Uniform, ◄► Width)   (Enter/A) Move   (Backspace) Reset   (Esc/B) Done'
                    : 'Arrows / Mouse Drag: Move   (Enter/A) Scale   (Backspace) Reset   (Esc/B) Done'}
                </div>
              </div>
            )}

            {/* Status Toast */}
            {statusToast && (
              <div
                onClick={() => setStatusToast(null)}
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  backgroundColor: 'rgba(0, 34, 68, 0.92)',
                  border: '1px solid #2896ff',
                  color: '#ffffff',
                  padding: '6px 12px',
                  borderRadius: 6,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {statusToast}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
