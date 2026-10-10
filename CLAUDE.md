# CLAUDE.md

Guidance for Claude Code working in this repository. Read this first, every session.

## What this is

A GUI-only Electron desktop app for modding Halo: Custom Edition PC maps (cache header version `609`). Edited maps are meant to run on OpenCE. Xbox, retail PC, and MCC maps are out of scope for the editor and are rejected with an "unsupported map version" error. The one planned exception is the Demo/HaloMD -> Custom Edition converter (see "Converter feature" below).

The real project lives in `core/` and `desktop/`. **`backend/` (FastAPI/Mongo), `frontend/` (CRA/shadcn), `tests/`, and `.emergent/` are leftovers from the old hosting template. They are not part of the app. Ignore them unless asked.** The project was originally built with the Emergent agent in a Linux sandbox mounted at `/app`. It now continues locally with Claude Code on the user's Windows PC. Docs that mention `/app/...` mean this repo root.

## Required reading before changing behavior

- `memory/RULES.md` holds the standing rules. Follow them. The key ones:
  - Never modify `sample_maps/`. Write maps to a temp file, then rename. Never overwrite a source map.
  - Node 22 LTS and Yarn 1 only. No major dependency upgrades without asking.
  - No logic keyed to a specific map name, tag path, or file size. Format-level struct constants are fine.
  - If an offset, size, or flag is ambiguous, stop and ask. Log the decision in `core/src/map/definitions/SOURCES.md` or `memory/PRD.md`.
  - Stay inside the milestone you were given. Flag header/CRC/checksum fix-ups instead of building them, unless the task is the converter or M6.
  - Label status as "verified by tests", "same-reader", "verified in mock preview", or "unverified". Nothing is "done" until the user confirms it on Windows and in OpenCE.
- `memory/PRD.md` holds the milestone status table and the log of approved decisions. Check it before re-asking something. It is the source of truth. The README's status section is only a summary.
- `memory/demo-converter.md` holds the converter research notes. Read it before any converter work.

## Working style (Claude Code)

- For any non-trivial change, state a short plan and wait for approval before editing. Do not write code during research or plan tasks.
- Run targeted tests for the area you changed, and run the full suite at the end of a step. Run `yarn typecheck` in `desktop` when you touch the desktop app. You can run these yourself. Report the real output, including skipped tests and the reason.
- You cannot run the Electron UI or OpenCE. Say plainly what is untested. The user tests on Windows and in-game.
- Commit in small steps on a branch per task. Never commit sample maps or other copyrighted game files. If any `.map` files are tracked in git, tell the user instead of deleting them.
- Handoff notes: at most 25 lines. Say what changed, what is verified and how, what could still be wrong, and exactly what the user should test in OpenCE and what they should see.
- Shell is PowerShell on Windows. For environment variables use `$env:NAME = "value"`.
- Tests that re-parse output with our own reader share the writer's assumptions. Label them "same-reader". Prefer independent checks (compare against source bytes, region sums, known-good maps).

## Commands

Yarn 1, Node `>=20 <23` (22 preferred).

```bash
# core: pure TS library
cd core && yarn install
yarn test                                  # vitest run (node env, tests/**/*.test.ts)
yarn test tests/tag-injector.test.ts       # single file
yarn test -t "some test name"              # single test by name
yarn build                                 # tsc -> dist/ (type-check only; desktop doesn't use dist)
yarn inspect-map path/to/some.map          # dev-only CLI
npx tsx scripts/<name>.ts                  # dev scripts: check-alignment, report-coverage, scan-embedded-data, bench-extract

# desktop: Electron + React
cd desktop && yarn install
yarn dev:renderer        # terminal 1: Vite on http://localhost:5173 (strictPort)
yarn dev:electron        # terminal 2: esbuild main/preload/worker, then launch Electron
yarn test                # vitest (jsdom): src/**/*.test.ts(x) and electron/**/*.test.ts
yarn typecheck           # electron + renderer tsconfigs
yarn build               # vite build -> dist/, esbuild -> dist-electron/
yarn dist:win            # electron-builder portable + NSIS -> desktop/release/
```

Real-map tests read from `<repo root>/sample_maps`, or from `SAMPLE_MAPS_DIR` if set (PowerShell: `$env:SAMPLE_MAPS_DIR = "C:\path"; yarn test`). If a map is missing, the test must skip with a message naming the file and the path searched. All path resolution goes through `core/tests/helpers/sample-maps.ts`. Never hardcode paths. Read maps inside `beforeAll` or `it`, never at `describe` scope.

