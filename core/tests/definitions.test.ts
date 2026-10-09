import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { validateAllDefinitions, getAllTagGroupNames, getGroupDefinition } from '../src/map/definitions/engine';
import { validateStructInstance, locateStructureBsp } from '../src/map/definitions/validate-tag';
import { resolveTagDataPointer } from '../src/map/tag-index';
import { parseResourceMap, resourceIndexResolves } from '../src/map/resource-map';
import { sampleMapPath, hasSampleMaps, missingSampleMapsMessage, skippableTest } from './helpers/sample-maps';

const REQUIRED_SAMPLES = ['bloodgulch.map', 'ui.map'];
const haveSamples = hasSampleMaps(REQUIRED_SAMPLES);
const suiteTitle = haveSamples ? 'tag definitions validated against real maps' : `tag definitions validated against real maps [${missingSampleMapsMessage(REQUIRED_SAMPLES)}]`;

/** Tier 1 per the user's brief: fully defined + zero-failure validated this round. */
const TIER1_GROUPS = [
  'scenario',
  'scenario_structure_bsp',
  'bitmap',
  'gbxmodel',
  'sound',
  'weapon',
  'projectile',
  'vehicle',
  'biped',
  'scenery',
  'shader',
  'shader_environment',
  'shader_model',
  'shader_transparent_chicago',
  'shader_transparent_chicago_extended',
  'shader_transparent_generic',
  'shader_transparent_glass',
  'shader_transparent_meter',
  'shader_transparent_plasma',
  'shader_transparent_water',
];

describe('tag definitions registry', () => {
  it('loads and resolves every struct/enum/bitfield without throwing', () => {
    const summary = validateAllDefinitions();
    expect(summary.structCount).toBeGreaterThan(300);
    expect(summary.tagGroupCount).toBe(83);
  });

  it('registers all 83 known Halo CE tag groups (81 from Invader + spheroid + ui_widget_collection)', () => {
    const names = new Set(getAllTagGroupNames());
    for (const g of ['weapon', 'scenario', 'scenario_structure_bsp', 'bitmap', 'gbxmodel', 'spheroid', 'ui_widget_collection']) {
      expect(names.has(g)).toBe(true);
    }
    expect(names.size).toBe(83);
  });
});

describe.skipIf(!haveSamples)(suiteTitle, () => {
  for (const mapName of REQUIRED_SAMPLES) {
    it(
      `${mapName}: every defined tag parses (round-trip + dependency + reflexive bounds); zero failures on Tier-1 groups`,
      () => {
        const buffer = fs.readFileSync(sampleMapPath(mapName));
        const inspected = inspectCustomEditionMap(buffer);
        expect(inspected.status).toBe('ok');
        if (inspected.status !== 'ok') return;
        const { header, tagIndex } = inspected;
        const knownGroups = new Set(getAllTagGroupNames());

        const scenarioEntry = tagIndex.entries.find((e) => e.primaryClassName === 'scenario' && !e.isExternal);
        const scenarioFileOffset = scenarioEntry
          ? header.tagDataOffset + (scenarioEntry.tagDataPointerOrResourceIndex - tagIndex.baseMemoryAddress)
          : null;

        const perGroup = new Map<string, { ok: number; failed: number; skippedExternal: number; noDefinition: number }>();
        const failureMessages: string[] = [];

        for (const entry of tagIndex.entries) {
          const group = entry.primaryClassName ?? '(unknown)';
          if (!perGroup.has(group)) perGroup.set(group, { ok: 0, failed: 0, skippedExternal: 0, noDefinition: 0 });
          const bucket = perGroup.get(group)!;

          if (!knownGroups.has(group)) {
            bucket.noDefinition++;
            continue;
          }
          if (entry.isExternal) {
            bucket.skippedExternal++;
            continue;
          }

          const errors: string[] = [];
          const stats = { structsVisited: 0, dependenciesChecked: 0, reflexivesChecked: 0, elementsBoundsChecked: 0 };
          const structName = getGroupDefinition(group).name;

          if (group === 'scenario_structure_bsp') {
            if (scenarioFileOffset === null) {
              bucket.failed++;
              failureMessages.push(`tag #${entry.index} (${entry.path}): no internal scenario tag found to resolve BSP address.`);
              continue;
            }
            const located = locateStructureBsp(buffer, tagIndex, scenarioFileOffset, header.tagDataOffset, tagIndex.baseMemoryAddress, entry.tagId);
            if (!located) {
              bucket.failed++;
              failureMessages.push(`tag #${entry.index} (${entry.path}): not found in scenario's "structure bsps" list.`);
              continue;
            }
            validateStructInstance(
              buffer,
              tagIndex,
              structName,
              located.fileOffset,
              located.fileOffsetAnchor,
              located.baseMemoryAddress,
              `sbsp#${entry.index}`,
              errors,
              stats,
            );
          } else {
            const fileOffset = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
            validateStructInstance(buffer, tagIndex, structName, fileOffset, header.tagDataOffset, tagIndex.baseMemoryAddress, `tag#${entry.index}`, errors, stats);
          }

          if (errors.length > 0) {
            bucket.failed++;
            failureMessages.push(`tag #${entry.index} (${entry.path}, ${group}): ${errors.slice(0, 3).join(' | ')}`);
          } else {
            bucket.ok++;
          }
        }

        // eslint-disable-next-line no-console
        console.log(`\n=== ${mapName} tag definition validation summary ===`);
        for (const [group, counts] of [...perGroup.entries()].sort()) {
          // eslint-disable-next-line no-console
          console.log(
            `  ${group.padEnd(36)} ok=${counts.ok} failed=${counts.failed} externalSkipped=${counts.skippedExternal} noDefinition=${counts.noDefinition}`,
          );
        }
        if (failureMessages.length > 0) {
          // eslint-disable-next-line no-console
          console.log(`\nFirst failures (${mapName}):\n` + failureMessages.slice(0, 25).join('\n'));
        }

        for (const group of TIER1_GROUPS) {
          const counts = perGroup.get(group);
          if (!counts) continue;
          expect(counts.failed, `Tier-1 group "${group}" in ${mapName} has ${counts.failed} failing tag(s), see console output above`).toBe(0);
        }
      },
      120_000,
    );
  }

  const bitmapsGate = skippableTest(['bitmaps.map']);
  it.skipIf(bitmapsGate.skip)(`bloodgulch.map: external bitmap tag references resolve to valid entries in bitmaps.map${bitmapsGate.titleSuffix}`, () => {
    const mapBuffer = fs.readFileSync(sampleMapPath('bloodgulch.map'));
    const bitmapsBuffer = fs.readFileSync(sampleMapPath('bitmaps.map'));
    const resourceMap = parseResourceMap(bitmapsBuffer);

    const inspected = inspectCustomEditionMap(mapBuffer);
    expect(inspected.status).toBe('ok');
    if (inspected.status !== 'ok') return;

    const externalBitmaps = inspected.tagIndex.entries.filter((e) => e.isExternal && e.primaryClassName === 'bitmap');
    expect(externalBitmaps.length).toBeGreaterThan(0);

    const unresolved = externalBitmaps.filter((e) => !resourceIndexResolves(bitmapsBuffer, resourceMap, e.tagDataPointerOrResourceIndex));
    expect(unresolved.map((e) => e.path)).toEqual([]);
  });
});
