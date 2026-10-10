# OpenCE Modding Tool — PRD

## Problem statement
Windows desktop app (Electron + TypeScript + React) for modding Halo: Custom Edition (PC) maps
(header version 609). Architecture: `/core` (pure TS map/tag library, no Electron/DOM deps,
Vitest-tested) + `/desktop` (Electron main/preload/renderer + worker threads). Reference repos
(Invader, Reclaimer) are GPL and used strictly for format/struct reference — all code here is
original.

Milestones: M1 header/index parse, M2 decompress/recompress, M3 GUI shell, M4 dependency walker +
extraction, M5 tag injection/swap, M6 export + CRC32 recalc. Future: M7 field-level tag editor,
Phase 2 3D scenario editor.

## Status table (2026-08, updated this session — labels: verified by tests / same-reader /
needs re-verification / unverified / blocked)
| Feature | Status | How |
|---|---|---|
| M4 extraction (general) | **needs re-verification** | Was "done" before the font/string_list/meter/etc data-dropping bug was found; the bug is now fixed and same-reader-verified (101/101 core Vitest), but no fix this session has been run by the user on Windows/OpenCE yet. See "Windows check" below to move this to verified without a full OpenCE session. |
| M5 ADD / SWAP (tags with NO gbxmodel in their closure) | **needs re-verification** | Same reason as extraction - the data-dropping bug could have affected any injected tag with a font/string_list/meter/hud_message_text/input_device_defaults/model_animations/scenario field. Fixed + same-reader-verified this session; not yet confirmed in OpenCE. |
| M5 ADD / SWAP (any tag whose closure includes a `gbxmodel`) | **blocked** | `uncapturedData` warning unconditionally blocks these (model geometry not captured at all - see Issue 2/gbxmodel plan below) until that's built and approved. This is intentional, not a regression. |
| Embedded (external=0) bitmap/sound relocation | **same-reader-verified, NOT approved for the real app** | `embedded-relocation.test.ts`, real coldsnap.map bytes. `allowEmbeddedRelocation` stays off in `map-worker.ts`. |
| `gbxmodel` model geometry capture/relocation | **Stage 1 (capture) same-reader-verified; Stage 2 (injection) design-verified, NOT built/wired** | `gbxmodel-geometry.test.ts` (100% captured, 0 blocked, bloodgulch+coldsnap), `gbxmodel-combined-insertion-design.test.ts` (field table + 665-part no-patch proof) — see "gbxmodel geometry — Stage 1 capture" below |
| Sound relocation | **same-reader-verified, bounds-only** | No deterministic size formula for compressed audio exists (stated, not guessed) - a corrupt/truncated embedded sound could still pass the bounds check. |
| `crc32`/`tagFileChecksums` after injection | **unverified, known-stale** | M6 work, tracked P0, not started. |

### Windows check to move "M4 extraction" to verified (no OpenCE needed)
1. Build, open `ui.map`, extract `ui\ticker` (Tools > Extract Tags, search "ticker", pick the
   **font** result, not the ui_widget_definition ones) alone (no dependencies needed).
2. Expect: extraction succeeds with 0 warnings for that tag, "Open containing folder" shows a
   `.ocetags` file. Expect the file to be noticeably larger than a few KB (it embeds the font's
   ~31 KB of glyph pixel data) - if you want an exact number, the pixels field alone is 31,066
   bytes plus the JSON/base64 + struct overhead.
3. Extract any weapon (e.g. `weapons\assault rifle\assault rifle`) with dependencies - expect it
   to succeed with only "External data"/"BSP" style warnings, never a crash.
4. Report back pass/fail - if both pass, M4 extraction moves to **verified**.

