import { ArrowDown, ArrowUp } from 'lucide-react';
import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  width?: string;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  selectedKey?: string;
  sortState?: { key: string; asc: boolean };
  onSort?: (key: string) => void;
}

const alignMap: Record<string, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

const justifyMap: Record<string, string> = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyMessage = '暂无数据',
  onRowClick,
  selectedKey,
  sortState,
  onSort,
}: DataTableProps<T>) {
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
      <table role="table" className="w-full text-sm border-collapse">
        <thead>
          <tr
            role="row"
            className="glass-header text-slate-600 dark:text-slate-300 sticky top-0 z-10"
          >
            {columns.map((col) => {
              const isSorted = sortState?.key === col.key;
              const ariaSort = col.sortable
                ? isSorted
                  ? sortState.asc
                    ? 'ascending'
                    : 'descending'
                  : 'none'
                : undefined;

              const HeaderContent = (
                <>
                  <span>{col.header}</span>
                  {col.sortable && (
                    <span className="ml-1 inline-flex flex-col text-[0.65rem] leading-none text-slate-400">
                      <ArrowUp
                        size={9}
                        className={isSorted && sortState.asc ? 'text-teal-500' : ''}
                      />
                      <ArrowDown
                        size={9}
                        className={isSorted && !sortState.asc ? 'text-teal-500' : ''}
                      />
                    </span>
                  )}
                </>
              );

              return col.sortable && onSort ? (
                <th
                  key={col.key}
                  role="columnheader"
                  aria-sort={ariaSort}
                  onClick={() => onSort(col.key)}
                  className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider ${alignMap[col.align || 'left']} ${justifyMap[col.align || 'left']} inline-flex items-center gap-0.5 hover:text-teal-600 dark:hover:text-teal-400 transition-colors cursor-pointer`}
                  style={col.width ? { width: col.width } : undefined}
                >
                  {HeaderContent}
                </th>
              ) : (
                <th
                  key={col.key}
                  role="columnheader"
                  aria-sort={ariaSort}
                  className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider ${alignMap[col.align || 'left']}`}
                  style={col.width ? { width: col.width } : undefined}
                >
                  {HeaderContent}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="text-center py-10 text-slate-400 dark:text-slate-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const key = rowKey(row);
              const isSelected = key === selectedKey;
              return (
                <tr
                  key={key}
                  role="row"
                  onClick={() => onRowClick?.(row)}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (onRowClick && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      onRowClick(row);
                    }
                  }}
                  className={`border-b border-slate-100 dark:border-slate-800 last:border-b-0 transition-colors duration-150 even:bg-slate-50/60 dark:even:bg-slate-900/30 hover:bg-teal-50/40 dark:hover:bg-teal-900/15 ${
                    onRowClick ? 'cursor-pointer' : ''
                  } ${isSelected ? 'ring-2 ring-inset ring-teal-500/40 bg-teal-50/30 dark:bg-teal-900/10' : ''}`}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      role="cell"
                      className={`px-4 py-3 ${alignMap[col.align || 'left']}`}
                      style={col.width ? { width: col.width } : undefined}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
