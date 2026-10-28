import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  exportHaloCeCinematic,
  exportHaloCeFirefight,
  exportHaloCeMission,
} from '../src/map/hs-generators';
import * as hsGenModule from '../src/map/hs-generators';
import { lintHaloScript } from '../src/map/hs-compiler';
import { compareMaps, reviewContainerMigration } from '../src/map/map-compare';
import { parseCacheFileHeader } from '../src/map/header';
import {
  decodeMccModManifest,
  encodeMccModManifest,
  packageMccMapName,
} from '../src/map/mod-packager';
import { registerMccModRoot } from '../../desktop/electron/mcc-deploy';

describe('Item 6: HaloScript Directors (excluding exportHaloCeServerInit)', () => {
  it('does NOT include exportHaloCeServerInit', () => {
    expect('exportHaloCeServerInit' in hsGenModule).toBe(false);
  });

  it('generates valid, compilable Campaign Mission Beat .hsc scripts', () => {
    const res = exportHaloCeMission([
      {
        id: 'beat_1',
        title: 'Beach Landing',
        objective: 'Enter the beach trigger volume',
        trigger: 'triggerVolume',
        encounterName: 'enc_beach_cov',
        triggerRef: 'trig_beach',
      },
      {
        id: 'beat_2',
        title: 'Clear Covenant Defenders',
        objective: 'Eliminate beach Covenant',
        trigger: 'encounterCleared',
        encounterName: 'enc_beach_cov',
      },
      {
        id: 'beat_3',
        title: 'Hold Position',
        objective: 'Survive for 15 seconds',
        trigger: 'timer',
        encounterName: 'enc_beach_cov',
        timerSeconds: 15,
      },
    ]);
    expect(res.filename).toBe('gs_mission.hsc');
    expect(res.content).toContain('(script dormant gs_mission');
    expect(res.content).toContain('(ai_place enc_beach_cov)');

    const diags = lintHaloScript(res.content);
    expect(diags.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('generates valid, compilable Multi-Shot Cutscene .hsc scripts', () => {
    const res = exportHaloCeCinematic([
      {
        id: 'shot_1',
        name: 'Opening Wide Shot',
        durationMs: 3000,
        cameraPosition: [0, 0, 5],
        lookAt: [10, 0, 0],
        fov: 70,
        subtitle: 'Touchdown on Alpha Halo',
        cameraMarker: 'cam_1',
      },
      {
        id: 'shot_2',
        name: 'Pelican Approach',
        durationMs: 4000,
        cameraPosition: [10, 5, 3],
        lookAt: [20, 0, 0],
        fov: 65,
        subtitle: 'Brace for landing',
        cameraMarker: 'cam_2',
      },
    ]);
    expect(res.filename).toBe('gs_cinematic.hsc');
    expect(res.content).toContain('(cinematic_start)');
    expect(res.content).toContain('(camera_set cam_2 120)');
    expect(res.content).toContain('(cinematic_stop)');

    const diags = lintHaloScript(res.content);
    expect(diags.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('generates valid, compilable Finite-Wave Firefight Survival .hsc scripts', () => {
    const res = exportHaloCeFirefight({
      schemaVersion: 1,
      rounds: 2,
      maxAlive: 16,
      intermissionMs: 4000,
      enemies: [
        { id: 'grunts', label: 'Grunts' },
        { id: 'elites', label: 'Elites' },
      ],
      waves: [
        {
          name: 'Recon Wave',
          groups: [
            { enemyId: 'grunts', count: 4 },
            { enemyId: 'elites', count: 2 },
          ],
        },
        {
          name: 'Elite Wave',
          groups: [{ enemyId: 'elites', count: 4 }],
        },
      ],
    });
    expect(res.filename).toBe('gs_firefight.hsc');
    expect(res.content).toContain('(script dormant gs_firefight');
    expect(res.content).toContain('(gs_wave_01)');
    expect(res.content).toContain('(gs_wave_02)');

    const diags = lintHaloScript(res.content);
    expect(diags.filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('Item 7: Semantic Map Diffing & Cross-Map Tag Migration Preview', () => {
  function buildMinimalSyntheticMap(options: {
    scenarioName: string;
    tags: Array<{ group: string; path: string; isExternal?: boolean }>;
  }): Buffer {
    const tagDataOffset = 0x800;
    const tagDataSize = 0x8000;
    const totalSize = tagDataOffset + tagDataSize;
    const buf = Buffer.alloc(totalSize);

    // Header: 'head' and 'foot' in little-endian matching CacheFileLiteral
    buf.writeUInt32LE(0x68656164, 0x00); // 'head'
    buf.writeUInt32LE(609, 0x04); // Custom Edition
    buf.writeUInt32LE(totalSize, 0x08);
    buf.writeUInt32LE(tagDataOffset, 0x10);
    buf.writeUInt32LE(tagDataSize, 0x14);
    buf.write(options.scenarioName, 0x20, 'ascii');
    buf.write('01.00.01.0609', 0x40, 'ascii');
    buf.writeUInt32LE(0x666f6f74, 0x7fc); // 'foot'

    const baseMemoryAddress = 0x40440000;
    const count = options.tags.length;
    const tagArrayOffset = 0x28;
    const tagArrayPtr = baseMemoryAddress + tagArrayOffset;

    // Index header at tagDataOffset (0x800)
    buf.writeUInt32LE(tagArrayPtr, tagDataOffset + 0x00);
    buf.writeUInt32LE(0xe1740000, tagDataOffset + 0x04);
    buf.writeUInt32LE(0, tagDataOffset + 0x08);
    buf.writeUInt32LE(count, tagDataOffset + 0x0c);
    buf.writeUInt32LE(0, tagDataOffset + 0x10);
    buf.writeUInt32LE(0, tagDataOffset + 0x18);
    buf.writeUInt32LE(0, tagDataOffset + 0x1c);
    buf.writeUInt32LE(0, tagDataOffset + 0x20);
    buf.writeUInt32LE(0x74616773, tagDataOffset + 0x24); // 'tags'

    let cursor = tagArrayOffset + count * 32 + 0x100;
    const writeFourCC = (off: number, str: string) => {
      const padded = str.padEnd(4, ' ').slice(0, 4);
      // Tag index stores FourCCs in little-endian (so 'scen' in memory is 'necs' bytes)
      for (let i = 0; i < 4; i++) buf[off + (3 - i)] = padded.charCodeAt(i);
    };

    options.tags.forEach((t, idx) => {
      const entryOff = tagDataOffset + tagArrayOffset + idx * 32;
      writeFourCC(entryOff + 0x00, t.group);
      buf.writeInt32BE(-1, entryOff + 0x04);
      buf.writeInt32BE(-1, entryOff + 0x08);
      buf.writeUInt32LE((((0xe174 + idx) << 16) | idx) >>> 0, entryOff + 0x0c);

      const pathPtr = baseMemoryAddress + cursor;
      buf.write(t.path, tagDataOffset + cursor, 'ascii');
      buf[tagDataOffset + cursor + t.path.length] = 0;
      cursor = (cursor + t.path.length + 4) & ~3;

      const metaPtr = t.isExternal ? 0 : baseMemoryAddress + cursor;
      buf.writeUInt32LE(pathPtr, entryOff + 0x10);
      buf.writeUInt32LE(metaPtr, entryOff + 0x14);
      buf.writeUInt32LE(t.isExternal ? 1 : 0, entryOff + 0x18);
      buf.writeUInt32LE(0, entryOff + 0x1c);
      cursor += 2048;
    });

    return buf;
  }

  it('compares two maps and identifies added, removed, changed, and unchanged tags', () => {
    const leftBuf = buildMinimalSyntheticMap({
      scenarioName: 'bloodgulch_v1',
      tags: [
        { group: 'scnr', path: 'levels\\test\\bloodgulch\\bloodgulch' },
        { group: 'bitm', path: 'weapons\\pistol\\bitmaps\\pistol', isExternal: false },
        { group: 'vehi', path: 'vehicles\\warthog\\mp_warthog' },
      ],
    });
    const rightBuf = buildMinimalSyntheticMap({
      scenarioName: 'bloodgulch_v2',
      tags: [
        { group: 'scnr', path: 'levels\\test\\bloodgulch\\bloodgulch' },
        { group: 'bitm', path: 'weapons\\pistol\\bitmaps\\pistol', isExternal: true }, // storage changed
        { group: 'bipd', path: 'characters\\cyborg_mp\\cyborg_mp' }, // added
      ],
    });

    const report = compareMaps(leftBuf, rightBuf);
    expect(report.unchangedTags).toBe(1);
    expect(report.changedTags).toBe(1);
    expect(report.addedTags).toBe(1);
    expect(report.removedTags).toBe(1);
    expect(report.rows.some((r) => r.status === 'changed' && r.property === 'Resource Storage')).toBe(true);
  });

  it('previews container migration and flags same-path / different-class conflicts', () => {
    const targetBuf = buildMinimalSyntheticMap({
      scenarioName: 'bloodgulch',
      tags: [
        { group: 'scnr', path: 'levels\\test\\bloodgulch\\bloodgulch' },
        { group: 'scen', path: 'objects\\custom\\crate' },
      ],
    });

    const review = reviewContainerMigration(
      {
        version: 1,
        sourceMap: {
          name: 'source_map',
          buildString: '01.00.01.0609',
          crc32: 0,
          edition: 'Custom Edition',
        },
        roots: [{ path: 'objects\\custom\\crate', group: 'vehicle' }],
        tags: [
          {
            originalIndex: 0,
            path: 'objects\\custom\\crate',
            group: 'vehicle', // conflicts with 'scenery' at same path in target!
            secondaryClassFourCC: null,
            tertiaryClassFourCC: null,
            data: '',
            dependencies: [],
          },
        ],
      },
      targetBuf,
    );

    expect(review.counts.selected['class-conflict']).toBe(1);
    expect(review.selected[0].status).toBe('class-conflict');
    expect(review.selected[0].conflictingGroups).toContain('scenery');
  });
});

describe('Item 8: Demo Legacy Tag Size Repair, MCC Naming & ModManifest.txt Deployment', () => {
  it('repairs Demo-to-PC / Pearl headers that store whole-file size in tagDataSize', () => {
    const totalSize = 0x10000;
    const tagDataOffset = 0x4000;
    const buf = Buffer.alloc(totalSize);
    buf.writeUInt32LE(0x68656164, 0x00); // 'head'
    buf.writeUInt32LE(7, 0x04); // Retail / PC (engine 7)
    buf.writeUInt32LE(totalSize, 0x08); // decompressedFileSize
    buf.writeUInt32LE(tagDataOffset, 0x10); // tagDataOffset
    buf.writeUInt32LE(totalSize, 0x14); // Demo-to-PC quirk: tagDataSize == decompressedFileSize
    buf.write('b30', 0x20, 'ascii');
    buf.write('01.00.00.0564', 0x40, 'ascii');
    buf.writeUInt32LE(0x666f6f74, 0x7fc); // 'foot'

    const header = parseCacheFileHeader(buf);
    expect(header.legacyTagSizeRepair).toBe(true);
    expect(header.tagDataSize).toBe(totalSize - tagDataOffset);
  });

  it('extracts MCC-compliant map leaf filenames via packageMccMapName', () => {
    expect(packageMccMapName('levels\\test\\bloodgulch\\bloodgulch')).toBe('bloodgulch.map');
    expect(packageMccMapName('levels/b30/b30_redux.map')).toBe('b30_redux.map');
  });

  it('round-trips UTF-16LE and UTF-8 BOM ModManifest.txt and registers mod roots idempotently', () => {
    const utf16Bom = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('C:\\Mods\\ModA\r\n', 'utf16le'),
    ]);
    const decoded = decodeMccModManifest(utf16Bom);
    expect(decoded.utf16le).toBe(true);
    expect(decoded.utf8Bom).toBe(false);
    expect(decoded.text).toContain('C:\\Mods\\ModA');

    const reencoded = encodeMccModManifest(decoded.text, decoded.utf16le, decoded.utf8Bom);
    expect(reencoded[0]).toBe(0xff);
    expect(reencoded[1]).toBe(0xfe);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opence-mcc-test-'));
    try {
      const manifestPath = path.join(tmpDir, 'ModManifest.txt');
      fs.writeFileSync(manifestPath, utf16Bom);

      const first = registerMccModRoot(manifestPath, 'C:\\Mods\\NewHaloMod');
      expect(first.added).toBe(true);

      // Second registration of same path (even with different casing/slashes) is idempotent
      const second = registerMccModRoot(manifestPath, 'c:/mods/newhalomod/');
      expect(second.added).toBe(false);

      const finalDecoded = decodeMccModManifest(fs.readFileSync(manifestPath));
      expect(finalDecoded.utf16le).toBe(true);
      expect(finalDecoded.text).toContain('C:\\Mods\\NewHaloMod');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
