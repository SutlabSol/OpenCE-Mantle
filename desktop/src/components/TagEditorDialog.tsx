import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { TagEntrySummary } from '../../electron/shared-types';
import TagFieldEditorPanel from './TagFieldEditorPanel';
import UnicodeStringEditorPanel from './UnicodeStringEditorPanel';

interface Props {
  tag: TagEntrySummary;
  allTags: TagEntrySummary[];
  onOpenBitmapEditor?: (tag: TagEntrySummary) => void;
  onClose: () => void;
}

/**
 * Right-click "Tag Editor..." dialog: hosts the full-field editor (`TagFieldEditorPanel`)
 * or `UnicodeStringEditorPanel` for ustr tags in a modal overlay (zIndex 150, above the dependency dialog's 100).
 * Escape or the header Close button dismisses.
 */
export default function TagEditorDialog({ tag, allTags, onClose, onOpenBitmapEditor }: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const isUnicodeStrings = tag.primaryClassName === 'unicode_string_list';
  const [tab, setTab] = useState<'strings' | 'fields'>(isUnicodeStrings ? 'strings' : 'fields');

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
          {tag.primaryClassName === 'bitmap' && onOpenBitmapEditor && (
            <button
              data-testid="tag-editor-open-bitmap"
              onClick={() => {
                onClose();
                onOpenBitmapEditor(tag);
              }}
              style={{
                padding: '3px 8px',
                fontSize: 11,
                background: 'rgba(56,189,248,0.15)',
                border: '1px solid rgba(56,189,248,0.4)',
                color: 'var(--accent-cyan)',
                borderRadius: 3,
                cursor: 'pointer',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              Open in Bitmap Editor
            </button>
          )}

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

        {isUnicodeStrings && (
          <div
            style={{
              display: 'flex',
              background: 'var(--bg-panel-header)',
              borderBottom: '1px solid var(--border)',
              padding: '0 10px',
              flexShrink: 0,
            }}
          >
            <button
              data-testid="tag-editor-tab-strings"
              onClick={() => setTab('strings')}
              style={{
                padding: '6px 14px',
                background: tab === 'strings' ? 'var(--bg-panel)' : 'transparent',
                border: 'none',
                borderBottom: tab === 'strings' ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                color: tab === 'strings' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Unicode Strings
            </button>
            <button
              data-testid="tag-editor-tab-fields"
              onClick={() => setTab('fields')}
              style={{
                padding: '6px 14px',
                background: tab === 'fields' ? 'var(--bg-panel)' : 'transparent',
                border: 'none',
                borderBottom: tab === 'fields' ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                color: tab === 'fields' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Raw Fields
            </button>
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {isUnicodeStrings && tab === 'strings' ? (
            <UnicodeStringEditorPanel tag={tag} />
          ) : (
            <TagFieldEditorPanel focusedTag={tag} allTags={allTags} />
          )}
        </div>
      </div>
    </div>
  );
}
