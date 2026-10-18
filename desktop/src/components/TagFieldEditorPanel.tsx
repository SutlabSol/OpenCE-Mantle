import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { TagEntrySummary, TagFieldDescriptor, TagFieldsResult } from '../../electron/shared-types';
import { NULL_TAG_ID } from '../../../core/src/constants/tag-classes';

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

export default function TagFieldEditorPanel({ focusedTag, allTags = [] }: Props) {
  const [fieldsResult, setFieldsResult] = useState<TagFieldsResult | null>(null);
  const [isLoadingFields, setIsLoadingFields] = useState(false);
  const [fieldsError, setFieldsError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);

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
  return (
          <div data-testid="properties-palette-fields" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
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
                    allTags={allTags}
                    savingField={savingField}
                    onSave={handleUpdateField}
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
  allTags: TagEntrySummary[];
  /** Currently saving field path (or null); a card is "saving" when it matches its own path. */
  savingField: string | null;
  /** Save a value at the given (possibly nested) field path; passed through to root as-is. */
  onSave: (fieldPath: string, val: unknown) => void;
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
  allTags,
  savingField,
  onSave,
  expandedBitfields,
  onToggleBitfield,
  expandedReflexives,
  onToggleReflexive,
  search,
}: FieldCardProps) {
  const isSaving = savingField === fieldPath;
  const isExpanded = expandedBitfields.has(fieldPath);
  const isReflexiveExpanded = expandedReflexives.has(fieldPath);
  const searchQ = search?.trim().toLowerCase() ?? '';
  const [localVal, setLocalVal] = useState<unknown>(field.value);

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
          style={{
            fontSize: 9.5,
            padding: '1px 4px',
            borderRadius: 2,
            background: 'rgba(255, 255, 255, 0.08)',
            color: 'var(--text-dim)',
            fontFamily: 'var(--mono-font)',
          }}
        >
          {field.type}
        </span>
      </div>

      {field.kind === 'reflexive' ? (
        <div>
          {field.children && field.children.length > 0 ? (
            <>
              <div
                data-testid={`reflexive-toggle-${fieldPath}`}
                onClick={() => onToggleReflexive(fieldPath)}
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
                <span style={{ color: 'var(--text-secondary)' }}>
                  {field.children.length} element(s) — {field.reflexiveStruct ?? 'Block'}
                </span>
                <span style={{ fontSize: 10, color: 'var(--accent-cyan)' }}>
                  {isReflexiveExpanded ? 'Hide Block ▲' : 'Edit Block ▼'}
                </span>
              </div>
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
                            fontSize: 10.5,
                            fontWeight: 600,
                            color: 'var(--accent-cyan)',
                            fontFamily: 'var(--mono-font)',
                            marginBottom: 4,
                          }}
                        >
                          {`${field.name}[${idx}]`}
                          <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--text-dim)' }}>
                            {el.structName} @ 0x{el.structBase.toString(16).toUpperCase()}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {editableChildFields.map((cf) => {
                            const nestedPath = `${fieldPath}[${idx}].${cf.name}`;
                            return (
                              <FieldCard
                                key={nestedPath}
                                field={cf}
                                fieldPath={nestedPath}
                                allTags={allTags}
                                savingField={savingField}
                                onSave={onSave}
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
            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
              {(field.reflexiveCount ?? 0) > 0
                ? (field.readOnlyReason ?? 'Block is read-only (could not be decoded)')
                : 'Empty block (0 elements)'}
            </div>
          )}
        </div>
      ) : field.readOnly ? (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
          {field.readOnlyReason ?? 'Read-only'}
        </div>
      ) : field.kind === 'number' ? (
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
              {isExpanded ? 'Hide Flags â–²' : 'Edit Flags â–¼'}
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
