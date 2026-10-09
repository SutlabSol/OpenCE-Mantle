/**
 * Schema for OpenCE's own tag definition data files (`src/map/definitions/groups/*.json`).
 *
 * This describes the SHAPE of the data, not the resolved byte layout - the engine
 * (`engine.ts`) computes offsets/sizes from this data at load time, so there is exactly
 * one place that knows how to turn a field list into byte offsets.
 */

export interface DefinitionEnum {
  kind: 'enum';
  name: string;
  /** Option index == stored integer value (underlying storage is always a 16-bit TagEnum). */
  options: string[];
}

export interface DefinitionBitfield {
  kind: 'bitfield';
  name: string;
  /** Bit width of the underlying unsigned integer: 8, 16, or 32. */
  width: 8 | 16 | 32;
  /** Flag names, bit N == fields[N]. */
  fields: string[];
}

export interface DefinitionPadField {
  kind: 'pad';
  /** Size in bytes of this reserved/unused region. */
  size: number;
}

export interface DefinitionValueField {
  kind: 'field';
  name: string;
  /**
   * Either a basic type name (see `basic-types.ts`), an enum name, a bitfield name,
   * `"TagDependency"`, or `"TagReflexive"`.
   */
  type: string;
  /** Only present when type === "TagDependency": allowed target tag group names. */
  classes?: string[];
  /** Only present when type === "TagReflexive": name of the repeated struct. */
  struct?: string;
  /** Only present when type === "TagReflexive": max element count in the retail engine. */
  maximum?: number;
  /** Only present when type === "TagReflexive": max element count on extended/custom builds. */
  extendedMaximum?: number;
  /** Field is a `Bounds<T>` (two values: from/to), doubling the base type's size. */
  bounds?: boolean;
  /** Field is a fixed-size inline array of `count` elements of `type`. */
  count?: number;
  /** Field is a `FlaggedInt<T>` (same physical size as T; high bit is a flag). */
  flagged?: boolean;
  /** HEK-only: present in .tag files but not meaningful in a compiled cache map. Space is still reserved. */
  nonCached?: boolean;
  /** Cache-only: only meaningful in a compiled cache map, not in a HEK .tag file. Space is still reserved. */
  cacheOnly?: boolean;
  /** Only present when type === "TagDataOffset": the offset is a direct absolute file offset within this map. */
  fileOffset?: boolean;
  /** Only present when type === "TagDataOffset": this data lives in an external resource map (e.g. "sounds.map") when this instance is marked external, not inline in this file. */
  externalFileOffset?: string;
  comment?: string;
}

export type DefinitionField = DefinitionPadField | DefinitionValueField;

export interface DefinitionStruct {
  kind: 'struct';
  name: string;
  /** Name of a parent struct whose fields are physically laid out BEFORE this struct's own fields. */
  inherits?: string;
  /** Present only on the "root" struct of an actual Halo CE tag group (e.g. "weapon", "scenario"). */
  tagClass?: string;
  /** Declared total size in bytes, used as a ground-truth check against the computed layout. */
  sizeBytes?: number;
  /**
   * False if this tag group's data cannot be safely extracted yet (e.g. `scenario_structure_bsp`
   * lives in a separate memory region not yet carried by the extractor). Defaults to extractable
   * (true) when omitted. Checked generically by `tag-extractor.ts` - no hardcoded group names.
   */
  extractable?: boolean;
  /** Required when `extractable === false`: user-facing reason shown in logs/dependency dialog. */
  notExtractableReason?: string;
  fields: DefinitionField[];
}

export type DefinitionEntry = DefinitionEnum | DefinitionBitfield | DefinitionStruct;

/** One parsed `groups/*.json` file: a flat list of enum/bitfield/struct entries. */
export type DefinitionFile = DefinitionEntry[];
