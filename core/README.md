# OpenCE Modding Tool — `core` library

Pure TypeScript library for reading (and, in later milestones, rebuilding) Halo: Custom
Edition (PC) `.map` files. **No Electron, React, or DOM dependencies** — this package can be
unit-tested and reused independently of the desktop app.

## Scope (Milestone 1)

- Parse the 2048-byte cache file header (`CacheFileHeader`).
- Detect (but not yet decompress) Chimera-compressed Custom Edition maps.
- Parse the tag index (tag data header + tag array + tag path strings), resolving all
  in-file pointers to file offsets.
- Friendly, typed errors for corrupt files and out-of-scope map versions (Xbox, retail,
  demo, MCC CEA) — per project SCOPE, only Custom Edition (header version `609`) is parsed.

## Sources

All struct layouts are transcribed (not copied) from, and cited inline in code comments:

1. **Invader** (`SnowyMouse/invader`, GPL-3.0-only) — `include/invader/hek/map.hpp` for
   `CacheFileHeader`, `CacheFileTagDataHeaderPC`, `CacheFileTagDataTag`.
   https://github.com/SnowyMouse/invader/blob/master/include/invader/hek/map.hpp
2. **Chimera** (`SnowyMouse/chimera`, GPL-3.0-only) — `src/chimera/map_loading/compression.cpp`
   for the compressed-map detection marker (full decompression lands in Milestone 2).
3. Halo CE community wiki — https://c20.reclaimers.net/h1/maps and
   https://c20.reclaimers.net/h1/tags (tag class FourCC list).

These are used strictly as **format references**. All code in this package is original.

## Explicitly stated assumptions

Per project instructions, any ambiguous format detail is stated here instead of silently
guessed:

- **`ScenarioType` numeric values** (0=singleplayer, 1=multiplayer, 2=user interface) — not
  spelled out numerically in the Invader header, but this ordering matches every known HEK
  tool and community reference.
- **Tag array placement**: the tag array is assumed to begin immediately after the
  `CacheFileTagDataHeaderPC` struct (`tagDataOffset + 0x28`). The virtual base memory address
  used to resolve all tag/path pointers is then *inferred* from this (`tagArrayAddress -
  tagArrayFileOffset`) rather than hardcoded, per the technique Invader itself documents
  (`GameEngineInfo::base_memory_address_is_inferred`).
- **Chimera compression marker**: a compressed Custom Edition map keeps a valid, uncompressed
  2048-byte header, with `engine` OR'd with `0x861A0000`. This is used only for *detection* in
  Milestone 1; actual zstd decompression is Milestone 2 and will be verified byte-for-byte
  against a real sample map once provided.
- Three tag class FourCC codes (`fog`, `sky`, `hmt`) are rendered as 3 characters on the wiki
  page because the 4th character is a trailing ASCII space (`"fog "`, `"sky "`, `"hmt "`) —
  the standard Halo convention.

## Running tests

```bash
cd core
yarn install
yarn test     # Vitest - 17 tests covering header parsing, tag index parsing, FourCC codecs
yarn build    # tsc type-check + compile to dist/
```

## Layout

```
core/
  src/
    constants/cache-file.ts     CacheFileEngine, CacheFileLiteral, ScenarioType, sizes
    constants/tag-classes.ts    Tag class FourCC table + lookup
    binary/strings.ts           Fixed-length / null-terminated ASCII string helpers
    map/header.ts               parseCacheFileHeader / serializeCacheFileHeader
    map/tag-index.ts            parseTagIndex, pointer resolution
    map/open-map.ts             inspectCustomEditionMap() - top-level entry point
    map/errors.ts               CorruptMapError, UnsupportedMapVersionError, CompressedMapError
  tests/                        Vitest unit tests + synthetic map fixture builder
```

No real sample `.map` file was available yet for a byte-for-byte comparison against Invader's
own output, so all Milestone 1 tests run against a synthetic fixture (`tests/fixtures/build-fake-map.ts`)
that constructs a fully valid header + tag index with correct pointer arithmetic. Once a real
map is supplied, Milestone 2 will add the developer-only compare script described in the
project brief's TESTING section.
