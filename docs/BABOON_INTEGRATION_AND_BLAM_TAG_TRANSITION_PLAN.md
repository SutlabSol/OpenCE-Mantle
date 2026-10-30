# Baboon Deep-Dive Analysis & Standard Blam Tag Transition Plan for OpenCE Mantle

**Date:** 2026-10-30  
**Scope:** Research & Architectural Plan (`SAMPLE CODE/Baboon` → `OpenCE-Mantle`)  
**Related Summary:** [`SAMPLE CODE/Baboon/SUMMARY.md`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/SUMMARY.md)

---

## Part 1: High-Value Capabilities in Baboon to Grow OpenCE Mantle

Baboon (`v0.3.2`) is a Rust-based, multi-engine Halo tag editor (`haloce_mcc`, `halo2_mcc`, `halo3_mcc`, `halo3odst_mcc`, `haloreach_mcc`, `halo4_mcc`, `halo2amp_mcc`, and `haloce_evolved`) built on `blam-tags`. Below are the **12 highest-impact capabilities, workflows, and bundled datasets** we can adapt directly into OpenCE Mantle.

---

### 1. Bundled Multi-Engine HaloScript Database (`docs/script_docs.sqlite3`)
- **Where in Baboon:** [`docs/script_docs.sqlite3`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/docs/script_docs.sqlite3) & [`src/bin/build_script_docs/script_docs_import.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/bin/build_script_docs/script_docs_import.rs)
- **What it does:** Contains a pre-parsed SQLite database of **every HaloScript (`hsc`) function signature, return type, parameter list, description, `NETWORK SAFE` annotation, external global variable, and real-world extracted `.hsc` code snippet** across **7 Halo engines** (`h1`, `h2`, `h2amp`, `h3`, `h3odst`, `hreach`, `h4`).
- **How it improves Mantle:**
  - Mantle already has [`core/src/map/hs-compiler.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/core/src/map/hs-compiler.ts) and [`core/src/map/hs-decompiler.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/core/src/map/hs-decompiler.ts) for Halo CE.
  - By querying or exporting `script_docs.sqlite3` into Mantle's script editor, Mantle gains **instant IntelliSense autocomplete, hover tooltips, parameter type validation, network-safety warnings, and real Bungie mission script examples** across Halo 1 through Halo 4.

### 2. Per-Game `tool.exe` Command Schemas & Visual Command Runner (`tool_commands/*.json`)
- **Where in Baboon:** [`tool_commands/haloce_mcc.json`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/tool_commands/haloce_mcc.json) (plus `halo2_mcc.json`, `halo3_mcc.json`, `halo3odst_mcc.json`, `haloreach_mcc.json`, `halo4_mcc.json`) & [`src/app/kits/tool_commands_window.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/app/kits/tool_commands_window.rs)
- **What it does:** Defines every `tool.exe` verb (`bitmaps`, `sounds`, `model`, `collision-geometry`, `physics`, `structure`, `lightmaps`, `build-cache-file`, `fbx-to-jms`, `camera-track`, `hud-messages`, etc.) with descriptions, examples, and typed arguments (`path_data`, `enum`, `optional_string`).
- **How it improves Mantle:**
  - Can be imported directly into Mantle to power a **Run Tool Command** drawer with file/folder pickers, enum dropdowns, inline required-argument validation, and live streamed terminal output.

### 3. Semantic Tag Diffing & Git Review (`src/app/compare/diff.rs` & `git_review.rs`)
- **Where in Baboon:** [`src/app/compare/diff.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/app/compare/diff.rs) & [`src/app/compare/git_review.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/app/compare/git_review.rs)
- **What it does:**
  - Standard positional array diffing breaks whenever a modder inserts or deletes an element at the top of a reflexive block (every subsequent element reports as modified).
  - Baboon solves this with **three-tier block element alignment**:
    1. **Identity alignment (`align_by_identity`):** Pairs elements by their primary name/string_id/tag_reference field (`element_identity`) and uses **Patience Sorting (Longest Increasing Subsequence)** (`moved_pairs`) to detect reordered palette items without false field diffs.
    2. **Content fingerprint alignment (`align_by_content`):** For anonymous blocks (e.g., `zone set pvs`, collision nodes), computes a recursive 6-level deep hash (`element_fingerprint`) + shallow fixed-field hash (`shallow_fingerprint`), aligns via **LCS**, and pairs modified elements in-place.
    3. **Git Review Pane:** Runs `git status` / `git log` / `git show` on a `tags/` repository and displays a semantic field-by-field diff of modified binary loose tags across commits or working-tree changes!
- **How it improves Mantle:**
  - Upgrades Mantle's [`core/src/map/map-compare.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/core/src/map/map-compare.ts) from positional reflexive comparison to **identity + LCS fingerprint alignment**, and enables a **Git Tag Diff / Review tab** once Mantle uses standard loose Blam tag folders.

### 4. Persistent Incremental SQLite Tag & Dependency Index (`src/core/source/index.rs`)
- **Where in Baboon:** [`src/core/source/index.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/core/source/index.rs) & [`src/app/references/dependencies.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/app/references/dependencies.rs)
- **What it does:**
  - Stores a per-kit SQLite database (`entries`, `indexed_tags`, `dependencies`) keyed by `(size, modified_secs, modified_nanos)`.
  - On startup or refresh, stats the `tags/` tree across worker threads and **only re-parses tags whose file size or `mtime` changed**, updating both the tag entry row and its outbound dependency edges in a single SQLite transaction (`upsert_entry_with_dependencies`).
- **How it improves Mantle:**
  - Essential for making a loose `tags/` workspace (which in HCEEK/H3EK/HREK holds **15,000 to 90,000+ loose tag files**) open instantaneously in Mantle without re-scanning every binary file on launch.

### 5. Content Explorer, Reference Jump & Auto-Fix Broken Dependencies (`src/app/references/`)
- **Where in Baboon:** [`src/app/references/explorer.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/app/references/explorer.rs), [`ref_jump.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/app/references/ref_jump.rs), & [`dependencies.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/app/references/dependencies.rs)
- **What it does:**
  - **Content Explorer:** Two-column interactive graph browser (`Referenced by (Parents)` on the left, `References (Children)` on the right) with Back/Forward navigation history and instant filtering.
  - **Reference Jump (`PendingRefJump` / `FieldNav`):** Clicking a referrer opens that tag, forces every ancestor reflexive block open along the path, scrolls directly to the referencing field, and pulses a highlight glow around the field.
  - **Fix Tag Dependencies (`fix_tag_dependencies_in_tag`):** Scans a tag for broken `TagDependency` paths, indexes all existing tags in the workspace by `(group_tag, leaf_filename)`, and automatically repairs moved dependencies when an unambiguous leaf match exists (while logging unresolved or ambiguous candidates).
  - **Folder/Tag Refactoring (`src/app/tag_ops/refactor.rs`):** Moving or renaming a tag or an entire folder automatically rewrites every referencing tag in the `tags/` tree so no references break.

### 6. Staged Block Organizer & Spreadsheet TSV Copy/Paste (`block_table.rs` & `tsv_paste_window.rs`)
- **Where in Baboon:** [`src/app/editor/block_table.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/app/editor/block_table.rs) & [`src/app/editor/tsv_paste_window.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/app/editor/tsv_paste_window.rs)
- **What it does:**
  - **Block Organizer Modal:** Opens a clean table of all elements in a reflexive block on a cloned candidate tag, allowing drag-to-reorder, insert, duplicate, delete, and inline name editing—committed as a single atomic undo step.
  - **TSV Block Copy/Paste:** Copy any reflexive block as tab-separated values (headers = field names, rows = elements), edit formulas/values in Excel or Google Sheets, and paste the TSV back into the block with header-to-field mapping (`map_tsv_header_to_fields`).
- **How it improves Mantle:**
  - Bulk-balancing weapon damage tables, projectile velocities, vehicle physics, or AI encounter squads in a spreadsheet and pasting them straight back into Mantle's tag editor is a massive workflow accelerator.

### 7. Advanced Strings & HUD Message Editor with Index-Safety Protection (`string_list.rs` & `hud_messages.rs`)
- **Where in Baboon:** [`docs/strings-editor.md`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/docs/strings-editor.md) & [`src/app/editor/hud_messages.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/app/editor/hud_messages.rs)
- **What it does:**
  - Highlights engine button/glyph tokens (`%a-button`, `%action`, `%custom-1`, `&a_button`, `&U+E453`, `|n`) with autocomplete popups when typing `%`, `&`, `#`, or `|`.
  - **HUD Message Index-Safety (`HudMessageUsage::Global` vs `Mission`):** Inspects `globals.globals` → `hud_globals` vs. `scenario` references. If a `hud_message_text` tag is referenced by `hud_globals`, its slot indices are hardcoded by the engine—Baboon locks row insertion/deletion/reordering behind Expert Mode while allowing safe in-place text edits. If referenced by a mission `scenario`, it warns the user to recompile `.hsc` scripts after changing row slots.
  - Supports **CSV & UTF-16 `.hmt` Amend / Replace imports** with a full diff preview before committing.

### 8. Visual Function Curve & Color-Stop Editor (`src/app/editor/function_editor/`)
- **Where in Baboon:** [`src/app/editor/function_editor/`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/app/editor/function_editor)
- **What it does:** Decodes Blam `mapping_function` (`fnct`) data blobs into an interactive curve canvas (Constant, Transition, Periodic, Linear, Cubic Spline) plus 1–4 color-gradient pickers for shader/effect/light functions.
- **How it improves Mantle:** Directly supports the "1-stop Halo modding tool" vision for authoring **lights, effects, particles, contrails, and animated shaders** visually instead of editing raw polynomial floats or byte arrays.

### 9. Win32 `WM_DROPFILES` Drag-and-Drop Directly Into Running Sapien / Guerilla (`tool_drop_delivery.rs`)
- **Where in Baboon:** [`src/app/kits/tool_drop_delivery.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/app/kits/tool_drop_delivery.rs)
- **What it does:**
  - Constructs a Win32 `DROPFILES` struct in global memory (`GlobalAlloc(GHND)` with 20-byte header + UTF-16LE `D:\...\tags\...` path) and posts `WM_DROPFILES` via `PostMessageW` to the Sapien or Guerilla window under the cursor when dragging a tag out of the browser.
  - Automatically checks `WS_EX_ACCEPTFILES` and validates whether the dragged tag's group belongs to a Sapien scenario palette (`weapon`, `vehicle`, `biped`, `scenery`, `equipment`, `device_machine`, etc.).

### 10. Bitmap Library & 3D Model Library Thumbnail Grids (`src/app/browser/`)
- **Where in Baboon:** [`README.md` L401–447](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/README.md#L401-L447)
- **What it does:**
  - Opens a workspace-wide searchable thumbnail grid of **all bitmaps** (decoded from the smallest mip level that fills the tile on background worker threads with LRU eviction) and **all 3D render/gbxmodels** (rasterized flat-shaded on background threads).
  - Supports **drag-and-drop from the thumbnail grid** directly onto any shader bitmap slot or model tag-reference field!

### 11. Cross-Engine Tag Conversion & Compatibility Database (`tag_compat.sqlite3` & `conversion.rs`)
- **Where in Baboon:** [`src/bin/build_tag_compat/tag_compat_build.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/bin/build_tag_compat/tag_compat_build.rs) & [`src/app/import/conversion.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/app/import/conversion.rs)
- **What it does:**
  - Precomputes field-level compatibility across Halo engines (`Identical`, `TargetOnly`, `RenamedProvable`, `TypeChangedSafe`, `OptionLoss`, `SourceOnly`, `HardBlocked`).
  - Converts tags across CE ↔ H2 ↔ H3 ↔ ODST ↔ Reach ↔ H4 ↔ H2A (including multi-hop in-memory routing and Xbox 360 monolithic cache hydration), holding back tags that would suffer audited data loss until the user reviews the loss report.

### 12. Constrained Transactional Runtime Memory Poking (`src/app/runtime_poke.rs`)
- **Where in Baboon:** [`src/app/runtime_poke.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/app/runtime_poke.rs)
- **What it does:**
  - Diffs the edited tag in memory against its unedited baseline, resolves the live tag table in the running game process, verifies that the process's current bytes match the expected baseline (or previous poke chain), and writes only the changed scalar/struct bytes in a transactional batch with automatic rollback if any write fails.

---

## Part 2: Architectural Plan — Transitioning OpenCE Mantle to Standard Blam-Style Loose Tags

### 1. Why Transition Away from Custom `.ocetags` JSON Containers?

Currently, OpenCE Mantle uses **two different tag representations**:
1. **`.ocetags` ([`core/src/map/container.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/core/src/map/container.ts)):** A custom JSON container format (`OCETAGS` v5) where each extracted tag's Little-Endian cache struct bytes, base64-encoded raw assets (`embeddedRawDataAssets`), relocation patches (`embeddedRawDataPatches`), and `gbxmodelGeometryParts` are stored inside a single `.ocetags` JSON file.
2. **Standard 64-byte `'blam'` Loose Tags ([`core/src/map/legacy-tag-codec.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/core/src/map/legacy-tag-codec.ts)):** Used when exporting an OpenCE Mod Package (`exportOpenCeModPackageFromMap`) or importing HEK loose tags (`parseHekLooseTagBuffer` / `importLegacyTagsIntoMap`).

**Problems with `.ocetags` as the primary format:**
- **Zero External Tool Interoperability:** Sapien, Guerilla, `tool.exe`, Invader (`invader-edit`, `invader-build`), Mozzarilla/MEK, and Baboon **cannot read `.ocetags`**. Modders cannot extract a weapon in Mantle, tweak it in Guerilla/Baboon or place it in Sapien, and re-inject or compile it without an extra conversion step.
- **Duplicate Code Paths:** Mantle currently maintains one pipeline for `.ocetags` (`extractTagSet` → `serializeContainer` → `planAddInjection`) and a second translation layer in [`legacy-tag-codec.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/core/src/map/legacy-tag-codec.ts) (`serializeContainerTagToHekLooseBuffer` ↔ `parseHekLooseTagBuffer`).
- **Base64 JSON Bloat:** Large tags (e.g., `scenario_structure_bsp`, `model_animations`, `sound`, `bitmap`, `gbxmodel`) inflate by ~33–50% in JSON base64 and require full-file JSON parsing in memory.

**What Standard Blam Loose Tags Give Us:**
- **100% Ecosystem Uniformity:** Every tag extracted or saved by Mantle is a genuine **64-byte `'blam'` (Classic BE) or `'MALB'`/`'BLAM'` (Gen3/MCC) binary tag file** stored in standard `tags/<relative_path>.<group_name>` folder layout.
- **Direct Editing Kit Compatibility:** Any folder of tags extracted by Mantle can be opened **directly as a Loose Folder workspace in Baboon, Guerilla, Sapien, Invader, MEK, and OpenCE**, tracked in Git with Baboon-style semantic Git Review, or compiled with `tool.exe build-cache-file` / `invader-build`!

---

### 2. Binary Anatomy of Standard Blam Loose Tags (What Mantle Must Read & Write)

#### 2.1 Halo CE / HEK / OpenCE Loose Tag Format (`ClassicHeader`, 64 bytes + Depth-First Big-Endian Payload)
Already partially implemented in [`core/src/map/legacy-tag-codec.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/core/src/map/legacy-tag-codec.ts#L162-L447) (`serializeContainerTagToHekLooseBuffer` and `parseHekLooseTagBuffer`), and verified against Baboon's `blam_tags::classic::ClassicHeader`:

| Byte Offset | Size | Type | Value / Description |
|---|---|---|---|
| `0x00..0x23` (`0..35`) | 36 | `char[32]` + `uint32` | Tag name (unused/zeroed in loose files; path comes from filesystem `tags/<rel_path>.<group>`). |
| `0x24..0x27` (`36..39`) | 4 | `FourCC` (BE) | Primary Tag Group FourCC in **Big-Endian** ASCII (`weap`, `bipd`, `bitm`, `mod2`, `scnr`, `sbsp`, `snd!`). |
| `0x28..0x2B` (`40..43`) | 4 | `uint32` (BE) | CRC32 checksum or tool signature (`0x4D6F7A7A` `'Mozz'` or calculated CRC). |
| `0x2C..0x2F` (`44..47`) | 4 | `uint32` (BE) | Header size = `64` (`0x00000040`). |
| `0x30..0x37` (`48..55`) | 8 | `uint64` | `0x0000000000000000` (flags / data offset placeholder). |
| `0x38..0x39` (`56..57`) | 2 | `uint16` (BE) | Tag Group Version (`HEK_GROUP_VERSIONS[fourCC]`, e.g. `bitm`=7, `mod2`=5, `coll`=10, `weap`=2, `bipd`=3, `scnr`=2, `sbsp`=5, `snd!`=4). |
| `0x3A..0x3B` (`58..59`) | 2 | `uint8[2]` | `0x00`, `0xFF` (`255` header integrity marker). |
| `0x3C..0x3F` (`60..63`) | 4 | `FourCC` (BE) | Engine signature `'blam'` (`0x626C616D`). |

**Body Serialization Rules (Offset `0x40+`):**
1. **Root Struct (`count = 1`):** All scalar fields (`int16`, `uint16`, `int32`, `uint32`, `float`, `TagID`, enums, 16/32-bit bitfields) are byte-swapped from PC Cache Little-Endian to **HEK Big-Endian**.
2. **Depth-First Child Stream (Per Struct Element, in Field Order):**
   - **`TagDependency` (16 bytes in struct):**
     - Struct holds `[group_fourcc (4B BE), name_ptr = 0 (4B), name_length (4B BE), tag_id = 0xFFFFFFFF (4B)]`.
     - If `name_length > 0`, immediately append `name_length + 1` bytes (`"<dep_path>\0"` in ASCII/Latin-1, backslash-separated, no extension) to the child stream after the current struct array.
   - **`TagDataOffset` (20 bytes in struct):**
     - Struct holds `[size (4B BE), external_flags = 0 (4B), file_offset = 0 (4B), pointer = 0 (4B), pad = 0 (4B)]`.
     - If `size > 0`, immediately append `size` raw bytes to the child stream:
       - **`Bitmap.processed pixel data`:** Concatenated raw pixel plates for all `BitmapData[]` entries; each `BitmapData[i].pixel data offset` (`+24`) stores its relative offset inside `processed pixel data`, with the `external` flag bit (`0x0100` at `+14`) cleared.
       - **`SoundPermutation.samples`:** Raw audio permutation bytes; if `compression === 0` (16-bit PCM), samples are byte-swapped to **Big-Endian** for HEK loose `.sound` compatibility (and swapped back to Little-Endian when injecting into a PC `.map` cache).
       - **`Scenario.script syntax data`:** 56-byte `ScenarioScriptNodeTable` header + `N * 20`-byte `ScenarioScriptNode` entries byte-swapped to **Big-Endian** when `0x64407440` (`'d@t@'`) magic is present.
   - **`TagReflexive` (12 bytes in struct):**
     - Struct holds `[count (4B BE), address = 0 (4B), definition = 0 (4B)]`.
     - If `count > 0`, recursively write the `count * elemSize` child struct array followed by its own depth-first children:
       - **`GBXModelGeometryPart` (`mod2`):** In compiled `.map` files, vertices and triangle strips live in the map's raw model data section and `uncompressed vertices` (`+32`) / `triangles` (`+56`) reflexives are zeroed (`nonCached: true`). In a standard Blam loose `.gbxmodel` tag, Mantle populates the `uncompressed vertices` (`68 bytes * vCount`, Big-Endian `ModelVertexUncompressed`) and `triangles` (`6 bytes * triBlockCount`, Big-Endian `ModelTriangle` padded with `0xFFFF`) reflexives inline and clears the cache-only buffer offsets (`+72..103`).

#### 2.2 Coverage Gap Analysis in Mantle's Current `legacy-tag-codec.ts`
To make standard `'blam'` loose tags our **universal, lossless format for ALL 83 Halo CE tag groups** (replacing `.ocetags`), we need to close **4 specific gaps** in [`core/src/map/legacy-tag-codec.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/core/src/map/legacy-tag-codec.ts):

1. **Gap 1 — Complete `HEK_GROUP_VERSIONS` Table for All 83 Halo CE Tag Groups:**
   - Currently `HEK_GROUP_VERSIONS` (lines 45–95) only lists 50 of the 83 Halo CE tag groups (falling back to `1` for others).
   - **Fix:** Cross-reference `SAMPLE CODE/Baboon/definitions/haloce_mcc/*.json` (and MEK / Mozzarilla `reclaimer` definitions) to populate exact version numbers for all 83 Halo CE tag classes (e.g., `matg`=3, `hudg`=1, `hud#`=1, `hmt `=1, ` sky`=1, `wind`=1, `rain`=1, `fog `=1, `boom`=1, `ant!`=1, `glw!`=1, `pphy`=1, `mply`=1, `ustr`=1, `vcky`=1, `Soul`=1, `DeLa`=1, etc.).
2. **Gap 2 — `scenario_structure_bsp` (`sbsp`) Loose Tag Serialization & Parsing:**
   - In a compiled `.map` file, `sbsp` lives in its own pre-allocated BSP virtual memory section with a 24-byte `ScenarioBSPMainHeader` and inline lightmap/collision/render pointers, and `.ocetags` explicitly banned `sbsp` (`ContainerHasBspError`).
   - In standard Blam (`HCEEK` / Guerilla / Sapien / Baboon), `.scenario_structure_bsp` is a standard 64-byte `'blam'` loose tag (`sbsp` version `5`) where `ScenarioBSP.lightmaps_bitmap` is at offset `0x00` of the root struct (immediately after the 64-byte `'blam'` header) and `uncompressed_rendered_vertices` / `compressed_rendered_vertices` / `uncompressed_lightmap_vertices` `TagDataOffset` blobs are serialized inline in depth-first order.
   - **Fix:** Add `sbsp` support to `serializeExtractedTagToBlamLooseBuffer` and `parseBlamLooseTagBuffer` so BSPs can be extracted to and imported from standard `tags/levels/.../<bsp_name>.scenario_structure_bsp` files!
3. **Gap 3 — `hud_message_text` (`hmt `) & `unicode_string_list` (`ustr`) / `string_list` (`str#`) Byte-Order Verification:**
   - Verify that `hud_message_text` (`message elements` and `messages` blocks + UTF-16LE `text data` `TagDataOffset`) and `unicode_string_list` (`UTF-16LE` string references) round-trip byte-for-byte with HCEEK `tool.exe` / Guerilla / Baboon (note: UTF-16 text inside `ustr`/`str#`/`hmt ` `TagDataOffset` blobs in Halo CE: check whether HCEEK stores UTF-16LE or UTF-16BE in loose `.unicode_string_list` / `.hud_message_text` via `SAMPLE CODE/Baboon/definitions/haloce_mcc/unicode_string_list.json` and `SAMPLE CODE/mek`).
4. **Gap 4 — Remove `.gbxmodel`-Only Filtering When Extracting General Tag Trees:**
   - Currently `exportOpenCeModPackageFromMap` in [`legacy-tag-codec.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/core/src/map/legacy-tag-codec.ts#L477-L545) has special logic tailored to `sample_mods/` (which only exported `.gbxmodel`, `.bitmap`, `.sound`, `.unicode_string_list`).
   - **Fix:** Separate **"Export OpenCE Asset Override Mod"** from **"Extract Standard Blam Tags (`tags/`)"**. Standard tag extraction must write **every selected tag and (optionally) its full recursive dependency tree** (`weapon`, `projectile`, `damage_effect`, `effect`, `particle`, `gbxmodel`, `model_animations`, `model_collision_geometry`, `shader_model`, `bitmap`, `sound`, etc.) as standard 64-byte `'blam'` loose files under `tags/<tag_path>.<group_name>`.

---

### 3. Step-by-Step Transition Architecture for OpenCE Mantle

#### Phase 1: Promote Standard Blam Loose Tags (`tags/<path>.<group>`) to Primary Format in `core/src/map/`
1. **Create [`core/src/map/blam-tag-codec.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/core/src/map/legacy-tag-codec.ts) (evolving `legacy-tag-codec.ts`):**
   - Rename/alias `serializeContainerTagToHekLooseBuffer` → `serializeBlamLooseTag(tag: ExtractedTag | OceContainerTag): Buffer`.
   - Rename/alias `parseHekLooseTagBuffer` → `parseBlamLooseTag(buf: Buffer, tagPath: string, overrideGroup?: string)`.
   - Add support for **Gen3/MCC header detection** (`'BLAM'` / `'MALB'` at `0x3C` + `'tag!'` at `0x40` + `'blay'` at `0x4C`) alongside Classic `'blam'` (`0x3C`) so Mantle's loose-tag reader can identify both Classic (Halo CE / H2) and Gen3/MCC (H3 / ODST / Reach / H4 / H2A) loose tags.
2. **Add Direct Map → Standard `tags/` Folder Extractor (`extractMapTagsToBlamDirectory`):**
   - Given an open `.map` buffer, selected root tag indices, an output `tags/` root directory, and options (`includeDependencies: boolean`, `overwritePolicy: 'always' | 'never' | 'prompt'`, `hydrateExternalResources: boolean`):
     - Extracts the tag set from the map (`extractTagSet` + `hydrateExternalRawDataInContainer` from `bitmaps.map` / `sounds.map`).
     - Serializes every tag to its 64-byte `'blam'` binary file at `<outputRoot>/<tag.path.replace(/\\/g, '/')>.<tag.group>`.
     - Returns a Baboon-style `TagExtractionReport` (files written, skipped/kept, external resource hydration warnings, and unresolved references).
3. **Add Portable `.blamtags.zip` (or Folder) Bundle Support:**
   - When a user wants to share a single-file tag pack (the way `.ocetags` was used), instead of a proprietary JSON blob, package the standard `tags/<relative_path>.<group>` files + an optional `mod.toml` / `manifest.json` inside a standard `.zip` archive (or a loose `tags/` folder).
   - Anyone can unzip it directly into `HCEEK\tags\`, open it in Baboon/Guerilla/Sapien, or drop the `.zip` / folder straight into OpenCE Mantle to inject into a `.map`!

#### Phase 2: Native Loose `tags/` Workspace Mode in OpenCE Mantle Desktop
Right now, Mantle is **`.map`-centric** (you must open a compiled `.map` cache file first). Inspired by Baboon's `TagSource::LooseFolder`, we should allow Mantle to **open a `tags/` directory directly as a workspace** (just like Guerilla, Sapien, and Baboon):
1. **Dual Workspace Source (`MapWorkspace` vs `LooseTagsWorkspace`):**
   - **Open `.map` Cache File:** Existing workflow (reads/edits tags inside `.map`, extracts to `tags/`, injects from `tags/`).
   - **Open `tags/` Folder (Editing Kit Mode):**
     - Scans `<kit>/tags/` lazily with a persistent SQLite/JSON fingerprint cache (`mtime` + `size`).
     - Clicking any `.weapon`, `.biped`, `.gbxmodel`, `.bitmap`, `.sound`, `.scenario`, `.unicode_string_list`, or `.hud_message_text` file parses it via `parseBlamLooseTag`, opens it in Mantle's existing rich editors (3D Model Viewer, Bitmap Viewer, Sound Player, Tag Field Editor, Script Editor, Scenario 3D Viewport!), and **saves `Ctrl+S` directly back to the 64-byte `'blam'` loose tag file on disk** via `serializeBlamLooseTag`!
2. **Backwards Compatibility with `.ocetags`:**
   - Keep `deserializeContainer` in [`core/src/map/container.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/core/src/map/container.ts) as a **legacy import fallback** and provide a 1-click **"Convert `.ocetags` to Standard Blam `tags/` Folder"** utility so no previously saved user files are stranded.

#### Phase 3: Adopt Baboon's Multi-Engine JSON Definitions (`SAMPLE CODE/Baboon/definitions/`)
- Baboon's `definitions/<game>/*.json` schema format (`_meta.json` + per-group JSON layouts for `haloce_mcc`, `halo2_mcc`, `halo3_mcc`, `halo3odst_mcc`, `haloreach_mcc`, `halo4_mcc`, `halo2amp_mcc`, `haloce_evolved`) is clean, self-contained, and already mapped to `blam-tags`.
- We can write a lightweight loader in `core/src/map/definitions/` that reads Baboon's `definitions/<game>/*.json` schemas so Mantle's Tag Field Editor, Block Organizer, TSV Copy/Paste, and Semantic Tag Diff automatically work across **all 8 Halo engines**.

---

## Part 3: Recommended Implementation Roadmap

| Priority | Feature / Milestone | Source Reference in `SAMPLE CODE/Baboon` | Target Files in `OpenCE-Mantle` |
|---|---|---|---|
| **P0** | **Standard Blam Loose Tag Transition** (Make 64-byte `'blam'` loose tags in `tags/<path>.<group>` the default extract/export/import/save format across all 83 CE tag groups, including `sbsp`, with `.ocetags` kept only as legacy import) | [`src/core/source/loading.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/core/source/loading.rs) | [`core/src/map/legacy-tag-codec.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/core/src/map/legacy-tag-codec.ts), [`desktop/electron/main.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/desktop/electron/main.ts), [`desktop/src/App.tsx`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/desktop/src/App.tsx) |
| **P1** | **Loose `tags/` Editing Kit Workspace Mode** (Open `HCEEK/tags` or any `tags/` folder directly in Mantle, edit tags in-place, save `Ctrl+S` back as standard `'blam'` files, with incremental `mtime`/`size` index & reverse dependency graph) | [`src/core/source/mod.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/core/source/mod.rs), [`src/core/source/index.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/core/source/index.rs) | `core/src/map/loose-workspace.ts` (new), [`desktop/src/App.tsx`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/desktop/src/App.tsx) |
| **P1** | **Content Explorer, Reference Jump & Auto-Fix Broken Dependencies** (Two-column `Referenced by` / `References` browser, auto-heal moved `TagDependency` paths by leaf match, and safe Tag/Folder Rename/Move refactoring that rewrites referrers) | [`src/app/references/explorer.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/app/references/explorer.rs), [`dependencies.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/app/references/dependencies.rs), [`src/app/tag_ops/refactor.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/app/tag_ops/refactor.rs) | [`core/src/map/tag-reverse-dependencies.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/core/src/map/tag-reverse-dependencies.ts), [`desktop/src/App.tsx`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/desktop/src/App.tsx) |
| **P2** | **HaloScript Multi-Engine IntelliSense & Examples** (Integrate `docs/script_docs.sqlite3` + `tool_commands/*.json` for HSC hover docs, autocomplete, network-safety badges, and visual `tool.exe` Command Runner) | [`docs/script_docs.sqlite3`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/docs/script_docs.sqlite3), [`tool_commands/haloce_mcc.json`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/tool_commands/haloce_mcc.json) | [`core/src/map/hs-compiler.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/core/src/map/hs-compiler.ts), [`desktop/src/App.tsx`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/desktop/src/App.tsx) |
| **P2** | **Staged Block Organizer, Spreadsheet TSV Copy/Paste & Function Curve Editor** (Reorder/duplicate/rename block elements, copy/paste blocks to/from Excel/Sheets via TSV, and interactive `mapping_function` curve/color editor) | [`src/app/editor/block_table.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/app/editor/block_table.rs), [`tsv_paste_window.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/app/editor/tsv_paste_window.rs), [`function_editor/`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/app/editor/function_editor) | [`desktop/src/App.tsx`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/desktop/src/App.tsx) |
| **P3** | **Semantic Tag Diff (`align_by_identity` + `align_by_content` LCS) & Git Review Tab** (Compare any two loose tags or review local/committed Git changes on a `tags/` repo semantically) | [`src/app/compare/diff.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/app/compare/diff.rs), [`git_review.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/app/compare/git_review.rs) | [`core/src/map/map-compare.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/core/src/map/map-compare.ts) |
| **P3** | **Bitmap & 3D Model Library Grids + Win32 `WM_DROPFILES` Sapien Drag-and-Drop** | [`src/app/kits/tool_drop_delivery.rs`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/SAMPLE%20CODE/Baboon/src/app/kits/tool_drop_delivery.rs) | [`desktop/electron/main.ts`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/desktop/electron/main.ts), [`desktop/src/App.tsx`](file:///C:/Users/LeviB/Projects/OpenCE-Mantle/desktop/src/App.tsx) |
