# Tag Definition Sources

This file is the provenance record for every entry in `groups/*.json`. It is generated/maintained
alongside the schema and must be updated whenever a definition is added, promoted, or corrected.

## How these were produced

`scripts/generate-definitions.mjs` reads tag definition JSON **directly from a local clone of
Invader** (`git clone https://github.com/SnowyMouse/invader.git`, commit `696830ff80af227e84e7237c2ef26eb2301ed110`,
read 2026-08, GPL-3.0-only, **reference only - no Invader source files are copied into this repo**)
and transcribes the same facts (field names/types/sizes, enum options, bitfield widths, struct
sizes) into our own JSON files. Byte offsets are **not** stored in the JSON; `engine.ts` computes
them at load time by walking each struct's field list, and cross-checks the result against the
struct's declared `sizeBytes` (itself cross-validated earlier this session - every Invader struct
size is covered by a C++ `static_assert`, so it is ground truth, not a guess).

Where Invader has no definition for a tag group (`spheroid`, `ui_widget_collection`) or is silent
about an on-disk detail (the `scenario_structure_bsp` cache indirection below), the second
reference clone was used: `git clone https://github.com/Sigmmma/reclaimer.git`, commit
`a0a56ca7e95957e4cef165f606ae6ab6b659113a`, read 2026-08, GPL-3.0-only, reference only.

Where the two sources could conflict, the resolution rule applied was: Invader is primary;
Reclaimer fills gaps or cross-checks. For the two base sizes that matter everywhere
(`TagDependency` = 16 bytes, `TagReflexive` = 12 bytes) both sources independently agree exactly
(`reclaimer/reclaimer/common_descs.py`: `dependency()`/`reflexive()` helpers). No other conflicts
were found between the two sources for the groups covered this round.

## Abstract tag "base classes"

Several `TagDependency` fields declare an abstract class name (`model`, `item`, `unit`, `device`,
`object`, `shader`, or the wildcard `*`) instead of a literal tag group. Confirmed this session by
reading `invader/src/tag/parser/compile/object.cpp` (the switch that resolves predicted resources
falls through every `shader_*` fourcc and `TAG_FOURCC_GBXMODEL` into the same case as the abstract
name) and then validating all expansions against every dependency field in both sample maps
(`ABSTRACT_CLASS_EXPANSIONS` in `validate-tag.ts`). Zero dependency-resolution failures remain in
either sample map with this expansion table.

## Key finding this session: `scenario_structure_bsp` cache indirection

Invader's JSON (`scenario.json`, struct `ScenarioBSP`) declares `bsp_start` as the BSP's file
offset. Reading real bytes in `bloodgulch.map`/`ui.map` at that offset produced garbage (billions
in reflexive counts, non-ASCII fourccs) - `bsp_start` actually points at a **24-byte cache header**
undocumented in Invader (`meta_pointer` + 2 compressed/uncompressed lightmap-material count/pointer
pairs + a trailing `"sbsp"` signature), confirmed via `reclaimer/reclaimer/hek/defs/sbsp.py`
(`sbsp_meta_header_def`, comment: *"to convert these pointers to offsets, do: pointer - bsp_magic"*).
The real root struct is at `bsp_start + (meta_pointer - bsp_address)`. After this fix, every field
in both sample maps' BSPs decodes to plausible values (sane world-bounds bounding boxes, small
sane reflexive counts) and the full round-trip/dependency/bounds validation passes with zero
failures. See `validate-tag.ts` → `locateStructureBsp`.

## Per-group coverage: tags actually tested

