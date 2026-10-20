import { useEffect, useState } from 'react';
import type { BspInfo, BspSwapPreflightResult } from '../../electron/shared-types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function BspSwapperDialog({ isOpen, onClose, onSuccess }: Props) {
  const [sourcePath, setSourcePath] = useState('');
  const [isPreflighting, setIsPreflighting] = useState(false);
  const [preflight, setPreflight] = useState<BspSwapPreflightResult | null>(null);
  const [selectedSourceBspIndex, setSelectedSourceBspIndex] = useState(0);
  const [selectedTargetBspIndex, setSelectedTargetBspIndex] = useState(0);
  const [stripDobcAndDecals, setStripDobcAndDecals] = useState(true);
  const [stripDobc, setStripDobc] = useState(true);
  const [stripDecals, setStripDecals] = useState(true);
  const [showDobcInfo, setShowDobcInfo] = useState(false);
  const [showDecalsInfo, setShowDecalsInfo] = useState(false);
  const [newScenarioName, setNewScenarioName] = useState('');
  const [relocateGroundObjects, setRelocateGroundObjects] = useState(true);
  const [harvestShaders, setHarvestShaders] = useState(true);
  const [isSwapping, setIsSwapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successSummary, setSuccessSummary] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setSourcePath('');
      setPreflight(null);
      setError(null);
      setSuccessSummary(null);
      setIsSwapping(false);
      setNewScenarioName('');
      setShowDobcInfo(false);
      setShowDecalsInfo(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePickSource = async () => {
    try {
      const res = await window.opence.pickBspSourceMap();
      if (res && res.path) {
        setSourcePath(res.path);
        runPreflight(res.path, 0, 0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const runPreflight = async (srcPath: string, srcIdx: number, dstIdx: number) => {
    setIsPreflighting(true);
    setError(null);
    try {
      const result = await window.opence.bspSwapPreflight(srcPath, srcIdx, dstIdx);
      setIsPreflighting(false);
      setPreflight(result);
      if (!result.ok) {
        setError(result.error || 'Failed to analyze source map BSPs.');
      } else {
        setSelectedSourceBspIndex(srcIdx);
        setSelectedTargetBspIndex(dstIdx);
      }
    } catch (err) {
      setIsPreflighting(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSourceBspChange = (idx: number) => {
    setSelectedSourceBspIndex(idx);
    if (sourcePath) {
      runPreflight(sourcePath, idx, selectedTargetBspIndex);
    }
  };

  const handleTargetBspChange = (idx: number) => {
    setSelectedTargetBspIndex(idx);
    if (sourcePath) {
      runPreflight(sourcePath, selectedSourceBspIndex, idx);
    }
  };

  const handleSwap = async () => {
    if (!sourcePath || !preflight || !preflight.ok) return;

    setIsSwapping(true);
    setError(null);
    setSuccessSummary(null);

    try {
      const payload: any = {
        sourceBspIndex: selectedSourceBspIndex,
        targetBspIndex: selectedTargetBspIndex,
        stripDobcAndDecals: stripDobc && stripDecals,
        relocateGroundObjects,
        harvestShaders,
      };
      if (!stripDobc || !stripDecals) {
        payload.stripDobc = stripDobc;
        payload.stripDecals = stripDecals;
      }
      if (newScenarioName.trim()) {
        payload.newScenarioName = newScenarioName.trim();
      }

      const res = await window.opence.performBspSwap(sourcePath, payload);

      setIsSwapping(false);
      if (res.ok) {
        const deltaMb = (res.summary.delta / (1024 * 1024)).toFixed(2);
        const deltaSign = res.summary.delta >= 0 ? '+' : '';
        const harvestMsg =
          (res.summary.harvestedShaders ?? 0) > 0 || (res.summary.harvestedBitmaps ?? 0) > 0
            ? ` Harvested ${res.summary.harvestedShaders ?? 0} shaders and ${res.summary.harvestedBitmaps ?? 0} bitmaps into map.`
            : '';
        const msg = `Successfully swapped BSP! Source: "${res.summary.sourceBspName}". Delta: ${deltaSign}${deltaMb} MB.${harvestMsg} ${res.summary.strippedDobc ? 'Stripped DOBC & Decals. ' : ''}${res.summary.relocatedSpawns > 0 ? `Relocated ${res.summary.relocatedSpawns} ground objects.` : ''}`;
        setSuccessSummary(msg);
        onSuccess();
      } else {
        setError(res.error || 'BSP swap failed.');
      }
    } catch (err) {
      setIsSwapping(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const formatBytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

  return (
    <div
      data-testid="bsp-swapper-dialog-overlay"
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
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSwapping) onClose();
      }}
    >
      <div
        data-testid="bsp-swapper-dialog"
        style={{
          width: '640px',
          maxWidth: '92vw',
          maxHeight: '90vh',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: '6px',
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
            padding: '14px 20px',
            background: 'var(--bg-panel-header)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '15px', fontWeight: 700 }}>Automated BSP Swapper</span>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 700,
                textTransform: 'uppercase',
                padding: '2px 8px',
                borderRadius: '4px',
                background: 'rgba(56, 189, 248, 0.2)',
                color: 'var(--accent-cyan, #38bdf8)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
              }}
            >
              Milestone 10
            </span>
          </div>
          <button
            data-testid="bsp-swapper-close-btn"
            disabled={isSwapping}
            onClick={onClose}
            style={{
              background: 'transparent',
              color: 'var(--text-dim)',
              fontSize: '18px',
              cursor: isSwapping ? 'not-allowed' : 'pointer',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '18px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Instructions banner */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--border)',
              borderRadius: '5px',
              padding: '10px 14px',
              fontSize: '12px',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
            }}
          >
            Directly transplant single-player campaign BSPs (e.g. Silent Cartographer, Halo, Truth & Reconciliation)
            into your multiplayer map. Geometry, submeshes, and vertices are relocated in-memory.
          </div>

          {/* Source Map Picker */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
              Source Map File (.map)
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                data-testid="bsp-swapper-source-input"
                type="text"
                readOnly
                placeholder="Select a campaign or multiplayer map..."
                value={sourcePath}
                style={{
                  flex: 1,
                  background: 'var(--bg-main)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  padding: '7px 10px',
                  fontSize: '12px',
                  fontFamily: 'var(--mono-font)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                }}
              />
              <button
                data-testid="bsp-swapper-browse-btn"
                disabled={isSwapping || isPreflighting}
                onClick={handlePickSource}
                style={{
                  background: 'var(--bg-panel-header)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  padding: '7px 14px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: isSwapping ? 'not-allowed' : 'pointer',
                  color: 'var(--text-primary)',
                }}
              >
                Browse...
              </button>
            </div>
          </div>

          {isPreflighting && (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--accent-cyan)', fontSize: '12px' }}>
              Analyzing structure BSPs and dependencies...
            </div>
          )}

          {preflight && preflight.ok && (
            <>
              {/* Source BSP Selector */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                  Select Source BSP to Import
                </label>
                <select
                  data-testid="bsp-swapper-source-select"
                  value={selectedSourceBspIndex}
                  onChange={(e) => handleSourceBspChange(Number(e.target.value))}
                  style={{
                    background: 'var(--bg-main)',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    padding: '8px 10px',
                    fontSize: '12px',
                    color: 'var(--text-primary)',
                    outline: 'none',
                  }}
                >
                  {preflight.sourceBsps.map((bsp: BspInfo) => (
                    <option key={bsp.index} value={bsp.index}>
                      BSP {bsp.index}: {bsp.path} ({bsp.vertexCount.toLocaleString()} verts, {bsp.triangleCount.toLocaleString()} tris, {formatBytes(bsp.bspSize)})
                    </option>
                  ))}
                </select>
              </div>

              {/* Target BSP Selector */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                  Target BSP Slot to Replace
                </label>
                <select
                  data-testid="bsp-swapper-target-select"
                  value={selectedTargetBspIndex}
                  onChange={(e) => handleTargetBspChange(Number(e.target.value))}
                  style={{
                    background: 'var(--bg-main)',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    padding: '8px 10px',
                    fontSize: '12px',
                    color: 'var(--text-primary)',
                    outline: 'none',
                  }}
                >
                  {preflight.targetBsps.map((bsp: BspInfo) => (
                    <option key={bsp.index} value={bsp.index}>
                      BSP {bsp.index}: {bsp.path} ({formatBytes(bsp.bspSize)})
                    </option>
                  ))}
                </select>
              </div>

              {/* Preflight Stats Card */}
              <div
                data-testid="bsp-swapper-stats-card"
                style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--border)',
                  borderRadius: '5px',
                  padding: '12px 14px',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '12px',
                  fontSize: '11.5px',
                }}
              >
                <div>
                  <div style={{ color: 'var(--text-dim)', fontSize: '10.5px' }}>Source Geometry</div>
                  <div style={{ fontWeight: 600, marginTop: '2px' }}>
                    {preflight.selectedSourceBsp?.vertexCount.toLocaleString()} vertices
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '10.5px' }}>
                    {preflight.selectedSourceBsp?.triangleCount.toLocaleString()} triangles
                  </div>
                </div>

                <div>
                  <div style={{ color: 'var(--text-dim)', fontSize: '10.5px' }}>Size Delta</div>
                  <div
                    style={{
                      fontWeight: 600,
                      marginTop: '2px',
                      color: preflight.sizeDelta >= 0 ? '#38bdf8' : '#34d399',
                    }}
                  >
                    {preflight.sizeDelta >= 0 ? '+' : ''}
                    {formatBytes(preflight.sizeDelta)}
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '10.5px' }}>
                    Est: {formatBytes(preflight.estimatedNewSize)}
                  </div>
                </div>

                <div>
                  <div style={{ color: 'var(--text-dim)', fontSize: '10.5px' }}>Submeshes</div>
                  <div style={{ fontWeight: 600, marginTop: '2px' }}>
                    {preflight.selectedSourceBsp?.submeshCount ?? 0} submeshes
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '10.5px' }}>
                    {preflight.selectedSourceBsp?.hasDobc ? 'DOBC present' : 'Clean DOBC'}
                  </div>
                </div>
              </div>

              {/* Scenario Name Rename Option */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                  In-Game Scenario Name (Optional Rename)
                </label>
                <input
                  data-testid="bsp-swapper-scenario-name-input"
                  type="text"
                  placeholder="e.g. bloodgulch_silent_cartographer (leave blank to keep current name)"
                  value={newScenarioName}
                  onChange={(e) => setNewScenarioName(e.target.value)}
                  maxLength={31}
                  style={{
                    background: 'var(--bg-main)',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    padding: '7px 10px',
                    fontSize: '12px',
                    fontFamily: 'var(--mono-font)',
                    color: 'var(--text-primary)',
                    outline: 'none',
                  }}
                />
                <span style={{ fontSize: '10.5px', color: 'var(--text-dim)' }}>
                  Updates the internal scenario header name displayed in the Halo multiplayer UI map list.
                </span>
              </div>

              {/* Options */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '2px' }}>
                {/* DOBC Strip */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
                      <input
                        data-testid="bsp-swapper-strip-dobc-checkbox"
                        type="checkbox"
                        checked={stripDobc}
                        onChange={(e) => {
                          setStripDobc(e.target.checked);
                          setStripDobcAndDecals(e.target.checked && stripDecals);
                        }}
                      />
                      <span>
                        <strong>Strip Detail Objects (DOBC)</strong> (Recommended: prevents multiplayer memory crashes)
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowDobcInfo(!showDobcInfo)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--accent-cyan)', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      {showDobcInfo ? 'Hide Details' : 'What is DOBC?'}
                    </button>
                  </div>
                  {showDobcInfo && (
                    <div style={{ background: 'rgba(0, 0, 0, 0.25)', border: '1px solid var(--border)', borderRadius: '4px', padding: '8px 10px', fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                      Detail objects (<code>dobc</code>) are procedural ground clutter (grass clumps, moss, ferns, pebbles) scattered across campaign terrain via density functions. In multiplayer, DOBC is not synchronized across the network and can exceed client vertex and memory limits, causing fatal crashes or massive FPS drops. Stripping zeroes out the reflexive count and pointer at offset <code>0x24C</code> in the BSP header.
                    </div>
                  )}
                </div>

                {/* Decals Strip */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
                      <input
                        data-testid="bsp-swapper-strip-decals-checkbox"
                        type="checkbox"
                        checked={stripDecals}
                        onChange={(e) => {
                          setStripDecals(e.target.checked);
                          setStripDobcAndDecals(stripDobc && e.target.checked);
                        }}
                      />
                      <span>
                        <strong>Strip Runtime Decals</strong> (Recommended: preserves multiplayer weapon impact buffer)
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowDecalsInfo(!showDecalsInfo)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--accent-cyan)', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      {showDecalsInfo ? 'Hide Details' : 'What are Decals?'}
                    </button>
                  </div>
                  {showDecalsInfo && (
                    <div style={{ background: 'rgba(0, 0, 0, 0.25)', border: '1px solid var(--border)', borderRadius: '4px', padding: '8px 10px', fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                      Runtime decals are static decals (blood splatters, plasma scorch burns, bullet marks, covenant glyphs) pre-baked into campaign level geometry. Halo multiplayer allocates a strict global static decal buffer shared between the level and combat weapon impacts. Pre-baked campaign decals consume this buffer, causing player bullet holes and plasma impacts to flicker or disappear. Stripping zeroes out the reflexive count and pointer at offset <code>0x258</code> in the BSP header.
                    </div>
                  )}
                </div>

                {/* Spawns Relocation */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    data-testid="bsp-swapper-relocate-checkbox"
                    type="checkbox"
                    checked={relocateGroundObjects}
                    onChange={(e) => setRelocateGroundObjects(e.target.checked)}
                  />
                  <span>
                    <strong>Relocate Player Spawns & Equipment to Floor</strong> (Adjusts Z coordinates onto new terrain)
                  </span>
                </label>

                {/* Harvest Shaders & Bitmaps */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    data-testid="bsp-swapper-harvest-shaders-checkbox"
                    type="checkbox"
                    checked={harvestShaders}
                    onChange={(e) => setHarvestShaders(e.target.checked)}
                  />
                  <span>
                    <strong>Harvest Shaders & Bitmaps</strong> (Recommended: imports missing terrain textures & shaders into target map)
                  </span>
                </label>
              </div>

              {/* Warnings */}
              {preflight.warnings.length > 0 && (
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: '4px',
                    background: 'rgba(234, 179, 8, 0.1)',
                    border: '1px solid rgba(234, 179, 8, 0.3)',
                    color: 'var(--warn-text, #facc15)',
                    fontSize: '11px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  {preflight.warnings.map((w, i) => (
                    <div key={i}>⚠ {w}</div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Error display */}
          {error && (
            <div
              data-testid="bsp-swapper-error"
              style={{
                padding: '10px 12px',
                borderRadius: '4px',
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                color: '#f87171',
                fontSize: '12px',
              }}
            >
              {error}
            </div>
          )}

          {/* Success summary display */}
          {successSummary && (
            <div
              data-testid="bsp-swapper-success"
              style={{
                padding: '10px 12px',
                borderRadius: '4px',
                background: 'rgba(34, 197, 94, 0.12)',
                border: '1px solid rgba(34, 197, 94, 0.35)',
                color: '#4ade80',
                fontSize: '12px',
                lineHeight: 1.4,
              }}
            >
              {successSummary}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-panel-header)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
            Changes are applied in-memory. Use File &gt; Save to commit.
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              data-testid="bsp-swapper-cancel-btn"
              disabled={isSwapping}
              onClick={onClose}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
                borderRadius: '4px',
                padding: '6px 14px',
                fontSize: '12px',
                cursor: isSwapping ? 'not-allowed' : 'pointer',
              }}
            >
              {successSummary ? 'Done' : 'Cancel'}
            </button>
            <button
              data-testid="bsp-swapper-perform-btn"
              disabled={isSwapping || isPreflighting || !preflight || !preflight.ok}
              onClick={handleSwap}
              style={{
                background: isSwapping || !preflight?.ok ? 'rgba(56, 189, 248, 0.3)' : 'var(--accent-cyan, #38bdf8)',
                color: 'rgb(6, 32, 44)',
                border: 'none',
                borderRadius: '4px',
                padding: '6px 18px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: isSwapping || !preflight?.ok ? 'not-allowed' : 'pointer',
              }}
            >
              {isSwapping ? 'Swapping BSP...' : 'Perform BSP Swap'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
