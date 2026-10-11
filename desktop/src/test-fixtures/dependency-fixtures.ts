import type { DependencyWalkSummary, DependencyTagInfo, DependencyNotExtractedInfo, DependencyWarningInfo, InjectPlanSummary, InjectionMode, VerifyEmbeddedDataResult, RetailConversionReport } from '../../electron/shared-types';

/**
 * Realistic dependency-walk fixtures shared between `dev-mock.ts` (Vite browser preview) and
 * the DependencyDialog/TagBrowser component tests, so both exercise the exact same data shapes.
 */
export const MOCK_SCENARIOS = [
  'clean',
  'scenario-bsp',
  'external-data',
  'spheroid',
  'blocked-data',
  'bsp-only',
  'large-list',
  'deps-error',
  'extract-error',
  'slow-progress',
  'inject-clean',
  'inject-blocked',
  'verify-clean',
  'verify-blocked',
  'convert-retail',
  'convert-scripts',
  'convert-repairs',
  'convert-model-parts',
  'convert-align',
] as const;
export type MockScenario = (typeof MOCK_SCENARIOS)[number];

export function parseMockScenario(search: string): MockScenario {
  const requested = new URLSearchParams(search).get('mock') ?? '';
  return (MOCK_SCENARIOS as readonly string[]).includes(requested) ? (requested as MockScenario) : 'clean';
}

function tag(overrides: Partial<DependencyTagInfo>): DependencyTagInfo {
  return { originalIndex: 0, path: 'unknown', group: 'unknown', status: 'ok', estimatedSize: 1024, requiredBy: [], ...overrides };
}

const BSP_REASON =
  "scenario_structure_bsp tags live in a separate memory region addressed via the owning Scenario's BSP location info (bsp_start/bsp_address), not yet carried into the extractor's relocatable container format.";

function cleanSummary(): DependencyWalkSummary {
  const extractableTags: DependencyTagInfo[] = [
    tag({ originalIndex: 4, path: 'vehicles\\warthog\\warthog', group: 'vehicle', estimatedSize: 12044 }),
    tag({ originalIndex: 10, path: 'vehicles\\warthog\\warthog', group: 'gbxmodel', estimatedSize: 55000, requiredBy: ['vehicles\\warthog\\warthog'] }),
    tag({ originalIndex: 11, path: 'vehicles\\warthog\\shaders\\hull', group: 'shader_model', estimatedSize: 1536, requiredBy: ['vehicles\\warthog\\warthog'] }),
    tag({ originalIndex: 12, path: 'weapons\\warthog gun\\warthog gun', group: 'weapon', estimatedSize: 6210, requiredBy: ['vehicles\\warthog\\warthog'] }),
    tag({ originalIndex: 13, path: 'sound\\sfx\\vehicles\\warthog\\engine', group: 'sound', estimatedSize: 42000, requiredBy: ['vehicles\\warthog\\warthog'] }),
  ];
  return {
    requestedOriginalIndices: [4],
    extractableTags,
    notExtractedTags: [],
    externalTags: [],
    warnings: [],
    totalEstimatedSize: extractableTags.reduce((s, t) => s + (t.estimatedSize ?? 0), 0),
    allExcluded: false,
  };
}

function scenarioBspSummary(): DependencyWalkSummary {
  const extractableTags = [
    tag({ originalIndex: 0, path: 'levels\\test\\bloodgulch\\bloodgulch', group: 'scenario', estimatedSize: 215040 }),
    tag({ originalIndex: 9, path: 'scenery\\rocks\\rock01', group: 'scenery', estimatedSize: 3244, requiredBy: ['levels\\test\\bloodgulch\\bloodgulch'] }),
  ];
  const notExtractedTags: DependencyNotExtractedInfo[] = [
    { originalIndex: 1, path: 'levels\\test\\bloodgulch\\bloodgulch', group: 'scenario_structure_bsp', reason: BSP_REASON, requiredBy: ['levels\\test\\bloodgulch\\bloodgulch'] },
  ];
  const warnings: DependencyWarningInfo[] = [
    {
      originalIndex: 8,
      path: 'levels\\test\\bloodgulch\\shaders\\dirt',
      group: 'shader_environment',
      kind: 'bspTag',
      message: '"levels\\test\\bloodgulch\\shaders\\dirt" (shader_environment) is needed by BSP "levels\\test\\bloodgulch\\bloodgulch" but not extracted (BSP data isn\'t carried into the extracted set this milestone).',
    },
  ];
  return {
    requestedOriginalIndices: [0],
    extractableTags,
    notExtractedTags,
    externalTags: [],
    warnings,
    totalEstimatedSize: extractableTags.reduce((s, t) => s + (t.estimatedSize ?? 0), 0),
    allExcluded: false,
  };
}

