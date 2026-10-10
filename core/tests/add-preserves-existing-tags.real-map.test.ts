import { describe, expect, it, beforeAll } from 'vitest';
import { parseCacheFileHeader } from '../src/map/header';
import type { CacheFileHeader } from '../src/map/header';
import { parseTagIndex } from '../src/map/tag-index';
import type { TagIndex } from '../src/map/tag-index';
import { extractTagSet } from '../src/map/tag-extractor';
import { serializeContainer, deserializeContainer } from '../src/map/container';
import type { OceContainer } from '../src/map/container';
import { planInjection, applyInjectionWithReport } from '../src/map/tag-injector';
import type { InjectionMode, InjectionPlan, InjectionResult } from '../src/map/tag-injector';
import { rebaseTagDataPointersInPlace, tagDataLayoutOf } from '../src/map/pointer-rebase';
import { resolveStruct, decodeStruct, resolvePointer, getGroupStructName } from '../src/map/definitions/engine';
import { readSampleMap, skippableTest } from './helpers/sample-maps';
import { auditExistingTags, pointerCensus, ENGINE_BASE } from './helpers/existing-tags-audit';

/**
 * Regression for ADD with tag-array growth (PRD 2026-10-11 "ADD tag-array growth"): bg_add1.map
 * (ADD of ui\shell\main_menu\halo_logo into bloodgulch) blue-screened in OpenCE because the
 * injector lowered the tag array pointer instead of moving the pointers after the array. The old
 * tests re-parsed with a reader that inferred the base from that same pointer, so they passed.
 *
 * `auditExistingTags` is independent of the injector and of pointer-rebase.ts: it reads the output
 * raw with the engine's fixed base and follows the stored array pointer. It shares the schema
 * engine (field layouts) with them. On the code before the fix it reported 2455/2455 bad tags in
 * all three ADD cases below (run during the Task 1 investigation); SWAP reported 0.
 */

interface LoadedMap {
  buf: Buffer;
  header: CacheFileHeader;
  ti: TagIndex;
}

function load(name: string): LoadedMap {
  const buf = readSampleMap(name);
  const header = parseCacheFileHeader(buf);
  return { buf, header, ti: parseTagIndex(buf, header) };
}

const key = (group: string | null, path: string) => `${group}|${path.toLowerCase()}`;

function containerOf(src: LoadedMap, roots: number[]): OceContainer {
  return deserializeContainer(serializeContainer(extractTagSet(src.buf, src.header, src.ti, roots), 'ui.map'));
}

function plan(mode: InjectionMode, tgt: LoadedMap, c: OceContainer): InjectionPlan {
  const p = planInjection(mode, { buffer: tgt.buf, header: tgt.header, tagIndex: tgt.ti }, c);
  if (p.kind !== 'ok') throw new Error(`plan refused: ${p.reason}`);
  return p;
}

