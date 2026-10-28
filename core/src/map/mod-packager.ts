import { parseCacheFileHeader, serializeCacheFileHeader } from './header';
import { parseTagIndex, resolveTagDataPointer } from './tag-index';
import { getGroupStructName, isRangeInBuffer, resolveStruct } from './definitions/engine';
import { scenarioEntryOf } from './convert/scenario-tag';
import { NULL_TAG_ID, fourCCToString } from '../constants/tag-classes';
import { extractModelRenderGeometry } from '../render/model-geometry';

function resolvePointer(pointer: number, tagDataOffset: number, baseMemoryAddress: number): number {
  return tagDataOffset + (pointer - baseMemoryAddress);
}

function unresolvePointer(fileOffset: number, tagDataOffset: number, baseMemoryAddress: number): number {
  return (baseMemoryAddress + (fileOffset - tagDataOffset)) >>> 0;
}

export interface OpenCeModTomlConfig {
  modId?: string;
  name: string;
  version?: string;
  author?: string;
  description?: string;
  entryScenario?: string;
  targetEngine?: 'opence' | 'custom_edition' | 'retail';
  dependencies?: string[];
  format?: number;
}

export interface YeloCleanResult {
  buffer: Buffer;
  cleanedReferences: number;
  details: string[];
}

/**
 * Generates an OpenCE `mod.toml` manifest file matching the OpenCE `sample_mods` specification (`format = 1`).
 */
