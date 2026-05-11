import { useState, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
} from '@tanstack/react-table';

export default function SortableTable({ columns, data, emptyText = 'Sin datos' }) {
  const [sorting, setSorting] = useState([]);

  const tableColumns = useMemo(() => columns.map(col => ({
    accessorKey: col.key,
    header: col.label,
    cell: info => col.render ? col.render(info.getValue(), info.row.original) : (info.getValue() ?? ''),
  })), [columns]);

  const table = useReactTable({
    data: data || [],
    columns: tableColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (!data || data.length === 0) {
    return <div className="history-empty">{emptyText}</div>;
  }

  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
        <thead>
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <th key={header.id}
                  onClick={header.column.getToggleSortingHandler()}
                  style={{
                    textAlign: 'left', padding: '0.6rem 0.5rem',
                    borderBottom: '1px solid var(--surface2)',
                    color: 'var(--text-dim)', fontWeight: 500,
                    fontSize: '0.75rem', textTransform: 'uppercase',
                    cursor: header.column.getCanSort() ? 'pointer' : 'default',
                    userSelect: 'none', whiteSpace: 'nowrap',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {{ asc: ' ↑', desc: ' ↓' }[header.column.getIsSorted()] ?? ''}
                  </div>
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map(row => (
            <tr key={row.id} className="history-table-row"
              style={{ borderBottom: '1px solid rgba(51,65,85,0.5)' }}>
              {row.getVisibleCells().map(cell => (
                <td key={cell.id} style={{ padding: '0.6rem 0.5rem' }}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
