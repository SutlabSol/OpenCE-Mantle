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
import { readTagFieldValues, type TagFieldDescriptor } from './tag-field-editor';
import type { OceContainer } from './container';

export type DifferenceStatus = 'added' | 'removed' | 'changed' | 'unknown';
export type MapDifferenceCategory = string;

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
        const rightByName = new Map(rightFields.fields.map((f) => [f.name, f]));

        for (const lf of leftFields.fields) {
          const rf = rightByName.get(lf.name);
          if (!rf) continue;
          const lv = formatFieldDisplay(lf);
          const rv = formatFieldDisplay(rf);
          if (lv !== rv) {
            pushRow(
              category,
              subject,
              lf.name,
              lv,
              rv,
              'changed',
              undefined,
              leftEntry.index,
              rightEntry.index,
            );
          } else if (
            lf.kind === 'reflexive' &&
            Array.isArray(lf.children) &&
            Array.isArray(rf.children) &&
            lf.children.length === rf.children.length &&
            lf.children.length <= 64
          ) {
            // Compare first-level reflexive elements when counts match
            for (let idx = 0; idx < lf.children.length; idx++) {
              const lChild = lf.children[idx];
              const rChild = rf.children[idx];
              if (!lChild || !rChild) continue;
              const rChildMap = new Map(rChild.fields.map((cf) => [cf.name, cf]));
              for (const lcf of lChild.fields) {
                const rcf = rChildMap.get(lcf.name);
                if (!rcf) continue;
                const lcv = formatFieldDisplay(lcf);
                const rcv = formatFieldDisplay(rcf);
                if (lcv !== rcv) {
                  pushRow(
                    category,
                    subject,
                    `${lf.name}[${idx}].${lcf.name}`,
                    lcv,
                    rcv,
                    'changed',
                    undefined,
                    leftEntry.index,
                    rightEntry.index,
                  );
                }
              }
            }
          }
        }
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
