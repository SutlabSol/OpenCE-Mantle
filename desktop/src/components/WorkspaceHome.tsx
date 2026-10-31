import { useEffect, useMemo, useState } from 'react';
import type { AppThemeId, RecentMapCardEntry } from '../../electron/shared-types';
import BspWireframeCanvas from './BspWireframeCanvas';
import { MANTLE_THEME_PRESETS } from './ThemeSelectorModal';

interface WorkspaceHomeProps {
  appVersion: string;
  currentTheme: AppThemeId;
  updateAvailableVersion?: string | null;
  isCheckingUpdates?: boolean;
  updateStatusMessage?: string | null;
  onCheckUpdates: () => void;
  onOpenThemeModal: () => void;
  onOpenMapDialog: () => void;
  onOpenMapPath: (filePath: string) => void;
  onOpenLooseWorkspace?: () => void;
  onOpenWhatsNew: () => void;
  onOpenHelp: () => void;
  onOpenTutorials: () => void;
  onOpenGlossary: () => void;
  onOpenCommunity: () => void;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb >= 10 ? `${mb.toFixed(1)} MB` : `${mb.toFixed(2)} MB`;
}

function formatRelativeTime(ts: number): string {
  if (!ts) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(ts).toLocaleDateString();
}

function formatMapTypeLabel(mapType: number): string {
  if (mapType === 0) return 'Singleplayer';
  if (mapType === 1) return 'Multiplayer';
  if (mapType === 2) return 'UI Map';
  return 'Scenario';
}

