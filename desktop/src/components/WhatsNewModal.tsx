import { useMemo, useState } from 'react';

interface ReleaseEntry {
  version: string;
  date: string;
  headline: string;
  items: Array<{
    badge: 'NEW' | 'ENHANCED' | 'FIXED';
    title: string;
    detail: string;
  }>;
}

const RELEASE_NOTES: ReleaseEntry[] = [
  {
    version: '0.7.0',
    date: 'October 2026',
    headline: 'Guilty Spark Workspace Launcher, 6 Themes, Frameless Window & Multi-Map Split Tabs',
    items: [
      {
        badge: 'NEW',
        title: 'Guilty Spark-Inspired Workspace Launcher Home',
        detail:
          'Main launch page featuring a Recent Maps grid with top-down 2D orthographic Structure BSP (sbsp) wireframe previews, edition filters, pin/unpin support, and quick access to Tutorials, Glossary, Community, and What’s New.',
      },
      {
        badge: 'NEW',
        title: '6 Built-In UI & Blueprint Themes (Including Light Mode)',
        detail:
          'Added Change Theme selector popup with Native Dark Mode, Mantle Light Mode, Forerunner Monitor (Guilty Spark), Classic Halo CE Navy (2001 UI), Covenant Plasma (High Charity), and UNSC Tactical (Pillar of Autumn).',
      },
      {
        badge: 'NEW',
        title: 'Frameless Window with Integrated Top-Right Controls',
        detail:
          'Replaced the native OS title bar with a unified frameless header featuring Minimize (─), Maximize/Restore (□/❐), and Close (✕) controls built directly into the top-right corner.',
      },
      {
        badge: 'NEW',
        title: 'Bottom Multi-Map Tab Bar, Side-by-Side Split View & Multi-Monitor Tear-Off',
        detail:
          'Keep multiple .map files open simultaneously in bottom tabs, compare two maps side-by-side with a draggable center divider, or drag any map tab out of the window onto a second monitor.',
      },
    ],
  },
  {
    version: '0.6.9',
    date: 'October 2026',
    headline: 'Baboon / Foundry Parity Suite & Loose Blam tags/ Workspace',
    items: [
      {
        badge: 'NEW',
        title: 'Standard 64-Byte Blam Loose tags/ Workspace & Git Review',
        detail:
          'Open and edit standard HEK loose tags/ directories directly on disk, auto-fix broken TagDependency paths, refactor/move tag folders, and inspect Git branch diffs.',
      },
      {
        badge: 'NEW',
        title: 'Content Explorer Graph, TSV Reflexive I/O & Function Curve Plotter',
        detail:
          'Interactive incoming/outgoing dependency graph, clipboard TSV spreadsheet import/export for reflexive blocks, Blam periodic/transition function curve evaluator, and visual tool.exe command runner.',
      },
    ],
  },
  {
    version: '0.6.7',
    date: 'October 2026',
    headline: 'Live In-Game HUD & Weapon Memory Editor + UI.map Studio',
    items: [
      {
        badge: 'NEW',
        title: 'Real-Time Win32 Process Memory HUD & Weapon Editor',
        detail:
          'Drag HUD elements on an interactive 640×480 canvas or tweak weapon fire rates, projectiles, and damage in real time while Halo Custom Edition is running.',
      },
      {
        badge: 'NEW',
        title: 'UI.map Menu (DeLa) & Unicode String (ustr) Studio',
        detail:
          'Visual 640×480 menu layout editor for UI.map DeLa widgets with live text-box editing and RFC-4180 CSV string table import/export.',
      },
    ],
  },
  {
    version: '0.6.0',
    date: 'September 2026',
    headline: '3D BSP Viewport, Object Placement Gizmos, Custom Object Builder & HaloScript IDE',
    items: [
      {
        badge: 'NEW',
        title: 'Full 3D BSP & Scenario Object Editor',
        detail:
          'Fly through any Halo CE map in 3D with textured BSP meshes, select/move/rotate/duplicate vehicles, weapons, scenery, and spawns, and sculpt BSP/model vertices.',
      },
      {
        badge: 'NEW',
        title: 'Custom 3D Object Builder (.obj/.jms/.dae) & HaloScript (.hsc) Compiler',
        detail:
          'Import custom 3D meshes into playable scenery/weapons/vehicles with automatic collision generation, and decompile/edit/compile scenario HaloScript.',
      },
    ],
  },
];

