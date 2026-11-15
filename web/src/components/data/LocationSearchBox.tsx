import { Building2, Map, MapPin, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { request } from "@/services/api";
import { cn } from "@/utils/cn";

export interface LocationSuggestion {
  kind: "CITY" | "LOCALITY" | "STATE";
  name: string;
  city: string | null;
  state: string | null;
  label: string;
  listingCount: number;
  filters: { city?: string | null; locality?: string; state?: string };
}

const ICON = { CITY: Building2, LOCALITY: MapPin, STATE: Map } as const;
const KIND_LABEL = { CITY: "City", LOCALITY: "Area", STATE: "State" } as const;

/**
 * Search box with place suggestions from property addresses: type "h" → Hyderabad, Hanumakonda …
 * Picking a suggestion calls onSelect (filter by that place); Enter without picking calls onSubmit (free-text search).
 */
export function LocationSearchBox({
  isPublic,
  value,
  onSelect,
  onSubmit,
  placeholder = "Search city, area, PIN or SafeRent ID",
  className,
  inputClassName,
}: {
  isPublic: boolean;
  value: string;
  onSelect: (s: LocationSuggestion) => void;
  onSubmit: (text: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}) {
  const [text, setText] = useState(value);
  const [items, setItems] = useState<LocationSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setText(value), [value]);

  // Debounced suggestions.
  useEffect(() => {
    const q = text.trim();
    if (!q || q === value) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(() => {
      request<{ items: LocationSuggestion[] }>(isPublic ? "/public/locations" : "/browse/locations", { auth: !isPublic, query: { q, limit: 8 } })
        .then((r) => {
          if (cancelled) return;
          setItems(r.items);
          setActive(-1);
          setOpen(true);
        })
        .catch(() => !cancelled && setItems([]));
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [text, isPublic, value]);

  // Close when clicking outside.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const pick = (s: LocationSuggestion) => {
    setText(s.label);
    setOpen(false);
    setItems([]);
    onSelect(s);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && items.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp" && items.length) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && items[active]) {
        e.preventDefault();
        pick(items[active]);
      } else if (text.trim() !== value.trim()) {
        e.preventDefault();
        setOpen(false);
        onSubmit(text.trim());
      }
      // Unchanged text: let a surrounding form submit as usual.
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showList = open && items.length > 0;

  return (
    <div ref={box} className={cn("relative min-w-0 flex-1", className)}>
      <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <input
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-label="Search location"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (!e.target.value) onSubmit("");
        }}
        onFocus={() => items.length && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={cn("h-11 w-full rounded-control border border-line bg-surface pl-10 pr-10 text-base focus:border-brand focus:shadow-focus focus:outline-none sm:text-sm", inputClassName)}
      />
      {text && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setText("");
            setItems([]);
            onSubmit("");
          }}
          className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:bg-subtle"
        >
          <X className="size-4" />
        </button>
      )}
      {showList && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-control border border-line bg-surface py-1 shadow-card">
          {items.map((s, i) => {
            const Icon = ICON[s.kind];
            return (
              <li
                key={`${s.kind}-${s.label}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn("flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm", i === active && "bg-subtle")}
              >
                <Icon className="size-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{s.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {KIND_LABEL[s.kind]}
                    {s.kind === "LOCALITY" && s.city ? ` · ${s.city}` : ""}
                    {s.state && s.kind !== "STATE" ? `, ${s.state}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted">{s.listingCount} {s.listingCount === 1 ? "home" : "homes"}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
