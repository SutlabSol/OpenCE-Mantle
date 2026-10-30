import logoUrl from '../assets/logo.png';

interface HelpAboutModalProps {
  appVersion: string;
  onOpenTutorials?: () => void;
  onOpenGlossary?: () => void;
  onOpenCommunity?: () => void;
  onClose: () => void;
}

const KEYBOARD_SHORTCUTS = [
  { keys: 'Ctrl + O', action: 'Open a Halo .map or .bak cache file' },
  { keys: 'Ctrl + S', action: 'Save in-memory edits to the active .map file' },
  { keys: 'Ctrl + Shift + S', action: 'Save As a new .map cache file' },
  { keys: 'Ctrl + E', action: 'Extract selected tag(s) with recursive dependencies' },
  { keys: 'Right-Click + WASD', action: 'Fly camera through the 3D BSP Viewport (Shift = fast, Q/E = down/up)' },
  { keys: 'G / R (in 3D View)', action: 'Switch between Translate (Move) and Rotate gizmos on selected object' },
  { keys: 'Ctrl + D (in 3D View)', action: 'Duplicate the selected scenario object placement in-place' },
  { keys: 'Delete (in 3D View)', action: 'Delete the selected scenario object placement' },
];

export default function HelpAboutModal({
  appVersion,
  onOpenTutorials,
  onOpenGlossary,
  onOpenCommunity,
  onClose,
}: HelpAboutModalProps) {
  const openExternal = (url: string) => {
    window.opence?.openExternalUrl?.(url);
  };

  return (
    <div
      data-testid="help-about-modal-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1200,
      }}
    >
      <div
        data-testid="help-about-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 680,
          maxWidth: '94vw',
          maxHeight: '86vh',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 2,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.65)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 16px',
            background: 'var(--bg-panel-header)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src={logoUrl} alt="OpenCE Mantle" style={{ width: 18, height: 18 }} />
            <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-primary)' }}>
              Help &amp; About OpenCE Mantle
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              padding: '4px 10px',
              borderRadius: 2,
              fontSize: 12,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Hero banner */}
          <div
            style={{
              padding: 14,
              background: 'var(--bg-control)',
              border: '1px solid var(--border)',
              borderRadius: 2,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <img src={logoUrl} alt="Mantle" style={{ width: 46, height: 46, objectFit: 'contain' }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                  OpenCE Mantle
                </span>
                <span
                  style={{
                    fontFamily: 'var(--mono-font)',
                    fontSize: 11,
                    padding: '1px 7px',
                    background: 'var(--selection-bg)',
                    border: '1px solid var(--border-active)',
                    color: 'var(--accent-cyan)',
                    borderRadius: 2,
                  }}
                >
                  v{appVersion || '0.6.9'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.45 }}>
                All-in-one Halo: Combat Evolved &amp; Custom Edition cache map editor, tag studio, 3D BSP viewport,
                cross-edition converter, and live in-game HUD/weapon memory workbench.
              </div>
            </div>
          </div>

          {/* Official Links Row */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                color: 'var(--text-secondary)',
                marginBottom: 8,
              }}
            >
              Official Community &amp; Repository Links
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <button
                onClick={() => openExternal('https://discord.com/invite/opence')}
                style={{
                  padding: '9px 10px',
                  background: 'var(--bg-control)',
                  border: '1px solid var(--border)',
                  borderRadius: 2,
                  color: 'var(--text-primary)',
                  textAlign: 'left',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--accent-cyan)' }}>OpenCE Discord ↗</div>
                <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                  discord.com/invite/opence
                </div>
              </button>

              <button
                onClick={() => openExternal('https://github.com/SutlabSol/OpenCE-Mantle')}
                style={{
                  padding: '9px 10px',
                  background: 'var(--bg-control)',
                  border: '1px solid var(--border)',
                  borderRadius: 2,
                  color: 'var(--text-primary)',
                  textAlign: 'left',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--accent-cyan)' }}>Mantle GitHub ↗</div>
                <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                  SutlabSol/OpenCE-Mantle
                </div>
              </button>

              <button
                onClick={() => openExternal('https://halostats.cc/')}
                style={{
                  padding: '9px 10px',
                  background: 'var(--bg-control)',
                  border: '1px solid var(--border)',
                  borderRadius: 2,
                  color: 'var(--text-primary)',
                  textAlign: 'left',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--accent-cyan)' }}>HaloStats ↗</div>
                <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                  halostats.cc
                </div>
              </button>
            </div>
          </div>

          {/* Keyboard Shortcuts Table */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                color: 'var(--text-secondary)',
                marginBottom: 8,
              }}
            >
              Keyboard Shortcuts &amp; 3D Viewport Controls
            </div>
            <div
              style={{
                border: '1px solid var(--border)',
                background: 'var(--bg-control)',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              {KEYBOARD_SHORTCUTS.map((sc, idx) => (
                <div
                  key={sc.keys}
                  style={{
                    padding: '6px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: idx < KEYBOARD_SHORTCUTS.length - 1 ? '1px solid var(--border)' : 'none',
                    fontSize: 12,
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--mono-font)',
                      fontSize: 11,
                      padding: '1px 6px',
                      background: 'var(--bg-panel-header)',
                      border: '1px solid var(--border)',
                      color: 'var(--accent-cyan)',
                      borderRadius: 2,
                    }}
                  >
                    {sc.keys}
                  </span>
                  <span style={{ color: 'var(--text-secondary)' }}>{sc.action}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '10px 16px',
            background: 'var(--bg-panel-header)',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            {onOpenTutorials && (
              <button
                onClick={() => {
                  onClose();
                  onOpenTutorials();
                }}
                style={{
                  padding: '4px 10px',
                  fontSize: 11.5,
                  background: 'var(--bg-control)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  borderRadius: 2,
                }}
              >
                Open Tutorials Hub
              </button>
            )}
            {onOpenGlossary && (
              <button
                onClick={() => {
                  onClose();
                  onOpenGlossary();
                }}
                style={{
                  padding: '4px 10px',
                  fontSize: 11.5,
                  background: 'var(--bg-control)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  borderRadius: 2,
                }}
              >
                Open UI Glossary
              </button>
            )}
            {onOpenCommunity && (
              <button
                onClick={() => {
                  onClose();
                  onOpenCommunity();
                }}
                style={{
                  padding: '4px 10px',
                  fontSize: 11.5,
                  background: 'var(--bg-control)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  borderRadius: 2,
                }}
              >
                Community Hub
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '5px 16px',
              background: 'var(--selection-bg)',
              border: '1px solid var(--border-active)',
              color: 'var(--text-primary)',
              fontWeight: 600,
              fontSize: 12,
              borderRadius: 2,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
