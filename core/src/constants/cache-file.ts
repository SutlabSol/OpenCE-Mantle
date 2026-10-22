/**
 * Halo CE (PC) cache file constants.
 *
 * PRIMARY SOURCE: Invader (SnowyMouse/invader), GPL-3.0-only, used as a FORMAT REFERENCE
 * ONLY per project licensing rules. Struct/enum values below are transcribed (not copied
 * verbatim as code) from:
 *   include/invader/hek/map.hpp
 *   https://github.com/SnowyMouse/invader/blob/master/include/invader/hek/map.hpp
 *
 * Cross-referenced against the community wiki:
 *   https://c20.reclaimers.net/h1/maps
 *   https://c20.reclaimers.net/h1/tags
 */

/** `CacheFileEngine` enum (invader/hek/map.hpp). Only CUSTOM_EDITION (609) is in scope. */
export enum CacheFileEngine {
  XBOX = 5,
  DEMO = 6,
  RETAIL = 7,
  CUSTOM_EDITION = 609,
  MCC_CEA = 13,
  NATIVE = 0x1a86,
}

/** `CacheFileLiteral` enum (invader/hek/map.hpp). 32-bit magic values. */
export enum CacheFileLiteral {
  HEAD = 0x68656164, // "head"
  FOOT = 0x666f6f74, // "foot"
  TAGS = 0x74616773, // "tags"
  HEAD_DEMO = 0x45686564,
  FOOT_DEMO = 0x47666f74,
}

/**
 * `CacheFileType` / `ScenarioType`. Numeric order (0/1/2) is standard, well-established
 * Halo CE community knowledge (matches the HEK Guerilla/Sapien scenario type dropdown and
 * every known community tool); invader/hek/map.hpp only aliases `CacheFileType = ScenarioType`
 * without restating the numeric values inline, so this ordering is stated here as an
 * explicit assumption rather than a literal source quote.
 */
export enum ScenarioType {
  SINGLEPLAYER = 0,
  MULTIPLAYER = 1,
  USER_INTERFACE = 2,
}

/**
 * ASSUMPTION (stated explicitly per project instructions): a Chimera-compressed Custom
 * Edition map keeps the normal 2048-byte header layout and valid head/foot magic, but
 * ORs the `engine` field with this mask to signal "body is zstd-compressed".
 * Source: Chimera (SnowyMouse/chimera), GPL-3.0-only, reference only.
 *   src/chimera/map_loading/compression.cpp
 *   https://mintlify.wiki/SnowyMouse/chimera/advanced/compressed-maps
 * Full decompression support is implemented in Milestone 2; for Milestone 1 this constant
 * is only used to recognize "this is a compressed map" so the header parser can fail with
 * a clear, specific error instead of a generic "corrupt map" error.
 */
export const CHIMERA_COMPRESSED_ENGINE_MASK = 0x861a0000;

/** Size in bytes of the fixed-length `TagString` field type (scenario name, build string). */
export const TAG_STRING_SIZE = 32;

/** Total size of `CacheFileHeader` (invader/hek/map.hpp: `static_assert(sizeof(CacheFileHeader) == 0x800)`). */
export const CACHE_FILE_HEADER_SIZE = 0x800;

/** Size of `CacheFileTagDataHeaderPC` (invader/hek/map.hpp: `static_assert(... == 0x28)`). CE uses the PC layout. */
export const TAG_DATA_HEADER_PC_SIZE = 0x28;

/** Size of one `CacheFileTagDataTag` entry (invader/hek/map.hpp: `static_assert(... == 0x20)`). */
export const TAG_ENTRY_SIZE = 0x20;

/**
 * Virtual address the engine loads Custom Edition (and PC retail) tag data at. Fixed, never
 * inferred: Invader's `gbx-custom` engine info and `memory/demo-converter.md` (true demo uses
 * 0x4BF10000). Every CE sample map stores the tag array pointer as this + 0x28.
 */
export const CE_BASE_MEMORY_ADDRESS = 0x40440000;

/** The only tag array pointer a valid CE map has: the array follows the tag data header. */
export const CE_TAG_ARRAY_ADDRESS = CE_BASE_MEMORY_ADDRESS + TAG_DATA_HEADER_PC_SIZE;

/**
 * Virtual address MCC (Master Chief Collection - Halo: Combat Evolved) loads tag data at.
 * Base address is 0x50000000; the tag array pointer is 0x50000028.
 */
export const MCC_BASE_MEMORY_ADDRESS = 0x50000000;

/** The tag array pointer in an MCC map (follows the 0x28 byte tag data header). */
export const MCC_TAG_ARRAY_ADDRESS = MCC_BASE_MEMORY_ADDRESS + TAG_DATA_HEADER_PC_SIZE;

/** Size of `CacheFileTagDataHeaderXbox` (`0x24` = 36 bytes). */
export const TAG_DATA_HEADER_XBOX_SIZE = 0x24;

/**
 * Virtual address Xbox Halo: Combat Evolved (`engine = 5`) loads tag data at (`0x803A6000`).
 * The tag array immediately follows the 0x24-byte Xbox tag data header at `0x803A6024`.
 */
export const XBOX_BASE_MEMORY_ADDRESS = 0x803a6000;
export const XBOX_TAG_ARRAY_ADDRESS = XBOX_BASE_MEMORY_ADDRESS + TAG_DATA_HEADER_XBOX_SIZE;

/**
 * Tag space: tag data and the loaded BSP share this much memory from the base (the BSP is loaded
 * at base + tag space - bsp size), so tag data size + the largest BSP must fit. 23 MiB on PC/CE
 * and demo (`memory/demo-converter.md`, Invader `gbx-custom`).
 */
export const CE_TAG_SPACE_SIZE = 23 * 1024 * 1024;
