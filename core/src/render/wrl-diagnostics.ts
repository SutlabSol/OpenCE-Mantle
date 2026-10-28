/**
 * Halo 1 Tool WRL 1.0 (VRML 1.0 ascii) 3D Error Geometry Reader, Submesh Matcher,
 * and `tool.exe` / `debug.txt` Log Diagnostic Classifier.
 *
 * Adapted from Project Guilty Spark (`haloWrl.ts`, `haloWrlSourceMatch.ts`, `haloToolDiagnostics.ts`).
 * Reference: https://c20.reclaimers.net/general/source-data/wrl/
 */

export type WrlVec3 = [number, number, number];

export interface WrlPoint {
  position: WrlVec3;
  color: WrlVec3;
  region: number;
}

export interface WrlSegment {
  start: WrlVec3;
  end: WrlVec3;
  color: WrlVec3;
  region: number;
}

export interface WrlFace {
  a: WrlVec3;
  b: WrlVec3;
  c: WrlVec3;
  vertices: [WrlVec3, WrlVec3, WrlVec3];
  centroid: WrlVec3;
  color: WrlVec3;
  region: number;
}

export interface WrlRegionSummary {
  index: number;
  segmentCount: number;
  faceCount: number;
  bounds: { min: WrlVec3; max: WrlVec3 };
  center: WrlVec3;
  primaryColor: WrlVec3;
}

export interface WrlDiagnostics {
  format: 'Halo Tool VRML 1.0';
  points: WrlPoint[];
  segments: WrlSegment[];
  faces: WrlFace[];
  regions: number;
  regionSummaries: WrlRegionSummary[];
  bounds: { min: WrlVec3; max: WrlVec3 };
  /** 0.01 converts Halo Tool's source centimetres into Halo world units. */
  coordinateScale: number;
  notes: string[];
}

const MAX_FILE = 4 * 1024 * 1024;
const MAX_REGIONS = 512;
const MAX_VERTICES = 120000;
const MAX_PRIMITIVES = 150000;
const MAX_FAN = 256;
const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function extractBlock(source: string, name: string, startAt = 0): { text: string; end: number } | null {
  const token = new RegExp(`\\b${name}\\s*\\{`, 'g');
  token.lastIndex = startAt;
  const match = token.exec(source);
  if (!match) return null;
  const left = source.indexOf('{', match.index);
  let depth = 1;
  for (let i = left + 1; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) {
      return { text: source.slice(left + 1, i), end: i + 1 };
    }
  }
  throw new Error(`Malformed WRL: unclosed ${name} block`);
}

function arrayInBlock(source: string, name: string): string {
  const found = new RegExp(`\\b${name}\\s*\\[([^\\]]*)\\]`).exec(source);
  if (!found) throw new Error(`Malformed WRL: missing ${name} array`);
  return found[1];
}

function parseNumericArray(source: string, max: number): number[] {
  const tokens = source.trim().split(/[\s,]+/).filter(Boolean);
  if (!tokens.length || tokens.length > max) {
    throw new Error('WRL numeric array is empty or exceeds safety limits');
  }
  return tokens.map((token) => {
    if (!NUMBER_RE.test(token)) throw new Error('WRL contains invalid numeric text');
    const value = Number(token);
    if (!Number.isFinite(value) || Math.abs(value) > 10_000_000) {
      throw new Error('WRL coordinate or number exceeds safety bounds');
    }
    return value;
  });
}

function toVec3Tuples(values: number[], label: string): WrlVec3[] {
  if (values.length % 3 !== 0) {
    throw new Error(`WRL ${label} must contain complete coordinate triplets`);
  }
  return Array.from({ length: values.length / 3 }, (_, i) => [
    values[3 * i],
    values[3 * i + 1],
    values[3 * i + 2],
  ]);
}

