import { Check, Circle } from "lucide-react";
import { cn } from "@/utils/cn";
import { PASSWORD_RULES } from "@/validations/auth.schemas";

/** Live checklist of the password policy. */
export function PasswordRules({ value }: { value: string }) {
  return (
    <ul className="grid grid-cols-1 gap-1.5 text-sm min-[400px]:grid-cols-2" aria-label="Password requirements">
      {PASSWORD_RULES.map((rule) => {
        const ok = rule.test(value);
        return (
          <li key={rule.label} className={cn("flex items-center gap-2", ok ? "text-success" : "text-muted")}>
            {ok ? <Check className="size-4" /> : <Circle className="size-3.5" />}
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}
