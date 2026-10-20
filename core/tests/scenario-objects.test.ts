import { describe, expect, it } from 'vitest';
import { hasSampleMaps, readSampleMap } from './helpers/sample-maps';
import { inspectCustomEditionMap } from '../src/map/open-map';
import {
  extractScenarioPlacements,
  updateScenarioPlacement,
  duplicateScenarioPlacement,
  addScenarioPlacement,
  deleteScenarioPlacement,
} from '../src/render/scenario-objects';

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
    expect(summary.counts.weapons).toBe(17);
    expect(summary.counts.equipment).toBe(20);

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

    // Verify palettes are populated
    expect(summary.palettes.vehicles.length).toBeGreaterThan(0);
    expect(summary.palettes.vehicles[0].path).toMatch(/^vehicles\\/);
    expect(summary.palettes.scenery.length).toBeGreaterThan(0);
    expect(summary.palettes.weapons.length).toBeGreaterThan(0);
    expect(summary.palettes.equipment.length).toBeGreaterThan(0);

    // Verify weapons (multiplayer ground weapons) have 3D models resolved
    const weaponsWithModels = summary.objects.filter(
      (o) => o.kind === 'weapon' && o.modelTagId !== 0xffffffff,
    );
    expect(weaponsWithModels.length).toBe(17);
    for (const w of weaponsWithModels) {
      expect(w.modelTagId).not.toBe(0xffffffff);
    }

    // Verify equipment (multiplayer powerups/grenades) have 3D models resolved
    const equipmentWithModels = summary.objects.filter(
      (o) => o.kind === 'equipment' && o.modelTagId !== 0xffffffff,
    );
    expect(equipmentWithModels.length).toBeGreaterThan(10);
    for (const eq of equipmentWithModels) {
      expect(eq.modelTagId).not.toBe(0xffffffff);
    }
  });

  it('updates placement position and rotation in-place (Step 9)', () => {
    const testBuf = Buffer.from(buffer);
    const initial = extractScenarioPlacements(testBuf, header, tagIndex);
    const v0 = initial.objects.find((o) => o.id === 'vehicle-0')!;

    const updated = updateScenarioPlacement(testBuf, header, tagIndex, 'vehicle-0', {
      position: [123.45, -67.89, 42.0],
      rotation: [1.23, 0.45, -0.67],
    });

    const v0Updated = updated.objects.find((o) => o.id === 'vehicle-0')!;
    expect(v0Updated.position[0]).toBeCloseTo(123.45, 2);
    expect(v0Updated.position[1]).toBeCloseTo(-67.89, 2);
    expect(v0Updated.position[2]).toBeCloseTo(42.0, 2);
    expect(v0Updated.rotation[0]).toBeCloseTo(1.23, 2);
    expect(v0Updated.rotation[1]).toBeCloseTo(0.45, 2);
    expect(v0Updated.rotation[2]).toBeCloseTo(-0.67, 2);
  });

  it('duplicates an existing scenario placement and appends to reflexive array (Step 9)', () => {
    const testBuf = Buffer.from(buffer);
    const initial = extractScenarioPlacements(testBuf, header, tagIndex);
    const initVehicles = initial.counts.vehicles;

    const dupRes = duplicateScenarioPlacement(testBuf, header, tagIndex, 'vehicle-0', [2.0, 3.0, 0.0]);

    expect(dupRes.summary.counts.vehicles).toBe(initVehicles + 1);
    expect(dupRes.newPlacement.id).toBe(`vehicle-${initVehicles}`);
    expect(dupRes.newPlacement.kind).toBe('vehicle');
    expect(dupRes.newPlacement.objectPath).toBe(initial.objects[0].objectPath);
    expect(dupRes.newPlacement.position[0]).toBeCloseTo(initial.objects[0].position[0] + 2.0, 2);
    expect(dupRes.newPlacement.position[1]).toBeCloseTo(initial.objects[0].position[1] + 3.0, 2);

    // Verify map is still valid Custom Edition map
    const rechecked = inspectCustomEditionMap(dupRes.buffer);
    expect(rechecked.status).toBe('ok');
  });

  it('adds a new scenario placement from scratch and deletes it (Step 9)', () => {
    const testBuf = Buffer.from(buffer);
    const initial = extractScenarioPlacements(testBuf, header, tagIndex);
    const initSpawns = initial.counts.spawns;

    // Add spawn
    const addRes = addScenarioPlacement(
      testBuf,
      header,
      tagIndex,
      'spawn',
      0,
      [50.0, 60.0, 10.0],
      [1.57, 0, 0],
      1,
    );

    expect(addRes.summary.counts.spawns).toBe(initSpawns + 1);
    expect(addRes.newPlacement.position[0]).toBeCloseTo(50.0, 2);
    expect(addRes.newPlacement.position[1]).toBeCloseTo(60.0, 2);
    expect(addRes.newPlacement.teamIndex).toBe(1);

    // Recheck map integrity
    const rechecked = inspectCustomEditionMap(addRes.buffer);
    expect(rechecked.status).toBe('ok');
    if (rechecked.status !== 'ok') return;

    // Delete the added spawn
    const deletedSummary = deleteScenarioPlacement(
      addRes.buffer,
      rechecked.header,
      rechecked.tagIndex,
      addRes.newPlacement.id,
    );
    expect(deletedSummary.counts.spawns).toBe(initSpawns);
  });

  it('adds a vehicle not currently in palette, auto-registering in palette reflexive', () => {
    const testBuf = Buffer.from(buffer);
    const initial = extractScenarioPlacements(testBuf, header, tagIndex);
    const initialVehicleCount = initial.counts.vehicles;
    const initialPalCount = initial.palettes.vehicles.length;

    // Pick a palette item index (first vehicle)
    const addRes = addScenarioPlacement(
      testBuf,
      header,
      tagIndex,
      'vehicle',
      0,
      [10.0, 20.0, 5.0],
      [0, 0, 0],
    );

    expect(addRes.summary.counts.vehicles).toBe(initialVehicleCount + 1);
    expect(addRes.newPlacement.kind).toBe('vehicle');
    expect(addRes.newPlacement.position[0]).toBeCloseTo(10.0, 2);
    expect(addRes.newPlacement.modelTagId).not.toBe(0xffffffff);
  });

  it('extracts advanced scenario entities (netgame flags, decals, triggers) and allows moving them (Milestone 9)', () => {
    const summary = extractScenarioPlacements(buffer, header, tagIndex);
    expect((summary.counts.netgameFlags || 0) + (summary.counts.decals || 0) + (summary.counts.triggerVolumes || 0)).toBeGreaterThan(0);

    const netgameFlag = summary.objects.find((o) => o.kind === 'netgame_flag');
    if (netgameFlag) {
      expect(netgameFlag.flagType).toBeDefined();
      expect(netgameFlag.position.every(Number.isFinite)).toBe(true);

      const testBuf = Buffer.from(buffer);
      const updated = updateScenarioPlacement(testBuf, header, tagIndex, netgameFlag.id, {
        position: [12.34, 56.78, 90.12],
        rotation: [1.57, 0, 0],
      });
      const moved = updated.objects.find((o) => o.id === netgameFlag.id);
      expect(moved).toBeDefined();
      expect(moved!.position[0]).toBeCloseTo(12.34, 2);
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
