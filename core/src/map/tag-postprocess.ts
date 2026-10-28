import type { CacheFileHeader } from './header';
import type { TagIndex } from './tag-index';
import { resolveTagDataPointer } from './tag-index';

const OBJECT_SUBCLASS_FOURCCS = new Set([
  'bipd',
  'vehi',
  'weap',
  'eqip',
  'garb',
  'proj',
  'scen',
  'mach',
  'ctrl',
  'lifi',
  'ssce',
  'obje',
]);

/**
 * Inverts a 3x3 row-major Float32 matrix `m` (9 floats). Returns null if singular.
 */
function invertMatrix3x3(m: Float32Array): Float32Array | null {
  const a00 = m[0], a01 = m[1], a02 = m[2];
  const a10 = m[3], a11 = m[4], a12 = m[5];
  const a20 = m[6], a21 = m[7], a22 = m[8];

  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;

  const det = a00 * b01 + a01 * b11 + a02 * b21;
  if (Math.abs(det) < 1e-12) return null;
  const invDet = 1.0 / det;

  const out = new Float32Array(9);
  out[0] = b01 * invDet;
  out[1] = (-a22 * a01 + a02 * a21) * invDet;
  out[2] = (a12 * a01 - a02 * a11) * invDet;
  out[3] = b11 * invDet;
  out[4] = (a22 * a00 - a02 * a20) * invDet;
  out[5] = (-a12 * a00 + a02 * a10) * invDet;
  out[6] = b21 * invDet;
  out[7] = (-a21 * a00 + a01 * a20) * invDet;
  out[8] = (a11 * a00 - a01 * a10) * invDet;
  return out;
}

/**
 * Automatically recalculates derived runtime fields (`postprocess_proc`) in memory
 * after a tag's fields are edited in the Tag Editor (`Guerilla CE/MCC` & `MEK objs/*.py` parity).
 */
export function postprocessTagFields(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  editedTagIndex: number,
  _fieldName?: string,
): void {
  return postprocessEditedTagInPlace(buffer, header, tagIndex, editedTagIndex);
}

export function postprocessEditedTagInPlace(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  editedTagIndex: number,
): void {
  const entry = tagIndex.entries[editedTagIndex];
  if (!entry || entry.isExternal) return;

  let rootOff: number;
  try {
    rootOff = resolveTagDataPointer(
      entry.tagDataPointerOrResourceIndex,
      header,
      tagIndex.baseMemoryAddress,
    );
  } catch {
    return;
  }
  if (rootOff <= 0 || rootOff >= buffer.length) return;

  const group = entry.primaryClassName;

  try {
    if (
      OBJECT_SUBCLASS_FOURCCS.has(group ?? '') ||
      group === 'biped' ||
      group === 'vehicle' ||
      group === 'weapon' ||
      group === 'equipment' ||
      group === 'garbage' ||
      group === 'projectile' ||
      group === 'scenery' ||
      group === 'sound_scenery' ||
      group === 'device_machine' ||
      group === 'device_control' ||
      group === 'device_light_fixture'
    ) {
      postprocessObjectBaseFields(buffer, rootOff);
    }
    if (group === 'physics' || group === 'phys') {
      postprocessPhysicsTag(buffer, header, tagIndex, rootOff);
    } else if (group === 'point_physics' || group === 'pphy') {
      postprocessPointPhysicsTag(buffer, rootOff);
    } else if (
      group === 'device_machine' ||
      group === 'device_control' ||
      group === 'device_light_fixture' ||
      group === 'device' ||
      group === 'mach' ||
      group === 'ctrl' ||
      group === 'lifi' ||
      group === 'devi'
    ) {
      postprocessDeviceTag(buffer, rootOff, group === 'device_machine' || group === 'mach');
    } else if (group === 'light' || group === 'ligh') {
      postprocessLightTag(buffer, rootOff);
    } else if (group === 'particle' || group === 'part') {
      postprocessParticleTag(buffer, rootOff);
    } else if (group === 'effect' || group === 'effe') {
      postprocessEffectTag(buffer, header, tagIndex, rootOff);
    }
  } catch {
    // Non-fatal postprocess guard
  }
}

