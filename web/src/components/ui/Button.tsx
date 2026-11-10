import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/utils/cn";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "link";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-dark active:bg-brand-dark shadow-sm disabled:bg-brand-light",
  secondary: "border border-line bg-surface text-ink hover:bg-subtle",
  ghost: "text-ink-2 hover:bg-subtle",
  danger: "bg-danger text-white hover:brightness-95",
  link: "text-brand-dark hover:text-brand underline-offset-4 hover:underline px-0 h-auto",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  leftIcon,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 rounded-control font-semibold transition-colors",
        "focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-70",
        variants[variant],
        variant !== "link" && sizes[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {loading ? <Spinner className="size-4" /> : leftIcon}
      {children}
    </button>
  );
}
