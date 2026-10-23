import { parseCacheFileHeader } from './header';
import { parseTagIndex, resolveTagDataPointer } from './tag-index';
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
  recording_play: { index: 66, ret: 5, params: [38, 15] },
  recording_play_and_delete: { index: 67, ret: 5, params: [38, 15] },
  recording_play_and_hover: { index: 68, ret: 5, params: [39, 15] },
  recording_kill: { index: 69, ret: 4, params: [38] },
  recording_time: { index: 70, ret: 7, params: [38] },
  object_set_collideable: { index: 74, ret: 4, params: [37, 5] },
  object_set_scale: { index: 75, ret: 4, params: [37, 6, 7] },
  objects_attach: { index: 76, ret: 4, params: [37, 9, 37, 9] },
  objects_detach: { index: 77, ret: 4, params: [37, 37] },
  garbage_collect_now: { index: 78, ret: 4, params: [] },
  object_cannot_take_damage: { index: 79, ret: 4, params: [23] },
  object_can_take_damage: { index: 80, ret: 4, params: [23] },
  unit_open: { index: 94, ret: 4, params: [38] },
  unit_close: { index: 95, ret: 4, params: [38] },
  unit_kill: { index: 96, ret: 4, params: [38] },
  unit_kill_silent: { index: 97, ret: 4, params: [38] },
  unit_set_enterable_by_player: { index: 106, ret: 4, params: [38, 5] },
  unit_enter_vehicle: { index: 107, ret: 4, params: [38, 39, 9] },
  vehicle_test_seat_list: { index: 108, ret: 5, params: [39, 9, 23] },
  vehicle_test_seat: { index: 109, ret: 5, params: [39, 9, 38] },
  unit_exit_vehicle: { index: 111, ret: 4, params: [38] },
  unit_set_maximum_vitality: { index: 112, ret: 4, params: [38, 6, 6] },
  units_set_maximum_vitality: { index: 113, ret: 4, params: [23, 6, 6] },
  unit_set_current_vitality: { index: 114, ret: 4, params: [38, 6, 6] },
  units_set_current_vitality: { index: 115, ret: 4, params: [23, 6, 6] },
  vehicle_load_magic: { index: 116, ret: 7, params: [38, 9, 23] },
  vehicle_unload: { index: 117, ret: 7, params: [38, 9] },
  vehicle_riders: { index: 121, ret: 23, params: [38] },
  vehicle_driver: { index: 122, ret: 38, params: [38] },
  vehicle_gunner: { index: 123, ret: 38, params: [38] },
  unit_get_health: { index: 124, ret: 6, params: [38] },
  unit_get_shield: { index: 125, ret: 6, params: [38] },
  unit_get_total_grenade_count: { index: 126, ret: 7, params: [38] },
  unit_impervious: { index: 130, ret: 4, params: [23, 5] },
  device_set_never_appears_locked: { index: 136, ret: 4, params: [41, 5] },
  device_get_power: { index: 137, ret: 6, params: [41] },
  device_set_power: { index: 138, ret: 4, params: [41, 6] },
  device_set_position: { index: 139, ret: 5, params: [41, 6] },
  device_get_position: { index: 140, ret: 6, params: [41] },
  device_set_position_immediate: { index: 141, ret: 4, params: [41, 6] },
  ai_place: { index: 161, ret: 4, params: [17] },
  ai_kill: { index: 162, ret: 4, params: [17] },
  ai_kill_silent: { index: 163, ret: 4, params: [17] },
  ai_erase: { index: 164, ret: 4, params: [17] },
  ai_erase_all: { index: 165, ret: 4, params: [] },
  ai_set_respawn: { index: 169, ret: 4, params: [17, 5] },
  ai_set_deaf: { index: 170, ret: 4, params: [17, 5] },
  ai_set_blind: { index: 171, ret: 4, params: [17, 5] },
  ai_magically_see_encounter: { index: 172, ret: 4, params: [17, 17] },
  ai_magically_see_players: { index: 173, ret: 4, params: [17] },
  ai_magically_see_unit: { index: 174, ret: 4, params: [17, 38] },
  ai_attack: { index: 177, ret: 4, params: [17] },
  ai_defend: { index: 178, ret: 4, params: [17] },
  ai_retreat: { index: 179, ret: 4, params: [17] },
  ai_maneuver: { index: 180, ret: 4, params: [17] },
  ai_migrate: { index: 182, ret: 4, params: [17, 17] },
  ai_allegiance: { index: 185, ret: 4, params: [33, 33] },
  ai_allegiance_remove: { index: 186, ret: 4, params: [33, 33] },
  ai_living_count: { index: 187, ret: 7, params: [17] },
  ai_living_fraction: { index: 188, ret: 6, params: [17] },
  ai_strength: { index: 189, ret: 6, params: [17] },
  ai_actors: { index: 192, ret: 23, params: [17] },
  ai_go_to_vehicle: { index: 193, ret: 4, params: [17, 38, 9] },
  ai_exit_vehicle: { index: 196, ret: 4, params: [17] },
  ai_braindead: { index: 197, ret: 4, params: [17, 5] },
  ai_disregard: { index: 199, ret: 4, params: [23, 5] },
  ai_renew: { index: 203, ret: 4, params: [17] },
  ai_try_to_fight_player: { index: 206, ret: 4, params: [17] },
  ai_command_list: { index: 207, ret: 4, params: [17, 18] },
  ai_force_active: { index: 213, ret: 4, params: [17, 5] },
  camera_control: { index: 245, ret: 4, params: [5] },
  camera_set: { index: 246, ret: 4, params: [13, 7] },
  camera_set_relative: { index: 247, ret: 4, params: [13, 7, 37] },
  camera_set_animation: { index: 248, ret: 4, params: [28, 9] },
  camera_set_first_person: { index: 249, ret: 4, params: [38] },
  camera_set_dead: { index: 250, ret: 4, params: [38] },
  camera_time: { index: 251, ret: 7, params: [] },
  fade_in: { index: 292, ret: 4, params: [6, 6, 6, 7] },
  fade_out: { index: 293, ret: 4, params: [6, 6, 6, 7] },
  cinematic_start: { index: 294, ret: 4, params: [] },
  cinematic_stop: { index: 295, ret: 4, params: [] },
  cinematic_show_letterbox: { index: 298, ret: 4, params: [5] },
  cinematic_set_title: { index: 299, ret: 4, params: [14] },
  cinematic_set_title_delayed: { index: 300, ret: 4, params: [14, 6] },
  cinematic_suppress_bsp_object_creation: { index: 301, ret: 4, params: [5] },
  vehicle_hover: { index: 336, ret: 4, params: [39, 5] },
  sv_say: { index: 418, ret: 4, params: [9] },
  sv_end_game: { index: 419, ret: 4, params: [] },
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

