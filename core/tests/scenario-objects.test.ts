import { describe, expect, it } from 'vitest';
import { hasSampleMaps, readSampleMap } from './helpers/sample-maps';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { extractScenarioPlacements } from '../src/render/scenario-objects';

describe.skipIf(!hasSampleMaps(['bloodgulch.map']))('Scenario Object Placements Extractor (Step 8.5) – bloodgulch', () => {
  const buffer = readSampleMap('bloodgulch.map');
  const inspected = inspectCustomEditionMap(buffer);
  const { header, tagIndex } = inspected;

  it('extracts vehicles, scenery, equipment, and spawns from bloodgulch.map', () => {
    const summary = extractScenarioPlacements(buffer, header, tagIndex);

    expect(summary.scenarioPath).toBe('levels\\test\\bloodgulch\\bloodgulch');
    expect(summary.totalObjects).toBeGreaterThan(100);

    // Blood Gulch specific counts
    expect(summary.counts.vehicles).toBe(28);
    expect(summary.counts.scenery).toBe(47);
    expect(summary.counts.spawns).toBe(72);
    expect(summary.counts.equipment).toBe(37);

    // Verify vehicles
    const vehicles = summary.objects.filter((o) => o.kind === 'vehicle');
    expect(vehicles.length).toBe(28);
    for (const v of vehicles) {
      expect(v.modelTagId).not.toBe(0xffffffff);
      expect(v.objectPath).toMatch(/^vehicles\\/);
      expect(v.position.length).toBe(3);
      expect(v.position.every(Number.isFinite)).toBe(true);
      expect(v.rotation.length).toBe(3);
      expect(v.rotation.every(Number.isFinite)).toBe(true);
    }

    // Verify scenery with models (boulders, trees, shrubs, flag bases)
    const sceneryWithModels = summary.objects.filter(
      (o) => o.kind === 'scenery' && o.modelTagId !== 0xffffffff,
    );
    expect(sceneryWithModels.length).toBe(47);
    for (const s of sceneryWithModels) {
      expect(s.objectPath).toContain('scenery');
      expect(s.position.every(Number.isFinite)).toBe(true);
    }

    // Verify spawns
    const spawns = summary.objects.filter((o) => o.kind === 'spawn');
    expect(spawns.length).toBe(72);
    const redSpawns = spawns.filter((s) => s.teamIndex === 0);
    const blueSpawns = spawns.filter((s) => s.teamIndex === 1);
    expect(redSpawns.length).toBeGreaterThan(0);
    expect(blueSpawns.length).toBeGreaterThan(0);
    for (const s of spawns) {
      expect(s.position.every(Number.isFinite)).toBe(true);
    }
  });
});

describe.skipIf(!hasSampleMaps(['coldsnap.map']))('Scenario Object Placements Extractor (Step 8.5) – coldsnap', () => {
  it('extracts scenario placements from coldsnap.map', () => {
    const buffer = readSampleMap('coldsnap.map');
    const inspected = inspectCustomEditionMap(buffer);
    const summary = extractScenarioPlacements(
      buffer,
      inspected.header,
      inspected.tagIndex,
    );

    expect(summary.scenarioPath).toContain('coldsnap');
    expect(summary.totalObjects).toBeGreaterThan(0);
    expect(summary.counts.vehicles).toBeGreaterThan(0);
    expect(summary.counts.scenery).toBeGreaterThan(0);
  });
});
