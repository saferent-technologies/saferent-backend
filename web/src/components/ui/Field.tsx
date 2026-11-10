import { ChevronDown } from "lucide-react";
import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/utils/cn";

const control =
  "w-full rounded-control border bg-surface px-3.5 text-base text-ink placeholder:text-muted/70 transition-shadow focus:border-brand focus:shadow-focus focus:outline-none disabled:bg-subtle disabled:text-muted sm:text-sm";

function Wrapper({ id, label, error, hint, children }: { id: string; label?: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink-2">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p role="alert" className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-sm text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export interface Option {
  value: string;
  label: string;
}

export function Select({ label, error, hint, options, placeholder, className, id, ...props }: ComponentProps<"select"> & { label?: string; error?: string; hint?: ReactNode; options: Option[]; placeholder?: string }) {
  const auto = useId();
  const selectId = id ?? auto;
  return (
    <Wrapper id={selectId} label={label} error={error} hint={hint}>
      <div className="relative">
        <select id={selectId} aria-invalid={error ? true : undefined} className={cn(control, "h-12 cursor-pointer appearance-none pr-9", error ? "border-danger" : "border-line", className)} {...props}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      </div>
    </Wrapper>
  );
}

export function Textarea({ label, error, hint, className, id, rows = 4, ...props }: ComponentProps<"textarea"> & { label?: string; error?: string; hint?: ReactNode }) {
  const auto = useId();
  const areaId = id ?? auto;
  return (
    <Wrapper id={areaId} label={label} error={error} hint={hint}>
      <textarea id={areaId} rows={rows} aria-invalid={error ? true : undefined} className={cn(control, "py-3", error ? "border-danger" : "border-line", className)} {...props} />
    </Wrapper>
  );
}
