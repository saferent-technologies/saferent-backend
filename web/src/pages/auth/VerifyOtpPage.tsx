import { MailCheck } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { OtpInput } from "@/components/ui/OtpInput";
import { formatSeconds, useCountdown } from "@/hooks/useCountdown";
import { useAuth } from "@/hooks/useAuth";
import { AuthCard, AuthLayout } from "@/layouts/AuthLayout";
import { loadChallenge, resendEmailOtp, verifyEmailOtpCode } from "@/services/authService";
import type { EmailOtpChallenge } from "@/types/auth";
import { OTP_LENGTH, PATHS } from "@/utils/constants";
import { AppError, toAppError } from "@/utils/errors";

const RESTART_REASONS = new Set(["OTP_EXPIRED", "OTP_TOO_MANY_ATTEMPTS", "OTP_ALREADY_USED", "CHALLENGE_NOT_FOUND"]);
const SIGN_OUT_REASONS = new Set(["NOT_AUTHORIZED", "ACCOUNT_DISABLED", "ACCOUNT_MISMATCH", "WRONG_SIGN_IN_METHOD", "UNAUTHENTICATED"]);

export function VerifyOtpPage() {
  const navigate = useNavigate();
  const { logout, runLoginFlow, waitForAuthenticated, signInProvider } = useAuth();
  const [challenge, setChallenge] = useState<EmailOtpChallenge | null>(() => loadChallenge());
  const [code, setCode] = useState("");
  const [error, setError] = useState<AppError | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<"verify" | "resend" | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(challenge?.resendAvailableAt ?? null);

  const resendIn = useCountdown(cooldownUntil);
  const expiresIn = useCountdown(challenge?.expiresAt ?? null);
  const expired = !!challenge && expiresIn === 0;

  const handleError = async (err: unknown) => {
    const appError = toAppError(err);
    if (SIGN_OUT_REASONS.has(appError.reason)) {
      await logout({ kind: "error", message: appError.message });
      navigate(PATHS.login, { replace: true });
      return;
    }
    if (appError.reason === "RESEND_COOLDOWN" && appError.retryAfterSeconds) {
      setCooldownUntil(Date.now() + appError.retryAfterSeconds * 1000);
    }
    setError(appError);
    setCode("");
  };

  const verify = async (value = code) => {
    if (!challenge || value.length !== OTP_LENGTH || busy || expired) return;
    setError(null);
    setInfo(null);
    setBusy("verify");
    try {
      await runLoginFlow(async () => {
        await verifyEmailOtpCode(challenge.challengeId, value);
        await waitForAuthenticated();
      });
      navigate(PATHS.dashboard, { replace: true });
    } catch (err) {
      await handleError(err);
    } finally {
      setBusy(null);
    }
  };

  const resend = async () => {
    setError(null);
    setInfo(null);
    setBusy("resend");
    try {
      const next = await resendEmailOtp();
      setChallenge(next);
      setCooldownUntil(next.resendAvailableAt);
      setCode("");
      setInfo(`A new code was sent to ${next.maskedEmail}.`);
    } catch (err) {
      await handleError(err);
    } finally {
      setBusy(null);
    }
  };

  const switchAccount = async () => {
    await logout({ kind: "info", message: "Signed out. You can sign in with a different account." });
    navigate(PATHS.login, { replace: true });
  };

  // Phone sign-ins never need an email code; the session just needs to be restarted.
  if (signInProvider === "phone") {
    return (
      <AuthLayout>
        <AuthCard title="Sign-in incomplete" subtitle="Please sign in again to continue.">
          <Button fullWidth size="lg" onClick={() => void switchAccount()}>
            Back to sign in
          </Button>
        </AuthCard>
      </AuthLayout>
    );
  }

  const needsNewCode = !challenge || expired || (error && RESTART_REASONS.has(error.reason));

  return (
    <AuthLayout>
      <AuthCard
        title="Check your email"
        subtitle={
          challenge ? (
            <>
              Enter the {OTP_LENGTH}-digit code we sent to <strong className="font-semibold text-ink">{challenge.maskedEmail}</strong>
            </>
          ) : (
            "Request a verification code to finish signing in."
          )
        }
      >
        <div className="mb-6 flex justify-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-bg text-brand">
            <MailCheck className="size-7" />
          </span>
        </div>

        <div className="space-y-5">
          {error && (
            <Alert kind="error">
              {error.message}
              {error.reason === "OTP_INVALID" && error.attemptsRemaining !== undefined && (
                <> {error.attemptsRemaining} attempt{error.attemptsRemaining === 1 ? "" : "s"} left.</>
              )}
            </Alert>
          )}
          {expired && !error && <Alert kind="warning">This code has expired. Request a new code.</Alert>}
          {info && !error && <Alert kind="success">{info}</Alert>}

          {challenge && !expired && (
            <form
              noValidate
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                void verify();
              }}
            >
              <OtpInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} disabled={busy !== null} invalid={error?.reason === "OTP_INVALID"} label="Email verification code" />
              <p className="text-center text-sm text-muted" aria-live="polite">
                Code expires in <span className="font-semibold tabular-nums text-ink">{formatSeconds(expiresIn)}</span>
              </p>
              <Button type="submit" size="lg" fullWidth loading={busy === "verify"} disabled={code.length !== OTP_LENGTH || !!needsNewCode}>
                {busy === "verify" ? "Verifying…" : "Verify"}
              </Button>
            </form>
          )}

          <div className="flex flex-col items-center gap-3 text-sm">
            {resendIn > 0 ? (
              <span className="text-muted" aria-live="polite">
                Resend code in <span className="tabular-nums">{formatSeconds(resendIn)}</span>
              </span>
            ) : (
              <Button variant={needsNewCode ? "primary" : "link"} fullWidth={!!needsNewCode} size="lg" loading={busy === "resend"} onClick={() => void resend()} disabled={busy === "verify"}>
                {challenge ? "Resend code" : "Send code"}
              </Button>
            )}
            <Button variant="link" onClick={() => void switchAccount()} className="text-muted hover:text-ink">
              Use a different account
            </Button>
          </div>
        </div>
      </AuthCard>
    </AuthLayout>
  );
}
