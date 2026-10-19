import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ScenarioViewport from '../viewport/ScenarioViewport';
import type { MapHeaderSummary, BspRenderMesh, OpenceApi } from '../../../electron/shared-types';

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

describe('ScenarioViewport', () => {
  beforeEach(() => {
    (window as unknown as { opence: Partial<OpenceApi> }).opence = {
      getBspRenderMesh: vi.fn(async () => ({ ok: true, mesh: mockBspMesh })),
      getBitmapTexture: vi.fn(async () => ({
        ok: true,
        texture: {
          width: 4,
          height: 4,
          format: 10,
          rgbaData: new Uint8Array(4 * 4 * 4),
        },
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

  it('renders error overlay when getBspRenderMesh fails', async () => {
    (window as unknown as { opence: Partial<OpenceApi> }).opence.getBspRenderMesh = vi.fn(async () => ({
      ok: false,
      code: 'CORRUPT_BSP',
      message: 'Failed to read scenario structure BSP.',
    }));

    render(<ScenarioViewport header={mockHeader} bspIndex={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('viewport-error')).toBeInTheDocument();
    });

    expect(screen.getByText('Failed to read scenario structure BSP.')).toBeInTheDocument();
  });
});
