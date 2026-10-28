/**
 * Procedural World, Tunnel, Cave, Multi-Style Bridge & QuickForge BSP Generator for Halo CE.
 *
 * Inspired by Guilty Spark's QuickForge / World Edit (`quickforge.rs`, `forge_build.rs`, `bsp_clearance.rs`)
 * and expanded with:
 * - Multi-Path Tunnel Networks (1-5 main paths, 1-10 interconnecting pathways, configurable world separation,
 *   and 0-10 individually sized caves with optional stalagmites/pillars).
 * - Multi-Style Bridge Networks (1-5 main bridges, 1-10 cross-walkways, Forerunner Beam, Suspension,
 *   Under-Arch, Through-Arch Suspension, Natural Rocky Land Bridge, and Natural Dirt Land Bridge).
 * - QuickForge BSP & Biome Builder: Interactive sculptable heightfield terrain (hills, canyons, craters),
 *   Halo CE nature-inspired assets, Forerunner structures, and Procedural Human City / Street Grids.
 * - Auto-Shader resolver matching Halo CE stock environment/model shaders (`senv`, `soso`, `schi`) by surface role.
 */

import {
  buildCollisionIndexFromPolygons,
  verifyBipedRouteClearance,
  type BipedClearanceVerificationResult,
  type LiveCollisionPolygon,
} from './live-collision';

export type TunnelStylePreset = 'natural_cavern' | 'forerunner_conduit' | 'unsc_bunker';
export type TunnelStyle = TunnelStylePreset;

export type BridgeStylePreset =
  | 'forerunner_beam'
  | 'suspension'
  | 'arch_under'
  | 'arch_suspension'
  | 'natural_rocky'
  | 'natural_dirt';
export type BridgeStyle = BridgeStylePreset;

export type WorldMaterialRole =
  | 'forerunner_floor'
  | 'forerunner_wall'
  | 'forerunner_trim'
  | 'forerunner_light'
  | 'rock_wall'
  | 'dirt_ground'
  | 'grass_ground'
  | 'sand_ground'
  | 'snow_ground'
  | 'concrete_road'
  | 'sidewalk_concrete'
  | 'building_facade'
  | 'steel_cable';

export interface TunnelCaveConfig {
  id: string;
  name: string;
  /** Index of the main tunnel path (0 .. pathCount - 1) this cave sits on. */
  pathIndex: number;
  /** Normalized position along the tunnel from World A (0.15) to World B (0.85). */
  tPosition: number;
  /** Cave chamber width (world units, e.g. 6 .. 45). */
  width: number;
  /** Cave chamber length along the tunnel axis (world units, e.g. 6 .. 50). */
  length: number;
  /** Cave chamber dome ceiling height (world units, e.g. 3 .. 25). */
  height: number;
  /** Number of interior rock pillars / stalagmites / Forerunner columns (0 .. 8). */
  pillars: number;
  /** Optional skylight opening in the cave ceiling. */
  skylight?: boolean;
}
export type TunnelCaveSpec = TunnelCaveConfig;

export interface TunnelNetworkConfig {
  /** Number of main parallel/curved tunnel paths connecting World A and World B (1 .. 5). */
  pathCount: number;
  /** Distance between World A and World B in Halo world units (20 .. 500). */
  worldDistance: number;
  /** Spacing between parallel tunnel paths in world units (default: 8.0). */
  pathSpacing: number;
  /** Width of each tunnel corridor (default: 3.2 world units; Spartan width is 0.7u, Warthog is ~1.8u). */
  tunnelWidth: number;
  /** Height of each tunnel corridor (default: 2.6 world units; Spartan height is 1.2u). */
  tunnelHeight: number;
  /** Elevation difference (Z) from World A start to World B end (default: 0). */
  elevationDelta: number;
  /** Whether interconnecting cross-pathways between main tunnels are enabled. */
  interconnectEnabled: boolean;
  /** Number of interconnecting pathways linking the main tunnel paths (1 .. 10). */
  interconnectCount: number;
  /** Architectural / geological style of the tunnel network. */
  style: TunnelStylePreset;
  /** Individually configurable caves (0 .. 10) embedded along the tunnel network. */
  caves: TunnelCaveConfig[];
  /** World origin offset `[x, y, z]` where the tunnel network starts (World A anchor). */
  origin: [number, number, number];
  /** Yaw rotation in degrees around Z axis. */
  yawDeg: number;
}

export interface BridgeNetworkConfig {
  /** Number of main parallel bridges connecting World A and World B (1 .. 5). */
  bridgeCount: number;
  /** Distance between World A and World B in Halo world units (20 .. 500). */
  worldDistance: number;
  /** Spacing between parallel bridges in world units (default: 9.0). */
  bridgeSpacing: number;
  /** Deck walkable width in world units (default: 4.0). */
  bridgeWidth: number;
  /** Structural deck thickness in world units (default: 0.45). */
  deckThickness: number;
  /** Guardrail / parapet barrier height (default: 0.65). */
  railingHeight: number;
  /** Arch rise / suspension tower height in world units (default: 6.5). */
  archHeight: number;
  /** Elevation difference (Z) from World A start to World B end (default: 0). */
  elevationDelta: number;
  /** Whether interconnecting cross-walkways between main bridges are enabled. */
  interconnectEnabled: boolean;
  /** Number of interconnecting cross-walkways (1 .. 10). */
  interconnectCount: number;
  /** Bridge structural and aesthetic style. */
  style: BridgeStylePreset;
  /** World origin offset `[x, y, z]` where Bridge 0 starts. */
  origin: [number, number, number];
  /** Yaw rotation in degrees around Z axis. */
  yawDeg: number;
}

export type TerrainSculptMode =
  | 'raise'
  | 'lower'
  | 'flatten'
  | 'smooth'
  | 'hills'
  | 'canyon'
  | 'crater'
  | 'ridge';
export type TerrainSculptOperation = TerrainSculptMode;

export type TerrainBiomePreset =
  | 'bloodgulch_canyon'
  | 'timberland_ridge'
  | 'icefields_glacier'
  | 'deathisland_mesa'
  | 'flat_forge_canvas';

export interface TerrainGridConfig {
  enabled: boolean;
  /** Total X size in world units (e.g. 60 .. 300). */
  sizeX: number;
  /** Total Y size in world units (e.g. 60 .. 300). */
  sizeY: number;
  /** Subdivisions along X and Y (e.g. 16 .. 48). */
  steps: number;
  /** Flattened `(steps + 1) * (steps + 1)` Z heights array. */
  heights: number[];
  /** Primary ground material role (`grass_ground`, `dirt_ground`, `sand_ground`, `snow_ground`). */
  groundRole: WorldMaterialRole;
  /** Steep slope material role (`rock_wall`, `forerunner_wall`). */
  cliffRole: WorldMaterialRole;
}

export type WorldAssetKind =
  // Nature-inspired (Halo CE map style)
  | 'natural_arch'
  | 'boulder_cluster'
  | 'cliff_spire'
  | 'canyon_wall'
  | 'crater_basin'
  | 'natural_ramp'
  // Forerunner-styled
  | 'forerunner_tower'
  | 'forerunner_bunker'
  | 'forerunner_octagonal_room'
  | 'forerunner_ramp'
  | 'forerunner_energy_core'
  | 'forerunner_sniper_perch'
  // Human / UNSC styled
  | 'human_building'
  | 'human_overpass'
  | 'human_barricade';
export type WorldPieceKind = WorldAssetKind;

export interface WorldBuilderPiece {
  id: string;
  name: string;
  kind: WorldAssetKind;
  position: [number, number, number];
  size: [number, number, number];
  yawDeg: number;
}

export interface CityGridConfig {
  enabled: boolean;
  /** Number of city blocks along X (1 .. 6). */
  blocksX: number;
  /** Number of city blocks along Y (1 .. 6). */
  blocksY: number;
  /** Size of each city block in world units (default: 18). */
  blockSize: number;
  /** Width of streets between blocks (default: 6.0). */
  streetWidth: number;
  /** Width of raised pedestrian sidewalks (default: 1.2). */
  sidewalkWidth: number;
  /** Minimum building height (default: 5.0). */
  buildingMinHeight: number;
  /** Maximum building height (default: 14.0). */
  buildingMaxHeight: number;
  /** Generate accessible ground-floor lobbies and rooftop ramps inside buildings. */
  includeAccessibleInteriors: boolean;
  /** Generate an elevated highway overpass spanning across the city grid. */
  includeHighwayOverpass: boolean;
  /** Generate street cover barricades / medians. */
  includeStreetBarricades: boolean;
  /** Origin offset `[x, y, z]` of the city grid. */
  origin: [number, number, number];
}

export interface QuickForgeWorldConfig {
  terrain: TerrainGridConfig;
  city: CityGridConfig;
  pieces: WorldBuilderPiece[];
}

export interface GeneratedWorldVertex {
  position: [number, number, number];
  normal: [number, number, number];
  uv: [number, number];
}

export interface GeneratedWorldTriangle {
  v0: number;
  v1: number;
  v2: number;
  materialRole: WorldMaterialRole;
  /** True if this triangle is a visibility portal quad (`+portal`). */
  isPortal?: boolean;
}

export interface GeneratedWorldMesh {
  vertices: GeneratedWorldVertex[];
  triangles: GeneratedWorldTriangle[];
  materialRoles: WorldMaterialRole[];
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  };
  /** 3D line segments `[x0,y0,z0, x1,y1,z1]` for fast wireframe overlay rendering. */
  wireframeSegments: [number, number, number, number, number, number][];
  /** Spartan 3-sphere route walkability check results along primary pathways. */
  clearanceReport: BipedClearanceVerificationResult;
  /** Recommended player / test spawn point `[x, y, z]`. */
  recommendedSpawnPoint: [number, number, number];
}

export interface HaloShaderOption {
  tagId: number;
  path: string;
  classFourCC: string;
  category: WorldMaterialRole;
  label: string;
  isStockPreset?: boolean;
}

/**
 * Curated catalog of stock Halo CE environment & model shader paths across Blood Gulch, Timberland,
 * Icefields, Death Island, Silent Cartographer (`b30`), Halo (`a30`), and New Mombasa / Human streets.
 */
