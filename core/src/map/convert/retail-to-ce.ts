import { CacheFileEngine, CE_TAG_ARRAY_ADDRESS, TAG_DATA_HEADER_PC_SIZE, TAG_ENTRY_SIZE, TAG_STRING_SIZE } from '../../constants/cache-file';
import { readFixedString, writeFixedString } from '../../binary/strings';
import { parseCacheFileHeader } from '../header';
import type { CacheFileHeader } from '../header';
import { parseTagIndex, resolveTagDataPointer } from '../tag-index';
import type { TagIndex } from '../tag-index';
import { ceCrcRegions, computeCacheCrc32 } from '../cache-crc';
import { collectTagDataPointers, tagDataLayoutOf, UnwalkableTagError } from '../pointer-rebase';
import { decodeStruct, getAllTagGroupNames, getGroupStructName, isRangeInBuffer, resolvePointer, resolveStruct } from '../definitions/engine';
import { locateStructureBsp, validateStructInstance } from '../definitions/validate-tag';
import { classifyMapLayout, isConvertibleRetailLayout } from './classify';
import { findReferenceIdentityIssues } from './reference-identity';
import { countExternal, importExternalData, planExternalImport, scanPerAssetData } from './externalize-in';
import type { ExternalImportPlan, PerAssetScan } from './externalize-in';
import { readResourceTable } from './resource-files';
import type { RandomAccessFile, ResourceKind, ResourceTable } from './resource-files';
import { RawDataAppendCancelledError } from '../raw-data-region';
import { checkTagDataExtents } from './extent-check';
import { checkModelParts } from './model-part-check';
import { checkDrawableBitmaps } from './bitmap-check';
import { applyTagDataAlignment, measureBlockAlignment, planTagDataAlignment } from './align-tag-data';
import type { TagDataAlignmentPlan } from './align-tag-data';
import { applyTagDataRepairs, DATA_ARRAY_COUNT, DATA_ARRAY_ELEMENT_SIZE, DATA_ARRAY_HEADER_SIZE, DATA_ARRAY_MAXIMUM_COUNT, planTagDataRepairs, repairBytesAdded, SCRIPT_NODE_SIZE } from './tag-data-repairs';
import type { AppliedTagDataRepair, TagDataRepairId, TagDataRepairPlan } from './tag-data-repairs';

/**
 * Converter Phase 1: retail-layout maps (cache version 7, standard 2048-byte header, tag data at the
 * CE base 0x40440000 - HaloMD maps) -> Custom Edition (609). Research and measurements:
 * memory/demo-converter.md and memory/PRD.md (2026-10-11 "Converter Phase 1").
 *
 * Only two header fields change here: the version (0x4) and the build string (0x40, 32 bytes).
 * The scenario name (0x20) and crc32 (0x64) are then set by `finalizeForSave` when the map is
 * written, like every other save. Nothing else in the file changes: on heh_2 and theisland_3 the
 * padding (0xC) is already 0, the type (0x60) matches, 0x18-0x1F / 0x62 / 0x68-0x7FB are zero like
 * CE, and the tag data header (array pointer 0x40440028, scenario tag ID) is already what CE has.
 * The tag-file checksum (tag data +0x8) is left as it is, as File > Save does.
 *
 * The CE reader is not loosened: the checks read a private copy whose version is set to 609 and
 * then go through the normal `parseCacheFileHeader` / `parseTagIndex`.
 *
 * Phase 1b: when bitmap images or sound permutations keep their data in the source game's resource
 * files, the header-only conversion is not valid (CE has other resource files; such maps blue-screen
 * in OpenCE). Then the source game's bitmaps.map / sounds.map must be supplied, and the data is
 * copied into the map (`externalize-in.ts`), which also moves model data and tag data and updates
 * the file size, tag data offset and model data offset.
 */

const VERSION_OFFSET = 0x4;
const FILE_SIZE_OFFSET = 0x8;
const PADDING_OFFSET = 0xc;
const BUILD_STRING_OFFSET = 0x40;
/** Invader `gbx-custom`; also the build string of all 5 CE sample maps. */
export const CE_BUILD_STRING = '01.00.00.0609';

/**
 * Tags every CE map must contain. Source: Invader `src/hek/map.cpp` PC_REQUIRED_TAGS (reference only,
 * as listed in memory/demo-converter.md). These are engine-level requirements for every map, not
 * logic keyed to one map. The scenario-type collection is checked separately, by header type.
 */
export const CE_REQUIRED_TAGS: readonly { group: string; path: string }[] = [
  { group: 'tag_collection', path: 'ui\\ui_tags_loaded_all_scenario_types' },
  { group: 'sound', path: 'sound\\sfx\\ui\\cursor' },
  { group: 'sound', path: 'sound\\sfx\\ui\\back' },
  { group: 'sound', path: 'sound\\sfx\\ui\\flag_failure' },
  { group: 'unicode_string_list', path: 'ui\\shell\\main_menu\\mp_map_list' },
  { group: 'unicode_string_list', path: 'ui\\shell\\strings\\loading' },
  { group: 'bitmap', path: 'ui\\shell\\bitmaps\\trouble_brewing' },
  { group: 'bitmap', path: 'ui\\shell\\bitmaps\\background' },
  { group: 'globals', path: 'globals\\globals' },
];
/** Indexed by the header's scenario type (0 = singleplayer, 1 = multiplayer, 2 = user interface). */
export const CE_SCENARIO_TYPE_COLLECTIONS: readonly string[] = [
  'ui\\ui_tags_loaded_solo_scenario_type',
  'ui\\ui_tags_loaded_multiplayer_scenario_type',
  'ui\\ui_tags_loaded_mainmenu_scenario_type',
];

export type ConversionCheckStatus = 'pass' | 'warn' | 'refuse' | 'info';

export type ConversionCheckId =
  | 'layout'
  | 'demoLayout'
  | 'demoRebase'
  | 'fileSize'
  | 'padding'
  | 'tagDataAddress'
  | 'entryFlags'
  | 'entryUnusedWord'
  | 'regions'
  | 'validation'
  | 'referenceIdentity'
  | 'requiredTags'
  | 'scripts'
  | 'injectAfterwards'
  | 'scenarioName'
  | 'tagFileChecksum'
  | 'tagBlockAlignment'
  | 'tagDataExtents'
  | 'modelParts'
  | 'drawableBitmaps'
  | 'repairAlignTagData'
  | 'repairScriptSyntaxData'
  | 'repairTagRootOutside'
  | 'externalData'
  | 'resourceFiles'
  | 'resourceNames'
  | 'bitmapSizes'
  | 'outputSize';

export interface ConversionCheck {
  id: ConversionCheckId;
  label: string;
  status: ConversionCheckStatus;
  message: string;
  /** Individual findings (tag paths, error lines), capped by the caller's display. */
  details: string[];
  /** Convert is only allowed after the user explicitly acknowledges this check. */
  requiresAcknowledgement: boolean;
  /**
   * Set on a repair row: the repair the user can tick. A required repair is pre-ticked; Convert is
   * refused while it is unticked (OpenCE refuses the map without it). Optional repairs start unticked.
   */
  repair?: { id: TagDataRepairId; required: boolean };
}

