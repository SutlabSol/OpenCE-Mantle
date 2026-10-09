import type { MapHeaderSummary } from '../../electron/shared-types';

const MAP_TYPE_LABEL: Record<number, string> = { 0: 'Singleplayer', 1: 'Multiplayer', 2: 'User Interface' };

function formatBytes(n: number): string {
  return `${(n / 1024 / 1024).toFixed(2)} MB (${n.toLocaleString()} bytes)`;
}

export default function MapInfoPanel({ header }: { header: MapHeaderSummary }) {
  const fields: [string, string][] = [
    ['Scenario', header.scenarioName],
    ['Build', header.buildString],
    ['Map Type', MAP_TYPE_LABEL[header.mapType] ?? `Unknown (${header.mapType})`],
    ['Header Version', '609 (Custom Edition)'],
    ['Status', 'Decompressed'],
    ['File Size', formatBytes(header.fileSizeOnDisk)],
    ['Decompressed Size', formatBytes(header.decompressedFileSize)],
    ['Tag Count', header.tagCount.toLocaleString()],
    ['CRC32', `0x${header.crc32.toString(16).padStart(8, '0').toUpperCase()}`],
  ];

  return (
    <div
      data-testid="map-info-panel"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '14px 28px',
        padding: '20px 24px',
        background: 'var(--bg-main)',
        flex: 1,
        alignContent: 'start',
      }}
    >
      {fields.map(([label, value]) => (
        <div key={label} style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', padding: '10px 12px' }}>
          <div style={{ fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</div>
          <div
            style={{ fontSize: 14, fontFamily: 'var(--mono-font)', color: 'var(--text-primary)', marginTop: 3 }}
            data-testid={`map-info-${label.toLowerCase().replace(/\s+/g, '-')}`}
          >
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}
