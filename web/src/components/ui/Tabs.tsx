import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/utils/cn";

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

/**
 * Segmented tab switcher with proper ARIA roles and arrow-key support.
 * layout "equal" (default): one row; tabs share the width but always show their full label — when they
 *   don't fit, the row scrolls sideways (the selected tab is scrolled into view). Labels are never cut ("…").
 * layout "wrap": tabs size to their full label and wrap onto more rows.
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
  const scroller = useRef<HTMLDivElement>(null);
  // Keep the selected tab visible when the row scrolls.
  useEffect(() => {
    const el = document.getElementById(`${idPrefix}-tab-${value}`);
    const box = scroller.current;
    if (!el || !box || box.scrollWidth <= box.clientWidth) return;
    const left = el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2;
    box.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [value, idPrefix]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const index = items.findIndex((i) => i.value === value);
    const next = items[(index + (event.key === "ArrowRight" ? 1 : items.length - 1)) % items.length];
    onChange(next.value);
    document.getElementById(`${idPrefix}-tab-${next.value}`)?.focus();
  };

  const list = (
    <div
      role="tablist"
      onKeyDown={onKeyDown}
      className={cn(layout === "wrap" ? "flex flex-wrap gap-1 rounded-control bg-subtle p-1" : "grid gap-1 rounded-control bg-subtle p-1", layout === "wrap" ? className : undefined)}
      style={layout === "wrap" ? undefined : { gridTemplateColumns: `repeat(${items.length}, minmax(max-content, 1fr))` }}
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
              "whitespace-nowrap px-4",
              active ? "bg-surface text-brand-dark shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
  if (layout === "wrap") return list;
  return (
    <div ref={scroller} className={cn("overflow-x-auto overscroll-x-contain [scrollbar-width:thin]", className)}>
      {list}
    </div>
  );
}
