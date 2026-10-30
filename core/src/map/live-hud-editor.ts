import { parseCacheFileHeader, type CacheFileHeader } from './header';
import { parseTagIndex, resolveTagDataPointer, type TagIndex } from './tag-index';
import {
  readTagFieldValues,
  writeTagFieldValue,
  ensureExternalTagInternalized,
  type TagFieldDescriptor,
  type TagReflexiveElement,
} from './tag-field-editor';
import { duplicateTagInMap } from './tag-index-editor';
import {
  inspectBitmapTag,
  replaceBitmapImageData,
  encodeBitmapWithMipmaps,
  decodePngToRgba,
} from '../render/bitmap-codec';
import { BitmapFormat } from '../render/bitmap-textures';
import { readUnicodeStringList, writeUnicodeString } from './unicode-string-editor';
import { compileStringsIntoTag } from './mod-packager';
import {
  OCETAGS_MAGIC,
  OCETAGS_FORMAT_VERSION,
  type OceContainer,
} from './container';
import { planAddInjection, applyInjectionWithReport, computeNewTagId } from './tag-injector';
import { NULL_TAG_ID } from '../constants/tag-classes';

export const HUD_ANCHOR_NAMES = [
  'TOP LEFT',
  'TOP RIGHT',
  'BOTTOM LEFT',
  'BOTTOM RIGHT',
  'CENTRE',
] as const;

export type HudElementKind =
  | 'static'
  | 'meter'
  | 'number'
  | 'crosshair'
  | 'overlay'
  | 'unit_panel'
  | 'global_element';

export interface LiveHudElementItem {
  /** Unique key within the HUD level, e.g. "static.0", "crosshair.0.0", "unhi.shield_bg" */
  id: string;
  hudTagIndex: number;
  hudTagId: number;
  hudTagPath: string;
  hudGroup: 'weapon_hud_interface' | 'unit_hud_interface' | 'hud_globals';
  level: number;
  kind: HudElementKind;
  elementIndex: number;
  itemIndex: number;
  /** Label shown in Halo CE Tag Editor style, e.g. "Static 1 (hud_reticles)" or "Crosshair 1.1 (reticle)" */
  label: string;
  /** Short category badge */
  categoryLabel: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  hidden: boolean;
  /** Raw value of allowed view type or flags before hiding */
  rawVisibilityValue: number;
  bitmapTagIndex: number | null;
  bitmapTagId: number | null;
  bitmapPath: string;
  bitmapLeaf: string;
  bitmapIsExternal: boolean;
  sequenceIndex: number;
  defaultColorArgb: number;
  /** Field paths for writeTagFieldValue */
  offsetFieldPath: string;
  /** Virtual memory address (0x40440000-based) of the Point2DInt anchor offset field in halo.exe RAM */
  offsetVirtualAddress: number;
  scaleXFieldPath: string;
  scaleYFieldPath: string;
  visibilityFieldPath?: string;
  visibilityMode?: 'map_type_15' | 'crosshair_bit7' | 'overlay_bit1' | 'scaling_hide';
  bitmapFieldPath?: string;
  sequenceFieldPath?: string;
}

export interface LiveMemoryPatch {
  /** Virtual address in halo.exe tag cache (0x40440000-based) */
  address: number;
  /** Base64-encoded bytes to write via WriteProcessMemory */
  dataBase64: string;
}

export interface LiveHudSessionSetupInfo {
  /** Virtual address of the `globals` ('matg') tag root struct in halo.exe RAM (0 if not found) */
  matgVirtualAddress: number;
  /** All Spartan-holdable weapon tagIds in the open map */
  holdableWeaponTagIds: number[];
  /** All unique vehicle ('vehi') tagIds in the open map */
  vehicleTagIds: number[];
}

export interface LiveHudLevel {
  level: number;
  title: string;
  hudTagIndex: number;
  hudTagId: number;
  hudTagPath: string;
  hudGroup: 'weapon_hud_interface' | 'unit_hud_interface' | 'hud_globals';
  anchorIndex: number;
  anchorName: string;
  anchorFieldPath: string;
  sharedByPaths: string[];
  elements: LiveHudElementItem[];
}

export interface LiveWeaponStatField {
  key: string;
  label: string;
  category:
    | 'weapon'
    | 'trigger0'
    | 'trigger1'
    | 'magazine0'
    | 'magazine1'
    | 'projectile0'
    | 'projectile1'
    | 'damage_impact0'
    | 'damage_stuck0'
    | 'damage_explosion0'
    | 'damage_impact1'
    | 'damage_stuck1'
    | 'damage_explosion1'
    | 'damage_melee';
  targetTagIndex: number;
  targetTagPath: string;
  fieldPath: string;
  /** For bounds fields: 0 = lower, 1 = upper */
  boundsIndex?: 0 | 1;
  value: number;
  step: number;
  min: number;
  max: number;
  unit?: string;
  /** Conversion applied between raw tag storage and UI display */
  conversion?: 'rad_to_deg' | 'tick_to_sec' | 'none';
}

export interface LiveWeaponEntry {
  tagIndex: number;
  tagId: number;
  path: string;
  displayName: string;
  pickupMessageIndex: number;
  hudChain: LiveHudLevel[];
  stats: LiveWeaponStatField[];
}

export interface LiveVehicleEntry {
  tagIndex: number;
  tagId: number;
  path: string;
  displayName: string;
  unitHud: LiveHudLevel | null;
  weaponHudChain: LiveHudLevel[];
}

export interface LiveUiWidgetSummary {
  tagIndex: number;
  tagId: number;
  path: string;
  displayName: string;
  widgetType: string;
  bounds: [number, number, number, number];
  childCount: number;
  backgroundBitmapPath: string;
  stringListPath: string;
}

export interface LiveHudCatalog {
  mapName: string;
  weapons: LiveWeaponEntry[];
  vehicles: LiveVehicleEntry[];
  unitHuds: LiveHudLevel[];
  globalHuds: LiveHudLevel[];
  uiWidgets: LiveUiWidgetSummary[];
  unicodeStringLists: Array<{
    tagIndex: number;
    tagId: number;
    path: string;
    isExternal: boolean;
  }>;
}

