import type { LoadMapResult } from '../../electron/shared-types';
import { isBackupFilePath } from '../../electron/map-file-rules';

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
      {ok && mapState.modified && (
        <span data-testid="status-bar-modified" title="Injected changes are in memory only. Use File > Save or Save As." style={{ color: 'var(--warn-text)', fontWeight: 600 }}>
          Modified (not saved)
        </span>
      )}
      {ok && isBackupFilePath(path) && (
        <span data-testid="status-bar-backup-file" title="Opened from a backup file: File > Save is disabled, use Save As.">
          Backup file
        </span>
      )}
      {ok && (
        <>
          {mapState.header.engine === 5 && (
            <span data-testid="status-bar-edition" style={{ color: '#4ade80', fontWeight: 700 }}>
              XBOX (v5)
            </span>
          )}
          {mapState.header.engine === 13 && (
            <span data-testid="status-bar-edition" style={{ color: '#38bdf8', fontWeight: 700 }}>
              MCC (v13)
            </span>
          )}
          {mapState.header.engine === 7 && (
            <span data-testid="status-bar-edition" style={{ color: '#a78bfa', fontWeight: 700 }}>
              PC RETAIL (v7)
            </span>
          )}
          <span data-testid="status-bar-compression">{'Decompressed'}</span>
          <span data-testid="status-bar-crc32">CRC32: 0x{mapState.header.crc32.toString(16).padStart(8, '0').toUpperCase()}</span>
          <span data-testid="status-bar-tag-count">{mapState.header.tagCount.toLocaleString()} tags</span>
        </>
      )}
      {mapState?.status === 'compressed' && <span data-testid="status-bar-compression">Compressed</span>}
    </div>
  );
}
