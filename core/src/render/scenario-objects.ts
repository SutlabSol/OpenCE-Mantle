/**
 * Scenario object placements extractor (Step 8.5): extracts placed objects (vehicles,
 * scenery, bipeds, weapons, equipment, player spawns) from the Scenario (`scnr`) tag
 * and resolves each object's palette reference to its underlying 3D model tag (`gbxmodel`).
 */
import type { CacheFileHeader } from '../map/header';
import { parseCacheFileHeader } from '../map/header';
import type { TagIndex } from '../map/tag-index';
import { parseTagIndex, resolveTagDataPointer } from '../map/tag-index';
import { decodeStruct, resolveStruct, resolvePointer } from '../map/definitions/engine';
import { decodeReflexive, encodeReflexive } from '../map/definitions/codec';
import { planAddInjection, applyAddInjection } from '../map/tag-injector';
import { OCETAGS_MAGIC, OCETAGS_FORMAT_VERSION, type OceContainer } from '../map/container';

export type ScenarioObjectKind =
  | 'vehicle'
  | 'scenery'
  | 'biped'
  | 'weapon'
  | 'equipment'
  | 'spawn'
  | 'encounter'
  | 'firing_position'
  | 'trigger_volume'
  | 'cutscene_camera'
  | 'netgame_flag'
  | 'decal';

export interface ScenarioObjectPlacement {
  /** Unique identifier e.g. "vehicle-0", "scenery-12", "equipment-3", "spawn-3". */
  id: string;
  kind: ScenarioObjectKind;
  paletteIndex: number;
  nameIndex: number;
  /** Tag ID of the object tag (vehi, scen, bipd, weap, etc.), or 0xFFFFFFFF if spawn/trigger/camera. */
  objectTagId: number;
  /** For netgame equipment (itmc), the underlying resolved weapon/equipment tag ID if available. */
  resolvedItemTagId?: number;
  /** Human-readable path of the object tag, or entity description. */
  objectPath: string;
  /** Tag ID of the 3D model tag (`gbxmodel`/`mod2`), or 0xFFFFFFFF if none. */
  modelTagId: number;
  /** World position [x, y, z] in Halo coordinates (+X forward, +Y left, +Z up). */
  position: [number, number, number];
  /** World rotation [yaw, pitch, roll] in radians. */
  rotation: [number, number, number];
  /** Multiplayer team index (e.g. 0 = Red, 1 = Blue for player spawns). */
  teamIndex?: number;
  /** Raw multiplayer spawn bitmask (e.g. 0x0F0F for all gametypes default+allowed). */
  multiplayerSpawnFlags?: number;
  /** Whether the object is forced/configured to spawn in multiplayer gametypes. */
  forceSpawn?: boolean;
  /** Optional human-readable name (for trigger volumes, cutscene cameras, encounters). */
  name?: string;
  /** Extents [dx, dy, dz] for 3D oriented bounding boxes (trigger volumes). */
  extents?: [number, number, number];
  /** Forward orientation vector for trigger volumes. */
  forwardVector?: [number, number, number];
  /** Up orientation vector for trigger volumes. */
  upVector?: [number, number, number];
  /** Group letter ('A'–'Z') for AI firing positions. */
  groupLetter?: string;
  /** Netgame flag type (CTF, Oddball, Teleporter, Hill, etc.). */
  flagType?: string;
  /** Field of view in radians (for cutscene camera points). */
  fieldOfView?: number;
}

export interface ScenarioPaletteItem {
  paletteIndex: number;
  tagId: number;
  path: string;
  name: string;
}

export interface ScenarioPlacementsSummary {
  scenarioTagId: number;
  scenarioPath: string;
  totalObjects: number;
  objects: ScenarioObjectPlacement[];
  counts: {
    vehicles: number;
    scenery: number;
    bipeds: number;
    weapons: number;
    equipment: number;
    spawns: number;
    encounters?: number;
    firingPositions?: number;
    triggerVolumes?: number;
    cutsceneCameras?: number;
    netgameFlags?: number;
    decals?: number;
  };
  palettes: {
    vehicles: ScenarioPaletteItem[];
    scenery: ScenarioPaletteItem[];
    bipeds: ScenarioPaletteItem[];
    weapons: ScenarioPaletteItem[];
    equipment: ScenarioPaletteItem[];
  };
}

interface PaletteEntry {
  tagId: number;
  path: string;
  modelTagId: number;
}

/**
 * Resolves the 3D model (`gbxmodel`/`mod2`) tag ID referenced by an object tag
 * (`vehicle`, `scenery`, `biped`, `weapon`, etc.) by reading its base Object struct.
 */
function resolveObjectModelTagId(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  objectTagId: number,
): number {
  if (objectTagId === 0xffffffff) return 0xffffffff;
  const entry = tagIndex.entries[objectTagId & 0xffff];
  if (!entry || entry.isExternal) return 0xffffffff;

  try {
    const offset = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
    const objStruct = decodeStruct(buffer, offset, 'Object');
    const modelDep = objStruct.get('model');
    if (modelDep && modelDep.kind === 'dependency' && modelDep.value.tagId !== 0xffffffff) {
      return modelDep.value.tagId;
    }
  } catch {
    // If decoding Object fails (e.g. tag truncated), return 0xFFFFFFFF gracefully
  }
  return 0xffffffff;
}

/**
 * Resolves the 3D model tag ID referenced by an item collection tag (`itmc`),
 * which is used for multiplayer weapons, powerups, and equipment.
 */
