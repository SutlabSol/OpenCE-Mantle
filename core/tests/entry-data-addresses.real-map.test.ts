import { describe, expect, it, beforeAll } from 'vitest';
import { parseCacheFileHeader } from '../src/map/header';
import type { CacheFileHeader } from '../src/map/header';
import { parseTagIndex } from '../src/map/tag-index';
import type { TagIndex } from '../src/map/tag-index';
import { extractTagSet, AllTagsExcludedError } from '../src/map/tag-extractor';
import { serializeContainer, deserializeContainer } from '../src/map/container';
import type { OceContainer } from '../src/map/container';
import { planInjection, applyInjectionWithReport } from '../src/map/tag-injector';
import type { InjectionPlan } from '../src/map/tag-injector';
import { readSampleMap, skippableTest } from './helpers/sample-maps';
import { auditExistingTags, entryAddressIssues, bspReferencePaths, ENGINE_BASE } from './helpers/existing-tags-audit';

/**
 * Regression for the ADD blue screen confirmed in OpenCE (PRD 2026-10-11 "ADD tag-array growth"):
 * an external sound's tag-array data field is the ADDRESS of its base struct in tag data (only its
 * pitch ranges are in sounds.map), but the rebase skipped every external entry, so after the array
 * grew those 333 pointers (bloodgulch) pointed 64 bytes early. Earlier same-reader tests and the
 * first independent audit both assumed "external = resource index" and passed.
 *
 * `entryAddressIssues` decides address-vs-index BY VALUE (the injector decides by group), reads
 * the output raw with the fixed base 0x40440000 and follows the stored array pointer; it shares
 * the schema engine (field layouts) with the injector. On the code before the sound fix (commit
 * 1fb6f11) these cases fail; on the fix they pass.
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
const target = (m: LoadedMap) => ({ buffer: m.buf, header: m.header, tagIndex: m.ti });

function containerOf(src: LoadedMap, roots: number[]): OceContainer {
  return deserializeContainer(serializeContainer(extractTagSet(src.buf, src.header, src.ti, roots), 'source'));
}

/** First internal root in `src` (optionally of `group`) whose ADD into `tgt` adds between `min` and `max` tags. Generic: no tag path named. */
function pickRoot(src: LoadedMap, tgt: LoadedMap, min: number, max: number, group?: string): number {
  const inTarget = new Set(tgt.ti.entries.map((e) => key(e.primaryClassName, e.path)));
  for (const e of src.ti.entries) {
    if (e.isExternal || e.primaryClassName === 'scenario' || e.primaryClassName === 'scenario_structure_bsp') continue;
    if (group && e.primaryClassName !== group) continue;
    if (inTarget.has(key(e.primaryClassName, e.path))) continue;
    let p;
    try {
      p = planInjection('add', target(tgt), containerOf(src, [e.index]));
    } catch {
      continue;
    }
    if (p.kind === 'ok' && p.toAdd.length >= min && p.toAdd.length <= max && p.refusedRoots.length === 0) return e.index;
  }
  throw new Error(`no root in the source adds ${min}-${max} tags`);
}

const externalSoundCount = (m: LoadedMap) => m.ti.entries.filter((e) => e.isExternal && e.primaryClassName === 'sound').length;

