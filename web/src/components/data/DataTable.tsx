import { ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/utils/cn";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
  /** Hide on small screens (the mobile card shows `primary` + `secondary` instead). */
  hideOnMobile?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  loading?: boolean;
  error?: string | null;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: string;
  /** Mobile card layout (< 768px). */
  mobile?: (row: T) => ReactNode;
}

/**
 * Responsive data table: a real <table> on tablet/desktop, stacked cards on phones
 * (no horizontal scrolling).
 */
export function DataTable<T>({ columns, rows, loading, error, rowKey, onRowClick, empty = "Nothing here yet.", mobile }: DataTableProps<T>) {
  if (error) return <Alert kind="error">{error}</Alert>;
  if (loading && !rows) {
    return (
      <div className="card flex justify-center p-10">
        <Spinner className="text-brand" />
      </div>
    );
  }
  if (!rows || rows.length === 0) return <EmptyState text={empty} />;

  return (
    <div className={cn("relative", loading && "opacity-60")}>
      <div className="card hidden overflow-hidden md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-subtle/60 text-xs font-semibold uppercase tracking-wide text-muted">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn("px-4 py-3", c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn("align-middle", onRowClick && "cursor-pointer hover:bg-brand-bg/50")}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-4 py-3 text-ink", c.className)}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)}>
            <div
              role={onRowClick ? "button" : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (e) => e.key === "Enter" && onRowClick(row) : undefined}
              className={cn("card block p-4 text-sm", onRowClick && "active:bg-brand-bg/60")}
            >
              {mobile ? (
                mobile(row)
              ) : (
                <dl className="space-y-1.5">
                  {columns.map((c) => (
                    <div key={c.key} className="flex justify-between gap-3">
                      <dt className="shrink-0 text-muted">{c.header}</dt>
                      <dd className="min-w-0 text-right text-ink">{c.render(row)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EmptyState({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-bg text-brand">
        <Inbox className="size-6" />
      </span>
      <p className="text-sm text-muted">{text}</p>
      {action}
    </div>
  );
}

export function Pagination({ page, totalPages, total, onPage }: { page: number; totalPages: number; total: number; onPage: (page: number) => void }) {
  if (total === 0) return null;
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3 text-sm text-muted">
      <span>
        {total} result{total === 1 ? "" : "s"} · page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" leftIcon={<ChevronLeft className="size-4" />}>
          <span className="hidden sm:inline">Previous</span>
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </nav>
  );
}
