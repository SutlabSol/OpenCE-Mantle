import { useState, useEffect, useRef } from 'react';
import type { TagTestStatus, TagTestLogEntry } from '../../electron/shared-types';

interface Props {
  onOpenTagEditor?: (tagIndexOrPath: number | string) => void;
}

export default function TagTestPanel({ onOpenTagEditor }: Props) {
  const [status, setStatus] = useState<TagTestStatus>({ state: 'stopped', telnetConnected: false });
  const [logs, setLogs] = useState<TagTestLogEntry[]>([]);
  const [filter, setFilter] = useState<'all' | 'telnet' | 'stdout' | 'debug_txt'>('all');
  const [hsCommand, setHsCommand] = useState('');
  const [hsHistory, setHsHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [openCeDir, setOpenCeDir] = useState<string | null>(null);
  const [gameSpeed, setGameSpeed] = useState<number>(1.0);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Active cheat toggle states
  const [cheats, setCheats] = useState({
    godMode: false,
    infiniteAmmo: false,
    bottomlessClip: false,
    bumpPossession: false,
    wireframe: false,
    portals: false,
    objectBounds: false,
    aiPerception: false,
    flycam: false,
  });

  const logEndRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Poll status & fetch config on mount
  useEffect(() => {
    window.opence.tagTestGetStatus().then(setStatus);
    window.opence.getOpenCeConfig().then((cfg) => {
      setOpenCeDir(cfg.directory);
    });

    const unsubStatus = window.opence.onTagTestStatusChange((newStatus) => {
      setStatus(newStatus);
    });

    const unsubHotkey = (
      window.opence as { onTagTestHotkeyAction?: (cb: (e: { action: string; value?: boolean }) => void) => () => void }
    ).onTagTestHotkeyAction?.((evt) => {
      if (evt.action === 'godMode' && evt.value !== undefined) {
        setCheats((prev) => ({ ...prev, godMode: evt.value! }));
      } else if (evt.action === 'infiniteAmmo' && evt.value !== undefined) {
        setCheats((prev) => ({ ...prev, infiniteAmmo: evt.value!, bottomlessClip: evt.value! }));
      } else if (evt.action === 'wireframe' && evt.value !== undefined) {
        setCheats((prev) => ({ ...prev, wireframe: evt.value!, portals: evt.value! }));
      } else if (evt.action === 'aiDebug' && evt.value !== undefined) {
        setCheats((prev) => ({ ...prev, aiPerception: evt.value!, objectBounds: evt.value! }));
      }
    });

    const unsubLog = window.opence.onTagTestLog((entry) => {
      setLogs((prev) => {
        const next = [...prev, entry];
        // Keep last 1000 lines
        return next.length > 1000 ? next.slice(next.length - 1000) : next;
      });
    });

    return () => {
      unsubStatus();
      unsubHotkey?.();
      unsubLog();
    };
  }, []);

  // Auto-scroll log console
  useEffect(() => {
    if (autoScrollRef.current) {
      logEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
    }
  }, [logs]);

  const handleLaunch = async () => {
    setBusyAction('launching');
    const res = await window.opence.tagTestLaunch({ windowed: true });
    setBusyAction(null);
    if (!res.ok) {
      alert(`Could not launch OpenCE: ${res.error ?? 'Unknown error'}`);
    }
  };

  const handleStop = async () => {
    setBusyAction('stopping');
    await window.opence.tagTestStop();
    setBusyAction(null);
  };

  const handleHotReload = async () => {
    setBusyAction('reloading');
    const res = await window.opence.tagTestHotReload();
    setBusyAction(null);
    if (!res.ok) {
      alert(`Hot-reload failed: ${res.error ?? 'Unknown error'}`);
    }
  };

  const handlePickDir = async () => {
    const res = await window.opence.pickOpenCeDirectory();
    if (res.path) {
      setOpenCeDir(res.path);
    }
  };

  const sendHs = (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    window.opence.tagTestSendCommand(trimmed);
    setHsHistory((prev) => [trimmed, ...prev.filter((h) => h !== trimmed)].slice(0, 50));
    setHistoryIndex(-1);
    setHsCommand('');
  };

  const toggleCheat = (key: keyof typeof cheats, commandTrue: string, commandFalse: string) => {
    const nextVal = !cheats[key];
    setCheats((prev) => ({ ...prev, [key]: nextVal }));
    sendHs(nextVal ? commandTrue : commandFalse);
  };

  const handleSpeedChange = (val: number) => {
    setGameSpeed(val);
    sendHs(`game_speed ${val}`);
  };

  const filteredLogs = logs.filter((l) => (filter === 'all' ? true : l.source === filter));

  const isRunning = status.state === 'running' || status.state === 'launching';

  return (
    <div
      data-testid="tag-test-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-main)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-sans)',
        overflow: 'hidden',
      }}
    >
      {/* Top Banner / Action Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          background: 'var(--bg-panel-header)',
          borderBottom: '1px solid var(--border)',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--accent-cyan)' }}>
              OpenCE Tag Test
            </span>
            <StatusBadge status={status} />
          </div>
          {openCeDir && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-dim)',
                background: 'var(--bg-panel)',
                padding: '3px 8px',
                borderRadius: 3,
                border: '1px solid var(--border)',
                fontFamily: 'var(--mono-font)',
              }}
              title={openCeDir}
            >
              {openCeDir.length > 40 ? '...' + openCeDir.slice(-37) : openCeDir}
            </span>
          )}
          <button
            data-testid="tag-test-change-dir"
            onClick={handlePickDir}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 3,
              cursor: 'pointer',
            }}
          >
            Change Path...
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!isRunning ? (
            <button
              data-testid="tag-test-launch-button"
              onClick={handleLaunch}
              disabled={busyAction !== null}
              style={{
                background: '#2e7d32',
                color: '#fff',
                border: '1px solid #43a047',
                padding: '6px 14px',
                borderRadius: 4,
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>▶</span> Launch Map In OpenCE (F5)
            </button>
          ) : (
            <>
              <button
                data-testid="tag-test-hot-reload-button"
                onClick={handleHotReload}
                disabled={busyAction !== null || !status.telnetConnected}
                style={{
                  background: '#00838f',
                  color: '#fff',
                  border: '1px solid #00acc1',
                  padding: '6px 14px',
                  borderRadius: 4,
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: status.telnetConnected ? 'pointer' : 'not-allowed',
                  opacity: status.telnetConnected ? 1 : 0.6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
                title="Pushes your in-memory edits straight to disk and reloads the map inside OpenCE in <1 second"
              >
                <span>⚡</span> Quick Hot-Reload (&lt;1s)
              </button>
              <button
                data-testid="tag-test-stop-button"
                onClick={handleStop}
                disabled={busyAction !== null}
                style={{
                  background: '#c62828',
                  color: '#fff',
                  border: '1px solid #e53935',
                  padding: '6px 12px',
                  borderRadius: 4,
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                ■ Stop Engine
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Content Split: Left Controls / Right Terminal & Logs */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Left Side: Live Cheats & Controls (width: 320px) */}
        <div
          style={{
            width: 330,
            background: 'var(--bg-panel)',
            borderRight: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            padding: 12,
            gap: 14,
          }}
        >
          {/* Quick Cheats & Toggles */}
          <div>
            <SectionHeader title="Developer Cheats & Toggles" />
            <div
              data-testid="tag-test-hotkey-banner"
              style={{
                marginTop: 6,
                marginBottom: 8,
                padding: '6px 8px',
                borderRadius: 4,
                background: 'rgba(56, 189, 248, 0.12)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                fontSize: 10.5,
                color: '#38bdf8',
                lineHeight: 1.45,
              }}
            >
              <strong>In-Game Global Hotkeys:</strong>
              <br />
              • <strong>F7</strong>: God Mode | <strong>F8</strong>: Infinite Ammo | <strong>F9</strong>: Wireframe | <strong>F10</strong>: AI Debug
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
              <ToggleCheckbox
                testid="tag-test-cheat-god"
                label="God Mode (Deathless Player)"
                checked={cheats.godMode}
                disabled={!status.telnetConnected}
                onChange={() => toggleCheat('godMode', 'cheat_deathless_player 1', 'cheat_deathless_player 0')}
              />
              <ToggleCheckbox
                testid="tag-test-cheat-ammo"
                label="Infinite Ammo"
                checked={cheats.infiniteAmmo}
                disabled={!status.telnetConnected}
                onChange={() => toggleCheat('infiniteAmmo', 'cheat_infinite_ammo 1', 'cheat_infinite_ammo 0')}
              />
              <ToggleCheckbox
                testid="tag-test-cheat-clip"
                label="Bottomless Clip (No Reload)"
                checked={cheats.bottomlessClip}
                disabled={!status.telnetConnected}
                onChange={() => toggleCheat('bottomlessClip', 'cheat_bottomless_clip 1', 'cheat_bottomless_clip 0')}
              />
              <ToggleCheckbox
                testid="tag-test-cheat-possession"
                label="Bump Possession (Possess Any Biped)"
                checked={cheats.bumpPossession}
                disabled={!status.telnetConnected}
                onChange={() => toggleCheat('bumpPossession', 'cheat_bump_possession 1', 'cheat_bump_possession 0')}
              />
              <ToggleCheckbox
                testid="tag-test-cheat-flycam"
                label="Flycam Mode (WIP)"
                checked={false}
                disabled={true}
                onChange={() => {}}
              />
              <ToggleCheckbox
                testid="tag-test-cheat-wireframe"
                label="Wireframe Mesh Overlay"
                checked={cheats.wireframe}
                disabled={!status.telnetConnected}
                onChange={() => toggleCheat('wireframe', 'rasterizer_wireframe 1', 'rasterizer_wireframe 0')}
              />
              <ToggleCheckbox
                testid="tag-test-cheat-portals"
                label="BSP Portals & Clusters Debug"
                checked={cheats.portals}
                disabled={!status.telnetConnected}
                onChange={() => toggleCheat('portals', 'debug_portals 1', 'debug_portals 0')}
              />
              <ToggleCheckbox
                testid="tag-test-cheat-objects"
                label="Object Bounds & Collision Trees"
                checked={cheats.objectBounds}
                disabled={!status.telnetConnected}
                onChange={() => toggleCheat('objectBounds', 'debug_objects 1', 'debug_objects 0')}
              />
              <ToggleCheckbox
                testid="tag-test-cheat-ai"
                label="AI Perception & Pathfinding Render"
                checked={cheats.aiPerception}
                disabled={!status.telnetConnected}
                onChange={() => toggleCheat('aiPerception', 'ai_render 1', 'ai_render 0')}
              />
            </div>
          </div>

          {/* Quick Spawns */}
          <div>
            <SectionHeader title="Quick Spawns & Actions" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
              <ActionButton
                testid="tag-test-teleport-cam"
                label="📍 Teleport to Camera"
                disabled={!status.telnetConnected}
                onClick={() => sendHs('cheat_teleport_to_camera')}
              />
              <ActionButton
                testid="tag-test-all-weapons"
                label="🔫 All Weapons"
                disabled={!status.telnetConnected}
                onClick={() => sendHs('cheat_all_weapons')}
              />
              <ActionButton
                testid="tag-test-all-vehicles"
                label="🚙 All Vehicles"
                disabled={!status.telnetConnected}
                onClick={() => sendHs('cheat_all_vehicles')}
              />
            </div>
          </div>

          {/* Game Speed Control */}
          <div>
            <SectionHeader title={`Game Speed: ${gameSpeed.toFixed(1)}x`} />
            <div style={{ marginTop: 6 }}>
              <input
                data-testid="tag-test-speed-slider"
                type="range"
                min="0.0"
                max="4.0"
                step="0.1"
                value={gameSpeed}
                disabled={!status.telnetConnected}
                onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--accent-cyan)' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4, marginTop: 4 }}>
                {[
                  { label: 'Pause', val: 0.0 },
                  { label: '0.5x', val: 0.5 },
                  { label: '1.0x', val: 1.0 },
                  { label: '2.0x', val: 2.0 },
                  { label: '4.0x', val: 4.0 },
                ].map((s) => (
                  <button
                    key={s.label}
                    disabled={!status.telnetConnected}
                    onClick={() => handleSpeedChange(s.val)}
                    style={{
                      flex: 1,
                      padding: '3px 0',
                      fontSize: 10,
                      background: gameSpeed === s.val ? 'var(--accent-cyan)' : 'var(--bg-main)',
                      color: gameSpeed === s.val ? '#000' : 'var(--text-secondary)',
                      border: '1px solid var(--border)',
                      borderRadius: 2,
                      cursor: status.telnetConnected ? 'pointer' : 'not-allowed',
                      fontWeight: gameSpeed === s.val ? 700 : 500,
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Map Status Info */}
          <div style={{ marginTop: 'auto', padding: 8, background: 'var(--bg-main)', border: '1px solid var(--border)', borderRadius: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Live Staged Map</div>
            <div style={{ fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--accent-cyan)' }}>
              {status.mapName ? `${status.mapName}.map` : 'None staged'}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 4 }}>
              Hot-reload dynamically switches between ping-pong map slots to bypass Windows file locks.
            </div>
          </div>
        </div>

        {/* Right Side: Interactive HaloScript Console & Real-time Logs */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: '#121316' }}>
          {/* Log Controls Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 12px',
              background: 'var(--bg-panel-header)',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)' }}>Filters:</span>
              {(['all', 'telnet', 'stdout', 'debug_txt'] as const).map((mode) => (
                <button
                  key={mode}
                  data-testid={`tag-test-filter-${mode}`}
                  onClick={() => setFilter(mode)}
                  style={{
                    background: filter === mode ? 'var(--accent-cyan)' : 'transparent',
                    color: filter === mode ? '#000' : 'var(--text-dim)',
                    border: '1px solid var(--border)',
                    padding: '2px 8px',
                    borderRadius: 3,
                    fontSize: 11,
                    fontWeight: filter === mode ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {mode === 'all'
                    ? 'All'
                    : mode === 'telnet'
                      ? 'Telnet Console'
                      : mode === 'stdout'
                        ? 'Engine Output'
                        : 'Diagnostics (debug.txt)'}
                </button>
              ))}
            </div>

            <button
              data-testid="tag-test-clear-logs"
              onClick={() => setLogs([])}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-dim)',
                padding: '2px 8px',
                borderRadius: 3,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Clear Log
            </button>
          </div>

          {/* Log Console Body */}
          <div
            data-testid="tag-test-log-console"
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '10px 14px',
              fontFamily: 'var(--mono-font)',
              fontSize: 11.5,
              lineHeight: 1.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {filteredLogs.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', padding: 20, textAlign: 'center' }}>
                {isRunning
                  ? 'Waiting for engine and telnet output...'
                  : 'OpenCE is offline. Click "Launch Map In OpenCE" above or press F5 to boot the game with live developer console.'}
              </div>
            ) : (
              filteredLogs.map((entry, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span
                    style={{
                      fontSize: 10,
                      padding: '1px 5px',
                      borderRadius: 2,
                      fontWeight: 600,
                      flexShrink: 0,
                      background:
                        entry.source === 'telnet'
                          ? '#1b5e20'
                          : entry.source === 'debug_txt'
                            ? '#e65100'
                            : '#263238',
                      color: '#fff',
                    }}
                  >
                    {entry.source === 'telnet' ? 'TELNET' : entry.source === 'debug_txt' ? 'DIAG' : 'ENGINE'}
                  </span>
                  <span style={{ color: getLogColor(entry), wordBreak: 'break-all', flex: 1 }}>
                    {entry.text}
                    {entry.tagPathLink && (
                      <button
                        data-testid="tag-link"
                        onClick={() => onOpenTagEditor?.(entry.tagPathLink!)}
                        style={{
                          background: 'rgba(0, 229, 255, 0.15)',
                          border: '1px solid var(--accent-cyan)',
                          color: 'var(--accent-cyan)',
                          borderRadius: 2,
                          padding: '0 4px',
                          marginLeft: 6,
                          fontSize: 10.5,
                          cursor: 'pointer',
                        }}
                        title="Click to view/edit this tag in the Tag Field Editor"
                      >
                        inspect {entry.tagPathLink} ↗
                      </button>
                    )}
                  </span>
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>

          {/* Interactive HaloScript Terminal Bar */}
          <div
            style={{
              padding: '8px 12px',
              background: 'var(--bg-panel-header)',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ fontFamily: 'var(--mono-font)', fontWeight: 700, color: 'var(--accent-cyan)', fontSize: 12 }}>
              hs&gt;
            </span>
            <input
              data-testid="tag-test-hs-input"
              type="text"
              value={hsCommand}
              disabled={!status.telnetConnected}
              placeholder={
                status.telnetConnected
                  ? 'Type HaloScript expression (e.g. cheat_deathless_player 1, cls, help)...'
                  : 'Telnet console offline. Launch OpenCE to send live HaloScript expressions.'
              }
              onChange={(e) => setHsCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  sendHs(hsCommand);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  if (hsHistory.length > 0) {
                    const nextIdx = Math.min(historyIndex + 1, hsHistory.length - 1);
                    setHistoryIndex(nextIdx);
                    setHsCommand(hsHistory[nextIdx]);
                  }
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  if (historyIndex > 0) {
                    const nextIdx = historyIndex - 1;
                    setHistoryIndex(nextIdx);
                    setHsCommand(hsHistory[nextIdx]);
                  } else if (historyIndex === 0) {
                    setHistoryIndex(-1);
                    setHsCommand('');
                  }
                }
              }}
              style={{
                flex: 1,
                background: '#0d0e11',
                border: '1px solid var(--border)',
                borderRadius: 3,
                color: '#fff',
                fontFamily: 'var(--mono-font)',
                fontSize: 12,
                padding: '6px 10px',
                outline: 'none',
              }}
            />
            <button
              data-testid="tag-test-hs-send"
              disabled={!status.telnetConnected || !hsCommand.trim()}
              onClick={() => sendHs(hsCommand)}
              style={{
                background: 'var(--accent-cyan)',
                color: '#000',
                border: 'none',
                borderRadius: 3,
                padding: '6px 14px',
                fontWeight: 700,
                fontSize: 12,
                cursor: status.telnetConnected && hsCommand.trim() ? 'pointer' : 'not-allowed',
                opacity: status.telnetConnected && hsCommand.trim() ? 1 : 0.5,
              }}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: TagTestStatus }) {
  if (status.state === 'stopped') {
    return (
      <span
        data-testid="tag-test-status-badge"
        style={{
          fontSize: 10,
          fontWeight: 700,
          background: 'rgba(255, 255, 255, 0.1)',
          color: 'var(--text-dim)',
          padding: '2px 7px',
          borderRadius: 10,
          border: '1px solid var(--border)',
        }}
      >
        OFFLINE
      </span>
    );
  }
  if (status.state === 'launching') {
    return (
      <span
        data-testid="tag-test-status-badge"
        style={{
          fontSize: 10,
          fontWeight: 700,
          background: 'rgba(255, 179, 0, 0.2)',
          color: '#ffb300',
          padding: '2px 7px',
          borderRadius: 10,
          border: '1px solid #ffb300',
        }}
      >
        LAUNCHING...
      </span>
    );
  }
  if (status.telnetConnected) {
    return (
      <span
        data-testid="tag-test-status-badge"
        style={{
          fontSize: 10,
          fontWeight: 700,
          background: 'rgba(76, 175, 80, 0.2)',
          color: '#4caf50',
          padding: '2px 7px',
          borderRadius: 10,
          border: '1px solid #4caf50',
          boxShadow: '0 0 8px rgba(76, 175, 80, 0.3)',
        }}
      >
        LIVE • TELNET CONNECTED (PORT 2323)
      </span>
    );
  }
  return (
    <span
      data-testid="tag-test-status-badge"
      style={{
        fontSize: 10,
        fontWeight: 700,
        background: 'rgba(33, 150, 243, 0.2)',
        color: '#2196f3',
        padding: '2px 7px',
        borderRadius: 10,
        border: '1px solid #2196f3',
      }}
    >
      ENGINE RUNNING (CONNECTING TELNET...)
    </span>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: 'var(--text-secondary)',
        borderBottom: '1px solid var(--border)',
        paddingBottom: 4,
      }}
    >
      {title}
    </div>
  );
}

function ToggleCheckbox({
  testid,
  label,
  checked,
  disabled,
  onChange,
}: {
  testid: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <label
      data-testid={testid}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 11.5,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        userSelect: 'none',
        padding: '3px 0',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        style={{ accentColor: 'var(--accent-cyan)' }}
      />
      <span style={{ color: checked ? 'var(--accent-cyan)' : 'var(--text-primary)' }}>{label}</span>
    </label>
  );
}

function ActionButton({
  testid,
  label,
  disabled,
  onClick,
}: {
  testid: string;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      data-testid={testid}
      disabled={disabled}
      onClick={onClick}
      style={{
        background: 'var(--bg-main)',
        border: '1px solid var(--border)',
        borderRadius: 3,
        color: 'var(--text-primary)',
        padding: '6px 8px',
        fontSize: 11,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        textAlign: 'center',
      }}
    >
      {label}
    </button>
  );
}

function getLogColor(entry: TagTestLogEntry): string {
  if (entry.text.includes('error') || entry.text.includes('Error') || entry.text.includes('cannot load')) {
    return '#ef5350';
  }
  if (entry.text.includes('warn') || entry.text.includes('Warning') || entry.text.includes('corrected:')) {
    return '#ffca28';
  }
  if (entry.source === 'telnet') {
    return '#81c784';
  }
  return '#cfd8dc';
}
