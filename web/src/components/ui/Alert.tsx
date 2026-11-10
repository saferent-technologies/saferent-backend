import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

type Kind = "info" | "success" | "warning" | "error";

const styles: Record<Kind, { box: string; icon: ReactNode }> = {
  info: { box: "border-brand-light/40 bg-brand-bg text-ink-2", icon: <Info className="size-5 shrink-0 text-brand-dark" /> },
  success: { box: "border-success/30 bg-success/5 text-ink-2", icon: <CheckCircle2 className="size-5 shrink-0 text-success" /> },
  warning: { box: "border-warning/30 bg-warning/5 text-ink-2", icon: <AlertTriangle className="size-5 shrink-0 text-warning" /> },
  error: { box: "border-danger/30 bg-danger/5 text-ink-2", icon: <XCircle className="size-5 shrink-0 text-danger" /> },
};

export function Alert({ kind = "info", title, children, className }: { kind?: Kind; title?: string; children?: ReactNode; className?: string }) {
  return (
    <div role={kind === "error" ? "alert" : "status"} className={cn("flex gap-3 rounded-control border p-3.5 text-sm", styles[kind].box, className)}>
      {styles[kind].icon}
      <div className="min-w-0 space-y-0.5">
        {title && <p className="font-semibold text-ink">{title}</p>}
        {children && <div className="break-words leading-relaxed">{children}</div>}
      </div>
    </div>
  );
}
