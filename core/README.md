# OpenCE Mantle — `core` library

Pure TypeScript library for reading (and, in later milestones, rebuilding) Halo: Custom
Edition (PC) `.map` files. **No Electron, React, or DOM dependencies** — this package can be
unit-tested and reused independently of the desktop app.

## Scope (Milestone 1 + 2)

- Parse the 2048-byte cache file header (`CacheFileHeader`).
- Decompress / recompress Chimera-style compressed Custom Edition maps (zstd).
- Parse the tag index (tag data header + tag array + tag path strings), resolving all
  in-file pointers to file offsets.
- Friendly, typed errors for corrupt files and out-of-scope map versions (Xbox, retail,
  demo, MCC CEA) — per project SCOPE, only Custom Edition (header version `609`) is parsed.

## Sources

All struct layouts are transcribed (not copied) from, and cited inline in code comments:

1. **Invader** (`SnowyMouse/invader`, GPL-3.0-only) — `include/invader/hek/map.hpp` for
   `CacheFileHeader`, `CacheFileTagDataHeaderPC`, `CacheFileTagDataTag`.
   https://github.com/SnowyMouse/invader/blob/master/include/invader/hek/map.hpp
2. **Chimera** (`SnowyMouse/chimera`, GPL-3.0-only) — `src/chimera/halo_data/map.hpp`
   (confirms `CACHE_FILE_CUSTOM_EDITION_COMPRESSED = 0x861A0261 = 0x861A0000 | 0x261`) and
   `src/chimera/map_loading/compression.cpp` (zstd compression scheme: header stays
   2048 bytes uncompressed, body is a single zstd frame, level 19).
   https://github.com/SnowyMouse/chimera/blob/master/src/chimera/halo_data/map.hpp
   https://github.com/SnowyMouse/chimera/blob/master/src/chimera/map_loading/compression.cpp
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
- **Chimera compression scheme (confirmed, not just inferred)**: fetched the literal
  `CacheFileEngine` enum from Chimera's own source
  (`src/chimera/halo_data/map.hpp`): `CACHE_FILE_CUSTOM_EDITION_COMPRESSED = 0x861A0261`,
  which is exactly `0x861A0000 | 0x261` — confirming the OR-mask theory as fact, not a guess.
  Body compression is zstd (level 19 to match `chimera-compress`); header stays 2048 bytes.
- **Deviation from Chimera's reference implementation (stated explicitly)**: Chimera's own
  `decompress_header()` (in `compression.cpp`) zeroes the header's `file_size` field in its
  decompressed output, because its low-memory streaming code path doesn't know the final
  size at that point. This library instead copies the entire 2048-byte header through
  verbatim in both directions and only ever patches the 4-byte `engine` field, which (a)
  keeps `decompressedFileSize`/`crc32`/etc. accurate and (b) guarantees a byte-identical
  round trip. This cannot break Chimera's own loader, which does not depend on that field
  being zero to load a compressed map.
- Three tag class FourCC codes (`fog`, `sky`, `hmt`) are rendered as 3 characters on the wiki
  page because the 4th character is a trailing ASCII space (`"fog "`, `"sky "`, `"hmt "`) —
  the standard Halo convention.

## Running tests

```bash
cd core
yarn install
yarn test     # Vitest - 27 tests: header, tag index, FourCC, compression, real-map round trip
yarn build    # tsc type-check + compile to dist/
yarn inspect-map /path/to/some.map   # developer-only CLI, prints parsed header + tag list
```

### Sample maps (for the real-map test suites)

Several test files (`definitions.test.ts`, `dependency-walker.test.ts`, `tag-extractor.test.ts`,
`compression.real-map.test.ts`, `tag-footprints.test.ts`) run extra assertions against real
`.map` files if you have them, and **skip themselves automatically** (with a clear message
naming which file is missing and where it looked) if you don't.

By default they look in `<repo root>/sample_maps` (i.e. next to `core/` and `desktop/`) - on
Windows that's typically:

