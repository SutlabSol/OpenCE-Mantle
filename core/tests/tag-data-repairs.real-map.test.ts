import { describe, expect, it } from 'vitest';
import { checkTagDataExtents } from '../src/map/convert/extent-check';
import { applyTagDataRepairs, planTagDataRepairs, DATA_ARRAY_COUNT, DATA_ARRAY_ELEMENT_SIZE, DATA_ARRAY_HEADER_SIZE, DATA_ARRAY_MAXIMUM_COUNT, SCRIPT_NODE_SIZE, TagDataRepairError } from '../src/map/convert/tag-data-repairs';
import { resolveStruct } from '../src/map/definitions/engine';
import { parseCacheFileHeader } from '../src/map/header';
import { parseTagIndex } from '../src/map/tag-index';
import { readSampleMap, sampleIn, skippableTest } from './helpers/sample-maps';
import { BASE } from './helpers/raw-map';

/**
 * Planning and applying the tag data repairs (`tag-data-repairs.ts`) on copies of real maps, each
 * changed with raw offsets to hit one rule. The conversions with the repairs (exact output bytes,
 * CRC, sizes) are tested in `convert-external.real-map.test.ts`.
 */

const CE_MAPS = ['bloodgulch.map', 'sidewinder.map', 'coldsnap.map', 'ui.map', 'Yoyorast_Island.map'];
const HEH = sampleIn('haloMD', 'heh_2.map');
const ISLAND = sampleIn('haloMD', 'theisland_3.map');
const CROSSING = sampleIn('haloMD', 'crossing.map');

function plan(map: Buffer) {
  const view = Buffer.from(map);
  view.writeUInt32LE(609, 0x4);
  const header = parseCacheFileHeader(view);
  const tagIndex = parseTagIndex(view, header);
  const extents = checkTagDataExtents(view, header, tagIndex);
  return { view, header, tagIndex, extents, plan: planTagDataRepairs(view, header, tagIndex, extents) };
}

function scenarioAt(map: Buffer): number {
  const td = map.readUInt32LE(0x10);
  const entry = td + 0x28 + (map.readUInt32LE(td + 4) & 0xffff) * 0x20;
  return td + (map.readUInt32LE(entry + 0x14) - BASE);
}
const syntaxAt = (map: Buffer) => map.readUInt32LE(0x10) + (map.readUInt32LE(scenarioAt(map) + 0x474 + 0xc) - BASE);

describe('script node array layout', () => {
  it("the OpenCE data_array offsets used by the repair agree with this build's ScenarioScriptNodeTable schema", () => {
    const field = (name: string) => resolveStruct('ScenarioScriptNodeTable').fields.find((f) => f.name === name)!.offset;
    expect(resolveStruct('ScenarioScriptNodeTable').totalSize).toBe(DATA_ARRAY_HEADER_SIZE);
    expect(field('maximum count')).toBe(DATA_ARRAY_MAXIMUM_COUNT);
    expect(field('element size')).toBe(DATA_ARRAY_ELEMENT_SIZE);
    // Invader calls OpenCE's `count` (slots in use, the high-water mark) "size".
    expect(field('size')).toBe(DATA_ARRAY_COUNT);
    expect(resolveStruct('ScenarioScriptNode').totalSize).toBe(SCRIPT_NODE_SIZE);
  });
});

/**
 * OpenCE's free-slot rule, written here from its code (OpenCE 6399ed9, `source/memory/data.h`
 * struct datum_header { short identifier; }, and `source/memory/data.c`): a slot whose identifier
 * is 0 is free. `data_next_index` (l.468) and `data_iterator_next` (l.438) skip it while walking
 * slots below `count`; `datum_try_and_get` (l.135) returns NULL for it; `datum_new` (l.314) hands
 * it out; `data_delete_all` (l.393) frees a slot by writing 0 there.
 */
