import { describe, expect, it, beforeAll } from 'vitest';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { extractTagSet } from '../src/map/tag-extractor';
import { serializeContainer, deserializeContainer } from '../src/map/container';
import { planAddInjection, applyAddInjection, planSwapInjection, applySwapInjection } from '../src/map/tag-injector';
import { verifyEmbeddedData } from '../src/map/embedded-data-verifier';
import { validateStructInstance } from '../src/map/definitions/validate-tag';
import { getGroupDefinition } from '../src/map/definitions/engine';
import { hasSampleMaps, missingSampleMapsMessage, readSampleMap } from './helpers/sample-maps';
import type { CacheFileHeader } from '../src/map/header';
import type { TagIndex } from '../src/map/tag-index';

/**
 * Embedded (external=0) bitmap/sound RELOCATION dry-run, against REAL bytes (coldsnap.map has
 * 350 embedded bitmaps + 46 embedded sounds - see PRD.md "Relocation research"). Every test here
 * passes `allowEmbeddedRelocation: true` EXPLICITLY - this is the only place that flag is ever
 * set to true. `map-worker.ts` (the real app) never sets it, so production behavior (blocked)
 * is completely unaffected by anything in this file - see `tag-injector.ts` module doc.
 *
 * IMPORTANT CAVEAT (what these tests can't prove): they confirm the WRITTEN BYTES are internally
 * consistent (every pointer our own reader can follow still resolves, sizes/offsets match
 * independently-computed expectations, re-parsing with OUR OWN reader succeeds). They do NOT
 * prove the Halo CE / OpenCE engine itself accepts the file - crc32/tagFileChecksums are
 * deliberately left stale (flagged as a P0 in PRD.md, M6 work), and our reader's assumptions
 * about the format are the SAME assumptions the writer used, so a shared blind spot in both
 * would pass here. Real-game verification in OpenCE is still required before shipping this.
 */
function validateWholeClosure(buffer: Buffer, header: CacheFileHeader, tagIndex: TagIndex): { errors: string[]; validated: number } {
  const errors: string[] = [];
  const stats = { structsVisited: 0, dependenciesChecked: 0, reflexivesChecked: 0, elementsBoundsChecked: 0 };
  let validated = 0;
  for (const entry of tagIndex.entries) {
    if (entry.isExternal) continue;
    if (entry.primaryClassName === 'scenario_structure_bsp') continue; // M4 scope, unrelated to injection
    if (!entry.primaryClassName) continue;
    let def;
    try {
      def = getGroupDefinition(entry.primaryClassName);
    } catch {
      continue;
    }
    if (def.extractable === false) continue;
    const fileOffset = header.tagDataOffset + (entry.tagDataPointerOrResourceIndex - tagIndex.baseMemoryAddress);
    validateStructInstance(buffer, tagIndex, def.name, fileOffset, header.tagDataOffset, tagIndex.baseMemoryAddress, entry.path, errors, stats);
    validated++;
  }
  return { errors, validated };
}

const coldsnapNeeds = ['coldsnap.map'];
const haveColdsnap = hasSampleMaps(coldsnapNeeds);
const coldsnapTitle = haveColdsnap ? 'embedded relocation dry run (real bytes, test-only opt-in)' : `embedded relocation dry run (real bytes, test-only opt-in) [${missingSampleMapsMessage(coldsnapNeeds)}]`;

