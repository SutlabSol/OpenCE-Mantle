import {
  CACHE_FILE_HEADER_SIZE,
  CacheFileEngine,
  CacheFileLiteral,
  CE_BASE_MEMORY_ADDRESS,
  CE_TAG_ARRAY_ADDRESS,
  CE_TAG_SPACE_SIZE,
  MCC_BASE_MEMORY_ADDRESS,
  MCC_TAG_ARRAY_ADDRESS,
  TAG_DATA_HEADER_PC_SIZE,
  TAG_ENTRY_SIZE,
  TAG_STRING_SIZE,
} from '../../constants/cache-file';
import { fourCCToString, lookupTagClass } from '../../constants/tag-classes';
import { readFixedString, writeFixedString } from '../../binary/strings';
import { BSP_SPACE_POINTER_KINDS, collectBspSpacePointers, collectTagDataPointers, TAG_DATA_POINTER_KINDS, UnwalkableTagError } from '../pointer-rebase';
import type { BspSpacePointerKind, TagDataLayout, TagDataPointerKind, ToleratedPointer } from '../pointer-rebase';
import { classifyMapLayout } from './classify';
import { ConversionRefusedError, convertRetailLayoutCopy, preflightRetailLayoutCopy } from './retail-to-ce';
import type { ConversionCheck, ConversionResourceFiles, RetailConversionOptions, RetailConversionReport, RetailConversionResult } from './retail-to-ce';

/**
 * Converter Phase 2: true demo layout maps (Mac demo: 'Ehed' at 0x2C0, cache version 6 at 0x588, tag
 * data at 0x4BF10000) and MCC CEA maps (cache version 13 at 0x04, tag data at 0x50000000) -> Custom Edition (609).
 */

/** Where the true demo layout loads its tag data (Invader `gbx-demo`; every MacDemo map's tag array is at this + 0x28). */
export const DEMO_BASE_MEMORY_ADDRESS = 0x4bf10000;
/** Every pointer of the tag space moves by this (-0x0BAD0000). */
export const DEMO_TO_CE_DELTA = CE_BASE_MEMORY_ADDRESS - DEMO_BASE_MEMORY_ADDRESS;
/** Every pointer of an MCC map's tag space moves by this (0x40440000 - 0x50000000 = -0x0FBC0000). */
export const MCC_TO_CE_DELTA = CE_BASE_MEMORY_ADDRESS - MCC_BASE_MEMORY_ADDRESS;

/** Demo header fields (memory/demo-converter.md; tag data offset measured at 0x5EC, not the PDF's 0x10). */
const DEMO = {
  scenarioType: 0x2,
  head: 0x2c0,
  tagDataSize: 0x2c4,
  buildString: 0x2c8,
  version: 0x588,
  scenarioName: 0x58c,
  crc32: 0x5b0,
  fileSize: 0x5e8,
  tagDataOffset: 0x5ec,
  foot: 0x5f0,
} as const;

/** Standard header fields written to the retail-layout copy (as in `header.ts`). */
const STD = { head: 0x0, version: 0x4, fileSize: 0x8, padding: 0xc, tagDataOffset: 0x10, tagDataSize: 0x14, scenarioName: 0x20, buildString: 0x40, scenarioType: 0x60, crc32: 0x64, foot: 0x7fc } as const;

export interface DemoHeader {
  version: number;
  scenarioType: number;
  /** Read up to the first 0 byte (the bytes after it are left-over garbage in every MacDemo mod). */
  scenarioName: string;
  buildString: string;
  crc32: number;
  fileSize: number;
  tagDataOffset: number;
  tagDataSize: number;
}

