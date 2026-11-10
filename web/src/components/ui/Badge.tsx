import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

type Tone = "brand" | "neutral" | "success" | "warning" | "danger";

const tones: Record<Tone, string> = {
  brand: "bg-brand-bg text-brand-dark",
  neutral: "bg-subtle text-ink-2",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", tones[tone], className)}>
      {children}
    </span>
  );
}
