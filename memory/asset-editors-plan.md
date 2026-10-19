# Asset Editors Architecture: Bitmaps, Sounds, Models & Collision

This document specifies the architecture and implementation roadmap for the dedicated in-app Asset Editors (accessible via right-click on any tag in the Tag Browser):
1. **Bitmap Editor & Reskinning Pipeline** (PNG/JPG/TIF/DDS preview, export, DXT compression, direct in-map embedding, UV layout template export)
2. **Sound Editor & Audio Modding Pipeline** (Permutation audio preview player, WAV/OGG/MP3 export, 16-bit PCM / Xbox ADPCM encoding, in-map raw injection)
3. **Model Editor & 3D Geometry Pipeline** (Three.js 3D preview, Wavefront OBJ/STL/GLTF export, 68-byte vertex buffer synthesis, in-map `model data` injection via `gbxmodel-injector.ts`)
4. **Collision Model (`coll`) Generation Strategy** (QuickHull / convex decomposition for static props vs. Blender workflow for animated characters)

---

## 1. Right-Click Context Menu Integration

In `desktop/src/components/TagBrowser.tsx`, right-clicking any tag row expands the context menu:

```
┌─────────────────────────────────┐
│ Tag Editor...                   │
│ Bitmaps...                      │
│ Sounds...                       │
│ 3D Model...                     │
│ ─────────────────────────────── │
│ Extract (with dependencies)...  │
└─────────────────────────────────┘
```

### Tag & Dependency Resolution
When right-clicking an object tag (such as `weapons\assault rifle\assault rifle`):
- **Direct Match**: If the clicked tag is itself a `bitm`, `snd!`, or `mod2`, the corresponding editor opens directly for that tag.
- **Dependency Closure Match**: If the clicked tag is a parent object (`weap`, `vehi`, `bipd`, `scen`, `proj`, `effe`):
  - A fast single-tag dependency closure walk (via `core/src/map/dependency-walker.ts`) gathers all reachable tags of that category.
  - The dialog provides a sidebar list / dropdown allowing the user to inspect any associated asset (e.g., weapon 1st-person bitmap, 3rd-person bitmap, reticle bitmap; fire sound, reload sound, chamber sound; 1st-person model, 3rd-person model).

---

## 2. Bitmap Editor & Reskinning Pipeline