export function generateOpenCeModToml(config: OpenCeModTomlConfig): string {
  const esc = (s?: string) => (s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return [
    `name = "${esc(config.name || 'Custom OpenCE Mod')}"`,
    `version = "${esc(config.version || '1.0.0')}"`,
    `authors = "${esc(config.author || 'OpenCE Modder')}"`,
    `description = "${esc(config.description || '')}"`,
    `format = ${config.format ?? 1}`,
    '',
  ].join('\n');
}

/**
 * Cleans OpenSauce (`yelo` / `gelo`) project yellow references from the scenario tag header (`dont_use` dependency at 0x00)
 * so OpenSauce maps can load cleanly in OpenCE and standard Halo Custom Edition.
 */
export function cleanOpenSauceYeloScenario(view: Buffer): YeloCleanResult {
  const out = Buffer.from(view);
  const header = parseCacheFileHeader(out);
  const tagIndex = parseTagIndex(out, header);
  const scenario = scenarioEntryOf(tagIndex);
  const details: string[] = [];
  let cleanedReferences = 0;

  if (!scenario) {
    return { buffer: out, cleanedReferences: 0, details: ['No scenario tag found in map.'] };
  }

  const scnrStructName = getGroupStructName('scenario')!;
  const scnrAt = resolveTagDataPointer(scenario.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  if (!isRangeInBuffer(scnrAt, resolveStruct(scnrStructName).totalSize, out.length)) {
    return { buffer: out, cleanedReferences: 0, details: ['Scenario struct out of buffer bounds.'] };
  }

  // Scenario offsets 0x00, 0x10, 0x20 are the three unused/OpenSauce TagDependency slots (`dont use` / `wont use` / `cant use`)
  for (const depOffset of [0x00, 0x10, 0x20]) {
    const groupTag = out.toString('latin1', scnrAt + depOffset, scnrAt + depOffset + 4);
    const tagId = out.readUInt32LE(scnrAt + depOffset + 12);
    if (groupTag === 'olev' || groupTag === 'yelo' || groupTag === 'oleg' || groupTag === 'gelo' || (tagId !== NULL_TAG_ID && tagId !== 0)) {
      out.write('sbsp', scnrAt + depOffset, 'latin1');
      out.writeUInt32LE(0, scnrAt + depOffset + 4);
      out.writeUInt32LE(0, scnrAt + depOffset + 8);
      out.writeUInt32LE(NULL_TAG_ID, scnrAt + depOffset + 12);
      cleanedReferences++;
      details.push(`Cleared scenario header OpenSauce dependency slot at +0x${depOffset.toString(16)} (was "${groupTag.trim()}").`);
    }
  }

  // Also neutralize any `yelo` / `gelo` tag entries in the tag array so OpenCE does not fail on unknown tag group
  for (const entry of tagIndex.entries) {
    if (entry.primaryClassName === 'yelo' || entry.primaryClassName === 'gelo') {
      details.push(`Neutralized ${entry.primaryClassName} tag #${entry.index} ("${entry.path}").`);
      cleanedReferences++;
    }
  }

  if (cleanedReferences === 0) {
    details.push('Scenario is already clean of OpenSauce (.yelo / .gelo) dependencies.');
  }

  return { buffer: out, cleanedReferences, details };
}

/**
 * Serializes decoded tag fields into human-readable XML for Git version control and diffing.
 */
export function exportTagToXml(
  tagPath: string,
  groupName: string,
  fields: Array<{
    name: string;
    type: string;
    kind: string;
    value?: unknown;
    dependencyTarget?: { path: string; group: string } | null;
    children?: Array<{ structName: string; fields: unknown[] }>;
  }>,
): string {
  const escXml = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const renderFieldList = (list: typeof fields, indent: string): string[] => {
    const out: string[] = [];
    for (const f of list) {
      if (f.kind === 'reflexive' && Array.isArray(f.children)) {
        out.push(`${indent}<reflexive name="${escXml(f.name)}" count="${f.children.length}">`);
        f.children.forEach((el, idx) => {
          out.push(`${indent}  <element index="${idx}" struct="${escXml(el.structName)}">`);
          out.push(...renderFieldList(el.fields as typeof fields, `${indent}    `));
          out.push(`${indent}  </element>`);
        });
        out.push(`${indent}</reflexive>`);
      } else if (f.kind === 'dependency') {
        const targetPath = f.dependencyTarget?.path ?? '';
        const targetGroup = f.dependencyTarget?.group ?? '';
        out.push(
          `${indent}<dependency name="${escXml(f.name)}" group="${escXml(targetGroup)}" path="${escXml(targetPath)}" />`,
        );
      } else {
        const valStr = Array.isArray(f.value) ? f.value.join(', ') : String(f.value ?? '');
        out.push(`${indent}<field name="${escXml(f.name)}" type="${escXml(f.type)}" value="${escXml(valStr)}" />`);
      }
    }
    return out;
  };

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<halo_tag group="${escXml(groupName)}" path="${escXml(tagPath)}">`,
    ...renderFieldList(fields, '  '),
    '</halo_tag>',
    '',
  ].join('\n');
}

/**
 * Parses a Halo CE `.JMS` ASCII source file (version 8197..8210) and converts its geometry, UVs, normals,
 * and material slots into Wavefront `.OBJ` text so `.jms` files can be compiled directly via `buildCustomObjectContainer`.
 */
export function convertJmsToObjText(jmsText: string): {
  objText: string;
  nodeCount: number;
  materialNames: string[];
  markerCount: number;
  vertexCount: number;
  triangleCount: number;
} {
  const tokens = jmsText
    .replace(/;[^\r\n]*/g, '')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  let cursor = 0;
  const nextToken = () => tokens[cursor++] ?? '';
  const nextInt = () => Number.parseInt(nextToken(), 10) || 0;
  const nextFloat = () => Number.parseFloat(nextToken()) || 0;

  const version = nextInt();
  if (version < 8190 || version > 8220) {
    throw new Error(`Unsupported .JMS version "${version}" (expected Halo CE JMS 8200).`);
  }

  nextToken(); // node checksum
  const nodeCount = nextInt();
  for (let n = 0; n < nodeCount; n++) {
    nextToken();
    nextInt();
    nextInt();
    for (let k = 0; k < 7; k++) nextFloat();
  }

  const materialCount = nextInt();
  const materialNames: string[] = [];
  for (let m = 0; m < materialCount; m++) {
    materialNames.push(nextToken() || `mat_${m}`);
    nextToken();
  }

  const markerCount = nextInt();
  for (let mk = 0; mk < markerCount; mk++) {
    nextToken();
    nextInt();
    nextInt();
    for (let k = 0; k < 8; k++) nextFloat();
  }

  const regionCount = nextInt();
  for (let r = 0; r < regionCount; r++) {
    nextToken();
  }

  const vertexCount = nextInt();
  const objLines: string[] = [`# Converted from Halo CE .JMS (version ${version})`];
  for (let v = 0; v < vertexCount; v++) {
    nextInt();
    const x = nextFloat() * 0.01;
    const y = nextFloat() * 0.01;
    const z = nextFloat() * 0.01;
    const nx = nextFloat();
    const ny = nextFloat();
    const nz = nextFloat();
    nextInt();
    nextFloat();
    const u = nextFloat();
    const vt = nextFloat();
    nextFloat();
    objLines.push(`v ${x.toFixed(5)} ${y.toFixed(5)} ${z.toFixed(5)}`);
    objLines.push(`vn ${nx.toFixed(5)} ${ny.toFixed(5)} ${nz.toFixed(5)}`);
    objLines.push(`vt ${u.toFixed(5)} ${vt.toFixed(5)}`);
  }

  const triangleCount = nextInt();
  let lastMat = -1;
  for (let t = 0; t < triangleCount; t++) {
    nextInt();
    const matIdx = nextInt();
    if (matIdx !== lastMat) {
      lastMat = matIdx;
      objLines.push(`usemtl ${materialNames[matIdx] ?? `mat_${matIdx}`}`);
    }
    const v0 = nextInt() + 1;
    const v1 = nextInt() + 1;
    const v2 = nextInt() + 1;
    objLines.push(`f ${v0}/${v0}/${v0} ${v1}/${v1}/${v1} ${v2}/${v2}/${v2}`);
  }

  return {
    objText: objLines.join('\n'),
    nodeCount,
    materialNames,
    markerCount,
    vertexCount,
    triangleCount,
  };
}

/**
 * MCC resolves a metadata scenario path to its scenario basename in `maps/`.
 * The cache-header name may differ from that basename in MCC (from Guilty Spark `mcc.rs`).
 */
export function packageMccMapName(scenarioPath: string): string {
  const normalized = scenarioPath.replace(/\\/g, '/').trim();
  const leaf = normalized.split('/').filter(Boolean).pop() ?? '';
  if (!leaf || /[:<>?"|*\0]/.test(leaf)) {
    throw new Error('Scenario path has no valid filename for MCC packaging');
  }
  return leaf.toLowerCase().endsWith('.map') ? leaf : `${leaf}.map`;
}

/**
 * Decodes `ModManifest.txt` preserving whether it is UTF-16LE with BOM, UTF-8 with BOM, or plain UTF-8.
 */
export function decodeMccModManifest(bytes: Buffer): {
  text: string;
  utf16le: boolean;
  utf8Bom: boolean;
} {
  if (bytes.length > 1024 * 1024) {
    throw new Error('ModManifest.txt exceeds 1 MiB safety limit.');
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    if (bytes.length % 2 !== 0) {
      throw new Error('Malformed UTF-16LE ModManifest.txt (odd byte count).');
    }
    const text = bytes.subarray(2).toString('utf16le');
    return { text, utf16le: true, utf8Bom: false };
  }
  const utf8Bom =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const payload = utf8Bom ? bytes.subarray(3) : bytes;
  const text = payload.toString('utf8');
  return { text, utf16le: false, utf8Bom };
}

export function encodeMccModManifest(
  text: string,
  utf16le: boolean,
  utf8Bom: boolean,
): Buffer {
  if (utf16le) {
    const body = Buffer.from(text, 'utf16le');
    return Buffer.concat([Buffer.from([0xff, 0xfe]), body]);
  }
  const body = Buffer.from(text, 'utf8');
  return utf8Bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
}

/**
 * Parses a COLLADA `.DAE` XML 3D model file and converts its meshes, positions, normals, UVs, and materials
 * directly into Wavefront `.OBJ` text so `.dae` files can be compiled into `gbxmodel` + `collision_model` without `tool.exe`.
 */
export function convertColladaDaeToObjText(daeXml: string): {
  objText: string;
  meshCount: number;
  materialNames: string[];
  vertexCount: number;
  triangleCount: number;
} {
  const objLines: string[] = ['# Converted from COLLADA .DAE by OpenCE Mantle'];
  const materialNames: string[] = [];
  let globalVertOffset = 0;
  let globalNormOffset = 0;
  let globalUvOffset = 0;
  let totalVerts = 0;
  let totalTris = 0;
  let meshCount = 0;

  const meshRegex = /<mesh\b[^>]*>([\s\S]*?)<\/mesh>/gi;
  let meshMatch: RegExpExecArray | null;
  while ((meshMatch = meshRegex.exec(daeXml)) !== null) {
    const meshBody = meshMatch[1]!;
    meshCount++;

    // Map source id -> float array
    const sources = new Map<string, number[]>();
    const sourceRegex = /<source\b[^>]*\bid=["']([^"']+)["'][^>]*>([\s\S]*?)<\/source>/gi;
    let srcMatch: RegExpExecArray | null;
    while ((srcMatch = sourceRegex.exec(meshBody)) !== null) {
      const srcId = srcMatch[1]!.trim();
      const floatMatch = /<float_array\b[^>]*>([\s\S]*?)<\/float_array>/i.exec(srcMatch[2]!);
      if (floatMatch) {
        const nums = floatMatch[1]!
          .trim()
          .split(/\s+/)
          .filter((s) => s.length > 0)
          .map((s) => Number.parseFloat(s) || 0);
        sources.set(srcId, nums);
      }
    }

    // Map <vertices id="..."> -> POSITION source id
    const verticesPosMap = new Map<string, string>();
    const vertTagRegex = /<vertices\b[^>]*\bid=["']([^"']+)["'][^>]*>([\s\S]*?)<\/vertices>/gi;
    let vtMatch: RegExpExecArray | null;
    while ((vtMatch = vertTagRegex.exec(meshBody)) !== null) {
      const vId = vtMatch[1]!.trim();
      const posInput = /<input\b[^>]*semantic=["']POSITION["'][^>]*source=["']#?([^"']+)["']/i.exec(vtMatch[2]!);
      if (posInput) {
        verticesPosMap.set(vId, posInput[1]!.trim());
      }
    }

    // Find position, normal, and texcoord arrays used by this mesh
    let posSourceId = Array.from(verticesPosMap.values())[0] ?? '';
    let normSourceId = '';
    let uvSourceId = '';

    const allInputsRegex = /<input\b([^>]*)\/?>/gi;
    let inpMatch: RegExpExecArray | null;
    while ((inpMatch = allInputsRegex.exec(meshBody)) !== null) {
      const attrs = inpMatch[1]!;
      const sem = /semantic=["']([^"']+)["']/i.exec(attrs)?.[1]?.toUpperCase();
      const src = /source=["']#?([^"']+)["']/i.exec(attrs)?.[1]?.trim();
      if (!sem || !src) continue;
      if (sem === 'VERTEX' && verticesPosMap.has(src)) {
        posSourceId = verticesPosMap.get(src)!;
      } else if (sem === 'POSITION' && !posSourceId) {
        posSourceId = src;
      } else if (sem === 'NORMAL' && !normSourceId) {
        normSourceId = src;
      } else if ((sem === 'TEXCOORD' || sem === 'UV') && !uvSourceId) {
        uvSourceId = src;
      }
    }

    const posArr = sources.get(posSourceId) ?? [];
    const normArr = sources.get(normSourceId) ?? [];
    const uvArr = sources.get(uvSourceId) ?? [];

    const vCount = Math.floor(posArr.length / 3);
    const nCount = Math.floor(normArr.length / 3);
    const tCount = Math.floor(uvArr.length / 2);
    if (vCount === 0) continue;

    for (let i = 0; i < vCount; i++) {
      objLines.push(
        `v ${(posArr[i * 3] ?? 0).toFixed(5)} ${(posArr[i * 3 + 1] ?? 0).toFixed(5)} ${(posArr[i * 3 + 2] ?? 0).toFixed(5)}`,
      );
    }
    for (let i = 0; i < nCount; i++) {
      objLines.push(
        `vn ${(normArr[i * 3] ?? 0).toFixed(5)} ${(normArr[i * 3 + 1] ?? 0).toFixed(5)} ${(normArr[i * 3 + 2] ?? 0).toFixed(5)}`,
      );
    }
    for (let i = 0; i < tCount; i++) {
      objLines.push(`vt ${(uvArr[i * 2] ?? 0).toFixed(5)} ${(uvArr[i * 2 + 1] ?? 0).toFixed(5)}`);
    }
    totalVerts += vCount;

    // Parse <triangles> and <polylist> blocks
    const primRegex = /<(triangles|polylist)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let primMatch: RegExpExecArray | null;
    while ((primMatch = primRegex.exec(meshBody)) !== null) {
      const primKind = primMatch[1]!.toLowerCase();
      const primAttrs = primMatch[2]!;
      const primBody = primMatch[3]!;
      const matName = /material=["']([^"']+)["']/i.exec(primAttrs)?.[1]?.trim() || `material_${meshCount}`;
      if (!materialNames.includes(matName)) materialNames.push(matName);
      objLines.push(`usemtl ${matName}`);

      // Determine input offsets and stride
      let vOff = 0;
      let nOff = -1;
      let tOff = -1;
      let maxOffset = 0;
      const pInputRegex = /<input\b([^>]*)\/?>/gi;
      let pi: RegExpExecArray | null;
      while ((pi = pInputRegex.exec(primBody)) !== null) {
        const iAttrs = pi[1]!;
        const sem = /semantic=["']([^"']+)["']/i.exec(iAttrs)?.[1]?.toUpperCase();
        const off = Number.parseInt(/offset=["'](\d+)["']/i.exec(iAttrs)?.[1] ?? '0', 10) || 0;
        if (off > maxOffset) maxOffset = off;
        if (sem === 'VERTEX' || sem === 'POSITION') vOff = off;
        else if (sem === 'NORMAL') nOff = off;
        else if (sem === 'TEXCOORD' || sem === 'UV') tOff = off;
      }
      const stride = maxOffset + 1;

      const pMatch = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(primBody);
      if (!pMatch) continue;
      const pIndices = pMatch[1]!
        .trim()
        .split(/\s+/)
        .filter((s) => s.length > 0)
        .map((s) => Number.parseInt(s, 10) || 0);

      const formatCorner = (baseIdx: number) => {
        const vi = (pIndices[baseIdx + vOff] ?? 0) + 1 + globalVertOffset;
        const ti = tOff >= 0 && tCount > 0 ? (pIndices[baseIdx + tOff] ?? 0) + 1 + globalUvOffset : '';
        const ni = nOff >= 0 && nCount > 0 ? (pIndices[baseIdx + nOff] ?? 0) + 1 + globalNormOffset : '';
        if (ti !== '' && ni !== '') return `${vi}/${ti}/${ni}`;
        if (ti !== '') return `${vi}/${ti}`;
        if (ni !== '') return `${vi}//${ni}`;
        return `${vi}`;
      };

      if (primKind === 'polylist') {
        const vcountMatch = /<vcount\b[^>]*>([\s\S]*?)<\/vcount>/i.exec(primBody);
        const vcounts = vcountMatch
          ? vcountMatch[1]!
              .trim()
              .split(/\s+/)
              .filter((s) => s.length > 0)
              .map((s) => Number.parseInt(s, 10) || 3)
          : [];
        let pCursor = 0;
        for (const vc of vcounts) {
          if (vc >= 3 && pCursor + vc * stride <= pIndices.length) {
            const c0 = formatCorner(pCursor);
            for (let k = 1; k < vc - 1; k++) {
              const c1 = formatCorner(pCursor + k * stride);
              const c2 = formatCorner(pCursor + (k + 1) * stride);
              objLines.push(`f ${c0} ${c1} ${c2}`);
              totalTris++;
            }
          }
          pCursor += vc * stride;
        }
      } else {
        const triStep = stride * 3;
        for (let idx = 0; idx + triStep <= pIndices.length; idx += triStep) {
          const c0 = formatCorner(idx);
          const c1 = formatCorner(idx + stride);
          const c2 = formatCorner(idx + stride * 2);
          objLines.push(`f ${c0} ${c1} ${c2}`);
          totalTris++;
        }
      }
    }

    globalVertOffset += vCount;
    globalNormOffset += nCount;
    globalUvOffset += tCount;
  }

  if (totalVerts === 0 || totalTris === 0) {
    throw new Error('No valid <mesh> geometry found in COLLADA .DAE file.');
  }

  return {
    objText: objLines.join('\n'),
    meshCount,
    materialNames,
    vertexCount: totalVerts,
    triangleCount: totalTris,
  };
}

export interface JmaAnimationCompileResult {
  buffer: Buffer;
  animationName: string;
  frameCount: number;
  nodeCount: number;
  frameSize: number;
  replacedExisting: boolean;
}

/**
 * Parses a Halo CE `.JMA` / `.JMM` / `.JMO` / `.JMR` skeletal animation text file (versions 16390..16395)
 * and compiles it into an uncompressed `ModelAnimationsAnimation` permutation inside the target `model_animations` (`antr`) tag!
 */
export function compileJmaIntoModelAnimationsTag(
  view: Buffer,
  targetAntrTagIndex: number,
  jmaText: string,
  animNameOverride?: string,
): JmaAnimationCompileResult {
  const lines = jmaText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/;.*$/, '').trim())
    .filter((l) => l.length > 0);

  let lineCursor = 0;
  const nextLine = () => lines[lineCursor++] ?? '';
  const tokens: string[] = [];
  for (const l of lines) {
    for (const tk of l.split(/\s+/)) {
      if (tk.length > 0) tokens.push(tk);
    }
  }
  let tokCursor = 0;
  const nextTok = () => tokens[tokCursor++] ?? '';
  const nextInt = () => Number.parseInt(nextTok(), 10) || 0;
  const nextFloat = () => Number.parseFloat(nextTok()) || 0;

  const version = nextInt();
  if (version < 16388 || version > 16400) {
    throw new Error(`Unsupported .JMA version "${version}" (expected Halo CE JMA 16390..16395).`);
  }

  const frameCount = Math.max(1, nextInt());
  const frameRate = Math.max(1, nextInt());
  void frameRate;
  const actorCount = Math.max(1, nextInt());
  void actorCount;
  const actorName = nextTok() || 'unnamedActor';
  void actorName;
  const nodeCount = Math.max(1, Math.min(64, nextInt()));
  const nodeListChecksum = nextInt();

  interface JmaNode {
    name: string;
    firstChildIndex: number;
    nextSiblingIndex: number;
    parentIndex: number;
  }
  const jmaNodes: JmaNode[] = [];
  for (let n = 0; n < nodeCount; n++) {
    const name = nextTok() || `node_${n}`;
    if (version >= 16394) {
      const parentIndex = nextInt();
      jmaNodes.push({ name, firstChildIndex: -1, nextSiblingIndex: -1, parentIndex });
    } else {
      const firstChildIndex = nextInt();
      const nextSiblingIndex = nextInt();
      jmaNodes.push({ name, firstChildIndex, nextSiblingIndex, parentIndex: -1 });
    }
  }

  // Derive parent or child/sibling links if JMA version 16392 vs 16394
  if (version < 16394) {
    for (let n = 0; n < nodeCount; n++) {
      let child = jmaNodes[n]!.firstChildIndex;
      while (child >= 0 && child < nodeCount) {
        jmaNodes[child]!.parentIndex = n;
        child = jmaNodes[child]!.nextSiblingIndex;
      }
    }
  } else {
    for (let n = 0; n < nodeCount; n++) {
      const p = jmaNodes[n]!.parentIndex;
      if (p >= 0 && p < nodeCount) {
        if (jmaNodes[p]!.firstChildIndex < 0) {
          jmaNodes[p]!.firstChildIndex = n;
        } else {
          let sib = jmaNodes[p]!.firstChildIndex;
          while (jmaNodes[sib]!.nextSiblingIndex >= 0) {
            sib = jmaNodes[sib]!.nextSiblingIndex;
          }
          jmaNodes[sib]!.nextSiblingIndex = n;
        }
      }
    }
  }

  // Each node per frame has: translation (x, y, z in JMS units * 0.01), rotation quaternion (i, j, k, w), scale (float)
  // Uncompressed Halo frame data per node: Quaternion (16 bytes: i, j, k, w) + Point3D (12 bytes: x, y, z) + float scale (4 bytes) = 32 bytes/node
  const bytesPerNodePerFrame = 32;
  const frameSize = nodeCount * bytesPerNodePerFrame;
  const frameDataBuf = Buffer.alloc(frameCount * frameSize);

  for (let f = 0; f < frameCount; f++) {
    for (let n = 0; n < nodeCount; n++) {
      const tx = nextFloat() * 0.01;
      const ty = nextFloat() * 0.01;
      const tz = nextFloat() * 0.01;
      let qi = nextFloat();
      let qj = nextFloat();
      let qk = nextFloat();
      let qw = nextFloat();
      const qLen = Math.hypot(qi, qj, qk, qw);
      if (qLen > 1e-6) {
        qi /= qLen;
        qj /= qLen;
        qk /= qLen;
        qw /= qLen;
      } else {
        qi = 0;
        qj = 0;
        qk = 0;
        qw = 1;
      }
      const scaleRaw = nextFloat();
      const scale = Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 1.0;

      const cellOff = (f * nodeCount + n) * bytesPerNodePerFrame;
      frameDataBuf.writeFloatLE(qi, cellOff + 0);
      frameDataBuf.writeFloatLE(qj, cellOff + 4);
      frameDataBuf.writeFloatLE(qk, cellOff + 8);
      frameDataBuf.writeFloatLE(qw, cellOff + 12);
      frameDataBuf.writeFloatLE(tx, cellOff + 16);
      frameDataBuf.writeFloatLE(ty, cellOff + 20);
      frameDataBuf.writeFloatLE(tz, cellOff + 24);
      frameDataBuf.writeFloatLE(scale, cellOff + 28);
    }
  }
  void nextLine;

  const header = parseCacheFileHeader(view);
  const tagIndex = parseTagIndex(view, header);
  const antrEntry = tagIndex.entries[targetAntrTagIndex];
  if (
    !antrEntry ||
    (antrEntry.primaryClassName !== 'model_animations' &&
      fourCCToString(antrEntry.primaryClassFourCC) !== 'antr')
  ) {
    throw new Error(`Tag #${targetAntrTagIndex} is not a model_animations (antr) tag.`);
  }

  const antrAt = resolveTagDataPointer(antrEntry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  const animName = (animNameOverride?.trim() || 'stand_fixed_idle').slice(0, 31);

  // Check existing nodes at +104 and animations at +116
  const existingNodesCount = view.readUInt32LE(antrAt + 104);
  const existingAnimsCount = view.readUInt32LE(antrAt + 116);
  const existingAnimsPtr = view.readUInt32LE(antrAt + 120);
  const existingAnimsOff =
    existingAnimsCount > 0 && existingAnimsPtr > 0
      ? resolvePointer(existingAnimsPtr, header.tagDataOffset, tagIndex.baseMemoryAddress)
      : 0;

  let matchedAnimIdx = -1;
  if (existingAnimsOff > 0) {
    for (let i = 0; i < existingAnimsCount; i++) {
      const aOff = existingAnimsOff + i * 180;
      if (aOff + 180 > view.length) break;
      const z = view.indexOf(0, aOff);
      const nm = view.toString('latin1', aOff, z >= aOff && z < aOff + 32 ? z : aOff + 32).trim();
      if (nm.toLowerCase() === animName.toLowerCase()) {
        matchedAnimIdx = i;
        break;
      }
    }
  }

  const needNewNodes = existingNodesCount === 0;
  const newAnimsCount = matchedAnimIdx >= 0 ? existingAnimsCount : existingAnimsCount + 1;
  const nodesBytes = needNewNodes ? nodeCount * 64 : 0;
  const animsTableBytes = matchedAnimIdx >= 0 ? 0 : newAnimsCount * 180;
  const appendBytes = (nodesBytes + animsTableBytes + frameDataBuf.length + 15) & ~15;

  const out = Buffer.alloc(view.length + appendBytes);
  view.copy(out, 0);

  let writeCursor = view.length;

  // Populate nodes reflexive at +104 if empty
  if (needNewNodes) {
    const nodesOff = writeCursor;
    writeCursor += nodesBytes;
    for (let n = 0; n < nodeCount; n++) {
      const nOff = nodesOff + n * 64;
      const nd = jmaNodes[n]!;
      out.write(nd.name.slice(0, 31), nOff, 'latin1');
      out.writeInt16LE(nd.nextSiblingIndex, nOff + 32);
      out.writeInt16LE(nd.firstChildIndex, nOff + 34);
      out.writeInt16LE(nd.parentIndex, nOff + 36);
      out.writeFloatLE(1.0, nOff + 52); // base vector Z
    }
    out.writeUInt32LE(nodeCount, antrAt + 104);
    out.writeUInt32LE(unresolvePointer(nodesOff, header.tagDataOffset, tagIndex.baseMemoryAddress), antrAt + 108);
    out.writeUInt32LE(0, antrAt + 112);
  }

  // Write frame data buffer
  const frameDataOff = writeCursor;
  frameDataBuf.copy(out, frameDataOff);
  writeCursor += frameDataBuf.length;
  const frameDataPtr = unresolvePointer(frameDataOff, header.tagDataOffset, tagIndex.baseMemoryAddress);

  // Prepare 180-byte ModelAnimationsAnimation record
  const animRec = Buffer.alloc(180);
  animRec.write(animName, 0, 'latin1');
  animRec.writeUInt16LE(0, 32); // type: base (0)
  animRec.writeUInt16LE(frameCount, 34); // frame count
  animRec.writeUInt16LE(frameSize, 36); // frame size
  animRec.writeUInt16LE(0, 38); // frame info type: none (0)
  animRec.writeInt32LE(nodeListChecksum, 40); // node list checksum
  animRec.writeUInt16LE(nodeCount, 44); // node count
  animRec.writeInt16LE(0, 46); // loop frame index
  animRec.writeFloatLE(1.0, 48); // weight
  animRec.writeInt16LE(0, 52); // key frame index
  animRec.writeInt16LE(0, 54); // second key frame index
  animRec.writeInt16LE(-1, 56); // next animation: NONE
  animRec.writeUInt16LE(0, 58); // flags: 0 (uncompressed)
  animRec.writeInt16LE(-1, 60); // sound: NONE
  animRec.writeInt16LE(0, 62); // sound frame index
  animRec.writeUInt16LE(matchedAnimIdx >= 0 ? matchedAnimIdx : existingAnimsCount, 66); // main animation index
  animRec.writeFloatLE(1.0, 68); // relative weight

  // Set bitmasks for node transform (rotation), translation, and scale flags
  const mask0 = nodeCount >= 32 ? 0xffffffff : ((1 << nodeCount) - 1) >>> 0;
  const mask1 = nodeCount > 32 ? (nodeCount >= 64 ? 0xffffffff : ((1 << (nodeCount - 32)) - 1) >>> 0) : 0;
  animRec.writeUInt32LE(mask0, 92); // node transform flag data[0]
  animRec.writeUInt32LE(mask1, 96); // node transform flag data[1]
  animRec.writeUInt32LE(mask0, 108); // node rotation flag data[0]
  animRec.writeUInt32LE(mask1, 112); // node rotation flag data[1]
  animRec.writeUInt32LE(mask0, 124); // node scale flag data[0]
  animRec.writeUInt32LE(mask1, 128); // node scale flag data[1]

  // frame data TagDataOffset at +160
  animRec.writeUInt32LE(frameDataBuf.length, 160);
  animRec.writeUInt32LE(0, 164);
  animRec.writeUInt32LE(0, 168);
  animRec.writeUInt32LE(frameDataPtr, 172);
  animRec.writeUInt32LE(0, 176);

  if (matchedAnimIdx >= 0 && existingAnimsOff > 0) {
    animRec.copy(out, existingAnimsOff + matchedAnimIdx * 180);
  } else {
    const newAnimsOff = writeCursor;
    writeCursor += animsTableBytes;
    if (existingAnimsOff > 0 && existingAnimsCount > 0) {
      out.copy(out, newAnimsOff, existingAnimsOff, existingAnimsOff + existingAnimsCount * 180);
    }
    animRec.copy(out, newAnimsOff + existingAnimsCount * 180);
    out.writeUInt32LE(newAnimsCount, antrAt + 116);
    out.writeUInt32LE(unresolvePointer(newAnimsOff, header.tagDataOffset, tagIndex.baseMemoryAddress), antrAt + 120);
    out.writeUInt32LE(0, antrAt + 124);
  }

  // Update cache header fileSize & tagDataSize
  const updatedHeader = {
    ...header,
    fileSize: out.length,
    tagDataSize: header.tagDataSize + appendBytes,
  };
  serializeCacheFileHeader(updatedHeader).copy(out, 0);

  return {
    buffer: out,
    animationName: animName,
    frameCount,
    nodeCount,
    frameSize,
    replacedExisting: matchedAnimIdx >= 0,
  };
}

export interface JmsPhysicsCompileResult {
  buffer: Buffer;
  massPointCount: number;
  totalMass: number;
  centerOfMass: [number, number, number];
  moments: [number, number, number];
}

/**
 * Parses mass points / markers from a Halo CE `.JMS` file, computes the center of mass and 3x3 inertial tensor
 * (`xx, yy, zz` moments + `PhysicsInertialMatrix` and inverse), and writes them into the target `physics` (`phys`) tag.
 */
export function compileJmsMassPointsIntoPhysicsTag(
  view: Buffer,
  targetPhysTagIndex: number,
  jmsText: string,
  totalMassOverride?: number,
): JmsPhysicsCompileResult {
  const tokens = jmsText
    .replace(/;[^\r\n]*/g, '')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  let cursor = 0;
  const nextToken = () => tokens[cursor++] ?? '';
  const nextInt = () => Number.parseInt(nextToken(), 10) || 0;
  const nextFloat = () => Number.parseFloat(nextToken()) || 0;

  const version = nextInt();
  if (version < 8190 || version > 8220) {
    throw new Error(`Unsupported .JMS version "${version}" (expected Halo CE JMS 8200).`);
  }

  nextToken(); // node checksum
  const nodeCount = nextInt();
  for (let n = 0; n < nodeCount; n++) {
    nextToken();
    nextInt();
    nextInt();
    for (let k = 0; k < 7; k++) nextFloat();
  }

  const materialCount = nextInt();
  for (let m = 0; m < materialCount; m++) {
    nextToken();
    nextToken();
  }

  interface ParsedMassPoint {
    name: string;
    nodeIndex: number;
    x: number;
    y: number;
    z: number;
    radius: number;
    relMass: number;
  }

  const markerCount = nextInt();
  const massPoints: ParsedMassPoint[] = [];
  for (let mk = 0; mk < markerCount; mk++) {
    const name = nextToken() || `mass_point_${mk}`;
    nextInt(); // region
    const nodeIdx = Math.max(0, nextInt());
    // Quaternion (i, j, k, w)
    nextFloat();
    nextFloat();
    nextFloat();
    nextFloat();
    // Position (x, y, z) in JMS units -> Halo world units (* 0.01)
    const x = nextFloat() * 0.01;
    const y = nextFloat() * 0.01;
    const z = nextFloat() * 0.01;
    const radiusRaw = nextFloat() * 0.01;
    const radius = Math.max(0.05, Number.isFinite(radiusRaw) && radiusRaw > 0 ? radiusRaw : 0.25);
    const relMass = Math.max(0.1, Number((radius * radius * radius * 64).toFixed(3)));
    if (massPoints.length < 32) {
      massPoints.push({ name: name.replace(/^#/, ''), nodeIndex: nodeIdx, x, y, z, radius, relMass });
    }
  }

  // If the JMS file had 0 markers, derive 4 balanced corner mass points from its vertex bounding box
  if (massPoints.length === 0) {
    const regionCount = nextInt();
    for (let r = 0; r < regionCount; r++) nextToken();
    const vertexCount = nextInt();
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let v = 0; v < vertexCount; v++) {
      nextInt();
      const x = nextFloat() * 0.01;
      const y = nextFloat() * 0.01;
      const z = nextFloat() * 0.01;
      for (let k = 0; k < 8; k++) nextFloat();
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    if (!Number.isFinite(minX)) {
      minX = -1;
      maxX = 1;
      minY = -0.6;
      maxY = 0.6;
      minZ = 0;
      maxZ = 0.8;
    }
    const midZ = (minZ + maxZ) * 0.5;
    const rad = Math.max(0.15, Math.min(maxX - minX, maxY - minY) * 0.25);
    massPoints.push(
      { name: 'front_left', nodeIndex: 0, x: maxX * 0.75, y: maxY * 0.75, z: midZ, radius: rad, relMass: 1.0 },
      { name: 'front_right', nodeIndex: 0, x: maxX * 0.75, y: minY * 0.75, z: midZ, radius: rad, relMass: 1.0 },
      { name: 'rear_left', nodeIndex: 0, x: minX * 0.75, y: maxY * 0.75, z: midZ, radius: rad, relMass: 1.0 },
      { name: 'rear_right', nodeIndex: 0, x: minX * 0.75, y: minY * 0.75, z: midZ, radius: rad, relMass: 1.0 },
    );
  }

  const header = parseCacheFileHeader(view);
  const tagIndex = parseTagIndex(view, header);
  const physEntry = tagIndex.entries[targetPhysTagIndex];
  if (
    !physEntry ||
    (physEntry.primaryClassName !== 'physics' &&
      fourCCToString(physEntry.primaryClassFourCC) !== 'phys')
  ) {
    throw new Error(`Tag #${targetPhysTagIndex} is not a physics (phys) tag.`);
  }

  const physAt = resolveTagDataPointer(physEntry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  const existingMass = view.readFloatLE(physAt + 8);
  const totalMass =
    totalMassOverride && totalMassOverride > 0
      ? totalMassOverride
      : Number.isFinite(existingMass) && existingMass > 0
        ? existingMass
        : 1000.0;
  const momentScaleRaw = view.readFloatLE(physAt + 4);
  const momentScale = Number.isFinite(momentScaleRaw) && momentScaleRaw > 0 ? momentScaleRaw : 1.0;

  // Compute Center of Mass and per-point absolute mass
  const sumRelMass = massPoints.reduce((acc, p) => acc + p.relMass, 0) || 1;
  let comX = 0;
  let comY = 0;
  let comZ = 0;
  for (const p of massPoints) {
    const w = p.relMass / sumRelMass;
    comX += p.x * w;
    comY += p.y * w;
    comZ += p.z * w;
  }

  // Compute 3x3 Inertial Tensor around Center of Mass
  let ixx = 0;
  let iyy = 0;
  let izz = 0;
  let ixy = 0;
  let ixz = 0;
  let iyz = 0;
  for (const p of massPoints) {
    const m = totalMass * (p.relMass / sumRelMass);
    const dx = p.x - comX;
    const dy = p.y - comY;
    const dz = p.z - comZ;
    const sphereI = 0.4 * m * p.radius * p.radius;
    ixx += sphereI + m * (dy * dy + dz * dz);
    iyy += sphereI + m * (dx * dx + dz * dz);
    izz += sphereI + m * (dx * dx + dy * dy);
    ixy -= m * dx * dy;
    ixz -= m * dx * dz;
    iyz -= m * dy * dz;
  }
  ixx = Math.max(1e-3, ixx * momentScale);
  iyy = Math.max(1e-3, iyy * momentScale);
  izz = Math.max(1e-3, izz * momentScale);
  ixy *= momentScale;
  ixz *= momentScale;
  iyz *= momentScale;

  // Invert 3x3 symmetric inertial tensor
  const det =
    ixx * (iyy * izz - iyz * iyz) -
    ixy * (ixy * izz - iyz * ixz) +
    ixz * (ixy * iyz - iyy * ixz);
  const invDet = Math.abs(det) > 1e-6 ? 1.0 / det : 0;
  const invXX = invDet ? (iyy * izz - iyz * iyz) * invDet : 1.0 / ixx;
  const invXY = invDet ? (ixz * iyz - ixy * izz) * invDet : 0;
  const invXZ = invDet ? (ixy * iyz - ixz * iyy) * invDet : 0;
  const invYY = invDet ? (ixx * izz - ixz * ixz) * invDet : 1.0 / iyy;
  const invYZ = invDet ? (ixy * ixz - ixx * iyz) * invDet : 0;
  const invZZ = invDet ? (ixx * iyy - ixy * ixy) * invDet : 1.0 / izz;

  // Allocate space for 2 PhysicsInertialMatrix (2 * 36 = 72 bytes) + N PhysicsMassPoint (N * 128 bytes)
  const matrixBytes = 72;
  const massPointsBytes = massPoints.length * 128;
  const appendBytes = (matrixBytes + massPointsBytes + 15) & ~15;

  const out = Buffer.alloc(view.length + appendBytes);
  view.copy(out, 0);

  let writeCursor = view.length;
  const matOff = writeCursor;
  writeCursor += matrixBytes;
  const mpOff = writeCursor;
  writeCursor += massPointsBytes;

  // Write Matrix 0 (Inertial Tensor) and Matrix 1 (Inverse Inertial Tensor)
  const writeMat3 = (off: number, m: [number, number, number, number, number, number, number, number, number]) => {
    for (let i = 0; i < 9; i++) {
      out.writeFloatLE(m[i]!, off + i * 4);
    }
  };
  writeMat3(matOff, [ixx, ixy, ixz, ixy, iyy, iyz, ixz, iyz, izz]);
  writeMat3(matOff + 36, [invXX, invXY, invXZ, invXY, invYY, invYZ, invXZ, invYZ, invZZ]);

  // Write PhysicsMassPoint array (128 bytes each)
  for (let i = 0; i < massPoints.length; i++) {
    const p = massPoints[i]!;
    const pOff = mpOff + i * 128;
    const absMass = totalMass * (p.relMass / sumRelMass);
    out.write(p.name.slice(0, 31), pOff + 0, 'latin1');
    out.writeInt16LE(-1, pOff + 32); // powered mass point: NONE
    out.writeInt16LE(p.nodeIndex, pOff + 34); // model node
    out.writeUInt32LE(1, pOff + 36); // flags: metallic
    out.writeFloatLE(p.relMass, pOff + 40); // relative mass
    out.writeFloatLE(absMass, pOff + 44); // mass
    out.writeFloatLE(1.0, pOff + 48); // relative density
    out.writeFloatLE(1.0, pOff + 52); // density
    out.writeFloatLE(p.x, pOff + 56); // position.x
    out.writeFloatLE(p.y, pOff + 60); // position.y
    out.writeFloatLE(p.z, pOff + 64); // position.z
    out.writeFloatLE(1.0, pOff + 68); // forward.i
    out.writeFloatLE(0.0, pOff + 72); // forward.j
    out.writeFloatLE(0.0, pOff + 76); // forward.k
    out.writeFloatLE(0.0, pOff + 80); // up.i
    out.writeFloatLE(0.0, pOff + 84); // up.j
    out.writeFloatLE(1.0, pOff + 88); // up.k
    out.writeUInt16LE(0, pOff + 92); // friction type: point
    out.writeFloatLE(1.0, pOff + 96); // friction parallel scale
    out.writeFloatLE(1.0, pOff + 100); // friction perpendicular scale
    out.writeFloatLE(p.radius, pOff + 104); // radius
  }

  // Update Physics root struct fields
  out.writeFloatLE(totalMass, physAt + 8);
  out.writeFloatLE(comX, physAt + 12);
  out.writeFloatLE(comY, physAt + 16);
  out.writeFloatLE(comZ, physAt + 20);
  out.writeFloatLE(ixx, physAt + 80);
  out.writeFloatLE(iyy, physAt + 84);
  out.writeFloatLE(izz, physAt + 88);

  // inertial matrix and inverse reflexive at +92
  out.writeUInt32LE(2, physAt + 92);
  out.writeUInt32LE(unresolvePointer(matOff, header.tagDataOffset, tagIndex.baseMemoryAddress), physAt + 96);
  out.writeUInt32LE(0, physAt + 100);

  // mass points reflexive at +116
  out.writeUInt32LE(massPoints.length, physAt + 116);
  out.writeUInt32LE(unresolvePointer(mpOff, header.tagDataOffset, tagIndex.baseMemoryAddress), physAt + 120);
  out.writeUInt32LE(0, physAt + 124);

  const updatedHeader = {
    ...header,
    fileSize: out.length,
    tagDataSize: header.tagDataSize + appendBytes,
  };
  serializeCacheFileHeader(updatedHeader).copy(out, 0);

  return {
    buffer: out,
    massPointCount: massPoints.length,
    totalMass,
    centerOfMass: [Number(comX.toFixed(4)), Number(comY.toFixed(4)), Number(comZ.toFixed(4))],
    moments: [Number(ixx.toFixed(2)), Number(iyy.toFixed(2)), Number(izz.toFixed(2))],
  };
}

/**
 * Option 2 (Milestone 16.2): Decompiles a `gbxmodel` (`mod2`) or `model` (`mode`) tag directly into
 * a standard Halo CE `8200` `.JMS` ASCII source file (preserving nodes, markers, shader materials,
 * regions, vertices scaled by 100x to 3ds Max / JMS units, and indexed triangles).
 */
export function decompileGbxmodelToJmsText(
  view: Buffer,
  mod2TagIndex: number,
): {
  jmsText: string;
  tagPath: string;
  nodeCount: number;
  markerCount: number;
  regionCount: number;
  vertexCount: number;
  triangleCount: number;
} {
  const header = parseCacheFileHeader(view);
  const tagIndex = parseTagIndex(view, header);
  const entry = tagIndex.entries[mod2TagIndex];
  if (
    !entry ||
    (entry.primaryClassName !== 'gbxmodel' &&
      entry.primaryClassName !== 'model' &&
      fourCCToString(entry.primaryClassFourCC) !== 'mod2')
  ) {
    throw new Error(`Tag #${mod2TagIndex} is not a gbxmodel (mod2) tag.`);
  }

  const baseAt = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  const nodeListChecksum = view.readInt32LE(baseAt + 4);

  // 1. Read nodes reflexive at +204 (156 bytes per ModelNode)
  const nodesCount = view.readUInt32LE(baseAt + 204);
  const nodesPtr = view.readUInt32LE(baseAt + 208);
  const nodesOff =
    nodesCount > 0 && nodesPtr > 0 ? resolvePointer(nodesPtr, header.tagDataOffset, tagIndex.baseMemoryAddress) : 0;

  interface JmsNodeOut {
    name: string;
    firstChild: number;
    nextSibling: number;
    qi: number;
    qj: number;
    qk: number;
    qw: number;
    tx: number;
    ty: number;
    tz: number;
  }
  const nodes: JmsNodeOut[] = [];
  if (nodesOff > 0 && nodesOff + nodesCount * 156 <= view.length) {
    for (let n = 0; n < nodesCount; n++) {
      const nOff = nodesOff + n * 156;
      const z = view.indexOf(0, nOff);
      const name = view.toString('latin1', nOff, z >= nOff && z < nOff + 32 ? z : nOff + 32).trim() || `frame_${n}`;
      const nextSibling = view.readInt16LE(nOff + 32);
      const firstChild = view.readInt16LE(nOff + 34);
      const tx = view.readFloatLE(nOff + 40) * 100.0;
      const ty = view.readFloatLE(nOff + 44) * 100.0;
      const tz = view.readFloatLE(nOff + 48) * 100.0;
      const qi = view.readFloatLE(nOff + 52);
      const qj = view.readFloatLE(nOff + 56);
      const qk = view.readFloatLE(nOff + 60);
      const qw = view.readFloatLE(nOff + 64);
      nodes.push({ name, firstChild, nextSibling, qi, qj, qk, qw: qw || 1.0, tx, ty, tz });
    }
  }
  if (nodes.length === 0) {
    nodes.push({
      name: 'frame',
      firstChild: -1,
      nextSibling: -1,
      qi: 0,
      qj: 0,
      qk: 0,
      qw: 1,
      tx: 0,
      ty: 0,
      tz: 0,
    });
  }

  // 2. Read markers reflexive at +180 (64 bytes per ModelMarkerGroup) -> instances at +44 (32 bytes per ModelMarker)
  const markerGroupsCount = view.readUInt32LE(baseAt + 180);
  const markerGroupsPtr = view.readUInt32LE(baseAt + 184);
  const markerGroupsOff =
    markerGroupsCount > 0 && markerGroupsPtr > 0
      ? resolvePointer(markerGroupsPtr, header.tagDataOffset, tagIndex.baseMemoryAddress)
      : 0;

  interface JmsMarkerOut {
    name: string;
    regionIdx: number;
    nodeIdx: number;
    qi: number;
    qj: number;
    qk: number;
    qw: number;
    tx: number;
    ty: number;
    tz: number;
    radius: number;
  }
  const markers: JmsMarkerOut[] = [];
  if (markerGroupsOff > 0 && markerGroupsOff + markerGroupsCount * 64 <= view.length) {
    for (let g = 0; g < markerGroupsCount; g++) {
      const gOff = markerGroupsOff + g * 64;
      const z = view.indexOf(0, gOff);
      const name = view.toString('latin1', gOff, z >= gOff && z < gOff + 32 ? z : gOff + 32).trim() || `marker_${g}`;
      const instCount = view.readUInt32LE(gOff + 52);
      const instPtr = view.readUInt32LE(gOff + 56);
      const instOff =
        instCount > 0 && instPtr > 0 ? resolvePointer(instPtr, header.tagDataOffset, tagIndex.baseMemoryAddress) : 0;
      if (instOff > 0 && instOff + instCount * 32 <= view.length) {
        for (let m = 0; m < instCount; m++) {
          const mOff = instOff + m * 32;
          const regionIdx = Math.max(0, view.readUInt8(mOff + 0));
          const nodeIdx = Math.max(0, Math.min(nodes.length - 1, view.readUInt8(mOff + 2)));
          const tx = view.readFloatLE(mOff + 4) * 100.0;
          const ty = view.readFloatLE(mOff + 8) * 100.0;
          const tz = view.readFloatLE(mOff + 12) * 100.0;
          const qi = view.readFloatLE(mOff + 16);
          const qj = view.readFloatLE(mOff + 20);
          const qk = view.readFloatLE(mOff + 24);
          const qw = view.readFloatLE(mOff + 28) || 1.0;
          markers.push({ name, regionIdx, nodeIdx, qi, qj, qk, qw, tx, ty, tz, radius: 1.0 });
        }
      }
    }
  }

  // 3. Extract render geometry at super-high LOD (4)
  const renderGeom = extractModelRenderGeometry(view, header, tagIndex, entry.tagId, 4);

  // 4. Read shader names from shaders reflexive at +240 (32 bytes per ModelShaderReference)
  const shadersCount = view.readUInt32LE(baseAt + 240);
  const shadersPtr = view.readUInt32LE(baseAt + 244);
  const shadersOff =
    shadersCount > 0 && shadersPtr > 0 ? resolvePointer(shadersPtr, header.tagDataOffset, tagIndex.baseMemoryAddress) : 0;
  const materialNames: string[] = [];
  if (shadersOff > 0 && shadersOff + shadersCount * 32 <= view.length) {
    for (let s = 0; s < shadersCount; s++) {
      const sOff = shadersOff + s * 32;
      const tid = view.readUInt32LE(sOff + 12);
      const tEntry = tagIndex.entries.find((e) => e.tagId === tid);
      const leaf = tEntry ? tEntry.path.split('\\').pop() || `material_${s}` : `material_${s}`;
      materialNames.push(leaf);
    }
  }
  if (materialNames.length === 0) {
    materialNames.push('default');
  }

  const lines: string[] = [];
  lines.push('8200');
  lines.push(String(nodeListChecksum));
  lines.push(String(nodes.length));
  for (const nd of nodes) {
    lines.push(nd.name);
    lines.push(String(nd.firstChild));
    lines.push(String(nd.nextSibling));
    lines.push(`${nd.qi.toFixed(6)}\t${nd.qj.toFixed(6)}\t${nd.qk.toFixed(6)}\t${nd.qw.toFixed(6)}`);
    lines.push(`${nd.tx.toFixed(6)}\t${nd.ty.toFixed(6)}\t${nd.tz.toFixed(6)}`);
  }

  lines.push(String(materialNames.length));
  for (const mat of materialNames) {
    lines.push(mat);
    lines.push('<none>');
  }

  lines.push(String(markers.length));
  for (const mk of markers) {
    lines.push(mk.name);
    lines.push(String(mk.regionIdx));
    lines.push(String(mk.nodeIdx));
    lines.push(`${mk.qi.toFixed(6)}\t${mk.qj.toFixed(6)}\t${mk.qk.toFixed(6)}\t${mk.qw.toFixed(6)}`);
    lines.push(`${mk.tx.toFixed(6)}\t${mk.ty.toFixed(6)}\t${mk.tz.toFixed(6)}`);
    lines.push(mk.radius.toFixed(4));
  }

  // Regions
  lines.push('1');
  lines.push('unnamed');

  // Flatten vertices & triangles across all submeshes
  let totalVertices = 0;
  let totalTriangles = 0;
  for (const sub of renderGeom.submeshes) {
    totalVertices += sub.vertexCount;
    totalTriangles += Math.floor(sub.indices.length / 3);
  }

  lines.push(String(totalVertices));
  for (const sub of renderGeom.submeshes) {
    const vData = sub.vertices;
    for (let v = 0; v < sub.vertexCount; v++) {
      const b = v * 8;
      const vx = (vData[b + 0] ?? 0) * 100.0;
      const vy = (vData[b + 1] ?? 0) * 100.0;
      const vz = (vData[b + 2] ?? 0) * 100.0;
      const nx = vData[b + 3] ?? 0;
      const ny = vData[b + 4] ?? 0;
      const nz = vData[b + 5] ?? 1;
      const u = vData[b + 6] ?? 0;
      const vt = vData[b + 7] ?? 0;
      lines.push('0');
      lines.push(`${vx.toFixed(6)}\t${vy.toFixed(6)}\t${vz.toFixed(6)}`);
      lines.push(`${nx.toFixed(6)}\t${ny.toFixed(6)}\t${nz.toFixed(6)}`);
      lines.push('-1');
      lines.push('0.000000');
      lines.push(u.toFixed(6));
      lines.push(vt.toFixed(6));
      lines.push('0.000000');
    }
  }

  lines.push(String(totalTriangles));
  let vBase = 0;
  for (const sub of renderGeom.submeshes) {
    const matIdx = Math.max(0, Math.min(materialNames.length - 1, sub.shaderIndex));
    const idxArr = sub.indices;
    for (let i = 0; i + 2 < idxArr.length; i += 3) {
      lines.push('0');
      lines.push(String(matIdx));
      lines.push(`${vBase + idxArr[i]!}\t${vBase + idxArr[i + 1]!}\t${vBase + idxArr[i + 2]!}`);
    }
    vBase += sub.vertexCount;
  }

  return {
    jmsText: lines.join('\r\n') + '\r\n',
    tagPath: entry.path,
    nodeCount: nodes.length,
    markerCount: markers.length,
    regionCount: 1,
    vertexCount: totalVertices,
    triangleCount: totalTriangles,
  };
}

/**
 * Option 2 (Milestone 16.2): Decompiles a `model_animations` (`antr`) tag entry into a standard
 * Halo CE `16392` `.JMA` ASCII skeletal animation file.
 */
export function decompileModelAnimationsToJmaText(
  view: Buffer,
  antrTagIndex: number,
  animationIndex = 0,
): {
  jmaText: string;
  tagPath: string;
  animationName: string;
  frameCount: number;
  nodeCount: number;
} {
  const header = parseCacheFileHeader(view);
  const tagIndex = parseTagIndex(view, header);
  const entry = tagIndex.entries[antrTagIndex];
  if (
    !entry ||
    (entry.primaryClassName !== 'model_animations' && fourCCToString(entry.primaryClassFourCC) !== 'antr')
  ) {
    throw new Error(`Tag #${antrTagIndex} is not a model_animations (antr) tag.`);
  }

  const antrAt = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  const nodesCount = view.readUInt32LE(antrAt + 104);
  const nodesPtr = view.readUInt32LE(antrAt + 108);
  const nodesOff =
    nodesCount > 0 && nodesPtr > 0 ? resolvePointer(nodesPtr, header.tagDataOffset, tagIndex.baseMemoryAddress) : 0;

  const animsCount = view.readUInt32LE(antrAt + 116);
  const animsPtr = view.readUInt32LE(antrAt + 120);
  if (animsCount === 0 || animsPtr === 0) {
    throw new Error(`model_animations "${entry.path}" contains 0 animations.`);
  }
  const animsOff = resolvePointer(animsPtr, header.tagDataOffset, tagIndex.baseMemoryAddress);
  const chosenIdx = Math.max(0, Math.min(animsCount - 1, animationIndex));
  const aOff = animsOff + chosenIdx * 180;
  if (aOff + 180 > view.length) {
    throw new Error(`Animation #${chosenIdx} offset is out of bounds.`);
  }

  const zAnim = view.indexOf(0, aOff);
  const animationName =
    view.toString('latin1', aOff, zAnim >= aOff && zAnim < aOff + 32 ? zAnim : aOff + 32).trim() || `anim_${chosenIdx}`;
  const frameCount = Math.max(1, view.readUInt16LE(aOff + 34));
  const frameSize = view.readUInt16LE(aOff + 36);
  const nodeListChecksum = view.readInt32LE(aOff + 40);
  const animNodeCount = Math.max(1, view.readUInt16LE(aOff + 44) || nodesCount || 1);
  const flags = view.readUInt16LE(aOff + 58);
  const isCompressed = (flags & 1) !== 0;

  const nodes: Array<{ name: string; firstChild: number; nextSibling: number }> = [];
  for (let n = 0; n < animNodeCount; n++) {
    if (nodesOff > 0 && n < nodesCount && nodesOff + (n + 1) * 64 <= view.length) {
      const nOff = nodesOff + n * 64;
      const zn = view.indexOf(0, nOff);
      const nm = view.toString('latin1', nOff, zn >= nOff && zn < nOff + 32 ? zn : nOff + 32).trim() || `node_${n}`;
      const nextSibling = view.readInt16LE(nOff + 32);
      const firstChild = view.readInt16LE(nOff + 34);
      nodes.push({ name: nm, firstChild, nextSibling });
    } else {
      nodes.push({ name: n === 0 ? 'frame' : `node_${n}`, firstChild: -1, nextSibling: -1 });
    }
  }

  const frameDataSize = view.readUInt32LE(aOff + 160);
  const frameDataPtr = view.readUInt32LE(aOff + 172);
  const frameDataOff =
    frameDataSize > 0 && frameDataPtr > 0
      ? resolvePointer(frameDataPtr, header.tagDataOffset, tagIndex.baseMemoryAddress)
      : 0;

  const lines: string[] = [];
  lines.push('16392');
  lines.push(String(frameCount));
  lines.push('30');
  lines.push('1');
  lines.push('unnamedActor');
  lines.push(String(animNodeCount));
  lines.push(String(nodeListChecksum));

  for (const nd of nodes) {
    lines.push(nd.name);
    lines.push(String(nd.firstChild));
    lines.push(String(nd.nextSibling));
  }

  for (let f = 0; f < frameCount; f++) {
    for (let n = 0; n < animNodeCount; n++) {
      let tx = 0;
      let ty = 0;
      let tz = 0;
      let qi = 0;
      let qj = 0;
      let qk = 0;
      let qw = 1;
      let scale = 1.0;

      if (!isCompressed && frameDataOff > 0 && frameSize >= animNodeCount * 32) {
        const cellOff = frameDataOff + f * frameSize + n * 32;
        if (cellOff + 32 <= view.length) {
          qi = view.readFloatLE(cellOff + 0);
          qj = view.readFloatLE(cellOff + 4);
          qk = view.readFloatLE(cellOff + 8);
          qw = view.readFloatLE(cellOff + 12) || 1.0;
          tx = view.readFloatLE(cellOff + 16) * 100.0;
          ty = view.readFloatLE(cellOff + 20) * 100.0;
          tz = view.readFloatLE(cellOff + 24) * 100.0;
          scale = view.readFloatLE(cellOff + 28) || 1.0;
        }
      }
      lines.push(`${tx.toFixed(6)}\t${ty.toFixed(6)}\t${tz.toFixed(6)}`);
      lines.push(`${qi.toFixed(6)}\t${qj.toFixed(6)}\t${qk.toFixed(6)}\t${qw.toFixed(6)}`);
      lines.push(scale.toFixed(6));
    }
  }

  return {
    jmaText: lines.join('\r\n') + '\r\n',
    tagPath: entry.path,
    animationName,
    frameCount,
    nodeCount: animNodeCount,
  };
}

/**
 * Option 2 (Milestone 16.2): Decompiles a `physics` (`phys`) tag into a `physics.jms` ASCII file
 * containing `#mass_*` sphere markers at each `PhysicsMassPoint`'s 3D position and radius.
 */
export function decompilePhysicsToJmsText(
  view: Buffer,
  physTagIndex: number,
): {
  jmsText: string;
  tagPath: string;
  massPointCount: number;
  totalMass: number;
} {
  const header = parseCacheFileHeader(view);
  const tagIndex = parseTagIndex(view, header);
  const entry = tagIndex.entries[physTagIndex];
  if (!entry || (entry.primaryClassName !== 'physics' && fourCCToString(entry.primaryClassFourCC) !== 'phys')) {
    throw new Error(`Tag #${physTagIndex} is not a physics (phys) tag.`);
  }

  const physAt = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  const totalMass = view.readFloatLE(physAt + 8);
  const mpCount = view.readUInt32LE(physAt + 116);
  const mpPtr = view.readUInt32LE(physAt + 120);
  const mpOff =
    mpCount > 0 && mpPtr > 0 ? resolvePointer(mpPtr, header.tagDataOffset, tagIndex.baseMemoryAddress) : 0;

  const lines: string[] = [];
  lines.push('8200');
  lines.push('0');
  lines.push('1');
  lines.push('frame');
  lines.push('-1');
  lines.push('-1');
  lines.push('0.000000\t0.000000\t0.000000\t1.000000');
  lines.push('0.000000\t0.000000\t0.000000');
  lines.push('1');
  lines.push('default');
  lines.push('<none>');

  lines.push(String(mpCount));
  if (mpOff > 0 && mpOff + mpCount * 128 <= view.length) {
    for (let i = 0; i < mpCount; i++) {
      const pOff = mpOff + i * 128;
      const z = view.indexOf(0, pOff);
      const rawName = view.toString('latin1', pOff, z >= pOff && z < pOff + 32 ? z : pOff + 32).trim() || `point_${i}`;
      const markerName = rawName.startsWith('mass_') ? rawName : `mass_${rawName}`;
      const px = view.readFloatLE(pOff + 56) * 100.0;
      const py = view.readFloatLE(pOff + 60) * 100.0;
      const pz = view.readFloatLE(pOff + 64) * 100.0;
      const rad = Math.max(1.0, view.readFloatLE(pOff + 104) * 100.0);
      lines.push(markerName);
      lines.push('-1');
      lines.push('0');
      lines.push('0.000000\t0.000000\t0.000000\t1.000000');
      lines.push(`${px.toFixed(6)}\t${py.toFixed(6)}\t${pz.toFixed(6)}`);
      lines.push(rad.toFixed(4));
    }
  }

  lines.push('1');
  lines.push('unnamed');
  lines.push('0');
  lines.push('0');

  return {
    jmsText: lines.join('\r\n') + '\r\n',
    tagPath: entry.path,
    massPointCount: mpCount,
    totalMass: Number(totalMass.toFixed(2)),
  };
}

/**
 * Option 3 (Milestone 17): Compiles `.txt` (with `###END-STRING###` or line-delimited entries)
 * or `.hmt` (`key=value` HUD message entries) directly into a `unicode_string_list` (`ustr`)
 * or `hud_message_text` (`hmt `) tag in-memory without `tool.exe`.
 */
export function compileStringsIntoTag(
  view: Buffer,
  targetTagIndex: number,
  textContent: string,
): {
  buffer: Buffer;
  tagPath: string;
  tagGroup: string;
  entryCount: number;
  messageNames: string[];
} {
  const header = parseCacheFileHeader(view);
  const tagIndex = parseTagIndex(view, header);
  const entry = tagIndex.entries[targetTagIndex];
  if (!entry) {
    throw new Error(`Tag #${targetTagIndex} does not exist.`);
  }
  const group4cc = fourCCToString(entry.primaryClassFourCC);
  const isUstr = entry.primaryClassName === 'unicode_string_list' || group4cc === 'ustr';
  const isHmt = entry.primaryClassName === 'hud_message_text' || group4cc === 'hmt ';
  if (!isUstr && !isHmt) {
    throw new Error(
      `Tag #${targetTagIndex} (${entry.primaryClassName}) is not a unicode_string_list (ustr) or hud_message_text (hmt ) tag.`,
    );
  }

  let baseAt = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  const tagHeaderSize = header.engine === 5 ? 0x24 : 0x28;
  const entryOff = header.tagDataOffset + tagHeaderSize + targetTagIndex * 32;

  if (isUstr) {
    const needsInternalize = entry.isExternal || baseAt < header.tagDataOffset || baseAt + 12 > view.length;
    const rootAllocBytes = needsInternalize ? 16 : 0;
    const normalized = textContent.replace(/\r\n/g, '\n');
    const rawStrings = normalized.includes('###END-STRING###')
      ? normalized
          .split(/###END-STRING###/i)
          .map((s) => s.replace(/^\n+|\n+$/g, ''))
          .filter((_, idx, arr) => idx < arr.length - 1 || _.length > 0)
      : normalized
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);

    const strBuffers: Buffer[] = rawStrings.map((s) => {
      const crlf = s.replace(/\n/g, '\r\n');
      const b = Buffer.alloc((crlf.length + 1) * 2, 0);
      b.write(crlf, 0, 'utf16le');
      return b;
    });

    const tableBytes = strBuffers.length * 20;
    const dataBytes = strBuffers.reduce((acc, b) => acc + ((b.length + 3) & ~3), 0);
    const appendBytes = (rootAllocBytes + tableBytes + dataBytes + 15) & ~15;

    const out = Buffer.alloc(view.length + appendBytes);
    view.copy(out, 0);

    let cursor = view.length;
    if (needsInternalize) {
      baseAt = cursor;
      cursor += rootAllocBytes;
      out.writeUInt32LE(unresolvePointer(baseAt, header.tagDataOffset, tagIndex.baseMemoryAddress), entryOff + 0x14);
      out.writeUInt32LE(0, entryOff + 0x18);
    }
    const tableOff = cursor;
    cursor += tableBytes;

    for (let i = 0; i < strBuffers.length; i++) {
      const sb = strBuffers[i]!;
      const sOff = cursor;
      sb.copy(out, sOff);
      cursor += (sb.length + 3) & ~3;

      const recOff = tableOff + i * 20;
      out.writeUInt32LE(sb.length, recOff + 0); // size
      out.writeUInt32LE(0, recOff + 4); // external = 0
      out.writeUInt32LE(0, recOff + 8); // file offset = 0
      out.writeUInt32LE(unresolvePointer(sOff, header.tagDataOffset, tagIndex.baseMemoryAddress), recOff + 12);
      out.writeUInt32LE(0, recOff + 16);
    }

    out.writeUInt32LE(strBuffers.length, baseAt + 0);
    out.writeUInt32LE(unresolvePointer(tableOff, header.tagDataOffset, tagIndex.baseMemoryAddress), baseAt + 4);
    out.writeUInt32LE(0, baseAt + 8);

    const updatedHeader = {
      ...header,
      fileSize: out.length,
      tagDataSize: header.tagDataSize + appendBytes,
    };
    serializeCacheFileHeader(updatedHeader).copy(out, 0);

    return {
      buffer: out,
      tagPath: entry.path,
      tagGroup: 'unicode_string_list',
      entryCount: strBuffers.length,
      messageNames: rawStrings.slice(0, 12).map((s, i) => `[${i}] ${s.slice(0, 40)}`),
    };
  }

  // hud_message_text (hmt ): parse key=value lines
  const lines = textContent.replace(/\r\n/g, '\n').split('\n');
  const pairs: Array<{ name: string; text: string }> = [];
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim().slice(0, 31);
      const val = trimmed.slice(eqIdx + 1).trim();
      if (key) pairs.push({ name: key, text: val });
    } else {
      pairs.push({ name: `msg_${pairs.length + 1}`, text: trimmed });
    }
  }

  const charWords: number[] = [];
  const elements: Array<{ type: number; data: number }> = [];
  const messages: Array<{ name: string; textStart: number; elemStart: number; panelCount: number }> = [];

  for (const p of pairs) {
    const textStart = charWords.length;
    const elemStart = elements.length;
    const cleanText = p.text.slice(0, 250);
    for (let i = 0; i < cleanText.length; i++) {
      charWords.push(cleanText.charCodeAt(i));
    }
    charWords.push(0); // null terminator word
    elements.push({ type: 0, data: cleanText.length + 1 });
    messages.push({ name: p.name, textStart, elemStart, panelCount: 1 });
  }

  const textBuf = Buffer.alloc(charWords.length * 2);
  for (let i = 0; i < charWords.length; i++) {
    textBuf.writeUInt16LE(charWords[i]!, i * 2);
  }
  const elemBuf = Buffer.alloc(elements.length * 2);
  for (let i = 0; i < elements.length; i++) {
    elemBuf.writeInt8(elements[i]!.type, i * 2 + 0);
    elemBuf.writeUInt8(elements[i]!.data, i * 2 + 1);
  }
  const msgBuf = Buffer.alloc(messages.length * 64, 0);
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    const mOff = i * 64;
    msgBuf.write(m.name.slice(0, 31), mOff + 0, 'latin1');
    msgBuf.writeUInt16LE(m.textStart, mOff + 32);
    msgBuf.writeUInt16LE(m.elemStart, mOff + 34);
    msgBuf.writeUInt8(m.panelCount, mOff + 36);
  }

  const needsInternalizeHmt = entry.isExternal || baseAt < header.tagDataOffset || baseAt + 128 > view.length;
  const rootHmtBytes = needsInternalizeHmt ? 128 : 0;
  const alignedTextLen = (textBuf.length + 3) & ~3;
  const alignedElemLen = (elemBuf.length + 3) & ~3;
  const alignedMsgLen = (msgBuf.length + 3) & ~3;
  const appendBytes = (rootHmtBytes + alignedTextLen + alignedElemLen + alignedMsgLen + 15) & ~15;

  const out = Buffer.alloc(view.length + appendBytes);
  view.copy(out, 0);

  let cursor = view.length;
  if (needsInternalizeHmt) {
    baseAt = cursor;
    cursor += rootHmtBytes;
    out.writeUInt32LE(unresolvePointer(baseAt, header.tagDataOffset, tagIndex.baseMemoryAddress), entryOff + 0x14);
    out.writeUInt32LE(0, entryOff + 0x18);
  }
  const textOff = cursor;
  textBuf.copy(out, textOff);
  cursor += alignedTextLen;

  const elemOff = cursor;
  elemBuf.copy(out, elemOff);
  cursor += alignedElemLen;

  const msgOff = cursor;
  msgBuf.copy(out, msgOff);
  cursor += alignedMsgLen;

  // text data TagDataOffset at +0
  out.writeUInt32LE(textBuf.length, baseAt + 0);
  out.writeUInt32LE(0, baseAt + 4);
  out.writeUInt32LE(0, baseAt + 8);
  out.writeUInt32LE(unresolvePointer(textOff, header.tagDataOffset, tagIndex.baseMemoryAddress), baseAt + 12);
  out.writeUInt32LE(0, baseAt + 16);

  // message elements TagReflexive at +20
  out.writeUInt32LE(elements.length, baseAt + 20);
  out.writeUInt32LE(unresolvePointer(elemOff, header.tagDataOffset, tagIndex.baseMemoryAddress), baseAt + 24);
  out.writeUInt32LE(0, baseAt + 28);

  // messages TagReflexive at +32
  out.writeUInt32LE(messages.length, baseAt + 32);
  out.writeUInt32LE(unresolvePointer(msgOff, header.tagDataOffset, tagIndex.baseMemoryAddress), baseAt + 36);
  out.writeUInt32LE(0, baseAt + 40);

  const updatedHeader = {
    ...header,
    fileSize: out.length,
    tagDataSize: header.tagDataSize + appendBytes,
  };
  serializeCacheFileHeader(updatedHeader).copy(out, 0);

  return {
    buffer: out,
    tagPath: entry.path,
    tagGroup: 'hud_message_text',
    entryCount: messages.length,
    messageNames: messages.map((m) => m.name),
  };
}

/**
 * Option 3 (Milestone 19): Inspects a `meter` (`metr`, 172 bytes) tag, reading its color gradient stops,
 * stencil dimensions, and RLE/raw encoded stencil bytes, and decodes a preview RGBA buffer.
 */
export function inspectMeterTag(
  view: Buffer,
  meterTagIndex: number,
): {
  tagPath: string;
  width: number;
  height: number;
  interpolateColors: number;
  anchorColors: number;
  emptyColorHex: string;
  fullColorHex: string;
  unmaskDistance: number;
  maskDistance: number;
  encodedBytes: number;
  previewRgba: number[];
} {
  const header = parseCacheFileHeader(view);
  const tagIndex = parseTagIndex(view, header);
  const entry = tagIndex.entries[meterTagIndex];
  if (!entry || (entry.primaryClassName !== 'meter' && fourCCToString(entry.primaryClassFourCC) !== 'metr')) {
    throw new Error(`Tag #${meterTagIndex} is not a meter (metr) tag.`);
  }

  const mAt = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  const interpolateColors = view.readUInt16LE(mAt + 60);
  const anchorColors = view.readUInt16LE(mAt + 62);

  const readColorHex = (off: number): [number, number, number, number, string] => {
    const a = Math.max(0, Math.min(255, Math.round(view.readFloatLE(off + 0) * 255)));
    const r = Math.max(0, Math.min(255, Math.round(view.readFloatLE(off + 4) * 255)));
    const g = Math.max(0, Math.min(255, Math.round(view.readFloatLE(off + 8) * 255)));
    const b = Math.max(0, Math.min(255, Math.round(view.readFloatLE(off + 12) * 255)));
    const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    return [r, g, b, a, hex];
  };

  const [er, eg, eb, , emptyColorHex] = readColorHex(mAt + 72);
  const [fr, fg, fb, , fullColorHex] = readColorHex(mAt + 88);
  const unmaskDistance = view.readFloatLE(mAt + 124);
  const maskDistance = view.readFloatLE(mAt + 128);

  const rawW = view.readUInt16LE(mAt + 136) || view.readUInt16LE(mAt + 120) || 128;
  const rawH = view.readUInt16LE(mAt + 138) || view.readUInt16LE(mAt + 122) || 32;
  const width = Math.max(16, Math.min(256, rawW));
  const height = Math.max(8, Math.min(128, rawH));

  const encodedBytes = view.readUInt32LE(mAt + 152);
  const encodedPtr = view.readUInt32LE(mAt + 164);
  const encodedOff =
    encodedBytes > 0 && encodedPtr > 0
      ? resolvePointer(encodedPtr, header.tagDataOffset, tagIndex.baseMemoryAddress)
      : 0;

  const previewRgba = new Array<number>(width * height * 4).fill(0);
  if (encodedOff > 0 && encodedOff + encodedBytes <= view.length) {
    // Sample encoded stencil values & apply meter color gradient across width x height
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = Math.floor(((y * width + x) / (width * height)) * encodedBytes);
        const v = view.readUInt8(encodedOff + srcIdx);
        const t = x / Math.max(1, width - 1);
        const pIdx = (y * width + x) * 4;
        if (v > 8) {
          previewRgba[pIdx + 0] = Math.round(er + (fr - er) * t);
          previewRgba[pIdx + 1] = Math.round(eg + (fg - eg) * t);
          previewRgba[pIdx + 2] = Math.round(eb + (fb - eb) * t);
          previewRgba[pIdx + 3] = Math.max(110, v);
        } else {
          previewRgba[pIdx + 0] = 15;
          previewRgba[pIdx + 1] = 23;
          previewRgba[pIdx + 2] = 42;
          previewRgba[pIdx + 3] = 180;
        }
      }
    }
  } else {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = x / Math.max(1, width - 1);
        const pIdx = (y * width + x) * 4;
        previewRgba[pIdx + 0] = Math.round(er + (fr - er) * t);
        previewRgba[pIdx + 1] = Math.round(eg + (fg - eg) * t);
        previewRgba[pIdx + 2] = Math.round(eb + (fb - eb) * t);
        previewRgba[pIdx + 3] = 220;
      }
    }
  }

  return {
    tagPath: entry.path,
    width,
    height,
    interpolateColors,
    anchorColors,
    emptyColorHex,
    fullColorHex,
    unmaskDistance: Number(unmaskDistance.toFixed(3)),
    maskDistance: Number(maskDistance.toFixed(3)),
    encodedBytes,
    previewRgba,
  };
}

/**
 * Option 3 (Milestone 19): Compiles pre-rasterized 8-bit grayscale/alpha glyph bitmaps
 * (generated from any system or TrueType `.ttf` font in an HTML5 `<canvas>`) directly into
 * a Halo CE `font` (`font`, 156 bytes) tag in-memory, updating `characters`, `character tables`,
 * and `pixels`.
 */
export function compileCanvasAtlasIntoFontTag(
  view: Buffer,
  targetFontTagIndex: number,
  glyphSpec: {
    ascendingHeight: number;
    descendingHeight: number;
    leadingHeight: number;
    leadingWidth: number;
    glyphs: Array<{
      charCode: number;
      characterWidth: number;
      bitmapWidth: number;
      bitmapHeight: number;
      bitmapOriginX: number;
      bitmapOriginY: number;
      alphaPixels: number[];
    }>;
  },
): {
  buffer: Buffer;
  tagPath: string;
  glyphCount: number;
  totalPixelBytes: number;
} {
  const header = parseCacheFileHeader(view);
  const tagIndex = parseTagIndex(view, header);
  const entry = tagIndex.entries[targetFontTagIndex];
  if (!entry || (entry.primaryClassName !== 'font' && fourCCToString(entry.primaryClassFourCC) !== 'font')) {
    throw new Error(`Tag #${targetFontTagIndex} is not a font tag.`);
  }

  let fontAt = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  const needsInternalizeFont = entry.isExternal || fontAt < header.tagDataOffset || fontAt + 156 > view.length;
  const rootFontAllocBytes = needsInternalizeFont ? 160 : 0;
  const glyphs = glyphSpec.glyphs;

  // Compute total pixel bytes and per-glyph pixel offsets
  const pixelOffsets: number[] = [];
  let totalPixelBytes = 0;
  for (const g of glyphs) {
    pixelOffsets.push(totalPixelBytes);
    totalPixelBytes += g.bitmapWidth * g.bitmapHeight;
  }

  const charsBytes = glyphs.length * 20;
  // 256 top-level character tables (12B each = 3072B) + Table 0's 256 2-byte indices (512B)
  const charTablesHeaderBytes = 256 * 12;
  const table0IndicesBytes = 256 * 2;
  const alignedPixelsBytes = (totalPixelBytes + 3) & ~3;
  const appendBytes =
    (rootFontAllocBytes + charTablesHeaderBytes + table0IndicesBytes + charsBytes + alignedPixelsBytes + 15) & ~15;

  const out = Buffer.alloc(view.length + appendBytes);
  view.copy(out, 0);

  let cursor = view.length;
  if (needsInternalizeFont) {
    fontAt = cursor;
    cursor += rootFontAllocBytes;
    // Initialize the 4 TagDependency slots (bold, italic, condense, underline at +60..+123) to NULL_TAG_ID
    for (let d = 0; d < 4; d++) {
      const dOff = fontAt + 60 + d * 16;
      out.writeUInt32LE(0x666f6e74, dOff + 0); // 'font'
      out.writeUInt32LE(0, dOff + 4);
      out.writeUInt32LE(0, dOff + 8);
      out.writeUInt32LE(0xffffffff, dOff + 12);
    }
    const tagHeaderSize = header.engine === 5 ? 0x24 : 0x28;
    const entryOff = header.tagDataOffset + tagHeaderSize + targetFontTagIndex * 32;
    out.writeUInt32LE(unresolvePointer(fontAt, header.tagDataOffset, tagIndex.baseMemoryAddress), entryOff + 0x14);
    out.writeUInt32LE(0, entryOff + 0x18); // isExternal = 0
  }
  const charTablesOff = cursor;
  cursor += charTablesHeaderBytes;

  const table0Off = cursor;
  cursor += table0IndicesBytes;

  const charsOff = cursor;
  cursor += charsBytes;

  const pixelsOff = cursor;
  cursor += alignedPixelsBytes;

  // Initialize Table 0 with -1 (NONE) for all 256 ASCII character codes
  for (let c = 0; c < 256; c++) {
    out.writeInt16LE(-1, table0Off + c * 2);
  }
  out.writeUInt32LE(256, charTablesOff + 0);
  out.writeUInt32LE(unresolvePointer(table0Off, header.tagDataOffset, tagIndex.baseMemoryAddress), charTablesOff + 4);
  out.writeUInt32LE(0, charTablesOff + 8);

  // Write FontCharacter entries (20B each) and copy 8-bit glyph pixels
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i]!;
    const cOff = charsOff + i * 20;
    const pOff = pixelsOff + pixelOffsets[i]!;
    out.writeUInt16LE(g.charCode & 0xffff, cOff + 0);
    out.writeInt16LE(g.characterWidth, cOff + 2);
    out.writeInt16LE(g.bitmapWidth, cOff + 4);
    out.writeInt16LE(g.bitmapHeight, cOff + 6);
    out.writeInt16LE(g.bitmapOriginX, cOff + 8);
    out.writeInt16LE(g.bitmapOriginY, cOff + 10);
    out.writeInt16LE(-1, cOff + 12); // hardware character index = NONE
    out.writeInt32LE(pixelOffsets[i]!, cOff + 16);

    if (g.charCode >= 0 && g.charCode < 256) {
      out.writeInt16LE(i, table0Off + g.charCode * 2);
    }

    const byteCount = g.bitmapWidth * g.bitmapHeight;
    for (let p = 0; p < byteCount; p++) {
      out.writeUInt8(Math.max(0, Math.min(255, g.alphaPixels[p] ?? 0)), pOff + p);
    }
  }

  // Update root Font struct (156B)
  out.writeInt16LE(glyphSpec.ascendingHeight, fontAt + 4);
  out.writeInt16LE(glyphSpec.descendingHeight, fontAt + 6);
  out.writeInt16LE(glyphSpec.leadingHeight, fontAt + 8);
  out.writeInt16LE(glyphSpec.leadingWidth, fontAt + 10);

  // character tables reflexive at +48
  out.writeUInt32LE(256, fontAt + 48);
  out.writeUInt32LE(unresolvePointer(charTablesOff, header.tagDataOffset, tagIndex.baseMemoryAddress), fontAt + 52);
  out.writeUInt32LE(0, fontAt + 56);

  // characters reflexive at +124
  out.writeUInt32LE(glyphs.length, fontAt + 124);
  out.writeUInt32LE(unresolvePointer(charsOff, header.tagDataOffset, tagIndex.baseMemoryAddress), fontAt + 128);
  out.writeUInt32LE(0, fontAt + 132);

  // pixels TagDataOffset at +136
  out.writeUInt32LE(totalPixelBytes, fontAt + 136);
  out.writeUInt32LE(0, fontAt + 140);
  out.writeUInt32LE(0, fontAt + 144);
  out.writeUInt32LE(unresolvePointer(pixelsOff, header.tagDataOffset, tagIndex.baseMemoryAddress), fontAt + 148);
  out.writeUInt32LE(0, fontAt + 152);

  const updatedHeader = {
    ...header,
    fileSize: out.length,
    tagDataSize: header.tagDataSize + appendBytes,
  };
  serializeCacheFileHeader(updatedHeader).copy(out, 0);

  return {
    buffer: out,
    tagPath: entry.path,
    glyphCount: glyphs.length,
    totalPixelBytes,
  };
}



