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
import { applyTagDataRepairs, planTagDataRepairs, repairBytesAdded } from './tag-data-repairs';
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
  | 'fileSize'
  | 'padding'
  | 'tagDataAddress'
  | 'entryFlags'
  | 'regions'
  | 'validation'
  | 'referenceIdentity'
  | 'requiredTags'
  | 'scripts'
  | 'injectAfterwards'
  | 'scenarioName'
  | 'tagFileChecksum'
  | 'tagDataExtents'
  | 'modelParts'
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
}

/**
 * Header-level checks that decide whether the map can be converted at all (each refuses), plus the
 * script check (needs acknowledgement). `full` adds the slower warnings (validation, references,
 * required tags, pointer walk) used for the pre-flight dialog.
 */
function runChecks(buffer: Buffer, full: boolean, resources: ConversionResourceFiles = {}): { report: RetailConversionReport; parsed: ParsedView | null } {
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
    checks.push(check('layout', layoutLabel, 'refuse', 'This is an original Halo demo map (true demo layout, version 6). Converting this layout is not supported yet (Phase 2).'));
    return done(null);
  }
  if (layout.kind !== 'retail') {
    checks.push(check('layout', layoutLabel, 'refuse', layout.kind === 'otherVersion' ? `Cache version ${layout.version} can't be converted; only version 7 (retail layout) can.` : 'This does not look like a Halo map file.'));
    return done(null);
  }
  checks.push(check('layout', layoutLabel, 'pass', 'Standard header, cache version 7.'));

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
    parsed = { header, tagIndex, view, importPlan: null, repairPlan: null };
  } catch (err) {
    checks.push(check('regions', 'Tag index can be read', 'refuse', `The tag index can't be read: ${(err as Error).message}`));
    return done(null);
  }
  const { header, tagIndex, view } = parsed;
  report.tagCount = tagIndex.tagCount;

  // Retail maps have no CE "external" flag: a nonzero word here would be read by CE as external.
  const arrayAt = header.tagDataOffset + TAG_DATA_HEADER_PC_SIZE;
  const flagged: string[] = [];
  for (const e of tagIndex.entries) {
    const at = arrayAt + e.index * TAG_ENTRY_SIZE;
    const w18 = buffer.readUInt32LE(at + 0x18);
    const w1c = buffer.readUInt32LE(at + 0x1c);
    if (w18 !== 0 || w1c !== 0) flagged.push(`#${e.index} ${e.path}.${e.primaryClassName}: +0x18 = ${hex(w18)}, +0x1C = ${hex(w1c)}`);
  }
  checks.push(
    flagged.length === 0
      ? check('entryFlags', 'No tag entry is marked external (whole tags)', 'pass', `All ${tagIndex.tagCount} tag entries have 0 at +0x18 and +0x1C, so every tag is inside the map.`)
      : check('entryFlags', 'No tag entry is marked external (whole tags)', 'refuse', `${flagged.length} tag entr${flagged.length === 1 ? 'y has' : 'ies have'} a nonzero word at +0x18 or +0x1C. Custom Edition would read those tags as external (in bitmaps/sounds/loc.map), so the map is not converted.`, flagged),
  );

  const regionsLabel = 'BSP, model data and tag data are inside the file';
  let headerOnlyCrc: number | null = null;
  try {
    headerOnlyCrc = computeCacheCrc32(view, ceCrcRegions(view, header, tagIndex));
  } catch (err) {
    checks.push(check('regions', regionsLabel, 'refuse', (err as Error).message));
  }

  parsed.repairPlan = tagDataChecks(checks, view, header, tagIndex, report);

  const scan = scanPerAssetData(view, header, tagIndex);
  const counts = countExternal(scan);
  report.externalData = { bitmaps: counts.bitmap, sounds: counts.sound };
  if (counts.bitmap.count + counts.sound.count === 0 && scan.blocked.length === 0) {
    report.newCrc32 = parsed.repairPlan?.repairs.length ? null : headerOnlyCrc;
    report.estimatedOutputSize = buffer.length + requiredRepairBytes(header, parsed.repairPlan);
    if (headerOnlyCrc !== null && report.newCrc32 !== null) checks.push(check('regions', regionsLabel, 'pass', `New CRC32 ${hex(headerOnlyCrc)} (was ${hex(report.previousCrc32)}).`));
    else if (headerOnlyCrc !== null) checks.push(check('regions', regionsLabel, 'pass', 'The new CRC32 is computed after the tag data repairs.'));
    checks.push(check('externalData', 'Bitmap and sound data is inside the map', 'pass', 'No bitmap image or sound permutation keeps its data in a resource file.'));
  } else {
    if (headerOnlyCrc !== null) checks.push(check('regions', regionsLabel, 'pass', 'The new CRC32 is computed after the bitmap and sound data is copied in.'));
    parsed.importPlan = externalDataChecks(checks, view, scan, counts, resources, buffer.length + requiredRepairBytes(header, parsed.repairPlan), report);
  }

  checks.push(modelPartsCheck(view, header, tagIndex));
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

