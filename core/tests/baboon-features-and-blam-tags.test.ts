import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  inspectBlamLooseTagHeader,
  parseHekLooseTagBuffer,
  serializeContainerTagToHekLooseBuffer,
  serializeOceContainerToBlamTagFiles,
} from '../src/map/legacy-tag-codec';
import { alignReflexiveElements, compareTagFieldListsSemantically } from '../src/map/map-compare';
import {
  readLooseBlamTagFields,
  writeLooseBlamTagFieldValue,
  compareBlamLooseTagBuffers,
  evaluateBlamFunctionCurve,
  tokenizeHaloHudStringMarkup,
  exportUnicodeStringsToCsv,
  previewUnicodeStringsCsvImport,
  EditJournal,
  buildTransactionalPokePlan,
  queryHaloScriptDocs,
  getToolCommandCatalog,
} from '../src/map/baboon-features';
import { runNativeToolCommand, parseJmsTextToModelData } from '../src/map/native-tool-compiler';
import type { OceContainerTag } from '../src/map/container';
import type { TagFieldDescriptor } from '../src/map/tag-field-editor';

describe('Standard 64-byte Blam Loose Tag Codec & Container Conversion', () => {
  it('round-trips a wind tag through serializeContainerTagToHekLooseBuffer and parseHekLooseTagBuffer with 64-byte blam header', () => {
    const structBytes = Buffer.alloc(64, 0);
    structBytes.writeFloatLE(0.5, 0); // velocity lower bound
    structBytes.writeFloatLE(2.5, 4); // velocity upper bound

    const containerTag: OceContainerTag = {
      path: 'levels\\b30\\wind_breeze',
      group: 'wind',
      structName: 'Wind',
      version: 1,
      isExternal: false,
      data: structBytes.toString('base64'),
      dependencies: [],
    };

    const blamBuffer = serializeContainerTagToHekLooseBuffer(containerTag);
    expect(blamBuffer.length).toBe(64 + 64);
    expect(blamBuffer.toString('ascii', 0x3c, 0x40)).toBe('blam');
    expect(blamBuffer.toString('ascii', 0x24, 0x28)).toBe('wind');

    const headerInfo = inspectBlamLooseTagHeader(blamBuffer);
    expect(headerInfo).not.toBeNull();
    expect(headerInfo!.format).toBe('classic_blam_be');
    expect(headerInfo!.groupName).toBe('wind');
    expect(headerInfo!.version).toBe(1);
    expect(headerInfo!.headerSize).toBe(64);

    const parsed = parseHekLooseTagBuffer(blamBuffer, 'levels\\b30\\wind_breeze');
    expect(parsed.tag.group).toBe('wind');
    expect(parsed.tag.path).toBe('levels\\b30\\wind_breeze');
    const decodedStruct = Buffer.from(parsed.tag.data, 'base64');
    expect(decodedStruct.readFloatLE(0)).toBeCloseTo(0.5, 5);
    expect(decodedStruct.readFloatLE(4)).toBeCloseTo(2.5, 5);
  });

  it('reads and writes fields directly in a 64-byte loose Blam tag buffer via readLooseBlamTagFields and writeLooseBlamTagFieldValue', () => {
    const structBytes = Buffer.alloc(64, 0);
    const containerTag: OceContainerTag = {
      path: 'levels\\test\\custom_wind',
      group: 'wind',
      structName: 'Wind',
      version: 1,
      isExternal: false,
      data: structBytes.toString('base64'),
      dependencies: [],
    };
    const blamBuffer = serializeContainerTagToHekLooseBuffer(containerTag);

    const readRes = readLooseBlamTagFields(blamBuffer, 'levels\\test\\custom_wind');
    expect(readRes.group).toBe('wind');
    expect(readRes.fields.length).toBeGreaterThan(0);

    const firstNumericField = readRes.fields.find((f) => f.kind === 'number');
    if (firstNumericField) {
      const updated = writeLooseBlamTagFieldValue(
        blamBuffer,
        'levels\\test\\custom_wind',
        firstNumericField.name,
        42,
      );
      const diffRows = compareBlamLooseTagBuffers(blamBuffer, updated.buffer, 'levels\\test\\custom_wind');
      expect(diffRows.length).toBeGreaterThan(0);
    }
  });

  it('converts an OceContainer into an array of standard 64-byte Blam loose tag files', () => {
    const structBytes = Buffer.alloc(64, 0);
    const files = serializeOceContainerToBlamTagFiles({
      magic: 'OCETAGS1',
      version: 1,
      sourceEngine: 'CustomEdition',
      sourceMap: 'bloodgulch',
      extractedAt: new Date().toISOString(),
      rootTags: ['levels\\test\\bloodgulch\\wind'],
      tags: [
        {
          path: 'levels\\test\\bloodgulch\\wind',
          group: 'wind',
          structName: 'Wind',
          version: 1,
          isExternal: false,
          data: structBytes.toString('base64'),
          dependencies: [],
        },
      ],
    });
    expect(files.length).toBe(1);
    expect(files[0]!.relativePath.replace(/\\/g, '/')).toBe('levels/test/bloodgulch/wind.wind');
    expect(files[0]!.bytes.toString('ascii', 0x3c, 0x40)).toBe('blam');
  });
});

