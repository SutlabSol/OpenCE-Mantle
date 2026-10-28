import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ConvertDialog from '../ConvertDialog';
import type { OpenceApi, ConvertMapResult, ConvertPreflightResult, RetailConversionReport } from '../../../electron/shared-types';
import { buildMockAlignConvertReport, buildMockConvertReport, buildMockModelPartsConvertReport, buildMockRepairConvertReport } from '../../test-fixtures/dependency-fixtures';

const EXTERNAL_RESOURCE_REPORT: RetailConversionReport = {
  ...buildMockConvertReport(false),
  externalData: { bitmaps: { count: 811, bytes: 1_000 }, sounds: { count: 0, bytes: 0 } },
};

function install(preflight: ConvertPreflightResult | null, convert: ConvertMapResult = { ok: false, code: 'CANCELLED', message: 'cancelled' }) {
  const convertPreflight = vi.fn(async () => preflight);
  const convertMap = vi.fn(async () => convert);
  const pickConvertResource = vi.fn(async (kind: 'bitmaps' | 'sounds') => ({ path: `C:/mock/${kind}.map` }));
  window.opence = { convertPreflight, convertMap, pickConvertResource } as unknown as OpenceApi;
  return { convertPreflight, convertMap, pickConvertResource };
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
    await waitFor(() => expect(convertMap).lastCalledWith(false, {}, {}));
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
    await waitFor(() => expect(convertMap).lastCalledWith(true, {}, {}));
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

  it("a model that fails OpenCE's part check refuses the map, names the model, parts and bad indices; ticked repairs do not enable Convert", async () => {
    const { convertMap } = install(ok(buildMockModelPartsConvertReport()));
    render(<ConvertDialog source="open" onClose={vi.fn()} log={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('convert-dialog-refused')).toBeTruthy());
    const row = screen.getByTestId('convert-check-modelParts');
    expect(row.getAttribute('data-status')).toBe('refuse');
    expect(row.textContent).toMatch(/forerunner dark structure: geometry 0 part 0: 2 of 104 strip indices are past its 70 vertices \(value@position: 70@100, 71@102\)/);
    expect(row.textContent).toMatch(/geometry 1 part 0: 33 of 66 strip indices/);
    expect((screen.getByTestId('convert-repair-scriptSyntaxData') as HTMLInputElement).checked).toBe(true);
    const button = screen.getByTestId('convert-dialog-convert') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
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
    await waitFor(() => expect(convertMap).lastCalledWith(false, { alignTagData: true, scriptSyntaxData: true }, {}));
  });

  it('the tag data alignment is a required, pre-ticked repair row after the alignment check row; unticking it turns Convert off; Convert passes it', async () => {
    const { convertMap } = install(ok(buildMockAlignConvertReport()));
    render(<ConvertDialog source="open" onClose={vi.fn()} log={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('convert-check-repairAlignTagData')).toBeTruthy());
    const check = screen.getByTestId('convert-check-tagBlockAlignment');
    expect(check.getAttribute('data-status')).toBe('warn');
    expect(check.textContent).toMatch(/6,982 of 6,982 tag data blocks .* start 2 mod 4/);
    expect(check.textContent).toMatch(/path pointer 0x4BF3ED7B is outside the tag data/);
    const row = screen.getByTestId('convert-check-repairAlignTagData');
    expect(row.textContent).toMatch(/\(required\).*Adds 2 bytes/);
    expect(row.textContent).toMatch(/Inserts 2 zero byte\(s\) at 0x4046ED9E .* moves 11,443 pointers/);
    const box = screen.getByTestId('convert-repair-alignTagData') as HTMLInputElement;
    const button = screen.getByTestId('convert-dialog-convert') as HTMLButtonElement;
    expect(box.checked).toBe(true);
    expect(screen.queryByTestId('convert-repair-scriptSyntaxData')).toBeNull();
    fireEvent.click(box);
    expect(button.disabled).toBe(true);
    expect(screen.getByTestId('convert-dialog-repair-off').textContent).toMatch(/without "Repair: align the tag data"/);
    fireEvent.click(box);
    fireEvent.click(button);
    await waitFor(() => expect(convertMap).lastCalledWith(false, { alignTagData: true }, {}));
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
    await waitFor(() => expect(convertMap).lastCalledWith(false, { scriptSyntaxData: false }, {}));
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

  it('shows a resource picker when the report has external bitmap data', async () => {
    install(ok(EXTERNAL_RESOURCE_REPORT));
    render(<ConvertDialog source="open" onClose={vi.fn()} log={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('convert-dialog-resources')).toBeTruthy());
    expect(screen.queryByTestId('convert-pick-sounds')).toBeNull();
    const row = screen.getByTestId('convert-pick-bitmaps').parentElement!;
    expect(row.textContent).toMatch(/Source bitmaps\.map:/);
    expect(row.textContent).toMatch(/\(not selected\)/);
  });

  it('pick a bitmap file, re-run preflight, and forward the resource paths to convertMap', async () => {
    const { convertPreflight, convertMap, pickConvertResource } = install(ok(EXTERNAL_RESOURCE_REPORT));
    render(<ConvertDialog source="open" onClose={vi.fn()} log={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('convert-dialog-resources')).toBeTruthy());

    fireEvent.click(screen.getByTestId('convert-pick-bitmaps'));
    await waitFor(() => expect(pickConvertResource).toHaveBeenCalledWith('bitmaps'));
    await waitFor(() => expect(convertPreflight).toHaveBeenLastCalledWith('open', { bitmaps: 'C:/mock/bitmaps.map' }));

    const resourcesText = () => screen.getByTestId('convert-dialog-resources').textContent!;
    expect(resourcesText()).toMatch('C:/mock/bitmaps.map');
    expect(resourcesText()).not.toMatch('(not selected)');

    const button = screen.getByTestId('convert-dialog-convert') as HTMLButtonElement;
    fireEvent.click(button);
    await waitFor(() => expect(convertMap).toBeCalledTimes(1));
    expect((convertMap.mock.calls[0] as unknown[])[2]).toEqual({ bitmaps: 'C:/mock/bitmaps.map' });
  });
});
