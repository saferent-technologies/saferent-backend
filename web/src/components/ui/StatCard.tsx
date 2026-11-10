import type { LucideIcon } from "lucide-react";
import { cn } from "@/utils/cn";

const tones = {
  brand: "bg-brand-bg text-brand",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  neutral: "bg-subtle text-ink-2",
} as const;

export function StatCard({ label, value, icon: Icon, tone = "neutral", hint }: { label: string; value: string | number; icon?: LucideIcon; tone?: keyof typeof tones; hint?: string }) {
  return (
    <div className="card min-w-0 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted">{label}</p>
        {Icon && (
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", tones[tone])}>
            <Icon className="size-5" />
          </span>
        )}
      </div>
      <p className="mt-2 truncate text-2xl font-bold tracking-tight text-ink sm:text-3xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}
