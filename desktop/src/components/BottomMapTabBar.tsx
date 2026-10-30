import type { OpenMapTabSession } from '../../electron/shared-types';

interface BottomMapTabBarProps {
  sessions: OpenMapTabSession[];
  activeSessionId: string | null;
  secondarySessionId: string | null;
  showLauncherHome: boolean;
  splitViewEnabled: boolean;
  onToggleLauncherHome: (show: boolean) => void;
  onSelectSession: (sessionId: string) => void;
  onSelectSecondarySession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onOpenNewMapTab: () => void;
  onToggleSplitView: () => void;
  onDetachSessionToWindow: (sessionId: string, coords?: { screenX?: number; screenY?: number }) => void;
}

export default function BottomMapTabBar({
  sessions,
  activeSessionId,
  secondarySessionId,
  showLauncherHome,
  splitViewEnabled,
  onToggleLauncherHome,
  onSelectSession,
  onSelectSecondarySession,
  onCloseSession,
  onOpenNewMapTab,
  onToggleSplitView,
  onDetachSessionToWindow,
}: BottomMapTabBarProps) {
  return (
    <div
      data-testid="bottom-map-tab-bar"
      style={{
        height: 29,
        background: 'var(--bg-panel-header)',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'stretch',
        fontSize: 11.5,
        userSelect: 'none',
        overflowX: 'auto',
      }}
    >
      {/* Far-left Launcher Home Tab */}
      <button
        data-testid="bottom-tab-launcher-home"
        onClick={() => onToggleLauncherHome(true)}
        style={{
          padding: '0 12px',
          background: showLauncherHome ? 'var(--selection-bg)' : 'transparent',
          border: 'none',
          borderRight: '1px solid var(--border)',
          borderTop: showLauncherHome ? '2px solid var(--accent-cyan)' : '2px solid transparent',
          color: showLauncherHome ? 'var(--accent-cyan)' : 'var(--text-secondary)',
          fontWeight: showLauncherHome ? 600 : 500,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          flexShrink: 0,
        }}
        title="Return to the Mantle Workspace Launcher Home (keeps all open maps in memory)"
      >
        <span>⌂</span>
        <span>Launcher</span>
      </button>

      {/* Open Map Session Tabs */}
      <div style={{ display: 'flex', alignItems: 'stretch', overflowX: 'auto', flex: 1 }}>
        {sessions.map((session) => {
          const isPrimary = !showLauncherHome && activeSessionId === session.sessionId;
          const isSecondary = !showLauncherHome && splitViewEnabled && secondarySessionId === session.sessionId;
          const isDetached = Boolean(session.detachedWindowId);

          return (
            <div
              key={session.sessionId}
              data-testid={`bottom-map-tab-${session.fileName}`}
              draggable
              onDragEnd={(e) => {
                const outOfBounds =
                  e.clientX < -10 ||
                  e.clientY < -10 ||
                  e.clientX > window.innerWidth + 10 ||
                  e.clientY > window.innerHeight + 10;
                if (outOfBounds) {
                  onDetachSessionToWindow(session.sessionId, {
                    screenX: e.screenX,
                    screenY: e.screenY,
                  });
                }
              }}
              onClick={() => {
                onToggleLauncherHome(false);
                onSelectSession(session.sessionId);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (splitViewEnabled && session.sessionId !== activeSessionId) {
                  onSelectSecondarySession(session.sessionId);
                }
              }}
              title={`${session.filePath}\n• Click to edit\n• Drag tab outside window (or click ↗) to open in a 2nd monitor window${
                splitViewEnabled ? '\n• Right-click to assign to Right Split Comparison Pane' : ''
              }`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '0 8px 0 11px',
                background: isPrimary
                  ? 'var(--bg-panel)'
                  : isSecondary
                  ? 'var(--selection-bg)'
                  : 'transparent',
                borderRight: '1px solid var(--border)',
                borderTop: isPrimary
                  ? '2px solid var(--accent-cyan)'
                  : isSecondary
                  ? '2px solid var(--accent-gold)'
                  : '2px solid transparent',
                color: isPrimary
                  ? 'var(--text-primary)'
                  : isSecondary
                  ? 'var(--accent-gold)'
                  : 'var(--text-secondary)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {/* Split pane indicator badge */}
              {splitViewEnabled && (isPrimary || isSecondary) && (
                <span
                  style={{
                    fontFamily: 'var(--mono-font)',
                    fontSize: 9.5,
                    fontWeight: 700,
                    padding: '0 4px',
                    borderRadius: 2,
                    background: isPrimary ? 'var(--accent-cyan)' : 'var(--accent-gold)',
                    color: '#060a10',
                  }}
                >
                  {isPrimary ? 'L' : 'R'}
                </span>
              )}

              {/* Map filename + modified asterisk */}
              <span
                style={{
                  fontFamily: 'var(--mono-font)',
                  fontSize: 11.5,
                  fontWeight: isPrimary ? 600 : 400,
                  maxWidth: 210,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {session.fileName}
                {session.modified ? ' *' : ''}
              </span>

              {isDetached && (
                <span
                  style={{
                    fontFamily: 'var(--mono-font)',
                    fontSize: 9.5,
                    padding: '0 4px',
                    background: 'var(--selection-bg)',
                    border: '1px solid var(--border-active)',
                    color: 'var(--accent-cyan)',
                    borderRadius: 2,
                  }}
                  title="Currently open in a detached 2nd-monitor window"
                >
                  2ND WIN
                </span>
              )}

              {/* Tear-off to 2nd monitor window button */}
              <button
                data-testid={`detach-map-tab-${session.fileName}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDetachSessionToWindow(session.sessionId);
                }}
                title="Tear off tab into a separate window (for dual-monitor side-by-side editing)"
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-dim)',
                  padding: '1px 3px',
                  fontSize: 10.5,
                  lineHeight: 1,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent-cyan)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-dim)')}
              >
                ↗
              </button>

              {/* Close tab button */}
              <button
                data-testid={`close-map-tab-${session.fileName}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseSession(session.sessionId);
                }}
                title="Close map tab"
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-dim)',
                  padding: '1px 4px',
                  fontSize: 10.5,
                  lineHeight: 1,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent-danger)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-dim)')}
              >
                ✕
              </button>
            </div>
          );
        })}

        {/* [+] Open Another Map in New Tab */}
        <button
          data-testid="bottom-tab-open-new-map"
          onClick={onOpenNewMapTab}
          title="Open another .map file in a new tab"
          style={{
            padding: '0 10px',
            background: 'transparent',
            border: 'none',
            borderRight: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            fontSize: 13,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          +
        </button>
      </div>

      {/* Right Side Controls: Side-by-Side Split View Comparison Toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 10px',
          borderLeft: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <button
          data-testid="bottom-tab-split-view-toggle"
          onClick={onToggleSplitView}
          style={{
            padding: '2px 9px',
            fontSize: 11,
            fontWeight: 600,
            background: splitViewEnabled ? 'var(--selection-bg)' : 'var(--bg-control)',
            border: splitViewEnabled ? '1px solid var(--border-active)' : '1px solid var(--border)',
            color: splitViewEnabled ? 'var(--accent-cyan)' : 'var(--text-secondary)',
            borderRadius: 2,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
          }}
          title="Compare two open map tabs side-by-side with a draggable vertical divider"
        >
          <span>◫</span>
          <span>Split Side-by-Side</span>
        </button>
      </div>
    </div>
  );
}
