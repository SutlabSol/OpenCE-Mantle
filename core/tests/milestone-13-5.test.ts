import { describe, expect, it } from 'vitest';
import {
  ceCrcRegions,
  computeCacheCrc32,
  computeCrc32Compensation,
  spoofCacheCrc32,
} from '../src/map/cache-crc';
import {
  deprotectAndRepairMap,
  inspectMapProtectionAndIntegrity,
  repairCorruptedModelPartStrips,
  repairTruncatedBitmapMipmaps,
} from '../src/map/deprotect';
import { checkDrawableBitmaps } from '../src/map/convert/bitmap-check';
import { checkModelParts } from '../src/map/convert/model-part-check';
import { normalizeDemoMap } from '../src/map/convert/demo-to-ce';
import { parseCacheFileHeader } from '../src/map/header';
import { parseTagIndex, resolveTagDataPointer } from '../src/map/tag-index';
import { readTagFieldValues, writeTagFieldValue } from '../src/map/tag-field-editor';
import { TAG_DATA_HEADER_PC_SIZE, TAG_ENTRY_SIZE } from '../src/constants/cache-file';
import { TAG_CLASS_NONE } from '../src/constants/tag-classes';
import { readSampleMap, sampleIn, skippableTest } from './helpers/sample-maps';
import { MACDEMO } from './helpers/demo-map';

