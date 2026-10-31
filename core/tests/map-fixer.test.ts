import { describe, it, expect } from 'vitest';
import { fixCeMapHaloScriptAndCrc, runMapFixAction } from '../src/map/map-fixer';
import { CacheFileEngine, CacheFileLiteral, CACHE_FILE_HEADER_SIZE } from '../src/constants/cache-file';

function buildSyntheticCeMapWithDisallowedScripts(): Buffer {
  const BASE = 0x40440000;
  const tagDataOffset = CACHE_FILE_HEADER_SIZE; // 0x800
  const tagDataSize = 0x4000;
  const totalSize = tagDataOffset + tagDataSize;
  const buf = Buffer.alloc(totalSize, 0);

  // Header
  buf.writeUInt32LE(CacheFileLiteral.HEAD, 0x000);
  buf.writeUInt32LE(CacheFileEngine.CUSTOM_EDITION, 0x004);
  buf.writeUInt32LE(totalSize, 0x008);
  buf.writeUInt32LE(tagDataOffset, 0x010);
  buf.writeUInt32LE(tagDataSize, 0x014);
  buf.write('test_script_fix', 0x020, 'ascii');
  buf.write('01.00.00.0609', 0x040, 'ascii');
  buf.writeUInt16LE(0, 0x060);
  buf.writeUInt32LE(0x12345678, 0x064);
  buf.writeUInt32LE(CacheFileLiteral.FOOT, 0x7fc);

  // Tag Data Header (0x28 bytes)
  const tagInstancesRel = 0x040;
  const scenarioRel = 0x100;
  const scriptsRel = 0x800;
  const stringsRel = 0x900;
  const syntaxRel = 0xb00;

  buf.writeUInt32LE(BASE + tagInstancesRel, tagDataOffset + 0x00); // tag_instances_address
  buf.writeUInt32LE(0xe1740000, tagDataOffset + 0x04); // scenario datum handle (index 0)
  buf.writeUInt32LE(1, tagDataOffset + 0x0c); // tag_count = 1
  buf.writeUInt32LE(CacheFileLiteral.TAGS, tagDataOffset + 0x24);

  // Tag Instance 0 (scenario)
  const tagEntryOff = tagDataOffset + tagInstancesRel;
  buf.writeUInt32LE(0x73636e72, tagEntryOff + 0x00); // 'scnr'
  buf.writeUInt32LE(0xffffffff, tagEntryOff + 0x04);
  buf.writeUInt32LE(0xffffffff, tagEntryOff + 0x08);
  buf.writeUInt32LE(0xe1740000, tagEntryOff + 0x0c);
  buf.writeUInt32LE(BASE + 0x080, tagEntryOff + 0x10);
  buf.writeUInt32LE(BASE + scenarioRel, tagEntryOff + 0x14);
  buf.write('levels\\test\\test', tagDataOffset + 0x080, 'ascii');

  // Script strings table
  const stringsOff = tagDataOffset + stringsRel;
  const stringsList = [
    'begin',
    'set',
    'cheat_omnipotent',
    'map_name',
    'b30',
    'game_revert',
    'map_reset',
  ];
  const strOffsets: Record<string, number> = {};
  let cursor = 0;
  for (const s of stringsList) {
    strOffsets[s] = cursor;
    buf.write(s, stringsOff + cursor, 'ascii');
    cursor += s.length + 1;
  }

  // Syntax Data Table (header 0x38 + 8 nodes * 20 bytes)
  const syntaxOff = tagDataOffset + syntaxRel;
  const nodeCount = 7;
  const syntaxSize = 0x38 + nodeCount * 20;
  buf.write('hs_syntax_data', syntaxOff + 0x00, 'ascii');
  buf.writeUInt16LE(nodeCount, syntaxOff + 0x20);
  buf.writeUInt16LE(20, syntaxOff + 0x22);
  buf.write('d@t@', syntaxOff + 0x28, 'ascii');
  buf.writeInt16LE(nodeCount, syntaxOff + 0x2e); // actual_count

  const writeSyntaxNode = (
    idx: number,
    identifier: number,
    constantType: number,
    type: number,
    flags: number,
    nextNode: number,
    strOff: number,
    data: number,
  ) => {
    const off = syntaxOff + 0x38 + idx * 20;
    buf.writeInt16LE(identifier, off + 0x00);
    buf.writeInt16LE(constantType, off + 0x02);
    buf.writeInt16LE(type, off + 0x04);
    buf.writeUInt16LE(flags, off + 0x06);
    buf.writeInt32LE(nextNode, off + 0x08);
    buf.writeInt32LE(strOff, off + 0x0c);
    buf.writeInt32LE(data, off + 0x10);
  };

  // Node 0: Call `(set cheat_omnipotent 1)` -> child is Node 1 (fn 'set'), arg1 is Node 2 (global 'cheat_omnipotent')
  writeSyntaxNode(0, -100, 1, 4, 0x0000, 3, 0, 0x00010001);
  writeSyntaxNode(1, -101, 1, 2, 0x0009, 0x00010002, strOffsets['set'], 0);
  writeSyntaxNode(2, -102, 5, 5, 0x0005, -1, strOffsets['cheat_omnipotent'], 0x8001);

  // Node 3: Call `(map_name b30)` -> child is Node 4 (fn 'map_name'), arg1 is Node 5 ('b30')
  writeSyntaxNode(3, -103, 18, 4, 0x0000, 6, 0, 0x00010004);
  writeSyntaxNode(4, -104, 18, 2, 0x0009, 0x00010005, strOffsets['map_name'], 0);
  writeSyntaxNode(5, -105, 9, 9, 0x0001, -1, strOffsets['b30'], 0);

  // Node 6: Call `(map_reset)` -> child is Node 6's function call... wait let's add Node 7 for fn 'map_reset'
  // Actually let's make nodeCount = 8 and add Node 7
  buf.writeUInt16LE(8, syntaxOff + 0x20);
  buf.writeInt16LE(8, syntaxOff + 0x2e);
  writeSyntaxNode(6, -106, 19, 4, 0x0000, -1, 0, 0x00010007);
  writeSyntaxNode(7, -107, 19, 2, 0x0009, -1, strOffsets['map_reset'], 0);

  // Script 0 entry (92 bytes)
  const scriptsOff = tagDataOffset + scriptsRel;
  buf.write('main_mission', scriptsOff + 0x00, 'ascii');
  buf.writeInt32LE(0x00010000, scriptsOff + 0x24); // root syntax node index = 0

  // Scenario HaloScript reflexives/raw data blocks
  const scnrOff = tagDataOffset + scenarioRel;
  buf.writeInt32LE(0x38 + 8 * 20, scnrOff + 0x474 + 0x00); // syntax size
  buf.writeUInt32LE(BASE + syntaxRel, scnrOff + 0x474 + 0x0c); // syntax address
  buf.writeInt32LE(cursor, scnrOff + 0x488 + 0x00); // strings size
  buf.writeUInt32LE(BASE + stringsRel, scnrOff + 0x488 + 0x0c); // strings address
  buf.writeInt32LE(1, scnrOff + 0x49c + 0x00); // script count = 1
  buf.writeUInt32LE(BASE + scriptsRel, scnrOff + 0x49c + 0x04); // scripts address

  return buf;
}

