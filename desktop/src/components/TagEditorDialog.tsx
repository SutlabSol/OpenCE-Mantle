import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { TagEntrySummary } from '../../electron/shared-types';
import TagFieldEditorPanel from './TagFieldEditorPanel';

interface Props {
  tag: TagEntrySummary;
  allTags: TagEntrySummary[];
  onClose: () => void;
}

/**
 * Right-click "Tag Editor..." dialog: hosts the full-field editor (`TagFieldEditorPanel`)
 * for a single tag in a modal overlay (zIndex 150, above the dependency dialog's 100).
 * Escape or the header Close button dismisses.
 */
export default function TagEditorDialog({ tag, allTags, onClose }: Props) {
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    shellRef.current?.focus();
  }, []);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      data-testid="tag-editor-dialog"
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
        ref={shellRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        style={{
          width: 680,
          height: '80vh',
          maxHeight: 760,
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
            gap: 8,
            padding: '10px 14px',
            background: 'var(--bg-panel-header)',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600 }}>Tag Editor</span>
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
          <span
            title={tag.path}
            style={{
              flex: 1,
              fontFamily: 'var(--mono-font)',
              fontSize: 11,
              color: 'var(--text-dim)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {tag.path}
          </span>
          <button
            data-testid="tag-editor-close"
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
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <TagFieldEditorPanel focusedTag={tag} allTags={allTags} />
        </div>
      </div>
    </div>
  );
}