/** The demo header's fields, or null when the buffer has no 'Ehed' / 'Gfot' header. Reads the first 2048 bytes only. */
export function readDemoHeader(buffer: Buffer): DemoHeader | null {
  if (buffer.length < CACHE_FILE_HEADER_SIZE) return null;
  if (buffer.readUInt32LE(DEMO.head) !== CacheFileLiteral.HEAD_DEMO || buffer.readUInt32LE(DEMO.foot) !== CacheFileLiteral.FOOT_DEMO) return null;
  return {
    version: buffer.readUInt32LE(DEMO.version),
    scenarioType: buffer.readUInt16LE(DEMO.scenarioType),
    scenarioName: readFixedString(buffer, DEMO.scenarioName, TAG_STRING_SIZE),
    buildString: readFixedString(buffer, DEMO.buildString, TAG_STRING_SIZE),
    crc32: buffer.readUInt32LE(DEMO.crc32),
    fileSize: buffer.readUInt32LE(DEMO.fileSize),
    tagDataOffset: buffer.readUInt32LE(DEMO.tagDataOffset),
    tagDataSize: buffer.readUInt32LE(DEMO.tagDataSize),
  };
}

export type DemoPointerKind = TagDataPointerKind | BspSpacePointerKind;

export interface DemoNormalization {
  /** The retail-layout copy (standard header, version 7, tag space at 0x40440000). A new buffer; the source is never changed. */
  buffer: Buffer;
  header: DemoHeader;
  /** Pointers moved, per kind (each by `DEMO_TO_CE_DELTA`). */
  moved: Record<DemoPointerKind, number>;
  /** Known-bad pointers left as they are (stale reference paths outside the tag data, roots outside the tag data). */
  tolerated: ToleratedPointer[];
}

export type DemoNormalizationResult = { ok: true; value: DemoNormalization; rows: ConversionCheck[] } | { ok: false; rows: ConversionCheck[] };

const hex = (n: number) => `0x${(n >>> 0).toString(16).toUpperCase()}`;
const LAYOUT_LABEL = 'Original Halo demo map (cache version 6)';
const MCC_LAYOUT_LABEL = 'MCC Halo 1 map (cache version 13)';
const REBASE_LABEL = 'Tag data moves to the Custom Edition address';

function row(id: ConversionCheck['id'], label: string, status: ConversionCheck['status'], message: string, details: string[] = []): ConversionCheck {
  return { id, label, status, message, details: details.slice(0, 50), requiresAcknowledgement: false };
}

/**
 * Normalizes an MCC Halo 1 (`engine === 13`, `0x50000000`) map into a retail-layout copy in memory:
 * 1. Swaps each Structure BSP's preceding vertex pool with the BSP body so the vertex pool sits inside
 *    the BSP region after the BSP structs, and populates `uncompressed vertices` (`+0xD8`, `+0xE4`)
 *    on every `ScenarioStructureBSPMaterial`.
 * 2. Rebases all tag-data and BSP-space pointers from `0x50000000` to `0x40440000`.
 */
