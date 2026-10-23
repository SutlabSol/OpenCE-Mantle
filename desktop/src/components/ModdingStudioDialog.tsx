import { useMemo, useState } from 'react';
import type { TagEntrySummary } from '../../electron/shared-types';
import { NULL_TAG_ID } from '../../../core/src/constants/tag-classes';
import {
  convertJmsToObjText,
  exportTagToXml,
  generateOpenCeModToml,
} from '../../../core/src/map/mod-packager';

interface Props {
  allTags: TagEntrySummary[];
  initialTab?: 'converter' | 'scanner' | 'packager';
  onClose: () => void;
  onTagsUpdated?: (tags: TagEntrySummary[]) => void;
}

const OBJECT_SUBCLASSES = [
  'scenery',
  'vehicle',
  'weapon',
  'equipment',
  'biped',
  'garbage',
  'projectile',
  'device_machine',
  'device_control',
  'device_light_fixture',
  'sound_scenery',
];

export default function ModdingStudioDialog({
  allTags,
  initialTab = 'converter',
  onClose,
  onTagsUpdated,
}: Props) {
  const [tab, setTab] = useState<'converter' | 'scanner' | 'packager'>(initialTab);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);

  // --- Tab 1: Universal Converter State ---
  const collTags = useMemo(
    () => allTags.filter((t) => t.primaryClassName === 'model_collision_geometry'),
    [allTags],
  );
  const bspTags = useMemo(
    () => allTags.filter((t) => t.primaryClassName === 'scenario_structure_bsp'),
    [allTags],
  );
  const objectTags = useMemo(
    () => allTags.filter((t) => OBJECT_SUBCLASSES.includes(t.primaryClassName)),
    [allTags],
  );

  const [selectedCollIdx, setSelectedCollIdx] = useState<number>(() => collTags[0]?.index ?? -1);
  const [collTargetPath, setCollTargetPath] = useState<string>('');
  const [selectedBspIdx, setSelectedBspIdx] = useState<number>(0);
  const [bspTargetPath, setBspTargetPath] = useState<string>('');
  const [selectedObjIdx, setSelectedObjIdx] = useState<number>(() => objectTags[0]?.index ?? -1);
  const [targetObjClass, setTargetObjClass] = useState<string>('scenery');
  const [objTargetPath, setObjTargetPath] = useState<string>('');
  const [jmsInput, setJmsInput] = useState<string>('');
  const [jmsConvertedObj, setJmsConvertedObj] = useState<string>('');

  // --- Tab 2: Error Scanner & Global Search/Replace State ---
  const [scanReport, setScanReport] = useState<{
    totalTagsScanned: number;
    errorCount: number;
    warningCount: number;
    findings: Array<{
      tagIndex: number;
      tagId: number;
      tagPath: string;
      tagGroup: string;
      fieldPath: string;
      severity: 'error' | 'warning';
      message: string;
    }>;
  } | null>(null);
  const [replaceFromTagId, setReplaceFromTagId] = useState<number>(() => allTags[0]?.tagId ?? NULL_TAG_ID);
  const [replaceToTagId, setReplaceToTagId] = useState<number>(() => allTags[1]?.tagId ?? NULL_TAG_ID);

  // --- Tab 3: OpenCE Forge Package (.ocetags), Mod Packager & XML Exporter State ---
  const [forgeTagIndex, setForgeTagIndex] = useState<number>(() => objectTags[0]?.index ?? allTags[0]?.index ?? 0);
  const [forgeItemName, setForgeItemName] = useState<string>('Custom OpenCE Item');
  const [modId, setModId] = useState<string>('custom_halo_mod');
  const [modName, setModName] = useState<string>('Custom OpenCE Mod');
  const [modVersion, setModVersion] = useState<string>('1.0.0');
  const [modAuthor, setModAuthor] = useState<string>('OpenCE Modder');
  const [modDesc, setModDesc] = useState<string>('Built with OpenCE Mantle.');
  const [xmlTagIndex, setXmlTagIndex] = useState<number>(() => allTags[0]?.index ?? 0);

  const handleConvertCollToGbx = async () => {
    if (!window.opence.convertCollisionToGbxmodel || selectedCollIdx < 0) return;
    setIsBusy(true);
    setStatusMessage(null);
    const res = await window.opence.convertCollisionToGbxmodel(selectedCollIdx, collTargetPath || undefined);
    setIsBusy(false);
    if (res.ok) {
      setStatusMessage(res.summary);
      onTagsUpdated?.(res.tags);
    } else {
      setStatusMessage(`Failed: ${res.message}`);
    }
  };

  const handleConvertBspToScenery = async () => {
    if (!window.opence.convertSbspToScenery) return;
    setIsBusy(true);
    setStatusMessage(null);
    const res = await window.opence.convertSbspToScenery(selectedBspIdx, bspTargetPath || undefined);
    setIsBusy(false);
    if (res.ok) {
      setStatusMessage(res.summary);
      onTagsUpdated?.(res.tags);
    } else {
      setStatusMessage(`Failed: ${res.message}`);
    }
  };

  const handleConvertObjectClass = async () => {
    if (!window.opence.convertObjectTagClass || selectedObjIdx < 0) return;
    setIsBusy(true);
    setStatusMessage(null);
    const res = await window.opence.convertObjectTagClass(
      selectedObjIdx,
      targetObjClass,
      objTargetPath || undefined,
    );
    setIsBusy(false);
    if (res.ok) {
      setStatusMessage(res.summary);
      onTagsUpdated?.(res.tags);
    } else {
      setStatusMessage(`Failed: ${res.message}`);
    }
  };

  const handleConvertJms = () => {
    try {
      const res = convertJmsToObjText(jmsInput);
      setJmsConvertedObj(res.objText);
      setStatusMessage(
        `Converted .JMS (${res.vertexCount} vertices, ${res.triangleCount} triangles, ${res.nodeCount} nodes, ${res.markerCount} markers) to Wavefront .OBJ!`,
      );
    } catch (err) {
      setStatusMessage(`Failed to parse .JMS: ${(err as Error).message}`);
    }
  };

  const handleRunErrorScan = async () => {
    if (!window.opence.scanMapTagErrors) return;
    setIsBusy(true);
    setStatusMessage(null);
    const res = await window.opence.scanMapTagErrors();
    setIsBusy(false);
    if (res.ok) {
      setScanReport(res);
      setStatusMessage(
        `Scanned ${res.totalTagsScanned} tags: ${res.errorCount} error(s), ${res.warningCount} warning(s).`,
      );
    } else {
      setStatusMessage(`Failed to scan tags: ${res.message}`);
    }
  };

  const handleGlobalReplace = async () => {
    if (!window.opence.globalReplaceTagReference) return;
    setIsBusy(true);
    setStatusMessage(null);
    const res = await window.opence.globalReplaceTagReference(replaceFromTagId, replaceToTagId);
    setIsBusy(false);
    if (res.ok) {
      setStatusMessage(
        `Replaced ${res.replacedCount} dependency reference(s) across the map in-memory! Press Ctrl+S to save.`,
      );
    } else {
      setStatusMessage(`Failed to replace tag references: ${res.message}`);
    }
  };

  const handleCleanYelo = async () => {
    if (!window.opence.cleanOpenSauceYelo) return;
    setIsBusy(true);
    setStatusMessage(null);
    const res = await window.opence.cleanOpenSauceYelo();
    setIsBusy(false);
    if (res.ok) {
      setStatusMessage(res.details.join(' '));
    } else {
      setStatusMessage(`Failed to clean .yelo references: ${res.message}`);
    }
  };

  const handleDownloadModToml = () => {
    const scnr = allTags.find((t) => t.primaryClassName === 'scenario');
    const toml = generateOpenCeModToml({
      modId,
      name: modName,
      version: modVersion,
      author: modAuthor,
      description: modDesc,
      entryScenario: scnr?.path ?? 'levels\\test\\bloodgulch\\bloodgulch',
    });
    const blob = new Blob([toml], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mod.toml';
    a.click();
    URL.revokeObjectURL(url);
    setStatusMessage('Downloaded mod.toml manifest.');
  };

  const handleExportXml = async () => {
    const entry = allTags.find((t) => t.index === xmlTagIndex);
    if (!entry) return;
    setIsBusy(true);
    const res = await window.opence.getTagFields(entry.index);
    setIsBusy(false);
    if (!res.ok) {
      setStatusMessage(`Failed to read tag fields for XML export: ${res.message}`);
      return;
    }
    const xml = exportTagToXml(entry.path, entry.primaryClassName, res.data.fields);
    const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${entry.path.split('\\').pop() || 'tag'}.${entry.primaryClassName}.xml`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMessage(`Exported "${entry.path}" (${entry.primaryClassName}) to XML.`);
  };

  const handleExportForgeOceTags = async () => {
    const entry = allTags.find((t) => t.index === forgeTagIndex);
    if (!entry) return;
    setIsBusy(true);
    setStatusMessage(null);
    const leafName = entry.path.split('\\').pop() || 'custom_item';
    const res = await window.opence.extractTags({
      originalIndices: [entry.index],
      suggestedFileName: leafName,
      itemName: forgeItemName.trim() || leafName,
      captureGbxmodelRawData: true,
    });
    setIsBusy(false);
    if (res.ok) {
      setStatusMessage(
        `Exported OpenCE Forge Package "${res.outputPath}" (${res.tagCount} bundled tags including embedded bitmaps, sounds, and 3D model vertices/strips).`,
      );
    } else if (res.code !== 'CANCELLED') {
      setStatusMessage(`Failed to export .ocetags package: ${res.message}`);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="modding-studio-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 160,
      }}
    >
      <div
        style={{
          width: '90vw',
          maxWidth: 1120,
          height: '86vh',
          background: 'var(--bg-panel)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          boxShadow: '0 14px 48px rgba(0,0,0,0.65)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            background: 'var(--bg-panel-header)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent-cyan)' }}>
            Universal Tag Class Converter, Map Scanner & OpenCE Mod Studio
          </span>
          <button
            data-testid="modding-studio-close"
            onClick={onClose}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-dim)',
              borderRadius: 3,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>

        {/* Tab Strip */}
        <div
          style={{
            display: 'flex',
            background: 'var(--bg-panel-header)',
            borderBottom: '1px solid var(--border)',
            padding: '0 14px',
            gap: 6,
          }}
        >
          <button
            data-testid="studio-tab-converter"
            onClick={() => setTab('converter')}
            style={{
              padding: '8px 14px',
              background: tab === 'converter' ? 'var(--bg-panel)' : 'transparent',
              border: 'none',
              borderBottom: tab === 'converter' ? '2px solid var(--accent-cyan)' : '2px solid transparent',
              color: tab === 'converter' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            1. Universal Tag Class Converter & .JMS Compiler
          </button>
          <button
            data-testid="studio-tab-scanner"
            onClick={() => setTab('scanner')}
            style={{
              padding: '8px 14px',
              background: tab === 'scanner' ? 'var(--bg-panel)' : 'transparent',
              border: 'none',
              borderBottom: tab === 'scanner' ? '2px solid var(--accent-cyan)' : '2px solid transparent',
              color: tab === 'scanner' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            2. Map Error Scanner, Global Search/Replace & .Yelo Cleaner
          </button>
          <button
            data-testid="studio-tab-packager"
            onClick={() => setTab('packager')}
            style={{
              padding: '8px 14px',
              background: tab === 'packager' ? 'var(--bg-panel)' : 'transparent',
              border: 'none',
              borderBottom: tab === 'packager' ? '2px solid var(--accent-cyan)' : '2px solid transparent',
              color: tab === 'packager' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            3. OpenCE Forge Package (.ocetags), Mod Manifest & XML Exporter
          </button>
        </div>

        {statusMessage && (
          <div
            data-testid="studio-status-banner"
            style={{
              padding: '7px 14px',
              fontSize: 11.5,
              background: statusMessage.startsWith('Failed') ? 'rgba(239,68,68,0.16)' : 'rgba(34,197,94,0.15)',
              color: statusMessage.startsWith('Failed') ? '#f87171' : '#4ade80',
              borderBottom: '1px solid var(--border)',
            }}
          >
            {statusMessage}
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {tab === 'converter' && (
            <>
              {/* Card 1: Collision Model (coll) -> Visible GBXModel (mod2) */}
              <div style={{ padding: 14, background: 'var(--bg-panel-header)', border: '1px solid var(--border)', borderRadius: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: 4 }}>
                  Collision Model (coll) → Visible GBXModel (mod2) & Scenery
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>
                  Extracts all 3D collision BSP surfaces and edges from any `model_collision_geometry` tag and compiles a visible `gbxmodel` + `scenery` tag so you can view or place collision hitboxes in-game.
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    data-testid="convert-coll-select"
                    value={selectedCollIdx}
                    onChange={(e) => setSelectedCollIdx(Number(e.target.value))}
                    style={{ flex: 1, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  >
                    {collTags.map((t) => (
                      <option key={t.index} value={t.index}>
                        [coll] {t.path}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Optional output tag path..."
                    value={collTargetPath}
                    onChange={(e) => setCollTargetPath(e.target.value)}
                    style={{ width: 260, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  />
                  <button
                    data-testid="convert-coll-btn"
                    onClick={handleConvertCollToGbx}
                    disabled={isBusy || selectedCollIdx < 0}
                    style={{ padding: '6px 12px', background: 'rgba(56,189,248,0.18)', border: '1px solid rgba(56,189,248,0.45)', color: '#38bdf8', fontWeight: 600, fontSize: 11.5, borderRadius: 3, cursor: 'pointer' }}
                  >
                    Convert Coll → GBXModel
                  </button>
                </div>
              </div>

              {/* Card 2: BSP (sbsp) -> GBXModel & Scenery */}
              <div style={{ padding: 14, background: 'var(--bg-panel-header)', border: '1px solid var(--border)', borderRadius: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: 4 }}>
                  Structure BSP (sbsp) → GBXModel (mod2) & Placeable Scenery (scen)
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>
                  Converts the level's `scenario_structure_bsp` geometry into a standalone `gbxmodel` + `scenery` tag in-memory.
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    data-testid="convert-bsp-select"
                    value={selectedBspIdx}
                    onChange={(e) => setSelectedBspIdx(Number(e.target.value))}
                    style={{ flex: 1, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  >
                    {bspTags.map((t, idx) => (
                      <option key={t.index} value={idx}>
                        [sbsp #{idx}] {t.path}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Optional output tag path..."
                    value={bspTargetPath}
                    onChange={(e) => setBspTargetPath(e.target.value)}
                    style={{ width: 260, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  />
                  <button
                    data-testid="convert-bsp-btn"
                    onClick={handleConvertBspToScenery}
                    disabled={isBusy}
                    style={{ padding: '6px 12px', background: 'rgba(34,197,94,0.18)', border: '1px solid rgba(34,197,94,0.45)', color: '#4ade80', fontWeight: 600, fontSize: 11.5, borderRadius: 3, cursor: 'pointer' }}
                  >
                    Convert BSP → Scenery
                  </button>
                </div>
              </div>

              {/* Card 3: 11-Class Object <-> Object Converter */}
              <div style={{ padding: 14, background: 'var(--bg-panel-header)', border: '1px solid var(--border)', borderRadius: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: 4 }}>
                  11-Class Object ↔ Object Converter (bipd, vehi, weap, eqip, garb, proj, scen, mach, ctrl, lifi, ssce)
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>
                  Converts any object tag into another object class while preserving the shared 380-byte base Object properties (`model`, `collision model`, `animation graph`, `physics`, `bounding radius`, `attachments`, `widgets`, `functions`).
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    data-testid="convert-obj-source-select"
                    value={selectedObjIdx}
                    onChange={(e) => setSelectedObjIdx(Number(e.target.value))}
                    style={{ flex: 1, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  >
                    {objectTags.map((t) => (
                      <option key={t.index} value={t.index}>
                        [{t.primaryClassName}] {t.path}
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>→</span>
                  <select
                    data-testid="convert-obj-target-class"
                    value={targetObjClass}
                    onChange={(e) => setTargetObjClass(e.target.value)}
                    style={{ width: 160, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  >
                    {OBJECT_SUBCLASSES.map((cls) => (
                      <option key={cls} value={cls}>
                        {cls}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Optional output tag path..."
                    value={objTargetPath}
                    onChange={(e) => setObjTargetPath(e.target.value)}
                    style={{ width: 220, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  />
                  <button
                    data-testid="convert-obj-btn"
                    onClick={handleConvertObjectClass}
                    disabled={isBusy || selectedObjIdx < 0}
                    style={{ padding: '6px 12px', background: 'rgba(168,85,247,0.18)', border: '1px solid rgba(168,85,247,0.45)', color: '#c084fc', fontWeight: 600, fontSize: 11.5, borderRadius: 3, cursor: 'pointer' }}
                  >
                    Convert Object Class
                  </button>
                </div>
              </div>

              {/* Card 4: Native .JMS to .OBJ Source Transpiler */}
              <div style={{ padding: 14, background: 'var(--bg-panel-header)', border: '1px solid var(--border)', borderRadius: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: 4 }}>
                  Halo CE .JMS Model/Physics Source Converter (.jms → .obj)
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <textarea
                    placeholder="Paste Halo CE .JMS (version 8200) ASCII content here..."
                    value={jmsInput}
                    onChange={(e) => setJmsInput(e.target.value)}
                    style={{ flex: 1, height: 90, background: '#0d1117', color: '#e6edf3', border: '1px solid var(--border)', padding: 8, fontFamily: 'var(--mono-font)', fontSize: 11 }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
                    <button
                      onClick={handleConvertJms}
                      style={{ padding: '6px 12px', background: 'rgba(56,189,248,0.18)', border: '1px solid rgba(56,189,248,0.45)', color: '#38bdf8', fontWeight: 600, fontSize: 11, borderRadius: 3, cursor: 'pointer' }}
                    >
                      Convert .JMS → .OBJ
                    </button>
                  </div>
                  <textarea
                    readOnly
                    placeholder="Converted Wavefront .OBJ output..."
                    value={jmsConvertedObj}
                    style={{ flex: 1, height: 90, background: '#0d1117', color: '#86efac', border: '1px solid var(--border)', padding: 8, fontFamily: 'var(--mono-font)', fontSize: 11 }}
                  />
                </div>
              </div>
            </>
          )}

          {tab === 'scanner' && (
            <>
              {/* Whole-Map Tag Error Scanner */}
              <div style={{ padding: 14, background: 'var(--bg-panel-header)', border: '1px solid var(--border)', borderRadius: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)' }}>
                      Whole-Map Tag Error & Pointer Integrity Scanner
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                      Audits every tag in the map for broken TagDependency IDs, out-of-bounds reflexive pointers, and invalid bounding radii.
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      data-testid="clean-yelo-btn"
                      onClick={handleCleanYelo}
                      disabled={isBusy}
                      style={{ padding: '6px 12px', background: 'rgba(251,191,36,0.18)', border: '1px solid rgba(251,191,36,0.45)', color: '#fbbf24', fontWeight: 600, fontSize: 11.5, borderRadius: 3, cursor: 'pointer' }}
                    >
                      Clean OpenSauce (.yelo) References
                    </button>
                    <button
                      data-testid="run-error-scan-btn"
                      onClick={handleRunErrorScan}
                      disabled={isBusy}
                      style={{ padding: '6px 14px', background: 'rgba(34,197,94,0.2)', border: '1px solid rgba(34,197,94,0.5)', color: '#4ade80', fontWeight: 700, fontSize: 11.5, borderRadius: 3, cursor: 'pointer' }}
                    >
                      Scan All Tags Now
                    </button>
                  </div>
                </div>

                {scanReport && (
                  <div
                    data-testid="error-scan-results"
                    style={{
                      maxHeight: 220,
                      overflowY: 'auto',
                      background: 'rgba(0,0,0,0.25)',
                      border: '1px solid var(--border)',
                      borderRadius: 3,
                      padding: 10,
                      fontSize: 11,
                      fontFamily: 'var(--mono-font)',
                    }}
                  >
                    {scanReport.findings.length === 0 ? (
                      <div style={{ color: '#4ade80' }}>
                        ✓ All {scanReport.totalTagsScanned} tags passed pointer and dependency verification with 0 errors!
                      </div>
                    ) : (
                      scanReport.findings.map((f, i) => (
                        <div key={i} style={{ color: f.severity === 'error' ? '#f87171' : '#fbbf24', marginBottom: 4 }}>
                          [{f.severity.toUpperCase()}] #{f.tagIndex} [{f.tagGroup}] {f.tagPath} ({f.fieldPath}): {f.message}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Global Tag Reference Search & Replace */}
              <div style={{ padding: 14, background: 'var(--bg-panel-header)', border: '1px solid var(--border)', borderRadius: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: 4 }}>
                  Global Tag Dependency Search & Replace Across Entire Map
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>
                  Finds every reference to a tag across all tags in the map and swaps it to another tag (or Null) in a single atomic pass.
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    data-testid="global-replace-from"
                    value={replaceFromTagId}
                    onChange={(e) => setReplaceFromTagId(Number(e.target.value))}
                    style={{ flex: 1, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  >
                    {allTags.map((t) => (
                      <option key={t.tagId} value={t.tagId}>
                        Find: [{t.primaryClassName}] {t.path}
                      </option>
                    ))}
                  </select>
                  <span style={{ color: 'var(--text-dim)' }}>→</span>
                  <select
                    data-testid="global-replace-to"
                    value={replaceToTagId}
                    onChange={(e) => setReplaceToTagId(Number(e.target.value))}
                    style={{ flex: 1, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  >
                    <option value={NULL_TAG_ID}>Replace With: (None / Null)</option>
                    {allTags.map((t) => (
                      <option key={t.tagId} value={t.tagId}>
                        Replace With: [{t.primaryClassName}] {t.path}
                      </option>
                    ))}
                  </select>
                  <button
                    data-testid="global-replace-btn"
                    onClick={handleGlobalReplace}
                    disabled={isBusy}
                    style={{ padding: '6px 14px', background: 'rgba(56,189,248,0.18)', border: '1px solid rgba(56,189,248,0.45)', color: '#38bdf8', fontWeight: 700, fontSize: 11.5, borderRadius: 3, cursor: 'pointer' }}
                  >
                    Replace All References
                  </button>
                </div>
              </div>
            </>
          )}

          {tab === 'packager' && (
            <>
              {/* Card 1: OpenCE Forge Package (.ocetags) Exporter */}
              <div style={{ padding: 14, background: 'var(--bg-panel-header)', border: '1px solid var(--border)', borderRadius: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: 4 }}>
                  OpenCE Forge & Mantle Package Exporter (`.ocetags`)
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>
                  Bundles any customized weapon, vehicle, biped, scenery, equipment, or skin tag together with all of its recursive dependencies, custom bitmap pixels, sounds, and 3D `gbxmodel` vertex/triangle-strip buffers into a self-contained `.ocetags` package ready for OpenCE&apos;s `assets/custom_items` folder or Mantle&apos;s `Inject Tags...`.
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    data-testid="export-forge-ocetags-select"
                    value={forgeTagIndex}
                    onChange={(e) => {
                      const idx = Number(e.target.value);
                      setForgeTagIndex(idx);
                      const found = allTags.find((t) => t.index === idx);
                      if (found) {
                        const leaf = found.path.split('\\').pop() || 'Custom Item';
                        setForgeItemName(leaf.replace(/[_-]+/g, ' '));
                      }
                    }}
                    style={{ flex: 1, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  >
                    {allTags.map((t) => (
                      <option key={t.index} value={t.index}>
                        [{t.primaryClassName}] {t.path}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Forge Display Name (e.g. Custom Gold AR)"
                    value={forgeItemName}
                    onChange={(e) => setForgeItemName(e.target.value)}
                    style={{ width: 240, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  />
                  <button
                    data-testid="export-forge-ocetags-btn"
                    onClick={handleExportForgeOceTags}
                    disabled={isBusy}
                    style={{ padding: '6px 14px', background: 'rgba(56,189,248,0.2)', border: '1px solid rgba(56,189,248,0.5)', color: '#38bdf8', fontWeight: 700, fontSize: 11.5, borderRadius: 3, cursor: 'pointer' }}
                  >
                    Export OpenCE Package (.ocetags)...
                  </button>
                </div>
              </div>

              {/* Card 2: OpenCE Mod Packager (mod.toml & XML Tag Export) */}
              <div style={{ padding: 14, background: 'var(--bg-panel-header)', border: '1px solid var(--border)', borderRadius: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: 8 }}>
                  OpenCE Mod Package Manifest (`mod.toml`) & Git XML Tag Exporter
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                  <input
                    type="text"
                    placeholder="Mod ID"
                    value={modId}
                    onChange={(e) => setModId(e.target.value)}
                    style={{ padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  />
                  <input
                    type="text"
                    placeholder="Mod Display Name"
                    value={modName}
                    onChange={(e) => setModName(e.target.value)}
                    style={{ padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  />
                  <input
                    type="text"
                    placeholder="Version (1.0.0)"
                    value={modVersion}
                    onChange={(e) => setModVersion(e.target.value)}
                    style={{ padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input
                    type="text"
                    placeholder="Author"
                    value={modAuthor}
                    onChange={(e) => setModAuthor(e.target.value)}
                    style={{ width: 200, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  />
                  <input
                    type="text"
                    placeholder="Mod Description"
                    value={modDesc}
                    onChange={(e) => setModDesc(e.target.value)}
                    style={{ flex: 1, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  />
                  <button
                    data-testid="export-mod-toml-btn"
                    onClick={handleDownloadModToml}
                    style={{ padding: '6px 14px', background: 'rgba(34,197,94,0.18)', border: '1px solid rgba(34,197,94,0.45)', color: '#4ade80', fontWeight: 700, fontSize: 11.5, borderRadius: 3, cursor: 'pointer' }}
                  >
                    Export mod.toml
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <select
                    value={xmlTagIndex}
                    onChange={(e) => setXmlTagIndex(Number(e.target.value))}
                    style={{ flex: 1, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  >
                    {allTags.map((t) => (
                      <option key={t.index} value={t.index}>
                        [{t.primaryClassName}] {t.path}
                      </option>
                    ))}
                  </select>
                  <button
                    data-testid="export-tag-xml-btn"
                    onClick={handleExportXml}
                    disabled={isBusy}
                    style={{ padding: '6px 14px', background: 'rgba(168,85,247,0.18)', border: '1px solid rgba(168,85,247,0.45)', color: '#c084fc', fontWeight: 700, fontSize: 11.5, borderRadius: 3, cursor: 'pointer' }}
                  >
                    Export Tag as XML (.xml)
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
