# 01 — Levels, Structure BSPs (`sbsp`), Portals, Lightmaps, Weather & Material Symbols

> **Purpose**: Complete technical reference and **OpenCE Mantle** automation blueprint for how Halo CE / H1A levels (`scenario_structure_bsp` / `sbsp`), material symbols, portals, clusters, skies, fog planes, weather polyhedra, radiosity lightmaps, detail objects (`dobc`), and decals (`deca`) are constructed, how legacy tools (`Tool CE`, `Tool MCC`, `Sapien`, `MEK`, `Eschaton`) process them, and how Mantle streamlines every step into a visual 1-stop workflow.

---

## 1. World Scale, Coordinate System & Player Movement Metrics

Understanding Halo's exact coordinate space and physical metrics is critical when building or importing 3D geometry in Mantle:

| Metric | JMS Units (3ds Max / Blender) | Halo World Units (`wu`) | Real-World Equivalent |
| :--- | :--- | :--- | :--- |
| **Coordinate System** | Right-handed, **Z-Up** (`+X` Forward, `+Y` Left, `+Z` Up) | Right-handed, **Z-Up** | Three.js is Y-Up: `(x_three, y_three, z_three) = (x_halo, z_halo, -y_halo)` |
| **Base Unit Conversion** | `100 JMS units` | **`1.0 wu`** | `10 feet` (`3.048 meters`) |
| **1 JMS Unit** | `1.0 JMS unit` | `0.01 wu` | `1.2 inches` (`3.048 cm`) |
| **Master Chief Standing Height** | `70 JMS units` | `0.70 wu` | `7.0 ft` (`2.13 m`) |
| **Master Chief Crouching Height** | `50 JMS units` | `0.50 wu` | `5.0 ft` (`1.52 m`) |
| **Master Chief Collision Cylinder Width** | `40 JMS units` | `0.40 wu` | `4.0 ft` (`1.22 m`) |
| **Maximum Walkable Step Height (Moving)** | `12 JMS units` | `0.12 wu` | Stairs with risers `> 12 JMS` require a `*` player-clip ramp! |
| **Stationary Jump Step Height** | `65 JMS units` | `0.65 wu` | `6.5 ft` |
| **Running Jump Height (Uncrouched)** | `79 JMS units` | `0.79 wu` | `7.9 ft` |
| **Running Crouch-Jump Height** | `98 JMS units` | `0.98 wu` | `9.8 ft` |
| **Maximum Walkable Slope Angle** | `45°` | `45°` (`normal.z >= 0.7071`) | Slopes steeper than `45°` cause bipeds to slide down |

---

## 2. Sealed-World Rules & How Structure BSPs (`sbsp`) Are Built

### 2.1 The Sealed-World (2-Manifold) Rule
Halo 1 represents level collision and visibility using a **3D Binary Space Partitioning (BSP) tree** (`Tool CE/src/structures/structure_bsp_build.c`, `bsp3d.c`).
- Every solid surface splits 3D space into **front** (inside the playable room, where the surface normal points) and **back** (outside the map / inside solid rock).
- Therefore, the playable level hull **must be a completely sealed, watertight 2-manifold volume** with all surface normals pointing **inward** toward the player.
- Exceptions: Surfaces whose material name includes the symbols **`%`** (two-sided), **`#`** (transparent one-sided non-manifold), **`!`** (render-only), **`*`** (sphere-collision-only), or **`$`** (fog plane) are exempt from the sealed-world hull check and may have open edges.

### 2.2 Collision Artifacts: "Phantom BSP" & "BSP Holes"
When dense, non-axis-aligned triangles intersect during 3D BSP plane splitting, floating-point precision loss can corrupt leaf nodes:
1. **Phantom BSP**: Invisible collision planes appear in mid-air that block **bipeds** (which use 2-point pill/sphere collision) while allowing projectiles and vehicles to pass through.
2. **BSP Holes**: Missing collision leaves allow players or vehicles to fall straight through solid floors.
3. **How to Fix / Prevent**:
   - Use simplified **`@`** (collision-only) proxy geometry for complex rock/architectural trim and mark the high-poly visible geometry as **`!`** (render-only).
   - In `Tool MCC`, passing `true` for the `[fix-phantom-bsp]` argument runs a `munging collision bsp` pass (`Tool MCC/src/`) that repairs floating-point plane splits (increasing BSP leaf data size by ~23%).

---

## 3. Complete Reference of Halo 1 Special Material Names (`+`)

Special materials begin with `+` in the 3D mesh/JMS and do **not** reference a shader tag on disk:

