import { useEffect, useMemo, useRef, useState } from 'react';
import type { TagEntrySummary } from '../../electron/shared-types';
import { NULL_TAG_ID } from '../../../core/src/constants/tag-classes';
import {
  convertColladaDaeToObjText,
  convertJmsToObjText,
  exportTagToXml,
  generateOpenCeModToml,
  packageMccMapName,
} from '../../../core/src/map/mod-packager';
import type { SteamMccDiscoveryResult } from '../../electron/mcc-deploy';

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

  // --- Item 2: Direct .JMA Animation & .JMS Mass-Point Physics Compiler State ---
  const antrTags = useMemo(
    () => allTags.filter((t) => t.primaryClassName === 'model_animations'),
    [allTags],
  );
  const physTags = useMemo(
    () => allTags.filter((t) => t.primaryClassName === 'physics'),
    [allTags],
  );
  const fontTags = useMemo(
    () => allTags.filter((t) => t.primaryClassName === 'font'),
    [allTags],
  );
  const [selectedAntrIdx, setSelectedAntrIdx] = useState<number>(() => antrTags[0]?.index ?? -1);
  const [customAnimName, setCustomAnimName] = useState<string>('');
  const [selectedPhysIdx, setSelectedPhysIdx] = useState<number>(() => physTags[0]?.index ?? -1);
  const [customPhysMass, setCustomPhysMass] = useState<string>('');

  // --- Option 2: Source Decompiler (gbxmodel -> .jms, model_animations -> .jma, physics -> physics.jms) ---
  const mod2Tags = useMemo(
    () => allTags.filter((t) => t.primaryClassName === 'gbxmodel' || t.primaryClassName === 'model'),
    [allTags],
  );
  const [selectedMod2DecompIdx, setSelectedMod2DecompIdx] = useState<number>(() => mod2Tags[0]?.index ?? -1);
  const [decompileAnimIndex, setDecompileAnimIndex] = useState<number>(0);

  // --- Option 3: Direct .TXT / .HMT String Compiler (`ustr` / `hmt `) ---
  const stringTags = useMemo(
    () =>
      allTags.filter(
        (t) => t.primaryClassName === 'unicode_string_list' || t.primaryClassName === 'hud_message_text',
      ),
    [allTags],
  );
  const [selectedStringTagIdx, setSelectedStringTagIdx] = useState<number>(() => stringTags[0]?.index ?? -1);
  const [stringSourceInput, setStringSourceInput] = useState<string>(
    'pickup_ar=Picked up an Assault Rifle\npickup_pistol=Picked up a M6D Pistol\nobjective_alpha=Secure Landing Zone Alpha',
  );

  // --- Option 3: .meter (`metr`) Stencil & Color Gradient Inspector + System/TrueType -> .font Generator ---
  const meterTags = useMemo(
    () => allTags.filter((t) => t.primaryClassName === 'meter'),
    [allTags],
  );
  const [selectedMeterIdx, setSelectedMeterIdx] = useState<number>(() => meterTags[0]?.index ?? -1);
  const [meterSummary, setMeterSummary] = useState<{
    tagPath: string;
    width: number;
    height: number;
    emptyColorHex: string;
    fullColorHex: string;
    unmaskDistance: number;
    maskDistance: number;
    encodedBytes: number;
    previewRgba: number[];
  } | null>(null);
  const meterCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ttfFontFamily, setTtfFontFamily] = useState<string>('Segoe UI');
  const [ttfFontSizePx, setTtfFontSizePx] = useState<number>(16);

  // --- Item 3: .font Tag Character & Glyph Inspector State ---
  const [selectedFontIdx, setSelectedFontIdx] = useState<number>(() => fontTags[0]?.index ?? -1);
  const [fontPreviewText, setFontPreviewText] = useState<string>('UNSC PELICAN INBOUND — WAVE 1 CLEARED');
  const [fontInspectorSummary, setFontInspectorSummary] = useState<{
    tagPath: string;
    ascendingHeight: number;
    descendingHeight: number;
    leadingHeight: number;
    leadingWidth: number;
    characterCount: number;
    sampleGlyphs: Array<{ character: number; charStr: string; characterWidth: number; bitmapWidth: number; bitmapHeight: number }>;
  } | null>(null);

  // --- Item 3: Global Tag Field Value Search & Batch Replace State ---
  const [fieldReplaceQuery, setFieldReplaceQuery] = useState<string>('bounding radius');
  const [fieldReplaceCategory, setFieldReplaceCategory] = useState<string>('ALL');
  const [fieldReplaceMatchVal, setFieldReplaceMatchVal] = useState<string>('');
  const [fieldReplaceNewVal, setFieldReplaceNewVal] = useState<string>('5.0');
  const [fieldReplaceReport, setFieldReplaceReport] = useState<Array<{
    tagIndex: number;
    tagPath: string;
    tagGroup: string;
    fieldPath: string;
    oldValue: string;
    newValue: string;
  }> | null>(null);

  // --- Tab 2: Error Scanner & Global Search/Replace State ---
  const tagCategories = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTags) {
      if (t.primaryClassName) set.add(t.primaryClassName);
    }
    return Array.from(set).sort();
  }, [allTags]);

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
  const [replaceFromCategory, setReplaceFromCategory] = useState<string>('ALL');
  const [replaceToCategory, setReplaceToCategory] = useState<string>('ALL');
  const [replaceFromTagId, setReplaceFromTagId] = useState<number>(() => allTags[0]?.tagId ?? NULL_TAG_ID);
  const [replaceToTagId, setReplaceToTagId] = useState<number>(() => allTags[1]?.tagId ?? NULL_TAG_ID);

  const filteredReplaceFromTags = useMemo(
    () => (replaceFromCategory === 'ALL' ? allTags : allTags.filter((t) => t.primaryClassName === replaceFromCategory)),
    [allTags, replaceFromCategory],
  );
  const filteredReplaceToTags = useMemo(
    () => (replaceToCategory === 'ALL' ? allTags : allTags.filter((t) => t.primaryClassName === replaceToCategory)),
    [allTags, replaceToCategory],
  );

  // --- Tab 3: OpenCE Forge Package (.ocetags), Mod Folder Exporter, Legacy Importer & XML Exporter State ---
  const SAMPLE_MOD_CATEGORIES: Array<{ group: string; label: string }> = [
    { group: 'bitmap', label: 'bitmap — Textures & Weapon/Vehicle Skins (golden_AR, early_vehicle_textures)' },
    { group: 'gbxmodel', label: 'gbxmodel — 3D Character/Weapon Models (Female Spartan, Minecraft Steve)' },
    { group: 'sound', label: 'sound — Audio & SFX Permutations (UncompressedAudio, Female Spartan)' },
    { group: 'unicode_string_list', label: 'unicode_string_list — HUD & Pickup Strings (Ext_Pickup_Messages)' },
    { group: 'weapon', label: 'weapon — Custom Weapons (.ocetags Forge)' },
    { group: 'vehicle', label: 'vehicle — Custom Vehicles (.ocetags Forge)' },
    { group: 'biped', label: 'biped — Custom Characters / Bipeds (.ocetags Forge)' },
    { group: 'scenery', label: 'scenery — Custom Scenery Props (.ocetags Forge)' },
  ];
  const availableModCategories = useMemo(
    () => SAMPLE_MOD_CATEGORIES.filter((c) => allTags.some((t) => t.primaryClassName === c.group)),
    [allTags],
  );
  const [forgeCategory, setForgeCategory] = useState<string>(() => {
    const firstMatch = SAMPLE_MOD_CATEGORIES.find((c) => allTags.some((t) => t.primaryClassName === c.group));
    return firstMatch?.group ?? 'bitmap';
  });
  const filteredForgeTags = useMemo(
    () => allTags.filter((t) => t.primaryClassName === forgeCategory),
    [allTags, forgeCategory],
  );
  const [forgeTagIndex, setForgeTagIndex] = useState<number>(() => {
    const firstCat = SAMPLE_MOD_CATEGORIES.find((c) => allTags.some((t) => t.primaryClassName === c.group))?.group ?? 'bitmap';
    const firstTag = allTags.find((t) => t.primaryClassName === firstCat) ?? allTags[0];
    return firstTag?.index ?? 0;
  });
  const [queuedModTagIndices, setQueuedModTagIndices] = useState<number[]>([]);
  const [forgeItemName, setForgeItemName] = useState<string>(() => {
    const firstCat = SAMPLE_MOD_CATEGORIES.find((c) => allTags.some((t) => t.primaryClassName === c.group))?.group ?? 'bitmap';
    const first = allTags.find((t) => t.primaryClassName === firstCat) ?? allTags[0];
    return first ? (first.path.split('\\').pop() || 'Custom OpenCE Item').replace(/[_-]+/g, ' ') : 'Custom OpenCE Item';
  });
  const [modId] = useState<string>('custom_halo_mod');
  const [modName, setModName] = useState<string>('Custom OpenCE Mod');
  const [modVersion, setModVersion] = useState<string>('1.0.0');
  const [modAuthor, setModAuthor] = useState<string>('OpenCE Modder');
  const [modDesc, setModDesc] = useState<string>('Built with OpenCE Mantle.');
  const [includeModDeps, setIncludeModDeps] = useState<boolean>(false);
  const [replaceTargetTagIndex, setReplaceTargetTagIndex] = useState<number>(-1);
  const vanillaReplacementCandidates = useMemo(() => {
    const targetGroups =
      forgeCategory === 'biped' || forgeCategory === 'gbxmodel'
        ? ['gbxmodel', 'biped']
        : [forgeCategory, 'gbxmodel'];
    return allTags.filter(
      (t) =>
        targetGroups.includes(t.primaryClassName) &&
        !t.path.toLowerCase().startsWith('h3r\\') &&
        !t.path.toLowerCase().startsWith('forge\\'),
    );
  }, [allTags, forgeCategory]);
  const [legacyInjectMode, setLegacyInjectMode] = useState<'add' | 'swap'>('add');
  const [legacyImportReport, setLegacyImportReport] = useState<{
    sourcePath: string;
    formatDetected: 'hek_loose' | 'hmt_meta_xml';
    addedCount: number;
    swappedCount: number;
    reusedCount: number;
    importedPaths: string[];
    warnings: string[];
  } | null>(null);
  const [xmlCategory, setXmlCategory] = useState<string>('ALL');
  const filteredXmlTags = useMemo(
    () => (xmlCategory === 'ALL' ? allTags : allTags.filter((t) => t.primaryClassName === xmlCategory)),
    [allTags, xmlCategory],
  );
  const [xmlTagIndex, setXmlTagIndex] = useState<number>(() => allTags[0]?.index ?? 0);
  const [mccDiscovery, setMccDiscovery] = useState<SteamMccDiscoveryResult | null>(null);
  const [mccIsMultiplayer, setMccIsMultiplayer] = useState<boolean>(true);
  const [mccRegisterManifest, setMccRegisterManifest] = useState<boolean>(true);
  const [mccDeployReport, setMccDeployReport] = useState<{
    modFolderPath: string;
    mapOutputPath: string;
    manifestPath?: string;
    manifestRegistered: boolean;
  } | null>(null);

  const handleDiscoverSteamMcc = async () => {
    if (!window.opence.discoverSteamMcc) return;
    setIsBusy(true);
    const res = await window.opence.discoverSteamMcc();
    setIsBusy(false);
    setMccDiscovery(res);
    setStatusMessage(
      res.mccInstallPaths.length > 0
        ? `Detected Steam MCC installation at ${res.mccInstallPaths[0]} (${res.manifestExists ? 'ModManifest.txt found' : 'ModManifest.txt will be created'}).`
        : 'No automatic Steam MCC installation found; you will be prompted for a destination folder on deploy.',
    );
  };

  const handleDeployMccMod = async () => {
    if (!window.opence.deployMccMod) return;
    setIsBusy(true);
    setStatusMessage(null);
    const res = await window.opence.deployMccMod({
      title: modName,
      description: modDesc,
      author: modAuthor,
      isMultiplayer: mccIsMultiplayer,
      registerInModManifest: mccRegisterManifest,
    });
    setIsBusy(false);
    if (!res) return;
    if (res.ok) {
      setMccDeployReport({
        modFolderPath: res.modFolderPath,
        mapOutputPath: res.mapOutputPath,
        manifestPath: res.manifestPath,
        manifestRegistered: res.manifestRegistered,
      });
      setStatusMessage(
        `Deployed MCC Mod Package to ${res.modFolderPath}${res.manifestRegistered ? ' & registered in ModManifest.txt!' : '.'}`,
      );
    } else if (!res.cancelled) {
      setStatusMessage(`MCC Deploy failed: ${res.message}`);
    }
  };

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
      const trimmed = jmsInput.trim();
      if (trimmed.startsWith('<?xml') || /<COLLADA\b/i.test(trimmed)) {
        const res = convertColladaDaeToObjText(jmsInput);
        setJmsConvertedObj(res.objText);
        setStatusMessage(
          `Converted COLLADA .DAE (${res.vertexCount} vertices, ${res.triangleCount} triangles, ${res.meshCount} meshes, ${res.materialNames.length} materials) to Wavefront .OBJ!`,
        );
      } else {
        const res = convertJmsToObjText(jmsInput);
        setJmsConvertedObj(res.objText);
        setStatusMessage(
          `Converted .JMS (${res.vertexCount} vertices, ${res.triangleCount} triangles, ${res.nodeCount} nodes, ${res.markerCount} markers) to Wavefront .OBJ!`,
        );
      }
    } catch (err) {
      setStatusMessage(`Failed to parse .JMS / .DAE: ${(err as Error).message}`);
    }
  };

  const handleCompileJma = async () => {
    if (!window.opence.compileJmaAnimation || selectedAntrIdx < 0) return;
    setIsBusy(true);
    setStatusMessage(null);
    const res = await window.opence.compileJmaAnimation(
      selectedAntrIdx,
      customAnimName.trim() || undefined,
    );
    setIsBusy(false);
    if (!res) return;
    if (res.ok) {
      setStatusMessage(
        `Compiled .JMA animation "${res.animationName}" from ${res.fileName} (${res.frameCount} frames, ${res.nodeCount} nodes, ${res.frameSize} B/frame) into model_animations #${selectedAntrIdx}! Press Ctrl+S to save.`,
      );
    } else if (!res.cancelled) {
      setStatusMessage(`JMA Compile failed: ${res.message}`);
    }
  };

  const handleCompileJmsPhysics = async () => {
    if (!window.opence.compileJmsPhysics || selectedPhysIdx < 0) return;
    setIsBusy(true);
    setStatusMessage(null);
    const parsedMass = customPhysMass.trim() ? Number(customPhysMass) : undefined;
    const res = await window.opence.compileJmsPhysics(
      selectedPhysIdx,
      parsedMass !== undefined && Number.isFinite(parsedMass) && parsedMass > 0 ? parsedMass : undefined,
    );
    setIsBusy(false);
    if (!res) return;
    if (res.ok) {
      setStatusMessage(
        `Compiled ${res.massPointCount} mass points (total mass ${res.totalMass} kg, CoM [${res.centerOfMass.map((v) => v.toFixed(2)).join(', ')}]) from ${res.fileName} into physics #${selectedPhysIdx}! Press Ctrl+S to save.`,
      );
    } else if (!res.cancelled) {
      setStatusMessage(`JMS Physics Compile failed: ${res.message}`);
    }
  };

  const handleInspectFontTag = async (fontIdx?: number) => {
    const targetIdx = fontIdx ?? selectedFontIdx;
    const entry = allTags.find((t) => t.index === targetIdx);
    if (!entry) return;
    setIsBusy(true);
    const res = await window.opence.getTagFields(targetIdx);
    setIsBusy(false);
    if (!res || !res.ok) {
      setStatusMessage(res ? `Failed to read font tag fields: ${res.message}` : 'Failed to read font tag fields.');
      return;
    }
    const fields = res.data.fields;
    const getNum = (name: string) => {
      const f = fields.find((fl) => fl.name === name);
      return typeof f?.value === 'number' ? f.value : 0;
    };
    const charsField = fields.find((fl) => fl.name === 'characters');
    const charCount = charsField?.reflexiveCount ?? charsField?.children?.length ?? 0;
    const sampleGlyphs: Array<{
      character: number;
      charStr: string;
      characterWidth: number;
      bitmapWidth: number;
      bitmapHeight: number;
    }> = [];
    for (const el of charsField?.children?.slice(0, 48) ?? []) {
      const charCode = Number(el.fields.find((f) => f.name === 'character')?.value ?? 0);
      const characterWidth = Number(el.fields.find((f) => f.name === 'character width')?.value ?? 0);
      const bitmapWidth = Number(el.fields.find((f) => f.name === 'bitmap width')?.value ?? 0);
      const bitmapHeight = Number(el.fields.find((f) => f.name === 'bitmap height')?.value ?? 0);
      sampleGlyphs.push({
        character: charCode,
        charStr: charCode >= 32 && charCode <= 126 ? String.fromCharCode(charCode) : `U+${charCode.toString(16).toUpperCase().padStart(4, '0')}`,
        characterWidth,
        bitmapWidth,
        bitmapHeight,
      });
    }
    setFontInspectorSummary({
      tagPath: entry.path,
      ascendingHeight: getNum('ascending height'),
      descendingHeight: getNum('descending height'),
      leadingHeight: getNum('leading height'),
      leadingWidth: getNum('leading width'),
      characterCount: charCount,
      sampleGlyphs,
    });
    setStatusMessage(
      `Loaded font '${entry.path}' (${charCount} glyphs, ascending=${getNum('ascending height')}px, descending=${getNum('descending height')}px).`,
    );
  };

  useEffect(() => {
    if (!meterSummary || !meterCanvasRef.current) return;
    const canvas = meterCanvasRef.current;
    canvas.width = meterSummary.width;
    canvas.height = meterSummary.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imgData = ctx.createImageData(meterSummary.width, meterSummary.height);
    for (let i = 0; i < meterSummary.previewRgba.length && i < imgData.data.length; i++) {
      imgData.data[i] = meterSummary.previewRgba[i]!;
    }
    ctx.putImageData(imgData, 0, 0);
  }, [meterSummary]);

  const handleDecompileTagToSource = async (tagIndex: number, animIdx?: number) => {
    if (!window.opence.decompileTagToSource || tagIndex < 0) return;
    setIsBusy(true);
    setStatusMessage(null);
    const res = await window.opence.decompileTagToSource(tagIndex, animIdx);
    setIsBusy(false);
    if (!res) return;
    if (res.ok) {
      setStatusMessage(`Decompiled "${res.tagPath}" → ${res.outputPath} (${res.summary})!`);
    } else if (!res.cancelled) {
      setStatusMessage(`Decompile failed: ${res.message}`);
    }
  };

  const handleCompileStringsTag = async (useFilePicker: boolean) => {
    if (!window.opence.compileStringsTag || selectedStringTagIdx < 0) return;
    setIsBusy(true);
    setStatusMessage(null);
    const res = await window.opence.compileStringsTag(
      selectedStringTagIdx,
      useFilePicker ? undefined : stringSourceInput,
    );
    setIsBusy(false);
    if (!res) return;
    if (res.ok) {
      setStatusMessage(
        `Compiled ${res.entryCount} string(s) into [${res.tagGroup}] "${res.tagPath}" (${res.messageNames.slice(0, 5).join(', ')})! Press Ctrl+S to save.`,
      );
    } else if (!res.cancelled) {
      setStatusMessage(`Strings compile failed: ${res.message}`);
    }
  };

  const handleInspectMeter = async (meterIdx?: number) => {
    const idx = meterIdx ?? selectedMeterIdx;
    if (!window.opence.inspectMeterTag || idx < 0) return;
    setIsBusy(true);
    const res = await window.opence.inspectMeterTag(idx);
    setIsBusy(false);
    if (!res) return;
    if (res.ok) {
      setMeterSummary(res);
      setStatusMessage(
        `Loaded meter "${res.tagPath}" (${res.width}×${res.height} stencil, ${res.encodedBytes} encoded bytes, gradient ${res.emptyColorHex} → ${res.fullColorHex}).`,
      );
    } else {
      setStatusMessage(`Meter inspect failed: ${res.message}`);
    }
  };

  const handleCompileSystemFontToHaloFont = async () => {
    if (!window.opence.compileFontFromGlyphAtlas || selectedFontIdx < 0) return;
    const sizePx = Math.max(8, Math.min(48, Math.round(ttfFontSizePx || 16)));
    const family = ttfFontFamily.trim() || 'Segoe UI';
    const asc = Math.max(6, Math.round(sizePx * 0.8));
    const desc = Math.max(2, Math.round(sizePx * 0.25));
    const cellH = asc + desc;

    const canvas = document.createElement('canvas');
    canvas.width = sizePx * 2;
    canvas.height = cellH + 4;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const glyphs: Array<{
      charCode: number;
      characterWidth: number;
      bitmapWidth: number;
      bitmapHeight: number;
      bitmapOriginX: number;
      bitmapOriginY: number;
      alphaPixels: number[];
    }> = [];

    for (let code = 32; code <= 126; code++) {
      const ch = String.fromCharCode(code);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = `bold ${sizePx}px "${family}", sans-serif`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#ffffff';
      const measured = ctx.measureText(ch);
      const adv = Math.max(4, Math.ceil(measured.width));
      const bw = Math.max(1, Math.min(canvas.width, adv + 2));
      const bh = cellH;
      ctx.fillText(ch, 1, asc);
      const img = ctx.getImageData(0, 0, bw, bh);
      const alphaPixels: number[] = new Array(bw * bh);
      for (let p = 0; p < bw * bh; p++) {
        alphaPixels[p] = img.data[p * 4 + 3] ?? 0;
      }
      glyphs.push({
        charCode: code,
        characterWidth: adv,
        bitmapWidth: bw,
        bitmapHeight: bh,
        bitmapOriginX: 0,
        bitmapOriginY: asc,
        alphaPixels,
      });
    }

    setIsBusy(true);
    setStatusMessage(null);
    const res = await window.opence.compileFontFromGlyphAtlas(selectedFontIdx, {
      ascendingHeight: asc,
      descendingHeight: desc,
      leadingHeight: Math.round(sizePx * 0.15),
      leadingWidth: 1,
      glyphs,
    });
    setIsBusy(false);
    if (!res) return;
    if (res.ok) {
      await handleInspectFontTag(selectedFontIdx);
      setStatusMessage(
        `Rasterized & compiled ${res.glyphCount} ASCII glyphs (${res.totalPixelBytes} pixel bytes) from "${family}" (${sizePx}px) into font "${res.tagPath}"! Press Ctrl+S to save.`,
      );
    } else {
      setStatusMessage(`Font compile failed: ${res.message}`);
    }
  };

  const handleGlobalFieldReplace = async () => {
    if (!window.opence.globalReplaceTagFieldValue) return;
    if (!fieldReplaceQuery.trim()) {
      setStatusMessage('Please enter a field name query (e.g. "bounding radius").');
      return;
    }
    setIsBusy(true);
    setStatusMessage(null);
    const res = await window.opence.globalReplaceTagFieldValue({
      fieldNameQuery: fieldReplaceQuery.trim(),
      tagGroupFilter: fieldReplaceCategory === 'ALL' ? undefined : fieldReplaceCategory,
      matchValue: fieldReplaceMatchVal.trim() === '' ? undefined : fieldReplaceMatchVal.trim(),
      newValue: fieldReplaceNewVal.trim(),
    });
    setIsBusy(false);
    if (res.ok) {
      setFieldReplaceReport(res.affectedFields);
      setStatusMessage(
        `Updated ${res.replacedCount} field(s) matching "${fieldReplaceQuery.trim()}" across the map in-memory! Press Ctrl+S to save.`,
      );
    } else {
      setStatusMessage(`Batch field replace failed: ${res.message}`);
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

  const handleExportOpenCeModFolder = async () => {
    if (!window.opence.exportOpenCeModFolder) return;
    const indicesToExport =
      queuedModTagIndices.length > 0 ? queuedModTagIndices : [forgeTagIndex];
    const entry = allTags.find((t) => t.index === indicesToExport[0]);
    if (!entry) return;
    setIsBusy(true);
    setStatusMessage(null);
    const res = await window.opence.exportOpenCeModFolder({
      rootTagIndices: indicesToExport,
      modName: modName.trim() || forgeItemName.trim() || 'Custom OpenCE Mod',
      version: modVersion.trim() || '1.0.0',
      author: modAuthor.trim() || 'OpenCE Modder',
      description: modDesc.trim() || `Exported ${entry.path}.${entry.primaryClassName}`,
      includeDependencies: includeModDeps,
      replaceTargetTagIndex: replaceTargetTagIndex >= 0 ? replaceTargetTagIndex : undefined,
    });
    setIsBusy(false);
    if (res.ok) {
      setStatusMessage(
        `Exported OpenCE Mod Folder "${res.modFolderName}" (${res.tagCount} loose 'blam' tag files under tags/ + mod.toml) to ${res.outputDir}!`,
      );
    } else if (res.message !== 'Cancelled.') {
      setStatusMessage(`Failed to export OpenCE mod folder: ${res.message}`);
    }
  };

  const handleImportLegacyTags = async (sourceMode: 'file' | 'folder') => {
    if (!window.opence.importLegacyTags) return;
    setIsBusy(true);
    setStatusMessage(null);
    const res = await window.opence.importLegacyTags(sourceMode, legacyInjectMode);
    setIsBusy(false);
    if (res.ok) {
      setLegacyImportReport({
        sourcePath: res.sourcePath,
        formatDetected: res.formatDetected,
        addedCount: res.addedCount,
        swappedCount: res.swappedCount,
        reusedCount: res.reusedCount,
        importedPaths: res.importedPaths,
        warnings: res.warnings,
      });
      onTagsUpdated?.(res.map.tags);
      window.dispatchEvent(new CustomEvent('opence:scenario-updated'));
      setStatusMessage(
        `Imported legacy tags (${res.formatDetected === 'hek_loose' ? "HEK/OpenCE Loose 'blam' Tags" : 'HMT v3.5 .meta + .xml Extract'}): +${res.addedCount} added, ${res.swappedCount} swapped, ${res.reusedCount} reused! Press Ctrl+S to save.`,
      );
    } else if (res.message !== 'Cancelled.') {
      setStatusMessage(`Failed to import legacy tags: ${res.message}`);
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

              {/* Card 4: Native .JMS / COLLADA .DAE to .OBJ Source Transpiler */}
              <div style={{ padding: 14, background: 'var(--bg-panel-header)', border: '1px solid var(--border)', borderRadius: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: 4 }}>
                  Halo CE .JMS &amp; COLLADA .DAE Source Converter (.jms / .dae → .obj)
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <textarea
                    placeholder="Paste Halo CE .JMS (version 8200) or Blender/Maya COLLADA .DAE XML content here..."
                    value={jmsInput}
                    onChange={(e) => setJmsInput(e.target.value)}
                    style={{ flex: 1, height: 90, background: '#0d1117', color: '#e6edf3', border: '1px solid var(--border)', padding: 8, fontFamily: 'var(--mono-font)', fontSize: 11 }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
                    <button
                      onClick={handleConvertJms}
                      style={{ padding: '6px 12px', background: 'rgba(56,189,248,0.18)', border: '1px solid rgba(56,189,248,0.45)', color: '#38bdf8', fontWeight: 600, fontSize: 11, borderRadius: 3, cursor: 'pointer' }}
                    >
                      Convert .JMS / .DAE → .OBJ
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

              {/* Card 5: Dual-Mode Source Compilers & Decompilers (Zero tool.exe Pipeline) */}
              <div style={{ padding: 14, background: 'var(--bg-panel-header)', border: '1px solid var(--border)', borderRadius: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: 4 }}>
                  Zero-`tool.exe` Source Compilers &amp; `data/` Source Decompilers (`mod2` ↔ `.JMS`, `antr` ↔ `.JMA`, `phys` ↔ `physics.jms`, `.TXT/.HMT` → `ustr/hmt `)
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>
                  Compile `.jma` animations, `.jms` mass-point physics, and `.txt`/`.hmt` strings directly into map tags—or reverse-decompile any `gbxmodel` (`mod2`), `model_animations` (`antr`), or `physics` (`phys`) tag back into editable `.jms`/`.jma` source files.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* Row A: JMA <-> model_animations */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ width: 155, fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0 }}>
                      1. `.JMA` ↔ `antr`:
                    </span>
                    <select
                      data-testid="compile-jma-target-antr"
                      value={selectedAntrIdx}
                      onChange={(e) => setSelectedAntrIdx(Number(e.target.value))}
                      style={{ flex: 1, minWidth: 0, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                    >
                      {antrTags.map((t) => (
                        <option key={t.index} value={t.index}>
                          #{t.index} — {t.path}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Anim name (compile)..."
                      value={customAnimName}
                      onChange={(e) => setCustomAnimName(e.target.value)}
                      style={{ width: 145, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                    />
                    <button
                      data-testid="compile-jma-btn"
                      onClick={handleCompileJma}
                      disabled={isBusy || selectedAntrIdx < 0}
                      style={{ padding: '6px 10px', background: 'rgba(34,197,94,0.18)', border: '1px solid rgba(34,197,94,0.45)', color: '#4ade80', fontWeight: 600, fontSize: 11, borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      Compile .JMA → antr
                    </button>
                    <input
                      type="number"
                      min="0"
                      value={decompileAnimIndex}
                      onChange={(e) => setDecompileAnimIndex(Math.max(0, Number(e.target.value) || 0))}
                      title="Animation entry index inside model_animations to decompile"
                      style={{ width: 52, padding: '6px 6px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11 }}
                    />
                    <button
                      data-testid="decompile-antr-jma-btn"
                      onClick={() => void handleDecompileTagToSource(selectedAntrIdx, decompileAnimIndex)}
                      disabled={isBusy || selectedAntrIdx < 0}
                      style={{ padding: '6px 10px', background: 'rgba(56,189,248,0.18)', border: '1px solid rgba(56,189,248,0.45)', color: '#38bdf8', fontWeight: 600, fontSize: 11, borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      Decompile antr → .JMA
                    </button>
                  </div>

                  {/* Row B: JMS <-> physics */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ width: 155, fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0 }}>
                      2. `.JMS` ↔ `phys`:
                    </span>
                    <select
                      data-testid="compile-jms-target-phys"
                      value={selectedPhysIdx}
                      onChange={(e) => setSelectedPhysIdx(Number(e.target.value))}
                      style={{ flex: 1, minWidth: 0, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                    >
                      {physTags.map((t) => (
                        <option key={t.index} value={t.index}>
                          #{t.index} — {t.path}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step="10"
                      placeholder="Mass kg (e.g. 3200)..."
                      value={customPhysMass}
                      onChange={(e) => setCustomPhysMass(e.target.value)}
                      style={{ width: 145, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                    />
                    <button
                      data-testid="compile-jms-phys-btn"
                      onClick={handleCompileJmsPhysics}
                      disabled={isBusy || selectedPhysIdx < 0}
                      style={{ padding: '6px 10px', background: 'rgba(251,191,36,0.18)', border: '1px solid rgba(251,191,36,0.45)', color: '#fbbf24', fontWeight: 600, fontSize: 11, borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      Compile .JMS → phys
                    </button>
                    <button
                      data-testid="decompile-phys-jms-btn"
                      onClick={() => void handleDecompileTagToSource(selectedPhysIdx)}
                      disabled={isBusy || selectedPhysIdx < 0}
                      style={{ padding: '6px 10px', background: 'rgba(56,189,248,0.18)', border: '1px solid rgba(56,189,248,0.45)', color: '#38bdf8', fontWeight: 600, fontSize: 11, borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      Decompile phys → physics.jms
                    </button>
                  </div>

                  {/* Row C: gbxmodel -> .JMS Source Decompiler */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ width: 155, fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0 }}>
                      3. `mod2` → `.JMS`:
                    </span>
                    <select
                      data-testid="decompile-mod2-select"
                      value={selectedMod2DecompIdx}
                      onChange={(e) => setSelectedMod2DecompIdx(Number(e.target.value))}
                      style={{ flex: 1, minWidth: 0, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                    >
                      {mod2Tags.map((t) => (
                        <option key={t.index} value={t.index}>
                          #{t.index} [{t.primaryClassName}] {t.path}
                        </option>
                      ))}
                    </select>
                    <button
                      data-testid="decompile-mod2-jms-btn"
                      onClick={() => void handleDecompileTagToSource(selectedMod2DecompIdx)}
                      disabled={isBusy || selectedMod2DecompIdx < 0}
                      style={{ padding: '6px 12px', background: 'rgba(168,85,247,0.18)', border: '1px solid rgba(168,85,247,0.45)', color: '#c084fc', fontWeight: 600, fontSize: 11, borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      Decompile gbxmodel → .JMS (8200)...
                    </button>
                  </div>

                  {/* Row D: Direct .TXT / .HMT String Compiler (`ustr` / `hmt `) */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', paddingTop: 4, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <span style={{ width: 155, fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0, paddingTop: 6 }}>
                      4. `.TXT/.HMT` → Strings:
                    </span>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <select
                          data-testid="compile-strings-target-select"
                          value={selectedStringTagIdx}
                          onChange={(e) => setSelectedStringTagIdx(Number(e.target.value))}
                          style={{ flex: 1, minWidth: 0, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                        >
                          {stringTags.map((t) => (
                            <option key={t.index} value={t.index}>
                              #{t.index} [{t.primaryClassName}] {t.path}
                            </option>
                          ))}
                        </select>
                        <button
                          data-testid="compile-strings-inline-btn"
                          onClick={() => void handleCompileStringsTag(false)}
                          disabled={isBusy || selectedStringTagIdx < 0}
                          style={{ padding: '6px 10px', background: 'rgba(34,197,94,0.18)', border: '1px solid rgba(34,197,94,0.45)', color: '#4ade80', fontWeight: 600, fontSize: 11, borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                          Compile Textarea → Tag
                        </button>
                        <button
                          data-testid="compile-strings-file-btn"
                          onClick={() => void handleCompileStringsTag(true)}
                          disabled={isBusy || selectedStringTagIdx < 0}
                          style={{ padding: '6px 10px', background: 'rgba(56,189,248,0.18)', border: '1px solid rgba(56,189,248,0.45)', color: '#38bdf8', fontWeight: 600, fontSize: 11, borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                          Compile .TXT / .HMT File...
                        </button>
                      </div>
                      <textarea
                        data-testid="compile-strings-textarea"
                        value={stringSourceInput}
                        onChange={(e) => setStringSourceInput(e.target.value)}
                        placeholder="For unicode_string_list (ustr): one string per line or separate with ###END-STRING###. For hud_message_text (hmt ): key=value lines..."
                        style={{ height: 54, background: '#0d1117', color: '#e6edf3', border: '1px solid var(--border)', padding: 6, fontFamily: 'var(--mono-font)', fontSize: 11 }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 6: .font Tag Compiler/Inspector & .meter HUD Stencil Viewer */}
              <div style={{ padding: 14, background: 'var(--bg-panel-header)', border: '1px solid var(--border)', borderRadius: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: 4 }}>
                  `.font` (`font`) TrueType/System Font Compiler &amp; `.meter` (`metr`) HUD Stencil Viewer
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>
                  Inspect or rasterize any System/TrueType font directly into a Halo CE `font` tag (`characters`, `character tables`, and 8-bit `pixels`), and inspect `.meter` (`metr`) HUD shield/health/ammo stencils.
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                  <select
                    data-testid="font-inspector-select"
                    value={selectedFontIdx}
                    onChange={(e) => {
                      const idx = Number(e.target.value);
                      setSelectedFontIdx(idx);
                      void handleInspectFontTag(idx);
                    }}
                    style={{ flex: 1, minWidth: 220, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  >
                    {fontTags.map((t) => (
                      <option key={t.index} value={t.index}>
                        #{t.index} [font] {t.path}
                      </option>
                    ))}
                  </select>
                  <button
                    data-testid="inspect-font-btn"
                    onClick={() => void handleInspectFontTag(selectedFontIdx)}
                    disabled={isBusy || selectedFontIdx < 0}
                    style={{ padding: '6px 10px', background: 'rgba(56,189,248,0.18)', border: '1px solid rgba(56,189,248,0.45)', color: '#38bdf8', fontWeight: 600, fontSize: 11, borderRadius: 3, cursor: 'pointer' }}
                  >
                    Inspect Font Glyphs
                  </button>
                  <input
                    type="text"
                    value={ttfFontFamily}
                    onChange={(e) => setTtfFontFamily(e.target.value)}
                    placeholder="Font family (e.g. Conduit ITC, Segoe UI, Impact)..."
                    style={{ width: 165, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11 }}
                  />
                  <input
                    type="number"
                    min="8"
                    max="48"
                    value={ttfFontSizePx}
                    onChange={(e) => setTtfFontSizePx(Number(e.target.value) || 16)}
                    title="Font rasterization size in pixels"
                    style={{ width: 56, padding: '6px 6px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11 }}
                  />
                  <button
                    data-testid="compile-ttf-font-btn"
                    onClick={() => void handleCompileSystemFontToHaloFont()}
                    disabled={isBusy || selectedFontIdx < 0}
                    style={{ padding: '6px 10px', background: 'rgba(34,197,94,0.18)', border: '1px solid rgba(34,197,94,0.45)', color: '#4ade80', fontWeight: 600, fontSize: 11, borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Rasterize &amp; Compile → .font Tag
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <input
                    type="text"
                    value={fontPreviewText}
                    onChange={(e) => setFontPreviewText(e.target.value)}
                    placeholder="Type sample HUD or Cutscene Chapter Title text..."
                    style={{ flex: 1, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  />
                  <div
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: 'linear-gradient(90deg, rgba(8,14,26,0.92), rgba(15,23,42,0.92))',
                      border: '1px solid rgba(56,189,248,0.35)',
                      borderRadius: 3,
                      color: '#bae6fd',
                      textShadow: '1px 1px 2px rgba(0,0,0,0.95)',
                      fontFamily: `"${ttfFontFamily}", "Conduit ITC", "Eurostile", "Rajdhani", "Segoe UI", sans-serif`,
                      fontSize: fontInspectorSummary ? Math.max(12, Math.min(24, fontInspectorSummary.ascendingHeight + fontInspectorSummary.descendingHeight || 15)) : 15,
                      letterSpacing: fontInspectorSummary ? `${Math.max(0.5, fontInspectorSummary.leadingWidth * 0.5)}px` : '1px',
                      fontWeight: 700,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {fontPreviewText || 'SAMPLE HALO CE FONT PREVIEW'}
                  </div>
                </div>
                {fontInspectorSummary && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)', borderRadius: 3, padding: 8, marginBottom: 8 }}>
                    <div style={{ marginBottom: 4, color: '#93c5fd', fontWeight: 600 }}>
                      Metrics for `{fontInspectorSummary.tagPath}`: Total Glyphs = {fontInspectorSummary.characterCount} | Ascending = {fontInspectorSummary.ascendingHeight}px | Descending = {fontInspectorSummary.descendingHeight}px | Leading Height = {fontInspectorSummary.leadingHeight}px
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 72, overflowY: 'auto' }}>
                      {fontInspectorSummary.sampleGlyphs.map((g, idx) => (
                        <span
                          key={idx}
                          style={{
                            padding: '2px 5px',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: 2,
                            fontFamily: 'var(--mono-font)',
                            fontSize: 10,
                          }}
                          title={`UTF-16 ${g.character} | advance=${g.characterWidth}px | bitmap=${g.bitmapWidth}x${g.bitmapHeight}`}
                        >
                          <strong style={{ color: '#38bdf8' }}>{g.charStr}</strong> ({g.bitmapWidth}×{g.bitmapHeight})
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* .meter HUD Stencil & Gradient Viewer Row */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0 }}>
                    `.meter` (`metr`) Stencil:
                  </span>
                  <select
                    data-testid="meter-inspector-select"
                    value={selectedMeterIdx}
                    onChange={(e) => {
                      const idx = Number(e.target.value);
                      setSelectedMeterIdx(idx);
                      void handleInspectMeter(idx);
                    }}
                    style={{ flex: 1, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  >
                    {meterTags.map((t) => (
                      <option key={t.index} value={t.index}>
                        #{t.index} [meter] {t.path}
                      </option>
                    ))}
                  </select>
                  <button
                    data-testid="inspect-meter-btn"
                    onClick={() => void handleInspectMeter(selectedMeterIdx)}
                    disabled={isBusy || selectedMeterIdx < 0}
                    style={{ padding: '6px 10px', background: 'rgba(251,191,36,0.18)', border: '1px solid rgba(251,191,36,0.45)', color: '#fbbf24', fontWeight: 600, fontSize: 11, borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Inspect .meter Stencil
                  </button>
                  {meterSummary && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: 'rgba(0,0,0,0.35)', border: '1px solid var(--border)', borderRadius: 3 }}>
                      <canvas
                        ref={meterCanvasRef}
                        style={{ width: 96, height: 24, border: '1px solid rgba(56,189,248,0.4)', borderRadius: 2, imageRendering: 'pixelated' }}
                      />
                      <span style={{ fontSize: 10.5, color: 'var(--text-secondary)', fontFamily: 'var(--mono-font)' }}>
                        {meterSummary.width}×{meterSummary.height} | {meterSummary.emptyColorHex} → {meterSummary.fullColorHex} ({meterSummary.encodedBytes}B)
                      </span>
                    </div>
                  )}
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
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 12 }}>
                  Finds every reference to a tag across all tags in the map and swaps it to another tag (or Null) in a single atomic pass. Choose a Category first to narrow the item list.
                </div>

                {/* Stacked Vertical Layout: From Tag on top, Down Arrow in middle, To Tag below */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* Row 1: Find (From Tag) */}
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      padding: 10,
                      background: 'rgba(0,0,0,0.2)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                    }}
                  >
                    <span style={{ width: 95, fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0 }}>
                      1. Find Tag:
                    </span>
                    <select
                      data-testid="global-replace-from-category"
                      value={replaceFromCategory}
                      onChange={(e) => {
                        const cat = e.target.value;
                        setReplaceFromCategory(cat);
                        const first = (cat === 'ALL' ? allTags : allTags.filter((t) => t.primaryClassName === cat))[0];
                        if (first) setReplaceFromTagId(first.tagId);
                      }}
                      style={{
                        width: 210,
                        flexShrink: 0,
                        padding: '6px 8px',
                        background: 'var(--bg-input, #1e1e1e)',
                        border: '1px solid var(--border)',
                        color: 'var(--accent-cyan)',
                        fontWeight: 600,
                        fontSize: 11.5,
                      }}
                    >
                      <option value="ALL">All Categories ({allTags.length})</option>
                      {tagCategories.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat} ({allTags.filter((t) => t.primaryClassName === cat).length})
                        </option>
                      ))}
                    </select>
                    <select
                      data-testid="global-replace-from"
                      value={replaceFromTagId}
                      onChange={(e) => setReplaceFromTagId(Number(e.target.value))}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        padding: '6px 8px',
                        background: 'var(--bg-input, #1e1e1e)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                        fontSize: 11.5,
                      }}
                    >
                      {filteredReplaceFromTags.map((t) => (
                        <option key={t.tagId} value={t.tagId}>
                          [{t.primaryClassName}] {t.path}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Down Arrow Divider */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      color: 'var(--accent-cyan)',
                      fontSize: 14,
                      fontWeight: 700,
                      padding: '2px 0',
                    }}
                  >
                    <span>↓</span>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>
                      SWAP ALL REFERENCES TO
                    </span>
                    <span>↓</span>
                  </div>

                  {/* Row 2: Replace With (To Tag) */}
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      padding: 10,
                      background: 'rgba(0,0,0,0.2)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                    }}
                  >
                    <span style={{ width: 95, fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0 }}>
                      2. Replace With:
                    </span>
                    <select
                      data-testid="global-replace-to-category"
                      value={replaceToCategory}
                      onChange={(e) => {
                        const cat = e.target.value;
                        setReplaceToCategory(cat);
                        const first = (cat === 'ALL' ? allTags : allTags.filter((t) => t.primaryClassName === cat))[0];
                        if (first) setReplaceToTagId(first.tagId);
                      }}
                      style={{
                        width: 210,
                        flexShrink: 0,
                        padding: '6px 8px',
                        background: 'var(--bg-input, #1e1e1e)',
                        border: '1px solid var(--border)',
                        color: 'var(--accent-cyan)',
                        fontWeight: 600,
                        fontSize: 11.5,
                      }}
                    >
                      <option value="ALL">All Categories ({allTags.length})</option>
                      {tagCategories.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat} ({allTags.filter((t) => t.primaryClassName === cat).length})
                        </option>
                      ))}
                    </select>
                    <select
                      data-testid="global-replace-to"
                      value={replaceToTagId}
                      onChange={(e) => setReplaceToTagId(Number(e.target.value))}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        padding: '6px 8px',
                        background: 'var(--bg-input, #1e1e1e)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                        fontSize: 11.5,
                      }}
                    >
                      <option value={NULL_TAG_ID}>(None / Null Reference)</option>
                      {filteredReplaceToTags.map((t) => (
                        <option key={t.tagId} value={t.tagId}>
                          [{t.primaryClassName}] {t.path}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Action Button Row */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                    <button
                      data-testid="global-replace-btn"
                      onClick={handleGlobalReplace}
                      disabled={isBusy}
                      style={{
                        padding: '7px 18px',
                        background: 'rgba(56,189,248,0.2)',
                        border: '1px solid rgba(56,189,248,0.5)',
                        color: '#38bdf8',
                        fontWeight: 700,
                        fontSize: 12,
                        borderRadius: 3,
                        cursor: 'pointer',
                      }}
                    >
                      Replace All References Across Map
                    </button>
                  </div>
                </div>
              </div>

              {/* Global Tag Field Value Search & Batch Replace Across Entire Map */}
              <div style={{ padding: 14, background: 'var(--bg-panel-header)', border: '1px solid var(--border)', borderRadius: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: 4 }}>
                  Global Tag Field Value Search &amp; Batch Replace Across Entire Map
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>
                  Search any scalar, integer, enum, or string field name across all tags (or a specific tag class) and batch-update matching fields in one atomic pass (e.g. `bounding radius`, `render bounding radius`, `rate of fire`, `acceleration scale`).
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    data-testid="global-field-replace-category"
                    value={fieldReplaceCategory}
                    onChange={(e) => setFieldReplaceCategory(e.target.value)}
                    style={{
                      width: 190,
                      padding: '6px 8px',
                      background: 'var(--bg-input, #1e1e1e)',
                      border: '1px solid var(--border)',
                      color: 'var(--accent-cyan)',
                      fontWeight: 600,
                      fontSize: 11.5,
                    }}
                  >
                    <option value="ALL">All Tag Classes ({allTags.length})</option>
                    {tagCategories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat} ({allTags.filter((t) => t.primaryClassName === cat).length})
                      </option>
                    ))}
                  </select>
                  <input
                    data-testid="global-field-replace-query"
                    type="text"
                    placeholder="Field name (e.g. bounding radius)..."
                    value={fieldReplaceQuery}
                    onChange={(e) => setFieldReplaceQuery(e.target.value)}
                    style={{
                      flex: 1,
                      minWidth: 180,
                      padding: '6px 8px',
                      background: 'var(--bg-input, #1e1e1e)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                      fontSize: 11.5,
                    }}
                  />
                  <input
                    data-testid="global-field-replace-match"
                    type="text"
                    placeholder="Optional current value filter..."
                    value={fieldReplaceMatchVal}
                    onChange={(e) => setFieldReplaceMatchVal(e.target.value)}
                    style={{
                      width: 170,
                      padding: '6px 8px',
                      background: 'var(--bg-input, #1e1e1e)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                      fontSize: 11.5,
                    }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>→</span>
                  <input
                    data-testid="global-field-replace-new"
                    type="text"
                    placeholder="New value (e.g. 5.0)..."
                    value={fieldReplaceNewVal}
                    onChange={(e) => setFieldReplaceNewVal(e.target.value)}
                    style={{
                      width: 130,
                      padding: '6px 8px',
                      background: 'var(--bg-input, #1e1e1e)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                      fontSize: 11.5,
                    }}
                  />
                  <button
                    data-testid="global-field-replace-btn"
                    onClick={handleGlobalFieldReplace}
                    disabled={isBusy}
                    style={{
                      padding: '6px 14px',
                      background: 'rgba(168,85,247,0.2)',
                      border: '1px solid rgba(168,85,247,0.5)',
                      color: '#c084fc',
                      fontWeight: 700,
                      fontSize: 11.5,
                      borderRadius: 3,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Batch Replace Field Values
                  </button>
                </div>
                {fieldReplaceReport && fieldReplaceReport.length > 0 && (
                  <div
                    style={{
                      marginTop: 8,
                      maxHeight: 130,
                      overflowY: 'auto',
                      background: 'rgba(0,0,0,0.25)',
                      border: '1px solid var(--border)',
                      borderRadius: 3,
                      padding: 8,
                      fontSize: 10.5,
                      fontFamily: 'var(--mono-font)',
                      color: '#86efac',
                    }}
                  >
                    {fieldReplaceReport.map((item, i) => (
                      <div key={i}>
                        ✓ #{item.tagIndex} [{item.tagGroup}] {item.tagPath} — &ldquo;{item.fieldPath}&rdquo;: {String(item.oldValue)} → {String(item.newValue)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {tab === 'packager' && (
            <>
              {/* Card 1: OpenCE Mod Package & Forge Exporter (Category -> Item Selector + sample_mods Folder Layout + .ocetags) */}
              <div style={{ padding: 14, background: 'var(--bg-panel-header)', border: '1px solid var(--border)', borderRadius: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: 4 }}>
                  OpenCE Mod Package Exporter (`sample_mods/` Folder Structure & `.ocetags`)
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>
                  Select a <strong>Category</strong> first and then the <strong>Item</strong> inside that category. Export either as a complete OpenCE Mod Folder (`&lt;mod_name&gt;/mod.toml` + `&lt;mod_name&gt;/tags/&lt;tag_path&gt;.&lt;group&gt;` in 64-byte `'blam'` Big-Endian HEK loose tag format matching `sample_mods/`) or as a single-file `.ocetags` container.
                </div>

                {/* Step 1: Category -> Item Dropdowns */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    padding: 10,
                    background: 'rgba(0,0,0,0.22)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    marginBottom: 10,
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ width: 110, fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0 }}>
                      1. Mod Category:
                    </span>
                    <select
                      data-testid="export-forge-category-select"
                      value={forgeCategory}
                      onChange={(e) => {
                        const cat = e.target.value;
                        setForgeCategory(cat);
                        const matching = allTags.filter((t) => t.primaryClassName === cat);
                        if (matching[0]) {
                          setForgeTagIndex(matching[0].index);
                          const leaf = matching[0].path.split('\\').pop() || 'Custom Item';
                          setForgeItemName(leaf.replace(/[_-]+/g, ' '));
                          if (queuedModTagIndices.length === 0) {
                            setModName(leaf.replace(/[_-]+/g, ' '));
                          }
                        }
                      }}
                      style={{
                        flex: 1,
                        maxWidth: 480,
                        padding: '6px 8px',
                        background: 'var(--bg-input, #1e1e1e)',
                        border: '1px solid var(--border)',
                        color: 'var(--accent-cyan)',
                        fontWeight: 600,
                        fontSize: 11.5,
                      }}
                    >
                      {availableModCategories.map((cat) => (
                        <option key={cat.group} value={cat.group}>
                          {cat.label} ({allTags.filter((t) => t.primaryClassName === cat.group).length})
                        </option>
                      ))}
                    </select>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
                      <input
                        type="checkbox"
                        checked={includeModDeps}
                        onChange={(e) => setIncludeModDeps(e.target.checked)}
                      />
                      Also bundle recursive dependencies (off by default to match sample_mods/)
                    </label>
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ width: 110, fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0 }}>
                      2. Item in Category:
                    </span>
                    <select
                      data-testid="export-forge-ocetags-select"
                      value={forgeTagIndex}
                      onChange={(e) => {
                        const idx = Number(e.target.value);
                        setForgeTagIndex(idx);
                        const found = allTags.find((t) => t.index === idx);
                        if (found) {
                          const leaf = found.path.split('\\').pop() || 'Custom Item';
                          const clean = leaf.replace(/[_-]+/g, ' ');
                          setForgeItemName(clean);
                          if (queuedModTagIndices.length === 0) {
                            setModName(clean);
                          }
                        }
                      }}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        padding: '6px 8px',
                        background: 'var(--bg-input, #1e1e1e)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                        fontSize: 11.5,
                      }}
                    >
                      {filteredForgeTags.map((t) => (
                        <option key={t.index} value={t.index}>
                          [{t.primaryClassName}] {t.path}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      data-testid="add-mod-queue-tag-btn"
                      onClick={() => {
                        if (!queuedModTagIndices.includes(forgeTagIndex)) {
                          setQueuedModTagIndices((prev) => [...prev, forgeTagIndex]);
                        }
                      }}
                      style={{
                        padding: '6px 10px',
                        background: 'rgba(56,189,248,0.16)',
                        border: '1px solid rgba(56,189,248,0.45)',
                        color: '#38bdf8',
                        fontWeight: 700,
                        fontSize: 11,
                        borderRadius: 3,
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                      title="Add this item to the mod package list (useful when combining gbxmodel + bitmap + sound like Minecraft Steve or Female Spartan)"
                    >
                      + Add to Mod List
                    </button>
                  </div>

                  {/* Step 3: Vanilla Target Replacement Selector (auto-renames & exports ONLY exact needed files like Female Spartan) */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ width: 110, fontSize: 11.5, fontWeight: 700, color: '#4ade80', flexShrink: 0 }}>
                      3. Replaces Item:
                    </span>
                    <select
                      data-testid="export-mod-replace-target-select"
                      value={replaceTargetTagIndex}
                      onChange={(e) => setReplaceTargetTagIndex(Number(e.target.value))}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        padding: '6px 8px',
                        background: 'var(--bg-input, #1e1e1e)',
                        border: '1px solid rgba(74, 222, 128, 0.4)',
                        color: '#4ade80',
                        fontWeight: 600,
                        fontSize: 11.5,
                      }}
                    >
                      <option value={-1}>
                        Auto-Match Vanilla Target (e.g. Spartan / Biped → characters\cyborg\cyborg + bitmaps, or keep original path)
                      </option>
                      {vanillaReplacementCandidates.map((t) => (
                        <option key={t.index} value={t.index}>
                          Replace [{t.primaryClassName}] {t.path} (auto-rename .gbxmodel &amp; .bitmap files to match)
                        </option>
                      ))}
                    </select>
                  </div>

                  {queuedModTagIndices.length > 0 && (
                    <div
                      data-testid="queued-mod-tags-list"
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 6,
                        alignItems: 'center',
                        padding: '6px 8px',
                        background: 'rgba(15,23,42,0.55)',
                        border: '1px solid rgba(56,189,248,0.3)',
                        borderRadius: 3,
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#38bdf8' }}>
                        Mod Package Items ({queuedModTagIndices.length}):
                      </span>
                      {queuedModTagIndices.map((idx) => {
                        const t = allTags.find((item) => item.index === idx);
                        if (!t) return null;
                        return (
                          <span
                            key={idx}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              padding: '2px 7px',
                              background: 'rgba(56,189,248,0.14)',
                              border: '1px solid rgba(56,189,248,0.35)',
                              borderRadius: 3,
                              fontSize: 10.5,
                              fontFamily: 'var(--mono-font)',
                              color: '#e2e8f0',
                            }}
                          >
                            [{t.primaryClassName}] {t.path}
                            <button
                              type="button"
                              onClick={() => setQueuedModTagIndices((prev) => prev.filter((x) => x !== idx))}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#f87171',
                                fontWeight: 700,
                                cursor: 'pointer',
                                padding: 0,
                                fontSize: 11,
                              }}
                              title="Remove from Mod List"
                            >
                              ✕
                            </button>
                          </span>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setQueuedModTagIndices([])}
                        style={{
                          marginLeft: 'auto',
                          padding: '2px 6px',
                          background: 'rgba(239,68,68,0.16)',
                          border: '1px solid rgba(239,68,68,0.4)',
                          color: '#f87171',
                          fontSize: 10.5,
                          borderRadius: 3,
                          cursor: 'pointer',
                        }}
                      >
                        Clear List
                      </button>
                    </div>
                  )}
                </div>

                {/* Metadata & Export Buttons */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 180px 1fr', gap: 8, marginBottom: 10 }}>
                  <input
                    type="text"
                    placeholder="Mod / Item Name (e.g. Custom Banshee)"
                    value={modName}
                    onChange={(e) => {
                      setModName(e.target.value);
                      setForgeItemName(e.target.value);
                    }}
                    style={{ padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  />
                  <input
                    type="text"
                    placeholder="Version (1.0.0)"
                    value={modVersion}
                    onChange={(e) => setModVersion(e.target.value)}
                    style={{ padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  />
                  <input
                    type="text"
                    placeholder="Author"
                    value={modAuthor}
                    onChange={(e) => setModAuthor(e.target.value)}
                    style={{ padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  />
                  <input
                    type="text"
                    placeholder="Description"
                    value={modDesc}
                    onChange={(e) => setModDesc(e.target.value)}
                    style={{ padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button
                    data-testid="export-mod-toml-btn"
                    onClick={handleDownloadModToml}
                    style={{ padding: '6px 12px', background: 'rgba(148,163,184,0.14)', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 11.5, borderRadius: 3, cursor: 'pointer' }}
                  >
                    Download mod.toml Only
                  </button>
                  <button
                    data-testid="export-forge-ocetags-btn"
                    onClick={handleExportForgeOceTags}
                    disabled={isBusy}
                    style={{ padding: '6px 14px', background: 'rgba(56,189,248,0.18)', border: '1px solid rgba(56,189,248,0.45)', color: '#38bdf8', fontWeight: 700, fontSize: 11.5, borderRadius: 3, cursor: 'pointer' }}
                  >
                    Export Single-File Package (.ocetags)...
                  </button>
                  <button
                    data-testid="export-opence-mod-folder-btn"
                    onClick={handleExportOpenCeModFolder}
                    disabled={isBusy}
                    style={{ padding: '6px 14px', background: 'rgba(34,197,94,0.22)', border: '1px solid rgba(34,197,94,0.55)', color: '#4ade80', fontWeight: 700, fontSize: 11.5, borderRadius: 3, cursor: 'pointer' }}
                  >
                    Export OpenCE Mod Folder (mod.toml + tags/...)...
                  </button>
                </div>
              </div>

              {/* Card 2: Legacy Tag Importer (legacy_tags HEK 'blam' Loose Tags & HMT v3.5 .meta + .xml Extracts) */}
              <div style={{ padding: 14, background: 'var(--bg-panel-header)', border: '1px solid var(--border)', borderRadius: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: 4 }}>
                  Legacy Tag Importer (`legacy_tags` HEK Loose Tags & HMT `.meta` + `.xml` Extracts)
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>
                  Imports tags from Halo Editing Kit / OpenCE loose tag trees (64-byte `'blam'` Big-Endian headers such as `legacy_tags/` and `sample_mods/`) <strong>or</strong> HMT v3.5 extracted `.meta` + `.xml` + `.vertices`/`.indices` directories (such as `Bloodgulch Extract` and `B30 BSP Extract`) directly into the open map in-memory.
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-secondary)' }}>
                    Import Mode:
                    <select
                      data-testid="legacy-import-mode-select"
                      value={legacyInjectMode}
                      onChange={(e) => setLegacyInjectMode(e.target.value as 'add' | 'swap')}
                      style={{ padding: '5px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                    >
                      <option value="add">Add Mode (Add missing tags &amp; reuse existing)</option>
                      <option value="swap">Swap Mode (Overwrite matching tags in-place &amp; add missing)</option>
                    </select>
                  </label>
                  <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                    <button
                      data-testid="import-legacy-files-btn"
                      onClick={() => handleImportLegacyTags('file')}
                      disabled={isBusy}
                      style={{ padding: '6px 14px', background: 'rgba(56,189,248,0.2)', border: '1px solid rgba(56,189,248,0.5)', color: '#38bdf8', fontWeight: 700, fontSize: 11.5, borderRadius: 3, cursor: 'pointer' }}
                    >
                      Import Legacy Tag File(s)...
                    </button>
                    <button
                      data-testid="import-legacy-folder-btn"
                      onClick={() => handleImportLegacyTags('folder')}
                      disabled={isBusy}
                      style={{ padding: '6px 14px', background: 'rgba(251,191,36,0.2)', border: '1px solid rgba(251,191,36,0.5)', color: '#fbbf24', fontWeight: 700, fontSize: 11.5, borderRadius: 3, cursor: 'pointer' }}
                    >
                      Import Legacy Tag Folder...
                    </button>
                  </div>
                </div>

                {legacyImportReport && (
                  <div
                    data-testid="legacy-import-report"
                    style={{
                      marginTop: 10,
                      padding: 10,
                      background: 'rgba(0,0,0,0.25)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      fontSize: 11,
                      fontFamily: 'var(--mono-font)',
                      maxHeight: 150,
                      overflowY: 'auto',
                    }}
                  >
                    <div style={{ color: '#4ade80', fontWeight: 700, marginBottom: 4 }}>
                      ✓ Format: {legacyImportReport.formatDetected === 'hek_loose' ? "HEK / OpenCE 64-byte 'blam' Loose Tags" : 'HMT v3.5 .meta + .xml Extract'} — Added: {legacyImportReport.addedCount}, Swapped: {legacyImportReport.swappedCount}, Reused: {legacyImportReport.reusedCount}
                    </div>
                    {legacyImportReport.importedPaths.slice(0, 30).map((p, idx) => (
                      <div key={idx} style={{ color: 'var(--text-secondary)' }}>
                        • {p}
                      </div>
                    ))}
                    {legacyImportReport.importedPaths.length > 30 && (
                      <div style={{ color: 'var(--text-dim)' }}>
                        ...and {legacyImportReport.importedPaths.length - 30} more tag(s).
                      </div>
                    )}
                    {legacyImportReport.warnings.length > 0 && (
                      <div style={{ marginTop: 6, borderTop: '1px solid var(--border)', paddingTop: 4 }}>
                        {legacyImportReport.warnings.map((w, idx) => (
                          <div key={idx} style={{ color: '#fbbf24' }}>
                            ⚠ {w}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Card 3: Git XML Tag Exporter */}
              <div style={{ padding: 14, background: 'var(--bg-panel-header)', border: '1px solid var(--border)', borderRadius: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: 6 }}>
                  Git-Friendly XML Tag Exporter (`.xml`)
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    value={xmlCategory}
                    onChange={(e) => {
                      const cat = e.target.value;
                      setXmlCategory(cat);
                      const first = (cat === 'ALL' ? allTags : allTags.filter((t) => t.primaryClassName === cat))[0];
                      if (first) setXmlTagIndex(first.index);
                    }}
                    style={{
                      width: 210,
                      flexShrink: 0,
                      padding: '6px 8px',
                      background: 'var(--bg-input, #1e1e1e)',
                      border: '1px solid var(--border)',
                      color: 'var(--accent-cyan)',
                      fontWeight: 600,
                      fontSize: 11.5,
                    }}
                  >
                    <option value="ALL">All Categories ({allTags.length})</option>
                    {tagCategories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat} ({allTags.filter((t) => t.primaryClassName === cat).length})
                      </option>
                    ))}
                  </select>
                  <select
                    value={xmlTagIndex}
                    onChange={(e) => setXmlTagIndex(Number(e.target.value))}
                    style={{ flex: 1, minWidth: 0, padding: '6px 8px', background: 'var(--bg-input, #1e1e1e)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 11.5 }}
                  >
                    {filteredXmlTags.map((t) => (
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

              {/* Card 4: Steam Halo MCC Mod Package & ModManifest.txt Deployer */}
              <div
                data-testid="steam-mcc-deployer-card"
                style={{ padding: 14, background: 'var(--bg-panel-header)', border: '1px solid var(--border)', borderRadius: 4 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)' }}>
                    Steam Halo: MCC Mod Package &amp; `ModManifest.txt` One-Click Deployer
                  </div>
                  <button
                    data-testid="discover-steam-mcc-btn"
                    onClick={() => void handleDiscoverSteamMcc()}
                    disabled={isBusy}
                    style={{
                      padding: '4px 10px',
                      background: 'rgba(56,189,248,0.16)',
                      border: '1px solid rgba(56,189,248,0.45)',
                      color: '#38bdf8',
                      fontWeight: 600,
                      fontSize: 11,
                      borderRadius: 3,
                      cursor: 'pointer',
                    }}
                  >
                    Auto-Detect Steam MCC (`libraryfolders.vdf`)
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>
                  Packages the open map with MCC-compliant naming (`{packageMccMapName(modName)}`), writes `ModInfo.json` + `CampaignInfo.json`/`MultiplayerInfo.json`, and transactionally registers the mod root in `%LocalAppData%Low\MCC\Config\ModManifest.txt` (preserving UTF-8 / UTF-16LE BOM encoding).
                </div>

                {mccDiscovery && (
                  <div
                    data-testid="steam-mcc-discovery-status"
                    style={{
                      marginBottom: 10,
                      padding: '6px 10px',
                      background: 'rgba(0,0,0,0.25)',
                      border: '1px solid var(--border)',
                      borderRadius: 3,
                      fontSize: 11,
                      fontFamily: 'var(--mono-font)',
                    }}
                  >
                    <div>
                      <strong>Steam MCC Install:</strong>{' '}
                      <span style={{ color: mccDiscovery.mccInstallPaths.length > 0 ? '#4ade80' : '#fbbf24' }}>
                        {mccDiscovery.mccInstallPaths[0] ?? 'Not detected via Steam VDF (will prompt on deploy)'}
                      </span>
                    </div>
                    <div>
                      <strong>ModManifest.txt:</strong>{' '}
                      <span style={{ color: '#38bdf8' }}>{mccDiscovery.defaultModManifestPath}</span> (
                      {mccDiscovery.manifestExists ? 'Existing file found' : 'Will create on registration'})
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-secondary)' }}>
                    <input
                      type="checkbox"
                      checked={mccIsMultiplayer}
                      onChange={(e) => setMccIsMultiplayer(e.target.checked)}
                    />
                    Multiplayer Map (`MultiplayerInfo.json`)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-secondary)' }}>
                    <input
                      type="checkbox"
                      checked={mccRegisterManifest}
                      onChange={(e) => setMccRegisterManifest(e.target.checked)}
                    />
                    Register in `ModManifest.txt` (BOM-preserving transactional write)
                  </label>
                  <button
                    data-testid="deploy-mcc-mod-btn"
                    onClick={() => void handleDeployMccMod()}
                    disabled={isBusy}
                    style={{
                      marginLeft: 'auto',
                      padding: '6px 14px',
                      background: 'rgba(34,197,94,0.22)',
                      border: '1px solid rgba(34,197,94,0.55)',
                      color: '#4ade80',
                      fontWeight: 700,
                      fontSize: 11.5,
                      borderRadius: 3,
                      cursor: 'pointer',
                    }}
                  >
                    Deploy &amp; Register MCC Mod Package...
                  </button>
                </div>

                {mccDeployReport && (
                  <div
                    data-testid="mcc-deploy-report"
                    style={{
                      marginTop: 10,
                      padding: 10,
                      background: 'rgba(34,197,94,0.1)',
                      border: '1px solid rgba(34,197,94,0.4)',
                      borderRadius: 4,
                      fontSize: 11,
                      fontFamily: 'var(--mono-font)',
                      color: '#4ade80',
                    }}
                  >
                    <div>✓ Mod Root: {mccDeployReport.modFolderPath}</div>
                    <div>✓ Packaged Map: {mccDeployReport.mapOutputPath}</div>
                    {mccDeployReport.manifestRegistered && mccDeployReport.manifestPath && (
                      <div>✓ Registered in ModManifest.txt: {mccDeployReport.manifestPath}</div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
