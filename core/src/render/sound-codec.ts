import { CacheFileHeader } from '../map/header';
import { TagIndex, resolveTagDataPointer } from '../map/tag-index';
import { parseResourceMap } from '../map/resource-map';
import { CorruptMapError } from '../map/errors';

export class SoundCodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SoundCodecError';
  }
}

export enum SoundFormat {
  PCM16 = 0,
  XboxADPCM = 1,
  ImaADPCM = 2,
  OggVorbis = 3,
}

export const SOUND_FORMAT_NAMES: Record<number, string> = {
  [SoundFormat.PCM16]: '16-bit PCM',
  [SoundFormat.XboxADPCM]: 'Xbox ADPCM',
  [SoundFormat.ImaADPCM]: 'IMA ADPCM',
  [SoundFormat.OggVorbis]: 'Ogg Vorbis',
};

export const SOUND_CLASS_NAMES: Record<number, string> = {
  0: 'Projectile Impact',
  1: 'Projectile Detonation',
  4: 'Weapon Fire',
  5: 'Weapon Ready',
  6: 'Weapon Reload',
  7: 'Weapon Empty',
  8: 'Weapon Charge',
  9: 'Weapon Overheat',
  10: 'Weapon Idle',
  13: 'Object Impacts',
  14: 'Particle Impacts',
  15: 'Slow Particle Impacts',
  18: 'Unit Footsteps',
  19: 'Unit Dialog',
  22: 'Vehicle Collision',
  23: 'Vehicle Engine',
  26: 'Device Door',
  27: 'Device Force Field',
  28: 'Device Machinery',
  29: 'Device Nature',
  30: 'Device Computers',
  32: 'Music',
  33: 'Ambient Nature',
  34: 'Ambient Machinery',
  35: 'Ambient Computers',
  39: 'First Person Damage',
  44: 'Scripted Dialog Player',
  45: 'Scripted Effect',
  46: 'Scripted Dialog Other',
  47: 'Scripted Dialog Force Unspatialized',
  50: 'Game Event',
};

export interface SoundPermutationInfo {
  index: number;
  name: string;
  skipFraction: number;
  gain: number;
  format: number;
  formatName: string;
  sampleSize: number;
  sampleOffset: number;
  isExternal: boolean;
  durationSeconds: number;
}

export interface SoundPitchRangeInfo {
  index: number;
  name: string;
  naturalPitch: number;
  bendBoundsMin: number;
  bendBoundsMax: number;
  permutations: SoundPermutationInfo[];
}

export interface SoundTagSummary {
  tagId: number;
  tagIndex: number;
  path: string;
  soundClass: number;
  soundClassName: string;
  channelCount: number; // 1 = mono, 2 = stereo
  sampleRate: number; // 22050 or 44100
  isExternal: boolean;
  pitchRanges: SoundPitchRangeInfo[];
}

/* --------------------------------- Xbox ADPCM Tables & Codec --------------------------------- */

const STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31,
  34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544,
  598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878,
  2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894,
  6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818,
  18500, 20350, 22385, 24623, 27086, 29794, 32767,
];

const INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

/**
 * Decodes mono Xbox ADPCM blocks into 16-bit linear PCM samples.
 */
export function decodeXboxAdpcmMono(buf: Uint8Array | Buffer, offset: number, size: number): Int16Array {
  const blocks = Math.floor(size / 36);
  const out = new Int16Array(blocks * 64);
  let outIdx = 0;

  for (let b = 0; b < blocks; b++) {
    const blockStart = offset + b * 36;
    let sample = buf[blockStart] | (buf[blockStart + 1] << 8);
    if (sample >= 0x8000) sample -= 0x10000;

    let stepIndex = Math.min(88, Math.max(0, buf[blockStart + 2]));
    out[outIdx++] = sample;

    for (let i = 0; i < 32; i++) {
      const byte = buf[blockStart + 4 + i];
      const nibbles = [byte & 0x0f, (byte >> 4) & 0x0f];

      for (const code of nibbles) {
        if (outIdx >= out.length) break;
        const step = STEP_TABLE[stepIndex];
        let diff = step >> 3;
        if (code & 4) diff += step;
        if (code & 2) diff += step >> 1;
        if (code & 1) diff += step >> 2;

        if (code & 8) sample -= diff;
        else sample += diff;

        sample = Math.max(-32768, Math.min(32767, sample));
        stepIndex = Math.max(0, Math.min(88, stepIndex + INDEX_TABLE[code]));
        out[outIdx++] = sample;
      }
    }
  }

  return out;
}

/**
 * Decodes stereo Xbox ADPCM blocks into interleaved 16-bit linear PCM samples.
 */
export function decodeXboxAdpcmStereo(buf: Uint8Array | Buffer, offset: number, size: number): Int16Array {
  const blocks = Math.floor(size / 72);
  const out = new Int16Array(blocks * 64 * 2);
  let outIdx = 0;

  for (let b = 0; b < blocks; b++) {
    const leftBlock = offset + b * 72;
    const rightBlock = leftBlock + 36;

    const leftSamples = decodeXboxAdpcmMono(buf, leftBlock, 36);
    const rightSamples = decodeXboxAdpcmMono(buf, rightBlock, 36);

    for (let i = 0; i < 64; i++) {
      out[outIdx++] = leftSamples[i];
      out[outIdx++] = rightSamples[i];
    }
  }

  return out;
}