function addAndAudit(src: LoadedMap, tgt: LoadedMap, roots: number[]): { p: InjectionPlan; result: InjectionResult } {
  const c = containerOf(src, roots);
  const p = plan('add', tgt, c);
  const before = Buffer.from(tgt.buf);
  const result = applyInjectionWithReport(tgt.buf, tgt.header, tgt.ti, c, p);
  expect(tgt.buf.equals(before)).toBe(true); // target never mutated
  const out = result.buffer;
  // The array pointer the engine reads is never moved.
  expect(out.readUInt32LE(out.readUInt32LE(0x10))).toBe(ENGINE_BASE + 0x28);
  const r = auditExistingTags(tgt.buf, tgt.ti, out);
  expect(r.tagArrayAddress).toBe(0x40440028);
  expect(r.problems).toEqual([]);
  expect(r.badTags).toBe(0);
  // Internal non-BSP tags plus external entries whose data field is a tag-data address (sounds).
  const isAddress = (v: number) => v >>> 0 >= ENGINE_BASE && v >>> 0 < ENGINE_BASE + tgt.header.tagDataSize;
  expect(r.compared).toBe(tgt.ti.entries.filter((e) => e.primaryClassName !== 'scenario_structure_bsp' && (!e.isExternal || isAddress(e.tagDataPointerOrResourceIndex))).length);
  // New entries: read raw with the fixed base - path string and root struct inside the tag data.
  const outTagData = out.readUInt32LE(0x10);
  const outTagDataEnd = outTagData + out.readUInt32LE(0x14);
  p.toAdd.forEach((t, i) => {
    const entry = outTagData + 0x28 + (tgt.ti.entries.length + i) * 32;
    const pathAt = outTagData + (out.readUInt32LE(entry + 0x10) - ENGINE_BASE);
    expect(out.toString('latin1', pathAt, pathAt + t.path.length + 1)).toBe(`${t.path}\0`);
    const dataAt = outTagData + (out.readUInt32LE(entry + 0x14) - ENGINE_BASE);
    expect(dataAt).toBeGreaterThanOrEqual(outTagData + tgt.header.tagDataSize + p.toAdd.length * 32);
    expect(dataAt + resolveStruct(getGroupStructName(t.group)!).totalSize).toBeLessThanOrEqual(outTagDataEnd);
  });
  return { p, result };
}

/** First root (in ui.map order) matching `pred` whose ADD into `tgt` adds between `min` and `max` tags. Generic: no tag path named. */
function pickRoot(src: LoadedMap, tgt: LoadedMap, group: string, min: number, max: number): number {
  const inTarget = new Set(tgt.ti.entries.map((e) => key(e.primaryClassName, e.path)));
  for (const e of src.ti.entries) {
    if (e.isExternal || e.primaryClassName !== group || inTarget.has(key(e.primaryClassName, e.path))) continue;
    const p = planInjection('add', { buffer: tgt.buf, header: tgt.header, tagIndex: tgt.ti }, containerOf(src, [e.index]));
    if (p.kind === 'ok' && p.toAdd.length >= min && p.toAdd.length <= max && p.refusedRoots.length === 0) return e.index;
  }
  throw new Error(`no ${group} in the source adds ${min}-${max} tags`);
}

const wholeMapRoots = (m: LoadedMap) => m.ti.entries.filter((e) => !e.isExternal && e.primaryClassName !== 'scenario' && e.primaryClassName !== 'scenario_structure_bsp').map((e) => e.index);

