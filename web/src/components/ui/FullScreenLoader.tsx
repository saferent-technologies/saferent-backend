import { Logo } from "./Logo";
import { Spinner } from "./Spinner";

export function FullScreenLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-canvas px-4">
      <Logo className="h-14" />
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner className="size-4 text-brand" />
        <span>{label}</span>
      </div>
    </div>
  );
}
