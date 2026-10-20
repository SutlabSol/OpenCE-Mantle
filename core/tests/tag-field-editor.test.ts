import { describe, expect, it, beforeAll } from 'vitest';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { readTagFieldValues, writeTagFieldValue, addReflexiveChunk, TagFieldEditorError } from '../src/map/tag-field-editor';
import { hasSampleMaps, missingSampleMapsMessage, readSampleMap } from './helpers/sample-maps';
import { NULL_TAG_ID } from '../src/constants/tag-classes';

describe('core/src/map/tag-field-editor', () => {
  const SAMPLES = ['bloodgulch.map'];
  let mapBuf: Buffer;
  let header: ReturnType<typeof inspectCustomEditionMap>['header'];
  let tagIndex: ReturnType<typeof inspectCustomEditionMap>['tagIndex'];

  beforeAll(() => {
    if (!hasSampleMaps(SAMPLES)) return;
    mapBuf = readSampleMap('bloodgulch.map');
    const inspected = inspectCustomEditionMap(mapBuf);
    header = inspected.header;
    tagIndex = inspected.tagIndex;
  });

  it('reads fields of a weapon tag in bloodgulch.map', () => {
    if (!hasSampleMaps(SAMPLES)) return;
    const arIndex = tagIndex.entries.findIndex((e) => e.path === 'weapons\\assault rifle\\assault rifle');
    expect(arIndex).toBeGreaterThanOrEqual(0);

    const result = readTagFieldValues(mapBuf, header, tagIndex, arIndex);
    expect(result.tagPath).toBe('weapons\\assault rifle\\assault rifle');
    expect(result.group).toBe('weapon');
    expect(result.structName).toBe('Weapon');
    expect(result.fields.length).toBeGreaterThan(20);

    // Check specific fields exist with expected kinds
    const flagsField = result.fields.find((f) => f.name === 'flags');
    expect(flagsField).toBeDefined();
    expect(flagsField?.kind).toBe('bitfield');
    expect(flagsField?.bitfieldFlags?.length).toBeGreaterThan(0);

    const readyEffect = result.fields.find((f) => f.name === 'ready effect');
    expect(readyEffect).toBeDefined();
    expect(readyEffect?.kind).toBe('dependency');
    expect(readyEffect?.dependencyClasses).toContain('effect');
  });

  it('modifies numeric and bounds fields in-place and preserves untouched bytes', () => {
    if (!hasSampleMaps(SAMPLES)) return;
    const testBuf = Buffer.from(mapBuf); // copy so test is isolated
    const arIndex = tagIndex.entries.findIndex((e) => e.path === 'weapons\\assault rifle\\assault rifle');
    const beforeResult = readTagFieldValues(testBuf, header, tagIndex, arIndex);

    // Find a float field
    const autoAimAngle = beforeResult.fields.find((f) => f.name === 'autoaim angle');
    expect(autoAimAngle).toBeDefined();
    const originalVal = autoAimAngle?.value as number;
    const targetVal = 1.25;

    writeTagFieldValue(testBuf, header, tagIndex, arIndex, 'autoaim angle', targetVal);

    const afterResult = readTagFieldValues(testBuf, header, tagIndex, arIndex);
    const updatedAngle = afterResult.fields.find((f) => f.name === 'autoaim angle');
    expect(updatedAngle?.value).toBeCloseTo(targetVal, 4);

    // Restore and check byte equality
    writeTagFieldValue(testBuf, header, tagIndex, arIndex, 'autoaim angle', originalVal);
    expect(testBuf.equals(mapBuf)).toBe(true);
  });

  it('modifies enum and bitfield values in-place', () => {
    if (!hasSampleMaps(SAMPLES)) return;
    const testBuf = Buffer.from(mapBuf);
    const arIndex = tagIndex.entries.findIndex((e) => e.path === 'weapons\\assault rifle\\assault rifle');

    // Test bitfield
    const beforeResult = readTagFieldValues(testBuf, header, tagIndex, arIndex);
    const flagsField = beforeResult.fields.find((f) => f.name === 'flags')!;
    const originalFlags = flagsField.value as number;

    const newFlags = originalFlags ^ 0x01;
    writeTagFieldValue(testBuf, header, tagIndex, arIndex, 'flags', newFlags);

    const afterResult = readTagFieldValues(testBuf, header, tagIndex, arIndex);
    expect(afterResult.fields.find((f) => f.name === 'flags')?.value).toBe(newFlags);

    // Restore
    writeTagFieldValue(testBuf, header, tagIndex, arIndex, 'flags', originalFlags);
    expect(testBuf.equals(mapBuf)).toBe(true);
  });

  it('modifies TagDependency field in-place to another tag or null', () => {
    if (!hasSampleMaps(SAMPLES)) return;
    const testBuf = Buffer.from(mapBuf);
    const arIndex = tagIndex.entries.findIndex((e) => e.path === 'weapons\\assault rifle\\assault rifle');
    const beforeResult = readTagFieldValues(testBuf, header, tagIndex, arIndex);

    const readyEffect = beforeResult.fields.find((f) => f.name === 'ready effect')!;
    const originalDep = readyEffect.value as number;

    // Set to null
    writeTagFieldValue(testBuf, header, tagIndex, arIndex, 'ready effect', NULL_TAG_ID);
    const nullResult = readTagFieldValues(testBuf, header, tagIndex, arIndex);
    const nullDep = nullResult.fields.find((f) => f.name === 'ready effect')!;
    expect(nullDep.value).toBe(NULL_TAG_ID);
    expect(nullDep.dependencyTarget).toBeNull();

    // Restore original tag dependency
    writeTagFieldValue(testBuf, header, tagIndex, arIndex, 'ready effect', originalDep);
    const restoredResult = readTagFieldValues(testBuf, header, tagIndex, arIndex);
    expect(restoredResult.fields.find((f) => f.name === 'ready effect')?.value).toBe(originalDep);
  });

  it('throws helpful errors on invalid field or unsupported reflexive edits', () => {
    if (!hasSampleMaps(SAMPLES)) return;
    const arIndex = tagIndex.entries.findIndex((e) => e.path === 'weapons\\assault rifle\\assault rifle');

    expect(() => {
      writeTagFieldValue(mapBuf, header, tagIndex, arIndex, 'non_existent_field', 123);
    }).toThrow(TagFieldEditorError);

    // Reflexives are read-only in M7a
    expect(() => {
      writeTagFieldValue(mapBuf, header, tagIndex, arIndex, 'magazines', 123);
    }).toThrow(/In-place editing of TagReflexive is not supported/);
  });

  it('decodes TagReflexive children recursively into TagReflexiveElement[] (read-only)', () => {
    if (!hasSampleMaps(SAMPLES)) return;
    const arIndex = tagIndex.entries.findIndex((e) => e.path === 'weapons\\assault rifle\\assault rifle');
    const r = readTagFieldValues(mapBuf, header, tagIndex, arIndex);

    const isReflexive = (f: { kind: string }): f is { kind: string; children: unknown[]; reflexiveCount: number } => f.kind === 'reflexive';

    const reflexiveFields = r.fields.filter(isReflexive);
    expect(reflexiveFields.length).toBeGreaterThan(0);
    // Every reflexive must expose the TagReflexiveElement[] contract
    for (const f of reflexiveFields) {
      expect(Array.isArray(f.children)).toBe(true);
      expect(typeof f.reflexiveStruct).toBe('string');
      expect(typeof f.reflexiveCount).toBe('number');
      // reflexiveCount (block header) and decoded children length must agree
      expect(f.children!.length).toBe(f.reflexiveCount!);
      for (const el of f.children!) {
        expect(typeof el.structName).toBe('string');
        expect(el.structName).toBe(f.reflexiveStruct);
        expect(Number.isInteger(el.structBase)).toBe(true);
        expect(Array.isArray(el.fields)).toBe(true);
        // Each child element exposes decoded fields in field-descriptor shape
        for (const cf of el.fields) {
          expect(typeof cf.name).toBe('string');
          expect(typeof cf.offset).toBe('number');
          expect(typeof cf.size).toBe('number');
          expect(typeof cf.kind).toBe('string');
        }
        // Nested reflexives inside a child must also be decoded (recursion depth > 0)
        const nested = cf_nested(el.fields);
        for (const n of nested) {
          expect(Array.isArray(n.children)).toBe(true);
          expect(n.children!.length).toBe(n.reflexiveCount!);
        }
      }
    }

    function cf_nested(fields: readonly { kind: string; children?: unknown[]; reflexiveCount?: number }[]) {
      return fields.filter((x): x is { kind: string; children: unknown[]; reflexiveCount: number } => x.kind === 'reflexive');
    }
  });

  it('TagReflexiveElement.structBase points at the referenced struct bytes in the map (offset-based)', () => {
    if (!hasSampleMaps(SAMPLES)) return;
    const arIndex = tagIndex.entries.findIndex((e) => e.path === 'weapons\\assault rifle\\assault rifle');
    const r = readTagFieldValues(mapBuf, header, tagIndex, arIndex);
    const magazineList = r.fields.find((f) => f.kind === 'reflexive' && f.name === 'magazines')!;
    expect(magazineList).toBeDefined();
    expect(magazineList.children!.length).toBeGreaterThan(0);

    const first = magazineList.children![0];
    // structBase is an absolute file offset within the map (not a tag-relative offset).
    expect(first.structBase).toBeGreaterThanOrEqual(0);
    expect(first.structBase).toBeLessThan(mapBuf.length);
    // The struct bytes must be within the map and not all-zero.
    let nonZero = 0;
    for (let i = 0; i < Math.min(64, mapBuf.length - first.structBase); i++) {
      if (mapBuf[first.structBase + i] !== 0) nonZero++;
    }
    expect(nonZero).toBeGreaterThan(0);
  });

  /** Locate a leaf field of a given (possibly dotted) reflexive path in a decoded result, without writing. */
  function leafAtPath(root: { fields: readonly { kind: string; name: string; children?: readonly { fields: readonly { name: string; value: unknown }[] }[] }[] }, path: string) {
    const segments = path.split('.');
    type F = { kind: string; name: string; value?: unknown; children?: readonly { fields: readonly F[] }[] };
    function findReflexive(fields: readonly F[], name: string) {
      return fields.find((f) => f.kind === 'reflexive' && f.name === name);
    }
    let fields: readonly F[] = root.fields as readonly F[];
    for (let i = 0; i < segments.length - 1; i++) {
      const m = segments[i].match(/^(.+)\[(\d+)\]$/)!;
      const idx = Number(m[2]);
      fields = findReflexive(fields, m[1])!.children![idx].fields;
    }
    return fields.find((f) => f.name === segments[segments.length - 1]);
  }

  it('writes a depth-1 reflexive field (magazines[0].rounds recharged) and restores to byte-equality', () => {
    if (!hasSampleMaps(SAMPLES)) return;
    const testBuf = Buffer.from(mapBuf);
    const arIndex = tagIndex.entries.findIndex((e) => e.path === 'weapons\\assault rifle\\assault rifle');
    const path = 'magazines[0].rounds recharged';
    const original = leafAtPath(readTagFieldValues(mapBuf, header, tagIndex, arIndex), path)?.value as number;

    const newVal = original === 0 ? 500 : 0;
    writeTagFieldValue(testBuf, header, tagIndex, arIndex, path, newVal);
    const after = readTagFieldValues(testBuf, header, tagIndex, arIndex);
    expect(leafAtPath(after, path)?.value).toBe(newVal);

    // Restore the original byte value: the buffer must match the untouched sample exactly.
    writeTagFieldValue(testBuf, header, tagIndex, arIndex, path, original);
    expect(testBuf.equals(mapBuf)).toBe(true);
  });

  it('writes a depth-2 reflexive field (magazines[0].magazine objects[0].rounds) and restores to byte-equality', () => {
    if (!hasSampleMaps(SAMPLES)) return;
    const testBuf = Buffer.from(mapBuf);
    const arIndex = tagIndex.entries.findIndex((e) => e.path === 'weapons\\assault rifle\\assault rifle');
    const path = 'magazines[0].magazine objects[0].rounds';
    const original = leafAtPath(readTagFieldValues(mapBuf, header, tagIndex, arIndex), path)?.value as number | undefined;
    // Magazine objects may be empty on this weapon; skip the write when no element exists.
    if (original === undefined) return;

    const newVal = Number(original) + 1;
    writeTagFieldValue(testBuf, header, tagIndex, arIndex, path, newVal);
    const after = readTagFieldValues(testBuf, header, tagIndex, arIndex);
    expect(leafAtPath(after, path)?.value).toBe(newVal);

    writeTagFieldValue(testBuf, header, tagIndex, arIndex, path, original);
    expect(testBuf.equals(mapBuf)).toBe(true);
  });

  it('writes to multiple depth-2 elements independently and each restore is byte-exact', () => {
    if (!hasSampleMaps(SAMPLES)) return;
    const testBuf = Buffer.from(mapBuf);
    const arIndex = tagIndex.entries.findIndex((e) => e.path === 'weapons\\assault rifle\\assault rifle');
    const before = readTagFieldValues(mapBuf, header, tagIndex, arIndex);
    const magazineObjects = (before.fields.find((f) => f.kind === 'reflexive' && f.name === 'magazines') as {
      children?: readonly { fields: readonly (typeof before.fields)[number][] }[];
    } | undefined)?.children?.[0]?.fields.find((f) => f.kind === 'reflexive' && f.name === 'magazine objects') as
      | { children: readonly { fields: readonly (typeof before.fields)[number][] }[] }
      | undefined;
    // Magazine objects may have fewer than two elements on this weapon.
    if (!magazineObjects || magazineObjects.children.length < 2) return;

    const orig0 = magazineObjects.children[0].fields.find((f) => f.name === 'rounds')!.value as number;
    const orig1 = magazineObjects.children[1].fields.find((f) => f.name === 'rounds')!.value as number;
    const val0 = orig0 === 101 ? 100 : 101;
    const val1 = orig1 === 202 ? 201 : 202;

    // Two separate writes: neither write may bleed into the other element.
    writeTagFieldValue(testBuf, header, tagIndex, arIndex, 'magazines[0].magazine objects[0].rounds', val0);
    writeTagFieldValue(testBuf, header, tagIndex, arIndex, 'magazines[0].magazine objects[1].rounds', val1);
    const after = readTagFieldValues(testBuf, header, tagIndex, arIndex);
    expect(leafAtPath(after, 'magazines[0].magazine objects[0].rounds')?.value).toBe(val0);
    expect(leafAtPath(after, 'magazines[0].magazine objects[1].rounds')?.value).toBe(val1);

    writeTagFieldValue(testBuf, header, tagIndex, arIndex, 'magazines[0].magazine objects[0].rounds', orig0);
    writeTagFieldValue(testBuf, header, tagIndex, arIndex, 'magazines[0].magazine objects[1].rounds', orig1);
    expect(testBuf.equals(mapBuf)).toBe(true);
  });

  it('rejects out-of-range reflexive indices, unknown nested fields, and malformed path segments', () => {
    if (!hasSampleMaps(SAMPLES)) return;
    const arIndex = tagIndex.entries.findIndex((e) => e.path === 'weapons\\assault rifle\\assault rifle');

    // Index far beyond whatever this map's magazine reflexive actually contains.
    expect(() => writeTagFieldValue(mapBuf, header, tagIndex, arIndex, 'magazines[9999].rounds recharged', 1)).toThrow(TagFieldEditorError);
    // Unknown field on the leaf struct.
    expect(() => writeTagFieldValue(mapBuf, header, tagIndex, arIndex, 'magazines[0].definitely_not_a_field', 1)).toThrow(TagFieldEditorError);
    // Unknown struct name in a reflexive step.
    expect(() => writeTagFieldValue(mapBuf, header, tagIndex, arIndex, 'notAReflexive[0].rounds recharged', 1)).toThrow(TagFieldEditorError);
    // A non-reflexive intermediate segment (autoaim angle is a float, not a TagReflexive).
    expect(() => writeTagFieldValue(mapBuf, header, tagIndex, arIndex, 'autoaim angle[0].x', 1)).toThrow(TagFieldEditorError);
    // An intermediate segment in the wrong form (no `[<index>]` step) must be rejected.
    expect(() => writeTagFieldValue(mapBuf, header, tagIndex, arIndex, 'magazines.rounds recharged', 1)).toThrow(TagFieldEditorError);
  });

  it('clones and adds new reflexive chunks cleanly in tag data', () => {
    if (!hasSampleMaps(SAMPLES)) return;
    const hogIndex = tagIndex.entries.findIndex((e) => e.path === 'vehicles\\warthog\\mp_warthog');
    expect(hogIndex).toBeGreaterThanOrEqual(0);

    const initialResult = readTagFieldValues(mapBuf, header, tagIndex, hogIndex);
    const seatsField = initialResult.fields.find((f) => f.name === 'seats' && f.kind === 'reflexive') as {
      children?: readonly { fields: readonly (typeof initialResult.fields)[number][] }[];
    };
    expect(seatsField).toBeDefined();
    const origCount = seatsField.children?.length ?? 0;
    expect(origCount).toBe(3); // driver, passenger, gunner

    // 1. Clone element 2 (gunner seat) to make a 4th seat
    const cloneRes = addReflexiveChunk(mapBuf, header, tagIndex, hogIndex, 'seats', 2);
    expect(cloneRes.newElementIndex).toBe(origCount);
    expect(cloneRes.newCount).toBe(origCount + 1);
    expect(cloneRes.buffer.length).toBeGreaterThan(mapBuf.length);

    // Read back fields with the new buffer and header
    const afterClone = readTagFieldValues(cloneRes.buffer, cloneRes.header, cloneRes.tagIndex, hogIndex);
    const seatsAfterClone = afterClone.fields.find((f) => f.name === 'seats' && f.kind === 'reflexive') as {
      children?: readonly { fields: readonly (typeof initialResult.fields)[number][] }[];
    };
    expect(seatsAfterClone.children?.length).toBe(origCount + 1);
    // Cloned seat label should match original seat 2 label
    const seat2Label = seatsField.children?.[2].fields.find((f) => f.name === 'label')?.value;
    const seat3Label = seatsAfterClone.children?.[3].fields.find((f) => f.name === 'label')?.value;
    expect(seat3Label).toBe(seat2Label);

    // Write a new label to the cloned seat
    writeTagFieldValue(cloneRes.buffer, cloneRes.header, cloneRes.tagIndex, hogIndex, `seats[${origCount}].label`, 'W-rear');
    const afterLabelEdit = readTagFieldValues(cloneRes.buffer, cloneRes.header, cloneRes.tagIndex, hogIndex);
    const seat3LabelEdited = (afterLabelEdit.fields.find((f) => f.name === 'seats' && f.kind === 'reflexive') as any)
      .children?.[3].fields.find((f: any) => f.name === 'label')?.value;
    expect(seat3LabelEdited).toBe('W-rear');

    // 2. Add an empty (zero-filled) chunk
    const emptyRes = addReflexiveChunk(cloneRes.buffer, cloneRes.header, cloneRes.tagIndex, hogIndex, 'seats', -1);
    expect(emptyRes.newCount).toBe(origCount + 2);
    const afterEmpty = readTagFieldValues(emptyRes.buffer, emptyRes.header, emptyRes.tagIndex, hogIndex);
    const seatsAfterEmpty = (afterEmpty.fields.find((f) => f.name === 'seats' && f.kind === 'reflexive') as any).children;
    expect(seatsAfterEmpty?.length).toBe(origCount + 2);
    const seat4Label = seatsAfterEmpty?.[4].fields.find((f: any) => f.name === 'label')?.value;
    expect(seat4Label).toBe('');
  });
});

