import { describe, expect, it } from 'vitest';
import { extractTagSet } from '../src/map/tag-extractor';
import { serializeContainer, deserializeContainer } from '../src/map/container';
import type { OceContainer } from '../src/map/container';
import { planInjection, applyInjection } from '../src/map/tag-injector';
import type { InjectionMode, InjectionPlan } from '../src/map/tag-injector';
import { readSampleMap, skippableTest } from './helpers/sample-maps';
import { auditMap, tagBlocks, blocksOutsideTagData, treeDiff, findTag } from './helpers/tag-data-audit';
import type { AuditMap, Block } from './helpers/tag-data-audit';

/**
 * Regression for the swap load failure (PRD 2026-10-11): ADD/SWAP left every relocated
 * TagDataOffset pointer (model_animations frame data, string_list strings, meter stencils, ...)
 * as the tag-local offset the extractor stored, so 862 pointers in a SWAP of globals into
 * bloodgulch pointed outside the tag data. Every written tag is audited against its source with
 * `helpers/tag-data-audit.ts` (schema engine + header/tag-index parser only, none of the
 * extractor's or injector's walking code). Nothing is written to disk.
 */

interface Written { srcIndex: number; outIndex: number; path: string }

function container(m: AuditMap, roots: number[], name: string): OceContainer {
  return deserializeContainer(serializeContainer(extractTagSet(m.buf, m.header, m.ti, roots), name));
}

function inject(mode: InjectionMode, src: AuditMap, c: OceContainer, tgt: AuditMap): { plan: InjectionPlan; out: AuditMap; written: Written[] } {
  const plan = planInjection(mode, tgt.ti, c);
  if (plan.kind !== 'ok') throw new Error(`plan refused: ${plan.reason}`);
  const out = auditMap(applyInjection(tgt.buf, tgt.header, tgt.ti, c, plan));
  const written: Written[] = mode === 'swap'
    ? plan.toSwap.map((s) => ({ srcIndex: c.tags[s.localIndex].originalIndex, outIndex: s.targetOriginalIndex, path: c.tags[s.localIndex].path }))
    : plan.toAdd.map((t) => ({ srcIndex: t.originalIndex, outIndex: findTag(out, t.group, t.path), path: t.path }));
  void src;
  return { plan, out, written };
}

function audit(src: AuditMap, out: AuditMap, written: Written[]) {
  const blocks: Block[] = [];
  const diffs: string[] = [];
  for (const w of written) {
    expect(w.outIndex, `${w.path} missing from output`).toBeGreaterThanOrEqual(0);
    blocks.push(...tagBlocks(out, w.outIndex));
    diffs.push(...treeDiff(src, w.srcIndex, out, w.outIndex));
  }
  return { blocks, diffs, outside: blocksOutsideTagData(out, blocks).map((b) => `${b.where} (${b.kind}) -> file 0x${b.file.toString(16)}`) };
}

function wholeMapRoots(m: AuditMap): number[] {
  return m.ti.entries.filter((e) => !e.isExternal && e.primaryClassName !== 'scenario' && e.primaryClassName !== 'scenario_structure_bsp').map((e) => e.index);
}

describe('injected tag data matches its source (real maps, independent audit)', () => {
  const gate = skippableTest(['bloodgulch.map']);
  it.skipIf(gate.skip)(`SWAP globals with dependencies into a copy of bloodgulch.map (the map that failed to load in OpenCE): 0 pointers outside tag data, tree diff clean${gate.titleSuffix}`, () => {
    const m = auditMap(readSampleMap('bloodgulch.map'));
    const root = m.ti.entries.findIndex((e) => !e.isExternal && e.primaryClassName === 'globals');
    const { plan, out, written } = inject('swap', m, container(m, [root], 'bloodgulch.map'), m);
    expect(plan.toSwap.length).toBe(1037); // the same run as the failing map
    const r = audit(m, out, written);
    expect(r.outside).toEqual([]);
    expect(r.diffs).toEqual([]);
    expect(r.blocks.filter((b) => b.kind === 'data').length).toBeGreaterThan(800); // the converted data pointers are exercised
  }, 300_000);

  for (const name of ['bloodgulch.map', 'ui.map', 'sidewinder.map', 'coldsnap.map']) {
    const g = skippableTest([name]);
    it.skipIf(g.skip)(`SWAP ${name} into a copy of itself: 0 pointers outside tag data, tree diff clean${g.titleSuffix}`, () => {
      const m = auditMap(readSampleMap(name));
      const { out, written } = inject('swap', m, container(m, wholeMapRoots(m), name), m);
      const r = audit(m, out, written);
      expect(written.length).toBeGreaterThan(0);
      expect(r.outside).toEqual([]);
      expect(r.diffs).toEqual([]);
    }, 300_000);
  }

  const addGate = skippableTest(['ui.map', 'bloodgulch.map']);
  it.skipIf(addGate.skip)(`ADD ui.map into a copy of bloodgulch.map: 0 pointers outside tag data, tree diff clean${addGate.titleSuffix}`, () => {
    const ui = auditMap(readSampleMap('ui.map'));
    const bg = auditMap(readSampleMap('bloodgulch.map'));
    const { out, written } = inject('add', ui, container(ui, wholeMapRoots(ui), 'ui.map'), bg);
    const r = audit(ui, out, written);
    expect(written.length).toBeGreaterThan(0);
    expect(r.outside).toEqual([]);
    expect(r.diffs).toEqual([]);
    expect(r.blocks.filter((b) => b.kind === 'data').length).toBeGreaterThan(0);
  }, 300_000);
});
