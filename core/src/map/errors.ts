/** Thrown when a file is not a well-formed Halo CE cache file (bad magic, truncated, etc). */
export class CorruptMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorruptMapError';
  }
}

/** Human-readable names for engine values we recognize but do not support, for clear dialogs. */
const KNOWN_ENGINE_NAMES: Record<number, string> = {
  5: 'Halo: Combat Evolved (Xbox)',
  6: 'Halo PC Demo',
  7: 'Halo PC Retail (version 7)',
  13: 'Halo: Combat Evolved Anniversary (MCC)',
  0x1a86: 'Native/MCC internal format',
};

/** Thrown when the map is a real Halo map but not Custom Edition (version 609) - out of scope. */
export class UnsupportedMapVersionError extends Error {
  constructor(public readonly engineValue: number) {
    const known = KNOWN_ENGINE_NAMES[engineValue];
    super(
      known
        ? `This is a ${known} map. OpenCE Modding Tool only supports Halo: Custom Edition PC maps (version 609).`
        : `Unrecognized map version/engine (0x${engineValue.toString(16)}). Only Halo: Custom Edition PC maps (version 609) are supported.`,
    );
    this.name = 'UnsupportedMapVersionError';
  }
}

/** Thrown/returned when the map body looks compressed - caller should decompress first (Milestone 2). */
export class CompressedMapError extends Error {
  constructor() {
    super('This map is compressed. Decompress it before browsing tags.');
    this.name = 'CompressedMapError';
  }
}

/** Thrown when decompressCustomEditionMap() is called on a map that is not actually compressed. */
export class NotCompressedMapError extends Error {
  constructor() {
    super('This map is not compressed; there is nothing to decompress.');
    this.name = 'NotCompressedMapError';
  }
}
