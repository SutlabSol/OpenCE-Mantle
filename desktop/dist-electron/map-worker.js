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

// electron/map-worker.ts
var import_worker_threads = require("worker_threads");
var fs = __toESM(require("fs"));

// ../core/src/constants/cache-file.ts
var CHIMERA_COMPRESSED_ENGINE_MASK = 2249850880;
var TAG_STRING_SIZE = 32;
var CACHE_FILE_HEADER_SIZE = 2048;
var TAG_DATA_HEADER_PC_SIZE = 40;
var TAG_ENTRY_SIZE = 32;

// ../core/src/constants/tag-classes.ts
function fourCCFromString(code) {
  if (code.length !== 4) {
    throw new Error(`FourCC must be exactly 4 characters, got "${code}" (${code.length})`);
  }
  return (code.charCodeAt(0) << 24 | code.charCodeAt(1) << 16 | code.charCodeAt(2) << 8 | code.charCodeAt(3)) >>> 0;
}
function fourCCToString(value) {
  return String.fromCharCode(
    value >>> 24 & 255,
    value >>> 16 & 255,
    value >>> 8 & 255,
    value & 255
  );
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
var TAG_CLASS_NONE = 4294967295;
function lookupTagClass(fourcc) {
  return CLASS_BY_FOURCC.get(fourcc) ?? null;
}

// ../core/src/map/errors.ts
var CorruptMapError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "CorruptMapError";
  }
};
var KNOWN_ENGINE_NAMES = {
  5: "Halo: Combat Evolved (Xbox)",
  6: "Halo PC Demo",
  7: "Halo PC Retail (version 7)",
  13: "Halo: Combat Evolved Anniversary (MCC)",
  6790: "Native/MCC internal format"
};
var UnsupportedMapVersionError = class extends Error {
  constructor(engineValue) {
    const known = KNOWN_ENGINE_NAMES[engineValue];
    super(
      known ? `This is a ${known} map. OpenCE Modding Tool only supports Halo: Custom Edition PC maps (version 609).` : `Unrecognized map version/engine (0x${engineValue.toString(16)}). Only Halo: Custom Edition PC maps (version 609) are supported.`
    );
    this.engineValue = engineValue;
    this.name = "UnsupportedMapVersionError";
  }
};
var NotCompressedMapError = class extends Error {
  constructor() {
    super("This map is not compressed; there is nothing to decompress.");
    this.name = "NotCompressedMapError";
  }
};

// ../core/src/binary/strings.ts
function readFixedString(buffer, offset, length) {
  const slice = buffer.subarray(offset, offset + length);
  const nullIndex = slice.indexOf(0);
  const trimmed = nullIndex === -1 ? slice : slice.subarray(0, nullIndex);
  return trimmed.toString("ascii");
}
function readCString(buffer, offset) {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) {
    end++;
  }
  return buffer.toString("ascii", offset, end);
}

// ../core/src/map/header.ts
function hasValidMagic(buffer) {
  if (buffer.length < CACHE_FILE_HEADER_SIZE) {
    return false;
  }
  return buffer.readUInt32LE(0) === 1751474532 /* HEAD */ && buffer.readUInt32LE(2044) === 1718579060 /* FOOT */;
}
function isChimeraCompressedCustomEdition(buffer) {
  if (!hasValidMagic(buffer)) {
    return false;
  }
  const engine = buffer.readUInt32LE(4);
  return (engine & 4294901760) >>> 0 === CHIMERA_COMPRESSED_ENGINE_MASK && (engine & 65535) === 609 /* CUSTOM_EDITION */;
}
function parseCacheFileHeader(buffer) {
  if (buffer.length < CACHE_FILE_HEADER_SIZE) {
    throw new CorruptMapError(
      `File is only ${buffer.length} bytes; a Halo CE map header is at least ${CACHE_FILE_HEADER_SIZE} bytes.`
    );
  }
  if (!hasValidMagic(buffer)) {
    throw new CorruptMapError('Missing "head"/"foot" magic values. This does not look like a Halo map file.');
  }
  const engine = buffer.readUInt32LE(4);
  if (engine !== 609 /* CUSTOM_EDITION */) {
    throw new UnsupportedMapVersionError(engine);
  }
  return {
    engine,
    decompressedFileSize: buffer.readUInt32LE(8),
    compressedPadding: buffer.readUInt32LE(12),
    tagDataOffset: buffer.readUInt32LE(16),
    tagDataSize: buffer.readUInt32LE(20),
    scenarioName: readFixedString(buffer, 32, TAG_STRING_SIZE),
    buildString: readFixedString(buffer, 64, TAG_STRING_SIZE),
    mapType: buffer.readUInt16LE(96),
    crc32: buffer.readUInt32LE(100)
  };
}

