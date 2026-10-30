/**
 * Semantic Map Comparison & Pre-Flight Cross-Map Tag Migration Reviewer.
 *
 * Compares two Halo `.map` files by normalized `class:path` identity rather than
 * memory addresses or datum IDs, diffing tag inventory, storage (`Embedded` vs `External`),
 * decoded root/reflexive fields, and resolved tag references.
 * Also performs pre-flight migration conflict detection (`class-conflict` and
 * `inconsistent-source-reference`) on `.ocetags` containers before injection.
 *
 * Adapted from Project Guilty Spark (`compare.ts` and `tagMigrationReview.ts`).
 */

import { parseCacheFileHeader } from './header';
import { parseTagIndex, type TagIndexEntry } from './tag-index';
import { readTagFieldValues, type TagFieldDescriptor, type TagReflexiveElement } from './tag-field-editor';
import type { OceContainer } from './container';

export type DifferenceStatus = 'added' | 'removed' | 'changed' | 'unknown';
export type MapDifferenceCategory = string;

export interface ReflexiveAlignmentResult {
  matchedPairs: Array<{ oldIdx: number; newIdx: number; identity?: string; moved: boolean }>;
  addedIndices: number[];
  removedIndices: number[];
  strategy: 'identity' | 'content';
}

const IDENTITY_FIELD_CANDIDATES = [
  'name',
  'label',
  'permutation name',
  'marker name',
  'node name',
  'script name',
  'region name',
  'camera point name',
  'object name',
  'shader',
  'item collection',
  'weapon',
  'vehicle',
  'biped',
  'equipment',
  'scenery',
  'sound',
  'bitmap',
  'damage effect',
  'projectile',
];

function extractElementIdentity(elem: TagReflexiveElement): string | null {
  for (const candidate of IDENTITY_FIELD_CANDIDATES) {
    const f = elem.fields.find((field) => field.name.toLowerCase() === candidate);
    if (!f) continue;
    if (f.kind === 'string' && typeof f.value === 'string' && f.value.trim()) {
      return f.value.trim();
    }
    if (f.kind === 'dependency' && f.dependencyTarget && f.dependencyTarget.path) {
      return `${f.dependencyTarget.group}:${normalizeComparePath(f.dependencyTarget.path)}`;
    }
  }
  for (const f of elem.fields) {
    if (f.kind === 'string' && typeof f.value === 'string' && f.value.trim()) {
      return f.value.trim();
    }
  }
  for (const f of elem.fields) {
    if (f.kind === 'dependency' && f.dependencyTarget && f.dependencyTarget.path) {
      return `${f.dependencyTarget.group}:${normalizeComparePath(f.dependencyTarget.path)}`;
    }
  }
  return null;
}

function computeElementFingerprints(elem: TagReflexiveElement): { shallow: string; deep: string } {
  const shallowParts: string[] = [];
  const deepParts: string[] = [];
  for (const f of elem.fields) {
    if (f.kind === 'reflexive') {
      const childDeep = (f.children ?? []).map((c) => computeElementFingerprints(c).deep).join(';');
      deepParts.push(`${f.name}=[${childDeep}]`);
    } else {
      const val = formatFieldDisplay(f);
      shallowParts.push(`${f.name}=${val}`);
      deepParts.push(`${f.name}=${val}`);
    }
  }
  return {
    shallow: shallowParts.join('|'),
    deep: deepParts.join('|'),
  };
}

function computeLisKeepIndices(seq: number[]): Set<number> {
  if (seq.length === 0) return new Set();
  const tails: number[] = [];
  const tailIdx: number[] = [];
  const prev = new Array<number>(seq.length).fill(-1);

  for (let i = 0; i < seq.length; i++) {
    const val = seq[i]!;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (tails[mid]! < val) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = val;
    tailIdx[lo] = i;
    if (lo > 0) prev[i] = tailIdx[lo - 1]!;
  }

  const keep = new Set<number>();
  let cur = tailIdx[tails.length - 1] ?? -1;
  while (cur >= 0) {
    keep.add(cur);
    cur = prev[cur]!;
  }
  return keep;
}