export const HALO_DEFAULT_SHADER_CATALOG: ReadonlyArray<{
  role: WorldMaterialRole;
  label: string;
  defaultPath: string;
  keywords: string[];
  previewColorHex: string;
}> = [
  {
    role: 'forerunner_floor',
    label: 'Forerunner Metal Floor',
    defaultPath: 'levels\\b30\\shaders\\metal floor',
    keywords: ['metal floor', 'forerunner_floor', 'panel_floor', 'b30\\shaders\\metal', 'plate_floor', 'base_floor', 'floor'],
    previewColorHex: '#64748b',
  },
  {
    role: 'forerunner_wall',
    label: 'Forerunner Structural Wall',
    defaultPath: 'levels\\b30\\shaders\\metal wall',
    keywords: ['metal wall', 'forerunner_wall', 'b30\\shaders\\wall', 'panel_wall', 'hull', 'metal_flat', 'wall'],
    previewColorHex: '#475569',
  },
  {
    role: 'forerunner_trim',
    label: 'Forerunner Bevel Trim & Struts',
    defaultPath: 'levels\\b30\\shaders\\metal trim',
    keywords: ['trim', 'strip', 'pillar', 'support', 'beam', 'metal'],
    previewColorHex: '#94a3b8',
  },
  {
    role: 'forerunner_light',
    label: 'Forerunner Energy / Light Strip',
    defaultPath: 'levels\\b30\\shaders\\light strip',
    keywords: ['light', 'glow', 'energy', 'lum', 'neon', 'holo', 'blue_light'],
    previewColorHex: '#38bdf8',
  },
  {
    role: 'rock_wall',
    label: 'Natural Canyon Rock / Cliff',
    defaultPath: 'levels\\test\\bloodgulch\\shaders\\rock wall',
    keywords: ['rock', 'cliff', 'stone', 'boulder', 'canyon', 'granite', 'cave'],
    previewColorHex: '#78716c',
  },
  {
    role: 'dirt_ground',
    label: 'Natural Dirt / Earth Path',
    defaultPath: 'levels\\test\\bloodgulch\\shaders\\dirt',
    keywords: ['dirt', 'mud', 'earth', 'ground', 'soil', 'trail'],
    previewColorHex: '#92400e',
  },
  {
    role: 'grass_ground',
    label: 'Natural Grass / Timberland Meadow',
    defaultPath: 'levels\\test\\timberland\\shaders\\ground grass',
    keywords: ['grass', 'moss', 'forest', 'meadow', 'turf', 'nature'],
    previewColorHex: '#15803d',
  },
  {
    role: 'sand_ground',
    label: 'Desert / Beach Sand',
    defaultPath: 'levels\\test\\bloodgulch\\shaders\\sand',
    keywords: ['sand', 'beach', 'desert', 'dune'],
    previewColorHex: '#d97706',
  },
  {
    role: 'snow_ground',
    label: 'Icefields Snow & Glacier',
    defaultPath: 'levels\\test\\icefields\\shaders\\snow',
    keywords: ['snow', 'ice', 'frost', 'glacier'],
    previewColorHex: '#e2e8f0',
  },
  {
    role: 'concrete_road',
    label: 'Human Asphalt / Concrete Street',
    defaultPath: 'levels\\a10\\shaders\\concrete floor',
    keywords: ['concrete', 'asphalt', 'road', 'street', 'pavement', 'cement', 'hangar'],
    previewColorHex: '#334155',
  },
  {
    role: 'sidewalk_concrete',
    label: 'Human Sidewalk & Curb Concrete',
    defaultPath: 'levels\\a10\\shaders\\concrete wall',
    keywords: ['sidewalk', 'curb', 'plaza', 'concrete_light', 'deck'],
    previewColorHex: '#9ca3af',
  },
  {
    role: 'building_facade',
    label: 'Human City Building Facade',
    defaultPath: 'levels\\a10\\shaders\\metal panel',
    keywords: ['building', 'facade', 'panel', 'wall', 'urban', 'plate'],
    previewColorHex: '#6b7280',
  },
  {
    role: 'steel_cable',
    label: 'Suspension Steel Cable & Tower',
    defaultPath: 'levels\\test\\timberland\\shaders\\metal support',
    keywords: ['cable', 'steel', 'wire', 'grate', 'support', 'iron'],
    previewColorHex: '#cbd5e1',
  },
];

/**
 * Automatically resolves the best matching in-map Halo CE shader tag (`senv`, `soso`, `schi`, `sgla`)
 * for every `WorldMaterialRole` used by a generated Tunnel, Bridge, or QuickForge World mesh.
 */