function externalDataSummary(): DependencyWalkSummary {
  const extractableTags = [tag({ originalIndex: 5, path: 'weapons\\pistol\\pistol', group: 'weapon', estimatedSize: 6210 })];
  const externalTags: DependencyTagInfo[] = [
    tag({ originalIndex: 6, path: 'levels\\test\\bloodgulch\\clear afternoon\\bitmaps\\cloud mask', group: 'bitmap', status: 'external', estimatedSize: null, requiredBy: ['weapons\\pistol\\pistol'] }),
    tag({ originalIndex: 7, path: 'sound\\sfx\\weapons\\pistol\\fire', group: 'sound', status: 'external', estimatedSize: null, requiredBy: ['weapons\\pistol\\pistol'] }),
  ];
  const warnings: DependencyWarningInfo[] = [
    {
      originalIndex: 6,
      path: 'levels\\test\\bloodgulch\\clear afternoon\\bitmaps\\cloud mask',
      group: 'bitmap',
      kind: 'externalTag',
      message: '"levels\\test\\bloodgulch\\clear afternoon\\bitmaps\\cloud mask" (bitmap) lives in a resource map (bitmaps.map/sounds.map/loc.map), not this map. Not walked further; sounds.map/loc.map resolution is a follow-up milestone.',
    },
    {
      originalIndex: 7,
      path: 'sound\\sfx\\weapons\\pistol\\fire',
      group: 'sound',
      kind: 'externalTag',
      message: '"sound\\sfx\\weapons\\pistol\\fire" (sound) lives in a resource map (bitmaps.map/sounds.map/loc.map), not this map. Not walked further; sounds.map/loc.map resolution is a follow-up milestone.',
    },
    {
      originalIndex: -1,
      path: 'weapons\\pistol\\pistol.hud crosshair bitmap',
      group: '',
      kind: 'externalData',
      message: '"weapons\\pistol\\pistol.hud crosshair bitmap" has its "external" flag set (per-mipmap bitmap data in bitmaps.map) - not resolved this milestone (flagged only).',
    },
  ];
  return { requestedOriginalIndices: [5], extractableTags, notExtractedTags: [], externalTags, warnings, totalEstimatedSize: 6210, allExcluded: false };
}

function spheroidSummary(): DependencyWalkSummary {
  const extractableTags = [tag({ originalIndex: 20, path: 'vehicles\\banshee\\banshee', group: 'vehicle', estimatedSize: 9000 })];
  const warnings: DependencyWarningInfo[] = [
    {
      originalIndex: 21,
      path: 'vehicles\\banshee\\banshee collision',
      group: 'spheroid',
      kind: 'uncertainGroup',
      message: '"vehicles\\banshee\\banshee collision" is a "spheroid" tag - no reliable field layout exists for this group (see SOURCES.md). Treated as an opaque blob; not walked further.',
    },
  ];
  return { requestedOriginalIndices: [20], extractableTags, notExtractedTags: [], externalTags: [], warnings, totalEstimatedSize: 9000, allExcluded: false };
}

