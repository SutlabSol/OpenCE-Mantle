# OpenCE Modding Tool — PRD / Progress Log

## Original problem statement
Desktop GUI application (NOT CLI) for modding Halo: Custom Edition (PC) maps, similar in
spirit to the Halo Hacking Kit. Phase 1: open a map, decompress/recompress, browse tags,
extract tags with dependencies, inject/swap tags into another map, export a valid .map.
Phase 2 (future, do not build yet): Sapien-style 3D scenario editor.

Stack: Electron + TypeScript + React, Windows first. Monorepo: `/core` (pure TS map/tag
library, no Electron/React/DOM deps, unit tested) + `/app` (Electron main/preload/renderer).
Renderer never touches files directly — all file I/O via typed IPC to main/worker threads.
Scope: Halo CE PC maps only (header version 609). Out of scope: Xbox, retail PC (v7),
Anniversary/MCC — show a clear "unsupported map version" dialog instead.

Personal, free, non-commercial hobby tool shared with a few friends. GPL projects (Invader,
Reclaimer, Refinery, Mozzarilla, supyr_struct) are FORMAT REFERENCES ONLY — no copied code,
no bundled Bungie/Microsoft assets.

## User choices gathered (ask_human, this session)
1. Environment: sandbox is headless Linux, no Windows/display. Build everything buildable
   here (core fully tested, Electron app source + renderer UI previewable in browser);
   final Windows .exe packaging runs via electron-builder on the user's own machine (exact
   commands to be provided in README when we reach packaging).
2. Sample map: user will upload a real `.map` (e.g. bloodgulch.map) for byte-exact
   decompress/recompress verification against Invader reference output. Not yet received.
3. Milestone pacing: **pause for user review/approval after EVERY milestone** (M1 through M6).
4. The 5 uploaded reference repos (Invader, Reclaimer, Mozzarilla, supyr_struct, Refinery)
   are format/behavior references only, per GPL licensing — confirmed, not bundled.

Note: the 5 uploaded repo artifacts came through as 0-byte files (upload issue — whole-folder
artifacts don't survive this upload path). Worked around this by reading the actual public
GitHub source directly (github.com/SnowyMouse/invader, github.com/SnowyMouse/chimera) and the
community wiki (c20.reclaimers.net), which are fully accessible and are the literal primary
sources for the struct layouts used below.

## Architecture decision
Repository root (this sandbox's `/app`) IS the monorepo root. To avoid confusion with the
sandbox path, the Electron app folder is named `app/desktop` instead of a bare `/app` folder
as literally written in the brief (that name would collide with the sandbox root). This will
be called out again when `desktop/` is created in Milestone 3.

## Milestone status

### M1 — Header + tag index parsing: DONE (2026-07, this session)
- `core/src/map/header.ts` — `parseCacheFileHeader` / `serializeCacheFileHeader`, validates
  head/foot magic, rejects out-of-scope engine versions with friendly messages
  (`UnsupportedMapVersionError`), detects Chimera-compressed CE maps (`isChimeraCompressedCustomEdition`).
- `core/src/map/tag-index.ts` — `parseTagIndex`: tag data header (`CacheFileTagDataHeaderPC`)
  + tag array (`CacheFileTagDataTag[]`) + path string resolution via inferred virtual base
  memory address.
- `core/src/constants/tag-classes.ts` — full Halo CE tag class/FourCC table from the
  community wiki, with lookup.
- `core/src/map/open-map.ts` — `inspectCustomEditionMap()`: top-level API returning
  `{status: 'ok'|'compressed'|'unsupported'}`, ready to back the GUI's info panel /
  compressed-banner / unsupported-dialog flows in M3.
- Tests: 17 Vitest tests, all passing (`cd core && yarn test`). Covers header parse/serialize
  round-trip, corrupt file detection, unsupported version detection (Xbox/retail), compressed
  detection, multi-tag index parsing (incl. external/resource-indexed tags), FourCC round-trip
  for the entire tag class table, and the full `inspectCustomEditionMap` flow.
- No real sample map yet — all tests run against a synthetic fixture
  (`core/tests/fixtures/build-fake-map.ts`) that builds a byte-accurate fake CE map buffer.
  Byte-for-byte comparison against a real Invader-decompressed reference map is deferred to
  M2 once a sample map is supplied.
- Assumptions stated explicitly in `core/README.md` and in code comments (ScenarioType
  numeric order, tag array placement / inferred base address, Chimera compression marker,
  3-char FourCC padding).

### M2 — Decompress/recompress: NOT STARTED (next, pending user review of M1)
Plan: implement Chimera-style zstd decompression/recompression (header stays 2048 bytes,
body is zstd level 19, engine field OR'd with 0x861A0000 while compressed). Needs a `zstd`
Node binding (likely `zstd-codec` or similar — to be confirmed) and a real sample map for the
byte-for-byte round-trip + Invader-reference compare script described in the brief's TESTING
section.

### M3-M6: NOT STARTED
GUI shell (Open Map/info panel/Decompress button/tag browser), dependency walker + extract,
inject (add/swap), export + CRC. Electron main/preload/renderer, worker threads for heavy
parsing, typed IPC.

## M1 validated against real sample maps (2026-07)
User supplied bloodgulch.map, ui.map, bitmaps.map, loc.map, sounds.map.
- `bloodgulch.map` and `ui.map` are real, UNCOMPRESSED Custom Edition maps (engine=0x261=609,
  on-disk size == header `decompressedFileSize`). Ran `core/scripts/inspect-map.ts` against
  both: header fields, tag count (2455 / 1412), scenario tag lookup, FourCC decoding, and
  path-pointer resolution ALL correct against real data (e.g. tag #0 of bloodgulch.map is
  `scenario levels\test\bloodgulch\bloodgulch`, matching the scenario name in the header;
  885 tags correctly flagged `external=true` i.e. living in bitmaps.map/sounds.map).
- `bitmaps.map`, `loc.map`, `sounds.map` are RESOURCE maps with a completely different,
  non-"head"/"foot" header format (expected - out of scope for M1/M2, relevant later for the
  M4 "point the app at resource maps" extraction feature).
- None of the 5 supplied maps are compressed, so M2's decompress/recompress round-trip will
  be validated as: compress(original) -> decompress -> must equal original byte-for-byte
  (self-consistency), since no real Chimera-compressed sample or Windows Chimera tool is
  available in this sandbox to cross-check against. Flagged to user.

## Next action for user
M1 fully validated against real maps. Proceeding to M2 (decompress/recompress) using the
Chimera zstd scheme documented in Milestone 1. Will pause again for review once M2 tests pass.