export function normalizeMccMap(source: Buffer): DemoNormalizationResult {
  const refuse = (id: 'demoLayout' | 'demoRebase', message: string, details: string[] = [], earlier: ConversionCheck[] = []): DemoNormalizationResult => ({
    ok: false,
    rows: [...earlier, row(id, id === 'demoLayout' ? MCC_LAYOUT_LABEL : REBASE_LABEL, 'refuse', message, details)],
  });
  const layout = classifyMapLayout(source);
  if (layout.kind !== 'mcc') {
    return refuse('demoLayout', 'This is not an MCC Halo 1 map (cache version 13).');
  }
  const header: DemoHeader = {
    version: source.readUInt32LE(STD.version),
    scenarioType: source.readUInt16LE(STD.scenarioType),
    scenarioName: readFixedString(source, STD.scenarioName, TAG_STRING_SIZE),
    buildString: readFixedString(source, STD.buildString, TAG_STRING_SIZE),
    crc32: source.readUInt32LE(STD.crc32),
    fileSize: source.readUInt32LE(STD.fileSize),
    tagDataOffset: source.readUInt32LE(STD.tagDataOffset),
    tagDataSize: source.readUInt32LE(STD.tagDataSize),
  };
  if (header.fileSize !== source.length) {
    return refuse('demoLayout', `The header says ${header.fileSize} bytes but the file has ${source.length}.`);
  }
  const { tagDataOffset: tdo, tagDataSize: tds } = header;
  if (tdo < CACHE_FILE_HEADER_SIZE || tds < TAG_DATA_HEADER_PC_SIZE || tdo + tds > source.length) {
    return refuse('demoLayout', `The tag data (file offset ${tdo}, ${tds} bytes) is not inside the file.`);
  }
  const arrayPointer = source.readUInt32LE(tdo);
  if (arrayPointer !== MCC_TAG_ARRAY_ADDRESS) {
    return refuse('demoLayout', `The tag array pointer is ${hex(arrayPointer)}, not ${hex(MCC_TAG_ARRAY_ADDRESS)}.`);
  }
  const tagCount = source.readUInt32LE(tdo + 0xc);
  if (TAG_DATA_HEADER_PC_SIZE + tagCount * TAG_ENTRY_SIZE > tds) {
    return refuse('demoLayout', `The tag array (${tagCount} tags) doesn't fit in the tag data.`);
  }
  const layoutRow = row(
    'demoLayout',
    MCC_LAYOUT_LABEL,
    'pass',
    `Standard header, cache version 13 (MCC CEA), build ${header.buildString}, ${tagCount} tags at ${hex(MCC_BASE_MEMORY_ADDRESS)}. BSP vertex pools are folded into each BSP block and the tag data is rebased to the Custom Edition address.`,
  );

  const copy = Buffer.from(source);
  const arrayAt = tdo + TAG_DATA_HEADER_PC_SIZE;
  const scenarioTagId = copy.readUInt32LE(tdo + 0x4);
  const scnrIdx = scenarioTagId & 0xffff;
  const scnrEntryAt = arrayAt + scnrIdx * TAG_ENTRY_SIZE;
  const scnrPtr = copy.readUInt32LE(scnrEntryAt + 0x14);
  const scnrOff = tdo + (scnrPtr - MCC_BASE_MEMORY_ADDRESS);
  if (scnrOff >= tdo && scnrOff + 0x5b0 <= copy.length) {
    const bspCount = copy.readInt32LE(scnrOff + 0x5a4);
    const bspPtr = copy.readUInt32LE(scnrOff + 0x5a8);
    const bspBase = tdo + (bspPtr - MCC_BASE_MEMORY_ADDRESS);
    let prevOriginalBspEnd = CACHE_FILE_HEADER_SIZE;
    for (let i = 0; i < bspCount; i++) {
      const bEntryOff = bspBase + i * 32;
      if (bEntryOff + 32 > copy.length) break;
      const oldBspStart = copy.readUInt32LE(bEntryOff + 0x00);
      const oldBspSize = copy.readUInt32LE(bEntryOff + 0x04);
      const oldBspAddr = copy.readUInt32LE(bEntryOff + 0x08);
      const vertPoolOff = prevOriginalBspEnd;
      const vertPoolSize = oldBspStart - vertPoolOff;
      prevOriginalBspEnd = oldBspStart + oldBspSize;

      if (vertPoolSize >= 0 && oldBspStart + oldBspSize <= copy.length) {
        const vertPoolBuf = Buffer.from(copy.subarray(vertPoolOff, oldBspStart));
        const bspBodyBuf = Buffer.from(copy.subarray(oldBspStart, oldBspStart + oldBspSize));
        bspBodyBuf.copy(copy, vertPoolOff);
        vertPoolBuf.copy(copy, vertPoolOff + oldBspSize);

        const newBspStart = vertPoolOff;
        const newBspSize = oldBspSize + vertPoolSize;
        copy.writeUInt32LE(newBspStart >>> 0, bEntryOff + 0x00);
        copy.writeUInt32LE(newBspSize >>> 0, bEntryOff + 0x04);

        copy.writeUInt32LE(0, newBspStart + 0x04);
        copy.writeUInt32LE(0, newBspStart + 0x08);

        const sbspHeaderPtr = copy.readUInt32LE(newBspStart + 0x00);
        const sbspOff = newBspStart + (sbspHeaderPtr - oldBspAddr);
        if (sbspOff >= newBspStart && sbspOff + 0x124 <= newBspStart + newBspSize) {
          const lmCount = copy.readInt32LE(sbspOff + 0x118);
          const lmPtr = copy.readUInt32LE(sbspOff + 0x11c);
          const lmBase = newBspStart + (lmPtr - oldBspAddr);
          for (let l = 0; l < lmCount; l++) {
            const lmEntry = lmBase + l * 32;
            if (lmEntry + 32 > newBspStart + newBspSize) break;
            const matCount = copy.readInt32LE(lmEntry + 0x14);
            const matPtr = copy.readUInt32LE(lmEntry + 0x18);
            const matBase = newBspStart + (matPtr - oldBspAddr);
            for (let m = 0; m < matCount; m++) {
              const matOff = matBase + m * 256;
              if (matOff + 256 > newBspStart + newBspSize) break;
              const vCount = copy.readUInt32LE(matOff + 0xb8);
              const rvOff = copy.readUInt32LE(matOff + 0xbc);
              const lmvCount = copy.readUInt32LE(matOff + 0xc4);
              const totalVertBytes = vCount * 56 + lmvCount * 20;
              const vertAddr = (oldBspAddr + oldBspSize + rvOff) >>> 0;
              copy.writeUInt32LE(totalVertBytes >>> 0, matOff + 0xd8);
              copy.writeUInt32LE(0, matOff + 0xdc);
              copy.writeUInt32LE(0, matOff + 0xe0);
              copy.writeUInt32LE(vertAddr, matOff + 0xe4);
            }
          }
        }
      }
    }
  }

  const entries: TagDataLayout['entries'][number][] = [];
  for (let i = 0; i < tagCount; i++) {
    const at = arrayAt + i * TAG_ENTRY_SIZE;
    const fourcc = copy.readUInt32LE(at);
    const isExt = copy.readUInt32LE(at + 0x18) === 1;
    // Clear MCC bit 9 (0x200) on embedded BitmapData flags (+0x0e) so OpenCE's bitmap_verify accepts them
    if (fourcc === 0x6269746d && !isExt) {
      const bitmStructAt = tdo + ((copy.readUInt32LE(at + 0x14) - MCC_BASE_MEMORY_ADDRESS) | 0);
      if (bitmStructAt >= tdo && bitmStructAt + 0x68 <= copy.length) {
        const bCount = copy.readUInt32LE(bitmStructAt + 0x60);
        const bPtr = copy.readUInt32LE(bitmStructAt + 0x64);
        const bArrAt = tdo + ((bPtr - MCC_BASE_MEMORY_ADDRESS) | 0);
        if (bCount > 0 && bCount < 4096 && bArrAt >= tdo && bArrAt + bCount * 48 <= copy.length) {
          for (let b = 0; b < bCount; b++) {
            const bOff = bArrAt + b * 48;
            const rawFlags = copy.readUInt16LE(bOff + 0x0e);
            if ((rawFlags & ~0x1ff) !== 0) {
              copy.writeUInt16LE(rawFlags & 0x1ff, bOff + 0x0e);
            }
          }
        }
      }
    }
    const pathAt = tdo + ((copy.readUInt32LE(at + 0x10) - MCC_BASE_MEMORY_ADDRESS) | 0);
    entries.push({
      index: i,
      path: pathAt >= tdo && pathAt < tdo + tds ? readCStringWithin(copy, pathAt, tdo + tds) : `(tag #${i})`,
      primaryClassName: i === (scenarioTagId & 0xffff) && copy.readUInt32LE(at + 0xc) === scenarioTagId ? 'scenario' : (lookupTagClass(fourcc)?.name ?? fourCCToString(fourcc)),
      isExternal: isExt,
    });
  }

  const tagLayout: TagDataLayout = { tagDataOffset: tdo, tagDataSize: tds, baseMemoryAddress: MCC_BASE_MEMORY_ADDRESS, tagArrayFileOffset: arrayAt, entries };
  const tolerated: ToleratedPointer[] = [];
  const tolerate = { staleReferencePaths: true, rootsOutsideTagData: true };
  let sites: { kind: DemoPointerKind; at: number; value: number; tagIndex: number }[];
  try {
    sites = [...collectTagDataPointers(copy, tagLayout, { tolerate, tolerated }), ...collectBspSpacePointers(copy, tagLayout, { tolerate })];
  } catch (err) {
    if (!(err instanceof UnwalkableTagError)) throw err;
    return refuse('demoRebase', `The tag data can't be moved: ${err.message}`, [], [layoutRow]);
  }

  const moved = Object.fromEntries([...TAG_DATA_POINTER_KINDS, ...BSP_SPACE_POINTER_KINDS].map((k) => [k, 0])) as Record<DemoPointerKind, number>;
  for (const s of sites) {
    copy.writeUInt32LE((s.value + MCC_TO_CE_DELTA) >>> 0, s.at);
    moved[s.kind]++;
  }
  copy.writeUInt32LE(CE_TAG_ARRAY_ADDRESS, tdo);
  copy.writeUInt32LE(CacheFileEngine.RETAIL, STD.version);
  copy.writeUInt32LE(0, STD.padding);

  const total = sites.length;
  const rebaseRow = row(
    'demoRebase',
    REBASE_LABEL,
    'pass',
    `${total.toLocaleString('en-US')} pointers move from ${hex(MCC_BASE_MEMORY_ADDRESS)} to ${hex(CE_BASE_MEMORY_ADDRESS)}, found by walking every tag and structure BSP with the tag definitions.`,
    [
      ...Object.entries(moved)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k}: ${n.toLocaleString('en-US')}`),
      ...(tolerated.length > 0 ? [`${tolerated.length} stale pointer(s) outside the tag data are left as they are.`] : []),
    ],
  );
  return { ok: true, value: { buffer: copy, header, moved, tolerated }, rows: [layoutRow, rebaseRow] };
}

/**
 * Makes the retail-layout copy of a true demo map. Never throws for a malformed map: a problem is a
 * refusing row. Refused: not the demo layout or not version 6; file size or regions that don't match
 * the file; a tag array not at 0x4BF10028; a tag or BSP that can't be walked completely (the reason
 * names it); a pointer outside the demo tag space.
 */
export function normalizeDemoMap(source: Buffer): DemoNormalizationResult {
  if (classifyMapLayout(source).kind === 'mcc') {
    return normalizeMccMap(source);
  }
  const refuse = (id: 'demoLayout' | 'demoRebase', message: string, details: string[] = [], earlier: ConversionCheck[] = []): DemoNormalizationResult => ({
    ok: false,
    rows: [...earlier, row(id, id === 'demoLayout' ? LAYOUT_LABEL : REBASE_LABEL, 'refuse', message, details)],
  });
  const layout = classifyMapLayout(source);
  const header = readDemoHeader(source);
  if (layout.kind !== 'demo' || !header) return refuse('demoLayout', "This is not an original Halo demo map ('Ehed' header at 0x2C0).");
  if (header.version !== CacheFileEngine.DEMO) return refuse('demoLayout', `The demo header's cache version is ${header.version}; only version 6 can be converted.`);
  if (header.fileSize !== source.length) return refuse('demoLayout', `The header says ${header.fileSize} bytes but the file has ${source.length}. The file may be truncated or modified.`);
  const { tagDataOffset: tdo, tagDataSize: tds } = header;
  if (tdo < CACHE_FILE_HEADER_SIZE || tds < TAG_DATA_HEADER_PC_SIZE || tdo + tds > source.length) return refuse('demoLayout', `The tag data (file offset ${tdo}, ${tds} bytes) is not inside the file.`);
  if (header.scenarioType > 2) return refuse('demoLayout', `The scenario type is ${header.scenarioType}; only 0 (campaign), 1 (multiplayer) and 2 (main menu) exist.`);
  const arrayPointer = source.readUInt32LE(tdo);
  if (arrayPointer !== DEMO_BASE_MEMORY_ADDRESS + TAG_DATA_HEADER_PC_SIZE) {
    return refuse('demoLayout', `The tag array pointer is ${hex(arrayPointer)}, not ${hex(DEMO_BASE_MEMORY_ADDRESS + TAG_DATA_HEADER_PC_SIZE)} (the demo address), so the tag data's base is not known.`);
  }
  const tagCount = source.readUInt32LE(tdo + 0xc);
  if (TAG_DATA_HEADER_PC_SIZE + tagCount * TAG_ENTRY_SIZE > tds) return refuse('demoLayout', `The tag array (${tagCount} tags) doesn't fit in the tag data.`);
  const layoutRow = row(
    'demoLayout',
    LAYOUT_LABEL,
    'pass',
    `'Ehed' header, cache version 6, build ${header.buildString}, ${tagCount} tags at ${hex(DEMO_BASE_MEMORY_ADDRESS)}. A standard header is made from its fields and the tag data is moved to the Custom Edition address; file offsets don't change.`,
  );

  const arrayAt = tdo + TAG_DATA_HEADER_PC_SIZE;
  const scenarioTagId = source.readUInt32LE(tdo + 0x4);
  const entries: TagDataLayout['entries'][number][] = [];
  for (let i = 0; i < tagCount; i++) {
    const at = arrayAt + i * TAG_ENTRY_SIZE;
    const fourcc = source.readUInt32LE(at);
    const pathAt = tdo + ((source.readUInt32LE(at + 0x10) - DEMO_BASE_MEMORY_ADDRESS) | 0);
    entries.push({
      index: i,
      path: pathAt >= tdo && pathAt < tdo + tds ? readCStringWithin(source, pathAt, tdo + tds) : `(tag #${i})`,
      // The scenario is the tag the header's scenario ID names (full ID), read as a scenario whatever its
      // group (`scenario-tag.ts`); its group in the file is left as it is.
      primaryClassName: i === (scenarioTagId & 0xffff) && source.readUInt32LE(at + 0xc) === scenarioTagId ? 'scenario' : (lookupTagClass(fourcc)?.name ?? fourCCToString(fourcc)),
      // Same rule as the CE reader (`parseTagIndex`): +0x18 == 1 means "in a resource map".
      isExternal: source.readUInt32LE(at + 0x18) === 1,
    });
  }
  const copy = Buffer.from(source);
  const tagLayout: TagDataLayout = { tagDataOffset: tdo, tagDataSize: tds, baseMemoryAddress: DEMO_BASE_MEMORY_ADDRESS, tagArrayFileOffset: arrayAt, entries };
  const tolerated: ToleratedPointer[] = [];
  const tolerate = { staleReferencePaths: true, rootsOutsideTagData: true };
  let sites: { kind: DemoPointerKind; at: number; value: number; tagIndex: number }[];
  try {
    sites = [...collectTagDataPointers(copy, tagLayout, { tolerate, tolerated }), ...collectBspSpacePointers(copy, tagLayout, { tolerate })];
  } catch (err) {
    if (!(err instanceof UnwalkableTagError)) throw err;
    return refuse('demoRebase', `The tag data can't be moved: ${err.message}`, [], [layoutRow]);
  }
  // Every pointer moves by the same delta, so every one must lie in the demo tag space (tag data and BSPs).
  const spaceEnd = DEMO_BASE_MEMORY_ADDRESS + CE_TAG_SPACE_SIZE;
  const outside = sites.filter((s) => s.value < DEMO_BASE_MEMORY_ADDRESS || s.value >= spaceEnd);
  if (outside.length > 0) {
    return refuse(
      'demoRebase',
      `${outside.length} pointer(s) lie outside the demo tag space (${hex(DEMO_BASE_MEMORY_ADDRESS)}-${hex(spaceEnd)}), so moving the tag data by one offset would leave them wrong.`,
      outside.map((s) => `${s.kind} of #${s.tagIndex} ${entries[s.tagIndex]?.path ?? ''}: ${hex(s.value)}`),
      [layoutRow],
    );
  }

  const moved = Object.fromEntries([...TAG_DATA_POINTER_KINDS, ...BSP_SPACE_POINTER_KINDS].map((k) => [k, 0])) as Record<DemoPointerKind, number>;
  for (const s of sites) {
    copy.writeUInt32LE((s.value + DEMO_TO_CE_DELTA) >>> 0, s.at);
    moved[s.kind]++;
  }
  copy.writeUInt32LE(CE_TAG_ARRAY_ADDRESS, tdo);

  // The standard header. Everything the demo header has besides these fields is filler (random-looking
  // bytes in every MacDemo map), so the 2048 bytes start from zero, as in Custom Edition maps.
  copy.fill(0, 0, CACHE_FILE_HEADER_SIZE);
  copy.writeUInt32LE(CacheFileLiteral.HEAD, STD.head);
  copy.writeUInt32LE(CacheFileEngine.RETAIL, STD.version);
  copy.writeUInt32LE(source.length, STD.fileSize);
  copy.writeUInt32LE(tdo, STD.tagDataOffset);
  copy.writeUInt32LE(tds, STD.tagDataSize);
  writeFixedString(copy, STD.scenarioName, TAG_STRING_SIZE, header.scenarioName);
  writeFixedString(copy, STD.buildString, TAG_STRING_SIZE, header.buildString);
  copy.writeUInt16LE(header.scenarioType, STD.scenarioType);
  copy.writeUInt32LE(header.crc32, STD.crc32);
  copy.writeUInt32LE(CacheFileLiteral.FOOT, STD.foot);

  const total = sites.length;
  const rebaseRow = row(
    'demoRebase',
    REBASE_LABEL,
    'pass',
    `${total.toLocaleString('en-US')} pointers move from ${hex(DEMO_BASE_MEMORY_ADDRESS)} to ${hex(CE_BASE_MEMORY_ADDRESS)}, found by walking every tag and structure BSP with the tag definitions.`,
    [
      ...Object.entries(moved)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k}: ${n.toLocaleString('en-US')}`),
      ...(tolerated.length > 0 ? [`${tolerated.length} stale pointer(s) outside the tag data are left as they are (the game never follows them).`] : []),
    ],
  );
  return { ok: true, value: { buffer: copy, header, moved, tolerated }, rows: [layoutRow, rebaseRow] };
}

function readCStringWithin(buffer: Buffer, at: number, end: number): string {
  let stop = at;
  while (stop < end && buffer[stop] !== 0) stop++;
  return buffer.toString('latin1', at, stop);
}

function refusedReport(rows: ConversionCheck[], header: DemoHeader | null): RetailConversionReport {
  return {
    canConvert: false,
    requiresAcknowledgement: false,
    checks: rows,
    scenarioName: header?.scenarioName ?? null,
    buildString: header?.buildString ?? null,
    mapType: header?.scenarioType ?? null,
    tagCount: null,
    previousCrc32: header?.crc32 ?? null,
    newCrc32: null,
    externalData: null,
    estimatedOutputSize: null,
    repairs: [],
  };
}

/** The full pre-flight report of a demo or MCC map: the layout and rebase rows, then every Phase 1 check on the retail-layout copy. */
export function preflightDemoConversion(source: Buffer, resources: ConversionResourceFiles = {}): RetailConversionReport {
  const normalized = normalizeDemoMap(source);
  if (!normalized.ok) return refusedReport(normalized.rows, readDemoHeader(source));
  return preflightRetailLayoutCopy(normalized.value.buffer, resources, { rows: normalized.rows });
}

export interface DemoConversionResult extends RetailConversionResult {
  /** Pointers moved by the rebase, per kind. */
  moved: Record<DemoPointerKind, number>;
}

/**
 * Converts a demo or MCC map: the retail-layout copy, then Phase 1's conversion of it (same options, same
 * refusals). Never mutates `source`. The result is not finalized: the scenario name and crc32 are set
 * when it is written (`writeFinalizedMap`), as for every other conversion.
 */
export function convertDemoToCustomEdition(source: Buffer, options: RetailConversionOptions): DemoConversionResult {
  const normalized = normalizeDemoMap(source);
  if (!normalized.ok) {
    throw new ConversionRefusedError(`This map can't be converted. ${normalized.rows.filter((r) => r.status === 'refuse').map((r) => r.message).join(' ')}`);
  }
  const result = convertRetailLayoutCopy(normalized.value.buffer, options, { rows: normalized.rows });
  return { ...result, moved: normalized.value.moved };
}