/** One warning of each injection-blocking / invalid-layout kind, messages shaped like `dependency-walker.ts`'s. */
function blockedDataSummary(): DependencyWalkSummary {
  const extractableTags = [
    tag({ originalIndex: 30, path: 'weapons\\assault rifle\\assault rifle', group: 'weapon', estimatedSize: 8200 }),
    tag({ originalIndex: 31, path: 'weapons\\assault rifle\\fp\\fp', group: 'gbxmodel', estimatedSize: 48000, requiredBy: ['weapons\\assault rifle\\assault rifle'] }),
    tag({ originalIndex: 32, path: 'weapons\\assault rifle\\bitmaps\\scope', group: 'bitmap', estimatedSize: 2048, requiredBy: ['weapons\\assault rifle\\assault rifle'] }),
  ];
  const warnings: DependencyWarningInfo[] = [
    {
      originalIndex: 31,
      path: 'weapons\\assault rifle\\fp\\fp.geometries[0].parts',
      group: '',
      kind: 'uncapturedData',
      message: '"weapons\\assault rifle\\fp\\fp.geometries[0].parts" has 4 model geometry part(s) (vertex/index data in the separate model-data region) that this tool cannot yet capture or relocate - the WHOLE tag is blocked from injection, not silently dropped.',
    },
    {
      originalIndex: 32,
      path: 'weapons\\assault rifle\\bitmaps\\scope.bitmap data[0]',
      group: '',
      kind: 'embeddedRawData',
      message: '"weapons\\assault rifle\\bitmaps\\scope.bitmap data[0]" (2048 bytes) is embedded in this map\'s own raw-data region (file offset 1048576), outside this tag\'s own struct bytes - captured into the container for relocation if the extracting build supports it (see Verify Embedded Data for status); injection is blocked unless the container has the captured bytes.',
    },
    {
      originalIndex: 30,
      path: 'weapons\\assault rifle\\assault rifle.triggers',
      group: '',
      kind: 'invalidReflexive',
      message: '"weapons\\assault rifle\\assault rifle.triggers" (2 x "WeaponTrigger") resolves outside this file (pointer base -4096) - unrecognized/corrupt layout, not walked further; the WHOLE tag is blocked from injection.',
    },
  ];
  return { requestedOriginalIndices: [30], extractableTags, notExtractedTags: [], externalTags: [], warnings, totalEstimatedSize: 58248, allExcluded: false };
}

function bspOnlySummary(): DependencyWalkSummary {
  const notExtractedTags: DependencyNotExtractedInfo[] = [
    { originalIndex: 1, path: 'levels\\test\\bloodgulch\\bloodgulch', group: 'scenario_structure_bsp', reason: BSP_REASON, requiredBy: [] },
  ];
  return { requestedOriginalIndices: [1], extractableTags: [], notExtractedTags, externalTags: [], warnings: [], totalEstimatedSize: 0, allExcluded: true };
}

function largeListSummary(): DependencyWalkSummary {
  const extractableTags: DependencyTagInfo[] = [];
  for (let i = 0; i < 2200; i++) {
    extractableTags.push(
      tag({
        originalIndex: 100 + i,
        path: `objects\\generated\\item_${i}`,
        group: i % 5 === 0 ? 'weapon' : 'scenery',
        estimatedSize: 512 + (i % 40) * 17,
        requiredBy: i === 0 ? [] : ['objects\\generated\\item_0'],
      }),
    );
  }
  return {
    requestedOriginalIndices: [100],
    extractableTags,
    notExtractedTags: [],
    externalTags: [],
    warnings: [],
    totalEstimatedSize: extractableTags.reduce((s, t) => s + (t.estimatedSize ?? 0), 0),
    allExcluded: false,
  };
}

export function buildMockSummary(scenario: MockScenario): DependencyWalkSummary {
  switch (scenario) {
    case 'scenario-bsp':
      return scenarioBspSummary();
    case 'external-data':
      return externalDataSummary();
    case 'spheroid':
      return spheroidSummary();
    case 'blocked-data':
      return blockedDataSummary();
    case 'bsp-only':
      return bspOnlySummary();
    case 'large-list':
      return largeListSummary();
    case 'slow-progress':
      return cleanSummary();
    default:
      return cleanSummary();
  }
}