function openceUsedSlots(array: Buffer, at = 0): number[] {
  const count = array.readInt16LE(at + DATA_ARRAY_COUNT);
  const size = array.readInt16LE(at + DATA_ARRAY_ELEMENT_SIZE);
  const used: number[] = [];
  for (let i = 0; i < count; i++) if (array.readInt16LE(at + DATA_ARRAY_HEADER_SIZE + i * size) !== 0) used.push(i);
  return used;
}
function openceTryAndGet(array: Buffer, absoluteIndex: number, at = 0): boolean {
  const maximum = array.readInt16LE(at + DATA_ARRAY_MAXIMUM_COUNT);
  const size = array.readInt16LE(at + DATA_ARRAY_ELEMENT_SIZE);
  if (absoluteIndex < 0 || absoluteIndex >= maximum) return false;
  return array.readInt16LE(at + DATA_ARRAY_HEADER_SIZE + absoluteIndex * size) !== 0;
}

describe("OpenCE's free-slot rule (data.c): a zeroed slot is free", () => {
  it('synthetic array: zeroed slots are skipped by the walk and not returned by datum_try_and_get; a nonzero identifier is', () => {
    const maximum = 8;
    const array = Buffer.alloc(DATA_ARRAY_HEADER_SIZE + maximum * SCRIPT_NODE_SIZE);
    array.writeInt16LE(maximum, DATA_ARRAY_MAXIMUM_COUNT);
    array.writeInt16LE(SCRIPT_NODE_SIZE, DATA_ARRAY_ELEMENT_SIZE);
    array.writeInt16LE(5, DATA_ARRAY_COUNT);
    for (const i of [0, 2, 4]) array.writeInt16LE(-0x7ffe + i, DATA_ARRAY_HEADER_SIZE + i * SCRIPT_NODE_SIZE);
    // Slot 3: every byte but the identifier set; still free.
    array.fill(0xca, DATA_ARRAY_HEADER_SIZE + 3 * SCRIPT_NODE_SIZE + 2, DATA_ARRAY_HEADER_SIZE + 4 * SCRIPT_NODE_SIZE);
    expect(openceUsedSlots(array)).toEqual([0, 2, 4]);
    expect([...Array(maximum).keys()].map((i) => openceTryAndGet(array, i))).toEqual([true, false, true, false, true, false, false, false]);
  });

  const gate = skippableTest([ISLAND]);
  it.skipIf(gate.skip)(`theisland_3 repaired: OpenCE finds the same used slots in the new block as in the old one, and every slot past them is free${gate.titleSuffix}`, () => {
    const source = readSampleMap(ISLAND);
    const { plan: p } = plan(source);
    const { buffer: out, applied } = applyTagDataRepairs(source, p, p.repairs);
    const td = source.readUInt32LE(0x10);
    const oldAt = td + (applied[0].oldPointer - BASE);
    const newAt = td + (applied[0].newPointer - BASE);
    expect(openceUsedSlots(out, newAt)).toEqual(openceUsedSlots(source, oldAt));
    const count = out.readInt16LE(newAt + DATA_ARRAY_COUNT);
    const maximum = out.readInt16LE(newAt + DATA_ARRAY_MAXIMUM_COUNT);
    for (let i = count; i < maximum; i++) if (openceTryAndGet(out, i, newAt)) throw new Error(`slot ${i} reads as used`);
  }, 60_000);
});

