<p align="center">
  <img src="desktop/build/icon.png" width="160" height="160" alt="OpenCE Mantle Logo" />
</p>

<h1 align="center">OpenCE Mantle</h1>

<p align="center">
  <strong>A modern, all-in-one GUI desktop modding suite for Halo: Custom Edition (PC, v609) maps and <a href="https://github.com/OpenCommunityEdition/OpenCE">OpenCE</a>.</strong>
</p>

---

## Overview

**OpenCE Mantle** (formerly *OpenCE Modding Tool*) is a free, non-commercial desktop application built with Electron, React, Three.js, and a pure TypeScript map/tag engine (`core/`). It brings together capabilities that historically required juggling half a dozen separate legacy tools (*SparkEdit*, *HMT*, *HHT*, *Eschaton*, *Mozzarilla*, and *Refinery*) into a single cohesive, non-destructive workspace designed specifically for maps targeting **[OpenCE](https://github.com/OpenCommunityEdition/OpenCE)**.

With **OpenCE Mantle**, you can inspect and edit any Halo: Custom Edition (`v609`) `.map` cache file in memory, preview and manipulate 3D scenario placements and BSP geometry, extract and inject self-contained `.ocetags` tag packages with full dependency closures, convert legacy Halo PC Retail (`v7`), HaloMD (`v7`), and Halo Mac Demo (`v6`) maps to Custom Edition, transplant or combine Singleplayer BSPs into Multiplayer maps, edit bitmaps/sounds/HUD layouts directly, and launch or `<1s` hot-reload maps in OpenCE via a live TCP Control Deck.

> **GUI-First & Non-Destructive by Design:** All map modifications (tag edits, injections, scenario object transforms, BSP swaps, asset replacements) happen safely in memory inside a dedicated background worker thread. Source files on disk are never touched until you explicitly run **File > Save** (backed by an automatic `.map.bak` prompt and atomic temp-file-then-rename write) or **File > Save As**.

---

## Key Features

### 1. Tag Browser & Recursive Tag Field Editor
- **Fast Virtualized Tag Browser**: Browse thousands of tags grouped by Halo tag class (`bipd`, `weap`, `vehi`, `scnr`, `sbsp`, `bitm`, `snd!`, etc.) or by virtual folder hierarchy, with instant search filtering.
- **Schema-Driven Recursive Tag Editor**: Inspect and edit any tag structure up to reflexive depth `8` using runtime-validated Invader/Reclaimer tag schemas (`core/src/map/definitions/`). Supports scalars, bitmasks/flags, enums, color pickers, bounds, vectors, and adding/cloning reflexive chunks in memory.
- **HHT-Style Dependency Swapper & Reverse Lookup**: View and swap any outgoing tag reference (`TagDependency`) via searchable dropdowns, or switch to the **Referencing Tags** tab to see every tag in the map that points to the selected tag.
- **Tag Maintenance Utilities**: Edit `ustr` Unicode String Lists in place, rename tag paths across the map, or duplicate existing tags into independent copies.

### 2. Interactive 3D Scenario & Structure BSP Viewport (SparkEdit-Style)
- **Full 3D Map Rendering**: Renders textured `scenario_structure_bsp` lightmapped meshes, skies, and 3D `gbxmodel` placements in real time using Three.js.
- **Interactive Object Manipulation**: Select, translate, rotate, duplicate, swap, add, or delete Scenario placements (`Vehicles`, `Weapons`, `Scenery`, `Bipeds`, `Equipment`, `Netgame Flags`, `Netgame Equipment`, `Player Starting Locations`) with 3D gizmos (`TransformControls`) and automatic vertical raycast ground-snapping.
- **AI, Scripting & Trigger Overlays**: Visualize and edit AI Encounter Squads and `A–Z` Firing Positions, Trigger Volumes, Cutscene Camera Points, paired 2-way Teleporter (`mann`) links, KOTH hills, and toggle visibility across a 10-layer viewport toolbar.

### 3. 1-Click SP-to-MP & Multi-BSP Swapper / Combiner
- **Singleplayer-to-Multiplayer BSP Transplant**: Swap any Singleplayer or Multiplayer `scenario_structure_bsp` into a target Multiplayer map in a single guided workflow.
- **Multi-BSP Combiner**: Merge multiple contiguous Campaign BSPs (e.g., `b30a` + `b30b`) into a single unified Multiplayer Structure BSP with combined lightmap plates, stitched portal/cluster graphs, and unified 3D collision trees within Halo CE's `23 MiB` tag-buffer ceiling.
- **Automated Dependency & Object Harvesting**: Automatically harvests required shaders, lightmaps, weather particles, skyboxes, lens flares, and optionally imports campaign Scenery and functional Doors/Bridges (`mach`) while relocating MP spawn points onto valid floor surfaces.

### 4. Dependency Walker, `.ocetags` Extraction & In-Memory Injection
- **Complete Dependency Closure Walking**: Select one or more tags to recursively trace their dependency graph and preview embedded vs. external resource requirements.
- **Portable `.ocetags` Containers & Whole-Map Batch Extraction**: Extract individual tag closures or batch-extract an entire map into a clean directory hierarchy with a detailed manifest and extraction report.
- **ADD & SWAP Tag Injection**: Inject `.ocetags` packages into any open map in memory—either adding new tags (`ADD` mode) or replacing existing tags (`SWAP` mode)—with automatic pointer rebasing and resource internalization.

### 5. Multi-Edition Map Converter & Resource Map Identifier
- **Convert Retail (`v7`), HaloMD (`v7`), and Mac Demo (`v6`) Maps to Custom Edition (`v609`)**: Includes a read-only pre-flight diagnostic checker, schema-driven pointer rebasing (for `v6` Demo maps with base `0x4BF10000`), and automatic internalization of external bitmap/sound ranges into the map's raw data region.
- **Multi-Version `bitmaps.map` / `sounds.map` Identifier**: Fingerprint and configure resource maps across Halo Custom Edition, Halo PC Retail, HaloMD, Halo Mac Demo, and Halo MCC.
- **Chimera Zstd Compression**: Decompress and recompress Chimera-compressed (`0x861A0261`) Custom Edition maps using `@mongodb-js/zstd`.

### 6. Built-In Asset Editors & 3D Exporters
- **Bitmap Editor (`bitm`)**: Preview all mipmaps, cubemap faces, and sprite plates; export textures to `.png` or `.dds`; and import replacement `.png`/`.dds` images with DXT1/DXT3/DXT5/A8R8G8B8 encoding.
- **Sound Auditor (`snd!`)**: Play back pitch ranges and permutations in the app via Web Audio (supporting Xbox ADPCM and 16-bit PCM), export `.wav` files, or replace sound permutations from `.wav`.
- **WYSIWYG 2D HUD Previewer (`hudg`, `wphi`, `grhi`)**: Interactive canvas preview of weapon reticles, ammo meters, shield bars, and motion sensor anchors.
- **Curve Graph Visualizer**: Real-time plotting for Halo's 12 mathematical function types (`Periodic`, `Transition`, `Spark`, `Sawtooth`, etc.).
- **3D Model & BSP Exporter**: Export any `gbxmodel` (`mod2`) or `scenario_structure_bsp` (`sbsp`) directly to binary glTF 2.0 (`.glb`) or Wavefront (`.obj` + `.mtl`).

### 7. Live OpenCE Tag Test Runner & `<1s` Hot-Reload Control Deck
- **1-Click Launch in OpenCE (`F5`)**: Launch the currently open map directly in OpenCE (`halo.exe -window -devmode -console`).
- **Live TCP Control Deck (`127.0.0.1:2323`)**: Toggle developer cheats (`deathless_player`, `infinite_ammo`, `bump_possession`, `medusa`), wireframe/collision/portal debug overlays, AI state inspection, game speed sliders (`0.0x`–`5.0x`), and `<1s` in-place map hot-reloading (`map_name <scenario>`) without restarting the game.

---

## Project Layout

```text
core/      Pure TypeScript map/tag library (no Electron/React/DOM). Unit tested with Vitest.
desktop/   Electron main process + worker thread + preload + React (Vite) renderer GUI.
memory/    PRD.md (milestone status + approved decisions) and RULES.md (standing dev rules).
```

---

## Installation

Requires **Node.js 22 LTS** (`>=20 <23`) and **Yarn 1**.

```bash
cd core && yarn install
cd ../desktop && yarn install
```

## Running in Development

```bash
cd desktop
yarn dev:renderer               # terminal 1: Vite dev server (renderer UI on http://localhost:5173)
yarn dev:electron               # terminal 2: compiles main/preload/worker and launches Electron
```

The Electron window loads the Vite dev server in development with hot-reload. The desktop app imports `core/src` directly, so no separate `core` build step is required.

To preview the UI in a standard browser without Electron, open `http://localhost:5173` while `yarn dev:renderer` is running (`?mock=<scenario>` selects a mock fixture from `desktop/src/test-fixtures/dependency-fixtures.ts`).

## Testing

```bash
cd core && yarn test            # Vitest: header/index parsing, compression, definitions,
                                # dependency walker, extraction, injection, converter, exporters
cd desktop && yarn test         # Vitest (jsdom): renderer components + Electron worker/main flows
cd desktop && yarn typecheck    # TypeScript type-checking across Electron and Renderer
```

## Building & Packaging for Windows

```bash
cd desktop
yarn build                      # builds renderer (dist/) and bundles Electron (dist-electron/)
yarn dist:win                   # packages portable .exe + NSIS installer into desktop/release/
# or, for just the portable .exe:
yarn dist:win:portable
```

Output executables are generated in `desktop/release/`.

---

## Licensing & Attribution

Invader, Reclaimer, Refinery, Mozzarilla, supyr_struct, and Chimera (all GPL-licensed) were used strictly as **format references** while writing `core`'s struct parsers (see citations in code comments and [`core/README.md`](core/README.md)). No Bungie or Microsoft assets are bundled; **OpenCE Mantle** operates exclusively on map files you supply yourself.

The tag definition schemas in `core/src/map/definitions/groups/*.json` are generated by `core/scripts/generate-definitions.mjs` from Invader's tag definition JSON (and `ui_widget_collection` from Reclaimer), both licensed under **GPL-3.0-only** (see `core/src/map/definitions/SOURCES.md`). Under GPL-3.0's derivative work provisions, distributing this project places the combined distribution under **GPL-3.0**.
