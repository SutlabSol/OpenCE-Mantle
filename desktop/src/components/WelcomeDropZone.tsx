interface Props {
  onOpen: () => void;
}

export default function WelcomeDropZone({ onOpen }: Props) {
  return (
    <div
      data-testid="welcome-drop-zone"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        border: '2px dashed var(--border)',
        margin: 24,
        borderRadius: 10,
        color: 'var(--text-secondary)',
      }}
    >
      <div style={{ fontFamily: 'var(--ui-font)', fontSize: 30, fontWeight: 600, letterSpacing: 1, color: 'var(--text-primary)' }}>
        No map open
      </div>
      <div style={{ fontSize: 15 }}>Drag a Halo: Custom Edition .map file here, or</div>
      <button
        data-testid="open-map-button"
        onClick={onOpen}
        style={{
          background: 'var(--accent)',
          color: '#1a1406',
          border: 'none',
          padding: '10px 28px',
          borderRadius: 6,
          fontSize: 17,
          fontWeight: 600,
          letterSpacing: 0.5,
        }}
      >
        Open Map
      </button>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 10 }}>
        Only Halo: Custom Edition PC maps (version 609) are supported.
      </div>
    </div>
  );
}
