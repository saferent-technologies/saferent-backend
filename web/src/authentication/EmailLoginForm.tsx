import { zodResolver } from "@hookform/resolvers/zod";
import { Mail } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { useAuth } from "@/hooks/useAuth";
import { signInWithEmailStep } from "@/services/authService";
import { ALLOWED_EMAIL_DOMAIN, PATHS } from "@/utils/constants";
import { errorMessage } from "@/utils/errors";
import { emailLoginSchema, type EmailLoginValues } from "@/validations/auth.schemas";

export function EmailLoginForm() {
  const navigate = useNavigate();
  const { runLoginFlow, setNotice } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EmailLoginValues>({
    resolver: zodResolver(emailLoginSchema),
    defaultValues: { email: "", password: "", rememberMe: true },
    mode: "onTouched",
  });

  const onSubmit = handleSubmit(async ({ email, password, rememberMe }) => {
    setError(null);
    setNotice(null);
    try {
      await runLoginFlow(() => signInWithEmailStep(email, password, rememberMe));
      navigate(PATHS.verifyOtp, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-describedby={error ? "email-login-error" : undefined}>
      {error && (
        <div id="email-login-error">
          <Alert kind="error">{error}</Alert>
        </div>
      )}

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

      <PasswordInput label="Password" autoComplete="current-password" placeholder="Enter your password" error={errors.password?.message} {...register("password")} />

      <div className="flex flex-wrap items-center justify-between gap-x-4">
        <Checkbox label="Remember me" {...register("rememberMe")} />
        <Link to={PATHS.forgotPassword} className="py-2 text-sm font-semibold text-brand-dark hover:text-brand hover:underline">
          Forgot password?
        </Link>
      </div>

      <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
        {isSubmitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
