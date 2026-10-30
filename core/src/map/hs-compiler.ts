import { parseCacheFileHeader } from './header';
import { parseTagIndex, resolveTagDataPointer } from './tag-index';
import { fourCCToString } from '../constants/tag-classes';
import { decodeStruct, getGroupStructName, isRangeInBuffer, resolvePointer, resolveStruct } from './definitions/engine';
import { DATA_ARRAY_HEADER_SIZE, SCRIPT_NODE_SIZE } from './convert/tag-data-repairs';
import { scenarioEntryOf } from './convert/scenario-tag';
import { addReflexiveChunk, writeTagFieldValue } from './tag-field-editor';
import { decompileScenarioScripts, HS_SCRIPT_TYPES, HS_VALUE_TYPES } from './hs-decompiler';

const NONE = 0xffffffff;
const FLAG_PRIMITIVE = 0x1;
const FLAG_SCRIPT_CALL = 0x2;
const FLAG_GLOBAL_INDEX = 0x4;
const FLAG_PERMANENT = 0x8;
const MAXIMUM_HS_SYNTAX_NODES_PER_SCENARIO = 19001;
const HS_MAXIMUM_DYNAMIC_SOURCE_DATA_BYTES = 1024;

export interface HaloScriptDiagnostic {
  line: number;
  severity: 'error' | 'warning';
  message: string;
}

export interface HaloScriptCompileResult {
  buffer: Buffer;
  compiledScripts: number;
  compiledGlobals: number;
  syntaxNodesUsed: number;
  diagnostics: HaloScriptDiagnostic[];
}

interface SExprAtom {
  kind: 'atom';
  text: string;
  quoted: boolean;
  line: number;
}

interface SExprList {
  kind: 'list';
  items: SExpr[];
  line: number;
}

type SExpr = SExprAtom | SExprList;

const SCRIPT_TYPE_BY_NAME: Record<string, number> = Object.fromEntries(
  Object.entries(HS_SCRIPT_TYPES).map(([k, v]) => [v, Number(k)]),
);

const VALUE_TYPE_BY_NAME: Record<string, number> = Object.fromEntries(
  Object.entries(HS_VALUE_TYPES).map(([k, v]) => [v, Number(k)]),
);

interface HsFunctionSignature {
  index: number;
  ret: number;
  params: number[];
}

/**
 * Exact Halo CE / OpenCE `hs_function_table` indices, return types, and parameter types
 * verified against `source/hs/hs.c` and `source/hs/hs_compile.c`.
 */
const BUILTIN_FUNCTIONS: Record<string, HsFunctionSignature> = {
  begin: { index: 0, ret: 3, params: [] },
  begin_random: { index: 1, ret: 3, params: [] },
  if: { index: 2, ret: 3, params: [] },
  cond: { index: 3, ret: 3, params: [] },
  set: { index: 4, ret: 3, params: [] },
  and: { index: 5, ret: 5, params: [] },
  or: { index: 6, ret: 5, params: [] },
  '+': { index: 7, ret: 6, params: [] },
  '-': { index: 8, ret: 6, params: [] },
  '*': { index: 9, ret: 6, params: [] },
  '/': { index: 10, ret: 6, params: [] },
  min: { index: 11, ret: 6, params: [] },
  max: { index: 12, ret: 6, params: [] },
  '=': { index: 13, ret: 5, params: [] },
  '!=': { index: 14, ret: 5, params: [] },
  '>': { index: 15, ret: 5, params: [] },
  '<': { index: 16, ret: 5, params: [] },
  '>=': { index: 17, ret: 5, params: [] },
  '<=': { index: 18, ret: 5, params: [] },
  sleep: { index: 19, ret: 4, params: [] },
  sleep_until: { index: 20, ret: 4, params: [] },
  wake: { index: 21, ret: 4, params: [] },
  inspect: { index: 22, ret: 4, params: [] },
  unit: { index: 23, ret: 38, params: [37] },
  ai_debug_communication_suppress: { index: 24, ret: 4, params: [] },
  ai_debug_communication_ignore: { index: 25, ret: 4, params: [] },
  ai_debug_communication_focus: { index: 26, ret: 4, params: [] },
  not: { index: 27, ret: 5, params: [5] },
  print: { index: 28, ret: 4, params: [9] },
  players: { index: 29, ret: 23, params: [] },
  volume_teleport_players_not_inside: { index: 30, ret: 4, params: [11, 12] },
  volume_test_object: { index: 31, ret: 5, params: [11, 37] },
  volume_test_objects: { index: 32, ret: 5, params: [11, 23] },
  volume_test_objects_all: { index: 33, ret: 5, params: [11, 23] },
  object_teleport: { index: 34, ret: 4, params: [37, 12] },
  object_set_facing: { index: 35, ret: 4, params: [37, 12] },
  object_set_shield: { index: 36, ret: 4, params: [37, 6] },
  object_set_permutation: { index: 37, ret: 4, params: [37, 9, 9] },
  object_create: { index: 38, ret: 4, params: [43] },
  object_destroy: { index: 39, ret: 4, params: [37] },
  object_create_anew: { index: 40, ret: 4, params: [43] },
  object_create_containing: { index: 41, ret: 4, params: [9] },
  object_create_anew_containing: { index: 42, ret: 4, params: [9] },
  object_destroy_containing: { index: 43, ret: 4, params: [9] },
  object_destroy_all: { index: 44, ret: 4, params: [] },
  list_get: { index: 45, ret: 37, params: [23, 7] },
  list_count: { index: 46, ret: 7, params: [23] },
  effect_new: { index: 47, ret: 4, params: [25, 12] },
  effect_new_on_object_marker: { index: 48, ret: 4, params: [25, 37, 9] },
  damage_new: { index: 49, ret: 4, params: [26, 12] },
  damage_object: { index: 50, ret: 4, params: [26, 37] },
  objects_can_see_object: { index: 51, ret: 5, params: [23, 37, 6] },
  objects_can_see_flag: { index: 52, ret: 5, params: [23, 12, 6] },
  objects_delete_by_definition: { index: 53, ret: 4, params: [31] },
  sound_set_gain: { index: 54, ret: 4, params: [9, 6] },
  sound_get_gain: { index: 55, ret: 6, params: [9] },
  script_recompile: { index: 56, ret: 4, params: [] },
  script_doc: { index: 57, ret: 4, params: [] },
  help: { index: 58, ret: 4, params: [9] },
  random_range: { index: 59, ret: 7, params: [7, 7] },
  real_random_range: { index: 60, ret: 6, params: [6, 6] },
  numeric_countdown_timer_set: { index: 61, ret: 4, params: [8, 5] },
  numeric_countdown_timer_get: { index: 62, ret: 7, params: [7] },
  numeric_countdown_timer_stop: { index: 63, ret: 4, params: [] },
  numeric_countdown_timer_restart: { index: 64, ret: 4, params: [] },
  breakable_surfaces_enable: { index: 65, ret: 4, params: [5] },
  recording_play: { index: 66, ret: 5, params: [38, 15] },
  recording_play_and_delete: { index: 67, ret: 5, params: [38, 15] },
  recording_play_and_hover: { index: 68, ret: 5, params: [39, 15] },
  recording_kill: { index: 69, ret: 4, params: [38] },
  recording_time: { index: 70, ret: 7, params: [38] },
  object_set_ranged_attack_inhibited: { index: 71, ret: 4, params: [37, 5] },
  object_set_melee_attack_inhibited: { index: 72, ret: 4, params: [37, 5] },
  objects_dump_memory: { index: 73, ret: 4, params: [] },
  object_set_collideable: { index: 74, ret: 4, params: [37, 5] },
  object_set_scale: { index: 75, ret: 4, params: [37, 6, 7] },
  objects_attach: { index: 76, ret: 4, params: [37, 9, 37, 9] },
  objects_detach: { index: 77, ret: 4, params: [37, 37] },
  garbage_collect_now: { index: 78, ret: 4, params: [] },
  object_cannot_take_damage: { index: 79, ret: 4, params: [23] },
  object_can_take_damage: { index: 80, ret: 4, params: [23] },
  object_beautify: { index: 81, ret: 4, params: [37, 5] },
  objects_predict: { index: 82, ret: 4, params: [23] },
  object_type_predict: { index: 83, ret: 4, params: [31] },
  object_pvs_activate: { index: 84, ret: 4, params: [37] },
  object_pvs_set_object: { index: 85, ret: 4, params: [37] },
  object_pvs_set_camera: { index: 86, ret: 4, params: [13] },
  object_pvs_clear: { index: 87, ret: 4, params: [] },
  render_lights: { index: 88, ret: 5, params: [5] },
  scenery_get_animation_time: { index: 89, ret: 7, params: [42] },
  scenery_animation_start: { index: 90, ret: 4, params: [42, 28, 9] },
  scenery_animation_start_at_frame: { index: 91, ret: 4, params: [42, 28, 9, 7] },
  render_effects: { index: 92, ret: 4, params: [5] },
  unit_can_blink: { index: 93, ret: 4, params: [38, 5] },
  unit_open: { index: 94, ret: 4, params: [38] },
  unit_close: { index: 95, ret: 4, params: [38] },
  unit_kill: { index: 96, ret: 4, params: [38] },
  unit_kill_silent: { index: 97, ret: 4, params: [38] },
  unit_get_custom_animation_time: { index: 98, ret: 7, params: [38] },
  unit_stop_custom_animation: { index: 99, ret: 4, params: [38] },
  unit_custom_animation_at_frame: { index: 100, ret: 5, params: [38, 28, 9, 5, 7] },
  custom_animation: { index: 101, ret: 5, params: [38, 28, 9, 5] },
  custom_animation_list: { index: 102, ret: 5, params: [23, 28, 9, 5] },
  unit_is_playing_custom_animation: { index: 103, ret: 5, params: [38] },
  unit_aim_without_turning: { index: 104, ret: 4, params: [38, 5] },
  unit_set_emotion: { index: 105, ret: 4, params: [38, 7] },
  unit_set_enterable_by_player: { index: 106, ret: 4, params: [38, 5] },
  unit_enter_vehicle: { index: 107, ret: 4, params: [38, 39, 9] },
  vehicle_test_seat_list: { index: 108, ret: 5, params: [39, 9, 23] },
  vehicle_test_seat: { index: 109, ret: 5, params: [39, 9, 38] },
  unit_set_emotion_animation: { index: 110, ret: 4, params: [38, 9] },
  unit_exit_vehicle: { index: 111, ret: 4, params: [38] },
  unit_set_maximum_vitality: { index: 112, ret: 4, params: [38, 6, 6] },
  units_set_maximum_vitality: { index: 113, ret: 4, params: [23, 6, 6] },
  unit_set_current_vitality: { index: 114, ret: 4, params: [38, 6, 6] },
  units_set_current_vitality: { index: 115, ret: 4, params: [23, 6, 6] },
  vehicle_load_magic: { index: 116, ret: 7, params: [38, 9, 23] },
  vehicle_unload: { index: 117, ret: 7, params: [38, 9] },
  magic_seat_name: { index: 118, ret: 4, params: [9] },
  unit_set_seat: { index: 119, ret: 4, params: [38, 9] },
  magic_melee_attack: { index: 120, ret: 4, params: [] },
  vehicle_riders: { index: 121, ret: 23, params: [38] },
  vehicle_driver: { index: 122, ret: 38, params: [38] },
  vehicle_gunner: { index: 123, ret: 38, params: [38] },
  unit_get_health: { index: 124, ret: 6, params: [38] },
  unit_get_shield: { index: 125, ret: 6, params: [38] },
  unit_get_total_grenade_count: { index: 126, ret: 7, params: [38] },
  unit_has_weapon: { index: 127, ret: 5, params: [38, 31] },
  unit_has_weapon_readied: { index: 128, ret: 5, params: [38, 31] },
  unit_doesnt_drop_items: { index: 129, ret: 4, params: [23] },
  unit_impervious: { index: 130, ret: 4, params: [23, 5] },
  unit_suspended: { index: 131, ret: 4, params: [38, 5] },
  unit_solo_player_integrated_night_vision_is_active: { index: 132, ret: 5, params: [] },
  units_set_desired_flashlight_state: { index: 133, ret: 4, params: [23, 5] },
  unit_set_desired_flashlight_state: { index: 134, ret: 4, params: [38, 5] },
  unit_get_current_flashlight_state: { index: 135, ret: 5, params: [38] },
  device_set_never_appears_locked: { index: 136, ret: 4, params: [41, 5] },
  device_get_power: { index: 137, ret: 6, params: [41] },
  device_set_power: { index: 138, ret: 4, params: [41, 6] },
  device_set_position: { index: 139, ret: 5, params: [41, 6] },
  device_get_position: { index: 140, ret: 6, params: [41] },
  device_set_position_immediate: { index: 141, ret: 4, params: [41, 6] },
  device_group_get: { index: 142, ret: 6, params: [16] },
  device_group_set: { index: 143, ret: 5, params: [16, 6] },
  device_group_set_immediate: { index: 144, ret: 4, params: [16, 6] },
  device_one_sided_set: { index: 145, ret: 4, params: [41, 5] },
  device_operates_automatically_set: { index: 146, ret: 4, params: [41, 5] },
  device_group_change_only_once_more_set: { index: 147, ret: 4, params: [16, 5] },
  breakable_surfaces_reset: { index: 148, ret: 4, params: [] },
  cheat_all_powerups: { index: 149, ret: 4, params: [] },
  cheat_all_weapons: { index: 150, ret: 4, params: [] },
  cheat_all_vehicles: { index: 151, ret: 4, params: [] },
  cheat_teleport_to_camera: { index: 152, ret: 4, params: [] },
  cheat_active_camouflage: { index: 153, ret: 4, params: [] },
  cheat_active_camouflage_local_player: { index: 154, ret: 4, params: [7] },
  cheats_load: { index: 155, ret: 4, params: [] },
  ai_free: { index: 156, ret: 4, params: [17] },
  ai_free_units: { index: 157, ret: 4, params: [23] },
  ai_attach: { index: 158, ret: 4, params: [38, 17] },
  ai_attach_free: { index: 159, ret: 4, params: [38, 29] },
  ai_detach: { index: 160, ret: 4, params: [38] },
  ai_place: { index: 161, ret: 4, params: [17] },
  ai_kill: { index: 162, ret: 4, params: [17] },
  ai_kill_silent: { index: 163, ret: 4, params: [17] },
  ai_erase: { index: 164, ret: 4, params: [17] },
  ai_erase_all: { index: 165, ret: 4, params: [] },
  ai_select: { index: 166, ret: 4, params: [17] },
  ai_deselect: { index: 167, ret: 4, params: [] },
  ai_spawn_actor: { index: 168, ret: 4, params: [17] },
  ai_set_respawn: { index: 169, ret: 4, params: [17, 5] },
  ai_set_deaf: { index: 170, ret: 4, params: [17, 5] },
  ai_set_blind: { index: 171, ret: 4, params: [17, 5] },
  ai_magically_see_encounter: { index: 172, ret: 4, params: [17, 17] },
  ai_magically_see_players: { index: 173, ret: 4, params: [17] },
  ai_magically_see_unit: { index: 174, ret: 4, params: [17, 38] },
  ai_timer_start: { index: 175, ret: 4, params: [17] },
  ai_timer_expire: { index: 176, ret: 4, params: [17] },
  ai_attack: { index: 177, ret: 4, params: [17] },
  ai_defend: { index: 178, ret: 4, params: [17] },
  ai_retreat: { index: 179, ret: 4, params: [17] },
  ai_maneuver: { index: 180, ret: 4, params: [17] },
  ai_maneuver_enable: { index: 181, ret: 4, params: [17, 5] },
  ai_migrate: { index: 182, ret: 4, params: [17, 17] },
  ai_migrate_and_speak: { index: 183, ret: 4, params: [17, 17, 9] },
  ai_migrate_by_unit: { index: 184, ret: 4, params: [23, 17] },
  ai_allegiance: { index: 185, ret: 4, params: [33, 33] },
  ai_allegiance_remove: { index: 186, ret: 4, params: [33, 33] },
  ai_living_count: { index: 187, ret: 7, params: [17] },
  ai_living_fraction: { index: 188, ret: 6, params: [17] },
  ai_strength: { index: 189, ret: 6, params: [17] },
  ai_swarm_count: { index: 190, ret: 7, params: [17] },
  ai_nonswarm_count: { index: 191, ret: 7, params: [17] },
  ai_actors: { index: 192, ret: 23, params: [17] },
  ai_go_to_vehicle: { index: 193, ret: 4, params: [17, 38, 9] },
  ai_go_to_vehicle_override: { index: 194, ret: 4, params: [17, 38, 9] },
  ai_going_to_vehicle: { index: 195, ret: 7, params: [38] },
  ai_exit_vehicle: { index: 196, ret: 4, params: [17] },
  ai_braindead: { index: 197, ret: 4, params: [17, 5] },
  ai_braindead_by_unit: { index: 198, ret: 4, params: [23, 5] },
  ai_disregard: { index: 199, ret: 4, params: [23, 5] },
  ai_prefer_target: { index: 200, ret: 4, params: [23, 5] },
  ai_teleport_to_starting_location: { index: 201, ret: 4, params: [17] },
  ai_teleport_to_starting_location_if_unsupported: { index: 202, ret: 4, params: [17] },
  ai_renew: { index: 203, ret: 4, params: [17] },
  ai_try_to_fight_nothing: { index: 204, ret: 4, params: [17] },
  ai_try_to_fight: { index: 205, ret: 4, params: [17, 17] },
  ai_try_to_fight_player: { index: 206, ret: 4, params: [17] },
  ai_command_list: { index: 207, ret: 4, params: [17, 18] },
  ai_command_list_by_unit: { index: 208, ret: 4, params: [38, 18] },
  ai_command_list_advance: { index: 209, ret: 4, params: [17] },
  ai_command_list_advance_by_unit: { index: 210, ret: 4, params: [38] },
  ai_command_list_status: { index: 211, ret: 7, params: [23] },
  ai_is_attacking: { index: 212, ret: 5, params: [17] },
  ai_force_active: { index: 213, ret: 4, params: [17, 5] },
  ai_force_active_by_unit: { index: 214, ret: 4, params: [38, 5] },
  ai_set_return_state: { index: 215, ret: 4, params: [17, 34] },
  ai_set_current_state: { index: 216, ret: 4, params: [17, 34] },
  ai_playfight: { index: 217, ret: 4, params: [17, 5] },
  ai_status: { index: 218, ret: 7, params: [17] },
  ai_reconnect: { index: 219, ret: 4, params: [] },
  ai_vehicle_encounter: { index: 220, ret: 4, params: [38, 17] },
  ai_vehicle_enterable_distance: { index: 221, ret: 4, params: [38, 6] },
  ai_vehicle_enterable_team: { index: 222, ret: 4, params: [38, 33] },
  ai_vehicle_enterable_actor_type: { index: 223, ret: 4, params: [38, 35] },
  ai_vehicle_enterable_actors: { index: 224, ret: 4, params: [38, 17] },
  ai_vehicle_enterable_disable: { index: 225, ret: 4, params: [38] },
  ai_look_at_object: { index: 226, ret: 4, params: [38, 37] },
  ai_stop_looking: { index: 227, ret: 4, params: [38] },
  ai_automatic_migration_target: { index: 228, ret: 4, params: [17, 5] },
  ai_follow_target_disable: { index: 229, ret: 4, params: [17] },
  ai_follow_target_players: { index: 230, ret: 4, params: [17] },
  ai_follow_target_unit: { index: 231, ret: 4, params: [17, 38] },
  ai_follow_target_ai: { index: 232, ret: 4, params: [17, 17] },
  ai_follow_distance: { index: 233, ret: 4, params: [17, 6] },
  ai_conversation: { index: 234, ret: 5, params: [20] },
  ai_conversation_stop: { index: 235, ret: 4, params: [20] },
  ai_conversation_advance: { index: 236, ret: 4, params: [20] },
  ai_conversation_line: { index: 237, ret: 7, params: [20] },
  ai_conversation_status: { index: 238, ret: 7, params: [20] },
  ai_link_activation: { index: 239, ret: 4, params: [17, 17] },
  ai_berserk: { index: 240, ret: 4, params: [17, 5] },
  ai_set_team: { index: 241, ret: 4, params: [17, 33] },
  ai_allow_charge: { index: 242, ret: 4, params: [17, 5] },
  ai_allow_dormant: { index: 243, ret: 4, params: [17, 5] },
  ai_allegiance_broken: { index: 244, ret: 5, params: [33, 33] },
  camera_control: { index: 245, ret: 4, params: [5] },
  camera_set: { index: 246, ret: 4, params: [13, 7] },
  camera_set_relative: { index: 247, ret: 4, params: [13, 7, 37] },
  camera_set_animation: { index: 248, ret: 4, params: [28, 9] },
  camera_set_first_person: { index: 249, ret: 4, params: [38] },
  camera_set_dead: { index: 250, ret: 4, params: [38] },
  camera_time: { index: 251, ret: 7, params: [] },
  debug_camera_load: { index: 252, ret: 4, params: [] },
  debug_camera_save: { index: 253, ret: 4, params: [] },
  game_speed: { index: 254, ret: 4, params: [6] },
  game_time: { index: 255, ret: 8, params: [] },
  game_variant: { index: 256, ret: 4, params: [9] },
  game_difficulty_get: { index: 257, ret: 32, params: [] },
  game_difficulty_get_real: { index: 258, ret: 32, params: [] },
  map_reset: { index: 259, ret: 4, params: [] },
  map_name: { index: 260, ret: 4, params: [9] },
  multiplayer_map_name: { index: 261, ret: 4, params: [9] },
  game_difficulty_set: { index: 262, ret: 4, params: [32] },
  crash: { index: 263, ret: 4, params: [9] },
  switch_bsp: { index: 264, ret: 4, params: [7] },
  structure_bsp_index: { index: 265, ret: 7, params: [] },
  version: { index: 266, ret: 4, params: [] },
  playback: { index: 267, ret: 4, params: [] },
  texture_cache_flush: { index: 268, ret: 4, params: [] },
  sound_cache_flush: { index: 269, ret: 4, params: [] },
  debug_memory: { index: 270, ret: 4, params: [] },
  debug_memory_by_file: { index: 271, ret: 4, params: [] },
  debug_memory_for_file: { index: 272, ret: 4, params: [9] },
  debug_tags: { index: 273, ret: 4, params: [] },
  profile_reset: { index: 274, ret: 4, params: [] },
  profile_dump: { index: 275, ret: 4, params: [9] },
  profile_activate: { index: 276, ret: 4, params: [9] },
  profile_deactivate: { index: 277, ret: 4, params: [9] },
  profile_graph_toggle: { index: 278, ret: 4, params: [9] },
  debug_pvs: { index: 279, ret: 4, params: [5] },
  radiosity_start: { index: 280, ret: 4, params: [] },
  radiosity_save: { index: 281, ret: 4, params: [] },
  radiosity_debug_point: { index: 282, ret: 4, params: [] },
  ai: { index: 283, ret: 4, params: [5] },
  ai_dialogue_triggers: { index: 284, ret: 4, params: [5] },
  ai_grenades: { index: 285, ret: 4, params: [5] },
  ai_lines: { index: 286, ret: 4, params: [] },
  ai_debug_sound_point_set: { index: 287, ret: 4, params: [] },
  ai_debug_vocalize: { index: 288, ret: 4, params: [9, 9] },
  ai_debug_teleport_to: { index: 289, ret: 4, params: [17] },
  ai_debug_speak: { index: 290, ret: 4, params: [9] },
  ai_debug_speak_list: { index: 291, ret: 4, params: [9] },
  fade_in: { index: 292, ret: 4, params: [6, 6, 6, 7] },
  fade_out: { index: 293, ret: 4, params: [6, 6, 6, 7] },
  cinematic_start: { index: 294, ret: 4, params: [] },
  cinematic_stop: { index: 295, ret: 4, params: [] },
  cinematic_skip_start_internal: { index: 296, ret: 4, params: [] },
  cinematic_skip_stop_internal: { index: 297, ret: 4, params: [] },
  cinematic_show_letterbox: { index: 298, ret: 4, params: [5] },
  cinematic_set_title: { index: 299, ret: 4, params: [14] },
  cinematic_set_title_delayed: { index: 300, ret: 4, params: [14, 6] },
  cinematic_suppress_bsp_object_creation: { index: 301, ret: 4, params: [5] },
  attract_mode_start: { index: 302, ret: 4, params: [] },
  game_won: { index: 303, ret: 4, params: [] },
  game_lost: { index: 304, ret: 4, params: [] },
  game_safe_to_save: { index: 305, ret: 5, params: [] },
  game_all_quiet: { index: 306, ret: 5, params: [] },
  game_safe_to_speak: { index: 307, ret: 5, params: [] },
  game_is_cooperative: { index: 308, ret: 5, params: [] },
  game_save: { index: 309, ret: 4, params: [] },
  game_save_cancel: { index: 310, ret: 4, params: [] },
  game_save_no_timeout: { index: 311, ret: 4, params: [] },
  game_save_totally_unsafe: { index: 312, ret: 4, params: [] },
  game_saving: { index: 313, ret: 5, params: [] },
  game_revert: { index: 314, ret: 4, params: [] },
  game_reverted: { index: 315, ret: 5, params: [] },
  core_save: { index: 316, ret: 4, params: [] },
  core_save_name: { index: 317, ret: 4, params: [9] },
  core_load: { index: 318, ret: 4, params: [] },
  core_load_at_startup: { index: 319, ret: 4, params: [] },
  core_load_name: { index: 320, ret: 4, params: [9] },
  core_load_name_at_startup: { index: 321, ret: 4, params: [9] },
  game_skip_ticks: { index: 322, ret: 4, params: [7] },
  sound_impulse_start: { index: 323, ret: 4, params: [24, 37, 6] },
  sound_impulse_time: { index: 324, ret: 8, params: [24] },
  sound_impulse_stop: { index: 325, ret: 4, params: [24] },
  sound_looping_predict: { index: 326, ret: 4, params: [27] },
  sound_looping_start: { index: 327, ret: 4, params: [27, 37, 6] },
  sound_looping_stop: { index: 328, ret: 4, params: [27] },
  sound_looping_set_scale: { index: 329, ret: 4, params: [27, 6] },
  sound_looping_set_alternate: { index: 330, ret: 4, params: [27, 5] },
  debug_sounds_enable: { index: 331, ret: 4, params: [9, 5] },
  debug_sounds_distances: { index: 332, ret: 4, params: [9, 6, 6] },
  debug_sounds_wet: { index: 333, ret: 4, params: [9, 6] },
  sound_enable: { index: 334, ret: 4, params: [5] },
  sound_class_set_gain: { index: 335, ret: 4, params: [9, 6, 7] },
  vehicle_hover: { index: 336, ret: 4, params: [39, 5] },
  players_unzoom_all: { index: 337, ret: 4, params: [] },
  player_enable_input: { index: 338, ret: 4, params: [5] },
  player_camera_control: { index: 339, ret: 5, params: [5] },
  player_action_test_reset: { index: 340, ret: 4, params: [] },
  player_action_test_jump: { index: 341, ret: 5, params: [] },
  player_action_test_primary_trigger: { index: 342, ret: 5, params: [] },
  player_action_test_grenade_trigger: { index: 343, ret: 5, params: [] },
  player_action_test_zoom: { index: 344, ret: 5, params: [] },
  player_action_test_action: { index: 345, ret: 5, params: [] },
  player_action_test_accept: { index: 346, ret: 5, params: [] },
  player_action_test_back: { index: 347, ret: 5, params: [] },
  player_action_test_look_relative_up: { index: 348, ret: 5, params: [] },
  player_action_test_look_relative_down: { index: 349, ret: 5, params: [] },
  player_action_test_look_relative_left: { index: 350, ret: 5, params: [] },
  player_action_test_look_relative_right: { index: 351, ret: 5, params: [] },
  player_action_test_look_relative_all_directions: { index: 352, ret: 5, params: [] },
  player_action_test_move_relative_all_directions: { index: 353, ret: 5, params: [] },
  player_add_equipment: { index: 354, ret: 4, params: [38, 19, 5] },
  debug_teleport_player: { index: 355, ret: 4, params: [7, 7] },
  show_hud: { index: 356, ret: 5, params: [5] },
  show_hud_help_text: { index: 357, ret: 5, params: [5] },
  enable_hud_help_flash: { index: 358, ret: 4, params: [5] },
  hud_help_flash_restart: { index: 359, ret: 4, params: [] },
  activate_nav_point_flag: { index: 360, ret: 4, params: [21, 38, 12, 6] },
  activate_nav_point_object: { index: 361, ret: 4, params: [21, 38, 37, 6] },
  activate_team_nav_point_flag: { index: 362, ret: 4, params: [21, 33, 12, 6] },
  activate_team_nav_point_object: { index: 363, ret: 4, params: [21, 33, 37, 6] },
  deactivate_nav_point_flag: { index: 364, ret: 4, params: [38, 12] },
  deactivate_nav_point_object: { index: 365, ret: 4, params: [38, 37] },
  deactivate_team_nav_point_flag: { index: 366, ret: 4, params: [33, 12] },
  deactivate_team_nav_point_object: { index: 367, ret: 4, params: [33, 37] },
  cls: { index: 368, ret: 4, params: [] },
  error_overflow_suppression: { index: 369, ret: 4, params: [5] },
  structure_lens_flares_place: { index: 370, ret: 4, params: [] },
  player_effect_set_max_translation: { index: 371, ret: 4, params: [6, 6, 6] },
  player_effect_set_max_rotation: { index: 372, ret: 4, params: [6, 6, 6] },
  player_effect_set_max_rumble: { index: 373, ret: 4, params: [6, 6] },
  player_effect_start: { index: 374, ret: 4, params: [6, 6] },
  player_effect_stop: { index: 375, ret: 4, params: [6] },
  hud_show_health: { index: 376, ret: 4, params: [5] },
  hud_blink_health: { index: 377, ret: 4, params: [5] },
  hud_show_shield: { index: 378, ret: 4, params: [5] },
  hud_blink_shield: { index: 379, ret: 4, params: [5] },
  hud_show_motion_sensor: { index: 380, ret: 4, params: [5] },
  hud_blink_motion_sensor: { index: 381, ret: 4, params: [5] },
  hud_show_crosshair: { index: 382, ret: 4, params: [5] },
  hud_clear_messages: { index: 383, ret: 4, params: [] },
  hud_set_help_text: { index: 384, ret: 4, params: [22] },
  hud_set_objective_text: { index: 385, ret: 4, params: [22] },
  hud_set_timer_time: { index: 386, ret: 4, params: [7, 7] },
  hud_set_timer_warning_time: { index: 387, ret: 4, params: [7, 7] },
  hud_set_timer_position: { index: 388, ret: 4, params: [7, 7, 36] },
  show_hud_timer: { index: 389, ret: 4, params: [5] },
  pause_hud_timer: { index: 390, ret: 4, params: [5] },
  hud_get_timer_ticks: { index: 391, ret: 7, params: [] },
  time_code_show: { index: 392, ret: 4, params: [5] },
  time_code_start: { index: 393, ret: 4, params: [5] },
  time_code_reset: { index: 394, ret: 4, params: [] },
  rasterizer_decals_flush: { index: 395, ret: 4, params: [] },
  rasterizer_fps_accumulate: { index: 396, ret: 4, params: [] },
  rasterizer_model_ambient_reflection_tint: { index: 397, ret: 4, params: [6, 6, 6, 6] },
  rasterizer_lights_reset_for_new_map: { index: 398, ret: 4, params: [] },
  script_screen_effect_set_value: { index: 399, ret: 4, params: [7, 6] },
  cinematic_screen_effect_start: { index: 400, ret: 4, params: [5] },
  cinematic_screen_effect_set_convolution: { index: 401, ret: 4, params: [7, 7, 6, 6, 6] },
  cinematic_screen_effect_set_filter: { index: 402, ret: 4, params: [6, 6, 6, 6, 5, 6] },
  cinematic_screen_effect_set_filter_desaturation_tint: { index: 403, ret: 4, params: [6, 6, 6] },
  cinematic_screen_effect_set_video: { index: 404, ret: 4, params: [7, 6] },
  cinematic_screen_effect_stop: { index: 405, ret: 4, params: [] },
  cinematic_set_near_clip_distance: { index: 406, ret: 4, params: [6] },
  enumerate_memory_units: { index: 407, ret: 4, params: [] },
  delete_save_game_files: { index: 408, ret: 4, params: [] },
  fast_setup_network_server: { index: 409, ret: 4, params: [] },
  profile_unlock_solo_levels: { index: 410, ret: 4, params: [] },
  player0_look_invert_pitch: { index: 411, ret: 4, params: [5] },
  player0_look_pitch_is_inverted: { index: 412, ret: 5, params: [] },
  player0_joystick_set_is_normal: { index: 413, ret: 5, params: [] },
  ui_widget_show_path: { index: 414, ret: 4, params: [5] },
  display_scenario_help: { index: 415, ret: 4, params: [7] },
  network_game_start_now: { index: 416, ret: 4, params: [] },
  xbox_set_machine_name: { index: 417, ret: 4, params: [9] },
  sv_say: { index: 418, ret: 4, params: [9] },
  sv_end_game: { index: 419, ret: 4, params: [] },
  mods_reload: { index: 420, ret: 4, params: [] },
  mods_enable: { index: 421, ret: 4, params: [5] },
  mods_list: { index: 422, ret: 4, params: [] },
  structure_culling: { index: 423, ret: 4, params: [8] },
  debug_structure_culling: { index: 424, ret: 4, params: [5] },
};

