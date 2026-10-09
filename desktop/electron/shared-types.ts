/** Shared IPC contract between main, preload, and renderer. Kept dependency-free (no Electron types). */

export interface MapHeaderSummary {
  scenarioName: string;
  buildString: string;
  mapType: number;
  crc32: number;
  tagDataOffset: number;
  tagDataSize: number;
  decompressedFileSize: number;
  fileSizeOnDisk: number;
  tagCount: number;
}

export interface TagEntrySummary {
  index: number;
  tagId: number;
  primaryClassName: string;
  path: string;
  isExternal: boolean;
  estimatedSize: number | null;
}

export type LoadMapResult =
  | { status: 'ok'; filePath: string; header: MapHeaderSummary; tags: TagEntrySummary[] }
  | { status: 'compressed'; filePath: string }
  | { status: 'unsupported'; filePath: string; message: string }
  | { status: 'error'; message: string };

export interface ProgressEvent {
  taskId: string;
  stage: string;
  percent: number;
}

export interface LogEvent {
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

export interface CompressionResult {
  outputPath: string;
  originalSize: number;
  newSize: number;
}

export interface OpenceApi {
  openMapDialog(): Promise<LoadMapResult | null>;
  loadMap(filePath: string): Promise<LoadMapResult>;
  decompressMap(filePath: string): Promise<CompressionResult | null>;
  recompressMap(filePath: string): Promise<CompressionResult | null>;
  notImplemented(feature: string): void;
  getAppVersion(): Promise<string>;
  getRecentMaps(): Promise<string[]>;
  onProgress(cb: (e: ProgressEvent) => void): () => void;
  onLog(cb: (e: LogEvent) => void): () => void;
  onMenuAction(cb: (action: string) => void): () => void;
  onMapLoaded(cb: (result: LoadMapResult) => void): () => void;
  getPathForFile(file: File): string;
}

declare global {
  interface Window {
    opence: OpenceApi;
  }
}
