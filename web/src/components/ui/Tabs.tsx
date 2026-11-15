import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@/utils/cn";

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

/**
 * Segmented tab switcher with proper ARIA roles and arrow-key support.
 * layout "equal" (default): one row of equal-width tabs — for a few short labels.
 * layout "wrap": tabs size to their full label and wrap onto more rows — for many tabs (never truncated).
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  idPrefix,
  className,
  layout = "equal",
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  idPrefix: string;
  className?: string;
  layout?: "equal" | "wrap";
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const index = items.findIndex((i) => i.value === value);
    const next = items[(index + (event.key === "ArrowRight" ? 1 : items.length - 1)) % items.length];
    onChange(next.value);
    document.getElementById(`${idPrefix}-tab-${next.value}`)?.focus();
  };

  return (
    <div
      role="tablist"
      onKeyDown={onKeyDown}
      className={cn(layout === "wrap" ? "flex flex-wrap gap-1 rounded-control bg-subtle p-1" : "grid gap-1 rounded-control bg-subtle p-1", className)}
      style={layout === "wrap" ? undefined : { gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            id={`${idPrefix}-tab-${item.value}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`${idPrefix}-panel-${item.value}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            className={cn(
              "flex min-h-11 items-center justify-center gap-2 rounded-[0.6rem] text-sm font-semibold transition-all",
              layout === "wrap" ? "whitespace-nowrap px-4" : "px-2",
              active ? "bg-surface text-brand-dark shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            {item.icon}
            <span className={layout === "wrap" ? undefined : "truncate"}>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
