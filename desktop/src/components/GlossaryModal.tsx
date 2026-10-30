import { useMemo, useState } from 'react';

interface UiAtlasZone {
  id: string;
  code: string;
  title: string;
  location: string;
  summary: string;
  controls: Array<{ name: string; description: string }>;
}

const UI_ATLAS_ZONES: UiAtlasZone[] = [
  {
    id: 'menubar',
    code: 'ZONE 1',
    title: 'Frameless Menu Bar & Integrated Window Controls',
    location: 'Top Edge of Window',
    summary:
      'Provides File, Tools, and Help menus on the left, draggable window header in the center, and native Minimize (─), Maximize/Restore (□/❐), and Close (✕) controls in the top-right corner.',
    controls: [
      { name: 'File Menu', description: 'Open Map (Ctrl+O), Save (Ctrl+S), Save As (Ctrl+Shift+S), Recent Maps, and Convert to Custom Edition.' },
      { name: 'Tools Menu', description: 'Decompress/Recompress, Extract/Inject, Swap BSP, Compare Maps, Live HUD Studio, UI.map Studio, Content Explorer, and Settings.' },
      { name: 'Window Controls (─ □ ✕)', description: 'Frameless Minimize, Maximize/Restore, and Close buttons integrated directly into the UI.' },
    ],
  },
  {
    id: 'launcher',
    code: 'ZONE 2',
    title: 'Guilty Spark Workspace Launcher & Top Ribbon',
    location: 'Home View (When Launching or Clicking [⌂ Launcher])',
    summary:
      'Main project hub displaying the Check Updates and Change Theme ribbon at the top, Open Map & Knowledge Hub links on the left, and the Recent Maps grid with top-down 2D BSP wireframe previews on the right.',
    controls: [
      { name: '⬆ Check Updates (Far Left)', description: 'Checks GitHub Releases for newer Mantle builds and offers one-click download & restart.' },
      { name: '★ Change Theme (Far Right)', description: 'Opens the 6-theme selector popup (Native Dark, Light Mode, Forerunner, Classic CE Navy, Covenant, UNSC).' },
      { name: 'Recent Maps BSP Wireframe Cards', description: 'Renders each recent map’s actual scenario_structure_bsp (sbsp) mesh from a top-down orthographic projection.' },
    ],
  },
  {
    id: 'toolbar',
    code: 'ZONE 3',
    title: 'Editor Action Toolbar',
    location: 'Directly Below Menu Bar (When a Map is Open)',
    summary:
      'One-click access to map saving, tag extraction/injection, BSP swapping, 3D object building, map comparison, Live HUD editing, UI.map Studio, and OpenCE Tag Test.',
    controls: [
      { name: 'Extract... / Whole Map', description: 'Walks tag dependencies and exports portable .ocetags packages or standard 64-byte Blam loose tags.' },
      { name: 'Inject... / Swap BSP / Build Object', description: 'Injects .ocetags packages, transplants structure BSPs, or builds new 3D objects from .obj/.jms/.dae.' },
      { name: 'Live HUD / UI Studio / Loose tags/', description: 'Opens specialized workbenches for real-time HUD memory editing, UI.map DeLa menus, and loose HEK folders.' },
    ],
  },
  {
    id: 'tag-tree',
    code: 'ZONE 4',
    title: 'Left Tag Tree & Class Explorer',
    location: 'Left Docked Column',
    summary:
      'Displays all tags inside the open .map file grouped by their 4-character Blam tag class (scnr, sbsp, weap, vehi, bitm, etc.) with instant substring filtering.',
    controls: [
      { name: 'Search Filter Input', description: 'Filters tags by path or class name in real time.' },
      { name: 'Right-Click Context Menu', description: 'Rename tag path, duplicate tag, delete tag, inspect referencing tags, or open in Content Explorer.' },
    ],
  },
  {
    id: 'inspector',
    code: 'ZONE 5',
    title: 'Center Tag Inspector, Dependency Swapper & Media Studio',
    location: 'Center Workspace Area',
    summary:
      'Context-sensitive editor that adapts to the selected tag: structured Blam field editor, reflexive block organizer, dependency swapper, bitmap painter, sound player, or HaloScript IDE.',
    controls: [
      { name: 'Tag Fields & Reflexive Blocks', description: 'Edits scalar values, enums, bitmasks, and reflexive arrays (+ Add/Clone Chunk, TSV Export/Import).' },
      { name: 'Dependency Swapper & Referencing Tags', description: 'Rewires outgoing tag references or inspects every tag that points to the selected tag.' },
    ],
  },
  {
    id: 'viewport-3d',
    code: 'ZONE 6',
    title: '3D BSP & Model Viewport',
    location: 'Center / Right 3D Canvas',
    summary:
      'Hardware-accelerated Three.js viewport for flying through textured structure BSPs, moving/rotating scenario objects with 3D gizmos, previewing gbxmodels, and sculpting vertices.',
    controls: [
      { name: 'Fly Camera (Right-Click + WASD)', description: 'Hold Right-Click and use WASD (plus Q/E and Shift) to navigate the 3D level.' },
      { name: 'Object Transform Gizmos (G / R)', description: 'Click any placed vehicle, weapon, scenery, or spawn point to translate, rotate, duplicate, or swap it.' },
    ],
  },
  {
    id: 'bottom-tabs',
    code: 'ZONE 7',
    title: 'Bottom Open-Map Tab Bar, Split View & 2nd Monitor Tear-Off',
    location: 'Bottom Dock (Above Status Bar)',
    summary:
      'Shows all currently open .map sessions so you can switch maps in <1ms, compare two maps side-by-side with a draggable divider, or drag a tab out onto a second monitor.',
    controls: [
      { name: '[⌂ Launcher] & Open Map Tabs', description: 'Switch between the Launcher Home and any open map without closing your active sessions.' },
      { name: '[◫ Split Side-by-Side] & Tear-Off (↗)', description: 'Compare two open maps side by side in the same window or tear a tab off into a second window.' },
    ],
  },
];

