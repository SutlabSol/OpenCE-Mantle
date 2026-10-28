import { useEffect, useState, useMemo } from 'react';
import type { BspInfo, BspSwapPreflightResult } from '../../electron/shared-types';
import BspPreviewViewport from './viewport/BspPreviewViewport';

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
  const [stripDobc, setStripDobc] = useState(true);
  const [stripDecals, setStripDecals] = useState(true);
  const [customBitmapsPath, setCustomBitmapsPath] = useState<string | null>(null);
  const [customSoundsPath, setCustomSoundsPath] = useState<string | null>(null);
  const [showDobcInfo, setShowDobcInfo] = useState(false);
  const [showDecalsInfo, setShowDecalsInfo] = useState(false);
  const [newScenarioName, setNewScenarioName] = useState('');
  const [relocateGroundObjects, setRelocateGroundObjects] = useState(true);
  const [harvestShaders, setHarvestShaders] = useState(true);
  const [importScenery, setImportScenery] = useState(true);
  const [importMachines, setImportMachines] = useState(true);
  const [importVehicles, setImportVehicles] = useState(true);
  const [makeDoorsAutomatic, setMakeDoorsAutomatic] = useState(true);
  const [filterObjectsToBspBounds, setFilterObjectsToBspBounds] = useState(true);
  const [clearExistingPlacements, setClearExistingPlacements] = useState(false);
  const [clearPlayerSpawns, setClearPlayerSpawns] = useState(false);
  const [isExportingBsp, setIsExportingBsp] = useState(false);
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
      setCustomBitmapsPath(null);
      setCustomSoundsPath(null);
      setSelectedSourceBspIndex(0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePickSource = async () => {
    try {
      const res = await window.opence.pickBspSourceMap();
      if (res && res.path) {
        setSourcePath(res.path);
        setSelectedSourceBspIndex(0);
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

  const handlePickBitmaps = async () => {
    try {
      const res = await window.opence.pickBspResource?.('bitmaps');
      if (res && res.path) setCustomBitmapsPath(res.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handlePickSounds = async () => {
    try {
      const res = await window.opence.pickBspResource?.('sounds');
      if (res && res.path) setCustomSoundsPath(res.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
        importScenery,
        importMachines,
        importSceneryAndMachines: importScenery || importMachines,
        importVehicles,
        makeDoorsAutomatic,
        filterObjectsToBspBounds,
        clearExistingPlacements,
        clearPlayerSpawns,
        bspScriptMode: 'none',
        addBspActivationScript: false,
      };
      if (!stripDobc || !stripDecals) {
        payload.stripDobc = stripDobc;
        payload.stripDecals = stripDecals;
      }
      if (newScenarioName.trim()) {
        payload.newScenarioName = newScenarioName.trim();
      }
      if (customBitmapsPath) {
        payload.customBitmapsPath = customBitmapsPath;
      }
      if (customSoundsPath) {
        payload.customSoundsPath = customSoundsPath;
      }

      const res = await window.opence.performBspSwap(sourcePath, payload);

      setIsSwapping(false);
      if (res.ok) {
        const deltaMb = (res.summary.delta / (1024 * 1024)).toFixed(2);
        const deltaSign = res.summary.delta >= 0 ? '+' : '';
        const harvestMsg =
          (res.summary.harvestedShaders ?? 0) > 0 || (res.summary.harvestedBitmaps ?? 0) > 0
            ? ` Harvested ${res.summary.harvestedShaders ?? 0} shader(s) and ${res.summary.harvestedBitmaps ?? 0} bitmap(s).`
            : '';
        const parts: string[] = [];
        if ((res.summary.importedScenery ?? 0) > 0) parts.push(`${res.summary.importedScenery} scenery object(s)`);
        if ((res.summary.importedVehicles ?? 0) > 0) parts.push(`${res.summary.importedVehicles} vehicle(s)`);
        if ((res.summary.importedMachines ?? 0) > 0) parts.push(`${res.summary.importedMachines} door(s)/bridge(s)`);
        const sceneryMsg = parts.length > 0 ? ` Imported ${parts.join(', ')}.` : '';
        setSuccessSummary(
          `Swapped BSP successfully! New map size: ${(res.summary.newSize / (1024 * 1024)).toFixed(2)} MB (${deltaSign}${deltaMb} MB). Relocated ${res.summary.relocatedSpawns} spawn/item placement(s).${harvestMsg}${sceneryMsg}`,
        );
        onSuccess();
      } else {
        setError(res.error || 'BSP swap failed.');
      }
    } catch (err) {
      setIsSwapping(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  const bspNamesMap = useMemo(() => {
    const map: Record<number, string> = {};
    preflight?.sourceBsps.forEach((b) => {
      map[b.index] = b.path;
    });
    return map;
  }, [preflight]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSwapping) onClose();
      }}
    >
      <div
        data-testid="bsp-swapper-dialog"
        style={{
          width: '1140px',
          maxWidth: '95vw',
          height: '90vh',
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
              Milestone 10.2
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
        <div style={{ padding: '16px 20px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'hidden' }}>
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
            Directly transplant a single-player campaign or multiplayer Structure BSP (e.g. Silent Cartographer, Halo, Truth &amp; Reconciliation)
            into your open map, or export BSPs to Wavefront .OBJ + .MTL / .GLB for custom editing in Blender.
          </div>

          {/* Source Map File Picker */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
              Source Map File (.map)
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                data-testid="bsp-swapper-source-path"
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
            <div style={{ display: 'flex', gap: '16px', flex: 1, minHeight: 0 }}>
              {/* Left Column: Form & Configuration */}
              <div
                style={{
                  flex: '1 1 540px',
                  maxWidth: '560px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  paddingRight: '6px',
                }}
              >
              {/* Source BSP Selector Card (Single Choice) */}
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--border)',
                  borderRadius: '5px',
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                    Select Source BSP to Import
                  </label>
                </div>

                {/* BSP Radio List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {preflight.sourceBsps.map((bsp: BspInfo) => {
                    const isSelected = selectedSourceBspIndex === bsp.index;
                    return (
                      <label
                        key={bsp.index}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '6px 10px',
                          borderRadius: '4px',
                          background: isSelected ? 'rgba(56, 189, 248, 0.06)' : 'rgba(255, 255, 255, 0.01)',
                          border: `1px solid ${isSelected ? 'rgba(56, 189, 248, 0.25)' : 'var(--border)'}`,
                          cursor: 'pointer',
                          fontSize: '12px',
                        }}
                      >
                        <input
                          type="radio"
                          name="sourceBspSelect"
                          checked={isSelected}
                          onChange={() => handleSourceBspChange(bsp.index)}
                        />
                        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: isSelected ? 600 : 400 }}>
                            BSP {bsp.index}: {bsp.path}
                          </span>
                          <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                            {bsp.vertexCount.toLocaleString()} verts, {bsp.triangleCount.toLocaleString()} tris, {formatBytes(bsp.bspSize)}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
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
                  gridTemplateColumns: 'repeat(4, 1fr)',
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
                  <div style={{ color: 'var(--text-dim)', fontSize: '10.5px' }}>Submeshes</div>
                  <div style={{ fontWeight: 600, marginTop: '2px' }}>
                    {preflight.selectedSourceBsp?.submeshCount ?? 0} submeshes
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '10.5px' }}>
                    {preflight.selectedSourceBsp?.hasDobc ? 'DOBC present' : 'Clean DOBC'}
                  </div>
                </div>

                <div>
                  <div style={{ color: 'var(--text-dim)', fontSize: '10.5px' }}>Size Delta</div>
                  <div
                    style={{
                      fontWeight: 600,
                      marginTop: '2px',
                      color: preflight.sizeDelta > 0 ? 'var(--accent-cyan)' : 'var(--text-primary)',
                    }}
                  >
                    {preflight.sizeDelta >= 0 ? '+' : ''}
                    {formatBytes(preflight.sizeDelta)}
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '10.5px' }}>
                    vs current target BSP ({formatBytes(preflight.selectedTargetBsp?.bspSize ?? 0)})
                  </div>
                </div>

                <div>
                  <div style={{ color: 'var(--text-dim)', fontSize: '10.5px' }}>Estimated Target Size</div>
                  <div style={{ fontWeight: 600, marginTop: '2px' }}>
                    {formatBytes(preflight.estimatedNewSize)}
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '10.5px' }}>Safe limit: ~23 MB</div>
                </div>
              </div>

              {/* Donor Format & Resource Routing Card */}
              {preflight.sourceEdition && (
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--border)',
                    borderRadius: '5px',
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    fontSize: '11.5px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: 'var(--text-dim)' }}>Donor Format:</span>
                      <strong style={{ color: 'var(--accent-cyan, #38bdf8)' }}>
                        {preflight.sourceEditionName || preflight.sourceEdition}
                      </strong>
                    </div>
                  </div>

                  {preflight.sourceBitmapsPath && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span style={{ color: 'var(--text-dim)' }}>Bitmaps: </span>
                        <code style={{ fontSize: '10.5px', color: 'var(--text-secondary)' }}>
                          {customBitmapsPath || preflight.sourceBitmapsPath}
                        </code>
                      </div>
                      <button
                        type="button"
                        onClick={handlePickBitmaps}
                        style={{
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid var(--border)',
                          borderRadius: '3px',
                          padding: '2px 8px',
                          fontSize: '11px',
                          cursor: 'pointer',
                          color: 'var(--text-secondary)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Change...
                      </button>
                    </div>
                  )}

                  {preflight.sourceSoundsPath && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span style={{ color: 'var(--text-dim)' }}>Sounds: </span>
                        <code style={{ fontSize: '10.5px', color: 'var(--text-secondary)' }}>
                          {customSoundsPath || preflight.sourceSoundsPath}
                        </code>
                      </div>
                      <button
                        type="button"
                        onClick={handlePickSounds}
                        style={{
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid var(--border)',
                          borderRadius: '3px',
                          padding: '2px 8px',
                          fontSize: '11px',
                          cursor: 'pointer',
                          color: 'var(--text-secondary)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Change...
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Options Section */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                  Options & Customization
                </label>

                {/* Scenario Name */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Map / Scenario Display Name:
                  </label>
                  <input
                    data-testid="bsp-swapper-scenario-name-input"
                    type="text"
                    maxLength={31}
                    placeholder="Leave blank to preserve current scenario name"
                    value={newScenarioName}
                    onChange={(e) => setNewScenarioName(e.target.value)}
                    style={{
                      background: 'var(--bg-main)',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                      padding: '6px 10px',
                      fontSize: '12px',
                      color: 'var(--text-primary)',
                      outline: 'none',
                    }}
                  />
                </div>

                {/* Detail Objects (DOBC) Stripping */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      data-testid="bsp-swapper-strip-dobc-checkbox"
                      type="checkbox"
                      checked={stripDobc}
                      onChange={(e) => setStripDobc(e.target.checked)}
                    />
                    <label style={{ fontSize: '12px', cursor: 'pointer' }} onClick={() => setStripDobc(!stripDobc)}>
                      <strong>Strip Detail Objects (DOBC)</strong> (Grass, pebbles - recommended for multiplayer performance)
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowDobcInfo(!showDobcInfo)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--accent-cyan, #38bdf8)',
                        cursor: 'pointer',
                        fontSize: '11px',
                        padding: '0 4px',
                      }}
                    >
                      {showDobcInfo ? '▲ Hide Info' : '▼ What is this?'}
                    </button>
                  </div>
                  {showDobcInfo && (
                    <div
                      style={{
                        marginTop: '4px',
                        marginLeft: '24px',
                        fontSize: '11px',
                        color: 'var(--text-dim)',
                        lineHeight: 1.4,
                      }}
                    >
                      Detail Objects (DOBC) represent instanced grass clumps, pebbles, and moss generated by shaders.
                      In Custom Edition multiplayer, DOBC from campaign maps can exceed the engine render limits or cause visual pop-in.
                    </div>
                  )}
                </div>

                {/* Runtime Decals Stripping */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      data-testid="bsp-swapper-strip-decals-checkbox"
                      type="checkbox"
                      checked={stripDecals}
                      onChange={(e) => setStripDecals(e.target.checked)}
                    />
                    <label style={{ fontSize: '12px', cursor: 'pointer' }} onClick={() => setStripDecals(!stripDecals)}>
                      <strong>Strip Runtime Decals</strong> (Pre-baked stains, bullet marks, blood - eliminates decal limits)
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowDecalsInfo(!showDecalsInfo)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--accent-cyan, #38bdf8)',
                        cursor: 'pointer',
                        fontSize: '11px',
                        padding: '0 4px',
                      }}
                    >
                      {showDecalsInfo ? '▲ Hide Info' : '▼ What is this?'}
                    </button>
                  </div>
                  {showDecalsInfo && (
                    <div
                      style={{
                        marginTop: '4px',
                        marginLeft: '24px',
                        fontSize: '11px',
                        color: 'var(--text-dim)',
                        lineHeight: 1.4,
                      }}
                    >
                      Runtime decals are static pre-baked decals embedded into the campaign BSP.
                      Stripping them frees up decal buffer slots for multiplayer projectile and explosion decals.
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

                {/* Import Scenery (Separate Toggle) */}
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
                    data-testid="bsp-swapper-import-scenery-checkbox"
                    type="checkbox"
                    checked={importScenery}
                    onChange={(e) => setImportScenery(e.target.checked)}
                  />
                  <span>
                    <strong>Import Scenery</strong> (Imports props, rocks, trees, and scenery objects)
                  </span>
                </label>

                {/* Import Doors & Bridges (Separate Toggle) */}
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
                    data-testid="bsp-swapper-import-doors-checkbox"
                    type="checkbox"
                    checked={importMachines}
                    onChange={(e) => setImportMachines(e.target.checked)}
                  />
                  <span>
                    <strong>Import Doors & Bridges</strong> (Imports doors, airlocks, shutters, and bridges)
                  </span>
                </label>

                {importMachines && (
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '12px',
                      marginLeft: '20px',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      data-testid="bsp-swapper-doors-automatic-checkbox"
                      type="checkbox"
                      checked={makeDoorsAutomatic}
                      onChange={(e) => setMakeDoorsAutomatic(e.target.checked)}
                    />
                    <span>
                      <strong>Make Doors Automatic (Working Doors)</strong> (Enables auto-opening in multiplayer without campaign scripts)
                    </span>
                  </label>
                )}

                {(importScenery || importMachines || importVehicles) && (
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '12px',
                      marginLeft: '20px',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      data-testid="bsp-swapper-filter-bounds-checkbox"
                      type="checkbox"
                      checked={filterObjectsToBspBounds}
                      onChange={(e) => setFilterObjectsToBspBounds(e.target.checked)}
                    />
                    <span>
                      <strong>Filter to Swapped BSP Bounds</strong> (Excludes donor mission props/doors/vehicles outside this BSP)
                    </span>
                  </label>
                )}

                {/* Import Vehicles */}
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
                    data-testid="bsp-swapper-import-vehicles-checkbox"
                    type="checkbox"
                    checked={importVehicles}
                    onChange={(e) => setImportVehicles(e.target.checked)}
                  />
                  <span>
                    <strong>Import Vehicles</strong> (Imports vehicles placed in the swapped BSP)
                  </span>
                </label>

                {/* Clear Old Map Placements */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    color: clearExistingPlacements ? '#f87171' : 'inherit',
                  }}
                >
                  <input
                    data-testid="bsp-swapper-clear-existing-checkbox"
                    type="checkbox"
                    checked={clearExistingPlacements}
                    onChange={(e) => setClearExistingPlacements(e.target.checked)}
                  />
                  <span>
                    <strong>Clear Old Map Placements</strong> (Removes existing map scenery, vehicles, weapons & equipment)
                  </span>
                </label>

                {/* Clear Old Map Spawns */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    color: clearPlayerSpawns ? '#f87171' : 'inherit',
                  }}
                >
                  <input
                    data-testid="bsp-swapper-clear-player-spawns-checkbox"
                    type="checkbox"
                    checked={clearPlayerSpawns}
                    onChange={(e) => setClearPlayerSpawns(e.target.checked)}
                  />
                  <span>
                    <strong>Clear Old Map Spawns</strong> (Removes existing player spawn points and starting locations)
                  </span>
                </label>

                {/* External Blender / 3D Pipeline: Export Open Map BSP(s) as Separate .OBJ+.MTL or .GLB Files */}
                <div
                  style={{
                    marginTop: '4px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    padding: '10px 12px',
                    borderRadius: '5px',
                    background: 'rgba(34, 197, 94, 0.08)',
                    border: '1px solid rgba(34, 197, 94, 0.35)',
                  }}
                >
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#4ade80', textTransform: 'uppercase' }}>
                    Blender / External 3D BSP Export Pipeline (.OBJ + .MTL / .GLB)
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                    Export the open map&apos;s Structure BSP(s) as separate 3D files with all shader material groups (<code>usemtl mat_shader_...</code>) intact for editing/combining in Blender.
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      disabled={isExportingBsp}
                      onClick={async () => {
                        if (!window.opence.pickExport3dPath || !window.opence.exportBsp3d) return;
                        setIsExportingBsp(true);
                        setError(null);
                        try {
                          const targetBsps = preflight?.targetBsps ?? [];
                          const indicesToExport = targetBsps.length > 0 ? targetBsps.map((b) => b.index) : [selectedTargetBspIndex];
                          let exportedCount = 0;
                          for (const bIdx of indicesToExport) {
                            const bName = (targetBsps[bIdx]?.path || `bsp_${bIdx}`).split('\\').pop() || `bsp_${bIdx}`;
                            const pick = await window.opence.pickExport3dPath(`${bName}.obj`, 'obj');
                            if (!pick || !pick.path) break;
                            const exp = await window.opence.exportBsp3d(bIdx, 'obj', pick.path);
                            if (exp.ok) {
                              exportedCount++;
                            } else {
                              setError(exp.message || 'Failed to export BSP to .OBJ.');
                            }
                          }
                          if (exportedCount > 0) {
                            setSuccessSummary(`Exported ${exportedCount} BSP(s) to Wavefront .OBJ + .MTL (with shader materials intact) for Blender!`);
                          }
                        } catch (err) {
                          setError(err instanceof Error ? err.message : String(err));
                        } finally {
                          setIsExportingBsp(false);
                        }
                      }}
                      style={{
                        padding: '5px 10px',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        borderRadius: '4px',
                        background: '#14532d',
                        color: '#ecfdf5',
                        border: '1px solid #22c55e',
                        cursor: isExportingBsp ? 'wait' : 'pointer',
                      }}
                    >
                      📤 Export Open Map BSP(s) to Blender (.OBJ + .MTL)
                    </button>
                    <button
                      type="button"
                      disabled={isExportingBsp}
                      onClick={async () => {
                        if (!window.opence.pickExport3dPath || !window.opence.exportBsp3d) return;
                        setIsExportingBsp(true);
                        setError(null);
                        try {
                          const targetBsps = preflight?.targetBsps ?? [];
                          const indicesToExport = targetBsps.length > 0 ? targetBsps.map((b) => b.index) : [selectedTargetBspIndex];
                          let exportedCount = 0;
                          for (const bIdx of indicesToExport) {
                            const bName = (targetBsps[bIdx]?.path || `bsp_${bIdx}`).split('\\').pop() || `bsp_${bIdx}`;
                            const pick = await window.opence.pickExport3dPath(`${bName}.glb`, 'glb');
                            if (!pick || !pick.path) break;
                            const exp = await window.opence.exportBsp3d(bIdx, 'glb', pick.path);
                            if (exp.ok) {
                              exportedCount++;
                            } else {
                              setError(exp.message || 'Failed to export BSP to .GLB.');
                            }
                          }
                          if (exportedCount > 0) {
                            setSuccessSummary(`Exported ${exportedCount} BSP(s) to glTF 2.0 (.GLB) for Blender!`);
                          }
                        } catch (err) {
                          setError(err instanceof Error ? err.message : String(err));
                        } finally {
                          setIsExportingBsp(false);
                        }
                      }}
                      style={{
                        padding: '5px 10px',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        borderRadius: '4px',
                        background: '#1e3a5f',
                        color: '#bae6fd',
                        border: '1px solid #38bdf8',
                        cursor: isExportingBsp ? 'wait' : 'pointer',
                      }}
                    >
                      📤 Export Open Map BSP(s) to Blender (.GLB)
                    </button>
                  </div>
                </div>
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

              {/* Error display inside left column */}
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

              {/* Success summary display inside left column */}
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

              {/* Right Column: 3D Interactive Viewport Preview */}
              <div
                style={{
                  flex: '1 1 540px',
                  minWidth: '440px',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                }}
              >
                {sourcePath ? (
                  <BspPreviewViewport
                    sourceFilePath={sourcePath}
                    selectedBspIndices={[selectedSourceBspIndex]}
                    bspNames={bspNamesMap}
                    height="100%"
                  />
                ) : (
                  <div
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'rgba(0, 0, 0, 0.25)',
                      border: '1px dashed var(--border)',
                      borderRadius: '6px',
                      color: 'var(--text-dim)',
                      fontSize: '12px',
                    }}
                  >
                    <span>No BSP selected for preview</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error display when no preflight */}
          {!preflight && error && (
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