/**
 * Encodes 16-bit mono PCM into Xbox ADPCM 36-byte blocks.
 */
export function encodeXboxAdpcmMono(pcm: Int16Array): Uint8Array {
  const numBlocks = Math.ceil(pcm.length / 64);
  const out = new Uint8Array(numBlocks * 36);
  let pcmIdx = 0;
  let stepIndex = 0;

  for (let b = 0; b < numBlocks; b++) {
    const blockStart = b * 36;
    let sample = pcmIdx < pcm.length ? pcm[pcmIdx++] : 0;

    out[blockStart + 0] = sample & 0xff;
    out[blockStart + 1] = (sample >> 8) & 0xff;
    out[blockStart + 2] = stepIndex & 0xff;
    out[blockStart + 3] = 0;

    for (let i = 0; i < 32; i++) {
      let byteVal = 0;
      for (let n = 0; n < 2; n++) {
        const curPcmIdx = pcmIdx;
        const nextSample = pcmIdx < pcm.length ? pcm[pcmIdx++] : sample;
        const lookaheadSample = curPcmIdx + 1 < pcm.length ? pcm[curPcmIdx + 1] : nextSample;
        let diff = nextSample - sample;
        let signBit = 0;
        if (diff < 0) {
          signBit = 8;
          diff = -diff;
        }

        const step = STEP_TABLE[stepIndex];
        let baseMag = 0;
        let rem = diff;
        if (rem >= step) {
          baseMag |= 4;
          rem -= step;
        }
        if (rem >= (step >> 1)) {
          baseMag |= 2;
          rem -= step >> 1;
        }
        if (rem >= (step >> 2)) {
          baseMag |= 1;
        }

        // Evaluate baseMag and neighbors (baseMag - 1, baseMag + 1) with 1-step lookahead
        let bestCode = signBit | baseMag;
        let bestScore = Number.POSITIVE_INFINITY;
        for (let dMag = -1; dMag <= 1; dMag++) {
          const candMag = Math.max(0, Math.min(7, baseMag + dMag));
          const candCode = signBit | candMag;
          let candDelta = step >> 3;
          if (candCode & 4) candDelta += step;
          if (candCode & 2) candDelta += step >> 1;
          if (candCode & 1) candDelta += step >> 2;
          const candPred = Math.max(-32768, Math.min(32767, (candCode & 8) ? sample - candDelta : sample + candDelta));
          const err0 = nextSample - candPred;
          const nextStepIdx = Math.max(0, Math.min(88, stepIndex + INDEX_TABLE[candCode]));
          const nextStep = STEP_TABLE[nextStepIdx];
          // Estimate 1-step lookahead tracking error
          const lookDiff = Math.abs(lookaheadSample - candPred);
          const maxReach = nextStep + (nextStep >> 1) + (nextStep >> 2) + (nextStep >> 3);
          const err1 = lookDiff > maxReach ? lookDiff - maxReach : 0;
          const score = err0 * err0 + 0.35 * (err1 * err1);
          if (score < bestScore) {
            bestScore = score;
            bestCode = candCode;
          }
        }

        const code = bestCode;
        let delta = step >> 3;
        if (code & 4) delta += step;
        if (code & 2) delta += step >> 1;
        if (code & 1) delta += step >> 2;

        if (code & 8) sample -= delta;
        else sample += delta;

        sample = Math.max(-32768, Math.min(32767, sample));
        stepIndex = Math.max(0, Math.min(88, stepIndex + INDEX_TABLE[code]));

        if (n === 0) byteVal |= code & 0x0f;
        else byteVal |= (code & 0x0f) << 4;
      }
      out[blockStart + 4 + i] = byteVal;
    }
  }

  return out;
}

/**
 * Encodes 16-bit interleaved stereo PCM into Xbox ADPCM 72-byte stereo blocks (36B Left + 36B Right per 64 frames).
 */
export function encodeXboxAdpcmStereo(pcm: Int16Array): Uint8Array {
  const numFrames = Math.floor(pcm.length / 2);
  const numBlocks = Math.ceil(numFrames / 64);
  const out = new Uint8Array(numBlocks * 72);
  let frameIdx = 0;

  for (let b = 0; b < numBlocks; b++) {
    const leftPcm = new Int16Array(64);
    const rightPcm = new Int16Array(64);
    let lastL = 0;
    let lastR = 0;
    for (let i = 0; i < 64; i++) {
      if (frameIdx < numFrames) {
        lastL = pcm[frameIdx * 2];
        lastR = pcm[frameIdx * 2 + 1];
        frameIdx++;
      }
      leftPcm[i] = lastL;
      rightPcm[i] = lastR;
    }
    const leftBlock = encodeXboxAdpcmMono(leftPcm);
    const rightBlock = encodeXboxAdpcmMono(rightPcm);
    out.set(leftBlock, b * 72);
    out.set(rightBlock, b * 72 + 36);
  }

  return out;
}

/**
 * Conforms decoded WAV PCM samples (channel count and sample rate) to match a target Halo Sound tag's format.
 */
