import { useMemo, useState } from 'react';

interface ScreenshotPlaceholderInfo {
  fileName: string;
  whatToCapture: string;
}

interface TutorialStep {
  title: string;
  instruction: string;
  uiCallout: string;
  screenshotFile?: string;
  placeholder?: ScreenshotPlaceholderInfo;
}

interface TutorialGuide {
  id: string;
  category: string;
  title: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  duration: string;
  summary: string;
  highlightZone: 'launcher' | 'tag-tree' | 'inspector' | 'viewport-3d' | 'toolbar' | 'bottom-tabs';
  heroScreenshot?: string;
  steps: TutorialStep[];
}

export const TUTORIAL_GUIDES: TutorialGuide[] = [
  {
    id: 'launcher-and-themes',
    category: 'Core Workflow',
    title: '1. Workspace Launcher, 2D BSP Wireframes & 6 Custom Themes',
    difficulty: 'Beginner',
    duration: '3 min',
    summary:
      'Use the Guilty Spark-inspired Workspace Launcher Home to browse recent maps via top-down 2D Structure BSP wireframes, filter by Halo edition, pin favorite maps, and customize your workspace with 6 built-in themes (including Light Mode).',
    highlightZone: 'launcher',
    heroScreenshot: './tutorials/tut-launcher-home.png',
    steps: [
      {
        title: 'Browse Recent Maps & Top-Down 2D BSP Wireframes',
        instruction:
          'When Mantle starts (or when you click [⌂ Launcher] at the bottom-left of the window), the Recent Maps grid displays a real 2D orthographic top-down wireframe of each map’s Structure BSP (sbsp). Use the edition pills (ALL, PINNED, CE, PC, MCC, XBOX) or search bar to filter your maps, or click ★ on any card to pin it to the top.',
        uiCallout: 'Launcher Home -> Recent Maps Grid & Edition Filter Pills',
        screenshotFile: './tutorials/tut-launcher-home.png',
      },
      {
        title: 'Switch Between 6 Built-In Themes (Including Light Mode)',
        instruction:
          'Click the "★ Change Theme" button on the far right of the top launcher ribbon (or View -> Change Theme...). Choose between Native Dark Mode, Mantle Light Mode, Forerunner Monitor (Guilty Spark), Classic Halo CE Navy (2001 UI), Covenant Plasma (High Charity), and UNSC Tactical (Pillar of Autumn).',
        uiCallout: 'Top-Right Ribbon -> ★ Change Theme Popup',
        screenshotFile: './tutorials/tut-theme-selector.png',
      },
      {
        title: 'Explore the Visual UI Atlas & Tag Class Glossary',
        instruction:
          'Click "Glossary" in the bottom-left sidebar of the Launcher to open the interactive 7-Zone Visual UI Atlas and searchable 4-character Blam Tag Class dictionary.',
        uiCallout: 'Launcher Left Sidebar -> Glossary (UI Atlas)',
        screenshotFile: './tutorials/tut-glossary-ui-atlas.png',
      },
    ],
  },
  {
    id: 'open-and-inspect',
    category: 'Core Workflow',
    title: '2. Opening Maps (CE, Retail PC, MCC v13, Xbox v5) & Tag Tree Navigation',
    difficulty: 'Beginner',
    duration: '3 min',
    summary:
      'Open Halo Custom Edition (v609), Retail PC (v7), Trial/Demo (v6), MCC Halo CE Anniversary (v13), or Original Xbox (v5) .map files and navigate the left Hierarchy Tag Browser.',
    highlightZone: 'tag-tree',
    heroScreenshot: './tutorials/tut-map-overview.png',
    steps: [
      {
        title: 'Open Any Map via Launcher, Ctrl+O, or Drag-and-Drop',
        instruction:
          'Click "Open Map... (Ctrl+O)" on the Launcher sidebar, click any Recent Map card, or drag and drop a .map file directly onto the window. Compressed maps (including MCC zstd and Original Xbox zlib maps) are automatically decompressed in memory.',
        uiCallout: 'Launcher Sidebar -> Open Map... (Ctrl+O)',
        screenshotFile: './tutorials/tut-map-overview.png',
      },
      {
        title: 'Search & Group Tags by Class or Folder Path',
        instruction:
          'In the left Hierarchy panel, switch between "By class" (weapon, vehicle, biped, scenario, structure_bsp) and "By folder" directory view. Type any tag name, 4-char class code, or hex Tag ID into the search bar to filter instantaneously.',
        uiCallout: 'Left Hierarchy Panel -> Search Input & Group Mode Dropdown',
        screenshotFile: './tutorials/tut-map-overview.png',
      },
      {
        title: 'Inspect Tag Properties, Dependency Swapper & Incoming References',
        instruction:
          'Click any tag in the Hierarchy tree to inspect its metadata on the right-hand Properties Palette. Switch between PROPERTIES, SWAPPER (outgoing dependencies), and REFERENCES (which tags in the map reference this tag).',
        uiCallout: 'Right Dock -> PROPERTIES / SWAPPER / REFERENCES Tabs',
        screenshotFile: './tutorials/tut-tag-field-editor.png',
      },
    ],
  },
  {
    id: 'edit-tag-fields',
    category: 'Tag Editing',
    title: '3. Editing Tag Fields (✨ Simple View), Reflexives & Dependency Swapping',
    difficulty: 'Beginner',
    duration: '5 min',
    summary:
      'Right-click any tag to open the full Tag Field Editor with plain-English descriptions, 3D X/Y/Z coordinate inputs, RGB color pickers, reflexive chunk cloning, Function Curve Plotting, and TSV spreadsheet copy/paste.',
    highlightZone: 'inspector',
    heroScreenshot: './tutorials/tut-tag-field-editor.png',
    steps: [
      {
        title: 'Right-Click Any Tag -> "Tag Editor..."',
        instruction:
          'In the left Hierarchy panel, right-click any tag (such as weapons\\assault rifle\\assault rifle) and select "Tag Editor...". By default, ✨ Simple View is active, hiding read-only compiler fields and showing plain-English descriptions with units beneath every setting.',
        uiCallout: 'Left Hierarchy -> Right-Click Tag -> Tag Editor...',
        screenshotFile: './tutorials/tut-tag-field-editor.png',
        placeholder: {
          fileName: 'tut-placeholder-simple-view-fields.png',
          whatToCapture:
            'Right-click weapons\\assault rifle\\assault rifle in the Tag Tree, click "Tag Editor...", expand the "triggers" or "magazines" reflexive block with ✨ Simple View active, and capture the modal showing plain-English descriptions and RGB/XYZ inputs.',
        },
      },
      {
        title: 'Add/Clone Reflexive Chunks, Plot Curves & Copy/Paste TSV',
        instruction:
          'Expand any reflexive block (such as Magazines, Triggers, or Camera Tracks). Use "+ Add / Clone Chunk" to add array entries, click "📋 Copy TSV / Paste TSV" to edit blocks in Excel/Google Sheets, or click "📈 Plot Curve" on 0..1 function blocks.',
        uiCallout: 'Tag Editor Modal -> Reflexive Block Header Toolbar',
        placeholder: {
          fileName: 'tut-placeholder-reflexive-tsv-curve.png',
          whatToCapture:
            'Inside the Tag Editor modal, expand a reflexive block or function block to show the [+ Clone], [📋 Copy TSV], and [📈 Plot Curve] controls.',
        },
      },
      {
        title: 'Swap Tag Dependencies In-Place & Save (Ctrl+S)',
        instruction:
          'In the right-hand Properties Palette, click the "SWAPPER" tab. Pick any dependency slot (e.g. a weapon’s projectile reference), select a replacement tag class and target tag (such as rocket), click "Apply Swap", and press Ctrl+S to save.',
        uiCallout: 'Right Dock -> SWAPPER Tab -> Apply Swap -> Ctrl+S',
        screenshotFile: './tutorials/tut-tag-field-editor.png',
      },
    ],
  },
  {
    id: 'extract-and-inject',
    category: 'Porting & Containers',
    title: '4. Extracting & Injecting Tags (Standard 64-Byte Blam vs .ocetags)',
    difficulty: 'Beginner',
    duration: '5 min',
    summary:
      'Extract weapons, vehicles, bipeds, or entire maps with recursive dependencies into standard 64-byte Blam loose tags (compatible with Sapien/Guerilla/tool.exe/Invader) or portable .ocetags containers, and inject them across maps.',
    highlightZone: 'toolbar',
    heroScreenshot: './tutorials/tut-extract-dependencies.png',
    steps: [
      {
        title: 'Check Tag(s) in the Hierarchy & Click "Extract Tags"',
        instruction:
          'Tick the checkbox next to one or more tags in the left Hierarchy tree (or click "Extract Whole Map") and click "Extract Tags" in the top toolbar. Mantle recursively walks all child dependencies and external bitmaps/sounds.',
        uiCallout: 'Top Toolbar -> Extract Tags',
        screenshotFile: './tutorials/tut-extract-dependencies.png',
      },
      {
        title: 'Choose Standard 64-Byte Blam Loose Tags or .ocetags Container',
        instruction:
          'In the Extract Tags dialog, choose "Standard Blam Loose Tags (tags\\<path>.<group>)" for a 64-byte blam header directory compatible with HEK/Sapien/Guerilla, or "OpenCE Container (.ocetags)" for a single-file package.',
        uiCallout: 'Extract Tags Dialog -> Output Format Radio Buttons',
        screenshotFile: './tutorials/tut-extract-dependencies.png',
      },
      {
        title: 'Inject Tags into Any Destination Map',
        instruction:
          'Open your target .map file, click "Inject Tags" on the top toolbar, select your .ocetags container or loose Blam tag folder, review the dependency merge plan, and click "Apply Injection".',
        uiCallout: 'Top Toolbar -> Inject Tags -> Apply Injection',
        screenshotFile: './tutorials/tut-map-overview.png',
      },
    ],
  },
  {
    id: 'viewport-3d-placement',
    category: '3D Level Editing',
    title: '5. Sapien 3D Viewport, Object Placement, 🌍 Gravity Lock & 🧲 Auto-Snap',
    difficulty: 'Intermediate',
    duration: '6 min',
    summary:
      'Fly through the Sapien-grade 3D textured BSP with radiosity lightmaps and 3D skybox, place/move/rotate/scale vehicles, weapons, and spawns, and use Gravity Lock, Auto-Snap to Ground, Collision Hitbox (coll), and Coupled Scale.',
    highlightZone: 'viewport-3d',
    heroScreenshot: './tutorials/tut-3d-viewport-sapien.png',
    steps: [
      {
        title: 'Open the 3D Viewport & Fly with WASD + Right-Click Orbit',
        instruction:
          'Switch to the "3D Viewport" tab in the center workspace. Hold Right-Click to look around and press WASD (Space = Up, C = Down, Shift = Boost, Scroll Wheel = Fly Speed) to fly through the textured level.',
        uiCallout: 'Center Workspace -> 3D Viewport Tab',
        screenshotFile: './tutorials/tut-3d-viewport-sapien.png',
      },
      {
        title: 'Use 🌍 Gravity: ON/OFF & 🧲 Auto-Snap: ON/OFF While Placing Objects',
        instruction:
          'Click "+ Add Object" to raycast-drop new vehicles, weapons, scenery, or spawns onto the terrain. Toggle "🌍 Gravity: ON" in the top viewport bar to lock dragged objects to the ground surface at all times, or use "🧲 Auto-Snap: ON" (with Gravity OFF) so floating objects automatically drop onto the terrain the moment you unselect them (Esc).',
        uiCallout: '3D Viewport Top Bar -> [+ Add Object] [🧲 Auto-Snap: ON] [🌍 Gravity: ON]',
        screenshotFile: './tutorials/tut-3d-viewport-sapien.png',
      },
      {
        title: 'Inspect 🛡 Hitbox (coll) Wireframes & Apply ⚖️ Coupled Scale',
        instruction:
          'Select any vehicle, weapon, scenery, or biped in the 3D Viewport. Toggle "🛡 Hitbox (coll)" to view its bone-aligned green 3D collision wireframe, and use "⚖️ Coupled Scale" to uniformly scale both the 3D render model (mod2) and its collision hitbox (coll) + physics mass points (phys) together.',
        uiCallout: '3D Viewport Selection Toolbar -> [🛡 Hitbox (coll)] & [⚖️ Coupled Scale]',
        screenshotFile: './tutorials/tut-3d-viewport-sapien.png',
        placeholder: {
          fileName: 'tut-placeholder-3d-gizmo-coupled-scale.png',
          whatToCapture:
            'In the 3D Viewport on bloodgulch.map, click a Warthog or Scorpion so the 3D Transform Gizmo appears, enable [🛡 Hitbox (coll)] and [⚖️ Coupled Scale: 1.5x], and capture the viewport.',
        },
      },
    ],
  },
  {
    id: 'tunnels-caves-bridges',
    category: '3D Level Editing',
    title: '6. Organic Multi-Path Tunnels, Vaulted Caves & 6-Style Bridge Generator',
    difficulty: 'Intermediate',
    duration: '6 min',
    summary:
      'Generate organic S-curve tunnel networks, vaulted cavern domes with rock pillars, and 6 architectural/natural bridge styles with BSP-matched shaders and watertight 3D collision.',
    highlightZone: 'viewport-3d',
    heroScreenshot: './tutorials/tut-world-tunnel-bridge-builder.png',
    steps: [
      {
        title: 'Open 3D BSP & Model Studio -> "+ World, Tunnel, Bridge & BSP Builder"',
        instruction:
          'Switch to the "3D BSP & Model Studio" tab in the center workspace and click the green "+ World, Tunnel, Bridge & BSP Builder" button in the studio header.',
        uiCallout: 'Center Workspace -> 3D BSP & Model Studio -> + World, Tunnel, Bridge & BSP Builder',
        screenshotFile: './tutorials/tut-world-tunnel-bridge-builder.png',
      },
      {
        title: 'Configure Multi-Path Tunnels (1–5), Cross-Pathways & Vaulted Caves',
        instruction:
          'Select "🚇 Tunnels & Caves (1–5)" to configure 1 to 5 winding S-curve tunnel paths, interconnecting cross-tunnels, and vaulted cavern rooms with octagonal rock columns. Use "✨ Auto-Shader All" to assign shaders already present on your map’s BSP.',
        uiCallout: 'Builder Bar -> 🚇 Tunnels & Caves (1–5) & ✨ Auto-Shader All',
        screenshotFile: './tutorials/tut-world-tunnel-bridge-builder.png',
      },
      {
        title: 'Generate 6-Style Bridges & Inject with Compiled 3D Collision',
        instruction:
          'Switch to "🌉 Multi-Style Bridges (1–5)" to preview Forerunner Energy Beam, Suspension, Under-Deck Arch, Through-Arch, Natural Rocky Land, or Dirt & Grass bridges. Click "💾 Apply Geometry & Textures to Map" (or Inject Into Map Structure BSP) to compile solid 3D collision directly into the level.',
        uiCallout: 'Builder Bar -> 🌉 Multi-Style Bridges -> 💾 Apply Geometry & Textures to Map',
        screenshotFile: './tutorials/tut-world-tunnel-bridge-builder.png',
      },
    ],
  },
  {
    id: 'quickforge-world-builder',
    category: '3D Level Editing',
    title: '7. QuickForge World Builder (4-Octave Terrain, New Mombasa City & BSP Sculpting)',
    difficulty: 'Advanced',
    duration: '7 min',
    summary:
      'Generate 4-octave FBM natural terrains, boulder/cliff/Forerunner structures, or a complete New Mombasa street grid with walkable building interiors and an elevated highway overpass, or sculpt BSP terrain vertices live.',
    highlightZone: 'viewport-3d',
    heroScreenshot: './tutorials/tut-world-tunnel-bridge-builder.png',
    steps: [
      {
        title: 'Generate 4-Octave Biomes, Rock Arches & Forerunner Towers',
        instruction:
          'Inside "3D BSP & Model Studio -> + World, Tunnel, Bridge & BSP Builder", click "🏔 QuickForge Terrain, Nature, Forerunner & City". Pick a biome preset (Blood Gulch Canyon, Timberland Ridge, Ice Fields Glacier, Death Island Mesa) and add Rock Arches, Boulder Clusters, Cliff Spires, or Forerunner Towers.',
        uiCallout: '3D BSP & Model Studio -> 🏔 QuickForge Terrain, Nature, Forerunner & City',
        screenshotFile: './tutorials/tut-world-tunnel-bridge-builder.png',
      },
      {
        title: 'Generate a New Mombasa City Street Grid & Elevated Highway Overpass',
        instruction:
          'Enable "🏙 Generate Human City / New Mombasa Street Grid" with Ground Interiors and Highway Overpass checked. Mantle generates multi-story setback skyscrapers with interior wedge ramps to the rooftops and a solid 3D highway overpass with West/East vehicle on-ramps.',
        uiCallout: 'QuickForge Panel -> 🏙 Generate Human City / New Mombasa Street Grid',
        screenshotFile: './tutorials/tut-world-tunnel-bridge-builder.png',
        placeholder: {
          fileName: 'tut-placeholder-city-overpass-ingame.png',
          whatToCapture:
            'Generate a New Mombasa City Grid with Highway Overpass in QuickForge, inject into the map, press F5 to launch in OpenCE, and capture your Spartan or Warthog driving across the elevated highway overpass.',
        },
      },
      {
        title: 'Sculpt Terrain Live with the 3D BSP Brush & Auto-Synced Collision',
        instruction:
          'Switch to "Live BSP Terrain & Surface Editor", select the Raise (+Z), Lower (-Z), Smooth, or Flatten brush, adjust Radius and Strength, and paint directly across the 3D terrain mesh. Clicking "💾 Apply Geometry & Textures to Map" updates both the 3D render vertices and the 3D CollisionBSP.',
        uiCallout: '3D BSP & Model Studio -> Live BSP Terrain & Surface Editor',
        screenshotFile: './tutorials/tut-world-tunnel-bridge-builder.png',
      },
    ],
  },
  {
    id: 'bsp-swapper',
    category: '3D Level Editing',
    title: '8. Swapping Structure BSPs & Multi-Map World Merger',
    difficulty: 'Intermediate',
    duration: '5 min',
    summary:
      'Transplant a playable Structure BSP (including lightmaps, skies, and collision) from another map, or stitch multiple Halo CE maps together into a combined mega-level with connecting tunnels or bridges.',
    highlightZone: 'toolbar',
    heroScreenshot: './tutorials/tut-bsp-swapper.png',
    steps: [
      {
        title: 'Open "🌍 Swap BSP & Multi-Map World Merger"',
        instruction:
          'Click "Tools -> 🌍 Swap BSP & Multi-Map World Merger..." in the top menu bar, or click the blue "🌍 Multi-Map World Merger" button in the top bar of 3D BSP & Model Studio.',
        uiCallout: 'Top Menu -> Tools -> 🌍 Swap BSP & Multi-Map World Merger...',
        screenshotFile: './tutorials/tut-bsp-swapper.png',
      },
      {
        title: 'Swap a Structure BSP or Stitch Multiple Maps Together',
        instruction:
          'Select one or more donor .map files. When swapping a BSP, Mantle imports all dependent shaders, bitmaps, weather, and collision and auto-relocates scenario spawns onto the new floor. When merging multiple maps, configure the X/Y offset and connecting tunnel/bridge corridor between the worlds.',
        uiCallout: 'BSP Swapper / World Merger Dialog -> Auto-Relocate Spawns & Merge',
        screenshotFile: './tutorials/tut-world-tunnel-bridge-builder.png',
      },
    ],
  },
  {
    id: 'bitmap-sound-studio',
    category: 'Media & Fonts',
    title: '9. 3D Bitmap Texture Painter, TrueType Font Compiler & Sound Studio',
    difficulty: 'Beginner',
    duration: '5 min',
    summary:
      'Paint directly on 3D vehicles/weapons/BSPs in the 3D Bitmap Editor, export/replace PNG/DDS textures, compile custom Windows TrueType (.ttf) fonts into Halo .font tags, and audition/replace WAV audio.',
    highlightZone: 'inspector',
    heroScreenshot: './tutorials/tut-bitmap-sound-studio.png',
    steps: [
      {
        title: 'Paint Directly on 3D Models in the 3D Bitmap Editor',
        instruction:
          'Switch to the "3D Bitmap Editor" tab in the center workspace and click "Choose Item to Edit...". Pick any Vehicle, Weapon, Biped, Scenery, UI/HUD, or BSP Texture to paint strokes directly onto the 3D model or 2D UV canvas with live seam-bleed and HSV adjustments.',
        uiCallout: 'Center Workspace -> 3D Bitmap Editor -> Choose Item to Edit...',
        screenshotFile: './tutorials/tut-bitmap-sound-studio.png',
      },
      {
        title: 'Replace Bitmaps (bitm) & Sounds (snd!) from the Tag Tree',
        instruction:
          'Right-click any bitmap tag in the Hierarchy tree and choose "Bitmap Editor & Injector..." to export or import PNG/DDS textures. Right-click any sound tag and choose "Sound Audition & Injector..." to listen to permutations or inject custom WAV audio.',
        uiCallout: 'Left Hierarchy -> Right-Click bitmap / sound Tag',
        screenshotFile: './tutorials/tut-bitmap-sound-studio.png',
      },
      {
        title: 'Compile TrueType (.ttf) Fonts into Halo .font Tags',
        instruction:
          'Open Tools -> Universal Converter, Scanner & Mod Studio... and select the "🔤 TrueType Font (font) Compiler" tab. Pick ui\\large_ui, ui\\small_ui, or ui\\ticker, choose any system font or .ttf file, preview the glyph atlas, and click "⚡ Rasterize & Compile into .font Tag".',
        uiCallout: 'Tools -> Universal Converter, Scanner & Mod Studio -> Font Compiler',
        screenshotFile: './tutorials/tut-bsp-swapper.png',
      },
    ],
  },
  {
    id: 'custom-object-builder',
    category: 'Custom Assets',
    title: '10. Building Custom 3D Objects (.obj / .jms / .dae) with Auto-Collision',
    difficulty: 'Intermediate',
    duration: '6 min',
    summary:
      'Convert any 3D mesh (.obj, .jms, or Collada .dae) and PNG texture into a complete Halo CE scenery, weapon, vehicle, or equipment tag with auto-generated 3D collision geometry.',
    highlightZone: 'toolbar',
    heroScreenshot: './tutorials/tut-bsp-swapper.png',
    steps: [
      {
        title: 'Open "Build New Object Tag..." from the Tools Menu',
        instruction:
          'Click "Tools -> Build New Object Tag..." in the top menu bar. Select whether you want to create a Scenery (scen), Weapon (weap), Vehicle (vehi), or Equipment (eqip) tag and browse for your .obj, .jms, or .dae 3D model.',
        uiCallout: 'Top Menu -> Tools -> Build New Object Tag...',
        screenshotFile: './tutorials/tut-bsp-swapper.png',
      },
      {
        title: 'Preview 3D Mesh, Collision Hull & Inject Into Map',
        instruction:
          'Choose Box, Smart Convex Hull, or Exact Per-Triangle collision generation, attach your diffuse PNG texture, optionally add the new object to the Scenario Palette so it can be placed immediately in the 3D Viewport, and click "Build & Inject".',
        uiCallout: 'Build New Object Dialog -> Collision Mode & Build & Inject',
        placeholder: {
          fileName: 'tut-placeholder-build-custom-object.png',
          whatToCapture:
            'Open Tools -> Build New Object Tag..., load a .obj mesh with a PNG texture so the 3D preview and collision wireframe appear, and capture the dialog.',
        },
      },
    ],
  },
  {
    id: 'haloscript-ide',
    category: 'Scripting & AI',
    title: '11. 3D Script Builder (Pelican Dropships, Patrols & ai_migrate) & HaloScript (.hsc)',
    difficulty: 'Intermediate',
    duration: '6 min',
    summary:
      'Build interactive 3D Pelican/Spirit dropship insertions, ground patrol routes, and AI encounter migrations visually in the 3D Script Builder, or decompile and compile raw HaloScript (.hsc) source code.',
    highlightZone: 'inspector',
    heroScreenshot: './tutorials/tut-haloscript-3d-builder.png',
    steps: [
      {
        title: 'Open the "3D Script Builder" Tab & Choose an Event Template',
        instruction:
          'Switch to the "3D Script Builder" tab in the center workspace. Choose an event template such as "4. Unit Reinforcement via Vehicle Drop (Friendly Pelican or Enemy Spirit)" and click "+ Add Script Event Instance to 3D Builder".',
        uiCallout: 'Center Workspace -> 3D Script Builder Tab',
        screenshotFile: './tutorials/tut-haloscript-3d-builder.png',
      },
      {
        title: 'Place 3D Flight Waypoints, Patrol Points & 🔀 AI Migration Arrows',
        instruction:
          'Drag the 3D inbound flight waypoints, LZ hover touchdown point (wp_drop_1_lz), and outbound exit path in the 3D viewport. Click "🥾 + Patrol Point" to add a ground march path, or click "🔀 + AI Migration Arrow (ai_migrate)" to draw an emerald 3D arc transferring unloaded Marines into a destination encounter.',
        uiCallout: '3D Script Builder Viewport -> [🥾 + Patrol Point] & [🔀 + AI Migration Arrow]',
        screenshotFile: './tutorials/tut-haloscript-3d-builder.png',
        placeholder: {
          fileName: 'tut-placeholder-pelican-lz-spline.png',
          whatToCapture:
            'In the 3D Script Builder tab, add a Pelican Vehicle Drop event, add a Patrol Point and an AI Migration Arrow so the cyan flight spline, gold patrol path, and emerald migration arc are visible in the 3D preview, and capture.',
        },
      },
      {
        title: 'Preview 3D Timeline & Compile .hsc into Scenario',
        instruction:
          'Click "▶️ Preview 3D Timeline" to watch the Pelican fly in, hover at the LZ, unload units, and depart along the exit spline while squads march along the ground. Then click "Generate .hsc & Compile into Scenario" to compile the binary syntax nodes and recorded animations into the map.',
        uiCallout: '3D Script Builder -> Generate .hsc & Compile into Scenario',
        screenshotFile: './tutorials/tut-haloscript-3d-builder.png',
      },
    ],
  },
  {
    id: 'live-hud-memory',
    category: 'Live In-Game Tools',
    title: '12. True In-Game Live HUD & Weapon Tag Editor (60 FPS @ 0x40440000)',
    difficulty: 'Advanced',
    duration: '5 min',
    summary:
      'Launch your open map directly into OpenCE or Faber, automatically spawn all Spartan-holdable weapons and vehicles around your player, and move/scale HUD elements or tune weapon stats live in-game at 60 FPS.',
    highlightZone: 'toolbar',
    heroScreenshot: './tutorials/tut-map-overview.png',
    steps: [
      {
        title: 'Click "🎯 Live HUD Editing" on the Top Toolbar',
        instruction:
          'With any map open, click "🎯 Live HUD Editing" directly to the left of "Play In OpenCE (F5)". Mantle stages your map, launches OpenCE/Faber in devmode, connects to the 0x40440000 live tag memory bridge, unlocks 4-weapon carry capacity, and spawns every Spartan-holdable weapon and vehicle right beside you.',
        uiCallout: 'Top Toolbar (Right Side) -> 🎯 Live HUD Editing',
        screenshotFile: './tutorials/tut-map-overview.png',
      },
      {
        title: 'Capture HUD Elements (Blinks In-Game) & Move/Scale at 60 FPS',
        instruction:
          'The editor automatically follows whichever weapon you hold or vehicle you drive in-game. Select any HUD element (Static, Meter, Number, Crosshair), press ←/→ to toggle HIDDEN, or press Enter to Capture it (it blinks in-game for 1.2s) and use the Arrow keys (Shift = 10x) to move or scale it live inside the running Halo CE game!',
        uiCallout: 'Live HUD Editor -> HUD Level 0..N -> Enter to Capture & Arrow Keys',
        placeholder: {
          fileName: 'tut-placeholder-live-hud-ingame.png',
          whatToCapture:
            'Click "🎯 Live HUD Editing" so OpenCE launches alongside the Halo CE Default Style Live HUD & Weapon Tag Editor window, select a HUD element or Weapon stats row, and capture both windows.',
        },
      },
      {
        title: 'Tune Live Weapon Stats & Save Permanently (Ctrl+S)',
        instruction:
          'Switch to "Weapon stats" in the Live HUD menu to adjust fire rate, magazine capacity, projectile velocity, or damage with ←/→ while firing in-game. Every tweak is synced back into Mantle so pressing Ctrl+S saves your changes permanently to the .map file.',
        uiCallout: 'Live HUD Editor -> Weapon stats -> Save Map (Ctrl+S)',
        screenshotFile: './tutorials/tut-map-overview.png',
      },
    ],
  },
  {
    id: 'guided-hud-bitmap-injector',
    category: 'UI & Localization',
    title: '13. Guided HUD Bitmap Injector (🖼️ Safe Map-Local PNG Embedding)',
    difficulty: 'Beginner',
    duration: '4 min',
    summary:
      'Replace any Weapon HUD, Vehicle HUD, or Player HUD reticle, meter, or background sprite with a custom PNG image safely embedded inside the open .map file (never modifying external bitmaps.map).',
    highlightZone: 'toolbar',
    heroScreenshot: './tutorials/tut-hud-bitmap-injector.png',
    steps: [
      {
        title: 'Click "🖼️ Inject HUD Bitmap" & Pick Weapon, Vehicle, or Player HUD',
        instruction:
          'Click "🖼️ Inject HUD Bitmap" in the top toolbar. In Step 1 on the left, choose "🔫 Weapon HUDs", "🚙 Vehicle HUDs", or "🛡️ Player / General HUD" and click the weapon or vehicle you want to customize.',
        uiCallout: 'Top Toolbar -> 🖼️ Inject HUD Bitmap -> Step 1 Category',
        screenshotFile: './tutorials/tut-hud-bitmap-injector.png',
      },
      {
        title: 'Select the HUD Bitmap Slot & Preview the Current Sprite',
        instruction:
          'In Step 2 (center column), click the HUD bitmap slot you want to replace (such as Static 1 hud_ammo_alphas, Meter 1 hud_ammo_meters, or Crosshair 1 hud_reticles) to inspect its decoded sprite sheet preview and pixel dimensions.',
        uiCallout: 'Guided HUD Injector -> Step 2 Select HUD Bitmap Slot',
        screenshotFile: './tutorials/tut-hud-bitmap-injector.png',
      },
      {
        title: 'Choose Replacement .PNG & Inject Locally Into the Open Map',
        instruction:
          'In Step 3 (right column), click "📂 Choose Replacement .PNG Image...", leave "Fork Dedicated Map-Local Bitmap Tag" checked if other weapons share the sprite sheet, and click "✨ Inject HUD Bitmap into Open Map".',
        uiCallout: 'Guided HUD Injector -> Step 3 -> ✨ Inject HUD Bitmap into Open Map',
        screenshotFile: './tutorials/tut-hud-bitmap-injector.png',
      },
    ],
  },
  {
    id: 'ui-map-studio',
    category: 'UI & Localization',
    title: '14. UI.map & Menu Widget Studio (640×480 DeLa Canvas & ustr Strings)',
    difficulty: 'Intermediate',
    duration: '5 min',
    summary:
      'Visually inspect and reposition Halo CE menu screens (ui_widget_definition / DeLa) on an interactive 640×480 canvas and edit UTF-16LE localized string tables (unicode_string_list / ustr).',
    highlightZone: 'toolbar',
    heroScreenshot: './tutorials/tut-ui-map-studio.png',
    steps: [
      {
        title: 'Open "🖥️ UI.map Studio" & Select a DeLa Menu Screen',
        instruction:
          'Click "🖥️ UI.map Studio" in the top toolbar. On the "🖥️ 640×480 DeLa Menu Canvas" tab, pick any menu screen from the left list (e.g. 1p Pause Game or Main Menu) to render its child widget hierarchy on the 640×480 canvas.',
        uiCallout: 'Top Toolbar -> 🖥️ UI.map Studio -> 640×480 DeLa Menu Canvas',
        screenshotFile: './tutorials/tut-ui-map-studio.png',
      },
      {
        title: 'Drag or Nudge Menu Widgets & Edit Unicode String Tables (ustr)',
        instruction:
          'Click any child widget on the 640×480 canvas to drag it or nudge its X/Y coordinates in the right-hand Selected Widget Inspector. Switch to the "🔤 Unicode String Table Editor" tab at the top to search, edit, or add UTF-16LE strings and save them directly into the map.',
        uiCallout: 'UI.map Studio -> Selected Widget Inspector & 🔤 Unicode String Table Editor',
        screenshotFile: './tutorials/tut-ui-map-studio.png',
      },
    ],
  },
  {
    id: 'multi-map-split-and-tearoff',
    category: 'Multi-Map Workflow',
    title: '15. Multi-Map Bottom Tabs, Side-by-Side Split Comparison & 2nd-Monitor Tear-Off',
    difficulty: 'Beginner',
    duration: '4 min',
    summary:
      'Keep multiple .map files open simultaneously in bottom tabs with <1ms switching, compare two maps side-by-side with a draggable vertical divider, or drag any map tab out onto a second monitor.',
    highlightZone: 'bottom-tabs',
    heroScreenshot: './tutorials/tut-multi-map-split-compare.png',
    steps: [
      {
        title: 'Open Multiple Maps in the Bottom Tab Bar & Switch in <1ms',
        instruction:
          'Click [+] in the bottom tab bar (or click [⌂ Launcher] at the bottom-left and pick another Recent Map card) to open a second map. All open maps stay resident in the worker session registry so clicking between bottom tabs switches maps in under 1 millisecond.',
        uiCallout: 'Bottom Tab Bar -> [⌂ Launcher], Map Tabs & [+] Button',
        screenshotFile: './tutorials/tut-multi-map-split-compare.png',
      },
      {
        title: 'Compare Two Maps Side-by-Side with "[◫ Split Side-by-Side]"',
        instruction:
          'Click "[◫ Split Side-by-Side]" on the bottom-right of the tab bar. Drag the center vertical divider (⋮) left or right, filter tags in the Right Pane (including "Unique to Right Map"), and click "Match Left" or "Inspect" on any tag row.',
        uiCallout: 'Bottom-Right Bar -> [◫ Split Side-by-Side] & Right Comparison Pane',
        screenshotFile: './tutorials/tut-multi-map-split-compare.png',
      },
      {
        title: 'Tear Off Any Map Tab to a 2nd Monitor Window (↗) & Re-Dock (↙)',
        instruction:
          'Drag any bottom map tab outside the main window (or click the "↗" icon on the tab, or "[↗ 2nd Window]" in the Split Pane) to open that map in a second identical Mantle window on another monitor. Click "[↙ Re-Dock Back Into Main Window]" in the top bar of the second window to merge it back.',
        uiCallout: 'Bottom Map Tab -> Drag Out / Click ↗ -> ↙ Re-Dock Back Into Main Window',
        screenshotFile: './tutorials/tut-multi-map-split-compare.png',
        placeholder: {
          fileName: 'tut-placeholder-detached-second-monitor.png',
          whatToCapture:
            'Click the ↗ button on a bottom map tab so a second detached Mantle window opens showing "[↙ Re-Dock Back Into Main Window]" in its top menu bar, and capture.',
        },
      },
    ],
  },
  {
    id: 'loose-tags-git-workspace',
    category: 'HEK / Foundry Workflow',
    title: '16. Standard Blam Loose tags/ Workspace, Content Explorer, Auto-Fix & Git Review',
    difficulty: 'Advanced',
    duration: '5 min',
    summary:
      'Inspect parent/child tag dependency graphs in Content Explorer, auto-fix broken references, refactor tag folder prefixes, work directly on loose 64-byte Blam tags/ directories with Git diffing, and browse visual Bitmap/3D Model grids.',
    highlightZone: 'toolbar',
    heroScreenshot: './tutorials/tut-baboon-loose-tags-studio.png',
    steps: [
      {
        title: 'Use Content Explorer, Auto-Fix Broken Dependencies & Folder Refactoring',
        instruction:
          'Open "Tools -> 🕸️ Content Explorer, Dependency Auto-Fix & Refactoring...". Select any tag to inspect all Incoming Parents ("Referenced By") and Outgoing Children, click "🔧 Auto-Fix Broken Dependencies" to repair missing paths, or rename an entire folder prefix across all tags.',
        uiCallout: 'Tools -> 🕸️ Content Explorer, Dependency Auto-Fix & Refactoring',
        screenshotFile: './tutorials/tut-baboon-loose-tags-studio.png',
      },
      {
        title: 'Open a Loose Blam tags/ Folder, Run tool.exe & Browse Asset Grids',
        instruction:
          'Switch across the top tabs of the suite to open a loose HEK "tags/" folder with live Git status/commit review, run visual tool.exe compilation commands with the searchable HaloScript Reference, or browse every Bitmap (bitm) and 3D Model (mod2) in a visual thumbnail grid.',
        uiCallout: 'HEK Suite Tabs -> Loose Blam tags/ | Visual tool.exe | Bitmap & 3D Model Grids',
        screenshotFile: './tutorials/tut-baboon-loose-tags-studio.png',
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
          gap: 8,
          flexWrap: 'wrap',
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
          height: 132,
          fontFamily: 'var(--mono-font)',
          fontSize: 10,
        }}
      >
        {/* Top Toolbar Zone */}
        <div
          style={{
            ...zoneStyle('toolbar'),
            height: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 8px',
          }}
        >
          <span style={{ color: highlightZone === 'toolbar' ? 'var(--accent-cyan)' : 'var(--text-secondary)' }}>
            [Open Map] [Extract Tags] [Inject Tags] ... [🖥️ UI.map Studio] [🖼️ Inject HUD Bitmap] [🎯 Live HUD Editing] [▶ Play In OpenCE]
          </span>
          <span style={{ color: 'var(--text-dim)' }}>─ □ ✕</span>
        </div>

        {/* Center 3-Column Workspace */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '135px 1fr 175px', gap: 5, minHeight: 0 }}>
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
              {highlightZone === 'launcher' ? 'Launcher Sidebar' : 'Left: Hierarchy Tree'}
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 9 }}>
              ▸ scenario (1) • structure_bsp (1)
              <br />▸ weapon (20) • vehicle (6)
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
              Center: Overview / 3D Viewport / Bitmap / BSP Studio / 3D Script
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 9 }}>
              [Map Overview] [3D Viewport] [3D Bitmap Editor] [3D BSP &amp; Model Studio] [3D Script Builder]
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
            <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Right: Properties &amp; 3D Tools</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 9 }}>
              [PROPERTIES] [SWAPPER] [REFERENCES]
              <br />
              🌍 Gravity • 🧲 Auto-Snap • 🛡 Hitbox
            </div>
          </div>
        </div>

        {/* Bottom Open-Map Tab Bar Zone */}
        <div
          style={{
            ...zoneStyle('bottom-tabs'),
            height: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 8px',
          }}
        >
          <span style={{ color: highlightZone === 'bottom-tabs' ? 'var(--accent-cyan)' : 'var(--text-secondary)' }}>
            [⌂ Launcher] [bloodgulch.map ↗ ×] [SectorzGulch.map ↗ ×] [+]
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
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedId, setSelectedId] = useState<string>(TUTORIAL_GUIDES[0].id);
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; caption: string } | null>(null);
  const [missingImages, setMissingImages] = useState<Record<string, boolean>>({});

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const g of TUTORIAL_GUIDES) set.add(g.category);
    return ['ALL', ...Array.from(set)];
  }, []);

  const filteredGuides = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return TUTORIAL_GUIDES.filter((g) => {
      if (selectedCategory !== 'ALL' && g.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        g.title.toLowerCase().includes(q) ||
        g.category.toLowerCase().includes(q) ||
        g.summary.toLowerCase().includes(q) ||
        g.steps.some(
          (s) => s.title.toLowerCase().includes(q) || s.instruction.toLowerCase().includes(q),
        )
      );
    });
  }, [searchQuery, selectedCategory]);

  const activeGuide =
    filteredGuides.find((g) => g.id === selectedId) ?? filteredGuides[0] ?? TUTORIAL_GUIDES[0];

  const activeStep = activeGuide?.steps[activeStepIdx] ?? activeGuide?.steps[0];
  const activeScreenshotUrl = activeStep?.screenshotFile ?? activeGuide?.heroScreenshot;

  return (
    <div
      data-testid="tutorials-hub-modal-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.76)',
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
          width: 1120,
          maxWidth: '96vw',
          height: 760,
          maxHeight: '92vh',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 2,
          boxShadow: '0 12px 42px rgba(0, 0, 0, 0.72)',
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
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-primary)' }}>
              OpenCE Mantle Tutorials Hub — 16 Interactive Step-by-Step Guides with In-App Screenshots
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
              Click any step below to view its live UI location, in-app screenshot (click image to zoom full-screen), and custom capture slots
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
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Category Filter Bar */}
        <div
          style={{
            padding: '6px 14px',
            background: 'var(--bg-control)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            overflowX: 'auto',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 10.5, fontFamily: 'var(--mono-font)', color: 'var(--text-dim)', marginRight: 4 }}>
            CATEGORY:
          </span>
          {categories.map((cat) => {
            const active = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => {
                  setSelectedCategory(cat);
                  setActiveStepIdx(0);
                }}
                style={{
                  padding: '3px 9px',
                  fontSize: 10.5,
                  fontFamily: 'var(--mono-font)',
                  fontWeight: active ? 700 : 500,
                  background: active ? 'var(--selection-bg)' : 'var(--bg-panel)',
                  border: active ? '1px solid var(--border-active)' : '1px solid var(--border)',
                  color: active ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                  borderRadius: 2,
                  whiteSpace: 'nowrap',
                }}
              >
                {cat}
              </button>
            );
          })}
        </div>

        {/* Body: Left Searchable List + Right Step-by-Step Guide */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* Left Column */}
          <div
            style={{
              width: 330,
              flexShrink: 0,
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
                placeholder="Search 16 tutorials (e.g. BSP, HUD, Pelican, theme)..."
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
                        {g.difficulty} • {g.duration}
                      </span>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 12, marginTop: 2, lineHeight: 1.3 }}>{g.title}</div>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
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
                    <span
                      style={{
                        fontFamily: 'var(--mono-font)',
                        fontSize: 10,
                        padding: '1px 6px',
                        background: 'var(--bg-panel-header)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-dim)',
                        borderRadius: 2,
                      }}
                    >
                      ⏱ {activeGuide.duration}
                    </span>
                  </div>
                  <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {activeGuide.title}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.45 }}>
                    {activeGuide.summary}
                  </div>
                </div>

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
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
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

                {/* In-App Screenshot Preview + Optional Custom Capture Placeholder */}
                {activeScreenshotUrl && !missingImages[activeScreenshotUrl] && (
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
                        gap: 8,
                      }}
                    >
                      <span style={{ fontFamily: 'var(--mono-font)', color: 'var(--accent-cyan)', fontWeight: 600 }}>
                        🖼️ IN-APP SCREENSHOT — STEP {activeStepIdx + 1}: {activeStep?.title.toUpperCase()}
                      </span>
                      <button
                        onClick={() =>
                          setLightboxImage({
                            url: activeScreenshotUrl,
                            caption: `${activeGuide.title} — Step ${activeStepIdx + 1}: ${activeStep?.title}`,
                          })
                        }
                        style={{
                          padding: '2px 8px',
                          fontSize: 10.5,
                          fontFamily: 'var(--mono-font)',
                          background: 'var(--selection-bg)',
                          border: '1px solid var(--border-active)',
                          color: 'var(--accent-cyan)',
                          borderRadius: 2,
                        }}
                      >
                        🔍 Click to Enlarge Full-Screen
                      </button>
                    </div>
                    <div
                      onClick={() =>
                        setLightboxImage({
                          url: activeScreenshotUrl,
                          caption: `${activeGuide.title} — Step ${activeStepIdx + 1}: ${activeStep?.title}`,
                        })
                      }
                      style={{
                        cursor: 'zoom-in',
                        borderRadius: 2,
                        overflow: 'hidden',
                        border: '1px solid var(--border)',
                        background: '#05080d',
                        maxHeight: 280,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <img
                        src={activeScreenshotUrl}
                        alt={activeStep?.title ?? activeGuide.title}
                        onError={() =>
                          setMissingImages((prev) => ({
                            ...prev,
                            [activeScreenshotUrl]: true,
                          }))
                        }
                        style={{
                          width: '100%',
                          maxHeight: 280,
                          objectFit: 'contain',
                          display: 'block',
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Custom / In-Game Screenshot Placeholder Slot (auto-upgrades if user drops file in public/tutorials/) */}
                {activeStep?.placeholder && (
                  <div
                    style={{
                      border: '1px dashed var(--border-active)',
                      background: 'var(--bg-control)',
                      borderRadius: 2,
                      padding: '10px 12px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        flexWrap: 'wrap',
                        marginBottom: 4,
                      }}
                    >
                      <span style={{ fontFamily: 'var(--mono-font)', fontSize: 11, fontWeight: 700, color: 'var(--accent-gold)' }}>
                        📷 OPTIONAL CUSTOM / IN-GAME SCREENSHOT SLOT
                      </span>
                      <code
                        style={{
                          fontFamily: 'var(--mono-font)',
                          fontSize: 10.5,
                          padding: '1px 6px',
                          background: 'var(--bg-panel)',
                          border: '1px solid var(--border)',
                          color: 'var(--accent-cyan)',
                          borderRadius: 2,
                        }}
                      >
                        desktop/public/tutorials/{activeStep.placeholder.fileName}
                      </code>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                      <strong>What to capture if you want to add a custom screenshot here:</strong>{' '}
                      {activeStep.placeholder.whatToCapture}
                    </div>
                  </div>
                )}

                {/* Live Interactive UI Location Diagram */}
                <TutorialUiSchematic
                  highlightZone={activeGuide.highlightZone}
                  activeStepCallout={
                    activeGuide.steps[activeStepIdx]?.uiCallout ?? activeGuide.steps[0].uiCallout
                  }
                />
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
            Showing {filteredGuides.length} of {TUTORIAL_GUIDES.length} built-in tutorials (13 in-app screenshots bundled + 6 custom/in-game capture slots)
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

      {/* Full-Screen Screenshot Lightbox */}
      {lightboxImage && (
        <div
          onClick={() => setLightboxImage(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.88)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1400,
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '94vw',
              maxHeight: '90vh',
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-active)',
              borderRadius: 2,
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <span style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--text-primary)' }}>
                {lightboxImage.caption}
              </span>
              <button
                onClick={() => setLightboxImage(null)}
                style={{
                  padding: '3px 10px',
                  background: 'var(--selection-bg)',
                  border: '1px solid var(--border-active)',
                  color: 'var(--text-primary)',
                  fontSize: 11.5,
                  borderRadius: 2,
                }}
              >
                ✕ Close Zoom
              </button>
            </div>
            <img
              src={lightboxImage.url}
              alt={lightboxImage.caption}
              style={{
                maxWidth: '92vw',
                maxHeight: '82vh',
                objectFit: 'contain',
                display: 'block',
                border: '1px solid var(--border)',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