function getLeafName(tagPath: string): string {
  if (!tagPath) return '';
  const norm = tagPath.replace(/\//g, '\\');
  const idx = norm.lastIndexOf('\\');
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

function formatDisplayName(tagPath: string): string {
  const leaf = getLeafName(tagPath);
  if (!leaf) return tagPath;
  return leaf
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function findField(fields: TagFieldDescriptor[], name: string): TagFieldDescriptor | undefined {
  return fields.find((f) => f.name === name);
}

function getNumberVal(fields: TagFieldDescriptor[], name: string, fallback = 0): number {
  const f = findField(fields, name);
  if (!f) return fallback;
  if (typeof f.value === 'number' && Number.isFinite(f.value)) return f.value;
  return fallback;
}

function getPoint2DVal(fields: TagFieldDescriptor[], name: string): [number, number] {
  const f = findField(fields, name);
  if (f && Array.isArray(f.value) && f.value.length >= 2) {
    return [Number(f.value[0]) || 0, Number(f.value[1]) || 0];
  }
  return [0, 0];
}

function getFieldVirtualAddress(
  fields: TagFieldDescriptor[],
  name: string,
  header: CacheFileHeader,
  tagIndex: TagIndex,
): number {
  const f = findField(fields, name);
  if (!f || f.offset < header.tagDataOffset) return 0;
  return (tagIndex.baseMemoryAddress + (f.offset - header.tagDataOffset)) >>> 0;
}

function getRect2DVal(fields: TagFieldDescriptor[], name: string): [number, number, number, number] {
  const f = findField(fields, name);
  if (f && Array.isArray(f.value) && f.value.length >= 4) {
    return [
      Number(f.value[0]) || 0,
      Number(f.value[1]) || 0,
      Number(f.value[2]) || 0,
      Number(f.value[3]) || 0,
    ];
  }
  return [0, 0, 480, 640];
}

function getDepTarget(
  fields: TagFieldDescriptor[],
  name: string,
  tagIndex: TagIndex,
): { tagIndex: number | null; tagId: number | null; path: string; leaf: string; isExternal: boolean } {
  const f = findField(fields, name);
  const dep = f?.dependencyTarget;
  if (!dep || dep.tagId === NULL_TAG_ID || dep.tagId === -1) {
    return { tagIndex: null, tagId: null, path: '', leaf: '', isExternal: false };
  }
  const entry = tagIndex.entries.find((e) => e.tagId === dep.tagId) ?? tagIndex.entries[dep.tagId & 0xffff];
  return {
    tagIndex: entry ? entry.index : null,
    tagId: dep.tagId,
    path: entry?.path ?? dep.path ?? '',
    leaf: getLeafName(entry?.path ?? dep.path ?? ''),
    isExternal: Boolean(entry?.isExternal),
  };
}

/**
 * Parses a `weapon_hud_interface` ('wphi') tag into a `LiveHudLevel`.
 */
export function parseWeaponHudLevel(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  wphiTagIndex: number,
  level: number,
  sharedByPaths: string[],
): LiveHudLevel | null {
  const entry = tagIndex.entries[wphiTagIndex];
  if (!entry || entry.primaryClassName !== 'weapon_hud_interface') return null;

  let decoded: ReturnType<typeof readTagFieldValues>;
  try {
    decoded = readTagFieldValues(buffer, header, tagIndex, wphiTagIndex);
  } catch {
    return null;
  }

  const anchorIdx = Math.max(0, Math.min(4, getNumberVal(decoded.fields, 'anchor', 0)));
  const anchorName = HUD_ANCHOR_NAMES[anchorIdx] ?? 'TOP LEFT';
  const elements: LiveHudElementItem[] = [];

  // 1. Static elements
  const staticsField = findField(decoded.fields, 'static elements');
  const staticChildren = staticsField?.children ?? [];
  staticChildren.forEach((child: TagReflexiveElement, elemIdx: number) => {
    const [x, y] = getPoint2DVal(child.fields, 'anchor offset');
    const scaleX = getNumberVal(child.fields, 'width scale', 1);
    const scaleY = getNumberVal(child.fields, 'height scale', 1);
    const viewType = getNumberVal(child.fields, 'allowed view type', 0);
    const hidden = viewType === 15;
    const bitm = getDepTarget(child.fields, 'interface bitmap', tagIndex);
    const seqIdx = getNumberVal(child.fields, 'sequence index', 0);
    const color = getNumberVal(child.fields, 'default color', 0xff4cc9f0);
    const label = bitm.leaf
      ? `Static ${elemIdx + 1} (${bitm.leaf})`
      : `Static ${elemIdx + 1}`;
    elements.push({
      id: `l${level}.static.${elemIdx}`,
      hudTagIndex: wphiTagIndex,
      hudTagId: entry.tagId,
      hudTagPath: entry.path,
      hudGroup: 'weapon_hud_interface',
      level,
      kind: 'static',
      elementIndex: elemIdx,
      itemIndex: -1,
      label,
      categoryLabel: 'Static Frame',
      x,
      y,
      scaleX: scaleX || 1,
      scaleY: scaleY || 1,
      hidden,
      rawVisibilityValue: hidden ? 0 : viewType,
      bitmapTagIndex: bitm.tagIndex,
      bitmapTagId: bitm.tagId,
      bitmapPath: bitm.path,
      bitmapLeaf: bitm.leaf,
      bitmapIsExternal: bitm.isExternal,
      sequenceIndex: seqIdx === 0xffff ? 0 : seqIdx,
      defaultColorArgb: color,
      offsetFieldPath: `static elements[${elemIdx}].anchor offset`,
      offsetVirtualAddress: getFieldVirtualAddress(child.fields, 'anchor offset', header, tagIndex),
      scaleXFieldPath: `static elements[${elemIdx}].width scale`,
      scaleYFieldPath: `static elements[${elemIdx}].height scale`,
      visibilityFieldPath: `static elements[${elemIdx}].allowed view type`,
      visibilityMode: 'map_type_15',
      bitmapFieldPath: `static elements[${elemIdx}].interface bitmap`,
      sequenceFieldPath: `static elements[${elemIdx}].sequence index`,
    });
  });

  // 2. Meter elements
  const metersField = findField(decoded.fields, 'meter elements');
  const meterChildren = metersField?.children ?? [];
  meterChildren.forEach((child: TagReflexiveElement, elemIdx: number) => {
    const [x, y] = getPoint2DVal(child.fields, 'anchor offset');
    const scaleX = getNumberVal(child.fields, 'width scale', 1);
    const scaleY = getNumberVal(child.fields, 'height scale', 1);
    const viewType = getNumberVal(child.fields, 'allowed view type', 0);
    const hidden = viewType === 15;
    const bitm = getDepTarget(child.fields, 'meter bitmap', tagIndex);
    const seqIdx = getNumberVal(child.fields, 'sequence index', 0);
    const color = getNumberVal(child.fields, 'color at meter maximum', 0xff4cc9f0);
    const label = bitm.leaf
      ? `Meter ${elemIdx + 1} (${bitm.leaf})`
      : `Meter ${elemIdx + 1}`;
    elements.push({
      id: `l${level}.meter.${elemIdx}`,
      hudTagIndex: wphiTagIndex,
      hudTagId: entry.tagId,
      hudTagPath: entry.path,
      hudGroup: 'weapon_hud_interface',
      level,
      kind: 'meter',
      elementIndex: elemIdx,
      itemIndex: -1,
      label,
      categoryLabel: 'HUD Meter',
      x,
      y,
      scaleX: scaleX || 1,
      scaleY: scaleY || 1,
      hidden,
      rawVisibilityValue: hidden ? 0 : viewType,
      bitmapTagIndex: bitm.tagIndex,
      bitmapTagId: bitm.tagId,
      bitmapPath: bitm.path,
      bitmapLeaf: bitm.leaf,
      bitmapIsExternal: bitm.isExternal,
      sequenceIndex: seqIdx === 0xffff ? 0 : seqIdx,
      defaultColorArgb: color,
      offsetFieldPath: `meter elements[${elemIdx}].anchor offset`,
      offsetVirtualAddress: getFieldVirtualAddress(child.fields, 'anchor offset', header, tagIndex),
      scaleXFieldPath: `meter elements[${elemIdx}].width scale`,
      scaleYFieldPath: `meter elements[${elemIdx}].height scale`,
      visibilityFieldPath: `meter elements[${elemIdx}].allowed view type`,
      visibilityMode: 'map_type_15',
      bitmapFieldPath: `meter elements[${elemIdx}].meter bitmap`,
      sequenceFieldPath: `meter elements[${elemIdx}].sequence index`,
    });
  });

  // 3. Number elements
  const numbersField = findField(decoded.fields, 'number elements');
  const numberChildren = numbersField?.children ?? [];
  numberChildren.forEach((child: TagReflexiveElement, elemIdx: number) => {
    const [x, y] = getPoint2DVal(child.fields, 'anchor offset');
    const scaleX = getNumberVal(child.fields, 'width scale', 1);
    const scaleY = getNumberVal(child.fields, 'height scale', 1);
    const viewType = getNumberVal(child.fields, 'allowed view type', 0);
    const hidden = viewType === 15;
    const color = getNumberVal(child.fields, 'default color', 0xff4cc9f0);
    elements.push({
      id: `l${level}.number.${elemIdx}`,
      hudTagIndex: wphiTagIndex,
      hudTagId: entry.tagId,
      hudTagPath: entry.path,
      hudGroup: 'weapon_hud_interface',
      level,
      kind: 'number',
      elementIndex: elemIdx,
      itemIndex: -1,
      label: `Number ${elemIdx + 1}`,
      categoryLabel: 'Ammo / Counter Number',
      x,
      y,
      scaleX: scaleX || 1,
      scaleY: scaleY || 1,
      hidden,
      rawVisibilityValue: hidden ? 0 : viewType,
      bitmapTagIndex: null,
      bitmapTagId: null,
      bitmapPath: '',
      bitmapLeaf: '',
      bitmapIsExternal: false,
      sequenceIndex: 0,
      defaultColorArgb: color,
      offsetFieldPath: `number elements[${elemIdx}].anchor offset`,
      offsetVirtualAddress: getFieldVirtualAddress(child.fields, 'anchor offset', header, tagIndex),
      scaleXFieldPath: `number elements[${elemIdx}].width scale`,
      scaleYFieldPath: `number elements[${elemIdx}].height scale`,
      visibilityFieldPath: `number elements[${elemIdx}].allowed view type`,
      visibilityMode: 'map_type_15',
    });
  });

  // 4. Crosshairs & Crosshair Overlays
  const crosshairsField = findField(decoded.fields, 'crosshairs');
  const crosshairChildren = crosshairsField?.children ?? [];
  crosshairChildren.forEach((child: TagReflexiveElement, elemIdx: number) => {
    const bitm = getDepTarget(child.fields, 'crosshair bitmap', tagIndex);
    const overlaysField = findField(child.fields, 'crosshair overlays');
    const items = overlaysField?.children ?? [];
    items.forEach((item: TagReflexiveElement, itemIdx: number) => {
      const [x, y] = getPoint2DVal(item.fields, 'anchor offset');
      const scaleX = getNumberVal(item.fields, 'width scale', 1);
      const scaleY = getNumberVal(item.fields, 'height scale', 1);
      const flags = getNumberVal(item.fields, 'flags', 0);
      const hidden = (flags & (1 << 7)) !== 0;
      const seqIdx = getNumberVal(item.fields, 'sequence index', 0);
      const color = getNumberVal(item.fields, 'default color', 0xff4cc9f0);
      const numPart =
        crosshairChildren.length === 1 && items.length === 1
          ? '1'
          : items.length === 1
            ? `${elemIdx + 1}`
            : `${elemIdx + 1}.${itemIdx + 1}`;
      const label = bitm.leaf
        ? `Crosshair ${numPart} (${bitm.leaf})`
        : `Crosshair ${numPart}`;
      elements.push({
        id: `l${level}.crosshair.${elemIdx}.${itemIdx}`,
        hudTagIndex: wphiTagIndex,
        hudTagId: entry.tagId,
        hudTagPath: entry.path,
        hudGroup: 'weapon_hud_interface',
        level,
        kind: 'crosshair',
        elementIndex: elemIdx,
        itemIndex: itemIdx,
        label,
        categoryLabel: 'Reticle / Crosshair',
        x,
        y,
        scaleX: scaleX || 1,
        scaleY: scaleY || 1,
        hidden,
        rawVisibilityValue: flags & ~(1 << 7),
        bitmapTagIndex: bitm.tagIndex,
        bitmapTagId: bitm.tagId,
        bitmapPath: bitm.path,
        bitmapLeaf: bitm.leaf,
        bitmapIsExternal: bitm.isExternal,
        sequenceIndex: seqIdx === 0xffff ? 0 : seqIdx,
        defaultColorArgb: color,
        offsetFieldPath: `crosshairs[${elemIdx}].crosshair overlays[${itemIdx}].anchor offset`,
        offsetVirtualAddress: getFieldVirtualAddress(item.fields, 'anchor offset', header, tagIndex),
        scaleXFieldPath: `crosshairs[${elemIdx}].crosshair overlays[${itemIdx}].width scale`,
        scaleYFieldPath: `crosshairs[${elemIdx}].crosshair overlays[${itemIdx}].height scale`,
        visibilityFieldPath: `crosshairs[${elemIdx}].crosshair overlays[${itemIdx}].flags`,
        visibilityMode: 'crosshair_bit7',
        bitmapFieldPath: `crosshairs[${elemIdx}].crosshair bitmap`,
        sequenceFieldPath: `crosshairs[${elemIdx}].crosshair overlays[${itemIdx}].sequence index`,
      });
    });
  });

  // 5. Overlay elements
  const overlaysField = findField(decoded.fields, 'overlay elements');
  const overlayChildren = overlaysField?.children ?? [];
  overlayChildren.forEach((child: TagReflexiveElement, elemIdx: number) => {
    const bitm = getDepTarget(child.fields, 'overlay bitmap', tagIndex);
    const subOverlaysField = findField(child.fields, 'overlays');
    const items = subOverlaysField?.children ?? [];
    items.forEach((item: TagReflexiveElement, itemIdx: number) => {
      const [x, y] = getPoint2DVal(item.fields, 'anchor offset');
      const scaleX = getNumberVal(item.fields, 'width scale', 1);
      const scaleY = getNumberVal(item.fields, 'height scale', 1);
      const flags = getNumberVal(item.fields, 'flags', 0);
      const hidden = (flags & (1 << 1)) !== 0;
      const seqIdx = getNumberVal(item.fields, 'sequence index', 0);
      const color = getNumberVal(item.fields, 'default color', 0xff4cc9f0);
      const numPart =
        overlayChildren.length === 1 && items.length === 1
          ? '1'
          : items.length === 1
            ? `${elemIdx + 1}`
            : `${elemIdx + 1}.${itemIdx + 1}`;
      const label = bitm.leaf
        ? `Overlay ${numPart} (${bitm.leaf})`
        : `Overlay ${numPart}`;
      elements.push({
        id: `l${level}.overlay.${elemIdx}.${itemIdx}`,
        hudTagIndex: wphiTagIndex,
        hudTagId: entry.tagId,
        hudTagPath: entry.path,
        hudGroup: 'weapon_hud_interface',
        level,
        kind: 'overlay',
        elementIndex: elemIdx,
        itemIndex: itemIdx,
        label,
        categoryLabel: 'HUD Overlay / Scope',
        x,
        y,
        scaleX: scaleX || 1,
        scaleY: scaleY || 1,
        hidden,
        rawVisibilityValue: flags & ~(1 << 1),
        bitmapTagIndex: bitm.tagIndex,
        bitmapTagId: bitm.tagId,
        bitmapPath: bitm.path,
        bitmapLeaf: bitm.leaf,
        bitmapIsExternal: bitm.isExternal,
        sequenceIndex: seqIdx === 0xffff ? 0 : seqIdx,
        defaultColorArgb: color,
        offsetFieldPath: `overlay elements[${elemIdx}].overlays[${itemIdx}].anchor offset`,
        offsetVirtualAddress: getFieldVirtualAddress(item.fields, 'anchor offset', header, tagIndex),
        scaleXFieldPath: `overlay elements[${elemIdx}].overlays[${itemIdx}].width scale`,
        scaleYFieldPath: `overlay elements[${elemIdx}].overlays[${itemIdx}].height scale`,
        visibilityFieldPath: `overlay elements[${elemIdx}].overlays[${itemIdx}].flags`,
        visibilityMode: 'overlay_bit1',
        bitmapFieldPath: `overlay elements[${elemIdx}].overlay bitmap`,
        sequenceFieldPath: `overlay elements[${elemIdx}].overlays[${itemIdx}].sequence index`,
      });
    });
  });

  const leaf = getLeafName(entry.path);
  const title =
    level === 0
      ? `HUD (${leaf})`
      : `Parent HUD ${level} (${leaf})`;

  return {
    level,
    title,
    hudTagIndex: wphiTagIndex,
    hudTagId: entry.tagId,
    hudTagPath: entry.path,
    hudGroup: 'weapon_hud_interface',
    anchorIndex: anchorIdx,
    anchorName,
    anchorFieldPath: 'anchor',
    sharedByPaths,
    elements,
  };
}

/**
 * Parses a `unit_hud_interface` ('unhi') tag into a `LiveHudLevel` so player/vehicle HUDs can also be edited live!
 */
export function parseUnitHudLevel(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  unhiTagIndex: number,
  sharedByPaths: string[] = [],
): LiveHudLevel | null {
  const entry = tagIndex.entries[unhiTagIndex];
  if (!entry || entry.primaryClassName !== 'unit_hud_interface') return null;

  let decoded: ReturnType<typeof readTagFieldValues>;
  try {
    decoded = readTagFieldValues(buffer, header, tagIndex, unhiTagIndex);
  } catch {
    return null;
  }

  const anchorIdx = Math.max(0, Math.min(4, getNumberVal(decoded.fields, 'anchor', 0)));
  const anchorName = HUD_ANCHOR_NAMES[anchorIdx] ?? 'TOP LEFT';
  const elements: LiveHudElementItem[] = [];

  const panelSpecs: Array<{
    key: string;
    name: string;
    category: string;
    offsetField: string;
    scaleXField: string;
    scaleYField: string;
    bitmapField: string;
    seqField: string;
    colorField: string;
  }> = [
    {
      key: 'hud_bg',
      name: 'HUD Background',
      category: 'Unit Panel Static',
      offsetField: 'hud background anchor offset',
      scaleXField: 'hud background width scale',
      scaleYField: 'hud background height scale',
      bitmapField: 'hud background interface bitmap',
      seqField: 'hud background sequence index',
      colorField: 'hud background default color',
    },
    {
      key: 'shield_bg',
      name: 'Shield Panel Background',
      category: 'Shield Panel',
      offsetField: 'shield panel background anchor offset',
      scaleXField: 'shield panel background width scale',
      scaleYField: 'shield panel background height scale',
      bitmapField: 'shield panel background interface bitmap',
      seqField: 'shield panel background sequence index',
      colorField: 'shield panel background default color',
    },
    {
      key: 'shield_meter',
      name: 'Shield Bar Meter',
      category: 'Shield Meter',
      offsetField: 'shield panel meter anchor offset',
      scaleXField: 'shield panel meter width scale',
      scaleYField: 'shield panel meter height scale',
      bitmapField: 'shield panel meter meter bitmap',
      seqField: 'shield panel meter sequence index',
      colorField: 'shield panel meter color at meter maximum',
    },
    {
      key: 'health_bg',
      name: 'Health Panel Background',
      category: 'Health Panel',
      offsetField: 'health panel background anchor offset',
      scaleXField: 'health panel background width scale',
      scaleYField: 'health panel background height scale',
      bitmapField: 'health panel background interface bitmap',
      seqField: 'health panel background sequence index',
      colorField: 'health panel background default color',
    },
    {
      key: 'health_meter',
      name: 'Health Wedges Meter',
      category: 'Health Meter',
      offsetField: 'health panel meter anchor offset',
      scaleXField: 'health panel meter width scale',
      scaleYField: 'health panel meter height scale',
      bitmapField: 'health panel meter meter bitmap',
      seqField: 'health panel meter sequence index',
      colorField: 'health panel meter color at meter maximum',
    },
    {
      key: 'motion_bg',
      name: 'Motion Sensor Background',
      category: 'Motion Sensor',
      offsetField: 'motion sensor background anchor offset',
      scaleXField: 'motion sensor background width scale',
      scaleYField: 'motion sensor background height scale',
      bitmapField: 'motion sensor background interface bitmap',
      seqField: 'motion sensor background sequence index',
      colorField: 'motion sensor background default color',
    },
    {
      key: 'motion_fg',
      name: 'Motion Sensor Foreground',
      category: 'Motion Sensor',
      offsetField: 'motion sensor foreground anchor offset',
      scaleXField: 'motion sensor foreground width scale',
      scaleYField: 'motion sensor foreground height scale',
      bitmapField: 'motion sensor foreground interface bitmap',
      seqField: 'motion sensor foreground sequence index',
      colorField: 'motion sensor foreground default color',
    },
  ];

  panelSpecs.forEach((spec, idx) => {
    const bitm = getDepTarget(decoded.fields, spec.bitmapField, tagIndex);
    const [x, y] = getPoint2DVal(decoded.fields, spec.offsetField);
    const scaleX = getNumberVal(decoded.fields, spec.scaleXField, 1);
    const scaleY = getNumberVal(decoded.fields, spec.scaleYField, 1);
    const seqIdx = getNumberVal(decoded.fields, spec.seqField, 0);
    const color = getNumberVal(decoded.fields, spec.colorField, 0xff4cc9f0);
    if (!bitm.path && x === 0 && y === 0) return;

    elements.push({
      id: `unhi.${spec.key}`,
      hudTagIndex: unhiTagIndex,
      hudTagId: entry.tagId,
      hudTagPath: entry.path,
      hudGroup: 'unit_hud_interface',
      level: 0,
      kind: 'unit_panel',
      elementIndex: idx,
      itemIndex: -1,
      label: bitm.leaf ? `${spec.name} (${bitm.leaf})` : spec.name,
      categoryLabel: spec.category,
      x,
      y,
      scaleX: scaleX || 1,
      scaleY: scaleY || 1,
      hidden: scaleX === 0 && scaleY === 0,
      rawVisibilityValue: 1,
      bitmapTagIndex: bitm.tagIndex,
      bitmapTagId: bitm.tagId,
      bitmapPath: bitm.path,
      bitmapLeaf: bitm.leaf,
      bitmapIsExternal: bitm.isExternal,
      sequenceIndex: seqIdx === 0xffff ? 0 : seqIdx,
      defaultColorArgb: color,
      offsetFieldPath: spec.offsetField,
      offsetVirtualAddress: getFieldVirtualAddress(decoded.fields, spec.offsetField, header, tagIndex),
      scaleXFieldPath: spec.scaleXField,
      scaleYFieldPath: spec.scaleYField,
      visibilityMode: 'scaling_hide',
      bitmapFieldPath: spec.bitmapField,
      sequenceFieldPath: spec.seqField,
    });
  });

  // Auxiliary Overlays
  const auxOverlays = findField(decoded.fields, 'overlays')?.children ?? [];
  auxOverlays.forEach((child: TagReflexiveElement, elemIdx: number) => {
    const [x, y] = getPoint2DVal(child.fields, 'anchor offset');
    const scaleX = getNumberVal(child.fields, 'width scale', 1);
    const scaleY = getNumberVal(child.fields, 'height scale', 1);
    const bitm = getDepTarget(child.fields, 'interface bitmap', tagIndex);
    const seqIdx = getNumberVal(child.fields, 'sequence index', 0);
    const color = getNumberVal(child.fields, 'default color', 0xff4cc9f0);
    elements.push({
      id: `unhi.aux_overlay.${elemIdx}`,
      hudTagIndex: unhiTagIndex,
      hudTagId: entry.tagId,
      hudTagPath: entry.path,
      hudGroup: 'unit_hud_interface',
      level: 0,
      kind: 'unit_panel',
      elementIndex: 100 + elemIdx,
      itemIndex: -1,
      label: bitm.leaf ? `Aux Overlay ${elemIdx + 1} (${bitm.leaf})` : `Aux Overlay ${elemIdx + 1}`,
      categoryLabel: 'Unit Aux Overlay',
      x,
      y,
      scaleX: scaleX || 1,
      scaleY: scaleY || 1,
      hidden: scaleX === 0 && scaleY === 0,
      rawVisibilityValue: 1,
      bitmapTagIndex: bitm.tagIndex,
      bitmapTagId: bitm.tagId,
      bitmapPath: bitm.path,
      bitmapLeaf: bitm.leaf,
      bitmapIsExternal: bitm.isExternal,
      sequenceIndex: seqIdx === 0xffff ? 0 : seqIdx,
      defaultColorArgb: color,
      offsetFieldPath: `overlays[${elemIdx}].anchor offset`,
      offsetVirtualAddress: getFieldVirtualAddress(child.fields, 'anchor offset', header, tagIndex),
      scaleXFieldPath: `overlays[${elemIdx}].width scale`,
      scaleYFieldPath: `overlays[${elemIdx}].height scale`,
      visibilityMode: 'scaling_hide',
      bitmapFieldPath: `overlays[${elemIdx}].interface bitmap`,
      sequenceFieldPath: `overlays[${elemIdx}].sequence index`,
    });
  });

  // Auxiliary Meters
  const auxMeters = findField(decoded.fields, 'meters')?.children ?? [];
  auxMeters.forEach((child: TagReflexiveElement, elemIdx: number) => {
    const [x, y] = getPoint2DVal(child.fields, 'meter anchor offset');
    const scaleX = getNumberVal(child.fields, 'meter width scale', 1);
    const scaleY = getNumberVal(child.fields, 'meter height scale', 1);
    const bitm = getDepTarget(child.fields, 'meter meter bitmap', tagIndex);
    const seqIdx = getNumberVal(child.fields, 'meter sequence index', 0);
    const color = getNumberVal(child.fields, 'meter color at meter maximum', 0xff4cc9f0);
    elements.push({
      id: `unhi.aux_meter.${elemIdx}`,
      hudTagIndex: unhiTagIndex,
      hudTagId: entry.tagId,
      hudTagPath: entry.path,
      hudGroup: 'unit_hud_interface',
      level: 0,
      kind: 'unit_panel',
      elementIndex: 200 + elemIdx,
      itemIndex: -1,
      label: bitm.leaf ? `Aux Meter ${elemIdx + 1} (${bitm.leaf})` : `Aux Meter ${elemIdx + 1}`,
      categoryLabel: 'Unit Aux Meter',
      x,
      y,
      scaleX: scaleX || 1,
      scaleY: scaleY || 1,
      hidden: scaleX === 0 && scaleY === 0,
      rawVisibilityValue: 1,
      bitmapTagIndex: bitm.tagIndex,
      bitmapTagId: bitm.tagId,
      bitmapPath: bitm.path,
      bitmapLeaf: bitm.leaf,
      bitmapIsExternal: bitm.isExternal,
      sequenceIndex: seqIdx === 0xffff ? 0 : seqIdx,
      defaultColorArgb: color,
      offsetFieldPath: `meters[${elemIdx}].meter anchor offset`,
      offsetVirtualAddress: getFieldVirtualAddress(child.fields, 'meter anchor offset', header, tagIndex),
      scaleXFieldPath: `meters[${elemIdx}].meter width scale`,
      scaleYFieldPath: `meters[${elemIdx}].meter height scale`,
      visibilityMode: 'scaling_hide',
      bitmapFieldPath: `meters[${elemIdx}].meter meter bitmap`,
      sequenceFieldPath: `meters[${elemIdx}].meter sequence index`,
    });
  });

  return {
    level: 0,
    title: `Unit HUD (${getLeafName(entry.path)})`,
    hudTagIndex: unhiTagIndex,
    hudTagId: entry.tagId,
    hudTagPath: entry.path,
    hudGroup: 'unit_hud_interface',
    anchorIndex: anchorIdx,
    anchorName,
    anchorFieldPath: 'anchor',
    sharedByPaths,
    elements,
  };
}

/**
 * Parses a `hud_globals` ('hudg') tag into a `LiveHudLevel`.
 */
export function parseGlobalHudLevel(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  hudgTagIndex: number,
): LiveHudLevel | null {
  const entry = tagIndex.entries[hudgTagIndex];
  if (!entry || entry.primaryClassName !== 'hud_globals') return null;

  let decoded: ReturnType<typeof readTagFieldValues>;
  try {
    decoded = readTagFieldValues(buffer, header, tagIndex, hudgTagIndex);
  } catch {
    return null;
  }

  const anchorIdx = Math.max(0, Math.min(4, getNumberVal(decoded.fields, 'anchor', 0)));
  const anchorName = HUD_ANCHOR_NAMES[anchorIdx] ?? 'TOP LEFT';
  const elements: LiveHudElementItem[] = [];

  // Grenade HUD background & numbers
  const grenBitm = getDepTarget(decoded.fields, 'interface bitmap', tagIndex);
  const [gx, gy] = getPoint2DVal(decoded.fields, 'anchor offset');
  const gScaleX = getNumberVal(decoded.fields, 'width scale', 1);
  const gScaleY = getNumberVal(decoded.fields, 'height scale', 1);
  const gSeq = getNumberVal(decoded.fields, 'sequence index', 0);
  const gColor = getNumberVal(decoded.fields, 'default color', 0xff4cc9f0);
  if (grenBitm.path || gx !== 0 || gy !== 0) {
    elements.push({
      id: 'hudg.grenade_bg',
      hudTagIndex: hudgTagIndex,
      hudTagId: entry.tagId,
      hudTagPath: entry.path,
      hudGroup: 'hud_globals',
      level: 0,
      kind: 'global_element',
      elementIndex: 0,
      itemIndex: -1,
      label: grenBitm.leaf ? `Grenade Panel (${grenBitm.leaf})` : 'Grenade Panel',
      categoryLabel: 'Global HUD / Grenades',
      x: gx,
      y: gy,
      scaleX: gScaleX || 1,
      scaleY: gScaleY || 1,
      hidden: gScaleX === 0 && gScaleY === 0,
      rawVisibilityValue: 1,
      bitmapTagIndex: grenBitm.tagIndex,
      bitmapTagId: grenBitm.tagId,
      bitmapPath: grenBitm.path,
      bitmapLeaf: grenBitm.leaf,
      bitmapIsExternal: grenBitm.isExternal,
      sequenceIndex: gSeq === 0xffff ? 0 : gSeq,
      defaultColorArgb: gColor,
      offsetFieldPath: 'anchor offset',
      offsetVirtualAddress: getFieldVirtualAddress(decoded.fields, 'anchor offset', header, tagIndex),
      scaleXFieldPath: 'width scale',
      scaleYFieldPath: 'height scale',
      visibilityMode: 'scaling_hide',
      bitmapFieldPath: 'interface bitmap',
      sequenceFieldPath: 'sequence index',
    });
  }

  // Waypoint arrow bitmaps
  const wpBitm = getDepTarget(decoded.fields, 'waypoint arrows bitmap', tagIndex);
  if (wpBitm.path) {
    elements.push({
      id: 'hudg.waypoint_arrows',
      hudTagIndex: hudgTagIndex,
      hudTagId: entry.tagId,
      hudTagPath: entry.path,
      hudGroup: 'hud_globals',
      level: 0,
      kind: 'global_element',
      elementIndex: 1,
      itemIndex: -1,
      label: `Waypoint Arrows (${wpBitm.leaf})`,
      categoryLabel: 'Global HUD / Waypoints',
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      hidden: false,
      rawVisibilityValue: 1,
      bitmapTagIndex: wpBitm.tagIndex,
      bitmapTagId: wpBitm.tagId,
      bitmapPath: wpBitm.path,
      bitmapLeaf: wpBitm.leaf,
      bitmapIsExternal: wpBitm.isExternal,
      sequenceIndex: 0,
      defaultColorArgb: 0xff4cc9f0,
      offsetFieldPath: 'anchor offset',
      offsetVirtualAddress: getFieldVirtualAddress(decoded.fields, 'anchor offset', header, tagIndex),
      scaleXFieldPath: 'width scale',
      scaleYFieldPath: 'height scale',
      bitmapFieldPath: 'waypoint arrows bitmap',
    });
  }

  return {
    level: 0,
    title: `Global HUD (${getLeafName(entry.path)})`,
    hudTagIndex: hudgTagIndex,
    hudTagId: entry.tagId,
    hudTagPath: entry.path,
    hudGroup: 'hud_globals',
    anchorIndex: anchorIdx,
    anchorName,
    anchorFieldPath: 'anchor',
    sharedByPaths: [],
    elements,
  };
}

/**
 * Extracts editable weapon stats matching Ultimate Edition's `tag_editor.c` (`edit_fields`).
 */
function extractWeaponStats(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  weapTagIndex: number,
  weapFields: TagFieldDescriptor[],
): LiveWeaponStatField[] {
  const weapEntry = tagIndex.entries[weapTagIndex];
  if (!weapEntry) return [];
  const stats: LiveWeaponStatField[] = [];
  const RAD_TO_DEG = 180 / Math.PI;
  const TICKS_PER_SEC = 30;

  const zoomField = findField(weapFields, 'zoom magnification range');
  const zoomBounds = Array.isArray(zoomField?.value) ? (zoomField!.value as number[]) : [1, 1];

  stats.push(
    {
      key: 'weapon.zoom_min',
      label: 'Zoom (first)',
      category: 'weapon',
      targetTagIndex: weapTagIndex,
      targetTagPath: weapEntry.path,
      fieldPath: 'zoom magnification range',
      boundsIndex: 0,
      value: Number((zoomBounds[0] ?? 1).toFixed(2)),
      step: 0.1,
      min: 1.0,
      max: 20.0,
      unit: 'x',
    },
    {
      key: 'weapon.zoom_max',
      label: 'Zoom (last)',
      category: 'weapon',
      targetTagIndex: weapTagIndex,
      targetTagPath: weapEntry.path,
      fieldPath: 'zoom magnification range',
      boundsIndex: 1,
      value: Number((zoomBounds[1] ?? 1).toFixed(2)),
      step: 0.1,
      min: 1.0,
      max: 20.0,
      unit: 'x',
    },
    {
      key: 'weapon.heat_overheat',
      label: 'Overheats at',
      category: 'weapon',
      targetTagIndex: weapTagIndex,
      targetTagPath: weapEntry.path,
      fieldPath: 'overheated threshold',
      value: Number(getNumberVal(weapFields, 'overheated threshold', 1).toFixed(2)),
      step: 0.05,
      min: 0.0,
      max: 1.0,
    },
    {
      key: 'weapon.heat_recover',
      label: 'Cools down to',
      category: 'weapon',
      targetTagIndex: weapTagIndex,
      targetTagPath: weapEntry.path,
      fieldPath: 'heat recovery threshold',
      value: Number(getNumberVal(weapFields, 'heat recovery threshold', 0.5).toFixed(2)),
      step: 0.05,
      min: 0.0,
      max: 1.0,
    },
    {
      key: 'weapon.heat_loss',
      label: 'Heat lost a second',
      category: 'weapon',
      targetTagIndex: weapTagIndex,
      targetTagPath: weapEntry.path,
      fieldPath: 'heat loss rate',
      value: Number(getNumberVal(weapFields, 'heat loss rate', 0.2).toFixed(2)),
      step: 0.05,
      min: 0.0,
      max: 10.0,
      unit: '/s',
    },
    {
      key: 'weapon.autoaim_angle',
      label: 'Autoaim angle (deg)',
      category: 'weapon',
      targetTagIndex: weapTagIndex,
      targetTagPath: weapEntry.path,
      fieldPath: 'autoaim angle',
      value: Number((getNumberVal(weapFields, 'autoaim angle', 0) * RAD_TO_DEG).toFixed(1)),
      step: 0.5,
      min: 0.0,
      max: 45.0,
      unit: 'deg',
      conversion: 'rad_to_deg',
    },
    {
      key: 'weapon.autoaim_range',
      label: 'Autoaim range',
      category: 'weapon',
      targetTagIndex: weapTagIndex,
      targetTagPath: weapEntry.path,
      fieldPath: 'autoaim range',
      value: Number(getNumberVal(weapFields, 'autoaim range', 10).toFixed(1)),
      step: 1.0,
      min: 0.0,
      max: 1000.0,
      unit: 'wu',
    },
    {
      key: 'weapon.magnetism_angle',
      label: 'Magnetism angle (deg)',
      category: 'weapon',
      targetTagIndex: weapTagIndex,
      targetTagPath: weapEntry.path,
      fieldPath: 'magnetism angle',
      value: Number((getNumberVal(weapFields, 'magnetism angle', 0) * RAD_TO_DEG).toFixed(1)),
      step: 0.5,
      min: 0.0,
      max: 45.0,
      unit: 'deg',
      conversion: 'rad_to_deg',
    },
    {
      key: 'weapon.magnetism_range',
      label: 'Magnetism range',
      category: 'weapon',
      targetTagIndex: weapTagIndex,
      targetTagPath: weapEntry.path,
      fieldPath: 'magnetism range',
      value: Number(getNumberVal(weapFields, 'magnetism range', 10).toFixed(1)),
      step: 1.0,
      min: 0.0,
      max: 1000.0,
      unit: 'wu',
    },
    {
      key: 'weapon.move_penalty_forward',
      label: 'Slows walking',
      category: 'weapon',
      targetTagIndex: weapTagIndex,
      targetTagPath: weapEntry.path,
      fieldPath: 'forward movement penalty',
      value: Number(getNumberVal(weapFields, 'forward movement penalty', 0).toFixed(2)),
      step: 0.05,
      min: 0.0,
      max: 1.0,
    },
    {
      key: 'weapon.move_penalty_sideways',
      label: 'Slows strafing',
      category: 'weapon',
      targetTagIndex: weapTagIndex,
      targetTagPath: weapEntry.path,
      fieldPath: 'sideways movement penalty',
      value: Number(getNumberVal(weapFields, 'sideways movement penalty', 0).toFixed(2)),
      step: 0.05,
      min: 0.0,
      max: 1.0,
    },
  );

  // Triggers (0 and 1)
  const triggers = findField(weapFields, 'triggers')?.children ?? [];
  triggers.slice(0, 2).forEach((trig: TagReflexiveElement, trigIdx: number) => {
    const cat = trigIdx === 0 ? 'trigger0' : 'trigger1';
    const rofField = findField(trig.fields, 'maximum rate of fire');
    const rofBounds = Array.isArray(rofField?.value) ? (rofField!.value as number[]) : [0, 0];
    const errAngleField = findField(trig.fields, 'error angle');
    const errAngleBounds = Array.isArray(errAngleField?.value) ? (errAngleField!.value as number[]) : [0, 0];

    stats.push(
      {
        key: `trigger${trigIdx}.rate_of_fire_min`,
        label: 'Rate of fire (first)',
        category: cat,
        targetTagIndex: weapTagIndex,
        targetTagPath: weapEntry.path,
        fieldPath: `triggers[${trigIdx}].maximum rate of fire`,
        boundsIndex: 0,
        value: Number((rofBounds[0] ?? 0).toFixed(1)),
        step: 0.5,
        min: 0.0,
        max: 120.0,
        unit: '/s',
      },
      {
        key: `trigger${trigIdx}.rate_of_fire_max`,
        label: 'Rate of fire (held)',
        category: cat,
        targetTagIndex: weapTagIndex,
        targetTagPath: weapEntry.path,
        fieldPath: `triggers[${trigIdx}].maximum rate of fire`,
        boundsIndex: 1,
        value: Number((rofBounds[1] ?? 0).toFixed(1)),
        step: 0.5,
        min: 0.0,
        max: 120.0,
        unit: '/s',
      },
      {
        key: `trigger${trigIdx}.rounds_per_shot`,
        label: 'Rounds a shot',
        category: cat,
        targetTagIndex: weapTagIndex,
        targetTagPath: weapEntry.path,
        fieldPath: `triggers[${trigIdx}].rounds per shot`,
        value: getNumberVal(trig.fields, 'rounds per shot', 1),
        step: 1,
        min: 0,
        max: 100,
      },
      {
        key: `trigger${trigIdx}.projectiles_per_shot`,
        label: 'Projectiles a shot',
        category: cat,
        targetTagIndex: weapTagIndex,
        targetTagPath: weapEntry.path,
        fieldPath: `triggers[${trigIdx}].projectiles per shot`,
        value: getNumberVal(trig.fields, 'projectiles per shot', 1),
        step: 1,
        min: 1,
        max: 64,
      },
      {
        key: `trigger${trigIdx}.spread_min`,
        label: 'Spread (first, deg)',
        category: cat,
        targetTagIndex: weapTagIndex,
        targetTagPath: weapEntry.path,
        fieldPath: `triggers[${trigIdx}].error angle`,
        boundsIndex: 0,
        value: Number(((errAngleBounds[0] ?? 0) * RAD_TO_DEG).toFixed(2)),
        step: 0.1,
        min: 0.0,
        max: 45.0,
        unit: 'deg',
        conversion: 'rad_to_deg',
      },
      {
        key: `trigger${trigIdx}.spread_max`,
        label: 'Spread (held, deg)',
        category: cat,
        targetTagIndex: weapTagIndex,
        targetTagPath: weapEntry.path,
        fieldPath: `triggers[${trigIdx}].error angle`,
        boundsIndex: 1,
        value: Number(((errAngleBounds[1] ?? 0) * RAD_TO_DEG).toFixed(2)),
        step: 0.1,
        min: 0.0,
        max: 45.0,
        unit: 'deg',
        conversion: 'rad_to_deg',
      },
      {
        key: `trigger${trigIdx}.distribution_angle`,
        label: 'Pellet spread (deg)',
        category: cat,
        targetTagIndex: weapTagIndex,
        targetTagPath: weapEntry.path,
        fieldPath: `triggers[${trigIdx}].distribution angle`,
        value: Number((getNumberVal(trig.fields, 'distribution angle', 0) * RAD_TO_DEG).toFixed(2)),
        step: 0.5,
        min: 0.0,
        max: 90.0,
        unit: 'deg',
        conversion: 'rad_to_deg',
      },
      {
        key: `trigger${trigIdx}.heat_per_round`,
        label: 'Heat a round',
        category: cat,
        targetTagIndex: weapTagIndex,
        targetTagPath: weapEntry.path,
        fieldPath: `triggers[${trigIdx}].heat generated per round`,
        value: Number(getNumberVal(trig.fields, 'heat generated per round', 0).toFixed(2)),
        step: 0.01,
        min: 0.0,
        max: 1.0,
      },
      {
        key: `trigger${trigIdx}.charging_time`,
        label: 'Charging time (s)',
        category: cat,
        targetTagIndex: weapTagIndex,
        targetTagPath: weapEntry.path,
        fieldPath: `triggers[${trigIdx}].charging time`,
        value: Number(getNumberVal(trig.fields, 'charging time', 0).toFixed(2)),
        step: 0.1,
        min: 0.0,
        max: 10.0,
        unit: 's',
      },
    );

    // Projectile for this trigger
    const projDep = getDepTarget(trig.fields, 'projectile', tagIndex);
    if (projDep.tagIndex !== null) {
      try {
        const projDecoded = readTagFieldValues(buffer, header, tagIndex, projDep.tagIndex);
        const projCat = trigIdx === 0 ? 'projectile0' : 'projectile1';
        const dmgRangeField = findField(projDecoded.fields, 'air damage range');
        const dmgRange = Array.isArray(dmgRangeField?.value) ? (dmgRangeField!.value as number[]) : [0, 0];
        const timerField = findField(projDecoded.fields, 'timer');
        const timerBounds = Array.isArray(timerField?.value) ? (timerField!.value as number[]) : [0, 0];

        stats.push(
          {
            key: `projectile${trigIdx}.speed`,
            label: 'Speed',
            category: projCat,
            targetTagIndex: projDep.tagIndex,
            targetTagPath: projDep.path,
            fieldPath: 'initial velocity',
            value: Number((getNumberVal(projDecoded.fields, 'initial velocity', 0) * TICKS_PER_SEC).toFixed(1)),
            step: 5.0,
            min: 0.0,
            max: 3000.0,
            unit: 'wu/s',
            conversion: 'tick_to_sec',
          },
          {
            key: `projectile${trigIdx}.final_speed`,
            label: 'Speed (slowed to)',
            category: projCat,
            targetTagIndex: projDep.tagIndex,
            targetTagPath: projDep.path,
            fieldPath: 'final velocity',
            value: Number((getNumberVal(projDecoded.fields, 'final velocity', 0) * TICKS_PER_SEC).toFixed(1)),
            step: 5.0,
            min: 0.0,
            max: 3000.0,
            unit: 'wu/s',
            conversion: 'tick_to_sec',
          },
          {
            key: `projectile${trigIdx}.gravity`,
            label: 'Gravity',
            category: projCat,
            targetTagIndex: projDep.tagIndex,
            targetTagPath: projDep.path,
            fieldPath: 'air gravity scale',
            value: Number(getNumberVal(projDecoded.fields, 'air gravity scale', 1).toFixed(2)),
            step: 0.05,
            min: 0.0,
            max: 10.0,
          },
          {
            key: `projectile${trigIdx}.range`,
            label: 'Range',
            category: projCat,
            targetTagIndex: projDep.tagIndex,
            targetTagPath: projDep.path,
            fieldPath: 'maximum range',
            value: Number(getNumberVal(projDecoded.fields, 'maximum range', 100).toFixed(1)),
            step: 5.0,
            min: 0.0,
            max: 10000.0,
            unit: 'wu',
          },
          {
            key: `projectile${trigIdx}.falloff_start`,
            label: 'Damage falls from',
            category: projCat,
            targetTagIndex: projDep.tagIndex,
            targetTagPath: projDep.path,
            fieldPath: 'air damage range',
            boundsIndex: 0,
            value: Number((dmgRange[0] ?? 0).toFixed(1)),
            step: 1.0,
            min: 0.0,
            max: 10000.0,
            unit: 'wu',
          },
          {
            key: `projectile${trigIdx}.falloff_end`,
            label: 'Damage gone at',
            category: projCat,
            targetTagIndex: projDep.tagIndex,
            targetTagPath: projDep.path,
            fieldPath: 'air damage range',
            boundsIndex: 1,
            value: Number((dmgRange[1] ?? 0).toFixed(1)),
            step: 1.0,
            min: 0.0,
            max: 10000.0,
            unit: 'wu',
          },
          {
            key: `projectile${trigIdx}.arming_time`,
            label: 'Arming time (s)',
            category: projCat,
            targetTagIndex: projDep.tagIndex,
            targetTagPath: projDep.path,
            fieldPath: 'arming time',
            value: Number(getNumberVal(projDecoded.fields, 'arming time', 0).toFixed(2)),
            step: 0.05,
            min: 0.0,
            max: 10.0,
            unit: 's',
          },
          {
            key: `projectile${trigIdx}.timer_min`,
            label: 'Fuse (shortest, s)',
            category: projCat,
            targetTagIndex: projDep.tagIndex,
            targetTagPath: projDep.path,
            fieldPath: 'timer',
            boundsIndex: 0,
            value: Number((timerBounds[0] ?? 0).toFixed(2)),
            step: 0.1,
            min: 0.0,
            max: 30.0,
            unit: 's',
          },
          {
            key: `projectile${trigIdx}.timer_max`,
            label: 'Fuse (longest, s)',
            category: projCat,
            targetTagIndex: projDep.tagIndex,
            targetTagPath: projDep.path,
            fieldPath: 'timer',
            boundsIndex: 1,
            value: Number((timerBounds[1] ?? 0).toFixed(2)),
            step: 0.1,
            min: 0.0,
            max: 30.0,
            unit: 's',
          },
        );

        // Impact & Stuck damage effects on this projectile
        const impactDep = getDepTarget(projDecoded.fields, 'impact damage', tagIndex);
        if (impactDep.tagIndex !== null) {
          appendDamageEffectStats(
            buffer,
            header,
            tagIndex,
            impactDep.tagIndex,
            impactDep.path,
            `projectile${trigIdx}.impact`,
            trigIdx === 0 ? 'damage_impact0' : 'damage_impact1',
            stats,
          );
        }
        const stuckDep = getDepTarget(projDecoded.fields, 'attached detonation damage', tagIndex);
        if (stuckDep.tagIndex !== null) {
          appendDamageEffectStats(
            buffer,
            header,
            tagIndex,
            stuckDep.tagIndex,
            stuckDep.path,
            `projectile${trigIdx}.stuck`,
            trigIdx === 0 ? 'damage_stuck0' : 'damage_stuck1',
            stats,
          );
        }
      } catch {
        // Ignore unreadable projectile
      }
    }
  });

  // Magazines (0 and 1)
  const magazines = findField(weapFields, 'magazines')?.children ?? [];
  magazines.slice(0, 2).forEach((mag: TagReflexiveElement, magIdx: number) => {
    const cat = magIdx === 0 ? 'magazine0' : 'magazine1';
    stats.push(
      {
        key: `magazine${magIdx}.size`,
        label: 'Magazine',
        category: cat,
        targetTagIndex: weapTagIndex,
        targetTagPath: weapEntry.path,
        fieldPath: `magazines[${magIdx}].rounds loaded maximum`,
        value: getNumberVal(mag.fields, 'rounds loaded maximum', 1),
        step: 1,
        min: 1,
        max: 999,
      },
      {
        key: `magazine${magIdx}.total_initial`,
        label: 'Ammo picked up',
        category: cat,
        targetTagIndex: weapTagIndex,
        targetTagPath: weapEntry.path,
        fieldPath: `magazines[${magIdx}].rounds total initial`,
        value: getNumberVal(mag.fields, 'rounds total initial', 0),
        step: 1,
        min: 0,
        max: 9999,
      },
      {
        key: `magazine${magIdx}.total_maximum`,
        label: 'Ammo carried',
        category: cat,
        targetTagIndex: weapTagIndex,
        targetTagPath: weapEntry.path,
        fieldPath: `magazines[${magIdx}].rounds reserved maximum`,
        value: getNumberVal(mag.fields, 'rounds reserved maximum', 0),
        step: 1,
        min: 0,
        max: 9999,
      },
      {
        key: `magazine${magIdx}.rounds_reloaded`,
        label: 'Rounds a reload',
        category: cat,
        targetTagIndex: weapTagIndex,
        targetTagPath: weapEntry.path,
        fieldPath: `magazines[${magIdx}].rounds reloaded`,
        value: getNumberVal(mag.fields, 'rounds reloaded', 1),
        step: 1,
        min: 1,
        max: 999,
      },
      {
        key: `magazine${magIdx}.recharge`,
        label: 'Recharged a second',
        category: cat,
        targetTagIndex: weapTagIndex,
        targetTagPath: weapEntry.path,
        fieldPath: `magazines[${magIdx}].rounds recharged`,
        value: getNumberVal(mag.fields, 'rounds recharged', 0),
        step: 1,
        min: 0,
        max: 999,
      },
    );
  });

  // Melee damage
  const meleeDep = getDepTarget(weapFields, 'player melee damage', tagIndex);
  if (meleeDep.tagIndex !== null) {
    appendDamageEffectStats(
      buffer,
      header,
      tagIndex,
      meleeDep.tagIndex,
      meleeDep.path,
      'melee',
      'damage_melee',
      stats,
    );
  }

  return stats;
}

function appendDamageEffectStats(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  jptTagIndex: number,
  jptPath: string,
  keyPrefix: string,
  category: LiveWeaponStatField['category'],
  outStats: LiveWeaponStatField[],
): void {
  try {
    const decoded = readTagFieldValues(buffer, header, tagIndex, jptTagIndex);
    const radiusField = findField(decoded.fields, 'radius');
    const radiusBounds = Array.isArray(radiusField?.value) ? (radiusField!.value as number[]) : [0, 0];
    const upperDmgField = findField(decoded.fields, 'damage upper bound');
    const upperDmgBounds = Array.isArray(upperDmgField?.value) ? (upperDmgField!.value as number[]) : [0, 0];

    outStats.push(
      {
        key: `${keyPrefix}.damage_min`,
        label: 'Damage (least)',
        category,
        targetTagIndex: jptTagIndex,
        targetTagPath: jptPath,
        fieldPath: 'damage lower bound',
        value: Number(getNumberVal(decoded.fields, 'damage lower bound', 0).toFixed(1)),
        step: 0.5,
        min: 0.0,
        max: 10000.0,
      },
      {
        key: `${keyPrefix}.damage_max`,
        label: 'Damage (most)',
        category,
        targetTagIndex: jptTagIndex,
        targetTagPath: jptPath,
        fieldPath: 'damage upper bound',
        boundsIndex: 0,
        value: Number((upperDmgBounds[0] ?? 0).toFixed(1)),
        step: 0.5,
        min: 0.0,
        max: 10000.0,
      },
      {
        key: `${keyPrefix}.falloff`,
        label: 'Full damage within',
        category,
        targetTagIndex: jptTagIndex,
        targetTagPath: jptPath,
        fieldPath: 'radius',
        boundsIndex: 0,
        value: Number((radiusBounds[0] ?? 0).toFixed(2)),
        step: 0.1,
        min: 0.0,
        max: 100.0,
        unit: 'wu',
      },
      {
        key: `${keyPrefix}.radius`,
        label: 'Radius',
        category,
        targetTagIndex: jptTagIndex,
        targetTagPath: jptPath,
        fieldPath: 'radius',
        boundsIndex: 1,
        value: Number((radiusBounds[1] ?? 0).toFixed(2)),
        step: 0.1,
        min: 0.0,
        max: 100.0,
        unit: 'wu',
      },
      {
        key: `${keyPrefix}.stun`,
        label: 'Stun',
        category,
        targetTagIndex: jptTagIndex,
        targetTagPath: jptPath,
        fieldPath: 'damage stun',
        value: Number(getNumberVal(decoded.fields, 'damage stun', 0).toFixed(2)),
        step: 0.05,
        min: 0.0,
        max: 1.0,
      },
    );
  } catch {
    // Ignore unreadable damage_effect
  }
}

/**
 * Walks up to 16 levels of a weapon's `hud interface` -> `child hud` chain.
 */
function resolveWeaponHudChainIndices(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  firstWphiTagIndex: number,
): number[] {
  const chain: number[] = [];
  let cur: number | null = firstWphiTagIndex;
  const visited = new Set<number>();

  while (cur !== null && chain.length < 16 && !visited.has(cur)) {
    visited.add(cur);
    const entry = tagIndex.entries[cur];
    if (!entry || entry.primaryClassName !== 'weapon_hud_interface') break;
    chain.push(cur);
    try {
      const decoded = readTagFieldValues(buffer, header, tagIndex, cur);
      const parentDep = getDepTarget(decoded.fields, 'child hud', tagIndex);
      cur = parentDep.tagIndex;
    } catch {
      break;
    }
  }
  return chain;
}

/**
 * Determines which `weapon` ('weap') tags in the open map can actually be held on foot by the Spartan
 * (excluding vehicle-mounted weapons like `warthog gun`, `scorpion gun`, `ghost gun`, `banshee gun`,
 * `c_gun_turret`, `wraith mortar`, and any weapon whose animation `label` is not supported by the Spartan).
 */
export function collectSpartanHoldableWeaponIndices(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
): Set<number> {
  const vehicleWeaponIndices = new Set<number>();
  for (const entry of tagIndex.entries) {
    if (entry.primaryClassName !== 'vehicle' || entry.isExternal) continue;
    try {
      const vehDecoded = readTagFieldValues(buffer, header, tagIndex, entry.index);
      const vehWeapons = findField(vehDecoded.fields, 'weapons')?.children ?? [];
      for (const vw of vehWeapons) {
        const wDep = getDepTarget(vw.fields, 'weapon', tagIndex);
        if (wDep.tagIndex !== null) {
          vehicleWeaponIndices.add(wDep.tagIndex);
        }
      }
    } catch {
      // ignore unreadable vehicle
    }
  }

  // Standard Halo CE Spartan on-foot weapon animation labels + any custom labels on the map's player biped antr
  const allowedLabels = new Set<string>([
    'ar',
    'hp',
    'pr',
    'pp',
    'rl',
    'sr',
    'sg',
    'ne',
    'ft',
    'fc',
    'flag',
    'ball',
    'br',
    'smg',
    'cs',
    'gl',
    'sp',
  ]);

  for (const entry of tagIndex.entries) {
    if (entry.primaryClassName !== 'biped' || entry.isExternal) continue;
    const normPath = entry.path.replace(/\//g, '\\').toLowerCase();
    if (!normPath.includes('cyborg') && !normPath.includes('spartan') && !normPath.includes('masterchief')) {
      continue;
    }
    try {
      const bipedDecoded = readTagFieldValues(buffer, header, tagIndex, entry.index);
      const antrDep = getDepTarget(bipedDecoded.fields, 'animation graph', tagIndex);
      if (antrDep.tagIndex === null) continue;
      const antrDecoded = readTagFieldValues(buffer, header, tagIndex, antrDep.tagIndex);
      const units = findField(antrDecoded.fields, 'units')?.children ?? [];
      for (const seat of units) {
        const seatLabelField = findField(seat.fields, 'label');
        const seatLabel = typeof seatLabelField?.value === 'string' ? seatLabelField.value.trim().toLowerCase() : '';
        // Skip vehicle seats (w-gunner, g-driver, b-driver, s-driver, c-driver, turret, etc.)
        if (
          seatLabel &&
          seatLabel !== 'stand' &&
          seatLabel !== 'alert' &&
          seatLabel !== 'crouch' &&
          seatLabel !== 'flee' &&
          seatLabel !== 'flaming'
        ) {
          continue;
        }
        const seatWeapons = findField(seat.fields, 'weapons')?.children ?? [];
        for (const sw of seatWeapons) {
          const weaponTypes = findField(sw.fields, 'weapon types')?.children ?? [];
          for (const wt of weaponTypes) {
            const wtLabelField = findField(wt.fields, 'label');
            const wtLabel = typeof wtLabelField?.value === 'string' ? wtLabelField.value.trim().toLowerCase() : '';
            if (wtLabel && wtLabel !== 'gun' && wtLabel !== 'unarmed') {
              allowedLabels.add(wtLabel);
            }
          }
        }
      }
    } catch {
      // ignore unreadable biped/antr
    }
  }

  const nonHoldableNamePattern =
    /(\bwarthog\b|\bscorpion\b|\bghost[\s_-]*gun\b|\bbanshee\b|\bwraith\b|\bturret\b|\bpelican\b|\bdropship\b|\bphantom\b|\bscarab\b|\bmounted\b|\bunarmed\b|\benergy[\s_-]*blade[\s_-]*useless\b)/i;

  const holdable = new Set<number>();
  for (const entry of tagIndex.entries) {
    if (entry.primaryClassName !== 'weapon' || entry.isExternal) continue;
    if (vehicleWeaponIndices.has(entry.index)) continue;

    const normPath = entry.path.replace(/\//g, '\\').toLowerCase();
    if (normPath.startsWith('vehicles\\') || nonHoldableNamePattern.test(normPath)) {
      continue;
    }

    try {
      const decoded = readTagFieldValues(buffer, header, tagIndex, entry.index);
      const labelField = findField(decoded.fields, 'label');
      const weapLabel = typeof labelField?.value === 'string' ? labelField.value.trim().toLowerCase() : '';
      if (!weapLabel || weapLabel === 'gun' || !allowedLabels.has(weapLabel)) {
        continue;
      }
      const fpModelDep = getDepTarget(decoded.fields, 'first person model', tagIndex);
      const hudDep = getDepTarget(decoded.fields, 'hud interface', tagIndex);
      if (fpModelDep.tagIndex === null && hudDep.tagIndex === null) {
        continue;
      }
      holdable.add(entry.index);
    } catch {
      // ignore unreadable weapon
    }
  }

  return holdable;
}

/**
 * Inspects the open map buffer and returns a complete catalog of Spartan-holdable Weapons, Vehicles,
 * Unit HUDs, Global HUDs, UI Widgets (`DeLa`), and Unicode String Lists (`ustr`).
 */
export function inspectMapHudAndUiTargets(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
): LiveHudCatalog {
  const holdableWeaponIndices = collectSpartanHoldableWeaponIndices(buffer, header, tagIndex);

  // First pass: map wphiTagIndex -> list of weapon paths that use it
  const wphiSharers = new Map<number, string[]>();
  const weaponRawChains = new Map<number, { fields: TagFieldDescriptor[]; chain: number[] }>();

  for (const entry of tagIndex.entries) {
    if (entry.primaryClassName !== 'weapon' || entry.isExternal) continue;
    try {
      const decoded = readTagFieldValues(buffer, header, tagIndex, entry.index);
      const hudDep = getDepTarget(decoded.fields, 'hud interface', tagIndex);
      const chain = hudDep.tagIndex !== null
        ? resolveWeaponHudChainIndices(buffer, header, tagIndex, hudDep.tagIndex)
        : [];
      weaponRawChains.set(entry.index, { fields: decoded.fields, chain });
      if (holdableWeaponIndices.has(entry.index)) {
        for (const wphiIdx of chain) {
          const list = wphiSharers.get(wphiIdx) ?? [];
          if (!list.includes(entry.path)) list.push(entry.path);
          wphiSharers.set(wphiIdx, list);
        }
      }
    } catch {
      // Skip unreadable weapon
    }
  }

  // Build Spartan-holdable weapons list
  const weapons: LiveWeaponEntry[] = [];
  for (const entry of tagIndex.entries) {
    if (entry.primaryClassName !== 'weapon' || entry.isExternal) continue;
    if (!holdableWeaponIndices.has(entry.index)) continue;
    const raw = weaponRawChains.get(entry.index);
    if (!raw) continue;

    const hudChain: LiveHudLevel[] = [];
    raw.chain.forEach((wphiIdx, level) => {
      const sharers = (wphiSharers.get(wphiIdx) ?? []).filter((p) => p !== entry.path);
      const parsed = parseWeaponHudLevel(buffer, header, tagIndex, wphiIdx, level, sharers);
      if (parsed) hudChain.push(parsed);
    });

    const pickupMsgIdx = getNumberVal(raw.fields, 'pickup message index', 0);
    const stats = extractWeaponStats(buffer, header, tagIndex, entry.index, raw.fields);

    weapons.push({
      tagIndex: entry.index,
      tagId: entry.tagId,
      path: entry.path,
      displayName: formatDisplayName(entry.path),
      pickupMessageIndex: pickupMsgIdx === 0xffff ? 0 : pickupMsgIdx,
      hudChain,
      stats,
    });
  }

  // Build vehicles list
  const vehicles: LiveVehicleEntry[] = [];
  for (const entry of tagIndex.entries) {
    if (entry.primaryClassName !== 'vehicle' || entry.isExternal) continue;
    try {
      const decoded = readTagFieldValues(buffer, header, tagIndex, entry.index);
      let unitHud: LiveHudLevel | null = null;
      const newUnitHuds = findField(decoded.fields, 'new unit hud interface')?.children ?? [];
      if (newUnitHuds.length > 0) {
        const unhiDep = getDepTarget(newUnitHuds[0].fields, 'unit hud interface', tagIndex);
        if (unhiDep.tagIndex !== null) {
          unitHud = parseUnitHudLevel(buffer, header, tagIndex, unhiDep.tagIndex);
        }
      }

      const weaponHudChain: LiveHudLevel[] = [];
      const vehWeapons = findField(decoded.fields, 'weapons')?.children ?? [];
      if (vehWeapons.length > 0) {
        const weapDep = getDepTarget(vehWeapons[0].fields, 'weapon', tagIndex);
        if (weapDep.tagIndex !== null) {
          const rawVehWeap = weaponRawChains.get(weapDep.tagIndex);
          if (rawVehWeap) {
            rawVehWeap.chain.forEach((wphiIdx, lvl) => {
              const p = parseWeaponHudLevel(buffer, header, tagIndex, wphiIdx, lvl, []);
              if (p) weaponHudChain.push(p);
            });
          } else {
            const weapDecoded = readTagFieldValues(buffer, header, tagIndex, weapDep.tagIndex);
            const hudDep = getDepTarget(weapDecoded.fields, 'hud interface', tagIndex);
            if (hudDep.tagIndex !== null) {
              const chain = resolveWeaponHudChainIndices(buffer, header, tagIndex, hudDep.tagIndex);
              chain.forEach((wphiIdx, lvl) => {
                const p = parseWeaponHudLevel(buffer, header, tagIndex, wphiIdx, lvl, []);
                if (p) weaponHudChain.push(p);
              });
            }
          }
        }
      }

      vehicles.push({
        tagIndex: entry.index,
        tagId: entry.tagId,
        path: entry.path,
        displayName: formatDisplayName(entry.path),
        unitHud,
        weaponHudChain,
      });
    } catch {
      // Skip unreadable vehicle
    }
  }

  // All Unit HUDs in map
  const unitHuds: LiveHudLevel[] = [];
  for (const entry of tagIndex.entries) {
    if (entry.primaryClassName !== 'unit_hud_interface' || entry.isExternal) continue;
    const parsed = parseUnitHudLevel(buffer, header, tagIndex, entry.index);
    if (parsed) unitHuds.push(parsed);
  }

  // All Global HUDs in map
  const globalHuds: LiveHudLevel[] = [];
  for (const entry of tagIndex.entries) {
    if (entry.primaryClassName !== 'hud_globals' || entry.isExternal) continue;
    const parsed = parseGlobalHudLevel(buffer, header, tagIndex, entry.index);
    if (parsed) globalHuds.push(parsed);
  }

  // All UI Widget Definitions ('DeLa') in map
  const uiWidgets: LiveUiWidgetSummary[] = [];
  for (const entry of tagIndex.entries) {
    if (entry.primaryClassName !== 'ui_widget_definition' || entry.isExternal) continue;
    try {
      const decoded = readTagFieldValues(buffer, header, tagIndex, entry.index);
      const typeVal = getNumberVal(decoded.fields, 'widget type', 0);
      const typeNames = ['Container', 'Text Box', 'Spinner List', 'Column List'];
      const bounds = getRect2DVal(decoded.fields, 'bounds');
      const children = findField(decoded.fields, 'child widgets')?.children ?? [];
      const bgBitm = getDepTarget(decoded.fields, 'background bitmap', tagIndex);
      const strList = getDepTarget(decoded.fields, 'text label unicode strings list', tagIndex);

      uiWidgets.push({
        tagIndex: entry.index,
        tagId: entry.tagId,
        path: entry.path,
        displayName: formatDisplayName(entry.path),
        widgetType: typeNames[typeVal] ?? `Type ${typeVal}`,
        bounds,
        childCount: children.length,
        backgroundBitmapPath: bgBitm.path,
        stringListPath: strList.path,
      });
    } catch {
      // Skip unreadable DeLa
    }
  }

  const unicodeStringLists = tagIndex.entries
    .filter((e) => e.primaryClassName === 'unicode_string_list')
    .map((e) => ({
      tagIndex: e.index,
      tagId: e.tagId,
      path: e.path,
      isExternal: e.isExternal,
    }));

  return {
    mapName: header.scenarioName,
    weapons,
    vehicles,
    unitHuds,
    globalHuds,
    uiWidgets,
    unicodeStringLists,
  };
}

export interface ApplyLiveHudEditRequest {
  hudTagIndex: number;
  /** Optional owner weapon tag index if editing a shared wphi with scope='this_one' */
  ownerWeaponTagIndex?: number;
  hudLevel?: number;
  scope?: 'this_one' | 'all';
  editType: 'anchor' | 'element';
  anchorIndex?: number;
  offsetFieldPath?: string;
  scaleXFieldPath?: string;
  scaleYFieldPath?: string;
  visibilityFieldPath?: string;
  visibilityMode?: 'map_type_15' | 'crosshair_bit7' | 'overlay_bit1' | 'scaling_hide';
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  hidden?: boolean;
  rawVisibilityValue?: number;
}

/**
 * Diffs a snapshot of the tag data region before & after an edit and produces compact
 * `WriteProcessMemory` patches (`0x40440000`-based) for live in-game updates in `halo.exe`.
 */
export function computeTagDataMemoryPatches(
  beforeTagData: Buffer,
  afterBuffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
): LiveMemoryPatch[] {
  const tagStart = header.tagDataOffset;
  const tagLen = Math.min(beforeTagData.length, Math.max(0, afterBuffer.length - tagStart));
  if (tagLen <= 0) return [];

  const patches: LiveMemoryPatch[] = [];
  let i = 0;
  while (i < tagLen) {
    if (beforeTagData[i] === afterBuffer[tagStart + i]) {
      i++;
      continue;
    }
    const runStart = i;
    let runEnd = i + 1;
    while (runEnd < tagLen) {
      if (beforeTagData[runEnd] !== afterBuffer[tagStart + runEnd]) {
        runEnd++;
      } else {
        // Coalesce small gaps up to 16 bytes so a Point2DInt or Bounds write is a single patch
        let gap = 1;
        while (gap <= 16 && runEnd + gap < tagLen && beforeTagData[runEnd + gap] === afterBuffer[tagStart + runEnd + gap]) {
          gap++;
        }
        if (gap <= 16 && runEnd + gap < tagLen) {
          runEnd += gap + 1;
        } else {
          break;
        }
      }
    }
    const slice = afterBuffer.subarray(tagStart + runStart, tagStart + runEnd);
    patches.push({
      address: (tagIndex.baseMemoryAddress + runStart) >>> 0,
      dataBase64: Buffer.from(slice).toString('base64'),
    });
    i = runEnd;
  }
  return patches;
}

/**
 * Prepares a staged `.map` buffer in-place for an in-game Live HUD & Weapon Tag Editing session:
 * - Sets `_weapon_doesnt_count_toward_maximum_bit` (`flags |= (1 << 4)`) on all Spartan-holdable weapons
 *   so the player can carry 4 weapons simultaneously and cycle them with `Tab`.
 * - Ensures every Spartan-holdable weapon has full initial & reserved magazine ammo.
 * - Populates existing `weapons` (`initial weapons`) slots on the player biped (`cyborg_mp` / `cyborg`).
 * - Populates existing `weapon list` and `multiplayer information[0].vehicles` slots in `globals` (`matg`),
 *   and returns `{ matgVirtualAddress, holdableWeaponTagIds, vehicleTagIds }` so the live memory bridge
 *   can write the full `TagReference` arrays into `halo.exe` RAM (`0x41B00000` / `0x41B01000`) and
 *   execute `cheat_all_weapons` and `cheat_all_vehicles` on spawn!
 */
export function prepareMapBufferForLiveHudSession(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
): LiveHudSessionSetupInfo {
  const holdableIndices = collectSpartanHoldableWeaponIndices(buffer, header, tagIndex);
  const holdableWeaponTagIds: number[] = [];

  for (const weapIdx of holdableIndices) {
    const entry = tagIndex.entries[weapIdx];
    if (!entry || entry.isExternal) continue;
    holdableWeaponTagIds.push(entry.tagId);

    try {
      const decoded = readTagFieldValues(buffer, header, tagIndex, weapIdx);
      // 1. Set _weapon_doesnt_count_toward_maximum_bit (bit 4) on weapon flags so Spartan holds 4 weapons
      const flagsField = findField(decoded.fields, 'weapon flags');
      if (flagsField && flagsField.offset >= header.tagDataOffset && flagsField.offset + 4 <= buffer.length) {
        const curFlags = buffer.readUInt32LE(flagsField.offset);
        buffer.writeUInt32LE((curFlags | (1 << 4)) >>> 0, flagsField.offset);
      }

      // 2. Ensure magazines have generous initial & reserved ammo
      const mags = findField(decoded.fields, 'magazines')?.children ?? [];
      for (const mag of mags) {
        const loadedMax = Math.max(1, getNumberVal(mag.fields, 'rounds loaded maximum', 30));
        const desiredAmmo = Math.min(999, Math.max(loadedMax * 4, 120));
        const initField = findField(mag.fields, 'rounds total initial');
        const maxField = findField(mag.fields, 'rounds reserved maximum');
        if (initField && initField.offset >= header.tagDataOffset && initField.offset + 2 <= buffer.length) {
          const curInit = buffer.readInt16LE(initField.offset);
          if (curInit < loadedMax) {
            buffer.writeInt16LE(desiredAmmo, initField.offset);
          }
        }
        if (maxField && maxField.offset >= header.tagDataOffset && maxField.offset + 2 <= buffer.length) {
          const curMax = buffer.readInt16LE(maxField.offset);
          if (curMax < loadedMax) {
            buffer.writeInt16LE(desiredAmmo, maxField.offset);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // Collect all unique vehicle ('vehi') tags in the map, prioritizing vehicles with HUDs/weapons first
  const vehWithHud: number[] = [];
  const vehOther: number[] = [];
  for (const entry of tagIndex.entries) {
    if (entry.primaryClassName !== 'vehicle' || entry.isExternal) continue;
    const norm = entry.path.replace(/\//g, '\\').toLowerCase();
    // Skip non-interactive cinematic dropships/props if they have no seats/HUDs
    let hasHudOrWeapon = false;
    try {
      const d = readTagFieldValues(buffer, header, tagIndex, entry.index);
      const uHuds = findField(d.fields, 'new unit hud interface')?.children ?? [];
      const vWeaps = findField(d.fields, 'weapons')?.children ?? [];
      const seats = findField(d.fields, 'seats')?.children ?? [];
      if (uHuds.length > 0 || vWeaps.length > 0 || seats.length > 0) {
        hasHudOrWeapon = true;
      }
    } catch {
      // ignore
    }
    if (norm.includes('pelican') || norm.includes('dropship') || norm.includes('lifepod')) {
      continue;
    }
    if (hasHudOrWeapon) {
      vehWithHud.push(entry.tagId);
    } else {
      vehOther.push(entry.tagId);
    }
  }
  const vehicleTagIds = [...vehWithHud, ...vehOther];

  // Populate existing initial_weapons slots on Spartan biped tags in-place
  if (holdableWeaponTagIds.length > 0) {
    for (const entry of tagIndex.entries) {
      if (entry.primaryClassName !== 'biped' || entry.isExternal) continue;
      const norm = entry.path.replace(/\//g, '\\').toLowerCase();
      if (!norm.includes('cyborg') && !norm.includes('spartan') && !norm.includes('masterchief')) continue;
      try {
        const d = readTagFieldValues(buffer, header, tagIndex, entry.index);
        const bipedWeaps = findField(d.fields, 'weapons')?.children ?? [];
        for (let i = 0; i < bipedWeaps.length && i < holdableWeaponTagIds.length; i++) {
          writeTagFieldValue(buffer, header, tagIndex, entry.index, `weapons[${i}].weapon`, holdableWeaponTagIds[i]);
        }
      } catch {
        // ignore
      }
    }
  }

  // Locate `globals` ('matg') tag and populate any existing weapon_list / vehicles slots in-place
  let matgVirtualAddress = 0;
  const matgEntry = tagIndex.entries.find((e) => e.primaryClassName === 'globals' && !e.isExternal);
  if (matgEntry) {
    matgVirtualAddress = matgEntry.tagDataPointerOrResourceIndex >>> 0;
    try {
      const matgDecoded = readTagFieldValues(buffer, header, tagIndex, matgEntry.index);
      const weapList = findField(matgDecoded.fields, 'weapon list')?.children ?? [];
      for (let i = 0; i < weapList.length && i < holdableWeaponTagIds.length; i++) {
        writeTagFieldValue(buffer, header, tagIndex, matgEntry.index, `weapon list[${i}].weapon`, holdableWeaponTagIds[i]);
      }
      const mpInfo = findField(matgDecoded.fields, 'multiplayer information')?.children ?? [];
      if (mpInfo.length > 0) {
        const mpVehicles = findField(mpInfo[0].fields, 'vehicles')?.children ?? [];
        for (let i = 0; i < mpVehicles.length && i < vehicleTagIds.length; i++) {
          const vField = findField(mpVehicles[i].fields, 'vehicle');
          if (vField && vField.offset >= header.tagDataOffset && vField.offset + 16 <= buffer.length) {
            buffer.writeUInt32LE(0x76656869, vField.offset); // 'vehi'
            buffer.writeUInt32LE(0, vField.offset + 4);
            buffer.writeUInt32LE(0, vField.offset + 8);
            buffer.writeInt32LE(vehicleTagIds[i], vField.offset + 12);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return {
    matgVirtualAddress,
    holdableWeaponTagIds,
    vehicleTagIds,
  };
}

/**
 * Applies a live HUD placement, scale, visibility, or anchor edit directly to the open map buffer.
 * If `scope === 'this_one'` and the `wphi` tag is shared by multiple weapons, automatically forks a
 * dedicated copy of the `wphi` tag for `ownerWeaponTagIndex`.
 */
export function applyLiveHudEdit(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  req: ApplyLiveHudEditRequest,
): {
  buffer: Buffer;
  header: CacheFileHeader;
  tagIndex: TagIndex;
  effectiveHudTagIndex: number;
  memoryPatches: LiveMemoryPatch[];
} {
  const beforeTagData = Buffer.from(
    buffer.subarray(header.tagDataOffset, Math.min(buffer.length, header.tagDataOffset + header.tagDataSize)),
  );
  let curBuf = buffer;
  let curHeader = header;
  let curTagIndex = tagIndex;
  let targetHudIndex = req.hudTagIndex;

  // Handle "Edits apply to: THIS ONE" when a weapon shares a wphi tag with other weapons in the map
  if (
    req.scope === 'this_one' &&
    typeof req.ownerWeaponTagIndex === 'number' &&
    (req.hudLevel ?? 0) === 0
  ) {
    const weapEntry = curTagIndex.entries[req.ownerWeaponTagIndex];
    const hudEntry = curTagIndex.entries[targetHudIndex];
    if (weapEntry && hudEntry && hudEntry.primaryClassName === 'weapon_hud_interface') {
      // Check if any other weapon references this wphi tagId
      let otherUsers = 0;
      for (const e of curTagIndex.entries) {
        if (e.primaryClassName !== 'weapon' || e.index === weapEntry.index || e.isExternal) continue;
        try {
          const d = readTagFieldValues(curBuf, curHeader, curTagIndex, e.index);
          const dep = getDepTarget(d.fields, 'hud interface', curTagIndex);
          if (dep.tagIndex === targetHudIndex) otherUsers++;
        } catch {
          // ignore
        }
      }
      if (otherUsers > 0) {
        const customHudPath = `${hudEntry.path}_${ getLeafName(weapEntry.path).replace(/\s+/g, '_') }`;
        const existingFork = curTagIndex.entries.find(
          (e) => e.primaryClassName === 'weapon_hud_interface' && e.path.toLowerCase() === customHudPath.toLowerCase(),
        );
        if (existingFork) {
          targetHudIndex = existingFork.index;
          writeTagFieldValue(curBuf, curHeader, curTagIndex, weapEntry.index, 'hud interface', existingFork.tagId);
        } else {
          const dup = duplicateTagInMap(curBuf, curHeader, curTagIndex, targetHudIndex, customHudPath);
          curBuf = dup.buffer;
          curHeader = parseCacheFileHeader(curBuf);
          curTagIndex = parseTagIndex(curBuf, curHeader);
          targetHudIndex = dup.newTagIndex;
          writeTagFieldValue(curBuf, curHeader, curTagIndex, weapEntry.index, 'hud interface', dup.newTagId);
        }
      }
    }
  }

  if (req.editType === 'anchor' && typeof req.anchorIndex === 'number') {
    const clamped = Math.max(0, Math.min(4, Math.round(req.anchorIndex)));
    writeTagFieldValue(curBuf, curHeader, curTagIndex, targetHudIndex, 'anchor', clamped);
    const memoryPatches = computeTagDataMemoryPatches(beforeTagData, curBuf, curHeader, curTagIndex);
    return {
      buffer: curBuf,
      header: curHeader,
      tagIndex: curTagIndex,
      effectiveHudTagIndex: targetHudIndex,
      memoryPatches,
    };
  }

  if (req.offsetFieldPath && typeof req.x === 'number' && typeof req.y === 'number') {
    const clampedX = Math.max(-640, Math.min(640, Math.round(req.x)));
    const clampedY = Math.max(-480, Math.min(480, Math.round(req.y)));
    writeTagFieldValue(curBuf, curHeader, curTagIndex, targetHudIndex, req.offsetFieldPath, [clampedX, clampedY]);
  }

  if (req.scaleXFieldPath && typeof req.scaleX === 'number') {
    const clampedSx = Math.max(0.0, Math.min(8.0, Number(req.scaleX)));
    writeTagFieldValue(curBuf, curHeader, curTagIndex, targetHudIndex, req.scaleXFieldPath, clampedSx);
  }

  if (req.scaleYFieldPath && typeof req.scaleY === 'number') {
    const clampedSy = Math.max(0.0, Math.min(8.0, Number(req.scaleY)));
    writeTagFieldValue(curBuf, curHeader, curTagIndex, targetHudIndex, req.scaleYFieldPath, clampedSy);
  }

  if (typeof req.hidden === 'boolean') {
    if (req.visibilityMode === 'map_type_15' && req.visibilityFieldPath) {
      // allowed view type is an enum with 3 options in schema, so write int16 directly at resolved offset if hidden=15
      const decoded = readTagFieldValues(curBuf, curHeader, curTagIndex, targetHudIndex);
      const m = req.visibilityFieldPath.match(/^(.+)\[(\d+)\]\.(.+)$/);
      if (m) {
        const refField = findField(decoded.fields, m[1]);
        const child = refField?.children?.[Number(m[2])];
        const leaf = child ? findField(child.fields, m[3]) : undefined;
        if (leaf) {
          const valToWrite = req.hidden ? 15 : (req.rawVisibilityValue ?? 0);
          curBuf.writeInt16LE(valToWrite, leaf.offset);
        }
      }
    } else if (req.visibilityMode === 'crosshair_bit7' && req.visibilityFieldPath) {
      const baseFlags = (req.rawVisibilityValue ?? 0) & ~(1 << 7);
      const nextFlags = req.hidden ? (baseFlags | (1 << 7)) : baseFlags;
      writeTagFieldValue(curBuf, curHeader, curTagIndex, targetHudIndex, req.visibilityFieldPath, nextFlags >>> 0);
    } else if (req.visibilityMode === 'overlay_bit1' && req.visibilityFieldPath) {
      const baseFlags = (req.rawVisibilityValue ?? 0) & ~(1 << 1);
      const nextFlags = req.hidden ? (baseFlags | (1 << 1)) : baseFlags;
      writeTagFieldValue(curBuf, curHeader, curTagIndex, targetHudIndex, req.visibilityFieldPath, nextFlags >>> 0);
    } else if (req.visibilityMode === 'scaling_hide' && req.scaleXFieldPath && req.scaleYFieldPath) {
      const nextScale = req.hidden ? 0 : (req.scaleX && req.scaleX > 0 ? req.scaleX : 1);
      writeTagFieldValue(curBuf, curHeader, curTagIndex, targetHudIndex, req.scaleXFieldPath, nextScale);
      writeTagFieldValue(curBuf, curHeader, curTagIndex, targetHudIndex, req.scaleYFieldPath, nextScale);
    }
  }

  const memoryPatches = computeTagDataMemoryPatches(beforeTagData, curBuf, curHeader, curTagIndex);
  return {
    buffer: curBuf,
    header: curHeader,
    tagIndex: curTagIndex,
    effectiveHudTagIndex: targetHudIndex,
    memoryPatches,
  };
}

export interface ApplyLiveWeaponStatEditRequest {
  targetTagIndex: number;
  fieldPath: string;
  boundsIndex?: 0 | 1;
  value: number;
  conversion?: 'rad_to_deg' | 'tick_to_sec' | 'none';
}

/**
 * Applies a live weapon/trigger/magazine/projectile/damage stat edit directly into the map buffer.
 */
export function applyLiveWeaponStatEdit(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  req: ApplyLiveWeaponStatEditRequest,
): { ok: true; writtenValue: unknown; memoryPatches: LiveMemoryPatch[] } {
  const beforeTagData = Buffer.from(
    buffer.subarray(header.tagDataOffset, Math.min(buffer.length, header.tagDataOffset + header.tagDataSize)),
  );
  let rawVal = Number(req.value);
  if (req.conversion === 'rad_to_deg') {
    rawVal = (rawVal * Math.PI) / 180;
  } else if (req.conversion === 'tick_to_sec') {
    rawVal = rawVal / 30;
  }

  if (req.boundsIndex === 0 || req.boundsIndex === 1) {
    // Read current bounds first
    const decoded = readTagFieldValues(buffer, header, tagIndex, req.targetTagIndex);
    let currentBounds: [number, number] = [0, 0];
    const m = req.fieldPath.match(/^(.+)\[(\d+)\]\.(.+)$/);
    if (m) {
      const refField = findField(decoded.fields, m[1]);
      const child = refField?.children?.[Number(m[2])];
      const leaf = child ? findField(child.fields, m[3]) : undefined;
      if (leaf && Array.isArray(leaf.value) && leaf.value.length >= 2) {
        currentBounds = [Number(leaf.value[0]) || 0, Number(leaf.value[1]) || 0];
      }
    } else {
      const leaf = findField(decoded.fields, req.fieldPath);
      if (leaf && Array.isArray(leaf.value) && leaf.value.length >= 2) {
        currentBounds = [Number(leaf.value[0]) || 0, Number(leaf.value[1]) || 0];
      }
    }
    currentBounds[req.boundsIndex] = rawVal;
    writeTagFieldValue(buffer, header, tagIndex, req.targetTagIndex, req.fieldPath, currentBounds);
    const memoryPatches = computeTagDataMemoryPatches(beforeTagData, buffer, header, tagIndex);
    return { ok: true, writtenValue: currentBounds, memoryPatches };
  }

  writeTagFieldValue(buffer, header, tagIndex, req.targetTagIndex, req.fieldPath, rawVal);
  const memoryPatches = computeTagDataMemoryPatches(beforeTagData, buffer, header, tagIndex);
  return { ok: true, writtenValue: rawVal, memoryPatches };
}

export interface GuidedHudBitmapInjectRequest {
  hudTagIndex: number;
  bitmapFieldPath: string;
  bitmapTagIndex: number;
  imageIndex?: number;
  pngDataUrlOrBuffer: string | Buffer;
  targetFormat?: number;
  /** When true, creates a dedicated map-local bitmap tag for this HUD element so shared HUD sheets are unaffected */
  cloneDedicatedBitmapTag?: boolean;
  customBitmapTagPath?: string;
}

/**
 * Injects/replaces a HUD element's bitmap directly in the open `.map` buffer (never modifying `bitmaps.map`).
 * Optionally clones a dedicated `bitm` tag so replacing a shared HUD sprite sheet only affects the chosen HUD element.
 */
export function injectHudElementBitmap(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  req: GuidedHudBitmapInjectRequest,
  externalBitmapsBuffer?: Buffer,
): {
  buffer: Buffer;
  header: CacheFileHeader;
  tagIndex: TagIndex;
  bitmapTagIndex: number;
  bitmapTagId: number;
  bitmapPath: string;
  width: number;
  height: number;
  format: number;
} {
  let curBuf = buffer;
  let curHeader = header;
  let curTagIndex = tagIndex;

  let pngBuf: Buffer;
  if (typeof req.pngDataUrlOrBuffer === 'string') {
    const base64Match = req.pngDataUrlOrBuffer.match(/^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/);
    pngBuf = Buffer.from(base64Match ? base64Match[1] : req.pngDataUrlOrBuffer, 'base64');
  } else {
    pngBuf = req.pngDataUrlOrBuffer;
  }

  const decodedPng = decodePngToRgba(pngBuf);
  const srcEntry = curTagIndex.entries[req.bitmapTagIndex];
  if (!srcEntry) {
    throw new Error(`Bitmap tag #${req.bitmapTagIndex} not found in open map.`);
  }

  let targetBitmapIndex = req.bitmapTagIndex;
  let targetBitmapTagId = srcEntry.tagId;
  let targetBitmapPath = srcEntry.path;

  // If the user wants a dedicated bitmap tag for this HUD element (or if we are forking a shared bitmap):
  if (req.cloneDedicatedBitmapTag) {
    const hudEntry = curTagIndex.entries[req.hudTagIndex];
    const desiredPath =
      req.customBitmapTagPath?.trim() ||
      `${srcEntry.path}_${hudEntry ? getLeafName(hudEntry.path).replace(/\s+/g, '_') : 'custom'}`;

    // If source bitmap is currently external in bitmaps.map, first internalize a copy or build a dedicated internal bitm tag
    if (srcEntry.isExternal) {
      // Build a clean internal 1-sequence, 1-plate bitmap tag via the add-injection pipeline
      const created = createDedicatedInternalBitmapTag(
        curBuf,
        curHeader,
        curTagIndex,
        desiredPath,
        decodedPng.width,
        decodedPng.height,
      );
      curBuf = created.buffer;
      curHeader = parseCacheFileHeader(curBuf);
      curTagIndex = parseTagIndex(curBuf, curHeader);
      targetBitmapIndex = created.newTagIndex;
      targetBitmapTagId = created.newTagId;
      targetBitmapPath = created.path;
    } else {
      const dup = duplicateTagInMap(curBuf, curHeader, curTagIndex, targetBitmapIndex, desiredPath);
      curBuf = dup.buffer;
      curHeader = parseCacheFileHeader(curBuf);
      curTagIndex = parseTagIndex(curBuf, curHeader);
      targetBitmapIndex = dup.newTagIndex;
      targetBitmapTagId = dup.newTagId;
      targetBitmapPath = dup.path;
    }

    // Re-point the HUD element's bitmap dependency slot to the new dedicated bitmap tag
    writeTagFieldValue(curBuf, curHeader, curTagIndex, req.hudTagIndex, req.bitmapFieldPath, targetBitmapTagId);
  }

  // Inspect existing format or default to A8R8G8B8 (11) for crisp HUD reticles/icons
  let targetFormat = req.targetFormat ?? BitmapFormat.A8R8G8B8;
  let imageIndex = req.imageIndex ?? 0;
  try {
    const info = inspectBitmapTag(curBuf, curHeader, curTagIndex, targetBitmapTagId, externalBitmapsBuffer);
    if (imageIndex >= info.images.length) imageIndex = 0;
    if (req.targetFormat === undefined && info.images[imageIndex]) {
      const origFmt = info.images[imageIndex].format;
      if (
        origFmt === BitmapFormat.DXT1 ||
        origFmt === BitmapFormat.DXT5 ||
        origFmt === BitmapFormat.A8R8G8B8 ||
        origFmt === BitmapFormat.X8R8G8B8
      ) {
        targetFormat = origFmt;
      }
    }
  } catch {
    // Use A8R8G8B8 if external bitmaps.map is not needed or unavailable
  }

  const encoded = encodeBitmapWithMipmaps(
    decodedPng.rgba,
    decodedPng.width,
    decodedPng.height,
    targetFormat,
    false, // HUD bitmaps do not need mipmap chains
  );

  curBuf = replaceBitmapImageData(
    curBuf,
    curHeader,
    curTagIndex,
    targetBitmapTagId,
    imageIndex,
    encoded.pixelData,
    decodedPng.width,
    decodedPng.height,
    targetFormat,
    externalBitmapsBuffer,
    0,
  );
  curHeader = parseCacheFileHeader(curBuf);
  curTagIndex = parseTagIndex(curBuf, curHeader);

  return {
    buffer: curBuf,
    header: curHeader,
    tagIndex: curTagIndex,
    bitmapTagIndex: targetBitmapIndex,
    bitmapTagId: targetBitmapTagId,
    bitmapPath: targetBitmapPath,
    width: decodedPng.width,
    height: decodedPng.height,
    format: targetFormat,
  };
}

/**
 * Allocates a fresh internal `bitmap` ('bitm') tag with 1 sequence, 1 sprite, and 1 `BitmapData` entry
 * in the open `.map` buffer so we can inject a HUD bitmap even without `bitmaps.map` or without touching shared external tags.
 */
function createDedicatedInternalBitmapTag(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  newPath: string,
  width: number,
  height: number,
): { buffer: Buffer; newTagIndex: number; newTagId: number; path: string } {
  const cleanPath = newPath.trim().replace(/\//g, '\\');
  // Root Bitmap struct = 108B (0x6C) + 1 Sequence (64B) + 1 Sprite (32B) + 1 BitmapData (48B) = 252B
  const rootSize = 108;
  const seqOffset = 108;
  const spriteOffset = 172;
  const imgOffset = 204;
  const totalBytes = 252;

  const tagBuf = Buffer.alloc(totalBytes, 0);
  // Root: type = 3 (sprites) or 4 (interface bitmaps), format = 4 (32-bit), usage = 0 (alpha blend)
  tagBuf.writeUInt16LE(0, 0x00); // 2D textures
  tagBuf.writeUInt16LE(4, 0x02); // 32-bit color
  tagBuf.writeUInt16LE(0, 0x04); // alpha blend
  // Sequences reflexive at 0x54
  tagBuf.writeUInt32LE(1, 0x54);
  tagBuf.writeUInt32LE(seqOffset, 0x58);
  // Bitmaps reflexive at 0x60
  tagBuf.writeUInt32LE(1, 0x60);
  tagBuf.writeUInt32LE(imgOffset, 0x64);

  // Sequence 0 (64 bytes at seqOffset)
  tagBuf.write('hud_seq', seqOffset, 'ascii');
  tagBuf.writeUInt16LE(0, seqOffset + 0x20); // first bitmap index = 0
  tagBuf.writeUInt16LE(1, seqOffset + 0x22); // bitmap count = 1
  // Sprites reflexive at seqOffset + 0x34
  tagBuf.writeUInt32LE(1, seqOffset + 0x34);
  tagBuf.writeUInt32LE(spriteOffset, seqOffset + 0x38);

  // Sprite 0 (32 bytes at spriteOffset)
  tagBuf.writeUInt16LE(0, spriteOffset + 0x00); // bitmap index = 0
  tagBuf.writeFloatLE(0.0, spriteOffset + 0x08); // left
  tagBuf.writeFloatLE(1.0, spriteOffset + 0x0c); // right
  tagBuf.writeFloatLE(0.0, spriteOffset + 0x10); // top
  tagBuf.writeFloatLE(1.0, spriteOffset + 0x14); // bottom
  tagBuf.writeFloatLE(0.5, spriteOffset + 0x18); // reg point x
  tagBuf.writeFloatLE(0.5, spriteOffset + 0x1c); // reg point y

  // BitmapData 0 (48 bytes at imgOffset)
  tagBuf.write('bitm', imgOffset + 0x00, 'ascii');
  tagBuf.writeUInt16LE(width, imgOffset + 0x04);
  tagBuf.writeUInt16LE(height, imgOffset + 0x06);
  tagBuf.writeUInt16LE(1, imgOffset + 0x08); // depth = 1
  tagBuf.writeUInt16LE(0, imgOffset + 0x0a); // type = 2D
  tagBuf.writeUInt16LE(BitmapFormat.A8R8G8B8, imgOffset + 0x0c);
  tagBuf.writeUInt16LE(0x0080, imgOffset + 0x0e); // internal cached
  tagBuf.writeUInt16LE(Math.floor(width / 2), imgOffset + 0x10);
  tagBuf.writeUInt16LE(Math.floor(height / 2), imgOffset + 0x12);
  tagBuf.writeUInt16LE(0, imgOffset + 0x14); // mipmaps = 0
  tagBuf.writeUInt32LE(0, imgOffset + 0x18); // pixelDataOffset (filled by replaceBitmapImageData)
  tagBuf.writeUInt32LE(0, imgOffset + 0x1c); // pixelDataSize

  const container: OceContainer = {
    magic: OCETAGS_MAGIC,
    formatVersion: OCETAGS_FORMAT_VERSION,
    sourceMapName: header.scenarioName,
    createdAt: new Date().toISOString(),
    hasUnresolvedBspReferences: false,
    rootOriginalIndices: [0],
    tags: [
      {
        originalIndex: 0,
        group: 'bitmap',
        path: cleanPath,
        structName: 'Bitmap',
        data: tagBuf.toString('base64'),
        dependencies: [],
        secondaryClassFourCC: 0xffffffff,
        tertiaryClassFourCC: 0xffffffff,
        embeddedRawDataAssets: [],
        embeddedRawDataPatches: [],
        injectionBlockers: [],
      },
    ],
    notExtracted: [],
    warnings: [],
    resourceMapIdentities: {},
    externalResourceRefs: [],
    externalData: 'referenced',
  };

  const plan = planAddInjection({ buffer, header, tagIndex }, container, {}, { allowEmbeddedRelocation: true });
  if (plan.kind === 'refused') {
    throw new Error(`Could not allocate dedicated bitmap tag "${cleanPath}": ${plan.reason}`);
  }
  const report = applyInjectionWithReport(buffer, header, tagIndex, container, plan, {
    allowEmbeddedRelocation: true,
  });
  const newTagId = plan.resolvedTagIdByLocalIndex.get(0) ?? computeNewTagId(tagIndex.entries.length);
  const newTagIndex = newTagId & 0xffff;
  return {
    buffer: report.buffer,
    newTagIndex,
    newTagId,
    path: cleanPath,
  };
}

/* =================================================================================
 * Visual ui.map ('DeLa' UI Widget Canvas & 'ustr' Unicode String Table) Studio
 * ================================================================================= */

export interface UiWidgetCanvasNode {
  id: string;
  tagIndex: number;
  tagId: number;
  path: string;
  name: string;
  widgetType: string;
  /** Bounds in its own tag: [top, left, bottom, right] */
  localBounds: [number, number, number, number];
  /** Screen-space bounds on 640x480 canvas after applying parent child_widget offsets */
  screenBounds: [number, number, number, number];
  horizontalOffset: number;
  verticalOffset: number;
  /** If this node is a child_widget entry on a parent DeLa, stores parent info for direct offset dragging */
  parentTagIndex: number | null;
  childWidgetIndex: number | null;
  backgroundBitmapTagIndex: number | null;
  backgroundBitmapTagId: number | null;
  backgroundBitmapPath: string;
  unicodeStringListTagIndex: number | null;
  unicodeStringListPath: string;
  stringListIndex: number;
  resolvedTextLabel: string;
  textColorHex: string;
  justification: 'left' | 'right' | 'center';
  opensWidgetTagIndex: number | null;
  opensWidgetPath: string;
  children: UiWidgetCanvasNode[];
}

/**
 * Inspects a `ui_widget_definition` ('DeLa') tag and recursively builds its 640x480 visual layout tree.
 */
export function inspectUiWidgetCanvas(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  widgetTagIndex: number,
  maxDepth = 3,
): UiWidgetCanvasNode | null {
  const visited = new Set<number>();

  const buildNode = (
    curTagIdx: number,
    parentTagIdx: number | null,
    childIdx: number | null,
    accOffsetX: number,
    accOffsetY: number,
    depth: number,
  ): UiWidgetCanvasNode | null => {
    const entry = tagIndex.entries[curTagIdx];
    if (!entry || entry.primaryClassName !== 'ui_widget_definition' || entry.isExternal) return null;

    let decoded: ReturnType<typeof readTagFieldValues>;
    try {
      decoded = readTagFieldValues(buffer, header, tagIndex, curTagIdx);
    } catch {
      return null;
    }

    const typeVal = getNumberVal(decoded.fields, 'widget type', 0);
    const typeNames = ['Container', 'Text Box', 'Spinner List', 'Column List'];
    const nameField = findField(decoded.fields, 'name');
    const widgetName =
      typeof nameField?.value === 'string' && nameField.value.trim()
        ? nameField.value.trim()
        : getLeafName(entry.path);

    const localBounds = getRect2DVal(decoded.fields, 'bounds');
    const screenBounds: [number, number, number, number] = [
      localBounds[0] + accOffsetY,
      localBounds[1] + accOffsetX,
      localBounds[2] + accOffsetY,
      localBounds[3] + accOffsetX,
    ];

    const bgBitm = getDepTarget(decoded.fields, 'background bitmap', tagIndex);
    const ustrDep = getDepTarget(decoded.fields, 'text label unicode strings list', tagIndex);
    const strIdx = getNumberVal(decoded.fields, 'string list index', 0);

    let resolvedTextLabel = '';
    if (ustrDep.tagIndex !== null && strIdx !== 0xffff) {
      try {
        const ustrList = readUnicodeStringList(buffer, header, tagIndex, ustrDep.tagIndex);
        if (ustrList.strings[strIdx]?.text) {
          resolvedTextLabel = ustrList.strings[strIdx].text;
        }
      } catch {
        // ignore external or unreadable ustr
      }
    }

    const colorField = findField(decoded.fields, 'text color');
    let textColorHex = '#2896ff';
    if (colorField && Array.isArray(colorField.value) && colorField.value.length >= 4) {
      const r = Math.max(0, Math.min(255, Math.round((Number(colorField.value[1]) || 0) * 255)));
      const g = Math.max(0, Math.min(255, Math.round((Number(colorField.value[2]) || 0) * 255)));
      const b = Math.max(0, Math.min(255, Math.round((Number(colorField.value[3]) || 0) * 255)));
      if (r > 0 || g > 0 || b > 0) {
        textColorHex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
      }
    }

    const justVal = getNumberVal(decoded.fields, 'justification', 0);
    const justification: 'left' | 'right' | 'center' =
      justVal === 1 ? 'right' : justVal === 2 ? 'center' : 'left';

    // Check event handlers to see if clicking/activating this widget opens another widget
    let opensWidgetTagIndex: number | null = null;
    let opensWidgetPath = '';
    const handlers = findField(decoded.fields, 'event handlers')?.children ?? [];
    for (const h of handlers) {
      const targetDep = getDepTarget(h.fields, 'widget tag', tagIndex);
      if (targetDep.tagIndex !== null) {
        opensWidgetTagIndex = targetDep.tagIndex;
        opensWidgetPath = targetDep.path;
        break;
      }
    }

    const childrenNodes: UiWidgetCanvasNode[] = [];
    if (depth < maxDepth && !visited.has(curTagIdx)) {
      visited.add(curTagIdx);
      const childRefs = findField(decoded.fields, 'child widgets')?.children ?? [];
      childRefs.forEach((cRef: TagReflexiveElement, cIdx: number) => {
        const cDep = getDepTarget(cRef.fields, 'widget tag', tagIndex);
        if (cDep.tagIndex === null) return;
        const hOff = getNumberVal(cRef.fields, 'horizontal offset', 0);
        const vOff = getNumberVal(cRef.fields, 'vertical offset', 0);
        const childNode = buildNode(
          cDep.tagIndex,
          curTagIdx,
          cIdx,
          accOffsetX + hOff,
          accOffsetY + vOff,
          depth + 1,
        );
        if (childNode) {
          childNode.horizontalOffset = hOff;
          childNode.verticalOffset = vOff;
          childrenNodes.push(childNode);
        }
      });
      visited.delete(curTagIdx);
    }

    return {
      id: parentTagIdx !== null ? `w_${parentTagIdx}_c_${childIdx}_${curTagIdx}` : `root_${curTagIdx}`,
      tagIndex: curTagIdx,
      tagId: entry.tagId,
      path: entry.path,
      name: widgetName,
      widgetType: typeNames[typeVal] ?? 'Container',
      localBounds,
      screenBounds,
      horizontalOffset: 0,
      verticalOffset: 0,
      parentTagIndex: parentTagIdx,
      childWidgetIndex: childIdx,
      backgroundBitmapTagIndex: bgBitm.tagIndex,
      backgroundBitmapTagId: bgBitm.tagId,
      backgroundBitmapPath: bgBitm.path,
      unicodeStringListTagIndex: ustrDep.tagIndex,
      unicodeStringListPath: ustrDep.path,
      stringListIndex: strIdx === 0xffff ? -1 : strIdx,
      resolvedTextLabel,
      textColorHex,
      justification,
      opensWidgetTagIndex,
      opensWidgetPath,
      children: childrenNodes,
    };
  };

  return buildNode(widgetTagIndex, null, null, 0, 0, 0);
}

export interface UpdateUiWidgetPlacementRequest {
  widgetTagIndex: number;
  /** New local bounds [top, left, bottom, right] on the widget itself */
  bounds?: [number, number, number, number];
  /** Optional parent widget tag index + child widget reflexive index to update child horizontal/vertical offset */
  parentTagIndex?: number | null;
  childWidgetIndex?: number | null;
  horizontalOffset?: number;
  verticalOffset?: number;
}

/**
 * Updates a `ui_widget_definition` ('DeLa') tag's bounds and/or its parent `child_widgets[i]` offset in-place.
 */
export function updateUiWidgetPlacement(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  req: UpdateUiWidgetPlacementRequest,
): { ok: true } {
  if (req.bounds && req.bounds.length === 4) {
    const clampedBounds: [number, number, number, number] = [
      Math.round(req.bounds[0]),
      Math.round(req.bounds[1]),
      Math.round(req.bounds[2]),
      Math.round(req.bounds[3]),
    ];
    writeTagFieldValue(buffer, header, tagIndex, req.widgetTagIndex, 'bounds', clampedBounds);
  }

  if (
    typeof req.parentTagIndex === 'number' &&
    typeof req.childWidgetIndex === 'number' &&
    req.childWidgetIndex >= 0
  ) {
    if (typeof req.horizontalOffset === 'number') {
      writeTagFieldValue(
        buffer,
        header,
        tagIndex,
        req.parentTagIndex,
        `child widgets[${req.childWidgetIndex}].horizontal offset`,
        Math.round(req.horizontalOffset),
      );
    }
    if (typeof req.verticalOffset === 'number') {
      writeTagFieldValue(
        buffer,
        header,
        tagIndex,
        req.parentTagIndex,
        `child widgets[${req.childWidgetIndex}].vertical offset`,
        Math.round(req.verticalOffset),
      );
    }
  }

  return { ok: true };
}

/**
 * Saves an entire array of UTF-16LE strings into a `unicode_string_list` ('ustr') tag,
 * automatically internalizing external `loc.map` `ustr` tags or reallocating if any string grew longer.
 */
export function saveUnicodeStringListTable(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  ustrTagIndex: number,
  strings: string[],
): { buffer: Buffer; header: CacheFileHeader; tagIndex: TagIndex; entryCount: number } {
  let curBuf = buffer;
  let curHeader = header;
  let curTagIndex = tagIndex;

  // Ensure external loc.map ustr tags are internalized first
  const internalized = ensureExternalTagInternalized(curBuf, curHeader, curTagIndex, ustrTagIndex);
  curBuf = internalized.buffer;
  curHeader = internalized.header;
  curTagIndex = internalized.tagIndex;

  // Try fast in-place write if count matches and all strings fit within existing capacities
  try {
    const existing = readUnicodeStringList(curBuf, curHeader, curTagIndex, ustrTagIndex);
    if (!existing.isExternal && existing.strings.length === strings.length && strings.length > 0) {
      let allFit = true;
      for (let i = 0; i < strings.length; i++) {
        const byteLen = Buffer.byteLength(strings[i], 'utf16le');
        if (byteLen > existing.strings[i].allocatedBytes || existing.strings[i].fileOffset <= 0) {
          allFit = false;
          break;
        }
      }
      if (allFit) {
        for (let i = 0; i < strings.length; i++) {
          writeUnicodeString(curBuf, curHeader, curTagIndex, ustrTagIndex, i, strings[i]);
        }
        return { buffer: curBuf, header: curHeader, tagIndex: curTagIndex, entryCount: strings.length };
      }
    }
  } catch {
    // Fall through to full reallocation via compileStringsIntoTag
  }

  const joined = strings.join('\r\n###END-STRING###\r\n') + '\r\n###END-STRING###\r\n';
  const compiled = compileStringsIntoTag(curBuf, ustrTagIndex, joined);
  const newHeader = parseCacheFileHeader(compiled.buffer);
  const newTagIndex = parseTagIndex(compiled.buffer, newHeader);
  return {
    buffer: compiled.buffer,
    header: newHeader,
    tagIndex: newTagIndex,
    entryCount: compiled.entryCount,
  };
}
