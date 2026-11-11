import { zodResolver } from "@hookform/resolvers/zod";
import { Home, KeyRound, Mail, UserRound } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { z } from "zod";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/hooks/useAuth";
import { AuthCard, AuthLayout } from "@/layouts/AuthLayout";
import { api } from "@/services/api";
import { cn } from "@/utils/cn";
import { PATHS } from "@/utils/constants";
import { errorMessage } from "@/utils/errors";
import { maskPhone } from "@/utils/mask";
import { clearPendingReferral, pendingReferral } from "@/routes/pendingReferral";

const schema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name.").max(120),
  role: z.enum(["LANDLORD", "TENANT"], { message: "Choose how you'll use SafeRent." }),
  email: z.string().trim().email("Enter a valid email address.").max(254).optional().or(z.literal("")),
});
type Values = z.infer<typeof schema>;

const ROLE_CHOICES = [
  { value: "TENANT" as const, title: "I'm looking for a home", text: "Browse, apply, pay rent and raise requests.", icon: KeyRound },
  { value: "LANDLORD" as const, title: "I own property", text: "List properties, choose tenants and track rent.", icon: Home },
];

/** Self-registration for landlords and tenants after Firebase has verified their phone number. */
export function RegisterPage() {
  const navigate = useNavigate();
  const { pendingPhone, runLoginFlow, waitForAuthenticated, logout } = useAuth();
  const [error, setError] = useState<string | null>(null);
  // Code from a /ref link opened before sign-up (the server validates and locks it).
  const [referral] = useState(() => pendingReferral());
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { fullName: "", email: "", ...(referral ? { role: referral.kind } : {}) }, mode: "onTouched" });
  const role = watch("role");

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await runLoginFlow(async () => {
        await api.register({ fullName: values.fullName, role: values.role, email: values.email || undefined, referralCode: referral?.code });
        clearPendingReferral();
        await waitForAuthenticated();
      });
      navigate(values.role === "LANDLORD" ? "/properties/new" : "/browse", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <AuthLayout>
      <AuthCard title="Create your account" subtitle={pendingPhone ? <>Phone verified: <strong className="text-ink">{maskPhone(pendingPhone)}</strong></> : "Tell us a little about yourself."}>
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          {referral && <Alert kind="info">You were invited with referral code {referral.code}. It applies when you sign up as a {referral.kind === "TENANT" ? "tenant" : "landlord"}.</Alert>}
          {error && <Alert kind="error">{error}</Alert>}

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink-2">How will you use SafeRent?</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {ROLE_CHOICES.map(({ value, title, text, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={role === value}
                  onClick={() => setValue("role", value, { shouldValidate: true })}
                  className={cn(
                    "flex min-h-24 flex-col items-start gap-1 rounded-control border p-4 text-left transition-colors",
                    role === value ? "border-brand bg-brand-bg shadow-focus" : "border-line hover:border-brand-light",
                  )}
                >
                  <Icon className={cn("size-5", role === value ? "text-brand" : "text-muted")} />
                  <span className="font-semibold text-ink">{title}</span>
                  <span className="text-xs text-muted">{text}</span>
                </button>
              ))}
            </div>
            {errors.role && <p className="mt-1.5 text-sm text-danger">{errors.role.message}</p>}
          </fieldset>

          <Input label="Full name" autoComplete="name" leftIcon={<UserRound className="size-4" />} error={errors.fullName?.message} {...register("fullName")} />
          <Input label="Email (optional)" type="email" inputMode="email" autoComplete="email" leftIcon={<Mail className="size-4" />} hint="For receipts and important updates." error={errors.email?.message} {...register("email")} />

          <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
            Create account
          </Button>
          <Button
            variant="link"
            className="w-full text-muted"
            onClick={async () => {
              await logout({ kind: "info", message: "Registration cancelled." });
              navigate(PATHS.login, { replace: true });
            }}
          >
            Cancel
          </Button>
          <p className="text-center text-xs text-muted">Staff, agents and service providers are added by a SafeRent administrator.</p>
        </form>
      </AuthCard>
    </AuthLayout>
  );
}