function resolveItemCollectionItemTagId(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  itmcTagId: number,
): number {
  if (itmcTagId === 0xffffffff) return 0xffffffff;
  const entry = tagIndex.entries[itmcTagId & 0xffff];
  if (!entry || entry.isExternal) return 0xffffffff;
  try {
    const offset = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
    const itmcStruct = decodeStruct(buffer, offset, 'ItemCollection');
    const perms = itmcStruct.get('permutations');
    if (perms && perms.kind === 'reflexive' && perms.value.count > 0) {
      const permOffset = resolvePointer(perms.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
      const permStruct = decodeStruct(buffer, permOffset, 'ItemCollectionPermutation');
      const itemDep = permStruct.get('item');
      if (itemDep && itemDep.kind === 'dependency' && itemDep.value.tagId !== 0xffffffff) {
        return itemDep.value.tagId;
      }
    }
  } catch {
    // fallback
  }
  return 0xffffffff;
}

function resolveItemCollectionModelTagId(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  itmcTagId: number,
): number {
  const itemTagId = resolveItemCollectionItemTagId(buffer, header, tagIndex, itmcTagId);
  if (itemTagId !== 0xffffffff) {
    return resolveObjectModelTagId(buffer, header, tagIndex, itemTagId);
  }
  return 0xffffffff;
}

/**
 * Determines whether an item collection tag (`itmc`) spawns a weapon or equipment/powerup/grenade.
 */
export function getItemCollectionCategory(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  itmcTagId: number,
): 'weapon' | 'equipment' {
  if (itmcTagId === 0xffffffff) return 'equipment';
  const entry = tagIndex.entries[itmcTagId & 0xffff];
  if (!entry || entry.isExternal) return 'equipment';
  try {
    const offset = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
    const itmcStruct = decodeStruct(buffer, offset, 'ItemCollection');
    const perms = itmcStruct.get('permutations');
    if (perms && perms.kind === 'reflexive' && perms.value.count > 0) {
      const permOffset = resolvePointer(perms.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
      const permStruct = decodeStruct(buffer, permOffset, 'ItemCollectionPermutation');
      const itemDep = permStruct.get('item');
      if (itemDep && itemDep.kind === 'dependency' && itemDep.value.tagId !== 0xffffffff) {
        const itemEntry = tagIndex.entries[itemDep.value.tagId & 0xffff];
        if (itemEntry) {
          if (itemEntry.primaryClassName === 'weapon') return 'weapon';
          if (itemEntry.primaryClassName === 'equipment') return 'equipment';
        }
      }
    }
  } catch {
    // fallback
  }

  const lower = entry.path.toLowerCase();
  if (
    lower.includes('grenade') ||
    lower.includes('powerup') ||
    lower.includes('health') ||
    lower.includes('shield') ||
    lower.includes('camo')
  ) {
    return 'equipment';
  }
  if (
    lower.includes('weapon') ||
    lower.includes('pistol') ||
    lower.includes('rifle') ||
    lower.includes('shotgun') ||
    lower.includes('cannon') ||
    lower.includes('thrower') ||
    lower.includes('launcher')
  ) {
    return 'weapon';
  }
  return 'equipment';
}

function resolveActorVariantModelTagId(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  actvTagId: number,
): number {
  if (actvTagId === 0xffffffff) return 0xffffffff;
  const entry = tagIndex.entries[actvTagId & 0xffff];
  if (!entry || entry.isExternal) return 0xffffffff;
  try {
    const offset = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
    const actvStruct = decodeStruct(buffer, offset, 'ActorVariant');
    const unitDep = actvStruct.get('unit');
    if (unitDep && unitDep.kind === 'dependency' && unitDep.value.tagId !== 0xffffffff) {
      return resolveObjectModelTagId(buffer, header, tagIndex, unitDep.value.tagId);
    }
  } catch {
    // fallback
  }
  return 0xffffffff;
}

/**
 * Parses a scenario palette reflexive into an array of resolved palette entries.
 */
function parsePalette(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  paletteReflexive: { count: number; pointerLow: number } | undefined,
  structName: string,
): PaletteEntry[] {
  if (!paletteReflexive || paletteReflexive.count === 0) return [];
  const palette: PaletteEntry[] = [];
  const structSize = resolveStruct(structName).totalSize;
  const baseOffset = resolvePointer(paletteReflexive.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);

  for (let i = 0; i < paletteReflexive.count; i++) {
    try {
      const decoded = decodeStruct(buffer, baseOffset + i * structSize, structName);
      const depField = decoded.get('name') || decoded.get('reference');
      const tagId = depField && depField.kind === 'dependency' ? depField.value.tagId : 0xffffffff;
      const entry = tagId !== 0xffffffff ? tagIndex.entries[tagId & 0xffff] : undefined;
      const path = entry ? entry.path : '';
      let modelTagId = resolveObjectModelTagId(buffer, header, tagIndex, tagId);
      if (modelTagId === 0xffffffff && entry && (entry.primaryClassName === 'actor_variant' || entry.primaryClassFourCC === 0x61637476)) {
        modelTagId = resolveActorVariantModelTagId(buffer, header, tagIndex, tagId);
      }
      palette.push({ tagId, path, modelTagId });
    } catch {
      palette.push({ tagId: 0xffffffff, path: '', modelTagId: 0xffffffff });
    }
  }
  return palette;
}

/**
 * Appends a new element to any reflexive array in the map, resizing the buffer safely.
 */
export function appendReflexiveElement(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  reflexiveFieldOffset: number,
  elementBytes: Buffer,
): { buffer: Buffer; header: CacheFileHeader; newIndex: number } {
  const refl = decodeReflexive(buffer, reflexiveFieldOffset);
  const elementSize = elementBytes.length;
  const newCount = refl.count + 1;

  const oldArrayBytes =
    refl.count > 0
      ? buffer.subarray(
          resolvePointer(refl.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress),
          resolvePointer(refl.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress) + refl.count * elementSize,
        )
      : Buffer.alloc(0);
  const newArrayBytes = Buffer.concat([oldArrayBytes, elementBytes]);

  const alignedPad = (4 - (buffer.length % 4)) % 4;
  const padBuffer = alignedPad > 0 ? Buffer.alloc(alignedPad, 0) : Buffer.alloc(0);

  const newArrayFileOffset = buffer.length + padBuffer.length;
  const newArrayVirtualAddress = tagIndex.baseMemoryAddress + (newArrayFileOffset - header.tagDataOffset);

  const newBuffer = Buffer.concat([buffer, padBuffer, newArrayBytes]);
  const newHeader: CacheFileHeader = {
    ...header,
    tagDataSize: newBuffer.length - header.tagDataOffset,
    decompressedFileSize: newBuffer.length,
  };
  newBuffer.writeUInt32LE(newBuffer.length, 0x08);
  newBuffer.writeUInt32LE(newHeader.tagDataSize, 0x14);

  encodeReflexive(newBuffer, reflexiveFieldOffset, {
    count: newCount,
    pointerLow: newArrayVirtualAddress,
    pointerHigh: 0,
  });

  return {
    buffer: newBuffer,
    header: newHeader,
    newIndex: refl.count,
  };
}

/**
 * Appends multiple elements to an existing scenario reflexive array in a single allocation.
 */
export function appendReflexiveElements(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  reflexiveFieldOffset: number,
  elementsBytes: Buffer,
  countToAdd: number,
): { buffer: Buffer; header: CacheFileHeader; startIndex: number } {
  if (countToAdd <= 0 || elementsBytes.length === 0) {
    const refl = decodeReflexive(buffer, reflexiveFieldOffset);
    return { buffer, header, startIndex: refl.count };
  }
  const refl = decodeReflexive(buffer, reflexiveFieldOffset);
  const elementSize = elementsBytes.length / countToAdd;
  const newCount = refl.count + countToAdd;

  const oldArrayBytes =
    refl.count > 0
      ? buffer.subarray(
          resolvePointer(refl.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress),
          resolvePointer(refl.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress) + refl.count * elementSize,
        )
      : Buffer.alloc(0);
  const newArrayBytes = Buffer.concat([oldArrayBytes, elementsBytes]);

  const alignedPad = (4 - (buffer.length % 4)) % 4;
  const padBuffer = alignedPad > 0 ? Buffer.alloc(alignedPad, 0) : Buffer.alloc(0);

  const newArrayFileOffset = buffer.length + padBuffer.length;
  const newArrayVirtualAddress = tagIndex.baseMemoryAddress + (newArrayFileOffset - header.tagDataOffset);

  const newBuffer = Buffer.concat([buffer, padBuffer, newArrayBytes]);
  const newHeader: CacheFileHeader = {
    ...header,
    tagDataSize: newBuffer.length - header.tagDataOffset,
    decompressedFileSize: newBuffer.length,
  };
  newBuffer.writeUInt32LE(newBuffer.length, 0x08);
  newBuffer.writeUInt32LE(newHeader.tagDataSize, 0x14);

  encodeReflexive(newBuffer, reflexiveFieldOffset, {
    count: newCount,
    pointerLow: newArrayVirtualAddress,
    pointerHigh: 0,
  });

  return {
    buffer: newBuffer,
    header: newHeader,
    startIndex: refl.count,
  };
}

/**
 * Ensures that a tag is present in a scenario palette reflexive, appending a 48-byte palette entry if missing.
 */
export function ensurePaletteEntry(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  paletteFieldName: 'vehicle palette' | 'scenery palette' | 'biped palette' | 'weapon palette' | 'equipment palette' | 'machine palette' | 'actor palette',
  paletteStructName: string,
  tagId: number,
  classFourCC: number,
): { buffer: Buffer; header: CacheFileHeader; paletteIndex: number } {
  const scenarioEntry = tagIndex.entries[tagIndex.scenarioTagId & 0xffff];
  if (!scenarioEntry) {
    throw new Error(`Scenario tag (0x${tagIndex.scenarioTagId.toString(16)}) not found.`);
  }
  const scenarioOffset = resolveTagDataPointer(
    scenarioEntry.tagDataPointerOrResourceIndex,
    header,
    tagIndex.baseMemoryAddress,
  );
  const scnrDef = resolveStruct('Scenario');
  const field = scnrDef.fields.find((f) => f.name === paletteFieldName);
  if (!field) {
    throw new Error(`Palette field '${paletteFieldName}' not found in Scenario struct.`);
  }

  const reflOffset = scenarioOffset + field.offset;
  const refl = decodeReflexive(buffer, reflOffset);
  const structSize = resolveStruct(paletteStructName).totalSize;

  if (refl.count > 0) {
    const baseOffset = resolvePointer(refl.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    for (let i = 0; i < refl.count; i++) {
      const decoded = decodeStruct(buffer, baseOffset + i * structSize, paletteStructName);
      const nameDep = decoded.get('name') ?? decoded.get('reference');
      if (nameDep && nameDep.kind === 'dependency' && nameDep.value.tagId === tagId) {
        return { buffer, header, paletteIndex: i };
      }
    }
  }

  // Not in palette yet -> append new palette entry
  const tagHeaderSize = header.engine === 5 ? 0x24 : 0x28;
  const tagEntryOff = header.tagDataOffset + tagHeaderSize + (tagId & 0xffff) * 32;
  const pathPointer = tagEntryOff + 0x14 <= buffer.length ? buffer.readUInt32LE(tagEntryOff + 0x10) : 0;
  const entryBytes = Buffer.alloc(structSize, 0);
  entryBytes.writeUInt32LE(classFourCC, 0);
  entryBytes.writeUInt32LE(pathPointer >>> 0, 4);
  entryBytes.writeUInt32LE(0, 8);
  entryBytes.writeUInt32LE(tagId >>> 0, 12);

  const res = appendReflexiveElement(buffer, header, tagIndex, reflOffset, entryBytes);
  return { buffer: res.buffer, header: res.header, paletteIndex: res.newIndex };
}

/**
 * Extracts all scenario object placements from the open map.
 */
export function extractScenarioPlacements(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
): ScenarioPlacementsSummary {
  const scenarioEntry = tagIndex.entries[tagIndex.scenarioTagId & 0xffff];
  if (!scenarioEntry) {
    throw new Error(`Scenario tag (0x${tagIndex.scenarioTagId.toString(16)}) not found in tag index.`);
  }

  const scenarioOffset = resolveTagDataPointer(
    scenarioEntry.tagDataPointerOrResourceIndex,
    header,
    tagIndex.baseMemoryAddress,
  );
  const scnr = decodeStruct(buffer, scenarioOffset, 'Scenario');

  const placements: ScenarioObjectPlacement[] = [];
  const counts = {
    vehicles: 0,
    scenery: 0,
    bipeds: 0,
    weapons: 0,
    equipment: 0,
    spawns: 0,
    encounters: 0,
    firingPositions: 0,
    triggerVolumes: 0,
    cutsceneCameras: 0,
    netgameFlags: 0,
    decals: 0,
  };

  // 1. Vehicles
  const vehiclePal = parsePalette(
    buffer,
    header,
    tagIndex,
    scnr.get('vehicle palette')?.value as { count: number; pointerLow: number } | undefined,
    'ScenarioVehiclePalette',
  );
  const vehiclesRef = scnr.get('vehicles')?.value as { count: number; pointerLow: number } | undefined;
  if (vehiclesRef && vehiclesRef.count > 0) {
    const vSize = resolveStruct('ScenarioVehicle').totalSize;
    const vOffset = resolvePointer(vehiclesRef.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    for (let i = 0; i < vehiclesRef.count; i++) {
      const item = decodeStruct(buffer, vOffset + i * vSize, 'ScenarioVehicle');
      const typeIdx = (item.get('type')?.value as number) ?? 0;
      const nameIdx = (item.get('name')?.value as number) ?? -1;
      const pos = (item.get('position')?.value as [number, number, number]) || [0, 0, 0];
      const rot = (item.get('rotation')?.value as [number, number, number]) || [0, 0, 0];
      const pal = vehiclePal[typeIdx] || { tagId: 0xffffffff, path: 'Vehicle', modelTagId: 0xffffffff };

      const mpSpawnFlags = buffer.readUInt16LE(vOffset + i * vSize + 90);
      const notPlacedVal = buffer.readUInt16LE(vOffset + i * vSize + 4);
      const isForceSpawned = (mpSpawnFlags & 0x0f0f) !== 0 && (notPlacedVal & 1) === 0;

      placements.push({
        id: `vehicle-${i}`,
        kind: 'vehicle',
        paletteIndex: typeIdx,
        nameIndex: nameIdx,
        objectTagId: pal.tagId,
        objectPath: pal.path,
        modelTagId: pal.modelTagId,
        position: pos,
        rotation: rot,
        multiplayerSpawnFlags: mpSpawnFlags,
        forceSpawn: isForceSpawned,
      });
      counts.vehicles++;
    }
  }

  // 2. Scenery
  const sceneryPal = parsePalette(
    buffer,
    header,
    tagIndex,
    scnr.get('scenery palette')?.value as { count: number; pointerLow: number } | undefined,
    'ScenarioSceneryPalette',
  );
  const sceneryRef = scnr.get('scenery')?.value as { count: number; pointerLow: number } | undefined;
  if (sceneryRef && sceneryRef.count > 0) {
    const sSize = resolveStruct('ScenarioScenery').totalSize;
    const sOffset = resolvePointer(sceneryRef.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    for (let i = 0; i < sceneryRef.count; i++) {
      const item = decodeStruct(buffer, sOffset + i * sSize, 'ScenarioScenery');
      const typeIdx = (item.get('type')?.value as number) ?? 0;
      const nameIdx = (item.get('name')?.value as number) ?? -1;
      const pos = (item.get('position')?.value as [number, number, number]) || [0, 0, 0];
      const rot = (item.get('rotation')?.value as [number, number, number]) || [0, 0, 0];
      const pal = sceneryPal[typeIdx] || { tagId: 0xffffffff, path: 'Scenery', modelTagId: 0xffffffff };

      placements.push({
        id: `scenery-${i}`,
        kind: 'scenery',
        paletteIndex: typeIdx,
        nameIndex: nameIdx,
        objectTagId: pal.tagId,
        objectPath: pal.path,
        modelTagId: pal.modelTagId,
        position: pos,
        rotation: rot,
      });
      counts.scenery++;
    }
  }

  // 3. Bipeds
  const bipedPal = parsePalette(
    buffer,
    header,
    tagIndex,
    scnr.get('biped palette')?.value as { count: number; pointerLow: number } | undefined,
    'ScenarioBipedPalette',
  );
  const bipedsRef = scnr.get('bipeds')?.value as { count: number; pointerLow: number } | undefined;
  if (bipedsRef && bipedsRef.count > 0) {
    const bSize = resolveStruct('ScenarioBiped').totalSize;
    const bOffset = resolvePointer(bipedsRef.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    for (let i = 0; i < bipedsRef.count; i++) {
      const item = decodeStruct(buffer, bOffset + i * bSize, 'ScenarioBiped');
      const typeIdx = (item.get('type')?.value as number) ?? 0;
      const nameIdx = (item.get('name')?.value as number) ?? -1;
      const pos = (item.get('position')?.value as [number, number, number]) || [0, 0, 0];
      const rot = (item.get('rotation')?.value as [number, number, number]) || [0, 0, 0];
      const pal = bipedPal[typeIdx] || { tagId: 0xffffffff, path: 'Biped', modelTagId: 0xffffffff };

      placements.push({
        id: `biped-${i}`,
        kind: 'biped',
        paletteIndex: typeIdx,
        nameIndex: nameIdx,
        objectTagId: pal.tagId,
        objectPath: pal.path,
        modelTagId: pal.modelTagId,
        position: pos,
        rotation: rot,
      });
      counts.bipeds++;
    }
  }

  // 4. Weapons (Campaign / Singleplayer placements)
  const weaponPal = parsePalette(
    buffer,
    header,
    tagIndex,
    scnr.get('weapon palette')?.value as { count: number; pointerLow: number } | undefined,
    'ScenarioWeaponPalette',
  );
  const weaponsRef = scnr.get('weapons')?.value as { count: number; pointerLow: number } | undefined;
  if (weaponsRef && weaponsRef.count > 0) {
    const wSize = resolveStruct('ScenarioWeapon').totalSize;
    const wOffset = resolvePointer(weaponsRef.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    for (let i = 0; i < weaponsRef.count; i++) {
      const item = decodeStruct(buffer, wOffset + i * wSize, 'ScenarioWeapon');
      const typeIdx = (item.get('type')?.value as number) ?? 0;
      const nameIdx = (item.get('name')?.value as number) ?? -1;
      const pos = (item.get('position')?.value as [number, number, number]) || [0, 0, 0];
      const rot = (item.get('rotation')?.value as [number, number, number]) || [0, 0, 0];
      const pal = weaponPal[typeIdx] || { tagId: 0xffffffff, path: 'Weapon', modelTagId: 0xffffffff };

      placements.push({
        id: `weapon-${i}`,
        kind: 'weapon',
        paletteIndex: typeIdx,
        nameIndex: nameIdx,
        objectTagId: pal.tagId,
        objectPath: pal.path,
        modelTagId: pal.modelTagId,
        position: pos,
        rotation: rot,
      });
      counts.weapons++;
    }
  }

  // Build Comprehensive Palettes (Scenario palette items + injected / map tags)
  // Vehicle palette
  const fullVehiclePal: ScenarioPaletteItem[] = vehiclePal.map((p, i) => ({
    paletteIndex: i,
    tagId: p.tagId,
    path: p.path,
    name: p.path.split('\\').pop() || p.path || `Vehicle ${i}`,
  }));
  const vehicleTagEntries = tagIndex.entries.filter(
    (e) => (e.primaryClassName === 'vehicle' || e.primaryClassFourCC === 0x76656869) && !e.isExternal,
  );
  for (const ve of vehicleTagEntries) {
    if (!fullVehiclePal.some((p) => p.tagId === ve.tagId)) {
      fullVehiclePal.push({
        paletteIndex: fullVehiclePal.length,
        tagId: ve.tagId,
        path: ve.path,
        name: ve.path.split('\\').pop() || ve.path,
      });
    }
  }

  // Scenery palette
  const fullSceneryPal: ScenarioPaletteItem[] = sceneryPal.map((p, i) => ({
    paletteIndex: i,
    tagId: p.tagId,
    path: p.path,
    name: p.path.split('\\').pop() || p.path || `Scenery ${i}`,
  }));
  const sceneryTagEntries = tagIndex.entries.filter(
    (e) => (e.primaryClassName === 'scenery' || e.primaryClassFourCC === 0x7363656e) && !e.isExternal,
  );
  for (const se of sceneryTagEntries) {
    if (!fullSceneryPal.some((p) => p.tagId === se.tagId)) {
      fullSceneryPal.push({
        paletteIndex: fullSceneryPal.length,
        tagId: se.tagId,
        path: se.path,
        name: se.path.split('\\').pop() || se.path,
      });
    }
  }

  // Biped palette
  const fullBipedPal: ScenarioPaletteItem[] = bipedPal.map((p, i) => ({
    paletteIndex: i,
    tagId: p.tagId,
    path: p.path,
    name: p.path.split('\\').pop() || p.path || `Biped ${i}`,
  }));
  const bipedTagEntries = tagIndex.entries.filter(
    (e) => (e.primaryClassName === 'biped' || e.primaryClassFourCC === 0x62697064) && !e.isExternal,
  );
  for (const be of bipedTagEntries) {
    if (!fullBipedPal.some((p) => p.tagId === be.tagId)) {
      fullBipedPal.push({
        paletteIndex: fullBipedPal.length,
        tagId: be.tagId,
        path: be.path,
        name: be.path.split('\\').pop() || be.path,
      });
    }
  }

  // Weapon and Equipment palettes
  const itmcEntries = tagIndex.entries.filter(
    (e) => (e.primaryClassName === 'item_collection' || e.primaryClassFourCC === 0x69746d63) && !e.isExternal,
  );

  const fullWeaponPal: ScenarioPaletteItem[] = weaponPal.map((p, i) => ({
    paletteIndex: i,
    tagId: p.tagId,
    path: p.path,
    name: p.path.split('\\').pop() || p.path || `Weapon ${i}`,
  }));
  const fullEquipmentPal: ScenarioPaletteItem[] = [];

  for (const ie of itmcEntries) {
    const cat = getItemCollectionCategory(buffer, header, tagIndex, ie.tagId);
    if (cat === 'weapon') {
      if (!fullWeaponPal.some((p) => p.tagId === ie.tagId)) {
        fullWeaponPal.push({
          paletteIndex: fullWeaponPal.length,
          tagId: ie.tagId,
          path: ie.path,
          name: ie.path.split('\\').pop() || ie.path,
        });
      }
    } else {
      if (!fullEquipmentPal.some((p) => p.tagId === ie.tagId)) {
        fullEquipmentPal.push({
          paletteIndex: fullEquipmentPal.length,
          tagId: ie.tagId,
          path: ie.path,
          name: ie.path.split('\\').pop() || ie.path,
        });
      }
    }
  }

  // Also include standalone weapon tags in map
  const weaponTagEntries = tagIndex.entries.filter(
    (e) => (e.primaryClassName === 'weapon' || e.primaryClassFourCC === 0x77656170) && !e.isExternal,
  );
  for (const we of weaponTagEntries) {
    if (!fullWeaponPal.some((p) => p.tagId === we.tagId || p.path === we.path)) {
      fullWeaponPal.push({
        paletteIndex: fullWeaponPal.length,
        tagId: we.tagId,
        path: we.path,
        name: we.path.split('\\').pop() || we.path,
      });
    }
  }

  // Also include standalone equipment tags in map
  const equipmentTagEntries = tagIndex.entries.filter(
    (e) => (e.primaryClassName === 'equipment' || e.primaryClassFourCC === 0x65716970) && !e.isExternal,
  );
  for (const ee of equipmentTagEntries) {
    if (!fullEquipmentPal.some((p) => p.tagId === ee.tagId || p.path === ee.path)) {
      fullEquipmentPal.push({
        paletteIndex: fullEquipmentPal.length,
        tagId: ee.tagId,
        path: ee.path,
        name: ee.path.split('\\').pop() || ee.path,
      });
    }
  }

  // 5. Netgame Equipment (Categorized as weapon or equipment)
  const netgameEqRef = scnr.get('netgame equipment')?.value as { count: number; pointerLow: number } | undefined;
  if (netgameEqRef && netgameEqRef.count > 0) {
    const eqSize = resolveStruct('ScenarioNetgameEquipment').totalSize;
    const eqOffset = resolvePointer(netgameEqRef.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    for (let i = 0; i < netgameEqRef.count; i++) {
      const item = decodeStruct(buffer, eqOffset + i * eqSize, 'ScenarioNetgameEquipment');
      const pos = (item.get('position')?.value as [number, number, number]) || [0, 0, 0];
      const facing = (item.get('facing')?.value as number) ?? 0;
      const itemCollDep = item.get('item collection');
      const itmcTagId = itemCollDep && itemCollDep.kind === 'dependency' ? itemCollDep.value.tagId : 0xffffffff;
      const itmcEntry = itmcTagId !== 0xffffffff ? tagIndex.entries[itmcTagId & 0xffff] : undefined;
      const resolvedItemTagId = resolveItemCollectionItemTagId(buffer, header, tagIndex, itmcTagId);
      const modelTagId = resolveItemCollectionModelTagId(buffer, header, tagIndex, itmcTagId);

      const isWeapon = itmcTagId !== 0xffffffff && getItemCollectionCategory(buffer, header, tagIndex, itmcTagId) === 'weapon';
      const kind: ScenarioObjectKind = isWeapon ? 'weapon' : 'equipment';
      const targetPal = isWeapon ? fullWeaponPal : fullEquipmentPal;
      const palIdx = targetPal.findIndex((p) => p.tagId === itmcTagId);

      const type0 = buffer.readInt16LE(eqOffset + i * eqSize + 4);
      const isEqForceSpawned = type0 === 12; // 12 = 'all games'

      placements.push({
        id: `equipment-${i}`,
        kind,
        paletteIndex: palIdx >= 0 ? palIdx : 0,
        nameIndex: -1,
        objectTagId: itmcTagId,
        resolvedItemTagId: resolvedItemTagId !== 0xffffffff ? resolvedItemTagId : undefined,
        objectPath: itmcEntry ? itmcEntry.path : 'Netgame Equipment',
        modelTagId,
        position: pos,
        rotation: [facing, 0, 0],
        forceSpawn: isEqForceSpawned,
      });
      if (isWeapon) {
        counts.weapons++;
      } else {
        counts.equipment++;
      }
    }
  }

  // 6. Player Starting Locations (Spawns)
  const spawnsRef = scnr.get('player starting locations')?.value as { count: number; pointerLow: number } | undefined;
  if (spawnsRef && spawnsRef.count > 0) {
    const spSize = resolveStruct('ScenarioPlayerStartingLocation').totalSize;
    const spOffset = resolvePointer(spawnsRef.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    for (let i = 0; i < spawnsRef.count; i++) {
      const item = decodeStruct(buffer, spOffset + i * spSize, 'ScenarioPlayerStartingLocation');
      const pos = (item.get('position')?.value as [number, number, number]) || [0, 0, 0];
      const facing = (item.get('facing')?.value as number) ?? 0;
      const team = (item.get('team index')?.value as number) ?? 0;

      placements.push({
        id: `spawn-${i}`,
        kind: 'spawn',
        paletteIndex: i,
        nameIndex: -1,
        objectTagId: 0xffffffff,
        objectPath: team === 0 ? 'Player Spawn (Red)' : 'Player Spawn (Blue)',
        modelTagId: 0xffffffff,
        position: pos,
        rotation: [facing, 0, 0],
        teamIndex: team,
      });
      counts.spawns++;
    }
  }

  // 7. Encounters & AI Squad Starting Locations + Firing Positions
  const actorPal = parsePalette(
    buffer,
    header,
    tagIndex,
    scnr.get('actor palette')?.value as { count: number; pointerLow: number } | undefined,
    'ScenarioActorPalette',
  );

  const encountersRef = scnr.get('encounters')?.value as { count: number; pointerLow: number } | undefined;
  if (encountersRef && encountersRef.count > 0) {
    const encSize = resolveStruct('ScenarioEncounter').totalSize;
    const encOffset = resolvePointer(encountersRef.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    for (let eIdx = 0; eIdx < encountersRef.count; eIdx++) {
      const encItem = decodeStruct(buffer, encOffset + eIdx * encSize, 'ScenarioEncounter');
      const encName = (encItem.get('name')?.value as string) || `Encounter ${eIdx}`;
      const encTeam = (encItem.get('team index')?.value as number) ?? 0;

      // Squads & Starting Locations
      const squadsRef = encItem.get('squads')?.value as { count: number; pointerLow: number } | undefined;
      if (squadsRef && squadsRef.count > 0) {
        const sqSize = resolveStruct('ScenarioSquad').totalSize;
        const sqOffset = resolvePointer(squadsRef.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
        for (let sIdx = 0; sIdx < squadsRef.count; sIdx++) {
          const sqItem = decodeStruct(buffer, sqOffset + sIdx * sqSize, 'ScenarioSquad');
          const sqName = (sqItem.get('name')?.value as string) || `Squad ${sIdx}`;
          const sqActorType = (sqItem.get('actor type')?.value as number) ?? 0;
          const pal = actorPal[sqActorType];

          const startLocsRef = sqItem.get('starting locations')?.value as { count: number; pointerLow: number } | undefined;
          if (startLocsRef && startLocsRef.count > 0) {
            const locSize = resolveStruct('ScenarioActorStartingLocation').totalSize;
            const locOffset = resolvePointer(startLocsRef.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
            for (let lIdx = 0; lIdx < startLocsRef.count; lIdx++) {
              const locItem = decodeStruct(buffer, locOffset + lIdx * locSize, 'ScenarioActorStartingLocation');
              const pos = (locItem.get('position')?.value as [number, number, number]) || [0, 0, 0];
              const facing = (locItem.get('facing')?.value as number) ?? 0;
              const locActorType = (locItem.get('actor type')?.value as number) ?? sqActorType;
              const activePal = actorPal[locActorType] || pal || { tagId: 0xffffffff, path: 'AI Actor', modelTagId: 0xffffffff };

              placements.push({
                id: `encounter-${eIdx}-${sIdx}-${lIdx}`,
                kind: 'encounter',
                paletteIndex: locActorType,
                nameIndex: -1,
                objectTagId: activePal.tagId,
                objectPath: activePal.path || `${encName} / ${sqName}`,
                modelTagId: activePal.modelTagId,
                position: pos,
                rotation: [facing, 0, 0],
                teamIndex: encTeam,
                name: `${encName}: ${sqName} [${lIdx}]`,
              });
              counts.encounters = (counts.encounters || 0) + 1;
            }
          }
        }
      }

      // Firing Positions
      const fpRef = encItem.get('firing positions')?.value as { count: number; pointerLow: number } | undefined;
      if (fpRef && fpRef.count > 0) {
        const fpSize = resolveStruct('ScenarioFiringPosition').totalSize;
        const fpOffset = resolvePointer(fpRef.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
        for (let fIdx = 0; fIdx < fpRef.count; fIdx++) {
          const fpItem = decodeStruct(buffer, fpOffset + fIdx * fpSize, 'ScenarioFiringPosition');
          const pos = (fpItem.get('position')?.value as [number, number, number]) || [0, 0, 0];
          const grpIdx = (fpItem.get('group index')?.value as number) ?? 0;
          const letter = String.fromCharCode(65 + Math.min(25, Math.max(0, grpIdx)));

          placements.push({
            id: `firing_position-${eIdx}-${fIdx}`,
            kind: 'firing_position',
            paletteIndex: grpIdx,
            nameIndex: -1,
            objectTagId: 0xffffffff,
            objectPath: `Firing Position ${letter}`,
            modelTagId: 0xffffffff,
            position: pos,
            rotation: [0, 0, 0],
            teamIndex: encTeam,
            name: `${encName} Firing Pos ${letter} [${fIdx}]`,
            groupLetter: letter,
          });
          counts.firingPositions = (counts.firingPositions || 0) + 1;
        }
      }
    }
  }

  // 8. Trigger Volumes
  const tvRef = scnr.get('trigger volumes')?.value as { count: number; pointerLow: number } | undefined;
  if (tvRef && tvRef.count > 0) {
    const tvSize = resolveStruct('ScenarioTriggerVolume').totalSize;
    const tvOffset = resolvePointer(tvRef.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    for (let i = 0; i < tvRef.count; i++) {
      const item = decodeStruct(buffer, tvOffset + i * tvSize, 'ScenarioTriggerVolume');
      const name = (item.get('name')?.value as string) || `Trigger ${i}`;
      const corner = (item.get('starting corner')?.value as [number, number, number]) || [0, 0, 0];
      const extents = (item.get('ending corner offset')?.value as [number, number, number]) || [1, 1, 1];
      const forward = (item.get('rotation vector forward')?.value as [number, number, number]) || [1, 0, 0];
      const up = (item.get('rotation vector up')?.value as [number, number, number]) || [0, 0, 1];

      placements.push({
        id: `trigger_volume-${i}`,
        kind: 'trigger_volume',
        paletteIndex: i,
        nameIndex: -1,
        objectTagId: 0xffffffff,
        objectPath: `Trigger: ${name}`,
        modelTagId: 0xffffffff,
        position: corner,
        rotation: [0, 0, 0],
        name,
        extents,
        forwardVector: forward,
        upVector: up,
      });
      counts.triggerVolumes = (counts.triggerVolumes || 0) + 1;
    }
  }

  // 9. Cutscene Camera Points
  const camRef = scnr.get('cutscene camera points')?.value as { count: number; pointerLow: number } | undefined;
  if (camRef && camRef.count > 0) {
    const camSize = resolveStruct('ScenarioCutsceneCameraPoint').totalSize;
    const camOffset = resolvePointer(camRef.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    for (let i = 0; i < camRef.count; i++) {
      const item = decodeStruct(buffer, camOffset + i * camSize, 'ScenarioCutsceneCameraPoint');
      const name = (item.get('name')?.value as string) || `Camera ${i}`;
      const pos = (item.get('position')?.value as [number, number, number]) || [0, 0, 0];
      const orient = (item.get('orientation')?.value as [number, number, number]) || [0, 0, 0];
      const fov = (item.get('field of view')?.value as number) ?? 1.22;

      placements.push({
        id: `cutscene_camera-${i}`,
        kind: 'cutscene_camera',
        paletteIndex: i,
        nameIndex: -1,
        objectTagId: 0xffffffff,
        objectPath: `Cutscene Cam: ${name}`,
        modelTagId: 0xffffffff,
        position: pos,
        rotation: orient,
        name,
        fieldOfView: fov,
      });
      counts.cutsceneCameras = (counts.cutsceneCameras || 0) + 1;
    }
  }

  // 10. Netgame Flags
  const NETGAME_FLAG_TYPES = [
    'CTF Flag',
    'CTF Vehicle',
    'Oddball Spawn',
    'Race Track',
    'Race Vehicle',
    'Vegas Bank',
    'Teleport Source',
    'Teleport Dest',
    'Hill Flag',
  ];
  const nfRef = scnr.get('netgame flags')?.value as { count: number; pointerLow: number } | undefined;
  if (nfRef && nfRef.count > 0) {
    const nfSize = resolveStruct('ScenarioNetgameFlags').totalSize;
    const nfOffset = resolvePointer(nfRef.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    for (let i = 0; i < nfRef.count; i++) {
      const item = decodeStruct(buffer, nfOffset + i * nfSize, 'ScenarioNetgameFlags');
      const pos = (item.get('position')?.value as [number, number, number]) || [0, 0, 0];
      const facing = (item.get('facing')?.value as number) ?? 0;
      const typeIdx = (item.get('type')?.value as number) ?? 0;
      const usageId = (item.get('usage id')?.value as number) ?? 0;
      const flagName = NETGAME_FLAG_TYPES[typeIdx] || `Flag Type ${typeIdx}`;

      let displayName = `${flagName} #${i}`;
      let displayPath = `${flagName} (${usageId})`;
      if (typeIdx === 6) {
        displayName = `Teleport Origin #${usageId}`;
        displayPath = `Teleport Origin (ID: ${usageId})`;
      } else if (typeIdx === 7) {
        displayName = `Teleport Destination #${usageId}`;
        displayPath = `Teleport Destination (ID: ${usageId})`;
      } else if (typeIdx === 8) {
        displayName = `KOTH Hill Marker #${i} (Hill ${usageId})`;
        displayPath = `KOTH Hill Point (Hill ID: ${usageId})`;
      } else if (typeIdx === 3) {
        displayName = `Race Checkpoint #${usageId}`;
        displayPath = `Race Track Marker (ID: ${usageId})`;
      } else if (typeIdx === 2) {
        displayName = `Oddball Spawn #${usageId}`;
        displayPath = `Oddball Spawn (ID: ${usageId})`;
      } else if (typeIdx === 0) {
        displayName = `CTF Flag (${usageId === 0 ? "Red" : "Blue"})`;
        displayPath = `CTF Flag (${usageId === 0 ? "Red" : "Blue"})`;
      }

      placements.push({
        id: `netgame_flag-${i}`,
        kind: 'netgame_flag',
        paletteIndex: typeIdx,
        nameIndex: -1,
        objectTagId: 0xffffffff,
        objectPath: displayPath,
        modelTagId: 0xffffffff,
        position: pos,
        rotation: [facing, 0, 0],
        teamIndex: usageId,
        flagType: flagName,
        name: displayName,
      });
      counts.netgameFlags = (counts.netgameFlags || 0) + 1;
    }
  }

  // 11. Decals
  const decRef = scnr.get('decals')?.value as { count: number; pointerLow: number } | undefined;
  if (decRef && decRef.count > 0) {
    const decSize = resolveStruct('ScenarioDecal').totalSize;
    const decOffset = resolvePointer(decRef.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    for (let i = 0; i < decRef.count; i++) {
      const item = decodeStruct(buffer, decOffset + i * decSize, 'ScenarioDecal');
      const pos = (item.get('position')?.value as [number, number, number]) || [0, 0, 0];
      const typeIdx = (item.get('decal type')?.value as number) ?? 0;
      const yaw = (item.get('yaw')?.value as number) ?? 0;
      const pitch = (item.get('pitch')?.value as number) ?? 0;

      placements.push({
        id: `decal-${i}`,
        kind: 'decal',
        paletteIndex: typeIdx,
        nameIndex: -1,
        objectTagId: 0xffffffff,
        objectPath: `Decal ${typeIdx}`,
        modelTagId: 0xffffffff,
        position: pos,
        rotation: [(yaw / 128) * Math.PI, (pitch / 128) * Math.PI, 0],
        name: `Decal #${i}`,
      });
      counts.decals = (counts.decals || 0) + 1;
    }
  }

  return {
    scenarioTagId: tagIndex.scenarioTagId,
    scenarioPath: scenarioEntry.path,
    totalObjects: placements.length,
    objects: placements,
    counts,
    palettes: {
      vehicles: fullVehiclePal,
      scenery: fullSceneryPal,
      bipeds: fullBipedPal,
      weapons: fullWeaponPal,
      equipment: fullEquipmentPal,
    },
  };
}

/**
 * Resolves reflexive offset, size, and count for a scenario object category.
 */
function getScenarioReflexiveInfo(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  kind: ScenarioObjectKind,
): {
  scenarioOffset: number;
  reflexiveFieldOffset: number;
  structName: string;
  structSize: number;
  count: number;
  baseOffset: number;
  pointerLow: number;
} {
  const scenarioEntry = tagIndex.entries[tagIndex.scenarioTagId & 0xffff];
  if (!scenarioEntry) {
    throw new Error(`Scenario tag (0x${tagIndex.scenarioTagId.toString(16)}) not found.`);
  }
  const scenarioOffset = resolveTagDataPointer(
    scenarioEntry.tagDataPointerOrResourceIndex,
    header,
    tagIndex.baseMemoryAddress,
  );

  const reflexiveNameMap: Record<ScenarioObjectKind, { fieldName: string; structName: string }> = {
    vehicle: { fieldName: 'vehicles', structName: 'ScenarioVehicle' },
    scenery: { fieldName: 'scenery', structName: 'ScenarioScenery' },
    biped: { fieldName: 'bipeds', structName: 'ScenarioBiped' },
    weapon: { fieldName: 'weapons', structName: 'ScenarioWeapon' },
    equipment: { fieldName: 'netgame equipment', structName: 'ScenarioNetgameEquipment' },
    spawn: { fieldName: 'player starting locations', structName: 'ScenarioPlayerStartingLocation' },
    encounter: { fieldName: 'encounters', structName: 'ScenarioEncounter' },
    firing_position: { fieldName: 'encounters', structName: 'ScenarioEncounter' },
    trigger_volume: { fieldName: 'trigger volumes', structName: 'ScenarioTriggerVolume' },
    cutscene_camera: { fieldName: 'cutscene camera points', structName: 'ScenarioCutsceneCameraPoint' },
    netgame_flag: { fieldName: 'netgame flags', structName: 'ScenarioNetgameFlags' },
    decal: { fieldName: 'decals', structName: 'ScenarioDecal' },
  };

  const { fieldName, structName } = reflexiveNameMap[kind];
  const scnrDef = resolveStruct('Scenario');
  const field = scnrDef.fields.find((f) => f.name === fieldName);
  if (!field) {
    throw new Error(`Field '${fieldName}' not found in Scenario struct.`);
  }

  const reflexiveFieldOffset = scenarioOffset + field.offset;
  const refl = decodeReflexive(buffer, reflexiveFieldOffset);
  const structSize = resolveStruct(structName).totalSize;
  const baseOffset = refl.count > 0 ? resolvePointer(refl.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress) : 0;

  return {
    scenarioOffset,
    reflexiveFieldOffset,
    structName,
    structSize,
    count: refl.count,
    baseOffset,
    pointerLow: refl.pointerLow,
  };
}

/**
 * Updates an existing scenario object's position, rotation, paletteIndex, or teamIndex in-place.
 */
export function updateScenarioPlacement(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  placementId: string,
  updates: {
    position?: [number, number, number];
    rotation?: [number, number, number];
    paletteIndex?: number;
    teamIndex?: number;
    multiplayerSpawnFlags?: number;
    forceSpawn?: boolean;
  },
): ScenarioPlacementsSummary {
  const [kindStr, idxStr] = placementId.split('-');
  const index = parseInt(idxStr, 10);

  if (kindStr === 'spawn') {
    const info = getScenarioReflexiveInfo(buffer, header, tagIndex, 'spawn');
    if (index < 0 || index >= info.count) {
      throw new Error(`Placement index ${index} out of range (count: ${info.count}) for kind spawn.`);
    }
    const itemOffset = info.baseOffset + index * info.structSize;
    if (updates.position) {
      buffer.writeFloatLE(updates.position[0], itemOffset + 0);
      buffer.writeFloatLE(updates.position[1], itemOffset + 4);
      buffer.writeFloatLE(updates.position[2], itemOffset + 8);
    }
    if (updates.rotation) {
      buffer.writeFloatLE(updates.rotation[0], itemOffset + 12);
    }
    if (updates.teamIndex !== undefined) {
      buffer.writeInt16LE(updates.teamIndex, itemOffset + 16);
    }
  } else if (kindStr === 'equipment') {
    const info = getScenarioReflexiveInfo(buffer, header, tagIndex, 'equipment');
    if (index < 0 || index >= info.count) {
      throw new Error(`Placement index ${index} out of range (count: ${info.count}) for kind equipment.`);
    }
    const itemOffset = info.baseOffset + index * info.structSize;
    if (updates.position) {
      buffer.writeFloatLE(updates.position[0], itemOffset + 64);
      buffer.writeFloatLE(updates.position[1], itemOffset + 68);
      buffer.writeFloatLE(updates.position[2], itemOffset + 72);
    }
    if (updates.rotation) {
      buffer.writeFloatLE(updates.rotation[0], itemOffset + 76);
    }
    if (updates.forceSpawn !== undefined && updates.forceSpawn) {
      buffer.writeInt16LE(12, itemOffset + 4); // 12 = all games
    }
    if (updates.paletteIndex !== undefined) {
      const summary = extractScenarioPlacements(buffer, header, tagIndex);
      const curPlacement = summary.objects.find((o) => o.id === placementId);
      const isWeapon = curPlacement?.kind === 'weapon';
      const targetPal = isWeapon ? summary.palettes.weapons : summary.palettes.equipment;
      const chosen = targetPal[updates.paletteIndex];
      if (chosen) {
        buffer.write('itmc', itemOffset + 80, 4, 'ascii');
        buffer.writeUInt32LE(0, itemOffset + 84);
        buffer.writeUInt32LE(0, itemOffset + 88);
        buffer.writeUInt32LE(chosen.tagId, itemOffset + 92);
      }
    }
  } else if (kindStr === 'trigger_volume') {
    const info = getScenarioReflexiveInfo(buffer, header, tagIndex, 'trigger_volume');
    if (index < 0 || index >= info.count) {
      throw new Error(`Placement index ${index} out of range for trigger_volume.`);
    }
    const itemOffset = info.baseOffset + index * info.structSize;
    if (updates.position) {
      buffer.writeFloatLE(updates.position[0], itemOffset + 72);
      buffer.writeFloatLE(updates.position[1], itemOffset + 76);
      buffer.writeFloatLE(updates.position[2], itemOffset + 80);
    }
  } else if (kindStr === 'cutscene_camera') {
    const info = getScenarioReflexiveInfo(buffer, header, tagIndex, 'cutscene_camera');
    if (index < 0 || index >= info.count) {
      throw new Error(`Placement index ${index} out of range for cutscene_camera.`);
    }
    const itemOffset = info.baseOffset + index * info.structSize;
    if (updates.position) {
      buffer.writeFloatLE(updates.position[0], itemOffset + 40);
      buffer.writeFloatLE(updates.position[1], itemOffset + 44);
      buffer.writeFloatLE(updates.position[2], itemOffset + 48);
    }
    if (updates.rotation) {
      buffer.writeFloatLE(updates.rotation[0], itemOffset + 52);
      buffer.writeFloatLE(updates.rotation[1], itemOffset + 56);
      buffer.writeFloatLE(updates.rotation[2], itemOffset + 60);
    }
  } else if (kindStr === 'netgame_flag') {
    const info = getScenarioReflexiveInfo(buffer, header, tagIndex, 'netgame_flag');
    if (index < 0 || index >= info.count) {
      throw new Error(`Placement index ${index} out of range for netgame_flag.`);
    }
    const itemOffset = info.baseOffset + index * info.structSize;
    if (updates.position) {
      buffer.writeFloatLE(updates.position[0], itemOffset + 0);
      buffer.writeFloatLE(updates.position[1], itemOffset + 4);
      buffer.writeFloatLE(updates.position[2], itemOffset + 8);
    }
    if (updates.rotation) {
      buffer.writeFloatLE(updates.rotation[0], itemOffset + 12);
    }
    if (updates.paletteIndex !== undefined) {
      buffer.writeInt16LE(updates.paletteIndex, itemOffset + 16);
    }
    if (updates.teamIndex !== undefined) {
      buffer.writeInt16LE(updates.teamIndex, itemOffset + 18);
    }
  } else if (kindStr === 'decal') {
    const info = getScenarioReflexiveInfo(buffer, header, tagIndex, 'decal');
    if (index < 0 || index >= info.count) {
      throw new Error(`Placement index ${index} out of range for decal.`);
    }
    const itemOffset = info.baseOffset + index * info.structSize;
    if (updates.position) {
      buffer.writeFloatLE(updates.position[0], itemOffset + 4);
      buffer.writeFloatLE(updates.position[1], itemOffset + 8);
      buffer.writeFloatLE(updates.position[2], itemOffset + 12);
    }
  } else if (kindStr === 'encounter') {
    const parts = placementId.split('-');
    const eIdx = parseInt(parts[1], 10);
    const sIdx = parseInt(parts[2], 10);
    const lIdx = parseInt(parts[3], 10);
    const scnrDef = resolveStruct('Scenario');
    const encField = scnrDef.fields.find((f) => f.name === 'encounters');
    if (encField) {
      const scenarioOffset = resolveTagDataPointer(
        tagIndex.entries[tagIndex.scenarioTagId & 0xffff].tagDataPointerOrResourceIndex,
        header,
        tagIndex.baseMemoryAddress,
      );
      const encRefl = decodeReflexive(buffer, scenarioOffset + encField.offset);
      if (eIdx >= 0 && eIdx < encRefl.count) {
        const encBase = resolvePointer(encRefl.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
        const encItemOffset = encBase + eIdx * resolveStruct('ScenarioEncounter').totalSize;
        const encItem = decodeStruct(buffer, encItemOffset, 'ScenarioEncounter');
        const squadsRef = encItem.get('squads')?.value as { count: number; pointerLow: number } | undefined;
        if (squadsRef && sIdx >= 0 && sIdx < squadsRef.count) {
          const sqBase = resolvePointer(squadsRef.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
          const sqItemOffset = sqBase + sIdx * resolveStruct('ScenarioSquad').totalSize;
          const sqItem = decodeStruct(buffer, sqItemOffset, 'ScenarioSquad');
          const startLocsRef = sqItem.get('starting locations')?.value as { count: number; pointerLow: number } | undefined;
          if (startLocsRef && lIdx >= 0 && lIdx < startLocsRef.count) {
            const locBase = resolvePointer(startLocsRef.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
            const locOffset = locBase + lIdx * resolveStruct('ScenarioActorStartingLocation').totalSize;
            if (updates.position) {
              buffer.writeFloatLE(updates.position[0], locOffset + 0);
              buffer.writeFloatLE(updates.position[1], locOffset + 4);
              buffer.writeFloatLE(updates.position[2], locOffset + 8);
            }
            if (updates.rotation) {
              buffer.writeFloatLE(updates.rotation[0], locOffset + 12);
            }
          }
        }
      }
    }
  } else if (kindStr === 'firing_position') {
    const parts = placementId.split('-');
    const eIdx = parseInt(parts[1], 10);
    const fIdx = parseInt(parts[2], 10);
    const scnrDef = resolveStruct('Scenario');
    const encField = scnrDef.fields.find((f) => f.name === 'encounters');
    if (encField) {
      const scenarioOffset = resolveTagDataPointer(
        tagIndex.entries[tagIndex.scenarioTagId & 0xffff].tagDataPointerOrResourceIndex,
        header,
        tagIndex.baseMemoryAddress,
      );
      const encRefl = decodeReflexive(buffer, scenarioOffset + encField.offset);
      if (eIdx >= 0 && eIdx < encRefl.count) {
        const encBase = resolvePointer(encRefl.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
        const encItemOffset = encBase + eIdx * resolveStruct('ScenarioEncounter').totalSize;
        const encItem = decodeStruct(buffer, encItemOffset, 'ScenarioEncounter');
        const fpRef = encItem.get('firing positions')?.value as { count: number; pointerLow: number } | undefined;
        if (fpRef && fIdx >= 0 && fIdx < fpRef.count) {
          const fpBase = resolvePointer(fpRef.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
          const fpOffset = fpBase + fIdx * resolveStruct('ScenarioFiringPosition').totalSize;
          if (updates.position) {
            buffer.writeFloatLE(updates.position[0], fpOffset + 0);
            buffer.writeFloatLE(updates.position[1], fpOffset + 4);
            buffer.writeFloatLE(updates.position[2], fpOffset + 8);
          }
        }
      }
    }
  } else {
    const kind = kindStr as ScenarioObjectKind;
    const info = getScenarioReflexiveInfo(buffer, header, tagIndex, kind);
    if (index < 0 || index >= info.count) {
      throw new Error(`Placement index ${index} out of range (count: ${info.count}) for kind ${kind}.`);
    }
    const itemOffset = info.baseOffset + index * info.structSize;
    if (updates.position) {
      buffer.writeFloatLE(updates.position[0], itemOffset + 8);
      buffer.writeFloatLE(updates.position[1], itemOffset + 12);
      buffer.writeFloatLE(updates.position[2], itemOffset + 16);
    }
    if (updates.rotation) {
      buffer.writeFloatLE(updates.rotation[0], itemOffset + 20);
      buffer.writeFloatLE(updates.rotation[1], itemOffset + 24);
      buffer.writeFloatLE(updates.rotation[2], itemOffset + 28);
    }
    if (updates.paletteIndex !== undefined) {
      buffer.writeInt16LE(updates.paletteIndex, itemOffset + 0);
    }
    if (kind === 'vehicle') {
      if (updates.forceSpawn !== undefined) {
        if (updates.forceSpawn) {
          buffer.writeUInt16LE(0, itemOffset + 4); // clear not placed
          buffer.writeFloatLE(1.0, itemOffset + 72); // full vitality
          buffer.writeUInt16LE(0x0f0f, itemOffset + 90); // all gametypes default+allowed
        } else {
          buffer.writeUInt16LE(0, itemOffset + 90);
        }
      }
      if (updates.multiplayerSpawnFlags !== undefined) {
        buffer.writeUInt16LE(updates.multiplayerSpawnFlags, itemOffset + 90);
      }
    }
  }

  return extractScenarioPlacements(buffer, header, tagIndex);
}

/**
 * Duplicates an existing scenario object, cloning its struct and appending it to the reflexive array.
 */
export function duplicateScenarioPlacement(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  placementId: string,
  offsetDelta: [number, number, number] = [1.5, 1.5, 0],
): {
  buffer: Buffer;
  header: CacheFileHeader;
  summary: ScenarioPlacementsSummary;
  newPlacement: ScenarioObjectPlacement;
} {
  const [kindStr, idxStr] = placementId.split('-');
  const kind = kindStr as ScenarioObjectKind;
  const index = parseInt(idxStr, 10);

  const info = getScenarioReflexiveInfo(buffer, header, tagIndex, kind);
  if (index < 0 || index >= info.count) {
    throw new Error(`Placement index ${index} out of range (count: ${info.count}) for kind ${kind}.`);
  }

  const sourceItemOffset = info.baseOffset + index * info.structSize;
  const sourceBytes = buffer.subarray(sourceItemOffset, sourceItemOffset + info.structSize);
  const newItemBytes = Buffer.from(sourceBytes);

  // Offset position slightly so it doesn't z-fight with original
  if (kind === 'spawn' || kind === 'netgame_flag') {
    const curX = newItemBytes.readFloatLE(0);
    const curY = newItemBytes.readFloatLE(4);
    const curZ = newItemBytes.readFloatLE(8);
    newItemBytes.writeFloatLE(curX + offsetDelta[0], 0);
    newItemBytes.writeFloatLE(curY + offsetDelta[1], 4);
    newItemBytes.writeFloatLE(curZ + offsetDelta[2], 8);
  } else if (kind === 'equipment') {
    const curX = newItemBytes.readFloatLE(64);
    const curY = newItemBytes.readFloatLE(68);
    const curZ = newItemBytes.readFloatLE(72);
    newItemBytes.writeFloatLE(curX + offsetDelta[0], 64);
    newItemBytes.writeFloatLE(curY + offsetDelta[1], 68);
    newItemBytes.writeFloatLE(curZ + offsetDelta[2], 72);
  } else {
    const curX = newItemBytes.readFloatLE(8);
    const curY = newItemBytes.readFloatLE(12);
    const curZ = newItemBytes.readFloatLE(16);
    newItemBytes.writeFloatLE(curX + offsetDelta[0], 8);
    newItemBytes.writeFloatLE(curY + offsetDelta[1], 12);
    newItemBytes.writeFloatLE(curZ + offsetDelta[2], 16);
    newItemBytes.writeInt16LE(-1, 2); // Unnamed
  }

  const appended = appendReflexiveElement(buffer, header, tagIndex, info.reflexiveFieldOffset, newItemBytes);
  const summary = extractScenarioPlacements(appended.buffer, appended.header, tagIndex);
  const newId = `${kind}-${info.count}`;
  const newPlacement = summary.objects.find((o) => o.id === newId)!;

  return {
    buffer: appended.buffer,
    header: appended.header,
    summary,
    newPlacement,
  };
}

/**
 * Adds a new scenario object placement of the specified kind at the given coordinates.
 */
export function addScenarioPlacement(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  kind: ScenarioObjectKind,
  paletteIndex: number,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  teamIndex?: number,
): {
  buffer: Buffer;
  header: CacheFileHeader;
  tagIndex?: TagIndex;
  summary: ScenarioPlacementsSummary;
  newPlacement: ScenarioObjectPlacement;
} {
  let curBuf = buffer;
  let curHdr = header;
  let curTagIndex = tagIndex;

  const summaryBefore = extractScenarioPlacements(curBuf, curHdr, tagIndex);

  if (kind === 'spawn') {
    const info = getScenarioReflexiveInfo(curBuf, curHdr, tagIndex, 'spawn');
    const newItemBytes = Buffer.alloc(info.structSize, 0);
    newItemBytes.writeFloatLE(position[0], 0);
    newItemBytes.writeFloatLE(position[1], 4);
    newItemBytes.writeFloatLE(position[2], 8);
    newItemBytes.writeFloatLE(rotation[0], 12);
    newItemBytes.writeInt16LE(teamIndex ?? 0, 16);
    newItemBytes.writeInt16LE(0, 18); // bsp index = 0
    newItemBytes.writeInt16LE(12, 20); // type 0 = 12 (all games - player can spawn in all gametypes)
    newItemBytes.writeInt16LE(0, 22);  // type 1 = 0 (none)
    newItemBytes.writeInt16LE(0, 24);  // type 2 = 0 (none)
    newItemBytes.writeInt16LE(0, 26);  // type 3 = 0 (none)

    const appended = appendReflexiveElement(curBuf, curHdr, tagIndex, info.reflexiveFieldOffset, newItemBytes);
    const summary = extractScenarioPlacements(appended.buffer, appended.header, tagIndex);
    const newId = `spawn-${info.count}`;
    const newPlacement = summary.objects.find((o) => o.id === newId)!;
    return { buffer: appended.buffer, header: appended.header, summary, newPlacement };
  }

  if (kind === 'netgame_flag') {
    const info = getScenarioReflexiveInfo(curBuf, curHdr, tagIndex, 'netgame_flag');
    const newItemBytes = Buffer.alloc(info.structSize, 0);
    newItemBytes.writeFloatLE(position[0], 0);
    newItemBytes.writeFloatLE(position[1], 4);
    newItemBytes.writeFloatLE(position[2], 8);
    newItemBytes.writeFloatLE(rotation[0], 12);
    newItemBytes.writeInt16LE(paletteIndex, 16); // flag type: 6=teleport from, 7=teleport to, 8=hill flag, 3=race track, 2=oddball spawn
    newItemBytes.writeInt16LE(teamIndex ?? 0, 18); // usage id: Teleport ID, KOTH ID, Race ID, Oddball ID
    newItemBytes.writeUInt32LE(0xffffffff, 20);
    newItemBytes.writeUInt32LE(0xffffffff, 24);
    newItemBytes.writeUInt32LE(0xffffffff, 28);
    newItemBytes.writeUInt32LE(0xffffffff, 32);

    const appended = appendReflexiveElement(curBuf, curHdr, tagIndex, info.reflexiveFieldOffset, newItemBytes);
    const summary = extractScenarioPlacements(appended.buffer, appended.header, tagIndex);
    const newId = `netgame_flag-${info.count}`;
    const newPlacement = summary.objects.find((o) => o.id === newId)!;
    return { buffer: appended.buffer, header: appended.header, summary, newPlacement };
  }

  if (kind === 'vehicle') {
    const chosen = summaryBefore.palettes.vehicles[paletteIndex] || summaryBefore.palettes.vehicles[0];
    if (!chosen) throw new Error('No vehicle available in map palettes.');

    const palRes = ensurePaletteEntry(curBuf, curHdr, tagIndex, 'vehicle palette', 'ScenarioVehiclePalette', chosen.tagId, 0x76656869);
    curBuf = palRes.buffer;
    curHdr = palRes.header;

    const info = getScenarioReflexiveInfo(curBuf, curHdr, tagIndex, 'vehicle');
    const newItemBytes = Buffer.alloc(info.structSize, 0);
    newItemBytes.writeInt16LE(palRes.paletteIndex, 0);
    newItemBytes.writeInt16LE(-1, 2);
    newItemBytes.writeUInt16LE(0, 4); // not placed = 0 (placed automatically)
    newItemBytes.writeFloatLE(position[0], 8);
    newItemBytes.writeFloatLE(position[1], 12);
    newItemBytes.writeFloatLE(position[2], 16);
    newItemBytes.writeFloatLE(rotation[0], 20);
    newItemBytes.writeFloatLE(rotation[1], 24);
    newItemBytes.writeFloatLE(rotation[2], 28);
    newItemBytes.writeUInt16LE(1, 32); // on_bsp_flags = 1 (BSP 0)
    newItemBytes.writeFloatLE(1.0, 72); // body vitality = 1.0 (full health)
    newItemBytes.writeUInt16LE(0x0f0f, 90); // default & allowed for all multiplayer gametypes

    const appended = appendReflexiveElement(curBuf, curHdr, tagIndex, info.reflexiveFieldOffset, newItemBytes);
    const summary = extractScenarioPlacements(appended.buffer, appended.header, tagIndex);
    const newId = `vehicle-${info.count}`;
    const newPlacement = summary.objects.find((o) => o.id === newId)!;
    return { buffer: appended.buffer, header: appended.header, summary, newPlacement };
  }

  if (kind === 'scenery') {
    const chosen = summaryBefore.palettes.scenery[paletteIndex] || summaryBefore.palettes.scenery[0];
    if (!chosen) throw new Error('No scenery available in map palettes.');

    const palRes = ensurePaletteEntry(curBuf, curHdr, tagIndex, 'scenery palette', 'ScenarioSceneryPalette', chosen.tagId, 0x7363656e);
    curBuf = palRes.buffer;
    curHdr = palRes.header;

    const info = getScenarioReflexiveInfo(curBuf, curHdr, tagIndex, 'scenery');
    const newItemBytes = Buffer.alloc(info.structSize, 0);
    newItemBytes.writeInt16LE(palRes.paletteIndex, 0);
    newItemBytes.writeInt16LE(-1, 2);
    newItemBytes.writeFloatLE(position[0], 8);
    newItemBytes.writeFloatLE(position[1], 12);
    newItemBytes.writeFloatLE(position[2], 16);
    newItemBytes.writeFloatLE(rotation[0], 20);
    newItemBytes.writeFloatLE(rotation[1], 24);
    newItemBytes.writeFloatLE(rotation[2], 28);
    newItemBytes.writeUInt16LE(1, 32); // on_bsp_flags = 1 (BSP 0)

    const appended = appendReflexiveElement(curBuf, curHdr, tagIndex, info.reflexiveFieldOffset, newItemBytes);
    const summary = extractScenarioPlacements(appended.buffer, appended.header, tagIndex);
    const newId = `scenery-${info.count}`;
    const newPlacement = summary.objects.find((o) => o.id === newId)!;
    return { buffer: appended.buffer, header: appended.header, summary, newPlacement };
  }

  if (kind === 'biped') {
    const chosen = summaryBefore.palettes.bipeds[paletteIndex] || summaryBefore.palettes.bipeds[0];
    if (!chosen) throw new Error('No biped available in map palettes.');

    const palRes = ensurePaletteEntry(curBuf, curHdr, tagIndex, 'biped palette', 'ScenarioBipedPalette', chosen.tagId, 0x62697064);
    curBuf = palRes.buffer;
    curHdr = palRes.header;

    const info = getScenarioReflexiveInfo(curBuf, curHdr, tagIndex, 'biped');
    const newItemBytes = Buffer.alloc(info.structSize, 0);
    newItemBytes.writeInt16LE(palRes.paletteIndex, 0);
    newItemBytes.writeInt16LE(-1, 2);
    newItemBytes.writeFloatLE(position[0], 8);
    newItemBytes.writeFloatLE(position[1], 12);
    newItemBytes.writeFloatLE(position[2], 16);
    newItemBytes.writeFloatLE(rotation[0], 20);
    newItemBytes.writeFloatLE(rotation[1], 24);
    newItemBytes.writeFloatLE(rotation[2], 28);
    newItemBytes.writeUInt16LE(1, 32); // on_bsp_flags = 1 (BSP 0)

    const appended = appendReflexiveElement(curBuf, curHdr, tagIndex, info.reflexiveFieldOffset, newItemBytes);
    const summary = extractScenarioPlacements(appended.buffer, appended.header, tagIndex);
    const newId = `biped-${info.count}`;
    const newPlacement = summary.objects.find((o) => o.id === newId)!;
    return { buffer: appended.buffer, header: appended.header, summary, newPlacement };
  }

  // weapon or equipment
  const isWeaponKind = kind === 'weapon';
  const targetPal = isWeaponKind ? summaryBefore.palettes.weapons : summaryBefore.palettes.equipment;
  const chosen = targetPal[paletteIndex] || targetPal[0];
  if (!chosen) throw new Error(`No ${kind} available in map palettes.`);

  let itmcTagId = chosen.tagId;
  const entry = curTagIndex.entries[chosen.tagId & 0xffff];
  if (entry && entry.primaryClassName !== 'item_collection') {
    const matchingItmc = curTagIndex.entries.find((e) => {
      if (e.primaryClassName !== 'item_collection' || e.isExternal) return false;
      const itemId = resolveItemCollectionItemTagId(curBuf, curHdr, curTagIndex, e.tagId);
      return itemId !== 0xffffffff && itemId === chosen.tagId;
    });
    if (matchingItmc) {
      itmcTagId = matchingItmc.tagId;
    } else if (entry.primaryClassName === 'weapon' || entry.primaryClassName === 'equipment') {
      // Synthesize a 176-byte ItemCollection (itmc) tag wrapping this standalone weapon/equipment
      // so Halo CE's multiplayer netgame_equipment spawner can spawn it (e.g. droppable CTF Flag item)
      try {
        const shortName = entry.path.split('\\').pop() || 'custom_item';
        const folder = entry.primaryClassName === 'weapon' ? 'single weapons' : 'powerups';
        let itmcPath = `item collections\\${folder}\\${shortName}`;
        let suffix = 1;
        while (
          curTagIndex.entries.some(
            (e) => e.primaryClassName === 'item_collection' && e.path.toLowerCase() === itmcPath.toLowerCase(),
          )
        ) {
          itmcPath = `item collections\\${folder}\\${shortName}_${suffix++}`;
        }

        const itmcBytes = Buffer.alloc(176, 0);
        // ItemCollection root (92B): permutations reflexive at +0 (count=1, pointerLow=92), spawn time at +12
        itmcBytes.writeUInt32LE(1, 0);
        itmcBytes.writeUInt32LE(92, 4);
        itmcBytes.writeUInt32LE(0, 8);
        itmcBytes.writeInt16LE(30, 12);
        // ItemCollectionPermutation (84B at +92): weight=1.0 at +32, item TagDependency at +36
        itmcBytes.writeFloatLE(1.0, 92 + 32);
        itmcBytes.writeUInt32LE(entry.primaryClassName === 'weapon' ? 0x77656170 : 0x65716970, 92 + 36);
        itmcBytes.writeUInt32LE(0xffffffff, 92 + 48);

        const synthContainer: OceContainer = {
          magic: OCETAGS_MAGIC,
          formatVersion: OCETAGS_FORMAT_VERSION,
          createdAt: new Date().toISOString(),
          sourceMapName: 'scenario_editor',
          hasUnresolvedBspReferences: false,
          resourceMapIdentities: {},
          externalResourceRefs: [],
          externalData: 'embedded',
          rootOriginalIndices: [99999],
          tags: [
            {
              originalIndex: 99999,
              group: 'item_collection',
              path: itmcPath,
              structName: 'ItemCollection',
              secondaryClassFourCC: null,
              tertiaryClassFourCC: null,
              data: itmcBytes.toString('base64'),
              dependencies: [
                {
                  fieldPath: `${itmcPath}.permutations[0].item`,
                  group: entry.primaryClassName,
                  path: entry.path,
                  kind: 'internal',
                },
              ],
              embeddedRawDataAssets: [],
              embeddedRawDataPatches: [],
              injectionBlockers: [],
            },
          ],
          notExtracted: [],
          warnings: [],
        };

        const plan = planAddInjection({ buffer: curBuf, header: curHdr, tagIndex: curTagIndex }, synthContainer, {});
        if (plan.kind === 'ok' && plan.blockedOther.length === 0 && plan.blockedEmbedded.length === 0) {
          curBuf = applyAddInjection(curBuf, curHdr, curTagIndex, synthContainer, plan);
          curHdr = parseCacheFileHeader(curBuf);
          curTagIndex = parseTagIndex(curBuf, curHdr);
          const createdItmc = curTagIndex.entries.find(
            (e) => e.primaryClassName === 'item_collection' && e.path.toLowerCase() === itmcPath.toLowerCase(),
          );
          if (createdItmc) {
            itmcTagId = createdItmc.tagId;
          }
        }
      } catch {
        // Fallback if map cannot be injected into
      }
    }
  }

  const info = getScenarioReflexiveInfo(curBuf, curHdr, curTagIndex, 'equipment');
  const newItemBytes = Buffer.alloc(info.structSize, 0);
  newItemBytes.writeUInt32LE(1, 0); // flags: 1 = levitate
  newItemBytes.writeInt16LE(12, 4); // type 0 = 12 (all games)
  newItemBytes.writeUInt32LE(0xffffffff, 16);
  newItemBytes.writeFloatLE(position[0], 64);
  newItemBytes.writeFloatLE(position[1], 68);
  newItemBytes.writeFloatLE(position[2], 72);
  newItemBytes.writeFloatLE(rotation[0], 76);
  newItemBytes.write('itmc', 80, 4, 'ascii');
  newItemBytes.writeUInt32LE(itmcTagId, 92);

  const appended = appendReflexiveElement(curBuf, curHdr, curTagIndex, info.reflexiveFieldOffset, newItemBytes);
  const summary = extractScenarioPlacements(appended.buffer, appended.header, curTagIndex);
  const newId = `equipment-${info.count}`;
  const newPlacement = summary.objects.find((o) => o.id === newId)!;
  return { buffer: appended.buffer, header: appended.header, tagIndex: curTagIndex, summary, newPlacement };
}

/**
 * Deletes a scenario object placement by shifting subsequent elements down and decrementing count.
 */
export function deleteScenarioPlacement(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  placementId: string,
): ScenarioPlacementsSummary {
  const [kindStr, idxStr] = placementId.split('-');
  const kind = kindStr as ScenarioObjectKind;
  const index = parseInt(idxStr, 10);

  const info = getScenarioReflexiveInfo(buffer, header, tagIndex, kind);
  if (index < 0 || index >= info.count) {
    throw new Error(`Placement index ${index} out of range (count: ${info.count}) for kind ${kind}.`);
  }

  // Shift elements after index down by 1 structSize
  const targetOffset = info.baseOffset + index * info.structSize;
  const afterOffset = info.baseOffset + (index + 1) * info.structSize;
  const remainingCount = info.count - 1 - index;

  if (remainingCount > 0) {
    buffer.copy(buffer, targetOffset, afterOffset, afterOffset + remainingCount * info.structSize);
  }

  // Zero out the vacated last element
  const lastElementOffset = info.baseOffset + (info.count - 1) * info.structSize;
  buffer.fill(0, lastElementOffset, lastElementOffset + info.structSize);

  // Update count in reflexive field
  encodeReflexive(buffer, info.reflexiveFieldOffset, {
    count: info.count - 1,
    pointerLow: info.pointerLow,
    pointerHigh: 0,
  });

  return extractScenarioPlacements(buffer, header, tagIndex);
}

/**
 * Swaps an existing scenario placement with another object (same kind or different kind).
 * Preserves the object's position and rotation, updating or recreating the placement in memory.
 */
export function swapScenarioPlacement(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  placementId: string,
  newKind: ScenarioObjectKind,
  newPaletteIndex: number,
): {
  buffer: Buffer;
  header: CacheFileHeader;
  tagIndex?: TagIndex;
  summary: ScenarioPlacementsSummary;
  newPlacement: ScenarioObjectPlacement;
} {
  const summaryBefore = extractScenarioPlacements(buffer, header, tagIndex);
  const target = summaryBefore.objects.find((o) => o.id === placementId);
  if (!target) {
    throw new Error(`Scenario placement "${placementId}" not found.`);
  }

  const oldKind = target.kind;
  const position: [number, number, number] = [...target.position];
  const rotation: [number, number, number] = [...target.rotation];
  const teamIndex = target.teamIndex;

  // If swapping within the same kind (and not a spawn):
  if (oldKind === newKind && newKind !== 'spawn') {
    let curBuf = buffer;
    let curHdr = header;

    if (newKind === 'vehicle') {
      const chosen = summaryBefore.palettes.vehicles[newPaletteIndex] || summaryBefore.palettes.vehicles[0];
      if (!chosen) throw new Error('No vehicle available in map palettes.');
      const palRes = ensurePaletteEntry(curBuf, curHdr, tagIndex, 'vehicle palette', 'ScenarioVehiclePalette', chosen.tagId, 0x76656869);
      curBuf = palRes.buffer;
      curHdr = palRes.header;
      const [_, idxStr] = placementId.split('-');
      const index = parseInt(idxStr, 10);
      const info = getScenarioReflexiveInfo(curBuf, curHdr, tagIndex, 'vehicle');
      const itemOffset = info.baseOffset + index * info.structSize;
      curBuf.writeInt16LE(palRes.paletteIndex, itemOffset + 0);
      curBuf.writeUInt16LE(0, itemOffset + 4);
      curBuf.writeFloatLE(1.0, itemOffset + 72);
      curBuf.writeUInt16LE(0x0f0f, itemOffset + 90);

      const summary = extractScenarioPlacements(curBuf, curHdr, tagIndex);
      const newPlacement = summary.objects.find((o) => o.id === placementId)!;
      return { buffer: curBuf, header: curHdr, summary, newPlacement };
    } else if (newKind === 'scenery') {
      const chosen = summaryBefore.palettes.scenery[newPaletteIndex] || summaryBefore.palettes.scenery[0];
      if (!chosen) throw new Error('No scenery available in map palettes.');
      const palRes = ensurePaletteEntry(curBuf, curHdr, tagIndex, 'scenery palette', 'ScenarioSceneryPalette', chosen.tagId, 0x7363656e);
      curBuf = palRes.buffer;
      curHdr = palRes.header;
      const [_, idxStr] = placementId.split('-');
      const index = parseInt(idxStr, 10);
      const info = getScenarioReflexiveInfo(curBuf, curHdr, tagIndex, 'scenery');
      const itemOffset = info.baseOffset + index * info.structSize;
      curBuf.writeInt16LE(palRes.paletteIndex, itemOffset + 0);

      const summary = extractScenarioPlacements(curBuf, curHdr, tagIndex);
      const newPlacement = summary.objects.find((o) => o.id === placementId)!;
      return { buffer: curBuf, header: curHdr, summary, newPlacement };
    } else if (newKind === 'biped') {
      const chosen = summaryBefore.palettes.bipeds[newPaletteIndex] || summaryBefore.palettes.bipeds[0];
      if (!chosen) throw new Error('No biped available in map palettes.');
      const palRes = ensurePaletteEntry(curBuf, curHdr, tagIndex, 'biped palette', 'ScenarioBipedPalette', chosen.tagId, 0x62697064);
      curBuf = palRes.buffer;
      curHdr = palRes.header;
      const [_, idxStr] = placementId.split('-');
      const index = parseInt(idxStr, 10);
      const info = getScenarioReflexiveInfo(curBuf, curHdr, tagIndex, 'biped');
      const itemOffset = info.baseOffset + index * info.structSize;
      curBuf.writeInt16LE(palRes.paletteIndex, itemOffset + 0);

      const summary = extractScenarioPlacements(curBuf, curHdr, tagIndex);
      const newPlacement = summary.objects.find((o) => o.id === placementId)!;
      return { buffer: curBuf, header: curHdr, summary, newPlacement };
    }
  }

  // Cross-category swap or spawn/equipment swap:
  // 1. Delete original placement
  deleteScenarioPlacement(buffer, header, tagIndex, placementId);

  // 2. Add replacement placement with preserved position & rotation
  return addScenarioPlacement(
    buffer,
    header,
    tagIndex,
    newKind,
    newPaletteIndex,
    position,
    rotation,
    teamIndex,
  );
}
