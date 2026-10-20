import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CurveGraphVisualizer, { evaluateHaloFunction } from '../CurveGraphVisualizer';

describe('CurveGraphVisualizer', () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      closePath: vi.fn(),
      fillText: vi.fn(),
      setLineDash: vi.fn(),
    });
  });

  it('evaluates Halo transition mathematical functions accurately', () => {
    expect(evaluateHaloFunction(0.5, 'linear')).toBe(0.5);
    expect(evaluateHaloFunction(0.5, 'cosine')).toBeCloseTo(0.5, 3);
    expect(evaluateHaloFunction(0, 'cosine')).toBeCloseTo(0, 3);
    expect(evaluateHaloFunction(1, 'cosine')).toBeCloseTo(1, 3);
    expect(evaluateHaloFunction(0.5, 'late')).toBe(0.25);
    expect(evaluateHaloFunction(0.5, 'early')).toBe(0.75);
    expect(evaluateHaloFunction(0.5, 'one')).toBe(1.0);
    expect(evaluateHaloFunction(0.5, 'zero')).toBe(0.0);
  });

  it('renders curve graph canvas and controls', () => {
    render(<CurveGraphVisualizer title="Test Curve" />);
    expect(screen.getByText(/Test Curve/)).toBeInTheDocument();
    expect(screen.getByTestId('curve-transition-select')).toBeInTheDocument();
    expect(screen.getByTestId('curve-exponent-slider')).toBeInTheDocument();
    expect(screen.getByTestId('curve-scale-slider')).toBeInTheDocument();
    expect(screen.getByTestId('curve-frequency-slider')).toBeInTheDocument();
  });

  it('updates transition function when select option changes', async () => {
    const user = userEvent.setup();
    const onParamsChange = vi.fn();
    render(<CurveGraphVisualizer onParametersChange={onParamsChange} />);

    const select = screen.getByTestId('curve-transition-select');
    await user.selectOptions(select, 'early');

    expect(onParamsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        transition: 'early',
      }),
    );
  });
});
