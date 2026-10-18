import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PropertiesPalette from '../PropertiesPalette';
import TagFieldEditorPanel from '../TagFieldEditorPanel';
import type {
  TagEntrySummary,
  GetDependencySlotsResult,
  SetDependencySlotResult,
  GetTagFieldsResult,
  UpdateTagFieldResult,
} from '../../../electron/shared-types';

const SAMPLE_FOCUSED_TAG: TagEntrySummary = {
  index: 5,
  tagId: 0xe1740005,
  primaryClassName: 'weapon',
  path: 'weapons\\assault rifle\\assault rifle',
  isExternal: false,
  estimatedSize: 6210,
};

const SAMPLE_ALL_TAGS: TagEntrySummary[] = [
  SAMPLE_FOCUSED_TAG,
  {
    index: 7,
    tagId: 0xe1740007,
    primaryClassName: 'projectile',
    path: 'weapons\\assault rifle\\bullet',
    isExternal: false,
    estimatedSize: 1200,
  },
  {
    index: 12,
    tagId: 0xe174000c,
    primaryClassName: 'vehicle',
    path: 'vehicles\\warthog\\mp_warthog',
    isExternal: false,
    estimatedSize: 4500,
  },
];

const MOCK_SLOTS_RESULT: GetDependencySlotsResult = {
  ok: true,
  slots: [
    {
      fieldPath: 'model',
      fieldName: 'model',
      allowedClasses: ['gbxmodel'],
      currentTagId: 0xe1740001,
      currentPath: 'weapons\\assault rifle\\assault rifle',
      currentGroup: 'gbxmodel',
    },
    {
      fieldPath: 'material_effects',
      fieldName: 'material_effects',
      allowedClasses: ['material_effects'],
      currentTagId: 0xffffffff,
      currentPath: null,
      currentGroup: null,
    },
    {
      fieldPath: 'triggers[0].projectile',
      fieldName: 'projectile',
      allowedClasses: ['projectile', 'object'],
      currentTagId: 0xe1740007,
      currentPath: 'weapons\\assault rifle\\bullet',
      currentGroup: 'projectile',
    },
  ],
};

const MOCK_FIELDS_RESULT: GetTagFieldsResult = {
  ok: true,
  data: {
    tagIndex: 5,
    tagId: 0xe1740005,
    tagPath: 'weapons\\assault rifle\\assault rifle',
    group: 'weapon',
    structName: 'Weapon',
    fields: [
      {
        name: 'autoaim angle',
        kind: 'number',
        type: 'Angle',
        offset: 0,
        size: 4,
        value: 0.125,
      },
    ],
  },
};

