interface CommunityModalProps {
  onClose: () => void;
}

interface CommunityLinkCard {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  url: string | null;
  badge: string;
  accentColor: string;
}

const COMMUNITY_LINKS: CommunityLinkCard[] = [
  {
    id: 'opence-discord',
    title: 'OpenCE Discord',
    subtitle: 'https://discord.com/invite/opence',
    description:
      'Join the official OpenCE community Discord server to share custom maps, collaborate on tags, get modding help, and follow Mantle & engine updates.',
    url: 'https://discord.com/invite/opence',
    badge: 'DISCORD SERVER',
    accentColor: 'var(--accent-cyan)',
  },
  {
    id: 'mantle-github',
    title: 'Mantle GitHub',
    subtitle: 'https://github.com/SutlabSol/OpenCE-Mantle',
    description:
      'Official OpenCE Mantle repository. Browse source code, download latest releases, report issues, and submit feature requests.',
    url: 'https://github.com/SutlabSol/OpenCE-Mantle',
    badge: 'GITHUB REPO',
    accentColor: 'var(--accent-green)',
  },
  {
    id: 'faber-github',
    title: 'Faber GitHub',
    subtitle: 'Repository link coming soon',
    description:
      'Companion Faber toolchain repository in the OpenCE ecosystem. Direct repository link will be enabled in an upcoming update.',
    url: null,
    badge: 'COMING SOON',
    accentColor: 'var(--accent-gold)',
  },
  {
    id: 'halostats',
    title: 'HaloStats',
    subtitle: 'https://halostats.cc/',
    description:
      'Live Halo server browser, player leaderboards, match telemetry, and community statistics across Halo Custom Edition & Retail servers.',
    url: 'https://halostats.cc/',
    badge: 'LIVE STATS',
    accentColor: 'var(--accent-cyan)',
  },
];

export default function CommunityModal({ onClose }: CommunityModalProps) {
  const handleOpenLink = (url: string | null) => {
    if (!url) return;
    window.opence?.openExternalUrl?.(url);
  };

  return (
    <div
      data-testid="community-modal-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1200,
      }}
    >
      <div
        data-testid="community-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 720,
          maxWidth: '94vw',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 2,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.65)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 16px',
            background: 'var(--bg-panel-header)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-primary)' }}>
              OpenCE Community Hub &amp; Ecosystem Links
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
              Connect with the OpenCE modding community, GitHub repositories, and live HaloStats telemetry
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              padding: '4px 10px',
              borderRadius: 2,
              fontSize: 12,
            }}
          >
            ✕
          </button>
        </div>

        {/* 2x2 Community Cards Grid */}
        <div
          style={{
            padding: 16,
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 12,
          }}
        >
          {COMMUNITY_LINKS.map((card) => (
            <div
              key={card.id}
              data-testid={`community-card-${card.id}`}
              onClick={() => handleOpenLink(card.url)}
              style={{
                padding: 14,
                background: 'var(--bg-control)',
                border: '1px solid var(--border)',
                borderRadius: 2,
                cursor: card.url ? 'pointer' : 'default',
                opacity: card.url ? 1 : 0.82,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: 10,
              }}
              onMouseEnter={(e) => {
                if (card.url) e.currentTarget.style.borderColor = 'var(--border-active)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)';
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                    {card.title}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--mono-font)',
                      fontSize: 9.5,
                      fontWeight: 700,
                      padding: '2px 6px',
                      background: 'var(--bg-panel-header)',
                      border: '1px solid var(--border)',
                      color: card.accentColor,
                      borderRadius: 2,
                    }}
                  >
                    {card.badge}
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: 'var(--mono-font)',
                    fontSize: 11,
                    color: card.url ? 'var(--accent-cyan)' : 'var(--text-dim)',
                    marginTop: 3,
                  }}
                >
                  {card.subtitle}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.45 }}>
                  {card.description}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  disabled={!card.url}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenLink(card.url);
                  }}
                  style={{
                    padding: '5px 12px',
                    fontSize: 11.5,
                    fontWeight: 600,
                    background: card.url ? 'var(--selection-bg)' : 'var(--bg-panel-header)',
                    border: card.url ? '1px solid var(--border-active)' : '1px solid var(--border)',
                    color: card.url ? 'var(--accent-cyan)' : 'var(--text-dim)',
                    borderRadius: 2,
                    cursor: card.url ? 'pointer' : 'default',
                  }}
                >
                  {card.url ? 'Open in Browser ↗' : 'Link Coming Soon'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '10px 16px',
            background: 'var(--bg-panel-header)',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '5px 16px',
              background: 'var(--selection-bg)',
              border: '1px solid var(--border-active)',
              color: 'var(--text-primary)',
              fontWeight: 600,
              fontSize: 12,
              borderRadius: 2,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
