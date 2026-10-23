/**
 * Binary codecs for every basic Halo CE field type (see `basic-types.ts` for sizes/sources).
 * All Custom Edition (PC) cache fields are little-endian, matching the rest of `/core`
 * (see `header.ts`, `tag-index.ts`, which already read everything as `...LE`).
 *
 * Composite types (Point3D, Matrix, etc.) are decoded as plain arrays of numbers rather than
 * named structs - round-trip correctness only depends on byte width + component order being
 * consistent between decode and encode, not on what we call each component. Exact field
 * naming for these can be refined when the M7 field editor needs friendlier shapes.
 */

export type DecodedDependency = { fourcc: number; pathPointer: number; pathSize: number; tagId: number };
export type DecodedReflexive = { count: number; pointerLow: number; pointerHigh: number };
export type DecodedTagDataOffset = { size: number; external: number; fileOffset: number; pointerLow: number; pointerHigh: number };

const FLOAT_COMPOSITE_COMPONENT_COUNT: Record<string, number> = {
  Point2D: 2,
  Point3D: 3,
  Vector2D: 2,
  Vector3D: 3,
  Plane2D: 3,
  Plane3D: 4,
  Euler2D: 2,
  Euler3D: 3,
  Quaternion: 4,
  Matrix: 9,
  ColorRGB: 3,
  ColorARGB: 4,
};

const INT16_COMPOSITE_COMPONENT_COUNT: Record<string, number> = {
  Point2DInt: 2,
  Rectangle2D: 4,
};

export function decodeDependency(buffer: Buffer, offset: number): DecodedDependency {
  return {
    fourcc: buffer.readUInt32LE(offset + 0),
    pathPointer: buffer.readUInt32LE(offset + 4),
    pathSize: buffer.readUInt32LE(offset + 8),
    tagId: buffer.readUInt32LE(offset + 12),
  };
}

export function encodeDependency(buffer: Buffer, offset: number, value: DecodedDependency): void {
  buffer.writeUInt32LE(value.fourcc, offset + 0);
  buffer.writeUInt32LE(value.pathPointer, offset + 4);
  buffer.writeUInt32LE(value.pathSize, offset + 8);
  buffer.writeUInt32LE(value.tagId, offset + 12);
}

export function decodeReflexive(buffer: Buffer, offset: number): DecodedReflexive {
  return {
    count: buffer.readUInt32LE(offset + 0),
    pointerLow: buffer.readUInt32LE(offset + 4),
    pointerHigh: buffer.readUInt32LE(offset + 8),
  };
}

export function encodeReflexive(buffer: Buffer, offset: number, value: DecodedReflexive): void {
  buffer.writeUInt32LE(value.count, offset + 0);
  buffer.writeUInt32LE(value.pointerLow, offset + 4);
  buffer.writeUInt32LE(value.pointerHigh, offset + 8);
}

export function decodeTagDataOffset(buffer: Buffer, offset: number): DecodedTagDataOffset {
  return {
    size: buffer.readUInt32LE(offset + 0),
    external: buffer.readUInt32LE(offset + 4),
    fileOffset: buffer.readUInt32LE(offset + 8),
    pointerLow: buffer.readUInt32LE(offset + 12),
    pointerHigh: buffer.readUInt32LE(offset + 16),
  };
}

export function encodeTagDataOffset(buffer: Buffer, offset: number, value: DecodedTagDataOffset): void {
  buffer.writeUInt32LE(value.size, offset + 0);
  buffer.writeUInt32LE(value.external, offset + 4);
  buffer.writeUInt32LE(value.fileOffset, offset + 8);
  buffer.writeUInt32LE(value.pointerLow, offset + 12);
  buffer.writeUInt32LE(value.pointerHigh, offset + 16);
}

/** Decodes one "unit" (no count/bounds wrapping) of a basic type at `offset`. */
export function decodeBasicUnit(buffer: Buffer, offset: number, type: string): unknown {
  switch (type) {
    case 'int8':
      return buffer.readInt8(offset);
    case 'uint8':
      return buffer.readUInt8(offset);
    case 'int16':
      return buffer.readInt16LE(offset);
    case 'uint16':
    case 'Index':
      return buffer.readUInt16LE(offset);
    case 'int32':
      return buffer.readInt32LE(offset);
    case 'uint32':
    case 'Pointer':
    case 'TagFourCC':
    case 'TagID':
    case 'ColorARGBInt':
      return buffer.readUInt32LE(offset);
    case 'float':
    case 'Angle':
    case 'Fraction':
      return buffer.readFloatLE(offset);
    case 'ScenarioScriptNodeValue':
      return buffer.readUInt32LE(offset);
    case 'TagString': {
      const raw = Buffer.from(buffer.subarray(offset, offset + 32));
      const nullIndex = raw.indexOf(0);
      const text = (nullIndex === -1 ? raw : raw.subarray(0, nullIndex)).toString('ascii');
      // `raw` is kept (not just `text`) so re-encoding is byte-perfect even if the compiled
      // tag has non-zero bytes after the null terminator (uninitialized tool.exe memory).
      return { text, raw };
    }
  }
  if (type in FLOAT_COMPOSITE_COMPONENT_COUNT) {
    const n = FLOAT_COMPOSITE_COMPONENT_COUNT[type];
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(buffer.readFloatLE(offset + i * 4));
    return out;
  }
  if (type in INT16_COMPOSITE_COMPONENT_COUNT) {
    const n = INT16_COMPOSITE_COMPONENT_COUNT[type];
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(buffer.readInt16LE(offset + i * 2));
    return out;
  }
  throw new Error(`decodeBasicUnit: unknown basic type "${type}"`);
}

export function encodeBasicUnit(buffer: Buffer, offset: number, type: string, value: unknown): void {
  switch (type) {
    case 'int8':
      buffer.writeInt8(value as number, offset);
      return;
    case 'uint8':
      buffer.writeUInt8(value as number, offset);
      return;
    case 'int16':
      buffer.writeInt16LE(value as number, offset);
      return;
    case 'uint16':
    case 'Index':
      buffer.writeUInt16LE(((value as number) < 0 ? 0xffff : (value as number)) & 0xffff, offset);
      return;
    case 'int32':
      buffer.writeInt32LE(value as number, offset);
      return;
    case 'uint32':
    case 'Pointer':
    case 'TagFourCC':
    case 'TagID':
    case 'ColorARGBInt':
      buffer.writeUInt32LE(value as number, offset);
      return;
    case 'float':
    case 'Angle':
    case 'Fraction':
      buffer.writeFloatLE(value as number, offset);
      return;
    case 'ScenarioScriptNodeValue':
      buffer.writeUInt32LE(value as number, offset);
      return;
    case 'TagString': {
      const v = value as { text: string; raw?: Buffer };
      if (v.raw) {
        v.raw.copy(buffer, offset);
        return;
      }
      buffer.fill(0, offset, offset + 32);
      const bytes = Buffer.from(v.text, 'ascii').subarray(0, 31);
      bytes.copy(buffer, offset);
      return;
    }
  }
  if (type in FLOAT_COMPOSITE_COMPONENT_COUNT) {
    const arr = value as number[];
    for (let i = 0; i < arr.length; i++) buffer.writeFloatLE(arr[i], offset + i * 4);
    return;
  }
  if (type in INT16_COMPOSITE_COMPONENT_COUNT) {
    const arr = value as number[];
    for (let i = 0; i < arr.length; i++) buffer.writeInt16LE(arr[i], offset + i * 2);
    return;
  }
  throw new Error(`encodeBasicUnit: unknown basic type "${type}"`);
}
