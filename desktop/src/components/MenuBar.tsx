import { useEffect, useState } from 'react';
import logoUrl from '../assets/logo.png';

export interface MenuItem {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  separator?: boolean;
  submenu?: MenuItem[];
}

export interface Menu {
  label: string;
  items: MenuItem[];
}

interface MenuBarProps {
  menus: Menu[];
  activeMapTitle?: string | null;
  isDetachedWindow?: boolean;
  onRedockDetachedWindow?: () => void;
}

export default function MenuBar({
  menus,
  activeMapTitle,
  isDetachedWindow,
  onRedockDetachedWindow,
}: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    window.opence?.windowIsMaximized?.().then((val) => setIsMaximized(Boolean(val))).catch(() => {});
    const unsub = window.opence?.onWindowMaximizedChange?.((val) => setIsMaximized(Boolean(val)));
    return () => {
      unsub?.();
    };
  }, []);

  const handleMenuClose = () => {
    setOpenMenu(null);
    setOpenSubmenu(null);
  };

  return (
    <div
      data-testid="main-menu-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        background: 'var(--bg-panel-header)',
        borderBottom: '1px solid var(--border)',
        fontSize: 12,
        userSelect: 'none',
        position: 'relative',
        height: 29,
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
      onMouseLeave={handleMenuClose}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 10px 0 12px',
          borderRight: '1px solid var(--border)',
          alignSelf: 'stretch',
          flexShrink: 0,
        }}
      >
        <img src={logoUrl} alt="OpenCE Mantle" style={{ width: 16, height: 16, objectFit: 'contain' }} />
        <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 12 }}>OpenCE Mantle</span>
      </div>

      {/* Menu items (no-drag) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          alignSelf: 'stretch',
          flexShrink: 0,
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        {menus.map((menu) => (
          <div key={menu.label} style={{ position: 'relative', alignSelf: 'stretch', display: 'flex' }}>
            <div
              data-testid={`menu-${menu.label.toLowerCase()}`}
              onClick={() => {
                setOpenMenu(openMenu === menu.label ? null : menu.label);
                setOpenSubmenu(null);
              }}
              onMouseEnter={() => {
                if (openMenu) {
                  setOpenMenu(menu.label);
                  setOpenSubmenu(null);
                }
              }}
              style={{
                padding: '0 13px',
                display: 'flex',
                alignItems: 'center',
                color: openMenu === menu.label ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: openMenu === menu.label ? 'var(--bg-hover)' : 'transparent',
                cursor: 'pointer',
              }}
            >
              {menu.label}
            </div>
            {openMenu === menu.label && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  minWidth: 210,
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border)',
                  boxShadow: '2px 4px 12px rgba(0,0,0,0.55)',
                  zIndex: 1100,
                }}
              >
                {menu.items.map((item, idx) => {
                  if (item.separator) {
                    return (
                      <div
                        key={`sep-${idx}`}
                        style={{ height: 1, background: 'var(--border)', margin: '4px 0' }}
                      />
                    );
                  }

                  const hasSubmenu = item.submenu && item.submenu.length > 0;
                  const isSubmenuOpen = openSubmenu === item.label;

                  return (
                    <div
                      key={item.label}
                      style={{ position: 'relative' }}
                      onMouseEnter={() => {
                        if (hasSubmenu) {
                          setOpenSubmenu(item.label);
                        } else {
                          setOpenSubmenu(null);
                        }
                      }}
                    >
                      <button
                        data-testid={`menu-item-${menu.label.toLowerCase()}-${item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}`}
                        disabled={item.disabled}
                        onClick={() => {
                          if (hasSubmenu) {
                            setOpenSubmenu(isSubmenuOpen ? null : item.label);
                          } else {
                            handleMenuClose();
                            item.onClick?.();
                          }
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          width: '100%',
                          textAlign: 'left',
                          background: isSubmenuOpen ? 'var(--selection-bg)' : 'transparent',
                          border: 'none',
                          padding: '7px 16px',
                          color: item.disabled ? 'var(--text-dim)' : 'var(--text-primary)',
                          cursor: item.disabled ? 'default' : 'pointer',
                          fontSize: 12.5,
                          fontFamily: 'var(--ui-font)',
                        }}
                        onMouseEnter={(e) => !item.disabled && (e.currentTarget.style.background = 'var(--selection-bg)')}
                        onMouseLeave={(e) => {
                          if (!isSubmenuOpen) e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <span>{item.label}</span>
                        {hasSubmenu && <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>▸</span>}
                      </button>

                      {hasSubmenu && isSubmenuOpen && (
                        <div
                          data-testid={`submenu-${item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: '100%',
                            minWidth: 190,
                            background: 'var(--bg-panel)',
                            border: '1px solid var(--border)',
                            boxShadow: '2px 4px 12px rgba(0,0,0,0.55)',
                            zIndex: 210,
                          }}
                        >
                          {item.submenu!.map((subItem) => (
                            <button
                              key={subItem.label}
                              data-testid={`menu-item-${menu.label.toLowerCase()}-${subItem.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}`}
                              disabled={subItem.disabled}
                              onClick={() => {
                                handleMenuClose();
                                subItem.onClick?.();
                              }}
                              style={{
                                display: 'block',
                                width: '100%',
                                textAlign: 'left',
                                background: 'transparent',
                                border: 'none',
                                padding: '7px 16px',
                                color: subItem.disabled ? 'var(--text-dim)' : 'var(--text-primary)',
                                cursor: subItem.disabled ? 'default' : 'pointer',
                                fontSize: 12.5,
                                fontFamily: 'var(--ui-font)',
                              }}
                              onMouseEnter={(e) => !subItem.disabled && (e.currentTarget.style.background = 'var(--selection-bg)')}
                              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                            >
                              {subItem.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Center draggable title region */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          overflow: 'hidden',
          padding: '0 12px',
        }}
      >
        {activeMapTitle && (
          <span
            style={{
              fontFamily: 'var(--mono-font)',
              fontSize: 11,
              color: 'var(--text-secondary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {activeMapTitle}
          </span>
        )}
        {isDetachedWindow && onRedockDetachedWindow && (
          <button
            data-testid="redock-detached-window-btn"
            onClick={onRedockDetachedWindow}
            style={{
              WebkitAppRegion: 'no-drag',
              padding: '2px 9px',
              fontSize: 11,
              fontWeight: 600,
              background: 'var(--selection-bg)',
              color: 'var(--accent-cyan)',
              border: '1px solid var(--border-active)',
              borderRadius: 2,
              cursor: 'pointer',
            } as React.CSSProperties}
            title="Close this secondary monitor window and re-dock the map tab back into the main Mantle window"
          >
            ↙ Re-Dock Back Into Main Window
          </button>
        )}
      </div>

      {/* Right-hand frameless window controls (Minimize, Maximize/Restore, Close) */}
      <div
        data-testid="window-controls"
        style={{
          display: 'flex',
          alignItems: 'center',
          alignSelf: 'stretch',
          borderLeft: '1px solid var(--border)',
          flexShrink: 0,
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        <button
          data-testid="window-minimize-btn"
          className="window-ctrl-btn"
          title="Minimize"
          onClick={() => window.opence?.windowMinimize?.()}
        >
          ─
        </button>
        <button
          data-testid="window-maximize-btn"
          className="window-ctrl-btn"
          title={isMaximized ? 'Restore Down' : 'Maximize'}
          onClick={() => {
            window.opence?.windowToggleMaximize?.().then((val) => setIsMaximized(Boolean(val))).catch(() => {});
          }}
        >
          {isMaximized ? '❐' : '□'}
        </button>
        <button
          data-testid="window-close-btn"
          className="window-ctrl-btn window-ctrl-close"
          title="Close"
          onClick={() => window.opence?.windowClose?.()}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
