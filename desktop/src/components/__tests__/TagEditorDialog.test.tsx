import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TagEditorDialog from '../TagEditorDialog';
import type { TagEntrySummary, GetTagFieldsResult, UpdateTagFieldResult } from '../../../electron/shared-types';

const FOCUSED_TAG: TagEntrySummary = {
  index: 5,
  tagId: 0xe1740005,
  primaryClassName: 'weapon',
  path: 'weapons\\assault rifle\\assault rifle',
  isExternal: false,
  estimatedSize: 6210,
};

const ALL_TAGS: TagEntrySummary[] = [
  FOCUSED_TAG,
  {
    index: 7,
    tagId: 0xe1740007,
    primaryClassName: 'projectile',
    path: 'weapons\\assault rifle\\bullet',
    isExternal: false,
    estimatedSize: 1200,
  },
];

// Mirrors a realistic weapon root struct: value fields plus one dependency
// (hidden by the panel's kind === 'dependency' filter) and one unsupported
// composite (rendered as "Unsupported value shape").
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
      {
        name: 'model',
        kind: 'dependency',
        type: 'TagReference',
        offset: 8,
        size: 16,
        value: 0xe1740001,
        dependencyClasses: ['model', 'gbxmodel'],
        dependencyTarget: {
          tagId: 0xe1740001,
          path: 'weapons\\assault rifle\\assault rifle_model',
          group: 'gbxmodel',
        },
      },
      {
        name: 'triggers',
        kind: 'composite',
        type: 'Triggers',
        offset: 256,
        size: 128,
        value: { count: 2, entries: [] },
      },
    ],
  },
};

/**
 * Alternate root struct for the reflexive-block tests: the same `autoaim angle` field plus a
 * `magazines` TagReflexive (readOnly header + one decoded child element whose own fields include
 * an editable number and a dependency, which the panel must hide).
 */
const REFLEXIVE_FIELDS_RESULT: GetTagFieldsResult = {
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
      {
        name: 'magazines',
        kind: 'reflexive',
        type: 'TagReflexive',
        offset: 512,
        size: 12,
        value: { count: 1, pointerLow: 1000 },
        readOnly: true,
        reflexiveStruct: 'WeaponMagazines',
        reflexiveCount: 1,
        children: [
          {
            structName: 'WeaponMagazines',
            structBase: 1000,
            fields: [
              {
                name: 'rounds recharged',
                kind: 'number',
                type: 'int16',
                offset: 1004,
                size: 2,
                value: 10,
              },
              {
                name: 'magazine equipment',
                kind: 'dependency',
                type: 'TagDependency',
                offset: 1016,
                size: 16,
                value: 0xffffffff,
              },
            ],
          },
        ],
      },
    ],
  },
};

