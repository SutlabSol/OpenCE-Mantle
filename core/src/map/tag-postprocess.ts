import type { CacheFileHeader } from './header';
import { resolveTagDataPointer, type TagIndex } from './tag-index';
import { decodeStruct, getGroupDefinition, isRangeInBuffer, resolvePointer, resolveStruct } from './definitions/engine';

/**
 * Milestone 13.5 — Automatic `postprocess_proc` Recalculation (`tag-postprocess.ts`).
 *
 * When tag fields are edited in a compiled Halo CE `.map` file, Halo's engine relies on
 * precalculated `cacheOnly` fields that `tool.exe` normally computes during `build-cache-file`
 * (mirroring HEK / Invader's `compile_postprocess` / `postprocess_proc`).
 *
 * For example, in `WeaponTrigger`:
 * - `illumination recovery rate` = `illumination recovery time > 0 ? 1 / (30 * illumination recovery time) : 1`
 * - `ejection port recovery rate` = `ejection port recovery time > 0 ? 1 / (30 * ejection port recovery time) : 1`
 * - `firing acceleration rate` = `acceleration time > 0 ? 1 / (30 * acceleration time) : 1`
 * - `firing deceleration rate` = `deceleration time > 0 ? 1 / (30 * deceleration time) : 1`
 * - `error acceleration rate` = `error acceleration time > 0 ? 1 / (30 * error acceleration time) : 1`
 * - `error deceleration rate` = `error deceleration time > 0 ? 1 / (30 * error deceleration time) : 1`
 */

const TICK_RATE = 30.0;

function ratePerTickFromSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 1.0;
  return 1.0 / (TICK_RATE * seconds);
}

const WEAPON_TRIGGER_TIME_TO_RATE: Record<string, string> = {
  'illumination recovery time': 'illumination recovery rate',
  'ejection port recovery time': 'ejection port recovery rate',
  'acceleration time': 'firing acceleration rate',
  'deceleration time': 'firing deceleration rate',
  'error acceleration time': 'error acceleration rate',
  'error deceleration time': 'error deceleration rate',
};

const SCENARIO_PLACEMENT_TO_OBJECT_TYPE: Record<string, number> = {
  bipeds: 0,
  vehicles: 1,
  weapons: 2,
  equipment: 3,
  scenery: 6,
  machines: 7,
  controls: 8,
  'light fixtures': 9,
  'sound scenery': 11,
};

/**
 * Runs post-edit derived field recalculation (`postprocess_proc`) on a tag in `buffer`
 * after a field write. When `editedFieldPath` is provided, only updates the specific
 * derived `cacheOnly` field corresponding to the edited source field so unrelated bytes remain untouched.
 */
export function postprocessTagFields(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  tagEntryIndex: number,
  editedFieldPath?: string,
): string[] {
  const entry = tagIndex.entries[tagEntryIndex];
  if (!entry || entry.isExternal || !entry.primaryClassName) return [];

  const updated: string[] = [];
  const group = entry.primaryClassName;
  let structDef;
  try {
    structDef = getGroupDefinition(group);
  } catch {
    return [];
  }

  const rootOffset = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  if (!isRangeInBuffer(rootOffset, structDef.totalSize, buffer.length)) return [];

  if (group === 'scenario' && editedFieldPath) {
    const m = editedFieldPath.match(/^([a-z ]+)\[(\d+)\]\.name$/i);
    if (m) {
      const blockName = m[1].toLowerCase();
      const placementIdx = Number(m[2]);
      const objType = SCENARIO_PLACEMENT_TO_OBJECT_TYPE[blockName];
      if (objType !== undefined) {
        const decoded = decodeStruct(buffer, rootOffset, structDef.name);
        const placementBlock = decoded.get(blockName);
        const objNamesBlock = decoded.get('object names');
        if (
          placementBlock?.kind === 'reflexive' &&
          placementIdx >= 0 &&
          placementIdx < placementBlock.value.count &&
          objNamesBlock?.kind === 'reflexive' &&
          objNamesBlock.value.count > 0
        ) {
          const placementField = structDef.fields.find((f) => f.name === blockName);
          if (placementField?.def.struct) {
            const childStruct = resolveStruct(placementField.def.struct);
            const nameField = childStruct.fields.find((f) => f.name === 'name');
            const placementBase = resolvePointer(placementBlock.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
            const objNamesBase = resolvePointer(objNamesBlock.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
            if (nameField) {
              const nameIdx = buffer.readInt16LE(placementBase + placementIdx * childStruct.totalSize + nameField.offset);
              if (nameIdx >= 0 && nameIdx < objNamesBlock.value.count) {
                const objNameElemOff = objNamesBase + nameIdx * 36;
                if (isRangeInBuffer(objNameElemOff, 36, buffer.length)) {
                  buffer.writeInt16LE(objType, objNameElemOff + 32);
                  buffer.writeInt16LE(placementIdx, objNameElemOff + 34);
                  updated.push(`object names[${nameIdx}].object type`, `object names[${nameIdx}].object index`);
                }
              }
            }
          }
        }
      }
    }
  }

  if (group === 'weapon') {
    const decoded = decodeStruct(buffer, rootOffset, structDef.name);
    const triggers = decoded.get('triggers');
    if (triggers?.kind === 'reflexive' && triggers.value.count > 0) {
      const triggerStruct = resolveStruct('WeaponTrigger');
      const triggersBase = resolvePointer(triggers.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
      const getOff = (name: string) => triggerStruct.fields.find((f) => f.name === name)?.offset;

      if (editedFieldPath) {
        const m = editedFieldPath.match(/^triggers\[(\d+)\]\.(.+)$/);
        if (!m) return [];
        const trigIdx = Number(m[1]);
        const leafName = m[2];
        const rateName = WEAPON_TRIGGER_TIME_TO_RATE[leafName];
        if (!rateName || trigIdx < 0 || trigIdx >= triggers.value.count) return [];
        const timeOff = getOff(leafName);
        const rateOff = getOff(rateName);
        const elemBase = triggersBase + trigIdx * triggerStruct.totalSize;
        if (timeOff !== undefined && rateOff !== undefined && isRangeInBuffer(elemBase, triggerStruct.totalSize, buffer.length)) {
          const t = buffer.readFloatLE(elemBase + timeOff);
          buffer.writeFloatLE(Math.fround(ratePerTickFromSeconds(t)), elemBase + rateOff);
          updated.push(`triggers[${trigIdx}].${rateName}`);
        }
        return updated;
      }

      for (let i = 0; i < triggers.value.count; i++) {
        const elemBase = triggersBase + i * triggerStruct.totalSize;
        if (!isRangeInBuffer(elemBase, triggerStruct.totalSize, buffer.length)) break;
        for (const [timeField, rateField] of Object.entries(WEAPON_TRIGGER_TIME_TO_RATE)) {
          const timeOff = getOff(timeField);
          const rateOff = getOff(rateField);
          if (timeOff !== undefined && rateOff !== undefined) {
            const t = buffer.readFloatLE(elemBase + timeOff);
            buffer.writeFloatLE(Math.fround(ratePerTickFromSeconds(t)), elemBase + rateOff);
            updated.push(`triggers[${i}].${rateField}`);
          }
        }
      }
    }
  }

  return updated;
}
