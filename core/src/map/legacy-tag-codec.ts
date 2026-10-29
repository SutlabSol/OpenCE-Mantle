import * as fs from 'fs';
import * as path from 'path';
import {
  fourCCFromString,
  lookupTagClass,
  lookupTagClassByName,
  NULL_TAG_ID,
} from '../constants/tag-classes';
import { parseCacheFileHeader } from './header';
import { parseTagIndex } from './tag-index';
import {
  getAllTagGroupNames,
  getBitfieldDefinition,
  getGroupStructName,
  resolveStruct,
  type ResolvedField,
  type ResolvedStruct,
} from './definitions/engine';
import {
  childFieldPath,
  extractTagSet,
  reflexiveElementPath,
  type ExtractedDependencyRef,
} from './tag-extractor';
import {
  deserializeContainer,
  OCETAGS_FORMAT_VERSION,
  OCETAGS_MAGIC,
  serializeContainer,
  type OceContainer,
  type OceContainerEmbeddedRawDataAsset,
  type OceContainerEmbeddedRawDataPatch,
  type OceContainerGbxmodelPart,
  type OceContainerTag,
} from './container';
import {
  applyInjectionWithReport,
  hydrateExternalRawDataInContainer,
  planAddInjection,
  planSwapInjection,
} from './tag-injector';
import { generateOpenCeModToml, type OpenCeModTomlConfig } from './mod-packager';
import type { RandomAccessFile } from './convert/resource-files';

const HEK_GROUP_VERSIONS: Record<string, number> = {
  bitm: 7,
  mod2: 5,
  mode: 4,
  coll: 10,
  scen: 1,
  bipd: 3,
  vehi: 1,
  weap: 2,
  eqip: 2,
  garb: 1,
  proj: 5,
  mach: 1,
  ctrl: 1,
  lifi: 1,
  ssce: 1,
  soso: 2,
  senv: 2,
  sgla: 1,
  schi: 1,
  scex: 1,
  swat: 2,
  smet: 1,
  spla: 1,
  'str#': 1,
  ustr: 1,
  'snd!': 4,
  antr: 4,
  phys: 4,
  foot: 1,
  effe: 4,
  part: 2,
  pctl: 4,
  cont: 3,
  ligh: 3,
  lens: 2,
  mgs2: 1,
  deca: 1,
  itmc: 0,
  actv: 2,
  actr: 2,
  'jpt!': 6,
  unhi: 1,
  wphi: 2,
  grhi: 1,
  udlg: 1,
  lsnd: 3,
  trak: 2,
  scnr: 2,
  sbsp: 5,
};

function isTwoByteScalarType(field: ResolvedField): boolean {
  const t = field.def.type;
  if (
    t === 'int16' ||
    t === 'uint16' ||
    t === 'Index' ||
    t === 'Point2DInt' ||
    t === 'Rectangle2D'
  ) {
    return true;
  }
  const bf = getBitfieldDefinition(t);
  if (bf) return bf.width === 16;
  // All enums in Halo CE are 2 bytes
  if (field.size === 2 && !field.def.bounds && (!field.def.count || field.def.count === 1)) {
    return true;
  }
  return false;
}

function isOneByteOrRawField(field: ResolvedField): boolean {
  const t = field.def.type;
  if (t === 'TagString' || t === 'int8' || t === 'uint8') return true;
  const bf = getBitfieldDefinition(t);
  if (bf && bf.width === 8) return true;
  return false;
}

/**
 * Swaps scalar/composite/enum/bitfield fields in `buf` at `baseOffset` between Little-Endian and Big-Endian.
 * Does NOT touch `TagDependency`, `TagReflexive`, or `TagDataOffset` (handled explicitly by caller).
 */
function swapScalarFieldsInPlace(buf: Buffer, baseOffset: number, structDef: ResolvedStruct): void {
  for (const field of structDef.fields) {
    const fType = field.def.type;
    if (fType === 'TagDependency' || fType === 'TagReflexive' || fType === 'TagDataOffset') {
      continue;
    }
    if (isOneByteOrRawField(field)) {
      continue;
    }
    const start = baseOffset + field.offset;
    if (start + field.size > buf.length) continue;
    if (isTwoByteScalarType(field)) {
      for (let off = start; off + 2 <= start + field.size; off += 2) {
        const b0 = buf[off]!;
        buf[off] = buf[off + 1]!;
        buf[off + 1] = b0;
      }
    } else {
      for (let off = start; off + 4 <= start + field.size; off += 4) {
        const b0 = buf[off]!;
        const b1 = buf[off + 1]!;
        buf[off] = buf[off + 3]!;
        buf[off + 1] = buf[off + 2]!;
        buf[off + 2] = b1;
        buf[off + 3] = b0;
      }
    }
  }
}

/**
 * Serializes an `OceContainerTag` into a 64-byte `'blam'` Big-Endian HEK / OpenCE loose tag buffer.
 */
export function serializeContainerTagToHekLooseBuffer(tag: OceContainerTag): Buffer {
  const classInfo = lookupTagClassByName(tag.group);
  const fourCCStr = classInfo?.groupId ?? 'none';
  const header = Buffer.alloc(64, 0);
  header.write(fourCCStr, 36, 4, 'latin1');
  header.writeUInt32BE(0x4d6f7a7a, 40); // 'Mozz'
  header.writeUInt32BE(64, 44);
  header.writeUInt16BE(HEK_GROUP_VERSIONS[fourCCStr] ?? 1, 56);
  header[58] = 0x00;
  header[59] = 0xff;
  header.write('blam', 60, 4, 'latin1');

  const srcData = Buffer.from(tag.data, 'base64');
  const depsByPath = new Map<string, ExtractedDependencyRef>();
  for (const dep of tag.dependencies) {
    depsByPath.set(dep.fieldPath, dep);
  }

  const assets = (tag.embeddedRawDataAssets ?? []).map((a) => Buffer.from(a.data, 'base64'));
  const patchByOffset = new Map<number, Buffer>();
  for (const p of tag.embeddedRawDataPatches ?? []) {
    const assetBuf = assets[p.assetIndex];
    if (assetBuf) patchByOffset.set(p.patchOffset, assetBuf);
  }

  // Pre-build processed pixel data for Bitmap tags
  let bitmapProcessedPixels: Buffer = Buffer.alloc(0);
  const bitmapPlateRelativeOffsets = new Map<number, number>();
  if (tag.group === 'bitmap' && srcData.length >= 108) {
    const bCount = srcData.readUInt32LE(96);
    const bLocalOff = srcData.readUInt32LE(100);
    if (bCount > 0 && bLocalOff + bCount * 48 <= srcData.length) {
      const chunks: Buffer[] = [];
      let runningOff = 0;
      for (let i = 0; i < bCount; i++) {
        const elemOff = bLocalOff + i * 48;
        const patched = patchByOffset.get(elemOff + 24);
        if (patched) {
          bitmapPlateRelativeOffsets.set(i, runningOff);
          chunks.push(patched);
          runningOff += patched.length;
        }
      }
      bitmapProcessedPixels = Buffer.concat(chunks);
    }
  }

  const gbxPartMap = new Map<string, OceContainerGbxmodelPart>();
  for (const part of tag.gbxmodelGeometryParts ?? []) {
    gbxPartMap.set(`${part.geometryIndex}:${part.partIndex}`, part);
  }

  const outChunks: Buffer[] = [header];

  const writeStructArray = (
    structName: string,
    localBase: number,
    count: number,
    _parentFieldPath: string,
    elemPathFn: (idx: number) => string,
    geomIdxContext = -1,
  ): void => {
    const structDef = resolveStruct(structName);
    const totalBytes = count * structDef.totalSize;
    const blockBuf = Buffer.alloc(totalBytes, 0);
    if (localBase >= 0 && localBase + totalBytes <= srcData.length) {
      srcData.copy(blockBuf, 0, localBase, localBase + totalBytes);
    }

    interface DeferredAction {
      run: () => void;
    }
    const deferred: DeferredAction[] = [];

    for (let i = 0; i < count; i++) {
      const elemSrcOff = localBase + i * structDef.totalSize;
      const elemDstOff = i * structDef.totalSize;
      const elemPath = elemPathFn(i);

      // Special adjustments before endian swap
      if (structName === 'BitmapData') {
        const relOff = bitmapPlateRelativeOffsets.get(i);
        if (relOff !== undefined) {
          const flags = blockBuf.readUInt16LE(elemDstOff + 14);
          blockBuf.writeUInt16LE(flags & ~0x0100, elemDstOff + 14); // clear external bit
          blockBuf.writeUInt32LE(relOff, elemDstOff + 24); // pixel data offset in processed pixel data
          blockBuf.writeUInt32LE(0, elemDstOff + 28); // loose tags store 0 in pixel data size
          blockBuf.writeUInt32LE(0, elemDstOff + 32);
          blockBuf.writeUInt32LE(0, elemDstOff + 36);
        }
      } else if (structName === 'GBXModelGeometryPart') {
        const gbxPart = gbxPartMap.get(`${geomIdxContext}:${i}`);
        if (gbxPart) {
          const vertRaw = Buffer.from(gbxPart.vertexData, 'base64');
          const triRaw = Buffer.from(gbxPart.triangleData, 'base64');
          const vCount = Math.floor(vertRaw.length / 68);
          // Pad triangle indices to multiple of 6 bytes (3 uint16s per ModelTriangle) with 0xFFFF
          const rem = triRaw.length % 6;
          const triPadded =
            rem === 0 ? Buffer.from(triRaw) : Buffer.concat([triRaw, Buffer.alloc(6 - rem, 0xff)]);
          const triBlockCount = Math.floor(triPadded.length / 6);

          // Set uncompressed vertices count at +32, compressed=0 at +44, triangles count at +56
          blockBuf.writeUInt32LE(vCount, elemDstOff + 32);
          blockBuf.writeUInt32LE(0, elemDstOff + 36);
          blockBuf.writeUInt32LE(0, elemDstOff + 40);
          blockBuf.writeUInt32LE(0, elemDstOff + 44);
          blockBuf.writeUInt32LE(0, elemDstOff + 48);
          blockBuf.writeUInt32LE(0, elemDstOff + 52);
          blockBuf.writeUInt32LE(triBlockCount, elemDstOff + 56);
          blockBuf.writeUInt32LE(0, elemDstOff + 60);
          blockBuf.writeUInt32LE(0, elemDstOff + 64);
          // Clear cache-only offsets/counts at +72..103 while keeping triBufferType(+68)=1 and vertexType(+84)=4
          blockBuf.fill(0, elemDstOff + 72, elemDstOff + 84);
          blockBuf.fill(0, elemDstOff + 88, elemDstOff + 104);
        }
      }

      swapScalarFieldsInPlace(blockBuf, elemDstOff, structDef);

      for (const field of structDef.fields) {
        const fOffDst = elemDstOff + field.offset;
        const fOffSrc = elemSrcOff + field.offset;
        const fPath = childFieldPath(elemPath, field.name);

        if (field.def.type === 'TagDependency') {
          const dep = depsByPath.get(fPath);
          const depGroupName = dep?.group || field.def.classes?.[0] || '';
          const depClassInfo = lookupTagClassByName(depGroupName);
          let fourCC = depClassInfo?.groupId ?? 'ÿÿÿÿ';
          if ((!dep || dep.kind === 'null' || !dep.path) && fOffSrc + 4 <= srcData.length) {
            // Preserve original FourCC from source struct (reversed from LE to BE)
            const origLe = srcData.subarray(fOffSrc, fOffSrc + 4);
            fourCC = Buffer.from([origLe[3]!, origLe[2]!, origLe[1]!, origLe[0]!]).toString('latin1');
          }
          const depPath = dep && dep.kind !== 'null' ? dep.path : '';
          blockBuf.write(fourCC, fOffDst + 0, 4, 'latin1');
          blockBuf.writeUInt32BE(0, fOffDst + 4);
          blockBuf.writeUInt32BE(depPath.length, fOffDst + 8);
          blockBuf.writeUInt32BE(0xffffffff, fOffDst + 12);
          if (depPath.length > 0) {
            deferred.push({
              run: () => {
                outChunks.push(Buffer.from(`${depPath}\0`, 'latin1'));
              },
            });
          }
        } else if (field.def.type === 'TagDataOffset') {
          let payload: Buffer = Buffer.alloc(0);
          if (structName === 'Bitmap' && field.name === 'processed pixel data') {
            payload = bitmapProcessedPixels;
          } else if (structName === 'SoundPermutation' && field.name === 'samples') {
            const patched = patchByOffset.get(fOffSrc + 8);
            if (patched) {
              payload = Buffer.from(patched);
              const compression = srcData.readUInt16LE(elemSrcOff + 24);
              if (compression === 0) {
                // 16-bit PCM in loose .sound is Big-Endian
                for (let s = 0; s + 2 <= payload.length; s += 2) {
                  const b0 = payload[s]!;
                  payload[s] = payload[s + 1]!;
                  payload[s + 1] = b0;
                }
              }
            }
          } else if (!field.def.nonCached && fOffSrc + 20 <= srcData.length) {
            const sz = srcData.readUInt32LE(fOffSrc + 0);
            const ptrLow = srcData.readUInt32LE(fOffSrc + 12);
            if (sz > 0 && ptrLow + sz <= srcData.length) {
              payload = Buffer.from(srcData.subarray(ptrLow, ptrLow + sz));
              if (
                structName === 'Scenario' &&
                field.name === 'script syntax data' &&
                payload.length >= 56 &&
                payload.readUInt32LE(40) === 0x64407440
              ) {
                const tblDef = resolveStruct('ScenarioScriptNodeTable');
                const nodeDef = resolveStruct('ScenarioScriptNode');
                swapScalarFieldsInPlace(payload, 0, tblDef);
                const nodeCount = Math.floor((payload.length - 56) / 20);
                for (let n = 0; n < nodeCount; n++) {
                  swapScalarFieldsInPlace(payload, 56 + n * 20, nodeDef);
                }
              }
            }
          }
          blockBuf.writeUInt32BE(payload.length, fOffDst + 0);
          blockBuf.writeUInt32BE(0, fOffDst + 4);
          blockBuf.writeUInt32BE(0, fOffDst + 8);
          blockBuf.writeUInt32BE(0, fOffDst + 12);
          blockBuf.writeUInt32BE(0, fOffDst + 16);
          if (payload.length > 0) {
            deferred.push({
              run: () => {
                outChunks.push(payload);
              },
            });
          }
        } else if (field.def.type === 'TagReflexive' && field.def.struct) {
          const childStruct = field.def.struct;
          if (
            structName === 'GBXModelGeometryPart' &&
            (field.name === 'uncompressed vertices' || field.name === 'triangles')
          ) {
            const gbxPart = gbxPartMap.get(`${geomIdxContext}:${i}`);
            if (gbxPart && field.name === 'uncompressed vertices') {
              const vertRaw = Buffer.from(gbxPart.vertexData, 'base64');
              const vCount = Math.floor(vertRaw.length / 68);
              blockBuf.writeUInt32BE(vCount, fOffDst + 0);
              blockBuf.writeUInt32BE(0, fOffDst + 4);
              blockBuf.writeUInt32BE(0, fOffDst + 8);
              if (vCount > 0) {
                deferred.push({
                  run: () => {
                    const vBuf = Buffer.from(vertRaw.subarray(0, vCount * 68));
                    const vDef = resolveStruct('ModelVertexUncompressed');
                    for (let v = 0; v < vCount; v++) {
                      swapScalarFieldsInPlace(vBuf, v * 68, vDef);
                    }
                    outChunks.push(vBuf);
                  },
                });
              }
              continue;
            } else if (gbxPart && field.name === 'triangles') {
              const triRaw = Buffer.from(gbxPart.triangleData, 'base64');
              const rem = triRaw.length % 6;
              const triPadded =
                rem === 0 ? Buffer.from(triRaw) : Buffer.concat([triRaw, Buffer.alloc(6 - rem, 0xff)]);
              const triBlockCount = Math.floor(triPadded.length / 6);
              blockBuf.writeUInt32BE(triBlockCount, fOffDst + 0);
              blockBuf.writeUInt32BE(0, fOffDst + 4);
              blockBuf.writeUInt32BE(0, fOffDst + 8);
              if (triBlockCount > 0) {
                deferred.push({
                  run: () => {
                    for (let k = 0; k + 2 <= triPadded.length; k += 2) {
                      const b0 = triPadded[k]!;
                      triPadded[k] = triPadded[k + 1]!;
                      triPadded[k + 1] = b0;
                    }
                    outChunks.push(triPadded);
                  },
                });
              }
              continue;
            }
          }

          let childCount = 0;
          let childLocalBase = 0;
          if (!field.def.nonCached && fOffSrc + 12 <= srcData.length) {
            childCount = srcData.readUInt32LE(fOffSrc + 0);
            childLocalBase = srcData.readUInt32LE(fOffSrc + 4);
          }
          blockBuf.writeUInt32BE(childCount, fOffDst + 0);
          blockBuf.writeUInt32BE(0, fOffDst + 4);
          blockBuf.writeUInt32BE(0, fOffDst + 8);
          if (childCount > 0) {
            const nextGeomIdx = structName === 'GBXModelGeometry' ? i : geomIdxContext;
            deferred.push({
              run: () => {
                writeStructArray(
                  childStruct,
                  childLocalBase,
                  childCount,
                  fPath,
                  (cIdx) => reflexiveElementPath(elemPath, field.name, cIdx),
                  nextGeomIdx,
                );
              },
            });
          }
        }
      }
    }

    outChunks.push(blockBuf);
    for (const action of deferred) {
      action.run();
    }
  };

  writeStructArray(tag.structName, 0, 1, tag.path, () => tag.path);
  return Buffer.concat(outChunks);
}

