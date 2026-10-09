import { useEffect, useState } from 'react';
import type { LoadMapResult } from '../electron/shared-types';
import { useOpenceEvents } from './hooks/useOpenceEvents';
import Toolbar from './components/Toolbar';
import WelcomeDropZone from './components/WelcomeDropZone';
import MapInfoPanel from './components/MapInfoPanel';
import CompressedBanner from './components/CompressedBanner';
import UnsupportedBanner from './components/UnsupportedBanner';
import TagBrowser from './components/TagBrowser';
import LogPanel from './components/LogPanel';

export default function App() {
  const [mapState, setMapState] = useState<LoadMapResult | null>(null);
  const [version, setVersion] = useState('0.1.0');
  const { logs, progress, log } = useOpenceEvents();

  useEffect(() => {
    window.opence.getAppVersion().then(setVersion);
    const offMenu = window.opence.onMenuAction((action) => {
      if (action.endsWith('-stub')) log('warn', `${action.replace('-stub', '')} is coming in a later milestone.`);
    });
    const offLoaded = window.opence.onMapLoaded((result) => setMapState(result));
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
    if (result) setMapState(result);
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

  const hasMap = mapState?.status === 'ok' || mapState?.status === 'compressed';
  const isCompressed = mapState?.status === 'compressed';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Toolbar
        title={mapState && mapState.status !== 'error' ? mapState.filePath : ''}
        version={version}
        onOpen={handleOpen}
        hasMap={hasMap}
        isCompressed={isCompressed}
        onDecompress={handleDecompress}
        onRecompress={handleRecompress}
        progress={progress}
      />

      {mapState?.status === 'compressed' && <CompressedBanner onDecompress={handleDecompress} />}
      {mapState?.status === 'unsupported' && <UnsupportedBanner message={mapState.message} />}
      {mapState?.status === 'error' && <UnsupportedBanner message={mapState.message} />}
      {mapState?.status === 'ok' && <MapInfoPanel header={mapState.header} />}

      {mapState?.status === 'ok' ? (
        <TagBrowser tags={mapState.tags} onNotImplemented={(f) => window.opence.notImplemented(f)} />
      ) : (
        <WelcomeDropZone onOpen={handleOpen} />
      )}

      <LogPanel logs={logs} />
    </div>
  );
}
