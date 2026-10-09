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

export default function App() {
  const [mapState, setMapState] = useState<LoadMapResult | null>(null);
  const [focusedTag, setFocusedTag] = useState<TagEntrySummary | null>(null);
  const { logs, progress, log } = useOpenceEvents();

  useEffect(() => {
    const offMenu = window.opence.onMenuAction((action) => {
      if (action.endsWith('-stub')) log('warn', `${action.replace('-stub', '')} is coming in a later milestone.`);
    });
    const offLoaded = window.opence.onMapLoaded((result) => {
      setMapState(result);
      setFocusedTag(null);
    });
    return () => {
      offMenu();
      offLoaded();
    };
  }, []);

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
      setFocusedTag(null);
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
      setFocusedTag(null);
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

  const hasMap = mapState?.status === 'ok' || mapState?.status === 'compressed';
  const isCompressed = mapState?.status === 'compressed';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
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
              { label: 'Decompress Map', onClick: handleDecompress, disabled: !hasMap || !isCompressed },
              { label: 'Recompress Map', onClick: handleRecompress, disabled: !hasMap || isCompressed },
              { label: 'Extract Tags...', onClick: () => notImplemented('Extract Tags'), disabled: !hasMap },
              { label: 'Inject Tags...', onClick: () => notImplemented('Inject Tags'), disabled: !hasMap },
            ],
          },
          { label: 'Help', items: [{ label: 'About', onClick: () => window.opence.showAbout() }] },
        ]}
      />
      <Toolbar
        onOpen={handleOpen}
        hasMap={hasMap}
        isCompressed={isCompressed}
        onDecompress={handleDecompress}
        onRecompress={handleRecompress}
        onExtract={() => notImplemented('Extract Tags')}
        onInject={() => notImplemented('Inject Tags')}
        progress={progress}
      />

      {mapState?.status === 'compressed' && <CompressedBanner onDecompress={handleDecompress} />}
      {mapState?.status === 'unsupported' && <UnsupportedBanner message={mapState.message} />}
      {mapState?.status === 'error' && <UnsupportedBanner message={mapState.message} />}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {mapState?.status === 'ok' ? (
          <>
            <TagBrowser tags={mapState.tags} onFocusTag={setFocusedTag} onNotImplemented={notImplemented} />
            <CenterWorkspace header={mapState.header} />
            <PropertiesPalette focusedTag={focusedTag} />
          </>
        ) : (
          <WelcomeDropZone onOpen={handleOpen} />
        )}
      </div>

      <LogPanel logs={logs} />
      <StatusBar mapState={mapState} />
    </div>
  );
}