### 2.1 Preview & Export
- **Formats to Export**:
  - `PNG` (Lossless 8-bit RGBA — standard for photo editing in Photoshop, GIMP, Paint.NET).
  - `TIF` (Lossless uncompressed image standard).
  - `JPG` (Lightweight compressed format, no alpha).
  - `DDS` (DirectX Surface raw compression, matching Halo's internal DXT1/DXT3/DXT5 format).
  - `.ocetags` (Native standalone tag container for cross-map injection).
- **Sub-Images & Sequences**:
  - Displays thumbnail list of all sub-bitmaps in the set (e.g. `Image 1 of 4: 512x512 DXT1`).
  - Interactive zoom & pan preview rendered on an HTML5 `<canvas>`.
- **UV Wireframe Layout Export**:
  - One-click button: **"Export UV Layout as PNG"**.
  - Renders the wireframe edges of the model's UV polygons over a transparent $1024\times1024$ or $2048\times2048$ PNG. Modders can load this PNG as a top guide layer in Photoshop to paint custom skins with 100% texture alignment.

### 2.2 Ingestion & In-Place Map Embedding
When the user clicks **"Inject Bitmap..."** with a custom PNG/JPG/TIF/DDS:
1. **Dimensions & Mipmap Generation**:
   - Verify dimensions are powers of two (offer auto-resampling if not).
   - Generate full mipmap chain down to $1\times1$.
   - **Cubemaps & Volume Textures (`bitm_class_EX` / `Bitmap_Edit`, Eschaton v0.8.1)**:
     - For **Cubemaps** (`Type == 2`), present a 6-face selector (+X, -X, +Y, -Y, +Z, -Z) and interleave/de-interleave the 6 faces per mipmap level cleanly.
     - For **3D Volume Textures** (`Type == 3`), present a depth slice slider ($Z = 0 \dots \text{depth}-1$) per mipmap level.
     - Decode/encode all 15 Halo bitmap formats (`0x00` A8 through `0x11` P8) plus direct `.dds` header validation (`validate_DDS` matching FourCC `DXT1`/`DXT3`/`DXT5`, dimensions, and mipmap counts).
2. **Encoding**:
   - Encode mipmaps into target format:
     - **DXT1** (4 bits/pixel): Opaque textures or 1-bit alpha.
     - **DXT3** (8 bits/pixel): Explicit 4-bit alpha.
     - **DXT5** (8 bits/pixel): Smooth interpolated alpha gradients.
     - **32-bit ARGB / RGBA, 16-bit R5G6B5 / A1R5G5B5 / A4R4G4B4, A8Y8**: Uncompressed linear pixels.
3. **Safe In-Memory Map Embedding (No `bitmaps.map` Requirement!) & Optional External Resource Splicing**:
   - Custom Edition supports internal embedded bitmaps in `.map` files (`H1.Map::internalizeTag` in Eschaton v0.8.1).
   - Using `core/src/map/raw-data-region.ts` (`appendToRawDataRegion`), append the compressed mipmap data into the map's raw data region (cleanly shifting subsequent model and tag data).
   - In the target `bitm` image header block (`sub_bitmap_offset + 0x00..0x20`):
     - Update `width`, `height`, `depth`, `type`, `format`, `num_mipmaps`, and `size`.
     - Point `offset` (`+0x18`) to the new raw data offset.
     - **Clear external bit**: `flags &= ~0x100` (`flags = flags & 0xFEFF`) and clear `CE_flag` (`+0x18` in the 32-byte tag index entry).
   - **Result**: The reskinned map is 100% self-contained and portable; other players do not need modified `bitmaps.map` files.
   - **Optional External `bitmaps.map` Splicing (`H1SupportMap.SupportMap::inject_bitmap`)**: For advanced users building shared resource maps, support middle-splicing into `bitmaps.map` and shifting subsequent table offsets by `delta = newLength - oldLength`.

---

## 3. Sound Editor & Audio Modding Pipeline

### 3.1 Audio Preview & Export
- **In-App Player**:
  - Decodes Halo sound permutations (`snd_class_EX` in Eschaton v0.8.1: 16-bit PCM, Xbox ADPCM 36-byte blocks -> 64 samples, or Ogg Vorbis) into standard Web Audio API buffers.
  - Interactive controls: Play, Pause, Loop, Volume slider, Pitch Range selector (`ranges` reflexive at `snd! + 0x98`, 72-byte entries), Permutation browser (`permutations` reflexive at `pitch_range + 0x3C`, 124-byte entries), and audio waveform visualizer.
- **Export Formats**:
  - `WAV` (16-bit uncompressed PCM at 22,050 Hz or 44,100 Hz).
  - `OGG` (Vorbis).
  - `MP3`.
  - `.ocetags`.

### 3.2 Sound Injection & Ingestion
- User clicks **"Inject Sound..."** and picks a `.wav`, `.ogg`, or `.mp3`.
- Web Audio / Node audio decoders convert the audio to PCM, resample to Halo's standard sample rates (22,050 Hz or 44,100 Hz, mono or stereo matched to `snd! + 0x06` `channel_count`), and compress into:
  - 16-bit uncompressed PCM,
  - Xbox ADPCM (4:1 compression ratio), or
  - Ogg Vorbis.
- Appends the audio sample buffer into the map's raw data region via `appendToRawDataRegion` (or internalizes external sounds via `H1.Map::internalizeTag`) and updates permutation sizes (`+0x40`), `external_bit` (`+0x44`, bit 0 cleared to `0` for internal), and raw file offsets (`+0x48`) via `snd_class_EX::update_offset`.

---

## 4. 3D Model Editor (`gbxmodel` / `mod2`) & BSP Viewer (`sbsp`)

### 4.1 3D Preview & Exporting
- **In-Dialog 3D Viewport**:
  - Embedded Three.js canvas in the dialog showing the 3D model (`mod2`) or BSP (`sbsp`) with Orbit/Fly controls.
  - Shaded with diffuse textures resolved through `senv`/`soso`/`schi`/`sgla`/`smet`/`spla` shader tags (`mod_2_model::load_textures` and `SBSP_header::read` in Eschaton v0.8.1), plus LOD selector (`Super High` to `Super Low`), Bones/Nodes skeleton overlay, and Marker spheres.
  - For `sbsp` tags, includes toggles for Render Submeshes, Collision BSP wireframe, Spawn Points, and Detail Objects (`DOBC`), plus a **"Strip Implicit Detail Objects (`DOBC`) & Decals"** utility (`SBSP_header::strip_DOBC` at `sbsp + 0x1D4` and `+0x1E0`) to prevent unresolved-dependency crashes in transplanted BSPs.
- **Export Formats**:
  - `OBJ` (+ `.mtl` material file): Universal standard for 3D modeling. Each model region/part exports as an OBJ group (`g hull`, `g turret`), with UV coordinates (`vt u v`) and vertex normals (`vn nx ny nz`).
  - `STL`: Solid triangle mesh (ideal for 3D printing).
  - `GLTF` / `GLB`: Modern PBR standard that preserves bone node hierarchies.
  - `.ocetags`: Native tag container.

### 4.2 Model Ingestion & Injection
- User selects an `.obj` or `.stl` file.
- **Processing**:
  1. Triangulate all polygon faces into triangles.
  2. Compute vertex normals and tangent/binormal vectors.
  3. Construct the 68-byte PC uncompressed vertex buffer (`x, y, z, nx, ny, nz, bx, by, bz, tx, ty, tz, u, v`).
  4. Generate triangle indices or strips.
  5. **Inject via `gbxmodel-injector.ts`**:
     - Uses our existing Milestone M5 Stage 2 injector engine! Appends the new vertex and index buffers into the map's model data section and patches `GBXModelGeometryPart` offsets (`vertexOffset`, `triangleOffset`, `vertexCount`, `triangleCount`).

---

## 5. Collision Model (`coll`) & UV Unwrapping Strategy

### 5.1 Collision Model Generation (`coll`)
- **How Halo Collision Works**:
  - Halo `coll` tags are **not** raw triangle meshes; they consist of **Convex Polyhedra (3D BSPs)** with nodes, bounding planes, leaves, 2D BSP surfaces, and edge connectivity trees.
- **Feasibility of "Generate Collision" Toggle**:
  - **For Static Objects (Scenery, Props, Weapons, Projectiles)**:
    - **Feasible & Practical**: We compute a **3D Convex Hull** (using QuickHull) or an approximate convex decomposition (V-HACD) directly from the imported 3D mesh vertices.
    - We serialize this single convex polyhedron into a minimal `coll` tag struct and assign it to the weapon or scenery tag's collision reference.
    - In-game result: Bullets and players will physically collide with the object's hull accurately without passing through it.
  - **For Rigged / Animated Characters & Vehicles (Bipeds, Warthog)**:
    - Characters require multi-bone articulated hitboxes (head, torso, arms, legs, precision weakspots) and vehicles require suspension/wheel physics nodes.
    - Generating this automatically from a flat mesh is not possible without semantic bone weighting.
  - **Verdict**: A checkbox **`[x] Auto-generate basic convex collision model`** should be provided for static models (scenery, props, weapons). Complex multi-region collision is best authored in Blender using the Halo Blender plugin.

### 5.2 UV Unwrapping vs. UV Wireframe Export
- **Why Automatic UV Unwrapping belongs in 3D Apps (Blender)**:
  - Automatic UV unwrap algorithms (like smart projection or box projection) create fragmented, distorted UV triangles that are very difficult to paint manually in Photoshop.
  - Artists create seams and unwrap UVs cleanly in Blender or Maya before exporting the `.obj`.
- **What OpenCE-Modding-Tool Provides Instead**:
  - The imported OBJ/STL **already contains the author's clean UV mapping** (`vt` lines in OBJ).
  - We provide a one-click button: **"Export UV Layout Template (PNG)"**.
  - This renders the wireframe outlines of the model's UV polygons over a transparent $1024\times1024$ or $2048\times2048$ PNG for photo editors.

---

## 6. Unicode String List Editor (`ustr`) & Expanded Tag Management (from Eschaton v0.8.1)

### 6.1 `ustr` Unicode String List Editor (`ustr_edit_control` / `ustr_snippit`)
- **Binary Layout**:
  - Root `ustr` tag contains a 12-byte reflexive (`count` at `+0x00`, `offset = readUInt32LE(0x04) - magic`) pointing to an array of 20-byte string entry headers (`ustr_snippit`).
  - Each 20-byte entry stores:
    - `+0x00` (`int32`): `maxLength` (byte length of the UTF-16LE string payload).
    - `+0x04` (`int32`): `0`.
    - `+0x08` (`int32`): `old_offset`.
    - `+0x0C` (`uint32`): `offset` (file offset to the null-terminated UTF-16LE string payload).
    - `+0x10` (`int32`): `0`.
- **In-App Editor Capabilities**:
  - Select any string index `0 .. count-1`, view and edit the UTF-16LE text in real time (e.g., custom HUD weapon pickup messages, menu text, objective strings).
  - In-place write when `newByteLength <= maxLength`; automatic block expansion when strings grow longer or new string entries are added (`Add String` / `Delete String`).

### 6.2 Expanded Tag Management (`expanded_tag_control`)
- **Referencing Tags (Reverse Dependency Lookup)**:
  - Lists every tag in the map that holds a dependency reference to the currently selected tag, with one-click navigation.
- **Tag Renaming & Duplication**:
  - In-place rename of any tag's virtual path (`weapons\assault rifle\assault rifle` -> `weapons\custom_ar\custom_ar`), plus one-click **Duplicate Tag** using collision-free tag ID generation (`0xE1740000 + n * 0x10001`).
- **Safe Tag Deletion (`remove_tag`)**:
  - Blocks deletion if `is_depended_on` is true (unless the user explicitly opts to null out referencing slots), removing dead tags cleanly on map rebuild.

---

## 7. OpenCE Resource Pack Mods & HEK Tag Export Pipeline

OpenCE supports non-destructive runtime modding similar to Minecraft Resource Packs. Placing a mod folder inside `OpenCE/mods/` overrides game assets across all maps without altering compiled `.map` cache files.

### 7.1 Package Layout
```
<ModName>/
├── mod.toml
└── tags/
    └── <virtual_tag_path>.<hek_extension>
```

### 7.2 The `mod.toml` Manifest
```toml
name = "Lore Accurate Weapon Names"
version = "1.0"
authors = "Author Name"
description = "Updates pickup and weapon strings to lore-accurate names"
format = 1
```

### 7.3 Universal HEK Tag Support
OpenCE's mod loader intercepts and hot-replaces **any HEK tag class** (identified by the 64-byte `blam` header and Big-Endian struct reflexives):
- **Textures**: `.bitmap` (e.g. `weapons/assault rifle/fp/bitmaps/assault rifle_fp.bitmap`, with zlib-compressed pixel data).
- **Models**: `.gbxmodel` (e.g. `characters/cyborg/cyborg.gbxmodel`).
- **Sounds**: `.sound` (plus accompanying `.wav` permutations in subdirectories).
- **Strings & Text**: `.unicode_string_list` (e.g. `ui/hud/hud_item_messages.unicode_string_list` for weapon pickup notifications).
- **Weapons & Gameplay**: `.weapon`, `.vehicle`, `.damage_effect`, etc.

### 7.4 App Integration
- **Right-Click -> "Export as OpenCE Mod..."**: In `TagBrowser`, packages the selected tag (or group) directly into a ready-to-play mod folder with `mod.toml`.
- **In-Editor "Save as OpenCE Mod"**: When editing a texture, sound, or tag values in our Tag Editor, users can export their changes as a standalone mod that applies to every map automatically.