describe('Milestone 13.5 — MEK Bug-Fix, Deprotection & Integrity Suite', () => {
  const bgGate = skippableTest(['bloodgulch.map']);

  it.skipIf(bgGate.skip)(`Algebraic GF(2) CRC32 Spoofer matches arbitrary target CRC32 on bloodgulch.map${bgGate.titleSuffix}`, () => {
    const raw = readSampleMap('bloodgulch.map');
    const header = parseCacheFileHeader(raw);
    const tagIndex = parseTagIndex(raw, header);

    const targets = [0xdeadbeef, 0x12345678, 0x00000000, 0xffffffff, header.crc32 >>> 0];
    for (const target of targets) {
      const spoofed = spoofCacheCrc32(raw, header, tagIndex, target);
      const actualCrc = computeCacheCrc32(spoofed.buffer, ceCrcRegions(spoofed.buffer, spoofed.header, spoofed.tagIndex));
      expect(actualCrc >>> 0).toBe(target >>> 0);
      expect(spoofed.header.crc32 >>> 0).toBe(target >>> 0);
      expect(spoofed.buffer.readUInt32LE(0x64) >>> 0).toBe(target >>> 0);
      expect(computeCrc32Compensation(raw, header, tagIndex, target) >>> 0).toBe(spoofed.compensationWord >>> 0);
    }
  });

  it.skipIf(bgGate.skip)(`3-Stage Deprotector repairs wiped tag classes and <protected> tag paths on bloodgulch.map${bgGate.titleSuffix}`, () => {
    const raw = Buffer.from(readSampleMap('bloodgulch.map'));
    const header = parseCacheFileHeader(raw);
    const tagIndex = parseTagIndex(raw, header);

    // Corrupt 5 tag classes and paths to simulate HEK+ / ZTeam map protection
    const corruptedIndices = [0, 1, 2, 10, 25].filter((i) => i < tagIndex.entries.length);
    const originalClasses = corruptedIndices.map((i) => tagIndex.entries[i].primaryClassName);

    for (const idx of corruptedIndices) {
      const entryOff = header.tagDataOffset + TAG_DATA_HEADER_PC_SIZE + idx * TAG_ENTRY_SIZE;
      // Spoof primary/secondary/tertiary FourCCs in buffer and tagIndex
      raw.writeUInt32LE(0x3f3f3f3f, entryOff + 0x00); // '????'
      raw.writeUInt32LE(TAG_CLASS_NONE, entryOff + 0x04);
      raw.writeUInt32LE(TAG_CLASS_NONE, entryOff + 0x08);
      tagIndex.entries[idx].primaryClassFourCC = 0x3f3f3f3f;
      tagIndex.entries[idx].primaryClassName = null;
      tagIndex.entries[idx].path = '<protected>';
    }

    const inspection = inspectMapProtectionAndIntegrity(raw, header, tagIndex);
    expect(inspection.protectedClassCount).toBeGreaterThanOrEqual(corruptedIndices.length);
    expect(inspection.protectedNameCount).toBeGreaterThanOrEqual(corruptedIndices.length);

    const result = deprotectAndRepairMap(raw, header, tagIndex, {
      repairClasses: true,
      scrapeScriptPaths: true,
      heuristicRename: true,
      repairBitmaps: false,
      repairModelStrips: false,
    });

    expect(result.classesRepaired).toBeGreaterThanOrEqual(corruptedIndices.length);
    expect(result.heuristicPathsRenamed + result.scriptPathsRecovered).toBeGreaterThanOrEqual(corruptedIndices.length);

    for (let k = 0; k < corruptedIndices.length; k++) {
      const idx = corruptedIndices[k];
      expect(result.tagIndex.entries[idx].primaryClassName).toBe(originalClasses[k]);
      expect(result.tagIndex.entries[idx].path).not.toBe('<protected>');
    }
  });

  const tiGate = skippableTest([MACDEMO.trueInfection]);
  it.skipIf(tiGate.skip)(`repairTruncatedBitmapMipmaps fixes TrueInfectionV2 #3849 truncated mipmap count${tiGate.titleSuffix}`, () => {
    const source = readSampleMap(MACDEMO.trueInfection);
    const norm = normalizeDemoMap(source);
    expect(norm.ok).toBe(true);
    if (!norm.ok) return;
    const view = Buffer.from(norm.value.buffer);
    view.writeUInt32LE(609, 4);
    const header = parseCacheFileHeader(view);
    const tagIndex = parseTagIndex(view, header);

    // Before repair: 1 bitmap problem (#3849)
    const before = checkDrawableBitmaps(view, header, tagIndex, { ignoreExternalBit: true });
    expect(before.problems.length).toBe(1);
    expect(before.problems[0].tagIndex).toBe(3849);

    const repaired = repairTruncatedBitmapMipmaps(view, header, tagIndex);
    expect(repaired.bitmapsRepaired).toBe(1);

    // After repair: 0 bitmap problems!
    const after = checkDrawableBitmaps(view, header, tagIndex, { ignoreExternalBit: true });
    expect(after.problems).toEqual([]);
  });

  const islandFile = sampleIn('haloMD', 'theisland_3.map');
  const islandGate = skippableTest([islandFile]);
  it.skipIf(islandGate.skip)(`repairCorruptedModelPartStrips fixes theisland_3 #2574 out-of-range strip indices${islandGate.titleSuffix}`, () => {
    const view = Buffer.from(readSampleMap(islandFile));
    view.writeUInt32LE(609, 4);
    const header = parseCacheFileHeader(view);
    const tagIndex = parseTagIndex(view, header);

    // Before repair: 2 part problems on #2574
    const before = checkModelParts(view, header, tagIndex);
    expect(before.problems.length).toBe(2);
    expect(before.problems[0].tagIndex).toBe(2574);

    const repaired = repairCorruptedModelPartStrips(view, header, tagIndex);
    expect(repaired.modelPartsRepaired).toBe(2);
    expect(repaired.stripIndicesClamped).toBe(35);

    // After repair: 0 model part problems!
    const after = checkModelParts(view, header, tagIndex);
    expect(after.problems).toEqual([]);
  });

  it.skipIf(bgGate.skip)(`postprocessTagFields recalculates WeaponTrigger cacheOnly rate fields on writeTagFieldValue${bgGate.titleSuffix}`, () => {
    const raw = Buffer.from(readSampleMap('bloodgulch.map'));
    const header = parseCacheFileHeader(raw);
    const tagIndex = parseTagIndex(raw, header);

    const weapEntry = tagIndex.entries.find((e) => e.primaryClassName === 'weapon' && !e.isExternal);
    expect(weapEntry).toBeDefined();
    if (!weapEntry) return;

    // Write `triggers[0].acceleration time` = 2.0 seconds -> `firing acceleration rate` should become 1 / (30 * 2.0) = 1/60
    writeTagFieldValue(raw, header, tagIndex, weapEntry.index, 'triggers[0].acceleration time', 2.0);
    const decoded = readTagFieldValues(raw, header, tagIndex, weapEntry.index);
    const triggersField = decoded.fields.find((f) => f.name === 'triggers');
    const trig0 = triggersField?.children?.[0];
    const rateField = trig0?.fields.find((f) => f.name === 'firing acceleration rate');
    expect(Number(rateField?.value)).toBeCloseTo(1 / 60, 5);
  });
});
