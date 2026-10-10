import { describe, expect, it } from 'vitest';
import { extractTagSet } from '../src/map/tag-extractor';
import { serializeContainer, deserializeContainer } from '../src/map/container';
import type { OceContainer } from '../src/map/container';
import { planInjection, applyInjection } from '../src/map/tag-injector';
import type { InjectionMode, InjectionPlan } from '../src/map/tag-injector';
import { readSampleMap, skippableTest } from './helpers/sample-maps';
import { auditMap, tagBlocks, blocksOutsideTagData, treeDiff, findTag, entryPathPointer } from './helpers/tag-data-audit';
import type { AuditMap, Block } from './helpers/tag-data-audit';

const ALIGNMENT = 4; // every tag, reflexive and data pointer in all 5 CE sample maps (asserted per source map below)

/**
 * Regression for the swap load failure (PRD 2026-10-11): ADD/SWAP left every relocated
 * TagDataOffset pointer (model_animations frame data, string_list strings, meter stencils, ...)
 * as the tag-local offset the extractor stored, so 862 pointers in a SWAP of globals into
 * bloodgulch pointed outside the tag data. Every written tag is audited against its source with
 * `helpers/tag-data-audit.ts` (schema engine + header/tag-index parser only, none of the
 * extractor's or injector's walking code). Alignment is measured from the start of tag data (virtual
 * address - base), like the source map's own pointers. Nothing is written to disk.
 */

interface Written { srcIndex: number; outIndex: number; path: string }

function container(m: AuditMap, roots: number[], name: string): OceContainer {
  return deserializeContainer(serializeContainer(extractTagSet(m.buf, m.header, m.ti, roots), name));
}

function inject(mode: InjectionMode, src: AuditMap, c: OceContainer, tgt: AuditMap): { plan: InjectionPlan; out: AuditMap; written: Written[]; appendStart: number } {
  const plan = planInjection(mode, tgt.ti, c);
  if (plan.kind !== 'ok') throw new Error(`plan refused: ${plan.reason}`);
  const out = auditMap(applyInjection(tgt.buf, tgt.header, tgt.ti, c, plan));
  const written: Written[] = mode === 'swap'
    ? plan.toSwap.map((s) => ({ srcIndex: c.tags[s.localIndex].originalIndex, outIndex: s.targetOriginalIndex, path: c.tags[s.localIndex].path }))
    : plan.toAdd.map((t) => ({ srcIndex: t.originalIndex, outIndex: findTag(out, t.group, t.path), path: t.path }));
  void src;
  // No embedded relocation here: everything past the (grown) tag array's old end is appended data.
  return { plan, out, written, appendStart: tgt.buf.length + plan.toAdd.length * 32 };
}

function misaligned(blocks: Block[]): string[] {
  return blocks.filter((b) => b.tagDataRelative % ALIGNMENT !== 0).map((b) => `${b.where} (${b.kind}) at tag data +0x${b.tagDataRelative.toString(16)}`);
}

/** Every source-map block is aligned - the property the output must keep. */
function sourceMisaligned(m: AuditMap): string[] {
  return m.ti.entries.filter((e) => !e.isExternal && e.primaryClassName !== 'scenario_structure_bsp').flatMap((e) => misaligned(tagBlocks(m, e.index)));
}

function audit(src: AuditMap, out: AuditMap, written: Written[], appendStart: number) {
  const blocks: Block[] = [];
  const diffs: string[] = [];
  for (const w of written) {
    expect(w.outIndex, `${w.path} missing from output`).toBeGreaterThanOrEqual(0);
    blocks.push(...tagBlocks(out, w.outIndex));
    diffs.push(...treeDiff(src, w.srcIndex, out, w.outIndex));
  }
  // Padding: every appended byte not inside a block (or a new tag's path string) must be zero.
  const covered = new Uint8Array(out.buf.length - appendStart);
  const cover = (file: number, length: number) => {
    for (let i = Math.max(file, appendStart); i < Math.min(file + length, out.buf.length); i++) covered[i - appendStart] = 1;
  };
  for (const b of blocks) cover(b.file, b.length);
  for (const w of written) {
    const pathAt = out.header.tagDataOffset + (entryPathPointer(out, out.ti.entries[w.outIndex].tagId) - out.ti.baseMemoryAddress);
    cover(pathAt, out.ti.entries[w.outIndex].path.length + 1);
  }
  let paddingBytes = 0;
  const nonZeroPadding: string[] = [];
  covered.forEach((c, i) => {
    if (c) return;
    paddingBytes++;
    if (out.buf[appendStart + i] !== 0 && nonZeroPadding.length < 10) nonZeroPadding.push(`file 0x${(appendStart + i).toString(16)} = 0x${out.buf[appendStart + i].toString(16)}`);
  });
  return {
    blocks, diffs, paddingBytes, nonZeroPadding,
    outside: blocksOutsideTagData(out, blocks).map((b) => `${b.where} (${b.kind}) -> file 0x${b.file.toString(16)}`),
    misaligned: misaligned(blocks),
  };
}

