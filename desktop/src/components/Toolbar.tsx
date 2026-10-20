import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import type { TagTestStatus } from '../../electron/shared-types';

interface Props {
  onOpen: () => void;
  canDecompress: boolean;
  canRecompress: boolean;
  canExtract: boolean;
  canInject: boolean;
  onDecompress: () => void;
  onRecompress: () => void;
  onExtract: () => void;
  onInject: () => void;
  progress: { stage: string; percent: number } | null;
}

export default function Toolbar({
  onOpen,
  canDecompress,
  canRecompress,
  canExtract,
  canInject,
  onDecompress,
  onRecompress,
  onExtract,
  onInject,
  progress,
}: Props) {
  const [tagTestStatus, setTagTestStatus] = useState<TagTestStatus>({ state: 'stopped', telnetConnected: false });

  useEffect(() => {
    window.opence.tagTestGetStatus().then(setTagTestStatus);
    return window.opence.onTagTestStatusChange((s) => setTagTestStatus(s));
  }, []);

  const handleTagTestClick = async () => {
    if (tagTestStatus.state === 'running' && tagTestStatus.telnetConnected) {
      await window.opence.tagTestHotReload();
    } else if (tagTestStatus.state === 'stopped') {
      await window.opence.tagTestLaunch({ windowed: true });
    }
  };

  const isLive = tagTestStatus.state === 'running' && tagTestStatus.telnetConnected;

  return (
    <div
      data-testid="sparkedit-toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        background: 'var(--bg-panel)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <ToolbarButton testid="open-map-toolbar-button" label="Open Map" onClick={onOpen} />
      <Divider />
      <ToolbarButton testid="decompress-button-toolbar" label="Decompress" onClick={onDecompress} disabled={!canDecompress} />
      <ToolbarButton testid="recompress-button" label="Recompress" onClick={onRecompress} disabled={!canRecompress} />
      <Divider />
      <ToolbarButton testid="toolbar-extract-button" label="Extract Tags" onClick={onExtract} disabled={!canExtract} />
      <ToolbarButton testid="toolbar-inject-button" label="Inject Tags" onClick={onInject} disabled={!canInject} />
      <Divider />

      {/* M12 OpenCE Tag Test Quick Action */}
      <button
        data-testid="toolbar-tag-test-button"
        onClick={handleTagTestClick}
        style={{
          background: isLive ? '#006064' : '#1b5e20',
          color: '#fff',
          border: isLive ? '1px solid #00acc1' : '1px solid #43a047',
          borderRadius: 3,
          padding: '5px 12px',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
        title={
          isLive
            ? 'OpenCE is running: Click to Quick Hot-Reload map in <1s (F5)'
            : 'Click to launch map directly in OpenCE with developer cheats (F5)'
        }
      >
        <span>{isLive ? '⚡' : '▶'}</span>
        <span>{isLive ? 'Hot-Reload (F5)' : 'Play In OpenCE (F5)'}</span>
        {isLive && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#4caf50',
              boxShadow: '0 0 6px #4caf50',
            }}
          />
        )}
      </button>

      <div style={{ flex: 1 }} />
      {progress && (
        <div style={{ width: 200, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap' }}>{progress.stage}</span>
          <div style={{ flex: 1, height: 6, background: 'var(--bg-main)', border: '1px solid var(--border)', borderRadius: 1, overflow: 'hidden' }}>
            <div
              data-testid="progress-bar-fill"
              style={{ height: '100%', width: `${progress.percent}%`, background: 'var(--accent-cyan)', transition: 'width 0.2s' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />;
}

function ToolbarButton({ testid, label, onClick, disabled }: { testid: string; label: string; onClick: () => void; disabled?: boolean }) {
  const style: CSSProperties = {
    background: 'var(--bg-panel-header)',
    color: disabled ? 'var(--text-dim)' : 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: 2,
    padding: '5px 12px',
    fontSize: 12,
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
  return (
    <button data-testid={testid} onClick={onClick} disabled={disabled} style={style}>
      {label}
    </button>
  );
}
