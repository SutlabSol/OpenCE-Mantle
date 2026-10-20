// @vitest-environment node
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { inspectCustomEditionMap, encodePcmToWav } from '../../../core/src/index';
import {
  __setCurrentMapForTest,
  __setSinkForTest,
  runGetSoundInfo,
  runGetSoundWav,
  runExportSound,
  runReplaceSound,
} from '../map-worker';
import type {
  GetSoundInfoResult,
  GetSoundWavResult,
  ExportSoundResult,
  ReplaceSoundResult,
} from '../shared-types';

const SAMPLE_MAPS_DIR = process.env.SAMPLE_MAPS_DIR
  ? path.resolve(process.env.SAMPLE_MAPS_DIR)
  : path.resolve(__dirname, '../../../sample_maps');

const bgPath = path.join(SAMPLE_MAPS_DIR, 'bloodgulch.map');
const soundsPath = path.join(SAMPLE_MAPS_DIR, 'sounds.map');
const hasBg = fs.existsSync(bgPath) && fs.existsSync(soundsPath);

type Msg = { type: string; requestId?: string; payload?: unknown; code?: string; message?: string };
let messages: Msg[] = [];

async function call<T = unknown>(fn: (task: any) => unknown, task: Record<string, unknown> = {}): Promise<T> {
  const requestId = randomUUID();
  messages = [];
  await fn({ requestId, ...task });
  const err = messages.find((m) => m.type === 'error' && m.requestId === requestId);
  if (err) {
    console.error('Call failed with error:', err);
    throw Object.assign(new Error(err.message), { code: err.code });
  }
  const res = messages.find((m) => m.type === 'result' && m.requestId === requestId);
  if (!res) throw new Error('no result');
  return res.payload as T;
}

describe.skipIf(!hasBg)('map-worker: Sound Audition & Injector (Milestone 13.2)', () => {
  let tmpDir: string;

  beforeAll(() => {
    __setSinkForTest((m) => messages.push(m as Msg));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opence-sound-test-'));
  });

  beforeEach(() => {
    messages = [];
    const buf = Buffer.from(fs.readFileSync(bgPath));
    const inspected = inspectCustomEditionMap(buf);
    if (inspected.status !== 'ok') throw new Error('parse failed');
    __setCurrentMapForTest({
      filePath: bgPath,
      buffer: buf,
      header: inspected.header,
      tagIndex: inspected.tagIndex,
      modified: false,
    });
  });

  it('inspects a sound tag and returns pitch ranges and permutations', async () => {
    const buf = fs.readFileSync(bgPath);
    const inspected = inspectCustomEditionMap(buf);
    if (inspected.status !== 'ok') throw new Error('parse failed');
    const sndTag = inspected.tagIndex.entries.find((e) => e.primaryClassName === 'sound');
    expect(sndTag).toBeDefined();

    const res = await call<GetSoundInfoResult>(runGetSoundInfo, {
      tagIndex: sndTag!.index,
      soundsPath,
    });

    expect(res.ok).toBe(true);
    expect(res.summary).toBeDefined();
    expect(res.summary!.pitchRanges.length).toBeGreaterThan(0);
    expect(res.summary!.pitchRanges[0].permutations.length).toBeGreaterThan(0);
    expect(res.summary!.pitchRanges[0].permutations[0].sampleSize).toBeGreaterThan(0);
  });

  it('decodes permutation audio to base64 WAV dataUrl for audition playback', async () => {
    const buf = fs.readFileSync(bgPath);
    const inspected = inspectCustomEditionMap(buf);
    if (inspected.status !== 'ok') throw new Error('parse failed');
    const sndTag = inspected.tagIndex.entries.find((e) => e.primaryClassName === 'sound');
    expect(sndTag).toBeDefined();

    const res = await call<GetSoundWavResult>(runGetSoundWav, {
      tagIndex: sndTag!.index,
      pitchRangeIndex: 0,
      permutationIndex: 0,
      soundsPath,
    });

    expect(res.ok).toBe(true);
    expect(res.sampleRate).toBeGreaterThan(0);
    expect(res.channels).toBeGreaterThan(0);
    expect(res.durationSeconds).toBeGreaterThan(0);
    expect(res.dataUrl).toMatch(/^data:audio\/wav;base64,/);
  });

  it('exports a permutation to WAV file on disk', async () => {
    const buf = fs.readFileSync(bgPath);
    const inspected = inspectCustomEditionMap(buf);
    if (inspected.status !== 'ok') throw new Error('parse failed');
    const sndTag = inspected.tagIndex.entries.find((e) => e.primaryClassName === 'sound');
    expect(sndTag).toBeDefined();

    const outWav = path.join(tmpDir, 'audition_export.wav');
    const res = await call<ExportSoundResult>(runExportSound, {
      tagIndex: sndTag!.index,
      pitchRangeIndex: 0,
      permutationIndex: 0,
      outputPath: outWav,
      soundsPath,
    });

    expect(res.ok).toBe(true);
    expect(fs.existsSync(outWav)).toBe(true);
    const fileBytes = fs.readFileSync(outWav);
    expect(fileBytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(fileBytes.toString('ascii', 8, 12)).toBe('WAVE');
  });

  it('replaces a permutation with a new WAV and internalizes it into the map', async () => {
    const buf = fs.readFileSync(bgPath);
    const inspected = inspectCustomEditionMap(buf);
    if (inspected.status !== 'ok') throw new Error('parse failed');
    const sndTag = inspected.tagIndex.entries.find((e) => e.primaryClassName === 'sound');
    expect(sndTag).toBeDefined();

    // Create a 0.25 second sine wave PCM
    const sampleRate = 22050;
    const sampleCount = Math.floor(sampleRate * 0.25);
    const pcm = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 16000);
    }
    const wavBytes = encodePcmToWav(pcm, sampleRate, 1);
    const inWav = path.join(tmpDir, 'custom_beep.wav');
    fs.writeFileSync(inWav, wavBytes);

    const res = await call<ReplaceSoundResult>(runReplaceSound, {
      tagIndex: sndTag!.index,
      pitchRangeIndex: 0,
      permutationIndex: 0,
      inputPath: inWav,
      soundsPath,
    });

    expect(res.ok).toBe(true);
    expect(res.map).toBeDefined();
    expect(res.map!.modified).toBe(true);

    // Verify permutation is now internalized (isExternal is false)
    const updatedInfo = await call<GetSoundInfoResult>(runGetSoundInfo, {
      tagIndex: sndTag!.index,
    });
    expect(updatedInfo.ok).toBe(true);
    const updatedPerm = updatedInfo.summary!.pitchRanges[0].permutations[0];
    expect(updatedPerm.isExternal).toBe(false);

    // Verify getting WAV again decodes the replaced audio
    const wavRes = await call<GetSoundWavResult>(runGetSoundWav, {
      tagIndex: sndTag!.index,
      pitchRangeIndex: 0,
      permutationIndex: 0,
    });
    expect(wavRes.ok).toBe(true);
    expect(wavRes.sampleRate).toBe(sampleRate);
    expect(wavRes.durationSeconds).toBeCloseTo(0.25, 1);
  });
});