/** The same container saved as format v1 (every field added since v1 removed), read back through deserializeContainer. */
function asV1(c: OceContainer): OceContainer {
  const raw = JSON.parse(JSON.stringify(c));
  raw.formatVersion = 1;
  for (const k of ['resourceMapIdentities', 'externalResourceRefs', 'externalData']) delete raw[k];
  for (const t of raw.tags) for (const k of ['secondaryClassFourCC', 'tertiaryClassFourCC', 'embeddedRawDataAssets', 'embeddedRawDataPatches', 'injectionBlockers']) delete t[k];
  return deserializeContainer(Buffer.from(JSON.stringify(raw), 'utf-8'));
}

function wholeMapRoots(m: AuditMap): number[] {
  return m.ti.entries.filter((e) => !e.isExternal && e.primaryClassName !== 'scenario' && e.primaryClassName !== 'scenario_structure_bsp').map((e) => e.index);
}

describe('injected tag data matches its source (real maps, independent audit)', () => {
  const gate = skippableTest(['bloodgulch.map']);
  for (const version of [4, 1]) {
    it.skipIf(gate.skip)(`SWAP globals with dependencies into a copy of bloodgulch.map (the map that failed to load in OpenCE), container v${version}: 0 pointers outside tag data, all pointers aligned like the source, padding zero, tree diff clean${gate.titleSuffix}`, () => {
      const m = auditMap(readSampleMap('bloodgulch.map'));
      expect(sourceMisaligned(m)).toEqual([]);
      const root = m.ti.entries.findIndex((e) => !e.isExternal && e.primaryClassName === 'globals');
      const c = container(m, [root], 'bloodgulch.map');
      const { plan, out, written, appendStart } = inject('swap', m, version === 1 ? asV1(c) : c, m);
      expect(plan.toSwap.length).toBe(1037); // the same run as the failing map
      const r = audit(m, out, written, appendStart);
      expect(r.outside).toEqual([]);
      expect(r.misaligned).toEqual([]);
      expect(r.nonZeroPadding).toEqual([]);
      expect(r.diffs).toEqual([]);
      expect(r.blocks.filter((b) => b.kind === 'data').length).toBeGreaterThan(800); // the converted data pointers are exercised
      expect(r.paddingBytes).toBeGreaterThan(0); // odd-length blocks (2-byte animation arrays, odd strings) were padded
    }, 300_000);
  }

  for (const name of ['bloodgulch.map', 'ui.map', 'sidewinder.map', 'coldsnap.map']) {
    const g = skippableTest([name]);
    it.skipIf(g.skip)(`SWAP ${name} into a copy of itself: 0 pointers outside tag data, aligned, padding zero, tree diff clean${g.titleSuffix}`, () => {
      const m = auditMap(readSampleMap(name));
      expect(sourceMisaligned(m)).toEqual([]);
      const { out, written, appendStart } = inject('swap', m, container(m, wholeMapRoots(m), name), m);
      const r = audit(m, out, written, appendStart);
      expect(written.length).toBeGreaterThan(0);
      expect(r.outside).toEqual([]);
      expect(r.misaligned).toEqual([]);
      expect(r.nonZeroPadding).toEqual([]);
      expect(r.diffs).toEqual([]);
    }, 300_000);
  }

  const addGate = skippableTest(['ui.map', 'bloodgulch.map']);
  it.skipIf(addGate.skip)(`ADD ui.map into a copy of bloodgulch.map: 0 pointers outside tag data, aligned, padding zero, tree diff clean${addGate.titleSuffix}`, () => {
    const ui = auditMap(readSampleMap('ui.map'));
    const bg = auditMap(readSampleMap('bloodgulch.map'));
    expect(sourceMisaligned(ui)).toEqual([]);
    expect(sourceMisaligned(bg)).toEqual([]);
    const { out, written, appendStart } = inject('add', ui, container(ui, wholeMapRoots(ui), 'ui.map'), bg);
    const r = audit(ui, out, written, appendStart);
    expect(written.length).toBeGreaterThan(0);
    expect(r.outside).toEqual([]);
    expect(r.misaligned).toEqual([]);
    expect(r.nonZeroPadding).toEqual([]);
    expect(r.diffs).toEqual([]);
    expect(r.blocks.filter((b) => b.kind === 'data').length).toBeGreaterThan(0);
  }, 300_000);
});
