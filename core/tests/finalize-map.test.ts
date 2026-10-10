import { describe, expect, it } from 'vitest';
import * as zlib from 'node:zlib';
import { computeCacheCrc32, ceCrcRegions } from '../src/map/cache-crc';
import { finalizeForSave, scenarioNameFromFileName, MAX_SCENARIO_NAME_LENGTH } from '../src/map/finalize-map';
import { parseCacheFileHeader } from '../src/map/header';
import { parseTagIndex, resolveTagDataPointer } from '../src/map/tag-index';
import { decodeStruct, resolvePointer } from '../src/map/definitions/engine';
import { extractTagSet } from '../src/map/tag-extractor';
import { serializeContainer, deserializeContainer } from '../src/map/container';
import { planInjection, applyInjection } from '../src/map/tag-injector';
import { readSampleMap, skippableTest } from './helpers/sample-maps';

/**
 * Header crc32 + scenario name on save. Independent checks: the stored crc32 that Tool wrote into
 * every CE sample map, and node:zlib's CRC-32 (test-only; core has its own table implementation).
 * The CRC regions for the zlib reference are read here straight from the bytes (scenario
 * "structure bsps" at fixed ScenarioBSP offsets 0x0/0x4), not via `ceCrcRegions`.
 */

const CE_MAPS = ['bloodgulch.map', 'ui.map', 'sidewinder.map', 'coldsnap.map', 'Yoyorast_Island.map'];

/** Halo's stored value = bit-inverted standard CRC-32 of the regions concatenated. */
function zlibReferenceCrc(buf: Buffer): number {
  const h = parseCacheFileHeader(buf);
  const ti = parseTagIndex(buf, h);
  const scenario = ti.entries[ti.scenarioTagId & 0xffff];
  const at = resolveTagDataPointer(scenario.tagDataPointerOrResourceIndex, h, ti.baseMemoryAddress);
  const bsps = decodeStruct(buf, at, 'Scenario').get('structure bsps');
  if (bsps?.kind !== 'reflexive') throw new Error('no structure bsps');
  const base = resolvePointer(bsps.value.pointerLow, h.tagDataOffset, ti.baseMemoryAddress);
  let crc = 0;
  for (let i = 0; i < bsps.value.count; i++) {
    const start = buf.readUInt32LE(base + i * 32);
    const size = buf.readUInt32LE(base + i * 32 + 4);
    crc = zlib.crc32(buf.subarray(start, start + size), crc);
  }
  crc = zlib.crc32(buf.subarray(ti.modelDataFileOffset, ti.modelDataFileOffset + ti.modelDataSize), crc);
  crc = zlib.crc32(buf.subarray(h.tagDataOffset, h.tagDataOffset + h.tagDataSize), crc);
  return ~crc >>> 0;
}