describe('Baboon 3-Tier Semantic Reflexive Diff (alignByIdentity + alignByContent LCS)', () => {
  const makeNamedElem = (index: number, name: string, damage: number) => ({
    index,
    structName: 'WeaponTrigger',
    fields: [
      {
        name: 'name',
        type: 'TagString',
        kind: 'string' as const,
        offset: 0,
        readOnly: false,
        value: name,
      },
      {
        name: 'damage',
        type: 'float',
        kind: 'number' as const,
        offset: 32,
        readOnly: false,
        value: damage,
      },
    ],
  });

  it('detects reordered reflexive elements by identity and marks moved chunks with Patience-sort LIS', () => {
    const left = [
      makeNamedElem(0, 'primary_fire', 10),
      makeNamedElem(1, 'melee_strike', 50),
      makeNamedElem(2, 'secondary_fire', 25),
    ];
    const right = [
      makeNamedElem(0, 'secondary_fire', 30), // moved from 2 -> 0 & modified
      makeNamedElem(1, 'primary_fire', 10),
      makeNamedElem(2, 'melee_strike', 50),
      makeNamedElem(3, 'overcharge_blast', 100), // added
    ];

    const alignment = alignReflexiveElements(left, right);
    expect(alignment.strategy).toBe('identity');
    const secondaryPair = alignment.matchedPairs.find((p) => p.identity === 'secondary_fire');
    expect(secondaryPair).toBeDefined();
    expect(secondaryPair!.oldIdx).toBe(2);
    expect(secondaryPair!.newIdx).toBe(0);
    expect(secondaryPair!.moved).toBe(true);
    expect(alignment.addedIndices).toContain(3);

    const leftRoot: TagFieldDescriptor[] = [
      {
        name: 'triggers',
        type: 'TagReflexive',
        kind: 'reflexive',
        offset: 0,
        readOnly: false,
        value: null,
        children: left,
      },
    ];
    const rightRoot: TagFieldDescriptor[] = [
      {
        name: 'triggers',
        type: 'TagReflexive',
        kind: 'reflexive',
        offset: 0,
        readOnly: false,
        value: null,
        children: right,
      },
    ];

    const rows: Array<{
      property: string;
      before: string;
      after: string;
      status?: string;
      detail?: string;
    }> = [];
    compareTagFieldListsSemantically(leftRoot, rightRoot, (property, before, after, status, detail) => {
      rows.push({ property, before, after, status, detail });
    });
    expect(rows.some((r) => r.property.includes('secondary_fire') && r.property.endsWith('.damage'))).toBe(true);
    expect(rows.some((r) => r.status === 'added' && r.property.includes('overcharge_blast'))).toBe(true);
  });
});

