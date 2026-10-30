import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { TagEntrySummary, TagFieldDescriptor, TagFieldsResult } from '../../electron/shared-types';
import { NULL_TAG_ID } from '../../../core/src/constants/tag-classes';
import { getFieldExplanation, getTagGroupExplanation } from '../../../core/src/map/definitions/tag-explanations';

interface Props {
  focusedTag: TagEntrySummary | null;
  allTags?: TagEntrySummary[];
}

let cachedReflexiveClipboardJson: string | null = null;

/**
 * Recursively apply a new value to the leaf field at `fieldPath` (a dotted reflexive path such
 * as `"magazines[0].rounds recharged"`) within `fields`. Returns a new array; the input is not
 * mutated. Unknown paths are returned unchanged.
 */
function applyFieldUpdate(
  fields: TagFieldDescriptor[],
  fieldPath: string,
  newValue: unknown,
  allTags: TagEntrySummary[],
): TagFieldDescriptor[] {
  return applyPathSegments(fields, fieldPath.split('.'), newValue, allTags);
}

function applyPathSegments(
  fields: TagFieldDescriptor[],
  segments: string[],
  newValue: unknown,
  allTags: TagEntrySummary[],
): TagFieldDescriptor[] {
  const head = segments[0] ?? '';
  const rest = segments.slice(1);
  const bracketIdx = head.indexOf('[');
  if (bracketIdx !== -1) {
    // Head is a reflexive selector like "magazines[0]": update the given child element.
    const fieldName = head.slice(0, bracketIdx);
    const elementIdx = Number(head.slice(bracketIdx + 1, -1));
    return fields.map((f) => {
      if (f.name !== fieldName || f.kind !== 'reflexive' || !f.children) return f;
      const children = f.children.map((el, i) =>
        i !== elementIdx ? el : { ...el, fields: applyPathSegments(el.fields, rest, newValue, allTags) },
      );
      return { ...f, children };
    });
  }
  return fields.map((f) => {
    if (f.name !== head) return f;
    if (rest.length === 0) return toUpdatedLeaf(f, newValue, allTags);
    // Descend into reflexive children; the next segment may itself be a `[i]` selector.
    if (f.kind === 'reflexive' && f.children) {
      return {
        ...f,
        children: f.children.map((el) => ({
          ...el,
          fields: applyPathSegments(el.fields, rest, newValue, allTags),
        })),
      };
    }
    return f;
  });
}

function toUpdatedLeaf(field: TagFieldDescriptor, newValue: unknown, allTags: TagEntrySummary[]): TagFieldDescriptor {
  if (field.kind === 'dependency') {
    const targetTagId = typeof newValue === 'number' ? newValue : NULL_TAG_ID;
    const targetEntry = allTags.find((t) => t.tagId === targetTagId);
    return {
      ...field,
      value: targetTagId,
      dependencyTarget: targetEntry
        ? { tagId: targetEntry.tagId, path: targetEntry.path, group: targetEntry.primaryClassName }
        : null,
    };
  }
  return { ...field, value: newValue };
}

/**
 * True when any non-dependency descendant field (recursive, at any reflexive depth) of a
 * `kind === 'reflexive'` field matches the lowercased search `query` by name or type.
 */
function reflexiveDescendantMatches(field: TagFieldDescriptor, query: string): boolean {
  if (!field.children) return false;
  return field.children.some((el) =>
    el.fields.some((cf) => {
      if (cf.kind === 'dependency') return false;
      if (cf.name.toLowerCase().includes(query) || cf.type.toLowerCase().includes(query)) return true;
      return reflexiveDescendantMatches(cf, query);
    }),
  );
}

/** Field unit & tooltip resolution for engineering precision */
export function getFieldUnit(name: string, type: string): { unit?: string; tooltip?: string } {
  const lowerName = name.toLowerCase();
  const lowerType = type.toLowerCase();

  if (lowerType === 'angle') {
    return { unit: '°', tooltip: 'Angle in degrees (°)' };
  }
  if (lowerType === 'fraction') {
    return { unit: '0..1', tooltip: 'Fraction ratio [0.0 - 1.0]' };
  }
  if (lowerName.includes('ticks')) {
    return { unit: 'ticks', tooltip: 'Engine simulation ticks (30 ticks = 1 sec)' };
  }
  if (
    lowerName.includes('time') ||
    lowerName.includes('delay') ||
    lowerName.includes('duration') ||
    lowerName.includes('timeout') ||
    lowerName.includes('period') ||
    lowerName.includes('cooldown')
  ) {
    return { unit: 'sec', tooltip: 'Time duration in seconds' };
  }
  if (
    lowerName.includes('radius') ||
    lowerName.includes('distance') ||
    lowerName.includes('range') ||
    lowerName.includes('depth') ||
    lowerName.includes('height') ||
    lowerName.includes('width')
  ) {
    return { unit: 'wu', tooltip: 'World units (approx. 10 feet / 3 meters per unit)' };
  }
  if (lowerName.includes('speed') || lowerName.includes('velocity')) {
    return { unit: 'wu/s', tooltip: 'World units per second' };
  }
  if (lowerName.includes('acceleration') || lowerName.includes('deceleration')) {
    return { unit: 'wu/s²', tooltip: 'World units per second squared' };
  }
  if (lowerName.includes('damage') || lowerName.includes('health') || lowerName.includes('shield')) {
    return { unit: 'pts', tooltip: 'Vitality / damage hit points' };
  }
  if (lowerName.includes('rate') || lowerName.includes('rpm')) {
    return { unit: 'shots/s', tooltip: 'Rate of fire / trigger frequency' };
  }
  return {};
}

export interface CrossReflexiveOption {
  index: number;
  label: string;
}

/**
 * Resolves a human-readable cross-reflexive dropdown option list for `Index` / `int16` fields
 * that reference a sibling `TagReflexive` block in the same tag (mirroring MEK's dynamic block index dropdowns).
 */
export function resolveCrossReflexiveOptions(
  field: TagFieldDescriptor,
  rootFields: TagFieldDescriptor[],
  fieldPath?: string,
): { reflexiveName: string; options: CrossReflexiveOption[] } | null {
  if (field.kind !== 'number') return null;
  const lowerName = field.name.toLowerCase();
  const lowerPath = (fieldPath ?? field.name).toLowerCase();
  const isIndexType = field.type === 'Index';
  const isKnownIndexField =
    isIndexType ||
    lowerName === 'name' ||
    lowerName === 'shader index' ||
    lowerName === 'magazine' ||
    lowerName === 'material' ||
    lowerName === 'name index' ||
    lowerName === 'object name' ||
    lowerName === 'trigger volume' ||
    lowerName === 'camera point' ||
    lowerName === 'actor type' ||
    lowerName.endsWith(' node index') ||
    lowerName.endsWith(' palette index') ||
    lowerName === 'type' ||
    lowerName === 'parent node' ||
    lowerName === 'first child node' ||
    lowerName === 'next sibling node' ||
    lowerName === 'sky' ||
    lowerName === 'fog' ||
    lowerName === 'weather' ||
    lowerName === 'background sound' ||
    lowerName === 'sound environment' ||
    lowerName === 'command list' ||
    lowerName === 'starting profile' ||
    lowerName === 'conversation' ||
    lowerName === 'camera track' ||
    lowerName === 'trigger' ||
    lowerName === 'source' ||
    lowerName === 'destination' ||
    lowerName.includes('function') ||
    lowerName.includes('cluster') ||
    lowerName.includes('portal');

  if (!isKnownIndexField) return null;

  let targetReflexiveName: string | null = null;
  if (lowerName.includes('shader')) {
    targetReflexiveName = 'shaders';
  } else if (lowerName.includes('magazine')) {
    targetReflexiveName = 'magazines';
  } else if (lowerName.includes('node')) {
    targetReflexiveName = 'nodes';
  } else if (lowerName.includes('marker')) {
    targetReflexiveName = 'markers';
  } else if (lowerName.includes('region')) {
    targetReflexiveName = 'regions';
  } else if (lowerName.includes('material')) {
    targetReflexiveName = 'materials';
  } else if (lowerName.includes('geometry')) {
    targetReflexiveName = 'geometries';
  } else if (
    lowerName === 'name' ||
    lowerName.includes('name index') ||
    lowerName === 'object name' ||
    lowerName === 'source' ||
    lowerName === 'destination'
  ) {
    targetReflexiveName = 'object names';
  } else if (lowerName.includes('trigger volume')) {
    targetReflexiveName = 'trigger volumes';
  } else if (lowerName === 'trigger') {
    targetReflexiveName = 'triggers';
  } else if (lowerName.includes('camera point')) {
    targetReflexiveName = 'cutscene camera points';
  } else if (lowerName.includes('camera track')) {
    targetReflexiveName = 'camera tracks';
  } else if (lowerName === 'actor type') {
    targetReflexiveName = 'actor palette';
  } else if (lowerName === 'sky') {
    targetReflexiveName = 'skies';
  } else if (lowerName === 'fog') {
    targetReflexiveName = 'fog palette';
  } else if (lowerName === 'weather') {
    targetReflexiveName = 'weather palette';
  } else if (lowerName === 'background sound') {
    targetReflexiveName = 'background sound palette';
  } else if (lowerName === 'sound environment') {
    targetReflexiveName = 'sound environment palette';
  } else if (lowerName.includes('command list')) {
    targetReflexiveName = 'command lists';
  } else if (lowerName.includes('starting profile')) {
    targetReflexiveName = 'player starting profiles';
  } else if (lowerName.includes('conversation')) {
    targetReflexiveName = 'ai conversations';
  } else if (lowerName.includes('function')) {
    targetReflexiveName = 'functions';
  } else if (lowerName.includes('portal')) {
    targetReflexiveName = 'cluster portals';
  } else if (lowerName.includes('cluster')) {
    targetReflexiveName = 'clusters';
  } else if (lowerName === 'type') {
    if (lowerPath.startsWith('vehicles[')) targetReflexiveName = 'vehicle palette';
    else if (lowerPath.startsWith('scenery[')) targetReflexiveName = 'scenery palette';
    else if (lowerPath.startsWith('bipeds[')) targetReflexiveName = 'biped palette';
    else if (lowerPath.startsWith('weapons[')) targetReflexiveName = 'weapon palette';
    else if (lowerPath.startsWith('equipment[')) targetReflexiveName = 'equipment palette';
    else if (lowerPath.startsWith('machines[')) targetReflexiveName = 'machine palette';
    else if (lowerPath.startsWith('controls[')) targetReflexiveName = 'control palette';
    else if (lowerPath.startsWith('light fixtures[')) targetReflexiveName = 'light fixture palette';
    else if (lowerPath.startsWith('sound scenery[')) targetReflexiveName = 'sound scenery palette';
  } else if (lowerName.includes('scenery')) {
    targetReflexiveName = 'scenery palette';
  } else if (lowerName.includes('vehicle')) {
    targetReflexiveName = 'vehicle palette';
  } else if (lowerName.includes('weapon')) {
    targetReflexiveName = 'weapon palette';
  } else if (lowerName.includes('equipment')) {
    targetReflexiveName = 'equipment palette';
  } else if (lowerName.includes('biped')) {
    targetReflexiveName = 'biped palette';
  } else if (lowerName.includes('seat')) {
    targetReflexiveName = 'seats';
  } else if (lowerName.includes('encounter')) {
    targetReflexiveName = 'encounters';
  }

  if (!targetReflexiveName) return null;
  const targetBlock = rootFields.find((rf) => rf.kind === 'reflexive' && rf.name.toLowerCase() === targetReflexiveName);
  if (!targetBlock) return null;

  const options: CrossReflexiveOption[] = (targetBlock.children ?? []).map((el, idx) => {
    const nameField = el.fields.find((cf) => cf.kind === 'string' && cf.name.toLowerCase().includes('name'));
    const depField = el.fields.find((cf) => cf.kind === 'dependency' && cf.dependencyTarget);
    let summary = `${el.structName} #${idx}`;
    if (nameField && typeof nameField.value === 'string' && nameField.value.trim()) {
      summary = nameField.value.trim();
    } else if (depField?.dependencyTarget?.path) {
      const shortPath = depField.dependencyTarget.path.split('\\').pop() || depField.dependencyTarget.path;
      summary = `${shortPath} (${depField.dependencyTarget.group})`;
    }
    return {
      index: idx,
      label: `[${idx}] ${summary}`,
    };
  });

  return { reflexiveName: targetBlock.name, options };
}

