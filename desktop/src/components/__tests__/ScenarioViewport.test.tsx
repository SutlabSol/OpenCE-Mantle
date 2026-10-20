import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ScenarioViewport from '../viewport/ScenarioViewport';
import type {
  MapHeaderSummary,
  BspRenderMesh,
  OpenceApi,
  ScenarioPlacementsSummary,
  ModelRenderGeometry,
} from '../../../electron/shared-types';

const mockHeader: MapHeaderSummary = {
  scenarioName: 'bloodgulch',
  buildString: '01.00.00.0609',
  mapType: 1,
  crc32: 0x7b309554,
  tagDataOffset: 0x800,
  tagDataSize: 5000000,
  decompressedFileSize: 14000000,
  fileSizeOnDisk: 14000000,
  tagCount: 2000,
};

const mockBspMesh: BspRenderMesh = {
  bspIndex: 0,
  bspTagId: 0xe1740001,
  lightmapsBitmapTagId: 0xffffffff,
  worldBounds: [-100, -100, -10, 100, 100, 50],
  totalVertices: 5762,
  totalTriangles: 5503,
  submeshes: [
    {
      submeshIndex: 0,
      lightmapIndex: 0,
      lightmapBitmapIndex: -1,
      shaderTagId: 0xe1740008,
      shaderPermutation: 0,
      vertexCount: 4,
      vertices: new Float32Array([
        -10, -10, 0,  0, 0, 1,  0, 0,
         10, -10, 0,  0, 0, 1,  1, 0,
         10,  10, 0,  0, 0, 1,  1, 1,
        -10,  10, 0,  0, 0, 1,  0, 1,
      ]),
      lightmapUvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
      boundingBox: [-10, -10, 0, 10, 10, 0],
    },
  ],
};

const mockScenarioSummary: ScenarioPlacementsSummary = {
  scenarioTagId: 0xe1740000,
  scenarioPath: 'levels\\test\\bloodgulch\\bloodgulch',
  totalObjects: 4,
  counts: {
    vehicles: 1,
    scenery: 1,
    bipeds: 0,
    weapons: 1,
    equipment: 0,
    spawns: 1,
  },
  palettes: {
    vehicles: [{ paletteIndex: 0, tagId: 0xe1740004, path: 'vehicles\\warthog\\mp_warthog', name: 'mp_warthog' }],
    scenery: [{ paletteIndex: 0, tagId: 0xe1740009, path: 'scenery\\rocks\\rock01', name: 'rock01' }],
    bipeds: [],
    weapons: [{ paletteIndex: 0, tagId: 0xe174000a, path: 'weapons\\assault rifle\\assault rifle', name: 'assault rifle' }],
    equipment: [{ paletteIndex: 0, tagId: 0xe174000b, path: 'item collections\\single weapons\\shotgun', name: 'shotgun' }],
  },
  objects: [
    {
      id: 'vehicle-0',
      kind: 'vehicle',
      paletteIndex: 0,
      nameIndex: 0,
      objectTagId: 0xe1740004,
      objectPath: 'vehicles\\warthog\\mp_warthog',
      modelTagId: 0xe1740003,
      position: [10, 10, 0],
      rotation: [0, 0, 0],
    },
    {
      id: 'scenery-0',
      kind: 'scenery',
      paletteIndex: 0,
      nameIndex: 0,
      objectTagId: 0xe1740009,
      objectPath: 'scenery\\rocks\\rock01',
      modelTagId: 0xe1740003,
      position: [-15, 20, 0],
      rotation: [0.5, 0, 0],
    },
    {
      id: 'spawn-0',
      kind: 'spawn',
      paletteIndex: -1,
      nameIndex: -1,
      objectTagId: 0xffffffff,
      objectPath: 'Player Spawn (Red)',
      modelTagId: 0xffffffff,
      position: [0, -30, 1],
      rotation: [1.57, 0, 0],
      teamIndex: 0,
    },
    {
      id: 'weapon-0',
      kind: 'weapon',
      paletteIndex: 0,
      nameIndex: -1,
      objectTagId: 0xe174000a,
      objectPath: 'weapons\\assault rifle\\assault rifle',
      modelTagId: 0xffffffff,
      position: [5, 5, 0],
      rotation: [0, 0, 0],
    },
    {
      id: 'netgame_flag-0',
      kind: 'netgame_flag',
      paletteIndex: 6,
      nameIndex: -1,
      objectTagId: 0xffffffff,
      objectPath: 'Teleport Origin (ID: 0)',
      modelTagId: 0xffffffff,
      position: [20, 20, 0],
      rotation: [0, 0, 0],
      teamIndex: 0,
    },
    {
      id: 'netgame_flag-1',
      kind: 'netgame_flag',
      paletteIndex: 7,
      nameIndex: -1,
      objectTagId: 0xffffffff,
      objectPath: 'Teleport Destination (ID: 0)',
      modelTagId: 0xffffffff,
      position: [40, 40, 0],
      rotation: [0, 0, 0],
      teamIndex: 0,
    },
    {
      id: 'netgame_flag-2',
      kind: 'netgame_flag',
      paletteIndex: 8,
      nameIndex: -1,
      objectTagId: 0xffffffff,
      objectPath: 'KOTH Hill Point (Hill ID: 1)',
      modelTagId: 0xffffffff,
      position: [-5, -5, 0],
      rotation: [0, 0, 0],
      teamIndex: 1,
    },
  ],
};

