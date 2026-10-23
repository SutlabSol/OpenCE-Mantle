import { parseCacheFileHeader } from './header';
import { parseTagIndex, resolveTagDataPointer } from './tag-index';
import { decodeStruct, getGroupStructName, isRangeInBuffer, resolvePointer, resolveStruct } from './definitions/engine';
import { DATA_ARRAY_COUNT, DATA_ARRAY_HEADER_SIZE, SCRIPT_NODE_SIZE } from './convert/tag-data-repairs';
import { scenarioEntryOf } from './convert/scenario-tag';

const NONE = 0xffffffff;
const FLAG_PRIMITIVE = 0x1;
const FLAG_SCRIPT_CALL = 0x2;
const FLAG_GLOBAL_INDEX = 0x4;

/** hs_syntax_node offsets (20 bytes per node after 56-byte data_array header) */
const NODE_SALT = 0x0;
const NODE_INDEX_UNION = 0x2;
const NODE_TYPE = 0x4;
const NODE_FLAGS = 0x6;
const NODE_NEXT = 0x8;
const NODE_STRING = 0xc;
const NODE_DATA = 0x10;

export const HS_SCRIPT_TYPES: Record<number, string> = {
  0: 'startup',
  1: 'dormant',
  2: 'continuous',
  3: 'static',
  4: 'stub',
};

export const HS_VALUE_TYPES: Record<number, string> = {
  0: 'unparsed',
  1: 'special_form',
  2: 'function_name',
  3: 'passthrough',
  4: 'void',
  5: 'boolean',
  6: 'real',
  7: 'short',
  8: 'long',
  9: 'string',
  10: 'script',
  11: 'trigger_volume',
  12: 'cutscene_flag',
  13: 'cutscene_camera_point',
  14: 'cutscene_title',
  15: 'cutscene_recording',
  16: 'device_group',
  17: 'ai',
  18: 'ai_command_list',
  19: 'starting_profile',
  20: 'conversation',
  21: 'navpoint',
  22: 'hud_message',
  23: 'object_list',
  24: 'sound',
  25: 'effect',
  26: 'damage',
  27: 'looping_sound',
  28: 'animation_graph',
  29: 'actor_variant',
  30: 'damage_effect',
  31: 'object_definition',
  32: 'game_difficulty',
  33: 'team',
  34: 'ai_default_state',
  35: 'actor_type',
  36: 'hud_corner',
  37: 'object',
  38: 'unit',
  39: 'vehicle',
  40: 'weapon',
  41: 'device',
  42: 'scenery',
  43: 'object_name',
  44: 'unit_name',
  45: 'vehicle_name',
  46: 'weapon_name',
  47: 'device_name',
  48: 'scenery_name',
};

export interface DecompiledGlobalSummary {
  index: number;
  name: string;
  type: string;
  initExpression: string;
}

export interface DecompiledScriptSummary {
  index: number;
  name: string;
  scriptType: string;
  returnType: string;
  bodySource: string;
  calledStaticScripts: string[];
}

export interface HaloScriptDecompileResult {
  hscSource: string;
  scriptCount: number;
  globalCount: number;
  syntaxNodeCount: number;
  globals: DecompiledGlobalSummary[];
  scripts: DecompiledScriptSummary[];
  scenarioEntities: {
    objectNames: string[];
    triggerVolumes: string[];
    cutsceneCameraPoints: string[];
    cutsceneFlags: string[];
    encounters: string[];
    recordedAnimations: string[];
  };
}

export interface HaloScriptSampleTemplate {
  id: string;
  title: string;
  category: 'dropships' | 'ai_npcs' | 'cutscenes' | 'triggers' | 'multiplayer';
  summary: string;
  requiredSetupGuide: string[];
  requiredObjectNames: string[];
  requiredTriggerVolumes: string[];
  requiredCameraPoints: string[];
  hscSource: string;
}