describe('tag data repairs: planning', () => {
  for (const name of CE_MAPS) {
    const gate = skippableTest([name]);
    it.skipIf(gate.skip)(`${name}: nothing to repair, nothing unrepairable (its script data is 4-aligned)${gate.titleSuffix}`, () => {
      const p = plan(readSampleMap(name)).plan;
      expect(p).toMatchObject({ repairs: [], unrepairable: [] });
    }, 60_000);
  }

  const hehGate = skippableTest([HEH]);
  it.skipIf(hehGate.skip)(`heh_2: misaligned script data with no used nodes and no overlap is a required repair copying the header only${hehGate.titleSuffix}`, () => {
    const p = plan(readSampleMap(HEH)).plan;
    expect(p.unrepairable).toEqual([]);
    expect(p.repairs).toEqual([expect.objectContaining({ id: 'scriptSyntaxData', required: true, oldPointer: 0x4047a916, blockSize: 380_076, copyBytes: 56 })]);
    expect(p.repairs[0].details[0]).toMatch(/0x4047A916, which is not 4-aligned from the tag data start/);
  }, 60_000);

  it.skipIf(hehGate.skip)(`heh_2 with used script nodes: still required, copying the header and the used nodes${hehGate.titleSuffix}`, () => {
    const map = readSampleMap(HEH);
    map.writeInt16LE(5, syntaxAt(map) + DATA_ARRAY_COUNT);
    const p = plan(map).plan;
    expect(p.repairs).toEqual([expect.objectContaining({ id: 'scriptSyntaxData', required: true, oldPointer: 0x4047a916, blockSize: 380_076, copyBytes: 56 + 5 * 20 })]);
  }, 60_000);

  it.skipIf(hehGate.skip)(`heh_2 whose misaligned script header is not a script node array: unrepairable, nothing planned${hehGate.titleSuffix}`, () => {
    const map = readSampleMap(HEH);
    map.writeInt16LE(16, syntaxAt(map) + DATA_ARRAY_ELEMENT_SIZE);
    const p = plan(map).plan;
    expect(p.repairs).toEqual([]);
    expect(p.unrepairable).toEqual([expect.stringMatching(/not 4-aligned.*can't be read as a script node array \(19001 slots of 16 bytes/)]);
  }, 60_000);

  const islandGate = skippableTest([ISLAND]);
  it.skipIf(islandGate.skip)(`theisland_3: a required script data repair copying the header only (0 used nodes)${islandGate.titleSuffix}`, () => {
    const p = plan(readSampleMap(ISLAND)).plan;
    expect(p.unrepairable).toEqual([]);
    expect(p.repairs).toEqual([expect.objectContaining({ id: 'scriptSyntaxData', required: true, tagIndex: 0, oldPointer: 0x404864fe, blockSize: 380_076, copyBytes: 56 })]);
  }, 60_000);

  it.skipIf(islandGate.skip)(`theisland_3 whose used nodes reach past the real gap: unrepairable, nothing planned${islandGate.titleSuffix}`, () => {
    const map = readSampleMap(ISLAND);
    // (346,620 - 56) / 20 = 17,328 whole node slots are its own; one more does not fit.
    map.writeInt16LE(17_329, syntaxAt(map) + DATA_ARRAY_COUNT);
    const p = plan(map).plan;
    expect(p.repairs).toEqual([]);
    expect(p.unrepairable).toEqual([expect.stringMatching(/take 346,636 bytes, but only 346,620 bytes from its start belong to it alone/)]);
    map.writeInt16LE(17_328, syntaxAt(map) + DATA_ARRAY_COUNT);
    expect(plan(map).plan.repairs).toHaveLength(1);
  }, 60_000);

  const crossingGate = skippableTest([CROSSING]);
  it.skipIf(crossingGate.skip)(`crossing: the required script data repair (unaligned), then a required zeroed-struct repair for #2404 (72 bytes)${crossingGate.titleSuffix}`, () => {
    const p = plan(readSampleMap(CROSSING)).plan;
    expect(p.unrepairable).toEqual([]);
    expect(p.repairs).toEqual([expect.objectContaining({ id: 'scriptSyntaxData', required: true, blockSize: 380_076, copyBytes: 56 }), expect.objectContaining({ id: 'tagRootOutside', required: true, tagIndex: 2404, oldPointer: 0x409dc695, blockSize: 72, copyBytes: 0, pointerAddress: BASE + 0x28 + 2404 * 0x20 + 0x14 })]);
  }, 60_000);

  it.skipIf(crossingGate.skip)(`crossing with a reference that names #2404 exactly: unrepairable${crossingGate.titleSuffix}`, () => {
    const map = readSampleMap(CROSSING);
    const td = map.readUInt32LE(0x10);
    const id = map.readUInt32LE(td + 0x28 + 2404 * 0x20 + 0xc);
    // The BSP's sound environment palette[0] reference (measured: group 'snde' at file 0x8FD8, tag ID at +0xC) gets the entry's own ID.
    expect(map.toString('latin1', 0x8fd8, 0x8fdc)).toBe('edns');
    map.writeUInt32LE(id, 0x8fd8 + 0xc);
    const p = plan(map).plan;
    expect(p.repairs.map((r) => r.id)).toEqual(['scriptSyntaxData']);
    expect(p.unrepairable).toEqual([expect.stringMatching(/1 reference\(s\) name this tag/)]);
  }, 60_000);

  it.skipIf(crossingGate.skip)(`tag data not the last block of the file: every repair refused with the reason${crossingGate.titleSuffix}`, () => {
    const source = readSampleMap(CROSSING);
    const map = Buffer.concat([source, Buffer.alloc(4)]);
    map.writeUInt32LE(map.length, 0x8);
    const p = plan(map).plan;
    expect(p.repairs).toEqual([]);
    expect(p.unrepairable).toHaveLength(2);
    expect(p.unrepairable.every((u) => /is not the last block of the file/.test(u))).toBe(true);
  }, 60_000);

  it.skipIf(crossingGate.skip)(`new end past the lowest BSP address: every repair refused with the reason${crossingGate.titleSuffix}`, () => {
    const map = readSampleMap(CROSSING);
    // The scenario's structure bsps[0] "bsp address" (+0x8 in the 32-byte element) moved to just after the tag data
    // (the BSP's own pointers then fail too; only the layout reason is asserted).
    const s = scenarioAt(map);
    const list = map.readUInt32LE(0x10) + (map.readUInt32LE(s + 0x5a4 + 4) - BASE);
    const tds = map.readUInt32LE(0x14);
    map.writeUInt32LE(BASE + tds + 40, list + 8);
    const p = plan(map).plan;
    expect(p.repairs).toEqual([]);
    expect(p.unrepairable.some((u) => /past 0x[0-9A-F]+ \(the lowest structure BSP address/.test(u))).toBe(true);
  }, 60_000);
});

describe('tag data repairs: applying', () => {
  const gate = skippableTest([CROSSING]);
  it.skipIf(gate.skip)(`refuses when the pointer no longer holds the planned value, and never changes its input${gate.titleSuffix}`, () => {
    const source = readSampleMap(CROSSING);
    const { plan: p } = plan(source);
    const changed = Buffer.from(source);
    const at = changed.readUInt32LE(0x10) + 0x28 + 2404 * 0x20 + 0x14;
    changed.writeUInt32LE(0x40440000, at);
    const before = Buffer.from(changed);
    expect(() => applyTagDataRepairs(changed, p, p.repairs)).toThrow(TagDataRepairError);
    expect(changed.equals(before)).toBe(true);
  }, 60_000);

  it.skipIf(gate.skip)(`the struct repair applied alone: only header 0x8 / 0x14 and the entry pointer change, and 75 zero bytes are appended${gate.titleSuffix}`, () => {
    const source = readSampleMap(CROSSING);
    const { plan: p } = plan(source);
    const { buffer: out, applied } = applyTagDataRepairs(source, p, p.repairs.filter((r) => r.id === 'tagRootOutside'));
    expect(out.length).toBe(source.length + 75);
    expect(out.readUInt32LE(0x8)).toBe(out.length);
    expect(out.readUInt32LE(0x14)).toBe(source.readUInt32LE(0x14) + 75);
    const pointerAt = source.readUInt32LE(0x10) + 0x28 + 2404 * 0x20 + 0x14;
    const differing: number[] = [];
    for (let i = 0; i < source.length; i++) if (source[i] !== out[i]) differing.push(i);
    const expectedBytes = [0x8, 0x9, 0xa, 0xb, 0x14, 0x15, 0x16, 0x17, pointerAt, pointerAt + 1, pointerAt + 2, pointerAt + 3];
    expect(differing.every((i) => expectedBytes.includes(i))).toBe(true);
    expect(out.subarray(source.length).equals(Buffer.alloc(75))).toBe(true);
    expect(out.readUInt32LE(pointerAt)).toBe(0x409dc698);
    expect(applied).toEqual([{ id: 'tagRootOutside', tagIndex: 2404, tagPath: 'sound\\sound environments\\arena', oldPointer: 0x409dc695, newPointer: 0x409dc698, padding: 3, blockSize: 72, copied: 0, bytesAppended: 75 }]);
  }, 60_000);
});