// ../core/src/map/tag-index.ts
function resolveTagDataPointer(pointer, header, baseMemoryAddress) {
  return header.tagDataOffset + (pointer - baseMemoryAddress);
}
function parseTagIndex(buffer, header) {
  const tagDataHeaderOffset = header.tagDataOffset;
  if (tagDataHeaderOffset + TAG_DATA_HEADER_PC_SIZE > buffer.length) {
    throw new CorruptMapError("Tag data offset from the header is out of bounds of the file.");
  }
  const tagArrayAddress = buffer.readUInt32LE(tagDataHeaderOffset + 0);
  const scenarioTagId = buffer.readUInt32LE(tagDataHeaderOffset + 4);
  const tagFileChecksums = buffer.readUInt32LE(tagDataHeaderOffset + 8);
  const tagCount = buffer.readUInt32LE(tagDataHeaderOffset + 12);
  const modelPartCount = buffer.readUInt32LE(tagDataHeaderOffset + 16);
  const modelDataFileOffset = buffer.readUInt32LE(tagDataHeaderOffset + 20);
  const vertexSize = buffer.readUInt32LE(tagDataHeaderOffset + 28);
  const modelDataSize = buffer.readUInt32LE(tagDataHeaderOffset + 32);
  const tagArrayFileOffset = tagDataHeaderOffset + TAG_DATA_HEADER_PC_SIZE;
  const baseMemoryAddress = tagArrayAddress - tagArrayFileOffset + header.tagDataOffset >>> 0;
  if (tagArrayFileOffset + tagCount * TAG_ENTRY_SIZE > buffer.length) {
    throw new CorruptMapError("Tag count from the tag index is out of bounds of the file (map may be corrupt).");
  }
  const entries = [];
  for (let i = 0; i < tagCount; i++) {
    const entryOffset = tagArrayFileOffset + i * TAG_ENTRY_SIZE;
    const primaryClassFourCC = buffer.readUInt32LE(entryOffset + 0);
    const secondaryClassFourCC = buffer.readUInt32LE(entryOffset + 4);
    const tertiaryClassFourCC = buffer.readUInt32LE(entryOffset + 8);
    const tagId = buffer.readUInt32LE(entryOffset + 12);
    const tagPathPointer = buffer.readUInt32LE(entryOffset + 16);
    const tagDataPointerOrResourceIndex = buffer.readUInt32LE(entryOffset + 20);
    const isExternal = buffer.readUInt32LE(entryOffset + 24) === 1;
    const pathFileOffset = resolveTagDataPointer(tagPathPointer, header, baseMemoryAddress);
    if (pathFileOffset < 0 || pathFileOffset >= buffer.length) {
      throw new CorruptMapError(`Tag #${i}: path pointer resolves outside of the file; map may be corrupt or protected.`);
    }
    const path = readCString(buffer, pathFileOffset);
    entries.push({
      index: i,
      tagId,
      primaryClassFourCC,
      secondaryClassFourCC: secondaryClassFourCC === TAG_CLASS_NONE ? null : secondaryClassFourCC,
      tertiaryClassFourCC: tertiaryClassFourCC === TAG_CLASS_NONE ? null : tertiaryClassFourCC,
      primaryClassName: lookupTagClass(primaryClassFourCC)?.name ?? fourCCToString(primaryClassFourCC),
      path,
      isExternal,
      tagDataPointerOrResourceIndex
    });
  }
  return {
    scenarioTagId,
    tagChecksum: tagFileChecksums,
    tagCount,
    modelPartCount,
    modelDataFileOffset,
    vertexSize,
    modelDataSize,
    baseMemoryAddress,
    entries
  };
}

// ../core/src/map/tag-footprints.ts
var SCENARIO_STRUCTURE_BSP_FOURCC = fourCCFromString("sbsp");
function estimateTagFootprints(header, tagIndex) {
  const tagDataEnd = header.tagDataOffset + header.tagDataSize;
  const internalOffsets = tagIndex.entries.filter((e) => !e.isExternal && e.primaryClassFourCC !== SCENARIO_STRUCTURE_BSP_FOURCC).map((e) => ({
    index: e.index,
    offset: resolveTagDataPointer(e.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress)
  })).sort((a, b) => a.offset - b.offset);
  const footprintByIndex = /* @__PURE__ */ new Map();
  for (let i = 0; i < internalOffsets.length; i++) {
    const next = i + 1 < internalOffsets.length ? internalOffsets[i + 1].offset : tagDataEnd;
    footprintByIndex.set(internalOffsets[i].index, Math.max(0, next - internalOffsets[i].offset));
  }
  return tagIndex.entries.map((e) => ({
    tagIndex: e.index,
    estimatedSize: e.isExternal || e.primaryClassFourCC === SCENARIO_STRUCTURE_BSP_FOURCC ? null : footprintByIndex.get(e.index) ?? null
  }));
}

// ../core/src/map/open-map.ts
function inspectCustomEditionMap(buffer) {
  if (isChimeraCompressedCustomEdition(buffer)) {
    return { status: "compressed" };
  }
  try {
    const header = parseCacheFileHeader(buffer);
    const tagIndex = parseTagIndex(buffer, header);
    return { status: "ok", header, tagIndex };
  } catch (error) {
    if (error instanceof UnsupportedMapVersionError) {
      return { status: "unsupported", message: error.message };
    }
    throw error;
  }
}

