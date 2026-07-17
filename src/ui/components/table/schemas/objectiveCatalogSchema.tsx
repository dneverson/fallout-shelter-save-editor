import type { ObjectiveDef } from '../../../../domain/gamedata/schemas.ts';
import {
  formatObjectiveDescription,
  objectiveGoal,
  objectiveModeLabel,
  REWARD_LABEL,
} from '../../../../domain/quests/objectiveDisplay.ts';
import { inSelectedSet, nameCell } from '../columnKit.tsx';
import type { TableSchema } from '../tableSchema.ts';

// Source-of-truth schema for the daily-OBJECTIVE catalog (the 530 definitions from
// objectives.json). Rendered by the objective replace picker; any future objective browser
// reuses this schema and picks a preset. Objectives have no item sprite, so there is no
// pinned icon column - every column is hideable.

export function objectiveCatalogSchema(): TableSchema<ObjectiveDef> {
  return {
    name: 'objectiveCatalog',
    hideable: [
      { id: 'objective', label: 'Objective' },
      { id: 'tier', label: 'Tier' },
      { id: 'goal', label: 'Goal' },
      { id: 'reward', label: 'Reward' },
      { id: 'rewardAmount', label: 'Reward amount' },
      { id: 'perLevel', label: 'Reward / level' },
      { id: 'mode', label: 'Mode' },
      { id: 'id', label: 'Objective id' },
    ],
    columns: [
      {
        id: 'objective',
        accessorFn: (o) => formatObjectiveDescription(o),
        header: 'Objective',
        cell: ({ getValue }) => nameCell(getValue<string>()),
        size: 280,
        filterFn: 'includesString',
        meta: { filterVariant: 'text', headerLabel: 'Objective' },
      },
      {
        id: 'tier',
        accessorFn: (o) => o.m_level ?? 0,
        header: 'Tier',
        cell: ({ getValue }) => {
          const tier = getValue<number>();
          return tier > 0 ? tier : '-';
        },
        size: 80,
        filterFn: inSelectedSet<ObjectiveDef>(),
        meta: { filterVariant: 'select', headerLabel: 'Tier' },
      },
      {
        // Base (level-0) goal amount, e.g. the 200 in "Collect 200 Food". A few purely
        // descriptive objectives have none; they sort as 0 and render "-".
        id: 'goal',
        accessorFn: (o) => objectiveGoal(o) ?? 0,
        header: 'Goal',
        cell: ({ row }) => objectiveGoal(row.original) ?? '-',
        size: 90,
        filterFn: 'inNumberRange',
        meta: { filterVariant: 'range', headerLabel: 'Goal' },
      },
      {
        id: 'reward',
        accessorFn: (o) => REWARD_LABEL[o.m_baseRewardType ?? 0] ?? 'Other',
        header: 'Reward',
        size: 130,
        filterFn: inSelectedSet<ObjectiveDef>(),
        meta: { filterVariant: 'select', headerLabel: 'Reward' },
      },
      {
        id: 'rewardAmount',
        accessorFn: (o) => o.m_baseRewardAmount ?? 0,
        header: 'Amount',
        size: 90,
        filterFn: 'inNumberRange',
        meta: { filterVariant: 'range', headerLabel: 'Reward amount' },
      },
      {
        // Extra reward per slot incLevel (`m_rewardIncrement`).
        id: 'perLevel',
        accessorFn: (o) => o.m_rewardIncrement ?? 0,
        header: '/ level',
        size: 90,
        filterFn: 'inNumberRange',
        meta: { filterVariant: 'range', headerLabel: 'Reward / level' },
      },
      {
        id: 'mode',
        accessorFn: (o) => objectiveModeLabel(o),
        header: 'Mode',
        size: 100,
        filterFn: inSelectedSet<ObjectiveDef>(),
        meta: { filterVariant: 'select', headerLabel: 'Mode' },
      },
      {
        id: 'id',
        accessorFn: (o) => o.m_objectiveID,
        header: 'Id',
        cell: ({ getValue }) => nameCell(getValue<string>()),
        size: 150,
        filterFn: 'includesString',
        meta: { filterVariant: 'text', headerLabel: 'Objective id' },
      },
    ],
  };
}

/** Hideable columns shown by default in the replace picker (increment + raw id stay a toggle away). */
export const OBJECTIVE_PICKER_PRESET = [
  'objective',
  'tier',
  'goal',
  'reward',
  'rewardAmount',
  'mode',
] as const;