/** M5 Step A/B inject-plan fixtures (dev preview via `?mock=inject-clean` / `?mock=inject-blocked`, ADD or SWAP mode). */
export function buildMockInjectPlan(scenario: MockScenario, containerPath: string, mode: InjectionMode = 'add'): InjectPlanSummary {
  if (mode === 'swap') {
    if (scenario === 'inject-blocked') {
      return {
        mode,
        containerPath,
        sourceMapName: 'ui',
        counts: { totalInClosure: 2, reused: 1, swapped: 0, added: 0, blockedEmbedded: 1, blockedOther: 0, externalReferenced: 0 },
        toAdd: [],
        toSwap: [],
        reused: [{ path: 'weapons\\frag grenade\\shaders\\frag metal', group: 'shader_model' }],
        blockedEmbedded: [
          { path: 'weapons\\frag grenade\\shaders\\frag metal', group: 'shader_model', reasons: ['Relocation of embedded (non-shared) bitmap/sound data is disabled this milestone: synthetic embedded warning for test.'] },
        ],
        blockedOther: [],
        externalRefStatuses: [],
        refusedRoots: [],
      };
    }
    return {
      mode,
      containerPath,
      sourceMapName: 'ui',
      counts: { totalInClosure: 4, reused: 3, swapped: 1, added: 0, blockedEmbedded: 0, blockedOther: 3, externalReferenced: 0 },
      toAdd: [],
      toSwap: [{ path: 'weapons\\frag grenade\\shaders\\frag metal', group: 'shader_model' }],
      reused: [
        { path: 'weapons\\frag grenade\\bitmaps\\frag grenade', group: 'bitmap' },
        { path: 'weapons\\frag grenade\\bitmaps\\frag grenade multipurpose', group: 'bitmap' },
        { path: 'weapons\\assault rifle\\fp\\bitmaps\\diffuse gunmetal', group: 'bitmap' },
      ],
      blockedEmbedded: [],
      blockedOther: [
        { path: 'weapons\\frag grenade\\bitmaps\\frag grenade', group: 'bitmap', reasons: ['The existing tag in the target is a resource-map-indexed (external) entry - there is no struct-data pointer to swap into. Left unchanged.'] },
        { path: 'weapons\\frag grenade\\bitmaps\\frag grenade multipurpose', group: 'bitmap', reasons: ['The existing tag in the target is a resource-map-indexed (external) entry - there is no struct-data pointer to swap into. Left unchanged.'] },
        { path: 'weapons\\assault rifle\\fp\\bitmaps\\diffuse gunmetal', group: 'bitmap', reasons: ['The existing tag in the target is a resource-map-indexed (external) entry - there is no struct-data pointer to swap into. Left unchanged.'] },
      ],
      externalRefStatuses: [],
      refusedRoots: [],
    };
  }
  if (scenario === 'inject-blocked') {
    return {
      mode,
      containerPath,
      sourceMapName: 'ui',
      counts: { totalInClosure: 3, reused: 0, swapped: 0, added: 1, blockedEmbedded: 1, blockedOther: 1, externalReferenced: 1 },
      toAdd: [{ path: 'ui\\ticker', group: 'font' }],
      toSwap: [],
      reused: [],
      blockedEmbedded: [{ path: 'sky\\space\\bitmaps\\synthetic_embedded', group: 'bitmap', reasons: ['Relocation of embedded (non-shared) bitmap/sound data is disabled this milestone.'] }],
      blockedOther: [{ path: 'ui\\gamespy', group: 'font', reasons: ['Depends on "fonts\\missing_in_target" (font), a resource-map tag not present in the target map.'] }],
      externalRefStatuses: [{ path: 'sky\\space\\bitmaps\\star mask', group: 'bitmap', resourceMap: 'bitmaps.map', status: 'unconfigured-on-target' }],
      refusedRoots: [{ path: 'ui\\gamespy', reasons: ['Depends on "fonts\\missing_in_target" (font), a resource-map tag not present in the target map.'] }],
    };
  }
  return {
    mode,
    containerPath,
    sourceMapName: 'ui',
    counts: { totalInClosure: 2, reused: 1, swapped: 0, added: 1, blockedEmbedded: 0, blockedOther: 0, externalReferenced: 1 },
    toAdd: [{ path: 'ui\\ticker', group: 'font' }],
    toSwap: [],
    reused: [{ path: 'ui\\small_ui', group: 'font' }],
    blockedEmbedded: [],
    blockedOther: [],
    externalRefStatuses: [{ path: 'sky\\space\\bitmaps\\star mask', group: 'bitmap', resourceMap: 'bitmaps.map', status: 'match' }],
    refusedRoots: [],
  };
}

