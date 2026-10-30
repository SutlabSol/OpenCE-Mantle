import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type {
  ContentExplorerNodeResult,
  HaloScriptDocEntry,
  LooseBlamTagIndexEntry,
  LooseTagsWorkspaceSnapshot,
  TagEntrySummary,
  TagFieldDescriptor,
  ToolCommandDefinition,
} from '../../electron/shared-types';

export type BaboonStudioTab =
  | 'loose-workspace'
  | 'content-explorer'
  | 'tool-runner'
  | 'asset-libraries';

interface Props {
  open: boolean;
  initialTab?: BaboonStudioTab;
  focusedTag: TagEntrySummary | null;
  allTags: TagEntrySummary[];
  onClose: () => void;
  onSelectMapTag?: (tagIndex: number, highlightFieldPath?: string) => void;
  onOpenTagEditor?: (tagIndex: number) => void;
}

export default function BaboonStudioDialog({
  open,
  initialTab = 'content-explorer',
  focusedTag,
  allTags,
  onClose,
  onSelectMapTag,
  onOpenTagEditor,
}: Props) {
  const [tab, setTab] = useState<BaboonStudioTab>(initialTab);

  // --- Tab 1: Loose Blam tags/ Workspace & Git Review ---
  const [workspaceSnapshot, setWorkspaceSnapshot] = useState<LooseTagsWorkspaceSnapshot | null>(null);
  const [wsFilter, setWsFilter] = useState('');
  const [wsFilterMode, setWsFilterMode] = useState<'all' | 'broken' | 'unreferenced'>('all');
  const [selectedLooseTag, setSelectedLooseTag] = useState<LooseBlamTagIndexEntry | null>(null);
  const [looseFields, setLooseFields] = useState<TagFieldDescriptor[]>([]);
  const [looseMovePathDraft, setLooseMovePathDraft] = useState('');
  const [gitInfo, setGitInfo] = useState<{
    isGitRepo: boolean;
    branch: string;
    statusEntries: Array<{ status: string; relativePath: string; groupName: string; absolutePath: string }>;
    recentCommits: Array<{ hash: string; shortHash: string; author: string; date: string; subject: string }>;
  } | null>(null);
  const [gitDiffResult, setGitDiffResult] = useState<{
    relativePath: string;
    groupName: string;
    changedFieldsCount: number;
    fields: Array<{ fieldPath: string; status: string; leftValue?: string; rightValue?: string }>;
  } | null>(null);

  // --- Tab 2: Content Explorer & Refactoring ---
  const [explorerTagIndex, setExplorerTagIndex] = useState<number>(focusedTag?.index ?? 0);
  const [explorerHistory, setExplorerHistory] = useState<number[]>(focusedTag ? [focusedTag.index] : [0]);
  const [explorerHistoryPos, setExplorerHistoryPos] = useState<number>(0);
  const [explorerData, setExplorerData] = useState<ContentExplorerNodeResult | null>(null);
  const [explorerSearch, setExplorerSearch] = useState('');
  const [oldFolderPrefix, setOldFolderPrefix] = useState('weapons\\assault rifle');
  const [newFolderPrefix, setNewFolderPrefix] = useState('weapons\\custom_ar');

  // --- Tab 3: Visual tool.exe Command Runner & HaloScript Reference ---
  const [toolExecutionMode, setToolExecutionMode] = useState<'native' | 'external_exe'>('native');
  const [toolEngineFilter, setToolEngineFilter] = useState('h1');
  const [toolCommands, setToolCommands] = useState<ToolCommandDefinition[]>([]);
  const [selectedVerb, setSelectedVerb] = useState<string>('bitmaps');
  const [toolArgsDraft, setToolArgsDraft] = useState<Record<string, string>>({});
  const [toolWorkingDir, setToolWorkingDir] = useState<string>('');
  const [toolOutput, setToolOutput] = useState<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    debugTxtTail?: string;
    writtenTagPaths?: string[];
    writtenMapPath?: string;
    executionEngine?: 'native' | 'external_exe';
  } | null>(null);
  const [hsQuery, setHsQuery] = useState('');
  const [hsEngineFilter, setHsEngineFilter] = useState('all');
  const [hsDocs, setHsDocs] = useState<HaloScriptDocEntry[]>([]);

  // --- Tab 4: Bitmap & 3D Model Library Grids ---
  const [libraryKind, setLibraryKind] = useState<'bitmap' | 'gbxmodel'>('bitmap');
  const [librarySearch, setLibrarySearch] = useState('');
  const [bitmapThumbs, setBitmapThumbs] = useState<Record<number, string>>({});

  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (open && initialTab) {
      setTab(initialTab);
    }
  }, [open, initialTab]);

  useEffect(() => {
    if (focusedTag) {
      setExplorerTagIndex(focusedTag.index);
      setExplorerHistory([focusedTag.index]);
      setExplorerHistoryPos(0);
    }
  }, [focusedTag]);

  // Load Content Explorer node when explorerTagIndex changes
  useEffect(() => {
    if (!open || tab !== 'content-explorer' || allTags.length === 0) return;
    if (typeof window.opence.inspectContentExplorer !== 'function') return;
    void window.opence.inspectContentExplorer(explorerTagIndex).then((res) => {
      if (res.ok) setExplorerData(res.result);
    });
  }, [open, tab, explorerTagIndex, allTags.length]);

  // Load tool.exe commands & HaloScript docs when tab === 'tool-runner'
  useEffect(() => {
    if (!open || tab !== 'tool-runner') return;
    if (typeof window.opence.getToolCommands === 'function') {
      void window.opence.getToolCommands(toolEngineFilter).then((cmds) => {
        const normalized = cmds.map((c: any) => ({
          ...c,
          verb: c.verb ?? c.name,
          args: (c.args ?? []).map((a: any) => ({
            ...a,
            options: a.options ?? a.values,
          })),
        }));
        setToolCommands(normalized);
        if (normalized.length > 0 && !normalized.some((c: any) => c.verb === selectedVerb)) {
          setSelectedVerb(normalized[0]!.verb);
        }
      });
    }
    if (typeof window.opence.queryHaloScriptCatalog === 'function') {
      void window.opence.queryHaloScriptCatalog(hsQuery, hsEngineFilter).then(setHsDocs);
    }
  }, [open, tab, toolEngineFilter, hsQuery, hsEngineFilter, selectedVerb]);

  const navigateExplorerTo = (nextIdx: number) => {
    const trimmed = explorerHistory.slice(0, explorerHistoryPos + 1);
    trimmed.push(nextIdx);
    setExplorerHistory(trimmed);
    setExplorerHistoryPos(trimmed.length - 1);
    setExplorerTagIndex(nextIdx);
  };

  const handleOpenLooseWorkspace = async () => {
    if (typeof window.opence.openLooseTagsWorkspace !== 'function') return;
    setIsBusy(true);
    const res = await window.opence.openLooseTagsWorkspace();
    setIsBusy(false);
    if (res.ok) {
      setWorkspaceSnapshot(res.snapshot);
      setToolWorkingDir(res.snapshot.tagsRootDir);
      setStatusBanner(
        `Opened Loose Blam tags/ Workspace: ${res.snapshot.totalFiles} tags (${res.snapshot.brokenDependencyCount} broken refs, ${res.snapshot.unreferencedTagCount} unreferenced).`,
      );
      if (typeof window.opence.inspectGitTagsWorkspace === 'function') {
        const gitRes = await window.opence.inspectGitTagsWorkspace(res.snapshot.tagsRootDir);
        if (gitRes.ok) setGitInfo(gitRes);
      }
    } else if (!res.cancelled) {
      setStatusBanner(`Failed to open workspace: ${res.message}`);
    }
  };

  const handleSelectLooseTag = async (entry: LooseBlamTagIndexEntry) => {
    setSelectedLooseTag(entry);
    setLooseMovePathDraft(entry.relativePath);
    if (typeof window.opence.readLooseTagFields === 'function') {
      const res = await window.opence.readLooseTagFields(entry.absolutePath, entry.relativePath);
      if (res.ok) {
        setLooseFields(res.fields.fields);
      }
    }
  };

  const handleFixLooseWorkspaceDeps = async () => {
    if (!workspaceSnapshot || typeof window.opence.fixLooseWorkspaceDependencies !== 'function') return;
    setIsBusy(true);
    const res = await window.opence.fixLooseWorkspaceDependencies(workspaceSnapshot.tagsRootDir);
    setIsBusy(false);
    if (res.ok) {
      setWorkspaceSnapshot(res.snapshot);
      setStatusBanner(
        `Repaired ${res.report.fixedCount} broken dependency slot(s) across loose tags/ workspace (${res.report.ambiguousCount} ambiguous, ${res.report.unresolvedCount} unresolved).`,
      );
    } else {
      setStatusBanner(`Auto-fix failed: ${res.message}`);
    }
  };

  const handleMoveLooseTag = async () => {
    if (
      !workspaceSnapshot ||
      !selectedLooseTag ||
      !looseMovePathDraft.trim() ||
      typeof window.opence.refactorMoveLooseTag !== 'function'
    ) {
      return;
    }
    setIsBusy(true);
    const res = await window.opence.refactorMoveLooseTag(
      workspaceSnapshot.tagsRootDir,
      selectedLooseTag.relativePath,
      looseMovePathDraft.trim(),
      selectedLooseTag.groupName,
    );
    setIsBusy(false);
    if (res.ok) {
      setWorkspaceSnapshot(res.snapshot);
      setStatusBanner(
        `Moved "${selectedLooseTag.relativePath}.${selectedLooseTag.groupName}" -> "${looseMovePathDraft.trim()}.${selectedLooseTag.groupName}" and updated ${res.report.updatedReferenceSlots} referencing tag slot(s) on disk.`,
      );
    } else {
      setStatusBanner(`Move/Refactor failed: ${res.message}`);
    }
  };

  const handleAutoFixMapDeps = async () => {
    if (typeof window.opence.autoFixTagDependencies !== 'function') return;
    setIsBusy(true);
    const res = await window.opence.autoFixTagDependencies();
    setIsBusy(false);
    if (res.ok) {
      setStatusBanner(
        `Auto-Fixed ${res.report.fixedCount} broken TagDependency slot(s) in open map (${res.report.ambiguousCount} ambiguous, ${res.report.unresolvedCount} unresolved).`,
      );
      if (typeof window.opence.inspectContentExplorer === 'function') {
        const refreshed = await window.opence.inspectContentExplorer(explorerTagIndex);
        if (refreshed.ok) setExplorerData(refreshed.result);
      }
    } else {
      setStatusBanner(`Auto-Fix failed: ${res.message}`);
    }
  };

  const handleRefactorMapFolder = async () => {
    if (typeof window.opence.refactorMoveFolderInMap !== 'function') return;
    if (!oldFolderPrefix.trim() || !newFolderPrefix.trim()) return;
    setIsBusy(true);
    const res = await window.opence.refactorMoveFolderInMap(oldFolderPrefix.trim(), newFolderPrefix.trim());
    setIsBusy(false);
    if (res.ok) {
      setStatusBanner(
        `Refactored folder prefix "${oldFolderPrefix}" -> "${newFolderPrefix}": ${res.report.movedTags.length} tag path(s) moved in-place.`,
      );
    } else {
      setStatusBanner(`Folder refactor failed: ${res.message}`);
    }
  };

  const selectedToolCmd = useMemo(
    () => toolCommands.find((c) => c.verb === selectedVerb) ?? toolCommands[0] ?? null,
    [toolCommands, selectedVerb],
  );

  const handleRunToolCommand = async () => {
    if (!selectedToolCmd || typeof window.opence.runToolExeCommand !== 'function') return;
    const args = selectedToolCmd.args.map(
      (argDef) => toolArgsDraft[argDef.name] ?? argDef.options?.[0] ?? '',
    );
    setIsBusy(true);
    const res: any = await window.opence.runToolExeCommand({
      mode: toolExecutionMode,
      workingDir: toolWorkingDir || '.',
      verb: selectedToolCmd.verb,
      args,
    } as any);
    setIsBusy(false);
    setToolOutput({
      exitCode: res.exitCode,
      stdout: res.stdout,
      stderr: res.stderr,
      debugTxtTail: res.debugTxtTail,
      writtenTagPaths: res.writtenTagPaths,
      writtenMapPath: res.writtenMapPath,
      executionEngine: res.executionEngine ?? toolExecutionMode,
    });
    setStatusBanner(
      res.ok
        ? `[${toolExecutionMode === 'native' ? 'Native Mantle Compiler' : 'External tool.exe'}] tool ${selectedToolCmd.verb} completed (exit code 0).`
        : `tool ${selectedToolCmd.verb} finished with status: ${res.message ?? `exit code ${res.exitCode}`}`,
    );
  };

  const filteredLooseTags = useMemo(() => {
    if (!workspaceSnapshot) return [];
    const q = wsFilter.trim().toLowerCase();
    return workspaceSnapshot.entries.filter((e) => {
      if (wsFilterMode === 'broken' && e.brokenReferences.length === 0) return false;
      if (wsFilterMode === 'unreferenced' && e.referencedByCount > 0) return false;
      if (!q) return true;
      return e.relativePath.toLowerCase().includes(q) || e.groupName.toLowerCase().includes(q);
    });
  }, [workspaceSnapshot, wsFilter, wsFilterMode]);

  const libraryTags = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    return allTags
      .filter((t) =>
        libraryKind === 'bitmap'
          ? t.primaryClassName === 'bitmap'
          : t.primaryClassName === 'gbxmodel' || t.primaryClassName === 'model',
      )
      .filter((t) => !q || t.path.toLowerCase().includes(q))
      .slice(0, 80);
  }, [allTags, libraryKind, librarySearch]);

  const loadBitmapThumb = async (tag: TagEntrySummary) => {
    if (bitmapThumbs[tag.index] || typeof window.opence.getBitmapRgba !== 'function') return;
    const res = await window.opence.getBitmapRgba(tag.index, 0);
    if (!res.ok) return;
    const canvas = document.createElement('canvas');
    canvas.width = res.width;
    canvas.height = res.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imgData = new ImageData(new Uint8ClampedArray(res.rgba), res.width, res.height);
    ctx.putImageData(imgData, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    setBitmapThumbs((prev) => ({ ...prev, [tag.index]: dataUrl }));
  };

  if (!open) return null;

  const btnStyle = (primary = false): CSSProperties => ({
    padding: '5px 11px',
    fontSize: 11.5,
    fontWeight: primary ? 600 : 500,
    background: primary ? 'var(--accent-cyan)' : 'var(--bg-panel-header)',
    color: primary ? '#06202c' : 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: 3,
    cursor: 'pointer',
  });

  return (
    <div
      data-testid="baboon-studio-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 220,
      }}
    >
      <div
        style={{
          width: '92vw',
          maxWidth: 1260,
          height: '88vh',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 5,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 14px 48px rgba(0,0,0,0.65)',
          color: 'var(--text-primary)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '10px 16px',
            background: 'var(--bg-panel-header)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent-cyan)' }}>
              🏷️ Standard Blam Tag Workspace, Content Explorer &amp; HEK Suite
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              Uniform 64-byte &apos;blam&apos; loose tags • Dependency Graph &amp; Auto-Fix • tool.exe &amp; HaloScript Reference • Asset Libraries
            </span>
          </div>
          <button
            type="button"
            data-testid="baboon-studio-close"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 18, cursor: 'pointer' }}
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
            padding: '0 12px',
            gap: 6,
          }}
        >
          {(
            [
              { id: 'content-explorer', label: '🧭 Content Explorer, Auto-Fix & Folder Refactor' },
              { id: 'loose-workspace', label: '📂 Loose Blam tags/ Workspace & Git Review' },
              { id: 'tool-runner', label: '🛠️ Visual tool.exe Runner & HaloScript Reference' },
              { id: 'asset-libraries', label: '🖼️ Bitmap & 3D Model Library Grids' },
            ] as Array<{ id: BaboonStudioTab; label: string }>
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              data-testid={`baboon-tab-${t.id}`}
              onClick={() => setTab(t.id)}
              style={{
                padding: '8px 14px',
                fontSize: 12,
                fontWeight: 600,
                background: tab === t.id ? 'var(--bg-panel)' : 'transparent',
                border: 'none',
                borderBottom: tab === t.id ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                color: tab === t.id ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {statusBanner && (
          <div
            data-testid="baboon-studio-status"
            style={{
              padding: '7px 16px',
              fontSize: 11.5,
              background: 'rgba(56, 189, 248, 0.14)',
              borderBottom: '1px solid var(--border)',
              color: 'var(--accent-cyan)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>{statusBanner}</span>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}
            >
              ×
            </button>
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* TAB 1: CONTENT EXPLORER, AUTO-FIX & FOLDER REFACTOR */}
          {tab === 'content-explorer' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 14, gap: 12 }}>
              {/* Top Action Bar */}
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  padding: 10,
                  background: 'var(--bg-main)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                }}
              >
                <button
                  type="button"
                  disabled={explorerHistoryPos <= 0}
                  onClick={() => {
                    if (explorerHistoryPos > 0) {
                      const nextPos = explorerHistoryPos - 1;
                      setExplorerHistoryPos(nextPos);
                      setExplorerTagIndex(explorerHistory[nextPos]!);
                    }
                  }}
                  style={btnStyle()}
                >
                  ◀ Back
                </button>
                <button
                  type="button"
                  disabled={explorerHistoryPos >= explorerHistory.length - 1}
                  onClick={() => {
                    if (explorerHistoryPos < explorerHistory.length - 1) {
                      const nextPos = explorerHistoryPos + 1;
                      setExplorerHistoryPos(nextPos);
                      setExplorerTagIndex(explorerHistory[nextPos]!);
                    }
                  }}
                  style={btnStyle()}
                >
                  Forward ▶
                </button>

                <select
                  data-testid="content-explorer-tag-select"
                  value={explorerTagIndex}
                  onChange={(e) => navigateExplorerTo(Number(e.target.value))}
                  style={{
                    flex: 1,
                    minWidth: 240,
                    background: 'var(--bg-input, #1e1e1e)',
                    border: '1px solid var(--border)',
                    borderRadius: 3,
                    color: 'var(--text-primary)',
                    padding: '5px 8px',
                    fontSize: 12,
                    fontFamily: 'var(--mono-font)',
                  }}
                >
                  {allTags.map((t) => (
                    <option key={t.index} value={t.index}>
                      [{t.primaryClassName}] {t.path} (#{t.index})
                    </option>
                  ))}
                </select>

                <input
                  type="text"
                  placeholder="Filter parents/children..."
                  value={explorerSearch}
                  onChange={(e) => setExplorerSearch(e.target.value)}
                  style={{
                    width: 190,
                    background: 'var(--bg-input, #1e1e1e)',
                    border: '1px solid var(--border)',
                    borderRadius: 3,
                    color: 'var(--text-primary)',
                    padding: '5px 8px',
                    fontSize: 12,
                  }}
                />

                <button
                  type="button"
                  data-testid="auto-fix-map-deps-btn"
                  disabled={isBusy}
                  onClick={() => void handleAutoFixMapDeps()}
                  title="Scan all TagDependency fields in the map and auto-repair broken paths by matching unique (group, leaf_name)"
                  style={btnStyle(true)}
                >
                  🔧 Auto-Fix Broken Dependencies
                </button>
              </div>

              {/* Folder Move / Rename Refactor Bar */}
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  padding: '8px 12px',
                  background: 'rgba(56, 189, 248, 0.06)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  fontSize: 11.5,
                }}
              >
                <span style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>📁 Refactor / Move Folder Prefix:</span>
                <input
                  type="text"
                  value={oldFolderPrefix}
                  onChange={(e) => setOldFolderPrefix(e.target.value)}
                  placeholder="Old prefix (e.g. weapons\assault rifle)"
                  style={{
                    flex: 1,
                    background: 'var(--bg-input, #1e1e1e)',
                    border: '1px solid var(--border)',
                    borderRadius: 3,
                    color: 'var(--text-primary)',
                    padding: '4px 8px',
                    fontFamily: 'var(--mono-font)',
                    fontSize: 11.5,
                  }}
                />
                <span>→</span>
                <input
                  type="text"
                  value={newFolderPrefix}
                  onChange={(e) => setNewFolderPrefix(e.target.value)}
                  placeholder="New prefix (e.g. weapons\custom_ar)"
                  style={{
                    flex: 1,
                    background: 'var(--bg-input, #1e1e1e)',
                    border: '1px solid var(--border)',
                    borderRadius: 3,
                    color: 'var(--text-primary)',
                    padding: '4px 8px',
                    fontFamily: 'var(--mono-font)',
                    fontSize: 11.5,
                  }}
                />
                <button
                  type="button"
                  data-testid="refactor-map-folder-btn"
                  disabled={isBusy}
                  onClick={() => void handleRefactorMapFolder()}
                  style={btnStyle()}
                >
                  Apply Folder Refactor
                </button>
              </div>

              {/* Two-Column Parents vs Children Graph */}
              {explorerData ? (
                <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minHeight: 0 }}>
                  {/* Left: Referenced By (Parents) */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      background: 'var(--bg-main)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      minHeight: 0,
                    }}
                  >
                    <div
                      style={{
                        padding: '8px 12px',
                        background: 'var(--bg-panel-header)',
                        borderBottom: '1px solid var(--border)',
                        fontWeight: 600,
                        fontSize: 12,
                        color: '#4ade80',
                      }}
                    >
                      ⬆️ Referenced By (Parents — {explorerData.referencedByParents.length})
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {explorerData.referencedByParents
                        .filter(
                          (p) =>
                            !explorerSearch.trim() ||
                            p.tagPath.toLowerCase().includes(explorerSearch.toLowerCase()) ||
                            p.fieldPath.toLowerCase().includes(explorerSearch.toLowerCase()),
                        )
                        .map((parent, idx) => (
                          <div
                            key={`${parent.tagIndex}-${parent.fieldPath}-${idx}`}
                            style={{
                              padding: '7px 10px',
                              background: 'var(--bg-panel)',
                              border: '1px solid var(--border)',
                              borderRadius: 3,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: 8,
                            }}
                          >
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 11.5, fontFamily: 'var(--mono-font)', fontWeight: 600, wordBreak: 'break-all' }}>
                                [{parent.tagGroup}] {parent.tagPath}
                              </div>
                              <div style={{ fontSize: 10.5, color: 'var(--accent-cyan)', fontFamily: 'var(--mono-font)', marginTop: 2 }}>
                                Field: {parent.fieldPath}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button
                                type="button"
                                onClick={() => navigateExplorerTo(parent.tagIndex)}
                                style={{ ...btnStyle(), padding: '3px 7px', fontSize: 10.5 }}
                              >
                                Inspect
                              </button>
                              <button
                                type="button"
                                title="Jump to referencing tag and open Tag Editor"
                                onClick={() => {
                                  onSelectMapTag?.(parent.tagIndex, parent.fieldPath);
                                  onOpenTagEditor?.(parent.tagIndex);
                                  onClose();
                                }}
                                style={{ ...btnStyle(true), padding: '3px 8px', fontSize: 10.5 }}
                              >
                                Jump ↗
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>

                  {/* Right: References (Children) */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      background: 'var(--bg-main)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      minHeight: 0,
                    }}
                  >
                    <div
                      style={{
                        padding: '8px 12px',
                        background: 'var(--bg-panel-header)',
                        borderBottom: '1px solid var(--border)',
                        fontWeight: 600,
                        fontSize: 12,
                        color: '#38bdf8',
                      }}
                    >
                      ⬇️ Outgoing References (Children — {explorerData.referencesChildren.length})
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {explorerData.referencesChildren
                        .filter(
                          (c) =>
                            !explorerSearch.trim() ||
                            (c.targetPath ?? '').toLowerCase().includes(explorerSearch.toLowerCase()) ||
                            c.fieldPath.toLowerCase().includes(explorerSearch.toLowerCase()),
                        )
                        .map((child, idx) => (
                          <div
                            key={`${child.fieldPath}-${idx}`}
                            style={{
                              padding: '7px 10px',
                              background: 'var(--bg-panel)',
                              border: `1px solid ${child.isBroken ? '#ef4444' : 'var(--border)'}`,
                              borderRadius: 3,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: 8,
                            }}
                          >
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 10.5, color: 'var(--text-dim)', fontFamily: 'var(--mono-font)' }}>
                                {child.fieldPath}
                              </div>
                              <div
                                style={{
                                  fontSize: 11.5,
                                  fontFamily: 'var(--mono-font)',
                                  fontWeight: 600,
                                  color: child.isBroken ? '#f87171' : 'var(--text-primary)',
                                  wordBreak: 'break-all',
                                  marginTop: 2,
                                }}
                              >
                                {child.targetPath ? `[${child.targetGroup}] ${child.targetPath}` : '(Null / Broken Reference)'}
                              </div>
                            </div>
                            {child.targetTagIndex !== null && (
                              <button
                                type="button"
                                onClick={() => navigateExplorerTo(child.targetTagIndex!)}
                                style={{ ...btnStyle(), padding: '3px 7px', fontSize: 10.5 }}
                              >
                                Inspect →
                              </button>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)' }}>
                  Open an uncompressed .map file to inspect its bidirectional dependency graph.
                </div>
              )}
            </div>
          )}

          {/* TAB 2: LOOSE BLAM TAGS/ WORKSPACE & GIT REVIEW */}
          {tab === 'loose-workspace' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 14, gap: 12 }}>
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  padding: 10,
                  background: 'var(--bg-main)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                }}
              >
                <button
                  type="button"
                  data-testid="open-loose-workspace-btn"
                  onClick={() => void handleOpenLooseWorkspace()}
                  style={btnStyle(true)}
                >
                  📂 Open Standard Blam tags/ Folder...
                </button>
                {workspaceSnapshot && (
                  <>
                    <span style={{ fontSize: 11.5, fontFamily: 'var(--mono-font)', color: 'var(--text-secondary)' }}>
                      {workspaceSnapshot.tagsRootDir} ({workspaceSnapshot.totalFiles} tags)
                    </span>
                    <select
                      value={wsFilterMode}
                      onChange={(e) => setWsFilterMode(e.target.value as any)}
                      style={{
                        background: 'var(--bg-input, #1e1e1e)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                        padding: '4px 8px',
                        fontSize: 11.5,
                        borderRadius: 3,
                      }}
                    >
                      <option value="all">All Tags ({workspaceSnapshot.totalFiles})</option>
                      <option value="broken">Broken Refs ({workspaceSnapshot.brokenDependencyCount})</option>
                      <option value="unreferenced">Unreferenced ({workspaceSnapshot.unreferencedTagCount})</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Search loose tags..."
                      value={wsFilter}
                      onChange={(e) => setWsFilter(e.target.value)}
                      style={{
                        flex: 1,
                        background: 'var(--bg-input, #1e1e1e)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                        padding: '4px 8px',
                        fontSize: 11.5,
                        borderRadius: 3,
                      }}
                    />
                    <button type="button" onClick={() => void handleFixLooseWorkspaceDeps()} style={btnStyle()}>
                      🔧 Auto-Fix Workspace Dependencies
                    </button>
                  </>
                )}
              </div>

              {workspaceSnapshot ? (
                <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '360px 1fr', gap: 12, minHeight: 0 }}>
                  {/* Left: Loose Tags Tree + Git Status */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      background: 'var(--bg-main)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      minHeight: 0,
                    }}
                  >
                    <div
                      style={{
                        padding: '7px 10px',
                        background: 'var(--bg-panel-header)',
                        borderBottom: '1px solid var(--border)',
                        fontSize: 11.5,
                        fontWeight: 600,
                      }}
                    >
                      Loose 64-byte &apos;blam&apos; Tags ({filteredLooseTags.length})
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
                      {filteredLooseTags.map((entry) => (
                        <div
                          key={`${entry.relativePath}.${entry.groupName}`}
                          onClick={() => void handleSelectLooseTag(entry)}
                          style={{
                            padding: '5px 8px',
                            cursor: 'pointer',
                            borderRadius: 3,
                            background:
                              selectedLooseTag?.absolutePath === entry.absolutePath
                                ? 'rgba(56, 189, 248, 0.16)'
                                : 'transparent',
                            fontSize: 11,
                            fontFamily: 'var(--mono-font)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 6,
                          }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {entry.relativePath}.{entry.groupName}
                          </span>
                          <span style={{ color: entry.brokenReferences.length > 0 ? '#f87171' : 'var(--text-dim)', flexShrink: 0 }}>
                            {entry.brokenReferences.length > 0 ? `⚠️${entry.brokenReferences.length}` : `←${entry.referencedByCount}`}
                          </span>
                        </div>
                      ))}
                    </div>

                    {gitInfo?.isGitRepo && (
                      <div style={{ borderTop: '1px solid var(--border)', padding: 8, maxHeight: 170, overflowY: 'auto' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#fbbf24', marginBottom: 4 }}>
                          🌿 Git Review ({gitInfo.branch}) — {gitInfo.statusEntries.length} modified
                        </div>
                        {gitInfo.statusEntries.map((st) => (
                          <div
                            key={st.absolutePath}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              fontSize: 10.5,
                              fontFamily: 'var(--mono-font)',
                              padding: '2px 0',
                            }}
                          >
                            <span>
                              [{st.status}] {st.relativePath}.{st.groupName}
                            </span>
                            <button
                              type="button"
                              onClick={async () => {
                                if (typeof window.opence.diffGitLooseTag !== 'function') return;
                                const diffRes = await window.opence.diffGitLooseTag(
                                  workspaceSnapshot.tagsRootDir,
                                  st.absolutePath,
                                  'HEAD',
                                );
                                if (diffRes.ok) setGitDiffResult(diffRes);
                              }}
                              style={{ ...btnStyle(), padding: '1px 6px', fontSize: 10 }}
                            >
                              Diff HEAD
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Right: Loose Tag Inspector / In-Place Editor / Git Diff */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      background: 'var(--bg-main)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      minHeight: 0,
                      padding: 12,
                      overflowY: 'auto',
                      gap: 10,
                    }}
                  >
                    {gitDiffResult && (
                      <div
                        style={{
                          padding: 10,
                          background: 'rgba(245, 158, 11, 0.1)',
                          border: '1px solid rgba(245, 158, 11, 0.4)',
                          borderRadius: 4,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontWeight: 600, fontSize: 12, color: '#fbbf24' }}>
                            Semantic Blam Tag Diff vs HEAD: {gitDiffResult.relativePath}.{gitDiffResult.groupName} ({gitDiffResult.changedFieldsCount} field deltas)
                          </span>
                          <button type="button" onClick={() => setGitDiffResult(null)} style={btnStyle()}>
                            Close Diff
                          </button>
                        </div>
                        <div style={{ maxHeight: 160, overflowY: 'auto', fontFamily: 'var(--mono-font)', fontSize: 11 }}>
                          {gitDiffResult.fields.map((f, i) => (
                            <div key={i} style={{ padding: '2px 0' }}>
                              <strong>{f.fieldPath}</strong> ({f.status}):{' '}
                              <span style={{ color: '#f87171' }}>{f.leftValue ?? '—'}</span> →{' '}
                              <span style={{ color: '#4ade80' }}>{f.rightValue ?? '—'}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedLooseTag ? (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--mono-font)' }}>
                              {selectedLooseTag.relativePath}.{selectedLooseTag.groupName}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                              Header: {selectedLooseTag.header.layout} • Engine v{selectedLooseTag.header.engineTagId} • Version {selectedLooseTag.header.version} • Payload {selectedLooseTag.header.payloadLength.toLocaleString()} B
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              onClick={async () => {
                                if (typeof window.opence.dropTagToExternalWindow !== 'function') return;
                                const dropRes = await window.opence.dropTagToExternalWindow(selectedLooseTag.absolutePath);
                                if (dropRes.ok) {
                                  setStatusBanner(`Sent CF_HDROP for "${selectedLooseTag.relativePath}.${selectedLooseTag.groupName}" -> ${dropRes.targetWindowTitle}`);
                                }
                              }}
                              style={btnStyle()}
                              title="Copy Win32 CF_HDROP file drop list and bring Sapien/Guerilla to foreground"
                            >
                              🎯 Drop to Sapien / Guerilla
                            </button>
                          </div>
                        </div>

                        {/* Move / Rename Loose Tag Refactor */}
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Move/Rename Path:</span>
                          <input
                            type="text"
                            value={looseMovePathDraft}
                            onChange={(e) => setLooseMovePathDraft(e.target.value)}
                            style={{
                              flex: 1,
                              background: 'var(--bg-input, #1e1e1e)',
                              border: '1px solid var(--border)',
                              color: 'var(--text-primary)',
                              padding: '4px 8px',
                              fontSize: 11.5,
                              fontFamily: 'var(--mono-font)',
                              borderRadius: 3,
                            }}
                          />
                          <button type="button" onClick={() => void handleMoveLooseTag()} style={btnStyle(true)}>
                            Move &amp; Update References
                          </button>
                        </div>

                        {/* Loose Tag Scalar Fields Editor */}
                        <div style={{ fontSize: 11.5, fontWeight: 600, marginTop: 6 }}>
                          Direct 64-byte &apos;blam&apos; Tag Fields ({looseFields.length} root fields)
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {looseFields.slice(0, 60).map((f) => (
                            <div
                              key={f.name}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '5px 8px',
                                background: 'var(--bg-panel)',
                                border: '1px solid var(--border)',
                                borderRadius: 3,
                                fontSize: 11.5,
                                gap: 10,
                              }}
                            >
                              <span style={{ fontWeight: 600 }}>
                                {f.name} <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>({f.type})</span>
                              </span>
                              {f.kind === 'number' || f.kind === 'string' ? (
                                <input
                                  type={f.kind === 'number' ? 'number' : 'text'}
                                  defaultValue={String(f.value ?? '')}
                                  onBlur={async (e) => {
                                    const nextVal = f.kind === 'number' ? Number(e.target.value) : e.target.value;
                                    if (nextVal !== f.value && typeof window.opence.writeLooseTagField === 'function') {
                                      const res = await window.opence.writeLooseTagField(
                                        selectedLooseTag.absolutePath,
                                        selectedLooseTag.relativePath,
                                        f.name,
                                        nextVal,
                                      );
                                      if (res.ok) {
                                        setLooseFields(res.fields.fields);
                                        setStatusBanner(`Saved "${f.name}" directly to ${selectedLooseTag.relativePath}.${selectedLooseTag.groupName}`);
                                      }
                                    }
                                  }}
                                  style={{
                                    width: 180,
                                    background: 'var(--bg-input, #1e1e1e)',
                                    border: '1px solid var(--border)',
                                    color: 'var(--text-primary)',
                                    padding: '3px 6px',
                                    fontSize: 11,
                                    fontFamily: 'var(--mono-font)',
                                    borderRadius: 2,
                                  }}
                                />
                              ) : (
                                <span style={{ fontFamily: 'var(--mono-font)', color: 'var(--text-dim)', fontSize: 11 }}>
                                  {f.kind === 'reflexive'
                                    ? `${f.children?.length ?? f.reflexiveCount ?? 0} elements`
                                    : JSON.stringify(f.value)}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)' }}>
                        Select a loose Blam tag on the left to inspect and edit its 64-byte &apos;blam&apos; fields directly on disk.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-dim)' }}>
                  Click <strong>Open Standard Blam tags/ Folder...</strong> above to index any Halo Editing Kit <code>tags/</code> directory.
                </div>
              )}
            </div>
          )}

          {/* TAB 3: VISUAL TOOL.EXE COMMAND RUNNER & HALOSCRIPT REFERENCE */}
          {tab === 'tool-runner' && (
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minHeight: 0, padding: 14 }}>
              {/* Left: Visual tool.exe Command Runner */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  background: 'var(--bg-main)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: 12,
                  gap: 10,
                  overflowY: 'auto',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent-cyan)' }}>
                    🛠️ Built-In Native Tool Compiler &amp; Command Runner
                  </span>
                  <select
                    value={toolEngineFilter}
                    onChange={(e) => setToolEngineFilter(e.target.value)}
                    style={{
                      background: 'var(--bg-input, #1e1e1e)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                      padding: '3px 8px',
                      fontSize: 11.5,
                      borderRadius: 3,
                    }}
                  >
                    <option value="h1">Halo 1 / CE (tool.exe)</option>
                    <option value="h2">Halo 2 Vista / EK</option>
                    <option value="h3">Halo 3 / ODST EK</option>
                    <option value="hr">Halo: Reach EK</option>
                  </select>
                </div>

                {/* Execution Mode & HEK Working Directory */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    padding: '8px 10px',
                    background: 'rgba(56, 189, 248, 0.06)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-cyan)' }}>
                      Execution Engine:
                    </label>
                    <select
                      data-testid="tool-execution-mode-select"
                      value={toolExecutionMode}
                      onChange={(e) => setToolExecutionMode(e.target.value as 'native' | 'external_exe')}
                      style={{
                        flex: 1,
                        background: 'var(--bg-input, #1e1e1e)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                        padding: '4px 8px',
                        fontSize: 11.5,
                        borderRadius: 3,
                      }}
                    >
                      <option value="native">
                        ⚡ Built-In Native Mantle Tool Compiler (Default — No tool.exe Required)
                      </option>
                      <option value="external_exe">
                        🖥️ External HEK tool.exe Binary (Optional Fallback)
                      </option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <label style={{ fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                      HEK Root Dir:
                    </label>
                    <input
                      type="text"
                      placeholder="Folder containing data\, tags\, maps\ (defaults to current workspace)"
                      value={toolWorkingDir}
                      onChange={(e) => setToolWorkingDir(e.target.value)}
                      style={{
                        flex: 1,
                        background: 'var(--bg-input, #1e1e1e)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                        padding: '4px 8px',
                        fontSize: 11,
                        fontFamily: 'var(--mono-font)',
                        borderRadius: 3,
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>Select Tool Verb ({toolCommands.length} commands):</label>
                  <select
                    data-testid="tool-verb-select"
                    value={selectedVerb}
                    onChange={(e) => {
                      setSelectedVerb(e.target.value);
                      setToolArgsDraft({});
                    }}
                    style={{
                      background: 'var(--bg-input, #1e1e1e)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                      padding: '5px 8px',
                      fontSize: 12,
                      fontFamily: 'var(--mono-font)',
                      borderRadius: 3,
                    }}
                  >
                    {toolCommands.map((cmd) => (
                      <option key={cmd.verb} value={cmd.verb}>
                        [{cmd.category}] {cmd.verb}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedToolCmd && (
                  <>
                    <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                      {selectedToolCmd.description}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {selectedToolCmd.args.map((arg) => (
                        <div key={arg.name} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <label style={{ fontSize: 11, fontWeight: 600 }}>
                            {arg.name} <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>({arg.type}) — {arg.description}</span>
                          </label>
                          {arg.options && arg.options.length > 0 ? (
                            <select
                              value={toolArgsDraft[arg.name] ?? arg.options[0]}
                              onChange={(e) => setToolArgsDraft((prev) => ({ ...prev, [arg.name]: e.target.value }))}
                              style={{
                                background: 'var(--bg-input, #1e1e1e)',
                                border: '1px solid var(--border)',
                                color: 'var(--text-primary)',
                                padding: '4px 8px',
                                fontSize: 11.5,
                                borderRadius: 3,
                              }}
                            >
                              {arg.options.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              placeholder={arg.name}
                              value={toolArgsDraft[arg.name] ?? ''}
                              onChange={(e) => setToolArgsDraft((prev) => ({ ...prev, [arg.name]: e.target.value }))}
                              style={{
                                background: 'var(--bg-input, #1e1e1e)',
                                border: '1px solid var(--border)',
                                color: 'var(--text-primary)',
                                padding: '4px 8px',
                                fontSize: 11.5,
                                fontFamily: 'var(--mono-font)',
                                borderRadius: 3,
                              }}
                            />
                          )}
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      data-testid="run-tool-exe-btn"
                      disabled={isBusy}
                      onClick={() => void handleRunToolCommand()}
                      style={{ ...btnStyle(true), alignSelf: 'flex-start', marginTop: 4 }}
                    >
                      {toolExecutionMode === 'native'
                        ? `⚡ Compile Natively: tool ${selectedToolCmd.verb}`
                        : `▶ Execute External tool.exe ${selectedToolCmd.verb}`}
                    </button>
                  </>
                )}

                {toolOutput && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: 10,
                      background: '#090d16',
                      border: '1px solid var(--border)',
                      borderRadius: 3,
                      fontFamily: 'var(--mono-font)',
                      fontSize: 11,
                      whiteSpace: 'pre-wrap',
                      maxHeight: 220,
                      overflowY: 'auto',
                    }}
                  >
                    <div style={{ color: 'var(--accent-cyan)', marginBottom: 4 }}>
                      Exit Code: {String(toolOutput.exitCode)}
                    </div>
                    {toolOutput.stdout}
                    {toolOutput.stderr && <div style={{ color: '#f87171' }}>{toolOutput.stderr}</div>}
                    {toolOutput.debugTxtTail && (
                      <div style={{ marginTop: 6, borderTop: '1px solid #334155', paddingTop: 6, color: '#fbbf24' }}>
                        <strong>debug.txt tail:</strong>
                        {'\n'}
                        {toolOutput.debugTxtTail}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Right: Multi-Engine HaloScript Reference Database */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  background: 'var(--bg-main)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: 12,
                  gap: 10,
                  minHeight: 0,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: '#4ade80' }}>
                    📜 Multi-Engine HaloScript Reference ({hsDocs.length})
                  </span>
                  <select
                    value={hsEngineFilter}
                    onChange={(e) => setHsEngineFilter(e.target.value)}
                    style={{
                      background: 'var(--bg-input, #1e1e1e)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                      padding: '3px 8px',
                      fontSize: 11.5,
                      borderRadius: 3,
                    }}
                  >
                    <option value="all">All Halo Engines</option>
                    <option value="h1">Halo 1 / CE</option>
                    <option value="h2">Halo 2</option>
                    <option value="h3">Halo 3 / ODST</option>
                    <option value="hr">Halo: Reach</option>
                  </select>
                </div>

                <input
                  type="text"
                  data-testid="hs-reference-search"
                  placeholder="Search HaloScript functions & globals (e.g. object_create, ai_place, camera_set, sleep_until)..."
                  value={hsQuery}
                  onChange={(e) => setHsQuery(e.target.value)}
                  style={{
                    background: 'var(--bg-input, #1e1e1e)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    padding: '5px 8px',
                    fontSize: 12,
                    fontFamily: 'var(--mono-font)',
                    borderRadius: 3,
                  }}
                />

                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {hsDocs.map((doc) => (
                    <div
                      key={`${doc.kind}-${doc.name}`}
                      style={{
                        padding: '8px 10px',
                        background: 'var(--bg-panel)',
                        border: '1px solid var(--border)',
                        borderRadius: 3,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <code style={{ fontSize: 11.5, color: 'var(--accent-cyan)', fontWeight: 600 }}>
                          {(doc as any).signature || doc.usage}
                        </code>
                        <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--mono-font)' }}>
                          {doc.kind.toUpperCase()} → {doc.returnType} [{doc.engines.join(', ')}]
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                        {doc.description}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: BITMAP & 3D MODEL LIBRARY GRIDS */}
          {tab === 'asset-libraries' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 14, gap: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => setLibraryKind('bitmap')}
                  style={btnStyle(libraryKind === 'bitmap')}
                >
                  🖼️ Bitmap Library ({allTags.filter((t) => t.primaryClassName === 'bitmap').length})
                </button>
                <button
                  type="button"
                  onClick={() => setLibraryKind('gbxmodel')}
                  style={btnStyle(libraryKind === 'gbxmodel')}
                >
                  🧊 3D Model Library ({allTags.filter((t) => t.primaryClassName === 'gbxmodel' || t.primaryClassName === 'model').length})
                </button>
                <input
                  type="text"
                  placeholder={`Search ${libraryKind} tags...`}
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                  style={{
                    flex: 1,
                    background: 'var(--bg-input, #1e1e1e)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    padding: '5px 8px',
                    fontSize: 12,
                    borderRadius: 3,
                  }}
                />
              </div>

              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))',
                  gap: 10,
                  padding: 4,
                }}
              >
                {libraryTags.map((t) => (
                  <div
                    key={t.index}
                    onMouseEnter={() => {
                      if (libraryKind === 'bitmap') void loadBitmapThumb(t);
                    }}
                    style={{
                      background: 'var(--bg-main)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      padding: 8,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        height: 96,
                        background: '#090d16',
                        borderRadius: 3,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                      }}
                    >
                      {libraryKind === 'bitmap' && bitmapThumbs[t.index] ? (
                        <img
                          src={bitmapThumbs[t.index]}
                          alt={t.path}
                          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                        />
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                          {libraryKind === 'bitmap' ? 'Hover to decode preview' : '🧊 3D Model Asset'}
                        </span>
                      )}
                    </div>
                    <div
                      title={t.path}
                      style={{
                        fontSize: 10.5,
                        fontFamily: 'var(--mono-font)',
                        wordBreak: 'break-all',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {t.path}
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectMapTag?.(t.index);
                          onClose();
                        }}
                        style={{ ...btnStyle(), flex: 1, padding: '3px 6px', fontSize: 10.5 }}
                      >
                        Select
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onOpenTagEditor?.(t.index);
                          onClose();
                        }}
                        style={{ ...btnStyle(true), flex: 1, padding: '3px 6px', fontSize: 10.5 }}
                      >
                        Open Editor
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
