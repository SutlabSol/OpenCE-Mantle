import type { CSSProperties } from 'react';

interface Props {
  title: string;
  version: string;
  onOpen: () => void;
  hasMap: boolean;
  isCompressed: boolean;
  onDecompress: () => void;
  onRecompress: () => void;
  progress: { stage: string; percent: number } | null;
}

export default function Toolbar({ title, version, onOpen, hasMap, isCompressed, onDecompress, onRecompress, progress }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 18px',
        background: 'var(--bg-panel)',
        borderBottom: '1px solid var(--border-soft)',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 20, color: 'var(--accent-strong)', letterSpacing: 0.5 }}>OpenCE Modding Tool</div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>v{version}</div>
      <div style={{ flex: 1 }} />
      {hasMap && !isCompressed && (
        <button data-testid="recompress-button" onClick={onRecompress} style={buttonStyle()}>
          Recompress
        </button>
      )}
      {hasMap && isCompressed && (
        <button data-testid="decompress-button-toolbar" onClick={onDecompress} style={buttonStyle(true)}>
          Decompress
        </button>
      )}
      <button data-testid="open-map-toolbar-button" onClick={onOpen} style={buttonStyle()}>
        Open Map
      </button>
      {progress && (
        <div style={{ width: 180, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
            <div
              data-testid="progress-bar-fill"
              style={{ height: '100%', width: `${progress.percent}%`, background: 'var(--accent)', transition: 'width 0.2s' }}
            />
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--mono-font)' }}>{progress.percent}%</span>
        </div>
      )}
      {title && <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--mono-font)' }}>{title}</div>}
    </div>
  );
}

function buttonStyle(accentBorder = false): CSSProperties {
  return {
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    border: `1px solid ${accentBorder ? 'var(--accent)' : 'var(--border)'}`,
    borderRadius: 5,
    padding: '7px 16px',
    fontSize: 13,
    fontWeight: 500,
  };
}