export function resolveDefaultHaloShadersForWorld(
  mapTags: ReadonlyArray<{
    tagId: number;
    path: string;
    classA?: string;
    primaryClassName?: string | null;
    primaryClassFourCC?: number;
  }>,
  rolesOrOverrides?: ReadonlyArray<WorldMaterialRole> | Partial<Record<WorldMaterialRole, number>>,
): Record<WorldMaterialRole, { tagId: number; path: string; classFourCC: string }> {
  const getTagFourCC = (t: {
    classA?: string;
    primaryClassName?: string | null;
    primaryClassFourCC?: number;
  }): string => {
    if (t.classA) return t.classA;
    const name = (t.primaryClassName ?? '').toLowerCase();
    if (name === 'shader_environment' || name === 'senv') return 'senv';
    if (name === 'shader_model' || name === 'soso') return 'soso';
    if (name === 'shader_transparent_chicago' || name === 'schi') return 'schi';
    if (name === 'shader_transparent_glass' || name === 'sgla') return 'sgla';
    if (name === 'shader_transparent_meter' || name === 'smet') return 'smet';
    if (name === 'shader_transparent_plasma' || name === 'spla') return 'spla';
    if (name === 'shader_transparent_water' || name === 'swat') return 'swat';
    if (name.startsWith('shader')) return 'senv';
    if (typeof t.primaryClassFourCC === 'number') {
      const f = t.primaryClassFourCC;
      return String.fromCharCode((f >>> 24) & 0xff, (f >>> 16) & 0xff, (f >>> 8) & 0xff, f & 0xff);
    }
    return '';
  };

  const normalizedTags = mapTags.map((t) => ({
    tagId: t.tagId,
    path: t.path,
    classA: getTagFourCC(t),
  }));

  const shaderTags = normalizedTags.filter((t) =>
    ['senv', 'soso', 'schi', 'sgla', 'smet', 'spla', 'swat'].includes(t.classA),
  );
  // Prefer `senv` (shader_environment) first for BSP surfaces, then `soso`/`schi`
  const sortedShaders = [...shaderTags].sort((a, b) => {
    const rank = (c: string) => (c === 'senv' ? 0 : c === 'soso' ? 1 : 2);
    return rank(a.classA) - rank(b.classA);
  });

  const fallbackShader = sortedShaders[0] ?? {
    tagId: 0xffffffff,
    path: 'levels\\b30\\shaders\\metal floor',
    classA: 'senv',
  };

  const isRolesArray = Array.isArray(rolesOrOverrides);
  const overrides: Partial<Record<WorldMaterialRole, number>> =
    !isRolesArray && rolesOrOverrides ? (rolesOrOverrides as Partial<Record<WorldMaterialRole, number>>) : {};
  const result = {} as Record<WorldMaterialRole, { tagId: number; path: string; classFourCC: string }>;
  const targetRoles: ReadonlyArray<WorldMaterialRole> = isRolesArray
    ? (rolesOrOverrides as ReadonlyArray<WorldMaterialRole>)
    : HALO_DEFAULT_SHADER_CATALOG.map((c) => c.role);

  for (const role of targetRoles) {
    const overrideTagId = overrides[role];
    if (typeof overrideTagId === 'number' && overrideTagId !== -1 && overrideTagId !== 0xffffffff) {
      const explicitMatch = normalizedTags.find((t) => t.tagId === overrideTagId);
      if (explicitMatch) {
        result[role] = {
          tagId: explicitMatch.tagId,
          path: explicitMatch.path,
          classFourCC: explicitMatch.classA || 'senv',
        };
        continue;
      }
    }

    const spec = HALO_DEFAULT_SHADER_CATALOG.find((c) => c.role === role) ?? HALO_DEFAULT_SHADER_CATALOG[0];
    let bestMatch = fallbackShader;
    let bestScore = -1;

    for (const st of sortedShaders) {
      const lower = st.path.toLowerCase();
      // Skip sky/portal/invisible shaders
      if (/sky|portal|invisible|nodraw|blank|weather|fog/i.test(lower)) continue;
      let score = st.classA === 'senv' ? 2 : 0;
      for (let k = 0; k < spec.keywords.length; k++) {
        const kw = spec.keywords[k].toLowerCase();
        if (lower.includes(kw)) {
          score += (spec.keywords.length - k) * 5;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = st;
      }
    }

    result[role] = {
      tagId: bestMatch.tagId,
      path: bestMatch.path || spec.defaultPath,
      classFourCC: bestMatch.classA || 'senv',
    };
  }

  return result;
}

class MeshBuilder {
  vertices: GeneratedWorldVertex[] = [];
  triangles: GeneratedWorldTriangle[] = [];
  wireframeSegments: [number, number, number, number, number, number][] = [];
  private origin: [number, number, number];
  private cosYaw: number;
  private sinYaw: number;

  constructor(origin: [number, number, number] = [0, 0, 0], yawDeg = 0) {
    this.origin = origin;
    const rad = (yawDeg * Math.PI) / 180;
    this.cosYaw = Math.cos(rad);
    this.sinYaw = Math.sin(rad);
  }

  transformPoint(x: number, y: number, z: number): [number, number, number] {
    const rx = x * this.cosYaw - y * this.sinYaw + this.origin[0];
    const ry = x * this.sinYaw + y * this.cosYaw + this.origin[1];
    const rz = z + this.origin[2];
    return [rx, ry, rz];
  }

  private transformNormal(nx: number, ny: number, nz: number): [number, number, number] {
    const rx = nx * this.cosYaw - ny * this.sinYaw;
    const ry = nx * this.sinYaw + ny * this.cosYaw;
    const len = Math.hypot(rx, ry, nz) || 1;
    return [rx / len, ry / len, nz / len];
  }

  /**
   * Adds a quad `(p0, p1, p2, p3)` in counter-clockwise outward winding order (normal = `(p1 - p0) x (p2 - p0)`).
   */
  addQuad(
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    role: WorldMaterialRole,
    uvScale = 0.25,
    twoSided = false,
  ): void {
    const tp0 = this.transformPoint(p0[0], p0[1], p0[2]);
    const tp1 = this.transformPoint(p1[0], p1[1], p1[2]);
    const tp2 = this.transformPoint(p2[0], p2[1], p2[2]);
    const tp3 = this.transformPoint(p3[0], p3[1], p3[2]);

    const ux = tp1[0] - tp0[0], uy = tp1[1] - tp0[1], uz = tp1[2] - tp0[2];
    const vx = tp2[0] - tp0[0], vy = tp2[1] - tp0[1], vz = tp2[2] - tp0[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const len = Math.hypot(cx, cy, cz);
    if (len < 1e-6) return;
    const normal: [number, number, number] = [cx / len, cy / len, cz / len];

    const uLen = Math.hypot(ux, uy, uz) * uvScale;
    const vLen = Math.hypot(tp3[0] - tp0[0], tp3[1] - tp0[1], tp3[2] - tp0[2]) * uvScale;

    const base = this.vertices.length;
    this.vertices.push(
      { position: tp0, normal, uv: [0, 0] },
      { position: tp1, normal, uv: [uLen, 0] },
      { position: tp2, normal, uv: [uLen, vLen] },
      { position: tp3, normal, uv: [0, vLen] },
    );
    this.triangles.push(
      { v0: base, v1: base + 1, v2: base + 2, materialRole: role },
      { v0: base, v1: base + 2, v2: base + 3, materialRole: role },
    );

    if (twoSided) {
      const revNormal: [number, number, number] = [-normal[0], -normal[1], -normal[2]];
      const rBase = this.vertices.length;
      this.vertices.push(
        { position: tp0, normal: revNormal, uv: [0, 0] },
        { position: tp3, normal: revNormal, uv: [0, vLen] },
        { position: tp2, normal: revNormal, uv: [uLen, vLen] },
        { position: tp1, normal: revNormal, uv: [uLen, 0] },
      );
      this.triangles.push(
        { v0: rBase, v1: rBase + 1, v2: rBase + 2, materialRole: role },
        { v0: rBase, v1: rBase + 2, v2: rBase + 3, materialRole: role },
      );
    }

    if (this.wireframeSegments.length < 12000) {
      this.wireframeSegments.push(
        [tp0[0], tp0[1], tp0[2], tp1[0], tp1[1], tp1[2]],
        [tp1[0], tp1[1], tp1[2], tp2[0], tp2[1], tp2[2]],
        [tp2[0], tp2[1], tp2[2], tp3[0], tp3[1], tp3[2]],
        [tp3[0], tp3[1], tp3[2], tp0[0], tp0[1], tp0[2]],
      );
    }
  }

  addTriangle(
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    role: WorldMaterialRole,
    uvScale = 0.25,
  ): void {
    const tp0 = this.transformPoint(p0[0], p0[1], p0[2]);
    const tp1 = this.transformPoint(p1[0], p1[1], p1[2]);
    const tp2 = this.transformPoint(p2[0], p2[1], p2[2]);

    const ux = tp1[0] - tp0[0], uy = tp1[1] - tp0[1], uz = tp1[2] - tp0[2];
    const vx = tp2[0] - tp0[0], vy = tp2[1] - tp0[1], vz = tp2[2] - tp0[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const len = Math.hypot(cx, cy, cz);
    if (len < 1e-6) return;
    const normal: [number, number, number] = [cx / len, cy / len, cz / len];

    const base = this.vertices.length;
    this.vertices.push(
      { position: tp0, normal, uv: [tp0[0] * uvScale, tp0[1] * uvScale] },
      { position: tp1, normal, uv: [tp1[0] * uvScale, tp1[1] * uvScale] },
      { position: tp2, normal, uv: [tp2[0] * uvScale, tp2[1] * uvScale] },
    );
    this.triangles.push({ v0: base, v1: base + 1, v2: base + 2, materialRole: role });

    if (this.wireframeSegments.length < 12000) {
      this.wireframeSegments.push(
        [tp0[0], tp0[1], tp0[2], tp1[0], tp1[1], tp1[2]],
        [tp1[0], tp1[1], tp1[2], tp2[0], tp2[1], tp2[2]],
        [tp2[0], tp2[1], tp2[2], tp0[0], tp0[1], tp0[2]],
      );
    }
  }

  /**
   * Adds a solid closed 6-face box centered at `(cx, cy, cz)` with dimensions `(sx, sy, sz)`.
   */
  addSolidBox(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    sideRole: WorldMaterialRole,
    topRole: WorldMaterialRole = sideRole,
  ): void {
    const hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
    const x0 = cx - hx, x1 = cx + hx;
    const y0 = cy - hy, y1 = cy + hy;
    const z0 = cz - hz, z1 = cz + hz;

    // Top (+Z)
    this.addQuad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], topRole);
    // Bottom (-Z)
    this.addQuad([x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0], sideRole);
    // Front (+X)
    this.addQuad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], sideRole);
    // Back (-X)
    this.addQuad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], sideRole);
    // Right (+Y)
    this.addQuad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], sideRole);
    // Left (-Y)
    this.addQuad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], sideRole);
  }

  /**
   * Adds a solid 3D strut/beam between two 3D points `a` and `b` with square cross-section `thickness`.
   */
  addStrutBetweenPoints(
    a: [number, number, number],
    b: [number, number, number],
    thickness: number,
    role: WorldMaterialRole,
  ): void {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    const fx = dx / len, fy = dy / len, fz = dz / len;
    const up: [number, number, number] = Math.abs(fz) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    let rx = fy * up[2] - fz * up[1];
    let ry = fz * up[0] - fx * up[2];
    let rz = fx * up[1] - fy * up[0];
    const rLen = Math.hypot(rx, ry, rz) || 1;
    rx /= rLen; ry /= rLen; rz /= rLen;
    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;
    const h = thickness * 0.5;

    const ring = (pt: [number, number, number]): [number, number, number][] => [
      [pt[0] - rx * h - ux * h, pt[1] - ry * h - uy * h, pt[2] - rz * h - uz * h],
      [pt[0] + rx * h - ux * h, pt[1] + ry * h - uy * h, pt[2] + rz * h - uz * h],
      [pt[0] + rx * h + ux * h, pt[1] + ry * h + uy * h, pt[2] + rz * h + uz * h],
      [pt[0] - rx * h + ux * h, pt[1] - ry * h + uy * h, pt[2] - rz * h + uz * h],
    ];
    const rA = ring(a);
    const rB = ring(b);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.addQuad(rA[i], rA[j], rB[j], rB[i], role);
    }
  }

  finalize(
    routeWaypoints: [number, number, number][],
    recommendedSpawnLocal: [number, number, number] = [2, 0, 0.2],
  ): GeneratedWorldMesh {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const roleSet = new Set<WorldMaterialRole>();

    for (const v of this.vertices) {
      const [x, y, z] = v.position;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    if (!Number.isFinite(minX)) {
      minX = -5; minY = -5; minZ = 0;
      maxX = 5; maxY = 5; maxZ = 5;
    }

    const collPolys: LiveCollisionPolygon[] = [];
    for (const t of this.triangles) {
      roleSet.add(t.materialRole);
      if (t.isPortal) continue;
      const p0 = this.vertices[t.v0]?.position;
      const p1 = this.vertices[t.v1]?.position;
      const p2 = this.vertices[t.v2]?.position;
      if (!p0 || !p1 || !p2) continue;
      const n = this.vertices[t.v0].normal;
      const d = n[0] * p0[0] + n[1] * p0[1] + n[2] * p0[2];
      collPolys.push({
        vertices: [p0, p1, p2],
        plane: [n[0], n[1], n[2], d],
      });
    }

    const collIndex = buildCollisionIndexFromPolygons(collPolys);
    const transformedWaypoints = routeWaypoints.map((w) => this.transformPoint(w[0], w[1], w[2]));
    const clearanceReport = verifyBipedRouteClearance(collIndex, transformedWaypoints, 1.25);

    return {
      vertices: this.vertices,
      triangles: this.triangles,
      materialRoles: Array.from(roleSet),
      bounds: {
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
        size: [maxX - minX, maxY - minY, maxZ - minZ],
      },
      wireframeSegments: this.wireframeSegments,
      clearanceReport,
      recommendedSpawnPoint: this.transformPoint(
        recommendedSpawnLocal[0],
        recommendedSpawnLocal[1],
        recommendedSpawnLocal[2],
      ),
    };
  }
}

/**
 * Generates a Multi-Path Tunnel + Cave + Interconnecting Pathway Network between two worlds.
 *
 * Supports:
 * - `pathCount`: 1 to 5 main parallel/curved tunnel paths.
 * - `interconnectEnabled` & `interconnectCount`: 1 to 10 cross-tunnels with doorway cutouts on main tunnel walls!
 * - `worldDistance`: 20 to 500 world units between World A (`x = 0`) and World B (`x = worldDistance`).
 * - `caves`: 0 to 10 individually sized caves along the paths, each with customizable width, length, height, and pillars.
 * - `style`: `'natural_cavern' | 'forerunner_conduit' | 'unsc_bunker'`.
 */
