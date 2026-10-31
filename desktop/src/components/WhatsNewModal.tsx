import { useMemo, useState } from 'react';

interface ReleaseEntry {
  version: string;
  date: string;
  headline: string;
  items: Array<{
    badge: 'NEW' | 'ENHANCED' | 'FIXED';
    title: string;
    detail: string;
  }>;
}

const RELEASE_NOTES: ReleaseEntry[] = [
  {
    version: '0.8.6',
    date: 'October 2026',
    headline: 'MCC & Loose-Tag Bitmap/Shader Fixes (BitmapData.flags 0x200 & _bitmap_cached_bit 0x80)',
    items: [
      {
        badge: 'FIXED',
        title: 'MCC BitmapData.flags Bit 9 (0x200) Bluescreen Fix (e.g. longest.map)',
        detail:
          'Strips unsupported MCC upper BitmapData.flags bits 9..15 (such as bit 9 0x200 in 0x283/0x281 on H1EK/MCC bitmaps) while preserving bit 8 (0x100 in_resource_map), preventing OpenCE\'s bitmap_verify ((flags & ~0xFF) == 0) from rejecting MCC-converted maps.',
      },
      {
        badge: 'FIXED',
        title: 'Loose HEK Tag Injection _bitmap_cached_bit (0x80) & Runtime Shader Scales (e.g. ForgeWorldAsset.map)',
        detail:
          'Ensures bit 7 (0x0080 _bitmap_cached_bit) is always set on internalized BitmapData entries so OpenCE\'s _texture_cache_bitmap_get_hardware_format loads and binds hardware textures instead of leaving stale textures bound. Also normalizes byte-swapped cache-only shader/object types, soso runtime 1.0f (+0x184), senv runtime_bump_map_scale (+0x138/+0x13C), and GBXModel geometry part node weights/links.',
      },
    ],
  },
  {
    version: '0.8.5',
    date: 'October 2026',
    headline: 'Fix MCC Map: Exact 4-Step MCC v13 -> CE v609 Pipeline (0x5444ADC2 Verified)',
    items: [
      {
        badge: 'NEW',
        title: 'Action 2: Fix MCC Map — Exact 4-Step MCC v13 to CE v609 Conversion Pipeline',
        detail:
          'Implemented the exact 4-step MCC v13 conversion pipeline: (1) detects version = 13 / old_base = 0x50000000, clears Windows ReadOnly, and writes .bak backup; (2) re-embeds externalized BSP uncompressed vertices at 0x800, updates lightmap material uncompressed_vertices TagDataOffsets, rewrites the 24-byte BSP header, and rebases 4-byte aligned BSP pointers with next_u32 == 0; (3) masks raw binary blobs (antr, snd!, metr, font, ustr, hmt , scnr) and rebases Tag Cache pointers from 0x50000000 to 0x40440000; (4) clamps hs_syntax_data (32,767 -> 19,001), zeroes header[0x68..0x7FB], runs the HaloScript AST pass, and recomputes the CE CRC32.',
      },
    ],
  },
  {
    version: '0.8.4',
    date: 'October 2026',
    headline: 'Fix MCC Map (Halo MCC CEA v13 & H1EK -> Custom Edition v609) Converter & Tag Validator Repairs',
    items: [
      {
        badge: 'NEW',
        title: 'Fix MCC Map: Full MCC CEA (v13) & H1EK (v609) to Custom Edition (v609) Converter',
        detail:
          'Replaced the Fix MCC Map placeholder with a complete MCC CEA (version = 13, build "01.03.43.0000") and MCC H1EK (version = 609) converter that unifies split MCC BSP vertex buffers and BSP tag blocks, populates lightmap material uncompressed_vertices TagDataOffsets, rebases all BSP and Tag Data pointers from 0x50000000 to 0x40440000, clears MCC header flags (0x68), runs the HaloScript AST fixer, and recalculates the CE header CRC32.',
      },
      {
        badge: 'FIXED',
        title: 'MCC 32,767-Node hs_syntax_data Table Clamping & Tag Validator Repairs',
        detail:
          'Clamps MCC\'s 32,767-node hs_syntax_data table (655,396 bytes / maximum_count = 32,767) to OpenCE\'s 19,001-node ceiling (380,076 bytes / maximum_count = 19,001) so OpenCE never refuses MCC maps in custom_edition_scripts_convert, and automatically repairs byte-swapped _object_definition.type fields (1536 -> 6), negative font character dimensions, and out-of-range bitmap sequence indices.',
      },
    ],
  },
  {
    version: '0.8.3',
    date: 'October 2026',
    headline: '122 MiB (0x47E40000) OpenCE Ceiling, Strict-Tree Collision BSP & World Merger Fixes',
    items: [
      {
        badge: 'FIXED',
        title: 'Exact 122 MiB (0x47E40000) OpenCE Tag Cache Ceiling & <= 32,766 Vertex Submesh Chunking',
        detail:
          'Aligned expanded BSP and tag-cache ceiling to OpenCE-Firefight\'s exact CUSTOM_EDITION_TAG_CACHE_BYTES (122 MiB / 0x47E40000), lowered submesh vertex chunking to 32,766 (<= MAXIMUM_VERTICES_PER_STRUCTURE_MATERIAL = 64,000), compacted culled vertex buffers, and filtered distant horizon LOD meshes (such as tfrag-lowres / v1-lores in jak.glb).',
      },
      {
        badge: 'FIXED',
        title: 'Strict-Tree bsp3d_nodes & Host Map Overlap Collision in World Merger / 3D BSP Studio',
        detail:
          'Replaced the shared-child 6-plane AABB root wrapper with a strict-tree bsp3d_nodes hierarchy so OpenCE\'s bsp3d_check (no node reached twice) never overwrites outside half-spaces with solid void (-1), and preserved Host Map collision surfaces inside the merged/procedural AABB.',
      },
      {
        badge: 'FIXED',
        title: 'Clockwise (CW) BSP Surface Winding, Subcluster Partitioning & Donor Map Viewport Textures',
        detail:
          'Fixed inside-out CCW triangle winding in injectProceduralWorldIntoMapBsp, partitioned merged surfaces into tight-AABB subclusters (<= 128 surfaces each, under MAXIMUM_SURFACES_PER_SUBCLUSTER = 4,096), consolidated all clusters/leaves into Cluster 0, and fixed PC/CE donor bitmaps.map resolution for 3D viewport textures.',
      },
    ],
  },
  {
    version: '0.8.2',
    date: 'October 2026',
    headline: 'Map Fixer Result Modal Crash Fix for HaloScript AST Node Mutations',
    items: [
      {
        badge: 'FIXED',
        title: 'Fixed UI Crash When Fixing Maps with HaloScript Errors',
        detail:
          'Resolved a property mismatch between CeMapFixResult (fixedNodes / nodesAlreadyFixed) and the Map Fix result modal (mutations / alreadyFixedNodes) that caused a React render crash after neutralizing or converting disallowed HaloScript AST nodes.',
      },
      {
        badge: 'FIXED',
        title: 'Worker Progress & Log Callback Wiring for Fixes Toolbar Actions',
        detail:
          'Fixed sendWorkerRequest argument ordering in map:runFixAction so worker log events and progress updates route cleanly without interfering with each other.',
      },
    ],
  },
  {
    version: '0.8.1',
    date: 'October 2026',
    headline: 'Model File BSP Audit: Native shader_environment (senv), Two-Sided Backfaces & 128k Surface Cap',
    items: [
      {
        badge: 'FIXED',
        title: 'Native shader_environment (senv, 836B) Generation for In-Game BSP Rendering',
        detail:
          'Switched injected BSP material shaders from shader_model (soso, 440B) to native shader_environment (senv, 836B, shader_type = 3) with alpha-tested flags and base map at +0x88 so Halo CE / OpenCE structure_render_lightmaps renders all textures in-game.',
      },
      {
        badge: 'FIXED',
        title: 'Automatic 128,000 Surface Ceiling (< MAXIMUM_SURFACES_PER_STRUCTURE = 131,072)',
        detail:
          'Deduplicates identical triangles per submesh chunk and automatically filters sub-centimeter micro-triangles on mega-levels (such as jak.glb with 366,530 raw triangles) to stay strictly under Halo CE\'s 131,072 surface bitvector limit.',
      },
      {
        badge: 'ENHANCED',
        title: 'Two-Sided Foliage Backfaces & Post-Splice BSP Dependency Path Pointers',
        detail:
          'Emits back-face surface triangles for two-sided/foliage submeshes when within surface budget, zeros stale donor BSP geometry reflexives in replace mode, and rewrites post-splice TagDependency pathPointers across the entire ScenarioStructureBSP.',
      },
    ],
  },
  {
    version: '0.8.0',
    date: 'October 2026',
    headline: 'Direct 3D Model File (.glb / .gltf / .obj / .jms) + Original Textures BSP Replacement & Merge',
    items: [
      {
        badge: 'NEW',
        title: 'Swap BSP Structure -> "Model File" Tab (.glb / .gltf / .obj / .jms)',
        detail:
          'Directly inject any 3D model file (including large multi-node glTF 2.0 .glb levels such as jak.glb, .obj + .mtl, or .jms) into the open map as a replacement or merged ScenarioStructureBSP with live preflight analysis.',
      },
      {
        badge: 'NEW',
        title: 'Automatic Embedded PNG/JPEG Texture Extraction & Alpha-Cutout Shader Generation',
        detail:
          'Decodes all embedded .glb PNG/JPEG bufferViews and external .mtl textures, builds 32-bit A8R8G8B8 bitmap (bitm) and shader_model (soso) tags with automatic two-sided & alpha-tested flags for foliage/cutout textures, and enables full-brightness diffuse rendering (bitmap = -1).',
      },
      {
        badge: 'NEW',
        title: '65,535 Vertex Auto-Chunking, Foliage Pass-Through & Ground Raycast Snapping',
        detail:
          'Welds vertices per material and splits large meshes into <= 60,000-vertex BSP submeshes, excludes foliage/alpha cards from solid collision while keeping them visible, compiles a walkable 3D CollisionBSP, and snaps player spawns, flags, equipment, and vehicles onto solid ground.',
      },
    ],
  },
  {
    version: '0.7.5',
    date: 'October 2026',
    headline: 'Toolbar "Fixes" Dropdown Menu (Fix CE Map, Fix MCC Map, Fix Halo Demo Map, Fix Halo MD Map, Fix Xbox Map)',
    items: [
      {
        badge: 'NEW',
        title: 'Fix CE Map (HaloScript AST Fixer + Custom Edition CRC32)',
        detail:
          'Scans compiled HaloScript syntax nodes (hs_syntax_data) in Halo Custom Edition (v609) maps, neutralizes disallowed function calls and non-whitelisted (set <global> <value>) mutations in-place via node_make_inert, converts (map_reset) to (game_revert) in singleplayer maps, and recalculates the Custom Edition header CRC32 at 0x64.',
      },
      {
        badge: 'NEW',
        title: 'Fix Halo Demo Map (v6), Fix Halo MD Map (v7), Fix Xbox Map (v5), and Fix MCC Map',
        detail:
          'Added one-click Fixes dropdown actions to convert Halo Trial/Mac Demo (v6), HaloMD (v7), and Original Halo Xbox (v5) maps into working Halo Custom Edition (v609) maps, run the HaloScript AST pass, and update the CE CRC32 checksum.',
      },
      {
        badge: 'FIXED',
        title: 'Automatic Windows ReadOnly Attribute Clearing & .bak Backups',
        detail:
          'Automatically clears Windows ReadOnly file attributes (0o666) and creates a .bak backup before patching or saving any .map file so read-only archive maps never fail with Permission Denied (EPERM/EACCES).',
      },
    ],
  },
  {
    version: '0.7.4',
    date: 'October 2026',
    headline: 'Multi-Map BSP World Merger 23 MiB Cache Compaction & Donor Shader Texture Transfer Fix',
    items: [
      {
        badge: 'FIXED',
        title: 'Merged Structure BSP 23 MiB Cache Fit & In-Place File Layout',
        detail:
          'injectProceduralWorldIntoMapBsp now reclaims replaced CollisionBSP, sbsp.leaves, and sbsp.surfaces byte ranges inside the base BSP, deduplicates vertices per shader bucket, adaptively budgets collision faces to fit within Halo CE’s 23 MiB tag cache ceiling (0x41B40000), and splices the merged BSP in-place at bspStart (0x800) before modelDataFileOffset and tagDataOffset.',
      },
      {
        badge: 'FIXED',
        title: 'Donor Map Shader & Bitmap Transfer in 3D Viewport and In-Game',
        detail:
          'Multi-Map World Merger now links and hydrates external bitmaps.map / sounds.map resources via autoLinkExternalResourceMapsInContainer and hydrateExternalRawDataInContainer before injecting donor shaders, prevents false donor tagId collisions with non-shader tags, and decodes donor textures case-insensitively in both the 3D Merger Preview and Scenario Viewport.',
      },
      {
        badge: 'NEW',
        title: 'Sapien-Style Blended Decals & Toggleable Coupled Scale in 3D Viewport',
        detail:
          'Scenario decals (deca) now render as ground-projected multi-layer planes with authentic Halo framebuffer blend modes (multiply, double_multiply, add, alpha_blend), and Coupled Scale (⚖️) now acts as a true toggleable scale state across both the 3D Scenario Viewport and 3D BSP & Model Studio.',
      },
    ],
  },
  {
    version: '0.7.3',
    date: 'October 2026',
    headline: 'Fix HaloMemBridge PowerShell Command-Line Overflow Breaking Tag Test Boot',
    items: [
      {
        badge: 'FIXED',
        title: 'Resolved spawn ENAMETOOLONG in HaloMemBridge Startup',
        detail:
          'Fixed a Windows 32,767-character command-line limit overflow when spawning HaloMemBridge with -EncodedCommand, which previously threw spawn ENAMETOOLONG right after launching halo.exe and triggered cleanup() to delete init.txt before console_startup() could load the staged map.',
      },
    ],
  },
  {
    version: '0.7.2',
    date: 'October 2026',
    headline: 'OpenCE Tag Test & Live HUD Single-Player Dev Mode Direct Boot Fix',
    items: [
      {
        badge: 'FIXED',
        title: 'Direct Boot into Single-Player Dev Mode via init.txt & Telnet Console',
        detail:
          'Fixed a startup race condition where Telnet port 2323 connected inside game_initialize() before console_startup() read d:\\init.txt, and prevented 128-byte Telnet client buffer overflows during synchronous map loading so Tag Test and Live HUD sessions boot directly into Single-Player Dev Mode.',
      },
      {
        badge: 'ENHANCED',
        title: 'Automatic Tag Space Compaction on Staged Tag Test Maps',
        detail:
          'Staging an in-memory map for Tag Test now automatically reclaims any orphaned script syntax blocks before writing custom_maps\\_opence_tag_test_a.map / _b.map.',
      },
      {
        badge: 'FIXED',
        title: 'Installed App Bundle & Start Menu Shortcut Synchronization',
        detail:
          'Packaging now automatically synchronizes the latest resources/app.asar bundle into %LOCALAPPDATA%\\Programs\\opence-desktop in addition to the portable executable and Desktop shortcut.',
      },
    ],
  },
  {
    version: '0.7.1',
    date: 'October 2026',
    headline: 'Inventor-Style Dual Split View, True 2-Map World Merger, FastGen Island & Live HUD Dev Mode',
    items: [
      {
        badge: 'ENHANCED',
        title: 'Autodesk Inventor-Style Side-by-Side Dual Map Instances',
        detail:
          'Split Side-by-Side view now keeps both maps simultaneously rendered and interactive (each with its own Tag Tree, 3D BSP Viewport, and Tag Inspector) while the top toolbar controls whichever pane was last clicked.',
      },
      {
        badge: 'NEW',
        title: 'True 2-Map World Merger (🌍 Multi-Map World Merger)',
        detail:
          'Combine a donor map’s Structure BSP (sbsp) directly into your open map at a spatial offset, automatically inject missing donor shader tags, and generate connecting tunnels or elevated bridges between the two worlds.',
      },
      {
        badge: 'NEW',
        title: 'FastGen World Builder, Tropical Island Preset & World Size Expansion',
        detail:
          'Overhauled procedural generation (now FastGen) with genuine multi-elevation Halo MP playspaces, a new 🏝️ Tropical Island / Atoll preset, +25% / +50% / 2× World Size Expansion, and a dedicated 📐 Parametric Part Designer mode.',
      },
      {
        badge: 'FIXED',
        title: 'Single Player Dev Mode Auto-Boot, Live HUD Editor & 3D Bitmap Resolution Live Sync',
        detail:
          'Tag Test and Live HUD Editor now auto-boot maps directly via -devmode + init_mantle_dev.txt, Live HUD Editor leaves top toolbar clearance with a Sync Held Weapon toggle, and 3D Bitmap Studio preserves live 3D model painting after resolution changes.',
      },
    ],
  },
  {
    version: '0.7.0',
    date: 'October 2026',
    headline: 'Guilty Spark Workspace Launcher, 6 Themes, Frameless Window & Multi-Map Split Tabs',
    items: [
      {
        badge: 'NEW',
        title: 'Guilty Spark-Inspired Workspace Launcher Home',
        detail:
          'Main launch page featuring a Recent Maps grid with top-down 2D orthographic Structure BSP (sbsp) wireframe previews, edition filters, pin/unpin support, and quick access to Tutorials, Glossary, Community, and What’s New.',
      },
      {
        badge: 'NEW',
        title: '6 Built-In UI & Blueprint Themes (Including Light Mode)',
        detail:
          'Added Change Theme selector popup with Native Dark Mode, Mantle Light Mode, Forerunner Monitor (Guilty Spark), Classic Halo CE Navy (2001 UI), Covenant Plasma (High Charity), and UNSC Tactical (Pillar of Autumn).',
      },
      {
        badge: 'NEW',
        title: 'Frameless Window with Integrated Top-Right Controls',
        detail:
          'Replaced the native OS title bar with a unified frameless header featuring Minimize (─), Maximize/Restore (□/❐), and Close (✕) controls built directly into the top-right corner.',
      },
      {
        badge: 'NEW',
        title: 'Bottom Multi-Map Tab Bar, Side-by-Side Split View & Multi-Monitor Tear-Off',
        detail:
          'Keep multiple .map files open simultaneously in bottom tabs, compare two maps side-by-side with a draggable center divider, or drag any map tab out of the window onto a second monitor.',
      },
    ],
  },
  {
    version: '0.6.9',
    date: 'October 2026',
    headline: 'Baboon / Foundry Parity Suite & Loose Blam tags/ Workspace',
    items: [
      {
        badge: 'NEW',
        title: 'Standard 64-Byte Blam Loose tags/ Workspace & Git Review',
        detail:
          'Open and edit standard HEK loose tags/ directories directly on disk, auto-fix broken TagDependency paths, refactor/move tag folders, and inspect Git branch diffs.',
      },
      {
        badge: 'NEW',
        title: 'Content Explorer Graph, TSV Reflexive I/O & Function Curve Plotter',
        detail:
          'Interactive incoming/outgoing dependency graph, clipboard TSV spreadsheet import/export for reflexive blocks, Blam periodic/transition function curve evaluator, and visual tool.exe command runner.',
      },
    ],
  },
  {
    version: '0.6.7',
    date: 'October 2026',
    headline: 'Live In-Game HUD & Weapon Memory Editor + UI.map Studio',
    items: [
      {
        badge: 'NEW',
        title: 'Real-Time Win32 Process Memory HUD & Weapon Editor',
        detail:
          'Drag HUD elements on an interactive 640×480 canvas or tweak weapon fire rates, projectiles, and damage in real time while Halo Custom Edition is running.',
      },
      {
        badge: 'NEW',
        title: 'UI.map Menu (DeLa) & Unicode String (ustr) Studio',
        detail:
          'Visual 640×480 menu layout editor for UI.map DeLa widgets with live text-box editing and RFC-4180 CSV string table import/export.',
      },
    ],
  },
  {
    version: '0.6.0',
    date: 'September 2026',
    headline: '3D BSP Viewport, Object Placement Gizmos, Custom Object Builder & HaloScript IDE',
    items: [
      {
        badge: 'NEW',
        title: 'Full 3D BSP & Scenario Object Editor',
        detail:
          'Fly through any Halo CE map in 3D with textured BSP meshes, select/move/rotate/duplicate vehicles, weapons, scenery, and spawns, and sculpt BSP/model vertices.',
      },
      {
        badge: 'NEW',
        title: 'Custom 3D Object Builder (.obj/.jms/.dae) & HaloScript (.hsc) Compiler',
        detail:
          'Import custom 3D meshes into playable scenery/weapons/vehicles with automatic collision generation, and decompile/edit/compile scenario HaloScript.',
      },
    ],
  },
];

