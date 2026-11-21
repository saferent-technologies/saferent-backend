import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/utils/cn";

export interface InputProps extends ComponentProps<"input"> {
  label?: string;
  error?: string;
  hint?: ReactNode;
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
}

export const inputBaseClass =
  "h-12 w-full rounded-control border bg-surface px-3.5 text-base text-ink placeholder:text-muted/70 transition-shadow " +
  "focus:border-brand focus:shadow-focus focus:outline-none disabled:bg-subtle disabled:text-muted sm:text-sm";

/** Email fields: spaces are never typed or pasted in (an email address can't contain one). */
function noSpaces(props: ComponentProps<"input">): ComponentProps<"input"> {
  if (props.type !== "email") return props;
  const { onChange, onKeyDown } = props;
  return {
    ...props,
    onKeyDown: (e) => {
      if (e.key === " ") e.preventDefault();
      onKeyDown?.(e);
    },
    onChange: (e) => {
      const clean = e.target.value.replace(/\s+/g, "");
      if (clean !== e.target.value) e.target.value = clean;
      onChange?.(e);
    },
  };
}

export function Input({ label, error, hint, leftIcon, rightSlot, className, id, ...rest }: InputProps) {
  const props = noSpaces(rest);
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-ink-2">
          {label}
        </label>
      )}
      <div className="relative">
        {leftIcon && <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-muted">{leftIcon}</span>}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(inputBaseClass, error ? "border-danger" : "border-line", leftIcon && "pl-10", rightSlot && "pr-12", className)}
          {...props}
        />
        {rightSlot && <span className="absolute inset-y-0 right-1.5 flex items-center">{rightSlot}</span>}
      </div>
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