**Sample map layout:** Custom Edition maps go in `sample_maps/` (bloodgulch, sidewinder, coldsnap, ui, Yoyorast_Island, plus bitmaps.map, sounds.map, loc.map). Demo/HaloMD maps go in `sample_maps/demo/` (bloodgulch.map = original Mac demo, heh_2.map, theisland_3.map). The demo `bloodgulch.map` has the same filename as the CE one, so never mix the two folders.

`desktop/dist-electron/` is committed, and rebuilding regenerates it.

## Architecture

**core/** is a pure TypeScript library with no Electron, DOM, or React dependencies. `src/index.ts` re-exports everything.
- `header.ts`, `tag-index.ts`, `open-map.ts` parse the 2048-byte cache header and the tag array. The virtual base address is inferred (tag array file offset vs. pointer), not hardcoded.
- `compression.ts` handles Chimera-style zstd compression (engine `0x861A0261`; header stays uncompressed) using the native `@mongodb-js/zstd`.
- `definitions/` is the data-driven tag schema engine. `groups/*.json` is generated from Invader's definition JSON by `scripts/generate-definitions.mjs`. Don't hand-edit it without updating `SOURCES.md`. `engine.ts` computes field offsets at runtime and throws if a struct's computed size differs from the declared `sizeBytes`. There is no per-tag hardcoded parsing.
- `dependency-walker.ts` computes dependency closures and emits typed warnings (`externalData`, `uncapturedData`, BSP, ...). Some kinds block injection. Any closure containing a `gbxmodel` is currently blocked, because model geometry isn't wired into the extractor/injector yet.
- `tag-extractor.ts` flattens tags into a self-contained `ExtractedTagSet` (appends reflexive/pointer data and rewrites pointers to local offsets). Fields marked `nonCached` are skipped.
- `container.ts` defines the `.ocetags` format (versioned JSON, currently v4; v1 to v3 still readable).
- `tag-injector.ts` plans and applies ADD/SWAP injection. Embedded (external=0) relocation sits behind `InjectionOptions.allowEmbeddedRelocation`, default false. **Keep it disabled in the app until the user approves.** `map-worker.ts` must never set it.
- `resource-map.ts` and `embedded-data-verifier.ts` handle bitmaps/sounds/loc map identity and embedded-data checks.
- `gbxmodel-geometry.ts` is Stage 1 (capture only, standalone). It is not wired into the extractor or injector.

**desktop/** is the Electron app:
- `electron/main.ts` owns all dialogs, file pickers, `settings.json`, recent maps, and the `ipcMain.handle` channels.
- `electron/map-worker.ts` is the single long-lived worker thread. It holds the open map in memory and does the heavy work. Main sends it small requests, never buffers.
- `electron/shared-types.ts` is the IPC contract. `preload.ts` exposes it as `window.opence`. Never expose `ipcRenderer`. Keep `contextIsolation` on and `nodeIntegration` off.
- The renderer (`src/`, React + Vite) imports core source directly. esbuild inlines core into `dist-electron`. `@mongodb-js/zstd` stays external and is unpacked from asar.
- `src/dev-mock.ts` mocks `window.opence` in a plain browser (DEV only). Select a scenario with `?mock=<name>`.

## Converter feature: Halo Demo / HaloMD -> Custom Edition

Goal: a GUI action (not a CLI) that converts demo-era maps into CE (609) maps. Full research is in `memory/demo-converter.md`. Rules:
- The converter is a separate module (for example `core/src/map/convert/`). Do **not** loosen the CE-only parser or its validators. A classifier detects the layout (CE 609, retail 7, true demo 6) and the editor still rejects non-CE maps.
- Never convert in place. Write to a temp file, then rename. Refuse to convert a map that is already 609.
- Phase 1 (retail-layout maps, version 7, base 0x40440000): a header-only patch plus CRC. Phase 2 (true demo layout, version 6, base 0x4BF10000) needs a schema-driven pointer rebase. Phase 2 only starts after Phase 1 is confirmed in OpenCE.
- The CRC algorithm from the notes may be reused for M6, but M6 still needs a decision on `tagFileChecksums`. Do not assume it is solved.
- Everything in the notes labelled "verified" means verified against this repo's validators and the 5 CE sample maps, not in the game.
- Pointer rebasing must be driven by the schema engine. Never scan for pointer-like values, because coincidental matches are common.

## Licensing

The definitions in `core/src/map/definitions/groups/` are derived from GPL-3.0 Invader/Reclaimer data, so the project is GPL-3.0 if distributed. Invader, Reclaimer, Chimera, and Mozzarilla are format references only. Don't copy their code, and cite sources in comments. The Halo Map Structure PDF (Snowy Mouse) is CC BY 3.0 and may be cited. Do not bundle or commit Bungie/Microsoft/HaloMD assets.