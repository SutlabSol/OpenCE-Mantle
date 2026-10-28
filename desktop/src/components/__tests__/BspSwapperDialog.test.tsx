import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BspSwapperDialog from '../BspSwapperDialog';
import type { BspSwapPreflightResult, BspSwapResult } from '../../../electron/shared-types';

describe('BspSwapperDialog', () => {
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();

  const mockPreflight: BspSwapPreflightResult = {
    ok: true,
    sourceBsps: [
      {
        index: 0,
        path: 'levels\\b30\\b30a',
        tagId: 0xef7b0e05,
        bspStart: 2048,
        bspSize: 8413184,
        bspAddress: 0x4133a000,
        vertexCount: 50936,
        triangleCount: 35105,
        submeshCount: 117,
        worldBounds: [-200, -200, -20, 200, 200, 50],
        hasDobc: true,
        hasDecals: true,
      },
      {
        index: 1,
        path: 'levels\\b30\\b30b',
        tagId: 0xefe10e6b,
        bspStart: 8415232,
        bspSize: 5566464,
        bspAddress: 0x415f1000,
        vertexCount: 32000,
        triangleCount: 22000,
        submeshCount: 80,
        worldBounds: [-150, -150, -10, 150, 150, 40],
        hasDobc: false,
        hasDecals: false,
      },
    ],
    targetBsps: [
      {
        index: 0,
        path: 'levels\\test\\bloodgulch\\bloodgulch',
        tagId: 0xeb0b0ab5,
        bspStart: 2048,
        bspSize: 1517568,
        bspAddress: 0x419cd800,
        vertexCount: 5762,
        triangleCount: 5503,
        submeshCount: 79,
        worldBounds: [-100, -100, -10, 100, 100, 30],
        hasDobc: false,
        hasDecals: false,
      },
    ],
    selectedSourceBsp: {
      index: 0,
      path: 'levels\\b30\\b30a',
      tagId: 0xef7b0e05,
      bspStart: 2048,
      bspSize: 8413184,
      bspAddress: 0x4133a000,
      vertexCount: 50936,
      triangleCount: 35105,
      submeshCount: 117,
      worldBounds: [-200, -200, -20, 200, 200, 50],
      hasDobc: true,
      hasDecals: true,
    },
    selectedTargetBsp: {
      index: 0,
      path: 'levels\\test\\bloodgulch\\bloodgulch',
      tagId: 0xeb0b0ab5,
      bspStart: 2048,
      bspSize: 1517568,
      bspAddress: 0x419cd800,
      vertexCount: 5762,
      triangleCount: 5503,
      submeshCount: 79,
      worldBounds: [-100, -100, -10, 100, 100, 30],
      hasDobc: false,
      hasDecals: false,
    },
    sizeDelta: 6895616,
    estimatedNewSize: 20831812,
    warnings: ['Source BSP contains Detail Objects (DOBC). Stripping recommended for multiplayer.'],
  };

  const mockSwapResult: BspSwapResult = {
    ok: true,
    buffer: Buffer.alloc(0),
    summary: {
      sourceBspName: 'levels\\b30\\b30a',
      targetBspName: 'levels\\test\\bloodgulch\\bloodgulch',
      oldSize: 13936196,
      newSize: 20831812,
      delta: 6895616,
      strippedDobc: true,
      strippedDecals: true,
      relocatedSpawns: 16,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).opence = {
      pickBspSourceMap: vi.fn().mockResolvedValue({ path: 'C:\\HaloPC\\maps\\b30.map' }),
      bspSwapPreflight: vi.fn().mockResolvedValue(mockPreflight),
      performBspSwap: vi.fn().mockResolvedValue(mockSwapResult),
    };
  });

  it('renders correctly when open', () => {
    render(
      <BspSwapperDialog
        isOpen={true}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    expect(screen.getByTestId('bsp-swapper-dialog')).toBeInTheDocument();
    expect(screen.getByText('Automated BSP Swapper')).toBeInTheDocument();
    expect(screen.getByTestId('bsp-swapper-browse-btn')).toBeInTheDocument();
  });

  it('picks a source map and runs preflight calculation', async () => {
    render(
      <BspSwapperDialog
        isOpen={true}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    fireEvent.click(screen.getByTestId('bsp-swapper-browse-btn'));

    await waitFor(() => {
      expect(window.opence.pickBspSourceMap).toHaveBeenCalled();
      expect(window.opence.bspSwapPreflight).toHaveBeenCalledWith('C:\\HaloPC\\maps\\b30.map', 0, 0);
    });

    expect(await screen.findByTestId('bsp-swapper-stats-card')).toBeInTheDocument();
    expect(screen.getByText(/50,936 vertices/i)).toBeInTheDocument();
    expect(screen.getByText(/35,105 triangles/i)).toBeInTheDocument();
    expect(screen.getByText(/DOBC present/i)).toBeInTheDocument();
  });

  it('performs BSP swap successfully when button clicked', async () => {
    render(
      <BspSwapperDialog
        isOpen={true}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    fireEvent.click(screen.getByTestId('bsp-swapper-browse-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('bsp-swapper-perform-btn')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('bsp-swapper-perform-btn'));

    await waitFor(() => {
      expect(window.opence.performBspSwap).toHaveBeenCalledWith(
        'C:\\HaloPC\\maps\\b30.map',
        expect.objectContaining({
          sourceBspIndex: 0,
          targetBspIndex: 0,
          stripDobcAndDecals: true,
          relocateGroundObjects: true,
          harvestShaders: true,
          importSceneryAndMachines: true,
          makeDoorsAutomatic: true,
        })
      );
      expect(mockOnSuccess).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('bsp-swapper-success')).toBeInTheDocument();
    });
  });

  it('closes dialog when cancel/close button is clicked', () => {
    render(
      <BspSwapperDialog
        isOpen={true}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    fireEvent.click(screen.getByTestId('bsp-swapper-close-btn'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('supports multi-BSP selection and performs combined BSP swap', async () => {
    render(
      <BspSwapperDialog
        isOpen={true}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    fireEvent.click(screen.getByTestId('bsp-swapper-browse-btn'));

    await waitFor(() => {
      expect(screen.getByText(/levels\\b30\\b30a/i)).toBeInTheDocument();
      expect(screen.getByText(/levels\\b30\\b30b/i)).toBeInTheDocument();
    });

    const selectAllBtn = screen.getByText('Select All');
    fireEvent.click(selectAllBtn);

    await waitFor(() => {
      expect(screen.getByText(/Multi-BSP Combine Mode/i)).toBeInTheDocument();
      expect(screen.getByText(/Merge & Swap \(2 BSPs\)/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('bsp-swapper-perform-btn'));

    await waitFor(() => {
      expect(window.opence.performBspSwap).toHaveBeenCalledWith(
        'C:\\HaloPC\\maps\\b30.map',
        expect.objectContaining({
          sourceBspIndex: 0,
          sourceBspIndices: [0, 1],
          targetBspIndex: 0,
        })
      );
      expect(mockOnSuccess).toHaveBeenCalledTimes(1);
    });
  });
});
