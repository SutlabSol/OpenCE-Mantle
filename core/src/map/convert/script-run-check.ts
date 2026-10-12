import type { CacheFileHeader } from '../header';
import type { TagIndex } from '../tag-index';
import { resolveTagDataPointer } from '../tag-index';
import { decodeStruct, getGroupStructName, isRangeInBuffer, resolvePointer, resolveStruct } from '../definitions/engine';
import { DATA_ARRAY_COUNT, DATA_ARRAY_HEADER_SIZE, SCRIPT_NODE_SIZE } from './tag-data-repairs';
import { scenarioEntryOf } from './scenario-tag';

/**
 * Scripts OpenCE can run (PRD 2026-10-12). OpenCE's `hs_evaluate_begin_random` (source/hs/hs_runtime.c
 * l.2370-2400, build 185, commit 6399ed9) counts a begin_random call's arguments (the next-node chain
 * after its function name node), asserts the count is below LONG_BITS (32), and keeps one "already
 * evaluated" bit per argument in `BIT_VECTOR_SIZE_IN_BYTES(count)` bytes of a stack slot of one 32-bit
 * long:
 *   - 33 or more arguments overrun that slot in every build: refused;
 *   - exactly 32 fit, but the assert fails: a release build (HALO_RELEASE) logs "EXCEPTION assert ...
 *     (release build)" and carries on; any other build halts (`display_assert`, source/cseries/cseries.c):
 *     a warning. Seen: HaloMD yoyorastv2_1, script "randomize teleport", 32 `begin` arguments (the debug
 *     build halted there);
 *   - an argument chain that never ends would never finish counting: refused.
 * The function is found by its name in the script strings (OpenCE renumbers every call by name, so the
 * stored index is not used). Calls are the used nodes (`count` at data_array +0x2E) that are neither
 * primitives nor script calls; their first child is the function name node.
 */

const MAXIMUM_RANDOM_ARGUMENTS = 32;
const NONE = 0xffffffff;
const FLAG_PRIMITIVE = 0x1;
const FLAG_SCRIPT_CALL = 0x2;
/** hs_syntax_node: +6 flags, +8 next node, +12 string offset, +16 data (first child). */
const NODE_FLAGS = 0x6;
const NODE_NEXT = 0x8;
const NODE_STRING = 0xc;
const NODE_DATA = 0x10;

export interface ScriptRunFinding {
  node: number;
  /** The script whose expression tree holds the call, or null (a global's initial value, or no script). */
  script: string | null;
  functionName: string;
  /** Arguments counted; null when the chain does not end. */
  argumentCount: number | null;
  severity: 'refuse' | 'warn';
  text: string;
}

export interface ScriptRunReport {
  findings: ScriptRunFinding[];
  /** begin_random calls checked. */
  randomCalls: number;
  /** False when there is no script node table to read (nothing to check). */
  hasScripts: boolean;
}

