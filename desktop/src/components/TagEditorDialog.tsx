import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { TagEntrySummary } from '../../electron/shared-types';
import TagFieldEditorPanel from './TagFieldEditorPanel';
import UnicodeStringEditorPanel from './UnicodeStringEditorPanel';
import CurveGraphVisualizer from './CurveGraphVisualizer';

interface Props {
  tag: TagEntrySummary;
  allTags: TagEntrySummary[];
  onOpenBitmapEditor?: (tag: TagEntrySummary) => void;
  onOpenSoundAuditor?: (tag: TagEntrySummary) => void;
  onOpenHudPreviewer?: (tag: TagEntrySummary) => void;
  onClose: () => void;
}

/**
 * Right-click "Tag Editor..." dialog: hosts the full-field editor (`TagFieldEditorPanel`),
 * `UnicodeStringEditorPanel` for ustr tags, or `CurveGraphVisualizer` in a modal overlay.
 * Escape or the header Close button dismisses.
 */
export default function TagEditorDialog({
  tag,
  allTags,
  onClose,
  onOpenBitmapEditor,
  onOpenSoundAuditor,
  onOpenHudPreviewer,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const isUnicodeStrings = tag.primaryClassName === 'unicode_string_list';
  const isHudTag = ['weapon_hud_interface', 'unit_hud_interface', 'grenade_hud_interface', 'hud_globals'].includes(
    tag.primaryClassName,
  );

  const [tab, setTab] = useState<'strings' | 'fields' | 'curves'>(isUnicodeStrings ? 'strings' : 'fields');

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
      role="dialog"
      aria-modal="true"
      data-testid="tag-editor-dialog"
      tabIndex={-1}
      ref={shellRef}
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 150,
      }}
    >
      <div
        style={{
          width: '92vw',
          maxWidth: 1200,
          height: '88vh',
          background: 'var(--bg-panel)',
          color: 'var(--text-primary)',
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

          {/* Asset Editor Buttons in Header */}
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

          {tag.primaryClassName === 'sound' && onOpenSoundAuditor && (
            <button
              data-testid="tag-editor-open-sound"
              onClick={() => {
                onClose();
                onOpenSoundAuditor(tag);
              }}
              style={{
                padding: '3px 8px',
                fontSize: 11,
                background: 'rgba(56,189,248,0.15)',
                border: '1px solid rgba(56,189,248,0.4)',
                color: '#38bdf8',
                borderRadius: 3,
                cursor: 'pointer',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              Open in Sound Auditor
            </button>
          )}

          {isHudTag && onOpenHudPreviewer && (
            <button
              data-testid="tag-editor-open-hud"
              onClick={() => {
                onClose();
                onOpenHudPreviewer(tag);
              }}
              style={{
                padding: '3px 8px',
                fontSize: 11,
                background: 'rgba(52,211,153,0.15)',
                border: '1px solid rgba(52,211,153,0.4)',
                color: '#34d399',
                borderRadius: 3,
                cursor: 'pointer',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              Open in HUD Previewer
            </button>
          )}

          {(tag.primaryClassName === 'gbxmodel' || tag.primaryClassName === 'model') && (
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                data-testid="tag-editor-export-model-glb"
                onClick={async () => {
                  const baseName = tag.path.split('\\').pop() || 'model';
                  const pickRes = await window.opence.pickExport3dPath(baseName, 'glb');
                  if (!pickRes || !pickRes.path) return;
                  await window.opence.exportModel3d(tag.tagId, 4, 'glb', pickRes.path);
                }}
                style={{
                  padding: '3px 8px',
                  fontSize: 11,
                  background: 'rgba(192,132,252,0.15)',
                  border: '1px solid rgba(192,132,252,0.4)',
                  color: '#c084fc',
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                Export .glb
              </button>
              <button
                data-testid="tag-editor-export-model-obj"
                onClick={async () => {
                  const baseName = tag.path.split('\\').pop() || 'model';
                  const pickRes = await window.opence.pickExport3dPath(baseName, 'obj');
                  if (!pickRes || !pickRes.path) return;
                  await window.opence.exportModel3d(tag.tagId, 4, 'obj', pickRes.path);
                }}
                style={{
                  padding: '3px 8px',
                  fontSize: 11,
                  background: 'rgba(192,132,252,0.15)',
                  border: '1px solid rgba(192,132,252,0.4)',
                  color: '#c084fc',
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                Export .obj
              </button>
            </div>
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

        {/* Tab Strip */}
        <div
          style={{
            display: 'flex',
            background: 'var(--bg-panel-header)',
            borderBottom: '1px solid var(--border)',
            padding: '0 10px',
            flexShrink: 0,
            gap: 4,
          }}
        >
          {isUnicodeStrings && (
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
          )}
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
          <button
            data-testid="tag-editor-tab-curves"
            onClick={() => setTab('curves')}
            style={{
              padding: '6px 14px',
              background: tab === 'curves' ? 'var(--bg-panel)' : 'transparent',
              border: 'none',
              borderBottom: tab === 'curves' ? '2px solid var(--accent-cyan)' : '2px solid transparent',
              color: tab === 'curves' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Curve Graph
          </button>
        </div>

        {/* Tab Content */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {tab === 'strings' && isUnicodeStrings ? (
            <UnicodeStringEditorPanel tag={tag} />
          ) : tab === 'curves' ? (
            <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
              <CurveGraphVisualizer />
            </div>
          ) : (
            <TagFieldEditorPanel focusedTag={tag} allTags={allTags} />
          )}
        </div>
      </div>
    </div>
  );
}