/**
 * Ensures that the scenario has the requested `object names`, `trigger volumes`, and `cutscene camera points`
 * so any sample script can immediately reference them without manual reflexive table setup.
 */
export function ensureScenarioScriptEntities(
  view: Buffer,
  required: {
    objectNames?: string[];
    triggerVolumes?: string[];
    cameraPoints?: string[];
  },
): { buffer: Buffer; addedObjectNames: string[]; addedTriggerVolumes: string[]; addedCameraPoints: string[] } {
  let current: Buffer = Buffer.from(view);
  const header = parseCacheFileHeader(current);
  const tagIndex = parseTagIndex(current, header);
  const scenario = scenarioEntryOf(tagIndex);
  if (!scenario) {
    return { buffer: current, addedObjectNames: [], addedTriggerVolumes: [], addedCameraPoints: [] };
  }

  const decompiled = decompileScenarioScripts(current);
  const existingObj = new Set(decompiled.scenarioEntities.objectNames);
  const existingTrig = new Set(decompiled.scenarioEntities.triggerVolumes);
  const existingCam = new Set(decompiled.scenarioEntities.cutsceneCameraPoints);

  const addedObjectNames: string[] = [];
  const addedTriggerVolumes: string[] = [];
  const addedCameraPoints: string[] = [];

  let curHeader = header;
  let curTagIndex = tagIndex;

  for (const objName of required.objectNames ?? []) {
    if (existingObj.has(objName)) continue;
    const addRes = addReflexiveChunk(current, curHeader, curTagIndex, scenario.index, 'object names', -1);
    current = addRes.buffer;
    curHeader = addRes.header;
    curTagIndex = addRes.tagIndex;
    const idx = addRes.newElementIndex;
    writeTagFieldValue(current, curHeader, curTagIndex, scenario.index, `object names[${idx}].name`, objName);
    // Default runtime object type: 7 (machine) for door/gate/shutter names, 1 (vehicle) otherwise
    const defaultObjType = /door|gate|shutter|switch|lift|elevator/i.test(objName) ? 7 : 1;
    current.writeInt16LE(defaultObjType, addRes.newElementOffset + 32);
    current.writeInt16LE(-1, addRes.newElementOffset + 34);
    existingObj.add(objName);
    addedObjectNames.push(objName);
  }

  for (const trigName of required.triggerVolumes ?? []) {
    if (existingTrig.has(trigName)) continue;
    const addRes = addReflexiveChunk(current, curHeader, curTagIndex, scenario.index, 'trigger volumes', -1);
    current = addRes.buffer;
    curHeader = addRes.header;
    curTagIndex = addRes.tagIndex;
    const idx = addRes.newElementIndex;
    writeTagFieldValue(current, curHeader, curTagIndex, scenario.index, `trigger volumes[${idx}].name`, trigName);
    // Initialize valid trigger volume forward/up vectors and default 10x10x5 extents
    current.writeFloatLE(1.0, addRes.newElementOffset + 36); // forward.i
    current.writeFloatLE(1.0, addRes.newElementOffset + 56); // up.k
    current.writeFloatLE(10.0, addRes.newElementOffset + 72); // extents.x
    current.writeFloatLE(10.0, addRes.newElementOffset + 76); // extents.y
    current.writeFloatLE(5.0, addRes.newElementOffset + 80); // extents.z
    existingTrig.add(trigName);
    addedTriggerVolumes.push(trigName);
  }

  for (let c = 0; c < (required.cameraPoints ?? []).length; c++) {
    const camName = required.cameraPoints![c]!;
    if (existingCam.has(camName)) continue;
    const addRes = addReflexiveChunk(current, curHeader, curTagIndex, scenario.index, 'cutscene camera points', -1);
    current = addRes.buffer;
    curHeader = addRes.header;
    curTagIndex = addRes.tagIndex;
    const idx = addRes.newElementIndex;
    writeTagFieldValue(current, curHeader, curTagIndex, scenario.index, `cutscene camera points[${idx}].name`, camName);
    current.writeFloatLE(70.0, addRes.newElementOffset + 60); // field of view
    existingCam.add(camName);
    addedCameraPoints.push(camName);
  }

  return { buffer: current, addedObjectNames, addedTriggerVolumes, addedCameraPoints };
}