/** ADD, then the independent checks: entry addresses (any flag), existing tags, BSP reference paths, array pointer. */
function addAndCheck(src: LoadedMap, tgt: LoadedMap, roots: number[]): { p: InjectionPlan; out: Buffer } {
  const c = containerOf(src, roots);
  const p = planInjection('add', target(tgt), c);
  if (p.kind !== 'ok') throw new Error(`plan refused: ${p.reason}`);
  const out = applyInjectionWithReport(tgt.buf, tgt.header, tgt.ti, c, p).buffer;
  expect(out.readUInt32LE(out.readUInt32LE(0x10))).toBe(ENGINE_BASE + 0x28);
  const r = entryAddressIssues(tgt.buf, tgt.ti, out);
  expect(r.issues).toEqual([]);
  expect(r.ownershipIssues).toEqual([]); // no data field left pointing into another tag's data
  expect(r.checkedExternal).toBe(externalSoundCount(tgt)); // every external sound was checked as an address
  expect(auditExistingTags(tgt.buf, tgt.ti, out).problems).toEqual([]);
  // BSP reference paths: same strings after the shift (own BSP walk on both maps).
  const before = bspReferencePaths(tgt.buf, tgt.ti);
  const after = bspReferencePaths(out, parseTagIndex(out, parseCacheFileHeader(out)));
  expect(after.length).toBe(before.length);
  const str = (b: Buffer, ptr: number) => {
    const at = b.readUInt32LE(0x10) + (ptr - ENGINE_BASE);
    return b.toString('latin1', at, b.indexOf(0, at));
  };
  expect(after.map((x) => str(out, x.value))).toEqual(before.map((x) => str(tgt.buf, x.value)));
  return { p, out };
}

describe('ADD: every tag-array data field that is an address (external sounds included) still points at its own, unchanged struct (independent: fixed base, decided by value; shares the schema engine)', () => {
  const gate = skippableTest(['bloodgulch.map', 'sidewinder.map', 'coldsnap.map', 'ui.map']);
  const maps: Record<string, LoadedMap> = {};
  beforeAll(() => {
    if (gate.skip) return;
    for (const n of ['bloodgulch.map', 'sidewinder.map', 'coldsnap.map', 'ui.map']) maps[n] = load(n);
  });

  for (const name of ['bloodgulch.map', 'sidewinder.map', 'coldsnap.map', 'ui.map']) {
    it.skipIf(gate.skip)(`one-tag ADD into ${name}${gate.titleSuffix}`, () => {
      const tgt = maps[name];
      const src = name === 'ui.map' ? maps['bloodgulch.map'] : maps['ui.map'];
      const { p } = addAndCheck(src, tgt, [pickRoot(src, tgt, 1, 1)]);
      expect(p.toAdd.length).toBe(1);
    }, 300_000);
  }

  it.skipIf(gate.skip)(`halo_logo ADD into bloodgulch (the bg_add1 case): 333 external sound entries checked${gate.titleSuffix}`, () => {
    const ui = maps['ui.map'];
    const root = ui.ti.entries.findIndex((e) => e.primaryClassName === 'ui_widget_definition' && e.path === 'ui\\shell\\main_menu\\halo_logo');
    const { p, out } = addAndCheck(ui, maps['bloodgulch.map'], [root]);
    expect(p.toAdd.length).toBe(2);
    expect(entryAddressIssues(maps['bloodgulch.map'].buf, maps['bloodgulch.map'].ti, out).checkedExternal).toBe(333);
  }, 300_000);

  for (const name of ['bloodgulch.map', 'sidewinder.map']) {
    it.skipIf(gate.skip)(`several-tag ADD (a ui_widget_definition adding 5-40 tags) into ${name}${gate.titleSuffix}`, () => {
      const { p } = addAndCheck(maps['ui.map'], maps[name], [pickRoot(maps['ui.map'], maps[name], 5, 40, 'ui_widget_definition')]);
      expect(p.toAdd.length).toBeGreaterThanOrEqual(5);
    }, 300_000);
  }
});

