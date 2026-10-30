import { useMemo, useState } from 'react';

interface TutorialStep {
  title: string;
  instruction: string;
  uiCallout: string;
}

interface TutorialGuide {
  id: string;
  category: string;
  title: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  duration: string;
  summary: string;
  highlightZone: 'launcher' | 'tag-tree' | 'inspector' | 'viewport-3d' | 'toolbar' | 'bottom-tabs';
  steps: TutorialStep[];
}

const TUTORIAL_GUIDES: TutorialGuide[] = [
  {
    id: 'open-and-inspect',
    category: 'Core Workflow',
    title: '1. Opening Maps & Navigating the Tag Tree',
    difficulty: 'Beginner',
    duration: '3 min',
    summary:
      'Open any Halo Custom Edition, Retail PC, MCC CEA, or Xbox .map file from the Launcher or File menu and browse its tag hierarchy.',
    highlightZone: 'tag-tree',
    steps: [
      {
        title: 'Open a Map from Launcher or Ctrl+O',
        instruction:
          'On the Workspace Launcher home screen, click "Open Map..." on the left sidebar, click any Recent Map BSP wireframe card, or drag and drop a .map file directly onto the window.',
        uiCallout: 'Launcher Sidebar -> Open Map... (Ctrl+O)',
      },
      {
        title: 'Filter by Tag Class or Search by Path',
        instruction:
          'In the left Tag Tree panel, expand any 4-char tag group (such as weap, vehi, bipd, scnr, or sbsp) or type into the Search input at the top of the Tag Tree to filter tags instantaneously.',
        uiCallout: 'Left Panel -> Tag Tree Search & Group Folders',
      },
      {
        title: 'Switch Between Open Maps Using Bottom Tabs',
        instruction:
          'Open additional maps at any time using the [+] button in the bottom tab bar. Click [⌂ Launcher] at the bottom-left to return to the Launcher without closing your open maps.',
        uiCallout: 'Bottom Bar -> [⌂ Launcher] & Open Map Tabs',
      },
    ],
  },
  {
    id: 'edit-tag-fields',
    category: 'Tag Editing',
    title: '2. Editing Tag Fields, Reflexives & Dependency Slots',
    difficulty: 'Beginner',
    duration: '5 min',
    summary:
      'Modify weapon stats, projectile speed, vehicle physics, and tag dependency references in memory and save cleanly to disk.',
    highlightZone: 'inspector',
    steps: [
      {
        title: 'Select a Tag to Open the Field Editor',
        instruction:
          'Click any tag in the left Tag Tree (for example, weapons\\assault rifle\\assault rifle.weap). The center Inspector opens its structured Blam definition fields.',
        uiCallout: 'Center Panel -> Tag Field Editor Tab',
      },
      {
        title: 'Edit Scalar Fields, Flags, Enums & Reflexive Chunks',
        instruction:
          'Change any numeric, enum, bitmask flag, or color field. Expand reflexive arrays (like Magazines, Triggers, or Projectiles) and use "+ Add / Clone Chunk" to add new array elements.',
        uiCallout: 'Center Panel -> Reflexive Block Header -> [+ Clone]',
      },
      {
        title: 'Swap Dependencies & Save (Ctrl+S)',
        instruction:
          'Switch to the "Dependency Swapper" tab to repoint any tag reference (e.g., swapping a weapon’s projectile to a rocket). Press Ctrl+S or click Save on the toolbar to write changes.',
        uiCallout: 'Top Toolbar -> Save (Ctrl+S)',
      },
    ],
  },
  {
    id: 'extract-and-inject',
    category: 'Porting & Containers',
    title: '3. Extracting & Injecting Tags (.ocetags & Standard Blam)',
    difficulty: 'Beginner',
    duration: '5 min',
    summary:
      'Extract weapons, vehicles, or entire maps with recursive dependencies into portable .ocetags containers or standard 64-byte Blam loose tags, and inject them into any target map.',
    highlightZone: 'toolbar',
    steps: [
      {
        title: 'Select Tag(s) & Preview Dependency Walk',
        instruction:
          'Select one or more tags in the Tag Tree and click "Extract..." (Ctrl+E) on the toolbar. Mantle automatically walks all recursive child dependencies and external resource references.',
        uiCallout: 'Top Toolbar -> Extract... (Ctrl+E)',
      },
      {
        title: 'Choose .ocetags Container or Standard Blam Loose Files',
        instruction:
          'Export either as a single self-contained .ocetags package or as standard 64-byte Blam loose tag files ready for HEK / Guerilla / Sapien.',
        uiCallout: 'Dependency Dialog -> Format Selector (.ocetags / Blam)',
      },
      {
        title: 'Inject Into Target Map & Apply',
        instruction:
          'Open your destination map, click "Inject..." on the toolbar, choose your .ocetags file (or use Tools -> Import Legacy Tags), review the collision/merge plan, and click "Apply Injection".',
        uiCallout: 'Top Toolbar -> Inject... -> Apply Injection',
      },
    ],
  },
  {
    id: 'viewport-3d-placement',
    category: '3D Level Editing',
    title: '4. 3D BSP Viewport, Object Placement & Vertex Sculpting',
    difficulty: 'Intermediate',
    duration: '6 min',
    summary:
      'Fly through the 3D textured level BSP, move/rotate/duplicate vehicles, weapons, scenery, and player spawns, or sculpt BSP/model vertices.',
    highlightZone: 'viewport-3d',
    steps: [
      {
        title: 'Open the 3D BSP View & Fly Camera',
        instruction:
          'Select any scenario (scnr) or structure BSP (sbsp) tag and switch to the "3D BSP View" tab. Hold Right-Click + WASD to fly through the level (hold Shift to boost speed).',
        uiCallout: 'Center Panel -> 3D BSP View -> Right-Click + WASD',
      },
      {
        title: 'Select, Move (G), Rotate (R), or Duplicate (Ctrl+D) Objects',
        instruction:
          'Click any placed vehicle, weapon, scenery object, or player spawn in the 3D viewport. Drag the 3D transform gizmo arrows to reposition or rotate it in real time.',
        uiCallout: '3D Viewport -> Transform Gizmo (G = Move, R = Rotate)',
      },
      {
        title: 'Place New Objects onto Terrain via Raycast',
        instruction:
          'Use "+ Place New Object" in the viewport toolbar to drop new vehicles, weapons, or spawns directly onto the BSP surface under your crosshair.',
        uiCallout: '3D Viewport Toolbar -> [+ Place New Object]',
      },
    ],
  },
  {
    id: 'bsp-swapper',
    category: '3D Level Editing',
    title: '5. Swapping Structure BSPs Between Maps',
    difficulty: 'Intermediate',
    duration: '4 min',
    summary:
      'Transplant a playable environment BSP (including lightmaps, weather, skies, and collision) from any source map into your target scenario.',
    highlightZone: 'toolbar',
    steps: [
      {
        title: 'Launch Swap BSP from Toolbar',
        instruction:
          'With your target map open, click "Swap BSP" on the top toolbar (or Tools -> Swap BSP...). Pick the source .map file whose environment geometry you want to import.',
        uiCallout: 'Top Toolbar -> Swap BSP',
      },
      {
        title: 'Review Preflight Report & Auto-Relocate Spawns',
        instruction:
          'Mantle inspects all BSP shader/bitmap/lightmap dependencies and offers automatic spawn/object relocation onto the new BSP floor so players never spawn in the void.',
        uiCallout: 'BSP Swap Dialog -> Auto-Relocate Scenario Objects',
      },
    ],
  },
  {
    id: 'bitmap-sound-studio',
    category: 'Media Assets',
    title: '6. Bitmap Texture Painter & Sound Audition / Replacement',
    difficulty: 'Beginner',
    duration: '4 min',
    summary:
      'Preview and export/replace textures (.png / .dds), paint directly onto 3D models/BSPs, and audition or replace weapon/dialog audio (.wav / Xbox ADPCM / Ogg).',
    highlightZone: 'inspector',
    steps: [
      {
        title: 'Inspect & Replace Bitmaps (bitm)',
        instruction:
          'Select any bitm tag to preview mipmaps and cubemaps/sprites. Click "Export PNG/DDS" to save to disk or "Replace Image..." to encode a new PNG/DDS texture in-place.',
        uiCallout: 'Center Panel -> Bitmap Viewer -> Replace Image...',
      },
      {
        title: 'Audition & Replace Sounds (snd!)',
        instruction:
          'Select any snd! tag to play pitch ranges and permutations directly in Mantle. Click "Export WAV" or "Replace Permutation with WAV" to inject custom audio.',
        uiCallout: 'Center Panel -> Sound Player -> Play / Replace WAV',
      },
    ],
  },
  {
    id: 'custom-object-builder',
    category: 'Custom Assets',
    title: '7. Building Custom 3D Objects (.obj / .jms / .dae)',
    difficulty: 'Intermediate',
    duration: '6 min',
    summary:
      'Turn any 3D mesh (.obj, .jms, or Collada .dae) and texture into a complete Halo CE scenery, weapon, vehicle, or equipment tag with auto-generated collision.',
    highlightZone: 'toolbar',
    steps: [
      {
        title: 'Open Build Object Wizard',
        instruction:
          'Click "Build Object" on the top toolbar. Choose whether to create a Scenery, Weapon, Vehicle, or Equipment tag and select your 3D mesh (.obj, .jms, or .dae).',
        uiCallout: 'Top Toolbar -> Build Object',
      },
      {
        title: 'Configure Collision & UV Unwrap',
        instruction:
          'Preview the 3D mesh and auto-generated collision hull. Choose Box, Smart, or Exact collision, attach a PNG diffuse texture, and inject directly into the open map.',
        uiCallout: 'Object Builder -> Collision & Texture Preview -> Build & Inject',
      },
    ],
  },
  {
    id: 'haloscript-ide',
    category: 'Scripting',
    title: '8. Decompiling & Compiling Scenario HaloScript (.hsc)',
    difficulty: 'Intermediate',
    duration: '5 min',
    summary:
      'Decompile any map’s binary scenario syntax nodes back into readable .hsc source code, edit scripts and globals with syntax diagnostics, and recompile into the map.',
    highlightZone: 'inspector',
    steps: [
      {
        title: 'Open the Scenario (scnr) HaloScript Tab',
        instruction:
          'Select the map’s scenario (scnr) tag and switch to the "HaloScript (.hsc)" tab in the center panel. Mantle automatically decompiles all globals and scripts.',
        uiCallout: 'Center Panel (scnr) -> HaloScript (.hsc) Tab',
      },
      {
        title: 'Edit & Compile Back into the Scenario',
        instruction:
          'Write or modify startup, dormant, continuous, or stub scripts, use the searchable HaloScript Reference Catalog, and click "Compile HaloScript into Map".',
        uiCallout: 'HaloScript Editor -> Compile HaloScript into Map',
      },
    ],
  },
  {
    id: 'live-hud-memory',
    category: 'Live In-Game Tools',
    title: '9. Live In-Game HUD & Weapon Memory Editor',
    difficulty: 'Advanced',
    duration: '5 min',
    summary:
      'Attach to a running Halo Custom Edition process to drag HUD elements and tune weapon/vehicle properties in real time with zero map reloads.',
    highlightZone: 'toolbar',
    steps: [
      {
        title: 'Launch Tag Test or Open Live HUD Editor',
        instruction:
          'Click "Live HUD" on the toolbar (or launch Halo via the OpenCE Tag Test panel). Mantle scans and attaches to the live Halo CE process memory.',
        uiCallout: 'Top Toolbar -> Live HUD',
      },
      {
        title: 'Drag HUD Reticles/Meters & Edit Live Weapon Stats',
        instruction:
          'Drag HUD bitmaps, ammo counters, and shield meters on the 640×480 canvas—changes appear inside Halo instantaneously—then click "Save to Map" to persist them.',
        uiCallout: 'Live HUD Studio -> 640x480 Canvas & Live Weapon Sliders',
      },
    ],
  },
  {
    id: 'ui-map-studio',
    category: 'UI & Localization',
    title: '10. UI.map Menu (DeLa) & Unicode String (ustr) Studio',
    difficulty: 'Intermediate',
    duration: '5 min',
    summary:
      'Visually reposition Halo main menu UI widgets (ui_widget_definition) and batch-edit localized Unicode string tables via CSV.',
    highlightZone: 'toolbar',
    steps: [
      {
        title: 'Open UI.map Studio',
        instruction:
          'Open ui.map (or any map with DeLa/ustr tags) and click "UI Studio" on the top toolbar. Select any menu screen widget tree to render its 640×480 layout.',
        uiCallout: 'Top Toolbar -> UI Studio',
      },
      {
        title: 'Drag Widget Bounds & Edit Strings',
        instruction:
          'Drag or resize menu buttons and text boxes directly on the canvas, edit their localized ustr strings inline, or export/import RFC-4180 CSV string tables.',
        uiCallout: 'UI.map Studio -> Visual Canvas & CSV Export/Import',
      },
    ],
  },
  {
    id: 'multi-map-split-and-tearoff',
    category: 'Multi-Map Workflow',
    title: '11. Side-by-Side Split Comparison & Multi-Monitor Tab Tear-Off',
    difficulty: 'Beginner',
    duration: '3 min',
    summary:
      'Compare two open maps side by side with a draggable vertical divider, or drag any map tab out of the main UI onto a second monitor.',
    highlightZone: 'bottom-tabs',
    steps: [
      {
        title: 'Open Two or More Maps in Bottom Tabs',
        instruction:
          'Use the [+] button in the bottom tab bar to open a second map. Both maps stay loaded in memory so you can switch between them in under 1 millisecond.',
        uiCallout: 'Bottom Tab Bar -> [+] Button & Map Tabs',
      },
      {
        title: 'Toggle [◫ Split Side-by-Side] or Drag Tab to 2nd Monitor',
        instruction:
          'Click "[◫ Split Side-by-Side]" on the bottom-right to compare two open maps with a draggable divider, or drag any tab outside the window (or click ↗) to open it in a second identical window on another monitor.',
        uiCallout: 'Bottom Tab Bar -> [◫ Split Side-by-Side] & Tab Drag-Out (↗)',
      },
    ],
  },
  {
    id: 'loose-tags-git-workspace',
    category: 'HEK / Foundry Workflow',
    title: '12. Loose Blam tags/ Workspace, Auto-Fix & Git Review',
    difficulty: 'Advanced',
    duration: '5 min',
    summary:
      'Work directly on standard 64-byte Blam loose tags/ folders on disk, auto-repair broken TagDependency paths, and inspect Git commits.',
    highlightZone: 'toolbar',
    steps: [
      {
        title: 'Open a Loose tags/ Directory',
        instruction:
          'Click "Loose tags/" on the top toolbar (or "Open Loose tags/ Folder..." on the Launcher sidebar) and select your HEK tags/ directory.',
        uiCallout: 'Top Toolbar -> Loose tags/',
      },
      {
        title: 'Edit Loose Files, Refactor Folders & Diff Git Commits',
        instruction:
          'Edit any loose tag file directly on disk, run one-click Dependency Auto-Fix across the workspace, or switch to the Git Review tab to diff modified tags against HEAD.',
        uiCallout: 'Loose Tags Workspace -> Auto-Fix Dependencies & Git Review',
      },
    ],
  },
];

