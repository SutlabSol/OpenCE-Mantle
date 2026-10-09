import type { DependencyWalkSummary, DependencyTagInfo, DependencyNotExtractedInfo, DependencyWarningInfo } from '../../electron/shared-types';

/**
 * Realistic dependency-walk fixtures shared between `dev-mock.ts` (Vite browser preview) and
 * the DependencyDialog/TagBrowser component tests, so both exercise the exact same data shapes.
 */
export const MOCK_SCENARIOS = ['clean', 'scenario-bsp', 'external-data', 'spheroid', 'bsp-only', 'large-list', 'deps-error', 'extract-error', 'slow-progress'] as const;
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
