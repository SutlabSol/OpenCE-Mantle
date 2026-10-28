# Guide 6: Live 3D Bitmap Editor, Legacy Tag Importer (`legacy_tags` & `CONVERT` Extracts), OpenCE `sample_mods/` Folder Exporter & Script Trigger Volume Placement

This guide walks through how to test and use the latest upgrades in **OpenCE Mantle**:

---

## 1. Where Auto-Added Script Trigger Volumes, Camera Points & Vehicles Appear (and Why the Warthog Drop Waits for the Trigger)

### Where Do Auto-Added Entities Appear?
When you open **Tools → HaloScript (`.hsc`) Editor & Scenario Compiler...** and click **Auto-Setup Scenario Entities** (or **Compile `.hsc` into Scenario**):
1. **Anchor Calculation**: Mantle automatically reads your scenario's first **Player Spawn** `(x, y, z, yaw)` (or first placed vehicle if no player spawn exists).
2. **Trigger Volumes (`trig_pelican_drop`, `trig_pelican_lz`, `trig_cov_drop`, `trig_base_entry`, `trig_ambush_1`)**:
   - Auto-created as a **8 × 8 × 5 world-unit 3D Trigger Box** centered **5 world units directly in front of the first Player Spawn**!
   - Initialized with `u16@0 = 1`, orthogonal `forward` `(1,0,0)` at `+48`, `up` `(0,0,1)` at `+60`, `starting corner` at `+72`, and `ending corner offset` `(8,8,5)` at `+84`.
   - Any previously created zero-size `(0,0,0)` trigger volumes in the map are automatically repaired in-place!
   - **Visible in the 3D Viewport**: Switch to the **3D Viewport** tab and make sure the **Trigger Volumes** layer is enabled — you will see a **green wireframe/translucent 3D box** right in front of the player spawn, which you can select and drag with the gizmo anywhere on the map!
3. **Cutscene Camera Points (`cam_intro_1`, `cam_intro_2`, `cam_intro_3`, `cam_drop_watch`)**:
   - Auto-created in an elevated arc overlooking the Player Spawn with `position` at `+40`, `orientation` at `+52`, and `fov = 70° (1.2217 rad)` at `+64`.
   - **Visible in the 3D Viewport** as **purple 3D camera markers** (`Cutscene Cameras` layer).
4. **Named Vehicles & Bipeds (`pelican_1`, `drop_hog_1`, `c_dropship_1`, `marine_rider_1`, `marine_rider_2`, `cov_rider_1`, `cov_rider_2`, `chief_clone_1`)**:
   - Automatically adds the corresponding `vehicle` or `biped` tags in the map to the scenario's `vehicle palette` / `biped palette` if not already present, creates physical placements 8–14 world units in front of the Player Spawn, and binds each entry in `scenario.object_names[i]` (`type` at `+32`, `placement_index` at `+34`).

### Why the Pelican Warthog Drop Previously Activated Immediately (and How It Works Now)
- **Root Cause**: Previously, the template had `(sleep_until (or (volume_test_objects trig_pelican_drop (players)) (= pelican_hog_dropped false)) 15)`. Because `pelican_hog_dropped` starts as `false`, the `or` condition evaluated to `true` on tick 1!
- **Fix**: All drop templates (`pelican_warthog_drop`, `pelican_troop_drop`, `c_dropship_delivery`) now:
  1. Spawn the dropship (`pelican_1` / `c_dropship_1`) and cargo (`drop_hog_1` or `marine_rider_1` / `cov_rider_1`) on map load and load them into the dropship bay (`cargo` / `P-riderLF` / `passenger`).
  2. Wait strictly on `(sleep_until (volume_test_objects trig_pelican_drop (players)) 15)`.
  3. Only unload/release the Warthog or troops once you walk into the green `trig_pelican_drop` trigger volume in front of your spawn!

---

## 2. Stacked Global Search/Replace & Category → Item Dropdowns (`ModdingStudioDialog`)

Open **Tools → Universal Converter, Scanner & Mod Studio...**:

### Tab 2: Global Tag Dependency Search & Replace Across Entire Map
- The **1. Find Tag** row is now stacked vertically **above** the **2. Replace With** row with a **`↓ SWAP ALL REFERENCES TO ↓`** divider between them, so neither dropdown is ever cut off on the right edge of the window.
- Each row now includes a **Category Dropdown** (`All Categories`, `vehicle`, `weapon`, `projectile`, `shader_model`, `bitmap`, etc.) on the left and the filtered **Item Dropdown** on the right.

### Tab 3: OpenCE `sample_mods/` Folder Exporter & Legacy Tag Importer
1. **OpenCE Mod Package Exporter (`sample_mods/` Folder Structure & `.ocetags`)**:
   - Choose **1. Tag Category** (e.g. `vehicle`, `weapon`, `scenery`, `biped`) and then **2. Item in Category** below it.
   - Click **Export OpenCE Mod Folder (`mod.toml` + `tags/...`)...** and pick your output folder (e.g. `OpenCE/mods/` or `sample_mods/`).
   - Mantle writes:
     - `<mod_name>/mod.toml` with the exact OpenCE `sample_mods` schema (`name`, `version`, `authors`, `description`, `format = 1`).
     - `<mod_name>/tags/<tag_path>.<group>` for the root tag and all recursive dependencies in authentic **64-byte `'blam'` Big-Endian HEK/OpenCE loose tag format** (including `.gbxmodel` uncompressed vertices/triangles and `.bitmap` pixel data).
