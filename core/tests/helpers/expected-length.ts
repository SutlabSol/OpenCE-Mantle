import { resolveStruct, decodeStruct, resolvePointer } from '../../src/map/definitions/engine';

/**
 * Independently re-derives (from `resolveStruct`/`decodeStruct`/`resolvePointer` only - the
 * SAME low-level primitives `tag-extractor.ts` uses, but NOT calling any of its own
 * flatten/capture code) the expected byte length of one extracted tag's flattened buffer:
 * its own struct size, plus every IN-BOUNDS reflexive descendant (recursively - an out-of-bounds
 * reflexive contributes 0 bytes, matching the extractor's skip; deliberately its own inline
 * bounds check, not the shared `isRangeInBuffer` helper), plus every plain
 * (non-external, non-nonCached) TagDataOffset field's size IF its pointer resolves in-bounds
 * (0 otherwise - matching the extractor's own skip-on-unresolvable behavior, not a defect).
 * Labelled "same-reader": this reuses our own definitions engine, so a shared blind spot in
 * both would not be caught - it does NOT independently verify against the real Halo CE engine.
 */
export function computeExpectedExtractedLength(buffer: Buffer, structName: string, fileOffset: number, anchor: number, base: number): number {
  const resolved = resolveStruct(structName);
  if (fileOffset < 0 || fileOffset + resolved.totalSize > buffer.length) return resolved.totalSize;
  const decoded = decodeStruct(buffer, fileOffset, structName);
  let total = resolved.totalSize;
  for (const field of resolved.fields) {
    const value = decoded.get(field.name);
    if (!value || field.def.nonCached) continue;
    if (value.kind === 'reflexive' && value.value.count > 0) {
      const childStructName = field.def.type === 'TagReflexive' ? field.def.struct : undefined;
      if (!childStructName) continue;
      const childSize = resolveStruct(childStructName).totalSize;
      const childBase = resolvePointer(value.value.pointerLow, anchor, base);
      if (childBase < 0 || childBase + value.value.count * childSize > buffer.length) continue; // out-of-bounds reflexive: nothing captured
      for (let i = 0; i < value.value.count; i++) {
        total += childSize + (computeExpectedExtractedLength(buffer, childStructName, childBase + i * childSize, anchor, base) - childSize);
      }
    } else if (value.kind === 'tagDataOffset' && field.def.type === 'TagDataOffset' && !field.def.externalFileOffset && value.value.size > 0) {
      const srcBase = resolvePointer(value.value.pointerLow, anchor, base);
      if (srcBase >= 0 && srcBase + value.value.size <= buffer.length) total += value.value.size;
    }
  }
  return total;
}
