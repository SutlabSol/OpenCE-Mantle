# OpenCE Modding Tool — PRD

## Problem statement
Windows desktop app (Electron + TypeScript + React) for modding Halo: Custom Edition (PC) maps
(header version 609). Architecture: `/core` (pure TS map/tag library, no Electron/DOM deps,
Vitest-tested) + `/desktop` (Electron main/preload/renderer + worker threads). Reference repos
(Invader, Reclaimer) are GPL and used strictly for format/struct reference — all code here is
original.

Milestones: M1 header/index parse, M2 decompress/recompress, M3 GUI shell, M4 dependency walker +
extraction, M5 tag injection/swap, M6 export + CRC32 recalc. Future: M7 field-level tag editor,
Phase 2 3D scenario editor.

## Status table (2026-08, updated this session — labels: verified by tests / same-reader /
needs re-verification / unverified / blocked)
| Feature | Status | How |
|---|---|---|
| M4 extraction (general) | **needs re-verification** | Was "done" before the font/string_list/meter/etc data-dropping bug was found; the bug is now fixed and same-reader-verified (101/101 core Vitest), but no fix this session has been run by the user on Windows/OpenCE yet. See "Windows check" below to move this to verified without a full OpenCE session. |
| M5 SWAP (tags with NO gbxmodel in their closure) | **loads in OpenCE, user-confirmed (2026-10-11); gameplay check: partial, nothing wrong seen** | The map written by SWAP of `globals\globals` with dependencies into bloodgulch (branch `fix/swap-load-failure`), finalized with scenario name and CRC32, loads in OpenCE. Gameplay (user, on `bg_swap2`): Slayer; fired and reloaded the pistol and assault rifle; HUD shield and health meters drew; text appeared; a warthog spawned and drove. Nothing wrong seen. Not tested: CTF, King of the Hill, other weapons. Maps written by SWAP before this branch are still invalid - re-create them. |
| M5 ADD (tags with NO gbxmodel in their closure) | **loads in OpenCE, user-confirmed (2026-10-11); only the load is confirmed** | Root cause of the blue screen, confirmed by the user in OpenCE: the rebase skipped external entries, but an external sound's data field is the ADDRESS of its base struct in tag data (333 in bloodgulch), so after the array grew they pointed 64 bytes early. The user's hand-fixed maps (sound pointers shifted, with and without the 94 BSP reference path pointers) load in OpenCE; maps without the sound fix all blue-screened. Fix on branch `fix/add-tag-array-growth` (see "ADD tag-array growth" in Decisions): schema-driven rebase including external sounds and BSP reference paths, fixed-base reader, tag space limit; verified by tests (independent: fixed engine base, raw output, address-vs-index decided by value, shares the schema engine). Confirmed (user, 2026-10-11): the tool's own output for ADD of `ui\shell\main_menu\halo_logo` into bloodgulch loads in OpenCE, and the user's independent check of that file passed (333 external sound entry pointers +64, 552 resource indices unchanged, 1569 internal entry pointers +64, 94 BSP path pointers +64, CRC matches). Nothing references the added tags, so only the load is confirmed, not that added tags work in game. The earlier claims "ADD of ui into bloodgulch passes" and the first fix's "0 bad tags" were wrong in effect (see Decisions). Every map written by ADD before this fix is invalid; this build refuses to open those written before the fixed-base reader. |
| M5 ADD / SWAP (any tag whose closure includes a `gbxmodel`) | **blocked; needs re-verification once unblocked** | `uncapturedData` warning unconditionally blocks these in ADD, and since 2026-10-11 (commit 2ee3c9e) in SWAP too (model geometry not captured at all - see Issue 2/gbxmodel plan below) until that's built and approved. This is intentional, not a regression. The dependency-order P0 that also affected weapons/projectiles/vehicles/bipeds is fixed (see Decisions); re-check once unblocked. |
| Embedded (external=0) bitmap/sound relocation | **same-reader-verified, NOT approved for the real app** | `embedded-relocation.test.ts`, real coldsnap.map bytes. `allowEmbeddedRelocation` stays off in `map-worker.ts`. |
| `gbxmodel` model geometry capture/relocation | **Stage 1 (capture) same-reader-verified; Stage 2 (injection) design-verified, NOT built/wired** | `gbxmodel-geometry.test.ts` (100% captured, 0 blocked, bloodgulch+coldsnap), `gbxmodel-combined-insertion-design.test.ts` (field table + 665-part no-patch proof) — see "gbxmodel geometry — Stage 1 capture" below |
| Sound relocation | **same-reader-verified, bounds-only** | No deterministic size formula for compressed audio exists (stated, not guessed) - a corrupt/truncated embedded sound could still pass the bounds check. |
| Header `crc32` on save (File > Save, File > Save As) | **verified by tests; a finalized SWAP map loads in OpenCE (user-confirmed 2026-10-11)** | Recomputed by `finalizeForSave` on every save (branch `fix/swap-load-failure`); reproduces the stored crc32 of all 5 CE sample maps. |
| In-memory Inject, File > Save / Save As / Discard Changes, backup prompt on open, unsaved-changes prompt, `.bak` handling | **verified by tests; works on Windows and the saved map loads in OpenCE (user-confirmed 2026-10-11)** | Branch `feat/inject-in-memory-save` (see "In-memory inject and File > Save" in Decisions). Inject writes nothing; Save overwrites the opened file atomically (the one permitted exception to "never overwrite the source map", stated in RULES.md and CLAUDE.md); Save As writes a new file that becomes the open map. Independent ADD audits pass on the in-memory buffer and on the saved file (`map-worker.inject-save.test.ts`). The unsaved-changes prompt's logic is tested (`save-map.test.ts`); the real Electron dialog was only exercised by hand. |
| Sub-header `tagFileChecksums` (tag data +0x8) after injection | **not recalculated; map still loads in OpenCE (user-confirmed 2026-10-11)** | Left unchanged on purpose. The SWAP map above kept the source's stale value and loads in OpenCE, so OpenCE does not reject it at load. Whether anything else (other loaders, netgame checks) validates it is unverified. The save result still says so. |

### Windows check to move "M4 extraction" to verified (no OpenCE needed)
1. Build, open `ui.map`, extract `ui\ticker` (Tools > Extract Tags, search "ticker", pick the
   **font** result, not the ui_widget_definition ones) alone (no dependencies needed).
2. Expect: extraction succeeds with 0 warnings for that tag, "Open containing folder" shows a
   `.ocetags` file. Expect the file to be noticeably larger than a few KB (it embeds the font's
   ~31 KB of glyph pixel data) - if you want an exact number, the pixels field alone is 31,066
   bytes plus the JSON/base64 + struct overhead.
3. Extract any weapon (e.g. `weapons\assault rifle\assault rifle`) with dependencies - expect it
   to succeed with only "External data"/"BSP" style warnings, never a crash.
4. Report back pass/fail - if both pass, M4 extraction moves to **verified**.

| Converter Phase 1: retail layout (v7, HaloMD) -> CE 609 | **verified by tests; unverified on Windows and in OpenCE** | Branch `feat/demo-converter-phase1` (see "Converter Phase 1" in Decisions). heh_2 and theisland_3 convert with CRC32 0xD1C331E9 / 0x0A5AFEA5, only header bytes change, output reads with the CE reader. Independent check: node:zlib CRC over regions read from raw bytes. The stale demo-era references are warned about, not fixed. **Blue-screens in OpenCE (user, 2026-10-11): heh_2_ce and crossing_ce.** Cause: their bitmap and sound data is external (per asset) in the retail resource files, which CE does not have. A header-only conversion is valid only for maps whose data is all internal. Fix planned as Phase 1b (see "Converter: per-asset external data" in Decisions). |
| Converter Phase 1b: v7 maps with external bitmap/sound data, using the source game's resource files | **core built, verified by tests (independent); no GUI yet; unverified in OpenCE** | Branch `feat/demo-converter-phase1` (see "Converter Phase 1b, Stage 2" in Decisions). Developer script `core/scripts/convert-external.ts` converts heh_2, theisland_3, crossing, barrier with HaloMD's bitmaps.map / sounds.map. Without resource files these maps are now refused (the header-only output blue-screened). Stage 3 (GUI) not started. **Tag data repairs** (see "OpenCE findings and tag data repairs" in Decisions): built, verified by tests (independent byte checks; the output re-check is same-reader); repair rows in the Convert dialog verified in component tests and `?mock=convert-repairs` only; **In progress.** OpenCE build 185, debug and release (user, 2026-10-12): **heh_2_ce, crossing_ce and barrier_ce load and play.** The glitches seen before Phase 1c (garbled one-off sounds, HUD) had one cause, unaligned tag blocks; **with Phase 1c (current code) all three load and play and OpenCE's sound conversion and HUD passes run** (user, 2026-10-12; see "Phase 1c confirmed in OpenCE" in Decisions). theisland_3 is refused at OpenCE's model part check (one HaloMD model with bad strip indices); decided: a blocking checklist row (option 1). |
| Converter Phase 2: Mac demo maps (v6) -> CE 609 | **stage 1 confirmed in OpenCE (user, 2026-10-12); stage 2 (mods) verified by tests, unverified in OpenCE; no GUI** | Branch `feat/demo-converter-phase2` (see "Converter Phase 2" in Decisions). Developer script only. Stage 3 (GUI) not started. |

## Decisions (user-approved — point here instead of re-explaining)
- 2026-10-12: **yoyorastv2_1 in OpenCE (user, build 185) and research.** Details: opence-notes "yoyorastv2_1".
  - Converts (developer script, HaloMD resource files): 168,146,813 bytes, CRC32 0x21515932. Loads ("local
    machine is loaded & ready to play", scenario regrouped, 811 bitmaps and 1,198 sound ranges checked, 8
    script calls renumbered), then **halts at script run**: "EXCEPTION halt ... hs_library_internal_runtime.h,
    #80: *argument_count<LONG_BITS". Also "checksum mismatched"; four sounds cut to 4 MiB by OpenCE.
  - Cause: `hs_evaluate_begin_random` (hs_runtime.c l.2370-2400) asserts fewer than 32 arguments; the map's
    continuous script #48 "randomize teleport" has `begin_random` with exactly 32 `begin` arguments (node
    1986). Its bit vector is one 32-bit long, so 32 fit: the assert is one stricter than the memory it
    guards. "EXCEPTION halt" with a stack walk is printed only by a build without HALO_RELEASE; a release
    build logs "EXCEPTION assert ... (release build)" and carries on (cseries.c l.360-445). Our script data,
    string data and scenario struct are byte-identical to the source. No other sample map has a
    begin_random of 32+ (coldsnap / b30 have long `begin` calls, which have no such limit).
  - Checksum: OpenCE sums the BSPs packed from 0x800, the model data, and the tag data **after** it regroups
    the scenario (cache_file_formats.c l.2270-2318), so a renamed scenario always reads as mismatched:
    OpenCE's value for this output is 0xCF40652D (ours, over the file, 0x21515932). Joining compares the
    stored header values of host and joiner (custom_edition_cache.c l.640-648), so it is only a warning.
  - **Built (user-approved; verified by tests, unverified in OpenCE):** row "Scripts OpenCE can run"
    (`convert/script-run-check.ts`): begin_random with 33+ arguments or an argument chain that never ends
    refuses; exactly 32 warns (release logs and carries on, debug halts); names the script and node. No
    repair (splitting changes the random order). 0 on every sample map but yoyorastv2_1 (warn). The halt
    came from the debug build (user); yoyorastv2_1_ce is to be tested on the release build.
  - **Next (approved, in stages):** GUI stage 3 as planned, plus: the Source files step shows each
    rejected file's range-check result (how many ranges matched, which did not).
