# Halo Demo to Custom Edition Converter: Project Summary

Oct 10, 2026 · @Levy

## Goal

The user wants to add a feature to their existing app, **OpenCE-Modding-Tool** (https://github.com/SutlabSol/OpenCE-Modding-Tool), that converts **Halo Mac Demo maps** (HaloMD) into **Halo Custom Edition** maps, through a UI rather than a command line.

- The Invader CLI did not work for the user, so the Invader/Python/Tkinter approach was dropped entirely.
- The user does not need external bitmaps or sounds, because their Mac demo maps keep everything internal.
- They want the whole feature added to the program from **one complete Emergent prompt**. That prompt is **not written yet**.

## Repo facts

I cloned and read the repo. The stack is Electron + TypeScript, with the core library in `core/src/map/` and the desktop app in `desktop/`.

- **Schema engine:** `definitions/*.json` plus `engine.ts` (`resolveStruct`, `decodeStruct`, `getGroupStructName`, `resolvePointer`) describe every tag struct, including reflexive, data-offset and dependency pointers.
- **Validation and BSP code:** `validate-tag.ts` has `validateStructInstance` and `locateStructureBsp`. `tag-index.ts` has `parseTagIndex`, which infers the base address as the tag array pointer minus 0x28.
- **Other pieces:** `map-worker.ts` handles worker ops. `errors.ts` currently flags non-CE maps as unsupported. `sample_maps/` holds CE maps (bloodgulch, sidewinder, coldsnap, ui, Yoyorast\_Island).
- **Rules (memory/RULES.md):** work on copies, write via temp file + rename, never overwrite the source, validate before writing, stay in scope, ask on ambiguity, and label results "verified" vs "same-reader-verified". Their own notes flag "stale crc32" as a P0 item.
- **Test setup:** I ran `npm install` in `core/` in my sandbox (only my copy changed) and ran the repo's validators with `npx tsx`.

## Format facts

Sources: the PDF "Halo CE Map Structure" by Snowy Mouse, c20.reclaimers.net, and Invader's source. Everything is little-endian and the header is 2048 bytes.

**Standard header** (`head` magic 0x68656164, which reads "daeh" in bytes on disk):

| Offset | Field |
| --- | --- |
| 0x0 | `head` magic 0x68656164 |
| 0x4 | Cache version: 5 = Xbox, 6 = demo, 7 = PC retail, 13 = CEA, 609 = Custom Edition |
| 0x8 | File size |
| 0xC | Padding length |
| 0x10 | Tag data offset |
| 0x14 | Tag data size |
| 0x20 | Scenario name (32 bytes) |
| 0x40 | Build string (32 bytes) |
| 0x60 | Scenario type (uint16): 0 = SP, 1 = MP, 2 = UI |
| 0x64 | CRC32 |
| 0x7FC | `foot` magic 0x666f6f74 |

**True demo header** (cache v6):

| Offset | Field |
| --- | --- |
| 0x02 | Scenario type (uint16) |
| 0x2C0 | `Ehed` magic 0x45686564 |
| 0x2C4 | Tag data size |
| 0x2C8 | Build string |
| 0x588 | Cache version (6) |
| 0x58C | Scenario name |
| 0x5B0 | CRC |
| 0x5E8 | File size |
| 0x5EC | Tag data offset |
| 0x5F0 | `Gfot` magic 0x47666f74 |

The PDF's "0x10" for the demo tag data offset is **wrong**. I confirmed 0x5EC on a real demo map.

**Tag data header:** 0x0 tag array pointer, 0x4 scenario tag ID, 0x8 checksum of the tag files, 0xC tag count, 0x10 model part count, 0x14 model data file offset, 0x18 model part count again, 0x1C vertex data size, 0x20 model data size, 0x24 `tags` magic.

**Tag entry** (32 bytes, starting at tag data + 0x28): primary, secondary and tertiary fourCC, tag ID, path pointer (+0x10), data pointer (+0x14), external flag (+0x18).

**Base addresses and BSP**

- PC and CE use base 0x40440000. True demo uses **0x4BF10000**. Tag space is 23 MiB on both.
- BSP load address = base + 23 MiB - bsp\_size. It lives in the scenario's `structure bsps` array (`bsp start`, `bsp size`, `bsp address`), so BSP internal pointers shift by the same delta as the tag data.
- BSP header is 24 bytes: meta pointer at 0x0, rendered vertices at 0x8, lightmap vertices at 0x10.
- Invader `gbx-demo`: build string `01.00.00.0576`, base 0x4BF10000, demo script table. Invader `gbx-custom`: `01.00.00.0609`, base 0x40440000, CE script table.

**Tags CE hard-requires in every map** (Invader `PC_REQUIRED_TAGS`, `src/hek/map.cpp`):

- `ui\ui_tags_loaded_all_scenario_types` (tag\_collection)
- sounds `sound\sfx\ui\cursor`, `sound\sfx\ui\back`, `sound\sfx\ui\flag_failure`
- ustr `ui\shell\main_menu\mp_map_list` and `ui\shell\strings\loading`
- bitmaps `ui\shell\bitmaps\trouble_brewing` and `ui\shell\bitmaps\background`
- `globals\globals`
- one scenario-type collection: `ui\ui_tags_loaded_solo_scenario_type` (type 0), `ui\ui_tags_loaded_multiplayer_scenario_type` (type 1) or `ui\ui_tags_loaded_mainmenu_scenario_type` (type 2)

**Script function indices** (RIAT `definition.json`):

- Demo and CE differ for 19 functions, all console or server commands: sv\_map 493 to 492, profile\_load 504 to 511, checkpoint\_save 507 to 516, checkpoint\_load 508 to 517, sv\_players 494 to 496, sv\_kick 495 to 497, and others.
- All global-variable indices are identical. CE has 22 extra functions and demo has 1.
- A remap is only needed if a scenario's scripts use those functions. Both HaloMD maps checked have 0 scripts.

## CRC32 (verified)

The algorithm below reproduces the header CRC on all 5 sample CE maps: bloodgulch 7b309554, sidewinder bd95cf55, coldsnap 94ed459f, ui 73ee7229 and Yoyorast\_Island 0e5d57de.

1. Start with `crc = 0`.
2. For each BSP in the scenario's `structure bsps` order, `crc = zlib.crc32(bytes[bsp_start .. +bsp_size], crc)`.
3. Then the same over bytes\[modelDataFileOffset .. +modelDataSize\], using tag data header +0x14 and +0x20.
4. Then the same over bytes\[tagDataOffset .. +tagDataSize\].
5. Final value = `(~crc) >>> 0`.

The header is excluded from the CRC.

## Maps analyzed

| Map | Layout | Tags | Result |
| --- | --- | --- | --- |
| `theisland_3.map` (HaloMD, modded) | Retail layout: standard header, version 7, build 0576, base 0x40440000, CRC field 0, MP | 2,602, all internal | 2,600 of 2,601 tags validate as CE. BSP validates (70,339 structs, 0 errors, at the CE address). 0 scripts. One dangling reference: scenery palette\[14\] is declared `scen` but its ID points at tag #2441, a sound. Expected CRC after conversion: **0x0A5AFEA5** |
| `heh_2.map` (HaloMD, modded bloodgulch) | Retail layout, same as above | 2,410 | 2,409 of 2,409 validate with 0 errors. BSP 0 errors (33,169 structs). 0 scripts. BSP is the same size and address as stock but not byte-identical. Expected CRC: **0xD1C331E9** |
| `bloodgulch.map` (original Demo) | **True demo layout**: Ehed, version 6 at 0x588, base 0x4BF10000 | 2,410 | File size matches. Tag data offset 8,722,804, size 5,736,948. CRC field e7e08c22. MP, 447 model parts. BSP size 1,517,568 at demo address 0x4D49D800 |

- **Mac demo vs retail layout:** both HaloMD maps use the retail layout (version 7), so for those a conversion is basically a header patch.
- **Relation to `heh_2`:** it is a modded version of the original demo bloodgulch, with the same tag count and model parts. Its tag data is 2 bytes smaller and its model data 1,414 bytes smaller, so it can serve as a rough ground truth for a demo-layout rebase.
- **Stock CE comparison:** `heh_2` lacks 47 tags that stock CE bloodgulch keeps in its resource maps, mostly ustr strings (stock has 100 ustr external; `heh_2` has 54 internal). All its references resolve, so nothing is broken.
- **Coincidental values:** value-range scanning for pointers is unreliable. Clean CE maps contain about 1,200 coincidental values in the demo address range, so any rebase must be driven by the schema engine, not a scan.

## Phase 1 plan: retail-layout maps

Phase 1 covers maps with version 7 and base 0x40440000, which is what both HaloMD maps are.

1. **Detect and classify** the map.
2. **Pre-flight checks:** file size matches the header; base address is 0x40440000; the whole map validates (report errors as warnings); required tags are present (warn if missing); external tags (warn); scenario name differs from filename (warn); scripts present (warn).
3. **Convert** by changing only these header bytes: version to 609, build string to `01.00.00.0609`, padding to 0, and CRC recalculated with the verified algorithm.
4. **UI:** a "Convert to Custom Edition..." button on the unsupported banner and in the File menu, plus a dialog with the checklist and old and new CRC. Never overwrite the source.
5. **Tests:** the CRC regression on the 5 CE sample maps; synthetic header tests; real-byte tests on `theisland_3.map` and `heh_2.map` (auto-skip if absent); a diff test that only header bytes 0x4-0x7, 0x40-0x5F and 0x64-0x67 changed; and refusing to convert an already-CE map.

I gave the user this as a first-draft prompt plus an addendum for the required-tags check and the `heh_2` test. The full single combined prompt has not been written.

## Phase 2 plan: true demo layout

Phase 2 is now confirmed possible because the user supplied an original demo map.

1. **Build a CE header:** version 609, name copied from 0x58C, build string `01.00.00.0609`, scenario type from 0x2, file size from 0x5E8, tag data offset and size from 0x5EC and 0x2C4.
2. **Rebase every pointer in the tag data** from 0x4BF10000 to 0x40440000, driven by the schema engine. This covers the tag array pointer, tag entry path and data pointers, reflexive pointers, data-offset pointers, dependency path pointers and `Pointer` fields.
3. **Rebase the BSP:** `bsp address`, the BSP header pointers and the BSP internal structures, by the same delta.
4. **Remap script function indices** where needed, then **recalculate the CRC**.

File offsets (model data, bitmap and sound raw data) stay the same, because the layout and the 2048-byte header size are unchanged.

## Prototype status

The Phase 2 conversion has been prototyped in my sandbox only (`core/scripts/_rebase.ts`, not in the user's repo). It ran on the original demo `bloodgulch.map` without error and wrote /tmp/bg\_ce.map.

- **Pointers rebased:** about 18,800 in total: 7,368 reflexive, 6,918 dependency path, 2,133 data-offset, 2,410 tag paths, 2,409 tag data pointers, plus the tag array, BSP address and BSP header ones.
- **Computed CRC:** 0x46B6B108.

**Not yet done:**

- validating the output with the repo's CE validator (tags and BSP)
- comparing the output against `heh_2.map` for ground truth
- checking how many of the BSP's own internal pointers the walk actually reached
- checking the demo bloodgulch scenario's script count and function usage
- checking the "nonCached" pointer-type fields I skipped (GBXModelGeometryPart vertex and triangle pointers, Bitmap pixel-data pointers, BSP leaf map pointers, Scenario source files), to see whether they hold demo-range pointers or zeros and whether they need rebasing for CE

## Caveats

Nothing has been run in the game, so every "verified" above means verified against the repo's own validators and the 5 CE sample maps, not against the game.

- The user must test in CE or OpenCE (for example `sv_map theisland_3 slayer`, and spawn and drive a vehicle on `heh_2`).
- HaloMD may have made changes I cannot see.

## Next steps

1. Finish verifying the Phase 2 prototype using the checks listed under Prototype status.
2. Write the **single combined Emergent prompt** covering Phase 1 and Phase 2, with every verified detail and the test expectations.

## Corrections from Phase 1 (2026-10-11, measured in this repo)

- `theisland_3.map`: the scenario has **two** validation errors, not one: scenery palette[14] points at a sound, and palette[15] points at a device_machine.
- Both HaloMD maps contain exactly one stale reference from the demo, with an old tag ID salt and a path pointer in the 0x4BF10000 range. In heh_2 it is the BSP `sound environment palette[0]`; in theisland_3 it is scenery palette[14]. The CE validator checks only the index, so it missed both. The 5 CE maps have 0 such references. Phase 1 warns about them and does not fix them (see PRD "Converter Phase 1").
- Both maps: padding 0, 0 scripts, 0 globals, all tag entries 0 at +0x18/+0x1C, and tag-file checksum 0x5E2AF81E (same as the original demo bloodgulch).
