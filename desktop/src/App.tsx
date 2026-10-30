import { useEffect, useState } from 'react';
import type { LoadMapResult, TagEntrySummary } from '../electron/shared-types';
import { isBackupFilePath } from '../electron/map-file-rules';
import { useOpenceEvents } from './hooks/useOpenceEvents';
import MenuBar from './components/MenuBar';
import Toolbar from './components/Toolbar';
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
import { LiveHudEditorDialog } from './components/LiveHudEditorDialog';
import { HudBitmapInjectorDialog } from './components/HudBitmapInjectorDialog';
import { UiMapStudioDialog } from './components/UiMapStudioDialog';
import BaboonStudioDialog, { type BaboonStudioTab } from './components/BaboonStudioDialog';
import WorkspaceHome from './components/WorkspaceHome';
import BottomMapTabBar from './components/BottomMapTabBar';
import SplitComparePane from './components/SplitComparePane';
import ThemeSelectorModal from './components/ThemeSelectorModal';
import WhatsNewModal from './components/WhatsNewModal';
import HelpAboutModal from './components/HelpAboutModal';
import TutorialsHubModal from './components/TutorialsHubModal';
import GlossaryModal from './components/GlossaryModal';
import CommunityModal from './components/CommunityModal';
import type {
  AppThemeId,
  BatchExtractPreflightResult,
  HaloBitmapVersion,
  OpenMapTabSession,
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
  const [liveHudEditorOpen, setLiveHudEditorOpen] = useState(false);
  const [hudBitmapInjectorOpen, setHudBitmapInjectorOpen] = useState(false);
  const [hudBitmapInjectorInitial, setHudBitmapInjectorInitial] = useState<{
    category?: 'weapon' | 'vehicle' | 'general';
    targetTagIndex?: number;
    hudTagIndex?: number;
    elementId?: string;
  } | null>(null);
  const [uiMapStudioOpen, setUiMapStudioOpen] = useState(false);
  const [baboonStudioOpen, setBaboonStudioOpen] = useState(false);
  const [baboonStudioTab, setBaboonStudioTab] = useState<BaboonStudioTab>('content-explorer');
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
  const [appVersion, setAppVersion] = useState<string>('0.7.0');
  const [currentTheme, setCurrentTheme] = useState<AppThemeId>('dark');
  const [showLauncherHome, setShowLauncherHome] = useState<boolean>(true);
  const [themeModalOpen, setThemeModalOpen] = useState(false);
  const [whatsNewModalOpen, setWhatsNewModalOpen] = useState(false);
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const [tutorialsModalOpen, setTutorialsModalOpen] = useState(false);
  const [glossaryModalOpen, setGlossaryModalOpen] = useState(false);
  const [communityModalOpen, setCommunityModalOpen] = useState(false);
  const [openSessions, setOpenSessions] = useState<OpenMapTabSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [secondarySessionId, setSecondarySessionId] = useState<string | null>(null);
  const [splitViewEnabled, setSplitViewEnabled] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.58);
  const [isCheckingUpdatesManual, setIsCheckingUpdatesManual] = useState(false);
  const [launcherUpdateStatusMsg, setLauncherUpdateStatusMsg] = useState<string | null>(null);
  const detachedSessionIdParam =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('detachedSessionId')
      : null;
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
    if (updateBanner?.updateAvailable) {
      void handleDownloadAndInstallUpdate(true);
      return;
    }
    if (typeof window.opence.checkForUpdates !== 'function') return;
    setIsCheckingUpdatesManual(true);
    setLauncherUpdateStatusMsg(null);
    log('info', 'Checking GitHub Releases for updates...');
    try {
      const res = await window.opence.checkForUpdates();
      if (!res.ok) {
        log('warn', `Update check failed: ${res.error}`);
        setLauncherUpdateStatusMsg('Update Check Failed');
        setTimeout(() => setLauncherUpdateStatusMsg(null), 5000);
        return;
      }
      if (res.updateAvailable) {
        setUpdateBanner(res);
        log('info', `New release available: ${res.releaseName} (v${res.latestVersion})!`);
      } else {
        log('info', `OpenCE Mantle is up to date (v${res.currentVersion}).`);
        setLauncherUpdateStatusMsg(`✓ Up to Date (v${res.currentVersion})`);
        setTimeout(() => setLauncherUpdateStatusMsg(null), 5000);
      }
    } finally {
      setIsCheckingUpdatesManual(false);
    }
  };

  const handleSelectTheme = (theme: AppThemeId) => {
    setCurrentTheme(theme);
    document.documentElement.setAttribute('data-theme', theme);
    window.opence.setTheme?.(theme).catch(() => {});
  };

  const handleOpenMapPath = async (filePath: string) => {
    const result = await window.opence.loadMap(filePath);
    if (!result) return;
    setMapState(result);
    if (result.status === 'ok') {
      setShowLauncherHome(false);
    }
    resetSelectionState();
  };

  const handleSwitchSession = async (sessionId: string, focusTagPath?: string) => {
    const res = await window.opence.switchActiveMapSession?.(sessionId);
    if (res?.ok && res.session) {
      setActiveSessionId(sessionId);
      setMapState(res.session.map);
      setShowLauncherHome(false);
      resetSelectionState();
      if (focusTagPath) {
        const found = res.session.map.tags.find(
          (t) => t.path.toLowerCase() === focusTagPath.toLowerCase(),
        );
        if (found) {
          setFocusedTag(found);
          setSelectedTagIndices(new Set([found.index]));
        }
      }
    }
  };

  const handleCloseSession = async (sessionId: string) => {
    const res = await window.opence.closeMapSession?.(sessionId);
    if (!res?.ok) return;
    setOpenSessions(res.sessions);
    setActiveSessionId(res.activeSessionId);
    if (res.activeSessionId) {
      const next = res.sessions.find((s) => s.sessionId === res.activeSessionId);
      if (next) {
        setMapState(next.map);
        resetSelectionState();
      }
    } else {
      setMapState(null);
      setShowLauncherHome(true);
      resetSelectionState();
    }
  };

  useEffect(() => {
    window.opence.getAppVersion?.().then((v) => v && setAppVersion(v)).catch(() => {});
    window.opence
      .getTheme?.()
      .then((t) => {
        if (t) {
          setCurrentTheme(t);
          document.documentElement.setAttribute('data-theme', t);
        }
      })
      .catch(() => {});
    const offTheme = window.opence.onThemeChanged?.((t) => {
      setCurrentTheme(t);
      document.documentElement.setAttribute('data-theme', t);
    });
    window.opence
      .listOpenMapSessions?.()
      .then((res) => {
        if (!res) return;
        setOpenSessions(res.sessions);
        setActiveSessionId(res.activeSessionId);
        if (detachedSessionIdParam) {
          const detSession = res.sessions.find((s) => s.sessionId === detachedSessionIdParam);
          if (detSession) {
            setMapState(detSession.map);
            setShowLauncherHome(false);
            void window.opence.switchActiveMapSession?.(detachedSessionIdParam);
          }
        }
      })
      .catch(() => {});
    const offSessions = window.opence.onOpenMapSessionsChanged?.((payload) => {
      setOpenSessions(payload.sessions);
      setActiveSessionId(payload.activeSessionId);
      if (payload.sessions.length >= 2) {
        setSecondarySessionId((prev) => {
          if (prev && payload.sessions.some((s) => s.sessionId === prev && s.sessionId !== payload.activeSessionId)) {
            return prev;
          }
          const other = payload.sessions.find((s) => s.sessionId !== payload.activeSessionId);
          return other?.sessionId ?? null;
        });
      }
    });
    return () => {
      offTheme?.();
      offSessions?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const onOpenWorldMerger = () => setBspSwapperOpen(true);
    window.addEventListener('opence:open-world-merger', onOpenWorldMerger);
    return () => window.removeEventListener('opence:open-world-merger', onOpenWorldMerger);
  }, []);

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
      else if (action === 'live-hud-editor') setLiveHudEditorOpen(true);
      else if (action === 'hud-bitmap-injector') {
        setHudBitmapInjectorInitial(null);
        setHudBitmapInjectorOpen(true);
      }
      else if (action === 'ui-map-studio') setUiMapStudioOpen(true);
      else if (action === 'open-loose-tags-workspace') {
        setBaboonStudioTab('loose-workspace');
        setBaboonStudioOpen(true);
      } else if (action === 'content-explorer') {
        setBaboonStudioTab('content-explorer');
        setBaboonStudioOpen(true);
      } else if (action === 'tool-command-runner') {
        setBaboonStudioTab('tool-runner');
        setBaboonStudioOpen(true);
      } else if (action === 'asset-library-browser') {
        setBaboonStudioTab('asset-libraries');
        setBaboonStudioOpen(true);
      } else if (action === 'settings') setSettingsDialogOpen(true);
      else if (action === 'check-for-updates') void handleManualCheckForUpdates();
      else if (action === 'convert-map') setConvertSource('pick');
      else if (action.startsWith('identify-bitmaps:')) {
        setSettingsDialogOpen(true);
      } else if (action.endsWith('-stub')) log('warn', `${action.replace('-stub', '')} is coming in a later milestone.`);
    });
    const offLoaded = window.opence.onMapLoaded((result) => {
      setMapState(result);
      if (result.status === 'ok') {
        setShowLauncherHome(false);
      }
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
      if (result.status === 'ok') {
        setShowLauncherHome(false);
      }
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
      if (result.status === 'ok') {
        setShowLauncherHome(false);
      }
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
        activeMapTitle={
          mapState?.status === 'ok'
            ? `${mapState.filePath.split(/[\\/]/).pop() ?? mapState.header.scenarioName}${mapState.modified ? ' *' : ''}`
            : null
        }
        isDetachedWindow={Boolean(detachedSessionIdParam)}
        onRedockDetachedWindow={
          detachedSessionIdParam
            ? () => {
                void window.opence.redockMapTabToMainWindow?.(detachedSessionIdParam);
              }
            : undefined
        }
        menus={[
          {
            label: 'File',
            items: [
              { label: 'Workspace Launcher Home', onClick: () => setShowLauncherHome(true) },
              { label: 'Open Map...', onClick: handleOpen },
              {
                label: 'Open Standard Blam tags/ Workspace...',
                onClick: () => {
                  setBaboonStudioTab('loose-workspace');
                  setBaboonStudioOpen(true);
                },
              },
              { label: 'Save', onClick: handleSave, disabled: !canSave },
              { label: 'Save As...', onClick: handleSaveAs, disabled: !canSaveAs },
              { label: 'Discard Changes...', onClick: handleDiscard, disabled: !isModified },
              { label: 'Convert to Custom Edition...', onClick: () => setConvertSource('pick') },
              { label: '', separator: true },
              { label: 'Change Theme...', onClick: () => setThemeModalOpen(true) },
              { label: 'Settings...', onClick: () => setSettingsDialogOpen(true) },
              { label: '', separator: true },
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
              {
                label: '🧭 Content Explorer, Dependency Auto-Fix & Refactoring...',
                onClick: () => {
                  setBaboonStudioTab('content-explorer');
                  setBaboonStudioOpen(true);
                },
                disabled: !canExtract,
              },
              {
                label: '🛠️ Visual tool.exe Command Runner & HaloScript Reference...',
                onClick: () => {
                  setBaboonStudioTab('tool-runner');
                  setBaboonStudioOpen(true);
                },
              },
              {
                label: '🖼️ Bitmap & 3D Model Library Browser...',
                onClick: () => {
                  setBaboonStudioTab('asset-libraries');
                  setBaboonStudioOpen(true);
                },
                disabled: !canExtract,
              },
              { label: 'Verify Embedded Data...', onClick: () => setVerifyDialogOpen(true), disabled: !canVerifyEmbeddedData },
              { label: '🌍 Swap BSP & Multi-Map World Merger...', onClick: () => setBspSwapperOpen(true), disabled: !canExtract },
            ],
          },
          {
            label: 'Help',
            items: [
              { label: "What's New in Mantle...", onClick: () => setWhatsNewModalOpen(true) },
              { label: 'Tutorials Hub...', onClick: () => setTutorialsModalOpen(true) },
              { label: 'Visual UI Atlas & Tag Glossary...', onClick: () => setGlossaryModalOpen(true) },
              { label: 'Community Hub (Discord, GitHub, HaloStats)...', onClick: () => setCommunityModalOpen(true) },
              { label: '', separator: true },
              { label: 'Check for Updates...', onClick: () => void handleManualCheckForUpdates() },
              { label: '', separator: true },
              { label: 'Help & About OpenCE Mantle...', onClick: () => setHelpModalOpen(true) },
            ],
          },
        ]}
      />
      {(!showLauncherHome || mapState?.status === 'ok') && !showLauncherHome && (
        <Toolbar
          onOpen={handleOpen}
          canExtract={canExtract}
          canExtractWholeMap={canExtract}
          canInject={canInject}
          onExtract={() => requestExtract(Array.from(selectedTagIndices))}
          onExtractWholeMap={() => void handleBatchExtract()}
          onInject={() => setInjectDialogOpen(true)}
          onOpenLiveHudEditor={() => setLiveHudEditorOpen(true)}
          onOpenHudBitmapInjector={() => {
            setHudBitmapInjectorInitial(null);
            setHudBitmapInjectorOpen(true);
          }}
          onOpenUiMapStudio={() => setUiMapStudioOpen(true)}
        />
      )}

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
        {!showLauncherHome && mapState?.status === 'ok' ? (
          <>
            <div
              style={{
                flex: splitViewEnabled ? `0 0 ${Math.round(splitRatio * 100)}%` : 1,
                display: 'flex',
                minWidth: 0,
                minHeight: 0,
              }}
            >
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
            </div>

            {splitViewEnabled && (
              <>
                {/* Draggable Vertical Center Divider */}
                <div
                  data-testid="split-view-divider"
                  title="Drag horizontally to resize side-by-side map comparison panes"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const onMove = (moveEvt: MouseEvent) => {
                      const next = Math.max(0.3, Math.min(0.75, moveEvt.clientX / window.innerWidth));
                      setSplitRatio(next);
                    };
                    const onUp = () => {
                      window.removeEventListener('mousemove', onMove);
                      window.removeEventListener('mouseup', onUp);
                    };
                    window.addEventListener('mousemove', onMove);
                    window.addEventListener('mouseup', onUp);
                  }}
                  style={{
                    width: 6,
                    cursor: 'col-resize',
                    background: 'var(--bg-panel-header)',
                    borderLeft: '1px solid var(--border)',
                    borderRight: '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--accent-cyan)',
                    fontSize: 9,
                    userSelect: 'none',
                    flexShrink: 0,
                  }}
                >
                  ⋮
                </div>

                <SplitComparePane
                  sessions={openSessions}
                  primarySession={openSessions.find((s) => s.sessionId === activeSessionId) ?? null}
                  secondarySession={
                    openSessions.find((s) => s.sessionId === secondarySessionId) ??
                    openSessions.find((s) => s.sessionId !== activeSessionId) ??
                    null
                  }
                  onSelectSecondarySession={(sid) => setSecondarySessionId(sid)}
                  onActivateSessionAsPrimary={(sid, focusPath) => {
                    void handleSwitchSession(sid, focusPath);
                  }}
                  onFocusMatchingTagInPrimary={(tagPath, groupName) => {
                    if (mapState?.status !== 'ok') return;
                    const match = mapState.tags.find(
                      (t) =>
                        t.primaryClassName === groupName &&
                        t.path.toLowerCase() === tagPath.toLowerCase(),
                    );
                    if (match) {
                      setFocusedTag(match);
                      setSelectedTagIndices(new Set([match.index]));
                    }
                  }}
                  onOpenAnotherMap={() => void handleOpen()}
                  onDetachSessionToWindow={(sid) => {
                    void window.opence.detachMapTabToWindow?.(sid);
                  }}
                  onCloseSplitView={() => setSplitViewEnabled(false)}
                />
              </>
            )}
          </>
        ) : (
          <WorkspaceHome
            appVersion={appVersion}
            currentTheme={currentTheme}
            updateAvailableVersion={updateBanner?.latestVersion ?? null}
            isCheckingUpdates={isCheckingUpdatesManual}
            updateStatusMessage={launcherUpdateStatusMsg}
            onCheckUpdates={() => void handleManualCheckForUpdates()}
            onOpenThemeModal={() => setThemeModalOpen(true)}
            onOpenMapDialog={() => void handleOpen()}
            onOpenMapPath={(p) => void handleOpenMapPath(p)}
            onOpenLooseWorkspace={() => {
              setBaboonStudioTab('loose-workspace');
              setBaboonStudioOpen(true);
            }}
            onOpenWhatsNew={() => setWhatsNewModalOpen(true)}
            onOpenHelp={() => setHelpModalOpen(true)}
            onOpenTutorials={() => setTutorialsModalOpen(true)}
            onOpenGlossary={() => setGlossaryModalOpen(true)}
            onOpenCommunity={() => setCommunityModalOpen(true)}
          />
        )}
      </div>

      {!showLauncherHome && mapState?.status === 'ok' && <LogPanel logs={logs} />}

      {(openSessions.length > 0 || mapState?.status === 'ok') && (
        <BottomMapTabBar
          sessions={openSessions}
          activeSessionId={activeSessionId}
          secondarySessionId={secondarySessionId}
          showLauncherHome={showLauncherHome}
          splitViewEnabled={splitViewEnabled}
          onToggleLauncherHome={(show) => setShowLauncherHome(show)}
          onSelectSession={(sid) => void handleSwitchSession(sid)}
          onSelectSecondarySession={(sid) => setSecondarySessionId(sid)}
          onCloseSession={(sid) => void handleCloseSession(sid)}
          onOpenNewMapTab={() => void handleOpen()}
          onToggleSplitView={() => {
            setShowLauncherHome(false);
            setSplitViewEnabled((prev) => !prev);
          }}
          onDetachSessionToWindow={(sid, coords) => {
            void window.opence.detachMapTabToWindow?.(sid, coords);
          }}
        />
      )}

      <StatusBar mapState={mapState} />

      {extractSelection && <DependencyDialog selectedIndices={extractSelection} onClose={() => setExtractSelection(null)} log={log} />}
      {injectDialogOpen && <InjectDialog onClose={() => setInjectDialogOpen(false)} log={log} />}
      {settingsDialogOpen && (
        <SettingsDialog
          onClose={() => setSettingsDialogOpen(false)}
          currentTheme={currentTheme}
          onOpenThemeModal={() => setThemeModalOpen(true)}
        />
      )}
      {themeModalOpen && (
        <ThemeSelectorModal
          currentTheme={currentTheme}
          onSelectTheme={handleSelectTheme}
          onClose={() => setThemeModalOpen(false)}
        />
      )}
      {whatsNewModalOpen && (
        <WhatsNewModal
          appVersion={appVersion}
          onCheckUpdates={() => void handleManualCheckForUpdates()}
          onClose={() => setWhatsNewModalOpen(false)}
        />
      )}
      {helpModalOpen && (
        <HelpAboutModal
          appVersion={appVersion}
          onOpenTutorials={() => setTutorialsModalOpen(true)}
          onOpenGlossary={() => setGlossaryModalOpen(true)}
          onOpenCommunity={() => setCommunityModalOpen(true)}
          onClose={() => setHelpModalOpen(false)}
        />
      )}
      {tutorialsModalOpen && <TutorialsHubModal onClose={() => setTutorialsModalOpen(false)} />}
      {glossaryModalOpen && <GlossaryModal onClose={() => setGlossaryModalOpen(false)} />}
      {communityModalOpen && <CommunityModal onClose={() => setCommunityModalOpen(false)} />}
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

      {liveHudEditorOpen && mapState?.status === 'ok' && (
        <LiveHudEditorDialog
          open={liveHudEditorOpen}
          onClose={() => setLiveHudEditorOpen(false)}
          onOpenBitmapInjector={(opts) => {
            setHudBitmapInjectorInitial(opts ?? null);
            setHudBitmapInjectorOpen(true);
          }}
          onOpenUiMapStudio={() => setUiMapStudioOpen(true)}
          onMapUpdated={(updatedMap) => {
            setMapState(updatedMap);
          }}
        />
      )}

      {hudBitmapInjectorOpen && mapState?.status === 'ok' && (
        <HudBitmapInjectorDialog
          open={hudBitmapInjectorOpen}
          onClose={() => setHudBitmapInjectorOpen(false)}
          initialSelection={hudBitmapInjectorInitial}
          onMapUpdated={(updatedMap) => {
            setMapState(updatedMap);
          }}
        />
      )}

      {uiMapStudioOpen && mapState?.status === 'ok' && (
        <UiMapStudioDialog
          open={uiMapStudioOpen}
          onClose={() => setUiMapStudioOpen(false)}
          initialWidgetTagIndex={focusedTag?.primaryClassName === 'DeLa' ? focusedTag.index : null}
          initialUstrTagIndex={focusedTag?.primaryClassName === 'ustr' ? focusedTag.index : null}
          onTagsChanged={async () => {
            setMapState((prev) => (prev && prev.status === 'ok' ? { ...prev, modified: true } : prev));
          }}
        />
      )}

      {baboonStudioOpen && (
        <BaboonStudioDialog
          open={baboonStudioOpen}
          initialTab={baboonStudioTab}
          focusedTag={focusedTag}
          allTags={mapState?.status === 'ok' ? mapState.tags : []}
          onClose={() => setBaboonStudioOpen(false)}
          onSelectMapTag={(tagIndex) => {
            if (mapState?.status !== 'ok') return;
            const found = mapState.tags.find((t) => t.index === tagIndex) ?? mapState.tags[tagIndex];
            if (found) {
              setFocusedTag(found);
              setSelectedTagIndices(new Set([found.index]));
            }
          }}
          onOpenTagEditor={(tagIndex) => {
            if (mapState?.status !== 'ok') return;
            const found = mapState.tags.find((t) => t.index === tagIndex) ?? mapState.tags[tagIndex];
            if (found) {
              setFocusedTag(found);
              setSelectedTagIndices(new Set([found.index]));
              setEditingTag(found);
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
