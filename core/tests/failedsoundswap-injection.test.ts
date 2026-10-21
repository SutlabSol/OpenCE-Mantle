import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { collectTagDataPointers, tagDataLayoutOf } from '../src/map/pointer-rebase';
import { planInjection } from '../src/map/tag-injector';
import { extractTagSet } from '../src/map/tag-extractor';
import { serializeContainer, deserializeContainer } from '../src/map/container';

const SAMPLE_MAPS_DIR = path.resolve(__dirname, '../../sample_maps');
const FAILED_SOUND_MAP = path.join(SAMPLE_MAPS_DIR, 'the failed conversion', 'failedsoundswap.map');
const BG_MAP = path.join(SAMPLE_MAPS_DIR, 'bloodgulch.map');

describe('Sound Swap Tag Injection (failedsoundswap.map)', () => {
  it('collects pointers and plans injection without crashing on null promotion sound path pointers', () => {
    if (!fs.existsSync(FAILED_SOUND_MAP) || !fs.existsSync(BG_MAP)) {
      console.warn('failedsoundswap.map or bloodgulch.map not found, skipping');
      return;
    }

    const targetBuf = fs.readFileSync(FAILED_SOUND_MAP);
    const targetInsp = inspectCustomEditionMap(targetBuf);
    expect(targetInsp.status).toBe('ok');
    if (targetInsp.status !== 'ok') return;

    // 1. collectTagDataPointers should succeed on the target map
    const pointers = collectTagDataPointers(targetBuf, tagDataLayoutOf(targetInsp.header, targetInsp.tagIndex), {
      tolerate: { staleReferencePaths: true },
    });
    expect(pointers.length).toBeGreaterThan(0);

    // 2. planInjection into failedsoundswap.map should succeed
    const bgBuf = fs.readFileSync(BG_MAP);
    const bgInsp = inspectCustomEditionMap(bgBuf);
    expect(bgInsp.status).toBe('ok');
    if (bgInsp.status !== 'ok') return;

    const warthogEntry = bgInsp.tagIndex.entries.find(
      (e) => e.path.includes('mp_warthog') && e.primaryClassName === 'vehicle',
    );
    expect(warthogEntry).toBeDefined();

    const set = extractTagSet(bgBuf, bgInsp.header, bgInsp.tagIndex, [warthogEntry!.index]);
    const container = deserializeContainer(serializeContainer(set, 'bloodgulch'));

    const plan = planInjection('ADD', {
      buffer: targetBuf,
      header: targetInsp.header,
      tagIndex: targetInsp.tagIndex,
    }, container);

    expect(plan.kind).toBe('ok');
  });
});