/** Tools > Verify Embedded Data fixtures (dev preview via `?mock=verify-clean` / `?mock=verify-blocked`). */
export function buildMockVerifyEmbeddedDataResult(scenario: MockScenario): VerifyEmbeddedDataResult {
  if (scenario === 'verify-blocked') {
    const totalBitmapSoundTags = 3;
    const checkedTags = 2;
    const counts = { embedded: 2, external: 4, embeddedInBounds: 1, embeddedOutOfBounds: 1, overlapping: 2, unreadable: 0, blockedTags: 1 };
    return {
      ok: true,
      mapLabel: 'yoyorast island',
      totalBitmapSoundTags,
      checkedTags,
      counts,
      reportText: [
        'Embedded data verification - "yoyorast island"',
        `${totalBitmapSoundTags} bitmap/sound tags total, ${checkedTags} checked, ${counts.blockedTags} blocked.`,
        `${counts.embedded} embedded asset(s), ${counts.external} external (resource-map) asset(s).`,
        `Embedded: ${counts.embeddedInBounds} in bounds, ${counts.embeddedOutOfBounds} OUT OF BOUNDS, ${counts.overlapping} overlapping, ${counts.unreadable} unreadable.`,
        '',
        'BLOCKED (unrecognized layout - not guessed):',
        '  "levels\\test\\custom\\weapons\\custom_rifle" (bitmap) - Unrecognized tag class. Not guessed.',
        '',
        'PROBLEMS FOUND:',
        '  "levels\\test\\custom\\bitmaps\\muzzle_flash" bitmap data[0].pixel data (embedded, offset 9999999, 4096 bytes) - OUT OF BOUNDS',
        '  "levels\\test\\custom\\bitmaps\\scope_lens" bitmap data[0].pixel data (embedded, offset 512, 2048 bytes) - overlaps with: levels\\test\\custom\\bitmaps\\scope_frame bitmap data[0].pixel data',
        '',
      ].join('\n'),
    };
  }
  const totalBitmapSoundTags = 251;
  const checkedTags = 251;
  const counts = { embedded: 0, external: 575, embeddedInBounds: 0, embeddedOutOfBounds: 0, overlapping: 0, unreadable: 0, blockedTags: 0 };
  return {
    ok: true,
    mapLabel: 'ui',
    totalBitmapSoundTags,
    checkedTags,
    counts,
    reportText: [
      'Embedded data verification - "ui"',
      `${totalBitmapSoundTags} bitmap/sound tags total, ${checkedTags} checked, ${counts.blockedTags} blocked.`,
      `${counts.embedded} embedded asset(s), ${counts.external} external (resource-map) asset(s).`,
      `Embedded: ${counts.embeddedInBounds} in bounds, ${counts.embeddedOutOfBounds} OUT OF BOUNDS, ${counts.overlapping} overlapping, ${counts.unreadable} unreadable.`,
      '',
      'No bounds, overlap, or readability problems found among the checked assets.',
      '',
      'No embedded (external=0) bitmap/sound data in this map - everything routes through bitmaps.map/sounds.map.',
    ].join('\n'),
  };
}

/* ------------------------- Converter Phase 1 (?mock=convert-retail / convert-scripts) ------------------------- */