/**
 * Recalculates `phys` center_of_mass, per-point mass/density, xx/yy/zz moments, and 3x3 inertia matrix & inverse.
 */
function postprocessPhysicsTag(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  rootOff: number,
): void {
  if (rootOff + 0x80 > buffer.length) return;
  const momentScale = buffer.readFloatLE(rootOff + 0x04) || 0.3;
  const totalMass = buffer.readFloatLE(rootOff + 0x08);
  const totalDensity = buffer.readFloatLE(rootOff + 0x18);
  if (totalMass <= 0) return;

  const mpCount = buffer.readInt32LE(rootOff + 0x74);
  const mpPtr = buffer.readUInt32LE(rootOff + 0x78);
  if (mpCount <= 0 || mpCount > 64 || mpPtr === 0) return;

  const mpOff = resolveTagDataPointer(mpPtr, header, tagIndex.baseMemoryAddress);
  if (mpOff <= 0 || mpOff + mpCount * 128 > buffer.length) return;

  let sumRelMass = 0;
  let sumRelMassOverRelDen = 0;
  for (let i = 0; i < mpCount; i++) {
    const off = mpOff + i * 128;
    const relMass = Math.max(0.0001, buffer.readFloatLE(off + 0x28) || 1.0);
    const relDen = Math.max(0.0001, buffer.readFloatLE(off + 0x30) || 1.0);
    sumRelMass += relMass;
    sumRelMassOverRelDen += relMass / relDen;
  }
  if (sumRelMass <= 0) return;

  const denScale = totalDensity > 0 ? (totalDensity / mpCount) * sumRelMassOverRelDen : 0;
  const massScale = mpCount / sumRelMass;

  let comX = 0, comY = 0, comZ = 0;
  for (let i = 0; i < mpCount; i++) {
    const off = mpOff + i * 128;
    const relMass = Math.max(0.0001, buffer.readFloatLE(off + 0x28) || 1.0);
    const relDen = Math.max(0.0001, buffer.readFloatLE(off + 0x30) || 1.0);
    const ptMass = totalMass * (relMass / sumRelMass);
    const ptDen = denScale * massScale * relDen;
    buffer.writeFloatLE(ptMass, off + 0x2c);
    if (ptDen > 0) buffer.writeFloatLE(ptDen, off + 0x34);

    const px = buffer.readFloatLE(off + 0x38);
    const py = buffer.readFloatLE(off + 0x3c);
    const pz = buffer.readFloatLE(off + 0x40);
    comX += ptMass * px;
    comY += ptMass * py;
    comZ += ptMass * pz;
  }
  comX /= totalMass;
  comY /= totalMass;
  comZ /= totalMass;

  buffer.writeFloatLE(comX, rootOff + 0x0c);
  buffer.writeFloatLE(comY, rootOff + 0x10);
  buffer.writeFloatLE(comZ, rootOff + 0x14);

  let xx = 0, yy = 0, zz = 0, xy = 0, zx = 0, yz = 0;
  for (let i = 0; i < mpCount; i++) {
    const off = mpOff + i * 128;
    const ptMass = buffer.readFloatLE(off + 0x2c);
    const px = buffer.readFloatLE(off + 0x38) - comX;
    const py = buffer.readFloatLE(off + 0x3c) - comY;
    const pz = buffer.readFloatLE(off + 0x40) - comZ;
    const radius = Math.max(0.01, buffer.readFloatLE(off + 0x68));
    const rTerm = 0.4 * radius * radius;

    xx += ptMass * (py * py + pz * pz + rTerm);
    yy += ptMass * (px * px + pz * pz + rTerm);
    zz += ptMass * (px * px + py * py + rTerm);
    xy += ptMass * (px * py);
    zx += ptMass * (px * pz);
    yz += ptMass * (py * pz);
  }

  const m = new Float32Array([
    momentScale * xx, -momentScale * xy, -momentScale * zx,
    -momentScale * xy, momentScale * yy, -momentScale * yz,
    -momentScale * zx, -momentScale * yz, momentScale * zz,
  ]);

  buffer.writeFloatLE(m[0], rootOff + 0x50);
  buffer.writeFloatLE(m[4], rootOff + 0x54);
  buffer.writeFloatLE(m[8], rootOff + 0x58);

  const imCount = buffer.readInt32LE(rootOff + 0x5c);
  const imPtr = buffer.readUInt32LE(rootOff + 0x60);
  if (imCount >= 2 && imPtr !== 0) {
    const imOff = resolveTagDataPointer(imPtr, header, tagIndex.baseMemoryAddress);
    if (imOff > 0 && imOff + 72 <= buffer.length) {
      const mInv = invertMatrix3x3(m);
      if (mInv) {
        for (let k = 0; k < 9; k++) {
          buffer.writeFloatLE(m[k], imOff + k * 4);
          buffer.writeFloatLE(mInv[k], imOff + 36 + k * 4);
        }
      }
    }
  }
}