interface WhatsNewModalProps {
  appVersion: string;
  onCheckUpdates: () => void;
  onClose: () => void;
}

export default function WhatsNewModal({ appVersion, onCheckUpdates, onClose }: WhatsNewModalProps) {
  const [query, setQuery] = useState('');

  const filteredReleases = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return RELEASE_NOTES;
    return RELEASE_NOTES.map((rel) => ({
      ...rel,
      items: rel.items.filter(
        (it) =>
          it.title.toLowerCase().includes(q) ||
          it.detail.toLowerCase().includes(q) ||
          rel.version.toLowerCase().includes(q),
      ),
    })).filter((rel) => rel.items.length > 0);
  }, [query]);

  return (
    <div
      data-testid="whats-new-modal-backdrop"
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
        data-testid="whats-new-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 760,
          maxWidth: '94vw',
          maxHeight: '86vh',
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
              What&apos;s New in OpenCE Mantle (v{appVersion || '0.6.9'})
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
              Recent release changelog, feature additions, and engine tooling updates
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={onCheckUpdates}
              style={{
                padding: '4px 10px',
                fontSize: 11.5,
                fontWeight: 600,
                background: 'var(--selection-bg)',
                border: '1px solid var(--border-active)',
                color: 'var(--accent-cyan)',
                borderRadius: 2,
              }}
            >
              ⬆ Check for Updates
            </button>
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
        </div>

        {/* Search bar */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-control)' }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search release notes (e.g. BSP, theme, HUD, HaloScript)..."
            style={{
              width: '100%',
              padding: '6px 10px',
              fontSize: 12,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              borderRadius: 2,
              outline: 'none',
            }}
          />
        </div>

        {/* Releases List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {filteredReleases.map((rel) => (
            <div
              key={rel.version}
              style={{
                border: '1px solid var(--border)',
                background: 'var(--bg-control)',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  padding: '8px 12px',
                  background: 'var(--bg-panel-header)',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontFamily: 'var(--mono-font)',
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '1px 7px',
                      background: 'var(--selection-bg)',
                      border: '1px solid var(--border-active)',
                      color: 'var(--accent-cyan)',
                      borderRadius: 2,
                    }}
                  >
                    v{rel.version}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--text-primary)' }}>
                    {rel.headline}
                  </span>
                </div>
                <span style={{ fontFamily: 'var(--mono-font)', fontSize: 11, color: 'var(--text-secondary)' }}>
                  {rel.date}
                </span>
              </div>

              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {rel.items.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span
                      style={{
                        fontFamily: 'var(--mono-font)',
                        fontSize: 9.5,
                        fontWeight: 700,
                        padding: '2px 5px',
                        borderRadius: 2,
                        background:
                          item.badge === 'NEW'
                            ? 'rgba(34, 197, 94, 0.16)'
                            : item.badge === 'ENHANCED'
                            ? 'rgba(56, 189, 248, 0.16)'
                            : 'rgba(234, 179, 8, 0.16)',
                        color:
                          item.badge === 'NEW'
                            ? 'var(--accent-green)'
                            : item.badge === 'ENHANCED'
                            ? 'var(--accent-cyan)'
                            : 'var(--accent-gold)',
                        border: '1px solid var(--border)',
                        flexShrink: 0,
                        marginTop: 1,
                      }}
                    >
                      {item.badge}
                    </span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--text-primary)' }}>
                        {item.title}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.45 }}>
                        {item.detail}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

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