/** A pre-flight report shaped like the real one for heh_2.map (values measured on the real file); `withScripts` adds the acknowledgement case. */
export function buildMockConvertReport(withScripts: boolean): RetailConversionReport {
  const check = (id: RetailConversionReport['checks'][number]['id'], label: string, status: 'pass' | 'warn' | 'refuse' | 'info', message: string, details: string[] = [], requiresAcknowledgement = false) => ({
    id,
    label,
    status,
    message,
    details,
    requiresAcknowledgement,
  });
  const checks = [
    check('layout', 'Retail-layout map (cache version 7)', 'pass', 'Standard header, cache version 7.'),
    check('fileSize', 'File size matches the header', 'pass', '14458336 bytes.'),
    check('padding', 'Header padding length is 0', 'pass', 'Same as Custom Edition maps.'),
    check('tagDataAddress', 'Tag data at the Custom Edition address', 'pass', 'Tag array pointer 0x40440028 (base 0x40440000).'),
    check('entryFlags', 'No tag is marked external', 'pass', 'All 2410 tag entries have 0 at +0x18 and +0x1C, so every tag is inside the map.'),
    check('regions', 'BSP, model data and tag data are inside the file', 'pass', 'New CRC32 0xD1C331E9 (was 0x0).'),
    check('modelParts', "Models pass OpenCE's part check", 'pass', '70 models, 447 parts: every part passes.'),
    withScripts
      ? check('scripts', 'Scripts that may call the wrong function in Custom Edition', 'warn', "The scenario's 1 script(s) and 0 global(s) make 23 function call(s) (3 different functions). (mock)", ['function #5: 10 call(s)', 'function #114: 12 call(s)', 'function #493: 1 call(s)'], true)
      : check('scripts', 'Scripts that may call the wrong function in Custom Edition', 'pass', 'The scenario has no scripts and no script globals, so no script function numbers are involved.'),
    check('validation', 'Every tag reads cleanly with the Custom Edition definitions', 'pass', '2410 tags checked, 0 problems.'),
    check('referenceIdentity', "Tag references carry their tag's exact ID and path pointer", 'warn', '1 reference points at a tag with an outdated tag ID or path pointer, most likely left over from the demo version of this map. (mock)', [
      'levels\test\bloodgulch\bloodgulch.scenario_structure_bsp.sound environment palette[0].sound environment: tag ID 0xEADF0969 (tag entry 0xEADD0969), path pointer 0x4BF3ED7B (tag entry 0x4046ED7B)',
    ]),
    check('requiredTags', 'Tags Custom Edition requires are present', 'pass', 'All 10 required tags are in the map.'),
    check('injectAfterwards', 'Inject Tags can add tags to the converted map', 'warn', 'Inject Tags will refuse to add new tags to the converted map. (mock)'),
    check('scenarioName', 'Internal map name', 'info', 'The internal name is "heh_2". It is set from the output file name when the converted map is saved, so the two always match.'),
    check('tagFileChecksum', 'Tag-file checksum left unchanged', 'info', "The tag data header's tag-file checksum (0x5E2AF81E) is kept, as File > Save does."),
  ];
  return { canConvert: true, requiresAcknowledgement: withScripts, checks, scenarioName: 'heh_2', buildString: '01.00.00.0576', mapType: 1, tagCount: 2410, previousCrc32: 0, newCrc32: 0xd1c331e9, externalData: null, estimatedOutputSize: null, repairs: [] };
}

/**
 * The Phase 1c rows (`tagBlockAlignment` and the required `alignTagData` repair) as the real
 * pre-flight gives them; values measured on the real files (core align-tag-data.real-map.test.ts).
 */