function parseIndexSpans(values: number[], vertexCount: number): number[][] {
  const spans: number[][] = [];
  let current: number[] = [];
  for (const v of values) {
    if (!Number.isSafeInteger(v)) {
      throw new Error('WRL coordinates must be addressed with integer indices');
    }
    if (v === -1) {
      if (!current.length) throw new Error('WRL has an empty indexed span');
      if (current.length > MAX_FAN) throw new Error('WRL polygon/line span exceeds limit');
      spans.push(current);
      current = [];
    } else {
      if (v < 0 || v >= vertexCount) {
        throw new Error('WRL index refers to nonexistent coordinate');
      }
      current.push(v);
    }
    if (spans.length > MAX_PRIMITIVES) {
      throw new Error('WRL contains too many error elements');
    }
  }
  if (current.length) throw new Error('WRL indexed span lacks -1 terminator');
  return spans;
}

function parseMaterialColors(section: string): WrlVec3[] {
  const material = extractBlock(section, 'Material');
  if (!material) return [[1, 0, 0]];
  const source = /\bdiffuseColor\s*\[/.test(material.text)
    ? arrayInBlock(material.text, 'diffuseColor')
    : '';
  if (!source) return [[1, 0, 0]];
  const out = toVec3Tuples(parseNumericArray(source, MAX_PRIMITIVES * 3), 'color');
  if (out.some((rgb) => rgb.some((v) => v < 0 || v > 1))) {
    throw new Error('WRL color values must be in 0..1');
  }
  return out;
}

function parseCoordinateList(section: string): WrlVec3[] {
  const coords = extractBlock(section, 'Coordinate3');
  if (!coords) throw new Error('WRL Separator is missing Coordinate3');
  return toVec3Tuples(parseNumericArray(arrayInBlock(coords.text, 'point'), MAX_VERTICES * 3), 'point');
}

/**
 * Parses a Halo 1 Tool `#VRML 1.0 ascii` diagnostic `.wrl` file into world-unit 3D error segments and faces.
 */
export function parseHaloWrl(text: string, sourceCentimetres = true): WrlDiagnostics {
  if (typeof text !== 'string' || !text.length || text.length > MAX_FILE) {
    throw new Error('Halo WRL must be a nonempty text file smaller than 4 MiB');
  }
  if (!/^\s*#VRML 1\.0 ascii(?:\s|$)/i.test(text)) {
    throw new Error('Only Halo 1 Tool #VRML 1.0 ascii diagnostic files are supported.');
  }
  const source = text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, ''))
    .join('\n');
  const scale = sourceCentimetres ? 0.01 : 1;
  let searchAt = 0;
  let regions = 0;
  let totalVertices = 0;
  const segments: WrlSegment[] = [];
  const faces: WrlFace[] = [];
  const regionSummaries: WrlRegionSummary[] = [];
  const min: WrlVec3 = [Infinity, Infinity, Infinity];
  const max: WrlVec3 = [-Infinity, -Infinity, -Infinity];

  while (true) {
    const region = extractBlock(source, 'Separator', searchAt);
    if (!region) break;
    searchAt = region.end;
    const regionIndex = regions++;
    if (regions > MAX_REGIONS) throw new Error('WRL contains too many error regions');

    const vertices = parseCoordinateList(region.text).map(
      (coords) => [coords[0] * scale, coords[1] * scale, coords[2] * scale] as WrlVec3,
    );
    totalVertices += vertices.length;
    if (totalVertices > MAX_VERTICES) throw new Error('WRL exceeds vertex safety budget');

    const binding = extractBlock(region.text, 'MaterialBinding');
    const perVertex = !!binding && /\bPER_VERTEX\b/.test(binding.text);
    const palette = parseMaterialColors(region.text);
    const colorFor = (element: number, vertex: number): WrlVec3 =>
      palette[perVertex ? vertex : element] ?? palette[0] ?? [1, 0, 0];

    const rMin: WrlVec3 = [Infinity, Infinity, Infinity];
    const rMax: WrlVec3 = [-Infinity, -Infinity, -Infinity];
    let rSegments = 0;
    let rFaces = 0;

    const touch = (p: WrlVec3) => {
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], p[i]);
        max[i] = Math.max(max[i], p[i]);
        rMin[i] = Math.min(rMin[i], p[i]);
        rMax[i] = Math.max(rMax[i], p[i]);
      }
    };

    const lines = extractBlock(region.text, 'IndexedLineSet');
    if (lines) {
      const spans = parseIndexSpans(
        parseNumericArray(arrayInBlock(lines.text, 'coordIndex'), MAX_PRIMITIVES * 4),
        vertices.length,
      );
      spans.forEach((span, index) => {
        if (span.length < 2) throw new Error('WRL IndexedLineSet requires at least two vertices');
        for (let i = 1; i < span.length; i++) {
          const start = vertices[span[i - 1]];
          const end = vertices[span[i]];
          segments.push({ start, end, color: colorFor(index, span[i - 1]), region: regionIndex });
          rSegments++;
          touch(start);
          touch(end);
          if (segments.length + faces.length > MAX_PRIMITIVES) {
            throw new Error('WRL error geometry exceeds preview budget');
          }
        }
      });
    }

    const polygons = extractBlock(region.text, 'IndexedFaceSet');
    if (polygons) {
      const spans = parseIndexSpans(
        parseNumericArray(arrayInBlock(polygons.text, 'coordIndex'), MAX_PRIMITIVES * 4),
        vertices.length,
      );
      spans.forEach((span, index) => {
        if (span.length < 3) throw new Error('WRL IndexedFaceSet requires at least three vertices');
        for (let i = 1; i < span.length - 1; i++) {
          const a = vertices[span[0]];
          const b = vertices[span[i]];
          const c = vertices[span[i + 1]];
          const centroid: WrlVec3 = [
            (a[0] + b[0] + c[0]) / 3,
            (a[1] + b[1] + c[1]) / 3,
            (a[2] + b[2] + c[2]) / 3,
          ];
          faces.push({
            a,
            b,
            c,
            vertices: [a, b, c],
            centroid,
            color: colorFor(index, span[0]),
            region: regionIndex,
          });
          rFaces++;
          touch(a);
          touch(b);
          touch(c);
          if (segments.length + faces.length > MAX_PRIMITIVES) {
            throw new Error('WRL error geometry exceeds preview budget');
          }
        }
      });
    }

    if (rSegments > 0 || rFaces > 0) {
      regionSummaries.push({
        index: regionIndex,
        segmentCount: rSegments,
        faceCount: rFaces,
        bounds: { min: rMin, max: rMax },
        center: [
          (rMin[0] + rMax[0]) * 0.5,
          (rMin[1] + rMax[1]) * 0.5,
          (rMin[2] + rMax[2]) * 0.5,
        ],
        primaryColor: palette[0] ?? [1, 0, 0],
      });
    }
  }

  if (!regions || (!segments.length && !faces.length)) {
    throw new Error('WRL has no supported Halo 1 error geometry (IndexedLineSet/IndexedFaceSet)');
  }

  return {
    format: 'Halo Tool VRML 1.0',
    points: [],
    segments,
    faces,
    regions,
    regionSummaries,
    bounds: { min, max },
    coordinateScale: scale,
    notes: [
      'WRL is diagnostic geometry generated by Halo Tool (red = open edges, yellow/magenta = intersecting/degenerate faces, cyan = portal errors).',
      sourceCentimetres
        ? 'Halo Tool centimetres scaled by 0.01 to match Halo world units.'
        : 'Coordinates displayed 1:1 as provided.',
    ],
  };
}

