import { useEffect, useRef, useState, useCallback } from 'react';
import type { KeyboardEvent, MouseEvent, WheelEvent } from 'react';
import type {
  TagEntrySummary,
  BitmapTagSummary,
  BitmapImageInfo,
  GetBitmapInfoResult,
  GetBitmapRgbaResult,
} from '../../electron/shared-types';

interface Props {
  tag: TagEntrySummary;
  onClose: () => void;
}

export default function BitmapEditorDialog({ tag, onClose }: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<BitmapTagSummary | null>(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  // Channel toggles
  const [channelR, setChannelR] = useState(true);
  const [channelG, setChannelG] = useState(true);
  const [channelB, setChannelB] = useState(true);
  const [channelA, setChannelA] = useState(true);

  // Canvas pan & zoom state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Hover color readout
  const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number; r: number; g: number; b: number; a: number } | null>(null);

  // Action status message
  const [statusMsg, setStatusMsg] = useState<{ text: string; isError?: boolean } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Current decoded image
  const [rawImage, setRawImage] = useState<{ width: number; height: number; img: HTMLImageElement } | null>(null);

  // 1. Load Tag Metadata Summary
  const loadSummary = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res: GetBitmapInfoResult = await window.opence.getBitmapInfo(tag.index);
      if (!res.ok || !res.summary) {
        setError(res.message || 'Failed to inspect bitmap tag.');
        return;
      }
      setSummary(res.summary);
      if (selectedImageIndex >= res.summary.images.length) {
        setSelectedImageIndex(0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [tag.index, selectedImageIndex]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // 2. Load and Decode Selected Image Plate
  useEffect(() => {
    if (!summary || summary.images.length === 0) return;
    let cancelled = false;

    const fetchPlate = async () => {
      try {
        const res: GetBitmapRgbaResult = await window.opence.getBitmapRgba(tag.index, selectedImageIndex);
        if (cancelled) return;
        if (!res.ok || !res.dataUrl) {
          setError(res.message || 'Failed to decode bitmap plate.');
          return;
        }

        const img = new Image();
        img.onload = () => {
          if (!cancelled) {
            setRawImage({ width: res.width ?? img.width, height: res.height ?? img.height, img });
          }
        };
        img.src = res.dataUrl;
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    fetchPlate();
    return () => {
      cancelled = true;
    };
  }, [tag.index, summary, selectedImageIndex]);

  // 3. Render Image with Channel Filters to Canvas
  useEffect(() => {
    if (!canvasRef.current || !rawImage) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = rawImage.width;
    canvas.height = rawImage.height;

    // Draw source image to offscreen canvas to filter RGBA channels
    const offscreen = document.createElement('canvas');
    offscreen.width = rawImage.width;
    offscreen.height = rawImage.height;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return;

    offCtx.drawImage(rawImage.img, 0, 0);
    const imgData = offCtx.getImageData(0, 0, rawImage.width, rawImage.height);
    const data = imgData.data;

    const onlyAlpha = !channelR && !channelG && !channelB && channelA;

    for (let i = 0; i < data.length; i += 4) {
      if (onlyAlpha) {
        const a = data[i + 3];
        data[i + 0] = a;
        data[i + 1] = a;
        data[i + 2] = a;
        data[i + 3] = 255;
      } else {
        if (!channelR) data[i + 0] = 0;
        if (!channelG) data[i + 1] = 0;
        if (!channelB) data[i + 2] = 0;
        if (!channelA) data[i + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }, [rawImage, channelR, channelG, channelB, channelA]);

  useEffect(() => {
    shellRef.current?.focus();
  }, []);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.2 : 0.8;
    setZoom((prev) => Math.min(32, Math.max(0.1, prev * factor)));
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (e.button === 0 || e.button === 1) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }

    if (canvasRef.current && rawImage) {
      const rect = canvasRef.current.getBoundingClientRect();
      const clickX = Math.floor((e.clientX - rect.left) / zoom);
      const clickY = Math.floor((e.clientY - rect.top) / zoom);

      if (clickX >= 0 && clickX < rawImage.width && clickY >= 0 && clickY < rawImage.height) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          const pixel = ctx.getImageData(clickX, clickY, 1, 1).data;
          setHoverInfo({
            x: clickX,
            y: clickY,
            r: pixel[0],
            g: pixel[1],
            b: pixel[2],
            a: pixel[3],
          });
          return;
        }
      }
    }
    setHoverInfo(null);
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  // Export handlers
  const handleExport = async (format: 'png' | 'dds') => {
    if (!summary || isProcessing) return;
    try {
      setIsProcessing(true);
      setStatusMsg({ text: `Exporting plate as ${format.toUpperCase()}...` });
      const defaultName = `${tag.path.replace(/[\\/]/g, '_')}_plate_${selectedImageIndex}`;
      const pick = await window.opence.pickExportBitmapPath(defaultName, format);
      if (!pick.path) {
        setStatusMsg(null);
        return;
      }
      const res = await window.opence.exportBitmapImage(tag.index, selectedImageIndex, format, pick.path);
      if (res.ok) {
        setStatusMsg({ text: `Exported successfully to ${res.filePath}` });
      } else {
        setStatusMsg({ text: res.message || 'Export failed', isError: true });
      }
    } catch (err) {
      setStatusMsg({ text: err instanceof Error ? err.message : String(err), isError: true });
    } finally {
      setIsProcessing(false);
    }
  };

  // Import handler
  const handleImport = async () => {
    if (!summary || isProcessing) return;
    try {
      setIsProcessing(true);
      setStatusMsg({ text: 'Selecting input file...' });
      const pick = await window.opence.pickImportBitmapPath();
      if (!pick.path) {
        setStatusMsg(null);
        return;
      }
      setStatusMsg({ text: `Injecting ${pick.path}...` });
      const res = await window.opence.replaceBitmapImage(tag.index, selectedImageIndex, pick.path);
      if (res.ok) {
        setStatusMsg({ text: 'Image replaced and internalized successfully! Open map marked modified.' });
        window.dispatchEvent(new CustomEvent('opence:bitmap-updated', { detail: { tagIndex: tag.index } }));
        await loadSummary();
      } else {
        setStatusMsg({ text: res.message || 'Replace failed', isError: true });
      }
    } catch (err) {
      setStatusMsg({ text: err instanceof Error ? err.message : String(err), isError: true });
    } finally {
      setIsProcessing(false);
    }
  };

  const currentPlate: BitmapImageInfo | undefined = summary?.images[selectedImageIndex];

  return (
    <div
      data-testid="bitmap-editor-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 160,
      }}
    >
      <div
        ref={shellRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        style={{
          width: '90vw',
          maxWidth: 1040,
          height: '88vh',
          maxHeight: 860,
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 16px',
            background: 'var(--bg-panel-header)',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.3px' }}>Bitmap Editor</span>
          <span
            style={{
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 3,
              background: 'rgba(56,189,248,0.15)',
              color: 'var(--accent-cyan, #38bdf8)',
              fontFamily: 'var(--mono-font)',
              fontWeight: 600,
            }}
          >
            bitm
          </span>
          {summary && (
            <>
              <span
                style={{
                  fontSize: 10,
                  padding: '2px 6px',
                  borderRadius: 3,
                  background: summary.isExternal ? 'rgba(234,179,8,0.15)' : 'rgba(34,197,94,0.15)',
                  color: summary.isExternal ? '#eab308' : '#22c55e',
                  fontFamily: 'var(--mono-font)',
                  fontWeight: 600,
                }}
              >
                {summary.isExternal ? 'EXTERNAL (bitmaps.map)' : 'INTERNAL'}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--text-dim)',
                  fontFamily: 'var(--mono-font)',
                }}
              >
                {summary.typeName} • {summary.usageName}
              </span>
            </>
          )}
          <span
            title={tag.path}
            style={{
              flex: 1,
              fontFamily: 'var(--mono-font)',
              fontSize: 11,
              color: 'var(--text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {tag.path}
          </span>
          <button
            data-testid="bitmap-editor-close"
            onClick={onClose}
            title="Close (Esc)"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dim)',
              fontSize: 18,
              lineHeight: 1,
              cursor: 'pointer',
              padding: '2px 6px',
            }}
          >
            ×
          </button>
        </div>

        {/* Toolbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
            padding: '8px 16px',
            background: 'var(--bg-panel)',
            borderBottom: '1px solid var(--border)',
            fontSize: 12,
          }}
        >
          {/* Plate Navigation */}
          {summary && summary.images.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--text-dim)' }}>Plate:</span>
              <button
                disabled={selectedImageIndex <= 0}
                onClick={() => setSelectedImageIndex((prev) => Math.max(0, prev - 1))}
                style={{
                  padding: '2px 8px',
                  background: 'var(--bg-button)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  borderRadius: 3,
                  cursor: selectedImageIndex <= 0 ? 'default' : 'pointer',
                  opacity: selectedImageIndex <= 0 ? 0.4 : 1,
                }}
              >
                ◀
              </button>
              <select
                value={selectedImageIndex}
                onChange={(e) => setSelectedImageIndex(Number(e.target.value))}
                style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  padding: '3px 8px',
                  borderRadius: 3,
                  fontSize: 11,
                }}
              >
                {summary.images.map((img: BitmapImageInfo, idx: number) => (
                  <option key={idx} value={idx}>
                    {idx + 1} / {summary.images.length} ({img.width}×{img.height} {img.formatName})
                  </option>
                ))}
              </select>
              <button
                disabled={selectedImageIndex >= summary.images.length - 1}
                onClick={() => setSelectedImageIndex((prev) => Math.min(summary.images.length - 1, prev + 1))}
                style={{
                  padding: '2px 8px',
                  background: 'var(--bg-button)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  borderRadius: 3,
                  cursor: selectedImageIndex >= summary.images.length - 1 ? 'default' : 'pointer',
                  opacity: selectedImageIndex >= summary.images.length - 1 ? 0.4 : 1,
                }}
              >
                ▶
              </button>
            </div>
          )}

          {/* Current Plate Specs */}
          {currentPlate && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                {currentPlate.width} × {currentPlate.height} px
              </span>
              <span>•</span>
              <span style={{ color: 'var(--accent-cyan)' }}>{currentPlate.formatName}</span>
              <span>•</span>
              <span>{(currentPlate.pixelDataSize / 1024).toFixed(1)} KB</span>
              {currentPlate.mipmapCount > 1 && (
                <>
                  <span>•</span>
                  <span>{currentPlate.mipmapCount} Mipmaps</span>
                </>
              )}
            </div>
          )}

          <div style={{ flex: 1 }} />

          {/* Channel Toggles */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--text-dim)' }}>Channels:</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', color: '#f87171' }}>
              <input type="checkbox" checked={channelR} onChange={(e) => setChannelR(e.target.checked)} /> R
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', color: '#4ade80' }}>
              <input type="checkbox" checked={channelG} onChange={(e) => setChannelG(e.target.checked)} /> G
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', color: '#60a5fa' }}>
              <input type="checkbox" checked={channelB} onChange={(e) => setChannelB(e.target.checked)} /> B
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', color: '#e2e8f0' }}>
              <input type="checkbox" checked={channelA} onChange={(e) => setChannelA(e.target.checked)} /> A
            </label>
          </div>

          {/* Zoom Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={() => setZoom((z) => Math.max(0.1, z / 1.25))}
              style={{
                padding: '2px 8px',
                background: 'var(--bg-button)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              -
            </button>
            <span style={{ width: 44, textAlign: 'center', fontFamily: 'var(--mono-font)', fontSize: 11 }}>
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(32, z * 1.25))}
              style={{
                padding: '2px 8px',
                background: 'var(--bg-button)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              +
            </button>
            <button
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              style={{
                padding: '2px 8px',
                background: 'var(--bg-button)',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
                borderRadius: 3,
                cursor: 'pointer',
                fontSize: 10,
              }}
            >
              1:1
            </button>
          </div>
        </div>

        {/* Center Viewport */}
        <div
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            background:
              'repeating-conic-gradient(#1e293b 0% 25%, #0f172a 0% 50%) 50% / 20px 20px',
            cursor: isPanning ? 'grabbing' : 'grab',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            userSelect: 'none',
          }}
        >
          {loading && (
            <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>Loading bitmap details...</div>
          )}

          {error && (
            <div style={{ color: '#ef4444', fontSize: 13, background: 'rgba(0,0,0,0.6)', padding: '8px 16px', borderRadius: 4 }}>
              {error}
            </div>
          )}

          <canvas
            ref={canvasRef}
            data-testid="bitmap-preview-canvas"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
              imageRendering: 'pixelated',
              boxShadow: '0 4px 20px rgba(0,0,0,0.7)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          />

          {/* Coordinate & Color Inspector Overlay */}
          {hoverInfo && (
            <div
              style={{
                position: 'absolute',
                bottom: 12,
                left: 12,
                background: 'rgba(15, 23, 42, 0.85)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '4px 10px',
                fontFamily: 'var(--mono-font)',
                fontSize: 11,
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                pointerEvents: 'none',
                backdropFilter: 'blur(4px)',
              }}
            >
              <span>
                X: {hoverInfo.x}, Y: {hoverInfo.y}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 12,
                    height: 12,
                    borderRadius: 2,
                    background: `rgba(${hoverInfo.r}, ${hoverInfo.g}, ${hoverInfo.b}, ${hoverInfo.a / 255})`,
                    border: '1px solid #ffffff40',
                  }}
                />
                <span>
                  RGBA: ({hoverInfo.r}, {hoverInfo.g}, {hoverInfo.b}, {hoverInfo.a})
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Status Notification Banner */}
        {statusMsg && (
          <div
            style={{
              padding: '6px 16px',
              fontSize: 11,
              background: statusMsg.isError ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
              color: statusMsg.isError ? '#f87171' : '#4ade80',
              borderTop: '1px solid var(--border)',
            }}
          >
            {statusMsg.text}
          </div>
        )}

        {/* Footer Actions */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            background: 'var(--bg-panel-header)',
            borderTop: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              data-testid="bitmap-export-png"
              onClick={() => handleExport('png')}
              disabled={isProcessing || !summary}
              style={{
                padding: '6px 14px',
                background: 'var(--bg-button)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Export PNG...
            </button>
            <button
              data-testid="bitmap-export-dds"
              onClick={() => handleExport('dds')}
              disabled={isProcessing || !summary}
              style={{
                padding: '6px 14px',
                background: 'var(--bg-button)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Export DDS...
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              data-testid="bitmap-import-replace"
              onClick={handleImport}
              disabled={isProcessing || !summary}
              style={{
                padding: '6px 16px',
                background: 'var(--accent-cyan, #38bdf8)',
                border: 'none',
                color: '#0f172a',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 700,
                boxShadow: '0 2px 8px rgba(56,189,248,0.3)',
              }}
            >
              Import & Replace Image...
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '6px 14px',
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