// ../core/src/map/compression.ts
var import_zstd = require("@mongodb-js/zstd");
var CUSTOM_EDITION_COMPRESSED_ENGINE = (609 /* CUSTOM_EDITION */ | CHIMERA_COMPRESSED_ENGINE_MASK) >>> 0;
async function compressCustomEditionMap(buffer, level = 19) {
  parseCacheFileHeader(buffer);
  const body = buffer.subarray(CACHE_FILE_HEADER_SIZE);
  const compressedBody = await (0, import_zstd.compress)(Buffer.from(body), level);
  const output = Buffer.alloc(CACHE_FILE_HEADER_SIZE + compressedBody.length);
  buffer.copy(output, 0, 0, CACHE_FILE_HEADER_SIZE);
  output.writeUInt32LE(CUSTOM_EDITION_COMPRESSED_ENGINE, 4);
  compressedBody.copy(output, CACHE_FILE_HEADER_SIZE);
  return output;
}
async function decompressCustomEditionMap(buffer) {
  if (!hasValidMagic(buffer)) {
    throw new CorruptMapError('Missing "head"/"foot" magic values. This does not look like a Halo map file.');
  }
  if (!isChimeraCompressedCustomEdition(buffer)) {
    throw new NotCompressedMapError();
  }
  if (buffer.length <= CACHE_FILE_HEADER_SIZE) {
    throw new CorruptMapError("Compressed map has no body data after the header.");
  }
  const compressedBody = buffer.subarray(CACHE_FILE_HEADER_SIZE);
  const decompressedBody = await (0, import_zstd.decompress)(Buffer.from(compressedBody));
  const output = Buffer.alloc(CACHE_FILE_HEADER_SIZE + decompressedBody.length);
  buffer.copy(output, 0, 0, CACHE_FILE_HEADER_SIZE);
  output.writeUInt32LE(609 /* CUSTOM_EDITION */, 4);
  decompressedBody.copy(output, CACHE_FILE_HEADER_SIZE);
  return output;
}

// electron/map-worker.ts
function progress(taskId, stage, percent) {
  import_worker_threads.parentPort?.postMessage({ type: "progress", taskId, stage, percent });
}
async function runInspect(task) {
  progress(task.taskId, "Reading file", 10);
  const buffer = fs.readFileSync(task.filePath);
  progress(task.taskId, "Parsing header and tag index", 50);
  const result = inspectCustomEditionMap(buffer);
  let payload;
  if (result.status === "ok") {
    const footprints = estimateTagFootprints(result.header, result.tagIndex);
    const sizeByIndex = new Map(footprints.map((f) => [f.tagIndex, f.estimatedSize]));
    payload = {
      status: "ok",
      filePath: task.filePath,
      header: {
        scenarioName: result.header.scenarioName,
        buildString: result.header.buildString,
        mapType: result.header.mapType,
        crc32: result.header.crc32,
        tagDataOffset: result.header.tagDataOffset,
        tagDataSize: result.header.tagDataSize,
        decompressedFileSize: result.header.decompressedFileSize,
        fileSizeOnDisk: buffer.length,
        tagCount: result.tagIndex.tagCount
      },
      tags: result.tagIndex.entries.map((e) => ({
        index: e.index,
        tagId: e.tagId,
        primaryClassName: e.primaryClassName ?? "?",
        path: e.path,
        isExternal: e.isExternal,
        estimatedSize: sizeByIndex.get(e.index) ?? null
      }))
    };
  } else if (result.status === "compressed") {
    payload = { status: "compressed", filePath: task.filePath };
  } else {
    payload = { status: "unsupported", filePath: task.filePath, message: result.message };
  }
  progress(task.taskId, "Done", 100);
  import_worker_threads.parentPort?.postMessage({ type: "result", taskId: task.taskId, payload });
}
async function runCompression(task) {
  progress(task.taskId, "Reading file", 10);
  const buffer = fs.readFileSync(task.filePath);
  progress(task.taskId, task.type === "decompress" ? "Decompressing (zstd)" : "Compressing (zstd level 19)", 35);
  const output = task.type === "decompress" ? await decompressCustomEditionMap(buffer) : await compressCustomEditionMap(buffer, 19);
  progress(task.taskId, "Writing output file", 85);
  fs.writeFileSync(task.outputPath, output);
  progress(task.taskId, "Done", 100);
  import_worker_threads.parentPort?.postMessage({
    type: "result",
    taskId: task.taskId,
    payload: { outputPath: task.outputPath, originalSize: buffer.length, newSize: output.length }
  });
}
import_worker_threads.parentPort?.on("message", async (task) => {
  try {
    if (task.type === "inspect") {
      await runInspect(task);
    } else {
      await runCompression(task);
    }
  } catch (err) {
    import_worker_threads.parentPort?.postMessage({
      type: "error",
      taskId: task.taskId,
      message: err instanceof Error ? err.message : String(err)
    });
  }
});
//# sourceMappingURL=map-worker.js.map
