# Volume 06 — Project Guilty Spark Analysis & Concrete Improvements for OpenCE Mantle

> **Reference Repository**: [`SAMPLE CODE/Guilty Spark/`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/SUMMARY.md) (`Project Guilty Spark v0.3.1 — Continuation 32`)
> **Target Application**: **OpenCE Mantle** (`C:\Users\LeviB\Projects\OpenCE-Mantle`)

---

## 1. Architectural Contrast: OpenCE Mantle vs. Project Guilty Spark

**OpenCE Mantle** and **Project Guilty Spark** approach Halo modding from two complementary directions:
- **Where OpenCE Mantle is already stronger**:
  - **Direct Binary Cache Mutation & Expansion**: Full read/write `.map` parsing (`core/parser.py`), heuristic plugin-free tag expansion & map rebuilding (Eschaton/HHT style), `.xml`/`.ent`/`.inv` full plugin-driven meta editing across all 83 Halo 1 tag classes, full `mod2` skeletal/permutation rendering, full `sbsp` lightmap/cluster/portal rendering, and direct binary dependency/lone-ID swapping.
- **Where Project Guilty Spark excels and what it adds to OpenCE Mantle**:
  - **From-Scratch Level / BSP Authoring (`QuickForge`)**: Parametric brushes, sculptable heightfield terrain, hollow cave tunnels with exact rim-weld seam analysis, pre-compiler mesh topology & T-junction auditing, and direct **JMS 8200** export.
  - **3D Compiler Error Triage (`.wrl` VRML 1.0 + `tool.exe` Log Classifier)**: Parsing Halo `tool.exe` `.wrl` files into 3D error overlays, matching `.wrl` errors back to specific source brushes, and classifying 24 `tool.exe` error families.
  - **First-Person Collision Walk Sandbox**: Walking around uncompiled source geometry in the 3D viewport using Ericson's closest-point-on-triangle 3-sphere player solver (`liveCollision.ts`).
  - **Multiplayer Gametype & Spawn Safety Auditor**: Detecting Halo 1's notorious **2-marker King of the Hill crash**, **CTF enemy-side spawn disabling**, Oddball/Race sequence gaps, and KOTH convex-hull visualization.
  - **Creator Studio & HaloScript (`.hsc`) Generators**: Visual mission beat editor, cinematic camera shot list, deterministic Firefight wave simulator, and `.hsc` + dedicated server `init.txt` code generation.
  - **Transactional MCC `ModManifest.txt` & Steam Library Integration**: Automatic `libraryfolders.vdf` discovery, UTF-16LE/UTF-8 BOM-preserving `ModManifest.txt` registration with lockfile + rollback, and Excession mod packaging.
  - **Semantic Map Diffing & Cross-Map Tag Migration Preview**: Comparing two maps by normalized `class:path` semantics (`compare.ts`) and previewing tag transplants (`tagMigrationReview.ts`) before modifying a single byte.

---

## 2. Top 12 Concrete Features & Algorithms We Can Adapt into OpenCE Mantle

### 2.1 `.wrl` (VRML 1.0) 3D Error Overlay & `tool.exe` Diagnostic Triage
- **Guilty Spark Sources**:
  - [`src/haloWrl.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/haloWrl.ts) (`parseHaloWrl`)
  - [`src/haloWrlSourceMatch.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/haloWrlSourceMatch.ts) (`matchWrlToSourceBrushes`)
  - [`src/haloToolDiagnostics.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/haloToolDiagnostics.ts) (`analyzeHaloToolLog`)
  - [`src/haloCompilerTriage.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/haloCompilerTriage.ts) (`makeCompilerTriageReport`)
