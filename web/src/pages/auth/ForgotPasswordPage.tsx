import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Mail, MailCheck } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AuthCard, AuthLayout } from "@/layouts/AuthLayout";
import { api } from "@/services/api";
import { ALLOWED_EMAIL_DOMAIN, PATHS } from "@/utils/constants";
import { errorMessage } from "@/utils/errors";
import { maskEmail } from "@/utils/mask";
import { forgotPasswordSchema, type ForgotPasswordValues } from "@/validations/auth.schemas";

export function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: "" }, mode: "onTouched" });

  const onSubmit = handleSubmit(async ({ email }) => {
    setError(null);
    try {
      await api.requestPasswordReset({ email: email.trim().toLowerCase() });
      setSentTo(email);
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  const backLink = (
    <Link to={PATHS.login} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-dark hover:text-brand hover:underline">
      <ArrowLeft className="size-4" /> Return to login
    </Link>
  );

  if (sentTo) {
    return (
      <AuthLayout>
        <AuthCard title="Check your inbox" subtitle="If an authorized SafeRent admin account exists for this address, a reset link is on its way.">
          <div className="mb-6 flex justify-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-success/10 text-success">
              <MailCheck className="size-7" />
            </span>
          </div>
          <Alert kind="success">
            Sent to <strong>{maskEmail(sentTo)}</strong>. The link expires soon and can be used once. Check your spam folder if you don't see it.
          </Alert>
          <div className="mt-6 text-center">{backLink}</div>
        </AuthCard>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthCard title="Forgot your password?" subtitle="Enter your work email and we'll send you a secure reset link.">
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {error && <Alert kind="error">{error}</Alert>}
          <Input
            label="Work email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            placeholder={`name@${ALLOWED_EMAIL_DOMAIN}`}
            leftIcon={<Mail className="size-4" />}
            error={errors.email?.message}
            {...register("email")}
          />
          <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
            {isSubmitting ? "Sending link…" : "Send reset link"}
          </Button>
          <div className="pt-2 text-center">{backLink}</div>
        </form>
      </AuthCard>
    </AuthLayout>
  );
}
