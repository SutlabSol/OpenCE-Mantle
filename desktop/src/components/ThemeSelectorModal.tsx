import type { AppThemeId, BspTopDownWireframeData } from '../../electron/shared-types';
import BspWireframeCanvas from './BspWireframeCanvas';

export interface ThemePresetDefinition {
  id: AppThemeId;
  title: string;
  subtitle: string;
  description: string;
  swatches: [string, string, string, string];
  badge?: string;
}

export const MANTLE_THEME_PRESETS: ThemePresetDefinition[] = [
  {
    id: 'dark',
    title: 'Native Dark Mode',
    subtitle: 'Default Mantle Engineering Slate',
    description: 'Deep carbon-slate workspace with high-contrast sky-blue blueprint wireframes and semantic accents.',
    swatches: ['#0d1117', '#161b22', '#38bdf8', '#22c55e'],
    badge: 'DEFAULT',
  },
  {
    id: 'light',
    title: 'Mantle Light Mode',
    subtitle: 'Daylight Architectural Blueprint',
    description: 'Crisp alabaster & cool-slate panels with deep cobalt technical BSP wireframes for bright studio rooms.',
    swatches: ['#f1f5f9', '#ffffff', '#0284c7', '#16a34a'],
    badge: 'DAYLIGHT',
  },
  {
    id: 'forerunner',
    title: 'Forerunner Monitor (Guilty Spark)',
    subtitle: '343 Guilty Spark Installation 04',
    description: 'Alloy gunmetal panels with electric cyan hardlight wireframes and golden-amber monitor accents.',
    swatches: ['#08111c', '#0f1d2e', '#00e5ff', '#fbbf24'],
    badge: 'HALO 04',
  },
  {
    id: 'classic-ce',
    title: 'Classic Halo CE Navy (2001 UI)',
    subtitle: '2001 Main Menu CRT Blue',
    description: 'Nostalgic deep midnight navy inspired by the original 2001 Halo: Combat Evolved main menu UI.',
    swatches: ['#000b18', '#001429', '#2299ff', '#5cc4ff'],
    badge: '2001 CE',
  },
  {
    id: 'covenant',
    title: 'Covenant Plasma (High Charity)',
    subtitle: 'Sacred Violet & Magenta',
    description: 'Deep obsidian-violet alloy panels with luminous plasma-purple and magenta BSP wireframes.',
    swatches: ['#110b1c', '#1a112b', '#c084fc', '#f472b6'],
    badge: 'COVENANT',
  },
  {
    id: 'unsc',
    title: 'UNSC Tactical (Pillar of Autumn)',
    subtitle: 'ODST Phosphor Green HUD',
    description: 'Armored olive-charcoal tactical terminal with phosphor-green radar wireframes and amber readouts.',
    swatches: ['#0e1410', '#151f18', '#4ade80', '#fde047'],
    badge: 'UNSC',
  },
];

interface ThemeSelectorModalProps {
  currentTheme: AppThemeId;
  sampleWireframe?: BspTopDownWireframeData | null;
  onSelectTheme: (theme: AppThemeId) => void;
  onClose: () => void;
}

export default function ThemeSelectorModal({
  currentTheme,
  sampleWireframe = null,
  onSelectTheme,
  onClose,
}: ThemeSelectorModalProps) {
  return (
    <div
      data-testid="theme-selector-modal-backdrop"
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
        data-testid="theme-selector-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 780,
          maxWidth: '94vw',
          maxHeight: '88vh',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 15, color: 'var(--accent-gold)' }}>★</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-primary)' }}>
                Change Theme — UI &amp; Blueprint Wireframe Palette
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
                Select a workspace theme. Updates all panels, modals, and top-down BSP wireframe cards immediately.
              </div>
            </div>
          </div>
          <button
            data-testid="theme-selector-close-btn"
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

        {/* 2x3 Grid of Themes */}
        <div
          style={{
            padding: 16,
            overflowY: 'auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 12,
          }}
        >
          {MANTLE_THEME_PRESETS.map((preset) => {
            const isSelected = currentTheme === preset.id;
            return (
              <div
                key={preset.id}
                data-testid={`theme-card-${preset.id}`}
                onClick={() => onSelectTheme(preset.id)}
                style={{
                  border: isSelected ? '1px solid var(--border-active)' : '1px solid var(--border)',
                  background: isSelected ? 'var(--selection-bg)' : 'var(--bg-control)',
                  borderRadius: 2,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  transition: 'border-color 0.12s ease, background 0.12s ease',
                }}
              >
                {/* Live Mini Blueprint Wireframe Preview */}
                <div style={{ position: 'relative' }}>
                  <BspWireframeCanvas
                    wireframe={sampleWireframe}
                    scenarioName="bloodgulch"
                    theme={preset.id}
                    width={350}
                    height={96}
                    compact
                  />
                  {/* Swatch pills in top-right of mini preview */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      display: 'flex',
                      gap: 4,
                      padding: '3px 5px',
                      background: 'rgba(0,0,0,0.55)',
                      border: '1px solid rgba(255,255,255,0.18)',
                      borderRadius: 2,
                    }}
                  >
                    {preset.swatches.map((hex, idx) => (
                      <span
                        key={idx}
                        style={{
                          width: 11,
                          height: 11,
                          background: hex,
                          border: '1px solid rgba(255,255,255,0.35)',
                          display: 'inline-block',
                        }}
                      />
                    ))}
                  </div>
                  {isSelected && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 8,
                        left: 8,
                        padding: '2px 7px',
                        fontSize: 10,
                        fontWeight: 700,
                        fontFamily: 'var(--mono-font)',
                        background: 'var(--accent-cyan)',
                        color: '#05080d',
                        borderRadius: 2,
                      }}
                    >
                      ✓ ACTIVE
                    </span>
                  )}
                </div>

                {/* Card Body */}
                <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
                      {preset.title}
                    </span>
                    {preset.badge && (
                      <span
                        style={{
                          fontFamily: 'var(--mono-font)',
                          fontSize: 10,
                          padding: '1px 6px',
                          background: 'var(--bg-panel-header)',
                          border: '1px solid var(--border)',
                          color: 'var(--text-secondary)',
                          borderRadius: 2,
                        }}
                      >
                        {preset.badge}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--accent-cyan)' }}>
                    {preset.subtitle}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    {preset.description}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '10px 16px',
            background: 'var(--bg-panel-header)',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
            Active Theme:{' '}
            <strong style={{ color: 'var(--accent-cyan)', fontFamily: 'var(--mono-font)' }}>
              {MANTLE_THEME_PRESETS.find((t) => t.id === currentTheme)?.title ?? currentTheme}
            </strong>
          </span>
          <button
            data-testid="theme-selector-done-btn"
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
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
