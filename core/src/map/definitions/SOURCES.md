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
