import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfirmDialog from '../ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders the title and message, and calls the matching button handler on click', async () => {
    const onContinue = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Large selection"
        message="You're about to walk dependencies for 500 tags."
        onEscape={onCancel}
        buttons={[
          { label: 'Continue', variant: 'primary', testId: 'confirm-continue', onClick: onContinue },
          { label: 'Cancel', autoFocus: true, testId: 'confirm-cancel', onClick: onCancel },
        ]}
      />,
    );

    expect(screen.getByText('Large selection')).toBeInTheDocument();
    expect(screen.getByText(/500 tags/)).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('confirm-continue'));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('focuses the autoFocus button (Cancel) by default so Enter cancels', () => {
    render(
      <ConfirmDialog
        title="Large selection"
        message="Continue?"
        onEscape={vi.fn()}
        buttons={[
          { label: 'Continue', variant: 'primary', testId: 'confirm-continue', onClick: vi.fn() },
          { label: 'Cancel', autoFocus: true, testId: 'confirm-cancel', onClick: vi.fn() },
        ]}
      />,
    );
    expect(screen.getByTestId('confirm-cancel')).toHaveFocus();
  });

  it('Escape calls onEscape', () => {
    const onEscape = vi.fn();
    render(
      <ConfirmDialog
        title="Large selection"
        message="Continue?"
        onEscape={onEscape}
        buttons={[{ label: 'Cancel', autoFocus: true, testId: 'confirm-cancel', onClick: vi.fn() }]}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('confirm-dialog'), { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('Tab from the last button wraps focus back to the first button', () => {
    render(
      <ConfirmDialog
        title="Large selection"
        message="Continue?"
        onEscape={vi.fn()}
        buttons={[
          { label: 'Continue', testId: 'confirm-continue', onClick: vi.fn() },
          { label: 'Cancel', autoFocus: true, testId: 'confirm-cancel', onClick: vi.fn() },
        ]}
      />,
    );
    screen.getByTestId('confirm-cancel').focus();
    fireEvent.keyDown(screen.getByTestId('confirm-dialog'), { key: 'Tab' });
    expect(screen.getByTestId('confirm-continue')).toHaveFocus();
  });
});