/* ------------------- WRL-to-Submesh / Brush Proximity Matcher ------------------- */

export interface WrlSubmeshCandidate {
  partId: string;
  submeshIndex: number;
  matchedPoints: number;
  diagnosticSamples: number;
  closestDistance: number;
}

export type WrlSubmeshMatch = WrlSubmeshCandidate;

export interface WrlSubmeshAssociation extends Array<WrlSubmeshCandidate> {
  sampledPrimitives: number;
  totalPrimitives: number;
  ambiguousPrimitives: number;
  unmatchedPrimitives: number;
  candidates: WrlSubmeshCandidate[];
}

interface PartBounds {
  id: string;
  submeshIndex?: number;
  min: WrlVec3;
  max: WrlVec3;
}

const MAX_SAMPLES = 192;
const MAX_MATCH_DISTANCE_SQ = 0.25 ** 2;
const MIN_BETTER_THAN_NEXT_SQ = 1e-6;

function distanceSquaredToBox(p: WrlVec3, bounds: PartBounds): number {
  let total = 0;
  for (let i = 0; i < 3; i++) {
    const gap = p[i] < bounds.min[i] ? bounds.min[i] - p[i] : p[i] > bounds.max[i] ? p[i] - bounds.max[i] : 0;
    total += gap * gap;
  }
  return total;
}