export function conformPcmToSoundTag(
  pcmSamples: Int16Array,
  srcChannels: number,
  srcSampleRate: number,
  dstChannels: number,
  dstSampleRate: number,
): Int16Array {
  const safeSrcCh = Math.max(1, srcChannels);
  const safeDstCh = dstChannels === 2 ? 2 : 1;
  const srcFrames = Math.floor(pcmSamples.length / safeSrcCh);
  if (srcFrames === 0) return new Int16Array(0);

  // 1. Channel conversion (downmix or upmix)
  let chConverted: Int16Array;
  if (safeSrcCh === safeDstCh) {
    chConverted = pcmSamples;
  } else if (safeDstCh === 1) {
    chConverted = new Int16Array(srcFrames);
    for (let f = 0; f < srcFrames; f++) {
      let sum = 0;
      for (let c = 0; c < safeSrcCh; c++) {
        sum += pcmSamples[f * safeSrcCh + c];
      }
      chConverted[f] = Math.max(-32768, Math.min(32767, Math.round(sum / safeSrcCh)));
    }
  } else {
    // Mono -> Stereo
    chConverted = new Int16Array(srcFrames * 2);
    for (let f = 0; f < srcFrames; f++) {
      const s = pcmSamples[f * safeSrcCh];
      chConverted[f * 2] = s;
      chConverted[f * 2 + 1] = s;
    }
  }

  // 2. Sample rate conversion (linear interpolation per channel)
  const safeSrcRate = Math.max(1000, srcSampleRate);
  const safeDstRate = Math.max(1000, dstSampleRate);
  if (safeSrcRate === safeDstRate) {
    return chConverted;
  }

  const dstFrames = Math.max(1, Math.round((srcFrames * safeDstRate) / safeSrcRate));
  const resampled = new Int16Array(dstFrames * safeDstCh);
  const ratio = (srcFrames - 1) / Math.max(1, dstFrames - 1);

  for (let df = 0; df < dstFrames; df++) {
    const srcPos = df * ratio;
    const idx0 = Math.min(srcFrames - 1, Math.floor(srcPos));
    const idx1 = Math.min(srcFrames - 1, idx0 + 1);
    const frac = srcPos - idx0;

    for (let c = 0; c < safeDstCh; c++) {
      const s0 = chConverted[idx0 * safeDstCh + c];
      const s1 = chConverted[idx1 * safeDstCh + c];
      const val = Math.round(s0 + (s1 - s0) * frac);
      resampled[df * safeDstCh + c] = Math.max(-32768, Math.min(32767, val));
    }
  }

  return resampled;
}

/* --------------------------------- Standard WAV File Encoder --------------------------------- */

/**
 * Encodes 16-bit linear PCM samples into standard RIFF WAVE (.wav) container.
 */
export function encodePcmToWav(pcmSamples: Int16Array, sampleRate: number, channels: number): Buffer {
  const byteRate = sampleRate * channels * 2;
  const blockAlign = channels * 2;
  const dataSize = pcmSamples.length * 2;
  const totalSize = 36 + dataSize;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(totalSize, 4);
  header.write('WAVE', 8, 4, 'ascii');

  header.write('fmt ', 12, 4, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // format = 1 (PCM)
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34); // bits per sample

  header.write('data', 36, 4, 'ascii');
  header.writeUInt32LE(dataSize, 40);

  const dataBuffer = Buffer.from(pcmSamples.buffer, pcmSamples.byteOffset, pcmSamples.byteLength);
  return Buffer.concat([header, dataBuffer]);
}

/**
 * Decodes a RIFF WAVE (.wav) container into 16-bit linear PCM samples.
 * Supports 8-bit, 16-bit, 24-bit, 32-bit PCM and 32-bit IEEE Float WAV files.
 */
export function decodeWavToPcm(wavBuffer: Buffer): { sampleRate: number; channels: number; pcmSamples: Int16Array } {
  if (wavBuffer.length < 44 || wavBuffer.toString('ascii', 0, 4) !== 'RIFF' || wavBuffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new SoundCodecError('Invalid WAV file container.');
  }

  let offset = 12;
  let audioFormat = 1;
  let sampleRate = 22050;
  let channels = 1;
  let bitsPerSample = 16;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset + 8 <= wavBuffer.length) {
    const chunkId = wavBuffer.toString('ascii', offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);
    offset += 8;

    if (chunkId === 'fmt ' && offset + 16 <= wavBuffer.length) {
      audioFormat = wavBuffer.readUInt16LE(offset + 0);
      channels = wavBuffer.readUInt16LE(offset + 2);
      sampleRate = wavBuffer.readUInt32LE(offset + 4);
      bitsPerSample = wavBuffer.readUInt16LE(offset + 14);
      if (audioFormat === 0xfffe && chunkSize >= 40 && offset + 26 <= wavBuffer.length) {
        audioFormat = wavBuffer.readUInt16LE(offset + 24);
      }
    } else if (chunkId === 'data') {
      dataOffset = offset;
      dataSize = Math.min(chunkSize, wavBuffer.length - offset);
      break;
    }

    offset += chunkSize + (chunkSize & 1);
  }

  if (dataOffset === 0) {
    throw new SoundCodecError('No "data" chunk found in WAV.');
  }

  const bytesPerSample = Math.floor(bitsPerSample / 8);
  if (![1, 2, 3, 4].includes(bytesPerSample)) {
    throw new SoundCodecError(`Unsupported WAV bit depth (${bitsPerSample}-bit).`);
  }

  const numSamples = Math.floor(dataSize / bytesPerSample);
  const pcmSamples = new Int16Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const pos = dataOffset + i * bytesPerSample;
    if (audioFormat === 3 && bytesPerSample === 4) {
      // 32-bit IEEE float
      const f = wavBuffer.readFloatLE(pos);
      const clamped = Math.max(-1.0, Math.min(1.0, Number.isFinite(f) ? f : 0));
      pcmSamples[i] = Math.round(clamped * 32767);
    } else if (bytesPerSample === 2) {
      pcmSamples[i] = wavBuffer.readInt16LE(pos);
    } else if (bytesPerSample === 3) {
      // 24-bit signed PCM -> take top 16 bits
      pcmSamples[i] = wavBuffer.readInt16LE(pos + 1);
    } else if (bytesPerSample === 4) {
      // 32-bit signed PCM -> take top 16 bits
      pcmSamples[i] = wavBuffer.readInt16LE(pos + 2);
    } else if (bytesPerSample === 1) {
      // 8-bit unsigned PCM (0..255, center 128)
      pcmSamples[i] = (wavBuffer[pos] - 128) << 8;
    }
  }

  return { sampleRate, channels, pcmSamples };
}

