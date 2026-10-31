import { useState } from 'react';
import type { OpenMapTabSession, TagEntrySummary } from '../../electron/shared-types';
import TagBrowser from './TagBrowser';
import CenterWorkspace, { type CenterWorkspaceTab } from './CenterWorkspace';
import PropertiesPalette, { type PropertiesPaletteTab } from './PropertiesPalette';
import TagEditorDialog from './TagEditorDialog';
import BitmapEditorDialog from './BitmapEditorDialog';
import SoundAuditorDialog from './SoundAuditorDialog';
import HudPreviewerDialog from './HudPreviewerDialog';
import TagActionDialog, { type TagActionType } from './TagActionDialog';

interface SplitComparePaneProps {
  sessions: OpenMapTabSession[];
  primarySession: OpenMapTabSession | null;
  secondarySession: OpenMapTabSession | null;
  isActiveInstance?: boolean;
  onFocusInstance?: () => void;
  onSelectSecondarySession: (sessionId: string) => void;
  onActivateSessionAsPrimary: (sessionId: string, focusTagPath?: string) => void;
  onFocusMatchingTagInPrimary: (tagPath: string, groupName: string) => void;
  onOpenAnotherMap: () => void;
  onDetachSessionToWindow: (sessionId: string) => void;
  onCloseSplitView: () => void;
  onRequestExtractFromSecondary?: (indices: number[]) => void;
  onRequestBatchExtractFromSecondary?: () => void;
}

