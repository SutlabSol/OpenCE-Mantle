import {
  CACHE_FILE_HEADER_SIZE,
  CacheFileEngine,
  CacheFileLiteral,
  CE_BASE_MEMORY_ADDRESS,
  CE_TAG_ARRAY_ADDRESS,
  CE_TAG_SPACE_SIZE,
  TAG_DATA_HEADER_PC_SIZE,
  TAG_DATA_HEADER_XBOX_SIZE,
  TAG_ENTRY_SIZE,
  TAG_STRING_SIZE,
  XBOX_BASE_MEMORY_ADDRESS,
} from '../constants/cache-file';
import { fourCCToString, lookupTagClass } from '../constants/tag-classes';
import { readFixedString, writeFixedString } from '../binary/strings';
import { parseCacheFileHeader } from './header';
import { parseTagIndex } from './tag-index';
import { ensureXboxMapDecompressed } from './compression';
import { ceCrcRegions, computeCacheCrc32 } from './cache-crc';
import {
  BSP_SPACE_POINTER_KINDS,
  collectBspSpacePointers,
  collectTagDataPointers,
  TAG_DATA_POINTER_KINDS,
  tagDataLayoutOf,
} from './pointer-rebase';
import type { TagDataLayout, ToleratedPointer } from './pointer-rebase';
import {
  CE_BUILD_STRING,
  convertRetailLayoutCopy,
  type ConversionResourceFiles,
} from './convert/retail-to-ce';
import { readResourceTable, type RandomAccessFile, type ResourceKind, type ResourceTable } from './convert/resource-files';
import { countExternal, importExternalData, planExternalImport, scanPerAssetData } from './convert/externalize-in';
import { applyTagDataAlignment, planTagDataAlignment } from './convert/align-tag-data';
import { applyTagDataRepairs, planTagDataRepairs } from './convert/tag-data-repairs';
import { checkTagDataExtents } from './convert/extent-check';
import { parseTagIndexForConversion } from './convert/scenario-tag';
import { repairCorruptedModelPartStrips, repairTruncatedBitmapMipmaps } from './deprotect';
import { unpackCompressedUnitVector32 } from '../render/bsp-geometry';
import { unswizzleMorton2D } from '../render/bitmap-textures';

export type MapFixActionKind = 'ce' | 'mcc' | 'demo' | 'halomd' | 'xbox';

export interface HaloScriptNodeFixEntry {
  nodeIndex: number;
  scriptName: string;
  action: 'neutralized' | 'converted_to_game_revert' | 'already_fixed';
  expression: string;
  reason: string;
  targetName?: string;
  kind?: 'function_call' | 'global_set';
}

export interface CeMapFixResult {
  mapName: string;
  previousCrc32: number;
  newCrc32: number;
  crcUpdated: boolean;
  totalSyntaxNodes: number;
  scriptsChecked: number;
  nodesNeutralized: number;
  nodesConvertedToGameRevert: number;
  nodesAlreadyFixed: number;
  alreadyFixedNodes: number;
  affectedScripts: string[];
  fixedNodes: HaloScriptNodeFixEntry[];
  mutations: HaloScriptNodeFixEntry[];
}

export interface MapFixOptions {
  /** Source game resource files (bitmaps.map, sounds.map) for internalizing external assets. */
  resources?: ConversionResourceFiles;
  /** Custom Edition resource files (bitmaps.map, sounds.map, loc.map) for fallback stock tag linking/internalization. */
  ceResources?: {
    bitmaps?: RandomAccessFile;
    sounds?: RandomAccessFile;
    loc?: Buffer;
  };
  onProgress?: (bytesDone: number, bytesTotal: number) => void;
}

export interface MapFixActionResult {
  action: MapFixActionKind;
  ok: boolean;
  isPlaceholder?: boolean;
  message: string;
  sourceEngineVersion: number | null;
  targetEngineVersion: number;
  mapName: string;
  previousCrc32: number | null;
  newCrc32: number | null;
  sourceByteLength: number;
  outputByteLength: number;
  pointersRebased: number;
  externalRangesInternalized: number;
  externalTagsLinkedToCe: number;
  modelsConverted: number;
  bspsDecompressed: number;
  bitmapsDeswizzled: number;
  p8BitmapsConverted: number;
  scriptFix: CeMapFixResult | null;
  details: string[];
  buffer: Buffer | null;
}

/**
 * OpenCE's 8 whitelisted external globals allowed inside `(set <external_global> <value>)`.
 */
export const ALLOWED_SETTABLE_GLOBALS: ReadonlySet<string> = new Set([
  'rasterizer_near_clip_distance',
  'rasterizer_far_clip_distance',
  'rasterizer_first_person_weapon_near_clip_distance',
  'rasterizer_first_person_weapon_far_clip_distance',
  'cheat_deathless_player',
  'rider_ejection',
  'stun_enable',
  'weather',
]);

/**
 * Engine functions refused by OpenCE's `hs_syntax_node_refusal` (`source/hs/hs.c`).
 */
export const DISALLOWED_FUNCTIONS: ReadonlySet<string> = new Set([
  'cond',
  'ai_debug_communication_suppress',
  'ai_debug_communication_ignore',
  'ai_debug_communication_focus',
  'sound_set_gain',
  'sound_get_gain',
  'sound_enable',
  'debug_sounds_enable',
  'debug_sounds_distances',
  'debug_sounds_wet',
  'script_recompile',
  'script_doc',
  'help',
  'objects_dump_memory',
  'render_effects',
  'cheat_all_powerups',
  'cheat_all_weapons',
  'cheat_all_vehicles',
  'cheat_teleport_to_camera',
  'cheat_active_camouflage',
  'cheat_active_camouflage_local_player',
  'cheats_load',
  'ai_select',
  'ai_deselect',
  'ai_lines',
  'ai_debug_sound_point_set',
  'ai_debug_vocalize',
  'ai_debug_teleport_to',
  'ai_debug_speak',
  'ai_debug_speak_list',
  'debug_camera_load',
  'debug_camera_save',
  'debug_teleport_player',
  'game_variant',
  'map_reset',
  'map_name',
  'multiplayer_map_name',
  'game_difficulty_set',
  'crash',
  'version',
  'playback',
  'attract_mode_start',
  'texture_cache_flush',
  'sound_cache_flush',
  'debug_memory',
  'debug_memory_by_file',
  'debug_memory_for_file',
  'debug_tags',
  'debug_pvs',
  'profile_reset',
  'profile_dump',
  'profile_activate',
  'profile_deactivate',
  'profile_graph_toggle',
  'radiosity_start',
  'radiosity_save',
  'radiosity_debug_point',
  'core_save',
  'core_save_name',
  'core_load',
  'core_load_at_startup',
  'core_load_name',
  'core_load_name_at_startup',
  'error_overflow_suppression',
  'structure_lens_flares_place',
  'rasterizer_fps_accumulate',
  'enumerate_memory_units',
  'delete_save_game_files',
  'fast_setup_network_server',
  'profile_unlock_solo_levels',
  'ui_widget_show_path',
  'network_game_start_now',
  'xbox_set_machine_name',
  'mods_reload',
  'mods_enable',
  'mods_list',
  'structure_culling',
  'debug_structure_culling',
]);

const GAME_REVERT_FUNCTION_INDEX = 320;

interface MutableSyntaxNode {
  index: number;
  fileOffset: number;
  identifier: number;
  constantType: number;
  type: number;
  flags: number;
  nextNodeIndex: number;
  stringOffset: number;
  data: number;
}

function readNullTerminatedAscii(buffer: Buffer, baseOffset: number, maxBytes: number, relativeOffset: number): string {
  if (relativeOffset < 0 || relativeOffset >= maxBytes) return '';
  const start = baseOffset + relativeOffset;
  const limit = Math.min(buffer.length, baseOffset + maxBytes);
  if (start < 0 || start >= limit) return '';
  let end = start;
  while (end < limit && buffer[end] !== 0) end++;
  return buffer.toString('latin1', start, end);
}

function findNullTerminatedStringOffset(buffer: Buffer, stringsOffset: number, stringsSize: number, target: string): number {
  const limit = Math.min(buffer.length, stringsOffset + stringsSize);
  const needle = Buffer.from(`${target}\0`, 'latin1');
  let searchPos = stringsOffset;
  while (searchPos + needle.length <= limit) {
    const idx = buffer.indexOf(needle, searchPos);
    if (idx < 0 || idx + needle.length > limit) return -1;
    if (idx === stringsOffset || buffer[idx - 1] === 0) {
      return idx - stringsOffset;
    }
    searchPos = idx + 1;
  }
  return -1;
}

/**
 * Recomputes the Custom Edition header CRC32 (`0x64`) over:
 * 1) Contiguous Structure BSP bytes (`scenario + 0x5A4`)
 * 2) Raw Model Vertex + Index Data (`model_data_offset .. model_data_offset + model_data_size`)
 * 3) Tag Data (`tag_data_offset .. tag_data_offset + tag_data_size`)
 */
export function recomputeCustomEditionHeaderCrc32(buffer: Buffer): number {
  const header = parseCacheFileHeader(buffer);
  const tagIndex = parseTagIndexForConversion(buffer, header);
  const crc = computeCacheCrc32(buffer, ceCrcRegions(buffer, header, tagIndex));
  buffer.writeUInt32LE(crc >>> 0, 0x64);
  return crc >>> 0;
}

const OBJECT_CLASS_EXPECTED_TYPE: ReadonlyMap<number, number> = new Map<number, number>([
  [0x62697064, 0], // 'bipd'
  [0x76656869, 1], // 'vehi'
  [0x77656170, 2], // 'weap'
  [0x65716970, 3], // 'eqip'
  [0x67617262, 4], // 'garb'
  [0x70726f6a, 5], // 'proj'
  [0x7363656e, 6], // 'scen'
  [0x6d616368, 7], // 'mach'
  [0x6374726c, 8], // 'ctrl'
  [0x6c696669, 9], // 'lifi'
  [0x706c6163, 10], // 'plac'
  [0x73736365, 11], // 'ssce'
]);

const SHADER_CLASS_EXPECTED_TYPE: ReadonlyMap<number, number> = new Map<number, number>([
  [0x73656e76, 3], // 'senv' (shader_environment)
  [0x736f736f, 4], // 'soso' (shader_model)
  [0x736f7472, 5], // 'sotr' (shader_transparent_generic)
  [0x73636869, 6], // 'schi' (shader_transparent_chicago)
  [0x73636578, 7], // 'scex' (shader_transparent_chicago_extended)
  [0x73776174, 8], // 'swat' (shader_transparent_water)
  [0x73676c61, 9], // 'sgla' (shader_transparent_glass)
  [0x736d6574, 10], // 'smet' (shader_transparent_meter)
  [0x73706c61, 11], // 'spla' (shader_transparent_plasma)
]);

const CE_MAX_HS_SYNTAX_NODES = 19001; // 0x4A39
const CE_MAX_HS_SYNTAX_DATA_BYTES = 56 + CE_MAX_HS_SYNTAX_NODES * 20; // 380076 (0x5CCAC)
const CE_STANDARD_TAG_SPACE_SIZE = 0x01700000; // 23 MB standard OpenCE tag cache ceiling (0x41B40000)

export interface MccAndCeTagRepairSummary {
  headerFlagsCleared: boolean;
  hsSyntaxClamped: boolean;
  previousSyntaxDataSize: number;
  previousSyntaxMaxCount: number;
  objectTypesRepaired: number;
  fontCharsRepaired: number;
  bitmapSequencesRepaired: number;
  bitmapFlagsRepaired: number;
  shadersRepaired: number;
  modelPartsRepaired: number;
}

/**
 * Repairs MCC / H1EK & Custom Edition tag compatibility issues that cause OpenCE's
 * `custom_edition_tag_validate`, `custom_edition_bitmaps_verify`, or `custom_edition_scripts_convert`
 * to refuse, warn, or fail to render bitmaps/shaders on a map:
 * 1) Clears non-zero header flags at `0x68` (MCC `v13` sets `0x07`, which OpenCE refuses as OpenSauce/flagged).
 * 2) Clamps MCC's 32,767-node `hs_syntax_data` table (`655,396` bytes, `maximum_count = 32767`) to OpenCE's
 *    19,001-node ceiling (`380,076` bytes, `maximum_count = 19001`). Without clamping `syntax->maximum_count`,
 *    OpenCE truncates `hs_syntax_data.size` to `380,076` and then refuses the map in `custom_edition_scripts_convert`!
 * 3) Repairs byte-swapped `_object_definition.type` (`+0x00`, e.g. `0x0600 = 1536` -> `6` on MCC H1EK / loose `scen` tags).
 * 4) Repairs `font` characters with negative `bitmap_width` / `bitmap_height` / `character_width` (e.g. `ui\gamespy`).
 * 5) Repairs `BitmapData.flags` (`+0x0E`): strips unsupported MCC upper bits `9..15` (e.g. `0x200` in `0x283`/`0x281`,
 *    which fails `bitmap_verify` in `source/bitmaps/bitmaps.c:1229`) and ensures bit 7 (`0x0080`, `_bitmap_cached_bit`)
 *    is set so OpenCE's `_texture_cache_bitmap_get_hardware_format` binds the hardware texture.
 * 6) Repairs byte-swapped `_shader.type` (`+0x24`) and uninitialized/byte-swapped `soso`/`senv` runtime scale fields.
 * 7) Repairs uninitialized `mod2` `GBXModelGeometryPart` `previous_part_index`/`next_part_index` (`-1`) and node weights.
 */
