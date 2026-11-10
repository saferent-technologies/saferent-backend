import { zodResolver } from "@hookform/resolvers/zod";
import { applyActionCode, confirmPasswordReset, verifyPasswordResetCode } from "firebase/auth";
import { CheckCircle2, LinkIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router";
import { PasswordRules } from "@/authentication/PasswordRules";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Spinner } from "@/components/ui/Spinner";
import { auth } from "@/firebase/config";
import { AuthCard, AuthLayout } from "@/layouts/AuthLayout";
import { PATHS } from "@/utils/constants";
import { errorMessage } from "@/utils/errors";
import { maskEmail } from "@/utils/mask";
import { newPasswordSchema, type NewPasswordValues } from "@/validations/auth.schemas";

type State =
  | { kind: "checking" }
  | { kind: "reset"; email: string }
  | { kind: "done"; title: string; message: string }
  | { kind: "invalid"; message: string };

/**
 * Handles links from Firebase emails (configure this URL as the custom action handler:
 * Firebase console → Authentication → Templates → Customize action URL → https://<your-domain>/auth/action).
 * Supports password reset and email-change confirmation, including expired/used links.
 */
export function AuthActionPage() {
  const [params] = useSearchParams();
  const mode = params.get("mode");
  const oobCode = params.get("oobCode") ?? "";
  const [state, setState] = useState<State>({ kind: "checking" });
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!oobCode) {
        setState({ kind: "invalid", message: "This link is invalid. Request a new one." });
        return;
      }
      try {
        if (mode === "resetPassword") {
          const email = await verifyPasswordResetCode(auth, oobCode);
          if (!cancelled) setState({ kind: "reset", email });
        } else if (mode === "verifyAndChangeEmail" || mode === "verifyEmail" || mode === "recoverEmail") {
          await applyActionCode(auth, oobCode);
          if (!cancelled)
            setState({
              kind: "done",
              title: mode === "recoverEmail" ? "Email restored" : "Email confirmed",
              message:
                mode === "recoverEmail"
                  ? "Your previous email address has been restored. We recommend changing your password now."
                  : "Your email address has been updated. Sign in again with your new email.",
            });
        } else {
          setState({ kind: "invalid", message: "This link is not supported." });
        }
      } catch (err) {
        if (!cancelled) setState({ kind: "invalid", message: errorMessage(err) });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [mode, oobCode]);

  return (
    <AuthLayout>
      {state.kind === "checking" && (
        <AuthCard title="Checking your link" subtitle="One moment…">
          <div className="flex justify-center py-6">
            <Spinner className="size-7 text-brand" />
          </div>
        </AuthCard>
      )}
      {state.kind === "invalid" && (
        <AuthCard title="Link expired or invalid" subtitle="For your security, links expire and can only be used once.">
          <div className="mb-6 flex justify-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-danger/10 text-danger">
              <LinkIcon className="size-7" />
            </span>
          </div>
          <Alert kind="error">{state.message}</Alert>
          <div className="mt-6 grid gap-3">
            {mode === "resetPassword" && (
              <Button fullWidth size="lg" onClick={() => navigate(PATHS.forgotPassword)}>
                Request a new reset link
              </Button>
            )}
            <Button fullWidth size="lg" variant="secondary" onClick={() => navigate(PATHS.login)}>
              Return to login
            </Button>
          </div>
        </AuthCard>
      )}
      {state.kind === "done" && <DoneCard title={state.title} message={state.message} />}
      {state.kind === "reset" && (
        <ResetPasswordForm email={state.email} oobCode={oobCode} onDone={() => setState({ kind: "done", title: "Password updated", message: "Your password has been reset. Sign in with your new password." })} onInvalid={(message) => setState({ kind: "invalid", message })} />
      )}
    </AuthLayout>
  );
}

function DoneCard({ title, message }: { title: string; message: string }) {
  const navigate = useNavigate();
  return (
    <AuthCard title={title}>
      <div className="mb-6 flex justify-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-success/10 text-success">
          <CheckCircle2 className="size-7" />
        </span>
      </div>
      <Alert kind="success">{message}</Alert>
      <Button fullWidth size="lg" className="mt-6" onClick={() => navigate(PATHS.login)}>
        Return to login
      </Button>
    </AuthCard>
  );
}

function ResetPasswordForm({ email, oobCode, onDone, onInvalid }: { email: string; oobCode: string; onDone: () => void; onInvalid: (message: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<NewPasswordValues>({ resolver: zodResolver(newPasswordSchema), defaultValues: { password: "", confirmPassword: "" }, mode: "onTouched" });

  const onSubmit = handleSubmit(async ({ password }) => {
    setError(null);
    try {
      await confirmPasswordReset(auth, oobCode, password);
      onDone();
    } catch (err) {
      const message = errorMessage(err);
      if (/expired|invalid|already been used/i.test(message)) onInvalid(message);
      else setError(message);
    }
  });

  return (
    <AuthCard title="Set a new password" subtitle={<>For {maskEmail(email)}</>}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <PasswordInput label="New password" autoComplete="new-password" error={errors.password?.message} {...register("password")} />
        <PasswordRules value={watch("password")} />
        <PasswordInput label="Confirm new password" autoComplete="new-password" error={errors.confirmPassword?.message} {...register("confirmPassword")} />
        <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
          Update password
        </Button>
      </form>
    </AuthCard>
  );
}