export const HALOSCRIPT_SAMPLE_TEMPLATES: HaloScriptSampleTemplate[] = [
  {
    id: 'pelican_warthog_drop',
    title: 'Flying Pelican WITH Warthog Drop (Vehicle Delivery)',
    category: 'dropships',
    summary:
      'Spawns a Pelican dropship, attaches a Warthog to its underbelly "cargo" marker via vehicle_load_magic, flies/hovers over the drop zone, and drops the Warthog when a player enters the trigger volume.',
    requiredSetupGuide: [
      '1. Ensure your map has "vehicles\\pelican\\pelican" and "vehicles\\warthog\\mp_warthog" in the Vehicle Palette (use the 3D Viewport right-click -> Add Vehicle if needed).',
      '2. Click "Auto-Setup Scenario Entities" below (or manually name a placed Pelican "pelican_drop", a Warthog "drop_hog", and create trigger volume "trig_pelican_drop").',
      '3. Click "Compile into Scenario (In-Memory)" and press Ctrl+S to save the map.',
      '4. Load the map in Halo CE: the Warthog is locked onto the Pelican cargo bay on startup and drops to the ground when you enter the drop zone (or after the timer).',
    ],
    requiredObjectNames: ['pelican_drop', 'drop_hog'],
    requiredTriggerVolumes: ['trig_pelican_drop'],
    requiredCameraPoints: [],
    hscSource: `; ============================================================================
; Sample 1: Flying Pelican WITH Warthog Vehicle Drop
; Uses (vehicle_load_magic <pelican> "cargo" (unit <warthog>)) and
; (vehicle_unload <pelican> "cargo") to release the Warthog mid-air.
; ============================================================================

(global boolean pelican_hog_dropped false)

(script static void setup_pelican_with_warthog
  (object_create_anew pelican_drop)
  (object_create_anew drop_hog)
  (sleep 1)
  ; Lock the Warthog onto the Pelican's rear underbelly "cargo" bone marker
  (vehicle_load_magic pelican_drop "cargo" (unit drop_hog))
  (unit_set_enterable_by_player pelican_drop false)
  (vehicle_hover pelican_drop true)
)

(script startup init_pelican_hog_delivery
  (setup_pelican_with_warthog)
  (sv_say "Pelican Warthog Delivery ready! Enter trig_pelican_drop to release.")
)

(script continuous monitor_pelican_warthog_drop
  (sleep_until
    (or
      (volume_test_objects trig_pelican_drop (players))
      (= pelican_hog_dropped false)
    )
    30
  )
  (if (= pelican_hog_dropped false)
    (begin
      (sleep 150)
      (sv_say "Pelican: Releasing Warthog from cargo bay!")
      (vehicle_unload pelican_drop "cargo")
      (set pelican_hog_dropped true)
      (sleep 90)
      (vehicle_hover pelican_drop false)
    )
  )
  (sleep 300)
)
`,
  },
  {
    id: 'pelican_troop_drop',
    title: 'Flying Pelican WITHOUT Warthog (Marine Squad Insertion)',
    category: 'dropships',
    summary:
      'Spawns a flying Pelican without a vehicle, loads AI Marines into the passenger bay ("rider"), hovers at the LZ, opens the rear bay door, and unloads the Marine squad into combat.',
    requiredSetupGuide: [
      '1. Ensure "vehicles\\pelican\\pelican" is in the Vehicle Palette and an AI encounter named "marines_lz" exists (or use named Marine bipeds).',
      '2. Click "Auto-Setup Scenario Entities" below to register object name "pelican_troop" and trigger volume "trig_pelican_lz".',
      '3. Click "Compile into Scenario (In-Memory)" and save the map (Ctrl+S).',
    ],
    requiredObjectNames: ['pelican_troop'],
    requiredTriggerVolumes: ['trig_pelican_lz'],
    requiredCameraPoints: [],
    hscSource: `; ============================================================================
; Sample 2: Flying Pelican WITHOUT Warthog (Troop Insertion)
; Hovers Pelican at the landing zone, opens the rear troop bay, and deploys
; passengers from the "rider" seats.
; ============================================================================

(global boolean troop_pelican_deployed false)

(script startup pelican_troop_insertion
  (object_create_anew pelican_troop)
  (sleep 1)
  (vehicle_hover pelican_troop true)
  (unit_open pelican_troop)
  (sleep 90)
  (sv_say "Pelican Troop Transport on station — deploying infantry!")
  (vehicle_unload pelican_troop "rider")
  (sleep 120)
  (unit_close pelican_troop)
  (set troop_pelican_deployed true)
)
`,
  },
  {
    id: 'c_dropship_delivery',
    title: 'Covenant Spirit Dropship (c_dropship) Troop Delivery',
    category: 'dropships',
    summary:
      'Spawns a Covenant Spirit dropship (c_dropship), hovers at the landing zone, opens both tuning-fork troop doors via unit_open, unloads Covenant passengers, and closes its bay doors.',
    requiredSetupGuide: [
      '1. Ensure "vehicles\\c_dropship\\c_dropship" is in the Vehicle Palette.',
      '2. Click "Auto-Setup Scenario Entities" below to register object name "cov_dropship" and trigger volume "trig_cov_drop".',
      '3. Click "Compile into Scenario (In-Memory)" and save the map (Ctrl+S).',
    ],
    requiredObjectNames: ['cov_dropship'],
    requiredTriggerVolumes: ['trig_cov_drop'],
    requiredCameraPoints: [],
    hscSource: `; ============================================================================
; Sample 3: Covenant Spirit Dropship (c_dropship) Troop Delivery
; Controls the Covenant Spirit dropship hover state, bay door animations
; (unit_open / unit_close), and passenger unloading ("passenger").
; ============================================================================

(global boolean cov_dropship_active false)

(script static void deploy_covenant_dropship
  (object_create_anew cov_dropship)
  (sleep 1)
  (vehicle_hover cov_dropship true)
  (sleep 60)
  ; Open the Spirit dropship's side troop bays
  (unit_open cov_dropship)
  (sv_say "Covenant Spirit Dropship opening troop bays!")
  (sleep 90)
  ; Eject all Covenant infantry from the passenger seats
  (vehicle_unload cov_dropship "passenger")
  (sleep 120)
  (unit_close cov_dropship)
  (vehicle_hover cov_dropship false)
)

(script startup init_c_dropship_event
  (sleep 60)
  (deploy_covenant_dropship)
  (set cov_dropship_active true)
)
`,
  },
  {
    id: 'npc_ai_battle',
    title: 'SP / MP NPC Characters & AI Squad Respawn Battle',
    category: 'ai_npcs',
    summary:
      'Sets up human Marine allies and hostile Covenant NPCs on any Singleplayer or Multiplayer map, links human allegiance to the player, and automatically respawns NPC waves when defeated.',
    requiredSetupGuide: [
      '1. Import Marine and Elite/Grunt bipeds + actor_variants into your map (use Tag Injector or Import Manager).',
      '2. Click "Auto-Setup Scenario Entities" to ensure NPC object names ("npc_marine_1", "npc_marine_2", "npc_elite_1", "npc_elite_2") are registered.',
      '3. Click "Compile into Scenario (In-Memory)" and save (Ctrl+S).',
    ],
    requiredObjectNames: ['npc_marine_1', 'npc_marine_2', 'npc_elite_1', 'npc_elite_2'],
    requiredTriggerVolumes: [],
    requiredCameraPoints: [],
    hscSource: `; ============================================================================
; Sample 4: SP & MP NPC Characters & AI Squad Wave Manager
; Configures team allegiances so Marines fight alongside players against
; Covenant NPCs, and respawns NPC characters when killed.
; ============================================================================

(global short ai_wave_number 1)

(script startup setup_npc_allegiances
  (ai_allegiance player human)
  (ai_allegiance human player)
  (object_create_anew npc_marine_1)
  (object_create_anew npc_marine_2)
  (object_create_anew npc_elite_1)
  (object_create_anew npc_elite_2)
  (sv_say "NPC AI Squads initialized: UNSC Marines allied with Player!")
)

(script continuous respawn_npc_characters
  (sleep 450)
  (if (<= (unit_get_health (unit npc_elite_1)) 0.0)
    (begin
      (object_create_anew npc_elite_1)
      (set ai_wave_number (+ ai_wave_number 1))
      (sv_say "Covenant NPC reinforcement wave spawned!")
    )
  )
  (if (<= (unit_get_health (unit npc_marine_1)) 0.0)
    (object_create_anew npc_marine_1)
  )
)
`,
  },
  {
    id: 'cinematic_cutscene',
    title: 'Cinematic Cutscene & Multi-Camera Flythrough',
    category: 'cutscenes',
    summary:
      'Plays a letterboxed intro cutscene that smoothly interpolates the camera across three cutscene camera points (cam_intro_1 -> cam_intro_2 -> cam_intro_3) and returns control to the player.',
    requiredSetupGuide: [
      '1. Click "Auto-Setup Scenario Entities" below to create cutscene camera points "cam_intro_1", "cam_intro_2", and "cam_intro_3" in the scenario.',
      '2. Optionally fine-tune the XYZ/orientation of those camera points in the Tag Editor (`scnr` -> `cutscene camera points`).',
      '3. Click "Compile into Scenario (In-Memory)" and save (Ctrl+S).',
    ],
    requiredObjectNames: [],
    requiredTriggerVolumes: [],
    requiredCameraPoints: ['cam_intro_1', 'cam_intro_2', 'cam_intro_3'],
    hscSource: `; ============================================================================
; Sample 5: Cinematic Cutscene & Smooth Camera Flythrough
; Demonstrates letterbox bars, player input lock, smooth camera splines,
; and fade-in / fade-out transitions.
; ============================================================================

(script static void play_intro_cutscene
  (fade_out 0.0 0.0 0.0 0)
  (cinematic_start)
  (cinematic_show_letterbox true)
  (camera_control true)
  (camera_set cam_intro_1 0)
  (fade_in 0.0 0.0 0.0 45)
  (sleep 45)
  ; Smoothly pan to camera point 2 over 90 ticks (3 seconds)
  (camera_set cam_intro_2 90)
  (sleep 90)
  ; Smoothly pan to camera point 3 over 90 ticks (3 seconds)
  (camera_set cam_intro_3 90)
  (sleep 90)
  (cinematic_show_letterbox false)
  (camera_control false)
  (cinematic_stop)
)

(script startup run_map_intro_cutscene
  (sleep 15)
  (play_intro_cutscene)
)
`,
  },
  {
    id: 'trigger_volume_events',
    title: 'Trigger Volume Ambush & Automatic Base Doors',
    category: 'triggers',
    summary:
      'Monitors a 3D trigger volume (trig_base_entry) and automatically opens a device machine door, spawns turret/vehicle defenses, and broadcasts a server alert when any player walks inside.',
    requiredSetupGuide: [
      '1. Click "Auto-Setup Scenario Entities" below to register trigger volume "trig_base_entry" and object name "door_main".',
      '2. Position the trigger volume in the 3D Viewport or `scnr` -> `trigger volumes` block.',
      '3. Click "Compile into Scenario (In-Memory)" and save (Ctrl+S).',
    ],
    requiredObjectNames: ['door_main'],
    requiredTriggerVolumes: ['trig_base_entry'],
    requiredCameraPoints: [],
    hscSource: `; ============================================================================
; Sample 6: Trigger Volume Ambush & Automatic Doors
; Detects players entering a trigger volume and activates doors/events.
; ============================================================================

(global boolean base_breached false)

(script continuous monitor_base_entry_trigger
  (sleep_until (volume_test_objects trig_base_entry (players)) 15)
  (if (= base_breached false)
    (begin
      (set base_breached true)
      (sv_say "ALERT: Perimeter trigger volume breached! Opening blast doors.")
      (device_set_power door_main 1.0)
      (device_set_position door_main 1.0)
    )
  )
  (sleep 150)
)
`,
  },
  {
    id: 'mp_utility_scripts',
    title: 'MP Utility: Vehicle Auto-Respawn & Low-Gravity / Speed Toggle',
    category: 'multiplayer',
    summary:
      'Useful Multiplayer & Singleplayer utility script that periodically resets abandoned/flipped named vehicles back to their spawn positions and provides callable console helper scripts.',
    requiredSetupGuide: [
      '1. Click "Auto-Setup Scenario Entities" to register object names "mp_hog_1" and "mp_banshee_1".',
      '2. Click "Compile into Scenario (In-Memory)" and save (Ctrl+S).',
    ],
    requiredObjectNames: ['mp_hog_1', 'mp_banshee_1'],
    requiredTriggerVolumes: ['trig_low_grav'],
    requiredCameraPoints: [],
    hscSource: `; ============================================================================
; Sample 7: MP Utility — Vehicle Auto-Reset & Environment Helpers
; ============================================================================

(global short vehicle_reset_ticks 1800)

(script static void reset_named_vehicles
  (object_create_anew mp_hog_1)
  (object_create_anew mp_banshee_1)
  (sv_say "Named vehicles reset to base spawn points.")
)

(script continuous mp_vehicle_watchdog
  (sleep vehicle_reset_ticks)
  ; Reset vehicles if no player is currently driving them
  (if (= (vehicle_test_seat_list mp_hog_1 "W-driver" (players)) false)
    (object_create_anew mp_hog_1)
  )
)
`,
  },
];

