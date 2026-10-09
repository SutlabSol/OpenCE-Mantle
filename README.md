# OpenCE Modding Tool

A free, non-commercial GUI desktop tool for modding Halo: Custom Edition (PC, map header
version `609`) maps — open a map, decompress/recompress it, browse its tags, and (in later
milestones) extract/inject tags and export a valid `.map`. Built for maps intended to run on
[OpenCE](https://github.com/OpenCommunityEdition/OpenCE), which loads standard Custom
Edition caches directly.

**This is a GUI-only app. There is no command-line interface for end users.**

## Project layout

```
core/      Pure TypeScript map/tag library (no Electron/React/DOM). Unit tested with Vitest.
desktop/   Electron main process + preload + React (Vite) renderer - the actual GUI app.
           (Named "desktop" instead of the brief's literal "/app" to avoid colliding with
           this sandbox's own root path - see /app/memory/PRD.md.)
```

## Install

Requires Node.js 18+ and Yarn.

```bash
cd core && yarn install
cd ../desktop && yarn install
```

## Run in development

```bash
cd core && yarn build          # core must be built once before the desktop app can import it
cd ../desktop
yarn dev:renderer               # terminal 1: Vite dev server (renderer UI on http://localhost:5173)
yarn dev:electron               # terminal 2: compiles main/preload/worker and launches Electron
```

The Electron window loads the Vite dev server in development, so renderer edits hot-reload.

## Test

```bash
cd core && yarn test            # 29 Vitest tests: header, tag index, FourCC, compression,
                                 # and real-map round-trip tests (auto-skipped if
                                 # /app/sample_maps isn't present)
cd core && yarn inspect-map /path/to/some.map   # developer-only CLI, not part of the shipped app
```

## Build (all platforms, produces unpackaged app)

```bash
cd desktop
yarn build                      # builds the renderer (dist/) and bundles Electron main/preload/worker
                                 # (dist-electron/) via esbuild, inlining core/src directly -
                                 # no separate core build step needed
```

## Package a Windows build

This sandbox is a headless Linux container with no Windows and no display, so a tested
Windows `.exe` cannot be produced here. Run these commands **on your own Windows machine**
(or Linux/macOS with Wine installed, for cross-building):

```bash
cd core && yarn install && yarn build
cd ../desktop && yarn install
yarn dist:win            # portable .exe + NSIS installer
# or, for just the portable exe:
yarn dist:win:portable
```

Output lands wherever electron-builder places it (default: `desktop/dist/`, alongside the
Vite renderer output - add `"directories": { "output": "release" }` under the `build` key in
`desktop/package.json` if you'd rather it go to a separate folder).

**Native module note**: map decompression uses `@mongodb-js/zstd` (a native Node addon).
`electron-builder` rebuilds native modules for Electron's own Node ABI automatically on
`yarn dist:win`. If that step fails on your machine, install the
[Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
("Desktop development with C++" workload) and retry.

## Scope

- **In scope**: Halo: Custom Edition PC maps only (header version `609`).
- **Out of scope**: Xbox maps, retail PC (version 7), Anniversary/MCC. Opening one of these
  shows a clear "unsupported map version" dialog instead of attempting to parse it.
- Target runtime for the maps this tool produces/edits: **OpenCE**
  ([OpenCommunityEdition/OpenCE](https://github.com/OpenCommunityEdition/OpenCE)), which
  loads standard, uncompressed Custom Edition caches - Chimera-style zstd compression
  (implemented in `core` for completeness) is a nice-to-have, not required for OpenCE.

## Licensing note

Invader, Reclaimer, Refinery, Mozzarilla, supyr_struct, and Chimera (all GPL-licensed) were
used strictly as **format references** while writing `core`'s struct parsers - see citations
in code comments and `core/README.md`. No code was copied from them, and no Bungie/Microsoft
assets are bundled. This tool only operates on map files you supply yourself.

## Milestone status

See `/app/memory/PRD.md` for the full progress log. As of this writing: M1 (header/tag index
parsing) and M2 (decompress/recompress) are done and tested against real maps; M3 (this GUI
shell) is done. M4 (dependency walker + extract), M5 (inject), and M6 (export + CRC) are not
yet implemented - their menu items are present but show a "coming in a later milestone" log
message rather than silently doing nothing.