const mockModelGeometry: ModelRenderGeometry = {
  modelTagId: 0xe1740003,
  modelPath: 'vehicles\\warthog\\warthog',
  lodLevel: 4,
  uScale: 1,
  vScale: 1,
  totalVertices: 4,
  totalTriangles: 2,
  submeshes: [
    {
      partIndex: 0,
      shaderIndex: 0,
      shaderTagId: 0xe1740008,
      vertexCount: 4,
      vertices: new Float32Array([
        -1, -1, 0,  0, 0, 1,  0, 0,
         1, -1, 0,  0, 0, 1,  1, 0,
         1,  1, 0,  0, 0, 1,  1, 1,
        -1,  1, 0,  0, 0, 1,  0, 1,
      ]),
      indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
      boundingBox: [-1, -1, 0, 1, 1, 0],
    },
  ],
};

describe('ScenarioViewport', () => {
  beforeEach(() => {
    (window as unknown as { opence: Partial<OpenceApi> }).opence = {
      getBspRenderMesh: vi.fn(async () => ({ ok: true as const, mesh: mockBspMesh })),
      getBitmapTexture: vi.fn(async () => ({
        ok: true as const,
        texture: {
          width: 4,
          height: 4,
          format: 10,
          rgbaData: new Uint8Array(4 * 4 * 4),
        },
      })),
      getScenarioObjects: vi.fn(async () => ({
        ok: true as const,
        summary: mockScenarioSummary,
      })),
      getModelGeometry: vi.fn(async () => ({
        ok: true as const,
        geometry: mockModelGeometry,
      })),
      updateScenarioPlacement: vi.fn(async () => ({
        ok: true as const,
        summary: mockScenarioSummary,
        map: { filePath: 'C:\\test.map', modified: true } as any,
      })),
      duplicateScenarioPlacement: vi.fn(async () => ({
        ok: true as const,
        summary: mockScenarioSummary,
        newPlacement: mockScenarioSummary.objects[0],
        map: { filePath: 'C:\\test.map', modified: true } as any,
      })),
      addScenarioPlacement: vi.fn(async () => ({
        ok: true as const,
        summary: mockScenarioSummary,
        newPlacement: mockScenarioSummary.objects[0],
        map: { filePath: 'C:\\test.map', modified: true } as any,
      })),
      swapScenarioPlacement: vi.fn(async () => ({
        ok: true as const,
        summary: mockScenarioSummary,
        newPlacement: mockScenarioSummary.objects[0],
        map: { filePath: 'C:\\test.map', modified: true } as any,
      })),
      deleteScenarioPlacement: vi.fn(async () => ({
        ok: true as const,
        summary: mockScenarioSummary,
        map: { filePath: 'C:\\test.map', modified: true } as any,
      })),
    };
  });

  it('renders the viewport container and HUD with scenario information and mesh stats', async () => {
    render(<ScenarioViewport header={mockHeader} bspIndex={0} />);

    expect(screen.getByTestId('scenario-viewport')).toBeInTheDocument();
    expect(screen.getByText('bloodgulch')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/5,762 verts \/ 5,503 tris/i)).toBeInTheDocument();
    });

    expect(window.opence.getBspRenderMesh).toHaveBeenCalledWith(0);
  });

  it('allows switching render modes', async () => {
    render(<ScenarioViewport header={mockHeader} bspIndex={0} />);

    await waitFor(() => {
      expect(screen.queryByTestId('viewport-loading')).not.toBeInTheDocument();
    });

    const wireframeBtn = screen.getByTestId('viewport-mode-wireframe');
    fireEvent.click(wireframeBtn);

    const flatBtn = screen.getByTestId('viewport-mode-flat');
    fireEvent.click(flatBtn);

    const texturedBtn = screen.getByTestId('viewport-mode-textured');
    fireEvent.click(texturedBtn);

    const twBtn = screen.getByTestId('viewport-mode-textured-wireframe');
    fireEvent.click(twBtn);
  });

  it('allows changing camera flight speed via slider', async () => {
    render(<ScenarioViewport header={mockHeader} bspIndex={0} />);

    await waitFor(() => {
      expect(screen.queryByTestId('viewport-loading')).not.toBeInTheDocument();
    });

    const slider = screen.getByTestId('viewport-speed-control');
    fireEvent.change(slider, { target: { value: '120' } });

    expect(screen.getByText('120')).toBeInTheDocument();
  });

  it('triggers frameScene when clicking the reset camera button', async () => {
    render(<ScenarioViewport header={mockHeader} bspIndex={0} />);

    await waitFor(() => {
      expect(screen.queryByTestId('viewport-loading')).not.toBeInTheDocument();
    });

    const resetBtn = screen.getByTestId('viewport-reset-camera');
    fireEvent.click(resetBtn);
  });

  it('renders layer toggles and allows toggling visibility (Step 8.5)', async () => {
    render(<ScenarioViewport header={mockHeader} bspIndex={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('layer-toggle-bsp')).toBeInTheDocument();
      expect(screen.getByTestId('layer-toggle-vehicles')).toBeInTheDocument();
      expect(screen.getByTestId('layer-toggle-scenery')).toBeInTheDocument();
      expect(screen.getByTestId('layer-toggle-spawns')).toBeInTheDocument();
      expect(screen.getByTestId('layer-toggle-items')).toBeInTheDocument();
    });

    // Check counts display
    await waitFor(() => {
      expect(screen.getByTestId('layer-toggle-vehicles')).toHaveTextContent('Vehicles');
      expect(screen.getByTestId('layer-toggle-vehicles')).toHaveTextContent('(1)');
    });

    // Click vehicle layer toggle to hide vehicles
    const vehicleToggle = screen.getByTestId('layer-toggle-vehicles');
    fireEvent.click(vehicleToggle);

    // Click BSP layer toggle
    const bspToggle = screen.getByTestId('layer-toggle-bsp');
    fireEvent.click(bspToggle);

    expect(window.opence.getScenarioObjects).toHaveBeenCalled();
  });

  it('renders error overlay when getBspRenderMesh fails', async () => {
    (window as unknown as { opence: Partial<OpenceApi> }).opence.getBspRenderMesh = vi.fn(async () => ({
      ok: false as const,
      code: 'CORRUPT_BSP',
      message: 'Failed to read scenario structure BSP.',
    }));

    render(<ScenarioViewport header={mockHeader} bspIndex={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('viewport-error')).toBeInTheDocument();
    });

    expect(screen.getByText('Failed to read scenario structure BSP.')).toBeInTheDocument();
  });

  it('allows selecting an object from outliner and modifying its properties (Step 9)', async () => {
    render(<ScenarioViewport header={mockHeader} bspIndex={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('scenario-inspector-panel')).toBeInTheDocument();
    });

    // Switch to outliner tab
    const outlinerTab = screen.getByTestId('inspector-tab-outliner');
    fireEvent.click(outlinerTab);

    // Click on vehicle-0
    const vehicleItem = screen.getByTestId('outliner-item-vehicle-0');
    expect(vehicleItem).toBeInTheDocument();
    fireEvent.click(vehicleItem);

    // Now properties tab should show vehicle-0 details
    await waitFor(() => {
      expect(screen.getByTestId('inspector-pos-x')).toBeInTheDocument();
    });

    expect(screen.getByTestId('inspector-pos-x')).toHaveValue(10);
    expect(screen.getByTestId('inspector-pos-y')).toHaveValue(10);

    // Edit position X
    const posXInput = screen.getByTestId('inspector-pos-x');
    fireEvent.change(posXInput, { target: { value: '25.5' } });

    expect(window.opence.updateScenarioPlacement).toHaveBeenCalledWith('vehicle-0', {
      position: [25.5, 10, 0],
    });

    // Edit palette type
    const paletteSelect = screen.getByTestId('inspector-palette-select');
    fireEvent.change(paletteSelect, { target: { value: '0' } });

    expect(window.opence.updateScenarioPlacement).toHaveBeenCalledWith('vehicle-0', {
      paletteIndex: 0,
    });

    // Switch gizmo mode
    const rotateGizmoBtn = screen.getByTestId('gizmo-mode-rotate');
    fireEvent.click(rotateGizmoBtn);
    const translateGizmoBtn = screen.getByTestId('gizmo-mode-translate');
    fireEvent.click(translateGizmoBtn);
  });

  it('allows duplicating and deleting scenario objects from the inspector', async () => {
    render(<ScenarioViewport header={mockHeader} bspIndex={0} />);

    // Switch to outliner tab and pick spawn-0
    await waitFor(() => {
      expect(screen.getByTestId('inspector-tab-outliner')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('inspector-tab-outliner'));

    fireEvent.click(screen.getByTestId('outliner-item-spawn-0'));

    await waitFor(() => {
      expect(screen.getByTestId('inspector-duplicate-btn')).toBeInTheDocument();
    });

    // Duplicate spawn-0
    fireEvent.click(screen.getByTestId('inspector-duplicate-btn'));
    expect(window.opence.duplicateScenarioPlacement).toHaveBeenCalledWith('spawn-0');

    // Delete spawn-0
    fireEvent.click(screen.getByTestId('inspector-delete-btn'));
    expect(window.opence.deleteScenarioPlacement).toHaveBeenCalledWith('spawn-0');
  });

  it('allows adding a new scenario object via the add object modal', async () => {
    render(<ScenarioViewport header={mockHeader} bspIndex={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('viewport-add-object-btn')).toBeInTheDocument();
    });

    // Open Add Object modal
    fireEvent.click(screen.getByTestId('viewport-add-object-btn'));

    expect(screen.getByTestId('add-object-modal')).toBeInTheDocument();

    // Select category spawn
    const kindSelect = screen.getByTestId('add-modal-kind-select');
    fireEvent.change(kindSelect, { target: { value: 'spawn' } });

    // Submit
    const submitBtn = screen.getByTestId('add-modal-submit-btn');
    fireEvent.click(submitBtn);

    expect(window.opence.addScenarioPlacement).toHaveBeenCalledWith(
      'spawn',
      0,
      expect.any(Array),
      expect.any(Array),
      0,
    );
  });

  it('populates scenery and equipment palettes in the add object modal', async () => {
    render(<ScenarioViewport header={mockHeader} bspIndex={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('viewport-add-object-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('viewport-add-object-btn'));

    const kindSelect = screen.getByTestId('add-modal-kind-select');

    // Select scenery
    fireEvent.change(kindSelect, { target: { value: 'scenery' } });
    const scenerySelect = screen.getByTestId('add-modal-palette-select');
    expect(scenerySelect).toBeInTheDocument();
    expect(scenerySelect.textContent).toContain('rock01');

    // Select equipment
    fireEvent.change(kindSelect, { target: { value: 'equipment' } });
    const equipmentSelect = screen.getByTestId('add-modal-palette-select');
    expect(equipmentSelect).toBeInTheDocument();
    expect(equipmentSelect.textContent).toContain('shotgun');
  });

  it('renders Multi-BSP selector when map has multiple BSPs and switches BSP on change', async () => {
    const multiBspMesh: BspRenderMesh = {
      ...mockBspMesh,
      bspCount: 2,
      bspNames: ['levels/c10/c10_a', 'levels/c10/c10_b'],
    };
    (window.opence.getBspRenderMesh as any).mockImplementation((idx: number) =>
      Promise.resolve({ ok: true, mesh: { ...multiBspMesh, bspIndex: idx } }),
    );

    render(<ScenarioViewport header={mockHeader} bspIndex={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('viewport-bsp-selector')).toBeInTheDocument();
    });

    const bspButton = screen.getByTestId('viewport-bsp-selector');
    expect(bspButton).toBeInTheDocument();
    expect(bspButton.textContent).toContain('1 / 2 visible');

    // Open multi-BSP dropdown menu
    fireEvent.click(bspButton);
    expect(screen.getByTestId('viewport-bsp-dropdown-menu')).toBeInTheDocument();
    expect(screen.getByTestId('viewport-bsp-dropdown-menu').textContent).toContain('c10_a');
    expect(screen.getByTestId('viewport-bsp-dropdown-menu').textContent).toContain('c10_b');

    // Toggle BSP 1 on (simultaneous rendering)
    fireEvent.click(screen.getByTestId('viewport-bsp-toggle-1'));
    expect(window.opence.getBspRenderMesh).toHaveBeenCalledWith(1);
    expect(bspButton.textContent).toContain('2 / 2 visible');

    // Toggle BSP 0 off -> now only BSP 1 is visible
    fireEvent.click(screen.getByTestId('viewport-bsp-toggle-0'));
    expect(bspButton.textContent).toContain('1 / 2 visible');

    // Click Show All
    fireEvent.click(screen.getByTestId('bsp-show-all-btn'));
    expect(bspButton.textContent).toContain('2 / 2 visible');

    // Click Reset
    fireEvent.click(screen.getByTestId('bsp-reset-btn'));
    expect(bspButton.textContent).toContain('1 / 2 visible');
  });

  it('displays Force Spawn toggle for vehicles and triggers update on toggle', async () => {
    render(<ScenarioViewport header={mockHeader} bspIndex={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('inspector-tab-outliner')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('inspector-tab-outliner'));
    const item = screen.getByTestId('outliner-item-vehicle-0');
    fireEvent.click(item);

    await waitFor(() => {
      expect(screen.getByTestId('inspector-force-spawn-toggle')).toBeInTheDocument();
    });

    const toggle = screen.getByTestId('inspector-force-spawn-toggle') as HTMLInputElement;
    fireEvent.click(toggle);

    expect(window.opence.updateScenarioPlacement).toHaveBeenCalledWith(
      'vehicle-0',
      expect.objectContaining({ forceSpawn: expect.any(Boolean) }),
    );
  });

  it('allows swapping selected object with another item via Swap Object section', async () => {
    render(<ScenarioViewport header={mockHeader} bspIndex={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('inspector-tab-outliner')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('inspector-tab-outliner'));
    const item = screen.getByTestId('outliner-item-vehicle-0');
    fireEvent.click(item);

    await waitFor(() => {
      expect(screen.getByTestId('inspector-swap-btn')).toBeInTheDocument();
    });

    const swapKindSelect = screen.getByTestId('swap-kind-select');
    fireEvent.change(swapKindSelect, { target: { value: 'scenery' } });

    const swapPaletteSelect = screen.getByTestId('swap-palette-select');
    expect(swapPaletteSelect).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('inspector-swap-btn'));

    expect(window.opence.swapScenarioPlacement).toHaveBeenCalledWith('vehicle-0', 'scenery', 0);
  });

  it('renders View Cube / Orientation Gizmo with +X, -X, +Y, -Y, +Z, -Z, ISO buttons', async () => {
    render(<ScenarioViewport header={mockHeader} bspIndex={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('viewport-orientation-gizmo')).toBeInTheDocument();
    });

    const btnTop = screen.getByTestId('orientation-btn-top');
    const btnIso = screen.getByTestId('orientation-btn-iso');
    const btnFront = screen.getByTestId('orientation-btn-front');
    const btnBack = screen.getByTestId('orientation-btn-back');
    const btnLeft = screen.getByTestId('orientation-btn-left');
    const btnRight = screen.getByTestId('orientation-btn-right');
    const btnBottom = screen.getByTestId('orientation-btn-bottom');

    expect(btnTop).toBeInTheDocument();
    expect(btnIso).toBeInTheDocument();
    expect(btnFront).toBeInTheDocument();
    expect(btnBack).toBeInTheDocument();
    expect(btnLeft).toBeInTheDocument();
    expect(btnRight).toBeInTheDocument();
    expect(btnBottom).toBeInTheDocument();

    fireEvent.click(btnTop);
    fireEvent.click(btnFront);
    fireEvent.click(btnIso);
  });

  it('displays Teleporter Pair controls with ID input and Switch buttons when teleporter is selected', async () => {
    render(<ScenarioViewport header={mockHeader} bspIndex={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('inspector-tab-outliner')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('inspector-tab-outliner'));
    const item = screen.getByTestId('outliner-item-netgame_flag-0');
    fireEvent.click(item);

    await waitFor(() => {
      expect(screen.getByTestId('inspector-teleport-controls')).toBeInTheDocument();
      expect(screen.getByTestId('inspector-teleport-id-input')).toBeInTheDocument();
      expect(screen.getByTestId('inspector-teleport-switch-origin')).toBeInTheDocument();
      expect(screen.getByTestId('inspector-teleport-switch-dest')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('inspector-teleport-switch-dest'));
    fireEvent.click(screen.getByTestId('inspector-teleport-switch-origin'));
  });

  it('displays KOTH Zone controls with KOTH ID, Add Point, Remove Point, and Select Full Zone buttons', async () => {
    render(<ScenarioViewport header={mockHeader} bspIndex={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('inspector-tab-outliner')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('inspector-tab-outliner'));
    const item = screen.getByTestId('outliner-item-netgame_flag-2');
    fireEvent.click(item);

    await waitFor(() => {
      expect(screen.getByTestId('inspector-koth-controls')).toBeInTheDocument();
      expect(screen.getByTestId('inspector-koth-id-input')).toBeInTheDocument();
      expect(screen.getByTestId('inspector-koth-add-point')).toBeInTheDocument();
      expect(screen.getByTestId('inspector-koth-remove-point')).toBeInTheDocument();
      expect(screen.getByTestId('inspector-koth-select-zone')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('inspector-koth-select-zone'));
  });

  it('displays Player Spawn management info with team count and Select All Team Spawns button', async () => {
    render(<ScenarioViewport header={mockHeader} bspIndex={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('inspector-tab-outliner')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('inspector-tab-outliner'));
    const item = screen.getByTestId('outliner-item-spawn-0');
    fireEvent.click(item);

    await waitFor(() => {
      expect(screen.getByTestId('inspector-spawn-team-controls')).toBeInTheDocument();
      expect(screen.getByTestId('inspector-select-all-team-spawns')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('inspector-select-all-team-spawns'));
  });

  it('includes 1-way and 2-way teleporters, KOTH zone, race, and oddball in Add Object modal categories', async () => {
    render(<ScenarioViewport header={mockHeader} bspIndex={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('viewport-add-object-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('viewport-add-object-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('add-modal-kind-select')).toBeInTheDocument();
    });

    const kindSelect = screen.getByTestId('add-modal-kind-select') as HTMLSelectElement;
    const optionValues = Array.from(kindSelect.options).map((o) => o.value);
    expect(optionValues).toContain('teleport');
    expect(optionValues).toContain('teleport_2way');
    expect(optionValues).toContain('koth');
    expect(optionValues).toContain('race');
    expect(optionValues).toContain('oddball');
  });
});
