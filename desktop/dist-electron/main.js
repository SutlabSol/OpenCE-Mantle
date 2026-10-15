"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// electron/main.ts
var import_electron3 = require("electron");
var path8 = __toESM(require("path"));
var fs6 = __toESM(require("fs"));

// ../core/src/constants/cache-file.ts
var CHIMERA_COMPRESSED_ENGINE_MASK = 2249850880;
var TAG_STRING_SIZE = 32;
var TAG_DATA_HEADER_PC_SIZE = 40;
var CE_BASE_MEMORY_ADDRESS = 1078198272;
var CE_TAG_ARRAY_ADDRESS = CE_BASE_MEMORY_ADDRESS + TAG_DATA_HEADER_PC_SIZE;
var CE_TAG_SPACE_SIZE = 23 * 1024 * 1024;

// ../core/src/constants/tag-classes.ts
function fourCCFromString(code) {
  if (code.length !== 4) {
    throw new Error(`FourCC must be exactly 4 characters, got "${code}" (${code.length})`);
  }
  return (code.charCodeAt(0) << 24 | code.charCodeAt(1) << 16 | code.charCodeAt(2) << 8 | code.charCodeAt(3)) >>> 0;
}
var TAG_CLASSES = [
  { name: "actor", groupId: "actr", parent: null, purpose: "Defines core AI behaviours shared by actor variants." },
  { name: "actor_variant", groupId: "actv", parent: null, purpose: "Specializes an actor: appearance, weapon use, grenades, health, dropped equipment." },
  { name: "antenna", groupId: "ant!", parent: null, purpose: "A springy antenna widget attached to model markers (Warthog, Scorpion)." },
  { name: "biped", groupId: "bipd", parent: "unit", purpose: "Physical characteristics and appearance of characters (Elites, Marines, Cortana, player)." },
  { name: "bitmap", groupId: "bitm", parent: null, purpose: "Texture data: sprite sheets, environment maps, normal maps, etc." },
  { name: "camera_track", groupId: "trak", parent: null, purpose: "Rotational constraints for the game's camera when controlling bipeds or vehicles." },
  { name: "color_table", groupId: "colo", parent: null, purpose: "" },
  { name: "continuous_damage_effect", groupId: "cdmg", parent: null, purpose: "Continuous screen shake/controller vibration near a sound_looping source." },
  { name: "contrail", groupId: "cont", parent: null, purpose: "Trail-like repeating bitmap effects attached to objects." },
  { name: "damage_effect", groupId: "jpt!", parent: null, purpose: "Damage application properties: material modifiers, screen effects, acceleration, AoE." },
  { name: "decal", groupId: "deca", parent: null, purpose: "Bullet holes, blood, burns, signs, other 2D surface effects." },
  { name: "detail_object_collection", groupId: "dobc", parent: null, purpose: "Mix/appearance of small 2D detail objects like grass." },
  { name: "device", groupId: "devi", parent: "object", purpose: "Parent tag for devices: controlled objects with powered on/off states." },
  { name: "device_control", groupId: "ctrl", parent: "device", purpose: "Interactive switches/buttons operating device_machines like doors/elevators." },
  { name: "device_light_fixture", groupId: "lifi", parent: "device", purpose: "Dynamically toggled light sources or decorative lighting objects." },
  { name: "device_machine", groupId: "mach", parent: "device", purpose: "Objects animating between open/closed states (doors, elevators)." },
  { name: "dialogue", groupId: "udlg", parent: null, purpose: "Situational unit sounds: taking damage, fleeing, etc." },
  { name: "effect", groupId: "effe", parent: null, purpose: "Responses to events: material impacts, sound effects, detonations." },
  { name: "equipment", groupId: "eqip", parent: "item", purpose: "Powerups, health packs, non-live grenades, ammo pickups." },
  { name: "flag", groupId: "flag", parent: null, purpose: "Simulated cloth-like material attachable to objects." },
  { name: "fog", groupId: "fog ", parent: null, purpose: "Appearance of fog planes." },
  { name: "font", groupId: "font", parent: null, purpose: "" },
  { name: "garbage", groupId: "garb", parent: "item", purpose: "" },
  { name: "gbxmodel", groupId: "mod2", parent: null, purpose: "Render model of objects (Gearbox/PC port)." },
  { name: "globals", groupId: "matg", parent: null, purpose: "Global config: singleplayer, multiplayer, rasterizer, HUD, etc." },
  { name: "glow", groupId: "glw!", parent: null, purpose: "Glowing effects, e.g. the Elite's energy sword." },
  { name: "grenade_hud_interface", groupId: "grhi", parent: null, purpose: "" },
  { name: "hud_globals", groupId: "hudg", parent: null, purpose: "" },
  { name: "hud_message_text", groupId: "hmt ", parent: null, purpose: "Text for HUD messages like objectives and interactions." },
  { name: "hud_number", groupId: "hud#", parent: null, purpose: "" },
  { name: "input_device_defaults", groupId: "devc", parent: null, purpose: "" },
  { name: "item", groupId: "item", parent: "object", purpose: "Parent of weapon/garbage/equipment: small moveable point-physics object." },
  { name: "item_collection", groupId: "itmc", parent: null, purpose: "" },
  { name: "lens_flare", groupId: "lens", parent: null, purpose: "A 2D sprite that fades by distance and angle." },
  { name: "light", groupId: "ligh", parent: null, purpose: "Dynamic light source attachable to objects and effects." },
  { name: "lightning", groupId: "elec", parent: null, purpose: "" },
  { name: "light_volume", groupId: "mgs2", parent: null, purpose: "Dense line of glow particles, often used for projectile tails." },
  { name: "material_effects", groupId: "foot", parent: null, purpose: "Effects when moving objects interact with surfaces (footsteps, tread marks)." },
  { name: "meter", groupId: "metr", parent: null, purpose: "Global health/shield HUD meters." },
  { name: "model", groupId: "mode", parent: null, purpose: "Render model of objects (original Xbox version)." },
  { name: "model_animations", groupId: "antr", parent: null, purpose: "" },
  { name: "model_collision_geometry", groupId: "coll", parent: null, purpose: "Collision mesh plus health/shield info." },
  { name: "multiplayer_scenario_description", groupId: "mply", parent: null, purpose: "" },
  { name: "object", groupId: "obje", parent: null, purpose: "" },
  { name: "particle", groupId: "part", parent: null, purpose: "" },
  { name: "particle_system", groupId: "pctl", parent: null, purpose: "" },
  { name: "physics", groupId: "phys", parent: null, purpose: "Dynamic physics and propulsion of vehicles." },
  { name: "placeholder", groupId: "plac", parent: "object", purpose: "Used only by Sapien for interactive handles/markers." },
  { name: "point_physics", groupId: "pphy", parent: null, purpose: "How simulated points physically interact with the environment." },
  { name: "preferences_network_game", groupId: "ngpr", parent: null, purpose: "" },
  { name: "projectile", groupId: "proj", parent: "object", purpose: "Short-lived objects for weapon projectiles and thrown grenades." },
  { name: "scenario", groupId: "scnr", parent: null, purpose: 'The main "root" tag for a multiplayer, singleplayer, or UI map.' },
  { name: "scenario_structure_bsp", groupId: "sbsp", parent: null, purpose: "Geometric, lighting, weather, and other data for playable spaces." },
  { name: "scenery", groupId: "scen", parent: "object", purpose: "Fixed decoration objects: boulders, plants, crates." },
  { name: "shader", groupId: "shdr", parent: null, purpose: "" },
  { name: "shader_environment", groupId: "senv", parent: "shader", purpose: "General-purpose opaque/alpha-tested shader for BSP materials." },
  { name: "shader_model", groupId: "soso", parent: "shader", purpose: "General-purpose opaque shader for object materials." },
  { name: "shader_transparent_chicago", groupId: "schi", parent: "shader", purpose: "" },
  { name: "shader_transparent_chicago_extended", groupId: "scex", parent: "shader", purpose: "Chicago shader variant with an extra 2-stage block for older hardware." },
  { name: "shader_transparent_generic", groupId: "sotr", parent: "shader", purpose: "Transparent shader type (H1X/H1A only)." },
  { name: "shader_transparent_glass", groupId: "sgla", parent: "shader", purpose: "" },
  { name: "shader_transparent_meter", groupId: "smet", parent: "shader", purpose: "Transparent materials with an incrementally scaled area." },
  { name: "shader_transparent_plasma", groupId: "spla", parent: "shader", purpose: "Energy shields (e.g. on bipeds)." },
  { name: "shader_transparent_water", groupId: "swat", parent: "shader", purpose: "" },
  { name: "sky", groupId: "sky ", parent: null, purpose: "Skybox with light sources for lightmaps and atmospheric fog." },
  { name: "sound", groupId: "snd!", parent: null, purpose: "Sound data: sound effects and music." },
  { name: "sound_environment", groupId: "snde", parent: null, purpose: "" },
  { name: "sound_looping", groupId: "lsnd", parent: null, purpose: "" },
  { name: "sound_scenery", groupId: "ssce", parent: "object", purpose: "Like scenery but with device_light_fixture-style collision rules." },
  { name: "string_list", groupId: "str#", parent: null, purpose: "" },
  { name: "tag_collection", groupId: "tagc", parent: null, purpose: "" },
  { name: "ui_widget_collection", groupId: "Soul", parent: null, purpose: "" },
  { name: "ui_widget_definition", groupId: "DeLa", parent: null, purpose: "" },
  { name: "unicode_string_list", groupId: "ustr", parent: null, purpose: "" },
  { name: "unit", groupId: "unit", parent: "object", purpose: "Parent of bipeds/vehicles: fields common to AI-driven/controllable objects." },
  { name: "unit_hud_interface", groupId: "unhi", parent: null, purpose: "" },
  { name: "vehicle", groupId: "vehi", parent: "unit", purpose: "Driveable/occupiable units with dynamic physics (Warthog, cryo pod)." },
  { name: "virtual_keyboard", groupId: "vcky", parent: null, purpose: "" },
  { name: "weapon", groupId: "weap", parent: "item", purpose: "Wieldable weapons and vehicle-mounted weapons." },
  { name: "weapon_hud_interface", groupId: "wphi", parent: null, purpose: "" },
  { name: "weather_particle_system", groupId: "rain", parent: null, purpose: "Appearance/behaviour of weather particles (rain, snow)." },
  { name: "wind", groupId: "wind", parent: null, purpose: "Speed and variation of wind in a BSP cluster." }
];
var CLASS_BY_FOURCC = new Map(TAG_CLASSES.map((c) => [fourCCFromString(c.groupId), c]));
var CLASS_BY_NAME = new Map(TAG_CLASSES.map((c) => [c.name, c]));

// ../core/src/map/errors.ts
var CorruptMapError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "CorruptMapError";
  }
};

// ../core/src/map/tag-footprints.ts
var SCENARIO_STRUCTURE_BSP_FOURCC = fourCCFromString("sbsp");

// ../core/src/map/compression.ts
var import_zstd = require("@mongodb-js/zstd");
var CUSTOM_EDITION_COMPRESSED_ENGINE = (609 /* CUSTOM_EDITION */ | CHIMERA_COMPRESSED_ENGINE_MASK) >>> 0;

// ../core/src/map/resource-map.ts
var import_crypto = require("crypto");
var RESOURCE_MAP_HEADER_SIZE = 16;
var RESOURCE_MAP_ENTRY_SIZE = 12;
function parseResourceMap(buffer) {
  if (buffer.length < RESOURCE_MAP_HEADER_SIZE) {
    throw new CorruptMapError("Resource map is smaller than its own header.");
  }
  const type = buffer.readUInt32LE(0);
  const pathsOffset = buffer.readUInt32LE(4);
  const resourcesOffset = buffer.readUInt32LE(8);
  const resourceCount = buffer.readUInt32LE(12);
  if (resourcesOffset + resourceCount * RESOURCE_MAP_ENTRY_SIZE > buffer.length) {
    throw new CorruptMapError("Resource map index is out of bounds of the file.");
  }
  const entries = [];
  for (let i = 0; i < resourceCount; i++) {
    const entryOffset = resourcesOffset + i * RESOURCE_MAP_ENTRY_SIZE;
    entries.push({
      index: i,
      pathOffset: pathsOffset + buffer.readUInt32LE(entryOffset + 0),
      size: buffer.readUInt32LE(entryOffset + 4),
      dataOffset: buffer.readUInt32LE(entryOffset + 8)
    });
  }
  return { type, resourceCount, entries };
}
function computeResourceMapIdentity(buffer) {
  const map = parseResourceMap(buffer);
  const resourcesOffset = buffer.readUInt32LE(8);
  const tableEnd = resourcesOffset + map.resourceCount * RESOURCE_MAP_ENTRY_SIZE;
  const hash = (0, import_crypto.createHash)("sha256");
  hash.update(buffer.subarray(0, Math.min(tableEnd, buffer.length)));
  return { fileSize: buffer.length, entryCount: map.resourceCount, fingerprint: hash.digest("hex") };
}
var RESOURCE_MAP_TYPE_BY_KIND = { bitmaps: 1, sounds: 2, loc: 3 };
function validateResourceMapFile(buffer, kind) {
  let map;
  try {
    map = parseResourceMap(buffer);
  } catch (err) {
    return { ok: false, error: `This file doesn't look like a resource map (${err instanceof Error ? err.message : String(err)}).` };
  }
  const expectedType = RESOURCE_MAP_TYPE_BY_KIND[kind];
  if (map.type !== expectedType) {
    const kindName = Object.keys(RESOURCE_MAP_TYPE_BY_KIND).find((k) => RESOURCE_MAP_TYPE_BY_KIND[k] === map.type);
    return { ok: false, error: `This file is a ${kindName ?? "unknown"}-type resource map, not a ${kind}.map - pick the correct file for this slot.` };
  }
  return { ok: true, identity: computeResourceMapIdentity(buffer) };
}

// ../core/src/map/definitions/groups/actor.json
var actor_default = [
  {
    kind: "enum",
    name: "ActorType",
    options: [
      "elite",
      "jackal",
      "grunt",
      "hunter",
      "engineer",
      "assassin",
      "player",
      "marine",
      "crew",
      "combat form",
      "infection form",
      "carrier form",
      "monitor",
      "sentinel",
      "none",
      "mounted weapon"
    ]
  },
  {
    kind: "enum",
    name: "ActorUnreachableDangerTrigger",
    options: [
      "never",
      "visible",
      "shooting",
      "shooting near us",
      "damaging us",
      "unused",
      "unused1",
      "unused2",
      "unused3",
      "unused4"
    ]
  },
  {
    kind: "enum",
    name: "ActorDefensiveCrouchType",
    options: [
      "never",
      "danger",
      "low shields",
      "hide behind shield",
      "any target",
      "flood shamble"
    ]
  },
  {
    kind: "bitfield",
    name: "ActorFlags",
    width: 32,
    fields: [
      "can see in darkness",
      "sneak uncovering target",
      "sneak uncovering pursuit position",
      "unused",
      "shoot at target s last location",
      "try to stay still when crouched",
      "crouch when not in combat",
      "crouch when guarding",
      "unused 1",
      "must crouch to shoot",
      "panic when surprised",
      "always charge at enemies",
      "gets in vehicles with player",
      "start firing before aligned",
      "standing must move forward",
      "crouching must move forward",
      "defensive crouch while charging",
      "use stalking behavior",
      "stalking freeze if exposed",
      "always berserk in attacking mode",
      "berserking uses panicked movement",
      "flying",
      "panicked by unopposable enemy",
      "crouch when hiding from unopposable",
      "always charge in attacking mode",
      "dive off ledges",
      "swarm",
      "suicidal melee attack",
      "cannot move while crouching",
      "fixed crouch facing",
      "crouch when in line of fire",
      "avoid friends line of fire"
    ]
  },
  {
    kind: "bitfield",
    name: "ActorMoreFlags",
    width: 32,
    fields: [
      "avoid all enemy attack vectors",
      "must stand to fire",
      "must stop to fire",
      "disallow vehicle combat",
      "pathfinding ignores danger",
      "panic in groups",
      "no corpse shooting"
    ]
  },
  {
    kind: "struct",
    name: "Actor",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "ActorFlags"
      },
      {
        kind: "field",
        name: "more flags",
        type: "ActorMoreFlags"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "type",
        type: "ActorType"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "max vision distance",
        type: "float"
      },
      {
        kind: "field",
        name: "central vision angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "max vision angle",
        type: "Angle"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "peripheral vision angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "peripheral distance",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "standing gun offset",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "crouching gun offset",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "hearing distance",
        type: "float"
      },
      {
        kind: "field",
        name: "notice projectile chance",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "notice vehicle chance",
        type: "float",
        maximum: 1
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "combat perception time",
        type: "float"
      },
      {
        kind: "field",
        name: "guard perception time",
        type: "float"
      },
      {
        kind: "field",
        name: "non combat perception time",
        type: "float"
      },
      {
        kind: "field",
        name: "inverse combat perception time",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "inverse guard perception time",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "inverse non combat perception time",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "dive into cover chance",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "emerge from cover chance",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "dive from grenade chance",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "pathfinding radius",
        type: "float"
      },
      {
        kind: "field",
        name: "glass ignorance chance",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "stationary movement dist",
        type: "float"
      },
      {
        kind: "field",
        name: "free flying sidestep",
        type: "float"
      },
      {
        kind: "field",
        name: "begin moving angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "cosine begin moving angle",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "maximum aiming deviation",
        type: "Euler2D"
      },
      {
        kind: "field",
        name: "maximum looking deviation",
        type: "Euler2D"
      },
      {
        kind: "field",
        name: "noncombat look delta l",
        type: "Angle"
      },
      {
        kind: "field",
        name: "noncombat look delta r",
        type: "Angle"
      },
      {
        kind: "field",
        name: "combat look delta l",
        type: "Angle"
      },
      {
        kind: "field",
        name: "combat look delta r",
        type: "Angle"
      },
      {
        kind: "field",
        name: "idle aiming range",
        type: "Euler2D"
      },
      {
        kind: "field",
        name: "idle looking range",
        type: "Euler2D"
      },
      {
        kind: "field",
        name: "event look time modifier",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "noncombat idle facing",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "noncombat idle aiming",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "noncombat idle looking",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "guard idle facing",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "guard idle aiming",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "guard idle looking",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "combat idle facing",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "combat idle aiming",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "combat idle looking",
        type: "float",
        bounds: true
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "cosine maximum aiming deviation",
        type: "Euler2D",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "cosine maximum looking deviation",
        type: "Euler2D",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "do not use",
        type: "TagDependency",
        classes: [
          "weapon"
        ]
      },
      {
        kind: "pad",
        size: 268
      },
      {
        kind: "field",
        name: "do not use 1",
        type: "TagDependency",
        classes: [
          "projectile"
        ]
      },
      {
        kind: "field",
        name: "unreachable danger trigger",
        type: "ActorUnreachableDangerTrigger"
      },
      {
        kind: "field",
        name: "vehicle danger trigger",
        type: "ActorUnreachableDangerTrigger"
      },
      {
        kind: "field",
        name: "player danger trigger",
        type: "ActorUnreachableDangerTrigger"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "danger trigger time",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "friends killed trigger",
        type: "int16"
      },
      {
        kind: "field",
        name: "friends retreating trigger",
        type: "int16"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "retreat time",
        type: "float",
        bounds: true
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "cowering time",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "friend killed panic chance",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "leader type",
        type: "ActorType"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "leader killed panic chance",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "panic damage threshold",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "surprise distance",
        type: "float"
      },
      {
        kind: "pad",
        size: 28
      },
      {
        kind: "field",
        name: "hide behind cover time",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "hide target not visible time",
        type: "float"
      },
      {
        kind: "field",
        name: "hide shield fraction",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "attack shield fraction",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "pursue shield fraction",
        type: "float",
        maximum: 1
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "defensive crouch type",
        type: "ActorDefensiveCrouchType"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "attacking crouch threshold",
        type: "float"
      },
      {
        kind: "field",
        name: "defending crouch threshold",
        type: "float"
      },
      {
        kind: "field",
        name: "min stand time",
        type: "float"
      },
      {
        kind: "field",
        name: "min crouch time",
        type: "float"
      },
      {
        kind: "field",
        name: "defending hide time modifier",
        type: "float"
      },
      {
        kind: "field",
        name: "attacking evasion threshold",
        type: "float"
      },
      {
        kind: "field",
        name: "defending evasion threshold",
        type: "float"
      },
      {
        kind: "field",
        name: "evasion seek cover chance",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "evasion delay time",
        type: "float"
      },
      {
        kind: "field",
        name: "max seek cover distance",
        type: "float"
      },
      {
        kind: "field",
        name: "cover damage threshold",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "stalking discovery time",
        type: "float"
      },
      {
        kind: "field",
        name: "stalking max distance",
        type: "float"
      },
      {
        kind: "field",
        name: "stationary facing angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "change facing stand time",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "uncover delay time",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "target search time",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "pursuit position time",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "num positions (coord)",
        type: "uint16"
      },
      {
        kind: "field",
        name: "num positions (normal)",
        type: "uint16"
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "melee attack delay",
        type: "float"
      },
      {
        kind: "field",
        name: "melee fudge factor",
        type: "float"
      },
      {
        kind: "field",
        name: "melee charge time",
        type: "float"
      },
      {
        kind: "field",
        name: "melee leap range",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "melee leap velocity",
        type: "float"
      },
      {
        kind: "field",
        name: "melee leap chance",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "melee leap ballistic",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "berserk damage amount",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "berserk damage threshold",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "berserk proximity",
        type: "float"
      },
      {
        kind: "field",
        name: "suicide sensing dist",
        type: "float"
      },
      {
        kind: "field",
        name: "berserk grenade chance",
        type: "float",
        maximum: 1
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "guard position time",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "combat position time",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "old position avoid dist",
        type: "float"
      },
      {
        kind: "field",
        name: "friend avoid dist",
        type: "float"
      },
      {
        kind: "pad",
        size: 40
      },
      {
        kind: "field",
        name: "noncombat idle speech time",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "combat idle speech time",
        type: "float",
        bounds: true
      },
      {
        kind: "pad",
        size: 48
      },
      {
        kind: "pad",
        size: 128
      },
      {
        kind: "field",
        name: "do not use 2",
        type: "TagDependency",
        classes: [
          "actor"
        ]
      },
      {
        kind: "pad",
        size: 48
      }
    ],
    tagClass: "actor",
    sizeBytes: 1272
  }
];

// ../core/src/map/definitions/groups/actor_variant.json
var actor_variant_default = [
  {
    kind: "enum",
    name: "ActorVariantMovementType",
    options: [
      "always run",
      "always crouch",
      "switch types"
    ]
  },
  {
    kind: "enum",
    name: "ActorVariantSpecialFireMode",
    options: [
      "none",
      "overcharge",
      "secondary trigger"
    ]
  },
  {
    kind: "enum",
    name: "ActorVariantSpecialFireSituation",
    options: [
      "never",
      "enemy visible",
      "enemy out of sight",
      "strafing"
    ]
  },
  {
    kind: "enum",
    name: "ActorVariantTrajectoryType",
    options: [
      "toss",
      "lob",
      "bounce"
    ]
  },
  {
    kind: "enum",
    name: "ActorVariantGrenadeStimulus",
    options: [
      "never",
      "visible target",
      "seek cover"
    ]
  },
  {
    kind: "bitfield",
    name: "ActorVariantFlags",
    width: 32,
    fields: [
      "can shoot while flying",
      "interpolate color in hsv",
      "has unlimited grenades",
      "movement switching try to stay with friends",
      "active camouflage",
      "super active camouflage",
      "cannot use ranged weapons",
      "prefer passenger seat"
    ]
  },
  {
    kind: "struct",
    name: "ActorVariantChangeColors",
    fields: [
      {
        kind: "field",
        name: "color lower bound",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "color upper bound",
        type: "ColorRGB"
      },
      {
        kind: "pad",
        size: 8
      }
    ],
    sizeBytes: 32
  },
  {
    kind: "struct",
    name: "ActorVariant",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "ActorVariantFlags"
      },
      {
        kind: "field",
        name: "actor definition",
        type: "TagDependency",
        classes: [
          "actor"
        ]
      },
      {
        kind: "field",
        name: "unit",
        type: "TagDependency",
        classes: [
          "unit"
        ]
      },
      {
        kind: "field",
        name: "major variant",
        type: "TagDependency",
        classes: [
          "actor_variant"
        ]
      },
      {
        kind: "field",
        name: "metagame type",
        type: "MetagameType",
        comment: "used for scoring in Halo: CE Anniversary (MCC only)"
      },
      {
        kind: "field",
        name: "metagame class",
        type: "MetagameClass",
        comment: "used for scoring in Halo: CE Anniversary (MCC only)"
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "movement type",
        type: "ActorVariantMovementType"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "initial crouch chance",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "crouch time",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "run time",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "weapon",
        type: "TagDependency",
        classes: [
          "weapon"
        ]
      },
      {
        kind: "field",
        name: "maximum firing distance",
        type: "float"
      },
      {
        kind: "field",
        name: "rate of fire",
        type: "float"
      },
      {
        kind: "field",
        name: "projectile error",
        type: "Angle"
      },
      {
        kind: "field",
        name: "first burst delay time",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "new target firing pattern time",
        type: "float"
      },
      {
        kind: "field",
        name: "surprise delay time",
        type: "float"
      },
      {
        kind: "field",
        name: "surprise fire wildly time",
        type: "float"
      },
      {
        kind: "field",
        name: "death fire wildly chance",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "death fire wildly time",
        type: "float"
      },
      {
        kind: "field",
        name: "desired combat range",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "custom stand gun offset",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "custom crouch gun offset",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "target tracking",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "target leading",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "weapon damage modifier",
        type: "float"
      },
      {
        kind: "field",
        name: "damage per second",
        type: "float"
      },
      {
        kind: "field",
        name: "burst origin radius",
        type: "float"
      },
      {
        kind: "field",
        name: "burst origin angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "burst return length",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "burst return angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "burst duration",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "burst separation",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "burst angular velocity",
        type: "Angle"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "special damage modifier",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "special projectile error",
        type: "Angle"
      },
      {
        kind: "field",
        name: "new target burst duration",
        type: "float"
      },
      {
        kind: "field",
        name: "new target burst separation",
        type: "float"
      },
      {
        kind: "field",
        name: "new target rate of fire",
        type: "float"
      },
      {
        kind: "field",
        name: "new target projectile error",
        type: "float"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "moving burst duration",
        type: "float"
      },
      {
        kind: "field",
        name: "moving burst separation",
        type: "float"
      },
      {
        kind: "field",
        name: "moving rate of fire",
        type: "float"
      },
      {
        kind: "field",
        name: "moving projectile error",
        type: "float"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "berserk burst duration",
        type: "float"
      },
      {
        kind: "field",
        name: "berserk burst separation",
        type: "float"
      },
      {
        kind: "field",
        name: "berserk rate of fire",
        type: "float"
      },
      {
        kind: "field",
        name: "berserk projectile error",
        type: "float"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "super ballistic range",
        type: "float"
      },
      {
        kind: "field",
        name: "bombardment range",
        type: "float"
      },
      {
        kind: "field",
        name: "modified vision range",
        type: "float"
      },
      {
        kind: "field",
        name: "special fire mode",
        type: "ActorVariantSpecialFireMode"
      },
      {
        kind: "field",
        name: "special fire situation",
        type: "ActorVariantSpecialFireSituation"
      },
      {
        kind: "field",
        name: "special fire chance",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "special fire delay",
        type: "float"
      },
      {
        kind: "field",
        name: "melee range",
        type: "float"
      },
      {
        kind: "field",
        name: "melee abort range",
        type: "float"
      },
      {
        kind: "field",
        name: "berserk firing ranges",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "berserk melee range",
        type: "float"
      },
      {
        kind: "field",
        name: "berserk melee abort range",
        type: "float"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "grenade type",
        type: "GrenadeType"
      },
      {
        kind: "field",
        name: "trajectory type",
        type: "ActorVariantTrajectoryType"
      },
      {
        kind: "field",
        name: "grenade stimulus",
        type: "ActorVariantGrenadeStimulus"
      },
      {
        kind: "field",
        name: "minimum enemy count",
        type: "int16"
      },
      {
        kind: "field",
        name: "enemy radius",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "grenade velocity",
        type: "float"
      },
      {
        kind: "field",
        name: "grenade ranges",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "collateral damage radius",
        type: "float"
      },
      {
        kind: "field",
        name: "grenade chance",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "grenade check time",
        type: "float"
      },
      {
        kind: "field",
        name: "encounter grenade timeout",
        type: "float"
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "equipment",
        type: "TagDependency",
        classes: [
          "equipment"
        ]
      },
      {
        kind: "field",
        name: "grenade count",
        type: "int16",
        bounds: true
      },
      {
        kind: "field",
        name: "don't drop grenades chance",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "drop weapon loaded",
        type: "float",
        maximum: 1,
        bounds: true
      },
      {
        kind: "field",
        name: "drop weapon ammo",
        type: "int16",
        bounds: true
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "body vitality",
        type: "float"
      },
      {
        kind: "field",
        name: "shield vitality",
        type: "float"
      },
      {
        kind: "field",
        name: "shield sapping radius",
        type: "float"
      },
      {
        kind: "field",
        name: "forced shader permutation",
        type: "Index"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "change colors",
        type: "TagReflexive",
        struct: "ActorVariantChangeColors",
        maximum: 4
      }
    ],
    tagClass: "actor_variant",
    sizeBytes: 568
  }
];

// ../core/src/map/definitions/groups/antenna.json
var antenna_default = [
  {
    kind: "struct",
    name: "AntennaVertex",
    fields: [
      {
        kind: "field",
        name: "spring strength coefficient",
        type: "Fraction"
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "angles",
        type: "Euler2D"
      },
      {
        kind: "field",
        name: "length",
        type: "float"
      },
      {
        kind: "field",
        name: "sequence index",
        type: "Index"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "color",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "lod color",
        type: "ColorARGB"
      },
      {
        kind: "pad",
        size: 40
      },
      {
        kind: "field",
        name: "offset",
        type: "Point3D",
        cacheOnly: true
      }
    ],
    sizeBytes: 128
  },
  {
    kind: "struct",
    name: "Antenna",
    fields: [
      {
        kind: "field",
        name: "attachment marker name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "bitmaps",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "physics",
        type: "TagDependency",
        classes: [
          "point_physics"
        ]
      },
      {
        kind: "pad",
        size: 80
      },
      {
        kind: "field",
        name: "spring strength coefficient",
        type: "Fraction"
      },
      {
        kind: "field",
        name: "falloff pixels",
        type: "float"
      },
      {
        kind: "field",
        name: "cutoff pixels",
        type: "float"
      },
      {
        kind: "field",
        name: "length",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 36
      },
      {
        kind: "field",
        name: "vertices",
        type: "TagReflexive",
        struct: "AntennaVertex",
        maximum: 20
      }
    ],
    tagClass: "antenna",
    sizeBytes: 208
  }
];

// ../core/src/map/definitions/groups/biped.json
var biped_default = [
  {
    kind: "enum",
    name: "BipedFunctionIn",
    options: [
      "none",
      "flying velocity"
    ]
  },
  {
    kind: "bitfield",
    name: "BipedFlags",
    width: 32,
    fields: [
      "turns without animating",
      "uses player physics",
      "flying",
      "physics pill centered at origin",
      "spherical",
      "passes through other bipeds",
      "can climb any surface",
      "immune to falling damage",
      "rotate while airborne",
      "uses limp body physics",
      "has no dying airborne",
      "random speed increase",
      "unit uses old ntsc player physics"
    ]
  },
  {
    kind: "struct",
    name: "BipedContactPoint",
    fields: [
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "marker name",
        type: "TagString"
      }
    ],
    sizeBytes: 64
  },
  {
    kind: "struct",
    name: "Biped",
    fields: [
      {
        kind: "field",
        name: "moving turning speed",
        type: "Angle"
      },
      {
        kind: "field",
        name: "biped flags",
        type: "BipedFlags"
      },
      {
        kind: "field",
        name: "stationary turning threshold",
        type: "Angle"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "biped a in",
        type: "BipedFunctionIn"
      },
      {
        kind: "field",
        name: "biped b in",
        type: "BipedFunctionIn"
      },
      {
        kind: "field",
        name: "biped c in",
        type: "BipedFunctionIn"
      },
      {
        kind: "field",
        name: "biped d in",
        type: "BipedFunctionIn"
      },
      {
        kind: "field",
        name: "don't use",
        type: "TagDependency",
        classes: [
          "damage_effect"
        ]
      },
      {
        kind: "field",
        name: "bank angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "bank apply time",
        type: "float"
      },
      {
        kind: "field",
        name: "bank decay time",
        type: "float"
      },
      {
        kind: "field",
        name: "pitch ratio",
        type: "float"
      },
      {
        kind: "field",
        name: "max velocity",
        type: "float"
      },
      {
        kind: "field",
        name: "max sidestep velocity",
        type: "float"
      },
      {
        kind: "field",
        name: "acceleration",
        type: "float"
      },
      {
        kind: "field",
        name: "deceleration",
        type: "float"
      },
      {
        kind: "field",
        name: "angular velocity maximum",
        type: "Angle"
      },
      {
        kind: "field",
        name: "angular acceleration maximum",
        type: "Angle"
      },
      {
        kind: "field",
        name: "crouch velocity modifier",
        type: "float",
        maximum: 1
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "maximum slope angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "downhill falloff angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "downhill cutoff angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "downhill velocity scale",
        type: "float"
      },
      {
        kind: "field",
        name: "uphill falloff angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "uphill cutoff angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "uphill velocity scale",
        type: "float"
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "footsteps",
        type: "TagDependency",
        classes: [
          "material_effects"
        ]
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "jump velocity",
        type: "float"
      },
      {
        kind: "pad",
        size: 28
      },
      {
        kind: "field",
        name: "maximum soft landing time",
        type: "float"
      },
      {
        kind: "field",
        name: "maximum hard landing time",
        type: "float"
      },
      {
        kind: "field",
        name: "minimum soft landing velocity",
        type: "float"
      },
      {
        kind: "field",
        name: "minimum hard landing velocity",
        type: "float"
      },
      {
        kind: "field",
        name: "maximum hard landing velocity",
        type: "float"
      },
      {
        kind: "field",
        name: "death hard landing velocity",
        type: "float"
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "standing camera height",
        type: "float"
      },
      {
        kind: "field",
        name: "crouching camera height",
        type: "float"
      },
      {
        kind: "field",
        name: "crouch transition time",
        type: "float"
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "standing collision height",
        type: "float"
      },
      {
        kind: "field",
        name: "crouching collision height",
        type: "float"
      },
      {
        kind: "field",
        name: "collision radius",
        type: "float"
      },
      {
        kind: "pad",
        size: 40
      },
      {
        kind: "field",
        name: "autoaim width",
        type: "float"
      },
      {
        kind: "pad",
        size: 108
      },
      {
        kind: "field",
        name: "cosine stationary turning threshold",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "crouch camera velocity",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "cosine maximum slope angle",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "negative sine downhill falloff angle",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "negative sine downhill cutoff angle",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "sine uphill falloff angle",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "sine uphill cutoff angle",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "pelvis model node index",
        type: "Index",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "head model node index",
        type: "Index",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "contact point",
        type: "TagReflexive",
        struct: "BipedContactPoint",
        maximum: 2
      }
    ],
    inherits: "Unit",
    tagClass: "biped",
    sizeBytes: 1268
  }
];

// ../core/src/map/definitions/groups/bitfield.json
var bitfield_default = [
  {
    kind: "bitfield",
    name: "IsUnusedFlag",
    width: 32,
    fields: [
      "unused"
    ]
  },
  {
    kind: "bitfield",
    name: "IsUnfilteredFlag",
    width: 16,
    fields: [
      "unfiltered"
    ]
  },
  {
    kind: "bitfield",
    name: "ColorInterpolationFlags",
    width: 32,
    fields: [
      "blend in hsv",
      "more colors"
    ]
  }
];

// ../core/src/map/definitions/groups/bitmap.json
var bitmap_default = [
  {
    kind: "enum",
    name: "BitmapDataType",
    options: [
      "2d texture",
      "3d texture",
      "cube map",
      "white"
    ]
  },
  {
    kind: "enum",
    name: "BitmapDataFormat",
    options: [
      "a8",
      "y8",
      "ay8",
      "a8y8",
      "unused1",
      "unused2",
      "r5g6b5",
      "unused3",
      "a1r5g5b5",
      "a4r4g4b4",
      "x8r8g8b8",
      "a8r8g8b8",
      "unused4",
      "unused5",
      "dxt1",
      "dxt3",
      "dxt5",
      "p8 bump",
      "bc7"
    ]
  },
  {
    kind: "enum",
    name: "BitmapType",
    options: [
      "2d textures",
      "3d textures",
      "cube maps",
      "sprites",
      "interface bitmaps"
    ]
  },
  {
    kind: "enum",
    name: "BitmapFormat",
    options: [
      "dxt1",
      "dxt3",
      "dxt5",
      "16-bit",
      "32-bit",
      "monochrome",
      "bc7"
    ]
  },
  {
    kind: "enum",
    name: "BitmapUsage",
    options: [
      "alpha blend",
      "default",
      "height map",
      "detail map",
      "light map",
      "vector map"
    ]
  },
  {
    kind: "enum",
    name: "BitmapSpriteBudgetSize",
    options: [
      "32x32",
      "64x64",
      "128x128",
      "256x256",
      "512x512",
      "1024x1024"
    ]
  },
  {
    kind: "enum",
    name: "BitmapSpriteUsage",
    options: [
      "blend add subtract max",
      "multiply min",
      "double multiply"
    ]
  },
  {
    kind: "bitfield",
    name: "BitmapDataFlags",
    width: 16,
    fields: [
      "power of two dimensions",
      "compressed",
      "palettized",
      "swizzled",
      "linear",
      "v16u16",
      "unused",
      "make it actually work",
      "external",
      "environment"
    ]
  },
  {
    kind: "bitfield",
    name: "BitmapFlags",
    width: 16,
    fields: [
      "enable diffusion dithering",
      "disable height map compression",
      "uniform sprite sequences",
      "filthy sprite bug fix",
      "half hud scale",
      "invert detail fade",
      "use average color for detail fade",
      "force hud use highres scale"
    ]
  },
  {
    kind: "struct",
    name: "BitmapGroupSprite",
    fields: [
      {
        kind: "field",
        name: "bitmap index",
        type: "Index",
        struct: "Bitmap"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "left",
        type: "float"
      },
      {
        kind: "field",
        name: "right",
        type: "float"
      },
      {
        kind: "field",
        name: "top",
        type: "float"
      },
      {
        kind: "field",
        name: "bottom",
        type: "float"
      },
      {
        kind: "field",
        name: "registration point",
        type: "Point2D"
      }
    ],
    sizeBytes: 32
  },
  {
    kind: "struct",
    name: "BitmapGroupSequence",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "first bitmap index",
        type: "Index",
        struct: "Bitmap"
      },
      {
        kind: "field",
        name: "bitmap count",
        type: "uint16"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "sprites",
        type: "TagReflexive",
        struct: "BitmapGroupSprite",
        maximum: 64,
        extendedMaximum: 32767
      }
    ],
    sizeBytes: 64
  },
  {
    kind: "struct",
    name: "BitmapData",
    fields: [
      {
        kind: "field",
        name: "bitmap class",
        type: "TagFourCC"
      },
      {
        kind: "field",
        name: "width",
        type: "uint16"
      },
      {
        kind: "field",
        name: "height",
        type: "uint16"
      },
      {
        kind: "field",
        name: "depth",
        type: "uint16"
      },
      {
        kind: "field",
        name: "type",
        type: "BitmapDataType"
      },
      {
        kind: "field",
        name: "format",
        type: "BitmapDataFormat"
      },
      {
        kind: "field",
        name: "flags",
        type: "BitmapDataFlags",
        externalDataSibling: { offsetField: "pixel data offset", sizeField: "pixel data size", resourceMap: "bitmaps.map" },
        comment: "externalDataSibling: SOURCE (read 2026-08) invader/src/build/build_workload.cpp line ~1430 (embedded: pixel_data_offset = raw-data-region offset within THIS map) and invader/src/resource/resource.cpp line ~427 (external: pixel_data_offset = byte offset within bitmaps.map, flags |= BITMAP_DATA_FLAGS_FLAG_EXTERNAL). Confirmed against real bytes: every internal bitmap in ui.map has external=1 and pixel_data_offset exactly matches a bitmaps.map resource entry's dataOffset."
      },
      {
        kind: "field",
        name: "registration point",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "mipmap count",
        type: "uint16"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "pixel data offset",
        type: "uint32"
      },
      {
        kind: "field",
        name: "pixel data size",
        type: "uint32",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "bitmap tag id",
        type: "TagID",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "pointer",
        type: "Pointer",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "pad",
        size: 4
      }
    ],
    sizeBytes: 48
  },
  {
    kind: "struct",
    name: "Bitmap",
    fields: [
      {
        kind: "field",
        name: "type",
        type: "BitmapType"
      },
      {
        kind: "field",
        name: "encoding format",
        type: "BitmapFormat",
        comment: "Format to use when generating the tag"
      },
      {
        kind: "field",
        name: "usage",
        type: "BitmapUsage"
      },
      {
        kind: "field",
        name: "flags",
        type: "BitmapFlags"
      },
      {
        kind: "field",
        name: "detail fade factor",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "sharpen amount",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "bump height",
        type: "Fraction"
      },
      {
        kind: "field",
        name: "sprite budget size",
        type: "BitmapSpriteBudgetSize"
      },
      {
        kind: "field",
        name: "sprite budget count",
        type: "uint16"
      },
      {
        kind: "field",
        name: "color plate width",
        type: "uint16",
        nonCached: true
      },
      {
        kind: "field",
        name: "color plate height",
        type: "uint16",
        nonCached: true
      },
      {
        kind: "field",
        name: "compressed color plate data",
        type: "TagDataOffset",
        maximum: 1073741824,
        nonCached: true
      },
      {
        kind: "field",
        name: "processed pixel data",
        type: "TagDataOffset",
        maximum: 1073741824,
        nonCached: true
      },
      {
        kind: "field",
        name: "blur filter size",
        type: "float",
        maximum: 10
      },
      {
        kind: "field",
        name: "alpha bias",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "mipmap count",
        type: "uint16"
      },
      {
        kind: "field",
        name: "sprite usage",
        type: "BitmapSpriteUsage"
      },
      {
        kind: "field",
        name: "sprite spacing",
        type: "uint16"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "bitmap group sequence",
        type: "TagReflexive",
        struct: "BitmapGroupSequence",
        maximum: 256,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "bitmap data",
        type: "TagReflexive",
        struct: "BitmapData",
        maximum: 65536
      }
    ],
    tagClass: "bitmap",
    sizeBytes: 108
  }
];

// ../core/src/map/definitions/groups/camera_track.json
var camera_track_default = [
  {
    kind: "struct",
    name: "CameraTrackControlPoint",
    fields: [
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "orientation",
        type: "Quaternion"
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    sizeBytes: 60
  },
  {
    kind: "struct",
    name: "CameraTrack",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "IsUnusedFlag"
      },
      {
        kind: "field",
        name: "control points",
        type: "TagReflexive",
        struct: "CameraTrackControlPoint",
        maximum: 16
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    tagClass: "camera_track",
    sizeBytes: 48
  }
];

// ../core/src/map/definitions/groups/color_table.json
var color_table_default = [
  {
    kind: "struct",
    name: "ColorTableColor",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "color",
        type: "ColorARGB"
      }
    ],
    sizeBytes: 48
  },
  {
    kind: "struct",
    name: "ColorTable",
    fields: [
      {
        kind: "field",
        name: "colors",
        type: "TagReflexive",
        struct: "ColorTableColor",
        maximum: 512
      }
    ],
    tagClass: "color_table",
    sizeBytes: 12
  }
];

// ../core/src/map/definitions/groups/continuous_damage_effect.json
var continuous_damage_effect_default = [
  {
    kind: "struct",
    name: "ContinuousDamageEffect",
    fields: [
      {
        kind: "field",
        name: "radius",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "cutoff scale",
        type: "float",
        maximum: 1
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "low frequency vibrate frequency",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "high frequency vibrate frequency",
        type: "float",
        maximum: 1
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "camera shaking random translation",
        type: "float"
      },
      {
        kind: "field",
        name: "camera shaking random rotation",
        type: "Angle"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "camera shaking wobble function",
        type: "WaveFunction"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "camera shaking wobble period",
        type: "float"
      },
      {
        kind: "field",
        name: "camera shaking wobble weight",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "pad",
        size: 160
      },
      {
        kind: "field",
        name: "damage side effect",
        type: "DamageEffectSideEffect"
      },
      {
        kind: "field",
        name: "damage category",
        type: "DamageEffectCategory"
      },
      {
        kind: "field",
        name: "damage flags",
        type: "DamageEffectDamageFlags"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "damage lower bound",
        type: "float"
      },
      {
        kind: "field",
        name: "damage upper bound",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "damage vehicle passthrough penalty",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "damage stun",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "damage maximum stun",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "damage stun time",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "damage instantaneous acceleration",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "dirt",
        type: "float"
      },
      {
        kind: "field",
        name: "sand",
        type: "float"
      },
      {
        kind: "field",
        name: "stone",
        type: "float"
      },
      {
        kind: "field",
        name: "snow",
        type: "float"
      },
      {
        kind: "field",
        name: "wood",
        type: "float"
      },
      {
        kind: "field",
        name: "metal hollow",
        type: "float"
      },
      {
        kind: "field",
        name: "metal thin",
        type: "float"
      },
      {
        kind: "field",
        name: "metal thick",
        type: "float"
      },
      {
        kind: "field",
        name: "rubber",
        type: "float"
      },
      {
        kind: "field",
        name: "glass",
        type: "float"
      },
      {
        kind: "field",
        name: "force field",
        type: "float"
      },
      {
        kind: "field",
        name: "grunt",
        type: "float"
      },
      {
        kind: "field",
        name: "hunter armor",
        type: "float"
      },
      {
        kind: "field",
        name: "hunter skin",
        type: "float"
      },
      {
        kind: "field",
        name: "elite",
        type: "float"
      },
      {
        kind: "field",
        name: "jackal",
        type: "float"
      },
      {
        kind: "field",
        name: "jackal energy shield",
        type: "float"
      },
      {
        kind: "field",
        name: "engineer skin",
        type: "float"
      },
      {
        kind: "field",
        name: "engineer force field",
        type: "float"
      },
      {
        kind: "field",
        name: "flood combat form",
        type: "float"
      },
      {
        kind: "field",
        name: "flood carrier form",
        type: "float"
      },
      {
        kind: "field",
        name: "cyborg armor",
        type: "float"
      },
      {
        kind: "field",
        name: "cyborg energy shield",
        type: "float"
      },
      {
        kind: "field",
        name: "human armor",
        type: "float"
      },
      {
        kind: "field",
        name: "human skin",
        type: "float"
      },
      {
        kind: "field",
        name: "sentinel",
        type: "float"
      },
      {
        kind: "field",
        name: "monitor",
        type: "float"
      },
      {
        kind: "field",
        name: "plastic",
        type: "float"
      },
      {
        kind: "field",
        name: "water",
        type: "float"
      },
      {
        kind: "field",
        name: "leaves",
        type: "float"
      },
      {
        kind: "field",
        name: "elite energy shield",
        type: "float"
      },
      {
        kind: "field",
        name: "ice",
        type: "float"
      },
      {
        kind: "field",
        name: "hunter shield",
        type: "float"
      },
      {
        kind: "pad",
        size: 28
      }
    ],
    tagClass: "continuous_damage_effect",
    sizeBytes: 512
  }
];

// ../core/src/map/definitions/groups/contrail.json
var contrail_default = [
  {
    kind: "enum",
    name: "ContrailRenderType",
    options: [
      "vertical orientation",
      "horizontal orientation",
      "media mapped",
      "ground mapped",
      "viewer facing",
      "double marker linked"
    ]
  },
  {
    kind: "bitfield",
    name: "ContrailPointStateScaleFlags",
    width: 32,
    fields: [
      "duration",
      "duration delta",
      "transition duration",
      "transition duration delta",
      "width",
      "color"
    ]
  },
  {
    kind: "bitfield",
    name: "ContrailFlags",
    width: 16,
    fields: [
      "first point unfaded",
      "last point unfaded",
      "points start pinned to media",
      "points start pinned to ground",
      "points always pinned to media",
      "points always pinned to ground",
      "edge effect fades slowly"
    ]
  },
  {
    kind: "bitfield",
    name: "ContrailScaleFlags",
    width: 16,
    fields: [
      "point generation rate",
      "point velocity",
      "point velocity delta",
      "point velocity cone angle",
      "inherited velocity fraction",
      "sequence animation rate",
      "texture scale u",
      "texture scale v",
      "texture animation u",
      "texture animation v"
    ]
  },
  {
    kind: "struct",
    name: "ContrailPointState",
    fields: [
      {
        kind: "field",
        name: "duration",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "transition duration",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "physics",
        type: "TagDependency",
        classes: [
          "point_physics"
        ]
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "width",
        type: "float"
      },
      {
        kind: "field",
        name: "color lower bound",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "color upper bound",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "scale flags",
        type: "ContrailPointStateScaleFlags"
      }
    ],
    sizeBytes: 104
  },
  {
    kind: "struct",
    name: "Contrail",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "ContrailFlags"
      },
      {
        kind: "field",
        name: "scale flags",
        type: "ContrailScaleFlags"
      },
      {
        kind: "field",
        name: "point generation rate",
        type: "float"
      },
      {
        kind: "field",
        name: "point velocity",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "point velocity cone angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "inherited velocity fraction",
        type: "Fraction"
      },
      {
        kind: "field",
        name: "render type",
        type: "ContrailRenderType"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "texture repeats u",
        type: "float"
      },
      {
        kind: "field",
        name: "texture repeats v",
        type: "float"
      },
      {
        kind: "field",
        name: "texture animation u",
        type: "float"
      },
      {
        kind: "field",
        name: "texture animation v",
        type: "float"
      },
      {
        kind: "field",
        name: "animation rate",
        type: "float"
      },
      {
        kind: "field",
        name: "bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "first sequence index",
        type: "Index"
      },
      {
        kind: "field",
        name: "sequence count",
        type: "int16"
      },
      {
        kind: "pad",
        size: 64
      },
      {
        kind: "pad",
        size: 36
      },
      {
        kind: "field",
        name: "shader type",
        type: "ShaderType",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "shader flags",
        type: "ParticleShaderFlags"
      },
      {
        kind: "field",
        name: "framebuffer blend function",
        type: "FramebufferBlendFunction"
      },
      {
        kind: "field",
        name: "framebuffer fade mode",
        type: "FramebufferFadeMode"
      },
      {
        kind: "field",
        name: "bitmap flags",
        type: "IsUnfilteredFlag"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "secondary bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "anchor",
        type: "ParticleAnchor"
      },
      {
        kind: "field",
        name: "secondary bitmap flags",
        type: "IsUnfilteredFlag"
      },
      {
        kind: "field",
        name: "u animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "u animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "u animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "u animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "u animation scale",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "v animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "v animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation scale",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "rotation animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "rotation animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation scale",
        type: "Angle"
      },
      {
        kind: "field",
        name: "rotation animation center",
        type: "Point2D"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "zsprite radius scale",
        type: "float"
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "point states",
        type: "TagReflexive",
        struct: "ContrailPointState",
        maximum: 16
      }
    ],
    tagClass: "contrail",
    sizeBytes: 324
  }
];

// ../core/src/map/definitions/groups/damage_effect.json
var damage_effect_default = [
  {
    kind: "enum",
    name: "DamageEffectScreenFlashType",
    options: [
      "none",
      "lighten",
      "darken",
      "max",
      "min",
      "invert",
      "tint"
    ]
  },
  {
    kind: "enum",
    name: "DamageEffectScreenFlashPriority",
    options: [
      "low",
      "medium",
      "high"
    ]
  },
  {
    kind: "enum",
    name: "DamageEffectSideEffect",
    options: [
      "none",
      "harmless",
      "lethal to the unsuspecting",
      "emp"
    ]
  },
  {
    kind: "enum",
    name: "DamageEffectCategory",
    options: [
      "none",
      "falling",
      "bullet",
      "grenade",
      "high explosive",
      "sniper",
      "melee",
      "flame",
      "mounted weapon",
      "vehicle",
      "plasma",
      "needle",
      "shotgun"
    ]
  },
  {
    kind: "bitfield",
    name: "DamageEffectDamageFlags",
    width: 32,
    fields: [
      "does not hurt owner",
      "can cause headshots",
      "pings resistant units",
      "does not hurt friends",
      "does not ping units",
      "detonates explosives",
      "only hurts shields",
      "causes flaming death",
      "damage indicators always point down",
      "skips shields",
      "only hurts one infection form",
      "can cause multiplayer headshots",
      "infection form pop",
      "ignore seat scale for dir dmg",
      "forces hard ping",
      "does not hurt players",
      "use 3d instantaneous acceleration",
      "allow any non-zero acceleration value"
    ]
  },
  {
    kind: "bitfield",
    name: "DamageEffectFlags",
    width: 32,
    fields: [
      "do not scale damage by distance"
    ]
  },
  {
    kind: "struct",
    name: "DamageEffect",
    fields: [
      {
        kind: "field",
        name: "radius",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "cutoff scale",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "flags",
        type: "DamageEffectFlags"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "type",
        type: "DamageEffectScreenFlashType"
      },
      {
        kind: "field",
        name: "priority",
        type: "DamageEffectScreenFlashPriority"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "duration",
        type: "float"
      },
      {
        kind: "field",
        name: "fade function",
        type: "FunctionType"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "maximum intensity",
        type: "float",
        maximum: 1
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "color",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "low frequency vibrate frequency",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "low frequency vibrate duration",
        type: "float"
      },
      {
        kind: "field",
        name: "low frequency vibrate fade function",
        type: "FunctionType"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "high frequency vibrate frequency",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "high frequency vibrate duration",
        type: "float"
      },
      {
        kind: "field",
        name: "high frequency vibrate fade function",
        type: "FunctionType"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "temporary camera impulse duration",
        type: "float"
      },
      {
        kind: "field",
        name: "temporary camera impulse fade function",
        type: "FunctionType"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "temporary camera impulse rotation",
        type: "Angle"
      },
      {
        kind: "field",
        name: "temporary camera impulse pushback",
        type: "float"
      },
      {
        kind: "field",
        name: "jitter",
        type: "float",
        bounds: true
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "permanent camera impulse angle",
        type: "Angle"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "camera shaking duration",
        type: "float"
      },
      {
        kind: "field",
        name: "camera shaking falloff function",
        type: "FunctionType"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "camera shaking random translation",
        type: "float"
      },
      {
        kind: "field",
        name: "camera shaking random rotation",
        type: "Angle"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "camera shaking wobble function",
        type: "WaveFunction"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "camera shaking wobble period",
        type: "float"
      },
      {
        kind: "field",
        name: "camera shaking wobble weight",
        type: "float"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "sound",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "pad",
        size: 108
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "breaking effect forward velocity",
        type: "float"
      },
      {
        kind: "field",
        name: "breaking effect forward radius",
        type: "float"
      },
      {
        kind: "field",
        name: "breaking effect forward exponent",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "breaking effect outward velocity",
        type: "float"
      },
      {
        kind: "field",
        name: "breaking effect outward radius",
        type: "float"
      },
      {
        kind: "field",
        name: "breaking effect outward exponent",
        type: "float"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "damage side effect",
        type: "DamageEffectSideEffect"
      },
      {
        kind: "field",
        name: "damage category",
        type: "DamageEffectCategory"
      },
      {
        kind: "field",
        name: "damage flags",
        type: "DamageEffectDamageFlags"
      },
      {
        kind: "field",
        name: "damage aoe core radius",
        type: "float"
      },
      {
        kind: "field",
        name: "damage lower bound",
        type: "float"
      },
      {
        kind: "field",
        name: "damage upper bound",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "damage vehicle passthrough penalty",
        type: "float"
      },
      {
        kind: "field",
        name: "damage active camouflage damage",
        type: "float"
      },
      {
        kind: "field",
        name: "damage stun",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "damage maximum stun",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "damage stun time",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "damage instantaneous acceleration",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "dirt",
        type: "float"
      },
      {
        kind: "field",
        name: "sand",
        type: "float"
      },
      {
        kind: "field",
        name: "stone",
        type: "float"
      },
      {
        kind: "field",
        name: "snow",
        type: "float"
      },
      {
        kind: "field",
        name: "wood",
        type: "float"
      },
      {
        kind: "field",
        name: "metal hollow",
        type: "float"
      },
      {
        kind: "field",
        name: "metal thin",
        type: "float"
      },
      {
        kind: "field",
        name: "metal thick",
        type: "float"
      },
      {
        kind: "field",
        name: "rubber",
        type: "float"
      },
      {
        kind: "field",
        name: "glass",
        type: "float"
      },
      {
        kind: "field",
        name: "force field",
        type: "float"
      },
      {
        kind: "field",
        name: "grunt",
        type: "float"
      },
      {
        kind: "field",
        name: "hunter armor",
        type: "float"
      },
      {
        kind: "field",
        name: "hunter skin",
        type: "float"
      },
      {
        kind: "field",
        name: "elite",
        type: "float"
      },
      {
        kind: "field",
        name: "jackal",
        type: "float"
      },
      {
        kind: "field",
        name: "jackal energy shield",
        type: "float"
      },
      {
        kind: "field",
        name: "engineer skin",
        type: "float"
      },
      {
        kind: "field",
        name: "engineer force field",
        type: "float"
      },
      {
        kind: "field",
        name: "flood combat form",
        type: "float"
      },
      {
        kind: "field",
        name: "flood carrier form",
        type: "float"
      },
      {
        kind: "field",
        name: "cyborg armor",
        type: "float"
      },
      {
        kind: "field",
        name: "cyborg energy shield",
        type: "float"
      },
      {
        kind: "field",
        name: "human armor",
        type: "float"
      },
      {
        kind: "field",
        name: "human skin",
        type: "float"
      },
      {
        kind: "field",
        name: "sentinel",
        type: "float"
      },
      {
        kind: "field",
        name: "monitor",
        type: "float"
      },
      {
        kind: "field",
        name: "plastic",
        type: "float"
      },
      {
        kind: "field",
        name: "water",
        type: "float"
      },
      {
        kind: "field",
        name: "leaves",
        type: "float"
      },
      {
        kind: "field",
        name: "elite energy shield",
        type: "float"
      },
      {
        kind: "field",
        name: "ice",
        type: "float"
      },
      {
        kind: "field",
        name: "hunter shield",
        type: "float"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "pad",
        size: 16
      }
    ],
    tagClass: "damage_effect",
    sizeBytes: 672
  }
];

// ../core/src/map/definitions/groups/decal.json
var decal_default = [
  {
    kind: "enum",
    name: "DecalType",
    options: [
      "scratch",
      "splatter",
      "burn",
      "painted sign"
    ]
  },
  {
    kind: "enum",
    name: "DecalLayer",
    options: [
      "primary",
      "secondary",
      "light",
      "alpha tested",
      "water"
    ]
  },
  {
    kind: "bitfield",
    name: "DecalFlags",
    width: 16,
    fields: [
      "geometry inherited by next decal in chain",
      "interpolate color in hsv",
      "more colors",
      "no random rotation",
      "water effect",
      "sapien snap to axis",
      "sapien incremental counter",
      "animation loop",
      "preserve aspect",
      "disabled by blood setting",
      "sprite scale bug fix"
    ]
  },
  {
    kind: "struct",
    name: "Decal",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "DecalFlags"
      },
      {
        kind: "field",
        name: "type",
        type: "DecalType"
      },
      {
        kind: "field",
        name: "layer",
        type: "DecalLayer"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "next decal in chain",
        type: "TagDependency",
        classes: [
          "decal"
        ]
      },
      {
        kind: "field",
        name: "radius",
        type: "float",
        bounds: true
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "intensity",
        type: "Fraction",
        maximum: 1,
        bounds: true
      },
      {
        kind: "field",
        name: "color lower bounds",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "color upper bounds",
        type: "ColorRGB"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "animation loop frame",
        type: "int16"
      },
      {
        kind: "field",
        name: "animation speed",
        type: "int16"
      },
      {
        kind: "pad",
        size: 28
      },
      {
        kind: "field",
        name: "lifetime",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "decay time",
        type: "float",
        bounds: true
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "pad",
        size: 40
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "framebuffer blend function",
        type: "FramebufferBlendFunction"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "maximum sprite extent",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "pad",
        size: 8
      }
    ],
    tagClass: "decal",
    sizeBytes: 268
  }
];

// ../core/src/map/definitions/groups/detail_object_collection.json
var detail_object_collection_default = [
  {
    kind: "enum",
    name: "DetailObjectCollectionType",
    options: [
      "screen facing",
      "viewer facing"
    ]
  },
  {
    kind: "bitfield",
    name: "DetailObjectCollectionTypeFlags",
    width: 8,
    fields: [
      "unused a",
      "unused b",
      "interpolate color in hsv",
      "more colors"
    ]
  },
  {
    kind: "struct",
    name: "DetailObjectCollectionObjectType",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "sequence index",
        type: "uint8"
      },
      {
        kind: "field",
        name: "flags",
        type: "DetailObjectCollectionTypeFlags"
      },
      {
        kind: "field",
        name: "first sprite index",
        type: "uint8",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "sprite count",
        type: "uint8",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "color override factor",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "near fade distance",
        type: "float"
      },
      {
        kind: "field",
        name: "far fade distance",
        type: "float"
      },
      {
        kind: "field",
        name: "size",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "minimum color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "maximum color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "ambient color",
        type: "ColorARGBInt"
      },
      {
        kind: "pad",
        size: 4
      }
    ],
    sizeBytes: 96
  },
  {
    kind: "struct",
    name: "DetailObjectCollection",
    fields: [
      {
        kind: "field",
        name: "collection type",
        type: "DetailObjectCollectionType"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "global z offset",
        type: "float"
      },
      {
        kind: "pad",
        size: 44
      },
      {
        kind: "field",
        name: "sprite plate",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "types",
        type: "TagReflexive",
        struct: "DetailObjectCollectionObjectType",
        maximum: 16
      },
      {
        kind: "pad",
        size: 48
      }
    ],
    tagClass: "detail_object_collection",
    sizeBytes: 128
  }
];

// ../core/src/map/definitions/groups/device.json
var device_default = [
  {
    kind: "enum",
    name: "DeviceIn",
    options: [
      "none",
      "power",
      "change in power",
      "position",
      "change in position",
      "locked",
      "delay"
    ]
  },
  {
    kind: "bitfield",
    name: "DeviceFlags",
    width: 32,
    fields: [
      "position loops",
      "position not interpolated"
    ]
  },
  {
    kind: "struct",
    name: "Device",
    fields: [
      {
        kind: "field",
        name: "device flags",
        type: "DeviceFlags"
      },
      {
        kind: "field",
        name: "power transition time",
        type: "float"
      },
      {
        kind: "field",
        name: "power acceleration time",
        type: "float"
      },
      {
        kind: "field",
        name: "position transition time",
        type: "float"
      },
      {
        kind: "field",
        name: "position acceleration time",
        type: "float"
      },
      {
        kind: "field",
        name: "depowered position transition time",
        type: "float"
      },
      {
        kind: "field",
        name: "depowered position acceleration time",
        type: "float"
      },
      {
        kind: "field",
        name: "device a in",
        type: "DeviceIn"
      },
      {
        kind: "field",
        name: "device b in",
        type: "DeviceIn"
      },
      {
        kind: "field",
        name: "device c in",
        type: "DeviceIn"
      },
      {
        kind: "field",
        name: "device d in",
        type: "DeviceIn"
      },
      {
        kind: "field",
        name: "open",
        type: "TagDependency",
        classes: [
          "sound",
          "effect"
        ]
      },
      {
        kind: "field",
        name: "close",
        type: "TagDependency",
        classes: [
          "sound",
          "effect"
        ]
      },
      {
        kind: "field",
        name: "opened",
        type: "TagDependency",
        classes: [
          "sound",
          "effect"
        ]
      },
      {
        kind: "field",
        name: "closed",
        type: "TagDependency",
        classes: [
          "sound",
          "effect"
        ]
      },
      {
        kind: "field",
        name: "depowered",
        type: "TagDependency",
        classes: [
          "sound",
          "effect"
        ]
      },
      {
        kind: "field",
        name: "repowered",
        type: "TagDependency",
        classes: [
          "sound",
          "effect"
        ]
      },
      {
        kind: "field",
        name: "delay time",
        type: "float"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "delay effect",
        type: "TagDependency",
        classes: [
          "sound",
          "effect"
        ]
      },
      {
        kind: "field",
        name: "automatic activation radius",
        type: "float"
      },
      {
        kind: "pad",
        size: 84
      },
      {
        kind: "field",
        name: "inverse power acceleration time",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "inverse power transition time",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "inverse depowered position acceleration time",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "inverse depowered position transition time",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "inverse position acceleration time",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "inverse position transition time",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "delay time ticks",
        type: "float",
        cacheOnly: true
      }
    ],
    inherits: "Object",
    tagClass: "device",
    sizeBytes: 656
  }
];

// ../core/src/map/definitions/groups/device_control.json
var device_control_default = [
  {
    kind: "enum",
    name: "DeviceType",
    options: [
      "toggle switch",
      "on button",
      "off button",
      "call button"
    ]
  },
  {
    kind: "enum",
    name: "DeviceTriggersWhen",
    options: [
      "touched by player",
      "destroyed"
    ]
  },
  {
    kind: "struct",
    name: "DeviceControl",
    fields: [
      {
        kind: "field",
        name: "type",
        type: "DeviceType"
      },
      {
        kind: "field",
        name: "triggers when",
        type: "DeviceTriggersWhen"
      },
      {
        kind: "field",
        name: "call value",
        type: "float"
      },
      {
        kind: "pad",
        size: 80
      },
      {
        kind: "field",
        name: "on",
        type: "TagDependency",
        classes: [
          "sound",
          "effect"
        ]
      },
      {
        kind: "field",
        name: "off",
        type: "TagDependency",
        classes: [
          "sound",
          "effect"
        ]
      },
      {
        kind: "field",
        name: "deny",
        type: "TagDependency",
        classes: [
          "sound",
          "effect"
        ]
      }
    ],
    inherits: "Device",
    tagClass: "device_control",
    sizeBytes: 792
  }
];

// ../core/src/map/definitions/groups/device_light_fixture.json
var device_light_fixture_default = [
  {
    kind: "struct",
    name: "DeviceLightFixture",
    fields: [
      {
        kind: "pad",
        size: 64
      }
    ],
    inherits: "Device",
    tagClass: "device_light_fixture",
    sizeBytes: 720
  }
];

// ../core/src/map/definitions/groups/device_machine.json
var device_machine_default = [
  {
    kind: "enum",
    name: "MachineType",
    options: [
      "door",
      "platform",
      "gear"
    ]
  },
  {
    kind: "enum",
    name: "MachineCollisionResponse",
    options: [
      "pause until crushed",
      "reverse directions"
    ]
  },
  {
    kind: "bitfield",
    name: "MachineFlags",
    width: 16,
    fields: [
      "pathfinding obstacle",
      "but not when open",
      "elevator"
    ]
  },
  {
    kind: "struct",
    name: "DeviceMachine",
    fields: [
      {
        kind: "field",
        name: "machine type",
        type: "MachineType"
      },
      {
        kind: "field",
        name: "machine flags",
        type: "MachineFlags"
      },
      {
        kind: "field",
        name: "door open time",
        type: "float"
      },
      {
        kind: "pad",
        size: 80
      },
      {
        kind: "field",
        name: "collision response",
        type: "MachineCollisionResponse"
      },
      {
        kind: "field",
        name: "elevator node",
        type: "Index"
      },
      {
        kind: "pad",
        size: 52
      },
      {
        kind: "field",
        name: "door open time ticks",
        type: "uint32",
        cacheOnly: true
      }
    ],
    inherits: "Device",
    tagClass: "device_machine",
    sizeBytes: 804
  }
];

// ../core/src/map/definitions/groups/dialogue.json
var dialogue_default = [
  {
    kind: "struct",
    name: "Dialogue",
    fields: [
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "idle noncombat",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "idle combat",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "idle flee",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "pain body minor",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "pain body major",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "pain shield",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "pain falling",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "scream fear",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "scream pain",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "maimed limb",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "maimed head",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "death quiet",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "death violent",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "death falling",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "death agonizing",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "death instant",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "death flying",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "damaged friend",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "damaged friend player",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "damaged enemy",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "damaged enemy cm",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "hurt friend",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "hurt friend re",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "hurt friend player",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "hurt enemy",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "hurt enemy re",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "hurt enemy cm",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "hurt enemy bullet",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "hurt enemy needler",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "hurt enemy plasma",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "hurt enemy sniper",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "hurt enemy grenade",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "hurt enemy explosion",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "hurt enemy melee",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "hurt enemy flame",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "hurt enemy shotgun",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "hurt enemy vehicle",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "hurt enemy mountedweapon",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "killed friend",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed friend cm",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed friend player",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed friend player cm",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed enemy",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed enemy cm",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed enemy player",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed enemy player cm",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed enemy covenant",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed enemy covenant cm",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed enemy floodcombat",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed enemy floodcombat cm",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed enemy floodcarrier",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed enemy floodcarrier cm",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed enemy sentinel",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed enemy sentinel cm",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed enemy bullet",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed enemy needler",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed enemy plasma",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed enemy sniper",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed enemy grenade",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed enemy explosion",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed enemy melee",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed enemy flame",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed enemy shotgun",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed enemy vehicle",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killed enemy mountedweapon",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "killing spree",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "player kill cm",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "player kill bullet cm",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "player kill needler cm",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "player kill plasma cm",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "player kill sniper cm",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "anyone kill grenade cm",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "player kill explosion cm",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "player kill melee cm",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "player kill flame cm",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "player kill shotgun cm",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "player kill vehicle cm",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "player kill mountedweapon cm",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "player killling spree cm",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "friend died",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "friend player died",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "friend killed by friend",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "friend killed by friendly player",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "friend killed by enemy",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "friend killed by enemy player",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "friend killed by covenant",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "friend killed by flood",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "friend killed by sentinel",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "friend betrayed",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "new combat alone",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "new enemy recent combat",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "old enemy sighted",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "unexpected enemy",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "dead friend found",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "alliance broken",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "alliance reformed",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "grenade throwing",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "grenade sighted",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "grenade startle",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "grenade danger enemy",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "grenade danger self",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "grenade danger friend",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "new combat group re",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "new combat nearby re",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "alert friend",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "alert friend re",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "alert lost contact",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "alert lost contact re",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "blocked",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "blocked re",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "search start",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "search query",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "search query re",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "search report",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "search abandon",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "search group abandon",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "group uncover",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "group uncover re",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "advance",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "advance re",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "retreat",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "retreat re",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "cover",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "sighted friend player",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "shooting",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "shooting vehicle",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "shooting berserk",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "shooting group",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "shooting traitor",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "taunt",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "taunt re",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "flee",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "flee re",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "flee leader died",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "attempted flee",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "attempted flee re",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "lost contact",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "hiding finished",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "vehicle entry",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "vehicle exit",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "vehicle woohoo",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "vehicle scared",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "vehicle collision",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "partially sighted",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "nothing there",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "pleading",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "surprise",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "berserk",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "melee attack",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "dive",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "uncover exclamation",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "leap attack",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "resurrection",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "celebration",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "check body enemy",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "check body friend",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "shooting dead enemy",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "shooting dead enemy player",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "alone",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "unscathed",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "seriously wounded",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "seriously wounded re",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "massacre",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "massacre re",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "rout",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "rout re",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 752
      }
    ],
    tagClass: "dialogue",
    sizeBytes: 4112
  }
];

// ../core/src/map/definitions/groups/effect.json
var effect_default = [
  {
    kind: "enum",
    name: "EffectCreateIn",
    options: [
      "any environment",
      "air only",
      "water only",
      "space only"
    ]
  },
  {
    kind: "enum",
    name: "EffectViolenceMode",
    options: [
      "either mode",
      "violent mode only",
      "nonviolent mode only"
    ]
  },
  {
    kind: "enum",
    name: "EffectCreate",
    options: [
      "independent of camera mode",
      "only in first person",
      "only in third person",
      "in first person if possible"
    ]
  },
  {
    kind: "enum",
    name: "EffectDistributionFunction",
    options: [
      "start",
      "end",
      "constant",
      "buildup",
      "falloff",
      "buildup and falloff"
    ]
  },
  {
    kind: "bitfield",
    name: "EffectPartFlags",
    width: 16,
    fields: [
      "face down regardless of location decals",
      "unused",
      "make effect work"
    ]
  },
  {
    kind: "bitfield",
    name: "EffectPartScalesValues",
    width: 32,
    fields: [
      "velocity",
      "velocity delta",
      "velocity cone angle",
      "angular velocity",
      "angular velocity delta",
      "type specific scale"
    ]
  },
  {
    kind: "bitfield",
    name: "EffectParticleFlags",
    width: 32,
    fields: [
      "stay attached to marker",
      "random initial angle",
      "tint from object color",
      "interpolate tint as hsv",
      "across the long hue path"
    ]
  },
  {
    kind: "bitfield",
    name: "EffectParticleScalesValues",
    width: 32,
    fields: [
      "velocity",
      "velocity delta",
      "velocity cone angle",
      "angular velocity",
      "angular velocity delta",
      "count",
      "count delta",
      "distribution radius",
      "distribution radius delta",
      "particle radius",
      "particle radius delta",
      "tint"
    ]
  },
  {
    kind: "bitfield",
    name: "EffectFlags",
    width: 32,
    fields: [
      "deleted when attachment deactivates",
      "must be deterministic xbox",
      "must be deterministic pc",
      "disabled in anniversary by blood setting"
    ]
  },
  {
    kind: "struct",
    name: "EffectLocation",
    fields: [
      {
        kind: "field",
        name: "marker name",
        type: "TagString"
      }
    ],
    sizeBytes: 32
  },
  {
    kind: "struct",
    name: "EffectPart",
    fields: [
      {
        kind: "field",
        name: "create in",
        type: "EffectCreateIn"
      },
      {
        kind: "field",
        name: "violence mode",
        type: "EffectViolenceMode"
      },
      {
        kind: "field",
        name: "location",
        type: "Index",
        struct: "Effect"
      },
      {
        kind: "field",
        name: "flags",
        type: "EffectPartFlags"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "type class",
        type: "uint32",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "type",
        type: "TagDependency",
        classes: [
          "damage_effect",
          "object",
          "particle_system",
          "sound",
          "decal",
          "light"
        ]
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "velocity bounds",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "velocity cone angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "angular velocity bounds",
        type: "Angle",
        bounds: true
      },
      {
        kind: "field",
        name: "radius modifier bounds",
        type: "float",
        bounds: true
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "a scales values",
        type: "EffectPartScalesValues"
      },
      {
        kind: "field",
        name: "b scales values",
        type: "EffectPartScalesValues"
      }
    ],
    sizeBytes: 104
  },
  {
    kind: "struct",
    name: "EffectParticle",
    fields: [
      {
        kind: "field",
        name: "create in",
        type: "EffectCreateIn"
      },
      {
        kind: "field",
        name: "violence mode",
        type: "EffectViolenceMode"
      },
      {
        kind: "field",
        name: "create",
        type: "EffectCreate"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "location",
        type: "Index",
        struct: "Effect"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "relative direction",
        type: "Euler2D"
      },
      {
        kind: "field",
        name: "relative offset",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "relative direction vector",
        type: "Vector3D",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 40
      },
      {
        kind: "field",
        name: "particle type",
        type: "TagDependency",
        classes: [
          "particle"
        ]
      },
      {
        kind: "field",
        name: "flags",
        type: "EffectParticleFlags"
      },
      {
        kind: "field",
        name: "distribution function",
        type: "EffectDistributionFunction"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "count",
        type: "int16",
        bounds: true
      },
      {
        kind: "field",
        name: "distribution radius",
        type: "float",
        bounds: true
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "velocity",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "velocity cone angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "angular velocity",
        type: "Angle",
        bounds: true
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "radius",
        type: "float",
        bounds: true
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "tint lower bound",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "tint upper bound",
        type: "ColorARGB"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "a scales values",
        type: "EffectParticleScalesValues"
      },
      {
        kind: "field",
        name: "b scales values",
        type: "EffectParticleScalesValues"
      }
    ],
    sizeBytes: 232
  },
  {
    kind: "struct",
    name: "EffectEvent",
    fields: [
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "skip fraction",
        type: "Fraction"
      },
      {
        kind: "field",
        name: "delay bounds",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "duration bounds",
        type: "float",
        bounds: true
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "parts",
        type: "TagReflexive",
        struct: "EffectPart",
        maximum: 32
      },
      {
        kind: "field",
        name: "particles",
        type: "TagReflexive",
        struct: "EffectParticle",
        maximum: 32
      }
    ],
    sizeBytes: 68
  },
  {
    kind: "struct",
    name: "Effect",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "EffectFlags"
      },
      {
        kind: "field",
        name: "loop start event",
        type: "Index",
        struct: "Effect"
      },
      {
        kind: "field",
        name: "loop stop event",
        type: "Index",
        struct: "Effect"
      },
      {
        kind: "field",
        name: "maximum damage radius",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 28
      },
      {
        kind: "field",
        name: "locations",
        type: "TagReflexive",
        struct: "EffectLocation",
        maximum: 32
      },
      {
        kind: "field",
        name: "events",
        type: "TagReflexive",
        struct: "EffectEvent",
        maximum: 32
      }
    ],
    tagClass: "effect",
    sizeBytes: 64
  }
];

// ../core/src/map/definitions/groups/enum.json
var enum_default = [
  {
    kind: "enum",
    name: "FramebufferBlendFunction",
    options: [
      "alpha blend",
      "multiply",
      "double multiply",
      "add",
      "subtract",
      "component min",
      "component max",
      "alpha multiply add"
    ]
  },
  {
    kind: "enum",
    name: "FramebufferFadeMode",
    options: [
      "none",
      "fade when perpendicular",
      "fade when parallel"
    ]
  },
  {
    kind: "enum",
    name: "FunctionOut",
    options: [
      "none",
      "a out",
      "b out",
      "c out",
      "d out"
    ]
  },
  {
    kind: "enum",
    name: "WaveFunction",
    options: [
      "one",
      "zero",
      "cosine",
      "cosine variable period",
      "diagonal wave",
      "diagonal wave variable period",
      "slide",
      "slide variable period",
      "noise",
      "jitter",
      "wander",
      "spark"
    ]
  },
  {
    kind: "enum",
    name: "MaterialType",
    options: [
      "dirt",
      "sand",
      "stone",
      "snow",
      "wood",
      "metal hollow",
      "metal thin",
      "metal thick",
      "rubber",
      "glass",
      "force field",
      "grunt",
      "hunter armor",
      "hunter skin",
      "elite",
      "jackal",
      "jackal energy shield",
      "engineer skin",
      "engineer force field",
      "flood combat form",
      "flood carrier form",
      "cyborg armor",
      "cyborg energy shield",
      "human armor",
      "human skin",
      "sentinel",
      "monitor",
      "plastic",
      "water",
      "leaves",
      "elite energy shield",
      "ice",
      "hunter shield"
    ]
  },
  {
    kind: "enum",
    name: "FunctionType",
    options: [
      "linear",
      "early",
      "very early",
      "late",
      "very late",
      "cosine"
    ]
  },
  {
    kind: "enum",
    name: "FunctionBoundsMode",
    options: [
      "clip",
      "clip and normalize",
      "scale to fit"
    ]
  },
  {
    kind: "enum",
    name: "FunctionScaleBy",
    options: [
      "none",
      "a in",
      "b in",
      "c in",
      "d in",
      "a out",
      "b out",
      "c out",
      "d out"
    ]
  },
  {
    kind: "enum",
    name: "FunctionNameNullable",
    options: [
      "none",
      "a",
      "b",
      "c",
      "d"
    ]
  },
  {
    kind: "enum",
    name: "GrenadeType",
    options: [
      "human fragmentation",
      "covenant plasma",
      "grenade type 2",
      "grenade type 3"
    ]
  },
  {
    kind: "enum",
    name: "VertexType",
    options: [
      "structure bsp uncompressed rendered vertices",
      "structure bsp compressed rendered vertices",
      "structure bsp uncompressed lightmap vertices",
      "structure bsp compressed lightmap vertices",
      "model uncompressed",
      "model compressed"
    ]
  },
  {
    kind: "enum",
    name: "TriangleBufferType",
    options: [
      "triangle list",
      "triangle strip"
    ]
  }
];

// ../core/src/map/definitions/groups/equipment.json
var equipment_default = [
  {
    kind: "enum",
    name: "EquipmentPowerupType",
    options: [
      "none",
      "double speed",
      "over shield",
      "active camouflage",
      "full spectrum vision",
      "health",
      "grenade"
    ]
  },
  {
    kind: "struct",
    name: "Equipment",
    fields: [
      {
        kind: "field",
        name: "powerup type",
        type: "EquipmentPowerupType"
      },
      {
        kind: "field",
        name: "grenade type",
        type: "GrenadeType"
      },
      {
        kind: "field",
        name: "powerup time",
        type: "float"
      },
      {
        kind: "field",
        name: "pickup sound",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "pad",
        size: 144
      }
    ],
    inherits: "Item",
    tagClass: "equipment",
    sizeBytes: 944
  }
];

// ../core/src/map/definitions/groups/flag.json
var flag_default = [
  {
    kind: "enum",
    name: "FlagTrailingEdgeShape",
    options: [
      "flat",
      "concave triangular",
      "convex triangular",
      "trapezoid short top",
      "trapezoid short bottom"
    ]
  },
  {
    kind: "enum",
    name: "FlagAttachedEdgeShape",
    options: [
      "flat",
      "concave triangular"
    ]
  },
  {
    kind: "struct",
    name: "FlagAttachmentPoint",
    fields: [
      {
        kind: "field",
        name: "height to next attachment",
        type: "int16"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "marker name",
        type: "TagString"
      }
    ],
    sizeBytes: 52
  },
  {
    kind: "struct",
    name: "Flag",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "IsUnusedFlag"
      },
      {
        kind: "field",
        name: "trailing edge shape",
        type: "FlagTrailingEdgeShape"
      },
      {
        kind: "field",
        name: "trailing edge shape offset",
        type: "int16"
      },
      {
        kind: "field",
        name: "attached edge shape",
        type: "FlagAttachedEdgeShape"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "width",
        type: "int16"
      },
      {
        kind: "field",
        name: "height",
        type: "int16"
      },
      {
        kind: "field",
        name: "cell width",
        type: "float"
      },
      {
        kind: "field",
        name: "cell height",
        type: "float"
      },
      {
        kind: "field",
        name: "red flag shader",
        type: "TagDependency",
        classes: [
          "shader"
        ]
      },
      {
        kind: "field",
        name: "physics",
        type: "TagDependency",
        classes: [
          "point_physics"
        ]
      },
      {
        kind: "field",
        name: "wind noise",
        type: "float"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "blue flag shader",
        type: "TagDependency",
        classes: [
          "shader"
        ]
      },
      {
        kind: "field",
        name: "attachment points",
        type: "TagReflexive",
        struct: "FlagAttachmentPoint",
        maximum: 5
      }
    ],
    tagClass: "flag",
    sizeBytes: 96
  }
];

// ../core/src/map/definitions/groups/fog.json
var fog_default = [
  {
    kind: "bitfield",
    name: "FogFlags",
    width: 32,
    fields: [
      "is water",
      "atmosphere dominant",
      "fog screen only"
    ]
  },
  {
    kind: "bitfield",
    name: "FogScreenFlags",
    width: 16,
    fields: [
      "no environment multipass",
      "no model multipass",
      "no texture based falloff"
    ]
  },
  {
    kind: "struct",
    name: "Fog",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "FogFlags"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "pad",
        size: 76
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "maximum density",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "opaque distance",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "opaque depth",
        type: "float"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "distance to water plane",
        type: "float"
      },
      {
        kind: "field",
        name: "color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "flags 1",
        type: "FogScreenFlags"
      },
      {
        kind: "field",
        name: "layer count",
        type: "int16",
        maximum: 4
      },
      {
        kind: "field",
        name: "distance gradient",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "density gradient",
        type: "Fraction",
        maximum: 1,
        bounds: true
      },
      {
        kind: "field",
        name: "start distance from fog plane",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "screen layers color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "rotation multiplier",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "strafing multiplier",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "zoom multiplier",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "map scale",
        type: "float"
      },
      {
        kind: "field",
        name: "map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "animation period",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "wind velocity",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "wind period",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "wind acceleration weight",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "wind perpendicular weight",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "background sound",
        type: "TagDependency",
        classes: [
          "sound_looping"
        ]
      },
      {
        kind: "field",
        name: "sound environment",
        type: "TagDependency",
        classes: [
          "sound_environment"
        ]
      },
      {
        kind: "pad",
        size: 120
      }
    ],
    tagClass: "fog",
    sizeBytes: 396
  }
];

// ../core/src/map/definitions/groups/font.json
var font_default = [
  {
    kind: "bitfield",
    name: "FontFlags",
    width: 32,
    fields: [
      "disable mcc font override"
    ]
  },
  {
    kind: "struct",
    name: "FontCharacterIndex",
    fields: [
      {
        kind: "field",
        name: "character index",
        type: "Index",
        struct: "Font"
      }
    ],
    sizeBytes: 2
  },
  {
    kind: "struct",
    name: "FontCharacterTables",
    fields: [
      {
        kind: "field",
        name: "character table",
        type: "TagReflexive",
        struct: "FontCharacterIndex",
        maximum: 256
      }
    ],
    sizeBytes: 12
  },
  {
    kind: "enum",
    name: "FontEncodingType",
    options: [
      "unicode",
      "cjk"
    ]
  },
  {
    kind: "struct",
    name: "FontCharacter",
    fields: [
      {
        kind: "field",
        name: "character",
        type: "uint16"
      },
      {
        kind: "field",
        name: "character width",
        type: "int16"
      },
      {
        kind: "field",
        name: "bitmap width",
        type: "int16"
      },
      {
        kind: "field",
        name: "bitmap height",
        type: "int16"
      },
      {
        kind: "field",
        name: "bitmap origin x",
        type: "int16"
      },
      {
        kind: "field",
        name: "bitmap origin y",
        type: "int16"
      },
      {
        kind: "field",
        name: "hardware character index",
        type: "uint16"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "pixels offset",
        type: "int32"
      }
    ],
    sizeBytes: 20
  },
  {
    kind: "struct",
    name: "Font",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "FontFlags"
      },
      {
        kind: "field",
        name: "ascending height",
        type: "int16"
      },
      {
        kind: "field",
        name: "descending height",
        type: "int16"
      },
      {
        kind: "field",
        name: "leading height",
        type: "int16"
      },
      {
        kind: "field",
        name: "leading width",
        type: "int16",
        cacheOnly: true,
        comment: "you can't actually set this; it gets overridden with (ascending height + descending height) / 5 on map build"
      },
      {
        kind: "field",
        name: "encoding type",
        type: "FontEncodingType",
        cacheOnly: true,
        comment: "only used in the jp/kr/tw xbox versions"
      },
      {
        kind: "field",
        name: "cjk character codes",
        type: "uint16",
        cacheOnly: true,
        comment: "only set if encoding type is cjk. equal to 256 + the number of font characters with a character > 256"
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "character tables",
        type: "TagReflexive",
        struct: "FontCharacterTables",
        maximum: 256,
        cacheOnly: true
      },
      {
        kind: "field",
        name: "bold",
        type: "TagDependency",
        classes: [
          "font"
        ]
      },
      {
        kind: "field",
        name: "italic",
        type: "TagDependency",
        classes: [
          "font"
        ]
      },
      {
        kind: "field",
        name: "condense",
        type: "TagDependency",
        classes: [
          "font"
        ]
      },
      {
        kind: "field",
        name: "underline",
        type: "TagDependency",
        classes: [
          "font"
        ]
      },
      {
        kind: "field",
        name: "characters",
        type: "TagReflexive",
        struct: "FontCharacter",
        maximum: 32e3,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "pixels",
        type: "TagDataOffset",
        maximum: 8388608
      }
    ],
    tagClass: "font",
    sizeBytes: 156
  }
];

// ../core/src/map/definitions/groups/garbage.json
var garbage_default = [
  {
    kind: "struct",
    name: "Garbage",
    fields: [
      {
        kind: "pad",
        size: 168
      }
    ],
    inherits: "Item",
    tagClass: "garbage",
    sizeBytes: 944
  }
];

// ../core/src/map/definitions/groups/gbxmodel.json
var gbxmodel_default = [
  {
    kind: "struct",
    name: "GBXModelGeometryPart",
    fields: [
      {
        kind: "pad",
        size: 1
      },
      {
        kind: "pad",
        size: 1
      },
      {
        kind: "pad",
        size: 1
      },
      {
        kind: "field",
        name: "local node count",
        type: "uint8",
        maximum: 22
      },
      {
        kind: "field",
        name: "local node indices",
        type: "uint8",
        count: 22,
        comment: "Local nodes are used to indirectly refer to a real node. So, if local nodes are used, a vertex says node #4, and local node #4 refers to node #5, then the vertex is node #5. There really doesn't seem to be any benefit to using local nodes, considering compressed vertices (which can only address 42 nodes) don't even use them. They just make the models unnecessarily more convoluted while taking up more space."
      },
      {
        kind: "pad",
        size: 2
      }
    ],
    inherits: "ModelGeometryPart",
    sizeBytes: 132
  },
  {
    kind: "struct",
    name: "GBXModelGeometry",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "IsUnusedFlag"
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "parts",
        type: "TagReflexive",
        struct: "GBXModelGeometryPart",
        maximum: 32,
        extendedMaximum: 32767
      }
    ],
    sizeBytes: 48
  },
  {
    kind: "struct",
    name: "GBXModel",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "ModelFlags"
      },
      {
        kind: "field",
        name: "node list checksum",
        type: "int32"
      },
      {
        kind: "field",
        name: "super high detail cutoff",
        type: "float"
      },
      {
        kind: "field",
        name: "high detail cutoff",
        type: "float"
      },
      {
        kind: "field",
        name: "medium detail cutoff",
        type: "float"
      },
      {
        kind: "field",
        name: "low detail cutoff",
        type: "float"
      },
      {
        kind: "field",
        name: "super low detail cutoff",
        type: "float"
      },
      {
        kind: "field",
        name: "super low detail node count",
        type: "uint16",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "low detail node count",
        type: "uint16",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "medium detail node count",
        type: "uint16",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "high detail node count",
        type: "uint16",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "super high detail node count",
        type: "uint16",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "base map u scale",
        type: "float"
      },
      {
        kind: "field",
        name: "base map v scale",
        type: "float"
      },
      {
        kind: "pad",
        size: 116
      },
      {
        kind: "field",
        name: "markers",
        type: "TagReflexive",
        struct: "ModelMarker",
        maximum: 0
      },
      {
        kind: "field",
        name: "nodes",
        type: "TagReflexive",
        struct: "ModelNode",
        maximum: 64,
        extendedMaximum: 255
      },
      {
        kind: "field",
        name: "regions",
        type: "TagReflexive",
        struct: "ModelRegion",
        maximum: 32,
        extendedMaximum: 255
      },
      {
        kind: "field",
        name: "geometries",
        type: "TagReflexive",
        struct: "GBXModelGeometry",
        maximum: 256,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "shaders",
        type: "TagReflexive",
        struct: "ModelShaderReference",
        maximum: 32,
        extendedMaximum: 32767
      }
    ],
    tagClass: "gbxmodel",
    sizeBytes: 232
  }
];

// ../core/src/map/definitions/groups/globals.json
var globals_default = [
  {
    kind: "enum",
    name: "MultiplayerInformationSound",
    options: [
      "play ball",
      "game over",
      "one minute to win",
      "30 seconds to win",
      "red team minute to win",
      "red team 30 to win",
      "blue team minute to win",
      "blue team 30 to win",
      "blue team has the flag",
      "blue team flag returned",
      "blue team score",
      "red team has the flag",
      "red team flag returned",
      "red team score",
      "double kill",
      "triple kill",
      "killtacular",
      "running riot",
      "killing spree",
      "oddball",
      "race",
      "slayer",
      "capture the flag",
      "warthog",
      "ghost",
      "scorpion",
      "countdown timer",
      "teleporter activate",
      "flag failure",
      "countdown for respawn",
      "hill move",
      "player respawn",
      "team king of the hill",
      "team oddball",
      "team race",
      "team slayer",
      "king of the hill",
      "blue team ctf",
      "red team ctf",
      "hill contested",
      "hill controlled",
      "hill occupied",
      "countdown timer end",
      "ting"
    ]
  },
  {
    kind: "bitfield",
    name: "GlobalsRasterizerDataFlags",
    width: 16,
    fields: [
      "tint edge density"
    ]
  },
  {
    kind: "bitfield",
    name: "GlobalsBreakableSurfaceParticleEffectFlags",
    width: 32,
    fields: [
      "interpolate color in hsv",
      "more colors"
    ]
  },
  {
    kind: "struct",
    name: "GlobalsSound",
    fields: [
      {
        kind: "field",
        name: "sound",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      }
    ],
    sizeBytes: 16
  },
  {
    kind: "struct",
    name: "GlobalsCamera",
    fields: [
      {
        kind: "field",
        name: "default unit camera track",
        type: "TagDependency",
        classes: [
          "camera_track"
        ]
      }
    ],
    sizeBytes: 16
  },
  {
    kind: "struct",
    name: "GlobalsLookFunction",
    fields: [
      {
        kind: "field",
        name: "scale",
        type: "float"
      }
    ],
    sizeBytes: 4
  },
  {
    kind: "struct",
    name: "GlobalsPlayerControl",
    fields: [
      {
        kind: "field",
        name: "magnetism friction",
        type: "float"
      },
      {
        kind: "field",
        name: "magnetism adhesion",
        type: "float"
      },
      {
        kind: "field",
        name: "inconsequential target scale",
        type: "float"
      },
      {
        kind: "pad",
        size: 52
      },
      {
        kind: "field",
        name: "look acceleration time",
        type: "float"
      },
      {
        kind: "field",
        name: "look acceleration scale",
        type: "float"
      },
      {
        kind: "field",
        name: "look peg threshold",
        type: "float"
      },
      {
        kind: "field",
        name: "look default pitch rate",
        type: "float"
      },
      {
        kind: "field",
        name: "look default yaw rate",
        type: "float"
      },
      {
        kind: "field",
        name: "look autolevelling scale",
        type: "float"
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "minimum weapon swap ticks",
        type: "int16"
      },
      {
        kind: "field",
        name: "minimum autolevelling ticks",
        type: "int16"
      },
      {
        kind: "field",
        name: "minimum angle for vehicle flipping",
        type: "Angle"
      },
      {
        kind: "field",
        name: "look function",
        type: "TagReflexive",
        struct: "GlobalsLookFunction",
        maximum: 16
      }
    ],
    sizeBytes: 128
  },
  {
    kind: "struct",
    name: "GlobalsDifficulty",
    fields: [
      {
        kind: "field",
        name: "easy enemy damage",
        type: "float"
      },
      {
        kind: "field",
        name: "normal enemy damage",
        type: "float"
      },
      {
        kind: "field",
        name: "hard enemy damage",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs enemy damage",
        type: "float"
      },
      {
        kind: "field",
        name: "easy enemy vitality",
        type: "float"
      },
      {
        kind: "field",
        name: "normal enemy vitality",
        type: "float"
      },
      {
        kind: "field",
        name: "hard enemy vitality",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs enemy vitality",
        type: "float"
      },
      {
        kind: "field",
        name: "easy enemy shield",
        type: "float"
      },
      {
        kind: "field",
        name: "normal enemy shield",
        type: "float"
      },
      {
        kind: "field",
        name: "hard enemy shield",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs enemy shield",
        type: "float"
      },
      {
        kind: "field",
        name: "easy enemy recharge",
        type: "float"
      },
      {
        kind: "field",
        name: "normal enemy recharge",
        type: "float"
      },
      {
        kind: "field",
        name: "hard enemy recharge",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs enemy recharge",
        type: "float"
      },
      {
        kind: "field",
        name: "easy friend damage",
        type: "float"
      },
      {
        kind: "field",
        name: "normal friend damage",
        type: "float"
      },
      {
        kind: "field",
        name: "hard friend damage",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs friend damage",
        type: "float"
      },
      {
        kind: "field",
        name: "easy friend vitality",
        type: "float"
      },
      {
        kind: "field",
        name: "normal friend vitality",
        type: "float"
      },
      {
        kind: "field",
        name: "hard friend vitality",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs friend vitality",
        type: "float"
      },
      {
        kind: "field",
        name: "easy friend shield",
        type: "float"
      },
      {
        kind: "field",
        name: "normal friend shield",
        type: "float"
      },
      {
        kind: "field",
        name: "hard friend shield",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs friend shield",
        type: "float"
      },
      {
        kind: "field",
        name: "easy friend recharge",
        type: "float"
      },
      {
        kind: "field",
        name: "normal friend recharge",
        type: "float"
      },
      {
        kind: "field",
        name: "hard friend recharge",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs friend recharge",
        type: "float"
      },
      {
        kind: "field",
        name: "easy infection forms",
        type: "float"
      },
      {
        kind: "field",
        name: "normal infection forms",
        type: "float"
      },
      {
        kind: "field",
        name: "hard infection forms",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs infection forms",
        type: "float"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "easy rate of fire",
        type: "float"
      },
      {
        kind: "field",
        name: "normal rate of fire",
        type: "float"
      },
      {
        kind: "field",
        name: "hard rate of fire",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs rate of fire",
        type: "float"
      },
      {
        kind: "field",
        name: "easy projectile error",
        type: "float"
      },
      {
        kind: "field",
        name: "normal projectile error",
        type: "float"
      },
      {
        kind: "field",
        name: "hard projectile error",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs projectile error",
        type: "float"
      },
      {
        kind: "field",
        name: "easy burst error",
        type: "float"
      },
      {
        kind: "field",
        name: "normal burst error",
        type: "float"
      },
      {
        kind: "field",
        name: "hard burst error",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs burst error",
        type: "float"
      },
      {
        kind: "field",
        name: "easy new target delay",
        type: "float"
      },
      {
        kind: "field",
        name: "normal new target delay",
        type: "float"
      },
      {
        kind: "field",
        name: "hard new target delay",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs new target delay",
        type: "float"
      },
      {
        kind: "field",
        name: "easy burst separation",
        type: "float"
      },
      {
        kind: "field",
        name: "normal burst separation",
        type: "float"
      },
      {
        kind: "field",
        name: "hard burst separation",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs burst separation",
        type: "float"
      },
      {
        kind: "field",
        name: "easy target tracking",
        type: "float"
      },
      {
        kind: "field",
        name: "normal target tracking",
        type: "float"
      },
      {
        kind: "field",
        name: "hard target tracking",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs target tracking",
        type: "float"
      },
      {
        kind: "field",
        name: "easy target leading",
        type: "float"
      },
      {
        kind: "field",
        name: "normal target leading",
        type: "float"
      },
      {
        kind: "field",
        name: "hard target leading",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs target leading",
        type: "float"
      },
      {
        kind: "field",
        name: "easy overcharge chance",
        type: "float"
      },
      {
        kind: "field",
        name: "normal overcharge chance",
        type: "float"
      },
      {
        kind: "field",
        name: "hard overcharge chance",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs overcharge chance",
        type: "float"
      },
      {
        kind: "field",
        name: "easy special fire delay",
        type: "float"
      },
      {
        kind: "field",
        name: "normal special fire delay",
        type: "float"
      },
      {
        kind: "field",
        name: "hard special fire delay",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs special fire delay",
        type: "float"
      },
      {
        kind: "field",
        name: "easy guidance vs player",
        type: "float"
      },
      {
        kind: "field",
        name: "normal guidance vs player",
        type: "float"
      },
      {
        kind: "field",
        name: "hard guidance vs player",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs guidance vs player",
        type: "float"
      },
      {
        kind: "field",
        name: "easy melee delay base",
        type: "float"
      },
      {
        kind: "field",
        name: "normal melee delay base",
        type: "float"
      },
      {
        kind: "field",
        name: "hard melee delay base",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs melee delay base",
        type: "float"
      },
      {
        kind: "field",
        name: "easy melee delay scale",
        type: "float"
      },
      {
        kind: "field",
        name: "normal melee delay scale",
        type: "float"
      },
      {
        kind: "field",
        name: "hard melee delay scale",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs melee delay scale",
        type: "float"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "easy grenade chance scale",
        type: "float"
      },
      {
        kind: "field",
        name: "normal grenade chance scale",
        type: "float"
      },
      {
        kind: "field",
        name: "hard grenade chance scale",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs grenade chance scale",
        type: "float"
      },
      {
        kind: "field",
        name: "easy grenade timer scale",
        type: "float"
      },
      {
        kind: "field",
        name: "normal grenade timer scale",
        type: "float"
      },
      {
        kind: "field",
        name: "hard grenade timer scale",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs grenade timer scale",
        type: "float"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "easy major upgrade",
        type: "float"
      },
      {
        kind: "field",
        name: "normal major upgrade",
        type: "float"
      },
      {
        kind: "field",
        name: "hard major upgrade",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs major upgrade",
        type: "float"
      },
      {
        kind: "field",
        name: "easy major upgrade 1",
        type: "float"
      },
      {
        kind: "field",
        name: "normal major upgrade 1",
        type: "float"
      },
      {
        kind: "field",
        name: "hard major upgrade 1",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs major upgrade 1",
        type: "float"
      },
      {
        kind: "field",
        name: "easy major upgrade 2",
        type: "float"
      },
      {
        kind: "field",
        name: "normal major upgrade 2",
        type: "float"
      },
      {
        kind: "field",
        name: "hard major upgrade 2",
        type: "float"
      },
      {
        kind: "field",
        name: "imposs major upgrade 2",
        type: "float"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 84
      }
    ],
    sizeBytes: 644
  },
  {
    kind: "struct",
    name: "GlobalsGrenade",
    fields: [
      {
        kind: "field",
        name: "maximum count",
        type: "int16",
        maximum: 127
      },
      {
        kind: "field",
        name: "mp spawn default",
        type: "int16",
        maximum: 127
      },
      {
        kind: "field",
        name: "throwing effect",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "field",
        name: "hud interface",
        type: "TagDependency",
        classes: [
          "grenade_hud_interface"
        ]
      },
      {
        kind: "field",
        name: "equipment",
        type: "TagDependency",
        classes: [
          "equipment"
        ]
      },
      {
        kind: "field",
        name: "projectile",
        type: "TagDependency",
        classes: [
          "projectile"
        ]
      }
    ],
    sizeBytes: 68
  },
  {
    kind: "struct",
    name: "GlobalsRasterizerData",
    fields: [
      {
        kind: "field",
        name: "distance attenuation",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "vector normalization",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "atmospheric fog density",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "planar fog density",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "linear corner fade",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "active camouflage distortion",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "glow",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 60
      },
      {
        kind: "field",
        name: "default 2d",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "default 3d",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "default cube map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "test 0",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "test 1",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "test 2",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "test 3",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "video scanline map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "video noise map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 52
      },
      {
        kind: "field",
        name: "flags",
        type: "GlobalsRasterizerDataFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "refraction amount",
        type: "float"
      },
      {
        kind: "field",
        name: "distance falloff",
        type: "float"
      },
      {
        kind: "field",
        name: "tint color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "hyper stealth refraction",
        type: "float"
      },
      {
        kind: "field",
        name: "hyper stealth distance falloff",
        type: "float"
      },
      {
        kind: "field",
        name: "hyper stealth tint color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "distance attenuation 2d",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      }
    ],
    sizeBytes: 428
  },
  {
    kind: "struct",
    name: "GlobalsInterfaceBitmaps",
    fields: [
      {
        kind: "field",
        name: "font system",
        type: "TagDependency",
        classes: [
          "font"
        ]
      },
      {
        kind: "field",
        name: "font terminal",
        type: "TagDependency",
        classes: [
          "font"
        ]
      },
      {
        kind: "field",
        name: "screen color table",
        type: "TagDependency",
        classes: [
          "color_table"
        ]
      },
      {
        kind: "field",
        name: "hud color table",
        type: "TagDependency",
        classes: [
          "color_table"
        ]
      },
      {
        kind: "field",
        name: "editor color table",
        type: "TagDependency",
        classes: [
          "color_table"
        ]
      },
      {
        kind: "field",
        name: "dialog color table",
        type: "TagDependency",
        classes: [
          "color_table"
        ]
      },
      {
        kind: "field",
        name: "hud globals",
        type: "TagDependency",
        classes: [
          "hud_globals"
        ]
      },
      {
        kind: "field",
        name: "motion sensor sweep bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "motion sensor sweep bitmap mask",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "multiplayer hud bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "localization",
        type: "TagDependency",
        classes: [
          "string_list"
        ]
      },
      {
        kind: "field",
        name: "hud digits definition",
        type: "TagDependency",
        classes: [
          "hud_number"
        ]
      },
      {
        kind: "field",
        name: "motion sensor blip bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "interface goo map1",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "interface goo map2",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "interface goo map3",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 48
      }
    ],
    sizeBytes: 304
  },
  {
    kind: "struct",
    name: "GlobalsWeapon",
    fields: [
      {
        kind: "field",
        name: "weapon",
        type: "TagDependency",
        classes: [
          "item"
        ]
      }
    ],
    sizeBytes: 16
  },
  {
    kind: "struct",
    name: "GlobalsCheatPowerup",
    fields: [
      {
        kind: "field",
        name: "powerup",
        type: "TagDependency",
        classes: [
          "equipment"
        ]
      }
    ],
    sizeBytes: 16
  },
  {
    kind: "struct",
    name: "GlobalsVehicle",
    fields: [
      {
        kind: "field",
        name: "vehicle",
        type: "TagDependency",
        classes: [
          "unit"
        ]
      }
    ],
    sizeBytes: 16
  },
  {
    kind: "struct",
    name: "GlobalsMultiplayerInformation",
    fields: [
      {
        kind: "field",
        name: "flag",
        type: "TagDependency",
        classes: [
          "weapon"
        ]
      },
      {
        kind: "field",
        name: "unit",
        type: "TagDependency",
        classes: [
          "unit"
        ]
      },
      {
        kind: "field",
        name: "vehicles",
        type: "TagReflexive",
        struct: "GlobalsVehicle",
        maximum: 20
      },
      {
        kind: "field",
        name: "hill shader",
        type: "TagDependency",
        classes: [
          "shader"
        ]
      },
      {
        kind: "field",
        name: "flag shader",
        type: "TagDependency",
        classes: [
          "shader"
        ]
      },
      {
        kind: "field",
        name: "ball",
        type: "TagDependency",
        classes: [
          "weapon"
        ]
      },
      {
        kind: "field",
        name: "sounds",
        type: "TagReflexive",
        struct: "GlobalsSound",
        maximum: 60
      },
      {
        kind: "pad",
        size: 56
      }
    ],
    sizeBytes: 160
  },
  {
    kind: "struct",
    name: "GlobalsPlayerInformation",
    fields: [
      {
        kind: "field",
        name: "unit",
        type: "TagDependency",
        classes: [
          "unit"
        ]
      },
      {
        kind: "pad",
        size: 28
      },
      {
        kind: "field",
        name: "walking speed",
        type: "float"
      },
      {
        kind: "field",
        name: "double speed multiplier",
        type: "float"
      },
      {
        kind: "field",
        name: "run forward",
        type: "float"
      },
      {
        kind: "field",
        name: "run backward",
        type: "float"
      },
      {
        kind: "field",
        name: "run sideways",
        type: "float"
      },
      {
        kind: "field",
        name: "run acceleration",
        type: "float"
      },
      {
        kind: "field",
        name: "sneak forward",
        type: "float"
      },
      {
        kind: "field",
        name: "sneak backward",
        type: "float"
      },
      {
        kind: "field",
        name: "sneak sideways",
        type: "float"
      },
      {
        kind: "field",
        name: "sneak acceleration",
        type: "float"
      },
      {
        kind: "field",
        name: "airborne acceleration",
        type: "float"
      },
      {
        kind: "field",
        name: "speed multiplier",
        type: "float"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "grenade origin",
        type: "Point3D"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "stun movement penalty",
        type: "float"
      },
      {
        kind: "field",
        name: "stun turning penalty",
        type: "float"
      },
      {
        kind: "field",
        name: "stun jumping penalty",
        type: "float"
      },
      {
        kind: "field",
        name: "minimum stun time",
        type: "float"
      },
      {
        kind: "field",
        name: "maximum stun time",
        type: "float"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "first person idle time",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "first person skip fraction",
        type: "float",
        maximum: 1
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "coop respawn effect",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "pad",
        size: 44
      }
    ],
    sizeBytes: 244
  },
  {
    kind: "struct",
    name: "GlobalsFirstPersonInterface",
    fields: [
      {
        kind: "field",
        name: "first person hands",
        type: "TagDependency",
        classes: [
          "model"
        ]
      },
      {
        kind: "field",
        name: "base bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "shield meter",
        type: "TagDependency",
        classes: [
          "meter"
        ]
      },
      {
        kind: "field",
        name: "shield meter origin",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "body meter",
        type: "TagDependency",
        classes: [
          "meter"
        ]
      },
      {
        kind: "field",
        name: "body meter origin",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "night vision on effect",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "field",
        name: "night vision off effect",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "pad",
        size: 88
      }
    ],
    sizeBytes: 192
  },
  {
    kind: "struct",
    name: "GlobalsFallingDamage",
    fields: [
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "harmful falling distance",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "falling damage",
        type: "TagDependency",
        classes: [
          "damage_effect"
        ]
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "maximum falling distance",
        type: "float"
      },
      {
        kind: "field",
        name: "distance damage",
        type: "TagDependency",
        classes: [
          "damage_effect"
        ]
      },
      {
        kind: "field",
        name: "vehicle environment collision damage",
        type: "TagDependency",
        classes: [
          "damage_effect"
        ]
      },
      {
        kind: "field",
        name: "vehicle killed unit damage",
        type: "TagDependency",
        classes: [
          "damage_effect"
        ]
      },
      {
        kind: "field",
        name: "vehicle collision damage",
        type: "TagDependency",
        classes: [
          "damage_effect"
        ]
      },
      {
        kind: "field",
        name: "flaming death damage",
        type: "TagDependency",
        classes: [
          "damage_effect"
        ]
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "maximum falling velocity",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "harmful falling velocity",
        type: "float",
        bounds: true,
        cacheOnly: true
      }
    ],
    sizeBytes: 152
  },
  {
    kind: "struct",
    name: "GlobalsBreakableSurfaceParticleEffect",
    fields: [
      {
        kind: "field",
        name: "particle type",
        type: "TagDependency",
        classes: [
          "particle"
        ]
      },
      {
        kind: "field",
        name: "flags",
        type: "GlobalsBreakableSurfaceParticleEffectFlags"
      },
      {
        kind: "field",
        name: "density",
        type: "float"
      },
      {
        kind: "field",
        name: "velocity scale",
        type: "float",
        bounds: true
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "angular velocity",
        type: "float",
        bounds: true
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "radius",
        type: "float",
        bounds: true
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "tint lower bound",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "tint upper bound",
        type: "ColorARGB"
      },
      {
        kind: "pad",
        size: 28
      }
    ],
    sizeBytes: 128
  },
  {
    kind: "struct",
    name: "GlobalsMaterial",
    fields: [
      {
        kind: "pad",
        size: 100
      },
      {
        kind: "pad",
        size: 48
      },
      {
        kind: "field",
        name: "ground friction scale",
        type: "float"
      },
      {
        kind: "field",
        name: "ground friction normal k1 scale",
        type: "float"
      },
      {
        kind: "field",
        name: "ground friction normal k0 scale",
        type: "float"
      },
      {
        kind: "field",
        name: "ground depth scale",
        type: "float"
      },
      {
        kind: "field",
        name: "ground damp fraction scale",
        type: "float"
      },
      {
        kind: "pad",
        size: 76
      },
      {
        kind: "pad",
        size: 480
      },
      {
        kind: "field",
        name: "maximum vitality",
        type: "float"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "effect",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "field",
        name: "sound",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "particle effects",
        type: "TagReflexive",
        struct: "GlobalsBreakableSurfaceParticleEffect",
        maximum: 8
      },
      {
        kind: "pad",
        size: 60
      },
      {
        kind: "field",
        name: "melee hit sound",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      }
    ],
    sizeBytes: 884
  },
  {
    kind: "struct",
    name: "GlobalsPlaylistMember",
    fields: [
      {
        kind: "field",
        name: "map name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "game variant",
        type: "TagString"
      },
      {
        kind: "field",
        name: "minimum experience",
        type: "int32"
      },
      {
        kind: "field",
        name: "maximum experience",
        type: "int32"
      },
      {
        kind: "field",
        name: "minimum player count",
        type: "int32"
      },
      {
        kind: "field",
        name: "maximum player count",
        type: "int32"
      },
      {
        kind: "field",
        name: "rating",
        type: "int32"
      },
      {
        kind: "pad",
        size: 64
      }
    ],
    sizeBytes: 148
  },
  {
    kind: "struct",
    name: "Globals",
    fields: [
      {
        kind: "pad",
        size: 248
      },
      {
        kind: "field",
        name: "sounds",
        type: "TagReflexive",
        struct: "GlobalsSound",
        maximum: 2
      },
      {
        kind: "field",
        name: "camera",
        type: "TagReflexive",
        struct: "GlobalsCamera",
        maximum: 1
      },
      {
        kind: "field",
        name: "player control",
        type: "TagReflexive",
        struct: "GlobalsPlayerControl",
        maximum: 1
      },
      {
        kind: "field",
        name: "difficulty",
        type: "TagReflexive",
        struct: "GlobalsDifficulty",
        maximum: 1
      },
      {
        kind: "field",
        name: "grenades",
        type: "TagReflexive",
        struct: "GlobalsGrenade",
        maximum: 4
      },
      {
        kind: "field",
        name: "rasterizer data",
        type: "TagReflexive",
        struct: "GlobalsRasterizerData",
        maximum: 1
      },
      {
        kind: "field",
        name: "interface bitmaps",
        type: "TagReflexive",
        struct: "GlobalsInterfaceBitmaps",
        maximum: 1
      },
      {
        kind: "field",
        name: "weapon list",
        type: "TagReflexive",
        struct: "GlobalsWeapon",
        maximum: 20
      },
      {
        kind: "field",
        name: "cheat powerups",
        type: "TagReflexive",
        struct: "GlobalsCheatPowerup",
        maximum: 20
      },
      {
        kind: "field",
        name: "multiplayer information",
        type: "TagReflexive",
        struct: "GlobalsMultiplayerInformation",
        maximum: 1
      },
      {
        kind: "field",
        name: "player information",
        type: "TagReflexive",
        struct: "GlobalsPlayerInformation",
        maximum: 1
      },
      {
        kind: "field",
        name: "first person interface",
        type: "TagReflexive",
        struct: "GlobalsFirstPersonInterface",
        maximum: 1
      },
      {
        kind: "field",
        name: "falling damage",
        type: "TagReflexive",
        struct: "GlobalsFallingDamage",
        maximum: 1
      },
      {
        kind: "field",
        name: "materials",
        type: "TagReflexive",
        struct: "GlobalsMaterial",
        maximum: 33
      },
      {
        kind: "field",
        name: "playlist members",
        type: "TagReflexive",
        struct: "GlobalsPlaylistMember",
        maximum: 20
      }
    ],
    tagClass: "globals",
    sizeBytes: 428
  }
];

// ../core/src/map/definitions/groups/glow.json
var glow_default = [
  {
    kind: "enum",
    name: "GlowBoundaryEffect",
    options: [
      "bounce",
      "wrap"
    ]
  },
  {
    kind: "enum",
    name: "GlowNormalParticleDistribution",
    options: [
      "distributed randomly",
      "distributed uniformly"
    ]
  },
  {
    kind: "enum",
    name: "GlowTrailingParticleDistribution",
    options: [
      "emit vertically",
      "emit normal up",
      "emit randomly"
    ]
  },
  {
    kind: "bitfield",
    name: "GlowFlags",
    width: 32,
    fields: [
      "modify particle color in range",
      "particles move backwards",
      "partices move in both directions",
      "trailing particles fade over time",
      "trailing particles shrink over time",
      "trailing particles slow over time"
    ]
  },
  {
    kind: "struct",
    name: "Glow",
    fields: [
      {
        kind: "field",
        name: "attachment marker",
        type: "TagString"
      },
      {
        kind: "field",
        name: "number of particles",
        type: "int16"
      },
      {
        kind: "field",
        name: "boundary effect",
        type: "GlowBoundaryEffect"
      },
      {
        kind: "field",
        name: "normal particle distribution",
        type: "GlowNormalParticleDistribution"
      },
      {
        kind: "field",
        name: "trailing particle distribution",
        type: "GlowTrailingParticleDistribution"
      },
      {
        kind: "field",
        name: "glow flags",
        type: "GlowFlags"
      },
      {
        kind: "pad",
        size: 28
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "attachment 0",
        type: "FunctionOut"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "particle rotational velocity",
        type: "float"
      },
      {
        kind: "field",
        name: "particle rot vel mul low",
        type: "float"
      },
      {
        kind: "field",
        name: "particle rot vel mul high",
        type: "float"
      },
      {
        kind: "field",
        name: "attachment 1",
        type: "FunctionOut"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "effect rotational velocity",
        type: "float"
      },
      {
        kind: "field",
        name: "effect rot vel mul low",
        type: "float"
      },
      {
        kind: "field",
        name: "effect rot vel mul high",
        type: "float"
      },
      {
        kind: "field",
        name: "attachment 2",
        type: "FunctionOut"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "effect translational velocity",
        type: "float"
      },
      {
        kind: "field",
        name: "effect trans vel mul low",
        type: "float"
      },
      {
        kind: "field",
        name: "effect trans vel mul high",
        type: "float"
      },
      {
        kind: "field",
        name: "attachment 3",
        type: "FunctionOut"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "min distance particle to object",
        type: "float"
      },
      {
        kind: "field",
        name: "max distance particle to object",
        type: "float"
      },
      {
        kind: "field",
        name: "distance to object mul low",
        type: "float"
      },
      {
        kind: "field",
        name: "distance to object mul high",
        type: "float"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "attachment 4",
        type: "FunctionOut"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "particle size bounds",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "size attachment multiplier",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "attachment 5",
        type: "FunctionOut"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "color bound 0",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "color bound 1",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "scale color 0",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "scale color 1",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "color rate of change",
        type: "float"
      },
      {
        kind: "field",
        name: "fading percentage of glow",
        type: "float"
      },
      {
        kind: "field",
        name: "particle generation freq",
        type: "float"
      },
      {
        kind: "field",
        name: "lifetime of trailing particles",
        type: "float"
      },
      {
        kind: "field",
        name: "velocity of trailing particles",
        type: "float"
      },
      {
        kind: "field",
        name: "trailing particle minimum t",
        type: "float"
      },
      {
        kind: "field",
        name: "trailing particle maximum t",
        type: "float"
      },
      {
        kind: "pad",
        size: 52
      },
      {
        kind: "field",
        name: "texture",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      }
    ],
    tagClass: "glow",
    sizeBytes: 340
  }
];

// ../core/src/map/definitions/groups/grenade_hud_interface.json
var grenade_hud_interface_default = [
  {
    kind: "bitfield",
    name: "GrenadeHUDInterfaceOverlayType",
    width: 16,
    fields: [
      "show on flashing",
      "show on empty",
      "show on default",
      "show always"
    ]
  },
  {
    kind: "bitfield",
    name: "GrenadeHUDInterfaceSoundLatchedTo",
    width: 32,
    fields: [
      "low grenade count",
      "no grenades left",
      "throw on no grenades"
    ]
  },
  {
    kind: "struct",
    name: "GrenadeHUDInterfaceOverlay",
    fields: [
      {
        kind: "field",
        name: "anchor offset",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "width scale",
        type: "float"
      },
      {
        kind: "field",
        name: "height scale",
        type: "float"
      },
      {
        kind: "field",
        name: "scaling flags",
        type: "HUDInterfaceScalingFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "default color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "flashing color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "flash period",
        type: "float"
      },
      {
        kind: "field",
        name: "flash delay",
        type: "float"
      },
      {
        kind: "field",
        name: "number of flashes",
        type: "int16"
      },
      {
        kind: "field",
        name: "flash flags",
        type: "HUDInterfaceFlashFlags"
      },
      {
        kind: "field",
        name: "flash length",
        type: "float"
      },
      {
        kind: "field",
        name: "disabled color",
        type: "ColorARGBInt"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "frame rate",
        type: "float"
      },
      {
        kind: "field",
        name: "sequence index",
        type: "Index"
      },
      {
        kind: "field",
        name: "type",
        type: "GrenadeHUDInterfaceOverlayType"
      },
      {
        kind: "field",
        name: "flags",
        type: "HUDInterfaceOverlayFlashFlags"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 40
      }
    ],
    sizeBytes: 136
  },
  {
    kind: "struct",
    name: "GrenadeHUDInterfaceSound",
    fields: [
      {
        kind: "field",
        name: "sound",
        type: "TagDependency",
        classes: [
          "sound",
          "sound_looping"
        ]
      },
      {
        kind: "field",
        name: "latched to",
        type: "GrenadeHUDInterfaceSoundLatchedTo"
      },
      {
        kind: "field",
        name: "scale",
        type: "float"
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    sizeBytes: 56
  },
  {
    kind: "struct",
    name: "GrenadeHUDInterface",
    fields: [
      {
        kind: "field",
        name: "anchor",
        type: "HUDInterfaceAnchor"
      },
      {
        kind: "field",
        name: "canvas size",
        type: "HUDInterfaceCanvasSize"
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "background anchor offset",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "background width scale",
        type: "float"
      },
      {
        kind: "field",
        name: "background height scale",
        type: "float"
      },
      {
        kind: "field",
        name: "background scaling flags",
        type: "HUDInterfaceScalingFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "background interface bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "background default color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "background flashing color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "background flash period",
        type: "float"
      },
      {
        kind: "field",
        name: "background flash delay",
        type: "float"
      },
      {
        kind: "field",
        name: "background number of flashes",
        type: "int16"
      },
      {
        kind: "field",
        name: "background flash flags",
        type: "HUDInterfaceFlashFlags"
      },
      {
        kind: "field",
        name: "background flash length",
        type: "float"
      },
      {
        kind: "field",
        name: "background disabled color",
        type: "ColorARGBInt"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "background sequence index",
        type: "Index"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "background multitexture overlays",
        type: "TagReflexive",
        struct: "HUDInterfaceMultitextureOverlay",
        maximum: 30
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "total grenades background anchor offset",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "total grenades background width scale",
        type: "float"
      },
      {
        kind: "field",
        name: "total grenades background height scale",
        type: "float"
      },
      {
        kind: "field",
        name: "total grenades background scaling flags",
        type: "HUDInterfaceScalingFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "total grenades background interface bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "total grenades background default color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "total grenades background flashing color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "total grenades background flash period",
        type: "float"
      },
      {
        kind: "field",
        name: "total grenades background flash delay",
        type: "float"
      },
      {
        kind: "field",
        name: "total grenades background number of flashes",
        type: "int16"
      },
      {
        kind: "field",
        name: "total grenades background flash flags",
        type: "HUDInterfaceFlashFlags"
      },
      {
        kind: "field",
        name: "total grenades background flash length",
        type: "float"
      },
      {
        kind: "field",
        name: "total grenades background disabled color",
        type: "ColorARGBInt"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "total grenades background sequence index",
        type: "Index"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "total grenades background multitexture overlays",
        type: "TagReflexive",
        struct: "HUDInterfaceMultitextureOverlay",
        maximum: 30
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "total grenades numbers anchor offset",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "total grenades numbers width scale",
        type: "float"
      },
      {
        kind: "field",
        name: "total grenades numbers height scale",
        type: "float"
      },
      {
        kind: "field",
        name: "total grenades numbers scaling flags",
        type: "HUDInterfaceScalingFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "total grenades numbers default color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "total grenades numbers flashing color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "total grenades numbers flash period",
        type: "float"
      },
      {
        kind: "field",
        name: "total grenades numbers flash delay",
        type: "float"
      },
      {
        kind: "field",
        name: "total grenades numbers number of flashes",
        type: "int16"
      },
      {
        kind: "field",
        name: "total grenades numbers flash flags",
        type: "HUDInterfaceFlashFlags"
      },
      {
        kind: "field",
        name: "total grenades numbers flash length",
        type: "float"
      },
      {
        kind: "field",
        name: "total grenades numbers disabled color",
        type: "ColorARGBInt"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "total grenades numbers maximum number of digits",
        type: "int8"
      },
      {
        kind: "field",
        name: "total grenades numbers flags",
        type: "HUDInterfaceNumberFlags"
      },
      {
        kind: "field",
        name: "total grenades numbers number of fractional digits",
        type: "int8"
      },
      {
        kind: "pad",
        size: 1
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "flash cutoff",
        type: "int16"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "total grenades overlay bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "total grenades overlays",
        type: "TagReflexive",
        struct: "GrenadeHUDInterfaceOverlay",
        maximum: 16
      },
      {
        kind: "field",
        name: "total grenades warning sounds",
        type: "TagReflexive",
        struct: "GrenadeHUDInterfaceSound",
        maximum: 12
      },
      {
        kind: "pad",
        size: 68
      },
      {
        kind: "field",
        name: "messaging information sequence index",
        type: "Index"
      },
      {
        kind: "field",
        name: "messaging information width offset",
        type: "int16"
      },
      {
        kind: "field",
        name: "messaging information offset from reference corner",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "messaging information override icon color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "messaging information frame rate",
        type: "int8"
      },
      {
        kind: "field",
        name: "messaging information flags",
        type: "HUDInterfaceMessagingFlags"
      },
      {
        kind: "field",
        name: "messaging information text index",
        type: "Index"
      },
      {
        kind: "pad",
        size: 48
      }
    ],
    tagClass: "grenade_hud_interface",
    sizeBytes: 504
  }
];

// ../core/src/map/definitions/groups/hud_globals.json
var hud_globals_default = [
  {
    kind: "bitfield",
    name: "HUDGlobalsWaypointArrowFlags",
    width: 32,
    fields: [
      "dont rotate when pointing offscreen"
    ]
  },
  {
    kind: "struct",
    name: "HUDGlobalsButtonIcon",
    fields: [
      {
        kind: "field",
        name: "sequence index",
        type: "Index"
      },
      {
        kind: "field",
        name: "width offset",
        type: "int16"
      },
      {
        kind: "field",
        name: "offset from reference corner",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "override icon color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "frame rate",
        type: "int8"
      },
      {
        kind: "field",
        name: "flags",
        type: "HUDInterfaceMessagingFlags"
      },
      {
        kind: "field",
        name: "text index",
        type: "Index"
      }
    ],
    sizeBytes: 16
  },
  {
    kind: "enum",
    name: "HUDGlobalsAnniversaryRemapTargetLanguage",
    options: [
      "english",
      "french",
      "spanish",
      "italian",
      "german",
      "traditional chinese",
      "japanese",
      "korean",
      "portuguese",
      "latam spanish",
      "polish",
      "russian",
      "simplified chinese"
    ]
  },
  {
    kind: "bitfield",
    name: "HUDGlobalsAnniversaryRemapTargetFlags",
    width: 16,
    fields: [
      "legacy mode"
    ]
  },
  {
    kind: "struct",
    name: "HUDGlobalsAnniversaryRemapTarget",
    fields: [
      {
        kind: "field",
        name: "target bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "language",
        type: "HUDGlobalsAnniversaryRemapTargetLanguage"
      },
      {
        kind: "field",
        name: "flags",
        type: "HUDGlobalsAnniversaryRemapTargetFlags"
      }
    ],
    sizeBytes: 20
  },
  {
    kind: "struct",
    name: "HUDGlobalsAnniversaryRemap",
    fields: [
      {
        kind: "field",
        name: "source bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "targets",
        type: "TagReflexive",
        struct: "HUDGlobalsAnniversaryRemapTarget",
        maximum: 26
      }
    ],
    sizeBytes: 28
  },
  {
    kind: "struct",
    name: "HUDGlobalsWaypointArrow",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "opacity",
        type: "float"
      },
      {
        kind: "field",
        name: "translucency",
        type: "float"
      },
      {
        kind: "field",
        name: "on screen sequence index",
        type: "Index"
      },
      {
        kind: "field",
        name: "off screen sequence index",
        type: "Index"
      },
      {
        kind: "field",
        name: "occluded sequence index",
        type: "Index"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "flags",
        type: "HUDGlobalsWaypointArrowFlags"
      },
      {
        kind: "pad",
        size: 24
      }
    ],
    sizeBytes: 104
  },
  {
    kind: "struct",
    name: "HUDGlobals",
    fields: [
      {
        kind: "field",
        name: "anchor",
        type: "HUDInterfaceAnchor"
      },
      {
        kind: "field",
        name: "canvas size",
        type: "HUDInterfaceCanvasSize"
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "anchor offset",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "width scale",
        type: "float"
      },
      {
        kind: "field",
        name: "height scale",
        type: "float"
      },
      {
        kind: "field",
        name: "scaling flags",
        type: "HUDInterfaceScalingFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "fullscreen font",
        type: "TagDependency",
        classes: [
          "font"
        ]
      },
      {
        kind: "field",
        name: "splitscreen font",
        type: "TagDependency",
        classes: [
          "font"
        ]
      },
      {
        kind: "field",
        name: "up time",
        type: "float"
      },
      {
        kind: "field",
        name: "fade time",
        type: "float"
      },
      {
        kind: "field",
        name: "icon color",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "text color",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "text spacing",
        type: "float"
      },
      {
        kind: "field",
        name: "item message text",
        type: "TagDependency",
        classes: [
          "unicode_string_list"
        ]
      },
      {
        kind: "field",
        name: "icon bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "alternate icon text",
        type: "TagDependency",
        classes: [
          "unicode_string_list"
        ]
      },
      {
        kind: "field",
        name: "button icons",
        type: "TagReflexive",
        struct: "HUDGlobalsButtonIcon",
        maximum: 18
      },
      {
        kind: "field",
        name: "hud help default color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "hud help flashing color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "hud help flash period",
        type: "float"
      },
      {
        kind: "field",
        name: "hud help flash delay",
        type: "float"
      },
      {
        kind: "field",
        name: "hud help number of flashes",
        type: "int16"
      },
      {
        kind: "field",
        name: "hud help flash flags",
        type: "HUDInterfaceFlashFlags"
      },
      {
        kind: "field",
        name: "hud help flash length",
        type: "float"
      },
      {
        kind: "field",
        name: "hud help disabled color",
        type: "ColorARGBInt"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "hud messages",
        type: "TagDependency",
        classes: [
          "hud_message_text"
        ]
      },
      {
        kind: "field",
        name: "objective default color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "objective flashing color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "objective flash period",
        type: "float"
      },
      {
        kind: "field",
        name: "objective flash delay",
        type: "float"
      },
      {
        kind: "field",
        name: "objective number of flashes",
        type: "int16"
      },
      {
        kind: "field",
        name: "objective flash flags",
        type: "HUDInterfaceFlashFlags"
      },
      {
        kind: "field",
        name: "objective flash length",
        type: "float"
      },
      {
        kind: "field",
        name: "objective disabled color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "objective uptime ticks",
        type: "int16"
      },
      {
        kind: "field",
        name: "objective fade ticks",
        type: "int16"
      },
      {
        kind: "field",
        name: "top offset",
        type: "float"
      },
      {
        kind: "field",
        name: "bottom offset",
        type: "float"
      },
      {
        kind: "field",
        name: "left offset",
        type: "float"
      },
      {
        kind: "field",
        name: "right offset",
        type: "float"
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "arrow bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "waypoint arrows",
        type: "TagReflexive",
        struct: "HUDGlobalsWaypointArrow",
        maximum: 16
      },
      {
        kind: "pad",
        size: 80
      },
      {
        kind: "field",
        name: "hud scale in multiplayer",
        type: "float"
      },
      {
        kind: "pad",
        size: 256
      },
      {
        kind: "field",
        name: "default weapon hud",
        type: "TagDependency",
        classes: [
          "weapon_hud_interface"
        ]
      },
      {
        kind: "field",
        name: "motion sensor range",
        type: "float"
      },
      {
        kind: "field",
        name: "motion sensor velocity sensitivity",
        type: "float"
      },
      {
        kind: "field",
        name: "motion sensor scale",
        type: "float"
      },
      {
        kind: "field",
        name: "default chapter title bounds",
        type: "Rectangle2D"
      },
      {
        kind: "pad",
        size: 44
      },
      {
        kind: "field",
        name: "hud damage top offset",
        type: "int16"
      },
      {
        kind: "field",
        name: "hud damage bottom offset",
        type: "int16"
      },
      {
        kind: "field",
        name: "hud damage left offset",
        type: "int16"
      },
      {
        kind: "field",
        name: "hud damage right offset",
        type: "int16"
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "hud damage indicator bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "hud damage sequence index",
        type: "Index"
      },
      {
        kind: "field",
        name: "hud damage multiplayer sequence index",
        type: "Index"
      },
      {
        kind: "field",
        name: "hud damage color",
        type: "ColorARGBInt"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "not much time left default color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "not much time left flashing color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "not much time left flash period",
        type: "float"
      },
      {
        kind: "field",
        name: "not much time left flash delay",
        type: "float"
      },
      {
        kind: "field",
        name: "not much time left number of flashes",
        type: "int16"
      },
      {
        kind: "field",
        name: "not much time left flash flags",
        type: "HUDInterfaceFlashFlags"
      },
      {
        kind: "field",
        name: "not much time left flash length",
        type: "float"
      },
      {
        kind: "field",
        name: "not much time left disabled color",
        type: "ColorARGBInt"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "time out flash default color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "time out flash flashing color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "time out flash flash period",
        type: "float"
      },
      {
        kind: "field",
        name: "time out flash flash delay",
        type: "float"
      },
      {
        kind: "field",
        name: "time out flash number of flashes",
        type: "int16"
      },
      {
        kind: "field",
        name: "time out flash flash flags",
        type: "HUDInterfaceFlashFlags"
      },
      {
        kind: "field",
        name: "time out flash flash length",
        type: "float"
      },
      {
        kind: "field",
        name: "time out flash disabled color",
        type: "ColorARGBInt"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "pad",
        size: 40
      },
      {
        kind: "field",
        name: "carnage report bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "loading begin text",
        type: "Index"
      },
      {
        kind: "field",
        name: "loading end text",
        type: "Index"
      },
      {
        kind: "field",
        name: "checkpoint begin text",
        type: "Index"
      },
      {
        kind: "field",
        name: "checkpoint end text",
        type: "Index"
      },
      {
        kind: "field",
        name: "checkpoint sound",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "anniversary hud remaps",
        type: "TagReflexive",
        struct: "HUDGlobalsAnniversaryRemap",
        maximum: 32
      },
      {
        kind: "pad",
        size: 84
      }
    ],
    tagClass: "hud_globals",
    sizeBytes: 1104
  }
];

// ../core/src/map/definitions/groups/hud_interface_types.json
var hud_interface_types_default = [
  {
    kind: "enum",
    name: "HUDInterfaceDestinationType",
    options: [
      "tint 0 1",
      "horizontal offset",
      "vertical offset",
      "fade 0 1"
    ]
  },
  {
    kind: "enum",
    name: "HUDInterfaceDestination",
    options: [
      "geometry offset",
      "primary map",
      "secondary map",
      "tertiary map"
    ]
  },
  {
    kind: "enum",
    name: "HUDInterfaceSource",
    options: [
      "player pitch",
      "player pitch tangent",
      "player yaw",
      "weapon ammo total",
      "weapon ammo loaded",
      "weapon heat",
      "explicit uses low bound",
      "weapon zoom level"
    ]
  },
  {
    kind: "enum",
    name: "HUDInterfaceMultitextureOverlayAnchor",
    options: [
      "texture",
      "screen"
    ]
  },
  {
    kind: "enum",
    name: "HUDInterfaceZeroToOneBlendFunction",
    options: [
      "add",
      "subtract",
      "multiply",
      "multiply2x",
      "dot"
    ]
  },
  {
    kind: "enum",
    name: "HUDInterfaceWrapMode",
    options: [
      "clamp",
      "wrap"
    ]
  },
  {
    kind: "enum",
    name: "HUDInterfaceAnchor",
    options: [
      "top left",
      "top right",
      "bottom left",
      "bottom right",
      "center",
      "top center",
      "bottom center",
      "left center",
      "right center"
    ]
  },
  {
    kind: "enum",
    name: "HUDInterfaceChildAnchor",
    options: [
      "from parent",
      "top left",
      "top right",
      "bottom left",
      "bottom right",
      "center",
      "top center",
      "bottom center",
      "left center",
      "right center"
    ]
  },
  {
    kind: "enum",
    name: "HUDInterfaceCanvasSize",
    options: [
      "480p",
      "960p"
    ]
  },
  {
    kind: "bitfield",
    name: "HUDInterfaceMeterFlags",
    width: 8,
    fields: [
      "use min max for state changes",
      "interpolate between min max flash colors as state changes",
      "interpolate color along hsv space",
      "more colors for hsv interpolation",
      "invert interpolation",
      "use xbox shading"
    ]
  },
  {
    kind: "bitfield",
    name: "HUDInterfaceScalingFlags",
    width: 16,
    fields: [
      "don't scale offset",
      "don't scale size",
      "use high res scale"
    ]
  },
  {
    kind: "bitfield",
    name: "HUDInterfaceFlashFlags",
    width: 16,
    fields: [
      "reverse default flashing colors"
    ]
  },
  {
    kind: "bitfield",
    name: "HUDInterfaceNumberFlags",
    width: 8,
    fields: [
      "show leading zeros",
      "only show when zoomed",
      "draw a trailing m"
    ]
  },
  {
    kind: "bitfield",
    name: "HUDInterfaceOverlayFlashFlags",
    width: 32,
    fields: [
      "flashes when active"
    ]
  },
  {
    kind: "bitfield",
    name: "HUDInterfaceMessagingFlags",
    width: 8,
    fields: [
      "use text from string list instead",
      "override default color",
      "width offset is absolute icon width"
    ]
  },
  {
    kind: "struct",
    name: "HUDInterfaceMultitextureOverlayEffector",
    fields: [
      {
        kind: "pad",
        size: 64
      },
      {
        kind: "field",
        name: "destination type",
        type: "HUDInterfaceDestinationType"
      },
      {
        kind: "field",
        name: "destination",
        type: "HUDInterfaceDestination"
      },
      {
        kind: "field",
        name: "source",
        type: "HUDInterfaceSource"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "in bounds",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "out bounds",
        type: "float",
        bounds: true
      },
      {
        kind: "pad",
        size: 64
      },
      {
        kind: "field",
        name: "tint color lower bound",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "tint color upper bound",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "periodic function",
        type: "WaveFunction"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "function period",
        type: "float"
      },
      {
        kind: "field",
        name: "function phase",
        type: "float"
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    sizeBytes: 220
  },
  {
    kind: "struct",
    name: "HUDInterfaceMultitextureOverlay",
    fields: [
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "type",
        type: "int16"
      },
      {
        kind: "field",
        name: "framebuffer blend function",
        type: "FramebufferBlendFunction"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "primary anchor",
        type: "HUDInterfaceMultitextureOverlayAnchor"
      },
      {
        kind: "field",
        name: "secondary anchor",
        type: "HUDInterfaceMultitextureOverlayAnchor"
      },
      {
        kind: "field",
        name: "tertiary anchor",
        type: "HUDInterfaceMultitextureOverlayAnchor"
      },
      {
        kind: "field",
        name: "zero to one blend function",
        type: "HUDInterfaceZeroToOneBlendFunction"
      },
      {
        kind: "field",
        name: "one to two blend function",
        type: "HUDInterfaceZeroToOneBlendFunction"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "primary scale",
        type: "Point2D"
      },
      {
        kind: "field",
        name: "secondary scale",
        type: "Point2D"
      },
      {
        kind: "field",
        name: "tertiary scale",
        type: "Point2D"
      },
      {
        kind: "field",
        name: "primary offset",
        type: "Point2D"
      },
      {
        kind: "field",
        name: "secondary offset",
        type: "Point2D"
      },
      {
        kind: "field",
        name: "tertiary offset",
        type: "Point2D"
      },
      {
        kind: "field",
        name: "primary",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "secondary",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "tertiary",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "primary wrap mode",
        type: "HUDInterfaceWrapMode"
      },
      {
        kind: "field",
        name: "secondary wrap mode",
        type: "HUDInterfaceWrapMode"
      },
      {
        kind: "field",
        name: "tertiary wrap mode",
        type: "HUDInterfaceWrapMode"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 184
      },
      {
        kind: "field",
        name: "effectors",
        type: "TagReflexive",
        struct: "HUDInterfaceMultitextureOverlayEffector",
        maximum: 30
      },
      {
        kind: "pad",
        size: 128
      }
    ],
    sizeBytes: 480
  }
];

// ../core/src/map/definitions/groups/hud_message_text.json
var hud_message_text_default = [
  {
    kind: "struct",
    name: "HUDMessageTextElement",
    fields: [
      {
        kind: "field",
        name: "type",
        type: "int8"
      },
      {
        kind: "field",
        name: "data",
        type: "uint8"
      }
    ],
    sizeBytes: 2
  },
  {
    kind: "struct",
    name: "HUDMessageTextMessage",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "start index into text blob",
        type: "Index"
      },
      {
        kind: "field",
        name: "start index of message block",
        type: "Index"
      },
      {
        kind: "field",
        name: "panel count",
        type: "uint8"
      },
      {
        kind: "pad",
        size: 3
      },
      {
        kind: "pad",
        size: 24
      }
    ],
    sizeBytes: 64
  },
  {
    kind: "struct",
    name: "HUDMessageText",
    fields: [
      {
        kind: "field",
        name: "text data",
        type: "TagDataOffset",
        maximum: 65536
      },
      {
        kind: "field",
        name: "message elements",
        type: "TagReflexive",
        struct: "HUDMessageTextElement",
        maximum: 8192
      },
      {
        kind: "field",
        name: "messages",
        type: "TagReflexive",
        struct: "HUDMessageTextMessage",
        maximum: 1024
      },
      {
        kind: "pad",
        size: 84
      }
    ],
    tagClass: "hud_message_text",
    sizeBytes: 128
  }
];

// ../core/src/map/definitions/groups/hud_number.json
var hud_number_default = [
  {
    kind: "struct",
    name: "HUDNumber",
    fields: [
      {
        kind: "field",
        name: "digits bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "bitmap digit width",
        type: "int8"
      },
      {
        kind: "field",
        name: "screen digit width",
        type: "int8"
      },
      {
        kind: "field",
        name: "x offset",
        type: "int8"
      },
      {
        kind: "field",
        name: "y offset",
        type: "int8"
      },
      {
        kind: "field",
        name: "decimal point width",
        type: "int8"
      },
      {
        kind: "field",
        name: "colon width",
        type: "int8"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 76
      }
    ],
    tagClass: "hud_number",
    sizeBytes: 100
  }
];

// ../core/src/map/definitions/groups/input_device_defaults.json
var input_device_defaults_default = [
  {
    kind: "enum",
    name: "InputDeviceDefaultsDeviceType",
    options: [
      "mouse and keyboard",
      "joysticks gamepads etc",
      "full profile definition"
    ]
  },
  {
    kind: "bitfield",
    name: "InputDeviceDefaultsFlags",
    width: 16,
    fields: [
      "unused"
    ]
  },
  {
    kind: "struct",
    name: "InputDeviceDefaults",
    fields: [
      {
        kind: "field",
        name: "device type",
        type: "InputDeviceDefaultsDeviceType"
      },
      {
        kind: "field",
        name: "flags",
        type: "InputDeviceDefaultsFlags"
      },
      {
        kind: "field",
        name: "device id",
        type: "TagDataOffset"
      },
      {
        kind: "field",
        name: "profile",
        type: "TagDataOffset"
      }
    ],
    tagClass: "input_device_defaults",
    sizeBytes: 44
  }
];

// ../core/src/map/definitions/groups/item.json
var item_default = [
  {
    kind: "bitfield",
    name: "ItemFlags",
    width: 32,
    fields: [
      "always maintains z up",
      "destroyed by explosions",
      "unaffected by gravity"
    ]
  },
  {
    kind: "enum",
    name: "ItemFunctionIn",
    options: [
      "none"
    ]
  },
  {
    kind: "struct",
    name: "Item",
    fields: [
      {
        kind: "field",
        name: "item flags",
        type: "ItemFlags"
      },
      {
        kind: "field",
        name: "pickup text index",
        type: "Index"
      },
      {
        kind: "field",
        name: "sort order",
        type: "int16"
      },
      {
        kind: "field",
        name: "scale",
        type: "float"
      },
      {
        kind: "field",
        name: "hud message value scale",
        type: "int16"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "item a in",
        type: "ItemFunctionIn"
      },
      {
        kind: "field",
        name: "item b in",
        type: "ItemFunctionIn"
      },
      {
        kind: "field",
        name: "item c in",
        type: "ItemFunctionIn"
      },
      {
        kind: "field",
        name: "item d in",
        type: "ItemFunctionIn"
      },
      {
        kind: "pad",
        size: 164
      },
      {
        kind: "field",
        name: "material effects",
        type: "TagDependency",
        classes: [
          "material_effects"
        ]
      },
      {
        kind: "field",
        name: "collision sound",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "pad",
        size: 120
      },
      {
        kind: "field",
        name: "detonation delay",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "detonating effect",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "field",
        name: "detonation effect",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      }
    ],
    inherits: "Object",
    tagClass: "item",
    sizeBytes: 776
  }
];

// ../core/src/map/definitions/groups/item_collection.json
var item_collection_default = [
  {
    kind: "struct",
    name: "ItemCollectionPermutation",
    fields: [
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "weight",
        type: "float",
        maximum: 32768
      },
      {
        kind: "field",
        name: "item",
        type: "TagDependency",
        classes: [
          "item"
        ]
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    sizeBytes: 84
  },
  {
    kind: "struct",
    name: "ItemCollection",
    fields: [
      {
        kind: "field",
        name: "permutations",
        type: "TagReflexive",
        struct: "ItemCollectionPermutation",
        maximum: 32
      },
      {
        kind: "field",
        name: "default spawn time",
        type: "int16"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 76
      }
    ],
    tagClass: "item_collection",
    sizeBytes: 92
  }
];

// ../core/src/map/definitions/groups/lens_flare.json
var lens_flare_default = [
  {
    kind: "enum",
    name: "LensFlareRadiusScaledBy",
    options: [
      "none",
      "rotation",
      "rotation and strafing",
      "distance from center"
    ]
  },
  {
    kind: "enum",
    name: "LensFlareOcclusionOffsetDirection",
    options: [
      "toward viewer",
      "marker forward",
      "none"
    ]
  },
  {
    kind: "enum",
    name: "LensFlareRotationFunction",
    options: [
      "none",
      "rotation a",
      "rotation b",
      "rotation translation",
      "translation"
    ]
  },
  {
    kind: "bitfield",
    name: "LensFlareReflectionFlags",
    width: 16,
    fields: [
      "align rotation with screen center",
      "radius not scaled by distance",
      "radius scaled by occlusion factor",
      "occluded by solid objects"
    ]
  },
  {
    kind: "bitfield",
    name: "LensFlareReflectionMoreFlags",
    width: 16,
    fields: [
      "interpolate colors in hsv",
      "more colors"
    ]
  },
  {
    kind: "bitfield",
    name: "LensFlareFlags",
    width: 16,
    fields: [
      "sun",
      "no occlusion test",
      "only render in first person",
      "only render in third person",
      "fade in more quickly",
      "fade out more quickly",
      "scale by marker"
    ]
  },
  {
    kind: "struct",
    name: "LensFlareReflection",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "LensFlareReflectionFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "bitmap index",
        type: "Index"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "position",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation offset",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "radius",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "radius scaled by",
        type: "LensFlareRadiusScaledBy"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "brightness",
        type: "Fraction",
        maximum: 1,
        bounds: true
      },
      {
        kind: "field",
        name: "brightness scaled by",
        type: "LensFlareRadiusScaledBy"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "tint color",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "color lower bound",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "color upper bound",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "more flags",
        type: "LensFlareReflectionMoreFlags"
      },
      {
        kind: "field",
        name: "animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "animation phase",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      }
    ],
    sizeBytes: 128
  },
  {
    kind: "struct",
    name: "LensFlare",
    fields: [
      {
        kind: "field",
        name: "falloff angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "cutoff angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "cos falloff angle",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "cos cutoff angle",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "occlusion radius",
        type: "float"
      },
      {
        kind: "field",
        name: "occlusion offset direction",
        type: "LensFlareOcclusionOffsetDirection"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "near fade distance",
        type: "float"
      },
      {
        kind: "field",
        name: "far fade distance",
        type: "float"
      },
      {
        kind: "field",
        name: "bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "flags",
        type: "LensFlareFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 76
      },
      {
        kind: "field",
        name: "rotation function",
        type: "LensFlareRotationFunction"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "rotation function scale",
        type: "Angle",
        comment: "Prior to CEA's newer MCC Halo CE: Mod Tools, this was defaulted to 360 radians (as a bug), thus all Bungie, Gearbox, and early CEA releases had this scaled to 360 radians. As of MCC CEA, it's defaulted to 2*pi instead"
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "horizontal scale",
        type: "float"
      },
      {
        kind: "field",
        name: "vertical scale",
        type: "float"
      },
      {
        kind: "pad",
        size: 28
      },
      {
        kind: "field",
        name: "reflections",
        type: "TagReflexive",
        struct: "LensFlareReflection",
        maximum: 32
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    tagClass: "lens_flare",
    sizeBytes: 240
  }
];

// ../core/src/map/definitions/groups/light.json
var light_default = [
  {
    kind: "bitfield",
    name: "LightFlags",
    width: 32,
    fields: [
      "dynamic",
      "no specular",
      "don't light own object",
      "supersize in first person",
      "first person flashlight",
      "don't fade active camouflage"
    ]
  },
  {
    kind: "struct",
    name: "Light",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "LightFlags"
      },
      {
        kind: "field",
        name: "radius",
        type: "float"
      },
      {
        kind: "field",
        name: "radius modifer",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "falloff angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "cutoff angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "lens flare only radius",
        type: "float"
      },
      {
        kind: "field",
        name: "cos falloff angle",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "cos cutoff angle",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "specular radius multiplier",
        type: "float",
        cacheOnly: true,
        comment: "Not setting this to 2 breaks the first person flashlight."
      },
      {
        kind: "field",
        name: "sin cutoff angle",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "interpolation flags",
        type: "ColorInterpolationFlags"
      },
      {
        kind: "field",
        name: "color lower bound",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "color upper bound",
        type: "ColorARGB"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "primary cube map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "texture animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "texture animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "secondary cube map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "yaw function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "yaw period",
        type: "float"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "roll function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "roll period",
        type: "float"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "pitch function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "pitch period",
        type: "float"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "lens flare",
        type: "TagDependency",
        classes: [
          "lens_flare"
        ]
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "intensity",
        type: "float"
      },
      {
        kind: "field",
        name: "color",
        type: "ColorRGB"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "duration",
        type: "float"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "falloff function",
        type: "FunctionType"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "pad",
        size: 92
      }
    ],
    tagClass: "light",
    sizeBytes: 352
  }
];

// ../core/src/map/definitions/groups/light_volume.json
var light_volume_default = [
  {
    kind: "bitfield",
    name: "LightVolumeFlags",
    width: 16,
    fields: [
      "interpolate color in hsv",
      "more colors"
    ]
  },
  {
    kind: "struct",
    name: "LightVolumeFrame",
    fields: [
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "offset from marker",
        type: "float"
      },
      {
        kind: "field",
        name: "offset exponent",
        type: "float"
      },
      {
        kind: "field",
        name: "length",
        type: "float"
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "radius hither",
        type: "float"
      },
      {
        kind: "field",
        name: "radius yon",
        type: "float"
      },
      {
        kind: "field",
        name: "radius exponent",
        type: "float"
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "tint color hither",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "tint color yon",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "tint color exponent",
        type: "float"
      },
      {
        kind: "field",
        name: "brightness exponent",
        type: "float"
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    sizeBytes: 176
  },
  {
    kind: "struct",
    name: "LightVolume",
    fields: [
      {
        kind: "field",
        name: "attachment marker",
        type: "TagString"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "flags",
        type: "LightVolumeFlags"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "near fade distance",
        type: "float"
      },
      {
        kind: "field",
        name: "far fade distance",
        type: "float"
      },
      {
        kind: "field",
        name: "perpendicular brightness scale",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "parallel brightness scale",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "brightness scale source",
        type: "FunctionOut"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "sequence index",
        type: "Index"
      },
      {
        kind: "field",
        name: "count",
        type: "int16"
      },
      {
        kind: "pad",
        size: 72
      },
      {
        kind: "field",
        name: "frame animation source",
        type: "FunctionOut"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 36
      },
      {
        kind: "pad",
        size: 64
      },
      {
        kind: "field",
        name: "frames",
        type: "TagReflexive",
        struct: "LightVolumeFrame",
        maximum: 2
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    tagClass: "light_volume",
    sizeBytes: 332
  }
];

// ../core/src/map/definitions/groups/lightning.json
var lightning_default = [
  {
    kind: "bitfield",
    name: "LightningMarkerFlag",
    width: 16,
    fields: [
      "not connected to next marker"
    ]
  },
  {
    kind: "struct",
    name: "LightningMarker",
    fields: [
      {
        kind: "field",
        name: "attachment marker",
        type: "TagString"
      },
      {
        kind: "field",
        name: "flags",
        type: "LightningMarkerFlag"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "octaves to next marker",
        type: "int16"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 76
      },
      {
        kind: "field",
        name: "random position bounds",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "random jitter",
        type: "float"
      },
      {
        kind: "field",
        name: "thickness",
        type: "float"
      },
      {
        kind: "field",
        name: "tint",
        type: "ColorARGB"
      },
      {
        kind: "pad",
        size: 76
      }
    ],
    sizeBytes: 228
  },
  {
    kind: "struct",
    name: "LightningShader",
    fields: [
      {
        kind: "pad",
        size: 36
      },
      {
        kind: "field",
        name: "shader type",
        type: "ShaderType",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "shader flags",
        type: "ParticleShaderFlags"
      },
      {
        kind: "field",
        name: "framebuffer blend function",
        type: "FramebufferBlendFunction"
      },
      {
        kind: "field",
        name: "framebuffer fade mode",
        type: "FramebufferFadeMode"
      },
      {
        kind: "field",
        name: "bitmap flags",
        type: "IsUnfilteredFlag"
      },
      {
        kind: "pad",
        size: 28
      },
      {
        kind: "field",
        name: "secondary bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "anchor",
        type: "ParticleAnchor"
      },
      {
        kind: "field",
        name: "secondary bitmap flags",
        type: "IsUnfilteredFlag"
      },
      {
        kind: "field",
        name: "u animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "u animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "u animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "u animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "u animation scale",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "v animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "v animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation scale",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "rotation animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "rotation animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation scale",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation center",
        type: "Point2D"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "zsprite radius scale",
        type: "float"
      },
      {
        kind: "pad",
        size: 20
      }
    ],
    sizeBytes: 180
  },
  {
    kind: "struct",
    name: "Lightning",
    fields: [
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "count",
        type: "int16"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "near fade distance",
        type: "float"
      },
      {
        kind: "field",
        name: "far fade distance",
        type: "float"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "jitter scale source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "thickness scale source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "tint modulation source",
        type: "FunctionNameNullable"
      },
      {
        kind: "field",
        name: "brightness scale source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 84
      },
      {
        kind: "field",
        name: "markers",
        type: "TagReflexive",
        struct: "LightningMarker",
        maximum: 16
      },
      {
        kind: "field",
        name: "shader",
        type: "TagReflexive",
        struct: "LightningShader",
        maximum: 1
      },
      {
        kind: "pad",
        size: 88
      }
    ],
    tagClass: "lightning",
    sizeBytes: 264
  }
];

// ../core/src/map/definitions/groups/material_effects.json
var material_effects_default = [
  {
    kind: "struct",
    name: "MaterialEffectsMaterialEffectMaterial",
    fields: [
      {
        kind: "field",
        name: "effect",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "field",
        name: "sound",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "pad",
        size: 16
      }
    ],
    sizeBytes: 48
  },
  {
    kind: "struct",
    name: "MaterialEffectsMaterialEffect",
    fields: [
      {
        kind: "field",
        name: "materials",
        type: "TagReflexive",
        struct: "MaterialEffectsMaterialEffectMaterial",
        maximum: 33
      },
      {
        kind: "pad",
        size: 16
      }
    ],
    sizeBytes: 28
  },
  {
    kind: "struct",
    name: "MaterialEffects",
    fields: [
      {
        kind: "field",
        name: "effects",
        type: "TagReflexive",
        struct: "MaterialEffectsMaterialEffect",
        maximum: 13
      },
      {
        kind: "pad",
        size: 128
      }
    ],
    tagClass: "material_effects",
    sizeBytes: 140
  }
];

// ../core/src/map/definitions/groups/meter.json
var meter_default = [
  {
    kind: "enum",
    name: "MeterInterpolateColors",
    options: [
      "linearly",
      "faster near empty",
      "faster near full",
      "through random noise"
    ]
  },
  {
    kind: "enum",
    name: "MeterAnchorColors",
    options: [
      "at both ends",
      "at empty",
      "at full"
    ]
  },
  {
    kind: "struct",
    name: "Meter",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "IsUnusedFlag"
      },
      {
        kind: "field",
        name: "stencil bitmaps",
        type: "TagDependency",
        classes: [
          "bitmap"
        ],
        nonCached: true,
        comment: "Don't use this! This gets dereferenced on map build."
      },
      {
        kind: "field",
        name: "source bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ],
        nonCached: true,
        comment: "Don't use this! This gets dereferenced on map build."
      },
      {
        kind: "field",
        name: "stencil sequence index",
        type: "uint16"
      },
      {
        kind: "field",
        name: "source sequence index",
        type: "uint16"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "interpolate colors",
        type: "MeterInterpolateColors"
      },
      {
        kind: "field",
        name: "anchor colors",
        type: "MeterAnchorColors"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "empty color",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "full color",
        type: "ColorARGB"
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "unmask distance",
        type: "float"
      },
      {
        kind: "field",
        name: "mask distance",
        type: "float"
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "encoded stencil",
        type: "TagDataOffset",
        maximum: 65536,
        cacheOnly: true
      }
    ],
    tagClass: "meter",
    sizeBytes: 172
  }
];

// ../core/src/map/definitions/groups/model.json
var model_default = [
  {
    kind: "bitfield",
    name: "ModelRegionPermutationFlags",
    width: 32,
    fields: [
      "cannot be chosen randomly"
    ]
  },
  {
    kind: "bitfield",
    name: "ModelGeometryPartFlags",
    width: 32,
    fields: [
      "stripped internal",
      "zoner"
    ]
  },
  {
    kind: "bitfield",
    name: "ModelFlags",
    width: 32,
    fields: [
      "blend shared normals",
      "parts have local nodes",
      "ignore skinning"
    ]
  },
  {
    kind: "struct",
    name: "ModelMarkerInstance",
    fields: [
      {
        kind: "field",
        name: "region index",
        type: "uint8"
      },
      {
        kind: "field",
        name: "permutation index",
        type: "uint8"
      },
      {
        kind: "field",
        name: "node index",
        type: "uint8"
      },
      {
        kind: "pad",
        size: 1
      },
      {
        kind: "field",
        name: "translation",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "rotation",
        type: "Quaternion"
      }
    ],
    sizeBytes: 32
  },
  {
    kind: "struct",
    name: "ModelMarker",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "magic identifier",
        type: "int16"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "instances",
        type: "TagReflexive",
        struct: "ModelMarkerInstance",
        maximum: 32,
        extendedMaximum: 32767
      }
    ],
    sizeBytes: 64
  },
  {
    kind: "struct",
    name: "ModelNode",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "next sibling node index",
        type: "Index",
        struct: "Model"
      },
      {
        kind: "field",
        name: "first child node index",
        type: "Index",
        struct: "Model"
      },
      {
        kind: "field",
        name: "parent node index",
        type: "Index",
        struct: "Model"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "default translation",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "default rotation",
        type: "Quaternion"
      },
      {
        kind: "field",
        name: "node distance from parent",
        type: "float"
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "scale",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "rotation",
        type: "Matrix",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "translation",
        type: "Point3D",
        cacheOnly: true
      }
    ],
    sizeBytes: 156
  },
  {
    kind: "struct",
    name: "ModelRegionPermutationMarker",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "node index",
        type: "Index",
        struct: "Model"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "rotation",
        type: "Quaternion"
      },
      {
        kind: "field",
        name: "translation",
        type: "Point3D"
      },
      {
        kind: "pad",
        size: 16
      }
    ],
    sizeBytes: 80
  },
  {
    kind: "struct",
    name: "ModelRegionPermutation",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "flags",
        type: "ModelRegionPermutationFlags"
      },
      {
        kind: "field",
        name: "permutation number",
        type: "uint16",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "super low",
        type: "Index",
        struct: "Model"
      },
      {
        kind: "field",
        name: "low",
        type: "Index",
        struct: "Model"
      },
      {
        kind: "field",
        name: "medium",
        type: "Index",
        struct: "Model"
      },
      {
        kind: "field",
        name: "high",
        type: "Index",
        struct: "Model"
      },
      {
        kind: "field",
        name: "super high",
        type: "Index",
        struct: "Model"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "markers",
        type: "TagReflexive",
        struct: "ModelRegionPermutationMarker",
        maximum: 64,
        extendedMaximum: 32767
      }
    ],
    sizeBytes: 88
  },
  {
    kind: "struct",
    name: "ModelRegion",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "permutations",
        type: "TagReflexive",
        struct: "ModelRegionPermutation",
        maximum: 32,
        extendedMaximum: 255
      }
    ],
    sizeBytes: 76
  },
  {
    kind: "struct",
    name: "ModelVertexUncompressed",
    fields: [
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "normal",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "binormal",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "tangent",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "texture coords",
        type: "Point2D"
      },
      {
        kind: "field",
        name: "node0 index",
        type: "Index"
      },
      {
        kind: "field",
        name: "node1 index",
        type: "Index"
      },
      {
        kind: "field",
        name: "node0 weight",
        type: "float"
      },
      {
        kind: "field",
        name: "node1 weight",
        type: "float"
      }
    ],
    sizeBytes: 68
  },
  {
    kind: "struct",
    name: "ModelVertexCompressed",
    fields: [
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "normal",
        type: "uint32"
      },
      {
        kind: "field",
        name: "binormal",
        type: "uint32"
      },
      {
        kind: "field",
        name: "tangent",
        type: "uint32"
      },
      {
        kind: "field",
        name: "texture coordinate u",
        type: "int16"
      },
      {
        kind: "field",
        name: "texture coordinate v",
        type: "int16"
      },
      {
        kind: "field",
        name: "node0 index",
        type: "int8"
      },
      {
        kind: "field",
        name: "node1 index",
        type: "int8"
      },
      {
        kind: "field",
        name: "node0 weight",
        type: "uint16"
      }
    ],
    sizeBytes: 32
  },
  {
    kind: "struct",
    name: "ModelTriangle",
    fields: [
      {
        kind: "field",
        name: "vertex0 index",
        type: "Index"
      },
      {
        kind: "field",
        name: "vertex1 index",
        type: "Index"
      },
      {
        kind: "field",
        name: "vertex2 index",
        type: "Index"
      }
    ],
    sizeBytes: 6
  },
  {
    kind: "struct",
    name: "ModelGeometryPart",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "ModelGeometryPartFlags"
      },
      {
        kind: "field",
        name: "shader index",
        type: "Index",
        struct: "Model"
      },
      {
        kind: "field",
        name: "prev filthy part index",
        type: "uint8",
        comment: "Defaults to 255 only if next filthy part index is also zero"
      },
      {
        kind: "field",
        name: "next filthy part index",
        type: "uint8",
        comment: "Defaults to 255 only if prev filthy part index is also zero"
      },
      {
        kind: "field",
        name: "centroid primary node",
        type: "Index",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "centroid secondary node",
        type: "Index",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "centroid primary weight",
        type: "Fraction",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "centroid secondary weight",
        type: "Fraction",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "centroid",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "uncompressed vertices",
        type: "TagReflexive",
        struct: "ModelVertexUncompressed",
        maximum: 65535,
        nonCached: true
      },
      {
        kind: "field",
        name: "compressed vertices",
        type: "TagReflexive",
        struct: "ModelVertexCompressed",
        maximum: 65535,
        nonCached: true
      },
      {
        kind: "field",
        name: "triangles",
        type: "TagReflexive",
        struct: "ModelTriangle",
        maximum: 65535,
        nonCached: true
      },
      {
        kind: "field",
        name: "triangle buffer type",
        type: "TriangleBufferType",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "triangle count",
        type: "uint32",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "triangle offset",
        type: "uint32",
        cacheOnly: true,
        comment: "On Xbox: pointer to the triangle indices. On PC: offset to triangles relative to the end of the map's vertex data."
      },
      {
        kind: "field",
        name: "triangle offset 2",
        type: "uint32",
        cacheOnly: true,
        comment: "On Xbox: pointer to the entry in the second parts list which points to the triangle indices. On PC: same value as the first triangle offset"
      },
      {
        kind: "field",
        name: "vertex type",
        type: "VertexType",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "vertex count",
        type: "uint32",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "vertex pointer",
        type: "Pointer",
        cacheOnly: true,
        comment: "Appears to be a pointer to the uncompressed vertices"
      },
      {
        kind: "field",
        name: "vertex offset",
        type: "uint32",
        cacheOnly: true,
        comment: "On Xbox: pointer to the entry in the second parts list which points to the triangle indices. On PC: offset to first vertex relative to the map's vertex data."
      }
    ],
    sizeBytes: 104
  },
  {
    kind: "struct",
    name: "ModelGeometry",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "IsUnusedFlag"
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "parts",
        type: "TagReflexive",
        struct: "ModelGeometryPart",
        maximum: 32,
        extendedMaximum: 32767
      }
    ],
    sizeBytes: 48
  },
  {
    kind: "struct",
    name: "ModelShaderReference",
    fields: [
      {
        kind: "field",
        name: "shader",
        type: "TagDependency",
        classes: [
          "shader"
        ]
      },
      {
        kind: "field",
        name: "permutation",
        type: "Index"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 12
      }
    ],
    sizeBytes: 32
  },
  {
    kind: "struct",
    name: "Model",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "ModelFlags"
      },
      {
        kind: "field",
        name: "node list checksum",
        type: "int32"
      },
      {
        kind: "field",
        name: "super high detail cutoff",
        type: "float"
      },
      {
        kind: "field",
        name: "high detail cutoff",
        type: "float"
      },
      {
        kind: "field",
        name: "medium detail cutoff",
        type: "float"
      },
      {
        kind: "field",
        name: "low detail cutoff",
        type: "float"
      },
      {
        kind: "field",
        name: "super low detail cutoff",
        type: "float"
      },
      {
        kind: "field",
        name: "super low detail node count",
        type: "uint16",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "low detail node count",
        type: "uint16",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "medium detail node count",
        type: "uint16",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "high detail node count",
        type: "uint16",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "super high detail node count",
        type: "uint16",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "base map u scale",
        type: "float"
      },
      {
        kind: "field",
        name: "base map v scale",
        type: "float"
      },
      {
        kind: "pad",
        size: 116
      },
      {
        kind: "field",
        name: "markers",
        type: "TagReflexive",
        struct: "ModelMarker",
        maximum: 0
      },
      {
        kind: "field",
        name: "nodes",
        type: "TagReflexive",
        struct: "ModelNode",
        maximum: 64,
        extendedMaximum: 255
      },
      {
        kind: "field",
        name: "regions",
        type: "TagReflexive",
        struct: "ModelRegion",
        maximum: 32,
        extendedMaximum: 255
      },
      {
        kind: "field",
        name: "geometries",
        type: "TagReflexive",
        struct: "ModelGeometry",
        maximum: 256,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "shaders",
        type: "TagReflexive",
        struct: "ModelShaderReference",
        maximum: 32,
        extendedMaximum: 32767
      }
    ],
    tagClass: "model",
    sizeBytes: 232
  }
];

// ../core/src/map/definitions/groups/model_animations.json
var model_animations_default = [
  {
    kind: "enum",
    name: "AnimationFunction",
    options: [
      "a out",
      "b out",
      "c out",
      "d out"
    ]
  },
  {
    kind: "enum",
    name: "AnimationFunctionControls",
    options: [
      "frame",
      "scale"
    ]
  },
  {
    kind: "enum",
    name: "AnimationType",
    options: [
      "base",
      "overlay",
      "replacement"
    ]
  },
  {
    kind: "enum",
    name: "AnimationFrameInfoType",
    options: [
      "none",
      "dx dy",
      "dx dy dyaw",
      "dx dy dz dyaw"
    ]
  },
  {
    kind: "bitfield",
    name: "ModelAnimationsAnimationGraphNodeFlags",
    width: 32,
    fields: [
      "ball socket",
      "hinge",
      "no movement"
    ]
  },
  {
    kind: "bitfield",
    name: "ModelAnimationsAnimationFlags",
    width: 16,
    fields: [
      "compressed data",
      "world relative",
      "25hz pal"
    ]
  },
  {
    kind: "bitfield",
    name: "ModelAnimationsFlags",
    width: 16,
    fields: [
      "compress all animations",
      "force idle compression"
    ]
  },
  {
    kind: "struct",
    name: "ModelAnimationsRotation",
    fields: [
      {
        kind: "field",
        name: "rotation",
        type: "int16",
        count: 4
      }
    ],
    sizeBytes: 8
  },
  {
    kind: "struct",
    name: "ModelAnimationsTransform",
    fields: [
      {
        kind: "field",
        name: "transform",
        type: "Point3D"
      }
    ],
    sizeBytes: 12
  },
  {
    kind: "struct",
    name: "ModelAnimationscale",
    fields: [
      {
        kind: "field",
        name: "scale",
        type: "Fraction"
      }
    ],
    sizeBytes: 4
  },
  {
    kind: "struct",
    name: "ModelAnimationsFrameInfoDxDy",
    fields: [
      {
        kind: "field",
        name: "dx",
        type: "float"
      },
      {
        kind: "field",
        name: "dy",
        type: "float"
      }
    ],
    sizeBytes: 8
  },
  {
    kind: "struct",
    name: "ModelAnimationsFrameInfoDxDyDyaw",
    fields: [
      {
        kind: "field",
        name: "dx",
        type: "float"
      },
      {
        kind: "field",
        name: "dy",
        type: "float"
      },
      {
        kind: "field",
        name: "dyaw",
        type: "float"
      }
    ],
    sizeBytes: 12
  },
  {
    kind: "struct",
    name: "ModelAnimationsFrameInfoDxDyDzDyaw",
    fields: [
      {
        kind: "field",
        name: "dx",
        type: "float"
      },
      {
        kind: "field",
        name: "dy",
        type: "float"
      },
      {
        kind: "field",
        name: "dz",
        type: "float"
      },
      {
        kind: "field",
        name: "dyaw",
        type: "float"
      }
    ],
    sizeBytes: 16
  },
  {
    kind: "struct",
    name: "ModelAnimationsAnimationGraphObjectOverlay",
    fields: [
      {
        kind: "field",
        name: "animation",
        type: "Index",
        struct: "ModelAnimations"
      },
      {
        kind: "field",
        name: "function",
        type: "AnimationFunction"
      },
      {
        kind: "field",
        name: "function controls",
        type: "AnimationFunctionControls"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 12
      }
    ],
    sizeBytes: 20
  },
  {
    kind: "struct",
    name: "ModelAnimationsUnitSeatAnimation",
    fields: [
      {
        kind: "field",
        name: "animation",
        type: "Index",
        struct: "ModelAnimations"
      }
    ],
    sizeBytes: 2
  },
  {
    kind: "struct",
    name: "ModelAnimationsAnimationGraphUnitSeatikPoint",
    fields: [
      {
        kind: "field",
        name: "marker",
        type: "TagString"
      },
      {
        kind: "field",
        name: "attach to marker",
        type: "TagString"
      }
    ],
    sizeBytes: 64
  },
  {
    kind: "struct",
    name: "ModelAnimationsAnimationWeaponClassAnimation",
    fields: [
      {
        kind: "field",
        name: "animation",
        type: "Index",
        struct: "ModelAnimations"
      }
    ],
    sizeBytes: 2
  },
  {
    kind: "struct",
    name: "ModelAnimationsAnimationWeaponTypeAnimation",
    fields: [
      {
        kind: "field",
        name: "animation",
        type: "Index",
        struct: "ModelAnimations"
      }
    ],
    sizeBytes: 2
  },
  {
    kind: "struct",
    name: "ModelAnimationsAnimationGraphWeaponType",
    fields: [
      {
        kind: "field",
        name: "label",
        type: "TagString"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "animations",
        type: "TagReflexive",
        struct: "ModelAnimationsAnimationWeaponTypeAnimation",
        maximum: 10
      }
    ],
    sizeBytes: 60
  },
  {
    kind: "struct",
    name: "ModelAnimationsAnimationGraphWeapon",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "grip marker",
        type: "TagString"
      },
      {
        kind: "field",
        name: "hand marker",
        type: "TagString"
      },
      {
        kind: "field",
        name: "right yaw per frame",
        type: "Angle"
      },
      {
        kind: "field",
        name: "left yaw per frame",
        type: "Angle"
      },
      {
        kind: "field",
        name: "right frame count",
        type: "uint16"
      },
      {
        kind: "field",
        name: "left frame count",
        type: "uint16"
      },
      {
        kind: "field",
        name: "down pitch per frame",
        type: "Angle"
      },
      {
        kind: "field",
        name: "up pitch per frame",
        type: "Angle"
      },
      {
        kind: "field",
        name: "down pitch frame count",
        type: "uint16"
      },
      {
        kind: "field",
        name: "up pitch frame count",
        type: "uint16"
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "animations",
        type: "TagReflexive",
        struct: "ModelAnimationsAnimationWeaponClassAnimation",
        maximum: 55
      },
      {
        kind: "field",
        name: "ik point",
        type: "TagReflexive",
        struct: "ModelAnimationsAnimationGraphUnitSeatikPoint",
        maximum: 8
      },
      {
        kind: "field",
        name: "weapon types",
        type: "TagReflexive",
        struct: "ModelAnimationsAnimationGraphWeaponType",
        maximum: 64
      }
    ],
    sizeBytes: 188
  },
  {
    kind: "struct",
    name: "ModelAnimationsAnimationGraphUnitSeat",
    fields: [
      {
        kind: "field",
        name: "label",
        type: "TagString"
      },
      {
        kind: "field",
        name: "right yaw per frame",
        type: "Angle"
      },
      {
        kind: "field",
        name: "left yaw per frame",
        type: "Angle"
      },
      {
        kind: "field",
        name: "right frame count",
        type: "uint16"
      },
      {
        kind: "field",
        name: "left frame count",
        type: "uint16"
      },
      {
        kind: "field",
        name: "down pitch per frame",
        type: "Angle"
      },
      {
        kind: "field",
        name: "up pitch per frame",
        type: "Angle"
      },
      {
        kind: "field",
        name: "down pitch frame count",
        type: "uint16"
      },
      {
        kind: "field",
        name: "up pitch frame count",
        type: "uint16"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "animations",
        type: "TagReflexive",
        struct: "ModelAnimationsAnimationWeaponClassAnimation",
        maximum: 30
      },
      {
        kind: "field",
        name: "ik points",
        type: "TagReflexive",
        struct: "ModelAnimationsAnimationGraphUnitSeatikPoint",
        maximum: 8
      },
      {
        kind: "field",
        name: "weapons",
        type: "TagReflexive",
        struct: "ModelAnimationsAnimationGraphWeapon",
        maximum: 64
      }
    ],
    sizeBytes: 100
  },
  {
    kind: "struct",
    name: "ModelAnimationsWeaponAnimation",
    fields: [
      {
        kind: "field",
        name: "animation",
        type: "Index",
        struct: "ModelAnimations"
      }
    ],
    sizeBytes: 2
  },
  {
    kind: "struct",
    name: "ModelAnimationsAnimationGraphWeaponAnimations",
    fields: [
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "animations",
        type: "TagReflexive",
        struct: "ModelAnimationsWeaponAnimation",
        maximum: 11
      }
    ],
    sizeBytes: 28
  },
  {
    kind: "struct",
    name: "ModelAnimationsVehicleAnimation",
    fields: [
      {
        kind: "field",
        name: "animation",
        type: "Index",
        struct: "ModelAnimations"
      }
    ],
    sizeBytes: 2
  },
  {
    kind: "struct",
    name: "ModelAnimationSuspensionAnimation",
    fields: [
      {
        kind: "field",
        name: "mass point index",
        type: "Index"
      },
      {
        kind: "field",
        name: "animation",
        type: "Index",
        struct: "ModelAnimations"
      },
      {
        kind: "field",
        name: "full extension ground depth",
        type: "float"
      },
      {
        kind: "field",
        name: "full compression ground depth",
        type: "float"
      },
      {
        kind: "pad",
        size: 8
      }
    ],
    sizeBytes: 20
  },
  {
    kind: "struct",
    name: "ModelAnimationsAnimationGraphVehicleAnimations",
    fields: [
      {
        kind: "field",
        name: "right yaw per frame",
        type: "Angle"
      },
      {
        kind: "field",
        name: "left yaw per frame",
        type: "Angle"
      },
      {
        kind: "field",
        name: "right frame count",
        type: "uint16"
      },
      {
        kind: "field",
        name: "left frame count",
        type: "uint16"
      },
      {
        kind: "field",
        name: "down pitch per frame",
        type: "Angle"
      },
      {
        kind: "field",
        name: "up pitch per frame",
        type: "Angle"
      },
      {
        kind: "field",
        name: "down pitch frame count",
        type: "uint16"
      },
      {
        kind: "field",
        name: "up pitch frame count",
        type: "uint16"
      },
      {
        kind: "pad",
        size: 68
      },
      {
        kind: "field",
        name: "animations",
        type: "TagReflexive",
        struct: "ModelAnimationsVehicleAnimation",
        maximum: 8
      },
      {
        kind: "field",
        name: "suspension animations",
        type: "TagReflexive",
        struct: "ModelAnimationSuspensionAnimation",
        maximum: 32
      }
    ],
    sizeBytes: 116
  },
  {
    kind: "struct",
    name: "ModelAnimationsDeviceAnimation",
    fields: [
      {
        kind: "field",
        name: "animation",
        type: "Index",
        struct: "ModelAnimations"
      }
    ],
    sizeBytes: 2
  },
  {
    kind: "struct",
    name: "ModelAnimationsDeviceAnimations",
    fields: [
      {
        kind: "pad",
        size: 84
      },
      {
        kind: "field",
        name: "animations",
        type: "TagReflexive",
        struct: "ModelAnimationsDeviceAnimation",
        maximum: 2
      }
    ],
    sizeBytes: 96
  },
  {
    kind: "struct",
    name: "ModelAnimationsUnitDamageAnimations",
    fields: [
      {
        kind: "field",
        name: "animation",
        type: "Index",
        struct: "ModelAnimations"
      }
    ],
    sizeBytes: 2
  },
  {
    kind: "struct",
    name: "ModelAnimationsFirstPersonWeapon",
    fields: [
      {
        kind: "field",
        name: "animation",
        type: "Index",
        struct: "ModelAnimations"
      }
    ],
    sizeBytes: 2
  },
  {
    kind: "struct",
    name: "ModelAnimationsAnimationGraphFirstPersonWeaponAnimations",
    fields: [
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "animations",
        type: "TagReflexive",
        struct: "ModelAnimationsFirstPersonWeapon",
        maximum: 30
      }
    ],
    sizeBytes: 28
  },
  {
    kind: "struct",
    name: "ModelAnimationsAnimationGraphSoundReference",
    fields: [
      {
        kind: "field",
        name: "sound",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "pad",
        size: 4
      }
    ],
    sizeBytes: 20
  },
  {
    kind: "struct",
    name: "ModelAnimationsAnimationGraphNode",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "next sibling node index",
        type: "Index",
        struct: "ModelAnimations"
      },
      {
        kind: "field",
        name: "first child node index",
        type: "Index",
        struct: "ModelAnimations"
      },
      {
        kind: "field",
        name: "parent node index",
        type: "Index",
        struct: "ModelAnimations"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "node joint flags",
        type: "ModelAnimationsAnimationGraphNodeFlags"
      },
      {
        kind: "field",
        name: "base vector",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "vector range",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      }
    ],
    sizeBytes: 64
  },
  {
    kind: "struct",
    name: "ModelAnimationsAnimation",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "type",
        type: "AnimationType"
      },
      {
        kind: "field",
        name: "frame count",
        type: "uint16"
      },
      {
        kind: "field",
        name: "frame size",
        type: "uint16"
      },
      {
        kind: "field",
        name: "frame info type",
        type: "AnimationFrameInfoType"
      },
      {
        kind: "field",
        name: "node list checksum",
        type: "int32"
      },
      {
        kind: "field",
        name: "node count",
        type: "uint16"
      },
      {
        kind: "field",
        name: "loop frame index",
        type: "Index"
      },
      {
        kind: "field",
        name: "weight",
        type: "Fraction"
      },
      {
        kind: "field",
        name: "key frame index",
        type: "Index"
      },
      {
        kind: "field",
        name: "second key frame index",
        type: "Index"
      },
      {
        kind: "field",
        name: "next animation",
        type: "Index",
        struct: "ModelAnimations"
      },
      {
        kind: "field",
        name: "flags",
        type: "ModelAnimationsAnimationFlags"
      },
      {
        kind: "field",
        name: "sound",
        type: "Index",
        struct: "ModelAnimations"
      },
      {
        kind: "field",
        name: "sound frame index",
        type: "Index"
      },
      {
        kind: "field",
        name: "left foot frame index",
        type: "int8"
      },
      {
        kind: "field",
        name: "right foot frame index",
        type: "int8"
      },
      {
        kind: "field",
        name: "main animation index",
        type: "uint16",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "relative weight",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "frame info",
        type: "TagDataOffset",
        maximum: 32768
      },
      {
        kind: "field",
        name: "node transform flag data",
        type: "uint32",
        count: 2,
        comment: "These are two bitfields. Each bits refer to a node to which the transformation applies. The first field refers to the first 32 nodes and the second field is the second 32 nodes."
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "node rotation flag data",
        type: "uint32",
        count: 2,
        comment: "These are two bitfields. Each bits refer to a node to which the transformation applies. The first field refers to the first 32 nodes and the second field is the second 32 nodes."
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "node scale flag data",
        type: "uint32",
        count: 2,
        comment: "These are two bitfields. Each bits refer to a node to which the transformation applies. The first field refers to the first 32 nodes and the second field is the second 32 nodes."
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "offset to compressed data",
        type: "uint32"
      },
      {
        kind: "field",
        name: "default data",
        type: "TagDataOffset",
        maximum: 16384
      },
      {
        kind: "field",
        name: "frame data",
        type: "TagDataOffset",
        maximum: 1048576
      }
    ],
    sizeBytes: 180
  },
  {
    kind: "struct",
    name: "ModelAnimations",
    fields: [
      {
        kind: "field",
        name: "objects",
        type: "TagReflexive",
        struct: "ModelAnimationsAnimationGraphObjectOverlay",
        maximum: 4
      },
      {
        kind: "field",
        name: "units",
        type: "TagReflexive",
        struct: "ModelAnimationsAnimationGraphUnitSeat",
        maximum: 2048
      },
      {
        kind: "field",
        name: "weapons",
        type: "TagReflexive",
        struct: "ModelAnimationsAnimationGraphWeaponAnimations",
        maximum: 1
      },
      {
        kind: "field",
        name: "vehicles",
        type: "TagReflexive",
        struct: "ModelAnimationsAnimationGraphVehicleAnimations",
        maximum: 1
      },
      {
        kind: "field",
        name: "devices",
        type: "TagReflexive",
        struct: "ModelAnimationsDeviceAnimations",
        maximum: 1
      },
      {
        kind: "field",
        name: "unit damage",
        type: "TagReflexive",
        struct: "ModelAnimationsUnitDamageAnimations",
        maximum: 176
      },
      {
        kind: "field",
        name: "first person weapons",
        type: "TagReflexive",
        struct: "ModelAnimationsAnimationGraphFirstPersonWeaponAnimations",
        maximum: 1
      },
      {
        kind: "field",
        name: "sound references",
        type: "TagReflexive",
        struct: "ModelAnimationsAnimationGraphSoundReference",
        maximum: 512,
        extendedMaximum: 2048
      },
      {
        kind: "field",
        name: "limp body node radius",
        type: "float"
      },
      {
        kind: "field",
        name: "flags",
        type: "ModelAnimationsFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "nodes",
        type: "TagReflexive",
        struct: "ModelAnimationsAnimationGraphNode",
        maximum: 64
      },
      {
        kind: "field",
        name: "animations",
        type: "TagReflexive",
        struct: "ModelAnimationsAnimation",
        maximum: 2048
      }
    ],
    tagClass: "model_animations",
    sizeBytes: 128
  }
];

// ../core/src/map/definitions/groups/model_collision_geometry.json
var model_collision_geometry_default = [
  {
    kind: "bitfield",
    name: "ModelCollisionGeometryMaterialFlags",
    width: 32,
    fields: [
      "head"
    ]
  },
  {
    kind: "bitfield",
    name: "ModelCollisionGeometryRegionFlags",
    width: 32,
    fields: [
      "lives until object dies",
      "forces object to die",
      "dies when object dies",
      "dies when object is damaged",
      "disappears when shield is off",
      "inhibits melee attack",
      "inhibits weapon attack",
      "inhibits walking",
      "forces drop weapon",
      "causes head maimed scream"
    ]
  },
  {
    kind: "bitfield",
    name: "ModelCollisionGeometryBSPLeafFlags",
    width: 16,
    fields: [
      "contains double sided surfaces"
    ]
  },
  {
    kind: "bitfield",
    name: "ModelCollisionGeometryBSPSurfaceFlags",
    width: 8,
    fields: [
      "two sided",
      "invisible",
      "climbable",
      "breakable"
    ]
  },
  {
    kind: "bitfield",
    name: "ModelCollisionGeometryFlags",
    width: 32,
    fields: [
      "takes shield damage for children",
      "takes body damage for children",
      "always shields friendly damage",
      "passes area damage to children",
      "parent never takes body damage for us",
      "only damaged by explosives",
      "only damaged while occupied"
    ]
  },
  {
    kind: "struct",
    name: "ModelCollisionGeometryMaterial",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "flags",
        type: "ModelCollisionGeometryMaterialFlags"
      },
      {
        kind: "field",
        name: "material type",
        type: "MaterialType"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "shield leak percentage",
        type: "Fraction"
      },
      {
        kind: "field",
        name: "shield damage multiplier",
        type: "float"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "body damage multiplier",
        type: "float"
      },
      {
        kind: "pad",
        size: 8
      }
    ],
    sizeBytes: 72
  },
  {
    kind: "struct",
    name: "ModelCollisionGeometryPermutation",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      }
    ],
    sizeBytes: 32
  },
  {
    kind: "struct",
    name: "ModelCollisionGeometryRegion",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "flags",
        type: "ModelCollisionGeometryRegionFlags"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "damage threshold",
        type: "float"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "destroyed effect",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "field",
        name: "permutations",
        type: "TagReflexive",
        struct: "ModelCollisionGeometryPermutation",
        maximum: 32
      }
    ],
    sizeBytes: 84
  },
  {
    kind: "struct",
    name: "ModelCollisionGeometryModifier",
    fields: [
      {
        kind: "pad",
        size: 52
      }
    ],
    sizeBytes: 52
  },
  {
    kind: "struct",
    name: "ModelCollisionGeometrySphere",
    fields: [
      {
        kind: "field",
        name: "node",
        type: "Index",
        struct: "ModelCollisionGeometry"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "center",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "radius",
        type: "float"
      }
    ],
    sizeBytes: 32
  },
  {
    kind: "struct",
    name: "ModelCollisionGeometryBSP3DNode",
    fields: [
      {
        kind: "field",
        name: "plane",
        type: "uint32"
      },
      {
        kind: "field",
        name: "back child",
        type: "uint32",
        flagged: true,
        comment: "refers to a BSP3D node if not signed and a leaf if sign bit is set; null if 0xFFFFFFFF"
      },
      {
        kind: "field",
        name: "front child",
        type: "uint32",
        flagged: true,
        comment: "refers to a BSP3D node if not signed and a leaf if sign bit is set; null if 0xFFFFFFFF"
      }
    ],
    sizeBytes: 12
  },
  {
    kind: "struct",
    name: "ModelCollisionGeometryBSPPlane",
    fields: [
      {
        kind: "field",
        name: "plane",
        type: "Plane3D"
      }
    ],
    sizeBytes: 16
  },
  {
    kind: "struct",
    name: "ModelCollisionGeometryBSPLeaf",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "ModelCollisionGeometryBSPLeafFlags"
      },
      {
        kind: "field",
        name: "bsp2d reference count",
        type: "uint16"
      },
      {
        kind: "field",
        name: "first bsp2d reference",
        type: "uint32"
      }
    ],
    sizeBytes: 8
  },
  {
    kind: "struct",
    name: "ModelCollisionGeometryBSP2DReference",
    fields: [
      {
        kind: "field",
        name: "plane",
        type: "uint32",
        flagged: true
      },
      {
        kind: "field",
        name: "bsp2d node",
        type: "uint32",
        flagged: true,
        comment: "refers to a BSP2D node if not signed and a surface if sign bit is set; null if 0xFFFFFFFF"
      }
    ],
    sizeBytes: 8
  },
  {
    kind: "struct",
    name: "ModelCollisionGeometryBSP2DNode",
    fields: [
      {
        kind: "field",
        name: "plane",
        type: "Plane2D"
      },
      {
        kind: "field",
        name: "left child",
        type: "uint32",
        flagged: true,
        comment: "refers to a BSP2D node if not signed and a surface if sign bit is set; null if 0xFFFFFFFF"
      },
      {
        kind: "field",
        name: "right child",
        type: "uint32",
        flagged: true,
        comment: "refers to a BSP2D node if not signed and a surface if sign bit is set; null if 0xFFFFFFFF"
      }
    ],
    sizeBytes: 20
  },
  {
    kind: "struct",
    name: "ModelCollisionGeometryBSPSurface",
    fields: [
      {
        kind: "field",
        name: "plane",
        type: "uint32",
        flagged: true
      },
      {
        kind: "field",
        name: "first edge",
        type: "uint32"
      },
      {
        kind: "field",
        name: "flags",
        type: "ModelCollisionGeometryBSPSurfaceFlags"
      },
      {
        kind: "field",
        name: "breakable surface",
        type: "int8"
      },
      {
        kind: "field",
        name: "material",
        type: "Index"
      }
    ],
    sizeBytes: 12
  },
  {
    kind: "struct",
    name: "ModelCollisionGeometryBSPEdge",
    fields: [
      {
        kind: "field",
        name: "start vertex",
        type: "uint32"
      },
      {
        kind: "field",
        name: "end vertex",
        type: "uint32"
      },
      {
        kind: "field",
        name: "forward edge",
        type: "uint32"
      },
      {
        kind: "field",
        name: "reverse edge",
        type: "uint32"
      },
      {
        kind: "field",
        name: "left surface",
        type: "uint32"
      },
      {
        kind: "field",
        name: "right surface",
        type: "uint32"
      }
    ],
    sizeBytes: 24
  },
  {
    kind: "struct",
    name: "ModelCollisionGeometryBSPVertex",
    fields: [
      {
        kind: "field",
        name: "point",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "first edge",
        type: "uint32"
      }
    ],
    sizeBytes: 16
  },
  {
    kind: "struct",
    name: "ModelCollisionGeometryBSP",
    fields: [
      {
        kind: "field",
        name: "bsp3d nodes",
        type: "TagReflexive",
        struct: "ModelCollisionGeometryBSP3DNode",
        maximum: 131072
      },
      {
        kind: "field",
        name: "planes",
        type: "TagReflexive",
        struct: "ModelCollisionGeometryBSPPlane",
        maximum: 65536
      },
      {
        kind: "field",
        name: "leaves",
        type: "TagReflexive",
        struct: "ModelCollisionGeometryBSPLeaf",
        maximum: 65536
      },
      {
        kind: "field",
        name: "bsp2d references",
        type: "TagReflexive",
        struct: "ModelCollisionGeometryBSP2DReference",
        maximum: 131072
      },
      {
        kind: "field",
        name: "bsp2d nodes",
        type: "TagReflexive",
        struct: "ModelCollisionGeometryBSP2DNode",
        maximum: 65535
      },
      {
        kind: "field",
        name: "surfaces",
        type: "TagReflexive",
        struct: "ModelCollisionGeometryBSPSurface",
        maximum: 131072
      },
      {
        kind: "field",
        name: "edges",
        type: "TagReflexive",
        struct: "ModelCollisionGeometryBSPEdge",
        maximum: 262144
      },
      {
        kind: "field",
        name: "vertices",
        type: "TagReflexive",
        struct: "ModelCollisionGeometryBSPVertex",
        maximum: 131072
      }
    ],
    sizeBytes: 96
  },
  {
    kind: "struct",
    name: "ModelCollisionGeometryNode",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "region",
        type: "Index"
      },
      {
        kind: "field",
        name: "parent node",
        type: "Index",
        struct: "ModelCollisionGeometry"
      },
      {
        kind: "field",
        name: "next sibling node",
        type: "Index",
        struct: "ModelCollisionGeometry"
      },
      {
        kind: "field",
        name: "first child node",
        type: "Index",
        struct: "ModelCollisionGeometry"
      },
      {
        kind: "pad",
        size: 10
      },
      {
        kind: "field",
        name: "name thing",
        type: "int16",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "bsps",
        type: "TagReflexive",
        struct: "ModelCollisionGeometryBSP",
        maximum: 32
      }
    ],
    sizeBytes: 64
  },
  {
    kind: "struct",
    name: "ModelCollisionGeometry",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "ModelCollisionGeometryFlags"
      },
      {
        kind: "field",
        name: "indirect damage material",
        type: "Index"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "maximum body vitality",
        type: "float"
      },
      {
        kind: "field",
        name: "body system shock",
        type: "float"
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "pad",
        size: 28
      },
      {
        kind: "field",
        name: "friendly damage resistance",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "localized damage effect",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "field",
        name: "area damage effect threshold",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "area damage effect",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "field",
        name: "body damaged threshold",
        type: "float"
      },
      {
        kind: "field",
        name: "body damaged effect",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "field",
        name: "body depleted effect",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "field",
        name: "body destroyed threshold",
        type: "float"
      },
      {
        kind: "field",
        name: "body destroyed effect",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "field",
        name: "maximum shield vitality",
        type: "float"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "shield material type",
        type: "MaterialType"
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "shield failure function",
        type: "FunctionType"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "shield failure threshold",
        type: "Fraction"
      },
      {
        kind: "field",
        name: "failing shield leak fraction",
        type: "Fraction"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "minimum stun damage",
        type: "float"
      },
      {
        kind: "field",
        name: "stun time",
        type: "float"
      },
      {
        kind: "field",
        name: "recharge time",
        type: "float"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 96
      },
      {
        kind: "field",
        name: "shield damaged threshold",
        type: "float"
      },
      {
        kind: "field",
        name: "shield damaged effect",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "field",
        name: "shield depleted effect",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "field",
        name: "shield recharging effect",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "shield recharge rate",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 112
      },
      {
        kind: "field",
        name: "materials",
        type: "TagReflexive",
        struct: "ModelCollisionGeometryMaterial",
        maximum: 32
      },
      {
        kind: "field",
        name: "regions",
        type: "TagReflexive",
        struct: "ModelCollisionGeometryRegion",
        maximum: 8
      },
      {
        kind: "field",
        name: "modifiers",
        type: "TagReflexive",
        struct: "ModelCollisionGeometryModifier",
        maximum: 0
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "x",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "y",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "z",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "pathfinding spheres",
        type: "TagReflexive",
        struct: "ModelCollisionGeometrySphere",
        maximum: 256
      },
      {
        kind: "field",
        name: "nodes",
        type: "TagReflexive",
        struct: "ModelCollisionGeometryNode",
        maximum: 64
      }
    ],
    tagClass: "model_collision_geometry",
    sizeBytes: 664
  }
];

// ../core/src/map/definitions/groups/multiplayer_scenario_description.json
var multiplayer_scenario_description_default = [
  {
    kind: "struct",
    name: "MultiplayerScenarioDescriptionScenarioDescription",
    fields: [
      {
        kind: "field",
        name: "descriptive bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "displayed map name",
        type: "TagDependency",
        classes: [
          "unicode_string_list"
        ]
      },
      {
        kind: "field",
        name: "scenario tag directory path",
        type: "TagString"
      },
      {
        kind: "pad",
        size: 4
      }
    ],
    sizeBytes: 68
  },
  {
    kind: "struct",
    name: "MultiplayerScenarioDescription",
    fields: [
      {
        kind: "field",
        name: "multiplayer scenarios",
        type: "TagReflexive",
        struct: "MultiplayerScenarioDescriptionScenarioDescription",
        maximum: 32
      }
    ],
    tagClass: "multiplayer_scenario_description",
    sizeBytes: 12
  }
];

// ../core/src/map/definitions/groups/object.json
var object_default = [
  {
    kind: "enum",
    name: "PredictedResourceType",
    options: [
      "bitmap",
      "sound"
    ]
  },
  {
    kind: "struct",
    name: "PredictedResource",
    fields: [
      {
        kind: "field",
        name: "type",
        type: "PredictedResourceType"
      },
      {
        kind: "field",
        name: "resource index",
        type: "Index"
      },
      {
        kind: "field",
        name: "tag",
        type: "TagID"
      }
    ],
    sizeBytes: 8
  },
  {
    kind: "enum",
    name: "ObjectNoise",
    options: [
      "silent",
      "medium",
      "loud",
      "shout",
      "quiet"
    ]
  },
  {
    kind: "enum",
    name: "ObjectFunctionIn",
    options: [
      "none",
      "body vitality",
      "shield vitality",
      "recent body damage",
      "recent shield damage",
      "random constant",
      "umbrella shield vitality",
      "shield stun",
      "recent umbrella shield vitality",
      "umbrella shield stun",
      "region",
      "region 1",
      "region 2",
      "region 3",
      "region 4",
      "region 5",
      "region 6",
      "region 7",
      "alive",
      "compass"
    ]
  },
  {
    kind: "enum",
    name: "ObjectType",
    options: [
      "biped",
      "vehicle",
      "weapon",
      "equipment",
      "garbage",
      "projectile",
      "scenery",
      "device machine",
      "device control",
      "device light fixture",
      "placeholder",
      "sound scenery"
    ]
  },
  {
    kind: "bitfield",
    name: "ObjectFunctionFlags",
    width: 32,
    fields: [
      "invert",
      "additive",
      "always active"
    ]
  },
  {
    kind: "bitfield",
    name: "ObjectFlags",
    width: 16,
    fields: [
      "does not cast shadow",
      "transparent self occlusion",
      "brighter than it should be",
      "not a pathfinding obstacle",
      "extension of parent",
      "cast shadow by default",
      "does not have anniversary geometry"
    ]
  },
  {
    kind: "struct",
    name: "ObjectAttachment",
    fields: [
      {
        kind: "field",
        name: "type",
        type: "TagDependency",
        classes: [
          "light",
          "light_volume",
          "contrail",
          "particle_system",
          "effect",
          "sound_looping"
        ]
      },
      {
        kind: "field",
        name: "marker",
        type: "TagString"
      },
      {
        kind: "field",
        name: "primary scale",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "secondary scale",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "change color",
        type: "FunctionNameNullable"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 16
      }
    ],
    sizeBytes: 72
  },
  {
    kind: "struct",
    name: "ObjectWidget",
    fields: [
      {
        kind: "field",
        name: "reference",
        type: "TagDependency",
        classes: [
          "antenna",
          "glow",
          "light_volume",
          "lightning",
          "flag"
        ]
      },
      {
        kind: "pad",
        size: 16
      }
    ],
    sizeBytes: 32
  },
  {
    kind: "struct",
    name: "ObjectFunction",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "ObjectFunctionFlags"
      },
      {
        kind: "field",
        name: "period",
        type: "float"
      },
      {
        kind: "field",
        name: "scale period by",
        type: "FunctionScaleBy"
      },
      {
        kind: "field",
        name: "function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "scale function by",
        type: "FunctionScaleBy"
      },
      {
        kind: "field",
        name: "wobble function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "wobble period",
        type: "float"
      },
      {
        kind: "field",
        name: "wobble magnitude",
        type: "float"
      },
      {
        kind: "field",
        name: "square wave threshold",
        type: "Fraction"
      },
      {
        kind: "field",
        name: "step count",
        type: "int16"
      },
      {
        kind: "field",
        name: "map to",
        type: "FunctionType"
      },
      {
        kind: "field",
        name: "sawtooth count",
        type: "int16"
      },
      {
        kind: "field",
        name: "add",
        type: "FunctionScaleBy"
      },
      {
        kind: "field",
        name: "scale result by",
        type: "FunctionScaleBy"
      },
      {
        kind: "field",
        name: "bounds mode",
        type: "FunctionBoundsMode"
      },
      {
        kind: "field",
        name: "bounds",
        type: "Fraction",
        bounds: true
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "turn off with",
        type: "int16"
      },
      {
        kind: "field",
        name: "scale by",
        type: "float"
      },
      {
        kind: "pad",
        size: 252
      },
      {
        kind: "field",
        name: "inverse bounds",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "inverse sawtooth",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "inverse step",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "inverse period",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "usage",
        type: "TagString"
      }
    ],
    sizeBytes: 360
  },
  {
    kind: "struct",
    name: "ObjectChangeColorsPermutation",
    fields: [
      {
        kind: "field",
        name: "weight",
        type: "float"
      },
      {
        kind: "field",
        name: "color lower bound",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "color upper bound",
        type: "ColorRGB"
      }
    ],
    sizeBytes: 28
  },
  {
    kind: "struct",
    name: "ObjectChangeColors",
    fields: [
      {
        kind: "field",
        name: "darken by",
        type: "FunctionScaleBy"
      },
      {
        kind: "field",
        name: "scale by",
        type: "FunctionScaleBy"
      },
      {
        kind: "field",
        name: "flags",
        type: "ColorInterpolationFlags"
      },
      {
        kind: "field",
        name: "color lower bound",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "color upper bound",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "permutations",
        type: "TagReflexive",
        struct: "ObjectChangeColorsPermutation",
        maximum: 8
      }
    ],
    sizeBytes: 44
  },
  {
    kind: "struct",
    name: "Object",
    fields: [
      {
        kind: "field",
        name: "object type",
        type: "ObjectType"
      },
      {
        kind: "field",
        name: "flags",
        type: "ObjectFlags"
      },
      {
        kind: "field",
        name: "bounding radius",
        type: "float"
      },
      {
        kind: "field",
        name: "bounding offset",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "origin offset",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "acceleration scale",
        type: "float"
      },
      {
        kind: "field",
        name: "scales change colors",
        type: "uint32",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "model",
        type: "TagDependency",
        classes: [
          "model"
        ]
      },
      {
        kind: "field",
        name: "animation graph",
        type: "TagDependency",
        classes: [
          "model_animations"
        ]
      },
      {
        kind: "pad",
        size: 40
      },
      {
        kind: "field",
        name: "collision model",
        type: "TagDependency",
        classes: [
          "model_collision_geometry"
        ]
      },
      {
        kind: "field",
        name: "physics",
        type: "TagDependency",
        classes: [
          "physics"
        ]
      },
      {
        kind: "field",
        name: "modifier shader",
        type: "TagDependency",
        classes: [
          "shader"
        ]
      },
      {
        kind: "field",
        name: "creation effect",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "pad",
        size: 84
      },
      {
        kind: "field",
        name: "render bounding radius",
        type: "float"
      },
      {
        kind: "field",
        name: "a in",
        type: "ObjectFunctionIn"
      },
      {
        kind: "field",
        name: "b in",
        type: "ObjectFunctionIn"
      },
      {
        kind: "field",
        name: "c in",
        type: "ObjectFunctionIn"
      },
      {
        kind: "field",
        name: "d in",
        type: "ObjectFunctionIn"
      },
      {
        kind: "pad",
        size: 44
      },
      {
        kind: "field",
        name: "hud text message index",
        type: "int16"
      },
      {
        kind: "field",
        name: "forced shader permutation index",
        type: "int16"
      },
      {
        kind: "field",
        name: "attachments",
        type: "TagReflexive",
        struct: "ObjectAttachment",
        maximum: 8
      },
      {
        kind: "field",
        name: "widgets",
        type: "TagReflexive",
        struct: "ObjectWidget",
        maximum: 4
      },
      {
        kind: "field",
        name: "functions",
        type: "TagReflexive",
        struct: "ObjectFunction",
        maximum: 4
      },
      {
        kind: "field",
        name: "change colors",
        type: "TagReflexive",
        struct: "ObjectChangeColors",
        maximum: 4
      },
      {
        kind: "field",
        name: "predicted resources",
        type: "TagReflexive",
        struct: "PredictedResource",
        maximum: 1024,
        cacheOnly: true
      }
    ],
    tagClass: "object",
    sizeBytes: 380
  },
  {
    kind: "bitfield",
    name: "BaseObjectFlags",
    width: 16,
    fields: [
      "off in pegasus"
    ]
  },
  {
    kind: "struct",
    name: "BasicObject",
    fields: [
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "more flags",
        type: "BaseObjectFlags"
      },
      {
        kind: "pad",
        size: 124
      }
    ],
    inherits: "Object",
    sizeBytes: 508
  }
];

// ../core/src/map/definitions/groups/particle.json
var particle_default = [
  {
    kind: "enum",
    name: "ParticleOrientation",
    options: [
      "screen facing",
      "parallel to direction",
      "perpendicular to direction"
    ]
  },
  {
    kind: "enum",
    name: "ParticleAnchor",
    options: [
      "with primary",
      "with screen space",
      "zsprite"
    ]
  },
  {
    kind: "bitfield",
    name: "ParticleFlags",
    width: 32,
    fields: [
      "can animate backwards",
      "animation stops at rest",
      "animation starts on random frame",
      "animate once per frame",
      "dies at rest",
      "dies on contact with structure",
      "tint from diffuse texture",
      "dies on contact with water",
      "dies on contact with air",
      "self illuminated",
      "random horizontal mirroring",
      "random vertical mirroring"
    ]
  },
  {
    kind: "bitfield",
    name: "ParticleShaderFlags",
    width: 16,
    fields: [
      "sort bias",
      "nonlinear tint",
      "don't overdraw fp weapon"
    ]
  },
  {
    kind: "struct",
    name: "Particle",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "ParticleFlags"
      },
      {
        kind: "field",
        name: "bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "physics",
        type: "TagDependency",
        classes: [
          "point_physics"
        ]
      },
      {
        kind: "field",
        name: "sir marty exchanged his children for thine",
        type: "TagDependency",
        classes: [
          "material_effects"
        ]
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "lifespan",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "fade in time",
        type: "float"
      },
      {
        kind: "field",
        name: "fade out time",
        type: "float"
      },
      {
        kind: "field",
        name: "collision effect",
        type: "TagDependency",
        classes: [
          "sound",
          "effect"
        ]
      },
      {
        kind: "field",
        name: "death effect",
        type: "TagDependency",
        classes: [
          "sound",
          "effect"
        ]
      },
      {
        kind: "field",
        name: "minimum size",
        type: "float"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "radius animation",
        type: "float",
        bounds: true
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "animation rate",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "contact deterioration",
        type: "float",
        nonCached: true,
        comment: "this value is totally broken and locks the game up if it's non-zero; even tool.exe sets it to zero"
      },
      {
        kind: "field",
        name: "fade start size",
        type: "float"
      },
      {
        kind: "field",
        name: "fade end size",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "first sequence index",
        type: "Index"
      },
      {
        kind: "field",
        name: "initial sequence count",
        type: "int16"
      },
      {
        kind: "field",
        name: "looping sequence count",
        type: "int16"
      },
      {
        kind: "field",
        name: "final sequence count",
        type: "int16"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "sprite size",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "orientation",
        type: "ParticleOrientation"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 36
      },
      {
        kind: "field",
        name: "shader type",
        type: "ShaderType",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "shader flags",
        type: "ParticleShaderFlags"
      },
      {
        kind: "field",
        name: "framebuffer blend function",
        type: "FramebufferBlendFunction"
      },
      {
        kind: "field",
        name: "framebuffer fade mode",
        type: "FramebufferFadeMode"
      },
      {
        kind: "field",
        name: "bitmap flags",
        type: "IsUnfilteredFlag"
      },
      {
        kind: "pad",
        size: 28
      },
      {
        kind: "field",
        name: "secondary bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "anchor",
        type: "ParticleAnchor"
      },
      {
        kind: "field",
        name: "secondary bitmap flags",
        type: "IsUnfilteredFlag"
      },
      {
        kind: "field",
        name: "u animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "u animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "u animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "u animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "u animation scale",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "v animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "v animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation scale",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "rotation animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "rotation animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation scale",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation center",
        type: "Point2D"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "zsprite radius scale",
        type: "float"
      },
      {
        kind: "pad",
        size: 20
      }
    ],
    tagClass: "particle",
    sizeBytes: 356
  }
];

// ../core/src/map/definitions/groups/particle_system.json
var particle_system_default = [
  {
    kind: "enum",
    name: "ParticleSystemParticleCreationPhysics",
    options: [
      "default",
      "explosion",
      "jet"
    ]
  },
  {
    kind: "enum",
    name: "ParticleSystemParticleUpdatePhysics",
    options: [
      "default"
    ]
  },
  {
    kind: "enum",
    name: "ParticleSystemComplexSpriteRenderMode",
    options: [
      "simple",
      "rotational"
    ]
  },
  {
    kind: "enum",
    name: "ParticleSystemSystemUpdatePhysics",
    options: [
      "default",
      "explosion"
    ]
  },
  {
    kind: "bitfield",
    name: "ParticleSystemTypeFlags",
    width: 32,
    fields: [
      "type states loop",
      "forward backward",
      "particle states loop",
      "forward backward 1",
      "particles die in water",
      "particles die in air",
      "particles die on ground",
      "rotational sprites animate sideways",
      "disabled",
      "tint by effect color",
      "initial count scales with effect",
      "minimum count scales with effect",
      "creation rate scales with effect",
      "scale scales with effect",
      "animation rate scales with effect",
      "rotation rate scales with effect",
      "do not draw in first person",
      "do not draw in third person"
    ]
  },
  {
    kind: "struct",
    name: "ParticleSystemPhysicsConstant",
    fields: [
      {
        kind: "field",
        name: "k",
        type: "float"
      }
    ],
    sizeBytes: 4
  },
  {
    kind: "struct",
    name: "ParticleSystemTypeStates",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "duration bounds",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "transition time bounds",
        type: "float",
        bounds: true
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "scale multiplier",
        type: "float"
      },
      {
        kind: "field",
        name: "animation rate multiplier",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation rate multiplier",
        type: "float"
      },
      {
        kind: "field",
        name: "color multiplier",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "radius multiplier",
        type: "float"
      },
      {
        kind: "field",
        name: "minimum particle count",
        type: "float"
      },
      {
        kind: "field",
        name: "particle creation rate",
        type: "float"
      },
      {
        kind: "pad",
        size: 84
      },
      {
        kind: "field",
        name: "particle creation physics",
        type: "ParticleSystemParticleCreationPhysics"
      },
      {
        kind: "field",
        name: "particle update physics",
        type: "ParticleSystemParticleUpdatePhysics"
      },
      {
        kind: "field",
        name: "physics constants",
        type: "TagReflexive",
        struct: "ParticleSystemPhysicsConstant",
        maximum: 16
      }
    ],
    sizeBytes: 192
  },
  {
    kind: "struct",
    name: "ParticleSystemTypeParticleState",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "duration bounds",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "transition time bounds",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "bitmaps",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "sequence index",
        type: "Index"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "scale",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "animation rate",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "rotation rate",
        type: "Angle",
        bounds: true
      },
      {
        kind: "field",
        name: "color 1",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "color 2",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "radius multiplier",
        type: "float"
      },
      {
        kind: "field",
        name: "point physics",
        type: "TagDependency",
        classes: [
          "point_physics"
        ]
      },
      {
        kind: "pad",
        size: 36
      },
      {
        kind: "pad",
        size: 36
      },
      {
        kind: "field",
        name: "shader type",
        type: "ShaderType",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "shader flags",
        type: "ParticleShaderFlags"
      },
      {
        kind: "field",
        name: "framebuffer blend function",
        type: "FramebufferBlendFunction"
      },
      {
        kind: "field",
        name: "framebuffer fade mode",
        type: "FramebufferFadeMode"
      },
      {
        kind: "field",
        name: "bitmap flags",
        type: "IsUnfilteredFlag"
      },
      {
        kind: "pad",
        size: 28
      },
      {
        kind: "field",
        name: "secondary bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "anchor",
        type: "ParticleAnchor"
      },
      {
        kind: "field",
        name: "secondary bitmap flags",
        type: "IsUnfilteredFlag"
      },
      {
        kind: "field",
        name: "u animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "u animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "u animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "u animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "u animation scale",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "v animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "v animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation scale",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "rotation animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "rotation animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation scale",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation center",
        type: "Point2D"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "zsprite radius scale",
        type: "float"
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "physics constants",
        type: "TagReflexive",
        struct: "ParticleSystemPhysicsConstant",
        maximum: 16
      }
    ],
    sizeBytes: 376
  },
  {
    kind: "struct",
    name: "ParticleSystemType",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "flags",
        type: "ParticleSystemTypeFlags"
      },
      {
        kind: "field",
        name: "initial particle count",
        type: "uint16"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "complex sprite render mode",
        type: "ParticleSystemComplexSpriteRenderMode"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "radius",
        type: "float"
      },
      {
        kind: "pad",
        size: 36
      },
      {
        kind: "field",
        name: "particle creation physics",
        type: "ParticleSystemParticleCreationPhysics"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "physics flags",
        type: "IsUnusedFlag"
      },
      {
        kind: "field",
        name: "physics constants",
        type: "TagReflexive",
        struct: "ParticleSystemPhysicsConstant",
        maximum: 16
      },
      {
        kind: "field",
        name: "states",
        type: "TagReflexive",
        struct: "ParticleSystemTypeStates",
        maximum: 8
      },
      {
        kind: "field",
        name: "particle states",
        type: "TagReflexive",
        struct: "ParticleSystemTypeParticleState",
        maximum: 8
      }
    ],
    sizeBytes: 128
  },
  {
    kind: "struct",
    name: "ParticleSystem",
    fields: [
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "pad",
        size: 52
      },
      {
        kind: "field",
        name: "point physics",
        type: "TagDependency",
        classes: [
          "point_physics"
        ]
      },
      {
        kind: "field",
        name: "system update physics",
        type: "ParticleSystemSystemUpdatePhysics"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "physics flags",
        type: "IsUnusedFlag"
      },
      {
        kind: "field",
        name: "physics constants",
        type: "TagReflexive",
        struct: "ParticleSystemPhysicsConstant",
        maximum: 16
      },
      {
        kind: "field",
        name: "particle types",
        type: "TagReflexive",
        struct: "ParticleSystemType",
        maximum: 4
      }
    ],
    tagClass: "particle_system",
    sizeBytes: 104
  }
];

// ../core/src/map/definitions/groups/physics.json
var physics_default = [
  {
    kind: "enum",
    name: "PhysicsFrictionType",
    options: [
      "point",
      "forward",
      "left",
      "up"
    ]
  },
  {
    kind: "bitfield",
    name: "PhysicsPoweredMassPointFlags",
    width: 32,
    fields: [
      "ground friction",
      "water friction",
      "air friction",
      "water lift",
      "air lift",
      "thrust",
      "antigrav"
    ]
  },
  {
    kind: "bitfield",
    name: "PhysicsMassPointFlags",
    width: 32,
    fields: [
      "metallic"
    ]
  },
  {
    kind: "struct",
    name: "PhysicsInertialMatrix",
    fields: [
      {
        kind: "field",
        name: "matrix",
        type: "Matrix"
      }
    ],
    sizeBytes: 36
  },
  {
    kind: "struct",
    name: "PhysicsPoweredMassPoint",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "flags",
        type: "PhysicsPoweredMassPointFlags"
      },
      {
        kind: "field",
        name: "antigrav strength",
        type: "float"
      },
      {
        kind: "field",
        name: "antigrav offset",
        type: "float"
      },
      {
        kind: "field",
        name: "antigrav height",
        type: "float"
      },
      {
        kind: "field",
        name: "antigrav damp fraction",
        type: "float"
      },
      {
        kind: "field",
        name: "antigrav normal k1",
        type: "float"
      },
      {
        kind: "field",
        name: "antigrav normal k0",
        type: "float"
      },
      {
        kind: "pad",
        size: 68
      }
    ],
    sizeBytes: 128
  },
  {
    kind: "struct",
    name: "PhysicsMassPoint",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "powered mass point",
        type: "Index",
        struct: "Physics"
      },
      {
        kind: "field",
        name: "model node",
        type: "Index"
      },
      {
        kind: "field",
        name: "flags",
        type: "PhysicsMassPointFlags"
      },
      {
        kind: "field",
        name: "relative mass",
        type: "float"
      },
      {
        kind: "field",
        name: "mass",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "relative density",
        type: "float"
      },
      {
        kind: "field",
        name: "density",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "forward",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "up",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "friction type",
        type: "PhysicsFrictionType"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "friction parallel scale",
        type: "float"
      },
      {
        kind: "field",
        name: "friction perpendicular scale",
        type: "float"
      },
      {
        kind: "field",
        name: "radius",
        type: "float"
      },
      {
        kind: "pad",
        size: 20
      }
    ],
    sizeBytes: 128
  },
  {
    kind: "struct",
    name: "Physics",
    fields: [
      {
        kind: "field",
        name: "radius",
        type: "float"
      },
      {
        kind: "field",
        name: "moment scale",
        type: "Fraction"
      },
      {
        kind: "field",
        name: "mass",
        type: "float"
      },
      {
        kind: "field",
        name: "center of mass",
        type: "Point3D",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "density",
        type: "float"
      },
      {
        kind: "field",
        name: "gravity scale",
        type: "float"
      },
      {
        kind: "field",
        name: "ground friction",
        type: "float"
      },
      {
        kind: "field",
        name: "ground depth",
        type: "float"
      },
      {
        kind: "field",
        name: "ground damp fraction",
        type: "Fraction"
      },
      {
        kind: "field",
        name: "ground normal k1",
        type: "float"
      },
      {
        kind: "field",
        name: "ground normal k0",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "water friction",
        type: "float"
      },
      {
        kind: "field",
        name: "water depth",
        type: "float"
      },
      {
        kind: "field",
        name: "water density",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "air friction",
        type: "Fraction"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "xx moment",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "yy moment",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "zz moment",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "inertial matrix and inverse",
        type: "TagReflexive",
        struct: "PhysicsInertialMatrix",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "powered mass points",
        type: "TagReflexive",
        struct: "PhysicsPoweredMassPoint",
        maximum: 32
      },
      {
        kind: "field",
        name: "mass points",
        type: "TagReflexive",
        struct: "PhysicsMassPoint",
        maximum: 32
      }
    ],
    tagClass: "physics",
    sizeBytes: 128
  }
];

// ../core/src/map/definitions/groups/placeholder.json
var placeholder_default = [
  {
    kind: "struct",
    name: "Placeholder",
    fields: [],
    inherits: "BasicObject",
    tagClass: "placeholder",
    sizeBytes: 508
  }
];

// ../core/src/map/definitions/groups/point_physics.json
var point_physics_default = [
  {
    kind: "bitfield",
    name: "PointPhysicsFlags",
    width: 32,
    fields: [
      "flamethrower particle collision",
      "collides with structures",
      "collides with water surface",
      "uses simple wind",
      "uses damped wind",
      "no gravity"
    ]
  },
  {
    kind: "struct",
    name: "PointPhysics",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "PointPhysicsFlags"
      },
      {
        kind: "field",
        name: "mass scale",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "water gravity scale",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "air gravity scale",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "density",
        type: "float"
      },
      {
        kind: "field",
        name: "air friction",
        type: "float"
      },
      {
        kind: "field",
        name: "water friction",
        type: "float"
      },
      {
        kind: "field",
        name: "surface friction",
        type: "float"
      },
      {
        kind: "field",
        name: "elasticity",
        type: "float"
      },
      {
        kind: "pad",
        size: 12
      }
    ],
    tagClass: "point_physics",
    sizeBytes: 64
  }
];

// ../core/src/map/definitions/groups/preferences_network_game.json
var preferences_network_game_default = [
  {
    kind: "struct",
    name: "PreferencesNetworkGame",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "primary color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "secondary color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "pattern",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "pattern bitmap index",
        type: "Index"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "decal",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "decal bitmap index",
        type: "Index"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 800
      }
    ],
    tagClass: "preferences_network_game",
    sizeBytes: 896
  }
];

// ../core/src/map/definitions/groups/projectile.json
var projectile_default = [
  {
    kind: "enum",
    name: "ProjectileResponse",
    options: [
      "disappear",
      "detonate",
      "reflect",
      "overpenetrate",
      "attach"
    ]
  },
  {
    kind: "enum",
    name: "ProjectileScaleEffectsBy",
    options: [
      "damage",
      "angle"
    ]
  },
  {
    kind: "enum",
    name: "ProjectileDetonationTimerStarts",
    options: [
      "immediately",
      "after first bounce",
      "when at rest"
    ]
  },
  {
    kind: "enum",
    name: "ProjectileFunctionIn",
    options: [
      "none",
      "range remaining",
      "time remaining",
      "tracer"
    ]
  },
  {
    kind: "bitfield",
    name: "ProjectileFlags",
    width: 32,
    fields: [
      "oriented along velocity",
      "ai must use ballistic aiming",
      "detonation max time if attached",
      "has super combining explosion",
      "combine initial velocity with parent velocity",
      "random attached detonation time",
      "minimum unattached detonation time"
    ]
  },
  {
    kind: "bitfield",
    name: "ProjectileMaterialResponseFlags",
    width: 16,
    fields: [
      "cannot be overpenetrated"
    ]
  },
  {
    kind: "bitfield",
    name: "ProjectileMaterialResponsePotentialFlags",
    width: 16,
    fields: [
      "only against units",
      "never against units"
    ]
  },
  {
    kind: "struct",
    name: "ProjectileMaterialResponse",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "ProjectileMaterialResponseFlags"
      },
      {
        kind: "field",
        name: "default response",
        type: "ProjectileResponse"
      },
      {
        kind: "field",
        name: "default effect",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "potential response",
        type: "ProjectileResponse"
      },
      {
        kind: "field",
        name: "potential flags",
        type: "ProjectileMaterialResponsePotentialFlags"
      },
      {
        kind: "field",
        name: "potential skip fraction",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "potential between",
        type: "Angle",
        bounds: true
      },
      {
        kind: "field",
        name: "potential and",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "potential effect",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "scale effects by",
        type: "ProjectileScaleEffectsBy"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "angular noise",
        type: "Angle"
      },
      {
        kind: "field",
        name: "velocity noise",
        type: "float"
      },
      {
        kind: "field",
        name: "detonation effect",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "initial friction",
        type: "float"
      },
      {
        kind: "field",
        name: "maximum distance",
        type: "float"
      },
      {
        kind: "field",
        name: "parallel friction",
        type: "float"
      },
      {
        kind: "field",
        name: "perpendicular friction",
        type: "float"
      }
    ],
    sizeBytes: 160
  },
  {
    kind: "struct",
    name: "Projectile",
    fields: [
      {
        kind: "field",
        name: "projectile flags",
        type: "ProjectileFlags"
      },
      {
        kind: "field",
        name: "detonation timer starts",
        type: "ProjectileDetonationTimerStarts"
      },
      {
        kind: "field",
        name: "impact noise",
        type: "ObjectNoise"
      },
      {
        kind: "field",
        name: "projectile a in",
        type: "ProjectileFunctionIn"
      },
      {
        kind: "field",
        name: "projectile b in",
        type: "ProjectileFunctionIn"
      },
      {
        kind: "field",
        name: "projectile c in",
        type: "ProjectileFunctionIn"
      },
      {
        kind: "field",
        name: "projectile d in",
        type: "ProjectileFunctionIn"
      },
      {
        kind: "field",
        name: "super detonation",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "field",
        name: "ai perception radius",
        type: "float"
      },
      {
        kind: "field",
        name: "collision radius",
        type: "float"
      },
      {
        kind: "field",
        name: "arming time",
        type: "float"
      },
      {
        kind: "field",
        name: "danger radius",
        type: "float"
      },
      {
        kind: "field",
        name: "effect",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "field",
        name: "timer",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "minimum velocity",
        type: "float"
      },
      {
        kind: "field",
        name: "maximum range",
        type: "float"
      },
      {
        kind: "field",
        name: "air gravity scale",
        type: "float"
      },
      {
        kind: "field",
        name: "air damage range",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "water gravity scale",
        type: "float"
      },
      {
        kind: "field",
        name: "water damage range",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "initial velocity",
        type: "float"
      },
      {
        kind: "field",
        name: "final velocity",
        type: "float"
      },
      {
        kind: "field",
        name: "guided angular velocity",
        type: "Angle"
      },
      {
        kind: "field",
        name: "detonation noise",
        type: "ObjectNoise"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "detonation started",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "field",
        name: "flyby sound",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "attached detonation damage",
        type: "TagDependency",
        classes: [
          "damage_effect"
        ]
      },
      {
        kind: "field",
        name: "impact damage",
        type: "TagDependency",
        classes: [
          "damage_effect"
        ]
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "projectile material response",
        type: "TagReflexive",
        struct: "ProjectileMaterialResponse",
        maximum: 33
      }
    ],
    inherits: "Object",
    tagClass: "projectile",
    sizeBytes: 588
  }
];

// ../core/src/map/definitions/groups/scenario.json
var scenario_default = [
  {
    kind: "enum",
    name: "ScenarioType",
    options: [
      "singleplayer",
      "multiplayer",
      "user interface"
    ]
  },
  {
    kind: "enum",
    name: "ScenarioSpawnType",
    options: [
      "none",
      "ctf",
      "slayer",
      "oddball",
      "king of the hill",
      "race",
      "terminator",
      "stub",
      "ignored1",
      "ignored2",
      "ignored3",
      "ignored4",
      "all games",
      "all except ctf",
      "all except race and ctf"
    ]
  },
  {
    kind: "enum",
    name: "ScenarioNetgameFlagType",
    options: [
      "ctf flag",
      "ctf vehicle",
      "oddball ball spawn",
      "race track",
      "race vehicle",
      "vegas bank",
      "teleport from",
      "teleport to",
      "hill flag"
    ]
  },
  {
    kind: "enum",
    name: "ScenarioReturnState",
    options: [
      "none",
      "sleeping",
      "alert",
      "moving repeat same position",
      "moving loop",
      "moving loop back and forth",
      "moving loop randomly",
      "moving randomly",
      "guarding",
      "guarding at guard position",
      "searching",
      "fleeing"
    ]
  },
  {
    kind: "enum",
    name: "ScenarioUniqueLeaderType",
    options: [
      "normal",
      "none",
      "random",
      "sgt johnson",
      "sgt lehto"
    ]
  },
  {
    kind: "enum",
    name: "ScenarioMajorUpgrade",
    options: [
      "normal",
      "few",
      "many",
      "none",
      "all"
    ]
  },
  {
    kind: "enum",
    name: "ScenarioChangeAttackingDefendingStateWhen",
    options: [
      "never",
      "75 strength",
      "50 strength",
      "25 strength",
      "anybody dead",
      "25 dead",
      "50 dead",
      "75 dead",
      "all but one dead",
      "all dead"
    ]
  },
  {
    kind: "enum",
    name: "ScenarioGroupIndex",
    options: [
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
      "i",
      "j",
      "k",
      "l",
      "m",
      "n",
      "o",
      "p",
      "q",
      "r",
      "s",
      "t",
      "u",
      "v",
      "w",
      "x",
      "y",
      "z"
    ]
  },
  {
    kind: "enum",
    name: "ScenarioTeamIndex",
    options: [
      "default by unit",
      "player",
      "human",
      "covenant",
      "flood",
      "sentinel",
      "unused6",
      "unused7",
      "unused8",
      "unused9"
    ]
  },
  {
    kind: "enum",
    name: "ScenarioSearchBehavior",
    options: [
      "normal",
      "never",
      "tenacious"
    ]
  },
  {
    kind: "enum",
    name: "ScenarioAtomType",
    options: [
      "pause",
      "go to",
      "go to and face",
      "move in direction",
      "look",
      "animation mode",
      "crouch",
      "shoot",
      "grenade",
      "vehicle",
      "running jump",
      "targeted jump",
      "script",
      "animate",
      "recording",
      "action",
      "vocalize",
      "targeting",
      "initiative",
      "wait",
      "loop",
      "die",
      "move immediate",
      "look random",
      "look player",
      "look object",
      "set radius",
      "teleport"
    ]
  },
  {
    kind: "enum",
    name: "ScenarioSelectionType",
    options: [
      "friendly actor",
      "disembodied",
      "in player s vehicle",
      "not in a vehicle",
      "prefer sergeant",
      "any actor",
      "radio unit",
      "radio sergeant"
    ]
  },
  {
    kind: "enum",
    name: "ScenarioAddressee",
    options: [
      "none",
      "player",
      "participant"
    ]
  },
  {
    kind: "enum",
    name: "ScenarioScriptType",
    options: [
      "startup",
      "dormant",
      "continuous",
      "static",
      "stub"
    ]
  },
  {
    kind: "enum",
    name: "ScenarioScriptValueType",
    options: [
      "unparsed",
      "special form",
      "function name",
      "passthrough",
      "void",
      "boolean",
      "real",
      "short",
      "long",
      "string",
      "script",
      "trigger volume",
      "cutscene flag",
      "cutscene camera point",
      "cutscene title",
      "cutscene recording",
      "device group",
      "ai",
      "ai command list",
      "starting profile",
      "conversation",
      "navpoint",
      "hud message",
      "object list",
      "sound",
      "effect",
      "damage",
      "looping sound",
      "animation graph",
      "actor variant",
      "damage effect",
      "object definition",
      "game difficulty",
      "team",
      "ai default state",
      "actor type",
      "hud corner",
      "object",
      "unit",
      "vehicle",
      "weapon",
      "device",
      "scenery",
      "object name",
      "unit name",
      "vehicle name",
      "weapon name",
      "device name",
      "scenery name"
    ]
  },
  {
    kind: "enum",
    name: "ScenarioTextStyle",
    options: [
      "plain",
      "bold",
      "italic",
      "condense",
      "underline"
    ]
  },
  {
    kind: "enum",
    name: "ScenarioJustification",
    options: [
      "left",
      "right",
      "center"
    ]
  },
  {
    kind: "enum",
    name: "ScenarioTriggerVolumeType",
    options: [
      "fixed",
      "rotational"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioTextFlags",
    width: 32,
    fields: [
      "wrap horizontally",
      "wrap vertically",
      "center vertically",
      "bottom justify"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioFunctionFlags",
    width: 32,
    fields: [
      "scripted",
      "invert",
      "additive",
      "always active"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioSpawnNotPlaced",
    width: 16,
    fields: [
      "automatically",
      "on easy",
      "on normal",
      "on hard",
      "use player appearance"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioUnitFlags",
    width: 32,
    fields: [
      "dead"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioVehicleMultiplayerSpawnFlags",
    width: 16,
    fields: [
      "slayer default",
      "ctf default",
      "king default",
      "oddball default",
      "unused",
      "unused1",
      "unused2",
      "unused3",
      "slayer allowed",
      "ctf allowed",
      "king allowed",
      "oddball allowed",
      "unused4",
      "unused5",
      "unused6",
      "unused7"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioItemFlags",
    width: 16,
    fields: [
      "initially at rest",
      "obsolete",
      "does accelerate"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioDeviceGroupFlags",
    width: 32,
    fields: [
      "can change only once"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioDeviceFlags",
    width: 32,
    fields: [
      "initially open",
      "initially off",
      "can change only once",
      "position reversed",
      "not usable from any side"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioMachineFlags",
    width: 32,
    fields: [
      "does not operate automatically",
      "one sided",
      "never appears locked",
      "opened by melee attack"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioControlFlags",
    width: 32,
    fields: [
      "usable from both sides"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioNetgameEquipmentFlags",
    width: 32,
    fields: [
      "levitate"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioStartingEquipmentFlags",
    width: 32,
    fields: [
      "no grenades",
      "plasma grenades only",
      "type2 grenades only",
      "type3 grenades only"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioActorStartingLocationFlags",
    width: 8,
    fields: [
      "required"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioSquadFlags",
    width: 32,
    fields: [
      "unused",
      "never search",
      "start timer immediately",
      "no timer delay forever",
      "magic sight after timer",
      "automatic migration"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioSquadAttacking",
    width: 32,
    fields: [
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
      "i",
      "j",
      "k",
      "l",
      "m",
      "n",
      "o",
      "p",
      "q",
      "r",
      "s",
      "t",
      "u",
      "v",
      "w",
      "x",
      "y",
      "z"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioPlatoonFlags",
    width: 32,
    fields: [
      "flee when maneuvering",
      "say advancing when maneuver",
      "start in defending state"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioEncounterFlags",
    width: 32,
    fields: [
      "not initially created",
      "respawn enabled",
      "initially blind",
      "initially deaf",
      "initially braindead",
      "3d firing positions",
      "manual bsp index specified"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioCommandListFlags",
    width: 32,
    fields: [
      "allow initiative",
      "allow targeting",
      "disable looking",
      "disable communication",
      "disable falling damage",
      "manual bsp index"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioAIConversationParticipantFlags",
    width: 16,
    fields: [
      "optional",
      "has alternate",
      "is alternate"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioAIConversationLineFlags",
    width: 16,
    fields: [
      "addressee look at speaker",
      "everyone look at speaker",
      "everyone look at addressee",
      "wait after until told to advance",
      "wait until speaker nearby",
      "wait until everyone nearby"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioAIConversationFlags",
    width: 16,
    fields: [
      "stop if death",
      "stop if damaged",
      "stop if visible enemy",
      "stop if alerted to enemy",
      "player must be visible",
      "stop other actions",
      "keep trying to play",
      "player must be looking"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioFlags",
    width: 16,
    fields: [
      "cortana hack",
      "use demo ui",
      "color correction ntsc to srgb",
      "do not apply bungie campaign tag patches"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioScriptNodeFlags",
    width: 16,
    fields: [
      "is primitive",
      "is script call",
      "is global",
      "is garbage collectable",
      "is local variable"
    ]
  },
  {
    kind: "struct",
    name: "ScenarioSky",
    fields: [
      {
        kind: "field",
        name: "sky",
        type: "TagDependency",
        classes: [
          "sky"
        ]
      }
    ],
    sizeBytes: 16
  },
  {
    kind: "struct",
    name: "ScenarioChildScenario",
    fields: [
      {
        kind: "field",
        name: "child scenario",
        type: "TagDependency",
        classes: [
          "scenario"
        ],
        comment: "This scenario tag will be merged into the main scenario tag (and dereferenced) on map build."
      },
      {
        kind: "pad",
        size: 16
      }
    ],
    sizeBytes: 32
  },
  {
    kind: "struct",
    name: "ScenarioFunction",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "ScenarioFunctionFlags"
      },
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "period",
        type: "float"
      },
      {
        kind: "field",
        name: "scale period by",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "scale function by",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "wobble function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "wobble period",
        type: "float"
      },
      {
        kind: "field",
        name: "wobble magnitude",
        type: "float"
      },
      {
        kind: "field",
        name: "square wave threshold",
        type: "Fraction"
      },
      {
        kind: "field",
        name: "step count",
        type: "int16"
      },
      {
        kind: "field",
        name: "map to",
        type: "FunctionType"
      },
      {
        kind: "field",
        name: "sawtooth count",
        type: "int16"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "scale result by",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "bounds mode",
        type: "FunctionBoundsMode"
      },
      {
        kind: "field",
        name: "bounds",
        type: "float",
        bounds: true
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "turn off with",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 16
      }
    ],
    sizeBytes: 120
  },
  {
    kind: "struct",
    name: "ScenarioEditorComment",
    fields: [
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "comment",
        type: "TagDataOffset",
        maximum: 16384
      }
    ],
    sizeBytes: 48
  },
  {
    kind: "struct",
    name: "ScenarioScavengerHuntObjects",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "object name index",
        type: "Index"
      },
      {
        kind: "pad",
        size: 2
      }
    ],
    sizeBytes: 36
  },
  {
    kind: "struct",
    name: "ScenarioObjectName",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "object type",
        type: "ObjectType",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "object index",
        type: "Index",
        cacheOnly: true
      }
    ],
    sizeBytes: 36
  },
  {
    kind: "struct",
    name: "ScenarioScenery",
    fields: [
      {
        kind: "field",
        name: "type",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "name",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "not placed",
        type: "ScenarioSpawnNotPlaced"
      },
      {
        kind: "field",
        name: "desired permutation",
        type: "int16",
        comment: "when non-zero the game will try use model permutations with a matching number suffix"
      },
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "rotation",
        type: "Euler3D"
      },
      {
        kind: "field",
        name: "bsp indices",
        type: "uint16",
        cacheOnly: true,
        comment: "Unused in Gearbox versions of Halo PC; bitmask"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "appearance player index",
        type: "int8"
      },
      {
        kind: "pad",
        size: 3
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "pad",
        size: 8
      }
    ],
    sizeBytes: 72
  },
  {
    kind: "struct",
    name: "ScenarioSceneryPalette",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagDependency",
        classes: [
          "scenery"
        ]
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    sizeBytes: 48
  },
  {
    kind: "struct",
    name: "ScenarioBiped",
    fields: [
      {
        kind: "field",
        name: "type",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "name",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "not placed",
        type: "ScenarioSpawnNotPlaced"
      },
      {
        kind: "field",
        name: "desired permutation",
        type: "int16",
        comment: "when non-zero the game will try use model permutations with a matching number suffix"
      },
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "rotation",
        type: "Euler3D"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "appearance player index",
        type: "int8"
      },
      {
        kind: "pad",
        size: 3
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "body vitality modifier",
        type: "float"
      },
      {
        kind: "field",
        name: "flags",
        type: "ScenarioUnitFlags"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    sizeBytes: 120
  },
  {
    kind: "struct",
    name: "ScenarioBipedPalette",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagDependency",
        classes: [
          "biped"
        ]
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    sizeBytes: 48
  },
  {
    kind: "struct",
    name: "ScenarioVehicle",
    fields: [
      {
        kind: "field",
        name: "type",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "name",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "not placed",
        type: "ScenarioSpawnNotPlaced"
      },
      {
        kind: "field",
        name: "desired permutation",
        type: "int16",
        comment: "when non-zero the game will try use model permutations with a matching number suffix"
      },
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "rotation",
        type: "Euler3D"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "appearance player index",
        type: "int8"
      },
      {
        kind: "pad",
        size: 3
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "body vitality",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "flags",
        type: "ScenarioUnitFlags"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "multiplayer team index",
        type: "int8"
      },
      {
        kind: "pad",
        size: 1
      },
      {
        kind: "field",
        name: "multiplayer spawn flags",
        type: "ScenarioVehicleMultiplayerSpawnFlags"
      },
      {
        kind: "pad",
        size: 28
      }
    ],
    sizeBytes: 120
  },
  {
    kind: "struct",
    name: "ScenarioVehiclePalette",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagDependency",
        classes: [
          "vehicle"
        ]
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    sizeBytes: 48
  },
  {
    kind: "struct",
    name: "ScenarioEquipment",
    fields: [
      {
        kind: "field",
        name: "type",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "name",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "not placed",
        type: "ScenarioSpawnNotPlaced"
      },
      {
        kind: "field",
        name: "desired permutation",
        type: "int16",
        comment: "when non-zero the game will try use model permutations with a matching number suffix"
      },
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "rotation",
        type: "Euler3D"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "misc flags",
        type: "ScenarioItemFlags"
      },
      {
        kind: "field",
        name: "appearance player index",
        type: "int8"
      },
      {
        kind: "pad",
        size: 3
      }
    ],
    sizeBytes: 40
  },
  {
    kind: "struct",
    name: "ScenarioEquipmentPalette",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagDependency",
        classes: [
          "equipment"
        ]
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    sizeBytes: 48
  },
  {
    kind: "struct",
    name: "ScenarioWeapon",
    fields: [
      {
        kind: "field",
        name: "type",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "name",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "not placed",
        type: "ScenarioSpawnNotPlaced"
      },
      {
        kind: "field",
        name: "desired permutation",
        type: "int16",
        comment: "when non-zero the game will try use model permutations with a matching number suffix"
      },
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "rotation",
        type: "Euler3D"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "appearance player index",
        type: "int8"
      },
      {
        kind: "pad",
        size: 3
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "rounds reserved",
        type: "int16",
        comment: "does not include loaded rounds; cannot go above maximum rounds"
      },
      {
        kind: "field",
        name: "rounds loaded",
        type: "int16"
      },
      {
        kind: "field",
        name: "flags",
        type: "ScenarioItemFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 12
      }
    ],
    sizeBytes: 92
  },
  {
    kind: "struct",
    name: "ScenarioWeaponPalette",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagDependency",
        classes: [
          "weapon"
        ]
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    sizeBytes: 48
  },
  {
    kind: "struct",
    name: "ScenarioDeviceGroup",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "initial value",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "flags",
        type: "ScenarioDeviceGroupFlags"
      },
      {
        kind: "pad",
        size: 12
      }
    ],
    sizeBytes: 52
  },
  {
    kind: "struct",
    name: "ScenarioMachine",
    fields: [
      {
        kind: "field",
        name: "type",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "name",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "not placed",
        type: "ScenarioSpawnNotPlaced"
      },
      {
        kind: "field",
        name: "desired permutation",
        type: "int16",
        comment: "when non-zero the game will try use model permutations with a matching number suffix"
      },
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "rotation",
        type: "Euler3D"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "appearance player index",
        type: "int8"
      },
      {
        kind: "pad",
        size: 3
      },
      {
        kind: "field",
        name: "power group",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "position group",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "device flags",
        type: "ScenarioDeviceFlags"
      },
      {
        kind: "field",
        name: "machine flags",
        type: "ScenarioMachineFlags"
      },
      {
        kind: "pad",
        size: 12
      }
    ],
    sizeBytes: 64
  },
  {
    kind: "struct",
    name: "ScenarioMachinePalette",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagDependency",
        classes: [
          "device_machine"
        ]
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    sizeBytes: 48
  },
  {
    kind: "struct",
    name: "ScenarioControl",
    fields: [
      {
        kind: "field",
        name: "type",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "name",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "not placed",
        type: "ScenarioSpawnNotPlaced"
      },
      {
        kind: "field",
        name: "desired permutation",
        type: "int16",
        comment: "when non-zero the game will try use model permutations with a matching number suffix"
      },
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "rotation",
        type: "Euler3D"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "appearance player index",
        type: "int8"
      },
      {
        kind: "pad",
        size: 3
      },
      {
        kind: "field",
        name: "power group",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "position group",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "device flags",
        type: "ScenarioDeviceFlags"
      },
      {
        kind: "field",
        name: "control flags",
        type: "ScenarioControlFlags"
      },
      {
        kind: "field",
        name: "custom control name",
        type: "int16",
        comment: 'Zero maps to "none", higher values map to strings in the referenced "custom object names" unicode string list with the first string starting at 1'
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 8
      }
    ],
    sizeBytes: 64
  },
  {
    kind: "struct",
    name: "ScenarioControlPalette",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagDependency",
        classes: [
          "device_control"
        ]
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    sizeBytes: 48
  },
  {
    kind: "struct",
    name: "ScenarioLightFixture",
    fields: [
      {
        kind: "field",
        name: "type",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "name",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "not placed",
        type: "ScenarioSpawnNotPlaced"
      },
      {
        kind: "field",
        name: "desired permutation",
        type: "int16",
        comment: "when non-zero the game will try use model permutations with a matching number suffix"
      },
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "rotation",
        type: "Euler3D"
      },
      {
        kind: "field",
        name: "bsp indices",
        type: "uint16",
        cacheOnly: true,
        comment: "Unused in Gearbox versions of Halo PC; bitmask"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "appearance player index",
        type: "int8"
      },
      {
        kind: "pad",
        size: 3
      },
      {
        kind: "field",
        name: "power group",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "position group",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "device flags",
        type: "ScenarioDeviceFlags"
      },
      {
        kind: "field",
        name: "color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "intensity",
        type: "float"
      },
      {
        kind: "field",
        name: "falloff angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "cutoff angle",
        type: "Angle"
      },
      {
        kind: "pad",
        size: 16
      }
    ],
    sizeBytes: 88
  },
  {
    kind: "struct",
    name: "ScenarioLightFixturePalette",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagDependency",
        classes: [
          "device_light_fixture"
        ]
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    sizeBytes: 48
  },
  {
    kind: "struct",
    name: "ScenarioSoundScenery",
    fields: [
      {
        kind: "field",
        name: "type",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "name",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "not placed",
        type: "ScenarioSpawnNotPlaced"
      },
      {
        kind: "field",
        name: "desired permutation",
        type: "int16",
        comment: "when non-zero the game will try use model permutations with a matching number suffix"
      },
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "rotation",
        type: "Euler3D"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "appearance player index",
        type: "int8"
      },
      {
        kind: "pad",
        size: 3
      }
    ],
    sizeBytes: 40
  },
  {
    kind: "struct",
    name: "ScenarioSoundSceneryPalette",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagDependency",
        classes: [
          "sound_scenery"
        ]
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    sizeBytes: 48
  },
  {
    kind: "struct",
    name: "ScenarioPlayerStartingProfile",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "starting health modifier",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "starting shield modifier",
        type: "Fraction",
        maximum: 3
      },
      {
        kind: "field",
        name: "primary weapon",
        type: "TagDependency",
        classes: [
          "weapon"
        ]
      },
      {
        kind: "field",
        name: "primary rounds loaded",
        type: "int16"
      },
      {
        kind: "field",
        name: "primary rounds reserved",
        type: "int16",
        comment: "does not include loaded ammo; can go above maximum rounds"
      },
      {
        kind: "field",
        name: "secondary weapon",
        type: "TagDependency",
        classes: [
          "weapon"
        ]
      },
      {
        kind: "field",
        name: "secondary rounds loaded",
        type: "int16"
      },
      {
        kind: "field",
        name: "secondary rounds reserved",
        type: "int16",
        comment: "does not include loaded ammo; can go above maximum rounds"
      },
      {
        kind: "field",
        name: "starting fragmentation grenade count",
        type: "int8"
      },
      {
        kind: "field",
        name: "starting plasma grenade count",
        type: "int8"
      },
      {
        kind: "field",
        name: "starting grenade type2 count",
        type: "int8"
      },
      {
        kind: "field",
        name: "starting grenade type3 count",
        type: "int8"
      },
      {
        kind: "pad",
        size: 20
      }
    ],
    sizeBytes: 104
  },
  {
    kind: "struct",
    name: "ScenarioPlayerStartingLocation",
    fields: [
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "facing",
        type: "Angle"
      },
      {
        kind: "field",
        name: "team index",
        type: "Index"
      },
      {
        kind: "field",
        name: "bsp index",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "type 0",
        type: "ScenarioSpawnType"
      },
      {
        kind: "field",
        name: "type 1",
        type: "ScenarioSpawnType"
      },
      {
        kind: "field",
        name: "type 2",
        type: "ScenarioSpawnType"
      },
      {
        kind: "field",
        name: "type 3",
        type: "ScenarioSpawnType"
      },
      {
        kind: "pad",
        size: 24
      }
    ],
    sizeBytes: 52
  },
  {
    kind: "struct",
    name: "ScenarioTriggerVolume",
    fields: [
      {
        kind: "field",
        name: "type",
        type: "ScenarioTriggerVolumeType"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "parameters",
        type: "float",
        count: 3,
        comment: "appears to be zero"
      },
      {
        kind: "field",
        name: "rotation vector forward",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "rotation vector up",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "starting corner",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "ending corner offset",
        type: "Point3D"
      }
    ],
    sizeBytes: 96
  },
  {
    kind: "struct",
    name: "ScenarioRecordedAnimation",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "version",
        type: "int8"
      },
      {
        kind: "field",
        name: "raw animation data",
        type: "int8"
      },
      {
        kind: "field",
        name: "unit control data version",
        type: "int8"
      },
      {
        kind: "pad",
        size: 1
      },
      {
        kind: "field",
        name: "length of animation",
        type: "int16"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "recorded animation event stream",
        type: "TagDataOffset",
        maximum: 2097152
      }
    ],
    sizeBytes: 64
  },
  {
    kind: "struct",
    name: "ScenarioNetgameFlags",
    fields: [
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "facing",
        type: "Angle"
      },
      {
        kind: "field",
        name: "type",
        type: "ScenarioNetgameFlagType"
      },
      {
        kind: "field",
        name: "usage id",
        type: "Index"
      },
      {
        kind: "field",
        name: "weapon group",
        type: "TagDependency",
        classes: [
          "item_collection"
        ]
      },
      {
        kind: "pad",
        size: 112
      }
    ],
    sizeBytes: 148
  },
  {
    kind: "struct",
    name: "ScenarioNetgameEquipment",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "ScenarioNetgameEquipmentFlags"
      },
      {
        kind: "field",
        name: "type 0",
        type: "ScenarioSpawnType"
      },
      {
        kind: "field",
        name: "type 1",
        type: "ScenarioSpawnType"
      },
      {
        kind: "field",
        name: "type 2",
        type: "ScenarioSpawnType"
      },
      {
        kind: "field",
        name: "type 3",
        type: "ScenarioSpawnType"
      },
      {
        kind: "field",
        name: "team index",
        type: "Index"
      },
      {
        kind: "field",
        name: "spawn time",
        type: "int16",
        comment: "0 = use default spawn time in item_collection"
      },
      {
        kind: "field",
        name: "unknown_ffffffff",
        type: "uint32",
        comment: "always 0xFFFFFFFF?"
      },
      {
        kind: "pad",
        size: 44
      },
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "facing",
        type: "Angle"
      },
      {
        kind: "field",
        name: "item collection",
        type: "TagDependency",
        classes: [
          "item_collection"
        ]
      },
      {
        kind: "pad",
        size: 48
      }
    ],
    sizeBytes: 144
  },
  {
    kind: "struct",
    name: "ScenarioStartingEquipment",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "ScenarioStartingEquipmentFlags"
      },
      {
        kind: "field",
        name: "type 0",
        type: "ScenarioSpawnType"
      },
      {
        kind: "field",
        name: "type 1",
        type: "ScenarioSpawnType"
      },
      {
        kind: "field",
        name: "type 2",
        type: "ScenarioSpawnType"
      },
      {
        kind: "field",
        name: "type 3",
        type: "ScenarioSpawnType"
      },
      {
        kind: "pad",
        size: 48
      },
      {
        kind: "field",
        name: "item collection 1",
        type: "TagDependency",
        classes: [
          "item_collection"
        ]
      },
      {
        kind: "field",
        name: "item collection 2",
        type: "TagDependency",
        classes: [
          "item_collection"
        ]
      },
      {
        kind: "field",
        name: "item collection 3",
        type: "TagDependency",
        classes: [
          "item_collection"
        ]
      },
      {
        kind: "field",
        name: "item collection 4",
        type: "TagDependency",
        classes: [
          "item_collection"
        ]
      },
      {
        kind: "field",
        name: "item collection 5",
        type: "TagDependency",
        classes: [
          "item_collection"
        ]
      },
      {
        kind: "field",
        name: "item collection 6",
        type: "TagDependency",
        classes: [
          "item_collection"
        ]
      },
      {
        kind: "pad",
        size: 48
      }
    ],
    sizeBytes: 204
  },
  {
    kind: "struct",
    name: "ScenarioBSPSwitchTriggerVolume",
    fields: [
      {
        kind: "field",
        name: "trigger volume",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "source",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "destination",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "unknown",
        type: "uint16"
      }
    ],
    sizeBytes: 8
  },
  {
    kind: "struct",
    name: "ScenarioDecal",
    fields: [
      {
        kind: "field",
        name: "decal type",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "yaw",
        type: "int8"
      },
      {
        kind: "field",
        name: "pitch",
        type: "int8"
      },
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      }
    ],
    sizeBytes: 16
  },
  {
    kind: "struct",
    name: "ScenarioDecalPalette",
    fields: [
      {
        kind: "field",
        name: "reference",
        type: "TagDependency",
        classes: [
          "decal"
        ]
      }
    ],
    sizeBytes: 16
  },
  {
    kind: "struct",
    name: "ScenarioDetailObjectCollectionPalette",
    fields: [
      {
        kind: "field",
        name: "reference",
        type: "TagDependency",
        classes: [
          "detail_object_collection"
        ]
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    sizeBytes: 48
  },
  {
    kind: "struct",
    name: "ScenarioActorPalette",
    fields: [
      {
        kind: "field",
        name: "reference",
        type: "TagDependency",
        classes: [
          "actor_variant"
        ]
      }
    ],
    sizeBytes: 16
  },
  {
    kind: "struct",
    name: "ScenarioMovePosition",
    fields: [
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "facing",
        type: "Angle"
      },
      {
        kind: "field",
        name: "weight",
        type: "float"
      },
      {
        kind: "field",
        name: "time",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "animation",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "sequence id",
        type: "int8"
      },
      {
        kind: "pad",
        size: 1
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "cluster index",
        type: "Index",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 34
      },
      {
        kind: "field",
        name: "surface index",
        type: "uint32",
        cacheOnly: true
      }
    ],
    sizeBytes: 80
  },
  {
    kind: "struct",
    name: "ScenarioActorStartingLocation",
    fields: [
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "facing",
        type: "Angle"
      },
      {
        kind: "field",
        name: "cluster index",
        type: "Index",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "sequence id",
        type: "int8"
      },
      {
        kind: "field",
        name: "flags",
        type: "ScenarioActorStartingLocationFlags"
      },
      {
        kind: "field",
        name: "return state",
        type: "ScenarioReturnState"
      },
      {
        kind: "field",
        name: "initial state",
        type: "ScenarioReturnState"
      },
      {
        kind: "field",
        name: "actor type",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "command list",
        type: "Index",
        struct: "Scenario"
      }
    ],
    sizeBytes: 28
  },
  {
    kind: "struct",
    name: "ScenarioSquad",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "actor type",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "platoon",
        type: "Index",
        struct: "ScenarioEncounter"
      },
      {
        kind: "field",
        name: "initial state",
        type: "ScenarioReturnState"
      },
      {
        kind: "field",
        name: "return state",
        type: "ScenarioReturnState"
      },
      {
        kind: "field",
        name: "flags",
        type: "ScenarioSquadFlags"
      },
      {
        kind: "field",
        name: "unique leader type",
        type: "ScenarioUniqueLeaderType"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 28
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "maneuver to squad",
        type: "Index"
      },
      {
        kind: "field",
        name: "squad delay time",
        type: "float"
      },
      {
        kind: "field",
        name: "attacking",
        type: "ScenarioSquadAttacking"
      },
      {
        kind: "field",
        name: "attacking search",
        type: "ScenarioSquadAttacking"
      },
      {
        kind: "field",
        name: "attacking guard",
        type: "ScenarioSquadAttacking"
      },
      {
        kind: "field",
        name: "defending",
        type: "ScenarioSquadAttacking"
      },
      {
        kind: "field",
        name: "defending search",
        type: "ScenarioSquadAttacking"
      },
      {
        kind: "field",
        name: "defending guard",
        type: "ScenarioSquadAttacking"
      },
      {
        kind: "field",
        name: "pursuing",
        type: "ScenarioSquadAttacking"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "normal diff count",
        type: "int16"
      },
      {
        kind: "field",
        name: "insane diff count",
        type: "int16"
      },
      {
        kind: "field",
        name: "major upgrade",
        type: "ScenarioMajorUpgrade"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "respawn min actors",
        type: "int16"
      },
      {
        kind: "field",
        name: "respawn max actors",
        type: "int16"
      },
      {
        kind: "field",
        name: "respawn total",
        type: "int16"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "respawn delay",
        type: "float",
        bounds: true
      },
      {
        kind: "pad",
        size: 48
      },
      {
        kind: "field",
        name: "move positions",
        type: "TagReflexive",
        struct: "ScenarioMovePosition",
        maximum: 32
      },
      {
        kind: "field",
        name: "starting locations",
        type: "TagReflexive",
        struct: "ScenarioActorStartingLocation",
        maximum: 32
      },
      {
        kind: "pad",
        size: 12
      }
    ],
    sizeBytes: 232
  },
  {
    kind: "struct",
    name: "ScenarioPlatoon",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "flags",
        type: "ScenarioPlatoonFlags"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "change attacking defending state when",
        type: "ScenarioChangeAttackingDefendingStateWhen"
      },
      {
        kind: "field",
        name: "happens to",
        type: "Index",
        struct: "ScenarioEncounter"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "maneuver when",
        type: "ScenarioChangeAttackingDefendingStateWhen"
      },
      {
        kind: "field",
        name: "happens to 1",
        type: "Index",
        struct: "ScenarioEncounter"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "pad",
        size: 64
      },
      {
        kind: "pad",
        size: 36
      }
    ],
    sizeBytes: 172
  },
  {
    kind: "struct",
    name: "ScenarioFiringPosition",
    fields: [
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "group index",
        type: "ScenarioGroupIndex"
      },
      {
        kind: "field",
        name: "cluster index",
        type: "Index",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "surface index",
        type: "uint32",
        cacheOnly: true
      }
    ],
    sizeBytes: 24
  },
  {
    kind: "struct",
    name: "ScenarioEncounter",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "flags",
        type: "ScenarioEncounterFlags"
      },
      {
        kind: "field",
        name: "team index",
        type: "ScenarioTeamIndex"
      },
      {
        kind: "field",
        name: "one",
        type: "int16",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "search behavior",
        type: "ScenarioSearchBehavior"
      },
      {
        kind: "field",
        name: "manual bsp index",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "respawn delay",
        type: "float",
        bounds: true
      },
      {
        kind: "pad",
        size: 74
      },
      {
        kind: "field",
        name: "precomputed bsp index",
        type: "Index",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "squads",
        type: "TagReflexive",
        struct: "ScenarioSquad",
        maximum: 64
      },
      {
        kind: "field",
        name: "platoons",
        type: "TagReflexive",
        struct: "ScenarioPlatoon",
        maximum: 32
      },
      {
        kind: "field",
        name: "firing positions",
        type: "TagReflexive",
        struct: "ScenarioFiringPosition",
        maximum: 512
      },
      {
        kind: "field",
        name: "player starting locations",
        type: "TagReflexive",
        struct: "ScenarioPlayerStartingLocation",
        maximum: 256
      }
    ],
    sizeBytes: 176
  },
  {
    kind: "struct",
    name: "ScenarioCommand",
    fields: [
      {
        kind: "field",
        name: "atom type",
        type: "ScenarioAtomType"
      },
      {
        kind: "field",
        name: "atom modifier",
        type: "int16"
      },
      {
        kind: "field",
        name: "parameter1",
        type: "float"
      },
      {
        kind: "field",
        name: "parameter2",
        type: "float"
      },
      {
        kind: "field",
        name: "point 1",
        type: "Index",
        struct: "ScenarioCommandList"
      },
      {
        kind: "field",
        name: "point 2",
        type: "Index",
        struct: "ScenarioCommandList"
      },
      {
        kind: "field",
        name: "animation",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "script",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "recording",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "command",
        type: "Index",
        struct: "ScenarioCommandList"
      },
      {
        kind: "field",
        name: "object name",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "pad",
        size: 6
      }
    ],
    sizeBytes: 32
  },
  {
    kind: "struct",
    name: "ScenarioCommandPoint",
    fields: [
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "surface index",
        type: "uint32",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 4
      }
    ],
    sizeBytes: 20
  },
  {
    kind: "struct",
    name: "ScenarioCommandList",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "flags",
        type: "ScenarioCommandListFlags"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "manual bsp index",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "precomputed bsp index",
        type: "Index",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "commands",
        type: "TagReflexive",
        struct: "ScenarioCommand",
        maximum: 64
      },
      {
        kind: "field",
        name: "points",
        type: "TagReflexive",
        struct: "ScenarioCommandPoint",
        maximum: 64
      },
      {
        kind: "pad",
        size: 24
      }
    ],
    sizeBytes: 96
  },
  {
    kind: "struct",
    name: "ScenarioAIAnimationReference",
    fields: [
      {
        kind: "field",
        name: "animation name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "animation graph",
        type: "TagDependency",
        classes: [
          "model_animations"
        ]
      },
      {
        kind: "pad",
        size: 12
      }
    ],
    sizeBytes: 60
  },
  {
    kind: "struct",
    name: "ScenarioAIScriptReference",
    fields: [
      {
        kind: "field",
        name: "script name",
        type: "TagString"
      },
      {
        kind: "pad",
        size: 8
      }
    ],
    sizeBytes: 40
  },
  {
    kind: "struct",
    name: "ScenarioAIRecordingReference",
    fields: [
      {
        kind: "field",
        name: "recording name",
        type: "TagString"
      },
      {
        kind: "pad",
        size: 8
      }
    ],
    sizeBytes: 40
  },
  {
    kind: "struct",
    name: "ScenarioAIConversationParticipant",
    fields: [
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "flags",
        type: "ScenarioAIConversationParticipantFlags"
      },
      {
        kind: "field",
        name: "selection type",
        type: "ScenarioSelectionType"
      },
      {
        kind: "field",
        name: "actor type",
        type: "ActorType"
      },
      {
        kind: "field",
        name: "use this object",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "field",
        name: "set new name",
        type: "Index",
        struct: "Scenario"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "variant numbers",
        type: "uint16",
        count: 6,
        cacheOnly: true,
        comment: "Determines which kind of variant gets a given line. By default, this matches by tag path (bisenti = 2, fitzgerald/jenkins = 4, aussie = 5, mendoza = 6, sarge/johnson = 100, sarge2/lehto = 101, everything else = 0, null = 65535)"
      },
      {
        kind: "field",
        name: "encounter name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "encounter index",
        type: "uint32",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 12
      }
    ],
    sizeBytes: 84
  },
  {
    kind: "struct",
    name: "ScenarioAIConversationLine",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "ScenarioAIConversationLineFlags"
      },
      {
        kind: "field",
        name: "participant",
        type: "Index",
        struct: "ScenarioAIConversation"
      },
      {
        kind: "field",
        name: "addressee",
        type: "ScenarioAddressee",
        struct: "ScenarioAIConversation"
      },
      {
        kind: "field",
        name: "addressee participant",
        type: "Index",
        struct: "ScenarioAIConversation"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "line delay time",
        type: "float"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "variant 1",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "variant 2",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "variant 3",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "variant 4",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "variant 5",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "variant 6",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      }
    ],
    sizeBytes: 124
  },
  {
    kind: "struct",
    name: "ScenarioAIConversation",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "flags",
        type: "ScenarioAIConversationFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "trigger distance",
        type: "float"
      },
      {
        kind: "field",
        name: "run to player dist",
        type: "float"
      },
      {
        kind: "pad",
        size: 36
      },
      {
        kind: "field",
        name: "participants",
        type: "TagReflexive",
        struct: "ScenarioAIConversationParticipant",
        maximum: 8
      },
      {
        kind: "field",
        name: "lines",
        type: "TagReflexive",
        struct: "ScenarioAIConversationLine",
        maximum: 32
      },
      {
        kind: "pad",
        size: 12
      }
    ],
    sizeBytes: 116
  },
  {
    kind: "struct",
    name: "ScenarioScriptParameter",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "return type",
        type: "ScenarioScriptValueType"
      },
      {
        kind: "pad",
        size: 2
      }
    ],
    sizeBytes: 36
  },
  {
    kind: "struct",
    name: "ScenarioScript",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "script type",
        type: "ScenarioScriptType"
      },
      {
        kind: "field",
        name: "return type",
        type: "ScenarioScriptValueType"
      },
      {
        kind: "field",
        name: "root expression index",
        type: "uint32"
      },
      {
        kind: "pad",
        size: 40
      },
      {
        kind: "field",
        name: "parameters",
        type: "TagReflexive",
        struct: "ScenarioScriptParameter",
        maximum: 16
      }
    ],
    sizeBytes: 92
  },
  {
    kind: "struct",
    name: "ScenarioGlobal",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "type",
        type: "ScenarioScriptValueType"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "initialization expression index",
        type: "int32"
      },
      {
        kind: "pad",
        size: 48
      }
    ],
    sizeBytes: 92
  },
  {
    kind: "struct",
    name: "ScenarioReference",
    fields: [
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "reference",
        type: "TagDependency",
        classes: [
          "*"
        ]
      }
    ],
    sizeBytes: 40
  },
  {
    kind: "struct",
    name: "ScenarioSourceFile",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "source",
        type: "TagDataOffset",
        maximum: 1048576
      }
    ],
    sizeBytes: 52
  },
  {
    kind: "struct",
    name: "ScenarioCutsceneFlag",
    fields: [
      {
        kind: "field",
        name: "unknown",
        type: "uint32",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "facing",
        type: "Euler2D"
      },
      {
        kind: "pad",
        size: 36
      }
    ],
    sizeBytes: 92
  },
  {
    kind: "struct",
    name: "ScenarioCutsceneCameraPoint",
    fields: [
      {
        kind: "field",
        name: "unknown",
        type: "uint32",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "orientation",
        type: "Euler3D"
      },
      {
        kind: "field",
        name: "field of view",
        type: "Angle"
      },
      {
        kind: "pad",
        size: 36
      }
    ],
    sizeBytes: 104
  },
  {
    kind: "struct",
    name: "ScenarioCutsceneTitle",
    fields: [
      {
        kind: "field",
        name: "unknown",
        type: "uint32",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "text bounds",
        type: "Rectangle2D"
      },
      {
        kind: "field",
        name: "string index",
        type: "Index"
      },
      {
        kind: "field",
        name: "text style",
        type: "ScenarioTextStyle"
      },
      {
        kind: "field",
        name: "justification",
        type: "ScenarioJustification"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "text flags",
        type: "ScenarioTextFlags"
      },
      {
        kind: "field",
        name: "text color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "shadow color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "fade in time",
        type: "float"
      },
      {
        kind: "field",
        name: "up time",
        type: "float"
      },
      {
        kind: "field",
        name: "fade out time",
        type: "float"
      },
      {
        kind: "pad",
        size: 16
      }
    ],
    sizeBytes: 96
  },
  {
    kind: "struct",
    name: "ScenarioBSP",
    fields: [
      {
        kind: "field",
        name: "bsp start",
        type: "uint32",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "bsp size",
        type: "uint32",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "bsp address",
        type: "uint32",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "structure bsp",
        type: "TagDependency",
        classes: [
          "scenario_structure_bsp"
        ]
      }
    ],
    sizeBytes: 32
  },
  {
    kind: "struct",
    name: "ScenarioScriptNode",
    fields: [
      {
        kind: "field",
        name: "salt",
        type: "uint16"
      },
      {
        kind: "field",
        name: "index union",
        type: "uint16"
      },
      {
        kind: "field",
        name: "type",
        type: "ScenarioScriptValueType"
      },
      {
        kind: "field",
        name: "flags",
        type: "ScenarioScriptNodeFlags"
      },
      {
        kind: "field",
        name: "next node",
        type: "uint32"
      },
      {
        kind: "field",
        name: "string offset",
        type: "uint32"
      },
      {
        kind: "field",
        name: "data",
        type: "ScenarioScriptNodeValue"
      }
    ],
    sizeBytes: 20
  },
  {
    kind: "struct",
    name: "ScenarioScriptNodeTable",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "maximum count",
        type: "uint16"
      },
      {
        kind: "field",
        name: "element size",
        type: "uint16"
      },
      {
        kind: "field",
        name: "one",
        type: "uint8"
      },
      {
        kind: "pad",
        size: 3
      },
      {
        kind: "field",
        name: "data",
        type: "uint32"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "size",
        type: "uint16"
      },
      {
        kind: "field",
        name: "count",
        type: "uint16"
      },
      {
        kind: "field",
        name: "next id",
        type: "uint16"
      },
      {
        kind: "field",
        name: "first element ptr",
        type: "uint32"
      }
    ],
    sizeBytes: 56
  },
  {
    kind: "struct",
    name: "Scenario",
    fields: [
      {
        kind: "field",
        name: "don't use",
        type: "TagDependency",
        classes: [
          "scenario_structure_bsp"
        ]
      },
      {
        kind: "field",
        name: "won't use",
        type: "TagDependency",
        classes: [
          "scenario_structure_bsp"
        ]
      },
      {
        kind: "field",
        name: "can't use",
        type: "TagDependency",
        classes: [
          "sky"
        ]
      },
      {
        kind: "field",
        name: "skies",
        type: "TagReflexive",
        struct: "ScenarioSky",
        maximum: 8
      },
      {
        kind: "field",
        name: "type",
        type: "ScenarioType"
      },
      {
        kind: "field",
        name: "flags",
        type: "ScenarioFlags"
      },
      {
        kind: "field",
        name: "child scenarios",
        type: "TagReflexive",
        struct: "ScenarioChildScenario",
        maximum: 16
      },
      {
        kind: "field",
        name: "local north",
        type: "float"
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "pad",
        size: 136
      },
      {
        kind: "field",
        name: "predicted resources",
        type: "TagReflexive",
        struct: "PredictedResource",
        maximum: 1024,
        cacheOnly: true
      },
      {
        kind: "field",
        name: "functions",
        type: "TagReflexive",
        struct: "ScenarioFunction",
        maximum: 32
      },
      {
        kind: "field",
        name: "editor scenario data",
        type: "TagDataOffset",
        maximum: 65536
      },
      {
        kind: "field",
        name: "comments",
        type: "TagReflexive",
        struct: "ScenarioEditorComment",
        maximum: 1024
      },
      {
        kind: "field",
        name: "scavenger hunt objects",
        type: "TagReflexive",
        struct: "ScenarioScavengerHuntObjects",
        maximum: 16
      },
      {
        kind: "pad",
        size: 212
      },
      {
        kind: "field",
        name: "object names",
        type: "TagReflexive",
        struct: "ScenarioObjectName",
        maximum: 640,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "scenery",
        type: "TagReflexive",
        struct: "ScenarioScenery",
        maximum: 2e3,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "scenery palette",
        type: "TagReflexive",
        struct: "ScenarioSceneryPalette",
        maximum: 256,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "bipeds",
        type: "TagReflexive",
        struct: "ScenarioBiped",
        maximum: 128,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "biped palette",
        type: "TagReflexive",
        struct: "ScenarioBipedPalette",
        maximum: 256,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "vehicles",
        type: "TagReflexive",
        struct: "ScenarioVehicle",
        maximum: 256,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "vehicle palette",
        type: "TagReflexive",
        struct: "ScenarioVehiclePalette",
        maximum: 256,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "equipment",
        type: "TagReflexive",
        struct: "ScenarioEquipment",
        maximum: 256,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "equipment palette",
        type: "TagReflexive",
        struct: "ScenarioEquipmentPalette",
        maximum: 256,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "weapons",
        type: "TagReflexive",
        struct: "ScenarioWeapon",
        maximum: 128,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "weapon palette",
        type: "TagReflexive",
        struct: "ScenarioWeaponPalette",
        maximum: 256,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "device groups",
        type: "TagReflexive",
        struct: "ScenarioDeviceGroup",
        maximum: 128
      },
      {
        kind: "field",
        name: "machines",
        type: "TagReflexive",
        struct: "ScenarioMachine",
        maximum: 400,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "machine palette",
        type: "TagReflexive",
        struct: "ScenarioMachinePalette",
        maximum: 256,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "controls",
        type: "TagReflexive",
        struct: "ScenarioControl",
        maximum: 100,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "control palette",
        type: "TagReflexive",
        struct: "ScenarioControlPalette",
        maximum: 256,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "light fixtures",
        type: "TagReflexive",
        struct: "ScenarioLightFixture",
        maximum: 500,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "light fixture palette",
        type: "TagReflexive",
        struct: "ScenarioLightFixturePalette",
        maximum: 256,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "sound scenery",
        type: "TagReflexive",
        struct: "ScenarioSoundScenery",
        maximum: 256,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "sound scenery palette",
        type: "TagReflexive",
        struct: "ScenarioSoundSceneryPalette",
        maximum: 256,
        extendedMaximum: 32767
      },
      {
        kind: "pad",
        size: 84
      },
      {
        kind: "field",
        name: "player starting profile",
        type: "TagReflexive",
        struct: "ScenarioPlayerStartingProfile",
        maximum: 256,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "player starting locations",
        type: "TagReflexive",
        struct: "ScenarioPlayerStartingLocation",
        maximum: 256,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "trigger volumes",
        type: "TagReflexive",
        struct: "ScenarioTriggerVolume",
        maximum: 256,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "recorded animations",
        type: "TagReflexive",
        struct: "ScenarioRecordedAnimation",
        maximum: 1024,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "netgame flags",
        type: "TagReflexive",
        struct: "ScenarioNetgameFlags",
        maximum: 200,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "netgame equipment",
        type: "TagReflexive",
        struct: "ScenarioNetgameEquipment",
        maximum: 200,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "starting equipment",
        type: "TagReflexive",
        struct: "ScenarioStartingEquipment",
        maximum: 200,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "bsp switch trigger volumes",
        type: "TagReflexive",
        struct: "ScenarioBSPSwitchTriggerVolume",
        maximum: 256,
        cacheOnly: true
      },
      {
        kind: "field",
        name: "decals",
        type: "TagReflexive",
        struct: "ScenarioDecal",
        maximum: 65536
      },
      {
        kind: "field",
        name: "decal palette",
        type: "TagReflexive",
        struct: "ScenarioDecalPalette",
        maximum: 128,
        extendedMaximum: 32767
      },
      {
        kind: "field",
        name: "detail object collection palette",
        type: "TagReflexive",
        struct: "ScenarioDetailObjectCollectionPalette",
        maximum: 32
      },
      {
        kind: "pad",
        size: 84
      },
      {
        kind: "field",
        name: "actor palette",
        type: "TagReflexive",
        struct: "ScenarioActorPalette",
        maximum: 64
      },
      {
        kind: "field",
        name: "encounters",
        type: "TagReflexive",
        struct: "ScenarioEncounter",
        maximum: 128
      },
      {
        kind: "field",
        name: "command lists",
        type: "TagReflexive",
        struct: "ScenarioCommandList",
        maximum: 256
      },
      {
        kind: "field",
        name: "ai animation references",
        type: "TagReflexive",
        struct: "ScenarioAIAnimationReference",
        maximum: 128
      },
      {
        kind: "field",
        name: "ai script references",
        type: "TagReflexive",
        struct: "ScenarioAIScriptReference",
        maximum: 128
      },
      {
        kind: "field",
        name: "ai recording references",
        type: "TagReflexive",
        struct: "ScenarioAIRecordingReference",
        maximum: 128
      },
      {
        kind: "field",
        name: "ai conversations",
        type: "TagReflexive",
        struct: "ScenarioAIConversation",
        maximum: 128
      },
      {
        kind: "field",
        name: "script syntax data",
        type: "TagDataOffset",
        maximum: 655396
      },
      {
        kind: "field",
        name: "script string data",
        type: "TagDataOffset",
        maximum: 819200
      },
      {
        kind: "field",
        name: "scripts",
        type: "TagReflexive",
        struct: "ScenarioScript",
        maximum: 1024
      },
      {
        kind: "field",
        name: "globals",
        type: "TagReflexive",
        struct: "ScenarioGlobal",
        maximum: 512
      },
      {
        kind: "field",
        name: "references",
        type: "TagReflexive",
        struct: "ScenarioReference",
        maximum: 512
      },
      {
        kind: "field",
        name: "source files",
        type: "TagReflexive",
        struct: "ScenarioSourceFile",
        maximum: 16,
        nonCached: true
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "cutscene flags",
        type: "TagReflexive",
        struct: "ScenarioCutsceneFlag",
        maximum: 512
      },
      {
        kind: "field",
        name: "cutscene camera points",
        type: "TagReflexive",
        struct: "ScenarioCutsceneCameraPoint",
        maximum: 512
      },
      {
        kind: "field",
        name: "cutscene titles",
        type: "TagReflexive",
        struct: "ScenarioCutsceneTitle",
        maximum: 64
      },
      {
        kind: "pad",
        size: 108
      },
      {
        kind: "field",
        name: "custom object names",
        type: "TagDependency",
        classes: [
          "unicode_string_list"
        ]
      },
      {
        kind: "field",
        name: "ingame help text",
        type: "TagDependency",
        classes: [
          "unicode_string_list"
        ]
      },
      {
        kind: "field",
        name: "hud messages",
        type: "TagDependency",
        classes: [
          "hud_message_text"
        ]
      },
      {
        kind: "field",
        name: "structure bsps",
        type: "TagReflexive",
        struct: "ScenarioBSP",
        maximum: 16
      }
    ],
    tagClass: "scenario",
    sizeBytes: 1456
  }
];

// ../core/src/map/definitions/groups/scenario_structure_bsp.json
var scenario_structure_bsp_default = [
  {
    kind: "bitfield",
    name: "ScenarioStructureBSPMaterialFlags",
    width: 16,
    fields: [
      "coplanar",
      "fog plane"
    ]
  },
  {
    kind: "bitfield",
    name: "ScenarioStructureBSPClusterPortalFlags",
    width: 32,
    fields: [
      "ai can simply not hear through all this amazing stuff darn it"
    ]
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPCollisionMaterial",
    fields: [
      {
        kind: "field",
        name: "shader",
        type: "TagDependency",
        classes: [
          "shader"
        ]
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "material",
        type: "MaterialType",
        cacheOnly: true
      }
    ],
    sizeBytes: 20
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPNode",
    fields: [
      {
        kind: "field",
        name: "bounds x",
        type: "uint8",
        bounds: true
      },
      {
        kind: "field",
        name: "bounds y",
        type: "uint8",
        bounds: true
      },
      {
        kind: "field",
        name: "bounds z",
        type: "uint8",
        bounds: true
      }
    ],
    sizeBytes: 6
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPLeaf",
    fields: [
      {
        kind: "field",
        name: "bounds x",
        type: "uint8",
        bounds: true
      },
      {
        kind: "field",
        name: "bounds y",
        type: "uint8",
        bounds: true
      },
      {
        kind: "field",
        name: "bounds z",
        type: "uint8",
        bounds: true
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "cluster",
        type: "Index"
      },
      {
        kind: "field",
        name: "surface reference count",
        type: "int16"
      },
      {
        kind: "field",
        name: "surface references",
        type: "int32"
      }
    ],
    sizeBytes: 16
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPSurfaceReference",
    fields: [
      {
        kind: "field",
        name: "surface",
        type: "int32"
      },
      {
        kind: "field",
        name: "node",
        type: "int32"
      }
    ],
    sizeBytes: 8
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPSurface",
    fields: [
      {
        kind: "field",
        name: "vertex0 index",
        type: "Index"
      },
      {
        kind: "field",
        name: "vertex1 index",
        type: "Index"
      },
      {
        kind: "field",
        name: "vertex2 index",
        type: "Index"
      }
    ],
    sizeBytes: 6
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPMaterialUncompressedRenderedVertex",
    fields: [
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "normal",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "binormal",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "tangent",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "texture coords",
        type: "Point2D"
      }
    ],
    sizeBytes: 56
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPMaterialCompressedRenderedVertex",
    fields: [
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "normal",
        type: "uint32"
      },
      {
        kind: "field",
        name: "binormal",
        type: "uint32"
      },
      {
        kind: "field",
        name: "tangent",
        type: "uint32"
      },
      {
        kind: "field",
        name: "texture coords",
        type: "Point2D"
      }
    ],
    sizeBytes: 32
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPMaterialUncompressedLightmapVertex",
    fields: [
      {
        kind: "field",
        name: "normal",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "texture coords",
        type: "Point2D"
      }
    ],
    sizeBytes: 20
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPMaterialCompressedLightmapVertex",
    fields: [
      {
        kind: "field",
        name: "normal",
        type: "uint32"
      },
      {
        kind: "field",
        name: "texture coordinate x",
        type: "int16"
      },
      {
        kind: "field",
        name: "texture coordinate y",
        type: "int16"
      }
    ],
    sizeBytes: 8
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPMaterial",
    fields: [
      {
        kind: "field",
        name: "shader",
        type: "TagDependency",
        classes: [
          "shader"
        ]
      },
      {
        kind: "field",
        name: "shader permutation",
        type: "Index"
      },
      {
        kind: "field",
        name: "flags",
        type: "ScenarioStructureBSPMaterialFlags"
      },
      {
        kind: "field",
        name: "surfaces",
        type: "int32"
      },
      {
        kind: "field",
        name: "surface count",
        type: "int32"
      },
      {
        kind: "field",
        name: "centroid",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "ambient color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "distant light count",
        type: "int16"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "distant light 0 color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "distant light 0 direction",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "distant light 1 color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "distant light 1 direction",
        type: "Vector3D"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "reflection tint",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "shadow vector",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "shadow color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "plane",
        type: "Plane3D"
      },
      {
        kind: "field",
        name: "breakable surface",
        type: "Index"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "rendered vertices type",
        type: "VertexType",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "rendered vertices count",
        type: "uint32"
      },
      {
        kind: "field",
        name: "rendered vertices offset",
        type: "uint32",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "rendered vertices index pointer",
        type: "Pointer",
        cacheOnly: true,
        comment: "(Xbox only) an indirect pointer to the rendered vertices"
      },
      {
        kind: "field",
        name: "lightmap vertices type",
        type: "VertexType",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "lightmap vertices count",
        type: "uint32"
      },
      {
        kind: "field",
        name: "lightmap vertices offset",
        type: "uint32",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "lightmap vertices index pointer",
        type: "Pointer",
        cacheOnly: true,
        comment: "(Xbox only) an indirect pointer to the lightmap vertices"
      },
      {
        kind: "field",
        name: "uncompressed vertices",
        type: "TagDataOffset",
        maximum: 4864e3
      },
      {
        kind: "field",
        name: "compressed vertices",
        type: "TagDataOffset",
        maximum: 256e4
      }
    ],
    sizeBytes: 256
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPLightmap",
    fields: [
      {
        kind: "field",
        name: "bitmap",
        type: "Index"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "materials",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPMaterial",
        maximum: 2048
      }
    ],
    sizeBytes: 32
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPLensFlare",
    fields: [
      {
        kind: "field",
        name: "lens",
        type: "TagDependency",
        classes: [
          "lens_flare"
        ]
      }
    ],
    sizeBytes: 16
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPLensFlareMarker",
    fields: [
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "direction i component",
        type: "int8"
      },
      {
        kind: "field",
        name: "direction j component",
        type: "int8"
      },
      {
        kind: "field",
        name: "direction k component",
        type: "int8"
      },
      {
        kind: "field",
        name: "lens flare index",
        type: "int8"
      }
    ],
    sizeBytes: 16
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPSubclusterSurfaceIndex",
    fields: [
      {
        kind: "field",
        name: "index",
        type: "int32"
      }
    ],
    sizeBytes: 4
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPSubcluster",
    fields: [
      {
        kind: "field",
        name: "world bounds x",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "world bounds y",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "world bounds z",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "surface indices",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPSubclusterSurfaceIndex",
        maximum: 128
      }
    ],
    sizeBytes: 36
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPClusterSurfaceIndex",
    fields: [
      {
        kind: "field",
        name: "index",
        type: "int32"
      }
    ],
    sizeBytes: 4
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPMirrorVertex",
    fields: [
      {
        kind: "field",
        name: "point",
        type: "Point3D"
      }
    ],
    sizeBytes: 12
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPMirror",
    fields: [
      {
        kind: "field",
        name: "plane",
        type: "Plane3D"
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "shader",
        type: "TagDependency",
        classes: [
          "shader"
        ]
      },
      {
        kind: "field",
        name: "vertices",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPMirrorVertex",
        maximum: 512
      }
    ],
    sizeBytes: 64
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPClusterPortalIndex",
    fields: [
      {
        kind: "field",
        name: "portal",
        type: "Index"
      }
    ],
    sizeBytes: 2
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPCluster",
    fields: [
      {
        kind: "field",
        name: "sky",
        type: "Index"
      },
      {
        kind: "field",
        name: "fog",
        type: "Index"
      },
      {
        kind: "field",
        name: "background sound",
        type: "Index"
      },
      {
        kind: "field",
        name: "sound environment",
        type: "Index"
      },
      {
        kind: "field",
        name: "weather",
        type: "Index"
      },
      {
        kind: "field",
        name: "transition structure bsp",
        type: "Index"
      },
      {
        kind: "field",
        name: "first decal index",
        type: "Index",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "decal count",
        type: "uint16",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "predicted resources",
        type: "TagReflexive",
        struct: "PredictedResource",
        maximum: 1024,
        cacheOnly: true
      },
      {
        kind: "field",
        name: "subclusters",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPSubcluster",
        maximum: 4096
      },
      {
        kind: "field",
        name: "first lens flare marker index",
        type: "Index"
      },
      {
        kind: "field",
        name: "lens flare marker count",
        type: "int16"
      },
      {
        kind: "field",
        name: "surface indices",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPClusterSurfaceIndex",
        maximum: 32768
      },
      {
        kind: "field",
        name: "mirrors",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPMirror",
        maximum: 16
      },
      {
        kind: "field",
        name: "portals",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPClusterPortalIndex",
        maximum: 128
      }
    ],
    sizeBytes: 104
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPClusterPortalVertex",
    fields: [
      {
        kind: "field",
        name: "point",
        type: "Point3D"
      }
    ],
    sizeBytes: 12
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPClusterPortal",
    fields: [
      {
        kind: "field",
        name: "front cluster",
        type: "Index"
      },
      {
        kind: "field",
        name: "back cluster",
        type: "Index"
      },
      {
        kind: "field",
        name: "plane index",
        type: "int32"
      },
      {
        kind: "field",
        name: "centroid",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "bounding radius",
        type: "float"
      },
      {
        kind: "field",
        name: "flags",
        type: "ScenarioStructureBSPClusterPortalFlags"
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "vertices",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPClusterPortalVertex",
        maximum: 128
      }
    ],
    sizeBytes: 64
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPBreakableSurface",
    fields: [
      {
        kind: "field",
        name: "centroid",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "radius",
        type: "float"
      },
      {
        kind: "field",
        name: "collision surface index",
        type: "int32"
      },
      {
        kind: "pad",
        size: 28
      }
    ],
    sizeBytes: 48
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPFogPlaneVertex",
    fields: [
      {
        kind: "field",
        name: "point",
        type: "Point3D"
      }
    ],
    sizeBytes: 12
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPFogPlane",
    fields: [
      {
        kind: "field",
        name: "front region",
        type: "Index"
      },
      {
        kind: "field",
        name: "material type",
        type: "MaterialType",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "plane",
        type: "Plane3D"
      },
      {
        kind: "field",
        name: "vertices",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPFogPlaneVertex",
        maximum: 4096
      }
    ],
    sizeBytes: 32
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPFogRegion",
    fields: [
      {
        kind: "pad",
        size: 36
      },
      {
        kind: "field",
        name: "fog",
        type: "Index",
        struct: "ScenarioStructureBSP"
      },
      {
        kind: "field",
        name: "weather palette",
        type: "Index",
        struct: "ScenarioStructureBSP"
      }
    ],
    sizeBytes: 40
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPFogPalette",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "fog",
        type: "TagDependency",
        classes: [
          "fog"
        ]
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "fog scale function",
        type: "TagString"
      },
      {
        kind: "pad",
        size: 52
      }
    ],
    sizeBytes: 136
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPWeatherPalette",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "particle system",
        type: "TagDependency",
        classes: [
          "weather_particle_system"
        ]
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "particle system scale function",
        type: "TagString"
      },
      {
        kind: "pad",
        size: 44
      },
      {
        kind: "field",
        name: "wind",
        type: "TagDependency",
        classes: [
          "wind"
        ]
      },
      {
        kind: "field",
        name: "wind direction",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "wind magnitude",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "wind scale function",
        type: "TagString"
      },
      {
        kind: "pad",
        size: 44
      }
    ],
    sizeBytes: 240
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPWeatherPolyhedronPlane",
    fields: [
      {
        kind: "field",
        name: "plane",
        type: "Plane3D"
      }
    ],
    sizeBytes: 16
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPWeatherPolyhedron",
    fields: [
      {
        kind: "field",
        name: "bounding sphere center",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "bounding sphere radius",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "planes",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPWeatherPolyhedronPlane",
        maximum: 16
      }
    ],
    sizeBytes: 32
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPPathfindingSurface",
    fields: [
      {
        kind: "field",
        name: "data",
        type: "int8"
      }
    ],
    sizeBytes: 1
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPPathfindingEdge",
    fields: [
      {
        kind: "field",
        name: "midpoint",
        type: "int8"
      }
    ],
    sizeBytes: 1
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPBackgroundSoundPalette",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "background sound",
        type: "TagDependency",
        classes: [
          "sound_looping"
        ]
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "scale function",
        type: "TagString"
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    sizeBytes: 116
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPSoundEnvironmentPalette",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "sound environment",
        type: "TagDependency",
        classes: [
          "sound_environment"
        ]
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    sizeBytes: 80
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPMarker",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "rotation",
        type: "Quaternion"
      },
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      }
    ],
    sizeBytes: 60
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPGlobalDetailObjectCell",
    fields: [
      {
        kind: "field",
        name: "cell x",
        type: "int16"
      },
      {
        kind: "field",
        name: "cell y",
        type: "int16"
      },
      {
        kind: "field",
        name: "cell z",
        type: "int16"
      },
      {
        kind: "field",
        name: "offset z",
        type: "int16"
      },
      {
        kind: "field",
        name: "valid layers flags",
        type: "uint32"
      },
      {
        kind: "field",
        name: "start index",
        type: "uint32"
      },
      {
        kind: "field",
        name: "count index",
        type: "uint32"
      },
      {
        kind: "pad",
        size: 12
      }
    ],
    sizeBytes: 32
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPGlobalDetailObject",
    fields: [
      {
        kind: "field",
        name: "position x",
        type: "int8"
      },
      {
        kind: "field",
        name: "position y",
        type: "int8"
      },
      {
        kind: "field",
        name: "position z",
        type: "int8"
      },
      {
        kind: "field",
        name: "data",
        type: "int8"
      },
      {
        kind: "field",
        name: "color",
        type: "int16"
      }
    ],
    sizeBytes: 6
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPGlobalDetailObjectCount",
    fields: [
      {
        kind: "field",
        name: "count",
        type: "uint16"
      }
    ],
    sizeBytes: 2
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPGlobalZReferenceVector",
    fields: [
      {
        kind: "field",
        name: "z reference i",
        type: "float"
      },
      {
        kind: "field",
        name: "z reference j",
        type: "float"
      },
      {
        kind: "field",
        name: "z reference k",
        type: "float"
      },
      {
        kind: "field",
        name: "z reference l",
        type: "float"
      }
    ],
    sizeBytes: 16
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPDetailObjectData",
    fields: [
      {
        kind: "field",
        name: "cells",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPGlobalDetailObjectCell",
        maximum: 262144
      },
      {
        kind: "field",
        name: "instances",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPGlobalDetailObject",
        maximum: 2097152
      },
      {
        kind: "field",
        name: "counts",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPGlobalDetailObjectCount",
        maximum: 8388608
      },
      {
        kind: "field",
        name: "z reference vectors",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPGlobalZReferenceVector",
        maximum: 262144
      },
      {
        kind: "field",
        name: "bullshit",
        type: "uint8",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 3
      },
      {
        kind: "pad",
        size: 12
      }
    ],
    sizeBytes: 64
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPRuntimeDecal",
    fields: [
      {
        kind: "field",
        name: "position",
        type: "Point3D"
      },
      {
        kind: "field",
        name: "decal type",
        type: "Index"
      },
      {
        kind: "field",
        name: "yaw",
        type: "int8"
      },
      {
        kind: "field",
        name: "pitch",
        type: "int8"
      }
    ],
    sizeBytes: 16
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPMapLeafFaceVertex",
    fields: [
      {
        kind: "field",
        name: "vertex",
        type: "Point2D"
      }
    ],
    sizeBytes: 8
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPMapLeafFace",
    fields: [
      {
        kind: "field",
        name: "node index",
        type: "int32"
      },
      {
        kind: "field",
        name: "vertices",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPMapLeafFaceVertex",
        maximum: 64
      }
    ],
    sizeBytes: 16
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPMapLeafPortalIndex",
    fields: [
      {
        kind: "field",
        name: "portal index",
        type: "int32"
      }
    ],
    sizeBytes: 4
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPGlobalMapLeaf",
    fields: [
      {
        kind: "field",
        name: "faces",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPMapLeafFace",
        maximum: 256
      },
      {
        kind: "field",
        name: "portal indices",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPMapLeafPortalIndex",
        maximum: 256
      }
    ],
    sizeBytes: 24
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPLeafPortalVertex",
    fields: [
      {
        kind: "field",
        name: "point",
        type: "Point3D"
      }
    ],
    sizeBytes: 12
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPGlobalLeafPortal",
    fields: [
      {
        kind: "field",
        name: "plane index",
        type: "int32"
      },
      {
        kind: "field",
        name: "back leaf index",
        type: "int32"
      },
      {
        kind: "field",
        name: "front leaf index",
        type: "int32"
      },
      {
        kind: "field",
        name: "vertices",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPLeafPortalVertex",
        maximum: 64
      }
    ],
    sizeBytes: 24
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSP",
    fields: [
      {
        kind: "field",
        name: "lightmaps bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "vehicle floor",
        type: "float"
      },
      {
        kind: "field",
        name: "vehicle ceiling",
        type: "float"
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "default ambient color",
        type: "ColorRGB"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "default distant light 0 color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "default distant light 0 direction",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "default distant light 1 color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "default distant light 1 direction",
        type: "Vector3D"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "default reflection tint",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "default shadow vector",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "default shadow color",
        type: "ColorRGB"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "collision materials",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPCollisionMaterial",
        maximum: 512
      },
      {
        kind: "field",
        name: "collision bsp",
        type: "TagReflexive",
        struct: "ModelCollisionGeometryBSP",
        maximum: 1
      },
      {
        kind: "field",
        name: "nodes",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPNode",
        maximum: 131072
      },
      {
        kind: "field",
        name: "world bounds x",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "world bounds y",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "world bounds z",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "leaves",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPLeaf",
        maximum: 65536
      },
      {
        kind: "field",
        name: "leaf surfaces",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPSurfaceReference",
        maximum: 262144
      },
      {
        kind: "field",
        name: "surfaces",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPSurface",
        maximum: 131072
      },
      {
        kind: "field",
        name: "lightmaps",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPLightmap",
        maximum: 128
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "lens flares",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPLensFlare",
        maximum: 256
      },
      {
        kind: "field",
        name: "lens flare markers",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPLensFlareMarker",
        maximum: 65536
      },
      {
        kind: "field",
        name: "clusters",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPCluster",
        maximum: 8192
      },
      {
        kind: "field",
        name: "cluster data",
        type: "TagDataOffset",
        maximum: 65536
      },
      {
        kind: "field",
        name: "cluster portals",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPClusterPortal",
        maximum: 512
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "breakable surfaces",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPBreakableSurface",
        maximum: 256
      },
      {
        kind: "field",
        name: "fog planes",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPFogPlane",
        maximum: 32
      },
      {
        kind: "field",
        name: "fog regions",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPFogRegion",
        maximum: 32
      },
      {
        kind: "field",
        name: "fog palette",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPFogPalette",
        maximum: 32
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "weather palette",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPWeatherPalette",
        maximum: 32
      },
      {
        kind: "field",
        name: "weather polyhedra",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPWeatherPolyhedron",
        maximum: 32
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "pathfinding surfaces",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPPathfindingSurface",
        maximum: 131072
      },
      {
        kind: "field",
        name: "pathfinding edges",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPPathfindingEdge",
        maximum: 262144
      },
      {
        kind: "field",
        name: "background sound palette",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPBackgroundSoundPalette",
        maximum: 64
      },
      {
        kind: "field",
        name: "sound environment palette",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPSoundEnvironmentPalette",
        maximum: 64
      },
      {
        kind: "field",
        name: "sound pas data",
        type: "TagDataOffset",
        maximum: 131072
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "markers",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPMarker",
        maximum: 1024
      },
      {
        kind: "field",
        name: "detail objects",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPDetailObjectData",
        maximum: 1
      },
      {
        kind: "field",
        name: "runtime decals",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPRuntimeDecal",
        maximum: 6144,
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "leaf map leaves",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPGlobalMapLeaf",
        maximum: 65536,
        nonCached: true
      },
      {
        kind: "field",
        name: "leaf map portals",
        type: "TagReflexive",
        struct: "ScenarioStructureBSPGlobalLeafPortal",
        maximum: 524288,
        nonCached: true
      }
    ],
    tagClass: "scenario_structure_bsp",
    extractable: false,
    notExtractableReason: `scenario_structure_bsp tags live in a separate memory region addressed via the owning Scenario's BSP location info (bsp_start/bsp_address, see SOURCES.md "Key finding"), not yet carried into the extractor's relocatable container format.`,
    sizeBytes: 648
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPCompiledHeader",
    fields: [
      {
        kind: "field",
        name: "pointer",
        type: "Pointer",
        cacheOnly: true,
        comment: "points to the BSP tag struct"
      },
      {
        kind: "field",
        name: "lightmap material count",
        type: "uint32",
        cacheOnly: true,
        comment: "(Xbox only): number of lightmap materials"
      },
      {
        kind: "field",
        name: "rendered vertices",
        type: "Pointer",
        cacheOnly: true,
        comment: "(Xbox only): pointer to array of rendered vertices"
      },
      {
        kind: "field",
        name: "lightmap material count again",
        type: "uint32",
        cacheOnly: true,
        comment: "(Xbox only): number of lightmap materials (again)"
      },
      {
        kind: "field",
        name: "lightmap vertices",
        type: "Pointer",
        cacheOnly: true,
        comment: "(Xbox only): pointer to array of lightmap vertices"
      },
      {
        kind: "field",
        name: "signature",
        type: "TagFourCC",
        cacheOnly: true
      }
    ],
    sizeBytes: 24
  },
  {
    kind: "struct",
    name: "ScenarioStructureBSPCompiledHeaderCEA",
    fields: [
      {
        kind: "field",
        name: "pointer",
        type: "Pointer",
        cacheOnly: true,
        comment: "points to the BSP tag struct"
      },
      {
        kind: "field",
        name: "lightmap vertex size",
        type: "uint32",
        cacheOnly: true,
        comment: "(CEA only): size of vertex data"
      },
      {
        kind: "field",
        name: "lightmap vertices",
        type: "uint32",
        cacheOnly: true,
        comment: "(CEA only): file offset to vertex data"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "signature",
        type: "TagFourCC",
        cacheOnly: true
      }
    ],
    sizeBytes: 24
  }
];

// ../core/src/map/definitions/groups/scenery.json
var scenery_default = [
  {
    kind: "struct",
    name: "Scenery",
    fields: [],
    inherits: "BasicObject",
    tagClass: "scenery",
    sizeBytes: 508
  }
];

// ../core/src/map/definitions/groups/shader.json
var shader_default = [
  {
    kind: "enum",
    name: "ShaderDetailLevel",
    options: [
      "high",
      "medium",
      "low",
      "turd"
    ]
  },
  {
    kind: "enum",
    name: "ShaderColorFunctionType",
    options: [
      "current",
      "next map",
      "multiply",
      "double multiply",
      "add",
      "add signed current",
      "add signed next map",
      "subtract current",
      "subtract next map",
      "blend current alpha",
      "blend current alpha inverse",
      "blend next map alpha",
      "blend next map alpha inverse"
    ]
  },
  {
    kind: "enum",
    name: "ShaderFirstMapType",
    options: [
      "2d map",
      "first map is reflection cube map",
      "first map is object centered cube map",
      "first map is viewer centered cube map"
    ]
  },
  {
    kind: "enum",
    name: "ShaderType",
    options: [
      "screen",
      "effect",
      "decal",
      "environment",
      "model",
      "transparent generic",
      "transparent chicago",
      "transparent chicago extended",
      "transparent water",
      "transparent glass",
      "transparent meter",
      "transparent plasma"
    ]
  },
  {
    kind: "enum",
    name: "ShaderDetailFunction",
    options: [
      "double biased multiply",
      "multiply",
      "double biased add"
    ]
  },
  {
    kind: "bitfield",
    name: "ShaderFlags",
    width: 16,
    fields: [
      "simple parameterization",
      "ignore normals",
      "transparent lit"
    ]
  },
  {
    kind: "bitfield",
    name: "ShaderPhysicsFlags",
    width: 16,
    fields: [
      "unused"
    ]
  },
  {
    kind: "struct",
    name: "ShaderTransparentExtraLayer",
    fields: [
      {
        kind: "field",
        name: "shader",
        type: "TagDependency",
        classes: [
          "shader"
        ]
      }
    ],
    sizeBytes: 16
  },
  {
    kind: "struct",
    name: "Shader",
    fields: [
      {
        kind: "field",
        name: "shader flags",
        type: "ShaderFlags"
      },
      {
        kind: "field",
        name: "detail level",
        type: "ShaderDetailLevel"
      },
      {
        kind: "field",
        name: "power",
        type: "float"
      },
      {
        kind: "field",
        name: "color of emitted light",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "tint color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "physics flags",
        type: "ShaderPhysicsFlags"
      },
      {
        kind: "field",
        name: "material type",
        type: "MaterialType"
      },
      {
        kind: "field",
        name: "shader type",
        type: "uint16"
      },
      {
        kind: "pad",
        size: 2
      }
    ],
    tagClass: "shader",
    sizeBytes: 40
  }
];

// ../core/src/map/definitions/groups/shader_environment.json
var shader_environment_default = [
  {
    kind: "enum",
    name: "ShaderEnvironmentType",
    options: [
      "normal",
      "blended",
      "blended base specular"
    ]
  },
  {
    kind: "enum",
    name: "ShaderEnvironmentReflectionType",
    options: [
      "bumped cube map",
      "flat cube map",
      "bumped radiosity"
    ]
  },
  {
    kind: "bitfield",
    name: "ShaderEnvironmentFlags",
    width: 16,
    fields: [
      "alpha tested",
      "bump map is specular mask",
      "true atmospheric fog",
      "use alternate bump attenuation",
      "use alternate normal type blending"
    ]
  },
  {
    kind: "bitfield",
    name: "ShaderEnvironmentDiffuseFlags",
    width: 16,
    fields: [
      "rescale detail maps",
      "rescale bump map"
    ]
  },
  {
    kind: "bitfield",
    name: "ShaderEnvironmentSpecularFlags",
    width: 16,
    fields: [
      "overbright",
      "extra shiny",
      "lightmap is specular"
    ]
  },
  {
    kind: "bitfield",
    name: "ShaderEnvironmentReflectionFlags",
    width: 16,
    fields: [
      "dynamic mirror"
    ]
  },
  {
    kind: "struct",
    name: "ShaderEnvironment",
    fields: [
      {
        kind: "field",
        name: "shader environment flags",
        type: "ShaderEnvironmentFlags"
      },
      {
        kind: "field",
        name: "shader environment type",
        type: "ShaderEnvironmentType"
      },
      {
        kind: "field",
        name: "lens flare spacing",
        type: "float"
      },
      {
        kind: "field",
        name: "lens flare",
        type: "TagDependency",
        classes: [
          "lens_flare"
        ]
      },
      {
        kind: "pad",
        size: 44
      },
      {
        kind: "field",
        name: "diffuse flags",
        type: "ShaderEnvironmentDiffuseFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "base map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "detail map function",
        type: "ShaderDetailFunction"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "primary detail map scale",
        type: "float"
      },
      {
        kind: "field",
        name: "primary detail map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "secondary detail map scale",
        type: "float"
      },
      {
        kind: "field",
        name: "secondary detail map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "micro detail map function",
        type: "ShaderDetailFunction"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "micro detail map scale",
        type: "float"
      },
      {
        kind: "field",
        name: "micro detail map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "material color",
        type: "ColorRGB"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "bump map scale",
        type: "float"
      },
      {
        kind: "field",
        name: "bump map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "bump map scale xy",
        type: "Point2D",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "u animation function",
        type: "WaveFunction"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "u animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "u animation scale",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation function",
        type: "WaveFunction"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "v animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation scale",
        type: "float"
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "self illumination flags",
        type: "IsUnfilteredFlag"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "primary on color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "primary off color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "primary animation function",
        type: "WaveFunction"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "primary animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "primary animation phase",
        type: "float"
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "secondary on color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "secondary off color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "secondary animation function",
        type: "WaveFunction"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "secondary animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "secondary animation phase",
        type: "float"
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "plasma on color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "plasma off color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "plasma animation function",
        type: "WaveFunction"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "plasma animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "plasma animation phase",
        type: "float"
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "map scale",
        type: "float"
      },
      {
        kind: "field",
        name: "map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "specular flags",
        type: "ShaderEnvironmentSpecularFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "brightness",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "perpendicular color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "parallel color",
        type: "ColorRGB"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "reflection flags",
        type: "ShaderEnvironmentReflectionFlags"
      },
      {
        kind: "field",
        name: "reflection type",
        type: "ShaderEnvironmentReflectionType"
      },
      {
        kind: "field",
        name: "lightmap brightness scale",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "pad",
        size: 28
      },
      {
        kind: "field",
        name: "perpendicular brightness",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "parallel brightness",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "reflection cube map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 16
      }
    ],
    inherits: "Shader",
    tagClass: "shader_environment",
    sizeBytes: 836
  }
];

// ../core/src/map/definitions/groups/shader_model.json
var shader_model_default = [
  {
    kind: "enum",
    name: "ShaderModelDetailMask",
    options: [
      "none",
      "reflection mask inverse",
      "reflection mask",
      "self illumination mask inverse",
      "self illumination mask",
      "change color mask inverse",
      "change color mask",
      "auxiliary mask inverse",
      "auxiliary mask"
    ]
  },
  {
    kind: "bitfield",
    name: "ShaderModelFlags",
    width: 16,
    fields: [
      "detail after reflection",
      "two sided",
      "not alpha tested",
      "alpha blended decal",
      "true atmospheric fog",
      "disable two sided culling",
      "use xbox multipurpose channel order"
    ]
  },
  {
    kind: "bitfield",
    name: "ShaderModelMoreFlags",
    width: 16,
    fields: [
      "no random phase"
    ]
  },
  {
    kind: "struct",
    name: "ShaderModel",
    fields: [
      {
        kind: "field",
        name: "shader model flags",
        type: "ShaderModelFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "translucency",
        type: "Fraction"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "change color source",
        type: "FunctionNameNullable"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 28
      },
      {
        kind: "field",
        name: "shader model more flags",
        type: "ShaderModelMoreFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "color source",
        type: "FunctionNameNullable"
      },
      {
        kind: "field",
        name: "animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "animation color lower bound",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "animation color upper bound",
        type: "ColorRGB"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "map u scale",
        type: "float"
      },
      {
        kind: "field",
        name: "map v scale",
        type: "float"
      },
      {
        kind: "field",
        name: "base map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "multipurpose map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "detail function",
        type: "ShaderDetailFunction"
      },
      {
        kind: "field",
        name: "detail mask",
        type: "ShaderModelDetailMask"
      },
      {
        kind: "field",
        name: "detail map scale",
        type: "float"
      },
      {
        kind: "field",
        name: "detail map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "detail map v scale",
        type: "float"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "u animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "u animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "u animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "u animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "u animation scale",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "v animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "v animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation scale",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "rotation animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "rotation animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation scale",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation center",
        type: "Point2D"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "reflection falloff distance",
        type: "float"
      },
      {
        kind: "field",
        name: "reflection cutoff distance",
        type: "float"
      },
      {
        kind: "field",
        name: "perpendicular brightness",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "perpendicular tint color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "parallel brightness",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "parallel tint color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "reflection cube map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "unknown",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    inherits: "Shader",
    tagClass: "shader_model",
    sizeBytes: 440
  }
];

// ../core/src/map/definitions/groups/shader_transparent_chicago.json
var shader_transparent_chicago_default = [
  {
    kind: "bitfield",
    name: "ShaderTransparentChicagoMapFlags",
    width: 16,
    fields: [
      "unfiltered",
      "alpha replicate",
      "u clamped",
      "v clamped"
    ]
  },
  {
    kind: "bitfield",
    name: "ShaderTransparentChicagoExtraFlags",
    width: 32,
    fields: [
      "don't fade active camouflage",
      "numeric countdown timer",
      "custom edition blending"
    ]
  },
  {
    kind: "struct",
    name: "ShaderTransparentChicagoMap",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "ShaderTransparentChicagoMapFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 40
      },
      {
        kind: "field",
        name: "color function",
        type: "ShaderColorFunctionType"
      },
      {
        kind: "field",
        name: "alpha function",
        type: "ShaderColorFunctionType"
      },
      {
        kind: "pad",
        size: 36
      },
      {
        kind: "field",
        name: "map u scale",
        type: "float"
      },
      {
        kind: "field",
        name: "map v scale",
        type: "float"
      },
      {
        kind: "field",
        name: "map u offset",
        type: "float"
      },
      {
        kind: "field",
        name: "map v offset",
        type: "float"
      },
      {
        kind: "field",
        name: "map rotation",
        type: "float"
      },
      {
        kind: "field",
        name: "mipmap bias",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 40
      },
      {
        kind: "field",
        name: "u animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "u animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "u animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "u animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "u animation scale",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "v animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "v animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation scale",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "rotation animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "rotation animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation scale",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation center",
        type: "Point2D"
      }
    ],
    sizeBytes: 220
  },
  {
    kind: "struct",
    name: "ShaderTransparentChicago",
    fields: [
      {
        kind: "field",
        name: "numeric counter limit",
        type: "uint8"
      },
      {
        kind: "field",
        name: "shader transparent chicago flags",
        type: "ShaderTransparentGenericFlags"
      },
      {
        kind: "field",
        name: "first map type",
        type: "ShaderFirstMapType"
      },
      {
        kind: "field",
        name: "framebuffer blend function",
        type: "FramebufferBlendFunction"
      },
      {
        kind: "field",
        name: "framebuffer fade mode",
        type: "FramebufferFadeMode"
      },
      {
        kind: "field",
        name: "framebuffer fade source",
        type: "FunctionOut"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "lens flare spacing",
        type: "float"
      },
      {
        kind: "field",
        name: "lens flare",
        type: "TagDependency",
        classes: [
          "lens_flare"
        ]
      },
      {
        kind: "field",
        name: "extra layers",
        type: "TagReflexive",
        struct: "ShaderTransparentExtraLayer",
        maximum: 4
      },
      {
        kind: "field",
        name: "maps",
        type: "TagReflexive",
        struct: "ShaderTransparentChicagoMap",
        maximum: 4
      },
      {
        kind: "field",
        name: "extra flags",
        type: "ShaderTransparentChicagoExtraFlags"
      },
      {
        kind: "pad",
        size: 8
      }
    ],
    inherits: "Shader",
    tagClass: "shader_transparent_chicago",
    sizeBytes: 108
  }
];

// ../core/src/map/definitions/groups/shader_transparent_chicago_extended.json
var shader_transparent_chicago_extended_default = [
  {
    kind: "struct",
    name: "ShaderTransparentChicagoExtended",
    fields: [
      {
        kind: "field",
        name: "numeric counter limit",
        type: "uint8"
      },
      {
        kind: "field",
        name: "shader transparent chicago extended flags",
        type: "ShaderTransparentGenericFlags"
      },
      {
        kind: "field",
        name: "first map type",
        type: "ShaderFirstMapType"
      },
      {
        kind: "field",
        name: "framebuffer blend function",
        type: "FramebufferBlendFunction"
      },
      {
        kind: "field",
        name: "framebuffer fade mode",
        type: "FramebufferFadeMode"
      },
      {
        kind: "field",
        name: "framebuffer fade source",
        type: "FunctionOut"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "lens flare spacing",
        type: "float"
      },
      {
        kind: "field",
        name: "lens flare",
        type: "TagDependency",
        classes: [
          "lens_flare"
        ]
      },
      {
        kind: "field",
        name: "extra layers",
        type: "TagReflexive",
        struct: "ShaderTransparentExtraLayer",
        maximum: 4
      },
      {
        kind: "field",
        name: "maps 4 stage",
        type: "TagReflexive",
        struct: "ShaderTransparentChicagoMap",
        maximum: 4
      },
      {
        kind: "field",
        name: "maps 2 stage",
        type: "TagReflexive",
        struct: "ShaderTransparentChicagoMap",
        maximum: 2,
        comment: "The original definitions have these set to 4, but issues occur when you do this as these are 2-stage maps, not 4-stage maps!\nUse the 4 stage maps (or just shader_transparent_chicago) for 4-stage maps."
      },
      {
        kind: "field",
        name: "extra flags",
        type: "ShaderTransparentChicagoExtraFlags"
      },
      {
        kind: "pad",
        size: 8
      }
    ],
    inherits: "Shader",
    tagClass: "shader_transparent_chicago_extended",
    sizeBytes: 120
  }
];

// ../core/src/map/definitions/groups/shader_transparent_generic.json
var shader_transparent_generic_default = [
  {
    kind: "enum",
    name: "ShaderTransparentGenericStageInputColor",
    options: [
      "zero",
      "one",
      "one half",
      "negative one",
      "negative one half",
      "map color 0",
      "map color 1",
      "map color 2",
      "map color 3",
      "vertex color 0 diffuse light",
      "vertex color 1 fade perpendicular",
      "scratch color 0",
      "scratch color 1",
      "constant color 0",
      "constant color 1",
      "map alpha 0",
      "map alpha 1",
      "map alpha 2",
      "map alpha 3",
      "vertex alpha 0 fade none",
      "vertex alpha 1 fade perpendicular",
      "scratch alpha 0",
      "scratch alpha 1",
      "constant alpha 0",
      "constant alpha 1"
    ]
  },
  {
    kind: "enum",
    name: "ShaderTransparentGenericStageInputAlpha",
    options: [
      "zero",
      "one",
      "one half",
      "negative one",
      "negative one half",
      "map alpha 0",
      "map alpha 1",
      "map alpha 2",
      "map alpha 3",
      "vertex alpha 0 fade none",
      "vertex alpha 1 fade perpendicular",
      "scratch alpha 0",
      "scratch alpha 1",
      "constant alpha 0",
      "constant alpha 1",
      "map blue 0",
      "map blue 1",
      "map blue 2",
      "map blue 3",
      "vertex blue 0 blue light",
      "vertex blue 1 fade parallel",
      "scratch blue 0",
      "scratch blue 1",
      "constant blue 0",
      "constant blue 1"
    ]
  },
  {
    kind: "enum",
    name: "ShaderTransparentGenericStageInputMappingColor",
    options: [
      "clamp x",
      "1 clamp x",
      "2",
      "1 2",
      "clamp x 1 2",
      "1 2 clamp x",
      "x",
      "x 1"
    ]
  },
  {
    kind: "enum",
    name: "ShaderTransparentGenericStageOutputFunction",
    options: [
      "multiply",
      "dot product"
    ]
  },
  {
    kind: "enum",
    name: "ShaderTransparentGenericStageOutputMapping",
    options: [
      "color identity",
      "color scale by 1 2",
      "color scale by 2",
      "color scale by 4",
      "color bias by 1 2",
      "color expand normal"
    ]
  },
  {
    kind: "enum",
    name: "ShaderTransparentGenericStageOutput",
    options: [
      "alpha discard",
      "alpha scratch alpha 0 final alpha",
      "alpha scratch alpha 1",
      "alpha vertex alpha 0 fog",
      "alpha vertex alpha 1",
      "alpha map alpha 0",
      "alpha map alpha 1",
      "alpha map alpha 2",
      "alpha map alpha 3"
    ]
  },
  {
    kind: "bitfield",
    name: "ShaderTransparentGenericMapFlag",
    width: 16,
    fields: [
      "unfiltered",
      "u clamped",
      "v clamped"
    ]
  },
  {
    kind: "bitfield",
    name: "ShaderTransparentGenericStageFlags",
    width: 16,
    fields: [
      "color mux",
      "alpha mux",
      "a out controls color0 animation"
    ]
  },
  {
    kind: "bitfield",
    name: "ShaderTransparentGenericFlags",
    width: 8,
    fields: [
      "alpha tested",
      "decal",
      "two sided",
      "first map is in screenspace",
      "draw before water",
      "ignore effect",
      "scale first map with distance",
      "numeric"
    ]
  },
  {
    kind: "struct",
    name: "ShaderTransparentGenericMap",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "ShaderTransparentGenericMapFlag"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "map u scale",
        type: "float"
      },
      {
        kind: "field",
        name: "map v scale",
        type: "float"
      },
      {
        kind: "field",
        name: "map u offset",
        type: "float"
      },
      {
        kind: "field",
        name: "map v offset",
        type: "float"
      },
      {
        kind: "field",
        name: "map rotation",
        type: "float"
      },
      {
        kind: "field",
        name: "mipmap bias",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "u animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "u animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "u animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "u animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "u animation scale",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "v animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "v animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation scale",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "rotation animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "rotation animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation scale",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation center",
        type: "Point2D"
      }
    ],
    sizeBytes: 100
  },
  {
    kind: "struct",
    name: "ShaderTransparentGenericStage",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "ShaderTransparentGenericStageFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "color0 source",
        type: "FunctionNameNullable"
      },
      {
        kind: "field",
        name: "color0 animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "color0 animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "color0 animation lower bound",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "color0 animation upper bound",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "color1",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "input a",
        type: "ShaderTransparentGenericStageInputColor"
      },
      {
        kind: "field",
        name: "input a mapping",
        type: "ShaderTransparentGenericStageInputMappingColor"
      },
      {
        kind: "field",
        name: "input b",
        type: "ShaderTransparentGenericStageInputColor"
      },
      {
        kind: "field",
        name: "input b mapping",
        type: "ShaderTransparentGenericStageInputMappingColor"
      },
      {
        kind: "field",
        name: "input c",
        type: "ShaderTransparentGenericStageInputColor"
      },
      {
        kind: "field",
        name: "input c mapping",
        type: "ShaderTransparentGenericStageInputMappingColor"
      },
      {
        kind: "field",
        name: "input d",
        type: "ShaderTransparentGenericStageInputColor"
      },
      {
        kind: "field",
        name: "input d mapping",
        type: "ShaderTransparentGenericStageInputMappingColor"
      },
      {
        kind: "field",
        name: "output ab",
        type: "ShaderTransparentGenericStageOutput"
      },
      {
        kind: "field",
        name: "output ab function",
        type: "ShaderTransparentGenericStageOutputFunction"
      },
      {
        kind: "field",
        name: "output bc",
        type: "ShaderTransparentGenericStageOutput"
      },
      {
        kind: "field",
        name: "output cd function",
        type: "ShaderTransparentGenericStageOutputFunction"
      },
      {
        kind: "field",
        name: "output ab cd mux sum",
        type: "ShaderTransparentGenericStageOutput"
      },
      {
        kind: "field",
        name: "output mapping color",
        type: "ShaderTransparentGenericStageOutputMapping"
      },
      {
        kind: "field",
        name: "input a alpha",
        type: "ShaderTransparentGenericStageInputAlpha"
      },
      {
        kind: "field",
        name: "input a mapping alpha",
        type: "ShaderTransparentGenericStageInputMappingColor"
      },
      {
        kind: "field",
        name: "input b alpha",
        type: "ShaderTransparentGenericStageInputAlpha"
      },
      {
        kind: "field",
        name: "input b mapping alpha",
        type: "ShaderTransparentGenericStageInputMappingColor"
      },
      {
        kind: "field",
        name: "input c alpha",
        type: "ShaderTransparentGenericStageInputAlpha"
      },
      {
        kind: "field",
        name: "input c mapping alpha",
        type: "ShaderTransparentGenericStageInputMappingColor"
      },
      {
        kind: "field",
        name: "input d alpha",
        type: "ShaderTransparentGenericStageInputAlpha"
      },
      {
        kind: "field",
        name: "input d mapping alpha",
        type: "ShaderTransparentGenericStageInputMappingColor"
      },
      {
        kind: "field",
        name: "output ab alpha",
        type: "ShaderTransparentGenericStageOutput"
      },
      {
        kind: "field",
        name: "output cd alpha",
        type: "ShaderTransparentGenericStageOutput"
      },
      {
        kind: "field",
        name: "output ab cd mux sum alpha",
        type: "ShaderTransparentGenericStageOutput"
      },
      {
        kind: "field",
        name: "output mapping alpha",
        type: "ShaderTransparentGenericStageOutputMapping"
      }
    ],
    sizeBytes: 112
  },
  {
    kind: "struct",
    name: "ShaderTransparentGeneric",
    fields: [
      {
        kind: "field",
        name: "numeric counter limit",
        type: "uint8"
      },
      {
        kind: "field",
        name: "shader transparent generic flags",
        type: "ShaderTransparentGenericFlags"
      },
      {
        kind: "field",
        name: "first map type",
        type: "ShaderFirstMapType"
      },
      {
        kind: "field",
        name: "framebuffer blend function",
        type: "FramebufferBlendFunction"
      },
      {
        kind: "field",
        name: "framebuffer fade mode",
        type: "FramebufferFadeMode"
      },
      {
        kind: "field",
        name: "framebuffer fade source",
        type: "FunctionOut"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "lens flare spacing",
        type: "float"
      },
      {
        kind: "field",
        name: "lens flare",
        type: "TagDependency",
        classes: [
          "lens_flare"
        ]
      },
      {
        kind: "field",
        name: "extra layers",
        type: "TagReflexive",
        struct: "ShaderTransparentExtraLayer",
        maximum: 4
      },
      {
        kind: "field",
        name: "maps",
        type: "TagReflexive",
        struct: "ShaderTransparentGenericMap",
        maximum: 4
      },
      {
        kind: "field",
        name: "stages",
        type: "TagReflexive",
        struct: "ShaderTransparentGenericStage",
        maximum: 7
      }
    ],
    inherits: "Shader",
    tagClass: "shader_transparent_generic",
    sizeBytes: 108
  }
];

// ../core/src/map/definitions/groups/shader_transparent_glass.json
var shader_transparent_glass_default = [
  {
    kind: "enum",
    name: "ShaderTransparentGlassReflectionType",
    options: [
      "bumped cube map",
      "flat cube map",
      "dynamic mirror"
    ]
  },
  {
    kind: "bitfield",
    name: "ShaderTransparentGlassFlags",
    width: 16,
    fields: [
      "alpha tested",
      "decal",
      "two sided",
      "bump map is specular mask"
    ]
  },
  {
    kind: "struct",
    name: "ShaderTransparentGlass",
    fields: [
      {
        kind: "field",
        name: "shader transparent glass flags",
        type: "ShaderTransparentGlassFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 40
      },
      {
        kind: "field",
        name: "background tint color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "background tint map scale",
        type: "float"
      },
      {
        kind: "field",
        name: "background tint map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "reflection type",
        type: "ShaderTransparentGlassReflectionType"
      },
      {
        kind: "field",
        name: "perpendicular brightness",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "perpendicular tint color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "parallel brightness",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "parallel tint color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "reflection map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "bump map scale",
        type: "float"
      },
      {
        kind: "field",
        name: "bump map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 128
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "diffuse map scale",
        type: "float"
      },
      {
        kind: "field",
        name: "diffuse map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "diffuse detail map scale",
        type: "float"
      },
      {
        kind: "field",
        name: "diffuse detail map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 28
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "specular map scale",
        type: "float"
      },
      {
        kind: "field",
        name: "specular map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "specular detail map scale",
        type: "float"
      },
      {
        kind: "field",
        name: "specular detail map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 28
      }
    ],
    inherits: "Shader",
    tagClass: "shader_transparent_glass",
    sizeBytes: 480
  }
];

// ../core/src/map/definitions/groups/shader_transparent_meter.json
var shader_transparent_meter_default = [
  {
    kind: "bitfield",
    name: "ShaderTransparentMeterFlags",
    width: 16,
    fields: [
      "decal",
      "two sided",
      "flash color is negative",
      "tint mode 2",
      "unfiltered"
    ]
  },
  {
    kind: "struct",
    name: "ShaderTransparentMeter",
    fields: [
      {
        kind: "field",
        name: "meter flags",
        type: "ShaderTransparentMeterFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "gradient min color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "gradient max color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "background color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "flash color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "meter tint color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "meter transparency",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "background transparency",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "meter brightness source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "flash brightness source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "value source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "gradient source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "flash extension source",
        type: "FunctionOut"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    inherits: "Shader",
    tagClass: "shader_transparent_meter",
    sizeBytes: 260
  }
];

// ../core/src/map/definitions/groups/shader_transparent_plasma.json
var shader_transparent_plasma_default = [
  {
    kind: "struct",
    name: "ShaderTransparentPlasma",
    fields: [
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "intensity source",
        type: "FunctionOut"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "intensity exponent",
        type: "float"
      },
      {
        kind: "field",
        name: "offset source",
        type: "FunctionOut"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "offset amount",
        type: "float"
      },
      {
        kind: "field",
        name: "offset exponent",
        type: "float"
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "perpendicular brightness",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "perpendicular tint color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "parallel brightness",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "parallel tint color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "tint color source",
        type: "FunctionNameNullable"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "primary animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "primary animation direction",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "primary noise map scale",
        type: "float"
      },
      {
        kind: "field",
        name: "primary noise map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "secondary animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "secondary animation direction",
        type: "Vector3D"
      },
      {
        kind: "field",
        name: "secondary noise map scale",
        type: "float"
      },
      {
        kind: "field",
        name: "secondary noise map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    inherits: "Shader",
    tagClass: "shader_transparent_plasma",
    sizeBytes: 332
  }
];

// ../core/src/map/definitions/groups/shader_transparent_water.json
var shader_transparent_water_default = [
  {
    kind: "bitfield",
    name: "ShaderTransparentWaterFlags",
    width: 16,
    fields: [
      "base map alpha modulates reflection",
      "base map color modulates background",
      "atmospheric fog",
      "draw before fog"
    ]
  },
  {
    kind: "struct",
    name: "ShaderTransparentWaterRipple",
    fields: [
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "contribution factor",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "animation angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "animation velocity",
        type: "float"
      },
      {
        kind: "field",
        name: "map offset",
        type: "Vector2D"
      },
      {
        kind: "field",
        name: "map repeats",
        type: "uint16"
      },
      {
        kind: "field",
        name: "map index",
        type: "Index"
      },
      {
        kind: "pad",
        size: 16
      }
    ],
    sizeBytes: 76
  },
  {
    kind: "struct",
    name: "ShaderTransparentWater",
    fields: [
      {
        kind: "field",
        name: "water flags",
        type: "ShaderTransparentWaterFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "base map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "view perpendicular brightness",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "view perpendicular tint color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "view parallel brightness",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "view parallel tint color",
        type: "ColorRGB"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "reflection map",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "ripple animation angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "ripple animation velocity",
        type: "float"
      },
      {
        kind: "field",
        name: "ripple scale",
        type: "float"
      },
      {
        kind: "field",
        name: "ripple maps",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "ripple mipmap levels",
        type: "uint16"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "ripple mipmap fade factor",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "ripple mipmap detail bias",
        type: "float"
      },
      {
        kind: "pad",
        size: 64
      },
      {
        kind: "field",
        name: "ripples",
        type: "TagReflexive",
        struct: "ShaderTransparentWaterRipple",
        maximum: 4
      },
      {
        kind: "pad",
        size: 16
      }
    ],
    inherits: "Shader",
    tagClass: "shader_transparent_water",
    sizeBytes: 320
  }
];

// ../core/src/map/definitions/groups/sky.json
var sky_default = [
  {
    kind: "bitfield",
    name: "SkyLightFlags",
    width: 32,
    fields: [
      "affects exteriors",
      "affects interiors"
    ]
  },
  {
    kind: "struct",
    name: "SkyFunction",
    fields: [
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "function name",
        type: "TagString"
      }
    ],
    sizeBytes: 36
  },
  {
    kind: "struct",
    name: "SkyAnimation",
    fields: [
      {
        kind: "field",
        name: "animation index",
        type: "int16"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "period",
        type: "float"
      },
      {
        kind: "pad",
        size: 28
      }
    ],
    sizeBytes: 36
  },
  {
    kind: "struct",
    name: "SkyLight",
    fields: [
      {
        kind: "field",
        name: "lens flare",
        type: "TagDependency",
        classes: [
          "lens_flare"
        ]
      },
      {
        kind: "field",
        name: "lens flare marker name",
        type: "TagString"
      },
      {
        kind: "pad",
        size: 28
      },
      {
        kind: "field",
        name: "flags",
        type: "SkyLightFlags"
      },
      {
        kind: "field",
        name: "color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "power",
        type: "float"
      },
      {
        kind: "field",
        name: "test distance",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "direction",
        type: "Euler2D"
      },
      {
        kind: "field",
        name: "diameter",
        type: "float"
      }
    ],
    sizeBytes: 116
  },
  {
    kind: "struct",
    name: "Sky",
    fields: [
      {
        kind: "field",
        name: "model",
        type: "TagDependency",
        classes: [
          "model"
        ]
      },
      {
        kind: "field",
        name: "animation graph",
        type: "TagDependency",
        classes: [
          "model_animations"
        ]
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "indoor ambient radiosity color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "indoor ambient radiosity power",
        type: "float"
      },
      {
        kind: "field",
        name: "outdoor ambient radiosity color",
        type: "ColorRGB"
      },
      {
        kind: "field",
        name: "outdoor ambient radiosity power",
        type: "float"
      },
      {
        kind: "field",
        name: "outdoor fog color",
        type: "ColorRGB"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "outdoor fog maximum density",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "outdoor fog start distance",
        type: "float"
      },
      {
        kind: "field",
        name: "outdoor fog opaque distance",
        type: "float"
      },
      {
        kind: "field",
        name: "indoor fog color",
        type: "ColorRGB"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "indoor fog maximum density",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "indoor fog start distance",
        type: "float"
      },
      {
        kind: "field",
        name: "indoor fog opaque distance",
        type: "float"
      },
      {
        kind: "field",
        name: "indoor fog screen",
        type: "TagDependency",
        classes: [
          "fog"
        ]
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "shader functions",
        type: "TagReflexive",
        struct: "SkyFunction",
        maximum: 8
      },
      {
        kind: "field",
        name: "animations",
        type: "TagReflexive",
        struct: "SkyAnimation",
        maximum: 8
      },
      {
        kind: "field",
        name: "lights",
        type: "TagReflexive",
        struct: "SkyLight",
        maximum: 8
      }
    ],
    tagClass: "sky",
    sizeBytes: 208
  }
];

// ../core/src/map/definitions/groups/sound.json
var sound_default = [
  {
    kind: "enum",
    name: "SoundFormat",
    options: [
      "16-bit pcm",
      "xbox adpcm",
      "ima adpcm",
      "ogg vorbis"
    ]
  },
  {
    kind: "enum",
    name: "SoundClass",
    options: [
      "projectile impact",
      "projectile detonation",
      "unused",
      "unused1",
      "weapon fire",
      "weapon ready",
      "weapon reload",
      "weapon empty",
      "weapon charge",
      "weapon overheat",
      "weapon idle",
      "unused2",
      "unused3",
      "object impacts",
      "particle impacts",
      "slow particle impacts",
      "unused4",
      "unused5",
      "unit footsteps",
      "unit dialog",
      "unused6",
      "unused7",
      "vehicle collision",
      "vehicle engine",
      "unused8",
      "unused9",
      "device door",
      "device force field",
      "device machinery",
      "device nature",
      "device computers",
      "unused10",
      "music",
      "ambient nature",
      "ambient machinery",
      "ambient computers",
      "unused11",
      "unused12",
      "unused13",
      "first person damage",
      "unused14",
      "unused15",
      "unused16",
      "unused17",
      "scripted dialog player",
      "scripted effect",
      "scripted dialog other",
      "scripted dialog force unspatialized",
      "unused18",
      "unused19",
      "game event"
    ]
  },
  {
    kind: "enum",
    name: "SoundSampleRate",
    options: [
      "22050 Hz",
      "44100 Hz"
    ]
  },
  {
    kind: "enum",
    name: "SoundChannelCount",
    options: [
      "mono",
      "stereo"
    ]
  },
  {
    kind: "bitfield",
    name: "SoundFlags",
    width: 32,
    fields: [
      "fit to adpcm blocksize",
      "split long sound into permutations",
      "thirsty grunt"
    ]
  },
  {
    kind: "struct",
    name: "SoundPermutation",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "skip fraction",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "gain",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "format",
        type: "SoundFormat"
      },
      {
        kind: "field",
        name: "next permutation index",
        type: "Index",
        struct: "SoundPitchRange"
      },
      {
        kind: "field",
        name: "samples pointer",
        type: "uint32",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "tag id 0",
        type: "TagID",
        cacheOnly: true,
        comment: "Set to the sound tag's tag ID"
      },
      {
        kind: "field",
        name: "buffer size",
        type: "uint32",
        comment: "this is the buffer size used to hold (and, for Vorbis, decompress) the 16-bit PCM data (unused in Xbox ADPCM)"
      },
      {
        kind: "field",
        name: "tag id 1",
        type: "TagID",
        cacheOnly: true,
        comment: "Set to the sound tag's tag ID"
      },
      {
        kind: "field",
        name: "samples",
        type: "TagDataOffset",
        maximum: 4194304,
        fileOffset: true,
        externalFileOffset: "sounds.map"
      },
      {
        kind: "field",
        name: "mouth data",
        type: "TagDataOffset",
        maximum: 8192
      },
      {
        kind: "field",
        name: "subtitle data",
        type: "TagDataOffset",
        maximum: 512
      }
    ],
    sizeBytes: 124
  },
  {
    kind: "struct",
    name: "SoundPitchRange",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "natural pitch",
        type: "float",
        comment: "This is the base pitch for this pitch range.\nWhen the pitch bend is equal to this, then the audio is played at normal pitch and speed.\nNote that 0 defaults to 1."
      },
      {
        kind: "field",
        name: "bend bounds",
        type: "float",
        bounds: true,
        comment: "This is the minimum and maximum bend in which this pitch range will be used.\nIf the lower bound is higher than natural pitch, then it will be set to natural pitch. Also, if the higher bound is lower than natural pitch, then it will be set to natural pitch."
      },
      {
        kind: "field",
        name: "actual permutation count",
        type: "uint16",
        comment: "This is the number of actual permutations in the pitch range, not including chunks due to splitting."
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "playback rate",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "permutation flags",
        type: "uint32",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "last permutation index",
        type: "Index",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "discarded permutation index",
        type: "Index",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "permutations",
        type: "TagReflexive",
        struct: "SoundPermutation",
        maximum: 256,
        extendedMaximum: 32767
      }
    ],
    sizeBytes: 72
  },
  {
    kind: "struct",
    name: "Sound",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "SoundFlags"
      },
      {
        kind: "field",
        name: "sound class",
        type: "SoundClass"
      },
      {
        kind: "field",
        name: "sample rate",
        type: "SoundSampleRate"
      },
      {
        kind: "field",
        name: "minimum distance",
        type: "float"
      },
      {
        kind: "field",
        name: "maximum distance",
        type: "float"
      },
      {
        kind: "field",
        name: "skip fraction",
        type: "Fraction"
      },
      {
        kind: "field",
        name: "random pitch bounds",
        type: "float",
        bounds: true,
        comment: "This is the base playback rate of the sound, affecting tempo and pitch."
      },
      {
        kind: "field",
        name: "inner cone angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "outer cone angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "outer cone gain",
        type: "Fraction"
      },
      {
        kind: "field",
        name: "random gain modifier",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "maximum bend per second",
        type: "float"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "zero skip fraction modifier",
        type: "float"
      },
      {
        kind: "field",
        name: "zero gain modifier",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "zero pitch modifier",
        type: "float"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "one skip fraction modifier",
        type: "float"
      },
      {
        kind: "field",
        name: "one gain modifier",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "one pitch modifier",
        type: "float"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "channel count",
        type: "SoundChannelCount"
      },
      {
        kind: "field",
        name: "format",
        type: "SoundFormat"
      },
      {
        kind: "field",
        name: "promotion sound",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "promotion count",
        type: "uint16"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "longest permutation length",
        type: "uint32",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "promotion counter",
        type: "uint32",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "promotion time",
        type: "uint32",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "scripting time",
        type: "uint32",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "scripting sound",
        type: "TagID",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "pitch ranges",
        type: "TagReflexive",
        struct: "SoundPitchRange",
        maximum: 8
      }
    ],
    tagClass: "sound",
    sizeBytes: 164
  }
];

// ../core/src/map/definitions/groups/sound_environment.json
var sound_environment_default = [
  {
    kind: "struct",
    name: "SoundEnvironment",
    fields: [
      {
        kind: "field",
        name: "unknown",
        type: "int32",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "priority",
        type: "int16"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "room intensity",
        type: "Fraction"
      },
      {
        kind: "field",
        name: "room intensity hf",
        type: "Fraction"
      },
      {
        kind: "field",
        name: "room rolloff",
        type: "float"
      },
      {
        kind: "field",
        name: "decay time",
        type: "float"
      },
      {
        kind: "field",
        name: "decay hf ratio",
        type: "float"
      },
      {
        kind: "field",
        name: "reflections intensity",
        type: "Fraction"
      },
      {
        kind: "field",
        name: "reflections delay",
        type: "float"
      },
      {
        kind: "field",
        name: "reverb intensity",
        type: "Fraction"
      },
      {
        kind: "field",
        name: "reverb delay",
        type: "float"
      },
      {
        kind: "field",
        name: "diffusion",
        type: "float"
      },
      {
        kind: "field",
        name: "density",
        type: "float"
      },
      {
        kind: "field",
        name: "hf reference",
        type: "float"
      },
      {
        kind: "pad",
        size: 16
      }
    ],
    tagClass: "sound_environment",
    sizeBytes: 72
  }
];

// ../core/src/map/definitions/groups/sound_looping.json
var sound_looping_default = [
  {
    kind: "bitfield",
    name: "SoundLoopingTrackFlags",
    width: 32,
    fields: [
      "fade in at start",
      "fade out at stop",
      "fade in alternate"
    ]
  },
  {
    kind: "bitfield",
    name: "SoundLoopingDetailFlags",
    width: 32,
    fields: [
      "don't play with alternate",
      "don't play without alternate"
    ]
  },
  {
    kind: "bitfield",
    name: "SoundLoopingFlags",
    width: 32,
    fields: [
      "deafening to ais",
      "not a loop",
      "stops music",
      "siege of madrigal"
    ]
  },
  {
    kind: "struct",
    name: "SoundLoopingTrack",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "SoundLoopingTrackFlags"
      },
      {
        kind: "field",
        name: "gain",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "fade in duration",
        type: "float"
      },
      {
        kind: "field",
        name: "fade out duration",
        type: "float"
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "start",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "loop",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "end",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "alternate loop",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "alternate end",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      }
    ],
    sizeBytes: 160
  },
  {
    kind: "struct",
    name: "SoundLoopingDetail",
    fields: [
      {
        kind: "field",
        name: "sound",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "random period bounds",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "gain",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "flags",
        type: "SoundLoopingDetailFlags"
      },
      {
        kind: "pad",
        size: 48
      },
      {
        kind: "field",
        name: "yaw bounds",
        type: "Angle",
        bounds: true
      },
      {
        kind: "field",
        name: "pitch bounds",
        type: "Angle",
        bounds: true
      },
      {
        kind: "field",
        name: "distance bounds",
        type: "float",
        bounds: true
      }
    ],
    sizeBytes: 104
  },
  {
    kind: "struct",
    name: "SoundLooping",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "SoundLoopingFlags"
      },
      {
        kind: "field",
        name: "zero detail sound period",
        type: "float"
      },
      {
        kind: "field",
        name: "zero detail unused",
        type: "float",
        count: 2,
        cacheOnly: true
      },
      {
        kind: "field",
        name: "one detail sound period",
        type: "float"
      },
      {
        kind: "field",
        name: "one detail unused",
        type: "float",
        count: 2,
        cacheOnly: true
      },
      {
        kind: "field",
        name: "runtime scripting sound",
        type: "TagID",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "maximum distance",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "continuous damage effect",
        type: "TagDependency",
        classes: [
          "continuous_damage_effect"
        ]
      },
      {
        kind: "field",
        name: "tracks",
        type: "TagReflexive",
        struct: "SoundLoopingTrack",
        maximum: 4
      },
      {
        kind: "field",
        name: "detail sounds",
        type: "TagReflexive",
        struct: "SoundLoopingDetail",
        maximum: 32
      }
    ],
    tagClass: "sound_looping",
    sizeBytes: 84
  }
];

// ../core/src/map/definitions/groups/sound_scenery.json
var sound_scenery_default = [
  {
    kind: "struct",
    name: "SoundScenery",
    fields: [],
    inherits: "BasicObject",
    tagClass: "sound_scenery",
    sizeBytes: 508
  }
];

// ../core/src/map/definitions/groups/spheroid.json
var spheroid_default = [
  {
    kind: "struct",
    name: "Spheroid",
    tagClass: "spheroid",
    fields: [
      {
        kind: "field",
        name: "radius",
        type: "float",
        comment: "UNCERTAIN: Reclaimer's own comment on this field says 'this is just a guess. This could just as easily be 4 bytes of padding.' No other source (including Invader, which has no definition for this tag group at all) could be opened to confirm. Flagged uncertain in SOURCES.md; treated as a single opaque 4-byte field so offsets/size stay correct even if the semantic meaning here is wrong."
      }
    ],
    sizeBytes: 4
  }
];

// ../core/src/map/definitions/groups/string_list.json
var string_list_default = [
  {
    kind: "struct",
    name: "StringListString",
    fields: [
      {
        kind: "field",
        name: "string",
        type: "TagDataOffset",
        maximum: 4096
      }
    ],
    sizeBytes: 20
  },
  {
    kind: "struct",
    name: "StringList",
    fields: [
      {
        kind: "field",
        name: "strings",
        type: "TagReflexive",
        struct: "StringListString",
        maximum: 800
      }
    ],
    tagClass: "string_list",
    sizeBytes: 12
  }
];

// ../core/src/map/definitions/groups/tag_collection.json
var tag_collection_default = [
  {
    kind: "struct",
    name: "TagCollectionTag",
    fields: [
      {
        kind: "field",
        name: "reference",
        type: "TagDependency",
        classes: [
          "*"
        ]
      }
    ],
    sizeBytes: 16
  },
  {
    kind: "struct",
    name: "TagCollection",
    fields: [
      {
        kind: "field",
        name: "tags",
        type: "TagReflexive",
        struct: "TagCollectionTag",
        maximum: 200
      }
    ],
    tagClass: "tag_collection",
    sizeBytes: 12
  }
];

// ../core/src/map/definitions/groups/ui_widget_collection.json
var ui_widget_collection_default = [
  {
    kind: "struct",
    name: "UIWidgetCollectionEntry",
    fields: [
      {
        kind: "field",
        name: "ui widget definition",
        type: "TagDependency",
        classes: ["ui_widget_definition"]
      }
    ],
    sizeBytes: 16
  },
  {
    kind: "struct",
    name: "UIWidgetCollection",
    tagClass: "ui_widget_collection",
    fields: [
      {
        kind: "field",
        name: "ui widget definitions",
        type: "TagReflexive",
        struct: "UIWidgetCollectionEntry",
        maximum: 32
      }
    ],
    sizeBytes: 12
  }
];

// ../core/src/map/definitions/groups/ui_widget_definition.json
var ui_widget_definition_default = [
  {
    kind: "enum",
    name: "UIGameDataInputReferenceFunction",
    options: [
      "null",
      "player settings menu update desc",
      "unused",
      "playlist settings menu update desc",
      "gametype select menu update desc",
      "multiplayer type menu update desc",
      "solo level select update",
      "difficulty menu update desc",
      "build number textbox only",
      "server list update",
      "network pregame status update",
      "splitscreen pregame status update",
      "net splitscreen prejoin players",
      "mp profile list update",
      "3wide player profile list update",
      "plyr prof edit select menu upd8",
      "player profile small menu update",
      "game settings lists text update",
      "solo game objective text",
      "color picker update",
      "game settings lists pic update",
      "main menu fake animate",
      "mp level select update",
      "get active plyr profile name",
      "get edit plyr profile name",
      "get edit game settings name",
      "get active plyr profile color",
      "mp set textbox map name",
      "mp set textbox game ruleset",
      "mp set textbox teams noteams",
      "mp set textbox score limit",
      "mp set textbox score limit type",
      "mp set bitmap for map",
      "mp set bitmap for ruleset",
      "mp set textbox",
      "mp edit profile set rule text",
      "system link status check",
      "mp game directions",
      "teams no teams bitmap update",
      "warn if diff will nuke saved game",
      "dim if no net cable",
      "pause game set textbox inverted",
      "dim unless two controllers",
      "controls update menu",
      "video menu update",
      "gamespy screen update",
      "common button bar update",
      "gamepad update menu",
      "server settings update",
      "audio menu update",
      "mp prof vehicles update",
      "solo map list update",
      "mp map list update",
      "gt select list update",
      "gt edit list update",
      "load game list update",
      "checking for updates",
      "direct ip connect update",
      "network settings update"
    ]
  },
  {
    kind: "enum",
    name: "UIEventType",
    options: [
      "a button",
      "b button",
      "x button",
      "y button",
      "black button",
      "white button",
      "left trigger",
      "right trigger",
      "dpad up",
      "dpad down",
      "dpad left",
      "dpad right",
      "start button",
      "back button",
      "left thumb",
      "right thumb",
      "left analog stick up",
      "left analog stick down",
      "left analog stick left",
      "left analog stick right",
      "left analog stick up 1",
      "right analog stick down",
      "right analog stick left",
      "right analog stick right",
      "created",
      "deleted",
      "get focus",
      "lose focus",
      "left mouse",
      "middle mouse",
      "right mouse",
      "double click",
      "custom activation",
      "post render"
    ]
  },
  {
    kind: "enum",
    name: "UIEventHandlerReferenceFunction",
    options: [
      "null",
      "list goto next item",
      "list goto previous item",
      "unused",
      "unused1",
      "initialize sp level list solo",
      "initialize sp level list coop",
      "dispose sp level list",
      "solo level set map",
      "set difficulty",
      "start new game",
      "pause game restart at checkpoint",
      "pause game restart level",
      "pause game return to main menu",
      "clear multiplayer player joins",
      "join controller to mp game",
      "initialize net game server list",
      "start network game server",
      "dispose net game server list",
      "shutdown network game",
      "net game join from server list",
      "split screen game initialize",
      "coop game initialize",
      "main menu intialize",
      "mp type menu initialize",
      "pick play stage for quick start",
      "mp level list initialize",
      "mp level list dispose",
      "mp level select",
      "mp profiles list initialize",
      "mp profiles list dispose",
      "mp profile set for game",
      "swap player team",
      "net game join player",
      "player profile list initialize",
      "player profile list dispose",
      "3wide plyr prof set for game",
      "1wide plyr prof set for game",
      "mp profile begin editing",
      "mp profile end editing",
      "mp profile set game engine",
      "mp profile change name",
      "mp profile set ctf rules",
      "mp profile set koth rules",
      "mp profile set slayer rules",
      "mp profile set oddball rules",
      "mp profile set racing rules",
      "mp profile set player options",
      "mp profile set item options",
      "mp profile set indicator opts",
      "mp profile init game engine",
      "mp profile init name",
      "mp profile init ctf rules",
      "mp profile init koth rules",
      "mp profile init slayer rules",
      "mp profile init oddball rules",
      "mp profile init racing rules",
      "mp profile init player opts",
      "mp profile init item options",
      "mp profile init indicator opts",
      "mp profile save changes",
      "color picker menu initialize",
      "color picker menu dispose",
      "color picker select color",
      "player profile begin editing",
      "player profile end editing",
      "player profile change name",
      "player profile save changes",
      "plyr prf init cntl settings",
      "plyr prf init adv cntl set",
      "plyr prf save cntl settings",
      "plyr prf save adv cntl set",
      "mp game player quit",
      "main menu switch to solo game",
      "request del player profile",
      "request del playlist profile",
      "final del player profile",
      "final del playlist profile",
      "cancel profile delete",
      "create edit playlist profile",
      "create edit player profile",
      "net game speed start",
      "net game delay start",
      "net server accept conx",
      "net server defer start",
      "net server allow start",
      "disable if no xdemos",
      "run xdemos",
      "sp reset controller choices",
      "sp set p1 controller choice",
      "sp set p2 controller choice",
      "error if no network connection",
      "start server if none advertised",
      "net game unjoin player",
      "close if not editing profile",
      "exit to xbox dashboard",
      "new campaign chosen",
      "new campaign decision",
      "pop history stack once",
      "difficulty menu init",
      "begin music fade out",
      "new game if no plyr profiles",
      "exit gracefully to xbox dashboard",
      "pause game invert pitch",
      "start new coop game",
      "pause game invert spinner get",
      "pause game invert spinner set",
      "main menu quit game",
      "mouse emit accept event",
      "mouse emit back event",
      "mouse emit dpad left event",
      "mouse emit dpad right event",
      "mouse spinner 3wide click",
      "controls screen init",
      "video screen init",
      "controls begin binding",
      "gamespy screen init",
      "gamespy screen dispose",
      "gamespy select header",
      "gamespy select item",
      "gamespy select button",
      "plr prof init mouse set",
      "plr prof change mouse set",
      "plr prof init audio set",
      "plr prof change audio set",
      "plr prof change video set",
      "controls screen dispose",
      "controls screen change set",
      "mouse emit x event",
      "gamepad screen init",
      "gamepad screen dispose",
      "gamepad screen change gamepads",
      "gamepad screen select item",
      "mouse screen defaults",
      "audio screen defaults",
      "video screen defaults",
      "controls screen defaults",
      "profile set edit begin",
      "profile manager delete",
      "profile manager select",
      "gamespy dismiss error",
      "server settings init",
      "ss edit server name",
      "ss edit server password",
      "ss start game",
      "video test dialog init",
      "video test dialog dispose",
      "video test dialog accept",
      "gamespy dismiss filters",
      "gamespy update filter settings",
      "gamespy back handler",
      "mouse spinner 1wide click",
      "controls back handler",
      "controls advanced launch",
      "controls advanced ok",
      "mp pause menu open",
      "mp game options open",
      "mp choose team",
      "mp prof init vehicle options",
      "mp prof save vehicle options",
      "single prev cl item activated",
      "mp prof init teamplay options",
      "mp prof save teamplay options",
      "mp game options choose",
      "emit custom activation event",
      "plr prof cancel audio set",
      "plr prof init network options",
      "plr prof save network options",
      "credits post render",
      "difficulty item select",
      "credits initialize",
      "credits dispose",
      "gamespy get patch",
      "video screen dispose",
      "campaign menu init",
      "campaign menu continue",
      "load game menu init",
      "load game menu dispose",
      "load game menu activated",
      "solo menu save checkpoint",
      "mp type set mode",
      "checking for updates ok",
      "checking for updates dismiss",
      "direct ip connect init",
      "direct ip connect go",
      "direct ip edit field",
      "network settings edit a port",
      "network settings defaults",
      "load game menu delete request",
      "load game menu delete finish"
    ]
  },
  {
    kind: "enum",
    name: "UIReplaceFunction",
    options: [
      "null",
      "widget s controller",
      "build number",
      "pid"
    ]
  },
  {
    kind: "enum",
    name: "UIWidgetType",
    options: [
      "container",
      "text box",
      "spinner list",
      "column list",
      "game model not implemented",
      "movie not implemented",
      "custom not implemented"
    ]
  },
  {
    kind: "enum",
    name: "UIControllerIndex",
    options: [
      "player 1",
      "player 2",
      "player 3",
      "player 4",
      "any player"
    ]
  },
  {
    kind: "enum",
    name: "UIJustification",
    options: [
      "left justify",
      "right justify",
      "center justify"
    ]
  },
  {
    kind: "bitfield",
    name: "EventHandlerReferencesFlags",
    width: 32,
    fields: [
      "close current widget",
      "close other widget",
      "close all widgets",
      "open widget",
      "reload self",
      "reload other widget",
      "give focus to widget",
      "run function",
      "replace self w widget",
      "go back to previous widget",
      "run scenario script",
      "try to branch on failure"
    ]
  },
  {
    kind: "bitfield",
    name: "ConditionalWidgetReferenceFlags",
    width: 32,
    fields: [
      "load if event handler function fails"
    ]
  },
  {
    kind: "bitfield",
    name: "ChildWidgetReferenceFlags",
    width: 32,
    fields: [
      "use custom controller index"
    ]
  },
  {
    kind: "bitfield",
    name: "UIWidgetDefinitionFlags",
    width: 32,
    fields: [
      "pass unhandled events to focused child",
      "pause game time",
      "flash background bitmap",
      "dpad up down tabs thru children",
      "dpad left right tabs thru children",
      "dpad up down tabs thru list items",
      "dpad left right tabs thru list items",
      "dont focus a specific child widget",
      "pass unhandled events to all children",
      "render regardless of controller index",
      "pass handled events to all children",
      "return to main menu if no history",
      "always use tag controller index",
      "always use nifty render fx",
      "don't push history",
      "force handle mouse"
    ]
  },
  {
    kind: "bitfield",
    name: "UIWidgetDefinitionFlags1",
    width: 32,
    fields: [
      "editable",
      "password",
      "flashing",
      "don't do that weird focus test"
    ]
  },
  {
    kind: "bitfield",
    name: "UIWidgetDefinitionFlags2",
    width: 32,
    fields: [
      "list items generated in code",
      "list items from string list tag",
      "list items only one tooltip",
      "list single preview no scroll"
    ]
  },
  {
    kind: "struct",
    name: "GameDataInputReference",
    fields: [
      {
        kind: "field",
        name: "function",
        type: "UIGameDataInputReferenceFunction"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    sizeBytes: 36
  },
  {
    kind: "struct",
    name: "EventHandlerReference",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "EventHandlerReferencesFlags"
      },
      {
        kind: "field",
        name: "event type",
        type: "UIEventType"
      },
      {
        kind: "field",
        name: "function",
        type: "UIEventHandlerReferenceFunction"
      },
      {
        kind: "field",
        name: "widget tag",
        type: "TagDependency",
        classes: [
          "ui_widget_definition"
        ]
      },
      {
        kind: "field",
        name: "sound effect",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "script",
        type: "TagString"
      }
    ],
    sizeBytes: 72
  },
  {
    kind: "struct",
    name: "SearchAndReplaceReference",
    fields: [
      {
        kind: "field",
        name: "search string",
        type: "TagString"
      },
      {
        kind: "field",
        name: "replace function",
        type: "UIReplaceFunction"
      }
    ],
    sizeBytes: 34
  },
  {
    kind: "struct",
    name: "ConditionalWidgetReference",
    fields: [
      {
        kind: "field",
        name: "widget tag",
        type: "TagDependency",
        classes: [
          "ui_widget_definition"
        ]
      },
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "flags",
        type: "ConditionalWidgetReferenceFlags"
      },
      {
        kind: "field",
        name: "custom controller index",
        type: "Index"
      },
      {
        kind: "pad",
        size: 26
      }
    ],
    sizeBytes: 80
  },
  {
    kind: "struct",
    name: "ChildWidgetReference",
    fields: [
      {
        kind: "field",
        name: "widget tag",
        type: "TagDependency",
        classes: [
          "ui_widget_definition"
        ]
      },
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "flags",
        type: "ChildWidgetReferenceFlags"
      },
      {
        kind: "field",
        name: "custom controller index",
        type: "Index"
      },
      {
        kind: "field",
        name: "vertical offset",
        type: "int16"
      },
      {
        kind: "field",
        name: "horizontal offset",
        type: "int16"
      },
      {
        kind: "pad",
        size: 22
      }
    ],
    sizeBytes: 80
  },
  {
    kind: "struct",
    name: "UIWidgetDefinition",
    fields: [
      {
        kind: "field",
        name: "widget type",
        type: "UIWidgetType"
      },
      {
        kind: "field",
        name: "controller index",
        type: "UIControllerIndex"
      },
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "bounds",
        type: "Rectangle2D"
      },
      {
        kind: "field",
        name: "flags",
        type: "UIWidgetDefinitionFlags"
      },
      {
        kind: "field",
        name: "milliseconds to auto close",
        type: "int32"
      },
      {
        kind: "field",
        name: "milliseconds auto close fade time",
        type: "int32"
      },
      {
        kind: "field",
        name: "background bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "game data inputs",
        type: "TagReflexive",
        struct: "GameDataInputReference",
        maximum: 64
      },
      {
        kind: "field",
        name: "event handlers",
        type: "TagReflexive",
        struct: "EventHandlerReference",
        maximum: 32
      },
      {
        kind: "field",
        name: "search and replace functions",
        type: "TagReflexive",
        struct: "SearchAndReplaceReference",
        maximum: 32
      },
      {
        kind: "pad",
        size: 128
      },
      {
        kind: "field",
        name: "text label unicode strings list",
        type: "TagDependency",
        classes: [
          "unicode_string_list"
        ]
      },
      {
        kind: "field",
        name: "text font",
        type: "TagDependency",
        classes: [
          "font"
        ]
      },
      {
        kind: "field",
        name: "text color",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "justification",
        type: "UIJustification"
      },
      {
        kind: "field",
        name: "flags 1",
        type: "UIWidgetDefinitionFlags1"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "string list index",
        type: "Index"
      },
      {
        kind: "field",
        name: "horiz offset",
        type: "int16"
      },
      {
        kind: "field",
        name: "vert offset",
        type: "int16"
      },
      {
        kind: "pad",
        size: 26
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "flags 2",
        type: "UIWidgetDefinitionFlags2"
      },
      {
        kind: "field",
        name: "list header bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "list footer bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "header bounds",
        type: "Rectangle2D"
      },
      {
        kind: "field",
        name: "footer bounds",
        type: "Rectangle2D"
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "extended description widget",
        type: "TagDependency",
        classes: [
          "ui_widget_definition"
        ]
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "pad",
        size: 256
      },
      {
        kind: "field",
        name: "conditional widgets",
        type: "TagReflexive",
        struct: "ConditionalWidgetReference",
        maximum: 32
      },
      {
        kind: "pad",
        size: 128
      },
      {
        kind: "pad",
        size: 128
      },
      {
        kind: "field",
        name: "child widgets",
        type: "TagReflexive",
        struct: "ChildWidgetReference",
        maximum: 32
      }
    ],
    tagClass: "ui_widget_definition",
    sizeBytes: 1004
  }
];

// ../core/src/map/definitions/groups/unicode_string_list.json
var unicode_string_list_default = [
  {
    kind: "struct",
    name: "UnicodeStringListString",
    fields: [
      {
        kind: "field",
        name: "string",
        type: "TagDataOffset",
        maximum: 32768
      }
    ],
    sizeBytes: 20
  },
  {
    kind: "struct",
    name: "UnicodeStringList",
    fields: [
      {
        kind: "field",
        name: "strings",
        type: "TagReflexive",
        struct: "UnicodeStringListString",
        maximum: 800
      }
    ],
    tagClass: "unicode_string_list",
    sizeBytes: 12
  }
];

// ../core/src/map/definitions/groups/unit.json
var unit_default = [
  {
    kind: "enum",
    name: "UnitFunctionIn",
    options: [
      "none",
      "driver seat power",
      "gunner seat power",
      "aiming change",
      "mouth aperture",
      "integrated light power",
      "can blink",
      "shield sapping"
    ]
  },
  {
    kind: "enum",
    name: "UnitDefaultTeam",
    options: [
      "none",
      "player",
      "human",
      "covenant",
      "flood",
      "sentinel",
      "unused6",
      "unused7",
      "unused8",
      "unused9"
    ]
  },
  {
    kind: "enum",
    name: "UnitMotionSensorBlipSize",
    options: [
      "medium",
      "small",
      "large"
    ]
  },
  {
    kind: "bitfield",
    name: "UnitFlags",
    width: 32,
    fields: [
      "circular aiming",
      "destroyed after dying",
      "half speed interpolation",
      "fires from camera",
      "entrance inside bounding sphere",
      "unused",
      "causes passenger dialogue",
      "resists pings",
      "melee attack is fatal",
      "don't reface during pings",
      "has no aiming",
      "simple creature",
      "impact melee attaches to unit",
      "impact melee dies on shields",
      "cannot open doors automatically",
      "melee attackers cannot attach",
      "not instantly killed by melee",
      "shield sapping",
      "runs around flaming",
      "inconsequential",
      "special cinematic unit",
      "ignored by autoaiming",
      "shields fry infection forms",
      "integrated light cntrls weapon",
      "integrated light lasts forever"
    ]
  },
  {
    kind: "bitfield",
    name: "UnitSeatFlags",
    width: 32,
    fields: [
      "invisible",
      "locked",
      "driver",
      "gunner",
      "third person camera",
      "allows weapons",
      "third person on enter",
      "first person camera slaved to gun",
      "allow vehicle communication animations",
      "not valid without driver",
      "allow ai noncombatants"
    ]
  },
  {
    kind: "struct",
    name: "UnitPoweredSeat",
    fields: [
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "driver powerup time",
        type: "float"
      },
      {
        kind: "field",
        name: "driver powerdown time",
        type: "float"
      },
      {
        kind: "pad",
        size: 56
      }
    ],
    sizeBytes: 68
  },
  {
    kind: "struct",
    name: "UnitCameraTrack",
    fields: [
      {
        kind: "field",
        name: "track",
        type: "TagDependency",
        classes: [
          "camera_track"
        ]
      },
      {
        kind: "pad",
        size: 12
      }
    ],
    sizeBytes: 28
  },
  {
    kind: "struct",
    name: "UnitUnitHudInterface",
    fields: [
      {
        kind: "field",
        name: "hud",
        type: "TagDependency",
        classes: [
          "unit_hud_interface"
        ]
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    sizeBytes: 48
  },
  {
    kind: "enum",
    name: "MetagameType",
    options: [
      "brute",
      "grunt",
      "jackal",
      "skirmisher",
      "marine",
      "spartan",
      "bugger",
      "hunter",
      "flood infection",
      "flood carrier",
      "flood combat",
      "flood pure",
      "sentinel",
      "elite",
      "engineer",
      "mule",
      "turret",
      "mongoose",
      "warthog",
      "scorpion",
      "hornet",
      "pelican",
      "revenant",
      "seraph",
      "shade",
      "watchtower",
      "ghost",
      "chopper",
      "mauler",
      "wraith",
      "banshee",
      "phantom",
      "scarab",
      "guntower",
      "tuning fork",
      "broadsword",
      "mammoth",
      "lich",
      "mantis",
      "wasp",
      "phaeton",
      "bishop",
      "knight",
      "pawn"
    ]
  },
  {
    kind: "enum",
    name: "MetagameClass",
    options: [
      "infantry",
      "leader",
      "hero",
      "specialist",
      "light vehicle",
      "heavy vehicle",
      "giant vehicle",
      "standard vehicle"
    ]
  },
  {
    kind: "struct",
    name: "UnitSeat",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "UnitSeatFlags"
      },
      {
        kind: "field",
        name: "label",
        type: "TagString"
      },
      {
        kind: "field",
        name: "marker name",
        type: "TagString"
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "acceleration scale",
        type: "Vector3D"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "yaw rate",
        type: "float"
      },
      {
        kind: "field",
        name: "pitch rate",
        type: "float"
      },
      {
        kind: "field",
        name: "camera marker name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "camera submerged marker name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "pitch auto level",
        type: "Angle"
      },
      {
        kind: "field",
        name: "pitch range",
        type: "Angle",
        bounds: true
      },
      {
        kind: "field",
        name: "camera tracks",
        type: "TagReflexive",
        struct: "UnitCameraTrack",
        maximum: 2
      },
      {
        kind: "field",
        name: "unit hud interface",
        type: "TagReflexive",
        struct: "UnitUnitHudInterface",
        maximum: 2
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "hud text message index",
        type: "Index"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "yaw minimum",
        type: "Angle"
      },
      {
        kind: "field",
        name: "yaw maximum",
        type: "Angle"
      },
      {
        kind: "field",
        name: "built in gunner",
        type: "TagDependency",
        classes: [
          "actor_variant"
        ]
      },
      {
        kind: "pad",
        size: 20
      }
    ],
    sizeBytes: 284
  },
  {
    kind: "struct",
    name: "UnitWeapon",
    fields: [
      {
        kind: "field",
        name: "weapon",
        type: "TagDependency",
        classes: [
          "weapon"
        ]
      },
      {
        kind: "pad",
        size: 20
      }
    ],
    sizeBytes: 36
  },
  {
    kind: "struct",
    name: "UnitDialogueVariant",
    fields: [
      {
        kind: "field",
        name: "variant number",
        type: "int16"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "dialogue",
        type: "TagDependency",
        classes: [
          "dialogue"
        ]
      }
    ],
    sizeBytes: 24
  },
  {
    kind: "struct",
    name: "Unit",
    fields: [
      {
        kind: "field",
        name: "unit flags",
        type: "UnitFlags"
      },
      {
        kind: "field",
        name: "default team",
        type: "UnitDefaultTeam"
      },
      {
        kind: "field",
        name: "constant sound volume",
        type: "ObjectNoise"
      },
      {
        kind: "field",
        name: "rider damage fraction",
        type: "float"
      },
      {
        kind: "field",
        name: "integrated light toggle",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      },
      {
        kind: "field",
        name: "unit a in",
        type: "UnitFunctionIn"
      },
      {
        kind: "field",
        name: "unit b in",
        type: "UnitFunctionIn"
      },
      {
        kind: "field",
        name: "unit c in",
        type: "UnitFunctionIn"
      },
      {
        kind: "field",
        name: "unit d in",
        type: "UnitFunctionIn"
      },
      {
        kind: "field",
        name: "camera field of view",
        type: "Angle"
      },
      {
        kind: "field",
        name: "camera stiffness",
        type: "float"
      },
      {
        kind: "field",
        name: "camera marker name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "camera submerged marker name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "pitch auto level",
        type: "Angle"
      },
      {
        kind: "field",
        name: "pitch range",
        type: "Angle",
        bounds: true
      },
      {
        kind: "field",
        name: "camera tracks",
        type: "TagReflexive",
        struct: "UnitCameraTrack",
        maximum: 2
      },
      {
        kind: "field",
        name: "seat acceleration scale",
        type: "Point3D"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "soft ping threshold",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "soft ping interrupt time",
        type: "float"
      },
      {
        kind: "field",
        name: "hard ping threshold",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "hard ping interrupt time",
        type: "float"
      },
      {
        kind: "field",
        name: "hard death threshold",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "feign death threshold",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "feign death time",
        type: "float"
      },
      {
        kind: "field",
        name: "distance of evade anim",
        type: "float"
      },
      {
        kind: "field",
        name: "distance of dive anim",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "stunned movement threshold",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "feign death chance",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "feign repeat chance",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "spawned actor",
        type: "TagDependency",
        classes: [
          "actor_variant"
        ]
      },
      {
        kind: "field",
        name: "spawned actor count",
        type: "int16",
        bounds: true
      },
      {
        kind: "field",
        name: "spawned velocity",
        type: "float"
      },
      {
        kind: "field",
        name: "aiming velocity maximum",
        type: "Angle"
      },
      {
        kind: "field",
        name: "aiming acceleration maximum",
        type: "Angle"
      },
      {
        kind: "field",
        name: "casual aiming modifier",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "looking velocity maximum",
        type: "Angle"
      },
      {
        kind: "field",
        name: "looking acceleration maximum",
        type: "Angle"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "ai vehicle radius",
        type: "float"
      },
      {
        kind: "field",
        name: "ai danger radius",
        type: "float"
      },
      {
        kind: "field",
        name: "melee damage",
        type: "TagDependency",
        classes: [
          "damage_effect"
        ]
      },
      {
        kind: "field",
        name: "motion sensor blip size",
        type: "UnitMotionSensorBlipSize"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "metagame type",
        type: "MetagameType",
        comment: "used for scoring in Halo: CE Anniversary (MCC only)"
      },
      {
        kind: "field",
        name: "metagame class",
        type: "MetagameClass",
        comment: "used for scoring in Halo: CE Anniversary (MCC only)"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "new hud interfaces",
        type: "TagReflexive",
        struct: "UnitUnitHudInterface",
        maximum: 2
      },
      {
        kind: "field",
        name: "dialogue variants",
        type: "TagReflexive",
        struct: "UnitDialogueVariant",
        maximum: 16
      },
      {
        kind: "field",
        name: "grenade velocity",
        type: "float"
      },
      {
        kind: "field",
        name: "grenade type",
        type: "GrenadeType"
      },
      {
        kind: "field",
        name: "grenade count",
        type: "int16"
      },
      {
        kind: "field",
        name: "soft ping interrupt ticks",
        type: "int16",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "hard ping interrupt ticks",
        type: "int16",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "powered seats",
        type: "TagReflexive",
        struct: "UnitPoweredSeat",
        maximum: 2
      },
      {
        kind: "field",
        name: "weapons",
        type: "TagReflexive",
        struct: "UnitWeapon",
        maximum: 4
      },
      {
        kind: "field",
        name: "seats",
        type: "TagReflexive",
        struct: "UnitSeat",
        maximum: 16
      }
    ],
    inherits: "Object",
    tagClass: "unit",
    sizeBytes: 752
  }
];

// ../core/src/map/definitions/groups/unit_hud_interface.json
var unit_hud_interface_default = [
  {
    kind: "enum",
    name: "UnitHUDInterfaceMeterPanelType",
    options: [
      "integrated light"
    ]
  },
  {
    kind: "enum",
    name: "UnitHUDInterfaceOverlayPanelType",
    options: [
      "team icon"
    ]
  },
  {
    kind: "bitfield",
    name: "UnitHUDInterfaceAuxiliaryOverlayFlags",
    width: 16,
    fields: [
      "use team color"
    ]
  },
  {
    kind: "bitfield",
    name: "UnitHUDInterfaceHUDSoundLatchedTo",
    width: 32,
    fields: [
      "shield recharging",
      "shield damaged",
      "shield low",
      "shield empty",
      "health low",
      "health empty",
      "health minor damage",
      "health major damage"
    ]
  },
  {
    kind: "bitfield",
    name: "UnitHUDInterfaceAuxiliaryPanelMeterMoreFlags",
    width: 32,
    fields: [
      "show only when active",
      "flash once if activated while disabled"
    ]
  },
  {
    kind: "struct",
    name: "UnitHUDInterfaceAuxiliaryOverlay",
    fields: [
      {
        kind: "field",
        name: "anchor offset",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "width scale",
        type: "float"
      },
      {
        kind: "field",
        name: "height scale",
        type: "float"
      },
      {
        kind: "field",
        name: "scaling flags",
        type: "HUDInterfaceScalingFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "interface bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "default color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "flashing color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "flash period",
        type: "float"
      },
      {
        kind: "field",
        name: "flash delay",
        type: "float"
      },
      {
        kind: "field",
        name: "number of flashes",
        type: "int16"
      },
      {
        kind: "field",
        name: "flash flags",
        type: "HUDInterfaceFlashFlags"
      },
      {
        kind: "field",
        name: "flash length",
        type: "float"
      },
      {
        kind: "field",
        name: "disabled color",
        type: "ColorARGBInt"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "sequence index",
        type: "Index"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "multitexture overlays",
        type: "TagReflexive",
        struct: "HUDInterfaceMultitextureOverlay",
        maximum: 30
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "type",
        type: "UnitHUDInterfaceOverlayPanelType"
      },
      {
        kind: "field",
        name: "flags",
        type: "UnitHUDInterfaceAuxiliaryOverlayFlags"
      },
      {
        kind: "pad",
        size: 24
      }
    ],
    sizeBytes: 132
  },
  {
    kind: "struct",
    name: "UnitHUDInterfaceHUDSound",
    fields: [
      {
        kind: "field",
        name: "sound",
        type: "TagDependency",
        classes: [
          "sound",
          "sound_looping"
        ]
      },
      {
        kind: "field",
        name: "latched to",
        type: "UnitHUDInterfaceHUDSoundLatchedTo"
      },
      {
        kind: "field",
        name: "scale",
        type: "float"
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    sizeBytes: 56
  },
  {
    kind: "struct",
    name: "UnitHUDInterfaceAuxiliaryPanel",
    fields: [
      {
        kind: "field",
        name: "type",
        type: "UnitHUDInterfaceMeterPanelType"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "background anchor offset",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "background width scale",
        type: "float"
      },
      {
        kind: "field",
        name: "background height scale",
        type: "float"
      },
      {
        kind: "field",
        name: "background scaling flags",
        type: "HUDInterfaceScalingFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "background interface bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "background default color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "background flashing color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "background flash period",
        type: "float"
      },
      {
        kind: "field",
        name: "background flash delay",
        type: "float"
      },
      {
        kind: "field",
        name: "background number of flashes",
        type: "int16"
      },
      {
        kind: "field",
        name: "background flash flags",
        type: "HUDInterfaceFlashFlags"
      },
      {
        kind: "field",
        name: "background flash length",
        type: "float"
      },
      {
        kind: "field",
        name: "background disabled color",
        type: "ColorARGBInt"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "background sequence index",
        type: "Index"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "background multitexture overlays",
        type: "TagReflexive",
        struct: "HUDInterfaceMultitextureOverlay",
        maximum: 30
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "meter anchor offset",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "meter width scale",
        type: "float"
      },
      {
        kind: "field",
        name: "meter height scale",
        type: "float"
      },
      {
        kind: "field",
        name: "meter scaling flags",
        type: "HUDInterfaceScalingFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "meter meter bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "meter color at meter minimum",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "meter color at meter maximum",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "meter flash color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "meter empty color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "meter flags",
        type: "HUDInterfaceMeterFlags"
      },
      {
        kind: "field",
        name: "meter minimum meter value",
        type: "int8"
      },
      {
        kind: "field",
        name: "meter sequence index",
        type: "Index"
      },
      {
        kind: "field",
        name: "meter alpha multiplier",
        type: "int8"
      },
      {
        kind: "field",
        name: "meter alpha bias",
        type: "int8"
      },
      {
        kind: "field",
        name: "meter value scale",
        type: "int16"
      },
      {
        kind: "field",
        name: "meter opacity",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "meter translucency",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "meter disabled color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "meter min alpha",
        type: "float",
        maximum: 1
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "meter minimum fraction cutoff",
        type: "float"
      },
      {
        kind: "field",
        name: "meter more flags",
        type: "UnitHUDInterfaceAuxiliaryPanelMeterMoreFlags"
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "pad",
        size: 64
      }
    ],
    sizeBytes: 324
  },
  {
    kind: "struct",
    name: "UnitHUDInterface",
    fields: [
      {
        kind: "field",
        name: "anchor",
        type: "HUDInterfaceAnchor"
      },
      {
        kind: "field",
        name: "canvas size",
        type: "HUDInterfaceCanvasSize"
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "hud background anchor offset",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "hud background width scale",
        type: "float"
      },
      {
        kind: "field",
        name: "hud background height scale",
        type: "float"
      },
      {
        kind: "field",
        name: "hud background scaling flags",
        type: "HUDInterfaceScalingFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "hud background interface bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "hud background default color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "hud background flashing color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "hud background flash period",
        type: "float"
      },
      {
        kind: "field",
        name: "hud background flash delay",
        type: "float"
      },
      {
        kind: "field",
        name: "hud background number of flashes",
        type: "int16"
      },
      {
        kind: "field",
        name: "hud background flash flags",
        type: "HUDInterfaceFlashFlags"
      },
      {
        kind: "field",
        name: "hud background flash length",
        type: "float"
      },
      {
        kind: "field",
        name: "hud background disabled color",
        type: "ColorARGBInt"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "hud background sequence index",
        type: "Index"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "hud background multitexture overlays",
        type: "TagReflexive",
        struct: "HUDInterfaceMultitextureOverlay",
        maximum: 30
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "shield panel background anchor offset",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "shield panel background width scale",
        type: "float"
      },
      {
        kind: "field",
        name: "shield panel background height scale",
        type: "float"
      },
      {
        kind: "field",
        name: "shield panel background scaling flags",
        type: "HUDInterfaceScalingFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "shield panel background interface bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "shield panel background default color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "shield panel background flashing color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "shield panel background flash period",
        type: "float"
      },
      {
        kind: "field",
        name: "shield panel background flash delay",
        type: "float"
      },
      {
        kind: "field",
        name: "shield panel background number of flashes",
        type: "int16"
      },
      {
        kind: "field",
        name: "shield panel background flash flags",
        type: "HUDInterfaceFlashFlags"
      },
      {
        kind: "field",
        name: "shield panel background flash length",
        type: "float"
      },
      {
        kind: "field",
        name: "shield panel background disabled color",
        type: "ColorARGBInt"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "shield panel background sequence index",
        type: "Index"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "shield panel background multitexture overlays",
        type: "TagReflexive",
        struct: "HUDInterfaceMultitextureOverlay",
        maximum: 30
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "shield panel meter anchor offset",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "shield panel meter width scale",
        type: "float"
      },
      {
        kind: "field",
        name: "shield panel meter height scale",
        type: "float"
      },
      {
        kind: "field",
        name: "shield panel meter scaling flags",
        type: "HUDInterfaceScalingFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "shield panel meter meter bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "shield panel meter color at meter minimum",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "shield panel meter color at meter maximum",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "shield panel meter flash color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "shield panel meter empty color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "shield panel meter flags",
        type: "HUDInterfaceMeterFlags"
      },
      {
        kind: "field",
        name: "shield panel meter minimum meter value",
        type: "int8"
      },
      {
        kind: "field",
        name: "shield panel meter sequence index",
        type: "Index"
      },
      {
        kind: "field",
        name: "shield panel meter alpha multiplier",
        type: "int8"
      },
      {
        kind: "field",
        name: "shield panel meter alpha bias",
        type: "int8"
      },
      {
        kind: "field",
        name: "shield panel meter value scale",
        type: "int16"
      },
      {
        kind: "field",
        name: "shield panel meter opacity",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "shield panel meter translucency",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "shield panel meter disabled color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "shield panel meter min alpha",
        type: "float",
        maximum: 1
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "shield panel meter overcharge minimum color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "shield panel meter overcharge maximum color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "shield panel meter overcharge flash color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "shield panel meter overcharge empty color",
        type: "ColorARGBInt"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "health panel background anchor offset",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "health panel background width scale",
        type: "float"
      },
      {
        kind: "field",
        name: "health panel background height scale",
        type: "float"
      },
      {
        kind: "field",
        name: "health panel background scaling flags",
        type: "HUDInterfaceScalingFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "health panel background interface bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "health panel background default color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "health panel background flashing color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "health panel background flash period",
        type: "float"
      },
      {
        kind: "field",
        name: "health panel background flash delay",
        type: "float"
      },
      {
        kind: "field",
        name: "health panel background number of flashes",
        type: "int16"
      },
      {
        kind: "field",
        name: "health panel background flash flags",
        type: "HUDInterfaceFlashFlags"
      },
      {
        kind: "field",
        name: "health panel background flash length",
        type: "float"
      },
      {
        kind: "field",
        name: "health panel background disabled color",
        type: "ColorARGBInt"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "health panel background sequence index",
        type: "Index"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "health panel background multitexture overlays",
        type: "TagReflexive",
        struct: "HUDInterfaceMultitextureOverlay",
        maximum: 30
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "health panel meter anchor offset",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "health panel meter width scale",
        type: "float"
      },
      {
        kind: "field",
        name: "health panel meter height scale",
        type: "float"
      },
      {
        kind: "field",
        name: "health panel meter scaling flags",
        type: "HUDInterfaceScalingFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "health panel meter meter bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "health panel meter color at meter minimum",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "health panel meter color at meter maximum",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "health panel meter flash color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "health panel meter empty color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "health panel meter flags",
        type: "HUDInterfaceMeterFlags"
      },
      {
        kind: "field",
        name: "health panel meter minimum meter value",
        type: "int8"
      },
      {
        kind: "field",
        name: "health panel meter sequence index",
        type: "Index"
      },
      {
        kind: "field",
        name: "health panel meter alpha multiplier",
        type: "int8"
      },
      {
        kind: "field",
        name: "health panel meter alpha bias",
        type: "int8"
      },
      {
        kind: "field",
        name: "health panel meter value scale",
        type: "int16"
      },
      {
        kind: "field",
        name: "health panel meter opacity",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "health panel meter translucency",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "health panel meter disabled color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "health panel meter min alpha",
        type: "float",
        maximum: 1
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "health panel meter medium health left color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "health panel meter max color health fraction cutoff",
        type: "float"
      },
      {
        kind: "field",
        name: "health panel meter min color health fraction cutoff",
        type: "float"
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "motion sensor background anchor offset",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "motion sensor background width scale",
        type: "float"
      },
      {
        kind: "field",
        name: "motion sensor background height scale",
        type: "float"
      },
      {
        kind: "field",
        name: "motion sensor background scaling flags",
        type: "HUDInterfaceScalingFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "motion sensor background interface bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "motion sensor background default color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "motion sensor background flashing color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "motion sensor background flash period",
        type: "float"
      },
      {
        kind: "field",
        name: "motion sensor background flash delay",
        type: "float"
      },
      {
        kind: "field",
        name: "motion sensor background number of flashes",
        type: "int16"
      },
      {
        kind: "field",
        name: "motion sensor background flash flags",
        type: "HUDInterfaceFlashFlags"
      },
      {
        kind: "field",
        name: "motion sensor background flash length",
        type: "float"
      },
      {
        kind: "field",
        name: "motion sensor background disabled color",
        type: "ColorARGBInt"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "motion sensor background sequence index",
        type: "Index"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "motion sensor background multitexture overlays",
        type: "TagReflexive",
        struct: "HUDInterfaceMultitextureOverlay",
        maximum: 30
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "motion sensor foreground anchor offset",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "motion sensor foreground width scale",
        type: "float"
      },
      {
        kind: "field",
        name: "motion sensor foreground height scale",
        type: "float"
      },
      {
        kind: "field",
        name: "motion sensor foreground scaling flags",
        type: "HUDInterfaceScalingFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "motion sensor foreground interface bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "motion sensor foreground default color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "motion sensor foreground flashing color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "motion sensor foreground flash period",
        type: "float"
      },
      {
        kind: "field",
        name: "motion sensor foreground flash delay",
        type: "float"
      },
      {
        kind: "field",
        name: "motion sensor foreground number of flashes",
        type: "int16"
      },
      {
        kind: "field",
        name: "motion sensor foreground flash flags",
        type: "HUDInterfaceFlashFlags"
      },
      {
        kind: "field",
        name: "motion sensor foreground flash length",
        type: "float"
      },
      {
        kind: "field",
        name: "motion sensor foreground disabled color",
        type: "ColorARGBInt"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "motion sensor foreground sequence index",
        type: "Index"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "motion sensor foreground multitexture overlays",
        type: "TagReflexive",
        struct: "HUDInterfaceMultitextureOverlay",
        maximum: 30
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "motion sensor center anchor offset",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "motion sensor center width scale",
        type: "float"
      },
      {
        kind: "field",
        name: "motion sensor center height scale",
        type: "float"
      },
      {
        kind: "field",
        name: "motion sensor center scaling flags",
        type: "HUDInterfaceScalingFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "auxiliary overlay anchor",
        type: "HUDInterfaceAnchor"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "overlays",
        type: "TagReflexive",
        struct: "UnitHUDInterfaceAuxiliaryOverlay",
        maximum: 16
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "sounds",
        type: "TagReflexive",
        struct: "UnitHUDInterfaceHUDSound",
        maximum: 12
      },
      {
        kind: "field",
        name: "meters",
        type: "TagReflexive",
        struct: "UnitHUDInterfaceAuxiliaryPanel",
        maximum: 16
      },
      {
        kind: "pad",
        size: 356
      },
      {
        kind: "pad",
        size: 48
      }
    ],
    tagClass: "unit_hud_interface",
    sizeBytes: 1388
  }
];

// ../core/src/map/definitions/groups/vehicle.json
var vehicle_default = [
  {
    kind: "enum",
    name: "VehicleType",
    options: [
      "human tank",
      "human jeep",
      "human boat",
      "human plane",
      "alien scout",
      "alien fighter",
      "turret"
    ]
  },
  {
    kind: "enum",
    name: "VehicleFunctionIn",
    options: [
      "none",
      "speed absolute",
      "speed forward",
      "speed backward",
      "slide absolute",
      "slide left",
      "slide right",
      "speed slide maximum",
      "turn absolute",
      "turn left",
      "turn right",
      "crouch",
      "jump",
      "walk",
      "velocity air",
      "velocity water",
      "velocity ground",
      "velocity forward",
      "velocity left",
      "velocity up",
      "left tread position",
      "right tread position",
      "left tread velocity",
      "right tread velocity",
      "front left tire position",
      "front right tire position",
      "back left tire position",
      "back right tire position",
      "front left tire velocity",
      "front right tire velocity",
      "back left tire velocity",
      "back right tire velocity",
      "wingtip contrail",
      "hover",
      "thrust",
      "engine hack",
      "wingtip contrail new"
    ]
  },
  {
    kind: "bitfield",
    name: "VehicleFlags",
    width: 32,
    fields: [
      "speed wakes physics",
      "turn wakes physics",
      "driver power wakes physics",
      "gunner power wakes physics",
      "control opposite speed sets brake",
      "slide wakes physics",
      "kills riders at terminal velocity",
      "causes collision damage",
      "ai weapon cannot rotate",
      "ai does not require driver",
      "ai unused",
      "ai driver enable",
      "ai driver flying",
      "ai driver can sidestep",
      "ai driver hovering",
      "vehicle steers directly",
      "unused",
      "has ebrake",
      "noncombat vehicle",
      "no friction with driver",
      "can trigger automatic opening doors",
      "autoaim when teamless"
    ]
  },
  {
    kind: "struct",
    name: "Vehicle",
    fields: [
      {
        kind: "field",
        name: "vehicle flags",
        type: "VehicleFlags"
      },
      {
        kind: "field",
        name: "vehicle type",
        type: "VehicleType"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "maximum forward speed",
        type: "float"
      },
      {
        kind: "field",
        name: "maximum reverse speed",
        type: "float"
      },
      {
        kind: "field",
        name: "speed acceleration",
        type: "float"
      },
      {
        kind: "field",
        name: "speed deceleration",
        type: "float"
      },
      {
        kind: "field",
        name: "maximum left turn",
        type: "float"
      },
      {
        kind: "field",
        name: "maximum right turn",
        type: "float"
      },
      {
        kind: "field",
        name: "wheel circumference",
        type: "float"
      },
      {
        kind: "field",
        name: "turn rate",
        type: "float"
      },
      {
        kind: "field",
        name: "blur speed",
        type: "float"
      },
      {
        kind: "field",
        name: "vehicle a in",
        type: "VehicleFunctionIn"
      },
      {
        kind: "field",
        name: "vehicle b in",
        type: "VehicleFunctionIn"
      },
      {
        kind: "field",
        name: "vehicle c in",
        type: "VehicleFunctionIn"
      },
      {
        kind: "field",
        name: "vehicle d in",
        type: "VehicleFunctionIn"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "maximum left slide",
        type: "float"
      },
      {
        kind: "field",
        name: "maximum right slide",
        type: "float"
      },
      {
        kind: "field",
        name: "slide acceleration",
        type: "float"
      },
      {
        kind: "field",
        name: "slide deceleration",
        type: "float"
      },
      {
        kind: "field",
        name: "minimum flipping angular velocity",
        type: "float"
      },
      {
        kind: "field",
        name: "maximum flipping angular velocity",
        type: "float"
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "fixed gun yaw",
        type: "float"
      },
      {
        kind: "field",
        name: "fixed gun pitch",
        type: "float"
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "ai sideslip distance",
        type: "float"
      },
      {
        kind: "field",
        name: "ai destination radius",
        type: "float"
      },
      {
        kind: "field",
        name: "ai avoidance distance",
        type: "float"
      },
      {
        kind: "field",
        name: "ai pathfinding radius",
        type: "float"
      },
      {
        kind: "field",
        name: "ai charge repeat timeout",
        type: "float"
      },
      {
        kind: "field",
        name: "ai strafing abort range",
        type: "float"
      },
      {
        kind: "field",
        name: "ai oversteering bounds",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "ai steering maximum",
        type: "Angle"
      },
      {
        kind: "field",
        name: "ai throttle maximum",
        type: "float"
      },
      {
        kind: "field",
        name: "ai move position time",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "suspension sound",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "crash sound",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "material effects",
        type: "TagDependency",
        classes: [
          "material_effects"
        ]
      },
      {
        kind: "field",
        name: "effect",
        type: "TagDependency",
        classes: [
          "effect"
        ]
      }
    ],
    inherits: "Unit",
    tagClass: "vehicle",
    sizeBytes: 1008
  }
];

// ../core/src/map/definitions/groups/virtual_keyboard.json
var virtual_keyboard_default = [
  {
    kind: "enum",
    name: "VirtualKeyboardKeyboardKey",
    options: [
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "0",
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
      "i",
      "j",
      "k",
      "l",
      "m",
      "n",
      "o",
      "p",
      "q",
      "r",
      "s",
      "t",
      "u",
      "v",
      "w",
      "x",
      "y",
      "z",
      "done",
      "shift",
      "caps lock",
      "symbols",
      "backspace",
      "left",
      "right",
      "space"
    ]
  },
  {
    kind: "struct",
    name: "VirtualKeyboardVirtualKey",
    fields: [
      {
        kind: "field",
        name: "keyboard key",
        type: "VirtualKeyboardKeyboardKey"
      },
      {
        kind: "field",
        name: "lowercase character",
        type: "int16"
      },
      {
        kind: "field",
        name: "shift character",
        type: "int16"
      },
      {
        kind: "field",
        name: "caps character",
        type: "int16"
      },
      {
        kind: "field",
        name: "symbols character",
        type: "int16"
      },
      {
        kind: "field",
        name: "shift caps character",
        type: "int16"
      },
      {
        kind: "field",
        name: "shift symbols character",
        type: "int16"
      },
      {
        kind: "field",
        name: "caps symbols character",
        type: "int16"
      },
      {
        kind: "field",
        name: "unselected background bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "selected background bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "active background bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "sticky background bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      }
    ],
    sizeBytes: 80
  },
  {
    kind: "struct",
    name: "VirtualKeyboard",
    fields: [
      {
        kind: "field",
        name: "display font",
        type: "TagDependency",
        classes: [
          "font"
        ]
      },
      {
        kind: "field",
        name: "background bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "special key labels string list",
        type: "TagDependency",
        classes: [
          "unicode_string_list"
        ]
      },
      {
        kind: "field",
        name: "virtual keys",
        type: "TagReflexive",
        struct: "VirtualKeyboardVirtualKey",
        maximum: 44
      }
    ],
    tagClass: "virtual_keyboard",
    sizeBytes: 60
  }
];

// ../core/src/map/definitions/groups/weapon.json
var weapon_default = [
  {
    kind: "enum",
    name: "WeaponSecondaryTriggerMode",
    options: [
      "normal",
      "slaved to primary",
      "inhibits primary",
      "loads alterate ammunition",
      "loads multiple primary ammunition"
    ]
  },
  {
    kind: "enum",
    name: "WeaponFunctionIn",
    options: [
      "none",
      "heat",
      "primary ammunition",
      "secondary ammunition",
      "primary rate of fire",
      "secondary rate of fire",
      "ready",
      "primary ejection port",
      "secondary ejection port",
      "overheated",
      "primary charged",
      "secondary charged",
      "illumination",
      "age",
      "integrated light",
      "primary firing",
      "secondary firing",
      "primary firing on",
      "secondary firing on"
    ]
  },
  {
    kind: "enum",
    name: "WeaponMovementPenalized",
    options: [
      "always",
      "when zoomed",
      "when zoomed or reloading"
    ]
  },
  {
    kind: "enum",
    name: "WeaponType",
    options: [
      "undefined",
      "shotgun",
      "needler",
      "plasma pistol",
      "plasma rifle",
      "rocket launcher"
    ]
  },
  {
    kind: "enum",
    name: "WeaponPredictionType",
    options: [
      "none",
      "continuous",
      "instant"
    ]
  },
  {
    kind: "enum",
    name: "WeaponOverchargedAction",
    options: [
      "none",
      "explode",
      "discharge"
    ]
  },
  {
    kind: "enum",
    name: "WeaponDistributionFunction",
    options: [
      "point",
      "horizontal fan"
    ]
  },
  {
    kind: "bitfield",
    name: "WeaponMagazineFlags",
    width: 32,
    fields: [
      "wastes rounds when reloaded",
      "every round must be chambered"
    ]
  },
  {
    kind: "bitfield",
    name: "WeaponTriggerFlags",
    width: 32,
    fields: [
      "tracks fired projectile",
      "random firing effects",
      "can fire with partial ammo",
      "does not repeat automatically",
      "locks in on off state",
      "projectiles use weapon origin",
      "sticks when dropped",
      "ejects during chamber",
      "discharging spews",
      "analog rate of fire",
      "use error when unzoomed",
      "projectile vector cannot be adjusted",
      "projectiles have identical error",
      "projectile is client side only",
      "use original unit adjust projectile ray"
    ]
  },
  {
    kind: "bitfield",
    name: "WeaponFlags",
    width: 32,
    fields: [
      "vertical heat display",
      "mutually exclusive triggers",
      "attacks automatically on bump",
      "must be readied",
      "doesn't count toward maximum",
      "aim assists only when zoomed",
      "prevents grenade throwing",
      "must be picked up",
      "holds triggers when dropped",
      "prevents melee attack",
      "detonates when dropped",
      "cannot fire at maximum age",
      "secondary trigger overrides grenades",
      "does not depower active camo in multilplayer",
      "enables integrated night vision",
      "ais use weapon melee damage",
      "prevents crouching",
      "uses 3rd person camera"
    ]
  },
  {
    kind: "struct",
    name: "WeaponMagazineObject",
    fields: [
      {
        kind: "field",
        name: "rounds",
        type: "int16"
      },
      {
        kind: "pad",
        size: 10
      },
      {
        kind: "field",
        name: "equipment",
        type: "TagDependency",
        classes: [
          "equipment"
        ]
      }
    ],
    sizeBytes: 28
  },
  {
    kind: "struct",
    name: "WeaponMagazine",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "WeaponMagazineFlags"
      },
      {
        kind: "field",
        name: "rounds recharged",
        type: "int16"
      },
      {
        kind: "field",
        name: "rounds total initial",
        type: "int16",
        comment: "includes loaded ammo"
      },
      {
        kind: "field",
        name: "rounds reserved maximum",
        type: "int16",
        comment: "does not include loaded ammo"
      },
      {
        kind: "field",
        name: "rounds loaded maximum",
        type: "int16"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "reload time",
        type: "float"
      },
      {
        kind: "field",
        name: "rounds reloaded",
        type: "int16"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "chamber time",
        type: "float"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "reloading effect",
        type: "TagDependency",
        classes: [
          "sound",
          "effect"
        ]
      },
      {
        kind: "field",
        name: "chambering effect",
        type: "TagDependency",
        classes: [
          "sound",
          "effect"
        ]
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "magazine objects",
        type: "TagReflexive",
        struct: "WeaponMagazineObject",
        maximum: 8
      }
    ],
    sizeBytes: 112
  },
  {
    kind: "struct",
    name: "WeaponTriggerFiringEffect",
    fields: [
      {
        kind: "field",
        name: "shot count lower bound",
        type: "int16"
      },
      {
        kind: "field",
        name: "shot count upper bound",
        type: "int16"
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "firing effect",
        type: "TagDependency",
        classes: [
          "sound",
          "effect"
        ]
      },
      {
        kind: "field",
        name: "misfire effect",
        type: "TagDependency",
        classes: [
          "sound",
          "effect"
        ]
      },
      {
        kind: "field",
        name: "empty effect",
        type: "TagDependency",
        classes: [
          "sound",
          "effect"
        ]
      },
      {
        kind: "field",
        name: "firing damage",
        type: "TagDependency",
        classes: [
          "damage_effect"
        ]
      },
      {
        kind: "field",
        name: "misfire damage",
        type: "TagDependency",
        classes: [
          "damage_effect"
        ]
      },
      {
        kind: "field",
        name: "empty damage",
        type: "TagDependency",
        classes: [
          "damage_effect"
        ]
      }
    ],
    sizeBytes: 132
  },
  {
    kind: "struct",
    name: "WeaponTrigger",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "WeaponTriggerFlags"
      },
      {
        kind: "field",
        name: "maximum rate of fire",
        type: "float",
        bounds: true,
        comment: "This determines the maximum number of times this trigger can be fired per second.\nThe first value is initial rate of fire and the second value is the final rate of fire.\nWeapons cannot fire faster than once per tick, and non-positive (0 or less) rate of fire results in firing once per tick.\nBecause weapons cannot fire in between ticks, fire rate is also effectively rounded down to the nearest tickrate/n for any positive integer n (so at 30 ticks per second: 30, 15, 10, 7.5, 6, 5, 4.288, 3.75, 3.333, 3, etc.)"
      },
      {
        kind: "field",
        name: "acceleration time",
        type: "float",
        comment: "This is the number of seconds required to hold the trigger in order to reach the final rate of fire.\n0 acceleration time means the trigger will always use the final rate of fire."
      },
      {
        kind: "field",
        name: "deceleration time",
        type: "float",
        comment: "This is the number of seconds required to release the trigger in order to reach the initial rate of fire.\n0 deceleration time means the trigger will revert to the initial rate of fire the moment the trigger is released."
      },
      {
        kind: "field",
        name: "blurred rate of fire",
        type: "Fraction"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "magazine",
        type: "Index",
        struct: "Weapon",
        comment: "This is the index of the magazine used for drawing ammunition for this trigger.\nIf no magazine is given (null), then the weapon effectively has an unlimited amount of rounds."
      },
      {
        kind: "field",
        name: "rounds per shot",
        type: "int16",
        comment: 'This is the amount of ammo each trigger fire uses.\nUnless the "can fire with partial ammo" flag is set, the trigger cannot be fired if there is less than this much ammo remaining and will, instead, reload automatically.\nFiring with partial ammo with the partial ammo flag will result in the loaded ammo reaching 0 rather than a negative amount.\nA negative value results in the magazine gaining loaded rounds upon firing.'
      },
      {
        kind: "field",
        name: "minimum rounds loaded",
        type: "int16",
        comment: 'The magazine will automatically reload if less than this much ammo remains in the magazine, and the weapon cannot fire unless this much ammo is loaded.\nUnlike "rounds per shot", this ignores the "can fire with partial ammo" flag.'
      },
      {
        kind: "field",
        name: "projectiles between contrails",
        type: "int16",
        comment: "Contrails will not be created until this many projectiles have been fired.\nThis resets every time the trigger is released, and the first projectile will always have a contrail."
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "prediction type",
        type: "WeaponPredictionType",
        comment: "behavior of the trigger in a network predicted game."
      },
      {
        kind: "field",
        name: "firing noise",
        type: "ObjectNoise",
        comment: "This determines how AI will respond to the trigger being fired, if at all."
      },
      {
        kind: "field",
        name: "error",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "error acceleration time",
        type: "float"
      },
      {
        kind: "field",
        name: "error deceleration time",
        type: "float"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "charging time",
        type: "float"
      },
      {
        kind: "field",
        name: "charged time",
        type: "float"
      },
      {
        kind: "field",
        name: "overcharged action",
        type: "WeaponOverchargedAction"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "charged illumination",
        type: "float"
      },
      {
        kind: "field",
        name: "spew time",
        type: "float"
      },
      {
        kind: "field",
        name: "charging effect",
        type: "TagDependency",
        classes: [
          "sound",
          "effect"
        ]
      },
      {
        kind: "field",
        name: "distribution function",
        type: "WeaponDistributionFunction"
      },
      {
        kind: "field",
        name: "projectiles per shot",
        type: "int16",
        comment: "This is the number of projectiles that spawn when the trigger is fired."
      },
      {
        kind: "field",
        name: "distribution angle",
        type: "Angle"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "minimum error",
        type: "Angle"
      },
      {
        kind: "field",
        name: "error angle",
        type: "Angle",
        bounds: true,
        comment: "This determines the maximum angle the projectile can deviate from the first person camera.\nThe first value is the initial error angle and the second value is the final error angle. "
      },
      {
        kind: "field",
        name: "first person offset",
        type: "Point3D",
        comment: "This is the relative offset from the first person camera the projectile spawns.\nX is front (+) and back (-), Y is left (+) and right (-), Z is up (+) and down (-)."
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "projectile",
        type: "TagDependency",
        classes: [
          "projectile"
        ],
        comment: "This is the object that spawns when firing the weapon.\nThe object will spawn facing the same direction as the first person camera (along with any error angle applied, if necessary) with the velocity of the shooter."
      },
      {
        kind: "field",
        name: "ejection port recovery time",
        type: "float"
      },
      {
        kind: "field",
        name: "illumination recovery time",
        type: "float"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "heat generated per round",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "age generated per round",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "overload time",
        type: "float"
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "illumination recovery rate",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "ejection port recovery rate",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "firing acceleration rate",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "firing deceleration rate",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "error acceleration rate",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "error deceleration rate",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "field",
        name: "firing effects",
        type: "TagReflexive",
        struct: "WeaponTriggerFiringEffect",
        maximum: 8
      }
    ],
    sizeBytes: 276
  },
  {
    kind: "struct",
    name: "Weapon",
    fields: [
      {
        kind: "field",
        name: "weapon flags",
        type: "WeaponFlags"
      },
      {
        kind: "field",
        name: "label",
        type: "TagString",
        comment: "Units that have this label in their animations will be able to pick up the weapon"
      },
      {
        kind: "field",
        name: "secondary trigger mode",
        type: "WeaponSecondaryTriggerMode"
      },
      {
        kind: "field",
        name: "maximum alternate shots loaded",
        type: "int16"
      },
      {
        kind: "field",
        name: "weapon a in",
        type: "WeaponFunctionIn"
      },
      {
        kind: "field",
        name: "weapon b in",
        type: "WeaponFunctionIn"
      },
      {
        kind: "field",
        name: "weapon c in",
        type: "WeaponFunctionIn"
      },
      {
        kind: "field",
        name: "weapon d in",
        type: "WeaponFunctionIn"
      },
      {
        kind: "field",
        name: "ready time",
        type: "float"
      },
      {
        kind: "field",
        name: "ready effect",
        type: "TagDependency",
        classes: [
          "sound",
          "effect"
        ]
      },
      {
        kind: "field",
        name: "heat recovery threshold",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "overheated threshold",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "heat detonation threshold",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "heat detonation fraction",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "heat loss rate",
        type: "Fraction"
      },
      {
        kind: "field",
        name: "heat illumination",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "overheated",
        type: "TagDependency",
        classes: [
          "sound",
          "effect"
        ]
      },
      {
        kind: "field",
        name: "overheat detonation",
        type: "TagDependency",
        classes: [
          "sound",
          "effect"
        ],
        comment: "This effect is played when the weapon overheats and is set to detonate as a result"
      },
      {
        kind: "field",
        name: "player melee damage",
        type: "TagDependency",
        classes: [
          "damage_effect"
        ]
      },
      {
        kind: "field",
        name: "player melee response",
        type: "TagDependency",
        classes: [
          "damage_effect"
        ]
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "actor firing parameters",
        type: "TagDependency",
        classes: [
          "actor_variant"
        ]
      },
      {
        kind: "field",
        name: "near reticle range",
        type: "float"
      },
      {
        kind: "field",
        name: "far reticle range",
        type: "float"
      },
      {
        kind: "field",
        name: "intersection reticle range",
        type: "float"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "zoom levels",
        type: "int16"
      },
      {
        kind: "field",
        name: "zoom magnification range",
        type: "float",
        bounds: true,
        comment: "Minimum is the magnification amount for the first zoom level, and maximum is the magnification amount for the final zoom level"
      },
      {
        kind: "field",
        name: "autoaim angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "autoaim range",
        type: "float"
      },
      {
        kind: "field",
        name: "magnetism angle",
        type: "Angle"
      },
      {
        kind: "field",
        name: "magnetism range",
        type: "float"
      },
      {
        kind: "field",
        name: "deviation angle",
        type: "Angle"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "movement penalized",
        type: "WeaponMovementPenalized"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "forward movement penalty",
        type: "Fraction"
      },
      {
        kind: "field",
        name: "sideways movement penalty",
        type: "Fraction"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "minimum target range",
        type: "float"
      },
      {
        kind: "field",
        name: "looking time modifier",
        type: "float"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "light power on time",
        type: "float"
      },
      {
        kind: "field",
        name: "light power off time",
        type: "float"
      },
      {
        kind: "field",
        name: "light power on effect",
        type: "TagDependency",
        classes: [
          "sound",
          "effect"
        ]
      },
      {
        kind: "field",
        name: "light power off effect",
        type: "TagDependency",
        classes: [
          "sound",
          "effect"
        ]
      },
      {
        kind: "field",
        name: "age heat recovery penalty",
        type: "float"
      },
      {
        kind: "field",
        name: "age rate of fire penalty",
        type: "float"
      },
      {
        kind: "field",
        name: "age misfire start",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "age misfire chance",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "first person model",
        type: "TagDependency",
        classes: [
          "model"
        ]
      },
      {
        kind: "field",
        name: "first person animations",
        type: "TagDependency",
        classes: [
          "model_animations"
        ]
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "hud interface",
        type: "TagDependency",
        classes: [
          "weapon_hud_interface"
        ]
      },
      {
        kind: "field",
        name: "pickup sound",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "zoom in sound",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "field",
        name: "zoom out sound",
        type: "TagDependency",
        classes: [
          "sound"
        ]
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "active camo ding",
        type: "float"
      },
      {
        kind: "field",
        name: "active camo regrowth rate",
        type: "float"
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "weapon type",
        type: "WeaponType"
      },
      {
        kind: "field",
        name: "more predicted resources",
        type: "TagReflexive",
        struct: "PredictedResource",
        maximum: 1024,
        cacheOnly: true
      },
      {
        kind: "field",
        name: "magazines",
        type: "TagReflexive",
        struct: "WeaponMagazine",
        maximum: 2
      },
      {
        kind: "field",
        name: "triggers",
        type: "TagReflexive",
        struct: "WeaponTrigger",
        maximum: 2
      }
    ],
    inherits: "Item",
    tagClass: "weapon",
    sizeBytes: 1288
  }
];

// ../core/src/map/definitions/groups/weapon_hud_interface.json
var weapon_hud_interface_default = [
  {
    kind: "enum",
    name: "WeaponHUDInterfaceStateAttachedTo",
    options: [
      "total ammo",
      "loaded ammo",
      "heat",
      "age",
      "secondary weapon total ammo",
      "secondary weapon loaded ammo",
      "distance to target",
      "elevation to target"
    ]
  },
  {
    kind: "enum",
    name: "WeaponHUDInterfaceViewType",
    options: [
      "any",
      "fullscreen",
      "splitscreen"
    ]
  },
  {
    kind: "enum",
    name: "WeaponHUDInterfaceCrosshairType",
    options: [
      "aim",
      "zoom overlay",
      "charge",
      "should reload",
      "flash heat",
      "flash total ammo",
      "flash battery",
      "reload overheat",
      "flash when firing and no ammo",
      "flash when throwing and no grenade",
      "low ammo and none left to reload",
      "should reload secondary trigger",
      "flash secondary total ammo",
      "flash secondary reload",
      "flash when firing secondary trigger with no ammo",
      "low secondary ammo and none left to reload",
      "primary trigger ready",
      "secondary trigger ready",
      "flash when firing with depleted battery"
    ]
  },
  {
    kind: "bitfield",
    name: "WeaponHUDInterfaceCrosshairTypeFlags",
    width: 32,
    fields: [
      "aim",
      "zoom overlay",
      "charge",
      "should reload",
      "flash heat",
      "flash total ammo",
      "flash battery",
      "reload overheat",
      "flash when firing and no ammo",
      "flash when throwing and no grenade",
      "low ammo and none left to reload",
      "should reload secondary trigger",
      "flash secondary total ammo",
      "flash secondary reload",
      "flash when firing secondary trigger with no ammo",
      "low secondary ammo and none left to reload",
      "primary trigger ready",
      "secondary trigger ready",
      "flash when firing with depleted battery"
    ]
  },
  {
    kind: "bitfield",
    name: "WeaponHUDInterfaceNumberWeaponSpecificFlags",
    width: 16,
    fields: [
      "divide number by clip size"
    ]
  },
  {
    kind: "bitfield",
    name: "WeaponHUDInterfaceCrosshairOverlayFlags",
    width: 32,
    fields: [
      "flashes when active",
      "not a sprite",
      "show only when zoomed",
      "show sniper data",
      "hide area outside reticle",
      "one zoom level",
      "don't show when zoomed"
    ]
  },
  {
    kind: "bitfield",
    name: "WeaponHUDInterfaceOverlayType",
    width: 16,
    fields: [
      "show on flashing",
      "show on empty",
      "show on reload overheating",
      "show on default",
      "show always"
    ]
  },
  {
    kind: "bitfield",
    name: "WeaponHUDInterfaceScreenEffectDefinitionMaskFlags",
    width: 16,
    fields: [
      "only when zoomed"
    ]
  },
  {
    kind: "bitfield",
    name: "WeaponHUDInterfaceScreenEffectDefinitionNightVisionFlags",
    width: 16,
    fields: [
      "only when zoomed",
      "connect to flashlight",
      "masked"
    ]
  },
  {
    kind: "bitfield",
    name: "WeaponHUDInterfaceScreenEffectDefinitionDesaturationFlags",
    width: 16,
    fields: [
      "only when zoomed",
      "connect to flashlight",
      "additive",
      "masked"
    ]
  },
  {
    kind: "bitfield",
    name: "WeaponHUDInterfaceFlags",
    width: 16,
    fields: [
      "use parent hud flashing parameters"
    ]
  },
  {
    kind: "struct",
    name: "WeaponHUDInterfaceStaticElement",
    fields: [
      {
        kind: "field",
        name: "state attached to",
        type: "WeaponHUDInterfaceStateAttachedTo"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "allowed view type",
        type: "WeaponHUDInterfaceViewType"
      },
      {
        kind: "field",
        name: "anchor",
        type: "HUDInterfaceChildAnchor"
      },
      {
        kind: "pad",
        size: 28
      },
      {
        kind: "field",
        name: "anchor offset",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "width scale",
        type: "float"
      },
      {
        kind: "field",
        name: "height scale",
        type: "float"
      },
      {
        kind: "field",
        name: "scaling flags",
        type: "HUDInterfaceScalingFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "interface bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "default color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "flashing color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "flash period",
        type: "float"
      },
      {
        kind: "field",
        name: "flash delay",
        type: "float"
      },
      {
        kind: "field",
        name: "number of flashes",
        type: "int16"
      },
      {
        kind: "field",
        name: "flash flags",
        type: "HUDInterfaceFlashFlags"
      },
      {
        kind: "field",
        name: "flash length",
        type: "float"
      },
      {
        kind: "field",
        name: "disabled color",
        type: "ColorARGBInt"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "sequence index",
        type: "Index"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "multitexture overlays",
        type: "TagReflexive",
        struct: "HUDInterfaceMultitextureOverlay",
        maximum: 30
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "pad",
        size: 40
      }
    ],
    sizeBytes: 180
  },
  {
    kind: "struct",
    name: "WeaponHUDInterfaceMeter",
    fields: [
      {
        kind: "field",
        name: "state attached to",
        type: "WeaponHUDInterfaceStateAttachedTo"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "allowed view type",
        type: "WeaponHUDInterfaceViewType"
      },
      {
        kind: "field",
        name: "anchor",
        type: "HUDInterfaceChildAnchor"
      },
      {
        kind: "pad",
        size: 28
      },
      {
        kind: "field",
        name: "anchor offset",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "width scale",
        type: "float"
      },
      {
        kind: "field",
        name: "height scale",
        type: "float"
      },
      {
        kind: "field",
        name: "scaling flags",
        type: "HUDInterfaceScalingFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "meter bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "color at meter minimum",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "color at meter maximum",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "flash color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "empty color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "flags",
        type: "HUDInterfaceMeterFlags"
      },
      {
        kind: "field",
        name: "minimum meter value",
        type: "int8"
      },
      {
        kind: "field",
        name: "sequence index",
        type: "Index"
      },
      {
        kind: "field",
        name: "alpha multiplier",
        type: "int8"
      },
      {
        kind: "field",
        name: "alpha bias",
        type: "int8"
      },
      {
        kind: "field",
        name: "value scale",
        type: "int16"
      },
      {
        kind: "field",
        name: "opacity",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "translucency",
        type: "float",
        maximum: 1
      },
      {
        kind: "field",
        name: "disabled color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "min alpha",
        type: "float",
        maximum: 1
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "pad",
        size: 40
      }
    ],
    sizeBytes: 180
  },
  {
    kind: "struct",
    name: "WeaponHUDInterfaceNumber",
    fields: [
      {
        kind: "field",
        name: "state attached to",
        type: "WeaponHUDInterfaceStateAttachedTo"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "allowed view type",
        type: "WeaponHUDInterfaceViewType"
      },
      {
        kind: "field",
        name: "anchor",
        type: "HUDInterfaceChildAnchor"
      },
      {
        kind: "pad",
        size: 28
      },
      {
        kind: "field",
        name: "anchor offset",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "width scale",
        type: "float"
      },
      {
        kind: "field",
        name: "height scale",
        type: "float"
      },
      {
        kind: "field",
        name: "scaling flags",
        type: "HUDInterfaceScalingFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "default color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "flashing color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "flash period",
        type: "float"
      },
      {
        kind: "field",
        name: "flash delay",
        type: "float"
      },
      {
        kind: "field",
        name: "number of flashes",
        type: "int16"
      },
      {
        kind: "field",
        name: "flash flags",
        type: "HUDInterfaceFlashFlags"
      },
      {
        kind: "field",
        name: "flash length",
        type: "float"
      },
      {
        kind: "field",
        name: "disabled color",
        type: "ColorARGBInt"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "maximum number of digits",
        type: "int8"
      },
      {
        kind: "field",
        name: "flags",
        type: "HUDInterfaceNumberFlags"
      },
      {
        kind: "field",
        name: "number of fractional digits",
        type: "int8"
      },
      {
        kind: "pad",
        size: 1
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "weapon specific flags",
        type: "WeaponHUDInterfaceNumberWeaponSpecificFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 36
      }
    ],
    sizeBytes: 160
  },
  {
    kind: "struct",
    name: "WeaponHUDInterfaceCrosshairOverlay",
    fields: [
      {
        kind: "field",
        name: "anchor offset",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "width scale",
        type: "float"
      },
      {
        kind: "field",
        name: "height scale",
        type: "float"
      },
      {
        kind: "field",
        name: "scaling flags",
        type: "HUDInterfaceScalingFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "default color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "flashing color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "flash period",
        type: "float"
      },
      {
        kind: "field",
        name: "flash delay",
        type: "float"
      },
      {
        kind: "field",
        name: "number of flashes",
        type: "int16"
      },
      {
        kind: "field",
        name: "flash flags",
        type: "HUDInterfaceFlashFlags"
      },
      {
        kind: "field",
        name: "flash length",
        type: "float"
      },
      {
        kind: "field",
        name: "disabled color",
        type: "ColorARGBInt"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "frame rate",
        type: "int16"
      },
      {
        kind: "field",
        name: "sequence index",
        type: "Index"
      },
      {
        kind: "field",
        name: "flags",
        type: "WeaponHUDInterfaceCrosshairOverlayFlags"
      },
      {
        kind: "pad",
        size: 32
      }
    ],
    sizeBytes: 108
  },
  {
    kind: "struct",
    name: "WeaponHUDInterfaceCrosshair",
    fields: [
      {
        kind: "field",
        name: "crosshair type",
        type: "WeaponHUDInterfaceCrosshairType"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "allowed view type",
        type: "WeaponHUDInterfaceViewType"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 28
      },
      {
        kind: "field",
        name: "crosshair bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "crosshair overlays",
        type: "TagReflexive",
        struct: "WeaponHUDInterfaceCrosshairOverlay",
        maximum: 16
      },
      {
        kind: "pad",
        size: 40
      }
    ],
    sizeBytes: 104
  },
  {
    kind: "struct",
    name: "WeaponHUDInterfaceOverlay",
    fields: [
      {
        kind: "field",
        name: "anchor offset",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "width scale",
        type: "float"
      },
      {
        kind: "field",
        name: "height scale",
        type: "float"
      },
      {
        kind: "field",
        name: "scaling flags",
        type: "HUDInterfaceScalingFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 20
      },
      {
        kind: "field",
        name: "default color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "flashing color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "flash period",
        type: "float"
      },
      {
        kind: "field",
        name: "flash delay",
        type: "float"
      },
      {
        kind: "field",
        name: "number of flashes",
        type: "int16"
      },
      {
        kind: "field",
        name: "flash flags",
        type: "HUDInterfaceFlashFlags"
      },
      {
        kind: "field",
        name: "flash length",
        type: "float"
      },
      {
        kind: "field",
        name: "disabled color",
        type: "ColorARGBInt"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "frame rate",
        type: "int16"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "sequence index",
        type: "Index"
      },
      {
        kind: "field",
        name: "type",
        type: "WeaponHUDInterfaceOverlayType"
      },
      {
        kind: "field",
        name: "flags",
        type: "HUDInterfaceOverlayFlashFlags"
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "pad",
        size: 40
      }
    ],
    sizeBytes: 136
  },
  {
    kind: "struct",
    name: "WeaponHUDInterfaceOverlayElement",
    fields: [
      {
        kind: "field",
        name: "state attached to",
        type: "WeaponHUDInterfaceStateAttachedTo"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "allowed view type",
        type: "WeaponHUDInterfaceViewType"
      },
      {
        kind: "field",
        name: "anchor",
        type: "HUDInterfaceChildAnchor"
      },
      {
        kind: "pad",
        size: 28
      },
      {
        kind: "field",
        name: "overlay bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "overlays",
        type: "TagReflexive",
        struct: "WeaponHUDInterfaceOverlay",
        maximum: 16
      },
      {
        kind: "pad",
        size: 40
      }
    ],
    sizeBytes: 104
  },
  {
    kind: "struct",
    name: "WeaponHUDInterfaceScreenEffect",
    fields: [
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "mask flags",
        type: "WeaponHUDInterfaceScreenEffectDefinitionMaskFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "mask fullscreen",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "mask splitscreen",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "pad",
        size: 8
      },
      {
        kind: "field",
        name: "convolution flags",
        type: "WeaponHUDInterfaceScreenEffectDefinitionMaskFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "convolution fov in bounds",
        type: "Angle",
        bounds: true
      },
      {
        kind: "field",
        name: "convolution radius out bounds",
        type: "float",
        bounds: true
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "even more flags",
        type: "WeaponHUDInterfaceScreenEffectDefinitionNightVisionFlags"
      },
      {
        kind: "field",
        name: "night vision script source",
        type: "int16"
      },
      {
        kind: "field",
        name: "night vision intensity",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "pad",
        size: 24
      },
      {
        kind: "field",
        name: "desaturation flags",
        type: "WeaponHUDInterfaceScreenEffectDefinitionDesaturationFlags"
      },
      {
        kind: "field",
        name: "desaturation script source",
        type: "int16"
      },
      {
        kind: "field",
        name: "desaturation intensity",
        type: "Fraction",
        maximum: 1
      },
      {
        kind: "field",
        name: "effect tint",
        type: "ColorRGB"
      },
      {
        kind: "pad",
        size: 24
      }
    ],
    sizeBytes: 184
  },
  {
    kind: "struct",
    name: "WeaponHUDInterface",
    fields: [
      {
        kind: "field",
        name: "child hud",
        type: "TagDependency",
        classes: [
          "weapon_hud_interface"
        ]
      },
      {
        kind: "field",
        name: "flags",
        type: "WeaponHUDInterfaceFlags"
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "total ammo cutoff",
        type: "int16"
      },
      {
        kind: "field",
        name: "loaded ammo cutoff",
        type: "int16"
      },
      {
        kind: "field",
        name: "heat cutoff",
        type: "int16"
      },
      {
        kind: "field",
        name: "age cutoff",
        type: "int16"
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "anchor",
        type: "HUDInterfaceAnchor"
      },
      {
        kind: "field",
        name: "canvas size",
        type: "HUDInterfaceCanvasSize"
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "static elements",
        type: "TagReflexive",
        struct: "WeaponHUDInterfaceStaticElement",
        maximum: 16
      },
      {
        kind: "field",
        name: "meter elements",
        type: "TagReflexive",
        struct: "WeaponHUDInterfaceMeter",
        maximum: 16
      },
      {
        kind: "field",
        name: "number elements",
        type: "TagReflexive",
        struct: "WeaponHUDInterfaceNumber",
        maximum: 16
      },
      {
        kind: "field",
        name: "crosshairs",
        type: "TagReflexive",
        struct: "WeaponHUDInterfaceCrosshair",
        maximum: 19
      },
      {
        kind: "field",
        name: "overlay elements",
        type: "TagReflexive",
        struct: "WeaponHUDInterfaceOverlayElement",
        maximum: 16
      },
      {
        kind: "field",
        name: "crosshair types",
        type: "WeaponHUDInterfaceCrosshairTypeFlags",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 12
      },
      {
        kind: "field",
        name: "screen effect",
        type: "TagReflexive",
        struct: "WeaponHUDInterfaceScreenEffect",
        maximum: 1
      },
      {
        kind: "pad",
        size: 132
      },
      {
        kind: "field",
        name: "messaging information sequence index",
        type: "Index"
      },
      {
        kind: "field",
        name: "messaging information width offset",
        type: "int16"
      },
      {
        kind: "field",
        name: "messaging information offset from reference corner",
        type: "Point2DInt"
      },
      {
        kind: "field",
        name: "messaging information override icon color",
        type: "ColorARGBInt"
      },
      {
        kind: "field",
        name: "messaging information frame rate",
        type: "int8"
      },
      {
        kind: "field",
        name: "messaging information flags",
        type: "HUDInterfaceMessagingFlags"
      },
      {
        kind: "field",
        name: "messaging information text index",
        type: "Index"
      },
      {
        kind: "pad",
        size: 48
      }
    ],
    tagClass: "weapon_hud_interface",
    sizeBytes: 380
  }
];

// ../core/src/map/definitions/groups/weather_particle_system.json
var weather_particle_system_default = [
  {
    kind: "enum",
    name: "WeatherParticleSystemRenderDirectionSource",
    options: [
      "from velocity",
      "from acceleration"
    ]
  },
  {
    kind: "bitfield",
    name: "WeatherParticleSystemParticleTypeFlags",
    width: 32,
    fields: [
      "interpolate colors in hsv",
      "along long hue path",
      "random rotation"
    ]
  },
  {
    kind: "struct",
    name: "WeatherParticleSystemParticleType",
    fields: [
      {
        kind: "field",
        name: "name",
        type: "TagString"
      },
      {
        kind: "field",
        name: "flags",
        type: "WeatherParticleSystemParticleTypeFlags"
      },
      {
        kind: "field",
        name: "fade in start distance",
        type: "float"
      },
      {
        kind: "field",
        name: "fade in end distance",
        type: "float"
      },
      {
        kind: "field",
        name: "fade out start distance",
        type: "float"
      },
      {
        kind: "field",
        name: "fade out end distance",
        type: "float"
      },
      {
        kind: "field",
        name: "fade in start height",
        type: "float"
      },
      {
        kind: "field",
        name: "fade in end height",
        type: "float"
      },
      {
        kind: "field",
        name: "fade out start height",
        type: "float"
      },
      {
        kind: "field",
        name: "fade out end height",
        type: "float"
      },
      {
        kind: "pad",
        size: 96
      },
      {
        kind: "field",
        name: "particle count",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "physics",
        type: "TagDependency",
        classes: [
          "point_physics"
        ]
      },
      {
        kind: "pad",
        size: 16
      },
      {
        kind: "field",
        name: "acceleration magnitude",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "acceleration turning rate",
        type: "Fraction"
      },
      {
        kind: "field",
        name: "acceleration change rate",
        type: "float"
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "particle radius",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "animation rate",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "rotation rate",
        type: "Angle",
        bounds: true
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "color lower bound",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "color upper bound",
        type: "ColorARGB"
      },
      {
        kind: "field",
        name: "sprite size",
        type: "float",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 60
      },
      {
        kind: "field",
        name: "sprite bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "render mode",
        type: "ParticleOrientation"
      },
      {
        kind: "field",
        name: "render direction source",
        type: "WeatherParticleSystemRenderDirectionSource"
      },
      {
        kind: "pad",
        size: 36
      },
      {
        kind: "field",
        name: "shader type",
        type: "ShaderType",
        cacheOnly: true
      },
      {
        kind: "pad",
        size: 2
      },
      {
        kind: "field",
        name: "shader flags",
        type: "ParticleShaderFlags"
      },
      {
        kind: "field",
        name: "framebuffer blend function",
        type: "FramebufferBlendFunction"
      },
      {
        kind: "field",
        name: "framebuffer fade mode",
        type: "FramebufferFadeMode"
      },
      {
        kind: "field",
        name: "bitmap flags",
        type: "IsUnfilteredFlag"
      },
      {
        kind: "pad",
        size: 28
      },
      {
        kind: "field",
        name: "secondary bitmap",
        type: "TagDependency",
        classes: [
          "bitmap"
        ]
      },
      {
        kind: "field",
        name: "anchor",
        type: "ParticleAnchor"
      },
      {
        kind: "field",
        name: "secondary bitmap flags",
        type: "IsUnfilteredFlag"
      },
      {
        kind: "field",
        name: "u animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "u animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "u animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "u animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "u animation scale",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "v animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "v animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "v animation scale",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation source",
        type: "FunctionOut"
      },
      {
        kind: "field",
        name: "rotation animation function",
        type: "WaveFunction"
      },
      {
        kind: "field",
        name: "rotation animation period",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation phase",
        type: "float"
      },
      {
        kind: "field",
        name: "rotation animation scale",
        type: "Angle"
      },
      {
        kind: "field",
        name: "rotation animation center",
        type: "Point2D"
      },
      {
        kind: "pad",
        size: 4
      },
      {
        kind: "field",
        name: "zsprite radius scale",
        type: "float"
      },
      {
        kind: "pad",
        size: 20
      }
    ],
    sizeBytes: 604
  },
  {
    kind: "struct",
    name: "WeatherParticleSystem",
    fields: [
      {
        kind: "field",
        name: "flags",
        type: "IsUnusedFlag"
      },
      {
        kind: "pad",
        size: 32
      },
      {
        kind: "field",
        name: "particle types",
        type: "TagReflexive",
        struct: "WeatherParticleSystemParticleType",
        maximum: 8
      }
    ],
    tagClass: "weather_particle_system",
    sizeBytes: 48
  }
];

// ../core/src/map/definitions/groups/wind.json
var wind_default = [
  {
    kind: "struct",
    name: "Wind",
    fields: [
      {
        kind: "field",
        name: "velocity",
        type: "float",
        bounds: true
      },
      {
        kind: "field",
        name: "variation area",
        type: "Euler2D"
      },
      {
        kind: "field",
        name: "local variation weight",
        type: "float"
      },
      {
        kind: "field",
        name: "local variation rate",
        type: "float"
      },
      {
        kind: "field",
        name: "damping",
        type: "float"
      },
      {
        kind: "pad",
        size: 36
      }
    ],
    tagClass: "wind",
    sizeBytes: 64
  }
];

// ../core/src/map/definitions/definitions-index.ts
var ALL_DEFINITION_FILES = [
  actor_default,
  actor_variant_default,
  antenna_default,
  biped_default,
  bitfield_default,
  bitmap_default,
  camera_track_default,
  color_table_default,
  continuous_damage_effect_default,
  contrail_default,
  damage_effect_default,
  decal_default,
  detail_object_collection_default,
  device_default,
  device_control_default,
  device_light_fixture_default,
  device_machine_default,
  dialogue_default,
  effect_default,
  enum_default,
  equipment_default,
  flag_default,
  fog_default,
  font_default,
  garbage_default,
  gbxmodel_default,
  globals_default,
  glow_default,
  grenade_hud_interface_default,
  hud_globals_default,
  hud_interface_types_default,
  hud_message_text_default,
  hud_number_default,
  input_device_defaults_default,
  item_default,
  item_collection_default,
  lens_flare_default,
  light_default,
  light_volume_default,
  lightning_default,
  material_effects_default,
  meter_default,
  model_default,
  model_animations_default,
  model_collision_geometry_default,
  multiplayer_scenario_description_default,
  object_default,
  particle_default,
  particle_system_default,
  physics_default,
  placeholder_default,
  point_physics_default,
  preferences_network_game_default,
  projectile_default,
  scenario_default,
  scenario_structure_bsp_default,
  scenery_default,
  shader_default,
  shader_environment_default,
  shader_model_default,
  shader_transparent_chicago_default,
  shader_transparent_chicago_extended_default,
  shader_transparent_generic_default,
  shader_transparent_glass_default,
  shader_transparent_meter_default,
  shader_transparent_plasma_default,
  shader_transparent_water_default,
  sky_default,
  sound_default,
  sound_environment_default,
  sound_looping_default,
  sound_scenery_default,
  spheroid_default,
  string_list_default,
  tag_collection_default,
  ui_widget_collection_default,
  ui_widget_definition_default,
  unicode_string_list_default,
  unit_default,
  unit_hud_interface_default,
  vehicle_default,
  virtual_keyboard_default,
  weapon_default,
  weapon_hud_interface_default,
  weather_particle_system_default,
  wind_default
];

// ../core/src/map/definitions/engine.ts
var DefinitionLoadError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "DefinitionLoadError";
  }
};
var enums = /* @__PURE__ */ new Map();
var bitfields = /* @__PURE__ */ new Map();
var structs = /* @__PURE__ */ new Map();
var tagGroupNameToStructName = /* @__PURE__ */ new Map();
for (const file of ALL_DEFINITION_FILES) {
  for (const entry of file) {
    if (entry.kind === "enum") {
      if (enums.has(entry.name)) throw new DefinitionLoadError(`Duplicate enum name "${entry.name}" across definition files.`);
      enums.set(entry.name, entry);
    } else if (entry.kind === "bitfield") {
      if (bitfields.has(entry.name)) throw new DefinitionLoadError(`Duplicate bitfield name "${entry.name}" across definition files.`);
      bitfields.set(entry.name, entry);
    } else {
      if (structs.has(entry.name)) throw new DefinitionLoadError(`Duplicate struct name "${entry.name}" across definition files.`);
      structs.set(entry.name, entry);
      if (entry.tagClass) {
        if (tagGroupNameToStructName.has(entry.tagClass)) {
          throw new DefinitionLoadError(`Duplicate tag group "${entry.tagClass}" across definition files.`);
        }
        tagGroupNameToStructName.set(entry.tagClass, entry.name);
      }
    }
  }
}

// ../core/src/map/container.ts
var OCETAGS_EXTENSION = ".ocetags";

// ../core/src/map/cache-crc.ts
var CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

// ../core/src/map/finalize-map.ts
var MAX_SCENARIO_NAME_LENGTH = TAG_STRING_SIZE - 1;
function scenarioNameFromFileName(fileName) {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const stem = dot >= 0 ? base.slice(0, dot) : base;
  const warnings = [];
  let name = "";
  const replaced = /* @__PURE__ */ new Set();
  for (const ch of stem) {
    const code = ch.codePointAt(0);
    if (code >= 32 && code <= 126) name += ch;
    else {
      name += "_";
      replaced.add(ch);
    }
  }
  if (replaced.size > 0) {
    warnings.push(`The file name contains characters the map header can't store (${[...replaced].map((c) => `"${c}"`).join(", ")}); they were replaced with "_" in the map's internal name.`);
  }
  if (name.length > MAX_SCENARIO_NAME_LENGTH) {
    warnings.push(`The file name is longer than ${MAX_SCENARIO_NAME_LENGTH} characters; the map's internal name was shortened to "${name.slice(0, MAX_SCENARIO_NAME_LENGTH)}". The game may not load a map whose internal name differs from its file name - choose a shorter name.`);
    name = name.slice(0, MAX_SCENARIO_NAME_LENGTH);
  }
  if (name.length === 0) throw new Error('The chosen file name gives an empty map name. Choose a file name with at least one character before ".map".');
  return { name, warnings };
}

// ../core/src/map/convert/resource-files.ts
var MAX_PATHS_BLOCK = 64 * 1024 * 1024;

// ../core/src/map/convert/externalize-in.ts
var MAX_BLOCKS_PER_LIST = 1 << 20;

// ../core/src/map/convert/model-part-check.ts
var PARTS_HAVE_LOCAL_NODES = 1 << 1;
var MAXIMUM_COMPRESSIBLE_COMPONENT = Math.fround(1.005);

// ../core/src/map/convert/tag-data-repairs.ts
var TAG_DATA_REPAIR_IDS = ["alignTagData", "scriptSyntaxData", "tagRootOutside", "blockOverlap"];

// ../core/src/map/convert/demo-to-ce.ts
var DEMO_BASE_MEMORY_ADDRESS = 1274085376;
var DEMO_TO_CE_DELTA = CE_BASE_MEMORY_ADDRESS - DEMO_BASE_MEMORY_ADDRESS;

// electron/recent-maps.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var import_electron = require("electron");
var MAX_RECENT = 10;
function storePath() {
  return path.join(import_electron.app.getPath("userData"), "recent-maps.json");
}
function getRecentMaps() {
  try {
    const raw = fs.readFileSync(storePath(), "utf-8");
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((p) => typeof p === "string" && fs.existsSync(p)) : [];
  } catch {
    return [];
  }
}
function addRecentMap(filePath) {
  const current = getRecentMaps().filter((p) => p !== filePath);
  const updated = [filePath, ...current].slice(0, MAX_RECENT);
  try {
    fs.writeFileSync(storePath(), JSON.stringify(updated, null, 2));
  } catch {
  }
  return updated;
}

// electron/settings.ts
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));
var import_electron2 = require("electron");
function storePath2() {
  return path2.join(import_electron2.app.getPath("userData"), "settings.json");
}
var DEFAULT_SETTINGS = { lastExtractDir: null, resourceMaps: { bitmaps: null, sounds: null, loc: null } };
function getSettings() {
  try {
    const raw = fs2.readFileSync(storePath2(), "utf-8");
    const parsed = JSON.parse(raw);
    return {
      lastExtractDir: typeof parsed.lastExtractDir === "string" ? parsed.lastExtractDir : null,
      resourceMaps: {
        bitmaps: typeof parsed.resourceMaps?.bitmaps === "string" ? parsed.resourceMaps.bitmaps : null,
        sounds: typeof parsed.resourceMaps?.sounds === "string" ? parsed.resourceMaps.sounds : null,
        loc: typeof parsed.resourceMaps?.loc === "string" ? parsed.resourceMaps.loc : null
      }
    };
  } catch {
    return { ...DEFAULT_SETTINGS, resourceMaps: { ...DEFAULT_SETTINGS.resourceMaps } };
  }
}
function writeSettings(next) {
  try {
    fs2.writeFileSync(storePath2(), JSON.stringify(next, null, 2));
  } catch {
  }
}
function setLastExtractDir(dir) {
  writeSettings({ ...getSettings(), lastExtractDir: dir });
}
function setResourceMapPath(kind, filePath) {
  const current = getSettings();
  writeSettings({ ...current, resourceMaps: { ...current.resourceMaps, [kind]: filePath } });
}

// electron/worker-manager.ts
var import_worker_threads = require("worker_threads");
var path3 = __toESM(require("path"));
var import_crypto2 = require("crypto");
var worker = null;
var pending = /* @__PURE__ */ new Map();
function ensureWorker(onLog) {
  if (worker) return worker;
  const instance = new import_worker_threads.Worker(path3.join(__dirname, "map-worker.js"));
  worker = instance;
  instance.on("message", (msg) => {
    if (msg.type === "ready") {
      onLog("info", msg.info);
      return;
    }
    const entry = pending.get(msg.requestId);
    if (!entry) return;
    if (msg.type === "progress") {
      entry.onProgress(msg.stage, msg.percent);
    } else if (msg.type === "result") {
      entry.resolve(msg.payload);
      pending.delete(msg.requestId);
    } else if (msg.type === "error") {
      entry.reject(Object.assign(new Error(msg.message), { code: msg.code }));
      pending.delete(msg.requestId);
    }
  });
  instance.on("error", (err) => {
    onLog("error", `Worker thread crashed: ${err.message}`);
    for (const [id, entry] of pending) {
      entry.reject(new Error("Worker thread crashed."));
      pending.delete(id);
    }
    worker = null;
  });
  instance.on("exit", (code) => {
    if (code !== 0) onLog("warn", `Worker thread exited unexpectedly (code ${code}).`);
    worker = null;
  });
  return instance;
}
function startWorker(onLog) {
  ensureWorker(onLog);
}
function sendWorkerRequest(request, onLog, onProgress = () => {
}) {
  const requestId = (0, import_crypto2.randomUUID)();
  const instance = ensureWorker(onLog);
  const promise = new Promise((resolve4, reject) => {
    pending.set(requestId, { resolve: resolve4, reject, onProgress });
    instance.postMessage({ ...request, requestId });
  });
  return { requestId, promise };
}
function cancelWorkerRequest(requestId, onLog) {
  ensureWorker(onLog).postMessage({ type: "cancel", requestId });
}

// electron/save-map-as.ts
var path5 = __toESM(require("path"));
var fs3 = __toESM(require("fs"));

// electron/map-file-rules.ts
function isBackupFilePath(filePath) {
  return /\.bak$/i.test(filePath);
}
function backupPathFor(mapPath) {
  return `${mapPath}.bak`;
}
var COMPRESSED_MAP_MESSAGE = "This map is compressed, so it cannot be edited, injected into or saved. Use Tools > Decompress Map to write a decompressed copy, then open that copy.";
var BACKUP_FILE_SAVE_MESSAGE = "This map was opened from a backup (.bak) file. Use File > Save As to write it under a new name; Save would overwrite the backup.";

// electron/save-map.ts
var path4 = __toESM(require("path"));
var SAVE_MAP_CHANNEL = "map:save";
var hex = (n) => `0x${(n >>> 0).toString(16).padStart(8, "0")}`;
function logSaved(log, result) {
  const renamed = result.previousScenarioName !== result.scenarioName ? ` (changed from "${result.previousScenarioName}" to match the file name)` : "";
  log("info", `Saved ${result.outputPath} - map name "${result.scenarioName}"${renamed}, CRC32 ${hex(result.crc32)}`);
  for (const w of result.warnings) log("warn", w);
  log("info", result.staleChecksumWarning);
}
var cancelled = { ok: false, code: "CANCELLED", message: "Save was cancelled." };
async function saveMapFlow(deps) {
  const open = deps.getOpenMap();
  if (!open) return { ok: false, code: "NO_MAP_LOADED", message: "No map is open." };
  if (open.compressed) {
    deps.log("warn", COMPRESSED_MAP_MESSAGE);
    await deps.showError("This map cannot be saved.", COMPRESSED_MAP_MESSAGE);
    return { ok: false, code: "COMPRESSED", message: COMPRESSED_MAP_MESSAGE };
  }
  if (isBackupFilePath(open.filePath)) {
    deps.log("warn", BACKUP_FILE_SAVE_MESSAGE);
    await deps.showError("Save is not available for a backup file.", BACKUP_FILE_SAVE_MESSAGE);
    return { ok: false, code: "REFUSED_BACKUP_FILE", message: BACKUP_FILE_SAVE_MESSAGE };
  }
  if (!open.modified) return { ok: false, code: "NOT_MODIFIED", message: "There are no unsaved changes." };
  if (!open.backedUp && !open.overwriteConfirmed) {
    if (!await deps.confirmOverwriteWithoutBackup(open.filePath)) return cancelled;
    deps.markOverwriteConfirmed();
    deps.log("warn", `Overwriting ${path4.basename(open.filePath)} without a backup (confirmed).`);
  }
  if (!await deps.confirmScenarioName(open.filePath)) return cancelled;
  deps.log("info", `Saving ${open.filePath}`);
  try {
    const result = await deps.runWorkerSave();
    if (result.ok) logSaved(deps.log, result);
    return result;
  } catch (err) {
    const e = err;
    deps.log("error", `Save failed: ${e.message}`);
    await deps.showError("The map was not saved.", e.message);
    return { ok: false, code: e.code ?? "UNEXPECTED_ERROR", message: e.message };
  }
}
async function confirmUnsavedChanges(deps) {
  if (!deps.isModified()) return true;
  const choice = await deps.ask(deps.fileName());
  if (choice === "cancel") return false;
  if (choice === "dont-save") {
    deps.log("warn", `Unsaved changes to ${deps.fileName()} were discarded.`);
    return true;
  }
  const result = await deps.save();
  return result.ok;
}

// electron/save-map-as.ts
var SAVE_MAP_AS_CHANNEL = "map:saveAs";
function isSamePath(a, b) {
  return path5.resolve(a).toLowerCase() === path5.resolve(b).toLowerCase();
}
async function saveMapAsFlow(deps) {
  const openMap = deps.getOpenMap();
  if (!openMap) return { ok: false, code: "NO_MAP_LOADED", message: "No map is open." };
  if (openMap.compressed) {
    deps.log("warn", COMPRESSED_MAP_MESSAGE);
    await deps.showError("This map cannot be saved.", COMPRESSED_MAP_MESSAGE);
    return { ok: false, code: "COMPRESSED", message: COMPRESSED_MAP_MESSAGE };
  }
  const filePath = await deps.showSaveDialog(openMap.filePath.replace(/(\.map)?$/i, "_copy.map"));
  if (!filePath) return { ok: false, code: "CANCELLED", message: "Save was cancelled." };
  const resolvedTarget = path5.resolve(filePath);
  if (isSamePath(resolvedTarget, openMap.filePath)) {
    const message = "Save As cannot overwrite the open map. Use File > Save, or choose a different file name.";
    deps.log("error", `Save As refused: ${resolvedTarget} is the open map.`);
    await deps.showError("Save As cannot overwrite the open map.", "Use File > Save to overwrite it, or choose a different file name.");
    return { ok: false, code: "REFUSED_SOURCE_PATH", message };
  }
  const exists = deps.fileExists ?? fs3.existsSync;
  if (exists(resolvedTarget) && !await deps.confirmOverwrite(resolvedTarget)) return { ok: false, code: "CANCELLED", message: "Save was cancelled." };
  if (!await deps.confirmScenarioName(resolvedTarget)) return { ok: false, code: "CANCELLED", message: "Save was cancelled." };
  deps.log("info", `Saving map as ${resolvedTarget}`);
  try {
    const result = await deps.runWorkerSave(resolvedTarget);
    if (result.ok) logSaved(deps.log, result);
    else deps.log("error", `Save As failed: ${result.message}`);
    return result;
  } catch (err) {
    const e = err;
    deps.log("error", `Save As failed: ${e.message}`);
    await deps.showError("The map was not saved.", e.message);
    return { ok: false, code: e.code ?? "UNEXPECTED_ERROR", message: e.message };
  }
}
function registerSaveMapAsIpc(ipc, deps, onResult = () => {
}) {
  ipc.handle(SAVE_MAP_AS_CHANNEL, async () => {
    const result = await saveMapAsFlow(deps);
    onResult(result);
    return result;
  });
}

// electron/backup-on-open.ts
var path6 = __toESM(require("path"));
var fs4 = __toESM(require("fs"));
var import_crypto3 = require("crypto");
function isBackedUp(outcome) {
  return outcome === "created" || outcome === "replaced" || outcome === "kept-existing" || outcome === "up-to-date";
}
function describeBackupError(err, backupName) {
  const code = err?.code;
  if (code === "ENOSPC") return `There is not enough free disk space to create ${backupName}.`;
  if (code === "EACCES" || code === "EPERM" || code === "EROFS" || code === "EBUSY")
    return `${backupName} could not be written: the folder is read-only, or the file is in use by another program.`;
  return `${backupName} could not be created: ${err instanceof Error ? err.message : String(err)}`;
}
async function backupOnOpenFlow(mapPath, deps) {
  const f = deps.fs ?? fs4;
  if (isBackupFilePath(mapPath)) {
    deps.log("info", `Opened a backup file (${path6.basename(mapPath)}): no backup prompt, and File > Save is disabled for it - use Save As.`);
    return "not-applicable";
  }
  const backupPath = backupPathFor(mapPath);
  const mapName = path6.basename(mapPath);
  const backupName = path6.basename(backupPath);
  try {
    const exists = f.existsSync(backupPath);
    if (exists && f.statSync(backupPath).size === f.statSync(mapPath).size && f.readFileSync(backupPath).equals(f.readFileSync(mapPath))) {
      deps.log("info", `Backup already up to date: ${backupName} is identical to ${mapName}.`);
      return "up-to-date";
    }
    if (await deps.askCreateBackup(mapName, backupName) === "skip") {
      deps.log("warn", `Backup skipped for ${mapName}. File > Save will ask before overwriting it.`);
      return "skipped";
    }
    let replacing = false;
    if (exists) {
      const choice = await deps.askExistingBackup(backupName);
      if (choice === "keep") {
        deps.log("info", `Kept the existing ${backupName} (it differs from ${mapName}; not overwritten).`);
        return "kept-existing";
      }
      if (choice === "skip") {
        deps.log("warn", `Backup skipped for ${mapName}; the existing ${backupName} was left unchanged. File > Save will ask before overwriting ${mapName}.`);
        return "skipped";
      }
      replacing = true;
    }
    const tempPath = `${backupPath}.tmp-${(0, import_crypto3.randomUUID)()}`;
    try {
      f.copyFileSync(mapPath, tempPath);
      const expected = f.statSync(mapPath).size;
      const copied = f.statSync(tempPath).size;
      if (copied !== expected) throw new Error(`the copy is ${copied} bytes, the map is ${expected} bytes`);
      f.renameSync(tempPath, backupPath);
    } catch (err) {
      try {
        if (f.existsSync(tempPath)) f.unlinkSync(tempPath);
      } catch {
      }
      throw err;
    }
    deps.log("info", `${replacing ? "Replaced" : "Created"} backup ${backupPath}.`);
    return replacing ? "replaced" : "created";
  } catch (err) {
    const message = describeBackupError(err, backupName);
    deps.log("error", `Backup failed: ${message} ${mapName} is still open; File > Save will ask before overwriting it.`);
    await deps.showError("The backup copy could not be created.", `${message}

${mapName} is still open and unchanged. File > Save will ask before overwriting it.`);
    return "failed";
  }
}

// electron/convert-map.ts
var path7 = __toESM(require("path"));
var fs5 = __toESM(require("fs"));
function defaultConvertOutputPath(sourcePath) {
  const dir = path7.dirname(sourcePath);
  const stem = path7.basename(sourcePath).replace(/\.map$/i, "");
  return path7.join(dir, `${stem}_ce.map`);
}
var REPAIR_IDS = TAG_DATA_REPAIR_IDS;
function sanitizeRepairChoice(value) {
  const out = {};
  if (!value || typeof value !== "object") return out;
  for (const id of REPAIR_IDS) if (value[id] === true) out[id] = true;
  return out;
}
var cancelled2 = () => ({ ok: false, code: "CANCELLED", message: "Convert was cancelled." });
async function convertMapFlow(deps, acknowledgeScripts, repairs = {}, resourcePaths) {
  const sourcePath = deps.getSourcePath();
  if (!sourcePath) return { ok: false, code: "NO_SOURCE", message: "Choose a map to convert first." };
  if (!await deps.confirmUnsavedChanges()) return cancelled2();
  const filePath = await deps.showSaveDialog(defaultConvertOutputPath(sourcePath));
  if (!filePath) return cancelled2();
  const target = path7.resolve(filePath);
  const refuse = async (code, message) => {
    deps.log("error", `Convert refused: ${message}`);
    await deps.showError("The map was not converted.", message);
    return { ok: false, code, message };
  };
  if (isSamePath(target, sourcePath)) return refuse("REFUSED_SOURCE_PATH", "The converted map cannot overwrite the map it is converted from. Choose a different file name or folder.");
  const openMap = deps.getOpenMapPath();
  if (openMap && isSamePath(target, openMap)) return refuse("REFUSED_OPEN_MAP", "The converted map cannot overwrite the map that is open in the app. Choose a different file name.");
  if (isBackupFilePath(target)) return refuse("REFUSED_BACKUP_FILE", "The converted map cannot be written as a .bak file. Choose a .map file name.");
  const exists = deps.fileExists ?? fs5.existsSync;
  if (exists(target) && !await deps.confirmOverwrite(target)) return cancelled2();
  if (!await deps.confirmScenarioName(target)) return cancelled2();
  deps.log("info", `Converting ${sourcePath} to a Custom Edition map: ${target}`);
  try {
    const result = await deps.runWorkerConvert(sourcePath, target, acknowledgeScripts, repairs, resourcePaths);
    if (result.ok) {
      const hex2 = (n) => `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
      deps.log("info", `Converted to ${result.outputPath} - map name "${result.scenarioName}", CRC32 ${hex2(result.previousCrc32)} -> ${hex2(result.crc32)}. ${path7.basename(sourcePath)} was not changed.`);
      for (const w of result.warnings) deps.log("warn", w);
      deps.log("info", result.staleChecksumWarning);
    } else {
      deps.log("error", `Convert failed: ${result.message}`);
    }
    return result;
  } catch (err) {
    const e = err;
    deps.log("error", `Convert failed: ${e.message}`);
    await deps.showError("The map was not converted.", e.message);
    return { ok: false, code: e.code ?? "UNEXPECTED_ERROR", message: e.message };
  }
}

// electron/main.ts
var mainWindow = null;
var currentMapPath = null;
var currentMapCompressed = false;
var currentMapScenarioName = null;
var currentMapModified = false;
var currentMapBackedUp = false;
var overwriteConfirmed = false;
var currentExtractRequestId = null;
var currentInjectContainerPath = null;
var lastConvertiblePath = null;
var convertSourcePath = null;
var isDev = !import_electron3.app.isPackaged;
function sendLog(level, message) {
  mainWindow?.webContents.send("app:log", { level, message, timestamp: Date.now() });
}
function createWindow() {
  mainWindow = new import_electron3.BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#15171c",
    webPreferences: {
      preload: path8.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path8.join(__dirname, "../dist/index.html"));
  }
  buildMenu();
  updateTitle();
  let closeConfirmed = false;
  mainWindow.on("close", (event) => {
    if (closeConfirmed || !currentMapModified) return;
    event.preventDefault();
    void confirmUnsavedChanges(unsavedChangesDeps).then((ok) => {
      if (!ok) return;
      closeConfirmed = true;
      mainWindow?.close();
    });
  });
}
function updateTitle() {
  if (!mainWindow) return;
  const name = currentMapPath ? `${path8.basename(currentMapPath)}${currentMapModified ? " *" : ""} - ` : "";
  mainWindow.setTitle(`${name}OpenCE Modding Tool`);
}
function setOpenMapState(map) {
  currentMapPath = map.filePath;
  currentMapScenarioName = map.header.scenarioName;
  currentMapModified = !!map.modified;
  buildMenu();
  updateTitle();
  mainWindow?.webContents.send("map:updated", map);
}
var unsavedChangesDeps = {
  isModified: () => currentMapModified,
  fileName: () => currentMapPath ? path8.basename(currentMapPath) : "the open map",
  ask: async (fileName) => {
    const { response } = await import_electron3.dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["Save", "Don't save", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      message: `Save changes to ${fileName}?`,
      detail: "Your injected tags are only in memory. If you don't save, they are lost."
    });
    return response === 0 ? "save" : response === 1 ? "dont-save" : "cancel";
  },
  save: () => runSaveMap(),
  log: sendLog
};
async function openMapGuarded(filePath) {
  if (!await confirmUnsavedChanges(unsavedChangesDeps)) return null;
  return loadMapAtPath(filePath, { askBackup: true });
}
async function askBackup(filePath) {
  const outcome = await backupOnOpenFlow(filePath, {
    askCreateBackup: async (mapName, backupName) => {
      const { response } = await import_electron3.dialog.showMessageBox(mainWindow, {
        type: "question",
        buttons: ["Create backup", "Skip"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        message: `Create a backup copy of ${mapName} as ${backupName}?`,
        detail: "File > Save overwrites the map you opened. The backup is written next to it, and Save never touches it."
      });
      return response === 0 ? "create" : "skip";
    },
    askExistingBackup: async (backupName) => {
      const { response } = await import_electron3.dialog.showMessageBox(mainWindow, {
        type: "warning",
        buttons: ["Keep existing", "Replace", "Skip"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        message: `${backupName} already exists and differs from the map you opened.`,
        detail: "Keep existing leaves the old backup as it is. Replace overwrites it with a copy of the map you just opened."
      });
      return response === 1 ? "replace" : response === 2 ? "skip" : "keep";
    },
    showError: showErrorBox,
    log: sendLog
  });
  currentMapBackedUp = isBackedUp(outcome);
  overwriteConfirmed = false;
}
async function showErrorBox(message, detail) {
  await import_electron3.dialog.showMessageBox(mainWindow, { type: "error", message, detail });
}
async function loadMapAtPath(filePath, options) {
  sendLog("info", `Opening ${filePath}`);
  try {
    const { promise } = sendWorkerRequest({ type: "inspect", filePath }, sendLog, (stage, percent) => {
      mainWindow?.webContents.send("map:progress", { taskId: "load", stage, percent });
    });
    const result = await promise;
    currentMapModified = false;
    currentMapBackedUp = false;
    overwriteConfirmed = false;
    lastConvertiblePath = result.status === "unsupported" && result.convertible ? filePath : null;
    if (result.status === "ok") {
      currentMapPath = filePath;
      currentMapCompressed = false;
      currentMapScenarioName = result.header.scenarioName;
      addRecentMap(filePath);
      buildMenu();
      updateTitle();
      sendLog("info", `Parsed "${result.header.scenarioName}" - ${result.tags.length} tags`);
      if (options.askBackup) await askBackup(filePath);
    } else if (result.status === "compressed") {
      currentMapPath = filePath;
      currentMapCompressed = true;
      currentMapScenarioName = null;
      addRecentMap(filePath);
      buildMenu();
      updateTitle();
      sendLog("warn", "This map is compressed - decompress it (Tools > Decompress Map) to browse tags. Nothing of it is held for editing.");
    } else if (result.status === "unsupported") {
      currentMapPath = null;
      currentMapScenarioName = null;
      buildMenu();
      updateTitle();
      sendLog("error", result.message);
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendLog("error", `Failed to open map: ${message}`);
    return { status: "error", message };
  }
}
async function openMapDialogFlow() {
  if (!mainWindow) return null;
  if (!await confirmUnsavedChanges(unsavedChangesDeps)) return null;
  const { canceled, filePaths } = await import_electron3.dialog.showOpenDialog(mainWindow, {
    title: "Open Halo CE Map",
    filters: [
      { name: "Halo CE Map", extensions: ["map"] },
      { name: "Map backup", extensions: ["bak"] }
    ],
    properties: ["openFile"]
  });
  if (canceled || filePaths.length === 0) return null;
  return loadMapAtPath(filePaths[0], { askBackup: true });
}
async function openMapFlow() {
  const result = await openMapDialogFlow();
  if (result) mainWindow?.webContents.send("map:loaded", result);
}
async function decompressFlow() {
  if (!mainWindow || !currentMapPath) return;
  const defaultPath = currentMapPath.replace(/\.map$/i, "_decompressed.map");
  const { canceled, filePath } = await import_electron3.dialog.showSaveDialog(mainWindow, {
    title: "Save decompressed map as",
    defaultPath,
    filters: [{ name: "Halo CE Map", extensions: ["map"] }]
  });
  if (canceled || !filePath) return null;
  sendLog("info", `Decompressing ${currentMapPath} -> ${filePath}`);
  const { promise } = sendWorkerRequest(
    { type: "decompress", filePath: currentMapPath, outputPath: filePath },
    sendLog,
    (stage, percent) => mainWindow?.webContents.send("map:progress", { taskId: "decompress", stage, percent })
  );
  const result = await promise;
  sendLog("info", `Decompressed: ${result.originalSize} -> ${result.newSize} bytes`);
  return result;
}
async function recompressFlow() {
  if (!mainWindow || !currentMapPath) return;
  if (currentMapModified) {
    sendLog("warn", "Recompress reads the map file on disk, which does not have your unsaved changes. Save first (File > Save or Save As), then recompress.");
    await showErrorBox("Save your changes before recompressing.", "Recompress reads the map file on disk, which does not have your unsaved (injected) changes.");
    return null;
  }
  const defaultPath = currentMapPath.replace(/\.map$/i, "_compressed.map");
  const { canceled, filePath } = await import_electron3.dialog.showSaveDialog(mainWindow, {
    title: "Save recompressed map as",
    defaultPath,
    filters: [{ name: "Halo CE Map", extensions: ["map"] }]
  });
  if (canceled || !filePath) return null;
  sendLog("info", `Compressing ${currentMapPath} -> ${filePath}`);
  const { promise } = sendWorkerRequest(
    { type: "compress", filePath: currentMapPath, outputPath: filePath },
    sendLog,
    (stage, percent) => mainWindow?.webContents.send("map:progress", { taskId: "compress", stage, percent })
  );
  const result = await promise;
  sendLog("info", `Compressed: ${result.originalSize} -> ${result.newSize} bytes`);
  return result;
}
async function getDependenciesFlow(originalIndices) {
  if (!Array.isArray(originalIndices) || originalIndices.length === 0 || !originalIndices.every((n) => Number.isInteger(n) && n >= 0)) {
    return { ok: false, code: "INVALID_INPUT", message: "No valid tags were selected." };
  }
  if (!currentMapPath || currentMapCompressed) {
    return { ok: false, code: "NO_MAP_LOADED", message: "Open and decompress a map before extracting tags." };
  }
  sendLog("info", `Extract requested: ${originalIndices.length} tag(s) selected.`);
  const { promise } = sendWorkerRequest(
    { type: "getDependencies", originalIndices },
    sendLog,
    (stage, percent) => mainWindow?.webContents.send("map:progress", { taskId: "getDependencies", stage, percent })
  );
  try {
    return await promise;
  } catch (err) {
    const e = err;
    sendLog("error", `Dependency walk failed: ${e.message}`);
    return { ok: false, code: e.code ?? "UNEXPECTED_ERROR", message: e.message };
  }
}
async function extractTagsFlow(request) {
  if (!mainWindow) return { ok: false, code: "NO_WINDOW", message: "Application window is not available." };
  if (!request || !Array.isArray(request.originalIndices) || request.originalIndices.length === 0 || !request.originalIndices.every((n) => Number.isInteger(n) && n >= 0)) {
    return { ok: false, code: "INVALID_INPUT", message: "No valid tags were selected." };
  }
  if (!currentMapPath || currentMapCompressed) {
    return { ok: false, code: "NO_MAP_LOADED", message: "Open and decompress a map before extracting tags." };
  }
  const settings = getSettings();
  const defaultDir = settings.lastExtractDir && fs6.existsSync(settings.lastExtractDir) ? settings.lastExtractDir : import_electron3.app.getPath("documents");
  const safeName = String(request.suggestedFileName || "extracted_tags").replace(/[<>:"/\\|?*]/g, "_") || "extracted_tags";
  const defaultPath = path8.join(defaultDir, `${safeName}${OCETAGS_EXTENSION}`);
  let resolvedTarget;
  if (request.originalIndices.length > 1) {
    const { canceled, filePaths } = await import_electron3.dialog.showOpenDialog(mainWindow, {
      title: "Choose folder to save extracted tags to...",
      defaultPath: defaultDir,
      properties: ["openDirectory", "createDirectory"]
    });
    if (canceled || filePaths.length === 0) return { ok: false, code: "CANCELLED", message: "Extraction was cancelled." };
    resolvedTarget = path8.resolve(filePaths[0]);
  } else {
    const { canceled, filePath } = await import_electron3.dialog.showSaveDialog(mainWindow, {
      title: "Extract tags to...",
      defaultPath,
      filters: [{ name: "OpenCE Tag Set", extensions: ["ocetags"] }]
    });
    if (canceled || !filePath) return { ok: false, code: "CANCELLED", message: "Save was cancelled." };
    resolvedTarget = path8.resolve(filePath);
  }
  const resolvedSourceMap = path8.resolve(currentMapPath);
  const resolvedAppDir = path8.resolve(import_electron3.app.getAppPath());
  if (resolvedTarget === resolvedSourceMap) {
    return { ok: false, code: "REFUSED_SOURCE_PATH", message: "You cannot overwrite the source map file. Choose a different location." };
  }
  if (resolvedTarget === resolvedAppDir || resolvedTarget.startsWith(resolvedAppDir + path8.sep)) {
    return { ok: false, code: "REFUSED_APP_PATH", message: "You cannot save inside the application install directory. Choose a different location." };
  }
  if (fs6.existsSync(resolvedTarget)) {
    const { response } = await import_electron3.dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["Overwrite", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      message: `"${path8.basename(resolvedTarget)}" already exists.`,
      detail: "Do you want to overwrite it?"
    });
    if (response !== 0) return { ok: false, code: "CANCELLED", message: "Save was cancelled." };
  }
  setLastExtractDir(path8.dirname(resolvedTarget));
  sendLog("info", `Extracting ${request.originalIndices.length} tag(s) to ${resolvedTarget}`);
  const { requestId, promise } = sendWorkerRequest(
    {
      type: "extractTags",
      originalIndices: request.originalIndices,
      outputPath: resolvedTarget,
      sourceMapName: currentMapScenarioName ?? path8.basename(currentMapPath, ".map")
    },
    sendLog,
    (stage, percent) => mainWindow?.webContents.send("map:progress", { taskId: "extract", stage, percent })
  );
  currentExtractRequestId = requestId;
  try {
    const payload = await promise;
    if (payload.ok) sendLog("info", `Extracted ${payload.tagCount} tag(s) to ${payload.outputPath}`);
    return payload;
  } catch (err) {
    const e = err;
    if (e.code === "CANCELLED") {
      sendLog("warn", "Extraction cancelled - no file was written.");
      return { ok: false, code: "CANCELLED", message: "Extraction was cancelled." };
    }
    sendLog("error", `Extraction failed: ${e.message}`);
    return { ok: false, code: e.code ?? "UNEXPECTED_ERROR", message: e.message };
  } finally {
    currentExtractRequestId = null;
  }
}
var RESOURCE_MAP_FILTER_NAMES = { bitmaps: "bitmaps.map", sounds: "sounds.map", loc: "loc.map" };
function readResourceMapStatus(kind, filePath) {
  if (!filePath) return { state: "not-configured" };
  try {
    const buffer = fs6.readFileSync(filePath);
    const result = validateResourceMapFile(buffer, kind);
    if (!result.ok) return { state: "missing-or-unreadable", path: filePath, error: result.error };
    return { state: "ok", path: filePath, fileSizeBytes: buffer.length, entryCount: result.identity.entryCount };
  } catch (err) {
    return { state: "missing-or-unreadable", path: filePath, error: err instanceof Error ? err.message : String(err) };
  }
}
async function pickResourceMapFlow(kind) {
  if (!mainWindow) return { ok: false, code: "NO_WINDOW", message: "Application window is not available." };
  const { canceled, filePaths } = await import_electron3.dialog.showOpenDialog(mainWindow, {
    title: `Pick ${RESOURCE_MAP_FILTER_NAMES[kind]}`,
    filters: [{ name: "Halo CE Resource Map", extensions: ["map"] }],
    properties: ["openFile"]
  });
  if (canceled || filePaths.length === 0) return { ok: false, code: "CANCELLED" };
  const status = readResourceMapStatus(kind, filePaths[0]);
  if (status.state !== "ok") {
    sendLog("warn", `Rejected ${filePaths[0]} for the ${RESOURCE_MAP_FILTER_NAMES[kind]} slot: ${status.state === "missing-or-unreadable" ? status.error : "unknown error"}`);
    return { ok: true, status };
  }
  setResourceMapPath(kind, filePaths[0]);
  sendLog("info", `${RESOURCE_MAP_FILTER_NAMES[kind]} set to ${filePaths[0]} (${status.entryCount} entries).`);
  return { ok: true, status };
}
function getResourceMapStatusesFlow() {
  const settings = getSettings();
  return {
    bitmaps: readResourceMapStatus("bitmaps", settings.resourceMaps.bitmaps),
    sounds: readResourceMapStatus("sounds", settings.resourceMaps.sounds),
    loc: readResourceMapStatus("loc", settings.resourceMaps.loc)
  };
}
async function pickInjectContainerFlow() {
  if (!mainWindow) return null;
  const { canceled, filePaths } = await import_electron3.dialog.showOpenDialog(mainWindow, {
    title: "Inject tags from...",
    filters: [{ name: "OpenCE Tag Set", extensions: ["ocetags"] }],
    properties: ["openFile", "multiSelections"]
  });
  if (canceled || filePaths.length === 0) return null;
  return { path: filePaths[0], paths: filePaths };
}
async function planInjectFlow(containerPath, mode) {
  if (!currentMapPath) return { ok: false, code: "NO_MAP_LOADED", message: "Open the target map before injecting tags into it." };
  if (currentMapCompressed) return { ok: false, code: "COMPRESSED", message: COMPRESSED_MAP_MESSAGE };
  currentInjectContainerPath = containerPath;
  const settings = getSettings();
  const resourceMapPaths = {};
  for (const kind of ["bitmaps", "sounds", "loc"]) {
    const p = settings.resourceMaps[kind];
    if (p) resourceMapPaths[kind] = p;
  }
  sendLog("info", `Planning ${mode === "swap" ? "swap" : "add"} injection from ${containerPath}`);
  const { promise } = sendWorkerRequest(
    { type: "planInject", containerPath, mode, resourceMapPaths },
    sendLog,
    (stage, percent) => mainWindow?.webContents.send("map:progress", { taskId: "planInject", stage, percent })
  );
  try {
    return await promise;
  } catch (err) {
    const e = err;
    sendLog("error", `Injection plan failed: ${e.message}`);
    return { ok: false, code: e.code ?? "UNEXPECTED_ERROR", message: e.message };
  }
}
async function confirmScenarioName(filePath) {
  let warnings;
  try {
    warnings = scenarioNameFromFileName(path8.basename(filePath)).warnings;
  } catch (err) {
    await import_electron3.dialog.showMessageBox(mainWindow, { type: "error", message: "This file name cannot be used for a map.", detail: err.message });
    return false;
  }
  if (warnings.length === 0) return true;
  const { response } = await import_electron3.dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["Save anyway", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: "The map's internal name will not match this file name.",
    detail: warnings.join("\n\n")
  });
  return response === 0;
}
async function applyInjectFlow() {
  if (!currentMapPath) return { ok: false, code: "NO_MAP_LOADED", message: "No map is open." };
  if (currentMapCompressed) return { ok: false, code: "COMPRESSED", message: COMPRESSED_MAP_MESSAGE };
  if (!currentInjectContainerPath) return { ok: false, code: "NO_PLAN", message: 'Run "Inject Tags..." and review the plan before applying it.' };
  const { promise } = sendWorkerRequest(
    { type: "applyInject" },
    sendLog,
    (stage, percent) => mainWindow?.webContents.send("map:progress", { taskId: "applyInject", stage, percent })
  );
  try {
    const result = await promise;
    if (result.ok) {
      setOpenMapState(result.map);
      sendLog(
        "info",
        `Injected in memory: ${result.addedCount} added, ${result.swappedCount} swapped, ${result.reusedCount} reused - ${result.map.header.tagCount} tags now. Not saved yet: use File > Save or Save As.`
      );
    }
    return result;
  } catch (err) {
    const e = err;
    sendLog("error", `Injection failed (the open map is unchanged): ${e.message}`);
    return { ok: false, code: e.code ?? "UNEXPECTED_ERROR", message: e.message };
  } finally {
    currentInjectContainerPath = null;
  }
}
var saveMapDeps = {
  getOpenMap: () => mainWindow && currentMapPath ? { filePath: currentMapPath, compressed: currentMapCompressed, modified: currentMapModified, backedUp: currentMapBackedUp, overwriteConfirmed } : null,
  confirmOverwriteWithoutBackup: async (filePath) => {
    const { response } = await import_electron3.dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["Overwrite", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      message: `Overwrite ${path8.basename(filePath)} without a backup?`,
      detail: "You skipped the backup copy when you opened this map, so the current file cannot be restored afterwards. Use File > Save As to keep it."
    });
    return response === 0;
  },
  markOverwriteConfirmed: () => {
    overwriteConfirmed = true;
  },
  confirmScenarioName,
  showError: showErrorBox,
  runWorkerSave: () => sendWorkerRequest({ type: "saveMap" }, sendLog, (stage, percent) => mainWindow?.webContents.send("map:progress", { taskId: "saveMap", stage, percent })).promise,
  log: sendLog
};
async function runSaveMap() {
  const result = await saveMapFlow(saveMapDeps);
  if (result.ok) setOpenMapState(result.map);
  return result;
}
function afterSaveAs(result) {
  if (!result.ok) return;
  addRecentMap(result.outputPath);
  currentMapBackedUp = true;
  overwriteConfirmed = false;
  setOpenMapState(result.map);
}
async function runSaveMapAs() {
  const result = await saveMapAsFlow(saveMapAsDeps);
  afterSaveAs(result);
  return result;
}
async function discardChangesFlow() {
  if (!mainWindow || !currentMapPath || !currentMapModified) return null;
  const { response } = await import_electron3.dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["Discard changes", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    message: `Discard all unsaved changes to ${path8.basename(currentMapPath)}?`,
    detail: "The map is reopened from the file on disk. Injected tags that were not saved are lost."
  });
  if (response !== 0) return null;
  const backedUp = currentMapBackedUp;
  const confirmed = overwriteConfirmed;
  const filePath = currentMapPath;
  const map = await loadMapAtPath(filePath, { askBackup: false });
  currentMapBackedUp = backedUp;
  overwriteConfirmed = confirmed;
  sendLog("info", `Discarded unsaved changes; reopened ${filePath} from disk.`);
  return { ok: true, map };
}
var saveMapAsDeps = {
  getOpenMap: () => mainWindow && currentMapPath ? { filePath: currentMapPath, compressed: currentMapCompressed } : null,
  showSaveDialog: async (defaultPath) => {
    const { canceled, filePath } = await import_electron3.dialog.showSaveDialog(mainWindow, {
      title: "Save map as",
      defaultPath,
      filters: [{ name: "Halo CE Map", extensions: ["map"] }]
    });
    return canceled || !filePath ? null : filePath;
  },
  confirmOverwrite: async (filePath) => {
    const { response } = await import_electron3.dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["Overwrite", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      message: `"${path8.basename(filePath)}" already exists.`,
      detail: "Do you want to overwrite it?"
    });
    return response === 0;
  },
  confirmScenarioName,
  showError: showErrorBox,
  runWorkerSave: (outputPath) => sendWorkerRequest(
    { type: "saveMapAs", outputPath },
    sendLog,
    (stage, percent) => mainWindow?.webContents.send("map:progress", { taskId: "saveMapAs", stage, percent })
  ).promise,
  log: sendLog
};
function canSaveMapAs() {
  return !!currentMapPath && !currentMapCompressed;
}
function canSaveMap() {
  return canSaveMapAs() && currentMapModified && !isBackupFilePath(currentMapPath);
}
function pickConvertResourceFlow(kind) {
  if (!mainWindow) return Promise.resolve(null);
  const title = kind === "bitmaps" ? "Choose the source game's bitmaps.map" : "Choose the source game's sounds.map";
  return import_electron3.dialog.showOpenDialog(mainWindow, {
    title,
    filters: [{ name: "Halo map", extensions: ["map"] }],
    properties: ["openFile"]
  }).then(({ canceled, filePaths }) => canceled || filePaths.length === 0 ? null : { path: filePaths[0] });
}
async function convertPreflightFlow(source, resourcePaths) {
  if (!mainWindow) return { ok: false, code: "NO_WINDOW", message: "Application window is not available." };
  let sourcePath;
  if (source === "open") {
    sourcePath = lastConvertiblePath;
    if (!sourcePath) return { ok: false, code: "NO_SOURCE", message: "No convertible map is open. Use File > Convert to Custom Edition... to choose one." };
  } else {
    const { canceled, filePaths } = await import_electron3.dialog.showOpenDialog(mainWindow, {
      title: "Convert to Custom Edition: choose a retail-layout (HaloMD) map",
      filters: [{ name: "Halo map", extensions: ["map"] }],
      properties: ["openFile"]
    });
    if (canceled || filePaths.length === 0) return null;
    sourcePath = filePaths[0];
  }
  convertSourcePath = sourcePath;
  sendLog("info", `Checking ${sourcePath} for conversion to Custom Edition...`);
  const { promise } = sendWorkerRequest(
    { type: "convertPreflight", filePath: sourcePath, bitmapsPath: resourcePaths?.bitmaps, soundsPath: resourcePaths?.sounds },
    sendLog,
    (stage, percent) => mainWindow?.webContents.send("map:progress", { taskId: "convertPreflight", stage, percent })
  );
  try {
    const result = await promise;
    if (result.ok) {
      const counts = (s) => result.report.checks.filter((c) => c.status === s).length;
      sendLog(result.report.canConvert ? "info" : "warn", `${result.sourceFileName}: ${result.report.canConvert ? "can be converted" : "cannot be converted"} (${counts("refuse")} refused, ${counts("warn")} warning(s)).`);
    }
    return result;
  } catch (err) {
    const e = err;
    sendLog("error", `Convert check failed: ${e.message}`);
    return { ok: false, code: e.code ?? "UNEXPECTED_ERROR", message: e.message };
  }
}
var convertMapDeps = {
  getSourcePath: () => convertSourcePath,
  getOpenMapPath: () => currentMapPath,
  confirmUnsavedChanges: () => confirmUnsavedChanges(unsavedChangesDeps),
  showSaveDialog: async (defaultPath) => {
    const { canceled, filePath } = await import_electron3.dialog.showSaveDialog(mainWindow, {
      title: "Save converted Custom Edition map as",
      defaultPath,
      filters: [{ name: "Halo CE Map", extensions: ["map"] }]
    });
    return canceled || !filePath ? null : filePath;
  },
  confirmOverwrite: saveMapAsDeps.confirmOverwrite,
  confirmScenarioName,
  showError: showErrorBox,
  runWorkerConvert: (sourcePath, outputPath, acknowledgeScripts, repairs, resourcePaths) => sendWorkerRequest(
    { type: "convertMap", sourcePath, outputPath, acknowledgeScripts, repairs, bitmapsPath: resourcePaths?.bitmaps, soundsPath: resourcePaths?.sounds },
    sendLog,
    (stage, percent) => mainWindow?.webContents.send("map:progress", { taskId: "convertMap", stage, percent })
  ).promise,
  log: sendLog
};
async function runConvertMap(acknowledgeScripts, repairs, resourcePaths) {
  const rp = resourcePaths && typeof resourcePaths === "object" ? resourcePaths : void 0;
  const result = await convertMapFlow(convertMapDeps, acknowledgeScripts === true, sanitizeRepairChoice(repairs), rp);
  if (result.ok) {
    addRecentMap(result.outputPath);
    currentMapPath = result.outputPath;
    currentMapCompressed = false;
    currentMapScenarioName = result.scenarioName;
    currentMapModified = false;
    currentMapBackedUp = true;
    overwriteConfirmed = false;
    lastConvertiblePath = null;
    convertSourcePath = null;
    buildMenu();
    updateTitle();
    mainWindow?.webContents.send("map:loaded", result.map);
  }
  return result;
}
async function verifyEmbeddedDataFlow() {
  if (!currentMapPath || currentMapCompressed) return { ok: false, code: "NO_MAP_LOADED", message: "Open and decompress a map before verifying embedded data." };
  sendLog("info", "Verifying embedded bitmap/sound data...");
  const { promise } = sendWorkerRequest(
    { type: "verifyEmbeddedData" },
    sendLog,
    (stage, percent) => mainWindow?.webContents.send("map:progress", { taskId: "verifyEmbeddedData", stage, percent })
  );
  try {
    const result = await promise;
    if (result.ok) sendLog("info", `Embedded data check: ${result.counts.embedded} embedded, ${result.counts.external} external, ${result.counts.blockedTags} blocked.`);
    return result;
  } catch (err) {
    const e = err;
    sendLog("error", `Embedded data check failed: ${e.message}`);
    return { ok: false, code: e.code ?? "UNEXPECTED_ERROR", message: e.message };
  }
}
function showAboutDialog() {
  if (!mainWindow) return;
  import_electron3.dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "About",
    message: `OpenCE Modding Tool v${import_electron3.app.getVersion()}`,
    detail: "A free, non-commercial GUI tool for modding Halo: Custom Edition (PC, version 609) maps.\n\nFormat references (GPL, not bundled): Invader, Reclaimer, Refinery, Mozzarilla, supyr_struct.\nCompression reference: Chimera.\nTarget runtime: OpenCE (OpenCommunityEdition/OpenCE).\n\nNo Bungie/Microsoft assets are bundled; this tool only operates on files you supply."
  });
}
function buildMenu() {
  const recents = getRecentMaps();
  const template = [
    {
      label: "File",
      submenu: [
        { label: "Open Map...", accelerator: "CmdOrCtrl+O", click: () => openMapFlow() },
        { id: "save", label: "Save", accelerator: "CmdOrCtrl+S", enabled: canSaveMap(), click: () => void runSaveMap() },
        { id: "save-as", label: "Save As...", accelerator: "CmdOrCtrl+Shift+S", enabled: canSaveMapAs(), click: () => void runSaveMapAs() },
        {
          id: "discard",
          label: "Discard Changes...",
          enabled: currentMapModified,
          click: () => void discardChangesFlow().then((r) => r?.ok && mainWindow?.webContents.send("map:loaded", r.map))
        },
        {
          label: "Recent Maps",
          submenu: recents.length > 0 ? recents.map((p) => ({ label: p, click: () => openMapGuarded(p).then((r) => r && mainWindow?.webContents.send("map:loaded", r)) })) : [{ label: "(none yet)", enabled: false }]
        },
        { type: "separator" },
        { label: "Convert to Custom Edition...", click: () => mainWindow?.webContents.send("menu:action", "convert-map") },
        { type: "separator" },
        { label: "Exit", role: "quit" }
      ]
    },
    {
      label: "Tools",
      submenu: [
        { label: "Decompress Map", click: () => decompressFlow() },
        { label: "Recompress Map", click: () => recompressFlow() },
        { type: "separator" },
        { label: "Extract Tags...", accelerator: "CmdOrCtrl+E", click: () => mainWindow?.webContents.send("menu:action", "extract-tags") },
        { label: "Inject Tags...", click: () => mainWindow?.webContents.send("menu:action", "inject-tags") },
        { label: "Verify Embedded Data...", click: () => mainWindow?.webContents.send("menu:action", "verify-embedded-data") },
        { type: "separator" },
        { label: "Settings...", click: () => mainWindow?.webContents.send("menu:action", "settings") }
      ]
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About OpenCE Modding Tool",
          click: () => showAboutDialog()
        },
        {
          label: "View format references",
          click: () => import_electron3.shell.openExternal("https://github.com/SnowyMouse/invader/wiki")
        }
      ]
    }
  ];
  import_electron3.Menu.setApplicationMenu(import_electron3.Menu.buildFromTemplate(template));
}
import_electron3.app.whenReady().then(() => {
  startWorker(sendLog);
  import_electron3.ipcMain.handle("dialog:openMap", () => openMapDialogFlow());
  import_electron3.ipcMain.handle("map:load", (_e, filePath) => openMapGuarded(filePath));
  import_electron3.ipcMain.handle("map:decompress", () => decompressFlow());
  import_electron3.ipcMain.handle("map:recompress", () => recompressFlow());
  import_electron3.ipcMain.handle("deps:get", (_e, originalIndices) => getDependenciesFlow(originalIndices));
  import_electron3.ipcMain.handle("tags:extract", (_e, request) => extractTagsFlow(request));
  import_electron3.ipcMain.on("tags:cancelExtract", () => {
    if (currentExtractRequestId) cancelWorkerRequest(currentExtractRequestId, sendLog);
  });
  import_electron3.ipcMain.handle("resourceMaps:pick", (_e, kind) => pickResourceMapFlow(kind));
  import_electron3.ipcMain.handle("resourceMaps:getStatuses", () => getResourceMapStatusesFlow());
  import_electron3.ipcMain.handle("tags:pickInjectContainer", () => pickInjectContainerFlow());
  import_electron3.ipcMain.handle("tags:planInject", (_e, containerPath, mode) => planInjectFlow(containerPath, mode));
  import_electron3.ipcMain.handle("tags:applyInject", () => applyInjectFlow());
  import_electron3.ipcMain.handle("tags:verifyEmbeddedData", () => verifyEmbeddedDataFlow());
  import_electron3.ipcMain.handle(SAVE_MAP_CHANNEL, () => runSaveMap());
  registerSaveMapAsIpc(import_electron3.ipcMain, saveMapAsDeps, afterSaveAs);
  import_electron3.ipcMain.handle("map:discard", () => discardChangesFlow());
  import_electron3.ipcMain.handle(
    "map:convertPreflight",
    (_e, source, resourcePaths) => convertPreflightFlow(source, resourcePaths && typeof resourcePaths === "object" ? resourcePaths : void 0)
  );
  import_electron3.ipcMain.handle("map:convert", (_e, acknowledgeScripts, repairs, resourcePaths) => runConvertMap(acknowledgeScripts, repairs, resourcePaths));
  import_electron3.ipcMain.handle("dialog:pickConvertResource", (_e, kind) => pickConvertResourceFlow(kind));
  import_electron3.ipcMain.handle("app:openContainingFolder", (_e, filePath) => {
    if (typeof filePath === "string" && filePath) import_electron3.shell.showItemInFolder(filePath);
  });
  import_electron3.ipcMain.handle("app:getSettings", () => getSettings());
  import_electron3.ipcMain.handle("app:version", () => import_electron3.app.getVersion());
  import_electron3.ipcMain.handle("app:recentMaps", () => getRecentMaps());
  import_electron3.ipcMain.on("app:notImplemented", (_e, feature) => sendLog("warn", `${feature} is not implemented yet (coming in a later milestone).`));
  import_electron3.ipcMain.handle("app:showAbout", () => showAboutDialog());
  createWindow();
  import_electron3.app.on("activate", () => {
    if (import_electron3.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
import_electron3.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") import_electron3.app.quit();
});
import_electron3.app.on("open-file", (_event, filePath) => {
  if (fs6.existsSync(filePath)) {
    openMapGuarded(filePath).then((r) => r && mainWindow?.webContents.send("map:loaded", r));
  }
});
//# sourceMappingURL=main.js.map
