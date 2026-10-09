import { useEffect, useState } from 'react';
import type { LoadMapResult, TagEntrySummary } from '../electron/shared-types';
import { useOpenceEvents } from './hooks/useOpenceEvents';
import MenuBar from './components/MenuBar';
import Toolbar from './components/Toolbar';
import WelcomeDropZone from './components/WelcomeDropZone';
import CompressedBanner from './components/CompressedBanner';
import UnsupportedBanner from './components/UnsupportedBanner';
import TagBrowser from './components/TagBrowser';
import CenterWorkspace from './components/CenterWorkspace';
import PropertiesPalette from './components/PropertiesPalette';
import LogPanel from './components/LogPanel';
import StatusBar from './components/StatusBar';
import DependencyDialog from './components/DependencyDialog';

/** Selections larger than this get a confirmation before walking dependencies (can be slow). */
const LARGE_SELECTION_CONFIRM_THRESHOLD = 200;

export default function App() {
  const [mapState, setMapState] = useState<LoadMapResult | null>(null);
  const [focusedTag, setFocusedTag] = useState<TagEntrySummary | null>(null);
  const [selectedTagIndices, setSelectedTagIndices] = useState<Set<number>>(new Set());
  const [extractSelection, setExtractSelection] = useState<number[] | null>(null);
  const { logs, progress, log } = useOpenceEvents();
  const isMockActive = typeof window !== 'undefined' && Boolean((window as unknown as { __OPENCE_MOCK__?: boolean }).__OPENCE_MOCK__);

  const hasMap = mapState?.status === 'ok' || mapState?.status === 'compressed';
  const isCompressed = mapState?.status === 'compressed';
  const canDecompress = hasMap && isCompressed;
  const canRecompress = hasMap && !isCompressed;
  const canExtract = mapState?.status === 'ok';
  const canInject = hasMap;
  const isWalkOrExtractRunning = extractSelection !== null;

  const requestExtract = (indices: number[]) => {
    if (!canExtract || isWalkOrExtractRunning || indices.length === 0) return;
    log('info', `Extract requested: ${indices.length} tag(s) selected.`);
    if (indices.length > LARGE_SELECTION_CONFIRM_THRESHOLD) {
      const ok = window.confirm(`You're about to walk dependencies for ${indices.length} tags - this may take a moment. Continue?`);
      if (!ok) return;
    }
    setExtractSelection(indices);
  };

  const resetSelectionState = () => {
    setFocusedTag(null);
    setSelectedTagIndices(new Set());
    setExtractSelection(null);
  };

  useEffect(() => {
    const offMenu = window.opence.onMenuAction((action) => {
      if (action === 'extract-tags') requestExtract(Array.from(selectedTagIndices));
      else if (action.endsWith('-stub')) log('warn', `${action.replace('-stub', '')} is coming in a later milestone.`);
    });
    const offLoaded = window.opence.onMapLoaded((result) => {
      setMapState(result);
      resetSelectionState();
    });
    return () => {
      offMenu();
      offLoaded();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTagIndices, canExtract, isWalkOrExtractRunning]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        requestExtract(Array.from(selectedTagIndices));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTagIndices, canExtract, isWalkOrExtractRunning]);

  useEffect(() => {
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const path = window.opence.getPathForFile(file);
      log('info', `Dropped: ${path}`);
      const result = await window.opence.loadMap(path);
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
              { label: 'Save As...', onClick: () => notImplemented('Save As / Export') },
              { label: 'Exit', onClick: () => window.close() },
            ],
          },
          {
            label: 'Tools',
            items: [
              { label: 'Decompress Map', onClick: handleDecompress, disabled: !canDecompress },
              { label: 'Recompress Map', onClick: handleRecompress, disabled: !canRecompress },
              { label: 'Extract Tags...', onClick: () => requestExtract(Array.from(selectedTagIndices)), disabled: !!extractDisabledReason },
              { label: 'Inject Tags...', onClick: () => notImplemented('Inject Tags'), disabled: !canInject },
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
        onInject={() => notImplemented('Inject Tags')}
        progress={progress}
      />

      {mapState?.status === 'compressed' && <CompressedBanner onDecompress={handleDecompress} />}
      {mapState?.status === 'unsupported' && <UnsupportedBanner message={mapState.message} />}
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
            />
            <CenterWorkspace header={mapState.header} />
            <PropertiesPalette focusedTag={focusedTag} />
          </>
        ) : (
          <WelcomeDropZone onOpen={handleOpen} />
        )}
      </div>

      <LogPanel logs={logs} />
      <StatusBar mapState={mapState} />

      {extractSelection && <DependencyDialog selectedIndices={extractSelection} onClose={() => setExtractSelection(null)} log={log} />}
    </div>
  );
}
