import { describe, expect, it } from 'vitest';
import { checkModelParts } from '../src/map/convert/model-part-check';
import { parseCacheFileHeader } from '../src/map/header';
import { parseTagIndex } from '../src/map/tag-index';
import { readSampleMap, sampleIn, skippableTest } from './helpers/sample-maps';
import { BASE, tagDataOffsetOf } from './helpers/raw-map';

/**
 * The model part check that mirrors OpenCE's `gbxmodel_part_check` / `custom_edition_model_verify` /
 * `custom_edition_model_part_verify` (`model-part-check.ts`). Anchors: 0 problems on the 5 Custom
 * Edition maps and on HaloMD heh_2, crossing and barrier (all load in OpenCE); theisland_3's one
 * model, which OpenCE refused (user's log, 2026-10-11). Independent part: a raw walker below (fixed
 * offsets from OpenCE's `struct model` / `custom_edition_model_part`, no schema, no tag index) counts
 * the parts and the out-of-range strip indices and must agree with the check. The mutation tests
 * change one field with raw offsets and expect exactly that reason.
 */

const MODEL = { nodes: 0xb8, geometries: 0xd0, shaders: 0xdc } as const;
const GEOMETRY_SIZE = 0x30;
const GEOMETRY_PARTS = 0x24;
const PART_SIZE = 0x84;
const P = { prev: 0x06, next: 0x07, centroidPrimary: 0x08, stripType: 0x44, triangles: 0x48, stripOffset: 0x4c, vertexCount: 0x58, vertexOffset: 0x64 } as const;
const VERTEX_SIZE = 0x44;
const FOURCC_MOD2 = 0x6d6f6432; // "mod2"

interface RawPart {
  tagIndex: number;
  geometry: number;
  part: number;
  partAt: number;
  modelAt: number;
  vertexCount: number;
  vertexAt: number;
  stripAt: number;
  stripCount: number;
  badStrip: { position: number; value: number }[];
}

/** Every gbxmodel part, from raw bytes only. */
function rawParts(buf: Buffer): RawPart[] {
  const td = tagDataOffsetOf(buf);
  const fileOf = (pointer: number) => td + (pointer - BASE);
  const tagCount = buf.readUInt32LE(td + 0xc);
  const modelData = buf.readUInt32LE(td + 0x14);
  const indexOffset = buf.readUInt32LE(td + 0x1c);
  const out: RawPart[] = [];
  for (let i = 0; i < tagCount; i++) {
    const entry = td + 0x28 + i * 0x20;
    if (buf.readUInt32LE(entry) !== FOURCC_MOD2 || buf.readUInt32LE(entry + 0x18) !== 0) continue;
    const modelAt = fileOf(buf.readUInt32LE(entry + 0x14));
    const geometryCount = buf.readUInt32LE(modelAt + MODEL.geometries);
    const geometriesAt = geometryCount ? fileOf(buf.readUInt32LE(modelAt + MODEL.geometries + 4)) : 0;
    for (let g = 0; g < geometryCount; g++) {
      const geometryAt = geometriesAt + g * GEOMETRY_SIZE;
      const partCount = buf.readUInt32LE(geometryAt + GEOMETRY_PARTS);
      const partsAt = partCount ? fileOf(buf.readUInt32LE(geometryAt + GEOMETRY_PARTS + 4)) : 0;
      for (let p = 0; p < partCount; p++) {
        const partAt = partsAt + p * PART_SIZE;
        const vertexCount = buf.readInt32LE(partAt + P.vertexCount);
        const stripAt = modelData + indexOffset + buf.readUInt32LE(partAt + P.stripOffset);
        const stripCount = buf.readInt32LE(partAt + P.triangles) + 2;
        const badStrip: RawPart['badStrip'] = [];
        for (let k = 0; k < stripCount; k++) {
          const value = buf.readUInt16LE(stripAt + k * 2);
          if (value >= vertexCount) badStrip.push({ position: k, value });
        }
        out.push({ tagIndex: i, geometry: g, part: p, partAt, modelAt, vertexCount, vertexAt: modelData + buf.readUInt32LE(partAt + P.vertexOffset), stripAt, stripCount, badStrip });
      }
    }
  }
  return out;
}

/** Reads a CE or retail-layout (v7) map through the CE reader, on a copy with version 609. */
function check(map: Buffer) {
  const view = Buffer.from(map);
  view.writeUInt32LE(609, 0x4);
  const header = parseCacheFileHeader(view);
  return checkModelParts(view, header, parseTagIndex(view, header));
}

const LOADS_IN_OPENCE = [
  'bloodgulch.map',
  'sidewinder.map',
  'coldsnap.map',
  'ui.map',
  'Yoyorast_Island.map',
  sampleIn('haloMD', 'heh_2.map'),
  sampleIn('haloMD', 'crossing.map'),
  sampleIn('haloMD', 'barrier.map'),
];

describe('model part check: maps that load in OpenCE have no problems', () => {
  for (const name of LOADS_IN_OPENCE) {
    const gate = skippableTest([name]);
    it.skipIf(gate.skip)(`${name}: 0 problems; part count and strip findings equal the raw walk${gate.titleSuffix}`, () => {
      const map = readSampleMap(name);
      const r = check(map);
      const raw = rawParts(map);
      expect(r.problems.map((p) => p.text)).toEqual([]);
      expect(r.partsChecked).toBe(raw.length);
      expect(r.partsChecked).toBeGreaterThan(0);
      expect(raw.filter((p) => p.badStrip.length > 0)).toEqual([]);
    }, 60_000);
  }
});

