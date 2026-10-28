import { useEffect, useRef, useState, useCallback } from 'react';
import type { KeyboardEvent } from 'react';
import type {
  TagEntrySummary,
  SoundTagSummary,
  GetSoundInfoResult,
  GetSoundWavResult,
} from '../../electron/shared-types';

interface Props {
  tag: TagEntrySummary;
  onClose: () => void;
}

export default function SoundAuditorDialog({ tag, onClose }: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SoundTagSummary | null>(null);

  // Selection
  const [selectedPitchRangeIndex, setSelectedPitchRangeIndex] = useState(0);
  const [selectedPermutationIndex, setSelectedPermutationIndex] = useState(0);

  // Audio Playback State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1.0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isLooping, setIsLooping] = useState(false);
  const [autoPlayOnChange, setAutoPlayOnChange] = useState(true);

  // Audio buffer and context references
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const decodedAudioBufferRef = useRef<AudioBuffer | null>(null);
  const playStartTimeRef = useRef<number>(0);
  const pauseOffsetRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);

  // Action status message
  const [statusMsg, setStatusMsg] = useState<{ text: string; isError?: boolean } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // 1. Load Tag Metadata Summary
  const loadSummary = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res: GetSoundInfoResult = await window.opence.getSoundInfo(tag.index);
      if (!res.ok || !res.summary) {
        setError(res.message || 'Failed to inspect sound tag.');
        return;
      }
      setSummary(res.summary);
      if (selectedPitchRangeIndex >= res.summary.pitchRanges.length) {
        setSelectedPitchRangeIndex(0);
      }
      const curRange = res.summary.pitchRanges[selectedPitchRangeIndex] || res.summary.pitchRanges[0];
      if (curRange && selectedPermutationIndex >= curRange.permutations.length) {
        setSelectedPermutationIndex(0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [tag.index, selectedPitchRangeIndex, selectedPermutationIndex]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // Audio cleanup helper
  const stopAudio = useCallback(() => {
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop();
        activeSourceRef.current.disconnect();
      } catch {
        // Ignore if already stopped
      }
      activeSourceRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setIsPlaying(false);
    pauseOffsetRef.current = 0;
    setCurrentTime(0);
  }, []);

  // 2. Fetch and Decode WAV Audio for selected permutation
  const loadAudioPermutation = useCallback(
    async (playImmediately = false) => {
      stopAudio();
      decodedAudioBufferRef.current = null;
      setDuration(0);

      try {
        const res: GetSoundWavResult = await window.opence.getSoundWav(
          tag.index,
          selectedPitchRangeIndex,
          selectedPermutationIndex,
        );
        if (!res.ok || !res.dataUrl) {
          setError(res.message || 'Failed to decode sound audio.');
          return;
        }

        setDuration(res.durationSeconds ?? 0);

        // Decode in Web Audio
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;

        if (!audioContextRef.current) {
          audioContextRef.current = new AudioCtx();
        }
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => {});
        }

        const resp = await fetch(res.dataUrl);
        const arrayBuf = await resp.arrayBuffer();
        const audioBuf = await ctx.decodeAudioData(arrayBuf);
        decodedAudioBufferRef.current = audioBuf;
        setDuration(audioBuf.duration);

        // Redraw waveform
        drawWaveform(audioBuf, 0);

        if (playImmediately) {
          playAudio(0);
        }
      } catch (err) {
        console.warn('Audio decoding error:', err);
      }
    },
    [tag.index, selectedPitchRangeIndex, selectedPermutationIndex, stopAudio],
  );

  useEffect(() => {
    if (summary && summary.pitchRanges.length > 0) {
      loadAudioPermutation(autoPlayOnChange);
    }
    return () => {
      stopAudio();
    };
  }, [summary, selectedPitchRangeIndex, selectedPermutationIndex]);

  // Draw Waveform on Canvas
  const drawWaveform = (buffer: AudioBuffer | null, playheadSec: number) => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Background
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, width, height);

    // Center guideline
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    if (!buffer) return;

    const channelData = buffer.getChannelData(0);
    const step = Math.ceil(channelData.length / width);
    const amp = height / 2;

    // Draw waveform bars + 8,000 Hz lip-sync mouth_data envelope curve
    ctx.fillStyle = '#38bdf8';
    let smoothedMouth = 0;
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;
      let sumSq = 0;
      const start = i * step;
      const end = Math.min(start + step, channelData.length);
      for (let j = start; j < end; j++) {
        const datum = channelData[j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
        sumSq += datum * datum;
      }
      if (max < min) {
        min = 0;
        max = 0;
      }
      const yMin = (1 + min) * amp;
      const yMax = Math.max((1 + max) * amp, yMin + 1);
      ctx.fillRect(i, yMin, 1, yMax - yMin);

      const rms = end > start ? Math.sqrt(sumSq / (end - start)) : 0;
      const targetEnv = Math.min(1, Math.pow(rms * 2.2, 0.75));
      smoothedMouth += (targetEnv - smoothedMouth) * (targetEnv > smoothedMouth ? 0.35 : 0.12);
      const envY = height - 4 - smoothedMouth * (height * 0.42);
      if (i === 0) ctx.moveTo(i, envY);
      else ctx.lineTo(i, envY);
    }
    ctx.stroke();

    // Draw playhead
    if (buffer.duration > 0) {
      const playheadX = Math.min(width, Math.max(0, (playheadSec / buffer.duration) * width));
      ctx.fillStyle = '#f43f5e';
      ctx.fillRect(playheadX - 1, 0, 2, height);
    }
  };

  // Play audio from offset
  const playAudio = useCallback(
    (offsetSec: number) => {
      const buffer = decodedAudioBufferRef.current;
      if (!buffer) return;

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      if (activeSourceRef.current) {
        try {
          activeSourceRef.current.stop();
          activeSourceRef.current.disconnect();
        } catch {
          // ignore
        }
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = isLooping;
      source.playbackRate.value = playbackRate;

      const gain = ctx.createGain();
      gain.gain.value = volume;
      gainNodeRef.current = gain;

      source.connect(gain);
      gain.connect(ctx.destination);

      const actualOffset = offsetSec % buffer.duration;
      source.start(0, actualOffset);
      activeSourceRef.current = source;
      playStartTimeRef.current = ctx.currentTime - actualOffset / playbackRate;
      setIsPlaying(true);

      source.onended = () => {
        if (!source.loop) {
          setIsPlaying(false);
          setCurrentTime(0);
          pauseOffsetRef.current = 0;
          drawWaveform(buffer, 0);
        }
      };

      // Progress animation ticker
      const updateTick = () => {
        if (!activeSourceRef.current || !ctx) return;
        const cur = (ctx.currentTime - playStartTimeRef.current) * playbackRate;
        const bounded = source.loop ? cur % buffer.duration : Math.min(cur, buffer.duration);
        setCurrentTime(bounded);
        drawWaveform(buffer, bounded);
        if (cur < buffer.duration || source.loop) {
          animFrameRef.current = requestAnimationFrame(updateTick);
        }
      };
      animFrameRef.current = requestAnimationFrame(updateTick);
    },
    [isLooping, playbackRate, volume],
  );

  const togglePlayPause = () => {
    if (isPlaying) {
      // Pause
      if (activeSourceRef.current) {
        try {
          activeSourceRef.current.stop();
          activeSourceRef.current.disconnect();
        } catch {
          // ignore
        }
        activeSourceRef.current = null;
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      pauseOffsetRef.current = currentTime;
      setIsPlaying(false);
    } else {
      // Play
      playAudio(pauseOffsetRef.current);
    }
  };

  // Waveform canvas click-to-seek
  const handleWaveformClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || !decodedAudioBufferRef.current) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const fraction = Math.max(0, Math.min(1, clickX / rect.width));
    const seekTime = fraction * decodedAudioBufferRef.current.duration;

    pauseOffsetRef.current = seekTime;
    setCurrentTime(seekTime);
    drawWaveform(decodedAudioBufferRef.current, seekTime);

    if (isPlaying) {
      playAudio(seekTime);
    }
  };

  // Volume slider update
  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = newVol;
    }
  };

  // Playback rate slider update
  const handlePlaybackRateChange = (newRate: number) => {
    setPlaybackRate(newRate);
    if (activeSourceRef.current) {
      activeSourceRef.current.playbackRate.value = newRate;
    }
  };

  // Keyboard navigation & Shortcuts
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      togglePlayPause();
    }
  };

  // Export permutation WAV
  const handleExportWav = async () => {
    if (!summary) return;
    try {
      setIsProcessing(true);
      setStatusMsg(null);
      const perm = currentPermutations[selectedPermutationIndex];
      const defaultName = `${perm ? perm.name : `sound_${tag.index}`}.wav`;

      const pickRes = await window.opence.pickExportSoundPath(defaultName);
      if (!pickRes || !pickRes.path) {
        setIsProcessing(false);
        return;
      }

      const res = await window.opence.exportSoundWav(
        tag.index,
        selectedPitchRangeIndex,
        selectedPermutationIndex,
        pickRes.path,
      );

      if (!res.ok) {
        setStatusMsg({ text: res.message || 'Export failed.', isError: true });
      } else {
        setStatusMsg({ text: `Successfully exported WAV to "${res.filePath}"!` });
      }
    } catch (err) {
      setStatusMsg({ text: err instanceof Error ? err.message : String(err), isError: true });
    } finally {
      setIsProcessing(false);
    }
  };

  // Import and Replace permutation WAV
  const handleImportWav = async () => {
    if (!summary) return;
    try {
      setIsProcessing(true);
      setStatusMsg(null);

      const pickRes = await window.opence.pickImportSoundPath();
      if (!pickRes || !pickRes.path) {
        setIsProcessing(false);
        return;
      }

      const res = await window.opence.replaceSoundWav(
        tag.index,
        selectedPitchRangeIndex,
        selectedPermutationIndex,
        pickRes.path,
      );

      if (!res.ok) {
        setStatusMsg({ text: res.message || 'Replacement failed.', isError: true });
      } else {
        setStatusMsg({
          text: 'Permutation replaced & internalized with Lookahead Xbox ADPCM + 8,000 Hz Lip-Sync (mouth_data) envelope!',
        });
        await loadSummary();
        await loadAudioPermutation(true);
      }
    } catch (err) {
      setStatusMsg({ text: err instanceof Error ? err.message : String(err), isError: true });
    } finally {
      setIsProcessing(false);
    }
  };

  const currentPitchRange = summary?.pitchRanges[selectedPitchRangeIndex];
  const currentPermutations = currentPitchRange?.permutations ?? [];

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = (secs % 60).toFixed(2);
    return `${mins.toString().padStart(2, '0')}:${remainingSecs.padStart(5, '0')}`;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="sound-auditor-dialog"
      tabIndex={-1}
      ref={shellRef}
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          width: '900px',
          maxWidth: '95vw',
          maxHeight: '92vh',
          background: 'var(--bg-canvas, #0f172a)',
          color: 'var(--text-primary, #f8fafc)',
          borderRadius: 8,
          border: '1px solid var(--border, #334155)',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border, #334155)',
            background: 'var(--bg-panel, #1e293b)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 16 }}>🔊</span>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Sound Audition & Injector</span>
            <span
              style={{
                color: 'var(--text-dim, #94a3b8)',
                fontSize: 12,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 450,
              }}
              title={tag.path}
            >
              {tag.path}
            </span>
          </div>
          <button
            data-testid="sound-auditor-close"
            onClick={onClose}
            title="Close (Esc)"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dim, #94a3b8)',
              fontSize: 18,
              lineHeight: 1,
              cursor: 'pointer',
              padding: '2px 6px',
            }}
          >
            ×
          </button>
        </div>

        {/* Toolbar & Overview Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 16,
            padding: '8px 16px',
            background: 'var(--bg-sub, #131c2e)',
            borderBottom: '1px solid var(--border, #334155)',
            fontSize: 12,
          }}
        >
          {summary && (
            <>
              <div>
                <span style={{ color: 'var(--text-dim, #94a3b8)' }}>Sample Rate: </span>
                <span style={{ fontWeight: 500 }}>{summary.sampleRate} Hz</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-dim, #94a3b8)' }}>Encoding: </span>
                <span style={{ fontWeight: 500 }}>{summary.encodingName}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-dim, #94a3b8)' }}>Compression: </span>
                <span style={{ fontWeight: 500 }}>{summary.compressionName}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-dim, #94a3b8)' }}>Pitch Ranges: </span>
                <span style={{ fontWeight: 500 }}>{summary.pitchRanges.length}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-dim, #94a3b8)' }}>Permutations: </span>
                <span style={{ fontWeight: 500 }}>{summary.permutationCount}</span>
              </div>
            </>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              data-testid="export-sound-wav-btn"
              onClick={handleExportWav}
              disabled={isProcessing || !summary}
              style={{
                padding: '4px 10px',
                background: 'var(--bg-button, #2563eb)',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: isProcessing || !summary ? 'default' : 'pointer',
                fontWeight: 500,
                fontSize: 12,
              }}
            >
              Export WAV...
            </button>
            <button
              data-testid="replace-sound-wav-btn"
              onClick={handleImportWav}
              disabled={isProcessing || !summary}
              style={{
                padding: '4px 10px',
                background: '#059669',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: isProcessing || !summary ? 'default' : 'pointer',
                fontWeight: 500,
                fontSize: 12,
              }}
            >
              Import & Replace WAV...
            </button>
          </div>
        </div>

        {/* Status Alert Banner */}
        {statusMsg && (
          <div
            style={{
              padding: '6px 16px',
              fontSize: 12,
              background: statusMsg.isError ? '#7f1d1d' : '#064e3b',
              color: statusMsg.isError ? '#fca5a5' : '#6ee7b7',
              borderBottom: '1px solid var(--border, #334155)',
            }}
          >
            {statusMsg.text}
          </div>
        )}

        {/* Dialog Body */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            padding: 16,
            gap: 16,
          }}
        >
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim, #94a3b8)' }}>
              Inspecting sound tag audio data...
            </div>
          ) : error ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#f87171' }}>{error}</div>
          ) : (
            <>
              {/* Audio Waveform Canvas */}
              <div
                style={{
                  background: '#0b0f19',
                  border: '1px solid #1e293b',
                  borderRadius: 6,
                  padding: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#94a3b8' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span>Waveform Display (Click to Seek)</span>
                    <span
                      style={{
                        padding: '1px 7px',
                        borderRadius: 4,
                        background: 'rgba(250, 204, 21, 0.14)',
                        border: '1px solid rgba(250, 204, 21, 0.4)',
                        color: '#fde047',
                        fontSize: 10,
                        fontWeight: 600,
                      }}
                      title="Gold curve previews the 8,000 Hz mouth_data lip-sync envelope generated automatically on WAV replacement"
                    >
                      👄 8,000 Hz Lip-Sync Envelope (mouth_data) + Lookahead ADPCM
                    </span>
                  </div>
                  <span>
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>
                <canvas
                  ref={waveformCanvasRef}
                  width={850}
                  height={90}
                  onClick={handleWaveformClick}
                  style={{
                    width: '100%',
                    height: 90,
                    borderRadius: 4,
                    cursor: 'pointer',
                    display: 'block',
                  }}
                />
              </div>

              {/* Player Controls */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 16,
                  background: 'var(--bg-panel, #1e293b)',
                  padding: '12px 16px',
                  borderRadius: 6,
                  border: '1px solid var(--border, #334155)',
                }}
              >
                {/* Play / Pause / Stop Buttons */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    data-testid="sound-play-toggle-btn"
                    onClick={togglePlayPause}
                    style={{
                      padding: '6px 14px',
                      background: isPlaying ? '#d97706' : '#2563eb',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    {isPlaying ? '⏸ Pause' : '▶ Play'}
                  </button>
                  <button
                    data-testid="sound-stop-btn"
                    onClick={stopAudio}
                    style={{
                      padding: '6px 12px',
                      background: 'var(--bg-sub, #334155)',
                      color: '#f8fafc',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    ⏹ Stop
                  </button>
                </div>

                {/* Volume Slider */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span style={{ color: 'var(--text-dim, #94a3b8)' }}>Volume:</span>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={volume}
                    onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                    style={{ width: 90 }}
                  />
                  <span>{Math.round(volume * 100)}%</span>
                </div>

                {/* Pitch Slider */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span style={{ color: 'var(--text-dim, #94a3b8)' }}>Pitch:</span>
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.05"
                    value={playbackRate}
                    onChange={(e) => handlePlaybackRateChange(parseFloat(e.target.value))}
                    style={{ width: 90 }}
                  />
                  <span>{playbackRate.toFixed(2)}x</span>
                  {playbackRate !== 1.0 && (
                    <button
                      onClick={() => handlePlaybackRateChange(1.0)}
                      style={{
                        background: 'transparent',
                        border: '1px solid #475569',
                        color: '#94a3b8',
                        padding: '1px 4px',
                        borderRadius: 3,
                        fontSize: 10,
                        cursor: 'pointer',
                      }}
                    >
                      Reset
                    </button>
                  )}
                </div>

                {/* Options Checkboxes */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, marginLeft: 'auto' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={isLooping}
                      onChange={(e) => setIsLooping(e.target.checked)}
                    />
                    Loop
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={autoPlayOnChange}
                      onChange={(e) => setAutoPlayOnChange(e.target.checked)}
                    />
                    Auto-play
                  </label>
                </div>
              </div>

              {/* Pitch Range & Permutations List */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  flex: 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span style={{ fontWeight: 600 }}>Pitch Range:</span>
                    {summary && summary.pitchRanges.length > 1 ? (
                      <select
                        value={selectedPitchRangeIndex}
                        onChange={(e) => {
                          setSelectedPitchRangeIndex(parseInt(e.target.value, 10));
                          setSelectedPermutationIndex(0);
                        }}
                        style={{
                          background: 'var(--bg-sub, #1e293b)',
                          color: '#fff',
                          border: '1px solid var(--border, #334155)',
                          borderRadius: 4,
                          padding: '2px 6px',
                        }}
                      >
                        {summary.pitchRanges.map((pr, idx) => (
                          <option key={idx} value={idx}>
                            #{idx}: {pr.name} ({pr.permutations.length} perms)
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span style={{ color: 'var(--text-dim, #94a3b8)' }}>
                        {currentPitchRange?.name || 'default'}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-dim, #94a3b8)' }}>
                    {currentPermutations.length} Permutation(s)
                  </span>
                </div>

                {/* Permutations Table */}
                <div
                  style={{
                    border: '1px solid var(--border, #334155)',
                    borderRadius: 6,
                    overflow: 'hidden',
                    background: 'var(--bg-panel, #1e293b)',
                  }}
                >
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-sub, #131c2e)', borderBottom: '1px solid #334155' }}>
                        <th style={{ padding: '8px 12px' }}>#</th>
                        <th style={{ padding: '8px 12px' }}>Name</th>
                        <th style={{ padding: '8px 12px' }}>Duration</th>
                        <th style={{ padding: '8px 12px' }}>Rate & Channels</th>
                        <th style={{ padding: '8px 12px' }}>Sample Size</th>
                        <th style={{ padding: '8px 12px' }}>Location</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentPermutations.map((perm, idx) => {
                        const isSelected = idx === selectedPermutationIndex;
                        return (
                          <tr
                            key={idx}
                            data-testid={`sound-perm-row-${idx}`}
                            onClick={() => setSelectedPermutationIndex(idx)}
                            style={{
                              background: isSelected ? 'rgba(56, 189, 248, 0.15)' : undefined,
                              borderBottom: '1px solid #334155',
                              cursor: 'pointer',
                              outline: isSelected ? '1px solid #38bdf8' : 'none',
                            }}
                          >
                            <td style={{ padding: '6px 12px', fontWeight: isSelected ? 600 : 400 }}>{idx}</td>
                            <td style={{ padding: '6px 12px', fontWeight: isSelected ? 600 : 400 }}>{perm.name}</td>
                            <td style={{ padding: '6px 12px' }}>{perm.durationSeconds.toFixed(2)}s</td>
                            <td style={{ padding: '6px 12px' }}>
                              {perm.sampleRate} Hz {perm.channels === 1 ? 'Mono' : 'Stereo'}
                            </td>
                            <td style={{ padding: '6px 12px' }}>
                              {(perm.sampleSize / 1024).toFixed(1)} KB
                            </td>
                            <td style={{ padding: '6px 12px' }}>
                              {perm.isExternal ? (
                                <span style={{ color: '#fbbf24' }}>External (sounds.map)</span>
                              ) : (
                                <span style={{ color: '#34d399' }}>Internal (Map)</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