function TutorialUiSchematic({
  highlightZone,
  activeStepCallout,
}: {
  highlightZone: TutorialGuide['highlightZone'];
  activeStepCallout: string;
}) {
  const zoneStyle = (zone: TutorialGuide['highlightZone']): React.CSSProperties => {
    const active = highlightZone === zone;
    return {
      border: active ? '1.5px solid var(--accent-cyan)' : '1px solid var(--border)',
      background: active ? 'var(--selection-bg)' : 'var(--bg-control)',
      boxShadow: active ? '0 0 12px var(--blueprint-glow)' : 'none',
      borderRadius: 2,
      transition: 'all 0.15s ease',
    };
  };

  return (
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
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
          fontSize: 11,
        }}
      >
        <span style={{ fontFamily: 'var(--mono-font)', color: 'var(--accent-cyan)', fontWeight: 600 }}>
          INTERACTIVE UI LOCATION MAP
        </span>
        <span
          style={{
            fontFamily: 'var(--mono-font)',
            fontSize: 10.5,
            padding: '1px 7px',
            background: 'var(--selection-bg)',
            border: '1px solid var(--border-active)',
            color: 'var(--text-primary)',
            borderRadius: 2,
          }}
        >
          📍 {activeStepCallout}
        </span>
      </div>

      {/* Mini Schematic of Mantle Window */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          height: 156,
          fontFamily: 'var(--mono-font)',
          fontSize: 10,
        }}
      >
        {/* Top Toolbar Zone */}
        <div
          style={{
            ...zoneStyle('toolbar'),
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 8px',
          }}
        >
          <span style={{ color: highlightZone === 'toolbar' ? 'var(--accent-cyan)' : 'var(--text-secondary)' }}>
            [Open] [Save] [Extract...] [Inject...] [Swap BSP] [Build Object] [Live HUD] [UI Studio] [Loose tags/]
          </span>
          <span style={{ color: 'var(--text-dim)' }}>─ □ ✕</span>
        </div>

        {/* Center 3-Column Workspace */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '140px 1fr 180px', gap: 5, minHeight: 0 }}>
          <div
            style={{
              ...zoneStyle(highlightZone === 'launcher' ? 'launcher' : 'tag-tree'),
              padding: 6,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
              {highlightZone === 'launcher' ? 'Launcher Sidebar' : 'Left: Tag Tree'}
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 9.5 }}>
              ▸ scnr (1)
              <br />▸ sbsp (1)
              <br />▸ weap (18)
              <br />▸ vehi (7)
            </div>
          </div>

          <div
            style={{
              ...zoneStyle('inspector'),
              padding: 6,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
              Center: Field Editor / Deps / HaloScript / Media
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 9.5 }}>
              [Tag Fields] [Dependency Swapper] [3D BSP View] [HaloScript (.hsc)]
            </div>
          </div>

          <div
            style={{
              ...zoneStyle('viewport-3d'),
              padding: 6,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>3D BSP &amp; Model Viewport</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 9.5 }}>
              Right-Click+WASD Flycam
              <br />
              Gizmos (G / R / Ctrl+D)
            </div>
          </div>
        </div>

        {/* Bottom Open-Map Tab Bar Zone */}
        <div
          style={{
            ...zoneStyle('bottom-tabs'),
            height: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 8px',
          }}
        >
          <span style={{ color: highlightZone === 'bottom-tabs' ? 'var(--accent-cyan)' : 'var(--text-secondary)' }}>
            [⌂ Launcher] [bloodgulch.map *] [beavercreek.map] [+]
          </span>
          <span style={{ color: 'var(--accent-cyan)' }}>[◫ Split Side-by-Side]</span>
        </div>
      </div>
    </div>
  );
}

