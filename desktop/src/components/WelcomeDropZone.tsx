import logoUrl from '../assets/logo.png';

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
        gap: 16,
        border: '1px dashed var(--border)',
        margin: 20,
        color: 'var(--text-secondary)',
        background: 'var(--bg-panel)',
      }}
    >
      <img
        src={logoUrl}
        alt="OpenCE Mantle Logo"
        style={{
          width: 96,
          height: 96,
          objectFit: 'contain',
          filter: 'drop-shadow(0 0 12px rgba(72, 235, 255, 0.25))',
        }}
      />
      <div style={{ fontFamily: 'var(--ui-font)', fontSize: 22, fontWeight: 600, color: 'var(--text-primary)' }}>No map open</div>
      <div style={{ fontSize: 13 }}>Drag a Halo: Custom Edition .map file here, or</div>
      <button
        data-testid="open-map-button"
        onClick={onOpen}
        style={{
          background: 'var(--accent-cyan)',
          color: '#06202c',
          border: 'none',
          padding: '8px 24px',
          borderRadius: 2,
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        Open Map
      </button>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>
        Only Halo: Custom Edition PC maps (version 609) are supported.
      </div>
    </div>
  );
}