- 2026-10-12: **Item C built (verified by tests; unverified in OpenCE).** Commits 52390b1, 1f99beb, 0e38679.
  1. "Bitmaps OpenCE can draw" (`convert/bitmap-check.ts`, refuses): mirror of `custom_edition_bitmap_drawable`
     (rules: opence-notes "Phase 2 mods in OpenCE"), on the flags the output will have (external bit cleared);
     the converted map is checked again before it is returned. 0 problems on the CE maps' internal bitmaps,
     PC / HaloMD / Mac demo stock, heh_2, crossing, barrier, theisland_3, Zombiemod; TrueInfectionV2 refused
     (#3849 bitmap 0, 43,960 of 174,776 bytes). Independent test: raw bitmap list and own size formula.
  2. "Fog densities and colours in sky and fog tags are 0 to 1" (`convert/fog-color-check.ts`, info only):
     Zombiemod outdoor fog maximum density 5, TrueInfectionV2 1.5, others none. A release build logs the
     asserts and carries on; any other build stops at the first (`cseries.h`: HALO_RELEASE vs
     display_assert + system_exit).
  3. Scenario by the tag data header's full scenario ID (`convert/scenario-tag.ts`), a renamed group read as a
     scenario and left as it is (info row "Scenario found by the tag data header"); unknown groups refused by
     name ("Every tag has a known group"); required repair `blockOverlap` for an overlapping block list whose
     elements hold only values and pointer-based data blocks (moved with its data, today's bytes; data
     pointers rewritten in the copy only), with the info row "Data another tag wrote over"; other overlaps
     refused. The Inject row still warns for a renamed scenario (the app's reader doesn't read it as one).
     **HaloMD yoyorastv2_1** (developer script, HaloMD resource files, output `yoyorastv2_1_ce.map`):
     168,146,813 bytes (the estimate 168,146,759 + the 54-byte moved block), CRC32 0x21515932; tag #0 keeps
     'ztpt'; #2919's strings block now at 0x40D79428; #2920 unchanged.
- 2026-10-12: **OpenCE results for the Phase 2 mods, bitmap and fog research, yoyorastv2_1, flamethrower.**
  Code citations: `memory/opence-notes.md` "Phase 2 mods in OpenCE". Research only; nothing changed.
  - **Zombiemod loads and plays** (user). The release build logs thousands of EXCEPTION asserts
    (bitmaps_inlines.h #89 x100,000, #320 "intensity>=0.0f && intensity<=1.0f" x10,000, #188 "verify ==
    result" x10,000). Cause, measured: its sky's `outdoor fog maximum density` is 5.0; OpenCE's environment
    fog passes it unclamped to `real_alpha_intensity_to_pixel32` (#320), whose colour conversion then fails
    #89 / #188. Mod data, copied unchanged (TrueInfectionV2 has 1.5; stock demo, CE bloodgulch, heh_2,
    crossing, barrier: 0 such values). Not fatal. Zombiemod's scenario has no AI (encounters, command lists
    and the four AI reference lists all 0), so there is nothing there to differ.
  - **TrueInfectionV2 is refused by OpenCE**: "bitmap 0 of '<protected>' (type 0, format 14, 512x512x1,
    flags 0x83) cannot be drawn by this build" -> game_load() failed. Rule: `custom_edition_bitmap_drawable`.
    Measured: tag #3849, DXT1 512x512 with 9 mipmaps needs 174,776 bytes of pixels; it stores 43,960 (the
    next bitmap's pixels start right after; 43,960 matches no DXT1 mip chain). Mod data. A mirror of the
    rule finds exactly this one bitmap in 19 maps (5 CE internal bitmaps, PC / HaloMD / MacDemo stock, the
    HaloMD and MacDemo mods, yoyorastv2_1); every map that loads: 0.
  - **Proposed (not built, needs approval):** a refusing row "Bitmaps OpenCE can draw" mirroring
    `custom_edition_bitmap_drawable` on the output (the external bit 0x100 cleared, as the copy-in does).
    No faithful repair: the missing pixels are not in the file and the intended size is unknown. A possible
    opt-in later: zero-pad the pixels to the required size (loads; that texture draws wrong). Optional info
    row for colours / fog densities outside [0, 1] (OpenCE asserts, not fatal); no clamp without approval.
  - **yoyorastv2_1 (HaloMD)**: tag #0 "<zteam>" (group 'ztpt') is the scenario with its group renamed by
    protection: the tag data header's scenario ID names it; its data reads as a scenario. OpenCE finds the
    scenario by that ID and gives it the scenario group back; it loads a tag of an unknown group as opaque.
    Read as the scenario (in memory), the alignment and script rows pass; left: #2919 var_kill_penalty's
    strings block overlaps #2920's root by 4 bytes (its two strings lie inside #2920 too; the text was
    overwritten). Plan C (approved, not started): find the scenario by the header ID; unknown groups stay
    refused; a narrow repair moves a pointer-free overlapping block (copying today's bytes).
  - **Flamethrower:** placed identically in MacDemo, PC, HaloMD and CE bloodgulch (weapon #1361, item
    collection "single weapons\flame thrower", netgame equipment [35] of 37, type "all games", spawn time 0,
    position (103.8, -109.1, 1.7)). Not a conversion difference; to compare, stock CE bloodgulch in OpenCE
    with the same game variant.
- 2026-10-12: **Converter Phase 2: Mac demo maps (true demo layout, v6) (user-approved plan, in stages).**
  Research: `memory/demo-converter.md` "Phase 2 research"; offsets: SOURCES.md "Converter Phase 2".
  - **Decisions.** A: a tag entry's +0x1C word is not rewritten; OpenCE reads nothing there (cited in
    SOURCES.md), so +0x1C is an info row naming the tag and only +0x18 stays strict. B: MGM's two
    alignment remainders (1 and 3 mod 4) are refused for now, with the reason. C: Paranoia's BSP count
    0xFFFFFFFF is refused, with the reason. D: references whose tag ID matches but whose path pointer
    differs (map protection) are one grouped line, not a list. E: the demo ui.map is allowed, not targeted.
    Protected maps get only what loading needs; nothing strips or hides protection.
  - **Conditions.** 1: the internal name is read from 0x58C up to the first 0 and written zero-padded
    (tested on the four mods). 2: memory below. 3: the table below. 4: GUI name default (item 14 above).
  - **Design.** `convert/demo-to-ce.ts` makes a retail-layout copy in memory (standard header from the
    demo fields; every tag-space pointer moved by -0x0BAD0000 by schema: `collectTagDataPointers` plus the
    new `collectBspSpacePointers`), then Phase 1 runs unchanged on it. Script row replaced (all maps):
    it checks what OpenCE needs (every call and engine global names what it uses; OpenCE looks them up by
    name), no acknowledgement.
  - **Results** (computed in memory, nothing written; MacDemo's bitmaps.map / sounds.map unless noted):

    | Map | Result | Reason / notes | Output (bytes, CRC32) | External ranges vs MacDemo's files |
    | --- | --- | --- | --- | --- |
    | bloodgulch (stock) | converts | every row passes | 70,828,894, 0x981B3317 (as bloodgulch_demo) | 676 + 951, all entries |
    | bloodgulch-Zombiemod | converts | script data repair (overlap); +0x1C info; 12 junk references (warn) | 118,787,881, 0x9C98E7D0 (as Zombiemod) | 856 + 5,252, all entries |
    | bloodgulch-TrueInfectionV2 | converts | script data repair (overlap); +0x1C info; 8 junk references | 162,786,612, 0x45689D04 (as TrueInfectionV2) | none (all data internal) |
    | bloodgulch-MGMWeaponCollab | refused | B: blocks 1 mod 4, its last 12 tags 3 mod 4; and needs files I don't have | - | bitmaps: 2,306 all entries; sounds: 3 of 2,894 are past the end of MacDemo's sounds.map (needs the mod's own sounds.map) |
    | bloodgulch-ParanoiaV2 | refused | C: BSP `collision bsp[0].bsp2d references` count 0xFFFFFFFF | - | not reached |
    | ui | converts (measure only) | 1 script, 23 calls, all named | 29,146,822, 0xCBABF9E8 | 450 + 125, all entries |
    | b30 | converts (measure only) | 85 scripts, 1,451 calls of 122 functions + 1 engine global, all named | 170,964,588, 0x27DD7F80 | 744 + 6,971, all entries |

    CRCs are for the output names shown (the name is not part of the CRC). HaloMD's files fail the range
    check for every MacDemo map except ui.
  - **Memory (condition 2), peak RSS of one process, pre-flight + convert + finalize, resource files read by
    offset:** stock bloodgulch 305 MiB; Zombiemod 494; TrueInfectionV2 (155 MiB source) 765 MiB (its
    pre-flight alone 611); b30 (largest output, 171 MB) 628 MiB. The retail-layout copy is a **second
    copy** (the source is never changed); the conversion then works on that copy in place (no third copy)
    until the copy-in, alignment or repair steps make their new buffers; the pre-flight adds its own
    read-only copy. Buffers live outside the V8 heap, so the heap limit does not apply; about 5 times the
    map size is safe on an 8 GB PC but should be reduced (stream the copy-in) before very large maps.
  - **Stages.** 1 (built, below): core for the stock demo bloodgulch, BSP sites, the script row, the
    developer script. 2: the mods one by one (Zombiemod, TrueInfection; MGM and Paranoia refuse), ui and
    b30 measure-only (b30 not in the normal suite). 3: the GUI for retail-layout and demo maps (name prompt,
    Source files step), after the user confirms stages 1 and 2.
  - **Stage 1 built (verified by tests; unverified in OpenCE):** `convert/demo-to-ce.ts`,
    `collectBspSpacePointers`, the script row, the +0x1C info row, the grouped reference line,
    `core/scripts/convert-external.ts` accepts a demo map. Tests `convert-demo.real-map.test.ts`: raw
    word-by-word check of the rebase (every changed word moved by exactly -0x0BAD0000; 20,773 in the tag
    data, 562 in the BSP), every BSP-space word equals PC bloodgulch's, model data equals PC's, the old
    prototype CRC 0x46B6B108 reproduced, output 70,828,894 B / 0x981B3317 by rawCrc (node:zlib);
    same-reader: per-kind counts, pre-flight rows, CE reader read-back. Mutation check: skipping the BSP
    data blocks fails 6 tests. Phase 1 tests changed on purpose: +0x1C is no longer refused; the ui.map
    script row passes without acknowledgement.
  - **Stage 1 confirmed in OpenCE (user, 2026-10-12):** bloodgulch_demo plays with no issues found; clean
    sounds and HUD. Seen: the flamethrower did not spawn although its tag is in the map, probably the
    scenario's placements; not investigated (a separate check).
  - **Pointer count, stock bloodgulch (21,334):** tag data 20,771 (paths 2,410, data 2,409, reflexives
    6,982, data blocks 2,052, reference paths 6,918) + BSP space 468 (header 1, reflexives 386, data blocks
    81) + the scenario's `bsp address` 1 + BSP reference paths 94. The prototype's 21,238 = its 7,368
    reflexives (6,982 + the BSP's 386) and 2,133 data blocks (2,052 + 81) + paths, data and references;
    21,238 + bsp address 1 + BSP header 1 + BSP reference paths 94 = 21,334. The tag array pointer is
    rewritten too (not counted): 21,335 changed words = 20,773 in the tag data + 562 in the BSP.
  - **Stage 2 built (verified by tests; unverified in OpenCE):** tests only, no code change
    (`convert-demo-mods.real-map.test.ts`). Zombiemod 118,787,881 B / 0x9C98E7D0 and TrueInfectionV2
    162,786,612 / 0x45689D04 convert (script data repair; 12 / 8 junk netgame references tolerated, left as
    they are; +0x1C kept); MGMWeaponCollab refused (decision B + 3 sound ranges at 90.8 MB, past the end of
    the 79.9 MB stock sounds.map); ParanoiaV2 refused (decision C); ui 29,146,822 / 0xCBABF9E8 and b30
    170,964,588 / 0x27DD7F80 measure-only (b30 only with OPENCE_SLOW_TESTS=1). Pointers moved: Zombiemod
    33,074, TrueInfectionV2 42,078, ui 10,314, b30 37,727 (2 BSPs). Noise to address in the GUI stage:
    Zombiemod's "Resource names match the tags" row lists 5,957 protected names (the developer script
    prints them all as warnings).
- 2026-10-12: **Phase 1c confirmed in OpenCE (user, OpenCE build 185).** Details: `memory/opence-notes.md`
  "Results in OpenCE".
  - heh_2, crossing and barrier converted with the current code (Phase 1c alignment plus the required
    repairs) **load and play**. barrier logs "60 sound permutations converted", 42 HUD elements and 2 HUD
    meters; crossing logs 64 permutations, 32 HUD elements and 2 HUD meters; both log "local machine is
    loaded & ready to play". These are the lines that were missing before Phase 1c (barrier's 42 matches
    the simulated count; crossing's 64 = the 60 stock Ogg permutations + its 4 energy-sword sounds).
  - The stock control maps (bg_pc_ce, bg_md_ce) behaved the same.
  - OpenCE now renames maps in `custom_maps` to hash names ("map sharing"), and it loaded a map whose
    header name differs from its file name. (Our writer still sets the header name from the file name.)
  - theisland_3 stays refused by the model part check. The opt-in repair of model #2574's 35 strip
    indices (option 2) is a later, separate decision. Its scenario's scenery palette entries 14 and 15
    point at the wrong kinds of tags (a sound and a device_machine); OpenCE blanks them.
- 2026-10-12: **Research: the sound and HUD glitches have one cause (unaligned tag blocks).** Details,
  citations and measurements: `memory/opence-notes.md` "Cause of the sound and HUD glitches".
  - OpenCE's `loaded_block_get` treats any block not 4-aligned in the tag cache as unreadable, so its
    sound conversion (Ogg Vorbis -> Xbox ADPCM), HUD half-scale pass and meter channel pass skip the
    HaloMD maps' blocks (1 or 2 mod 4) without a message. Ogg sounds (player death, announcer, plasma
    overheat) then play as ADPCM noise; weapon HUD elements stay double size, meters keep Halo PC's
    channel order. The source data equals CE's; the converter's untouched layout is the problem.
    Simulated HUD counts match the logs (CE bloodgulch 32, heh_2 12).
  - "build_sprite failed to allocate dynamic vertices": a per-frame particle vertex limit
    (4 x 8192 world-sprite vertices or 1,023 buffers), not shown to be a map defect.
  - **Control test (pending, user):** stock PC and HaloMD bloodgulch converted with the developer script
    (70,735,338 B, CRC32 0xA6E5A966 / 0xB38CBC61, 0 repairs). Their blocks are aligned, so they should
    play clean and log "60 sound permutations converted" and "32 HUD elements". Commands in
    opence-notes.md.
  - **Control test result (user, OpenCE build 185):** bg_pc_ce and bg_md_ce load and play with clean
    sounds and log "60 sound permutations converted to 1712772 bytes of Xbox ADPCM", "32 HUD elements
    ... half their scale" and "2 HUD meters", like bgali. Cause confirmed.
  - **Decision (user): Phase 1c approved as planned.** Measured: the HaloMD tool did not pad after the
    tag path strings, so every root, block and data block is 2 mod 4 (heh_2, theisland_3, barrier) or
    1 mod 4 (crossing); CE and stock maps are padded (0 unaligned). Repair: insert 2 or 3 zero bytes
    after the path strings and move every pointer past that point (the ADD growth mechanism,
    `applyPointerShift`). Conditions: the tolerant walker allows only the known stale pointers (heh_2 1,
    theisland_3 2 dependency path pointers outside the tag data; crossing #2404's root) and refuses
    anything else; the alignment row mirrors `loaded_block_get` exactly and finds 0 on the 5 CE maps,
    PC and HaloMD bloodgulch and every HaloMD output after the repair; align first, then the other
    repairs (script padding drops to 0, output sizes unchanged); a map with mixed remainders is refused.
  - **Built (Phase 1c; verified by tests, unverified in OpenCE):** `convert/align-tag-data.ts`, the
    tolerant walker mode in `pointer-rebase.ts`, rows "Tag blocks are 4-aligned (OpenCE skips unaligned
    blocks)" and "Repair: align the tag data" (required), `?mock=convert-align`. Details and decisions:
    SOURCES.md "Converter Phase 1c". Two corrections to the plan: (1) theisland_3's second stale
    pointer has tag ID NONE (banshee_mp weapons[0].weapon), so the tolerance rule is "reference path
    pointer outside the tag data", any tag ID; (2) the expected sizes were wrong for heh_2 and crossing:
    once aligned, their script data needs no repair (it was only misaligned), so they are 380,076 B
    smaller than before. Barrier and theisland_3 keep the script repair (overlap).
  - **Outputs** (`core/scripts/convert-external.ts`, HaloMD resource files; CRC checked with node:zlib):
    heh_2 70,827,480 B, CRC32 0x03C90A64 (+2 alignment, no other repair); crossing 75,214,271,
    0xAC83C8A3 (+3, then #2404's 72-byte struct); barrier 77,718,428, 0x9259F2E9 (+2, then the
    380,076-byte script block, 0 padding); theisland_3 still refused (model #2574).
- 2026-10-12: **OpenCE results: heh_2, crossing, barrier play; glitches; theisland_3 model check; roadmap.**
  Details: `memory/opence-notes.md` ("Results in OpenCE", "Known problems on converted maps").
  - **User's tests (OpenCE build 185, debug and release builds):** heh_2_ce, crossing_ce and barrier_ce
    (developer script, HaloMD resource files, required repairs) **load and play**. bgali loads; bgmis
    blue-screens (unaligned script data is fatal). The overlap repair, the script-data alignment repair
    and the #2404 struct repair work in game.
  - **Known problems (same in debug and release; attributions likely, not certain):**
    1. Sounds: only some one-off player and announcer sounds are garbled (player death; the gametype
       call-out at match start in heh_2; in barrier probably the game-over announcer; in crossing one
       sound while firing the plasma pistol, possibly an announcer). Weapon, grenade, ammo and ambient
       sounds are fine.
    2. HUD: every weapon's ammo icons are very pixelated and depleted rounds draw wrong; the plasma
       pistol overheat meter icon is distorted. Total ammo and grenade counts are fine.
    3. heh_2 logged "build_sprite failed to allocate dynamic vertices" once during play.
  - **Leads, not conclusions:** bgali's log has "60 sound permutations converted to 1712772 bytes of
    Xbox ADPCM", "32 HUD elements ... half their scale" and "2 HUD meters"; the converted maps log no
    sound conversion, 12 HUD elements and 1 meter. Research is Task 2; a control test (stock PC and
    HaloMD bloodgulch converted) separates conversion effects from the modded maps.
  - **Decision (user): theisland_3 model, option 1 now.** A checklist row that blocks Convert, naming
    the model, part and bad indices, using OpenCE's `custom_edition_model_part_verify` rules; it must
    find 0 on the 5 CE maps and on heh_2, crossing and barrier (they load). Option 2 (an opt-in repair
    of the 35 indices) stays a later, separate decision.
    **Built:** `convert/model-part-check.ts`, checklist row "Models pass OpenCE's part check"
    (`modelParts`, refuse), `?mock=convert-model-parts`. Verified by tests: 0 problems on the 5 CE maps,
    heh_2, crossing, barrier (and HaloMD/PC bloodgulch, b30, ui); theisland_3 exactly #2574's two parts;
    a raw walker (no schema) agrees on part counts and bad indices; one mutation test per rule. The
    model-level node count is included (SOURCES.md "Converter: model part check"); the 44-64-node
    local-nodes path is untested (no sample model has 44+ nodes).
  - **Roadmap change (user):** Xbox and MCC conversion are off the active roadmap. Xbox: OpenCE plays
    Xbox maps natively. MCC: reportedly an OpenCE fork plays Halo CE MCC maps (unverified; OpenCE PR #241
    adds version 13). Mac full-version maps: optional, later, same path as Phase 1b. **The goal is now
    Mac Demo conversion (Phase 2, sample_maps/MacDemo).** The Stage 3 fingerprint table needs only PC
    retail, HaloMD, Mac demo and CE. After Task 2 and the control test: a research-only Phase 2 task that
    applies Phase 1b's lessons (entry data fields of external sounds, BSP path pointers, script data
    alignment and overlap, strip index checks, OpenCE's extent validator).
- 2026-10-11: **OpenCE results, script-data repair for every unaligned map, theisland_3 model problem.**
  Details and citations: `memory/opence-notes.md` (OpenCE build 185 = commit 6399ed9).
  - **User's tests (build 185, debug build):** bgali (CE bloodgulch, script data moved to an aligned
    address) loads and plays; bgmis (same, 2 mod 4) blue-screens after "the scenario's script data is
    missing or damaged", exactly like heh_2_ce and crossing_ce. **barrier_ce (overlap repair, aligned
    block) loads and plays: first converted map confirmed in OpenCE.** crossing_ce passed the address
    check (struct repair works) and stopped at the script line. theisland_3_ce passed the validator and
    was refused at the model part check. None of these hang; the blue screen is OpenCE's halt screen.
  - **Why it is silent (code):** that message is `error(0, ...)` = `_error_immediate`, which ends in
    `system_exit` -> `halt_and_catch_fire` (blue fog, forever) with `error()`'s lock still held, so
    nothing more is logged. `hs_scenario_postprocess`'s FALSE return is ignored by its callers.
    (The earlier research note that the message was harmless was wrong and has been corrected.)
  - **Decision (user) and built (commit a346a97):** script-data repair (a) is required for every map
    whose script data is not 4-aligned (base + offset), with or without used nodes and overlap; the
    overlap condition stays. A misaligned header that is not a script node array is unrepairable
    (refused). The alignment note row is gone.
  - **Expected outputs** (`core/scripts/convert-external.ts`, HaloMD resource files, output names
    `<map>_ce.map`; computed in memory, not written): heh_2 71,207,556 B, CRC32 0xEF4726E1 (+2 +380,076);
    crossing 75,594,347, 0xF4E6246C (+3 +380,076, then +0 +72); theisland_3 105,728,562, 0xFC042F66
    and barrier 77,718,428, 0x6F5E37CB (both unchanged).
  - **Open: theisland_3 model.** OpenCE's `custom_edition_model_part_verify` refuses a part whose strip
    indices reach past its vertex count. `effects\debris objects\forerunner dark structure\forerunner
    dark structure` (#2574, used only by the pelican explosion's debris object) has 2 such
    indices in geometry 0 (70, 71 of 70 vertices) and 33 in geometry 1 (221-586 and one 11565, of 44; corrected 2026-10-12). 0 failing
    parts in the 5 CE maps and every other HaloMD map. Options proposed, no decision yet.
- 2026-10-11: **OpenCE findings and tag data repairs (user-approved plan, decisions and conditions).**
  - **OpenCE findings (read in OpenCE's code, scratch clone C:\temp\OpenCE-src at 6399ed9; addresses from
    OpenCE's log):**
    - `tag_validate.c` `validate_data_extent`: every block and data range must lie inside the tag data,
      and each claims its bytes; touching a claimed byte is refused. Order: tag data header, tag table,
      every tag's root, then each tag walked in order. OpenCE stops at the first refusal.
    - theisland_3 / barrier: the scenario's script syntax data (380,076 B) overlaps other tags.
      theisland_3 has 346,620 bytes of its own (33,456 overlap: script strings, the structure bsps
      block, roots and blocks of tags #1-#35); barrier 378,924 (1,152 overlap). Neither has used script
      nodes; past the 56-byte header the bytes are empty-slot fill. Logged at 0x404864FE / 0x4047662A.
    - crossing: `custom_edition_cache_load` (`cache_file_formats.c`) refuses a tag whose address is
      outside the tag data; #2404 `sound\sound environments\arena` points at the tag data end (= file end).
    - heh_2 "script data is damaged": `hs_scenario_syntax_data_valid` (`hs.c` l.12790) needs a 4-aligned
      address (heh_2: 0x4047A916; every HaloMD map is unaligned, the 5 CE maps are aligned). Afterwards
      scripts are off and OpenCE uses its own empty array, so this message does not explain the blue screen.
    - Free slot rule: `data.c` (`datum_new` l.314, `datum_try_and_get` l.135, `data_next_index` l.468,
      `data_iterator_next` l.438, `data_delete_all` l.393): a slot with identifier (first int16) 0 is free.
    - Other checks a converted map may still hit (not yet reached by crossing): shader type, model strips
      and vertices, BSP header and lightmap layout, animation node counts, tag data below the lowest BSP
      (HaloMD maps have 9.6-18.3 MB of room). Script function indices: OpenCE renumbers calls by name.
      Resource maps: OpenCE loads bitmaps.map / sounds.map / loc.map next to the map.
  - **Built:** `convert/extent-check.ts` (the block check in OpenCE's order, all violations reported;
    0 on the 5 CE maps and heh_2; theisland_3 / barrier / crossing match OpenCE's logged addresses).
    `convert/tag-data-repairs.ts`:
    - (a) `scriptSyntaxData`: new block of the declared size at the end of the tag data, 0-3 zero padding
      so it starts 4-aligned from the tag data start (base + offset); 56-byte header and used nodes
      (count x 20) copied, the rest zero; scenario +0x480 pointer rewritten; size unchanged. Required when
      the block check flags it and the used nodes fit in its own bytes (unrepairable otherwise). Optional
      (unticked) when it is only misaligned and has used nodes; a note only when it has none (heh_2).
    - (b) `tagRootOutside`: zeroed struct of the group's schema size (crossing #2404: 72 B, = OpenCE's
      0x48), tag entry +0x14 rewritten. Only when no reference names the tag with its full tag ID.
    - Refused (with the reason) unless the tag data is the last block of the file and the new end stays
      below the lowest structure BSP address. Changes: header 0x8 and 0x14, one pointer per repair, the
      appended bytes; the CRC is recomputed by the writer.
    - The block check runs again on the output; any problem refuses the write (same-reader, anchored by
      the 0 on the CE maps and the exact match with OpenCE's addresses).
  - **Checklist:** "Tag blocks are inside the tag data and don't overlap" replaces "Tag data pointer
    outside the tag data" (its acknowledgement is gone). Each repair is a row with a checkbox; required
    ones are pre-ticked and unticking one turns Convert off with the reason (`REPAIR_REQUIRED` in core).
    "Script data alignment" is an info row. Dev mock: `?mock=convert-repairs`.
  - **Outputs (`core/scripts/convert-external.ts`, HaloMD resource files, required repairs applied):**
    theisland_3 105,728,562 B, CRC32 0xFC042F66 (+2 padding +380,076); barrier 77,718,428, 0x6F5E37CB
    (+2 +380,076); crossing 75,214,271, 0x25480338 (+3 +72). heh_2 needs no repair (70,827,478, unchanged).
  - **Cannot be verified here:** whether OpenCE accepts the moved script data and the zeroed struct; the
    cause of heh_2's blue screen (next step: user supplies halo.log, the crashes\ dump and the -symbols
    zip; run `tools/symbolize_crash.py` from the scratch clone and read the crash site before proposing
    anything); scripts in maps that really have used nodes; a full `map_validate` run.
  - **Next, optional, separate task:** `map_validate` via WSL (Linux-only, 32-bit, clang + ninja). Read
    `port/linux/README.md` first and propose exact steps; nothing is installed without the user approving
    each step.
  - **Roadmap notes:** OpenCE plays Xbox maps natively from a disc image, so an Xbox converter is not
    needed for OpenCE (roadmap item d below is on hold). OpenCE PR #241 (MCC v13 support) is unchecked.
- 2026-10-11: **Converter Phase 1b, Stage 2 (core only, no GUI; user-approved plan and decisions).**
  - **Built:** `core/src/map/raw-data-region.ts` (`appendToRawDataRegion`: adds bytes at the end of the
    raw-data region = the model data offset; moves model data + tag data; updates header 0x8 file size,
    0x10 tag data offset and tag data header +0x14 model data offset). Written to be reused by Inject for
    embedded relocation. `convert/resource-files.ts` (resource table read by offset through a
    `RandomAccessFile`; core has no fs). `convert/externalize-in.ts` (schema walk of every tag incl. BSPs
    for annotated bitmap/sound data fields; range check; packing; patches). `write-map.ts`: the atomic
    writer moved from the worker into core with injected fs operations, shared by the worker and the
    developer script.
  - **Rules as decided:** the range check decides (every external (offset, size) must equal an entry of
    the supplied file; name and size never trusted; fingerprints in Stage 3 cannot override it). New
    data at the end of the existing raw region (or the BSP end), no padding, bitmaps then sounds in
    tag-index order, one copy per reference (CE-built maps never share internal ranges). Patches:
    BitmapData +0x18 and flags +0x0E (clear 0x100); samples +0x48 and the +0x44 word (bit 0 only). Tag
    data size, tag data pointers, BSP start and model-data-relative offsets unchanged. Mismatched bitmap
    sizes are copied by stored size with a warning naming the tags (crossing 1, barrier 2). Names that
    differ from the resource entry only warn (barrier: `detail metal scratches fix` uses
    `detail metal sratches_0`).
  - **New checklist rows:** "Bitmap and sound data is inside the map" (refuse without the files),
    "The resource files match this map" (range check), "Resource names match the tags", "Bitmap sizes
    match their format", "Estimated output size", and "Tag data pointer outside the tag data" (warning
    with explicit acknowledgement; measured: 0 on all 5 CE maps, HaloMD heh_2 / theisland_3 / barrier /
    bloodgulch / ui / b30 and PC bloodgulch 0, crossing 1 = #2404 `sound\sound environments\arena`).
    "No tag is marked external" was renamed "No tag entry is marked external (whole tags)".
    (Superseded: the acknowledgement row became the block check and repair rows, see "OpenCE findings
    and tag data repairs" above; --acknowledge-tag-data-outside is gone.)
  - **Outputs (developer script, HaloMD resource files):** heh_2 70,827,478 bytes, CRC32 0x90103670;
    theisland_3 105,348,484, 0xC990AADF; crossing 75,214,196, 0x9B38092C (needs
    --acknowledge-tag-data-outside); barrier 77,338,350, 0x6A0F30B7. Sizes equal the estimates.
  - **Tests:** `convert-external.real-map.test.ts` (independent: raw offsets + node:zlib, packing computed
    by the test; mutation-checked), `raw-data-region.test.ts` (synthetic). Changed on purpose: the
    header-only heh_2 / theisland_3 tests (CRC 0xD1C331E9 / 0x0A5AFEA5) now expect a refusal without
    resource files; the header-only path is tested with ui.map as v7 with its assets marked internal
    (core and worker tests).
  - **Stage 3 (GUI), planned, NOT started (items 10-13 of the user's addition):**
    10. Source files step in the Convert dialog: lists the resource files the map needs and asks for the
        folder that contains them (fallback: pick each file). Only that folder is inspected, non-recursive.
    11. Identify files by content: a data file of fingerprints (file name, size, hash of header + table,
        optional full hash for a "Verify" button with progress) for PC retail, HaloMD, Mac demo and CE
        only (user, 2026-10-12: xbox/ dropped), built from sample_maps; no game data. The dialog states what it recognised and
        which sources are compatible; a wrong set says what it is and what the map needs. An unrecognised
        file is accepted with a warning only if the range check passes. The range check decides when the
        two disagree. PC and HaloMD bitmaps.map share their table (only the 16 thumbnails differ).
    12. Settings and privacy: remember a folder per source family in settings.json (main process only;
        the renderer gets status, never paths), re-validate on use, handle moved or deleted files; Convert
        blocked while a required file is missing, naming it and the sources that would supply it.
    13. No bundled game files (recorded in "Converter: per-asset external data" below).
    **Additions (user, 2026-10-12; recorded, not built; for retail-layout and Mac Demo maps alike):**
    14. The Convert dialog asks for the converted map's name. Default: the part of the file name after
        "bloodgulch-" (Mac demo mods are all renamed bloodgulch-<mod>.map with header name bloodgulch);
        for the stock demo bloodgulch.map suggest "bloodgulch_demo" (so it doesn't clash with CE's
        bloodgulch); else the file name; at most 31 characters; warn when the name is "bloodgulch" and
        when it duplicates a map the user already has.
    15. Source files step: takes a folder or individual files; defaults to the map's own folder;
        remembers folders per source family; recognises files by content; says which maps each file is
        compatible with; accepts a mod's own bitmaps.map / sounds.map in place of the stock ones when
        the range check passes (never by name or size); never bundles game files.
    Plus: checklist rows in the dialog, estimated size and free disk space, progress and Cancel,
    dev-mock scenarios, component tests, and the acknowledgement checkbox for the new row.
  - **Note for later (user, 2026-10-11):** extracting the Yoyorast_Island mongoose is blocked by 3 model
    geometry blocks and 7 embedded items, so a custom vehicle needs gbxmodel geometry Stage 2 and
    embedded relocation. The raw-data region writer above is meant to be reused for that relocation.
- 2026-10-11: **Converter: per-asset external data (finding) and Phase 1b plan. PLANNED, NOT STARTED.**
  - **Finding (user, OpenCE):** heh_2_ce.map and crossing_ce.map blue-screen. Measured with
    `verifyEmbeddedData` (counting only bit 0 of the sound word as external, see the open issue below):
    heh_2 676 bitmap images (44,396,916 B) + 951 sound permutations (11,972,226 B), all external,
    no raw region (model data at the BSP end 1,519,616). theisland_3 742 (60,659,138 B) + 1129
    (20,946,198 B), all external. crossing 622 ext + 16 int bitmaps, 931 ext + 61 int sounds. barrier
    610 ext + 36 int bitmaps, 941 ext + 65 int sounds. The Phase 1 check "No tag is marked external"
    only reads the tag entry (+0x18/+0x1C), so it missed this.
  - **Resource identity (measured):** every external (offset, size) in heh_2, theisland_3, crossing and
    barrier equals a resource entry's (data offset, size) in HaloMD/ and PC/ bitmaps.map and sounds.map,
    and the entry name is `<tag>_<image>` / `<tag>__<pitch range>__<permutation>` for all but one (barrier
    reuses `detail metal sratches_0` for `detail metal scratches fix`). MacDemo/ matches 349-355 per map;
    CE's own files about 1. heh_2's 1627 (offset, size) pairs equal stock bloodgulch's for the same tag.
    HaloMD/ and PC/ have identical tables; sounds.map is byte-identical, bitmaps.map differs only in the
    16 entries `ui\shell\bitmaps\mp_map_grafix_3..18` (MP map thumbnails), so the table cannot tell them
    apart and either gives the same game data apart from those thumbnails.
  - **Raw region layout (measured on crossing, barrier, coldsnap, Yoyorast):** internal ranges tile
    `[last BSP end, model data offset)` exactly, back to back, no padding or alignment, absolute file offsets.
  - **Open issue (pre-existing, not fixed):** the sound `samples` word +0x44 is 0x1 for external data, but
    some internal sounds carry 0x01000000 (barrier 8, coldsnap 9, Yoyorast 3; their bytes lie inside the
    map's raw region). `embedded-data-fields.ts` treats any nonzero value as external, so Verify Embedded
    Data, the walker and extraction misreport these. Needs its own decision and fix.
  - **Roadmap (in order, none started):**
    a. Phase 1b: v7 maps with per-asset external data, using the source game's full-version resource
       files (HaloMD maps: HaloMD/bitmaps.map and HaloMD/sounds.map). Header-only Phase 1 is valid only
       when all data is internal. Covers heh_2, theisland_3, crossing, barrier (all v7, base 0x40440000).
    b. Phase 2: true demo layout (v6, base 0x4BF10000), e.g. MacDemo/bloodgulch.map, with the MacDemo
       resource files.
    c. Mac full-version maps (folder added later): same path as 1b if resource identity matches.
    d. Xbox (v5): REMOVED from the roadmap 2026-10-12 (OpenCE plays Xbox maps natively). Notes kept:
       compressed after the header, tag data base 0x803A6000, model data inside tag data.
    e. MCC (CEA, versions 7/13): REMOVED from the roadmap 2026-10-12 (reportedly an OpenCE fork plays
       them; PR #241 adds version 13; unverified).
    f. barrier and crossing (HaloMD-only): both v7 retail layout with some internal data; part of 1b.
  - **Distribution (user decision 2026-10-11):** the tool never bundles game resource files. Bundling the
    Mac demo (about 162 MB) and HaloMD (about 535 MB) bitmaps/sounds.map was considered and rejected
    (copyright, size). Users point the tool at their own files; the tool ships only fingerprints (sizes and
    hashes of header + resource table, optional full hash), never game data.
  - **Note for later:** a converted map that lacks CE-required tags will need them from CE's own ui.map,
    bitmaps.map, sounds.map and loc.map, which every OpenCE player has. Not planned yet.
  - **Not verifiable without OpenCE:** whether CE plays retail sound sample formats unchanged; the stale
    demo-era references (salt mismatch); the stale tag-file checksum.
- 2026-10-11: **Sample folders.** `sample_maps/` (untracked, git-ignored): CE maps and CE resource maps at
  the root; `HaloMD/`, `MacDemo/`, `PC/`, `xbox/`, `MCC/` each with that game's maps and resource maps.
  Folder names live only in `SAMPLE_FOLDERS` in `core/tests/helpers/sample-maps.ts`. Measured: xbox/
  bitmaps/sounds/loc.map are byte-identical to the CE root files; HaloMD/b30 and sounds.map equal PC's;
  HaloMD/bloodgulch.map and ui.map differ from PC's in about 240 bytes of tag data (UTF-16 text).
- 2026-10-11: **Converter Phase 1 (branch `feat/demo-converter-phase1`, user-approved plan with conditions).**
  - **Scope:** retail-layout maps (standard header, version 7, tag array 0x40440028) -> 609. True demo
    layout (v6) is detected and refused with a Phase 2 message. Module `core/src/map/convert/`
    (`classify.ts`, `reference-identity.ts`, `retail-to-ce.ts`); the CE reader is unchanged (checks read a
    private copy with version 609).
  - **Header bytes (measured on heh_2 and theisland_3 vs the 5 CE maps):** only 0x4-0x5 (7 -> 609),
    0x4A-0x4C (build "0576" -> "0609"), 0x64-0x67 (CRC was 0), plus the name bytes when the output name
    differs (finalizeForSave). Padding (0xC) already 0, type matches, 0x18-0x1F / 0x62 / 0x68-0x7FB zero
    as in CE, tag data header already CE (array 0x40440028, scenario ID 0xE1740000). Tag-file checksum
    (0x5E2AF81E, the demo bloodgulch value) left unchanged, as Save does.
  - **Refused:** not version 7; file size != header; padding != 0; array pointer != 0x40440028; any tag
    entry with nonzero +0x18 or +0x1C (retail has no CE external flag; both HaloMD maps have 0 in all
    entries); BSP/model/tag-data regions outside the file; an already-609 map.
  - **Warnings (converted unchanged, nothing fixed):** validation errors; references whose full tag ID or
    path pointer differs from the entry; missing PC_REQUIRED_TAGS; Inject ADD refused afterwards (pointer
    walk can't follow the stale reference); internal name; tag-file checksum.
  - **Stale references (decision: warn only, no repair now).** The CE validator only checks the index, so
    it missed these. Each HaloMD map has exactly one, left from the demo: heh_2 BSP `sound environment
    palette[0]` (ID 0xEADF0969 vs entry 0xEADD0969, path 0x4BF3ED7B), theisland_3 scenario `scenery
    palette[14]` (ID 0xEB2D0989 vs 0xEAFD0989, path 0x4BF243BC). All 5 CE maps: 0 mismatches
    (bloodgulch 7048, sidewinder 7111, coldsnap 8844, ui 3311, Yoyorast 6810 references). If a converted
    map crashes or loses scenery/sounds in OpenCE, add a separate explicit repair step.
  - **Scripts:** any function call in a map with scripts or globals needs an explicit acknowledgement
    (checkbox); no remapping. The complete demo/CE function-index difference list is not in this repo,
    so this is a superset of "functions whose indices differ". Both HaloMD maps: 0 scripts, 0 globals.
  - **GUI:** banner button (v7 only) and File > Convert to Custom Edition...; checklist dialog with old
    and new CRC32; Save dialog defaults to `<name>_ce.map` next to the source; refuses the source path,
    the open map's path and `.bak`; writes through `writeFinalizedMap` (temp + rename, name from the file
    name with the truncation warning); the output opens as the current unmodified map. The source and the
    backup-on-open flow are never touched.
  - **Correction to the research notes:** theisland_3's scenario has two validation errors, not one:
    scenery palette[14] -> a sound and palette[15] -> a device_machine.

- 2026-10-11: **Sound external bit (branch `fix/sound-external-bit`, user decision B).** Only bit 0 of a
  TagDataOffset's external word means "in sounds.map". Before: any nonzero value counted, so 20 internal
  sound permutations with the word 0x01000000 were treated as external (evidence: SOURCES.md).
  - Verify Embedded Data, embedded / external: coldsnap 396/9 -> 405/0; Yoyorast_Island 145/3 -> 148/0;
    HaloMD barrier 93/1559 -> 101/1551; crossing, heh_2, theisland_3 and the stock CE maps unchanged.
  - Extraction: those sounds now carry their bytes as embedded assets instead of external references.
    ADD of such a sound (e.g. coldsnap `sound\sfx\vehicles\pelican_wind`) into bloodgulch was
    "added, 4 external references" (pointing at unrelated sounds.map bytes) and is now blocked as
    embedded data, like every other embedded asset while relocation is disabled.
  - Tests changed on purpose: the coldsnap counts in `embedded-data-verifier.test.ts` and
    `embedded-relocation.test.ts` (396/9 -> 405/0). New: bit-0 unit test, raw-region tiling check,
    `sound-external-bit.real-map.test.ts`.
- 2026-10-11: **In-memory inject and File > Save (branch `feat/inject-in-memory-save`, user-approved
  plan with changes).**
  - **Inject** applies ADD/SWAP to the worker's held map (buffer replaced, header and tag index
    re-parsed), marks it modified, writes nothing. Later plans run against that buffer, so
    injections stack and reuse is detected against tags added earlier. Not finalized in memory;
    `finalizeForSave` runs only when saving. Extraction also reads the in-memory map.
  - **File > Save** (Ctrl+S): the one permitted overwrite of the opened map (RULES.md,
    CLAUDE.md). Only while modified; disabled for a map opened from a `.bak` (Save As only).
    Refused when the file on disk changed since open / last save (size or mtime). Temp file in
    the same folder + rename after `finalizeForSave` (name from the file name, CRC32). A failed
    write (disk full, locked or read-only file) deletes the temp file, leaves the original
    intact and shows a plain message; the changes stay in memory. Never touches the `.bak`.
    The log says when the header name was changed to match a renamed file.
  - **File > Save As**: refuses the open path ("use Save"), writes a new file; that file
    becomes the open, unmodified map. An unmodified map saved under a new name still differs
    only at 0x20-0x3F and 0x64-0x67.
  - **Backup prompt on open** (.map only, once per open): Create backup / Skip; copy to a temp
    file, size check, rename to `<name>.map.bak`. Existing `.bak`: byte-identical -> no
    prompt, log "Backup already up to date"; otherwise Keep existing (default) / Replace /
    Skip. Failures: plain message. Skipped or failed -> File > Save asks before its first
    overwrite. Not asked for `.bak` files, nor on Discard.
  - **Unsaved changes**: Save / Don't save / Cancel before opening another map (dialog,
    recent, drop, open-file) or closing the window; Save runs the normal Save (including the
    no-backup confirmation). **Discard Changes** asks, then reopens the file from disk.
  - **Compressed maps**: nothing is held in memory for editing (the worker keeps no buffer);
    Inject, Save and Save As are refused with a message pointing to Tools > Decompress Map.
    Save and Save As therefore only ever write uncompressed maps. Recompress (reads the file on
    disk) is refused while there are unsaved changes.
  - Status: verified by tests (worker on real map copies in a temp folder; flows with injected
    deps; component tests).
  - **Confirmed (user, 2026-10-11, Windows):** in-memory Inject, File > Save, File > Save As,
    Discard Changes, the backup prompt on open, the unsaved-changes prompt and the `.bak`
    handling all worked, and the map written by File > Save loads in OpenCE. The unsaved-changes
    dialog's logic is covered by tests; the real dialog was only exercised by hand.
- 2026-10-11: **ADD tag-array growth (branch `fix/add-tag-array-growth`, user-approved fix (1)
  with conditions).**
  - **Evidence (user, `bg_add1.map` vs bloodgulch.map):** header correct (scenario name bg_add1,
    CRC32 0xbcf008cc matches an independent computation); tag count 2455 -> 2457; file +1346
    bytes, 64 of them the two new entries; path strings start right after the array, so
    everything after it shifted by 64; original tag data intact and shifted by 64; NO pointer
    adjusted (2455 path pointers, 1570 internal data pointers unchanged), so every path and
    every internal pointer was off by 64; the new tags' own pointers also landed 64 bytes early.
    Reproduced in memory (same 2 tags, same +1346 bytes). One more change the injector made:
    the tag data header's array pointer was lowered 0x40440028 -> 0x4043FFE8, which the engine
    reads with its fixed base (64 bytes before the tag data header).
  - **Cause:** the injector assumed the base is inferred from the array pointer (invader
    map.cpp:244, a reader's guess) and "re-anchored" by lowering it. The engine's CE base is
    the fixed 0x40440000. Our own reader inferred the base the same way, so every ADD test
    passed (same-reader). The PRD claim "ADD ui into bloodgulch passes" was wrong in effect.
  - **Measured:** array pointer 0x40440028 in all 5 CE maps and both HaloMD retail-layout maps
    (true demo: 0x4BF10028); path strings start exactly at the array end in all 5 CE maps.
    Pointers a growth must move in bloodgulch: 2455 tag path + 1569 tag data + 5019 reflexive +
    1088 data block + 6954 reference path = 17,085. None in `Pointer` fields (model vertex
    offsets, bitmap 0xFFFFFFFF), none in `nonCached` fields, none in BSP space (`bsp address` is
    a plain uint32 in BSP memory; sbsp entries' data pointer is 0).
  - **Non-pointers checked (condition 2):** the 2 coldsnap int32 values that look like tag-data
    addresses are `GBXModel.node list checksum` 0x409ef03c (plasma rifle and its fp model, same
    value). All other struct words in the tag-data range are float/Point3D/Plane/Angle/Vector
    fields, BSP2D/3D child/plane indices (0x408000xx), bitmap pixel offsets, an `unknown_ffffffff`
    and a node transform flag; none equals a real pointer target except coldsnap floats. Blobs:
    script syntax data - the 0x64407440 "d@t@" header magic and real-number constants (node
    type 6, e.g. 5.0 = 0x40a00000); animation frame/default data/frame info and meter stencils -
    float/RLE data at mostly unaligned offsets; strings, fonts, input defaults - none in range.
    No blob holds addresses; blobs are copied unchanged.
  - **Fix:** `core/src/map/pointer-rebase.ts` collects every pointer by walking the tag array and
    each tag's struct tree (schema-driven, never by scanning) and shifts those in a range;
    throws `UnwalkableTagError` naming the tag (ADD is then refused). Shared with the
    converter's Phase 2. ADD grows the array in place, keeps base and array pointer, moves the
    17,085 pointers by the growth. Reader: fixed base 0x40440000, array pointer must be
    0x40440028, else `UnexpectedTagArrayAddressError` ("written by an earlier broken ADD,
    re-create it"); `inferBaseMemoryAddressForClassifier` keeps the guess for the converter only.
    Tag space: `planInjection` refuses when new tag data (padding included) + largest BSP >
    23 MiB. Whole-map SWAP of coldsnap into itself needs 29.34 MiB and is now refused.
  - **Rejected:** fix (2), relocating the array to the end: no sample map has the array anywhere
    but base + 0x28, our own and Invader's readers assume that position, and it leaves a dead
    array per ADD; whether the engine follows a moved array pointer is unknown.
  - **ROOT CAUSE, user-confirmed in OpenCE (2026-10-11): external does not mean resource index
    for sounds.** The first fix still blue-screened. `pointer-rebase.ts` skipped every external
    entry, but an external sound (class `snd!`) keeps its 164-byte base struct in tag data and
    its tag-array data field is that struct's address; only the pitch ranges are in sounds.map
    (reflexive count 1, pointer null). After the 64-byte insertion those pointers were 64 bytes
    early. The user shifted them by hand: maps with the sound fix load (the hand-built hgv7 and
    hgv8; between them, with and without shifting the 94 BSP reference path pointers), maps without it all blue-screened.
    Measured on all 5 CE maps (data field of external entries):

    | Map | sound (address) | bitmap (index) | unicode_string_list (index) | font (index) | hud_message_text (index) |
    |---|---|---|---|---|---|
    | bloodgulch | 333 | 448 (max 1415) | 100 (max 175) | 3 (max 56) | 1 (4) |
    | sidewinder | 334 | 439 (max 1135) | 100 (max 175) | 3 (max 56) | 1 (4) |
    | coldsnap | 327 | 406 (max 1611) | 95 (max 175) | 3 (max 56) | 1 (4) |
    | Yoyorast_Island | 323 | 416 (max 1655) | 97 (max 175) | 3 (max 56) | 1 (4) |
    | ui | 0 external entries (all its sounds, bitmaps, fonts, strings are internal) |||||

    Every external sound held an address and every other external class a small index, no
    exceptions. 11 of bloodgulch's external sound structs hold a reference whose path pointer
    is in tag data (also moved now).
  - **Fix:** the group decides, never the value: `EXTERNAL_GROUPS_WITH_BASE_STRUCT` (sound) gets
    a data-field site and its base struct is walked (null-pointer blocks are in the resource
    map); `EXTERNAL_GROUPS_WITH_RESOURCE_INDEX` (bitmap, font, unicode_string_list,
    hud_message_text) are left alone; any other external group refuses ADD. bloodgulch now moves
    17,523 pointers (17,085 + 333 sound data fields + 11 sound reference paths + 94 BSP
    reference paths).
  - **BSP reference path pointers: done** (not left as an inconsistency). Not read at load (a hand-built
    map loaded without shifting them), moved anyway to match Tool. Found through the scenario's "structure
    bsps" (bsp start, bsp address; the BSP header's first word is the BSP struct address) and
    walked with the schema in BSP space; only dependency path pointers are sites. Counts:
    bloodgulch 94, sidewinder 182, coldsnap 721, Yoyorast 150, ui 0; every one equals a tag-array
    path pointer.
  - **External tags in containers (checked, item 2):** a container never holds an external tag.
    A reference to one stores `{fieldPath, group, path, kind: 'external'}` only (no data, flag or
    resource index). ADD reuses the target's own entry by path + class (its flag, and its address
    or index, belong to the target and its own resource maps, so nothing is carried across maps);
    a missing one blocks the dependent tag. Per-field references inside internal bitmaps/sounds
    (`externalResourceRefs`) keep the resource-map fingerprint check. The injector never writes
    an external entry (new entries are always external=0); SWAP into an external entry is
    refused with a reason. Selecting only an external tag for extraction now says why nothing
    can be extracted (it said "Nothing in this selection can be extracted yet: ." before).
  - **Why the tests missed it:** the same-reader ADD tests re-parsed with our own reader, and the
    first independent audit (`add-preserves-existing-tags`) and pointer census both assumed
    "external = resource index" and required the data field to stay byte-equal - the same
    blind spot as the rebase. The new audit (`entry-data-addresses.real-map.test.ts`) decides
    address-vs-index BY VALUE, independently of the injector's group rule; on the code before the
    sound fix it fails (halo_logo: 333 external sounds point at different bytes, 128 of them
    inside another tag's data).
  - **Converter Phase 2 must treat entry data fields the same way:** rebase the data field of
    external sound entries (and walk their base struct), leave resource indices alone, and move
    the BSP reference path pointers. `pointer-rebase.ts` already does this for any base.
  - **Confirmed in OpenCE (user, 2026-10-11):** the tool's own ADD output (halo_logo into
    bloodgulch) loads. The user's independent check of that file: 333 external sound entry
    pointers +64, 552 resource indices unchanged, 1569 internal entry pointers +64, 94 BSP path
    pointers +64, CRC matches. Nothing references the added tags, so only the load is confirmed.
    ADD with a gbxmodel in the closure stays blocked.
- 2026-10-11: **Roadmap order (user-approved).** Replaces the older ordering in the 2026-10
  converter entry ("M5/M6 work is paused") and the "Upcoming" section.
  1. Fix the swap load failure, including real Save As, scenario-name setting and CRC32
     recalculation (branch `fix/swap-load-failure`).
  2. Halo Demo / HaloMD -> Custom Edition converter. Phase 1 (retail-layout, version 7) first,
     reusing the CRC and header code. Phase 2 (true demo layout, version 6, pointer rebase)
     only after Phase 1 is confirmed in OpenCE. Notes: memory/demo-converter.md.
  3. M7a: in-place tag editor for fixed-size edits (numbers, enums, flags, tag references,
     strings, palette swaps). Example targets: change a weapon's projectile, rate of fire or
     spread; swap a vehicle or scenery palette entry.
  4. M7b: block add, delete and resize, then the scenario placement work (Forge-style).
  Paused until after this: embedded relocation, gbxmodel geometry stage 2, full M6 export.
  **Progress (2026-10-11):** task 1 is done (swap load failure, the ADD tag-array growth fix
  and real Save As, all user-confirmed in OpenCE), and so is the in-memory Inject / File > Save
  work (branch `feat/inject-in-memory-save`, user-confirmed on Windows and in OpenCE). **Next:
  task 2, the converter, Phase 1** (retail-layout, version 7). **Update:** Phase 1 built on
  `feat/demo-converter-phase1`, verified by tests, waiting for the user's Windows/OpenCE check.
  **Planned after the converter, in this order (user decisions 2026-10-11; NOT started, nothing
  built).** Replaces the earlier A/B note of the same day. Order relative to M7a/M7b is decided
  when these are planned.
  - **A. Separate files on multi-tag extraction.** Several tags selected for one extraction (e.g. a
    warthog and a ghost) -> one `.ocetags` file per selected tag, for every tag type.
    - Decided: each file carries its own full dependency set (sizes are not a concern for single
      files).
    - One selected tag keeps the file Save dialog; several selected tags use a folder picker.
    - Inject's file picker accepts several `.ocetags` files at once and stacks them in memory (the
      in-memory Inject already stacks; File > Save / Save As still write).
  - **B. Model geometry Stage 2** (see "gbxmodel geometry" in the status table), so tags with
    gbxmodels can be extracted and injected.
  - **C. Batch extract of a whole open map.** Decisions:
    - Output: `<chosen parent folder>\<mapname>\<top-level folder of the tag path>\...`, mirroring the
      tag path (weapons, vehicles, scenery, ...). `<mapname>` comes from the map's file name (strip
      `.map` and `.bak`), so extracting two maps never mixes their files.
    - Each tag file carries all its dependencies.
    - Progress bar and Cancel. On Cancel ask: keep what has been exported, or delete everything from
      this batch. Planned design: a staging folder inside `<mapname>`, moved into place at the end or
      on Cancel/Keep; Cancel/Delete removes the staging folder, so nothing already on disk is lost.
    - Re-running the same map: ask Skip existing / Replace all / Cancel, default Skip. If Skip
      proves too large to build, fall back to a clear confirmation before replacing all existing
      files.
    - A small manifest per batch (tool version, container version, files), so files made by older
      versions can be identified and offered for replacement.
    - Blocked tags (gbxmodel geometry until B is done, BSP, uncaptured data) are listed in a report,
      never silently skipped.
  - **D. Open design questions (settle when planning A and C):**
    1. File names when two tags share a path but differ in class (e.g. `halo_logo` as a
       ui_widget_definition and as a bitmap).
    2. Windows limits: path length, reserved names (CON, NUL, ...), case-insensitive collisions.
    3. Estimating total output size and free disk space before starting (measure bloodgulch and
       coldsnap).
    4. Progress and cancel behaviour for thousands of tags.
- 2026-10-11: **Swap load failure (branch `fix/swap-load-failure`, user-approved with
  conditions).** The user's SWAP of `globals\globals` with dependencies into bloodgulch (1037
  swapped, 50 gbxmodels blocked) showed a blank blue screen in OpenCE; the original with only the
  name changed loads, and a corrected CRC32 alone did not help. Reproduced in memory: same
  +3,582,368 bytes, same 140 misaligned tags, same CRC 0x43d032f3.
  - **Cause (most likely): 862 data-block pointers never converted.** The extractor rewrites
    every pointer-based TagDataOffset to a tag-local offset; `rewriteAddedTagData` converted
    reflexive pointers back but never these. In that run: 845 in model_animations ("default
    data", "frame data", "frame info"), 15 string_list strings, 2 meter "encoded stencil"; all
    pointed outside the tag data (the original has 0). ADD used the same function, so every
    earlier ADD/SWAP output with fonts, strings, meters, animations, scripts etc. is INVALID -
    re-create it. Saved `.ocetags` files are still fine (the container data was correct).
    "Data-dropping fixed" (2026-08) covered extraction only. The dependency-order tests only
    compared references, which is why this was missed.
  - **Alignment.** All 5 CE maps: every tag, reflexive and data pointer is 4-aligned from the
    tag data start; Tool pads every odd-length block (bloodgulch 154, all padded); spread over
    mod 16 is even, so 16 is not required. Path strings are packed and NOT aligned. Our append
    left 140 of 1037 tag pointers and 948 reflexives at 2 mod 4 (2-byte animation struct arrays
    with odd counts, odd-length strings/stencils).
  - **Tag reference path pointers.** All 5 CE maps: every non-null reference's path pointer
    equals the target tag-array entry's path pointer (external targets too), path size 0;
    null references are 0/0. The injector used to zero them. Re-measured 2026-10-11 (bloodgulch
    6954/6954, sidewinder 6929/6929, coldsnap 8123/8123, ui 3311/3311, Yoyorast 6660/6660 match;
    every null ref 0/0) and pinned by a test on all 5 maps plus every injected output
    (`referencePathPointerIssues`). Path strings re-measured: spread evenly over mod 4 in all 5
    maps, so they stay packed.
  - **Header/tag space were fine:** tag data + largest BSP 10.3 MB < 23 MiB, BSP address still
    13.8 MB above the end of tag data; tag count, scenario ID, model data unchanged.
  - **CRC recipe confirmed** on all 5 CE maps (bloodgulch 0x7b309554): CRC-32 register seeded
    0xFFFFFFFF, no final XOR (= inverted standard CRC-32) over each BSP in the scenario's
    "structure bsps" order (bsp start, bsp size), then model data (modelDataFileOffset,
    modelDataSize), then tag data (tagDataOffset, tagDataSize).
  - **Tag-data header field order settled:** +0x4 is the scenario tag ID, +0x8 is the tag-file
    checksum (the Halo Map Structure PDF has them reversed; the converter notes were right).
  - **Fix:** shared `isRelocatedTagDataField` (extractor + injector); data-block pointers
    converted on apply and range-checked at plan time; reference path pointers written as in
    real maps; apply-time re-layout (`alignTagData`) puts every block 4-aligned from the tag data
    start with zero padding (no container format change, v1-v4 still work); `cache-crc.ts` +
    `finalize-map.ts` (shared with the converter) set the scenario name from the file name
    (max 31 chars, printable ASCII, warnings) and recompute crc32; File > Save As is real; Inject
    and Save As both go through `finalizeForSave`. The tag-file checksum is left alone.
  - **Flagged, not fixed (found 2026-10-11):** `planInjection` has no tag-data size-limit check
    (RULES: "validate before writing ... tag data size limit"). Nothing refuses a plan whose new
    tag data (plus the largest BSP) would exceed the limit, and the new alignment padding adds up
    to 3 bytes per block. Not fixed on this branch.
  - **Flagged, not fixed:** the decompress path (`map-worker.ts` `runCompression`) writes
    straight to the output file, not temp file then rename.
  - **Labels:** real-map tests use an independent audit (`core/tests/helpers/tag-data-audit.ts`:
    schema engine + header/tag-index parser only, none of the extractor/injector walking code).
    CRC tests compare against the crc32 Tool stored and node:zlib. Nothing confirmed in OpenCE.
- 2026-10-11: Dependency dialog warning groups follow how core actually treats each kind, display
  only: `uncapturedData` -> "Cannot be captured / blocked for injection" (blocking; injector blocks
  ADD/SWAP unconditionally); `embeddedRawData` -> own "Embedded data (injection blocked this
  build)" group (blocking; blocked only while `allowEmbeddedRelocation` is off); `invalidReflexive`
  -> own "Invalid / corrupt layout (not walked)" group (walker/verifier react to it, the injector
  does NOT - so it is not labelled an injection block). Unknown kinds -> "Other warnings". Desktop
  `DependencyWarningKind` is derived from core's `WARNING_KINDS`; a dialog test fails on drift.
  **Superseded 2026-10-11 by the next entry:** `invalidReflexive` now blocks ADD/SWAP, and its
  group is labelled "Invalid / corrupt layout (not walked, blocked for injection)". The
  extractor bounds bug flagged here is fixed. Also, "injector blocks ADD/SWAP unconditionally"
  for `uncapturedData` was not true for SWAP until commit 2ee3c9e.
- 2026-10-11 (branch `fix/extractor-reflexive-bounds`, user-approved): **extractor reflexive
  bounds fix.** Research (in-memory corrupted copies of bloodgulch.map) showed that the earlier
  description was incomplete. An out-of-bounds reflexive whose overrun reached decoded fields
  crashed the WHOLE extraction with a raw RangeError (cases (a) partly past EOF and (b) entirely
  past EOF). If only the last element's trailing padding was past EOF (case (c)), extraction
  silently produced EOF garbage as the array, short by the padding. Every later reflexive was
  then shifted (−8 bytes for a model_collision_geometry; `verifyExtractedTagSet` reported 0
  errors), and ADD and SWAP both accepted the tag. A negative resolved base (case (d)) reached
  `Buffer.subarray`, which reads from the END of the file.
  Fix: shared `isRangeInBuffer` (engine.ts) for walker + extractor, negative bases rejected.
  An out-of-bounds reflexive is skipped (nothing copied, `runningOffset` not advanced, its
  12 bytes left as in the source) and the extractor records a per-tag `injectionBlockers`
  entry. Any unexpected per-tag exception now blocks only that tag (`extractionFailed` blocker +
  warning; root bytes kept unmodified if in bounds, no dependencies) and the rest of the
  selection still extracts. `.ocetags` is now **v4** (adds per-tag `injectionBlockers`); v1-v3
  still read. The injector blocks from the container alone: v4 uses the per-tag flag, v1-v3 use
  the persisted walker warnings. ADD and SWAP both block; `applyInjection` throws if a blocked
  tag reaches it. Also fixed (separate commit 2ee3c9e, user-approved): SWAP ignored
  `uncapturedData`, e.g. bloodgulch's sky gbxmodel was planned as SWAPPED.
  Walker side effect, recorded on purpose: when an invalid reflexive is skipped, nothing below
  it is walked. With the scenario's `skies` reflexive corrupted, bloodgulch's closure drops 16
  tags (1575 -> 1559, including the sky, its gbxmodel, lens flare and shaders). Harmless for
  injection only because the scenario is refused anyway (BSP) and any tag with
  `invalidReflexive` is now blocked. Tests: `reflexive-bounds.test.ts` (cases a-e, save/reload,
  v3 fallback), `swap-structural-block.test.ts`. Both are **same-reader**. Status: verified by
  tests (same-reader) only, not confirmed in OpenCE.
- 2026-10-11 (same branch, user-approved follow-ups):
  - **noDefinition** (commit 41100b1): the definition lookup ran before the per-tag try, so one
    tag of an unknown class failed the WHOLE extraction with a raw `DefinitionLoadError`
    (verified in memory). It now gets an `extractionFailed` blocker (empty data, empty
    `structName`, no dependencies), and the rest of the selection still extracts.
    `verifyExtractedTagSet` reports such tags instead of walking them. Test:
    `reflexive-bounds.test.ts` case (f).
  - **uncertainGroup** (commit ade2ca9): applies to `UNCERTAIN_GROUPS` = `spheroid` only (checked
    before changing anything). It was extracted and never checked by the injector, so ADD/SWAP
    let it through. `structuralBlockReason` now blocks it in both modes, via the persisted
    walker warning, so every container version is covered. The dialog's shared
    "Undefined/uncertain groups" group is now **blocking**, titled "Undefined/uncertain groups
    (blocked for injection)". Tests: `swap-structural-block.test.ts` ADD + SWAP. They are
    SYNTHETIC (a real tag relabelled as spheroid in an in-memory tag index, because no sample
    map has a spheroid) and same-reader.
  - **On-disk container test** (commit 2a2dbac): write the `.ocetags`, read back the exact
    bytes (asserted identical), load them with no edits, and ADD and SWAP both block.
  - `structuralBlockReason` (tag-injector.ts) now covers: uncapturedData, invalidReflexive,
    extractionFailed, uncertainGroup. embeddedRawData has its own check in both modes. BSP
    refuses the whole plan. Missing external/unresolved/notExtracted dependencies block in
    both modes. externalData stays informational (fingerprint status only).
- 2026-10-11: **FIXED - see the "Dependency-order fix" entry directly below, which also corrects
  this entry's counts and its "289 threw" figure. Dependency-order mismatch between extractor and
  injector.** `tag-extractor.ts` records each tag's `dependencies` in two-phase order: all of a
  struct's own fields first, then each reflexive's children. `tag-injector.ts`'s
  `rewriteAddedTagData` consumes them with a single cursor in depth-first field order. Whenever a
  struct has a TagDependency field AFTER a non-empty TagReflexive field, the cursor hands a field
  another field's dependency, so ADD/SWAP write the wrong tagId (or throw). Found by comparing
  the extractor's `fieldPath` order with a schema DFS over every extracted tag (whole-map
  extraction, same-reader: both code paths are ours):
  | map | tags | order mismatches | tags that would get a WRONG reference |
  |---|---|---|---|
  | bloodgulch | 1569 | 191 | 159 (ui_widget_definition 116, projectile 18, weapon 15, vehicle 6, biped 2, scenario 1, globals 1) |
  | ui | 1411 | 340 | 277 (ui_widget_definition 274, projectile 2, scenario 1) |
  | sidewinder | 1542 | 191 | 159 (same breakdown as bloodgulch) |
  | coldsnap | 1957 | 213 | 179 (ui_widget_definition 117, projectile 24, weapon 19, vehicle 13, device_machine 2, biped 1, device_control 1, scenario 1, globals 1) |
  End to end, in memory (nothing written): of the 524 ui_widget_definition tags from ui.map that
  ADD into bloodgulch would add, apply **threw** "Internal error ... planInjection should have
  blocked it" for 289, all references were correct for 235, and **0** were seen silently
  wrong. Silent wrong references are still possible in principle whenever two misordered
  dependencies are both resolvable. Gbxmodel closures are blocked today, which hides most
  weapon/vehicle cases. Fix and plan: branch `fix/dependency-order`, research first, pending
  user approval. Not started.
- 2026-10-11: **Dependency-order fix (user-approved with conditions; branch
  `fix/dependency-order`, commits f4e2118 fix, ed29721 tests).**
  - Research corrections to the entry above. (a) A SECOND mechanism: the extractor skips
    `nonCached` fields but the old reader counted them. `meter`'s two nonCached dependencies
    ("stencil bitmaps", "source bitmap") are non-null in `ui\hud\cyborg shield`/`cyborg body`, in
    all 4 maps, so the cursor ran off the end (TypeError). (b) Corrected counts of tags whose
    entry at some position names a DIFFERENT target (simulated reader order, same-reader):
    bloodgulch 161, ui 279, sidewinder 161, coldsnap 181 (the earlier 159/277/159/179 plus the 2
    meters each). (c) **Silent corruption confirmed:** in-memory SWAP of bloodgulch, sidewinder
    and coldsnap into themselves wrote `globals\globals` with **11 wrong references and no
    error** (e.g. `multiplayer information[0].vehicles[0].vehicle` -> a shader), found by an
    independent source-vs-output comparison. ui.map: 0. (d) **"289 threw" was mislabelled.**
    Reconciled against the unfixed code: of the 524 widgets ADD ui -> bloodgulch plans, 141
    threw directly, 148 more were then blocked by the cascade behind them (289 not written),
    and 235 were written correctly. Applied one tag at a time (no cascade), 168 throw.
  - **Every map written by ADD/SWAP before this fix is untrusted** - re-create it. Saved
    `.ocetags` containers are NOT affected: every entry matched its own fieldPath's source
    target on all 4 maps (51,829 entries, 0 wrong, 0 duplicate paths; independent check).
  - Fix: `rewriteAddedTagData` looks each TagDependency field's entry up by `fieldPath` (no
    cursor). The path is built by the extractor's own `childFieldPath`/`reflexiveElementPath`.
    `nonCached` fields are skipped exactly like the extractor skips them, bytes left as in the
    source (user decision: do not null them unless shown the game never reads them).
    `planInjection` (`checkDependencyMap`) blocks a tag, with a reason, on a non-null field
    with no entry, an unknown/renamed fieldPath, duplicate entries, a null mismatch, or data
    that no longer fits the schema. Apply never throws for these. Entries for nonCached fields
    (older containers) are ignored, including in the dependency cascade.
  - Container format: **no version bump**. The extractor's output is unchanged (its path strings are now
    built by the shared helpers, same format), and
    `fieldPath` has been stored in the same format since v1, so v1-v4 containers inject correctly.
  - Verified by tests: `dependency-order.real-map.test.ts` (SWAP each of the 4 maps into itself
    + ADD ui -> bloodgulch: no throw, 0 wrong targets, independent of extractor/injector code
    but sharing the schema engine and tag-index parser). Every planned tag is now written:
    SWAP 1498/1405/1477/1735, ADD 704 incl. all 524 widgets. `dependency-fieldpath.test.ts`
    (synthetic tags with expected targets fixed by construction, real bloodgulch target, output
    read back with codec primitives; shares the schema engine for field offsets). All 15 new
    tests fail on the old injector. Not yet confirmed in OpenCE.
- 2026-08 (this session): Fixed Issue 1 (P0, silently dropped data fields). Root cause: the
  `uncapturedData` guard logic and the plain-`TagDataOffset` pointer-capture branch in
  `tag-extractor.ts`'s `flattenStruct` were already present in this session's uncommitted work
  (font/string_list/unicode_string_list/meter/hud_message_text/input_device_defaults/
  model_animations/scenario script+comment data - all captured the same way as TagReflexive:
  append pointed-to bytes, rewrite the pointer to a local offset; unresolvable pointers leave the
  tag's data untouched and `dependency-walker.ts` emits a blocking `uncapturedData` warning, same
  mechanism used for the `gbxmodel`-geometry block). What was missing: (a) a real-byte proof (not
  just bounds-checking) and (b) a second, genuinely new bug found while building that proof -
  `flattenStruct`'s plain-`TagDataOffset` branch did NOT skip `nonCached` fields the way
  `dependency-walker.ts`'s `collectFromStruct` and `embedded-data-fields.ts`'s
  `findEmbeddedDataFields` already did. Confirmed via real bytes: bitmap's `compressed color
  plate data` field (nonCached, "confirmed garbage" per this file's own earlier note) has a
  **non-zero stored size in 222/222 ui.map bitmaps and 132/132 coldsnap.map bitmaps** - its
  garbage pointer happened to resolve out-of-bounds in every sample checked (so no map in this
  repo was actually corrupted), but a future map where that garbage pointer coincidentally landed
  in-bounds would have had random bytes captured as "data" and the field's pointer rewritten to
  point at them - never read by the game (nonCached), but wasted space and a real latent gap.
  Fixed: `flattenStruct` now skips `field.def.nonCached` fields exactly like the walker does.
  Also found: `dependency-walker.test.ts`'s warning-kind allowlist (a typo-guard sanity check, not
  a behavioral assertion) didn't list `uncapturedData` yet - a real, deliberate new kind added
  this session (2 legitimate emitters: unresolvable plain-pointer fields, `gbxmodel` geometry
  reflexives) - extended the allowlist, did not change any production logic to satisfy the test.
- 2026-08 (this session): Real-byte proof for Issue 1 added (`tagdata-capture.test.ts`):
  `ui\ticker` (font)'s 31,066-byte `pixels` field captured byte-identical to the source map,
  survives v3 container round-trip; a negative test corrupts that same pointer to resolve
  out-of-bounds and confirms `walkDependencies` flags it + `planAddInjection` blocks the tag with
  a "cannot be captured or relocated" reason (into a target that doesn't already have the tag, so
  the block path is actually exercised, not matched/reused). A same-reader property sweep
  (independent expected-length calculator, not calling `tag-extractor.ts`'s own code) ran over
  **every non-external tag in all 4 available sample maps** (bloodgulch 1569, ui 1411, sidewinder
  1542, coldsnap 1957 - 6,479 tags total): **0 length mismatches (0 silently dropped) in all
  four**. `uncapturedData` warnings found: bloodgulch 169 (70 unique tags), ui 14 (5), sidewinder
  160 (64), coldsnap 186 (78) - **100% of these are the known, already-blocked `gbxmodel`
  geometry case; 0 were a plain-pointer field failing to resolve** in any real sample map. Core:
  **101/101 Vitest pass** (95 + 6 new). Desktop: 33/33 unchanged (no desktop files touched).
  Labelled "same-reader" per this session's new rule: this proves internal consistency with our
  own reader's assumptions, not that the real Halo CE/OpenCE engine accepts the result - that
  still needs the user's own Windows/OpenCE test (see "Windows check" above).
- 2026-08: SparkEdit is **out of scope** - continue the current tool. Investigated and rejected
  (wrong stack, unverified structs, no tests, no injector logic to borrow, unclear license);
  reference its 3D/BSP rendering techniques only when Phase 2 is built, never its code.
- 2026-08: Relocation must be map-agnostic - no logic keyed to a specific map name, tag path, or
  file size (format-level struct-layout constants are fine, see RULES.md). Verified by audit:
  `tag-injector.ts`/`dependency-walker.ts`/`resource-map.ts` contain zero map-name/path-literal
  branches outside comments/tests.
- 2026-08: Standing rules captured in `/app/memory/RULES.md` (work on copies, temp+rename writes,
  SAMPLE_MAPS_DIR helper, Node 22/Yarn 1 only, verified-by-tests/mock-preview/unverified reporting,
  stop-and-ask on ambiguous offset/size/flag, stay inside the named milestone, embedded-data
  relocation stays disabled until verified against real bytes, external data needs a fingerprint
  check not just bounds, BSP-flagged containers refuse/warn, dependency reuse not duplication,
  pre-write validation, path normalization, ≤25-line handoff notes).
- 2026-08: Settings UI approved with: per-pick + per-use validation (file type for the slot,
  readable header/entry count), 3 status states (not-configured / missing-or-unreadable /
  mismatched-with-this-map — the 3rd shown contextually in InjectDialog, not Settings), main
  process owns pickers + settings.json (renderer only ever gets a status back), resource maps
  opened read-only and read by offset (never loaded whole into memory), corrupt settings.json
  falls back to defaults. "Pick Halo CE maps folder" auto-detect button raised as optional,
  **not yet built, no user decision recorded either way** — ask again if revisited.
- 2026-08: `.ocetags` container v2 approved with: resource-map identity block per type (filename,
  size, entry count, header+entry-table fingerprint — not whole-file hash), per-ref coverage
  (whole-tag / sound-samples / bitmap-mipmap) + verified/unverified status, `tagIndex` local to
  the container (not the source map), `externalData: "referenced"` reserved for a future
  'embedded' value without a format break, version>2 refused with a plain message, v1 fixture
  kept and tested, reader still rejects any `scenario_structure_bsp` tag.
- 2026-08: Embedded (external=0) bitmap/sound relocation approved as **disabled** until verified
  against real bytes in ui.map. Neither sample map contains one (scanned: 222 internal ui.map
  bitmaps + 125 sound permutations, 100% external=1; bloodgulch.map has zero internal
  bitmap/sound tags). Main agent additionally decided NOT to write a synthetic
  relocation-algorithm fixture (would mean building, and risking false confidence in, the real
  feature under a "synthetic" label) — flagged to user, **no explicit ruling recorded yet**.
- 2026-08: User supplied `coldsnap.map` (396 real embedded assets). Agent proved via real bytes
  that relocation is possible (region layout, "exactly 4 fields" claim) and the user approved
  **building** it ("Yes, build it"), with conditions — see "Relocation research" below for the
  full report, what's built, and what's still unapproved. Container bumped to **v3**: per-tag
  `embeddedRawDataAssets`/`embeddedRawDataPatches` (captured bytes + patch offsets), deduped
  per-tag by (fileOffset, size). Bitmap captures are validated against width/height/format/
  mipmaps (formula verified 100% exact against all 800 real BitmapData instances across
  coldsnap.map + ui.map) — a mismatch blocks the WHOLE tag, never a partial relocation. Sound
  captures are bounds-checked only (no reliable deterministic size formula for compressed audio
  without decoding it) — stated explicitly, not silently assumed safe. The actual relocation
  write path (`applyInjection`'s embedded-insertion branch) is **implemented and tested against
  real bytes** but stays behind `InjectionOptions.allowEmbeddedRelocation` (default `false`,
  `map-worker.ts` never sets it) — **the user has not yet approved enabling it in the real app**;
  it is only ever exercised by `embedded-relocation.test.ts`. `planInjection`'s default
  (production) behavior — blocking any tag with embedded data — is completely unchanged.
- 2026-08: Two NEW, pre-existing bugs found while researching the above:
  1. **FIXED this session** (see "Decisions" entries above dated this session for the full
     root-cause + real-byte proof) - `tag-extractor.ts` now flattens the pointer-based data for
     every plain `TagDataOffset` field (font/string_list/unicode_string_list/meter/
     hud_message_text/input_device_defaults/model_animations/scenario), same mechanism as
     TagReflexive; unresolvable ones block the whole tag via `uncapturedData` rather than
     dropping silently. Same-reader-verified against real bytes in all 4 sample maps, 0
     mismatches. Still "needs re-verification" (not "verified") until the user confirms on
     Windows/OpenCE - see "Status table" above.
  2. **NOT fixed, blocked at the warning level** (Issue 2, plan not yet written): `gbxmodel`
     model geometry (vertex/index data, stored in the separate "model data" region) is never
     captured by the container format at all. Since this session, any tag whose dependency
     closure includes a `gbxmodel` is unconditionally **blocked** from ADD/SWAP via a new
     `uncapturedData` warning (`dependency-walker.ts`, `childStructName === 'GBXModelGeometryPart'`)
     - this prevents producing a corrupt map, but means vehicles/weapons/bipeds can't be
     injected at all today. Capture/relocation plan is the next step, pending user approval
     before any geometry code is written.
- 2026-08: `crc32` (main header) and the sub-header's `tagFileChecksums` go stale after ANY
  injection (tag-array growth OR embedded insertion) — tracked P0, not fixed this session (M6
  work). The Inject result dialog and worker already surface this (`staleChecksumWarning`,
  updated wording 2026-08: "Checksums were not updated. This map may be rejected by some loaders
  until M6 (export + CRC) is done."). **Superseded 2026-10-11 (Swap load failure entry):** crc32
  is now recomputed on every save; only the tag-file checksum caveat remains in the warning.
- 2026-08: M5 build order approved: Step A (ADD mode only) → stop for review → Step B (SWAP,
  keeps target's tag ID) → stop → Step C (conflict dialog: skip/replace/rename + "apply to all",
  using the existing `ConfirmDialog.tsx`). Never overwrite source map (temp+rename to a new file
  via Save As), validate before writing (tag/size limits, missing deps, unresolved refs), reuse
  existing target dependencies instead of duplicating, normalize paths (backslashes,
  case-insensitive) for conflict detection while preserving original casing on write, flag
  header/CRC32 fix-ups rather than pulling M6 work into M5.
- 2026-10: Halo Demo / HaloMD -> Custom Edition converter added as a side feature. Phase 1
  (retail-layout maps, cache version 7, base 0x40440000: header patch + CRC) comes first; Phase 2
  (true demo layout, version 6, base 0x4BF10000: schema-driven pointer rebase) only starts after
  Phase 1 is confirmed in OpenCE. Research notes: `memory/demo-converter.md`. The converter is a
  separate module and the CE-only parser/validators stay unchanged. Demo sample maps lived in
  `sample_maps/demo/` (moved 2026-10-11 to `HaloMD/` and `MacDemo/`, see the sample-folder entry). Never
  convert in place; refuse maps that are already 609. Open item: the tag-data-header field order
  (checksum vs scenario ID at +0x4/+0x8) differs between the Halo Map Structure PDF and the
  research notes, so confirm it from real bytes before relying on it. M5/M6 work is paused,
  not cancelled. **Update 2026-10-11:** field order settled (+0x4 scenario tag ID, +0x8 tag-file
  checksum); ordering superseded by "Roadmap order" at the top of Decisions.

## Status as of 2026-08 (this session)

### Done
- M1 (header/index parse), M2 (decompress/recompress via `@mongodb-js/zstd`), M3 (Electron shell,
  Sapien/SparkEdit-style React UI) — from earlier sessions.
- **Tag Definition Layer** (`/core/src/map/definitions/`) — built this session, full details in
  `definitions/SOURCES.md`:
  - Data-driven schema: JSON files in `groups/*.json` (one per tag group, 86 files), generated by
    `scripts/generate-definitions.mjs` from a local clone of Invader (+ Reclaimer for 2 gaps).
    Statically imported via `definitions-index.ts` so the bundler inlines them (works in dev, the
    esbuild Electron bundle, and the packaged app — verified via `node esbuild.electron.mjs`).
  - Generic engine (`engine.ts`): resolves struct field byte offsets by walking field lists
    (inherits chains, pad, enum/bitfield/TagDependency/TagReflexive/TagDataOffset sizing),
    validates computed size against each struct's declared ground-truth size, throws
    `DefinitionLoadError` on any malformed definition. No per-tag hardcoded parsing.
  - Binary codec (`codec.ts`) + full decode/encode (`decodeStruct`/`encodeStruct` in `engine.ts`)
    for every basic field type.
  - Validation bridge (`validate-tag.ts`): recursive round-trip byte-identity check, TagDependency
    resolution against the real tag index (with abstract-class expansions: model→gbxmodel,
    item→weapon/equipment/garbage, unit→biped/vehicle, shader→9 shader_* subtypes, object, `*`
    wildcard), TagReflexive bounds checking, and the `scenario_structure_bsp` cache-header
    indirection fix (see SOURCES.md "Key finding").
  - Resource map parser (`resource-map.ts`) for `bitmaps.map`/`sounds.map`/`loc.map`, used to
    validate whole-tag-external references.
  - **Result**: all 83 known Halo CE tag groups defined and validated. `yarn vitest run` in
    `/core`: 34/34 tests pass, **zero failures across every group** (not just the originally
    scoped 19 Tier-1 groups) against both `bloodgulch.map` and `ui.map`.
  - Full provenance table, abstract-class notes, and known simplifications documented in
    `core/src/map/definitions/SOURCES.md` — read that before touching M4/M7.

### Stopped here deliberately (superseded — see M4 section below)
Earlier in this session M4 core logic was built and validated via Vitest only; this was followed
by a full M4 **frontend/UI integration** pass (see below), which is now done and tested.

## M4: Dependency walker + tag extraction + UI (done 2026-08)
- **Core** (`/core/src/map/dependency-walker.ts`, `tag-extractor.ts`, `container.ts`):
  - `walkDependencies()`: generic BFS over TagDependency/TagReflexive fields (reuses the
    definitions engine, no per-group hardcoding), tracks `requiredBy` (reverse edges, for the
    dialog's "required by" column), classifies each tag as `ok`/`bsp`/`external`/`uncertain`/
    `noDefinition`, takes optional `{ onProgress, signal }` (`WalkOptions`) so callers get
    progress + cancellation without `/core` importing anything Electron/Node-specific.
  - `extractable`/`notExtractableReason` added to `DefinitionStruct`/`ResolvedStruct` (generic
    flag, checked by the extractor — no hardcoded group names). Set to `false` on
    `scenario_structure_bsp` (separate memory region, see SOURCES.md). The walker still visits a
    non-extractable BSP's **own direct dependencies** as informational-only warnings ("needed by
    BSP, not extracted") without walking/extracting them further.
  - `extractTagSet()`: flattens the walked closure into self-contained, relocatable buffers
    (two-phase per-struct flatten: siblings first, then recurse, to preserve reflexive array
    stride — same technique as before). Tags with `extractable: false` are excluded and reported
    in `notExtracted`, never silently included. Throws `AllTagsExcludedError` if that leaves
    nothing to extract (BSP-only selection) — no file written.
  - `container.ts`: new `.ocetags` file format (JSON, versioned: magic, `formatVersion`,
    `sourceMapName`, `createdAt`, `hasUnresolvedBspReferences`, tags + base64 data + deps,
    `notExtracted`, `warnings`). `deserializeContainer()` rejects wrong magic/version and any
    container containing an `scenario_structure_bsp` tag (defense in depth for M5's reader).
  - Tests: `core/tests/tag-extractor.test.ts` — scenario extraction excludes BSP + flags
    container, BSP-only selection throws, mixed selection extracts rest + reports BSP, clean
    round-trip through serialize/deserialize, reject-sbsp-container. **45/45 core Vitest pass.**
- **Electron backend** (`/app/desktop/electron/`):
  - `worker-manager.ts` (new, replaces `worker-task.ts`): exactly **one** persistent
    `map-worker.js` Worker thread per app session, started eagerly in `main.ts`'s
    `app.whenReady()`. Typed request/response protocol in `shared-types.ts`
    (`WorkerRequest`/`WorkerResponse`), every request has a `requestId`.
  - `map-worker.ts` (rewritten, stateful): parses the open map **once** on `inspect` and keeps
    `{buffer, header, tagIndex}` in worker memory — `getDependencies`/`extractTags` reuse it, no
    re-send/re-clone of the map buffer per call. All `fs` I/O lives here; `/core` stays pure.
    `extractTags` writes to a temp file then renames into place (cancel/crash/failure leaves no
    partial file). Cancellation via a polled `AbortController` per requestId. Logs "Worker loaded,
    definitions loaded (N tag groups, N structs)" on startup (self-check).
  - `main.ts`: `deps:get` (read-only) and `tags:extract` IPC handlers. `tags:extract` shows the
    native Save As dialog itself (renderer never supplies a path), refuses the source map path and
    paths inside the app install dir, confirms before overwriting an existing file, remembers last
    used directory (`settings.ts`, `userData/settings.json`). All inputs validated; every result is
    `{ ok, code, message }` shaped.
  - `preload.ts`: named methods only (`getDependencies`, `extractTags`, `cancelExtraction`,
    `openContainingFolder`, `getSettings`), no `ipcRenderer` exposed; `contextIsolation: true`,
    `nodeIntegration: false` (unchanged from M3).
- **Frontend** (`/app/desktop/src/`):
  - `components/DependencyDialog.tsx` (new): phases loading → list → extracting → result/error.
    Summary line, grouped collapsible warnings (`WarningGroup.tsx`: "Not extracted" [blocking],
    "External data", "Undefined/uncertain groups", "Unresolved references"), searchable
    virtualized tag list (`VirtualTagList.tsx`, manual windowing, no new dep — verified smooth at
    2,200+ rows). Confirm button disabled with a stated reason when nothing is extractable
    (BSP-only, no checkbox) or gated by an "I understand" checkbox when there are warnings.
    Progress + Cancel during extraction; result view with "Open containing folder"; Escape to
    close/cancel; focus trap; "Copy warnings" button.
  - `components/TagBrowser.tsx` (rewritten): controlled `selected: Set<number>` prop, group-header
    checkbox selects every tag in that group, right-click context menu ("Extract (with
    dependencies)...", selects the row first if unselected), toolbar Extract button shows count.
  - `App.tsx`: owns `selectedTagIndices`/`extractSelection` state; one shared `requestExtract()`
    handler used by the toolbar button, the TagBrowser context menu, the Tools menu
    ("Extract Tags...", forwarded from Electron's menu via `menu:action`), and a global Ctrl+E
    listener. Large selections (>200 tags) get a confirm before walking. Dialog auto-closes when
    the open map changes.
  - `dev-mock.ts` + `test-fixtures/dependency-fixtures.ts` (new): 9 scenarios via `?mock=<name>`
    (clean, scenario-bsp, external-data, spheroid, bsp-only, large-list, deps-error, extract-error,
    slow-progress), shared between the dev preview and the RTL component tests. Only activates via
    dynamic `import()` gated on `import.meta.env.DEV` + absent `window.opence` — confirmed absent
    from production `dist`/`dist-electron` bundles (grepped for `installDevMock`,
    `buildMockSummary`, `parseMockScenario`, `MOCK_SCENARIOS` — none found; only a harmless, always
    unreachable "MOCK DATA" string literal remains in `App.tsx`, gated by a runtime flag that's
    never true outside the mock).
  - Desktop renderer test infra added: `vitest` + `jsdom` + `@testing-library/react` (pinned to
    versions compatible with Node 20 — see `package.json`/`engines`). 14 RTL tests across
    `DependencyDialog.test.tsx` and `TagBrowser.test.tsx`, all passing.
- **Packaging**: `engines.node` set to `>=20 <23` in both `core` and `desktop` `package.json`
  (Node 22 LTS recommended, Node 26 known to break Electron's binary download per user report).
  `asarUnpack` added for `@mongodb-js/zstd` native module in `electron-builder` config.
- **Testing status**: core Vitest 45/45 ✅. Electron + renderer `tsc --noEmit` clean ✅. Desktop
  Vitest (RTL) 14/14 ✅. `testing_agent` E2E pass over all 9 mock scenarios in the browser preview:
  100%, 0 console errors, 0 code changes requested (see `/app/test_reports/iteration_5.json`).
  **NOT YET verified**: real Electron shell with a real map (main process/native dialogs/worker
  can't run in this headless container) — user said they'll test `extract a vehicle and weapon
  from bloodgulch.map` themselves on Windows once this is handed off.

## Known simplifications / backlog (see SOURCES.md for full detail)
- Composite geometry types (Point3D, Matrix, etc.) decode as plain number arrays, not named
  sub-fields — deferred to M7.
- `TagDataOffset` external-resource metadata (`external_file_offset`/`file_offset`, e.g. sound's
  external `.map` samples) not carried into the schema yet — only whole-tag `isExternal`
  references were validated this round.
- Per-mipmap `BitmapDataFlags.external` bit not checked (no occurrence found in sample maps).
- `spheroid` tag group is genuinely **uncertain** — no reliable source exists for it anywhere
  (even Reclaimer's own author calls it a guess), and it doesn't appear in either sample map.
- **OPEN ITEM (P0, blocks embedded-data relocation)**: embedded (external=0) bitmap/sound raw-data
  relocation is unimplemented and the ADD/SWAP injector actively blocks any tag with one (plain-
  language warning). 2026-08: **verified feasible** on a real custom map (coldsnap.map, 396
  embedded assets) - see "Relocation verification attempt #3" below for the design and exact
  citations. NOT implemented - proposed to the user, waiting for explicit approval before writing
  any code. Still true: do NOT implement/enable against a synthetic-only fixture.

## Upcoming (SUPERSEDED 2026-10-11 by "Roadmap order" in Decisions - kept for history)
- Sounds.map resolution (parse external sound pointers before M5) — explicitly deferred by user.
- M5: tag injection/swap (ADD/SWAP modes), reading the `.ocetags` container from M4.
- M6: export map + recalc CRC32.
- M7: field-level tag editor reusing this definition layer (promote any group's field naming from
  "array of numbers" to named sub-fields as needed).
- Phase 2: 3D scenario editor (three.js viewport, BSP/model rendering, Forge-like placement).

## Tools > Verify Embedded Data (done 2026-08)
Map-agnostic, read-only GUI diagnostic (new Decisions-section rule: no logic keyed to a specific
map name/tag path/size - verified by code review, zero such branches). Core:
`core/src/map/embedded-data-verifier.ts` - `verifyEmbeddedData(buffer, header, tagIndex)` reuses
`walkDependencies`'s existing per-field embedded/external detection (same decode path the M5
injector's relocation guard uses - no reimplementation), adds bounds/overlap/readability checks
for embedded assets only (external offsets point into a different file, never bounds-checked
against the open map), and reports unrecognized tag classes or out-of-bounds top-level structs as
BLOCKED rather than guessed. Also fixed a real gap found while building this: `collectFromStruct`
in `dependency-walker.ts` used to silently skip a reflexive array whose pointer/count resolves
outside the file - now emits a new `'invalidReflexive'` warning kind instead (generic, benefits
every consumer, zero behavior change for valid maps - confirmed by the unchanged 62/62 then 73/73
regression count). `formatEmbeddedDataReport()` renders the plain-language text used by the
dialog's "Copy report" button. Electron: new `tags:verifyEmbeddedData` IPC
(`main.ts`/`map-worker.ts`/`preload.ts`/`shared-types.ts`), Tools menu item (native + in-app
`MenuBar`) opens `VerifyEmbeddedDataDialog.tsx` (loading -> report-with-copy-button -> error
phases, no "apply" step - this feature never writes anything). Dev-mock fixtures:
`?mock=verify-clean` / `?mock=verify-blocked`.
**Testing**: core 73/73 Vitest (11 new in `embedded-data-verifier.test.ts` - 3 real-map regression
against ui.map/bloodgulch.map/sidewinder.map confirming 0 false positives, defensive-path unit
tests for unrecognized-class/out-of-bounds-struct blocking built without faking a binary map
layout, pure `rangesOverlap`/`formatEmbeddedDataReport` tests). Desktop: 33/33 Vitest (5 new RTL
tests for the dialog), both electron+renderer `tsc --noEmit` clean, esbuild bundle clean.
Per the user's new standing rule, **no testing_agent/screenshot used** - targeted Vitest only.

## Relocation verification attempt #3 (Task 3): coldsnap.map - VERIFIES, pending approval (2026-08)
User uploaded `sample_maps/coldsnap.map` (real CE 609 custom map, 2791 tags, 79.9MB) - first real
embedded-data sample. `verifyEmbeddedData` found **396 embedded assets (350 bitmap + 46 sound),
0 blocked, 0 out-of-bounds, 0 overlapping, 0 unreadable** - a genuinely clean, heavily-modded map.
Real example: `levels\one\devices\bitmaps\panel_scuff` (bitmap), embedded, offset=26,396,672,
size=43,704 bytes, first bytes `1084cb5a55552323718ccb5a5555c842`.
**Finding**: relocation does NOT need the region's start - confirmed by exact arithmetic on real
bytes (see SOURCES.md "UPDATE 2026-08" for the full citation): `max(embedded offset+size) ==
tagIndex.modelDataFileOffset` (54552850, exact), `modelDataFileOffset + modelDataSize ==
tagDataOffset` (70610858, exact), `tagDataOffset + tagDataSize == decompressedFileSize`
(79925558, exact) - zero slack, whole file accounted for. Embedded offsets are confirmed plain
absolute file offsets (not memory-address-translated: `baseMemoryAddress` ~1.08B vs offsets
~26-54M, different domains).
**Proposed design** (NOT implemented - awaiting approval): insert new embedded bytes immediately
before `modelDataFileOffset`, shift model+tag data forward by the inserted size, increment
exactly 3 stored fields by that delta (`modelDataFileOffset`, `tagDataOffset`,
`decompressedFileSize`) - every existing struct pointer auto-shifts via the same
`tagDataOffset`-relative anchor already used for M5's tag-array growth, zero per-pointer
rewriting needed. Preserves the observed invariant exactly (safer than appending at true EOF,
which breaks it and is unverified).
**Residual risk**: structural/arithmetic analysis of ONE real map, not yet validated by an actual
in-game round-trip. Recommend implementing behind clear logging and having the user verify
in-game before trusting it for real mods.
Yoyorast_Island.map (`sample_maps/`) is staged but unused - optional secondary cross-check later.


## Relocation verification attempt #2: sidewinder.map (2026-08, read-only)
User uploaded `sample_maps/sidewinder.map` (real CE 609, 2420 tags, 14.8MB) as a candidate real
embedded-bitmap example. Ran the SAME generic scanner used on ui.map/bloodgulch.map (no map-name
or path-specific code - see Decisions above) plus a full scenario-closure dependency walk (1079
tags walked, 555 external, 2 bspTag, **0 embeddedRawData/uncertainGroup/noDefinition/notExtracted
warnings**). **Result: 0 embedded bitmap/sound data, same as ui.map and bloodgulch.map.**
sidewinder is an unmodified stock CE multiplayer map - like bloodgulch, every bitmap/sound it uses
routes through bitmaps.map/sounds.map. It does not demonstrate embedded data either; still need a
genuinely custom/modded map (the user's own fighterbomber/banshee/mp_tree_pine_snow maps,
mentioned in an earlier session, were never supplied). Relocation stays **disabled**, not
enabled - per explicit instruction, a verification failure/non-finding must not flip it on.
Additional structural finding re-surfaced from existing SOURCES.md research (not new, but
material to "must work for ANY map"): the embedded raw-data region's START OFFSET is not stored
anywhere in a compiled map (confirmed against `invader/src/build/build_workload.cpp` - it's an
implicit gap computed only at build time) - reconstructing it from a compiled file alone for an
arbitrary map is a second, independent blocker beyond "no sample found yet" and needs its own
research before relocation can be enabled even once a real embedded asset is available.


## Investigation: SparkEdit CE (v609) support feasibility (2026-08, read-only, no code changed)
See chat for full 7-point report. Verdict: **reference only, do not fork/extend SparkEdit.**
Reasons: C++/MFC/legacy-OpenGL stack (wrong language for this Electron+TS project), struct
knowledge is hand-reversed/unverified (vs our Invader-cited SOURCES.md), zero automated tests,
legacy VC6/VC7 toolchain, no cross-map tag-injection code to borrow at all (its "import" feature
only registers tags already embedded in the loaded map into the scenario palette - not a byte-
level injector like our M5), and unclear license (no LICENSE file in the HaloMods repo itself).
Its one genuine strength - a complete 3D BSP/model viewport + Forge-style scenario editor (frustum
culling, lightmap-as-second-texture-unit, per-model LOD distance cutoffs, OBJ export) - should be
mined as a **design reference only** when Phase 2 (three.js scenario editor) is built on our own
core, not reused as code.

## Small: "Copy warning report" button in InjectDialog (done 2026-08)
New pure function `buildInjectWarningReport(plan)` (`src/components/injectWarningReport.ts`)
formats refusedRoots/blockedEmbedded/blockedOther/externalRefStatuses as path+category+reason
text lines; wired to a button next to the review-phase summary line
(`inject-copy-warning-report-button`), copies via `navigator.clipboard` (same pattern as
`DependencyDialog`'s existing "Copy warnings" button). Targeted Vitest only, per user instruction
(3/3 pass, `src/components/__tests__/injectWarningReport.test.ts`) - no testing_agent/screenshot
used this session (new standing rule in RULES.md).


## M5 Step B: SWAP-mode tag injection (done 2026-08, this session)

Before any code, user required an exhaustive real-byte search of ui.map/bloodgulch.map for
embedded (external=0) bitmap/sound data (blocker carried over from the previous session). Built
a reusable scanner `core/scripts/scan-embedded-data.ts` (uses the same `walkDependencies`
`embeddedRawData` detection the injector itself relies on - no separate parsing logic, so results
match what the injector's relocation guard sees). **Result: 0 embedded fields found.** ui.map has
251 non-external bitmap/sound tags (575 external-resource-map data fields, 0 embedded); bloodgulch
has 0 non-external bitmap/sound tags at all. Reported to user per the decision tree they specified;
user confirmed: keep relocation disabled, proceed with Step B/C for tags that don't need it, track
as an open item (see "Known simplifications" below), and supply a small custom map with one real
embedded bitmap later for actual verification - filename/tag TBD from user when they have it ready.

- **Core** (`tag-injector.ts`): generalized `planAddInjection`/`applyAddInjection` into
  `planInjection(mode, ...)`/`applyInjection(...)` (mode-agnostic, `AddInjectionPlan` etc. kept as
  type aliases for compat) plus new `planSwapInjection`/`applySwapInjection` wrappers. SWAP mode:
  a matched tag (same normalized path+class already in target) gets its struct data REPLACED in
  place - new data appended past the (shifted) existing region like ADD's new entries, but the
  EXISTING array slot's tagId/path pointer/primary class are left untouched, only
  `tagDataPointerOrResourceIndex`/secondary/tertiary class are patched. Key finding reused from
  Step A: a matched tag's tagId never changes in SWAP mode (whether its own swap succeeds or falls
  back to untouched), so nothing that depends on a matched tag by internal reference can ever be
  blocked by that matched tag's own swap outcome - only true appends (`toAdd`) participate in the
  block-cascade. A matched tag that CAN'T be swapped (embedded-data warning, missing dependency,
  OR the target entry is itself whole-tag-external with no struct pointer to repoint) falls back
  to untouched/reused, reported in BOTH `reused` and the relevant blocked list (intentionally not
  mutually exclusive - "reused" means nothing changed, the blocked list says why a requested swap
  didn't happen). Tests: 3 new tests in `tag-injector.test.ts` using REAL bytes - "weapons\frag
  grenade\shaders\frag metal" (shader_model) exists non-external in both ui.map and bloodgulch.map
  (genuine in-place-swappable match), its 3 bitmap dependencies exist in bloodgulch as whole-tag-
  EXTERNAL entries (genuine "can't swap into this" case), full apply + re-parse + 1500+-tag
  validation. **Core: 62/62 Vitest pass.**
- **Electron**: `shared-types.ts` threads `InjectionMode` through `WorkerRequest.planInject` and
  `OpenceApi.planInject(path, mode)`; `InjectPlanSummary` gained `mode`/`toSwap`, counts gained
  `swapped`; `ApplyInjectResult` gained `swappedCount`. `map-worker.ts`/`main.ts`/`preload.ts`
  updated to pass mode through unchanged otherwise (same temp-file-then-rename write, same
  Save-As/overwrite-refusal guards from Step A).
- **Frontend**: `InjectDialog.tsx` gained a new first phase, `choose-mode` (two buttons: "Add new
  tags" / "Swap into existing tags", `inject-mode-add`/`inject-mode-swap`/`inject-mode-cancel`),
  before the existing picking->planning->review->apply->result flow (mode is for the whole
  operation - per-tag choice is Step C, not built yet). Review phase summary line and a new "Will
  be swapped (keeps existing tagId)" `WarningGroup` section added; `nothingToAdd`/confirm-gating
  logic extended to include `counts.swapped`. `dev-mock.ts`/`test-fixtures/dependency-fixtures.ts`
  extended with SWAP-mode mock plans (clean + blocked) built from the same real tag paths used in
  the core tests, so the mock preview matches reality.
- **Testing**: core 62/62 ✅ (incl. 3 new real-byte SWAP tests), desktop electron/renderer `tsc
  --noEmit` clean ✅, desktop Vitest 25/25 ✅ (unchanged, no existing InjectDialog RTL suite to
  break), `testing_agent` E2E on the new choose-mode screen + SWAP-mode InjectDialog via browser
  mock: 100% (9/9 requirements), 0 console errors, 0 bugs (`/app/test_reports/iteration_7.json`).
  **NOT YET verified**: real Electron shell / real map SWAP in OpenCE on Windows (headless
  container can't run it) - same caveat as Step A, user will test themselves.
- **Per explicit user instruction this session: STOPPING here for review before Step C** (the
  conflict dialog - skip/replace/rename + "apply to all", using the existing `ConfirmDialog.tsx`).

### 2026-08 session: embedded (external=0) bitmap/sound relocation - built, disabled by default
See "Relocation research" section above for the full report. Summary of what changed:
- New `core/src/map/embedded-data-fields.ts` — shared detector + bitmap pixel-size validator,
  also adopted by `dependency-walker.ts` (pure refactor, same warnings/behavior, same 73/73
  pre-refactor test results, coldsnap.map Verify Embedded Data still reports 396 embedded / 9
  external / 0 blocked before and after).
- `container.ts` bumped to **v3**: per-tag `embeddedRawDataAssets`/`embeddedRawDataPatches`. v1/v2
  containers still read fine (fields simply undefined, relocation stays blocked for them).
- `tag-extractor.ts`: captures embedded bytes at extraction time (always on, no flag - pure data
  gathering), deduped per-tag, bitmap-size-validated, bounds-checked.
- `tag-injector.ts`: `applyInjection` can relocate the captured bytes, but ONLY when the caller
  passes `{ allowEmbeddedRelocation: true }` — default `false`, `map-worker.ts` never sets it, so
  the shipped app's behavior is byte-for-byte unchanged from before this session.
- 2 new pre-existing bugs found (NOT fixed, logged above as tracked P0s): the font/string_list/
  model_animations/etc `TagDataOffset`-pointer extraction gap, and `gbxmodel` model-data not
  being carried by the container format at all.
- Tests: `embedded-data-fields.test.ts` (12 unit tests), `embedded-relocation.test.ts` (4 tests,
  real coldsnap.map/bloodgulch.map bytes, independent-of-the-injector's-own-math verification),
  plus extended `tag-extractor.test.ts` (+5) and `embedded-data-verifier.test.ts` (+1). Removed
  `relocation-synthetic.test.ts` (superseded - it only tested that the old disabled stub threw).
  **Core: 95/95 Vitest pass. Desktop: 33/33 Vitest pass.** Did NOT call `testing_agent` (backend-
  only, byte-level change, no UI touched this session - self-tested per RULES.md).
- **NOT done** (explicitly out of scope / awaiting approval): enabling `allowEmbeddedRelocation`
  in `InjectDialog.tsx`/`map-worker.ts`; fixing either of the 2 newly-found pre-existing bugs;
  Step C (conflict dialog, still blocked on explicit user go-ahead); CRC32/checksum recalculation
  (M6).

  Not built yet.

### What to test in OpenCE on Windows (Step B, in addition to Step A's steps)
1. Extract a tag that already exists in your target map at the same path (e.g. re-extract a stock
   weapon/vehicle tag you've modified, or a retextured version of one) into a `.ocetags` file.
2. Tools > Inject Tags... > choose "Swap into existing tags" > pick that container > review (should
   show "to swap" for the matching tag, "reused" for anything that can't be swapped e.g. whole-tag-
   external matches) > confirm > Save As a NEW file.
3. Load the NEW file in-game: the map's EXISTING placements of that tag (scenery, weapon spawns,
   etc. already in the scenario) should now show the swapped content WITHOUT needing to add any
   new placement - this is the whole point of SWAP vs ADD. Report back: does it load, and do
   existing placements pick up the new content correctly?

## M5 Step A: ADD-mode tag injection (done 2026-08)
User required a cited, verified design (not asserted) before any code — see
`core/src/map/definitions/SOURCES.md` "Milestone 5, Step A findings" for the full citations
(Invader map.cpp/build_workload.cpp/resource.cpp line numbers) and the empirical checks run
against real bytes in the sample maps.

- **Core** (`/core/src/map/tag-injector.ts`, new):
  - `planAddInjection(targetTagIndex, container, resourceMapConfig?)`: dry-run only, never
    mutates/allocates. Reuses existing target tags by normalized path+class instead of
    duplicating; blocks (with a fixed-point cascade to dependents) any tag with an
    `embeddedRawData` warning (relocation disabled) or a missing `external`/`unresolved`/
    `notExtracted` dependency; reports per-root refusal reasons; computes external-resource-map
    fingerprint status (`match`/`mismatch`/`unconfigured-on-target`/`unverified-at-extraction`).
  - `applyAddInjection(...)`: the structural write. Grows the tag array and decrements the single
    stored `tag_array_address` field by the growth delta — this re-anchors EVERY existing tag's
    reflexive/path/tag-data pointers automatically (cited + empirically verified, see SOURCES.md),
    zero per-pointer rewriting needed for pre-existing tags. New tags' own local (extraction-time)
    reflexive offsets are translated to real virtual addresses; `TagDependency.tagId` fields are
    remapped to the resolved target tagId (new tagId via the real tool.exe salt formula); `pathPointer`/
    `pathSize` are zeroed (stale tool-only fields, decided not left as source-map garbage).
    `crc32`/sub-header `tagFileChecksums` are deliberately left untouched and reported as stale
    (M6's job, never silently done here).
  - `relocateEmbeddedRawData()`: explicit disabled stub (throws). Embedded (`external=0`)
    bitmap/sound relocation needs the raw-data region's start, which isn't stored anywhere in a
    compiled map — under-determined from a compiled file alone, and neither sample map has a real
    embedded asset to verify an implementation against anyway. Never called by
    plan/applyAddInjection. A synthetic (non-real-byte) fixture was deliberately NOT built either —
    writing a fake relocation algorithm just to exercise a "disabled" stub would mean building (and
    risk giving false confidence in) the real feature under a "synthetic" label; flagged to user
    instead of decided silently.
  - Container bumped to **v2** (`container.ts`): `secondaryClassFourCC`/`tertiaryClassFourCC` per
    tag (280/2455 bloodgulch.map tags have a non-null secondary class — was silently dropped by
    M4, fixed this session), `resourceMapIdentities` (sha256 of header+entry table, NOT the whole
    file), `externalResourceRefs` (per-tag bitmaps.map/sounds.map references with
    verified/unverified status), `externalData: 'referenced'` (reserved for a future 'embedded').
    v1 containers still read fine (defaults for new fields); version > 2 rejected with a
    plain-language message; a real v1 fixture (`tests/fixtures/v1-warthog.ocetags`) is kept and
    tested.
  - `dependency-walker.ts`: now ALSO flags the embedded (`external=0`) case (previously only
    `external=1`/mechanism-B-referenced was flagged — the embedded case was a latent,
    unflagged gap from M4: extracting a tag with embedded pixel/sample data would have produced
    a container with a silently-dangling offset). Generalized via a new `externalDataSibling`
    JSON schema annotation on `BitmapData.flags` (data-driven, no hardcoded field names in TS).
  - Tests: `tag-injector.test.ts` (9 tests incl. full inject-into-copy-of-bloodgulch.map
    round-trip that re-parses with this project's own reader and validates every old+new tag,
    1500+ tags, zero errors), `container-v2.test.ts` (5 tests: v1 fixture read, version rejection,
    v2 round-trip, verified/unverified refs), `relocation-synthetic.test.ts` (1 test: confirms the
    stub is unconditionally disabled). **Core: 59/59 Vitest pass.**
- **Electron** (`/app/desktop/electron/`):
  - `settings.ts`: `AppSettings.resourceMaps: {bitmaps,sounds,loc}`, corrupt/missing
    `settings.json` falls back to defaults. Main process is the only thing that ever writes a
    resource-map path — renderer only ever receives a typed `ResourceMapStatus` back.
  - `main.ts`: `resourceMaps:pick`/`resourceMaps:getStatuses` (validates file type for the slot
    via `validateResourceMapFile`, rejects+doesn't save an invalid pick with a plain-language
    error), `tags:pickInjectContainer`/`tags:planInject`/`tags:applyInject` (Save As dialog,
    refuses the source map path, confirms before overwrite, never overwrites the map being
    injected into).
  - `map-worker.ts`: `planInject`/`applyInject` worker requests, reusing the already-open
    `currentMap` as the injection target; writes via temp-file-then-rename.
- **Frontend**: `InjectDialog.tsx` (new) — phases picking→planning→review→applying→result, with
  `WarningGroup` sections for refused roots/blocked-embedded/blocked-other/external-refs/
  will-be-added/reused, an "I understand" checkbox gating confirm when there's anything blocking,
  stale-CRC32 warning shown in the result. `SettingsDialog.tsx` (new) — 3 resource-map picker rows
  with not-configured/missing-or-unreadable/ok status (a 4th state, "configured but not matching
  THIS map", is contextual per-injection and shown in InjectDialog instead, not here).
- **Testing**: core 59/59 ✅, desktop electron/renderer `tsc --noEmit` clean ✅, desktop Vitest
  25/25 ✅, `testing_agent` E2E on InjectDialog/SettingsDialog via browser mock: 100%, 0 console
  errors, 0 bugs found (`/app/test_reports/iteration_6.json`). **NOT YET verified**: real Electron
  shell / real map injection in OpenCE (headless container can't run it) — user will test
  themselves on Windows; exact steps below.

### What to test in OpenCE on Windows (Step A)
1. Open a target map (e.g. a copy of `bloodgulch.map`) in OpenCE, decompress if needed.
2. Tools > Settings... — point at your own `bitmaps.map`/`sounds.map`/`loc.map` (optional for
   this test, but needed to see "match"/"mismatch" instead of "unconfigured-on-target").
3. Extract a tag with NO external data (e.g. a vehicle) into a `.ocetags` file from a DIFFERENT
   source map copy, or re-use one from your earlier M4 test.
4. Tools > Inject Tags... on the target map, pick that `.ocetags` file, review the plan (should
   show "to add"/"reused" with zero blocked), confirm, Save As a NEW file (never overwrites your
   original).
5. Load the NEW file in OpenCE/the actual game. **This is the real test** — our own re-parser
   validates pointers internally, but only the real engine can confirm it actually loads &
   displays correctly. Report back: does it load? Does the injected tag/its dependencies show up
   correctly in-game?
6. Optional: repeat with a tag that DOES have external bitmap/sound data (e.g. extract an internal
   ui.map bitmap) to see the "External resource map references" warning and fingerprint status.
7. Optional stress test: try extracting a tag with embedded (non-shared) custom art if you have
   one (a modded map with brand-new textures not in stock bitmaps.map) — this SHOULD be blocked
   with a plain-language warning, confirming the disabled-relocation guard works as intended.

### M5 remaining (Step C, not started — user said stop for review after Step B, done below)
- Step C: conflict dialog (skip/replace/rename, "apply to all") using the existing
  `ConfirmDialog.tsx`, plus pre-write validation surfaced in the UI.

## Relocation research (2026-08) — full report, what's built, what's still unapproved

Real bytes only, cross-checked against `invader/src/build/build_workload.cpp` +
`invader/src/tag/code_generator/compile.py` (the actual compiler, not guesswork).

**Region order (coldsnap.map)**: `[header 0-2048] → [BSP data 2048-26,396,672] → [embedded
bitmap/sound raw data, ending exactly at modelDataFileOffset=54,552,850] → [model data, to
70,610,858] → [tag data, to 79,925,558]`. Identical shape (0 embedded) on bloodgulch/ui/
sidewinder. Matches `build_workload.cpp` byte-for-byte.

**Every absolute/stored-offset mechanism found**:
- `bsp_start` (`scenario` tag's `ScenarioBSP` entries): absolute file offset, always ends well
  before the insertion point in every map checked — never shifts, never patched.
- bitmap per-mipmap pixel offset / sound `samples.file_offset` when `external=0`: exactly what's
  relocated.
- bitmap's `compressed color plate data`/`processed pixel data`: `nonCached` (confirmed garbage
  in real bytes) — already ignored.
- Every OTHER `TagDataOffset` field (scenario script/comment data, font pixels, string_list/
  unicode_string_list strings, meter stencil, hud_message_text, input_device_defaults,
  model_animations frame data): a pointer-based mechanism (same virtual-address translation as
  `TagReflexive`) per Invader's own codegen — confirmed safe, `external`/`file_offset` sub-fields
  are written as garbage for these groups and never read at the resolved location.
- `gbxmodel` vertex/index references: **superseded, see "gbxmodel geometry — Stage 1 capture
  (2026-08)" below for the real mechanism** (byte offsets into a separate model-data region, NOT
  virtual-address pointers at all).

**Header/sub-header fields that change** (4, not 3 — `tagDataSize` is separately stored, not
auto-derived): `modelDataFileOffset`, `tagDataOffset`, `decompressedFileSize`, `tagDataSize`.
Each changes for the SAME reason here (the embedded-byte insertion) — tag-ARRAY growth (a
pre-existing, separately-tested M5 mechanism) additionally shifts the struct/path-data append
position, but doesn't touch these 4 fields differently than it already did before this session.

**Alignment — SETTLED this session** (`scripts/check-alignment.ts`, read-only, run against all 5
sample maps, see handoff for the full table): only `coldsnap.map` breaks 4-byte alignment on
`modelDataFileOffset`/`tagDataOffset` (both ≡ 2 mod 4); the other 4 maps (bloodgulch, ui,
sidewinder, Yoyorast_Island) are both 4-aligned. **No map is 16-byte aligned on both fields** (at
least one of the two breaks it in every single map). Decision: **preserve the target's own
alignment, never force 4-byte or 16-byte** - confirmed as the only safe rule across real maps, not
just the one coldsnap sample. This matches what `applyInjection` already does (it pads the
INSERTED blob to a 4-byte boundary relative to itself, which shifts both fields by a multiple of
4 and therefore preserves whatever mod-4/mod-16 remainder the target already had) - no code change
needed, the existing implementation was already correct, now confirmed by 5 maps instead of 1.

**CRC/checksums**: stale after this write, same as the pre-existing tag-array-growth code already
flags — tracked P0 above, M6 work, not done here.

**What's built** (`embedded-data-fields.ts` new shared helper + `tag-extractor.ts` capture +
`tag-injector.ts` write path), all behind `InjectionOptions.allowEmbeddedRelocation` (default
`false`):
1. `findEmbeddedDataFields()` — ONE definition-driven detector for both the bitmap (bitfield
   sibling) and sound (`TagDataOffset`+`externalFileOffset`) mechanisms, returning `'unknown'`
   (never guessed) for any unrecognized shape. Used directly by the walker and the extractor.
2. Capture (extraction time, always on — this part has NO disabled flag, it's pure data
   gathering, never written back anywhere): slices embedded bytes, dedupes per-tag by
   `(fileOffset, size)`, validates bitmap sizes against width/height/format/mipmaps (100% exact
   formula match against all 800 real BitmapData instances checked), bounds-checks sound
   (no deterministic size formula available for compressed audio — stated, not guessed). A
   mismatch blocks the WHOLE tag's relocation (container still has the tag, just without
   `embeddedRawDataAssets`), never a partial one.
3. Write path (`applyInjection`): inserts the unique asset bytes once, right before the target's
   `modelDataFileOffset`, patches the 4 header fields, patches each relocated tag's own raw
   file-offset field via its recorded `patchOffset`. `planInjection`'s default (production)
   blocking behavior is UNCHANGED — this only ever runs when a caller explicitly opts in.

**Tested** (`embedded-relocation.test.ts`, real bytes, no synthetic fixtures): production default
still blocks; an isolated SWAP-into-self case verifies the exact 4-field math with zero tag-array
growth; a combined ADD into a copy of bloodgulch.map (0 pre-existing embedded data) verifies
byte-identical relocated content + a full 1500+ tag closure re-parse + Verify Embedded Data 0
problems; a harder SWAP into a copy of coldsnap.map ITSELF (396 pre-existing embedded assets)
verifies every one of those 396 keeps its exact byte content and file offset, only the 2 swapped
tags' content legitimately moved. All verification is **independent of `tag-injector.ts`'s own
arithmetic** — expected sizes/offsets are re-derived from scratch in the test file.

**What these tests CANNOT prove** (told to the user explicitly, not hidden):
- They confirm the bytes are internally consistent with OUR OWN reader's assumptions. A shared
  blind spot between the writer and reader would pass here undetected.
- They do not prove the real Halo CE/OpenCE engine accepts the file — crc32/checksums are
  deliberately stale (M6), and nothing here has been loaded in the actual game.
- Cross-tag/cross-map dedup is NOT done — relocating a tag whose embedded bytes happen to already
  exist elsewhere in the target map's raw-data region still inserts a fresh copy (acceptable,
  approved scope: dedupe is per-tag only, per the user's own phrasing).

**NOT YET approved**: enabling `allowEmbeddedRelocation` in the real app
(`InjectDialog.tsx`/`map-worker.ts`). Awaiting the user's decision after reviewing this report —
if approved, the only change needed is passing `{ allowEmbeddedRelocation: true }` through
`map-worker.ts`'s `planInject`/`applyInject` IPC handlers.

### What to test in OpenCE on Windows (embedded relocation, once/if enabled)
1. `yarn core test` locally first — confirms the bytes are internally consistent before touching OpenCE.
2. Extract a tag with embedded bitmap/sound data (one of your custom maps with real custom art,
   e.g. a vehicle skin not in stock bitmaps.map) into a `.ocetags` file.
3. Inject it into a DIFFERENT target map, Save As a new file (never overwrites the original).
4. Load the new file in the actual game. **What you should see**: the map loads, the injected
   tag is present, and its texture/sound plays correctly in-game.
5. What each failure would mean: **fails to load at all** → likely the stale CRC32/checksum (M6,
   already known-stale, not a relocation bug specifically) OR a real relocation math error we
   didn't catch — report the exact error text. **Loads but the map/level doesn't start** →
   possible corrupted tag-data region (reflexive/pointer issue), report which tag. **Starts but
   the new object spawns with blank/missing/garbled textures or no sound** → the relocation
   itself likely has a bug (wrong offset patched, or the asset bytes themselves got mangled) —
   this is the single most informative failure mode, please report it with the exact tag path.

## gbxmodel geometry — Stage 1 capture (2026-08, same-reader unless noted)
Staged build, approved 2026-08. **Stage 1 (capture only) is built. Stage 2 (injection) has NOT
started and relocation stays off in the app.** `gbxmodel-geometry.ts` is a standalone module, NOT
wired into `tag-extractor.ts`/`tag-injector.ts`/`dependency-walker.ts` — any tag whose closure
includes a `gbxmodel` is still unconditionally blocked, unchanged.

**Mechanism (real bytes, bloodgulch `vehicles\warthog\warthog` vs coldsnap
`vehicles\coldsnap_hogs\warthog`, same reused stock model)**: vertex/triangle data for a
`GBXModelGeometryPart` is NOT addressed via TagReflexive/TagDataOffset at all — it's raw byte
offsets into the separate "model data" region. `vertexOffset` (uint32, struct offset 100) is
relative to `modelDataFileOffset`. `vertexCount`×{68 uncompressed/32 compressed, by `vertexType`}
gives an EXACT vertex byte size (0 mismatches across all 1,112 real parts in bloodgulch+coldsnap).
`triangleOffset`/`triangleOffset2` (always equal on PC, confirmed in every sample — Xbox-only
distinction) are relative to `modelDataFileOffset + vertexSize` (`vertexSize` is a stored
tag-data-header field, confirmed `modelDataSize == tagDataOffset - modelDataFileOffset` exactly).
`vertexPointer` is a RUNTIME-ONLY virtual address (213,734,156 vs 311,747,920 for the identical
model in the two maps above; exceeds bloodgulch's 13,936,092-byte file size by 15× — never a file
offset) — never read or patched.

**Triangle byte size has no closed-form formula** (strip-join/primitive-restart count isn't
stored) — recovered via neighbor-gap: sort every part in the WHOLE map by absolute triangle
offset, size = next part's start minus mine (region end = `tagDataOffset` for the last one).
Index `0xFFFF` is a legitimate primitive-restart sentinel wherever it appears. The gap is
occasionally (37% of 1,112 real parts) exactly 1 index too large — a single trailing non-restart
out-of-range word, confirmed build-tool scratch-memory leftover (same value, 0x2D2D, across many
unrelated parts/tags) — trimmed; never more than 1 word in any real sample. After trimming, 0
parts have any remaining non-restart, non-real index, in either sample map (`gbxmodel-
geometry.test.ts`). Only `triangleBufferType=1` ("triangle strip") has real samples to verify
against (100% of 1,112 parts) — type 0 ("triangle list") is blocked, not guessed.

**Stage 1 sweep results** (`gbxmodel-geometry.test.ts`): bloodgulch 70/70 gbxmodel tags captured,
0 blocked; coldsnap 78/78 captured, 0 blocked (447 and 665 real parts respectively). "Dropped" is
not a real outcome of this code path — every tag is either captured or blocked, same contract as
Issue 1's TagDataOffset fix and the bitmap/sound embedded capture.

**Stage 2 prerequisites, verified this session (all same-reader, test-file-local — nothing wired
into tag-injector.ts)**:
1. No-patch claim, re-verified on ALL 665 coldsnap parts (not a 40-part sample) —
   `gbxmodel-combined-insertion-design.test.ts`. 0 mismatches.
2. Field table for ONE injection combining embedded + vertex + triangle insertion (order matters
   — each insertion point is defined relative to the PREVIOUS ones' shifts): embedded bytes (E)
   insert before `modelDataFileOffset`; vertex bytes (V) insert at
   `modelDataFileOffset_new + oldVertexSize` (end of vertex region); triangle bytes (T) insert at
   `oldTagDataOffset + E + V` (end of triangle region). Result: `modelDataFileOffset += E`;
   `vertexSize += V`; `modelDataSize += V + T` (NOT E — embedded bytes live outside the model-data
   region entirely); `tagDataOffset += E + V + T`; `decompressedFileSize += E + V + T` (+ any
   tag-struct append `S`, same pre-existing ADD/SWAP mechanic, unaffected by E/V/T).
   `tagDataSize += S` only. New part's own `vertexOffset = oldVertexSize` (pre-insert value);
   `triangleOffset = triangleOffset2 = oldModelDataSize - oldVertexSize` (pre-insert triangle-
   section size) — both computed from the TARGET's existing header fields alone, no scan needed.
   Existing parts: ZERO fields patched (proven in #1).
3. Combined 3-insertion test (`gbxmodel-combined-insertion-design.test.ts`): injects the
   warthog's own captured part[0] (real vertex+triangle bytes from Stage 1) plus a synthetic
   embedded payload into a coldsnap-based buffer in one pass; confirms the field table math,
   byte-identical placement of the new part, AND an independent re-scan of all 665 pre-existing
   parts (not just the new one) resolving correctly with 0 out-of-region and 0 byte mismatches.
4. Triangle neighbor-gap scanning is extraction-time only (whole-SOURCE-map, read-only, paid
   once). Injection needs NO scan of the target — confirmed by #2/#3 using only stored header
   fields. The container would store each part's explicit captured byte length (no formula
   needed at injection time).
5. `model_animations` frame data and `model_collision_geometry` are **already captured today**
   (checked real tags: coldsnap `model_animations` with 256 anims/792,520 bytes, 0 warnings;
   `model_collision_geometry` tags in both maps, 0 warnings) — Issue 1's generic TagDataOffset fix
   and the ordinary TagReflexive mechanism already cover them. They are NOT part of this gap.

**What tests can't prove**: same-reader only, as always — this proves our own reader and writer
agree, not that the real Halo CE/OpenCE engine accepts the layout. The index-validity check never
proves the triangle data is semantically correct beyond "indices are in range" — a scrambled-but-
in-range index buffer would pass and still render wrong in-game. Effort for Stage 2 itself
(wiring into `tag-injector.ts`, a real `allowGbxmodelGeometryRelocation`-style flag, container
format changes to carry per-part captured bytes): medium — the per-part arithmetic is now fully
derived and tested, the remaining work is wiring + container schema + a new Vitest suite calling
the REAL injector, not more research.


- `/app/core/src/map/definitions/engine.ts` — schema engine (load/validate/resolve/decode/encode)
- `/app/core/src/map/definitions/validate-tag.ts` — real-map validation (round-trip, deps, bounds)
- `/app/core/src/map/dependency-walker.ts`, `tag-extractor.ts`, `container.ts` — M4 core logic
- `/app/core/src/map/embedded-data-fields.ts` — shared bitmap/sound embedded-field detector +
  bitmap pixel-data-size validator, used by the walker and the extractor (2026-08)
- `/app/core/src/map/tag-injector.ts` — M5 Step A+B injection engine (plan/apply ADD + SWAP
  modes) + embedded relocation write path (built 2026-08, behind `allowEmbeddedRelocation`,
  default off, NOT yet approved for the real app)
- `/app/desktop/electron/worker-manager.ts`, `map-worker.ts`, `main.ts` — M4/M5 persistent worker + IPC
- `/app/desktop/src/components/DependencyDialog.tsx`, `TagBrowser.tsx` — M4 UI
- `/app/desktop/src/components/InjectDialog.tsx`, `SettingsDialog.tsx` — M5 Step A+B UI (mode choice + review)
- `/app/core/src/map/definitions/SOURCES.md` — provenance table, must stay updated
- `/app/core/src/map/resource-map.ts` — bitmaps.map/sounds.map/loc.map parser + fingerprinting
- `/app/core/scripts/scan-embedded-data.ts` — reusable real-byte scanner for embedded (external=0)
  bitmap/sound data in any .map file (`yarn tsx scripts/scan-embedded-data.ts /path/to/map`); run
  this FIRST against any user-supplied custom map before touching relocation work
- `/app/core/src/map/gbxmodel-geometry.ts` — Stage 1 gbxmodel vertex/triangle capture (2026-08),
  standalone, NOT wired into tag-extractor.ts/tag-injector.ts, relocation stays off
- `/app/core/tests/definitions.test.ts`, `tag-extractor.test.ts`, `tag-injector.test.ts`,
  `container-v2.test.ts`, `embedded-data-fields.test.ts`, `embedded-relocation.test.ts`,
  `tagdata-capture.test.ts`, `gbxmodel-geometry.test.ts`, `gbxmodel-combined-insertion-design.test.ts`
  (new 2026-08) — validation suites (**109/109 passing** as of 2026-08; desktop Vitest 33/33)
- `/app/core/scripts/generate-definitions.mjs` — regenerate `groups/*.json` from a fresh Invader
  clone if definitions ever need updating (`INVADER_DIR=/path/to/invader/.../definition node
  scripts/generate-definitions.mjs`)
