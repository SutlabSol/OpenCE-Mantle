export default function ViewportPlaceholder() {
  return (
    <div
      data-testid="viewport-placeholder"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        background:
          'repeating-linear-gradient(45deg, var(--bg-main) 0px, var(--bg-main) 10px, #11151c 10px, #11151c 20px)',
        color: 'var(--text-dim)',
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)' }}>3D Scenario Viewport</div>
      <div style={{ fontSize: 12 }}>Reserved for Phase 2 (BSP/model rendering, Forge-like placement).</div>
    </div>
  );
}
