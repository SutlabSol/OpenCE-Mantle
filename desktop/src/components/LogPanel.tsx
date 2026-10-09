interface LogLine {
  level: string;
  message: string;
  timestamp: number;
}

const COLOR: Record<string, string> = { info: 'var(--text-secondary)', warn: 'var(--warn-text)', error: 'var(--error-text)' };

export default function LogPanel({ logs }: { logs: LogLine[] }) {
  return (
    <div
      data-testid="log-panel"
      style={{
        height: 150,
        overflowY: 'auto',
        background: '#0f1115',
        borderTop: '1px solid var(--border-soft)',
        padding: '8px 14px',
        fontFamily: 'var(--mono-font)',
        fontSize: 12,
      }}
    >
      {logs.length === 0 && <div style={{ color: 'var(--text-dim)' }}>Ready.</div>}
      {logs.map((l, i) => (
        <div key={i} style={{ color: COLOR[l.level] ?? 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
          <span style={{ color: 'var(--text-dim)' }}>{new Date(l.timestamp).toLocaleTimeString()} </span>
          [{l.level.toUpperCase()}] {l.message}
        </div>
      ))}
    </div>
  );
}
