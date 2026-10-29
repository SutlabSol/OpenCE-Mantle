import { useEffect, useState } from 'react';
import type { LoadMapResult, TagEntrySummary } from '../electron/shared-types';
import { isBackupFilePath } from '../electron/map-file-rules';
import { useOpenceEvents } from './hooks/useOpenceEvents';
import MenuBar from './components/MenuBar';
import Toolbar from './components/Toolbar';
import WelcomeDropZone from './components/WelcomeDropZone';
import CompressedBanner from './components/CompressedBanner';
import UnsupportedBanner from './components/UnsupportedBanner';
import TagBrowser from './components/TagBrowser';
import CenterWorkspace, { type CenterWorkspaceTab } from './components/CenterWorkspace';
import PropertiesPalette, { type PropertiesPaletteTab } from './components/PropertiesPalette';
import LogPanel from './components/LogPanel';
import StatusBar from './components/StatusBar';
import DependencyDialog from './components/DependencyDialog';
import ConfirmDialog from './components/ConfirmDialog';
import InjectDialog from './components/InjectDialog';
import SettingsDialog from './components/SettingsDialog';
import TagEditorDialog from './components/TagEditorDialog';
import BitmapEditorDialog from './components/BitmapEditorDialog';
import SoundAuditorDialog from './components/SoundAuditorDialog';
import HudPreviewerDialog from './components/HudPreviewerDialog';
import TagActionDialog, { type TagActionType } from './components/TagActionDialog';
import VerifyEmbeddedDataDialog from './components/VerifyEmbeddedDataDialog';
import ConvertDialog from './components/ConvertDialog';
import BatchExtractDialog from './components/BatchExtractDialog';
import ConfigureResourcesPromptDialog from './components/ConfigureResourcesPromptDialog';
import BspSwapperDialog from './components/BspSwapperDialog';
import OpenCeForgeExportDialog from './components/OpenCeForgeExportDialog';
import BuildObjectTagDialog from './components/BuildObjectTagDialog';
import ScriptEditorDialog from './components/ScriptEditorDialog';
import ModdingStudioDialog from './components/ModdingStudioDialog';
import MapCompareDialog from './components/MapCompareDialog';
import type {
  BatchExtractPreflightResult,
  HaloBitmapVersion,
  UpdateCheckResult,
  UpdateDownloadProgressEvent,
} from '../electron/shared-types';

/** Selections larger than this get a confirmation before walking dependencies (can be slow). */
const LARGE_SELECTION_CONFIRM_THRESHOLD = 200;