describe('TagEditorDialog', () => {
  beforeEach(() => {
    window.opence = {
      getTagFields: vi.fn().mockResolvedValue(MOCK_FIELDS_RESULT),
      updateTagField: vi.fn().mockResolvedValue({
        ok: true,
        fieldName: 'autoaim angle',
        newValue: 0.25,
        map: { filePath: 'test.map', modified: true } as any,
      } satisfies UpdateTagFieldResult),
      addReflexiveChunk: vi.fn().mockResolvedValue({
        ok: true,
        tagIndex: 5,
        reflexiveFieldPath: 'magazines',
        newElementIndex: 1,
        newCount: 2,
        map: { filePath: 'test.map', modified: true } as any,
      }),
    } as any;
  });

  it('renders the tag editor dialog with the focused tag class and path in the header', async () => {
    render(<TagEditorDialog tag={FOCUSED_TAG} allTags={ALL_TAGS} onClose={() => {}} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Tag Editor')).toBeInTheDocument();
    });
    expect(screen.getByText('weapon')).toBeInTheDocument();
    expect(screen.getByText('weapons\\assault rifle\\assault rifle')).toBeInTheDocument();
    expect(screen.getByTestId('tag-editor-close')).toBeInTheDocument();
  });

  it('hides dependency fields and shows unsupported value shape for composites', async () => {
    render(<TagEditorDialog tag={FOCUSED_TAG} allTags={ALL_TAGS} onClose={() => {}} />);

    await waitFor(() => {
      // The number field loads inside the panel.
      expect(screen.getByTestId('field-input-autoaim angle')).toBeInTheDocument();
    });

    // Dependency fields are filtered out of the Tag Editor panel entirely.
    expect(screen.queryByTestId('field-dependency-model')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('model')).not.toBeInTheDocument();

    // Composite fields render but are not editable.
    expect(screen.getByText('Unsupported value shape')).toBeInTheDocument();
  });

  it('edits a numeric field inside the dialog', async () => {
    render(<TagEditorDialog tag={FOCUSED_TAG} allTags={ALL_TAGS} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('field-input-autoaim angle')).toBeInTheDocument();
    });

    const input = screen.getByTestId('field-input-autoaim angle');
    await userEvent.clear(input);
    await userEvent.type(input, '0.25{enter}');

    expect(window.opence.updateTagField).toHaveBeenCalledWith(5, 'autoaim angle', 0.25);
  });

  it('closes when the Escape key is pressed', async () => {
    const onClose = vi.fn();
    render(<TagEditorDialog tag={FOCUSED_TAG} allTags={ALL_TAGS} onClose={onClose} />);

    const dialog = screen.getByRole('dialog');
    await userEvent.keyboard('[Escape]');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the header close button is clicked', async () => {
    const onClose = vi.fn();
    render(<TagEditorDialog tag={FOCUSED_TAG} allTags={ALL_TAGS} onClose={onClose} />);

    await userEvent.click(screen.getByTestId('tag-editor-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  const renderWithReflexive = () => {
    (window.opence.getTagFields as any).mockResolvedValue(REFLEXIVE_FIELDS_RESULT);
    return render(<TagEditorDialog tag={FOCUSED_TAG} allTags={ALL_TAGS} onClose={() => {}} />);
  };

  it('renders and expands a TagReflexive block with editable child fields', async () => {
    renderWithReflexive();

    await waitFor(() => {
      expect(screen.getByTestId('reflexive-toggle-magazines')).toBeInTheDocument();
    });

    // Collapsed by default: the nested number input is hidden.
    expect(screen.queryByTestId('field-input-magazines[0].rounds recharged')).not.toBeInTheDocument();

    // The toggle bar shows the element count and struct name.
    expect(screen.getByText('1 element(s) — WeaponMagazines')).toBeInTheDocument();
    expect(screen.getByText('Edit Block ▼')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('reflexive-toggle-magazines'));

    // Expanded: the element container, its header, and the nested number field become visible.
    expect(screen.getByTestId('reflexive-element-magazines[0]')).toBeInTheDocument();
    expect(screen.getByText('magazines[0]')).toBeInTheDocument();
    expect(screen.getByTestId('field-input-magazines[0].rounds recharged')).toBeInTheDocument();
    expect(screen.getByText('Hide Block ▲')).toBeInTheDocument();

    // Dependency fields inside a reflexive element are not rendered at all.
    expect(screen.queryByTestId('field-dependency-magazines[0].magazine equipment')).not.toBeInTheDocument();
  });

  it('edits a nested reflexive field via its dotted path', async () => {
    renderWithReflexive();

    await waitFor(() => {
      expect(screen.getByTestId('reflexive-toggle-magazines')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('reflexive-toggle-magazines'));
    await waitFor(() => {
      expect(screen.getByTestId('field-input-magazines[0].rounds recharged')).toBeInTheDocument();
    });

    const input = screen.getByTestId('field-input-magazines[0].rounds recharged');
    await userEvent.clear(input);
    await userEvent.type(input, '25{enter}');

    expect(window.opence.updateTagField).toHaveBeenCalledWith(5, 'magazines[0].rounds recharged', 25);
  });

  it('displays unit badge and tooltip for engineering fields', async () => {
    render(<TagEditorDialog tag={FOCUSED_TAG} allTags={ALL_TAGS} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('field-card-autoaim angle')).toBeInTheDocument();
    });

    // Degree badge rendered next to Angle
    expect(screen.getByText('°')).toBeInTheDocument();
    expect(screen.getByTitle('Angle in degrees (°)')).toBeInTheDocument();
  });

  it('supports adding and cloning reflexive chunks via UI buttons', async () => {
    renderWithReflexive();

    await waitFor(() => {
      expect(screen.getByTestId('reflexive-add-magazines')).toBeInTheDocument();
    });

    // 1. Click "+ Add Element" on block header (which also auto-expands the block)
    await userEvent.click(screen.getByTestId('reflexive-add-magazines'));
    expect(window.opence.addReflexiveChunk).toHaveBeenCalledWith(5, 'magazines', -1);

    // 2. The block is auto-expanded, so element 0 and its "Clone" button are visible
    await waitFor(() => {
      expect(screen.getByTestId('reflexive-clone-magazines[0]')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId('reflexive-clone-magazines[0]'));
    expect(window.opence.addReflexiveChunk).toHaveBeenCalledWith(5, 'magazines', 0);
  });
});

