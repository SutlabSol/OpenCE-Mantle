# OpenCE notes (what the converter's output must pass)

Read-only research of OpenCE's source. No OpenCE code is copied here; names are cited so they can be
found again. Everything below was read at the pinned commit unless marked otherwise.

## Version

- Tested by the user: **OpenCE build 185**.
- Pinned commit: **6399ed9d4ab1e6bbcd6154d56703883dfcc17c22** = tag `build-185` on
  github.com/OpenCommunityEdition/OpenCE (checked with `git ls-remote`, 2026-10-11). It was also `main`
  at that time. Every citation in PRD "OpenCE findings and tag data repairs" was read at this commit.
- Local scratch clone (optional, never committed): `C:\temp\OpenCE-src` (shallow, read-only).

### Refresh when OpenCE updates

1. `git -C C:\temp\OpenCE-src ls-remote origin "refs/tags/build-*"`: the newest build tag and its commit.
2. `git -C C:\temp\OpenCE-src fetch --depth 1 origin tag build-NNN`, then `git -C C:\temp\OpenCE-src checkout build-NNN`.
3. Re-check each function in the table below by name (`git grep -n <name>`); update the build, commit and
   any changed rule here and in the PRD.

## Log files (Windows build)

- `debug.txt`: per port/windows/README.md it is in the data root (the folder that contains `maps\`); on
  the user's install that is next to halo.exe. It is cumulative: rename it before a test. Every line
  is flushed when written (`write_to_debug_file`, source/cseries/errors.c), so a missing line was never
  written; it was not lost in a buffer.
- `halo.log`: next to halo.exe (the release build's port log).
- A crash writes `crash:` lines to debug.txt (`crash_filter`, port/windows/src/win32_crash.c) and ends
  the process; `crashes\` holds reports only until they are sent. No `crash:` line and a live process =
  not a crash.

## Checks that matter

| Check | Where | Requires | Log line |
| --- | --- | --- | --- |
| Map identity, size | `custom_edition_cache_tags_load`, port/linux/game/custom_edition_cache.c | CE cache, file <= 0x30000000; bitmaps.map / sounds.map <= 512 MB each | "custom edition: '...' is not a loadable cache (...)", "a resource map is too large for this loader" |
| Load (tags, BSP, models, shaders, resources) | `custom_edition_cache_load`, port/linux/game/cache_file_formats.c | every tag address inside the tag data; tag data in the 0x1700000-byte tag cache at 0x40440000; index/vertex/instance offsets 4-aligned; BSP, model, shader, animation, resource checks (one status each) | "custom edition: cannot load '...': <status> (tag N, 0x...)" |
| Block extents | `validate_data_extent` / `validate_block_extent` / `claim`, port/linux/game/tag_validate.c | every block and data range inside the tags, no byte claimed twice; order: header, tag table, roots, then each tag | "the map '...' ... outside the tags or overlapping another's" |
| Tag references | `validate_tag_index`, tag_validate.c | the full tag ID (salt included) must equal the entry's, and the group must match; otherwise **corrected to NONE** (not refused) | "the map '...' is corrected: ... names XXXXXXXX, not a tag of ...: none"; then "custom edition: the map's tags needed N corrections (above)" |
| Script data | `hs_scenario_syntax_data_valid` / `hs_allocate`, source/hs/hs.c | size 56+19001x20, inside the tag cache, absolute address 4-aligned, header signature 'd@t@', maximum 19001, element 20, valid, counts in range; string data >= 0x400 B in the tag cache | "the scenario's script data is missing or damaged; its scripts won't run". **Fatal** (see below): the load stops on the blue halt screen |
| Data array free slots | source/memory/data.c (`datum_new`, `datum_try_and_get`, `data_next_index`, `data_iterator_next`, `data_delete_all`) | identifier 0 = free slot | none |
| Predicted resources | `predicted_resource_valid`, source/cache/predicted_resources.c | tag of the right group; bitmap index < the bitmap's count | "predicted resource of type T names tag X resource R (not precached)" (once per process; the entry is skipped) |
| Texture / sound cache | source/cache/xbox_texture_cache.c, xbox_sound_cache.c; sizes in port/linux/include/halo_port_capacity.h | desktop: textures 256 MB, sounds 16 MB, LRU | "YOU GOT STABBED" (texture drawn as default) / "SOUND CACHE BLOWN" |
| BSP placement | `custom_edition_structure_bsp_reference_valid`, custom_edition_cache.c | BSP loads above the tag data and inside the tag cache | "a structure bsp's ... outside its tag cache" |
| Model parts | `custom_edition_model_verify` / `custom_edition_model_part_verify`, port/linux/game/custom_edition_geometry.c | see "theisland_3: model part check" below | "custom edition: part P of geometry G of the model '...' names a node, vertex, shader or part that does not exist, or has a vector this build cannot compress", then "cannot run '...'" and "game_load() failed." (fatal) |

## Fatal messages: why the blue screen has no log line after it

- `error(priority, ...)` (source/cseries/errors.c) writes the line to debug.txt first; when the priority
  is 0 (`_error_immediate`, cseries/errors.h) it then calls `system_exit(-4998)`. That never returns:
  `system_exit` (cseries/cseries_windows.c) goes to `halt_and_catch_fire` (main/main.c), which draws a
  frame with blue fog and the recent messages, forever. `error()` holds its recursion lock until it
  returns, so it never does and nothing else is logged. The process keeps running (CPU and GPU busy):
  no crash, no `crash:` lines, no `crashes\`.
- `hs_allocate` logs "the scenario's script data is missing or damaged; its scripts won't run" with
  `error(0, ...)`: **fatal**, although the code around it means to carry on (scripts disabled, its own
  empty array). The other `error(0, ...)` calls on the script path are fatal the same way
  ("couldn't allocate script syntax data"; in `hs_scenario_postprocess`: too many globals or scripts,
  "recompiling scripts ...", "the scenario's scripts won't run").
- `hs_scenario_postprocess`'s FALSE return is not what stops the load: its three callers
  (`hs_initialize`, `hs_hack`, `hs_initialize_for_new_map`, all hs.c) ignore it. The halt happens
  earlier, inside `hs_allocate`.
- "game_load() failed." is also `error(0, ...)` (networking/network_game_manager.c,
  `network_game_create_game_objects`; main/main.c `main_new_map` uses `_error_immediate` explicitly),
  so a refused map (theisland_3_ce) ends on the same blue screen, after its reason is logged.
- Correction: the previous version of these notes said the script message was harmless and that the
  code showed no matching stop. Both were wrong: the priority 0 was misread as non-fatal.

## Other load-path findings (heh_2; build 185, code reading and read-only byte scans)

- **"predicted resource of type 0 names tag ffffffff resource 4".** heh_2's
   `weapons\sniper rifle\sniper rifle` (#1254) predicted resource [0] is bitmap index 4 of tag 0x000004E9
   (salt 0; the entry is 0xE65D04E9, a 1-image bitmap). The loader corrects the ID to NONE, so the
   check skips it and logs once per process. It is predicted by `game_engine_predict_resources`
   (game_engine.c, from `game_engine_initialize_for_new_map`, before the script message) only when the
   game variant's weapon set maps a slot to the sniper rifle. So it depends on the game variant, not on
   release vs debug. It cannot stall: the entry is skipped.
- **Limits vs heh_2.** All of these are refused with a message or logged, none is waited on: file size,
   resource map sizes, tag cache 0x1700000 (heh_2 tag data 5.5 MB; BSP at 0x419CD800, 16.9 MB above the
   tag data end, the same address as CE bloodgulch's), texture cache 256 MB (LRU; heh_2 has 44.4 MB of pixels),
   sound cache 16 MB (LRU; 12.0 MB of samples), objects 8192, predicted resources (no count limit; the
   loop is long). The raw region size is not checked as such, only each range. No bitmap or sound count
   limit was found in the CE loader.
- **Alignment repair for heh_2 (verified by reading the bytes, read-only script).** heh_2's script
   header is valid in every field (signature, maximum 19001, element 20, valid 1, counts 0, string data
   1,024 B in the tag data) and identical to CE bloodgulch's apart from its address (0x4047A916, 2 mod
   4). An aligned copy passes `hs_scenario_syntax_data_valid`; the engine then uses the map's own array
   (count 0), `hs_compile_postprocess` finds no nodes and returns TRUE: CE bloodgulch's path. Decided
   and built: the repair is now required for every unaligned script array (commit a346a97).
- **Rare paths in the HaloMD maps.** heh_2: every root, 6,982 of 7,368 blocks and 2,052 of 2,133 data
   fields are 2 mod 4 (theisland_3 similar). CE bloodgulch and coldsnap: 0. x86 reads unaligned values,
   but no CE map exercises this. 850 of 1,407 predicted resources carry stale salts (CE bloodgulch,
   the same 1,407 in 101 lists: 0; theisland_3: 0), so they are corrected to NONE. One stale reference
   (BSP sound environment). Tag data file offset 8,721,390 (2 mod 4): no effect (the tag data is copied
   to 0x40440000; coldsnap's is 2 mod 4 too and loads).

## Results in OpenCE (build 185, debug build; user, 2026-10-11)

| Map | Result |
| --- | --- |
| bgali: CE bloodgulch, script data moved to an aligned address | loads and plays |
| bgmis: the same, script data at 2 mod 4 | blue screen after the script message (as heh_2_ce, crossing_ce) |
| barrier_ce (overlap repair; the new block is aligned) | **loads and plays**: first converted map confirmed |
| crossing_ce (struct repair only) | past the address check; stops at the script message (its script data is unaligned) |
| heh_2_ce (no repair) | stops at the script message |
| theisland_3_ce (overlap repair) | past the validator; refused at the model part check below |

Converter consequence: the script data repair is required for every map whose script data is not
4-aligned (base + offset), with or without used nodes (converter commit a346a97).

Update (user, 2026-10-12, build 185, **debug and release builds**), maps from commit a346a97 with the
required repairs:

| Map | Result |
| --- | --- |
| heh_2_ce (script data alignment repair) | **loads and plays** |
| crossing_ce (#2404 struct repair + script data alignment repair) | **loads and plays** |
| barrier_ce (overlap repair) | **loads and plays** |
| theisland_3_ce | refused at the model part check (unchanged); decided: a blocking checklist row |

Update (user, 2026-10-12, build 185), maps from the current code (Phase 1c alignment + required repairs):

| Map | Result |
| --- | --- |
| heh_2_ce | **loads and plays** |
| crossing_ce | **loads and plays**; logs "64 sound permutations converted", 32 HUD elements, 2 HUD meters, "local machine is loaded & ready to play" |
| barrier_ce | **loads and plays**; logs "60 sound permutations converted", 42 HUD elements, 2 HUD meters, "local machine is loaded & ready to play" |
| bg_pc_ce, bg_md_ce (stock control maps) | the same |
| theisland_3_ce | still refused at the model part check; opt-in repair of the 35 strip indices is a later decision. Its scenery palette entries 14 and 15 name the wrong kinds of tags (a sound, a device_machine); OpenCE blanks them |

- The sound and HUD lines that were missing before Phase 1c are logged now (barrier's 42 HUD elements is
  the simulated count; crossing's 64 = 60 stock Ogg permutations + 4 energy-sword sounds).
- **Map sharing:** OpenCE now renames maps in `custom_maps` to hash names, and it loaded a map whose
  header name differs from its file name. So a converted map's header name need not equal its file name
  for OpenCE (the tool still sets it from the file name).

## Known problems on converted maps (user, 2026-10-12; same in debug and release)

Attributions are the user's best judgement without timing each sound: likely, not certain.

1. **Sounds:** only some one-off player and announcer sounds are garbled: the player death sound; the
   announcer's gametype call-out at match start (heh_2); in barrier something on the first weapon
   switch or at game end (probably the game-over announcer); in crossing one sound while firing the
   plasma pistol (possibly an announcer or another one-off event). Weapon, grenade, ammo and ambient
   sounds are fine.
2. **HUD:** the ammo icons of every weapon are very pixelated and depleted rounds do not draw
   correctly; the plasma pistol overheat meter icon is distorted. Total ammo and grenade counts are fine.
3. **heh_2:** "build_sprite failed to allocate dynamic vertices" logged once (20:29:27) during play.

**Leads, not conclusions:** bgali's log (CE bloodgulch) has "60 sound permutations converted to
1712772 bytes of Xbox ADPCM", "32 HUD elements ... half their scale" and "2 HUD meters". The converted
maps log no sound conversion line, 12 HUD elements and 1 meter. To be researched in the code (Task 2),
then a control test: stock PC/bloodgulch and HaloMD/bloodgulch converted the same way.

## theisland_3: model part check (code read at 6399ed9; bytes measured read-only)

- `custom_edition_models_convert` (custom_edition_geometry.c): first `model_local_nodes_make` (models of
  44+ nodes without local nodes), then per model `custom_edition_model_part_shaders_bound` (a shader
  index past the model's shaders becomes its last one, logged, not refused), then
  `custom_edition_model_verify`, which refuses at the first failing part. A part fails
  `custom_edition_model_part_verify` when: shader index outside the shaders; centroid primary or
  secondary node outside the nodes; previous or next part index < -1 or >= the part count; local nodes
  set but local node count 0, or a local node index >= the nodes; **any of its `strip_triangle_count + 2`
  strip indices >= its vertex count**; any vertex's two node indices outside [0, local node count or
  node count); any normal, binormal or tangent component with |x| > 1.005 (or NaN). Before that,
  `gbxmodel_part_check` (cache_file_formats.c) checks strip and vertex types, ranges and alignment.
- Measured with the schema (models, geometries, parts) and OpenCE's part / vertex layout (0x84, 0x44):
  0 failing parts in all 5 CE maps (1,950 parts) and in HaloMD heh_2, crossing, barrier, bloodgulch,
  b30 and ui. theisland_3: 1 model, 2 parts, and only strip indices fail:
  - `effects\debris objects\forerunner dark structure\forerunner dark structure` (#2574; 1 node,
    1 shader, 2 geometries of 1 part): geometry 0 part 0 has 70 vertices, and 2 of its 104 strip
    indices are 70 and 71 (strip positions 100 and 102). Geometry 1 part 0 has 44 vertices, and 33 of
    its 66 strip indices are out of range: positions 0-31 hold 221 to 586, position 59 holds 11565
    (corrected 2026-10-12 by `convert/model-part-check.ts` and its raw walker; the earlier "225 to
    575" was wrong).
  - Its strips and vertices are the last in the model data and overlap no other part's, so the indices
    themselves are wrong (not misplaced data). On Halo PC such indices read neighbouring vertices
    (garbage triangles, no crash), which is why HaloMD runs the map.
  - Used by: #2573 the same-named garbage object (its model), spawned by
    `vehicles\pelican\effects\pelican explosion` (4 effect parts).
- **Decision (user, 2026-10-12):** option 1: a checklist row blocks Convert and names the model, part
  and bad indices, using the same rules as `custom_edition_model_part_verify`; it must find 0 on the 5 CE
  maps and on heh_2, crossing and barrier. Option 2 (opt-in repair of the 35 indices) is a later,
  separate decision.

## Cause of the sound and HUD glitches (research 2026-10-12; code at 6399ed9, bytes measured read-only)

**One cause: unaligned tag blocks.** `loaded_block_get` (port/linux/game/cache_file_formats.c) returns
"unreadable" for any block whose offset in the tag cache is not a multiple of 4 (`!(*offset & 3)`).
`custom_edition_cache_block_element` uses it. Every OpenCE pass that walks blocks through these skips an
unaligned block silently. In converted heh_2 / crossing / barrier every sound's pitch-range and
permutation blocks are 1 or 2 mod 4 (333 / 340 / 339 of 333 / 340 / 339); stock PC and HaloMD
bloodgulch: 0 of 333 (also 0 for the HUD blocks below).

**Sounds.** `custom_edition_sounds_decode` (custom_edition_sounds.c) re-encodes a permutation only when
it is Ogg Vorbis (3), uncompressed (0) or mono at 44 kHz; Xbox ADPCM (1) plays as it is. It reaches the
permutations through `custom_edition_cache_block_element`, so with unaligned blocks it converts nothing,
yet still sets the sound header's compression to Xbox ADPCM. Playback picks the format from the header
(`sound_valid_for_channel`, source/sound/sound_manager.c), so the Ogg data plays as ADPCM noise. Both
counters stay 0, so the "sound permutations converted" line is not logged. `sound_prepare`
(cache_file_formats.c) is skipped the same way (12 permutations each in crossing and barrier keep
another tag's handle in their runtime fields; effect unknown).
- Affected (all Ogg, identified by path and class; references from globals not traced): `sound\dialog\
  chief\deathquiet` / `deathviolent` (unit_dialog, mono 22 kHz, 7 + 16 permutations); 36 x
  `sound\dialog\multiplayer1\*` (scripted_effect, stereo 22 kHz, 1 each: slayer, game_over, ...);
  `sound\sfx\weapons\weapon_anims\plasma_cannon_overheat` (weapon_overheat, mono 22 kHz: the plasma
  pistol sound); crossing also 4 energy-sword sounds (stereo 44 kHz). heh_2: 60 Ogg permutations =
  bgali's "60 converted". Every sound that plays fine is Xbox ADPCM.
- CE bloodgulch: all 333 sounds whole-tag in sounds.map, same compression / rate / channels and the same
  60 Ogg permutations; `resource_sound_load` places them 4-aligned (`tag_cache_allocate`).

**HUD.** `hud_placement_block_convert` / `hud_meters_convert` (cache_file_formats.c; halve the scale of
elements drawn from Halo PC's double-resolution bitmaps) and `weapon_hud_meters_add`
(custom_edition_bitmaps.c; meter channel order) use the same block reads. Simulated count: CE bloodgulch
32 halved (= bgali's log), heh_2 / crossing 12 (= the log), barrier 22 (predicted; check its log). The
missed 20: weapon statics and meters and the cyborg auxiliary meters, all in unaligned blocks. Effect:
`hud_ammo_alphas` (512x512 A8R8G8B8) drawn at twice the intended size (pixelated); `hud_ammo_meters`
drawn with color and alpha swapped (depleted rounds wrong, plasma overheat meter distorted). The unit
HUD's shield and health meters are fixed fields, still converted (fits "1 HUD meter" vs 2; not simulated
exactly). The bitmaps are identical (format, size, flags) in heh_2, PC bloodgulch and CE bitmaps.map: the
source data is fine; the layout is the problem.

**"build_sprite failed to allocate dynamic vertices"** (source/render/render_sprite.c, `build_sprite`):
each bitmap a particle draws reserves 4 x its maximum sprite count from `_rasterizer_dynamic_vertices_new`
(source/rasterizer/xbox/rasterizer_xbox_draw_primitives.c), refused when the frame's world-sprite pool
(`RASTERIZER_MAXIMUM_DYNAMIC_UNLIT_VERTICES` = 4 x 8192) or 1,023 dynamic buffers are used up (the
screen-space group's maximum is 0 there). Those sprites are not drawn that frame; logged once per run.
A per-frame particle limit, not shown to be a map defect; an earlier "### ERROR too many dynamic vertices
requested" line would mean the pool overflowed.

**Control test (expected, developer script, from core/):**
`npx tsx scripts/convert-external.ts ..\sample_maps\PC\bloodgulch.map ..\sample_maps\PC <out>\bg_pc_ce.map`:
70,735,338 B, CRC32 0xA6E5A966. Same with `HaloMD\bloodgulch.map` and `..\sample_maps\HaloMD`, output
`bg_md_ce.map`: 70,735,338 B, 0xB38CBC61. Both 0 repairs, 0 warnings, 1,627 ranges; CRC checked
independently (node:zlib). Prediction: clean death and announcer sounds and HUD, and logs with "60 sound
permutations converted" and "32 HUD elements". If they glitch, this explanation is wrong or incomplete.

**Control test result (user, 2026-10-12, OpenCE build 185):** bg_pc_ce and bg_md_ce (stock PC and HaloMD
bloodgulch, converted with the developer script; aligned) load and play with clean sounds and log "60
sound permutations converted to 1712772 bytes of Xbox ADPCM", "32 HUD elements ... half their scale" and
"2 HUD meters", as bgali does. This confirms the cause above: the retail-to-CE conversion itself is fine;
the HaloMD maps' unaligned tag data is the problem. Fix: Phase 1c (PRD), align the tag data.

**Phase 1c outputs to test (2026-10-12):** heh_2_ce 70,827,480 B (CRC32 0x03C90A64), crossing_ce
75,214,271 (0xAC83C8A3), barrier_ce 77,718,428 (0x9259F2E9); every block, tag and data block 4-aligned.
Expected in OpenCE's log: "60 sound permutations converted ..." (heh_2; crossing and barrier have
their own counts), "32 HUD elements ... half their scale" (barrier: 42), "2 HUD meters"; clean death,
announcer and plasma overheat sounds; normal ammo icons and meters.

## Converter Phase 2 findings (code read at 6399ed9, 2026-10-12)

- **Tag entry +0x1C is never read.** The loader defines tag instance offsets 0x00-0x18 only
  (`TAG_INSTANCE_*_OFFSET`, port/linux/game/cache_file_formats.c l.85-91; +0x18 = in resource map). The
  C structs (`cache_file_tag_instance`, source/cache/cache_files.c l.163 and menu_tags.c l.140;
  `tag_validate_instance`, tag_validate.c l.100) call +0x18/+0x1C `unused[2]`; nothing reads `unused`.
  So the MacDemo protection's dummy tag (+0x1C nonzero) needs no change (PRD decision A).
- **Scripts are renumbered by name.** `custom_edition_scripts_convert` (port/linux/game/
  custom_edition_scripts.c), called for every CE map from the load (custom_edition_cache.c l.465-469),
  looks each call up by its first child's name (`function_call_convert`: the child must be a function
  name node, `_hs_function_name`, with a readable string) and each engine global by its name
  (`engine_global_convert`), with the game's own `hs_find_function_by_name` / `hs_find_global_by_name`.
  A node that names nothing fails the conversion, and with it the load; a name OpenCE lacks is made
  inert. So a demo map's own function numbers don't matter to OpenCE (the Mac demo numbers 37 of b30's
  122 functions differently from CE). The node count is `data_array.count` at +0x2E (source/memory/data.h).
- **Map protection is handled by OpenCE**: it gives a protected scenario's renamed group back
  (cache_file_formats.c, "Map protection can rename the scenario's group").
