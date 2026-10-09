import { describe, expect, it } from 'vitest';
import { relocateEmbeddedRawData } from '../src/map/tag-injector';

/**
 * SYNTHETIC ONLY - explicitly NOT "verified against real bytes". Neither sample map contains a
 * single real embedded (external=0) bitmap/sound asset (scanned: 222 internal ui.map bitmaps +
 * 125 ui.map sound permutations, 100% external=1; bloodgulch.map has zero internal bitmap/sound
 * tags). `relocateEmbeddedRawData` stays disabled and unreachable from `planAddInjection`/
 * `applyAddInjection` until a real embedded asset can be located and relocation verified against
 * it - see tag-injector.ts's module doc for why this can't be derived from a compiled map alone
 * (the raw-data region's start isn't stored anywhere in the file). These tests only confirm the
 * function is a deliberate, explicit stub - never silently enabled.
 */
describe('relocateEmbeddedRawData (SYNTHETIC/disabled - not verified against real bytes)', () => {
  it('throws unconditionally - relocation must never run until explicitly re-enabled after real-byte verification', () => {
    expect(() => relocateEmbeddedRawData()).toThrow(/disabled this milestone/);
  });
});