export default function SplitComparePane({
  sessions,
  secondarySession,
  isActiveInstance = false,
  onFocusInstance,
  onSelectSecondarySession,
  onFocusMatchingTagInPrimary,
  onOpenAnotherMap,
  onDetachSessionToWindow,
  onCloseSplitView,
  onRequestExtractFromSecondary,
  onRequestBatchExtractFromSecondary,
}: SplitComparePaneProps) {
  const [focusedTag, setFocusedTag] = useState<TagEntrySummary | null>(null);
  const [selectedTagIndices, setSelectedTagIndices] = useState<Set<number>>(new Set());
  const [centerTab, setCenterTab] = useState<CenterWorkspaceTab>('overview');
  const [propertiesPaletteTab, setPropertiesPaletteTab] = useState<PropertiesPaletteTab>('overview');
  const [editingTag, setEditingTag] = useState<TagEntrySummary | null>(null);
  const [bitmapEditorTag, setBitmapEditorTag] = useState<TagEntrySummary | null>(null);
  const [soundAuditorTag, setSoundAuditorTag] = useState<TagEntrySummary | null>(null);
  const [hudPreviewerTag, setHudPreviewerTag] = useState<TagEntrySummary | null>(null);
  const [tagAction, setTagAction] = useState<{ action: TagActionType; tag: TagEntrySummary } | null>(null);

  if (!secondarySession) {
    return (
      <div
        data-testid="split-compare-pane-empty"
        style={{
          flex: 1,
          background: 'var(--bg-panel)',
          borderLeft: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          gap: 12,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
          Dual-Instance Side-by-Side Workspace (Autodesk Inventor Style)
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 420, textAlign: 'center', lineHeight: 1.45 }}>
          Open a second <code style={{ color: 'var(--accent-cyan)' }}>.map</code> file to run two full Mantle workspace instances
          (Tag Browser, 3D Viewport, 3D Studios &amp; Properties) side-by-side in one window. Clicking either side makes it the
          active map controlled by the top toolbar.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onOpenAnotherMap}
            style={{
              padding: '6px 14px',
              background: 'var(--selection-bg)',
              border: '1px solid var(--border-active)',
              color: 'var(--accent-cyan)',
              fontWeight: 600,
              fontSize: 12,
              borderRadius: 2,
              cursor: 'pointer',
            }}
          >
            + Open Second Map...
          </button>
          <button
            onClick={onCloseSplitView}
            style={{
              padding: '6px 14px',
              background: 'var(--bg-control)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              fontSize: 12,
              borderRadius: 2,
              cursor: 'pointer',
            }}
          >
            Close Split View
          </button>
        </div>
      </div>
    );
  }

  const secTags = secondarySession.map.tags;

  return (
    <div
      data-testid="split-compare-pane"
      onMouseDownCapture={() => {
        onFocusInstance?.();
      }}
      style={{
        flex: 1,
        background: 'var(--bg-panel)',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
        outline: isActiveInstance ? '2px solid var(--accent-cyan)' : '1px solid var(--border)',
        outlineOffset: -2,
      }}
    >
      {/* Top Instance Header Bar of Right Mantle Workspace Instance */}
      <div
        style={{
          padding: '4px 10px',
          background: isActiveInstance ? 'rgba(0, 212, 255, 0.12)' : 'var(--bg-panel-header)',
          borderBottom: `1px solid ${isActiveInstance ? 'var(--accent-cyan)' : 'var(--border)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span
            style={{
              fontFamily: 'var(--mono-font)',
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 6px',
              background: isActiveInstance ? 'var(--accent-cyan)' : 'var(--accent-gold)',
              color: '#060a10',
              borderRadius: 2,
              whiteSpace: 'nowrap',
            }}
          >
            {isActiveInstance ? '● RIGHT INSTANCE (ACTIVE)' : 'RIGHT INSTANCE'}
          </span>
          <select
            value={secondarySession.sessionId}
            onChange={(e) => onSelectSecondarySession(e.target.value)}
            style={{
              padding: '2px 8px',
              fontSize: 11.5,
              fontFamily: 'var(--mono-font)',
              background: 'var(--bg-control)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              borderRadius: 2,
            }}
          >
            {sessions.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {s.fileName} ({s.scenarioName})
              </option>
            ))}
          </select>
          <span style={{ fontSize: 10.5, color: 'var(--text-dim)', fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap' }}>
            {secTags.length.toLocaleString()} tags
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          {focusedTag && (
            <button
              onClick={() => onFocusMatchingTagInPrimary(focusedTag.path, focusedTag.primaryClassName)}
              title="Jump to matching tag path in Left Instance"
              style={{
                padding: '2px 7px',
                fontSize: 10.5,
                background: 'var(--selection-bg)',
                border: '1px solid var(--border-active)',
                color: 'var(--accent-cyan)',
                borderRadius: 2,
                cursor: 'pointer',
              }}
            >
              🔍 Focus in Left
            </button>
          )}
          <button
            onClick={() => onDetachSessionToWindow(secondarySession.sessionId)}
            title="Tear off this map into a second monitor window"
            style={{
              padding: '2px 7px',
              fontSize: 10.5,
              background: 'var(--bg-control)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              borderRadius: 2,
              cursor: 'pointer',
            }}
          >
            ↗ 2nd Window
          </button>
          <button
            onClick={onCloseSplitView}
            title="Close side-by-side split view"
            style={{
              padding: '2px 6px',
              fontSize: 10.5,
              background: 'var(--bg-control)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              borderRadius: 2,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Full Second Mantle Instance Workspace: TagBrowser + CenterWorkspace + PropertiesPalette */}
      <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}>
        <TagBrowser
          tags={secTags}
          focusedTag={focusedTag}
          onFocusTag={setFocusedTag}
          selected={selectedTagIndices}
          onSelectedChange={setSelectedTagIndices}
          onExtractRequested={(indices) => {
            onFocusInstance?.();
            onRequestExtractFromSecondary?.(indices);
          }}
          extractDisabledReason={selectedTagIndices.size === 0 ? 'Select at least one tag first.' : null}
          onExtractWholeMap={() => {
            onFocusInstance?.();
            onRequestBatchExtractFromSecondary?.();
          }}
          canExtractWholeMap={true}
          onEditTag={setEditingTag}
          onFindReferences={(tag) => {
            setFocusedTag(tag);
            setSelectedTagIndices(new Set([tag.index]));
            setPropertiesPaletteTab('references');
          }}
          onRenameTag={(tag) => setTagAction({ action: 'rename', tag })}
          onDuplicateTag={(tag) => setTagAction({ action: 'duplicate', tag })}
          onDeleteTag={(tag) => setTagAction({ action: 'delete', tag })}
          onOpenBitmapEditor={setBitmapEditorTag}
          onOpenSoundAuditor={setSoundAuditorTag}
          onOpenHudPreviewer={setHudPreviewerTag}
        />

        <CenterWorkspace
          key={`right-instance-${secondarySession.sessionId}`}
          header={secondarySession.map.header}
          allTags={secTags}
          onActiveTabChange={(nextTab) => {
            onFocusInstance?.();
            setCenterTab(nextTab);
          }}
          onSelectObjectTag={(tagId, objectPath) => {
            const target =
              secTags.find((t) => t.tagId === tagId) ??
              secTags.find((t) => (t.tagId & 0xffff) === (tagId & 0xffff)) ??
              (objectPath ? secTags.find((t) => t.path.toLowerCase() === objectPath.toLowerCase()) : undefined);
            if (target) {
              setFocusedTag(target);
              setSelectedTagIndices(new Set([target.index]));
            }
          }}
          onOpenTagEditor={(tagIndexOrPath) => {
            const target =
              typeof tagIndexOrPath === 'number'
                ? (secTags.find((t) => t.index === tagIndexOrPath) ?? secTags[tagIndexOrPath])
                : secTags.find(
                    (t) =>
                      t.path.toLowerCase() === tagIndexOrPath.toLowerCase() ||
                      t.path.toLowerCase().endsWith(tagIndexOrPath.toLowerCase()),
                  );
            if (target) {
              setFocusedTag(target);
              setSelectedTagIndices(new Set([target.index]));
              setEditingTag(target);
            }
          }}
        />

        {centerTab !== 'bitmap-3d' && centerTab !== 'bsp-model-studio' && (
          <PropertiesPalette
            focusedTag={focusedTag}
            allTags={secTags}
            activeTab={propertiesPaletteTab}
            onTabChange={setPropertiesPaletteTab}
            onSelectTag={(idx) => {
              const t = secTags.find((tag) => tag.index === idx) ?? secTags[idx];
              if (t) {
                setFocusedTag(t);
                setSelectedTagIndices(new Set([t.index]));
              }
            }}
          />
        )}
      </div>

      {editingTag && (
        <TagEditorDialog
          tag={editingTag}
          allTags={secTags}
          onClose={() => setEditingTag(null)}
          onOpenBitmapEditor={setBitmapEditorTag}
          onOpenSoundAuditor={setSoundAuditorTag}
          onOpenHudPreviewer={setHudPreviewerTag}
        />
      )}

      {bitmapEditorTag && <BitmapEditorDialog tag={bitmapEditorTag} onClose={() => setBitmapEditorTag(null)} />}
      {soundAuditorTag && <SoundAuditorDialog tag={soundAuditorTag} onClose={() => setSoundAuditorTag(null)} />}
      {hudPreviewerTag && <HudPreviewerDialog tag={hudPreviewerTag} onClose={() => setHudPreviewerTag(null)} />}

      {tagAction && (
        <TagActionDialog
          action={tagAction.action}
          tag={tagAction.tag}
          onClose={() => setTagAction(null)}
          onSuccess={() => setTagAction(null)}
        />
      )}
    </div>
  );
}