function lcsIndexPairs(leftKeys: string[], rightKeys: string[]): Array<[number, number]> {
  const m = leftKeys.length;
  const n = rightKeys.length;
  if (m === 0 || n === 0) return [];
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (leftKeys[i] === rightKeys[j]) {
        dp[i]![j] = 1 + dp[i + 1]![j + 1]!;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (leftKeys[i] === rightKeys[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/**
 * Baboon 3-tier semantic reflexive block alignment:
 * 1. `alignByIdentity`: when every element on both sides has a unique non-empty primary name/dependency identity,
 *    pairs elements by identity and detects reordered elements via Patience-sort Longest Increasing Subsequence (LIS).
 * 2. `alignByContent`: falls back to dynamic-programming LCS over recursive deep fingerprints, refines contiguous
 *    gaps with shallow fingerprints, and pairs 1-to-1 modified slots while isolating true insertions/deletions.
 */
export function alignReflexiveElements(
  leftChildren: TagReflexiveElement[],
  rightChildren: TagReflexiveElement[],
): ReflexiveAlignmentResult {
  const leftIds = leftChildren.map(extractElementIdentity);
  const rightIds = rightChildren.map(extractElementIdentity);
  const allLeftValid = leftChildren.length > 0 && leftIds.every((id): id is string => !!id);
  const allRightValid = rightChildren.length > 0 && rightIds.every((id): id is string => !!id);
  const uniqueLeft = new Set(leftIds).size === leftIds.length;
  const uniqueRight = new Set(rightIds).size === rightIds.length;

  if (allLeftValid && allRightValid && uniqueLeft && uniqueRight) {
    const rightById = new Map<string, number>();
    rightIds.forEach((id, idx) => rightById.set(id!, idx));

    const rawPairs: Array<{ oldIdx: number; newIdx: number; identity: string }> = [];
    const matchedOld = new Set<number>();
    const matchedNew = new Set<number>();

    for (let oldIdx = 0; oldIdx < leftChildren.length; oldIdx++) {
      const id = leftIds[oldIdx]!;
      const newIdx = rightById.get(id);
      if (newIdx !== undefined) {
        rawPairs.push({ oldIdx, newIdx, identity: id });
        matchedOld.add(oldIdx);
        matchedNew.add(newIdx);
      }
    }

    const lisSet = computeLisKeepIndices(rawPairs.map((p) => p.newIdx));
    const matchedPairs: ReflexiveAlignmentResult['matchedPairs'] = rawPairs.map((p, idx) => ({
      oldIdx: p.oldIdx,
      newIdx: p.newIdx,
      identity: p.identity,
      moved: !lisSet.has(idx),
    }));

    const unmatchedOld = leftChildren.map((_, i) => i).filter((i) => !matchedOld.has(i));
    const unmatchedNew = rightChildren.map((_, i) => i).filter((i) => !matchedNew.has(i));

    // If equal number of unmatched old and new slots remain (e.g. a renamed element), pair them 1-to-1
    if (unmatchedOld.length > 0 && unmatchedOld.length === unmatchedNew.length) {
      for (let k = 0; k < unmatchedOld.length; k++) {
        matchedPairs.push({
          oldIdx: unmatchedOld[k]!,
          newIdx: unmatchedNew[k]!,
          identity: `${leftIds[unmatchedOld[k]!]} -> ${rightIds[unmatchedNew[k]!]}`,
          moved: false,
        });
      }
      matchedPairs.sort((a, b) => a.oldIdx - b.oldIdx);
      return {
        matchedPairs,
        addedIndices: [],
        removedIndices: [],
        strategy: 'identity',
      };
    }

    return {
      matchedPairs,
      addedIndices: unmatchedNew,
      removedIndices: unmatchedOld,
      strategy: 'identity',
    };
  }

  // Tier 2: Content fingerprint LCS alignment (deep + shallow gap refinement)
  const leftFp = leftChildren.map(computeElementFingerprints);
  const rightFp = rightChildren.map(computeElementFingerprints);
  const deepPairs = lcsIndexPairs(
    leftFp.map((f) => f.deep),
    rightFp.map((f) => f.deep),
  );

  const matchedPairs: ReflexiveAlignmentResult['matchedPairs'] = [];
  const removedIndices: number[] = [];
  const addedIndices: number[] = [];

  const anchors: Array<[number, number]> = [...deepPairs, [leftChildren.length, rightChildren.length]];
  let prevOld = 0;
  let prevNew = 0;

  for (const [anchorOld, anchorNew] of anchors) {
    const gapOldLen = anchorOld - prevOld;
    const gapNewLen = anchorNew - prevNew;

    if (gapOldLen > 0 && gapNewLen > 0) {
      const gapOldShallow = leftFp.slice(prevOld, anchorOld).map((f) => f.shallow);
      const gapNewShallow = rightFp.slice(prevNew, anchorNew).map((f) => f.shallow);
      const shallowSubPairs = lcsIndexPairs(gapOldShallow, gapNewShallow);

      if (shallowSubPairs.length > 0) {
        const subAnchors: Array<[number, number]> = [...shallowSubPairs, [gapOldLen, gapNewLen]];
        let subPrevO = 0;
        let subPrevN = 0;
        for (const [so, sn] of subAnchors) {
          const remO = so - subPrevO;
          const remN = sn - subPrevN;
          const pairCount = Math.min(remO, remN);
          for (let k = 0; k < pairCount; k++) {
            const oi = prevOld + subPrevO + k;
            const ni = prevNew + subPrevN + k;
            matchedPairs.push({
              oldIdx: oi,
              newIdx: ni,
              identity: leftIds[oi] ?? rightIds[ni] ?? undefined,
              moved: false,
            });
          }
          for (let k = pairCount; k < remO; k++) removedIndices.push(prevOld + subPrevO + k);
          for (let k = pairCount; k < remN; k++) addedIndices.push(prevNew + subPrevN + k);
          if (so < gapOldLen && sn < gapNewLen) {
            const oi = prevOld + so;
            const ni = prevNew + sn;
            matchedPairs.push({
              oldIdx: oi,
              newIdx: ni,
              identity: leftIds[oi] ?? rightIds[ni] ?? undefined,
              moved: false,
            });
          }
          subPrevO = so + 1;
          subPrevN = sn + 1;
        }
      } else {
        const pairCount = Math.min(gapOldLen, gapNewLen);
        for (let k = 0; k < pairCount; k++) {
          const oi = prevOld + k;
          const ni = prevNew + k;
          matchedPairs.push({
            oldIdx: oi,
            newIdx: ni,
            identity: leftIds[oi] ?? rightIds[ni] ?? undefined,
            moved: false,
          });
        }
        for (let k = pairCount; k < gapOldLen; k++) removedIndices.push(prevOld + k);
        for (let k = pairCount; k < gapNewLen; k++) addedIndices.push(prevNew + k);
      }
    } else if (gapOldLen > 0) {
      for (let k = 0; k < gapOldLen; k++) removedIndices.push(prevOld + k);
    } else if (gapNewLen > 0) {
      for (let k = 0; k < gapNewLen; k++) addedIndices.push(prevNew + k);
    }

    if (anchorOld < leftChildren.length && anchorNew < rightChildren.length) {
      matchedPairs.push({
        oldIdx: anchorOld,
        newIdx: anchorNew,
        identity: leftIds[anchorOld] ?? rightIds[anchorNew] ?? undefined,
        moved: false,
      });
    }
    prevOld = anchorOld + 1;
    prevNew = anchorNew + 1;
  }

  return {
    matchedPairs,
    addedIndices,
    removedIndices,
    strategy: 'content',
  };
}

export function compareTagFieldListsSemantically(
  leftFields: TagFieldDescriptor[],
  rightFields: TagFieldDescriptor[],
  pushRow: (
    property: string,
    before: string,
    after: string,
    status?: DifferenceStatus,
    detail?: string,
  ) => void,
  prefix = '',
  depth = 0,
): void {
  if (depth > 3) return;
  const rightByName = new Map(rightFields.map((f) => [f.name, f]));

  for (const lf of leftFields) {
    const rf = rightByName.get(lf.name);
    if (!rf) continue;
    const propPath = prefix ? `${prefix}.${lf.name}` : lf.name;

    if (lf.kind === 'reflexive' && Array.isArray(lf.children) && Array.isArray(rf.children)) {
      if (lf.children.length !== rf.children.length) {
        pushRow(
          propPath,
          formatFieldDisplay(lf),
          formatFieldDisplay(rf),
          'changed',
          `Reflexive block count changed (${lf.children.length} -> ${rf.children.length})`,
        );
      }
      if (lf.children.length <= 64 && rf.children.length <= 64 && (lf.children.length > 0 || rf.children.length > 0)) {
        const alignment = alignReflexiveElements(lf.children, rf.children);
        for (const remIdx of alignment.removedIndices) {
          const remChild = lf.children[remIdx];
          const label = remChild ? extractElementIdentity(remChild) ?? `#${remIdx}` : `#${remIdx}`;
          pushRow(
            `${propPath}[-${remIdx}:${label}]`,
            label,
            'Removed',
            'removed',
            `Removed element ${remIdx} (${label})`,
          );
        }
        for (const addIdx of alignment.addedIndices) {
          const addChild = rf.children[addIdx];
          const label = addChild ? extractElementIdentity(addChild) ?? `#${addIdx}` : `#${addIdx}`;
          pushRow(
            `${propPath}[+${addIdx}:${label}]`,
            'Not present',
            label,
            'added',
            `Added element at index ${addIdx} (${label})`,
          );
        }
        for (const pair of alignment.matchedPairs) {
          const lChild = lf.children[pair.oldIdx];
          const rChild = rf.children[pair.newIdx];
          if (!lChild || !rChild) continue;
          const idSuffix = pair.identity ? `:${pair.identity}` : '';
          const idxLabel =
            pair.oldIdx === pair.newIdx
              ? `${propPath}[${pair.oldIdx}${idSuffix}]`
              : `${propPath}[${pair.oldIdx}->${pair.newIdx}${idSuffix}]`;
          if (pair.moved) {
            pushRow(
              idxLabel,
              `Index #${pair.oldIdx}`,
              `Index #${pair.newIdx}`,
              'changed',
              `Reordered element${pair.identity ? ` "${pair.identity}"` : ''}`,
            );
          }
          compareTagFieldListsSemantically(lChild.fields, rChild.fields, pushRow, idxLabel, depth + 1);
        }
      }
      continue;
    }

    const lv = formatFieldDisplay(lf);
    const rv = formatFieldDisplay(rf);
    if (lv !== rv) {
      pushRow(propPath, lv, rv, 'changed');
    }
  }
}

export interface MapDifferenceRow {
  id: string;
  category: string;
  status: DifferenceStatus;
  subject: string;
  property: string;
  before: string;
  after: string;
  detail?: string;
  leftTagIndex?: number;
  rightTagIndex?: number;
}

export interface MapComparisonReport {
  leftScenarioName: string;
  rightScenarioName: string;
  leftEngine: number;
  rightEngine: number;
  leftTagCount: number;
  rightTagCount: number;
  matchedTags: number;
  unchangedTags: number;
  addedTags: number;
  removedTags: number;
  changedTags: number;
  rows: MapDifferenceRow[];
}

export const normalizeComparePath = (path: string): string =>
  path.replace(/\\/g, '/').replace(/\/{2,}/g, '/').trim().toLowerCase();

export const tagIdentityKey = (group: string | null | undefined, path: string): string =>
  `${(group ?? 'unknown').toLowerCase()}:${normalizeComparePath(path)}`;

const ASSET_GROUPS = new Set([
  'bitmap',
  'sound',
  'gbxmodel',
  'model',
  'model_animations',
  'model_collision_geometry',
  'shader_environment',
  'shader_model',
  'shader_transparent_chicago',
  'shader_transparent_chicago_extended',
  'shader_transparent_water',
  'shader_transparent_meter',
  'shader_transparent_glass',
  'shader_transparent_plasma',
  'shader_transparent_generic',
]);

const MENU_GROUPS = new Set([
  'ui_widget_definition',
  'ui_widget_collection',
  'hud_number',
  'hud_globals',
  'unit_hud_interface',
  'grenade_hud_interface',
  'weapon_hud_interface',
  'font',
  'unicode_string_list',
  'string_list',
  'meter',
]);

const WEAPON_GROUPS = new Set([
  'weapon',
  'projectile',
  'item_collection',
  'damage_effect',
  'continuous_damage_effect',
  'equipment',
]);

const AI_UNIT_GROUPS = new Set(['actor', 'actor_variant', 'biped', 'vehicle']);

function categorizeGroup(group: string | null | undefined): string {
  const g = (group ?? '').toLowerCase();
  if (AI_UNIT_GROUPS.has(g)) return 'AI, Units & Vehicles';
  if (WEAPON_GROUPS.has(g)) return 'Weapons, Projectiles & Damage';
  if (MENU_GROUPS.has(g)) return 'Menu, HUD & Strings';
  if (ASSET_GROUPS.has(g)) return 'Models, Shaders, Bitmaps & Sounds';
  if (g === 'scenario' || g === 'scenario_structure_bsp' || g === 'sky' || g === 'fog') {
    return 'Scenario & World';
  }
  return 'Other Tags';
}

function formatFieldDisplay(field: TagFieldDescriptor): string {
  if (field.kind === 'dependency') {
    if (!field.dependencyTarget) return 'null';
    return `${field.dependencyTarget.group}:${normalizeComparePath(field.dependencyTarget.path)}`;
  }
  if (field.kind === 'reflexive') {
    return `${field.reflexiveCount ?? 0} element(s)`;
  }
  if (field.kind === 'enum' && field.enumOptions && typeof field.value === 'number') {
    return `${field.enumOptions[field.value] ?? field.value} (${field.value})`;
  }
  if (typeof field.value === 'number') {
    return Number.isInteger(field.value) ? String(field.value) : Number(field.value.toFixed(6)).toString();
  }
  if (typeof field.value === 'string') {
    return field.value;
  }
  if (field.value === null || field.value === undefined) {
    return 'null';
  }
  return JSON.stringify(field.value);
}

/**
 * Compares two Halo `.map` buffers semantically by `group:path` identity, ignoring raw pointers and datum IDs.
 */
export function compareMaps(
  leftBuffer: Buffer,
  rightBuffer: Buffer,
  maxDifferenceRows = 2500,
): MapComparisonReport {
  const leftHeader = parseCacheFileHeader(leftBuffer);
  const rightHeader = parseCacheFileHeader(rightBuffer);
  const leftIndex = parseTagIndex(leftBuffer, leftHeader);
  const rightIndex = parseTagIndex(rightBuffer, rightHeader);

  const rows: MapDifferenceRow[] = [];
  const pushRow = (
    category: string,
    subject: string,
    property: string,
    before: string,
    after: string,
    status: DifferenceStatus = 'changed',
    detail?: string,
    leftTagIndex?: number,
    rightTagIndex?: number,
  ) => {
    if (rows.length >= maxDifferenceRows) return;
    if (status === 'changed' && before === after && !detail) return;
    rows.push({
      id: `${category}:${rows.length}`,
      category,
      status,
      subject,
      property,
      before,
      after,
      detail,
      leftTagIndex,
      rightTagIndex,
    });
  };

  if (leftHeader.engine !== rightHeader.engine) {
    pushRow(
      'Map Header',
      'Cache Header',
      'Engine Version',
      String(leftHeader.engine),
      String(rightHeader.engine),
      'changed',
    );
  }
  if (leftHeader.mapType !== rightHeader.mapType) {
    pushRow(
      'Map Header',
      'Cache Header',
      'Scenario Type',
      String(leftHeader.mapType),
      String(rightHeader.mapType),
      'changed',
    );
  }

  const groupMap = (entries: TagIndexEntry[]) => {
    const map = new Map<string, TagIndexEntry[]>();
    for (const entry of entries) {
      const k = tagIdentityKey(entry.primaryClassName, entry.path);
      const list = map.get(k);
      if (list) list.push(entry);
      else map.set(k, [entry]);
    }
    return map;
  };

  const leftGrouped = groupMap(leftIndex.entries);
  const rightGrouped = groupMap(rightIndex.entries);
  const allKeys = [...new Set([...leftGrouped.keys(), ...rightGrouped.keys()])].sort();

  let matchedTags = 0;
  let unchangedTags = 0;
  let addedTags = 0;
  let removedTags = 0;
  let changedTags = 0;

  for (const key of allKeys) {
    const beforeList = leftGrouped.get(key) ?? [];
    const afterList = rightGrouped.get(key) ?? [];
    const sample = beforeList[0] ?? afterList[0];
    const groupName = sample.primaryClassName ?? 'unknown';
    const category = categorizeGroup(groupName);
    const subject = `${sample.path || '(empty path)'} [${groupName}]`;

    if (beforeList.length > 1 || afterList.length > 1) {
      pushRow(
        category,
        subject,
        'Duplicate Tag Identity',
        `${beforeList.length} entries`,
        `${afterList.length} entries`,
        'unknown',
        'Multiple tags share this group and path.',
        beforeList[0]?.index,
        afterList[0]?.index,
      );
      continue;
    }

    if (!beforeList.length) {
      addedTags++;
      pushRow(
        category,
        subject,
        'Tag Inventory',
        'Not present',
        key,
        'added',
        undefined,
        undefined,
        afterList[0].index,
      );
      continue;
    }

    if (!afterList.length) {
      removedTags++;
      pushRow(
        category,
        subject,
        'Tag Inventory',
        key,
        'Not present',
        'removed',
        undefined,
        beforeList[0].index,
        undefined,
      );
      continue;
    }

    matchedTags++;
    const leftEntry = beforeList[0];
    const rightEntry = afterList[0];
    const beforeRowCount = rows.length;

    if (leftEntry.isExternal !== rightEntry.isExternal) {
      pushRow(
        category,
        subject,
        'Resource Storage',
        leftEntry.isExternal ? 'External (resource map)' : 'Embedded (in .map)',
        rightEntry.isExternal ? 'External (resource map)' : 'Embedded (in .map)',
        'changed',
        undefined,
        leftEntry.index,
        rightEntry.index,
      );
    }

    if (!leftEntry.isExternal && !rightEntry.isExternal && groupName !== 'scenario_structure_bsp') {
      try {
        const leftFields = readTagFieldValues(leftBuffer, leftHeader, leftIndex, leftEntry.index);
        const rightFields = readTagFieldValues(rightBuffer, rightHeader, rightIndex, rightEntry.index);
        compareTagFieldListsSemantically(
          leftFields.fields,
          rightFields.fields,
          (property, before, after, status = 'changed', detail) => {
            pushRow(
              category,
              subject,
              property,
              before,
              after,
              status,
              detail,
              leftEntry.index,
              rightEntry.index,
            );
          },
        );
      } catch {
        // Ignore unwalkable or custom-protected tags during bulk comparison
      }
    }

    if (rows.length > beforeRowCount) {
      changedTags++;
    } else {
      unchangedTags++;
    }
  }

  return {
    leftScenarioName: leftHeader.scenarioName,
    rightScenarioName: rightHeader.scenarioName,
    leftEngine: leftHeader.engine,
    rightEngine: rightHeader.engine,
    leftTagCount: leftIndex.entries.length,
    rightTagCount: rightIndex.entries.length,
    matchedTags,
    unchangedTags,
    addedTags,
    removedTags,
    changedTags,
    rows,
  };
}

/* ------------------- Pre-Flight Container Migration Reviewer ------------------- */

export type MigrationTagStatus = 'identity-present' | 'not-present' | 'class-conflict';
export type MigrationDependencyStatus =
  | 'present-in-target'
  | 'in-selected-source'
  | 'missing-from-target'
  | 'class-conflict'
  | 'inconsistent-source-reference';

export interface MigrationTagRow {
  group: string;
  path: string;
  status: MigrationTagStatus;
  conflictingGroups?: string[];
  note: string;
}

export interface MigrationDependencyRow {
  fromPath: string;
  fromGroup: string;
  targetGroup: string;
  targetPath: string;
  status: MigrationDependencyStatus;
}

export interface ContainerMigrationReview {
  selected: MigrationTagRow[];
  dependencies: MigrationDependencyRow[];
  counts: {
    selected: Record<MigrationTagStatus, number>;
    dependencies: Record<MigrationDependencyStatus, number>;
  };
  cautions: string[];
}

/**
 * Inspects an `.ocetags` container against a target `.map` buffer to detect
 * `class-conflict` (same path used under a different tag group) and `inconsistent-source-reference`
 * issues before tag injection.
 */
export function reviewContainerMigration(
  container: OceContainer,
  targetBuffer: Buffer,
): ContainerMigrationReview {
  const header = parseCacheFileHeader(targetBuffer);
  const tagIndex = parseTagIndex(targetBuffer, header);

  const byIdentity = new Map<string, TagIndexEntry>();
  const groupsAtPath = new Map<string, Set<string>>();

  for (const entry of tagIndex.entries) {
    const group = (entry.primaryClassName ?? '').toLowerCase();
    const normPath = normalizeComparePath(entry.path);
    byIdentity.set(`${group}:${normPath}`, entry);
    let set = groupsAtPath.get(normPath);
    if (!set) {
      set = new Set();
      groupsAtPath.set(normPath, set);
    }
    set.add(group);
  }

  const selectedIdentity = new Set(
    container.tags.map((t) => `${t.group.toLowerCase()}:${normalizeComparePath(t.path)}`),
  );

  const selected: MigrationTagRow[] = [];
  const dependencies: MigrationDependencyRow[] = [];
  const selectedCounts: Record<MigrationTagStatus, number> = {
    'identity-present': 0,
    'not-present': 0,
    'class-conflict': 0,
  };
  const dependencyCounts: Record<MigrationDependencyStatus, number> = {
    'present-in-target': 0,
    'in-selected-source': 0,
    'missing-from-target': 0,
    'class-conflict': 0,
    'inconsistent-source-reference': 0,
  };

  for (const tag of container.tags) {
    const normPath = normalizeComparePath(tag.path);
    const identity = `${tag.group.toLowerCase()}:${normPath}`;
    const existingGroups = groupsAtPath.get(normPath);
    const status: MigrationTagStatus = byIdentity.has(identity)
      ? 'identity-present'
      : existingGroups && existingGroups.size > 0
        ? 'class-conflict'
        : 'not-present';
    selectedCounts[status]++;
    const conflictingGroups =
      status === 'class-conflict' && existingGroups ? [...existingGroups] : undefined;

    selected.push({
      group: tag.group,
      path: tag.path,
      status,
      conflictingGroups,
      note:
        status === 'identity-present'
          ? 'Target map already has a tag with this group and path (will be reused in ADD mode or replaced in SWAP mode).'
          : status === 'class-conflict'
            ? `Target map uses path "${tag.path}" under a different tag group (${conflictingGroups?.join(', ')}).`
            : 'New tag path not currently in the target map.',
    });

    for (const dep of tag.dependencies ?? []) {
      const depNormPath = normalizeComparePath(dep.path);
      const depIdentity = `${dep.group.toLowerCase()}:${depNormPath}`;
      let disp: MigrationDependencyStatus;

      if (dep.kind === 'internal') {
        const localTarget =
          dep.localTagIndex !== undefined ? container.tags[dep.localTagIndex] : undefined;
        if (
          !localTarget ||
          localTarget.group.toLowerCase() !== dep.group.toLowerCase() ||
          normalizeComparePath(localTarget.path) !== depNormPath
        ) {
          disp = 'inconsistent-source-reference';
        } else if (byIdentity.has(depIdentity)) {
          disp = 'present-in-target';
        } else if (groupsAtPath.has(depNormPath)) {
          disp = 'class-conflict';
        } else {
          disp = 'in-selected-source';
        }
      } else {
        if (byIdentity.has(depIdentity)) {
          disp = 'present-in-target';
        } else if (groupsAtPath.has(depNormPath)) {
          disp = 'class-conflict';
        } else if (selectedIdentity.has(depIdentity)) {
          disp = 'in-selected-source';
        } else {
          disp = 'missing-from-target';
        }
      }

      dependencyCounts[disp]++;
      if (dependencies.length < 128) {
        dependencies.push({
          fromPath: tag.path,
          fromGroup: tag.group,
          targetGroup: dep.group,
          targetPath: dep.path,
          status: disp,
        });
      }
    }
  }

  const cautions: string[] = [];
  if (selectedCounts['class-conflict'] > 0 || dependencyCounts['class-conflict'] > 0) {
    cautions.push(
      `${selectedCounts['class-conflict'] + dependencyCounts['class-conflict']} tag(s) share a path with a different tag group in the target map (class-conflict).`,
    );
  }
  if (dependencyCounts['inconsistent-source-reference'] > 0) {
    cautions.push(
      `${dependencyCounts['inconsistent-source-reference']} internal container reference(s) disagree with their target tag's group/path.`,
    );
  }

  return {
    selected,
    dependencies,
    counts: {
      selected: selectedCounts,
      dependencies: dependencyCounts,
    },
    cautions,
  };
}
