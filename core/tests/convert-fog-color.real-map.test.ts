import { describe, expect, it } from 'vitest';
import { findFogAndColorValuesOutOfRange } from '../src/map/convert/fog-color-check';
import { convertDemoToCustomEdition, normalizeDemoMap, preflightDemoConversion } from '../src/map/convert/demo-to-ce';
import { preflightRetailConversion } from '../src/map/convert/retail-to-ce';
import { resolveStruct } from '../src/map/definitions/engine';
import { parseCacheFileHeader } from '../src/map/header';
import { parseTagIndex } from '../src/map/tag-index';
import { readSampleMap, sampleIn, skippableTest } from './helpers/sample-maps';
import { MACDEMO, MACDEMO_RES, withResources } from './helpers/demo-map';

/**
 * The fog and colour information row (`fog-color-check.ts`). Independent: the sky fog densities are read
 * from raw bytes at the Sky offsets (cross-checked with the schema once) for every sky tag. Information
 * only: the row never refuses and the converted map keeps the value.
 */

const SKY_OUTDOOR_DENSITY = 0x6c;
const SKY_INDOOR_DENSITY = 0x8c;

/** Every sky tag's two fog densities, from raw bytes (standard or demo header). */
function rawSkyDensities(b: Buffer): { tagIndex: number; outdoor: number; indoor: number }[] {
  const demo = b.readUInt32LE(0x2c0) === 0x45686564;
  const tdo = demo ? b.readUInt32LE(0x5ec) : b.readUInt32LE(0x10);
  const base = demo ? 0x4bf10000 : 0x40440000;
  const out = [];
  for (let i = 0; i < b.readUInt32LE(tdo + 0xc); i++) {
    const e = tdo + 0x28 + i * 0x20;
    if (b.readUInt32LE(e) !== 0x736b7920 || b.readUInt32LE(e + 0x18) === 1) continue; // 'sky '
    const root = tdo + (b.readUInt32LE(e + 0x14) - base);
    out.push({ tagIndex: i, outdoor: b.readFloatLE(root + SKY_OUTDOOR_DENSITY), indoor: b.readFloatLE(root + SKY_INDOOR_DENSITY) });
  }
  return out;
}

function readable(b: Buffer): Buffer {
  if (b.readUInt32LE(0x2c0) === 0x45686564) {
    const n = normalizeDemoMap(b);
    if (!n.ok) throw new Error('normalize failed');
    n.value.buffer.writeUInt32LE(609, 4);
    return n.value.buffer;
  }
  const v = Buffer.from(b);
  v.writeUInt32LE(609, 4);
  return v;
}

const run = (v: Buffer) => {
  const h = parseCacheFileHeader(v);
  return findFogAndColorValuesOutOfRange(v, h, parseTagIndex(v, h));
};

describe('fog and colour row: the Sky offsets used here equal the schema', () => {
  it('outdoor 0x6C, indoor 0x8C', () => {
    const f = resolveStruct('Sky').fields;
    expect(f.find((x) => x.name === 'outdoor fog maximum density')!.offset).toBe(SKY_OUTDOOR_DENSITY);
    expect(f.find((x) => x.name === 'indoor fog maximum density')!.offset).toBe(SKY_INDOOR_DENSITY);
  });
});

const EXPECTED: [string, string[]][] = [
  ['bloodgulch.map', []],
  ['sidewinder.map', []],
  ['coldsnap.map', []],
  ['ui.map', []],
  ['Yoyorast_Island.map', []],
  [sampleIn('haloMD', 'heh_2.map'), []],
  [sampleIn('haloMD', 'crossing.map'), []],
  [sampleIn('haloMD', 'barrier.map'), []],
  [MACDEMO.bloodgulch, []],
  [MACDEMO.zombiemod, ['#1 <Zanghfei>.sky: outdoor fog maximum density = 5']],
  [MACDEMO.trueInfection, ['#5270 <F*** You! I feel like being an asshole!.sky: outdoor fog maximum density = 1.5']],
];

describe('fog and colour row on the sample maps', () => {
  for (const [file, lines] of EXPECTED) {
    const gate = skippableTest([file]);
    it.skipIf(gate.skip)(`${file}: ${lines.length} value(s) outside 0..1; the raw sky densities agree${gate.titleSuffix}`, () => {
      const source = readSampleMap(file);
      expect(run(readable(source)).map((f) => f.text)).toEqual(lines);
      const rawOutside = rawSkyDensities(source).flatMap((s) => [s.outdoor, s.indoor].filter((v) => !(v >= 0 && v <= 1)).map(() => s.tagIndex));
      expect(rawOutside).toEqual(lines.map((l) => Number(l.slice(1, l.indexOf(' ')))));
    }, 300_000);
  }
});

describe('fog and colour row: information only', () => {
  const gate = skippableTest([MACDEMO.zombiemod, MACDEMO_RES.bitmaps, MACDEMO_RES.sounds]);
  it.skipIf(gate.skip)(`Zombiemod: an info row (not a refusal); the converted map keeps the density 5.0${gate.titleSuffix}`, () => {
    const source = readSampleMap(MACDEMO.zombiemod);
    const report = withResources(MACDEMO_RES, (r) => preflightDemoConversion(source, r));
    expect(report.canConvert).toBe(true);
    const row = report.checks.find((c) => c.id === 'fogAndColors')!;
    expect(row).toMatchObject({ status: 'info', requiresAcknowledgement: false, details: ['#1 <Zanghfei>.sky: outdoor fog maximum density = 5'] });
    expect(row.message).toMatch(/release build logs an assertion exception each time and carries on.*debug build stops/);
    const out = withResources(MACDEMO_RES, (r) => convertDemoToCustomEdition(source, { acknowledgeScripts: false, resources: r, repairs: { scriptSyntaxData: true } })).buffer;
    const [sky] = rawSkyDensities(out);
    expect(sky).toMatchObject({ tagIndex: 1, outdoor: 5 });
  }, 300_000);

  const ceGate = skippableTest(['coldsnap.map']);
  it.skipIf(ceGate.skip)(`a fog tag colour set to 2.0 (synthetic, coldsnap as version 7) is listed, and nothing refuses for it${ceGate.titleSuffix}`, () => {
    const b = Buffer.from(readSampleMap('coldsnap.map'));
    const tdo = b.readUInt32LE(0x10);
    let fogAt = -1;
    let fogIndex = -1;
    for (let i = 0; i < b.readUInt32LE(tdo + 0xc) && fogAt < 0; i++) {
      const e = tdo + 0x28 + i * 0x20;
      if (b.readUInt32LE(e) === 0x666f6720 && b.readUInt32LE(e + 0x18) === 0) {
        fogAt = tdo + (b.readUInt32LE(e + 0x14) - 0x40440000);
        fogIndex = i;
      }
    }
    expect(fogIndex).toBeGreaterThanOrEqual(0);
    const color = resolveStruct('Fog').fields.find((f) => f.def.type === 'ColorRGB')!;
    b.writeFloatLE(2, fogAt + color.offset);
    b.writeUInt32LE(7, 4);
    const row = preflightRetailConversion(b).checks.find((c) => c.id === 'fogAndColors')!;
    expect(row.status).toBe('info');
    expect(row.details).toHaveLength(1);
    expect(row.details[0]).toMatch(new RegExp(`^#${fogIndex} .*\\.fog: ${color.name} = 2, `));
  });
});