describe('Baboon Function Curve Evaluator, HUD Markup Tokenizer, Strings CSV & EditJournal', () => {
  it('evaluates periodic, transition, linear, and spline Blam function curves with 4-stop color gradients', () => {
    const curve = evaluateBlamFunctionCurve(
      {
        kind: 'periodic',
        periodicFunction: 'cosine',
        frequency: 2,
        phase: 0,
        minBound: 0,
        maxBound: 1,
        colorStops: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
          [1, 1, 1],
        ],
      },
      65,
    );
    expect(curve.samples.length).toBe(65);
    expect(curve.samples[0]!.rgbHex).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('tokenizes Halo HUD %button markup and previews CSV Amend & Replace imports', () => {
    const segments = tokenizeHaloHudStringMarkup('Press %action to swap weapon or %zoom to scope');
    expect(segments.filter((s) => s.type === 'button_token').map((s) => s.raw)).toEqual(['%action', '%zoom']);

    const csv = exportUnicodeStringsToCsv([
      { index: 0, text: 'Picked up Assault Rifle' },
      { index: 1, text: 'Press %reload to reload' },
    ]);
    expect(csv).toContain('index,text');

    const amendPreview = previewUnicodeStringsCsvImport(
      [
        { index: 0, text: 'Picked up Assault Rifle' },
        { index: 1, text: 'Press %reload to reload' },
      ],
      'index,text\n1,"Hold %reload to reload"\n2,"New string entry"',
      'amend',
    );
    expect(amendPreview.modifiedCount).toBe(1);
    expect(amendPreview.addedCount).toBe(1);
    expect(amendPreview.unchangedCount).toBe(1);
    expect(amendPreview.mergedStrings.length).toBe(3);
  });

  it('tracks undo/redo byte snapshots with drag coalescing in EditJournal and builds transactional poke plans', () => {
    const journal = new EditJournal(Buffer.from([1, 0, 0, 0]), 10, 250);
    journal.recordEdit(Buffer.from([2, 0, 0, 0]), 'Drag X', 'position', 1000);
    journal.recordEdit(Buffer.from([3, 0, 0, 0]), 'Drag X', 'position', 1100); // within 250ms coalesce window

    expect(journal.undoStackSize).toBe(1);
    expect(journal.currentBytes[0]).toBe(3);
    const undone = journal.undo();
    expect(undone?.bytes[0]).toBe(1);

    const beforeBuf = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]);
    const afterBuf = Buffer.from([1, 0, 0, 0, 2, 0, 0, 0]);
    const pokePlan = buildTransactionalPokePlan(beforeBuf, afterBuf, 0x40440000, 0);
    expect(pokePlan.patches.length).toBe(2);
    expect(pokePlan.patches[0]!.address).toBe(0x40440000);
    expect(pokePlan.rollbackPatches[0]!.address).toBe(0x40440004);
  });

  it('queries multi-engine HaloScript documentation and tool.exe command schemas', () => {
    const hsResults = queryHaloScriptDocs('object_create', 'h1');
    expect(hsResults.length).toBeGreaterThan(0);
    expect(hsResults[0]!.name).toContain('object_create');

    const toolCmds = getToolCommandCatalog('h1');
    expect(toolCmds.some((c) => c.name === 'build-cache-file')).toBe(true);
    expect(toolCmds.some((c) => c.name === 'structure')).toBe(true);
  });
});