export default function WorkspaceHome({
  appVersion,
  currentTheme,
  updateAvailableVersion,
  isCheckingUpdates,
  updateStatusMessage,
  onCheckUpdates,
  onOpenThemeModal,
  onOpenMapDialog,
  onOpenMapPath,
  onOpenLooseWorkspace,
  onOpenWhatsNew,
  onOpenHelp,
  onOpenTutorials,
  onOpenGlossary,
  onOpenCommunity,
}: WorkspaceHomeProps) {
  const [cards, setCards] = useState<RecentMapCardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [editionFilter, setEditionFilter] = useState<'all' | 'pinned' | 'ce' | 'pc' | 'mcc' | 'xbox'>('all');

  const refreshCards = () => {
    setLoading(true);
    if (window.opence?.getRecentMapCards) {
      window.opence
        .getRecentMapCards()
        .then((res) => {
          setCards(Array.isArray(res) ? res : []);
        })
        .catch(() => setCards([]))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshCards();
  }, []);

  const filteredCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return cards.filter((c) => {
      if (editionFilter === 'pinned' && !c.pinned) return false;
      if (editionFilter !== 'all' && editionFilter !== 'pinned' && c.mapEdition !== editionFilter) return false;
      if (!q) return true;
      return (
        c.fileName.toLowerCase().includes(q) ||
        c.scenarioName.toLowerCase().includes(q) ||
        c.filePath.toLowerCase().includes(q)
      );
    });
  }, [cards, searchQuery, editionFilter]);

  const activeThemeTitle =
    MANTLE_THEME_PRESETS.find((t) => t.id === currentTheme)?.title ?? 'Native Dark Mode';

  return (
    <div
      data-testid="workspace-launcher-home"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-main)',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Top Action Ribbon Bar: Check Updates on Far Left | ... | Change Theme on Far Right */}
      <div
        data-testid="launcher-top-ribbon"
        style={{
          height: 54,
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 14px',
        }}
      >
        {/* Left: Check Updates with Up Arrow + Vertical Divider */}
        <button
          data-testid="launcher-check-updates-btn"
          onClick={onCheckUpdates}
          style={{
            height: 40,
            padding: '0 14px',
            background: updateAvailableVersion ? 'var(--selection-bg)' : 'var(--bg-control)',
            border: updateAvailableVersion ? '1px solid var(--border-active)' : '1px solid var(--border)',
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            color: 'var(--text-primary)',
            flexShrink: 0,
          }}
          title="Check GitHub Releases for a newer OpenCE Mantle update"
        >
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: 2,
              background: 'var(--bg-panel-header)',
              border: '1px solid var(--border)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-cyan)',
              fontSize: 14,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            ⬆
          </span>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.15, whiteSpace: 'nowrap' }}>
              {isCheckingUpdates
                ? 'Checking Updates...'
                : updateAvailableVersion
                ? `Update Available (v${updateAvailableVersion})`
                : updateStatusMessage
                ? updateStatusMessage
                : 'Check Updates'}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap' }}>
              {updateAvailableVersion ? 'Click to download & install' : `Current v${appVersion || '0.8.6'}`}
            </div>
          </div>
        </button>

        {/* Vertical divider after Check Updates */}
        <div
          style={{
            width: 1,
            height: 34,
            background: 'var(--border)',
            margin: '0 14px',
            flexShrink: 0,
          }}
        />

        {/* Center subtle status hint (truncates cleanly on narrow windows) */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 11.5,
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ color: 'var(--accent-cyan)', fontFamily: 'var(--mono-font)', fontWeight: 600, flexShrink: 0 }}>
            WORKSPACE LAUNCHER
          </span>
          <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>•</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Select a recent map below or drag &amp; drop any Halo .map file to inspect &amp; edit
          </span>
        </div>

        {/* Push Change Theme all the way to the far right */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {/* Vertical divider before Change Theme */}
          <div
            style={{
              width: 1,
              height: 34,
              background: 'var(--border)',
              margin: '0 14px',
              flexShrink: 0,
            }}
          />

          <button
            data-testid="launcher-change-theme-btn"
            onClick={onOpenThemeModal}
            style={{
              height: 40,
              padding: '0 14px',
              background: 'var(--bg-control)',
              border: '1px solid var(--border)',
              borderRadius: 2,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              color: 'var(--text-primary)',
              flexShrink: 0,
            }}
            title="Open the Change Theme selector popup"
          >
            <span
              style={{
                width: 24,
                height: 24,
                borderRadius: 2,
                background: 'var(--bg-panel-header)',
                border: '1px solid var(--border)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-gold)',
                fontSize: 14,
                flexShrink: 0,
              }}
            >
              ★
            </span>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.15, whiteSpace: 'nowrap' }}>Change Theme</div>
              <div style={{ fontSize: 10, color: 'var(--accent-cyan)', fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap' }}>
                {activeThemeTitle}
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Main Split Workspace Body: Left Sidebar + Right Recent Maps Grid */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, padding: 12, gap: 12 }}>
        {/* Left Sidebar */}
        <div
          data-testid="launcher-left-sidebar"
          style={{
            width: 245,
            flexShrink: 0,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            borderRadius: 2,
            display: 'flex',
            flexDirection: 'column',
            padding: 14,
            overflowY: 'auto',
          }}
        >
          {/* Version Title */}
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                fontFamily: 'var(--mono-font)',
                fontSize: 15,
                fontWeight: 700,
                letterSpacing: 0.6,
                color: 'var(--text-primary)',
              }}
            >
              MANTLE V{appVersion || '0.8.6'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
              Halo CE Map &amp; Tag Studio
            </div>
          </div>

          {/* Prominent Open Map Box */}
          <button
            data-testid="launcher-open-map-btn"
            onClick={onOpenMapDialog}
            style={{
              width: '100%',
              padding: '13px 14px',
              background: 'var(--selection-bg)',
              border: '1px solid var(--border-active)',
              borderRadius: 2,
              color: 'var(--text-primary)',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--accent-cyan)' }}>Open Map...</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                Browse .map or .bak cache file
              </div>
            </div>
            <span style={{ fontFamily: 'var(--mono-font)', fontSize: 10.5, color: 'var(--text-secondary)' }}>
              Ctrl+O
            </span>
          </button>

          {onOpenLooseWorkspace && (
            <button
              data-testid="launcher-open-loose-tags-btn"
              onClick={onOpenLooseWorkspace}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: 'var(--bg-control)',
                border: '1px solid var(--border)',
                borderRadius: 2,
                color: 'var(--text-secondary)',
                textAlign: 'left',
                fontSize: 11.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>Open Loose tags/ Folder...</span>
              <span style={{ fontSize: 11 }}>📁</span>
            </button>
          )}

          {/* Drag and Drop Hint Box */}
          <div
            style={{
              marginTop: 12,
              padding: '12px 10px',
              border: '1px dashed var(--border)',
              background: 'var(--bg-control)',
              borderRadius: 2,
              textAlign: 'center',
              color: 'var(--text-dim)',
              fontSize: 11,
              lineHeight: 1.45,
            }}
          >
            Drop any <code style={{ color: 'var(--text-secondary)' }}>.map</code> file anywhere on this window to open
          </div>

          <div style={{ flex: 1 }} />

          {/* Horizontal Divider above Knowledge Hub & Community Links */}
          <div
            style={{
              height: 1,
              background: 'var(--border)',
              margin: '12px 0 10px 0',
            }}
          />

          {/* 5 Bottom Navigation Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[
              { id: 'whats-new', label: "What's New", badge: `v${appVersion || '0.8.6'}`, onClick: onOpenWhatsNew },
              { id: 'help', label: 'Help', badge: 'About', onClick: onOpenHelp },
              { id: 'tutorials', label: 'Tutorials', badge: '16 Guides', onClick: onOpenTutorials },
              { id: 'glossary', label: 'Glossary', badge: 'UI Atlas', onClick: onOpenGlossary },
              { id: 'community', label: 'Community', badge: 'Links', onClick: onOpenCommunity },
            ].map((nav) => (
              <button
                key={nav.id}
                data-testid={`launcher-nav-${nav.id}`}
                onClick={nav.onClick}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  background: 'transparent',
                  border: '1px solid transparent',
                  borderRadius: 2,
                  color: 'var(--text-primary)',
                  fontSize: 12.5,
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-hover)';
                  e.currentTarget.style.borderColor = 'var(--border)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = 'transparent';
                }}
              >
                <span style={{ fontWeight: 500 }}>{nav.label}</span>
                <span
                  style={{
                    fontFamily: 'var(--mono-font)',
                    fontSize: 10,
                    color: 'var(--text-secondary)',
                    background: 'var(--bg-control)',
                    border: '1px solid var(--border)',
                    padding: '1px 6px',
                    borderRadius: 2,
                  }}
                >
                  {nav.badge}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Right Main Area: Recent Maps Grid */}
        <div
          data-testid="launcher-recent-maps-panel"
          style={{
            flex: 1,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            borderRadius: 2,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          {/* Recent Maps Header Bar */}
          <div
            style={{
              padding: '10px 14px',
              background: 'var(--bg-panel-header)',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 12,
                  letterSpacing: 0.5,
                  color: 'var(--text-primary)',
                  textTransform: 'uppercase',
                }}
              >
                Recent Maps
              </span>
              <span
                style={{
                  fontFamily: 'var(--mono-font)',
                  fontSize: 11,
                  padding: '1px 7px',
                  background: 'var(--bg-control)',
                  border: '1px solid var(--border)',
                  color: 'var(--accent-cyan)',
                  borderRadius: 2,
                }}
              >
                {filteredCards.length}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {(['all', 'pinned', 'ce', 'pc', 'mcc', 'xbox'] as const).map((f) => {
                const active = editionFilter === f;
                return (
                  <button
                    key={f}
                    onClick={() => setEditionFilter(f)}
                    style={{
                      padding: '3px 8px',
                      fontSize: 11,
                      fontFamily: 'var(--mono-font)',
                      background: active ? 'var(--selection-bg)' : 'var(--bg-control)',
                      border: active ? '1px solid var(--border-active)' : '1px solid var(--border)',
                      color: active ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                      borderRadius: 2,
                      textTransform: 'uppercase',
                    }}
                  >
                    {f}
                  </button>
                );
              })}

              <input
                data-testid="launcher-recent-search"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter recent maps..."
                style={{
                  width: 190,
                  padding: '4px 9px',
                  fontSize: 12,
                  background: 'var(--bg-control)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  borderRadius: 2,
                  outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Grid Body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
            {loading ? (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--mono-font)',
                  fontSize: 12,
                }}
              >
                Scanning recent maps &amp; generating top-down BSP wireframes...
              </div>
            ) : filteredCards.length === 0 ? (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  color: 'var(--text-secondary)',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {cards.length === 0 ? 'No Recent Maps Yet' : 'No Matching Recent Maps'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', maxWidth: 420, textAlign: 'center' }}>
                  {cards.length === 0
                    ? 'Click "Open Map..." on the left or drag & drop any Halo .map file onto the window. Recently opened maps will appear here with a top-down 2D BSP wireframe preview.'
                    : 'Try clearing the search query or switching the edition filter.'}
                </div>
                {cards.length === 0 && (
                  <button
                    onClick={onOpenMapDialog}
                    style={{
                      marginTop: 6,
                      padding: '7px 16px',
                      background: 'var(--selection-bg)',
                      border: '1px solid var(--border-active)',
                      color: 'var(--accent-cyan)',
                      fontWeight: 600,
                      fontSize: 12,
                      borderRadius: 2,
                    }}
                  >
                    Open Map...
                  </button>
                )}
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(265px, 1fr))',
                  gap: 12,
                }}
              >
                {filteredCards.map((card) => (
                  <div
                    key={card.filePath}
                    data-testid={`recent-map-card-${card.fileName}`}
                    onClick={() => onOpenMapPath(card.filePath)}
                    style={{
                      background: 'var(--bg-control)',
                      border: card.pinned ? '1px solid var(--border-active)' : '1px solid var(--border)',
                      borderRadius: 2,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      overflow: 'hidden',
                      position: 'relative',
                      transition: 'border-color 0.12s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border-active)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = card.pinned ? 'var(--border-active)' : 'var(--border)';
                    }}
                  >
                    {/* Top-Down 2D BSP Wireframe Canvas */}
                    <div style={{ position: 'relative' }}>
                      <BspWireframeCanvas
                        wireframe={card.wireframe}
                        scenarioName={card.scenarioName || card.fileName}
                        theme={currentTheme}
                        width={290}
                        height={152}
                      />

                      {/* Top-left Edition + MapType badge */}
                      <div
                        style={{
                          position: 'absolute',
                          top: 7,
                          left: 7,
                          maxWidth: 'calc(100% - 92px)',
                          display: 'flex',
                          gap: 4,
                          overflow: 'hidden',
                        }}
                      >
                        <span
                          style={{
                            fontFamily: 'var(--mono-font)',
                            fontSize: 9.5,
                            fontWeight: 700,
                            padding: '1px 5px',
                            background: 'rgba(8, 13, 20, 0.82)',
                            border: '1px solid var(--border)',
                            color: 'var(--accent-cyan)',
                            borderRadius: 2,
                            textTransform: 'uppercase',
                          }}
                        >
                          {card.mapEdition || 'CE'}
                        </span>
                        <span
                          style={{
                            fontFamily: 'var(--mono-font)',
                            fontSize: 9.5,
                            padding: '1px 5px',
                            background: 'rgba(8, 13, 20, 0.82)',
                            border: '1px solid var(--border)',
                            color: '#cbd5e1',
                            borderRadius: 2,
                          }}
                        >
                          {formatMapTypeLabel(card.mapType)}
                        </span>
                      </div>

                      {/* Top-right Quick Actions (Pin, Explorer, Remove) */}
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          position: 'absolute',
                          top: 6,
                          right: 6,
                          display: 'flex',
                          gap: 3,
                        }}
                      >
                        <button
                          title={card.pinned ? 'Unpin map' : 'Pin map to top'}
                          onClick={() => {
                            window.opence?.togglePinRecentMap?.(card.filePath).then(setCards).catch(() => {});
                          }}
                          style={{
                            width: 22,
                            height: 22,
                            background: card.pinned ? 'var(--selection-bg)' : 'rgba(8, 13, 20, 0.82)',
                            border: '1px solid var(--border)',
                            color: card.pinned ? 'var(--accent-gold)' : '#cbd5e1',
                            borderRadius: 2,
                            fontSize: 11,
                            padding: 0,
                          }}
                        >
                          ★
                        </button>
                        <button
                          title="Reveal in File Explorer"
                          onClick={() => {
                            window.opence?.revealInExplorer?.(card.filePath);
                          }}
                          style={{
                            width: 22,
                            height: 22,
                            background: 'rgba(8, 13, 20, 0.82)',
                            border: '1px solid var(--border)',
                            color: '#cbd5e1',
                            borderRadius: 2,
                            fontSize: 10.5,
                            padding: 0,
                          }}
                        >
                          📂
                        </button>
                        <button
                          title="Remove from Recent Maps"
                          onClick={() => {
                            window.opence?.removeRecentMap?.(card.filePath).then(setCards).catch(() => {});
                          }}
                          style={{
                            width: 22,
                            height: 22,
                            background: 'rgba(8, 13, 20, 0.82)',
                            border: '1px solid var(--border)',
                            color: '#cbd5e1',
                            borderRadius: 2,
                            fontSize: 10,
                            padding: 0,
                          }}
                        >
                          ✕
                        </button>
                      </div>

                      {/* Bottom-right mesh stats overlay */}
                      {card.wireframe && (
                        <span
                          style={{
                            position: 'absolute',
                            bottom: 6,
                            right: 7,
                            fontFamily: 'var(--mono-font)',
                            fontSize: 9.5,
                            padding: '1px 5px',
                            background: 'rgba(8, 13, 20, 0.78)',
                            color: '#94a3b8',
                            borderRadius: 2,
                          }}
                        >
                          {card.wireframe.totalTriangles.toLocaleString()} tris
                        </span>
                      )}
                    </div>

                    {/* Card Footer Metadata */}
                    <div style={{ padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <span
                          style={{
                            fontWeight: 600,
                            fontSize: 13,
                            color: 'var(--text-primary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {card.fileName}
                        </span>
                        <span
                          style={{
                            fontFamily: 'var(--mono-font)',
                            fontSize: 10,
                            color: 'var(--text-dim)',
                            flexShrink: 0,
                          }}
                        >
                          {formatRelativeTime(card.lastOpenedAt)}
                        </span>
                      </div>

                      <div
                        style={{
                          fontFamily: 'var(--mono-font)',
                          fontSize: 10.5,
                          color: 'var(--text-secondary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span>{card.tagCount > 0 ? `${card.tagCount.toLocaleString()} tags` : card.scenarioName}</span>
                        <span>{formatBytes(card.fileSizeBytes)}</span>
                      </div>

                      <div
                        title={card.filePath}
                        style={{
                          fontFamily: 'var(--mono-font)',
                          fontSize: 10,
                          color: 'var(--text-dim)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          marginTop: 1,
                        }}
                      >
                        {card.filePath}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