interface TagGlossaryEntry {
  fourCC: string;
  name: string;
  category: string;
  description: string;
}

const TAG_GLOSSARY: TagGlossaryEntry[] = [
  { fourCC: 'scnr', name: 'scenario', category: 'Level / Mission', description: 'Master level tag defining BSP references, object palettes, placements, player spawns, encounters, and compiled HaloScript.' },
  { fourCC: 'sbsp', name: 'scenario_structure_bsp', category: 'Level / Mission', description: '3D level geometry, collision BSP tree, lightmap meshes, weather polyhedra, and cluster portals.' },
  { fourCC: 'weap', name: 'weapon', category: 'Objects & Items', description: 'First/third-person weapon definition including magazines, triggers, firing rates, projectiles, and HUD interface links.' },
  { fourCC: 'vehi', name: 'vehicle', category: 'Objects & Items', description: 'Driveable or AI vehicle definition including physics modes, seats, powered mass points, and turret weapons.' },
  { fourCC: 'bipd', name: 'biped', category: 'Objects & Items', description: 'Character/Spartan/AI unit body definition linking model, animation graph, collision, and camera height.' },
  { fourCC: 'eqip', name: 'equipment', category: 'Objects & Items', description: 'Pickups such as powerups (overshield, active camo), health packs, ammo packs, and grenades.' },
  { fourCC: 'proj', name: 'projectile', category: 'Combat & Physics', description: 'Ballistic or energy projectile velocity, gravity scale, homing, detonation effects, and material responses.' },
  { fourCC: 'jpt!', name: 'damage_effect', category: 'Combat & Physics', description: 'Radius, damage bounds, shield/health multipliers, camera shake, and instantaneous impulse.' },
  { fourCC: 'mode', name: 'gbxmodel', category: '3D Models & Animation', description: 'Gearbox 3D render mesh containing nodes, regions, permutations, LODs, vertices, and shader references.' },
  { fourCC: 'coll', name: 'model_collision_geometry', category: '3D Models & Animation', description: '3D collision BSP spheres, boxes, pathfinding spheres, and shield/body damage regions for an object.' },
  { fourCC: 'antr', name: 'model_animations', category: '3D Models & Animation', description: 'Skeletal animation graph containing unit, weapon, vehicle, and first-person keyframe data.' },
  { fourCC: 'phys', name: 'physics', category: 'Combat & Physics', description: 'Inertial matrix, center of mass, ground friction, and powered mass points for vehicles.' },
  { fourCC: 'bitm', name: 'bitmap', category: 'Media & Shaders', description: '2D textures, cubemaps, volume textures, and HUD/UI sprite sheets (DXT1/DXT3/DXT5/A8R8G8B8).' },
  { fourCC: 'snd!', name: 'sound', category: 'Media & Shaders', description: 'Audio tag containing pitch ranges and permutations (Xbox ADPCM, PCM WAV, or Ogg Vorbis).' },
  { fourCC: 'senv', name: 'shader_environment', category: 'Media & Shaders', description: 'BSP surface material shader with base map, detail maps, bump map, and specular/self-illumination properties.' },
  { fourCC: 'soso', name: 'shader_model', category: 'Media & Shaders', description: 'Opaque or masked 3D object shader used on weapons, vehicles, bipeds, and scenery.' },
  { fourCC: 'wphi', name: 'weapon_hud_interface', category: 'HUD & UI', description: 'Crosshairs, ammo meters, static bitmaps, and screen anchors for a weapon’s first-person HUD.' },
  { fourCC: 'unhi', name: 'unit_hud_interface', category: 'HUD & UI', description: 'Shield bar, health meter, motion sensor radar, and auxiliary HUD meters for a biped/vehicle.' },
  { fourCC: 'DeLa', name: 'ui_widget_definition', category: 'HUD & UI', description: 'Menu screen widget layout box, event handlers, child widgets, and string list bindings inside ui.map.' },
  { fourCC: 'ustr', name: 'unicode_string_list', category: 'HUD & UI', description: 'UTF-16 localized text array referenced by UI widgets, HUD messages, and item pickup prompts.' },
];