export function generateTunnelNetworkMesh(config: TunnelNetworkConfig): GeneratedWorldMesh {
  const pathCount = Math.max(1, Math.min(5, Math.round(config.pathCount || 1)));
  const dist = Math.max(20, Math.min(500, config.worldDistance || 80));
  const spacing = Math.max(config.tunnelWidth + 3.0, config.pathSpacing || 10.0);
  const tw = Math.max(2.0, Math.min(18.0, config.tunnelWidth || 3.6));
  const th = Math.max(2.0, Math.min(15.0, config.tunnelHeight || 2.8));
  const elevDelta = Number.isFinite(config.elevationDelta) ? config.elevationDelta : 0;
  const interconnectCount = config.interconnectEnabled
    ? Math.max(1, Math.min(10, Math.round(config.interconnectCount || 2)))
    : 0;

  const builder = new MeshBuilder(config.origin ?? [0, 0, 0], config.yawDeg ?? 0);

  const floorRole: WorldMaterialRole =
    config.style === 'natural_cavern'
      ? 'dirt_ground'
      : config.style === 'unsc_bunker'
        ? 'concrete_road'
        : 'forerunner_floor';
  const wallRole: WorldMaterialRole =
    config.style === 'natural_cavern'
      ? 'rock_wall'
      : config.style === 'unsc_bunker'
        ? 'building_facade'
        : 'forerunner_wall';
  const trimRole: WorldMaterialRole =
    config.style === 'natural_cavern'
      ? 'rock_wall'
      : config.style === 'unsc_bunker'
        ? 'sidewalk_concrete'
        : 'forerunner_trim';
  const lightRole: WorldMaterialRole = 'forerunner_light';

  // Number of longitudinal slices along X (0 .. dist)
  const numSlices = Math.max(16, Math.min(64, Math.round(dist / 3.0)));
  const dx = dist / numSlices;

  // Determine which slice indices have interconnecting cross-tunnels
  const interconnectSliceSet = new Set<number>();
  if (pathCount > 1 && interconnectCount > 0) {
    for (let ic = 0; ic < interconnectCount; ic++) {
      const frac = (ic + 1) / (interconnectCount + 1);
      const sIdx = Math.max(1, Math.min(numSlices - 2, Math.round(frac * numSlices)));
      interconnectSliceSet.add(sIdx);
    }
  }

  // Center Y for each main path (0 .. pathCount - 1)
  const getPathBaseY = (pIdx: number): number => (pIdx - (pathCount - 1) * 0.5) * spacing;
  const getPathCurveOffsetY = (pIdx: number, t: number): number => {
    if (config.style === 'natural_cavern') {
      return Math.sin(t * Math.PI * 2 + pIdx * 1.3) * Math.min(1.6, spacing * 0.14);
    }
    return 0;
  };
  const getPathZ = (t: number): number => t * elevDelta;

  // Build each main tunnel path slice by slice
  for (let pIdx = 0; pIdx < pathCount; pIdx++) {
    const baseY = getPathBaseY(pIdx);
    const pathCaves = (config.caves ?? []).filter(
      (c) => Math.max(0, Math.min(pathCount - 1, c.pathIndex)) === pIdx,
    );

    // Helper: compute cross-section ring at normalized `t = s / numSlices`
    const computeSection = (s: number) => {
      const t = s / numSlices;
      const x = t * dist;
      const cy = baseY + getPathCurveOffsetY(pIdx, t);
      const z0 = getPathZ(t);

      // Check if `x` falls inside any cave on this path and blend width/height smoothly
      let curHalfW = tw * 0.5;
      let curH = th;
      for (const cave of pathCaves) {
        const caveCenterX = Math.max(0.1, Math.min(0.9, cave.tPosition)) * dist;
        const halfLen = Math.max(3.0, cave.length * 0.5);
        const rel = Math.abs(x - caveCenterX) / halfLen;
        if (rel < 1.0) {
          const smooth = 0.5 * (1 + Math.cos(rel * Math.PI)); // 1 at cave center, 0 at cave ends
          curHalfW = Math.max(curHalfW, (cave.width * 0.5 - tw * 0.5) * smooth + tw * 0.5);
          curH = Math.max(curH, (cave.height - th) * smooth + th);
        }
      }

      // Organic cavern wall undulation
      const wave =
        config.style === 'natural_cavern'
          ? Math.sin(s * 1.7 + pIdx * 2.1) * 0.22
          : 0;
      const hw = curHalfW + wave;
      const bevelW = config.style === 'forerunner_conduit' ? hw * 1.18 : hw * 1.08;
      const midH = curH * 0.55;

      // 6-point octagonal/arched cross-section:
      // 0: Floor Left (-hw, z0)
      // 1: Floor Right (+hw, z0)
      // 2: Mid-Wall Right (+bevelW, z0 + midH)
      // 3: Ceiling Right (+hw * 0.72, z0 + curH)
      // 4: Ceiling Left (-hw * 0.72, z0 + curH)
      // 5: Mid-Wall Left (-bevelW, z0 + midH)
      return {
        x,
        cy,
        z0,
        hw,
        curH,
        pts: [
          [x, cy - hw, z0] as [number, number, number],
          [x, cy + hw, z0] as [number, number, number],
          [x, cy + bevelW, z0 + midH] as [number, number, number],
          [x, cy + hw * 0.72, z0 + curH] as [number, number, number],
          [x, cy - hw * 0.72, z0 + curH] as [number, number, number],
          [x, cy - bevelW, z0 + midH] as [number, number, number],
        ],
      };
    };

    for (let s = 0; s < numSlices; s++) {
      const secA = computeSection(s);
      const secB = computeSection(s + 1);
      const hasRightCross = pIdx < pathCount - 1 && interconnectSliceSet.has(s);
      const hasLeftCross = pIdx > 0 && interconnectSliceSet.has(s);

      // 1. Walkable Floor (pts[0] -> pts[1], inward normal +Z)
      builder.addQuad(secA.pts[0], secB.pts[0], secB.pts[1], secA.pts[1], floorRole, 0.25, true);

      // 2. Right Lower Wall (pts[1] -> pts[2], inward normal -Y) — skip if interconnecting tunnel opens here!
      if (!hasRightCross) {
        builder.addQuad(secA.pts[1], secB.pts[1], secB.pts[2], secA.pts[2], wallRole, 0.25, true);
      }
      // 3. Right Upper Bevel (pts[2] -> pts[3], inward normal -Y/-Z)
      builder.addQuad(
        secA.pts[2],
        secB.pts[2],
        secB.pts[3],
        secA.pts[3],
        config.style === 'forerunner_conduit' ? trimRole : wallRole,
        0.25,
        true,
      );

      // 4. Ceiling (pts[3] -> pts[4], inward normal -Z)
      const isCeilingLight = config.style !== 'natural_cavern' && s % 3 === 1;
      builder.addQuad(
        secA.pts[3],
        secB.pts[3],
        secB.pts[4],
        secA.pts[4],
        isCeilingLight ? lightRole : trimRole,
        0.25,
        true,
      );

      // 5. Left Upper Bevel (pts[4] -> pts[5], inward normal +Y/-Z)
      builder.addQuad(
        secA.pts[4],
        secB.pts[4],
        secB.pts[5],
        secA.pts[5],
        config.style === 'forerunner_conduit' ? trimRole : wallRole,
        0.25,
        true,
      );
      // 6. Left Lower Wall (pts[5] -> pts[0], inward normal +Y) — skip if interconnecting tunnel opens here!
      if (!hasLeftCross) {
        builder.addQuad(secA.pts[5], secB.pts[5], secB.pts[0], secA.pts[0], wallRole, 0.25, true);
      }

      // Add Forerunner / UNSC structural rib frames every 4 slices
      if (config.style !== 'natural_cavern' && s > 0 && s < numSlices && s % 4 === 0 && !hasLeftCross && !hasRightCross) {
        builder.addStrutBetweenPoints(secA.pts[0], secA.pts[5], 0.22, trimRole);
        builder.addStrutBetweenPoints(secA.pts[5], secA.pts[4], 0.22, trimRole);
        builder.addStrutBetweenPoints(secA.pts[1], secA.pts[2], 0.22, trimRole);
        builder.addStrutBetweenPoints(secA.pts[2], secA.pts[3], 0.22, trimRole);
      }
    }

    // Add interior cave pillars / stalagmites for each cave on this path
    for (const cave of pathCaves) {
      const pillarCount = Math.max(0, Math.min(8, Math.round(cave.pillars || 0)));
      const caveCenterX = Math.max(0.1, Math.min(0.9, cave.tPosition)) * dist;
      const caveT = caveCenterX / dist;
      const caveY = baseY + getPathCurveOffsetY(pIdx, caveT);
      const caveZ = getPathZ(caveT);
      for (let k = 0; k < pillarCount; k++) {
        const angle = (k / Math.max(1, pillarCount)) * Math.PI * 2 + 0.4;
        const rX = Math.max(1.2, cave.length * 0.24) * Math.cos(angle);
        const rY = Math.max(1.2, cave.width * 0.26) * Math.sin(angle);
        // Keep the central pathway (`|rY| < tw * 0.45`) clear so Spartan/Warthog clearance is never blocked!
        const safeY = Math.abs(rY) < tw * 0.5 ? Math.sign(rY || 1) * (tw * 0.55) : rY;
        const px = caveCenterX + rX;
        const py = caveY + safeY;
        const pRadius = config.style === 'natural_cavern' ? 0.65 : 0.45;
        builder.addSolidBox(
          px,
          py,
          caveZ + cave.height * 0.48,
          pRadius * 2,
          pRadius * 2,
          cave.height * 0.96,
          config.style === 'natural_cavern' ? 'rock_wall' : 'forerunner_trim',
        );
      }
    }

    // Add entrance & exit portal framing arches at World A (`x = 0`) and World B (`x = dist`)
    for (const endX of [0, dist]) {
      const endT = endX / dist;
      const endY = baseY + getPathCurveOffsetY(pIdx, endT);
      const endZ = getPathZ(endT);
      const frameW = tw * 0.5 + 0.35;
      builder.addSolidBox(endX, endY - frameW, endZ + th * 0.5, 0.7, 0.5, th + 0.4, trimRole);
      builder.addSolidBox(endX, endY + frameW, endZ + th * 0.5, 0.7, 0.5, th + 0.4, trimRole);
      builder.addSolidBox(endX, endY, endZ + th + 0.25, 0.7, tw + 1.2, 0.5, trimRole);
    }
  }

  // Build Interconnecting Cross-Tunnels between adjacent main paths `(pIdx -> pIdx + 1)`
  if (pathCount > 1 && interconnectSliceSet.size > 0) {
    for (const sIdx of interconnectSliceSet) {
      const t0 = sIdx / numSlices;
      const t1 = (sIdx + 1) / numSlices;
      const x0 = t0 * dist;
      const x1 = t1 * dist;
      const z0 = getPathZ((t0 + t1) * 0.5);
      const crossH = th * 0.55;

      for (let pIdx = 0; pIdx < pathCount - 1; pIdx++) {
        const yA = getPathBaseY(pIdx) + getPathCurveOffsetY(pIdx, (t0 + t1) * 0.5) + tw * 0.5;
        const yB = getPathBaseY(pIdx + 1) + getPathCurveOffsetY(pIdx + 1, (t0 + t1) * 0.5) - tw * 0.5;
        if (yB <= yA) continue;

        // Cross-tunnel Floor (+Z)
        builder.addQuad([x0, yA, z0], [x1, yA, z0], [x1, yB, z0], [x0, yB, z0], floorRole, 0.25, true);
        // Cross-tunnel Ceiling (-Z)
        builder.addQuad(
          [x0, yB, z0 + crossH],
          [x1, yB, z0 + crossH],
          [x1, yA, z0 + crossH],
          [x0, yA, z0 + crossH],
          trimRole,
          0.25,
          true,
        );
        // Cross-tunnel West Wall (x = x0, normal +X)
        builder.addQuad(
          [x0, yB, z0],
          [x0, yA, z0],
          [x0, yA, z0 + crossH],
          [x0, yB, z0 + crossH],
          wallRole,
          0.25,
          true,
        );
        // Cross-tunnel East Wall (x = x1, normal -X)
        builder.addQuad(
          [x1, yA, z0],
          [x1, yB, z0],
          [x1, yB, z0 + crossH],
          [x1, yA, z0 + crossH],
          wallRole,
          0.25,
          true,
        );
      }
    }
  }

  // Build route waypoints along Path 0 for 3-sphere Spartan walkability verification
  const waypoints: [number, number, number][] = [];
  for (let s = 0; s <= 12; s++) {
    const t = s / 12;
    const x = t * dist;
    const y = getPathBaseY(0) + getPathCurveOffsetY(0, t);
    const z = getPathZ(t);
    waypoints.push([x, y, z]);
  }

  return builder.finalize(waypoints, [2.0, getPathBaseY(0), 0.15]);
}

