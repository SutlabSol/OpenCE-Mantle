import React, { useState, useEffect, useMemo } from 'react';
import type { HaloBitmapVersion, BitmapIdentificationResult, BitmapIdentificationEntry } from '../../electron/shared-types';

export interface IdentifyBitmapsDialogProps {
  initialVersion?: HaloBitmapVersion;
  isOpen: boolean;
  onClose: () => void;
  openMapScenarioName?: string | null;
}

const VERSION_METADATA: Record<
  HaloBitmapVersion,
  {
    title: string;
    badge: string;
    description: string;
    expectedEntries: string;
    expectedSize: string;
    notes: string;
  }
> = {
  halomd: {
    title: 'HaloMD (Mac OS X)',
    badge: 'HaloMD Modded Resource',
    description: 'High-resolution community Mac OS X port assets with extended bitmap containers.',
    expectedEntries: '~1,568 to 2,500+ entries',
    expectedSize: '~317 MB (or extended packs)',
    notes: 'Supports high-res textures, DXT1-5, P8 indexed, and expanded multiplayer network assets.',
  },
  ce: {
    title: 'Halo Custom Edition (PC CE)',
    badge: 'Official CE Resource',
    description: 'Standard 2004 PC Custom Edition shared bitmaps resource container.',
    expectedEntries: '1,568 entries',
    expectedSize: '34,369,536 bytes (~34.37 MB)',
    notes: 'Used by all stock and custom CE maps. Required for external bitmap tags without internal textures.',
  },
  pc: {
    title: 'Halo PC Retail (1.00 - 1.10)',
    badge: 'Retail PC Resource',
    description: 'Original 2003 PC Retail release shared bitmaps container.',
    expectedEntries: '1,568 entries',
    expectedSize: '34,369,536 bytes (~34.37 MB)',
    notes: 'Compatible with retail PC single-player campaign and multiplayer maps.',
  },
  demo: {
    title: 'Halo Mac / PC Demo',
    badge: 'Trimmed Demo Resource',
    description: 'Compact standalone demo bitmaps container featuring Blood Gulch multiplayer textures.',
    expectedEntries: '~400 - 550 entries',
    expectedSize: '~10 - 15 MB',
    notes: 'Optimized demo package containing only bloodgulch and basic cyborg/vehicle UI assets.',
  },
  mcc: {
    title: 'Halo MCC (Master Chief Collection)',
    badge: 'MCC H1 Resource',
    description: 'Master Chief Collection (Steam / Windows Store) Halo 1 shared bitmaps container.',
    expectedEntries: '~1,818 entries',
    expectedSize: '~185.6 MB (185,614,690 bytes)',
    notes: 'Used by MCC CEA campaign and multiplayer maps. Modern remastered release assets.',
  },
};