function mockAlignmentRows(v: { blocks: number; bspBlocks: number; roots: number; data: number; remainder: number; bytes: number; at: string; moved: string; tolerated: string[] }): RetailConversionReport['checks'] {
  const n = (x: number) => x.toLocaleString('en-US');
  return [
    {
      id: 'tagBlockAlignment',
      label: 'Tag blocks are 4-aligned (OpenCE skips unaligned blocks)',
      status: 'warn',
      message: `${n(v.blocks)} blocks in the tag data and ${n(v.bspBlocks)} in the structure BSP(s) checked the way OpenCE reads them: ${n(v.blocks)} of ${n(v.blocks)} tag data blocks (and ${n(v.roots)} of ${n(v.roots)} tags, ${n(v.data)} of ${n(v.data)} data blocks) start ${v.remainder} mod 4. OpenCE skips such blocks without a message (its sound conversion and HUD passes don't run on them). Fixed by the required repair below. (mock)`,
      details: v.tolerated,
      requiresAcknowledgement: false,
    },
    {
      id: 'repairAlignTagData',
      label: 'Repair: align the tag data',
      status: 'warn',
      message: `OpenCE needs this repair: it skips every block that is not 4-aligned without a message, so this map's Ogg Vorbis sounds (player deaths, the announcer, the plasma overheat) play as noise and its weapon HUD is drawn twice too large with the wrong meter channels. The repair inserts zero bytes after the tag names and moves every pointer past them, so every tag and block starts 4-aligned, as in Custom Edition maps. Path strings, BSPs and model data don't move. Convert stays off while this is unticked. Adds ${v.bytes} bytes. (mock)`,
      details: [`Inserts ${v.bytes} zero byte(s) at ${v.at} (the end of the tag names) and moves ${v.moved} pointers past it by ${v.bytes}.`],
      requiresAcknowledgement: false,
      repair: { id: 'alignTagData', required: true },
    },
  ];
}

/**
 * ?mock=convert-align: HaloMD heh_2 (with its resource files) as the real pre-flight gives it since
 * Phase 1c: the alignment rows and no other repair (its script data is aligned by the alignment).
 */
export function buildMockAlignConvertReport(): RetailConversionReport {
  const base = buildMockConvertReport(false);
  const at = base.checks.findIndex((c) => c.id === 'regions') + 1;
  const rows = mockAlignmentRows({
    blocks: 6982,
    bspBlocks: 386,
    roots: 2409,
    data: 2052,
    remainder: 2,
    bytes: 2,
    at: '0x4046ED9E',
    moved: '11,443',
    tolerated: [
      'levels\\test\\bloodgulch\\bloodgulch.sound environment palette[0].sound environment: path pointer 0x4BF3ED7B is outside the tag data (a stale leftover; the game never follows it), left as it is.',
    ],
  });
  return { ...base, checks: [...base.checks.slice(0, at), ...rows, ...base.checks.slice(at)], newCrc32: null, estimatedOutputSize: 70_827_480, repairs: [{ id: 'alignTagData', required: true, tagPath: '(all tags)', bytesAdded: 2 }] };
}

/**
 * ?mock=convert-repairs: the tag data rows as the real pre-flight gives them for HaloMD theisland_3
 * (values measured on the real file): the alignment, then the script syntax data, which overlaps other
 * tags. `required: false` gives the optional (used nodes) form of the script repair, without the
 * alignment rows.
 */
