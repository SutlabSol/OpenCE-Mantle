import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseModelFileForBsp } from '../src/render/glb-model-importer';
import { encodeRgbaToPng } from '../src/render/bitmap-codec';
import {
  preflightModelBspSwap,
  swapMapBspFromModelFile,
} from '../src/map/bsp-swapper';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { extractBspRenderMesh } from '../src/render/bsp-geometry';
import {
  resolveShaderBaseBitmapTagId,
  resolveShaderRenderMetadata,
} from '../src/render/bitmap-textures';
import {
  validateStructInstance,
  locateStructureBsp,
} from '../src/map/definitions/validate-tag';
import { resolveTagDataPointer } from '../src/map/tag-index';

/**
 * Builds a minimal valid binary glTF 2.0 (.glb) buffer containing:
 * - Node 0 ("ground_stone"): a solid walkable quad (2 triangles) at Y = 0
 * - Node 1 ("grass-wind-group"): a foliage alpha card (1 triangle) at Y = 2
 * - 1 embedded 4x4 PNG texture with alpha cutout pixels
 */
function buildSyntheticGlbBuffer(): Buffer {
  // 4x4 RGBA image (half opaque green, half transparent)
  const rgba = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < 16; i++) {
    rgba[i * 4 + 0] = 60;
    rgba[i * 4 + 1] = 180;
    rgba[i * 4 + 2] = 75;
    rgba[i * 4 + 3] = i < 8 ? 255 : 0;
  }
  const pngBytes = Buffer.from(encodeRgbaToPng(rgba, 4, 4));

  // Mesh 0 (solid ground quad in glTF Y-up: X in [-20,20], Y=0, Z in [-20,20])
  const groundPos = new Float32Array([
    -20, 0, -20,
     20, 0, -20,
     20, 0,  20,
    -20, 0,  20,
  ]);
  const groundNorm = new Float32Array([
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
  ]);
  const groundUv = new Float32Array([
    0, 0,
    1, 0,
    1, 1,
    0, 1,
  ]);
  const groundIdx = new Uint16Array([0, 1, 2, 0, 2, 3]);

  // Mesh 1 (foliage card in glTF Y-up)
  const grassPos = new Float32Array([
    -2, 0, 0,
     2, 0, 0,
     0, 3, 0,
  ]);
  const grassNorm = new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);
  const grassUv = new Float32Array([
    0, 0,
    1, 0,
    0.5, 1,
  ]);
  const grassIdx = new Uint16Array([0, 1, 2]);

  const chunks: Buffer[] = [];
  let offset = 0;
  const addView = (buf: Buffer): { byteOffset: number; byteLength: number } => {
    const pad = (4 - (buf.length % 4)) % 4;
    const byteOffset = offset;
    const byteLength = buf.length;
    chunks.push(buf);
    if (pad > 0) chunks.push(Buffer.alloc(pad, 0));
    offset += byteLength + pad;
    return { byteOffset, byteLength };
  };

  const vGroundPos = addView(Buffer.from(groundPos.buffer));
  const vGroundNorm = addView(Buffer.from(groundNorm.buffer));
  const vGroundUv = addView(Buffer.from(groundUv.buffer));
  const vGroundIdx = addView(Buffer.from(groundIdx.buffer));

  const vGrassPos = addView(Buffer.from(grassPos.buffer));
  const vGrassNorm = addView(Buffer.from(grassNorm.buffer));
  const vGrassUv = addView(Buffer.from(grassUv.buffer));
  const vGrassIdx = addView(Buffer.from(grassIdx.buffer));

  const vPng = addView(pngBytes);

  const binBuffer = Buffer.concat(chunks);

  const gltfJson = {
    asset: { version: '2.0', generator: 'opence-test' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: 'ground_stone', mesh: 0 },
      { name: 'grass-wind-group', mesh: 1, translation: [0, 1, 0] },
    ],
    Buffer: [{ byteLength: binBuffer.length }],
    bufferViews: [
      { buffer: 0, ...vGroundPos, target: 34962 },
      { buffer: 0, ...vGroundNorm, target: 34962 },
      { buffer: 0, ...vGroundUv, target: 34962 },
      { buffer: 0, ...vGroundIdx, target: 34963 },
      { buffer: 0, ...vGrassPos, target: 34962 },
      { buffer: 0, ...vGrassNorm, target: 34962 },
      { buffer: 0, ...vGrassUv, target: 34962 },
      { buffer: 0, ...vGrassIdx, target: 34963 },
      { buffer: 0, ...vPng },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 4, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 6, type: 'SCALAR' },
      { bufferView: 4, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 5, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 6, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 7, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    images: [{ name: 'village_atlas', mimeType: 'image/png', bufferView: 8 }],
    textures: [{ source: 0 }],
    materials: [
      {
        name: 'stone_mat',
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          baseColorFactor: [1, 1, 1, 1],
        },
        alphaMode: 'OPAQUE',
      },
      {
        name: 'foliage_leaf_mat',
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          baseColorFactor: [1, 1, 1, 1],
        },
        alphaMode: 'MASK',
        alphaCutoff: 0.5,
        doubleSided: true,
      },
    ],
    meshes: [
      {
        name: 'ground_mesh',
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
            indices: 3,
            material: 0,
          },
        ],
      },
      {
        name: 'grass_shrub_mesh',
        primitives: [
          {
            attributes: { POSITION: 4, NORMAL: 5, TEXCOORD_0: 6 },
            indices: 7,
            material: 1,
          },
        ],
      },
    ],
  };

  const jsonRaw = Buffer.from(JSON.stringify(gltfJson), 'utf8');
  const jsonPad = (4 - (jsonRaw.length % 4)) % 4;
  const jsonChunkData =
    jsonPad > 0 ? Buffer.concat([jsonRaw, Buffer.alloc(jsonPad, 0x20)]) : jsonRaw;

  const totalLength = 12 + 8 + jsonChunkData.length + 8 + binBuffer.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonChunkData.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binBuffer.length, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

  return Buffer.concat([header, jsonChunkHeader, jsonChunkData, binChunkHeader, binBuffer]);
}

