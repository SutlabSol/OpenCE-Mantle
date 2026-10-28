import { forwardRef, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import type { InjectPlanSummary, ApplyInjectResult, InjectionMode } from '../../electron/shared-types';
import { WarningGroup } from './WarningGroup';
import { buildInjectWarningReport } from './injectWarningReport';

type Phase = 'choose-mode' | 'picking' | 'planning' | 'plan-error' | 'review' | 'applying' | 'result' | 'apply-error';

interface Props {
  onClose: () => void;
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
}

/**
 * Milestone 5, Step A + B: ADD and SWAP mode tag injection. User first picks the mode for the
 * whole operation (per-tag choice is Step C's conflict dialog, not built yet), then a `.ocetags`
 * container (never a path typed in, always the native file dialog, in main.ts); this dialog shows
 * the dry-run plan (reused/swapped/added/blocked/external-reference warnings). Confirming applies
 * it to the open map IN MEMORY only (the map is then marked modified); nothing is written to disk
 * until File > Save or File > Save As.
 */
export default function InjectDialog({ onClose, log }: Props) {
  const [phase, setPhase] = useState<Phase>('choose-mode');
  const [mode, setMode] = useState<InjectionMode>('add');
  const [plan, setPlan] = useState<InjectPlanSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [understand, setUnderstand] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyInjectResult | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [totals, setTotals] = useState({ added: 0, swapped: 0, reused: 0 });
  const dialogRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  const startPicking = (chosenMode: InjectionMode) => {
    setMode(chosenMode);
    setPhase('picking');
  };

  useEffect(() => {
    if (phase !== 'picking' || startedRef.current) return;
    startedRef.current = true;
    (async () => {
      const picked = await window.opence.pickInjectContainer();
      if (!picked) {
        onClose();
        return;
      }
      const paths = picked.paths?.length ? picked.paths : [picked.path];
      setQueue(paths);
      setQueueIndex(0);
      setTotals({ added: 0, swapped: 0, reused: 0 });
      setPhase('planning');
      const res = await window.opence.planInject(paths[0], mode);
      if (res.ok) {
        setPlan(res.plan);
        setPhase('review');
      } else {
        setErrorMessage(res.message);
        setPhase('plan-error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, [phase]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  const handleConfirm = async () => {
    setPhase('applying');
    const res = await window.opence.applyInject();
    setApplyResult(res);
    if (res.ok) {
      const newTotals = {
        added: totals.added + res.addedCount,
        swapped: totals.swapped + res.swappedCount,
        reused: totals.reused + res.reusedCount,
      };
      if (queue.length > 1) {
        // A multi-container batch is reported only when it finishes; per-container progress keeps running in memory.
        setTotals(newTotals);
        log('info', `Injected container ${queueIndex + 1} of ${queue.length}: ${res.addedCount} added, ${res.swappedCount} swapped (${res.reusedCount} reused) - in memory, not saved yet.`);
        if (queueIndex + 1 < queue.length) {
          const nextIndex = queueIndex + 1;
          setQueueIndex(nextIndex);
          setPhase('planning');
          const nextRes = await window.opence.planInject(queue[nextIndex], mode);
          if (nextRes.ok) {
            setPlan(nextRes.plan);
            setPhase('review');
          } else {
            setErrorMessage(nextRes.message);
            setPhase('plan-error');
          }
          return;
        }
        log('info', `Injected ${queue.length} containers into the open map (in memory, not saved yet).`);
      } else {
        log('info', `Injected ${res.addedCount} tag(s), swapped ${res.swappedCount} (${res.reusedCount} reused) into the open map (in memory, not saved yet).`);
      }
      setPhase('result');
    } else {
      setErrorMessage(res.message);
      setPhase('apply-error');
    }
  };

  if (phase === 'choose-mode') {
    return (
      <Overlay>
        <DialogShell testid="inject-dialog" ref={dialogRef} onKeyDown={handleKeyDown} onClose={onClose}>
          <div style={{ padding: 20 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Choose how this whole operation should treat container tags that already exist (by path) in the target map.
            </div>
            <button
              data-testid="inject-mode-add"
              onClick={() => startPicking('add')}
              style={{ ...buttonStyle(), display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', marginBottom: 10 }}
            >
              <div style={{ fontWeight: 600, marginBottom: 3 }}>Add new tags</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Only genuinely new tags are written. A tag that already exists in the target is left untouched (reused), never duplicated.</div>
            </button>
            <button
              data-testid="inject-mode-swap"
              onClick={() => startPicking('swap')}
              style={{ ...buttonStyle(), display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px' }}
            >
              <div style={{ fontWeight: 600, marginBottom: 3 }}>Swap into existing tags</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                A tag that already exists in the target has its content REPLACED in place (same tagId, so existing placements/references pick it up immediately). New tags are still added.
              </div>
            </button>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button data-testid="inject-mode-cancel" onClick={onClose} style={buttonStyle()}>
                Cancel
              </button>
            </div>
          </div>
        </DialogShell>
      </Overlay>
    );
  }

  if (phase === 'picking' || phase === 'planning') {
    return (
      <Overlay>
        <DialogShell testid="inject-dialog" ref={dialogRef} onKeyDown={handleKeyDown} onClose={onClose}>
          <div data-testid="inject-dialog-loading" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
            {phase === 'picking' ? 'Waiting for file selection...' : 'Planning injection...'}
          </div>
        </DialogShell>
      </Overlay>
    );
  }

  if (phase === 'plan-error') {
    return (
      <Overlay>
        <DialogShell testid="inject-dialog" ref={dialogRef} onKeyDown={handleKeyDown} onClose={onClose}>
          <div data-testid="inject-dialog-plan-error" style={{ padding: 20 }}>
            <div style={{ color: 'var(--error-text)', marginBottom: 10 }}>Couldn&apos;t plan this injection.</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 16 }}>{errorMessage}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button data-testid="inject-dialog-plan-error-close" onClick={onClose} style={buttonStyle()}>
                Close
              </button>
            </div>
          </div>
        </DialogShell>
      </Overlay>
    );
  }

  if (!plan) return null;

  if (phase === 'applying') {
    return (
      <Overlay>
        <DialogShell testid="inject-dialog" ref={dialogRef} onKeyDown={handleKeyDown} onClose={onClose}>
          <div data-testid="inject-progress" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
            Applying to the open map (in memory)...
          </div>
        </DialogShell>
      </Overlay>
    );
  }

  if (phase === 'result' && applyResult?.ok) {
    return (
      <Overlay>
        <DialogShell testid="inject-dialog" ref={dialogRef} onKeyDown={handleKeyDown} onClose={onClose}>
          <div data-testid="inject-result" style={{ padding: 20 }}>
            <div style={{ color: 'var(--success-text)', marginBottom: 10, fontSize: 13 }}>
              {queue.length > 1
                ? `Injected ${queue.length} containers into the open map (${totals.added} added, ${totals.swapped} swapped, ${totals.reused} reused)`
                : `Injected ${applyResult.addedCount} tag(s), swapped ${applyResult.swappedCount} (${applyResult.reusedCount} reused, not duplicated).`}
            </div>
            <div data-testid="inject-result-in-memory" style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14 }}>
              The open map now has {applyResult.map.header.tagCount.toLocaleString()} tags. Changes are in memory - nothing has been written to disk yet. Use File &gt; Save or File &gt;
              Save As to write the map.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button data-testid="inject-result-close" onClick={onClose} style={buttonStyle(true)}>
                Close
              </button>
            </div>
          </div>
        </DialogShell>
      </Overlay>
    );
  }

  if (phase === 'apply-error') {
    return (
      <Overlay>
        <DialogShell testid="inject-dialog" ref={dialogRef} onKeyDown={handleKeyDown} onClose={onClose}>
          <div data-testid="inject-apply-error" style={{ padding: 20 }}>
            <div style={{ color: 'var(--error-text)', marginBottom: 10 }}>Injection failed - the open map is unchanged.</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 16 }}>{errorMessage}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button data-testid="inject-apply-error-back" onClick={() => setPhase('review')} style={buttonStyle()}>
                Back
              </button>
            </div>
          </div>
        </DialogShell>
      </Overlay>
    );
  }

  const copyWarningReport = () => {
    if (!plan) return;
    navigator.clipboard?.writeText(buildInjectWarningReport(plan)).catch(() => {});
  };

  // phase === 'review'
  const hasBlocking = plan.refusedRoots.length > 0;
  const hasMismatch = plan.externalRefStatuses.some((r) => r.status === 'mismatch');
  const hasClassConflict = (plan.classConflicts?.length ?? 0) > 0;
  const needsAck =
    hasBlocking ||
    plan.blockedEmbedded.length > 0 ||
    plan.blockedOther.length > 0 ||
    hasMismatch ||
    hasClassConflict;
  const nothingToAdd = plan.counts.added === 0 && plan.counts.reused === 0 && plan.counts.swapped === 0;

  let confirmDisabledReason = '';
  if (nothingToAdd) confirmDisabledReason = 'Nothing from this container can be added or swapped into the target map.';
  else if (needsAck && !understand) confirmDisabledReason = 'Check "I understand" below to confirm you have read the warnings.';

  return (
    <Overlay>
      <DialogShell testid="inject-dialog" ref={dialogRef} onKeyDown={handleKeyDown} onClose={onClose} wide>
        {queue.length > 1 && (
          <div data-testid="inject-container-step" style={{ padding: '8px 16px 0', fontSize: 11.5, color: 'var(--text-secondary)' }}>
            Container {queueIndex + 1} of {queue.length}: <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono, monospace)' }}>{queue[queueIndex].split(/[/\\]/).pop()}</span>
          </div>
        )}
        <div data-testid="inject-dialog-summary" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 12.5, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span>
            From &quot;{plan.sourceMapName}&quot; ({plan.mode === 'swap' ? 'swap mode' : 'add mode'}): {plan.counts.added} to add, {plan.counts.swapped} to swap, {plan.counts.reused} reused,{' '}
            {plan.counts.blockedEmbedded + plan.counts.blockedOther} blocked
          </span>
          <button data-testid="inject-copy-warning-report-button" onClick={copyWarningReport} style={{ ...buttonStyle(), flexShrink: 0 }}>
            Copy warning report
          </button>
        </div>

        <div style={{ padding: '10px 16px', maxHeight: 420, overflowY: 'auto' }}>
          <WarningGroup
            title="Refused (root selection)"
            severity="blocking"
            items={plan.refusedRoots.map((r, i) => ({ key: `root-${i}`, text: `"${r.path}"`, detail: r.reasons }))}
          />
          <WarningGroup
            title="Blocked - embedded data (relocation disabled)"
            severity="blocking"
            items={plan.blockedEmbedded.map((b, i) => ({ key: `emb-${i}`, text: `"${b.path}" (${b.group})`, detail: b.reasons }))}
          />
          <WarningGroup
            title="Blocked - other"
            severity="blocking"
            items={plan.blockedOther.map((b, i) => ({ key: `oth-${i}`, text: `"${b.path}" (${b.group})`, detail: b.reasons }))}
          />
          <WarningGroup
            title="Same-path / different-class conflicts in target map"
            severity="blocking"
            items={(plan.classConflicts ?? []).map((c, i) => ({
              key: `cls-${i}`,
              text: `"${c.path}" is (${c.containerGroup}) in container, but already exists as (${c.targetGroup}) in target`,
            }))}
          />
          <WarningGroup
            title="External resource map references"
            severity={hasMismatch ? 'blocking' : 'info'}
            items={plan.externalRefStatuses.map((r, i) => ({
              key: `ext-${i}`,
              text: `"${r.path}" needs ${r.resourceMap} - ${describeRefStatus(r.status)}`,
            }))}
          />
          <WarningGroup title="Will be swapped (keeps existing tagId)" severity="info" items={plan.toSwap.map((t, i) => ({ key: `swap-${i}`, text: `"${t.path}" (${t.group})` }))} />
          <WarningGroup title="Will be added" severity="info" items={plan.toAdd.map((t, i) => ({ key: `add-${i}`, text: `"${t.path}" (${t.group})` }))} />
          <WarningGroup title="Reused (unchanged in target)" severity="info" items={plan.reused.map((t, i) => ({ key: `reuse-${i}`, text: `"${t.path}" (${t.group})` }))} />
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          {needsAck && !nothingToAdd && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
              <input data-testid="inject-understand-checkbox" type="checkbox" checked={understand} onChange={(e) => setUnderstand(e.target.checked)} />
              I understand some tags will be skipped or may reference the wrong resource map data.
            </label>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button data-testid="inject-dialog-cancel" onClick={onClose} style={buttonStyle()}>
              Cancel
            </button>
            <button
              data-testid="inject-confirm-button"
              disabled={!!confirmDisabledReason}
              title={confirmDisabledReason || undefined}
              onClick={handleConfirm}
              style={buttonStyle(!confirmDisabledReason)}
            >
              {queue.length > 1 && queueIndex < queue.length - 1
                ? 'Inject and next…'
                : 'Inject into open map'}
            </button>
          </div>
          {confirmDisabledReason && (
            <div data-testid="inject-confirm-disabled-reason" style={{ marginTop: 6, fontSize: 11, color: 'var(--text-dim)', textAlign: 'right' }}>
              {confirmDisabledReason}
            </div>
          )}
        </div>
      </DialogShell>
    </Overlay>
  );
}

function describeRefStatus(status: string): string {
  switch (status) {
    case 'match':
      return 'matches your configured resource map';
    case 'mismatch':
      return 'DOES NOT MATCH your configured resource map - may show wrong data in-game';
    case 'unconfigured-on-target':
      return 'no resource map configured (Settings) - cannot verify';
    default:
      return 'could not be verified when it was extracted';
  }
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
        <span style={{ fontSize: 13, fontWeight: 600 }}>Inject Tags</span>
        <button data-testid="inject-dialog-close" onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 16, lineHeight: 1 }}>
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
