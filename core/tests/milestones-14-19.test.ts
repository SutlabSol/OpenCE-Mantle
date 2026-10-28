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
  serializeContainerTagToHekLooseBuffer,
  parseHekLooseTagBuffer,
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

  it('round-trips a Scenario tag through HEK loose format with Big-Endian script syntax data', () => {
    // 1456-byte root Scenario struct + 76-byte script syntax data (56-byte ScenarioScriptNodeTable + 1x 20-byte ScenarioScriptNode)
    const rootSize = 1456;
    const syntaxSize = 76;
    const leData = Buffer.alloc(rootSize + syntaxSize, 0);
    // script syntax data TagDataOffset at Scenario + 1140
    leData.writeUInt32LE(syntaxSize, 1140 + 0);
    leData.writeUInt32LE(rootSize, 1140 + 12);

    // ScenarioScriptNodeTable in Little-Endian at offset rootSize
    leData.write('script node', rootSize + 0, 'latin1');
    leData.writeUInt16LE(19001, rootSize + 32); // maximum count
    leData.writeUInt16LE(20, rootSize + 34); // element size
    leData.writeUInt8(1, rootSize + 36); // one
    leData.writeUInt32LE(0x64407440, rootSize + 40); // 'd@t@' signature in LE
    leData.writeUInt16LE(1, rootSize + 48); // count = 1
    leData.writeUInt16LE(0xe373, rootSize + 50); // next id

    // ScenarioScriptNode[0] in Little-Endian at offset rootSize + 56
    leData.writeUInt16LE(0xe372, rootSize + 56 + 0); // salt
    leData.writeUInt16LE(2, rootSize + 56 + 2); // index union
    leData.writeUInt16LE(4, rootSize + 56 + 4); // type = void
    leData.writeUInt16LE(1, rootSize + 56 + 6); // flags = primitive
    leData.writeUInt32LE(0xffffffff, rootSize + 56 + 8); // next node

    const hekBuf = serializeContainerTagToHekLooseBuffer({
      originalIndex: 0,
      group: 'scenario',
      path: 'levels\\test\\bloodgulch\\bloodgulch',
      structName: 'Scenario',
      data: leData.toString('base64'),
      dependencies: [],
    });

    // Verify Big-Endian HEK header and Big-Endian 'd@t@' in serialized .scenario buffer
    expect(hekBuf.toString('latin1', 36, 40)).toBe('scnr');
    expect(hekBuf.readUInt16BE(56)).toBe(2);
    const beSyntaxStart = 64 + rootSize;
    expect(hekBuf.readUInt16BE(beSyntaxStart + 32)).toBe(19001);
    expect(hekBuf.readUInt16BE(beSyntaxStart + 34)).toBe(20);
    expect(hekBuf.readUInt32BE(beSyntaxStart + 40)).toBe(0x64407440);

    // Parse back into Little-Endian cache tag layout
    const roundTripped = parseHekLooseTagBuffer(
      hekBuf,
      'levels\\test\\bloodgulch\\bloodgulch',
      'scenario',
    );
    const rtData = Buffer.from(roundTripped.tag.data, 'base64');
    const rtSyntaxPtr = rtData.readUInt32LE(1140 + 12);
    expect(rtData.readUInt16LE(rtSyntaxPtr + 32)).toBe(19001);
    expect(rtData.readUInt16LE(rtSyntaxPtr + 34)).toBe(20);
    expect(rtData.readUInt32LE(rtSyntaxPtr + 40)).toBe(0x64407440);
    expect(rtData.readUInt16LE(rtSyntaxPtr + 56 + 0)).toBe(0xe372);
    expect(rtData.readUInt16LE(rtSyntaxPtr + 56 + 2)).toBe(2);
    expect(rtData.readUInt32LE(rtSyntaxPtr + 56 + 8)).toBe(0xffffffff);
  });
});
