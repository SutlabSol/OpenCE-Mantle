import React, { useEffect, useState, useRef, useCallback } from 'react';
import type {
  LiveHudCatalog,
  UiWidgetCanvasNode,
} from '../../electron/shared-types';

export interface UiMapStudioDialogProps {
  open: boolean;
  onClose: () => void;
  initialWidgetTagIndex?: number | null;
  initialUstrTagIndex?: number | null;
  onTagsChanged?: () => Promise<void>;
}

const HALO_BLUE = '#2896FF';
const HALO_BORDER_SELECTED = '#2299FF';

function flattenWidgetNodes(root: UiWidgetCanvasNode | null): UiWidgetCanvasNode[] {
  if (!root) return [];
  const out: UiWidgetCanvasNode[] = [root];
  for (const child of root.children) {
    out.push(...flattenWidgetNodes(child));
  }
  return out;
}

export const UiMapStudioDialog: React.FC<UiMapStudioDialogProps> = ({
  open,
  onClose,
  initialWidgetTagIndex,
  initialUstrTagIndex,
  onTagsChanged,
}) => {
  const [activeTab, setActiveTab] = useState<'canvas' | 'ustr'>('canvas');
  const [catalog, setCatalog] = useState<LiveHudCatalog | null>(null);
  const [loading, setLoading] = useState(false);

  // Tab 1: DeLa 640x480 Canvas state
  const [widgetSearch, setWidgetSearch] = useState('');
  const [selectedWidgetTagIndex, setSelectedWidgetTagIndex] = useState<number | null>(null);
  const [widgetHistory, setWidgetHistory] = useState<number[]>([]);
  const [rootCanvasNode, setRootCanvasNode] = useState<UiWidgetCanvasNode | null>(null);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  const [bitmapCache, setBitmapCache] = useState<Record<number, HTMLImageElement>>({});
  const [showWireframes, setShowWireframes] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string>('');

  // Tab 2: ustr Unicode String Table state
  const [ustrSearch, setUstrSearch] = useState('');
  const [selectedUstrTagIndex, setSelectedUstrTagIndex] = useState<number | null>(null);
  const [ustrStrings, setUstrStrings] = useState<string[]>([]);
  const [ustrFilter, setUstrFilter] = useState('');
  const [ustrDirty, setUstrDirty] = useState(false);
  const [ustrSaving, setUstrSaving] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragStateRef = useRef<{
    active: boolean;
    node: UiWidgetCanvasNode;
    startMouseX: number;
    startMouseY: number;
    origHorizontalOffset: number;
    origVerticalOffset: number;
    origBounds: [number, number, number, number];
    curDeltaX: number;
    curDeltaY: number;
  } | null>(null);

  const loadCatalog = useCallback(async () => {
    if (!window.opence.inspectLiveHudCatalog) return;
    setLoading(true);
    try {
      const res = await window.opence.inspectLiveHudCatalog();
      if (!res.ok) {
        setStatusMessage(res.message);
        return;
      }
      const cat = res.catalog;
      setCatalog(cat);
      if (initialUstrTagIndex != null) {
        setActiveTab('ustr');
        setSelectedUstrTagIndex(initialUstrTagIndex);
      } else if (initialWidgetTagIndex != null) {
        setActiveTab('canvas');
        setSelectedWidgetTagIndex(initialWidgetTagIndex);
      } else {
        if (cat.uiWidgets.length > 0 && selectedWidgetTagIndex == null) {
          const mainMenu =
            cat.uiWidgets.find(
              (w) =>
                w.path.toLowerCase().includes('main_menu') ||
                w.path.toLowerCase().includes('pause_game')
            ) ?? cat.uiWidgets[0];
          setSelectedWidgetTagIndex(mainMenu.tagIndex);
        }
        if (cat.unicodeStringLists.length > 0 && selectedUstrTagIndex == null) {
          setSelectedUstrTagIndex(cat.unicodeStringLists[0].tagIndex);
        }
      }
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [initialWidgetTagIndex, initialUstrTagIndex, selectedWidgetTagIndex, selectedUstrTagIndex]);

  useEffect(() => {
    if (open) {
      void loadCatalog();
    }
  }, [open, loadCatalog]);

  // Load selected DeLa widget tree
  const loadWidgetCanvas = useCallback(async (tagIdx: number) => {
    if (!window.opence.inspectUiWidgetCanvas) return;
    try {
      const res = await window.opence.inspectUiWidgetCanvas(tagIdx);
      if (!res.ok) {
        setRootCanvasNode(null);
        setStatusMessage(res.message);
        return;
      }
      const tree = res.rootNode;
      setRootCanvasNode(tree);
      if (tree) {
        const firstChild = tree.children[0] ?? tree;
        setSelectedNodeKey(`${firstChild.tagIndex}:${firstChild.childWidgetIndex ?? -1}`);
      }
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (open && selectedWidgetTagIndex != null) {
      void loadWidgetCanvas(selectedWidgetTagIndex);
    }
  }, [open, selectedWidgetTagIndex, loadWidgetCanvas]);

  // Load bitmaps used in the current widget canvas tree
  useEffect(() => {
    if (!rootCanvasNode) return;
    let cancelled = false;
    const allNodes = flattenWidgetNodes(rootCanvasNode);
    const uniqueBitmaps = new Set<number>();
    for (const n of allNodes) {
      if (n.backgroundBitmapTagIndex != null) {
        uniqueBitmaps.add(n.backgroundBitmapTagIndex);
      }
    }

    (async () => {
      for (const bitmTagIdx of uniqueBitmaps) {
        if (bitmapCache[bitmTagIdx]) continue;
        try {
          const decoded = await window.opence.getBitmapRgba(bitmTagIdx, 0);
          if (!decoded || !decoded.ok || !decoded.dataUrl || cancelled) continue;
          const img = new Image();
          img.src = decoded.dataUrl;
          await new Promise<void>((res) => {
            img.onload = () => res();
            img.onerror = () => res();
          });
          if (!cancelled) {
            setBitmapCache((prev) => ({ ...prev, [bitmTagIdx]: img }));
          }
        } catch {
          // ignore
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rootCanvasNode, bitmapCache]);

  // Load selected ustr tag strings
  useEffect(() => {
    if (!open || selectedUstrTagIndex == null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await window.opence.getUnicodeStrings(selectedUstrTagIndex);
        if (!cancelled) {
          if (res.ok) {
            setUstrStrings(res.result.strings.map((s) => s.text));
          } else {
            setUstrStrings([]);
          }
          setUstrDirty(false);
        }
      } catch {
        if (!cancelled) setUstrStrings([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, selectedUstrTagIndex]);

  const allFlatNodes = flattenWidgetNodes(rootCanvasNode);
  const selectedNode =
    allFlatNodes.find(
      (n) => `${n.tagIndex}:${n.childWidgetIndex ?? -1}` === selectedNodeKey
    ) ?? rootCanvasNode;

  // Render 640x480 DeLa Menu Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, 640, 480);

    // Classic Halo CE UI dark blue background gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, 480);
    bgGrad.addColorStop(0, '#020916');
    bgGrad.addColorStop(0.5, '#071a38');
    bgGrad.addColorStop(1, '#020814');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 640, 480);

    // Subtle scanline grid
    ctx.strokeStyle = 'rgba(40, 150, 255, 0.06)';
    ctx.lineWidth = 1;
    for (let y = 0; y < 480; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(640, y);
      ctx.stroke();
    }
    for (let x = 0; x < 640; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 480);
      ctx.stroke();
    }

    const drawNode = (node: UiWidgetCanvasNode) => {
      const nodeKey = `${node.tagIndex}:${node.childWidgetIndex ?? -1}`;
      const isSelected = nodeKey === selectedNodeKey;
      const [top, left, bottom, right] = node.screenBounds;
      const w = Math.max(8, right - left);
      const h = Math.max(8, bottom - top);

      ctx.save();
      if (node.backgroundBitmapTagIndex != null && bitmapCache[node.backgroundBitmapTagIndex]) {
        const img = bitmapCache[node.backgroundBitmapTagIndex];
        ctx.drawImage(img, left, top, w, h);
      } else if (node.childWidgetIndex != null) {
        // Fallback Halo CE rounded bar for buttons/text items
        ctx.fillStyle = isSelected ? 'rgba(0, 34, 68, 0.78)' : 'rgba(0, 17, 34, 0.55)';
        ctx.fillRect(left, top, w, h);
      }

      if (node.resolvedTextLabel) {
        ctx.fillStyle = isSelected ? '#FFFFFF' : node.textColorHex || HALO_BLUE;
        ctx.font = 'bold 13px "Segoe UI", Tahoma, sans-serif';
        ctx.textAlign =
          node.justification === 'center'
            ? 'center'
            : node.justification === 'right'
            ? 'right'
            : 'left';
        const textX =
          node.justification === 'center'
            ? left + w / 2
            : node.justification === 'right'
            ? right - 8
            : left + 8;
        const textY = top + Math.min(h / 2 + 5, 20);
        ctx.fillText(node.resolvedTextLabel, textX, textY);
      }

      if (showWireframes || isSelected) {
        ctx.strokeStyle = isSelected
          ? HALO_BORDER_SELECTED
          : 'rgba(40, 150, 255, 0.35)';
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);

        if (isSelected) {
          ctx.fillStyle = '#001122';
          ctx.fillRect(left, Math.max(0, top - 16), Math.min(280, w + 80), 15);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = 'bold 10px monospace';
          ctx.textAlign = 'left';
          ctx.fillText(
            `${node.name} (${left}, ${top}) [${w}×${h}]`,
            left + 4,
            Math.max(11, top - 4)
          );
        }
      }
      ctx.restore();

      for (const child of node.children) {
        drawNode(child);
      }
    };

    if (rootCanvasNode) {
      drawNode(rootCanvasNode);
    }
  }, [rootCanvasNode, selectedNodeKey, bitmapCache, showWireframes]);

  const applySelectedNodeMove = useCallback(
    async (dx: number, dy: number) => {
      if (!selectedNode || selectedWidgetTagIndex == null || !window.opence.updateUiWidgetPlacement) return;
      try {
        if (selectedNode.parentTagIndex != null && selectedNode.childWidgetIndex != null) {
          await window.opence.updateUiWidgetPlacement({
            widgetTagIndex: selectedNode.tagIndex,
            parentTagIndex: selectedNode.parentTagIndex,
            childWidgetIndex: selectedNode.childWidgetIndex,
            horizontalOffset: selectedNode.horizontalOffset + dx,
            verticalOffset: selectedNode.verticalOffset + dy,
          });
        } else {
          const [t, l, b, r] = selectedNode.localBounds;
          await window.opence.updateUiWidgetPlacement({
            widgetTagIndex: selectedNode.tagIndex,
            bounds: [t + dy, l + dx, b + dy, r + dx],
          });
        }
        await loadWidgetCanvas(selectedWidgetTagIndex);
        setStatusMessage(
          `Updated ${selectedNode.name} placement (${dx >= 0 ? `+${dx}` : dx}, ${dy >= 0 ? `+${dy}` : dy})`
        );
      } catch (err) {
        setStatusMessage(err instanceof Error ? err.message : String(err));
      }
    },
    [selectedNode, selectedWidgetTagIndex, loadWidgetCanvas]
  );

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!rootCanvasNode || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = 640 / rect.width;
    const scaleY = 480 / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;

    // Hit-test reverse order (topmost child first)
    const nodes = flattenWidgetNodes(rootCanvasNode).reverse();
    const hit =
      nodes.find((n) => {
        const [top, left, bottom, right] = n.screenBounds;
        const w = Math.max(12, right - left);
        const h = Math.max(12, bottom - top);
        return cx >= left && cx <= left + w && cy >= top && cy <= top + h;
      }) ?? rootCanvasNode;

    const key = `${hit.tagIndex}:${hit.childWidgetIndex ?? -1}`;
    setSelectedNodeKey(key);

    dragStateRef.current = {
      active: true,
      node: hit,
      startMouseX: cx,
      startMouseY: cy,
      origHorizontalOffset: hit.horizontalOffset,
      origVerticalOffset: hit.verticalOffset,
      origBounds: [...hit.localBounds] as [number, number, number, number],
      curDeltaX: 0,
      curDeltaY: 0,
    };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragStateRef.current;
    if (!drag || !drag.active || !canvasRef.current || !rootCanvasNode) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = 640 / rect.width;
    const scaleY = 480 / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    const dx = Math.round(cx - drag.startMouseX);
    const dy = Math.round(cy - drag.startMouseY);
    drag.curDeltaX = dx;
    drag.curDeltaY = dy;
  };

  const handleCanvasMouseUp = async () => {
    const drag = dragStateRef.current;
    if (!drag || !drag.active) return;
    dragStateRef.current = null;
    if (drag.curDeltaX !== 0 || drag.curDeltaY !== 0) {
      await applySelectedNodeMove(drag.curDeltaX, drag.curDeltaY);
    }
  };

  const handleNavigateIntoWidget = (targetWidgetTagIndex: number) => {
    if (selectedWidgetTagIndex != null) {
      setWidgetHistory((prev) => [...prev, selectedWidgetTagIndex]);
    }
    setSelectedWidgetTagIndex(targetWidgetTagIndex);
  };

  const handleNavigateBack = () => {
    if (widgetHistory.length === 0) return;
    const prev = widgetHistory[widgetHistory.length - 1];
    setWidgetHistory((h) => h.slice(0, -1));
    setSelectedWidgetTagIndex(prev);
  };

  const handleSaveUstrTable = async () => {
    if (selectedUstrTagIndex == null || !window.opence.saveUnicodeStringTable) return;
    setUstrSaving(true);
    try {
      const res = await window.opence.saveUnicodeStringTable(
        selectedUstrTagIndex,
        ustrStrings
      );
      if (!res.ok) {
        setStatusMessage(res.message);
        return;
      }
      setUstrDirty(false);
      setStatusMessage(
        `Saved ${res.entryCount} UTF-16LE string(s) into tag #${selectedUstrTagIndex}`
      );
      if (onTagsChanged) await onTagsChanged();
      if (selectedWidgetTagIndex != null) {
        await loadWidgetCanvas(selectedWidgetTagIndex);
      }
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setUstrSaving(false);
    }
  };

  if (!open) return null;

  const filteredWidgets = (catalog?.uiWidgets ?? []).filter(
    (w) =>
      !widgetSearch.trim() ||
      w.path.toLowerCase().includes(widgetSearch.toLowerCase()) ||
      w.displayName.toLowerCase().includes(widgetSearch.toLowerCase())
  );

  const filteredUstrTags = (catalog?.unicodeStringLists ?? []).filter(
    (u) =>
      !ustrSearch.trim() ||
      u.path.toLowerCase().includes(ustrSearch.toLowerCase())
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        backgroundColor: 'rgba(2, 6, 14, 0.88)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          width: 'min(1320px, 96vw)',
          height: 'min(860px, 92vh)',
          backgroundColor: '#001122',
          border: `2px solid ${HALO_BORDER_SELECTED}`,
          borderRadius: 10,
          boxShadow: '0 24px 70px rgba(0, 0, 0, 0.85)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: '#E6F2FF',
          fontFamily: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
        }}
      >
        {/* Top Halo CE style header bar */}
        <div
          style={{
            padding: '12px 18px',
            backgroundColor: '#001a35',
            borderBottom: `2px solid ${HALO_BLUE}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span
              style={{
                fontSize: 16,
                fontWeight: 800,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                color: '#FFFFFF',
              }}
            >
              🖥️ UI.MAP &amp; MENU WIDGET STUDIO (DeLa + ustr)
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => setActiveTab('canvas')}
                style={{
                  backgroundColor: activeTab === 'canvas' ? '#002244' : '#001122',
                  color: activeTab === 'canvas' ? '#FFFFFF' : HALO_BLUE,
                  border: `1.5px solid ${
                    activeTab === 'canvas' ? HALO_BORDER_SELECTED : 'rgba(40,150,255,0.35)'
                  }`,
                  borderRadius: 6,
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                🖥️ 640×480 DeLa Menu Canvas ({catalog?.uiWidgets.length ?? 0})
              </button>
              <button
                onClick={() => setActiveTab('ustr')}
                style={{
                  backgroundColor: activeTab === 'ustr' ? '#002244' : '#001122',
                  color: activeTab === 'ustr' ? '#FFFFFF' : HALO_BLUE,
                  border: `1.5px solid ${
                    activeTab === 'ustr' ? HALO_BORDER_SELECTED : 'rgba(40,150,255,0.35)'
                  }`,
                  borderRadius: 6,
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                🔤 Unicode String Table Editor ({catalog?.unicodeStringLists.length ?? 0})
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {statusMessage && (
              <span style={{ fontSize: 12, color: '#60A5FA' }}>{statusMessage}</span>
            )}
            <button
              onClick={onClose}
              style={{
                backgroundColor: '#002244',
                color: '#FFFFFF',
                border: `1px solid ${HALO_BLUE}`,
                borderRadius: 6,
                padding: '5px 12px',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              ✕ Close
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 32, color: HALO_BLUE }}>
            Scanning UI widget definitions (DeLa) and Unicode string lists (ustr)...
          </div>
        ) : activeTab === 'canvas' ? (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Left Sidebar: DeLa Widget List */}
            <div
              style={{
                width: 300,
                borderRight: '1px solid rgba(40, 150, 255, 0.25)',
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: 'rgba(0, 12, 24, 0.75)',
              }}
            >
              <div style={{ padding: 10, borderBottom: '1px solid rgba(40,150,255,0.2)' }}>
                <input
                  type="text"
                  placeholder="Filter DeLa menu screens..."
                  value={widgetSearch}
                  onChange={(e) => setWidgetSearch(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    backgroundColor: '#001933',
                    color: '#FFFFFF',
                    border: `1px solid ${HALO_BLUE}`,
                    borderRadius: 5,
                    padding: '6px 9px',
                    fontSize: 12,
                  }}
                />
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {filteredWidgets.length === 0 ? (
                  <div style={{ padding: 12, fontSize: 12, color: '#94A3B8' }}>
                    No <code>DeLa</code> (ui_widget_definition) tags found in this map. Open <code>ui.map</code> or a map containing UI widgets.
                  </div>
                ) : (
                  filteredWidgets.map((w) => {
                    const isSel = w.tagIndex === selectedWidgetTagIndex;
                    return (
                      <div
                        key={w.tagIndex}
                        onClick={() => {
                          setWidgetHistory([]);
                          setSelectedWidgetTagIndex(w.tagIndex);
                        }}
                        style={{
                          padding: '7px 10px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          backgroundColor: isSel ? '#002244' : 'rgba(0, 17, 34, 0.65)',
                          border: isSel
                            ? `1.5px solid ${HALO_BORDER_SELECTED}`
                            : '1.5px solid transparent',
                          color: isSel ? '#FFFFFF' : HALO_BLUE,
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 700 }}>{w.displayName}</div>
                        <div
                          style={{
                            fontSize: 10,
                            opacity: 0.75,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {w.path} ({w.childCount} children)
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Center 640x480 Interactive Canvas */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#010812',
                padding: 16,
                gap: 10,
              }}
            >
              <div
                style={{
                  width: '100%',
                  maxWidth: 768,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {widgetHistory.length > 0 && (
                    <button
                      onClick={handleNavigateBack}
                      style={{
                        backgroundColor: '#002244',
                        color: '#FFFFFF',
                        border: `1px solid ${HALO_BLUE}`,
                        borderRadius: 5,
                        padding: '4px 10px',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      ◀ Back to Parent Screen
                    </button>
                  )}
                  <span style={{ fontSize: 12, color: HALO_BLUE, fontWeight: 700 }}>
                    {rootCanvasNode?.path ?? 'Select a DeLa menu widget'}
                  </span>
                </div>
                <label style={{ fontSize: 12, color: '#93C5FD', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showWireframes}
                    onChange={(e) => setShowWireframes(e.target.checked)}
                  />
                  Show Widget Wireframes
                </label>
              </div>

              <canvas
                ref={canvasRef}
                width={640}
                height={480}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                style={{
                  width: 768,
                  height: 576,
                  border: `2px solid ${HALO_BLUE}`,
                  borderRadius: 6,
                  cursor: 'move',
                  boxShadow: '0 12px 36px rgba(0, 0, 0, 0.75)',
                }}
              />

              <div style={{ fontSize: 11, color: '#94A3B8' }}>
                Click any menu widget to select it • Drag on the 640×480 canvas or use the Inspector nudge controls on the right to reposition • Double-click a button with a linked child screen in the hierarchy to open that screen.
              </div>
            </div>

            {/* Right Sidebar: Selected Widget Inspector & Hierarchy */}
            <div
              style={{
                width: 330,
                borderLeft: '1px solid rgba(40, 150, 255, 0.25)',
                backgroundColor: 'rgba(0, 12, 24, 0.75)',
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                overflowY: 'auto',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800, color: '#FFFFFF', borderBottom: `1px solid ${HALO_BLUE}`, paddingBottom: 6 }}>
                SELECTED WIDGET INSPECTOR
              </div>
              {selectedNode ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                  <div>
                    <div style={{ color: '#94A3B8', fontSize: 11 }}>Widget Name</div>
                    <div style={{ fontWeight: 700, color: '#FFFFFF' }}>{selectedNode.name}</div>
                  </div>
                  <div>
                    <div style={{ color: '#94A3B8', fontSize: 11 }}>Tag Path</div>
                    <div style={{ color: HALO_BLUE, wordBreak: 'break-all', fontSize: 11 }}>
                      {selectedNode.path}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#94A3B8', fontSize: 11 }}>Screen Bounds [Top, Left, Bottom, Right]</div>
                    <div style={{ fontFamily: 'monospace', color: '#E2E8F0' }}>
                      [{selectedNode.screenBounds.join(', ')}]
                    </div>
                  </div>
                  {selectedNode.childWidgetIndex != null && (
                    <div>
                      <div style={{ color: '#94A3B8', fontSize: 11 }}>
                        Child Offset in Parent (#{selectedNode.childWidgetIndex})
                      </div>
                      <div style={{ fontFamily: 'monospace', color: '#E2E8F0' }}>
                        X: {selectedNode.horizontalOffset}, Y: {selectedNode.verticalOffset}
                      </div>
                    </div>
                  )}

                  {/* Nudge pad */}
                  <div
                    style={{
                      backgroundColor: '#001933',
                      border: '1px solid rgba(40,150,255,0.3)',
                      borderRadius: 6,
                      padding: 10,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <div style={{ fontSize: 11, color: HALO_BLUE, fontWeight: 700 }}>
                      NUDGE POSITION (PIXELS)
                    </div>
                    <button
                      onClick={() => void applySelectedNodeMove(0, -2)}
                      style={{ backgroundColor: '#002244', color: '#FFF', border: `1px solid ${HALO_BLUE}`, borderRadius: 4, padding: '3px 14px', cursor: 'pointer' }}
                    >
                      ▲ Up (-2)
                    </button>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => void applySelectedNodeMove(-2, 0)}
                        style={{ backgroundColor: '#002244', color: '#FFF', border: `1px solid ${HALO_BLUE}`, borderRadius: 4, padding: '3px 12px', cursor: 'pointer' }}
                      >
                        ◀ Left (-2)
                      </button>
                      <button
                        onClick={() => void applySelectedNodeMove(2, 0)}
                        style={{ backgroundColor: '#002244', color: '#FFF', border: `1px solid ${HALO_BLUE}`, borderRadius: 4, padding: '3px 12px', cursor: 'pointer' }}
                      >
                        Right (+2) ▶
                      </button>
                    </div>
                    <button
                      onClick={() => void applySelectedNodeMove(0, 2)}
                      style={{ backgroundColor: '#002244', color: '#FFF', border: `1px solid ${HALO_BLUE}`, borderRadius: 4, padding: '3px 14px', cursor: 'pointer' }}
                    >
                      ▼ Down (+2)
                    </button>
                  </div>

                  {selectedNode.resolvedTextLabel ? (
                    <div
                      style={{
                        backgroundColor: '#001933',
                        border: '1px solid rgba(40,150,255,0.3)',
                        borderRadius: 6,
                        padding: 10,
                      }}
                    >
                      <div style={{ fontSize: 11, color: '#94A3B8' }}>
                        Bound Unicode Label (idx #{selectedNode.stringListIndex})
                      </div>
                      <div style={{ fontWeight: 700, color: '#FFFFFF', margin: '4px 0' }}>
                        &ldquo;{selectedNode.resolvedTextLabel}&rdquo;
                      </div>
                      {selectedNode.unicodeStringListTagIndex != null && (
                        <button
                          onClick={() => {
                            setSelectedUstrTagIndex(selectedNode.unicodeStringListTagIndex);
                            setActiveTab('ustr');
                          }}
                          style={{
                            marginTop: 4,
                            backgroundColor: '#002244',
                            color: HALO_BLUE,
                            border: `1px solid ${HALO_BLUE}`,
                            borderRadius: 4,
                            padding: '4px 8px',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          🔤 Edit in Unicode String Table
                        </button>
                      )}
                    </div>
                  ) : null}

                  {selectedNode.opensWidgetTagIndex != null && (
                    <button
                      onClick={() => handleNavigateIntoWidget(selectedNode.opensWidgetTagIndex!)}
                      style={{
                        backgroundColor: '#002b55',
                        color: '#FFFFFF',
                        border: `1.5px solid ${HALO_BORDER_SELECTED}`,
                        borderRadius: 6,
                        padding: '7px 10px',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      ▶ Open Linked Screen ({selectedNode.opensWidgetPath.split('\\').pop()})
                    </button>
                  )}
                </div>
              ) : null}

              <div style={{ fontSize: 12, fontWeight: 800, color: '#FFFFFF', borderBottom: `1px solid ${HALO_BLUE}`, paddingBottom: 4, marginTop: 8 }}>
                SCREEN CHILD WIDGETS ({allFlatNodes.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
                {allFlatNodes.map((node) => {
                  const key = `${node.tagIndex}:${node.childWidgetIndex ?? -1}`;
                  const isSel = key === selectedNodeKey;
                  return (
                    <div
                      key={key}
                      onClick={() => setSelectedNodeKey(key)}
                      onDoubleClick={() => {
                        if (node.opensWidgetTagIndex != null) {
                          handleNavigateIntoWidget(node.opensWidgetTagIndex);
                        }
                      }}
                      style={{
                        padding: '5px 8px',
                        borderRadius: 5,
                        cursor: 'pointer',
                        backgroundColor: isSel ? '#002244' : 'rgba(0, 17, 34, 0.6)',
                        border: isSel ? `1px solid ${HALO_BORDER_SELECTED}` : '1px solid transparent',
                        fontSize: 11,
                        color: isSel ? '#FFFFFF' : HALO_BLUE,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>
                        {node.childWidgetIndex == null ? '🖥️ ' : '  ↳ '}
                        {node.name}
                        {node.resolvedTextLabel ? ` ("${node.resolvedTextLabel}")` : ''}
                      </span>
                      {node.opensWidgetTagIndex != null && (
                        <span style={{ fontSize: 10, color: '#60A5FA' }}>▶</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          /* Tab 2: Unicode String List (ustr) Table Editor */
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Left Sidebar: ustr Tag List */}
            <div
              style={{
                width: 320,
                borderRight: '1px solid rgba(40, 150, 255, 0.25)',
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: 'rgba(0, 12, 24, 0.75)',
              }}
            >
              <div style={{ padding: 10, borderBottom: '1px solid rgba(40,150,255,0.2)' }}>
                <input
                  type="text"
                  placeholder="Filter ustr string tags..."
                  value={ustrSearch}
                  onChange={(e) => setUstrSearch(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    backgroundColor: '#001933',
                    color: '#FFFFFF',
                    border: `1px solid ${HALO_BLUE}`,
                    borderRadius: 5,
                    padding: '6px 9px',
                    fontSize: 12,
                  }}
                />
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {filteredUstrTags.map((u) => {
                  const isSel = u.tagIndex === selectedUstrTagIndex;
                  return (
                    <div
                      key={u.tagIndex}
                      onClick={() => setSelectedUstrTagIndex(u.tagIndex)}
                      style={{
                        padding: '7px 10px',
                        borderRadius: 6,
                        cursor: 'pointer',
                        backgroundColor: isSel ? '#002244' : 'rgba(0, 17, 34, 0.65)',
                        border: isSel
                          ? `1.5px solid ${HALO_BORDER_SELECTED}`
                          : '1.5px solid transparent',
                        color: isSel ? '#FFFFFF' : HALO_BLUE,
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700 }}>
                        {u.path.split('\\').pop()}
                      </div>
                      <div style={{ fontSize: 10, opacity: 0.75, wordBreak: 'break-all' }}>
                        {u.path}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right String Table Editor */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 16, gap: 12, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <input
                  type="text"
                  placeholder="Search string content or index..."
                  value={ustrFilter}
                  onChange={(e) => setUstrFilter(e.target.value)}
                  style={{
                    flex: 1,
                    backgroundColor: '#001933',
                    color: '#FFFFFF',
                    border: `1px solid ${HALO_BLUE}`,
                    borderRadius: 6,
                    padding: '7px 12px',
                    fontSize: 12,
                  }}
                />
                <button
                  onClick={() => {
                    setUstrStrings((prev) => [...prev, 'New String']);
                    setUstrDirty(true);
                  }}
                  style={{
                    backgroundColor: '#002244',
                    color: HALO_BLUE,
                    border: `1px solid ${HALO_BLUE}`,
                    borderRadius: 6,
                    padding: '7px 14px',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  + Add String Entry
                </button>
                <button
                  disabled={!ustrDirty || ustrSaving}
                  onClick={() => void handleSaveUstrTable()}
                  style={{
                    backgroundColor: ustrDirty ? '#0284C7' : '#1E293B',
                    color: '#FFFFFF',
                    border: `1.5px solid ${ustrDirty ? '#38BDF8' : '#334155'}`,
                    borderRadius: 6,
                    padding: '7px 16px',
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: ustrDirty ? 'pointer' : 'not-allowed',
                  }}
                >
                  {ustrSaving ? 'Saving UTF-16LE...' : '💾 Save String Table to Map'}
                </button>
              </div>

              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  paddingRight: 4,
                }}
              >
                {ustrStrings.map((str, idx) => {
                  if (
                    ustrFilter.trim() &&
                    !str.toLowerCase().includes(ustrFilter.toLowerCase()) &&
                    !String(idx).includes(ustrFilter.trim())
                  ) {
                    return null;
                  }
                  return (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        backgroundColor: 'rgba(0, 25, 51, 0.75)',
                        border: '1px solid rgba(40, 150, 255, 0.25)',
                        borderRadius: 6,
                        padding: '6px 10px',
                      }}
                    >
                      <span
                        style={{
                          minWidth: 48,
                          fontFamily: 'monospace',
                          fontSize: 12,
                          color: HALO_BLUE,
                          fontWeight: 700,
                        }}
                      >
                        #{idx}
                      </span>
                      <input
                        type="text"
                        value={str}
                        onChange={(e) => {
                          const val = e.target.value;
                          setUstrStrings((prev) => {
                            const next = [...prev];
                            next[idx] = val;
                            return next;
                          });
                          setUstrDirty(true);
                        }}
                        style={{
                          flex: 1,
                          backgroundColor: '#001122',
                          color: '#FFFFFF',
                          border: '1px solid rgba(40, 150, 255, 0.35)',
                          borderRadius: 4,
                          padding: '5px 8px',
                          fontSize: 12,
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
