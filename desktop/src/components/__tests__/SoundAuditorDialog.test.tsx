import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SoundAuditorDialog from '../SoundAuditorDialog';
import type { TagEntrySummary, GetSoundInfoResult, GetSoundWavResult } from '../../../electron/shared-types';

const MOCK_SOUND_TAG: TagEntrySummary = {
  index: 45,
  tagId: 0xe174002d,
  primaryClassName: 'sound',
  path: 'sound\\sfx\\impulse\\coolant\\enter_water',
  isExternal: false,
  estimatedSize: 8192,
};

const MOCK_INFO_RESULT: GetSoundInfoResult = {
  ok: true,
  summary: {
    tagIndex: 45,
    tagPath: 'sound\\sfx\\impulse\\coolant\\enter_water',
    sampleRate: 22050,
    encoding: 1,
    encodingName: 'Xbox ADPCM',
    compression: 0,
    compressionName: 'None',
    pitchRangeCount: 1,
    permutationCount: 2,
    pitchRanges: [
      {
        name: 'default',
        naturalPitch: 22050,
        bendLower: 1.0,
        bendUpper: 1.0,
        maxGain: 0,
        minGain: 0,
        permutations: [
          {
            name: 'enter_water_0',
            skipFraction: 0,
            gain: 0,
            permutationInfoIndex: 0,
            sampleRate: 22050,
            channels: 1,
            sampleSize: 11025,
            durationSeconds: 1.0,
            isExternal: false,
            externalOffset: 0,
          },
          {
            name: 'enter_water_1',
            skipFraction: 0,
            gain: 0,
            permutationInfoIndex: 1,
            sampleRate: 22050,
            channels: 1,
            sampleSize: 16537,
            durationSeconds: 1.5,
            isExternal: false,
            externalOffset: 0,
          },
        ],
      },
    ],
  },
};

const MOCK_WAV_RESULT: GetSoundWavResult = {
  ok: true,
  dataUrl: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACErAAABAAgAZGF0YQAAAAA=',
  sampleRate: 22050,
  channels: 1,
  durationSeconds: 1.0,
};

describe('SoundAuditorDialog', () => {
  let mockOpence: any;

  beforeEach(() => {
    mockOpence = {
      getSoundInfo: vi.fn().mockResolvedValue(MOCK_INFO_RESULT),
      getSoundWav: vi.fn().mockResolvedValue(MOCK_WAV_RESULT),
      pickExportSoundPath: vi.fn().mockResolvedValue({ path: 'C:\\exports\\sound_0.wav' }),
      exportSoundWav: vi.fn().mockResolvedValue({ ok: true, filePath: 'C:\\exports\\sound_0.wav' }),
      pickImportSoundPath: vi.fn().mockResolvedValue({ path: 'C:\\imports\\new_sound.wav' }),
      replaceSoundWav: vi.fn().mockResolvedValue({ ok: true }),
    };

    (window as any).opence = mockOpence;

    // Mock HTMLCanvasElement getContext
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    });

    // Mock AudioContext and fetch
    (window as any).AudioContext = class MockAudioContext {
      state = 'running';
      currentTime = 0;
      destination = {};
      createBufferSource() {
        return {
          buffer: null,
          loop: false,
          playbackRate: { value: 1.0 },
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
          onended: null,
        };
      }
      createGain() {
        return {
          gain: { value: 1.0 },
          connect: vi.fn(),
        };
      }
      async decodeAudioData() {
        return {
          duration: 1.0,
          length: 22050,
          numberOfChannels: 1,
          sampleRate: 22050,
          getChannelData: () => new Float32Array(22050),
        };
      }
      async resume() {}
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      arrayBuffer: async () => new ArrayBuffer(44),
    } as any);
  });

  it('renders sound overview header and permutations list', async () => {
    const onClose = vi.fn();
    render(<SoundAuditorDialog tag={MOCK_SOUND_TAG} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('Sound Audition & Injector')).toBeInTheDocument();
      expect(screen.getByText('22050 Hz')).toBeInTheDocument();
      expect(screen.getByText('Xbox ADPCM')).toBeInTheDocument();
      expect(screen.getByText('enter_water_0')).toBeInTheDocument();
      expect(screen.getByText('enter_water_1')).toBeInTheDocument();
    });
  });

  it('selects a permutation row and triggers audio load', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SoundAuditorDialog tag={MOCK_SOUND_TAG} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('enter_water_1')).toBeInTheDocument();
    });

    const secondRow = screen.getByTestId('sound-perm-row-1');
    await user.click(secondRow);

    await waitFor(() => {
      expect(mockOpence.getSoundWav).toHaveBeenCalledWith(45, 0, 1);
    });
  });

  it('exports a permutation to WAV', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SoundAuditorDialog tag={MOCK_SOUND_TAG} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByTestId('export-sound-wav-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('export-sound-wav-btn'));

    await waitFor(() => {
      expect(mockOpence.pickExportSoundPath).toHaveBeenCalled();
      expect(mockOpence.exportSoundWav).toHaveBeenCalledWith(45, 0, 0, 'C:\\exports\\sound_0.wav');
      expect(screen.getByText(/Successfully exported WAV/)).toBeInTheDocument();
    });
  });

  it('imports and replaces a permutation WAV', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SoundAuditorDialog tag={MOCK_SOUND_TAG} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByTestId('replace-sound-wav-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('replace-sound-wav-btn'));

    await waitFor(() => {
      expect(mockOpence.pickImportSoundPath).toHaveBeenCalled();
      expect(mockOpence.replaceSoundWav).toHaveBeenCalledWith(45, 0, 0, 'C:\\imports\\new_sound.wav');
      expect(screen.getByText(/Permutation replaced & internalized successfully!/)).toBeInTheDocument();
    });
  });
});
