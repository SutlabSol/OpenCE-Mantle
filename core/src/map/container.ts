/**
 * OpenCE's own extracted-tag-set file format (`.ocetags`). A versioned, self-describing
 * container for `ExtractedTagSet` so Milestone 5 (tag injection) can read it back without
 * re-deriving any of M4's logic. JSON text (not a packed binary) - this is OpenCE's own new
 * format, not a Halo format, so there is no byte-layout constraint to match.
 */
import type { ExtractedTagSet, ExtractedDependencyRef } from './tag-extractor';
import type { WalkerWarning } from './dependency-walker';

export const OCETAGS_MAGIC = 'OCETAGS';
export const OCETAGS_FORMAT_VERSION = 1;
export const OCETAGS_EXTENSION = '.ocetags';

export interface OceContainerTag {
  originalIndex: number;
  group: string;
  path: string;
  structName: string;
  /** Base64-encoded `ExtractedTag.data`. */
  data: string;
  dependencies: ExtractedDependencyRef[];
}

export interface OceContainerNotExtracted {
  originalIndex: number;
  group: string;
  path: string;
  reason: string;
}

export interface OceContainer {
  magic: string;
  formatVersion: number;
  sourceMapName: string;
  createdAt: string;
  /** True if any tag in `notExtracted` is a BSP - M5's import flow should refuse or warn. */
  hasUnresolvedBspReferences: boolean;
  rootOriginalIndices: number[];
  tags: OceContainerTag[];
  notExtracted: OceContainerNotExtracted[];
  warnings: WalkerWarning[];
}

export class ContainerFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContainerFormatError';
  }
}

/** Thrown by `deserializeContainer` if the container includes a `scenario_structure_bsp` tag - must never happen, extraction never writes one, but hand-edited/future containers are rejected defensively. */
export class ContainerHasBspError extends ContainerFormatError {
  constructor(paths: string[]) {
    super(`This .ocetags container includes scenario_structure_bsp tag(s), which must never be imported: ${paths.join(', ')}.`);
    this.name = 'ContainerHasBspError';
  }
}

export function serializeContainer(set: ExtractedTagSet, sourceMapName: string): Buffer {
  const container: OceContainer = {
    magic: OCETAGS_MAGIC,
    formatVersion: OCETAGS_FORMAT_VERSION,
    sourceMapName,
    createdAt: new Date().toISOString(),
    hasUnresolvedBspReferences: set.notExtracted.length > 0,
    rootOriginalIndices: set.rootOriginalIndices,
    tags: set.tags.map((t) => ({
      originalIndex: t.originalIndex,
      group: t.group,
      path: t.path,
      structName: t.structName,
      data: t.data.toString('base64'),
      dependencies: t.dependencies,
    })),
    notExtracted: set.notExtracted,
    warnings: set.warnings,
  };
  return Buffer.from(JSON.stringify(container, null, 2), 'utf-8');
}

/** Parses and validates a `.ocetags` file. Throws `ContainerFormatError`/`ContainerHasBspError` on any problem. */
export function deserializeContainer(buffer: Buffer): OceContainer {
  let parsed: OceContainer;
  try {
    parsed = JSON.parse(buffer.toString('utf-8'));
  } catch {
    throw new ContainerFormatError('File is not a valid .ocetags container (not valid JSON).');
  }
  if (!parsed || parsed.magic !== OCETAGS_MAGIC) {
    throw new ContainerFormatError('File is not a valid .ocetags container (missing or wrong magic value).');
  }
  if (parsed.formatVersion !== OCETAGS_FORMAT_VERSION) {
    throw new ContainerFormatError(`Unsupported .ocetags format version ${parsed.formatVersion} (this build supports version ${OCETAGS_FORMAT_VERSION}).`);
  }
  const bspTags = (parsed.tags ?? []).filter((t) => t.group === 'scenario_structure_bsp');
  if (bspTags.length > 0) {
    throw new ContainerHasBspError(bspTags.map((t) => t.path));
  }
  return parsed;
}
