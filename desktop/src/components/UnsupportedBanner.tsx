export default function UnsupportedBanner({ message }: { message: string }) {
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
      <span>{message}</span>
    </div>
  );
}
