/**
 * OpenCE's own extracted-tag-set file format (`.ocetags`). A versioned, self-describing
 * container for `ExtractedTagSet` so Milestone 5 (tag injection) can read it back without
 * re-deriving any of M4's logic. JSON text (not a packed binary) - this is OpenCE's own new
 * format, not a Halo format, so there is no byte-layout constraint to match.
 *
 * v2 adds: `secondaryClassFourCC`/`tertiaryClassFourCC` per tag (preserves the
 * abstract-class dual-classification seen on ~11% of real tags, e.g. every concrete shader_*
 * subtype also carries secondary class "shdr" - confirmed against bloodgulch.map, 280/2455
 * entries), `resourceMapIdentities` (fingerprint of the SOURCE map's configured resource maps
 * at extraction time, for M5's mismatch warning), `externalResourceRefs` (per-tag list of
 * bitmaps.map/sounds.map-referenced fields, derived from the walker's 'externalData' warnings),
 * and `externalData: 'referenced'`.
 *
 * v3 (this session) adds: per-tag `embeddedRawDataAssets`/`embeddedRawDataPatches` - the actual
 * embedded (external=0) bitmap/sound bytes captured at extraction time (base64, deduped by
 * source range), plus every byte offset within the tag's own `data` that must be patched to
 * point at them once relocated. Injection of a tag with embedded data from a v1/v2 container
 * (or a v3 container that couldn't fully capture it - see `tag-extractor.ts`) stays blocked
 * with a "re-extract to enable relocation" message - see `tag-injector.ts`. Relocation itself
 * stays behind an explicit, test-only opt-in until approved (see PRD.md "Relocation research").
 *
 * v4 adds: per-tag `injectionBlockers` - reasons decided at extraction time why a tag must never
 * be injected (an out-of-bounds TagReflexive left unrelocated, or an unexpected extraction
 * error). The injector blocks on these from the saved file alone. v1-v3 containers don't have
 * the field; the injector falls back to their persisted walker `warnings` instead.
 */
import type { ExtractedTagSet, ExtractedDependencyRef, ExtractedEmbeddedAsset, ExtractedEmbeddedPatch, InjectionBlocker } from './tag-extractor';
import type { WalkerWarning } from './dependency-walker';
import type { ResourceMapIdentity } from './resource-map';

export const OCETAGS_MAGIC = 'OCETAGS';
export const OCETAGS_FORMAT_VERSION = 5;
export const OCETAGS_MIN_SUPPORTED_VERSION = 1;
export const OCETAGS_EXTENSION = '.ocetags';

/** One embedded (external=0) bitmap/sound asset's bytes, stored once even if multiple fields point at it. */
export interface OceContainerEmbeddedRawDataAsset {
  kind: 'bitmap' | 'sound';
  /** Base64-encoded raw bytes, exactly as sliced from the source map. */
  data: string;
}

/** One byte offset within a tag's own `data` that must be rewritten to the relocated asset's new absolute file offset. */
export interface OceContainerEmbeddedRawDataPatch {
  assetIndex: number;
  patchOffset: number;
  patchWidth: number;
}

/** Captured gbxmodel geometry part with vertex and triangle index bytes (base64) from the model data region (v5+). */
export interface OceContainerGbxmodelPart {
  geometryIndex: number;
  partIndex: number;
  vertexType: number;
  vertexCount: number;
  /** Base64-encoded vertex bytes. */
  vertexData: string;
  triangleBufferType: number;
  triangleCount: number;
  /** Base64-encoded triangle index bytes. */
  triangleData: string;
}

export interface OceContainerTag {
  originalIndex: number;
  group: string;
  path: string;
  structName: string;
  /** Base64-encoded `ExtractedTag.data`. */
  data: string;
  dependencies: ExtractedDependencyRef[];
  /** Added in v2; undefined when read from a v1 container (no dual-classification info available). */
  secondaryClassFourCC?: number | null;
  tertiaryClassFourCC?: number | null;
  /** Added in v3; undefined when read from a v1/v2 container - relocation stays blocked for those. */
  embeddedRawDataAssets?: OceContainerEmbeddedRawDataAsset[];
  embeddedRawDataPatches?: OceContainerEmbeddedRawDataPatch[];
  /** Added in v4; undefined when read from a v1-v3 container. Non-empty = blocked from ADD/SWAP. */
  injectionBlockers?: InjectionBlocker[];
  /** Added in v5; undefined when read from a v1-v4 container or non-gbxmodel tags. */
  gbxmodelGeometryParts?: OceContainerGbxmodelPart[];
}

export interface OceContainerNotExtracted {
  originalIndex: number;
  group: string;
  path: string;
  reason: string;
}

export type ExternalRefCoverage = 'sound-samples' | 'bitmap-mipmap';
export type ExternalRefStatus = 'verified' | 'unverified';

