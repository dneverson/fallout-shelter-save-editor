import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ObjectivePickerDialog } from '../../src/ui/components/quests/ObjectivePickerDialog.tsx';
import type { ObjectiveDef } from '../../src/domain/gamedata/schemas.ts';

// jsdom has no layout, so the DataTable virtualizer renders 0 rows; pass
// virtualized={false} and assert on the rendered content (the DataTable gotcha).

const objective = (id: string, level: number, description: string, food: number): ObjectiveDef =>
  ({
    m_objectiveID: id,
    m_level: level,
    m_baseRewardType: 0,
    m_baseRewardAmount: 50 * level,
    m_rewardIncrement: 10,
    m_isNormalMode: 1,
    m_isSurvivalMode: 1,
    requirements: [{ m_requirementID: 'r1', m_baseGoalResources: { m_food: food } }],
    assignmentRequisites: [],
    description,
  }) as ObjectiveDef;

const OBJECTIVES: ObjectiveDef[] = [
  objective('Food1', 1, 'Collect {0} Food', 200),
  objective('Water2', 2, 'Collect {0} Water', 300),
];

function renderDialog() {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <ObjectivePickerDialog
      virtualized={false}
      objectives={OBJECTIVES}
      currentId="Food1"
      onPick={onPick}
      onClose={onClose}
    />,
  );
  return { onPick, onClose };
}

describe('ObjectivePickerDialog', () => {
  it('renders the catalog rows and badges the current one', () => {
    renderDialog();
    expect(screen.getByText('Collect 200 Food')).toBeInTheDocument();
    expect(screen.getByText('Collect 300 Water')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('picks the clicked row', async () => {
    const user = userEvent.setup();
    const { onPick } = renderDialog();
    await user.click(screen.getByText('Collect 300 Water'));
    expect(onPick).toHaveBeenCalledWith('Water2');
  });

  it('filters rows via the global search', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByRole('searchbox', { name: 'Search objectives' }), 'Water');
    expect(screen.queryByText('Collect 200 Food')).not.toBeInTheDocument();
    expect(screen.getByText('Collect 300 Water')).toBeInTheDocument();
  });
});