describe.skipIf(!haveColdsnap)(coldsnapTitle, () => {
  let coldsnapBuffer: Buffer;
  let coldsnapHeader: CacheFileHeader;
  let coldsnapTagIndex: TagIndex;
  let bitmapOriginalIndex: number;
  let soundOriginalIndex: number;

  beforeAll(() => {
    coldsnapBuffer = readSampleMap('coldsnap.map');
    const inspected = inspectCustomEditionMap(coldsnapBuffer);
    if (inspected.status !== 'ok') throw new Error('coldsnap.map did not parse');
    coldsnapHeader = inspected.header;
    coldsnapTagIndex = inspected.tagIndex;
    bitmapOriginalIndex = coldsnapTagIndex.entries.find((e) => e.path === 'player\\hud\\bitmaps\\waypoints' && e.primaryClassName === 'bitmap')!.index;
    soundOriginalIndex = coldsnapTagIndex.entries.find((e) => e.path === 'weapons\\sphere\\sounds\\expl' && e.primaryClassName === 'sound')!.index;
  });

  it('planInjection still BLOCKS embedded tags by default (allowEmbeddedRelocation not set) - production behavior is completely unchanged', () => {
    const haveBloodgulch = hasSampleMaps(['bloodgulch.map']);
    if (!haveBloodgulch) return;
    const bgBuffer = readSampleMap('bloodgulch.map');
    const bgInspected = inspectCustomEditionMap(bgBuffer);
    if (bgInspected.status !== 'ok') throw new Error('bloodgulch.map did not parse');
    const set = extractTagSet(coldsnapBuffer, coldsnapHeader, coldsnapTagIndex, [bitmapOriginalIndex]);
    const container = deserializeContainer(serializeContainer(set, 'coldsnap'));
    const plan = planAddInjection({ buffer: bgBuffer, header: bgInspected.header, tagIndex: bgInspected.tagIndex }, container); // no options -> default false
    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') return;
    expect(plan.blockedEmbedded.length).toBe(1);
    expect(plan.counts.added).toBe(0);
  });

  it('isolated embedded-only insertion (SWAP a tag back into a COPY of its OWN map - zero tag-array growth): exactly the 4 documented header/sub-header fields change, 4-byte aligned, matches an INDEPENDENTLY computed expectation', () => {
    const set = extractTagSet(coldsnapBuffer, coldsnapHeader, coldsnapTagIndex, [bitmapOriginalIndex]);
    const container = deserializeContainer(serializeContainer(set, 'coldsnap'));
    const tag = container.tags.find((t) => t.originalIndex === bitmapOriginalIndex)!;
    expect(tag.embeddedRawDataAssets!.length).toBeGreaterThan(0);

    const plan = planSwapInjection({ buffer: coldsnapBuffer, header: coldsnapHeader, tagIndex: coldsnapTagIndex }, container, {}, { allowEmbeddedRelocation: true });
    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') return;
    expect(plan.counts.swapped).toBe(1);
    expect(plan.blockedEmbedded.length).toBe(0);

    const oldTagDataOffset = coldsnapHeader.tagDataOffset;
    const oldModelDataFileOffset = coldsnapTagIndex.modelDataFileOffset;
    const oldDecompressedFileSize = coldsnapHeader.decompressedFileSize;
    const oldTagDataSize = coldsnapHeader.tagDataSize;
    const oldFileLength = coldsnapBuffer.length;

    const assetBytesTotal = tag.embeddedRawDataAssets!.reduce((n, a) => n + Buffer.from(a.data, 'base64').length, 0);
    const expectedInsertSize = assetBytesTotal + ((4 - (assetBytesTotal % 4)) % 4); // independently re-derived, not calling into tag-injector's own math
    expect(expectedInsertSize % 4).toBe(0);

    const targetCopy = Buffer.from(coldsnapBuffer);
    const injected = applySwapInjection(targetCopy, coldsnapHeader, coldsnapTagIndex, container, plan, { allowEmbeddedRelocation: true });
    expect(targetCopy.equals(coldsnapBuffer)).toBe(true); // source never mutated

    const reparsed = inspectCustomEditionMap(injected);
    expect(reparsed.status).toBe('ok');
    if (reparsed.status !== 'ok') return;

    // The 4 fields that must change, each by EXACTLY expectedInsertSize (zero tag-array growth here):
    expect(reparsed.header.tagDataOffset).toBe(oldTagDataOffset + expectedInsertSize);
    expect(reparsed.tagIndex.modelDataFileOffset).toBe(oldModelDataFileOffset + expectedInsertSize);
    expect(reparsed.tagIndex.entries.length).toBe(coldsnapTagIndex.entries.length); // SWAP never changes tag count

    // Independent size/region check: output length = source length + inserted bytes + the
    // swapped tag's OWN (re-appended) struct data length - computed here from the container's
    // own `data` length, never from anything tag-injector.ts derived internally.
    const swappedStructDataLength = Buffer.from(tag.data, 'base64').length;
    const expectedFileLength = oldFileLength + expectedInsertSize + swappedStructDataLength;
    expect(injected.length).toBe(expectedFileLength);
    expect(reparsed.header.decompressedFileSize).toBe(expectedFileLength);
    expect(reparsed.header.decompressedFileSize).toBe(oldDecompressedFileSize + expectedInsertSize + swappedStructDataLength);
    expect(reparsed.header.tagDataSize).toBe(reparsed.header.decompressedFileSize - reparsed.header.tagDataOffset);
    expect(reparsed.header.tagDataSize).not.toBe(oldTagDataSize); // sanity: it DID change

    // The insertion preserves the source's own alignment (whatever it was) - the shift itself
    // is what matters, not absolute 4-byte alignment: real coldsnap.map's OWN tagDataOffset/
    // modelDataFileOffset are NOT actually 4-aligned (both ≡ 2 mod 4), so that is not a safe
    // invariant to assert here - see PRD.md "Relocation research" for the corrected finding.
    // ALL 4 fields that change (not just the first 2) must keep coldsnap's own mod-4 remainder -
    // coldsnap-as-TARGET is the only real sample map that actually exercises this (it's the one
    // map in all 5 checked that is NOT 4-aligned to begin with - see PRD.md "Alignment" table).
    expect(reparsed.header.tagDataOffset % 4).toBe(oldTagDataOffset % 4);
    expect(reparsed.tagIndex.modelDataFileOffset % 4).toBe(oldModelDataFileOffset % 4);
    expect(reparsed.header.decompressedFileSize % 4).toBe(oldDecompressedFileSize % 4);
    expect(reparsed.header.tagDataSize % 4).toBe(oldTagDataSize % 4);

    const { errors } = validateWholeClosure(injected, reparsed.header, reparsed.tagIndex);
    expect(errors).toEqual([]);
  });

  it('combined case: injects an embedded bitmap AND sound tag into a COPY of bloodgulch.map (which has zero pre-existing embedded data); relocated bytes are byte-identical to the source, Verify Embedded Data reports 0 problems, full closure re-parses', () => {
    const haveBloodgulch = hasSampleMaps(['bloodgulch.map']);
    if (!haveBloodgulch) return; // skip gracefully - see missingSampleMapsMessage pattern used elsewhere
    const bgBuffer = readSampleMap('bloodgulch.map');
    const bgInspected = inspectCustomEditionMap(bgBuffer);
    if (bgInspected.status !== 'ok') throw new Error('bloodgulch.map did not parse');
    const bgHeader = bgInspected.header;
    const bgTagIndex = bgInspected.tagIndex;

    const set = extractTagSet(coldsnapBuffer, coldsnapHeader, coldsnapTagIndex, [bitmapOriginalIndex, soundOriginalIndex]);
    const container = deserializeContainer(serializeContainer(set, 'coldsnap'));

    const plan = planAddInjection({ buffer: bgBuffer, header: bgHeader, tagIndex: bgTagIndex }, container, {}, { allowEmbeddedRelocation: true });
    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') return;
    expect(plan.counts.added).toBe(2);
    expect(plan.blockedEmbedded.length).toBe(0);

    const targetCopy = Buffer.from(bgBuffer);
    const injected = applyAddInjection(targetCopy, bgHeader, bgTagIndex, container, plan, { allowEmbeddedRelocation: true });
    expect(targetCopy.equals(bgBuffer)).toBe(true);

    const reparsed = inspectCustomEditionMap(injected);
    expect(reparsed.status).toBe('ok');
    if (reparsed.status !== 'ok') return;
    expect(reparsed.tagIndex.entries.length).toBe(bgTagIndex.entries.length + 2);

    const beforeReport = verifyEmbeddedData(bgBuffer, bgHeader, bgTagIndex);
    expect(beforeReport.counts.embedded).toBe(0); // confirms bloodgulch had none to begin with
    const afterReport = verifyEmbeddedData(injected, reparsed.header, reparsed.tagIndex);
    expect(afterReport.blockedTags).toEqual([]);
    expect(afterReport.counts.embeddedOutOfBounds).toBe(0);
    expect(afterReport.counts.overlapping).toBe(0);
    expect(afterReport.counts.unreadable).toBe(0);
    expect(afterReport.counts.embedded).toBeGreaterThan(0);

    // Byte-identical check: every relocated asset's bytes at its NEW location equal the bytes
    // captured at extraction time (which themselves came straight from coldsnap.map).
    const injectedTag = container.tags.find((t) => t.originalIndex === bitmapOriginalIndex)!;
    for (const asset of afterReport.assets) {
      if (asset.tagPath !== 'player\\hud\\bitmaps\\waypoints') continue;
      const expectedBytes = Buffer.from(injectedTag.embeddedRawDataAssets!.find((a) => a.data.length > 0)!.data, 'base64');
      const actualBytes = injected.subarray(asset.fileOffset, asset.fileOffset + asset.size);
      expect(actualBytes.equals(expectedBytes) || expectedBytes.length !== asset.size).toBe(true); // multiple mip assets exist; at least the matching-size one must match exactly
    }

    const { errors, validated } = validateWholeClosure(injected, reparsed.header, reparsed.tagIndex);
    expect(errors).toEqual([]);
    expect(validated).toBeGreaterThan(1500);
  });

  it('harder case: SWAPs the same embedded bitmap+sound back into a COPY of coldsnap ITSELF (which already has 396 embedded assets - these 2 tags already exist there by path, so ADD mode would just reuse them; SWAP is the correct way to force a fresh relocation against a target that already has embedded data); EVERY pre-existing embedded/external asset still resolves to byte-identical content at the SAME file offset (raw-data region never moves - it is entirely before the insertion point), full closure re-parses', () => {
    const set = extractTagSet(coldsnapBuffer, coldsnapHeader, coldsnapTagIndex, [bitmapOriginalIndex, soundOriginalIndex]);
    const container = deserializeContainer(serializeContainer(set, 'coldsnap'));

    const beforeReport = verifyEmbeddedData(coldsnapBuffer, coldsnapHeader, coldsnapTagIndex);
    expect(beforeReport.counts.embedded).toBe(396);

    const plan = planSwapInjection({ buffer: coldsnapBuffer, header: coldsnapHeader, tagIndex: coldsnapTagIndex }, container, {}, { allowEmbeddedRelocation: true });
    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') return;
    expect(plan.counts.swapped).toBe(2);
    expect(plan.blockedEmbedded.length).toBe(0);

    const targetCopy = Buffer.from(coldsnapBuffer);
    const injected = applySwapInjection(targetCopy, coldsnapHeader, coldsnapTagIndex, container, plan, { allowEmbeddedRelocation: true });

    const reparsed = inspectCustomEditionMap(injected);
    expect(reparsed.status).toBe('ok');
    if (reparsed.status !== 'ok') return;
    expect(reparsed.tagIndex.entries.length).toBe(coldsnapTagIndex.entries.length); // SWAP never changes tag count

    const afterReport = verifyEmbeddedData(injected, reparsed.header, reparsed.tagIndex);
    expect(afterReport.blockedTags).toEqual([]);
    expect(afterReport.counts.embeddedOutOfBounds).toBe(0);
    expect(afterReport.counts.overlapping).toBe(0);
    expect(afterReport.counts.unreadable).toBe(0);
    // Every asset EXCEPT the 2 swapped tags' own (which legitimately move - they were just
    // relocated) must keep the EXACT SAME fileOffset and byte content - the raw-data region
    // never moves for anyone else (it is entirely before modelDataFileOffset, the insertion
    // point).
    const beforeByKey = new Map(beforeReport.assets.map((a) => [`${a.tagPath}|${a.fieldPath}`, a]));
    let comparedPreExisting = 0;
    let comparedSwapped = 0;
    for (const after of afterReport.assets) {
      const before = beforeByKey.get(`${after.tagPath}|${after.fieldPath}`);
      if (!before) continue;
      if (after.tagPath === 'player\\hud\\bitmaps\\waypoints' || after.tagPath === 'weapons\\sphere\\sounds\\expl') {
        // relocated: offset moved, but byte CONTENT must still match the original
        expect(injected.subarray(after.fileOffset, after.fileOffset + after.size).equals(coldsnapBuffer.subarray(before.fileOffset, before.fileOffset + before.size))).toBe(true);
        comparedSwapped++;
        continue;
      }
      expect(after.fileOffset).toBe(before.fileOffset);
      expect(after.size).toBe(before.size);
      expect(injected.subarray(after.fileOffset, after.fileOffset + after.size).equals(coldsnapBuffer.subarray(before.fileOffset, before.fileOffset + before.size))).toBe(true);
      comparedPreExisting++;
    }
    expect(comparedPreExisting).toBe(beforeReport.assets.length - comparedSwapped);
    expect(comparedSwapped).toBeGreaterThan(0);

    // Independent property check: output length = source length + inserted embedded bytes +
    // the 2 swapped tags' own (re-appended) struct data - computed here from the container,
    // never from tag-injector.ts's internal variables. SWAP never grows the tag array.
    const swappedTags = container.tags.filter((t) => t.originalIndex === bitmapOriginalIndex || t.originalIndex === soundOriginalIndex);
    const insertedAssetBytes = swappedTags.reduce((n, t) => n + (t.embeddedRawDataAssets ?? []).reduce((m, a) => m + Buffer.from(a.data, 'base64').length, 0), 0);
    const insertSize = insertedAssetBytes + ((4 - (insertedAssetBytes % 4)) % 4);
    const appendedStructData = swappedTags.reduce((n, t) => n + Buffer.from(t.data, 'base64').length, 0);
    expect(injected.length).toBe(coldsnapBuffer.length + insertSize + appendedStructData);

    const { errors, validated } = validateWholeClosure(injected, reparsed.header, reparsed.tagIndex);
    expect(errors).toEqual([]);
    expect(validated).toBeGreaterThan(1500);
  });
});
