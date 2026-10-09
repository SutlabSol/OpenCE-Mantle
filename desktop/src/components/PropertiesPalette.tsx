import type { TagEntrySummary } from '../../electron/shared-types';

interface Props {
  focusedTag: TagEntrySummary | null;
}

function Row(label: string, value: string) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 10px', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--text-dim)', fontSize: 11, textTransform: 'uppercase' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--mono-font)', textAlign: 'right', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

export default function PropertiesPalette({ focusedTag }: Props) {
  return (
    <div
      data-testid="properties-palette"
      style={{
        width: 290,
        flexShrink: 0,
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg-panel)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: '7px 10px', background: 'var(--bg-panel-header)', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
        Properties
      </div>

      {focusedTag ? (
        <div data-testid="properties-palette-content">
          {Row('Path', focusedTag.path)}
          {Row('Class', focusedTag.primaryClassName)}
          {Row('Tag ID', `0x${focusedTag.tagId.toString(16).padStart(8, '0')}`)}
          {Row('Size', focusedTag.estimatedSize !== null ? `${focusedTag.estimatedSize.toLocaleString()} bytes` : 'Unknown')}
          {Row('Resource Map', focusedTag.isExternal ? 'Yes (external)' : 'No')}

          <div style={{ padding: '10px', marginTop: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 6 }}>Dependencies</div>
            <div data-testid="properties-palette-dependencies-placeholder" style={{ fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic' }}>
              Dependency walking is available in a later milestone (M4).
            </div>
          </div>
        </div>
      ) : (
        <div data-testid="properties-palette-empty" style={{ padding: 16, fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic' }}>
          Select a tag in the hierarchy to view its properties.
        </div>
      )}
    </div>
  );
}
