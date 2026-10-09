import { useState } from 'react';

export interface WarningGroupItem {
  key: string;
  text: string;
  detail?: string[];
}

interface Props {
  title: string;
  severity: 'blocking' | 'info';
  items: WarningGroupItem[];
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** One collapsible warning category in the Dependency dialog (e.g. "Not extracted", "External data"). */
export function WarningGroup({ title, severity, items }: Props) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  return (
    <div data-testid={`warning-group-${slug(title)}`} style={{ border: '1px solid var(--border)', marginBottom: 8, borderRadius: 2 }}>
      <button
        data-testid={`warning-group-toggle-${slug(title)}`}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          textAlign: 'left',
          background: severity === 'blocking' ? 'var(--warn-bg)' : 'var(--bg-panel-header)',
          border: 'none',
          padding: '6px 10px',
          color: severity === 'blocking' ? 'var(--warn-text)' : 'var(--text-secondary)',
          fontSize: 12,
        }}
      >
        <span style={{ marginRight: 6 }}>{open ? '▾' : '▸'}</span>
        {title} ({items.length})
        {severity === 'blocking' && <strong style={{ marginLeft: 8 }}>NEEDS ATTENTION</strong>}
      </button>
      {open && (
        <div data-testid={`warning-group-items-${slug(title)}`} style={{ padding: '6px 10px' }}>
          {items.map((it) => (
            <div key={it.key} style={{ fontSize: 11.5, padding: '4px 0', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
              {it.text}
              {it.detail && it.detail.length > 0 && (
                <div style={{ color: 'var(--text-dim)', marginLeft: 12, marginTop: 2 }}>
                  {it.detail.map((d) => (
                    <div key={d}>- {d}</div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