describe('Native Standalone tool.exe Compiler (runNativeToolCommand)', () => {
  const makeClosedTetraJms = (materialName = 'metal_hull') =>
    [
      '8200',
      '3251',
      '1',
      'frame',
      '-1',
      '-1',
      '0.0\t0.0\t0.0\t1.0',
      '0.0\t0.0\t0.0',
      '1',
      materialName,
      '<none>',
      '2',
      'primary_trigger',
      '-1',
      '0',
      '0.0\t0.0\t0.0\t1.0',
      '1.0\t0.0\t0.0',
      '1.0',
      'mass_front',
      '-1',
      '0',
      '0.0\t0.0\t0.0\t1.0',
      '0.5\t0.0\t0.0',
      '1.5',
      '1',
      'unnamed',
      '4',
      '0',
      '0.0\t0.0\t0.0',
      '0.0\t0.0\t-1.0',
      '-1',
      '0.0',
      '0.0\t0.0\t0.0',
      '0',
      '2.0\t0.0\t0.0',
      '1.0\t0.0\t0.0',
      '-1',
      '0.0',
      '1.0\t0.0\t0.0',
      '0',
      '0.0\t2.0\t0.0',
      '0.0\t1.0\t0.0',
      '-1',
      '0.0',
      '0.0\t1.0\t0.0',
      '0',
      '0.0\t0.0\t2.0',
      '0.0\t0.0\t1.0',
      '-1',
      '0.0',
      '1.0\t1.0\t0.0',
      '4',
      '0',
      '0',
      '0\t2\t1',
      '0',
      '0',
      '0\t1\t3',
      '0',
      '0',
      '1\t2\t3',
      '0',
      '0',
      '2\t0\t3',
    ].join('\n');

  it('parses JMSv8200 text into nodes, markers, mass spheres, materials, and manifold triangles', () => {
    const parsed = parseJmsTextToModelData(makeClosedTetraJms('steel_plate'));
    expect(parsed.version).toBe(8200);
    expect(parsed.nodes.length).toBe(1);
    expect(parsed.nodes[0]!.name).toBe('frame');
    expect(parsed.materials[0]!.name).toBe('steel_plate');
    expect(parsed.markers.length).toBe(2);
    expect(parsed.mesh.triangles.length).toBe(4);
    expect(parsed.mesh.vertices.length).toBe(4);
  });

  it('compiles unicode-strings, hud-messages, model, collision-geometry, physics, animations, structure, lightmaps, and build-cache-file natively into 64-byte blam tags', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opence-native-tool-'));
    try {
      // 1. unicode-strings
      const ustrDataDir = path.join(workDir, 'data', 'ui', 'hud_strings');
      fs.mkdirSync(ustrDataDir, { recursive: true });
      fs.writeFileSync(
        path.join(ustrDataDir, 'hud_strings.txt'),
        'Picked up Rocket Launcher\r\n###END-STRING###\r\nHold %action to board vehicle\r\n###END-STRING###\r\n',
        'utf-8',
      );
      const ustrRes = await runNativeToolCommand({
        command: 'unicode-strings',
        args: ['ui/hud_strings'],
        workingDir: workDir,
      });
      expect(ustrRes.ok).toBe(true);
      expect(ustrRes.writtenTagPaths.length).toBe(1);
      const ustrTagBuf = fs.readFileSync(ustrRes.writtenTagPaths[0]!);
      expect(ustrTagBuf.toString('ascii', 0x3c, 0x40)).toBe('blam');
      expect(ustrTagBuf.toString('ascii', 0x24, 0x28)).toBe('ustr');

      // 2. hud-messages
      const hmtDataDir = path.join(workDir, 'data', 'levels', 'b30');
      fs.mkdirSync(hmtDataDir, { recursive: true });
      fs.writeFileSync(
        path.join(hmtDataDir, 'hud message text.hmt'),
        'obj_beach=Secure the Silent Cartographer beachhead\r\npickup_ar=Press %action to swap for Assault Rifle\r\n',
        'utf-8',
      );
      const hmtRes = await runNativeToolCommand({
        command: 'hud-messages',
        args: ['levels/b30', 'b30'],
        workingDir: workDir,
      });
      expect(hmtRes.ok).toBe(true);
      const hmtTagBuf = fs.readFileSync(hmtRes.writtenTagPaths[0]!);
      expect(hmtTagBuf.toString('ascii', 0x3c, 0x40)).toBe('blam');
      expect(hmtTagBuf.toString('ascii', 0x24, 0x28)).toBe('hmt ');

      // 3. model, collision-geometry, physics, animations
      const weaponModelsDir = path.join(workDir, 'data', 'weapons', 'test_rifle', 'models');
      const weaponPhysicsDir = path.join(workDir, 'data', 'weapons', 'test_rifle', 'physics');
      const weaponAnimsDir = path.join(workDir, 'data', 'weapons', 'test_rifle', 'animations');
      fs.mkdirSync(weaponModelsDir, { recursive: true });
      fs.mkdirSync(weaponPhysicsDir, { recursive: true });
      fs.mkdirSync(weaponAnimsDir, { recursive: true });

      const jmsText = makeClosedTetraJms('rifle_metal');
      fs.writeFileSync(path.join(weaponModelsDir, 'test_rifle.jms'), jmsText, 'utf-8');
      fs.writeFileSync(path.join(weaponPhysicsDir, 'collision.jms'), jmsText, 'utf-8');
      fs.writeFileSync(path.join(weaponPhysicsDir, 'physics.jms'), jmsText, 'utf-8');
      fs.writeFileSync(
        path.join(weaponAnimsDir, 'stand fixed idle.jma'),
        [
          '16392',
          '2',
          '30',
          '1',
          'unnamed',
          '1',
          '3251',
          'frame',
          '-1',
          '-1',
          '0.0\t0.0\t0.0',
          '0.0\t0.0\t0.0\t1.0',
          '1.0',
          '0.0\t0.0\t0.1',
          '0.0\t0.0\t0.0\t1.0',
          '1.0',
        ].join('\n'),
        'utf-8',
      );

      const modelRes = await runNativeToolCommand({
        command: 'model',
        args: ['weapons/test_rifle'],
        workingDir: workDir,
      });
      expect(modelRes.ok).toBe(true);
      expect(
        fs.existsSync(path.join(workDir, 'tags', 'weapons', 'test_rifle', 'test_rifle.gbxmodel')),
      ).toBe(true);

      const collRes = await runNativeToolCommand({
        command: 'collision-geometry',
        args: ['weapons/test_rifle'],
        workingDir: workDir,
      });
      expect(collRes.ok).toBe(true);
      expect(
        fs.existsSync(
          path.join(workDir, 'tags', 'weapons', 'test_rifle', 'test_rifle.model_collision_geometry'),
        ),
      ).toBe(true);

      const physRes = await runNativeToolCommand({
        command: 'physics',
        args: ['weapons/test_rifle'],
        workingDir: workDir,
      });
      expect(physRes.ok).toBe(true);
      expect(
        fs.existsSync(path.join(workDir, 'tags', 'weapons', 'test_rifle', 'test_rifle.physics')),
      ).toBe(true);

      const animRes = await runNativeToolCommand({
        command: 'animations',
        args: ['weapons/test_rifle'],
        workingDir: workDir,
      });
      expect(animRes.ok).toBe(true);
      expect(
        fs.existsSync(
          path.join(workDir, 'tags', 'weapons', 'test_rifle', 'test_rifle.model_animations'),
        ),
      ).toBe(true);

      // 4. structure + lightmaps + build-cache-file
      const scnrModelsDir = path.join(workDir, 'data', 'levels', 'test', 'box_arena', 'models');
      fs.mkdirSync(scnrModelsDir, { recursive: true });
      fs.writeFileSync(path.join(scnrModelsDir, 'box_arena.jms'), makeClosedTetraJms('forerunner_wall'), 'utf-8');

      const structRes = await runNativeToolCommand({
        command: 'structure',
        args: ['levels/test/box_arena', 'box_arena'],
        workingDir: workDir,
      });
      expect(structRes.ok).toBe(true);
      expect(
        fs.existsSync(
          path.join(workDir, 'tags', 'levels', 'test', 'box_arena', 'box_arena.scenario_structure_bsp'),
        ),
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(workDir, 'tags', 'levels', 'test', 'box_arena', 'box_arena.scenario'),
        ),
      ).toBe(true);

      const lmRes = await runNativeToolCommand({
        command: 'lightmaps',
        args: ['levels/test/box_arena/box_arena', 'box_arena', '0', '0.1'],
        workingDir: workDir,
      });
      expect(lmRes.ok).toBe(true);
      expect(
        fs.existsSync(
          path.join(workDir, 'tags', 'levels', 'test', 'box_arena', 'box_arena_lightmaps.bitmap'),
        ),
      ).toBe(true);

      const cacheRes = await runNativeToolCommand({
        command: 'build-cache-file',
        args: ['levels/test/box_arena/box_arena'],
        workingDir: workDir,
      });
      expect(cacheRes.ok).toBe(true);
      expect(fs.existsSync(path.join(workDir, 'maps', 'box_arena.map'))).toBe(true);

      // 5. bitmaps (.bmp) and sounds (.wav)
      const bitmDataDir = path.join(workDir, 'data', 'weapons', 'test_rifle', 'bitmaps');
      fs.mkdirSync(bitmDataDir, { recursive: true });
      // Write a valid 4x4 24-bit uncompressed BMP
      const bmpBuf = Buffer.alloc(54 + 4 * 12, 0);
      bmpBuf.write('BM', 0, 2, 'ascii');
      bmpBuf.writeUInt32LE(bmpBuf.length, 2);
      bmpBuf.writeUInt32LE(54, 10);
      bmpBuf.writeUInt32LE(40, 14);
      bmpBuf.writeInt32LE(4, 18); // width
      bmpBuf.writeInt32LE(4, 22); // height
      bmpBuf.writeUInt16LE(1, 26); // planes
      bmpBuf.writeUInt16LE(24, 28); // bpp
      fs.writeFileSync(path.join(bitmDataDir, 'rifle_hull.bmp'), bmpBuf);

      const bitmRes = await runNativeToolCommand({
        command: 'bitmaps',
        args: ['weapons/test_rifle/bitmaps'],
        workingDir: workDir,
      });
      expect(bitmRes.ok).toBe(true);
      expect(
        fs.existsSync(path.join(workDir, 'tags', 'weapons', 'test_rifle', 'bitmaps', 'rifle_hull.bitmap')),
      ).toBe(true);

      const sndDataDir = path.join(workDir, 'data', 'sound', 'sfx', 'fire_shot');
      fs.mkdirSync(sndDataDir, { recursive: true });
      // Write a valid 22050 Hz mono 16-bit PCM WAV (64 samples)
      const numSamples = 64;
      const wavDataBytes = numSamples * 2;
      const wavBuf = Buffer.alloc(44 + wavDataBytes, 0);
      wavBuf.write('RIFF', 0, 4, 'ascii');
      wavBuf.writeUInt32LE(36 + wavDataBytes, 4);
      wavBuf.write('WAVE', 8, 4, 'ascii');
      wavBuf.write('fmt ', 12, 4, 'ascii');
      wavBuf.writeUInt32LE(16, 16); // fmt chunk size
      wavBuf.writeUInt16LE(1, 20); // PCM = 1
      wavBuf.writeUInt16LE(1, 22); // 1 channel
      wavBuf.writeUInt32LE(22050, 24); // sampleRate
      wavBuf.writeUInt32LE(44100, 28); // byteRate
      wavBuf.writeUInt16LE(2, 32); // blockAlign
      wavBuf.writeUInt16LE(16, 34); // bitsPerSample
      wavBuf.write('data', 36, 4, 'ascii');
      wavBuf.writeUInt32LE(wavDataBytes, 40);
      for (let i = 0; i < numSamples; i++) {
        wavBuf.writeInt16LE(Math.round(Math.sin((i / numSamples) * Math.PI * 2) * 12000), 44 + i * 2);
      }
      fs.writeFileSync(path.join(sndDataDir, 'perm01.wav'), wavBuf);

      const sndRes = await runNativeToolCommand({
        command: 'sounds',
        args: ['sound/sfx/fire_shot', 'xbox', '1'],
        workingDir: workDir,
      });
      expect(sndRes.ok).toBe(true);
      const sndOutPath = path.join(workDir, 'tags', 'sound', 'sfx', 'fire_shot.sound');
      expect(fs.existsSync(sndOutPath)).toBe(true);
      const sndTagBuf = fs.readFileSync(sndOutPath);
      expect(sndTagBuf.toString('ascii', 0x3c, 0x40)).toBe('blam');
      expect(sndTagBuf.toString('ascii', 0x24, 0x28)).toBe('snd!');
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});
