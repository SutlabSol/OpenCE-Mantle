import { useState } from 'react';

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

export default function MenuBar({ menus }: { menus: Menu[] }) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);

  const handleMenuClose = () => {
    setOpenMenu(null);
    setOpenSubmenu(null);
  };

  return (
    <div
      data-testid="main-menu-bar"
      style={{
        display: 'flex',
        background: 'var(--bg-panel-header)',
        borderBottom: '1px solid var(--border)',
        fontSize: 12,
        userSelect: 'none',
        position: 'relative',
      }}
      onMouseLeave={handleMenuClose}
    >
      {menus.map((menu) => (
        <div key={menu.label} style={{ position: 'relative' }}>
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
              padding: '6px 14px',
              color: 'var(--text-secondary)',
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
                minWidth: 200,
                background: 'var(--bg-panel)',
                border: '1px solid var(--border)',
                boxShadow: '2px 4px 10px rgba(0,0,0,0.5)',
                zIndex: 50,
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
                          boxShadow: '2px 4px 10px rgba(0,0,0,0.5)',
                          zIndex: 60,
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
  );
}
