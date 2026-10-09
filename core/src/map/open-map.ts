import { isChimeraCompressedCustomEdition, parseCacheFileHeader } from './header';
import { parseTagIndex } from './tag-index';
import type { CacheFileHeader } from './header';
import type { TagIndex } from './tag-index';
import { CompressedMapError, UnsupportedMapVersionError } from './errors';

export type MapInspection =
  | { status: 'ok'; header: CacheFileHeader; tagIndex: TagIndex }
  | { status: 'compressed' }
  | { status: 'unsupported'; message: string };

/**
 * Top-level Milestone 1 entry point: inspect a buffer and either fully parse it (header +
 * tag index) or report why it can't be parsed yet (compressed -> Milestone 2, or an
 * out-of-scope map version). Never throws for expected/known conditions; only throws
 * CorruptMapError for files that are not valid Halo maps at all.
 */
export function inspectCustomEditionMap(buffer: Buffer): MapInspection {
  if (isChimeraCompressedCustomEdition(buffer)) {
    return { status: 'compressed' };
  }

  try {
    const header = parseCacheFileHeader(buffer);
    const tagIndex = parseTagIndex(buffer, header);
    return { status: 'ok', header, tagIndex };
  } catch (error) {
    if (error instanceof UnsupportedMapVersionError) {
      return { status: 'unsupported', message: error.message };
    }
    throw error;
  }
}
