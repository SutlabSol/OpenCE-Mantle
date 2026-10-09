import { forwardRef, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import type { VerifyEmbeddedDataResult } from '../../electron/shared-types';

type Phase = 'loading' | 'result' | 'error';

interface Props {
  onClose: () => void;
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
}

/**
 * Tools > Verify Embedded Data: read-only diagnostic for the currently open map. Works on any
 * map (no name/path/size-specific logic anywhere in the underlying check, see
 * `core/src/map/embedded-data-verifier.ts`). Reports every bitmap/sound asset as embedded or
 * external, bounds/overlap/readability-checks embedded ones, and lists unrecognized layouts as
 * blocked rather than guessed. Never writes anything - there is no "apply" step here.
 */
export default function VerifyEmbeddedDataDialog({ onClose, log }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [result, setResult] = useState<VerifyEmbeddedDataResult | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      const res = await window.opence.verifyEmbeddedData();
      setResult(res);
      if (res.ok) {
        log('info', `Embedded data check: ${res.counts.embedded} embedded, ${res.counts.external} external, ${res.counts.blockedTags} blocked.`);
        setPhase('result');
      } else {
        setPhase('error');
      }
    })();
  }, [log]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, [phase]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  const copyReport = () => {
    if (result?.ok) navigator.clipboard?.writeText(result.reportText).catch(() => {});
  };

  if (phase === 'loading') {
    return (
      <Overlay>
        <DialogShell testid="verify-embedded-dialog" ref={dialogRef} onKeyDown={handleKeyDown} onClose={onClose}>
          <div data-testid="verify-embedded-dialog-loading" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
            Checking embedded bitmap/sound data...
          </div>
        </DialogShell>
      </Overlay>
    );
  }

  if (phase === 'error' || !result || !result.ok) {
    return (
      <Overlay>
        <DialogShell testid="verify-embedded-dialog" ref={dialogRef} onKeyDown={handleKeyDown} onClose={onClose}>
          <div data-testid="verify-embedded-dialog-error" style={{ padding: 20, color: 'var(--error-text)', fontSize: 12.5 }}>
            {result && !result.ok ? result.message : 'Could not run the embedded data check.'}
          </div>
        </DialogShell>
      </Overlay>
    );
  }

  const hasProblems = result.counts.embeddedOutOfBounds > 0 || result.counts.overlapping > 0 || result.counts.unreadable > 0 || result.counts.blockedTags > 0;

  return (
    <Overlay>
      <DialogShell testid="verify-embedded-dialog" ref={dialogRef} onKeyDown={handleKeyDown} onClose={onClose} wide>
        <div
          data-testid="verify-embedded-dialog-summary"
          style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 12.5, color: hasProblems ? 'var(--error-text)' : 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}
        >
          <span>
            &quot;{result.mapLabel}&quot;: {result.totalBitmapSoundTags} bitmap/sound tag(s), {result.checkedTags} checked - {result.counts.embedded} embedded, {result.counts.external} external,{' '}
            {result.counts.blockedTags} blocked
          </span>
          <button data-testid="verify-embedded-copy-report-button" onClick={copyReport} style={{ ...buttonStyle(), flexShrink: 0 }}>
            Copy report
          </button>
        </div>
        <pre
          data-testid="verify-embedded-dialog-report-text"
          style={{
            margin: 0,
            padding: '12px 16px',
            maxHeight: 420,
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            fontFamily: 'var(--mono-font, monospace)',
            fontSize: 12,
            color: 'var(--text-primary)',
          }}
        >
          {result.reportText}
        </pre>
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
          <button data-testid="verify-embedded-dialog-done" onClick={onClose} style={buttonStyle(true)}>
            Done
          </button>
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
        <span style={{ fontSize: 13, fontWeight: 600 }}>Verify Embedded Data</span>
        <button data-testid="verify-embedded-dialog-close" onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 16, lineHeight: 1 }}>
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
