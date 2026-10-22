import { useEffect, useMemo, useState } from 'react';
import type {
  BuildCustomObjectResult,
  CustomObjectTagGroup,
  MapInspectionState,
  TagEntrySummary,
} from '../../electron/shared-types';

interface Props {
  open: boolean;
  onClose: () => void;
  allTags: TagEntrySummary[];
  canInjectIntoOpenMap: boolean;
  onSelectInjectedTag?: (
    tagPath: string,
    group: CustomObjectTagGroup,
    updatedMap?: Extract<MapInspectionState, { status: 'ok' }>,
  ) => void;
}

const TAG_TYPE_OPTIONS: {
  group: CustomObjectTagGroup;
  code: string;
  label: string;
  folderPrefix: string;
  description: string;
}[] = [
  {
    group: 'scenery',
    code: 'scen',
    label: 'Scenery (scen)',
    folderPrefix: 'scenery\\custom',
    description: 'Static props, buildings, boulders, trees, barriers, and decorative world objects.',
  },
  {
    group: 'weapon',
    code: 'weap',
    label: 'Weapon (weap)',
    folderPrefix: 'weapons\\custom',
    description: 'Handheld or mounted weapons. Select a Base Template weapon to inherit firing triggers, HUD, and animations.',
  },
  {
    group: 'vehicle',
    code: 'vehi',
    label: 'Vehicle (vehi)',
    folderPrefix: 'vehicles\\custom',
    description: 'Driveable vehicles. Select a Base Template vehicle to inherit physics, seats, and bone rig.',
  },
  {
    group: 'equipment',
    code: 'eqip',
    label: 'Equipment (eqip)',
    folderPrefix: 'powerups\\custom',
    description: 'Powerups, ammo boxes, health packs, and throwable equipment items.',
  },
];

const HALO_MATERIAL_OPTIONS: { index: number; label: string }[] = [
  { index: 0, label: '0 — dirt' },
  { index: 1, label: '1 — sand' },
  { index: 2, label: '2 — stone' },
  { index: 3, label: '3 — snow' },
  { index: 4, label: '4 — wood' },
  { index: 5, label: '5 — metal hollow' },
  { index: 6, label: '6 — metal thin' },
  { index: 7, label: '7 — metal thick (Default Solid Metal)' },
  { index: 8, label: '8 — rubber' },
  { index: 9, label: '9 — glass' },
  { index: 10, label: '10 — force field' },
  { index: 11, label: '11 — grunt' },
  { index: 12, label: '12 — hunter armor' },
  { index: 13, label: '13 — hunter skin' },
  { index: 14, label: '14 — elite' },
  { index: 15, label: '15 — jackal' },
  { index: 16, label: '16 — jackal energy shield' },
  { index: 17, label: '17 — engineer skin' },
  { index: 18, label: '18 — engineer force field' },
  { index: 19, label: '19 — flood combat form' },
  { index: 20, label: '20 — flood carrier form' },
  { index: 21, label: '21 — cyborg armor' },
  { index: 22, label: '22 — cyborg energy shield' },
  { index: 23, label: '23 — human armor' },
  { index: 24, label: '24 — human skin' },
  { index: 25, label: '25 — sentinel' },
  { index: 26, label: '26 — monitor' },
  { index: 27, label: '27 — plastic' },
  { index: 28, label: '28 — water' },
  { index: 29, label: '29 — leaves' },
  { index: 30, label: '30 — elite energy shield' },
  { index: 31, label: '31 — ice' },
  { index: 32, label: '32 — hunter shield' },
];