export interface RetailConversionReport {
  /** No check refuses. */
  canConvert: boolean;
  /** At least one check needs an explicit acknowledgement before converting. */
  requiresAcknowledgement: boolean;
  checks: ConversionCheck[];
  scenarioName: string | null;
  buildString: string | null;
  mapType: number | null;
  tagCount: number | null;
  previousCrc32: number | null;
  /**
   * The crc32 the converted map gets. The header is not part of the CRC, so the output file name
   * doesn't change it. Null when external data is copied in: then it is known only after converting.
   */
  newCrc32: number | null;
  /** Bitmap images and sound permutations whose data is in the source game's resource files. Null if not read. */
  externalData: { bitmaps: { count: number; bytes: number }; sounds: { count: number; bytes: number } } | null;
  /** Output file size: the source size plus the external data copied in and the required repairs. Null if not known. */
  estimatedOutputSize: number | null;
  /** The repairs this map can get (also listed as checklist rows with `repair` set). */
  repairs: { id: TagDataRepairId; required: boolean; tagPath: string; bytesAdded: number }[];
}

/** The source game's resource files, for maps whose bitmap or sound data is external. Read by offset only. */
export type ConversionResourceFiles = Partial<Record<ResourceKind, RandomAccessFile>>;

export interface RetailConversionOptions {
  /**
   * Kept for the app's IPC. Since 2026-10-12 no check needs it: OpenCE looks every script call up by
   * name (see `scriptCheck`), and a map whose calls don't name their function is refused instead.
   */
  acknowledgeScripts: boolean;
  /** Tag data repairs to apply. Every repair the report marks required must be true, or the conversion is refused (REPAIR_REQUIRED). */
  repairs?: Partial<Record<TagDataRepairId, boolean>>;
  resources?: ConversionResourceFiles;
  /** Progress while external data is copied in, in bytes. */
  onProgress?: (bytesDone: number, bytesTotal: number) => void;
  /** Checked before each copied range; cancelling throws ConversionRefusedError with code CANCELLED. */
  shouldCancel?: () => boolean;
}

export class ConversionRefusedError extends Error {
  constructor(message: string, public readonly code: 'REFUSED' | 'ACKNOWLEDGEMENT_REQUIRED' | 'REPAIR_REQUIRED' | 'CANCELLED' = 'REFUSED') {
    super(message);
    this.name = 'ConversionRefusedError';
  }
}

const MAX_DETAILS = 50;

function check(id: ConversionCheckId, label: string, status: ConversionCheckStatus, message: string, details: string[] = [], requiresAcknowledgement = false, repair?: ConversionCheck['repair']): ConversionCheck {
  return { id, label, status, message, details: details.slice(0, MAX_DETAILS), requiresAcknowledgement, ...(repair ? { repair } : {}) };
}

const hex = (n: number) => `0x${(n >>> 0).toString(16).toUpperCase()}`;

interface ParsedView {
  header: CacheFileHeader;
  tagIndex: TagIndex;
  /** The private copy with version 609 that `header` / `tagIndex` were read from (same bytes otherwise). */
  view: Buffer;
  /** Set when the map has per-asset external data that can be copied in (files supplied and matching). */
  importPlan: ExternalImportPlan | null;
  repairPlan: TagDataRepairPlan | null;
  /** Phase 1c: set when the map's blocks need aligning (and can be). The other repairs are planned on the aligned layout. */
  alignment: TagDataAlignmentPlan | null;
  /** Bytes the required repairs (the alignment included) add. */
  requiredRepairBytes: number;
}

/**
 * Header-level checks that decide whether the map can be converted at all (each refuses), plus the
 * script check (needs acknowledgement). `full` adds the slower warnings (validation, references,
 * required tags, pointer walk) used for the pre-flight dialog.
 */