| Special Material Name | Purpose & Engine Behavior | Rules & Limits |
| :--- | :--- | :--- |
| **`+sky`** (`+sky0`, `+sky1`, ...) | Renders the skybox (`sky ` tag) from `scenario.skies[i]`. Marks any cluster containing it as an **outdoor cluster** (enabling sky fog, sky radiosity lighting, and outdoor weather). Projectiles hitting `+sky` are deleted (`sky` surface flag). | All `+sky` faces visible within a single cluster **must** use the same sky index. |
| **`+portal`** | Splits the level's sealed volume into visibility/occlusion **clusters** (`sbsp.clusters`). | May extend outside the BSP hull (`open edges` outside the hull are permitted). |
| **`+exactportal`** | Strict portal plane whose perimeter vertices **must snap 1:1** to matching vertices on the surrounding BSP doorway/hallway perimeter. | Required for sealed sound environments, weather occlusion boundaries, and door occlusion portals. |
| **`+weatherpoly`** | Defines a **convex 3D polyhedron** (up to 16 coplanar sides, normals pointing **outward**) that masks weather particles (`rain`, snow) from falling inside covered overhangs, tunnels, or caves before crossing a portal. | Max **8 visible weather polyhedra** on screen at once. Reconstructed into 3D meshes in Mantle via `planes_to_verts_and_tris` (`MEK/mek_lib/reclaimer/util/geometry.py`). |
| **`+seamsealer`** | Temporary/structural sealing material that closes open hull seams and deletes projectiles like `+sky`, but does **not** mark the cluster as outdoor or cast sky light. | Useful for sealing geometry gaps without affecting indoor lighting. |
| **`+sound`** | Defines acoustic environment transition boundaries between clusters. | Used with cluster `sound_environment` palettes. |
| **`+unused`** (especially **`+unused$`**) | Dummy material name that requires no shader tag. Combined with `$` as **`+unused$`**, it creates an invisible planar **fog plane** (used when a level has volumetric planar fog without a visible water surface). | Must be strictly planar with normal pointing out of the fog volume (`+Z`). |

---

## 4. Complete Reference of Halo 1 Material Suffix Symbols (`% # ! @ * $ ^ - & .`)

In Halo 1, appending single-character symbols to the end of a material name in the 3D model / `.jms` file instructs the BSP compiler to set specific surface/collision flags while stripping the symbols when looking up the `.shader` tag name:

| Symbol | Name | Renders? | Collides? | Open Edges Allowed? | Casts Radiosity Shadows? | Exact Engine Behavior & Modding Use Case |
| :---: | :--- | :---: | :---: | :---: | :---: | :--- |
| **`%`** | **Two-Sided** | Both sides | Both sides | ✅ Yes | ✅ Yes (tinted if transparent shader) | Generates back-to-back faces sharing vertices. Used for glass panes (`glass%-`), grates (`grate%.`), and thin fins. |
| **`#`** | **Transparent (One-Sided Non-Manifold)** | Front only | Both sides | ✅ Yes | Only when normal faces receiver | Used for one-way forcefields, energy shields, or single-sided railings that need two-sided collision without sealing a room. |
| **`!`** | **Render-Only** | Front only | ❌ No | ✅ Yes | ❌ **No** | Non-collidable visual geometry. **Mandatory for alpha-tested foliage cards (`senv` with `alpha_tested`)** because Halo's radiosity ignores `senv` alpha channels and will cast solid black square shadows unless marked `!`! Also used on water surfaces (`water!$`). |
| **`@`** | **Collision-Only** | ❌ Invisible | All (Rays + Spheres) | ❌ **No** (Must seal hull!) | ✅ **Yes** | Invisible solid wall that blocks players, vehicles, AND bullets/projectiles, and **casts shadows**. Used for simplified collision proxies around `!` high-poly meshes. |
| **`*`** | **Sphere-Collision Only (Player Clip)** | ❌ Invisible | **Spheres Only** (Bipeds & Vehicles) | ✅ Yes | ❌ No | Invisible barrier that blocks **players and vehicles** while letting **bullets, projectiles, grenades, and AI line-of-sight pass right through**! Essential for ramp-smoothing stairs (`> 12 JMS` steps) and invisible player containment walls. |
| **`$`** | **Fog Plane** | Optional (`!$`) | ❌ No | ✅ Yes | ❌ No | Defines a flat planar fog boundary (`+unused$` or `water!$`). All vertices must be coplanar; normal points **out of the fog** (`+Z`). **Limit**: Max **1 fog plane visible per cluster**! |
| **`^`** | **Climbable (Ladder)** | Yes | Yes | Depends on `%`/`#` | Yes | Marks the surface as a **ladder** (`climbable` flag). Bipeds looking at or pushing against the surface climb along its vertical axis (commonly `ladder%^`). |
| **`-`** | **Breakable Surface** | Yes | Yes (Until broken) | ✅ Yes (with `%`/`#`) | Yes | Breakable glass pane (e.g., `glass%-`). **Crucial Rule**: The referenced shader tag's `material_type` **must** be set to `glass`, which triggers `globals.breakable_surface_particle_effect` on impact! |
| **`&`** | **AI Deafening Portal** | Portal | Portal | Portal | N/A | Appended to `+portal&` or `+exactportal&` to block AI from hearing gunfire/grenades across the portal in singleplayer. |
| **`.`** | **Exact Portal Material** | Yes | Yes | ❌ No (Must match hull) | Yes | Turns a visible/collidable surface (such as a floor grate `grate%.`) into an `+exactportal` cluster divider! |

