import type { LoadMapResult } from '../../electron/shared-types';

export default function StatusBar({ mapState }: { mapState: LoadMapResult | null }) {
  const ok = mapState?.status === 'ok';
  const path = mapState && mapState.status !== 'error' ? mapState.filePath : '';

  return (
    <div
      data-testid="app-status-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '3px 12px',
        background: 'var(--bg-panel-header)',
        borderTop: '1px solid var(--border)',
        fontSize: 11,
        fontFamily: 'var(--mono-font)',
        color: 'var(--text-secondary)',
        height: 24,
      }}
    >
      <span data-testid="status-bar-path">{path || 'No map open'}</span>
      {ok && (
        <>
          <span data-testid="status-bar-compression">{'Decompressed'}</span>
          <span data-testid="status-bar-crc32">CRC32: 0x{mapState.header.crc32.toString(16).padStart(8, '0').toUpperCase()}</span>
          <span data-testid="status-bar-tag-count">{mapState.header.tagCount.toLocaleString()} tags</span>
        </>
      )}
      {mapState?.status === 'compressed' && <span data-testid="status-bar-compression">Compressed</span>}
    </div>
  );
}