function runChecks(buffer: Buffer, full: boolean, resources: ConversionResourceFiles = {}, origin?: SourceOrigin): { report: RetailConversionReport; parsed: ParsedView | null } {
  const checks: ConversionCheck[] = [];
  const report: RetailConversionReport = {
    canConvert: false,
    requiresAcknowledgement: false,
    checks,
    scenarioName: null,
    buildString: null,
    mapType: null,
    tagCount: null,
    previousCrc32: null,
    newCrc32: null,
    externalData: null,
    estimatedOutputSize: null,
    repairs: [],
  };
  const done = (parsed: ParsedView | null) => {
    report.canConvert = !checks.some((c) => c.status === 'refuse');
    report.requiresAcknowledgement = checks.some((c) => c.requiresAcknowledgement);
    return { report, parsed };
  };

  const layout = classifyMapLayout(buffer);
  const layoutLabel = 'Retail-layout map (cache version 7)';
  if (layout.kind === 'customEdition') {
    checks.push(check('layout', layoutLabel, 'refuse', 'This map is already a Custom Edition map (version 609). There is nothing to convert.'));
    return done(null);
  }
  if (layout.kind === 'customEditionCompressed') {
    checks.push(check('layout', layoutLabel, 'refuse', 'This is a compressed Custom Edition map, not a retail-layout map. There is nothing to convert.'));
    return done(null);
  }
  if (layout.kind === 'demo') {
    checks.push(check('layout', layoutLabel, 'refuse', 'This is an original Halo demo map (true demo layout, version 6). It is converted by the demo converter (Phase 2, `demo-to-ce.ts`), not as a retail-layout map.'));
    return done(null);
  }
  if (layout.kind !== 'retail') {
    checks.push(check('layout', layoutLabel, 'refuse', layout.kind === 'otherVersion' ? `Cache version ${layout.version} can't be converted; only version 7 (retail layout) can.` : 'This does not look like a Halo map file.'));
    return done(null);
  }
  if (origin) checks.push(...origin.rows);
  else checks.push(check('layout', layoutLabel, 'pass', 'Standard header, cache version 7.'));

  report.scenarioName = readFixedString(buffer, 0x20, TAG_STRING_SIZE);
  report.buildString = readFixedString(buffer, BUILD_STRING_OFFSET, TAG_STRING_SIZE);
  report.mapType = buffer.readUInt16LE(0x60);
  report.previousCrc32 = buffer.readUInt32LE(0x64);

  const declaredSize = buffer.readUInt32LE(FILE_SIZE_OFFSET);
  checks.push(
    declaredSize === buffer.length
      ? check('fileSize', 'File size matches the header', 'pass', `${buffer.length} bytes.`)
      : check('fileSize', 'File size matches the header', 'refuse', `The header says ${declaredSize} bytes but the file has ${buffer.length}. The file may be truncated or modified.`),
  );
  const padding = buffer.readUInt32LE(PADDING_OFFSET);
  checks.push(
    padding === 0
      ? check('padding', 'Header padding length is 0', 'pass', 'Same as Custom Edition maps.')
      : check('padding', 'Header padding length is 0', 'refuse', `The header's padding length (0xC) is ${padding}; every Custom Edition map has 0 there. How to convert that is not known, so the map is not converted.`),
  );
  if (!isConvertibleRetailLayout(layout)) {
    checks.push(
      check('tagDataAddress', 'Tag data at the Custom Edition address', 'refuse', `The tag array pointer gives base ${layout.inferredBase === null ? 'unreadable' : hex(layout.inferredBase)}, not 0x40440000. Moving tag data (a pointer rebase) is not part of this converter.`),
    );
    return done(null);
  }
  checks.push(check('tagDataAddress', 'Tag data at the Custom Edition address', 'pass', `Tag array pointer ${hex(CE_TAG_ARRAY_ADDRESS)} (base 0x40440000).`));
  if (declaredSize !== buffer.length) return done(null);

  // Read through the normal CE reader, on a private copy with the CE version.
  let parsed: ParsedView;
  try {
    const view = Buffer.from(buffer);
    view.writeUInt32LE(CacheFileEngine.CUSTOM_EDITION, VERSION_OFFSET);
    const header = parseCacheFileHeader(view);
    const tagIndex = parseTagIndex(view, header);
    parsed = { header, tagIndex, view, importPlan: null, repairPlan: null, alignment: null, requiredRepairBytes: 0 };
  } catch (err) {
    checks.push(check('regions', 'Tag index can be read', 'refuse', `The tag index can't be read: ${(err as Error).message}`));
    return done(null);
  }
  const { header, tagIndex, view } = parsed;
  report.tagCount = tagIndex.tagCount;

  // Retail maps have no CE "external" flag: a nonzero word at +0x18 would be read by CE as external.
  // +0x1C is read by nothing in OpenCE (PRD 2026-10-12, decision A: its tag instance structs call
  // +0x18/+0x1C `unused[2]`, and its loader reads +0x18 only), so a nonzero +0x1C is reported, not refused.
  const arrayAt = header.tagDataOffset + TAG_DATA_HEADER_PC_SIZE;
  const flagged: string[] = [];
  const unusedWord: string[] = [];
  for (const e of tagIndex.entries) {
    const at = arrayAt + e.index * TAG_ENTRY_SIZE;
    const w18 = buffer.readUInt32LE(at + 0x18);
    const w1c = buffer.readUInt32LE(at + 0x1c);
    if (w18 !== 0) flagged.push(`#${e.index} ${e.path}.${e.primaryClassName}: +0x18 = ${hex(w18)}`);
    if (w1c !== 0) unusedWord.push(`#${e.index} ${e.path}.${e.primaryClassName}: +0x1C = ${hex(w1c)}`);
  }
  checks.push(
    flagged.length === 0
      ? check('entryFlags', 'No tag entry is marked external (whole tags)', 'pass', `All ${tagIndex.tagCount} tag entries have 0 at +0x18, so every tag is inside the map.`)
      : check('entryFlags', 'No tag entry is marked external (whole tags)', 'refuse', `${flagged.length} tag entr${flagged.length === 1 ? 'y has' : 'ies have'} a nonzero word at +0x18. Custom Edition would read those tags as external (in bitmaps/sounds/loc.map), so the map is not converted.`, flagged),
  );
  if (unusedWord.length > 0) {
    checks.push(
      check(
        'entryUnusedWord',
        'Tag entries with a value in their unused word (+0x1C)',
        'info',
        `${unusedWord.length} tag entr${unusedWord.length === 1 ? 'y has' : 'ies have'} a nonzero word at +0x1C, which Custom Edition maps leave 0. OpenCE never reads this word, so it is left as it is.`,
        unusedWord,
      ),
    );
  }

  const regionsLabel = 'BSP, model data and tag data are inside the file';
  let headerOnlyCrc: number | null = null;
  try {
    headerOnlyCrc = computeCacheCrc32(view, ceCrcRegions(view, header, tagIndex));
  } catch (err) {
    checks.push(check('regions', regionsLabel, 'refuse', (err as Error).message));
  }

  const tagData = tagDataChecks(checks, view, header, tagIndex, report);
  parsed.repairPlan = tagData.plan;
  parsed.alignment = tagData.alignment;
  parsed.requiredRepairBytes = tagData.requiredBytes;

  const scan = scanPerAssetData(view, header, tagIndex);
  const counts = countExternal(scan);
  report.externalData = { bitmaps: counts.bitmap, sounds: counts.sound };
  if (counts.bitmap.count + counts.sound.count === 0 && scan.blocked.length === 0) {
    report.newCrc32 = parsed.repairPlan?.repairs.length || parsed.alignment ? null : headerOnlyCrc;
    report.estimatedOutputSize = buffer.length + parsed.requiredRepairBytes;
    if (headerOnlyCrc !== null && report.newCrc32 !== null) checks.push(check('regions', regionsLabel, 'pass', `New CRC32 ${hex(headerOnlyCrc)} (was ${hex(report.previousCrc32)}).`));
    else if (headerOnlyCrc !== null) checks.push(check('regions', regionsLabel, 'pass', 'The new CRC32 is computed after the tag data repairs.'));
    checks.push(check('externalData', 'Bitmap and sound data is inside the map', 'pass', 'No bitmap image or sound permutation keeps its data in a resource file.'));
  } else {
    if (headerOnlyCrc !== null) checks.push(check('regions', regionsLabel, 'pass', 'The new CRC32 is computed after the bitmap and sound data is copied in.'));
    parsed.importPlan = externalDataChecks(checks, view, scan, counts, resources, buffer.length + parsed.requiredRepairBytes, report);
  }

  checks.push(modelPartsCheck(view, header, tagIndex));
  checks.push(drawableBitmapsCheck(view, header, tagIndex));
  checks.push(scriptCheck(view, header, tagIndex));

  if (full) {
    checks.push(validationCheck(view, header, tagIndex));
    checks.push(referenceIdentityCheck(view, header, tagIndex));
    checks.push(requiredTagsCheck(header, tagIndex));
    checks.push(injectAfterwardsCheck(view, header, tagIndex));
    checks.push(
      check('scenarioName', 'Internal map name', 'info', `The internal name is "${report.scenarioName}". It is set from the output file name when the converted map is saved, so the two always match.`),
    );
    checks.push(
      check('tagFileChecksum', 'Tag-file checksum left unchanged', 'info', `The tag data header's tag-file checksum (${hex(tagIndex.tagChecksum)}) is kept, as File > Save does. Whether the game checks it is unverified; maps saved this way load in OpenCE.`),
    );
  }
  return done(parsed);
}

const fmtBytes = (n: number) => `${n.toLocaleString('en-US')} bytes`;
const EXTERNAL_DATA_LABEL = 'Bitmap and sound data is inside the map';

/**
 * Rows for per-asset external data (Phase 1b). Without the source game's resource files the map is
 * refused: Custom Edition's own bitmaps.map / sounds.map hold other data at those offsets (converted
 * maps blue-screened in OpenCE). A supplied file is usable only when every external range equals
 * one of its entries (the range check); its name and size are never trusted.
 */