/**
 * Generates a Multi-Style Bridge Network between two worlds.
 *
 * Styles:
 * - `'forerunner_beam'`: Angled Forerunner metallic deck, diagonal under-trusses, end monolith pylons, glowing energy barriers.
 * - `'suspension'`: Twin suspension towers at each end, parabolic main suspension cables, vertical suspender cables, deck & railings.
 * - `'arch_under'`: Parabolic structural arch rib beneath the deck with vertical spandrel columns supporting the deck.
 * - `'arch_suspension'`: Overhead parabolic through-arch ribs rising above the deck with vertical hanger cables & top cross-bracing.
 * - `'natural_rocky'`: Organic weathered stone canyon arch with natural rock parapets.
 * - `'natural_dirt'`: Earthen/grassy natural land bridge with sloped embankments and stone ledges.
 */
export function generateBridgeNetworkMesh(config: BridgeNetworkConfig): GeneratedWorldMesh {
  const bridgeCount = Math.max(1, Math.min(5, Math.round(config.bridgeCount || 1)));
  const dist = Math.max(20, Math.min(500, config.worldDistance || 80));
  const bw = Math.max(2.0, Math.min(20.0, config.bridgeWidth || 4.2));
  const spacing = Math.max(bw + 3.5, config.bridgeSpacing || 11.0);
  const deckThick = Math.max(0.25, Math.min(3.0, config.deckThickness || 0.45));
  const railH = Math.max(0.2, Math.min(2.5, config.railingHeight ?? 0.65));
  const archH = Math.max(2.0, Math.min(40.0, config.archHeight || 7.5));
  const elevDelta = Number.isFinite(config.elevationDelta) ? config.elevationDelta : 0;
  const interconnectCount = config.interconnectEnabled
    ? Math.max(1, Math.min(10, Math.round(config.interconnectCount || 2)))
    : 0;

  const builder = new MeshBuilder(config.origin ?? [0, 0, 0], config.yawDeg ?? 0);

  const isNatural = config.style === 'natural_rocky' || config.style === 'natural_dirt';
  const deckRole: WorldMaterialRole =
    config.style === 'natural_dirt'
      ? 'dirt_ground'
      : config.style === 'natural_rocky'
        ? 'rock_wall'
        : config.style === 'suspension'
          ? 'concrete_road'
          : 'forerunner_floor';
  const structureRole: WorldMaterialRole =
    isNatural
      ? 'rock_wall'
      : config.style === 'suspension'
        ? 'forerunner_wall'
        : 'forerunner_trim';
  const railRole: WorldMaterialRole =
    config.style === 'forerunner_beam'
      ? 'forerunner_light'
      : isNatural
        ? 'rock_wall'
        : 'steel_cable';

  const numSlices = Math.max(16, Math.min(56, Math.round(dist / 3.0)));
  const getBridgeY = (bIdx: number): number => (bIdx - (bridgeCount - 1) * 0.5) * spacing;
  const getDeckZ = (t: number): number => {
    const linearZ = t * elevDelta;
    // Slight natural camber crown on arch/natural bridges
    const crown =
      config.style === 'arch_under' || isNatural
        ? 4 * t * (1 - t) * Math.min(1.5, archH * 0.15)
        : 0;
    return linearZ + crown;
  };

  for (let bIdx = 0; bIdx < bridgeCount; bIdx++) {
    const cy = getBridgeY(bIdx);
    const hw = bw * 0.5;

    // 1. Main Walkable Deck + Underside + Side Skirts + Guardrails/Parapets
    for (let s = 0; s < numSlices; s++) {
      const t0 = s / numSlices;
      const t1 = (s + 1) / numSlices;
      const x0 = t0 * dist;
      const x1 = t1 * dist;
      const z0 = getDeckZ(t0);
      const z1 = getDeckZ(t1);

      const curThick0 =
        isNatural
          ? deckThick + (1 - 4 * t0 * (1 - t0)) * archH * 0.55 + Math.abs(Math.sin(s * 1.9)) * 0.35
          : deckThick;
      const curThick1 =
        isNatural
          ? deckThick + (1 - 4 * t1 * (1 - t1)) * archH * 0.55 + Math.abs(Math.sin((s + 1) * 1.9)) * 0.35
          : deckThick;

      // Top walkable surface (+Z)
      builder.addQuad([x0, cy - hw, z0], [x1, cy - hw, z1], [x1, cy + hw, z1], [x0, cy + hw, z0], deckRole);
      // Bottom deck surface (-Z)
      builder.addQuad(
        [x0, cy + hw, z0 - curThick0],
        [x1, cy + hw, z1 - curThick1],
        [x1, cy - hw, z1 - curThick1],
        [x0, cy - hw, z0 - curThick0],
        structureRole,
      );
      // Left deck edge (-Y)
      builder.addQuad(
        [x0, cy - hw, z0 - curThick0],
        [x1, cy - hw, z1 - curThick1],
        [x1, cy - hw, z1],
        [x0, cy - hw, z0],
        structureRole,
      );
      // Right deck edge (+Y)
      builder.addQuad(
        [x1, cy + hw, z1 - curThick1],
        [x0, cy + hw, z0 - curThick0],
        [x0, cy + hw, z0],
        [x1, cy + hw, z1],
        structureRole,
      );

      // Guardrails / Parapets along both sides
      if (railH > 0.05) {
        const rThick = isNatural ? 0.38 : 0.16;
        for (const side of [-1, 1]) {
          const ry = cy + side * (hw - rThick * 0.5);
          const localH = isNatural ? railH * (0.75 + 0.35 * Math.sin(s * 2.3 + side)) : railH;
          builder.addSolidBox(
            (x0 + x1) * 0.5,
            ry,
            (z0 + z1) * 0.5 + localH * 0.5,
            (x1 - x0) * 1.02,
            rThick,
            localH,
            railRole,
          );
        }
      }

      // Style-specific structural elements per segment:
      if (config.style === 'forerunner_beam') {
        // Angled Forerunner under-deck V-struts and glowing energy spine
        const midX = (x0 + x1) * 0.5;
        const midZ = (z0 + z1) * 0.5;
        const keelZ = midZ - deckThick - Math.min(2.6, archH * 0.35);
        builder.addStrutBetweenPoints([x0, cy, z0 - deckThick], [x1, cy, z1 - deckThick], 0.35, 'forerunner_light');
        if (s % 2 === 0) {
          builder.addStrutBetweenPoints([midX, cy - hw, midZ - deckThick], [midX, cy, keelZ], 0.24, structureRole);
          builder.addStrutBetweenPoints([midX, cy + hw, midZ - deckThick], [midX, cy, keelZ], 0.24, structureRole);
          builder.addStrutBetweenPoints([x0, cy, z0 - deckThick - Math.min(2.6, archH * 0.35)], [x1, cy, keelZ], 0.28, structureRole);
        }
      } else if (config.style === 'suspension') {
        // Parabolic suspension cables above deck (`towerH = archH`) sagging down to `z + railH + 0.3` at mid-span
        const towerT0 = 0.12;
        const towerT1 = 0.88;
        const cableZ = (t: number): number => {
          const baseZ = getDeckZ(t);
          if (t >= towerT0 && t <= towerT1) {
            const u = (t - 0.5) / ((towerT1 - towerT0) * 0.5); // -1 .. +1
            return baseZ + railH + 0.35 + u * u * (archH - railH - 0.35);
          }
          // Anchor backstays at ends (0..towerT0 and towerT1..1)
          const uEnd = t < towerT0 ? t / towerT0 : (1 - t) / (1 - towerT1);
          return baseZ + uEnd * archH;
        };
        const cz0 = cableZ(t0);
        const cz1 = cableZ(t1);
        for (const side of [-1, 1]) {
          const ky = cy + side * (hw + 0.12);
          builder.addStrutBetweenPoints([x0, ky, cz0], [x1, ky, cz1], 0.16, 'steel_cable');
          // Vertical suspender cable every 2 slices
          if (s % 2 === 0 && cz0 > z0 + railH + 0.2) {
            builder.addStrutBetweenPoints([x0, ky, z0], [x0, ky, cz0], 0.08, 'steel_cable');
          }
        }
      } else if (config.style === 'arch_under') {
        // Parabolic structural arch rib BENEATH the deck (`zArch(t) = zDeck(t) - deckThick - (1 - 4*t*(1-t)) * archH`)
        const archZ = (t: number): number => {
          const para = 4 * t * (1 - t); // 0 at ends, 1 at center
          return getDeckZ(t) - deckThick - 0.3 - (1 - para) * archH;
        };
        const az0 = archZ(t0);
        const az1 = archZ(t1);
        for (const side of [-1, 1]) {
          const ay = cy + side * (hw * 0.78);
          builder.addStrutBetweenPoints([x0, ay, az0], [x1, ay, az1], 0.36, structureRole);
          // Vertical spandrel columns from arch rib up to deck underside
          if (s % 2 === 0) {
            builder.addStrutBetweenPoints([x0, ay, az0], [x0, ay, z0 - deckThick], 0.22, structureRole);
          }
        }
        if (s % 3 === 0) {
          builder.addStrutBetweenPoints([x0, cy - hw * 0.78, az0], [x0, cy + hw * 0.78, az0], 0.22, structureRole);
        }
      } else if (config.style === 'arch_suspension') {
        // Through-Arch / Arch-Suspension Bridge: Overhead parabolic arch ribs rising ABOVE the deck
        // with vertical hanger cables holding up the deck + overhead cross-bracing!
        const overArchZ = (t: number): number => {
          const para = 4 * t * (1 - t); // 0 at ends, 1 at center
          return getDeckZ(t) + para * archH;
        };
        const oz0 = overArchZ(t0);
        const oz1 = overArchZ(t1);
        for (const side of [-1, 1]) {
          const ay = cy + side * (hw + 0.18);
          builder.addStrutBetweenPoints([x0, ay, oz0], [x1, ay, oz1], 0.34, structureRole);
          if (s % 2 === 0 && oz0 > z0 + railH + 0.3) {
            builder.addStrutBetweenPoints([x0, ay, z0], [x0, ay, oz0], 0.1, 'steel_cable');
          }
        }
        // Overhead lateral cross-ties connecting the two arch ribs where the arch is high enough for vehicles/Spartans
        if (s % 3 === 0 && oz0 > z0 + 3.2) {
          builder.addStrutBetweenPoints([x0, cy - hw - 0.18, oz0], [x0, cy + hw + 0.18, oz0], 0.22, structureRole);
        }
      }
    }

    // Add End Pylons / Suspension Towers at `t = 0.12, 0.88` (for suspension) or `x = 0, dist` (for Forerunner)
    if (config.style === 'suspension') {
      for (const towerT of [0.12, 0.88]) {
        const tx = towerT * dist;
        const tz = getDeckZ(towerT);
        const legBottomZ = tz - archH * 0.45;
        const legTopZ = tz + archH + 0.5;
        const legH = legTopZ - legBottomZ;
        const legCenterZ = (legBottomZ + legTopZ) * 0.5;
        builder.addSolidBox(tx, cy - hw - 0.35, legCenterZ, 0.7, 0.7, legH, structureRole);
        builder.addSolidBox(tx, cy + hw + 0.35, legCenterZ, 0.7, 0.7, legH, structureRole);
        // Overhead tower cross-beams (above Spartan/vehicle clearance)
        builder.addSolidBox(tx, cy, legTopZ - 0.3, 0.65, bw + 1.4, 0.55, structureRole);
        if (archH >= 4.5) {
          builder.addSolidBox(tx, cy, tz + Math.max(3.2, archH * 0.6), 0.5, bw + 1.2, 0.4, structureRole);
        }
      }
    } else if (config.style === 'forerunner_beam') {
      for (const endX of [0, dist]) {
        const ez = getDeckZ(endX / dist);
        for (const side of [-1, 1]) {
          builder.addStrutBetweenPoints(
            [endX, cy + side * (hw + 0.5), ez - 1.5],
            [endX + (endX === 0 ? 1.8 : -1.8), cy + side * (hw + 0.9), ez + 3.8],
            0.55,
            structureRole,
          );
        }
      }
    }
  }

  // Interconnecting Cross-Bridges / Catwalks between adjacent main bridges
  if (bridgeCount > 1 && interconnectCount > 0) {
    const crossW = Math.max(2.0, bw * 0.65);
    for (let ic = 0; ic < interconnectCount; ic++) {
      const frac = (ic + 1) / (interconnectCount + 1);
      const cx = frac * dist;
      const cz = getDeckZ(frac);
      for (let bIdx = 0; bIdx < bridgeCount - 1; bIdx++) {
        const y0 = getBridgeY(bIdx) + bw * 0.5;
        const y1 = getBridgeY(bIdx + 1) - bw * 0.5;
        if (y1 <= y0) continue;
        const spanY = y1 - y0;
        const midY = (y0 + y1) * 0.5;
        // Walkable cross-deck
        builder.addSolidBox(cx, midY, cz - deckThick * 0.5, crossW, spanY, deckThick, deckRole);
        // Cross-bridge guardrails
        if (railH > 0.05) {
          builder.addSolidBox(cx - crossW * 0.5 + 0.1, midY, cz + railH * 0.5, 0.18, spanY, railH, railRole);
          builder.addSolidBox(cx + crossW * 0.5 - 0.1, midY, cz + railH * 0.5, 0.18, spanY, railH, railRole);
        }
      }
    }
  }

  // Build route waypoints along Bridge 0 for 3-sphere Spartan walkability verification
  const waypoints: [number, number, number][] = [];
  for (let s = 0; s <= 12; s++) {
    const t = s / 12;
    waypoints.push([t * dist, getBridgeY(0), getDeckZ(t)]);
  }

  return builder.finalize(waypoints, [2.0, getBridgeY(0), getDeckZ(2.0 / dist) + 0.15]);
}

