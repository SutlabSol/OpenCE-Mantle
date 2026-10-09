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

### M2 — Decompress/recompress: DONE (2026-07, this session)
- `core/src/map/compression.ts` — `compressCustomEditionMap(buffer, level=19)` and
  `decompressCustomEditionMap(buffer)`, using `@mongodb-js/zstd` (napi binding, no WASM heap
  limits - tried `zstd-codec` first but it OOM'd on real 13MB+ map data due to Emscripten's
  16MiB heap cap, so switched to a native binding).
- Confirmed the Chimera compression marker as FACT (not inference) by reading the literal
  enum from Chimera's own source: `CACHE_FILE_CUSTOM_EDITION_COMPRESSED = 0x861A0261` in
  `src/chimera/halo_data/map.hpp`, exactly `0x861A0000 | 0x261`.
- Implementation copies the full 2048-byte header through verbatim in both directions and
  only ever patches the 4-byte `engine` field - a deliberate, documented deviation from
  Chimera's own reference code (which zeroes `file_size` on decompress) in favor of a
  guaranteed byte-identical round trip.
- Tests: 10 new Vitest tests (6 synthetic + 4 against the REAL bloodgulch.map/ui.map):
  - `compress -> decompress` reproduces the real bloodgulch.map byte-for-byte (13,936,092
    bytes, compressed to ~4.1MB at level 19 in ~2.7s).
  - `decompress -> recompress -> decompress` byte-identical, satisfying the brief's stated
    round-trip requirement, for both bloodgulch.map and ui.map.
  - Rejects compressing an already-compressed map, rejects decompressing a non-compressed
    map, rejects corrupt input - all with friendly typed errors.
  - All 27 tests pass (`cd core && yarn test`), `yarn build` type-checks clean.
- No genuinely Chimera-compressed sample map was available to diff our output against
  directly; round-trip self-consistency against real game data is the validation we have.
  Flagged to user as an open item if they can obtain one later.

## Next action for user
M1 + M2 complete and validated against real maps. Proceeding to M3 (GUI shell: Electron +
React, Open Map, info panel, Decompress button, tag browser) - the first visible, clickable
version of the app. Will pause again for review once M3 is testable end-to-end.

## New context from user (2026-07): target runtime is OpenCE
User: "this tool is for the xbox port of Halo OpenCE only" +
https://github.com/OpenCommunityEdition/OpenCE. Investigated the repo directly (its own
`docs/custom_edition_caches.md` and `tools/map_validate.c`/`tools/test_cache_file_formats.py`
are extremely detailed, rigorous, CC0-licensed references independently verified against 24
real sample caches). Key findings, all GOOD NEWS for the existing implementation:
- OpenCE's native builds load standard Halo Custom Edition caches, **version 609** - exactly
  what M1/M2 already target. No format pivot needed.
- Confirms our struct layout byte-for-byte: tag data header 0x28 bytes, tag instance 0x20
  bytes, resource-map flag at offset 0x18.
- OpenCE's own loader does NOT support compressed Custom Edition maps (checks explicitly for
  "no compression"). Matches the user's instruction to de-prioritize Chimera compression -
  core's compress/decompress (M2) remains implemented (harmless, already tested), just not
  on the critical path.
- Only bitmap, sound, font, unicode_string_list, and hud_message_text tags may be
  resource-map-indexed under OpenCE's stricter validation - relevant for M4 extraction logic.
- Gave us the exact CRC32 algorithm for M6: "CRC-32 of the structure BSPs (packed from
  0x800), the model data, and the tag data, not inverted."
- OpenCE refuses maps with OpenSauce (`yelo`) flags set - relevant for M6 export validation.
- Scenario structure BSP (`sbsp`) tags live in their own file region, loaded at a different
  runtime address than the normal tag data base - NOT resolvable via the standard
  tag_data_offset-relative pointer formula. Found this the hard way (see tag-footprints below).