export function checkScriptsOpenCECanRun(view: Buffer, header: CacheFileHeader, tagIndex: TagIndex): ScriptRunReport {
  const report: ScriptRunReport = { findings: [], randomCalls: 0, hasScripts: false };
  const scenario = scenarioEntryOf(tagIndex);
  const scenarioStruct = getGroupStructName('scenario')!;
  if (!scenario) return report;
  const at = resolveTagDataPointer(scenario.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  if (!isRangeInBuffer(at, resolveStruct(scenarioStruct).totalSize, view.length)) return report;
  const decoded = decodeStruct(view, at, scenarioStruct);
  const syntax = decoded.get('script syntax data');
  const strings = decoded.get('script string data');
  if (syntax?.kind !== 'tagDataOffset' || syntax.value.size < DATA_ARRAY_HEADER_SIZE) return report;
  const tableAt = resolvePointer(syntax.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
  if (!isRangeInBuffer(tableAt, syntax.value.size, view.length)) return report;
  const used = view.readInt16LE(tableAt + DATA_ARRAY_COUNT);
  if (used <= 0 || DATA_ARRAY_HEADER_SIZE + used * SCRIPT_NODE_SIZE > syntax.value.size) return report;
  report.hasScripts = true;
  let stringsAt = -1;
  let stringBytes = 0;
  if (strings?.kind === 'tagDataOffset' && strings.value.size > 0) {
    stringsAt = resolvePointer(strings.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    stringBytes = isRangeInBuffer(stringsAt, strings.value.size, view.length) ? strings.value.size : 0;
  }
  const node = (i: number) => tableAt + DATA_ARRAY_HEADER_SIZE + i * SCRIPT_NODE_SIZE;
  const nameAt = (offset: number): string | null => {
    if (offset < 0 || offset >= stringBytes) return null;
    const end = view.indexOf(0, stringsAt + offset);
    return end >= 0 && end < stringsAt + stringBytes ? view.toString('latin1', stringsAt + offset, end) : null;
  };
  const scriptOf = scriptOwners(view, header, tagIndex, decoded, scenarioStruct, used, node);

  for (let i = 0; i < used; i++) {
    const n = node(i);
    if (view.readUInt16LE(n) === 0) continue;
    if (view.readUInt16LE(n + NODE_FLAGS) & (FLAG_PRIMITIVE | FLAG_SCRIPT_CALL)) continue;
    const child = view.readUInt32LE(n + NODE_DATA) & 0xffff;
    if (child >= used) continue; // the "Script calls name their functions" row refuses this
    const functionName = nameAt(view.readInt32LE(node(child) + NODE_STRING));
    if (functionName !== 'begin_random') continue;
    report.randomCalls++;
    // OpenCE: count = the length of the name node's next chain.
    let count = 0;
    let next = view.readUInt32LE(node(child) + NODE_NEXT);
    const seen = new Set<number>();
    let ends = true;
    while (next !== NONE) {
      const k = next & 0xffff;
      if (k >= used || seen.has(k)) {
        ends = false;
        break;
      }
      seen.add(k);
      count++;
      next = view.readUInt32LE(node(k) + NODE_NEXT);
    }
    const script = scriptOf.get(i) ?? null;
    const where = `${script === null ? 'no script (a global or unused node)' : `script "${script}"`}, node ${i}`;
    if (!ends) {
      report.findings.push({ node: i, script, functionName, argumentCount: null, severity: 'refuse', text: `${where}: begin_random's argument list never ends; OpenCE would never finish counting it` });
    } else if (count > MAXIMUM_RANDOM_ARGUMENTS) {
      report.findings.push({ node: i, script, functionName, argumentCount: count, severity: 'refuse', text: `${where}: begin_random with ${count} arguments; OpenCE keeps one bit per argument in 32 bits, so more than 32 overrun its memory` });
    } else if (count === MAXIMUM_RANDOM_ARGUMENTS) {
      report.findings.push({ node: i, script, functionName, argumentCount: count, severity: 'warn', text: `${where}: begin_random with 32 arguments; OpenCE asserts fewer than 32 (they still fit its 32 bits)` });
    }
  }
  return report;
}

/** Node index -> the script whose expression tree holds it (each script's root expression, following children and next nodes). */
function scriptOwners(
  view: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  scenario: ReturnType<typeof decodeStruct>,
  scenarioStruct: string,
  used: number,
  node: (i: number) => number,
): Map<number, string> {
  const owners = new Map<number, string>();
  const scripts = scenario.get('scripts');
  const field = resolveStruct(scenarioStruct).fields.find((f) => f.name === 'scripts');
  const elementStruct = field?.def.type === 'TagReflexive' ? field.def.struct : undefined;
  if (scripts?.kind !== 'reflexive' || !elementStruct) return owners;
  const element = resolveStruct(elementStruct);
  const rootField = element.fields.find((f) => /root expression/.test(f.name));
  if (!rootField) return owners;
  for (let s = 0; s < scripts.value.count; s++) {
    const at = resolvePointer((scripts.value.pointerLow + s * element.totalSize) >>> 0, header.tagDataOffset, tagIndex.baseMemoryAddress);
    if (!isRangeInBuffer(at, element.totalSize, view.length)) break;
    const end = view.indexOf(0, at);
    const name = view.toString('latin1', at, end >= at && end < at + 32 ? end : at + 32);
    const stack = [view.readUInt32LE(at + rootField.offset)];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (id === NONE) continue;
      const i = id & 0xffff;
      if (i >= used || owners.has(i)) continue;
      owners.set(i, name);
      const n = node(i);
      stack.push(view.readUInt32LE(n + NODE_NEXT));
      if (!(view.readUInt16LE(n + NODE_FLAGS) & FLAG_PRIMITIVE)) stack.push(view.readUInt32LE(n + NODE_DATA));
    }
  }
  return owners;
}