function primitivePoints(wrl: Pick<WrlDiagnostics, 'segments' | 'faces'>, i: number): WrlVec3[] {
  if (i < wrl.segments.length) {
    const edge = wrl.segments[i];
    return [
      edge.start,
      edge.end,
      [(edge.start[0] + edge.end[0]) * 0.5, (edge.start[1] + edge.end[1]) * 0.5, (edge.start[2] + edge.end[2]) * 0.5],
    ];
  }
  const face = wrl.faces[i - wrl.segments.length];
  return [
    face.a,
    face.b,
    face.c,
    [(face.a[0] + face.b[0] + face.c[0]) / 3, (face.a[1] + face.b[1] + face.c[1]) / 3, (face.a[2] + face.b[2] + face.c[2]) / 3],
  ];
}

/**
 * Associates parsed `.wrl` error geometry with specific BSP/model submesh bounding boxes.
 * Supports both `(submeshBounds, wrl)` and `(wrl, submeshes)` parameter orders.
 */
export function matchWrlToSubmeshes(
  first:
    | PartBounds[]
    | Pick<WrlDiagnostics, 'segments' | 'faces'>,
  second:
    | Pick<WrlDiagnostics, 'segments' | 'faces'>
    | Array<{ positions?: ArrayLike<number>; vertices?: ArrayLike<number>; shaderPath?: string; index?: number }>,
): WrlSubmeshAssociation {
  let submeshBounds: PartBounds[];
  let wrl: Pick<WrlDiagnostics, 'segments' | 'faces'>;

  if (Array.isArray(first)) {
    submeshBounds = first;
    wrl = second as Pick<WrlDiagnostics, 'segments' | 'faces'>;
  } else {
    wrl = first;
    const rawList = Array.isArray(second) ? second : [];
    submeshBounds = rawList.map((sm, idx) => {
      const min: WrlVec3 = [Infinity, Infinity, Infinity];
      const max: WrlVec3 = [-Infinity, -Infinity, -Infinity];
      const pos = sm.positions ?? sm.vertices;
      const step = sm.positions ? 3 : pos && pos.length % 8 === 0 ? 8 : 3;
      if (pos) {
        for (let i = 0; i + 2 < pos.length; i += step) {
          if (pos[i] < min[0]) min[0] = pos[i];
          if (pos[i + 1] < min[1]) min[1] = pos[i + 1];
          if (pos[i + 2] < min[2]) min[2] = pos[i + 2];
          if (pos[i] > max[0]) max[0] = pos[i];
          if (pos[i + 1] > max[1]) max[1] = pos[i + 1];
          if (pos[i + 2] > max[2]) max[2] = pos[i + 2];
        }
      }
      return {
        id: sm.shaderPath ?? `submesh_${sm.index ?? idx}`,
        submeshIndex: sm.index ?? idx,
        min,
        max,
      };
    });
  }

  const total = wrl.segments.length + wrl.faces.length;
  if (!total || !submeshBounds.length) {
    const empty = Object.assign([] as WrlSubmeshCandidate[], {
      sampledPrimitives: 0,
      totalPrimitives: total,
      ambiguousPrimitives: 0,
      unmatchedPrimitives: 0,
      candidates: [] as WrlSubmeshCandidate[],
    });
    return empty;
  }
  const stride = Math.max(1, Math.ceil(total / MAX_SAMPLES));
  const tally = new Map<string, { count: number; closest: number; submeshIndex: number }>();
  let sampled = 0;
  let ambiguous = 0;
  let unmatched = 0;

  for (let i = 0; i < total; i += stride) {
    const points = primitivePoints(wrl, i);
    sampled++;
    let best: PartBounds | null = null;
    let bestIdx = 0;
    let bestScore = Infinity;
    let secondBest = Infinity;
    for (let bIdx = 0; bIdx < submeshBounds.length; bIdx++) {
      const box = submeshBounds[bIdx];
      const score = Math.min(...points.map((p) => distanceSquaredToBox(p, box)));
      if (score < bestScore) {
        secondBest = bestScore;
        bestScore = score;
        best = box;
        bestIdx = box.submeshIndex ?? bIdx;
      } else if (score < secondBest) {
        secondBest = score;
      }
    }
    if (!best || bestScore > MAX_MATCH_DISTANCE_SQ) {
      unmatched++;
      continue;
    }
    if (secondBest - bestScore <= MIN_BETTER_THAN_NEXT_SQ) {
      ambiguous++;
      continue;
    }
    const value = tally.get(best.id) ?? { count: 0, closest: Infinity, submeshIndex: bestIdx };
    value.count++;
    value.closest = Math.min(value.closest, Math.sqrt(bestScore));
    tally.set(best.id, value);
  }

  const candidates: WrlSubmeshCandidate[] = [...tally.entries()]
    .map(([partId, score]) => ({
      partId,
      submeshIndex: score.submeshIndex,
      matchedPoints: score.count,
      diagnosticSamples: score.count,
      closestDistance: score.closest,
    }))
    .sort(
      (a, b) =>
        b.diagnosticSamples - a.diagnosticSamples ||
        a.closestDistance - b.closestDistance ||
        a.partId.localeCompare(b.partId),
    )
    .slice(0, 10);

  return Object.assign([...candidates], {
    sampledPrimitives: sampled,
    totalPrimitives: total,
    ambiguousPrimitives: ambiguous,
    unmatchedPrimitives: unmatched,
    candidates,
  });
}