/**
 * Creates a default heightfield terrain configuration with a Halo CE biome preset.
 */
export function createPresetTerrainGrid(
  preset: TerrainBiomePreset = 'bloodgulch_canyon',
  sizeX = 120,
  sizeY = 120,
  steps = 24,
): TerrainGridConfig {
  const safeSteps = Math.max(8, Math.min(64, Math.round(steps)));
  const stride = safeSteps + 1;
  const heights = new Array<number>(stride * stride).fill(0);

  let groundRole: WorldMaterialRole = 'dirt_ground';
  let cliffRole: WorldMaterialRole = 'rock_wall';

  for (let iy = 0; iy <= safeSteps; iy++) {
    const ny = (iy / safeSteps) * 2 - 1; // -1 .. +1
    for (let ix = 0; ix <= safeSteps; ix++) {
      const nx = (ix / safeSteps) * 2 - 1; // -1 .. +1
      const r = Math.hypot(nx, ny);
      let z = 0;

      if (preset === 'bloodgulch_canyon') {
        groundRole = 'sand_ground';
        cliffRole = 'rock_wall';
        // Box canyon walls along Y edges + rolling dunes in the valley floor
        const canyonWall = Math.pow(Math.max(0, Math.abs(ny) - 0.55) / 0.45, 1.8) * 14.0;
        const rollingHills = Math.sin(nx * Math.PI * 2) * Math.cos(ny * Math.PI * 1.5) * 1.2;
        z = canyonWall + rollingHills;
      } else if (preset === 'timberland_ridge') {
        groundRole = 'grass_ground';
        cliffRole = 'rock_wall';
        const rim = Math.pow(Math.max(0, r - 0.5) / 0.5, 1.6) * 12.0;
        const centralHill = Math.max(0, 1 - (r / 0.35) ** 2) * 3.8;
        const undulation = Math.sin(nx * 4.0) * Math.sin(ny * 4.0) * 0.9;
        z = rim + centralHill + undulation;
      } else if (preset === 'icefields_glacier') {
        groundRole = 'snow_ground';
        cliffRole = 'rock_wall';
        const gorge = Math.abs(ny) < 0.25 ? -2.8 * (1 - Math.abs(ny) / 0.25) : 0;
        const ridge = Math.pow(Math.abs(ny), 1.5) * 9.0 + Math.cos(nx * Math.PI * 2) * 1.1;
        z = gorge + ridge;
      } else if (preset === 'deathisland_mesa') {
        groundRole = 'grass_ground';
        cliffRole = 'rock_wall';
        const plateau = r < 0.45 ? 6.5 : r < 0.7 ? 6.5 * (1 - (r - 0.45) / 0.25) : 0;
        z = plateau + Math.sin(nx * 3.2) * Math.cos(ny * 3.2) * 0.6;
      }

      heights[iy * stride + ix] = Number(z.toFixed(3));
    }
  }

  return {
    enabled: true,
    sizeX,
    sizeY,
    steps: safeSteps,
    heights,
    groundRole,
    cliffRole,
  };
}

/**
 * Applies an interactive terrain brush operation (`raise`, `lower`, `flatten`, `smooth`, `hills`, `canyon`, `crater`, `ridge`)
 * to a `TerrainGridConfig` heightfield.
 */
export function sculptTerrainGrid(
  terrain: TerrainGridConfig,
  mode: TerrainSculptMode,
  brushNormX = 0.5,
  brushNormY = 0.5,
  brushRadiusNorm = 0.28,
  strength = 3.0,
): TerrainGridConfig {
  const steps = Math.max(4, terrain.steps);
  const stride = steps + 1;
  const next = [...terrain.heights];
  while (next.length < stride * stride) next.push(0);

  const rNorm = Math.max(0.05, Math.min(1.0, brushRadiusNorm));
  const centerIx = Math.max(0, Math.min(steps, Math.round(brushNormX * steps)));
  const centerIy = Math.max(0, Math.min(steps, Math.round(brushNormY * steps)));
  const targetFlattenZ = next[centerIy * stride + centerIx] ?? 0;

  for (let iy = 0; iy <= steps; iy++) {
    const uy = iy / steps;
    for (let ix = 0; ix <= steps; ix++) {
      const ux = ix / steps;
      const idx = iy * stride + ix;
      const dist = Math.hypot(ux - brushNormX, uy - brushNormY);
      if (dist > rNorm && mode !== 'hills' && mode !== 'canyon') continue;

      const falloff = dist <= rNorm ? 0.5 * (1 + Math.cos((dist / rNorm) * Math.PI)) : 0;
      const curZ = next[idx];

      switch (mode) {
        case 'raise':
          next[idx] = curZ + strength * falloff;
          break;
        case 'lower':
          next[idx] = curZ - strength * falloff;
          break;
        case 'flatten':
          next[idx] = curZ + (targetFlattenZ - curZ) * falloff * Math.min(1, Math.abs(strength) * 0.35);
          break;
        case 'smooth': {
          let sum = 0;
          let cnt = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = ix + dx;
              const ny = iy + dy;
              if (nx >= 0 && nx <= steps && ny >= 0 && ny <= steps) {
                sum += terrain.heights[ny * stride + nx] ?? 0;
                cnt++;
              }
            }
          }
          const avg = cnt > 0 ? sum / cnt : curZ;
          next[idx] = curZ + (avg - curZ) * falloff * 0.75;
          break;
        }
        case 'crater': {
          const u = dist / rNorm;
          const rim = u > 0.65 ? Math.sin(((u - 0.65) / 0.35) * Math.PI) * strength * 0.45 : -strength * (1 - (u / 0.65) ** 2);
          next[idx] = curZ + rim;
          break;
        }
        case 'ridge': {
          const lineDist = Math.abs(uy - brushNormY) / rNorm;
          if (lineDist < 1) {
            next[idx] = curZ + strength * (1 - lineDist * lineDist);
          }
          break;
        }
        case 'hills':
          next[idx] = curZ + Math.sin(ux * Math.PI * 3) * Math.cos(uy * Math.PI * 3) * strength * 0.65;
          break;
        case 'canyon': {
          const ny = uy * 2 - 1;
          const wall = Math.pow(Math.max(0, Math.abs(ny) - 0.45) / 0.55, 1.7) * strength * 3.0;
          next[idx] = wall;
          break;
        }
      }
    }
  }

  return {
    ...terrain,
    heights: next,
  };
}

/**
 * Generates a complete QuickForge World BSP mesh combining:
 * 1. Sculptable Heightfield Terrain (hills, canyons, craters, natural slopes with cliff auto-texturing),
 * 2. Procedural Human City / Street Grid (roads, sidewalks, multi-story accessible buildings, highway overpass, street barricades),
 * 3. Modular Nature-Inspired & Forerunner-Styled Architectural Pieces.
 */
