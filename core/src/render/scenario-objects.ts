/**
 * Scenario object placements extractor (Step 8.5): extracts placed objects (vehicles,
 * scenery, bipeds, weapons, equipment, player spawns) from the Scenario (`scnr`) tag
 * and resolves each object's palette reference to its underlying 3D model tag (`gbxmodel`).
 */
import type { CacheFileHeader } from '../map/header';
import type { TagIndex } from '../map/tag-index';
import { resolveTagDataPointer } from '../map/tag-index';
import { decodeStruct, resolveStruct, resolvePointer } from '../map/definitions/engine';

export type ScenarioObjectKind =
  | 'vehicle'
  | 'scenery'
  | 'biped'
  | 'weapon'
  | 'equipment'
  | 'spawn';

export interface ScenarioObjectPlacement {
  /** Unique identifier e.g. "vehicle-0", "scenery-12", "spawn-3". */
  id: string;
  kind: ScenarioObjectKind;
  paletteIndex: number;
  nameIndex: number;
  /** Tag ID of the object tag (vehi, scen, bipd, weap, etc.), or 0xFFFFFFFF if spawn. */
  objectTagId: number;
  /** Human-readable path of the object tag, or spawn description. */
  objectPath: string;
  /** Tag ID of the 3D model tag (`gbxmodel`/`mod2`), or 0xFFFFFFFF if none. */
  modelTagId: number;
  /** World position [x, y, z] in Halo coordinates (+X forward, +Y left, +Z up). */
  position: [number, number, number];
  /** World rotation [yaw, pitch, roll] in radians. */
  rotation: [number, number, number];
  /** Multiplayer team index (e.g. 0 = Red, 1 = Blue for player spawns). */
  teamIndex?: number;
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
      const nameDep = decoded.get('name');
      const tagId = nameDep && nameDep.kind === 'dependency' ? nameDep.value.tagId : 0xffffffff;
      const entry = tagId !== 0xffffffff ? tagIndex.entries[tagId & 0xffff] : undefined;
      const path = entry ? entry.path : '';
      const modelTagId = resolveObjectModelTagId(buffer, header, tagIndex, tagId);
      palette.push({ tagId, path, modelTagId });
    } catch {
      palette.push({ tagId: 0xffffffff, path: '', modelTagId: 0xffffffff });
    }
  }
  return palette;
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

  // 5. Netgame Equipment (Multiplayer weapon / powerup spawn sites)
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

      placements.push({
        id: `equipment-${i}`,
        kind: 'equipment',
        paletteIndex: i,
        nameIndex: -1,
        objectTagId: itmcTagId,
        objectPath: itmcEntry ? itmcEntry.path : 'Netgame Equipment',
        modelTagId: 0xffffffff,
        position: pos,
        rotation: [facing, 0, 0],
      });
      counts.equipment++;
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

  return {
    scenarioTagId: tagIndex.scenarioTagId,
    scenarioPath: scenarioEntry.path,
    totalObjects: placements.length,
    objects: placements,
    counts,
  };
}
