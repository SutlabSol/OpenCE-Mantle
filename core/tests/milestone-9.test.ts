import { describe, expect, it, beforeAll } from 'vitest';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { hasSampleMaps, hasSampleMap, readSampleMap } from './helpers/sample-maps';
import { findReferencingTags } from '../src/map/tag-reverse-dependencies';
import { readUnicodeStringList, writeUnicodeString, UnicodeStringEditorError } from '../src/map/unicode-string-editor';
import { renameTagInMap, duplicateTagInMap, TagIndexEditorError } from '../src/map/tag-index-editor';
import { computeNewTagId } from '../src/map/tag-injector';

describe('Milestone 9 core features', () => {
  const SAMPLES = ['bloodgulch.map'];
  let buf: Buffer;
  let header: ReturnType<typeof inspectCustomEditionMap>['header'];
  let tagIndex: ReturnType<typeof inspectCustomEditionMap>['tagIndex'];

  beforeAll(() => {
    if (!hasSampleMaps(SAMPLES)) return;
    buf = readSampleMap('bloodgulch.map');
    const r = inspectCustomEditionMap(buf);
    header = r.header;
    tagIndex = r.tagIndex;
  });

  describe('Reverse Dependency Lookup (findReferencingTags)', () => {
    it('finds referencing tags for the assault rifle in bloodgulch', () => {
      if (!hasSampleMaps(SAMPLES)) return;
      const rifleIndex = tagIndex.entries.findIndex((e) => e.path === 'weapons\\assault rifle\\assault rifle');
      expect(rifleIndex).toBeGreaterThan(-1);

      const refs = findReferencingTags(buf, header, tagIndex, rifleIndex);
      expect(refs.length).toBeGreaterThan(0);
      // The scenario and/or item collections should reference the rifle
      expect(refs.some((r) => r.sourceGroup === 'scenario' || r.sourceGroup === 'item_collection')).toBe(true);
      for (const ref of refs) {
        expect(ref.sourceTagIndex).toBeGreaterThanOrEqual(0);
        expect(ref.sourcePath.length).toBeGreaterThan(0);
        expect(ref.fieldPath.length).toBeGreaterThan(0);
      }
    });

    it('returns empty array for an invalid or unreferenced tag index', () => {
      if (!hasSampleMaps(SAMPLES)) return;
      const refs = findReferencingTags(buf, header, tagIndex, 999999);
      expect(refs).toEqual([]);
    });
  });

  describe('Unicode String List Editor (ustr)', () => {
    let ustrMapBuf: Buffer | null = null;
    let ustrMapHeader: ReturnType<typeof inspectCustomEditionMap>['header'];
    let ustrMapTagIndex: ReturnType<typeof inspectCustomEditionMap>['tagIndex'];
    let ustrIndex = -1;

    beforeAll(() => {
      // If ui.map is present, it contains internal ustr tags
      if (hasSampleMap('ui.map')) {
        ustrMapBuf = readSampleMap('ui.map');
        const r = inspectCustomEditionMap(ustrMapBuf);
        ustrMapHeader = r.header;
        ustrMapTagIndex = r.tagIndex;
        ustrIndex = ustrMapTagIndex.entries.findIndex((e) => e.primaryClassName === 'unicode_string_list' && !e.isExternal);
      }
    });

    it('identifies external ustr tags gracefully without crashing', () => {
      if (!hasSampleMaps(SAMPLES)) return;
      const extUstrIdx = tagIndex.entries.findIndex((e) => e.primaryClassName === 'unicode_string_list' && e.isExternal);
      if (extUstrIdx === -1) return;
      const res = readUnicodeStringList(buf, header, tagIndex, extUstrIdx);
      expect(res.isExternal).toBe(true);
      expect(res.strings).toEqual([]);
    });

    it('reads unicode string entries from internal ustr tag', () => {
      if (!ustrMapBuf || ustrIndex === -1) return;
      const result = readUnicodeStringList(ustrMapBuf, ustrMapHeader, ustrMapTagIndex, ustrIndex);
      expect(result.tagIndex).toBe(ustrIndex);
      expect(result.strings.length).toBeGreaterThan(0);
      expect(result.strings[0]).toHaveProperty('text');
      expect(result.strings[0].maxChars).toBeGreaterThan(0);
    });

    it('modifies an existing unicode string in-place and reads back the new value', () => {
      if (!ustrMapBuf || ustrIndex === -1) return;
      const copy = Buffer.from(ustrMapBuf);
      const original = readUnicodeStringList(copy, ustrMapHeader, ustrMapTagIndex, ustrIndex);
      const strIdx = original.strings.findIndex((s) => s.text.length > 0 && s.maxChars >= 6);
      expect(strIdx).toBeGreaterThan(-1);

      const testText = 'TEST99';
      writeUnicodeString(copy, ustrMapHeader, ustrMapTagIndex, ustrIndex, strIdx, testText);

      const updated = readUnicodeStringList(copy, ustrMapHeader, ustrMapTagIndex, ustrIndex);
      expect(updated.strings[strIdx].text).toBe(testText);
    });

    it('throws error when string exceeds allocated capacity', () => {
      if (!ustrMapBuf || ustrIndex === -1) return;
      const copy = Buffer.from(ustrMapBuf);
      const original = readUnicodeStringList(copy, ustrMapHeader, ustrMapTagIndex, ustrIndex);
      const strIdx = 0;
      const tooLong = 'A'.repeat(original.strings[strIdx].maxChars + 100);

      expect(() => writeUnicodeString(copy, ustrMapHeader, ustrMapTagIndex, ustrIndex, strIdx, tooLong)).toThrow(UnicodeStringEditorError);
    });
  });

  describe('Tag Renaming (renameTagInMap)', () => {
    it('renames a tag with shorter or equal name in-place', () => {
      if (!hasSampleMaps(SAMPLES)) return;
      const copy = Buffer.from(buf);
      const r = inspectCustomEditionMap(copy);
      const targetIdx = r.tagIndex.entries.findIndex((e) => e.path.length >= 20);
      const originalPath = r.tagIndex.entries[targetIdx].path;
      const newPath = originalPath.slice(0, 15);

      const result = renameTagInMap(copy, r.header, r.tagIndex, targetIdx, newPath);
      expect(result.path).toBe(newPath);

      const reInspected = inspectCustomEditionMap(copy);
      expect(reInspected.tagIndex.entries[targetIdx].path).toBe(newPath);
    });

    it('renames a tag with longer name by appending and updating path pointer', () => {
      if (!hasSampleMaps(SAMPLES)) return;
      const copy = Buffer.from(buf);
      const r = inspectCustomEditionMap(copy);
      const targetIdx = r.tagIndex.entries.findIndex((e) => e.primaryClassName === 'weapon');
      const originalPath = r.tagIndex.entries[targetIdx].path;
      const newPath = originalPath + '_extended_custom_suffix';

      const result = renameTagInMap(copy, r.header, r.tagIndex, targetIdx, newPath);
      expect(result.path).toBe(newPath);
      expect(result.buffer.length).toBeGreaterThan(copy.length);

      const reInspected = inspectCustomEditionMap(result.buffer);
      expect(reInspected.tagIndex.entries[targetIdx].path).toBe(newPath);
    });

    it('throws when renaming to empty or duplicate path', () => {
      if (!hasSampleMaps(SAMPLES)) return;
      const copy = Buffer.from(buf);
      const r = inspectCustomEditionMap(copy);
      expect(() => renameTagInMap(copy, r.header, r.tagIndex, 0, '')).toThrow(TagIndexEditorError);
      const sameClass = r.tagIndex.entries.find((e, idx) => idx !== 0 && e.primaryClassName === r.tagIndex.entries[0].primaryClassName);
      if (sameClass) {
        expect(() => renameTagInMap(copy, r.header, r.tagIndex, 0, sameClass.path)).toThrow(TagIndexEditorError);
      }
    });
  });

  describe('Tag Duplication (duplicateTagInMap)', () => {
    it('duplicates a tag assigning new index and 0xE1740000 salt tag ID', () => {
      if (!hasSampleMaps(SAMPLES)) return;
      const copy = Buffer.from(buf);
      const r = inspectCustomEditionMap(copy);
      const sourceIdx = r.tagIndex.entries.findIndex((e) => e.path === 'weapons\\assault rifle\\assault rifle');
      const newPath = 'weapons\\assault rifle\\assault rifle_clone';

      const result = duplicateTagInMap(copy, r.header, r.tagIndex, sourceIdx, newPath);
      expect(result.path).toBe(newPath);
      expect(result.newTagIndex).toBe(r.tagIndex.entries.length);
      expect(result.newTagId).toBe(computeNewTagId(result.newTagIndex));

      const reInspected = inspectCustomEditionMap(result.buffer);
      expect(reInspected.tagIndex.entries.length).toBe(r.tagIndex.entries.length + 1);
      const cloned = reInspected.tagIndex.entries[result.newTagIndex];
      expect(cloned.path).toBe(newPath);
      expect(cloned.tagId).toBe(result.newTagId);
      expect(cloned.primaryClassName).toBe('weapon');
    });
  });
});