```
C:\path\to\opence\sample_maps\bloodgulch.map
C:\path\to\opence\sample_maps\ui.map
C:\path\to\opence\sample_maps\bitmaps.map     (optional - resource map checks)
C:\path\to\opence\sample_maps\sounds.map      (optional - resource map checks)
```

To use a different location (any OS), set `SAMPLE_MAPS_DIR` before running tests:

```bash
# bash/macOS/Linux
SAMPLE_MAPS_DIR=/path/to/maps yarn test

# Windows PowerShell
$env:SAMPLE_MAPS_DIR = "C:\HaloCE\maps"; yarn test
```

The resolution logic lives in one place, `tests/helpers/sample-maps.ts` - no test or script in
this repo hardcodes an absolute path to the sample maps directory.

Maps from other games go in sub-folders, because file names repeat (`HaloMD\heh_2.map`,
`MacDemo\bloodgulch.map`, `PC\bitmaps.map`, ...). The folder names live only in `SAMPLE_FOLDERS`
in that helper; tests name a file with `sampleIn('haloMD', 'heh_2.map')`. The converter tests
need `HaloMD\heh_2.map`, `HaloMD\theisland_3.map` and `MacDemo\bloodgulch.map`.

### Which sample files each suite needs

Every test is gated on exactly the file(s) **it** needs (never a blanket per-file skip) - if a
test needs a file you don't have, only that test skips, with the missing filename(s) and the
searched path embedded right in the test's title so it shows up in the Vitest summary, not a
bare "skipped" with no explanation.

| Test file                       | bloodgulch.map | ui.map | bitmaps.map | sounds.map | loc.map |
|----------------------------------|:---:|:---:|:---:|:---:|:---:|
| `definitions.test.ts`           | ✔ (1 test) | ✔ (1 test) | ✔ (1 test, also needs bloodgulch.map) | – | – |
| `dependency-walker.test.ts`     | ✔ (whole file) | – | – | – | – |
| `tag-extractor.test.ts`         | ✔ (whole file) | – | – | – | – |
| `tag-footprints.test.ts`        | ✔ (1 of 2 tests) | – | – | – | – |
| `compression.real-map.test.ts`  | ✔ (per-file tests, runs for whichever of the two exist) | ✔ (same) | – | – | – |
| `container-v2.test.ts`          | ✔ (1 of 4 tests) | ✔ (1 of 4 tests, same test as bitmaps.map) | ✔ (same test) | – | – |
| `tag-injector.test.ts`          | ✔ (whole file, 9 tests) | ✔ (whole file, same 9) | ✔ (1 of the 9, additionally) | – | – |
| `relocation-synthetic.test.ts`  | – | – | – | – | – |
| everything else (`header`, `open-map`, `tag-index`, `compression`, `fourcc`) | – | – | – | – | – |

`sounds.map`/`loc.map` aren't read by any current test (sound/loc resource-map parsing is
exercised with synthetic buffers only, not real sample files, so far) — if that changes, update
this table.

## Layout

```
core/
  src/
    constants/cache-file.ts     CacheFileEngine, CacheFileLiteral, ScenarioType, sizes
    constants/tag-classes.ts    Tag class FourCC table + lookup
    binary/strings.ts           Fixed-length / null-terminated ASCII string helpers
    map/header.ts               parseCacheFileHeader / serializeCacheFileHeader
    map/compression.ts          compressCustomEditionMap / decompressCustomEditionMap (zstd)
    map/tag-index.ts            parseTagIndex, pointer resolution
    map/open-map.ts             inspectCustomEditionMap() - top-level entry point
    map/errors.ts                CorruptMapError, UnsupportedMapVersionError, CompressedMapError, NotCompressedMapError
  tests/                        Vitest unit tests + synthetic map fixture builder + real-map round-trip tests
```

No real COMPRESSED sample `.map` was available (the maps supplied are all uncompressed), so
the decompress/recompress round trip is validated as: `compress(original) -> decompress` must
equal `original` byte-for-byte, and `decompress -> recompress -> decompress` must be
byte-identical (per the brief's stated requirement) — both verified against the real
`bloodgulch.map` and `ui.map`. If you can obtain a genuinely Chimera-compressed map later,
share it and we'll add a direct compatibility check.