export function parseHaloScriptSExpressions(source: string): {
  expressions: SExpr[];
  diagnostics: HaloScriptDiagnostic[];
} {
  const diagnostics: HaloScriptDiagnostic[] = [];
  const stack: SExprList[] = [{ kind: 'list', items: [], line: 1 }];
  let line = 1;
  let i = 0;

  while (i < source.length) {
    const ch = source[i]!;
    if (ch === '\n') {
      line++;
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    // Single-line comment `; ...`
    if (ch === ';') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '(') {
      const list: SExprList = { kind: 'list', items: [], line };
      stack[stack.length - 1]!.items.push(list);
      stack.push(list);
      i++;
      continue;
    }
    if (ch === ')') {
      if (stack.length <= 1) {
        diagnostics.push({ line, severity: 'error', message: 'Unexpected closing parenthesis `)`' });
      } else {
        stack.pop();
      }
      i++;
      continue;
    }
    if (ch === '"') {
      const startLine = line;
      i++;
      let text = '';
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\' && i + 1 < source.length) {
          i++;
          text += source[i];
        } else {
          if (source[i] === '\n') line++;
          text += source[i];
        }
        i++;
      }
      if (i >= source.length) {
        diagnostics.push({ line: startLine, severity: 'error', message: 'Unterminated string literal' });
      } else {
        i++; // skip closing quote
      }
      stack[stack.length - 1]!.items.push({ kind: 'atom', text, quoted: true, line: startLine });
      continue;
    }

    // Atom token
    const startLine = line;
    let text = '';
    while (i < source.length && !/[\s()";]/.test(source[i]!)) {
      text += source[i];
      i++;
    }
    stack[stack.length - 1]!.items.push({ kind: 'atom', text, quoted: false, line: startLine });
  }

  if (stack.length > 1) {
    diagnostics.push({
      line: stack[stack.length - 1]!.line,
      severity: 'error',
      message: `Unclosed parenthesis \`(\` opened at line ${stack[stack.length - 1]!.line}`,
    });
  }

  return { expressions: stack[0]!.items, diagnostics };
}

export function lintHaloScript(source: string): HaloScriptDiagnostic[] {
  const { expressions, diagnostics } = parseHaloScriptSExpressions(source);

  const checkRandomRecursive = (expr: SExpr) => {
    if (expr.kind !== 'list' || expr.items.length === 0) return;
    const head = expr.items[0];
    if (head?.kind === 'atom' && head.text === 'begin_random') {
      const argCount = expr.items.length - 1;
      if (argCount >= 32) {
        diagnostics.push({
          line: expr.line,
          severity: argCount > 32 ? 'error' : 'warning',
          message: `begin_random has ${argCount} arguments; OpenCE asserts < 32 arguments in hs_evaluate_begin_random.`,
        });
      }
    }
    for (const item of expr.items) checkRandomRecursive(item);
  };

  for (const expr of expressions) {
    if (expr.kind !== 'list' || expr.items.length === 0) {
      diagnostics.push({ line: expr.line, severity: 'error', message: 'Top-level form must be `(global ...)` or `(script ...)`.' });
      continue;
    }
    const head = expr.items[0]!;
    if (head.kind !== 'atom' || (head.text !== 'global' && head.text !== 'script')) {
      diagnostics.push({
        line: expr.line,
        severity: 'error',
        message: `Unknown top-level form "${head.kind === 'atom' ? head.text : 'list'}"; expected "global" or "script".`,
      });
      continue;
    }
    if (head.text === 'global') {
      if (expr.items.length !== 4) {
        diagnostics.push({ line: expr.line, severity: 'error', message: '`(global <type> <name> <value>)` requires 4 items.' });
      } else {
        const typeAtom = expr.items[1]!;
        if (typeAtom.kind !== 'atom' || VALUE_TYPE_BY_NAME[typeAtom.text] === undefined) {
          diagnostics.push({ line: expr.line, severity: 'error', message: `Unknown HaloScript value type "${typeAtom.kind === 'atom' ? typeAtom.text : ''}".` });
        }
      }
    } else if (head.text === 'script') {
      if (expr.items.length < 4) {
        diagnostics.push({
          line: expr.line,
          severity: 'error',
          message: '`(script <type> [return_type] <name> <body>...)` requires at least 4 items.',
        });
      } else {
        const scriptTypeAtom = expr.items[1]!;
        const secondAtom = expr.items[2]!;
        if (scriptTypeAtom.kind !== 'atom' || SCRIPT_TYPE_BY_NAME[scriptTypeAtom.text] === undefined) {
          diagnostics.push({
            line: expr.line,
            severity: 'error',
            message: `Unknown script type "${scriptTypeAtom.kind === 'atom' ? scriptTypeAtom.text : ''}" (expected startup, dormant, continuous, static, or stub).`,
          });
        }
        const isImplicitVoid =
          scriptTypeAtom.kind === 'atom' &&
          (scriptTypeAtom.text === 'startup' || scriptTypeAtom.text === 'dormant' || scriptTypeAtom.text === 'continuous') &&
          secondAtom.kind === 'atom' &&
          VALUE_TYPE_BY_NAME[secondAtom.text] === undefined;

        if (!isImplicitVoid) {
          if (expr.items.length < 5) {
            diagnostics.push({
              line: expr.line,
              severity: 'error',
              message: '`(script <type> <return_type> <name> <body>...)` requires at least 5 items.',
            });
          } else if (secondAtom.kind !== 'atom' || VALUE_TYPE_BY_NAME[secondAtom.text] === undefined) {
            diagnostics.push({
              line: expr.line,
              severity: 'error',
              message: `Unknown return type "${secondAtom.kind === 'atom' ? secondAtom.text : ''}".`,
            });
          }
        }
      }
    }
    checkRandomRecursive(expr);
  }

  return diagnostics;
}

