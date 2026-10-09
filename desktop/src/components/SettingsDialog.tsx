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

/**
 * Resource Maps settings: 3 native-file-picker rows (bitmaps.map/sounds.map/loc.map). Main
 * process owns the picker and settings.json end-to-end - this component only ever receives a
 * status back, never a path. A 4th state ("configured but not matching THIS map") is contextual
 * per-injection, not shown here - see InjectDialog's "External resource map references" group.
 */
export default function SettingsDialog({ onClose }: Props) {
  const [statuses, setStatuses] = useState<Record<ResourceMapKind, ResourceMapStatus> | null>(null);
  const [busyKind, setBusyKind] = useState<ResourceMapKind | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.opence.getResourceMapStatuses().then(setStatuses);
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
        style={{ width: 560, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 4, boxShadow: '0 10px 40px rgba(0,0,0,0.5)', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'var(--bg-panel-header)', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Settings - Resource Maps</span>
          <button data-testid="settings-dialog-close" onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 16, lineHeight: 1 }}>
            ×
          </button>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginBottom: 14 }}>
            Point OpenCE at your own Halo CE install's bitmaps.map/sounds.map/loc.map. Never guessed or auto-scanned - pick the exact files. Used to verify tags with
            external resource data before injecting them into a map (see "External resource map references" in the Inject dialog).
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
  } as const;
}