export default function IdentifyBitmapsDialog({
  initialVersion = 'ce',
  isOpen,
  onClose,
  openMapScenarioName,
}: IdentifyBitmapsDialogProps) {
  const [selectedVersion, setSelectedVersion] = useState<HaloBitmapVersion>(initialVersion);
  const [filePath, setFilePath] = useState<string>('');
  const [activeBitmapsPath, setActiveBitmapsPath] = useState<string | null>(null);
  const [defaultPaths, setDefaultPaths] = useState<Record<HaloBitmapVersion, string | null>>({
    halomd: null,
    ce: null,
    pc: null,
    demo: null,
    mcc: null,
  });

  const [identifying, setIdentifying] = useState<boolean>(false);
  const [result, setResult] = useState<BitmapIdentificationResult | null>(null);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [versionSettings, setVersionSettings] = useState<Partial<Record<HaloBitmapVersion, { bitmaps: string | null; sounds: string | null }>>>({});
  const [savedForVersion, setSavedForVersion] = useState<boolean>(false);
  const [appliedActive, setAppliedActive] = useState<boolean>(false);

  useEffect(() => {
    setSelectedVersion(initialVersion);
  }, [initialVersion]);

  // Load current settings, version settings, and detected default paths on open
  useEffect(() => {
    if (!isOpen) return;
    setAppliedActive(false);
    setSavedForVersion(false);

    window.opence
      .getVersionSettings?.()
      .then((vs) => {
        if (vs) setVersionSettings(vs);
      })
      .catch(() => {});

    window.opence
      .getSettings?.()
      .then((settings) => {
        if (settings?.resourceMaps?.bitmaps) {
          setActiveBitmapsPath(settings.resourceMaps.bitmaps);
          if (!filePath) {
            setFilePath(settings.resourceMaps.bitmaps);
          }
        }
      })
      .catch(() => {});

    window.opence
      .detectDefaultResourceMapPaths?.()
      .then((defaults) => {
        if (defaults) {
          setDefaultPaths(defaults);
          // If no file path selected yet, use default for this version
          if (!filePath && defaults[selectedVersion]) {
            setFilePath(defaults[selectedVersion]!);
          }
        }
      })
      .catch(() => {});
  }, [isOpen, selectedVersion]);

  // Run identification whenever filePath or selectedVersion changes
  useEffect(() => {
    if (!isOpen || !filePath.trim()) {
      setResult(null);
      return;
    }

    let active = true;
    setIdentifying(true);

    window.opence
      .identifyResourceMap?.(filePath.trim(), selectedVersion)
      .then((res) => {
        if (!active) return;
        setResult(res);
        setIdentifying(false);
      })
      .catch((err) => {
        if (!active) return;
        setResult({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          filePath,
          fileSizeBytes: 0,
          entryCount: 0,
          tableOffset: 0,
          detectedVersion: 'unknown',
          versionMatchConfidence: 'mismatch',
          entries: [],
        });
        setIdentifying(false);
      });

    return () => {
      active = false;
    };
  }, [filePath, selectedVersion, isOpen]);

  const handlePickFile = async () => {
    try {
      const picked = await window.opence.pickConvertResource?.('bitmaps');
      if (picked && picked.path) {
        setFilePath(picked.path);
      }
    } catch {
      // Fallback
    }
  };

  const handleSaveForVersion = async () => {
    if (!filePath || !result?.ok) return;
    try {
      await window.opence.setVersionSettings?.(selectedVersion, { bitmaps: filePath });
      setSavedForVersion(true);
      setVersionSettings((prev) => ({
        ...prev,
        [selectedVersion]: {
          ...prev[selectedVersion],
          bitmaps: filePath,
          sounds: prev[selectedVersion]?.sounds ?? null,
        },
      }));
    } catch (err) {
      console.error('Failed to save version resource map:', err);
    }
  };

  const handleApplyAsActive = async () => {
    if (!filePath || !result?.ok) return;
    try {
      await window.opence.setVersionSettings?.(selectedVersion, { bitmaps: filePath });
      await window.opence.setResourceMapPath?.('bitmaps', filePath);
      setActiveBitmapsPath(filePath);
      setAppliedActive(true);
      setSavedForVersion(true);
      setVersionSettings((prev) => ({
        ...prev,
        [selectedVersion]: {
          ...prev[selectedVersion],
          bitmaps: filePath,
          sounds: prev[selectedVersion]?.sounds ?? null,
        },
      }));
    } catch (err) {
      console.error('Failed to set active resource map:', err);
    }
  };

  const handleUseDefault = () => {
    const def = defaultPaths[selectedVersion];
    if (def) {
      setFilePath(def);
    }
  };

  const filteredEntries = useMemo<BitmapIdentificationEntry[]>(() => {
    if (!result || !result.entries) return [];
    if (!searchFilter.trim()) return result.entries.slice(0, 300);
    const q = searchFilter.toLowerCase();
    return result.entries.filter((e) => e.name.toLowerCase().includes(q) || String(e.index).includes(q));
  }, [result, searchFilter]);

  if (!isOpen) return null;

  const meta = VERSION_METADATA[selectedVersion];
  const isActiveConfigured = activeBitmapsPath && filePath && activeBitmapsPath.toLowerCase() === filePath.toLowerCase();

  return (
    <div
      data-testid="identify-bitmaps-dialog-overlay"
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
        data-testid="identify-bitmaps-dialog"
        style={{
          width: 720,
          maxWidth: '92vw',
          maxHeight: '90vh',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 8,
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
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 20px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-panel-header)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>Identify Bitmaps</span>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                textTransform: 'uppercase',
                padding: '2px 8px',
                borderRadius: 4,
                background: 'rgba(0, 229, 255, 0.15)',
                color: 'var(--accent-cyan)',
                border: '1px solid rgba(0, 229, 255, 0.3)',
              }}
            >
              {meta.badge}
            </span>
          </div>
          <button
            data-testid="identify-bitmaps-close-btn"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dim)',
              fontSize: 18,
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Edition Selector Tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-main)',
            padding: '0 14px',
          }}
        >
          {(
            [
              ['halomd', 'HaloMD'],
              ['ce', 'Custom Edition'],
              ['pc', 'Halo PC'],
              ['demo', 'Halo Mac Demo'],
              ['mcc', 'Halo MCC'],
            ] as const
          ).map(([ver, label]) => {
            const isSelected = selectedVersion === ver;
            const hasConfigured = Boolean(versionSettings[ver]?.bitmaps);
            return (
              <button
                key={ver}
                data-testid={`identify-tab-${ver}`}
                onClick={() => {
                  setSelectedVersion(ver);
                  setSavedForVersion(false);
                  const configured = versionSettings[ver]?.bitmaps;
                  if (configured) {
                    setFilePath(configured);
                  } else {
                    const def = defaultPaths[ver];
                    if (def) setFilePath(def);
                    else setFilePath('');
                  }
                }}
                style={{
                  padding: '10px 16px',
                  background: isSelected ? 'var(--bg-panel)' : 'transparent',
                  color: isSelected ? 'var(--accent-cyan)' : 'var(--text-dim)',
                  border: 'none',
                  borderBottom: isSelected ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                  fontWeight: isSelected ? 700 : 500,
                  fontSize: 12,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>{label}</span>
                {hasConfigured && (
                  <span
                    data-testid={`identify-tab-badge-${ver}`}
                    title="Configured"
                    style={{
                      display: 'inline-block',
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: '#4ade80',
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Dialog Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Version Profile Overview */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '12px 16px',
              fontSize: 11.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>{meta.title} Specification</div>
            <div style={{ color: 'var(--text-secondary)' }}>{meta.description}</div>
            <div style={{ display: 'flex', gap: 20, marginTop: 4, color: 'var(--text-dim)', fontSize: 11 }}>
              <span>Expected: <strong style={{ color: 'var(--text-primary)' }}>{meta.expectedEntries}</strong></span>
              <span>Size: <strong style={{ color: 'var(--text-primary)' }}>{meta.expectedSize}</strong></span>
            </div>
            <div style={{ color: 'var(--text-dim)', fontSize: 10.5, fontStyle: 'italic', marginTop: 2 }}>{meta.notes}</div>
          </div>

          {/* File Path Picker Row */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
              Resource File Path (bitmaps.map)
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                data-testid="identify-bitmaps-path-input"
                type="text"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                placeholder="Path to bitmaps.map..."
                style={{
                  flex: 1,
                  background: 'var(--bg-main)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '7px 10px',
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  fontFamily: 'var(--mono-font)',
                  outline: 'none',
                }}
              />
              <button
                data-testid="identify-bitmaps-browse-btn"
                onClick={handlePickFile}
                style={{
                  background: 'var(--bg-main)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '7px 14px',
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Browse...
              </button>
              {defaultPaths[selectedVersion] && (
                <button
                  data-testid="identify-bitmaps-default-btn"
                  onClick={handleUseDefault}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--accent-cyan)',
                    borderRadius: 4,
                    padding: '7px 12px',
                    color: 'var(--accent-cyan)',
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                  title={`Detected at: ${defaultPaths[selectedVersion]}`}
                >
                  Use Default
                </button>
              )}
            </div>
          </div>

          {/* Analysis & Identification Results Card */}
          {identifying && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--accent-cyan)', fontSize: 13 }}>
              Inspecting resource table and bitmap headers...
            </div>
          )}

          {!identifying && result && (
            <div
              data-testid="identify-bitmaps-result-card"
              style={{
                border: `1px solid ${result.ok ? 'rgba(76, 175, 80, 0.4)' : 'rgba(244, 67, 54, 0.4)'}`,
                background: result.ok ? 'rgba(76, 175, 80, 0.05)' : 'rgba(244, 67, 54, 0.05)',
                borderRadius: 6,
                padding: '14px 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: result.ok ? '#4caf50' : '#f44336',
                      display: 'inline-block',
                    }}
                  />
                  <span style={{ fontWeight: 700, fontSize: 13, color: result.ok ? '#81c784' : '#e57373' }}>
                    {result.ok ? 'Valid Halo Bitmaps Resource Map' : 'Invalid or Unreadable File'}
                  </span>
                </div>

                {result.ok && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '3px 8px',
                      borderRadius: 4,
                      background:
                        result.versionMatchConfidence === 'exact'
                          ? 'rgba(76, 175, 80, 0.2)'
                          : 'rgba(255, 152, 0, 0.2)',
                      color:
                        result.versionMatchConfidence === 'exact' ? '#81c784' : '#ffb74d',
                    }}
                  >
                    Match: {result.detectedVersion.toUpperCase()} (
                    {result.versionMatchConfidence === 'exact' ? 'Exact Edition' : 'Compatible Profile'})
                  </span>
                )}
              </div>

              {result.ok ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, fontSize: 11.5 }}>
                  <div style={{ background: 'var(--bg-main)', padding: '8px 10px', borderRadius: 4 }}>
                    <div style={{ color: 'var(--text-dim)', fontSize: 10, textTransform: 'uppercase' }}>Entries Count</div>
                    <div style={{ fontWeight: 700, fontSize: 13, fontFamily: 'var(--mono-font)' }}>
                      {result.entryCount.toLocaleString()} bitmaps
                    </div>
                  </div>
                  <div style={{ background: 'var(--bg-main)', padding: '8px 10px', borderRadius: 4 }}>
                    <div style={{ color: 'var(--text-dim)', fontSize: 10, textTransform: 'uppercase' }}>File Size</div>
                    <div style={{ fontWeight: 700, fontSize: 13, fontFamily: 'var(--mono-font)' }}>
                      {(result.fileSizeBytes / 1024 / 1024).toFixed(2)} MB
                    </div>
                  </div>
                  <div style={{ background: 'var(--bg-main)', padding: '8px 10px', borderRadius: 4 }}>
                    <div style={{ color: 'var(--text-dim)', fontSize: 10, textTransform: 'uppercase' }}>Table Offset</div>
                    <div style={{ fontWeight: 700, fontSize: 13, fontFamily: 'var(--mono-font)' }}>
                      0x{result.tableOffset.toString(16).toUpperCase()}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#e57373' }}>{result.error}</div>
              )}

              {/* Map Compatibility Status (if map is open) */}
              {openMapScenarioName && result.ok && (
                <div
                  style={{
                    borderTop: '1px solid var(--border)',
                    paddingTop: 8,
                    fontSize: 11,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    color: 'var(--text-secondary)',
                  }}
                >
                  <span style={{ color: 'var(--accent-cyan)' }}>Map &quot;{openMapScenarioName}&quot;:</span>
                  <span>Resource table verified ready for tag extraction and 3D viewport rendering.</span>
                </div>
              )}
            </div>
          )}

          {/* Searchable Entries Preview */}
          {result && result.ok && result.entries.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                  Contained Bitmaps ({result.entries.length.toLocaleString()})
                </span>
                <input
                  data-testid="identify-bitmaps-search-input"
                  type="text"
                  placeholder="Filter by name or index..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  style={{
                    background: 'var(--bg-main)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    padding: '3px 8px',
                    color: 'var(--text-primary)',
                    fontSize: 11,
                    width: 220,
                    outline: 'none',
                  }}
                />
              </div>

              <div
                style={{
                  height: 180,
                  overflowY: 'auto',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  background: 'var(--bg-main)',
                  fontSize: 11,
                  fontFamily: 'var(--mono-font)',
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-panel-header)', zIndex: 1 }}>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '5px 8px', width: 50 }}>#</th>
                      <th style={{ padding: '5px 8px' }}>Tag Path</th>
                      <th style={{ padding: '5px 8px', width: 90 }}>Offset</th>
                      <th style={{ padding: '5px 8px', width: 80 }}>Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntries.map((e) => (
                      <tr
                        key={e.index}
                        style={{
                          borderBottom: '1px solid rgba(255,255,255,0.03)',
                        }}
                      >
                        <td style={{ padding: '4px 8px', color: 'var(--text-dim)' }}>{e.index}</td>
                        <td
                          style={{
                            padding: '4px 8px',
                            color: 'var(--text-primary)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            maxWidth: 360,
                          }}
                          title={e.name}
                        >
                          {e.name}
                        </td>
                        <td style={{ padding: '4px 8px', color: 'var(--text-secondary)' }}>
                          0x{e.dataOffset.toString(16).toUpperCase()}
                        </td>
                        <td style={{ padding: '4px 8px', color: 'var(--text-dim)' }}>
                          {(e.size / 1024).toFixed(1)} KB
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 20px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-panel-header)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
            {isActiveConfigured || appliedActive ? (
              <span style={{ color: '#81c784', fontWeight: 600 }}>✓ Configured as Active bitmaps.map</span>
            ) : (
              <span style={{ color: 'var(--text-dim)' }}>Configure this file to enable textures for this edition.</span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {filePath && result?.ok && (
              <button
                data-testid="identify-bitmaps-save-version-btn"
                onClick={handleSaveForVersion}
                style={{
                  background: 'var(--bg-main)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '6px 14px',
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {savedForVersion ? '✓ Saved for Edition' : `Save for ${selectedVersion.toUpperCase()}`}
              </button>
            )}
            {result && result.ok && !isActiveConfigured && !appliedActive && (
              <button
                data-testid="identify-bitmaps-set-active-btn"
                onClick={handleApplyAsActive}
                style={{
                  background: 'var(--accent-cyan)',
                  color: '#000',
                  border: 'none',
                  borderRadius: 4,
                  padding: '6px 14px',
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Set as Active Resource Map
              </button>
            )}
            <button
              data-testid="identify-bitmaps-done-btn"
              onClick={onClose}
              style={{
                background: 'var(--bg-main)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '6px 16px',
                fontSize: 11.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
