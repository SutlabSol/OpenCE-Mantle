#!/usr/bin/env node
/**
 * One-time/offline generator: converts Invader's tag definition JSON files
 * (read directly from a local clone of https://github.com/SnowyMouse/invader)
 * into OpenCE's own normalized definition schema under
 * `src/map/definitions/groups/*.json`.
 *
 * This does NOT copy Invader's files; it transcribes the same facts (field
 * names, types, enum options, bitfield widths, struct sizes) into our own
 * JSON shape, matching the `DefinitionEntry` types in `types.ts`.
 *
 * Byte offsets are intentionally NOT computed here - the runtime engine
 * (`engine.ts`) computes them from this data and validates against
 * `sizeBytes`, so there is a single source of truth for the layout algorithm.
 *
 * Usage: clone invader locally, then run:
 *   INVADER_DIR=/tmp/invader/src/tag/hek/definition node scripts/generate-definitions.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INVADER_DIR = process.env.INVADER_DIR ?? '/tmp/invader/src/tag/hek/definition';
const OUT_DIR = path.resolve(__dirname, '../src/map/definitions/groups');

function convertField(f) {
  if (f.type === 'pad') {
    return { kind: 'pad', size: f.size };
  }
  const out = { kind: 'field', name: f.name, type: f.type };
  if (f.classes) out.classes = f.classes;
  if (f.struct) out.struct = f.struct;
  if (f.maximum !== undefined) out.maximum = f.maximum;
  if (f.extended_maximum !== undefined) out.extendedMaximum = f.extended_maximum;
  if (f.bounds) out.bounds = true;
  if (f.count !== undefined) out.count = f.count;
  if (f.flagged) out.flagged = true;
  if (f.non_cached) out.nonCached = true;
  if (f.cache_only === true) out.cacheOnly = true;
  if (f.file_offset) out.fileOffset = true;
  if (f.external_file_offset) out.externalFileOffset = f.external_file_offset;
  if (f.comment) out.comment = f.comment;
  return out;
}

function convertEntry(e) {
  if (e.type === 'enum') {
    return { kind: 'enum', name: e.name, options: e.options };
  }
  if (e.type === 'bitfield') {
    return { kind: 'bitfield', name: e.name, width: e.width, fields: e.fields };
  }
  const out = { kind: 'struct', name: e.name, fields: e.fields.map(convertField) };
  if (e.inherits) out.inherits = e.inherits;
  if (e.class) out.tagClass = e.class;
  if (e.size !== undefined) out.sizeBytes = e.size;
  return out;
}

if (!fs.existsSync(INVADER_DIR)) {
  console.error(`Invader definitions directory not found: ${INVADER_DIR}`);
  console.error('Clone it first: git clone https://github.com/SnowyMouse/invader.git /tmp/invader');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const files = fs.readdirSync(INVADER_DIR).filter((f) => f.endsWith('.json'));
let totalEntries = 0;
for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(INVADER_DIR, file), 'utf8'));
  const entries = data.map(convertEntry);
  totalEntries += entries.length;
  fs.writeFileSync(path.join(OUT_DIR, file), JSON.stringify(entries, null, 2) + '\n');
}
console.log(`Converted ${files.length} definition files (${totalEntries} enum/bitfield/struct entries) into ${OUT_DIR}`);
