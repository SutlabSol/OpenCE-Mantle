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

export const LiveHudEditorDialog: React.FC<LiveHudEditorDialogProps> = ({
  open,
  onClose,
  onMapUpdated,
  onOpenBitmapInjector,
  onOpenUiMapStudio,
}) => {
  const [catalog, setCatalog] = useState<LiveHudCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusToast, setStatusToast] = useState<string | null>(null);

  // Live OpenCE / Faber process status from TagTestRunner + HaloMemBridge
  const [liveStatus, setLiveStatus] = useState<TagTestStatus>({
    state: 'stopped',
    telnetConnected: false,
  });
  const [autoSyncInGame, setAutoSyncInGame] = useState(true);
  const autoLaunchedRef = useRef(false);
  const lastSyncedWeaponTagIdRef = useRef<number | null>(null);
  const lastSyncedVehicleTagIdRef = useRef<number | null>(null);

  // Target selection: weapon (Spartan-holdable only), vehicle, unitHud, or globalHud
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

  // Snapshot of initial element & stat values for Backspace / "Reset HUD" / "Reset weapon"
  const initialElementSnapshots = useRef<
    Map<string, { x: number; y: number; scaleX: number; scaleY: number; hidden: boolean; anchorIndex: number }>
  >(new Map());
  const initialStatSnapshots = useRef<Map<string, number>>(new Map());

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

  // Subscribe to TagTestRunner status & auto-launch Live HUD session in OpenCE / Faber on open
  useEffect(() => {
    if (!open) {
      autoLaunchedRef.current = false;
      return;
    }
    void loadCatalog(false);
    setPageStack([{ kind: 'root' }]);
    setSelectedRow(0);
    setCaptureElementId(null);
    setMenuVisible(true);

    let unsub: (() => void) | undefined;
    if (window.opence.onTagTestStatusChange) {
      unsub = window.opence.onTagTestStatusChange((st) => {
        setLiveStatus(st);
      });
    }
    void window.opence.tagTestGetStatus().then((st) => {
      setLiveStatus(st);
      if (!autoLaunchedRef.current) {
        autoLaunchedRef.current = true;
        if (st.state === 'stopped' || st.state === 'error' || (st.state === 'running' && !st.liveHudMode)) {
          void window.opence.tagTestLaunch({ windowed: true, liveHudMode: true });
        }
      }
    });

    return () => {
      unsub?.();
    };
  }, [open, loadCatalog]);

  // Auto-sync active target when the Spartan switches weapons (Tab) or enters/exits a vehicle in halo.exe
  useEffect(() => {
    if (!open || !catalog || !autoSyncInGame) return;

    const vehTagId = liveStatus.drivenVehicleTagId ?? null;
    if (vehTagId !== null && vehTagId !== lastSyncedVehicleTagIdRef.current) {
      lastSyncedVehicleTagIdRef.current = vehTagId;
      const vIdx = catalog.vehicles.findIndex((v) => v.tagId === vehTagId);
      if (vIdx >= 0) {
        setTargetType('vehicle');
        setSelectedTargetIdx(vIdx);
        setPageStack([{ kind: 'root' }]);
        setSelectedRow(0);
        setCaptureElementId(null);
        return;
      }
    } else if (vehTagId === null) {
      lastSyncedVehicleTagIdRef.current = null;
    }

    const weapTagId = liveStatus.heldWeaponTagId ?? null;
    if (vehTagId === null && weapTagId !== null && weapTagId !== lastSyncedWeaponTagIdRef.current) {
      lastSyncedWeaponTagIdRef.current = weapTagId;
      const wIdx = catalog.weapons.findIndex((w) => w.tagId === weapTagId);
      if (wIdx >= 0) {
        setTargetType('weapon');
        setSelectedTargetIdx(wIdx);
        setCaptureElementId(null);
      }
    }
  }, [open, catalog, autoSyncInGame, liveStatus.heldWeaponTagId, liveStatus.drivenVehicleTagId]);

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

  // Currently captured HUD element (if in Capture Mode)
  const capturedElement: { level: LiveHudLevel; element: LiveHudElementItem } | null = useMemo(() => {
    if (!captureElementId) return null;
    for (const lvl of activeHudChain) {
      const found = lvl.elements.find((e) => e.id === captureElementId);
      if (found) return { level: lvl, element: found };
    }
    return null;
  }, [captureElementId, activeHudChain]);

  // Helper to commit a live HUD edit (patches 0x40440000 in halo.exe RAM + updates open .map buffer)
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
      } else {
        setStatusToast(`Edit failed: ${res.message}`);
      }
    },
    [targetType, activeWeapon, editScope, onMapUpdated],
  );

  // Helper to commit a live weapon stat edit (patches 0x40440000 in halo.exe RAM + updates open .map buffer)
  const commitStatEdit = useCallback(
    async (field: LiveWeaponStatField, newValue: number) => {
      if (!window.opence.applyLiveWeaponStatEdit) return;
      const clamped = Math.max(field.min, Math.min(field.max, Number(newValue.toFixed(4))));
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
      }
    },
    [onMapUpdated],
  );

  // Helper to switch weapon index and immediately equip it in the Spartan's hands in halo.exe
  const selectAndEquipTargetIndex = useCallback(
    (nextIdx: number) => {
      setSelectedTargetIdx(nextIdx);
      if (targetType === 'weapon' && catalog?.weapons[nextIdx]) {
        const w = catalog.weapons[nextIdx];
        lastSyncedWeaponTagIdRef.current = w.tagId;
        if (liveStatus.state === 'running' && window.opence.equipLiveHudWeapon) {
          void window.opence.equipLiveHudWeapon(w.tagId);
        }
      }
    },
    [targetType, catalog, liveStatus.state],
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
    if (targetType === 'weapon')
      return catalog.weapons.map((w) => ({ label: w.displayName, path: w.path, tagIndex: w.tagIndex, tagId: w.tagId }));
    if (targetType === 'vehicle')
      return catalog.vehicles.map((v) => ({ label: v.displayName, path: v.path, tagIndex: v.tagIndex, tagId: v.tagId }));
    if (targetType === 'unit')
      return catalog.unitHuds.map((u) => ({ label: u.title, path: u.hudTagPath, tagIndex: u.hudTagIndex, tagId: u.hudTagId }));
    return catalog.globalHuds.map((g) => ({ label: g.title, path: g.hudTagPath, tagIndex: g.hudTagIndex, tagId: g.hudTagId }));
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
              ? `HOLDABLE WEAPONS (${catalog.weapons.length})`
              : targetType === 'vehicle'
                ? `VEHICLES (${catalog.vehicles.length})`
                : targetType === 'unit'
                  ? `UNIT HUDS (${catalog.unitHuds.length})`
                  : `GLOBAL HUD (${catalog.globalHuds.length})`,
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
          label: targetType === 'weapon' ? 'Held Weapon' : targetType === 'vehicle' ? 'Vehicle' : 'Active HUD',
          valueText: currentTargetName,
          onEnter: () => {
            if (targetType === 'weapon' && activeWeapon && window.opence.equipLiveHudWeapon) {
              void window.opence.equipLiveHudWeapon(activeWeapon.tagId);
              setStatusToast(`Equipped ${activeWeapon.displayName} in Spartan's hands in-game.`);
            } else if (targetType === 'vehicle' && activeVehicle && window.opence.spawnLiveHudVehicle) {
              void window.opence.spawnLiveHudVehicle(activeVehicle.tagId);
              setStatusToast(`Spawned ${activeVehicle.displayName} near Spartan in-game.`);
            }
          },
          onLeft: () => {
            if (targetList.length === 0) return;
            const nextIdx = (selectedTargetIdx + targetList.length - 1) % targetList.length;
            selectAndEquipTargetIndex(nextIdx);
          },
          onRight: () => {
            if (targetList.length === 0) return;
            const nextIdx = (selectedTargetIdx + 1) % targetList.length;
            selectAndEquipTargetIndex(nextIdx);
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
        rows.push({
          id: 'equip_this_weapon',
          label: `Equip ${activeWeapon.displayName} In-Game`,
          onEnter: () => {
            if (window.opence.equipLiveHudWeapon) {
              void window.opence.equipLiveHudWeapon(activeWeapon.tagId);
              setStatusToast(`Equipped ${activeWeapon.displayName} in Spartan's hands!`);
            }
          },
        });
      }

      if (targetType === 'vehicle' && activeVehicle) {
        rows.push({
          id: 'spawn_this_vehicle',
          label: `Spawn ${activeVehicle.displayName} Near Spartan`,
          onEnter: () => {
            if (window.opence.spawnLiveHudVehicle) {
              void window.opence.spawnLiveHudVehicle(activeVehicle.tagId);
              setStatusToast(`Spawned ${activeVehicle.displayName} near Spartan!`);
            }
          },
        });
      }

      rows.push({
        id: 'spawn_all_arsenal',
        label: 'Spawn All Holdable Weapons & Vehicles',
        onEnter: () => {
          if (window.opence.spawnAllLiveHudArsenal) {
            void window.opence.spawnAllLiveHudArsenal();
            setStatusToast(
              `Spawned all ${catalog.weapons.length} holdable weapons & ${catalog.vehicles.length} vehicles around Spartan!`,
            );
          }
        },
      });

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

      if (level.sharedByPaths.length > 0 && level.level === 0 && targetType === 'weapon') {
        rows.push({
          id: 'hud_scope',
          label: 'Edits apply to',
          valueText: editScope === 'this_one' ? 'THIS ONE' : 'ALL',
          onLeft: () => setEditScope((s) => (s === 'this_one' ? 'all' : 'this_one')),
          onRight: () => setEditScope((s) => (s === 'this_one' ? 'all' : 'this_one')),
        });
      }

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

      for (const el of level.elements) {
        rows.push({
          id: el.id,
          label: el.label,
          valueText: el.hidden ? 'HIDDEN' : `${el.x}, ${el.y}`,
          elementRef: { level, element: el },
          onEnter: () => {
            setCaptureElementId(el.id);
            setCaptureScalingMode(false);
            if (el.offsetVirtualAddress && window.opence.blinkLiveHudElement) {
              void window.opence.blinkLiveHudElement(el.offsetVirtualAddress, el.x);
            }
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
          setStatusToast(`Reset ${level.title} in-game & in map buffer.`);
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
          setStatusToast(`Reset ${activeWeapon.displayName} stats in-game & in map buffer.`);
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
    activeVehicle,
    editScope,
    commitHudEdit,
    commitStatEdit,
    selectAndEquipTargetIndex,
    onOpenBitmapInjector,
    onOpenUiMapStudio,
  ]);

  useEffect(() => {
    if (selectedRow >= menuRows.length && menuRows.length > 0) {
      setSelectedRow(menuRows.length - 1);
    }
  }, [menuRows.length, selectedRow]);

  // Keyboard navigation matching Halo CE's tag_editor.c!
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === '|' || e.key === '\\') {
        e.preventDefault();
        if (captureElementId) {
          setCaptureElementId(null);
        } else {
          setMenuVisible((v) => !v);
        }
        return;
      }

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

  if (!open) return null;

  const headerTitle = (() => {
    if (currentPage.kind === 'root') return `${currentTargetName} — In-Game Live Editor`;
    if (currentPage.kind === 'hud_level') {
      const lvl = activeHudChain[currentPage.levelIndex];
      return `${currentTargetName} > ${lvl?.title ?? 'HUD'}`;
    }
    if (currentPage.kind === 'weapon_stats_root') return `${currentTargetName} > Weapon stats`;
    if (currentPage.kind === 'weapon_stats_cat') return `${currentTargetName} > ${currentPage.label}`;
    return 'In-Game Live HUD Editor';
  })();

  const isRunning = liveStatus.state === 'running';
  const isLaunching = liveStatus.state === 'launching';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(2, 6, 14, 0.84)',
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
            🎯 In-Game Live HUD & Weapon Tag Editor
          </span>
          <span
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 4,
              backgroundColor: isRunning
                ? 'rgba(34, 197, 94, 0.18)'
                : isLaunching
                  ? 'rgba(234, 179, 8, 0.18)'
                  : 'rgba(239, 68, 68, 0.18)',
              border: `1px solid ${isRunning ? '#22c55e' : isLaunching ? '#eab308' : '#ef4444'}`,
              color: isRunning ? '#86efac' : isLaunching ? '#fde047' : '#fca5a5',
              fontWeight: 700,
            }}
          >
            {isRunning
              ? `🟢 LIVE IN-GAME (PID ${liveStatus.pid ?? 'active'} · 0x40440000 60FPS Memory Bridge)`
              : isLaunching
                ? '⏳ Launching OpenCE / Faber Live HUD Session...'
                : '⚪ OpenCE Stopped'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              color: '#93c5fd',
              cursor: 'pointer',
            }}
            title="Automatically switch the active HUD target when you switch weapons (Tab) or enter a vehicle (E) in-game"
          >
            <input
              type="checkbox"
              checked={autoSyncInGame}
              onChange={(e) => setAutoSyncInGame(e.target.checked)}
            />
            Sync to Held Weapon / Vehicle In-Game
          </label>

          {isRunning && (
            <button
              onClick={() => {
                void window.opence.spawnAllLiveHudArsenal?.();
                setStatusToast('Spawned all Spartan-holdable weapons & vehicles around player in-game!');
              }}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 5,
                border: '1px solid #2896ff',
                backgroundColor: '#002244',
                color: '#ffffff',
                cursor: 'pointer',
              }}
            >
              🎁 Spawn All Weapons & Vehicles
            </button>
          )}

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

          <button
            onClick={() => {
              if (isRunning) {
                void window.opence.tagTestHotReload();
                setStatusToast('Hot-reloaded staged map in OpenCE!');
              } else {
                void window.opence.tagTestLaunch({ windowed: true, liveHudMode: true });
              }
            }}
            style={{
              padding: '4px 12px',
              fontSize: 11,
              fontWeight: 700,
              borderRadius: 5,
              border: '1px solid #22c55e',
              backgroundColor: isRunning ? '#14532d' : '#052e16',
              color: '#86efac',
              cursor: 'pointer',
            }}
          >
            {isRunning ? '⚡ Hot-Reload Map' : '▶ Launch In-Game HUD Session'}
          </button>

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

      {/* Main Workspace: Authentic Halo CE Left 34% Overlay Menu + Live In-Game Telemetry & Arsenal Deck */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        {loading && (
          <div style={{ margin: 'auto', color: '#2896ff', fontSize: 16, fontWeight: 700 }}>
            Loading open map HUD & weapon catalog...
          </div>
        )}

        {error && (
          <div
            style={{
              margin: 'auto',
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
          <>
            {/* AUTHENTIC HALO CE LEFT MENU PANEL (Hidden during Capture Mode) */}
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
                  width: 420,
                  minWidth: 340,
                  maxWidth: '42%',
                  height: '100%',
                  backgroundColor: 'rgba(0, 8, 20, 0.92)',
                  borderRight: '2px solid #2896ff',
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '14px 14px',
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
                          minHeight: 32,
                          padding: '5px 12px',
                          borderRadius: 8,
                          backgroundColor: isSelected
                            ? 'rgba(0, 34, 68, 0.95)'
                            : 'rgba(0, 17, 34, 0.76)',
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
                                  padding: '0 4px',
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
                                minWidth: 64,
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
                                  padding: '0 4px',
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
                  <div>↑↓ Select   ◄► Adjust / Hide   (Enter) Blink & Move In-Game</div>
                  <div>(Esc/Right-Click) Back   (|) Toggle Menu</div>
                </div>
              </div>
            )}

            {/* RIGHT PANEL: Live In-Game Arsenal Switcher & Direct Memory Bridge Status */}
            <div
              style={{
                flex: 1,
                padding: 20,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              {/* Live In-Game Status Card */}
              <div
                style={{
                  backgroundColor: 'rgba(0, 17, 34, 0.88)',
                  border: '1px solid #2896ff',
                  borderRadius: 10,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ color: '#ffffff', fontWeight: 700, fontSize: 15 }}>
                    True In-Game HUD & Weapon Tag Editing (`0x40440000` Live RAM Bridge)
                  </div>
                  <div style={{ color: '#93c5fd', fontSize: 12 }}>
                    Map: <strong>{catalog.mapName}</strong> · {catalog.weapons.length} Holdable Weapons ·{' '}
                    {catalog.vehicles.length} Vehicles
                  </div>
                </div>
                <div style={{ color: '#cbd5e1', fontSize: 12, lineHeight: 1.55 }}>
                  Every edit you make in the <strong>Halo CE Tag Editor menu</strong> on the left patches the running{' '}
                  <code>halo.exe</code> / <code>OpenCE - Faber.exe</code> tag cache at <code>0x40440000</code> in real
                  time (&lt;1 ms) and simultaneously updates your open map buffer in Mantle. On spawn, your Spartan is
                  unlocked to carry <strong>4 weapons at once</strong> (cycle with <code>Tab</code>), and every
                  Spartan-holdable weapon and vehicle tag in the map is spawned right around you.
                </div>
              </div>

              {/* Quick Holdable Weapons Switcher (Click to Equip in Spartan's Hands In-Game) */}
              <div
                style={{
                  backgroundColor: 'rgba(0, 17, 34, 0.82)',
                  border: '1px solid rgba(40, 150, 255, 0.45)',
                  borderRadius: 10,
                  padding: 14,
                }}
              >
                <div
                  style={{
                    color: '#2896ff',
                    fontWeight: 700,
                    fontSize: 12,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: 10,
                  }}
                >
                  🔫 Spartan-Holdable Weapons in Map (Click any weapon to equip it in-game & edit its HUD / Stats)
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {catalog.weapons.map((w, idx) => {
                    const isCurrentTarget = targetType === 'weapon' && selectedTargetIdx === idx;
                    const isHeldInGame = liveStatus.heldWeaponTagId === w.tagId;
                    return (
                      <button
                        key={w.tagId}
                        onClick={() => {
                          setTargetType('weapon');
                          selectAndEquipTargetIndex(idx);
                        }}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 7,
                          border: isCurrentTarget
                            ? '2px solid #2299ff'
                            : isHeldInGame
                              ? '1px solid #22c55e'
                              : '1px solid #1e3a5f',
                          backgroundColor: isCurrentTarget
                            ? 'rgba(0, 34, 68, 0.95)'
                            : 'rgba(0, 12, 26, 0.85)',
                          color: isCurrentTarget ? '#ffffff' : '#93c5fd',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        {isHeldInGame && <span title="Currently held in-game">🟢</span>}
                        <span>{w.displayName}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Quick Vehicles Switcher (Click to Spawn & Edit Vehicle HUD) */}
              {catalog.vehicles.length > 0 && (
                <div
                  style={{
                    backgroundColor: 'rgba(0, 17, 34, 0.82)',
                    border: '1px solid rgba(40, 150, 255, 0.45)',
                    borderRadius: 10,
                    padding: 14,
                  }}
                >
                  <div
                    style={{
                      color: '#2896ff',
                      fontWeight: 700,
                      fontSize: 12,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      marginBottom: 10,
                    }}
                  >
                    🚙 Vehicle Tags in Map (All spawned near player on load — Click to select HUD or spawn fresh copy)
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {catalog.vehicles.map((v, idx) => {
                      const isCurrentTarget = targetType === 'vehicle' && selectedTargetIdx === idx;
                      const isDrivenInGame = liveStatus.drivenVehicleTagId === v.tagId;
                      return (
                        <div
                          key={v.tagId}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            borderRadius: 7,
                            overflow: 'hidden',
                            border: isCurrentTarget
                              ? '2px solid #2299ff'
                              : isDrivenInGame
                                ? '1px solid #22c55e'
                                : '1px solid #1e3a5f',
                            backgroundColor: isCurrentTarget
                              ? 'rgba(0, 34, 68, 0.95)'
                              : 'rgba(0, 12, 26, 0.85)',
                          }}
                        >
                          <button
                            onClick={() => {
                              setTargetType('vehicle');
                              setSelectedTargetIdx(idx);
                            }}
                            style={{
                              padding: '6px 10px',
                              border: 'none',
                              background: 'transparent',
                              color: isCurrentTarget ? '#ffffff' : '#93c5fd',
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            {isDrivenInGame ? '🟢 ' : ''}
                            {v.displayName}
                          </button>
                          {isRunning && (
                            <button
                              onClick={() => {
                                setTargetType('vehicle');
                                setSelectedTargetIdx(idx);
                                void window.opence.spawnLiveHudVehicle?.(v.tagId);
                                setStatusToast(`Spawned ${v.displayName} near Spartan in-game!`);
                              }}
                              title={`Spawn ${v.displayName} in front of Spartan`}
                              style={{
                                padding: '6px 8px',
                                border: 'none',
                                borderLeft: '1px solid #1e3a5f',
                                backgroundColor: 'rgba(40, 150, 255, 0.16)',
                                color: '#38bdf8',
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              + Spawn
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* CAPTURE MODE 2-LINE BOTTOM BAR (When an element is captured for Move / Scale in halo.exe) */}
            {capturedElement && (
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  bottom: 18,
                  transform: 'translateX(-50%)',
                  backgroundColor: 'rgba(0, 17, 34, 0.94)',
                  border: '2px solid #2299ff',
                  borderRadius: 8,
                  padding: '10px 24px',
                  minWidth: 480,
                  textAlign: 'center',
                  boxShadow: '0 6px 24px rgba(0, 0, 0, 0.85)',
                }}
              >
                <div
                  style={{
                    color: '#ffffff',
                    fontSize: 14,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    marginBottom: 4,
                  }}
                >
                  {capturedElement.element.label.toUpperCase()} &nbsp;&nbsp; X {capturedElement.element.x} &nbsp;&nbsp; Y{' '}
                  {capturedElement.element.y} &nbsp;&nbsp; SCALE {capturedElement.element.scaleX.toFixed(2)} x{' '}
                  {capturedElement.element.scaleY.toFixed(2)}
                </div>
                <div style={{ color: '#2896ff', fontSize: 12, fontWeight: 600 }}>
                  {captureScalingMode
                    ? 'Arrows / D-pad: Scale In-Game (↑↓ Uniform, ◄► Width)   (Enter) Move   (Backspace) Reset   (Esc) Done'
                    : 'Arrows / D-pad: Move In-Game (Hold Shift for 4× speed)   (Enter) Scale   (Backspace) Reset   (Esc) Done'}
                </div>
              </div>
            )}

            {/* Status Toast */}
            {statusToast && (
              <div
                onClick={() => setStatusToast(null)}
                style={{
                  position: 'absolute',
                  top: 14,
                  right: 16,
                  backgroundColor: 'rgba(0, 34, 68, 0.94)',
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
          </>
        )}
      </div>
    </div>
  );
};