/* --------------------------------- Sound Tag Inspector & Parser --------------------------------- */

/**
 * Inspects a sound (`snd!`) tag in the given map or external `sounds.map`.
 */
export function inspectSoundTag(
  mapBuffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  soundTagId: number,
  externalSoundsBuffer?: Buffer,
): SoundTagSummary {
  const entryIdx = soundTagId & 0xffff;
  const entry = tagIndex.entries[entryIdx];
  if (!entry || entry.tagId !== soundTagId) {
    throw new SoundCodecError(`Sound tag ID 0x${soundTagId.toString(16)} not found.`);
  }

  let tagStart = 0;
  let isExternal = entry.isExternal;
  let srcBuf = mapBuffer;

  if (isExternal) {
    if (!externalSoundsBuffer) {
      throw new SoundCodecError(`External sounds.map buffer required for tag "${entry.path}".`);
    }
    const resMap = parseResourceMap(externalSoundsBuffer);
    let matchedOffset = 0;
    for (const r of resMap.entries) {
      let name = '';
      for (let i = r.pathOffset; externalSoundsBuffer[i] !== 0; i++) {
        name += String.fromCharCode(externalSoundsBuffer[i]);
      }
      if (name === entry.path) {
        matchedOffset = r.dataOffset;
        break;
      }
    }
    if (matchedOffset === 0) {
      throw new SoundCodecError(`Sound tag "${entry.path}" not found in sounds.map resource table.`);
    }
    tagStart = matchedOffset;
    srcBuf = externalSoundsBuffer;
  } else {
    tagStart = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  }

  const soundClass = srcBuf.readUInt16LE(tagStart + 0x04);
  const sampleRateCode = srcBuf.readUInt16LE(tagStart + 0x06);
  const sampleRate = sampleRateCode === 1 ? 44100 : 22050;
  const channelCount = srcBuf.readUInt16LE(tagStart + 0x6c) === 1 ? 2 : 1;

  // Pitch Ranges Reflexive (offset 0x98)
  const pitchCount = srcBuf.readUInt32LE(tagStart + 0x98);
  const pitchPtr = srcBuf.readUInt32LE(tagStart + 0x9c);

  const pitchRanges: SoundPitchRangeInfo[] = [];

  if (pitchCount > 0 && pitchCount < 32) {
    const pitchBase = isExternal ? tagStart + 164 : header.tagDataOffset + (pitchPtr - tagIndex.baseMemoryAddress);
    const pitchStructSize = 72;

    for (let p = 0; p < pitchCount; p++) {
      const pOffset = pitchBase + p * pitchStructSize;
      if (pOffset + pitchStructSize <= srcBuf.length) {
        let pName = '';
        for (let b = 0; b < 32; b++) {
          const ch = srcBuf[pOffset + b];
          if (ch === 0) break;
          pName += String.fromCharCode(ch);
        }

        const naturalPitch = srcBuf.readFloatLE(pOffset + 0x20);
        const bendMin = srcBuf.readFloatLE(pOffset + 0x24);
        const bendMax = srcBuf.readFloatLE(pOffset + 0x28);

        // Permutations reflexive (at 0x3C inside SoundPitchRange)
        const permCount = srcBuf.readUInt32LE(pOffset + 0x3c);
        const permPtr = srcBuf.readUInt32LE(pOffset + 0x40);

        const permutations: SoundPermutationInfo[] = [];
        if (permCount > 0 && permCount < 256) {
          const permBase = isExternal
            ? pitchBase + permPtr
            : header.tagDataOffset + (permPtr - tagIndex.baseMemoryAddress);
          const permStructSize = 124;

          for (let m = 0; m < permCount; m++) {
            const mOffset = permBase + m * permStructSize;
            if (mOffset + permStructSize <= srcBuf.length) {
              let mName = '';
              for (let b = 0; b < 32; b++) {
                const ch = srcBuf[mOffset + b];
                if (ch === 0) break;
                mName += String.fromCharCode(ch);
              }

              const skipFraction = srcBuf.readFloatLE(mOffset + 0x20);
              const gain = srcBuf.readFloatLE(mOffset + 0x24);
              const format = srcBuf.readUInt16LE(mOffset + 0x28);

              const sampleSize = srcBuf.readUInt32LE(mOffset + 0x40);
              const sampleExt = srcBuf.readUInt32LE(mOffset + 0x44);
              const sampleOffset = srcBuf.readUInt32LE(mOffset + 0x48);

              const permExternal = header.engine !== 5 && ((sampleExt & 1) !== 0 || isExternal);

              let durationSeconds = 0;
              if (format === SoundFormat.XboxADPCM) {
                const samplesPerChannel = Math.floor(sampleSize / (36 * channelCount)) * 64;
                durationSeconds = samplesPerChannel / sampleRate;
              } else if (format === SoundFormat.PCM16) {
                const samplesPerChannel = Math.floor(sampleSize / (2 * channelCount));
                durationSeconds = samplesPerChannel / sampleRate;
              }

              permutations.push({
                index: m,
                name: mName.trim() || `permutation_${m}`,
                skipFraction,
                gain,
                format,
                formatName: SOUND_FORMAT_NAMES[format] ?? `Format ${format}`,
                sampleSize,
                sampleOffset,
                isExternal: permExternal,
                durationSeconds: Math.round(durationSeconds * 100) / 100,
              });
            }
          }
        }

        pitchRanges.push({
          index: p,
          name: pName.trim() || `range_${p}`,
          naturalPitch,
          bendBoundsMin: bendMin,
          bendBoundsMax: bendMax,
          permutations,
        });
      }
    }
  }

  return {
    tagId: soundTagId,
    tagIndex: entryIdx,
    path: entry.path,
    soundClass,
    soundClassName: SOUND_CLASS_NAMES[soundClass] ?? `Class ${soundClass}`,
    channelCount,
    sampleRate,
    isExternal,
    pitchRanges,
  };
}