describe('Part 2: Direct 3D Model File (.glb / .obj / .jms) + Original Textures BSP Replacement & Merge', () => {
  const bgPath = path.resolve(__dirname, '../../sample_maps/bloodgulch.map');
  const hasBg = fs.existsSync(bgPath);
  const jakPath = 'C:\\Users\\LeviB\\Desktop\\jak.glb';
  const hasJak = fs.existsSync(jakPath);

  it('parses binary .glb scene graph, extracts embedded PNG textures, and separates foliage from solid collision', () => {
    const glbBuf = buildSyntheticGlbBuffer();
    const parsed = parseModelFileForBsp(glbBuf, {
      flipYz: true,
      scaleMode: 'manual',
      manualScale: 1.0,
      centerOrigin: true,
      extractTextures: true,
      foliagePassThrough: true,
      decodeTexturesNow: true,
    });

    expect(parsed.format).toBe('glb');
    expect(parsed.sceneNodeCount).toBe(2);
    expect(parsed.meshCount).toBe(2);
    expect(parsed.totalTriangleCount).toBe(3);
    expect(parsed.solidTriangleCount).toBe(2);
    expect(parsed.passThroughTriangleCount).toBe(1);
    expect(parsed.passThroughMeshCount).toBe(1);
    expect(parsed.extractedTextures.length).toBe(1);
    expect(parsed.extractedTextures[0]!.width).toBe(16);
    expect(parsed.extractedTextures[0]!.height).toBe(16);
    expect(parsed.extractedTextures[0]!.hasAlphaCutout).toBe(true);
    expect(parsed.collisionMesh.triangles.length).toBe(2);
  });

  it('replaces and merges a .glb model + original textures into bloodgulch.map with valid ScenarioStructureBSP and CollisionBSP', () => {
    if (!hasBg) return;
    const bgBuf = fs.readFileSync(bgPath);
    const glbBuf = buildSyntheticGlbBuffer();

    const preflight = preflightModelBspSwap(glbBuf, bgBuf, 0, {
      scaleMode: 'manual',
      manualScale: 1.0,
      foliagePassThrough: true,
    });
    expect(preflight.ok).toBe(true);
    expect(preflight.totalTriangleCount).toBe(3);
    expect(preflight.solidCollisionTriangleCount).toBe(2);
    expect(preflight.foliageTriangleCount).toBe(1);
    expect(preflight.textureCount).toBe(1);

    // 1. Test Replace Mode
    const replaceRes = swapMapBspFromModelFile(glbBuf, bgBuf, {
      targetBspIndex: 0,
      injectionMode: 'replace',
      scaleMode: 'manual',
      manualScale: 1.0,
      extractTextures: true,
      autoAlphaAndTwoSided: true,
      fullBrightnessLightmap: true,
      foliagePassThrough: true,
      relocateGroundObjects: true,
      clearExistingPlacements: true,
    });
    expect(replaceRes.ok).toBe(true);
    expect(replaceRes.summary.totalTriangles).toBe(3);
    expect(replaceRes.summary.solidCollisionTriangles).toBe(2);
    expect(replaceRes.summary.foliageTriangles).toBe(1);
    expect(replaceRes.summary.injectedBitmaps).toBeGreaterThanOrEqual(1);
    expect(replaceRes.summary.injectedShaders).toBeGreaterThanOrEqual(2);
    expect(replaceRes.summary.collisionSurfaces).toBeGreaterThanOrEqual(1);

    const inspectedReplace = inspectCustomEditionMap(replaceRes.buffer);
    expect(inspectedReplace.status).toBe('ok');
    if (inspectedReplace.status === 'ok') {
      const renderMesh = extractBspRenderMesh(
        replaceRes.buffer,
        inspectedReplace.header,
        inspectedReplace.tagIndex,
        0,
      );
      // 2 ground triangles + 2 foliage triangles (front + back emitted for two-sided D3DCULL_CCW) = 4
      expect(renderMesh.totalTriangles).toBe(4);
      expect(renderMesh.submeshes.length).toBe(2);

      for (const sm of renderMesh.submeshes) {
        const bitmId = resolveShaderBaseBitmapTagId(
          replaceRes.buffer,
          inspectedReplace.header,
          inspectedReplace.tagIndex,
          sm.shaderTagId,
        );
        expect(bitmId).not.toBeNull();
        const meta = resolveShaderRenderMetadata(
          replaceRes.buffer,
          inspectedReplace.header,
          inspectedReplace.tagIndex,
          sm.shaderTagId,
        );
        expect(meta.shaderClass).toBe('shader_environment');

        const shEntry = inspectedReplace.tagIndex.entries[sm.shaderTagId & 0xffff];
        expect(shEntry).toBeDefined();
        if (shEntry) {
          const shOff = resolveTagDataPointer(
            shEntry.tagDataPointerOrResourceIndex,
            inspectedReplace.header,
            inspectedReplace.tagIndex.baseMemoryAddress,
          );
          const shErrors: string[] = [];
          validateStructInstance(
            replaceRes.buffer,
            inspectedReplace.tagIndex,
            'ShaderEnvironment',
            shOff,
            inspectedReplace.header.tagDataOffset,
            inspectedReplace.tagIndex.baseMemoryAddress,
            shEntry.path,
            shErrors,
            { structsVisited: 0, dependenciesChecked: 0, reflexivesChecked: 0 },
          );
          expect(shErrors).toEqual([]);
        }
      }

      // Also validate the entire ScenarioStructureBSP struct tree
      const scnrEntry =
        inspectedReplace.tagIndex.entries[inspectedReplace.tagIndex.scenarioTagId & 0xffff]!;
      const scnrOff = resolveTagDataPointer(
        scnrEntry.tagDataPointerOrResourceIndex,
        inspectedReplace.header,
        inspectedReplace.tagIndex.baseMemoryAddress,
      );
      const bspLoc = locateStructureBsp(
        replaceRes.buffer,
        inspectedReplace.tagIndex,
        scnrOff,
        inspectedReplace.header.tagDataOffset,
        inspectedReplace.tagIndex.baseMemoryAddress,
        0xffffffff,
        0,
      );
      expect(bspLoc).not.toBeNull();
      if (bspLoc) {
        const bspErrors: string[] = [];
        validateStructInstance(
          replaceRes.buffer,
          inspectedReplace.tagIndex,
          'ScenarioStructureBSP',
          bspLoc.fileOffset,
          bspLoc.fileOffsetAnchor,
          bspLoc.baseMemoryAddress,
          'bloodgulch.sbsp',
          bspErrors,
          { structsVisited: 0, dependenciesChecked: 0, reflexivesChecked: 0 },
        );
        expect(bspErrors).toEqual([]);
      }
    }

    // 2. Test Merge Mode
    const mergeRes = swapMapBspFromModelFile(glbBuf, bgBuf, {
      targetBspIndex: 0,
      injectionMode: 'merge',
      worldOffset: [10, 10, 5],
      scaleMode: 'manual',
      manualScale: 1.0,
      extractTextures: true,
      foliagePassThrough: true,
      relocateGroundObjects: false,
      clearExistingPlacements: false,
    });
    expect(mergeRes.ok).toBe(true);
    const inspectedMerge = inspectCustomEditionMap(mergeRes.buffer);
    expect(inspectedMerge.status).toBe('ok');
    if (inspectedMerge.status === 'ok') {
      const mergedRenderMesh = extractBspRenderMesh(
        mergeRes.buffer,
        inspectedMerge.header,
        inspectedMerge.tagIndex,
        0,
      );
      expect(mergedRenderMesh.totalTriangles).toBe(5503 + 4);
    }
  });

  it('preflights jak.glb (485 scene nodes, 477 meshes, 166 embedded PNGs, 366,530 triangles) when present on Desktop', () => {
    if (!hasBg || !hasJak) return;
    const bgBuf = fs.readFileSync(bgPath);
    const preflight = preflightModelBspSwap(jakPath, bgBuf, 0, {
      scaleMode: 'auto_fit',
      targetSpan: 350,
      foliagePassThrough: true,
    });
    expect(preflight.ok).toBe(true);
    expect(preflight.format).toBe('glb');
    expect(preflight.nodeCount).toBe(485);
    expect(preflight.meshCount).toBe(477);
    expect(preflight.textureCount).toBe(166);
    expect(preflight.totalTriangleCount).toBeGreaterThan(360000);
    expect(preflight.solidCollisionTriangleCount).toBeGreaterThan(300000);
    expect(preflight.foliageTriangleCount).toBeGreaterThan(40000);
    expect(preflight.submeshChunkCount).toBeGreaterThan(150);

    // Also verify full BSP replacement of jak.glb into bloodgulch.map enforces the 128,000 surface cap (< 131,072)
    // and passes full ScenarioStructureBSP validation
    const jakSwap = swapMapBspFromModelFile(jakPath, bgBuf, {
      targetBspIndex: 0,
      injectionMode: 'replace',
      scaleMode: 'auto_fit',
      targetSpan: 350,
      extractTextures: true,
      autoAlphaAndTwoSided: true,
      fullBrightnessLightmap: true,
      foliagePassThrough: true,
      simplifyCollision: true,
      targetCollisionFaces: 1500,
      relocateGroundObjects: true,
      clearExistingPlacements: true,
    });
    expect(jakSwap.ok).toBe(true);
    expect(jakSwap.summary.injectedBitmaps).toBeGreaterThanOrEqual(150);
    expect(jakSwap.summary.injectedShaders).toBeGreaterThanOrEqual(150);

    const inspectedJak = inspectCustomEditionMap(jakSwap.buffer);
    expect(inspectedJak.status).toBe('ok');
    if (inspectedJak.status === 'ok') {
      const jakRenderMesh = extractBspRenderMesh(
        jakSwap.buffer,
        inspectedJak.header,
        inspectedJak.tagIndex,
        0,
      );
      expect(jakRenderMesh.totalTriangles).toBeLessThanOrEqual(128000);
      expect(jakRenderMesh.totalTriangles).toBeGreaterThan(100000);
    }
  }, 30000);
});
