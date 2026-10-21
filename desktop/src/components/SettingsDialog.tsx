import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, CSSProperties } from 'react';
import type {
  HaloBitmapVersion,
  ResourceMapKind,
  ResourceMapStatus,
  VersionResourceMaps,
  BitmapIdentificationResult,
} from '../../electron/shared-types';

interface Props {
  onClose: () => void;
}

type SettingsTab = 'general' | 'ce' | 'pc' | 'halomd' | 'demo' | 'mcc';

interface TabDef {
  id: SettingsTab;
  label: string;
  version?: HaloBitmapVersion;
  badge?: string;
  description?: string;
  notes?: string;
}

const TABS: TabDef[] = [
  { id: 'general', label: 'General' },
  {
    id: 'ce',
    label: 'Custom Edition',
    version: 'ce',
    badge: 'Official CE Resource',
    description: 'Standard 2004 PC Custom Edition shared bitmaps, sounds, and loc containers.',
    notes: 'Used by all stock and custom CE maps. Required for external tags without internal raw data.',
  },
  {
    id: 'pc',
    label: 'Halo PC Retail',
    version: 'pc',
    badge: 'Retail PC Resource',
    description: 'Original 2003 PC Retail release shared bitmaps and sounds containers (1.00 - 1.10).',
    notes: 'Halo PC Retail embeds font & text tags directly and does not use a loc.map.',
  },
  {
    id: 'halomd',
    label: 'HaloMD',
    version: 'halomd',
    badge: 'HaloMD Modded Resource',
    description: 'High-resolution community Mac OS X port assets with extended bitmap containers.',
    notes: 'Shares audio and layout with PC Retail. HaloMD maps do not use a loc.map.',
  },
  {
    id: 'demo',
    label: 'Halo Demo',
    version: 'demo',
    badge: 'Trimmed Demo Resource',
    description: 'Standalone Mac / PC Demo resource containers featuring Blood Gulch assets.',
    notes: 'Optimized demo package. Halo Demo maps do not use a loc.map.',
  },
  {
    id: 'mcc',
    label: 'Halo MCC',
    version: 'mcc',
    badge: 'MCC H1 Resource',
    description: 'Master Chief Collection (Steam / Windows Store) Halo 1 shared containers.',
    notes: 'MCC Halo 1 maps use MCC bitmaps.map and fall back to CE sounds.map for audio.',
  },
];