/**
 * Decodes a single sound permutation's sample bytes into standard 16-bit linear PCM.
 */
export function decodeSoundPermutationPcm(
  mapBuffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  soundTagId: number,
  pitchRangeIndex = 0,
  permutationIndex = 0,
  externalSoundsBuffer?: Buffer,
): { sampleRate: number; channels: number; pcmSamples: Int16Array; durationSeconds: number } {
  const summary = inspectSoundTag(mapBuffer, header, tagIndex, soundTagId, externalSoundsBuffer);
  const range = summary.pitchRanges[pitchRangeIndex];
  if (!range) throw new SoundCodecError(`Pitch range ${pitchRangeIndex} not found.`);
  const perm = range.permutations[permutationIndex];
  if (!perm) throw new SoundCodecError(`Permutation ${permutationIndex} not found.`);

  const srcBuf = perm.isExternal ? externalSoundsBuffer : mapBuffer;
  if (!srcBuf) throw new SoundCodecError(`Missing audio buffer for permutation ${perm.name}.`);

  if (perm.sampleOffset + perm.sampleSize > srcBuf.length) {
    throw new CorruptMapError(
      `Audio samples (offset 0x${perm.sampleOffset.toString(16)}, size ${perm.sampleSize}) out of bounds (${srcBuf.length}).`,
    );
  }

  let pcmSamples: Int16Array;

  if (perm.format === SoundFormat.XboxADPCM) {
    if (summary.channelCount === 2) {
      pcmSamples = decodeXboxAdpcmStereo(srcBuf, perm.sampleOffset, perm.sampleSize);
    } else {
      pcmSamples = decodeXboxAdpcmMono(srcBuf, perm.sampleOffset, perm.sampleSize);
    }
  } else if (perm.format === SoundFormat.PCM16) {
    const numSamples = Math.floor(perm.sampleSize / 2);
    pcmSamples = new Int16Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      pcmSamples[i] = srcBuf.readInt16LE(perm.sampleOffset + i * 2);
    }
  } else {
    throw new SoundCodecError(`Decoding format ${perm.formatName} is not yet supported.`);
  }

  const durationSeconds = pcmSamples.length / (summary.channelCount * summary.sampleRate);
  return {
    sampleRate: summary.sampleRate,
    channels: summary.channelCount,
    pcmSamples,
    durationSeconds,
  };
}

/**
 * Generates Halo CE's 8,000 Hz `uint8` (`0..255`) smoothed mouth amplitude envelope (`mouth_data`)
 * for biped facial lip-sync animation during dialogue playback.
 */
