import { describe, expect, it, beforeAll } from 'vitest';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { deserializeContainer, OCETAGS_MAGIC } from '../src/map/container';
import type { OceContainer, OceContainerTag } from '../src/map/container';
import type { ExtractedDependencyRef } from '../src/map/tag-extractor';
import { planAddInjection, applyAddInjection } from '../src/map/tag-injector';
import type { InjectionPlan } from '../src/map/tag-injector';
import { getGroupDefinition, getGroupStructName, resolveStruct, resolvePointer } from '../src/map/definitions/engine';
import { decodeDependency, decodeReflexive, encodeDependency, encodeReflexive } from '../src/map/definitions/codec';
import { parseCacheFileHeader } from '../src/map/header';
import { parseTagIndex, resolveTagDataPointer } from '../src/map/tag-index';
import type { TagIndex, TagIndexEntry } from '../src/map/tag-index';
import type { CacheFileHeader } from '../src/map/header';
import { hasSampleMap, readSampleMap, missingSampleMapsMessage } from './helpers/sample-maps';

/**
 * Dependency entries are matched to TagDependency fields by fieldPath, never by list position
 * (PRD 2026-10-11 dependency-order P0). Tag data here is synthetic (built field by field from the
 * schema); the target is real bloodgulch.map, so ADD reuses real target tags as dependency targets.
 * Every output check reads the written bytes back with codec/pointer primitives at offsets taken
 * from the schema - not with the injector's own walk.
 */

const NULL_TAG_ID = 0xffffffff;
const haveSamples = hasSampleMap('bloodgulch.map');
const suiteTitle = haveSamples
  ? 'injector resolves dependencies by fieldPath'
  : `injector resolves dependencies by fieldPath [${missingSampleMapsMessage(['bloodgulch.map'])}]`;

function fieldOffset(structName: string, fieldName: string): number {
  const f = resolveStruct(structName).fields.find((x) => x.name === fieldName);
  if (!f) throw new Error(`no field "${fieldName}" in ${structName}`);
  return f.offset;
}

function reflexiveStruct(structName: string, fieldName: string): string {
  const f = resolveStruct(structName).fields.find((x) => x.name === fieldName)!;
  if (f.def.type !== 'TagReflexive') throw new Error(`${structName}.${fieldName} is not a reflexive`);
  return f.def.struct;
}

/** Zero-filled struct bytes are not "empty" for a TagDependency (tagId 0 is a real id) - null every dependency field. */
function nullDependencies(buf: Buffer, structName: string, offset: number): void {
  for (const f of resolveStruct(structName).fields) {
    if (f.def.type === 'TagDependency') encodeDependency(buf, offset + f.offset, { fourcc: NULL_TAG_ID, pathPointer: 0, pathSize: 0, tagId: NULL_TAG_ID });
  }
}

function ref(fourcc: number, sourceTagId: number) {
  return { fourcc, pathPointer: 0, pathSize: 0, tagId: sourceTagId };
}

function containerTag(version: number, t: { originalIndex: number; group: string; path: string; structName: string; data: Buffer; dependencies: ExtractedDependencyRef[] }): OceContainerTag {
  const tag: OceContainerTag = { originalIndex: t.originalIndex, group: t.group, path: t.path, structName: t.structName, data: t.data.toString('base64'), dependencies: t.dependencies };
  if (version >= 2) { tag.secondaryClassFourCC = null; tag.tertiaryClassFourCC = null; }
  if (version >= 3) { tag.embeddedRawDataAssets = []; tag.embeddedRawDataPatches = []; }
  if (version >= 4) tag.injectionBlockers = [];
  return tag;
}

/** Built as JSON and read back with `deserializeContainer`, the same path a saved file takes. v1 omits every later field. */
function buildContainer(version: number, tags: OceContainerTag[]): OceContainer {
  const raw: Record<string, unknown> = {
    magic: OCETAGS_MAGIC, formatVersion: version, sourceMapName: 'synthetic', createdAt: '2026-10-11T00:00:00.000Z',
    hasUnresolvedBspReferences: false, rootOriginalIndices: [tags[0].originalIndex], tags, notExtracted: [], warnings: [],
  };
  if (version >= 2) { raw.resourceMapIdentities = {}; raw.externalResourceRefs = []; raw.externalData = 'referenced'; }
  return deserializeContainer(Buffer.from(JSON.stringify(raw), 'utf-8'));
}

