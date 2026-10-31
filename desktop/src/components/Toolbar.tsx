import { useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { MapFixActionKind, TagTestStatus } from '../../electron/shared-types';

interface Props {
  onOpen: () => void;
  canExtract: boolean;
  canExtractWholeMap: boolean;
  canInject: boolean;
  onExtract: () => void;
  onExtractWholeMap: () => void;
  onInject: () => void;
  onRunMapFixAction?: (action: MapFixActionKind) => void;
  onOpenLiveHudEditor?: () => void;
  onOpenHudBitmapInjector?: () => void;
  onOpenUiMapStudio?: () => void;
}

const FIX_MENU_ITEMS: Array<{ action: MapFixActionKind; label: string; subtitle: string }> = [
  {
    action: 'ce',
    label: 'Fix CE Map',
    subtitle: 'HaloScript AST fixer (hs_syntax_data) + Custom Edition CRC32 (0x64)',
  },
  {
    action: 'mcc',
    label: 'Fix MCC Map',
    subtitle: 'Convert Halo MCC CEA (v13 -> CE v609) + H1EK tag & AST fix + CRC32',
  },
  {
    action: 'demo',
    label: 'Fix Halo Demo Map',
    subtitle: 'Convert Halo Trial / Mac Demo (v6 -> CE v609) + AST fix + CRC32',
  },
  {
    action: 'halomd',
    label: 'Fix Halo MD Map',
    subtitle: 'Convert HaloMD Mac Retail (v7 -> CE v609) + AST fix + CRC32',
  },
  {
    action: 'xbox',
    label: 'Fix Xbox Map',
    subtitle: 'Convert Original Halo Xbox (v5 -> CE v609) + AST fix + CRC32',
  },
];

export default function Toolbar({
  onOpen,
  canExtract,
  canExtractWholeMap,
  canInject,
  onExtract,
  onExtractWholeMap,
  onInject,
  onRunMapFixAction,
  onOpenLiveHudEditor,
  onOpenHudBitmapInjector,
  onOpenUiMapStudio,
}: Props) {
  const [tagTestStatus, setTagTestStatus] = useState<TagTestStatus>({ state: 'stopped', telnetConnected: false });
  const [fixesMenuOpen, setFixesMenuOpen] = useState(false);
  const fixesDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.opence.tagTestGetStatus().then(setTagTestStatus);
    return window.opence.onTagTestStatusChange((s) => setTagTestStatus(s));
  }, []);

  useEffect(() => {
    if (!fixesMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (fixesDropdownRef.current && !fixesDropdownRef.current.contains(e.target as Node)) {
        setFixesMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFixesMenuOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [fixesMenuOpen]);

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
      {onRunMapFixAction && (
        <>
          <Divider />
          <div ref={fixesDropdownRef} style={{ position: 'relative' }}>
            <button
              data-testid="toolbar-fixes-dropdown-button"
              onClick={() => setFixesMenuOpen((prev) => !prev)}
              style={{
                background: fixesMenuOpen ? 'var(--selection-bg)' : 'transparent',
                color: fixesMenuOpen ? 'var(--accent-cyan)' : 'var(--text-primary)',
                border: fixesMenuOpen ? '1px solid var(--border-active)' : '1px solid var(--border)',
                borderRadius: 3,
                padding: '4px 11px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
              title="Fixes Menu: Fix CE Map, Fix MCC Map, Fix Halo Demo Map, Fix Halo MD Map, Fix Xbox Map"
            >
              <span>🔧</span>
              <span>Fixes</span>
              <span style={{ fontSize: 10, opacity: 0.75 }}>▾</span>
            </button>
            {fixesMenuOpen && (
              <div
                data-testid="toolbar-fixes-dropdown-menu"
                role="menu"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  left: 0,
                  minWidth: 320,
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.75)',
                  zIndex: 9999,
                  padding: '4px 0',
                }}
              >
                {FIX_MENU_ITEMS.map((item) => (
                  <button
                    key={item.action}
                    data-testid={`toolbar-fix-${item.action}`}
                    onClick={() => {
                      setFixesMenuOpen(false);
                      onRunMapFixAction(item.action);
                    }}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: 2,
                      width: '100%',
                      textAlign: 'left',
                      background: 'transparent',
                      border: 'none',
                      padding: '8px 14px',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      fontFamily: 'var(--ui-font)',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--selection-bg)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{item.label}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{item.subtitle}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Spacer to push Live HUD Editing & Play in OpenCE all the way to the right side */}
      <div style={{ flex: 1 }} />

      {/* UI.map Studio (DeLa & ustr) Quick Action */}
      {onOpenUiMapStudio && (
        <button
          data-testid="toolbar-ui-map-studio-button"
          disabled={!canExtract}
          onClick={onOpenUiMapStudio}
          style={{
            background: canExtract ? 'var(--selection-bg)' : 'transparent',
            color: canExtract ? 'var(--accent-cyan)' : 'var(--text-dim)',
            border: canExtract ? '1px solid var(--border-active)' : '1px solid var(--border)',
            borderRadius: 3,
            padding: '5px 11px',
            fontSize: 12,
            fontWeight: 600,
            cursor: canExtract ? 'pointer' : 'default',
            opacity: canExtract ? 1 : 0.5,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            flexShrink: 0,
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
            background: canInject ? 'var(--selection-bg)' : 'transparent',
            color: canInject ? 'var(--accent-cyan)' : 'var(--text-dim)',
            border: canInject ? '1px solid var(--border-active)' : '1px solid var(--border)',
            borderRadius: 3,
            padding: '5px 12px',
            fontSize: 12,
            fontWeight: 600,
            cursor: canInject ? 'pointer' : 'default',
            opacity: canInject ? 1 : 0.5,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
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
            background: canExtract ? 'var(--selection-bg)' : 'transparent',
            color: canExtract ? 'var(--text-primary)' : 'var(--text-dim)',
            border: canExtract ? '1.5px solid var(--border-active)' : '1px solid var(--border)',
            borderRadius: 3,
            padding: '5px 14px',
            fontSize: 12,
            fontWeight: 700,
            cursor: canExtract ? 'pointer' : 'default',
            opacity: canExtract ? 1 : 0.5,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
          }}
          title="Launch Halo CE Default Style Live HUD & Weapon Tag Editor ('|' menu toggle, interactive HUD element capture & scale, live OpenCE sync)"
        >
          <span style={{ color: 'var(--accent-cyan)' }}>🎯</span>
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
