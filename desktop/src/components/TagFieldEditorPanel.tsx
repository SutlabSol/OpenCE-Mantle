import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { TagEntrySummary, TagFieldDescriptor, TagFieldsResult } from '../../electron/shared-types';
import { NULL_TAG_ID } from '../../../core/src/constants/tag-classes';
import { getFieldExplanation, getTagGroupExplanation } from '../../../core/src/map/definitions/tag-explanations';

interface Props {
  focusedTag: TagEntrySummary | null;
  allTags?: TagEntrySummary[];
}

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
    lowerName === 'next sibling node';

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
  } else if (lowerName === 'name' || lowerName.includes('name index') || lowerName === 'object name') {
    targetReflexiveName = 'object names';
  } else if (lowerName.includes('trigger volume')) {
    targetReflexiveName = 'trigger volumes';
  } else if (lowerName.includes('camera point')) {
    targetReflexiveName = 'cutscene camera points';
  } else if (lowerName === 'actor type') {
    targetReflexiveName = 'actor palette';
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
  if (!targetBlock || !targetBlock.children || targetBlock.children.length === 0) return null;

  const options: CrossReflexiveOption[] = targetBlock.children.map((el, idx) => {
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

export default function TagFieldEditorPanel({ focusedTag, allTags = [] }: Props) {
  const [fieldsResult, setFieldsResult] = useState<TagFieldsResult | null>(null);
  const [isLoadingFields, setIsLoadingFields] = useState(false);
  const [fieldsError, setFieldsError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [addingChunkPath, setAddingChunkPath] = useState<string | null>(null);

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

  const filteredFields = useMemo(() => {
    if (!fieldsResult) return [];
    // Dependency slots are edited via the Dependency Swapper tab in `PropertiesPalette`;
    // hide them here (value fields only: numbers, bounds, enums, bitfields, strings, composites).
    const valueFields = fieldsResult.fields.filter((f) => f.kind !== 'dependency');
    const q = search.trim().toLowerCase();
    if (!q) return valueFields;
    return valueFields.filter((f) => {
      if (f.name.toLowerCase().includes(q) || f.type.toLowerCase().includes(q)) return true;
      // Keep reflexive blocks when any non-dependency descendant field matches.
      return f.kind === 'reflexive' && reflexiveDescendantMatches(f, q);
    });
  }, [fieldsResult, search]);

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
    };
    const jsonText = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(jsonText);
      setStatusMessage(`Copied "${elementPath}" values to clipboard as JSON.`);
    } catch {
      setStatusMessage(`Copied "${elementPath}" (${Object.keys(payload.values as object).length} fields).`);
    }
  };

  const handlePasteReflexiveElementJson = async (elementPath: string, elementFields: TagFieldDescriptor[]) => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = JSON.parse(text) as { values?: Record<string, unknown> };
      const values = parsed?.values ?? (typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null);
      if (!values) {
        setStatusMessage('Failed to paste: Clipboard does not contain valid reflexive JSON.');
        return;
      }
      let updatedCount = 0;
      for (const cf of elementFields) {
        if (cf.kind === 'reflexive' || cf.kind === 'dependency' || cf.readOnly) continue;
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

  return (
          <div data-testid="properties-palette-fields" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
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
            {/* Search filter */}
            <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
              <input
                data-testid="fields-search-input"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter fields..."
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: 'var(--bg-input, #1e1e1e)',
                  border: '1px solid var(--border)',
                  borderRadius: 3,
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  padding: '4px 8px',
                }}
              />
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
                    onCopyElementJson={handleCopyReflexiveElementJson}
                    onPasteElementJson={handlePasteReflexiveElementJson}
                    addingChunkPath={addingChunkPath}
                    expandedBitfields={expandedBitfields}
                    onToggleBitfield={toggleBitfieldExpand}
                    expandedReflexives={expandedReflexives}
                    onToggleReflexive={toggleReflexiveExpand}
                    search={search}
                  />
                ))
              )}
            </div>
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
  onCopyElementJson?: (elementPath: string, elementFields: TagFieldDescriptor[]) => void;
  onPasteElementJson?: (elementPath: string, elementFields: TagFieldDescriptor[]) => void;
  addingChunkPath?: string | null;
  expandedBitfields: Set<string>;
  onToggleBitfield: (fieldPath: string) => void;
  expandedReflexives: Set<string>;
  onToggleReflexive: (fieldPath: string) => void;
  /** Non-empty trimmed search query; reflexive blocks auto-expand when a descendant field matches. */
  search?: string;
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
  onCopyElementJson,
  onPasteElementJson,
  addingChunkPath,
  expandedBitfields,
  onToggleBitfield,
  expandedReflexives,
  onToggleReflexive,
  search,
}: FieldCardProps) {
  const isSaving = savingField === fieldPath;
  const isExpanded = expandedBitfields.has(fieldPath);
  const isReflexiveExpanded = expandedReflexives.has(fieldPath);
  const isAddingChunk = addingChunkPath === fieldPath;
  const searchQ = search?.trim().toLowerCase() ?? '';
  const [localVal, setLocalVal] = useState<unknown>(field.value);
  const fieldUnitInfo = useMemo(() => getFieldUnit(field.name, field.type), [field.name, field.type]);
  const fieldExplanation = useMemo(
    () => getFieldExplanation(field.name, tagClassName),
    [field.name, tagClassName],
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
            )}
          </div>

          {field.children && field.children.length > 0 ? (
            <>
              {(isReflexiveExpanded || (searchQ !== '' && reflexiveDescendantMatches(field, searchQ))) && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {field.children.map((el, idx) => {
                    const editableChildFields = el.fields.filter((cf) => cf.kind !== 'dependency');
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
                            {`${field.name}[${idx}]`}
                            <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--text-dim)' }}>
                              {el.structName} @ 0x{el.structBase.toString(16).toUpperCase()}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {onCopyElementJson && (
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
                            {onPasteElementJson && (
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
                                onCopyElementJson={onCopyElementJson}
                                onPasteElementJson={onPasteElementJson}
                                addingChunkPath={addingChunkPath}
                                expandedBitfields={expandedBitfields}
                                onToggleBitfield={onToggleBitfield}
                                expandedReflexives={expandedReflexives}
                                onToggleReflexive={onToggleReflexive}
                                search={search}
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
          {crossRefInfo && (
            <div style={{ marginBottom: 4 }}>
              <select
                data-testid={`field-crossref-${fieldPath}`}
                value={Number(localVal)}
                disabled={isSaving}
                onChange={(e) => {
                  const nextVal = Number(e.target.value);
                  setLocalVal(nextVal);
                  onSave(fieldPath, nextVal);
                }}
                style={{ ...inputStyle, borderColor: 'rgba(56, 189, 248, 0.35)' }}
                title={`Select element from "${crossRefInfo.reflexiveName}" reflexive block`}
              >
                <option value={-1}>[-1] (None / Null)</option>
                {crossRefInfo.options.map((opt) => (
                  <option key={opt.index} value={opt.index}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}
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
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
          Unsupported value shape
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