/**
 * Synchronizes `ScenarioObjectName` runtime `object type` (+32) and `object index` (+34)
 * from scenario placement blocks and script usage so OpenCE's `hs_parse_object_name`
 * never encounters `runtime_object_type == NONE` (-1) or a mismatched object type mask.
 */
function syncScenarioObjectNamesForScripts(
  buffer: Buffer,
  scnrAt: number,
  tagDataOffset: number,
  baseMemoryAddress: number,
  inferredObjectTypesByNameIdx: Map<number, number>,
): void {
  const scenarioStruct = getGroupStructName('scenario')!;
  const decoded = decodeStruct(buffer, scnrAt, scenarioStruct);
  const objNamesRef = decoded.get('object names');
  if (objNamesRef?.kind !== 'reflexive' || objNamesRef.value.count <= 0) return;

  const objNamesBase = resolvePointer(objNamesRef.value.pointerLow, tagDataOffset, baseMemoryAddress);
  if (!isRangeInBuffer(objNamesBase, objNamesRef.value.count * 36, buffer.length)) return;

  const placementBlocks: Array<{ block: string; objType: number }> = [
    { block: 'bipeds', objType: 0 },
    { block: 'vehicles', objType: 1 },
    { block: 'weapons', objType: 2 },
    { block: 'equipment', objType: 3 },
    { block: 'scenery', objType: 6 },
    { block: 'machines', objType: 7 },
    { block: 'controls', objType: 8 },
    { block: 'light fixtures', objType: 9 },
    { block: 'sound scenery', objType: 11 },
  ];

  const scnrDef = resolveStruct(scenarioStruct);
  for (const { block, objType } of placementBlocks) {
    const ref = decoded.get(block);
    const fieldDef = scnrDef.fields.find((f) => f.name === block);
    if (ref?.kind !== 'reflexive' || ref.value.count <= 0 || !fieldDef?.def.struct) continue;
    const childStruct = resolveStruct(fieldDef.def.struct);
    const nameField = childStruct.fields.find((f) => f.name === 'name');
    if (!nameField) continue;
    const blockBase = resolvePointer(ref.value.pointerLow, tagDataOffset, baseMemoryAddress);
    if (!isRangeInBuffer(blockBase, ref.value.count * childStruct.totalSize, buffer.length)) continue;
    for (let i = 0; i < ref.value.count; i++) {
      const nameIdx = buffer.readInt16LE(blockBase + i * childStruct.totalSize + nameField.offset);
      if (nameIdx >= 0 && nameIdx < objNamesRef.value.count) {
        const entryOff = objNamesBase + nameIdx * 36;
        buffer.writeInt16LE(objType, entryOff + 32);
        buffer.writeInt16LE(i, entryOff + 34);
      }
    }
  }

  for (let i = 0; i < objNamesRef.value.count; i++) {
    const entryOff = objNamesBase + i * 36;
    const curType = buffer.readInt16LE(entryOff + 32);
    const inferred = inferredObjectTypesByNameIdx.get(i);
    if (inferred !== undefined) {
      // Ensure the stored object_type satisfies the script's required hs_object_type_masks
      if (inferred === 7 && (curType < 7 || curType > 9)) {
        buffer.writeInt16LE(7, entryOff + 32);
      } else if (inferred === 1 && curType !== 1 && curType !== 0) {
        buffer.writeInt16LE(1, entryOff + 32);
      } else if (curType < 0) {
        buffer.writeInt16LE(inferred, entryOff + 32);
      }
    } else if (curType < 0) {
      buffer.writeInt16LE(1, entryOff + 32);
    }
  }
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

  const { expressions } = parseHaloScriptSExpressions(hscSource);
  const currentDecompiled = decompileScenarioScripts(view);
  const entities = currentDecompiled.scenarioEntities;
  const inferredObjectTypesByNameIdx = new Map<number, number>();

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

      // Check if global reference
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

      // Check if script reference (for `wake` or `sleep`)
      if (expectedType === 10) {
        const scriptIdx = scripts.findIndex((s) => s.name === text);
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

      // Check scenario entity tables (object names, trigger volumes, camera points)
      const objIdx = entities.objectNames.indexOf(text);
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

      const trigIdx = entities.triggerVolumes.indexOf(text);
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

      const camIdx = entities.cutsceneCameraPoints.indexOf(text);
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

      // Symbolic constant / team / AI / identifier atom
      const symType = expectedType && expectedType !== 4 ? expectedType : 9;
      return allocNode({
        indexUnion: symType,
        type: symType,
        flags: FLAG_PERMANENT | FLAG_PRIMITIVE,
        nextNode: NONE,
        stringOffset: strOffset,
        dataUInt32: text === 'none' ? NONE : strOffset,
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
    const staticScriptIdx = scripts.findIndex((s) => s.name === fnName);
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

  // Serialize compiled tables into the scenario tag at the end of the map buffer
  const header = parseCacheFileHeader(view);
  const tagIndex = parseTagIndex(view, header);
  const scenario = scenarioEntryOf(tagIndex);
  const scenarioStruct = getGroupStructName('scenario')!;
  if (!scenario) {
    return { buffer: view, compiledScripts: 0, compiledGlobals: 0, syntaxNodesUsed: 0, diagnostics };
  }

  const scnrAt = resolveTagDataPointer(scenario.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  if (!isRangeInBuffer(scnrAt, resolveStruct(scenarioStruct).totalSize, view.length)) {
    return { buffer: view, compiledScripts: 0, compiledGlobals: 0, syntaxNodesUsed: 0, diagnostics };
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

  // Align relative to header.tagDataOffset so memory pointers are 4-byte aligned
  const padBytes = (4 - ((view.length - header.tagDataOffset) % 4)) % 4;
  const padBuf = Buffer.alloc(padBytes, 0);
  const appendStart = view.length + padBytes;

  const globalsFileOffset = appendStart;
  const scriptsFileOffset = globalsFileOffset + globalsBlock.length;
  const stringsFileOffset = scriptsFileOffset + scriptsBlock.length;
  const syntaxFileOffset = stringsFileOffset + stringDataBlock.length;

  const toMemoryPtr = (fileOffset: number) =>
    (tagIndex.baseMemoryAddress + (fileOffset - header.tagDataOffset)) >>> 0;

  const outBuffer = Buffer.concat([
    view,
    padBuf,
    globalsBlock,
    scriptsBlock,
    stringDataBlock,
    syntaxBlock,
  ]);

  // Synchronize ScenarioObjectName runtime types so hs_parse_object_name succeeds on load
  syncScenarioObjectNamesForScripts(
    outBuffer,
    scnrAt,
    header.tagDataOffset,
    tagIndex.baseMemoryAddress,
    inferredObjectTypesByNameIdx,
  );

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
