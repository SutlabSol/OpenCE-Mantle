/**
 * Fixed byte sizes for the basic (non enum/bitfield/compound) Halo CE tag field types.
 *
 * SOURCES (read this session):
 * - invader/include/invader/hek/data_type.hpp (SnowyMouse/invader, commit 696830f, GPL-3.0,
 *   reference only): typedefs (`Angle`/`Fraction` = float, `Index` = uint16) and
 *   `static_assert(sizeof(...) == 0x..)` checks for every compound type below.
 * - TagDependency / TagReflexive sizes cross-checked against
 *   reclaimer/reclaimer/common_descs.py (Sigmmma/reclaimer, commit a0a56ca, GPL-3.0,
 *   reference only): `dependency()` helper = 16 bytes, `reflexive()` helper = `SIZE=12`.
 *   Both sources agree exactly.
 */
export const BASIC_TYPE_SIZES: Record<string, number> = {
  int8: 1,
  uint8: 1,
  int16: 2,
  uint16: 2,
  Index: 2,
  int32: 4,
  uint32: 4,
  float: 4,
  Angle: 4,
  Fraction: 4,
  Pointer: 4,
  TagFourCC: 4,
  TagID: 4,
  TagString: 32,
  Point2D: 8,
  Point2DInt: 4,
  Point3D: 12,
  Vector2D: 8,
  Vector3D: 12,
  Plane2D: 12,
  Plane3D: 16,
  Euler2D: 8,
  Euler3D: 12,
  Quaternion: 16,
  Matrix: 36,
  ColorRGB: 12,
  ColorARGB: 16,
  ColorARGBInt: 4,
  Rectangle2D: 8,
  /** `TagDependency<EndianType>`: fourcc(4) + path_pointer(4) + path_size(4) + tag_id(4). */
  TagDependency: 16,
  /** `TagReflexive<...>` block header: count(4) + pointer(8, zero/unused on disk). */
  TagReflexive: 12,
  /** `TagDataOffset<EndianType>`: size(4) + external/flags(4) + file_offset(4) + pointer(8). */
  TagDataOffset: 20,
  /** `ScenarioScriptNodeValue` union (bool/short/long/float/TagID share one 4-byte slot). */
  ScenarioScriptNodeValue: 4,
};

/** Sub-field byte offsets within a `TagDataOffset` (used to resolve data in external resource maps). */
export const TAG_DATA_OFFSET_LAYOUT = {
  size: 0,
  external: 4,
  fileOffset: 8,
  pointer: 12,
} as const;
