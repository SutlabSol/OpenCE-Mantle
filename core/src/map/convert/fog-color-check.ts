import type { CacheFileHeader } from '../header';
import type { TagIndex } from '../tag-index';
import { resolveTagDataPointer } from '../tag-index';
import { decodeStruct, getGroupStructName, isRangeInBuffer, resolveStruct } from '../definitions/engine';

/**
 * Fog densities and colours outside 0..1 in sky and fog tags (information only; nothing is changed).
 * OpenCE (build 185, commit 6399ed9) takes a sky's fog "maximum density" as the atmospheric fog density
 * (source/scenario/scenario.c l.1525-1542) and a fog tag's as the planar one (source/structures/
 * structures.c l.1075), and draws the environment fog with them unclamped through
 * `real_alpha_intensity_to_pixel32` (source/rasterizer/xbox/rasterizer_xbox_environment_fog.c
 * l.664-669), which asserts both are 0..1 and converts a colour that must be 0..1 too
 * (source/bitmaps/bitmaps_inlines.h asserts 89 and 188). A release build (HALO_RELEASE) logs each failed
 * assertion to debug.txt and carries on; any other build stops at the first one (`display_assert`, then
 * `system_exit`; source/cseries/cseries.h). Measured: MacDemo Zombiemod outdoor fog maximum density 5.0
 * (its release-build log has thousands of these asserts), TrueInfectionV2 1.5; the CE maps and every
 * stock and HaloMD map checked: none.
 */

const GROUPS = ['sky', 'fog'];

export interface FogColorValue {
  tagIndex: number;
  tagPath: string;
  group: string;
  /** Where in the tag, e.g. "outdoor fog maximum density" or "lights[0].color". */
  field: string;
  values: number[];
  text: string;
}

const outside = (v: number) => !(v >= 0 && v <= 1);

export function findFogAndColorValuesOutOfRange(buffer: Buffer, header: Pick<CacheFileHeader, 'tagDataOffset'>, tagIndex: TagIndex): FogColorValue[] {
  const found: FogColorValue[] = [];
  const base = tagIndex.baseMemoryAddress;
  for (const e of tagIndex.entries) {
    const group = e.primaryClassName;
    if (!group || !GROUPS.includes(group) || e.isExternal) continue;
    const structName = getGroupStructName(group);
    if (!structName) continue;
    const visited = new Set<number>();
    const walk = (name: string, pointer: number, where: string) => {
      const st = resolveStruct(name);
      const at = resolveTagDataPointer(pointer, header as CacheFileHeader, base);
      if (!isRangeInBuffer(at, st.totalSize, buffer.length) || visited.has(at)) return;
      visited.add(at);
      const decoded = decodeStruct(buffer, at, name);
      for (const field of st.fields) {
        if (field.def.nonCached) continue;
        const label = where ? `${where}.${field.name}` : field.name;
        const components = field.def.type === 'ColorARGB' ? 4 : field.def.type === 'ColorRGB' ? 3 : /maximum density$/.test(field.name) ? 1 : 0;
        if (components > 0) {
          const values = Array.from({ length: components }, (_, i) => buffer.readFloatLE(at + field.offset + i * 4));
          if (values.some(outside)) {
            const shown = values.map((v) => (Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : String(v))).join(', ');
            found.push({ tagIndex: e.index, tagPath: e.path, group, field: label, values, text: `#${e.index} ${e.path}.${group}: ${label} = ${shown}` });
          }
          continue;
        }
        const value = decoded.get(field.name);
        if (value?.kind === 'reflexive' && field.def.type === 'TagReflexive' && field.def.struct) {
          const size = resolveStruct(field.def.struct).totalSize;
          for (let i = 0; i < value.value.count; i++) walk(field.def.struct, (value.value.pointerLow + i * size) >>> 0, `${label}[${i}]`);
        }
      }
    };
    walk(structName, e.tagDataPointerOrResourceIndex >>> 0, '');
  }
  return found;
}