describe('ADD keeps every existing tag intact (independent: fixed engine base, raw output; shares the schema engine)', () => {
  const gate = skippableTest(['ui.map', 'bloodgulch.map', 'coldsnap.map']);
  let ui: LoadedMap;
  let bg: LoadedMap;
  let cs: LoadedMap;
  beforeAll(() => {
    if (gate.skip) return;
    ui = load('ui.map');
    bg = load('bloodgulch.map');
    cs = load('coldsnap.map');
  });

  it.skipIf(gate.skip)(`ADD ui\\shell\\main_menu\\halo_logo into bloodgulch (the user's bg_add1 case): 2 added, +1346 bytes, 0 bad tags, 17,429 pointers moved = the independent census${gate.titleSuffix}`, () => {
    const root = ui.ti.entries.findIndex((e) => e.primaryClassName === 'ui_widget_definition' && e.path === 'ui\\shell\\main_menu\\halo_logo');
    expect(root).toBeGreaterThanOrEqual(0);
    const { p, result } = addAndAudit(ui, bg, [root]);
    expect(p.toAdd.length).toBe(2);
    expect(result.buffer.length - bg.buf.length).toBe(1346); // same growth as bg_add1.map
    const census = pointerCensus(bg.buf, bg.ti);
    expect(census.total).toBe(17429); // bloodgulch: 2455 path + (1569 + 333 external sounds) data + 5019 reflexive + 1088 data block + (6954 + 11 in external sounds) reference path
    expect(result.rebase).not.toBeNull();
    expect(result.rebase!.visited).toEqual({ tagPath: census.tagPath, tagData: census.tagData, reflexive: census.reflexive, dataBlock: census.dataBlock, referencePath: census.referencePath });
    expect(result.rebase!.rebased).toEqual(result.rebase!.visited); // every pointer lies past the array
    expect(result.rebase!.totalRebased).toBe(17429);
  }, 300_000);

  for (const target of ['bloodgulch.map', 'coldsnap.map']) {
    it.skipIf(gate.skip)(`one-tag ADD (first unicode_string_list from ui.map the target lacks) into ${target}: 0 bad tags${gate.titleSuffix}`, () => {
      const tgt = target === 'bloodgulch.map' ? bg : cs;
      const { p, result } = addAndAudit(ui, tgt, [pickRoot(ui, tgt, 'unicode_string_list', 1, 1)]);
      expect(p.toAdd.length).toBe(1);
      expect(result.rebase!.totalRebased).toBe(pointerCensus(tgt.buf, tgt.ti).total);
    }, 300_000);

    it.skipIf(gate.skip)(`multi-tag ADD (first ui_widget_definition adding 5-40 tags) into ${target}: 0 bad tags${gate.titleSuffix}`, () => {
      const tgt = target === 'bloodgulch.map' ? bg : cs;
      const { p } = addAndAudit(ui, tgt, [pickRoot(ui, tgt, 'ui_widget_definition', 5, 40)]);
      expect(p.toAdd.length).toBeGreaterThanOrEqual(5);
    }, 300_000);
  }

  it.skipIf(gate.skip)(`whole-ui ADD (every non-scenario ui.map tag) into bloodgulch: 704 added, 0 bad tags${gate.titleSuffix}`, () => {
    const { p } = addAndAudit(ui, bg, wholeMapRoots(ui));
    expect(p.toAdd.length).toBe(704);
  }, 300_000);

  it.skipIf(gate.skip)(`control: SWAP globals with dependencies into bloodgulch (no growth): array pointer unchanged, 0 bad tags apart from the swapped ones' data${gate.titleSuffix}`, () => {
    const root = bg.ti.entries.findIndex((e) => !e.isExternal && e.primaryClassName === 'globals');
    const c = deserializeContainer(serializeContainer(extractTagSet(bg.buf, bg.header, bg.ti, [root]), 'bloodgulch.map'));
    const p = plan('swap', bg, c);
    expect(p.toAdd.length).toBe(0);
    const result = applyInjectionWithReport(bg.buf, bg.header, bg.ti, c, p);
    expect(result.rebase).toBeNull();
    const r = auditExistingTags(bg.buf, bg.ti, result.buffer, new Set(p.toSwap.map((s) => s.targetOriginalIndex)));
    expect(r.tagArrayAddress).toBe(0x40440028);
    expect(r.problems).toEqual([]);
  }, 300_000);
});

