import { describe, expect, it } from 'vitest';
import {
  lintHaloScript,
  parseHaloScriptSExpressions,
  HALOSCRIPT_SAMPLE_TEMPLATES,
  getTagGroupExplanation,
  getFieldExplanation,
  generateOpenCeModToml,
  exportTagToXml,
  convertJmsToObjText,
  buildHaloGametypeBlamLst,
  parseHaloGametypeBlamLst,
} from '../src/index';

describe('Milestones 14–19: HaloScript, Explanations, Mod Packager, JMS Compiler & Gametype', () => {
  it('validates all 7 built-in SP/MP HaloScript sample templates (Pelican Warthog drop, c_dropship, NPCs, Cutscenes, Triggers)', () => {
    expect(HALOSCRIPT_SAMPLE_TEMPLATES.length).toBeGreaterThanOrEqual(7);
    for (const tpl of HALOSCRIPT_SAMPLE_TEMPLATES) {
      const diags = lintHaloScript(tpl.hscSource);
      const errors = diags.filter((d) => d.severity === 'error');
      expect(errors, `Template ${tpl.id} had errors: ${JSON.stringify(errors)}`).toHaveLength(0);
      const parsed = parseHaloScriptSExpressions(tpl.hscSource);
      expect(parsed.expressions.length).toBeGreaterThan(0);
    }
  });

  it('flags OpenCE begin_random calls with >= 32 arguments in lintHaloScript', () => {
    const args33 = Array.from({ length: 33 }, (_, i) => `(print "arg_${i}")`).join('\n  ');
    const badHsc = `(script startup void test_rand\n  (begin_random\n  ${args33}\n  )\n)`;
    const diags = lintHaloScript(badHsc);
    expect(diags.some((d) => d.severity === 'error' && d.message.includes('begin_random'))).toBe(true);
  });

  it('provides human-readable explanations for tag groups and fields', () => {
    expect(getTagGroupExplanation('weap')).toContain('Weapon');
    expect(getTagGroupExplanation('vehi')).toContain('Vehicle');
    expect(getTagGroupExplanation('coll')).toContain('3D');
    expect(getFieldExplanation('bounding radius', 'scenery')).toContain('world units');
    expect(getFieldExplanation('magazines', 'weapon')).toContain('Ammunition');
  });

  it('generates OpenCE mod.toml and exports tag fields to XML', () => {
    const toml = generateOpenCeModToml({
      modId: 'pelican_drop_mod',
      name: 'Pelican Warthog Drop Mod',
      version: '1.2.0',
      author: 'Levi',
      description: 'Adds flying Pelicans and Spirit dropships.',
      entryScenario: 'levels\\test\\bloodgulch\\bloodgulch',
    });
    expect(toml).toContain('id = "pelican_drop_mod"');
    expect(toml).toContain('entry = "levels\\\\test\\\\bloodgulch\\\\bloodgulch"');

    const xml = exportTagToXml('weapons\\pistol\\pistol', 'weapon', [
      { name: 'bounding radius', type: 'float', kind: 'number', value: 0.35 },
    ]);
    expect(xml).toContain('<halo_tag group="weapon" path="weapons\\pistol\\pistol">');
    expect(xml).toContain('name="bounding radius"');
  });

  it('converts Halo CE .JMS 8200 ASCII source into Wavefront .OBJ geometry', () => {
    const sampleJms = [
      '8200',
      '3251',
      '1',
      'frame',
      '-1 -1',
      '0.0 0.0 0.0 1.0',
      '0.0 0.0 0.0',
      '1',
      'steel_hull',
      '<none>',
      '0',
      '1',
      'unnamed',
      '3',
      '0  0.0 0.0 0.0  0.0 0.0 1.0  -1 0.0  0.0 0.0 0.0',
      '0  100.0 0.0 0.0  0.0 0.0 1.0  -1 0.0  1.0 0.0 0.0',
      '0  0.0 100.0 0.0  0.0 0.0 1.0  -1 0.0  0.0 1.0 0.0',
      '1',
      '0 0  0 1 2',
    ].join('\n');

    const res = convertJmsToObjText(sampleJms);
    expect(res.vertexCount).toBe(3);
    expect(res.triangleCount).toBe(1);
    expect(res.objText).toContain('usemtl steel_hull');
    expect(res.objText).toContain('f 1/1/1 2/2/2 3/3/3');
  });

  it('builds and parses 136-byte Halo CE multiplayer gametype blam.lst files', () => {
    const buf = buildHaloGametypeBlamLst({
      name: 'Pelican CTF',
      gameMode: 'ctf',
      teamPlay: true,
      scoreLimit: 5,
      timeLimitMinutes: 20,
      shieldsEnabled: true,
      startingEquipment: 'pistols',
      vehicleRespawnSeconds: 45,
      friendlyFire: false,
      motionTracker: true,
      infiniteGrenades: true,
    });
    expect(buf.length).toBe(0x88);
    const parsed = parseHaloGametypeBlamLst(buf);
    expect(parsed.name).toBe('Pelican CTF');
    expect(parsed.gameMode).toBe('ctf');
    expect(parsed.teamPlay).toBe(true);
    expect(parsed.scoreLimit).toBe(5);
    expect(parsed.timeLimitMinutes).toBe(20);
    expect(parsed.startingEquipment).toBe('pistols');
    expect(parsed.vehicleRespawnSeconds).toBe(45);
    expect(parsed.infiniteGrenades).toBe(true);
  });
});
