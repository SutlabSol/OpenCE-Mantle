import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import type { TagTestStatus } from '../../electron/shared-types';

interface Props {
  onOpen: () => void;
  canExtract: boolean;
  canExtractWholeMap: boolean;
  canInject: boolean;
  onExtract: () => void;
  onExtractWholeMap: () => void;
  onInject: () => void;
  progress: { stage: string; percent: number } | null;
}

export default function Toolbar({
  onOpen,
  canExtract,
  canExtractWholeMap,
  canInject,
  onExtract,
  onExtractWholeMap,
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
      <ToolbarButton testid="toolbar-extract-button" label="Extract Tags" onClick={onExtract} disabled={!canExtract} />
      <ToolbarButton testid="toolbar-extract-whole-button" label="Extract Whole Map" onClick={onExtractWholeMap} disabled={!canExtractWholeMap} />
      <ToolbarButton testid="toolbar-inject-button" label="Inject Tags" onClick={onInject} disabled={!canInject} />

      {/* Spacer to push Play in OpenCE all the way to the right side */}
      <div style={{ flex: 1 }} />

      {/* M12 OpenCE Tag Test Quick Action */}
      <button
        data-testid="toolbar-tag-test-button"
        onClick={handleTagTestClick}
        style={{
          background: isLive ? '#006064' : '#1b5e20',
          color: '#fff',
          border: isLive ? '1px solid #00acc1' : '1px solid #43a047',
          borderRadius: 3,
          padding: '5px 14px',
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
    </div>
  );
}

function ToolbarButton({
  testid,
  label,
  onClick,
  disabled,
}: {
  testid: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const style: CSSProperties = {
    background: hover && !disabled ? 'var(--bg-hover)' : 'transparent',
    color: disabled ? 'var(--text-dim)' : 'var(--text-primary)',
    border: '1px solid transparent',
    borderRadius: 3,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 500,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };
  return (
    <button
      data-testid={testid}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={style}
    >
      {label}
    </button>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />;
}