function externalDataChecks(
  checks: ConversionCheck[],
  view: Buffer,
  scan: PerAssetScan,
  counts: ReturnType<typeof countExternal>,
  resources: ConversionResourceFiles,
  sourceSize: number,
  report: RetailConversionReport,
): ExternalImportPlan | null {
  const summary = `${counts.bitmap.count} bitmap image(s) (${fmtBytes(counts.bitmap.bytes)}) and ${counts.sound.count} sound permutation(s) (${fmtBytes(counts.sound.bytes)})`;
  if (scan.blocked.length > 0) {
    checks.push(check('externalData', EXTERNAL_DATA_LABEL, 'refuse', "Some bitmap or sound data can't be read, so it is not known whether it is inside the map. The map is not converted.", scan.blocked));
    return null;
  }
  const needed: ResourceKind[] = [];
  if (counts.bitmap.count > 0) needed.push('bitmaps');
  if (counts.sound.count > 0) needed.push('sounds');
  const neededText = needed.map((k) => `${k}.map`).join(' and ');
  const tables: Partial<Record<ResourceKind, ResourceTable>> = {};
  const fileErrors: string[] = [];
  for (const kind of needed) {
    const file = resources[kind];
    if (!file) continue;
    const read = readResourceTable(file, kind);
    if (read.ok) tables[kind] = read.table;
    else fileErrors.push(read.error);
  }
  const plan = planExternalImport(view, scan, tables);
  report.estimatedOutputSize = sourceSize + plan.bytesAdded;

  const missing = needed.filter((k) => !resources[k]);
  if (missing.length > 0) {
    checks.push(
      check(
        'externalData',
        EXTERNAL_DATA_LABEL,
        'refuse',
        `${summary} of this map are stored in the source game's ${neededText}, which Custom Edition does not have. Converting needs those files from the game the map came from (for HaloMD maps: HaloMD's own bitmaps.map and sounds.map). Missing: ${missing.map((k) => `${k}.map`).join(', ')}.`,
      ),
    );
    return null;
  }
  checks.push(check('externalData', EXTERNAL_DATA_LABEL, 'info', `${summary} are copied in from the supplied ${neededText}.`));

  const lines = [...fileErrors];
  let usable = fileErrors.length === 0;
  for (const kind of needed) {
    const table = tables[kind];
    if (!table) continue;
    const total = kind === 'bitmaps' ? counts.bitmap.count : counts.sound.count;
    const bad = plan.unmatched[kind];
    if (bad.length > 0) {
      usable = false;
      lines.push(`${table.label}: ${bad.length} of ${total} ranges this map needs are not entries of this file, so it is not the ${kind}.map this map was built with.`, ...bad.slice(0, 20));
    } else {
      lines.push(`${table.label}: all ${total} ranges this map needs are entries of this file.`);
    }
  }
  const filesLabel = 'The resource files match this map';
  checks.push(
    usable
      ? check('resourceFiles', filesLabel, 'pass', 'Every external bitmap and sound range of this map is an entry of the supplied files.', lines)
      : check('resourceFiles', filesLabel, 'refuse', "The supplied resource files are not the ones this map was built with, or can't be read. Choose the bitmaps.map and sounds.map of the game the map came from.", lines),
  );
  if (plan.rawRegionProblem) checks.push(check('outputSize', 'Room for the copied data', 'refuse', plan.rawRegionProblem));
  if (!usable || plan.rawRegionProblem) return null;

  if (plan.nameMismatches.length > 0) {
    checks.push(
      check('resourceNames', 'Resource names match the tags', 'warn', `${plan.nameMismatches.length} range(s) are stored under another tag's name in the resource file (for example a modded tag reusing stock data). The bytes are copied as they are.`, plan.nameMismatches),
    );
  }
  if (plan.sizeMismatches.length > 0) {
    checks.push(
      check(
        'bitmapSizes',
        'Bitmap sizes match their format',
        'warn',
        `${plan.sizeMismatches.length} bitmap image(s) have a stored size that differs from what their width, height and format give. They are copied by their stored size, which equals the resource entry.`,
        plan.sizeMismatches,
      ),
    );
  }
  checks.push(check('outputSize', 'Estimated output size', 'info', `${fmtBytes(sourceSize + plan.bytesAdded)} (${plan.assets.length} ranges copied, +${fmtBytes(plan.bytesAdded)}).`));
  return plan;
}

const REPAIR_ROWS: Record<TagDataRepairId, { id: ConversionCheckId; label: string; required: string; optional: string }> = {
  alignTagData: {
    id: 'repairAlignTagData',
    label: 'Repair: align the tag data',
    required:
      "OpenCE needs this repair: it skips every block that is not 4-aligned without a message, so this map's Ogg Vorbis sounds (player deaths, the announcer, the plasma overheat) play as noise and its weapon HUD is drawn twice too large with the wrong meter channels. The repair inserts zero bytes after the tag names and moves every pointer past them, so every tag and block starts 4-aligned, as in Custom Edition maps. Path strings, BSPs and model data don't move. Convert stays off while this is unticked.",
    optional: '',
  },
  scriptSyntaxData: {
    id: 'repairScriptSyntaxData',
    label: 'Repair: move the script data to its own block',
    required:
      "OpenCE refuses this map without this repair: the scenario's script data overlaps other tags or is not 4-aligned, and OpenCE stops loading at \"the scenario's script data is missing or damaged\" (a blue screen). The repair gives it a 4-aligned block of its own at the end of the tag data, with its header and used script nodes copied and the rest zero. Convert stays off while this is unticked.",
    optional: '',
  },
  tagRootOutside: {
    id: 'repairTagRootOutside',
    label: 'Repair: give the tag outside the tag data a zeroed struct',
    required:
      "OpenCE refuses this map without this repair: a tag's data starts outside the tag data. The repair adds a zeroed struct of that tag's size at the end of the tag data and points the tag at it. Nothing references the tag, so its values are never used. Convert stays off while this is unticked.",
    optional: '',
  },
};

const ALIGNMENT_LABEL = 'Tag blocks are 4-aligned (OpenCE skips unaligned blocks)';
const fmtCounts = (unaligned: number, checked: number) => `${unaligned.toLocaleString('en-US')} of ${checked.toLocaleString('en-US')}`;

/**
 * Phase 1c (`align-tag-data.ts`): the block alignment OpenCE's `loaded_block_get` needs, then the tag
 * data block check (what OpenCE's validator refuses: `extent-check.ts`) and a row per repair
 * (`tag-data-repairs.ts`). When the blocks need aligning, the extent check and the other repairs run
 * on the aligned layout (a private copy), so their addresses are the ones the output will have. A
 * problem no repair covers refuses the map. Measured: 0 problems and 0 unaligned blocks on all 5 CE
 * sample maps and stock PC / HaloMD bloodgulch; every HaloMD map's blocks are 2 or 1 mod 4 (one
 * remainder per map); theisland_3 / barrier: the script syntax data overlaps other tags; crossing:
 * #2404 sound_environment starts at the tag data end.
 */
