import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type {
  BatchExtractPreflightResult,
  BatchExtractResult,
  BatchExtractMode,
  BatchExtractFormat,
  BatchExtractSummary,
  ProgressEvent,
} from '../../electron/shared-types';

interface Props {
  open: boolean;
  onClose: () => void;
  preflight: BatchExtractPreflightResult;
}

type Step = 'preflight' | 'running' | 'cancelled_prompt' | 'complete';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function BatchExtractDialog({ open, onClose, preflight }: Props) {
  const [step, setStep] = useState<Step>('preflight');
  const [mode, setMode] = useState<BatchExtractMode>('skip');
  const [extractFormat, setExtractFormat] = useState<BatchExtractFormat>('blam');
  const [progressText, setProgressText] = useState('Preparing extraction...');
  const [percent, setPercent] = useState(0);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelData, setCancelData] = useState<{
    stagingDir: string;
    targetDir: string;
    partialSummary: BatchExtractSummary;
  } | null>(null);
  const [completeSummary, setCompleteSummary] = useState<BatchExtractSummary | null>(null);

  useEffect(() => {
    if (!open) {
      setStep('preflight');
      setMode('skip');
      setPercent(0);
      setProgressText('Preparing extraction...');
      setIsCancelling(false);
      setCancelData(null);
      setCompleteSummary(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || step !== 'running') return;
    const unsub = window.opence.onProgress((e: ProgressEvent) => {
      if (e.taskId === 'batchExtract') {
        setProgressText(e.stage);
        setPercent(e.percent);
      }
    });
    return unsub;
  }, [open, step]);

  if (!open) return null;

  const handleStart = async () => {
    setStep('running');
    setIsCancelling(false);
    setPercent(0);
    setProgressText('Starting extraction...');

    const result: BatchExtractResult = await window.opence.startBatchExtract({
      parentDir: preflight.parentDir,
      mode,
      extractFormat,
    });

    if (result.ok) {
      setCompleteSummary(result.summary);
      setStep('complete');
    } else if (result.code === 'CANCELLED') {
      if ('stagingDir' in result && result.stagingDir && result.targetDir && result.partialSummary) {
        setCancelData({
          stagingDir: result.stagingDir,
          targetDir: result.targetDir,
          partialSummary: result.partialSummary,
        });
        setStep('cancelled_prompt');
      } else {
        onClose();
      }
    } else {
      // Error
      setStep('complete');
    }
  };

  const handleCancelClick = () => {
    setIsCancelling(true);
    setProgressText('Cancelling extraction...');
    window.opence.cancelBatchExtract();
  };

  const handleFinalizeCancel = async (action: 'keep' | 'delete') => {
    if (!cancelData) {
      onClose();
      return;
    }
    await window.opence.finalizeBatchExtract({
      action,
      stagingDir: cancelData.stagingDir,
      targetDir: cancelData.targetDir,
      summary: cancelData.partialSummary,
    });
    if (action === 'keep') {
      setCompleteSummary(cancelData.partialSummary);
      setStep('complete');
    } else {
      onClose();
    }
  };

  const handleOpenFolder = () => {
    const dir = completeSummary?.targetDir || preflight.targetDir;
    window.opence.openContainingFolder(dir);
  };

  const overlayStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.65)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  };

  const dialogStyle: CSSProperties = {
    background: 'var(--bg-panel)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    width: 600,
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    color: 'var(--text-primary)',
    fontSize: 12,
  };

  const headerStyle: CSSProperties = {
    padding: '12px 16px',
    background: 'var(--bg-panel-header)',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontWeight: 600,
    fontSize: 13,
  };

  const contentStyle: CSSProperties = {
    padding: 16,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  };

  const footerStyle: CSSProperties = {
    padding: '12px 16px',
    background: 'var(--bg-panel-header)',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  };

  const buttonStyle = (primary?: boolean, danger?: boolean): CSSProperties => ({
    padding: '6px 14px',
    borderRadius: 3,
    fontSize: 12,
    fontWeight: primary ? 600 : 400,
    border: '1px solid var(--border)',
    background: primary ? 'var(--accent-cyan)' : danger ? '#4a1515' : 'var(--bg-main)',
    color: primary ? '#06202c' : danger ? '#ff9999' : 'var(--text-primary)',
    cursor: 'pointer',
  });

  return (
    <div style={overlayStyle} data-testid="batch-extract-dialog-overlay">
      <div style={dialogStyle} data-testid="batch-extract-dialog">
        <div style={headerStyle}>
          <span>Batch Extract Whole Map</span>
          {step !== 'running' && (
            <button
              onClick={onClose}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16 }}
            >
              ×
            </button>
          )}
        </div>

        <div style={contentStyle}>
          {step === 'preflight' && (
            <>
              <div>
                Exporting all extractable tags from <strong>{preflight.mapName}</strong> into an organized directory tree. Each tag packages its own dependency closure.
              </div>

              <div style={{ background: 'var(--bg-main)', border: '1px solid var(--border)', borderRadius: 3, padding: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '6px 12px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Destination folder:</span>
                  <span style={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: 11.5 }}>{preflight.targetDir}</span>

                  <span style={{ color: 'var(--text-secondary)' }}>Total tags in map:</span>
                  <span>{preflight.totalTags.toLocaleString()}</span>

                  <span style={{ color: 'var(--text-secondary)' }}>Tags to extract:</span>
                  <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>{preflight.extractableCount.toLocaleString()}</span>

                  <span style={{ color: 'var(--text-secondary)' }}>External tags:</span>
                  <span style={{ color: 'var(--text-dim)' }}>{preflight.externalCount.toLocaleString()} (in bitmaps.map/sounds.map/loc.map)</span>

                  <span style={{ color: 'var(--text-secondary)' }}>Blocked tags:</span>
                  <span style={{ color: 'var(--text-dim)' }}>{preflight.blockedCount.toLocaleString()} (e.g. scenario_structure_bsp)</span>

                  <span style={{ color: 'var(--text-secondary)' }}>Estimated total size:</span>
                  <span>{formatBytes(preflight.estimatedTotalBytes)}</span>

                  <span style={{ color: 'var(--text-secondary)' }}>Drive free space:</span>
                  <span>{preflight.freeSpaceBytes !== null ? formatBytes(preflight.freeSpaceBytes) : 'Unknown'}</span>
                </div>
              </div>

              {/* Item 4 (Milestone 16.2): Dual-Mode Batch Extract Format Selector */}
              <div style={{ background: 'var(--bg-main)', border: '1px solid var(--border)', borderRadius: 3, padding: 12 }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                  Extraction Output Format
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="batchExtractFormat"
                      value="blam"
                      data-testid="batch-format-blam"
                      checked={extractFormat === 'blam'}
                      onChange={() => setExtractFormat('blam')}
                    />
                    <span>
                      <strong>Standard Blam Loose Tags (tags/&lt;path&gt;.&lt;group&gt; — Default)</strong> — uniform 64-byte &apos;blam&apos; loose tag tree compatible with Sapien, Guerilla, tool.exe, Invader, MEK, and Baboon.
                    </span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="batchExtractFormat"
                      value="ocetags"
                      data-testid="batch-format-ocetags"
                      checked={extractFormat === 'ocetags'}
                      onChange={() => setExtractFormat('ocetags')}
                    />
                    <span>
                      <strong>.ocetags Tag Containers (Secondary Choice)</strong> — portable self-contained tag closures ready for cross-map injection.
                    </span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="batchExtractFormat"
                      value="data_source"
                      data-testid="batch-format-data-source"
                      checked={extractFormat === 'data_source'}
                      onChange={() => setExtractFormat('data_source')}
                    />
                    <span>
                      <strong>Editable Source Tree (data/ — Refinery style)</strong> — decompiles models (.jms), animations (.jma), physics (.physics.jms), bitmaps (.png), sounds (.wav), strings (.txt), and HaloScript (.hsc).
                    </span>
                  </label>
                </div>
              </div>

              {preflight.existingFileCount > 0 && (
                <div style={{ background: 'var(--warn-bg)', border: '1px solid var(--border)', borderRadius: 3, padding: 12 }}>
                  <div style={{ fontWeight: 600, color: 'var(--warn-text)', marginBottom: 8 }}>
                    Existing Files Detected ({preflight.existingFileCount} tag container(s))
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="batchMode"
                        value="skip"
                        checked={mode === 'skip'}
                        onChange={() => setMode('skip')}
                      />
                      <span><strong>Skip existing files (recommended)</strong> — extract missing tags only.</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="batchMode"
                        value="replace"
                        checked={mode === 'replace'}
                        onChange={() => setMode('replace')}
                      />
                      <span><strong>Replace all existing files</strong> — overwrite existing containers in this folder.</span>
                    </label>
                  </div>
                </div>
              )}
            </>
          )}

          {step === 'running' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontWeight: 600 }}>Extracting map tags...</div>
              <div
                style={{
                  background: 'var(--bg-main)',
                  border: '1px solid var(--border)',
                  borderRadius: 3,
                  height: 12,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    background: 'var(--accent-cyan)',
                    height: '100%',
                    width: `${Math.max(0, Math.min(100, percent))}%`,
                    transition: 'width 0.15s ease',
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text-secondary)' }}>
                <span style={{ wordBreak: 'break-all' }}>{progressText}</span>
                <span style={{ fontWeight: 600, flexShrink: 0, marginLeft: 8 }}>{percent}%</span>
              </div>
            </div>
          )}

          {step === 'cancelled_prompt' && cancelData && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontWeight: 600, color: 'var(--warn-text)', fontSize: 13 }}>
                Extraction Cancelled
              </div>
              <div>
                You cancelled the batch extraction. <strong>{cancelData.partialSummary.extractedCount.toLocaleString()}</strong> tag(s) were written to staging before cancellation.
              </div>
              <div>
                Would you like to keep the files exported so far, or delete everything from this batch?
              </div>
            </div>
          )}

          {step === 'complete' && completeSummary && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontWeight: 600, color: 'var(--accent-cyan)', fontSize: 13 }}>
                Batch Extraction Complete
              </div>

              <div style={{ background: 'var(--bg-main)', border: '1px solid var(--border)', borderRadius: 3, padding: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '6px 12px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Output folder:</span>
                  <span style={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: 11.5 }}>{completeSummary.targetDir}</span>

                  <span style={{ color: 'var(--text-secondary)' }}>Containers written:</span>
                  <span style={{ fontWeight: 600 }}>{completeSummary.extractedCount.toLocaleString()} files ({formatBytes(completeSummary.totalBytesWritten)})</span>

                  <span style={{ color: 'var(--text-secondary)' }}>Skipped (existing):</span>
                  <span>{completeSummary.skippedCount.toLocaleString()}</span>

                  <span style={{ color: 'var(--text-secondary)' }}>External tags:</span>
                  <span>{completeSummary.externalCount.toLocaleString()}</span>

                  <span style={{ color: 'var(--text-secondary)' }}>Blocked tags:</span>
                  <span>{completeSummary.blockedCount.toLocaleString()}</span>

                  <span style={{ color: 'var(--text-secondary)' }}>Failed tags:</span>
                  <span>{completeSummary.failedCount.toLocaleString()}</span>

                  <span style={{ color: 'var(--text-secondary)' }}>Elapsed time:</span>
                  <span>{(completeSummary.elapsedMs / 1000).toFixed(1)} seconds</span>
                </div>
              </div>

              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                A <code>manifest.json</code> and <code>batch-extract-report.txt</code> were generated inside the output folder.
              </div>
            </div>
          )}
        </div>

        <div style={footerStyle}>
          {step === 'preflight' && (
            <>
              <button data-testid="batch-cancel-button" onClick={onClose} style={buttonStyle()}>
                Cancel
              </button>
              <button data-testid="batch-start-button" onClick={handleStart} style={buttonStyle(true)}>
                Start Extraction
              </button>
            </>
          )}

          {step === 'running' && (
            <button
              data-testid="batch-abort-button"
              disabled={isCancelling}
              onClick={handleCancelClick}
              style={buttonStyle(false, true)}
            >
              {isCancelling ? 'Cancelling...' : 'Cancel'}
            </button>
          )}

          {step === 'cancelled_prompt' && (
            <>
              <button
                data-testid="batch-discard-cancel-button"
                onClick={() => handleFinalizeCancel('delete')}
                style={buttonStyle(false, true)}
              >
                Delete This Batch
              </button>
              <button
                data-testid="batch-keep-cancel-button"
                onClick={() => handleFinalizeCancel('keep')}
                style={buttonStyle(true)}
              >
                Keep Exported Files
              </button>
            </>
          )}

          {step === 'complete' && (
            <>
              <button data-testid="batch-open-folder-button" onClick={handleOpenFolder} style={buttonStyle()}>
                Open Output Folder
              </button>
              <button data-testid="batch-close-button" onClick={onClose} style={buttonStyle(true)}>
                Close
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