function inferMaterialTypeFromSlotName(slotName: string, fallback = 7): number {
  const s = slotName.trim().toLowerCase();
  if (!s) return fallback;
  if (s.includes('glass') || s.includes('windshield') || s.includes('window') || s.includes('visor') || s.includes('canopy')) return 9;
  if (s.includes('rubber') || s.includes('tire') || s.includes('tyre') || s.includes('wheel') || s.includes('tread')) return 8;
  if (s.includes('wood') || s.includes('plank') || s.includes('timber') || s.includes('bark') || s.includes('crate')) return 4;
  if (s.includes('stone') || s.includes('rock') || s.includes('concrete') || s.includes('brick') || s.includes('granite') || s.includes('boulder')) return 2;
  if (s.includes('dirt') || s.includes('mud') || s.includes('soil') || s.includes('earth')) return 0;
  if (s.includes('sand') || s.includes('desert') || s.includes('dune')) return 1;
  if (s.includes('snow') || s.includes('frost')) return 3;
  if (s.includes('ice') || s.includes('glacier')) return 31;
  if (s.includes('water') || s.includes('liquid')) return 28;
  if (s.includes('leaf') || s.includes('leaves') || s.includes('foliage') || s.includes('grass') || s.includes('bush')) return 29;
  if (s.includes('plastic') || s.includes('polymer') || s.includes('vinyl') || s.includes('seat')) return 27;
  if (s.includes('cyborg') && s.includes('shield')) return 22;
  if (s.includes('cyborg')) return 21;
  if (s.includes('force') || s.includes('shield') || s.includes('energy')) return 10;
  if (s.includes('hollow')) return 5;
  if (s.includes('thin') || s.includes('sheet') || s.includes('tin') || s.includes('aluminum')) return 6;
  if (s.includes('metal') || s.includes('steel') || s.includes('iron') || s.includes('titanium') || s.includes('hull') || s.includes('armor') || s.includes('brass')) return 7;
  return fallback;
}

