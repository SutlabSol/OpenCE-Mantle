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
import CenterWorkspace from './components/CenterWorkspace';
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
import TagActionDialog, { type TagActionType } from './components/TagActionDialog';
import VerifyEmbeddedDataDialog from './components/VerifyEmbeddedDataDialog';
import ConvertDialog from './components/ConvertDialog';
import BatchExtractDialog from './components/BatchExtractDialog';
import IdentifyBitmapsDialog from './components/IdentifyBitmapsDialog';
import ConfigureResourcesPromptDialog from './components/ConfigureResourcesPromptDialog';
import BspSwapperDialog from './components/BspSwapperDialog';
import type { BatchExtractPreflightResult, HaloBitmapVersion } from '../electron/shared-types';

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
  /** Convert to Custom Edition: 'open' = the map in the unsupported banner, 'pick' = choose a file. */
  const [convertSource, setConvertSource] = useState<'open' | 'pick' | null>(null);
  const [identifyBitmapsVersion, setIdentifyBitmapsVersion] = useState<HaloBitmapVersion | null>(null);
  /** Tag opened in the right-click "Tag Editor..." modal (or null = closed). */
  const [editingTag, setEditingTag] = useState<TagEntrySummary | null>(null);
  const [bitmapEditorTag, setBitmapEditorTag] = useState<TagEntrySummary | null>(null);
  const [soundAuditorTag, setSoundAuditorTag] = useState<TagEntrySummary | null>(null);
  /** Properties palette active tab */
  const [propertiesPaletteTab, setPropertiesPaletteTab] = useState<PropertiesPaletteTab>('overview');
  /** Milestone 9: Tag action modal (rename or duplicate) */
  const [tagAction, setTagAction] = useState<{ action: TagActionType; tag: TagEntrySummary } | null>(null);
  /** Prompt dialog when opening an edition without configured bitmaps/sounds */
  const [resourcePrompt, setResourcePrompt] = useState<{
    mapEdition: HaloBitmapVersion;
    mapScenarioName: string;
  } | null>(null);
  const [skippedPromptMapPaths, setSkippedPromptMapPaths] = useState<Set<string>>(new Set());
  const { logs, progress, log } = useOpenceEvents();
  const isMockActive = typeof window !== 'undefined' && Boolean((window as unknown as { __OPENCE_MOCK__?: boolean }).__OPENCE_MOCK__);

  const hasMap = mapState?.status === 'ok' || mapState?.status === 'compressed';
  const isCompressed = mapState?.status === 'compressed';
  const canDecompress = hasMap && isCompressed;
  const canRecompress = hasMap && !isCompressed;
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

  useEffect(() => {
    const offMenu = window.opence.onMenuAction((action) => {
      if (action === 'extract-tags') requestExtract(Array.from(selectedTagIndices));
      else if (action === 'extract-whole-map') void handleBatchExtract();
      else if (action === 'inject-tags') setInjectDialogOpen(true);
      else if (action === 'verify-embedded-data') setVerifyDialogOpen(true);
      else if (action === 'swap-bsp') setBspSwapperOpen(true);
      else if (action === 'settings') setSettingsDialogOpen(true);
      else if (action === 'convert-map') setConvertSource('pick');
      else if (action.startsWith('identify-bitmaps:')) {
        setIdentifyBitmapsVersion(action.split(':')[1] as HaloBitmapVersion);
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

  const handleRecompress = async () => {
    if (!mapState || mapState.status === 'error') return;
    const result = await window.opence.recompressMap(mapState.filePath);
    if (result) log('info', `Saved recompressed map to ${result.outputPath}`);
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

  const notImplemented = (feature: string) => {
    window.opence.notImplemented(feature);
    log('warn', `${feature} is coming in a later milestone.`);
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
              { label: 'Decompress Map', onClick: handleDecompress, disabled: !canDecompress },
              { label: 'Recompress Map', onClick: handleRecompress, disabled: !canRecompress },
              { label: 'Extract Tags...', onClick: () => requestExtract(Array.from(selectedTagIndices)), disabled: !!extractDisabledReason },
              { label: 'Extract Whole Map...', onClick: () => void handleBatchExtract(), disabled: !canExtract },
              { label: 'Inject Tags...', onClick: () => setInjectDialogOpen(true), disabled: !canInject },
              { label: 'Verify Embedded Data...', onClick: () => setVerifyDialogOpen(true), disabled: !canVerifyEmbeddedData },
              { label: 'Swap BSP...', onClick: () => setBspSwapperOpen(true), disabled: !canExtract },
              { label: '', separator: true },
              { label: 'Launch In OpenCE (F5)', onClick: () => window.opence.tagTestLaunch({ windowed: true }), disabled: !canExtract },
              { label: 'Hot-Reload OpenCE (Ctrl+F5)', onClick: () => window.opence.tagTestHotReload(), disabled: !canExtract },
              { label: '', separator: true },
              {
                label: 'Identify Bitmaps',
                submenu: [
                  { label: 'HaloMD...', onClick: () => setIdentifyBitmapsVersion('halomd') },
                  { label: 'Custom Edition...', onClick: () => setIdentifyBitmapsVersion('ce') },
                  { label: 'Halo PC...', onClick: () => setIdentifyBitmapsVersion('pc') },
                  { label: 'Halo Mac Demo...', onClick: () => setIdentifyBitmapsVersion('demo') },
                  { label: 'Halo MCC...', onClick: () => setIdentifyBitmapsVersion('mcc') },
                ],
              },
              { label: '', separator: true },
              { label: 'Settings...', onClick: () => setSettingsDialogOpen(true) },
            ],
          },
          { label: 'Help', items: [{ label: 'About', onClick: () => window.opence.showAbout() }] },
        ]}
      />
      <Toolbar
        onOpen={handleOpen}
        canDecompress={canDecompress}
        canRecompress={canRecompress}
        canExtract={canExtract}
        canInject={canInject}
        onDecompress={handleDecompress}
        onRecompress={handleRecompress}
        onExtract={() => requestExtract(Array.from(selectedTagIndices))}
        onInject={() => setInjectDialogOpen(true)}
        progress={progress}
      />

      {mapState?.status === 'compressed' && <CompressedBanner onDecompress={handleDecompress} />}
      {mapState?.status === 'unsupported' && <UnsupportedBanner message={mapState.message} onConvert={mapState.convertible ? () => setConvertSource('open') : undefined} />}
      {mapState?.status === 'error' && <UnsupportedBanner message={mapState.message} />}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {mapState?.status === 'ok' ? (
          <>
            <TagBrowser
              tags={mapState.tags}
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
              onOpenBitmapEditor={setBitmapEditorTag}
              onOpenSoundAuditor={setSoundAuditorTag}
            />
            <CenterWorkspace
              header={mapState.header}
              onOpenTagEditor={(tagIndexOrPath) => {
                if (mapState?.status !== 'ok') return;
                const target =
                  typeof tagIndexOrPath === 'number'
                    ? mapState.tags[tagIndexOrPath]
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
            <PropertiesPalette
              focusedTag={focusedTag}
              allTags={mapState.tags}
              activeTab={propertiesPaletteTab}
              onTabChange={setPropertiesPaletteTab}
              onSelectTag={(idx) => {
                const t = mapState.tags[idx];
                if (t) {
                  setFocusedTag(t);
                  setSelectedTagIndices(new Set([idx]));
                }
              }}
            />
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
      {identifyBitmapsVersion && (
        <IdentifyBitmapsDialog
          initialVersion={identifyBitmapsVersion}
          isOpen={true}
          onClose={() => setIdentifyBitmapsVersion(null)}
          openMapScenarioName={mapState?.status === 'ok' ? mapState.header.scenarioName : null}
        />
      )}
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
        />
      )}

      {bitmapEditorTag && mapState?.status === 'ok' && (
        <BitmapEditorDialog tag={bitmapEditorTag} onClose={() => setBitmapEditorTag(null)} />
      )}

      {soundAuditorTag && mapState?.status === 'ok' && (
        <SoundAuditorDialog tag={soundAuditorTag} onClose={() => setSoundAuditorTag(null)} />
      )}

      {tagAction && mapState?.status === 'ok' && (
        <TagActionDialog
          action={tagAction.action}
          tag={tagAction.tag}
          onClose={() => setTagAction(null)}
          onSuccess={(newIdx) => {
            setTagAction(null);
            if (typeof newIdx === 'number' && mapState.tags[newIdx]) {
              setFocusedTag(mapState.tags[newIdx]);
              setSelectedTagIndices(new Set([newIdx]));
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
