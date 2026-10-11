import { CACHE_FILE_HEADER_SIZE, CacheFileEngine, CacheFileLiteral, CE_BASE_MEMORY_ADDRESS } from '../../constants/cache-file';
import { isChimeraCompressedCustomEdition } from '../header';
import { inferBaseMemoryAddressForClassifier } from '../tag-index';

/**
 * Which cache file layout a buffer has, from the header alone. Used by the Demo/HaloMD -> Custom
 * Edition converter and by the app to decide what to offer for a map the CE reader rejects. It
 * never loosens the CE reader: a map is only edited after `inspectCustomEditionMap` accepts it.
 *
 * Layouts (memory/demo-converter.md, checked against the sample maps):
 *   - Custom Edition: "head"/"foot" at 0x0/0x7FC, version 609 at 0x4.
 *   - Retail layout (HaloMD, PC retail): the same standard header, version 7. Convertible (Phase 1)
 *     when its tag array sits at the CE base (0x40440000 + 0x28).
 *   - True demo layout: "Ehed" at 0x2C0, "Gfot" at 0x5F0, version 6 at 0x588 (base 0x4BF10000).
 *     Needs a pointer rebase (Phase 2), not supported yet.
 */
export type MapLayout =
  | { kind: 'customEdition' }
  | { kind: 'customEditionCompressed' }
  /** `inferredBase` is the reader's guess from the tag array pointer; only 0x40440000 is convertible. */
  | { kind: 'retail'; version: number; inferredBase: number | null }
  | { kind: 'demo'; version: number }
  | { kind: 'otherVersion'; version: number }
  | { kind: 'notAMap' };

const DEMO_HEAD_OFFSET = 0x2c0;
const DEMO_VERSION_OFFSET = 0x588;
const DEMO_FOOT_OFFSET = 0x5f0;

export function classifyMapLayout(buffer: Buffer): MapLayout {
  if (buffer.length < CACHE_FILE_HEADER_SIZE) return { kind: 'notAMap' };
  if (isChimeraCompressedCustomEdition(buffer)) return { kind: 'customEditionCompressed' };
  const standard = buffer.readUInt32LE(0x0) === CacheFileLiteral.HEAD && buffer.readUInt32LE(0x7fc) === CacheFileLiteral.FOOT;
  if (standard) {
    const version = buffer.readUInt32LE(0x4);
    if (version === CacheFileEngine.CUSTOM_EDITION) return { kind: 'customEdition' };
    if (version === CacheFileEngine.RETAIL) {
      const tagDataOffset = buffer.readUInt32LE(0x10);
      const inferredBase = tagDataOffset + 4 <= buffer.length ? inferBaseMemoryAddressForClassifier(buffer.readUInt32LE(tagDataOffset)) : null;
      return { kind: 'retail', version, inferredBase };
    }
    return { kind: 'otherVersion', version };
  }
  if (buffer.readUInt32LE(DEMO_HEAD_OFFSET) === CacheFileLiteral.HEAD_DEMO && buffer.readUInt32LE(DEMO_FOOT_OFFSET) === CacheFileLiteral.FOOT_DEMO) {
    return { kind: 'demo', version: buffer.readUInt32LE(DEMO_VERSION_OFFSET) };
  }
  return { kind: 'notAMap' };
}

/** True for a retail-layout map whose tag array is where a CE map has it, i.e. Phase 1 can convert it. */
export function isConvertibleRetailLayout(layout: MapLayout): boolean {
  return layout.kind === 'retail' && layout.inferredBase === CE_BASE_MEMORY_ADDRESS;
}

/** Plain-language explanation for a map the editor can't open, by layout. */
export function describeUnsupportedLayout(layout: MapLayout): string | null {
  switch (layout.kind) {
    case 'retail':
      return isConvertibleRetailLayout(layout)
        ? 'This is a retail-layout map (cache version 7), for example a HaloMD or Mac demo map. It can be converted to a Custom Edition (609) map with "Convert to Custom Edition...".'
        : `This is a retail-layout map (cache version 7), but its tag data is not at the Custom Edition address (base ${layout.inferredBase === null ? 'unreadable' : `0x${layout.inferredBase.toString(16).toUpperCase()}`}), so it can't be converted.`;
    case 'demo':
      return 'This is an original Halo demo map (true demo layout, cache version 6). Converting this layout to Custom Edition is not supported yet (planned as Phase 2).';
    default:
      return null;
  }
}