const INTERNAL_CACHE_FIELD_NAMES = new Set([
  'node list checksum',
  'detail node count',
  'hardware character index',
  'pixels offset',
  'character index',
  'bsp3d nodes',
  'planes',
  'leaves',
  'bsp2d references',
  'bsp2d nodes',
  'surfaces',
  'edges',
  'vertices',
  'source file',
  'compiledin',
  'pointer',
  'data offset',
  'vertex offset',
  'indices offset',
]);

/**
 * Returns true if a field is an uneditable raw offset, read-only field, or compiler-internal
 * cache field that should be hidden when Simple Mode is active.
 */
function isClutterFieldInSimpleMode(field: TagFieldDescriptor): boolean {
  if (field.kind === 'unsupported') return true;
  if (field.readOnly && field.kind !== 'reflexive') return true;
  const lower = field.name.trim().toLowerCase();
  if (INTERNAL_CACHE_FIELD_NAMES.has(lower)) return true;
  if (field.kind === 'reflexive') {
    const count = field.children ? field.children.length : (field.reflexiveCount ?? 0);
    if (field.readOnly && count === 0 && !field.reflexiveStruct) return true;
  }
  return false;
}

/**
 * Component labels for composite array fields (e.g. RealPoint3D -> X, Y, Z; RealColorRGB -> R, G, B).
 */
function getCompositeLabels(type: string, length: number): string[] {
  const lower = type.toLowerCase();
  if (lower.includes('argb')) return ['Alpha', 'Red', 'Green', 'Blue'].slice(0, length);
  if (lower.includes('color') || lower.includes('rgb')) return ['Red', 'Green', 'Blue', 'Alpha'].slice(0, length);
  if (lower.includes('euler')) return ['Yaw (°)', 'Pitch (°)', 'Roll (°)'].slice(0, length);
  if (lower.includes('quaternion')) return ['i (X)', 'j (Y)', 'k (Z)', 'w (Real)'].slice(0, length);
  if (lower.includes('plane')) return ['Normal I', 'Normal J', 'Normal K', 'Distance D'].slice(0, length);
  if (lower.includes('rectangle')) return ['Top', 'Left', 'Bottom', 'Right'].slice(0, length);
  return ['X', 'Y', 'Z', 'W'].slice(0, length);
}