## Decisions (user-approved — point here instead of re-explaining)
- 2026-08 (this session): Fixed Issue 1 (P0, silently dropped data fields). Root cause: the
  `uncapturedData` guard logic and the plain-`TagDataOffset` pointer-capture branch in
  `tag-extractor.ts`'s `flattenStruct` were already present in this session's uncommitted work
  (font/string_list/unicode_string_list/meter/hud_message_text/input_device_defaults/
  model_animations/scenario script+comment data - all captured the same way as TagReflexive:
  append pointed-to bytes, rewrite the pointer to a local offset; unresolvable pointers leave the
  tag's data untouched and `dependency-walker.ts` emits a blocking `uncapturedData` warning, same
  mechanism used for the `gbxmodel`-geometry block). What was missing: (a) a real-byte proof (not
  just bounds-checking) and (b) a second, genuinely new bug found while building that proof -
  `flattenStruct`'s plain-`TagDataOffset` branch did NOT skip `nonCached` fields the way
  `dependency-walker.ts`'s `collectFromStruct` and `embedded-data-fields.ts`'s
  `findEmbeddedDataFields` already did. Confirmed via real bytes: bitmap's `compressed color
  plate data` field (nonCached, "confirmed garbage" per this file's own earlier note) has a
  **non-zero stored size in 222/222 ui.map bitmaps and 132/132 coldsnap.map bitmaps** - its
  garbage pointer happened to resolve out-of-bounds in every sample checked (so no map in this
  repo was actually corrupted), but a future map where that garbage pointer coincidentally landed
  in-bounds would have had random bytes captured as "data" and the field's pointer rewritten to
  point at them - never read by the game (nonCached), but wasted space and a real latent gap.
  Fixed: `flattenStruct` now skips `field.def.nonCached` fields exactly like the walker does.
  Also found: `dependency-walker.test.ts`'s warning-kind allowlist (a typo-guard sanity check, not
  a behavioral assertion) didn't list `uncapturedData` yet - a real, deliberate new kind added
  this session (2 legitimate emitters: unresolvable plain-pointer fields, `gbxmodel` geometry
  reflexives) - extended the allowlist, did not change any production logic to satisfy the test.
- 2026-08 (this session): Real-byte proof for Issue 1 added (`tagdata-capture.test.ts`):
  `ui\ticker` (font)'s 31,066-byte `pixels` field captured byte-identical to the source map,
  survives v3 container round-trip; a negative test corrupts that same pointer to resolve
  out-of-bounds and confirms `walkDependencies` flags it + `planAddInjection` blocks the tag with
  a "cannot be captured or relocated" reason (into a target that doesn't already have the tag, so
  the block path is actually exercised, not matched/reused). A same-reader property sweep
  (independent expected-length calculator, not calling `tag-extractor.ts`'s own code) ran over
  **every non-external tag in all 4 available sample maps** (bloodgulch 1569, ui 1411, sidewinder
  1542, coldsnap 1957 - 6,479 tags total): **0 length mismatches (0 silently dropped) in all
  four**. `uncapturedData` warnings found: bloodgulch 169 (70 unique tags), ui 14 (5), sidewinder
  160 (64), coldsnap 186 (78) - **100% of these are the known, already-blocked `gbxmodel`
  geometry case; 0 were a plain-pointer field failing to resolve** in any real sample map. Core:
  **101/101 Vitest pass** (95 + 6 new). Desktop: 33/33 unchanged (no desktop files touched).
  Labelled "same-reader" per this session's new rule: this proves internal consistency with our
  own reader's assumptions, not that the real Halo CE/OpenCE engine accepts the result - that
  still needs the user's own Windows/OpenCE test (see "Windows check" above).
- 2026-08: SparkEdit is **out of scope** - continue the current tool. Investigated and rejected
  (wrong stack, unverified structs, no tests, no injector logic to borrow, unclear license);
  reference its 3D/BSP rendering techniques only when Phase 2 is built, never its code.
- 2026-08: Relocation must be map-agnostic - no logic keyed to a specific map name, tag path, or
  file size (format-level struct-layout constants are fine, see RULES.md). Verified by audit:
  `tag-injector.ts`/`dependency-walker.ts`/`resource-map.ts` contain zero map-name/path-literal
  branches outside comments/tests.
- 2026-08: Standing rules captured in `/app/memory/RULES.md` (work on copies, temp+rename writes,
  SAMPLE_MAPS_DIR helper, Node 22/Yarn 1 only, verified-by-tests/mock-preview/unverified reporting,
  stop-and-ask on ambiguous offset/size/flag, stay inside the named milestone, embedded-data
  relocation stays disabled until verified against real bytes, external data needs a fingerprint
  check not just bounds, BSP-flagged containers refuse/warn, dependency reuse not duplication,
  pre-write validation, path normalization, ≤25-line handoff notes).
- 2026-08: Settings UI approved with: per-pick + per-use validation (file type for the slot,
  readable header/entry count), 3 status states (not-configured / missing-or-unreadable /
  mismatched-with-this-map — the 3rd shown contextually in InjectDialog, not Settings), main
  process owns pickers + settings.json (renderer only ever gets a status back), resource maps
  opened read-only and read by offset (never loaded whole into memory), corrupt settings.json
  falls back to defaults. "Pick Halo CE maps folder" auto-detect button raised as optional,
  **not yet built, no user decision recorded either way** — ask again if revisited.
- 2026-08: `.ocetags` container v2 approved with: resource-map identity block per type (filename,
  size, entry count, header+entry-table fingerprint — not whole-file hash), per-ref coverage
  (whole-tag / sound-samples / bitmap-mipmap) + verified/unverified status, `tagIndex` local to
  the container (not the source map), `externalData: "referenced"` reserved for a future
  'embedded' value without a format break, version>2 refused with a plain message, v1 fixture
  kept and tested, reader still rejects any `scenario_structure_bsp` tag.
- 2026-08: Embedded (external=0) bitmap/sound relocation approved as **disabled** until verified
  against real bytes in ui.map. Neither sample map contains one (scanned: 222 internal ui.map
  bitmaps + 125 sound permutations, 100% external=1; bloodgulch.map has zero internal
  bitmap/sound tags). Main agent additionally decided NOT to write a synthetic
  relocation-algorithm fixture (would mean building, and risking false confidence in, the real
  feature under a "synthetic" label) — flagged to user, **no explicit ruling recorded yet**.
- 2026-08: User supplied `coldsnap.map` (396 real embedded assets). Agent proved via real bytes
  that relocation is possible (region layout, "exactly 4 fields" claim) and the user approved
  **building** it ("Yes, build it"), with conditions — see "Relocation research" below for the
  full report, what's built, and what's still unapproved. Container bumped to **v3**: per-tag
  `embeddedRawDataAssets`/`embeddedRawDataPatches` (captured bytes + patch offsets), deduped
  per-tag by (fileOffset, size). Bitmap captures are validated against width/height/format/
  mipmaps (formula verified 100% exact against all 800 real BitmapData instances across
  coldsnap.map + ui.map) — a mismatch blocks the WHOLE tag, never a partial relocation. Sound
  captures are bounds-checked only (no reliable deterministic size formula for compressed audio
  without decoding it) — stated explicitly, not silently assumed safe. The actual relocation
  write path (`applyInjection`'s embedded-insertion branch) is **implemented and tested against
  real bytes** but stays behind `InjectionOptions.allowEmbeddedRelocation` (default `false`,
  `map-worker.ts` never sets it) — **the user has not yet approved enabling it in the real app**;
  it is only ever exercised by `embedded-relocation.test.ts`. `planInjection`'s default
  (production) behavior — blocking any tag with embedded data — is completely unchanged.
- 2026-08: Two NEW, pre-existing bugs found while researching the above:
  1. **FIXED this session** (see "Decisions" entries above dated this session for the full
     root-cause + real-byte proof) - `tag-extractor.ts` now flattens the pointer-based data for
     every plain `TagDataOffset` field (font/string_list/unicode_string_list/meter/
     hud_message_text/input_device_defaults/model_animations/scenario), same mechanism as
     TagReflexive; unresolvable ones block the whole tag via `uncapturedData` rather than
     dropping silently. Same-reader-verified against real bytes in all 4 sample maps, 0
     mismatches. Still "needs re-verification" (not "verified") until the user confirms on
     Windows/OpenCE - see "Status table" above.
  2. **NOT fixed, blocked at the warning level** (Issue 2, plan not yet written): `gbxmodel`
     model geometry (vertex/index data, stored in the separate "model data" region) is never
     captured by the container format at all. Since this session, any tag whose dependency
     closure includes a `gbxmodel` is unconditionally **blocked** from ADD/SWAP via a new
     `uncapturedData` warning (`dependency-walker.ts`, `childStructName === 'GBXModelGeometryPart'`)
     - this prevents producing a corrupt map, but means vehicles/weapons/bipeds can't be
     injected at all today. Capture/relocation plan is the next step, pending user approval
     before any geometry code is written.
- 2026-08: `crc32` (main header) and the sub-header's `tagFileChecksums` go stale after ANY
  injection (tag-array growth OR embedded insertion) — tracked P0, not fixed this session (M6
  work). The Inject result dialog and worker already surface this (`staleChecksumWarning`,
  updated wording 2026-08: "Checksums were not updated. This map may be rejected by some loaders
  until M6 (export + CRC) is done.").
- 2026-08: M5 build order approved: Step A (ADD mode only) → stop for review → Step B (SWAP,
  keeps target's tag ID) → stop → Step C (conflict dialog: skip/replace/rename + "apply to all",
  using the existing `ConfirmDialog.tsx`). Never overwrite source map (temp+rename to a new file
  via Save As), validate before writing (tag/size limits, missing deps, unresolved refs), reuse
  existing target dependencies instead of duplicating, normalize paths (backslashes,
  case-insensitive) for conflict detection while preserving original casing on write, flag
  header/CRC32 fix-ups rather than pulling M6 work into M5.
- 2026-10: Halo Demo / HaloMD -> Custom Edition converter added as a side feature. Phase 1
  (retail-layout maps, cache version 7, base 0x40440000: header patch + CRC) comes first; Phase 2
  (true demo layout, version 6, base 0x4BF10000: schema-driven pointer rebase) only starts after
  Phase 1 is confirmed in OpenCE. Research notes: `memory/demo-converter.md`. The converter is a
  separate module and the CE-only parser/validators stay unchanged. Demo sample maps live in
  `sample_maps/demo/` (separate from the CE maps, since both have a `bloodgulch.map`). Never
  convert in place; refuse maps that are already 609. Open item: the tag-data-header field order
  (checksum vs scenario ID at +0x4/+0x8) differs between the Halo Map Structure PDF and the
  research notes, so confirm it from real bytes before relying on it. M5/M6 work is paused,
  not cancelled.

## Status as of 2026-08 (this session)

### Done
- M1 (header/index parse), M2 (decompress/recompress via `@mongodb-js/zstd`), M3 (Electron shell,
  Sapien/SparkEdit-style React UI) — from earlier sessions.
- **Tag Definition Layer** (`/core/src/map/definitions/`) — built this session, full details in
  `definitions/SOURCES.md`:
  - Data-driven schema: JSON files in `groups/*.json` (one per tag group, 86 files), generated by
    `scripts/generate-definitions.mjs` from a local clone of Invader (+ Reclaimer for 2 gaps).
    Statically imported via `definitions-index.ts` so the bundler inlines them (works in dev, the
    esbuild Electron bundle, and the packaged app — verified via `node esbuild.electron.mjs`).
  - Generic engine (`engine.ts`): resolves struct field byte offsets by walking field lists
    (inherits chains, pad, enum/bitfield/TagDependency/TagReflexive/TagDataOffset sizing),
    validates computed size against each struct's declared ground-truth size, throws
    `DefinitionLoadError` on any malformed definition. No per-tag hardcoded parsing.
  - Binary codec (`codec.ts`) + full decode/encode (`decodeStruct`/`encodeStruct` in `engine.ts`)
    for every basic field type.
  - Validation bridge (`validate-tag.ts`): recursive round-trip byte-identity check, TagDependency
    resolution against the real tag index (with abstract-class expansions: model→gbxmodel,
    item→weapon/equipment/garbage, unit→biped/vehicle, shader→9 shader_* subtypes, object, `*`
    wildcard), TagReflexive bounds checking, and the `scenario_structure_bsp` cache-header
    indirection fix (see SOURCES.md "Key finding").
  - Resource map parser (`resource-map.ts`) for `bitmaps.map`/`sounds.map`/`loc.map`, used to
    validate whole-tag-external references.
  - **Result**: all 83 known Halo CE tag groups defined and validated. `yarn vitest run` in
    `/core`: 34/34 tests pass, **zero failures across every group** (not just the originally
    scoped 19 Tier-1 groups) against both `bloodgulch.map` and `ui.map`.
  - Full provenance table, abstract-class notes, and known simplifications documented in
    `core/src/map/definitions/SOURCES.md` — read that before touching M4/M7.

### Stopped here deliberately (superseded — see M4 section below)
Earlier in this session M4 core logic was built and validated via Vitest only; this was followed
by a full M4 **frontend/UI integration** pass (see below), which is now done and tested.

## M4: Dependency walker + tag extraction + UI (done 2026-08)
- **Core** (`/core/src/map/dependency-walker.ts`, `tag-extractor.ts`, `container.ts`):
  - `walkDependencies()`: generic BFS over TagDependency/TagReflexive fields (reuses the
    definitions engine, no per-group hardcoding), tracks `requiredBy` (reverse edges, for the
    dialog's "required by" column), classifies each tag as `ok`/`bsp`/`external`/`uncertain`/
    `noDefinition`, takes optional `{ onProgress, signal }` (`WalkOptions`) so callers get
    progress + cancellation without `/core` importing anything Electron/Node-specific.
  - `extractable`/`notExtractableReason` added to `DefinitionStruct`/`ResolvedStruct` (generic
    flag, checked by the extractor — no hardcoded group names). Set to `false` on
    `scenario_structure_bsp` (separate memory region, see SOURCES.md). The walker still visits a
    non-extractable BSP's **own direct dependencies** as informational-only warnings ("needed by
    BSP, not extracted") without walking/extracting them further.
  - `extractTagSet()`: flattens the walked closure into self-contained, relocatable buffers
    (two-phase per-struct flatten: siblings first, then recurse, to preserve reflexive array
    stride — same technique as before). Tags with `extractable: false` are excluded and reported
    in `notExtracted`, never silently included. Throws `AllTagsExcludedError` if that leaves
    nothing to extract (BSP-only selection) — no file written.
  - `container.ts`: new `.ocetags` file format (JSON, versioned: magic, `formatVersion`,
    `sourceMapName`, `createdAt`, `hasUnresolvedBspReferences`, tags + base64 data + deps,
    `notExtracted`, `warnings`). `deserializeContainer()` rejects wrong magic/version and any
    container containing an `scenario_structure_bsp` tag (defense in depth for M5's reader).
  - Tests: `core/tests/tag-extractor.test.ts` — scenario extraction excludes BSP + flags
    container, BSP-only selection throws, mixed selection extracts rest + reports BSP, clean
    round-trip through serialize/deserialize, reject-sbsp-container. **45/45 core Vitest pass.**
- **Electron backend** (`/app/desktop/electron/`):
  - `worker-manager.ts` (new, replaces `worker-task.ts`): exactly **one** persistent
    `map-worker.js` Worker thread per app session, started eagerly in `main.ts`'s
    `app.whenReady()`. Typed request/response protocol in `shared-types.ts`
    (`WorkerRequest`/`WorkerResponse`), every request has a `requestId`.
  - `map-worker.ts` (rewritten, stateful): parses the open map **once** on `inspect` and keeps
    `{buffer, header, tagIndex}` in worker memory — `getDependencies`/`extractTags` reuse it, no
    re-send/re-clone of the map buffer per call. All `fs` I/O lives here; `/core` stays pure.
    `extractTags` writes to a temp file then renames into place (cancel/crash/failure leaves no
    partial file). Cancellation via a polled `AbortController` per requestId. Logs "Worker loaded,
    definitions loaded (N tag groups, N structs)" on startup (self-check).
  - `main.ts`: `deps:get` (read-only) and `tags:extract` IPC handlers. `tags:extract` shows the
    native Save As dialog itself (renderer never supplies a path), refuses the source map path and
    paths inside the app install dir, confirms before overwriting an existing file, remembers last
    used directory (`settings.ts`, `userData/settings.json`). All inputs validated; every result is
    `{ ok, code, message }` shaped.
  - `preload.ts`: named methods only (`getDependencies`, `extractTags`, `cancelExtraction`,
    `openContainingFolder`, `getSettings`), no `ipcRenderer` exposed; `contextIsolation: true`,
    `nodeIntegration: false` (unchanged from M3).
- **Frontend** (`/app/desktop/src/`):
  - `components/DependencyDialog.tsx` (new): phases loading → list → extracting → result/error.
    Summary line, grouped collapsible warnings (`WarningGroup.tsx`: "Not extracted" [blocking],
    "External data", "Undefined/uncertain groups", "Unresolved references"), searchable
    virtualized tag list (`VirtualTagList.tsx`, manual windowing, no new dep — verified smooth at
    2,200+ rows). Confirm button disabled with a stated reason when nothing is extractable
    (BSP-only, no checkbox) or gated by an "I understand" checkbox when there are warnings.
    Progress + Cancel during extraction; result view with "Open containing folder"; Escape to
    close/cancel; focus trap; "Copy warnings" button.
  - `components/TagBrowser.tsx` (rewritten): controlled `selected: Set<number>` prop, group-header
    checkbox selects every tag in that group, right-click context menu ("Extract (with
    dependencies)...", selects the row first if unselected), toolbar Extract button shows count.
  - `App.tsx`: owns `selectedTagIndices`/`extractSelection` state; one shared `requestExtract()`
    handler used by the toolbar button, the TagBrowser context menu, the Tools menu
    ("Extract Tags...", forwarded from Electron's menu via `menu:action`), and a global Ctrl+E
    listener. Large selections (>200 tags) get a confirm before walking. Dialog auto-closes when
    the open map changes.
  - `dev-mock.ts` + `test-fixtures/dependency-fixtures.ts` (new): 9 scenarios via `?mock=<name>`
    (clean, scenario-bsp, external-data, spheroid, bsp-only, large-list, deps-error, extract-error,
    slow-progress), shared between the dev preview and the RTL component tests. Only activates via
    dynamic `import()` gated on `import.meta.env.DEV` + absent `window.opence` — confirmed absent
    from production `dist`/`dist-electron` bundles (grepped for `installDevMock`,
    `buildMockSummary`, `parseMockScenario`, `MOCK_SCENARIOS` — none found; only a harmless, always
    unreachable "MOCK DATA" string literal remains in `App.tsx`, gated by a runtime flag that's
    never true outside the mock).
  - Desktop renderer test infra added: `vitest` + `jsdom` + `@testing-library/react` (pinned to
    versions compatible with Node 20 — see `package.json`/`engines`). 14 RTL tests across
    `DependencyDialog.test.tsx` and `TagBrowser.test.tsx`, all passing.
- **Packaging**: `engines.node` set to `>=20 <23` in both `core` and `desktop` `package.json`
  (Node 22 LTS recommended, Node 26 known to break Electron's binary download per user report).
  `asarUnpack` added for `@mongodb-js/zstd` native module in `electron-builder` config.
- **Testing status**: core Vitest 45/45 ✅. Electron + renderer `tsc --noEmit` clean ✅. Desktop
  Vitest (RTL) 14/14 ✅. `testing_agent` E2E pass over all 9 mock scenarios in the browser preview:
  100%, 0 console errors, 0 code changes requested (see `/app/test_reports/iteration_5.json`).
  **NOT YET verified**: real Electron shell with a real map (main process/native dialogs/worker
  can't run in this headless container) — user said they'll test `extract a vehicle and weapon
  from bloodgulch.map` themselves on Windows once this is handed off.

## Known simplifications / backlog (see SOURCES.md for full detail)
- Composite geometry types (Point3D, Matrix, etc.) decode as plain number arrays, not named
  sub-fields — deferred to M7.
- `TagDataOffset` external-resource metadata (`external_file_offset`/`file_offset`, e.g. sound's
  external `.map` samples) not carried into the schema yet — only whole-tag `isExternal`
  references were validated this round.
- Per-mipmap `BitmapDataFlags.external` bit not checked (no occurrence found in sample maps).
- `spheroid` tag group is genuinely **uncertain** — no reliable source exists for it anywhere
  (even Reclaimer's own author calls it a guess), and it doesn't appear in either sample map.
- **OPEN ITEM (P0, blocks embedded-data relocation)**: embedded (external=0) bitmap/sound raw-data
  relocation is unimplemented and the ADD/SWAP injector actively blocks any tag with one (plain-
  language warning). 2026-08: **verified feasible** on a real custom map (coldsnap.map, 396
  embedded assets) - see "Relocation verification attempt #3" below for the design and exact
  citations. NOT implemented - proposed to the user, waiting for explicit approval before writing
  any code. Still true: do NOT implement/enable against a synthetic-only fixture.

## Upcoming (pending user go-ahead — M4 UI is done, waiting for user's own Electron/Windows test)
- Sounds.map resolution (parse external sound pointers before M5) — explicitly deferred by user.
- M5: tag injection/swap (ADD/SWAP modes), reading the `.ocetags` container from M4.
- M6: export map + recalc CRC32.
- M7: field-level tag editor reusing this definition layer (promote any group's field naming from
  "array of numbers" to named sub-fields as needed).
- Phase 2: 3D scenario editor (three.js viewport, BSP/model rendering, Forge-like placement).

## Tools > Verify Embedded Data (done 2026-08)
Map-agnostic, read-only GUI diagnostic (new Decisions-section rule: no logic keyed to a specific
map name/tag path/size - verified by code review, zero such branches). Core:
`core/src/map/embedded-data-verifier.ts` - `verifyEmbeddedData(buffer, header, tagIndex)` reuses
`walkDependencies`'s existing per-field embedded/external detection (same decode path the M5
injector's relocation guard uses - no reimplementation), adds bounds/overlap/readability checks
for embedded assets only (external offsets point into a different file, never bounds-checked
against the open map), and reports unrecognized tag classes or out-of-bounds top-level structs as
BLOCKED rather than guessed. Also fixed a real gap found while building this: `collectFromStruct`
in `dependency-walker.ts` used to silently skip a reflexive array whose pointer/count resolves
outside the file - now emits a new `'invalidReflexive'` warning kind instead (generic, benefits
every consumer, zero behavior change for valid maps - confirmed by the unchanged 62/62 then 73/73
regression count). `formatEmbeddedDataReport()` renders the plain-language text used by the
dialog's "Copy report" button. Electron: new `tags:verifyEmbeddedData` IPC
(`main.ts`/`map-worker.ts`/`preload.ts`/`shared-types.ts`), Tools menu item (native + in-app
`MenuBar`) opens `VerifyEmbeddedDataDialog.tsx` (loading -> report-with-copy-button -> error
phases, no "apply" step - this feature never writes anything). Dev-mock fixtures:
`?mock=verify-clean` / `?mock=verify-blocked`.
**Testing**: core 73/73 Vitest (11 new in `embedded-data-verifier.test.ts` - 3 real-map regression
against ui.map/bloodgulch.map/sidewinder.map confirming 0 false positives, defensive-path unit
tests for unrecognized-class/out-of-bounds-struct blocking built without faking a binary map
layout, pure `rangesOverlap`/`formatEmbeddedDataReport` tests). Desktop: 33/33 Vitest (5 new RTL
tests for the dialog), both electron+renderer `tsc --noEmit` clean, esbuild bundle clean.
Per the user's new standing rule, **no testing_agent/screenshot used** - targeted Vitest only.

## Relocation verification attempt #3 (Task 3): coldsnap.map - VERIFIES, pending approval (2026-08)
User uploaded `sample_maps/coldsnap.map` (real CE 609 custom map, 2791 tags, 79.9MB) - first real
embedded-data sample. `verifyEmbeddedData` found **396 embedded assets (350 bitmap + 46 sound),
0 blocked, 0 out-of-bounds, 0 overlapping, 0 unreadable** - a genuinely clean, heavily-modded map.
Real example: `levels\one\devices\bitmaps\panel_scuff` (bitmap), embedded, offset=26,396,672,
size=43,704 bytes, first bytes `1084cb5a55552323718ccb5a5555c842`.
**Finding**: relocation does NOT need the region's start - confirmed by exact arithmetic on real
bytes (see SOURCES.md "UPDATE 2026-08" for the full citation): `max(embedded offset+size) ==
tagIndex.modelDataFileOffset` (54552850, exact), `modelDataFileOffset + modelDataSize ==
tagDataOffset` (70610858, exact), `tagDataOffset + tagDataSize == decompressedFileSize`
(79925558, exact) - zero slack, whole file accounted for. Embedded offsets are confirmed plain
absolute file offsets (not memory-address-translated: `baseMemoryAddress` ~1.08B vs offsets
~26-54M, different domains).
**Proposed design** (NOT implemented - awaiting approval): insert new embedded bytes immediately
before `modelDataFileOffset`, shift model+tag data forward by the inserted size, increment
exactly 3 stored fields by that delta (`modelDataFileOffset`, `tagDataOffset`,
`decompressedFileSize`) - every existing struct pointer auto-shifts via the same
`tagDataOffset`-relative anchor already used for M5's tag-array growth, zero per-pointer
rewriting needed. Preserves the observed invariant exactly (safer than appending at true EOF,
which breaks it and is unverified).
**Residual risk**: structural/arithmetic analysis of ONE real map, not yet validated by an actual
in-game round-trip. Recommend implementing behind clear logging and having the user verify
in-game before trusting it for real mods.
Yoyorast_Island.map (`sample_maps/`) is staged but unused - optional secondary cross-check later.


## Relocation verification attempt #2: sidewinder.map (2026-08, read-only)
User uploaded `sample_maps/sidewinder.map` (real CE 609, 2420 tags, 14.8MB) as a candidate real
embedded-bitmap example. Ran the SAME generic scanner used on ui.map/bloodgulch.map (no map-name
or path-specific code - see Decisions above) plus a full scenario-closure dependency walk (1079
tags walked, 555 external, 2 bspTag, **0 embeddedRawData/uncertainGroup/noDefinition/notExtracted
warnings**). **Result: 0 embedded bitmap/sound data, same as ui.map and bloodgulch.map.**
sidewinder is an unmodified stock CE multiplayer map - like bloodgulch, every bitmap/sound it uses
routes through bitmaps.map/sounds.map. It does not demonstrate embedded data either; still need a
genuinely custom/modded map (the user's own fighterbomber/banshee/mp_tree_pine_snow maps,
mentioned in an earlier session, were never supplied). Relocation stays **disabled**, not
enabled - per explicit instruction, a verification failure/non-finding must not flip it on.
Additional structural finding re-surfaced from existing SOURCES.md research (not new, but
material to "must work for ANY map"): the embedded raw-data region's START OFFSET is not stored
anywhere in a compiled map (confirmed against `invader/src/build/build_workload.cpp` - it's an
implicit gap computed only at build time) - reconstructing it from a compiled file alone for an
arbitrary map is a second, independent blocker beyond "no sample found yet" and needs its own
research before relocation can be enabled even once a real embedded asset is available.


## Investigation: SparkEdit CE (v609) support feasibility (2026-08, read-only, no code changed)
See chat for full 7-point report. Verdict: **reference only, do not fork/extend SparkEdit.**
Reasons: C++/MFC/legacy-OpenGL stack (wrong language for this Electron+TS project), struct
knowledge is hand-reversed/unverified (vs our Invader-cited SOURCES.md), zero automated tests,
legacy VC6/VC7 toolchain, no cross-map tag-injection code to borrow at all (its "import" feature
only registers tags already embedded in the loaded map into the scenario palette - not a byte-
level injector like our M5), and unclear license (no LICENSE file in the HaloMods repo itself).
Its one genuine strength - a complete 3D BSP/model viewport + Forge-style scenario editor (frustum
culling, lightmap-as-second-texture-unit, per-model LOD distance cutoffs, OBJ export) - should be
mined as a **design reference only** when Phase 2 (three.js scenario editor) is built on our own
core, not reused as code.

## Small: "Copy warning report" button in InjectDialog (done 2026-08)
New pure function `buildInjectWarningReport(plan)` (`src/components/injectWarningReport.ts`)
formats refusedRoots/blockedEmbedded/blockedOther/externalRefStatuses as path+category+reason
text lines; wired to a button next to the review-phase summary line
(`inject-copy-warning-report-button`), copies via `navigator.clipboard` (same pattern as
`DependencyDialog`'s existing "Copy warnings" button). Targeted Vitest only, per user instruction
(3/3 pass, `src/components/__tests__/injectWarningReport.test.ts`) - no testing_agent/screenshot
used this session (new standing rule in RULES.md).


## M5 Step B: SWAP-mode tag injection (done 2026-08, this session)

Before any code, user required an exhaustive real-byte search of ui.map/bloodgulch.map for
embedded (external=0) bitmap/sound data (blocker carried over from the previous session). Built
a reusable scanner `core/scripts/scan-embedded-data.ts` (uses the same `walkDependencies`
`embeddedRawData` detection the injector itself relies on - no separate parsing logic, so results
match what the injector's relocation guard sees). **Result: 0 embedded fields found.** ui.map has
251 non-external bitmap/sound tags (575 external-resource-map data fields, 0 embedded); bloodgulch
has 0 non-external bitmap/sound tags at all. Reported to user per the decision tree they specified;
user confirmed: keep relocation disabled, proceed with Step B/C for tags that don't need it, track
as an open item (see "Known simplifications" below), and supply a small custom map with one real
embedded bitmap later for actual verification - filename/tag TBD from user when they have it ready.

- **Core** (`tag-injector.ts`): generalized `planAddInjection`/`applyAddInjection` into
  `planInjection(mode, ...)`/`applyInjection(...)` (mode-agnostic, `AddInjectionPlan` etc. kept as
  type aliases for compat) plus new `planSwapInjection`/`applySwapInjection` wrappers. SWAP mode:
  a matched tag (same normalized path+class already in target) gets its struct data REPLACED in
  place - new data appended past the (shifted) existing region like ADD's new entries, but the
  EXISTING array slot's tagId/path pointer/primary class are left untouched, only
  `tagDataPointerOrResourceIndex`/secondary/tertiary class are patched. Key finding reused from
  Step A: a matched tag's tagId never changes in SWAP mode (whether its own swap succeeds or falls
  back to untouched), so nothing that depends on a matched tag by internal reference can ever be
  blocked by that matched tag's own swap outcome - only true appends (`toAdd`) participate in the
  block-cascade. A matched tag that CAN'T be swapped (embedded-data warning, missing dependency,
  OR the target entry is itself whole-tag-external with no struct pointer to repoint) falls back
  to untouched/reused, reported in BOTH `reused` and the relevant blocked list (intentionally not
  mutually exclusive - "reused" means nothing changed, the blocked list says why a requested swap
  didn't happen). Tests: 3 new tests in `tag-injector.test.ts` using REAL bytes - "weapons\frag
  grenade\shaders\frag metal" (shader_model) exists non-external in both ui.map and bloodgulch.map
  (genuine in-place-swappable match), its 3 bitmap dependencies exist in bloodgulch as whole-tag-
  EXTERNAL entries (genuine "can't swap into this" case), full apply + re-parse + 1500+-tag
  validation. **Core: 62/62 Vitest pass.**
- **Electron**: `shared-types.ts` threads `InjectionMode` through `WorkerRequest.planInject` and
  `OpenceApi.planInject(path, mode)`; `InjectPlanSummary` gained `mode`/`toSwap`, counts gained
  `swapped`; `ApplyInjectResult` gained `swappedCount`. `map-worker.ts`/`main.ts`/`preload.ts`
  updated to pass mode through unchanged otherwise (same temp-file-then-rename write, same
  Save-As/overwrite-refusal guards from Step A).
- **Frontend**: `InjectDialog.tsx` gained a new first phase, `choose-mode` (two buttons: "Add new
  tags" / "Swap into existing tags", `inject-mode-add`/`inject-mode-swap`/`inject-mode-cancel`),
  before the existing picking->planning->review->apply->result flow (mode is for the whole
  operation - per-tag choice is Step C, not built yet). Review phase summary line and a new "Will
  be swapped (keeps existing tagId)" `WarningGroup` section added; `nothingToAdd`/confirm-gating
  logic extended to include `counts.swapped`. `dev-mock.ts`/`test-fixtures/dependency-fixtures.ts`
  extended with SWAP-mode mock plans (clean + blocked) built from the same real tag paths used in
  the core tests, so the mock preview matches reality.
- **Testing**: core 62/62 ✅ (incl. 3 new real-byte SWAP tests), desktop electron/renderer `tsc
  --noEmit` clean ✅, desktop Vitest 25/25 ✅ (unchanged, no existing InjectDialog RTL suite to
  break), `testing_agent` E2E on the new choose-mode screen + SWAP-mode InjectDialog via browser
  mock: 100% (9/9 requirements), 0 console errors, 0 bugs (`/app/test_reports/iteration_7.json`).
  **NOT YET verified**: real Electron shell / real map SWAP in OpenCE on Windows (headless
  container can't run it) - same caveat as Step A, user will test themselves.
- **Per explicit user instruction this session: STOPPING here for review before Step C** (the
  conflict dialog - skip/replace/rename + "apply to all", using the existing `ConfirmDialog.tsx`).

### 2026-08 session: embedded (external=0) bitmap/sound relocation - built, disabled by default
See "Relocation research" section above for the full report. Summary of what changed:
- New `core/src/map/embedded-data-fields.ts` — shared detector + bitmap pixel-size validator,
  also adopted by `dependency-walker.ts` (pure refactor, same warnings/behavior, same 73/73
  pre-refactor test results, coldsnap.map Verify Embedded Data still reports 396 embedded / 9
  external / 0 blocked before and after).
- `container.ts` bumped to **v3**: per-tag `embeddedRawDataAssets`/`embeddedRawDataPatches`. v1/v2
  containers still read fine (fields simply undefined, relocation stays blocked for them).
- `tag-extractor.ts`: captures embedded bytes at extraction time (always on, no flag - pure data
  gathering), deduped per-tag, bitmap-size-validated, bounds-checked.
- `tag-injector.ts`: `applyInjection` can relocate the captured bytes, but ONLY when the caller
  passes `{ allowEmbeddedRelocation: true }` — default `false`, `map-worker.ts` never sets it, so
  the shipped app's behavior is byte-for-byte unchanged from before this session.
- 2 new pre-existing bugs found (NOT fixed, logged above as tracked P0s): the font/string_list/
  model_animations/etc `TagDataOffset`-pointer extraction gap, and `gbxmodel` model-data not
  being carried by the container format at all.
- Tests: `embedded-data-fields.test.ts` (12 unit tests), `embedded-relocation.test.ts` (4 tests,
  real coldsnap.map/bloodgulch.map bytes, independent-of-the-injector's-own-math verification),
  plus extended `tag-extractor.test.ts` (+5) and `embedded-data-verifier.test.ts` (+1). Removed
  `relocation-synthetic.test.ts` (superseded - it only tested that the old disabled stub threw).
  **Core: 95/95 Vitest pass. Desktop: 33/33 Vitest pass.** Did NOT call `testing_agent` (backend-
  only, byte-level change, no UI touched this session - self-tested per RULES.md).
- **NOT done** (explicitly out of scope / awaiting approval): enabling `allowEmbeddedRelocation`
  in `InjectDialog.tsx`/`map-worker.ts`; fixing either of the 2 newly-found pre-existing bugs;
  Step C (conflict dialog, still blocked on explicit user go-ahead); CRC32/checksum recalculation
  (M6).

  Not built yet.

### What to test in OpenCE on Windows (Step B, in addition to Step A's steps)
1. Extract a tag that already exists in your target map at the same path (e.g. re-extract a stock
   weapon/vehicle tag you've modified, or a retextured version of one) into a `.ocetags` file.
2. Tools > Inject Tags... > choose "Swap into existing tags" > pick that container > review (should
   show "to swap" for the matching tag, "reused" for anything that can't be swapped e.g. whole-tag-
   external matches) > confirm > Save As a NEW file.
3. Load the NEW file in-game: the map's EXISTING placements of that tag (scenery, weapon spawns,
   etc. already in the scenario) should now show the swapped content WITHOUT needing to add any
   new placement - this is the whole point of SWAP vs ADD. Report back: does it load, and do
   existing placements pick up the new content correctly?

## M5 Step A: ADD-mode tag injection (done 2026-08)
User required a cited, verified design (not asserted) before any code — see
`core/src/map/definitions/SOURCES.md` "Milestone 5, Step A findings" for the full citations
(Invader map.cpp/build_workload.cpp/resource.cpp line numbers) and the empirical checks run
against real bytes in the sample maps.

- **Core** (`/core/src/map/tag-injector.ts`, new):
  - `planAddInjection(targetTagIndex, container, resourceMapConfig?)`: dry-run only, never
    mutates/allocates. Reuses existing target tags by normalized path+class instead of
    duplicating; blocks (with a fixed-point cascade to dependents) any tag with an
    `embeddedRawData` warning (relocation disabled) or a missing `external`/`unresolved`/
    `notExtracted` dependency; reports per-root refusal reasons; computes external-resource-map
    fingerprint status (`match`/`mismatch`/`unconfigured-on-target`/`unverified-at-extraction`).
  - `applyAddInjection(...)`: the structural write. Grows the tag array and decrements the single
    stored `tag_array_address` field by the growth delta — this re-anchors EVERY existing tag's
    reflexive/path/tag-data pointers automatically (cited + empirically verified, see SOURCES.md),
    zero per-pointer rewriting needed for pre-existing tags. New tags' own local (extraction-time)
    reflexive offsets are translated to real virtual addresses; `TagDependency.tagId` fields are
    remapped to the resolved target tagId (new tagId via the real tool.exe salt formula); `pathPointer`/
    `pathSize` are zeroed (stale tool-only fields, decided not left as source-map garbage).
    `crc32`/sub-header `tagFileChecksums` are deliberately left untouched and reported as stale
    (M6's job, never silently done here).
  - `relocateEmbeddedRawData()`: explicit disabled stub (throws). Embedded (`external=0`)
    bitmap/sound relocation needs the raw-data region's start, which isn't stored anywhere in a
    compiled map — under-determined from a compiled file alone, and neither sample map has a real
    embedded asset to verify an implementation against anyway. Never called by
    plan/applyAddInjection. A synthetic (non-real-byte) fixture was deliberately NOT built either —
    writing a fake relocation algorithm just to exercise a "disabled" stub would mean building (and
    risk giving false confidence in) the real feature under a "synthetic" label; flagged to user
    instead of decided silently.
  - Container bumped to **v2** (`container.ts`): `secondaryClassFourCC`/`tertiaryClassFourCC` per
    tag (280/2455 bloodgulch.map tags have a non-null secondary class — was silently dropped by
    M4, fixed this session), `resourceMapIdentities` (sha256 of header+entry table, NOT the whole
    file), `externalResourceRefs` (per-tag bitmaps.map/sounds.map references with
    verified/unverified status), `externalData: 'referenced'` (reserved for a future 'embedded').
    v1 containers still read fine (defaults for new fields); version > 2 rejected with a
    plain-language message; a real v1 fixture (`tests/fixtures/v1-warthog.ocetags`) is kept and
    tested.
  - `dependency-walker.ts`: now ALSO flags the embedded (`external=0`) case (previously only
    `external=1`/mechanism-B-referenced was flagged — the embedded case was a latent,
    unflagged gap from M4: extracting a tag with embedded pixel/sample data would have produced
    a container with a silently-dangling offset). Generalized via a new `externalDataSibling`
    JSON schema annotation on `BitmapData.flags` (data-driven, no hardcoded field names in TS).
  - Tests: `tag-injector.test.ts` (9 tests incl. full inject-into-copy-of-bloodgulch.map
    round-trip that re-parses with this project's own reader and validates every old+new tag,
    1500+ tags, zero errors), `container-v2.test.ts` (5 tests: v1 fixture read, version rejection,
    v2 round-trip, verified/unverified refs), `relocation-synthetic.test.ts` (1 test: confirms the
    stub is unconditionally disabled). **Core: 59/59 Vitest pass.**
- **Electron** (`/app/desktop/electron/`):
  - `settings.ts`: `AppSettings.resourceMaps: {bitmaps,sounds,loc}`, corrupt/missing
    `settings.json` falls back to defaults. Main process is the only thing that ever writes a
    resource-map path — renderer only ever receives a typed `ResourceMapStatus` back.
  - `main.ts`: `resourceMaps:pick`/`resourceMaps:getStatuses` (validates file type for the slot
    via `validateResourceMapFile`, rejects+doesn't save an invalid pick with a plain-language
    error), `tags:pickInjectContainer`/`tags:planInject`/`tags:applyInject` (Save As dialog,
    refuses the source map path, confirms before overwrite, never overwrites the map being
    injected into).
  - `map-worker.ts`: `planInject`/`applyInject` worker requests, reusing the already-open
    `currentMap` as the injection target; writes via temp-file-then-rename.
- **Frontend**: `InjectDialog.tsx` (new) — phases picking→planning→review→applying→result, with
  `WarningGroup` sections for refused roots/blocked-embedded/blocked-other/external-refs/
  will-be-added/reused, an "I understand" checkbox gating confirm when there's anything blocking,
  stale-CRC32 warning shown in the result. `SettingsDialog.tsx` (new) — 3 resource-map picker rows
  with not-configured/missing-or-unreadable/ok status (a 4th state, "configured but not matching
  THIS map", is contextual per-injection and shown in InjectDialog instead, not here).
- **Testing**: core 59/59 ✅, desktop electron/renderer `tsc --noEmit` clean ✅, desktop Vitest
  25/25 ✅, `testing_agent` E2E on InjectDialog/SettingsDialog via browser mock: 100%, 0 console
  errors, 0 bugs found (`/app/test_reports/iteration_6.json`). **NOT YET verified**: real Electron
  shell / real map injection in OpenCE (headless container can't run it) — user will test
  themselves on Windows; exact steps below.

### What to test in OpenCE on Windows (Step A)
1. Open a target map (e.g. a copy of `bloodgulch.map`) in OpenCE, decompress if needed.
2. Tools > Settings... — point at your own `bitmaps.map`/`sounds.map`/`loc.map` (optional for
   this test, but needed to see "match"/"mismatch" instead of "unconfigured-on-target").
3. Extract a tag with NO external data (e.g. a vehicle) into a `.ocetags` file from a DIFFERENT
   source map copy, or re-use one from your earlier M4 test.
4. Tools > Inject Tags... on the target map, pick that `.ocetags` file, review the plan (should
   show "to add"/"reused" with zero blocked), confirm, Save As a NEW file (never overwrites your
   original).
5. Load the NEW file in OpenCE/the actual game. **This is the real test** — our own re-parser
   validates pointers internally, but only the real engine can confirm it actually loads &
   displays correctly. Report back: does it load? Does the injected tag/its dependencies show up
   correctly in-game?
6. Optional: repeat with a tag that DOES have external bitmap/sound data (e.g. extract an internal
   ui.map bitmap) to see the "External resource map references" warning and fingerprint status.
7. Optional stress test: try extracting a tag with embedded (non-shared) custom art if you have
   one (a modded map with brand-new textures not in stock bitmaps.map) — this SHOULD be blocked
   with a plain-language warning, confirming the disabled-relocation guard works as intended.

### M5 remaining (Step C, not started — user said stop for review after Step B, done below)
- Step C: conflict dialog (skip/replace/rename, "apply to all") using the existing
  `ConfirmDialog.tsx`, plus pre-write validation surfaced in the UI.

## Relocation research (2026-08) — full report, what's built, what's still unapproved

Real bytes only, cross-checked against `invader/src/build/build_workload.cpp` +
`invader/src/tag/code_generator/compile.py` (the actual compiler, not guesswork).

**Region order (coldsnap.map)**: `[header 0-2048] → [BSP data 2048-26,396,672] → [embedded
bitmap/sound raw data, ending exactly at modelDataFileOffset=54,552,850] → [model data, to
70,610,858] → [tag data, to 79,925,558]`. Identical shape (0 embedded) on bloodgulch/ui/
sidewinder. Matches `build_workload.cpp` byte-for-byte.

**Every absolute/stored-offset mechanism found**:
- `bsp_start` (`scenario` tag's `ScenarioBSP` entries): absolute file offset, always ends well
  before the insertion point in every map checked — never shifts, never patched.
- bitmap per-mipmap pixel offset / sound `samples.file_offset` when `external=0`: exactly what's
  relocated.
- bitmap's `compressed color plate data`/`processed pixel data`: `nonCached` (confirmed garbage
  in real bytes) — already ignored.
- Every OTHER `TagDataOffset` field (scenario script/comment data, font pixels, string_list/
  unicode_string_list strings, meter stencil, hud_message_text, input_device_defaults,
  model_animations frame data): a pointer-based mechanism (same virtual-address translation as
  `TagReflexive`) per Invader's own codegen — confirmed safe, `external`/`file_offset` sub-fields
  are written as garbage for these groups and never read at the resolved location.
- `gbxmodel` vertex/index references: **superseded, see "gbxmodel geometry — Stage 1 capture
  (2026-08)" below for the real mechanism** (byte offsets into a separate model-data region, NOT
  virtual-address pointers at all).

**Header/sub-header fields that change** (4, not 3 — `tagDataSize` is separately stored, not
auto-derived): `modelDataFileOffset`, `tagDataOffset`, `decompressedFileSize`, `tagDataSize`.
Each changes for the SAME reason here (the embedded-byte insertion) — tag-ARRAY growth (a
pre-existing, separately-tested M5 mechanism) additionally shifts the struct/path-data append
position, but doesn't touch these 4 fields differently than it already did before this session.

**Alignment — SETTLED this session** (`scripts/check-alignment.ts`, read-only, run against all 5
sample maps, see handoff for the full table): only `coldsnap.map` breaks 4-byte alignment on
`modelDataFileOffset`/`tagDataOffset` (both ≡ 2 mod 4); the other 4 maps (bloodgulch, ui,
sidewinder, Yoyorast_Island) are both 4-aligned. **No map is 16-byte aligned on both fields** (at
least one of the two breaks it in every single map). Decision: **preserve the target's own
alignment, never force 4-byte or 16-byte** - confirmed as the only safe rule across real maps, not
just the one coldsnap sample. This matches what `applyInjection` already does (it pads the
INSERTED blob to a 4-byte boundary relative to itself, which shifts both fields by a multiple of
4 and therefore preserves whatever mod-4/mod-16 remainder the target already had) - no code change
needed, the existing implementation was already correct, now confirmed by 5 maps instead of 1.

**CRC/checksums**: stale after this write, same as the pre-existing tag-array-growth code already
flags — tracked P0 above, M6 work, not done here.

**What's built** (`embedded-data-fields.ts` new shared helper + `tag-extractor.ts` capture +
`tag-injector.ts` write path), all behind `InjectionOptions.allowEmbeddedRelocation` (default
`false`):
1. `findEmbeddedDataFields()` — ONE definition-driven detector for both the bitmap (bitfield
   sibling) and sound (`TagDataOffset`+`externalFileOffset`) mechanisms, returning `'unknown'`
   (never guessed) for any unrecognized shape. Used directly by the walker and the extractor.
2. Capture (extraction time, always on — this part has NO disabled flag, it's pure data
   gathering, never written back anywhere): slices embedded bytes, dedupes per-tag by
   `(fileOffset, size)`, validates bitmap sizes against width/height/format/mipmaps (100% exact
   formula match against all 800 real BitmapData instances checked), bounds-checks sound
   (no deterministic size formula available for compressed audio — stated, not guessed). A
   mismatch blocks the WHOLE tag's relocation (container still has the tag, just without
   `embeddedRawDataAssets`), never a partial one.
3. Write path (`applyInjection`): inserts the unique asset bytes once, right before the target's
   `modelDataFileOffset`, patches the 4 header fields, patches each relocated tag's own raw
   file-offset field via its recorded `patchOffset`. `planInjection`'s default (production)
   blocking behavior is UNCHANGED — this only ever runs when a caller explicitly opts in.

**Tested** (`embedded-relocation.test.ts`, real bytes, no synthetic fixtures): production default
still blocks; an isolated SWAP-into-self case verifies the exact 4-field math with zero tag-array
growth; a combined ADD into a copy of bloodgulch.map (0 pre-existing embedded data) verifies
byte-identical relocated content + a full 1500+ tag closure re-parse + Verify Embedded Data 0
problems; a harder SWAP into a copy of coldsnap.map ITSELF (396 pre-existing embedded assets)
verifies every one of those 396 keeps its exact byte content and file offset, only the 2 swapped
tags' content legitimately moved. All verification is **independent of `tag-injector.ts`'s own
arithmetic** — expected sizes/offsets are re-derived from scratch in the test file.

**What these tests CANNOT prove** (told to the user explicitly, not hidden):
- They confirm the bytes are internally consistent with OUR OWN reader's assumptions. A shared
  blind spot between the writer and reader would pass here undetected.
- They do not prove the real Halo CE/OpenCE engine accepts the file — crc32/checksums are
  deliberately stale (M6), and nothing here has been loaded in the actual game.
- Cross-tag/cross-map dedup is NOT done — relocating a tag whose embedded bytes happen to already
  exist elsewhere in the target map's raw-data region still inserts a fresh copy (acceptable,
  approved scope: dedupe is per-tag only, per the user's own phrasing).

**NOT YET approved**: enabling `allowEmbeddedRelocation` in the real app
(`InjectDialog.tsx`/`map-worker.ts`). Awaiting the user's decision after reviewing this report —
if approved, the only change needed is passing `{ allowEmbeddedRelocation: true }` through
`map-worker.ts`'s `planInject`/`applyInject` IPC handlers.

### What to test in OpenCE on Windows (embedded relocation, once/if enabled)
1. `yarn core test` locally first — confirms the bytes are internally consistent before touching OpenCE.
2. Extract a tag with embedded bitmap/sound data (one of your custom maps with real custom art,
   e.g. a vehicle skin not in stock bitmaps.map) into a `.ocetags` file.
3. Inject it into a DIFFERENT target map, Save As a new file (never overwrites the original).
4. Load the new file in the actual game. **What you should see**: the map loads, the injected
   tag is present, and its texture/sound plays correctly in-game.
5. What each failure would mean: **fails to load at all** → likely the stale CRC32/checksum (M6,
   already known-stale, not a relocation bug specifically) OR a real relocation math error we
   didn't catch — report the exact error text. **Loads but the map/level doesn't start** →
   possible corrupted tag-data region (reflexive/pointer issue), report which tag. **Starts but
   the new object spawns with blank/missing/garbled textures or no sound** → the relocation
   itself likely has a bug (wrong offset patched, or the asset bytes themselves got mangled) —
   this is the single most informative failure mode, please report it with the exact tag path.

## gbxmodel geometry — Stage 1 capture (2026-08, same-reader unless noted)
Staged build, approved 2026-08. **Stage 1 (capture only) is built. Stage 2 (injection) has NOT
started and relocation stays off in the app.** `gbxmodel-geometry.ts` is a standalone module, NOT
wired into `tag-extractor.ts`/`tag-injector.ts`/`dependency-walker.ts` — any tag whose closure
includes a `gbxmodel` is still unconditionally blocked, unchanged.

**Mechanism (real bytes, bloodgulch `vehicles\warthog\warthog` vs coldsnap
`vehicles\coldsnap_hogs\warthog`, same reused stock model)**: vertex/triangle data for a
`GBXModelGeometryPart` is NOT addressed via TagReflexive/TagDataOffset at all — it's raw byte
offsets into the separate "model data" region. `vertexOffset` (uint32, struct offset 100) is
relative to `modelDataFileOffset`. `vertexCount`×{68 uncompressed/32 compressed, by `vertexType`}
gives an EXACT vertex byte size (0 mismatches across all 1,112 real parts in bloodgulch+coldsnap).
`triangleOffset`/`triangleOffset2` (always equal on PC, confirmed in every sample — Xbox-only
distinction) are relative to `modelDataFileOffset + vertexSize` (`vertexSize` is a stored
tag-data-header field, confirmed `modelDataSize == tagDataOffset - modelDataFileOffset` exactly).
`vertexPointer` is a RUNTIME-ONLY virtual address (213,734,156 vs 311,747,920 for the identical
model in the two maps above; exceeds bloodgulch's 13,936,092-byte file size by 15× — never a file
offset) — never read or patched.

**Triangle byte size has no closed-form formula** (strip-join/primitive-restart count isn't
stored) — recovered via neighbor-gap: sort every part in the WHOLE map by absolute triangle
offset, size = next part's start minus mine (region end = `tagDataOffset` for the last one).
Index `0xFFFF` is a legitimate primitive-restart sentinel wherever it appears. The gap is
occasionally (37% of 1,112 real parts) exactly 1 index too large — a single trailing non-restart
out-of-range word, confirmed build-tool scratch-memory leftover (same value, 0x2D2D, across many
unrelated parts/tags) — trimmed; never more than 1 word in any real sample. After trimming, 0
parts have any remaining non-restart, non-real index, in either sample map (`gbxmodel-
geometry.test.ts`). Only `triangleBufferType=1` ("triangle strip") has real samples to verify
against (100% of 1,112 parts) — type 0 ("triangle list") is blocked, not guessed.

**Stage 1 sweep results** (`gbxmodel-geometry.test.ts`): bloodgulch 70/70 gbxmodel tags captured,
0 blocked; coldsnap 78/78 captured, 0 blocked (447 and 665 real parts respectively). "Dropped" is
not a real outcome of this code path — every tag is either captured or blocked, same contract as
Issue 1's TagDataOffset fix and the bitmap/sound embedded capture.

**Stage 2 prerequisites, verified this session (all same-reader, test-file-local — nothing wired
into tag-injector.ts)**:
1. No-patch claim, re-verified on ALL 665 coldsnap parts (not a 40-part sample) —
   `gbxmodel-combined-insertion-design.test.ts`. 0 mismatches.
2. Field table for ONE injection combining embedded + vertex + triangle insertion (order matters
   — each insertion point is defined relative to the PREVIOUS ones' shifts): embedded bytes (E)
   insert before `modelDataFileOffset`; vertex bytes (V) insert at
   `modelDataFileOffset_new + oldVertexSize` (end of vertex region); triangle bytes (T) insert at
   `oldTagDataOffset + E + V` (end of triangle region). Result: `modelDataFileOffset += E`;
   `vertexSize += V`; `modelDataSize += V + T` (NOT E — embedded bytes live outside the model-data
   region entirely); `tagDataOffset += E + V + T`; `decompressedFileSize += E + V + T` (+ any
   tag-struct append `S`, same pre-existing ADD/SWAP mechanic, unaffected by E/V/T).
   `tagDataSize += S` only. New part's own `vertexOffset = oldVertexSize` (pre-insert value);
   `triangleOffset = triangleOffset2 = oldModelDataSize - oldVertexSize` (pre-insert triangle-
   section size) — both computed from the TARGET's existing header fields alone, no scan needed.
   Existing parts: ZERO fields patched (proven in #1).
3. Combined 3-insertion test (`gbxmodel-combined-insertion-design.test.ts`): injects the
   warthog's own captured part[0] (real vertex+triangle bytes from Stage 1) plus a synthetic
   embedded payload into a coldsnap-based buffer in one pass; confirms the field table math,
   byte-identical placement of the new part, AND an independent re-scan of all 665 pre-existing
   parts (not just the new one) resolving correctly with 0 out-of-region and 0 byte mismatches.
4. Triangle neighbor-gap scanning is extraction-time only (whole-SOURCE-map, read-only, paid
   once). Injection needs NO scan of the target — confirmed by #2/#3 using only stored header
   fields. The container would store each part's explicit captured byte length (no formula
   needed at injection time).
5. `model_animations` frame data and `model_collision_geometry` are **already captured today**
   (checked real tags: coldsnap `model_animations` with 256 anims/792,520 bytes, 0 warnings;
   `model_collision_geometry` tags in both maps, 0 warnings) — Issue 1's generic TagDataOffset fix
   and the ordinary TagReflexive mechanism already cover them. They are NOT part of this gap.

**What tests can't prove**: same-reader only, as always — this proves our own reader and writer
agree, not that the real Halo CE/OpenCE engine accepts the layout. The index-validity check never
proves the triangle data is semantically correct beyond "indices are in range" — a scrambled-but-
in-range index buffer would pass and still render wrong in-game. Effort for Stage 2 itself
(wiring into `tag-injector.ts`, a real `allowGbxmodelGeometryRelocation`-style flag, container
format changes to carry per-part captured bytes): medium — the per-part arithmetic is now fully
derived and tested, the remaining work is wiring + container schema + a new Vitest suite calling
the REAL injector, not more research.


- `/app/core/src/map/definitions/engine.ts` — schema engine (load/validate/resolve/decode/encode)
- `/app/core/src/map/definitions/validate-tag.ts` — real-map validation (round-trip, deps, bounds)
- `/app/core/src/map/dependency-walker.ts`, `tag-extractor.ts`, `container.ts` — M4 core logic
- `/app/core/src/map/embedded-data-fields.ts` — shared bitmap/sound embedded-field detector +
  bitmap pixel-data-size validator, used by the walker and the extractor (2026-08)
- `/app/core/src/map/tag-injector.ts` — M5 Step A+B injection engine (plan/apply ADD + SWAP
  modes) + embedded relocation write path (built 2026-08, behind `allowEmbeddedRelocation`,
  default off, NOT yet approved for the real app)
- `/app/desktop/electron/worker-manager.ts`, `map-worker.ts`, `main.ts` — M4/M5 persistent worker + IPC
- `/app/desktop/src/components/DependencyDialog.tsx`, `TagBrowser.tsx` — M4 UI
- `/app/desktop/src/components/InjectDialog.tsx`, `SettingsDialog.tsx` — M5 Step A+B UI (mode choice + review)
- `/app/core/src/map/definitions/SOURCES.md` — provenance table, must stay updated
- `/app/core/src/map/resource-map.ts` — bitmaps.map/sounds.map/loc.map parser + fingerprinting
- `/app/core/scripts/scan-embedded-data.ts` — reusable real-byte scanner for embedded (external=0)
  bitmap/sound data in any .map file (`yarn tsx scripts/scan-embedded-data.ts /path/to/map`); run
  this FIRST against any user-supplied custom map before touching relocation work
- `/app/core/src/map/gbxmodel-geometry.ts` — Stage 1 gbxmodel vertex/triangle capture (2026-08),
  standalone, NOT wired into tag-extractor.ts/tag-injector.ts, relocation stays off
- `/app/core/tests/definitions.test.ts`, `tag-extractor.test.ts`, `tag-injector.test.ts`,
  `container-v2.test.ts`, `embedded-data-fields.test.ts`, `embedded-relocation.test.ts`,
  `tagdata-capture.test.ts`, `gbxmodel-geometry.test.ts`, `gbxmodel-combined-insertion-design.test.ts`
  (new 2026-08) — validation suites (**109/109 passing** as of 2026-08; desktop Vitest 33/33)
- `/app/core/scripts/generate-definitions.mjs` — regenerate `groups/*.json` from a fresh Invader
  clone if definitions ever need updating (`INVADER_DIR=/path/to/invader/.../definition node
  scripts/generate-definitions.mjs`)
