import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import type { TagEntrySummary } from '../../electron/shared-types';

export type TagActionType = 'rename' | 'duplicate' | 'delete';

interface Props {
  action: TagActionType;
  tag: TagEntrySummary;
  onClose: () => void;
  onSuccess: (newTagIndex?: number) => void;
}

export default function TagActionDialog({ action, tag, onClose, onSuccess }: Props) {
  const defaultPath = action === 'rename' ? tag.path : `${tag.path}_copy`;
  const [path, setPath] = useState(defaultPath);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (action !== 'delete') {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [action]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  const handleSubmit = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (action === 'delete') {
      setIsSubmitting(true);
      setError(null);
      try {
        const res = await window.opence.deleteTag(tag.index);
        setIsSubmitting(false);
        if (res.ok) {
          onSuccess(undefined);
        } else {
          setError(res.message || 'Failed to delete tag.');
        }
      } catch (err) {
        setIsSubmitting(false);
        setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    const cleanPath = path.trim();
    if (!cleanPath) {
      setError('Path cannot be empty.');
      return;
    }
    if (action === 'rename' && cleanPath === tag.path) {
      setError('New path must be different from current path.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      if (action === 'rename') {
        const res = await window.opence.renameTag(tag.index, cleanPath);
        setIsSubmitting(false);
        if (res.ok) {
          onSuccess(tag.index);
        } else {
          setError(res.message || 'Failed to rename tag.');
        }
      } else {
        const res = await window.opence.duplicateTag(tag.index, cleanPath);
        setIsSubmitting(false);
        if (res.ok) {
          onSuccess(res.newTagIndex);
        } else {
          setError(res.message || 'Failed to duplicate tag.');
        }
      }
    } catch (err) {
      setIsSubmitting(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const isRename = action === 'rename';
  const isDelete = action === 'delete';
  const title = isDelete ? 'Delete Tag from Map' : isRename ? 'Rename Tag' : 'Duplicate Tag';
  const submitLabel = isDelete ? 'Delete Tag' : isRename ? 'Rename Tag' : 'Duplicate Tag';
  const testIdPrefix = isDelete ? 'delete-tag' : isRename ? 'rename-tag' : 'duplicate-tag';

  return (
    <div
      data-testid={`${testIdPrefix}-dialog`}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 150,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        style={{
          width: 500,
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            background: 'var(--bg-panel-header)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
            <span
              style={{
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 2,
                background: 'rgba(56,189,248,0.15)',
                color: 'var(--accent-cyan, #38bdf8)',
                fontFamily: 'var(--mono-font)',
              }}
            >
              {tag.primaryClassName}
            </span>
          </div>
          <button
            data-testid={`${testIdPrefix}-close`}
            onClick={onClose}
            title="Close (Esc)"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dim)',
              fontSize: 16,
              lineHeight: 1,
              cursor: 'pointer',
              padding: '2px 4px',
            }}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', wordBreak: 'break-all' }}>
            <strong>Target Tag:</strong> {tag.path} <span style={{ fontFamily: 'var(--mono-font)' }}>(0x{tag.tagId.toString(16).toUpperCase()})</span>
          </div>

          {isDelete ? (
            <div
              style={{
                fontSize: 11.5,
                padding: '10px 12px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                borderRadius: 4,
                color: 'var(--text-primary)',
                lineHeight: 1.5,
              }}
            >
              Are you sure you want to delete <strong>{tag.path}.{tag.primaryClassName}</strong> from the map?
              <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--text-secondary)' }}>
                • All incoming references to this tag across the entire map (including scenario palettes, shaders, and objects) will be safely nulled out (<code style={{ fontFamily: 'var(--mono-font)' }}>0xFFFFFFFF</code>) so the map does not crash.
                <br />• The tag index slot will be tombstoned in-place so no other tag IDs shift. Use <strong>File &gt; Save</strong> to write changes to disk, or <strong>File &gt; Discard Changes</strong> to revert.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label htmlFor="tag-action-path" style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
                {isRename ? 'New Tag Path' : 'Duplicate Tag Path'}
              </label>
              <input
                id="tag-action-path"
                ref={inputRef}
                data-testid={`${testIdPrefix}-input`}
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                disabled={isSubmitting}
                style={{
                  background: 'var(--bg-main)',
                  border: '1px solid var(--border)',
                  borderRadius: 2,
                  padding: '6px 8px',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--mono-font)',
                  fontSize: 12,
                }}
              />
              <span style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>
                {isRename
                  ? 'Updates the tag path in the map tag index and marks changes as modified in-memory.'
                  : 'Clones the tag structure and allocates a new unique tag ID (0xE174xxxx) in the map tag index.'}
              </span>
            </div>
          )}

          {error && (
            <div
              data-testid={`${testIdPrefix}-error`}
              style={{
                fontSize: 11,
                padding: '6px 10px',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                borderRadius: 2,
                color: '#f87171',
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              data-testid={`${testIdPrefix}-cancel`}
              onClick={onClose}
              disabled={isSubmitting}
              style={{
                background: 'var(--bg-panel-header)',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
                borderRadius: 2,
                padding: '6px 12px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid={`${testIdPrefix}-submit`}
              disabled={isSubmitting || (!isDelete && (!path.trim() || (isRename && path.trim() === tag.path)))}
              style={{
                background: isDelete ? '#ef4444' : 'var(--accent-cyan)',
                border: 'none',
                color: isDelete ? '#fff' : '#06202c',
                borderRadius: 2,
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 600,
                cursor: isSubmitting ? 'wait' : 'pointer',
                opacity: isSubmitting || (!isDelete && (!path.trim() || (isRename && path.trim() === tag.path))) ? 0.6 : 1,
              }}
            >
              {isSubmitting ? 'Processing...' : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