export default function App() {
  const [mapState, setMapState] = useState<LoadMapResult | null>(null);
  const [focusedTag, setFocusedTag] = useState<TagEntrySummary | null>(null);
  const [selectedTagIndices, setSelectedTagIndices] = useState<Set<number>>(new Set());
  const [extractSelection, setExtractSelection] = useState<number[] | null>(null);
  const [largeSelectionConfirm, setLargeSelectionConfirm] = useState<number[] | null>(null);
  const [injectDialogOpen, setInjectDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const [batchExtractPreflight, setBatchExtractPreflight] = useState<BatchExtractPreflightResult | null>(null);
  const [bspSwapperOpen, setBspSwapperOpen] = useState(false);
  const [forgeExportOpen, setForgeExportOpen] = useState(false);
  const [buildObjectTagOpen, setBuildObjectTagOpen] = useState(false);
  const [scriptEditorOpen, setScriptEditorOpen] = useState(false);
  const [moddingStudioOpen, setModdingStudioOpen] = useState(false);
  const [mapCompareOpen, setMapCompareOpen] = useState(false);
  /** Convert to Custom Edition: 'open' = the map in the unsupported banner, 'pick' = choose a file. */
  const [convertSource, setConvertSource] = useState<'open' | 'pick' | null>(null);
  /** Tag opened in the right-click "Tag Editor..." modal (or null = closed). */
  const [editingTag, setEditingTag] = useState<TagEntrySummary | null>(null);
  const [bitmapEditorTag, setBitmapEditorTag] = useState<TagEntrySummary | null>(null);
  const [soundAuditorTag, setSoundAuditorTag] = useState<TagEntrySummary | null>(null);
  const [hudPreviewerTag, setHudPreviewerTag] = useState<TagEntrySummary | null>(null);
  /** Properties palette active tab */
  const [propertiesPaletteTab, setPropertiesPaletteTab] = useState<PropertiesPaletteTab>('overview');
  /** Active center workspace tab */
  const [centerTab, setCenterTab] = useState<CenterWorkspaceTab>('overview');
  /** Milestone 9: Tag action modal (rename, duplicate, or delete) */
  const [tagAction, setTagAction] = useState<{ action: TagActionType; tag: TagEntrySummary } | null>(null);
  /** Prompt dialog when opening an edition without configured bitmaps/sounds */
  const [resourcePrompt, setResourcePrompt] = useState<{
    mapEdition: HaloBitmapVersion;
    mapScenarioName: string;
  } | null>(null);
  const [skippedPromptMapPaths, setSkippedPromptMapPaths] = useState<Set<string>>(new Set());
  const [updateBanner, setUpdateBanner] = useState<Extract<UpdateCheckResult, { ok: true }> | null>(null);
  const [updateDownloadProgress, setUpdateDownloadProgress] = useState<UpdateDownloadProgressEvent | null>(null);
  const { logs, log } = useOpenceEvents();
  const isMockActive = typeof window !== 'undefined' && Boolean((window as unknown as { __OPENCE_MOCK__?: boolean }).__OPENCE_MOCK__);

  const canExtract = mapState?.status === 'ok';
  const canInject = mapState?.status === 'ok';
  const canVerifyEmbeddedData = mapState?.status === 'ok';
  const canSaveAs = mapState?.status === 'ok';
  const isModified = mapState?.status === 'ok' && !!mapState.modified;
  // Save only with unsaved changes, and never for a map opened from a .bak (Save As only).
  const canSave = isModified && mapState?.status === 'ok' && !isBackupFilePath(mapState.filePath);
  const isWalkOrExtractRunning = extractSelection !== null || largeSelectionConfirm !== null;

  const requestExtract = (indices: number[]) => {
    if (!canExtract || isWalkOrExtractRunning || indices.length === 0) return;
    log('info', `Extract requested: ${indices.length} tag(s) selected.`);
    if (indices.length > LARGE_SELECTION_CONFIRM_THRESHOLD) {
      setLargeSelectionConfirm(indices);
      return;
    }
    setExtractSelection(indices);
  };

  const resetSelectionState = () => {
    setFocusedTag(null);
    setSelectedTagIndices(new Set());
    setExtractSelection(null);
    setLargeSelectionConfirm(null);
    setEditingTag(null);
    setTagAction(null);
  };

  const handleBatchExtract = async () => {
    if (!canExtract) return;
    const preflight = await window.opence.batchExtractPreflight();
    if (preflight) {
      setBatchExtractPreflight(preflight);
    }
  };

  const handleManualCheckForUpdates = async () => {
    if (typeof window.opence.checkForUpdates !== 'function') return;
    log('info', 'Checking GitHub Releases for updates...');
    const res = await window.opence.checkForUpdates();
    if (!res.ok) {
      log('warn', `Update check failed: ${res.error}`);
      setSettingsDialogOpen(true);
      return;
    }
    if (res.updateAvailable) {
      setUpdateBanner(res);
      log('info', `New release available: ${res.releaseName} (v${res.latestVersion})!`);
    } else {
      log('info', `OpenCE Mantle is up to date (v${res.currentVersion}).`);
      setSettingsDialogOpen(true);
    }
  };

  const handleDownloadAndInstallUpdate = async (autoRestart: boolean) => {
    if (typeof window.opence.downloadUpdate !== 'function') return;
    const dlRes = await window.opence.downloadUpdate({
      mode: 'auto',
      version: updateBanner?.latestVersion,
    });
    if (dlRes.ok && autoRestart && typeof window.opence.applyUpdateAndRestart === 'function') {
      await window.opence.applyUpdateAndRestart(dlRes.downloadedFilePath, dlRes.installMode);
    }
  };

  const handleApplyReadyUpdate = async () => {
    if (typeof window.opence.applyUpdateAndRestart !== 'function') return;
    await window.opence.applyUpdateAndRestart(
      updateDownloadProgress?.downloadedFilePath,
      updateDownloadProgress?.installMode,
    );
  };

  useEffect(() => {
    if (typeof window.opence.onUpdateDownloadProgress !== 'function') return;
    return window.opence.onUpdateDownloadProgress((evt) => {
      setUpdateDownloadProgress(evt);
    });
  }, []);

  // Automatic startup update check (honors Settings > General > Check for updates on launch)
  useEffect(() => {
    if (typeof window.opence.checkForUpdates !== 'function') return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const settings = window.opence.getSettings ? await window.opence.getSettings() : null;
        if (cancelled) return;
        if (settings && settings.checkForUpdatesOnLaunch === false) {
          return;
        }
        const res = await window.opence.checkForUpdates!();
        if (cancelled || !res.ok) return;
        if (res.updateAvailable && res.latestVersion !== settings?.skippedUpdateVersion) {
          setUpdateBanner(res);
          if (settings?.autoDownloadUpdates && typeof window.opence.downloadUpdate === 'function') {
            void window.opence.downloadUpdate({ mode: 'auto', version: res.latestVersion });
          }
        }
      } catch {
        // Silent failure on startup background check
      }
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const offMenu = window.opence.onMenuAction((action) => {
      if (action === 'extract-tags') requestExtract(Array.from(selectedTagIndices));
      else if (action === 'extract-whole-map') void handleBatchExtract();
      else if (action === 'inject-tags') setInjectDialogOpen(true);
      else if (action === 'verify-embedded-data') setVerifyDialogOpen(true);
      else if (action === 'swap-bsp') setBspSwapperOpen(true);
      else if (action === 'extract-to-forge') setForgeExportOpen(true);
      else if (action === 'build-object-tag') setBuildObjectTagOpen(true);
      else if (action === 'compare-maps') setMapCompareOpen(true);
      else if (action === 'settings') setSettingsDialogOpen(true);
      else if (action === 'check-for-updates') void handleManualCheckForUpdates();
      else if (action === 'convert-map') setConvertSource('pick');
      else if (action.startsWith('identify-bitmaps:')) {
        setSettingsDialogOpen(true);
      } else if (action.endsWith('-stub')) log('warn', `${action.replace('-stub', '')} is coming in a later milestone.`);
    });
    const offLoaded = window.opence.onMapLoaded((result) => {
      setMapState(result);
      resetSelectionState();
    });
    // Same map, changed in place (Inject applied, saved): refresh the tag list and info panel, keep the selection.
    const offUpdated = window.opence.onMapUpdated((result) => setMapState(result));
    return () => {
      offMenu();
      offLoaded();
      offUpdated();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTagIndices, canExtract, isWalkOrExtractRunning]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        requestExtract(Array.from(selectedTagIndices));
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (e.shiftKey) void handleSaveAs();
        else void handleSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTagIndices, canExtract, isWalkOrExtractRunning, canSave, canSaveAs]);

  useEffect(() => {
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const path = window.opence.getPathForFile(file);
      log('info', `Dropped: ${path}`);
      const result = await window.opence.loadMap(path);
      if (!result) return; // cancelled in the unsaved-changes prompt
      setMapState(result);
      resetSelectionState();
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  useEffect(() => {
    if (!mapState || mapState.status !== 'ok') return;
    if (typeof window.opence.getVersionSettings !== 'function') return;
    const edition: HaloBitmapVersion = mapState.header.mapEdition || 'ce';
    if (edition === 'xbox') return;
    const filePath = mapState.filePath;
    if (skippedPromptMapPaths.has(filePath)) return;

    let cancelled = false;
    Promise.all([
      window.opence.getVersionSettings(),
      window.opence.getSettings ? window.opence.getSettings() : Promise.resolve(null),
    ])
      .then(([verSettings, settings]) => {
        if (cancelled) return;
        const verResource = verSettings?.[edition];
        const hasBitmaps = Boolean(verResource?.bitmaps || settings?.resourceMaps?.bitmaps);
        const hasSounds = Boolean(verResource?.sounds || settings?.resourceMaps?.sounds);
        if (!hasBitmaps && !hasSounds) {
          setResourcePrompt({
            mapEdition: edition,
            mapScenarioName: mapState.header.scenarioName || 'Map',
          });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [mapState, skippedPromptMapPaths]);

  const handleSkipResourcePrompt = () => {
    if (mapState?.status === 'ok') {
      setSkippedPromptMapPaths((prev) => new Set([...prev, mapState.filePath]));
    }
    setResourcePrompt(null);
  };

  const handleSavedResourcePrompt = () => {
    if (mapState?.status === 'ok') {
      setSkippedPromptMapPaths((prev) => new Set([...prev, mapState.filePath]));
    }
    setResourcePrompt(null);
    log('info', `Resource maps configured for ${resourcePrompt?.mapEdition ?? 'map'}.`);
  };

  const handleOpen = async () => {
    const result = await window.opence.openMapDialog();
    if (result) {
      setMapState(result);
      resetSelectionState();
    }
  };

  const handleDecompress = async () => {
    if (!mapState || mapState.status === 'error') return;
    const result = await window.opence.decompressMap(mapState.filePath);
    if (result) log('info', `Saved decompressed map to ${result.outputPath}`);
  };

  // Main logs the outcome (map name, CRC32, warnings) and sends the updated map; the renderer only triggers it.
  const handleSave = async () => {
    if (!canSave) return;
    await window.opence.saveMap();
  };

  const handleSaveAs = async () => {
    if (!canSaveAs) return;
    await window.opence.saveMapAs();
  };

  const handleDiscard = async () => {
    if (!isModified) return;
    const result = await window.opence.discardChanges();
    if (result?.ok) {
      setMapState(result.map);
      resetSelectionState();
    }
  };

  let extractDisabledReason: string | null = null;
  if (!canExtract) extractDisabledReason = 'Open (and decompress, if needed) a map first.';
  else if (isWalkOrExtractRunning) extractDisabledReason = 'A dependency walk or extraction is already running.';
  else if (selectedTagIndices.size === 0) extractDisabledReason = 'Select at least one tag first.';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {isMockActive && (
        <div data-testid="mock-data-banner" style={{ background: 'var(--warn-bg)', color: 'var(--warn-text)', textAlign: 'center', fontSize: 11, padding: '2px 0', fontWeight: 600 }}>
          MOCK DATA — dev preview only, not connected to a real map
        </div>
      )}
      <MenuBar
        menus={[
          {
            label: 'File',
            items: [
              { label: 'Open Map...', onClick: handleOpen },
              { label: 'Save', onClick: handleSave, disabled: !canSave },
              { label: 'Save As...', onClick: handleSaveAs, disabled: !canSaveAs },
              { label: 'Discard Changes...', onClick: handleDiscard, disabled: !isModified },
              { label: 'Convert to Custom Edition...', onClick: () => setConvertSource('pick') },
              { label: 'Exit', onClick: () => window.close() },
            ],
          },
          {
            label: 'Tools',
            items: [
              { label: 'Extract to OpenCE Forge...', onClick: () => setForgeExportOpen(true), disabled: !canExtract },
              { label: 'Build New Object Tag...', onClick: () => setBuildObjectTagOpen(true) },
              { label: 'HaloScript (.hsc) IDE & Sample Scripts...', onClick: () => setScriptEditorOpen(true), disabled: !canExtract },
              { label: 'Universal Converter, Scanner & Mod Studio...', onClick: () => setModdingStudioOpen(true), disabled: !canExtract },
              { label: 'Compare With Another .map File...', onClick: () => setMapCompareOpen(true), disabled: !canExtract },
              { label: 'Verify Embedded Data...', onClick: () => setVerifyDialogOpen(true), disabled: !canVerifyEmbeddedData },
              { label: 'Swap BSP...', onClick: () => setBspSwapperOpen(true), disabled: !canExtract },
              { label: '', separator: true },
              { label: 'Settings...', onClick: () => setSettingsDialogOpen(true) },
            ],
          },
          {
            label: 'Help',
            items: [
              { label: 'Check for Updates...', onClick: () => void handleManualCheckForUpdates() },
              { label: '', separator: true },
              { label: 'About', onClick: () => window.opence.showAbout() },
            ],
          },
        ]}
      />
      <Toolbar
        onOpen={handleOpen}
        canExtract={canExtract}
        canExtractWholeMap={canExtract}
        canInject={canInject}
        onExtract={() => requestExtract(Array.from(selectedTagIndices))}
        onExtractWholeMap={() => void handleBatchExtract()}
        onInject={() => setInjectDialogOpen(true)}
      />

      {updateBanner && (
        <div
          data-testid="update-available-banner"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '7px 14px',
            background:
              updateDownloadProgress?.stage === 'ready'
                ? 'linear-gradient(90deg, rgba(74, 222, 128, 0.18), rgba(16, 185, 129, 0.08))'
                : 'linear-gradient(90deg, rgba(0, 194, 255, 0.16), rgba(56, 189, 248, 0.08))',
            borderBottom: `1px solid ${
              updateDownloadProgress?.stage === 'ready' ? 'rgba(74, 222, 128, 0.4)' : 'rgba(0, 194, 255, 0.35)'
            }`,
            fontSize: 12,
            color: 'var(--text-primary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
            <span
              style={{
                background: updateDownloadProgress?.stage === 'ready' ? '#4ade80' : 'var(--accent-cyan)',
                color: '#06202c',
                fontWeight: 700,
                fontSize: 10.5,
                padding: '2px 7px',
                borderRadius: 3,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              {updateDownloadProgress?.stage === 'ready'
                ? 'Update Ready'
                : updateDownloadProgress?.stage === 'downloading'
                  ? `Downloading ${updateDownloadProgress.percent}%`
                  : 'Update Available'}
            </span>

            {updateDownloadProgress?.stage === 'downloading' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, maxWidth: 520 }}>
                <div
                  style={{
                    flex: 1,
                    height: 7,
                    background: 'rgba(0,0,0,0.45)',
                    borderRadius: 4,
                    overflow: 'hidden',
                    border: '1px solid rgba(0, 194, 255, 0.3)',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max(3, updateDownloadProgress.percent)}%`,
                      height: '100%',
                      background: 'var(--accent-cyan)',
                      transition: 'width 0.12s linear',
                    }}
                  />
                </div>
                <span style={{ fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                  {(updateDownloadProgress.transferredBytes / (1024 * 1024)).toFixed(1)}
                  {updateDownloadProgress.totalBytes > 0
                    ? ` / ${(updateDownloadProgress.totalBytes / (1024 * 1024)).toFixed(1)} MB`
                    : ' MB'}{' '}
                  ({(updateDownloadProgress.bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s)
                </span>
              </div>
            ) : updateDownloadProgress?.stage === 'ready' ? (
              <span>
                <strong>{updateBanner.releaseName}</strong> (v{updateBanner.latestVersion}) has been downloaded and verified. Click{' '}
                <strong>Restart & Apply Update</strong> to install!
              </span>
            ) : (
              <span>
                <strong>{updateBanner.releaseName}</strong> (v{updateBanner.latestVersion}) is now available!{' '}
                <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                  (Current: v{updateBanner.currentVersion})
                </span>
                {updateDownloadProgress?.stage === 'error' && (
                  <span style={{ color: '#f87171', marginLeft: 8, fontSize: 11 }}>
                    (Download error: {updateDownloadProgress.error})
                  </span>
                )}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {updateDownloadProgress?.stage === 'ready' ? (
              <button
                data-testid="update-banner-restart-apply"
                onClick={() => void handleApplyReadyUpdate()}
                style={{
                  background: '#4ade80',
                  color: '#052e16',
                  border: 'none',
                  borderRadius: 3,
                  padding: '4px 12px',
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                🚀 Restart & Apply Update
              </button>
            ) : updateDownloadProgress?.stage === 'downloading' ? (
              <span style={{ fontSize: 11, color: 'var(--accent-cyan)', fontWeight: 600 }}>
                Staging {updateDownloadProgress.assetName}...
              </span>
            ) : (
              <>
                {(updateBanner.installerAsset || updateBanner.portableAsset) && (
                  <>
                    <button
                      data-testid="update-banner-install-now"
                      onClick={() => void handleDownloadAndInstallUpdate(true)}
                      style={{
                        background: 'var(--accent-cyan)',
                        color: '#06202c',
                        border: 'none',
                        borderRadius: 3,
                        padding: '4px 11px',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                      title="Download update in-app and automatically restart into the new version"
                    >
                      ⚡ Update & Restart Now
                    </button>
                    <button
                      data-testid="update-banner-stage-bg"
                      onClick={() => void handleDownloadAndInstallUpdate(false)}
                      style={{
                        background: 'rgba(255,255,255,0.08)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border)',
                        borderRadius: 3,
                        padding: '4px 10px',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                      title="Download in the background while you keep working, then restart whenever you're ready"
                    >
                      Download in Background
                    </button>
                  </>
                )}
              </>
            )}
            <button
              data-testid="update-banner-view-github"
              onClick={() => void window.opence.openExternalUrl?.(updateBanner.htmlUrl)}
              style={{
                background: 'rgba(255,255,255,0.08)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 3,
                padding: '4px 10px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Release Notes ↗
            </button>
            <button
              data-testid="update-banner-skip-version"
              onClick={() => {
                void window.opence.setSkippedUpdateVersion?.(updateBanner.latestVersion);
                setUpdateBanner(null);
              }}
              style={{
                background: 'transparent',
                color: 'var(--text-dim)',
                border: 'none',
                fontSize: 11,
                cursor: 'pointer',
                padding: '2px 6px',
              }}
              title="Don't remind me again for this specific version"
            >
              Skip v{updateBanner.latestVersion}
            </button>
            <button
              data-testid="update-banner-dismiss"
              onClick={() => setUpdateBanner(null)}
              style={{
                background: 'transparent',
                color: 'var(--text-dim)',
                border: 'none',
                fontSize: 15,
                lineHeight: 1,
                cursor: 'pointer',
                padding: '2px 6px',
              }}
              title="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {mapState?.status === 'compressed' && <CompressedBanner onDecompress={handleDecompress} />}
      {mapState?.status === 'unsupported' && <UnsupportedBanner message={mapState.message} onConvert={mapState.convertible ? () => setConvertSource('open') : undefined} />}
      {mapState?.status === 'error' && <UnsupportedBanner message={mapState.message} />}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {mapState?.status === 'ok' ? (
          <>
            <TagBrowser
              tags={mapState.tags}
              focusedTag={focusedTag}
              onFocusTag={setFocusedTag}
              selected={selectedTagIndices}
              onSelectedChange={setSelectedTagIndices}
              onExtractRequested={requestExtract}
              extractDisabledReason={extractDisabledReason}
              onExtractWholeMap={handleBatchExtract}
              canExtractWholeMap={canExtract}
              onEditTag={setEditingTag}
              onFindReferences={(tag) => {
                setFocusedTag(tag);
                setSelectedTagIndices(new Set([tag.index]));
                setPropertiesPaletteTab('references');
              }}
              onRenameTag={(tag) => setTagAction({ action: 'rename', tag })}
              onDuplicateTag={(tag) => setTagAction({ action: 'duplicate', tag })}
              onDeleteTag={(tag) => setTagAction({ action: 'delete', tag })}
              onOpenBitmapEditor={setBitmapEditorTag}
              onOpenSoundAuditor={setSoundAuditorTag}
              onOpenHudPreviewer={setHudPreviewerTag}
            />
            <CenterWorkspace
              header={mapState.header}
              allTags={mapState.tags}
              onActiveTabChange={setCenterTab}
              onSelectObjectTag={(tagId, objectPath) => {
                if (mapState?.status !== 'ok') return;
                const target =
                  mapState.tags.find((t) => t.tagId === tagId) ??
                  mapState.tags.find((t) => (t.tagId & 0xffff) === (tagId & 0xffff)) ??
                  (objectPath
                    ? mapState.tags.find((t) => t.path.toLowerCase() === objectPath.toLowerCase())
                    : undefined);
                if (target) {
                  setFocusedTag(target);
                  setSelectedTagIndices(new Set([target.index]));
                }
              }}
              onOpenTagEditor={(tagIndexOrPath) => {
                if (mapState?.status !== 'ok') return;
                const target =
                  typeof tagIndexOrPath === 'number'
                    ? (mapState.tags.find((t) => t.index === tagIndexOrPath) ?? mapState.tags[tagIndexOrPath])
                    : mapState.tags.find(
                        (t) =>
                          t.path.toLowerCase() === tagIndexOrPath.toLowerCase() ||
                          t.path.toLowerCase().endsWith(tagIndexOrPath.toLowerCase()),
                      );
                if (target) {
                  setFocusedTag(target);
                  setSelectedTagIndices(new Set([target.index]));
                  setEditingTag(target);
                }
              }}
            />
            {centerTab !== 'bitmap-3d' && centerTab !== 'bsp-model-studio' && (
              <PropertiesPalette
                focusedTag={focusedTag}
                allTags={mapState.tags}
                activeTab={propertiesPaletteTab}
                onTabChange={setPropertiesPaletteTab}
                onSelectTag={(idx) => {
                  const t = mapState.tags.find((tag) => tag.index === idx) ?? mapState.tags[idx];
                  if (t) {
                    setFocusedTag(t);
                    setSelectedTagIndices(new Set([t.index]));
                  }
                }}
              />
            )}
          </>
        ) : (
          <WelcomeDropZone onOpen={handleOpen} />
        )}
      </div>

      <LogPanel logs={logs} />
      <StatusBar mapState={mapState} />

      {extractSelection && <DependencyDialog selectedIndices={extractSelection} onClose={() => setExtractSelection(null)} log={log} />}
      {injectDialogOpen && <InjectDialog onClose={() => setInjectDialogOpen(false)} log={log} />}
      {settingsDialogOpen && <SettingsDialog onClose={() => setSettingsDialogOpen(false)} />}
      {verifyDialogOpen && <VerifyEmbeddedDataDialog onClose={() => setVerifyDialogOpen(false)} log={log} />}
      {convertSource && <ConvertDialog source={convertSource} onClose={() => setConvertSource(null)} log={log} />}
            {resourcePrompt && (
        <ConfigureResourcesPromptDialog
          isOpen={true}
          mapEdition={resourcePrompt.mapEdition}
          mapScenarioName={resourcePrompt.mapScenarioName}
          onClose={handleSkipResourcePrompt}
          onSaved={handleSavedResourcePrompt}
        />
      )}
      {batchExtractPreflight && (
        <BatchExtractDialog
          open={!!batchExtractPreflight}
          preflight={batchExtractPreflight}
          onClose={() => setBatchExtractPreflight(null)}
        />
      )}

      {editingTag && mapState?.status === 'ok' && (
        <TagEditorDialog
          tag={editingTag}
          allTags={mapState.tags}
          onClose={() => setEditingTag(null)}
          onOpenBitmapEditor={setBitmapEditorTag}
          onOpenSoundAuditor={setSoundAuditorTag}
          onOpenHudPreviewer={setHudPreviewerTag}
        />
      )}

      {bitmapEditorTag && mapState?.status === 'ok' && (
        <BitmapEditorDialog tag={bitmapEditorTag} onClose={() => setBitmapEditorTag(null)} />
      )}

      {soundAuditorTag && mapState?.status === 'ok' && (
        <SoundAuditorDialog tag={soundAuditorTag} onClose={() => setSoundAuditorTag(null)} />
      )}

      {hudPreviewerTag && mapState?.status === 'ok' && (
        <HudPreviewerDialog tag={hudPreviewerTag} onClose={() => setHudPreviewerTag(null)} />
      )}

      {tagAction && mapState?.status === 'ok' && (
        <TagActionDialog
          action={tagAction.action}
          tag={tagAction.tag}
          onClose={() => setTagAction(null)}
          onSuccess={(newIdx) => {
            const wasDelete = tagAction.action === 'delete';
            const deletedIdx = tagAction.tag.index;
            setTagAction(null);
            window.dispatchEvent(new CustomEvent('opence:scenario-updated'));
            if (wasDelete) {
              if (focusedTag?.index === deletedIdx) {
                setFocusedTag(null);
              }
              setSelectedTagIndices((prev) => {
                const next = new Set(prev);
                next.delete(deletedIdx);
                return next;
              });
              return;
            }
            if (typeof newIdx === 'number') {
              const found = mapState.tags.find((t) => t.index === newIdx) ?? mapState.tags[newIdx];
              if (found) {
                setFocusedTag(found);
                setSelectedTagIndices(new Set([found.index]));
              }
            }
          }}
        />
      )}

      {bspSwapperOpen && (
        <BspSwapperDialog
          isOpen={bspSwapperOpen}
          onClose={() => setBspSwapperOpen(false)}
          onSuccess={() => {
            // BSP swapped in-memory
          }}
        />
      )}

      {forgeExportOpen && mapState?.status === 'ok' && (
        <OpenCeForgeExportDialog
          open={forgeExportOpen}
          onClose={() => setForgeExportOpen(false)}
          allTags={mapState.tags}
          initiallySelectedIndices={Array.from(selectedTagIndices)}
          log={log}
        />
      )}

      {buildObjectTagOpen && (
        <BuildObjectTagDialog
          open={buildObjectTagOpen}
          onClose={() => setBuildObjectTagOpen(false)}
          allTags={mapState?.status === 'ok' ? mapState.tags : []}
          canInjectIntoOpenMap={mapState?.status === 'ok'}
          onSelectInjectedTag={(newTagPath, newGroup, updatedMap) => {
            if (updatedMap) {
              setMapState(updatedMap);
            }
            const tagsList: TagEntrySummary[] =
              updatedMap && updatedMap.status === 'ok'
                ? updatedMap.tags
                : mapState?.status === 'ok'
                  ? mapState.tags
                  : [];
            const found = tagsList.find(
              (t: TagEntrySummary) =>
                t.primaryClassName === newGroup &&
                t.path.toLowerCase() === newTagPath.toLowerCase(),
            );
            if (found) {
              setFocusedTag(found);
              setSelectedTagIndices(new Set([found.index]));
              setPropertiesPaletteTab('overview');
            }
          }}
        />
      )}

      {scriptEditorOpen && mapState?.status === 'ok' && (
        <ScriptEditorDialog
          onClose={() => setScriptEditorOpen(false)}
          onMapModified={() => {
            setMapState((prev) => (prev && prev.status === 'ok' ? { ...prev, modified: true } : prev));
          }}
        />
      )}

      {moddingStudioOpen && mapState?.status === 'ok' && (
        <ModdingStudioDialog
          allTags={mapState.tags}
          onClose={() => setModdingStudioOpen(false)}
          onTagsUpdated={(newTags) => {
            setMapState((prev) => (prev && prev.status === 'ok' ? { ...prev, tags: newTags, modified: true } : prev));
          }}
        />
      )}

      {mapCompareOpen && mapState?.status === 'ok' && (
        <MapCompareDialog
          onClose={() => setMapCompareOpen(false)}
          onSelectLeftTag={(tagIdx) => {
            const found = mapState.tags.find((t) => t.index === tagIdx) ?? mapState.tags[tagIdx];
            if (found) {
              setFocusedTag(found);
              setSelectedTagIndices(new Set([found.index]));
            }
          }}
        />
      )}

      {largeSelectionConfirm && (
        <ConfirmDialog
          testId="large-selection-confirm-dialog"
          title="Large selection"
          message={`You're about to walk dependencies for ${largeSelectionConfirm.length} tags - this may take a moment. Continue?`}
          onEscape={() => setLargeSelectionConfirm(null)}
          buttons={[
            {
              label: 'Continue',
              variant: 'primary',
              testId: 'large-selection-confirm-continue',
              onClick: () => {
                const indices = largeSelectionConfirm;
                setLargeSelectionConfirm(null);
                setExtractSelection(indices);
              },
            },
            { label: 'Cancel', autoFocus: true, testId: 'large-selection-confirm-cancel', onClick: () => setLargeSelectionConfirm(null) },
          ]}
        />
      )}
    </div>
  );
}
