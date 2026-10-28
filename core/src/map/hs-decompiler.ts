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
    commandLists?: string[];
    deviceGroups?: string[];
    cutsceneTitles?: string[];
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
    id: 'cutscene_aerial_insertion',
    title: '1. Cutscene with an Aerial Insertion (Pelican / Dropship + Cinematic Camera)',
    category: 'cutscenes',
    summary:
      'Foundation template for a cinematic aerial insertion: starts letterbox camera pan across 3D camera points (cam_insert_1 -> cam_insert_2) while a Pelican flies in along its 3D waypoint path, unloads Marines at the LZ, returns control to the player, and flies out.',
    requiredSetupGuide: [
      '1. Edit camera point names (cam_insert_1, cam_insert_2), vehicle name (pelican_insert_1), or squad name (unsc_marines_lz) below — or create this directly in the 3D Script Builder.',
      '2. Click "Compile into Scenario (In-Memory)" to auto-create all cameras, waypoints, vehicles, and AI squads.',
      '3. Press Ctrl+S to save the map.',
    ],
    requiredObjectNames: ['pelican_insert_1'],
    requiredTriggerVolumes: [],
    requiredCameraPoints: ['cam_insert_1', 'cam_insert_2'],
    hscSource: `; ============================================================================
; Event Foundation 1: Cutscene with an Aerial Insertion
; - Easy to customize: change pelican_insert_1, unsc_marines_lz, or camera points
; ============================================================================

(script static void run_aerial_insertion_cutscene
  (ai true)
  (ai_allegiance player human)
  (ai_allegiance human player)
  (object_create_anew pelican_insert_1)
  (ai_place unsc_marines_lz)
  (ai_braindead unsc_marines_lz true)
  (sleep 1)
  (vehicle_load_magic pelican_insert_1 "rider" (ai_actors unsc_marines_lz))
  (object_teleport pelican_insert_1 wp_insert_start)
  (recording_play_and_hover pelican_insert_1 fly_insert_1)

  ; Start cinematic letterbox & camera pan watching the Pelican approach
  (cinematic_start)
  (cinematic_show_letterbox true)
  (camera_control true)
  (camera_set cam_insert_1 0)
  (camera_set cam_insert_2 120)
  (sleep (max 0 (- (recording_time pelican_insert_1) 30)))

  ; Unload squad at the LZ and end cutscene
  (ai_braindead unsc_marines_lz false)
  (vehicle_unload pelican_insert_1 "rider")
  (vehicle_unload pelican_insert_1 "")
  (ai_force_active unsc_marines_lz true)
  (ai_follow_target_players unsc_marines_lz)
  (sleep 45)
  (camera_control false)
  (cinematic_show_letterbox false)
  (cinematic_stop)

  ; Depart Pelican
  (vehicle_hover pelican_insert_1 false)
  (object_set_collideable pelican_insert_1 false)
  (recording_play_and_delete pelican_insert_1 fly_insert_1_out)
)

(script startup init_aerial_insertion_event
  (sleep 15)
  (run_aerial_insertion_cutscene)
)
`,
  },
  {
    id: 'vehicle_reinforcement_drop',
    title: '2. Unit Reinforcement via Vehicle Drop (Friendly Pelican or Enemy Dropship)',
    category: 'dropships',
    summary:
      'Foundation template for vehicle & troop reinforcement via dropship: easily swap between Friendly (Pelican + Warthog/Scorpion + Marines) or Enemy (Covenant Dropship + Wraith/Ghost + Elites) and assign custom flight path recordings.',
    requiredSetupGuide: [
      '1. Choose which vehicle (reinf_dropship_1), cargo vehicle (reinf_cargo_veh_1), and flight path recording (fly_reinf_1) to use.',
      '2. Click "Compile into Scenario (In-Memory)" or build visually in the 3D Script Builder.',
      '3. Press Ctrl+S to save the map.',
    ],
    requiredObjectNames: ['reinf_dropship_1', 'reinf_cargo_veh_1'],
    requiredTriggerVolumes: ['trig_reinf_drop'],
    requiredCameraPoints: [],
    hscSource: `; ============================================================================
; Event Foundation 2: Unit Reinforcement via Vehicle Drop
; - Swap team allegiances, vehicle names, cargo seat ("cargo" vs "cargo_wraith"),
;   and flight path name (fly_reinf_1) to customize Friendly or Enemy drops!
; ============================================================================

(script static void deploy_vehicle_reinforcement
  (ai true)
  (ai_allegiance player human)
  (ai_allegiance human player)
  (ai_allegiance_remove human covenant)
  (ai_allegiance_remove covenant human)
  (ai_allegiance_remove player covenant)
  (ai_allegiance_remove covenant player)

  (object_create_anew reinf_dropship_1)
  (object_create_anew reinf_cargo_veh_1)
  (ai_place reinf_veh_crew_1)
  (ai_place reinf_infantry_1)
  (ai_braindead reinf_infantry_1 true)
  (sleep 2)

  ; Load AI driver into cargo vehicle and attach cargo vehicle to dropship clamp
  ; ("cargo" for Pelican + Warthog/Scorpion, or "cargo_wraith" / "cargo_ghost01" for Spirit)
  (vehicle_load_magic reinf_cargo_veh_1 "scorpion-driver" (ai_actors reinf_veh_crew_1))
  (ai_vehicle_encounter reinf_cargo_veh_1 reinf_veh_crew_1)
  (unit_enter_vehicle reinf_cargo_veh_1 reinf_dropship_1 "cargo")
  (vehicle_load_magic reinf_dropship_1 "rider" (ai_actors reinf_infantry_1))

  ; Fly along assigned path to LZ
  (object_teleport reinf_dropship_1 wp_reinf_start)
  (recording_play_and_hover reinf_dropship_1 fly_reinf_1)
  (sleep (max 0 (- (recording_time reinf_dropship_1) 45)))

  ; Release cargo vehicle and unload infantry squad at LZ
  (unit_exit_vehicle reinf_cargo_veh_1)
  (sleep 30)
  (ai_braindead reinf_infantry_1 false)
  (vehicle_unload reinf_dropship_1 "rider")
  (vehicle_unload reinf_dropship_1 "")
  (ai_force_active reinf_veh_crew_1 true)
  (ai_force_active reinf_infantry_1 true)
  (ai_follow_target_players reinf_veh_crew_1)
  (ai_follow_target_players reinf_infantry_1)

  ; Fly away and despawn dropship
  (sleep 90)
  (vehicle_hover reinf_dropship_1 false)
  (object_set_collideable reinf_dropship_1 false)
  (recording_play_and_delete reinf_dropship_1 fly_reinf_1_out)
)

(script startup init_vehicle_reinforcement_drop
  (sleep 15)
  (deploy_vehicle_reinforcement)
)
`,
  },
  {
    id: 'units_fighting_event',
    title: '3. Units Fighting (Friendly Marines vs Enemy Covenant Squad Battle)',
    category: 'ai_npcs',
    summary:
      'Foundation template for ground AI combat: spawns Friendly Human Marines (allied with the player) and Enemy Covenant Elites/Grunts at their waypoints and links their sightlines so they immediately engage in battle.',
    requiredSetupGuide: [
      '1. Customize squad names (unsc_squad_1, cov_squad_1) or build in the 3D Script Builder to place their exact 3D spawn positions.',
      '2. Click "Compile into Scenario (In-Memory)" and save (Ctrl+S).',
    ],
    requiredObjectNames: [],
    requiredTriggerVolumes: [],
    requiredCameraPoints: [],
    hscSource: `; ============================================================================
; Event Foundation 3: Units Fighting (Friendly vs Enemy AI Battle)
; - Spawns friendly & enemy squads, sets allegiances, and engages combat
; ============================================================================

(script startup init_units_fighting_battle
  (ai true)
  (ai_allegiance player human)
  (ai_allegiance human player)
  (ai_allegiance_remove human covenant)
  (ai_allegiance_remove covenant human)
  (ai_allegiance_remove player covenant)
  (ai_allegiance_remove covenant player)

  (ai_place unsc_squad_1)
  (ai_place cov_squad_1)
  (ai_force_active unsc_squad_1 true)
  (ai_force_active cov_squad_1 true)
  (ai_follow_target_players unsc_squad_1)
  (ai_magically_see_encounter unsc_squad_1 cov_squad_1)
  (ai_magically_see_encounter cov_squad_1 unsc_squad_1)
  (ai_magically_see_players cov_squad_1)
  (ai_attack unsc_squad_1)
  (ai_attack cov_squad_1)
)
`,
  },
  {
    id: 'door_from_switch',
    title: '4. A Door Activating from a Switch (Device Control -> Door Machine)',
    category: 'triggers',
    summary:
      'Foundation template for a switch-activated door: monitors a device control switch (switch_control_1) or switch trigger and powers/opens the linked door machine (door_machine_1) when activated.',
    requiredSetupGuide: [
      '1. Set the switch name (switch_control_1) and door machine name (door_machine_1).',
      '2. Click "Compile into Scenario (In-Memory)" and save (Ctrl+S).',
    ],
    requiredObjectNames: ['switch_control_1', 'door_machine_1'],
    requiredTriggerVolumes: ['trig_switch_1'],
    requiredCameraPoints: [],
    hscSource: `; ============================================================================
; Event Foundation 4: A Door Activating from a Switch
; - Waits for the player to activate switch_control_1 (or step up to trig_switch_1)
;   and smoothly powers & opens door_machine_1
; ============================================================================

(global boolean door_switch_activated false)

(script startup init_switch_door_lock
  (object_create_anew door_machine_1)
  (object_create_anew switch_control_1)
  (device_set_power door_machine_1 1.0)
  (device_set_position door_machine_1 0.0)
  (device_set_power switch_control_1 1.0)
  (device_set_position switch_control_1 0.0)
)

(script continuous monitor_door_switch
  (sleep_until
    (or
      (> (device_get_position switch_control_1) 0.0)
      (volume_test_objects trig_switch_1 (players))
    )
    10
  )
  (if (= door_switch_activated false)
    (begin
      (set door_switch_activated true)
      (device_set_position switch_control_1 1.0)
      (device_set_never_appears_locked door_machine_1 true)
      (device_set_power door_machine_1 1.0)
      (device_set_position door_machine_1 1.0)
      (print "Switch activated — opening door!")
    )
  )
  (sleep 60)
)
`,
  },
  {
    id: 'door_from_proximity',
    title: '5. A Door Activating from a Unit Being Near (Proximity Door Sensor)',
    category: 'triggers',
    summary:
      'Foundation template for an automatic proximity door: opens the door machine (door_prox_1) whenever players or friendly units enter the proximity trigger volume (trig_door_prox_1), and closes it when clear.',
    requiredSetupGuide: [
      '1. Set the door machine name (door_prox_1) and proximity trigger volume (trig_door_prox_1).',
      '2. Click "Compile into Scenario (In-Memory)" and save (Ctrl+S).',
    ],
    requiredObjectNames: ['door_prox_1'],
    requiredTriggerVolumes: ['trig_door_prox_1'],
    requiredCameraPoints: [],
    hscSource: `; ============================================================================
; Event Foundation 5: A Door Activating from a Unit Being Near
; - Automatically opens door_prox_1 when a player or AI unit is near
;   (inside trig_door_prox_1) and closes it once they move away
; ============================================================================

(script startup init_proximity_door
  (object_create_anew door_prox_1)
  (device_set_never_appears_locked door_prox_1 true)
  (device_set_power door_prox_1 1.0)
  (device_set_position door_prox_1 0.0)
)

(script continuous monitor_proximity_door
  (if (volume_test_objects trig_door_prox_1 (players))
    (device_set_position door_prox_1 1.0)
    (device_set_position door_prox_1 0.0)
  )
  (sleep 15)
)
`,
  },
  {
    id: 'cutscene_from_trigger',
    title: '6. Cutscene from a Trigger Point (Player Enters Zone -> Camera Sequence)',
    category: 'cutscenes',
    summary:
      'Foundation template for a trigger-activated cutscene: waits until a player enters trigger volume (trig_cutscene_1), then locks camera control, shows letterbox bars, pans across camera points (cam_trig_1 -> cam_trig_2), and returns control.',
    requiredSetupGuide: [
      '1. Set trigger volume (trig_cutscene_1) and camera points (cam_trig_1, cam_trig_2) — or place them visually in the 3D Script Builder.',
      '2. Click "Compile into Scenario (In-Memory)" and save (Ctrl+S).',
    ],
    requiredObjectNames: [],
    requiredTriggerVolumes: ['trig_cutscene_1'],
    requiredCameraPoints: ['cam_trig_1', 'cam_trig_2'],
    hscSource: `; ============================================================================
; Event Foundation 6: Cutscene from a Trigger Point
; - Waits for player to enter trig_cutscene_1, then plays a smooth camera pan
; ============================================================================

(global boolean trigger_cutscene_played false)

(script continuous monitor_cutscene_trigger_zone
  (sleep_until (volume_test_objects trig_cutscene_1 (players)) 15)
  (if (= trigger_cutscene_played false)
    (begin
      (set trigger_cutscene_played true)
      (cinematic_start)
      (cinematic_show_letterbox true)
      (camera_control true)
      (camera_set cam_trig_1 0)
      (sleep 30)
      (camera_set cam_trig_2 90)
      (sleep 90)
      (camera_control false)
      (cinematic_show_letterbox false)
      (cinematic_stop)
    )
  )
  (sleep 60)
)
`,
  },
  {
    id: 'pelican_warthog_drop',
    title: 'Flying Pelican WITH Warthog Drop + Allied Marines (Bungie b30 Pattern)',
    category: 'dropships',
    summary:
      'Authentic Bungie Silent Cartographer (b30.hsc) Pelican insertion: attaches a Warthog to the Pelican "cargo" clamp via unit_enter_vehicle, flies in along a recorded path, releases the Warthog cleanly via unit_exit_vehicle (no sideways launch!), unloads allied Marines who board the Warthog and follow the player, and flies out.',
    requiredSetupGuide: [
      '1. Ensure "vehicles\\pelican\\pelican" and "vehicles\\warthog\\mp_warthog" are in the Scenario Vehicle Palette.',
      '2. Click "Compile into Scenario (In-Memory)" — it automatically creates "pelican_drop", "drop_hog", "unsc_marines_lz", and trigger volume "trig_pelican_drop".',
      '3. Press Ctrl+S to save the map.',
    ],
    requiredObjectNames: ['pelican_drop', 'drop_hog'],
    requiredTriggerVolumes: ['trig_pelican_drop'],
    requiredCameraPoints: [],
    hscSource: `; ============================================================================
; Sample 1: Bungie b30-Style Flying Pelican WITH Smooth Warthog Drop & Marines
; Uses (unit_enter_vehicle <hog> <pelican> "cargo") and (unit_exit_vehicle <hog>)
; timed via (recording_time <pelican>) so the Warthog drops straight down
; without any sideways ejection impulse!
; ============================================================================

(global boolean pelican_hog_dropped false)

(script static void setup_pelican_with_warthog
  (ai true)
  (ai_allegiance player human)
  (ai_allegiance human player)
  (ai_allegiance default human)
  (ai_allegiance human default)
  (ai_allegiance default player)
  (ai_allegiance player default)
  (object_create_anew pelican_drop)
  (object_create_anew drop_hog)
  (ai_place unsc_marines_lz)
  (ai_braindead unsc_marines_lz true)
  (sleep 1)
  ; Attach Warthog to Pelican underbelly "cargo" marker using Bungie's unit_enter_vehicle
  (unit_enter_vehicle drop_hog pelican_drop "cargo")
  (vehicle_load_magic pelican_drop "rider" (ai_actors unsc_marines_lz))
  (unit_set_enterable_by_player pelican_drop false)
  (recording_play_and_hover pelican_drop pelican_fly_100m)
  (sleep (max 0 (- (recording_time pelican_drop) 45)))
  ; Smoothly release Warthog from belly clamp
  (unit_exit_vehicle drop_hog)
  (sleep 45)
  ; Wake Marines, unload them, and let them board the Warthog & follow the player
  (ai_braindead unsc_marines_lz false)
  (vehicle_unload pelican_drop "rider")
  (ai_vehicle_enterable_distance drop_hog 15.0)
  (ai_vehicle_enterable_team drop_hog human)
  (ai_go_to_vehicle unsc_marines_lz drop_hog "W-gunner")
  (ai_follow_target_players unsc_marines_lz)
  (set pelican_hog_dropped true)
  (sleep 90)
  (vehicle_hover pelican_drop false)
  (object_set_collideable pelican_drop false)
  (recording_play_and_delete pelican_drop pelican_fly_out)
)

(script startup init_pelican_hog_delivery
  (print "Pelican Warthog & Marine Resupply inbound!")
  (setup_pelican_with_warthog)
)
`,
  },
  {
    id: 'pelican_troop_drop',
    title: 'Flying Pelican WITHOUT Warthog (Marine AI Squad Insertion & Fly-Away)',
    category: 'dropships',
    summary:
      'Spawns a flying Pelican, loads an AI-controlled UNSC Marine squad into the troop bay ("rider"), flies down with S-turns to hover low over the LZ, unloads the Marines to follow & fight alongside the player, and flies away to despawn.',
    requiredSetupGuide: [
      '1. Ensure "vehicles\\pelican\\pelican" is in the Vehicle Palette and a Marine actor_variant is in the map.',
      '2. Click "Compile into Scenario (In-Memory)" — it automatically configures "pelican_troop", AI encounter "unsc_marines_lz", and flight recordings "pelican_fly_100m" / "pelican_fly_out".',
      '3. Press Ctrl+S to save the map.',
    ],
    requiredObjectNames: ['pelican_troop'],
    requiredTriggerVolumes: ['trig_pelican_lz'],
    requiredCameraPoints: [],
    hscSource: `; ============================================================================
; Sample 2: Flying Pelican WITHOUT Warthog (AI Marine Squad Insertion & Fly-Away)
; Flies Pelican down with banked turns to low hover at the LZ, deploys active
; AI Marines ("rider") with ai_follow_target_players, and flies away to despawn.
; ============================================================================

(global boolean troop_pelican_deployed false)

(script startup pelican_troop_insertion
  (ai true)
  (ai_allegiance player human)
  (ai_allegiance human player)
  (ai_allegiance default human)
  (ai_allegiance human default)
  (ai_allegiance default player)
  (ai_allegiance player default)
  (object_create_anew pelican_troop)
  (ai_place unsc_marines_lz)
  (ai_braindead unsc_marines_lz true)
  (sleep 1)
  (vehicle_load_magic pelican_troop "rider" (ai_actors unsc_marines_lz))
  (recording_play_and_hover pelican_troop pelican_fly_100m)
  (print "Pelican Troop Transport descending to LZ!")
  (sleep (max 0 (- (recording_time pelican_troop) 15)))
  (print "Pelican at low hover — deploying UNSC Marine AI Squad!")
  (ai_braindead unsc_marines_lz false)
  (vehicle_unload pelican_troop "rider")
  (vehicle_unload pelican_troop "")
  (ai_force_active unsc_marines_lz true)
  (ai_follow_target_players unsc_marines_lz)
  (sleep 90)
  (vehicle_hover pelican_troop false)
  (object_set_collideable pelican_troop false)
  (recording_play_and_delete pelican_troop pelican_fly_out)
  (sleep 210)
  (object_destroy pelican_troop)
  (set troop_pelican_deployed true)
)
`,
  },
  {
    id: 'c_dropship_delivery',
    title: 'Covenant Spirit Dropship (c_dropship) Smooth Wraith + Staggered Elite Drop (Bungie a30/b40 Pattern)',
    category: 'dropships',
    summary:
      'Authentic Bungie a30/b40 Covenant Spirit Dropship: closes bay doors on spawn, attaches a Wraith via unit_enter_vehicle ("cargo_wraith"), keeps passengers braindead during flight, opens doors 60 ticks before hover, releases Wraith cleanly via unit_exit_vehicle with ai_vehicle_encounter + ai_follow_target_players, stagger-unloads all 8 seats via begin_random, closes doors, and flies out.',
    requiredSetupGuide: [
      '1. Ensure "vehicles\\c_dropship\\c_dropship", "vehicles\\wraith\\wraith", and Elite/Grunt actor_variants are in the map.',
      '2. Click "Compile into Scenario (In-Memory)" to auto-configure "cov_dropship", "cov_wraith_1", AI encounters, and flight paths.',
      '3. Save the map (Ctrl+S).',
    ],
    requiredObjectNames: ['cov_dropship', 'cov_wraith_1'],
    requiredTriggerVolumes: ['trig_cov_drop'],
    requiredCameraPoints: [],
    hscSource: `; ============================================================================
; Sample 3: Authentic Bungie Covenant Spirit Dropship (c_dropship) Delivery
; - Closes bay doors on spawn (unit_close), opens 60 ticks before hover (unit_open)
; - Attaches Wraith via (unit_enter_vehicle cov_wraith_1 cov_dropship "cargo_wraith")
;   and drops it straight down via (unit_exit_vehicle cov_wraith_1)
; - Activates Wraith AI combat brain via (ai_vehicle_encounter ...) + (ai_follow_target_players ...)
; - Stagger-unloads all 8 passenger seats using (begin_random ... (sleep 5))
; ============================================================================

(global boolean cov_dropship_active false)

(script static void deploy_covenant_dropship
  (ai true)
  (ai_allegiance player human)
  (ai_allegiance human player)
  (ai_allegiance default human)
  (ai_allegiance human default)
  (ai_allegiance default player)
  (ai_allegiance player default)
  (ai_allegiance_remove human covenant)
  (ai_allegiance_remove player covenant)
  (ai_allegiance_remove default covenant)
  (ai_allegiance_remove covenant default)
  (object_create_anew cov_dropship)
  (unit_close cov_dropship)
  (object_create_anew cov_wraith_1)
  (ai_place cov_wraith_crew_1)
  (ai_place cov_elites_lz)
  (ai_braindead cov_elites_lz true)
  (ai_disregard (ai_actors cov_elites_lz) true)
  (sleep 1)
  ; Seat AI pilot in Wraith, bind ai_vehicle_encounter, and clamp Wraith to Spirit belly
  (vehicle_load_magic cov_wraith_1 "wraith-driver" (ai_actors cov_wraith_crew_1))
  (ai_vehicle_encounter cov_wraith_1 cov_wraith_crew_1)
  (unit_enter_vehicle cov_wraith_1 cov_dropship "cargo_wraith")
  (vehicle_load_magic cov_dropship "passenger" (ai_actors cov_elites_lz))
  (recording_play_and_hover cov_dropship dropship_fly_100m)
  (print "Covenant Spirit Dropship inbound with Wraith & Elite squad!")
  (sleep (max 0 (- (recording_time cov_dropship) 60)))
  (unit_open cov_dropship)
  (sleep 30)
  ; Smoothly release Wraith from belly clamp (no sideways launch!)
  (unit_exit_vehicle cov_wraith_1)
  (ai_force_active cov_wraith_crew_1 true)
  (ai_magically_see_players cov_wraith_crew_1)
  (ai_follow_target_players cov_wraith_crew_1)
  (sleep 30)
  ; Wake infantry AI and stagger-unload all 8 CD-passenger seats
  (ai_braindead cov_elites_lz false)
  (ai_disregard (ai_actors cov_elites_lz) false)
  (begin_random
    (begin (vehicle_unload cov_dropship "cd-passengerl01") (sleep 5))
    (begin (vehicle_unload cov_dropship "cd-passengerl02") (sleep 5))
    (begin (vehicle_unload cov_dropship "cd-passengerl03") (sleep 5))
    (begin (vehicle_unload cov_dropship "cd-passengerl04") (sleep 5))
    (begin (vehicle_unload cov_dropship "cd-passengerr01") (sleep 5))
    (begin (vehicle_unload cov_dropship "cd-passengerr02") (sleep 5))
    (begin (vehicle_unload cov_dropship "cd-passengerr03") (sleep 5))
    (begin (vehicle_unload cov_dropship "cd-passengerr04") (sleep 5))
  )
  (vehicle_unload cov_dropship "")
  (ai_force_active cov_elites_lz true)
  (ai_magically_see_players cov_elites_lz)
  (ai_follow_target_players cov_elites_lz)
  (ai_attack cov_elites_lz)
  (sleep 90)
  (unit_close cov_dropship)
  (vehicle_hover cov_dropship false)
  (object_set_collideable cov_dropship false)
  (recording_play_and_delete cov_dropship dropship_fly_out)
  (sleep 210)
  (object_destroy cov_dropship)
)

(script startup init_c_dropship_event
  (sleep 30)
  (deploy_covenant_dropship)
  (set cov_dropship_active true)
)
`,
  },
  {
    id: 'bungie_multi_wave_defense_turrets',
    title: 'Multi-Stage Trigger Defense, Squad Migration (ai_migrate) & Auto-Board Turrets',
    category: 'ai_npcs',
    summary:
      'Modeled after Bungie a50.hsc & b40.hsc: sets up Shade turrets with ai_vehicle_enterable_distance so Grunts automatically mount them, spawns Wave 1 when the player enters a trigger volume, migrates surviving AI to a fallback encounter via ai_migrate when depleted, and deploys a Ghost/Wraith reinforcement wave.',
    requiredSetupGuide: [
      '1. Import Elite/Grunt actor_variants and a turret/Ghost vehicle into the map.',
      '2. Click "Compile into Scenario (In-Memory)" to auto-create encounters "cov_outpost", "cov_bunker", and trigger "trig_outer_perimeter".',
      '3. Save the map (Ctrl+S).',
    ],
    requiredObjectNames: ['cov_turret_1', 'cov_ghost_1'],
    requiredTriggerVolumes: ['trig_outer_perimeter'],
    requiredCameraPoints: [],
    hscSource: `; ============================================================================
; Sample 4: Bungie Multi-Wave Defense, Squad Migration (ai_migrate) & Smart Turrets
; ============================================================================

(global short defense_wave 0)

(script static void setup_smart_turrets
  (object_create_anew cov_turret_1)
  (ai_vehicle_enterable_distance cov_turret_1 18.0)
  (ai_vehicle_enterable_team cov_turret_1 covenant)
)

(script startup run_perimeter_defense
  (ai true)
  (ai_allegiance player human)
  (ai_allegiance human player)
  (setup_smart_turrets)
  (sleep_until (volume_test_objects trig_outer_perimeter (players)) 15)
  (print "Perimeter breached — spawning Wave 1 forward outpost!")
  (set defense_wave 1)
  (ai_place cov_outpost/grunts)
  (ai_place cov_outpost/elites)
  (ai_go_to_vehicle cov_outpost/grunts cov_turret_1 "gunner")
  (ai_magically_see_players cov_outpost)
  ; When forward squad drops to <= 2 survivors, migrate them to fallback bunker!
  (sleep_until (<= (ai_living_count cov_outpost) 2) 30 1800)
  (print "Forward squad retreating — migrating survivors to cov_bunker & spawning Ghost!")
  (ai_migrate cov_outpost cov_bunker)
  (ai_defend cov_bunker)
  (set defense_wave 2)
  (ai_place cov_bunker/elites)
  (object_create_anew cov_ghost_1)
  (ai_place cov_bunker/ghost_pilot)
  (sleep 2)
  (vehicle_load_magic cov_ghost_1 "G-driver" (ai_actors cov_bunker/ghost_pilot))
  (ai_vehicle_encounter cov_ghost_1 cov_bunker/ghost_pilot)
  (ai_follow_target_players cov_bunker/ghost_pilot)
  (ai_magically_see_players cov_bunker)
)
`,
  },
  {
    id: 'npc_ai_battle',
    title: 'SP / MP NPC Characters & AI Squad Respawn Battle',
    category: 'ai_npcs',
    summary:
      'Sets up human Marine allies and hostile Covenant NPCs on any Singleplayer or Multiplayer map, links human allegiance to the player with ai_follow_target_players, and automatically respawns NPC waves when defeated.',
    requiredSetupGuide: [
      '1. Import Marine and Elite/Grunt bipeds + actor_variants into your map (use Tag Injector or Import Manager).',
      '2. Click "Compile into Scenario (In-Memory)" and save (Ctrl+S).',
    ],
    requiredObjectNames: ['npc_marine_1', 'npc_marine_2', 'npc_elite_1', 'npc_elite_2'],
    requiredTriggerVolumes: [],
    requiredCameraPoints: [],
    hscSource: `; ============================================================================
; Sample 5: SP & MP NPC Characters & AI Squad Wave Manager
; Configures team allegiances so Marines fight alongside players against
; Covenant NPCs, and respawns AI encounter waves when wiped out.
; ============================================================================

(global short ai_wave_number 1)

(script startup setup_npc_allegiances
  (ai true)
  (ai_allegiance player human)
  (ai_allegiance human player)
  (ai_place unsc_marines_1)
  (ai_place cov_elites_1)
  (ai_follow_target_players unsc_marines_1)
  (ai_magically_see_encounter unsc_marines_1 cov_elites_1)
  (ai_magically_see_encounter cov_elites_1 unsc_marines_1)
  (ai_magically_see_players cov_elites_1)
  (print "NPC AI Squads initialized: UNSC Marines allied with Player!")
)

(script continuous respawn_npc_waves
  (sleep 300)
  (if (<= (ai_living_count cov_elites_1) 0)
    (begin
      (ai_place cov_elites_1)
      (ai_magically_see_players cov_elites_1)
      (ai_follow_target_players cov_elites_1)
      (set ai_wave_number (+ ai_wave_number 1))
      (print "Covenant reinforcement wave spawned!")
    )
  )
  (if (<= (ai_living_count unsc_marines_1) 0)
    (begin
      (ai_place unsc_marines_1)
      (ai_follow_target_players unsc_marines_1)
    )
  )
)
`,
  },
  {
    id: 'cinematic_cutscene',
    title: 'Skippable Cinematic Cutscene & Multi-Camera Flythrough (Bungie Pattern)',
    category: 'cutscenes',
    summary:
      'Plays a letterboxed intro cutscene using Bungie cinematic_skip_start / camera_set across three cutscene camera points (cam_intro_1 -> cam_intro_2 -> cam_intro_3), displays a chapter title, and returns control to the player.',
    requiredSetupGuide: [
      '1. Click "Auto-Setup Scenario Entities" or "Compile into Scenario (In-Memory)" to create cutscene camera points "cam_intro_1", "cam_intro_2", and "cam_intro_3".',
      '2. Position the camera frustums in the 3D Viewport or 3D Script Builder.',
      '3. Press Ctrl+S to save the map.',
    ],
    requiredObjectNames: [],
    requiredTriggerVolumes: [],
    requiredCameraPoints: ['cam_intro_1', 'cam_intro_2', 'cam_intro_3'],
    hscSource: `; ============================================================================
; Sample 6: Skippable Cinematic Cutscene & Smooth Camera Flythrough
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
    title: 'Trigger Volume Ambush, Automatic Base Doors & 3D HUD Navpoint',
    category: 'triggers',
    summary:
      'Places a 3D HUD Navpoint on the base entry flag, monitors trigger volume (trig_base_entry), and automatically powers & opens a device machine door while waking a defense encounter when any player walks inside.',
    requiredSetupGuide: [
      '1. Click "Compile into Scenario (In-Memory)" to register trigger volume "trig_base_entry", cutscene flag "flag_base_entry", and object name "door_main".',
      '2. Position the trigger volume in the 3D Viewport or 3D Script Builder.',
      '3. Save (Ctrl+S).',
    ],
    requiredObjectNames: ['door_main'],
    requiredTriggerVolumes: ['trig_base_entry'],
    requiredCameraPoints: [],
    hscSource: `; ============================================================================
; Sample 7: Trigger Volume Ambush, Automatic Doors & 3D HUD Navpoint
; ============================================================================

(global boolean base_breached false)

(script startup init_base_door_navpoint
  (device_set_power door_main 0.0)
  (device_set_position door_main 0.0)
  (activate_team_nav_point_flag default_red player flag_base_entry 0.55)
)

(script continuous monitor_base_entry_trigger
  (sleep_until (volume_test_objects trig_base_entry (players)) 15)
  (if (= base_breached false)
    (begin
      (set base_breached true)
      (deactivate_team_nav_point_flag player flag_base_entry)
      (print "ALERT: Perimeter trigger volume breached! Opening blast doors.")
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
      '1. Click "Compile into Scenario (In-Memory)" to register object names "mp_hog_1" and "mp_banshee_1".',
      '2. Save (Ctrl+S).',
    ],
    requiredObjectNames: ['mp_hog_1', 'mp_banshee_1'],
    requiredTriggerVolumes: ['trig_low_grav'],
    requiredCameraPoints: [],
    hscSource: `; ============================================================================
; Sample 8: MP Utility — Vehicle Auto-Reset & Environment Helpers
; ============================================================================

(global short vehicle_reset_ticks 1800)

(script static void reset_named_vehicles
  (object_create_anew mp_hog_1)
  (object_create_anew mp_banshee_1)
  (print "Named vehicles reset to base spawn points.")
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
  {
    id: 'pelican_vs_dropship_100m_battle',
    title: '4 Pelicans vs 4 Covenant Dropships (Bungie Smooth Vehicle Drops, Staggered Unload & Active Vehicle AI)',
    category: 'dropships',
    summary:
      'Full-scale airborne assault using Bungie b30/b40 patterns: 4 UNSC Pelicans (2 carrying Scorpion tanks via unit_enter_vehicle, 2 carrying AI Marines) descend from the West while 4 Covenant Spirit Dropships (2 carrying Wraiths on "cargo_wraith", 2 carrying AI Elites/Grunts) descend from the East. Both fleets release armor cleanly via unit_exit_vehicle, bind ai_vehicle_encounter + ai_follow_target_players, stagger-unload troops via begin_random, and fly away!',
    requiredSetupGuide: [
      '1. Ensure your map has Pelican ("vehicles\\pelican\\pelican"), Spirit Dropship ("vehicles\\c_dropship\\c_dropship"), Scorpion ("vehicles\\scorpion\\scorpion_mp"), Wraith ("vehicles\\wraith\\wraith"), plus Marine and Elite/Grunt actor_variants.',
      '2. Click "Compile into Scenario (In-Memory)" — the compiler automatically creates & repairs all vehicle Object Names, approach & departure flight animations, and AI Encounters!',
      '3. Press Ctrl+S to save the map and load it in Halo CE / OpenCE.',
    ],
    requiredObjectNames: [
      'pelican_tank_1',
      'pelican_tank_2',
      'pelican_marines_1',
      'pelican_marines_2',
      'unsc_tank_1',
      'unsc_tank_2',
      'dropship_wraith_1',
      'dropship_wraith_2',
      'dropship_elites_1',
      'dropship_elites_2',
      'cov_wraith_1',
      'cov_wraith_2',
    ],
    requiredTriggerVolumes: ['trig_battle_start'],
    requiredCameraPoints: [],
    hscSource: `; ============================================================================
; Sample 9: 4 UNSC Pelicans vs 4 Covenant Dropships — Bungie Smooth Drop & AI Battle
; - Attaches Scorpion Tanks ("cargo") & Wraiths ("cargo_wraith") via unit_enter_vehicle
; - Releases vehicles straight down via unit_exit_vehicle (no sideways launch!)
; - Activates vehicle AI brains via ai_vehicle_encounter + ai_follow_target_players
; - Closes Spirit bay doors on spawn, opens before hover, and stagger-unloads
;   passengers via begin_random before closing doors and flying out!
; ============================================================================

(global short flight_ticks_100m 215)
(global short door_open_delay_ticks 30)
(global short hover_after_drop_ticks 90)
(global short fly_out_ticks 210)
(global boolean air_assault_launched false)

(script static void configure_battle_allegiances
  (ai true)
  (ai_allegiance player human)
  (ai_allegiance human player)
  (ai_allegiance_remove human covenant)
  (ai_allegiance_remove covenant human)
  (ai_allegiance_remove player covenant)
  (ai_allegiance_remove covenant player)
)

(script static void spawn_and_load_unsc_fleet
  (object_create_anew pelican_tank_1)
  (object_create_anew pelican_tank_2)
  (object_create_anew pelican_marines_1)
  (object_create_anew pelican_marines_2)
  (object_create_anew unsc_tank_1)
  (object_create_anew unsc_tank_2)
  (ai_place unsc_tank_crew_1)
  (ai_place unsc_tank_crew_2)
  (ai_place unsc_marines_1)
  (ai_place unsc_marines_2)
  (ai_braindead unsc_marines_1 true)
  (ai_braindead unsc_marines_2 true)
  (sleep 2)
  ; Seat AI drivers in Scorpions, bind vehicle encounter brains, and clamp to Pelicans
  (vehicle_load_magic unsc_tank_1 "scorpion-driver" (ai_actors unsc_tank_crew_1))
  (vehicle_load_magic unsc_tank_2 "scorpion-driver" (ai_actors unsc_tank_crew_2))
  (ai_vehicle_encounter unsc_tank_1 unsc_tank_crew_1)
  (ai_vehicle_encounter unsc_tank_2 unsc_tank_crew_2)
  (unit_enter_vehicle unsc_tank_1 pelican_tank_1 "cargo")
  (unit_enter_vehicle unsc_tank_2 pelican_tank_2 "cargo")
  ; Load AI Marine squads into Pelicans 3 & 4 troop bay ("rider")
  (vehicle_load_magic pelican_marines_1 "rider" (ai_actors unsc_marines_1))
  (vehicle_load_magic pelican_marines_2 "rider" (ai_actors unsc_marines_2))
)

(script static void spawn_and_load_covenant_fleet
  (object_create_anew dropship_wraith_1)
  (object_create_anew dropship_wraith_2)
  (object_create_anew dropship_elites_1)
  (object_create_anew dropship_elites_2)
  ; Keep Covenant Spirit Dropship side troop doors closed during approach flight
  (unit_close dropship_wraith_1)
  (unit_close dropship_wraith_2)
  (unit_close dropship_elites_1)
  (unit_close dropship_elites_2)
  (object_create_anew cov_wraith_1)
  (object_create_anew cov_wraith_2)
  (ai_place cov_wraith_crew_1)
  (ai_place cov_wraith_crew_2)
  (ai_place cov_elites_1)
  (ai_place cov_elites_2)
  (ai_braindead cov_elites_1 true)
  (ai_braindead cov_elites_2 true)
  (ai_disregard (ai_actors cov_elites_1) true)
  (ai_disregard (ai_actors cov_elites_2) true)
  (sleep 2)
  ; Seat AI pilots in Wraiths, bind vehicle encounter brains, and clamp to Spirit belly
  (vehicle_load_magic cov_wraith_1 "wraith-driver" (ai_actors cov_wraith_crew_1))
  (vehicle_load_magic cov_wraith_2 "wraith-driver" (ai_actors cov_wraith_crew_2))
  (ai_vehicle_encounter cov_wraith_1 cov_wraith_crew_1)
  (ai_vehicle_encounter cov_wraith_2 cov_wraith_crew_2)
  (unit_enter_vehicle cov_wraith_1 dropship_wraith_1 "cargo_wraith")
  (unit_enter_vehicle cov_wraith_2 dropship_wraith_2 "cargo_wraith")
  ; Load AI Elite warriors into Covenant Dropships 3 & 4 ("passenger")
  (vehicle_load_magic dropship_elites_1 "passenger" (ai_actors cov_elites_1))
  (vehicle_load_magic dropship_elites_2 "passenger" (ai_actors cov_elites_2))
)

(script static void execute_100m_air_assault
  (print "AIR ASSAULT: 4 UNSC Pelicans & 4 Covenant Dropships descending to LZ!")
  (recording_play_and_hover pelican_tank_1 pelican_fly_100m)
  (recording_play_and_hover pelican_tank_2 pelican_fly_100m)
  (recording_play_and_hover pelican_marines_1 pelican_fly_100m)
  (recording_play_and_hover pelican_marines_2 pelican_fly_100m)
  (recording_play_and_hover dropship_wraith_1 dropship_fly_100m)
  (recording_play_and_hover dropship_wraith_2 dropship_fly_100m)
  (recording_play_and_hover dropship_elites_1 dropship_fly_100m)
  (recording_play_and_hover dropship_elites_2 dropship_fly_100m)

  (sleep (max 0 (- flight_ticks_100m 45)))
  (unit_open dropship_elites_1)
  (unit_open dropship_elites_2)
  (sleep door_open_delay_ticks)

  (print "LZ REACHED: Releasing Scorpions, Wraiths, UNSC Marines & Covenant Elites!")
  ; Smoothly release Scorpion Tanks & Wraiths downward with unit_exit_vehicle
  (unit_exit_vehicle unsc_tank_1)
  (unit_exit_vehicle unsc_tank_2)
  (unit_exit_vehicle cov_wraith_1)
  (unit_exit_vehicle cov_wraith_2)
  (sleep 20)

  ; Wake and unload UNSC Marine AI squads from Pelicans 3 & 4
  (ai_braindead unsc_marines_1 false)
  (ai_braindead unsc_marines_2 false)
  (vehicle_unload pelican_marines_1 "rider")
  (vehicle_unload pelican_marines_1 "")
  (vehicle_unload pelican_marines_2 "rider")
  (vehicle_unload pelican_marines_2 "")

  ; Wake and stagger-unload Covenant Elite AI squads from Dropships 3 & 4
  (ai_braindead cov_elites_1 false)
  (ai_braindead cov_elites_2 false)
  (ai_disregard (ai_actors cov_elites_1) false)
  (ai_disregard (ai_actors cov_elites_2) false)
  (begin_random
    (begin (vehicle_unload dropship_elites_1 "cd-passengerl01") (vehicle_unload dropship_elites_2 "cd-passengerl01") (sleep 5))
    (begin (vehicle_unload dropship_elites_1 "cd-passengerl02") (vehicle_unload dropship_elites_2 "cd-passengerl02") (sleep 5))
    (begin (vehicle_unload dropship_elites_1 "cd-passengerl03") (vehicle_unload dropship_elites_2 "cd-passengerl03") (sleep 5))
    (begin (vehicle_unload dropship_elites_1 "cd-passengerl04") (vehicle_unload dropship_elites_2 "cd-passengerl04") (sleep 5))
    (begin (vehicle_unload dropship_elites_1 "cd-passengerr01") (vehicle_unload dropship_elites_2 "cd-passengerr01") (sleep 5))
    (begin (vehicle_unload dropship_elites_1 "cd-passengerr02") (vehicle_unload dropship_elites_2 "cd-passengerr02") (sleep 5))
    (begin (vehicle_unload dropship_elites_1 "cd-passengerr03") (vehicle_unload dropship_elites_2 "cd-passengerr03") (sleep 5))
    (begin (vehicle_unload dropship_elites_1 "cd-passengerr04") (vehicle_unload dropship_elites_2 "cd-passengerr04") (sleep 5))
  )
  (vehicle_unload dropship_elites_1 "")
  (vehicle_unload dropship_elites_2 "")

  ; Activate AI combat & vehicle pursuit brains across all squads, tanks, wraiths & player
  (ai_force_active unsc_marines_1 true)
  (ai_force_active unsc_marines_2 true)
  (ai_force_active unsc_tank_crew_1 true)
  (ai_force_active unsc_tank_crew_2 true)
  (ai_force_active cov_elites_1 true)
  (ai_force_active cov_elites_2 true)
  (ai_force_active cov_wraith_crew_1 true)
  (ai_force_active cov_wraith_crew_2 true)
  (ai_follow_target_players unsc_marines_1)
  (ai_follow_target_players unsc_marines_2)
  (ai_follow_target_players cov_wraith_crew_1)
  (ai_follow_target_players cov_wraith_crew_2)
  (ai_magically_see_encounter unsc_marines_1 cov_elites_1)
  (ai_magically_see_encounter unsc_marines_2 cov_elites_2)
  (ai_magically_see_encounter unsc_tank_crew_1 cov_wraith_crew_1)
  (ai_magically_see_encounter unsc_tank_crew_2 cov_wraith_crew_2)
  (ai_magically_see_encounter cov_elites_1 unsc_marines_1)
  (ai_magically_see_encounter cov_elites_2 unsc_marines_2)
  (ai_magically_see_encounter cov_wraith_crew_1 unsc_tank_crew_1)
  (ai_magically_see_encounter cov_wraith_crew_2 unsc_tank_crew_2)
  (ai_magically_see_players cov_elites_1)
  (ai_magically_see_players cov_elites_2)
  (ai_magically_see_players cov_wraith_crew_1)
  (ai_magically_see_players cov_wraith_crew_2)
  (ai_attack unsc_marines_1)
  (ai_attack unsc_marines_2)
  (ai_attack unsc_tank_crew_1)
  (ai_attack unsc_tank_crew_2)
  (ai_attack cov_elites_1)
  (ai_attack cov_elites_2)
  (ai_attack cov_wraith_crew_1)
  (ai_attack cov_wraith_crew_2)

  ; Close troop doors, fly all 8 dropships up and away, and despawn them!
  (sleep hover_after_drop_ticks)
  (unit_close dropship_elites_1)
  (unit_close dropship_elites_2)
  (print "Dropships departing LZ and despawning!")
  (vehicle_hover pelican_tank_1 false)
  (vehicle_hover pelican_tank_2 false)
  (vehicle_hover pelican_marines_1 false)
  (vehicle_hover pelican_marines_2 false)
  (vehicle_hover dropship_wraith_1 false)
  (vehicle_hover dropship_wraith_2 false)
  (vehicle_hover dropship_elites_1 false)
  (vehicle_hover dropship_elites_2 false)
  (object_set_collideable pelican_tank_1 false)
  (object_set_collideable pelican_tank_2 false)
  (object_set_collideable pelican_marines_1 false)
  (object_set_collideable pelican_marines_2 false)
  (object_set_collideable dropship_wraith_1 false)
  (object_set_collideable dropship_wraith_2 false)
  (object_set_collideable dropship_elites_1 false)
  (object_set_collideable dropship_elites_2 false)
  (recording_play_and_delete pelican_tank_1 pelican_fly_out)
  (recording_play_and_delete pelican_tank_2 pelican_fly_out)
  (recording_play_and_delete pelican_marines_1 pelican_fly_out)
  (recording_play_and_delete pelican_marines_2 pelican_fly_out)
  (recording_play_and_delete dropship_wraith_1 dropship_fly_out)
  (recording_play_and_delete dropship_wraith_2 dropship_fly_out)
  (recording_play_and_delete dropship_elites_1 dropship_fly_out)
  (recording_play_and_delete dropship_elites_2 dropship_fly_out)
  (sleep fly_out_ticks)
  (object_destroy pelican_tank_1)
  (object_destroy pelican_tank_2)
  (object_destroy pelican_marines_1)
  (object_destroy pelican_marines_2)
  (object_destroy dropship_wraith_1)
  (object_destroy dropship_wraith_2)
  (object_destroy dropship_elites_1)
  (object_destroy dropship_elites_2)
)

(script startup init_pelican_vs_dropship_battle
  (configure_battle_allegiances)
  (spawn_and_load_unsc_fleet)
  (spawn_and_load_covenant_fleet)
  (sleep 30)
  (execute_100m_air_assault)
  (set air_assault_launched true)
)

; Continuous combat manager: keeps NPCs fighting and respawns waves if wiped out
(script continuous keep_lz_battle_active
  (sleep 300)
  (if (= air_assault_launched true)
    (begin
      (if (<= (+ (ai_living_count unsc_marines_1) (ai_living_count unsc_marines_2)) 0)
        (begin
          (ai_place unsc_marines_1)
          (ai_place unsc_marines_2)
          (ai_follow_target_players unsc_marines_1)
          (ai_follow_target_players unsc_marines_2)
          (ai_magically_see_encounter unsc_marines_1 cov_elites_1)
          (ai_magically_see_encounter unsc_marines_2 cov_elites_2)
          (ai_attack unsc_marines_1)
          (ai_attack unsc_marines_2)
        )
      )
      (if (<= (+ (ai_living_count cov_elites_1) (ai_living_count cov_elites_2)) 0)
        (begin
          (ai_place cov_elites_1)
          (ai_place cov_elites_2)
          (ai_magically_see_encounter cov_elites_1 unsc_marines_1)
          (ai_magically_see_encounter cov_elites_2 unsc_marines_2)
          (ai_magically_see_players cov_elites_1)
          (ai_magically_see_players cov_elites_2)
          (ai_attack cov_elites_1)
          (ai_attack cov_elites_2)
        )
      )
    )
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
      commandLists: [],
      deviceGroups: [],
      cutsceneTitles: [],
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
    commandLists: readReflexiveNames('command lists', 0, 32),
    deviceGroups: readReflexiveNames('device groups', 0, 32),
    cutsceneTitles: readReflexiveNames('cutscene titles', 4, 32),
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
      if (strVal !== null && (valType === 9 || strVal.length > 0)) {
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
        case 12:
          return scenarioEntities.cutsceneFlags[dataRaw & 0xffff] ?? `flag_${dataRaw & 0xffff}`;
        case 13:
          return scenarioEntities.cutsceneCameraPoints[dataRaw & 0xffff] ?? `cam_${dataRaw & 0xffff}`;
        case 14:
          return scenarioEntities.cutsceneTitles?.[dataRaw & 0xffff] ?? `title_${dataRaw & 0xffff}`;
        case 15:
          return scenarioEntities.recordedAnimations[dataRaw & 0xffff] ?? `anim_${dataRaw & 0xffff}`;
        case 16:
          return scenarioEntities.deviceGroups?.[dataRaw & 0xffff] ?? `device_group_${dataRaw & 0xffff}`;
        case 17: {
          const encIdx = dataRaw & 0xffff;
          const encName = scenarioEntities.encounters[encIdx] ?? `enc_${encIdx}`;
          if ((dataRaw & 0x80000000) !== 0) {
            const sqIdx = (dataRaw >>> 16) & 0x3fff;
            return `${encName}/squad_${sqIdx}`;
          }
          if ((dataRaw & 0x40000000) !== 0) {
            const plIdx = (dataRaw >>> 16) & 0x3fff;
            return `${encName}/platoon_${plIdx}`;
          }
          return encName;
        }
        case 18:
          return scenarioEntities.commandLists?.[dataRaw & 0xffff] ?? `cmd_${dataRaw & 0xffff}`;
        case 32: {
          const diffs = ['easy', 'normal', 'hard', 'impossible'];
          return diffs[dataRaw & 0xffff] ?? 'normal';
        }
        case 33: {
          const teamNames = ['default', 'player', 'human', 'covenant', 'flood', 'sentinel', 'unused6', 'unused7', 'unused8', 'unused9'];
          return teamNames[dataRaw & 0xffff] ?? 'default';
        }
        case 34: {
          const states = ['none', 'sleeping', 'alert', 'moving_repeat_same_position', 'moving_loop', 'moving_loop_back_and_forth', 'moving_loop_randomly', 'moving_randomly', 'guarding', 'guarding_at_guard_position', 'searching', 'fleeing'];
          return states[dataRaw & 0xffff] ?? 'alert';
        }
        case 35: {
          const actors = ['elite', 'jackal', 'grunt', 'hunter', 'engineer', 'assassin', 'player', 'marine', 'crew', 'combat_form', 'infection_form', 'carrier_form', 'monitor', 'sentinel', 'none', 'mounted_weapon'];
          return actors[dataRaw & 0xffff] ?? 'marine';
        }
        case 36: {
          const corners = ['top_left', 'top_right', 'bottom_left', 'bottom_right', 'center'];
          return corners[dataRaw & 0xffff] ?? 'top_left';
        }
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

  // Emit Structure BSP & Trigger Volume documentation comments when multi-BSP or BSP trigger scripts exist
  const bspsField = decoded.get('structure bsps');
  const bspCount = bspsField?.kind === 'reflexive' ? bspsField.value.count : 0;
  const hasBspScripts = sortedScripts.some((s) => /bsp/i.test(s.name)) || scenarioEntities.triggerVolumes.some((t) => /bsp/i.test(t));
  if (bspCount > 1 || hasBspScripts) {
    lines.push('; --- Structure BSP & Zone Transition Overview ---');
    if (bspCount > 1 && bspsField?.kind === 'reflexive') {
      lines.push(`; This scenario contains ${bspCount} separate Structure BSP zones.`);
      lines.push('; NOTE: Halo CE renders 1 active Structure BSP slot at a time when BSPs are kept separate.');
      lines.push(';       (To keep ALL BSP zones active at once for Multiplayer, use "Merge BSPs into 1 Combined BSP" in BSP Swapper.)');
      for (let b = 0; b < bspCount; b++) {
        const bspAt = resolvePointer((bspsField.value.pointerLow + b * 32) >>> 0, header.tagDataOffset, tagIndex.baseMemoryAddress);
        let bspPath = `bsp_${b}`;
        if (isRangeInBuffer(bspAt, 32, view.length)) {
          const bTagId = view.readUInt32LE(bspAt + 28);
          const bEntry = tagIndex.entries[bTagId & 0xffff];
          if (bEntry?.path) bspPath = bEntry.path;
        }
        lines.push(`;   - BSP #${b}: ${bspPath}  (console command: switch_bsp ${b} or activate_bsp_${b})`);
      }
    } else {
      lines.push('; All selected Structure BSP zones are merged into a single combined BSP (BSP #0) so all areas remain active simultaneously.');
    }

    const trigField = decoded.get('trigger volumes');
    if (trigField?.kind === 'reflexive' && trigField.value.count > 0) {
      lines.push(';');
      lines.push('; --- BSP Swap Trigger Volumes (Editable & Resizable in 3D Viewport -> Triggers Layer) ---');
      for (let t = 0; t < trigField.value.count; t++) {
        const tAt = resolvePointer((trigField.value.pointerLow + t * 96) >>> 0, header.tagDataOffset, tagIndex.baseMemoryAddress);
        const tName = scenarioEntities.triggerVolumes[t] ?? `trigger_${t}`;
        if (isRangeInBuffer(tAt, 96, view.length)) {
          const x = view.readFloatLE(tAt + 72).toFixed(2);
          const y = view.readFloatLE(tAt + 76).toFixed(2);
          const z = view.readFloatLE(tAt + 80).toFixed(2);
          const dx = view.readFloatLE(tAt + 84).toFixed(2);
          const dy = view.readFloatLE(tAt + 88).toFixed(2);
          const dz = view.readFloatLE(tAt + 92).toFixed(2);
          const m = /^trig_bsp_(\d+)_to_(\d+)$/i.exec(tName);
          const desc = m
            ? `Directional Transition Zone: switches active BSP from #${m[1]} -> #${m[2]} when entered`
            : `Trigger Volume #${t}`;
          lines.push(`;   [${tName}] Pos=(${x}, ${y}, ${z}) Size=(${dx} x ${dy} x ${dz}) — ${desc}`);
        }
      }
    }
    lines.push('');
  }

  // Emit Cutscene Flag coordinates as `; @waypoint <name> x,y,z,yaw` so the 3D Script Builder can restore saved waypoints
  const flagCoordsByName = new Map<string, { x: number; y: number; z: number; yaw: number }>();
  const flagsField = decoded.get('cutscene flags');
  if (flagsField?.kind === 'reflexive' && flagsField.value.count > 0) {
    lines.push('; --- Scenario Cutscene Flags / 3D Script Waypoints ---');
    for (let f = 0; f < flagsField.value.count; f++) {
      const fAt = resolvePointer(
        (flagsField.value.pointerLow + f * 92) >>> 0,
        header.tagDataOffset,
        tagIndex.baseMemoryAddress,
      );
      const fName = scenarioEntities.cutsceneFlags[f];
      if (fName && isRangeInBuffer(fAt, 92, view.length)) {
        const fxNum = view.readFloatLE(fAt + 36);
        const fyNum = view.readFloatLE(fAt + 40);
        const fzNum = view.readFloatLE(fAt + 44);
        const fyawNum = view.readFloatLE(fAt + 48);
        flagCoordsByName.set(fName, { x: fxNum, y: fyNum, z: fzNum, yaw: fyawNum });
        lines.push(`; @waypoint ${fName} ${fxNum.toFixed(2)},${fyNum.toFixed(2)},${fzNum.toFixed(2)},${fyawNum.toFixed(2)}`);
      }
    }
    lines.push('');
  }

  // Emit Cutscene Camera Point coordinates as `; @camera_pos <name> x,y,z,yaw,pitch`
  const camsField = decoded.get('cutscene camera points');
  if (camsField?.kind === 'reflexive' && camsField.value.count > 0) {
    lines.push('; --- Scenario Cutscene Camera Points ---');
    for (let c = 0; c < camsField.value.count; c++) {
      const cAt = resolvePointer(
        (camsField.value.pointerLow + c * 104) >>> 0,
        header.tagDataOffset,
        tagIndex.baseMemoryAddress,
      );
      const cName = scenarioEntities.cutsceneCameraPoints[c];
      if (cName && isRangeInBuffer(cAt, 104, view.length)) {
        const cx = view.readFloatLE(cAt + 40).toFixed(2);
        const cy = view.readFloatLE(cAt + 44).toFixed(2);
        const cz = view.readFloatLE(cAt + 48).toFixed(2);
        const cyaw = view.readFloatLE(cAt + 52).toFixed(2);
        const cpitch = view.readFloatLE(cAt + 56).toFixed(2);
        lines.push(`; @camera_pos ${cName} ${cx},${cy},${cz},${cyaw},${cpitch}`);
      }
    }
    lines.push('');
  }

  // Emit Trigger Volume coordinates as `; @trigger_pos <name> x,y,z,ex,ey,ez`
  const trigsAllField = decoded.get('trigger volumes');
  if (trigsAllField?.kind === 'reflexive' && trigsAllField.value.count > 0) {
    lines.push('; --- Scenario Trigger Volumes ---');
    for (let t = 0; t < trigsAllField.value.count; t++) {
      const tAt = resolvePointer(
        (trigsAllField.value.pointerLow + t * 96) >>> 0,
        header.tagDataOffset,
        tagIndex.baseMemoryAddress,
      );
      const tName = scenarioEntities.triggerVolumes[t];
      if (tName && isRangeInBuffer(tAt, 96, view.length)) {
        const tx = view.readFloatLE(tAt + 72).toFixed(2);
        const ty = view.readFloatLE(tAt + 76).toFixed(2);
        const tz = view.readFloatLE(tAt + 80).toFixed(2);
        const ex = view.readFloatLE(tAt + 84).toFixed(2);
        const ey = view.readFloatLE(tAt + 88).toFixed(2);
        const ez = view.readFloatLE(tAt + 92).toFixed(2);
        lines.push(`; @trigger_pos ${tName} ${tx},${ty},${tz},${ex},${ey},${ez}`);
      }
    }
    lines.push('');
  }

  // Emit AI Command List 3D points as `; @command_list_path <name> x0,y0,z0;x1,y1,z1;...`
  const cmdListsField = decoded.get('command lists');
  if (cmdListsField?.kind === 'reflexive' && cmdListsField.value.count > 0) {
    const cmdLines: string[] = [];
    for (let c = 0; c < cmdListsField.value.count; c++) {
      const cAt = resolvePointer(
        (cmdListsField.value.pointerLow + c * 96) >>> 0,
        header.tagDataOffset,
        tagIndex.baseMemoryAddress,
      );
      const cName = scenarioEntities.commandLists?.[c];
      if (cName && isRangeInBuffer(cAt, 96, view.length)) {
        const ptCount = view.readInt32LE(cAt + 60);
        const ptPtr = view.readUInt32LE(cAt + 64);
        if (ptCount > 0 && ptPtr >= tagIndex.baseMemoryAddress) {
          const ptBase = resolvePointer(ptPtr, header.tagDataOffset, tagIndex.baseMemoryAddress);
          if (isRangeInBuffer(ptBase, ptCount * 20, view.length)) {
            const pts: string[] = [];
            for (let p = 0; p < ptCount; p++) {
              const pOff = ptBase + p * 20;
              const px = view.readFloatLE(pOff + 0).toFixed(2);
              const py = view.readFloatLE(pOff + 4).toFixed(2);
              const pz = view.readFloatLE(pOff + 8).toFixed(2);
              pts.push(`${px},${py},${pz}`);
            }
            if (pts.length > 0) {
              cmdLines.push(`; @command_list_path ${cName} ${pts.join(';')}`);
            }
          }
        }
      }
    }
    if (cmdLines.length > 0) {
      lines.push('; --- Scenario AI Command List 3D Paths ---');
      lines.push(...cmdLines, '');
    }
  }

  // Emit Recorded Animation 3D flight paths as `; @flight_path <name> x0,y0,z0;x1,y1,z1;...`
  const animsField = decoded.get('recorded animations');
  if (animsField?.kind === 'reflexive' && animsField.value.count > 0) {
    const fpLines: string[] = [];
    for (let r = 0; r < animsField.value.count; r++) {
      const rAt = resolvePointer(
        (animsField.value.pointerLow + r * 64) >>> 0,
        header.tagDataOffset,
        tagIndex.baseMemoryAddress,
      );
      const rName = scenarioEntities.recordedAnimations[r];
      if (!rName || !isRangeInBuffer(rAt, 64, view.length)) continue;
      const streamLen = view.readInt32LE(rAt + 44);
      const streamPtr = view.readUInt32LE(rAt + 56);
      if (streamLen < 70 || streamPtr < tagIndex.baseMemoryAddress) continue;
      const streamOff = resolvePointer(streamPtr, header.tagDataOffset, tagIndex.baseMemoryAddress);
      if (!isRangeInBuffer(streamOff, streamLen, view.length)) continue;
      const streamBuf = view.subarray(streamOff, streamOff + streamLen);

      // 1. Check for OpenCE Mantle lossless `'OCWP'` waypoint trailer after `_playback_end`
      const magicIdx = streamBuf.indexOf(Buffer.from('OCWP', 'ascii'), 70);
      if (magicIdx >= 70 && magicIdx + 6 <= streamBuf.length) {
        const wpCount = streamBuf.readUInt16LE(magicIdx + 4);
        if (wpCount >= 2 && wpCount <= 64 && magicIdx + 6 + wpCount * 12 <= streamBuf.length) {
          const pts: string[] = [];
          for (let w = 0; w < wpCount; w++) {
            const wOff = magicIdx + 6 + w * 12;
            const wx = streamBuf.readFloatLE(wOff + 0).toFixed(2);
            const wy = streamBuf.readFloatLE(wOff + 4).toFixed(2);
            const wz = streamBuf.readFloatLE(wOff + 8).toFixed(2);
            pts.push(`${wx},${wy},${wz}`);
          }
          fpLines.push(`; @flight_path ${rName} ${pts.join(';')}`);
          continue;
        }
      }

      // 1b. If the map was saved before `'OCWP'` trailers existed, reconstruct the exact flight path
      // from the Scenario Cutscene Flags (`wp_*_start`, `wp_<trackId>_turn_1..N`, `wp_<trackId>_lz`, `wp_<trackId>_exit`)
      {
        const lowerR = rName.toLowerCase();
        const isExitAnim = lowerR.endsWith('_out') || lowerR.includes('_exit') || lowerR.includes('_depart');
        const trackCore = lowerR.replace(/^fly_/, '').replace(/_(in|out|approach|exit|depart)$/, '');
        const flagEntries = Array.from(flagCoordsByName.entries());
        const lzEntry =
          flagEntries.find(([fn]) => fn.toLowerCase() === `wp_${trackCore}_lz`) ??
          flagEntries.find(([fn]) => fn.toLowerCase().includes(trackCore) && fn.toLowerCase().endsWith('_lz'));

        if (isExitAnim && lzEntry) {
          const exitTurns = flagEntries
            .filter(([fn]) => fn.toLowerCase().startsWith(`wp_${trackCore}_exit_turn_`))
            .sort((a, b) => {
              const na = Number.parseInt(a[0].replace(/^.*_exit_turn_/i, ''), 10) || 0;
              const nb = Number.parseInt(b[0].replace(/^.*_exit_turn_/i, ''), 10) || 0;
              return na - nb;
            });
          const exitEnd =
            flagEntries.find(([fn]) => fn.toLowerCase() === `wp_${trackCore}_exit`) ??
            flagEntries.find(([fn]) => fn.toLowerCase().includes(trackCore) && fn.toLowerCase().endsWith('_exit'));
          if (exitEnd) {
            const chain = [lzEntry[1], ...exitTurns.map((e) => e[1]), exitEnd[1]];
            fpLines.push(
              `; @flight_path ${rName} ${chain.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`).join(';')}`,
            );
            continue;
          }
        } else if (!isExitAnim && lzEntry) {
          const startEntry =
            flagEntries.find(([fn]) => fn.toLowerCase() === `wp_${trackCore}_start`) ??
            flagEntries.find(([fn]) => fn.toLowerCase().endsWith('_start'));
          const inTurns = flagEntries
            .filter(
              ([fn]) =>
                fn.toLowerCase().startsWith(`wp_${trackCore}_turn_`) &&
                !fn.toLowerCase().includes('_exit_turn_'),
            )
            .sort((a, b) => {
              const na = Number.parseInt(a[0].replace(/^.*_turn_/i, ''), 10) || 0;
              const nb = Number.parseInt(b[0].replace(/^.*_turn_/i, ''), 10) || 0;
              return na - nb;
            });
          if (startEntry) {
            const chain = [startEntry[1], ...inTurns.map((e) => e[1]), lzEntry[1]];
            fpLines.push(
              `; @flight_path ${rName} ${chain.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`).join(';')}`,
            );
            continue;
          }
        }
      }

      // 2. Decode native Halo CE v4 unit_control_data_v3 recorded animation stream into 3D trajectory points
      const ver = view.readUInt8(rAt + 32);
      const ctrlVer = view.readUInt8(rAt + 34);
      if (ver === 4 && ctrlVer === 3 && streamBuf.length >= 70) {
        // Find any matching start cutscene flag referenced near this recording in scripts
        let startX = 0;
        let startY = 0;
        let startZ = 6.0;
        for (const [fName, fCoord] of flagCoordsByName.entries()) {
          if (fName.toLowerCase().includes('start') || rName.toLowerCase().includes(fName.toLowerCase().replace(/^wp_/, ''))) {
            startX = fCoord.x;
            startY = fCoord.y;
            startZ = fCoord.z;
            break;
          }
        }
        let yawShort = streamBuf.readInt16LE(58);
        let pitchShort = streamBuf.readInt16LE(60);
        let fwdThrottle = streamBuf.readFloatLE(8);
        let ctrlFlags = streamBuf.readUInt16LE(2);
        let px = startX;
        let py = startY;
        let pz = startZ;
        let pos = 70;
        const sampled: Array<{ x: number; y: number; z: number }> = [{ x: px, y: py, z: pz }];
        let tickAccum = 0;

        const stepSim = (ticks: number) => {
          const yawRad = yawShort * 0.0031415927;
          const pitchRad = pitchShort * 0.0031415927;
          const speed = Math.max(-0.15, Math.min(0.45, fwdThrottle * 0.36));
          const vzFactor = (ctrlFlags & 1) !== 0 ? -0.08 : (ctrlFlags & 2) !== 0 ? 0.05 : 0.0;
          for (let t = 0; t < ticks; t++) {
            px += Math.cos(yawRad) * Math.cos(pitchRad) * speed;
            py += Math.sin(yawRad) * Math.cos(pitchRad) * speed;
            pz += Math.sin(pitchRad) * speed + vzFactor;
            tickAccum++;
            if (tickAccum % 45 === 0) {
              sampled.push({ x: px, y: py, z: pz });
            }
          }
        };

        const dataSizes = [0, 0, 1, 1, 2, 2, 8, 2, 2, 2, 2, 2, 2, 2, 2, 4, 4, 4, 4, 4, 4, 4, 4];
        while (pos < streamBuf.length) {
          const hdrByte = streamBuf.readUInt8(pos);
          const timeDeltaMode = hdrByte & 0x03;
          const evtType = (hdrByte >>> 2) & 0x3f;
          let timeDelta = 0;
          let hdrSize = 1;
          if (timeDeltaMode === 1) {
            timeDelta = 1;
          } else if (timeDeltaMode === 2) {
            if (pos + 2 > streamBuf.length) break;
            timeDelta = streamBuf.readUInt8(pos + 1);
            hdrSize = 2;
          } else if (timeDeltaMode === 3) {
            if (pos + 3 > streamBuf.length) break;
            timeDelta = streamBuf.readUInt16LE(pos + 1);
            hdrSize = 3;
          }
          if (timeDelta > 0) stepSim(Math.min(timeDelta, 300));
          if (evtType === 1 || evtType >= dataSizes.length) break;
          pos += hdrSize;
          const dSize = dataSizes[evtType] ?? 0;
          if (pos + dSize > streamBuf.length) break;
          if (evtType === 4) {
            ctrlFlags = streamBuf.readUInt16LE(pos);
          } else if (evtType === 6) {
            fwdThrottle = streamBuf.readFloatLE(pos);
          } else if (evtType >= 7 && evtType <= 14) {
            yawShort += streamBuf.readInt8(pos);
            if (yawShort > 1000) yawShort -= 1000;
            else if (yawShort < -1000) yawShort += 1000;
            pitchShort += streamBuf.readInt8(pos + 1);
          } else if (evtType >= 15 && evtType <= 22) {
            yawShort += streamBuf.readInt16LE(pos);
            if (yawShort > 1000) yawShort -= 1000;
            else if (yawShort < -1000) yawShort += 1000;
            pitchShort += streamBuf.readInt16LE(pos + 2);
          }
          pos += dSize;
        }
        sampled.push({ x: px, y: py, z: pz });
        if (sampled.length >= 2) {
          // Keep up to 5 representative waypoints (start, turns, end)
          const reduced: Array<{ x: number; y: number; z: number }> = [sampled[0]!];
          if (sampled.length > 4) {
            reduced.push(sampled[Math.floor(sampled.length * 0.33)]!);
            reduced.push(sampled[Math.floor(sampled.length * 0.66)]!);
          } else if (sampled.length > 2) {
            reduced.push(sampled[1]!);
          }
          reduced.push(sampled[sampled.length - 1]!);
          fpLines.push(
            `; @flight_path ${rName} ${reduced.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`).join(';')}`,
          );
        }
      }
    }
    if (fpLines.length > 0) {
      lines.push('; --- Scenario Recorded Animation 3D Flight Paths ---');
      lines.push(...fpLines, '');
    }
  }

  if (globals.length > 0) {
    lines.push('; --- Globals ---');
    for (const g of globals) {
      if (g.name === 'active_bsp_index') {
        lines.push('; Tracks the currently active Structure BSP index (0 .. N-1) to prevent rapid loop-switching inside trigger zones');
      }
      lines.push(`(global ${g.type} ${g.name} ${g.initExpression})`);
    }
    lines.push('');
  }

  if (sortedScripts.length > 0) {
    lines.push('; --- Scripts (Topologically Sorted) ---');
    for (const s of sortedScripts) {
      const mAct = /^activate_bsp_(\d+)$/i.exec(s.name);
      if (mAct) {
        lines.push(`; Helper function to manually switch to Structure BSP #${mAct[1]} from console or other scripts`);
      } else if (s.name === 'init_multi_bsp_manager') {
        lines.push('; Startup script: activates Structure BSP #0 when the map loads');
      } else if (s.name === 'monitor_bsp_transitions' || s.name === 'monitor_multi_bsp_trigger') {
        lines.push('; Continuous BSP transition monitor: checks directional corridor trigger volumes (trig_bsp_A_to_B)');
        lines.push('; Only switches to BSP B when the player is currently in BSP A, preventing rapid back-and-forth flickering');
      } else if (s.name === 'init_merged_bsp_activation') {
        lines.push('; Startup script: confirms all merged Structure BSP zones are active simultaneously in BSP #0');
      }
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