/** Bytes the required repairs add (the estimate assumes optional repairs stay unticked). */
function requiredRepairBytes(header: CacheFileHeader, plan: TagDataRepairPlan | null): number {
  return plan ? repairBytesAdded(header.tagDataSize, plan.repairs.filter((r) => r.required)) : 0;
}

const REPAIR_ROWS: Record<TagDataRepairId, { id: ConversionCheckId; label: string; required: string; optional: string }> = {
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

/**
 * The tag data block check (what OpenCE's validator refuses: `extent-check.ts`) and a row per
 * repair that fixes a problem (`tag-data-repairs.ts`). A problem no repair covers refuses the map.
 * Measured: 0 problems on all 5 CE sample maps and HaloMD heh_2; theisland_3 / barrier: the
 * script syntax data overlaps other tags; crossing: #2404 sound_environment starts at the tag data end.
 * Every HaloMD map's script data is also 2 mod 4 (a required repair on its own, `tag-data-repairs.ts`).
 */
function tagDataChecks(checks: ConversionCheck[], view: Buffer, header: CacheFileHeader, tagIndex: TagIndex, report: RetailConversionReport): TagDataRepairPlan {
  const extents = checkTagDataExtents(view, header, tagIndex);
  const plan = planTagDataRepairs(view, header, tagIndex, extents);
  const label = "Tag blocks are inside the tag data and don't overlap";
  const scope = `${extents.blocksChecked.toLocaleString('en-US')} blocks in ${extents.tagsChecked} tags and ${extents.bspsChecked} structure BSP(s) checked the way OpenCE checks them`;
  const problems = extents.violations.length;
  if (plan.unrepairable.length > 0) {
    checks.push(
      check('tagDataExtents', label, 'refuse', `${scope}: ${problems} problem(s). OpenCE refuses this map, and ${plan.unrepairable.length} problem(s) can't be repaired here, so the map is not converted.`, plan.unrepairable),
    );
  } else if (problems === 0) {
    checks.push(check('tagDataExtents', label, 'pass', `${scope}: no problems.`));
  } else {
    checks.push(check('tagDataExtents', label, 'warn', `${scope}: ${problems} problem(s). OpenCE refuses a map with any of these; each is fixed by a required repair below.`, extents.violations.map((v) => v.text)));
  }
  plan.repairs.forEach((r, i) => {
    const row = REPAIR_ROWS[r.id];
    // (with the repairs before it applied: each block's padding depends on where the last one ended)
    const bytes = repairBytesAdded(header.tagDataSize, plan.repairs.slice(0, i + 1)) - repairBytesAdded(header.tagDataSize, plan.repairs.slice(0, i));
    report.repairs.push({ id: r.id, required: r.required, tagPath: r.tagPath, bytesAdded: bytes });
    checks.push(check(row.id, row.label, r.required ? 'warn' : 'info', `${r.required ? row.required : row.optional} Adds ${fmtBytes(bytes)}.`, r.details, false, { id: r.id, required: r.required }));
  });
  return plan;
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

function referenceIdentityCheck(view: Buffer, header: CacheFileHeader, tagIndex: TagIndex): ConversionCheck {
  const issues = findReferenceIdentityIssues(view, header, tagIndex);
  const label = 'Tag references carry their tag\'s exact ID and path pointer';
  if (issues.length === 0) return check('referenceIdentity', label, 'pass', 'Every non-null reference matches its tag entry.');
  return check(
    'referenceIdentity',
    label,
    'warn',
    `${issues.length} reference${issues.length === 1 ? '' : 's'} point${issues.length === 1 ? 's' : ''} at a tag with an outdated tag ID or path pointer, most likely left over from the demo version of this map. ` +
      'The Custom Edition sample maps have none of these. They are converted unchanged. If the converted map crashes, or scenery or sounds are missing in OpenCE, check these first.',
    issues.map((i) => `${i.context}: tag ID ${hex(i.tagId)} (tag entry ${i.entryTagId === null ? 'missing' : hex(i.entryTagId)}), path pointer ${hex(i.pathPointer)} (tag entry ${i.entryPathPointer === null ? 'missing' : hex(i.entryPathPointer)})`),
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

const SCRIPT_NODE_TABLE_HEADER_SIZE = 56;
const SCRIPT_NODE_FLAG_PRIMITIVE = 0x1;
const SCRIPT_NODE_FLAG_SCRIPT_CALL = 0x2;

/**
 * Halo demo and Custom Edition number some script functions differently (RIAT definitions: 19
 * console/server functions, e.g. sv_map 493 -> 492; memory/demo-converter.md). The complete list is
 * not in this repo, so any function call in a map with scripts or globals needs an explicit
 * acknowledgement. No remapping is done. A function call node is a used node (salt != 0) that is
 * neither a primitive nor a script call (`ScenarioScriptNodeFlags`).
 */
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

function scriptCheck(view: Buffer, header: CacheFileHeader, tagIndex: TagIndex): ConversionCheck {
  const label = 'Scripts that may call the wrong function in Custom Edition';
  const scenario = tagIndex.entries[tagIndex.scenarioTagId & 0xffff];
  const scenarioStruct = getGroupStructName('scenario')!;
  if (!scenario || scenario.isExternal || scenario.primaryClassName !== 'scenario') {
    return check('scripts', label, 'warn', 'The scenario tag could not be found, so its scripts were not checked. Function numbering differs between demo and Custom Edition for some functions.', [], true);
  }
  const at = resolveTagDataPointer(scenario.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  if (!isRangeInBuffer(at, resolveStruct(scenarioStruct).totalSize, view.length)) {
    return check('scripts', label, 'warn', 'The scenario tag is outside the file, so its scripts were not checked.', [], true);
  }
  const decoded = decodeStruct(view, at, scenarioStruct);
  const count = (name: string) => {
    const v = decoded.get(name);
    return v?.kind === 'reflexive' ? v.value.count : 0;
  };
  const scripts = count('scripts');
  const globals = count('globals');
  if (scripts === 0 && globals === 0) return check('scripts', label, 'pass', 'The scenario has no scripts and no script globals, so no script function numbers are involved.');

  const syntax = decoded.get('script syntax data');
  const unreadable = () =>
    check('scripts', label, 'warn', `The scenario has ${scripts} script(s) and ${globals} global(s), but its script node table could not be read. Some script functions are numbered differently in demo and Custom Edition; nothing is remapped.`, [], true);
  if (syntax?.kind !== 'tagDataOffset' || syntax.value.size < SCRIPT_NODE_TABLE_HEADER_SIZE) return unreadable();
  const tableAt = resolvePointer(syntax.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
  if (!isRangeInBuffer(tableAt, syntax.value.size, view.length)) return unreadable();
  const table = decodeStruct(view, tableAt, 'ScenarioScriptNodeTable');
  const num = (name: string) => {
    const v = table.get(name);
    return v?.kind === 'basic' ? Number(v.value) : -1;
  };
  const maximum = num('maximum count');
  const elementSize = num('element size');
  if (maximum < 0 || elementSize < 8 || SCRIPT_NODE_TABLE_HEADER_SIZE + maximum * elementSize > syntax.value.size) return unreadable();
  const functionIndices = new Map<number, number>();
  if (num('count') > 0) {
    for (let i = 0; i < maximum; i++) {
      const node = tableAt + SCRIPT_NODE_TABLE_HEADER_SIZE + i * elementSize;
      if (view.readUInt16LE(node) === 0) continue;
      const flags = view.readUInt16LE(node + 6);
      if (flags & (SCRIPT_NODE_FLAG_PRIMITIVE | SCRIPT_NODE_FLAG_SCRIPT_CALL)) continue;
      const index = view.readUInt16LE(node + 2);
      functionIndices.set(index, (functionIndices.get(index) ?? 0) + 1);
    }
  }
  const calls = [...functionIndices.values()].reduce((a, b) => a + b, 0);
  if (calls === 0) return check('scripts', label, 'pass', `The scenario has ${scripts} script(s) and ${globals} global(s), with no function calls.`);
  return check(
    'scripts',
    label,
    'warn',
    `The scenario's ${scripts} script(s) and ${globals} global(s) make ${calls} function call(s) (${functionIndices.size} different functions). Halo demo and Custom Edition number some script functions differently (at least 19 console/server functions, for example sv_map), and this tool does not check or remap which ones the scripts use. In Custom Edition a script may call the wrong function.`,
    [...functionIndices.entries()].sort((a, b) => a[0] - b[0]).map(([index, n]) => `function #${index}: ${n} call(s)`),
    true,
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

export interface RetailConversionResult {
  /**
   * The converted map: version 609 and the CE build string. Not finalized: the scenario name and
   * crc32 are set by `finalizeForSave` when it is written (the app's save path always does that).
   */
  buffer: Buffer;
  report: RetailConversionReport;
  /** Set when external bitmap and sound data was copied in. */
  imported: { rangesCopied: number; bytesAdded: number; insertAt: number; warnings: string[] } | null;
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
  const { report, parsed } = runChecks(source, false, options.resources);
  if (!report.canConvert) {
    const reasons = report.checks.filter((c) => c.status === 'refuse').map((c) => c.message);
    throw new ConversionRefusedError(`This map can't be converted. ${reasons.join(' ')}`);
  }
  const unacknowledged = ACKNOWLEDGEMENTS.filter((a) => report.checks.some((c) => c.id === a.id && c.requiresAcknowledgement) && !options[a.option]);
  if (unacknowledged.length > 0) {
    throw new ConversionRefusedError(`This map has ${unacknowledged.map((a) => a.text).join(' and ')}. Confirm that you understand this before converting.`, 'ACKNOWLEDGEMENT_REQUIRED');
  }
  const repairPlan = parsed?.repairPlan ?? null;
  const missingRepairs = (repairPlan?.repairs ?? []).filter((r) => r.required && !options.repairs?.[r.id]);
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
    out = Buffer.from(source);
  }
  out.writeUInt32LE(CacheFileEngine.CUSTOM_EDITION, VERSION_OFFSET);
  writeFixedString(out, BUILD_STRING_OFFSET, TAG_STRING_SIZE, CE_BUILD_STRING);
  let repairs: AppliedTagDataRepair[] = [];
  const chosen = (repairPlan?.repairs ?? []).filter((r) => options.repairs?.[r.id]);
  if (repairPlan && chosen.length > 0) {
    const applied = applyTagDataRepairs(out, repairPlan, chosen);
    out = applied.buffer;
    repairs = applied.applied;
  }
  verifyOutputExtents(out);
  return { buffer: out, report, imported, repairs };
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
