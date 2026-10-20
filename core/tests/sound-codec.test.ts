import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { sampleMapPath, hasSampleMap } from './helpers/sample-maps';
import { inspectCustomEditionMap } from '../src/map/open-map';
import {
  encodePcmToWav,
  decodeWavToPcm,
  encodeXboxAdpcmMono,
  decodeXboxAdpcmMono,
  inspectSoundTag,
  decodeSoundPermutationPcm,
  replaceSoundPermutationData,
  SoundFormat,
} from '../src/render/sound-codec';

describe('Sound Codec Unit Tests (sound-codec)', () => {
  describe('WAV Encoding & Decoding Roundtrip', () => {
    it('encodes and decodes 16-bit PCM WAV container with exact fidelity', () => {
      const sampleRate = 22050;
      const channels = 1;
      const pcm = new Int16Array(100);
      for (let i = 0; i < pcm.length; i++) {
        pcm[i] = Math.round(Math.sin((i / 100) * Math.PI * 2) * 20000);
      }

      const wav = encodePcmToWav(pcm, sampleRate, channels);
      expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
      expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
      expect(wav.toString('ascii', 12, 16)).toBe('fmt ');

      const decoded = decodeWavToPcm(wav);
      expect(decoded.sampleRate).toBe(sampleRate);
      expect(decoded.channels).toBe(channels);
      expect(decoded.pcmSamples.length).toBe(pcm.length);
      expect(decoded.pcmSamples).toEqual(pcm);
    });
  });

  describe('Xbox ADPCM Encoding & Decoding', () => {
    it('encodes linear PCM to Xbox ADPCM and decodes back with close waveform shape', () => {
      // 64 samples (exactly 1 Xbox ADPCM block = 36 bytes)
      const pcm = new Int16Array(64);
      for (let i = 0; i < pcm.length; i++) {
        pcm[i] = Math.round(Math.sin((i / 64) * Math.PI * 2) * 15000);
      }

      const adpcm = encodeXboxAdpcmMono(pcm);
      expect(adpcm.length).toBe(36);

      const decoded = decodeXboxAdpcmMono(adpcm, 0, 36);
      expect(decoded.length).toBe(64);

      // Verify general waveform direction matches
      expect(decoded[0]).toBe(pcm[0]);
      expect(decoded[16]).toBeGreaterThan(8000); // peak
      expect(decoded[48]).toBeLessThan(-8000); // trough
    });
  });

  describe('Sample Map Sound Inspection & Audition', () => {
    const haveBg = hasSampleMap('bloodgulch.map');
    const haveSounds = hasSampleMap('sounds.map');

    it.skipIf(!haveBg || !haveSounds)('inspects a real sound tag in bloodgulch.map and sounds.map', () => {
      const buf = fs.readFileSync(sampleMapPath('bloodgulch.map'));
      const soundsBuf = fs.readFileSync(sampleMapPath('sounds.map'));
      const inspected = inspectCustomEditionMap(buf);
      if (inspected.status !== 'ok') throw new Error('parse failed');

      // Find teleporter loop sound
      const sndEntry = inspected.tagIndex.entries.find((e) => e.path.includes('enter_water') || e.primaryClassName === 'sound');
      expect(sndEntry).toBeDefined();

      const summary = inspectSoundTag(buf, inspected.header, inspected.tagIndex, sndEntry!.tagId, soundsBuf);
      expect(summary.tagId).toBe(sndEntry!.tagId);
      expect(summary.pitchRanges.length).toBeGreaterThan(0);
      expect(summary.pitchRanges[0].permutations.length).toBeGreaterThan(0);
      expect(summary.pitchRanges[0].permutations[0].sampleSize).toBeGreaterThan(0);
    });

    it.skipIf(!haveBg || !haveSounds)('decodes audio samples to PCM and encodes to playable WAV', () => {
      const buf = fs.readFileSync(sampleMapPath('bloodgulch.map'));
      const soundsBuf = fs.readFileSync(sampleMapPath('sounds.map'));
      const inspected = inspectCustomEditionMap(buf);
      if (inspected.status !== 'ok') throw new Error('parse failed');

      const sndEntry = inspected.tagIndex.entries.find((e) => e.path.includes('enter_water') || e.primaryClassName === 'sound');
      expect(sndEntry).toBeDefined();

      const audio = decodeSoundPermutationPcm(buf, inspected.header, inspected.tagIndex, sndEntry!.tagId, 0, 0, soundsBuf);
      expect(audio.pcmSamples.length).toBeGreaterThan(0);
      expect(audio.durationSeconds).toBeGreaterThan(0);

      const wav = encodePcmToWav(audio.pcmSamples, audio.sampleRate, audio.channels);
      expect(wav.length).toBe(44 + audio.pcmSamples.length * 2);
    });

    it.skipIf(!haveBg || !haveSounds)('replaces sound permutation audio, internalizes, and updates tag headers', () => {
      const buf = Buffer.from(fs.readFileSync(sampleMapPath('bloodgulch.map')));
      const soundsBuf = fs.readFileSync(sampleMapPath('sounds.map'));
      const inspected = inspectCustomEditionMap(buf);
      if (inspected.status !== 'ok') throw new Error('parse failed');

      const sndEntry = inspected.tagIndex.entries.find((e) => e.path.includes('enter_water') || e.primaryClassName === 'sound');
      expect(sndEntry).toBeDefined();

      // Create fake 72-byte Xbox ADPCM sound payload (2 blocks)
      const fakeSamples = new Uint8Array(72).fill(0x55);

      const updated = replaceSoundPermutationData(
        buf,
        inspected.header,
        inspected.tagIndex,
        sndEntry!.tagId,
        0,
        0,
        fakeSamples,
        SoundFormat.XboxADPCM,
        soundsBuf,
      );

      const newSummary = inspectSoundTag(updated, inspected.header, inspected.tagIndex, sndEntry!.tagId, soundsBuf);
      const perm = newSummary.pitchRanges[0].permutations[0];
      expect(perm.sampleSize).toBe(72);
      expect(perm.isExternal).toBe(false); // Internalized
    });
  });
});