> [!TIP]
> **How to Block Projectiles While Allowing Players Through (The "Prisoner Energy Doorway" Trick)**:
> Notice there is no BSP symbol that is the inverse of `*` (blocking rays/projectiles while letting players walk through). In Halo CE (as seen on *Prisoner*), this is achieved by placing a **`device_light_fixture` (`lifi`)** or **`sound_scenery` (`ssce`)** object that has a `model_collision_geometry` (`coll`): the engine tests projectile rays against `lifi`/`ssce` collision models, but skips biped/vehicle sphere collision against them!

---

## 5. Radiosity, Lightmaps, Detail Objects (`dobc`) & Decals (`deca`)

### 5.1 How Halo 1 Radiosity Works (`Tool CE` / `Sapien`)
1. **Progressive Refinement Ray-Shooting**:
   - Subdivides BSP triangles into radiosity patches based on each shader's **`detail_level`** (`high`, `medium`, `low`, `turd`) and whether quality is `0` (fast preview) or `1` (full production).
   - Emits light energy from **`sky` tag lights** (through `+sky` faces) and any BSP shader with **`radiosity_properties.light_power > 0`**.
   - Bakes both the 2D **lightmap texture plates** (`sbsp.lightmaps_bitmap`) and per-vertex **incident radiosity normal vectors** (which drive 3D normal-mapped specular highlights on `shader_environment` and shade dynamic objects moving through the room).
2. **Diagnosing `.wrl` VRML 1.0 Error Files (`MEK/tools_misc/wrl_to_obj.py`)**:
   - When `tool structure` or `tool lightmaps` encounters geometry errors, it writes `<map>.wrl` with color-coded wireframe markers:
     - **Red (`1, 0, 0`)**: Open edges (hole in the sealed world hull).
     - **Green (`0, 1, 0`)**: Coplanar overlapping faces or non-planar quads.
     - **Blue (`0, 0, 1`)**: Degenerate triangles or zero-area UV parameterization (crashes radiosity when `simple_parameterization` is enabled on the shader).
     - **Orange (`1, 0.5, 0`)**: Portal does not cleanly divide a space into two sealed clusters.
     - **Magenta (`1, 0, 1`)**: Nearly coplanar / T-junction vertices causing phantom BSP splits.

### 5.2 Detail Objects (`dobc`) & Decals (`deca`)
- **Detail Object Collection (`dobc`)**:
  - Automatically scatters small grass blades, pebbles, or trash sprites across BSP surfaces (`sbsp.detail_objects`, parsed by Eschaton's `SBSP_DOBC_data` at `sbsp + 0x1D4` and migrated by `Tool MCC`'s `copy-detail-objects`).
  - **MCC Warning**: In Halo 1 Anniversary (`h1a`), `screen_facing` detail objects fail to render; always set `type = viewer_facing` for cross-compatibility between CE and MCC!
- **Decals (`deca`)**:
  - Projected surface textures (`scnr.decals` at `scnr + 0x50` and `sbsp.runtime_decals` at `sbsp + 0x1E0`).
  - Supports **chained composite decals** via `next_decal_in_chain`: placing a single root decal in the scenario can automatically spawn layered scorch marks, blood splatters, and randomized dirt rings at the same coordinate.

---

## 6. How OpenCE Mantle Automates Level & BSP Workflows

1. **Multi-BSP Combiner & 1-Click SP-to-MP BSP Swapper (`core/src/map/bsp-merger.ts`, `bsp-swapper.ts`)**:
   - Already implemented in Mantle M10.1 & M10.2! Combines multiple campaign BSPs into a single multiplayer BSP, harvests donor shaders/lightmaps/bitmaps, imports `.scenery` and auto-opening `.device_machine` doors, and strips or migrates `DOBC` / decals.
2. **Planned 3D Viewport Additions (`ScenarioViewport.tsx`)**:
   - **`.wrl` Error Overlay**: Import any `tool.exe` `.wrl` file (using MEK's `wrl_to_obj.py` grammar) and render the exact offending vertices/edges in glowing Red/Green/Blue/Orange inside our 3D Viewport with a "Jump to Next Error" camera button.
   - **3D Cluster Portal, Fog Plane & Weather Polyhedra Visualizer**: Use MEK's `planes_to_verts_and_tris` (`mek_lib/reclaimer/util/geometry.py`) to render translucent 3D convex hulls for `+weatherpoly` volumes, `$` fog planes (warning if `> 1` fog plane is visible from a cluster), and `+portal` planes, plus a live Cluster Inspector panel to assign per-cluster Skies, Fog, Background Sounds, Reverb, and Weather.
   - **Visual Material Flag Editor**: Instead of forcing users to remember `%#!@*$^-.` suffixes in Blender, provide checkboxes in Mantle's Custom Object / BSP compiler that apply the exact surface flags and auto-configure breakable `glass` shaders.
