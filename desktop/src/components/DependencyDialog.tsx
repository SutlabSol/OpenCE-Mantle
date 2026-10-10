import { forwardRef, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import type { DependencyWalkSummary, DependencyWarningKind, ExtractTagsResult } from '../../electron/shared-types';
import { VirtualTagList } from './VirtualTagList';
import { WarningGroup } from './WarningGroup';

type Phase = 'loading' | 'deps-error' | 'list' | 'extracting' | 'result' | 'extract-error';

interface Props {
  selectedIndices: number[];
  onClose: () => void;
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

type WarningGroupId = 'uncaptured' | 'embedded' | 'invalidLayout' | 'external' | 'uncertain' | 'unresolved' | 'other';

/**
 * Display order + severity. Severity mirrors what core actually does with each kind (see
 * `tag-injector.ts`): uncapturedData and extractionFailed block ADD/SWAP unconditionally,
 * embeddedRawData blocks ADD/SWAP while embedded relocation is disabled, invalidReflexive stops
 * the walker AND blocks ADD/SWAP unconditionally (the extractor leaves that reflexive's pointer
 * unrelocated and records a per-tag blocker in the container).
 */
const WARNING_GROUPS: { id: WarningGroupId; title: string; severity: 'blocking' | 'info' }[] = [
  { id: 'uncaptured', title: 'Cannot be captured / blocked for injection', severity: 'blocking' },
  { id: 'embedded', title: 'Embedded data (injection blocked while embedded relocation is disabled)', severity: 'blocking' },
  { id: 'invalidLayout', title: 'Invalid / corrupt layout (not walked, blocked for injection)', severity: 'blocking' },
  { id: 'external', title: 'External data', severity: 'info' },
  { id: 'uncertain', title: 'Undefined/uncertain groups', severity: 'info' },
  { id: 'unresolved', title: 'Unresolved references', severity: 'info' },
  { id: 'other', title: 'Other warnings', severity: 'info' },
];

/** Exhaustive over core's WARNING_KINDS - a new kind in core fails `yarn typecheck` until it's mapped here. */
const GROUP_BY_KIND: Record<DependencyWarningKind, WarningGroupId> = {
  uncapturedData: 'uncaptured',
  extractionFailed: 'uncaptured',
  embeddedRawData: 'embedded',
  invalidReflexive: 'invalidLayout',
  externalTag: 'external',
  externalData: 'external',
  uncertainGroup: 'uncertain',
  noDefinition: 'uncertain',
  bspTag: 'unresolved',
};

/** Unknown kinds (e.g. from a mismatched worker build) land in "Other warnings" rather than vanishing. */
function warningGroupOf(kind: string): WarningGroupId {
  return (GROUP_BY_KIND as Record<string, WarningGroupId>)[kind] ?? 'other';
}

function suggestedFileName(summary: DependencyWalkSummary, selectedIndices: number[]): string {
  const all = [...summary.extractableTags, ...summary.notExtractedTags];
  const first = all.find((t) => t.originalIndex === selectedIndices[0]);
  const base = (first?.path.split('\\').pop() ?? 'extracted_tags').replace(/[^a-z0-9_-]+/gi, '_') || 'extracted_tags';
  return selectedIndices.length > 1 ? `${base}_and_${selectedIndices.length - 1}_more` : base;
}

/**
 * M4 dependency + extraction dialog. Two-step flow: (1) read-only `getDependencies` walk shown
 * here with grouped warnings, (2) on confirm, `extractTags` re-walks in main and shows the
 * native Save As dialog - this component never picks a path itself.
 */
export default function DependencyDialog({ selectedIndices, onClose, log }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [summary, setSummary] = useState<DependencyWalkSummary | null>(null);
  const [depsError, setDepsError] = useState('');
  const [understand, setUnderstand] = useState(false);
  const [search, setSearch] = useState('');
  const [progress, setProgress] = useState<{ stage: string; percent: number } | null>(null);
  const [result, setResult] = useState<ExtractTagsResult | null>(null);
  const [extractErrorMessage, setExtractErrorMessage] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const selectionKey = selectedIndices.join(',');

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    window.opence.getDependencies(selectedIndices).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setSummary(res.summary);
        setPhase('list');
      } else {
        setDepsError(res.message);
        setPhase('deps-error');
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  useEffect(() => window.opence.onProgress((e) => {
    if (e.taskId === 'extract') setProgress({ stage: e.stage, percent: e.percent });
  }), []);

  useEffect(() => {
    dialogRef.current?.focus();
  }, [phase]);

  const handleCancelExtraction = () => window.opence.cancelExtraction();

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (phase === 'extracting') handleCancelExtraction();
      else onClose();
      return;
    }
    if (e.key === 'Tab' && dialogRef.current) {
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex]:not([tabindex="-1"])');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const handleConfirm = async () => {
    if (!summary) return;
    setPhase('extracting');
    setProgress({ stage: 'Starting', percent: 0 });
    const fileName = suggestedFileName(summary, selectedIndices);
    const res = await window.opence.extractTags({ originalIndices: selectedIndices, suggestedFileName: fileName });
    if (res.ok) {
      setResult(res);
      setPhase('result');
    } else if (res.code === 'CANCELLED') {
      log('warn', 'Extraction cancelled - no file was written.');
      setPhase('list');
    } else {
      setExtractErrorMessage(res.message);
      setPhase('extract-error');
    }
  };

  const copyWarnings = () => {
    if (!summary) return;
    const lines = [
      ...summary.notExtractedTags.map((t) => `NOT EXTRACTED: "${t.path}" (${t.group}) - ${t.reason}`),
      ...summary.warnings.map((w) => `${w.kind.toUpperCase()}: ${w.message}`),
    ];
    navigator.clipboard?.writeText(lines.join('\n')).catch(() => {});
  };

  if (phase === 'loading') {
    return (
      <Overlay>
        <DialogShell testid="dependency-dialog" ref={dialogRef} onKeyDown={handleKeyDown} onClose={onClose}>
          <div data-testid="dependency-dialog-loading" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
            Walking dependencies for {selectedIndices.length} tag(s)...
          </div>
        </DialogShell>
      </Overlay>
    );
  }

  if (phase === 'deps-error') {
    return (
      <Overlay>
        <DialogShell testid="dependency-dialog" ref={dialogRef} onKeyDown={handleKeyDown} onClose={onClose}>
          <div data-testid="dependency-dialog-error" style={{ padding: 20 }}>
            <div style={{ color: 'var(--error-text)', marginBottom: 10 }}>Couldn&apos;t walk dependencies.</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{depsError}</div>
          </div>
        </DialogShell>
      </Overlay>
    );
  }

  if (!summary) return null;

  if (phase === 'extracting') {
    return (
      <Overlay>
        <DialogShell testid="dependency-dialog" ref={dialogRef} onKeyDown={handleKeyDown} onClose={onClose}>
          <div data-testid="dependency-progress" style={{ padding: 24 }}>
            <div style={{ marginBottom: 10, fontSize: 12.5, color: 'var(--text-secondary)' }}>{progress?.stage ?? 'Extracting...'}</div>
            <div style={{ height: 8, background: 'var(--bg-main)', border: '1px solid var(--border)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress?.percent ?? 0}%`, background: 'var(--accent-cyan)', transition: 'width 0.2s' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button data-testid="dependency-cancel-button" onClick={handleCancelExtraction} style={buttonStyle()}>
                Cancel
              </button>
            </div>
          </div>
        </DialogShell>
      </Overlay>
    );
  }

  if (phase === 'result' && result?.ok) {
    return (
      <Overlay>
        <DialogShell testid="dependency-dialog" ref={dialogRef} onKeyDown={handleKeyDown} onClose={onClose}>
          <div data-testid="dependency-result" style={{ padding: 20 }}>
            <div style={{ color: 'var(--success-text)', marginBottom: 10, fontSize: 13 }}>
              Extracted {result.tagCount} tag(s) ({formatSize(result.fileSizeBytes)}).
            </div>
            <div style={{ fontSize: 12, fontFamily: 'var(--mono-font)', color: 'var(--text-secondary)', wordBreak: 'break-all', marginBottom: 14 }}>{result.outputPath}</div>
            {result.carriedOverWarnings.length > 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--warn-text)', marginBottom: 14 }}>{result.carriedOverWarnings.length} warning(s) carried over - see the log panel.</div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button data-testid="dependency-result-open-folder" onClick={() => window.opence.openContainingFolder(result.outputPath)} style={buttonStyle()}>
                Open containing folder
              </button>
              <button data-testid="dependency-result-close" onClick={onClose} style={buttonStyle(true)}>
                Close
              </button>
            </div>
          </div>
        </DialogShell>
      </Overlay>
    );
  }

  if (phase === 'extract-error') {
    return (
      <Overlay>
        <DialogShell testid="dependency-dialog" ref={dialogRef} onKeyDown={handleKeyDown} onClose={onClose}>
          <div data-testid="dependency-extract-error" style={{ padding: 20 }}>
            <div style={{ color: 'var(--error-text)', marginBottom: 10 }}>Extraction failed.</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 16 }}>{extractErrorMessage}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button data-testid="dependency-extract-error-back" onClick={() => setPhase('list')} style={buttonStyle()}>
                Back
              </button>
            </div>
          </div>
        </DialogShell>
      </Overlay>
    );
  }

  // phase === 'list'
  const hasSeriousWarnings = summary.notExtractedTags.length > 0 || summary.warnings.length > 0;
  const nothingExtractable = summary.allExcluded || summary.extractableTags.length === 0;
  const q = search.trim().toLowerCase();
  const visibleTags = q ? summary.extractableTags.filter((t) => t.path.toLowerCase().includes(q) || t.group.toLowerCase().includes(q)) : summary.extractableTags;

  let confirmDisabledReason = '';
  if (nothingExtractable) confirmDisabledReason = "Nothing here can be extracted (only scenario_structure_bsp tags, which aren't supported yet).";
  else if (hasSeriousWarnings && !understand) confirmDisabledReason = 'Check "I understand" below to confirm you have read the warnings.';

  return (
    <Overlay>
      <DialogShell testid="dependency-dialog" ref={dialogRef} onKeyDown={handleKeyDown} onClose={onClose} wide>
        <div data-testid="dependency-dialog-summary" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 12.5, color: 'var(--text-secondary)' }}>
          {summary.extractableTags.length} tag(s) extractable - {formatSize(summary.totalEstimatedSize)} - {summary.notExtractedTags.length + summary.warnings.length} warning(s)
        </div>

        <div style={{ padding: '10px 16px', maxHeight: 420, overflowY: 'auto' }}>
          <WarningGroup
            title="Not extracted"
            severity="blocking"
            items={summary.notExtractedTags.map((t) => ({ key: `${t.originalIndex}`, text: `"${t.path}" (${t.group}) - ${t.reason}` }))}
          />
          {WARNING_GROUPS.map((g) => (
            <WarningGroup
              key={g.id}
              title={g.title}
              severity={g.severity}
              items={summary.warnings.filter((w) => warningGroupOf(w.kind) === g.id).map((w, i) => ({ key: `${g.id}-${i}`, text: w.message }))}
            />
          ))}

          <div style={{ display: 'flex', gap: 8, marginBottom: 8, marginTop: 10 }}>
            <input
              data-testid="dependency-search-input"
              placeholder="Search path or group..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, background: 'var(--bg-main)', border: '1px solid var(--border)', borderRadius: 2, padding: '5px 8px', color: 'var(--text-primary)', fontSize: 12 }}
            />
            <button data-testid="dependency-copy-warnings-button" onClick={copyWarnings} style={buttonStyle()}>
              Copy warnings
            </button>
          </div>

          <VirtualTagList rows={visibleTags} />
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          {hasSeriousWarnings && !nothingExtractable && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
              <input data-testid="dependency-understand-checkbox" type="checkbox" checked={understand} onChange={(e) => setUnderstand(e.target.checked)} />
              I understand some tags/data will not be extracted or resolved this milestone.
            </label>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button data-testid="dependency-dialog-cancel" onClick={onClose} style={buttonStyle()}>
              Cancel
            </button>
            <button
              data-testid="dependency-confirm-button"
              disabled={!!confirmDisabledReason}
              title={confirmDisabledReason || undefined}
              onClick={handleConfirm}
              style={buttonStyle(!confirmDisabledReason)}
            >
              Choose location and extract
            </button>
          </div>
          {confirmDisabledReason && (
            <div data-testid="dependency-confirm-disabled-reason" style={{ marginTop: 6, fontSize: 11, color: 'var(--text-dim)', textAlign: 'right' }}>
              {confirmDisabledReason}
            </div>
          )}
        </div>
      </DialogShell>
    </Overlay>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      {children}
    </div>
  );
}

const DialogShell = forwardRef<HTMLDivElement, { testid: string; children: ReactNode; onKeyDown: (e: KeyboardEvent) => void; onClose: () => void; wide?: boolean }>(
  ({ testid, children, onKeyDown, onClose, wide }, ref) => (
    <div
      ref={ref}
      data-testid={testid}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{
        width: wide ? 640 : 420,
        maxHeight: '85vh',
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'var(--bg-panel-header)', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Extract Tags</span>
        <button data-testid="dependency-dialog-close" onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 16, lineHeight: 1 }}>
          ×
        </button>
      </div>
      {children}
    </div>
  ),
);

function buttonStyle(primary = false): CSSProperties {
  return {
    background: primary ? 'var(--accent-cyan)' : 'var(--bg-panel-header)',
    color: primary ? '#06202c' : 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: 2,
    padding: '6px 14px',
    fontSize: 12,
  };
}