2. **Legacy Tag Importer (`legacy_tags` HEK Loose Tags & HMT `.meta` + `.xml` Extracts)**:
   - Supports **both** legacy formats automatically:
     - **HEK / OpenCE 64-byte `'blam'` Big-Endian Loose Tags**: such as [`C:\Users\LeviB\Projects\OpenCE-Mantle\legacy_tags`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/legacy_tags) (`forge\scenery\arch_brace\arch_brace.scenery`, etc.) and [`C:\Users\LeviB\Projects\OpenCE-Mantle\sample_mods`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/sample_mods).
     - **HMT v3.5 `.meta` + `.xml` (+ `.vertices` / `.indices`) Extracts**: such as [`C:\Users\LeviB\Projects\OpenCE-Mantle\sample_maps\CONVERT\Bloodgulch Extract`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/sample_maps/CONVERT/Bloodgulch%20Extract) and [`C:\Users\LeviB\Projects\OpenCE-Mantle\sample_maps\CONVERT\B30 BSP Extract`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/sample_maps/CONVERT/B30%20BSP%20Extract).
   - Choose **Add Mode** (adds new tags & reuses existing) or **Swap Mode** (overwrites matching tags in-place & adds missing), then click **Import Legacy Tag File(s)...** or **Import Legacy Tag Folder...**.

---

## 3. Live 3D Bitmap Editor Tab (Between `3D Viewport` and `OpenCE Tag Test`)

### How to Open & Choose an Item
1. Open any map and click the **`3D Bitmap Editor`** tab in the top center workspace bar (located directly between **`3D Viewport`** and **`OpenCE Tag Test`**).
2. The **Select Item to Paint in 3D Bitmap Editor** popup appears automatically (and can be reopened anytime via **Choose Item to Edit...**):
   - **1. Category** dropdown at the top: `Vehicles (vehicle)`, `Weapons (weapon)`, `Bipeds / Characters (biped)`, `Scenery (scenery)`, `Equipment (equipment)`, `3D Models (gbxmodel)`, or `Bitmaps (bitmap)`.
   - **2. Items in Category** list below: click any item (for example, `warthog`, `mp_warthog`, `assault rifle`, `cyborg`, or `banshee`).

### Painting Directly on the 3D Model In-Place & Using Advanced Tools
- **3D In-Place Painting**:
  - **Left-Click + Drag** directly on the 3D model in the left viewport to paint across its 3D surfaces in real time!
  - **Right-Click + Drag** to orbit/rotate the 3D camera around the model; **Scroll** to zoom.
  - If a model has multiple shader textures (e.g., Warthog hull, tires, chaingun), clicking any part of the 3D model automatically targets that part's texture slot (or you can switch slots in the **Texture Slot** dropdown).
- **Right Sidebar Tools**:
  - **`🖌 Paint Brush`**: Freehand painting on the 3D model or 2D UV view with adjustable **Size**, **Edge Hardness**, and **Opacity**.
  - **`📏 Sharp Line`**: Click and drag between two points (on the 3D model or 2D UV canvas) to draw a crisp, straight line.
  - **`▭ Sharp Box / Rect`**: Drag a sharp filled or outlined rectangle.
  - **`📐 3D Triangle Fill`**: Click any triangle face on the 3D model to cleanly fill that exact mesh triangle with your selected color or texture pattern.
  - **`⬚ Set Bounding Box` (Layer Mask)**: Drag a rectangular bounding box on the 2D UV view (or between two points on the 3D model). Once set, **all** brush strokes, sharp lines, rectangles, and pattern fills (both in 3D and 2D!) are strictly clipped inside that bounding box until you click **Clear Box**! You can also click **Fill Inside Bounding Box Now** to fill the masked box in 1 click.
  - **`3. Textures Library (textures/)`**:
    - Mantle automatically creates a `textures/` folder alongside the `.exe` pre-populated with 6 starter Halo textures (`unsc_olive_armor.png`, `covenant_hex_plate.png`, `forerunner_circuit_panel.png`, `hazard_warning_stripes.png`, `weathered_steel_grunge.png`, `desert_camo_plate.png`).
    - Click **Open Folder** to open `<exe_dir>/textures/` in Windows Explorer, drop in any custom `.png` or `.jpg` images with your own names, and click **Reload** to paint or fill with them on any 3D model!
- **Saving to the Map**:
  - Click **`✓ Apply Painted Texture to Map`** at the bottom right to encode your painted texture (with a full DXT mipmap chain) directly into the open map's `.bitmap` tag in memory, then press **Ctrl+S** (or switch to **OpenCE Tag Test**) to see it in-game!