function tagDataChecks(
  checks: ConversionCheck[],
  view: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  report: RetailConversionReport,
): { plan: TagDataRepairPlan; alignment: TagDataAlignmentPlan | null; requiredBytes: number } {
  const alignment = planTagDataAlignment(view, header, tagIndex);
  const canAlign = alignment.needed && alignment.problems.length === 0;
  let laid = { view, header, tagIndex };
  if (canAlign) {
    const alignedView = applyTagDataAlignment(view, alignment).buffer;
    const alignedHeader = parseCacheFileHeader(alignedView);
    laid = { view: alignedView, header: alignedHeader, tagIndex: parseTagIndex(alignedView, alignedHeader) };
  }
  const extents = checkTagDataExtents(laid.view, laid.header, laid.tagIndex);
  const plan = planTagDataRepairs(laid.view, laid.header, laid.tagIndex, extents);

  // --- alignment row ---
  const { blocks, bspBlocks, roots, dataBlocks } = alignment.report;
  // A root the alignment walk skipped (outside the tag data) must be replaced by a tagRootOutside repair.
  const uncovered = alignment.tolerated
    .filter((t) => t.kind === 'rootOutsideTagData' && !plan.repairs.some((r) => r.id === 'tagRootOutside' && r.tagIndex === t.tagIndex))
    .map((t) => `#${t.tagIndex} ${t.where} lies outside the tag data and no repair replaces it, so its blocks can't be aligned.`);
  const tolerated = alignment.tolerated.map((t) =>
    t.kind === 'staleReferencePath'
      ? `${t.where}: path pointer ${hex(t.value)} is outside the tag data (a stale leftover; the game never follows it), left as it is.`
      : `${t.where}: outside the tag data; replaced by the repair below, not moved.`,
  );
  const scope = `${blocks.checked.toLocaleString('en-US')} blocks in the tag data and ${bspBlocks.checked.toLocaleString('en-US')} in the structure BSP(s) checked the way OpenCE reads them`;
  if (alignment.problems.length > 0 || uncovered.length > 0) {
    checks.push(check('tagBlockAlignment', ALIGNMENT_LABEL, 'refuse', `${scope}. OpenCE skips unaligned blocks, and this map's can't be aligned here, so the map is not converted.`, [...alignment.problems, ...uncovered]));
  } else if (!alignment.needed) {
    checks.push(check('tagBlockAlignment', ALIGNMENT_LABEL, 'pass', `${scope}: every block, tag and data block starts 4-aligned.`));
  } else {
    checks.push(
      check(
        'tagBlockAlignment',
        ALIGNMENT_LABEL,
        'warn',
        `${scope}: ${fmtCounts(blocks.unaligned, blocks.checked)} tag data blocks (and ${fmtCounts(roots.unaligned, roots.checked)} tags, ${fmtCounts(dataBlocks.unaligned, dataBlocks.checked)} data blocks) start ${alignment.remainder} mod 4. OpenCE skips such blocks without a message (its sound conversion and HUD passes don't run on them). Fixed by the required repair below.`,
        [...alignment.report.examples.slice(0, 5), ...tolerated],
      ),
    );
    report.repairs.push({ id: 'alignTagData', required: true, tagPath: '(all tags)', bytesAdded: alignment.bytes });
    const row = REPAIR_ROWS.alignTagData;
    const moved = Object.values(alignment.pointersToMove).reduce((a, b) => a + b, 0);
    checks.push(
      check(
        'repairAlignTagData',
        row.label,
        'warn',
        `${row.required} Adds ${fmtBytes(alignment.bytes)}.`,
        [`Inserts ${alignment.bytes} zero byte(s) at ${hex(tagIndex.baseMemoryAddress + alignment.insertAt)} (the end of the tag names) and moves ${moved.toLocaleString('en-US')} pointers past it by ${alignment.bytes}.`],
        false,
        { id: 'alignTagData', required: true },
      ),
    );
  }

  // --- block check and the other repairs (on the aligned layout) ---
  const label = "Tag blocks are inside the tag data and don't overlap";
  const extentScope = `${extents.blocksChecked.toLocaleString('en-US')} blocks in ${extents.tagsChecked} tags and ${extents.bspsChecked} structure BSP(s) checked the way OpenCE checks them`;
  const problems = extents.violations.length;
  if (plan.unrepairable.length > 0) {
    checks.push(
      check('tagDataExtents', label, 'refuse', `${extentScope}: ${problems} problem(s). OpenCE refuses this map, and ${plan.unrepairable.length} problem(s) can't be repaired here, so the map is not converted.`, plan.unrepairable),
    );
  } else if (problems === 0) {
    checks.push(check('tagDataExtents', label, 'pass', `${extentScope}: no problems.`));
  } else {
    checks.push(check('tagDataExtents', label, 'warn', `${extentScope}: ${problems} problem(s). OpenCE refuses a map with any of these; each is fixed by a required repair below.`, extents.violations.map((v) => v.text)));
  }
  plan.repairs.forEach((r, i) => {
    const row = REPAIR_ROWS[r.id];
    // (with the repairs before it applied: each block's padding depends on where the last one ended)
    const bytes = repairBytesAdded(laid.header.tagDataSize, plan.repairs.slice(0, i + 1)) - repairBytesAdded(laid.header.tagDataSize, plan.repairs.slice(0, i));
    report.repairs.push({ id: r.id, required: r.required, tagPath: r.tagPath, bytesAdded: bytes });
    checks.push(check(row.id, row.label, r.required ? 'warn' : 'info', `${r.required ? row.required : row.optional} Adds ${fmtBytes(bytes)}.`, r.details, false, { id: r.id, required: r.required }));
  });
  const requiredBytes = (canAlign ? alignment.bytes : 0) + repairBytesAdded(laid.header.tagDataSize, plan.repairs.filter((r) => r.required));
  return { plan, alignment: canAlign ? alignment : null, requiredBytes };
}

function validationCheck(view: Buffer, header: CacheFileHeader, tagIndex: TagIndex): ConversionCheck {
  const known = new Set(getAllTagGroupNames());
  const scenario = tagIndex.entries[tagIndex.scenarioTagId & 0xffff];
  const scenarioAt = scenario && !scenario.isExternal ? resolveTagDataPointer(scenario.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress) : null;
  const lines: string[] = [];
  let failed = 0;
  let checked = 0;
  let noDefinition = 0;
  for (const e of tagIndex.entries) {
    // External entries are refused by the entryFlags check; their data isn't in this file.
    if (e.isExternal) continue;
    const group = e.primaryClassName;
    const structName = group && known.has(group) ? getGroupStructName(group) : null;
    if (!structName) {
      noDefinition++;
      lines.push(`#${e.index} ${e.path}: tag class "${group}" has no definition in this build, so it was not checked.`);
      continue;
    }
    const errors: string[] = [];
    const stats = { structsVisited: 0, dependenciesChecked: 0, reflexivesChecked: 0, elementsBoundsChecked: 0 };
    const context = `${e.path}.${group}`;
    if (group === 'scenario_structure_bsp') {
      const bsp = scenarioAt === null ? null : locateStructureBsp(view, tagIndex, scenarioAt, header.tagDataOffset, tagIndex.baseMemoryAddress, e.tagId);
      if (!bsp) errors.push(`${context}: not found in the scenario's "structure bsps" list.`);
      else validateStructInstance(view, tagIndex, structName, bsp.fileOffset, bsp.fileOffsetAnchor, bsp.baseMemoryAddress, context, errors, stats);
    } else {
      validateStructInstance(view, tagIndex, structName, resolveTagDataPointer(e.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress), header.tagDataOffset, tagIndex.baseMemoryAddress, context, errors, stats);
    }
    checked++;
    if (errors.length > 0) {
      failed++;
      lines.push(...errors);
    }
  }
  const label = 'Every tag reads cleanly with the Custom Edition definitions';
  if (failed === 0 && noDefinition === 0) return check('validation', label, 'pass', `${checked} tags checked, 0 problems.`);
  return check(
    'validation',
    label,
    'warn',
    `${failed} of ${checked} tags have problems${noDefinition ? ` and ${noDefinition} could not be checked` : ''}. They are converted unchanged; nothing is fixed.`,
    lines,
  );
}

/**
 * References whose tag ID differs from their entry's are listed (a warning). References whose tag ID
 * matches but whose path pointer differs are only counted, in one line (PRD 2026-10-12, decision D):
 * map protection gives the tag table other names and leaves the references' path pointers alone
 * (MacDemo mods: thousands each). The game follows a reference by its tag ID, never its path pointer.
 */
