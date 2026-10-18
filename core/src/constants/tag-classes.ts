/**
 * Halo CE tag class (group) list with FourCC codes.
 *
 * SOURCE: Halo modding community wiki - https://c20.reclaimers.net/h1/tags
 * (per project brief reference #6). Transcribed by hand into TypeScript; not copied from
 * any GPL codebase.
 *
 * ASSUMPTION: three group IDs are rendered as 3 characters on the wiki page
 * (fog, sky, hmt) because the 4th character is a trailing ASCII space, which is the
 * well-established Halo convention for these classes (fog_, sky_, hmt_). Stated explicitly
 * here rather than silently guessed.
 */

export function fourCCFromString(code: string): number {
  if (code.length !== 4) {
    throw new Error(`FourCC must be exactly 4 characters, got "${code}" (${code.length})`);
  }
  return (
    ((code.charCodeAt(0) << 24) | (code.charCodeAt(1) << 16) | (code.charCodeAt(2) << 8) | code.charCodeAt(3)) >>> 0
  );
}

export function fourCCToString(value: number): string {
  return String.fromCharCode(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

export const NULL_TAG_ID = 0xffffffff;

export interface TagClassInfo {
  name: string;
  groupId: string;
  parent: string | null;
  purpose: string;
}

export const TAG_CLASSES: TagClassInfo[] = [
  { name: 'actor', groupId: 'actr', parent: null, purpose: 'Defines core AI behaviours shared by actor variants.' },
  { name: 'actor_variant', groupId: 'actv', parent: null, purpose: 'Specializes an actor: appearance, weapon use, grenades, health, dropped equipment.' },
  { name: 'antenna', groupId: 'ant!', parent: null, purpose: 'A springy antenna widget attached to model markers (Warthog, Scorpion).' },
  { name: 'biped', groupId: 'bipd', parent: 'unit', purpose: 'Physical characteristics and appearance of characters (Elites, Marines, Cortana, player).' },
  { name: 'bitmap', groupId: 'bitm', parent: null, purpose: 'Texture data: sprite sheets, environment maps, normal maps, etc.' },
  { name: 'camera_track', groupId: 'trak', parent: null, purpose: "Rotational constraints for the game's camera when controlling bipeds or vehicles." },
  { name: 'color_table', groupId: 'colo', parent: null, purpose: '' },
  { name: 'continuous_damage_effect', groupId: 'cdmg', parent: null, purpose: 'Continuous screen shake/controller vibration near a sound_looping source.' },
  { name: 'contrail', groupId: 'cont', parent: null, purpose: 'Trail-like repeating bitmap effects attached to objects.' },
  { name: 'damage_effect', groupId: 'jpt!', parent: null, purpose: 'Damage application properties: material modifiers, screen effects, acceleration, AoE.' },
  { name: 'decal', groupId: 'deca', parent: null, purpose: 'Bullet holes, blood, burns, signs, other 2D surface effects.' },
  { name: 'detail_object_collection', groupId: 'dobc', parent: null, purpose: 'Mix/appearance of small 2D detail objects like grass.' },
  { name: 'device', groupId: 'devi', parent: 'object', purpose: 'Parent tag for devices: controlled objects with powered on/off states.' },
  { name: 'device_control', groupId: 'ctrl', parent: 'device', purpose: 'Interactive switches/buttons operating device_machines like doors/elevators.' },
  { name: 'device_light_fixture', groupId: 'lifi', parent: 'device', purpose: 'Dynamically toggled light sources or decorative lighting objects.' },
  { name: 'device_machine', groupId: 'mach', parent: 'device', purpose: 'Objects animating between open/closed states (doors, elevators).' },
  { name: 'dialogue', groupId: 'udlg', parent: null, purpose: 'Situational unit sounds: taking damage, fleeing, etc.' },
  { name: 'effect', groupId: 'effe', parent: null, purpose: 'Responses to events: material impacts, sound effects, detonations.' },
  { name: 'equipment', groupId: 'eqip', parent: 'item', purpose: 'Powerups, health packs, non-live grenades, ammo pickups.' },
  { name: 'flag', groupId: 'flag', parent: null, purpose: 'Simulated cloth-like material attachable to objects.' },
  { name: 'fog', groupId: 'fog ', parent: null, purpose: 'Appearance of fog planes.' },
  { name: 'font', groupId: 'font', parent: null, purpose: '' },
  { name: 'garbage', groupId: 'garb', parent: 'item', purpose: '' },
  { name: 'gbxmodel', groupId: 'mod2', parent: null, purpose: 'Render model of objects (Gearbox/PC port).' },
  { name: 'globals', groupId: 'matg', parent: null, purpose: 'Global config: singleplayer, multiplayer, rasterizer, HUD, etc.' },
  { name: 'glow', groupId: 'glw!', parent: null, purpose: "Glowing effects, e.g. the Elite's energy sword." },
  { name: 'grenade_hud_interface', groupId: 'grhi', parent: null, purpose: '' },
  { name: 'hud_globals', groupId: 'hudg', parent: null, purpose: '' },
  { name: 'hud_message_text', groupId: 'hmt ', parent: null, purpose: 'Text for HUD messages like objectives and interactions.' },
  { name: 'hud_number', groupId: 'hud#', parent: null, purpose: '' },
  { name: 'input_device_defaults', groupId: 'devc', parent: null, purpose: '' },
  { name: 'item', groupId: 'item', parent: 'object', purpose: 'Parent of weapon/garbage/equipment: small moveable point-physics object.' },
  { name: 'item_collection', groupId: 'itmc', parent: null, purpose: '' },
  { name: 'lens_flare', groupId: 'lens', parent: null, purpose: 'A 2D sprite that fades by distance and angle.' },
  { name: 'light', groupId: 'ligh', parent: null, purpose: 'Dynamic light source attachable to objects and effects.' },
  { name: 'lightning', groupId: 'elec', parent: null, purpose: '' },
  { name: 'light_volume', groupId: 'mgs2', parent: null, purpose: 'Dense line of glow particles, often used for projectile tails.' },
  { name: 'material_effects', groupId: 'foot', parent: null, purpose: 'Effects when moving objects interact with surfaces (footsteps, tread marks).' },
  { name: 'meter', groupId: 'metr', parent: null, purpose: 'Global health/shield HUD meters.' },
  { name: 'model', groupId: 'mode', parent: null, purpose: 'Render model of objects (original Xbox version).' },
  { name: 'model_animations', groupId: 'antr', parent: null, purpose: '' },
  { name: 'model_collision_geometry', groupId: 'coll', parent: null, purpose: 'Collision mesh plus health/shield info.' },
  { name: 'multiplayer_scenario_description', groupId: 'mply', parent: null, purpose: '' },
  { name: 'object', groupId: 'obje', parent: null, purpose: '' },
  { name: 'particle', groupId: 'part', parent: null, purpose: '' },
  { name: 'particle_system', groupId: 'pctl', parent: null, purpose: '' },
  { name: 'physics', groupId: 'phys', parent: null, purpose: 'Dynamic physics and propulsion of vehicles.' },
  { name: 'placeholder', groupId: 'plac', parent: 'object', purpose: 'Used only by Sapien for interactive handles/markers.' },
  { name: 'point_physics', groupId: 'pphy', parent: null, purpose: 'How simulated points physically interact with the environment.' },
  { name: 'preferences_network_game', groupId: 'ngpr', parent: null, purpose: '' },
  { name: 'projectile', groupId: 'proj', parent: 'object', purpose: 'Short-lived objects for weapon projectiles and thrown grenades.' },
  { name: 'scenario', groupId: 'scnr', parent: null, purpose: 'The main "root" tag for a multiplayer, singleplayer, or UI map.' },
  { name: 'scenario_structure_bsp', groupId: 'sbsp', parent: null, purpose: 'Geometric, lighting, weather, and other data for playable spaces.' },
  { name: 'scenery', groupId: 'scen', parent: 'object', purpose: 'Fixed decoration objects: boulders, plants, crates.' },
  { name: 'shader', groupId: 'shdr', parent: null, purpose: '' },
  { name: 'shader_environment', groupId: 'senv', parent: 'shader', purpose: 'General-purpose opaque/alpha-tested shader for BSP materials.' },
  { name: 'shader_model', groupId: 'soso', parent: 'shader', purpose: 'General-purpose opaque shader for object materials.' },
  { name: 'shader_transparent_chicago', groupId: 'schi', parent: 'shader', purpose: '' },
  { name: 'shader_transparent_chicago_extended', groupId: 'scex', parent: 'shader', purpose: 'Chicago shader variant with an extra 2-stage block for older hardware.' },
  { name: 'shader_transparent_generic', groupId: 'sotr', parent: 'shader', purpose: 'Transparent shader type (H1X/H1A only).' },
  { name: 'shader_transparent_glass', groupId: 'sgla', parent: 'shader', purpose: '' },
  { name: 'shader_transparent_meter', groupId: 'smet', parent: 'shader', purpose: 'Transparent materials with an incrementally scaled area.' },
  { name: 'shader_transparent_plasma', groupId: 'spla', parent: 'shader', purpose: 'Energy shields (e.g. on bipeds).' },
  { name: 'shader_transparent_water', groupId: 'swat', parent: 'shader', purpose: '' },
  { name: 'sky', groupId: 'sky ', parent: null, purpose: 'Skybox with light sources for lightmaps and atmospheric fog.' },
  { name: 'sound', groupId: 'snd!', parent: null, purpose: 'Sound data: sound effects and music.' },
  { name: 'sound_environment', groupId: 'snde', parent: null, purpose: '' },
  { name: 'sound_looping', groupId: 'lsnd', parent: null, purpose: '' },
  { name: 'sound_scenery', groupId: 'ssce', parent: 'object', purpose: 'Like scenery but with device_light_fixture-style collision rules.' },
  { name: 'string_list', groupId: 'str#', parent: null, purpose: '' },
  { name: 'tag_collection', groupId: 'tagc', parent: null, purpose: '' },
  { name: 'ui_widget_collection', groupId: 'Soul', parent: null, purpose: '' },
  { name: 'ui_widget_definition', groupId: 'DeLa', parent: null, purpose: '' },
  { name: 'unicode_string_list', groupId: 'ustr', parent: null, purpose: '' },
  { name: 'unit', groupId: 'unit', parent: 'object', purpose: 'Parent of bipeds/vehicles: fields common to AI-driven/controllable objects.' },
  { name: 'unit_hud_interface', groupId: 'unhi', parent: null, purpose: '' },
  { name: 'vehicle', groupId: 'vehi', parent: 'unit', purpose: 'Driveable/occupiable units with dynamic physics (Warthog, cryo pod).' },
  { name: 'virtual_keyboard', groupId: 'vcky', parent: null, purpose: '' },
  { name: 'weapon', groupId: 'weap', parent: 'item', purpose: 'Wieldable weapons and vehicle-mounted weapons.' },
  { name: 'weapon_hud_interface', groupId: 'wphi', parent: null, purpose: '' },
  { name: 'weather_particle_system', groupId: 'rain', parent: null, purpose: 'Appearance/behaviour of weather particles (rain, snow).' },
  { name: 'wind', groupId: 'wind', parent: null, purpose: 'Speed and variation of wind in a BSP cluster.' },
];

const CLASS_BY_FOURCC = new Map<number, TagClassInfo>(TAG_CLASSES.map((c) => [fourCCFromString(c.groupId), c]));

/** 0xFFFFFFFF is used in the cache file to mean "no secondary/tertiary class". */
export const TAG_CLASS_NONE = 0xffffffff;

export function lookupTagClass(fourcc: number): TagClassInfo | null {
  return CLASS_BY_FOURCC.get(fourcc) ?? null;
}

const CLASS_BY_NAME = new Map<string, TagClassInfo>(TAG_CLASSES.map((c) => [c.name, c]));

/** Looks up a tag class by its group name (e.g. "vehicle") rather than fourcc. Used by the M5 injector to write new tag index entries from a container's `group` field. */
export function lookupTagClassByName(name: string): TagClassInfo | null {
  return CLASS_BY_NAME.get(name) ?? null;
}