export default function TagFieldEditorPanel({ focusedTag, allTags = [] }: Props) {
  const [fieldsResult, setFieldsResult] = useState<TagFieldsResult | null>(null);
  const [isLoadingFields, setIsLoadingFields] = useState(false);
  const [fieldsError, setFieldsError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [simpleMode, setSimpleMode] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [addingChunkPath, setAddingChunkPath] = useState<string | null>(null);
  const [hudSafetyReport, setHudSafetyReport] = useState<{
    isGlobalHudMessageText: boolean;
    messageCount: number;
    warningBanner: string | null;
  } | null>(null);
  const [organizerState, setOrganizerState] = useState<{
    reflexivePath: string;
    structName: string;
    items: Array<{ sourceIndex: number; label: string; renameTo?: string }>;
  } | null>(null);

  // Expanded bitfields set
  const [expandedBitfields, setExpandedBitfields] = useState<Set<string>>(() => new Set());

  // Expanded reflexive block paths (root path or nested dotted reflexive path, e.g. "magazines[0].rounds recharged")
  const [expandedReflexives, setExpandedReflexives] = useState<Set<string>>(() => new Set());

  // Load fields whenever focused tag changes
  useEffect(() => {
    if (!focusedTag) {
      setFieldsResult(null);
      setFieldsError(null);
      setStatusMessage(null);
      return;
    }

    let isCancelled = false;
    setIsLoadingFields(true);
    setFieldsError(null);
    setStatusMessage(null);

    void window.opence.getTagFields(focusedTag.index).then((res) => {
      if (isCancelled) return;
      setIsLoadingFields(false);
      if (res.ok) {
        setFieldsResult(res.data);
      } else {
        setFieldsResult(null);
        setFieldsError(res.message);
      }
    });

    if (focusedTag.primaryClassName === 'hud_message_text' && typeof window.opence.analyzeHudMessageSafety === 'function') {
      void window.opence.analyzeHudMessageSafety(focusedTag.index).then((res) => {
        if (isCancelled) return;
        if (res.ok) {
          setHudSafetyReport({
            isGlobalHudMessageText: res.report.isGlobalHudMessageText,
            messageCount: res.report.messageCount,
            warningBanner: res.report.warningBanner,
          });
        } else {
          setHudSafetyReport(null);
        }
      });
    } else {
      setHudSafetyReport(null);
    }

    return () => {
      isCancelled = true;
    };
  }, [focusedTag]);

  const handleUpdateField = async (fieldPath: string, newValue: unknown) => {
    if (!focusedTag) return;
    setSavingField(fieldPath);
    setStatusMessage(null);

    const res = await window.opence.updateTagField(focusedTag.index, fieldPath, newValue);
    setSavingField(null);

    if (res.ok) {
      setStatusMessage(`Updated "${fieldPath}" in memory (Ctrl+S to save map)`);
      // Update local field value (root fields use their name; nested reflexive leaves use
      // dotted paths like "magazines[0].rounds recharged").
      setFieldsResult((prev) => {
        if (!prev) return prev;
        return { ...prev, fields: applyFieldUpdate(prev.fields, fieldPath, newValue, allTags) };
      });
    } else {
      setStatusMessage(`Failed to update "${fieldPath}": ${res.message}`);
    }
  };

  const handleAddChunk = async (fieldPath: string, cloneFromIndex: number = -1) => {
    if (!focusedTag) return;
    setAddingChunkPath(fieldPath);
    setStatusMessage(null);
    const actionName = cloneFromIndex >= 0 ? `Clone element #${cloneFromIndex}` : 'Add element';

    if (!window.opence.addReflexiveChunk) {
      setStatusMessage('Reflexive chunk modification is not supported in this environment.');
      setAddingChunkPath(null);
      return;
    }

    try {
      const res = await window.opence.addReflexiveChunk(focusedTag.index, fieldPath, cloneFromIndex);
      if (res.ok) {
        const msg =
          cloneFromIndex >= 0
            ? `Cloned element #${cloneFromIndex} to element #${res.newElementIndex} in "${fieldPath}" (in memory, Ctrl+S to save)`
            : `Added element #${res.newElementIndex} to "${fieldPath}" (in memory, Ctrl+S to save)`;
        setStatusMessage(msg);
        setExpandedReflexives((prev) => new Set(prev).add(fieldPath));
        const refresh = await window.opence.getTagFields(focusedTag.index);
        if (refresh.ok) {
          setFieldsResult(refresh.data);
        }
      } else {
        setStatusMessage(`Failed to ${actionName.toLowerCase()} in "${fieldPath}": ${res.message}`);
      }
    } catch (err) {
      const e = err as Error;
      setStatusMessage(`Failed to ${actionName.toLowerCase()} in "${fieldPath}": ${e.message}`);
    } finally {
      setAddingChunkPath(null);
    }
  };

  const handleCreateAndAssignObjectName = async (targetFieldPath: string, newObjName: string) => {
    const clean = newObjName.trim();
    if (!focusedTag || !clean || !window.opence.addReflexiveChunk) return;
    setSavingField(targetFieldPath);
    setStatusMessage(null);
    try {
      const addRes = await window.opence.addReflexiveChunk(focusedTag.index, 'object names', -1);
      if (!addRes.ok) {
        setStatusMessage(`Failed to add object name: ${addRes.message}`);
        return;
      }
      const newIdx = addRes.newElementIndex;
      await window.opence.updateTagField(focusedTag.index, `object names[${newIdx}].name`, clean);
      await window.opence.updateTagField(focusedTag.index, targetFieldPath, newIdx);
      const refresh = await window.opence.getTagFields(focusedTag.index);
      if (refresh.ok) {
        setFieldsResult(refresh.data);
      }
      setStatusMessage(`Created object name "[${newIdx}] ${clean}" and assigned to "${targetFieldPath}" (Ctrl+S to save).`);
    } catch (err) {
      setStatusMessage(`Failed to create object name: ${(err as Error).message}`);
    } finally {
      setSavingField(null);
    }
  };

  const toggleBitfieldExpand = (fieldPath: string) => {
    setExpandedBitfields((prev) => {
      const next = new Set(prev);
      if (next.has(fieldPath)) next.delete(fieldPath);
      else next.add(fieldPath);
      return next;
    });
  };

  const toggleReflexiveExpand = (fieldPath: string) => {
    setExpandedReflexives((prev) => {
      const next = new Set(prev);
      if (next.has(fieldPath)) next.delete(fieldPath);
      else next.add(fieldPath);
      return next;
    });
  };

  const { filteredFields, hiddenClutterCount } = useMemo(() => {
    if (!fieldsResult) return { filteredFields: [], hiddenClutterCount: 0 };
    // Dependency slots are edited via the Dependency Swapper tab in `PropertiesPalette`;
    // hide them here (value fields only: numbers, bounds, enums, bitfields, strings, composites).
    const allValueFields = fieldsResult.fields.filter((f) => f.kind !== 'dependency');
    const clutterCount = allValueFields.filter((f) => isClutterFieldInSimpleMode(f)).length;
    const valueFields = simpleMode
      ? allValueFields.filter((f) => !isClutterFieldInSimpleMode(f))
      : allValueFields;
    const q = search.trim().toLowerCase();
    if (!q) return { filteredFields: valueFields, hiddenClutterCount: clutterCount };
    return {
      filteredFields: valueFields.filter((f) => {
        if (f.name.toLowerCase().includes(q) || f.type.toLowerCase().includes(q)) return true;
        // Keep reflexive blocks when any non-dependency descendant field matches.
        return f.kind === 'reflexive' && reflexiveDescendantMatches(f, q);
      }),
      hiddenClutterCount: clutterCount,
    };
  }, [fieldsResult, search, simpleMode]);

  if (!focusedTag) {
    return <div data-testid="tag-editor-empty" style={{ padding: 16, fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic' }}>Select a tag to edit its fields.</div>;
  }
  const groupExplanation = getTagGroupExplanation(focusedTag.primaryClassName);

  const handleCopyReflexiveElementJson = async (elementPath: string, elementFields: TagFieldDescriptor[]) => {
    const payload: Record<string, unknown> = {
      __openceReflexiveElement: true,
      sourceTag: focusedTag.path,
      sourcePath: elementPath,
      values: Object.fromEntries(
        elementFields
          .filter((cf) => cf.kind !== 'reflexive' && cf.kind !== 'dependency' && !cf.readOnly)
          .map((cf) => [cf.name, cf.value]),
      ),
      dependencies: Object.fromEntries(
        elementFields
          .filter((cf) => cf.kind === 'dependency')
          .map((cf) => [cf.name, cf.value]),
      ),
    };
    const jsonText = JSON.stringify(payload, null, 2);
    cachedReflexiveClipboardJson = jsonText;
    try {
      await navigator.clipboard.writeText(jsonText);
      setStatusMessage(`Copied "${elementPath}" (${Object.keys(payload.values as object).length} fields) to clipboard.`);
    } catch {
      setStatusMessage(`Copied "${elementPath}" (${Object.keys(payload.values as object).length} fields) to internal clipboard.`);
    }
  };

  const readReflexiveClipboardPayload = async (): Promise<{
    values: Record<string, unknown>;
    dependencies?: Record<string, unknown>;
  } | null> => {
    let text = cachedReflexiveClipboardJson ?? '';
    try {
      const sysText = await navigator.clipboard.readText();
      if (sysText && sysText.trim().startsWith('{')) {
        text = sysText;
      }
    } catch {
      /* fallback to cachedReflexiveClipboardJson */
    }
    if (!text) return null;
    const parsed = JSON.parse(text) as {
      values?: Record<string, unknown>;
      dependencies?: Record<string, unknown>;
    };
    const values =
      parsed?.values ??
      (typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null);
    if (!values) return null;
    return { values, dependencies: parsed?.dependencies };
  };

  const handlePasteReflexiveElementJson = async (elementPath: string, elementFields: TagFieldDescriptor[]) => {
    try {
      const payload = await readReflexiveClipboardPayload();
      if (!payload) {
        setStatusMessage('Failed to paste: Copy a reflexive element first using "Copy JSON".');
        return;
      }
      const { values, dependencies } = payload;
      let updatedCount = 0;
      for (const cf of elementFields) {
        if (cf.kind === 'reflexive' || cf.readOnly) continue;
        if (cf.kind === 'dependency') {
          if (dependencies && Object.prototype.hasOwnProperty.call(dependencies, cf.name)) {
            const depVal = dependencies[cf.name];
            const tagId = typeof depVal === 'number' && depVal !== NULL_TAG_ID ? depVal : null;
            await window.opence.setDependencySlot(focusedTag.index, `${elementPath}.${cf.name}`, tagId);
            updatedCount++;
          }
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(values, cf.name)) {
          await handleUpdateField(`${elementPath}.${cf.name}`, values[cf.name]);
          updatedCount++;
        }
      }
      setStatusMessage(`Pasted ${updatedCount} field(s) into "${elementPath}" (in memory, Ctrl+S to save).`);
    } catch (err) {
      setStatusMessage(`Failed to paste JSON into "${elementPath}": ${(err as Error).message}`);
    }
  };

  const handleAppendAndPasteReflexiveElementJson = async (reflexiveFieldPath: string) => {
    if (!focusedTag || !window.opence.addReflexiveChunk) return;
    try {
      const payload = await readReflexiveClipboardPayload();
      if (!payload) {
        setStatusMessage('Failed to append & paste: Copy a reflexive element first using "Copy JSON".');
        return;
      }
      setAddingChunkPath(reflexiveFieldPath);
      const addRes = await window.opence.addReflexiveChunk(focusedTag.index, reflexiveFieldPath, -1);
      if (!addRes.ok) {
        setStatusMessage(`Failed to append chunk to "${reflexiveFieldPath}": ${addRes.message}`);
        return;
      }
      const newElementPath = `${reflexiveFieldPath}[${addRes.newElementIndex}]`;
      const { values, dependencies } = payload;
      let updatedCount = 0;
      for (const [k, v] of Object.entries(values)) {
        await window.opence.updateTagField(focusedTag.index, `${newElementPath}.${k}`, v);
        updatedCount++;
      }
      if (dependencies) {
        for (const [k, depVal] of Object.entries(dependencies)) {
          const tagId = typeof depVal === 'number' && depVal !== NULL_TAG_ID ? depVal : null;
          await window.opence.setDependencySlot(focusedTag.index, `${newElementPath}.${k}`, tagId);
          updatedCount++;
        }
      }
      setExpandedReflexives((prev) => new Set(prev).add(reflexiveFieldPath));
      const refresh = await window.opence.getTagFields(focusedTag.index);
      if (refresh.ok) {
        setFieldsResult(refresh.data);
      }
      setStatusMessage(`Appended "${newElementPath}" and pasted ${updatedCount} field(s) from clipboard! (Ctrl+S to save)`);
    } catch (err) {
      setStatusMessage(`Failed to append & paste into "${reflexiveFieldPath}": ${(err as Error).message}`);
    } finally {
      setAddingChunkPath(null);
    }
  };

  // Item 2 (Milestone 19.2): Reflexive Block File (.json) Export & Import
  const handleExportReflexiveBlockFile = (reflexiveFieldPath: string, reflexiveField: TagFieldDescriptor) => {
    const elements = (reflexiveField.children ?? []).map((el, idx) => ({
      index: idx,
      structName: el.structName,
      values: Object.fromEntries(
        el.fields
          .filter((cf) => cf.kind !== 'reflexive' && cf.kind !== 'dependency' && !cf.readOnly)
          .map((cf) => [cf.name, cf.value]),
      ),
      dependencies: Object.fromEntries(
        el.fields
          .filter((cf) => cf.kind === 'dependency')
          .map((cf) => [cf.name, cf.value]),
      ),
    }));
    const payload = {
      __openceReflexiveBlock: true,
      version: 1,
      sourceTag: focusedTag.path,
      sourceClass: focusedTag.primaryClassName,
      reflexivePath: reflexiveFieldPath,
      structName: reflexiveField.reflexiveStruct ?? 'Block',
      elementCount: elements.length,
      elements,
    };
    const jsonText = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = `${focusedTag.path.split('\\').pop() || 'tag'}_${reflexiveFieldPath.replace(/[^a-z0-9_-]/gi, '_')}.block.json`;
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatusMessage(`Exported reflexive block "${reflexiveFieldPath}" (${elements.length} element(s)) to ${safeName}.`);
  };

  const handleImportReflexiveBlockFile = (reflexiveFieldPath: string, reflexiveField: TagFieldDescriptor) => {
    if (!focusedTag) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        setAddingChunkPath(reflexiveFieldPath);
        const text = await file.text();
        const parsed = JSON.parse(text) as {
          elements?: Array<{ values?: Record<string, unknown>; dependencies?: Record<string, unknown> }>;
          values?: Record<string, unknown>;
          dependencies?: Record<string, unknown>;
        };
        const incomingElements = Array.isArray(parsed.elements)
          ? parsed.elements
          : parsed.values
            ? [{ values: parsed.values, dependencies: parsed.dependencies }]
            : [];
        if (incomingElements.length === 0) {
          setStatusMessage(`Failed to import "${file.name}": No reflexive elements or values found in JSON.`);
          return;
        }
        let existingCount = reflexiveField.children ? reflexiveField.children.length : (reflexiveField.reflexiveCount ?? 0);
        let updatedTotal = 0;
        for (let i = 0; i < incomingElements.length; i++) {
          const item = incomingElements[i];
          let targetIdx = i;
          if (i >= existingCount && window.opence.addReflexiveChunk) {
            const addRes = await window.opence.addReflexiveChunk(focusedTag.index, reflexiveFieldPath, -1);
            if (!addRes.ok) break;
            targetIdx = addRes.newElementIndex;
            existingCount = targetIdx + 1;
          }
          const elementPath = `${reflexiveFieldPath}[${targetIdx}]`;
          if (item.values) {
            for (const [k, v] of Object.entries(item.values)) {
              await window.opence.updateTagField(focusedTag.index, `${elementPath}.${k}`, v);
              updatedTotal++;
            }
          }
          if (item.dependencies) {
            for (const [k, depVal] of Object.entries(item.dependencies)) {
              const tagId = typeof depVal === 'number' && depVal !== NULL_TAG_ID ? depVal : null;
              await window.opence.setDependencySlot(focusedTag.index, `${elementPath}.${k}`, tagId);
              updatedTotal++;
            }
          }
        }
        setExpandedReflexives((prev) => new Set(prev).add(reflexiveFieldPath));
        const refresh = await window.opence.getTagFields(focusedTag.index);
        if (refresh.ok) {
          setFieldsResult(refresh.data);
        }
        setStatusMessage(
          `Imported ${incomingElements.length} element(s) (${updatedTotal} field updates) from "${file.name}" into "${reflexiveFieldPath}"!`,
        );
      } catch (err) {
        setStatusMessage(`Failed to import block JSON: ${(err as Error).message}`);
      } finally {
        setAddingChunkPath(null);
      }
    };
    input.click();
  };

  const handleOpenBlockOrganizer = (reflexiveFieldPath: string, reflexiveField: TagFieldDescriptor) => {
    const items = (reflexiveField.children ?? []).map((el, idx) => {
      const nameField = el.fields.find((cf) => cf.kind === 'string' && cf.name.toLowerCase().includes('name'));
      const depField = el.fields.find((cf) => cf.kind === 'dependency' && cf.dependencyTarget);
      let label = `${el.structName} #${idx}`;
      if (nameField && typeof nameField.value === 'string' && nameField.value.trim()) {
        label = nameField.value.trim();
      } else if (depField?.dependencyTarget?.path) {
        label = `${depField.dependencyTarget.path.split('\\').pop()} (${depField.dependencyTarget.group})`;
      }
      return { sourceIndex: idx, label, renameTo: typeof nameField?.value === 'string' ? nameField.value : undefined };
    });
    setOrganizerState({
      reflexivePath: reflexiveFieldPath,
      structName: reflexiveField.reflexiveStruct ?? 'Block',
      items,
    });
  };

  const handleCommitBlockOrganizer = async () => {
    if (!focusedTag || !organizerState || typeof window.opence.reorganizeReflexiveBlock !== 'function') return;
    setAddingChunkPath(organizerState.reflexivePath);
    try {
      const res = await window.opence.reorganizeReflexiveBlock({
        tagIndex: focusedTag.index,
        reflexivePath: organizerState.reflexivePath,
        desiredOrder: organizerState.items.map((it) => ({
          sourceIndex: it.sourceIndex,
          renameTo: it.renameTo,
        })),
      });
      if (res.ok) {
        setFieldsResult(res.fields);
        setStatusMessage(
          `Committed staged Block Organizer changes to "${organizerState.reflexivePath}" (${res.newCount} elements).`,
        );
        setOrganizerState(null);
      } else {
        setStatusMessage(`Block Organizer failed: ${res.message}`);
      }
    } catch (err) {
      setStatusMessage(`Block Organizer failed: ${(err as Error).message}`);
    } finally {
      setAddingChunkPath(null);
    }
  };

  const handleCopyBlockTsv = async (reflexiveFieldPath: string) => {
    if (!focusedTag || typeof window.opence.exportReflexiveTsv !== 'function') return;
    const res = await window.opence.exportReflexiveTsv(focusedTag.index, reflexiveFieldPath);
    if (!res.ok) {
      setStatusMessage(`Failed to export TSV: ${res.message}`);
      return;
    }
    try {
      await navigator.clipboard.writeText(res.tsvText);
      setStatusMessage(
        `Copied "${reflexiveFieldPath}" (${res.rowCount} rows × ${res.columnHeaders.length} columns) as TSV to clipboard (paste into Excel / Google Sheets).`,
      );
    } catch {
      setStatusMessage(`Exported TSV (${res.rowCount} rows).`);
    }
  };

  const handlePasteBlockTsv = async (reflexiveFieldPath: string) => {
    if (!focusedTag || typeof window.opence.importReflexiveTsv !== 'function') return;
    try {
      const tsvText = await navigator.clipboard.readText();
      if (!tsvText || !tsvText.trim()) {
        setStatusMessage('Clipboard is empty. Copy TSV cells from Excel/Sheets or another reflexive block first.');
        return;
      }
      setAddingChunkPath(reflexiveFieldPath);
      const res = await window.opence.importReflexiveTsv(focusedTag.index, reflexiveFieldPath, tsvText);
      if (res.ok) {
        setFieldsResult(res.fields);
        setStatusMessage(
          `Applied TSV spreadsheet paste to "${reflexiveFieldPath}" (${res.updatedCells} cell(s) updated across ${res.rowCount} row(s)).`,
        );
      } else {
        setStatusMessage(`Failed to paste TSV: ${res.message}`);
      }
    } catch (err) {
      setStatusMessage(`Failed to read clipboard TSV: ${(err as Error).message}`);
    } finally {
      setAddingChunkPath(null);
    }
  };

  return (
          <div data-testid="properties-palette-fields" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {hudSafetyReport?.warningBanner && (
              <div
                data-testid="hud-message-safety-banner"
                style={{
                  padding: '8px 10px',
                  background: 'rgba(245, 158, 11, 0.14)',
                  borderBottom: '1px solid rgba(245, 158, 11, 0.45)',
                  fontSize: 11.5,
                  color: '#fbbf24',
                  lineHeight: 1.4,
                }}
              >
                ⚠️ <strong>Global HUD Message Fixed-Index Safety:</strong> {hudSafetyReport.warningBanner}
              </div>
            )}
            {/* Tag Group Description Banner */}
            {groupExplanation && (
              <div
                data-testid="tag-group-explanation-banner"
                style={{
                  padding: '6px 10px',
                  background: 'rgba(56, 189, 248, 0.08)',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.35,
                }}
              >
                <span style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>{focusedTag.primaryClassName}: </span>
                {groupExplanation}
              </div>
            )}
            {/* Search filter & Simple Mode toggle */}
            <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                data-testid="fields-search-input"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search fields by name (e.g. speed, damage, magazines)..."
                style={{
                  flex: 1,
                  minWidth: 160,
                  boxSizing: 'border-box',
                  background: 'var(--bg-input, #1e1e1e)',
                  border: '1px solid var(--border)',
                  borderRadius: 3,
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  padding: '4px 8px',
                }}
              />
              <button
                type="button"
                data-testid="toggle-simple-mode-btn"
                onClick={() => setSimpleMode((prev) => !prev)}
                title={
                  simpleMode
                    ? `Simple Mode is ON (hiding ${hiddenClutterCount} read-only/internal fields and advanced JSON buttons). Click to show all raw fields.`
                    : 'Advanced Mode is ON (showing all raw/read-only fields and JSON tools). Click to switch back to Simple Mode.'
                }
                style={{
                  background: simpleMode ? 'rgba(34, 197, 94, 0.16)' : 'rgba(148, 163, 184, 0.14)',
                  border: simpleMode ? '1px solid rgba(34, 197, 94, 0.45)' : '1px solid var(--border)',
                  borderRadius: 3,
                  color: simpleMode ? '#4ade80' : 'var(--text-secondary)',
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '4px 8px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {simpleMode
                  ? `✨ Simple View${hiddenClutterCount > 0 ? ` (${hiddenClutterCount} raw hidden)` : ''}`
                  : '🔧 Advanced View (All Raw Fields)'}
              </button>
              {expandedReflexives.size > 0 && (
                <button
                  type="button"
                  onClick={() => setExpandedReflexives(new Set())}
                  title="Collapse all open blocks"
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid var(--border)',
                    borderRadius: 3,
                    color: 'var(--text-dim)',
                    fontSize: 11,
                    padding: '4px 7px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Collapse All ▲
                </button>
              )}
            </div>

            {/* Status message */}
            {statusMessage && (
              <div
                data-testid="field-editor-status"
                style={{
                  padding: '6px 10px',
                  fontSize: 11,
                  background: statusMessage.startsWith('Failed') ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                  color: statusMessage.startsWith('Failed') ? '#ef4444' : '#22c55e',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                {statusMessage}
              </div>
            )}

            {/* Content area */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px' }}>
              {isLoadingFields ? (
                <div style={{ padding: 16, fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic', textAlign: 'center' }}>
                  Loading tag fields...
                </div>
              ) : fieldsError ? (
                <div style={{ padding: 12, fontSize: 12, color: 'var(--warn-text)', fontStyle: 'italic' }}>
                  {fieldsError}
                </div>
              ) : filteredFields.length === 0 ? (
                <div style={{ padding: 16, fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic', textAlign: 'center' }}>
                  {search ? 'No matching fields found.' : 'No fields available for this tag.'}
                </div>
              ) : (
                filteredFields.map((field) => (
                  <FieldCard
                    key={field.name}
                    field={field}
                    fieldPath={field.name}
                    tagClassName={focusedTag.primaryClassName}
                    rootFields={fieldsResult?.fields ?? []}
                    allTags={allTags}
                    savingField={savingField}
                    onSave={handleUpdateField}
                    onAddChunk={handleAddChunk}
                    onCreateObjectName={handleCreateAndAssignObjectName}
                    onCopyElementJson={handleCopyReflexiveElementJson}
                    onPasteElementJson={handlePasteReflexiveElementJson}
                    onAppendAndPasteJson={handleAppendAndPasteReflexiveElementJson}
                    onExportBlockFile={handleExportReflexiveBlockFile}
                    onImportBlockFile={handleImportReflexiveBlockFile}
                    onOpenBlockOrganizer={handleOpenBlockOrganizer}
                    onCopyBlockTsv={handleCopyBlockTsv}
                    onPasteBlockTsv={handlePasteBlockTsv}
                    addingChunkPath={addingChunkPath}
                    expandedBitfields={expandedBitfields}
                    onToggleBitfield={toggleBitfieldExpand}
                    expandedReflexives={expandedReflexives}
                    onToggleReflexive={toggleReflexiveExpand}
                    search={search}
                    simpleMode={simpleMode}
                  />
                ))
              )}
            </div>
            {organizerState && (
              <div
                data-testid="block-organizer-modal"
                style={{
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(0,0,0,0.68)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 260,
                }}
              >
                <div
                  style={{
                    width: 580,
                    maxHeight: '80vh',
                    background: 'var(--bg-panel)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
                  }}
                >
                  <div
                    style={{
                      padding: '10px 14px',
                      background: 'var(--bg-panel-header)',
                      borderBottom: '1px solid var(--border)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      🗂️ Staged Block Organizer — {organizerState.reflexivePath} ({organizerState.items.length} elements)
                    </span>
                    <button
                      type="button"
                      onClick={() => setOrganizerState(null)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 16, cursor: 'pointer' }}
                    >
                      ×
                    </button>
                  </div>
                  <div style={{ padding: '8px 14px', fontSize: 11.5, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>
                    Reorder, duplicate, insert, rename, or delete elements in a staged buffer. Nothing is mutated until you click <strong>Commit Order</strong>.
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {organizerState.items.map((item, idx) => (
                      <div
                        key={`${idx}-${item.sourceIndex}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '5px 8px',
                          background: 'var(--bg-panel-header)',
                          border: '1px solid var(--border)',
                          borderRadius: 3,
                          fontSize: 11.5,
                        }}
                      >
                        <span style={{ fontFamily: 'var(--mono-font)', color: 'var(--accent-cyan)', minWidth: 32 }}>
                          [{idx}]
                        </span>
                        <span style={{ fontSize: 10.5, color: 'var(--text-dim)', minWidth: 58 }}>
                          {item.sourceIndex >= 0 ? `(src #${item.sourceIndex})` : '(new)'}
                        </span>
                        <input
                          type="text"
                          value={item.renameTo ?? item.label}
                          onChange={(e) => {
                            const val = e.target.value;
                            setOrganizerState((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    items: prev.items.map((it, i) => (i === idx ? { ...it, label: val, renameTo: val } : it)),
                                  }
                                : null,
                            );
                          }}
                          style={{
                            flex: 1,
                            background: 'var(--bg-input, #1e1e1e)',
                            border: '1px solid var(--border)',
                            borderRadius: 2,
                            color: 'var(--text-primary)',
                            fontSize: 11,
                            padding: '3px 6px',
                            fontFamily: 'var(--mono-font)',
                          }}
                        />
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() =>
                            setOrganizerState((prev) => {
                              if (!prev || idx === 0) return prev;
                              const next = [...prev.items];
                              [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                              return { ...prev, items: next };
                            })
                          }
                          style={{ padding: '2px 6px', fontSize: 10.5, cursor: idx === 0 ? 'not-allowed' : 'pointer' }}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={idx === organizerState.items.length - 1}
                          onClick={() =>
                            setOrganizerState((prev) => {
                              if (!prev || idx >= prev.items.length - 1) return prev;
                              const next = [...prev.items];
                              [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                              return { ...prev, items: next };
                            })
                          }
                          style={{ padding: '2px 6px', fontSize: 10.5, cursor: idx === organizerState.items.length - 1 ? 'not-allowed' : 'pointer' }}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setOrganizerState((prev) => {
                              if (!prev) return prev;
                              const next = [...prev.items];
                              next.splice(idx + 1, 0, { ...item, label: `${item.label}_copy` });
                              return { ...prev, items: next };
                            })
                          }
                          style={{ padding: '2px 6px', fontSize: 10.5, cursor: 'pointer' }}
                        >
                          Clone
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setOrganizerState((prev) => {
                              if (!prev) return prev;
                              return { ...prev, items: prev.items.filter((_, i) => i !== idx) };
                            })
                          }
                          style={{ padding: '2px 6px', fontSize: 10.5, color: '#f87171', cursor: 'pointer' }}
                        >
                          Del
                        </button>
                      </div>
                    ))}
                  </div>
                  <div
                    style={{
                      padding: '10px 14px',
                      background: 'var(--bg-panel-header)',
                      borderTop: '1px solid var(--border)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setOrganizerState((prev) =>
                          prev
                            ? {
                                ...prev,
                                items: [
                                  ...prev.items,
                                  { sourceIndex: -1, label: `${prev.structName} #${prev.items.length}` },
                                ],
                              }
                            : null,
                        )
                      }
                      style={{
                        padding: '5px 10px',
                        fontSize: 11.5,
                        background: 'rgba(34, 197, 94, 0.16)',
                        border: '1px solid rgba(34, 197, 94, 0.45)',
                        color: '#4ade80',
                        borderRadius: 3,
                        cursor: 'pointer',
                      }}
                    >
                      + Insert Blank Element
                    </button>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => setOrganizerState(null)}
                        style={{
                          padding: '5px 12px',
                          fontSize: 11.5,
                          background: 'var(--bg-main)',
                          border: '1px solid var(--border)',
                          color: 'var(--text-primary)',
                          borderRadius: 3,
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        data-testid="block-organizer-commit-btn"
                        onClick={() => void handleCommitBlockOrganizer()}
                        style={{
                          padding: '5px 14px',
                          fontSize: 11.5,
                          fontWeight: 600,
                          background: 'var(--accent-cyan)',
                          border: 'none',
                          color: '#06202c',
                          borderRadius: 3,
                          cursor: 'pointer',
                        }}
                      >
                        Commit Order ({organizerState.items.length})
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
  );
}

interface FieldCardProps {
  field: TagFieldDescriptor;
  /**
   * Path from the tag root struct to this field: the field's own name for root fields, or a
   * dotted reflexive path (e.g. "magazines[0].rounds recharged") for nested ones. Used for all
   * data-testid attributes and for the save path passed to `window.opence.updateTagField`.
   */
  fieldPath: string;
  tagClassName?: string;
  rootFields: TagFieldDescriptor[];
  allTags: TagEntrySummary[];
  /** Currently saving field path (or null); a card is "saving" when it matches its own path. */
  savingField: string | null;
  /** Save a value at the given (possibly nested) field path; passed through to root as-is. */
  onSave: (fieldPath: string, val: unknown) => void;
  onAddChunk?: (fieldPath: string, cloneFromIndex?: number) => void;
  onCreateObjectName?: (targetFieldPath: string, newObjName: string) => void;
  onCopyElementJson?: (elementPath: string, elementFields: TagFieldDescriptor[]) => void;
  onPasteElementJson?: (elementPath: string, elementFields: TagFieldDescriptor[]) => void;
  onAppendAndPasteJson?: (reflexiveFieldPath: string) => void;
  onExportBlockFile?: (reflexiveFieldPath: string, reflexiveField: TagFieldDescriptor) => void;
  onImportBlockFile?: (reflexiveFieldPath: string, reflexiveField: TagFieldDescriptor) => void;
  onOpenBlockOrganizer?: (reflexiveFieldPath: string, reflexiveField: TagFieldDescriptor) => void;
  onCopyBlockTsv?: (reflexiveFieldPath: string) => void;
  onPasteBlockTsv?: (reflexiveFieldPath: string) => void;
  addingChunkPath?: string | null;
  expandedBitfields: Set<string>;
  onToggleBitfield: (fieldPath: string) => void;
  expandedReflexives: Set<string>;
  onToggleReflexive: (fieldPath: string) => void;
  /** Non-empty trimmed search query; reflexive blocks auto-expand when a descendant field matches. */
  search?: string;
  /** When true, hides read-only/internal fields, hex offsets, and advanced JSON buttons. */
  simpleMode?: boolean;
}

function FieldCard({
  field,
  fieldPath,
  tagClassName,
  rootFields,
  allTags,
  savingField,
  onSave,
  onAddChunk,
  onCreateObjectName,
  onCopyElementJson,
  onPasteElementJson,
  onAppendAndPasteJson,
  onExportBlockFile,
  onImportBlockFile,
  onOpenBlockOrganizer,
  onCopyBlockTsv,
  onPasteBlockTsv,
  addingChunkPath,
  expandedBitfields,
  onToggleBitfield,
  expandedReflexives,
  onToggleReflexive,
  search,
  simpleMode = true,
}: FieldCardProps) {
  const isSaving = savingField === fieldPath;
  const isExpanded = expandedBitfields.has(fieldPath);
  const isReflexiveExpanded = expandedReflexives.has(fieldPath);
  const isAddingChunk = addingChunkPath === fieldPath;
  const searchQ = search?.trim().toLowerCase() ?? '';
  const [localVal, setLocalVal] = useState<unknown>(field.value);
  const [newObjNameDraft, setNewObjNameDraft] = useState<string>('');
  const fieldUnitInfo = useMemo(() => getFieldUnit(field.name, field.type), [field.name, field.type]);
  const fieldExplanation = useMemo(
    () => getFieldExplanation(field.name, tagClassName, field.type, field.kind),
    [field.name, tagClassName, field.type, field.kind],
  );
  const crossRefInfo = useMemo(() => resolveCrossReflexiveOptions(field, rootFields, fieldPath), [field, rootFields, fieldPath]);
  const canAddChunk = Boolean(
    onAddChunk && field.reflexiveStruct && (!field.readOnlyReason || field.readOnlyReason.includes('in-place write')),
  );

  useEffect(() => {
    setLocalVal(field.value);
  }, [field.value]);

  const inputStyle: CSSProperties = {
    background: 'var(--bg-input, #1e1e1e)',
    border: '1px solid var(--border)',
    borderRadius: 2,
    color: 'var(--text-primary)',
    fontSize: 11,
    padding: '3px 6px',
    fontFamily: 'var(--mono-font)',
    width: '100%',
    boxSizing: 'border-box',
  };

  return (
    <div
      data-testid={`field-card-${fieldPath}`}
      style={{
        marginBottom: 8,
        padding: '6px 8px',
        background: 'var(--bg-panel-header)',
        border: '1px solid var(--border)',
        borderRadius: 3,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary)' }}>{field.name}</span>
        <span
          title={fieldUnitInfo.tooltip ?? field.type}
          style={{
            fontSize: 9.5,
            padding: '1px 5px',
            borderRadius: 2,
            background: 'rgba(255, 255, 255, 0.08)',
            color: fieldUnitInfo.unit ? 'var(--accent-cyan)' : 'var(--text-dim)',
            fontFamily: 'var(--mono-font)',
            cursor: fieldUnitInfo.tooltip ? 'help' : 'default',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span>{field.type}</span>
          {fieldUnitInfo.unit && (
            <span
              style={{
                color: '#fbbf24',
                fontWeight: 600,
                borderLeft: '1px solid rgba(255, 255, 255, 0.15)',
                paddingLeft: 4,
              }}
            >
              {fieldUnitInfo.unit}
            </span>
          )}
        </span>
      </div>
      {fieldExplanation && (
        <div
          data-testid={`field-desc-${fieldPath}`}
          style={{
            fontSize: 10.5,
            color: 'var(--text-dim)',
            marginBottom: 5,
            lineHeight: 1.35,
          }}
        >
          {fieldExplanation}
        </div>
      )}

      {field.kind === 'reflexive' ? (
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '3px 6px',
              fontSize: 11,
              fontFamily: 'var(--mono-font)',
              background: 'rgba(0, 0, 0, 0.25)',
              borderRadius: 2,
              gap: 8,
            }}
          >
            <div
              data-testid={`reflexive-toggle-${fieldPath}`}
              onClick={() => onToggleReflexive(fieldPath)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                flex: 1,
                overflow: 'hidden',
              }}
            >
              <span style={{ color: 'var(--text-secondary)' }}>
                {field.children ? field.children.length : (field.reflexiveCount ?? 0)} element(s) — {field.reflexiveStruct ?? 'Block'}
              </span>
              <span style={{ fontSize: 10, color: 'var(--accent-cyan)' }}>
                {isReflexiveExpanded ? 'Hide Block ▲' : 'Edit Block ▼'}
              </span>
            </div>
            {canAddChunk && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {onOpenBlockOrganizer && (
                  <button
                    type="button"
                    data-testid={`reflexive-organize-${fieldPath}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenBlockOrganizer(fieldPath, field);
                    }}
                    title="Open Staged Block Organizer (reorder, duplicate, insert, rename, or delete elements)"
                    style={{
                      background: 'rgba(56, 189, 248, 0.15)',
                      border: '1px solid rgba(56, 189, 248, 0.45)',
                      borderRadius: 2,
                      color: '#38bdf8',
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: '2px 6px',
                    }}
                  >
                    🗂️ Organize
                  </button>
                )}
                {onCopyBlockTsv && (
                  <button
                    type="button"
                    data-testid={`reflexive-copy-tsv-${fieldPath}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onCopyBlockTsv(fieldPath);
                    }}
                    title="Copy entire reflexive block as TSV (paste directly into Excel or Google Sheets)"
                    style={{
                      background: 'rgba(16, 185, 129, 0.15)',
                      border: '1px solid rgba(16, 185, 129, 0.45)',
                      borderRadius: 2,
                      color: '#34d399',
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: '2px 6px',
                    }}
                  >
                    📊 Copy TSV
                  </button>
                )}
                {onPasteBlockTsv && (
                  <button
                    type="button"
                    data-testid={`reflexive-paste-tsv-${fieldPath}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPasteBlockTsv(fieldPath);
                    }}
                    title="Paste TSV cells from Excel / Google Sheets into this reflexive block"
                    style={{
                      background: 'rgba(245, 158, 11, 0.15)',
                      border: '1px solid rgba(245, 158, 11, 0.45)',
                      borderRadius: 2,
                      color: '#fbbf24',
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: '2px 6px',
                    }}
                  >
                    📥 Paste TSV
                  </button>
                )}
                {!simpleMode && onExportBlockFile && (
                  <button
                    type="button"
                    data-testid={`reflexive-export-file-${fieldPath}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onExportBlockFile(fieldPath, field);
                    }}
                    title="Export all elements of this reflexive block to a portable .block.json file on disk"
                    style={{
                      background: 'rgba(56, 189, 248, 0.14)',
                      border: '1px solid rgba(56, 189, 248, 0.4)',
                      borderRadius: 2,
                      color: '#38bdf8',
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: '2px 6px',
                    }}
                  >
                    💾 Export .JSON
                  </button>
                )}
                {!simpleMode && onImportBlockFile && (
                  <button
                    type="button"
                    data-testid={`reflexive-import-file-${fieldPath}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onImportBlockFile(fieldPath, field);
                    }}
                    disabled={isAddingChunk}
                    title="Import elements into this reflexive block from a .block.json file on disk"
                    style={{
                      background: 'rgba(168, 85, 247, 0.15)',
                      border: '1px solid rgba(168, 85, 247, 0.45)',
                      borderRadius: 2,
                      color: '#c084fc',
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: isAddingChunk ? 'wait' : 'pointer',
                      padding: '2px 6px',
                    }}
                  >
                    📂 Import .JSON
                  </button>
                )}
                {!simpleMode && onAppendAndPasteJson && (
                  <button
                    type="button"
                    data-testid={`reflexive-append-paste-${fieldPath}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAppendAndPasteJson(fieldPath);
                    }}
                    disabled={isAddingChunk}
                    title="Append a new element to this reflexive block and paste the copied element JSON into it"
                    style={{
                      background: 'rgba(251, 191, 36, 0.16)',
                      border: '1px solid rgba(251, 191, 36, 0.45)',
                      borderRadius: 2,
                      color: '#fbbf24',
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: isAddingChunk ? 'wait' : 'pointer',
                      padding: '2px 6px',
                    }}
                  >
                    📋 Append &amp; Paste
                  </button>
                )}
                <button
                  type="button"
                  data-testid={`reflexive-add-${fieldPath}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddChunk?.(fieldPath, -1);
                  }}
                  disabled={isAddingChunk}
                  title="Append a new default element chunk to this reflexive array"
                  style={{
                    background: 'rgba(34, 197, 94, 0.15)',
                    border: '1px solid rgba(34, 197, 94, 0.4)',
                    borderRadius: 2,
                    color: '#4ade80',
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: isAddingChunk ? 'wait' : 'pointer',
                    padding: '2px 6px',
                  }}
                >
                  {isAddingChunk ? 'Adding...' : '+ Add Element'}
                </button>
              </div>
            )}
          </div>

          {field.children && field.children.length > 0 ? (
            <>
              {(isReflexiveExpanded || (searchQ !== '' && reflexiveDescendantMatches(field, searchQ))) && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {field.children.map((el, idx) => {
                    const editableChildFields = el.fields.filter(
                      (cf) => cf.kind !== 'dependency' && (!simpleMode || !isClutterFieldInSimpleMode(cf)),
                    );
                    return (
                      <div
                        key={idx}
                        data-testid={`reflexive-element-${fieldPath}[${idx}]`}
                        style={{
                          border: '1px solid var(--border)',
                          borderRadius: 2,
                          padding: '4px 6px',
                          background: 'rgba(0, 0, 0, 0.15)',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: 4,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 10.5,
                              fontWeight: 600,
                              color: 'var(--accent-cyan)',
                              fontFamily: 'var(--mono-font)',
                            }}
                          >
                            <span>{`${field.name} #${idx + 1}`}</span>
                            <span style={{ marginLeft: 6, opacity: 0.85 }}>{`${fieldPath}[${idx}]`}</span>
                            {!simpleMode && (
                              <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--text-dim)' }}>
                                {el.structName} @ 0x{el.structBase.toString(16).toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {!simpleMode && onCopyElementJson && (
                              <button
                                type="button"
                                data-testid={`reflexive-copy-json-${fieldPath}[${idx}]`}
                                onClick={() => onCopyElementJson(`${fieldPath}[${idx}]`, el.fields)}
                                title={`Copy element #${idx} field values to clipboard as JSON`}
                                style={{
                                  background: 'rgba(168, 85, 247, 0.15)',
                                  border: '1px solid rgba(168, 85, 247, 0.4)',
                                  borderRadius: 2,
                                  color: '#c084fc',
                                  fontSize: 10,
                                  fontWeight: 500,
                                  cursor: 'pointer',
                                  padding: '1px 6px',
                                }}
                              >
                                Copy JSON
                              </button>
                            )}
                            {!simpleMode && onPasteElementJson && (
                              <button
                                type="button"
                                data-testid={`reflexive-paste-json-${fieldPath}[${idx}]`}
                                onClick={() => onPasteElementJson(`${fieldPath}[${idx}]`, el.fields)}
                                title={`Paste clipboard JSON field values into element #${idx}`}
                                style={{
                                  background: 'rgba(251, 191, 36, 0.15)',
                                  border: '1px solid rgba(251, 191, 36, 0.4)',
                                  borderRadius: 2,
                                  color: '#fbbf24',
                                  fontSize: 10,
                                  fontWeight: 500,
                                  cursor: 'pointer',
                                  padding: '1px 6px',
                                }}
                              >
                                Paste JSON
                              </button>
                            )}
                            {canAddChunk && (
                              <button
                                type="button"
                                data-testid={`reflexive-clone-${fieldPath}[${idx}]`}
                                onClick={() => onAddChunk?.(fieldPath, idx)}
                                disabled={isAddingChunk}
                                title={`Duplicate element #${idx} and append to this block`}
                                style={{
                                  background: 'rgba(56, 189, 248, 0.15)',
                                  border: '1px solid rgba(56, 189, 248, 0.4)',
                                  borderRadius: 2,
                                  color: '#38bdf8',
                                  fontSize: 10,
                                  fontWeight: 500,
                                  cursor: isAddingChunk ? 'wait' : 'pointer',
                                  padding: '1px 6px',
                                }}
                              >
                                Clone
                              </button>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {editableChildFields.map((cf) => {
                            const nestedPath = `${fieldPath}[${idx}].${cf.name}`;
                            return (
                              <FieldCard
                                key={nestedPath}
                                field={cf}
                                fieldPath={nestedPath}
                                tagClassName={tagClassName}
                                rootFields={rootFields}
                                allTags={allTags}
                                savingField={savingField}
                                onSave={onSave}
                                onAddChunk={onAddChunk}
                                onCreateObjectName={onCreateObjectName}
                                onCopyElementJson={onCopyElementJson}
                                onPasteElementJson={onPasteElementJson}
                                onAppendAndPasteJson={onAppendAndPasteJson}
                                onExportBlockFile={onExportBlockFile}
                                onImportBlockFile={onImportBlockFile}
                                addingChunkPath={addingChunkPath}
                                expandedBitfields={expandedBitfields}
                                onToggleBitfield={onToggleBitfield}
                                expandedReflexives={expandedReflexives}
                                onToggleReflexive={onToggleReflexive}
                                search={search}
                                simpleMode={simpleMode}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic', marginTop: 4 }}>
              {(field.reflexiveCount ?? 0) > 0
                ? (field.readOnlyReason ?? 'Block is read-only (could not be decoded)')
                : 'Empty block (0 elements). Click "+ Add Element" to add the first chunk.'}
            </div>
          )}
        </div>
      ) : field.readOnly ? (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
          {field.readOnlyReason ?? 'Read-only'}
        </div>
      ) : field.kind === 'number' ? (
        <div>
          {crossRefInfo ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <select
                data-testid={`field-crossref-${fieldPath}`}
                value={
                  Number(localVal) === 65535 || Number(localVal) < 0 || Number.isNaN(Number(localVal))
                    ? -1
                    : Number(localVal)
                }
                disabled={isSaving}
                onChange={(e) => {
                  const nextVal = Number(e.target.value);
                  setLocalVal(nextVal);
                  onSave(fieldPath, nextVal);
                }}
                style={{ ...inputStyle, borderColor: 'rgba(56, 189, 248, 0.45)', cursor: 'pointer' }}
                title={`Select element from "${crossRefInfo.reflexiveName}" reflexive block`}
              >
                <option value={-1}>
                  {crossRefInfo.options.length === 0
                    ? `[-1] (None / Unnamed — "${crossRefInfo.reflexiveName}" has 0 entries)`
                    : '[-1] (None / Unnamed)'}
                </option>
                {crossRefInfo.options.map((opt) => (
                  <option key={opt.index} value={opt.index}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {crossRefInfo.reflexiveName.toLowerCase() === 'object names' && onCreateObjectName && (
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="Type new script object name (e.g. pelican_drop)..."
                    value={newObjNameDraft}
                    disabled={isSaving}
                    onChange={(e) => setNewObjNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newObjNameDraft.trim()) {
                        onCreateObjectName(fieldPath, newObjNameDraft.trim());
                        setNewObjNameDraft('');
                      }
                    }}
                    style={{ ...inputStyle, flex: 1, fontSize: 10.5 }}
                  />
                  <button
                    type="button"
                    disabled={isSaving || !newObjNameDraft.trim()}
                    onClick={() => {
                      if (newObjNameDraft.trim()) {
                        onCreateObjectName(fieldPath, newObjNameDraft.trim());
                        setNewObjNameDraft('');
                      }
                    }}
                    style={{
                      padding: '3px 8px',
                      fontSize: 10.5,
                      fontWeight: 600,
                      background: 'rgba(56, 189, 248, 0.16)',
                      border: '1px solid rgba(56, 189, 248, 0.45)',
                      color: '#38bdf8',
                      borderRadius: 2,
                      cursor: isSaving || !newObjNameDraft.trim() ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    + Create &amp; Assign
                  </button>
                </div>
              )}
            </div>
          ) : (
            <input
              data-testid={`field-input-${fieldPath}`}
              type="number"
              step="any"
              value={localVal !== undefined && localVal !== null ? String(localVal) : ''}
              disabled={isSaving}
              onChange={(e) => setLocalVal(e.target.value)}
              onBlur={() => {
                const num = Number(localVal);
                if (!Number.isNaN(num) && num !== field.value) {
                  onSave(fieldPath, num);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const num = Number(localVal);
                  if (!Number.isNaN(num) && num !== field.value) {
                    onSave(fieldPath, num);
                  }
                }
              }}
              style={inputStyle}
            />
          )}
        </div>
      ) : field.kind === 'bounds' ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 9.5, color: 'var(--text-dim)' }}>From</span>
            <input
              type="number"
              step="any"
              value={Array.isArray(localVal) ? localVal[0] : ''}
              disabled={isSaving}
              onChange={(e) => {
                const prev = Array.isArray(localVal) ? localVal : [0, 0];
                setLocalVal([e.target.value, prev[1]]);
              }}
              onBlur={() => {
                if (Array.isArray(localVal)) {
                  onSave(fieldPath, [Number(localVal[0]), Number(localVal[1])]);
                }
              }}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 9.5, color: 'var(--text-dim)' }}>To</span>
            <input
              type="number"
              step="any"
              value={Array.isArray(localVal) ? localVal[1] : ''}
              disabled={isSaving}
              onChange={(e) => {
                const prev = Array.isArray(localVal) ? localVal : [0, 0];
                setLocalVal([prev[0], e.target.value]);
              }}
              onBlur={() => {
                if (Array.isArray(localVal)) {
                  onSave(fieldPath, [Number(localVal[0]), Number(localVal[1])]);
                }
              }}
              style={inputStyle}
            />
          </div>
        </div>
      ) : field.kind === 'enum' && field.enumOptions ? (
        <select
          data-testid={`field-select-${fieldPath}`}
          value={Number(localVal)}
          disabled={isSaving}
          onChange={(e) => {
            const nextVal = Number(e.target.value);
            setLocalVal(nextVal);
            onSave(fieldPath, nextVal);
          }}
          style={inputStyle}
        >
          {field.enumOptions.map((opt, idx) => (
            <option key={opt} value={idx}>
              {opt} ({idx})
            </option>
          ))}
        </select>
      ) : field.kind === 'bitfield' && field.bitfieldFlags ? (
        <div>
          <div
            onClick={() => onToggleBitfield(fieldPath)}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'pointer',
              padding: '3px 4px',
              fontSize: 11,
              fontFamily: 'var(--mono-font)',
              background: 'rgba(0, 0, 0, 0.2)',
              borderRadius: 2,
            }}
          >
            <span>Value: 0x{Number(localVal || 0).toString(16).toUpperCase()}</span>
            <span style={{ fontSize: 10, color: 'var(--accent-cyan)' }}>
              {isExpanded ? 'Hide Flags ▲' : 'Edit Flags ▼'}
            </span>
          </div>

          {isExpanded && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
              {field.bitfieldFlags.map((flagName, bitIdx) => {
                if (!flagName) return null;
                const mask = 1 << bitIdx;
                const isChecked = (Number(localVal || 0) & mask) !== 0;
                return (
                  <label
                    key={flagName}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 11,
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={isSaving}
                      onChange={(e) => {
                        const currentNum = Number(localVal || 0);
                        const nextNum = e.target.checked ? (currentNum | mask) >>> 0 : (currentNum & ~mask) >>> 0;
                        setLocalVal(nextNum);
                        onSave(fieldPath, nextNum);
                      }}
                    />
                    <span>{flagName}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      ) : field.kind === 'string' ? (
        <input
          data-testid={`field-string-${fieldPath}`}
          type="text"
          maxLength={31}
          value={typeof localVal === 'string' ? localVal : ''}
          disabled={isSaving}
          onChange={(e) => setLocalVal(e.target.value)}
          onBlur={() => {
            if (localVal !== field.value) {
              onSave(fieldPath, String(localVal));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (localVal !== field.value) {
                onSave(fieldPath, String(localVal));
              }
            }
          }}
          style={inputStyle}
        />
      ) : field.kind === 'composite' && Array.isArray(localVal) ? (
        <div>
          {(() => {
            const arr = localVal as number[];
            const labels = getCompositeLabels(field.type, arr.length);
            const isColor = field.type.toLowerCase().includes('color') && arr.length >= 3;
            const rgbStartIdx = field.type.toLowerCase().includes('argb') && arr.length === 4 ? 1 : 0;
            const toHex = (c: number) =>
              Math.max(0, Math.min(255, Math.round((Number(c) || 0) * 255)))
                .toString(16)
                .padStart(2, '0');
            const hexColor = isColor
              ? `#${toHex(arr[rgbStartIdx])}${toHex(arr[rgbStartIdx + 1])}${toHex(arr[rgbStartIdx + 2])}`
              : '#ffffff';
            return (
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                {isColor && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 9.5, color: 'var(--text-dim)' }}>Swatch</span>
                    <input
                      type="color"
                      value={hexColor}
                      disabled={isSaving}
                      onChange={(e) => {
                        const hex = e.target.value.replace('#', '');
                        const r = parseInt(hex.slice(0, 2), 16) / 255;
                        const g = parseInt(hex.slice(2, 4), 16) / 255;
                        const b = parseInt(hex.slice(4, 6), 16) / 255;
                        const next = [...arr];
                        next[rgbStartIdx] = Number(r.toFixed(4));
                        next[rgbStartIdx + 1] = Number(g.toFixed(4));
                        next[rgbStartIdx + 2] = Number(b.toFixed(4));
                        setLocalVal(next);
                        onSave(fieldPath, next.map(Number));
                      }}
                      style={{
                        width: 28,
                        height: 23,
                        padding: 0,
                        border: '1px solid var(--border)',
                        borderRadius: 2,
                        background: 'transparent',
                        cursor: 'pointer',
                      }}
                    />
                  </div>
                )}
                {arr.map((compVal, compIdx) => (
                  <div key={compIdx} style={{ flex: 1, minWidth: 56 }}>
                    <span style={{ fontSize: 9.5, color: 'var(--text-dim)' }}>
                      {labels[compIdx] ?? `[${compIdx}]`}
                    </span>
                    <input
                      type="number"
                      step="any"
                      value={compVal !== undefined && compVal !== null ? String(compVal) : '0'}
                      disabled={isSaving}
                      onChange={(e) => {
                        const next = [...arr];
                        next[compIdx] = e.target.value as unknown as number;
                        setLocalVal(next);
                      }}
                      onBlur={() => {
                        onSave(fieldPath, arr.map((v) => Number(v) || 0));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          onSave(fieldPath, arr.map((v) => Number(v) || 0));
                        }
                      }}
                      style={inputStyle}
                    />
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      ) : field.kind === 'dependency' ? (
        <DependencyEditor
          field={field}
          allTags={allTags}
          fieldPath={fieldPath}
          localVal={localVal}
          isSaving={isSaving}
          inputStyle={inputStyle}
          onChange={(newTagId) => {
            setLocalVal(newTagId);
            onSave(fieldPath, newTagId);
          }}
        />
      ) : field.kind === 'composite' ? (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
          Unsupported value shape
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
          Raw data buffer (managed automatically by OpenCE compilers)
        </div>
      )}
    </div>
  );
}

interface DependencyEditorProps {
  field: TagFieldDescriptor;
  allTags: TagEntrySummary[];
  fieldPath: string;
  localVal: unknown;
  isSaving: boolean;
  inputStyle: CSSProperties;
  onChange: (tagId: number) => void;
}

function DependencyEditor({ field, allTags, fieldPath, localVal, isSaving, inputStyle, onChange }: DependencyEditorProps) {
  const currentTagId = Number(localVal);
  const isNull = currentTagId === NULL_TAG_ID || currentTagId === 0 || Number.isNaN(currentTagId);

  // Filter tags in the map compatible with this dependency's allowed classes
  const matchingTags = useMemo(() => {
    if (!field.dependencyClasses || field.dependencyClasses.length === 0) {
      return allTags;
    }
    const allowed = new Set(field.dependencyClasses.map((c) => c.toLowerCase()));
    return allTags.filter((t) => allowed.has(t.primaryClassName.toLowerCase()));
  }, [allTags, field.dependencyClasses]);

  return (
    <div>
      <select
        data-testid={`field-dependency-${fieldPath}`}
        value={isNull ? 'null' : String(currentTagId)}
        disabled={isSaving}
        onChange={(e) => {
          const val = e.target.value;
          if (val === 'null') {
            onChange(NULL_TAG_ID);
          } else {
            onChange(Number(val));
          }
        }}
        style={inputStyle}
      >
        <option value="null">(None / Null)</option>
        {matchingTags.map((t) => (
          <option key={t.tagId} value={t.tagId}>
            [{t.primaryClassName}] {t.path}
          </option>
        ))}
      </select>
      {field.dependencyTarget && (
        <div style={{ marginTop: 3, fontSize: 10, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Target: {field.dependencyTarget.path}
        </div>
      )}
    </div>
  );
}