describe('ADD refusals', () => {
  const gate = skippableTest(['ui.map', 'bloodgulch.map']);
  let ui: LoadedMap;
  let bg: LoadedMap;
  let haloLogo: number;
  beforeAll(() => {
    if (gate.skip) return;
    ui = load('ui.map');
    bg = load('bloodgulch.map');
    haloLogo = ui.ti.entries.findIndex((e) => e.primaryClassName === 'ui_widget_definition' && e.path === 'ui\\shell\\main_menu\\halo_logo');
  });

  it.skipIf(gate.skip)(`a target tag that can't be walked (a reflexive pointing outside the tag data) refuses ADD, naming the tag${gate.titleSuffix}`, () => {
    const buf = Buffer.from(bg.buf);
    const globals = bg.ti.entries.find((e) => !e.isExternal && e.primaryClassName === 'globals')!;
    const structName = getGroupStructName('globals')!;
    const at = resolvePointer(globals.tagDataPointerOrResourceIndex, bg.header.tagDataOffset, bg.ti.baseMemoryAddress);
    const d = decodeStruct(buf, at, structName);
    const field = resolveStruct(structName).fields.find((f) => f.def.type === 'TagReflexive' && !f.def.nonCached && (d.get(f.name) as { value: { count: number } }).value.count > 0)!;
    buf.writeUInt32LE(0x7ff00000, at + field.offset + 4);
    const p = planInjection('add', { buffer: buf, header: bg.header, tagIndex: bg.ti }, containerOf(ui, [haloLogo]));
    expect(p.kind).toBe('refused');
    if (p.kind !== 'refused') return;
    expect(p.reason).toContain('"globals\\globals" (globals)');
    expect(p.reason).toContain(`${field.name}`);
  }, 300_000);

  it.skipIf(gate.skip)(`tag space: the plan accepts exactly up to 23 MiB (tag data after ADD, padding included, + largest BSP) and refuses 1 byte more${gate.titleSuffix}`, () => {
    const c = containerOf(ui, [haloLogo]);
    const out = applyInjectionWithReport(bg.buf, bg.header, bg.ti, c, plan('add', bg, c)).buffer;
    const newTagDataSize = out.readUInt32LE(0x14);
    // Set the target's one BSP size so the total lands exactly on the limit, then one byte over.
    const scenario = bg.ti.entries[bg.ti.scenarioTagId & 0xffff];
    const scenarioStruct = getGroupStructName('scenario')!;
    const scenarioAt = resolvePointer(scenario.tagDataPointerOrResourceIndex, bg.header.tagDataOffset, bg.ti.baseMemoryAddress);
    const bspsField = resolveStruct(scenarioStruct).fields.find((f) => f.name === 'structure bsps')!;
    const bsps = decodeStruct(bg.buf, scenarioAt, scenarioStruct).get('structure bsps') as { value: { count: number; pointerLow: number } };
    expect(bsps.value.count).toBe(1);
    const bspStruct = bspsField.def.type === 'TagReflexive' ? bspsField.def.struct : '';
    const sizeAt = resolvePointer(bsps.value.pointerLow, bg.header.tagDataOffset, bg.ti.baseMemoryAddress) + resolveStruct(bspStruct).fields.find((f) => f.name === 'bsp size')!.offset;
    const LIMIT = 23 * 1024 * 1024;
    for (const [extra, expected] of [[0, 'ok'], [1, 'refused']] as const) {
      const buf = Buffer.from(bg.buf);
      buf.writeUInt32LE(LIMIT - newTagDataSize + extra, sizeAt);
      const p = planInjection('add', { buffer: buf, header: bg.header, tagIndex: bg.ti }, c);
      expect(p.kind).toBe(expected);
      if (p.kind === 'refused') expect(p.reason).toMatch(/tag space.*23\.00 MiB/);
    }
  }, 300_000);
});

describe('pointer-rebase in place (the converter Phase 2 use)', () => {
  const gate = skippableTest(['bloodgulch.map']);
  it.skipIf(gate.skip)(`moving bloodgulch's whole tag data to base 0x4BF10000 and back touches 17,429 pointers each way and restores every byte${gate.titleSuffix}`, () => {
    const bg = load('bloodgulch.map');
    const buf = Buffer.from(bg.buf);
    const layout = tagDataLayoutOf(bg.header, bg.ti);
    const delta = 0x4bf10000 - 0x40440000;
    const there = rebaseTagDataPointersInPlace(buf, layout, { from: 0x40440000, to: 0x40440000 + bg.header.tagDataSize, delta });
    expect(there.totalRebased).toBe(17429);
    expect(buf.equals(bg.buf)).toBe(false);
    const back = rebaseTagDataPointersInPlace(buf, { ...layout, baseMemoryAddress: 0x4bf10000 }, { from: 0x4bf10000, to: 0x4bf10000 + bg.header.tagDataSize, delta: -delta });
    expect(back.totalRebased).toBe(17429);
    expect(buf.equals(bg.buf)).toBe(true);
  }, 300_000);
});
