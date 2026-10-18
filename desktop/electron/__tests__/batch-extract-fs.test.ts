import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  sanitizeMapName,
  sanitizeTagRelativePath,
  countExistingOcetagsFiles,
  commitStagedFiles,
  discardStagedFiles,
  generateBatchReportText,
  writeManifestAndReport,
} from '../batch-extract-fs';
import type { BatchExtractManifest } from '../shared-types';

describe('batch-extract-fs', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opence-batch-fs-test-'));
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempRoot)) {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  describe('sanitizeMapName', () => {
    it('strips .map and .bak extensions', () => {
      expect(sanitizeMapName('bloodgulch.map')).toBe('bloodgulch');
      expect(sanitizeMapName('c:\\maps\\bloodgulch.map')).toBe('bloodgulch');
      expect(sanitizeMapName('bloodgulch.map.bak')).toBe('bloodgulch');
      expect(sanitizeMapName('theisland_3.bak')).toBe('theisland_3');
    });

    it('sanitizes forbidden characters and reserved names', () => {
      expect(sanitizeMapName('map<test>:name|bad')).toBe('map_test__name_bad');
      expect(sanitizeMapName('CON.map')).toBe('_CON_');
      expect(sanitizeMapName('nul.bak')).toBe('_nul_');
    });

    it('handles empty or whitespace-only inputs', () => {
      expect(sanitizeMapName('')).toBe('exported_map');
      expect(sanitizeMapName('   .map')).toBe('exported_map');
    });
  });

  describe('sanitizeTagRelativePath', () => {
    it('mirrors standard tag directory hierarchy with <leaf>.<group>.ocetags', () => {
      const res = sanitizeTagRelativePath('weapons\\assault rifle\\assault rifle', 'weapon');
      expect(res.relativeDir).toBe(path.join('weapons', 'assault rifle'));
      expect(res.fileName).toBe('assault rifle.weapon.ocetags');
      expect(res.fullRelativePath).toBe(path.join('weapons', 'assault rifle', 'assault rifle.weapon.ocetags'));
    });

    it('handles root-level tags without subfolders', () => {
      const res = sanitizeTagRelativePath('globals', 'globals');
      expect(res.relativeDir).toBe('');
      expect(res.fileName).toBe('globals.globals.ocetags');
      expect(res.fullRelativePath).toBe('globals.globals.ocetags');
    });

    it('sanitizes Windows reserved names and illegal characters in directories and filenames', () => {
      const res = sanitizeTagRelativePath('con\\aux\\test*bad', 'bit?map');
      expect(res.relativeDir).toBe(path.join('con_', 'aux_'));
      expect(res.fileName).toBe('test_bad.bit_map.ocetags');
    });

    it('disambiguates tags with identical paths but different groups in the same directory', () => {
      const res1 = sanitizeTagRelativePath('ui\\shell\\bitmaps\\halo_logo', 'bitmap');
      const res2 = sanitizeTagRelativePath('ui\\shell\\bitmaps\\halo_logo', 'ui_widget_definition');
      expect(res1.fullRelativePath).not.toBe(res2.fullRelativePath);
      expect(res1.fileName).toBe('halo_logo.bitmap.ocetags');
      expect(res2.fileName).toBe('halo_logo.ui_widget_definition.ocetags');
    });
  });

  describe('staging and committing files', () => {
    it('commits staged files into target directory, overwriting existing files if needed', () => {
      const targetDir = path.join(tempRoot, 'target');
      const stagingDir = path.join(targetDir, '.staging-123');
      fs.mkdirSync(path.join(stagingDir, 'weapons', 'ar'), { recursive: true });

      // Create an existing file in target
      fs.mkdirSync(path.join(targetDir, 'weapons', 'ar'), { recursive: true });
      fs.writeFileSync(path.join(targetDir, 'weapons', 'ar', 'ar.weapon.ocetags'), 'OLD_CONTENT');

      // Create staged file with new content
      fs.writeFileSync(path.join(stagingDir, 'weapons', 'ar', 'ar.weapon.ocetags'), 'NEW_CONTENT');
      // Create a second staged file
      fs.mkdirSync(path.join(stagingDir, 'vehicles'), { recursive: true });
      fs.writeFileSync(path.join(stagingDir, 'vehicles', 'warthog.vehicle.ocetags'), 'WARTHOG');

      const count = commitStagedFiles(stagingDir, targetDir);
      expect(count).toBe(2);
      expect(fs.existsSync(stagingDir)).toBe(false);

      expect(fs.readFileSync(path.join(targetDir, 'weapons', 'ar', 'ar.weapon.ocetags'), 'utf-8')).toBe('NEW_CONTENT');
      expect(fs.readFileSync(path.join(targetDir, 'vehicles', 'warthog.vehicle.ocetags'), 'utf-8')).toBe('WARTHOG');
    });

    it('discards staging directory without affecting target directory', () => {
      const targetDir = path.join(tempRoot, 'target');
      const stagingDir = path.join(targetDir, '.staging-456');
      fs.mkdirSync(path.join(targetDir, 'weapons'), { recursive: true });
      fs.writeFileSync(path.join(targetDir, 'weapons', 'keep_me.ocetags'), 'KEEP');

      fs.mkdirSync(path.join(stagingDir, 'weapons'), { recursive: true });
      fs.writeFileSync(path.join(stagingDir, 'weapons', 'delete_me.ocetags'), 'DELETE');

      discardStagedFiles(stagingDir);
      expect(fs.existsSync(stagingDir)).toBe(false);
      expect(fs.existsSync(path.join(targetDir, 'weapons', 'keep_me.ocetags'))).toBe(true);
    });

    it('counts existing .ocetags files excluding hidden/staging directories', () => {
      const targetDir = path.join(tempRoot, 'map');
      fs.mkdirSync(path.join(targetDir, 'dir1'), { recursive: true });
      fs.mkdirSync(path.join(targetDir, '.staging-test'), { recursive: true });

      fs.writeFileSync(path.join(targetDir, 'dir1', 'a.ocetags'), '1');
      fs.writeFileSync(path.join(targetDir, 'dir1', 'b.ocetags'), '2');
      fs.writeFileSync(path.join(targetDir, 'dir1', 'not_a_tag.txt'), '3');
      fs.writeFileSync(path.join(targetDir, '.staging-test', 'staged.ocetags'), '4');

      expect(countExistingOcetagsFiles(targetDir)).toBe(2);
    });
  });

  describe('manifest and report generation', () => {
    const mockManifest: BatchExtractManifest = {
      manifestVersion: 1,
      toolVersion: '0.1.0',
      containerVersion: 5,
      extractedAt: '2026-10-15T12:00:00.000Z',
      mapFileName: 'bloodgulch.map',
      scenarioName: 'levels\\test\\bloodgulch\\bloodgulch',
      summary: {
        totalTagsInMap: 10,
        extractedCount: 8,
        skippedExistingCount: 0,
        externalCount: 1,
        blockedCount: 1,
        failedCount: 0,
        totalBytesWritten: 1048576,
      },
      files: [
        {
          path: 'weapons\\ar\\ar',
          group: 'weapon',
          relativePath: 'weapons\\ar\\ar.weapon.ocetags',
          sizeBytes: 1048576,
          tagCount: 4,
        },
      ],
      blocked: [
        {
          path: 'levels\\test\\bloodgulch\\bloodgulch',
          group: 'scenario_structure_bsp',
          reason: 'scenario_structure_bsp tags are not extractable yet.',
        },
      ],
      external: [
        {
          path: 'characters\\cyborg\\bitmaps\\cyborg',
          group: 'bitmap',
          reason: 'External tag in resource map',
        },
      ],
    };

    it('generates plaintext report and writes manifest and report files to disk', () => {
      const reportText = generateBatchReportText(mockManifest);
      expect(reportText).toContain('bloodgulch.map');
      expect(reportText).toContain('Total tags in map:    10');
      expect(reportText).toContain('Extracted containers: 8 files (1.00 MB)');
      expect(reportText).toContain('BLOCKED TAGS (1):');
      expect(reportText).toContain('scenario_structure_bsp tags are not extractable yet.');

      const targetDir = path.join(tempRoot, 'out');
      const { manifestPath, reportPath } = writeManifestAndReport(targetDir, mockManifest, reportText);

      expect(fs.existsSync(manifestPath)).toBe(true);
      expect(fs.existsSync(reportPath)).toBe(true);

      const loadedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(loadedManifest.mapFileName).toBe('bloodgulch.map');
      expect(loadedManifest.files.length).toBe(1);
    });
  });
});