/**
 * Decompiles the active scenario's `scripts`, `globals`, `script_string_data`, and `script_syntax_data`
 * into formatted HaloScript (`.hsc`) Lisp source code with topological sorting of static scripts.
 */
export function decompileScenarioScripts(view: Buffer): HaloScriptDecompileResult {
  const header = parseCacheFileHeader(view);
  const tagIndex = parseTagIndex(view, header);
  const scenario = scenarioEntryOf(tagIndex);
  const scenarioStruct = getGroupStructName('scenario')!;

  const emptyResult: HaloScriptDecompileResult = {
    hscSource: '; No compiled HaloScript syntax nodes found in this scenario.\n',
    scriptCount: 0,
    globalCount: 0,
    syntaxNodeCount: 0,
    globals: [],
    scripts: [],
    scenarioEntities: {
      objectNames: [],
      triggerVolumes: [],
      cutsceneCameraPoints: [],
      cutsceneFlags: [],
      encounters: [],
      recordedAnimations: [],
    },
  };

  if (!scenario) return emptyResult;
  const scnrAt = resolveTagDataPointer(scenario.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  if (!isRangeInBuffer(scnrAt, resolveStruct(scenarioStruct).totalSize, view.length)) return emptyResult;

  const decoded = decodeStruct(view, scnrAt, scenarioStruct);

  const readReflexiveNames = (blockName: string, strOffset = 0, strLen = 32): string[] => {
    const field = decoded.get(blockName);
    const fieldDef = resolveStruct(scenarioStruct).fields.find((f) => f.name === blockName);
    const elemStructName = fieldDef?.def.type === 'TagReflexive' ? fieldDef.def.struct : undefined;
    if (field?.kind !== 'reflexive' || !elemStructName || field.value.count <= 0) return [];
    const elemStruct = resolveStruct(elemStructName);
    const out: string[] = [];
    for (let i = 0; i < field.value.count; i++) {
      const elemAt = resolvePointer(
        (field.value.pointerLow + i * elemStruct.totalSize) >>> 0,
        header.tagDataOffset,
        tagIndex.baseMemoryAddress,
      );
      if (!isRangeInBuffer(elemAt, elemStruct.totalSize, view.length)) break;
      const zeroIdx = view.indexOf(0, elemAt + strOffset);
      const end = zeroIdx >= elemAt + strOffset && zeroIdx < elemAt + strOffset + strLen ? zeroIdx : elemAt + strOffset + strLen;
      out.push(view.toString('latin1', elemAt + strOffset, end).trim() || `${blockName}_${i}`);
    }
    return out;
  };

  const scenarioEntities = {
    objectNames: readReflexiveNames('object names', 0, 32),
    triggerVolumes: readReflexiveNames('trigger volumes', 4, 32),
    cutsceneCameraPoints: readReflexiveNames('cutscene camera points', 4, 32),
    cutsceneFlags: readReflexiveNames('cutscene flags', 4, 32),
    encounters: readReflexiveNames('encounters', 0, 32),
    recordedAnimations: readReflexiveNames('recorded animations', 0, 32),
  };

  const syntax = decoded.get('script syntax data');
  const strings = decoded.get('script string data');
  if (syntax?.kind !== 'tagDataOffset' || syntax.value.size < DATA_ARRAY_HEADER_SIZE) {
    return { ...emptyResult, scenarioEntities };
  }

  const tableAt = resolvePointer(syntax.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
  if (!isRangeInBuffer(tableAt, syntax.value.size, view.length)) {
    return { ...emptyResult, scenarioEntities };
  }

  const used = view.readInt16LE(tableAt + DATA_ARRAY_COUNT);
  if (used <= 0 || DATA_ARRAY_HEADER_SIZE + used * SCRIPT_NODE_SIZE > syntax.value.size) {
    return { ...emptyResult, scenarioEntities };
  }

  let stringsAt = -1;
  let stringBytes = 0;
  if (strings?.kind === 'tagDataOffset' && strings.value.size > 0) {
    stringsAt = resolvePointer(strings.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    stringBytes = isRangeInBuffer(stringsAt, strings.value.size, view.length) ? strings.value.size : 0;
  }

  const nodeOffset = (i: number) => tableAt + DATA_ARRAY_HEADER_SIZE + i * SCRIPT_NODE_SIZE;
  const readStringAt = (offset: number): string | null => {
    if (stringsAt < 0 || offset < 0 || offset >= stringBytes) return null;
    const end = view.indexOf(0, stringsAt + offset);
    return end >= stringsAt + offset && end < stringsAt + stringBytes
      ? view.toString('latin1', stringsAt + offset, end)
      : null;
  };

  // Read scripts table first so script calls can resolve script names
  const scriptsField = decoded.get('scripts');
  const rawScripts: Array<{ name: string; scriptType: number; returnType: number; rootNode: number }> = [];
  if (scriptsField?.kind === 'reflexive' && scriptsField.value.count > 0) {
    const elemSize = 92;
    for (let i = 0; i < scriptsField.value.count; i++) {
      const at = resolvePointer(
        (scriptsField.value.pointerLow + i * elemSize) >>> 0,
        header.tagDataOffset,
        tagIndex.baseMemoryAddress,
      );
      if (!isRangeInBuffer(at, elemSize, view.length)) break;
      const zero = view.indexOf(0, at);
      const name = view.toString('latin1', at, zero >= at && zero < at + 32 ? zero : at + 32);
      const scriptType = view.readInt16LE(at + 32);
      const returnType = view.readInt16LE(at + 34);
      const rootNode = view.readUInt32LE(at + 36);
      rawScripts.push({ name, scriptType, returnType, rootNode });
    }
  }

  // Read globals table
  const globalsField = decoded.get('globals');
  const rawGlobals: Array<{ name: string; type: number; initNode: number }> = [];
  if (globalsField?.kind === 'reflexive' && globalsField.value.count > 0) {
    const elemSize = 92;
    for (let i = 0; i < globalsField.value.count; i++) {
      const at = resolvePointer(
        (globalsField.value.pointerLow + i * elemSize) >>> 0,
        header.tagDataOffset,
        tagIndex.baseMemoryAddress,
      );
      if (!isRangeInBuffer(at, elemSize, view.length)) break;
      const zero = view.indexOf(0, at);
      const name = view.toString('latin1', at, zero >= at && zero < at + 32 ? zero : at + 32);
      const type = view.readInt16LE(at + 32);
      const initNode = view.readUInt32LE(at + 40);
      rawGlobals.push({ name, type, initNode });
    }
  }

  const decompileNode = (
    nodeHandle: number,
    indent: string,
    visited: Set<number>,
    calledScripts: Set<string>,
  ): string => {
    if (nodeHandle === NONE || nodeHandle === 0) return 'none';
    const idx = nodeHandle & 0xffff;
    if (idx >= used || visited.has(idx)) return 'none';
    const nextVisited = new Set(visited);
    nextVisited.add(idx);

    const n = nodeOffset(idx);
    const salt = view.readUInt16LE(n + NODE_SALT);
    if (salt === 0) return 'none';

    const unionIdx = view.readUInt16LE(n + NODE_INDEX_UNION);
    const valType = view.readInt16LE(n + NODE_TYPE);
    const flags = view.readUInt16LE(n + NODE_FLAGS);
    const strOff = view.readInt32LE(n + NODE_STRING);
    const dataRaw = view.readUInt32LE(n + NODE_DATA);
    const strVal = readStringAt(strOff);

    if ((flags & FLAG_PRIMITIVE) !== 0) {
      if ((flags & FLAG_GLOBAL_INDEX) !== 0) {
        if (strVal && strVal.length > 0) return strVal;
        const gIdx = dataRaw & 0xffff;
        return rawGlobals[gIdx]?.name ?? `global_${gIdx}`;
      }
      if (strVal && strVal.length > 0) {
        if (valType === 9) {
          return `"${strVal.replace(/"/g, '\\"')}"`;
        }
        return strVal;
      }
      // Decode primitive value by type when string offset isn't set or empty
      switch (valType) {
        case 5: // boolean
          return (dataRaw & 0xff) !== 0 ? 'true' : 'false';
        case 6: { // real
          const f = view.readFloatLE(n + NODE_DATA);
          return Number.isFinite(f) ? f.toFixed(4).replace(/\.?0+$/, (m) => (m === '.0000' ? '.0' : '')) : '0.0';
        }
        case 7: // short
          return String(view.readInt16LE(n + NODE_DATA));
        case 8: // long
          return String(view.readInt32LE(n + NODE_DATA));
        case 43:
        case 44:
        case 45:
        case 46:
        case 47:
        case 48:
          return scenarioEntities.objectNames[dataRaw & 0xffff] ?? `obj_${dataRaw & 0xffff}`;
        case 11:
          return scenarioEntities.triggerVolumes[dataRaw & 0xffff] ?? `vol_${dataRaw & 0xffff}`;
        case 13:
          return scenarioEntities.cutsceneCameraPoints[dataRaw & 0xffff] ?? `cam_${dataRaw & 0xffff}`;
        default:
          return String(dataRaw);
      }
    }

    // Non-primitive expression (function call or static script call)
    const firstChildIdx = dataRaw & 0xffff;
    if (firstChildIdx >= used) return '()';
    const firstChildAt = nodeOffset(firstChildIdx);
    let fnName = readStringAt(view.readInt32LE(firstChildAt + NODE_STRING)) ?? '';
    if (!fnName) {
      if ((flags & FLAG_SCRIPT_CALL) !== 0 && rawScripts[unionIdx]) {
        fnName = rawScripts[unionIdx].name;
      } else {
        fnName = `fn_${unionIdx}`;
      }
    }

    if ((flags & FLAG_SCRIPT_CALL) !== 0 || rawScripts.some((s) => s.name === fnName && s.scriptType === 3)) {
      calledScripts.add(fnName);
    }

    // Collect arguments along the next pointer chain of firstChild
    const args: string[] = [];
    let argHandle = view.readUInt32LE(firstChildAt + NODE_NEXT);
    const argSeen = new Set<number>();
    while (argHandle !== NONE && argHandle !== 0) {
      const argIdx = argHandle & 0xffff;
      if (argIdx >= used || argSeen.has(argIdx)) break;
      argSeen.add(argIdx);
      const childIndent = `${indent}  `;
      args.push(decompileNode(argHandle, childIndent, nextVisited, calledScripts));
      argHandle = view.readUInt32LE(nodeOffset(argIdx) + NODE_NEXT);
    }

    if (args.length === 0) {
      return `(${fnName})`;
    }
    const isMultiLine =
      fnName === 'begin' ||
      fnName === 'begin_random' ||
      fnName === 'if' ||
      fnName === 'cond' ||
      args.some((a) => a.includes('\n')) ||
      args.join(' ').length > 68;

    if (!isMultiLine) {
      return `(${fnName} ${args.join(' ')})`;
    }
    return `(${fnName}\n${args.map((a) => `${indent}  ${a}`).join('\n')}\n${indent})`;
  };

  // Decompile globals
  const globals: DecompiledGlobalSummary[] = rawGlobals.map((g, index) => {
    const typeName = HS_VALUE_TYPES[g.type] ?? 'short';
    const dummySet = new Set<string>();
    const initExpr = g.initNode !== NONE ? decompileNode(g.initNode, '  ', new Set(), dummySet) : '0';
    return {
      index,
      name: g.name,
      type: typeName,
      initExpression: initExpr,
    };
  });

  // Decompile scripts
  const unsortedScripts: DecompiledScriptSummary[] = rawScripts.map((s, index) => {
    const scriptType = HS_SCRIPT_TYPES[s.scriptType] ?? 'startup';
    const returnType = HS_VALUE_TYPES[s.returnType] ?? 'void';
    const calledSet = new Set<string>();
    let bodySource = decompileNode(s.rootNode, '  ', new Set(), calledSet);
    // Unwrap outer (begin ...) for cleaner top-level script formatting
    if (bodySource.startsWith('(begin\n') && bodySource.endsWith('\n  )')) {
      bodySource = bodySource.slice('(begin\n'.length, -'\n  )'.length);
    }
    return {
      index,
      name: s.name,
      scriptType,
      returnType,
      bodySource,
      calledStaticScripts: Array.from(calledSet),
    };
  });

  // Topologically sort static scripts before callers so Sapien/OpenCE compilers never fail forward references
  const scriptByName = new Map<string, DecompiledScriptSummary>();
  for (const s of unsortedScripts) scriptByName.set(s.name, s);

  const sortedScripts: DecompiledScriptSummary[] = [];
  const emitted = new Set<string>();
  const visiting = new Set<string>();

  const emitScript = (s: DecompiledScriptSummary) => {
    if (emitted.has(s.name)) return;
    if (visiting.has(s.name)) return;
    visiting.add(s.name);
    for (const calleeName of s.calledStaticScripts) {
      const callee = scriptByName.get(calleeName);
      if (callee && !emitted.has(callee.name)) {
        emitScript(callee);
      }
    }
    visiting.delete(s.name);
    emitted.add(s.name);
    sortedScripts.push(s);
  };

  // Emit static scripts first in dependency order, then startup/dormant/continuous
  for (const s of unsortedScripts) {
    if (s.scriptType === 'static') emitScript(s);
  }
  for (const s of unsortedScripts) {
    emitScript(s);
  }

  const lines: string[] = [
    `; ============================================================================`,
    `; Decompiled HaloScript (.hsc) — ${scenario.path}`,
    `; Scripts: ${sortedScripts.length} | Globals: ${globals.length} | Syntax Nodes: ${used}`,
    `; ============================================================================`,
    '',
  ];

  if (globals.length > 0) {
    lines.push('; --- Globals ---');
    for (const g of globals) {
      lines.push(`(global ${g.type} ${g.name} ${g.initExpression})`);
    }
    lines.push('');
  }

  if (sortedScripts.length > 0) {
    lines.push('; --- Scripts (Topologically Sorted) ---');
    for (const s of sortedScripts) {
      lines.push(`(script ${s.scriptType} ${s.returnType} ${s.name}`);
      lines.push(s.bodySource.startsWith('  ') ? s.bodySource : `  ${s.bodySource}`);
      lines.push(')');
      lines.push('');
    }
  }

  return {
    hscSource: lines.join('\n'),
    scriptCount: sortedScripts.length,
    globalCount: globals.length,
    syntaxNodeCount: used,
    globals,
    scripts: sortedScripts,
    scenarioEntities,
  };
}
