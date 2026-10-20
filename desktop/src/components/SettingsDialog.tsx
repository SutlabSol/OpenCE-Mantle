import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ResourceMapKind, ResourceMapStatus } from '../../electron/shared-types';

interface Props {
  onClose: () => void;
}

const ROWS: { kind: ResourceMapKind; fileName: string; note: string }[] = [
  { kind: 'bitmaps', fileName: 'bitmaps.map', note: 'Required for mipmap-level bitmap data referenced from internal (non-indexed) bitmap tags.' },
  { kind: 'sounds', fileName: 'sounds.map', note: 'Required for sound sample data referenced from internal (non-indexed) sound tags.' },
  { kind: 'loc', fileName: 'loc.map', note: 'Required for whole-tag-indexed font/unicode_string_list/ui_widget_definition/hud_message_text tags.' },
];

function formatStatus(status: ResourceMapStatus | undefined): { text: string; tone: 'dim' | 'ok' | 'error' } {
  if (!status) return { text: 'Checking...', tone: 'dim' };
  if (status.state === 'not-configured') return { text: 'Not configured', tone: 'dim' };
  if (status.state === 'missing-or-unreadable') return { text: `${status.path} - ${status.error}`, tone: 'error' };
  return { text: `${status.path} (${status.entryCount} entries)`, tone: 'ok' };
}

export default function SettingsDialog({ onClose }: Props) {
  const [statuses, setStatuses] = useState<Record<ResourceMapKind, ResourceMapStatus> | null>(null);
  const [busyKind, setBusyKind] = useState<ResourceMapKind | null>(null);
  const [openCeConfig, setOpenCeConfig] = useState<{ directory: string | null; executable: string | null; exists: boolean } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.opence.getResourceMapStatuses().then(setStatuses);
    window.opence.getOpenCeConfig().then(setOpenCeConfig);
  }, []);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const handlePick = async (kind: ResourceMapKind) => {
    setBusyKind(kind);
    const res = await window.opence.pickResourceMap(kind);
    setBusyKind(null);
    if (res.ok) setStatuses((prev) => (prev ? { ...prev, [kind]: res.status } : prev));
  };

  const handlePickOpenCeDir = async () => {
    const res = await window.opence.pickOpenCeDirectory();
    if (res.path) {
      const cfg = await window.opence.getOpenCeConfig();
      setOpenCeConfig(cfg);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div
        ref={dialogRef}
        data-testid="settings-dialog"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        style={{ width: 580, maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 4, boxShadow: '0 10px 40px rgba(0,0,0,0.5)', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'var(--bg-panel-header)', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Settings</span>
          <button data-testid="settings-dialog-close" onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 16, lineHeight: 1, cursor: 'pointer' }}>
            ×
          </button>
        </div>
        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          {/* OpenCE Engine Section */}
          <div style={{ marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>OpenCE Installation Directory</span>
              <button data-testid="settings-pick-opence-dir" onClick={handlePickOpenCeDir} style={buttonStyle()}>
                Browse Folder...
              </button>
            </div>
            <div
              data-testid="settings-status-opence-dir"
              style={{
                fontSize: 11.5,
                fontFamily: 'var(--mono-font)',
                color: openCeConfig?.exists ? 'var(--success-text)' : 'var(--error-text)',
                wordBreak: 'break-all',
                marginBottom: 4,
              }}
            >
              {openCeConfig?.directory ? (
                openCeConfig.exists ? (
                  `✓ ${openCeConfig.directory} (halo.exe found)`
                ) : (
                  `✗ ${openCeConfig.directory} (halo.exe missing)`
                )
              ) : (
                'Not configured (OpenCE directory not found)'
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              Folder containing halo.exe and custom_maps\. Required for "Launch Map In OpenCE Tag Test" (F5) and live Telnet control.
            </div>
          </div>

          {/* Resource Maps Section */}
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Resource Maps</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginBottom: 14 }}>
            Point OpenCE at your Halo CE install's bitmaps.map/sounds.map/loc.map. Used to verify tags with
            external resource data before injecting them into a map.
          </div>
          {ROWS.map((row) => {
            const status = formatStatus(statuses?.[row.kind]);
            return (
              <div key={row.kind} data-testid={`settings-row-${row.kind}`} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{row.fileName}</span>
                  <button data-testid={`settings-pick-${row.kind}`} disabled={busyKind === row.kind} onClick={() => handlePick(row.kind)} style={buttonStyle()}>
                    {busyKind === row.kind ? 'Checking...' : 'Pick...'}
                  </button>
                </div>
                <div
                  data-testid={`settings-status-${row.kind}`}
                  style={{
                    fontSize: 11.5,
                    fontFamily: status.tone === 'ok' || status.tone === 'error' ? 'var(--mono-font)' : undefined,
                    color: status.tone === 'error' ? 'var(--error-text)' : status.tone === 'ok' ? 'var(--success-text)' : 'var(--text-dim)',
                    wordBreak: 'break-all',
                    marginBottom: 4,
                  }}
                >
                  {status.text}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{row.note}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          <button data-testid="settings-dialog-done" onClick={onClose} style={buttonStyle(true)}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function buttonStyle(primary = false) {
  return {
    background: primary ? 'var(--accent-cyan)' : 'var(--bg-panel-header)',
    color: primary ? '#06202c' : 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: 2,
    padding: '6px 14px',
    fontSize: 12,
    cursor: 'pointer',
  } as const;
}
