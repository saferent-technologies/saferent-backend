import logoUrl from "@/assets/saferent-logo.png";
import { cn } from "@/utils/cn";

/** Official SafeRent logo (house + wordmark). */
export function Logo({ className }: { className?: string }) {
  return <img src={logoUrl} alt="SafeRent" className={cn("h-10 w-auto select-none object-contain", className)} draggable={false} />;
}