`scripts/report-coverage.ts` counts how many internal (non-external) tags of each group exist
across `bloodgulch.map` + `ui.map`'s tag indices - this is "tested" in the sense that
`tests/definitions.test.ts` and `tests/dependency-walker.test.ts` exercised every one of them
(round-trip, dependency resolution, reflexive bounds). 61 of 83 groups have at least one tag
tested this way; the other 22 simply never occur as a root tag in either sample map (several are
abstract base classes - `object`, `item`, `unit`, `device`, `shader`, `model` - that are never a
concrete tag's own class, only referenced via the abstract-class expansion table).

### Tested (group → tag count across both sample maps)

| group | tags tested |
|---|---|
| actor_variant | 4 |
| antenna | 3 |
| biped | 2 |
| bitmap | 222 |
| camera_track | 9 |
| color_table | 8 |
| contrail | 12 |
| damage_effect | 86 |
| decal | 43 |
| dialogue | 1 |
| effect | 379 |
| equipment | 16 |
| flag | 1 |
| font | 4 |
| gbxmodel | 75 |
| globals | 2 |
| grenade_hud_interface | 4 |
| hud_globals | 2 |
| hud_message_text | 1 |
| hud_number | 2 |
| input_device_defaults | 46 |
| item_collection | 14 |
| lens_flare | 33 |
| light | 46 |
| light_volume | 10 |
| material_effects | 5 |
| meter | 4 |
| model_animations | 22 |
| model_collision_geometry | 38 |
| multiplayer_scenario_description | 1 |
| particle | 138 |
| particle_system | 14 |
| physics | 5 |
| point_physics | 43 |
| projectile | 23 |
| scenario | 2 |
| scenario_structure_bsp | 2 |
| scenery | 20 |
| shader_environment | 15 |
| shader_model | 127 |
| shader_transparent_chicago | 50 |
| shader_transparent_chicago_extended | 11 |
| shader_transparent_glass | 6 |
| shader_transparent_meter | 4 |
| shader_transparent_plasma | 1 |
| sky | 2 |
| sound | 29 |
| sound_environment | 1 |
| sound_looping | 19 |
| sound_scenery | 1 |
| string_list | 2 |
| tag_collection | 8 |
| ui_widget_collection | 2 |
| ui_widget_definition | 1138 |
| unicode_string_list | 168 |
| unit_hud_interface | 5 |
| vehicle | 6 |
| virtual_keyboard | 1 |
| weapon | 20 |
| weapon_hud_interface | 23 |
| wind | 1 |

**Zero failures across all 61 tested groups** (round-trip + dependency + reflexive bounds).

### Untested — "read from source, untested" (0 tags in either sample map)

`actor`, `continuous_damage_effect`, `detail_object_collection`, `device`, `device_control`,
`device_light_fixture`, `device_machine`, `fog`, `garbage`, `glow`, `item`, `lightning`, `model`,
`object`, `placeholder`, `preferences_network_game`, `shader`, `shader_transparent_generic`,
`shader_transparent_water`, `spheroid`, `unit`, `weather_particle_system`.

These are **read from source, untested** — field layout was read from Invader (or Reclaimer for
`spheroid`) the same as every other group, but never exercised against a real tag because none
exist as a root entry in either sample map. `object`/`item`/`unit`/`device`/`shader`/`model` are
the abstract base classes (see "Abstract tag base classes" above) — they're never a concrete
tag's own class. `spheroid` additionally remains **uncertain** per its own entry above.

## Per-group table

Legend - **status**: `full` (every field defined) · `uncertain` (no reliable source exists).
**basis**: `read from source` (opened the file this session) · `cross-checked against a real map`
(also empirically verified against bloodgulch.map/ui.map) · `from memory`.

| group | status | source | basis | missing/uncertain | tag-ref list complete? |
|---|---|---|---|---|---|
| (79 of 83 groups not listed individually below) | full | invader/src/tag/hek/definition/\<group\>.json, commit 696830f | read from source | none known | yes |
| scenario, scenario_structure_bsp, bitmap, gbxmodel, sound, weapon, projectile, vehicle, biped, scenery, shader, shader_environment, shader_model, shader_transparent_chicago, shader_transparent_chicago_extended, shader_transparent_generic, shader_transparent_glass, shader_transparent_meter, shader_transparent_plasma, shader_transparent_water | full | same as above | read from source + cross-checked against bloodgulch.map and ui.map (every tag of these groups decoded, round-tripped byte-identical, all dependencies/reflexives validated, zero failures) | none known | yes |
| scenario_structure_bsp | full | invader/.../scenario.json (struct fields) **and** reclaimer/reclaimer/hek/defs/sbsp.py (`sbsp_meta_header_def`, cache-header indirection Invader does not document) | read from source + cross-checked against bloodgulch.map and ui.map | none known after the meta-header fix; see "Key finding" above | yes |
| meter | full | invader/.../meter.json | read from source + cross-checked against bloodgulch.map and ui.map | `stencil bitmaps`/`source bitmap` are `non_cached` ("gets dereferenced on map build" per Invader's own comment) - correctly excluded from cache-time dependency validation, bytes still preserved byte-for-byte | yes |
| spheroid | **uncertain** | reclaimer/reclaimer/hek/defs/boom.py | read from source, but Reclaimer's own comment says *"this is just a guess... effing useless tag type"*; Invader has no definition at all; no `.spheroid` tag exists in either sample map to cross-check against | single 4-byte field, meaning unknown (could be padding) | not applicable (no TagDependency fields) |
| ui_widget_collection | full | reclaimer/reclaimer/hek/defs/Soul.py (Invader has no definition) | read from source + structurally cross-checked (its only fields are a `TagReflexive`/`TagDependency`, whose sizes are independently confirmed by both repos) + validated against ui.map (1 real tag, zero failures) | none known | yes |

All 83 groups were validated by `tests/definitions.test.ts` against every matching tag in both
`bloodgulch.map` and `ui.map`: **zero failures in every group**, not just the 19 originally-scoped
Tier-1 groups (see "Note on scope" below).

## Note on scope vs. the Tier-1/Tier-2 plan

The brief's plan was: fully define 19 "Tier-1" groups, and leave the other 64 groups
"reference-only" (tag references + reflexives only, not guessing other fields). In practice,
because the generator reads full struct data directly from Invader for every group at the same
cost, **all 83 groups ended up with complete, source-read field data**, not just Tier-1. All of
them were run through the same validation (round-trip + dependency resolution + reflexive bounds)
against both sample maps, and all passed with zero failures. There was no "reference-only, don't
guess" shortcut taken for the Tier-2 groups - they are accurate, not guessed, simply because reading
the full struct from source was no more work than reading only its reference fields. Flagging this
as a deviation from the plan for visibility, not hiding extra scope delivered.

## Known simplifications (not a correctness bug, scoped out this round)

- Component names inside composite geometry types (`Point3D`, `Matrix`, `Euler3D`, etc.) are
  stored as plain ordered number arrays, not named sub-fields (e.g. `{x,y,z}`). Byte layout is
  exact; only the human-friendly field naming is deferred to M7.
- `TagDataOffset` external-resource resolution (`external_file_offset`/`file_offset` metadata,
  e.g. `sound.json`'s `samples` field referencing `sounds.map`) was not carried into the schema or
  validated this round - only whole-tag external references (`isExternal` on the tag index entry,
  e.g. `bitmaps.map`) were validated. Round-trip byte preservation for `TagDataOffset` fields is
  unaffected (generic codec, doesn't need to know the field is external).
- Per-mipmap `BitmapDataFlags.external` bit (a second, rarer externality mechanism inside an
  internal bitmap tag, per Invader's comment "for Gearbox versions and CEA") was not checked - no
  bitmap data in either sample map was found to use it, so this gap is moot for the current data.

## Milestone 5, Step A findings (2026-08) - verified, not asserted

Investigated before writing any injection code, per explicit user requirement. All claims below
are cited against the real Invader source (`/tmp/invader`, commit 696830f) and cross-checked
against real bytes in the sample maps, not inferred.

- **Per-mipmap/per-sound-permutation externality (`external=0` vs `external=1`) is a raw file
  offset either way, never a resource-map index.** `external=1`: `pixel_data_offset`/
  `samples.file_offset` is a byte offset INTO bitmaps.map/sounds.map (`invader/src/resource/
  resource.cpp` ~line 427/525, `bitmap_data.pixel_data_offset = ab.data_offset`). Verified against
  real bytes: every one of ui.map's 222 internal bitmaps' `pixel data offset` exactly matches a
  `dataOffset` entry in the sample `bitmaps.map`'s own resource table (e.g. "star mask":
  offset=16, size=2744, matches entry 0 exactly). `external=0`: the SAME field is instead an
  ABSOLUTE FILE OFFSET into THIS map's own raw-data region (`invader/src/build/
  build_workload.cpp` line ~1430, `bitmap_data.pixel_data_offset = all_assets[idx].first +
  file_offset`). **This raw-data region's start is NOT stored anywhere in a compiled map** - it's
  the implicit gap between `end_of_bsps` and `model_offset` in `generate_final_data` (lines
  ~278-300); unlike `model_data_file_offset` (which IS a stored header field and is unrelated -
  it's 3D vertex data, not bitmap/sound bytes), there is no discrete field recording where the
  raw-data region begins. Reconstructing it from a compiled file alone is under-determined.
  **UPDATE 2026-08 (coldsnap.map, a real custom map, 396 embedded assets - 350 bitmap + 46
  sound - the first real embedded-data sample obtained)**: the region's START is still not
  stored, but its END is, and relocation doesn't need the start at all. Verified by exact
  arithmetic on real bytes: `max(embedded fileOffset + size) == tagIndex.modelDataFileOffset`
  (54552850 == 54552850, to the byte), and `modelDataFileOffset + modelDataSize == header.
  tagDataOffset` (70610858 == 70610858) and `tagDataOffset + tagDataSize == decompressedFileSize`
  (79925558 == 79925558) - the whole file is accounted for with zero slack: `[prefix incl.
  BSP][embedded bitmap/sound data, ending exactly at modelDataFileOffset][model data][tag data]`.
  Also reconfirmed the embedded offset is a plain absolute file offset, not a memory-address
  translation: `baseMemoryAddress` is ~1.08 billion (a virtual address) vs embedded offsets of
  ~26-54 million (file-sized magnitude) - different domains entirely. **Consequence**: reading an
  embedded asset never needed the region start (just its own stored offset+size, already
  bounds/overlap/readability-verified by `embedded-data-verifier.ts`). Writing a relocated copy
  doesn't either, IF inserted immediately before `modelDataFileOffset` (shifting model+tag data
  forward by the inserted size and incrementing exactly 3 stored fields -
  `modelDataFileOffset`/`tagDataOffset`/`decompressedFileSize` - by that same delta; every
  existing struct pointer auto-shifts via the same `tagDataOffset`-relative anchor already used
  for M5's tag-array growth, needs zero per-pointer rewriting). This is a structural/arithmetic
  finding from ONE real map, not yet validated by an actual in-game round-trip - proposed to the
  user 2026-08, awaiting approval before implementing (see PRD.md Decisions).
  **Consequence for M5**: embedded (`external=0`) bitmap/sound relocation is DISABLED - tags
  needing it are blocked with a plain-language warning, never silently written. Neither sample
  map contains a single real embedded asset to verify a relocation implementation against anyway
  (scanned: 222 internal ui.map bitmaps + 125 ui.map sound permutations, 100% external=1;
  bloodgulch.map has zero internal bitmap/sound tags at all - every one is whole-tag-indexed).
  **UPDATE 2026-08 (relocation BUILT, still disabled by default - see PRD.md "Relocation
  research" for the full research report, remaining risk list, and exact Windows test steps)**:
  implemented in `embedded-data-fields.ts`/`tag-extractor.ts`/`tag-injector.ts`, verified against
  real coldsnap.map bytes in `embedded-relocation.test.ts` (extract+inject into bloodgulch.map
  AND back into coldsnap.map itself, full 1500+ tag closure re-parse, Verify Embedded Data
  before/after). Gated behind `InjectionOptions.allowEmbeddedRelocation` (default false,
  `map-worker.ts` never sets it) - the user has NOT yet approved flipping this on for the real
  app; it is exercised only by tests until they do.
  - **Correction found while re-verifying this**: `invader/src/build/build_workload.cpp`'s
    `REQUIRED_PADDING_32_BIT` macro does NOT mean every real compiled map's `tagDataOffset`/
    `modelDataFileOffset` is 4-byte aligned - coldsnap.map's own values are both ≡ 2 mod 4. The
    implementation still zero-pads the inserted blob to 4 bytes (harmless, preserves whatever
    alignment the source had), but this is NOT asserted as a hard invariant anywhere.
  - **Every other `TagDataOffset`-typed field in the schema** (scenario script/comment data,
    font pixels, string_list/unicode_string_list strings, meter stencil, hud_message_text,
    input_device_defaults, model_animations frame data) is a DIFFERENT, already-safe mechanism:
    confirmed via `invader/src/tag/code_generator/compile.py` line 140 - the generic codegen path
    registers the field's `.pointer` member for the SAME struct/pointer-fixup pass used for
    `TagReflexive`/`TagDependency`, and never writes `.file_offset`/`.external` for these groups
    at all. Real-byte spot checks confirm this: e.g. a `string_list` tag's `external` sub-field
    reads back as `3787653199` (garbage) while its `.pointer` is a normal-looking virtual
    address. `gbxmodel` vertex/index data is likewise a real virtual-address pointer at compile
    time (`build_workload.cpp` ~line 2388, `vertex_ptr.offset = &part_data.vertex_offset`), not a
    raw file offset - safe under the same translation, confirmed by source even though our own
    schema doesn't model those specific fields yet.
  - **A separate, pre-existing bug found during this research (NOT fixed, logged as a tracked
    P0 in PRD.md)**: `tag-extractor.ts`'s `flattenStruct` never flattened the `.pointer`-based
    data for plain `TagDataOffset` fields (the mechanism above) - only `TagReflexive`/
    `TagDependency`. Extracting+injecting a font/string_list/meter/hud_message_text/
    input_device_defaults/model_animations/scenario tag silently drops that real data. Confirmed
    concretely: `ui\ticker` (the font tag used as the "clean baseline" case in
    `tag-injector.test.ts`) has 31,066 real bytes of glyph pixel data via this mechanism that
    gets dropped today. Unrelated to bitmap/sound embedding (orthogonal tag groups).
  - **Also newly confirmed, not previously stated**: `bsp_start` (`ScenarioBSP`, inside the
    `scenario` tag) is a genuine absolute file offset, but it always resolves to BEFORE the
    embedded-data insertion point in every real map checked (coldsnap: BSP data ends at
    26,396,672, insertion point is 54,552,850) - it never needs patching.

- **Whole-tag indexing (mechanism A, already implemented pre-M5 via `resource-map.ts`
  `resourceIndexResolves`) and per-asset data externality (mechanism B, above) are two unrelated
  mechanisms.** Mechanism A: the tag index entry's own `isExternal` bit + `tagDataPointerOrResourceIndex`
  (an actual resource-map ENTRY INDEX) means the WHOLE tag definition lives in bitmaps.map/
  sounds.map/loc.map. Mechanism B (this session) is per-field, inside an otherwise-internal tag.
  A tag can be internal under mechanism A yet still reference bitmaps.map/sounds.map under
  mechanism B (e.g. every internal bitmap in ui.map).
- **Secondary/tertiary tag classes are real, non-trivial data** (280/2455 bloodgulch.map entries
  have a non-null secondary class, e.g. every concrete `shader_transparent_*` tag also carries
  secondary class `shdr`) but were NOT captured by M4's `ExtractedTag`/`OceContainerTag` - fixed
  this session (`secondaryClassFourCC`/`tertiaryClassFourCC` added, container bumped to v2).
  Preserved defensively on injection (copied byte-for-byte from the source tag index entry) since
  our own `validate-tag.ts` doesn't consume them for dependency validation and their exact runtime
  significance to the game engine wasn't independently confirmed either way - preserving them is
  harmless and byte-faithful regardless.
- **Every pointer in the tag-data region resolves via ONE global anchor.** Confirmed against
  Invader's actual MAP READER (not just the builder) - `invader/src/map/map.cpp` line 244:
  `base_memory_address = tag_data_header->tag_array_address - sizeof(CacheFileTagDataHeaderPC)`
  (0x28), algebraically identical to this project's pre-existing `tag-index.ts` derivation. This
  means growing the tag array (M5 ADD mode) does NOT require rewriting any existing tag's internal
  pointers: decrementing the single stored `tag_array_address` field by the array's growth in
  bytes re-anchors every existing reflexive/path/tag-data pointer to the physically-shifted
  positions automatically. Verified empirically, not just by citation: `tag-injector.test.ts`
  re-parses an injected copy of bloodgulch.map with this project's own reader and runs
  `validateStructInstance` over every old AND new tag (1500+ tags), zero errors.
- **New tag IDs use the same salt formula as tool.exe**: `invader/src/build/build_workload.cpp`
  line 1230, `full_id = ((tag_index + 0x6174) | 0x8000) << 16 | (uint16)tag_index`.
- **Decision (not silently made - this is the record of it)**: `TagDependency.pathPointer`/
  `pathSize` fields are tool-only convenience fields (not dereferenced by the game at runtime,
  per Invader's struct comments) and are already stale the moment a tag is extracted from its
  source map. M5's injector zeroes them (rather than leaving source-map garbage) on every
  dependency it rewrites, since there is one clearly-correct answer here, not a judgment call.
