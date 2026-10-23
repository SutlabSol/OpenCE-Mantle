# Guide 2: HaloScript (`.hsc`), Pelican Vehicle Drops, Biped Injection & Scenario Object Names

## Why Your Previous Script Map (`whatitistobe_copy.map`) Blue-Screened & Showed Nothing
When we inspected your broken `whatitistobe_copy.map`, we found two engine-level issues that have now been **completely fixed** in OpenCE Mantle (and your file at `sample_maps\latest test\whatitistobe_copy.map` has been repaired!):
1. **Unaligned Scenario Reflexive Allocation**: Adding a chunk to `object names` previously placed the array at an unaligned byte offset (`% 4 !== 0`) and did not set `object_type` (`+32`) and `object_index` (`+34`) on the `ScenarioObjectName` entry when you linked a vehicle placement's `.name` field.
2. **HaloScript (`hs-compiler.ts`) Header & Node Table Format**: Halo CE requires the Scenario's `script syntax data` (`0x488`) to be an exact `380,076`-byte `data_array` header (`19,001` max nodes, `'@t@d'` signature, `_hs_syntax_node_permanent_bit = 0x8` on every node, and `1,024` trailing null bytes after `script string data`).

---

## 1. How to Extract & Inject Bipeds (`grunt`, `elite`) and Vehicles (`pelican`, `c_dropship`) from `b30.map`
Previously, extracting `characters\grunt\grunt` from `b30.map` was refused because `b30.map` is a hybrid Xbox/PC cache whose DXT1 bitmaps have `43,776` bytes (`43,704` bytes of mipmaps + `72` bytes of Xbox 128-byte alignment padding).
- **What we fixed**: OpenCE Mantle now accepts any bitmap whose stored pixel slice is `>= expected` (`43,776 >= 43,704`), matching OpenCE's native bitmap loader.

### Step-by-Step Biped & Pelican Extraction Walkthrough:
1. Open **`sample_maps\b30.map`** (`The Silent Cartographer`) in OpenCE Mantle.
2. In the left Tag Tree, expand **`biped` (`bipd`)** or **`vehicle` (`vehi`)**:
   - Check `characters\grunt\grunt` (or `characters\elite\elite`, `characters\marine\marine`)
   - Or check `vehicles\pelican\pelican` and `vehicles\c_dropship\c_dropship`
3. Click **`Extract Checked...`** in the toolbar and save as `grunt.ocetags` or `pelican.ocetags`.
   - Notice: **0 blocked tags** and **all embedded bitmaps captured**!
4. Open your target map (e.g., `bloodgulch.map` or `whatitistobe_copy.map`).
5. Click **`Inject Tags...`**, pick `grunt.ocetags` or `pelican.ocetags` in **ADD mode**, and click **Apply Injection**.

---

## 2. How to Name a Placed Vehicle or Biped (`vehicles[i].name` → `object names`)
HaloScript commands like `(unit_enter_vehicle (pelican_01) (hog_drop_01) "cargo")` refer to placed objects by their **Scenario Object Name** (`scnr.object names`).

### Step-by-Step Walkthrough (Using the New Cross-Reflexive Dropdown!):
1. Open your map in OpenCE Mantle and open the **`scenario` (`scnr`)** tag in the **Tag Editor** (or click the **Scenario** tab in the right dock).
2. Expand **`object names`** (`scnr.object names`):
   - Click **`+ Add Chunk`** to add a new Object Name entry.
   - Set its **`name`** field to `pelican_01`.
   - Click **`+ Add Chunk`** again and set the second entry's **`name`** to `hog_drop_01`.
3. Expand **`vehicle palette`** (`scnr.vehicle palette`):
   - Ensure `vehicles\pelican\pelican` and `vehicles\warthog\mp_warthog` are in the `vehicle palette`.
4. Expand **`vehicles`** (`scnr.vehicles`):
   - Select your Pelican placement chunk (e.g. `vehicles[0]`).
   - Look at the **`type`** field: it is now a **Dropdown** listing every vehicle in `vehicle palette` (`#0: vehicles\warthog\mp_warthog`, `#1: vehicles\pelican\pelican`, etc.)!
   - Look at the **`name`** field: it is no longer stuck as a raw number! It is now a **Dropdown** listing every entry in `object names` (`-1: (None / Unnamed)`, `#0: pelican_01`, `#1: hog_drop_01`, etc.)!
   - Select **`#0: pelican_01`** on your Pelican placement, and select **`#1: hog_drop_01`** on your Warthog placement.
   - *(Automatic Sync)*: Whenever you pick an `object names` entry on a vehicle/biped/scenery placement, OpenCE Mantle automatically updates `object names[i].object type` and `object index` in the binary Scenario tag so Halo CE resolves the script object name at runtime!

---

## 3. Compiling & Testing Scripts in Multiplayer vs. Singleplayer
- **Important MP Note**: In Halo CE Multiplayer (`mapType = 1`), the engine automatically runs `(script startup ...)` and `(script continuous ...)` scripts! However:
  - Standard Scenario `vehicles` placements in a Multiplayer map only spawn at map load if they are spawned via script `(object_create_anew pelican_01)`!
  - Always use **`(object_create_anew <object_name>)`** at the start of your `startup` script so the named Pelican / Warthog / Biped is guaranteed to spawn in both Singleplayer and Multiplayer!

### Ready-to-Use MP & SP Pelican Warthog Drop Script:
Open **`Tools` → `HaloScript (.hsc) Decompiler & Editor...`**, paste this script, and click **`Compile Into Map`**:
```lisp
(script startup pelican_warthog_drop
  (begin
    (sv_say "Spawning Pelican and Warthog...")
    (object_create_anew pelican_01)
    (object_create_anew hog_drop_01)
    (sleep 30)
    (unit_enter_vehicle hog_drop_01 pelican_01 "cargo")
    (sleep 90)
    (sv_say "Dropping Warthog from Pelican cargo bay!")
    (unit_exit_vehicle hog_drop_01)
  )
)
```
Press **`Ctrl+S`** to save the map and click **`Run in OpenCE`** to test!