export function buildMockRepairConvertReport(required = true): RetailConversionReport {
  const base = buildMockConvertReport(false);
  const at = base.checks.findIndex((c) => c.id === 'regions') + 1;
  const alignment = required
    ? mockAlignmentRows({
        blocks: 7578,
        bspBlocks: 1349,
        roots: 2601,
        data: 2066,
        remainder: 2,
        bytes: 2,
        at: '0x404766D6',
        moved: '12,245',
        tolerated: [
          'levels\\test\\bloodgulch\\bloodgulch.scenario.scenery palette[14].name: path pointer 0x4BF243BC is outside the tag data (a stale leftover; the game never follows it), left as it is.',
          'vehicles\\banshee\\banshee_mp.weapons[0].weapon: path pointer 0x4BF2D0A9 is outside the tag data (a stale leftover; the game never follows it), left as it is.',
        ],
      })
    : [];
  const extents = required
    ? {
        id: 'tagDataExtents' as const,
        label: "Tag blocks are inside the tag data and don't overlap",
        status: 'warn' as const,
        message: '13,717 blocks in 2601 tags and 1 structure BSP(s) checked the way OpenCE checks them: 1 problem(s). OpenCE refuses a map with any of these; each is fixed by a required repair below. (mock)',
        details: ['#0 levels\test\bloodgulch\bloodgulch script syntax data: 380,076 bytes at 0x404864FE overlap other tags (mock)'],
        requiresAcknowledgement: false,
      }
    : {
        id: 'tagDataExtents' as const,
        label: "Tag blocks are inside the tag data and don't overlap",
        status: 'pass' as const,
        message: '13,717 blocks in 2601 tags and 1 structure BSP(s) checked the way OpenCE checks them: no problems. (mock)',
        details: [],
        requiresAcknowledgement: false,
      };
  const repair = {
    id: 'repairScriptSyntaxData' as const,
    label: 'Repair: move the script data to its own block',
    status: required ? ('warn' as const) : ('info' as const),
    message: required
      ? `OpenCE refuses this map without this repair: the scenario's script data overlaps other tags or is not 4-aligned, and OpenCE stops loading at "the scenario's script data is missing or damaged" (a blue screen). The repair gives it a 4-aligned block of its own at the end of the tag data, with its header and used script nodes copied and the rest zero. Convert stays off while this is unticked. Adds 380,076 bytes. (mock)`
      : "OpenCE runs none of this map's scripts because the script data is not 4-aligned. The repair moves it to an aligned block at the end of the tag data. Optional: the map loads either way. Adds 380,078 bytes. (mock)",
    details: ['Only the first 346,620 of its 380,076 bytes are its own; the rest belongs to other tags. 0 of 19,001 node slots are used (56 bytes with the header), so everything in use fits. (mock)'],
    requiresAcknowledgement: false,
    repair: { id: 'scriptSyntaxData' as const, required },
  };
  const checks = [...base.checks.slice(0, at), ...alignment, extents, repair, ...base.checks.slice(at)];
  return {
    ...base,
    checks,
    scenarioName: 'bloodgulch',
    tagCount: 2601,
    newCrc32: null,
    estimatedOutputSize: required ? 105_728_562 : null,
    repairs: [
      ...(required ? [{ id: 'alignTagData' as const, required: true, tagPath: '(all tags)', bytesAdded: 2 }] : []),
      { id: 'scriptSyntaxData', required, tagPath: 'levels\\test\\bloodgulch\\bloodgulch', bytesAdded: required ? 380_076 : 380_078 },
    ],
  };
}

/**
 * ?mock=convert-model-parts: HaloMD theisland_3 as the real pre-flight gives it since 2026-10-12: the
 * repairs as in ?mock=convert-repairs, and the model part row refuses (OpenCE stops at model #2574).
 * Detail lines measured on the real file (the second one shortened).
 */
export function buildMockModelPartsConvertReport(): RetailConversionReport {
  const base = buildMockRepairConvertReport();
  const row = {
    id: 'modelParts' as const,
    label: "Models pass OpenCE's part check",
    status: 'refuse' as const,
    message:
      '82 models, 506 parts: 2 parts of 1 model fail. OpenCE stops loading a map with such a part ("names a node, vertex, shader or part that does not exist"), so the map is not converted. Repairing them is not supported yet. (mock)',
    details: [
      '#2574 effects\\debris objects\\forerunner dark structure\\forerunner dark structure: geometry 0 part 0: 2 of 104 strip indices are past its 70 vertices (value@position: 70@100, 71@102)',
      '#2574 effects\\debris objects\\forerunner dark structure\\forerunner dark structure: geometry 1 part 0: 33 of 66 strip indices are past its 44 vertices (value@position: 570@0, 570@1, 571@2, 571@3, 267@4, ...)',
    ],
    requiresAcknowledgement: false,
  };
  const checks = base.checks.map((c) => (c.id === 'modelParts' ? row : c));
  return { ...base, canConvert: false, checks };
}