export function generateQuickForgeWorldMesh(config: QuickForgeWorldConfig): GeneratedWorldMesh {
  const builder = new MeshBuilder([0, 0, 0], 0);

  // 1. Heightfield Terrain Mesh
  const t = config.terrain;
  if (t && t.enabled) {
    const steps = Math.max(4, Math.min(64, Math.round(t.steps || 20)));
    const stride = steps + 1;
    const halfX = (t.sizeX || 120) * 0.5;
    const halfY = (t.sizeY || 120) * 0.5;
    const cellW = (t.sizeX || 120) / steps;
    const cellH = (t.sizeY || 120) / steps;

    const getPt = (ix: number, iy: number): [number, number, number] => {
      const x = -halfX + ix * cellW;
      const y = -halfY + iy * cellH;
      const z = t.heights[iy * stride + ix] ?? 0;
      return [x, y, z];
    };

    for (let iy = 0; iy < steps; iy++) {
      for (let ix = 0; ix < steps; ix++) {
        const p00 = getPt(ix, iy);
        const p10 = getPt(ix + 1, iy);
        const p11 = getPt(ix + 1, iy + 1);
        const p01 = getPt(ix, iy + 1);
        const maxDz = Math.max(
          Math.abs(p10[2] - p00[2]),
          Math.abs(p11[2] - p00[2]),
          Math.abs(p01[2] - p00[2]),
        );
        const role = maxDz / Math.max(0.5, Math.min(cellW, cellH)) > 0.65 ? t.cliffRole : t.groundRole;
        builder.addTriangle(p00, p10, p11, role, 0.18);
        builder.addTriangle(p00, p11, p01, role, 0.18);
      }
    }
  }

  // 2. Procedural Human City / Street Grid Generator
  const city = config.city;
  if (city && city.enabled) {
    const bxCount = Math.max(1, Math.min(6, Math.round(city.blocksX || 2)));
    const byCount = Math.max(1, Math.min(6, Math.round(city.blocksY || 2)));
    const bSize = Math.max(8, city.blockSize || 16);
    const sWidth = Math.max(3, city.streetWidth || 6);
    const swWidth = Math.max(0.6, city.sidewalkWidth || 1.2);
    const pitch = bSize + sWidth;
    const totalX = bxCount * pitch + sWidth;
    const totalY = byCount * pitch + sWidth;
    const ox = (city.origin?.[0] ?? 0) - totalX * 0.5;
    const oy = (city.origin?.[1] ?? 0) - totalY * 0.5;
    const oz = city.origin?.[2] ?? 0.05;

    // Base Asphalt Street Pad
    builder.addSolidBox(
      ox + totalX * 0.5,
      oy + totalY * 0.5,
      oz - 0.15,
      totalX,
      totalY,
      0.3,
      'concrete_road',
      'concrete_road',
    );

    for (let by = 0; by < byCount; by++) {
      for (let bx = 0; bx < bxCount; bx++) {
        const blockCenterX = ox + sWidth + bx * pitch + bSize * 0.5;
        const blockCenterY = oy + sWidth + by * pitch + bSize * 0.5;

        // Raised pedestrian sidewalk slab
        builder.addSolidBox(
          blockCenterX,
          blockCenterY,
          oz + 0.12,
          bSize,
          bSize,
          0.24,
          'sidewalk_concrete',
          'sidewalk_concrete',
        );

        // Deterministic building height per block
        const hash = ((bx * 7 + by * 13) % 5) / 4;
        const bHeight =
          (city.buildingMinHeight || 5) +
          hash * Math.max(1, (city.buildingMaxHeight || 14) - (city.buildingMinHeight || 5));
        const bFootprint = Math.max(4, bSize - swWidth * 2);
        const wallThick = 0.55;

        if (city.includeAccessibleInteriors) {
          // Hollow building shell with ground-floor doorway openings, roof slab, and interior ramp to roof!
          const halfF = bFootprint * 0.5;
          const doorW = Math.min(2.6, bFootprint * 0.35);
          const doorH = 2.4;
          const sidePanelW = (bFootprint - doorW) * 0.5;

          // Front & Back walls with center doorway opening
          for (const sideY of [-1, 1]) {
            const wy = blockCenterY + sideY * (halfF - wallThick * 0.5);
            builder.addSolidBox(blockCenterX - halfF + sidePanelW * 0.5, wy, oz + 0.24 + bHeight * 0.5, sidePanelW, wallThick, bHeight, 'building_facade');
            builder.addSolidBox(blockCenterX + halfF - sidePanelW * 0.5, wy, oz + 0.24 + bHeight * 0.5, sidePanelW, wallThick, bHeight, 'building_facade');
            if (bHeight > doorH) {
              builder.addSolidBox(blockCenterX, wy, oz + 0.24 + doorH + (bHeight - doorH) * 0.5, doorW, wallThick, bHeight - doorH, 'building_facade');
            }
          }
          // Left & Right solid walls
          for (const sideX of [-1, 1]) {
            const wx = blockCenterX + sideX * (halfF - wallThick * 0.5);
            builder.addSolidBox(wx, blockCenterY, oz + 0.24 + bHeight * 0.5, wallThick, bFootprint, bHeight, 'building_facade');
          }
          // Rooftop deck with sniper opening + interior ramp
          const roofZ = oz + 0.24 + bHeight;
          builder.addSolidBox(blockCenterX - bFootprint * 0.18, blockCenterY, roofZ, bFootprint * 0.64, bFootprint, 0.4, 'sidewalk_concrete');
          // Ramp from ground floor up to roof along +X inside wall
          const rX0 = blockCenterX + bFootprint * 0.16;
          const rX1 = blockCenterX + halfF - wallThick;
          const rY0 = blockCenterY - halfF + wallThick;
          const rY1 = blockCenterY + halfF - wallThick;
          builder.addQuad([rX0, rY0, oz + 0.24], [rX1, rY0, oz + 0.24], [rX1, rY1, roofZ], [rX0, rY1, roofZ], 'forerunner_floor', 0.25, true);
        } else {
          // Solid skyscraper block with rooftop parapet
          builder.addSolidBox(
            blockCenterX,
            blockCenterY,
            oz + 0.24 + bHeight * 0.5,
            bFootprint,
            bFootprint,
            bHeight,
            'building_facade',
            'sidewalk_concrete',
          );
        }

        // Optional street barricades in intersections
        if (city.includeStreetBarricades && bx < bxCount - 1) {
          const streetX = blockCenterX + bSize * 0.5 + sWidth * 0.5;
          builder.addSolidBox(streetX, blockCenterY, oz + 0.45, 0.6, 2.4, 0.9, 'forerunner_trim');
        }
      }
    }

    // Optional Elevated Highway Overpass with On/Off Ramps
    if (city.includeHighwayOverpass) {
      const hwyY = oy + totalY * 0.5;
      const hwyZ = oz + 4.8;
      const hwyW = Math.max(4.0, sWidth * 0.85);
      builder.addSolidBox(ox + totalX * 0.5, hwyY, hwyZ, totalX, hwyW, 0.45, 'concrete_road');
      // Guardrails
      builder.addSolidBox(ox + totalX * 0.5, hwyY - hwyW * 0.5 + 0.15, hwyZ + 0.5, totalX, 0.25, 0.65, 'sidewalk_concrete');
      builder.addSolidBox(ox + totalX * 0.5, hwyY + hwyW * 0.5 - 0.15, hwyZ + 0.5, totalX, 0.25, 0.65, 'sidewalk_concrete');
      // Support columns
      for (let bx = 0; bx <= bxCount; bx++) {
        const colX = ox + sWidth * 0.5 + bx * pitch;
        builder.addSolidBox(colX, hwyY, oz + 2.4, 0.9, 0.9, 4.8, 'sidewalk_concrete');
      }
      // West & East On-Ramps
      const rampLen = 10.0;
      builder.addQuad(
        [ox - rampLen, hwyY - hwyW * 0.5, oz],
        [ox, hwyY - hwyW * 0.5, hwyZ],
        [ox, hwyY + hwyW * 0.5, hwyZ],
        [ox - rampLen, hwyY + hwyW * 0.5, oz],
        'concrete_road',
        0.25,
        true,
      );
      builder.addQuad(
        [ox + totalX, hwyY - hwyW * 0.5, hwyZ],
        [ox + totalX + rampLen, hwyY - hwyW * 0.5, oz],
        [ox + totalX + rampLen, hwyY + hwyW * 0.5, oz],
        [ox + totalX, hwyY + hwyW * 0.5, hwyZ],
        'concrete_road',
        0.25,
        true,
      );
    }
  }

  // 3. Modular Nature-Inspired, Forerunner & Human Pieces
  for (const piece of config.pieces ?? []) {
    const pBuilder = new MeshBuilder(piece.position, piece.yawDeg || 0);
    const [sx, sy, sz] = [
      Math.max(1, piece.size[0] || 6),
      Math.max(1, piece.size[1] || 6),
      Math.max(0.5, piece.size[2] || 4),
    ];

    switch (piece.kind) {
      case 'natural_arch': {
        // Walkable rocky arch spanning along X
        const steps = 10;
        const hw = sy * 0.5;
        for (let i = 0; i < steps; i++) {
          const t0 = i / steps, t1 = (i + 1) / steps;
          const x0 = (t0 - 0.5) * sx, x1 = (t1 - 0.5) * sx;
          const zTop0 = sz * (0.75 + 0.25 * Math.sin(t0 * Math.PI));
          const zTop1 = sz * (0.75 + 0.25 * Math.sin(t1 * Math.PI));
          const zBot0 = Math.sin(t0 * Math.PI) * sz * 0.65;
          const zBot1 = Math.sin(t1 * Math.PI) * sz * 0.65;
          pBuilder.addQuad([x0, -hw, zTop0], [x1, -hw, zTop1], [x1, hw, zTop1], [x0, hw, zTop0], 'dirt_ground');
          pBuilder.addQuad([x0, hw, zBot0], [x1, hw, zBot1], [x1, -hw, zBot1], [x0, -hw, zBot0], 'rock_wall');
          pBuilder.addQuad([x0, -hw, zBot0], [x1, -hw, zBot1], [x1, -hw, zTop1], [x0, -hw, zTop0], 'rock_wall');
          pBuilder.addQuad([x1, hw, zBot1], [x0, hw, zBot0], [x0, hw, zTop0], [x1, hw, zTop1], 'rock_wall');
        }
        break;
      }
      case 'boulder_cluster': {
        pBuilder.addSolidBox(0, 0, sz * 0.45, sx * 0.65, sy * 0.65, sz * 0.9, 'rock_wall');
        pBuilder.addSolidBox(sx * 0.32, sy * 0.25, sz * 0.3, sx * 0.45, sy * 0.45, sz * 0.6, 'rock_wall');
        pBuilder.addSolidBox(-sx * 0.28, -sy * 0.22, sz * 0.25, sx * 0.4, sy * 0.4, sz * 0.5, 'rock_wall');
        break;
      }
      case 'cliff_spire': {
        pBuilder.addSolidBox(0, 0, sz * 0.3, sx, sy, sz * 0.6, 'rock_wall', 'grass_ground');
        pBuilder.addSolidBox(0, 0, sz * 0.75, sx * 0.6, sy * 0.6, sz * 0.5, 'rock_wall', 'grass_ground');
        break;
      }
      case 'canyon_wall': {
        pBuilder.addSolidBox(0, 0, sz * 0.5, sx, sy, sz, 'rock_wall', 'dirt_ground');
        break;
      }
      case 'crater_basin': {
        const rimT = Math.min(sx, sy) * 0.2;
        pBuilder.addSolidBox(0, -sy * 0.5 + rimT * 0.5, sz * 0.5, sx, rimT, sz, 'rock_wall');
        pBuilder.addSolidBox(0, sy * 0.5 - rimT * 0.5, sz * 0.5, sx, rimT, sz, 'rock_wall');
        pBuilder.addSolidBox(-sx * 0.5 + rimT * 0.5, 0, sz * 0.5, rimT, sy, sz, 'rock_wall');
        pBuilder.addSolidBox(sx * 0.5 - rimT * 0.5, 0, sz * 0.5, rimT, sy, sz, 'rock_wall');
        break;
      }
      case 'natural_ramp':
      case 'forerunner_ramp': {
        const isFore = piece.kind === 'forerunner_ramp';
        const topRole: WorldMaterialRole = isFore ? 'forerunner_floor' : 'dirt_ground';
        const sideRole: WorldMaterialRole = isFore ? 'forerunner_wall' : 'rock_wall';
        const hx = sx * 0.5, hy = sy * 0.5;
        pBuilder.addQuad([-hx, -hy, 0], [hx, -hy, sz], [hx, hy, sz], [-hx, hy, 0], topRole, 0.25, true);
        pBuilder.addQuad([-hx, hy, 0], [hx, hy, 0], [hx, -hy, 0], [-hx, -hy, 0], sideRole);
        pBuilder.addQuad([hx, -hy, 0], [hx, hy, 0], [hx, hy, sz], [hx, -hy, sz], sideRole);
        pBuilder.addTriangle([-hx, -hy, 0], [hx, -hy, 0], [hx, -hy, sz], sideRole);
        pBuilder.addTriangle([hx, hy, 0], [-hx, hy, 0], [hx, hy, sz], sideRole);
        break;
      }
      case 'forerunner_tower': {
        // Multi-tier angled Forerunner monolith with glowing energy core strips
        pBuilder.addSolidBox(0, 0, sz * 0.25, sx, sy, sz * 0.5, 'forerunner_wall', 'forerunner_floor');
        pBuilder.addSolidBox(0, 0, sz * 0.65, sx * 0.72, sy * 0.72, sz * 0.45, 'forerunner_trim', 'forerunner_floor');
        pBuilder.addSolidBox(0, 0, sz * 0.92, sx * 0.45, sy * 0.45, sz * 0.16, 'forerunner_light', 'forerunner_light');
        break;
      }
      case 'forerunner_bunker':
      case 'forerunner_octagonal_room': {
        // Walkable Forerunner base room with front/back doorways and rooftop deck
        const wt = 0.6;
        const doorW = Math.min(2.8, sy * 0.4);
        const sideW = (sy - doorW) * 0.5;
        pBuilder.addSolidBox(0, 0, 0.15, sx, sy, 0.3, 'forerunner_floor');
        pBuilder.addSolidBox(0, 0, sz, sx, sy, 0.4, 'forerunner_floor');
        pBuilder.addSolidBox(0, -sy * 0.5 + wt * 0.5, sz * 0.5, sx, wt, sz, 'forerunner_wall');
        pBuilder.addSolidBox(0, sy * 0.5 - wt * 0.5, sz * 0.5, sx, wt, sz, 'forerunner_wall');
        for (const endX of [-sx * 0.5 + wt * 0.5, sx * 0.5 - wt * 0.5]) {
          pBuilder.addSolidBox(endX, -sy * 0.5 + sideW * 0.5, sz * 0.5, wt, sideW, sz, 'forerunner_trim');
          pBuilder.addSolidBox(endX, sy * 0.5 - sideW * 0.5, sz * 0.5, wt, sideW, sz, 'forerunner_trim');
        }
        break;
      }
      case 'forerunner_energy_core': {
        pBuilder.addSolidBox(0, 0, 0.3, sx, sy, 0.6, 'forerunner_trim');
        pBuilder.addSolidBox(0, 0, sz * 0.5, sx * 0.45, sy * 0.45, sz * 0.85, 'forerunner_light');
        pBuilder.addSolidBox(0, 0, sz - 0.3, sx, sy, 0.6, 'forerunner_trim');
        break;
      }
      case 'forerunner_sniper_perch': {
        pBuilder.addSolidBox(0, 0, sz * 0.45, sx * 0.35, sy * 0.35, sz * 0.9, 'forerunner_trim');
        pBuilder.addSolidBox(0, 0, sz, sx, sy, 0.4, 'forerunner_floor');
        pBuilder.addSolidBox(sx * 0.5 - 0.15, 0, sz + 0.45, 0.25, sy, 0.65, 'forerunner_light');
        break;
      }
      case 'human_building':
      case 'human_overpass':
      case 'human_barricade':
      default: {
        pBuilder.addSolidBox(0, 0, sz * 0.5, sx, sy, sz, 'building_facade', 'sidewalk_concrete');
        break;
      }
    }

    // Merge piece geometry into master builder
    const vBase = builder.vertices.length;
    for (const v of pBuilder.vertices) builder.vertices.push(v);
    for (const tri of pBuilder.triangles) {
      builder.triangles.push({
        v0: tri.v0 + vBase,
        v1: tri.v1 + vBase,
        v2: tri.v2 + vBase,
        materialRole: tri.materialRole,
      });
    }
    for (const seg of pBuilder.wireframeSegments) {
      if (builder.wireframeSegments.length < 14000) builder.wireframeSegments.push(seg);
    }
  }

  return builder.finalize(
    [
      [-10, 0, 0.5],
      [0, 0, 0.5],
      [10, 0, 0.5],
    ],
    [0, 0, 2.0],
  );
}

