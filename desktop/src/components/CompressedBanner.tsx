interface Props {
  onDecompress: () => void;
}

export default function CompressedBanner({ onDecompress }: Props) {
  return (
    <div
      data-testid="compressed-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '8px 14px',
        background: 'var(--warn-bg)',
        borderBottom: '1px solid var(--warn-border)',
        color: 'var(--warn-text)',
        fontSize: 12.5,
      }}
    >
      <strong>This map is compressed.</strong>
      <span>Decompress it to browse and edit tags.</span>
      <div style={{ flex: 1 }} />
      <button
        data-testid="decompress-button"
        onClick={onDecompress}
        style={{
          background: 'var(--accent-gold)',
          color: '#1a1406',
          border: 'none',
          borderRadius: 2,
          padding: '5px 14px',
          fontWeight: 600,
          fontSize: 12,
        }}
      >
        Decompress...
      </button>
    </div>
  );
}