export function computeMouthDataEnvelope(pcmSamples: Int16Array, sampleRate: number, channels: number): Buffer {
  const safeCh = Math.max(1, channels);
  const safeRate = Math.max(1000, sampleRate);
  const totalFrames = Math.floor(pcmSamples.length / safeCh);
  if (totalFrames <= 0) return Buffer.alloc(0);

  const mouthRate = 8000;
  const mouthLen = Math.max(1, Math.ceil((totalFrames / safeRate) * mouthRate));
  const rawEnv = new Float32Array(mouthLen);
  const windowFrames = Math.max(1, Math.round(safeRate / mouthRate));

  let peakRms = 1200; // baseline floor so quiet static doesn't blow up lip-sync
  for (let i = 0; i < mouthLen; i++) {
    const startFrame = Math.floor((i * totalFrames) / mouthLen);
    const endFrame = Math.min(totalFrames, startFrame + windowFrames * 2);
    let sumSq = 0;
    let count = 0;
    for (let f = startFrame; f < endFrame; f++) {
      let mono = 0;
      for (let c = 0; c < safeCh; c++) {
        mono += pcmSamples[f * safeCh + c];
      }
      mono /= safeCh;
      sumSq += mono * mono;
      count++;
    }
    const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
    rawEnv[i] = rms;
    if (rms > peakRms) peakRms = rms;
  }

  // Smooth attack/release envelope at 8,000 Hz so biped jaw opens/closes naturally
  const out = Buffer.alloc(mouthLen);
  let smoothed = 0;
  const attackAlpha = 0.35;
  const releaseAlpha = 0.08;
  for (let i = 0; i < mouthLen; i++) {
    const norm = Math.min(1, rawEnv[i] / peakRms);
    // Slight gamma boost for clear mid-speech articulation
    const target = Math.pow(norm, 0.75);
    smoothed += (target - smoothed) * (target > smoothed ? attackAlpha : releaseAlpha);
    out[i] = Math.max(0, Math.min(255, Math.round(smoothed * 255)));
  }

  return out;
}

/**
 * Replaces a sound permutation's audio data and internalizes the tag definition into the map if external.
 */