describe('model part check: theisland_3 (refused by OpenCE at this model)', () => {
  const file = sampleIn('haloMD', 'theisland_3.map');
  const gate = skippableTest([file]);
  it.skipIf(gate.skip)(`#2574 forerunner dark structure: geometry 0 part 0 (2 of 104) and geometry 1 part 0 (33 of 66), nothing else${gate.titleSuffix}`, () => {
    const map = readSampleMap(file);
    const r = check(map);
    const raw = rawParts(map).filter((p) => p.badStrip.length > 0);
    expect(r.problems.map((p) => [p.tagIndex, p.geometryIndex, p.partIndex, p.reasons, p.badStripIndices.length, p.stripIndexCount, p.vertexCount])).toEqual([
      [2574, 0, 0, [], 2, 104, 70],
      [2574, 1, 0, [], 33, 66, 44],
    ]);
    expect(r.problems[0].tagPath).toBe('effects\\debris objects\\forerunner dark structure\\forerunner dark structure');
    expect(r.problems[0].badStripIndices).toEqual([{ position: 100, value: 70 }, { position: 102, value: 71 }]);
    // Independent: the raw walk finds the same parts and the same indices.
    expect(raw.map((p) => [p.tagIndex, p.geometry, p.part, p.badStrip])).toEqual(r.problems.map((p) => [p.tagIndex, p.geometryIndex, p.partIndex, p.badStripIndices]));
  }, 60_000);
});

describe('model part check: one field changed (raw offsets) gives exactly that reason', () => {
  const gate = skippableTest(['bloodgulch.map']);
  let base: Buffer;
  let first: RawPart;
  const fresh = () => {
    base ??= readSampleMap('bloodgulch.map');
    first ??= rawParts(base)[0];
    return Buffer.from(base);
  };
  const mine = (r: ReturnType<typeof check>) => r.problems.filter((p) => p.tagIndex === first.tagIndex && p.geometryIndex === first.geometry && p.partIndex === first.part);

  it.skipIf(gate.skip)(`a strip index equal to the vertex count${gate.titleSuffix}`, () => {
    const map = fresh();
    map.writeUInt16LE(first.vertexCount, first.stripAt);
    const p = mine(check(map));
    expect(p).toHaveLength(1);
    expect(p[0].badStripIndices).toEqual([{ position: 0, value: first.vertexCount }]);
    expect(p[0].reasons).toEqual([]);
  }, 60_000);

  it.skipIf(gate.skip)(`a strip index of 0xFFFF fails (OpenCE has no restart value here)${gate.titleSuffix}`, () => {
    const map = fresh();
    map.writeUInt16LE(0xffff, first.stripAt + 2);
    expect(mine(check(map))[0].badStripIndices).toEqual([{ position: 1, value: 0xffff }]);
  }, 60_000);

  it.skipIf(gate.skip)(`centroid primary node past the model's nodes${gate.titleSuffix}`, () => {
    const map = fresh();
    map.writeInt16LE(map.readUInt32LE(first.modelAt + MODEL.nodes), first.partAt + P.centroidPrimary);
    expect(mine(check(map))[0].reasons).toEqual([expect.stringContaining('centroid primary node')]);
  }, 60_000);

  it.skipIf(gate.skip)(`next part past the geometry's parts, previous part -2${gate.titleSuffix}`, () => {
    const map = fresh();
    map.writeInt8(127, first.partAt + P.next);
    map.writeInt8(-2, first.partAt + P.prev);
    expect(mine(check(map))[0].reasons).toEqual([expect.stringContaining('previous part -2'), expect.stringContaining('next part 127')]);
  }, 60_000);

  it.skipIf(gate.skip)(`a normal component of 1.01, and a NaN tangent${gate.titleSuffix}`, () => {
    const map = fresh();
    map.writeFloatLE(1.01, first.vertexAt + 0x0c);
    map.writeFloatLE(NaN, first.vertexAt + VERTEX_SIZE + 0x24);
    expect(mine(check(map))[0].reasons).toEqual(['2 vertices have a normal, binormal or tangent component past 1.005 (or NaN)']);
  }, 60_000);

  it.skipIf(gate.skip)(`a vertex naming a node past the model's${gate.titleSuffix}`, () => {
    const map = fresh();
    expect(map.readUInt32LE(first.modelAt) & 2).toBe(0); // this model's parts have no local nodes
    map.writeInt16LE(map.readUInt32LE(first.modelAt + MODEL.nodes), first.vertexAt + 0x38);
    expect(mine(check(map))[0].reasons).toEqual([expect.stringContaining('1 vertices name a node outside')]);
  }, 60_000);

  it.skipIf(gate.skip)(`a strip type other than 1 is a load (layout) problem${gate.titleSuffix}`, () => {
    const map = fresh();
    map.writeInt16LE(0, first.partAt + P.stripType);
    expect(mine(check(map))[0].reasons).toEqual(['strip type 0 (only 1, precompiled strip, loads)']);
  }, 60_000);

  it.skipIf(gate.skip)(`a vertex count past the vertex data is a load (layout) problem${gate.titleSuffix}`, () => {
    const map = fresh();
    map.writeInt32LE(0x10000, first.partAt + P.vertexCount);
    expect(mine(check(map))[0].reasons).toEqual([expect.stringContaining('65536 vertices')]);
  }, 60_000);

  it.skipIf(gate.skip)(`a model with 0 nodes is a model-level problem${gate.titleSuffix}`, () => {
    const map = fresh();
    map.writeUInt32LE(0, first.modelAt + MODEL.nodes);
    const r = check(map).problems.filter((p) => p.tagIndex === first.tagIndex);
    expect(r.map((p) => [p.geometryIndex, p.partIndex, p.reasons[0]])).toEqual([[null, null, expect.stringContaining('0 nodes')]]);
  }, 60_000);
});