/**
 * Exports one or more tags from an open map into an OpenCE Mod Package structure:
 * - `mod.toml` (`name`, `version`, `authors`, `description`, `format = 1`)
 * - `tags/<tag_path>.<full_group_name>` in 64-byte `'blam'` Big-Endian HEK loose tag format.
 */
export function exportOpenCeModPackageFromMap(
  mapBuffer: Buffer,
  rootTagIndices: number[],
  modConfig: OpenCeModTomlConfig,
  options?: {
    includeDependencies?: boolean;
    replaceTargetTagIndex?: number;
    resourceFiles?: { bitmaps?: RandomAccessFile; sounds?: RandomAccessFile };
  },
): {
  modFolderName: string;
  modToml: string;
  tagFiles: Array<{ relativePath: string; group: string; tagPath: string; bytes: Buffer }>;
} {
  const header = parseCacheFileHeader(mapBuffer);
  const tagIndex = parseTagIndex(mapBuffer, header);

  const nonExternalRoots = rootTagIndices.filter((idx) => {
    const ent = tagIndex.entries[idx];
    return ent && !ent.isExternal;
  });

  // sample_mods/ only ever contain these exact override tag groups (.gbxmodel, .bitmap, .sound, .unicode_string_list)
  const ALLOWED_SAMPLE_MOD_GROUPS = new Set([
    'gbxmodel',
    'bitmap',
    'sound',
    'unicode_string_list',
  ]);

  let fullContainer: OceContainer | null = null;
  const tagsToSerialize: OceContainerTag[] = [];
  if (nonExternalRoots.length > 0) {
    const extracted = extractTagSet(mapBuffer, header, tagIndex, nonExternalRoots, {
      resourceFiles: options?.resourceFiles,
      captureGbxmodelRawData: true,
    });
    fullContainer = deserializeContainer(
      serializeContainer(extracted, header.scenarioName),
    );
    hydrateExternalRawDataInContainer(fullContainer, options?.resourceFiles);

    // Check if the user selected a high-level object (e.g. .biped, .vehicle, .weapon, .scenery) or a non-vanilla .gbxmodel
    // OR specified a target vanilla item to replace (`replaceTargetTagIndex`).
    const rootSet = new Set(rootTagIndices);
    const rootTags = fullContainer.tags.filter((t) => rootSet.has(t.originalIndex));
    const hasHighLevelObjectRoot = rootTags.some((t) => !ALLOWED_SAMPLE_MOD_GROUPS.has(t.group));

    // Resolve target vanilla replacement tag (explicit `replaceTargetTagIndex`, or auto-detected when exporting a custom biped/spartan/vehicle/weapon)
    let targetReplaceEntry =
      options?.replaceTargetTagIndex !== undefined && options.replaceTargetTagIndex >= 0
        ? tagIndex.entries[options.replaceTargetTagIndex]
        : undefined;

    if (!targetReplaceEntry && rootTags.length > 0) {
      const firstRoot = rootTags[0]!;
      const pLower = firstRoot.path.toLowerCase();
      if (
        firstRoot.group === 'biped' ||
        pLower.includes('spartan') ||
        pLower.includes('hayabusa') ||
        pLower.includes('cqb') ||
        pLower.includes('eva') ||
        pLower.includes('recon') ||
        pLower.includes('markvi')
      ) {
        targetReplaceEntry =
          tagIndex.entries.find((e) => e.primaryClassName === 'gbxmodel' && e.path.toLowerCase() === 'characters\\cyborg\\cyborg') ??
          tagIndex.entries.find((e) => e.primaryClassName === 'biped' && e.path.toLowerCase().includes('cyborg'));
      }
    }

    // If targetReplaceEntry is an object tag (.biped, .vehicle, .weapon, .scenery), resolve its underlying .gbxmodel tag in the map
    let targetGbxEntry =
      targetReplaceEntry?.primaryClassName === 'gbxmodel' ? targetReplaceEntry : undefined;
    if (targetReplaceEntry && !targetGbxEntry && !targetReplaceEntry.isExternal) {
      const tgtExtracted = extractTagSet(mapBuffer, header, tagIndex, [targetReplaceEntry.index], {
        captureGbxmodelRawData: false,
      });
      const gbxTag = tgtExtracted.tags.find((t) => t.group === 'gbxmodel');
      if (gbxTag) {
        targetGbxEntry = tagIndex.entries[gbxTag.originalIndex];
      }
    }

    if (targetGbxEntry || hasHighLevelObjectRoot) {
      // Exact-file export mode (matching `sample_mods/Female Spartan` and `sample_mods/Minecraft Steve`):
      // 1. Find the primary `.gbxmodel` from the selected tag's dependency tree
      const sourceGbx =
        rootTags.find((t) => t.group === 'gbxmodel') ??
        fullContainer.tags.find((t) => t.group === 'gbxmodel');

      if (sourceGbx) {
        // Collect the shaders directly referenced by `sourceGbx` and their diffuse/multipurpose bitmaps
        const shaderIndices = sourceGbx.dependencies
          .filter((d) => d.fieldPath.includes('.shaders[') && d.kind === 'internal' && d.localTagIndex !== undefined)
          .map((d) => d.localTagIndex!);

        const neededBitmapTags: Array<{ tag: OceContainerTag; role: 'base' | 'multi' | 'detail'; shaderName: string }> = [];
        const seenBitmapLocal = new Set<number>();
        for (const sIdx of shaderIndices) {
          const shTag = fullContainer.tags[sIdx];
          if (!shTag) continue;
          for (const dep of shTag.dependencies) {
            if (dep.group !== 'bitmap' || dep.kind !== 'internal' || dep.localTagIndex === undefined) continue;
            if (seenBitmapLocal.has(dep.localTagIndex)) continue;
            const bmTag = fullContainer.tags[dep.localTagIndex];
            if (!bmTag) continue;
            // Skip standard generic detail/cubemap bitmaps (e.g. rasterizer\*, Cryo glass, etc.) if we are replacing a target model
            const bmLower = bmTag.path.toLowerCase();
            if (targetGbxEntry && (bmLower.startsWith('rasterizer\\') || bmLower.startsWith('levels\\'))) {
              continue;
            }
            const fpLower = dep.fieldPath.toLowerCase();
            const role: 'base' | 'multi' | 'detail' =
              fpLower.includes('multipurpose') || bmLower.includes('multi')
                ? 'multi'
                : fpLower.includes('base map') || neededBitmapTags.filter((b) => b.role === 'base').length === 0
                  ? 'base'
                  : 'detail';
            seenBitmapLocal.add(dep.localTagIndex);
            neededBitmapTags.push({ tag: bmTag, role, shaderName: shTag.path.toLowerCase() });
          }
        }

        if (targetGbxEntry && !targetGbxEntry.isExternal) {
          // Inspect target vanilla `.gbxmodel` to get its exact path, shader paths, and vanilla bitmap paths
          const tgtSub = extractTagSet(mapBuffer, header, tagIndex, [targetGbxEntry.index], {
            captureGbxmodelRawData: false,
          });
          const tgtGbx = tgtSub.tags.find((t) => t.group === 'gbxmodel');
          const tgtShaderDeps = (tgtGbx?.dependencies ?? []).filter((d) => d.fieldPath.includes('.shaders['));
          const tgtShaderTags = tgtShaderDeps
            .map((d) => (d.kind === 'internal' && d.localTagIndex !== undefined ? tgtSub.tags[d.localTagIndex] : undefined))
            .filter((t): t is NonNullable<typeof t> => Boolean(t));

          // Find target vanilla base & multipurpose bitmap paths (e.g. `characters\cyborg\bitmaps\cyborg` and `characters\cyborg\bitmaps\cyborg multipurpose`)
          const tgtDir = path.win32.dirname(targetGbxEntry.path);
          const tgtBaseName = path.win32.basename(targetGbxEntry.path);
          let targetBaseBitmapPath = `${tgtDir}\\bitmaps\\${tgtBaseName}`;
          let targetMultiBitmapPath = `${tgtDir}\\bitmaps\\${tgtBaseName} multipurpose`;

          for (const ts of tgtShaderTags) {
            for (const d of ts.dependencies) {
              if (d.group !== 'bitmap' || !d.path) continue;
              const dl = d.path.toLowerCase();
              if (dl.includes('multi') || d.fieldPath.toLowerCase().includes('multipurpose')) {
                targetMultiBitmapPath = d.path;
              } else if (d.fieldPath.toLowerCase().includes('base map')) {
                targetBaseBitmapPath = d.path;
              }
            }
          }

          // Remap `sourceGbx` path to `targetGbxEntry.path` (e.g. `characters\cyborg\cyborg`)
          const oldGbxPrefix = `${sourceGbx.path}.`;
          const newGbxPrefix = `${targetGbxEntry.path}.`;
          sourceGbx.path = targetGbxEntry.path;
          for (const dep of sourceGbx.dependencies) {
            if (dep.fieldPath.startsWith(oldGbxPrefix)) {
              dep.fieldPath = `${newGbxPrefix}${dep.fieldPath.slice(oldGbxPrefix.length)}`;
            }
          }

          // Remap `sourceGbx` shader dependencies onto the target vanilla model's shaders (just like `Female Spartan` uses `characters\cyborg\shaders\armor` & `visor`)
          if (tgtShaderDeps.length > 0) {
            const visorTarget = tgtShaderDeps.find((d) => d.path.toLowerCase().includes('visor'));
            const armorTarget =
              tgtShaderDeps.find((d) => d.path.toLowerCase().includes('armor') || d.path.toLowerCase().includes('hull') || d.path.toLowerCase().includes('body')) ??
              tgtShaderDeps.find((d) => !d.path.toLowerCase().includes('visor')) ??
              tgtShaderDeps[0]!;
            for (const dep of sourceGbx.dependencies) {
              if (!dep.fieldPath.includes('.shaders[')) continue;
              const origLower = dep.path.toLowerCase();
              const chosenTarget = origLower.includes('visor') || origLower.includes('glass')
                ? (visorTarget ?? armorTarget)
                : armorTarget;
              if (chosenTarget) {
                dep.group = chosenTarget.group;
                dep.path = chosenTarget.path;
              }
            }
          }

          tagsToSerialize.push(sourceGbx);

          // Rename the primary diffuse & multipurpose bitmaps to the target vanilla bitmap paths
          let assignedBase = false;
          let assignedMulti = false;
          for (const item of neededBitmapTags) {
            if (item.role === 'base' && !assignedBase) {
              item.tag.path = targetBaseBitmapPath;
              assignedBase = true;
              tagsToSerialize.push(item.tag);
            } else if (item.role === 'multi' && !assignedMulti) {
              item.tag.path = targetMultiBitmapPath;
              assignedMulti = true;
              tagsToSerialize.push(item.tag);
            }
          }
        } else {
          // No target vanilla override specified, still export only the exact `.gbxmodel` + its direct `.bitmap` files
          tagsToSerialize.push(sourceGbx);
          for (const item of neededBitmapTags) {
            tagsToSerialize.push(item.tag);
          }
        }
      } else {
        // Fallback: filter to allowed sample_mods groups
        for (const t of fullContainer.tags) {
          if (ALLOWED_SAMPLE_MOD_GROUPS.has(t.group)) {
            tagsToSerialize.push(t);
          }
        }
      }

      // Also include any explicitly queued root `.bitmap`, `.sound`, or `.unicode_string_list` tags
      for (const rTag of rootTags) {
        if (
          (rTag.group === 'bitmap' || rTag.group === 'sound' || rTag.group === 'unicode_string_list') &&
          !tagsToSerialize.some((existing) => existing.originalIndex === rTag.originalIndex)
        ) {
          if (
            options?.replaceTargetTagIndex !== undefined &&
            options.replaceTargetTagIndex >= 0 &&
            rootTags.length === 1 &&
            tagIndex.entries[options.replaceTargetTagIndex]?.primaryClassName === rTag.group
          ) {
            const oldP = `${rTag.path}.`;
            const newP = `${tagIndex.entries[options.replaceTargetTagIndex]!.path}.`;
            rTag.path = tagIndex.entries[options.replaceTargetTagIndex]!.path;
            for (const dep of rTag.dependencies) {
              if (dep.fieldPath.startsWith(oldP)) {
                dep.fieldPath = `${newP}${dep.fieldPath.slice(oldP.length)}`;
              }
            }
          }
          tagsToSerialize.push(rTag);
        }
      }
    } else {
      const chosen =
        options?.includeDependencies === false
          ? fullContainer.tags.filter((t: OceContainerTag) => rootSet.has(t.originalIndex))
          : fullContainer.tags.filter((t: OceContainerTag) => ALLOWED_SAMPLE_MOD_GROUPS.has(t.group) || rootSet.has(t.originalIndex));
      tagsToSerialize.push(...chosen);
    }
  }

  // Also support exporting external bitmaps directly from bitmaps.map if selected
  const bitmapsRf = options?.resourceFiles?.bitmaps;
  if (bitmapsRf && bitmapsRf.size >= 16) {
    const resTableOff = bitmapsRf.read(8, 4).readUInt32LE(0);
    const resCount = bitmapsRf.read(12, 4).readUInt32LE(0);
    for (const rIdx of rootTagIndices) {
      const ent = tagIndex.entries[rIdx];
      if (!ent || !ent.isExternal || ent.primaryClassName !== 'bitmap') continue;
      const resEntryIdx = ent.tagDataPointerOrResourceIndex;
      if (resEntryIdx >= resCount) continue;
      const rowBuf = bitmapsRf.read(resTableOff + resEntryIdx * 12, 12);
      const dataSize = rowBuf.readUInt32LE(4);
      const dataOff = rowBuf.readUInt32LE(8);
      if (dataSize < 108 || dataOff + dataSize > bitmapsRf.size) continue;
      const structBytes = Buffer.from(bitmapsRf.read(dataOff, dataSize));
      const bCount = structBytes.readUInt32LE(96);
      const bOff = structBytes.readUInt32LE(100);
      const assets: OceContainerEmbeddedRawDataAsset[] = [];
      const patches: OceContainerEmbeddedRawDataPatch[] = [];
      if (bCount > 0 && bOff + bCount * 48 <= structBytes.length) {
        for (let i = 0; i < bCount; i++) {
          const elemOff = bOff + i * 48;
          const pixOff = structBytes.readUInt32LE(elemOff + 24);
          const pixSize = structBytes.readUInt32LE(elemOff + 28);
          if (pixSize > 0 && pixOff + pixSize <= bitmapsRf.size) {
            const pixBytes = Buffer.from(bitmapsRf.read(pixOff, pixSize));
            const assetIndex = assets.length;
            assets.push({ kind: 'bitmap', data: pixBytes.toString('base64') });
            patches.push({ assetIndex, patchOffset: elemOff + 24, patchWidth: 4 });
            const flags = structBytes.readUInt16LE(elemOff + 14);
            structBytes.writeUInt16LE(flags & ~0x0100, elemOff + 14);
          }
        }
      }
      tagsToSerialize.push({
        originalIndex: ent.index,
        group: 'bitmap',
        path: ent.path,
        structName: 'Bitmap',
        data: structBytes.toString('base64'),
        dependencies: [],
        embeddedRawDataAssets: assets,
        embeddedRawDataPatches: patches,
      });
    }
  }

  const tagFiles: Array<{ relativePath: string; group: string; tagPath: string; bytes: Buffer }> = [];
  for (const t of tagsToSerialize) {
    const looseBytes = serializeContainerTagToHekLooseBuffer(t);
    const relPath = path.join('tags', `${t.path.replace(/\\/g, path.sep)}.${t.group}`);
    tagFiles.push({
      relativePath: relPath,
      group: t.group,
      tagPath: t.path,
      bytes: looseBytes,
    });
  }

  const modFolderName =
    (modConfig.name || modConfig.modId || 'custom_opence_mod')
      .trim()
      .replace(/[<>:"/\\|?*]+/g, '_') || 'custom_opence_mod';

  return {
    modFolderName,
    modToml: generateOpenCeModToml(modConfig),
    tagFiles,
  };
}

/**
 * Parses a single 64-byte `'blam'` Big-Endian HEK / OpenCE loose tag file into an `OceContainerTag`.
 */
export function parseHekLooseTagBuffer(
  buf: Buffer,
  tagPath: string,
  overrideGroup?: string,
): {
  tag: OceContainerTag;
  referencedDeps: Array<{ group: string; path: string; fieldPath: string; fieldOffset: number }>;
} {
  if (buf.length < 64 || buf.toString('latin1', 60, 64) !== 'blam') {
    throw new Error(`File "${tagPath}" is not a valid 64-byte 'blam' HEK/OpenCE loose tag file.`);
  }
  const fourCCStr = buf.toString('latin1', 36, 40);
  const classInfo = overrideGroup
    ? lookupTagClassByName(overrideGroup)
    : lookupTagClass(fourCCFromString(fourCCStr));
  const groupName = overrideGroup || classInfo?.name;
  if (!groupName) {
    throw new Error(`Unknown HEK tag group FourCC "${fourCCStr}" in "${tagPath}".`);
  }
  const rootStructName = getGroupStructName(groupName);
  if (!rootStructName) {
    throw new Error(`No struct definition found for tag group "${groupName}".`);
  }

  let readCursor = 64;
  const leChunks: Buffer[] = [];
  let totalLeBytes = 0;

  const allocLe = (size: number): { buf: Buffer; offset: number } => {
    const pad = (4 - (totalLeBytes % 4)) % 4;
    if (pad > 0) {
      leChunks.push(Buffer.alloc(pad, 0));
      totalLeBytes += pad;
    }
    const b = Buffer.alloc(size, 0);
    const offset = totalLeBytes;
    leChunks.push(b);
    totalLeBytes += size;
    return { buf: b, offset };
  };

  const referencedDeps: Array<{ group: string; path: string; fieldPath: string; fieldOffset: number }> = [];
  const embeddedRawDataAssets: OceContainerEmbeddedRawDataAsset[] = [];
  const embeddedRawDataPatches: OceContainerEmbeddedRawDataPatch[] = [];
  const gbxmodelGeometryParts: OceContainerGbxmodelPart[] = [];

  let bitmapProcessedPixelBuf: Buffer = Buffer.alloc(0);

  const readStructArray = (
    structName: string,
    count: number,
    elemPathFn: (idx: number) => string,
    geomIdxContext = -1,
  ): { buf: Buffer; offset: number } => {
    const structDef = resolveStruct(structName);
    const byteLen = count * structDef.totalSize;
    if (readCursor + byteLen > buf.length) {
      throw new Error(
        `Unexpected EOF reading ${count}x ${structName} at offset ${readCursor} (file length ${buf.length}) in "${tagPath}".`,
      );
    }
    const alloc = allocLe(byteLen);
    buf.copy(alloc.buf, 0, readCursor, readCursor + byteLen);
    readCursor += byteLen;

    for (let i = 0; i < count; i++) {
      const elemLocalInBuf = i * structDef.totalSize;
      const elemAbsLeOff = alloc.offset + elemLocalInBuf;
      const elemPath = elemPathFn(i);

      swapScalarFieldsInPlace(alloc.buf, elemLocalInBuf, structDef);

      let partUncompressedVerts: Buffer | null = null;
      let partCompressedVerts: Buffer | null = null;
      let partTriangles: Buffer | null = null;

      for (const field of structDef.fields) {
        const fLocalOff = elemLocalInBuf + field.offset;
        const fAbsLeOff = elemAbsLeOff + field.offset;
        const fPath = childFieldPath(elemPath, field.name);

        if (field.def.type === 'TagDependency') {
          const b0 = alloc.buf[fLocalOff + 0]!;
          const b1 = alloc.buf[fLocalOff + 1]!;
          const b2 = alloc.buf[fLocalOff + 2]!;
          const b3 = alloc.buf[fLocalOff + 3]!;
          const depFourCCStr = Buffer.from([b0, b1, b2, b3]).toString('latin1');
          // Write reversed FourCC for LE cache layout
          alloc.buf[fLocalOff + 0] = b3;
          alloc.buf[fLocalOff + 1] = b2;
          alloc.buf[fLocalOff + 2] = b1;
          alloc.buf[fLocalOff + 3] = b0;

          const pathLen = alloc.buf.readUInt32BE(fLocalOff + 8);
          alloc.buf.writeUInt32LE(0, fLocalOff + 4);
          alloc.buf.writeUInt32LE(0, fLocalOff + 8);

          let depPath = '';
          if (pathLen > 0 && readCursor + pathLen + 1 <= buf.length) {
            depPath = buf.toString('latin1', readCursor, readCursor + pathLen).replace(/\0.*$/, '');
            readCursor += pathLen + 1;
          }
          const depClass = lookupTagClass(fourCCFromString(depFourCCStr));
          const depGroup = depClass?.name || field.def.classes?.[0] || '';
          if (depPath.length > 0 && depGroup) {
            alloc.buf.writeUInt32LE(0, fLocalOff + 12); // non-null placeholder tagId so rewriteAddedTagData visits it
            referencedDeps.push({
              group: depGroup,
              path: depPath.replace(/\//g, '\\'),
              fieldPath: fPath,
              fieldOffset: fAbsLeOff,
            });
          } else {
            alloc.buf.writeUInt32LE(NULL_TAG_ID, fLocalOff + 12);
          }
        } else if (field.def.type === 'TagDataOffset') {
          const dataSize = alloc.buf.readUInt32BE(fLocalOff + 0);
          let payload: Buffer = Buffer.alloc(0);
          if (dataSize > 0 && readCursor + dataSize <= buf.length) {
            payload = Buffer.from(buf.subarray(readCursor, readCursor + dataSize));
            readCursor += dataSize;
          }

          if (structName === 'Bitmap' && field.name === 'processed pixel data') {
            bitmapProcessedPixelBuf = payload;
            alloc.buf.fill(0, fLocalOff, fLocalOff + 20);
          } else if (structName === 'SoundPermutation' && field.name === 'samples') {
            const compression = alloc.buf.readUInt16LE(elemLocalInBuf + 24);
            if (compression === 0 && payload.length >= 2) {
              // Convert 16-bit PCM from Big-Endian (HEK loose) to Little-Endian (PC cache)
              for (let s = 0; s + 2 <= payload.length; s += 2) {
                const s0 = payload[s]!;
                payload[s] = payload[s + 1]!;
                payload[s + 1] = s0;
              }
            }
            alloc.buf.writeUInt32LE(payload.length, fLocalOff + 0);
            alloc.buf.writeUInt32LE(0, fLocalOff + 4); // internal (external=0)
            alloc.buf.writeUInt32LE(0, fLocalOff + 8); // fileOffset patched on inject
            alloc.buf.writeUInt32LE(0, fLocalOff + 12);
            alloc.buf.writeUInt32LE(0, fLocalOff + 16);
            if (payload.length > 0) {
              const assetIndex = embeddedRawDataAssets.length;
              embeddedRawDataAssets.push({ kind: 'sound', data: payload.toString('base64') });
              embeddedRawDataPatches.push({
                assetIndex,
                patchOffset: fAbsLeOff + 8,
                patchWidth: 4,
              });
            }
          } else if (field.def.nonCached) {
            alloc.buf.fill(0, fLocalOff, fLocalOff + 20);
          } else if (payload.length > 0) {
            if (
              structName === 'Scenario' &&
              field.name === 'script syntax data' &&
              payload.length >= 56 &&
              payload.readUInt32BE(40) === 0x64407440
            ) {
              const tblDef = resolveStruct('ScenarioScriptNodeTable');
              const nodeDef = resolveStruct('ScenarioScriptNode');
              swapScalarFieldsInPlace(payload, 0, tblDef);
              payload.writeUInt32LE(0, 52); // clear runtime first element ptr
              const nodeCount = Math.floor((payload.length - 56) / 20);
              for (let n = 0; n < nodeCount; n++) {
                swapScalarFieldsInPlace(payload, 56 + n * 20, nodeDef);
              }
            }
            const dataAlloc = allocLe(payload.length);
            payload.copy(dataAlloc.buf, 0);
            alloc.buf.writeUInt32LE(payload.length, fLocalOff + 0);
            alloc.buf.writeUInt32LE(0, fLocalOff + 4);
            alloc.buf.writeUInt32LE(0, fLocalOff + 8);
            alloc.buf.writeUInt32LE(dataAlloc.offset, fLocalOff + 12);
            alloc.buf.writeUInt32LE(0, fLocalOff + 16);
          } else {
            alloc.buf.fill(0, fLocalOff, fLocalOff + 20);
          }
        } else if (field.def.type === 'TagReflexive' && field.def.struct) {
          const childCount = alloc.buf.readUInt32BE(fLocalOff + 0);
          const childStruct = field.def.struct;

          if (structName === 'GBXModelGeometryPart' && field.def.nonCached) {
            alloc.buf.fill(0, fLocalOff, fLocalOff + 12);
            if (childCount > 0) {
              const cDef = resolveStruct(childStruct);
              const rawLen = childCount * cDef.totalSize;
              if (readCursor + rawLen <= buf.length) {
                const cBuf = Buffer.from(buf.subarray(readCursor, readCursor + rawLen));
                readCursor += rawLen;
                for (let c = 0; c < childCount; c++) {
                  swapScalarFieldsInPlace(cBuf, c * cDef.totalSize, cDef);
                }
                if (field.name === 'uncompressed vertices') partUncompressedVerts = cBuf;
                else if (field.name === 'compressed vertices') partCompressedVerts = cBuf;
                else if (field.name === 'triangles') partTriangles = cBuf;
              }
            }
            continue;
          }

          if (childCount > 0 && !field.def.nonCached) {
            const nextGeomIdx = structName === 'GBXModelGeometry' ? i : geomIdxContext;
            const childAlloc = readStructArray(
              childStruct,
              childCount,
              (cIdx) => reflexiveElementPath(elemPath, field.name, cIdx),
              nextGeomIdx,
            );
            alloc.buf.writeUInt32LE(childCount, fLocalOff + 0);
            alloc.buf.writeUInt32LE(childAlloc.offset, fLocalOff + 4);
            alloc.buf.writeUInt32LE(0, fLocalOff + 8);
          } else {
            if (childCount > 0 && field.def.nonCached) {
              const cDef = resolveStruct(childStruct);
              const structArrayStart = readCursor;
              readCursor += childCount * cDef.totalSize;
              // Advance past any TagDataOffset payloads inside nonCached structs (e.g. ScenarioSourceFile.source)
              for (let cIdx = 0; cIdx < childCount; cIdx++) {
                const elemOff = structArrayStart + cIdx * cDef.totalSize;
                for (const cf of cDef.fields) {
                  if (cf.def.type === 'TagDataOffset' && elemOff + cf.offset + 4 <= buf.length) {
                    const dataSz = buf.readUInt32BE(elemOff + cf.offset);
                    if (dataSz > 0 && readCursor + dataSz <= buf.length) {
                      readCursor += dataSz;
                    }
                  }
                }
              }
            }
            alloc.buf.fill(0, fLocalOff, fLocalOff + 12);
          }
        }
      }

      if (structName === 'GBXModelGeometryPart' && (partUncompressedVerts || partCompressedVerts) && partTriangles) {
        const vertBytes = partUncompressedVerts ?? partCompressedVerts!;
        const vType = partUncompressedVerts ? 4 : 5;
        const vStride = vType === 4 ? 68 : 32;
        const vCount = Math.floor(vertBytes.length / vStride);

        // Trim up to 2 trailing 0xFFFF padding words from the loose ModelTriangle array to get exact strip length
        let indexCount = Math.floor(partTriangles.length / 2);
        let stripLen = indexCount;
        while (stripLen > 3 && stripLen > indexCount - 2 && partTriangles.readUInt16LE((stripLen - 1) * 2) === 0xffff) {
          stripLen--;
        }
        const triCount = Math.max(1, stripLen - 2);
        // Ensure triangle strip buffer ends with 0xFFFF, 0xFFFF as expected in cache files
        const stripBytes = partTriangles.subarray(0, stripLen * 2);
        const term = Buffer.from([0xff, 0xff, 0xff, 0xff]);
        const finalTriBytes = Buffer.concat([stripBytes, term]);

        alloc.buf.writeUInt16LE(1, elemLocalInBuf + 68); // triangle buffer type = 1 (triangle strip)
        alloc.buf.writeUInt32LE(triCount, elemLocalInBuf + 72); // triangle count
        alloc.buf.writeUInt16LE(vType, elemLocalInBuf + 84); // vertex type
        alloc.buf.writeUInt32LE(vCount, elemLocalInBuf + 88); // vertex count

        gbxmodelGeometryParts.push({
          geometryIndex: Math.max(0, geomIdxContext),
          partIndex: i,
          vertexType: vType,
          vertexCount: vCount,
          vertexData: vertBytes.toString('base64'),
          triangleBufferType: 1,
          triangleCount: triCount,
          triangleData: finalTriBytes.toString('base64'),
        });
      }
    }

    if (structName === 'BitmapData' && count > 0 && bitmapProcessedPixelBuf.length > 0) {
      for (let i = 0; i < count; i++) {
        const elemLocal = i * 48;
        const elemAbs = alloc.offset + elemLocal;
        const pixOff = alloc.buf.readUInt32LE(elemLocal + 24);
        const nextOff =
          i + 1 < count
            ? alloc.buf.readUInt32LE((i + 1) * 48 + 24)
            : bitmapProcessedPixelBuf.length;
        const plateSize = Math.max(0, nextOff - pixOff);
        const plateBytes = bitmapProcessedPixelBuf.subarray(pixOff, pixOff + plateSize);
        const flags = alloc.buf.readUInt16LE(elemLocal + 14);
        alloc.buf.writeUInt16LE(flags & ~0x0100, elemLocal + 14); // internal (external=0)
        alloc.buf.writeUInt32LE(plateBytes.length, elemLocal + 28); // pixel data size
        const assetIndex = embeddedRawDataAssets.length;
        embeddedRawDataAssets.push({ kind: 'bitmap', data: plateBytes.toString('base64') });
        embeddedRawDataPatches.push({
          assetIndex,
          patchOffset: elemAbs + 24,
          patchWidth: 4,
        });
      }
    }

    return alloc;
  };

  readStructArray(rootStructName, 1, () => tagPath);
  const fullLeData = Buffer.concat(leChunks);

  // Set standard secondary/tertiary class FourCCs for object/unit/item/device/shader hierarchies
  let secondaryClassFourCC: number | null = null;
  let tertiaryClassFourCC: number | null = null;
  if (['biped', 'vehicle'].includes(groupName)) {
    secondaryClassFourCC = fourCCFromString('unit');
    tertiaryClassFourCC = fourCCFromString('obje');
  } else if (['weapon', 'equipment', 'garbage'].includes(groupName)) {
    secondaryClassFourCC = fourCCFromString('item');
    tertiaryClassFourCC = fourCCFromString('obje');
  } else if (['device_machine', 'device_control', 'device_light_fixture'].includes(groupName)) {
    secondaryClassFourCC = fourCCFromString('devi');
    tertiaryClassFourCC = fourCCFromString('obje');
  } else if (['scenery', 'projectile', 'sound_scenery'].includes(groupName)) {
    secondaryClassFourCC = fourCCFromString('obje');
  } else if (groupName.startsWith('shader_')) {
    secondaryClassFourCC = fourCCFromString('shdr');
  }

  return {
    tag: {
      originalIndex: 0,
      group: groupName,
      path: tagPath,
      structName: rootStructName,
      data: fullLeData.toString('base64'),
      dependencies: [],
      secondaryClassFourCC,
      tertiaryClassFourCC,
      embeddedRawDataAssets: embeddedRawDataAssets.length > 0 ? embeddedRawDataAssets : undefined,
      embeddedRawDataPatches: embeddedRawDataPatches.length > 0 ? embeddedRawDataPatches : undefined,
      gbxmodelGeometryParts: gbxmodelGeometryParts.length > 0 ? gbxmodelGeometryParts : undefined,
    },
    referencedDeps,
  };
}

/**
 * Parses an HMT v3.5 `.meta` + `.xml` extracted tag pair into an `OceContainerTag`.
 */
export function parseHmtMetaXmlTagPair(
  metaPath: string,
  xmlPath: string,
): {
  tag: OceContainerTag;
  referencedDeps: Array<{ group: string; path: string; fieldPath: string; fieldOffset: number }>;
  extractRootDir: string;
} {
  const metaBuf = Buffer.from(fs.readFileSync(metaPath));
  const xmlText = fs.readFileSync(xmlPath, 'utf8');

  const tagMatch = xmlText.match(/<Tag>([\s\S]*?)<\/Tag>/i);
  const fileMatch = xmlText.match(/<Filename>([\s\S]*?)<\/Filename>/i);
  if (!tagMatch || !fileMatch) {
    throw new Error(`Invalid HMT XML metadata file "${xmlPath}" (missing <Tag> or <Filename>).`);
  }

  const rawTagHier = tagMatch[1]!;
  const rev4 = (s: string) =>
    Buffer.from(s, 'latin1').subarray(0, 4).reverse().toString('latin1');
  const primaryFourCC = rev4(rawTagHier.slice(0, 4));
  const classInfo = lookupTagClass(fourCCFromString(primaryFourCC));
  if (!classInfo) {
    throw new Error(`Unsupported HMT tag class "${primaryFourCC}" in "${xmlPath}".`);
  }
  const groupName = classInfo.name;
  const rootStructName = getGroupStructName(groupName);
  if (!rootStructName) {
    throw new Error(`No struct definition for HMT tag group "${groupName}".`);
  }

  const tagPath = fileMatch[1]!.trim().replace(/\//g, '\\');

  // Determine the extract root directory by stripping `tagPath` components from `metaPath`'s directory
  const tagParts = tagPath.split('\\');
  let extractRootDir = path.dirname(metaPath);
  for (let i = 0; i < tagParts.length - 1; i++) {
    extractRootDir = path.dirname(extractRootDir);
  }

  // Apply all <Reflexive> translations into metaBuf so pointerLow holds local byte offsets
  const reflRegex = /<Reflexive>\s*<Location>0x([0-9a-fA-F]+)<\/Location>\s*<Translation>0x([0-9a-fA-F]+)<\/Translation>\s*<ChunkCount>(\d+)<\/ChunkCount>\s*<\/Reflexive>/g;
  let m: RegExpExecArray | null;
  while ((m = reflRegex.exec(xmlText)) !== null) {
    const loc = Number.parseInt(m[1]!, 16);
    const trans = Number.parseInt(m[2]!, 16);
    const cnt = Number.parseInt(m[3]!, 10);
    if (loc >= 4 && loc + 8 <= metaBuf.length) {
      metaBuf.writeUInt32LE(cnt, loc - 4);
      metaBuf.writeUInt32LE(trans, loc);
      metaBuf.writeUInt32LE(0, loc + 4);
    }
  }

  // Collect <Dependency> entries by fieldOffset (Location - 12)
  const depByOffset = new Map<number, { group: string; path: string }>();
  const depRegex = /<Dependency>\s*<Location>0x([0-9a-fA-F]+)<\/Location>\s*<Tagclass>([\s\S]*?)<\/Tagclass>\s*<Filename>([\s\S]*?)<\/Filename>\s*<\/Dependency>/g;
  while ((m = depRegex.exec(xmlText)) !== null) {
    const loc = Number.parseInt(m[1]!, 16);
    const fieldOffset = loc - 12;
    const rawCls = m[2]!;
    const depFourCC = rev4(rawCls.slice(0, 4));
    const depClsInfo = lookupTagClass(fourCCFromString(depFourCC));
    const depPath = m[3]!.trim().replace(/\//g, '\\');
    if (fieldOffset >= 0 && fieldOffset + 16 <= metaBuf.length && depClsInfo && depPath) {
      depByOffset.set(fieldOffset, { group: depClsInfo.name, path: depPath });
      metaBuf.writeUInt32LE(0, fieldOffset + 12); // non-null placeholder tagId
    }
  }

  // Walk the struct tree in metaBuf to map each TagDependency fieldOffset to its exact fieldPath
  const referencedDeps: Array<{ group: string; path: string; fieldPath: string; fieldOffset: number }> = [];
  const visitedOffsets = new Set<number>();
  const walkLeStruct = (structName: string, localOff: number, curPath: string): void => {
    const def = resolveStruct(structName);
    if (localOff < 0 || localOff + def.totalSize > metaBuf.length) return;
    for (const f of def.fields) {
      if (f.def.nonCached) continue;
      const fOff = localOff + f.offset;
      const fPath = childFieldPath(curPath, f.name);
      if (f.def.type === 'TagDependency') {
        const depInfo = depByOffset.get(fOff);
        if (depInfo) {
          referencedDeps.push({
            group: depInfo.group,
            path: depInfo.path,
            fieldPath: fPath,
            fieldOffset: fOff,
          });
        } else {
          metaBuf.writeUInt32LE(NULL_TAG_ID, fOff + 12);
        }
      } else if (f.def.type === 'TagReflexive' && f.def.struct) {
        const cnt = metaBuf.readUInt32LE(fOff + 0);
        const childBase = metaBuf.readUInt32LE(fOff + 4);
        const childSize = resolveStruct(f.def.struct).totalSize;
        if (cnt > 0 && childBase > 0 && childBase + cnt * childSize <= metaBuf.length && !visitedOffsets.has(childBase)) {
          visitedOffsets.add(childBase);
          for (let i = 0; i < cnt; i++) {
            walkLeStruct(
              f.def.struct,
              childBase + i * childSize,
              reflexiveElementPath(curPath, f.name, i),
            );
          }
        }
      }
    }
  };
  walkLeStruct(rootStructName, 0, tagPath);

  // If this is a gbxmodel (.mod2.meta), check for companion .mod2.vertices and .mod2.indices
  const gbxmodelGeometryParts: OceContainerGbxmodelPart[] = [];
  if (groupName === 'gbxmodel') {
    const baseDir = path.dirname(metaPath);
    const vertAssetMatch = xmlText.match(/<Asset>\s*<Type>VertexBlock<\/Type>\s*<Filename>([\s\S]*?)<\/Filename>([\s\S]*?)<\/Asset>/i);
    const idxAssetMatch = xmlText.match(/<Asset>\s*<Type>IndexBlock<\/Type>\s*<Filename>([\s\S]*?)<\/Filename>([\s\S]*?)<\/Asset>/i);
    if (vertAssetMatch && idxAssetMatch) {
      const vertFile = path.join(baseDir, vertAssetMatch[1]!.trim());
      const idxFile = path.join(baseDir, idxAssetMatch[1]!.trim());
      if (fs.existsSync(vertFile) && fs.existsSync(idxFile)) {
        const vertBuf = fs.readFileSync(vertFile);
        const idxBuf = fs.readFileSync(idxFile);
        const vertTransByLoc = new Map<number, number>();
        const corrRegex = /<Correction>\s*<Location>0x([0-9a-fA-F]+)<\/Location>\s*<Translation>0x([0-9a-fA-F]+)<\/Translation>\s*<\/Correction>/g;
        let cm: RegExpExecArray | null;
        while ((cm = corrRegex.exec(vertAssetMatch[2]!)) !== null) {
          vertTransByLoc.set(Number.parseInt(cm[1]!, 16), Number.parseInt(cm[2]!, 16));
        }
        const idxTransByLoc = new Map<number, number>();
        corrRegex.lastIndex = 0;
        while ((cm = corrRegex.exec(idxAssetMatch[2]!)) !== null) {
          idxTransByLoc.set(Number.parseInt(cm[1]!, 16), Number.parseInt(cm[2]!, 16));
        }

        // Walk geometries & parts in metaBuf
        const geomCount = metaBuf.readUInt32LE(208);
        const geomBase = metaBuf.readUInt32LE(212);
        const rawParts: Array<{
          geometryIndex: number;
          partIndex: number;
          vertexType: number;
          vertexCount: number;
          vertTrans: number;
          triangleBufferType: number;
          triangleCount: number;
          idxTrans: number;
        }> = [];
        for (let g = 0; g < geomCount; g++) {
          const gOff = geomBase + g * 48;
          if (gOff + 48 > metaBuf.length) break;
          const pCount = metaBuf.readUInt32LE(gOff + 36);
          const pBase = metaBuf.readUInt32LE(gOff + 40);
          for (let p = 0; p < pCount; p++) {
            const pOff = pBase + p * 132;
            if (pOff + 132 > metaBuf.length) break;
            const vCount = metaBuf.readUInt32LE(pOff + 88);
            const triCount = metaBuf.readUInt32LE(pOff + 72);
            const vTrans = vertTransByLoc.get(pOff + 100) ?? 0;
            const iTrans = idxTransByLoc.get(pOff + 76) ?? 0;
            rawParts.push({
              geometryIndex: g,
              partIndex: p,
              vertexType: 4,
              vertexCount: vCount,
              vertTrans: vTrans,
              triangleBufferType: 1,
              triangleCount: triCount,
              idxTrans: iTrans,
            });
          }
        }
        const sortedByIdx = [...rawParts].sort((a, b) => a.idxTrans - b.idxTrans);
        for (let s = 0; s < sortedByIdx.length; s++) {
          const cur = sortedByIdx[s]!;
          const nextIdxTrans = s + 1 < sortedByIdx.length ? sortedByIdx[s + 1]!.idxTrans : idxBuf.length;
          const vBytes = vertBuf.subarray(cur.vertTrans, cur.vertTrans + cur.vertexCount * 68);
          const tBytes = idxBuf.subarray(cur.idxTrans, Math.max(cur.idxTrans + (cur.triangleCount + 2) * 2, nextIdxTrans));
          gbxmodelGeometryParts.push({
            geometryIndex: cur.geometryIndex,
            partIndex: cur.partIndex,
            vertexType: cur.vertexType,
            vertexCount: cur.vertexCount,
            vertexData: vBytes.toString('base64'),
            triangleBufferType: cur.triangleBufferType,
            triangleCount: cur.triangleCount,
            triangleData: tBytes.toString('base64'),
          });
        }
      }
    }
  }

  let secondaryClassFourCC: number | null = null;
  let tertiaryClassFourCC: number | null = null;
  if (rawTagHier.length >= 8 && rawTagHier.slice(4, 8) !== 'ÿÿÿÿ') {
    secondaryClassFourCC = fourCCFromString(rev4(rawTagHier.slice(4, 8)));
  }
  if (rawTagHier.length >= 12 && rawTagHier.slice(8, 12) !== 'ÿÿÿÿ') {
    tertiaryClassFourCC = fourCCFromString(rev4(rawTagHier.slice(8, 12)));
  }

  return {
    tag: {
      originalIndex: 0,
      group: groupName,
      path: tagPath,
      structName: rootStructName,
      data: metaBuf.toString('base64'),
      dependencies: [],
      secondaryClassFourCC,
      tertiaryClassFourCC,
      gbxmodelGeometryParts: gbxmodelGeometryParts.length > 0 ? gbxmodelGeometryParts : undefined,
    },
    referencedDeps,
    extractRootDir,
  };
}

/**
 * Infers the tag root directory and relative tag path for a loose HEK/OpenCE tag file on disk.
 */
function inferHekTagRootAndPath(filePath: string, buf: Buffer): { rootDir: string; tagPath: string; group: string } {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const fourCCStr = buf.toString('latin1', 36, 40);
  const classInfo = lookupTagClassByName(ext) ?? lookupTagClass(fourCCFromString(fourCCStr));
  const group = classInfo?.name ?? ext;
  const noExt = filePath.slice(0, filePath.length - path.extname(filePath).length);
  const normNoExt = path.resolve(noExt);

  // Check if path contains a `/tags/` or `\tags\` directory (standard OpenCE / HEK layout)
  const lower = normNoExt.toLowerCase();
  const tagsMarker = `${path.sep}tags${path.sep}`;
  const tagsIdx = lower.lastIndexOf(tagsMarker);
  if (tagsIdx >= 0) {
    const rootDir = normNoExt.slice(0, tagsIdx + 5);
    const rel = normNoExt.slice(tagsIdx + tagsMarker.length).replace(/\//g, '\\');
    return { rootDir, tagPath: rel, group };
  }

  // Otherwise check if any parent directory is named `legacy_tags`
  const legacyMarker = `${path.sep}legacy_tags${path.sep}`;
  const legIdx = lower.lastIndexOf(legacyMarker);
  if (legIdx >= 0) {
    const afterLegacy = normNoExt.slice(legIdx + legacyMarker.length);
    const parts = afterLegacy.split(path.sep);
    const packRoot = normNoExt.slice(0, legIdx + legacyMarker.length + (parts[0]?.length ?? 0));
    const legacyRoot = normNoExt.slice(0, legIdx + 12);
    const relFromPack = parts.slice(1).join('\\');
    const relFromLegacy = parts.join('\\');
    // Default to legacyRoot (e.g. `forge\scenery\...`, `grid\scenery\...`), unless internal dependency strings only resolve relative to packRoot
    const asciiText = buf.toString('latin1', 64);
    if (parts[0] && asciiText.includes(`${parts[0]}\\`)) {
      return { rootDir: legacyRoot, tagPath: relFromLegacy, group };
    }
    if (
      parts[0] &&
      !['forge', 'grid', 'weapons', 'vehicles', 'characters', 'scenery', 'sound', 'ui', 'effects', 'levels', 'globals', 'bitmaps', 'shaders'].includes(
        parts[0].toLowerCase(),
      ) &&
      relFromPack
    ) {
      return { rootDir: packRoot, tagPath: relFromPack, group };
    }
    return { rootDir: legacyRoot, tagPath: relFromLegacy, group };
  }

  // Default: use parent directory of top-level category folder (`weapons`, `vehicles`, `characters`, `scenery`, `sound`, `ui`, `effects`, `levels`, `globals`)
  const knownTopFolders = new Set(['weapons', 'vehicles', 'characters', 'scenery', 'sound', 'ui', 'effects', 'levels', 'globals', 'camera', 'sky', 'devices', 'powerups']);
  const segs = normNoExt.split(path.sep);
  for (let i = segs.length - 2; i >= 1; i--) {
    if (knownTopFolders.has(segs[i]!.toLowerCase())) {
      return {
        rootDir: segs.slice(0, i).join(path.sep),
        tagPath: segs.slice(i).join('\\'),
        group,
      };
    }
  }

  return {
    rootDir: path.dirname(normNoExt),
    tagPath: path.basename(normNoExt),
    group,
  };
}

/**
 * Builds a complete `OceContainer` from one or more legacy tag files (HEK/OpenCE loose tags or HMT `.meta`+`.xml` extracts),
 * recursively loading all reachable dependency files from the same tag directory tree.
 */
export function buildContainerFromLegacyTags(inputPaths: string[]): {
  container: OceContainer;
  formatDetected: 'hek_loose' | 'hmt_meta_xml';
} {
  const expandedFiles: string[] = [];
  const validGroupNames = new Set(getAllTagGroupNames());

  const collectFromDir = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectFromDir(full);
      } else if (entry.name.toLowerCase().endsWith('.meta')) {
        const xmlCandidate = `${full.slice(0, -5)}.xml`;
        if (fs.existsSync(xmlCandidate)) expandedFiles.push(full);
      } else {
        const ext = path.extname(entry.name).slice(1).toLowerCase();
        if (validGroupNames.has(ext)) {
          expandedFiles.push(full);
        } else if (!['xml', 'vertices', 'indices', 'toml', 'txt', 'md', 'wav', 'png', 'jpg'].includes(ext)) {
          try {
            const fd = fs.openSync(full, 'r');
            const hdr = Buffer.alloc(64);
            const bytesRead = fs.readSync(fd, hdr, 0, 64, 0);
            fs.closeSync(fd);
            if (bytesRead === 64 && hdr.toString('latin1', 60, 64) === 'blam') {
              expandedFiles.push(full);
            }
          } catch {
            // ignore unreadable
          }
        }
      }
    }
  };

  for (const p of inputPaths) {
    if (!fs.existsSync(p)) continue;
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      collectFromDir(p);
    } else if (p.toLowerCase().endsWith('.sbsp.xml') || p.toLowerCase().endsWith('.sbsp')) {
      // HMT BSP Extract folder: collect all .meta+.xml tags in the extract folder
      collectFromDir(path.dirname(p));
    } else {
      expandedFiles.push(p);
    }
  }

  if (expandedFiles.length === 0) {
    throw new Error('No legacy tag files (.scenery/.biped/.gbxmodel/.bitmap or HMT .meta+.xml) found in selection.');
  }

  const firstFile = expandedFiles[0]!;
  const isHmt =
    firstFile.toLowerCase().endsWith('.meta') ||
    firstFile.toLowerCase().endsWith('.xml');

  const parsedTagsByKey = new Map<
    string,
    {
      localIndex: number;
      tag: OceContainerTag;
      referencedDeps: Array<{ group: string; path: string; fieldPath: string; fieldOffset: number }>;
    }
  >();
  const rootIndices: number[] = [];

  if (isHmt) {
    const queue: Array<{ metaPath: string; xmlPath: string; isRoot: boolean }> = [];
    for (const f of expandedFiles) {
      const base = f.toLowerCase().endsWith('.xml') ? f.slice(0, -4) : f.toLowerCase().endsWith('.meta') ? f.slice(0, -5) : f;
      const metaPath = `${base}.meta`;
      const xmlPath = `${base}.xml`;
      if (fs.existsSync(metaPath) && fs.existsSync(xmlPath)) {
        queue.push({ metaPath, xmlPath, isRoot: true });
      }
    }

    while (queue.length > 0) {
      const cur = queue.shift()!;
      const parsed = parseHmtMetaXmlTagPair(cur.metaPath, cur.xmlPath);
      const key = `${parsed.tag.group}:${parsed.tag.path.toLowerCase()}`;
      if (parsedTagsByKey.has(key)) continue;

      const localIndex = parsedTagsByKey.size;
      parsed.tag.originalIndex = localIndex;
      parsedTagsByKey.set(key, {
        localIndex,
        tag: parsed.tag,
        referencedDeps: parsed.referencedDeps,
      });
      if (cur.isRoot) rootIndices.push(localIndex);

      // Enqueue any sibling .meta+.xml dependencies present on disk
      for (const dep of parsed.referencedDeps) {
        const depKey = `${dep.group}:${dep.path.toLowerCase()}`;
        if (parsedTagsByKey.has(depKey)) continue;
        const clsInfo = lookupTagClassByName(dep.group);
        if (!clsInfo) continue;
        const relFile = dep.path.replace(/\\/g, path.sep);
        const candidateBase = path.join(parsed.extractRootDir, `${relFile}.${clsInfo.groupId}`);
        if (fs.existsSync(`${candidateBase}.meta`) && fs.existsSync(`${candidateBase}.xml`)) {
          queue.push({
            metaPath: `${candidateBase}.meta`,
            xmlPath: `${candidateBase}.xml`,
            isRoot: false,
          });
        }
      }
    }
  } else {
    const queue: Array<{ filePath: string; rootDir?: string; tagPath?: string; group?: string; isRoot: boolean }> =
      expandedFiles.map((f) => ({ filePath: f, isRoot: true }));

    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (!fs.existsSync(cur.filePath)) continue;
      const buf = fs.readFileSync(cur.filePath);
      if (buf.length < 64 || buf.toString('latin1', 60, 64) !== 'blam') continue;

      const info =
        cur.rootDir && cur.tagPath && cur.group
          ? { rootDir: cur.rootDir, tagPath: cur.tagPath, group: cur.group }
          : inferHekTagRootAndPath(cur.filePath, buf);

      const key = `${info.group}:${info.tagPath.toLowerCase()}`;
      if (parsedTagsByKey.has(key)) continue;

      const parsed = parseHekLooseTagBuffer(buf, info.tagPath, info.group);
      const localIndex = parsedTagsByKey.size;
      parsed.tag.originalIndex = localIndex;
      parsedTagsByKey.set(key, {
        localIndex,
        tag: parsed.tag,
        referencedDeps: parsed.referencedDeps,
      });
      if (cur.isRoot) rootIndices.push(localIndex);

      for (const dep of parsed.referencedDeps) {
        const depKey = `${dep.group}:${dep.path.toLowerCase()}`;
        if (parsedTagsByKey.has(depKey)) continue;
        const relFile = `${dep.path.replace(/\\/g, path.sep)}.${dep.group}`;
        const candidate1 = path.join(info.rootDir, relFile);
        const candidate2 = path.join(path.dirname(info.rootDir), relFile);
        if (fs.existsSync(candidate1)) {
          queue.push({
            filePath: candidate1,
            rootDir: info.rootDir,
            tagPath: dep.path,
            group: dep.group,
            isRoot: false,
          });
        } else if (fs.existsSync(candidate2)) {
          queue.push({
            filePath: candidate2,
            rootDir: path.dirname(info.rootDir),
            tagPath: dep.path,
            group: dep.group,
            isRoot: false,
          });
        }
      }
    }
  }

  const allEntries = Array.from(parsedTagsByKey.values());
  for (const entry of allEntries) {
    entry.tag.dependencies = entry.referencedDeps.map((dep) => {
      const target = parsedTagsByKey.get(`${dep.group}:${dep.path.toLowerCase()}`);
      if (target) {
        return {
          fieldPath: dep.fieldPath,
          group: dep.group,
          path: dep.path,
          kind: 'internal',
          localTagIndex: target.localIndex,
          fieldOffset: dep.fieldOffset,
        };
      }
      return {
        fieldPath: dep.fieldPath,
        group: dep.group,
        path: dep.path,
        kind: 'external',
        fieldOffset: dep.fieldOffset,
      };
    });
  }

  const container: OceContainer = {
    magic: OCETAGS_MAGIC,
    formatVersion: OCETAGS_FORMAT_VERSION,
    sourceMapName: isHmt ? 'hmt_legacy_extract' : 'hek_legacy_tags',
    createdAt: new Date().toISOString(),
    hasUnresolvedBspReferences: false,
    rootOriginalIndices: rootIndices.length > 0 ? rootIndices : allEntries.map((e) => e.localIndex),
    tags: allEntries.map((e) => e.tag),
    notExtracted: [],
    warnings: [],
    resourceMapIdentities: {},
    externalResourceRefs: [],
    externalData: 'embedded',
  };

  return {
    container,
    formatDetected: isHmt ? 'hmt_meta_xml' : 'hek_loose',
  };
}

/**
 * Imports one or more legacy tag files (HEK/OpenCE loose tags or HMT `.meta`+`.xml` extracts)
 * into an open map buffer in memory.
 */
export function importLegacyTagsIntoMap(
  mapBuffer: Buffer,
  inputPaths: string[],
  resourceFiles?: { bitmaps?: RandomAccessFile; sounds?: RandomAccessFile },
  mode: 'add' | 'swap' = 'add',
): {
  buffer: Buffer;
  formatDetected: 'hek_loose' | 'hmt_meta_xml';
  addedCount: number;
  swappedCount: number;
  reusedCount: number;
  importedPaths: string[];
  warnings: string[];
} {
  const { container, formatDetected } = buildContainerFromLegacyTags(inputPaths);
  hydrateExternalRawDataInContainer(container, resourceFiles);

  let currentBuf: Buffer = Buffer.from(mapBuffer);
  let header = parseCacheFileHeader(currentBuf);
  let tagIndex = parseTagIndex(currentBuf, header);
  const warnings: string[] = [];

  // Map's active scenario tag: any imported .scenario tag should target the map's active scenario
  // (never append a second orphan scenario tag) and preserve compiled ScenarioBSP cache-only fields.
  const activeScenario =
    tagIndex.entries.find((e) => e.tagId === tagIndex.scenarioTagId) ??
    tagIndex.entries.find((e) => e.primaryClassName === 'scenario');

  for (const t of container.tags) {
    if (t.group === 'scenario' && activeScenario && !activeScenario.isExternal) {
      if (t.path.toLowerCase() !== activeScenario.path.toLowerCase()) {
        const oldPath = t.path;
        const oldPrefix = `${oldPath}.`;
        const newPrefix = `${activeScenario.path}.`;
        t.path = activeScenario.path;
        for (const dep of t.dependencies) {
          if (dep.fieldPath.startsWith(oldPrefix)) {
            dep.fieldPath = `${newPrefix}${dep.fieldPath.slice(oldPrefix.length)}`;
          }
        }
        warnings.push(
          `Remapped scenario tag path "${oldPath}" to active map scenario "${activeScenario.path}".`,
        );
      }

      // Copy compiled cache-only ScenarioBSP fields (bsp start, bsp size, bsp address) from the open map
      const rawBuf = Buffer.from(t.data, 'base64');
      const targetScnrOff =
        header.tagDataOffset +
        (activeScenario.tagDataPointerOrResourceIndex - tagIndex.baseMemoryAddress);
      if (rawBuf.length >= 1456 && targetScnrOff >= 0 && targetScnrOff + 1456 <= currentBuf.length) {
        const targetBspCount = currentBuf.readUInt32LE(targetScnrOff + 1444);
        const targetBspPtr = currentBuf.readUInt32LE(targetScnrOff + 1448);
        const targetBspOff =
          header.tagDataOffset + (targetBspPtr - tagIndex.baseMemoryAddress);
        const localBspCount = rawBuf.readUInt32LE(1444);
        const localBspOff = rawBuf.readUInt32LE(1448);

        if (
          targetBspCount > 0 &&
          localBspCount > 0 &&
          targetBspOff >= 0 &&
          targetBspOff + targetBspCount * 32 <= currentBuf.length &&
          localBspOff >= 1456 &&
          localBspOff + localBspCount * 32 <= rawBuf.length
        ) {
          const copyCount = Math.min(localBspCount, targetBspCount);
          for (let b = 0; b < copyCount; b++) {
            const srcRow = targetBspOff + b * 32;
            const dstRow = localBspOff + b * 32;
            // Copy bsp start (+0), bsp size (+4), bsp address (+8), pad (+12)
            currentBuf.copy(rawBuf, dstRow, srcRow, srcRow + 16);

            // Also ensure structure bsp dependency path matches the target map's BSP tag path
            const targetBspTagId = currentBuf.readUInt32LE(srcRow + 28);
            const targetBspEntry =
              tagIndex.entries.find((e) => e.tagId === targetBspTagId) ??
              tagIndex.entries.find((e) => e.primaryClassName === 'scenario_structure_bsp');
            if (targetBspEntry) {
              const bspDepFieldPath = `${t.path}.structure bsps[${b}].structure bsp`;
              const bspDep = t.dependencies.find((d) => d.fieldPath === bspDepFieldPath);
              if (bspDep) {
                bspDep.path = targetBspEntry.path;
              }
            }
          }
          t.data = rawBuf.toString('base64');
        }
      }
    }
  }

  // If any external dependency in the legacy tag is not present in the target map:
  // 1) Try matching a multiplayer/singleplayer sibling variant (`_mp` suffix added or stripped) in the map;
  // 2) Otherwise clear that dependency slot to Null so standalone tags never get blocked by missing optional refs.
  const mapTagPathByKey = new Map<string, string>();
  for (const e of tagIndex.entries) {
    if (e.primaryClassName) {
      mapTagPathByKey.set(`${e.primaryClassName}:${e.path.toLowerCase()}`, e.path);
    }
  }
  for (const t of container.tags) {
    const rawBuf = Buffer.from(t.data, 'base64');
    let mutated = false;
    t.dependencies = t.dependencies.filter((dep) => {
      if (dep.kind === 'external' && !mapTagPathByKey.has(`${dep.group}:${dep.path.toLowerCase()}`)) {
        const lowerPath = dep.path.toLowerCase();
        const mpCandidateKey = lowerPath.endsWith('_mp')
          ? `${dep.group}:${lowerPath.slice(0, -3)}`
          : `${dep.group}:${lowerPath}_mp`;
        const fallbackPath = mapTagPathByKey.get(mpCandidateKey);
        if (fallbackPath) {
          warnings.push(
            `Remapped missing "${dep.path}" (${dep.group}) in "${t.path}" to "${fallbackPath}".`,
          );
          dep.path = fallbackPath;
          return true;
        }
        if (dep.fieldOffset !== undefined && dep.fieldOffset + 16 <= rawBuf.length) {
          rawBuf.writeUInt32LE(NULL_TAG_ID, dep.fieldOffset + 12);
          mutated = true;
        }
        warnings.push(
          `Cleared missing external dependency "${dep.path}" (${dep.group}) in "${t.path}".`,
        );
        return false;
      }
      return true;
    });
    if (mutated) {
      t.data = rawBuf.toString('base64');
    }
  }

  // Populate default pickup ammo (`rounds left` / `rounds loaded`) for any ScenarioWeapon entries
  // where both fields were left at 0 (which otherwise causes Halo CE's `weapon_place` to strip all
  // initial ammo from magazine-based weapons). Also, on multiplayer scenarios (`Scenario.type === 1`),
  // promote unnamed singleplayer `Scenario.weapons` and `Scenario.equipment` placements into
  // `Scenario.netgame equipment` (`.item_collection`) so they persist, spawn with full default ammo,
  // and respawn every 30 seconds.
  const defaultWeaponAmmoByPath = new Map<string, { roundsLeft: number; roundsLoaded: number }>();
  for (const e of tagIndex.entries) {
    if (e.primaryClassName !== 'weapon' || e.isExternal) continue;
    const weapTagOff =
      header.tagDataOffset + (e.tagDataPointerOrResourceIndex - tagIndex.baseMemoryAddress);
    if (weapTagOff < 0 || weapTagOff + 1288 > currentBuf.length) continue;
    const magCount = currentBuf.readUInt32LE(weapTagOff + 1264);
    const magPtr = currentBuf.readUInt32LE(weapTagOff + 1268);
    if (magCount === 0) continue;
    const magOff = header.tagDataOffset + (magPtr - tagIndex.baseMemoryAddress);
    if (magOff < 0 || magOff + 112 > currentBuf.length) continue;
    const initTotal = currentBuf.readInt16LE(magOff + 6);
    const maxLoaded = currentBuf.readInt16LE(magOff + 10);
    if (initTotal > 0 || maxLoaded > 0) {
      defaultWeaponAmmoByPath.set(e.path.toLowerCase(), {
        roundsLoaded: maxLoaded,
        roundsLeft: Math.max(0, initTotal - maxLoaded),
      });
    }
  }

  const scenarioTags = container.tags.filter((t) => t.group === 'scenario');
  for (const t of scenarioTags) {
    const rawBuf = Buffer.from(t.data, 'base64');
    if (rawBuf.length < 1456) continue;
    const scenarioType = rawBuf.readUInt16LE(60);

    const equipCount = rawBuf.readUInt32LE(600);
    const equipOff = rawBuf.readUInt32LE(604);
    const weapCount = rawBuf.readUInt32LE(624);
    const weapOff = rawBuf.readUInt32LE(628);
    if (equipCount === 0 && weapCount === 0) continue;

    let ammoPatchedCount = 0;
    if (weapCount > 0 && weapOff >= 1456 && weapOff + weapCount * 92 <= rawBuf.length) {
      for (let w = 0; w < weapCount; w++) {
        const rowOff = weapOff + w * 92;
        const palIdx = rawBuf.readInt16LE(rowOff + 0);
        const roundsLeft = rawBuf.readInt16LE(rowOff + 66);
        const roundsLoaded = rawBuf.readInt16LE(rowOff + 68);
        if (roundsLeft === 0 && roundsLoaded === 0 && palIdx >= 0) {
          const palDep = t.dependencies.find(
            (d) => d.fieldPath === `${t.path}.weapon palette[${palIdx}].name`,
          );
          const defAmmo = palDep ? defaultWeaponAmmoByPath.get(palDep.path.toLowerCase()) : undefined;
          if (defAmmo) {
            rawBuf.writeInt16LE(defAmmo.roundsLeft, rowOff + 66);
            rawBuf.writeInt16LE(defAmmo.roundsLoaded, rowOff + 68);
            ammoPatchedCount++;
          }
        }
      }
    }
    if (ammoPatchedCount > 0) {
      t.data = rawBuf.toString('base64');
    }

    if (scenarioType !== 1) continue; // Promotion to netgame equipment applies to multiplayer maps only

    // 1. Scan target map's existing item_collection (itmc) tags to map weapon/equipment -> itmc path
    const existingItmcByItemKey = new Map<string, string>();
    const itemKeyByItmcPath = new Map<string, string>();
    for (const e of tagIndex.entries) {
      if (e.primaryClassName !== 'item_collection' || e.isExternal) continue;
      const itmcOff =
        header.tagDataOffset + (e.tagDataPointerOrResourceIndex - tagIndex.baseMemoryAddress);
      if (itmcOff < 0 || itmcOff + 92 > currentBuf.length) continue;
      const permCount = currentBuf.readUInt32LE(itmcOff + 0);
      const permPtr = currentBuf.readUInt32LE(itmcOff + 4);
      if (permCount !== 1) continue;
      const permOff = header.tagDataOffset + (permPtr - tagIndex.baseMemoryAddress);
      if (permOff < 0 || permOff + 84 > currentBuf.length) continue;
      const itemTagId = currentBuf.readUInt32LE(permOff + 36 + 12);
      const itemEntry = tagIndex.entries.find((x) => x.tagId === itemTagId);
      if (itemEntry && itemEntry.primaryClassName) {
        const itemKey = `${itemEntry.primaryClassName}:${itemEntry.path.toLowerCase()}`;
        if (!existingItmcByItemKey.has(itemKey)) {
          existingItmcByItemKey.set(itemKey, e.path);
        }
        itemKeyByItmcPath.set(e.path.toLowerCase(), itemKey);
      }
    }

    const ensureItmcForItem = (group: string, itemPath: string): string => {
      const itemKey = `${group}:${itemPath.toLowerCase()}`;
      const existing = existingItmcByItemKey.get(itemKey);
      if (existing) return existing;

      const leaf = itemPath.split('\\').pop() || itemPath;
      const itmcPath = `item collections\\singleplayer_promoted\\${leaf}`;
      const itmcBuf = Buffer.alloc(176, 0);
      // Root ItemCollection (92 bytes): permutations TagReflexive at +0, default spawn time (int16) at +12
      itmcBuf.writeUInt32LE(1, 0); // count = 1
      itmcBuf.writeUInt32LE(92, 4); // local offset = 92
      itmcBuf.writeUInt32LE(0, 8);
      itmcBuf.writeInt16LE(30, 12); // default spawn time = 30 seconds
      // ItemCollectionPermutation (84 bytes at +92): weight (float) at +32, item (TagDependency) at +36
      itmcBuf.writeFloatLE(100.0, 92 + 32);
      const itemFourCC = fourCCFromString(group === 'weapon' ? 'weap' : 'eqip');
      itmcBuf.writeUInt32LE(itemFourCC, 92 + 36);
      itmcBuf.writeUInt32LE(0, 92 + 40); // pathPointer
      itmcBuf.writeUInt32LE(0, 92 + 44); // pathSize
      itmcBuf.writeUInt32LE(0, 92 + 48); // non-null placeholder tagId

      container.tags.push({
        originalIndex: container.tags.length,
        group: 'item_collection',
        path: itmcPath,
        structName: 'ItemCollection',
        data: itmcBuf.toString('base64'),
        dependencies: [
          {
            fieldPath: `${itmcPath}.permutations[0].item`,
            fieldOffset: 92 + 36,
            kind: 'external',
            group,
            path: itemPath,
          },
        ],
        secondaryClassFourCC: null,
        tertiaryClassFourCC: null,
      });

      existingItmcByItemKey.set(itemKey, itmcPath);
      itemKeyByItmcPath.set(itmcPath.toLowerCase(), itemKey);
      return itmcPath;
    };

    // 2. Collect existing Scenario.netgame equipment positions so overlapping SP items aren't duplicated
    const netgameCount = rawBuf.readUInt32LE(900);
    const netgameOff = rawBuf.readUInt32LE(904);
    const existingNetgamePlacements: Array<{
      x: number;
      y: number;
      z: number;
      itemKey?: string;
    }> = [];
    if (netgameCount > 0 && netgameOff >= 1456 && netgameOff + netgameCount * 144 <= rawBuf.length) {
      for (let k = 0; k < netgameCount; k++) {
        const rowOff = netgameOff + k * 144;
        const x = rawBuf.readFloatLE(rowOff + 64);
        const y = rawBuf.readFloatLE(rowOff + 68);
        const z = rawBuf.readFloatLE(rowOff + 72);
        const dep = t.dependencies.find(
          (d) => d.fieldPath === `${t.path}.netgame equipment[${k}].item collection`,
        );
        const itemKey = dep ? itemKeyByItmcPath.get(dep.path.toLowerCase()) : undefined;
        existingNetgamePlacements.push({ x, y, z, itemKey });
      }
    }

    // 3. Convert unnamed Scenario.weapons and Scenario.equipment into ScenarioNetgameEquipment entries
    const newNetgameEntries: Array<{
      x: number;
      y: number;
      z: number;
      yaw: number;
      itmcPath: string;
    }> = [];
    const keptWeapons: Buffer[] = [];
    const keptEquipment: Buffer[] = [];
    let skippedOverlapCount = 0;

    if (weapCount > 0 && weapOff >= 1456 && weapOff + weapCount * 92 <= rawBuf.length) {
      for (let w = 0; w < weapCount; w++) {
        const rowOff = weapOff + w * 92;
        const palIdx = rawBuf.readInt16LE(rowOff + 0);
        const objNameIdx = rawBuf.readInt16LE(rowOff + 2);
        const notPlaced = rawBuf.readUInt16LE(rowOff + 4);
        if (objNameIdx >= 0) {
          keptWeapons.push(Buffer.from(rawBuf.subarray(rowOff, rowOff + 92)));
          continue;
        }
        if ((notPlaced & 1) !== 0 || palIdx < 0) continue;
        const palDep = t.dependencies.find(
          (d) => d.fieldPath === `${t.path}.weapon palette[${palIdx}].name`,
        );
        if (!palDep) continue;
        const x = rawBuf.readFloatLE(rowOff + 8);
        const y = rawBuf.readFloatLE(rowOff + 12);
        const z = rawBuf.readFloatLE(rowOff + 16);
        const yaw = rawBuf.readFloatLE(rowOff + 20);
        const itemKey = `${palDep.group}:${palDep.path.toLowerCase()}`;
        const overlapsExisting = existingNetgamePlacements.some(
          (e) => e.itemKey === itemKey && Math.hypot(e.x - x, e.y - y, e.z - z) < 0.5,
        );
        if (overlapsExisting) {
          skippedOverlapCount++;
          continue;
        }
        const itmcPath = ensureItmcForItem(palDep.group, palDep.path);
        newNetgameEntries.push({ x, y, z, yaw, itmcPath });
        existingNetgamePlacements.push({ x, y, z, itemKey });
      }
    }

    if (equipCount > 0 && equipOff >= 1456 && equipOff + equipCount * 40 <= rawBuf.length) {
      for (let eq = 0; eq < equipCount; eq++) {
        const rowOff = equipOff + eq * 40;
        const palIdx = rawBuf.readInt16LE(rowOff + 0);
        const objNameIdx = rawBuf.readInt16LE(rowOff + 2);
        const notPlaced = rawBuf.readUInt16LE(rowOff + 4);
        if (objNameIdx >= 0) {
          keptEquipment.push(Buffer.from(rawBuf.subarray(rowOff, rowOff + 40)));
          continue;
        }
        if ((notPlaced & 1) !== 0 || palIdx < 0) continue;
        const palDep = t.dependencies.find(
          (d) => d.fieldPath === `${t.path}.equipment palette[${palIdx}].name`,
        );
        if (!palDep) continue;
        const x = rawBuf.readFloatLE(rowOff + 8);
        const y = rawBuf.readFloatLE(rowOff + 12);
        const z = rawBuf.readFloatLE(rowOff + 16);
        const yaw = rawBuf.readFloatLE(rowOff + 20);
        const itemKey = `${palDep.group}:${palDep.path.toLowerCase()}`;
        const overlapsExisting = existingNetgamePlacements.some(
          (e) => e.itemKey === itemKey && Math.hypot(e.x - x, e.y - y, e.z - z) < 0.5,
        );
        if (overlapsExisting) {
          skippedOverlapCount++;
          continue;
        }
        const itmcPath = ensureItmcForItem(palDep.group, palDep.path);
        newNetgameEntries.push({ x, y, z, yaw, itmcPath });
        existingNetgamePlacements.push({ x, y, z, itemKey });
      }
    }

    if (
      newNetgameEntries.length > 0 ||
      keptWeapons.length !== weapCount ||
      keptEquipment.length !== equipCount
    ) {
      const totalNetgameCount = netgameCount + newNetgameEntries.length;
      const combinedNetgameBuf = Buffer.alloc(totalNetgameCount * 144, 0);
      if (netgameCount > 0 && netgameOff >= 1456 && netgameOff + netgameCount * 144 <= rawBuf.length) {
        rawBuf.copy(combinedNetgameBuf, 0, netgameOff, netgameOff + netgameCount * 144);
      }

      const newNetgameOff = rawBuf.length;
      for (let k = 0; k < netgameCount; k++) {
        const dep = t.dependencies.find(
          (d) => d.fieldPath === `${t.path}.netgame equipment[${k}].item collection`,
        );
        if (dep) {
          dep.fieldOffset = newNetgameOff + k * 144 + 80;
        }
      }

      const itmcFourCC = fourCCFromString('itmc');
      for (let idx = 0; idx < newNetgameEntries.length; idx++) {
        const k = netgameCount + idx;
        const entry = newNetgameEntries[idx]!;
        const entryOff = k * 144;
        combinedNetgameBuf.writeUInt32LE(0, entryOff + 0); // flags
        combinedNetgameBuf.writeInt16LE(12, entryOff + 4); // type 0 = 12 (all games)
        combinedNetgameBuf.writeInt16LE(0, entryOff + 6); // type 1
        combinedNetgameBuf.writeInt16LE(0, entryOff + 8); // type 2
        combinedNetgameBuf.writeInt16LE(0, entryOff + 10); // type 3
        combinedNetgameBuf.writeInt16LE(0, entryOff + 12); // team index = 0
        combinedNetgameBuf.writeInt16LE(30, entryOff + 14); // spawn time = 30 seconds
        combinedNetgameBuf.writeUInt32LE(0xffffffff, entryOff + 16); // unknown_ffffffff
        combinedNetgameBuf.writeFloatLE(entry.x, entryOff + 64);
        combinedNetgameBuf.writeFloatLE(entry.y, entryOff + 68);
        combinedNetgameBuf.writeFloatLE(entry.z, entryOff + 72);
        combinedNetgameBuf.writeFloatLE(entry.yaw, entryOff + 76);
        combinedNetgameBuf.writeUInt32LE(itmcFourCC, entryOff + 80);
        combinedNetgameBuf.writeUInt32LE(0, entryOff + 84); // pathPointer
        combinedNetgameBuf.writeUInt32LE(0, entryOff + 88); // pathSize
        combinedNetgameBuf.writeUInt32LE(0, entryOff + 92); // non-null placeholder tagId

        t.dependencies.push({
          fieldPath: `${t.path}.netgame equipment[${k}].item collection`,
          fieldOffset: newNetgameOff + entryOff + 80,
          kind: 'external',
          group: 'item_collection',
          path: entry.itmcPath,
        });
      }

      const finalScnrBuf = Buffer.concat([rawBuf, combinedNetgameBuf]);
      finalScnrBuf.writeUInt32LE(totalNetgameCount, 900);
      finalScnrBuf.writeUInt32LE(totalNetgameCount > 0 ? newNetgameOff : 0, 904);
      finalScnrBuf.writeUInt32LE(0, 908);

      if (keptWeapons.length === 0) {
        finalScnrBuf.writeUInt32LE(0, 624);
        finalScnrBuf.writeUInt32LE(0, 628);
        finalScnrBuf.writeUInt32LE(0, 632);
      } else {
        Buffer.concat(keptWeapons).copy(finalScnrBuf, weapOff);
        finalScnrBuf.writeUInt32LE(keptWeapons.length, 624);
      }

      if (keptEquipment.length === 0) {
        finalScnrBuf.writeUInt32LE(0, 600);
        finalScnrBuf.writeUInt32LE(0, 604);
        finalScnrBuf.writeUInt32LE(0, 608);
      } else {
        Buffer.concat(keptEquipment).copy(finalScnrBuf, equipOff);
        finalScnrBuf.writeUInt32LE(keptEquipment.length, 600);
      }

      t.data = finalScnrBuf.toString('base64');
      warnings.push(
        `Promoted ${newNetgameEntries.length} singleplayer weapon/equipment placement(s) into Multiplayer Netgame Equipment (.item_collection)${skippedOverlapCount > 0 ? ` and skipped ${skippedOverlapCount} duplicate overlap(s)` : ''} so they persist and respawn in multiplayer.`,
      );
    }
  }

  let addedCount = 0;
  let swappedCount = 0;
  let reusedCount = 0;
  const importedPaths: string[] = [];
  const addedLocalIndices = new Set<number>();

  // Pass 1: Add any new tags that don't exist in the map yet
  const addPlan = planAddInjection(
    { buffer: currentBuf, header, tagIndex },
    container,
    {},
    { allowEmbeddedRelocation: true },
  );
  if (addPlan.kind === 'ok') {
    reusedCount = addPlan.counts.reused;
    if (addPlan.toAdd.length > 0) {
      const res = applyInjectionWithReport(currentBuf, header, tagIndex, container, addPlan, {
        allowEmbeddedRelocation: true,
      });
      currentBuf = Buffer.from(res.buffer);
      header = parseCacheFileHeader(currentBuf);
      tagIndex = parseTagIndex(currentBuf, header);
      addedCount += addPlan.toAdd.length;
      for (const li of addPlan.toAddLocalIndices) addedLocalIndices.add(li);
      for (const a of addPlan.toAdd) importedPaths.push(`[+${a.group}] ${a.path}`);
    }
  }

  // Pass 2: If mode === 'swap', or no new tags were added, or a scenario tag is being imported, swap matching tags in-place
  const hasScenarioTag = container.tags.some((t) => t.group === 'scenario');
  if (mode === 'swap' || addedCount === 0 || hasScenarioTag) {
    // Exclude tags that were just added in Pass 1 so they are not immediately re-swapped
    const oldToNewIdx = new Map<number, number>();
    const swapTags: OceContainerTag[] = [];
    container.tags.forEach((t, oldIdx) => {
      if (!addedLocalIndices.has(oldIdx)) {
        oldToNewIdx.set(oldIdx, swapTags.length);
        swapTags.push({
          ...t,
          dependencies: t.dependencies.map((d) => ({ ...d })),
        });
      }
    });
    for (const st of swapTags) {
      for (const d of st.dependencies) {
        if (d.kind === 'internal' && d.localTagIndex !== undefined) {
          if (addedLocalIndices.has(d.localTagIndex)) {
            d.kind = 'external';
            delete d.localTagIndex;
          } else {
            d.localTagIndex = oldToNewIdx.get(d.localTagIndex);
          }
        }
      }
    }
    const swapContainer: OceContainer = {
      ...container,
      tags: swapTags,
      rootOriginalIndices: swapTags.map((t) => t.originalIndex),
    };
    const swapPlan = planSwapInjection(
      { buffer: currentBuf, header, tagIndex },
      swapContainer,
      {},
      { allowEmbeddedRelocation: true },
    );
    if (swapPlan.kind === 'ok' && swapPlan.toSwap.length > 0) {
      const res = applyInjectionWithReport(currentBuf, header, tagIndex, swapContainer, swapPlan, {
        allowEmbeddedRelocation: true,
      });
      currentBuf = Buffer.from(res.buffer);
      swappedCount += swapPlan.toSwap.length;
      reusedCount = Math.max(0, reusedCount - swapPlan.toSwap.length);
      for (const s of swapPlan.toSwap) {
        const st = swapContainer.tags[s.localIndex];
        if (st) importedPaths.push(`[~${st.group}] ${st.path}`);
      }
    }
  }

  return {
    buffer: currentBuf,
    formatDetected,
    addedCount,
    swappedCount,
    reusedCount,
    importedPaths,
    warnings,
  };
}
