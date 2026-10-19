import React, { useState, useEffect } from 'react';
import type { HaloBitmapVersion } from '../../electron/shared-types';

export interface ConfigureResourcesPromptDialogProps {
  isOpen: boolean;
  mapEdition: HaloBitmapVersion;
  mapScenarioName: string;
  onClose: () => void;
  onSaved: () => void;
}

const EDITION_NAMES: Record<HaloBitmapVersion, string> = {
  halomd: 'HaloMD (Mac OS X)',
  ce: 'Halo Custom Edition (PC CE)',
  pc: 'Halo PC Retail',
  demo: 'Halo Mac / PC Demo',
  mcc: 'Halo: Master Chief Collection (MCC)',
};

export default function ConfigureResourcesPromptDialog({
  isOpen,
  mapEdition,
  mapScenarioName,
  onClose,
  onSaved,
}: ConfigureResourcesPromptDialogProps) {
  const [bitmapsPath, setBitmapsPath] = useState<string>('');
  const [soundsPath, setSoundsPath] = useState<string>('');
  const [detectedDefaults, setDetectedDefaults] = useState<Record<HaloBitmapVersion, string | null>>({
    halomd: null,
    ce: null,
    pc: null,
    demo: null,
    mcc: null,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    // Load any existing configured version settings
    window.opence
      .getVersionSettings?.()
      .then((verSettings) => {
        const current = verSettings?.[mapEdition];
        if (current?.bitmaps) setBitmapsPath(current.bitmaps);
        if (current?.sounds) setSoundsPath(current.sounds);
      })
      .catch(() => {});

    // Detect defaults
    window.opence
      .detectDefaultResourceMapPaths?.()
      .then((defaults) => {
        if (defaults) setDetectedDefaults(defaults);
      })
      .catch(() => {});
  }, [isOpen, mapEdition]);

  if (!isOpen) return null;

  const editionName = EDITION_NAMES[mapEdition] || mapEdition.toUpperCase();
  const defaultBitmap = detectedDefaults[mapEdition];
  const defaultSound = defaultBitmap ? defaultBitmap.replace(/bitmaps\.map$/i, 'sounds.map') : null;

  const handleApplyDefaults = () => {
    if (defaultBitmap) setBitmapsPath(defaultBitmap);
    if (defaultSound) setSoundsPath(defaultSound);
  };

  const handlePickBitmaps = async () => {
    try {
      const res = await window.opence.pickConvertResource?.('bitmaps');
      if (res?.path) setBitmapsPath(res.path);
    } catch {
      // ignore
    }
  };

  const handlePickSounds = async () => {
    try {
      const res = await window.opence.pickConvertResource?.('sounds');
      if (res?.path) setSoundsPath(res.path);
    } catch {
      // ignore
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await window.opence.setVersionSettings?.(mapEdition, {
        bitmaps: bitmapsPath.trim() || null,
        sounds: soundsPath.trim() || null,
      });
      if (bitmapsPath.trim()) {
        await window.opence.setResourceMapPath?.('bitmaps', bitmapsPath.trim());
      }
      if (soundsPath.trim()) {
        await window.opence.setResourceMapPath?.('sounds', soundsPath.trim());
      }
      setSaving(false);
      onSaved();
    } catch (err) {
      setSaving(false);
      console.error('Failed to save version resource maps:', err);
      onSaved();
    }
  };

  return (
    <div
      data-testid="configure-resources-prompt-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        fontFamily: 'var(--ui-font)',
      }}
    >
      <div
        data-testid="configure-resources-prompt-dialog"
        style={{
          width: 580,
          maxWidth: '92vw',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.65)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: 'var(--text-primary)',
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
            <span style={{ fontSize: 14, fontWeight: 600 }}>Configure Resource Maps</span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'uppercase',
                padding: '2px 8px',
                borderRadius: 3,
                background: 'rgba(56, 189, 248, 0.2)',
                color: 'var(--accent-cyan, #38bdf8)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
              }}
            >
              {editionName}
            </span>
          </div>
          <button
            data-testid="configure-resources-prompt-close"
            onClick={onClose}
            title="Skip (Esc)"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dim)',
              fontSize: 18,
              lineHeight: 1,
              cursor: 'pointer',
              padding: '2px 6px',
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 4,
              background: 'rgba(234, 179, 8, 0.1)',
              border: '1px solid rgba(234, 179, 8, 0.3)',
              fontSize: 12,
              lineHeight: 1.5,
              color: 'var(--warn-text, #facc15)',
            }}
          >
            <strong>"{mapScenarioName}"</strong> may require shared resource files (<code>bitmaps.map</code> and <code>sounds.map</code>) for <strong>{editionName}</strong> to display textures, play audio, and export external tags. You have not set these files yet.
          </div>

          {defaultBitmap && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                borderRadius: 4,
                background: 'var(--bg-main)',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                Default {editionName} install detected on your system.
              </div>
              <button
                data-testid="configure-resources-use-default-btn"
                onClick={handleApplyDefaults}
                style={{
                  background: 'var(--bg-panel-header)',
                  border: '1px solid var(--border)',
                  color: 'var(--accent-cyan)',
                  borderRadius: 3,
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Use Detected Paths
              </button>
            </div>
          )}

          {/* Bitmaps Row */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-dim)' }}>
              bitmaps.map for {editionName}
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                data-testid="configure-resources-bitmaps-input"
                type="text"
                placeholder="No bitmaps.map selected..."
                value={bitmapsPath}
                onChange={(e) => setBitmapsPath(e.target.value)}
                style={{
                  flex: 1,
                  background: 'var(--bg-main)',
                  border: '1px solid var(--border)',
                  borderRadius: 3,
                  padding: '6px 8px',
                  fontSize: 12,
                  fontFamily: 'var(--mono-font)',
                  color: 'var(--text-primary)',
                }}
              />
              <button
                data-testid="configure-resources-pick-bitmaps-btn"
                onClick={handlePickBitmaps}
                style={{
                  background: 'var(--bg-panel-header)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  borderRadius: 3,
                  padding: '6px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Browse...
              </button>
            </div>
          </div>

          {/* Sounds Row */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-dim)' }}>
              sounds.map for {editionName}
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                data-testid="configure-resources-sounds-input"
                type="text"
                placeholder="No sounds.map selected..."
                value={soundsPath}
                onChange={(e) => setSoundsPath(e.target.value)}
                style={{
                  flex: 1,
                  background: 'var(--bg-main)',
                  border: '1px solid var(--border)',
                  borderRadius: 3,
                  padding: '6px 8px',
                  fontSize: 12,
                  fontFamily: 'var(--mono-font)',
                  color: 'var(--text-primary)',
                }}
              />
              <button
                data-testid="configure-resources-pick-sounds-btn"
                onClick={handlePickSounds}
                style={{
                  background: 'var(--bg-panel-header)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  borderRadius: 3,
                  padding: '6px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Browse...
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 18px',
            background: 'var(--bg-panel-header)',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            You can also configure these anytime under <strong>Tools &gt; Identify Bitmaps</strong>.
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              data-testid="configure-resources-skip-btn"
              onClick={onClose}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
                borderRadius: 3,
                padding: '6px 14px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Skip
            </button>
            <button
              data-testid="configure-resources-save-btn"
              onClick={handleSave}
              disabled={saving}
              style={{
                background: 'var(--accent-cyan)',
                border: 'none',
                color: '#06202c',
                borderRadius: 3,
                padding: '6px 16px',
                fontSize: 12,
                fontWeight: 600,
                cursor: saving ? 'wait' : 'pointer',
              }}
            >
              {saving ? 'Saving...' : 'Save & Continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