- **What It Does**:
  - When `tool.exe structure` fails on a BSP (open edges, non-manifold edges, z-buffered overlapping triangles, degenerate lightmap UVs, portal leaks), it writes `<map>.wrl` in `#VRML 1.0 ascii` format using centimetre coordinates (`100x` Halo world units).
  - `parseHaloWrl` parses every `Separator` region, `Coordinate3`, `MaterialBinding` (`PER_VERTEX` vs `PER_FACE`), `Material.diffuseColor`, `IndexedLineSet`, and `IndexedFaceSet`, scales by `0.01`, and renders the red/yellow/magenta error edges and faces directly inside the Three.js 3D viewport!
  - `analyzeHaloToolLog` classifies `debug.txt` / `tool.exe` stdout into 24 actionable error codes (`OPEN_EDGE`, `NON_MANIFOLD`, `INTERSECTING_FACES`, `RADIOSITY_UVS`, `DEGENERATE`, `COPLANAR`, `PORTAL`, `BSP_DEPTH`, `BSP_DIVIDING_EDGE`, `PHANTOM_COLLISION`, `T_JUNCTION`, `SKY_CLUSTER`, `CLUSTER_COMPLEXITY`, etc.) and tells the user whether a `.wrl` overlay applies.
- **How to Adapt to OpenCE Mantle**:
  - Port `haloWrl.ts` and `haloToolDiagnostics.ts` directly into `frontend/src/utils/` and add a **"Load .WRL Error Overlay"** toggle in our Three.js `Viewport3D.tsx` alongside a **Compiler Triage Drawer** that click-focuses the 3D camera onto each `.wrl` error region (`Separator`).

---

### 2.2 Quantized-Coordinate BSP Mesh Integrity & T-Junction Scanner
- **Guilty Spark Source**: [`src/haloMeshIntegrity.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/haloMeshIntegrity.ts) (`auditQuickForgeMesh`)
- **What It Does**:
  - Flat-shaded or split-UV meshes have disjoint vertex indices even along shared geometric edges. `auditQuickForgeMesh` quantizes vertex coordinates (`Math.round(v * 1e6)`) to build a pure geometric edge graph and runs Union-Find over triangles to detect:
    1. **Duplicate faces** (same sorted vertex key triplet)
    2. **Degenerate zero-area triangles** (`|AB × AC| <= 1e-10`)
    3. **Short edges** (`< 0.001` world units = `0.1 cm` in JMS)
    4. **Open boundary edges** (`edge.count === 1`)
    5. **Non-manifold edges** (`edge.count > 2` faces sharing one edge)
    6. **Winding conflicts** (`edge.count === 2` but `directionSum !== 0`, meaning adjacent triangles have opposite normals)
    7. **T-Junctions** (`tJunctionEdges`): Uses axis-sorted binary search (`lowerBound` along each edge's dominant axis) to find any vertex `P` lying strictly in the interior of another edge `AB` within `5e-6` world units.
- **How to Adapt to OpenCE Mantle**:
  - Integrate `auditQuickForgeMesh` into Mantle's BSP Import / Replacement (`replaceSBSP`) and JMS Export preflight so users get instant visual highlighting of open edges, non-manifold edges, flipped normals, and T-junctions *before* running `tool.exe` or injecting a collision BSP.

---

### 2.3 QuickForge In-App Level Builder, Terrain Sculptor, Cave Seam Welder & JMS 8200 Exporter
- **Guilty Spark Sources**:
  - [`crates/spark-core/src/quickforge.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/crates/spark-core/src/quickforge.rs) (`ForgeBrush`, `BrushKind`, `export_sources`, JMS 8200 generator)
  - [`crates/spark-core/src/forge_build.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/crates/spark-core/src/forge_build.rs) (`audit_material_bindings`, `halo_tool_prefix`)
  - [`src/terrain.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/terrain.ts) (`sculptTerrain`), [`src/terrainJoinAnalysis.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/terrainJoinAnalysis.ts)
  - [`src/caveJoinAnalysis.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/caveJoinAnalysis.ts) (`analyzeCaveJoins`), [`src/caveSeamRepair.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/caveSeamRepair.ts) (`planCaveSeamSnap`, `auditCaveExtensions`)
- **What It Does**:
  - Lets users block out playable Halo 1 levels directly inside the app without needing Blender/3ds Max:
    - Sealed hollow `Room` shells, `Box`, `Wall`, `Floor`, `Ramp`, `Stairs`, `Platform`, sculptable `(steps + 1)^2` `Terrain` heightfields (`raise`, `lower`, `flatten`, `smooth`), and hollow manifold `CaveTunnel` brushes.
    - **Cave Seam Snap & Rim Verification**: Checks both outer (`1.0`) and inner (`0.75`) polygon rings of two opposing tunnel mouths and snaps them into an exact water-tight weld without breaking existing welds.
    - **Ambiguous Shader Basename Audit (`audit_material_bindings`)**: Blocks compilation if a JMS material name resolves to zero or multiple `.shader_*` files in `tags/` (catching one of the most common `tool.exe` gotchas).
- **How to Adapt to OpenCE Mantle**:
  - Add a **Level Blockout / QuickForge Mode** to Mantle's 3D Viewport that exports directly to `JMS 8200` and invokes `tool.exe` / `invader-build` (or converts the generated brush/terrain mesh directly into a `sbsp` structure for fast prototyping).

---

### 2.4 Live First-Person Collision Walk Sandbox in the 3D Viewport
- **Guilty Spark Source**: [`src/liveCollision.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/liveCollision.ts) (`createSourceCollisionWorld`, `resolveSourceBody`, `stepSourceWalk`)
- **What It Does**:
  - Builds a bounded `4.0`-world-unit 3D spatial hash grid over the level's triangles and runs Christer Ericson's closest-point-on-triangle solver against a 3-sphere player capsule approximation (`RADIUS = 0.32`, `BODY_OFFSETS = [0.34, 0.91, 1.43]`, `WALK_EYE_HEIGHT = 1.62`) with sub-stepped gravity (`dt / steps`) to prevent tunneling.