describe('external tags in ADD / SWAP', () => {
  const gate = skippableTest(['bloodgulch.map', 'ui.map']);
  let bg: LoadedMap;
  let ui: LoadedMap;
  beforeAll(() => {
    if (gate.skip) return;
    bg = load('bloodgulch.map');
    ui = load('ui.map');
  });

  it.skipIf(gate.skip)(`a container never holds an external tag: selecting one alone says why (sound, bitmap, unicode_string_list)${gate.titleSuffix}`, () => {
    for (const group of ['sound', 'bitmap', 'unicode_string_list']) {
      const i = bg.ti.entries.findIndex((e) => e.isExternal && e.primaryClassName === group);
      expect(() => extractTagSet(bg.buf, bg.header, bg.ti, [i])).toThrow(AllTagsExcludedError);
      expect(() => extractTagSet(bg.buf, bg.header, bg.ti, [i])).toThrow(/is an external tag - its data is in a resource map/);
    }
  }, 300_000);

  it.skipIf(gate.skip)(`a reference to an external tag is stored as path + group only, and ADD reuses the target's own entry (flag 1, data field unchanged in kind: address for sounds, index for bitmaps)${gate.titleSuffix}`, () => {
    const weapon = bg.ti.entries.findIndex((e) => !e.isExternal && e.primaryClassName === 'weapon');
    const c = containerOf(bg, [weapon]);
    const external = c.tags.flatMap((t) => t.dependencies).filter((d) => d.kind === 'external');
    expect(external.length).toBeGreaterThan(0);
    for (const d of external) expect(Object.keys(d).sort()).toEqual(['fieldPath', 'group', 'kind', 'path']);
    expect(c.tags.some((t) => bg.ti.entries[t.originalIndex].isExternal)).toBe(false);

    // ADD ui tags that use sounds bloodgulch has as EXTERNAL entries: those are reused, never written.
    const extSoundKeys = new Set(bg.ti.entries.filter((e) => e.isExternal && e.primaryClassName === 'sound').map((e) => key('sound', e.path)));
    const root = ui.ti.entries.findIndex((e) => e.primaryClassName === 'ui_widget_definition' && e.path === 'ui\\shell\\main_menu\\halo_logo');
    const uc = containerOf(ui, [root, ...ui.ti.entries.filter((e) => e.primaryClassName === 'ui_widget_collection').map((e) => e.index)]);
    const p = planInjection('add', target(bg), uc);
    if (p.kind !== 'ok') throw new Error(p.reason);
    const reusedSounds = [...p.reusedByLocalIndex].filter(([li]) => extSoundKeys.has(key(uc.tags[li].group, uc.tags[li].path)));
    expect(reusedSounds.length).toBeGreaterThan(0);
    expect(p.toAdd.some((t) => t.group === 'sound' && extSoundKeys.has(key('sound', t.path)))).toBe(false);
    const out = applyInjectionWithReport(bg.buf, bg.header, bg.ti, uc, p).buffer;
    const outArray = out.readUInt32LE(0x10) + 0x28;
    for (const [, tagId] of reusedSounds) {
      const entry = outArray + (tagId & 0xffff) * 32;
      expect(out.readUInt32LE(entry + 0x18)).toBe(1); // still external
      const data = out.readUInt32LE(entry + 0x14);
      expect(data >= ENGINE_BASE && data < ENGINE_BASE + out.readUInt32LE(0x14)).toBe(true); // still an address
    }
    for (const e of bg.ti.entries.filter((x) => x.isExternal && x.primaryClassName === 'bitmap')) {
      expect(out.readUInt32LE(outArray + e.index * 32 + 0x14)).toBe(e.tagDataPointerOrResourceIndex); // resource index kept
    }
    expect(entryAddressIssues(bg.buf, bg.ti, out).issues).toEqual([]);
  }, 300_000);

  it.skipIf(gate.skip)(`SWAP of a tag whose target entry is external leaves that entry untouched and says why${gate.titleSuffix}`, () => {
    const uiSound = ui.ti.entries.find((e) => !e.isExternal && e.primaryClassName === 'sound' && bg.ti.entries.some((b) => b.isExternal && b.primaryClassName === 'sound' && b.path === e.path))!;
    expect(uiSound).toBeDefined();
    const c = containerOf(ui, [uiSound.index]);
    const p = planInjection('swap', target(bg), c);
    if (p.kind !== 'ok') throw new Error(p.reason);
    const li = c.tags.findIndex((t) => t.path === uiSound.path && t.group === 'sound');
    expect(p.toSwap.some((s) => s.localIndex === li)).toBe(false);
    expect([...p.blockedOther, ...p.blockedEmbedded].find((b) => b.localIndex === li)?.reasons.join(' ')).toMatch(/external \(resource map\) entry; swapping into those isn't supported/);
  }, 300_000);
});
