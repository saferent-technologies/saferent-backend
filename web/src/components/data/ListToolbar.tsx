import { Search, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/utils/cn";
import type { Option } from "@/components/ui/Field";

export interface FilterDef {
  name: string;
  label: string;
  options: Option[];
}

/** Search box (debounced) + filter dropdowns. State lives in the URL via useListParams. */
export function ListToolbar({
  search,
  onSearch,
  placeholder = "Search…",
  filters = [],
  values,
  onFilter,
  actions,
}: {
  search?: string;
  onSearch?: (q: string) => void;
  placeholder?: string;
  filters?: FilterDef[];
  values?: Record<string, string>;
  onFilter?: (name: string, value: string) => void;
  actions?: ReactNode;
}) {
  const [text, setText] = useState(search ?? "");
  useEffect(() => setText(search ?? ""), [search]);
  useEffect(() => {
    if (!onSearch || text === (search ?? "")) return;
    const id = window.setTimeout(() => onSearch(text.trim()), 350);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
      {onSearch && (
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            aria-label="Search"
            className="h-11 w-full rounded-control border border-line bg-surface pl-10 pr-10 text-base focus:border-brand focus:shadow-focus focus:outline-none sm:text-sm"
          />
          {text && (
            <button type="button" aria-label="Clear search" onClick={() => setText("")} className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:bg-subtle">
              <X className="size-4" />
            </button>
          )}
        </div>
      )}
      {(filters.length > 0 || actions) && (
        <div className="flex flex-wrap items-center gap-2">
          {filters.map((f) => (
            <select
              key={f.name}
              aria-label={f.label}
              value={values?.[f.name] ?? ""}
              onChange={(e) => onFilter?.(f.name, e.target.value)}
              className={cn("h-11 min-w-0 flex-1 cursor-pointer rounded-control border border-line bg-surface px-3 text-sm focus:border-brand focus:outline-none sm:flex-none", values?.[f.name] && "border-brand-light bg-brand-bg")}
            >
              <option value="">{f.label}: All</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ))}
          {actions}
        </div>
      )}
    </div>
  );
}