/**
 * Exports a `GeneratedWorldMesh` to standard Wavefront `.OBJ` text with `usemtl <role>` groups,
 * ready to be compiled by `parseObjMesh` / `buildCustomObjectContainer` or saved to disk.
 */
export function exportWorldMeshToObj(
  mesh: GeneratedWorldMesh,
  roleToShaderName?: Partial<Record<WorldMaterialRole, string>>,
): string {
  const lines: string[] = [
    '# Generated by OpenCE Mantle Procedural World, Tunnel & Bridge Builder',
    `# Vertices: ${mesh.vertices.length}, Triangles: ${mesh.triangles.length}`,
  ];

  for (const v of mesh.vertices) {
    lines.push(`v ${v.position[0].toFixed(4)} ${v.position[1].toFixed(4)} ${v.position[2].toFixed(4)}`);
  }
  for (const v of mesh.vertices) {
    lines.push(`vt ${v.uv[0].toFixed(4)} ${v.uv[1].toFixed(4)}`);
  }
  for (const v of mesh.vertices) {
    lines.push(`vn ${v.normal[0].toFixed(4)} ${v.normal[1].toFixed(4)} ${v.normal[2].toFixed(4)}`);
  }

  // Group triangles by materialRole so each role becomes a distinct `usemtl` material slot
  const byRole = new Map<WorldMaterialRole, GeneratedWorldTriangle[]>();
  for (const tri of mesh.triangles) {
    let list = byRole.get(tri.materialRole);
    if (!list) {
      list = [];
      byRole.set(tri.materialRole, list);
    }
    list.push(tri);
  }

  for (const [role, tris] of byRole.entries()) {
    const slotName = (roleToShaderName?.[role] || role).replace(/\s+/g, '_');
    lines.push(`g ${role}`);
    lines.push(`usemtl ${slotName}`);
    for (const t of tris) {
      const i0 = t.v0 + 1;
      const i1 = t.v1 + 1;
      const i2 = t.v2 + 1;
      lines.push(`f ${i0}/${i0}/${i0} ${i1}/${i1}/${i1} ${i2}/${i2}/${i2}`);
    }
  }

  return lines.join('\n');
}

/**
 * Exports a `GeneratedWorldMesh` to Halo CE `.JMS` (`8200`) format for HEK `tool.exe structure` compatibility.
 */
export function exportWorldMeshToJms(
  mesh: GeneratedWorldMesh,
  roleToShaderName?: Partial<Record<WorldMaterialRole, string>>,
): string {
  const roles = mesh.materialRoles.length > 0 ? mesh.materialRoles : (['forerunner_floor'] as WorldMaterialRole[]);
  const roleToIndex = new Map<WorldMaterialRole, number>();
  roles.forEach((r, i) => roleToIndex.set(r, i));

  const lines: string[] = [
    '8200',
    '3251',
    '1',
    'frame',
    '-1',
    '-1',
    '0.000000\t0.000000\t0.000000\t1.000000',
    '0.000000\t0.000000\t0.000000',
    String(roles.length),
  ];

  for (const r of roles) {
    const rawName = roleToShaderName?.[r] || r;
    const leaf = rawName.split('\\').pop() || r;
    lines.push(leaf);
    lines.push('<none>');
  }

  // Markers = 0, Regions = 1 ("unnamed")
  lines.push('0', '1', 'unnamed');

  // Vertices (world units scaled by 100 for standard HEK JMS convention)
  lines.push(String(mesh.vertices.length));
  for (const v of mesh.vertices) {
    lines.push(
      '0',
      `${(v.position[0] * 100).toFixed(4)}\t${(v.position[1] * 100).toFixed(4)}\t${(v.position[2] * 100).toFixed(4)}`,
      `${v.normal[0].toFixed(6)}\t${v.normal[1].toFixed(6)}\t${v.normal[2].toFixed(6)}`,
      '-1',
      '0.000000',
      `${v.uv[0].toFixed(6)}`,
      `${v.uv[1].toFixed(6)}`,
      '0',
    );
  }

  // Triangles
  lines.push(String(mesh.triangles.length));
  for (const t of mesh.triangles) {
    const matIdx = roleToIndex.get(t.materialRole) ?? 0;
    lines.push('0', String(matIdx), `${t.v0}\t${t.v1}\t${t.v2}`);
  }

  return lines.join('\r\n');
}