## Core addition: tag footprint estimation (2026-07)
Added `core/src/map/tag-footprints.ts` (`estimateTagFootprints`), citing OpenCE's own
`tools/custom_edition_tag_footprints.py` technique: a tag's estimated size is the distance
from its resolved file offset to the next tag's. Explicitly excludes `scenario_structure_bsp`
tags (null size - they live in a separate file region, confirmed by OpenCE's docs; including
them in the naive calculation produced a 1GB bogus footprint sum in testing, caught by a
sanity-check unit test against the real bloodgulch.map). 30 core tests passing.

### M3 — GUI shell: DONE (2026-07, this session)
Electron + React (Vite) app in `/app/desktop` (named "desktop", not the brief's literal
"/app", to avoid colliding with this sandbox's own root path).
- `electron/main.ts` - BrowserWindow, native menu (File: Open Map/Save As stub/Recent Maps/
  Exit; Tools: Decompress/Recompress Map, Extract/Inject Tags stubs; Help: About), IPC
  handlers, recent-maps persistence (`recent-maps.ts`, JSON in userData).
- `electron/preload.ts` - typed `window.opence` API via contextBridge (contextIsolation on,
  nodeIntegration off). Renderer never touches `fs` - drag-and-drop resolves a path via
  `webUtils.getPathForFile` in preload, then asks main to load it.
- `electron/map-worker.ts` - all parsing/zstd work runs in a `worker_threads` Worker (one per
  task), so the UI thread never blocks; reports staged progress (reading/parsing/writing).
- React renderer (`src/`): `WelcomeDropZone`, `Toolbar` (progress bar inline), `MapInfoPanel`
  (scenario/build/map type/version/size/tag count/CRC32), `CompressedBanner` + Decompress
  button, `UnsupportedBanner`, `TagBrowser` (search across path/class/tag ID, group-by-class
  or group-by-folder toggle, multi-select checkboxes, size column via tag footprints),
  `LogPanel`. Dark, technical theme (Barlow Condensed + JetBrains Mono, amber/olive accents) -
  deliberately plain/functional per the brief ("plain native-feeling layout beats fancy
  styling"), not a generic AI-slop theme.
- Extract/Inject/Save-As are present in the UI (menu + toolbar) but explicitly log "coming in
  a later milestone" rather than silently doing nothing (M4/M5/M6 not built yet).
- Verified in this sandbox (headless Linux, no display):
  - `tsc --noEmit` clean on the renderer, `tsc -p electron/tsconfig.json` clean, `vite build`
    succeeds.
  - Renderer UI visually verified via screenshot against the Vite dev server (with a dev-only
    mock of `window.opence` mirroring real bloodgulch.map data) - welcome screen, loaded map
    info panel, tag browser grouping/search all render and behave correctly.
  - The actual Electron shell (main + preload + renderer + worker, NOT just the renderer) was
    smoke-tested under Xvfb: launches without JS errors, all processes (main/renderer/GPU)
    stay up.
  - Full native-window visual QA and the `electron-builder` Windows packaging step still need
    to happen on the user's own machine (documented in `/app/README.md`), since this sandbox
    has no Windows and no real display.

## Next action for user
M1+M2+M3 done. Review the GUI shell (screenshots shared in chat). Confirm before starting M4
(dependency walker + extract tags with dependencies).

## M3 testing (2026-07)
testing_agent ran 12 Playwright assertions against the renderer (Vite dev server + dev-mock):
welcome screen, map load, info panel field values, toolbar buttons, tag browser grouping
(class + folder), search/auto-expand, multi-select + Extract button state, log panel, zero
console errors. All 12 passed, zero bugs found. Applied 2 of 4 minor code-review suggestions
(explicit filePath instead of empty string for decompress/recompress; slugified group
data-testids to survive special characters in folder names). Did not change the '-stub'
action-string convention (low risk, hobby-scope) or the ternary-as-expression style (already
fixed to if/else alongside the testid fix). Electron shell itself (main/preload/menu/worker)
was separately smoke-tested under Xvfb by the main agent (launches cleanly, no JS errors) -
native dialogs/menus still need manual verification on the user's own Windows machine.
