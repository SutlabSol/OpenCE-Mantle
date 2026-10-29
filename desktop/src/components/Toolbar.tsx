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
  onOpenLiveHudEditor?: () => void;
  onOpenHudBitmapInjector?: () => void;
  onOpenUiMapStudio?: () => void;
}

export default function Toolbar({
  onOpen,
  canExtract,
  canExtractWholeMap,
  canInject,
  onExtract,
  onExtractWholeMap,
  onInject,
  onOpenLiveHudEditor,
  onOpenHudBitmapInjector,
  onOpenUiMapStudio,
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

      {/* Spacer to push Live HUD Editing & Play in OpenCE all the way to the right side */}
      <div style={{ flex: 1 }} />

      {/* UI.map Studio (DeLa & ustr) Quick Action */}
      {onOpenUiMapStudio && (
        <button
          data-testid="toolbar-ui-map-studio-button"
          disabled={!canExtract}
          onClick={onOpenUiMapStudio}
          style={{
            background: canExtract ? '#001933' : 'transparent',
            color: canExtract ? '#93c5fd' : 'var(--text-dim)',
            border: canExtract ? '1px solid #1d4ed8' : '1px solid var(--border)',
            borderRadius: 3,
            padding: '5px 11px',
            fontSize: 12,
            fontWeight: 600,
            cursor: canExtract ? 'pointer' : 'default',
            opacity: canExtract ? 1 : 0.5,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
          title="Open UI.map & Menu Widget Studio (640×480 DeLa Canvas & Unicode String Table Editor)"
        >
          <span>🖥️</span>
          <span>UI.map Studio</span>
        </button>
      )}

      {/* Guided HUD Bitmap Injector Quick Action */}
      {onOpenHudBitmapInjector && (
        <button
          data-testid="toolbar-hud-bitmap-injector-button"
          disabled={!canInject}
          onClick={onOpenHudBitmapInjector}
          style={{
            background: canInject ? '#002244' : 'transparent',
            color: canInject ? '#60a5fa' : 'var(--text-dim)',
            border: canInject ? '1px solid #2896ff' : '1px solid var(--border)',
            borderRadius: 3,
            padding: '5px 12px',
            fontSize: 12,
            fontWeight: 600,
            cursor: canInject ? 'pointer' : 'default',
            opacity: canInject ? 1 : 0.5,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
          title="Guided HUD Bitmap Injector: Pick Weapon HUD, Vehicle HUD, or Player HUD and safely embed a replacement PNG into the open map"
        >
          <span>🖼️</span>
          <span>Inject HUD Bitmap</span>
        </button>
      )}

      {/* Live HUD Editing Button (Directly to the left of Play In OpenCE) */}
      {onOpenLiveHudEditor && (
        <button
          data-testid="toolbar-live-hud-editing-button"
          disabled={!canExtract}
          onClick={onOpenLiveHudEditor}
          style={{
            background: canExtract ? '#002244' : 'transparent',
            color: canExtract ? '#ffffff' : 'var(--text-dim)',
            border: canExtract ? '1.5px solid #2299ff' : '1px solid var(--border)',
            borderRadius: 3,
            padding: '5px 14px',
            fontSize: 12,
            fontWeight: 700,
            cursor: canExtract ? 'pointer' : 'default',
            opacity: canExtract ? 1 : 0.5,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            boxShadow: canExtract ? '0 0 8px rgba(34, 153, 255, 0.28)' : 'none',
          }}
          title="Launch Halo CE Default Style Live HUD & Weapon Tag Editor ('|' menu toggle, interactive HUD element capture & scale, live OpenCE sync)"
        >
          <span style={{ color: '#2896ff' }}>🎯</span>
          <span>Live HUD Editing</span>
        </button>
      )}

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
