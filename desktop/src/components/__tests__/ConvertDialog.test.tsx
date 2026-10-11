import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ConvertDialog from '../ConvertDialog';
import type { OpenceApi, ConvertMapResult, ConvertPreflightResult, RetailConversionReport } from '../../../electron/shared-types';
import { buildMockConvertReport, buildMockRepairConvertReport } from '../../test-fixtures/dependency-fixtures';

function install(preflight: ConvertPreflightResult | null, convert: ConvertMapResult = { ok: false, code: 'CANCELLED', message: 'cancelled' }) {
  const convertPreflight = vi.fn(async () => preflight);
  const convertMap = vi.fn(async () => convert);
  window.opence = { convertPreflight, convertMap } as unknown as OpenceApi;
  return { convertPreflight, convertMap };
}

const ok = (report: RetailConversionReport): ConvertPreflightResult => ({ ok: true, sourceFileName: 'heh_2.map', report });

describe('ConvertDialog', () => {
  it('shows the checklist and the old and new CRC32; Convert passes no acknowledgement when none is needed', async () => {
    const { convertPreflight, convertMap } = install(ok(buildMockConvertReport(false)));
    render(<ConvertDialog source="open" onClose={vi.fn()} log={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('convert-dialog-summary')).toBeTruthy());
    expect(convertPreflight).toHaveBeenCalledWith('open');
    expect(screen.getByTestId('convert-dialog-crc').textContent).toMatch(/0x00000000 → 0xD1C331E9/);
    expect(screen.getByTestId('convert-check-referenceIdentity').getAttribute('data-status')).toBe('warn');
    expect(screen.getByTestId('convert-check-referenceIdentity').textContent).toMatch(/0xEADF0969/);
    expect(screen.queryByTestId('convert-dialog-ack')).toBeNull();
    const button = screen.getByTestId('convert-dialog-convert') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(convertMap).toHaveBeenCalledWith(false, {}));
  });

  it('script warning: Convert stays disabled until the acknowledgement box is ticked', async () => {
    const { convertMap } = install(ok(buildMockConvertReport(true)));
    render(<ConvertDialog source="open" onClose={vi.fn()} log={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('convert-dialog-ack')).toBeTruthy());
    const button = screen.getByTestId('convert-dialog-convert') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(convertMap).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('convert-dialog-ack-checkbox'));
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(convertMap).toHaveBeenCalledWith(true, {}));
  });

  it('a refused map shows why and cannot be converted', async () => {
    const report: RetailConversionReport = {
      ...buildMockConvertReport(false),
      canConvert: false,
      checks: [{ id: 'layout', label: 'Retail-layout map (cache version 7)', status: 'refuse', message: 'This map is already a Custom Edition map (version 609). There is nothing to convert.', details: [], requiresAcknowledgement: false }],
    };
    const { convertMap } = install(ok(report));
    render(<ConvertDialog source="pick" onClose={vi.fn()} log={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('convert-dialog-refused')).toBeTruthy());
    expect(screen.getByTestId('convert-check-layout').textContent).toMatch(/already a Custom Edition map/);
    expect((screen.getByTestId('convert-dialog-convert') as HTMLButtonElement).disabled).toBe(true);
    expect(convertMap).not.toHaveBeenCalled();
  });

  it('a required repair is a pre-ticked row; unticking it turns Convert off and says why; Convert passes the ticks', async () => {
    const { convertMap } = install(ok(buildMockRepairConvertReport()));
    render(<ConvertDialog source="open" onClose={vi.fn()} log={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('convert-check-repairScriptSyntaxData')).toBeTruthy());
    const box = screen.getByTestId('convert-repair-scriptSyntaxData') as HTMLInputElement;
    const button = screen.getByTestId('convert-dialog-convert') as HTMLButtonElement;
    expect(box.checked).toBe(true);
    expect(screen.getByTestId('convert-check-repairScriptSyntaxData').textContent).toMatch(/\(required\).*OpenCE refuses this map/);
    expect(button.disabled).toBe(false);
    expect(screen.queryByTestId('convert-dialog-repair-off')).toBeNull();

    fireEvent.click(box);
    expect(box.checked).toBe(false);
    expect(button.disabled).toBe(true);
    expect(screen.getByTestId('convert-dialog-repair-off').textContent).toMatch(/OpenCE refuses this map without "Repair: move the script data to its own block"/);
    fireEvent.click(button);
    expect(convertMap).not.toHaveBeenCalled();

    fireEvent.click(box);
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(convertMap).toHaveBeenCalledWith(false, { scriptSyntaxData: true }));
  });

  it('an optional repair starts unticked and never blocks Convert', async () => {
    const { convertMap } = install(ok(buildMockRepairConvertReport(false)));
    render(<ConvertDialog source="open" onClose={vi.fn()} log={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('convert-repair-scriptSyntaxData')).toBeTruthy());
    expect((screen.getByTestId('convert-repair-scriptSyntaxData') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId('convert-check-repairScriptSyntaxData').textContent).toMatch(/\(optional\)/);
    const button = screen.getByTestId('convert-dialog-convert') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(convertMap).toHaveBeenCalledWith(false, { scriptSyntaxData: false }));
  });

  it('closes when the file dialog is cancelled (pre-flight returns null)', async () => {
    install(null);
    const onClose = vi.fn();
    render(<ConvertDialog source="pick" onClose={onClose} log={vi.fn()} />);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('closes after a successful convert; shows a refusal from main and stays open', async () => {
    const onClose = vi.fn();
    install(ok(buildMockConvertReport(false)), { ok: false, code: 'REFUSED_SOURCE_PATH', message: 'The converted map cannot overwrite the map it is converted from.' });
    const { unmount } = render(<ConvertDialog source="open" onClose={onClose} log={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('convert-dialog-convert')).toBeTruthy());
    fireEvent.click(screen.getByTestId('convert-dialog-convert'));
    await waitFor(() => expect(screen.getByTestId('convert-dialog-convert-error').textContent).toMatch(/cannot overwrite/));
    expect(onClose).not.toHaveBeenCalled();
    unmount();
  });
});
