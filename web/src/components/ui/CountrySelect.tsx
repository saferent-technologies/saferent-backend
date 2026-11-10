import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { COUNTRY_CODES } from "@/utils/phone";
import { cn } from "@/utils/cn";

/** Native <select> for country dial codes — best touch support on iOS/Android. */
export function CountrySelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <div className={cn("relative shrink-0", className)}>
      <select
        aria-label="Country code"
        className="h-12 w-full cursor-pointer appearance-none rounded-control border border-line bg-surface pl-3 pr-8 text-base text-ink focus:border-brand focus:shadow-focus focus:outline-none disabled:bg-subtle sm:text-sm"
        {...props}
      >
        {COUNTRY_CODES.map((c) => (
          <option key={c.iso} value={c.iso}>
            {c.flag} {c.dialCode} ({c.iso})
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
    </div>
  );
}
