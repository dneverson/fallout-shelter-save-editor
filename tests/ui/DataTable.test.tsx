import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '../../src/ui/components/DataTable.tsx';

interface Row {
  id: number;
  name: string;
  level: number;
}

const DATA: Row[] = [
  { id: 1, name: 'Charlie', level: 3 },
  { id: 2, name: 'Alice', level: 9 },
  { id: 3, name: 'Bob', level: 1 },
];

const COLUMNS: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'level', header: 'Level' },
];

const bodyRows = (): HTMLElement[] => {
  const groups = screen.getAllByRole('rowgroup');
  // groups[0] is the header rowgroup; groups[1] is the body.
  return within(groups[1]).getAllByRole('row');
};

const rowNames = (): string[] =>
  bodyRows().map((r) => within(r).getAllByRole('cell')[0].textContent ?? '');

describe('DataTable', () => {
  it('renders a row per datum with the projected cell values', () => {
    render(
      <DataTable
        data={DATA}
        columns={COLUMNS}
        getRowId={(r) => String(r.id)}
        virtualized={false}
      />,
    );
    expect(bodyRows()).toHaveLength(3);
    expect(rowNames()).toEqual(['Charlie', 'Alice', 'Bob']);
  });

  it('sorts ascending then descending when a sortable header is clicked', async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        data={DATA}
        columns={COLUMNS}
        getRowId={(r) => String(r.id)}
        virtualized={false}
      />,
    );

    await user.click(screen.getByRole('button', { name: /name/i }));
    expect(rowNames()).toEqual(['Alice', 'Bob', 'Charlie']);

    await user.click(screen.getByRole('button', { name: /name/i }));
    expect(rowNames()).toEqual(['Charlie', 'Bob', 'Alice']);
  });

  it('filters via the global search box', async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        data={DATA}
        columns={COLUMNS}
        getRowId={(r) => String(r.id)}
        enableGlobalFilter
        virtualized={false}
      />,
    );

    await user.type(screen.getByRole('searchbox', { name: /search/i }), 'ali');
    expect(rowNames()).toEqual(['Alice']);
  });

  it('renders the empty state when there are no rows', () => {
    render(<DataTable data={[]} columns={COLUMNS} emptyState="Nobody here" />);
    expect(screen.getByText('Nobody here')).toBeInTheDocument();
  });

  it('applies compact cell padding', () => {
    render(
      <DataTable
        data={DATA}
        columns={COLUMNS}
        getRowId={(r) => String(r.id)}
        virtualized={false}
      />,
    );
    const cell = within(screen.getAllByRole('rowgroup')[1]).getAllByRole('cell')[0];
    expect(cell.className).toContain('px-2 py-1');
  });

  it('invokes onRowClick with the clicked datum', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(
      <DataTable
        data={DATA}
        columns={COLUMNS}
        getRowId={(r) => String(r.id)}
        virtualized={false}
        onRowClick={onRowClick}
      />,
    );

    await user.click(within(bodyRows()[0]).getAllByRole('cell')[0]);
    expect(onRowClick).toHaveBeenCalledWith(DATA[0]);
  });

  it('reports selection changes through the controlled callback', async () => {
    const user = userEvent.setup();
    const onRowSelectionChange = vi.fn();
    const selectColumn: ColumnDef<Row> = {
      id: 'select',
      header: '',
      cell: ({ row }) => (
        <input
          type="checkbox"
          aria-label={`select ${row.original.name}`}
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
        />
      ),
    };
    render(
      <DataTable
        data={DATA}
        columns={[selectColumn, ...COLUMNS]}
        getRowId={(r) => String(r.id)}
        virtualized={false}
        enableRowSelection
        onRowSelectionChange={onRowSelectionChange}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'select Alice' }));
    expect(onRowSelectionChange).toHaveBeenCalledWith({ '2': true });
  });

  it('highlights the active row and marks it aria-selected', () => {
    render(
      <DataTable
        data={DATA}
        columns={COLUMNS}
        getRowId={(r) => String(r.id)}
        virtualized={false}
        onRowClick={() => {}}
        activeRowId="2"
      />,
    );
    const [charlie, alice] = bodyRows();
    expect(alice).toHaveAttribute('aria-selected', 'true');
    expect(alice.className).toContain('ring-amber-500/40');
    expect(charlie).toHaveAttribute('aria-selected', 'false');
    expect(charlie.className).not.toContain('ring-amber-500/40');
  });

  it('activates a focused row with Enter and Space', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(
      <DataTable
        data={DATA}
        columns={COLUMNS}
        getRowId={(r) => String(r.id)}
        virtualized={false}
        onRowClick={onRowClick}
      />,
    );

    const firstRow = bodyRows()[0];
    expect(firstRow).toHaveAttribute('tabindex', '0');
    firstRow.focus();
    await user.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenCalledWith(DATA[0]);

    await user.keyboard(' ');
    expect(onRowClick).toHaveBeenCalledTimes(2);
  });

  it('uses a roving tabindex and moves focus with arrow / Home / End keys', async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        data={DATA}
        columns={COLUMNS}
        getRowId={(r) => String(r.id)}
        virtualized={false}
        onRowClick={() => {}}
      />,
    );
    let rows = bodyRows();
    // Only the entry row is tabbable; the rest are out of the tab order.
    expect(rows[0]).toHaveAttribute('tabindex', '0');
    expect(rows[1]).toHaveAttribute('tabindex', '-1');
    expect(rows[2]).toHaveAttribute('tabindex', '-1');

    rows[0].focus();
    await user.keyboard('{ArrowDown}');
    rows = bodyRows();
    expect(document.activeElement).toBe(rows[1]);
    expect(rows[1]).toHaveAttribute('tabindex', '0');
    expect(rows[0]).toHaveAttribute('tabindex', '-1');

    await user.keyboard('{End}');
    expect(document.activeElement).toBe(bodyRows()[2]);

    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(bodyRows()[0]);
  });

  it('highlights the clicked row even without an onRowClick handler', async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        data={DATA}
        columns={COLUMNS}
        getRowId={(r) => String(r.id)}
        virtualized={false}
      />,
    );
    // Every table is now navigable so the user can keep their place: the entry row is tabbable.
    expect(bodyRows()[0]).toHaveAttribute('tabindex', '0');
    // Clicking a row picks it (internal highlight) with no handler wired.
    await user.click(bodyRows()[1]);
    expect(bodyRows()[1]).toHaveAttribute('aria-selected', 'true');
    expect(bodyRows()[0]).toHaveAttribute('aria-selected', 'false');
  });

  it('reports a column width change from the keyboard resize handle', async () => {
    const user = userEvent.setup();
    const onColumnSizingChange = vi.fn();
    render(
      <DataTable
        data={DATA}
        columns={COLUMNS}
        getRowId={(r) => String(r.id)}
        virtualized={false}
        onColumnSizingChange={onColumnSizingChange}
      />,
    );
    const handle = screen.getByRole('separator', { name: /resize name column/i });
    handle.focus();
    await user.keyboard('{ArrowRight}');
    expect(onColumnSizingChange).toHaveBeenCalled();
    const sizing = onColumnSizingChange.mock.calls.at(-1)?.[0] as Record<string, number>;
    expect(sizing.name).toBeGreaterThan(150); // default 150 widened by the nudge
  });

  it('mounts in virtualized mode without crashing (default path)', () => {
    // jsdom has no layout, so the virtualizer can't measure scroll height - actual
    // virtualized row rendering is verified by Playwright e2e / manual testing.
    render(<DataTable data={DATA} columns={COLUMNS} getRowId={(r) => String(r.id)} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});
