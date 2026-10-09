import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

export interface ConfirmDialogButton {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'default';
  /** Exactly one button should set this - it receives initial focus and responds to Enter. Put Cancel last and autoFocus it, so Cancel is the default action. */
  autoFocus?: boolean;
  testId?: string;
}

interface Props {
  title: string;
  message: string;
  buttons: ConfirmDialogButton[];
  /** Called on Escape (wire this to the same handler as your Cancel button). */
  onEscape: () => void;
  testId?: string;
}

/**
 * Generic, reusable confirm/choice modal (title + message + N buttons). Used today for the
 * large-selection extract confirmation; M5's tag-conflict ("ADD/SWAP/Skip") dialogs are expected
 * to reuse this same component rather than hand-rolling another modal.
 */
export default function ConfirmDialog({ title, message, buttons, onEscape, testId = 'confirm-dialog' }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = dialogRef.current?.querySelector<HTMLElement>('[data-autofocus="true"]') ?? dialogRef.current?.querySelector<HTMLElement>('button');
    target?.focus();
  }, []);

  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onEscape();
      return;
    }
    if (e.key === 'Tab' && dialogRef.current) {
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>('button');
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

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 150 }}>
      <div
        ref={dialogRef}
        data-testid={testId}
        role="alertdialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        style={{
          width: 420,
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '10px 16px', background: 'var(--bg-panel-header)', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>{title}</div>
        <div data-testid={`${testId}-message`} style={{ padding: 16, fontSize: 12.5, color: 'var(--text-secondary)' }}>
          {message}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          {buttons.map((b, i) => (
            <button
              key={b.label}
              data-testid={b.testId ?? `${testId}-button-${i}`}
              data-autofocus={b.autoFocus ? 'true' : undefined}
              onClick={b.onClick}
              style={{
                background: b.variant === 'primary' ? 'var(--accent-cyan)' : 'var(--bg-panel-header)',
                color: b.variant === 'primary' ? '#06202c' : 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 2,
                padding: '6px 14px',
                fontSize: 12,
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