/** One bitmaps.map/sounds.map-referenced field on an extracted tag (M5 fingerprint-check input). */
export interface ExternalResourceRef {
  /** Index into THIS container's `tags` array (NOT the source map's tag index). */
  tagIndex: number;
  coverage: ExternalRefCoverage;
  resourceMap: string;
  fileOffset: number;
  size: number;
  /** 'verified' if the extracting machine had a matching, configured resource map at extraction time; 'unverified' otherwise. M5 re-verifies independently against the TARGET's configured resource map - this is informational provenance only. */
  status: ExternalRefStatus;
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
  /** Fingerprints of the resource maps configured on the extracting machine, if any (v2+). */
  resourceMapIdentities: Partial<Record<'bitmaps' | 'sounds' | 'loc', ResourceMapIdentity>>;
  externalResourceRefs: ExternalResourceRef[];
  /** 'embedded' when asset bytes are embedded in the container, 'referenced' when external resource map data is referenced. */
  externalData: 'referenced' | 'embedded';
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

const RESOURCE_MAP_BY_NAME: Record<string, 'bitmaps' | 'sounds' | 'loc'> = {
  'bitmaps.map': 'bitmaps',
  'sounds.map': 'sounds',
  'loc.map': 'loc',
};

export function serializeContainer(
  set: ExtractedTagSet,
  sourceMapName: string,
  resourceMapIdentities: Partial<Record<'bitmaps' | 'sounds' | 'loc', ResourceMapIdentity>> = {},
): Buffer {
  const localIndexByOriginal = new Map<number, number>();
  set.tags.forEach((t, i) => localIndexByOriginal.set(t.originalIndex, i));

  const externalResourceRefs: ExternalResourceRef[] = [];
  for (const w of set.warnings) {
    if (w.kind !== 'externalData' || !w.resourceMap) continue;
    const tagIndex = localIndexByOriginal.get(w.originalIndex);
    if (tagIndex === undefined) continue; // field warning on a tag that wasn't itself extracted (shouldn't happen for externalData, defensive)
    const resourceKey = RESOURCE_MAP_BY_NAME[w.resourceMap];
    const identity = resourceKey ? resourceMapIdentities[resourceKey] : undefined;
    externalResourceRefs.push({
      tagIndex,
      coverage: w.resourceMap === 'sounds.map' ? 'sound-samples' : 'bitmap-mipmap',
      resourceMap: w.resourceMap,
      fileOffset: w.fileOffset ?? 0,
      size: w.size ?? 0,
      status: identity ? 'verified' : 'unverified',
    });
  }

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
      secondaryClassFourCC: t.secondaryClassFourCC,
      tertiaryClassFourCC: t.tertiaryClassFourCC,
      embeddedRawDataAssets: t.embeddedRawDataAssets.map((a: ExtractedEmbeddedAsset) => ({ kind: a.kind, data: a.data.toString('base64') })),
      embeddedRawDataPatches: t.embeddedRawDataPatches.map((p: ExtractedEmbeddedPatch) => ({ ...p })),
      injectionBlockers: t.injectionBlockers.map((b) => ({ ...b })),
      gbxmodelGeometryParts: t.gbxmodelGeometryParts?.map((p) => ({
        geometryIndex: p.geometryIndex,
        partIndex: p.partIndex,
        vertexType: p.vertexType,
        vertexCount: p.vertexCount,
        vertexData: p.vertexBytes.toString('base64'),
        triangleBufferType: p.triangleBufferType,
        triangleCount: p.triangleCount,
        triangleData: p.triangleBytes.toString('base64'),
      })),
    })),
    notExtracted: set.notExtracted,
    warnings: set.warnings,
    resourceMapIdentities,
    externalResourceRefs,
    externalData: set.tags.some((t) => (t.embeddedRawDataAssets?.length ?? 0) > 0) ? 'embedded' : 'referenced',
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
  if (typeof parsed.formatVersion !== 'number' || parsed.formatVersion < OCETAGS_MIN_SUPPORTED_VERSION || parsed.formatVersion > OCETAGS_FORMAT_VERSION) {
    throw new ContainerFormatError(
      `Unsupported .ocetags format version ${parsed.formatVersion} (this build reads versions ${OCETAGS_MIN_SUPPORTED_VERSION}-${OCETAGS_FORMAT_VERSION}). ` +
        (typeof parsed.formatVersion === 'number' && parsed.formatVersion > OCETAGS_FORMAT_VERSION
          ? 'This container was created by a newer version of OpenCE - update the app.'
          : ''),
    );
  }
  const bspTags = (parsed.tags ?? []).filter((t) => t.group === 'scenario_structure_bsp');
  if (bspTags.length > 0) {
    throw new ContainerHasBspError(bspTags.map((t) => t.path));
  }
  // v1 containers have none of these fields; default them so callers never need a version check.
  parsed.resourceMapIdentities = parsed.resourceMapIdentities ?? {};
  parsed.externalResourceRefs = parsed.externalResourceRefs ?? [];
  parsed.externalData = parsed.externalData === 'embedded' ? 'embedded' : 'referenced';
  return parsed;
}