export default function BuildObjectTagDialog({
  open,
  onClose,
  allTags,
  canInjectIntoOpenMap,
  onSelectInjectedTag,
}: Props) {
  const [tagGroup, setTagGroup] = useState<CustomObjectTagGroup>('scenery');
  const [objFilePath, setObjFilePath] = useState<string>('');
  const [collisionObjFilePath, setCollisionObjFilePath] = useState<string>('');
  const [textureFilePath, setTextureFilePath] = useState<string>('');
  const [tagPath, setTagPath] = useState<string>('scenery\\custom\\custom_object\\custom_object');
  const [itemName, setItemName] = useState<string>('Custom Object');
  const [templateTagIndex, setTemplateTagIndex] = useState<number>(-1);

  // Transform & UV options
  const [scale, setScale] = useState<number>(1.0);
  const [flipYz, setFlipYz] = useState<boolean>(false);
  const [centerOrigin, setCenterOrigin] = useState<boolean>(true);
  const [forceAutoUv, setForceAutoUv] = useState<boolean>(false);
  const [multiBoxCollision, setMultiBoxCollision] = useState<boolean>(true);
  const [materialType, setMaterialType] = useState<number>(7); // 7 = metal thick (for Scenery)
  const [slotMaterialTypes, setSlotMaterialTypes] = useState<number[]>([7]);

  // Output options
  const [outputMode, setOutputMode] = useState<'inject' | 'ocetags' | 'both'>(
    canInjectIntoOpenMap ? 'inject' : 'ocetags',
  );

  // Analysis & UV Preview state
  const [meshSummary, setMeshSummary] = useState<any | null>(null);
  const [uvPreviewUrl, setUvPreviewUrl] = useState<string | null>(null);
  const [uvUsedAuto, setUvUsedAuto] = useState<boolean>(false);
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [building, setBuilding] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [buildSuccess, setBuildSuccess] = useState<BuildCustomObjectResult | null>(null);
  const [savedUvPath, setSavedUvPath] = useState<string | null>(null);

  useEffect(() => {
    if (!canInjectIntoOpenMap && outputMode === 'inject') {
      setOutputMode('ocetags');
    }
  }, [canInjectIntoOpenMap, outputMode]);

  // Filter candidate template tags in the open map matching the selected tagGroup
  const templateCandidates = useMemo(() => {
    return allTags.filter((t) => t.primaryClassName === tagGroup && !t.isExternal);
  }, [allTags, tagGroup]);

  // Reset template selection when tagGroup changes
  const handleSelectTagGroup = (nextGroup: CustomObjectTagGroup) => {
    setTagGroup(nextGroup);
    setTemplateTagIndex(-1);
    const opt = TAG_TYPE_OPTIONS.find((o) => o.group === nextGroup)!;
    const leaf =
      objFilePath
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.obj$/i, '')
        .replace(/[^a-z0-9_-]+/gi, '_')
        .toLowerCase() || 'custom_object';
    setTagPath(`${opt.folderPrefix}\\${leaf}\\${leaf}`);
  };

  // Re-analyze OBJ and refresh UV preview whenever OBJ path or transform options change
  useEffect(() => {
    if (!objFilePath) {
      setMeshSummary(null);
      setUvPreviewUrl(null);
      return;
    }
    let cancelled = false;
    setAnalyzing(true);
    setErrorMsg(null);

    const runAnalysis = async () => {
      try {
        const analysisPromise = window.opence.analyzeCollisionObj(objFilePath, {
          scale,
          flipYz,
          centerOrigin,
          forceAutoUv,
        });
        const uvPromise =
          typeof window.opence.exportUvTemplate === 'function'
            ? window.opence.exportUvTemplate({
                objFilePath,
                size: 384,
                scale,
                flipYz,
                centerOrigin,
                forceAutoUv,
                previewOnly: true,
              })
            : Promise.resolve({ ok: false } as any);

        const [analysisRes, uvRes] = await Promise.all([analysisPromise, uvPromise]);
        if (cancelled) return;
        if (analysisRes?.ok && analysisRes.summary) {
          setMeshSummary(analysisRes.summary);
          const slots: string[] = Array.isArray(analysisRes.summary.materialSlots) && analysisRes.summary.materialSlots.length > 0
            ? analysisRes.summary.materialSlots
            : ['default'];
          setSlotMaterialTypes(slots.map((name) => inferMaterialTypeFromSlotName(name, 7)));
        } else if (analysisRes?.error) {
          setErrorMsg(analysisRes.error);
        }
        if (uvRes?.ok && uvRes.previewDataUrl) {
          setUvPreviewUrl(uvRes.previewDataUrl);
          setUvUsedAuto(Boolean(uvRes.usedAutoUv));
        }
      } catch (err) {
        if (!cancelled) setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setAnalyzing(false);
      }
    };
    void runAnalysis();

    return () => {
      cancelled = true;
    };
  }, [objFilePath, scale, flipYz, centerOrigin, forceAutoUv]);

  if (!open) return null;

  const handlePickObj = async () => {
    const picked = await window.opence.pickObjFile();
    if (!picked.path) return;
    setObjFilePath(picked.path);
    setBuildSuccess(null);
    setSavedUvPath(null);

    const rawBase =
      picked.path
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.obj$/i, '') || 'custom_object';
    const cleanSlug = rawBase.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase() || 'custom_object';
    const opt = TAG_TYPE_OPTIONS.find((o) => o.group === tagGroup)!;
    setTagPath(`${opt.folderPrefix}\\${cleanSlug}\\${cleanSlug}`);
    setItemName(
      rawBase
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase()),
    );
  };

  const handlePickCollisionObj = async () => {
    const picked = await window.opence.pickObjFile();
    if (!picked.path) return;
    setCollisionObjFilePath(picked.path);
  };

  const handlePickTexture = async () => {
    const picked = await window.opence.pickImportBitmapPath();
    if (!picked.path) return;
    setTextureFilePath(picked.path);
    setBuildSuccess(null);
  };

  const handleExportUvTemplate = async () => {
    if (!objFilePath) return;
    setErrorMsg(null);
    const res = await window.opence.exportUvTemplate({
      objFilePath,
      size: 1024,
      scale,
      flipYz,
      centerOrigin,
      forceAutoUv,
      previewOnly: false,
    });
    if (res.ok && res.outputPath) {
      setSavedUvPath(res.outputPath);
    } else if (res.error && res.error !== 'Cancelled') {
      setErrorMsg(res.error);
    }
  };

  const handleBuild = async () => {
    if (!objFilePath) {
      setErrorMsg('Please select a 3D model (.obj) file first.');
      return;
    }
    setErrorMsg(null);
    setBuildSuccess(null);

    let outputOceTagsPath: string | undefined;
    if (outputMode === 'ocetags' || outputMode === 'both') {
      const leaf = tagPath.split('\\').pop() || 'custom_object';
      const defaultFile = `${leaf}.${tagGroup}.ocetags`;
      const pickedSave = await window.opence.pickSaveOceTagsPath(defaultFile);
      if (!pickedSave.path) return;
      outputOceTagsPath = pickedSave.path;
    }

    setBuilding(true);
    try {
      const effectiveMaterialType =
        tagGroup === 'scenery'
          ? materialType
          : tagGroup === 'equipment'
            ? 6 // metal thin
            : tagGroup === 'weapon'
              ? 7 // metal thick
              : slotMaterialTypes[0] ?? 7;

      const effectiveSlotMaterials =
        tagGroup === 'vehicle' || (meshSummary?.materialSlots?.length ?? 0) > 1
          ? slotMaterialTypes
          : undefined;

      const res = await window.opence.buildCustomObjectTag({
        tagGroup,
        tagPath,
        itemName,
        objFilePath,
        collisionObjFilePath: collisionObjFilePath || undefined,
        textureFilePath: textureFilePath || undefined,
        scale,
        flipYz,
        centerOrigin,
        forceAutoUv,
        multiBoxCollision,
        materialType: effectiveMaterialType,
        slotMaterialTypes: effectiveSlotMaterials,
        templateTagIndex: templateTagIndex >= 0 ? templateTagIndex : undefined,
        outputMode,
        outputOceTagsPath,
      });
      if (!res.ok) {
        setErrorMsg(res.message);
      } else {
        setBuildSuccess(res);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1200,
      }}
    >
      <div
        style={{
          width: 820,
          maxWidth: '95vw',
          maxHeight: '92vh',
          backgroundColor: '#1e1e24',
          border: '1px solid #383842',
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.65)',
          color: '#e4e4e7',
          fontSize: 13,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid #2e2e36',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#25252d',
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#f4f4f5' }}>
              Build New Object Tag (No Blender / HEK Required)
            </div>
            <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 2 }}>
              Compiles a Wavefront .OBJ 3D mesh + UV texture into a complete Halo CE GBXModel, 3D Collision BSP, Shader, Bitmap & Object Tag
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#a1a1aa',
              fontSize: 18,
              cursor: 'pointer',
              padding: '2px 6px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable Content */}
        <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Step 1: Select Tag Type */}
          <div
            style={{
              backgroundColor: '#25252d',
              border: '1px solid #32323d',
              borderRadius: 6,
              padding: 14,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 12, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
              1. Select Tag Type
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {TAG_TYPE_OPTIONS.map((opt) => {
                const active = tagGroup === opt.group;
                return (
                  <button
                    key={opt.group}
                    type="button"
                    onClick={() => handleSelectTagGroup(opt.group)}
                    style={{
                      padding: '10px 10px',
                      borderRadius: 6,
                      border: active ? '1px solid #38bdf8' : '1px solid #3a3a46',
                      backgroundColor: active ? 'rgba(56, 189, 248, 0.14)' : '#1e1e24',
                      color: active ? '#f0f9ff' : '#d4d4d8',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: active ? '#bae6fd' : '#71717a', marginTop: 3, lineHeight: 1.3 }}>
                      {opt.description}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Tag Path, Forge Name, and Optional Base Template */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 0.9fr', gap: 12, marginTop: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#a1a1aa', marginBottom: 4 }}>
                  Target Tag Path in Map
                </label>
                <input
                  type="text"
                  value={tagPath}
                  onChange={(e) => setTagPath(e.target.value)}
                  placeholder="scenery\custom\my_object\my_object"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '6px 9px',
                    backgroundColor: '#18181b',
                    border: '1px solid #3f3f46',
                    borderRadius: 4,
                    color: '#f4f4f5',
                    fontFamily: 'monospace',
                    fontSize: 12,
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#a1a1aa', marginBottom: 4 }}>
                  OpenCE Forge Display Name ([C] Prefix Added Automatically)
                </label>
                <input
                  type="text"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  placeholder="Custom Object"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '6px 9px',
                    backgroundColor: '#18181b',
                    border: '1px solid #3f3f46',
                    borderRadius: 4,
                    color: '#f4f4f5',
                    fontSize: 12,
                  }}
                />
              </div>
            </div>

            {canInjectIntoOpenMap && (
              <div style={{ marginTop: 10 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#a1a1aa', marginBottom: 4 }}>
                  Base Template Tag from Open Map (Optional — inherits animations, physics, markers, seats & firing effects)
                </label>
                <select
                  value={templateTagIndex}
                  onChange={(e) => setTemplateTagIndex(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '6px 9px',
                    backgroundColor: '#18181b',
                    border: '1px solid #3f3f46',
                    borderRadius: 4,
                    color: '#f4f4f5',
                    fontSize: 12,
                  }}
                >
                  <option value={-1}>
                    (None — Build Standalone {tagGroup.toUpperCase()} Tag from Scratch)
                  </option>
                  {templateCandidates.map((t) => (
                    <option key={t.index} value={t.index}>
                      {t.path} ({t.primaryClassName})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Step 2: Select 3D Model (.obj) & Collision Settings */}
          <div
            style={{
              backgroundColor: '#25252d',
              border: '1px solid #32323d',
              borderRadius: 6,
              padding: 14,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 12, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
              2. Select 3D Model File (.OBJ) & Collision Geometry
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="text"
                readOnly
                value={objFilePath}
                placeholder="Select a Wavefront .obj 3D model file..."
                style={{
                  flex: 1,
                  padding: '6px 9px',
                  backgroundColor: '#18181b',
                  border: '1px solid #3f3f46',
                  borderRadius: 4,
                  color: '#f4f4f5',
                  fontSize: 12,
                }}
              />
              <button
                type="button"
                onClick={handlePickObj}
                style={{
                  padding: '6px 14px',
                  backgroundColor: '#0284c7',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Browse .OBJ...
              </button>
            </div>

            {/* Mesh Transform Controls */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 16,
                alignItems: 'center',
                marginTop: 10,
                paddingTop: 10,
                borderTop: '1px solid #30303a',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: '#a1a1aa' }}>Scale:</span>
                <input
                  type="number"
                  step="0.05"
                  min="0.001"
                  max="1000"
                  value={scale}
                  onChange={(e) => setScale(Math.max(0.001, parseFloat(e.target.value) || 1.0))}
                  style={{
                    width: 72,
                    padding: '4px 6px',
                    backgroundColor: '#18181b',
                    border: '1px solid #3f3f46',
                    borderRadius: 4,
                    color: '#f4f4f5',
                    fontSize: 12,
                  }}
                />
                {[0.1, 1.0, 10.0].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setScale(preset)}
                    style={{
                      padding: '2px 6px',
                      fontSize: 11,
                      backgroundColor: scale === preset ? '#0369a1' : '#27272a',
                      color: '#e4e4e7',
                      border: '1px solid #3f3f46',
                      borderRadius: 3,
                      cursor: 'pointer',
                    }}
                  >
                    {preset}x
                  </button>
                ))}
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={flipYz}
                  onChange={(e) => setFlipYz(e.target.checked)}
                />
                Convert Y-Up to Halo Z-Up
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={centerOrigin}
                  onChange={(e) => setCenterOrigin(e.target.checked)}
                />
                Center X/Y & Rest on Z=0
              </label>

              <label
                title="When enabled (recommended), compiles a true 3D Polyhedral Mesh Collision BSP directly from the triangulated .OBJ so sloped ramps, bridges, curbs, arches, and concave shapes have exact per-triangle collision. Uncheck only to use a simple 6-plane rectangular bounding box."
                style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}
              >
                <input
                  type="checkbox"
                  checked={multiBoxCollision}
                  onChange={(e) => setMultiBoxCollision(e.target.checked)}
                />
                Exact 3D Mesh Collision BSP (Slopes, Ramps &amp; Concavities)
              </label>
            </div>

            {/* Tag-Type-Scoped Surface Material Configuration */}
            {tagGroup === 'scenery' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                <span style={{ fontSize: 11, color: '#a1a1aa', minWidth: 155 }}>
                  Scenery Surface Material:
                </span>
                <select
                  value={materialType}
                  onChange={(e) => setMaterialType(Number(e.target.value))}
                  style={{
                    flex: 1,
                    padding: '5px 8px',
                    backgroundColor: '#18181b',
                    border: '1px solid #3f3f46',
                    borderRadius: 4,
                    color: '#f4f4f5',
                    fontSize: 12,
                  }}
                >
                  {HALO_MATERIAL_OPTIONS.map((m) => (
                    <option key={m.index} value={m.index}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: 11, color: '#71717a' }}>
                  Sets bullet impact effects, decals &amp; footsteps on Scenery Collision &amp; Shader
                </span>
              </div>
            )}

            {(tagGroup === 'weapon' || tagGroup === 'equipment') && (
              <div
                style={{
                  marginTop: 10,
                  padding: '6px 10px',
                  backgroundColor: '#18181b',
                  border: '1px solid #32323c',
                  borderRadius: 4,
                  fontSize: 11,
                  color: '#a1a1aa',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>
                  Surface Material Type ({tagGroup.toUpperCase()}):{' '}
                  <strong style={{ color: '#e4e4e7' }}>
                    {tagGroup === 'weapon'
                      ? '7 — metal thick (Forced Standard Weapon Casing)'
                      : '6 — metal thin (Forced Standard Equipment Casing)'}
                  </strong>
                </span>
                <span style={{ color: '#71717a' }}>Automatic for {tagGroup} tags</span>
              </div>
            )}

            {(tagGroup === 'vehicle' || ((meshSummary?.materialSlots?.length ?? 0) > 1 && tagGroup === 'scenery')) && (
              <div
                style={{
                  marginTop: 10,
                  padding: '8px 10px',
                  backgroundColor: '#18181b',
                  border: '1px solid #32323c',
                  borderRadius: 5,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: '#38bdf8', marginBottom: 6 }}>
                  Blender Material Slots (<code>usemtl</code>) → Halo CE Collision Surface Materials
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(meshSummary?.materialSlots?.length ? meshSummary.materialSlots : ['default (hull)']).map(
                    (slotName: string, idx: number) => (
                      <div key={`${slotName}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            minWidth: 165,
                            fontFamily: 'monospace',
                            fontSize: 11,
                            color: '#e4e4e7',
                            backgroundColor: '#25252d',
                            padding: '3px 7px',
                            borderRadius: 3,
                            border: '1px solid #383842',
                          }}
                        >
                          usemtl {slotName}
                        </span>
                        <span style={{ color: '#71717a', fontSize: 11 }}>→</span>
                        <select
                          value={slotMaterialTypes[idx] ?? 7}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setSlotMaterialTypes((prev) => {
                              const next = [...prev];
                              next[idx] = val;
                              return next;
                            });
                          }}
                          style={{
                            flex: 1,
                            padding: '4px 8px',
                            backgroundColor: '#22222a',
                            border: '1px solid #3f3f46',
                            borderRadius: 4,
                            color: '#f4f4f5',
                            fontSize: 12,
                          }}
                        >
                          {HALO_MATERIAL_OPTIONS.map((m) => (
                            <option key={m.index} value={m.index}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ),
                  )}
                </div>
                <div style={{ fontSize: 10, color: '#71717a', marginTop: 6 }}>
                  Assign multiple materials in Blender (e.g. <code>hull_metal</code>, <code>windshield_glass</code>,{' '}
                  <code>tire_rubber</code>) before exporting <code>.obj</code> — each triangle surface receives its own
                  Halo CE physics/impact material!
                </div>
              </div>
            )}

            {/* Optional Custom Collision Proxy OBJ */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <span style={{ fontSize: 11, color: '#a1a1aa', minWidth: 155 }}>
                Collision Proxy .OBJ (Optional):
              </span>
              <input
                type="text"
                readOnly
                value={collisionObjFilePath}
                placeholder="Defaults to the render .OBJ above (auto-generates 3D Collision BSP)"
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  backgroundColor: '#18181b',
                  border: '1px solid #32323a',
                  borderRadius: 4,
                  color: '#d4d4d8',
                  fontSize: 11,
                }}
              />
              <button
                type="button"
                onClick={handlePickCollisionObj}
                style={{
                  padding: '4px 10px',
                  backgroundColor: '#27272a',
                  color: '#e4e4e7',
                  border: '1px solid #3f3f46',
                  borderRadius: 4,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Browse...
              </button>
              {collisionObjFilePath && (
                <button
                  type="button"
                  onClick={() => setCollisionObjFilePath('')}
                  style={{
                    padding: '4px 8px',
                    backgroundColor: '#27272a',
                    color: '#fca5a5',
                    border: '1px solid #3f3f46',
                    borderRadius: 4,
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            {/* Live Mesh Summary */}
            {analyzing && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#38bdf8' }}>
                Analyzing 3D mesh geometry...
              </div>
            )}
            {meshSummary && !analyzing && (
              <div
                style={{
                  marginTop: 10,
                  padding: '8px 12px',
                  borderRadius: 5,
                  backgroundColor: 'rgba(16, 185, 129, 0.1)',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  color: '#a7f3d0',
                  fontSize: 12,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <div>
                  <strong>{(meshSummary.vertexCount ?? 0).toLocaleString()}</strong> vertices •{' '}
                  <strong>{(meshSummary.triangleCount ?? 0).toLocaleString()}</strong> triangles •{' '}
                  {meshSummary.hasUvCoordinates && !forceAutoUv ? (
                    <span>Using OBJ UV coordinates ({(meshSummary.uvCoordCount ?? 0).toLocaleString()} vt)</span>
                  ) : (
                    <span style={{ color: '#fde68a' }}>
                      Auto-Unwrapped via Built-In 6-Face Box UV Atlas
                    </span>
                  )}
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#d1fae5' }}>
                  Size: {Number(meshSummary.bounds?.size?.[0] ?? 0).toFixed(2)} ×{' '}
                  {Number(meshSummary.bounds?.size?.[1] ?? 0).toFixed(2)} ×{' '}
                  {Number(meshSummary.bounds?.size?.[2] ?? 0).toFixed(2)} u (r=
                  {Number(
                    meshSummary.bounds?.radius ??
                      Math.hypot(
                        meshSummary.bounds?.size?.[0] ?? 0,
                        meshSummary.bounds?.size?.[1] ?? 0,
                        meshSummary.bounds?.size?.[2] ?? 0,
                      ) * 0.5,
                  ).toFixed(2)}
                  )
                </div>
              </div>
            )}
          </div>

          {/* Step 3: Select UV Texture (.PNG / .DDS) & Built-in UV Map Generator */}
          <div
            style={{
              backgroundColor: '#25252d',
              border: '1px solid #32323d',
              borderRadius: 6,
              padding: 14,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 12, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
              3. Select UV Map File (.PNG / .DDS) or Generate UV Template
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: uvPreviewUrl ? '1fr 150px' : '1fr', gap: 14, alignItems: 'start' }}>
              <div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="text"
                    readOnly
                    value={textureFilePath}
                    placeholder="Optional: Select painted .png or .dds texture (if blank, uses clean neutral surface)"
                    style={{
                      flex: 1,
                      padding: '6px 9px',
                      backgroundColor: '#18181b',
                      border: '1px solid #3f3f46',
                      borderRadius: 4,
                      color: '#f4f4f5',
                      fontSize: 12,
                    }}
                  />
                  <button
                    type="button"
                    onClick={handlePickTexture}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#0284c7',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Browse .PNG / .DDS...
                  </button>
                  {textureFilePath && (
                    <button
                      type="button"
                      onClick={() => setTextureFilePath('')}
                      style={{
                        padding: '6px 10px',
                        backgroundColor: '#27272a',
                        color: '#fca5a5',
                        border: '1px solid #3f3f46',
                        borderRadius: 4,
                        cursor: 'pointer',
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Built-in UV Unwrapper & Template Exporter */}
                <div
                  style={{
                    marginTop: 10,
                    padding: '10px 12px',
                    backgroundColor: '#1b1b21',
                    border: '1px solid #32323c',
                    borderRadius: 5,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={forceAutoUv}
                        onChange={(e) => setForceAutoUv(e.target.checked)}
                      />
                      Force Built-In 6-Face Box Atlas UV Unwrap (+X, -X, +Y, -Y, +Z, -Z)
                    </label>

                    <button
                      type="button"
                      disabled={!objFilePath}
                      onClick={handleExportUvTemplate}
                      style={{
                        padding: '5px 12px',
                        backgroundColor: objFilePath ? '#0d9488' : '#27272a',
                        color: objFilePath ? '#fff' : '#71717a',
                        border: 'none',
                        borderRadius: 4,
                        fontWeight: 600,
                        fontSize: 12,
                        cursor: objFilePath ? 'pointer' : 'not-allowed',
                      }}
                    >
                      Export UV Wireframe Template (.PNG)...
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: '#a1a1aa', lineHeight: 1.4 }}>
                    Don&apos;t have a UV map for your model? OpenCE Mantle automatically unwraps models without UVs into a 3×2 6-face Box UV Atlas. Click{' '}
                    <strong>Export UV Wireframe Template (.PNG)</strong> to save a 1024×1024 drawing guide you can paint over in any image editor (the light-blue UV guide lines are for reference only and will not be applied to the 3D model).
                  </div>
                  {savedUvPath && (
                    <div style={{ fontSize: 11, color: '#34d399' }}>
                      ✓ Saved UV Template to: <span style={{ fontFamily: 'monospace' }}>{savedUvPath}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Live UV Layout Thumbnail */}
              {uvPreviewUrl && (
                <div style={{ textAlign: 'center' }}>
                  <img
                    src={uvPreviewUrl}
                    alt="UV Wireframe Preview"
                    style={{
                      width: 144,
                      height: 144,
                      borderRadius: 4,
                      border: '1px solid #3f3f46',
                      display: 'block',
                      backgroundColor: '#18181b',
                    }}
                  />
                  <div style={{ fontSize: 10, color: '#a1a1aa', marginTop: 4 }}>
                    {uvUsedAuto ? '6-Face Box UV Atlas' : 'Model UV Layout'}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Step 4: Output Destination */}
          <div
            style={{
              backgroundColor: '#25252d',
              border: '1px solid #32323d',
              borderRadius: 6,
              padding: 14,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 12, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              4. Output Destination
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: canInjectIntoOpenMap ? 'pointer' : 'not-allowed',
                  opacity: canInjectIntoOpenMap ? 1 : 0.45,
                }}
              >
                <input
                  type="radio"
                  name="outputMode"
                  disabled={!canInjectIntoOpenMap}
                  checked={outputMode === 'inject'}
                  onChange={() => setOutputMode('inject')}
                />
                Inject Directly into Open Map
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="outputMode"
                  checked={outputMode === 'ocetags'}
                  onChange={() => setOutputMode('ocetags')}
                />
                Save as .ocetags File (OpenCE Forge / Tag Package)
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: canInjectIntoOpenMap ? 'pointer' : 'not-allowed',
                  opacity: canInjectIntoOpenMap ? 1 : 0.45,
                }}
              >
                <input
                  type="radio"
                  name="outputMode"
                  disabled={!canInjectIntoOpenMap}
                  checked={outputMode === 'both'}
                  onChange={() => setOutputMode('both')}
                />
                Both (Inject into Open Map + Save .ocetags)
              </label>
            </div>
          </div>

          {/* Error or Success Banner */}
          {errorMsg && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 6,
                backgroundColor: 'rgba(239, 68, 68, 0.14)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                color: '#fca5a5',
                fontSize: 12,
              }}
            >
              {errorMsg}
            </div>
          )}

          {buildSuccess && buildSuccess.ok && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 6,
                backgroundColor: 'rgba(16, 185, 129, 0.14)',
                border: '1px solid rgba(16, 185, 129, 0.45)',
                color: '#d1fae5',
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                ✓ Successfully Built Custom {buildSuccess.rootTagGroup.toUpperCase()} Tag Set!
              </div>
              <div>
                Compiled <strong>{buildSuccess.generatedTagPaths.length}</strong> tags (
                <code>bitm</code>, <code>soso</code>, <code>mod2</code>, <code>coll</code>,{' '}
                <code>{buildSuccess.rootTagGroup}</code>) at{' '}
                <code style={{ color: '#6ee7b7' }}>{buildSuccess.rootTagPath}</code>.
              </div>
              {buildSuccess.injectedIntoMap && (
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span>Injected into the currently open map in memory. Use File &gt; Save to write to disk.</span>
                  {onSelectInjectedTag && (
                    <button
                      type="button"
                      onClick={() => {
                        onSelectInjectedTag(
                          buildSuccess.rootTagPath,
                          buildSuccess.rootTagGroup,
                          buildSuccess.map,
                        );
                        onClose();
                      }}
                      style={{
                        padding: '4px 10px',
                        backgroundColor: '#059669',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 4,
                        fontWeight: 600,
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      Inspect New Tag in Browser
                    </button>
                  )}
                </div>
              )}
              {buildSuccess.outputOceTagsPath && (
                <div style={{ marginTop: 4 }}>
                  Saved Forge/Injection container: <code>{buildSuccess.outputOceTagsPath}</code>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid #2e2e36',
            backgroundColor: '#25252d',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '7px 16px',
              backgroundColor: '#27272a',
              color: '#e4e4e7',
              border: '1px solid #3f3f46',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
          <button
            type="button"
            disabled={!objFilePath || building}
            onClick={handleBuild}
            style={{
              padding: '7px 18px',
              backgroundColor: !objFilePath || building ? '#1e3a5f' : '#0284c7',
              color: !objFilePath || building ? '#94a3b8' : '#ffffff',
              border: 'none',
              borderRadius: 4,
              fontWeight: 600,
              cursor: !objFilePath || building ? 'not-allowed' : 'pointer',
            }}
          >
            {building
              ? 'Compiling 3D Model & Collision BSP...'
              : outputMode === 'inject'
                ? 'Build & Inject into Open Map'
                : outputMode === 'ocetags'
                  ? 'Build & Save .ocetags...'
                  : 'Build, Inject & Save .ocetags...'}
          </button>
        </div>
      </div>
    </div>
  );
}
