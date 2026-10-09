/**
 * Small helpers for reading fixed-length ASCII strings out of Buffers.
 * Halo CE `TagString` fields are fixed-size, null-terminated (and null-padded) char arrays.
 */

export function readFixedString(buffer: Buffer, offset: number, length: number): string {
  const slice = buffer.subarray(offset, offset + length);
  const nullIndex = slice.indexOf(0);
  const trimmed = nullIndex === -1 ? slice : slice.subarray(0, nullIndex);
  return trimmed.toString('ascii');
}

export function writeFixedString(buffer: Buffer, offset: number, length: number, value: string): void {
  buffer.fill(0, offset, offset + length);
  const bytes = Buffer.from(value, 'ascii').subarray(0, length - 1);
  bytes.copy(buffer, offset);
}

/** Reads a null-terminated ASCII string starting at `offset`, with no fixed max length. */
export function readCString(buffer: Buffer, offset: number): string {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) {
    end++;
  }
  return buffer.toString('ascii', offset, end);
}
