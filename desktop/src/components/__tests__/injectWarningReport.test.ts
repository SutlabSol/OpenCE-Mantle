import { describe, it, expect } from 'vitest';
import { buildInjectWarningReport } from '../injectWarningReport';
import type { InjectPlanSummary } from '../../../electron/shared-types';

function basePlan(overrides: Partial<InjectPlanSummary> = {}): InjectPlanSummary {
  return {
    mode: 'add',
    containerPath: 'C:\\x.ocetags',
    sourceMapName: 'ui',
    counts: { totalInClosure: 0, reused: 0, swapped: 0, added: 0, blockedEmbedded: 0, blockedOther: 0, externalReferenced: 0 },
    toAdd: [],
    toSwap: [],
    reused: [],
    blockedEmbedded: [],
    blockedOther: [],
    externalRefStatuses: [],
    refusedRoots: [],
    ...overrides,
  };
}

describe('buildInjectWarningReport', () => {
  it('includes mode, counts, and says there is nothing to report when the plan is clean', () => {
    const report = buildInjectWarningReport(basePlan({ mode: 'swap', counts: { totalInClosure: 1, reused: 1, swapped: 0, added: 0, blockedEmbedded: 0, blockedOther: 0, externalReferenced: 0 } }));
    expect(report).toContain('"ui" (swap mode)');
    expect(report).toContain('0 to add, 0 to swap, 1 reused, 0 blocked');
    expect(report).toContain('(no warnings or blocked tags)');
  });

  it('lists refused roots, blocked embedded, blocked other, and external ref statuses with path/category/reason', () => {
    const plan = basePlan({
      refusedRoots: [{ path: 'ui\\gamespy', reasons: ['Depends on "fonts\\missing" which is not present.'] }],
      blockedEmbedded: [{ path: 'sky\\space\\bitmaps\\star', group: 'bitmap', reasons: ['Relocation of embedded data is disabled this milestone.'] }],
      blockedOther: [{ path: 'weapons\\frag grenade\\bitmaps\\frag grenade', group: 'bitmap', reasons: ['The existing tag in the target is a resource-map-indexed (external) entry.'] }],
      externalRefStatuses: [{ path: 'sky\\space\\bitmaps\\star mask', group: 'bitmap', resourceMap: 'bitmaps.map', status: 'mismatch' }],
    });
    const report = buildInjectWarningReport(plan);
    expect(report).toContain('REFUSED (root selection): "ui\\gamespy" - Depends on "fonts\\missing" which is not present.');
    expect(report).toContain('BLOCKED (embedded data): "sky\\space\\bitmaps\\star" (bitmap) - Relocation of embedded data is disabled this milestone.');
    expect(report).toContain('BLOCKED (other): "weapons\\frag grenade\\bitmaps\\frag grenade" (bitmap) - The existing tag in the target is a resource-map-indexed (external) entry.');
    expect(report).toContain('EXTERNAL REFERENCE (mismatch): "sky\\space\\bitmaps\\star mask" needs bitmaps.map');
    expect(report).not.toContain('no warnings or blocked tags');
  });

  it('joins multiple reasons for the same tag with a semicolon', () => {
    const plan = basePlan({ blockedOther: [{ path: 'a\\b', group: 'font', reasons: ['reason one.', 'reason two.'] }] });
    const report = buildInjectWarningReport(plan);
    expect(report).toContain('BLOCKED (other): "a\\b" (font) - reason one.; reason two.');
  });
});