/**
 * Recalculates `pphy` buoyancy and air/water gravity scales from density.
 */
function postprocessPointPhysicsTag(buffer: Buffer, rootOff: number): void {
  if (rootOff + 64 > buffer.length) return;
  const density = buffer.readFloatLE(rootOff + 0x18);
  if (density <= 0) return;
  buffer.writeFloatLE((density * 355840.0) / 3.0, rootOff + 0x04);
  buffer.writeFloatLE(-((density - 1.0) / (density + 1.0)), rootOff + 0x08);
  buffer.writeFloatLE(-((density / 0.0011 - 1.0) / (density / 0.0011 + 1.0)), rootOff + 0x0c);
}

/**
 * Recalculates `devi` / `mach` inverse transition times and door_open_time_ticks.
 */
function postprocessDeviceTag(buffer: Buffer, rootOff: number, isMachine: boolean): void {
  if (rootOff + 0x290 > buffer.length) return;
  const powerTrans = buffer.readFloatLE(rootOff + 0x180);
  const powerAccel = buffer.readFloatLE(rootOff + 0x184);
  const posTrans = buffer.readFloatLE(rootOff + 0x188);
  const posAccel = buffer.readFloatLE(rootOff + 0x18c);
  const delayTime = buffer.readFloatLE(rootOff + 0x190);

  buffer.writeFloatLE(powerTrans > 0 ? 1.0 / (30.0 * powerTrans) : 0, rootOff + 0x26c);
  buffer.writeFloatLE(powerAccel > 0 ? 1.0 / (30.0 * powerAccel) : 0, rootOff + 0x270);
  buffer.writeFloatLE(posTrans > 0 ? 1.0 / (30.0 * posTrans) : 0, rootOff + 0x274);
  buffer.writeFloatLE(posAccel > 0 ? 1.0 / (30.0 * posAccel) : 0, rootOff + 0x278);
  buffer.writeInt16LE(Math.max(0, Math.floor(30.0 * delayTime)), rootOff + 0x284);

  if (isMachine && rootOff + 0x324 <= buffer.length) {
    const doorOpenSec = buffer.readFloatLE(rootOff + 0x2d8);
    buffer.writeInt16LE(Math.max(0, Math.floor(30.0 * doorOpenSec)), rootOff + 0x320);
  }
}

/**
 * Ensures `ligh` specular_radius_multiplier = 2.0 and precomputes frustum angle cosines/sines.
 */
function postprocessLightTag(buffer: Buffer, rootOff: number): void {
  if (rootOff + 0x40 > buffer.length) return;
  const specMult = buffer.readFloatLE(rootOff + 0x1c);
  if (specMult === 0) {
    buffer.writeFloatLE(2.0, rootOff + 0x1c);
  }
  const falloffRad = buffer.readFloatLE(rootOff + 0x10);
  const cutoffRad = buffer.readFloatLE(rootOff + 0x14);
  if (falloffRad !== 0 || cutoffRad !== 0) {
    buffer.writeFloatLE(Math.cos(falloffRad), rootOff + 0x20);
    buffer.writeFloatLE(Math.cos(cutoffRad), rootOff + 0x24);
    buffer.writeFloatLE(Math.sin(cutoffRad), rootOff + 0x2c);
  }
}