interface GlossaryModalProps {
  onClose: () => void;
}

export default function GlossaryModal({ onClose }: GlossaryModalProps) {
  const [activeTab, setActiveTab] = useState<'ui-atlas' | 'tag-classes'>('ui-atlas');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedZoneId, setSelectedZoneId] = useState<string>(UI_ATLAS_ZONES[0].id);

  const filteredZones = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return UI_ATLAS_ZONES;
    return UI_ATLAS_ZONES.filter(
      (z) =>
        z.title.toLowerCase().includes(q) ||
        z.summary.toLowerCase().includes(q) ||
        z.controls.some(
          (c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
        ),
    );
  }, [searchQuery]);

  const filteredTagClasses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return TAG_GLOSSARY;
    return TAG_GLOSSARY.filter(
      (t) =>
        t.fourCC.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  const activeZone =
    filteredZones.find((z) => z.id === selectedZoneId) ?? filteredZones[0] ?? UI_ATLAS_ZONES[0];

  return (
    <div
      data-testid="glossary-modal-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1200,
      }}
    >
      <div
        data-testid="glossary-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 920,
          maxWidth: '95vw',
          height: 640,
          maxHeight: '90vh',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 2,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.65)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 16px',
            background: 'var(--bg-panel-header)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-primary)' }}>
              OpenCE Mantle Glossary — Visual UI Atlas &amp; Blam Tag Class Reference
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
              Interactive map of every UI panel in Mantle plus a searchable Halo CE tag class dictionary
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              padding: '4px 10px',
              borderRadius: 2,
              fontSize: 12,
            }}
          >
            ✕
          </button>
        </div>

        {/* Sub-Toolbar: Tabs + Search */}
        <div
          style={{
            padding: '8px 16px',
            background: 'var(--bg-control)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              data-testid="glossary-tab-ui-atlas"
              onClick={() => setActiveTab('ui-atlas')}
              style={{
                padding: '5px 12px',
                fontSize: 12,
                fontWeight: 600,
                background: activeTab === 'ui-atlas' ? 'var(--selection-bg)' : 'var(--bg-panel)',
                border: activeTab === 'ui-atlas' ? '1px solid var(--border-active)' : '1px solid var(--border)',
                color: activeTab === 'ui-atlas' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                borderRadius: 2,
              }}
            >
              Visual UI Atlas ({UI_ATLAS_ZONES.length} Zones)
            </button>
            <button
              data-testid="glossary-tab-tag-classes"
              onClick={() => setActiveTab('tag-classes')}
              style={{
                padding: '5px 12px',
                fontSize: 12,
                fontWeight: 600,
                background: activeTab === 'tag-classes' ? 'var(--selection-bg)' : 'var(--bg-panel)',
                border: activeTab === 'tag-classes' ? '1px solid var(--border-active)' : '1px solid var(--border)',
                color: activeTab === 'tag-classes' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                borderRadius: 2,
              }}
            >
              Blam Tag Classes ({TAG_GLOSSARY.length})
            </button>
          </div>

          <input
            data-testid="glossary-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              activeTab === 'ui-atlas'
                ? 'Search UI panels, buttons, or features...'
                : 'Search 4-char tag class (e.g. weap, sbsp, DeLa)...'
            }
            style={{
              width: 300,
              padding: '5px 10px',
              fontSize: 12,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              borderRadius: 2,
              outline: 'none',
            }}
          />
        </div>

        {/* Content Area */}
        {activeTab === 'ui-atlas' ? (
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* Left Zone List */}
            <div
              style={{
                width: 290,
                borderRight: '1px solid var(--border)',
                background: 'var(--bg-control)',
                overflowY: 'auto',
                padding: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {filteredZones.map((zone) => {
                const selected = zone.id === activeZone?.id;
                return (
                  <button
                    key={zone.id}
                    onClick={() => setSelectedZoneId(zone.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      background: selected ? 'var(--selection-bg)' : 'transparent',
                      border: selected ? '1px solid var(--border-active)' : '1px solid transparent',
                      borderRadius: 2,
                      color: 'var(--text-primary)',
                    }}
                  >
                    <div style={{ fontFamily: 'var(--mono-font)', fontSize: 10, color: 'var(--accent-cyan)' }}>
                      {zone.code} • {zone.location}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 12, marginTop: 2 }}>{zone.title}</div>
                  </button>
                );
              })}
            </div>

            {/* Right Interactive UI Diagram + Controls Breakdown */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Clickable Wireframe Map of Mantle UI */}
              <div
                style={{
                  border: '1px solid var(--border)',
                  background: 'var(--bg-main)',
                  borderRadius: 2,
                  padding: 10,
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--mono-font)',
                    fontSize: 10.5,
                    color: 'var(--text-secondary)',
                    marginBottom: 6,
                  }}
                >
                  CLICK ANY ZONE BELOW TO INSPECT ITS CONTROLS:
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--mono-font)', fontSize: 10 }}>
                  <div
                    onClick={() => setSelectedZoneId('menubar')}
                    style={{
                      padding: '5px 8px',
                      cursor: 'pointer',
                      border: activeZone?.id === 'menubar' ? '1.5px solid var(--accent-cyan)' : '1px solid var(--border)',
                      background: activeZone?.id === 'menubar' ? 'var(--selection-bg)' : 'var(--bg-control)',
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>ZONE 1: MenuBar ([File] [Tools] [Help])</span>
                    <span>[─] [□] [✕]</span>
                  </div>

                  <div
                    onClick={() => setSelectedZoneId('toolbar')}
                    style={{
                      padding: '5px 8px',
                      cursor: 'pointer',
                      border: activeZone?.id === 'toolbar' ? '1.5px solid var(--accent-cyan)' : '1px solid var(--border)',
                      background: activeZone?.id === 'toolbar' ? 'var(--selection-bg)' : 'var(--bg-control)',
                    }}
                  >
                    ZONE 3: Editor Action Toolbar ([Open] [Save] [Extract] [Inject] [Swap BSP] [Build Object] [Live HUD])
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 170px', gap: 4, height: 92 }}>
                    <div
                      onClick={() => setSelectedZoneId('tag-tree')}
                      style={{
                        padding: 6,
                        cursor: 'pointer',
                        border: activeZone?.id === 'tag-tree' ? '1.5px solid var(--accent-cyan)' : '1px solid var(--border)',
                        background: activeZone?.id === 'tag-tree' ? 'var(--selection-bg)' : 'var(--bg-control)',
                      }}
                    >
                      ZONE 4: Left Tag Tree
                      <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 4 }}>
                        Search + 4-Char Tag Classes
                      </div>
                    </div>

                    <div
                      onClick={() => setSelectedZoneId('inspector')}
                      style={{
                        padding: 6,
                        cursor: 'pointer',
                        border: activeZone?.id === 'inspector' ? '1.5px solid var(--accent-cyan)' : '1px solid var(--border)',
                        background: activeZone?.id === 'inspector' ? 'var(--selection-bg)' : 'var(--bg-control)',
                      }}
                    >
                      ZONE 5: Center Tag Field Editor / Deps / Media / HaloScript
                      <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 4 }}>
                        Structured Blam Fields &amp; Reflexives
                      </div>
                    </div>

                    <div
                      onClick={() => setSelectedZoneId('viewport-3d')}
                      style={{
                        padding: 6,
                        cursor: 'pointer',
                        border: activeZone?.id === 'viewport-3d' ? '1.5px solid var(--accent-cyan)' : '1px solid var(--border)',
                        background: activeZone?.id === 'viewport-3d' ? 'var(--selection-bg)' : 'var(--bg-control)',
                      }}
                    >
                      ZONE 6: 3D BSP &amp; Model Viewport
                      <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 4 }}>
                        Flycam &amp; Placement Gizmos
                      </div>
                    </div>
                  </div>

                  <div
                    onClick={() => setSelectedZoneId('bottom-tabs')}
                    style={{
                      padding: '5px 8px',
                      cursor: 'pointer',
                      border: activeZone?.id === 'bottom-tabs' ? '1.5px solid var(--accent-cyan)' : '1px solid var(--border)',
                      background: activeZone?.id === 'bottom-tabs' ? 'var(--selection-bg)' : 'var(--bg-control)',
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>ZONE 7: Bottom Map Tab Bar ([⌂ Launcher] [bloodgulch.map] [+])</span>
                    <span>[◫ Split Side-by-Side]</span>
                  </div>
                </div>
              </div>

              {/* Active Zone Details */}
              {activeZone && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <div style={{ fontFamily: 'var(--mono-font)', fontSize: 11, color: 'var(--accent-cyan)' }}>
                      {activeZone.code} — {activeZone.location}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
                      {activeZone.title}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.45 }}>
                      {activeZone.summary}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {activeZone.controls.map((ctrl) => (
                      <div
                        key={ctrl.name}
                        style={{
                          padding: '8px 12px',
                          background: 'var(--bg-control)',
                          border: '1px solid var(--border)',
                          borderRadius: 2,
                        }}
                      >
                        <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--accent-cyan)' }}>
                          {ctrl.name}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                          {ctrl.description}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Tab 2: Blam Tag Classes Dictionary */
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
              {filteredTagClasses.map((tag) => (
                <div
                  key={tag.fourCC}
                  style={{
                    padding: '10px 12px',
                    background: 'var(--bg-control)',
                    border: '1px solid var(--border)',
                    borderRadius: 2,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          fontFamily: 'var(--mono-font)',
                          fontSize: 12,
                          fontWeight: 700,
                          padding: '1px 6px',
                          background: 'var(--selection-bg)',
                          border: '1px solid var(--border-active)',
                          color: 'var(--accent-cyan)',
                          borderRadius: 2,
                        }}
                      >
                        {tag.fourCC}
                      </span>
                      <span style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--text-primary)' }}>
                        {tag.name}
                      </span>
                    </div>
                    <span style={{ fontFamily: 'var(--mono-font)', fontSize: 10, color: 'var(--text-dim)' }}>
                      {tag.category}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    {tag.description}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            padding: '10px 16px',
            background: 'var(--bg-panel-header)',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '5px 16px',
              background: 'var(--selection-bg)',
              border: '1px solid var(--border-active)',
              color: 'var(--text-primary)',
              fontWeight: 600,
              fontSize: 12,
              borderRadius: 2,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
