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
| Script data | `hs_scenario_syntax_data_valid` / `hs_allocate`, source/hs/hs.c | size 56+19001x20, inside the tag cache, absolute address 4-aligned, header signature 'd@t@', maximum 19001, element 20, valid, counts in range; string data >= 0x400 B in the tag cache | "the scenario's script data is missing or damaged; its scripts won't run" (once per process) |
| Data array free slots | source/memory/data.c (`datum_new`, `datum_try_and_get`, `data_next_index`, `data_iterator_next`, `data_delete_all`) | identifier 0 = free slot | none |
| Predicted resources | `predicted_resource_valid`, source/cache/predicted_resources.c | tag of the right group; bitmap index < the bitmap's count | "predicted resource of type T names tag X resource R (not precached)" (once per process; the entry is skipped) |
| Texture / sound cache | source/cache/xbox_texture_cache.c, xbox_sound_cache.c; sizes in port/linux/include/halo_port_capacity.h | desktop: textures 256 MB, sounds 16 MB, LRU | "YOU GOT STABBED" (texture drawn as default) / "SOUND CACHE BLOWN" |
| BSP placement | `custom_edition_structure_bsp_reference_valid`, custom_edition_cache.c | BSP loads above the tag data and inside the tag cache | "a structure bsp's ... outside its tag cache" |

## Findings: heh_2_ce blue screen (build 185, code reading only)

1. **After the script message.** It is logged in `hs_allocate` (from `hs_initialize_for_new_map`, inside
   `game_initialize_for_new_map`, source/game/game.c). OpenCE then makes its own empty node array once
   (`data_new` + `data_make_valid`, count 0); `hs_scenario_postprocess` calls `hs_allocate` again and
   returns FALSE at its validity check. Scripts and globals are 0 already. Nothing the load uses is left
   uninitialised; only the compile globals for console expressions are not set for this map (unused
   while loading). Then, still in `game_initialize_for_new_map`: recorded animations, cheats,
   `objects_place`, `ai_place`, `network_objects_placed`, `ui_widgets_safe_to_load`; back in
   `network_game_create_game_objects` (networking/network_game_manager.c) the players' `player_new`; then
   `network_game_client_game_has_started` (network_client_manager.c) sends client_loaded and logs
   "local machine is loaded & ready to play". Every failure on that path logs a line.
2. **No per-frame wait after the script message.** The only load loops that present frames
   (`game_precache_new_map`, `game_unload`) run before `game_load`, so before the message. Nothing
   between the message and "ready" presents a frame. The texture and sound `block` loops spin (no log,
   no frames) until a read completes, but a CE map's reads complete at once (`cache_file_read` ->
   `custom_edition_cache_read`). Endless frame loops exist only in `halt_and_catch_fire` (main.c:
   draws with **blue** fog, never returns; every caller found logs first: "EXCEPTION halt", "crash:")
   and `main_loop_of_death` (after "damaged media"). **The code shows no wait that matches the symptom.**
   A silent loop in one of the calls listed in 1 is not excluded. Next evidence needed: a dump of the
   hung process (Task Manager > halo.exe > Create dump file) with the build's halo.pdb, or the debug
   build's halo.log. symbolize_crash.py reads `crash:` lines only, not a hang dump.
3. **"predicted resource of type 0 names tag ffffffff resource 4".** heh_2's
   `weapons\sniper rifle\sniper rifle` (#1254) predicted resource [0] is bitmap index 4 of tag 0x000004E9
   (salt 0; the entry is 0xE65D04E9, a 1-image bitmap). The loader corrects the ID to NONE, so the
   check skips it and logs once per process. It is predicted by `game_engine_predict_resources`
   (game_engine.c, from `game_engine_initialize_for_new_map`, before the script message) only when the
   game variant's weapon set maps a slot to the sniper rifle. So it depends on the game variant, not on
   release vs debug. It cannot stall: the entry is skipped.
4. **Limits vs heh_2.** All of these are refused with a message or logged, none is waited on: file size,
   resource map sizes, tag cache 0x1700000 (heh_2 tag data 5.5 MB; BSP at 0x419CD800, 16.9 MB above the
   tag data end, the same address as CE bloodgulch's), texture cache 256 MB (LRU; heh_2 has 44.4 MB of pixels),
   sound cache 16 MB (LRU; 12.0 MB of samples), objects 8192, predicted resources (no count limit; the
   loop is long). The raw region size is not checked as such, only each range. No bitmap or sound count
   limit was found in the CE loader.
5. **Alignment repair for heh_2 (verified by reading the bytes, read-only script).** heh_2's script
   header is valid in every field (signature, maximum 19001, element 20, valid 1, counts 0, string data
   1,024 B in the tag data) and identical to CE bloodgulch's apart from its address (0x4047A916, 2 mod
   4). An aligned copy passes `hs_scenario_syntax_data_valid`; the engine then uses the map's own array
   (count 0), `hs_compile_postprocess` finds no nodes and returns TRUE: CE bloodgulch's path. Note: the
   current converter rule does nothing for misaligned script data with no used nodes (heh_2), so this
   repair needs a decision.
6. **Rare paths in the HaloMD maps.** heh_2: every root, 6,982 of 7,368 blocks and 2,052 of 2,133 data
   fields are 2 mod 4 (theisland_3 similar). CE bloodgulch and coldsnap: 0. x86 reads unaligned values,
   but no CE map exercises this. 850 of 1,407 predicted resources carry stale salts (CE bloodgulch,
   the same 1,407 in 101 lists: 0; theisland_3: 0), so they are corrected to NONE. One stale reference
   (BSP sound environment). Tag data file offset 8,721,390 (2 mod 4): no effect (the tag data is copied
   to 0x40440000; coldsnap's is 2 mod 4 too and loads).