/**
 * Enforces `part` contact_deterioration = 0.0 (preventing Halo collision freeze) and make_it_actually_work = 1.
 */
function postprocessParticleTag(buffer: Buffer, rootOff: number): void {
  if (rootOff + 0xd8 > buffer.length) return;
  buffer.writeFloatLE(0.0, rootOff + 0x88);
  buffer.writeInt16LE(1, rootOff + 0xce);
}

/**
 * Populates `EffectPart.type_class` FourCC and `EffectParticle.relative_direction_vector`.
 */
function postprocessEffectTag(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  rootOff: number,
): void {
  if (rootOff + 0x40 > buffer.length) return;
  const evCount = buffer.readInt32LE(rootOff + 0x2c);
  const evPtr = buffer.readUInt32LE(rootOff + 0x30);
  if (evCount <= 0 || evCount > 64 || evPtr === 0) return;

  const evBase = resolveTagDataPointer(evPtr, header, tagIndex.baseMemoryAddress);
  if (evBase <= 0 || evBase + evCount * 68 > buffer.length) return;

  for (let e = 0; e < evCount; e++) {
    const evOff = evBase + e * 68;
    // 1. Parts reflexive at +0x28 (104 bytes each)
    const partCount = buffer.readInt32LE(evOff + 0x28);
    const partPtr = buffer.readUInt32LE(evOff + 0x2c);
    if (partCount > 0 && partCount <= 64 && partPtr !== 0) {
      const partBase = resolveTagDataPointer(partPtr, header, tagIndex.baseMemoryAddress);
      if (partBase > 0 && partBase + partCount * 104 <= buffer.length) {
        for (let p = 0; p < partCount; p++) {
          const pOff = partBase + p * 104;
          const refGroupRev = buffer.toString('latin1', pOff + 0x18, pOff + 0x1c);
          const refGroup = refGroupRev.split('').reverse().join('');
          if (refGroup.trim().length === 4) {
            const typeClass = OBJECT_SUBCLASS_FOURCCS.has(refGroup) ? 'obje' : refGroup;
            buffer.write(typeClass.split('').reverse().join(''), pOff + 0x14, 4, 'latin1');
          }
        }
      }
    }

    // 2. Particles reflexive at +0x34 (232 bytes each)
    const ptclCount = buffer.readInt32LE(evOff + 0x34);
    const ptclPtr = buffer.readUInt32LE(evOff + 0x38);
    if (ptclCount > 0 && ptclCount <= 64 && ptclPtr !== 0) {
      const ptclBase = resolveTagDataPointer(ptclPtr, header, tagIndex.baseMemoryAddress);
      if (ptclBase > 0 && ptclBase + ptclCount * 232 <= buffer.length) {
        for (let p = 0; p < ptclCount; p++) {
          const pOff = ptclBase + p * 232;
          const yaw = buffer.readFloatLE(pOff + 0x18);
          const pitch = buffer.readFloatLE(pOff + 0x1c);
          const cosP = Math.cos(pitch);
          buffer.writeFloatLE(Math.cos(yaw) * cosP, pOff + 0x20);
          buffer.writeFloatLE(Math.sin(yaw) * cosP, pOff + 0x24);
          buffer.writeFloatLE(Math.sin(pitch), pOff + 0x28);
        }
      }
    }
  }
}

/**
 * Ensures `Object.render_bounding_radius` (+0xAC) is at least `Object.bounding_radius` (+0x04)
 * so enlarged custom objects do not get prematurely frustum-culled by Halo's renderer.
 */
function postprocessObjectBaseFields(buffer: Buffer, rootOff: number): void {
  if (rootOff + 0xb4 > buffer.length) return;
  const boundingRadius = buffer.readFloatLE(rootOff + 0x04);
  const renderBoundingRadius = buffer.readFloatLE(rootOff + 0xac);
  if (Number.isFinite(boundingRadius) && boundingRadius > 0) {
    if (!Number.isFinite(renderBoundingRadius) || renderBoundingRadius < boundingRadius) {
      buffer.writeFloatLE(boundingRadius, rootOff + 0xac);
    }
  }
}