export default function SettingsDialog({ onClose }: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [openCeConfig, setOpenCeConfig] = useState<{ directory: string | null; executable: string | null; exists: boolean } | null>(null);
  const [versionSettings, setVersionSettings] = useState<Partial<Record<HaloBitmapVersion, VersionResourceMaps>>>({});
  const [inspectResults, setInspectResults] = useState<Record<string, BitmapIdentificationResult | null>>({});
  const [inspectingKey, setInspectingKey] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.opence.getOpenCeConfig().then(setOpenCeConfig).catch(() => {});
    window.opence.getVersionSettings?.().then((vs) => {
      if (vs) setVersionSettings(vs);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const handlePickOpenCeDir = async () => {
    const res = await window.opence.pickOpenCeDirectory();
    if (res.path) {
      const cfg = await window.opence.getOpenCeConfig();
      setOpenCeConfig(cfg);
    }
  };

  const handlePickResourceFile = async (version: HaloBitmapVersion, kind: 'bitmaps' | 'sounds' | 'loc') => {
    const res = await window.opence.pickConvertResource?.(kind);
    if (res?.path) {
      const updated = {
        ...(versionSettings[version] ?? { bitmaps: null, sounds: null, loc: null }),
        [kind]: res.path,
      };
      setVersionSettings((prev) => ({ ...prev, [version]: updated }));
      await window.opence.setVersionSettings?.(version, { [kind]: res.path });
    }
  };

  const handleClearResourceFile = async (version: HaloBitmapVersion, kind: 'bitmaps' | 'sounds' | 'loc') => {
    const updated = {
      ...(versionSettings[version] ?? { bitmaps: null, sounds: null, loc: null }),
      [kind]: null,
    };
    setVersionSettings((prev) => ({ ...prev, [version]: updated }));
    await window.opence.setVersionSettings?.(version, { [kind]: null });
  };

  const handleInspect = async (version: HaloBitmapVersion, kind: 'bitmaps' | 'sounds', filePath: string) => {
    const key = `${version}-${kind}`;
    setInspectingKey(key);
    try {
      const res = await window.opence.identifyResourceMap(filePath, version, kind);
      setInspectResults((prev) => ({ ...prev, [key]: res }));
    } catch {
      setInspectResults((prev) => ({
        ...prev,
        [key]: {
          ok: false,
          error: 'Failed to inspect file',
          filePath,
          fileSizeBytes: 0,
          entryCount: 0,
          tableOffset: 0,
          detectedVersion: version,
          versionMatchConfidence: 'unknown',
          entries: [],
        },
      }));
    } finally {
      setInspectingKey(null);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  const currentTabDef = TABS.find((t) => t.id === activeTab)!;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        ref={dialogRef}
        data-testid="settings-dialog"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        style={{
          width: 760,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 18px',
            background: 'var(--bg-panel-header)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Settings</span>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', padding: '2px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: 3 }}>
              OpenCE Modding Suite
            </span>
          </div>
          <button
            data-testid="settings-dialog-close"
            onClick={onClose}
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

        {/* Tab Navigation */}
        <div
          style={{
            display: 'flex',
            gap: 2,
            padding: '4px 12px 0 12px',
            background: '#141820',
            borderBottom: '1px solid var(--border)',
            overflowX: 'auto',
          }}
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                data-testid={`settings-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  background: isActive ? 'var(--bg-panel)' : 'transparent',
                  color: isActive ? 'var(--accent-cyan)' : 'var(--text-dim)',
                  border: '1px solid transparent',
                  borderBottom: isActive ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                  borderTopLeftRadius: 4,
                  borderTopRightRadius: 4,
                  padding: '7px 14px',
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div style={{ padding: 18, overflowY: 'auto', flex: 1 }}>
          {activeTab === 'general' ? (
            <div>
              {/* OpenCE Installation Directory */}
              <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                      OpenCE Installation Directory
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                      Folder containing halo.exe and custom_maps\. Required for "Launch In OpenCE (F5)", flycam controls, and Telnet hot-reloading.
                    </div>
                  </div>
                  <button
                    data-testid="settings-pick-opence-dir"
                    onClick={handlePickOpenCeDir}
                    style={actionBtnStyle()}
                  >
                    Browse Folder...
                  </button>
                </div>
                <div
                  data-testid="settings-status-opence-dir"
                  style={{
                    fontSize: 11.5,
                    fontFamily: 'var(--mono-font)',
                    padding: '8px 12px',
                    borderRadius: 4,
                    background: openCeConfig?.exists ? 'rgba(74, 222, 128, 0.08)' : 'rgba(248, 113, 113, 0.08)',
                    border: `1px solid ${openCeConfig?.exists ? 'rgba(74, 222, 128, 0.25)' : 'rgba(248, 113, 113, 0.25)'}`,
                    color: openCeConfig?.exists ? '#4ade80' : '#f87171',
                    wordBreak: 'break-all',
                  }}
                >
                  {openCeConfig?.directory ? (
                    openCeConfig.exists ? (
                      `✓ ${openCeConfig.directory} (halo.exe found)`
                    ) : (
                      `✗ ${openCeConfig.directory} (halo.exe missing)`
                    )
                  ) : (
                    'Not configured (OpenCE directory not found)'
                  )}
                </div>
              </div>

              {/* General Engine Preferences */}
              <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                  Engine & Modding Preferences
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 4, border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                      Resource Map Auto-Detection
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                      Automatically switches active resource containers (bitmaps/sounds) based on the loaded map's edition (Custom Edition, PC Retail, HaloMD, Demo, or MCC).
                    </div>
                    <div style={{ marginTop: 6, fontSize: 11, color: '#4ade80', fontWeight: 600 }}>
                      ● Active (Automatic)
                    </div>
                  </div>

                  <div style={{ padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 4, border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                      Tag Test Launch Resolution
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                      Default windowed size used when testing maps via Launch In OpenCE (F5).
                    </div>
                    <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-primary)', fontFamily: 'var(--mono-font)' }}>
                      1280 × 960 (Windowed)
                    </div>
                  </div>
                </div>
              </div>

              {/* About & Info */}
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  OpenCE Modding Suite • Fast native Halo map inspection, editing, cross-edition conversion, and live testing.
                </div>
              </div>
            </div>
          ) : (
            <div>
              {/* Edition Banner */}
              <div
                style={{
                  padding: '12px 14px',
                  background: 'rgba(0, 194, 255, 0.05)',
                  border: '1px solid rgba(0, 194, 255, 0.2)',
                  borderRadius: 4,
                  marginBottom: 16,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {currentTabDef.label}
                  </span>
                  {currentTabDef.badge && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '2px 6px',
                        borderRadius: 3,
                        background: 'rgba(0, 194, 255, 0.2)',
                        color: 'var(--accent-cyan)',
                      }}
                    >
                      {currentTabDef.badge}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginBottom: 2 }}>
                  {currentTabDef.description}
                </div>
                {currentTabDef.notes && (
                  <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>
                    {currentTabDef.notes}
                  </div>
                )}
              </div>

              {/* Resource Slots */}
              {currentTabDef.version && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {/* Bitmaps Slot */}
                  {renderResourceSlot(
                    currentTabDef.version,
                    'bitmaps',
                    'bitmaps.map',
                    versionSettings[currentTabDef.version]?.bitmaps ?? null,
                    'Bitmaps Resource Map (textures, HUD sprites, plate mipmaps)'
                  )}

                  {/* Sounds Slot */}
                  {renderResourceSlot(
                    currentTabDef.version,
                    'sounds',
                    'sounds.map',
                    versionSettings[currentTabDef.version]?.sounds ?? null,
                    'Sounds Resource Map (audio permutations and dialog samples)'
                  )}

                  {/* Loc Slot */}
                  {renderResourceSlot(
                    currentTabDef.version,
                    'loc',
                    'loc.map',
                    versionSettings[currentTabDef.version]?.loc ?? null,
                    currentTabDef.version === 'ce'
                      ? 'Localization Resource Map (Required for whole-tag-indexed fonts and UI strings)'
                      : 'Localization Resource Map (Not used by this edition — string lists & fonts are embedded in maps)'
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '12px 18px',
            background: 'var(--bg-panel-header)',
            borderTop: '1px solid var(--border)',
          }}
        >
          <button data-testid="settings-dialog-done" onClick={onClose} style={actionBtnStyle(true)}>
            Done
          </button>
        </div>
      </div>
    </div>
  );

  function renderResourceSlot(
    version: HaloBitmapVersion,
    kind: 'bitmaps' | 'sounds' | 'loc',
    fileName: string,
    currentPath: string | null,
    description: string
  ) {
    const inspectKey = `${version}-${kind}`;
    const inspectRes = inspectResults[inspectKey];
    const isInspecting = inspectingKey === inspectKey;
    const isLoc = kind === 'loc';
    const isNotApplicable = isLoc && version !== 'ce';

    return (
      <div
        key={kind}
        data-testid={`settings-slot-${version}-${kind}`}
        style={{
          padding: 12,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid var(--border)',
          borderRadius: 4,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{fileName}</span>
            {isNotApplicable && (
              <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'rgba(255,255,255,0.08)', color: 'var(--text-dim)' }}>
                Optional Fallback
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {currentPath && !isLoc && (
              <button
                data-testid={`settings-inspect-${version}-${kind}`}
                disabled={isInspecting}
                onClick={() => handleInspect(version, kind, currentPath)}
                style={actionBtnStyle()}
              >
                {isInspecting ? 'Inspecting...' : 'Inspect'}
              </button>
            )}
            <button
              data-testid={`settings-pick-${version}-${kind}`}
              onClick={() => handlePickResourceFile(version, kind)}
              style={actionBtnStyle()}
            >
              Browse...
            </button>
            {currentPath && (
              <button
                data-testid={`settings-clear-${version}-${kind}`}
                onClick={() => handleClearResourceFile(version, kind)}
                style={{ ...actionBtnStyle(), color: '#f87171' }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div
          data-testid={`settings-status-${version}-${kind}`}
          style={{
            fontSize: 11,
            fontFamily: currentPath ? 'var(--mono-font)' : undefined,
            color: currentPath ? '#4ade80' : 'var(--text-dim)',
            wordBreak: 'break-all',
            marginBottom: 4,
          }}
        >
          {currentPath ? `✓ ${currentPath}` : 'Not configured'}
        </div>

        <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>{description}</div>

        {/* Inline Inspection Result */}
        {inspectRes && (
          <div
            style={{
              marginTop: 8,
              padding: 8,
              background: inspectRes.ok ? 'rgba(74, 222, 128, 0.05)' : 'rgba(248, 113, 113, 0.05)',
              border: `1px solid ${inspectRes.ok ? 'rgba(74, 222, 128, 0.2)' : 'rgba(248, 113, 113, 0.2)'}`,
              borderRadius: 4,
              fontSize: 11,
            }}
          >
            {inspectRes.ok ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ color: '#4ade80', fontWeight: 600 }}>
                  ✓ Valid Container ({inspectRes.entryCount.toLocaleString()} entries, {(inspectRes.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB)
                </div>
                <div style={{ color: 'var(--text-dim)', fontSize: 10.5 }}>
                  Detected Version: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{inspectRes.detectedVersion.toUpperCase()}</span> (Confidence: {inspectRes.versionMatchConfidence})
                </div>
              </div>
            ) : (
              <div style={{ color: '#f87171' }}>✗ {inspectRes.error || 'Invalid or unreadable resource map file'}</div>
            )}
          </div>
        )}
      </div>
    );
  }
}

function actionBtnStyle(primary = false): CSSProperties {
  return {
    background: primary ? 'var(--accent-cyan)' : 'var(--bg-panel-header)',
    color: primary ? '#06202c' : 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: 3,
    padding: '5px 12px',
    fontSize: 11.5,
    fontWeight: primary ? 600 : 500,
    cursor: 'pointer',
    transition: 'background 0.15s ease',
  };
}