interface WhatsNewModalProps {
  appVersion: string;
  onCheckUpdates: () => void;
  onClose: () => void;
}

export default function WhatsNewModal({ appVersion, onCheckUpdates, onClose }: WhatsNewModalProps) {
  const [query, setQuery] = useState('');

  const filteredReleases = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return RELEASE_NOTES;
    return RELEASE_NOTES.map((rel) => ({
      ...rel,
      items: rel.items.filter(
        (it) =>
          it.title.toLowerCase().includes(q) ||
          it.detail.toLowerCase().includes(q) ||
          rel.version.toLowerCase().includes(q),
      ),
    })).filter((rel) => rel.items.length > 0);
  }, [query]);

  return (
    <div
      data-testid="whats-new-modal-backdrop"
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
        data-testid="whats-new-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 760,
          maxWidth: '94vw',
          maxHeight: '86vh',
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
              What&apos;s New in OpenCE Mantle (v{appVersion || '0.6.9'})
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
              Recent release changelog, feature additions, and engine tooling updates
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={onCheckUpdates}
              style={{
                padding: '4px 10px',
                fontSize: 11.5,
                fontWeight: 600,
                background: 'var(--selection-bg)',
                border: '1px solid var(--border-active)',
                color: 'var(--accent-cyan)',
                borderRadius: 2,
              }}
            >
              ⬆ Check for Updates
            </button>
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
        </div>

        {/* Search bar */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-control)' }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search release notes (e.g. BSP, theme, HUD, HaloScript)..."
            style={{
              width: '100%',
              padding: '6px 10px',
              fontSize: 12,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              borderRadius: 2,
              outline: 'none',
            }}
          />
        </div>

        {/* Releases List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {filteredReleases.map((rel) => (
            <div
              key={rel.version}
              style={{
                border: '1px solid var(--border)',
                background: 'var(--bg-control)',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  padding: '8px 12px',
                  background: 'var(--bg-panel-header)',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontFamily: 'var(--mono-font)',
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '1px 7px',
                      background: 'var(--selection-bg)',
                      border: '1px solid var(--border-active)',
                      color: 'var(--accent-cyan)',
                      borderRadius: 2,
                    }}
                  >
                    v{rel.version}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--text-primary)' }}>
                    {rel.headline}
                  </span>
                </div>
                <span style={{ fontFamily: 'var(--mono-font)', fontSize: 11, color: 'var(--text-secondary)' }}>
                  {rel.date}
                </span>
              </div>

              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {rel.items.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span
                      style={{
                        fontFamily: 'var(--mono-font)',
                        fontSize: 9.5,
                        fontWeight: 700,
                        padding: '2px 5px',
                        borderRadius: 2,
                        background:
                          item.badge === 'NEW'
                            ? 'rgba(34, 197, 94, 0.16)'
                            : item.badge === 'ENHANCED'
                            ? 'rgba(56, 189, 248, 0.16)'
                            : 'rgba(234, 179, 8, 0.16)',
                        color:
                          item.badge === 'NEW'
                            ? 'var(--accent-green)'
                            : item.badge === 'ENHANCED'
                            ? 'var(--accent-cyan)'
                            : 'var(--accent-gold)',
                        border: '1px solid var(--border)',
                        flexShrink: 0,
                        marginTop: 1,
                      }}
                    >
                      {item.badge}
                    </span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--text-primary)' }}>
                        {item.title}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.45 }}>
                        {item.detail}
                      </div>
                    </div>
                  </div>
                ))}
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
