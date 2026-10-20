import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  inspectCustomEditionMap,
  extractModelRenderGeometry,
  extractBspRenderMesh,
  exportModelToObj,
  exportBspToObj,
  exportModelToGlb,
  exportBspToGlb,
  type ModelRenderGeometry,
  type BspRenderMesh,
} from '../src/index';

const SAMPLE_MAPS_DIR = process.env.SAMPLE_MAPS_DIR
  ? path.resolve(process.env.SAMPLE_MAPS_DIR)
  : path.resolve(__dirname, '../../sample_maps');

const bgPath = path.join(SAMPLE_MAPS_DIR, 'bloodgulch.map');
const hasBg = fs.existsSync(bgPath);

describe('3D Model & BSP Exporter (Milestone 13.3)', () => {
  // Synthetic geometry fixture: a simple pyramid
  const sampleModelGeometry: ModelRenderGeometry = {
    modelTagId: 0x12345678,
    modelPath: 'vehicles\\test\\cube',
    lodLevel: 4,
    uScale: 1.0,
    vScale: 1.0,
    totalVertices: 4,
    totalTriangles: 4,
    submeshes: [
      {
        partIndex: 0,
        shaderIndex: 0,
        shaderTagId: 0x87654321,
        vertexCount: 4,
        vertices: new Float32Array([
          // x, y, z, nx, ny, nz, u, v
          0, 0, 1, 0, 0, 1, 0.5, 0.5,
          -1, -1, 0, 0, 0, 1, 0, 0,
          1, -1, 0, 0, 0, 1, 1, 0,
          0, 1, 0, 0, 0, 1, 0.5, 1,
        ]),
        indices: new Uint16Array([
          0, 1, 2,
          0, 2, 3,
          0, 3, 1,
          1, 3, 2,
        ]),
        boundingBox: [-1, -1, 0, 1, 1, 1],
      },
    ],
  };

  const sampleBspMesh: BspRenderMesh = {
    bspIndex: 0,
    bspTagId: 0x11112222,
    lightmapsBitmapTagId: 0x33334444,
    worldBounds: [-50, -50, 0, 50, 50, 10],
    totalVertices: 3,
    totalTriangles: 1,
    submeshes: [
      {
        submeshIndex: 0,
        lightmapIndex: 0,
        lightmapBitmapIndex: 0,
        shaderTagId: 0x55556666,
        shaderPermutation: 0,
        vertexCount: 3,
        vertices: new Float32Array([
          -10, 0, 0, 0, 0, 1, 0, 0,
          10, 0, 0, 0, 0, 1, 1, 0,
          0, 10, 0, 0, 0, 1, 0.5, 1,
        ]),
        lightmapUvs: new Float32Array([0, 0, 1, 0, 0.5, 1]),
        indices: new Uint16Array([0, 1, 2]),
        boundingBox: [-10, 0, 0, 10, 10, 0],
      },
    ],
  };

  it('exports synthetic model geometry to Wavefront OBJ + MTL', () => {
    const res = exportModelToObj(sampleModelGeometry);
    expect(res.objText).toContain('mtllib cube.mtl');
    expect(res.objText).toContain('v 0.000000 0.000000 1.000000');
    expect(res.objText).toContain('vn 0.000000 0.000000 1.000000');
    expect(res.objText).toContain('vt 0.500000 0.500000');
    expect(res.objText).toContain('f 1/1/1 2/2/2 3/3/3');
    expect(res.mtlText).toContain('newmtl mat_shader_87654321');
  });

  it('exports synthetic BSP mesh to Wavefront OBJ + MTL', () => {
    const res = exportBspToObj(sampleBspMesh);
    expect(res.objText).toContain('mtllib bsp_0.mtl');
    expect(res.objText).toContain('v -10.000000 0.000000 0.000000');
    expect(res.objText).toContain('f 1/1/1 2/2/2 3/3/3');
    expect(res.mtlText).toContain('newmtl mat_shader_55556666');
  });

  it('exports synthetic model geometry to glTF 2.0 Binary (.glb)', () => {
    const glbBytes = exportModelToGlb(sampleModelGeometry);
    expect(glbBytes.length).toBeGreaterThan(50);

    const buf = Buffer.from(glbBytes.buffer, glbBytes.byteOffset, glbBytes.byteLength);
    // Header
    expect(buf.readUInt32LE(0)).toBe(0x46546c67); // "glTF"
    expect(buf.readUInt32LE(4)).toBe(2); // version 2
    expect(buf.readUInt32LE(8)).toBe(glbBytes.length); // total length

    // Chunk 0: JSON
    const jsonLen = buf.readUInt32LE(12);
    expect(buf.readUInt32LE(16)).toBe(0x4e4f534a); // "JSON"
    const jsonStr = buf.toString('utf8', 20, 20 + jsonLen).trim();
    const parsed = JSON.parse(jsonStr);
    expect(parsed.asset.version).toBe('2.0');
    expect(parsed.meshes.length).toBe(1);
    expect(parsed.meshes[0].primitives.length).toBe(1);
    expect(parsed.accessors.length).toBe(4); // pos, norm, uv, index

    // Chunk 1: BIN
    const binOffset = 20 + jsonLen;
    expect(buf.readUInt32LE(binOffset + 4)).toBe(0x004e4942); // "BIN\0"
  });

  it('exports synthetic BSP mesh to glTF 2.0 Binary (.glb)', () => {
    const glbBytes = exportBspToGlb(sampleBspMesh);
    expect(glbBytes.length).toBeGreaterThan(50);

    const buf = Buffer.from(glbBytes.buffer, glbBytes.byteOffset, glbBytes.byteLength);
    expect(buf.readUInt32LE(0)).toBe(0x46546c67); // "glTF"
    expect(buf.readUInt32LE(4)).toBe(2); // version 2
  });

  describe.skipIf(!hasBg)('Real map geometry export (bloodgulch.map)', () => {
    it('exports assault rifle gbxmodel to OBJ and glTF .glb', () => {
      const buf = fs.readFileSync(bgPath);
      const inspected = inspectCustomEditionMap(buf);
      if (inspected.status !== 'ok') throw new Error('parse failed');

      const modelEntry = inspected.tagIndex.entries.find(
        (e) => e.primaryClassName === 'gbxmodel' && e.path.includes('assault rifle'),
      );
      expect(modelEntry).toBeDefined();

      const geom = extractModelRenderGeometry(buf, inspected.header, inspected.tagIndex, modelEntry!.tagId, 4);
      expect(geom.submeshes.length).toBeGreaterThan(0);
      expect(geom.totalVertices).toBeGreaterThan(0);

      // OBJ
      const objRes = exportModelToObj(geom);
      expect(objRes.objText.length).toBeGreaterThan(500);
      expect(objRes.mtlText.length).toBeGreaterThan(50);

      // GLB
      const glb = exportModelToGlb(geom);
      expect(glb.length).toBeGreaterThan(1000);
      const glbBuf = Buffer.from(glb.buffer, glb.byteOffset, glb.byteLength);
      expect(glbBuf.readUInt32LE(0)).toBe(0x46546c67);
    });

    it('exports Blood Gulch Structure BSP to OBJ and glTF .glb', () => {
      const buf = fs.readFileSync(bgPath);
      const inspected = inspectCustomEditionMap(buf);
      if (inspected.status !== 'ok') throw new Error('parse failed');

      const mesh = extractBspRenderMesh(buf, inspected.header, inspected.tagIndex, 0);
      expect(mesh.submeshes.length).toBeGreaterThan(0);
      expect(mesh.totalVertices).toBeGreaterThan(1000);

      // OBJ
      const objRes = exportBspToObj(mesh);
      expect(objRes.objText.length).toBeGreaterThan(10000);
      expect(objRes.mtlText.length).toBeGreaterThan(100);

      // GLB
      const glb = exportBspToGlb(mesh);
      expect(glb.length).toBeGreaterThan(10000);
      const glbBuf = Buffer.from(glb.buffer, glb.byteOffset, glb.byteLength);
      expect(glbBuf.readUInt32LE(0)).toBe(0x46546c67);
    });
  });
});