describe.skipIf(!haveSamples)(suiteTitle, () => {
  let bgBuffer: Buffer;
  let bgHeader: CacheFileHeader;
  let bgTagIndex: TagIndex;
  /** Distinct internal bloodgulch tags used as dependency targets (any class - only the assignment is under test). */
  let targets: TagIndexEntry[];

  beforeAll(() => {
    bgBuffer = readSampleMap('bloodgulch.map');
    const bg = inspectCustomEditionMap(bgBuffer);
    if (bg.status !== 'ok') throw new Error('bloodgulch did not parse');
    bgHeader = bg.header;
    bgTagIndex = bg.tagIndex;
    targets = bgTagIndex.entries.filter((e) => !e.isExternal && e.primaryClassName && getGroupStructName(e.primaryClassName)).slice(0, 8);
    expect(targets.length).toBe(8);
  });

  /** Reused (matched) container tags for `targets`; ADD never writes or validates their data. */
  function reusedTargetTags(version: number): OceContainerTag[] {
    return targets.map((e, k) => containerTag(version, { originalIndex: 1000 + k, group: e.primaryClassName!, path: e.path, structName: getGroupStructName(e.primaryClassName!)!, data: Buffer.alloc(0), dependencies: [] }));
  }

  function internalDep(fieldPath: string, k: number): ExtractedDependencyRef {
    return { fieldPath, group: targets[k].primaryClassName!, path: targets[k].path, kind: 'internal', localTagIndex: 1 + k };
  }

  const GLOBALS_PATH = 'test\\dependency order\\globals';
  const MP = 'GlobalsMultiplayerInformation';

  /**
   * A globals tag whose one "multiplayer information" element has the problem shape:
   * flag, unit, vehicles[2] (each with a "vehicle" dependency), THEN hill shader, flag shader, ball.
   * Entries are listed in the extractor's two-phase order (the struct's own fields first, then
   * the reflexive's children) - the order every container v1-v4 was saved in.
   */
  function globalsTag(version: number) {
    const rootStruct = getGroupDefinition('globals').name;
    const vehicleStruct = reflexiveStruct(MP, 'vehicles');
    const rootSize = resolveStruct(rootStruct).totalSize;
    const mpSize = resolveStruct(MP).totalSize;
    const vehicleSize = resolveStruct(vehicleStruct).totalSize;
    const mpAt = rootSize;
    const vehiclesAt = mpAt + mpSize;
    const data = Buffer.alloc(vehiclesAt + 2 * vehicleSize);
    nullDependencies(data, rootStruct, 0);
    nullDependencies(data, MP, mpAt);
    for (let i = 0; i < 2; i++) nullDependencies(data, vehicleStruct, vehiclesAt + i * vehicleSize);
    encodeReflexive(data, fieldOffset(rootStruct, 'multiplayer information'), { count: 1, pointerLow: mpAt, pointerHigh: 0 });
    encodeReflexive(data, mpAt + fieldOffset(MP, 'vehicles'), { count: 2, pointerLow: vehiclesAt, pointerHigh: 0 });

    const mp = `${GLOBALS_PATH}.multiplayer information[0]`;
    // field -> which target it must end up pointing at. Source tagIds are arbitrary non-null values.
    const fields: { at: number; fieldPath: string; target: number }[] = [
      { at: mpAt + fieldOffset(MP, 'flag'), fieldPath: `${mp}.flag`, target: 0 },
      { at: mpAt + fieldOffset(MP, 'unit'), fieldPath: `${mp}.unit`, target: 1 },
      { at: vehiclesAt + fieldOffset(vehicleStruct, 'vehicle'), fieldPath: `${mp}.vehicles[0].vehicle`, target: 2 },
      { at: vehiclesAt + vehicleSize + fieldOffset(vehicleStruct, 'vehicle'), fieldPath: `${mp}.vehicles[1].vehicle`, target: 3 },
      { at: mpAt + fieldOffset(MP, 'hill shader'), fieldPath: `${mp}.hill shader`, target: 4 },
      { at: mpAt + fieldOffset(MP, 'flag shader'), fieldPath: `${mp}.flag shader`, target: 5 },
      { at: mpAt + fieldOffset(MP, 'ball'), fieldPath: `${mp}.ball`, target: 6 },
    ];
    fields.forEach((f, k) => encodeDependency(data, f.at, ref(targets[f.target].primaryClassFourCC, 0xe0000000 + k)));
    const byPath = new Map(fields.map((f) => [f.fieldPath, f]));
    const twoPhaseOrder = [`${mp}.flag`, `${mp}.unit`, `${mp}.hill shader`, `${mp}.flag shader`, `${mp}.ball`, `${mp}.vehicles[0].vehicle`, `${mp}.vehicles[1].vehicle`];
    const dependencies = twoPhaseOrder.map((p) => internalDep(p, byPath.get(p)!.target));
    return { data, fields, dependencies, rootStruct };
  }

  /** Reads each expected field of the newly added tag straight from the output bytes. */
  function writtenTagIds(out: Buffer, path: string, fields: { fieldPath: string }[]): Map<string, number> {
    const header = parseCacheFileHeader(out);
    const ti = parseTagIndex(out, header);
    const entry = ti.entries.find((e) => e.path === path)!;
    expect(entry).toBeDefined();
    const root = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, ti.baseMemoryAddress);
    const rootStruct = getGroupDefinition('globals').name;
    const vehicleStruct = reflexiveStruct(MP, 'vehicles');
    const mpRef = decodeReflexive(out, root + fieldOffset(rootStruct, 'multiplayer information'));
    const mpAt = resolvePointer(mpRef.pointerLow, header.tagDataOffset, ti.baseMemoryAddress);
    const vRef = decodeReflexive(out, mpAt + fieldOffset(MP, 'vehicles'));
    const vAt = resolvePointer(vRef.pointerLow, header.tagDataOffset, ti.baseMemoryAddress);
    const vSize = resolveStruct(vehicleStruct).totalSize;
    const at: Record<string, number> = {
      flag: mpAt + fieldOffset(MP, 'flag'), unit: mpAt + fieldOffset(MP, 'unit'),
      'vehicles[0].vehicle': vAt + fieldOffset(vehicleStruct, 'vehicle'), 'vehicles[1].vehicle': vAt + vSize + fieldOffset(vehicleStruct, 'vehicle'),
      'hill shader': mpAt + fieldOffset(MP, 'hill shader'), 'flag shader': mpAt + fieldOffset(MP, 'flag shader'), ball: mpAt + fieldOffset(MP, 'ball'),
    };
    const result = new Map<string, number>();
    for (const f of fields) result.set(f.fieldPath, decodeDependency(out, at[f.fieldPath.split('multiplayer information[0].')[1]]).tagId);
    return result;
  }

  function planOk(container: OceContainer): InjectionPlan {
    const plan = planAddInjection(bgTagIndex, container);
    if (plan.kind !== 'ok') throw new Error(`plan refused: ${plan.reason}`);
    return plan;
  }

  for (const version of [1, 2, 3, 4]) {
    it(`GlobalsMultiplayerInformation shape (dependency, reflexive whose child has a dependency, then more dependencies), container v${version} in two-phase order: every field gets its own target`, () => {
      const g = globalsTag(version);
      // Precondition: the saved list order really differs from field order, so a positional read would mis-assign.
      expect(g.dependencies.map((d) => d.fieldPath)).not.toEqual(g.fields.map((f) => f.fieldPath));
      const container = buildContainer(version, [containerTag(version, { originalIndex: 0, group: 'globals', path: GLOBALS_PATH, structName: g.rootStruct, data: g.data, dependencies: g.dependencies }), ...reusedTargetTags(version)]);
      const plan = planOk(container);
      expect(plan.toAddLocalIndices).toEqual([0]);
      expect(plan.blockedOther).toEqual([]);
      const out = applyAddInjection(bgBuffer, bgHeader, bgTagIndex, container, plan);
      const written = writtenTagIds(out, GLOBALS_PATH, g.fields);
      for (const f of g.fields) expect({ field: f.fieldPath, tagId: written.get(f.fieldPath) }).toEqual({ field: f.fieldPath, tagId: targets[f.target].tagId });
    });
  }

  it('unknown fieldPath (e.g. a field renamed since the container was saved) blocks the tag at plan time with a clear reason; apply does not throw', () => {
    const g = globalsTag(4);
    const deps = g.dependencies.map((d) => (d.fieldPath.endsWith('.hill shader') ? { ...d, fieldPath: d.fieldPath.replace('hill shader', 'hill shader (old name)') } : d));
    const container = buildContainer(4, [containerTag(4, { originalIndex: 0, group: 'globals', path: GLOBALS_PATH, structName: g.rootStruct, data: g.data, dependencies: deps }), ...reusedTargetTags(4)]);
    const plan = planOk(container);
    expect(plan.toAddLocalIndices).toEqual([]);
    expect(plan.refusedRoots.map((r) => r.path)).toEqual([GLOBALS_PATH]);
    const reasons = plan.blockedOther.find((b) => b.localIndex === 0)!.reasons.join(' ');
    expect(reasons).toContain('hill shader (old name)" is not a tag reference field in this build (unknown, or renamed since the container was saved)');
    expect(reasons).toContain('.hill shader" holds a tag reference but the container has no entry for it');
    expect(() => applyAddInjection(bgBuffer, bgHeader, bgTagIndex, container, plan)).not.toThrow();
  });

  it('a non-null dependency field with no entry blocks the tag at plan time; apply does not throw', () => {
    const g = globalsTag(4);
    const deps = g.dependencies.filter((d) => !d.fieldPath.endsWith('vehicles[1].vehicle'));
    const container = buildContainer(4, [containerTag(4, { originalIndex: 0, group: 'globals', path: GLOBALS_PATH, structName: g.rootStruct, data: g.data, dependencies: deps }), ...reusedTargetTags(4)]);
    const plan = planOk(container);
    expect(plan.toAddLocalIndices).toEqual([]);
    expect(plan.blockedOther.find((b) => b.localIndex === 0)!.reasons.join(' ')).toContain('vehicles[1].vehicle" holds a tag reference but the container has no entry for it');
    expect(() => applyAddInjection(bgBuffer, bgHeader, bgTagIndex, container, plan)).not.toThrow();
  });

  it('saved data that no longer fits the schema (reflexive outside the tag data) blocks the tag at plan time instead of throwing', () => {
    const g = globalsTag(4);
    encodeReflexive(g.data, resolveStruct(getGroupDefinition('globals').name).totalSize + fieldOffset(MP, 'vehicles'), { count: 500, pointerLow: g.data.length - 8, pointerHigh: 0 });
    const container = buildContainer(4, [containerTag(4, { originalIndex: 0, group: 'globals', path: GLOBALS_PATH, structName: g.rootStruct, data: g.data, dependencies: g.dependencies }), ...reusedTargetTags(4)]);
    const plan = planOk(container);
    expect(plan.toAddLocalIndices).toEqual([]);
    expect(plan.blockedOther.find((b) => b.localIndex === 0)!.reasons.join(' ')).toContain("saved data does not match this build's field layout");
  });

  const METER_PATH = 'test\\dependency order\\meter';
  function meterTag() {
    const structName = getGroupDefinition('meter').name;
    const data = Buffer.alloc(resolveStruct(structName).totalSize);
    nullDependencies(data, structName, 0);
    // Both are nonCached dependency fields; non-null leftovers exactly like ui.map's "cyborg shield"/"cyborg body" meters.
    const stencilAt = fieldOffset(structName, 'stencil bitmaps');
    const sourceAt = fieldOffset(structName, 'source bitmap');
    encodeDependency(data, stencilAt, { fourcc: 0x6269746d, pathPointer: 0x12345678, pathSize: 7, tagId: 0xe1230042 });
    encodeDependency(data, sourceAt, { fourcc: 0x6269746d, pathPointer: 0x0badf00d, pathSize: 9, tagId: 0xe4560043 });
    return { structName, data, stencilAt, sourceAt };
  }

  function addedTagBytes(out: Buffer, path: string, size: number): Buffer {
    const header = parseCacheFileHeader(out);
    const ti = parseTagIndex(out, header);
    const entry = ti.entries.find((e) => e.path === path)!;
    const at = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, ti.baseMemoryAddress);
    return out.subarray(at, at + size);
  }

  it('meter with non-null nonCached dependency fields and no entries for them (current extractor): added, both fields left byte-for-byte as in the source', () => {
    const m = meterTag();
    const container = buildContainer(4, [containerTag(4, { originalIndex: 0, group: 'meter', path: METER_PATH, structName: m.structName, data: m.data, dependencies: [] })]);
    const plan = planOk(container);
    expect(plan.toAddLocalIndices).toEqual([0]);
    const bytes = addedTagBytes(applyAddInjection(bgBuffer, bgHeader, bgTagIndex, container, plan), METER_PATH, m.data.length);
    expect(bytes.subarray(m.stencilAt, m.stencilAt + 16)).toEqual(m.data.subarray(m.stencilAt, m.stencilAt + 16));
    expect(bytes.subarray(m.sourceAt, m.sourceAt + 16)).toEqual(m.data.subarray(m.sourceAt, m.sourceAt + 16));
  });

  it('saved data block (TagDataOffset) pointing outside the tag data blocks the tag at plan time instead of being written', () => {
    const m = meterTag();
    const stencil = fieldOffset(m.structName, 'encoded stencil');
    m.data.writeUInt32LE(64, stencil); // size
    m.data.writeUInt32LE(m.data.length - 8, stencil + 12); // local pointer: runs past the end
    const container = buildContainer(4, [containerTag(4, { originalIndex: 0, group: 'meter', path: METER_PATH, structName: m.structName, data: m.data, dependencies: [] })]);
    const plan = planOk(container);
    expect(plan.toAddLocalIndices).toEqual([]);
    expect(plan.blockedOther.find((b) => b.localIndex === 0)!.reasons.join(' ')).toContain("saved data does not match this build's field layout");
    expect(() => applyAddInjection(bgBuffer, bgHeader, bgTagIndex, container, plan)).not.toThrow();
  });

  for (const version of [1, 4]) {
    it(`old container v${version} with extra entries for nonCached fields (saved before the extractor skipped them): entries ignored, tag added, bytes unchanged`, () => {
      const m = meterTag();
      const deps: ExtractedDependencyRef[] = [
        { fieldPath: `${METER_PATH}.stencil bitmaps`, group: 'bitmap', path: '(unknown)', kind: 'unresolved' },
        internalDep(`${METER_PATH}.source bitmap`, 0),
      ];
      const container = buildContainer(version, [containerTag(version, { originalIndex: 0, group: 'meter', path: METER_PATH, structName: m.structName, data: m.data, dependencies: deps }), ...reusedTargetTags(version)]);
      const plan = planOk(container);
      expect(plan.toAddLocalIndices).toEqual([0]);
      expect(plan.blockedOther).toEqual([]);
      const bytes = addedTagBytes(applyAddInjection(bgBuffer, bgHeader, bgTagIndex, container, plan), METER_PATH, m.data.length);
      expect(bytes.subarray(m.stencilAt, m.stencilAt + 16)).toEqual(m.data.subarray(m.stencilAt, m.stencilAt + 16));
      expect(bytes.subarray(m.sourceAt, m.sourceAt + 16)).toEqual(m.data.subarray(m.sourceAt, m.sourceAt + 16));
    });
  }
});