describe('Map Fixer — HaloScript AST Fixer & UI DTO Compatibility', () => {
  it('populates both fixedNodes and mutations with targetName/kind/expression/reason and alreadyFixedNodes', () => {
    const mapBuf = buildSyntheticCeMapWithDisallowedScripts();
    const res = runMapFixAction('ce', mapBuf);

    expect(res.ok).toBe(true);
    expect(res.scriptFix).not.toBeNull();
    const sf = res.scriptFix!;

    // Verify counts
    expect(sf.nodesNeutralized).toBe(2); // (set cheat_omnipotent ...) and (map_reset)
    expect(sf.nodesConvertedToGameRevert).toBe(1); // (map_name b30) -> (game_revert)
    expect(sf.nodesAlreadyFixed).toBe(0);
    expect(sf.alreadyFixedNodes).toBe(0);

    // Verify both fixedNodes and mutations arrays exist and match for UI rendering
    expect(Array.isArray(sf.fixedNodes)).toBe(true);
    expect(Array.isArray(sf.mutations)).toBe(true);
    expect(sf.mutations.length).toBe(3);
    expect(sf.fixedNodes.length).toBe(3);

    for (const m of sf.mutations) {
      expect(typeof m.scriptName).toBe('string');
      expect(typeof m.nodeIndex).toBe('number');
      expect(typeof m.expression).toBe('string');
      expect(typeof m.reason).toBe('string');
      expect(typeof m.targetName).toBe('string');
      expect(m.kind === 'function_call' || m.kind === 'global_set').toBe(true);
    }

    // Running a second pass on the already-fixed buffer should report 3 alreadyFixedNodes
    const res2 = fixCeMapHaloScriptAndCrc(res.buffer!);
    expect(res2.nodesNeutralized).toBe(0);
    expect(res2.nodesConvertedToGameRevert).toBe(0);
    expect(res2.nodesAlreadyFixed).toBe(3);
    expect(res2.alreadyFixedNodes).toBe(3);
    expect(res2.mutations.length).toBe(3);
  });
});