function referenceIdentityCheck(view: Buffer, header: CacheFileHeader, tagIndex: TagIndex): ConversionCheck {
  const issues = findReferenceIdentityIssues(view, header, tagIndex);
  const label = "Tag references carry their tag's exact ID and path pointer";
  if (issues.length === 0) return check('referenceIdentity', label, 'pass', 'Every non-null reference matches its tag entry.');
  const wrongId = issues.filter((i) => i.tagId !== i.entryTagId);
  const pathOnly = issues.length - wrongId.length;
  const pathOnlyLine = `${pathOnly.toLocaleString('en-US')} reference${pathOnly === 1 ? '' : 's'} name${pathOnly === 1 ? 's' : ''} the right tag ID but keep${pathOnly === 1 ? 's' : ''} another path pointer than the tag's entry (for example after map protection renamed the tags). The game follows tag IDs, never these path pointers; they are left as they are.`;
  if (wrongId.length === 0) return check('referenceIdentity', label, 'info', pathOnlyLine);
  return check(
    'referenceIdentity',
    label,
    'warn',
    `${wrongId.length} reference${wrongId.length === 1 ? '' : 's'} point${wrongId.length === 1 ? 's' : ''} at a tag with an outdated tag ID, most likely left over from the demo version of this map. ` +
      'The Custom Edition sample maps have none of these. They are converted unchanged (OpenCE sets such a reference to none). If the converted map crashes, or scenery or sounds are missing in OpenCE, check these first.' +
      (pathOnly > 0 ? ` Also: ${pathOnlyLine}` : ''),
    wrongId.map((i) => `${i.context}: tag ID ${hex(i.tagId)} (tag entry ${i.entryTagId === null ? 'missing' : hex(i.entryTagId)}), path pointer ${hex(i.pathPointer)} (tag entry ${i.entryPathPointer === null ? 'missing' : hex(i.entryPathPointer)})`),
  );
}

function requiredTagsCheck(header: CacheFileHeader, tagIndex: TagIndex): ConversionCheck {
  const has = (group: string, p: string) => tagIndex.entries.some((e) => e.primaryClassName === group && e.path.toLowerCase() === p.toLowerCase());
  const missing = CE_REQUIRED_TAGS.filter((t) => !has(t.group, t.path)).map((t) => `${t.path}.${t.group}`);
  const collection = CE_SCENARIO_TYPE_COLLECTIONS[header.mapType];
  if (collection === undefined) missing.push(`(scenario type ${header.mapType} is not 0, 1 or 2, so its tag collection is unknown)`);
  else if (!has('tag_collection', collection)) missing.push(`${collection}.tag_collection`);
  const label = 'Tags Custom Edition requires are present';
  if (missing.length === 0) return check('requiredTags', label, 'pass', `All ${CE_REQUIRED_TAGS.length + 1} required tags are in the map.`);
  return check('requiredTags', label, 'warn', `${missing.length} required tag${missing.length === 1 ? ' is' : 's are'} missing. The game may refuse to load the map. Nothing is added.`, missing);
}

/**
 * OpenCE's model part checks (`model-part-check.ts`): a failing part stops OpenCE's load (fatal), so
 * the map is refused. The 2026-10-12 decision: refuse and name the parts; no repair (PRD).
 */
function modelPartsCheck(view: Buffer, header: CacheFileHeader, tagIndex: TagIndex): ConversionCheck {
  const label = "Models pass OpenCE's part check";
  let report: ReturnType<typeof checkModelParts>;
  try {
    report = checkModelParts(view, header, tagIndex);
  } catch (err) {
    return check('modelParts', label, 'refuse', `The models can't be read: ${(err as Error).message}`);
  }
  const scope = `${report.modelsChecked} models, ${report.partsChecked} parts`;
  if (report.problems.length === 0) return check('modelParts', label, 'pass', `${scope}: every part passes.`);
  const models = new Set(report.problems.map((p) => p.tagIndex)).size;
  return check(
    'modelParts',
    label,
    'refuse',
    `${scope}: ${report.problems.length} part${report.problems.length === 1 ? '' : 's'} of ${models} model${models === 1 ? '' : 's'} fail. OpenCE stops loading a map with such a part ("names a node, vertex, shader or part that does not exist"), so the map is not converted. Repairing them is not supported yet.`,
    report.problems.map((p) => p.text),
  );
}

const SCRIPT_NODE_TABLE_HEADER_SIZE = DATA_ARRAY_HEADER_SIZE;
const SCRIPT_NODE_FLAG_PRIMITIVE = 0x1;
const SCRIPT_NODE_FLAG_SCRIPT_CALL = 0x2;
const SCRIPT_NODE_FLAG_GLOBAL = 0x4;
/** `_hs_function_name` (OpenCE source/hs/hs.h: the third value of the value type enum). */
const SCRIPT_NODE_TYPE_FUNCTION_NAME = 2;
/** An engine global's designator has bit 15 set (OpenCE `HS_EXTERNAL_GLOBAL_DESIGNATOR_BIT`). */
const SCRIPT_ENGINE_GLOBAL_BIT = 0x8000;

/**
 * OpenCE looks every script call and engine global of a Custom Edition map up again by the name in
 * the map's own script string data (port/linux/game/custom_edition_scripts.c, `function_call_convert`
 * and `engine_global_convert`, build 185), so the function numbers the source game stored don't
 * matter (measured 2026-10-12: the Mac demo numbers 37 of b30's 122 functions differently from CE,
 * and not like RIAT's PC demo either). OpenCE refuses the map ("does not name what it uses") when a
 * call's first child is not a function name node with a readable name, or an engine global reference
 * has no readable name, or the node table is not laid out as it expects. This row checks exactly
 * that, over the `count` nodes in use (the ones OpenCE converts). Names OpenCE lacks are made inert
 * by OpenCE; that is not checked here (no function table in this repo).
 * Node layout (OpenCE source/hs/hs_scenario_definitions.h, `hs_syntax_node`, 20 bytes): +0 salt,
 * +2 function index, +4 type, +6 flags, +8 next node, +12 string offset, +16 data.
 */
/**
 * OpenCE's bitmap check (`bitmap-check.ts`): an undrawable bitmap stops OpenCE's load ("cannot be drawn by
 * this build", then game_load() failed), so the map is refused. Checked with the flags the output will
 * have (the copy-in clears the external bit 0x100). PRD 2026-10-12: refuse, no repair (the missing
 * pixels are not in the file).
 */
function drawableBitmapsCheck(view: Buffer, header: CacheFileHeader, tagIndex: TagIndex): ConversionCheck {
  const label = 'Bitmaps OpenCE can draw';
  let report: ReturnType<typeof checkDrawableBitmaps>;
  try {
    report = checkDrawableBitmaps(view, header, tagIndex, { ignoreExternalBit: true });
  } catch (err) {
    return check('drawableBitmaps', label, 'refuse', `The bitmaps can't be read: ${(err as Error).message}`);
  }
  const scope = `${report.bitmapsChecked.toLocaleString('en-US')} bitmaps in ${report.tagsChecked} bitmap tags`;
  if (report.problems.length === 0) return check('drawableBitmaps', label, 'pass', `${scope}: OpenCE can draw every one.`);
  return check(
    'drawableBitmaps',
    label,
    'refuse',
    `${scope}: ${report.problems.length} can't be drawn by OpenCE, which then stops loading the map ("cannot be drawn by this build", then "game_load() failed"), so the map is not converted. The missing data is not in the file, so this can't be repaired here.`,
    report.problems.map((p) => p.text),
  );
}