interface TutorialsHubModalProps {
  onClose: () => void;
}

export default function TutorialsHubModal({ onClose }: TutorialsHubModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>(TUTORIAL_GUIDES[0].id);
  const [activeStepIdx, setActiveStepIdx] = useState(0);

  const filteredGuides = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return TUTORIAL_GUIDES;
    return TUTORIAL_GUIDES.filter(
      (g) =>
        g.title.toLowerCase().includes(q) ||
        g.category.toLowerCase().includes(q) ||
        g.summary.toLowerCase().includes(q) ||
        g.steps.some(
          (s) => s.title.toLowerCase().includes(q) || s.instruction.toLowerCase().includes(q),
        ),
    );
  }, [searchQuery]);

  const activeGuide =
    filteredGuides.find((g) => g.id === selectedId) ?? filteredGuides[0] ?? TUTORIAL_GUIDES[0];

  return (
    <div
      data-testid="tutorials-hub-modal-backdrop"
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
        data-testid="tutorials-hub-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 960,
          maxWidth: '95vw',
          height: 650,
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
              OpenCE Mantle Tutorials Hub — Interactive Step-by-Step Guides
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
              Searchable walkthroughs for every tool, editor, and workflow in Mantle
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

        {/* Body: Left Searchable List + Right Step-by-Step Guide */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* Left Column */}
          <div
            style={{
              width: 310,
              borderRight: '1px solid var(--border)',
              background: 'var(--bg-control)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>
              <input
                data-testid="tutorials-search-input"
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setActiveStepIdx(0);
                }}
                placeholder="Search tutorials (e.g. BSP, weapon, HUD)..."
                style={{
                  width: '100%',
                  padding: '6px 9px',
                  fontSize: 12,
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  borderRadius: 2,
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {filteredGuides.map((g) => {
                const selected = g.id === activeGuide?.id;
                return (
                  <button
                    key={g.id}
                    onClick={() => {
                      setSelectedId(g.id);
                      setActiveStepIdx(0);
                    }}
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
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <span
                        style={{
                          fontFamily: 'var(--mono-font)',
                          fontSize: 9.5,
                          color: 'var(--accent-cyan)',
                          textTransform: 'uppercase',
                        }}
                      >
                        {g.category}
                      </span>
                      <span style={{ fontFamily: 'var(--mono-font)', fontSize: 9.5, color: 'var(--text-dim)' }}>
                        {g.duration}
                      </span>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 12, marginTop: 2 }}>{g.title}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {activeGuide && (
              <>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span
                      style={{
                        fontFamily: 'var(--mono-font)',
                        fontSize: 10,
                        padding: '1px 6px',
                        background: 'var(--selection-bg)',
                        border: '1px solid var(--border-active)',
                        color: 'var(--accent-cyan)',
                        borderRadius: 2,
                      }}
                    >
                      {activeGuide.category}
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--mono-font)',
                        fontSize: 10,
                        padding: '1px 6px',
                        background: 'var(--bg-panel-header)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-secondary)',
                        borderRadius: 2,
                      }}
                    >
                      {activeGuide.difficulty}
                    </span>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {activeGuide.title}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.45 }}>
                    {activeGuide.summary}
                  </div>
                </div>

                {/* Live Interactive UI Location Diagram */}
                <TutorialUiSchematic
                  highlightZone={activeGuide.highlightZone}
                  activeStepCallout={
                    activeGuide.steps[activeStepIdx]?.uiCallout ?? activeGuide.steps[0].uiCallout
                  }
                />

                {/* Step-by-Step Cards */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {activeGuide.steps.map((step, idx) => {
                    const isFocused = idx === activeStepIdx;
                    return (
                      <div
                        key={idx}
                        onClick={() => setActiveStepIdx(idx)}
                        style={{
                          padding: '10px 12px',
                          background: isFocused ? 'var(--selection-bg)' : 'var(--bg-control)',
                          border: isFocused ? '1px solid var(--border-active)' : '1px solid var(--border)',
                          borderRadius: 2,
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--text-primary)' }}>
                            Step {idx + 1}: {step.title}
                          </span>
                          <span
                            style={{
                              fontFamily: 'var(--mono-font)',
                              fontSize: 10,
                              color: 'var(--accent-cyan)',
                            }}
                          >
                            {step.uiCallout}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.45 }}>
                          {step.instruction}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '10px 16px',
            background: 'var(--bg-panel-header)',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
            Showing {filteredGuides.length} of {TUTORIAL_GUIDES.length} built-in tutorials
          </span>
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
