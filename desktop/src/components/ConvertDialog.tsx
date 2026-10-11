import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import type { ConvertPreflightResult, RetailConversionReport } from '../../electron/shared-types';

type ConversionCheck = RetailConversionReport['checks'][number];

interface Props {
  /** 'open': the map shown in the unsupported banner; 'pick': choose a file first. */
  source: 'open' | 'pick';
  onClose: () => void;
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
}

const SHOWN_DETAILS = 8;
const hex = (n: number | null) => (n === null ? '-' : `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}`);
const STATUS_MARK: Record<ConversionCheck['status'], string> = { pass: '✓', warn: '⚠', refuse: '✕', info: 'i' };
const STATUS_COLOR: Record<ConversionCheck['status'], string> = {
  pass: 'var(--text-secondary)',
  warn: 'var(--warn-text)',
  refuse: 'var(--error-text)',
  info: 'var(--text-dim)',
};

/**
 * Convert to Custom Edition (converter Phase 1): shows the pre-flight checklist (old and new CRC32,
 * refusals, warnings), requires an explicit acknowledgement for scripts that may call the wrong
 * function, then asks main to convert. Main shows the Save dialog, refuses the source path and
 * writes the new file; the converted map then opens (main sends map:loaded).
 */
export default function ConvertDialog({ source, onClose, log }: Props) {
  const [preflight, setPreflight] = useState<ConvertPreflightResult | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      const res = await window.opence.convertPreflight(source);
      if (!res) return onClose(); // file dialog cancelled
      setPreflight(res);
    })();
  }, [source, onClose]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, [preflight]);

  const report = preflight?.ok ? preflight.report : null;
  const canConvert = !!report && report.canConvert && (!report.requiresAcknowledgement || acknowledged) && !converting;

  const convert = async () => {
    if (!canConvert) return;
    setConverting(true);
    setError(null);
    const result = await window.opence.convertMap(acknowledged);
    setConverting(false);
    if (result.ok) {
      log('info', `Converted map opened: ${result.outputPath}`);
      onClose();
    } else if (result.code !== 'CANCELLED') {
      setError(result.message);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !converting) {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div
        ref={dialogRef}
        data-testid="convert-dialog"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{ width: 680, maxHeight: '88vh', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 4, boxShadow: '0 10px 40px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'var(--bg-panel-header)', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Convert to Custom Edition</span>
          <button data-testid="convert-dialog-close" onClick={onClose} disabled={converting} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 16, lineHeight: 1 }}>
            ×
          </button>
        </div>

        {!preflight && (
          <div data-testid="convert-dialog-loading" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12.5 }}>
            Checking the map...
          </div>
        )}

        {preflight && !preflight.ok && (
          <Body>
            <div data-testid="convert-dialog-error" style={{ color: 'var(--error-text)', fontSize: 12.5 }}>
              {preflight.message}
            </div>
          </Body>
        )}

        {report && preflight?.ok && (
          <>
            <div data-testid="convert-dialog-summary" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>{preflight.sourceFileName}</strong>
                {report.scenarioName !== null && <> - internal name &quot;{report.scenarioName}&quot;, build {report.buildString}, {report.tagCount ?? '?'} tags</>}
              </div>
              <div data-testid="convert-dialog-crc">
                CRC32 {hex(report.previousCrc32)} → {hex(report.newCrc32)}
              </div>
              <div>Changes only the header: version 7 → 609, build string → 01.00.00.0609, internal name from the output file name, CRC32. The source file is not changed.</div>
            </div>
            <Body>
              {report.checks.map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
            </Body>
            {report.requiresAcknowledgement && report.canConvert && (
              <label data-testid="convert-dialog-ack" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 16px', borderTop: '1px solid var(--border)', fontSize: 12.5, color: 'var(--warn-text)' }}>
                <input data-testid="convert-dialog-ack-checkbox" type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                <span>I understand that this map&apos;s scripts may call the wrong functions in Custom Edition, and that nothing is remapped.</span>
              </label>
            )}
          </>
        )}

        {error && (
          <div data-testid="convert-dialog-convert-error" style={{ padding: '8px 16px', color: 'var(--error-text)', fontSize: 12.5, borderTop: '1px solid var(--border)' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
          {report && !report.canConvert && (
            <span data-testid="convert-dialog-refused" style={{ flex: 1, alignSelf: 'center', fontSize: 12, color: 'var(--error-text)' }}>
              This map can&apos;t be converted (see ✕ above).
            </span>
          )}
          <button data-testid="convert-dialog-convert" onClick={convert} disabled={!canConvert} style={buttonStyle(true, !canConvert)}>
            {converting ? 'Converting...' : 'Convert and save as...'}
          </button>
          <button data-testid="convert-dialog-cancel" onClick={onClose} disabled={converting} style={buttonStyle(false, converting)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Body({ children }: { children: ReactNode }) {
  return <div style={{ padding: '8px 16px', overflowY: 'auto', flex: 1, minHeight: 0 }}>{children}</div>;
}

function CheckRow({ check }: { check: ConversionCheck }) {
  const [expanded, setExpanded] = useState(false);
  const details = expanded ? check.details : check.details.slice(0, SHOWN_DETAILS);
  return (
    <div data-testid={`convert-check-${check.id}`} data-status={check.status} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12.5 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ width: 14, flexShrink: 0, color: STATUS_COLOR[check.status], fontWeight: 700 }}>{STATUS_MARK[check.status]}</span>
        <div style={{ flex: 1 }}>
          <div style={{ color: check.status === 'pass' || check.status === 'info' ? 'var(--text-primary)' : STATUS_COLOR[check.status], fontWeight: 600 }}>{check.label}</div>
          <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>{check.message}</div>
          {details.length > 0 && (
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: 'var(--text-dim)', fontFamily: 'var(--mono-font, monospace)', fontSize: 11.5, wordBreak: 'break-all' }}>
              {details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
          {check.details.length > SHOWN_DETAILS && (
            <button onClick={() => setExpanded(!expanded)} style={{ background: 'transparent', border: 'none', color: 'var(--accent-cyan)', fontSize: 11.5, padding: '2px 0', cursor: 'pointer' }}>
              {expanded ? 'Show fewer' : `Show all ${check.details.length}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function buttonStyle(primary: boolean, disabled: boolean): CSSProperties {
  return {
    background: primary && !disabled ? 'var(--accent-cyan)' : 'var(--bg-panel-header)',
    color: primary && !disabled ? '#06202c' : disabled ? 'var(--text-dim)' : 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: 2,
    padding: '6px 14px',
    fontSize: 12,
  };
}