function scriptCheck(view: Buffer, header: CacheFileHeader, tagIndex: TagIndex): ConversionCheck {
  const label = 'Script calls name their functions (OpenCE looks them up by name)';
  const scenario = tagIndex.entries[tagIndex.scenarioTagId & 0xffff];
  const scenarioStruct = getGroupStructName('scenario')!;
  if (!scenario || scenario.isExternal || scenario.primaryClassName !== 'scenario') {
    return check('scripts', label, 'refuse', "The scenario tag could not be found, so its scripts can't be checked.");
  }
  const at = resolveTagDataPointer(scenario.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  if (!isRangeInBuffer(at, resolveStruct(scenarioStruct).totalSize, view.length)) {
    return check('scripts', label, 'refuse', "The scenario tag is outside the file, so its scripts can't be checked.");
  }
  const decoded = decodeStruct(view, at, scenarioStruct);
  const count = (name: string) => {
    const v = decoded.get(name);
    return v?.kind === 'reflexive' ? v.value.count : 0;
  };
  const scripts = count('scripts');
  const globals = count('globals');
  const syntax = decoded.get('script syntax data');
  if (syntax?.kind !== 'tagDataOffset' || syntax.value.size === 0) {
    return check('scripts', label, 'pass', `The scenario has no script data (${scripts} script(s), ${globals} global(s)), so there is nothing to look up.`);
  }
  const unreadable = (why: string) =>
    check('scripts', label, 'refuse', `The scenario's script data can't be read the way OpenCE reads it (${why}). OpenCE refuses to load a map whose scripts it can't convert, so the map is not converted.`);
  const tableAt = resolvePointer(syntax.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
  if (syntax.value.size < SCRIPT_NODE_TABLE_HEADER_SIZE || !isRangeInBuffer(tableAt, syntax.value.size, view.length)) return unreadable('the node table is outside the file');
  // OpenCE's `struct data_array` (source/memory/data.h): maximum count +0x20, size +0x22, count +0x2E.
  // (The schema's ScenarioScriptNodeTable, from Invader, calls +0x2E "size" and +0x30 "count".)
  const maximum = view.readInt16LE(tableAt + DATA_ARRAY_MAXIMUM_COUNT);
  const elementSize = view.readInt16LE(tableAt + DATA_ARRAY_ELEMENT_SIZE);
  const used = view.readInt16LE(tableAt + DATA_ARRAY_COUNT);
  if (elementSize !== SCRIPT_NODE_SIZE) return unreadable(`its node size is ${elementSize}, not ${SCRIPT_NODE_SIZE}`);
  if (used < 0 || maximum < 0 || used > maximum) return unreadable(`${used} nodes in use of ${maximum}`);
  if (SCRIPT_NODE_TABLE_HEADER_SIZE + maximum * SCRIPT_NODE_SIZE > syntax.value.size) return unreadable(`${maximum} nodes don't fit in its ${syntax.value.size} bytes`);

  const strings = decoded.get('script string data');
  let stringsAt = -1;
  let stringBytes = 0;
  if (strings?.kind === 'tagDataOffset' && strings.value.size > 0) {
    stringsAt = resolvePointer(strings.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    stringBytes = isRangeInBuffer(stringsAt, strings.value.size, view.length) ? strings.value.size : 0;
  }
  /** OpenCE's `script_string_get`: an offset inside the string data with a 0 after it. */
  const nameAt = (offset: number): string | null => {
    if (offset < 0 || offset >= stringBytes) return null;
    const end = view.indexOf(0, stringsAt + offset);
    return end >= 0 && end < stringsAt + stringBytes ? view.toString('latin1', stringsAt + offset, end) : null;
  };
  const node = (i: number) => tableAt + SCRIPT_NODE_TABLE_HEADER_SIZE + i * SCRIPT_NODE_SIZE;
  const functions = new Map<string, number>();
  let calls = 0;
  let engineGlobals = 0;
  const problems: string[] = [];
  for (let i = 0; i < used; i++) {
    const n = node(i);
    if (view.readUInt16LE(n) === 0) continue;
    const flags = view.readUInt16LE(n + 6);
    if (!(flags & (SCRIPT_NODE_FLAG_PRIMITIVE | SCRIPT_NODE_FLAG_SCRIPT_CALL))) {
      const child = view.readUInt32LE(n + 16) & 0xffff;
      const called = child < used && view.readInt16LE(node(child) + 4) === SCRIPT_NODE_TYPE_FUNCTION_NAME ? nameAt(view.readInt32LE(node(child) + 12)) : null;
      if (called === null) {
        problems.push(`script node ${i}: a function call whose first child (node ${child}) is not a function name with a readable name`);
      } else {
        calls++;
        functions.set(called, (functions.get(called) ?? 0) + 1);
      }
    } else if (flags & SCRIPT_NODE_FLAG_PRIMITIVE && flags & SCRIPT_NODE_FLAG_GLOBAL && view.readUInt16LE(n + 16) & SCRIPT_ENGINE_GLOBAL_BIT) {
      if (nameAt(view.readInt32LE(n + 12)) === null) problems.push(`script node ${i}: an engine global reference without a readable name`);
      else engineGlobals++;
    }
  }
  if (problems.length > 0) {
    return check(
      'scripts',
      label,
      'refuse',
      `${problems.length} script node(s) don't name what they use. OpenCE looks every call and engine global up by its name and refuses to load the map when one has none, so the map is not converted.`,
      problems,
    );
  }
  if (calls === 0 && engineGlobals === 0) {
    return check('scripts', label, 'pass', `The scenario's scripts (${scripts} script(s), ${globals} global(s)) make no function calls and use no engine globals.`);
  }
  return check(
    'scripts',
    label,
    'pass',
    `${calls} function call(s) of ${functions.size} function(s) and ${engineGlobals} engine global reference(s), each naming what it uses in the script strings. OpenCE looks every one up again by name when it loads the map, so the function numbers stored by the source game (which differ between Halo versions) don't matter.`,
    [...functions.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([n, c]) => `${n}: ${c} call(s)`),
  );
}

function injectAfterwardsCheck(view: Buffer, header: CacheFileHeader, tagIndex: TagIndex): ConversionCheck {
  const label = 'Inject Tags can add tags to the converted map';
  try {
    collectTagDataPointers(view, tagDataLayoutOf(header, tagIndex));
    return check('injectAfterwards', label, 'pass', 'Every pointer in the map can be followed.');
  } catch (err) {
    if (!(err instanceof UnwalkableTagError)) throw err;
    return check(
      'injectAfterwards',
      label,
      'warn',
      "Inject Tags will refuse to add new tags to the converted map (ADD, or a SWAP that brings in tags the map doesn't have), because one tag has a pointer that can't be followed. Converting, opening, extracting, and a SWAP that adds no tags are not affected.",
      [err.message],
    );
  }
}

/** The full pre-flight report for the Convert dialog. Never throws for a malformed map; problems are checks. */
export function preflightRetailConversion(buffer: Buffer, resources: ConversionResourceFiles = {}): RetailConversionReport {
  return runChecks(buffer, true, resources).report;
}

/**
 * Where a retail-layout buffer came from when it is not the user's file itself: converter Phase 2
 * (`demo-to-ce.ts`) turns a true demo map into a retail-layout copy in memory and runs the same checks
 * and conversion on it. `rows` replace the retail layout row (they describe the demo map and the rebase).
 */
export interface SourceOrigin {
  rows: ConversionCheck[];
}

/** Phase 2 only: the pre-flight of a retail-layout copy made from another layout. */
export function preflightRetailLayoutCopy(buffer: Buffer, resources: ConversionResourceFiles, origin: SourceOrigin): RetailConversionReport {
  return runChecks(buffer, true, resources, origin).report;
}

/** Phase 2 only: converts a retail-layout copy made from another layout (see `SourceOrigin`). `copy` is the converter's own and may be changed in place. */
export function convertRetailLayoutCopy(copy: Buffer, options: RetailConversionOptions, origin: SourceOrigin): RetailConversionResult {
  return convertRetailLayout(copy, options, origin);
}

export interface RetailConversionResult {
  /**
   * The converted map: version 609 and the CE build string. Not finalized: the scenario name and
   * crc32 are set by `finalizeForSave` when it is written (the app's save path always does that).
   */
  buffer: Buffer;
  report: RetailConversionReport;
  /** Set when external bitmap and sound data was copied in. */
  imported: { rangesCopied: number; bytesAdded: number; insertAt: number; warnings: string[] } | null;
  /** Phase 1c: the bytes inserted after the tag names (offset from the tag data start) and the pointers moved. Applied before `repairs`. */
  alignment: { insertAt: number; bytes: number; pointersMoved: number; tolerated: number } | null;
  /** Tag data repairs applied, in order. */
  repairs: AppliedTagDataRepair[];
}

const ACKNOWLEDGEMENTS: { id: ConversionCheckId; option: 'acknowledgeScripts'; text: string }[] = [
  { id: 'scripts', option: 'acknowledgeScripts', text: 'scripts that may call the wrong function in Custom Edition' },
];

/**
 * Converts a retail-layout map. Refuses (ConversionRefusedError) when any header-level check refuses,
 * or when the scripts need an acknowledgement that wasn't given. Never mutates `source`.
 */
export function convertRetailToCustomEdition(source: Buffer, options: RetailConversionOptions): RetailConversionResult {
  return convertRetailLayout(source, options);
}

function convertRetailLayout(source: Buffer, options: RetailConversionOptions, origin?: SourceOrigin): RetailConversionResult {
  const { report, parsed } = runChecks(source, false, options.resources, origin);
  if (!report.canConvert) {
    const reasons = report.checks.filter((c) => c.status === 'refuse').map((c) => c.message);
    throw new ConversionRefusedError(`This map can't be converted. ${reasons.join(' ')}`);
  }
  const unacknowledged = ACKNOWLEDGEMENTS.filter((a) => report.checks.some((c) => c.id === a.id && c.requiresAcknowledgement) && !options[a.option]);
  if (unacknowledged.length > 0) {
    throw new ConversionRefusedError(`This map has ${unacknowledged.map((a) => a.text).join(' and ')}. Confirm that you understand this before converting.`, 'ACKNOWLEDGEMENT_REQUIRED');
  }
  const repairPlan = parsed?.repairPlan ?? null;
  const alignment = parsed?.alignment ?? null;
  const missingRepairs = [
    ...(alignment && !options.repairs?.alignTagData ? [{ id: 'alignTagData' as const, tagPath: 'all tags' }] : []),
    ...(repairPlan?.repairs ?? []).filter((r) => r.required && !options.repairs?.[r.id]),
  ];
  if (missingRepairs.length > 0) {
    throw new ConversionRefusedError(
      `OpenCE refuses this map without these repairs: ${missingRepairs.map((r) => `${REPAIR_ROWS[r.id].label} (${r.tagPath})`).join('; ')}. Tick them to convert.`,
      'REPAIR_REQUIRED',
    );
  }
  let out: Buffer;
  let imported: RetailConversionResult['imported'] = null;
  const plan = parsed?.importPlan ?? null;
  if (plan) {
    try {
      const result = importExternalData(source, plan, options.resources ?? {}, { onProgress: options.onProgress, shouldCancel: options.shouldCancel });
      out = result.buffer;
      imported = { rangesCopied: result.rangesCopied, bytesAdded: result.bytesAdded, insertAt: result.insertAt, warnings: [...plan.nameMismatches, ...plan.sizeMismatches] };
    } catch (err) {
      if (err instanceof RawDataAppendCancelledError) throw new ConversionRefusedError('Converting was cancelled. Nothing was written.', 'CANCELLED');
      throw err;
    }
  } else {
    // A Phase 2 copy belongs to the converter already; the user's own buffer is never changed.
    out = origin ? source : Buffer.from(source);
  }
  out.writeUInt32LE(CacheFileEngine.CUSTOM_EDITION, VERSION_OFFSET);
  writeFixedString(out, BUILD_STRING_OFFSET, TAG_STRING_SIZE, CE_BUILD_STRING);
  let aligned: RetailConversionResult['alignment'] = null;
  if (alignment) {
    const result = applyTagDataAlignment(out, alignment);
    out = result.buffer;
    aligned = { insertAt: alignment.insertAt, bytes: alignment.bytes, pointersMoved: result.moved, tolerated: alignment.tolerated.length };
  }
  let repairs: AppliedTagDataRepair[] = [];
  const chosen = (repairPlan?.repairs ?? []).filter((r) => options.repairs?.[r.id]);
  if (repairPlan && chosen.length > 0) {
    const applied = applyTagDataRepairs(out, repairPlan, chosen);
    out = applied.buffer;
    repairs = applied.applied;
  }
  verifyOutputExtents(out);
  verifyOutputAlignment(out);
  verifyOutputBitmaps(out);
  return { buffer: out, report, imported, alignment: aligned, repairs };
}

/**
 * The block check runs again on the converted map before anything is written; any problem refuses
 * the conversion. Same-reader (it shares the schema engine with the conversion); anchored by 0
 * problems on the 5 CE sample maps and by the exact match with the addresses OpenCE logged.
 */
function verifyOutputExtents(out: Buffer): void {
  let violations: string[];
  try {
    const header = parseCacheFileHeader(out);
    violations = checkTagDataExtents(out, header, parseTagIndex(out, header)).violations.map((v) => v.text);
  } catch (err) {
    violations = [`The converted map can't be read back: ${(err as Error).message}`];
  }
  if (violations.length > 0) {
    throw new ConversionRefusedError(
      `The converted map still has tag data problems OpenCE would refuse, so nothing was written: ${violations.slice(0, 5).join('; ')}${violations.length > 5 ? ` (and ${violations.length - 5} more)` : ''}.`,
    );
  }
}

/** OpenCE's bitmap check, run again on the converted map (its real flags) before anything is written. */
function verifyOutputBitmaps(out: Buffer): void {
  let problems: string[];
  try {
    const header = parseCacheFileHeader(out);
    problems = checkDrawableBitmaps(out, header, parseTagIndex(out, header)).problems.map((p) => p.text);
  } catch (err) {
    problems = [`its bitmaps can't be read: ${(err as Error).message}`];
  }
  if (problems.length > 0) throw new ConversionRefusedError(`The converted map has bitmaps OpenCE can't draw, so nothing was written: ${problems.slice(0, 3).join('; ')}.`);
}

/**
 * OpenCE's `loaded_block_get` alignment rule, run again on the converted map before anything is
 * written: any unaligned block, tag or data block refuses the conversion. Same-reader (the schema walk).
 */
function verifyOutputAlignment(out: Buffer): void {
  let problem: string | null = null;
  try {
    const header = parseCacheFileHeader(out);
    const r = measureBlockAlignment(out, header, parseTagIndex(out, header));
    const unaligned = r.blocks.unaligned + r.bspBlocks.unaligned + r.roots.unaligned + r.dataBlocks.unaligned;
    if (unaligned > 0) problem = `${unaligned} block(s) are not 4-aligned (${r.examples.slice(0, 3).join('; ')})`;
  } catch (err) {
    problem = `its blocks can't be walked: ${(err as Error).message}`;
  }
  if (problem) throw new ConversionRefusedError(`The converted map would still have blocks OpenCE skips, so nothing was written: ${problem}.`);
}
