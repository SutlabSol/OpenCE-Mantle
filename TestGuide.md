# OpenCE Mantle — Master Feature & Testing Guide

This master guide links to the dedicated, step-by-step feature walkthroughs in [`docs/guides/`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/docs/guides) and provides quick verification checklists for every upgraded feature.

---

## Dedicated Per-Feature Guides (`docs/guides/`)

1. **[Guide 1: Custom 3D Model Injection, Face Counter & 3 UV Unwrap Modes](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/docs/guides/01-Model-Injection-Collision-and-UV-Unwrapping.md)**
   - Prominent **Faces / Triangles | Vertices | Collision Surfaces** badge in Step 2 of `Build Custom 3D Object Tag (.obj)...`
   - 3 UV Unwrap modes:
     - **`Per-Triangle Grid (Every Triangle Separated in Order)`**: Places every triangle (`#1..#N`) into its own isolated, non-overlapping grid cell in sequential face order.
     - **`Smart Angle Unwrap (Connected Coplanar Islands)`**: Groups connected triangles within `42°` into planar UV islands and packs them without stretching.
     - **`6-Side Box Unfold (+X, -X, +Y, -Y, +Z, -Z)`**: Classic 3×2 directional box unfold.
   - Blender-parity 1:1 / QEM Decimated / 2-Sided Concave Collision BSP compiler.

2. **[Guide 2: HaloScript (`.hsc`), Pelican Vehicle Drops, `b30.map` Biped Injection & Scenario Object Names](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/docs/guides/02-HaloScript-Pelican-Dropships-and-Object-Names.md)**
   - Why `whatitistobe_copy.map` previously failed and how `sample_maps\latest test\whatitistobe_copy.map` was repaired.
   - Extracting & injecting `characters\grunt\grunt`, `characters\elite\elite`, and `vehicles\pelican\pelican` from `b30.map` (with the 72-byte Xbox DXT1 padding fix).
   - Naming placed vehicles via the **`vehicles[i].name`** → **`object names`** dropdown (with automatic runtime `object_type` and `object_index` synchronization).
   - Ready-to-paste Singleplayer & Multiplayer HaloScript templates for Pelican Warthog cargo drops, Covenant dropships, and AI wave encounters.

3. **[Guide 3: Tag Editor Group/Field Descriptions, Cross-Reflexive Dropdowns & JSON Clipboard](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/docs/guides/03-Tag-Editor-Cross-Reflexives-and-JSON-Clipboard.md)**
   - What Tag Class Overview banners and inline field descriptions do.
   - How Cross-Reflexive Dropdowns automatically link `vehicles[i].name` → `object names` and `vehicles[i].type` → `vehicle palette`.
   - How to copy and paste entire reflexive blocks (`seats`, `triggers`, `camera points`, `encounters`) as JSON.

4. **[Guide 4: Universal Tag Class Converter & Driving a Scenery Boulder (`scen` → `vehi`)](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/docs/guides/04-Universal-Tag-Class-Converter-Boulder-to-Vehicle.md)**
   - Detailed breakdown of use cases for `coll → mod2`, `sbsp → scen`, `11-Class Object ↔ Object Converter`, and `.JMS → .OBJ`.
   - Complete walkthrough for converting a Scenery Boulder (`scenery\boulders\boulder_large\boulder_large`) into a driveable `vehicle` (`vehi`) that automatically inherits Warthog seats, entry markers, physics (`phys`), and animation node hierarchy while keeping its 3D boulder model and collision!

5. **[Guide 5: Exporting OpenCE Forge Packages (`.ocetags`) & Authentic Halo CE HUD Previewer](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/docs/guides/05-OpenCE-Forge-Package-Export-and-HUD-Previewer.md)**
   - How to export custom weapon skins, custom 3D models, and modified vehicles into OpenCE's `.ocetags` package format (`Tools` → `OpenCE Mod Packager` → `Export OpenCE Package (.ocetags)...`).
   - Testing the authentic in-game Halo CE HUD Previewer (**Top-Right** Shield + 8-Wedge Health Bar, **Top-Left** Frag/Plasma Grenades + Reserve Ammo + Individual Bullet Pip Grid, **Bottom-Left** Motion Tracker Radar, and decoded HUD tag bitmap sprite sheets).
