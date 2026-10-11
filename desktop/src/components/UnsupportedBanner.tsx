export default function UnsupportedBanner({ message, onConvert }: { message: string; onConvert?: () => void }) {
  return (
    <div
      data-testid="unsupported-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '8px 14px',
        background: 'var(--error-bg)',
        borderBottom: '1px solid var(--error-border)',
        color: 'var(--error-text)',
        fontSize: 12.5,
      }}
    >
      <strong>Unsupported map version</strong>
      <span style={{ flex: 1 }}>{message}</span>
      {onConvert && (
        <button
          data-testid="unsupported-banner-convert"
          onClick={onConvert}
          style={{ background: 'var(--accent-cyan)', color: '#06202c', border: '1px solid var(--border)', borderRadius: 2, padding: '5px 12px', fontSize: 12, flexShrink: 0 }}
        >
          Convert to Custom Edition...
        </button>
      )}
    </div>
  );
}