describe('PropertiesPalette (Dependency Swapper)', () => {
  beforeEach(() => {
    window.opence = {
      getDependencySlots: vi.fn().mockResolvedValue(MOCK_SLOTS_RESULT),
      setDependencySlot: vi.fn().mockResolvedValue({
        ok: true,
        fieldPath: 'triggers[0].projectile',
        newTagId: 0xe174000c,
        map: { filePath: 'test.map', modified: true } as any,
      } satisfies SetDependencySlotResult),
      getTagFields: vi.fn().mockResolvedValue(MOCK_FIELDS_RESULT),
      updateTagField: vi.fn().mockResolvedValue({
        ok: true,
        fieldName: 'autoaim angle',
        newValue: 0.25,
        map: { filePath: 'test.map', modified: true } as any,
      } satisfies UpdateTagFieldResult),
    } as any;
  });

  it('renders empty message when no tag is focused', () => {
    render(<PropertiesPalette focusedTag={null} />);
    expect(screen.getByTestId('properties-palette-empty')).toBeInTheDocument();
  });

  it('renders overview properties for the focused tag', () => {
    render(<PropertiesPalette focusedTag={SAMPLE_FOCUSED_TAG} allTags={SAMPLE_ALL_TAGS} />);
    expect(screen.getByText('weapons\\assault rifle\\assault rifle')).toBeInTheDocument();
    expect(screen.getByText('weapon')).toBeInTheDocument();
    expect(screen.getByText('0xe1740005')).toBeInTheDocument();
  });

  it('switches to Dependency Swapper tab and lists slots including nested reflexives and Nulled Out slots', async () => {
    render(<PropertiesPalette focusedTag={SAMPLE_FOCUSED_TAG} allTags={SAMPLE_ALL_TAGS} />);

    await userEvent.click(screen.getByTestId('tab-properties-swapper'));

    expect(window.opence.getDependencySlots).toHaveBeenCalledWith(5);
    await waitFor(() => {
      expect(screen.getByTestId('swapper-slot-model')).toBeInTheDocument();
      expect(screen.getByTestId('swapper-slot-material_effects')).toBeInTheDocument();
      expect(screen.getByTestId('swapper-slot-triggers[0].projectile')).toBeInTheDocument();
    });

    expect(screen.getByTestId('swapper-slot-material_effects')).toHaveTextContent('Nulled Out');
    expect(screen.getByTestId('swapper-slot-model')).toHaveTextContent('mod2');
    expect(screen.getByTestId('swapper-slot-triggers[0].projectile')).toHaveTextContent('proj');
  });

  it('filters dependency slots when searching', async () => {
    render(<PropertiesPalette focusedTag={SAMPLE_FOCUSED_TAG} allTags={SAMPLE_ALL_TAGS} />);
    await userEvent.click(screen.getByTestId('tab-properties-swapper'));

    await waitFor(() => {
      expect(screen.getByTestId('swapper-slot-model')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('swapper-search-input');
    await userEvent.type(searchInput, 'projectile');

    expect(screen.getByTestId('swapper-slot-triggers[0].projectile')).toBeInTheDocument();
    expect(screen.queryByTestId('swapper-slot-model')).not.toBeInTheDocument();
  });

  it('swaps a projectile slot to a vehicle tag (any-class swap) and updates the row', async () => {
    render(<PropertiesPalette focusedTag={SAMPLE_FOCUSED_TAG} allTags={SAMPLE_ALL_TAGS} />);
    await userEvent.click(screen.getByTestId('tab-properties-swapper'));

    await waitFor(() => {
      expect(screen.getByTestId('swapper-slot-triggers[0].projectile')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId('swapper-slot-triggers[0].projectile'));

    const classSelect = screen.getByTestId('swapper-class-select');
    await userEvent.selectOptions(classSelect, 'vehicle');

    const tagSelect = screen.getByTestId('swapper-tag-select');
    expect(tagSelect).toHaveValue(String(0xe174000c));

    await userEvent.click(screen.getByTestId('swapper-apply-button'));

    expect(window.opence.setDependencySlot).toHaveBeenCalledWith(
      5,
      'triggers[0].projectile',
      0xe174000c,
    );

    await waitFor(() => {
      expect(screen.getByTestId('swapper-status')).toHaveTextContent(
        /Swapped "triggers\[0\]\.projectile" -> vehicles\\warthog\\mp_warthog/,
      );
      expect(screen.getByTestId('swapper-slot-triggers[0].projectile')).toHaveTextContent(
        'vehicles\\warthog\\mp_warthog',
      );
    });
  });
});

describe('TagFieldEditorPanel (preserved M7a editor)', () => {
  beforeEach(() => {
    window.opence = {
      getTagFields: vi.fn().mockResolvedValue(MOCK_FIELDS_RESULT),
      updateTagField: vi.fn().mockResolvedValue({
        ok: true,
        fieldName: 'autoaim angle',
        newValue: 0.25,
        map: { filePath: 'test.map', modified: true } as any,
      } satisfies UpdateTagFieldResult),
    } as any;
  });

  it('loads and updates numeric fields', async () => {
    render(<TagFieldEditorPanel focusedTag={SAMPLE_FOCUSED_TAG} allTags={SAMPLE_ALL_TAGS} />);

    await waitFor(() => {
      expect(screen.getByTestId('field-input-autoaim angle')).toBeInTheDocument();
    });

    const input = screen.getByTestId('field-input-autoaim angle');
    await userEvent.clear(input);
    await userEvent.type(input, '0.25{enter}');

    expect(window.opence.updateTagField).toHaveBeenCalledWith(5, 'autoaim angle', 0.25);
  });
});