export function repairMccAndCeTagIssues(buffer: Buffer): MccAndCeTagRepairSummary {
  const summary: MccAndCeTagRepairSummary = {
    headerFlagsCleared: false,
    hsSyntaxClamped: false,
    previousSyntaxDataSize: 0,
    previousSyntaxMaxCount: 0,
    objectTypesRepaired: 0,
    fontCharsRepaired: 0,
    bitmapSequencesRepaired: 0,
    bitmapFlagsRepaired: 0,
    shadersRepaired: 0,
    modelPartsRepaired: 0,
  };

  if (buffer.length < CACHE_FILE_HEADER_SIZE) return summary;

  const headerFlags = buffer.readUInt32LE(0x068);
  if (headerFlags !== 0) {
    buffer.writeUInt32LE(0, 0x068);
    summary.headerFlagsCleared = true;
  }

  const tagDataOffset = buffer.readUInt32LE(0x010);
  const tagDataSize = buffer.readUInt32LE(0x014);
  if (tagDataOffset < CACHE_FILE_HEADER_SIZE || tagDataOffset + TAG_DATA_HEADER_PC_SIZE > buffer.length) {
    return summary;
  }

  const tagInstancesAddress = buffer.readUInt32LE(tagDataOffset + 0x00);
  const baseAddress = (tagInstancesAddress - TAG_DATA_HEADER_PC_SIZE) >>> 0;
  const scenarioDatumHandle = buffer.readUInt32LE(tagDataOffset + 0x04);
  const scenarioTagIndex = scenarioDatumHandle & 0xffff;
  const tagCount = buffer.readUInt32LE(tagDataOffset + 0x0c);
  const tagInstancesOffset = tagDataOffset + TAG_DATA_HEADER_PC_SIZE;

  if (
    scenarioTagIndex < tagCount &&
    tagInstancesOffset + (scenarioTagIndex + 1) * TAG_ENTRY_SIZE <= buffer.length
  ) {
    const scenarioEntryOffset = tagInstancesOffset + scenarioTagIndex * TAG_ENTRY_SIZE;
    const scenarioAddress = buffer.readUInt32LE(scenarioEntryOffset + 0x14);
    const scenarioOffset = tagDataOffset + ((scenarioAddress - baseAddress) | 0);
    if (scenarioOffset >= tagDataOffset && scenarioOffset + 0x5b0 <= buffer.length) {
      const syntaxSize = buffer.readInt32LE(scenarioOffset + 0x474);
      const syntaxAddress = buffer.readUInt32LE(scenarioOffset + 0x474 + 0x0c);
      summary.previousSyntaxDataSize = syntaxSize;
      if (syntaxSize > CE_MAX_HS_SYNTAX_DATA_BYTES) {
        buffer.writeInt32LE(CE_MAX_HS_SYNTAX_DATA_BYTES, scenarioOffset + 0x474);
        summary.hsSyntaxClamped = true;
      }
      if (syntaxAddress >= baseAddress && syntaxAddress < baseAddress + tagDataSize) {
        const syntaxOffset = tagDataOffset + ((syntaxAddress - baseAddress) | 0);
        if (syntaxOffset >= tagDataOffset && syntaxOffset + 0x38 <= buffer.length) {
          const maxCount = buffer.readInt16LE(syntaxOffset + 0x20);
          summary.previousSyntaxMaxCount = maxCount;
          if (maxCount > CE_MAX_HS_SYNTAX_NODES) {
            buffer.writeInt16LE(CE_MAX_HS_SYNTAX_NODES, syntaxOffset + 0x20);
            summary.hsSyntaxClamped = true;
          }
          if (buffer.readUInt16LE(syntaxOffset + 0x2c) > CE_MAX_HS_SYNTAX_NODES) {
            buffer.writeUInt16LE(CE_MAX_HS_SYNTAX_NODES, syntaxOffset + 0x2c);
          }
          if (buffer.readInt16LE(syntaxOffset + 0x2e) > CE_MAX_HS_SYNTAX_NODES) {
            buffer.writeInt16LE(CE_MAX_HS_SYNTAX_NODES, syntaxOffset + 0x2e);
          }
          if (buffer.readInt16LE(syntaxOffset + 0x30) > CE_MAX_HS_SYNTAX_NODES) {
            buffer.writeInt16LE(CE_MAX_HS_SYNTAX_NODES, syntaxOffset + 0x30);
          }
        }
      }
    }
  }

  const maxEntries = Math.min(tagCount, Math.floor((buffer.length - tagInstancesOffset) / TAG_ENTRY_SIZE));
  for (let i = 0; i < maxEntries; i++) {
    const eOff = tagInstancesOffset + i * TAG_ENTRY_SIZE;
    const isExternal = buffer.readUInt32LE(eOff + 0x18) !== 0;
    if (isExternal) continue;
    const primaryFourCC = buffer.readUInt32LE(eOff + 0x00);
    const dataAddress = buffer.readUInt32LE(eOff + 0x14);
    if (dataAddress < baseAddress || dataAddress >= baseAddress + tagDataSize) continue;
    const structOff = tagDataOffset + ((dataAddress - baseAddress) | 0);

    const expectedObjType = OBJECT_CLASS_EXPECTED_TYPE.get(primaryFourCC);
    const expectedShaderType = SHADER_CLASS_EXPECTED_TYPE.get(primaryFourCC);
    if (expectedObjType !== undefined && structOff + 4 <= buffer.length) {
      const actualObjType = buffer.readInt16LE(structOff + 0x00);
      if (actualObjType !== expectedObjType) {
        buffer.writeInt16LE(expectedObjType, structOff + 0x00);
        summary.objectTypesRepaired++;
      }
    } else if (expectedShaderType !== undefined && structOff + 0x28 <= buffer.length) {
      let shaderChanged = false;
      const actualShaderType = buffer.readInt16LE(structOff + 0x24);
      if (actualShaderType !== expectedShaderType) {
        buffer.writeInt16LE(expectedShaderType, structOff + 0x24);
        shaderChanged = true;
      }
      if (primaryFourCC === 0x736f736f && structOff + 440 <= buffer.length) {
        // 'soso' (shader_model, 440 bytes):
        // +0x184 is cache-only runtime 1.0f (`0x3f800000`); loose HEK tags byte-swapped it to `0x0000803f`
        const unk184 = buffer.readUInt32LE(structOff + 0x184);
        if (unk184 === 0x0000803f || unk184 === 0) {
          buffer.writeFloatLE(1.0, structOff + 0x184);
          shaderChanged = true;
        }
        for (const scaleOff of [0x78, 0xa0, 0xa4, 0xdc, 0xf0]) {
          const rawU32 = buffer.readUInt32LE(structOff + scaleOff);
          if (rawU32 === 0 || rawU32 === 0x0000803f) {
            buffer.writeFloatLE(1.0, structOff + scaleOff);
            shaderChanged = true;
          }
        }
      } else if (primaryFourCC === 0x73656e76 && structOff + 836 <= buffer.length) {
        // 'senv' (shader_environment, 836 bytes):
        // Default 0 detail/bump map scales to 1.0f and populate runtime_bump_map_scale (+0x138, +0x13C)
        for (const scaleOff of [0xb4, 0xc8, 0xfc, 0x124]) {
          const rawU32 = buffer.readUInt32LE(structOff + scaleOff);
          if (rawU32 === 0 || rawU32 === 0x0000803f) {
            buffer.writeFloatLE(1.0, structOff + scaleOff);
            shaderChanged = true;
          }
        }
        const bumpScale = buffer.readFloatLE(structOff + 0x124);
        const validBumpScale = Number.isFinite(bumpScale) && bumpScale > 1e-6 ? bumpScale : 1.0;
        const rtBumpX = buffer.readFloatLE(structOff + 0x138);
        const rtBumpY = buffer.readFloatLE(structOff + 0x13c);
        const rawRtX = buffer.readUInt32LE(structOff + 0x138);
        const rawRtY = buffer.readUInt32LE(structOff + 0x13c);
        if (
          rawRtX === 0 ||
          rawRtX === 0x0000803f ||
          !Number.isFinite(rtBumpX) ||
          Math.abs(rtBumpX) < 1e-6 ||
          Math.abs(rtBumpX - validBumpScale) > 1e-4
        ) {
          buffer.writeFloatLE(validBumpScale, structOff + 0x138);
          shaderChanged = true;
        }
        if (
          rawRtY === 0 ||
          rawRtY === 0x0000803f ||
          !Number.isFinite(rtBumpY) ||
          Math.abs(rtBumpY) < 1e-6 ||
          Math.abs(rtBumpY - validBumpScale) > 1e-4
        ) {
          buffer.writeFloatLE(validBumpScale, structOff + 0x13c);
          shaderChanged = true;
        }
      }
      if (shaderChanged) {
        summary.shadersRepaired++;
      }
    } else if (primaryFourCC === 0x666f6e74 && structOff + 0x88 <= buffer.length) {
      // 'font' tag: check characters reflexive at +0x7c (20 bytes per character)
      const charCount = buffer.readInt32LE(structOff + 0x7c);
      const charAddr = buffer.readUInt32LE(structOff + 0x80);
      if (charCount > 0 && charAddr >= baseAddress && charAddr < baseAddress + tagDataSize) {
        const charTableOff = tagDataOffset + ((charAddr - baseAddress) | 0);
        if (charTableOff >= tagDataOffset && charTableOff + charCount * 20 <= buffer.length) {
          for (let c = 0; c < charCount; c++) {
            const cOff = charTableOff + c * 20;
            const charWidth = buffer.readInt16LE(cOff + 0x02);
            const bmWidth = buffer.readInt16LE(cOff + 0x04);
            const bmHeight = buffer.readInt16LE(cOff + 0x06);
            const pixelsOff = buffer.readInt32LE(cOff + 0x10);
            if (charWidth < 0 || bmWidth < 0 || bmHeight < 0 || pixelsOff < 0) {
              buffer.writeInt16LE(0, cOff + 0x02);
              buffer.writeInt16LE(0, cOff + 0x04);
              buffer.writeInt16LE(0, cOff + 0x06);
              buffer.writeInt16LE(0, cOff + 0x08);
              buffer.writeInt16LE(0, cOff + 0x0a);
              buffer.writeInt32LE(0, cOff + 0x10);
              summary.fontCharsRepaired++;
            }
          }
        }
      }
    } else if (primaryFourCC === 0x6269746d && structOff + 0x6c <= buffer.length) {
      // 'bitm' tag: check sequences reflexive at +0x54 (64 bytes per sequence) against bitmaps.count at +0x60
      const seqCount = buffer.readInt32LE(structOff + 0x54);
      const seqAddr = buffer.readUInt32LE(structOff + 0x58);
      const bitmapsCount = buffer.readInt32LE(structOff + 0x60);
      const bitmapsAddr = buffer.readUInt32LE(structOff + 0x64);
      if (seqCount > 0 && seqAddr >= baseAddress && seqAddr < baseAddress + tagDataSize) {
        const seqTableOff = tagDataOffset + ((seqAddr - baseAddress) | 0);
        if (seqTableOff >= tagDataOffset && seqTableOff + seqCount * 64 <= buffer.length) {
          for (let s = 0; s < seqCount; s++) {
            const sOff = seqTableOff + s * 64;
            const firstIdx = buffer.readInt16LE(sOff + 0x20);
            const bmCount = buffer.readInt16LE(sOff + 0x22);
            if (
              firstIdx < 0 ||
              bmCount < 0 ||
              firstIdx + bmCount > bitmapsCount ||
              (bmCount > 0 && firstIdx >= bitmapsCount)
            ) {
              buffer.writeInt16LE(0, sOff + 0x20);
              buffer.writeInt16LE(0, sOff + 0x22);
              summary.bitmapSequencesRepaired++;
            }
          }
        }
      }
      if (bitmapsCount > 0 && bitmapsAddr >= baseAddress && bitmapsAddr < baseAddress + tagDataSize) {
        const bmTableOff = tagDataOffset + ((bitmapsAddr - baseAddress) | 0);
        if (bmTableOff >= tagDataOffset && bmTableOff + bitmapsCount * 48 <= buffer.length) {
          for (let b = 0; b < bitmapsCount; b++) {
            const bOff = bmTableOff + b * 48;
            const flags = buffer.readUInt16LE(bOff + 0x0e);
            // Strip MCC/unsupported upper bits 9..15 (e.g. 0x200 in 0x283/0x281) while preserving bit 8 (0x100 in_resource_map),
            // and ensure bit 7 (0x0080 _bitmap_cached_bit) is set so OpenCE's texture cache loads the hardware texture.
            const repairedFlags = ((flags & 0x01ff) | 0x0080) >>> 0;
            if (repairedFlags !== flags) {
              buffer.writeUInt16LE(repairedFlags, bOff + 0x0e);
              summary.bitmapFlagsRepaired++;
            }
          }
        }
      }
    } else if (primaryFourCC === 0x6d6f6432 && structOff + 0xe8 <= buffer.length) {
      // 'mod2' (gbxmodel): repair uninitialized previous_part_index / next_part_index (-1) and centroid node weight
      const geomCount = buffer.readInt32LE(structOff + 0xd0);
      const geomAddr = buffer.readUInt32LE(structOff + 0xd4);
      if (geomCount > 0 && geomAddr >= baseAddress && geomAddr < baseAddress + tagDataSize) {
        const geomTableOff = tagDataOffset + ((geomAddr - baseAddress) | 0);
        if (geomTableOff >= tagDataOffset && geomTableOff + geomCount * 48 <= buffer.length) {
          for (let g = 0; g < geomCount; g++) {
            const gOff = geomTableOff + g * 48;
            const partCount = buffer.readInt32LE(gOff + 0x24);
            const partAddr = buffer.readUInt32LE(gOff + 0x28);
            if (partCount > 0 && partAddr >= baseAddress && partAddr < baseAddress + tagDataSize) {
              const partTableOff = tagDataOffset + ((partAddr - baseAddress) | 0);
              if (partTableOff >= tagDataOffset && partTableOff + partCount * 132 <= buffer.length) {
                for (let p = 0; p < partCount; p++) {
                  const pOff = partTableOff + p * 132;
                  let partChanged = false;
                  const prevPart = buffer.readInt8(pOff + 0x06);
                  const nextPart = buffer.readInt8(pOff + 0x07);
                  if (prevPart === 0 && nextPart === 0) {
                    buffer.writeInt8(-1, pOff + 0x06);
                    buffer.writeInt8(-1, pOff + 0x07);
                    partChanged = true;
                  }
                  const w0 = buffer.readFloatLE(pOff + 0x0c);
                  const w1 = buffer.readFloatLE(pOff + 0x10);
                  if (w0 === 0 && w1 === 0) {
                    buffer.writeFloatLE(1.0, pOff + 0x0c);
                    partChanged = true;
                  }
                  if (partChanged) {
                    summary.modelPartsRepaired++;
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return summary;
}

/**
 * Action 1: `Fix CE Map`
 * Scans a Halo Custom Edition (`v609`) `.map` buffer's compiled HaloScript AST (`hs_syntax_data`),
 * neutralizes (`node_make_inert`) or converts (`(game_revert)`) syntax nodes that OpenCE refuses,
 * repairs MCC H1EK tag issues (`hs_syntax_data` 32,767->19,001 table clamping, byte-swapped object types,
 * negative font dimensions), and recalculates the Custom Edition cache header CRC32 (`0x64`).
 */
export function fixCeMapHaloScriptAndCrc(buffer: Buffer): CeMapFixResult {
  if (buffer.length < CACHE_FILE_HEADER_SIZE) {
    throw new Error(`File is too small (${buffer.length} bytes) to be a Halo cache file.`);
  }
  const headMagic = buffer.readUInt32LE(0x000);
  const footMagic = buffer.readUInt32LE(0x7fc);
  if (headMagic !== CacheFileLiteral.HEAD || footMagic !== CacheFileLiteral.FOOT) {
    throw new Error('Invalid Halo cache file header magic (expected "head" / "foot").');
  }
  const version = buffer.readUInt32LE(0x004);
  if (version !== CacheFileEngine.CUSTOM_EDITION) {
    throw new Error(`Expected Halo Custom Edition map (version = 609), but found version = ${version}.`);
  }

  const tagDataOffset = buffer.readUInt32LE(0x010);
  const tagDataSize = buffer.readUInt32LE(0x014);
  const mapName = readFixedString(buffer, 0x020, TAG_STRING_SIZE);
  const previousCrc32 = buffer.readUInt32LE(0x064);

  if (tagDataOffset < CACHE_FILE_HEADER_SIZE || tagDataOffset + TAG_DATA_HEADER_PC_SIZE > buffer.length) {
    throw new Error(`Tag data offset (0x${tagDataOffset.toString(16)}) is outside the file.`);
  }

  const tagInstancesAddress = buffer.readUInt32LE(tagDataOffset + 0x00);
  const scenarioDatumHandle = buffer.readUInt32LE(tagDataOffset + 0x04);
  const scenarioTagIndex = scenarioDatumHandle & 0xffff;
  const tagCount = buffer.readUInt32LE(tagDataOffset + 0x0c);

  const tagInstancesOffset = tagDataOffset + (tagInstancesAddress - CE_BASE_MEMORY_ADDRESS);
  if (
    scenarioTagIndex >= tagCount ||
    tagInstancesOffset < tagDataOffset ||
    tagInstancesOffset + (scenarioTagIndex + 1) * TAG_ENTRY_SIZE > buffer.length
  ) {
    throw new Error(`Scenario tag index (${scenarioTagIndex}) is out of bounds (tag count = ${tagCount}).`);
  }

  const scenarioEntryOffset = tagInstancesOffset + scenarioTagIndex * TAG_ENTRY_SIZE;
  const scenarioAddress = buffer.readUInt32LE(scenarioEntryOffset + 0x14);
  const scenarioOffset = tagDataOffset + (scenarioAddress - CE_BASE_MEMORY_ADDRESS);
  if (scenarioOffset < tagDataOffset || scenarioOffset + 0x5b0 > buffer.length) {
    throw new Error(`Scenario tag offset (0x${scenarioOffset.toString(16)}) is out of bounds.`);
  }

  // Scenario HaloScript fields
  const syntaxSize = buffer.readInt32LE(scenarioOffset + 0x474 + 0x00);
  const syntaxAddress = buffer.readUInt32LE(scenarioOffset + 0x474 + 0x0c);
  const stringsSize = buffer.readInt32LE(scenarioOffset + 0x488 + 0x00);
  const stringsAddress = buffer.readUInt32LE(scenarioOffset + 0x488 + 0x0c);
  const scriptCount = buffer.readInt32LE(scenarioOffset + 0x49c + 0x00);
  const scriptsAddress = buffer.readUInt32LE(scenarioOffset + 0x49c + 0x04);
  const globalCount = buffer.readInt32LE(scenarioOffset + 0x4a8 + 0x00);
  const globalsAddress = buffer.readUInt32LE(scenarioOffset + 0x4a8 + 0x04);

  const fixedNodes: HaloScriptNodeFixEntry[] = [];
  const affectedScriptSet = new Set<string>();
  let totalSyntaxNodes = 0;
  let nodesNeutralized = 0;
  let nodesConvertedToGameRevert = 0;
  let nodesAlreadyFixed = 0;

  if (syntaxSize >= 0x38 && syntaxAddress >= CE_BASE_MEMORY_ADDRESS) {
    const syntaxOffset = tagDataOffset + (syntaxAddress - CE_BASE_MEMORY_ADDRESS);
    const stringsOffset =
      stringsSize > 0 && stringsAddress >= CE_BASE_MEMORY_ADDRESS
        ? tagDataOffset + (stringsAddress - CE_BASE_MEMORY_ADDRESS)
        : 0;

    if (syntaxOffset >= tagDataOffset && syntaxOffset + 0x38 <= buffer.length) {
      const rawActualCount = buffer.readInt16LE(syntaxOffset + 0x2e);
      const maxFittingNodes = Math.max(0, Math.floor((Math.min(syntaxSize, buffer.length - syntaxOffset) - 0x38) / 20));
      const actualCount = Math.max(0, Math.min(rawActualCount, maxFittingNodes));
      totalSyntaxNodes = actualCount;

      const getString = (strOff: number): string => {
        if (stringsOffset <= 0 || stringsSize <= 0) return '';
        return readNullTerminatedAscii(buffer, stringsOffset, stringsSize, strOff);
      };

      const nodes: MutableSyntaxNode[] = new Array(actualCount);
      for (let i = 0; i < actualCount; i++) {
        const nOff = syntaxOffset + 0x38 + i * 20;
        nodes[i] = {
          index: i,
          fileOffset: nOff,
          identifier: buffer.readInt16LE(nOff + 0x00),
          constantType: buffer.readInt16LE(nOff + 0x02),
          type: buffer.readInt16LE(nOff + 0x04),
          flags: buffer.readUInt16LE(nOff + 0x06),
          nextNodeIndex: buffer.readInt32LE(nOff + 0x08),
          stringOffset: buffer.readInt32LE(nOff + 0x0c),
          data: buffer.readInt32LE(nOff + 0x10),
        };
      }

      const writeNode = (node: MutableSyntaxNode): void => {
        buffer.writeInt16LE(node.identifier, node.fileOffset + 0x00);
        buffer.writeInt16LE(node.constantType, node.fileOffset + 0x02);
        buffer.writeInt16LE(node.type, node.fileOffset + 0x04);
        buffer.writeUInt16LE(node.flags, node.fileOffset + 0x06);
        buffer.writeInt32LE(node.nextNodeIndex, node.fileOffset + 0x08);
        buffer.writeInt32LE(node.stringOffset, node.fileOffset + 0x0c);
        buffer.writeInt32LE(node.data, node.fileOffset + 0x10);
      };

      const nodeMakeInert = (nodeIndex: number): void => {
        const N = nodes[nodeIndex];
        if (!N) return;
        N.constantType = N.type;
        N.flags = 0x0001 | (N.flags & 0x0008);
        const isZeroDataType =
          (N.type >= 4 && N.type <= 8) ||
          (N.type >= 32 && N.type <= 36);
        N.data = isZeroDataType ? 0 : -1;
        writeNode(N);
      };

      const getNodeIndex = (rawIndex: number): number => {
        if (rawIndex === -1) return -1;
        const idx = rawIndex & 0xffff;
        return idx === 0xffff || idx >= actualCount ? -1 : idx;
      };

      const isEngineCallNode = (N: MutableSyntaxNode): boolean =>
        N.identifier !== 0 && (N.flags & 0x0001) === 0 && (N.flags & 0x0002) === 0;

      const getCallFunctionName = (N: MutableSyntaxNode): string | null => {
        if (!isEngineCallNode(N)) return null;
        const fIdx = getNodeIndex(N.data);
        if (fIdx < 0) return null;
        return getString(nodes[fIdx].stringOffset);
      };

      // Map each node index to its owning script/global name and collect script characteristics
      const nodeOwnerScript = new Map<number, string>();
      const scriptHasDifficultySet = new Set<string>();
      const scriptHasGameWon = new Set<string>();

      const walkSubtree = (rootIdx: number, ownerName: string): void => {
        const stack: number[] = [];
        const visited = new Set<number>();
        if (rootIdx >= 0 && rootIdx < actualCount) stack.push(rootIdx);
        while (stack.length > 0) {
          const idx = stack.pop()!;
          if (idx < 0 || idx >= actualCount || visited.has(idx)) continue;
          visited.add(idx);
          if (!nodeOwnerScript.has(idx)) nodeOwnerScript.set(idx, ownerName);
          const N = nodes[idx];
          const nextIdx = getNodeIndex(N.nextNodeIndex);
          if (nextIdx >= 0) stack.push(nextIdx);
          if (N.identifier !== 0 && (N.flags & 0x0001) === 0) {
            const childIdx = getNodeIndex(N.data);
            if (childIdx >= 0) stack.push(childIdx);
          }
          const fn = getCallFunctionName(N);
          if (fn === 'game_difficulty_set') {
            scriptHasDifficultySet.add(ownerName);
          } else if (fn === 'game_won') {
            scriptHasGameWon.add(ownerName);
          } else if (
            (N.flags & 0x0001) !== 0 &&
            N.constantType === N.type &&
            idx + 1 < actualCount &&
            nodes[idx + 1].type === 2
          ) {
            const origFn = getString(nodes[idx + 1].stringOffset);
            if (origFn === 'game_difficulty_set') scriptHasDifficultySet.add(ownerName);
            else if (origFn === 'game_won') scriptHasGameWon.add(ownerName);
          }
        }
      };

      if (scriptCount > 0 && scriptsAddress >= CE_BASE_MEMORY_ADDRESS) {
        const scriptsOffset = tagDataOffset + (scriptsAddress - CE_BASE_MEMORY_ADDRESS);
        for (let s = 0; s < scriptCount; s++) {
          const sOff = scriptsOffset + s * 92;
          if (sOff + 92 > buffer.length) break;
          const sName = readFixedString(buffer, sOff + 0x00, TAG_STRING_SIZE) || `script_${s}`;
          const rootIdx = getNodeIndex(buffer.readInt32LE(sOff + 0x24));
          walkSubtree(rootIdx, sName);
        }
      }

      if (globalCount > 0 && globalsAddress >= CE_BASE_MEMORY_ADDRESS) {
        const globalsOffset = tagDataOffset + (globalsAddress - CE_BASE_MEMORY_ADDRESS);
        for (let g = 0; g < globalCount; g++) {
          const gOff = globalsOffset + g * 92;
          if (gOff + 92 > buffer.length) break;
          const gName = readFixedString(buffer, gOff + 0x00, TAG_STRING_SIZE) || `global_${g}`;
          const rootIdx = getNodeIndex(buffer.readInt32LE(gOff + 0x24));
          walkSubtree(rootIdx, `global:${gName}`);
        }
      }

      // Check whether any `begin` block contains `game_difficulty_set` or `game_won`, and find `(fade_out ...)`
      // calls that precede `map_name` / `map_reset` in a difficulty-switcher `begin` chain.
      const fadeOutNodesToNeutralize = new Set<number>();
      const beginBlockHasGameWon = new Map<number, boolean>();
      const nodeParentBegin = new Map<number, number>();

      const subtreeContainsFunction = (startIdx: number, targetFn: string): boolean => {
        const stack = [startIdx];
        const seen = new Set<number>();
        while (stack.length > 0) {
          const curr = stack.pop()!;
          if (curr < 0 || curr >= actualCount || seen.has(curr)) continue;
          seen.add(curr);
          const node = nodes[curr];
          const fn = getCallFunctionName(node);
          if (fn === targetFn) return true;
          if ((node.flags & 0x0001) !== 0 && node.constantType === node.type && curr + 1 < actualCount && nodes[curr + 1].type === 2) {
            if (getString(nodes[curr + 1].stringOffset) === targetFn) return true;
          }
          if (node.identifier !== 0 && (node.flags & 0x0001) === 0) {
            const c = getNodeIndex(node.data);
            if (c >= 0) {
              // Walk children and their siblings
              let sib = c;
              let guard = 0;
              while (sib >= 0 && guard++ < actualCount) {
                stack.push(sib);
                sib = getNodeIndex(nodes[sib].nextNodeIndex);
              }
            }
          }
        }
        return false;
      };

      for (let i = 0; i < actualCount; i++) {
        const N = nodes[i];
        const fn = getCallFunctionName(N);
        if (fn === 'begin' || fn === 'begin_random') {
          const fIdx = getNodeIndex(N.data);
          if (fIdx < 0) continue;
          const exprs: number[] = [];
          let curr = getNodeIndex(nodes[fIdx].nextNodeIndex);
          let guard = 0;
          while (curr >= 0 && guard++ < actualCount) {
            exprs.push(curr);
            nodeParentBegin.set(curr, i);
            curr = getNodeIndex(nodes[curr].nextNodeIndex);
          }

          let hasDiffSet = false;
          let hasWon = false;
          let mapReloadPos = -1;
          for (let pos = 0; pos < exprs.length; pos++) {
            const exprIdx = exprs[pos];
            if (subtreeContainsFunction(exprIdx, 'game_difficulty_set')) hasDiffSet = true;
            if (subtreeContainsFunction(exprIdx, 'game_won')) hasWon = true;
            const exprFn = getCallFunctionName(nodes[exprIdx]);
            if (exprFn === 'map_name' || exprFn === 'map_reset') {
              mapReloadPos = pos;
            }
          }
          if (hasWon) {
            beginBlockHasGameWon.set(i, true);
          }
          const owner = nodeOwnerScript.get(i) ?? '';
          if ((hasDiffSet || scriptHasDifficultySet.has(owner)) && mapReloadPos >= 0) {
            for (let pos = 0; pos < mapReloadPos; pos++) {
              const exprIdx = exprs[pos];
              if (getCallFunctionName(nodes[exprIdx]) === 'fade_out') {
                fadeOutNodesToNeutralize.add(exprIdx);
              }
            }
          }
        }
      }

      const gameRevertStringOffset =
        stringsOffset > 0 && stringsSize > 0
          ? findNullTerminatedStringOffset(buffer, stringsOffset, stringsSize, 'game_revert')
          : -1;

      const formatCallExpression = (N: MutableSyntaxNode, fnName: string): string => {
        const fIdx = getNodeIndex(N.data);
        if (fIdx < 0) return `(${fnName})`;
        const arg1Idx = getNodeIndex(nodes[fIdx].nextNodeIndex);
        if (arg1Idx >= 0) {
          const arg1Str = getString(nodes[arg1Idx].stringOffset);
          if (arg1Str) return `(${fnName} ${arg1Str} ...)`;
        }
        return `(${fnName})`;
      };

      // Sweep all syntax nodes in the table
      for (let i = 0; i < actualCount; i++) {
        const N = nodes[i];
        const scriptName = nodeOwnerScript.get(i) ?? '(unreferenced)';

        // Check if this node was already fixed in a prior run so we can report it accurately
        if (
          (N.flags & 0x0001) !== 0 &&
          N.constantType === N.type &&
          i + 1 < actualCount &&
          nodes[i + 1].type === 2
        ) {
          const origFn = getString(nodes[i + 1].stringOffset);
          if (origFn === 'set' && i + 2 < actualCount) {
            const gName = getString(nodes[i + 2].stringOffset);
            if ((nodes[i + 2].flags & 0x0004) !== 0 && (nodes[i + 2].data & 0x8000) !== 0 && !ALLOWED_SETTABLE_GLOBALS.has(gName)) {
              nodesAlreadyFixed++;
              affectedScriptSet.add(scriptName);
              fixedNodes.push({
                nodeIndex: i,
                scriptName,
                action: 'already_fixed',
                expression: `(set ${gName} ...)`,
                reason: `Disallowed external global '${gName}' (already neutralized)`,
              });
            }
          } else if (DISALLOWED_FUNCTIONS.has(origFn) || origFn === 'fade_out') {
            nodesAlreadyFixed++;
            affectedScriptSet.add(scriptName);
            fixedNodes.push({
              nodeIndex: i,
              scriptName,
              action: 'already_fixed',
              expression: `(${origFn})`,
              reason: `Disallowed call '${origFn}' (already neutralized)`,
            });
          }
          continue;
        }

        if (
          isEngineCallNode(N) &&
          N.constantType === GAME_REVERT_FUNCTION_INDEX &&
          getCallFunctionName(N) === 'game_revert' &&
          i + 2 < actualCount &&
          nodes[i + 1].nextNodeIndex === -1 &&
          nodes[i + 2].type === 9 &&
          getString(nodes[i + 2].stringOffset).length > 0
        ) {
          nodesAlreadyFixed++;
          affectedScriptSet.add(scriptName);
          fixedNodes.push({
            nodeIndex: i,
            scriptName,
            action: 'already_fixed',
            expression: `(map_name ${getString(nodes[i + 2].stringOffset)}) -> (game_revert)`,
            reason: `End-of-game map_name already converted to (game_revert)`,
          });
          continue;
        }

        if (!isEngineCallNode(N)) continue;
        const fIdx = getNodeIndex(N.data);
        if (fIdx < 0) continue;
        const F = nodes[fIdx];
        const funcName = getString(F.stringOffset);

        // Difficulty switcher fade_out neutralization
        if (funcName === 'fade_out' && fadeOutNodesToNeutralize.has(i)) {
          nodeMakeInert(i);
          nodesNeutralized++;
          affectedScriptSet.add(scriptName);
          fixedNodes.push({
            nodeIndex: i,
            scriptName,
            action: 'neutralized',
            expression: '(fade_out ...)',
            reason: 'Precedes map_name/map_reset inside a game_difficulty_set block',
          });
          continue;
        }

        // Rule A: Disallowed `(set <external_global> <value>)`
        if (funcName === 'set') {
          const arg1Idx = getNodeIndex(F.nextNodeIndex);
          if (arg1Idx >= 0) {
            const arg1 = nodes[arg1Idx];
            if ((arg1.flags & 0x0004) !== 0 && (arg1.data & 0x8000) !== 0) {
              const globalName = getString(arg1.stringOffset);
              if (!ALLOWED_SETTABLE_GLOBALS.has(globalName)) {
                nodeMakeInert(i);
                nodesNeutralized++;
                affectedScriptSet.add(scriptName);
                fixedNodes.push({
                  nodeIndex: i,
                  scriptName,
                  action: 'neutralized',
                  expression: `(set ${globalName} ...)`,
                  reason: `External global '${globalName}' is not in OpenCE's ALLOWED_SETTABLE_GLOBALS whitelist`,
                });
              }
            }
          }
          continue;
        }

        // Rule B: Disallowed Engine Function Calls
        if (!DISALLOWED_FUNCTIONS.has(funcName)) continue;

        // Context-aware handling for `map_name` / `map_reset`
        if (funcName === 'map_name' || funcName === 'map_reset') {
          const parentBegin = nodeParentBegin.get(i);
          const hasWonInBegin = parentBegin !== undefined && beginBlockHasGameWon.get(parentBegin) === true;
          const hasWonInScript = scriptHasGameWon.has(scriptName);
          const hasDiffSetInScript = scriptHasDifficultySet.has(scriptName);

          if (
            funcName === 'map_name' &&
            !hasWonInBegin &&
            !hasWonInScript &&
            !hasDiffSetInScript &&
            gameRevertStringOffset >= 0
          ) {
            const oldExpr = formatCallExpression(N, funcName);
            N.constantType = GAME_REVERT_FUNCTION_INDEX;
            writeNode(N);

            F.constantType = GAME_REVERT_FUNCTION_INDEX;
            F.type = 2;
            F.flags = 0x0009;
            F.nextNodeIndex = -1;
            F.stringOffset = gameRevertStringOffset;
            F.data = 0;
            writeNode(F);

            nodesConvertedToGameRevert++;
            affectedScriptSet.add(scriptName);
            fixedNodes.push({
              nodeIndex: i,
              scriptName,
              action: 'converted_to_game_revert',
              expression: `${oldExpr} -> (game_revert)`,
              reason: 'End-of-game map_name without game_won or game_difficulty_set converted to (game_revert)',
            });
            continue;
          }

          const oldExpr = formatCallExpression(N, funcName);
          nodeMakeInert(i);
          nodesNeutralized++;
          affectedScriptSet.add(scriptName);
          fixedNodes.push({
            nodeIndex: i,
            scriptName,
            action: 'neutralized',
            expression: oldExpr,
            reason: hasDiffSetInScript
              ? `Disallowed '${funcName}' inside difficulty switcher script`
              : hasWonInBegin || hasWonInScript
                ? `Disallowed '${funcName}' in block that already calls (game_won)`
                : `Disallowed engine function '${funcName}'`,
          });
          continue;
        }

        // Standard disallowed function neutralization (`node_make_inert`)
        const oldExpr = formatCallExpression(N, funcName);
        nodeMakeInert(i);
        nodesNeutralized++;
        affectedScriptSet.add(scriptName);
        fixedNodes.push({
          nodeIndex: i,
          scriptName,
          action: 'neutralized',
          expression: oldExpr,
          reason: `Disallowed engine function '${funcName}' refused by OpenCE`,
        });
      }
    }
  }

  // Ensure any remaining MCC / CE / loose-injected tag issues are repaired before computing the header CRC32
  repairMccAndCeTagIssues(buffer);

  // Recompute Custom Edition CRC32 over BSPs + Model Data + Tag Data and pack at header[0x64]
  let newCrc32 = previousCrc32;
  try {
    newCrc32 = recomputeCustomEditionHeaderCrc32(buffer);
  } catch {
    // Fallback direct region CRC calculation per specification Section 3
    const bspCount = buffer.readInt32LE(scenarioOffset + 0x5a4 + 0x00);
    const bspAddress = buffer.readUInt32LE(scenarioOffset + 0x5a4 + 0x04);
    const bspTableOffset = tagDataOffset + (bspAddress - CE_BASE_MEMORY_ADDRESS);
    const regions: { offset: number; size: number; label: string }[] = [];
    for (let b = 0; b < bspCount; b++) {
      const bOff = bspTableOffset + b * 32;
      if (bOff + 32 <= buffer.length) {
        regions.push({
          offset: buffer.readUInt32LE(bOff + 0x00),
          size: buffer.readUInt32LE(bOff + 0x04),
          label: `bsp ${b}`,
        });
      }
    }
    const modelDataOffset = buffer.readUInt32LE(tagDataOffset + 0x14);
    const modelDataSize = buffer.readUInt32LE(tagDataOffset + 0x20);
    if (modelDataSize > 0 && modelDataOffset + modelDataSize <= buffer.length) {
      regions.push({ offset: modelDataOffset, size: modelDataSize, label: 'model data' });
    }
    if (tagDataOffset + tagDataSize <= buffer.length) {
      regions.push({ offset: tagDataOffset, size: tagDataSize, label: 'tag data' });
    }
    newCrc32 = computeCacheCrc32(buffer, regions);
    buffer.writeUInt32LE(newCrc32 >>> 0, 0x64);
  }

  const enrichedFixedNodes: HaloScriptNodeFixEntry[] = fixedNodes.map((entry) => ({
    ...entry,
    targetName: entry.targetName ?? entry.expression,
    kind: entry.kind ?? (entry.expression.startsWith('(set ') ? 'global_set' : 'function_call'),
  }));

  return {
    mapName,
    previousCrc32: previousCrc32 >>> 0,
    newCrc32: newCrc32 >>> 0,
    crcUpdated: (previousCrc32 >>> 0) !== (newCrc32 >>> 0),
    totalSyntaxNodes,
    scriptsChecked: Math.max(0, scriptCount),
    nodesNeutralized,
    nodesConvertedToGameRevert,
    nodesAlreadyFixed,
    alreadyFixedNodes: nodesAlreadyFixed,
    affectedScripts: Array.from(affectedScriptSet),
    fixedNodes: enrichedFixedNodes,
    mutations: enrichedFixedNodes,
  };
}

/**
 * Action 1 Wrapper returning unified `MapFixActionResult`.
 */
export function runFixCeMap(source: Buffer): MapFixActionResult {
  const copy = Buffer.from(source);
  const tagRepairs = repairMccAndCeTagIssues(copy);
  const scriptFix = fixCeMapHaloScriptAndCrc(copy);
  const details: string[] = [
    `Map Name: ${scriptFix.mapName}`,
    ...(tagRepairs.headerFlagsCleared ? [`Cleared non-zero header flags at 0x68 for OpenCE compatibility.`] : []),
    ...(tagRepairs.hsSyntaxClamped
      ? [
          `Clamped MCC/H1EK hs_syntax_data table (${tagRepairs.previousSyntaxDataSize.toLocaleString('en-US')} bytes / ${tagRepairs.previousSyntaxMaxCount.toLocaleString('en-US')} max nodes -> 380,076 bytes / 19,001 max nodes).`,
        ]
      : []),
    ...(tagRepairs.objectTypesRepaired > 0
      ? [`Repaired ${tagRepairs.objectTypesRepaired} byte-swapped _object_definition.type field(s).`]
      : []),
    ...(tagRepairs.shadersRepaired > 0
      ? [`Repaired ${tagRepairs.shadersRepaired} shader tag(s) (type & runtime detail/bump scales).`]
      : []),
    ...(tagRepairs.bitmapFlagsRepaired > 0
      ? [`Repaired ${tagRepairs.bitmapFlagsRepaired} BitmapData.flags entry(s) (stripped MCC upper bits & ensured _bitmap_cached_bit 0x80).`]
      : []),
    ...(tagRepairs.modelPartsRepaired > 0
      ? [`Repaired ${tagRepairs.modelPartsRepaired} GBXModel geometry part(s) (prev/next part indices & node weights).`]
      : []),
    ...(tagRepairs.fontCharsRepaired > 0
      ? [`Repaired ${tagRepairs.fontCharsRepaired} font character(s) with negative dimensions.`]
      : []),
    `HaloScript AST Nodes Scanned: ${scriptFix.totalSyntaxNodes.toLocaleString('en-US')} across ${scriptFix.scriptsChecked} script(s)`,
    `Nodes Neutralized (node_make_inert): ${scriptFix.nodesNeutralized}`,
    `Nodes Converted to (game_revert): ${scriptFix.nodesConvertedToGameRevert}`,
    ...(scriptFix.nodesAlreadyFixed > 0 ? [`Previously Fixed Nodes Verified: ${scriptFix.nodesAlreadyFixed}`] : []),
    `Header CRC32 (0x64): 0x${scriptFix.previousCrc32.toString(16).toUpperCase().padStart(8, '0')} -> 0x${scriptFix.newCrc32.toString(16).toUpperCase().padStart(8, '0')}`,
    ...scriptFix.fixedNodes.map(
      (n) => `  [node #${n.nodeIndex}] (${n.scriptName}) ${n.action}: ${n.expression} — ${n.reason}`,
    ),
  ];

  const totalChanged = scriptFix.nodesNeutralized + scriptFix.nodesConvertedToGameRevert;
  const tagRepairsCount =
    (tagRepairs.hsSyntaxClamped ? 1 : 0) +
    tagRepairs.objectTypesRepaired +
    tagRepairs.shadersRepaired +
    tagRepairs.bitmapFlagsRepaired +
    tagRepairs.modelPartsRepaired +
    tagRepairs.fontCharsRepaired;
  const message =
    totalChanged > 0 || tagRepairsCount > 0
      ? `Fixed ${totalChanged} disallowed HaloScript AST node(s) across ${scriptFix.affectedScripts.length} script(s)${tagRepairsCount > 0 ? `, applied ${tagRepairsCount} MCC/H1EK tag repair(s),` : ''} and updated CE header CRC32 to 0x${scriptFix.newCrc32.toString(16).toUpperCase().padStart(8, '0')}.`
      : scriptFix.nodesAlreadyFixed > 0
        ? `Verified ${scriptFix.nodesAlreadyFixed} previously fixed HaloScript AST node(s) and confirmed CE header CRC32 (0x${scriptFix.newCrc32.toString(16).toUpperCase().padStart(8, '0')}).`
        : `No disallowed HaloScript AST nodes found (${scriptFix.totalSyntaxNodes.toLocaleString('en-US')} nodes checked); verified CE header CRC32 (0x${scriptFix.newCrc32.toString(16).toUpperCase().padStart(8, '0')}).`;

  return {
    action: 'ce',
    ok: true,
    message,
    sourceEngineVersion: CacheFileEngine.CUSTOM_EDITION,
    targetEngineVersion: CacheFileEngine.CUSTOM_EDITION,
    mapName: scriptFix.mapName,
    previousCrc32: scriptFix.previousCrc32,
    newCrc32: scriptFix.newCrc32,
    sourceByteLength: source.length,
    outputByteLength: copy.length,
    pointersRebased: 0,
    externalRangesInternalized: 0,
    externalTagsLinkedToCe: 0,
    modelsConverted: 0,
    bspsDecompressed: 0,
    bitmapsDeswizzled: 0,
    p8BitmapsConverted: 0,
    scriptFix,
    details,
    buffer: copy,
  };
}

/**
 * Legacy placeholder constant retained for backwards compatibility.
 */
export const FIX_MCC_MAP_PLACEHOLDER_MESSAGE =
  'Fix MCC Map is currently a placeholder until broken MCC .map samples are sourced for analysis.';

export function runFixMccMapPlaceholder(): MapFixActionResult {
  return {
    action: 'mcc',
    ok: true,
    isPlaceholder: true,
    message: FIX_MCC_MAP_PLACEHOLDER_MESSAGE,
    sourceEngineVersion: CacheFileEngine.MCC_CEA,
    targetEngineVersion: CacheFileEngine.CUSTOM_EDITION,
    mapName: 'MCC Map',
    previousCrc32: null,
    newCrc32: null,
    sourceByteLength: 0,
    outputByteLength: 0,
    pointersRebased: 0,
    externalRangesInternalized: 0,
    externalTagsLinkedToCe: 0,
    modelsConverted: 0,
    bspsDecompressed: 0,
    bitmapsDeswizzled: 0,
    p8BitmapsConverted: 0,
    scriptFix: null,
    details: [FIX_MCC_MAP_PLACEHOLDER_MESSAGE],
    buffer: null,
  };
}

/**
 * Action 2: `Fix MCC Map` (`v13` MCC CEA & `v609` MCC H1EK -> Custom Edition `v609`)
 * Converts Halo: The Master Chief Collection (MCC CEA `version = 13`, build `"01.03.43.0000"`, `0x50000000` tag base)
 * and MCC H1EK (`version = 609`) `.map` files into playable OpenCE Custom Edition (`version = 609`, `0x40440000` tag base) `.map` files:
 * 1) Recombines split MCC `v13` BSP vertex buffers (`[vertDataOff..oldBspTagOff)`) and BSP tag blocks (`[oldBspTagOff..oldBspTagOff+oldBspTagSize)`)
 *    into unified Custom Edition BSPs (`[bspTag .. uncompressedVertices]`) and populates every lightmap material's `uncompressed_vertices` `TagDataOffset`.
 * 2) Rebases all BSP-space pointers (`0x53A30000` -> `((0x40440000 + 0x01700000 - newBspSize) & ~0xFFF)`) and all Tag Data pointers (`0x50000000` -> `0x40440000`).
 * 3) Clears MCC header flags (`0x68`: `0x07 -> 0x00`), updates header version (`13 -> 609`) and build string (`"01.03.43.0000"` -> `"01.00.00.0609"`).
 * 4) Clamps MCC's 32,767-node `hs_syntax_data` table (`655,396` bytes -> `380,076` bytes, `maximum_count = 32767 -> 19001`),
 *    repairs byte-swapped `_object_definition.type` (`1536 -> 6`), repairs negative `font` character dimensions,
 *    runs the `Fix CE Map` HaloScript AST pass, and recalculates the Custom Edition header CRC32 (`0x64`).
 */
export function fixMccMapToCe(source: Buffer, _options: MapFixOptions = {}): MapFixActionResult {
  if (source.length < CACHE_FILE_HEADER_SIZE) {
    throw new Error(`File is too small (${source.length} bytes) to be a Halo cache file.`);
  }
  const headMagic = source.readUInt32LE(0x000);
  const footMagic = source.readUInt32LE(0x7fc);
  if (headMagic !== CacheFileLiteral.HEAD || footMagic !== CacheFileLiteral.FOOT) {
    throw new Error('Invalid Halo cache file header magic (expected "head" / "foot").');
  }

  const out = Buffer.from(source);
  const details: string[] = [];
  const sourceVersion = out.readUInt32LE(0x004);
  const sourceBuild = readFixedString(out, 0x040, TAG_STRING_SIZE);
  const previousCrc32 = out.readUInt32LE(0x064);
  const tagDataOffset = out.readUInt32LE(0x010);
  const tagDataSize = out.readUInt32LE(0x014);

  if (tagDataOffset < CACHE_FILE_HEADER_SIZE || tagDataOffset + TAG_DATA_HEADER_PC_SIZE > out.length) {
    throw new Error(`Tag data offset (0x${tagDataOffset.toString(16)}) is outside the file.`);
  }

  const tagInstancesAddress = out.readUInt32LE(tagDataOffset + 0x00);
  const oldBase = (tagInstancesAddress - TAG_DATA_HEADER_PC_SIZE) >>> 0;

  if (
    sourceVersion !== CacheFileEngine.MCC_CEA &&
    oldBase !== 0x50000000 &&
    sourceVersion !== CacheFileEngine.CUSTOM_EDITION
  ) {
    throw new Error(
      `Expected Halo MCC map (version = 13 or old_base = 0x50000000), but found version = ${sourceVersion} (base = 0x${oldBase.toString(16)}).`,
    );
  }

  const tagCount = out.readUInt32LE(tagDataOffset + 0x0c);
  const scenarioDatumHandle = out.readUInt32LE(tagDataOffset + 0x04);
  const scenarioTagIndex = scenarioDatumHandle & 0xffff;
  const tagArrayOff = tagDataOffset + TAG_DATA_HEADER_PC_SIZE;
  const strTableStart = TAG_DATA_HEADER_PC_SIZE + tagCount * TAG_ENTRY_SIZE;
  const scnrDataPtr = out.readUInt32LE(tagArrayOff + scenarioTagIndex * TAG_ENTRY_SIZE + 0x14);
  const scnrOff = (scnrDataPtr - oldBase) >>> 0; // offset relative to tagDataOffset
  const strTableEnd = scnrOff;
  const scnrAbsOff = tagDataOffset + scnrOff;

  let pointersRebased = 0;
  let bspsConverted = 0;

  // ---------------------------------------------------------------------------
  // Step 2: Re-embed Externalized Structure BSP Uncompressed Vertices (0x800)
  // ---------------------------------------------------------------------------
  if (scnrAbsOff >= tagDataOffset && scnrAbsOff + 0x5b0 <= out.length) {
    const bspCount = out.readInt32LE(scnrAbsOff + 0x5a4);
    const bspArrPtr = out.readUInt32LE(scnrAbsOff + 0x5a8);
    const bspArrAbsOff = tagDataOffset + ((bspArrPtr - oldBase) >>> 0);

    for (let b = 0; b < bspCount; b++) {
      const bEntryOff = bspArrAbsOff + b * 32;
      if (bEntryOff + 32 > out.length) break;
      const oldBspFileOff = out.readUInt32LE(bEntryOff + 0x00);
      const oldBspSize = out.readUInt32LE(bEntryOff + 0x04);
      const oldBspMem = out.readUInt32LE(bEntryOff + 0x08);
      if (oldBspFileOff < CACHE_FILE_HEADER_SIZE || oldBspFileOff + 0x18 > out.length) continue;

      const extVtxSize = out.readUInt32LE(oldBspFileOff + 0x04);
      const extVtxOff = out.readUInt32LE(oldBspFileOff + 0x08);
      const bspSig = out.readUInt32LE(oldBspFileOff + 0x14);
      if (bspSig !== 0x73627370) {
        throw new Error(
          `Expected 'sbsp' signature at BSP[${b}] header (0x${oldBspFileOff.toString(16)}), found 0x${bspSig.toString(16)}.`,
        );
      }

      if (extVtxSize > 0 && extVtxOff >= CACHE_FILE_HEADER_SIZE && oldBspFileOff + oldBspSize <= out.length) {
        const bspData = Buffer.from(out.subarray(oldBspFileOff, oldBspFileOff + oldBspSize));
        const extVtx = Buffer.from(out.subarray(extVtxOff, extVtxOff + extVtxSize));

        const newBspSize = (oldBspSize + extVtxSize) >>> 0;
        const newBspFileOff = extVtxOff >>> 0;
        const tagSpaceCeiling =
          newBspSize <= CE_STANDARD_TAG_SPACE_SIZE ? CE_STANDARD_TAG_SPACE_SIZE : CE_TAG_SPACE_SIZE;
        const newBspMem = ((CE_BASE_MEMORY_ADDRESS + tagSpaceCeiling - newBspSize) & ~0xfff) >>> 0;

        // Walk lightmaps block (bsp_data + 0x18 + 0x104, 32 bytes per element)
        const lmCount = bspData.readInt32LE(0x18 + 0x104);
        const lmPtr = bspData.readUInt32LE(0x18 + 0x108);
        const lmRelOff = (lmPtr - oldBspMem) >>> 0;
        let totalMaterialsPatched = 0;

        for (let l = 0; l < lmCount; l++) {
          const lmOff = lmRelOff + l * 32;
          if (lmOff + 32 > bspData.length) break;
          const matCount = bspData.readInt32LE(lmOff + 0x14);
          const matPtr = bspData.readUInt32LE(lmOff + 0x18);
          const matRelOff = (matPtr - oldBspMem) >>> 0;
          for (let m = 0; m < matCount; m++) {
            const matOff = matRelOff + m * 256;
            if (matOff + 256 > bspData.length) break;
            const vbCnt = bspData.readUInt32LE(matOff + 0xb4);
            const vbOff = bspData.readUInt32LE(matOff + 0xb8);
            const lmbCnt = bspData.readUInt32LE(matOff + 0xc8);
            const vBytes = (vbCnt * 56 + lmbCnt * 20) | 0;
            const vRelOff = (oldBspSize + vbOff) >>> 0;
            const vMemAddr = (newBspMem + vRelOff) >>> 0;

            bspData.writeUInt32LE(0, matOff + 0xb8); // vb_off = 0
            bspData.writeUInt32LE(0, matOff + 0xcc); // lmb_off = 0
            bspData.writeInt32LE(vBytes, matOff + 0xd8);
            bspData.writeUInt32LE(0, matOff + 0xdc);
            bspData.writeUInt32LE(vRelOff, matOff + 0xe0);
            bspData.writeUInt32LE(vMemAddr, matOff + 0xe4);
            bspData.writeUInt32LE(0, matOff + 0xe8);
            totalMaterialsPatched++;
          }
        }

        // Rewrite the 24-byte structure_bsp_header at bsp_data + 0x00
        bspData.writeUInt32LE((newBspMem + 0x18) >>> 0, 0x00);
        bspData.writeUInt32LE(0, 0x04);
        bspData.writeUInt32LE(0, 0x08);
        bspData.writeUInt32LE(0, 0x0c);
        bspData.writeUInt32LE(0, 0x10);
        bspData.writeUInt32LE(0x73627370, 0x14);
        pointersRebased++;

        // Rebase all 4-byte aligned pointers inside bsp_data[0x18 : old_bsp_size] where next_u32 == 0
        for (let off = 0x18; off + 8 <= oldBspSize; off += 4) {
          const val = bspData.readUInt32LE(off);
          const nextU32 = bspData.readUInt32LE(off + 4);
          if (nextU32 !== 0) continue;
          if (val >= oldBspMem && val <= oldBspMem + oldBspSize && (val & 3) === 0) {
            bspData.writeUInt32LE((val - oldBspMem + newBspMem) >>> 0, off);
            pointersRebased++;
          } else if (val >= oldBase + strTableStart && val < oldBase + strTableEnd) {
            bspData.writeUInt32LE((val - oldBase + CE_BASE_MEMORY_ADDRESS) >>> 0, off);
            pointersRebased++;
          }
        }

        // Concatenate new_bsp = bsp_data + ext_vtx and update scenario structure_bsp_reference
        bspData.copy(out, newBspFileOff);
        extVtx.copy(out, newBspFileOff + oldBspSize);
        out.writeUInt32LE(newBspFileOff, bEntryOff + 0x00);
        out.writeUInt32LE(newBspSize, bEntryOff + 0x04);
        out.writeUInt32LE(newBspMem, bEntryOff + 0x08);
        pointersRebased++;
        bspsConverted++;

        details.push(
          `Re-embedded MCC v13 externalized BSP[${b}] vertices at 0x${newBspFileOff.toString(16)} (${newBspSize.toLocaleString('en-US')} bytes, load address 0x${newBspMem.toString(16).toUpperCase()}, ${totalMaterialsPatched} lightmap material vertex block(s) linked).`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Step 3: Mask Raw Binary Blobs & Rebase Tag Cache Pointers (0x50000000 -> 0x40440000)
  // ---------------------------------------------------------------------------
  if (oldBase !== CE_BASE_MEMORY_ADDRESS) {
    const mask = new Uint8Array(tagDataSize);
    if (strTableEnd > strTableStart) {
      mask.fill(1, strTableStart, Math.min(tagDataSize, strTableEnd));
    }

    const markRawBlob = (rawFieldRelOff: number): void => {
      if (rawFieldRelOff < 0 || rawFieldRelOff + 20 > tagDataSize) return;
      const sz = out.readInt32LE(tagDataOffset + rawFieldRelOff);
      const ptr = out.readUInt32LE(tagDataOffset + rawFieldRelOff + 0x0c);
      if (sz > 0 && ptr >= oldBase && ptr + sz <= oldBase + tagDataSize) {
        const start = ptr - oldBase;
        mask.fill(1, start, Math.min(tagDataSize, start + sz));
      }
    };

    for (let i = 0; i < tagCount; i++) {
      const instRel = TAG_DATA_HEADER_PC_SIZE + i * TAG_ENTRY_SIZE;
      if (instRel + TAG_ENTRY_SIZE > tagDataSize) break;
      const cls = out.readUInt32LE(tagDataOffset + instRel + 0x00);
      const dataPtr = out.readUInt32LE(tagDataOffset + instRel + 0x14);
      if (dataPtr < oldBase || dataPtr >= oldBase + tagDataSize) continue;
      const tRel = dataPtr - oldBase;

      if (cls === 0x616e7472) {
        // 'antr': each animation's (+0x74, stride 0xB4) node_data (+0x48), default_data (+0x8C), uncompressed_data (+0xA0)
        const animCnt = out.readInt32LE(tagDataOffset + tRel + 0x74);
        const animPtr = out.readUInt32LE(tagDataOffset + tRel + 0x78);
        if (animCnt > 0 && animPtr >= oldBase && animPtr < oldBase + tagDataSize) {
          const animBase = animPtr - oldBase;
          for (let a = 0; a < animCnt; a++) {
            const aRel = animBase + a * 0xb4;
            markRawBlob(aRel + 0x48);
            markRawBlob(aRel + 0x8c);
            markRawBlob(aRel + 0xa0);
          }
        }
      } else if (cls === 0x736e6421) {
        // 'snd!': each pitch range's (+0x98, stride 0x48) permutation's (+0x3C, stride 0x7C) mouth_data (+0x54) and subtitle_data (+0x68)
        const prCnt = out.readInt32LE(tagDataOffset + tRel + 0x98);
        const prPtr = out.readUInt32LE(tagDataOffset + tRel + 0x9c);
        if (prCnt > 0 && prPtr >= oldBase && prPtr < oldBase + tagDataSize) {
          const prBase = prPtr - oldBase;
          for (let p = 0; p < prCnt; p++) {
            const pRel = prBase + p * 0x48;
            if (pRel + 0x48 > tagDataSize) break;
            const permCnt = out.readInt32LE(tagDataOffset + pRel + 0x3c);
            const permPtr = out.readUInt32LE(tagDataOffset + pRel + 0x40);
            if (permCnt > 0 && permPtr >= oldBase && permPtr < oldBase + tagDataSize) {
              const permBase = permPtr - oldBase;
              for (let m = 0; m < permCnt; m++) {
                const mRel = permBase + m * 0x7c;
                markRawBlob(mRel + 0x54);
                markRawBlob(mRel + 0x68);
              }
            }
          }
        }
      } else if (cls === 0x6d657472) {
        // 'metr': encoded_stencil (+0x98)
        markRawBlob(tRel + 0x98);
      } else if (cls === 0x666f6e74) {
        // 'font': character_data (+0x88)
        markRawBlob(tRel + 0x88);
      } else if (cls === 0x75737472) {
        // 'ustr': each string entry (+0x00, stride 20)
        const sCnt = out.readInt32LE(tagDataOffset + tRel + 0x00);
        const sPtr = out.readUInt32LE(tagDataOffset + tRel + 0x04);
        if (sCnt > 0 && sPtr >= oldBase && sPtr < oldBase + tagDataSize) {
          const sBase = sPtr - oldBase;
          for (let s = 0; s < sCnt; s++) {
            markRawBlob(sBase + s * 20);
          }
        }
      } else if (cls === 0x686d7420) {
        // 'hmt ': string (+0x00)
        markRawBlob(tRel + 0x00);
      } else if (cls === 0x73636e72) {
        // 'scnr': syntax_data (+0x474) and script_string_data (+0x488)
        markRawBlob(tRel + 0x474);
        markRawBlob(tRel + 0x488);
      }
    }

    // Rebase tag_header.instances_address (+0x00) and each tag_instance's name_ptr (+0x10) and data_ptr (+0x14)
    out.writeUInt32LE((tagInstancesAddress - oldBase + CE_BASE_MEMORY_ADDRESS) >>> 0, tagDataOffset + 0x00);
    pointersRebased++;

    for (let i = 0; i < tagCount; i++) {
      const instAbs = tagArrayOff + i * TAG_ENTRY_SIZE;
      if (instAbs + TAG_ENTRY_SIZE > out.length) break;
      const namePtr = out.readUInt32LE(instAbs + 0x10);
      if (namePtr >= oldBase && namePtr <= oldBase + tagDataSize) {
        out.writeUInt32LE((namePtr - oldBase + CE_BASE_MEMORY_ADDRESS) >>> 0, instAbs + 0x10);
        pointersRebased++;
      }
      const dataPtr = out.readUInt32LE(instAbs + 0x14);
      if (dataPtr >= oldBase && dataPtr <= oldBase + tagDataSize) {
        out.writeUInt32LE((dataPtr - oldBase + CE_BASE_MEMORY_ADDRESS) >>> 0, instAbs + 0x14);
        pointersRebased++;
      }
    }

    // For every unmasked 4-byte aligned offset off >= scnr_off in tag_data, if next_u32 == 0 and old_base <= val <= old_base + tag_data_size, rebase
    for (let off = scnrOff; off + 8 <= tagDataSize; off += 4) {
      if (mask[off] || mask[off + 1] || mask[off + 2] || mask[off + 3]) continue;
      const absOff = tagDataOffset + off;
      const val = out.readUInt32LE(absOff);
      const nextU32 = out.readUInt32LE(absOff + 4);
      if (nextU32 === 0 && val >= oldBase && val <= oldBase + tagDataSize) {
        out.writeUInt32LE((val - oldBase + CE_BASE_MEMORY_ADDRESS) >>> 0, absOff);
        pointersRebased++;
      }
    }

    details.push(
      `Rebased ${pointersRebased.toLocaleString('en-US')} tag & BSP pointer(s) from MCC base 0x${oldBase.toString(16).toUpperCase()} to CE base 0x40440000.`,
    );
  }

  // ---------------------------------------------------------------------------
  // Step 4: Clamp hs_syntax_data & Finalize CE v609 Header + Checksum
  // ---------------------------------------------------------------------------
  let hsSyntaxClamped = false;
  if (scnrAbsOff >= tagDataOffset && scnrAbsOff + 0x488 <= out.length) {
    const synPtr = out.readUInt32LE(scnrAbsOff + 0x474 + 0x0c);
    if (synPtr >= CE_BASE_MEMORY_ADDRESS && synPtr < CE_BASE_MEMORY_ADDRESS + tagDataSize) {
      const synAbs = tagDataOffset + (synPtr - CE_BASE_MEMORY_ADDRESS);
      if (synAbs >= tagDataOffset && synAbs + 0x38 <= out.length) {
        const maxCnt = out.readUInt16LE(synAbs + 0x20);
        const curSize = out.readUInt16LE(synAbs + 0x2e);
        if (maxCnt > CE_MAX_HS_SYNTAX_NODES && curSize <= CE_MAX_HS_SYNTAX_NODES) {
          out.writeUInt16LE(CE_MAX_HS_SYNTAX_NODES, synAbs + 0x20);
          out.writeInt32LE(CE_MAX_HS_SYNTAX_DATA_BYTES, scnrAbsOff + 0x474);
          hsSyntaxClamped = true;
          details.push(
            `Clamped MCC hs_syntax_data table (maximum_count ${maxCnt.toLocaleString('en-US')} -> ${CE_MAX_HS_SYNTAX_NODES.toLocaleString('en-US')}, size -> ${CE_MAX_HS_SYNTAX_DATA_BYTES.toLocaleString('en-US')} bytes).`,
          );
        }
      }
    }
  }

  out.writeUInt32LE(CacheFileEngine.CUSTOM_EDITION, 0x004);
  writeFixedString(out, 0x040, TAG_STRING_SIZE, CE_BUILD_STRING);
  out.fill(0, 0x068, 0x7fc);

  // Repair MCC/H1EK tag issues (BitmapData.flags 0x200 bit, object/shader types, font dims) before HaloScript AST pass & CRC32
  const tagRepairs = repairMccAndCeTagIssues(out);
  if (tagRepairs.bitmapFlagsRepaired > 0) {
    details.push(
      `Repaired ${tagRepairs.bitmapFlagsRepaired} MCC BitmapData.flags entry(s) (stripped bit 9 0x200 & ensured _bitmap_cached_bit 0x80).`,
    );
  }
  if (tagRepairs.objectTypesRepaired > 0) {
    details.push(`Repaired ${tagRepairs.objectTypesRepaired} byte-swapped _object_definition.type field(s).`);
  }
  if (tagRepairs.shadersRepaired > 0) {
    details.push(`Repaired ${tagRepairs.shadersRepaired} shader tag(s) (type & runtime detail/bump scales).`);
  }

  // Run the Fix CE Map AST sanitizer on the active syntax nodes and recompute header.crc32
  const scriptFix = fixCeMapHaloScriptAndCrc(out);
  details.push(
    `Converted header from v${sourceVersion} ("${sourceBuild}") -> v609 ("${CE_BUILD_STRING}") and zeroed header[0x68..0x7FB].`,
    `HaloScript AST Pass: ${scriptFix.nodesNeutralized} neutralized, ${scriptFix.nodesConvertedToGameRevert} converted to (game_revert).`,
    `Final CE Header CRC32 (0x64): 0x${scriptFix.newCrc32.toString(16).toUpperCase().padStart(8, '0')}.`,
  );

  return {
    action: 'mcc',
    ok: true,
    isPlaceholder: false,
    message: `Converted MCC map '${scriptFix.mapName}' (v${sourceVersion} -> v609), unified ${bspsConverted} split BSP(s), rebased ${pointersRebased.toLocaleString('en-US')} pointers, clamped hs_syntax_data (${hsSyntaxClamped ? '32,767 -> 19,001' : 'OK'}), and updated CRC32 to 0x${scriptFix.newCrc32.toString(16).toUpperCase().padStart(8, '0')}.`,
    sourceEngineVersion: sourceVersion,
    targetEngineVersion: CacheFileEngine.CUSTOM_EDITION,
    mapName: scriptFix.mapName,
    previousCrc32,
    newCrc32: scriptFix.newCrc32,
    sourceByteLength: source.length,
    outputByteLength: out.length,
    pointersRebased,
    externalRangesInternalized: 0,
    externalTagsLinkedToCe: 0,
    modelsConverted: 0,
    bspsDecompressed: bspsConverted,
    bitmapsDeswizzled: 0,
    p8BitmapsConverted: 0,
    scriptFix,
    details,
    buffer: out,
  };
}

/**
 * Resolves external resource tags (`bitm`, `snd!`, `font`, `ustr`, `hmt `) on a retail-layout (`v7`/`v609`) buffer:
 * 1) If matching source `bitmaps.map` / `sounds.map` are provided, internalizes all external pixel/sample ranges into the `.map`.
 * 2) If source resource files are not provided (or for remaining external tags) and Custom Edition resource maps are available,
 *    internalizes stock bitmap/sound data from CE's `bitmaps.map` / `sounds.map` by tag path or links `loc.map` tags.
 * 3) Applies tag block alignment (`applyTagDataAlignment`), required tag data repairs (`applyTagDataRepairs`),
 *    and model/bitmap repairs (`repairTruncatedBitmapMipmaps`, `repairCorruptedModelPartStrips`).
 */
function finalizeRetailLayoutToCeBuffer(
  working: Buffer,
  options: MapFixOptions,
  details: string[],
): {
  buffer: Buffer;
  externalRangesInternalized: number;
  externalTagsLinkedToCe: number;
} {
  let out: Buffer = Buffer.from(working);
  out.writeUInt32LE(CacheFileEngine.CUSTOM_EDITION, 0x004);
  writeFixedString(out, 0x040, TAG_STRING_SIZE, CE_BUILD_STRING);

  // Repair modelDataSize header slack if present
  const tdoInit = out.readUInt32LE(0x010);
  if (tdoInit + 0x24 <= out.length) {
    const modelOffInit = out.readUInt32LE(tdoInit + 0x14);
    const modelSizeInit = out.readUInt32LE(tdoInit + 0x20);
    if (
      modelOffInit > 0 &&
      modelSizeInit > 0 &&
      modelOffInit + modelSizeInit < tdoInit &&
      tdoInit - (modelOffInit + modelSizeInit) >= 1024
    ) {
      out.writeUInt32LE(tdoInit - modelOffInit, tdoInit + 0x20);
    }
  }

  let externalRangesInternalized = 0;
  let externalTagsLinkedToCe = 0;

  // Try full retail conversion pipeline first if source resources are provided
  try {
    const preHdr = parseCacheFileHeader(out);
    const preIdx = parseTagIndexForConversion(out, preHdr);
    repairTruncatedBitmapMipmaps(out, preHdr, preIdx);
    repairCorruptedModelPartStrips(out, preHdr, preIdx);

    const scan = scanPerAssetData(out, preHdr, preIdx);
    const counts = countExternal(scan);
    const hasExternalAssets = counts.bitmap.count + counts.sound.count > 0;

    if (hasExternalAssets && options.resources && (options.resources.bitmaps || options.resources.sounds)) {
      const tables: Partial<Record<ResourceKind, ResourceTable>> = {};
      if (options.resources.bitmaps) {
        const r = readResourceTable(options.resources.bitmaps, 'bitmaps');
        if (r.ok) tables.bitmaps = r.table;
      }
      if (options.resources.sounds) {
        const r = readResourceTable(options.resources.sounds, 'sounds');
        if (r.ok) tables.sounds = r.table;
      }
      const plan = planExternalImport(out, scan, tables);
      const unmatchedCount = plan.unmatched.bitmaps.length + plan.unmatched.sounds.length;
      if (!plan.rawRegionProblem && unmatchedCount <= 25) {
        const imported = importExternalData(out, plan, options.resources, { onProgress: options.onProgress });
        out = Buffer.from(imported.buffer);
        externalRangesInternalized += imported.rangesCopied;
        details.push(
          `Internalized ${imported.rangesCopied} external bitmap/sound asset range(s) (+${imported.bytesAdded.toLocaleString('en-US')} bytes).`,
        );
      }
    }

    // Fallback: if external bitmap/sound assets remain and CE resource files are available, match by tag path (`<path>__pixels` / `<path>__permutations`)
    const postHdr1 = parseCacheFileHeader(out);
    const postIdx1 = parseTagIndexForConversion(out, postHdr1);
    const postScan1 = scanPerAssetData(out, postHdr1, postIdx1);
    const postCounts1 = countExternal(postScan1);
    if (
      postCounts1.bitmap.count + postCounts1.sound.count > 0 &&
      options.ceResources &&
      (options.ceResources.bitmaps || options.ceResources.sounds)
    ) {
      const linked = linkOrInternalizeStockCeResources(out, postHdr1, postIdx1, options.ceResources);
      externalTagsLinkedToCe += linked;
      if (linked > 0) {
        details.push(`Matched and linked ${linked} stock resource tag(s) to Custom Edition resource maps.`);
      }
    }

    // Align tag data blocks if needed
    const alignHdr = parseCacheFileHeader(out);
    const alignIdx = parseTagIndexForConversion(out, alignHdr);
    const alignment = planTagDataAlignment(out, alignHdr, alignIdx);
    if (alignment.needed && alignment.problems.length === 0) {
      const aligned = applyTagDataAlignment(out, alignment);
      out = Buffer.from(aligned.buffer);
      details.push(`Aligned tag data blocks (+${alignment.bytes} byte(s), ${aligned.moved.toLocaleString('en-US')} pointers adjusted).`);
    }

    // Apply required tag data extent repairs (scriptSyntaxData, blockOverlap, tagRootOutside)
    const repairHdr = parseCacheFileHeader(out);
    const repairIdx = parseTagIndexForConversion(out, repairHdr);
    const extents = checkTagDataExtents(out, repairHdr, repairIdx);
    const repairPlan = planTagDataRepairs(out, repairHdr, repairIdx, extents);
    const requiredRepairs = repairPlan.repairs.filter((r) => r.required);
    if (requiredRepairs.length > 0) {
      const applied = applyTagDataRepairs(out, repairPlan, requiredRepairs);
      out = Buffer.from(applied.buffer);
      details.push(`Applied ${applied.applied.length} required tag data extent repair(s).`);
    }

    // Final model part and bitmap mipmap pass
    const finalHdr = parseCacheFileHeader(out);
    const finalIdx = parseTagIndexForConversion(out, finalHdr);
    const bmFixed = repairTruncatedBitmapMipmaps(out, finalHdr, finalIdx);
    const mpFixed = repairCorruptedModelPartStrips(out, finalHdr, finalIdx);
    if (bmFixed.bitmapsRepaired > 0) {
      details.push(`Repaired ${bmFixed.bitmapsRepaired} truncated bitmap mipmap count(s).`);
    }
    if (mpFixed.modelPartsRepaired > 0) {
      details.push(`Repaired ${mpFixed.modelPartsRepaired} model geometry part strip(s).`);
    }
  } catch (err) {
    details.push(`Tag repair note: ${(err as Error).message}`);
  }

  out.writeUInt32LE(CacheFileEngine.CUSTOM_EDITION, 0x004);
  out.writeUInt32LE(out.length >>> 0, 0x008);
  out.writeUInt32LE(0, 0x00c);
  writeFixedString(out, 0x040, TAG_STRING_SIZE, CE_BUILD_STRING);

  return { buffer: out, externalRangesInternalized, externalTagsLinkedToCe };
}

/**
 * Links stock tags present in CE's `bitmaps.map`, `sounds.map`, and `loc.map` by updating external asset offsets
 * or setting `in_resource_map` (`+0x18`) and resource index (`+0x14`) for Custom Edition `v609`.
 */
function linkOrInternalizeStockCeResources(
  buffer: Buffer,
  header: ReturnType<typeof parseCacheFileHeader>,
  tagIndex: ReturnType<typeof parseTagIndex>,
  ceResources: NonNullable<MapFixOptions['ceResources']>,
): number {
  let linkedCount = 0;
  const tdo = header.tagDataOffset;
  const arrayAt = tdo + TAG_DATA_HEADER_PC_SIZE;

  const bmByName = new Map<string, { index: number; dataOffset: number; size: number }>();
  if (ceResources.bitmaps) {
    const r = readResourceTable(ceResources.bitmaps, 'bitmaps');
    if (r.ok) {
      for (const e of r.table.entries) {
        bmByName.set(e.name.toLowerCase(), { index: e.index, dataOffset: e.dataOffset, size: e.size });
      }
    }
  }

  const locByName = new Map<string, number>();
  if (ceResources.loc && ceResources.loc.length >= 16) {
    const locBuf = ceResources.loc;
    const pathsOff = locBuf.readUInt32LE(0x04);
    const tableOff = locBuf.readUInt32LE(0x08);
    const count = locBuf.readUInt32LE(0x0c);
    if (tableOff + count * 12 <= locBuf.length && pathsOff <= tableOff) {
      for (let i = 0; i < count; i++) {
        const po = locBuf.readUInt32LE(tableOff + i * 12);
        let end = pathsOff + po;
        while (end < tableOff && locBuf[end] !== 0) end++;
        const name = locBuf.toString('latin1', pathsOff + po, end).toLowerCase();
        locByName.set(name, i);
      }
    }
  }

  for (const e of tagIndex.entries) {
    const entryOff = arrayAt + e.index * TAG_ENTRY_SIZE;
    if (entryOff + TAG_ENTRY_SIZE > buffer.length) continue;
    const key = e.path.toLowerCase();

    if (e.primaryClassName === 'bitmap' && !e.isExternal && bmByName.has(key)) {
      const bmEntry = bmByName.get(key)!;
      // Check if this bitmap's pixel data is marked external (flags & 0x100)
      const rootOff = tdo + (e.tagDataPointerOrResourceIndex - CE_BASE_MEMORY_ADDRESS);
      if (rootOff >= tdo && rootOff + 0x68 <= buffer.length) {
        const count = buffer.readUInt32LE(rootOff + 0x60);
        const ptr = buffer.readUInt32LE(rootOff + 0x64);
        const dataArrOff = tdo + (ptr - CE_BASE_MEMORY_ADDRESS);
        if (count > 0 && dataArrOff >= tdo && dataArrOff + 48 <= buffer.length) {
          const flags = buffer.readUInt16LE(dataArrOff + 0x0e);
          if ((flags & 0x100) !== 0) {
            buffer.writeUInt32LE(bmEntry.index >>> 0, entryOff + 0x14);
            buffer.writeUInt32LE(1, entryOff + 0x18);
            linkedCount++;
          }
        }
      }
    } else if (
      (e.primaryClassName === 'font' ||
        e.primaryClassName === 'unicode_string_list' ||
        e.primaryClassName === 'hud_message_text') &&
      !e.isExternal &&
      locByName.has(key)
    ) {
      // Only link to loc.map if the tag root is outside the tag data
      const rootOff = tdo + (e.tagDataPointerOrResourceIndex - CE_BASE_MEMORY_ADDRESS);
      if (rootOff < tdo || rootOff >= tdo + header.tagDataSize) {
        buffer.writeUInt32LE(locByName.get(key)! >>> 0, entryOff + 0x14);
        buffer.writeUInt32LE(1, entryOff + 0x18);
        linkedCount++;
      }
    }
  }

  return linkedCount;
}

/**
 * Extracts Halo Demo / Halo Trial (`version = 6`) scrambled header fields from either:
 * - PC Halo Trial layout (`0x58C` file_length, `0x594` tag_data_offset, `0x598` tag_data_size, `0x5A4` map_name, `0x5E4` scenario_type), OR
 * - Mac Halo Demo layout (`0x5E8` file_length, `0x5EC` tag_data_offset, `0x2C4` tag_data_size, `0x58C` map_name, `0x02` scenario_type).
 */
export function parseScrambledDemoHeader(buffer: Buffer): {
  version: number;
  fileLength: number;
  tagDataOffset: number;
  tagDataSize: number;
  mapName: string;
  buildString: string;
  scenarioType: number;
  crc32: number;
  variant: 'pc_trial' | 'mac_demo';
} {
  if (buffer.length < CACHE_FILE_HEADER_SIZE) {
    throw new Error(`File is too small (${buffer.length} bytes) to contain a Halo Demo header.`);
  }
  const magicStr = buffer.toString('latin1', 0x2c0, 0x2c4);
  const versionAt588 = buffer.readUInt32LE(0x588);
  if ((magicStr !== 'Ehed' && magicStr !== 'dehE') || versionAt588 !== CacheFileEngine.DEMO) {
    throw new Error(
      `Not a Halo Demo / Trial map (expected 'Ehed'/'dehE' at 0x2C0 and version 6 at 0x588, got '${magicStr}' and version ${versionAt588}).`,
    );
  }

  // Check PC Halo Trial offsets first (`0x58C` file_length, `0x594` tag_data_offset, `0x598` tag_data_size)
  const trialFileLen = buffer.readUInt32LE(0x58c);
  const trialTdo = buffer.readUInt32LE(0x594);
  const trialTds = buffer.readUInt32LE(0x598);
  const isTrialValid =
    trialTdo >= CACHE_FILE_HEADER_SIZE &&
    trialTds >= TAG_DATA_HEADER_PC_SIZE &&
    trialTdo + trialTds <= buffer.length &&
    buffer.readUInt32LE(trialTdo + 0x24) === CacheFileLiteral.TAGS;

  if (isTrialValid) {
    return {
      version: versionAt588,
      fileLength: trialFileLen > 0 ? trialFileLen : buffer.length,
      tagDataOffset: trialTdo,
      tagDataSize: trialTds,
      mapName: readFixedString(buffer, 0x5a4, TAG_STRING_SIZE) || 'demo_map',
      buildString: readFixedString(buffer, 0x2c8, TAG_STRING_SIZE) || '01.00.00.0576',
      scenarioType: buffer.readInt16LE(0x5e4),
      crc32: buffer.readUInt32LE(0x5e8),
      variant: 'pc_trial',
    };
  }

  // Mac Halo Demo offsets (`0x5E8` file_length, `0x5EC` tag_data_offset, `0x2C4` tag_data_size, `0x58C` map_name, `0x02` scenario_type)
  const macFileLen = buffer.readUInt32LE(0x5e8);
  const macTdo = buffer.readUInt32LE(0x5ec);
  const macTds = buffer.readUInt32LE(0x2c4);
  if (macTdo < CACHE_FILE_HEADER_SIZE || macTds < TAG_DATA_HEADER_PC_SIZE || macTdo + macTds > buffer.length) {
    throw new Error(
      `Halo Demo header tag data bounds (offset 0x${macTdo.toString(16)}, size 0x${macTds.toString(16)}) lie outside the file (${buffer.length} bytes).`,
    );
  }

  return {
    version: versionAt588,
    fileLength: macFileLen > 0 ? macFileLen : buffer.length,
    tagDataOffset: macTdo,
    tagDataSize: macTds,
    mapName: readFixedString(buffer, 0x58c, TAG_STRING_SIZE) || 'demo_map',
    buildString: readFixedString(buffer, 0x2c8, TAG_STRING_SIZE) || '01.00.00.0577',
    scenarioType: buffer.readUInt16LE(0x002),
    crc32: buffer.readUInt32LE(0x5b0),
    variant: 'mac_demo',
  };
}

/**
 * Action 3: `Fix Halo Demo Map` (Halo Trial / Mac Demo `v6` -> CE `v609`)
 * 1) Rebuilds scrambled 2048-byte `'Ehed'` Demo header (`0x2C0`/`0x588`) into a clean `'daeh'` `v609` header.
 * 2) Rebases all memory pointers in Tag Data and Structure BSPs from `source_base = tag_instances_address - 0x28`
 *    (`0x4BF10000`) to `0x40440000` (`delta = source_base - 0x40440000 = 0x0BAD0000`).
 * 3) Internalizes/resolves external resource map references (`bitm`, `snd!`, `ustr`, `font`, `hmt `).
 * 4) Runs `Fix CE Map` HaloScript AST pass (`fixCeMapHaloScriptAndCrc`) and recomputes CE CRC32 at `header[0x64]`.
 */
export function fixHaloDemoMapToCe(source: Buffer, options: MapFixOptions = {}): MapFixActionResult {
  const demoHdr = parseScrambledDemoHeader(source);
  const copy = Buffer.from(source);
  const { tagDataOffset: tdo, tagDataSize: tds } = demoHdr;

  const tagInstancesAddress = copy.readUInt32LE(tdo + 0x00);
  const sourceBase = (tagInstancesAddress - TAG_DATA_HEADER_PC_SIZE) >>> 0;
  const deltaToCe = (CE_BASE_MEMORY_ADDRESS - sourceBase) | 0; // -0x0BAD0000 when sourceBase == 0x4BF10000
  const tagCount = copy.readUInt32LE(tdo + 0x0c);
  const scenarioTagId = copy.readUInt32LE(tdo + 0x04);
  const arrayAt = tdo + TAG_DATA_HEADER_PC_SIZE;

  const details: string[] = [
    `Detected Halo Demo (${demoHdr.variant === 'pc_trial' ? 'PC Halo Trial' : 'Mac Halo Demo'}) header ('Ehed' at 0x2C0, version = ${demoHdr.version} at 0x588, build ${demoHdr.buildString}).`,
    `Tag Cache Base Address: 0x${sourceBase.toString(16).toUpperCase()} -> 0x${CE_BASE_MEMORY_ADDRESS.toString(16).toUpperCase()} (delta -0x${(sourceBase - CE_BASE_MEMORY_ADDRESS).toString(16).toUpperCase()}).`,
  ];

  let pointersRebased = 0;
  if (sourceBase !== CE_BASE_MEMORY_ADDRESS) {
    const entries: TagDataLayout['entries'][number][] = [];
    for (let i = 0; i < tagCount; i++) {
      const at = arrayAt + i * TAG_ENTRY_SIZE;
      const fourcc = copy.readUInt32LE(at);
      const pathPtr = copy.readUInt32LE(at + 0x10);
      const pathOff = tdo + ((pathPtr - sourceBase) | 0);
      const path =
        pathOff >= tdo && pathOff < tdo + tds
          ? readNullTerminatedAscii(copy, tdo, tds, pathOff - tdo)
          : `(tag #${i})`;
      entries.push({
        index: i,
        path,
        primaryClassName:
          i === (scenarioTagId & 0xffff) && copy.readUInt32LE(at + 0x0c) === scenarioTagId
            ? 'scenario'
            : (lookupTagClass(fourcc)?.name ?? fourCCToString(fourcc)),
        isExternal: copy.readUInt32LE(at + 0x18) === 1,
      });
    }

    const tagLayout: TagDataLayout = {
      tagDataOffset: tdo,
      tagDataSize: tds,
      baseMemoryAddress: sourceBase,
      tagArrayFileOffset: arrayAt,
      entries,
    };

    const tolerated: ToleratedPointer[] = [];
    const tolerate = { staleReferencePaths: true, rootsOutsideTagData: true };
    const sites = [
      ...collectTagDataPointers(copy, tagLayout, { tolerate, tolerated }),
      ...collectBspSpacePointers(copy, tagLayout, { tolerate }),
    ];

    for (const s of sites) {
      copy.writeUInt32LE((s.value + deltaToCe) >>> 0, s.at);
      pointersRebased++;
    }
    copy.writeUInt32LE(CE_TAG_ARRAY_ADDRESS, tdo + 0x00);
    copy.writeUInt32LE(
      (copy.readUInt32LE(tdo + 0x00) === CE_TAG_ARRAY_ADDRESS ? pointersRebased + 1 : pointersRebased) >>> 0,
      tdo + 0x00,
    );
    copy.writeUInt32LE(CE_TAG_ARRAY_ADDRESS, tdo + 0x00);
    pointersRebased += 1;
    details.push(`Rebased ${pointersRebased.toLocaleString('en-US')} pointers from 0x${sourceBase.toString(16).toUpperCase()} to 0x40440000.`);
  }

  // Rebuild clean 2048-byte (0x800) Custom Edition header
  copy.fill(0, 0, CACHE_FILE_HEADER_SIZE);
  copy.writeUInt32LE(CacheFileLiteral.HEAD, 0x000);
  copy.writeUInt32LE(CacheFileEngine.CUSTOM_EDITION, 0x004);
  copy.writeUInt32LE(copy.length >>> 0, 0x008);
  copy.writeUInt32LE(0, 0x00c);
  copy.writeUInt32LE(tdo >>> 0, 0x010);
  copy.writeUInt32LE(tds >>> 0, 0x014);
  writeFixedString(copy, 0x020, TAG_STRING_SIZE, demoHdr.mapName);
  writeFixedString(copy, 0x040, TAG_STRING_SIZE, CE_BUILD_STRING);
  copy.writeInt16LE(demoHdr.scenarioType, 0x060);
  copy.writeUInt32LE(demoHdr.crc32 >>> 0, 0x064);
  copy.writeUInt32LE(CacheFileLiteral.FOOT, 0x7fc);

  const finalized = finalizeRetailLayoutToCeBuffer(copy, options, details);
  const scriptFix = fixCeMapHaloScriptAndCrc(finalized.buffer);

  details.push(
    `HaloScript AST Pass: ${scriptFix.nodesNeutralized} neutralized, ${scriptFix.nodesConvertedToGameRevert} converted to (game_revert).`,
    `Final CE Header CRC32 (0x64): 0x${scriptFix.newCrc32.toString(16).toUpperCase().padStart(8, '0')}.`,
  );

  return {
    action: 'demo',
    ok: true,
    message: `Converted Halo Demo map '${demoHdr.mapName}' (v6 -> v609), rebased ${pointersRebased.toLocaleString('en-US')} pointers, internalized ${finalized.externalRangesInternalized} asset range(s), fixed ${scriptFix.nodesNeutralized + scriptFix.nodesConvertedToGameRevert} script node(s), and updated CRC32 to 0x${scriptFix.newCrc32.toString(16).toUpperCase().padStart(8, '0')}.`,
    sourceEngineVersion: CacheFileEngine.DEMO,
    targetEngineVersion: CacheFileEngine.CUSTOM_EDITION,
    mapName: scriptFix.mapName,
    previousCrc32: demoHdr.crc32,
    newCrc32: scriptFix.newCrc32,
    sourceByteLength: source.length,
    outputByteLength: finalized.buffer.length,
    pointersRebased,
    externalRangesInternalized: finalized.externalRangesInternalized,
    externalTagsLinkedToCe: finalized.externalTagsLinkedToCe,
    modelsConverted: 0,
    bspsDecompressed: 0,
    bitmapsDeswizzled: 0,
    p8BitmapsConverted: 0,
    scriptFix,
    details,
    buffer: finalized.buffer,
  };
}

/**
 * Action 4: `Fix Halo MD Map` (HaloMD / Mac Retail `v7` -> CE `v609`)
 * 1) Verifies `"head"` magic and `version == 7` (or `609` if already stamped), updates `version` at `0x04` to `609`
 *    and `build` string at `0x40` to `"01.00.00.0609"`.
 * 2) Internalizes or links external resource map tags (`bitm`, `snd!`, `font`, `ustr`, `hmt `).
 * 3) Runs `Fix CE Map` HaloScript AST pass (`fixCeMapHaloScriptAndCrc`) and recomputes CE CRC32 at `header[0x64]`.
 */
export function fixHaloMdMapToCe(source: Buffer, options: MapFixOptions = {}): MapFixActionResult {
  if (source.length < CACHE_FILE_HEADER_SIZE) {
    throw new Error(`File is too small (${source.length} bytes) to be a HaloMD / Retail cache file.`);
  }
  const headMagic = source.readUInt32LE(0x000);
  const footMagic = source.readUInt32LE(0x7fc);
  if (headMagic !== CacheFileLiteral.HEAD || footMagic !== CacheFileLiteral.FOOT) {
    throw new Error('Invalid cache header magic (expected "head" at 0x000 and "foot" at 0x7FC).');
  }
  const sourceVersion = source.readUInt32LE(0x004);
  if (sourceVersion !== CacheFileEngine.RETAIL && sourceVersion !== CacheFileEngine.CUSTOM_EDITION) {
    throw new Error(`Expected HaloMD / Retail map (version = 7), but found version = ${sourceVersion}.`);
  }

  const prevCrc32 = source.readUInt32LE(0x064);
  const prevBuild = readFixedString(source, 0x040, TAG_STRING_SIZE);
  const mapName = readFixedString(source, 0x020, TAG_STRING_SIZE);

  const details: string[] = [
    `Detected HaloMD / Retail map '${mapName}' (version = ${sourceVersion}, build '${prevBuild}').`,
    `Updated header version (0x04) to 609 and build string (0x40) to '${CE_BUILD_STRING}'.`,
  ];

  const finalized = finalizeRetailLayoutToCeBuffer(source, options, details);
  const scriptFix = fixCeMapHaloScriptAndCrc(finalized.buffer);

  details.push(
    `HaloScript AST Pass: ${scriptFix.nodesNeutralized} neutralized, ${scriptFix.nodesConvertedToGameRevert} converted to (game_revert).`,
    `Final CE Header CRC32 (0x64): 0x${scriptFix.newCrc32.toString(16).toUpperCase().padStart(8, '0')}.`,
  );

  return {
    action: 'halomd',
    ok: true,
    message: `Converted HaloMD map '${mapName}' (v${sourceVersion} -> v609), internalized ${finalized.externalRangesInternalized} asset range(s), fixed ${scriptFix.nodesNeutralized + scriptFix.nodesConvertedToGameRevert} script node(s), and updated CRC32 to 0x${scriptFix.newCrc32.toString(16).toUpperCase().padStart(8, '0')}.`,
    sourceEngineVersion: sourceVersion,
    targetEngineVersion: CacheFileEngine.CUSTOM_EDITION,
    mapName: scriptFix.mapName,
    previousCrc32: prevCrc32,
    newCrc32: scriptFix.newCrc32,
    sourceByteLength: source.length,
    outputByteLength: finalized.buffer.length,
    pointersRebased: 0,
    externalRangesInternalized: finalized.externalRangesInternalized,
    externalTagsLinkedToCe: finalized.externalTagsLinkedToCe,
    modelsConverted: 0,
    bspsDecompressed: 0,
    bitmapsDeswizzled: 0,
    p8BitmapsConverted: 0,
    scriptFix,
    details,
    buffer: finalized.buffer,
  };
}

/**
 * Action 5: `Fix Xbox Map` (Halo Xbox `v5` -> CE `v609`)
 * 1) Decompresses the Xbox payload at `0x800` if compressed (`ensureXboxMapDecompressed`).
 * 2) Converts Structure BSPs (`sbsp`): decompresses 32-byte Xbox environment vertices into 56-byte PC vertices
 *    and 8-byte Xbox lightmap vertices into 20-byte PC vertices, zeroes `structure_bsp_header` `+0x04..+0x13`,
 *    and rebases BSP pointers to CE's 23 MiB tag space top (`0x41B40000 - bspSize`).
 * 3) Deswizzles Xbox tiled textures (`flags & 0x08`) and converts `P8` (`format = 17`) bitmaps into `A8R8G8B8` (`format = 11`).
 * 4) Converts Xbox `model` (`mode`) tags to PC `gbxmodel` (`mod2`), decompressing 32-byte Xbox model vertices into
 *    68-byte (`0x44`) uncompressed PC vertices and packing contiguous model vertex/index buffers at `model_data_offset`.
 * 5) Expands the `0x24`-byte Xbox Tag Index header to `0x28` bytes and rebases all Tag Data pointers from `0x803A6000` to `0x40440000`.
 * 6) Writes a `v609` header, runs `Fix CE Map` HaloScript AST pass (`fixCeMapHaloScriptAndCrc`), and recomputes CE CRC32 at `header[0x64]`.
 */
export function fixXboxMapToCe(source: Buffer, _options: MapFixOptions = {}): MapFixActionResult {
  if (source.length < CACHE_FILE_HEADER_SIZE) {
    throw new Error(`File is too small (${source.length} bytes) to be a Halo Xbox cache file.`);
  }
  const engine = source.readUInt32LE(0x004);
  if (engine !== CacheFileEngine.XBOX) {
    throw new Error(`Expected Halo Xbox map (version = 5), but found version = ${engine}.`);
  }

  const decompressed = Buffer.from(ensureXboxMapDecompressed(source));
  const xboxHdr = parseCacheFileHeader(decompressed);
  const xboxIdx = parseTagIndex(decompressed, xboxHdr);

  const oldTdo = xboxHdr.tagDataOffset;
  const oldTds = xboxHdr.tagDataSize;
  const tagCount = xboxIdx.tagCount;
  const scnrIdx = xboxIdx.scenarioTagId & 0xffff;
  const oldTagArrayOff = oldTdo + TAG_DATA_HEADER_XBOX_SIZE;

  const details: string[] = [
    `Decompressed Xbox cache file '${xboxHdr.scenarioName}' (version = 5, build '${xboxHdr.buildString}', ${decompressed.length.toLocaleString('en-US')} bytes).`,
  ];

  // Collect all pointer sites in Xbox tag data BEFORE we mutate model/bsp structs
  const layoutEntries: TagDataLayout['entries'] = xboxIdx.entries.map((e) => ({
    index: e.index,
    path: e.path,
    primaryClassName: e.primaryClassName,
    isExternal: e.isExternal,
  }));

  // ---------------------------------------------------------------------------
  // Step 1: Decompress Structure BSPs (32B env -> 56B, 8B lightmap -> 20B)
  // ---------------------------------------------------------------------------
  const scnrEntryOff = oldTagArrayOff + scnrIdx * TAG_ENTRY_SIZE;
  const scnrPtr = decompressed.readUInt32LE(scnrEntryOff + 0x14);
  const scnrOff = oldTdo + (scnrPtr - XBOX_BASE_MEMORY_ADDRESS);
  const bspCount = decompressed.readInt32LE(scnrOff + 0x5a4);
  const bspArrPtr = decompressed.readUInt32LE(scnrOff + 0x5a8);
  const bspArrOff = oldTdo + (bspArrPtr - XBOX_BASE_MEMORY_ADDRESS);

  const convertedBspBuffers: Buffer[] = [];
  let oldBspEnd = CACHE_FILE_HEADER_SIZE;
  let bspsDecompressed = 0;

  for (let b = 0; b < bspCount; b++) {
    const bEntryOff = bspArrOff + b * 32;
    const oldBspStart = decompressed.readUInt32LE(bEntryOff + 0x00);
    const oldBspSize = decompressed.readUInt32LE(bEntryOff + 0x04);
    const oldBspAddr = decompressed.readUInt32LE(bEntryOff + 0x08);
    oldBspEnd = Math.max(oldBspEnd, oldBspStart + oldBspSize);

    const oldSbspPtr = decompressed.readUInt32LE(oldBspStart + 0x00);
    const oldSbspOff = oldBspStart + (oldSbspPtr - oldBspAddr);
    const bspMetaBodyLen = oldBspStart + oldBspSize - oldSbspOff;

    // First pass over BSP materials to build the uncompressed vertex pool (56B rendered + 20B lightmap)
    const lmCount = decompressed.readInt32LE(oldSbspOff + 0x104);
    const lmPtr = decompressed.readUInt32LE(oldSbspOff + 0x108);
    const lmBaseOff = oldBspStart + (lmPtr - oldBspAddr);

    const vertChunks: Buffer[] = [];
    let vertPoolBytes = 0;
    const matVertPatchList: {
      matRelOff: number;
      vCount: number;
      lmvCount: number;
      poolOffset: number;
      byteLen: number;
    }[] = [];

    for (let l = 0; l < lmCount; l++) {
      const lOff = lmBaseOff + l * 32;
      const matCount = decompressed.readInt32LE(lOff + 0x14);
      const matPtr = decompressed.readUInt32LE(lOff + 0x18);
      const matBaseOff = oldBspStart + (matPtr - oldBspAddr);

      for (let m = 0; m < matCount; m++) {
        const mOff = matBaseOff + m * 256;
        const vCount = decompressed.readUInt32LE(mOff + 0xb4);
        const rvIdxPtr = decompressed.readUInt32LE(mOff + 0xc0);
        const lmvCount = decompressed.readUInt32LE(mOff + 0xc8);
        const lmvIdxPtr = decompressed.readUInt32LE(mOff + 0xd4);
        const compVertPtr = decompressed.readUInt32LE(mOff + 0xf8);

        let srcRenderVertOff = 0;
        if (rvIdxPtr >= oldBspAddr && rvIdxPtr + 12 <= oldBspAddr + oldBspSize) {
          const indOff = oldBspStart + (rvIdxPtr - oldBspAddr);
          const actualPtr = decompressed.readUInt32LE(indOff + 4);
          srcRenderVertOff = oldBspStart + (actualPtr - oldBspAddr);
        } else if (compVertPtr >= oldBspAddr) {
          srcRenderVertOff = oldBspStart + (compVertPtr - oldBspAddr);
        }

        let srcLmVertOff = 0;
        if (lmvCount > 0) {
          if (lmvIdxPtr >= oldBspAddr && lmvIdxPtr + 12 <= oldBspAddr + oldBspSize) {
            const indOff = oldBspStart + (lmvIdxPtr - oldBspAddr);
            const actualPtr = decompressed.readUInt32LE(indOff + 4);
            srcLmVertOff = oldBspStart + (actualPtr - oldBspAddr);
          } else if (srcRenderVertOff > 0) {
            srcLmVertOff = srcRenderVertOff + vCount * 32;
          }
        }

        const uncompByteLen = vCount * 56 + lmvCount * 20;
        const chunk = Buffer.alloc(uncompByteLen);

        for (let v = 0; v < vCount; v++) {
          const sOff = srcRenderVertOff + v * 32;
          const dOff = v * 56;
          if (sOff + 32 <= decompressed.length) {
            decompressed.copy(chunk, dOff + 0x00, sOff + 0x00, sOff + 0x0c); // position (12B)
            const [nx, ny, nz] = unpackCompressedUnitVector32(decompressed.readUInt32LE(sOff + 0x0c));
            const [bx, by, bz] = unpackCompressedUnitVector32(decompressed.readUInt32LE(sOff + 0x10));
            const [tx, ty, tz] = unpackCompressedUnitVector32(decompressed.readUInt32LE(sOff + 0x14));
            chunk.writeFloatLE(nx, dOff + 0x0c);
            chunk.writeFloatLE(ny, dOff + 0x10);
            chunk.writeFloatLE(nz, dOff + 0x14);
            chunk.writeFloatLE(bx, dOff + 0x18);
            chunk.writeFloatLE(by, dOff + 0x1c);
            chunk.writeFloatLE(bz, dOff + 0x20);
            chunk.writeFloatLE(tx, dOff + 0x24);
            chunk.writeFloatLE(ty, dOff + 0x28);
            chunk.writeFloatLE(tz, dOff + 0x2c);
            decompressed.copy(chunk, dOff + 0x30, sOff + 0x18, sOff + 0x20); // uv (8B)
          }
        }

        const lmDstBase = vCount * 56;
        for (let lv = 0; lv < lmvCount; lv++) {
          const sOff = srcLmVertOff + lv * 8;
          const dOff = lmDstBase + lv * 20;
          if (sOff + 8 <= decompressed.length) {
            const [lnx, lny, lnz] = unpackCompressedUnitVector32(decompressed.readUInt32LE(sOff + 0x00));
            const lu = decompressed.readInt16LE(sOff + 0x04) / 32767.0;
            const lvCoord = decompressed.readInt16LE(sOff + 0x06) / 32767.0;
            chunk.writeFloatLE(lnx, dOff + 0x00);
            chunk.writeFloatLE(lny, dOff + 0x04);
            chunk.writeFloatLE(lnz, dOff + 0x08);
            chunk.writeFloatLE(lu, dOff + 0x0c);
            chunk.writeFloatLE(lvCoord, dOff + 0x10);
          }
        }

        matVertPatchList.push({
          matRelOff: mOff - oldSbspOff,
          vCount,
          lmvCount,
          poolOffset: vertPoolBytes,
          byteLen: uncompByteLen,
        });
        vertChunks.push(chunk);
        vertPoolBytes += uncompByteLen;
      }
    }

    // Clear Xbox BSP header +0x04..+0x13 and material runtime pointers in `decompressed` so `collectBspSpacePointers` walks cleanly
    decompressed.fill(0, oldBspStart + 0x04, oldBspStart + 0x14);
    for (const mp of matVertPatchList) {
      const mAbsOff = oldSbspOff + mp.matRelOff;
      decompressed.writeUInt32LE(0, mAbsOff + 0xc0);
      decompressed.writeUInt32LE(0, mAbsOff + 0xd4);
      decompressed.fill(0, mAbsOff + 0xd8, mAbsOff + 0x100);
    }

    // Collect BSP internal pointers before compacting the BSP header
    const tempLayout: TagDataLayout = {
      tagDataOffset: oldTdo,
      tagDataSize: oldTds,
      baseMemoryAddress: XBOX_BASE_MEMORY_ADDRESS,
      tagArrayFileOffset: oldTagArrayOff,
      entries: layoutEntries,
    };
    const bspSites = collectBspSpacePointers(decompressed, tempLayout, {
      tolerate: { staleReferencePaths: true, rootsOutsideTagData: true },
    });

    // Assemble the new PC/CE BSP buffer:
    // [0x00..0x18): structure_bsp_header
    // [0x18..0x18 + bspMetaBodyLen): ScenarioStructureBSP + all reflexive blocks
    // [0x18 + bspMetaBodyLen..newBspSize): Uncompressed 56B + 20B vertex pool (padded to 0x800 alignment)
    const rawNewBspSize = 0x18 + bspMetaBodyLen + vertPoolBytes;
    const newBspSize = (rawNewBspSize + 0x7ff) & ~0x7ff;
    const newBspAddress = (CE_BASE_MEMORY_ADDRESS + CE_TAG_SPACE_SIZE - newBspSize) >>> 0;
    const newSbspPtr = (newBspAddress + 0x18) >>> 0;
    const bspPtrDelta = (newSbspPtr - oldSbspPtr) | 0;

    // Rebase all internal BSP pointers inside `decompressed` before copying the meta body
    for (const s of bspSites) {
      if (s.at >= oldSbspOff && s.at < oldBspStart + oldBspSize) {
        decompressed.writeUInt32LE((s.value + bspPtrDelta) >>> 0, s.at);
      }
    }

    const newBspBuf = Buffer.alloc(newBspSize);
    newBspBuf.writeUInt32LE(newSbspPtr, 0x00);
    newBspBuf.writeUInt32LE(0x73627370, 0x14); // 'sbsp'
    decompressed.copy(newBspBuf, 0x18, oldSbspOff, oldBspStart + oldBspSize);

    const vertPoolStartInBsp = 0x18 + bspMetaBodyLen;
    let poolWriteOff = vertPoolStartInBsp;
    for (const chunk of vertChunks) {
      chunk.copy(newBspBuf, poolWriteOff);
      poolWriteOff += chunk.length;
    }

    // Patch each material's uncompressed vertex fields in `newBspBuf`
    for (const mp of matVertPatchList) {
      const mNewOff = 0x18 + mp.matRelOff;
      const vertVirtualAddr = (newBspAddress + vertPoolStartInBsp + mp.poolOffset) >>> 0;
      newBspBuf.writeUInt16LE(0, mNewOff + 0xb0); // rendered vertices type = 0 (uncompressed)
      newBspBuf.writeUInt32LE(mp.poolOffset >>> 0, mNewOff + 0xb8);
      newBspBuf.writeUInt32LE(0, mNewOff + 0xc0);
      newBspBuf.writeUInt16LE(2, mNewOff + 0xc4); // lightmap vertices type = 2 (uncompressed)
      newBspBuf.writeUInt32LE((mp.poolOffset + mp.vCount * 56) >>> 0, mNewOff + 0xcc);
      newBspBuf.writeUInt32LE(0, mNewOff + 0xd4);
      newBspBuf.writeUInt32LE(mp.byteLen >>> 0, mNewOff + 0xd8);
      newBspBuf.writeUInt32LE(0, mNewOff + 0xdc);
      newBspBuf.writeUInt32LE(0, mNewOff + 0xe0);
      newBspBuf.writeUInt32LE(vertVirtualAddr, mNewOff + 0xe4);
      newBspBuf.writeUInt32LE(0, mNewOff + 0xe8);
      newBspBuf.fill(0, mNewOff + 0xec, mNewOff + 0x100);
    }

    convertedBspBuffers.push(newBspBuf);
    bspsDecompressed++;
  }

  // Update ScenarioBSP entries with new BSP file offsets, sizes, and CE load addresses
  let runningBspFileOffset = CACHE_FILE_HEADER_SIZE;
  for (let b = 0; b < convertedBspBuffers.length; b++) {
    const bEntryOff = bspArrOff + b * 32;
    const bBuf = convertedBspBuffers[b];
    const bAddr = (CE_BASE_MEMORY_ADDRESS + CE_TAG_SPACE_SIZE - bBuf.length) >>> 0;
    decompressed.writeUInt32LE(runningBspFileOffset >>> 0, bEntryOff + 0x00);
    decompressed.writeUInt32LE(bBuf.length >>> 0, bEntryOff + 0x04);
    decompressed.writeUInt32LE(bAddr, bEntryOff + 0x08);
    runningBspFileOffset += bBuf.length;
  }
  const newBspEnd = runningBspFileOffset;
  details.push(`Decompressed ${bspsDecompressed} Xbox Structure BSP(s) (32B env -> 56B, 8B lightmap -> 20B).`);

  // ---------------------------------------------------------------------------
  // Step 2: Deswizzle Xbox Tiled Bitmaps & Convert P8 Bitmaps to A8R8G8B8
  // ---------------------------------------------------------------------------
  const BITS_PER_PIXEL = [8, 8, 8, 16, 0, 0, 16, 0, 16, 16, 32, 32, 0, 0, 4, 8, 8, 8];
  const rawAssetChunks: Buffer[] = [];
  let newRawAssetsSize = 0;
  let bitmapsDeswizzled = 0;
  let p8BitmapsConverted = 0;

  // Walk all bitmaps and sounds to build the new raw asset section starting at `newBspEnd`
  const assetScan = scanPerAssetData(decompressed, xboxHdr, xboxIdx);
  for (const asset of assetScan.assets) {
    if (asset.external || asset.size <= 0) continue;
    if (asset.kind === 'bitmap') {
      // `asset.offsetFieldAt` is `BitmapData + 0x18`, so `BitmapData` starts at `asset.offsetFieldAt - 0x18`
      const bdOff = asset.offsetFieldAt - 0x18;
      const width = decompressed.readUInt16LE(bdOff + 0x04);
      const height = decompressed.readUInt16LE(bdOff + 0x06);
      const depth = decompressed.readUInt16LE(bdOff + 0x08);
      const type = decompressed.readUInt16LE(bdOff + 0x0a);
      const format = decompressed.readUInt16LE(bdOff + 0x0c);
      const flags = decompressed.readUInt16LE(bdOff + 0x0e);
      const mipmapCount = decompressed.readUInt16LE(bdOff + 0x14);
      const isSwizzled = (flags & 0x08) !== 0;
      const isCompressedDxt = format >= 14 && format <= 16;

      if (format === 17) {
        // Convert P8 palettized bump bitmap (format 17, 1B/px) -> A8R8G8B8 (format 11, 4B/px)
        const mipBuffers: Buffer[] = [];
        let srcCursor = asset.offset;
        const faces = type === 2 ? 6 : 1;
        for (let level = 0; level <= mipmapCount; level++) {
          const mw = Math.max(width >> level, 1);
          const mh = Math.max(height >> level, 1);
          const md = Math.max(depth >> level, 1);
          const sliceBytes = mw * mh;
          for (let f = 0; f < faces * md; f++) {
            const linearP8 =
              isSwizzled && srcCursor + sliceBytes <= decompressed.length
                ? unswizzleMorton2D(decompressed, srcCursor, mw, mh, 1)
                : decompressed.subarray(srcCursor, Math.min(decompressed.length, srcCursor + sliceBytes));
            srcCursor += sliceBytes;
            const argbSlice = Buffer.alloc(sliceBytes * 4);
            for (let px = 0; px < sliceBytes; px++) {
              const v = linearP8[px] ?? 128;
              argbSlice[px * 4 + 0] = v;
              argbSlice[px * 4 + 1] = v;
              argbSlice[px * 4 + 2] = v;
              argbSlice[px * 4 + 3] = 255;
            }
            mipBuffers.push(argbSlice);
          }
        }
        const convertedPixels = Buffer.concat(mipBuffers);
        const newFileOff = newBspEnd + newRawAssetsSize;
        decompressed.writeUInt16LE(11, bdOff + 0x0c); // format = 11 (A8R8G8B8)
        decompressed.writeUInt16LE(flags & ~0x08 & 0xff, bdOff + 0x0e); // clear swizzled bit
        decompressed.writeUInt32LE(newFileOff >>> 0, bdOff + 0x18);
        decompressed.writeUInt32LE(convertedPixels.length >>> 0, bdOff + 0x1c);
        rawAssetChunks.push(convertedPixels);
        newRawAssetsSize += convertedPixels.length;
        p8BitmapsConverted++;
        continue;
      }

      if (isSwizzled && !isCompressedDxt) {
        const bpp = Math.max(1, Math.floor((BITS_PER_PIXEL[format] || 8) / 8));
        const mipBuffers: Buffer[] = [];
        let srcCursor = asset.offset;
        const faces = type === 2 ? 6 : 1;
        for (let level = 0; level <= mipmapCount; level++) {
          const mw = Math.max(width >> level, 1);
          const mh = Math.max(height >> level, 1);
          const md = Math.max(depth >> level, 1);
          const sliceBytes = mw * mh * bpp;
          for (let f = 0; f < faces * md; f++) {
            if (srcCursor + sliceBytes <= decompressed.length) {
              mipBuffers.push(unswizzleMorton2D(decompressed, srcCursor, mw, mh, bpp));
            } else {
              mipBuffers.push(Buffer.alloc(sliceBytes));
            }
            srcCursor += sliceBytes;
          }
        }
        const linearPixels = Buffer.concat(mipBuffers);
        const newFileOff = newBspEnd + newRawAssetsSize;
        decompressed.writeUInt16LE(flags & ~0x08 & 0xff, bdOff + 0x0e);
        decompressed.writeUInt32LE(newFileOff >>> 0, bdOff + 0x18);
        decompressed.writeUInt32LE(linearPixels.length >>> 0, bdOff + 0x1c);
        rawAssetChunks.push(linearPixels);
        newRawAssetsSize += linearPixels.length;
        bitmapsDeswizzled++;
        continue;
      }

      // Clear any high flags (> 0xFF) on non-swizzled bitmaps and copy raw pixel data
      if ((flags & ~0xff) !== 0) {
        decompressed.writeUInt16LE(flags & 0xff, bdOff + 0x0e);
      }
    }

    const newFileOff = newBspEnd + newRawAssetsSize;
    const rawSlice = Buffer.from(
      decompressed.subarray(asset.offset, Math.min(decompressed.length, asset.offset + asset.size)),
    );
    decompressed.writeUInt32LE(newFileOff >>> 0, asset.offsetFieldAt);
    rawAssetChunks.push(rawSlice);
    newRawAssetsSize += rawSlice.length;
  }

  // Pad raw assets to 4-byte alignment
  const rawPad = (4 - (newRawAssetsSize & 3)) & 3;
  if (rawPad > 0) {
    rawAssetChunks.push(Buffer.alloc(rawPad));
    newRawAssetsSize += rawPad;
  }
  details.push(
    `Deswizzled ${bitmapsDeswizzled} Xbox tiled bitmap(s) and converted ${p8BitmapsConverted} P8 palettized bitmap(s) to A8R8G8B8.`,
  );

  // ---------------------------------------------------------------------------
  // Step 3: Convert Xbox `model` (`mode`) tags to PC `gbxmodel` (`mod2`)
  // ---------------------------------------------------------------------------
  // Locate the freed Xbox model vertex/index pool in tag data (`vertexPartsPointer .. minNonZeroTagStruct`)
  const xboxVertPartsPtr = decompressed.readUInt32LE(oldTdo + 0x14);
  const poolStartOffInTagData = xboxVertPartsPtr - XBOX_BASE_MEMORY_ADDRESS;
  let poolCursorInTagData = (poolStartOffInTagData + 3) & ~3;

  const modelVertexChunks: Buffer[] = [];
  const modelIndexChunks: Buffer[] = [];
  const deferredPartWrites: Array<{ dstAbsOff: number; buf: Buffer }> = [];
  let totalVertexBytes = 0;
  let totalIndexBytes = 0;
  let totalModelPartsCount = 0;
  let modelsConverted = 0;

  for (let i = 0; i < tagCount; i++) {
    const eOff = oldTagArrayOff + i * TAG_ENTRY_SIZE;
    const fourcc = decompressed.readUInt32LE(eOff + 0x00);
    if (fourcc !== 0x6d6f6465) continue; // 'mode'

    // Update tag class fourcc from 'mode' (0x6d6f6465) -> 'mod2' (0x6d6f6432)
    decompressed.writeUInt32LE(0x6d6f6432, eOff + 0x00);
    modelsConverted++;

    const mPtr = decompressed.readUInt32LE(eOff + 0x14);
    const mOff = oldTdo + (mPtr - XBOX_BASE_MEMORY_ADDRESS);
    const nodeCount = Math.max(1, decompressed.readUInt32LE(mOff + 0xb8));
    const geomCount = decompressed.readUInt32LE(mOff + 0xd0);
    const geomPtr = decompressed.readUInt32LE(mOff + 0xd4);
    const geomBaseOff = oldTdo + (geomPtr - XBOX_BASE_MEMORY_ADDRESS);

    // Clear `parts have local nodes` bit (0x02) on GBXModel flags
    const modelFlags = decompressed.readUInt32LE(mOff + 0x00);
    decompressed.writeUInt32LE(modelFlags & ~0x02, mOff + 0x00);

    for (let g = 0; g < geomCount; g++) {
      const gOff = geomBaseOff + g * 48;
      const partCount = decompressed.readUInt32LE(gOff + 0x24);
      const oldPartsPtr = decompressed.readUInt32LE(gOff + 0x28);
      if (partCount === 0 || oldPartsPtr < XBOX_BASE_MEMORY_ADDRESS) continue;

      const oldPartsOff = oldTdo + (oldPartsPtr - XBOX_BASE_MEMORY_ADDRESS);
      const newPartsByteLen = partCount * 132;
      const newPartsOffInTagData = poolCursorInTagData;
      poolCursorInTagData += (newPartsByteLen + 3) & ~3;

      const newPartsAbsOff = oldTdo + newPartsOffInTagData;
      const newPartsXboxVirtualPtr = (XBOX_BASE_MEMORY_ADDRESS + newPartsOffInTagData) >>> 0;
      const newPartsBuf = Buffer.alloc(newPartsByteLen, 0);

      for (let p = 0; p < partCount; p++) {
        const srcPartOff = oldPartsOff + p * 104;
        const dstPartOff = p * 132;

        // Copy common 104-byte prefix
        decompressed.copy(newPartsBuf, dstPartOff, srcPartOff, srcPartOff + 104);

        const triCount = decompressed.readUInt32LE(srcPartOff + 0x48);
        const triStripXboxPtr = decompressed.readUInt32LE(srcPartOff + 0x4c);
        const vertCount = decompressed.readUInt32LE(srcPartOff + 0x58);
        const vertIndXboxPtr = decompressed.readUInt32LE(srcPartOff + 0x64);

        const vertIndOff = oldTdo + (vertIndXboxPtr - XBOX_BASE_MEMORY_ADDRESS);
        const vertXboxPtr = decompressed.readUInt32LE(vertIndOff + 0x04);
        const srcVertOff = oldTdo + (vertXboxPtr - XBOX_BASE_MEMORY_ADDRESS);
        const srcStripOff = oldTdo + (triStripXboxPtr - XBOX_BASE_MEMORY_ADDRESS);

        // Decompress 32-byte Xbox model vertices into 68-byte PC uncompressed vertices
        const partVertBuf = Buffer.alloc(vertCount * 68);
        for (let v = 0; v < vertCount; v++) {
          const sv = srcVertOff + v * 32;
          const dv = v * 68;
          if (sv + 32 <= decompressed.length) {
            decompressed.copy(partVertBuf, dv + 0x00, sv + 0x00, sv + 0x0c); // position (12B)
            const [nx, ny, nz] = unpackCompressedUnitVector32(decompressed.readUInt32LE(sv + 0x0c));
            const [bx, by, bz] = unpackCompressedUnitVector32(decompressed.readUInt32LE(sv + 0x10));
            const [tx, ty, tz] = unpackCompressedUnitVector32(decompressed.readUInt32LE(sv + 0x14));
            const u = decompressed.readInt16LE(sv + 0x18) / 32767.0;
            const vCoord = decompressed.readInt16LE(sv + 0x1a) / 32767.0;
            const rawN0 = decompressed.readInt8(sv + 0x1c);
            const rawN1 = decompressed.readInt8(sv + 0x1d);
            const rawW0 = decompressed.readUInt16LE(sv + 0x1e);

            const n0 = Math.max(0, Math.min(nodeCount - 1, Math.trunc(rawN0 / 3)));
            const hasSecondNode = rawN1 >= 0;
            const n1 = hasSecondNode ? Math.max(0, Math.min(nodeCount - 1, Math.trunc(rawN1 / 3))) : 0;
            const w0 = hasSecondNode ? Math.max(0, Math.min(1, rawW0 / 32767.0)) : 1.0;
            const w1 = hasSecondNode ? Math.max(0, 1.0 - w0) : 0.0;

            partVertBuf.writeFloatLE(nx, dv + 0x0c);
            partVertBuf.writeFloatLE(ny, dv + 0x10);
            partVertBuf.writeFloatLE(nz, dv + 0x14);
            partVertBuf.writeFloatLE(bx, dv + 0x18);
            partVertBuf.writeFloatLE(by, dv + 0x1c);
            partVertBuf.writeFloatLE(bz, dv + 0x20);
            partVertBuf.writeFloatLE(tx, dv + 0x24);
            partVertBuf.writeFloatLE(ty, dv + 0x28);
            partVertBuf.writeFloatLE(tz, dv + 0x2c);
            partVertBuf.writeFloatLE(u, dv + 0x30);
            partVertBuf.writeFloatLE(vCoord, dv + 0x34);
            partVertBuf.writeInt16LE(n0, dv + 0x38);
            partVertBuf.writeInt16LE(n1, dv + 0x3a);
            partVertBuf.writeFloatLE(w0, dv + 0x3c);
            partVertBuf.writeFloatLE(w1, dv + 0x40);
          }
        }

        // Copy triangle strip indices (`triCount + 2` uint16s, padded with 0xFFFF to 4-byte alignment)
        const stripIndexCount = triCount + 2;
        const paddedIndexCount = (stripIndexCount + 1) & ~1;
        const partIdxBuf = Buffer.alloc(paddedIndexCount * 2, 0xff);
        for (let k = 0; k < stripIndexCount; k++) {
          const rawIdx = srcStripOff + k * 2 + 2 <= decompressed.length ? decompressed.readUInt16LE(srcStripOff + k * 2) : 0;
          const clampedIdx = vertCount > 0 && rawIdx >= vertCount ? vertCount - 1 : rawIdx;
          partIdxBuf.writeUInt16LE(clampedIdx, k * 2);
        }

        // Clamp centroid nodes into [0, nodeCount)
        const c0 = newPartsBuf.readInt16LE(dstPartOff + 0x08);
        const c1 = newPartsBuf.readInt16LE(dstPartOff + 0x0a);
        if (c0 < 0 || c0 >= nodeCount) newPartsBuf.writeInt16LE(0, dstPartOff + 0x08);
        if (c1 < 0 || c1 >= nodeCount) newPartsBuf.writeInt16LE(0, dstPartOff + 0x0a);

        // Write PC GBXModelGeometryPart offsets
        newPartsBuf.writeUInt16LE(1, dstPartOff + 0x44); // strip type = 1
        newPartsBuf.writeUInt32LE(triCount >>> 0, dstPartOff + 0x48);
        newPartsBuf.writeUInt32LE(totalIndexBytes >>> 0, dstPartOff + 0x4c);
        newPartsBuf.writeUInt32LE(totalIndexBytes >>> 0, dstPartOff + 0x50);
        newPartsBuf.writeUInt16LE(4, dstPartOff + 0x54); // vertex type = 4 (uncompressed)
        newPartsBuf.writeUInt32LE(vertCount >>> 0, dstPartOff + 0x58);
        newPartsBuf.writeUInt32LE(0, dstPartOff + 0x5c);
        newPartsBuf.writeUInt32LE(0, dstPartOff + 0x60);
        newPartsBuf.writeUInt32LE(totalVertexBytes >>> 0, dstPartOff + 0x64);

        modelVertexChunks.push(partVertBuf);
        modelIndexChunks.push(partIdxBuf);
        totalVertexBytes += partVertBuf.length;
        totalIndexBytes += partIdxBuf.length;
        totalModelPartsCount++;
      }

      deferredPartWrites.push({ dstAbsOff: newPartsAbsOff, buf: newPartsBuf });

      // Point geometry.parts reflexive to the new 132-byte-per-part array
      decompressed.writeUInt32LE(newPartsXboxVirtualPtr, gOff + 0x28);
    }
  }

  for (const w of deferredPartWrites) {
    w.buf.copy(decompressed, w.dstAbsOff);
  }

  // Update any TagDependency fourcc 'mode' (0x6d6f6465) -> 'mod2' (0x6d6f6432) in Tag Data
  for (let off = oldTagArrayOff; off + 16 <= oldTdo + oldTds; off += 4) {
    if (decompressed.readUInt32LE(off) === 0x6d6f6465) {
      const depTagId = decompressed.readUInt32LE(off + 0x0c);
      const depIdx = depTagId & 0xffff;
      if (depIdx < tagCount && decompressed.readUInt32LE(oldTagArrayOff + depIdx * 32) === 0x6d6f6432) {
        decompressed.writeUInt32LE(0x6d6f6432, off);
      }
    }
  }
  details.push(
    `Converted ${modelsConverted} Xbox 'mode' tag(s) to PC 'mod2' (${totalModelPartsCount} part(s), ${(totalVertexBytes + totalIndexBytes).toLocaleString('en-US')} bytes of uncompressed 68B vertex + index data).`,
  );

  // ---------------------------------------------------------------------------
  // Step 4: Expand Xbox Tag Data Header (0x24 -> 0x28) & Rebase Pointers (0x803A6000 -> 0x40440000)
  // ---------------------------------------------------------------------------
  // Inserting 4 bytes at `oldTdo + 0x20` shifts every offset >= 0x24 in Tag Data by +4 bytes,
  // so every Xbox pointer `ptr` in `[0x803A6024, 0x803A6000 + oldTds)` moves to `0x40440000 + (ptr - 0x803A6000) + 4`.
  const refreshedLayoutEntries: TagDataLayout['entries'] = xboxIdx.entries.map((e) => ({
    index: e.index,
    path: e.path,
    primaryClassName: e.primaryClassName === 'model' ? 'gbxmodel' : e.primaryClassName,
    isExternal: e.isExternal,
  }));
  const finalXboxTagLayout: TagDataLayout = {
    tagDataOffset: oldTdo,
    tagDataSize: oldTds,
    baseMemoryAddress: XBOX_BASE_MEMORY_ADDRESS,
    tagArrayFileOffset: oldTagArrayOff,
    entries: refreshedLayoutEntries,
  };

  const tolerated: ToleratedPointer[] = [];
  // Temporarily hide `Scenario.structureBsps` count from `collectTagDataPointers` because we already
  // converted the 20-byte-header Xbox BSPs into 24-byte-header PC BSPs in `convertedBspBuffers`.
  decompressed.writeUInt32LE(0, scnrOff + 0x5a4);
  const tagSites = collectTagDataPointers(decompressed, finalXboxTagLayout, {
    tolerate: { staleReferencePaths: true, rootsOutsideTagData: true },
    tolerated,
  });
  decompressed.writeUInt32LE(bspCount >>> 0, scnrOff + 0x5a4);

  const xboxToCeExpandedDelta = (CE_BASE_MEMORY_ADDRESS + 4 - XBOX_BASE_MEMORY_ADDRESS) | 0;
  let pointersRebased = 0;
  for (const s of tagSites) {
    decompressed.writeUInt32LE((s.value + xboxToCeExpandedDelta) >>> 0, s.at);
    pointersRebased++;
  }
  // Rebase `Scenario.structureBsps` reflexive pointer (`scnrOff + 0x5a8`) and each ScenarioBSP's tagRef path pointer (`+0x14`)
  if (bspCount > 0 && bspArrPtr >= XBOX_BASE_MEMORY_ADDRESS && bspArrPtr < XBOX_BASE_MEMORY_ADDRESS + oldTds) {
    decompressed.writeUInt32LE((bspArrPtr + xboxToCeExpandedDelta) >>> 0, scnrOff + 0x5a8);
    pointersRebased++;
    for (let b = 0; b < bspCount; b++) {
      const refPathPtrOff = bspArrOff + b * 32 + 0x14;
      const refPathPtr = decompressed.readUInt32LE(refPathPtrOff);
      if (refPathPtr >= XBOX_BASE_MEMORY_ADDRESS && refPathPtr < XBOX_BASE_MEMORY_ADDRESS + oldTds) {
        decompressed.writeUInt32LE((refPathPtr + xboxToCeExpandedDelta) >>> 0, refPathPtrOff);
        pointersRebased++;
      }
    }
  }

  // Also rebase any `bspReferencePath` pointers inside the already-converted BSP buffers
  for (const bBuf of convertedBspBuffers) {
    for (let off = 0x18; off + 16 <= bBuf.length; off += 4) {
      const maybePtr = bBuf.readUInt32LE(off + 0x04);
      if (maybePtr >= XBOX_BASE_MEMORY_ADDRESS && maybePtr < XBOX_BASE_MEMORY_ADDRESS + oldTds) {
        const fourcc = bBuf.readUInt32LE(off + 0x00);
        if (lookupTagClass(fourcc) !== null) {
          bBuf.writeUInt32LE((maybePtr + xboxToCeExpandedDelta) >>> 0, off + 0x04);
          pointersRebased++;
        }
      }
    }
  }

  const modelDataFileOffset = newBspEnd + newRawAssetsSize;
  const modelDataSize = totalVertexBytes + totalIndexBytes;
  const newTagDataOffset = modelDataFileOffset + modelDataSize;
  const newTagDataSize = oldTds + 4;

  // Build the expanded 0x28-byte PC Tag Data Header + Tag Data body
  const newTagDataBuf = Buffer.alloc(newTagDataSize);
  newTagDataBuf.writeUInt32LE(CE_TAG_ARRAY_ADDRESS, 0x00);
  newTagDataBuf.writeUInt32LE(xboxIdx.scenarioTagId >>> 0, 0x04);
  newTagDataBuf.writeUInt32LE(xboxIdx.tagChecksum >>> 0, 0x08);
  newTagDataBuf.writeUInt32LE(tagCount >>> 0, 0x0c);
  newTagDataBuf.writeUInt32LE(totalModelPartsCount >>> 0, 0x10);
  newTagDataBuf.writeUInt32LE(modelDataFileOffset >>> 0, 0x14);
  newTagDataBuf.writeUInt32LE(totalModelPartsCount >>> 0, 0x18);
  newTagDataBuf.writeUInt32LE(totalVertexBytes >>> 0, 0x1c);
  newTagDataBuf.writeUInt32LE(modelDataSize >>> 0, 0x20);
  newTagDataBuf.writeUInt32LE(CacheFileLiteral.TAGS, 0x24);
  decompressed.copy(newTagDataBuf, 0x28, oldTagArrayOff, oldTdo + oldTds);
  pointersRebased++;

  // Build the 2048-byte Custom Edition Header
  const totalFileLength = newTagDataOffset + newTagDataSize;
  const headerBuf = Buffer.alloc(CACHE_FILE_HEADER_SIZE);
  headerBuf.writeUInt32LE(CacheFileLiteral.HEAD, 0x000);
  headerBuf.writeUInt32LE(CacheFileEngine.CUSTOM_EDITION, 0x004);
  headerBuf.writeUInt32LE(totalFileLength >>> 0, 0x008);
  headerBuf.writeUInt32LE(0, 0x00c);
  headerBuf.writeUInt32LE(newTagDataOffset >>> 0, 0x010);
  headerBuf.writeUInt32LE(newTagDataSize >>> 0, 0x014);
  writeFixedString(headerBuf, 0x020, TAG_STRING_SIZE, xboxHdr.scenarioName);
  writeFixedString(headerBuf, 0x040, TAG_STRING_SIZE, CE_BUILD_STRING);
  headerBuf.writeUInt16LE(xboxHdr.mapType, 0x060);
  headerBuf.writeUInt32LE(xboxHdr.crc32 >>> 0, 0x064);
  headerBuf.writeUInt32LE(CacheFileLiteral.FOOT, 0x7fc);

  const out = Buffer.concat([
    headerBuf,
    ...convertedBspBuffers,
    ...rawAssetChunks,
    ...modelVertexChunks,
    ...modelIndexChunks,
    newTagDataBuf,
  ]);

  // Repair any truncated bitmap mipmaps on the assembled CE map
  try {
    const outHdr = parseCacheFileHeader(out);
    const outIdx = parseTagIndexForConversion(out, outHdr);
    const bmFixed = repairTruncatedBitmapMipmaps(out, outHdr, outIdx);
    if (bmFixed.bitmapsRepaired > 0) {
      details.push(`Repaired ${bmFixed.bitmapsRepaired} Xbox bitmap mipmap count(s) for OpenCE compatibility.`);
    }
  } catch {
    // Ignore if optional repair fails
  }

  // Step 5: Run `Fix CE Map` HaloScript AST pass & recompute CE CRC32
  const scriptFix = fixCeMapHaloScriptAndCrc(out);
  details.push(
    `Expanded Tag Index header (0x24 -> 0x28) and rebased ${pointersRebased.toLocaleString('en-US')} pointers from 0x803A6000 to 0x40440000.`,
    `HaloScript AST Pass: ${scriptFix.nodesNeutralized} neutralized, ${scriptFix.nodesConvertedToGameRevert} converted to (game_revert).`,
    `Final CE Header CRC32 (0x64): 0x${scriptFix.newCrc32.toString(16).toUpperCase().padStart(8, '0')}.`,
  );

  return {
    action: 'xbox',
    ok: true,
    message: `Converted Halo Xbox map '${xboxHdr.scenarioName}' (v5 -> v609), decompressed ${bspsDecompressed} BSP(s), converted ${modelsConverted} model(s), deswizzled ${bitmapsDeswizzled} bitmap(s) (${p8BitmapsConverted} P8 -> A8R8G8B8), rebased ${pointersRebased.toLocaleString('en-US')} pointers, and updated CRC32 to 0x${scriptFix.newCrc32.toString(16).toUpperCase().padStart(8, '0')}.`,
    sourceEngineVersion: CacheFileEngine.XBOX,
    targetEngineVersion: CacheFileEngine.CUSTOM_EDITION,
    mapName: scriptFix.mapName,
    previousCrc32: xboxHdr.crc32,
    newCrc32: scriptFix.newCrc32,
    sourceByteLength: source.length,
    outputByteLength: out.length,
    pointersRebased,
    externalRangesInternalized: 0,
    externalTagsLinkedToCe: 0,
    modelsConverted,
    bspsDecompressed,
    bitmapsDeswizzled,
    p8BitmapsConverted,
    scriptFix,
    details,
    buffer: out,
  };
}

/**
 * Dispatcher for all 5 `Fixes` toolbar actions.
 */
export function runMapFixAction(
  action: MapFixActionKind,
  sourceBuffer: Buffer | null,
  options: MapFixOptions = {},
): MapFixActionResult {
  if (action === 'mcc') {
    if (!sourceBuffer) {
      return runFixMccMapPlaceholder();
    }
    return fixMccMapToCe(sourceBuffer, options);
  }
  if (!sourceBuffer) {
    throw new Error('A .map file buffer is required for this fix action.');
  }
  switch (action) {
    case 'ce':
      return runFixCeMap(sourceBuffer);
    case 'demo':
      return fixHaloDemoMapToCe(sourceBuffer, options);
    case 'halomd':
      return fixHaloMdMapToCe(sourceBuffer, options);
    case 'xbox':
      return fixXboxMapToCe(sourceBuffer, options);
  }
}
