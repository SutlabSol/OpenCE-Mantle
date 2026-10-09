import { useState } from 'react';

interface MenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface Menu {
  label: string;
  items: MenuItem[];
}

export default function MenuBar({ menus }: { menus: Menu[] }) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);

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
      onMouseLeave={() => setOpenMenu(null)}
    >
      {menus.map((menu) => (
        <div key={menu.label} style={{ position: 'relative' }}>
          <div
            data-testid={`menu-${menu.label.toLowerCase()}`}
            onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
            onMouseEnter={() => openMenu && setOpenMenu(menu.label)}
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
                minWidth: 190,
                background: 'var(--bg-panel)',
                border: '1px solid var(--border)',
                boxShadow: '2px 4px 10px rgba(0,0,0,0.5)',
                zIndex: 50,
              }}
            >
              {menu.items.map((item) => (
                <div
                  key={item.label}
                  data-testid={`menu-item-${menu.label.toLowerCase()}-${item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                  onClick={() => {
                    if (item.disabled) return;
                    setOpenMenu(null);
                    item.onClick();
                  }}
                  style={{
                    padding: '7px 16px',
                    color: item.disabled ? 'var(--text-dim)' : 'var(--text-primary)',
                    cursor: item.disabled ? 'default' : 'pointer',
                    fontSize: 12.5,
                  }}
                  onMouseEnter={(e) => !item.disabled && (e.currentTarget.style.background = 'var(--selection-bg)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  {item.label}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