- **How to Adapt to OpenCE Mantle**:
  - Right now, Mantle's 3D viewport has free-fly camera navigation. By dropping `liveCollision.ts` (140 lines of zero-dependency TypeScript) into `frontend/src/components/Viewport3D/`, we can add a **"Walk Map (Spartan Gravity Mode)"** toggle that lets modders physically walk on the `sbsp` collision mesh, test ramp steepness, check doorway clearances, and verify crouch/jump heights right inside the editor!

---

### 2.5 Multiplayer Gametype Validator, KOTH Convex-Hull Overlay & Spawn Auditor
- **Guilty Spark Sources**:
  - [`src/haloGametypeScenario.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/haloGametypeScenario.ts)
  - [`src/multiplayerSpawnAudit.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/multiplayerSpawnAudit.ts) (`auditMultiplayerSpawns`)
  - [`src/kothHull.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/kothHull.ts)
  - [`docs/BLAM_H1_MULTIPLAYER_SCENARIO_FIELD_GUIDE.md`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/docs/BLAM_H1_MULTIPLAYER_SCENARIO_FIELD_GUIDE.md)
- **What It Does**:
  - Audits `scnr` player starting locations and `netgame_flags` for subtle engine-level bugs that crash Halo or silently break multiplayer modes:
    1. **The 2-Marker King of the Hill Crash**: In Halo 1, a `hill_flag` group (`usage_id`) with `1` marker creates a 2×2-unit hill, and `3..8` markers create a convex polygon hill — **but exactly `2` markers in the same hill group crashes Halo 1 with an exception!**
    2. **CTF Enemy-Side Spawn Disabling (`CTF_START_ENEMY_SIDE`)**: In Halo 1 CTF, the engine automatically disables any Red team spawn that is geometrically closer to the Blue flag than the Red flag (and vice versa), which can leave a team permanently stuck on "Waiting for space to clear".
    3. **Oddball & Race Sequential IDs**: Verifies that Oddball ball spawns (`0..15`) and Race track checkpoints (`0..31`) have unique, gapless sequential `usage_id`s.
    4. **Paired Teleporters & KOTH Translucent Hull Preview**: Renders the 2D convex hull of each KOTH hill group (`kothHull.ts`) and links `teleport_from` → `teleport_to` channel pairs in the 3D viewport.
- **How to Adapt to OpenCE Mantle**:
  - Add **Multiplayer Scenario Audit & KOTH Hull Visualization** to Mantle's `scnr` Scenario Editor (`Viewport3D`), automatically warning modders whenever they place a 2-point KOTH hill, invert CTF spawn distances, or break Race/Oddball numbering.

---

### 2.6 Creator Studio: Visual HaloScript (`.hsc`) Mission, Cutscene & Firefight Generator
- **Guilty Spark Sources**:
  - [`src/creatorStudio.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/creatorStudio.ts) (`CreatorStudioDocument`, `exportHaloCeServerInit`)
  - [`src/haloScript.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/haloScript.ts) (`exportHaloCeMission`, `exportHaloCeCinematic`, `exportHaloCeFirefight`)
  - [`crates/spark-core/src/firefight.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/crates/spark-core/src/firefight.rs) (deterministic offline wave simulator)
