import type { DependencyWalkSummary, DependencyTagInfo, DependencyNotExtractedInfo, DependencyWarningInfo, InjectPlanSummary, InjectionMode, VerifyEmbeddedDataResult } from '../../electron/shared-types';

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
      message: '"weapons\\assault rifle\\assault rifle.triggers" (2 x "WeaponTrigger") resolves outside this file (pointer base -4096) - unrecognized/corrupt layout, not walked further.',
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
