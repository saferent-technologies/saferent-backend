import { useId, type ComponentProps } from "react";
import { cn } from "@/utils/cn";

export function Checkbox({ label, className, id, ...props }: ComponentProps<"input"> & { label: string }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <label htmlFor={inputId} className={cn("inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-ink-2", className)}>
      <input
        id={inputId}
        type="checkbox"
        className="size-4.5 cursor-pointer rounded border-line accent-brand focus-visible:shadow-focus"
        {...props}
      />
      {label}
    </label>
  );
}