- **What It Does**:
  - Provides a structured visual editor for:
    - **Mission Beats**: Manual triggers, timers, `volume_test_objects` trigger volumes, and `ai_place` + guarded `ai_living_count` encounter waves (using the two-step `(sleep_until (> (ai_living_count enc) 0) 15)` followed by `(sleep_until (= (ai_living_count enc) 0) 15)` pattern so unspawned squads don't prematurely complete an objective).
    - **Cinematic Camera Shots**: Sequences `cutscene_camera_point` markers with duration in ms (converted to 30 Hz Halo ticks via `Math.round(ms * 30 / 1000)`), letterbox toggles, and camera control.
    - **Firefight Wave Scripts & Simulation**: Simulates wave progression offline (`firefight.rs`) and exports conservative `.hsc` wave scripts (`exportHaloCeFirefight`).
    - **Dedicated Server `init.txt` Generator**: Exports validated `sv_name`, `sv_maxplayers`, `sv_public`, and `sv_mapcycle_add` scripts.
- **How to Adapt to OpenCE Mantle**:
  - Combine Guilty Spark's `haloScript.ts` generator with Mantle's planned **3D UI.map & Cutscene Studio** (from Volume 04) so clicking "Capture Camera Keyframe" in Mantle's 3D viewport both writes the `cutscene_camera_point` reflexive into the `.map`/`scnr` *and* generates the ready-to-compile `gs_cinematic.hsc` script!

---

### 2.7 Semantic Map Comparison (`compare.ts`)
- **Guilty Spark Source**: [`src/compare.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/compare.ts) (`compareProjects`)
- **What It Does**:
  - Compares two Halo maps **semantically** rather than by raw binary byte offsets or memory pointers (which shift whenever a map is rebuilt or expanded):
    - Matches tags by normalized `class:path` identity (`tagIdentity`).
    - Diffs tag inventory (`added`, `removed`, `ambiguous`), storage (`Embedded` vs `External` resource map), decoded field values, resolved tag references (comparing target `class:path` rather than raw datum IDs!), scenario placements, AI encounters/squads, scripts, and BSP collision geometry counts.
- **How to Adapt to OpenCE Mantle**:
  - Add a **"Compare Maps (Semantic Diff)"** tool to Mantle that lets a modder open two `.map` files (e.g., stock `bloodgulch.map` vs. a modded `bloodgulch.map`, or two versions of their own mod) and see every added/removed tag, changed weapon/vehicle/biped stat, swapped dependency, and moved spawn/scenery placement in a filterable diff table.

---

### 2.8 Pre-Flight Cross-Map Tag Migration & Lineage Inspector
- **Guilty Spark Sources**:
  - [`src/tagMigrationReview.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/tagMigrationReview.ts) (`reviewTagMigration`)
  - [`src/tagLineage.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/tagLineage.ts)
  - [`crates/spark-core/src/tag_exchange.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/crates/spark-core/src/tag_exchange.rs)
- **What It Does**:
  - Before transplanting tags from Map A to Map B, `reviewTagMigration` dry-runs the dependency graph against Map B's tag index and classifies every selected tag and dependency into:
    - `present-in-target` (already exists with matching `class:path`)
    - `in-selected-source` (included in the transplant bundle)
    - `missing-from-target` (needs recursive extraction/import)
    - `class-conflict` (Map B already uses that exact path for a *different* tag fourCC class!)
    - `inconsistent-source-reference` (internal corruption in Map A where a reference's fourCC disagrees with the target datum's index entry)
- **How to Adapt to OpenCE Mantle**:
  - Integrate this pre-flight conflict matrix into Mantle's **Tag Import / Recursive Tag Pack / Eschaton `expandMap`** workflow so users can preview every tag that will be added, reused, or conflict before committing a map rebuild.

---

### 2.9 Steam `libraryfolders.vdf` Discovery & Transactional MCC `ModManifest.txt` Deployment
- **Guilty Spark Sources**:
  - [`crates/spark-core/src/steam.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/crates/spark-core/src/steam.rs)
  - [`crates/spark-core/src/mcc.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/crates/spark-core/src/mcc.rs) (`register_root`, `decode_manifest`, `package_map_name`)
- **What It Does**:
  - Automatically finds Steam MCC installations across all drives via `libraryfolders.vdf`.
  - Safely registers/unregisters custom mod directories in `%LocalAppData%\..\LocalLow\MCC\Config\ModManifest.txt` while preserving **UTF-16LE BOM vs. UTF-8 BOM**, preserving `CRLF` vs. `LF`, using an exclusive lockfile, verifying readback bytes, and staging Excession-compatible MCC mod packages (`ModInfo.json`, `CampaignInfo.json`, `MultiplayerInfo.json`).
  - Handles the subtle MCC quirk (`package_map_name`): MCC resolves a metadata scenario path to its **scenario basename** in `maps/`, which may differ from the internal 32-byte cache header name!
- **How to Adapt to OpenCE Mantle**:
  - Port `steam.rs` and `mcc.rs` into Mantle's Python backend (`backend/services/mcc_deployer.py`) for **One-Click "Deploy & Register in MCC"** from Mantle.

---

### 2.10 Multi-Runtime Profile & Multiplayer Preflight System
- **Guilty Spark Sources**:
  - [`crates/spark-core/src/runtime.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/crates/spark-core/src/runtime.rs) (10 `RuntimeId` profiles)
  - [`crates/spark-core/src/multiplayer.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/crates/spark-core/src/multiplayer.rs) (peer manifest preflight comparison)
  - [`crates/spark-core/src/maps.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/crates/spark-core/src/maps.rs) (`parse_header` supporting `v5`, `v6` Demo reordered header, `v7` + `legacy_tag_size_repair`, `v13` MCC, `v609` CE, and `yelo` detection)
- **What It Does**:
  - Supports **10 Halo 1 runtime profiles** (including **OpenCE**, **ChupathingyCE**, **MCC Steam**, **Halo Custom Edition**, **Halo PC Retail**, **HaloMD**, **Halo Demo/Trial**, and **Halo Xbox**).
  - Includes `legacy_tag_size_repair` in `maps.rs` (lines 88–95) to transparently handle historical Demo-to-PC/Pearl converted maps where `tag_size == declared_size` instead of `declared_size - tag_offset`.
  - Generates privacy-safe JSON peer manifests (`multiplayer.rs`) so friends can verify before launching a lobby that their runtime build, map SHA-256, `bitmaps.map`/`sounds.map`/`loc.map` hashes, and gametype settings match 100%.
- **How to Adapt to OpenCE Mantle**:
  - Add `legacy_tag_size_repair` and `yelo`/`oley` detection to `core/parser.py`, and add a **Runtime Profiles & Co-op/Multiplayer Preflight Check** panel in Mantle.

---

### 2.11 Interface Studio: Live Halo Theme & Local Tag Audio/Bitmap Personalization
- **Guilty Spark Sources**:
  - [`src/components/InterfaceStudio.tsx`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/components/InterfaceStudio.tsx)
  - [`src/interfacePreferences.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/interfacePreferences.ts), [`src/uiCuePlayer.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/uiCuePlayer.ts)
- **What It Does**:
  - Lets users switch between 4 Halo-inspired color palettes (`Halo CE Classic`, `UNSC / MJOLNIR`, `Covenant Plasma`, `Guilty Spark / Forerunner`) and optionally bind UI navigation/confirm/warning sound cues and header banner art to real `snd!` and `bitm` tags decoded on the fly from their own loaded Halo maps.
- **How to Adapt to OpenCE Mantle**:
  - Add theme switching and optional `snd!` UI audio feedback to Mantle's settings modal.

---

### 2.12 Built-In Modding Academy, Contextual Field Guide & `Ctrl+K` Intent Palette
- **Guilty Spark Sources**:
  - [`src/tutorialAcademy.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/tutorialAcademy.ts), [`src/components/Academy.tsx`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/components/Academy.tsx)
  - [`src/workbenchGuide.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/workbenchGuide.ts), [`src/components/WorkbenchGuide.tsx`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/components/WorkbenchGuide.tsx)
  - [`src/workspaceFinder.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/workspaceFinder.ts), [`src/components/WorkspaceFinder.tsx`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/components/WorkspaceFinder.tsx)
  - [`src/legacyWorkflowLab.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Guilty%20Spark/src/legacyWorkflowLab.ts)
- **What It Does**:
  - Embeds interactive step-by-step modding lessons, a per-workspace contextual **Field Guide** drawer explaining Blam! engine rules right next to the active tool, a **Legacy Workflow Lab** that maps old HMT/HHT/Eschaton/SparkEdit workflows to modern equivalents, and a `Ctrl+K` command/intent finder.
- **How to Adapt to OpenCE Mantle**:
  - Combine Guilty Spark's `WorkbenchGuide` + `Ctrl+K` intent palette with our 6-volume `docs/reference/` knowledge base so modders can press `Ctrl+K` anywhere in Mantle (e.g., *"How do I make a door?"*, *"Why did KOTH crash?"*, *"Fix open edge WRL"*) and jump straight to the wizard or contextual guide.

---

## 3. Prioritized Implementation Roadmap for OpenCE Mantle

| Priority | Feature to Port / Adapt from Guilty Spark | Target Location in OpenCE Mantle | Effort |
|---|---|---|---|
| **P0** | **`.wrl` (VRML 1.0) 3D Error Overlay & `tool.exe` Log Classifier** (`haloWrl.ts`, `haloToolDiagnostics.ts`) | `frontend/src/utils/haloWrl.ts`, `Viewport3D.tsx` | Low (Direct TS port) |
| **P0** | **First-Person Collision Walk Sandbox in 3D Viewport** (`liveCollision.ts`) | `frontend/src/utils/liveCollision.ts`, `Viewport3D.tsx` | Low (140 LOC TS port) |
| **P0** | **Multiplayer Scenario & Spawn Auditor + KOTH Hull Overlay** (`multiplayerSpawnAudit.ts`, `kothHull.ts`) | `frontend/src/utils/spawnAudit.ts`, `Viewport3D.tsx` | Low–Med (Direct TS port) |
| **P1** | **Quantized Mesh Integrity & T-Junction Scanner** (`haloMeshIntegrity.ts`) | `frontend/src/utils/meshIntegrity.ts` + `core/bsp_validator.py` | Low (Direct TS/Py port) |
| **P1** | **Semantic Map Comparison & Cross-Map Tag Migration Preview** (`compare.ts`, `tagMigrationReview.ts`) | `backend/services/map_compare.py`, `frontend/src/components/MapCompare/` | Medium |
| **P1** | **HaloScript (`.hsc`) Mission, Cutscene & Firefight Generator** (`haloScript.ts`, `creatorStudio.ts`) | `frontend/src/utils/haloScript.ts`, Cutscene/Script Studio | Low–Med (Direct TS port) |
| **P1** | **Demo-to-PC `legacy_tag_size_repair` & `yelo` Header Detection** (`maps.rs`) | `core/parser.py` | Very Low (~15 lines) |
| **P2** | **Steam `libraryfolders.vdf` Discovery & Transactional MCC `ModManifest.txt` Deployer** (`steam.rs`, `mcc.rs`) | `backend/services/mcc_deployer.py` | Medium |
| **P2** | **QuickForge Parametric Brush, Terrain Heightfield, Cave Seam Welder & JMS 8200 Exporter** (`quickforge.rs`, `terrain.ts`, `caveSeamRepair.ts`) | `backend/services/quickforge.py`, `frontend/src/components/QuickForge/` | Medium–High |
| **P3** | **Contextual Field Guide Drawer, `Ctrl+K` Intent Finder & Interface Studio Themes** (`WorkbenchGuide.tsx`, `WorkspaceFinder.tsx`, `InterfaceStudio.tsx`) | `frontend/src/components/` | Low–Med |