export function replaceSoundPermutationData(
  mapBuffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  soundTagId: number,
  pitchRangeIndex: number,
  permutationIndex: number,
  newSamples: Uint8Array | Buffer,
  newFormat: number,
  externalSoundsBuffer?: Buffer,
  mouthData?: Buffer,
): Buffer {
  const entryIdx = soundTagId & 0xffff;
  const entry = tagIndex.entries[entryIdx];
  if (!entry) throw new SoundCodecError(`Sound tag 0x${soundTagId.toString(16)} not found.`);

  // If external, internalize the tag definition from sounds.map
  if (entry.isExternal) {
    if (!externalSoundsBuffer) {
      throw new SoundCodecError(`External sounds.map buffer required to internalize sound tag "${entry.path}".`);
    }
    const resMap = parseResourceMap(externalSoundsBuffer);
    let matchedOffset = 0;
    let matchedSize = 0;
    for (const r of resMap.entries) {
      let name = '';
      for (let i = r.pathOffset; externalSoundsBuffer[i] !== 0; i++) {
        name += String.fromCharCode(externalSoundsBuffer[i]);
      }
      if (name === entry.path) {
        matchedOffset = r.dataOffset;
        matchedSize = r.size;
        break;
      }
    }
    if (matchedOffset === 0) {
      throw new SoundCodecError(`Sound tag "${entry.path}" not found in sounds.map.`);
    }

    const tagCopy = Buffer.from(externalSoundsBuffer.subarray(matchedOffset, matchedOffset + matchedSize));

    // Align append offset for tag struct
    const tagStartInMap = (mapBuffer.length + 3) & ~3;
    const tagVirtualAddress = tagIndex.baseMemoryAddress + (tagStartInMap - header.tagDataOffset);

    // Rebase pitch ranges reflexive
    const pitchCount = tagCopy.readUInt32LE(0x98);
    const pitchOffsetRel = 164;
    tagCopy.writeUInt32LE(tagVirtualAddress + pitchOffsetRel, 0x9c);

    let audioCursor = (tagStartInMap + tagCopy.length + 3) & ~3;
    const audioPayloads: { offset: number; data: Buffer }[] = [];

    const pitchStructSize = 72;
    for (let p = 0; p < pitchCount; p++) {
      const pOffset = pitchOffsetRel + p * pitchStructSize;
      const permCount = tagCopy.readUInt32LE(pOffset + 0x3c);
      const permRelOffset = tagCopy.readUInt32LE(pOffset + 0x40);

      // Rebase permutations reflexive inside this pitch range
      tagCopy.writeUInt32LE(tagVirtualAddress + pitchOffsetRel + permRelOffset, pOffset + 0x40);

      for (let m = 0; m < permCount; m++) {
        const mOffset = pitchOffsetRel + permRelOffset + m * 124;
        const isTarget = p === pitchRangeIndex && m === permutationIndex;
        const curAudioOffset = audioCursor;

        let payloadBytes: Buffer;
        if (isTarget) {
          payloadBytes = Buffer.from(newSamples);
          tagCopy.writeUInt16LE(newFormat, mOffset + 0x28);
          tagCopy.writeInt16LE(-1, mOffset + 0x2a); // next permutation index = -1
          tagCopy.writeUInt32LE(newFormat === SoundFormat.PCM16 ? payloadBytes.length : 0, mOffset + 0x38); // buffer size
          tagCopy.writeUInt32LE(payloadBytes.length, mOffset + 0x40);
          // Clear mouth/subtitle data on replaced permutation
          tagCopy.fill(0, mOffset + 0x54, mOffset + 0x7c);
        } else {
          const oldSampleOffset = tagCopy.readUInt32LE(mOffset + 0x48);
          const oldSampleSize = tagCopy.readUInt32LE(mOffset + 0x40);
          if (oldSampleOffset + oldSampleSize <= externalSoundsBuffer.length) {
            payloadBytes = Buffer.from(externalSoundsBuffer.subarray(oldSampleOffset, oldSampleOffset + oldSampleSize));
          } else {
            payloadBytes = Buffer.alloc(0);
          }
          // Rebase mouth data & subtitle data pointers if present in sounds.map
          const mouthSize = tagCopy.readUInt32LE(mOffset + 0x54);
          const mouthRelPtr = tagCopy.readUInt32LE(mOffset + 0x60);
          if (mouthSize > 0 && mouthRelPtr > 0 && pitchOffsetRel + mouthRelPtr + mouthSize <= tagCopy.length) {
            tagCopy.writeUInt32LE(tagVirtualAddress + pitchOffsetRel + mouthRelPtr, mOffset + 0x60);
          } else {
            tagCopy.fill(0, mOffset + 0x54, mOffset + 0x68);
          }
          const subSize = tagCopy.readUInt32LE(mOffset + 0x68);
          const subRelPtr = tagCopy.readUInt32LE(mOffset + 0x74);
          if (subSize > 0 && subRelPtr > 0 && pitchOffsetRel + subRelPtr + subSize <= tagCopy.length) {
            tagCopy.writeUInt32LE(tagVirtualAddress + pitchOffsetRel + subRelPtr, mOffset + 0x74);
          } else {
            tagCopy.fill(0, mOffset + 0x68, mOffset + 0x7c);
          }
        }

        tagCopy.writeUInt32LE(0, mOffset + 0x44); // Clear external bit
        tagCopy.writeUInt32LE(curAudioOffset, mOffset + 0x48);
        tagCopy.writeUInt32LE(soundTagId, mOffset + 0x34); // Set tag id 0
        tagCopy.writeUInt32LE(soundTagId, mOffset + 0x3c); // Set tag id 1

        audioPayloads.push({ offset: curAudioOffset, data: payloadBytes });
        audioCursor = (audioCursor + payloadBytes.length + 3) & ~3;

        if (isTarget && mouthData && mouthData.length > 0) {
          const curMouthOffset = audioCursor;
          const mouthVirtPtr = tagIndex.baseMemoryAddress + (curMouthOffset - header.tagDataOffset);
          tagCopy.writeUInt32LE(mouthData.length, mOffset + 0x54);
          tagCopy.writeUInt32LE(0, mOffset + 0x58);
          tagCopy.writeUInt32LE(0, mOffset + 0x5c);
          tagCopy.writeUInt32LE(mouthVirtPtr, mOffset + 0x60);
          audioPayloads.push({ offset: curMouthOffset, data: mouthData });
          audioCursor = (audioCursor + mouthData.length + 3) & ~3;
        }
      }
    }

    // Allocate expanded map buffer
    const totalNewLength = audioCursor;
    const outBuffer = Buffer.alloc(totalNewLength);
    mapBuffer.copy(outBuffer, 0);
    tagCopy.copy(outBuffer, tagStartInMap);
    for (const payload of audioPayloads) {
      payload.data.copy(outBuffer, payload.offset);
    }

    // Update tag table entry
    const tagArrayOffset = header.tagDataOffset + 0x28;
    const entryOffset = tagArrayOffset + entryIdx * 32;
    outBuffer.writeUInt32LE(tagVirtualAddress, entryOffset + 0x14);
    outBuffer.writeUInt32LE(0, entryOffset + 0x18); // isExternal = false

    entry.tagDataPointerOrResourceIndex = tagVirtualAddress;
    entry.isExternal = false;

    const newTagDataSize = totalNewLength - header.tagDataOffset;
    outBuffer.writeUInt32LE(totalNewLength, 0x08);
    outBuffer.writeUInt32LE(newTagDataSize, 0x14);
    header.tagDataSize = newTagDataSize;
    header.decompressedFileSize = totalNewLength;

    return outBuffer;
  }

  // Already internal in mapBuffer
  const tagStart = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  const pitchCount = mapBuffer.readUInt32LE(tagStart + 0x98);
  const pitchPtr = mapBuffer.readUInt32LE(tagStart + 0x9c);
  const pitchBase = header.tagDataOffset + (pitchPtr - tagIndex.baseMemoryAddress);
  const pOffset = pitchBase + pitchRangeIndex * 72;

  const permPtr = mapBuffer.readUInt32LE(pOffset + 0x40);
  const permBase = header.tagDataOffset + (permPtr - tagIndex.baseMemoryAddress);
  const mOffset = permBase + permutationIndex * 124;

  const oldSize = mapBuffer.readUInt32LE(mOffset + 0x40);
  const oldOffset = mapBuffer.readUInt32LE(mOffset + 0x48);
  const oldExt = mapBuffer.readUInt32LE(mOffset + 0x44);

  let outputBuffer = mapBuffer;
  let targetOffset = oldOffset;

  if ((oldExt & 1) === 0 && newSamples.length <= oldSize && oldOffset + newSamples.length <= mapBuffer.length) {
    Buffer.from(newSamples).copy(outputBuffer, oldOffset);
  } else {
    const alignedAppendOffset = (mapBuffer.length + 3) & ~3;
    const newBuf = Buffer.alloc(alignedAppendOffset + newSamples.length);
    mapBuffer.copy(newBuf, 0);
    Buffer.from(newSamples).copy(newBuf, alignedAppendOffset);
    outputBuffer = newBuf;
    targetOffset = alignedAppendOffset;
  }

  outputBuffer.writeUInt16LE(newFormat, mOffset + 0x28);
  outputBuffer.writeInt16LE(-1, mOffset + 0x2a); // next permutation index = -1
  outputBuffer.writeUInt32LE(newFormat === SoundFormat.PCM16 ? newSamples.length : 0, mOffset + 0x38); // buffer size
  outputBuffer.writeUInt32LE(newSamples.length, mOffset + 0x40);
  outputBuffer.writeUInt32LE(0, mOffset + 0x44); // internal
  outputBuffer.writeUInt32LE(targetOffset, mOffset + 0x48);
  outputBuffer.writeUInt32LE(soundTagId, mOffset + 0x34); // Set tag id 0
  outputBuffer.writeUInt32LE(soundTagId, mOffset + 0x3c); // Set tag id 1
  outputBuffer.fill(0, mOffset + 0x54, mOffset + 0x7c); // Clear mouth/subtitle data on replaced permutation

  if (mouthData && mouthData.length > 0) {
    const mouthAppendOffset = (outputBuffer.length + 3) & ~3;
    const expandedWithMouth = Buffer.alloc((mouthAppendOffset + mouthData.length + 3) & ~3);
    outputBuffer.copy(expandedWithMouth, 0);
    mouthData.copy(expandedWithMouth, mouthAppendOffset);
    const mouthVirtPtr = tagIndex.baseMemoryAddress + (mouthAppendOffset - header.tagDataOffset);
    expandedWithMouth.writeUInt32LE(mouthData.length, mOffset + 0x54);
    expandedWithMouth.writeUInt32LE(0, mOffset + 0x58);
    expandedWithMouth.writeUInt32LE(0, mOffset + 0x5c);
    expandedWithMouth.writeUInt32LE(mouthVirtPtr, mOffset + 0x60);
    outputBuffer = expandedWithMouth;
  }

  // Also internalize any remaining external sibling permutations on this sound tag
  if (externalSoundsBuffer && pitchCount > 0 && pitchCount < 32) {
    const extraPayloads: { mOff: number; data: Buffer }[] = [];
    for (let p = 0; p < pitchCount; p++) {
      const curPOff = pitchBase + p * 72;
      if (curPOff + 72 > outputBuffer.length) continue;
      const curPermCount = outputBuffer.readUInt32LE(curPOff + 0x3c);
      const curPermPtr = outputBuffer.readUInt32LE(curPOff + 0x40);
      if (curPermCount <= 0 || curPermCount >= 256 || curPermPtr < tagIndex.baseMemoryAddress) continue;
      const curPermBase = header.tagDataOffset + (curPermPtr - tagIndex.baseMemoryAddress);
      for (let m = 0; m < curPermCount; m++) {
        if (p === pitchRangeIndex && m === permutationIndex) continue;
        const sibOff = curPermBase + m * 124;
        if (sibOff + 124 > outputBuffer.length) continue;
        const sibExt = outputBuffer.readUInt32LE(sibOff + 0x44);
        if ((sibExt & 1) !== 0) {
          const sibSampleSize = outputBuffer.readUInt32LE(sibOff + 0x40);
          const sibSampleOffset = outputBuffer.readUInt32LE(sibOff + 0x48);
          if (sibSampleSize > 0 && sibSampleOffset + sibSampleSize <= externalSoundsBuffer.length) {
            extraPayloads.push({
              mOff: sibOff,
              data: Buffer.from(externalSoundsBuffer.subarray(sibSampleOffset, sibSampleOffset + sibSampleSize)),
            });
          }
        }
      }
    }
    if (extraPayloads.length > 0) {
      let cursor = (outputBuffer.length + 3) & ~3;
      const placements: { mOff: number; offset: number; data: Buffer }[] = [];
      for (const ep of extraPayloads) {
        placements.push({ mOff: ep.mOff, offset: cursor, data: ep.data });
        cursor = (cursor + ep.data.length + 3) & ~3;
      }
      const expanded = Buffer.alloc(cursor);
      outputBuffer.copy(expanded, 0);
      for (const pl of placements) {
        pl.data.copy(expanded, pl.offset);
        expanded.writeUInt32LE(0, pl.mOff + 0x44);
        expanded.writeUInt32LE(pl.offset, pl.mOff + 0x48);
        expanded.writeUInt32LE(soundTagId, pl.mOff + 0x34);
        expanded.writeUInt32LE(soundTagId, pl.mOff + 0x3c);
      }
      outputBuffer = expanded;
    }
  }

  const newTagDataSize = outputBuffer.length - header.tagDataOffset;
  outputBuffer.writeUInt32LE(outputBuffer.length, 0x08);
  outputBuffer.writeUInt32LE(newTagDataSize, 0x14);
  header.tagDataSize = newTagDataSize;
  header.decompressedFileSize = outputBuffer.length;

  return outputBuffer;
}
