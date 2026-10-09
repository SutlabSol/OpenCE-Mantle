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
        padding: '12px 18px',
        background: 'var(--warn-bg)',
        borderBottom: '1px solid var(--warn-border)',
        color: 'var(--warn-text)',
      }}
    >
      <strong>This map is compressed.</strong>
      <span>Decompress it to browse and edit tags.</span>
      <div style={{ flex: 1 }} />
      <button
        data-testid="decompress-button"
        onClick={onDecompress}
        style={{
          background: 'var(--accent)',
          color: '#1a1406',
          border: 'none',
          borderRadius: 5,
          padding: '7px 18px',
          fontWeight: 600,
        }}
      >
        Decompress...
      </button>
    </div>
  );
}