function resolveScenarioAnchor(
  buffer: Buffer,
  header: ReturnType<typeof parseCacheFileHeader>,
  tagIndex: ReturnType<typeof parseTagIndex>,
): { x: number; y: number; z: number; facing: number } {
  const scenario = scenarioEntryOf(tagIndex);
  if (!scenario) return { x: 0, y: 0, z: 2, facing: 0 };
  const scenarioStruct = getGroupStructName('scenario')!;
  const scnrDef = resolveStruct(scenarioStruct);
  const scnrAt = resolveTagDataPointer(scenario.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  if (!isRangeInBuffer(scnrAt, scnrDef.totalSize, buffer.length)) return { x: 0, y: 0, z: 2, facing: 0 };
  const decoded = decodeStruct(buffer, scnrAt, scenarioStruct);

  const spawnsRef = decoded.get('player starting locations');
  if (spawnsRef?.kind === 'reflexive' && spawnsRef.value.count > 0) {
    const spBase = resolvePointer(spawnsRef.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    if (isRangeInBuffer(spBase, 24, buffer.length)) {
      const x = buffer.readFloatLE(spBase + 0);
      const y = buffer.readFloatLE(spBase + 4);
      const z = buffer.readFloatLE(spBase + 8);
      const facing = buffer.readFloatLE(spBase + 12);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        return { x, y, z, facing: Number.isFinite(facing) ? facing : 0 };
      }
    }
  }

  const vehRef = decoded.get('vehicles');
  if (vehRef?.kind === 'reflexive' && vehRef.value.count > 0) {
    const vBase = resolvePointer(vehRef.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    if (isRangeInBuffer(vBase, 32, buffer.length)) {
      const x = buffer.readFloatLE(vBase + 8);
      const y = buffer.readFloatLE(vBase + 12);
      const z = buffer.readFloatLE(vBase + 16);
      const yaw = buffer.readFloatLE(vBase + 20);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        return { x, y, z, facing: Number.isFinite(yaw) ? yaw : 0 };
      }
    }
  }

  return { x: 0, y: 0, z: 2, facing: 0 };
}

/**
 * Tests `(x, y, z)` against `BSP[0]`'s 3D `CollisionBSP` (`bsp3d_test_point`), returning `{ z, leaf, cluster }`
 * clamped onto/above the terrain or floor surface whenever the input `(x, y, z)` lies underground (`leaf === -1`).
 */
function clampPointInsideBsp0(
  buffer: Buffer,
  header: ReturnType<typeof parseCacheFileHeader>,
  tagIndex: ReturnType<typeof parseTagIndex>,
  x: number,
  y: number,
  z: number,
  _extraZ = 0,
): { x: number; y: number; z: number; leaf: number; cluster: number } {
  try {
    const scnr = scenarioEntryOf(tagIndex);
    if (!scnr) return { x, y, z, leaf: 0, cluster: 0 };
    const scnrOff = resolveTagDataPointer(scnr.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
    if (!isRangeInBuffer(scnrOff, 0x5c0, buffer.length)) return { x, y, z, leaf: 0, cluster: 0 };
    const bspCount = buffer.readInt32LE(scnrOff + 0x5a4);
    const bspPtr = buffer.readUInt32LE(scnrOff + 0x5a8);
    if (bspCount <= 0 || bspPtr < tagIndex.baseMemoryAddress) return { x, y, z, leaf: 0, cluster: 0 };
    const bspRefOff = header.tagDataOffset + (bspPtr - tagIndex.baseMemoryAddress);
    if (!isRangeInBuffer(bspRefOff, 32, buffer.length)) return { x, y, z, leaf: 0, cluster: 0 };
    const bspStart = buffer.readUInt32LE(bspRefOff + 0);
    const bspSize = buffer.readUInt32LE(bspRefOff + 4);
    const bspAddress = buffer.readUInt32LE(bspRefOff + 8);
    if (bspStart === 0 || bspSize < 64 || bspStart + bspSize > buffer.length) return { x, y, z, leaf: 0, cluster: 0 };
    const metaPtr = buffer.readUInt32LE(bspStart);
    const bspRoot = bspStart + (metaPtr - bspAddress);
    const bspToOff = (ptr: number) => bspStart + (ptr - bspAddress);
    if (!isRangeInBuffer(bspRoot, 0x160, buffer.length)) return { x, y, z, leaf: 0, cluster: 0 };

    const collCount = buffer.readInt32LE(bspRoot + 0xb0);
    const collPtr = buffer.readUInt32LE(bspRoot + 0xb4);
    const leavesCount = buffer.readInt32LE(bspRoot + 0xe0);
    const leavesPtr = buffer.readUInt32LE(bspRoot + 0xe4);
    if (collCount <= 0) return { x, y, z, leaf: 0, cluster: 0 };
    const collOff = bspToOff(collPtr);
    const leavesOff = leavesCount > 0 ? bspToOff(leavesPtr) : -1;
    if (!isRangeInBuffer(collOff, 96, buffer.length)) return { x, y, z, leaf: 0, cluster: 0 };

    const n3dCount = buffer.readInt32LE(collOff + 0);
    const n3dOff = bspToOff(buffer.readUInt32LE(collOff + 4));
    const planesCount = buffer.readInt32LE(collOff + 12);
    const planesOff = bspToOff(buffer.readUInt32LE(collOff + 16));
    if (n3dCount <= 0 || planesCount <= 0) return { x, y, z, leaf: 0, cluster: 0 };
    if (!isRangeInBuffer(n3dOff, n3dCount * 12, buffer.length) || !isRangeInBuffer(planesOff, planesCount * 16, buffer.length)) {
      return { x, y, z, leaf: 0, cluster: 0 };
    }

    const testPoint = (px: number, py: number, pz: number): number => {
      let nodeIdx = 0;
      let steps = 0;
      while ((nodeIdx & 0x80000000) === 0 && nodeIdx >= 0 && nodeIdx < n3dCount && steps++ < 512) {
        const no = n3dOff + nodeIdx * 12;
        const planeIdx = buffer.readInt32LE(no + 0);
        if (planeIdx < 0 || planeIdx >= planesCount) return -1;
        const po = planesOff + planeIdx * 16;
        const dist =
          px * buffer.readFloatLE(po) +
          py * buffer.readFloatLE(po + 4) +
          pz * buffer.readFloatLE(po + 8) -
          buffer.readFloatLE(po + 12);
        nodeIdx = dist >= 0 ? buffer.readInt32LE(no + 8) : buffer.readInt32LE(no + 4);
      }
      if (nodeIdx === -1) return -1;
      return (nodeIdx & 0x80000000) !== 0 ? (nodeIdx & 0x7fffffff) : -1;
    };

    const clusterForLeaf = (leafIdx: number): number => {
      if (leafIdx >= 0 && leafIdx < leavesCount && leavesOff >= 0 && leavesOff + (leafIdx + 1) * 16 <= buffer.length) {
        return Math.max(0, buffer.readInt16LE(leavesOff + leafIdx * 16 + 8));
      }
      return 0;
    };

    const snapToFloor = (px: number, py: number, validZ: number, validLeaf: number): { z: number; leaf: number } => {
      let curZ = validZ;
      let curLeaf = validLeaf;
      for (let d = 1; d <= 120; d++) {
        const testZ = validZ - d * 0.25;
        const lf = testPoint(px, py, testZ);
        if (lf < 0) {
          return { z: curZ + 0.15, leaf: curLeaf };
        }
        curZ = testZ;
        curLeaf = lf;
      }
      return { z: validZ, leaf: validLeaf };
    };

    const leaf0 = testPoint(x, y, z);
    if (leaf0 >= 0) {
      // If the point was placed high in the air (e.g. z > 10), snap it down to the floor below
      const snapped = z > 10.0 ? snapToFloor(x, y, z, leaf0) : { z, leaf: leaf0 };
      return { x, y, z: snapped.z, leaf: snapped.leaf, cluster: clusterForLeaf(snapped.leaf) };
    }

    // Scan upward and downward up to ±25.0 world units to find valid BSP leaf above terrain
    for (let step = 1; step <= 125; step++) {
      const upZ = z + step * 0.2;
      const lfUp = testPoint(x, y, upZ);
      if (lfUp >= 0) {
        return { x, y, z: upZ + 0.15, leaf: lfUp, cluster: clusterForLeaf(lfUp) };
      }
      const dnZ = z - step * 0.2;
      const lfDn = testPoint(x, y, dnZ);
      if (lfDn >= 0) {
        const snapped = snapToFloor(x, y, dnZ, lfDn);
        return { x, y, z: snapped.z, leaf: snapped.leaf, cluster: clusterForLeaf(snapped.leaf) };
      }
    }
    return { x, y, z, leaf: 0, cluster: 0 };
  } catch {
    return { x, y, z, leaf: 0, cluster: 0 };
  }
}

/**
 * Builds a valid v4 `unit_control_data_v3` recorded animation byte stream from an explicit
 * array of 3D waypoints (`[{ x, y, z }, ...]`), using a closed-loop 30 Hz physics controller
 * matched to Halo CE's `update_human_plane_physics` (`vehicles.c:1492`) and `recorded_animation_playback.c:667`
 * (`angle_rad = controller_short * 0.0031415927f`, i.e. `1000 units = PI radians`).
 * Also appends a lossless `'OCWP'` waypoint trailer after `_playback_end` (`0x06, 0x0f`) so
 * decompiling the map restores the exact 3D waypoints!
 */
export interface RecordedFlightSimulationResult {
  stream: Buffer;
  totalTicks: number;
  waypointArrivalTicks: number[];
  trajectorySamples: Array<{ tick: number; x: number; y: number; z: number }>;
}

// Exact 19-mass-point `vehicles\pelican\pelican.physics` definition used by Halo CE's `physics_update_old` (`physics.c:1669-2230`)
const PELICAN_PHYS_DEF = {
  radius: 4.0,
  moment: 0.30000001192092896,
  mass: 10000.0,
  com: [-0.14326012134552002, -0.09304352849721909, 1.9866347312927246] as [number, number, number],
  gravityScale: 1.0,
  airFriction: 0.019999999552965164,
  massPoints: [
    { mass: 217.3913116455078, pos: [0.8500000238418579, 1.940000057220459, 2.059999942779541], fwd: [-0.9848080277442932, 0, 0.17364899814128876], up: [-0.17364899814128876, 0, -0.9848080277442932], frictionType: 0, frictionParallel: 1, frictionPerp: 1, radius: 0.6000000238418579 },
    { mass: 434.7826232910156, pos: [2.049999952316284, 1.600000023841858, 1.5], fwd: [4.300809930413152e-9, 0.5000010132789612, -0.8660249710083008], up: [1, 0, 6.934239848988e-9], frictionType: 3, frictionParallel: 1, frictionPerp: 1, radius: 0.949999988079071 },
    { mass: 217.3913116455078, pos: [1.7999999523162842, 3, 1.7999999523162842], fwd: [1, 0, 0], up: [0, 0, 1], frictionType: 0, frictionParallel: 1, frictionPerp: 1, radius: 0.800000011920929 },
    { mass: 217.3913116455078, pos: [-4.5, -1.2000000476837158, 2.8740499019622803], fwd: [-1, 0, 0], up: [0, 0, -1], frictionType: 3, frictionParallel: 1, frictionPerp: 1, radius: 0.6000000238418579 },
    { mass: 434.7826232910156, pos: [-3.5, -1.2400000095367432, 2.740000009536743], fwd: [4.300809930413152e-9, -0.5000010132789612, -0.8660249710083008], up: [1, 0, 6.934239848988e-9], frictionType: 0, frictionParallel: 1, frictionPerp: 1, radius: 0.699999988079071 },
    { mass: 434.7826232910156, pos: [1.7999999523162842, -3, 1.7999999523162842], fwd: [1, 0, 0], up: [0, 0, 1], frictionType: 0, frictionParallel: 1, frictionPerp: 1, radius: 0.800000011920929 },
    { mass: 217.3913116455078, pos: [0.8500000238418579, -1.940000057220459, 2.059999942779541], fwd: [-0.9848080277442932, 0, 0.17364899814128876], up: [-0.17364899814128876, 0, -0.9848080277442932], frictionType: 0, frictionParallel: 1, frictionPerp: 1, radius: 0.6000000238418579 },
    { mass: 434.7826232910156, pos: [2.049999952316284, -1.600000023841858, 1.5], fwd: [4.300809930413152e-9, -0.5000010132789612, -0.8660249710083008], up: [1, 0, 6.934239848988e-9], frictionType: 0, frictionParallel: 1, frictionPerp: 1, radius: 0.949999988079071 },
    { mass: 217.3913116455078, pos: [-4.5, 1.2000000476837158, 2.8740499019622803], fwd: [-1, 0, 0], up: [0, 0, -1], frictionType: 0, frictionParallel: 1, frictionPerp: 1, radius: 0.6000000238418579 },
    { mass: 434.7826232910156, pos: [-3.5, 1.2400000095367432, 2.740000009536743], fwd: [4.300809930413152e-9, 0.5000010132789612, -0.8660249710083008], up: [1, 0, 6.934239848988e-9], frictionType: 0, frictionParallel: 1, frictionPerp: 1, radius: 0.699999988079071 },
    { mass: 869.5652465820312, pos: [4.255730152130127, -2.999999892949745e-8, 0.7491090297698975], fwd: [1, 0, 0], up: [0, 0, 1], frictionType: 1, frictionParallel: 1, frictionPerp: 3, radius: 0.800000011920929 },
    { mass: 217.3913116455078, pos: [-2.1600000858306885, 1.2799999713897705, 2.740000009536743], fwd: [1, 0, 0], up: [0, 0, 1], frictionType: 3, frictionParallel: 3, frictionPerp: 1, radius: 0.75 },
    { mass: 434.7826232910156, pos: [-2.9155399799346924, -1.1000000199601345e-7, 2.5398800373077393], fwd: [1, 0, 0], up: [0, 0, 1], frictionType: 1, frictionParallel: 1, frictionPerp: 3, radius: 0.8999999761581421 },
    { mass: 869.5652465820312, pos: [-3.966870069503784, -1.199999957179898e-7, 2.7035601139068604], fwd: [1, 0, 0], up: [0, 0, 1], frictionType: 1, frictionParallel: 1, frictionPerp: 3, radius: 0.6000000238418579 },
    { mass: 869.5652465820312, pos: [-1.597640037536621, -1.1000000199601345e-7, 2.4456100463867188], fwd: [1, 0, 0], up: [0, 0, 1], frictionType: 1, frictionParallel: 1, frictionPerp: 3, radius: 0.949999988079071 },
    { mass: 434.7826232910156, pos: [-2.1600000858306885, -1.2799999713897705, 2.740000009536743], fwd: [1, 0, 0], up: [0, 0, 1], frictionType: 3, frictionParallel: 3, frictionPerp: 1, radius: 0.75 },
    { mass: 869.5652465820312, pos: [-0.19777600467205048, -1.0000000116860974e-7, 2.185849905014038], fwd: [1, 0, 0], up: [0, 0, 1], frictionType: 1, frictionParallel: 1, frictionPerp: 3, radius: 1 },
    { mass: 1304.3477783203125, pos: [1.2383300065994263, -6.999999868639861e-8, 1.5124499797821045], fwd: [1, 0, 0], up: [0, 0, 1], frictionType: 1, frictionParallel: 1, frictionPerp: 3, radius: 1.399999976158142 },
    { mass: 869.5652465820312, pos: [3.0043399333953857, -5.000000058430487e-8, 1.1115299463272095], fwd: [1, 0, 0], up: [0, 0, 1], frictionType: 1, frictionParallel: 1, frictionPerp: 3, radius: 1.149999976158142 },
  ],
};

function dot3(a: number[], b: number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}
function cross3(a: number[], b: number[]): [number, number, number] {
  return [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
}
function norm3(v: number[]): number {
  const m = Math.hypot(v[0]!, v[1]!, v[2]!);
  if (m > 0) {
    v[0]! /= m;
    v[1]! /= m;
    v[2]! /= m;
  }
  return m;
}
function rotateVectorAboutAxis(v: number[], n: number[], s: number, c: number): void {
  const omc_vn = dot3(n, v) * (1.0 - c);
  const vxni = n[2]! * v[1]! - v[2]! * n[1]!;
  const vxnj = n[0]! * v[2]! - v[0]! * n[2]!;
  const vxnk = n[1]! * v[0]! - v[1]! * n[0]!;
  v[0] = c * v[0]! + omc_vn * n[0]! - s * vxni;
  v[1] = c * v[1]! + omc_vn * n[1]! - s * vxnj;
  v[2] = c * v[2]! + omc_vn * n[2]! - s * vxnk;
}
function matrixFromVectors(fwd: number[], up: number[]): number[][] {
  const left = cross3(up, fwd);
  return [[fwd[0]!, fwd[1]!, fwd[2]!], left, [up[0]!, up[1]!, up[2]!]];
}
function matrixInverse3(m: number[][]): number[][] {
  return [
    [m[0]![0]!, m[1]![0]!, m[2]![0]!],
    [m[0]![1]!, m[1]![1]!, m[2]![1]!],
    [m[0]![2]!, m[1]![2]!, m[2]![2]!],
  ];
}
function matrixMultiply3(a: number[][], b: number[][]): number[][] {
  const res = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      res[r]![c] = b[r]![0]! * a[0]![c]! + b[r]![1]! * a[1]![c]! + b[r]![2]! * a[2]![c]!;
    }
  }
  return res;
}
function matrixToQuat(m: number[][]): { v: [number, number, number]; w: number } {
  const trace = m[0]![0]! + m[1]![1]! + m[2]![2]!;
  if (trace > 0) {
    let s = Math.sqrt(trace + 1.0);
    const w = 0.5 * s;
    s = 0.5 / s;
    return {
      v: [(m[2]![1]! - m[1]![2]!) * s, (m[0]![2]! - m[2]![0]!) * s, (m[1]![0]! - m[0]![1]!) * s],
      w,
    };
  }
  const next = [1, 2, 0];
  let i = 0;
  if (m[1]![1]! > m[0]![0]!) i = 1;
  if (m[2]![2]! > m[i]![i]!) i = 2;
  const j = next[i]!;
  const k = next[j]!;
  let s = Math.sqrt(m[i]![i]! - (m[k]![k]! + m[j]![j]!) + 1.0);
  const q: [number, number, number] = [0, 0, 0];
  q[i] = s * 0.5;
  if (s !== 0) s = 0.5 / s;
  q[j] = (m[i]![j]! + m[j]![i]!) * s;
  q[k] = (m[i]![k]! + m[k]![i]!) * s;
  const w = (m[k]![j]! - m[j]![k]!) * s;
  return { v: q, w };
}
function quatToAngleAxis(q: { v: [number, number, number]; w: number }): { angle: number; axis: [number, number, number] } {
  const axis: [number, number, number] = [q.v[0], q.v[1], q.v[2]];
  const len = norm3(axis);
  let angle = 2.0 * Math.atan2(len, q.w);
  if (angle > Math.PI) {
    axis[0] = -axis[0];
    axis[1] = -axis[1];
    axis[2] = -axis[2];
    angle = Math.PI * 2.0 - angle;
  }
  return { angle, axis };
}
function frictionEvaluate(
  frictionType: number,
  parScale: number,
  perpScale: number,
  fVec: number[],
  fwd: number[],
  up: number[],
): [number, number, number] {
  if (frictionType === 0) return [fVec[0]!, fVec[1]!, fVec[2]!];
  let normal: number[];
  if (frictionType === 1) normal = fwd;
  else if (frictionType === 2) normal = cross3(up, fwd);
  else normal = up;
  const vn = dot3(fVec, normal);
  const par = [normal[0]! * vn, normal[1]! * vn, normal[2]! * vn];
  const perp = [fVec[0]! - par[0]!, fVec[1]! - par[1]!, fVec[2]! - par[2]!];
  return [
    par[0]! * parScale + perp[0]! * perpScale,
    par[1]! * parScale + perp[1]! * perpScale,
    par[2]! * parScale + perp[2]! * perpScale,
  ];
}

interface ExactPelicanState {
  pos: [number, number, number];
  vel: [number, number, number];
  angVel: [number, number, number];
  fwd: [number, number, number];
  up: [number, number, number];
  speed: number;
  hover: number;
}

/**
 * Literal 1:1 port of Halo CE's `update_human_plane_physics` (`vehicles.c:1492-1617`)
 * and `physics_update_old` (`physics.c:1669-2230`) across all 19 mass points of `vehicles\pelican\pelican.physics`.
 */
function stepExactPelicanTick(
  veh: ExactPelicanState,
  ctrlYaw: number,
  ctrlPitch: number,
  ctrlThrottleI: number,
  ctrlFlags: number,
): void {
  const global_gravity = 0.003565;
  const maxFwd = 0.50;
  const maxRev = 0.10;
  const CTRL_TO_RAD = Math.PI / 1000.0;

  const crouch = (ctrlFlags & 1) !== 0;
  const jump = (ctrlFlags & 2) !== 0 || (ctrlThrottleI > 0 && veh.speed < 0) || (ctrlThrottleI < 0 && veh.speed > 0);

  if (jump) {
    if (veh.speed < 0) veh.speed = Math.min(0, veh.speed + 0.03);
    else veh.speed = Math.max(0, veh.speed - 0.01);
  } else {
    const targetSpd = ctrlThrottleI >= 0 ? ctrlThrottleI * maxFwd : ctrlThrottleI * maxRev;
    if (veh.speed < targetSpd) veh.speed = Math.min(targetSpd, veh.speed + 0.03);
    else veh.speed = Math.max(targetSpd, veh.speed - 0.01);
  }

  let throttle = Math.max(0, Math.min(maxFwd, veh.speed)) / maxFwd;
  throttle = throttle * throttle;

  let factor = !crouch ? (jump ? 1.0 : 0.75) : 0.25;
  factor *= 1.0 - throttle;
  veh.hover += (factor * 1.0 - veh.hover) * 0.05;
  const thrust = throttle * 1.0;

  const yawRad = ctrlYaw * CTRL_TO_RAD;
  const pitchRad = ctrlPitch * CTRL_TO_RAD;
  const desired_forward: [number, number, number] = [
    Math.cos(yawRad) * Math.cos(pitchRad),
    Math.sin(yawRad) * Math.cos(pitchRad),
    Math.sin(pitchRad),
  ];
  const desired_up: [number, number, number] = [
    -(desired_forward[2] * desired_forward[0]),
    -(desired_forward[2] * desired_forward[1]),
    1.0 - desired_forward[2] * desired_forward[2],
  ];
  if (norm3(desired_up) === 0) {
    desired_up[0] = 1;
    desired_up[1] = 0;
    desired_up[2] = 0;
  }

  const dot = dot3(veh.vel, veh.fwd);
  const drive = (veh.speed - dot) * thrust * PELICAN_PHYS_DEF.mass * 0.05;
  const lift = (Math.abs(dot / maxFwd) * 1.05 + veh.hover * 1.3) * global_gravity * PELICAN_PHYS_DEF.mass;
  const magic_force: [number, number, number] = [
    lift * veh.up[0] + drive * veh.fwd[0],
    lift * veh.up[1] + drive * veh.fwd[1],
    lift * veh.up[2] + drive * veh.fwd[2],
  ];

  // Bank roll (`vehicles.c:1563-1576`: yaw_vectors(&desired_up, &desired_forward, sine(yaw), cosine(yaw)))
  const yawBank = ((veh.vel[1] * desired_forward[0] - veh.vel[0] * desired_forward[1]) * (Math.PI / 2)) / maxFwd;
  const crossFwdUp = cross3(desired_forward, desired_up);
  const sB = Math.sin(yawBank);
  const cB = Math.cos(yawBank);
  desired_up[0] = desired_up[0] * cB + crossFwdUp[0] * sB;
  desired_up[1] = desired_up[1] * cB + crossFwdUp[1] * sB;
  desired_up[2] = desired_up[2] * cB + crossFwdUp[2] * sB;

  const vehRot = matrixFromVectors(veh.fwd, veh.up);
  const desRot = matrixFromVectors(desired_forward, desired_up);
  const invDes = matrixInverse3(desRot);
  const relRot = matrixMultiply3(vehRot, invDes);
  const quat = matrixToQuat(relRot);
  const { angle, axis } = quatToAngleAxis(quat);
  const scaled = [axis[0] * (angle / 30.0), axis[1] * (angle / 30.0), axis[2] * (angle / 30.0)];
  const tScale = PELICAN_PHYS_DEF.radius * PELICAN_PHYS_DEF.radius * PELICAN_PHYS_DEF.mass * 0.05;
  const magic_torque: [number, number, number] = [
    (scaled[0]! - veh.angVel[0]) * tScale,
    (scaled[1]! - veh.angVel[1]) * tScale,
    (scaled[2]! - veh.angVel[2]) * tScale,
  ];

  const gravity = PELICAN_PHYS_DEF.gravityScale * global_gravity;
  const total_force: [number, number, number] = [
    magic_force[0],
    magic_force[1],
    magic_force[2] - PELICAN_PHYS_DEF.mass * gravity,
  ];
  const total_torque: [number, number, number] = [magic_torque[0], magic_torque[1], magic_torque[2]];
  const worldLeft = cross3(veh.up, veh.fwd);

  const mpRadii: Array<[number, number, number]> = [];
  for (let m = 0; m < PELICAN_PHYS_DEF.massPoints.length; m++) {
    const mp = PELICAN_PHYS_DEF.massPoints[m]!;
    const lx = mp.pos[0]! - PELICAN_PHYS_DEF.com[0];
    const ly = mp.pos[1]! - PELICAN_PHYS_DEF.com[1];
    const lz = mp.pos[2]! - PELICAN_PHYS_DEF.com[2];
    const rx = veh.fwd[0] * lx + worldLeft[0] * ly + veh.up[0] * lz;
    const ry = veh.fwd[1] * lx + worldLeft[1] * ly + veh.up[1] * lz;
    const rz = veh.fwd[2] * lx + worldLeft[2] * ly + veh.up[2] * lz;
    const radiusVec: [number, number, number] = [rx, ry, rz];
    mpRadii.push(radiusVec);

    const mpFwd = [
      veh.fwd[0] * mp.fwd[0]! + worldLeft[0] * mp.fwd[1]! + veh.up[0] * mp.fwd[2]!,
      veh.fwd[1] * mp.fwd[0]! + worldLeft[1] * mp.fwd[1]! + veh.up[1] * mp.fwd[2]!,
      veh.fwd[2] * mp.fwd[0]! + worldLeft[2] * mp.fwd[1]! + veh.up[2] * mp.fwd[2]!,
    ];
    const mpUp = [
      veh.fwd[0] * mp.up[0]! + worldLeft[0] * mp.up[1]! + veh.up[0] * mp.up[2]!,
      veh.fwd[1] * mp.up[0]! + worldLeft[1] * mp.up[1]! + veh.up[1] * mp.up[2]!,
      veh.fwd[2] * mp.up[0]! + worldLeft[2] * mp.up[1]! + veh.up[2] * mp.up[2]!,
    ];

    const wCrossR = cross3(veh.angVel, radiusVec);
    const mpVel = [veh.vel[0] + wCrossR[0], veh.vel[1] + wCrossR[1], veh.vel[2] + wCrossR[2]];
    const airScale = -mp.mass * PELICAN_PHYS_DEF.airFriction;
    const rawAirF = [mpVel[0]! * airScale, mpVel[1]! * airScale, mpVel[2]! * airScale];
    const airF = frictionEvaluate(mp.frictionType, mp.frictionParallel, mp.frictionPerp, rawAirF, mpFwd, mpUp);
    const mpTorque = cross3(radiusVec, airF);
    total_force[0] += airF[0];
    total_force[1] += airF[1];
    total_force[2] += airF[2];
    total_torque[0] += mpTorque[0];
    total_torque[1] += mpTorque[1];
    total_torque[2] += mpTorque[2];
  }

  const transAcc = [
    total_force[0] / PELICAN_PHYS_DEF.mass,
    total_force[1] / PELICAN_PHYS_DEF.mass,
    total_force[2] / PELICAN_PHYS_DEF.mass,
  ];
  const torqueAxis: [number, number, number] = [total_torque[0], total_torque[1], total_torque[2]];
  const torqueMag = norm3(torqueAxis);
  const angAcc = [0, 0, 0];
  if (torqueMag !== 0) {
    let moi = 0;
    for (let m = 0; m < PELICAN_PHYS_DEF.massPoints.length; m++) {
      const mp = PELICAN_PHYS_DEF.massPoints[m]!;
      const rVec = mpRadii[m]!;
      const proj = -dot3(rVec, torqueAxis);
      const perpR = [
        rVec[0] + torqueAxis[0] * proj,
        rVec[1] + torqueAxis[1] * proj,
        rVec[2] + torqueAxis[2] * proj,
      ];
      const perpSq = dot3(perpR, perpR);
      moi += (perpSq + mp.radius * mp.radius * 0.4) * mp.mass * PELICAN_PHYS_DEF.moment;
    }
    if (moi !== 0) {
      angAcc[0] = total_torque[0] / moi;
      angAcc[1] = total_torque[1] / moi;
      angAcc[2] = total_torque[2] / moi;
    }
  }

  veh.vel[0] += transAcc[0]!;
  veh.vel[1] += transAcc[1]!;
  veh.vel[2] += transAcc[2]!;
  veh.angVel[0] += angAcc[0]!;
  veh.angVel[1] += angAcc[1]!;
  veh.angVel[2] += angAcc[2]!;

  veh.pos[0] += veh.vel[0];
  veh.pos[1] += veh.vel[1];
  veh.pos[2] += veh.vel[2];

  const rotAxis: [number, number, number] = [veh.angVel[0], veh.angVel[1], veh.angVel[2]];
  const angSpd = norm3(rotAxis);
  if (angSpd !== 0) {
    const s = Math.sin(angSpd);
    const c = Math.cos(angSpd);
    rotateVectorAboutAxis(veh.fwd, rotAxis, s, c);
    rotateVectorAboutAxis(veh.up, rotAxis, s, c);
    norm3(veh.fwd);
    const orth = -dot3(veh.up, veh.fwd);
    veh.up[0] += orth * veh.fwd[0];
    veh.up[1] += orth * veh.fwd[1];
    veh.up[2] += orth * veh.fwd[2];
    norm3(veh.up);
  }
}

function wrapAngleRad(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

export function buildRecordedFlightStreamFromWaypoints(
  waypoints: Array<{ x: number; y: number; z: number }>,
  isExit = false,
): RecordedFlightSimulationResult {
  if (!waypoints || waypoints.length < 2) {
    return buildRecordedFlightStream100m(1, 0, 0, isExit);
  }
  const RAD_TO_CTRL = 1000.0 / Math.PI;
  const p0 = waypoints[0]!;
  const p1 = waypoints[1] ?? p0;
  let startYaw = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  if (startYaw > Math.PI) startYaw -= Math.PI * 2;
  if (startYaw < -Math.PI) startYaw += Math.PI * 2;

  let ctrlFlags = 0;
  let ctrlThrottleI = 1.0;
  let ctrlYaw = Math.max(-1000, Math.min(1000, Math.round(startYaw * RAD_TO_CTRL)));
  let ctrlPitch = 0;

  // Match `(object_teleport pelican wp_start)` initial orientation (`fwd = (cos(startYaw), sin(startYaw), 0)`, `up = (0, 0, 1)`)
  const fx0 = Math.cos(startYaw);
  const fy0 = Math.sin(startYaw);
  const fz0 = 0;

  const hasNodeBuffer = typeof Buffer !== 'undefined';
  const hdr = hasNodeBuffer ? Buffer.alloc(70, 0) : null;
  if (hdr) {
    hdr.writeUInt8(0x03, 0); // animation_state = 3
    hdr.writeUInt16LE(ctrlFlags, 2); // initial control_flags
    hdr.writeUInt8(0xff, 4);
    hdr.writeUInt8(0xff, 5);
    hdr.writeUInt8(0x03, 7);
    hdr.writeFloatLE(ctrlThrottleI, 8); // initial forward throttle = 1.0
    hdr.writeFloatLE(0.0, 12); // initial left slide throttle = 0.0
    for (const off of [16, 28, 40]) {
      hdr.writeFloatLE(fx0, off + 0);
      hdr.writeFloatLE(fy0, off + 4);
      hdr.writeFloatLE(fz0, off + 8);
    }
    hdr.writeUInt16LE(0xffff, 56);
    for (const off of [58, 62, 66]) {
      hdr.writeInt16LE(ctrlYaw, off + 0);
      hdr.writeInt16LE(ctrlPitch, off + 2);
    }
  }

  const events: Buffer[] = [];
  let lastEventTick = 0;

  const writeEventHeader = (eventType: number, dt: number): Buffer => {
    if (dt <= 0) {
      return Buffer.from([(eventType << 2) | 0]); // _time_delta_zero
    }
    if (dt === 1) {
      return Buffer.from([(eventType << 2) | 1]); // _time_delta_one
    }
    if (dt <= 255) {
      return Buffer.from([(eventType << 2) | 2, dt & 0xff]); // _time_delta_byte
    }
    const b = Buffer.alloc(3);
    b.writeUInt8((eventType << 2) | 3, 0); // _time_delta_word
    b.writeUInt16LE(dt & 0xffff, 1);
    return b;
  };

  const emitFlagsAtTick = (tick: number, newFlags: number) => {
    if (newFlags === ctrlFlags) return;
    if (hasNodeBuffer) {
      const dt = tick - lastEventTick;
      const h = writeEventHeader(4, dt);
      const d = Buffer.alloc(2);
      d.writeUInt16LE(newFlags & 0xffff, 0);
      events.push(Buffer.concat([h, d]));
    }
    lastEventTick = tick;
    ctrlFlags = newFlags;
  };

  const emitThrottleAtTick = (tick: number, newThrottleI: number) => {
    if (Math.abs(newThrottleI - ctrlThrottleI) < 1e-4) return;
    if (hasNodeBuffer) {
      const dt = tick - lastEventTick;
      const h = writeEventHeader(6, dt);
      const d = Buffer.alloc(8, 0);
      d.writeFloatLE(newThrottleI, 0);
      d.writeFloatLE(0.0, 4);
      events.push(Buffer.concat([h, d]));
    }
    lastEventTick = tick;
    ctrlThrottleI = newThrottleI;
  };

  const emitAimAtTick = (tick: number, targetYawShort: number, targetPitchShort: number) => {
    const clampedYaw = Math.max(-1000, Math.min(1000, Math.round(targetYawShort)));
    const clampedPitch = Math.max(-500, Math.min(500, Math.round(targetPitchShort)));
    const dYaw = clampedYaw - ctrlYaw;
    const dPitch = clampedPitch - ctrlPitch;
    if (dYaw === 0 && dPitch === 0) return;

    if (hasNodeBuffer) {
      const dt = tick - lastEventTick;
      if (Math.abs(dYaw) <= 120 && Math.abs(dPitch) <= 120) {
        const h = writeEventHeader(14, dt);
        const d = Buffer.alloc(2);
        d.writeInt8(dYaw, 0);
        d.writeInt8(dPitch, 1);
        events.push(Buffer.concat([h, d]));
      } else {
        const h = writeEventHeader(22, dt);
        const d = Buffer.alloc(4);
        d.writeInt16LE(dYaw, 0);
        d.writeInt16LE(dPitch, 2);
        events.push(Buffer.concat([h, d]));
      }
    }
    lastEventTick = tick;
    ctrlYaw = clampedYaw;
    ctrlPitch = clampedPitch;
  };

  const veh: ExactPelicanState = {
    pos: [p0.x, p0.y, p0.z],
    vel: [0, 0, 0],
    angVel: [0, 0, 0],
    fwd: [fx0, fy0, fz0],
    up: [0, 0, 1],
    speed: 0,
    hover: 0,
  };

  const waypointArrivalTicks: number[] = new Array(waypoints.length).fill(0);
  const trajectorySamples: Array<{ tick: number; x: number; y: number; z: number }> = [
    { tick: 0, x: p0.x, y: p0.y, z: p0.z },
  ];

  let curWp = 1;
  let settledTicks = 0;
  let totalTicks = 0;
  let zIntegral = 0;
  let landingLatched = false;
  const maxTotalTicks = Math.min(18000, Math.max(2400, waypoints.length * 1800));

  for (let tick = 0; tick < maxTotalTicks; tick++) {
    totalTicks = tick;
    const isFinalWp = curWp === waypoints.length - 1;
    const prevWp = waypoints[curWp - 1]!;
    const target = waypoints[curWp]!;
    const targetZ = target.z;
    const prevZ = prevWp.z;

    const dx = target.x - veh.pos[0];
    const dy = target.y - veh.pos[1];
    const dz = targetZ - veh.pos[2];
    const dist2d = Math.hypot(dx, dy);
    const spd2d = Math.hypot(veh.vel[0], veh.vel[1]);
    const spd3d = Math.hypot(veh.vel[0], veh.vel[1], veh.vel[2]);

    // Total remaining 2D path distance to the final LZ across any intermediate waypoints
    let distToFinalLz = dist2d;
    for (let k = curWp; k < waypoints.length - 1; k++) {
      distToFinalLz += Math.hypot(waypoints[k + 1]!.x - waypoints[k]!.x, waypoints[k + 1]!.y - waypoints[k]!.y);
    }

    const segDx = target.x - prevWp.x;
    const segDy = target.y - prevWp.y;
    const segDz = targetZ - prevZ;
    const segLen2d = Math.hypot(segDx, segDy);
    let carrotZ = targetZ;

    if (segLen2d > 0.5) {
      const ux = segDx / segLen2d;
      const uy = segDy / segLen2d;
      const relX = veh.pos[0] - prevWp.x;
      const relY = veh.pos[1] - prevWp.y;
      const along = Math.max(0, Math.min(segLen2d, relX * ux + relY * uy));
      const lookahead = Math.min(segLen2d - along, Math.max(3.5, spd2d * 15.0));
      const carrotAlong = along + lookahead;
      carrotZ = prevZ + segDz * (carrotAlong / segLen2d);
    }

    if (!isFinalWp) {
      const segUx = segLen2d > 0.1 ? segDx / segLen2d : 0;
      const segUy = segLen2d > 0.1 ? segDy / segLen2d : 0;
      const remainingAlong = dx * segUx + dy * segUy;
      let leadSwitch = Math.max(1.2, spd2d * 6.5);
      if (curWp + 1 < waypoints.length) {
        const nextWp = waypoints[curWp + 1]!;
        const h1 = Math.atan2(segDy, segDx);
        const h2 = Math.atan2(nextWp.y - target.y, nextWp.x - target.x);
        const turnAng = Math.abs(wrapAngleRad(h2 - h1));
        leadSwitch = Math.max(leadSwitch, spd2d * (8.0 + turnAng * 18.0));
      }
      if (dist2d < leadSwitch || remainingAlong < leadSwitch * 0.85) {
        waypointArrivalTicks[curWp] = tick;
        curWp++;
        continue;
      }
    } else if (isExit) {
      if (dist2d < 4.5) {
        waypointArrivalTicks[curWp] = tick;
        break;
      }
    } else {
      const segUx = segLen2d > 0.1 ? segDx / segLen2d : 0;
      const segUy = segLen2d > 0.1 ? segDy / segLen2d : 0;
      const remainingAlong = dx * segUx + dy * segUy;
      if (dist2d < 2.2 || remainingAlong <= 0.4) {
        if (!landingLatched) waypointArrivalTicks[curWp] = tick;
        landingLatched = true;
      }
      if (landingLatched && spd3d < 0.012 && Math.abs(dz) < 0.65) {
        settledTicks++;
        if (settledTicks >= 35) {
          waypointArrivalTicks[curWp] = tick;
          break;
        }
      } else {
        settledTicks = 0;
      }
    }

    if (tick % 3 === 0) {
      let desiredThrottle = 1.0;
      let desiredFlags = 0;

      // Turn anticipation if upcoming corner is sharp
      if (!isFinalWp && curWp + 1 < waypoints.length && dist2d < 34.0) {
        const nextWp = waypoints[curWp + 1]!;
        const curHeading = Math.atan2(dy, dx);
        const nextHeading = Math.atan2(nextWp.y - target.y, nextWp.x - target.x);
        const cornerAngle = Math.abs(wrapAngleRad(nextHeading - curHeading));
        if (cornerAngle > 0.20) {
          const vCorner = Math.max(0.12, 0.36 * (1.0 - Math.min(0.75, cornerAngle * 0.85)));
          if (spd2d > vCorner * 1.12 && dist2d < 22.0) {
            desiredThrottle = 0.0;
            desiredFlags = 2;
          } else {
            const cornerThr = Math.max(0.45, Math.sqrt(vCorner / 0.365));
            const blend = Math.max(0, Math.min(1, (34.0 - dist2d) / 34.0));
            desiredThrottle = Math.round((1.0 - blend * (1.0 - cornerThr)) * 10) / 10;
          }
        }
      }

      // Smooth deceleration in the final 24 wu before the final LZ
      if (!isExit && (distToFinalLz < 24.0 || landingLatched)) {
        if (landingLatched || (isFinalWp && dist2d < 1.2)) {
          desiredThrottle = 0.0;
          const zPred = dz - veh.vel[2] * 18.0;
          if (spd2d > 0.012) desiredFlags = 2;
          else if (zPred > 0.05) desiredFlags = 2;
          else if (zPred < -0.15) desiredFlags = 1;
          else desiredFlags = 0;
        } else {
          const vTarget = Math.min(0.36, Math.max(0.04, distToFinalLz * 0.015));
          if (spd2d > vTarget * 1.15 && spd2d > 0.045) {
            desiredThrottle = 0.0;
            desiredFlags = dz < -0.35 ? 1 : 2;
          } else {
            const rawThr = Math.min(1.0, Math.max(0.38, Math.sqrt(vTarget / 0.365)));
            desiredThrottle = Math.round(rawThr * 10) / 10;
            const zPred = dz - veh.vel[2] * 18.0;
            desiredFlags = zPred < -0.35 ? 1 : (zPred > 0.35 && desiredThrottle < 0.6 ? 2 : 0);
          }
        }
      }

      emitFlagsAtTick(tick, desiredFlags);
      emitThrottleAtTick(tick, desiredThrottle);

      // Critically-damped PD line-tracking guidance law (zero S-curve / zero weaving)
      const shipYaw = Math.atan2(veh.fwd[1], veh.fwd[0]);
      let cmdYaw = shipYaw;
      if (!landingLatched) {
        if (segLen2d > 0.5) {
          const ux = segDx / segLen2d;
          const uy = segDy / segLen2d;
          const segYaw = Math.atan2(segDy, segDx);
          const crossPos = (veh.pos[0] - prevWp.x) * (-uy) + (veh.pos[1] - prevWp.y) * ux;
          const crossVel = veh.vel[0] * (-uy) + veh.vel[1] * ux;
          const upCross = veh.up[0] * (-uy) + veh.up[1] * ux;

          const intercept = Math.max(
            -0.60,
            Math.min(0.60, -crossPos * 0.065 - crossVel * 2.25 - upCross * 0.30),
          );
          const desiredHeading = wrapAngleRad(segYaw + intercept);
          const headingErr = wrapAngleRad(desiredHeading - shipYaw);
          cmdYaw = wrapAngleRad(shipYaw + Math.max(-0.52, Math.min(0.52, headingErr * 1.30)));
        } else if (dist2d > 0.4) {
          const targetYaw = Math.atan2(dy, dx);
          const headingErr = wrapAngleRad(targetYaw - shipYaw);
          cmdYaw = wrapAngleRad(shipYaw + Math.max(-0.52, Math.min(0.52, headingErr)));
        }
      }

      const cdz = carrotZ - veh.pos[2];
      const segTargetVz = segLen2d > 1.0 ? (segDz / segLen2d) * spd2d : 0;
      zIntegral = Math.max(-0.25, Math.min(0.25, zIntegral + cdz * 0.0020));
      const desiredVz = Math.max(-0.20, Math.min(0.20, segTargetVz + cdz * 0.065));
      const vzErr = desiredVz - veh.vel[2];
      const rawPitch = landingLatched ? 0 : (zIntegral + cdz * 0.085 + vzErr * 1.75);
      const maxPitch = isFinalWp && dist2d < 6.0 ? 0.25 : 0.48;
      const cmdPitch = Math.max(-maxPitch, Math.min(maxPitch, rawPitch));

      emitAimAtTick(tick, Math.round(cmdYaw * RAD_TO_CTRL), Math.round(cmdPitch * RAD_TO_CTRL));
    }

    stepExactPelicanTick(veh, ctrlYaw, ctrlPitch, ctrlThrottleI, ctrlFlags);
    if (tick % 2 === 0) {
      trajectorySamples.push({ tick: tick + 1, x: veh.pos[0], y: veh.pos[1], z: veh.pos[2] });
    }
  }

  if (!isExit && ctrlFlags !== 0) {
    emitFlagsAtTick(totalTicks, 0);
  }

  for (let i = 1; i < waypointArrivalTicks.length; i++) {
    if (!waypointArrivalTicks[i] || waypointArrivalTicks[i]! <= 0) {
      waypointArrivalTicks[i] = totalTicks;
    }
  }

  const endDt = Math.max(1, totalTicks + 1 - lastEventTick);
  if (hasNodeBuffer) {
    events.push(writeEventHeader(1, endDt));
  }
  const finalTotalTicks = lastEventTick + endDt;

  let streamBuf: Buffer = undefined as unknown as Buffer;
  if (hasNodeBuffer && hdr) {
    // Append lossless `'OCWP'` waypoint trailer after `_playback_end` (ignored by Halo CE playback, read by decompiler)
    const wpCount = Math.min(64, waypoints.length);
    const trailer = Buffer.alloc(6 + wpCount * 12, 0);
    trailer.write('OCWP', 0, 'ascii');
    trailer.writeUInt16LE(wpCount, 4);
    for (let i = 0; i < wpCount; i++) {
      const w = waypoints[i]!;
      trailer.writeFloatLE(w.x, 6 + i * 12 + 0);
      trailer.writeFloatLE(w.y, 6 + i * 12 + 4);
      trailer.writeFloatLE(w.z, 6 + i * 12 + 8);
    }
    streamBuf = Buffer.concat([hdr, ...events, trailer]);
  }

  return {
    stream: streamBuf,
    totalTicks: finalTotalTicks,
    waypointArrivalTicks,
    trajectorySamples,
  };
}

/**
 * Fallback 100m approach/departure stream synthesized through `buildRecordedFlightStreamFromWaypoints`.
 */
function buildRecordedFlightStream100m(
  dirX: number,
  dirY: number,
  yawAngleRad: number,
  isExit = false,
): RecordedFlightSimulationResult {
  const len = Math.hypot(dirX, dirY) || 1;
  const fx = dirX / len;
  const fy = dirY / len;
  const rx = -fy;
  const ry = fx;
  if (!isExit) {
    return buildRecordedFlightStreamFromWaypoints(
      [
        { x: 0, y: 0, z: 7.0 },
        { x: fx * 14 + rx * 4, y: fy * 14 + ry * 4, z: 4.2 },
        { x: fx * 28, y: fy * 28, z: 1.2 },
      ],
      false,
    );
  }
  return buildRecordedFlightStreamFromWaypoints(
    [
      { x: 0, y: 0, z: 1.2 },
      { x: fx * 16 + rx * 6, y: fy * 16 + ry * 6, z: 5.5 },
      { x: fx * 36 + rx * 10, y: fy * 36 + ry * 10, z: 11.0 },
    ],
    true,
  );
}

function toTagString31(name: string): string {
  return name.trim().slice(0, 31);
}

/**
 * Prunes unreferenced script/builder-generated entities (and deduplicates any repeated names)
 * from the scenario's `cutscene flags`, `recorded animations`, `cutscene camera points`,
 * `trigger volumes`, `command lists`, `encounters`, and `object names` (+ bound `vehicles`,
 * `bipeds`, `machines`, and `controls` placements) so deleting a script or 3D event instance
 * cleanly removes all of its 3D items from the map and 3D Viewport.
 */
function pruneUnreferencedScriptEntities(
  view: Buffer,
  active: {
    objectNames: Set<string>;
    triggerVolumes: Set<string>;
    cameraPoints: Set<string>;
    cutsceneFlags: Set<string>;
    recordedAnimations: Set<string>;
    encounters: Set<string>;
    commandLists: Set<string>;
  },
): Buffer {
  const current = Buffer.from(view);
  const header = parseCacheFileHeader(current);
  const tagIndex = parseTagIndex(current, header);
  const scenario = scenarioEntryOf(tagIndex);
  if (!scenario) return current;
  const scnrAt = resolveTagDataPointer(
    scenario.tagDataPointerOrResourceIndex,
    header,
    tagIndex.baseMemoryAddress,
  );
  if (!isRangeInBuffer(scnrAt, 0x5c0, current.length)) return current;

  const normSet = (s: Set<string>): Set<string> => {
    const out = new Set<string>();
    for (const v of s) {
      const clean = v.split('/')[0]!.trim().toLowerCase();
      if (clean) {
        out.add(clean);
        out.add(clean.slice(0, 31));
      }
    }
    return out;
  };

  const actObj = normSet(active.objectNames);
  const actTrig = normSet(active.triggerVolumes);
  const actCam = normSet(active.cameraPoints);
  const actFlag = normSet(active.cutsceneFlags);
  const actAnim = normSet(active.recordedAnimations);
  const actEnc = normSet(active.encounters);
  const actCmd = normSet(active.commandLists);

  const isBuilderManaged = (
    nm: string,
    kind: 'obj' | 'flag' | 'anim' | 'cam' | 'trig' | 'enc' | 'cmd',
  ): boolean => {
    const low = nm.toLowerCase();
    if (low.includes('launch_interactive_builder')) return true;
    switch (kind) {
      case 'flag':
        return /^(wp_|.*_flag|drop_|insert_)/i.test(low);
      case 'anim':
        return /^(fly_|pelican_fly|dropship_fly)/i.test(low);
      case 'cam':
        return /^(cam_)/i.test(low);
      case 'trig':
        return /^(trig_)/i.test(low) && !/^trig_bsp_/i.test(low);
      case 'cmd':
        return /^(cmd_)/i.test(low);
      case 'enc':
        return /^(unsc_|cov_|squad_|crew_|vehicle_crew|friendly_|enemy_|reinforce|ambush|patrol)/i.test(low);
      case 'obj':
        return /^(pelican|cdropship|dropship|scorpion|wraith|warthog|cov_ghost|ghost_|unit_|cargo_|npc_|marine_|elite_|grunt_|unsc_tank|cov_wraith|drop_hog|hog_insert|door_machine|door_prox|door_main|switch_control|cutscene_rig|battle_zone|shade_turret)/i.test(
          low,
        );
    }
  };

  const readStr32 = (buf: Buffer, off: number): string => {
    const z = buf.indexOf(0, off);
    const end = z >= off && z < off + 32 ? z : off + 32;
    return buf.toString('latin1', off, end).trim();
  };

  const compactReflexive = (
    reflexiveOff: number,
    elemSize: number,
    strOffset: number,
    activeLower: Set<string>,
    kind: 'flag' | 'anim' | 'cam' | 'trig' | 'enc' | 'cmd',
  ) => {
    const count = current.readInt32LE(scnrAt + reflexiveOff);
    const ptr = current.readUInt32LE(scnrAt + reflexiveOff + 4);
    if (count <= 0 || ptr < tagIndex.baseMemoryAddress) return;
    const baseOff = resolvePointer(ptr, header.tagDataOffset, tagIndex.baseMemoryAddress);
    if (!isRangeInBuffer(baseOff, count * elemSize, current.length)) return;

    const kept: Buffer[] = [];
    const seenLower = new Set<string>();
    for (let i = 0; i < count; i++) {
      const eOff = baseOff + i * elemSize;
      const nm = readStr32(current, eOff + strOffset);
      const low = nm.toLowerCase();
      if (!nm || seenLower.has(low)) continue;
      const isActive = activeLower.has(low) || activeLower.has(low.slice(0, 31));
      if (isActive || !isBuilderManaged(nm, kind)) {
        seenLower.add(low);
        kept.push(Buffer.from(current.subarray(eOff, eOff + elemSize)));
      }
    }
    if (kept.length !== count) {
      current.fill(0, baseOff, baseOff + count * elemSize);
      for (let i = 0; i < kept.length; i++) {
        kept[i]!.copy(current, baseOff + i * elemSize);
      }
      current.writeInt32LE(kept.length, scnrAt + reflexiveOff);
      if (kept.length === 0) {
        current.writeUInt32LE(0, scnrAt + reflexiveOff + 4);
      }
    }
  };

  compactReflexive(0x4e4, 92, 4, actFlag, 'flag'); // cutscene flags
  compactReflexive(0x36c, 64, 0, actAnim, 'anim'); // recorded animations
  compactReflexive(0x4f0, 104, 4, actCam, 'cam'); // cutscene camera points
  compactReflexive(0x360, 96, 4, actTrig, 'trig'); // trigger volumes
  compactReflexive(0x438, 96, 0, actCmd, 'cmd'); // command lists
  compactReflexive(0x42c, 176, 0, actEnc, 'enc'); // encounters

  // Prune unreferenced builder `object names` (+0x204, 36B) and their bound `bipeds` (+0x228, 120B), `vehicles` (+0x240, 120B), `machines` (+0x294, 64B), `controls` (+0x2ac, 64B)
  const objCount = current.readInt32LE(scnrAt + 0x204);
  const objPtr = current.readUInt32LE(scnrAt + 0x204 + 4);
  if (objCount > 0 && objPtr >= tagIndex.baseMemoryAddress) {
    const objBase = resolvePointer(objPtr, header.tagDataOffset, tagIndex.baseMemoryAddress);
    if (isRangeInBuffer(objBase, objCount * 36, current.length)) {
      const oldToNewObjIdx = new Map<number, number>();
      const keptObjBuffers: Buffer[] = [];
      const seenObjLower = new Set<string>();

      for (let i = 0; i < objCount; i++) {
        const oOff = objBase + i * 36;
        const nm = readStr32(current, oOff);
        const low = nm.toLowerCase();
        if (!nm || seenObjLower.has(low)) continue;
        const isActive = actObj.has(low) || actObj.has(low.slice(0, 31));
        if (isActive || !isBuilderManaged(nm, 'obj')) {
          seenObjLower.add(low);
          const newIdx = keptObjBuffers.length;
          oldToNewObjIdx.set(i, newIdx);
          keptObjBuffers.push(Buffer.from(current.subarray(oOff, oOff + 36)));
        }
      }

      if (keptObjBuffers.length !== objCount) {
        current.fill(0, objBase, objBase + objCount * 36);
        for (let i = 0; i < keptObjBuffers.length; i++) {
          keptObjBuffers[i]!.copy(current, objBase + i * 36);
        }
        current.writeInt32LE(keptObjBuffers.length, scnrAt + 0x204);
        if (keptObjBuffers.length === 0) {
          current.writeUInt32LE(0, scnrAt + 0x204 + 4);
        }

        // Compact placement tables whose `nameIndex` (+2) was bound to a pruned `object name`
        const placementTables: Array<{ off: number; elemSize: number; objType: number }> = [
          { off: 0x228, elemSize: 120, objType: 0 }, // bipeds
          { off: 0x240, elemSize: 120, objType: 1 }, // vehicles
          { off: 0x294, elemSize: 64, objType: 7 }, // machines
          { off: 0x2ac, elemSize: 64, objType: 8 }, // controls
        ];

        for (const tbl of placementTables) {
          const pCount = current.readInt32LE(scnrAt + tbl.off);
          const pPtr = current.readUInt32LE(scnrAt + tbl.off + 4);
          if (pCount <= 0 || pPtr < tagIndex.baseMemoryAddress) continue;
          const pBase = resolvePointer(pPtr, header.tagDataOffset, tagIndex.baseMemoryAddress);
          if (!isRangeInBuffer(pBase, pCount * tbl.elemSize, current.length)) continue;

          const keptPlacements: Buffer[] = [];
          for (let k = 0; k < pCount; k++) {
            const pOff = pBase + k * tbl.elemSize;
            const oldNameIdx = current.readInt16LE(pOff + 2);
            if (oldNameIdx < 0) {
              // Unnamed placement (e.g. standard multiplayer vehicle): always keep
              keptPlacements.push(Buffer.from(current.subarray(pOff, pOff + tbl.elemSize)));
            } else if (oldToNewObjIdx.has(oldNameIdx)) {
              const newNameIdx = oldToNewObjIdx.get(oldNameIdx)!;
              const newPlaceIdx = keptPlacements.length;
              const elemCopy = Buffer.from(current.subarray(pOff, pOff + tbl.elemSize));
              elemCopy.writeInt16LE(newNameIdx, 2);
              keptPlacements.push(elemCopy);
              // Update object names[newNameIdx].placementIndex
              const newObjOff = objBase + newNameIdx * 36;
              if (newObjOff + 36 <= current.length) {
                current.writeInt16LE(tbl.objType, newObjOff + 32);
                current.writeInt16LE(newPlaceIdx, newObjOff + 34);
              }
            }
          }

          if (keptPlacements.length !== pCount) {
            current.fill(0, pBase, pBase + pCount * tbl.elemSize);
            for (let k = 0; k < keptPlacements.length; k++) {
              keptPlacements[k]!.copy(current, pBase + k * tbl.elemSize);
            }
            current.writeInt32LE(keptPlacements.length, scnrAt + tbl.off);
            if (keptPlacements.length === 0) {
              current.writeUInt32LE(0, scnrAt + tbl.off + 4);
            }
          }
        }
      }
    }
  }

  return current;
}

/**
 * Ensures that the scenario has the requested `object names`, `trigger volumes`, `cutscene camera points`,
 * `cutscene flags`, `recorded animations`, and `encounters` so any sample script can immediately reference
 * them without manual reflexive table setup.
 */
export function ensureScenarioScriptEntities(
  view: Buffer,
  required: {
    objectNames?: string[];
    triggerVolumes?: string[];
    cameraPoints?: string[];
    cutsceneFlags?: string[];
    recordedAnimations?: string[];
    encounters?: string[];
    deviceGroups?: string[];
    commandLists?: string[];
    cutsceneTitles?: string[];
    tagReferences?: Array<{ path: string; hsType: number }>;
    customCutsceneTitleTimings?: Record<string, { fadeIn: number; upTime: number; fadeOut: number }>;
    customFlightWaypoints?: Record<string, Array<{ x: number; y: number; z: number }>>;
    customWaypointCoords?: Record<string, { x: number; y: number; z: number; yaw?: number }>;
    customObjectCoords?: Record<string, { x: number; y: number; z: number; yaw?: number }>;
    customEncounterCoords?: Record<string, { x: number; y: number; z: number; yaw?: number }>;
    customCameraCoords?: Record<string, { x: number; y: number; z: number; yaw?: number; pitch?: number }>;
    customTriggerCoords?: Record<string, { x: number; y: number; z: number; ex?: number; ey?: number; ez?: number }>;
    customCommandListPaths?: Record<string, Array<{ x: number; y: number; z: number }>>;
    pruneUnreferenced?: boolean;
  },
): { buffer: Buffer; addedObjectNames: string[]; addedTriggerVolumes: string[]; addedCameraPoints: string[] } {
  // Normalize all requested entity names and coordinate map keys to Halo CE's 31-character tag_string limit
  const normList = (arr?: string[]) =>
    Array.from(new Set((arr ?? []).map((s) => (s.includes('/') ? `${toTagString31(s.split('/')[0]!)}/${toTagString31(s.split('/')[1]!)}` : toTagString31(s))).filter(Boolean)));
  const normRecord = <T>(rec?: Record<string, T>): Record<string, T> | undefined => {
    if (!rec) return undefined;
    const out: Record<string, T> = {};
    for (const [k, v] of Object.entries(rec)) {
      out[k] = v;
      out[toTagString31(k)] = v;
      out[toTagString31(k).toLowerCase()] = v;
    }
    return out;
  };

  required = {
    ...required,
    objectNames: normList(required.objectNames),
    triggerVolumes: normList(required.triggerVolumes),
    cameraPoints: normList(required.cameraPoints),
    cutsceneFlags: normList(required.cutsceneFlags),
    recordedAnimations: normList(required.recordedAnimations),
    encounters: normList(required.encounters),
    deviceGroups: normList(required.deviceGroups),
    commandLists: normList(required.commandLists),
    cutsceneTitles: normList(required.cutsceneTitles),
    customFlightWaypoints: normRecord(required.customFlightWaypoints),
    customWaypointCoords: normRecord(required.customWaypointCoords),
    customObjectCoords: normRecord(required.customObjectCoords),
    customEncounterCoords: normRecord(required.customEncounterCoords),
    customCameraCoords: normRecord(required.customCameraCoords),
    customTriggerCoords: normRecord(required.customTriggerCoords),
    customCommandListPaths: normRecord(required.customCommandListPaths),
  };

  let current: Buffer = required.pruneUnreferenced
    ? pruneUnreferencedScriptEntities(view, {
        objectNames: new Set(required.objectNames ?? []),
        triggerVolumes: new Set(required.triggerVolumes ?? []),
        cameraPoints: new Set(required.cameraPoints ?? []),
        cutsceneFlags: new Set(required.cutsceneFlags ?? []),
        recordedAnimations: new Set(required.recordedAnimations ?? []),
        encounters: new Set(required.encounters ?? []),
        commandLists: new Set(required.commandLists ?? []),
      })
    : Buffer.from(view);
  const header = parseCacheFileHeader(current);
  const tagIndex = parseTagIndex(current, header);
  const scenario = scenarioEntryOf(tagIndex);
  if (!scenario) {
    return { buffer: current, addedObjectNames: [], addedTriggerVolumes: [], addedCameraPoints: [] };
  }

  const decompiled = decompileScenarioScripts(current);
  const existingObj = new Set(decompiled.scenarioEntities.objectNames);
  const existingTrigList = decompiled.scenarioEntities.triggerVolumes;
  const existingCamList = decompiled.scenarioEntities.cutsceneCameraPoints;
  const existingFlagList = decompiled.scenarioEntities.cutsceneFlags;
  const existingAnimList = decompiled.scenarioEntities.recordedAnimations;
  const existingEncList = decompiled.scenarioEntities.encounters;
  const existingDevGroupList = decompiled.scenarioEntities.deviceGroups ?? [];
  const existingCmdListList = decompiled.scenarioEntities.commandLists ?? [];
  const existingTitleList = decompiled.scenarioEntities.cutsceneTitles ?? [];
  const existingTrig = new Set(existingTrigList);
  const existingCam = new Set(existingCamList);
  const existingFlag = new Set(existingFlagList);
  const existingAnim = new Set(existingAnimList);
  const existingEnc = new Set(existingEncList);
  const existingDevGroup = new Set(existingDevGroupList);
  const existingCmdList = new Set(existingCmdListList);
  const existingTitle = new Set(existingTitleList);

  const addedObjectNames: string[] = [];
  const addedTriggerVolumes: string[] = [];
  const addedCameraPoints: string[] = [];

  let curHeader = header;
  let curTagIndex = tagIndex;
  const anchor = resolveScenarioAnchor(current, curHeader, curTagIndex);
  const fwdX = Math.cos(anchor.facing);
  const fwdY = Math.sin(anchor.facing);
  const rightX = -fwdY;
  const rightY = fwdX;

  for (const objName of required.objectNames ?? []) {
    if (existingObj.has(objName)) continue;
    const addRes = addReflexiveChunk(current, curHeader, curTagIndex, scenario.index, 'object names', -1);
    current = addRes.buffer;
    curHeader = addRes.header;
    curTagIndex = addRes.tagIndex;
    const idx = addRes.newElementIndex;
    writeTagFieldValue(current, curHeader, curTagIndex, scenario.index, `object names[${idx}].name`, objName);
    // Default runtime object type: 7 (machine) for door/gate/shutter, 0 (biped) for marine/elite/grunt/npc/rider, 1 (vehicle) otherwise
    const defaultObjType = /door|gate|shutter|switch|lift|elevator/i.test(objName)
      ? 7
      : /marine|elite|grunt|jackal|hunter|cyborg|biped|npc|chief|rider|ai_/i.test(objName)
        ? 0
        : 1;
    current.writeInt16LE(defaultObjType, addRes.newElementOffset + 32);
    current.writeInt16LE(-1, addRes.newElementOffset + 34);
    existingObj.add(objName);
    addedObjectNames.push(objName);
  }

  const writeTriggerVolumeGeometry = (
    elemOff: number,
    indexOffset: number,
    customTrig?: { x: number; y: number; z: number; ex?: number; ey?: number; ez?: number },
  ) => {
    const extX = customTrig?.ex ?? 10.0;
    const extY = customTrig?.ey ?? 10.0;
    const extZ = customTrig?.ez ?? 5.0;
    const cornerX = customTrig ? customTrig.x - extX * 0.5 : anchor.x + fwdX * (5 + indexOffset * 4) - 5.0;
    const cornerY = customTrig ? customTrig.y - extY * 0.5 : anchor.y + fwdY * (5 + indexOffset * 4) - 5.0;
    const cornerZ = customTrig ? customTrig.z - 1.0 : anchor.z - 1.0;
    current.writeUInt16LE(1, elemOff + 0); // scenario_trigger_volume initialized flag = 1
    current.writeFloatLE(1.0, elemOff + 48); // rotation vector forward.i
    current.writeFloatLE(0.0, elemOff + 52); // rotation vector forward.j
    current.writeFloatLE(0.0, elemOff + 56); // rotation vector forward.k
    current.writeFloatLE(0.0, elemOff + 60); // rotation vector up.i
    current.writeFloatLE(0.0, elemOff + 64); // rotation vector up.j
    current.writeFloatLE(1.0, elemOff + 68); // rotation vector up.k
    current.writeFloatLE(cornerX, elemOff + 72); // starting corner.x
    current.writeFloatLE(cornerY, elemOff + 76); // starting corner.y
    current.writeFloatLE(cornerZ, elemOff + 80); // starting corner.z
    current.writeFloatLE(extX, elemOff + 84); // ending corner offset (extents.x)
    current.writeFloatLE(extY, elemOff + 88); // ending corner offset (extents.y)
    current.writeFloatLE(extZ, elemOff + 92); // ending corner offset (extents.z)
  };

  for (let tIdx = 0; tIdx < (required.triggerVolumes ?? []).length; tIdx++) {
    const trigName = required.triggerVolumes![tIdx]!;
    const customTrig = required.customTriggerCoords?.[trigName] ?? required.customTriggerCoords?.[trigName.toLowerCase()];
    if (existingTrig.has(trigName)) {
      // Repair any previously created trigger volume that had 0 extents or u16@0 == 0, or update if customTriggerCoords provided
      const existingIdx = existingTrigList.indexOf(trigName);
      if (existingIdx >= 0) {
        const scnrAt = resolveTagDataPointer(
          curTagIndex.entries[scenario.index]!.tagDataPointerOrResourceIndex,
          curHeader,
          curTagIndex.baseMemoryAddress,
        );
        const dec = decodeStruct(current, scnrAt, getGroupStructName('scenario')!);
        const tvRef = dec.get('trigger volumes');
        if (tvRef?.kind === 'reflexive' && existingIdx < tvRef.value.count) {
          const tvBase = resolvePointer(tvRef.value.pointerLow, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
          const elemOff = tvBase + existingIdx * 96;
          if (elemOff + 96 <= current.length) {
            const flag0 = current.readUInt16LE(elemOff + 0);
            const extX = current.readFloatLE(elemOff + 84);
            const extY = current.readFloatLE(elemOff + 88);
            const extZ = current.readFloatLE(elemOff + 92);
            if (customTrig || flag0 === 0 || extX <= 0.01 || extY <= 0.01 || extZ <= 0.01) {
              writeTriggerVolumeGeometry(elemOff, tIdx, customTrig);
            }
          }
        }
      }
      continue;
    }
    const addRes = addReflexiveChunk(current, curHeader, curTagIndex, scenario.index, 'trigger volumes', -1);
    current = addRes.buffer;
    curHeader = addRes.header;
    curTagIndex = addRes.tagIndex;
    const idx = addRes.newElementIndex;
    writeTagFieldValue(current, curHeader, curTagIndex, scenario.index, `trigger volumes[${idx}].name`, trigName);
    writeTriggerVolumeGeometry(addRes.newElementOffset, tIdx, customTrig);
    existingTrig.add(trigName);
    existingTrigList.push(trigName);
    addedTriggerVolumes.push(trigName);
  }

  const writeCameraPointGeometry = (
    elemOff: number,
    cIdx: number,
    customCam?: { x: number; y: number; z: number; yaw?: number; pitch?: number },
  ) => {
    const camX = customCam ? customCam.x : anchor.x - fwdX * (6 - cIdx * 4) + (cIdx - 1) * 3.0;
    const camY = customCam ? customCam.y : anchor.y - fwdY * (6 - cIdx * 4) + (cIdx - 1) * 3.0;
    const camZ = customCam ? customCam.z : anchor.z + 2.5 + cIdx * 0.6;
    const camYaw = customCam?.yaw !== undefined ? customCam.yaw : anchor.facing;
    const camPitch = customCam?.pitch !== undefined ? customCam.pitch : -0.18;
    current.writeFloatLE(camX, elemOff + 40); // position.x
    current.writeFloatLE(camY, elemOff + 44); // position.y
    current.writeFloatLE(camZ, elemOff + 48); // position.z
    current.writeFloatLE(camYaw, elemOff + 52); // orientation yaw
    current.writeFloatLE(camPitch, elemOff + 56); // orientation pitch
    current.writeFloatLE(0.0, elemOff + 60); // orientation roll
    current.writeFloatLE(1.22173, elemOff + 64); // field of view (70 deg in radians)
  };

  for (let c = 0; c < (required.cameraPoints ?? []).length; c++) {
    const camName = required.cameraPoints![c]!;
    const customCam = required.customCameraCoords?.[camName] ?? required.customCameraCoords?.[camName.toLowerCase()];
    if (existingCam.has(camName)) {
      const existingIdx = existingCamList.indexOf(camName);
      if (existingIdx >= 0) {
        const scnrAt = resolveTagDataPointer(
          curTagIndex.entries[scenario.index]!.tagDataPointerOrResourceIndex,
          curHeader,
          curTagIndex.baseMemoryAddress,
        );
        const dec = decodeStruct(current, scnrAt, getGroupStructName('scenario')!);
        const camRef = dec.get('cutscene camera points');
        if (camRef?.kind === 'reflexive' && existingIdx < camRef.value.count) {
          const camBase = resolvePointer(camRef.value.pointerLow, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
          const elemOff = camBase + existingIdx * 104;
          if (elemOff + 104 <= current.length) {
            const fov = current.readFloatLE(elemOff + 64);
            const cx = current.readFloatLE(elemOff + 40);
            const cy = current.readFloatLE(elemOff + 44);
            if (customCam || fov <= 0.01 || (cx === 0 && cy === 0)) {
              writeCameraPointGeometry(elemOff, c, customCam);
            }
          }
        }
      }
      continue;
    }
    const addRes = addReflexiveChunk(current, curHeader, curTagIndex, scenario.index, 'cutscene camera points', -1);
    current = addRes.buffer;
    curHeader = addRes.header;
    curTagIndex = addRes.tagIndex;
    const idx = addRes.newElementIndex;
    writeTagFieldValue(current, curHeader, curTagIndex, scenario.index, `cutscene camera points[${idx}].name`, camName);
    writeCameraPointGeometry(addRes.newElementOffset, c, customCam);
    existingCam.add(camName);
    existingCamList.push(camName);
    addedCameraPoints.push(camName);
  }

  // Ensure requested Cutscene Flags (type 12) exist with sensible positions/facings (or custom @waypoint coordinates)
  for (let f = 0; f < (required.cutsceneFlags ?? []).length; f++) {
    const flagName = required.cutsceneFlags![f]!;
    const customCoord = required.customWaypointCoords?.[flagName] ?? required.customWaypointCoords?.[flagName.toLowerCase()];
    if (existingFlag.has(flagName)) {
      if (customCoord) {
        const existingIdx = existingFlagList.indexOf(flagName);
        if (existingIdx >= 0) {
          const scnrAtF = resolveTagDataPointer(
            curTagIndex.entries[scenario.index]!.tagDataPointerOrResourceIndex,
            curHeader,
            curTagIndex.baseMemoryAddress,
          );
          const decF = decodeStruct(current, scnrAtF, getGroupStructName('scenario')!);
          const flgRef = decF.get('cutscene flags');
          if (flgRef?.kind === 'reflexive' && existingIdx < flgRef.value.count) {
            const flgBase = resolvePointer(flgRef.value.pointerLow, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
            const fOff = flgBase + existingIdx * 92;
            if (fOff + 92 <= current.length) {
              current.writeFloatLE(customCoord.x, fOff + 36);
              current.writeFloatLE(customCoord.y, fOff + 40);
              current.writeFloatLE(customCoord.z, fOff + 44);
              if (customCoord.yaw !== undefined && Number.isFinite(customCoord.yaw)) {
                current.writeFloatLE(customCoord.yaw, fOff + 48);
              }
              current.writeFloatLE(0.0, fOff + 52);
            }
          }
        }
      }
      continue;
    }
    const addRes = addReflexiveChunk(current, curHeader, curTagIndex, scenario.index, 'cutscene flags', -1);
    current = addRes.buffer;
    curHeader = addRes.header;
    curTagIndex = addRes.tagIndex;
    const idx = addRes.newElementIndex;
    writeTagFieldValue(current, curHeader, curTagIndex, scenario.index, `cutscene flags[${idx}].name`, flagName);
    const elemOff = addRes.newElementOffset;
    const lowerFlag = flagName.toLowerCase();
    const isCovSide = lowerFlag.includes('dropship') || lowerFlag.includes('cov') || lowerFlag.includes('east') || lowerFlag.includes('wraith');
    const dist = lowerFlag.includes('start') ? (isCovSide ? 25 : -10) : 8;
    const side = (f % 4 - 1.5) * 4.5;
    const fx = customCoord ? customCoord.x : anchor.x + fwdX * dist + rightX * side;
    const fy = customCoord ? customCoord.y : anchor.y + fwdY * dist + rightY * side;
    const fz = customCoord ? customCoord.z : anchor.z + (lowerFlag.includes('air') || lowerFlag.includes('pelican') || lowerFlag.includes('dropship') ? 5.5 : 0.4);
    const fyaw = customCoord?.yaw !== undefined ? customCoord.yaw : isCovSide ? anchor.facing + Math.PI : anchor.facing;
    current.writeFloatLE(fx, elemOff + 36);
    current.writeFloatLE(fy, elemOff + 40);
    current.writeFloatLE(fz, elemOff + 44);
    current.writeFloatLE(fyaw, elemOff + 48);
    current.writeFloatLE(0.0, elemOff + 52);
    existingFlag.add(flagName);
    existingFlagList.push(flagName);
  }

  // Repair any corrupted/empty Recorded Animations (e.g. from legacy netgame flags offset bug) and ensure requested ones exist
  {
    const scnrAt = resolveTagDataPointer(
      curTagIndex.entries[scenario.index]!.tagDataPointerOrResourceIndex,
      curHeader,
      curTagIndex.baseMemoryAddress,
    );
    const dec = decodeStruct(current, scnrAt, getGroupStructName('scenario')!);
    const animRef = dec.get('recorded animations');
    if (animRef?.kind === 'reflexive' && animRef.value.count > 0) {
      const animBase = resolvePointer(animRef.value.pointerLow, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
      const validAnims: Buffer[] = [];
      let hadCorruptAnim = false;
      for (let i = 0; i < animRef.value.count; i++) {
        const aOff = animBase + i * 64;
        if (aOff + 64 > current.length) break;
        const ver = current.readUInt8(aOff + 32);
        const streamLen = current.readInt32LE(aOff + 44);
        const streamPtr = current.readUInt32LE(aOff + 56);
        const z = current.indexOf(0, aOff);
        const nm = current.toString('latin1', aOff, z >= aOff && z < aOff + 32 ? z : aOff + 32).trim();
        const isCleanName = /^[a-zA-Z0-9_.-]+$/.test(nm);
        if (ver === 4 && streamLen > 0 && streamPtr > 0 && isCleanName) {
          validAnims.push(Buffer.from(current.subarray(aOff, aOff + 64)));
        } else {
          hadCorruptAnim = true;
        }
      }
      if (hadCorruptAnim) {
        current.fill(0, animBase, animBase + animRef.value.count * 64);
        for (let i = 0; i < validAnims.length; i++) {
          validAnims[i]!.copy(current, animBase + i * 64);
        }
        current.writeUInt32LE(validAnims.length, scnrAt + 0x36c);
        if (validAnims.length === 0) {
          current.writeUInt32LE(0, scnrAt + 0x370);
        }
        existingAnim.clear();
        existingAnimList.length = 0;
        for (let i = 0; i < validAnims.length; i++) {
          const z = validAnims[i]!.indexOf(0);
          const nm = validAnims[i]!.toString('latin1', 0, z >= 0 && z < 32 ? z : 32).trim();
          if (nm) {
            existingAnim.add(nm);
            existingAnimList.push(nm);
          }
        }
      }
    }
  }

  // Ensure requested Recorded Animations (type 15) exist with valid v4 unit_control_data_v3 flight streams
  // (and refresh any previously generated flight streams so turns/descent/exit updates take effect on existing maps)
  for (let r = 0; r < (required.recordedAnimations ?? []).length; r++) {
    const animName = required.recordedAnimations![r]!;
    if (!/^[a-zA-Z0-9_.-]+$/.test(animName)) continue;
    const lowerAnim = animName.toLowerCase();
    const isExitAnim = lowerAnim.includes('out') || lowerAnim.includes('exit') || lowerAnim.includes('depart') || lowerAnim.includes('leave');
    const isReverseDir = lowerAnim.includes('dropship') || lowerAnim.includes('cov') || lowerAnim.includes('west');
    const streamDirX = isReverseDir ? -fwdX : fwdX;
    const streamDirY = isReverseDir ? -fwdY : fwdY;
    const streamYaw = isReverseDir ? anchor.facing + Math.PI : anchor.facing;
    const customWps = required.customFlightWaypoints?.[animName] ?? required.customFlightWaypoints?.[lowerAnim];
    const { stream: streamBytes, totalTicks } =
      customWps && customWps.length >= 2
        ? buildRecordedFlightStreamFromWaypoints(customWps, isExitAnim)
        : buildRecordedFlightStream100m(streamDirX, streamDirY, streamYaw, isExitAnim);

    // If custom waypoints were provided for an approach animation, sync the matching start Cutscene Flag to waypoints[0]
    if (customWps && customWps.length >= 2 && !isExitAnim) {
      const wp0 = customWps[0]!;
      const wp1 = customWps[1]!;
      const initYaw = Math.atan2(wp1.y - wp0.y, wp1.x - wp0.x);
      const matchPrefix = lowerAnim.replace(/_(in|approach|fly|anim).*$/, '');
      const scnrAtF = resolveTagDataPointer(
        curTagIndex.entries[scenario.index]!.tagDataPointerOrResourceIndex,
        curHeader,
        curTagIndex.baseMemoryAddress,
      );
      const decF = decodeStruct(current, scnrAtF, getGroupStructName('scenario')!);
      const flgRef = decF.get('cutscene flags');
      if (flgRef?.kind === 'reflexive' && flgRef.value.count > 0) {
        const flgBase = resolvePointer(flgRef.value.pointerLow, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
        let flagIdx = existingFlagList.findIndex(
          (fn) => fn.toLowerCase().includes(matchPrefix) && fn.toLowerCase().includes('start'),
        );
        if (flagIdx < 0) {
          // Match by 3D coordinate proximity to wp0 (e.g. wp_drop_1_start paired with fly_evt_1_dyvt_in)
          for (let fi = 0; fi < Math.min(existingFlagList.length, flgRef.value.count); fi++) {
            const fOff = flgBase + fi * 92;
            if (fOff + 92 <= current.length) {
              const fx = current.readFloatLE(fOff + 36);
              const fy = current.readFloatLE(fOff + 40);
              const fz = current.readFloatLE(fOff + 44);
              if (Math.hypot(fx - wp0.x, fy - wp0.y, fz - wp0.z) < 2.5) {
                flagIdx = fi;
                break;
              }
            }
          }
        }
        if (flagIdx >= 0 && flagIdx < flgRef.value.count) {
          const fOff = flgBase + flagIdx * 92;
          if (fOff + 92 <= current.length) {
            current.writeFloatLE(wp0.x, fOff + 36);
            current.writeFloatLE(wp0.y, fOff + 40);
            current.writeFloatLE(wp0.z, fOff + 44);
            current.writeFloatLE(initYaw, fOff + 48);
            current.writeFloatLE(0.0, fOff + 52);
          }
        }
      }
    }

    let elemOff = -1;
    if (existingAnim.has(animName)) {
      const existingIdx = existingAnimList.indexOf(animName);
      if (existingIdx >= 0) {
        const scnrAt = resolveTagDataPointer(
          curTagIndex.entries[scenario.index]!.tagDataPointerOrResourceIndex,
          curHeader,
          curTagIndex.baseMemoryAddress,
        );
        const dec = decodeStruct(current, scnrAt, getGroupStructName('scenario')!);
        const animRef = dec.get('recorded animations');
        if (animRef?.kind === 'reflexive' && existingIdx < animRef.value.count) {
          const animBase = resolvePointer(animRef.value.pointerLow, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
          elemOff = animBase + existingIdx * 64;
        }
      }
    } else {
      const addRes = addReflexiveChunk(current, curHeader, curTagIndex, scenario.index, 'recorded animations', -1);
      current = addRes.buffer;
      curHeader = addRes.header;
      curTagIndex = addRes.tagIndex;
      const idx = addRes.newElementIndex;
      writeTagFieldValue(current, curHeader, curTagIndex, scenario.index, `recorded animations[${idx}].name`, animName);
      elemOff = addRes.newElementOffset;
      existingAnim.add(animName);
      existingAnimList.push(animName);
    }

    if (elemOff >= 0 && elemOff + 64 <= current.length) {
      // OpenCE recorded_animations.c decrements ticks_left once on tick 0 and once per tick up to totalTicks
      const lengthInTicks = totalTicks + 1;
      const existingStreamLen = current.readInt32LE(elemOff + 44);
      const existingStreamPtr = current.readUInt32LE(elemOff + 56);
      const existingStreamOff =
        existingStreamPtr >= curTagIndex.baseMemoryAddress
          ? curHeader.tagDataOffset + (existingStreamPtr - curTagIndex.baseMemoryAddress)
          : -1;
      if (
        existingStreamLen >= streamBytes.length &&
        existingStreamOff >= curHeader.tagDataOffset &&
        existingStreamOff + streamBytes.length <= current.length
      ) {
        // Overwrite recorded animation stream in-place without growing tagData
        streamBytes.copy(current, existingStreamOff);
        current.writeUInt8(4, elemOff + 32); // version = 4
        current.writeUInt8(0, elemOff + 33); // raw animation data = 0
        current.writeUInt8(3, elemOff + 34); // unit control data version = 3
        current.writeInt16LE(lengthInTicks, elemOff + 36); // length of animation (ticks)
        current.writeInt32LE(streamBytes.length, elemOff + 44);
      } else {
        const padBytes = (4 - ((current.length - curHeader.tagDataOffset) % 4)) % 4;
        const streamFileOff = current.length + padBytes;
        const streamMemPtr = (curTagIndex.baseMemoryAddress + (streamFileOff - curHeader.tagDataOffset)) >>> 0;
        current = Buffer.concat([current, Buffer.alloc(padBytes, 0), streamBytes]);
        current.writeUInt8(4, elemOff + 32); // version = 4
        current.writeUInt8(0, elemOff + 33); // raw animation data = 0
        current.writeUInt8(3, elemOff + 34); // unit control data version = 3
        current.writeInt16LE(lengthInTicks, elemOff + 36); // length of animation (ticks)
        current.writeInt32LE(streamBytes.length, elemOff + 44);
        current.writeInt32LE(0, elemOff + 48);
        current.writeInt32LE(0, elemOff + 52);
        current.writeUInt32LE(streamMemPtr, elemOff + 56);
        current.writeInt32LE(0, elemOff + 60);
        current.writeUInt32LE(current.length >>> 0, 0x08);
        current.writeUInt32LE((current.length - curHeader.tagDataOffset) >>> 0, 0x14);
        curHeader = parseCacheFileHeader(current);
        curTagIndex = parseTagIndex(current, curHeader);
      }
    }
  }

  // Ensure ALL Marine model_animations tags ('characters\\marine\\marine' and 'characters\\marine_armored\\marine_armored')
  // have a 'scorpion-driver' unit seat entry with DEEP-CLONED child reflexives (never sharing pointers with 'W-driver',
  // which OpenCE's cache_file_formats.c overlap checker rejects with "unit_seats[27].animations ... overlap another's")!
  {
    const deepCloneUnitSeatIntoTagData = (templateUnitBuf: Buffer, targetUnitOff: number) => {
      const clonedUnit = Buffer.from(templateUnitBuf);
      clonedUnit.fill(0, 0, 32);
      clonedUnit.write('scorpion-driver', 0, 'latin1');

      const extraChunks: Buffer[] = [];
      const pad0 = (4 - ((current.length - curHeader.tagDataOffset) % 4)) % 4;
      if (pad0 > 0) extraChunks.push(Buffer.alloc(pad0, 0));
      let runningOff = current.length + pad0;
      const toMem = (fo: number) => (curTagIndex.baseMemoryAddress + (fo - curHeader.tagDataOffset)) >>> 0;
      const allocChunk = (src: Buffer): number => {
        const ptr = toMem(runningOff);
        const pad = (4 - (src.length % 4)) % 4;
        extraChunks.push(src);
        if (pad > 0) extraChunks.push(Buffer.alloc(pad, 0));
        runningOff += src.length + pad;
        return ptr;
      };

      // 1. Clone unit.animations (+64, 2 bytes each)
      const uAnimCnt = clonedUnit.readInt32LE(64);
      const uAnimPtr = clonedUnit.readUInt32LE(68);
      if (uAnimCnt > 0 && uAnimPtr >= curTagIndex.baseMemoryAddress) {
        const srcOff = resolvePointer(uAnimPtr, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
        if (isRangeInBuffer(srcOff, uAnimCnt * 2, current.length)) {
          const newPtr = allocChunk(Buffer.from(current.subarray(srcOff, srcOff + uAnimCnt * 2)));
          clonedUnit.writeUInt32LE(newPtr, 68);
          clonedUnit.writeUInt32LE(0, 72);
        }
      }

      // 2. Clone unit.ik_points (+76, 64 bytes each)
      const uIkCnt = clonedUnit.readInt32LE(76);
      const uIkPtr = clonedUnit.readUInt32LE(80);
      if (uIkCnt > 0 && uIkPtr >= curTagIndex.baseMemoryAddress) {
        const srcOff = resolvePointer(uIkPtr, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
        if (isRangeInBuffer(srcOff, uIkCnt * 64, current.length)) {
          const newPtr = allocChunk(Buffer.from(current.subarray(srcOff, srcOff + uIkCnt * 64)));
          clonedUnit.writeUInt32LE(newPtr, 80);
          clonedUnit.writeUInt32LE(0, 84);
        }
      }

      // 3. Clone unit.weapons (+88, 188 bytes each) and nested weapon blocks
      const uWeapCnt = clonedUnit.readInt32LE(88);
      const uWeapPtr = clonedUnit.readUInt32LE(92);
      if (uWeapCnt > 0 && uWeapPtr >= curTagIndex.baseMemoryAddress) {
        const srcWeapBase = resolvePointer(uWeapPtr, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
        if (isRangeInBuffer(srcWeapBase, uWeapCnt * 188, current.length)) {
          const weapsBuf = Buffer.from(current.subarray(srcWeapBase, srcWeapBase + uWeapCnt * 188));
          for (let w = 0; w < uWeapCnt; w++) {
            const wOff = w * 188;
            // weapon.animations (+152, 2 bytes each)
            const wAnimCnt = weapsBuf.readInt32LE(wOff + 152);
            const wAnimPtr = weapsBuf.readUInt32LE(wOff + 156);
            if (wAnimCnt > 0 && wAnimPtr >= curTagIndex.baseMemoryAddress) {
              const sOff = resolvePointer(wAnimPtr, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
              if (isRangeInBuffer(sOff, wAnimCnt * 2, current.length)) {
                weapsBuf.writeUInt32LE(allocChunk(Buffer.from(current.subarray(sOff, sOff + wAnimCnt * 2))), wOff + 156);
                weapsBuf.writeUInt32LE(0, wOff + 160);
              }
            }
            // weapon.ik_point (+164, 64 bytes each)
            const wIkCnt = weapsBuf.readInt32LE(wOff + 164);
            const wIkPtr = weapsBuf.readUInt32LE(wOff + 168);
            if (wIkCnt > 0 && wIkPtr >= curTagIndex.baseMemoryAddress) {
              const sOff = resolvePointer(wIkPtr, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
              if (isRangeInBuffer(sOff, wIkCnt * 64, current.length)) {
                weapsBuf.writeUInt32LE(allocChunk(Buffer.from(current.subarray(sOff, sOff + wIkCnt * 64))), wOff + 168);
                weapsBuf.writeUInt32LE(0, wOff + 172);
              }
            }
            // weapon.weapon_types (+176, 60 bytes each -> animations @ +48, 2 bytes each)
            const wTypeCnt = weapsBuf.readInt32LE(wOff + 176);
            const wTypePtr = weapsBuf.readUInt32LE(wOff + 180);
            if (wTypeCnt > 0 && wTypePtr >= curTagIndex.baseMemoryAddress) {
              const sTypeBase = resolvePointer(wTypePtr, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
              if (isRangeInBuffer(sTypeBase, wTypeCnt * 60, current.length)) {
                const typesBuf = Buffer.from(current.subarray(sTypeBase, sTypeBase + wTypeCnt * 60));
                for (let wt = 0; wt < wTypeCnt; wt++) {
                  const wtOff = wt * 60;
                  const wtAnimCnt = typesBuf.readInt32LE(wtOff + 48);
                  const wtAnimPtr = typesBuf.readUInt32LE(wtOff + 52);
                  if (wtAnimCnt > 0 && wtAnimPtr >= curTagIndex.baseMemoryAddress) {
                    const saOff = resolvePointer(wtAnimPtr, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
                    if (isRangeInBuffer(saOff, wtAnimCnt * 2, current.length)) {
                      typesBuf.writeUInt32LE(allocChunk(Buffer.from(current.subarray(saOff, saOff + wtAnimCnt * 2))), wtOff + 52);
                      typesBuf.writeUInt32LE(0, wtOff + 56);
                    }
                  }
                }
                weapsBuf.writeUInt32LE(allocChunk(typesBuf), wOff + 180);
                weapsBuf.writeUInt32LE(0, wOff + 184);
              }
            }
          }
          const newWeapPtr = allocChunk(weapsBuf);
          clonedUnit.writeUInt32LE(newWeapPtr, 92);
          clonedUnit.writeUInt32LE(0, 96);
        }
      }

      clonedUnit.copy(current, targetUnitOff);
      if (extraChunks.length > 0) {
        current = Buffer.concat([current, ...extraChunks]);
        current.writeUInt32LE(current.length >>> 0, 0x08);
        current.writeUInt32LE((current.length - curHeader.tagDataOffset) >>> 0, 0x14);
        curHeader = parseCacheFileHeader(current);
        curTagIndex = parseTagIndex(current, curHeader);
      }
    };

    const marineAntrs = curTagIndex.entries.filter(
      (e) => e.primaryClassName === 'model_animations' && !e.isExternal && e.path.toLowerCase().includes('marine'),
    );
    for (const marineAntr of marineAntrs) {
      const antrAt = resolveTagDataPointer(
        marineAntr.tagDataPointerOrResourceIndex,
        curHeader,
        curTagIndex.baseMemoryAddress,
      );
      if (isRangeInBuffer(antrAt, 128, current.length)) {
        const decAntr = decodeStruct(current, antrAt, getGroupStructName('model_animations')!);
        const uRef = decAntr.get('units');
        if (uRef?.kind === 'reflexive' && uRef.value.count > 0) {
          const uBase = resolvePointer(uRef.value.pointerLow, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
          let scorpionDriverIdx = -1;
          let templateUnitBuf: Buffer | null = null;
          const otherAnimPtrs = new Set<number>();
          for (let u = 0; u < uRef.value.count; u++) {
            const uOff = uBase + u * 100;
            if (uOff + 100 > current.length) break;
            const z = current.indexOf(0, uOff);
            const nm = current.toString('latin1', uOff, z >= uOff && z < uOff + 32 ? z : uOff + 32).trim();
            if (nm.toLowerCase() === 'scorpion-driver') {
              scorpionDriverIdx = u;
            } else {
              const aPtr = current.readUInt32LE(uOff + 68);
              if (aPtr > 0) otherAnimPtrs.add(aPtr);
              if (!templateUnitBuf || nm.toLowerCase() === 'w-driver') {
                templateUnitBuf = Buffer.from(current.subarray(uOff, uOff + 100));
              }
            }
          }
          if (scorpionDriverIdx < 0 && templateUnitBuf) {
            const addU = addReflexiveChunk(current, curHeader, curTagIndex, marineAntr.index, 'units', -1);
            current = addU.buffer;
            curHeader = addU.header;
            curTagIndex = addU.tagIndex;
            deepCloneUnitSeatIntoTagData(templateUnitBuf, addU.newElementOffset);
          } else if (scorpionDriverIdx >= 0 && templateUnitBuf) {
            // Repair any previously shallow-cloned scorpion-driver seat whose animations pointer overlaps W-driver
            const sdOff = uBase + scorpionDriverIdx * 100;
            const sdAnimPtr = current.readUInt32LE(sdOff + 68);
            if (sdAnimPtr > 0 && otherAnimPtrs.has(sdAnimPtr)) {
              deepCloneUnitSeatIntoTagData(templateUnitBuf, sdOff);
            }
          }
        }
      }
    }
  }

  // Zero out 'acceleration scale' (+0x24, 12 bytes) on Pelican ('cargo') and Spirit Dropship ('cargo_wraith' / 'cargo_ghost')
  // underbelly seats so unloading vehicles never imparts a violent launch impulse!
  {
    const dropshipVehs = curTagIndex.entries.filter(
      (e) =>
        e.primaryClassName === 'vehicle' &&
        !e.isExternal &&
        (e.path.toLowerCase().includes('pelican') || e.path.toLowerCase().includes('dropship')),
    );
    for (const dv of dropshipVehs) {
      const vAt = resolveTagDataPointer(dv.tagDataPointerOrResourceIndex, curHeader, curTagIndex.baseMemoryAddress);
      if (!isRangeInBuffer(vAt, 512, current.length)) continue;
      const decVeh = decodeStruct(current, vAt, getGroupStructName('vehicle')!);
      const seatsRef = decVeh.get('seats');
      if (seatsRef?.kind === 'reflexive' && seatsRef.value.count > 0) {
        const sBase = resolvePointer(seatsRef.value.pointerLow, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
        for (let s = 0; s < seatsRef.value.count; s++) {
          const sOff = sBase + s * 284;
          if (sOff + 284 > current.length) break;
          const z = current.indexOf(0, sOff + 4);
          const label = current
            .toString('latin1', sOff + 4, z >= sOff + 4 && z < sOff + 36 ? z : sOff + 36)
            .trim()
            .toLowerCase();
          if (label.startsWith('cargo')) {
            current.writeFloatLE(0, sOff + 0x24);
            current.writeFloatLE(0, sOff + 0x28);
            current.writeFloatLE(0, sOff + 0x2c);
          }
        }
      }
    }
  }

  // Ensure requested AI Encounters (type 17) exist with populated Actor Palette, Squads, and Starting Locations
  // (and repair any existing encounters that had normal_diff_count=0 or wrong actorType)
  if ((required.encounters ?? []).length > 0 || existingEnc.size > 0) {
    // Filter actor_variant tags so we only select ones whose unit (+0x14) is a BIPED ('bipd' = 0x62697064),
    // excluding stationary vehicle turrets like 'vehicles\c_dropship\cd_gun\cd gun turret gunner'!
    const allActorVarTags = curTagIndex.entries.filter((e) => e.primaryClassName === 'actor_variant' && !e.isExternal);
    const validBipedActorVarTags = allActorVarTags.filter((e) => {
      const off = resolveTagDataPointer(e.tagDataPointerOrResourceIndex, curHeader, curTagIndex.baseMemoryAddress);
      if (!isRangeInBuffer(off, 0x30, current.length)) return false;
      const actrTid = current.readUInt32LE(off + 0x04 + 12);
      const unitTid = current.readUInt32LE(off + 0x14 + 12);
      if (actrTid === 0xffffffff || actrTid === 0 || unitTid === 0xffffffff || unitTid === 0) return false;
      const unitEntry = curTagIndex.entries.find((u) => u.tagId === unitTid);
      return unitEntry?.primaryClassName === 'biped';
    });
    const usableActorVarTags = validBipedActorVarTags.length > 0 ? validBipedActorVarTags : allActorVarTags;

    // Repair any stub pilot actor_variants (e.g. scorpion pilot, wraith pilot) that have empty actor_definition/unit
    for (const stubTag of allActorVarTags) {
      if (validBipedActorVarTags.includes(stubTag)) continue;
      // Don't overwrite cd_gun turret gunner
      if (stubTag.path.toLowerCase().includes('cd_gun')) continue;
      const isCovStub = /wraith|ghost|banshee|c_dropship|turret|elite|grunt/i.test(stubTag.path);
      const donor =
        validBipedActorVarTags.find((e) =>
          isCovStub
            ? /elite|grunt|jackal|hunter/i.test(e.path)
            : /marine|crewman|cyborg/i.test(e.path),
        ) ?? validBipedActorVarTags[0];
      if (!donor) continue;
      const stubOff = resolveTagDataPointer(stubTag.tagDataPointerOrResourceIndex, curHeader, curTagIndex.baseMemoryAddress);
      const donorOff = resolveTagDataPointer(donor.tagDataPointerOrResourceIndex, curHeader, curTagIndex.baseMemoryAddress);
      if (isRangeInBuffer(stubOff, 0x30, current.length) && isRangeInBuffer(donorOff, 0x30, current.length)) {
        // Copy actor_definition (+0x04..+0x13) and unit (+0x14..+0x23) TagDependencies from donor
        current.copy(current, stubOff + 0x04, donorOff + 0x04, donorOff + 0x24);
      }
    }

    const ensureActorPaletteEntry = (isCov: boolean, speciesHint?: string): number => {
      const scnrAt = resolveTagDataPointer(
        curTagIndex.entries[scenario.index]!.tagDataPointerOrResourceIndex,
        curHeader,
        curTagIndex.baseMemoryAddress,
      );
      const dec = decodeStruct(current, scnrAt, getGroupStructName('scenario')!);
      const palRef = dec.get('actor palette');
      const existingTagIds: number[] = [];
      const existingEntries: Array<{ tid: number; path: string; isBiped: boolean }> = [];
      if (palRef?.kind === 'reflexive' && palRef.value.count > 0) {
        const palBase = resolvePointer(palRef.value.pointerLow, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
        for (let p = 0; p < palRef.value.count; p++) {
          const tidOff = palBase + p * 16 + 12;
          if (tidOff + 4 <= current.length) {
            const tid = current.readUInt32LE(tidOff);
            existingTagIds.push(tid);
            const ent = curTagIndex.entries.find((e) => e.tagId === tid);
            const isBiped = ent ? validBipedActorVarTags.some((v) => v.tagId === ent.tagId) : false;
            existingEntries.push({ tid, path: ent?.path.toLowerCase() ?? '', isBiped });
          }
        }
      }
      const lowerHint = (speciesHint ?? '').toLowerCase();
      const speciesRegex = lowerHint.includes('grunt')
        ? /grunt/i
        : lowerHint.includes('hunter')
          ? /hunter/i
          : lowerHint.includes('jackal')
            ? /jackal/i
            : lowerHint.includes('elite') ||
                (isCov &&
                  (lowerHint.includes('crew') ||
                    lowerHint.includes('pilot') ||
                    lowerHint.includes('driver') ||
                    lowerHint.includes('wraith') ||
                    lowerHint.includes('ghost') ||
                    lowerHint.includes('banshee')))
              ? /elite/i
              : !isCov &&
                  (lowerHint.includes('marine') ||
                    lowerHint.includes('crew') ||
                    lowerHint.includes('pilot') ||
                    lowerHint.includes('driver'))
                ? /marine|crewman|cyborg/i
                : null;
      const factionMatchFn = (p: string) =>
        isCov ? /elite|grunt|jackal|hunter/i.test(p) : /marine|crewman|cyborg/i.test(p);

      // 1. Prefer exact species match in existing actor palette
      if (speciesRegex) {
        const exactExisting = existingEntries.findIndex((e) => e.isBiped && speciesRegex.test(e.path));
        if (exactExisting >= 0) return exactExisting;
        const exactCand =
          validBipedActorVarTags.find((e) => speciesRegex.test(e.path.toLowerCase())) ??
          usableActorVarTags.find((e) => speciesRegex.test(e.path.toLowerCase()));
        if (exactCand) {
          const alreadyIdx = existingTagIds.indexOf(exactCand.tagId);
          if (alreadyIdx >= 0) return alreadyIdx;
          const addPal = addReflexiveChunk(current, curHeader, curTagIndex, scenario.index, 'actor palette', -1);
          current = addPal.buffer;
          curHeader = addPal.header;
          curTagIndex = addPal.tagIndex;
          const tagHeaderSize = curHeader.engine === 5 ? 0x24 : 0x28;
          const candPathPtr = current.readUInt32LE(curHeader.tagDataOffset + tagHeaderSize + exactCand.index * 32 + 0x10);
          current.write('vtca', addPal.newElementOffset + 0, 4, 'latin1');
          current.writeUInt32LE(candPathPtr >>> 0, addPal.newElementOffset + 4);
          current.writeUInt32LE(0, addPal.newElementOffset + 8);
          current.writeUInt32LE(exactCand.tagId, addPal.newElementOffset + 12);
          return addPal.newElementIndex;
        }
      }

      // 2. Fallback to any valid biped actor_variant for this faction
      const matchExistingBiped = existingEntries.findIndex((e) => e.isBiped && factionMatchFn(e.path));
      if (matchExistingBiped >= 0) return matchExistingBiped;

      const cand =
        validBipedActorVarTags.find((e) => factionMatchFn(e.path.toLowerCase())) ??
        validBipedActorVarTags[0] ??
        usableActorVarTags.find((e) => factionMatchFn(e.path.toLowerCase())) ??
        usableActorVarTags[0];
      if (!cand) return existingTagIds.length > 0 ? 0 : -1;
      const alreadyIdx = existingTagIds.indexOf(cand.tagId);
      if (alreadyIdx >= 0) return alreadyIdx;
      const addPal = addReflexiveChunk(current, curHeader, curTagIndex, scenario.index, 'actor palette', -1);
      current = addPal.buffer;
      curHeader = addPal.header;
      curTagIndex = addPal.tagIndex;
      const tagHeaderSize = curHeader.engine === 5 ? 0x24 : 0x28;
      const candPathPtr = current.readUInt32LE(curHeader.tagDataOffset + tagHeaderSize + cand.index * 32 + 0x10);
      current.write('vtca', addPal.newElementOffset + 0, 4, 'latin1'); // 'actv' reversed
      current.writeUInt32LE(candPathPtr >>> 0, addPal.newElementOffset + 4);
      current.writeUInt32LE(0, addPal.newElementOffset + 8);
      current.writeUInt32LE(cand.tagId, addPal.newElementOffset + 12);
      return addPal.newElementIndex;
    };

    // Group requested encounters & sub-squads (`encounter/squad`)
    const requestedSquadsByEnc = new Map<string, string[]>();
    for (const rawEnc of required.encounters ?? []) {
      const parts = rawEnc.split('/');
      const baseEnc = parts[0]!.trim();
      const sqName = parts[1]?.trim();
      if (!baseEnc) continue;
      if (!requestedSquadsByEnc.has(baseEnc)) {
        requestedSquadsByEnc.set(baseEnc, []);
      }
      if (sqName && !requestedSquadsByEnc.get(baseEnc)!.includes(sqName)) {
        requestedSquadsByEnc.get(baseEnc)!.push(sqName);
      }
    }

    const encountersToConfigure = Array.from(
      new Set([...Array.from(requestedSquadsByEnc.keys()), ...Array.from(existingEnc)]),
    );

    const buildSquadAndStartLocs = (
      sqName: string,
      sqIdx: number,
      isCov: boolean,
      encName: string,
    ): { squadBuf: Buffer; startLocBuf: Buffer } => {
      const lowerSq = `${encName}_${sqName}`.toLowerCase();
      const isVehicleCrew = lowerSq.includes('crew') || lowerSq.includes('pilot') || lowerSq.includes('driver');
      const isHunter = lowerSq.includes('hunter');
      const actorCount = isVehicleCrew ? 1 : isHunter ? 2 : 4;
      const sqActorPalIdx = ensureActorPaletteEntry(isCov, lowerSq);

      const squadBuf = Buffer.alloc(232, 0);
      squadBuf.write(sqName.slice(0, 31), 0, 'latin1');
      squadBuf.writeInt16LE(Math.max(0, sqActorPalIdx), 32); // actor type @ +32
      squadBuf.writeInt16LE(-1, 34); // platoon = NONE (-1) @ +34
      squadBuf.writeInt16LE(2, 36); // initial state = seeking @ +36
      squadBuf.writeInt16LE(2, 38); // return state = seeking @ +38
      squadBuf.writeInt16LE(-1, 78); // maneuver to squad = NONE (-1) @ +78
      for (const atkOff of [84, 88, 92, 96, 100, 104, 108]) {
        squadBuf.writeUInt32LE(1, atkOff); // group 'A' firing positions bitmask
      }
      squadBuf.writeInt16LE(actorCount, 124); // normal diff count @ +124
      squadBuf.writeInt16LE(actorCount, 126); // insane diff count @ +126

      const startLocBuf = Buffer.alloc(actorCount * 28, 0);
      const customEnc =
        required.customEncounterCoords?.[encName] ?? required.customEncounterCoords?.[encName.toLowerCase()];
      const baseDist = (isCov ? 13.0 : 5.0) + sqIdx * 3.0;
      for (let s = 0; s < actorCount; s++) {
        const slOff = s * 28;
        const offsetRight = (s - (actorCount - 1) * 0.5) * 2.5;
        const sx = customEnc
          ? customEnc.x + fwdX * (sqIdx * 2.5) + rightX * offsetRight
          : anchor.x + fwdX * baseDist + rightX * offsetRight;
        const sy = customEnc
          ? customEnc.y + fwdY * (sqIdx * 2.5) + rightY * offsetRight
          : anchor.y + fwdY * baseDist + rightY * offsetRight;
        const sz = (customEnc ? customEnc.z : anchor.z) + 0.35;
        const clamped = clampPointInsideBsp0(current, curHeader, curTagIndex, sx, sy, sz, 0.35);
        startLocBuf.writeFloatLE(clamped.x, slOff + 0);
        startLocBuf.writeFloatLE(clamped.y, slOff + 4);
        startLocBuf.writeFloatLE(clamped.z, slOff + 8);
        const sYaw =
          customEnc?.yaw !== undefined && Number.isFinite(customEnc.yaw)
            ? customEnc.yaw
            : isCov
              ? anchor.facing + Math.PI
              : anchor.facing;
        startLocBuf.writeFloatLE(sYaw, slOff + 12);
        startLocBuf.writeInt16LE(clamped.cluster, slOff + 16); // cluster index @ +16
        startLocBuf.writeInt16LE(2, slOff + 20); // return state = seeking @ +20
        startLocBuf.writeInt16LE(2, slOff + 22); // initial state = seeking @ +22
        startLocBuf.writeInt16LE(Math.max(0, sqActorPalIdx), slOff + 24); // actor type @ +24
        startLocBuf.writeInt16LE(-1, slOff + 26); // command list = NONE (-1) @ +26
      }
      return { squadBuf, startLocBuf };
    };

    for (let eIdx = 0; eIdx < encountersToConfigure.length; eIdx++) {
      const encName = encountersToConfigure[eIdx]!;
      const lowerEnc = encName.toLowerCase();
      const isCov =
        lowerEnc.includes('cov') ||
        lowerEnc.includes('elite') ||
        lowerEnc.includes('grunt') ||
        lowerEnc.includes('hunter') ||
        lowerEnc.includes('jackal') ||
        lowerEnc.includes('wraith');
      const isVehicleCrew = lowerEnc.includes('crew') || lowerEnc.includes('pilot') || lowerEnc.includes('driver');
      const actorCount = isVehicleCrew ? 1 : 4;
      ensureActorPaletteEntry(isCov, lowerEnc);
      const desiredSquadNames = requestedSquadsByEnc.get(encName)?.length
        ? requestedSquadsByEnc.get(encName)!
        : ['main_squad'];

      if (existingEnc.has(encName)) {
        // Always ensure existing encounter has valid actorType and any newly requested named sub-squads
        const existingIdx = existingEncList.indexOf(encName);
        if (existingIdx >= 0) {
          const scnrAt = resolveTagDataPointer(
            curTagIndex.entries[scenario.index]!.tagDataPointerOrResourceIndex,
            curHeader,
            curTagIndex.baseMemoryAddress,
          );
          const dec = decodeStruct(current, scnrAt, getGroupStructName('scenario')!);
          const encRef = dec.get('encounters');
          if (encRef?.kind === 'reflexive' && existingIdx < encRef.value.count) {
            const encBase = resolvePointer(encRef.value.pointerLow, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
            const eOff = encBase + existingIdx * 176;
            if (eOff + 176 <= current.length) {
              const sqCount = current.readUInt32LE(eOff + 128);
              const sqPtr = current.readUInt32LE(eOff + 132);
              if (sqCount > 0 && sqPtr > 0) {
                const sqBase = resolvePointer(sqPtr, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
                const existingSquadNames: string[] = [];
                for (let q = 0; q < sqCount; q++) {
                  const sOff = sqBase + q * 232;
                  if (sOff + 232 > current.length) break;
                  const z = current.indexOf(0, sOff);
                  const sqNm = current.toString('latin1', sOff, z >= sOff && z < sOff + 32 ? z : sOff + 32).trim() || `squad_${q}`;
                  existingSquadNames.push(sqNm);
                  const qPalIdx = ensureActorPaletteEntry(isCov, `${lowerEnc}_${sqNm}`);
                  const normCnt = current.readInt16LE(sOff + 124);
                  current.writeInt16LE(isCov ? 3 : 2, eOff + 36);
                  if (qPalIdx >= 0) {
                    current.writeInt16LE(qPalIdx, sOff + 32);
                  }
                  const customEncExisting =
                    required.customEncounterCoords?.[encName] ?? required.customEncounterCoords?.[lowerEnc];
                  const slCount0 = current.readUInt32LE(sOff + 208);
                  const slPtr0 = current.readUInt32LE(sOff + 212);
                  if (slCount0 > 0 && slPtr0 > 0) {
                    const slBase0 = resolvePointer(slPtr0, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
                    for (let l = 0; l < slCount0; l++) {
                      const lOff = slBase0 + l * 28;
                      if (lOff + 28 <= current.length) {
                        if (qPalIdx >= 0) {
                          current.writeInt16LE(qPalIdx, lOff + 24);
                        }
                        const offsetRight = (l - (slCount0 - 1) * 0.5) * 2.5;
                        const lx = customEncExisting
                          ? customEncExisting.x + fwdX * (q * 2.5) + rightX * offsetRight
                          : current.readFloatLE(lOff + 0);
                        const ly = customEncExisting
                          ? customEncExisting.y + fwdY * (q * 2.5) + rightY * offsetRight
                          : current.readFloatLE(lOff + 4);
                        const lz = customEncExisting ? customEncExisting.z + 0.35 : current.readFloatLE(lOff + 8);
                        const clamped = clampPointInsideBsp0(current, curHeader, curTagIndex, lx, ly, lz, 0.35);
                        current.writeFloatLE(clamped.x, lOff + 0);
                        current.writeFloatLE(clamped.y, lOff + 4);
                        current.writeFloatLE(clamped.z, lOff + 8);
                        if (customEncExisting?.yaw !== undefined && Number.isFinite(customEncExisting.yaw)) {
                          current.writeFloatLE(customEncExisting.yaw, lOff + 12);
                        }
                        current.writeInt16LE(clamped.cluster, lOff + 16);
                      }
                    }
                  }
                  const fpCount0 = current.readUInt32LE(eOff + 152);
                  const fpPtr0 = current.readUInt32LE(eOff + 156);
                  if (fpCount0 > 0 && fpPtr0 > 0) {
                    const fpBase0 = resolvePointer(fpPtr0, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
                    for (let fp = 0; fp < fpCount0; fp++) {
                      const fpOff0 = fpBase0 + fp * 24;
                      if (fpOff0 + 24 <= current.length) {
                        const fpx = customEncExisting
                          ? customEncExisting.x + fwdX * ((fp % 4 - 1.5) * 3.0) + rightX * ((Math.floor(fp / 4) - 0.5) * 6.0)
                          : current.readFloatLE(fpOff0 + 0);
                        const fpy = customEncExisting
                          ? customEncExisting.y + fwdY * ((fp % 4 - 1.5) * 3.0) + rightY * ((Math.floor(fp / 4) - 0.5) * 6.0)
                          : current.readFloatLE(fpOff0 + 4);
                        const fpz = customEncExisting ? customEncExisting.z + 0.35 : current.readFloatLE(fpOff0 + 8);
                        const clampedFp = clampPointInsideBsp0(current, curHeader, curTagIndex, fpx, fpy, fpz, 0.35);
                        current.writeFloatLE(clampedFp.x, fpOff0 + 0);
                        current.writeFloatLE(clampedFp.y, fpOff0 + 4);
                        current.writeFloatLE(clampedFp.z, fpOff0 + 8);
                      }
                    }
                  }
                  if (normCnt <= 0) {
                    current.writeUInt32LE(0x09, eOff + 32);
                    current.writeInt16LE(isCov ? 3 : 2, eOff + 36);
                    current.writeInt16LE(1, eOff + 38);
                    current.writeInt16LE(1, eOff + 40);
                    current.writeInt16LE(Math.max(0, qPalIdx), sOff + 32);
                    current.writeInt16LE(-1, sOff + 34);
                    current.writeInt16LE(2, sOff + 36);
                    current.writeInt16LE(2, sOff + 38);
                    current.writeInt16LE(0, sOff + 72);
                    current.writeInt16LE(0, sOff + 74);
                    current.writeInt16LE(-1, sOff + 78);
                    for (const atkOff of [84, 88, 92, 96, 100, 104, 108]) {
                      current.writeUInt32LE(1, sOff + atkOff);
                    }
                    current.writeInt16LE(actorCount, sOff + 124);
                    current.writeInt16LE(actorCount, sOff + 126);
                  }
                }
                // Check if any requested named squads (e.g. 'elites', 'grunts', 'hunters') need to be added to this encounter
                const missingSquads = desiredSquadNames.filter(
                  (nm) => nm !== 'main_squad' && !existingSquadNames.includes(nm),
                );
                if (missingSquads.length > 0) {
                  // If the only existing squad is 'main_squad' and user requested named squads, rename squad[0] to first desired squad
                  let startMissingIdx = 0;
                  if (sqCount === 1 && existingSquadNames[0] === 'main_squad') {
                    const firstDesired = missingSquads[0]!;
                    current.fill(0, sqBase, sqBase + 32);
                    current.write(firstDesired.slice(0, 31), sqBase, 'latin1');
                    const firstPalIdx = ensureActorPaletteEntry(isCov, `${lowerEnc}_${firstDesired}`);
                    if (firstPalIdx >= 0) current.writeInt16LE(firstPalIdx, sqBase + 32);
                    startMissingIdx = 1;
                  }
                  const toAppend = missingSquads.slice(startMissingIdx);
                  if (toAppend.length > 0) {
                    const newSqCount = sqCount + toAppend.length;
                    const combinedSquadsBuf = Buffer.alloc(newSqCount * 232, 0);
                    current.copy(combinedSquadsBuf, 0, sqBase, sqBase + sqCount * 232);
                    const extraLocChunks: Buffer[] = [];
                    const padBytes = (4 - ((current.length - curHeader.tagDataOffset) % 4)) % 4;
                    const newSquadArrayFileOff = current.length + padBytes;
                    let nextLocFileOff = newSquadArrayFileOff + combinedSquadsBuf.length;
                    const toMem = (fo: number) => (curTagIndex.baseMemoryAddress + (fo - curHeader.tagDataOffset)) >>> 0;

                    for (let m = 0; m < toAppend.length; m++) {
                      const sqIdx = sqCount + m;
                      const { squadBuf, startLocBuf } = buildSquadAndStartLocs(toAppend[m]!, sqIdx, isCov, encName);
                      squadBuf.writeUInt32LE(startLocBuf.length / 28, 208);
                      squadBuf.writeUInt32LE(toMem(nextLocFileOff), 212);
                      squadBuf.writeUInt32LE(0, 216);
                      squadBuf.copy(combinedSquadsBuf, sqIdx * 232);
                      extraLocChunks.push(startLocBuf);
                      nextLocFileOff += startLocBuf.length;
                    }
                    current = Buffer.concat([current, Buffer.alloc(padBytes, 0), combinedSquadsBuf, ...extraLocChunks]);
                    current.writeUInt32LE(newSqCount, eOff + 128);
                    current.writeUInt32LE(toMem(newSquadArrayFileOff), eOff + 132);
                    current.writeUInt32LE(0, eOff + 136);
                    current.writeUInt32LE(current.length >>> 0, 0x08);
                    current.writeUInt32LE((current.length - curHeader.tagDataOffset) >>> 0, 0x14);
                    curHeader = parseCacheFileHeader(current);
                    curTagIndex = parseTagIndex(current, curHeader);
                  }
                }
              }
            }
          }
        }
        continue;
      }

      const addEnc = addReflexiveChunk(current, curHeader, curTagIndex, scenario.index, 'encounters', -1);
      current = addEnc.buffer;
      curHeader = addEnc.header;
      curTagIndex = addEnc.tagIndex;
      const encElemIdx = addEnc.newElementIndex;
      writeTagFieldValue(current, curHeader, curTagIndex, scenario.index, `encounters[${encElemIdx}].name`, encName);
      const encOff = addEnc.newElementOffset;
      // flags (+32): not initially created (0x01) | 3d firing positions (0x08) = 0x09
      // team index (+36): 2 = human, 3 = covenant; one (+38) = 1; search behavior (+40) = 1 (aggressive)
      current.writeUInt32LE(0x09, encOff + 32);
      current.writeInt16LE(isCov ? 3 : 2, encOff + 36);
      current.writeInt16LE(1, encOff + 38);
      current.writeInt16LE(1, encOff + 40);

      // Build all requested squads (232 bytes each) + Starting Locations + 8 Firing Positions (24 bytes each)
      const sqTotal = desiredSquadNames.length;
      const allSquadsBuf = Buffer.alloc(sqTotal * 232, 0);
      const startLocBuffers: Buffer[] = [];
      for (let q = 0; q < sqTotal; q++) {
        const { squadBuf, startLocBuf } = buildSquadAndStartLocs(desiredSquadNames[q]!, q, isCov, encName);
        squadBuf.copy(allSquadsBuf, q * 232);
        startLocBuffers.push(startLocBuf);
      }

      const firePosBuf = Buffer.alloc(8 * 24, 0);
      const customEncNew =
        required.customEncounterCoords?.[encName] ?? required.customEncounterCoords?.[lowerEnc];
      for (let fp = 0; fp < 8; fp++) {
        const fpOff = fp * 24;
        const fx = customEncNew
          ? customEncNew.x + fwdX * ((fp % 4 - 1.5) * 3.0) + rightX * ((Math.floor(fp / 4) - 0.5) * 6.0)
          : anchor.x + fwdX * (8.0 + (fp % 4 - 1.5) * 3.0) + rightX * ((Math.floor(fp / 4) - 0.5) * 6.0);
        const fy = customEncNew
          ? customEncNew.y + fwdY * ((fp % 4 - 1.5) * 3.0) + rightY * ((Math.floor(fp / 4) - 0.5) * 6.0)
          : anchor.y + fwdY * (8.0 + (fp % 4 - 1.5) * 3.0) + rightY * ((Math.floor(fp / 4) - 0.5) * 6.0);
        const fz = (customEncNew ? customEncNew.z : anchor.z) + 0.35;
        const clampedFp = clampPointInsideBsp0(current, curHeader, curTagIndex, fx, fy, fz, 0.35);
        firePosBuf.writeFloatLE(clampedFp.x, fpOff + 0);
        firePosBuf.writeFloatLE(clampedFp.y, fpOff + 4);
        firePosBuf.writeFloatLE(clampedFp.z, fpOff + 8);
        firePosBuf.writeInt16LE(0, fpOff + 12); // group index 0 ('A')
      }

      const padBytes = (4 - ((current.length - curHeader.tagDataOffset) % 4)) % 4;
      const squadFileOff = current.length + padBytes;
      const toMem = (fo: number) => (curTagIndex.baseMemoryAddress + (fo - curHeader.tagDataOffset)) >>> 0;

      let runningStartLocOff = squadFileOff + allSquadsBuf.length;
      for (let q = 0; q < sqTotal; q++) {
        const slBuf = startLocBuffers[q]!;
        const qOff = q * 232;
        allSquadsBuf.writeUInt32LE(slBuf.length / 28, qOff + 208);
        allSquadsBuf.writeUInt32LE(toMem(runningStartLocOff), qOff + 212);
        allSquadsBuf.writeUInt32LE(0, qOff + 216);
        runningStartLocOff += slBuf.length;
      }
      const firePosFileOff = runningStartLocOff;

      current = Buffer.concat([current, Buffer.alloc(padBytes, 0), allSquadsBuf, ...startLocBuffers, firePosBuf]);
      const scnrAtNow = resolveTagDataPointer(
        curTagIndex.entries[scenario.index]!.tagDataPointerOrResourceIndex,
        curHeader,
        curTagIndex.baseMemoryAddress,
      );
      const decNow = decodeStruct(current, scnrAtNow, getGroupStructName('scenario')!);
      const encRefNow = decNow.get('encounters');
      if (encRefNow?.kind === 'reflexive') {
        const encBaseNow = resolvePointer(encRefNow.value.pointerLow, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
        const thisEncOff = encBaseNow + encElemIdx * 176;
        // squads reflexive at +128, firing positions reflexive at +152
        current.writeUInt32LE(sqTotal, thisEncOff + 128);
        current.writeUInt32LE(toMem(squadFileOff), thisEncOff + 132);
        current.writeUInt32LE(0, thisEncOff + 136);
        current.writeUInt32LE(8, thisEncOff + 152);
        current.writeUInt32LE(toMem(firePosFileOff), thisEncOff + 156);
        current.writeUInt32LE(0, thisEncOff + 160);
      }
      current.writeUInt32LE(current.length >>> 0, 0x08);
      current.writeUInt32LE((current.length - curHeader.tagDataOffset) >>> 0, 0x14);
      curHeader = parseCacheFileHeader(current);
      curTagIndex = parseTagIndex(current, curHeader);
      existingEnc.add(encName);
      existingEncList.push(encName);
    }
  }

  // Ensure requested Device Groups (type 16) exist
  for (const dgName of required.deviceGroups ?? []) {
    if (existingDevGroup.has(dgName)) continue;
    const addRes = addReflexiveChunk(current, curHeader, curTagIndex, scenario.index, 'device groups', -1);
    current = addRes.buffer;
    curHeader = addRes.header;
    curTagIndex = addRes.tagIndex;
    writeTagFieldValue(current, curHeader, curTagIndex, scenario.index, `device groups[${addRes.newElementIndex}].name`, dgName);
    current.writeFloatLE(1.0, addRes.newElementOffset + 32); // initial value = 1.0
    existingDevGroup.add(dgName);
  }

  // Ensure requested Command Lists (type 18) exist and populate 3D `points` (20B) + `commands` (32B, `go to` = 1)
  for (const clName of required.commandLists ?? []) {
    let clIdx = existingCmdListList.indexOf(clName);
    if (clIdx < 0) {
      const addRes = addReflexiveChunk(current, curHeader, curTagIndex, scenario.index, 'command lists', -1);
      current = addRes.buffer;
      curHeader = addRes.header;
      curTagIndex = addRes.tagIndex;
      clIdx = addRes.newElementIndex;
      writeTagFieldValue(current, curHeader, curTagIndex, scenario.index, `command lists[${clIdx}].name`, clName);
      existingCmdList.add(clName);
      existingCmdListList.push(clName);
    }
    const clPts =
      required.customCommandListPaths?.[clName] ?? required.customCommandListPaths?.[clName.toLowerCase()];
    if (clPts && clPts.length >= 1 && clIdx >= 0) {
      const ptCount = Math.min(64, clPts.length);
      const ptsBuf = Buffer.alloc(ptCount * 20, 0);
      const cmdsBuf = Buffer.alloc(ptCount * 32, 0);
      for (let p = 0; p < ptCount; p++) {
        const pt = clPts[p]!;
        const clamped = clampPointInsideBsp0(current, curHeader, curTagIndex, pt.x, pt.y, pt.z, 0.35);
        const pOff = p * 20;
        ptsBuf.writeFloatLE(clamped.x, pOff + 0);
        ptsBuf.writeFloatLE(clamped.y, pOff + 4);
        ptsBuf.writeFloatLE(clamped.z, pOff + 8);
        ptsBuf.writeInt32LE(-1, pOff + 12); // surface index = NONE (-1)

        const cOff = p * 32;
        cmdsBuf.writeInt16LE(1, cOff + 0); // atom_type = 1 ('go to')
        cmdsBuf.writeInt16LE(0, cOff + 2); // atom_modifier = 0
        cmdsBuf.writeFloatLE(0.0, cOff + 4); // parameter1
        cmdsBuf.writeFloatLE(0.0, cOff + 8); // parameter2
        cmdsBuf.writeInt16LE(p, cOff + 12); // point 1 = p
        cmdsBuf.writeInt16LE(-1, cOff + 14); // point 2 = NONE
        cmdsBuf.writeInt16LE(-1, cOff + 16); // animation = NONE
        cmdsBuf.writeInt16LE(-1, cOff + 18); // script = NONE
        cmdsBuf.writeInt16LE(-1, cOff + 20); // recording = NONE
        cmdsBuf.writeInt16LE(-1, cOff + 22); // command = NONE
        cmdsBuf.writeInt16LE(-1, cOff + 24); // object name = NONE
      }

      const padBytes = (4 - ((current.length - curHeader.tagDataOffset) % 4)) % 4;
      const cmdsFileOff = current.length + padBytes;
      const ptsFileOff = cmdsFileOff + cmdsBuf.length;
      const toMem = (fo: number) => (curTagIndex.baseMemoryAddress + (fo - curHeader.tagDataOffset)) >>> 0;
      current = Buffer.concat([current, Buffer.alloc(padBytes, 0), cmdsBuf, ptsBuf]);
      const scnrAtCl = resolveTagDataPointer(
        curTagIndex.entries[scenario.index]!.tagDataPointerOrResourceIndex,
        curHeader,
        curTagIndex.baseMemoryAddress,
      );
      const decCl = decodeStruct(current, scnrAtCl, getGroupStructName('scenario')!);
      const clRef = decCl.get('command lists');
      if (clRef?.kind === 'reflexive' && clIdx < clRef.value.count) {
        const clBase = resolvePointer(clRef.value.pointerLow, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
        const clOff = clBase + clIdx * 96;
        if (clOff + 96 <= current.length) {
          current.writeUInt32LE(0x03, clOff + 32); // flags: allow initiative (1) | allow targeting (2)
          current.writeInt16LE(-1, clOff + 44); // manual bsp index = NONE
          current.writeInt16LE(0, clOff + 46); // precomputed bsp index = 0
          current.writeUInt32LE(ptCount, clOff + 48); // commands.count
          current.writeUInt32LE(toMem(cmdsFileOff), clOff + 52); // commands.pointerLow
          current.writeUInt32LE(0, clOff + 56);
          current.writeUInt32LE(ptCount, clOff + 60); // points.count
          current.writeUInt32LE(toMem(ptsFileOff), clOff + 64); // points.pointerLow
          current.writeUInt32LE(0, clOff + 68);
        }
      }
      current.writeUInt32LE(current.length >>> 0, 0x08);
      current.writeUInt32LE((current.length - curHeader.tagDataOffset) >>> 0, 0x14);
      curHeader = parseCacheFileHeader(current);
      curTagIndex = parseTagIndex(current, curHeader);
    }
  }

  // Ensure requested Cutscene Titles (type 14, 96 bytes) exist with valid bounds, colors, and fade timings
  for (const ctName of required.cutsceneTitles ?? []) {
    let titleIdx = existingTitleList.indexOf(ctName);
    if (titleIdx < 0) {
      const addRes = addReflexiveChunk(current, curHeader, curTagIndex, scenario.index, 'cutscene titles', -1);
      current = addRes.buffer;
      curHeader = addRes.header;
      curTagIndex = addRes.tagIndex;
      titleIdx = addRes.newElementIndex;
      writeTagFieldValue(current, curHeader, curTagIndex, scenario.index, `cutscene titles[${titleIdx}].name`, ctName);
      existingTitle.add(ctName);
      existingTitleList.push(ctName);
    }
    const scnrAtCt = resolveTagDataPointer(
      curTagIndex.entries[scenario.index]!.tagDataPointerOrResourceIndex,
      curHeader,
      curTagIndex.baseMemoryAddress,
    );
    const decCt = decodeStruct(current, scnrAtCt, getGroupStructName('scenario')!);
    const ctRef = decCt.get('cutscene titles');
    if (ctRef?.kind === 'reflexive' && titleIdx >= 0 && titleIdx < ctRef.value.count) {
      const ctBase = resolvePointer(ctRef.value.pointerLow, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
      const ctOff = ctBase + titleIdx * 96;
      if (ctOff + 96 <= current.length) {
        const customTiming =
          required.customCutsceneTitleTimings?.[ctName] ??
          required.customCutsceneTitleTimings?.[ctName.toLowerCase()];
        // Rectangle2D text bounds @ +40 (top, left, bottom, right)
        current.writeInt16LE(340, ctOff + 40);
        current.writeInt16LE(40, ctOff + 42);
        current.writeInt16LE(450, ctOff + 44);
        current.writeInt16LE(600, ctOff + 46);
        current.writeInt16LE(Math.max(0, titleIdx), ctOff + 48); // string index @ +48
        current.writeInt16LE(1, ctOff + 50); // text style = bold @ +50
        current.writeInt16LE(2, ctOff + 52); // justification = center @ +52
        current.writeUInt32LE(1, ctOff + 56); // text flags = wrap horizontally @ +56
        current.writeUInt32LE(0xffffffff >>> 0, ctOff + 60); // text color = white ARGB @ +60
        current.writeUInt32LE(0xcc000000 >>> 0, ctOff + 64); // shadow color = black ARGB @ +64
        current.writeFloatLE(customTiming?.fadeIn ?? 1.5, ctOff + 68); // fade in time @ +68
        current.writeFloatLE(customTiming?.upTime ?? 4.0, ctOff + 72); // up time @ +72
        current.writeFloatLE(customTiming?.fadeOut ?? 1.5, ctOff + 76); // fade out time @ +76
      }
    }
  }

  // Ensure requested Scenario Tag References (`references` @ 0x4B4, 40-byte ScenarioReference) exist for HS types 24..31
  if (required.tagReferences && required.tagReferences.length > 0) {
    const hsTypeToGroups: Record<number, string[]> = {
      24: ['sound'],
      25: ['effect'],
      26: ['damage_effect'],
      27: ['sound_looping'],
      28: ['model_animations'],
      29: ['actor_variant'],
      30: ['damage_effect'],
      31: [
        'object',
        'biped',
        'vehicle',
        'weapon',
        'equipment',
        'garbage',
        'projectile',
        'scenery',
        'device_machine',
        'device_control',
        'device_light_fixture',
        'sound_scenery',
      ],
    };
    const scnrAtRef0 = resolveTagDataPointer(
      curTagIndex.entries[scenario.index]!.tagDataPointerOrResourceIndex,
      curHeader,
      curTagIndex.baseMemoryAddress,
    );
    const decRef0 = decodeStruct(current, scnrAtRef0, getGroupStructName('scenario')!);
    const refBlock0 = decRef0.get('references');
    const existingRefTagIds = new Set<number>();
    if (refBlock0?.kind === 'reflexive' && refBlock0.value.count > 0) {
      const rBase = resolvePointer(refBlock0.value.pointerLow, curHeader.tagDataOffset, curTagIndex.baseMemoryAddress);
      for (let r = 0; r < refBlock0.value.count; r++) {
        const tidOff = rBase + r * 40 + 36;
        if (tidOff + 4 <= current.length) {
          existingRefTagIds.add(current.readUInt32LE(tidOff));
        }
      }
    }
    for (const reqRef of required.tagReferences) {
      const normPath = reqRef.path.replace(/\//g, '\\').trim().toLowerCase();
      if (!normPath || normPath === 'none') continue;
      const allowedGroups = hsTypeToGroups[reqRef.hsType];
      const matchedEntry =
        curTagIndex.entries.find(
          (e) =>
            (!allowedGroups || allowedGroups.includes(e.primaryClassName ?? '')) &&
            e.path.toLowerCase() === normPath,
        ) ??
        curTagIndex.entries.find(
          (e) =>
            (!allowedGroups || allowedGroups.includes(e.primaryClassName ?? '')) &&
            e.path.toLowerCase().endsWith(normPath),
        );
      if (!matchedEntry || existingRefTagIds.has(matchedEntry.tagId)) continue;
      const addRef = addReflexiveChunk(current, curHeader, curTagIndex, scenario.index, 'references', -1);
      current = addRef.buffer;
      curHeader = addRef.header;
      curTagIndex = addRef.tagIndex;
      const tagHeaderSize = curHeader.engine === 5 ? 0x24 : 0x28;
      const entryPathPtr = current.readUInt32LE(
        curHeader.tagDataOffset + tagHeaderSize + matchedEntry.index * 32 + 0x10,
      );
      current.writeUInt32LE(matchedEntry.primaryClassFourCC >>> 0, addRef.newElementOffset + 24);
      current.writeUInt32LE(entryPathPtr >>> 0, addRef.newElementOffset + 28);
      current.writeUInt32LE(0, addRef.newElementOffset + 32);
      current.writeUInt32LE(matchedEntry.tagId >>> 0, addRef.newElementOffset + 36);
      existingRefTagIds.add(matchedEntry.tagId);
    }
  }

  current = syncScenarioObjectNamesForScripts(
    current,
    new Map(),
    new Set((required.objectNames ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean)),
    required.customObjectCoords,
  );

  return { buffer: current, addedObjectNames, addedTriggerVolumes, addedCameraPoints };
}

/**
 * Synchronizes `ScenarioObjectName` runtime `object type` (+32) and `object index` (+34)
 * from scenario placement blocks and script usage, and guarantees every active `object name` entry `i`
 * has a valid `0 <= placement_index < placementBlock.count` (+34) and `placementBlock[k].name == i` (+2)
 * (auto-adding a placement element if the target placement block has 0 or insufficient entries).
 * This prevents OpenCE's `scenario_check_object_names` from resetting `runtime_object_type` to `NONE` (-1),
 * which would otherwise trigger `hs_compile.c,#1914: object_name->runtime_object_type!=NONE`.
 */
function syncScenarioObjectNamesForScripts(
  view: Buffer,
  inferredObjectTypesByNameIdx: Map<number, number>,
  activeObjectNamesLower?: Set<string>,
  customObjectCoords?: Record<string, { x: number; y: number; z: number; yaw?: number }>,
  customObjectTypes?: Record<string, string>,
  scriptCreatedObjectsLower?: Set<string>,
): Buffer {
  let buffer: Buffer = Buffer.from(view);
  let header = parseCacheFileHeader(buffer);
  let tagIndex = parseTagIndex(buffer, header);
  const scenario = scenarioEntryOf(tagIndex);
  if (!scenario) return buffer;

  const scenarioStruct = getGroupStructName('scenario')!;
  const scnrDef = resolveStruct(scenarioStruct);
  const anchor = resolveScenarioAnchor(buffer, header, tagIndex);
  const fwdX = Math.cos(anchor.facing);
  const fwdY = Math.sin(anchor.facing);

  const placementBlocks: Array<{ block: string; palette: string; tagGroup: string; fourCC: string; objType: number }> = [
    { block: 'bipeds', palette: 'biped palette', tagGroup: 'biped', fourCC: 'bipd', objType: 0 },
    { block: 'vehicles', palette: 'vehicle palette', tagGroup: 'vehicle', fourCC: 'vehi', objType: 1 },
    { block: 'weapons', palette: 'weapon palette', tagGroup: 'weapon', fourCC: 'weap', objType: 2 },
    { block: 'equipment', palette: 'equipment palette', tagGroup: 'equipment', fourCC: 'eqip', objType: 3 },
    { block: 'scenery', palette: 'scenery palette', tagGroup: 'scenery', fourCC: 'scen', objType: 6 },
    { block: 'machines', palette: 'machine palette', tagGroup: 'device_machine', fourCC: 'mach', objType: 7 },
    { block: 'controls', palette: 'control palette', tagGroup: 'device_control', fourCC: 'ctrl', objType: 8 },
    { block: 'light fixtures', palette: 'light fixture palette', tagGroup: 'device_light_fixture', fourCC: 'lifi', objType: 9 },
    { block: 'sound scenery', palette: 'sound scenery palette', tagGroup: 'sound_scenery', fourCC: 'ssce', objType: 11 },
  ];

  const scnrAt0 = resolveTagDataPointer(scenario.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  if (!isRangeInBuffer(scnrAt0, scnrDef.totalSize, buffer.length)) return buffer;

  // Repair invalid MP player starting locations (e.g., team_index=100 copied from campaign BSP swaps causing MP blue screen)
  const pslCount0 = buffer.readUInt32LE(scnrAt0 + 0x354);
  const pslPtr0 = buffer.readUInt32LE(scnrAt0 + 0x358);
  if (pslCount0 > 0 && pslPtr0 > 0) {
    const pslBase = resolvePointer(pslPtr0, header.tagDataOffset, tagIndex.baseMemoryAddress);
    if (isRangeInBuffer(pslBase, pslCount0 * 52, buffer.length)) {
      for (let i = 0; i < pslCount0; i++) {
        const sOff = pslBase + i * 52;
        const teamIdx = buffer.readInt16LE(sOff + 16);
        const type0 = buffer.readInt16LE(sOff + 20);
        if (teamIdx < 0 || teamIdx > 1) {
          buffer.writeInt16LE(i % 2, sOff + 16);
        }
        if (type0 === 0) {
          buffer.writeInt16LE(12, sOff + 20);
        }
      }
    }
  }

  const decoded0 = decodeStruct(buffer, scnrAt0, scenarioStruct);
  const objNamesRef0 = decoded0.get('object names');
  if (objNamesRef0?.kind !== 'reflexive' || objNamesRef0.value.count <= 0) return buffer;

  const objNamesCount = objNamesRef0.value.count;
  const objNamesBase0 = resolvePointer(objNamesRef0.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
  if (!isRangeInBuffer(objNamesBase0, objNamesCount * 36, buffer.length)) return buffer;

  // Step 1: Determine desired object_type for every object_names[i] FIRST so we can unbind any mismatched placements
  const targetTypes = new Array<number>(objNamesCount).fill(1);
  const objNameStrings = new Array<string>(objNamesCount).fill('');
  for (let i = 0; i < objNamesCount; i++) {
    const entryOff = objNamesBase0 + i * 36;
    const zeroIdx = buffer.indexOf(0, entryOff);
    const end = zeroIdx >= entryOff && zeroIdx < entryOff + 32 ? zeroIdx : entryOff + 32;
    const nameStr = buffer.toString('latin1', entryOff, end).trim();
    objNameStrings[i] = nameStr;

    const curType = buffer.readInt16LE(entryOff + 32);
    const inferred = inferredObjectTypesByNameIdx.get(i);
    const isVehicleName = /pelican|dropship|wraith|tank|warthog|hog|banshee|ghost|scorpion|turret|vehicle/i.test(nameStr);
    const isDoorName = /door|gate|shutter|switch|lift|elevator/i.test(nameStr);
    const isBipedName = !isVehicleName && /marine|elite|grunt|jackal|hunter|cyborg|biped|npc|chief|rider|ai_/i.test(nameStr);

    let t = isVehicleName
      ? 1
      : isDoorName
        ? 7
        : isBipedName
          ? 0
          : curType >= 0
            ? curType
            : 1;
    if (inferred !== undefined && !isVehicleName && !isBipedName && !isDoorName) {
      if (inferred === 7 && (t < 7 || t > 9)) t = 7;
      else if (inferred === 1 && curType < 0 && t !== 1 && t !== 0) t = 1;
      else if (t < 0 && inferred >= 0) t = inferred;
    }
    if (!placementBlocks.some((pb) => pb.objType === t)) t = 1;
    targetTypes[i] = t;
  }

  // Step 2: Sync any existing placement[k].name -> object_names[nameIdx], unbinding placements in the wrong block
  const alreadyBoundObjectNames = new Set<number>();
  for (const { block, objType } of placementBlocks) {
    const ref = decoded0.get(block);
    const fieldDef = scnrDef.fields.find((f) => f.name === block);
    if (ref?.kind !== 'reflexive' || ref.value.count <= 0 || !fieldDef?.def.struct) continue;
    const childStruct = resolveStruct(fieldDef.def.struct);
    const nameField = childStruct.fields.find((f) => f.name === 'name');
    if (!nameField) continue;
    const blockBase = resolvePointer(ref.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    if (!isRangeInBuffer(blockBase, ref.value.count * childStruct.totalSize, buffer.length)) continue;
    for (let k = 0; k < ref.value.count; k++) {
      const elemNameOff = blockBase + k * childStruct.totalSize + nameField.offset;
      const nameIdx = buffer.readInt16LE(elemNameOff);
      if (nameIdx >= 0 && nameIdx < objNamesCount) {
        if (targetTypes[nameIdx] === objType && !alreadyBoundObjectNames.has(nameIdx)) {
          const entryOff = objNamesBase0 + nameIdx * 36;
          buffer.writeInt16LE(objType, entryOff + 32);
          buffer.writeInt16LE(k, entryOff + 34);
          alreadyBoundObjectNames.add(nameIdx);
        } else {
          // Clear stale/wrong-block placement binding so Halo's scenario_check_object_names never sees a conflict
          buffer.writeInt16LE(-1, elemNameOff);
        }
      }
    }
  }

  // Step 2.4: Repair any existing scenario palette entries whose TagDependency namePointer (+4) is 0
  // so OpenCE's cache loader never nulls out palette entries with "reference has a name outside the tags: none"
  {
    const tagHeaderSize = header.engine === 5 ? 0x24 : 0x28;
    const tagArrBase = header.tagDataOffset + tagHeaderSize;
    const palettesToRepair: Array<{ name: string; elemSize: number }> = [
      ...placementBlocks.map((pb) => ({ name: pb.palette, elemSize: 48 })),
      { name: 'actor palette', elemSize: 16 },
    ];
    for (const { name: palName, elemSize } of palettesToRepair) {
      const palRef = decoded0.get(palName);
      if (palRef?.kind !== 'reflexive' || palRef.value.count <= 0) continue;
      const palBase = resolvePointer(palRef.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
      if (!isRangeInBuffer(palBase, palRef.value.count * elemSize, buffer.length)) continue;
      for (let p = 0; p < palRef.value.count; p++) {
        const pOff = palBase + p * elemSize;
        const tid = buffer.readUInt32LE(pOff + 12);
        const namePtr = buffer.readUInt32LE(pOff + 4);
        if (tid !== 0xffffffff && tid !== 0 && namePtr === 0) {
          const tIdx = tid & 0xffff;
          if (tIdx < tagIndex.entries.length && tagIndex.entries[tIdx]!.tagId === tid) {
            const pathPtr = buffer.readUInt32LE(tagArrBase + tIdx * 32 + 0x10);
            buffer.writeUInt32LE(pathPtr >>> 0, pOff + 4);
          }
        }
      }
    }
  }

  // Step 2.5: Ensure palettes have matching tags from the map (e.g. pelican, c_dropship, warthog, marine, elite, cyborg)
  const ensureTagInPalette = (pb: (typeof placementBlocks)[number], preferredKeyword?: string): number => {
    const scnrAt = resolveTagDataPointer(scenario.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
    const dec = decodeStruct(buffer, scnrAt, scenarioStruct);
    const palRef = dec.get(pb.palette);
    const existingTagIds: number[] = [];
    const existingPaths: string[] = [];
    if (palRef?.kind === 'reflexive' && palRef.value.count > 0) {
      const palBase = resolvePointer(palRef.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
      for (let p = 0; p < palRef.value.count; p++) {
        const tidOff = palBase + p * 48 + 12;
        if (tidOff + 4 <= buffer.length) {
          const tid = buffer.readUInt32LE(tidOff);
          existingTagIds.push(tid);
          const ent = tagIndex.entries.find((e) => e.tagId === tid);
          existingPaths.push(ent?.path.toLowerCase() ?? '');
        }
      }
    }
    if (preferredKeyword) {
      const foundExisting = existingPaths.findIndex((p) => p.includes(preferredKeyword));
      if (foundExisting >= 0) return foundExisting;
    }
    const candidates = tagIndex.entries.filter((e) => e.primaryClassName === pb.tagGroup && !e.isExternal);
    let chosenTag = preferredKeyword
      ? candidates.find((e) => e.path.toLowerCase().includes(preferredKeyword))
      : undefined;
    if (!chosenTag && existingTagIds.length === 0) {
      chosenTag = candidates[0];
    }
    // If a multiplayer map (e.g. bloodgulch.map) has 0 device_machine tags in tagIndex, repurpose an unplaced scenery palette tag into a valid 804-byte DeviceMachine
    if (!chosenTag && existingTagIds.length === 0 && pb.tagGroup === 'device_machine') {
      const spRef = dec.get('scenery palette');
      const scRef = dec.get('scenery');
      if (spRef?.kind === 'reflexive' && spRef.value.count > 0) {
        const usedScPal = new Set<number>();
        if (scRef?.kind === 'reflexive' && scRef.value.count > 0) {
          const scBase = resolvePointer(scRef.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
          for (let s = 0; s < scRef.value.count; s++) {
            const so = scBase + s * 72;
            if (so + 2 <= buffer.length) usedScPal.add(buffer.readInt16LE(so));
          }
        }
        const spBase = resolvePointer(spRef.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
        let unusedSpIdx = -1;
        let unusedTagEnt: (typeof tagIndex.entries)[number] | undefined;
        for (let p = spRef.value.count - 1; p >= 0; p--) {
          if (usedScPal.has(p)) continue;
          const tid = buffer.readUInt32LE(spBase + p * 48 + 12);
          const ent = tagIndex.entries.find((e) => e.tagId === tid && !e.isExternal);
          if (ent) {
            unusedSpIdx = p;
            unusedTagEnt = ent;
            break;
          }
        }
        if (unusedSpIdx >= 0 && unusedTagEnt) {
          // Clear the unused scenery palette TagDependency so tag_validate doesn't check it as 'scen'
          buffer.writeUInt32LE(0xffffffff, spBase + unusedSpIdx * 48 + 12);
          // Pick a donor scenery tag (prefer boulder/teleporter) for 3D model + collision model references
          const donorEnt =
            tagIndex.entries.find(
              (e) => e.primaryClassName === 'scenery' && !e.isExternal && /boulder|teleporter|rock/i.test(e.path),
            ) ?? unusedTagEnt;
          const donorOff = resolveTagDataPointer(
            donorEnt.tagDataPointerOrResourceIndex,
            header,
            tagIndex.baseMemoryAddress,
          );
          const machBuf = Buffer.alloc(804, 0);
          if (donorOff + 320 <= buffer.length) {
            buffer.copy(machBuf, 0, donorOff, donorOff + 320);
          }
          machBuf.writeInt16LE(7, 0); // object_type = 7 (device_machine)
          // Ensure any unset TagDependency in 0..319 has tagId = 0xffffffff
          for (const depOff of [40, 56, 112, 128, 144, 160]) {
            if (machBuf.readUInt32LE(depOff + 12) === 0) {
              machBuf.writeUInt32LE(0xffffffff, depOff + 12);
            }
          }
          // Set DeviceMachine fields + empty TagDependency references (tagId = 0xffffffff)
          for (const depOff of [416, 432, 448, 464, 480, 496, 524]) {
            machBuf.writeUInt32LE(0xffffffff, depOff + 12);
          }
          machBuf.writeFloatLE(1.0, 392); // position transition time
          machBuf.writeFloatLE(0.2, 396); // position acceleration time
          machBuf.writeFloatLE(2.5, 540); // automatic activation radius
          machBuf.writeFloatLE(0.2, 628); // inverse power acceleration time
          machBuf.writeFloatLE(1.0 / 30.0, 632); // inverse power transition time
          machBuf.writeFloatLE(0.15, 644); // inverse position acceleration time
          machBuf.writeFloatLE(1.0 / 30.0, 648); // inverse position transition time
          machBuf.writeInt16LE(0, 656); // machine type = 0 (door)
          machBuf.writeFloatLE(4.0, 660); // door open time
          machBuf.writeUInt32LE(120, 800); // door open time ticks

          const padBytes = (4 - ((buffer.length - header.tagDataOffset) % 4)) % 4;
          const newMachFileOff = buffer.length + padBytes;
          const newMachMemPtr = (tagIndex.baseMemoryAddress + (newMachFileOff - header.tagDataOffset)) >>> 0;
          buffer = Buffer.concat([buffer, Buffer.alloc(padBytes, 0), machBuf]);
          const tagHeaderSize = header.engine === 5 ? 0x24 : 0x28;
          const tagEntryOff = header.tagDataOffset + tagHeaderSize + unusedTagEnt.index * 32;
          buffer.write('hcam', tagEntryOff + 0x00, 4, 'latin1'); // 'mach' in LE
          buffer.write('ived', tagEntryOff + 0x04, 4, 'latin1'); // 'devi' in LE
          buffer.write('ejbo', tagEntryOff + 0x08, 4, 'latin1'); // 'obje' in LE
          buffer.writeUInt32LE(newMachMemPtr, tagEntryOff + 0x14);
          buffer.writeUInt32LE(buffer.length >>> 0, 0x08);
          buffer.writeUInt32LE((buffer.length - header.tagDataOffset) >>> 0, 0x14);
          header = parseCacheFileHeader(buffer);
          tagIndex = parseTagIndex(buffer, header);
          chosenTag = tagIndex.entries[unusedTagEnt.index];
        }
      }
    }
    if (chosenTag) {
      const alreadyIdx = existingTagIds.indexOf(chosenTag.tagId);
      if (alreadyIdx >= 0) return alreadyIdx;
      const addPal = addReflexiveChunk(buffer, header, tagIndex, scenario.index, pb.palette, -1);
      buffer = addPal.buffer;
      header = addPal.header;
      tagIndex = addPal.tagIndex;
      const tagHeaderSize = header.engine === 5 ? 0x24 : 0x28;
      const chosenPathPtr = buffer.readUInt32LE(header.tagDataOffset + tagHeaderSize + chosenTag.index * 32 + 0x10);
      buffer.write(pb.fourCC.split('').reverse().join(''), addPal.newElementOffset + 0, 4, 'latin1');
      buffer.writeUInt32LE(chosenPathPtr >>> 0, addPal.newElementOffset + 4);
      buffer.writeUInt32LE(0, addPal.newElementOffset + 8);
      buffer.writeUInt32LE(chosenTag.tagId, addPal.newElementOffset + 12);
      return addPal.newElementIndex;
    }
    return existingTagIds.length > 0 ? 0 : -1;
  };

  const isIndexActive = (idx: number): boolean => {
    if (inferredObjectTypesByNameIdx.has(idx)) return true;
    const nm = (objNameStrings[idx] ?? '').toLowerCase();
    if (activeObjectNamesLower && activeObjectNamesLower.has(nm)) return true;
    return false;
  };

  const resolveSearchKeywords = (lowerName: string): string[] => {
    const explicitType = (customObjectTypes?.[lowerName] ?? '').toLowerCase();
    const checkStr = explicitType || lowerName;
    if (checkStr.includes('pelican')) return ['pelican', 'c_dropship', 'dropship'];
    if (checkStr.includes('c_dropship') || checkStr.includes('cdropship') || checkStr.includes('dropship')) {
      return ['c_dropship', 'dropship', 'pelican'];
    }
    if (
      checkStr.includes('door') ||
      checkStr.includes('gate') ||
      checkStr.includes('shutter') ||
      checkStr.includes('airlock') ||
      checkStr.includes('lift') ||
      checkStr.includes('elevator')
    ) {
      return ['door small', 'door', 'airlock', 'gate', 'shutter', 'lift', 'elevator'];
    }
    if (checkStr.includes('tank') || checkStr.includes('scorpion')) {
      return ['scorpion', 'warthog', 'wraith', 'turret', 'ghost'];
    }
    if (checkStr.includes('hog') || checkStr.includes('warthog')) {
      return ['warthog', 'scorpion', 'ghost', 'wraith'];
    }
    if (checkStr.includes('wraith')) return ['wraith', 'scorpion', 'turret', 'ghost'];
    if (checkStr.includes('ghost')) return ['ghost', 'wraith', 'banshee', 'warthog'];
    if (checkStr.includes('banshee')) return ['banshee', 'ghost', 'wraith'];
    if (checkStr.includes('turret')) return ['turret', 'wraith', 'ghost'];
    if (checkStr.includes('marine')) return ['marine', 'cyborg', 'elite'];
    if (checkStr.includes('elite')) return ['elite', 'hunter', 'grunt', 'jackal'];
    const keywords = ['banshee', 'ghost', 'boulder', 'grunt', 'cyborg'];
    const matched = keywords.find((kw) => checkStr.includes(kw));
    return matched ? [matched] : [];
  };

  for (let i = 0; i < objNamesCount; i++) {
    if (!isIndexActive(i)) continue;
    const t = targetTypes[i]!;
    const pb = placementBlocks.find((p) => p.objType === t) ?? placementBlocks[1]!;
    const lowerName = objNameStrings[i]!.toLowerCase();
    const kws = resolveSearchKeywords(lowerName);
    let ensured = -1;
    for (const kw of kws) {
      ensured = ensureTagInPalette(pb, kw);
      if (ensured >= 0) break;
    }
    if (ensured < 0) ensureTagInPalette(pb, undefined);
  }

  // Step 3: Ensure each target placement block has dedicated fresh elements for every newly-added active object_names[i]
  // (so we never hijack existing campaign placements in other BSPs on maps like a50.map)
  const preallocatedPlacementByObjNameIdx = new Map<number, number>();
  for (let i = 0; i < objNamesCount; i++) {
    if (!isIndexActive(i)) continue;
    if (alreadyBoundObjectNames.has(i)) continue;
    const t = targetTypes[i]!;
    const pb = placementBlocks.find((p) => p.objType === t) ?? placementBlocks[1]!;
    const addRes = addReflexiveChunk(buffer, header, tagIndex, scenario.index, pb.block, -1);
    buffer = addRes.buffer;
    header = addRes.header;
    tagIndex = addRes.tagIndex;
    buffer.writeInt16LE(0, addRes.newElementOffset + 0);
    buffer.writeInt16LE(i, addRes.newElementOffset + 2);
    const initX = anchor.x + fwdX * (8 + (i % 6) * 3);
    const initY = anchor.y + fwdY * (8 + (i % 6) * 3) + ((i % 3) - 1) * 3;
    const clampedPos = clampPointInsideBsp0(buffer, header, tagIndex, initX, initY, anchor.z + 0.5, 0.5);
    buffer.writeFloatLE(clampedPos.x, addRes.newElementOffset + 8);
    buffer.writeFloatLE(clampedPos.y, addRes.newElementOffset + 12);
    buffer.writeFloatLE(clampedPos.z, addRes.newElementOffset + 16);
    if (pb.objType === 7 || pb.objType === 8 || pb.objType === 9) {
      // Device placements MUST have power_group = -1 (NONE) and position_group = -1 (NONE) unless bound to a scenario device_group
      buffer.writeInt16LE(-1, addRes.newElementOffset + 40);
      buffer.writeInt16LE(-1, addRes.newElementOffset + 42);
      if (pb.objType === 8) {
        buffer.writeInt16LE(-1, addRes.newElementOffset + 52); // custom control name = NONE (-1)
      }
    }
    preallocatedPlacementByObjNameIdx.set(i, addRes.newElementIndex);
  }

  // Step 3.5: Ensure all existing device placements (machines, controls, light fixtures) have valid power_group / position_group (-1 or < deviceGroupsCount)
  {
    const scnrAtDev = resolveTagDataPointer(scenario.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
    const decDev = decodeStruct(buffer, scnrAtDev, scenarioStruct);
    const dgRef = decDev.get('device groups');
    const dgCount = dgRef?.kind === 'reflexive' ? dgRef.value.count : 0;
    for (const devBlock of ['machines', 'controls', 'light fixtures'] as const) {
      const dRef = decDev.get(devBlock);
      if (dRef?.kind !== 'reflexive' || dRef.value.count <= 0) continue;
      const dBase = resolvePointer(dRef.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
      const elemSz = devBlock === 'light fixtures' ? 64 : 64;
      if (!isRangeInBuffer(dBase, dRef.value.count * elemSz, buffer.length)) continue;
      for (let k = 0; k < dRef.value.count; k++) {
        const eo = dBase + k * elemSz;
        const pwrGrp = buffer.readInt16LE(eo + 40);
        const posGrp = buffer.readInt16LE(eo + 42);
        if (pwrGrp < -1 || pwrGrp >= dgCount) buffer.writeInt16LE(-1, eo + 40);
        if (posGrp < -1 || posGrp >= dgCount) buffer.writeInt16LE(-1, eo + 42);
      }
    }
  }

  // Step 4: Bind every active object_names[i] to a valid, unique placement k in its target placement block;
  // for inactive object_names[i], validate existing binding or reset to (-1, -1) if its placement was deleted.
  const scnrAtFinal = resolveTagDataPointer(scenario.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  const decodedFinal = decodeStruct(buffer, scnrAtFinal, scenarioStruct);
  const objNamesRefFinal = decodedFinal.get('object names');
  if (objNamesRefFinal?.kind !== 'reflexive') return buffer;
  const objNamesBaseFinal = resolvePointer(
    objNamesRefFinal.value.pointerLow,
    header.tagDataOffset,
    tagIndex.baseMemoryAddress,
  );

  const usedByBlock = new Map<string, Set<number>>();
  for (const pb of placementBlocks) usedByBlock.set(pb.block, new Set());

  for (let i = 0; i < objNamesCount; i++) {
    const entryOff = objNamesBaseFinal + i * 36;
    const t = targetTypes[i]!;
    const pb = placementBlocks.find((p) => p.objType === t) ?? placementBlocks[1]!;
    const used = usedByBlock.get(pb.block)!;
    const ref = decodedFinal.get(pb.block);
    const fieldDef = scnrDef.fields.find((f) => f.name === pb.block);
    const curPlacement = buffer.readInt16LE(entryOff + 34);

    if (!isIndexActive(i)) {
      if (ref?.kind === 'reflexive' && ref.value.count > 0 && fieldDef?.def.struct) {
        const childStruct = resolveStruct(fieldDef.def.struct);
        const nameField = childStruct.fields.find((f) => f.name === 'name');
        const blockBase = resolvePointer(ref.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
        if (
          nameField &&
          curPlacement >= 0 &&
          curPlacement < ref.value.count &&
          isRangeInBuffer(blockBase, ref.value.count * childStruct.totalSize, buffer.length)
        ) {
          const existingNameIdx = buffer.readInt16LE(blockBase + curPlacement * childStruct.totalSize + nameField.offset);
          if (existingNameIdx === i && !used.has(curPlacement)) {
            used.add(curPlacement);
            continue;
          }
        }
      }
      buffer.writeInt16LE(-1, entryOff + 32);
      buffer.writeInt16LE(-1, entryOff + 34);
      continue;
    }

    if (ref?.kind !== 'reflexive' || ref.value.count <= 0 || !fieldDef?.def.struct) continue;
    const childStruct = resolveStruct(fieldDef.def.struct);
    const nameField = childStruct.fields.find((f) => f.name === 'name');
    const typeField = childStruct.fields.find((f) => f.name === 'type');
    if (!nameField) continue;

    const blockBase = resolvePointer(ref.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    if (!isRangeInBuffer(blockBase, ref.value.count * childStruct.totalSize, buffer.length)) continue;

    // Resolve palette paths if available to prefer matching vehicle/biped types (e.g. pelican for pelican_drop)
    const palettePaths: string[] = [];
    const palRef = decodedFinal.get(pb.palette);
    if (palRef?.kind === 'reflexive' && palRef.value.count > 0) {
      const palBase = resolvePointer(palRef.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
      for (let pIdx = 0; pIdx < palRef.value.count; pIdx++) {
        const tidOff = palBase + pIdx * 48 + 12;
        if (tidOff + 4 <= buffer.length) {
          const tid = buffer.readUInt32LE(tidOff);
          const ent = tagIndex.entries.find((e) => e.tagId === tid);
          palettePaths.push(ent?.path.toLowerCase() ?? '');
        }
      }
    }

    const lowerObjName = objNameStrings[i]!.toLowerCase();
    const searchKws = resolveSearchKeywords(lowerObjName);
    let matchedPalIdx = -1;
    for (const kw of searchKws) {
      matchedPalIdx = palettePaths.findIndex((p) => p.includes(kw));
      if (matchedPalIdx >= 0) break;
    }
    const searchKw = searchKws[0];

    let chosenK = preallocatedPlacementByObjNameIdx.get(i) ?? -1;
    // 1. Keep current placement if valid, unused, and already points to i
    if (chosenK < 0 && curPlacement >= 0 && curPlacement < ref.value.count && !used.has(curPlacement)) {
      const existingNameIdx = buffer.readInt16LE(blockBase + curPlacement * childStruct.totalSize + nameField.offset);
      if (existingNameIdx === i) {
        chosenK = curPlacement;
      }
    }
    // 2. Check if any placement already has .name === i
    if (chosenK < 0) {
      for (let k = 0; k < ref.value.count; k++) {
        if (used.has(k)) continue;
        const nIdx = buffer.readInt16LE(blockBase + k * childStruct.totalSize + nameField.offset);
        if (nIdx === i) {
          chosenK = k;
          break;
        }
      }
    }
    // 3. Prefer an unnamed placement whose palette tag path matches keywords in objName
    if (chosenK < 0 && typeField && searchKw && palettePaths.length > 0) {
      for (let k = 0; k < ref.value.count; k++) {
        if (used.has(k)) continue;
        const elemOff = blockBase + k * childStruct.totalSize;
        const nIdx = buffer.readInt16LE(elemOff + nameField.offset);
        const palIdx = buffer.readInt16LE(elemOff + typeField.offset);
        if (nIdx < 0 && palIdx >= 0 && (palettePaths[palIdx] ?? '').includes(searchKw)) {
          chosenK = k;
          break;
        }
      }
    }
    // 4. First unnamed placement
    if (chosenK < 0) {
      for (let k = 0; k < ref.value.count; k++) {
        if (used.has(k)) continue;
        const nIdx = buffer.readInt16LE(blockBase + k * childStruct.totalSize + nameField.offset);
        if (nIdx < 0) {
          chosenK = k;
          break;
        }
      }
    }
    // 5. Fallback to first unused placement
    if (chosenK < 0) {
      for (let k = 0; k < ref.value.count; k++) {
        if (!used.has(k)) {
          chosenK = k;
          break;
        }
      }
    }
    if (chosenK < 0) chosenK = 0;

    used.add(chosenK);
    const chosenElemOff = blockBase + chosenK * childStruct.totalSize;
    buffer.writeInt16LE(i, chosenElemOff + nameField.offset);
    if (typeField) {
      const curPalIdx = buffer.readInt16LE(chosenElemOff + typeField.offset);
      if (matchedPalIdx >= 0) {
        buffer.writeInt16LE(matchedPalIdx, chosenElemOff + typeField.offset);
      } else if (curPalIdx < 0 && palettePaths.length > 0) {
        buffer.writeInt16LE(0, chosenElemOff + typeField.offset);
      }
    }
    // Position dropships/pelicans and newly-bound battle units in formation relative to the player spawn
    const px = buffer.readFloatLE(chosenElemOff + 8);
    const py = buffer.readFloatLE(chosenElemOff + 12);
    const pz = buffer.readFloatLE(chosenElemOff + 16);
    const explicitType = (customObjectTypes?.[lowerObjName] ?? '').toLowerCase();
    const isPelican = explicitType ? explicitType.includes('pelican') : lowerObjName.includes('pelican');
    const isCovDropship = explicitType
      ? explicitType.includes('c_dropship') || explicitType.includes('cdropship') || explicitType.includes('dropship')
      : !isPelican && lowerObjName.includes('dropship');
    const isDropship = isPelican || isCovDropship;
    const isScriptSpawnedVeh =
      isDropship ||
      (scriptCreatedObjectsLower?.has(lowerObjName) ?? false) ||
      /unsc_tank|cov_wraith|drop_hog|cargo_|scorpion_|wraith_|ghost_/i.test(lowerObjName);
    if (isScriptSpawnedVeh && (pb.objType === 1 || pb.objType === 0)) {
      buffer.writeInt16LE(1, chosenElemOff + 4); // not_placed = 1 (created by script)
    }
    const isNewPlacement = preallocatedPlacementByObjNameIdx.has(i);
    const customObjCoord =
      customObjectCoords?.[objNameStrings[i]!] ?? customObjectCoords?.[lowerObjName];
    if (customObjCoord) {
      if (isDropship) {
        buffer.writeFloatLE(customObjCoord.x, chosenElemOff + 8);
        buffer.writeFloatLE(customObjCoord.y, chosenElemOff + 12);
        buffer.writeFloatLE(customObjCoord.z, chosenElemOff + 16);
      } else {
        const clampedCustom = clampPointInsideBsp0(
          buffer,
          header,
          tagIndex,
          customObjCoord.x,
          customObjCoord.y,
          customObjCoord.z,
          0.4,
        );
        buffer.writeFloatLE(clampedCustom.x, chosenElemOff + 8);
        buffer.writeFloatLE(clampedCustom.y, chosenElemOff + 12);
        buffer.writeFloatLE(clampedCustom.z, chosenElemOff + 16);
      }
      if (customObjCoord.yaw !== undefined && Number.isFinite(customObjCoord.yaw)) {
        buffer.writeFloatLE(customObjCoord.yaw, chosenElemOff + 20);
      }
    } else if ((px === 0 && py === 0 && pz === 0) || isNewPlacement) {
      const rightX = -fwdY;
      const rightY = fwdX;
      if (isPelican) {
        const lane = (i % 4) - 1.5;
        buffer.writeFloatLE(anchor.x - fwdX * 22.0 + rightX * (lane * 5.5), chosenElemOff + 8);
        buffer.writeFloatLE(anchor.y - fwdY * 22.0 + rightY * (lane * 5.5), chosenElemOff + 12);
        buffer.writeFloatLE(anchor.z + 4.2, chosenElemOff + 16);
        buffer.writeFloatLE(anchor.facing, chosenElemOff + 20);
      } else if (isCovDropship) {
        const lane = (i % 4) - 1.5;
        buffer.writeFloatLE(anchor.x + fwdX * 36.0 + rightX * (lane * 5.5), chosenElemOff + 8);
        buffer.writeFloatLE(anchor.y + fwdY * 36.0 + rightY * (lane * 5.5), chosenElemOff + 12);
        buffer.writeFloatLE(anchor.z + 4.2, chosenElemOff + 16);
        buffer.writeFloatLE(anchor.facing + Math.PI, chosenElemOff + 20);
      } else {
        const gx = anchor.x + fwdX * (10 + (i % 4) * 3);
        const gy = anchor.y + fwdY * (10 + (i % 4) * 3) + ((i % 3) - 1) * 3;
        const clampedG = clampPointInsideBsp0(buffer, header, tagIndex, gx, gy, anchor.z + 0.4, 0.4);
        buffer.writeFloatLE(clampedG.x, chosenElemOff + 8);
        buffer.writeFloatLE(clampedG.y, chosenElemOff + 12);
        buffer.writeFloatLE(clampedG.z, chosenElemOff + 16);
      }
    }
    buffer.writeInt16LE(pb.objType, entryOff + 32);
    buffer.writeInt16LE(chosenK, entryOff + 34);
  }

  return buffer;
}

/**
 * No-op: `compileHaloScriptIntoScenario` reuses the scenario's existing 380,076-byte `script syntax data`
 * block in-place, avoiding mid-`tagData` splicing that could miss unmapped nested reflexive pointers.
 */
export function reclaimOrphanedScriptSyntaxBlocks(view: Buffer): Buffer {
  return view;
}

/**
 * Compiles `.hsc` HaloScript source into the scenario's `globals`, `scripts`, `script string data`,
 * and `script syntax data` blocks in-memory.
 */
export function compileHaloScriptIntoScenario(view: Buffer, hscSource: string): HaloScriptCompileResult {
  const diagnostics = lintHaloScript(hscSource);
  const hasErrors = diagnostics.some((d) => d.severity === 'error');
  if (hasErrors) {
    return {
      buffer: view,
      compiledScripts: 0,
      compiledGlobals: 0,
      syntaxNodesUsed: 0,
      diagnostics,
    };
  }

  // In Multiplayer scenarios, Player 0 is assigned team 'default' (0) while Player 1 is 'player' (1).
  // Ensure any script that allies 'player' and 'human' also allies 'default' with 'human' and 'player'
  // so allied Marines never treat Player 0 as an enemy!
  let effectiveHscSource = hscSource;
  if (
    /\(\s*ai_allegiance\s+player\s+human\s*\)/i.test(effectiveHscSource) &&
    !/\(\s*ai_allegiance\s+default\s+human\s*\)/i.test(effectiveHscSource)
  ) {
    effectiveHscSource = effectiveHscSource.replace(
      /\(\s*ai_allegiance\s+player\s+human\s*\)/i,
      '(ai_allegiance player human) (ai_allegiance default human) (ai_allegiance human default) (ai_allegiance default player) (ai_allegiance player default)',
    );
  }

  const { expressions } = parseHaloScriptSExpressions(effectiveHscSource);

  // Collect declared globals and script names first so we don't mistake them for scenario entities
  const declaredIdentNames = new Set<string>(['true', 'false', 'none', 'players', 'player', 'human', 'covenant', 'flood', 'sentinel', 'default']);
  for (const expr of expressions) {
    if (expr.kind !== 'list') continue;
    const head = expr.items[0];
    if (head?.kind === 'atom' && head.text === 'global' && expr.items[2]?.kind === 'atom') {
      declaredIdentNames.add(expr.items[2].text);
    } else if (head?.kind === 'atom' && head.text === 'script') {
      const secondAtom = expr.items[2];
      const hasExplicitReturn =
        secondAtom?.kind === 'atom' && VALUE_TYPE_BY_NAME[secondAtom.text] !== undefined && expr.items.length >= 5;
      const sNameAtom = hasExplicitReturn ? expr.items[3] : secondAtom;
      if (sNameAtom?.kind === 'atom') declaredIdentNames.add(sNameAtom.text);
    }
  }

  // Automatically discover any object names, trigger volumes, camera points, cutscene flags, recorded animations, and AI encounters referenced in the script
  const autoObjectNames = new Set<string>();
  const autoTriggerVolumes = new Set<string>();
  const autoCameraPoints = new Set<string>();
  const autoCutsceneFlags = new Set<string>();
  const autoRecordedAnimations = new Set<string>();
  const autoEncounters = new Set<string>();
  const autoDeviceGroups = new Set<string>();
  const autoCommandLists = new Set<string>();
  const autoCutsceneTitles = new Set<string>();
  const autoTagReferences: Array<{ path: string; hsType: number }> = [];
  const collectRequiredEntities = (expr: SExpr): void => {
    if (expr.kind !== 'list' || expr.items.length === 0) return;
    const head = expr.items[0]!;
    const fnName = head.kind === 'atom' ? head.text : '';
    const builtin = BUILTIN_FUNCTIONS[fnName];
    for (let a = 1; a < expr.items.length; a++) {
      const arg = expr.items[a]!;
      const argIdx = a - 1;
      if (arg.kind === 'atom' && builtin && argIdx < builtin.params.length) {
        const pType = builtin.params[argIdx]!;
        if (pType >= 24 && pType <= 31 && arg.text.toLowerCase() !== 'none') {
          autoTagReferences.push({ path: arg.text, hsType: pType });
        }
      }
      if (arg.kind === 'atom' && !arg.quoted && !/^-?\d+(\.\d+)?$/.test(arg.text) && !declaredIdentNames.has(arg.text)) {
        if (fnName === 'unit') {
          autoObjectNames.add(arg.text);
        } else if (builtin && argIdx < builtin.params.length) {
          const pType = builtin.params[argIdx]!;
          if (pType === 23 || (pType >= 37 && pType <= 48)) {
            autoObjectNames.add(arg.text);
          } else if (pType === 11) {
            autoTriggerVolumes.add(arg.text);
          } else if (pType === 12) {
            autoCutsceneFlags.add(arg.text);
          } else if (pType === 13) {
            autoCameraPoints.add(arg.text);
          } else if (pType === 14) {
            autoCutsceneTitles.add(arg.text);
          } else if (pType === 15) {
            autoRecordedAnimations.add(arg.text);
          } else if (pType === 16) {
            autoDeviceGroups.add(arg.text);
          } else if (pType === 17) {
            autoEncounters.add(arg.text);
          } else if (pType === 18) {
            autoCommandLists.add(arg.text);
          }
        }
      } else if (arg.kind === 'list') {
        collectRequiredEntities(arg);
      }
    }
  };
  for (const expr of expressions) {
    collectRequiredEntities(expr);
  }

  // Determine if the HSC source uses 3D Builder `; --- @begin_track ...` regions so top-level decompiler summary comments don't resurrect deleted tracks
  const hasBuilderTrackBlocks = /;\s*---\s*@begin_track\s+/i.test(hscSource);
  const trackRegions: string[] = [];
  if (hasBuilderTrackBlocks) {
    const trkRegex = /;\s*---\s*@begin_track\b[\s\S]*?;\s*---\s*@end_track\b/gi;
    let tm: RegExpExecArray | null;
    while ((tm = trkRegex.exec(hscSource)) !== null) {
      trackRegions.push(tm[0]!);
    }
  }
  const activeDirectiveSource =
    hasBuilderTrackBlocks && trackRegions.length > 0
      ? trackRegions.join('\n')
      : expressions.length > 0
        ? hscSource
        : '';

  // Parse optional `; @flight_path <anim_name> x0,y0,z0;x1,y1,z1;...` comments from the HSC source
  const customFlightWaypoints: Record<string, Array<{ x: number; y: number; z: number }>> = {};
  const flightPathRegex = /^\s*;\s*@flight_path\s+([A-Za-z0-9_.-]+)\s+(.+)$/gm;
  let fpMatch: RegExpExecArray | null;
  while ((fpMatch = flightPathRegex.exec(hscSource)) !== null) {
    const animName = fpMatch[1]!.trim();
    if (/launch_interactive_builder/i.test(animName)) continue;
    const ptsRaw = fpMatch[2]!.trim().split(';');
    const pts: Array<{ x: number; y: number; z: number }> = [];
    for (const ptStr of ptsRaw) {
      const coords = ptStr.split(',').map((s) => Number.parseFloat(s.trim()));
      if (coords.length >= 3 && coords.every((n) => Number.isFinite(n))) {
        pts.push({ x: coords[0]!, y: coords[1]!, z: coords[2]! });
      }
    }
    if (pts.length >= 2) {
      customFlightWaypoints[animName] = pts;
      customFlightWaypoints[toTagString31(animName)] = pts;
    }
  }
  while ((fpMatch = flightPathRegex.exec(activeDirectiveSource)) !== null) {
    const animName = fpMatch[1]!.trim();
    if (!/launch_interactive_builder/i.test(animName)) {
      autoRecordedAnimations.add(animName);
    }
  }

  // Parse optional `; @waypoint <flag_name> x,y,z[,yaw]` comments from the HSC source
  const customWaypointCoords: Record<string, { x: number; y: number; z: number; yaw?: number }> = {};
  const waypointRegex = /^\s*;\s*@waypoint\s+([A-Za-z0-9_.-]+)\s+([^\r\n]+)$/gm;
  let wpMatch: RegExpExecArray | null;
  while ((wpMatch = waypointRegex.exec(hscSource)) !== null) {
    const flagName = wpMatch[1]!.trim();
    if (/launch_interactive_builder/i.test(flagName)) continue;
    const coords = wpMatch[2]!.trim().split(',').map((s) => Number.parseFloat(s.trim()));
    if (coords.length >= 3 && Number.isFinite(coords[0]) && Number.isFinite(coords[1]) && Number.isFinite(coords[2])) {
      const val = {
        x: coords[0]!,
        y: coords[1]!,
        z: coords[2]!,
        yaw: coords.length >= 4 && Number.isFinite(coords[3]) ? coords[3] : undefined,
      };
      customWaypointCoords[flagName] = val;
      customWaypointCoords[toTagString31(flagName)] = val;
    }
  }
  while ((wpMatch = waypointRegex.exec(activeDirectiveSource)) !== null) {
    const flagName = wpMatch[1]!.trim();
    if (!/launch_interactive_builder/i.test(flagName)) {
      autoCutsceneFlags.add(flagName);
    }
  }

  // Parse optional `; @object_pos <obj_name> x,y,z[,yaw]` comments from the HSC source
  const customObjectCoords: Record<string, { x: number; y: number; z: number; yaw?: number }> = {};
  const objPosRegex = /^\s*;\s*@object_pos\s+([A-Za-z0-9_.-]+)\s+([^\r\n]+)$/gm;
  let opMatch: RegExpExecArray | null;
  while ((opMatch = objPosRegex.exec(hscSource)) !== null) {
    const objName = opMatch[1]!.trim();
    const coords = opMatch[2]!.trim().split(',').map((s) => Number.parseFloat(s.trim()));
    if (coords.length >= 3 && Number.isFinite(coords[0]) && Number.isFinite(coords[1]) && Number.isFinite(coords[2])) {
      const val = {
        x: coords[0]!,
        y: coords[1]!,
        z: coords[2]!,
        yaw: coords.length >= 4 && Number.isFinite(coords[3]) ? coords[3] : undefined,
      };
      customObjectCoords[objName] = val;
      customObjectCoords[toTagString31(objName)] = val;
    }
  }
  while ((opMatch = objPosRegex.exec(activeDirectiveSource)) !== null) {
    autoObjectNames.add(opMatch[1]!.trim());
  }

  // Parse optional `; @object_type <obj_name> <type_keyword>` comments from the HSC source
  const customObjectTypes: Record<string, string> = {};
  const objTypeRegex = /^\s*;\s*@object_type\s+([A-Za-z0-9_.-]+)\s+([A-Za-z0-9_.-]+)\s*$/gm;
  let otMatch: RegExpExecArray | null;
  while ((otMatch = objTypeRegex.exec(hscSource)) !== null) {
    const objName = otMatch[1]!.trim().toLowerCase();
    const typeKw = otMatch[2]!.trim().toLowerCase();
    if (objName && typeKw) {
      customObjectTypes[objName] = typeKw;
      customObjectTypes[toTagString31(objName)] = typeKw;
    }
  }

  // Parse optional `; @encounter_pos <enc_name> x,y,z[,yaw]` comments from the HSC source
  const customEncounterCoords: Record<string, { x: number; y: number; z: number; yaw?: number }> = {};
  const encPosRegex = /^\s*;\s*@encounter_pos\s+([A-Za-z0-9_.-/]+)\s+([^\r\n]+)$/gm;
  let epMatch: RegExpExecArray | null;
  while ((epMatch = encPosRegex.exec(hscSource)) !== null) {
    const rawEncName = epMatch[1]!.trim();
    const baseEncName = rawEncName.split('/')[0]!.trim();
    const coords = epMatch[2]!.trim().split(',').map((s) => Number.parseFloat(s.trim()));
    if (
      baseEncName &&
      coords.length >= 3 &&
      Number.isFinite(coords[0]) &&
      Number.isFinite(coords[1]) &&
      Number.isFinite(coords[2])
    ) {
      const val = {
        x: coords[0]!,
        y: coords[1]!,
        z: coords[2]!,
        yaw: coords.length >= 4 && Number.isFinite(coords[3]) ? coords[3] : undefined,
      };
      customEncounterCoords[baseEncName] = val;
      customEncounterCoords[toTagString31(baseEncName)] = val;
    }
  }
  while ((epMatch = encPosRegex.exec(activeDirectiveSource)) !== null) {
    autoEncounters.add(epMatch[1]!.trim());
  }

  // Parse optional `; @camera_pos <cam_name> x,y,z[,yaw[,pitch]]` comments from the HSC source
  const customCameraCoords: Record<string, { x: number; y: number; z: number; yaw?: number; pitch?: number }> = {};
  const camPosRegex = /^\s*;\s*@camera_pos\s+([A-Za-z0-9_.-]+)\s+([^\r\n]+)$/gm;
  let cpMatch: RegExpExecArray | null;
  while ((cpMatch = camPosRegex.exec(hscSource)) !== null) {
    const camName = cpMatch[1]!.trim();
    const coords = cpMatch[2]!.trim().split(',').map((s) => Number.parseFloat(s.trim()));
    if (coords.length >= 3 && Number.isFinite(coords[0]) && Number.isFinite(coords[1]) && Number.isFinite(coords[2])) {
      const val = {
        x: coords[0]!,
        y: coords[1]!,
        z: coords[2]!,
        yaw: coords.length >= 4 && Number.isFinite(coords[3]) ? coords[3] : undefined,
        pitch: coords.length >= 5 && Number.isFinite(coords[4]) ? coords[4] : undefined,
      };
      customCameraCoords[camName] = val;
      customCameraCoords[toTagString31(camName)] = val;
    }
  }
  while ((cpMatch = camPosRegex.exec(activeDirectiveSource)) !== null) {
    autoCameraPoints.add(cpMatch[1]!.trim());
  }

  // Parse optional `; @trigger_pos <trig_name> x,y,z[,ex,ey,ez]` comments from the HSC source
  const customTriggerCoords: Record<string, { x: number; y: number; z: number; ex?: number; ey?: number; ez?: number }> = {};
  const trigPosRegex = /^\s*;\s*@trigger_pos\s+([A-Za-z0-9_.-]+)\s+([^\r\n]+)$/gm;
  let tpMatch: RegExpExecArray | null;
  while ((tpMatch = trigPosRegex.exec(hscSource)) !== null) {
    const trigName = tpMatch[1]!.trim();
    const coords = tpMatch[2]!.trim().split(',').map((s) => Number.parseFloat(s.trim()));
    if (coords.length >= 3 && Number.isFinite(coords[0]) && Number.isFinite(coords[1]) && Number.isFinite(coords[2])) {
      const val = {
        x: coords[0]!,
        y: coords[1]!,
        z: coords[2]!,
        ex: coords.length >= 4 && Number.isFinite(coords[3]) ? coords[3] : undefined,
        ey: coords.length >= 5 && Number.isFinite(coords[4]) ? coords[4] : undefined,
        ez: coords.length >= 6 && Number.isFinite(coords[5]) ? coords[5] : undefined,
      };
      customTriggerCoords[trigName] = val;
      customTriggerCoords[toTagString31(trigName)] = val;
    }
  }
  while ((tpMatch = trigPosRegex.exec(activeDirectiveSource)) !== null) {
    autoTriggerVolumes.add(tpMatch[1]!.trim());
  }

  // Parse optional `; @command_list_path <cmd_list_name> x0,y0,z0;x1,y1,z1;...` comments from the HSC source
  const customCommandListPaths: Record<string, Array<{ x: number; y: number; z: number }>> = {};
  const cmdListPathRegex = /^\s*;\s*@command_list_path\s+([A-Za-z0-9_.-]+)\s+(.+)$/gm;
  let clMatch: RegExpExecArray | null;
  while ((clMatch = cmdListPathRegex.exec(hscSource)) !== null) {
    const clName = clMatch[1]!.trim();
    const ptsRaw = clMatch[2]!.trim().split(';');
    const pts: Array<{ x: number; y: number; z: number }> = [];
    for (const ptStr of ptsRaw) {
      const coords = ptStr.split(',').map((s) => Number.parseFloat(s.trim()));
      if (coords.length >= 3 && coords.every((n) => Number.isFinite(n))) {
        pts.push({ x: coords[0]!, y: coords[1]!, z: coords[2]! });
      }
    }
    if (pts.length >= 1) {
      customCommandListPaths[clName] = pts;
      customCommandListPaths[toTagString31(clName)] = pts;
    }
  }
  while ((clMatch = cmdListPathRegex.exec(activeDirectiveSource)) !== null) {
    autoCommandLists.add(clMatch[1]!.trim());
  }

  // If a vehicle plays a custom approach flight path, ensure its spawn (@object_pos) and any start waypoint (@waypoint) point along waypoints[0] -> waypoints[1]
  const vehTeleportFlagMap = new Map<string, string>();
  const scriptCreatedObjectsLower = new Set<string>();
  const scanVehicleTeleports = (expr: SExpr): void => {
    if (expr.kind !== 'list' || expr.items.length === 0) return;
    const head = expr.items[0]!;
    const fnName = head.kind === 'atom' ? head.text : '';
    if (
      (fnName === 'object_create' || fnName === 'object_create_anew') &&
      expr.items[1]?.kind === 'atom'
    ) {
      const createdNm = expr.items[1].text.toLowerCase();
      scriptCreatedObjectsLower.add(createdNm);
      scriptCreatedObjectsLower.add(createdNm.slice(0, 31));
    }
    if (
      fnName === 'object_teleport' &&
      expr.items[1]?.kind === 'atom' &&
      expr.items[2]?.kind === 'atom'
    ) {
      const vehName = expr.items[1].text;
      const flagName = expr.items[2].text;
      if (!vehTeleportFlagMap.has(vehName)) {
        vehTeleportFlagMap.set(vehName, flagName);
      }
    }
    for (let i = 1; i < expr.items.length; i++) {
      if (expr.items[i]!.kind === 'list') scanVehicleTeleports(expr.items[i]!);
    }
  };
  for (const expr of expressions) {
    scanVehicleTeleports(expr);
  }

  const bindFlightStartToVehicles = (expr: SExpr): void => {
    if (expr.kind !== 'list' || expr.items.length === 0) return;
    const head = expr.items[0]!;
    const fnName = head.kind === 'atom' ? head.text : '';
    if (
      (fnName === 'recording_play' || fnName === 'recording_play_and_hover') &&
      expr.items[1]?.kind === 'atom' &&
      expr.items[2]?.kind === 'atom'
    ) {
      const vehName = expr.items[1].text;
      const animName = expr.items[2].text;
      const lowerAnim = animName.toLowerCase();
      const isExit =
        lowerAnim.includes('out') ||
        lowerAnim.includes('exit') ||
        lowerAnim.includes('depart') ||
        lowerAnim.includes('leave');
      const wps = customFlightWaypoints[animName] ?? customFlightWaypoints[lowerAnim] ?? customFlightWaypoints[toTagString31(animName)];
      if (!isExit && wps && wps.length >= 2) {
        const wp0 = wps[0]!;
        const wp1 = wps[1]!;
        const initYaw = Math.atan2(wp1.y - wp0.y, wp1.x - wp0.x);
        customObjectCoords[vehName] = {
          x: wp0.x,
          y: wp0.y,
          z: wp0.z,
          yaw: initYaw,
        };
        const teleFlag = vehTeleportFlagMap.get(vehName);
        if (teleFlag) {
          customWaypointCoords[teleFlag] = {
            x: wp0.x,
            y: wp0.y,
            z: wp0.z,
            yaw: initYaw,
          };
          autoCutsceneFlags.add(teleFlag);
        }
      }
    } else if (
      fnName === 'ai_command_list' &&
      expr.items[1]?.kind === 'atom' &&
      expr.items[2]?.kind === 'atom'
    ) {
      const encName = expr.items[1].text.split('/')[0]!.trim();
      const clName = expr.items[2].text;
      const pts = customCommandListPaths[clName] ?? customCommandListPaths[clName.toLowerCase()];
      if (encName && pts && pts.length >= 1 && !customEncounterCoords[encName]) {
        const p0 = pts[0]!;
        const p1 = pts[1] ?? pts[0]!;
        customEncounterCoords[encName] = {
          x: p0.x,
          y: p0.y,
          z: p0.z,
          yaw: pts.length >= 2 ? Math.atan2(p1.y - p0.y, p1.x - p0.x) : undefined,
        };
      }
    }
    for (let i = 1; i < expr.items.length; i++) {
      if (expr.items[i]!.kind === 'list') bindFlightStartToVehicles(expr.items[i]!);
    }
  };
  for (const expr of expressions) {
    bindFlightStartToVehicles(expr);
  }

  // Parse optional `; @cutscene_title <title_name> <fadeIn>,<upTime>,<fadeOut>` comments from the HSC source
  const customCutsceneTitleTimings: Record<string, { fadeIn: number; upTime: number; fadeOut: number }> = {};
  const ctTitleRegex = /^\s*;\s*@cutscene_title\s+([A-Za-z0-9_.-]+)\s+([^\r\n]+)$/gm;
  let ctMatch: RegExpExecArray | null;
  while ((ctMatch = ctTitleRegex.exec(hscSource)) !== null) {
    const tName = ctMatch[1]!.trim();
    const nums = ctMatch[2]!.trim().split(',').map((s) => Number.parseFloat(s.trim()));
    if (nums.length >= 3 && nums.every((n) => Number.isFinite(n))) {
      const val = { fadeIn: nums[0]!, upTime: nums[1]!, fadeOut: nums[2]! };
      customCutsceneTitleTimings[tName] = val;
      customCutsceneTitleTimings[toTagString31(tName)] = val;
    }
  }
  while ((ctMatch = ctTitleRegex.exec(activeDirectiveSource)) !== null) {
    autoCutsceneTitles.add(ctMatch[1]!.trim());
  }

  let workingView = ensureScenarioScriptEntities(view, {
    objectNames: Array.from(autoObjectNames),
    triggerVolumes: Array.from(autoTriggerVolumes),
    cameraPoints: Array.from(autoCameraPoints),
    cutsceneFlags: Array.from(autoCutsceneFlags),
    recordedAnimations: Array.from(autoRecordedAnimations),
    encounters: Array.from(autoEncounters),
    deviceGroups: Array.from(autoDeviceGroups),
    commandLists: Array.from(autoCommandLists),
    cutsceneTitles: Array.from(autoCutsceneTitles),
    tagReferences: autoTagReferences,
    customCutsceneTitleTimings,
    customFlightWaypoints,
    customWaypointCoords,
    customObjectCoords,
    customEncounterCoords,
    customCameraCoords,
    customTriggerCoords,
    customCommandListPaths,
    pruneUnreferenced: true,
  }).buffer;

  const currentDecompiled = decompileScenarioScripts(workingView);
  const entities = currentDecompiled.scenarioEntities;
  const inferredObjectTypesByNameIdx = new Map<number, number>();

  // Build per-encounter squad name lookup so `encounter/squad` encodes `0x80000000 | (squadIdx << 16) | encIdx`
  const squadNamesByEncIdx = new Map<number, string[]>();
  const hdrTmp = parseCacheFileHeader(workingView);
  const tiTmp = parseTagIndex(workingView, hdrTmp);
  {
    const scnrTmp = scenarioEntryOf(tiTmp);
    if (scnrTmp) {
      const scnrAtTmp = resolveTagDataPointer(scnrTmp.tagDataPointerOrResourceIndex, hdrTmp, tiTmp.baseMemoryAddress);
      const decTmp = decodeStruct(workingView, scnrAtTmp, getGroupStructName('scenario')!);
      const encRefTmp = decTmp.get('encounters');
      if (encRefTmp?.kind === 'reflexive' && encRefTmp.value.count > 0) {
        const encBaseTmp = resolvePointer(encRefTmp.value.pointerLow, hdrTmp.tagDataOffset, tiTmp.baseMemoryAddress);
        for (let e = 0; e < encRefTmp.value.count; e++) {
          const eOff = encBaseTmp + e * 176;
          if (eOff + 176 > workingView.length) break;
          const sqCount = workingView.readUInt32LE(eOff + 128);
          const sqPtr = workingView.readUInt32LE(eOff + 132);
          const sqNames: string[] = [];
          if (sqCount > 0 && sqPtr > 0) {
            const sqBase = resolvePointer(sqPtr, hdrTmp.tagDataOffset, tiTmp.baseMemoryAddress);
            for (let q = 0; q < sqCount; q++) {
              const sOff = sqBase + q * 232;
              if (sOff + 232 > workingView.length) break;
              const z = workingView.indexOf(0, sOff);
              sqNames.push(workingView.toString('latin1', sOff, z >= sOff && z < sOff + 32 ? z : sOff + 32).trim());
            }
          }
          squadNamesByEncIdx.set(e, sqNames);
        }
      }
    }
  }

  // String table builder
  const stringOffsets = new Map<string, number>();
  const stringChunks: Buffer[] = [];
  let stringTotalBytes = 0;

  const internString = (str: string): number => {
    const existing = stringOffsets.get(str);
    if (existing !== undefined) return existing;
    const off = stringTotalBytes;
    const buf = Buffer.from(`${str}\0`, 'latin1');
    stringOffsets.set(str, off);
    stringChunks.push(buf);
    stringTotalBytes += buf.length;
    return off;
  };
  internString('');

  // Syntax node table builder
  interface SyntaxNodeRecord {
    salt: number;
    indexUnion: number;
    type: number;
    flags: number;
    nextNode: number;
    stringOffset: number;
    dataUInt32: number;
  }

  const nodes: SyntaxNodeRecord[] = [];
  const makeHandle = (idx: number) => (((0xe374 + idx) & 0xffff) << 16) | (idx & 0xffff);

  const allocNode = (rec: Omit<SyntaxNodeRecord, 'salt'>): number => {
    const idx = nodes.length;
    const salt = (0xe374 + idx) & 0xffff;
    nodes.push({ salt, ...rec });
    return makeHandle(idx);
  };

  interface GlobalDecl {
    name: string;
    type: number;
    initExpr: SExpr;
    initNodeHandle: number;
  }

  interface ScriptDecl {
    name: string;
    scriptType: number;
    returnType: number;
    bodyExprs: SExpr[];
    rootNodeHandle: number;
  }

  const globals: GlobalDecl[] = [];
  const scripts: ScriptDecl[] = [];

  for (const expr of expressions) {
    if (expr.kind !== 'list') continue;
    const head = expr.items[0]!;
    if (head.kind === 'atom' && head.text === 'global' && expr.items.length === 4) {
      const typeName = (expr.items[1] as SExprAtom).text;
      const name = (expr.items[2] as SExprAtom).text;
      globals.push({
        name,
        type: VALUE_TYPE_BY_NAME[typeName] ?? 7,
        initExpr: expr.items[3]!,
        initNodeHandle: NONE,
      });
    } else if (head.kind === 'atom' && head.text === 'script' && expr.items.length >= 4) {
      const sTypeName = (expr.items[1] as SExprAtom).text;
      const secondAtom = expr.items[2] as SExprAtom;
      const hasExplicitReturn = VALUE_TYPE_BY_NAME[secondAtom.text] !== undefined && expr.items.length >= 5;
      const rTypeName = hasExplicitReturn ? secondAtom.text : 'void';
      const name = hasExplicitReturn ? (expr.items[3] as SExprAtom).text : secondAtom.text;
      const bodyStartIdx = hasExplicitReturn ? 4 : 3;
      scripts.push({
        name,
        scriptType: SCRIPT_TYPE_BY_NAME[sTypeName] ?? 0,
        returnType: VALUE_TYPE_BY_NAME[rTypeName] ?? 4,
        bodyExprs: expr.items.slice(bodyStartIdx),
        rootNodeHandle: NONE,
      });
    }
  }

  const inferNaturalType = (expr: SExpr): number => {
    if (expr.kind === 'atom') {
      if (expr.quoted) return 9;
      const g = globals.find((gl) => gl.name === expr.text);
      if (g) return g.type;
      if (expr.text === 'true' || expr.text === 'false') return 5;
      if (/^-?\d+\.\d+$/.test(expr.text)) return 6;
      if (/^-?\d+$/.test(expr.text)) return 7;
      if (entities.objectNames.includes(expr.text)) return 43;
      if (entities.triggerVolumes.includes(expr.text)) return 11;
      if (entities.cutsceneCameraPoints.includes(expr.text)) return 13;
      return 7;
    }
    if (expr.items.length === 0) return 4;
    const head = expr.items[0]!;
    if (head.kind === 'atom') {
      const s = scripts.find((sc) => sc.name === head.text);
      if (s) return s.returnType;
      const fn = BUILTIN_FUNCTIONS[head.text];
      if (fn && fn.ret !== 3) return fn.ret;
    }
    return 6;
  };

  const compileExpr = (expr: SExpr, expectedType = 4): number => {
    if (expr.kind === 'atom') {
      const text = expr.text;
      const strOffset = internString(text);

      // Check if global reference
      if (!expr.quoted) {
        const globalIdx = globals.findIndex((g) => g.name === text);
        if (globalIdx >= 0) {
          const g = globals[globalIdx]!;
          const nodeType = expectedType && expectedType !== 4 ? expectedType : g.type;
          return allocNode({
            indexUnion: g.type,
            type: nodeType,
            flags: FLAG_PERMANENT | FLAG_PRIMITIVE | FLAG_GLOBAL_INDEX,
            nextNode: NONE,
            stringOffset: strOffset,
            dataUInt32: globalIdx >>> 0,
          });
        }
      }

      // Check if tag reference type (24..31: sound, effect, damage, looping_sound, animation_graph, actor_variant, damage_effect, object_definition)
      if (expectedType >= 24 && expectedType <= 31) {
        if (text.toLowerCase() === 'none') {
          return allocNode({
            indexUnion: expectedType,
            type: expectedType,
            flags: FLAG_PERMANENT | FLAG_PRIMITIVE,
            nextNode: NONE,
            stringOffset: strOffset,
            dataUInt32: NONE,
          });
        }
        const allowedGroupsByHsType: Record<number, string[]> = {
          24: ['snd!'],
          25: ['effe'],
          26: ['jpt!'],
          27: ['lsnd'],
          28: ['antr'],
          29: ['actv'],
          30: ['jpt!'],
          31: ['obje', 'bipd', 'vehi', 'weap', 'eqip', 'garb', 'proj', 'scen', 'mach', 'ctrl', 'lifi', 'plac', 'ssce'],
        };
        const allowedGroups = allowedGroupsByHsType[expectedType] ?? [];
        const normQuery = text.replace(/\//g, '\\').toLowerCase().trim();
        let matchedEntry = tiTmp.entries.find(
          (e) =>
            !e.isExternal &&
            allowedGroups.includes(fourCCToString(e.primaryClassFourCC)) &&
            e.path.toLowerCase() === normQuery,
        );
        if (!matchedEntry) {
          matchedEntry = tiTmp.entries.find(
            (e) =>
              !e.isExternal &&
              allowedGroups.includes(fourCCToString(e.primaryClassFourCC)) &&
              (e.path.toLowerCase().endsWith(`\\${normQuery}`) || e.path.toLowerCase().includes(normQuery)),
          );
        }
        const resolvedStrOffset = matchedEntry ? internString(matchedEntry.path) : strOffset;
        const resolvedTagId = matchedEntry ? (matchedEntry.tagId >>> 0) : NONE;
        return allocNode({
          indexUnion: expectedType,
          type: expectedType,
          flags: FLAG_PERMANENT | FLAG_PRIMITIVE,
          nextNode: NONE,
          stringOffset: resolvedStrOffset,
          dataUInt32: resolvedTagId,
        });
      }

      if (expr.quoted) {
        const strType = expectedType >= 9 ? expectedType : 9;
        return allocNode({
          indexUnion: strType,
          type: strType,
          flags: FLAG_PERMANENT | FLAG_PRIMITIVE,
          nextNode: NONE,
          stringOffset: strOffset,
          dataUInt32: strOffset,
        });
      }

      const findEntityIdx = (arr: string[] | undefined, query: string): number => {
        if (!arr || arr.length === 0) return -1;
        const exact = arr.indexOf(query);
        if (exact >= 0) return exact;
        const t31 = toTagString31(query);
        const idx31 = arr.indexOf(t31);
        if (idx31 >= 0) return idx31;
        const low31 = t31.toLowerCase();
        return arr.findIndex((item) => item.toLowerCase() === low31);
      };

      // Check if script reference (for `wake` or `sleep`)
      if (expectedType === 10) {
        const t31Low = toTagString31(text).toLowerCase();
        const scriptIdx = scripts.findIndex(
          (s) => s.name === text || toTagString31(s.name).toLowerCase() === t31Low,
        );
        return allocNode({
          indexUnion: 10,
          type: 10,
          flags: FLAG_PERMANENT | FLAG_PRIMITIVE,
          nextNode: NONE,
          stringOffset: strOffset,
          dataUInt32: (scriptIdx >= 0 ? scriptIdx : 0) >>> 0,
        });
      }

      if (text === 'true' || text === 'false' || (expectedType === 5 && (text === '0' || text === '1'))) {
        const boolVal = text === 'true' || text === '1' ? 1 : 0;
        return allocNode({
          indexUnion: 5,
          type: 5,
          flags: FLAG_PERMANENT | FLAG_PRIMITIVE,
          nextNode: NONE,
          stringOffset: strOffset,
          dataUInt32: boolVal,
        });
      }

      // Check scenario entity tables (object names, trigger volumes, camera points) with 31-char tag_string matching
      const objIdx = findEntityIdx(entities.objectNames, text);
      if (objIdx >= 0) {
        if (expectedType === 39 || expectedType === 45 || expectedType === 38 || expectedType === 44) {
          inferredObjectTypesByNameIdx.set(objIdx, 1); // vehicle
        } else if (expectedType === 41 || expectedType === 47) {
          inferredObjectTypesByNameIdx.set(objIdx, 7); // machine
        } else if (expectedType === 40 || expectedType === 46) {
          inferredObjectTypesByNameIdx.set(objIdx, 2); // weapon
        } else if (expectedType === 42 || expectedType === 48) {
          inferredObjectTypesByNameIdx.set(objIdx, 6); // scenery
        } else if (!inferredObjectTypesByNameIdx.has(objIdx)) {
          inferredObjectTypesByNameIdx.set(objIdx, 1);
        }

        const nodeType =
          expectedType === 23 || (expectedType >= 37 && expectedType <= 48)
            ? expectedType
            : 43;
        const constType =
          nodeType === 23
            ? 43
            : nodeType >= 37 && nodeType <= 42
              ? nodeType + 6
              : nodeType;
        return allocNode({
          indexUnion: constType,
          type: nodeType,
          flags: FLAG_PERMANENT | FLAG_PRIMITIVE,
          nextNode: NONE,
          stringOffset: strOffset,
          dataUInt32: objIdx >>> 0,
        });
      }

      const trigIdx = findEntityIdx(entities.triggerVolumes, text);
      if (trigIdx >= 0) {
        return allocNode({
          indexUnion: 11,
          type: 11,
          flags: FLAG_PERMANENT | FLAG_PRIMITIVE,
          nextNode: NONE,
          stringOffset: strOffset,
          dataUInt32: trigIdx >>> 0,
        });
      }

      const camIdx = findEntityIdx(entities.cutsceneCameraPoints, text);
      if (camIdx >= 0) {
        return allocNode({
          indexUnion: 13,
          type: 13,
          flags: FLAG_PERMANENT | FLAG_PRIMITIVE,
          nextNode: NONE,
          stringOffset: strOffset,
          dataUInt32: camIdx >>> 0,
        });
      }

      const flagIdx = findEntityIdx(entities.cutsceneFlags, text);
      if (flagIdx >= 0) {
        return allocNode({
          indexUnion: 12,
          type: 12,
          flags: FLAG_PERMANENT | FLAG_PRIMITIVE,
          nextNode: NONE,
          stringOffset: strOffset,
          dataUInt32: flagIdx >>> 0,
        });
      }

      const animIdx = findEntityIdx(entities.recordedAnimations, text);
      if (animIdx >= 0) {
        return allocNode({
          indexUnion: 15,
          type: 15,
          flags: FLAG_PERMANENT | FLAG_PRIMITIVE,
          nextNode: NONE,
          stringOffset: strOffset,
          dataUInt32: animIdx >>> 0,
        });
      }

      const devGrpIdx = findEntityIdx(entities.deviceGroups, text);
      if (devGrpIdx >= 0) {
        return allocNode({
          indexUnion: 16,
          type: 16,
          flags: FLAG_PERMANENT | FLAG_PRIMITIVE,
          nextNode: NONE,
          stringOffset: strOffset,
          dataUInt32: devGrpIdx >>> 0,
        });
      }

      const cmdListIdx = findEntityIdx(entities.commandLists, text);
      if (cmdListIdx >= 0) {
        return allocNode({
          indexUnion: 18,
          type: 18,
          flags: FLAG_PERMANENT | FLAG_PRIMITIVE,
          nextNode: NONE,
          stringOffset: strOffset,
          dataUInt32: cmdListIdx >>> 0,
        });
      }

      const titleIdx = findEntityIdx(entities.cutsceneTitles, text);
      if (titleIdx >= 0) {
        return allocNode({
          indexUnion: 14,
          type: 14,
          flags: FLAG_PERMANENT | FLAG_PRIMITIVE,
          nextNode: NONE,
          stringOffset: strOffset,
          dataUInt32: titleIdx >>> 0,
        });
      }

      const encBaseName = text.includes('/') ? text.split('/')[0]! : text;
      const encSubName = text.includes('/') ? text.split('/')[1] : undefined;
      const encIdx = findEntityIdx(entities.encounters, encBaseName);
      if (encIdx >= 0) {
        let aiIndexVal = encIdx >>> 0;
        if (encSubName) {
          const sqNames = squadNamesByEncIdx.get(encIdx) ?? [];
          const sqIdx = findEntityIdx(sqNames, encSubName);
          const resolvedSqIdx = sqIdx >= 0 ? sqIdx : 0;
          aiIndexVal = (0x80000000 | ((resolvedSqIdx & 0x3fff) << 16) | (encIdx & 0xffff)) >>> 0;
        }
        return allocNode({
          indexUnion: 17,
          type: 17,
          flags: FLAG_PERMANENT | FLAG_PRIMITIVE,
          nextNode: NONE,
          stringOffset: strOffset,
          dataUInt32: aiIndexVal,
        });
      }

       const enumTables: Record<number, Record<string, number>> = {
        21: {
          default: 0,
          default_red: 1,
          player: 1,
          flag_blue: 2,
          flag_red: 3,
          target_blue: 4,
          target_red: 5,
          ball_blue: 6,
          ball_red: 7,
          crown_blue: 8,
          crown_red: 9,
          arrow: 0,
        },
        32: { easy: 0, normal: 1, hard: 2, impossible: 3 },
        33: { default: 0, player: 1, human: 2, covenant: 3, flood: 4, sentinel: 5, unused6: 6, unused7: 7, unused8: 8, unused9: 9 },
        34: {
          none: 0,
          sleeping: 1,
          alert: 2,
          moving_repeat_same_position: 3,
          moving_loop: 4,
          moving_loop_back_and_forth: 5,
          moving_loop_randomly: 6,
          moving_randomly: 7,
          guarding: 8,
          guarding_at_guard_position: 9,
          searching: 10,
          fleeing: 11,
        },
        35: {
          elite: 0,
          jackal: 1,
          grunt: 2,
          hunter: 3,
          engineer: 4,
          assassin: 5,
          player: 6,
          marine: 7,
          crew: 8,
          combat_form: 9,
          infection_form: 10,
          carrier_form: 11,
          monitor: 12,
          sentinel: 13,
          none: 14,
          mounted_weapon: 15,
        },
        36: { top_left: 0, top_right: 1, bottom_left: 2, bottom_right: 3, center: 4 },
      };
      if (enumTables[expectedType]) {
        const enumVal = enumTables[expectedType]![text] ?? 0;
        return allocNode({
          indexUnion: expectedType,
          type: expectedType,
          flags: FLAG_PERMANENT | FLAG_PRIMITIVE,
          nextNode: NONE,
          stringOffset: strOffset,
          dataUInt32: expectedType >= 32 ? ((0xffff0000 | enumVal) >>> 0) : (enumVal >>> 0),
        });
      }

      // Numeric literals (real vs integer)
      if (/^-?\d+\.\d+$/.test(text) || (expectedType === 6 && /^-?\d+$/.test(text))) {
        const floatBuf = Buffer.alloc(4);
        floatBuf.writeFloatLE(Number.parseFloat(text), 0);
        return allocNode({
          indexUnion: 6,
          type: 6, // real
          flags: FLAG_PERMANENT | FLAG_PRIMITIVE,
          nextNode: NONE,
          stringOffset: strOffset,
          dataUInt32: floatBuf.readUInt32LE(0),
        });
      }

      if (/^-?\d+$/.test(text)) {
        const intVal = Number.parseInt(text, 10);
        const typeCode = expectedType === 8 ? 8 : 7; // long or short
        const dataVal = typeCode === 8 ? intVal >>> 0 : intVal & 0xffff;
        return allocNode({
          indexUnion: typeCode,
          type: typeCode,
          flags: FLAG_PERMANENT | FLAG_PRIMITIVE,
          nextNode: NONE,
          stringOffset: strOffset,
          dataUInt32: dataVal,
        });
      }

      // Symbolic constant / team / AI / identifier atom (never emit raw stringOffset as a scenario reflexive index!)
      const symType = expectedType && expectedType !== 4 ? expectedType : 9;
      const isScenarioIndexType = (symType >= 11 && symType <= 20) || symType === 23 || (symType >= 37 && symType <= 48);
      return allocNode({
        indexUnion: symType,
        type: symType,
        flags: FLAG_PERMANENT | FLAG_PRIMITIVE,
        nextNode: NONE,
        stringOffset: strOffset,
        dataUInt32: text === 'none' ? NONE : isScenarioIndexType ? 0 : strOffset,
      });
    }

    // List expression: `(fnName arg1 arg2 ...)`
    if (expr.items.length === 0) {
      return allocNode({
        indexUnion: 4,
        type: 4,
        flags: FLAG_PERMANENT | FLAG_PRIMITIVE,
        nextNode: NONE,
        stringOffset: 0,
        dataUInt32: 0,
      });
    }

    const headAtom = expr.items[0]!;
    const fnName = headAtom.kind === 'atom' ? headAtom.text : 'begin';
    const fnStrOff = internString(fnName);
    const fn31Low = toTagString31(fnName).toLowerCase();
    const staticScriptIdx = scripts.findIndex(
      (s) => s.name === fnName || toTagString31(s.name).toLowerCase() === fn31Low,
    );
    const isScriptCall = staticScriptIdx >= 0;
    const builtin = BUILTIN_FUNCTIONS[fnName];
    const fnIndex = isScriptCall ? staticScriptIdx : (builtin?.index ?? 0);

    let callReturnType = expectedType;
    if (isScriptCall) {
      callReturnType = expectedType === 4 ? 4 : scripts[staticScriptIdx]!.returnType;
    } else if (builtin) {
      if (builtin.ret === 3) {
        // passthrough (`begin`, `begin_random`, `if`, `set`)
        if (fnName === 'set' && expr.items[1]?.kind === 'atom') {
          const g = globals.find((gl) => gl.name === (expr.items[1] as SExprAtom).text);
          callReturnType = expectedType === 4 ? 4 : (g?.type ?? expectedType);
        } else {
          callReturnType = expectedType || 4;
        }
      } else {
        callReturnType = expectedType === 4 ? 4 : (expectedType || builtin.ret);
      }
    }

    // Reserve parent call node first
    const callHandle = allocNode({
      indexUnion: fnIndex,
      type: callReturnType,
      flags: FLAG_PERMANENT | (isScriptCall ? FLAG_SCRIPT_CALL : 0),
      nextNode: NONE,
      stringOffset: fnStrOff,
      dataUInt32: NONE,
    });
    const callIdx = callHandle & 0xffff;

    // Allocate function name child node
    const fnNameHandle = allocNode({
      indexUnion: fnIndex,
      type: 2, // function_name
      flags: FLAG_PERMANENT | FLAG_PRIMITIVE,
      nextNode: NONE,
      stringOffset: fnStrOff,
      dataUInt32: fnIndex >>> 0,
    });
    nodes[callIdx]!.dataUInt32 = fnNameHandle >>> 0;

    let prevChildIdx = fnNameHandle & 0xffff;
    const argCount = expr.items.length - 1;

    // Determine shared comparison type for `=`, `!=`, `>`, `<`, `>=`, `<=`
    let sharedCompareType = 6;
    if (fnName === '=' || fnName === '!=' || fnName === '>' || fnName === '<' || fnName === '>=' || fnName === '<=') {
      const t1 = expr.items[1] ? inferNaturalType(expr.items[1]) : 6;
      const t2 = expr.items[2] ? inferNaturalType(expr.items[2]) : 6;
      sharedCompareType = t1 === 6 || t2 === 6 ? 6 : t1;
    }

    for (let a = 1; a < expr.items.length; a++) {
      const argIdx = a - 1;
      let argExpectedType = 4;

      if (fnName === 'begin') {
        argExpectedType = a === argCount ? callReturnType : 4;
      } else if (fnName === 'begin_random') {
        argExpectedType = callReturnType;
      } else if (fnName === 'if') {
        argExpectedType = argIdx === 0 ? 5 : callReturnType;
      } else if (fnName === 'set') {
        const varName = expr.items[1]?.kind === 'atom' ? (expr.items[1] as SExprAtom).text : '';
        const g = globals.find((gl) => gl.name === varName);
        argExpectedType = g?.type ?? 7;
      } else if (fnName === 'and' || fnName === 'or') {
        argExpectedType = 5;
      } else if (fnName === '+' || fnName === '-' || fnName === '*' || fnName === '/' || fnName === 'min' || fnName === 'max') {
        argExpectedType = 6;
      } else if (fnName === '=' || fnName === '!=' || fnName === '>' || fnName === '<' || fnName === '>=' || fnName === '<=') {
        argExpectedType = sharedCompareType;
      } else if (fnName === 'sleep') {
        argExpectedType = argIdx === 0 ? 7 : 10;
      } else if (fnName === 'sleep_until') {
        argExpectedType = argIdx === 0 ? 5 : 7;
      } else if (fnName === 'wake') {
        argExpectedType = 10;
      } else if (fnName === 'inspect') {
        argExpectedType = inferNaturalType(expr.items[a]!);
      } else if (fnName === 'unit') {
        argExpectedType = 37;
      } else if (builtin && argIdx < builtin.params.length) {
        argExpectedType = builtin.params[argIdx]!;
      }

      const argHandle = compileExpr(expr.items[a]!, argExpectedType);
      nodes[prevChildIdx]!.nextNode = argHandle >>> 0;
      prevChildIdx = argHandle & 0xffff;
    }

    return callHandle;
  };

  for (const g of globals) {
    g.initNodeHandle = compileExpr(g.initExpr, g.type);
  }

  for (const s of scripts) {
    const wrappedBody: SExprList =
      s.bodyExprs.length === 1 &&
      s.bodyExprs[0]!.kind === 'list' &&
      s.bodyExprs[0]!.items[0]?.kind === 'atom' &&
      s.bodyExprs[0]!.items[0]!.text === 'begin'
        ? (s.bodyExprs[0] as SExprList)
        : {
            kind: 'list',
            line: s.bodyExprs[0]?.line ?? 1,
            items: [{ kind: 'atom', text: 'begin', quoted: false, line: 1 }, ...s.bodyExprs],
          };
    s.rootNodeHandle = compileExpr(wrappedBody, s.returnType);
  }

  // Synchronize ScenarioObjectName runtime types and placement indices before appending compiled script tables
  workingView = syncScenarioObjectNamesForScripts(
    workingView,
    inferredObjectTypesByNameIdx,
    new Set(Array.from(autoObjectNames).map((s) => s.toLowerCase())),
    customObjectCoords,
    customObjectTypes,
    scriptCreatedObjectsLower,
  );

  // Serialize compiled tables into the scenario tag at the end of the map buffer
  const header = parseCacheFileHeader(workingView);
  const tagIndex = parseTagIndex(workingView, header);
  const scenario = scenarioEntryOf(tagIndex);
  const scenarioStruct = getGroupStructName('scenario')!;
  if (!scenario) {
    return { buffer: workingView, compiledScripts: 0, compiledGlobals: 0, syntaxNodesUsed: 0, diagnostics };
  }

  const scnrAt = resolveTagDataPointer(scenario.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  if (!isRangeInBuffer(scnrAt, resolveStruct(scenarioStruct).totalSize, workingView.length)) {
    return { buffer: workingView, compiledScripts: 0, compiledGlobals: 0, syntaxNodesUsed: 0, diagnostics };
  }

  // Build globals block (92 bytes * globals.length)
  const globalsBlock = Buffer.alloc(globals.length * 92, 0);
  for (let i = 0; i < globals.length; i++) {
    const g = globals[i]!;
    const base = i * 92;
    globalsBlock.write(g.name.slice(0, 31), base, 'latin1');
    globalsBlock.writeInt16LE(g.type, base + 32);
    globalsBlock.writeUInt32LE(g.initNodeHandle >>> 0, base + 40);
  }

  // Build scripts block (92 bytes * scripts.length)
  const scriptsBlock = Buffer.alloc(scripts.length * 92, 0);
  for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i]!;
    const base = i * 92;
    scriptsBlock.write(s.name.slice(0, 31), base, 'latin1');
    scriptsBlock.writeInt16LE(s.scriptType, base + 32);
    scriptsBlock.writeInt16LE(s.returnType, base + 34);
    scriptsBlock.writeUInt32LE(s.rootNodeHandle >>> 0, base + 36);
  }

  // Build script string data block (padded to 4-byte alignment + 1024 dynamic source bytes required by OpenCE)
  const rawStrings = Buffer.concat(stringChunks);
  const paddedStringLen = ((rawStrings.length + 3) & ~3) + HS_MAXIMUM_DYNAMIC_SOURCE_DATA_BYTES;
  const stringDataBlock = Buffer.alloc(paddedStringLen, 0);
  rawStrings.copy(stringDataBlock, 0);

  // Build script syntax data block (exact 56 + 19001 * 20 = 380076 bytes required by OpenCE hs_scenario_syntax_data_valid)
  const maxNodes = MAXIMUM_HS_SYNTAX_NODES_PER_SCENARIO;
  const syntaxBlock = Buffer.alloc(DATA_ARRAY_HEADER_SIZE + maxNodes * SCRIPT_NODE_SIZE, 0);
  syntaxBlock.write('script node', 0, 'latin1');
  syntaxBlock.writeInt16LE(maxNodes, 0x20);
  syntaxBlock.writeInt16LE(SCRIPT_NODE_SIZE, 0x22);
  syntaxBlock.writeUInt8(1, 0x24); // is_valid
  syntaxBlock.writeUInt8(0, 0x25); // identifier_zero_invalid (must be FALSE)
  syntaxBlock.write('@t@d', 0x28, 'latin1'); // DATA_ARRAY_SIGNATURE = 'd@t@' (0x64407440 LE)
  syntaxBlock.writeInt16LE(nodes.length, 0x2c); // first_free_absolute_index
  syntaxBlock.writeInt16LE(nodes.length, 0x2e); // count
  syntaxBlock.writeInt16LE(nodes.length, 0x30); // actual_count
  syntaxBlock.writeUInt16LE((0xe374 + nodes.length) & 0xffff, 0x32); // next_identifier

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    const off = DATA_ARRAY_HEADER_SIZE + i * SCRIPT_NODE_SIZE;
    syntaxBlock.writeUInt16LE(n.salt & 0xffff, off + 0x0);
    syntaxBlock.writeUInt16LE(n.indexUnion & 0xffff, off + 0x2);
    syntaxBlock.writeInt16LE(n.type, off + 0x4);
    syntaxBlock.writeUInt16LE(n.flags & 0xffff, off + 0x6);
    syntaxBlock.writeUInt32LE(n.nextNode >>> 0, off + 0x8);
    syntaxBlock.writeInt32LE(n.stringOffset, off + 0xc);
    syntaxBlock.writeUInt32LE(n.dataUInt32 >>> 0, off + 0x10);
  }

  const toMemoryPtr = (fileOffset: number) =>
    (tagIndex.baseMemoryAddress + (fileOffset - header.tagDataOffset)) >>> 0;

  // Check if the scenario already has allocated `globals`, `scripts`, `script string data`, or `script syntax data` blocks we can overwrite in-place
  const existingGlobalsCount = workingView.readInt32LE(scnrAt + 0x4a8);
  const existingGlobalsPtr = workingView.readUInt32LE(scnrAt + 0x4a8 + 4);
  const existingGlobalsFileOff =
    existingGlobalsPtr >= tagIndex.baseMemoryAddress
      ? header.tagDataOffset + (existingGlobalsPtr - tagIndex.baseMemoryAddress)
      : -1;
  const canReuseGlobalsInPlace =
    globals.length > 0 &&
    existingGlobalsCount >= globals.length &&
    existingGlobalsFileOff >= header.tagDataOffset &&
    (existingGlobalsFileOff - header.tagDataOffset) % 4 === 0 &&
    existingGlobalsFileOff + globalsBlock.length <= workingView.length;

  const existingScriptsCount = workingView.readInt32LE(scnrAt + 0x49c);
  const existingScriptsPtr = workingView.readUInt32LE(scnrAt + 0x49c + 4);
  const existingScriptsFileOff =
    existingScriptsPtr >= tagIndex.baseMemoryAddress
      ? header.tagDataOffset + (existingScriptsPtr - tagIndex.baseMemoryAddress)
      : -1;
  const canReuseScriptsInPlace =
    scripts.length > 0 &&
    existingScriptsCount >= scripts.length &&
    existingScriptsFileOff >= header.tagDataOffset &&
    (existingScriptsFileOff - header.tagDataOffset) % 4 === 0 &&
    existingScriptsFileOff + scriptsBlock.length <= workingView.length;

  const existingStringsSize = workingView.readInt32LE(scnrAt + 0x488);
  const existingStringsPtr = workingView.readUInt32LE(scnrAt + 0x488 + 12);
  const existingStringsFileOff =
    existingStringsPtr >= tagIndex.baseMemoryAddress
      ? header.tagDataOffset + (existingStringsPtr - tagIndex.baseMemoryAddress)
      : -1;
  const canReuseStringsInPlace =
    existingStringsSize >= stringDataBlock.length &&
    existingStringsFileOff >= header.tagDataOffset &&
    (existingStringsFileOff - header.tagDataOffset) % 4 === 0 &&
    existingStringsFileOff + stringDataBlock.length <= workingView.length;

  const existingSyntaxSize = workingView.readInt32LE(scnrAt + 0x474);
  const existingSyntaxPtr = workingView.readUInt32LE(scnrAt + 0x474 + 12);
  const existingSyntaxFileOff =
    existingSyntaxPtr >= tagIndex.baseMemoryAddress
      ? header.tagDataOffset + (existingSyntaxPtr - tagIndex.baseMemoryAddress)
      : -1;
  const canReuseSyntaxInPlace =
    existingSyntaxSize >= syntaxBlock.length &&
    existingSyntaxFileOff >= header.tagDataOffset &&
    (existingSyntaxFileOff - header.tagDataOffset) % 4 === 0 &&
    existingSyntaxFileOff + syntaxBlock.length <= workingView.length;

  // Align relative to header.tagDataOffset so memory pointers are 4-byte aligned
  const padBytes = (4 - ((workingView.length - header.tagDataOffset) % 4)) % 4;
  let runningAppendOff = workingView.length + padBytes;
  const chunksToAppend: Buffer[] = [];
  if (padBytes > 0) chunksToAppend.push(Buffer.alloc(padBytes, 0));

  let globalsFileOffset = existingGlobalsFileOff;
  if (!canReuseGlobalsInPlace && globalsBlock.length > 0) {
    globalsFileOffset = runningAppendOff;
    chunksToAppend.push(globalsBlock);
    runningAppendOff += globalsBlock.length;
  }

  let scriptsFileOffset = existingScriptsFileOff;
  if (!canReuseScriptsInPlace && scriptsBlock.length > 0) {
    scriptsFileOffset = runningAppendOff;
    chunksToAppend.push(scriptsBlock);
    runningAppendOff += scriptsBlock.length;
  }

  let stringsFileOffset = existingStringsFileOff;
  if (!canReuseStringsInPlace) {
    stringsFileOffset = runningAppendOff;
    chunksToAppend.push(stringDataBlock);
    runningAppendOff += stringDataBlock.length;
  }

  let syntaxFileOffset = existingSyntaxFileOff;
  if (!canReuseSyntaxInPlace) {
    syntaxFileOffset = runningAppendOff;
    chunksToAppend.push(syntaxBlock);
    runningAppendOff += syntaxBlock.length;
  }

  const outBuffer =
    chunksToAppend.length > 1 || (chunksToAppend.length === 1 && padBytes === 0)
      ? Buffer.concat([workingView, ...chunksToAppend])
      : Buffer.from(workingView);

  if (canReuseGlobalsInPlace) {
    globalsBlock.copy(outBuffer, existingGlobalsFileOff);
  }
  if (canReuseScriptsInPlace) {
    scriptsBlock.copy(outBuffer, existingScriptsFileOff);
  }
  if (canReuseStringsInPlace) {
    stringDataBlock.copy(outBuffer, existingStringsFileOff);
  }
  if (canReuseSyntaxInPlace) {
    syntaxBlock.copy(outBuffer, existingSyntaxFileOff);
  }

  // Update exact Scenario header offsets (verified in definitions/groups/scenario.json):
  // script syntax data @ 0x474 (1140), script string data @ 0x488 (1160), scripts @ 0x49c (1180), globals @ 0x4a8 (1192)
  outBuffer.writeInt32LE(syntaxBlock.length, scnrAt + 0x474);
  outBuffer.writeInt32LE(0, scnrAt + 0x474 + 4);
  outBuffer.writeInt32LE(0, scnrAt + 0x474 + 8);
  outBuffer.writeUInt32LE(toMemoryPtr(syntaxFileOffset), scnrAt + 0x474 + 12);
  outBuffer.writeInt32LE(0, scnrAt + 0x474 + 16);

  outBuffer.writeInt32LE(stringDataBlock.length, scnrAt + 0x488);
  outBuffer.writeInt32LE(0, scnrAt + 0x488 + 4);
  outBuffer.writeInt32LE(0, scnrAt + 0x488 + 8);
  outBuffer.writeUInt32LE(toMemoryPtr(stringsFileOffset), scnrAt + 0x488 + 12);
  outBuffer.writeInt32LE(0, scnrAt + 0x488 + 16);

  outBuffer.writeInt32LE(scripts.length, scnrAt + 0x49c);
  outBuffer.writeUInt32LE(scripts.length > 0 ? toMemoryPtr(scriptsFileOffset) : 0, scnrAt + 0x49c + 4);
  outBuffer.writeInt32LE(0, scnrAt + 0x49c + 8);

  outBuffer.writeInt32LE(globals.length, scnrAt + 0x4a8);
  outBuffer.writeUInt32LE(globals.length > 0 ? toMemoryPtr(globalsFileOffset) : 0, scnrAt + 0x4a8 + 4);
  outBuffer.writeInt32LE(0, scnrAt + 0x4a8 + 8);

  // Update cache header fileLength and tagDataSize
  outBuffer.writeUInt32LE(outBuffer.length >>> 0, 0x08);
  outBuffer.writeUInt32LE((outBuffer.length - header.tagDataOffset) >>> 0, 0x14);

  return {
    buffer: outBuffer,
    compiledScripts: scripts.length,
    compiledGlobals: globals.length,
    syntaxNodesUsed: nodes.length,
    diagnostics,
  };
}