function differingOffsets(a: Buffer, b: Buffer): number[] {
  expect(b.length).toBe(a.length);
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

const inHeaderNameOrCrc = (i: number) => (i >= 0x20 && i <= 0x3f) || (i >= 0x64 && i <= 0x67);

describe('computeCacheCrc32', () => {
  it('matches node:zlib (bit-inverted CRC-32) over arbitrary regions', () => {
    const buf = Buffer.alloc(10_000);
    for (let i = 0; i < buf.length; i++) buf[i] = (i * 2654435761) >>> 24;
    const regions = [{ offset: 7, size: 1234, label: 'a' }, { offset: 5000, size: 0, label: 'empty' }, { offset: 3000, size: 4999, label: 'b' }];
    const ref = ~zlib.crc32(buf.subarray(3000, 7999), zlib.crc32(buf.subarray(7, 1241))) >>> 0;
    expect(computeCacheCrc32(buf, regions)).toBe(ref);
  });

  it('refuses a region outside the file', () => {
    expect(() => computeCacheCrc32(Buffer.alloc(16), [{ offset: 8, size: 9, label: 'model data' }])).toThrow(/model data/);
  });

  for (const name of CE_MAPS) {
    const gate = skippableTest([name]);
    it.skipIf(gate.skip)(`reproduces the crc32 stored in ${name}${gate.titleSuffix}`, () => {
      const buf = readSampleMap(name);
      const h = parseCacheFileHeader(buf);
      const crc = computeCacheCrc32(buf, ceCrcRegions(buf, h, parseTagIndex(buf, h)));
      expect(crc).toBe(h.crc32 >>> 0);
      expect(crc).toBe(zlibReferenceCrc(buf));
      if (name === 'bloodgulch.map') expect(crc).toBe(0x7b309554);
    });
  }
});

describe('scenarioNameFromFileName', () => {
  it('drops the folder and the extension', () => {
    expect(scenarioNameFromFileName('C:\\maps\\my map.map')).toEqual({ name: 'my map', warnings: [] });
    expect(scenarioNameFromFileName('/x/y/bloodgulch_v2.MAP').name).toBe('bloodgulch_v2');
  });

  it(`keeps ${MAX_SCENARIO_NAME_LENGTH} characters; shortens 32 with a warning`, () => {
    expect(scenarioNameFromFileName(`${'a'.repeat(31)}.map`)).toEqual({ name: 'a'.repeat(31), warnings: [] });
    const r = scenarioNameFromFileName(`${'b'.repeat(32)}.map`);
    expect(r.name).toBe('b'.repeat(31));
    expect(r.warnings.join(' ')).toContain('longer than 31 characters');
  });

  it('replaces characters the header cannot store, with a warning', () => {
    const r = scenarioNameFromFileName('café ☕.map');
    expect(r.name).toBe('caf_ _');
    expect(r.warnings.join(' ')).toContain('"é"');
  });

  it('refuses a name that would be empty', () => {
    expect(() => scenarioNameFromFileName('.map')).toThrow(/empty map name/);
  });
});

describe('finalizeForSave (real maps)', () => {
  for (const name of CE_MAPS) {
    const gate = skippableTest([name]);
    it.skipIf(gate.skip)(`unmodified ${name} saved under its own scenario name is byte-identical; under another name only 0x20-0x3F and 0x64-0x67 may differ${gate.titleSuffix}`, () => {
      const src = readSampleMap(name);
      const own = parseCacheFileHeader(src).scenarioName;
      const same = finalizeForSave(src, { fileName: `D:\\out\\${own}.map` });
      expect(differingOffsets(src, same.buffer)).toEqual([]);
      expect(same.warnings).toEqual([]);

      const renamed = finalizeForSave(src, { fileName: 'D:\\out\\renamed copy.map' });
      expect(differingOffsets(src, renamed.buffer).filter((i) => !inHeaderNameOrCrc(i))).toEqual([]);
      expect(renamed.buffer.subarray(0x20, 0x40)).toEqual(Buffer.concat([Buffer.from('renamed copy', 'ascii'), Buffer.alloc(32 - 12)]));
      expect(parseCacheFileHeader(renamed.buffer).scenarioName).toBe('renamed copy');
      expect(renamed.crc32).toBe(parseCacheFileHeader(src).crc32 >>> 0); // name is not in the CRC regions
      expect(src.readUInt32LE(0x20)).toBe(Buffer.from(own.padEnd(4, '\0'), 'ascii').readUInt32LE(0)); // source buffer untouched
    });
  }

  const gate = skippableTest(['bloodgulch.map']);
  it.skipIf(gate.skip)(`SWAP globals into a copy of bloodgulch.map, then finalize: crc32 equals the zlib reference and only the name/crc header bytes change${gate.titleSuffix}`, () => {
    const src = readSampleMap('bloodgulch.map');
    const h = parseCacheFileHeader(src);
    const ti = parseTagIndex(src, h);
    const root = ti.entries.findIndex((e) => !e.isExternal && e.primaryClassName === 'globals');
    const container = deserializeContainer(serializeContainer(extractTagSet(src, h, ti, [root]), 'bloodgulch.map'));
    const plan = planInjection('swap', ti, container);
    if (plan.kind !== 'ok') throw new Error(plan.reason);
    const injected = applyInjection(src, h, ti, container, plan);
    const before = parseCacheFileHeader(injected).crc32 >>> 0;
    const f = finalizeForSave(injected, { fileName: 'bloodgulch_swapped.map' });
    expect(f.crc32).toBe(zlibReferenceCrc(f.buffer));
    expect(f.crc32).not.toBe(before); // the injector leaves the source's (now stale) value
    expect(f.buffer.readUInt32LE(0x64)).toBe(f.crc32);
    expect(differingOffsets(injected, f.buffer).filter((i) => !inHeaderNameOrCrc(i))).toEqual([]);
    expect(f.scenarioName).toBe('bloodgulch_swapped');
  }, 300_000);
});