/* ------------------- Halo 1 Tool Log Classifier ------------------- */

export interface ToolDiagnostic {
  line: number;
  level: 'error' | 'warning';
  severity: 'error' | 'warning';
  code: string;
  message: string;
  summary: string;
  action: string;
  recommendedFix: string;
  wrlUseful: boolean;
}

export interface ToolLogReview {
  diagnostics: ToolDiagnostic[];
  errorCount: number;
  warningCount: number;
  unclassified: number;
  containsFatal: boolean;
  textLines: number;
  note: string;
}

const KNOWN_TOOL_PATTERNS: { id: string; pattern: RegExp; action: string; wrl: boolean }[] = [
  {
    id: 'BSP_DEPTH',
    pattern: /global_plane_count\s*<\s*MAXIMUM_BSP3D_DEPTH|couldn.t build leaf map/i,
    action: 'Collision BSP partitioning exceeded engine depth. Simplify dense geometry and complex curved collision.',
    wrl: false,
  },
  {
    id: 'EMPTY_COLLISION',
    pattern: /collision bsp is empty/i,
    action: 'This mesh has no collidable geometry. Verify at least one sealed, collision-enabled shell instead of only render-only (!) surfaces.',
    wrl: false,
  },
  {
    id: 'BSP_DIVIDING_EDGE',
    pattern: /dividing_edge->vertex_indices\[1\]\s*==\s*NONE/i,
    action: 'Investigate near-coplanar or rounding-unstable collision faces around the affected area and recheck scale.',
    wrl: false,
  },
  {
    id: 'BSP_TOO_SMALL',
    pattern: /not a valid structure_bsp_cluster_block index/i,
    action: 'Examine tiny or degenerate level scale and overlapping source faces.',
    wrl: false,
  },
  {
    id: 'PHANTOM_COLLISION',
    pattern: /\bphantom bsp\b/i,
    action: 'Near-coplanar or micro-sliver triangles caused phantom collision planes. Flatten coplanar faces and remove sliver triangles.',
    wrl: false,
  },
  {
    id: 'OPEN_EDGE',
    pattern: /\bopen edge\b|\bedge(?:\s+#?\d+)?\s+is\s+open\b/i,
    action: 'Seal the affected collision shell or mark decorative meshes with the render-only (!) material symbol. Inspect red edges in the WRL overlay.',
    wrl: true,
  },
  {
    id: 'NON_MANIFOLD',
    pattern: /\bcouldn.t update edge\b|\bmore than 2 faces\b/i,
    action: 'Three or more faces share a single edge, or adjacent faces have reversed normals. Inspect the WRL overlay.',
    wrl: true,
  },
  {
    id: 'INTERSECTING_FACES',
    pattern: /\bz-buffered triangle\b|\bintersecting surfaces?\b/i,
    action: 'Two collision triangles intersect without shared vertices. Weld or boolean-join them into connected topology.',
    wrl: true,
  },
  {
    id: 'RADIOSITY_UVS',
    pattern: /\bdegenerate triangle or triangle with bad uvs\b/i,
    action: 'Lightmap UVs are collapsed/collinear on a face (or a flat-shaded # material is missing UVs). Re-unwrap the highlighted WRL faces.',
    wrl: true,
  },
  {
    id: 'DEGENERATE',
    pattern: /\bdegenerate triangles?\b|\bzero.area\b/i,
    action: 'Locate collapsed or zero-area triangles in the WRL overlay and merge/retriangulate their vertices.',
    wrl: true,
  },
  {
    id: 'COPLANAR',
    pattern: /\bnearly coplanar\b/i,
    action: 'Snap nearly-coplanar adjacent faces to the exact same plane or increase the angle between them.',
    wrl: true,
  },
  {
    id: 'PORTAL',
    pattern: /\bportal.*(?:closed spaces|outside the bsp|divid|edge|leak|unearthed)\b/i,
    action: 'Verify +portal planes divide apprehension-sealed clusters cleanly and extend slightly into the surrounding BSP walls.',
    wrl: true,
  },
  {
    id: 'COLLISION',
    pattern: /\b(?:failed|could not|couldn.t) (?:to )?(?:import|build) collision\b/i,
    action: 'Downstream collision build failure: fix the preceding open-edge, non-manifold, or intersecting-face errors first.',
    wrl: true,
  },
  {
    id: 'JMS_VERSION',
    pattern: /\bwrong version number\b/i,
    action: 'Ensure JMS file header starts with version 8200 for Halo 1.',
    wrl: false,
  },
  {
    id: 'JMS_TRUNCATED',
    pattern: /\breached end of file during parse\b/i,
    action: 'JMS file was truncated during export. Re-export and verify vertex/triangle counts.',
    wrl: false,
  },
  {
    id: 'TAG_TRUNCATED',
    pattern: /\bcouldn.t read .*bytes from offset\b|\bcouldn.t read elements\b/i,
    action: 'A referenced tag file is truncated or corrupted.',
    wrl: false,
  },
  {
    id: 'PVS',
    pattern: /\breimported for new, faster visibility\b/i,
    action: 'Check floating visibility clusters and portal seals.',
    wrl: false,
  },
  {
    id: 'T_JUNCTION',
    pattern: /\bfound possible t.junction\b/i,
    action: 'A vertex lies in the middle of an adjacent triangle edge without splitting it. Connect the vertex to split the adjacent triangle.',
    wrl: true,
  },
  {
    id: 'BSP_OVERLAP',
    pattern: /\bcouldn.t build bsp because of overlapping surfaces\b/i,
    action: 'Two collidable surfaces are coplanar and overlapping. Delete duplicate faces.',
    wrl: true,
  },
  {
    id: 'VERTEX_BOUNDS',
    pattern: /\bvertex has a bad point\b/i,
    action: 'A vertex exceeds Halo 1 world coordinate bounds. Check mesh scale and distance from origin.',
    wrl: false,
  },
  {
    id: 'PORTAL_DUPLICATE',
    pattern: /\bfound duplicate triangle building connected geometry\b/i,
    action: 'Remove duplicate +portal faces highlighted in the WRL overlay.',
    wrl: true,
  },
  {
    id: 'CLUSTER_COMPLEXITY',
    pattern: /\bcouldn.t allocate subcluster\b/i,
    action: 'A single visibility cluster contains too many triangles. Add +portal planes or simplify geometry.',
    wrl: false,
  },
  {
    id: 'SKY_CLUSTER',
    pattern: /\bcluster can see multiple skies\b/i,
    action: 'Ensure a cluster only has line-of-sight to one +sky index, or separate sky regions with portals.',
    wrl: false,
  },
  {
    id: 'PORTAL_UNEARTHED',
    pattern: /\bunearthed edge\b/i,
    action: 'Seal the +portal outer edges into the BSP wall geometry or connect them to adjacent portal edges.',
    wrl: true,
  },
];

/**
 * Classifies `tool.exe` console output or `debug.txt` log text into structured error codes and fix actions.
 */
export function analyzeHaloToolLog(input: string): ToolLogReview {
  if (typeof input !== 'string' || input.length > 1024 * 1024 || !input.trim()) {
    throw new Error('Tool log must be nonempty and smaller than 1 MiB');
  }
  if (input.includes('\0')) {
    throw new Error('Binary data is not a supported Halo Tool text log');
  }
  const lines = input.split(/\r?\n/);
  if (lines.length > 25000) {
    throw new Error('Tool log has too many lines');
  }
  const diagnostics: ToolDiagnostic[] = [];
  let unclassified = 0;
  let unclassifiedErrors = 0;

  lines.forEach((line, index) => {
    const isError = /\b(?:###\s*)?(?:error|exception|fatal)\b/i.test(line);
    const isWarning = /\bwarning\b/i.test(line);
    const item = KNOWN_TOOL_PATTERNS.find((k) => k.pattern.test(line));
    if (!item && (isError || isWarning)) {
      unclassified++;
      if (isError) unclassifiedErrors++;
    }
    if (!item) return;
    if (diagnostics.length >= 256) return;
    const sev: 'error' | 'warning' = isError ? 'error' : 'warning';
    const msg = line.trim().slice(0, 500);
    diagnostics.push({
      line: index + 1,
      level: sev,
      severity: sev,
      code: item.id,
      message: msg,
      summary: msg,
      action: item.action,
      recommendedFix: item.action,
      wrlUseful: item.wrl,
    });
  });

  const errorCount = diagnostics.filter((d) => d.level === 'error').length + unclassifiedErrors;
  const warningCount = diagnostics.filter((d) => d.level === 'warning').length + (unclassified - unclassifiedErrors);

  return {
    diagnostics,
    errorCount,
    warningCount,
    unclassified,
    containsFatal: errorCount > 0,
    textLines: lines.length,
    note: 'Classified against 24 canonical Halo 1 Tool error/warning patterns.',
  };
}
