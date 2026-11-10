import { zodResolver } from "@hookform/resolvers/zod";
import type { ConfirmationResult } from "firebase/auth";
import { ArrowLeft, Phone } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { CountrySelect } from "@/components/ui/CountrySelect";
import { Input } from "@/components/ui/Input";
import { OtpInput } from "@/components/ui/OtpInput";
import { formatSeconds, useCountdown } from "@/hooks/useCountdown";
import { useAuth } from "@/hooks/useAuth";
import { useRecaptcha } from "@/hooks/useRecaptcha";
import { confirmPhoneLoginCode, sendPhoneLoginCode } from "@/services/authService";
import { OTP_LENGTH, OTP_RESEND_SECONDS, PATHS } from "@/utils/constants";
import { errorMessage } from "@/utils/errors";
import { maskPhone } from "@/utils/mask";
import { phoneNumberInputProps } from "@/utils/phoneInput";
import { DEFAULT_COUNTRY, findCountry, toE164 } from "@/utils/phone";
import { phoneLoginSchema, type PhoneLoginValues } from "@/validations/auth.schemas";

const RECAPTCHA_ID = "phone-login-recaptcha";

export function PhoneLoginForm() {
  const navigate = useNavigate();
  const { runLoginFlow, waitForAuthenticated, refresh, setNotice } = useAuth();
  const { getVerifier, reset } = useRecaptcha(RECAPTCHA_ID);

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [phoneE164, setPhoneE164] = useState("");
  const [code, setCode] = useState("");
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState<"send" | "verify" | null>(null);
  const resendIn = useCountdown(resendAt);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<PhoneLoginValues>({
    resolver: zodResolver(phoneLoginSchema),
    defaultValues: { countryIso: DEFAULT_COUNTRY.iso, phone: "" },
    mode: "onTouched",
  });

  const sendCode = async (e164: string) => {
    setError(null);
    setSuccess(null);
    setNotice(null);
    setBusy("send");
    try {
      const result = await sendPhoneLoginCode(e164, getVerifier());
      setConfirmation(result);
      setPhoneE164(e164);
      setCode("");
      setStep("code");
      setResendAt(Date.now() + OTP_RESEND_SECONDS * 1000);
      setSuccess(`We sent a ${OTP_LENGTH}-digit code to ${maskPhone(e164)}.`);
    } catch (err) {
      reset();
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const onSubmitPhone = handleSubmit(({ countryIso, phone }) => sendCode(toE164(findCountry(countryIso), phone)));

  const verify = async (value = code) => {
    if (!confirmation || value.length !== OTP_LENGTH || busy) return;
    setError(null);
    setBusy("verify");
    try {
      const next = await runLoginFlow(async () => {
        const result = await confirmPhoneLoginCode(confirmation, value);
        if (result.registrationRequired) {
          await refresh();
          return PATHS.register;
        }
        await waitForAuthenticated();
        return PATHS.dashboard;
      });
      navigate(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setCode("");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {error && <Alert kind="error">{error}</Alert>}
      {success && !error && <Alert kind="success">{success}</Alert>}

      {step === "phone" ? (
        <form onSubmit={onSubmitPhone} noValidate className="space-y-4">
          <div>
            <label htmlFor="phone-number" className="mb-1.5 block text-sm font-medium text-ink-2">
              Phone number
            </label>
            <div className="flex gap-2">
              <CountrySelect className="w-[7.5rem] sm:w-36" {...register("countryIso")} />
              <div className="min-w-0 flex-1">
                <Input
                  id="phone-number"
                  autoComplete="tel-national"
                  {...phoneNumberInputProps(watch("countryIso"))}
                  leftIcon={<Phone className="size-4" />}
                  error={errors.phone?.message}
                  {...register("phone")}
                />
              </div>
            </div>
          </div>
          <Button type="submit" size="lg" fullWidth loading={busy === "send"}>
            {busy === "send" ? "Sending code…" : "Send OTP"}
          </Button>
        </form>
      ) : (
        <form
          noValidate
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <OtpInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} disabled={busy === "verify"} invalid={!!error} label="SMS verification code" />
          <Button type="submit" size="lg" fullWidth loading={busy === "verify"} disabled={code.length !== OTP_LENGTH}>
            {busy === "verify" ? "Verifying…" : "Verify & sign in"}
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <Button
              variant="link"
              leftIcon={<ArrowLeft className="size-4" />}
              onClick={() => {
                setStep("phone");
                setError(null);
                setSuccess(null);
                reset();
              }}
            >
              Change number
            </Button>
            {resendIn > 0 ? (
              <span className="text-muted" aria-live="polite">
                Resend code in {formatSeconds(resendIn)}
              </span>
            ) : (
              <Button variant="link" onClick={() => void sendCode(phoneE164)} disabled={busy !== null}>
                Resend OTP
              </Button>
            )}
          </div>
        </form>
      )}

      <div id={RECAPTCHA_ID} />
      <p className="text-center text-xs leading-relaxed text-muted">
        Protected by reCAPTCHA. Google{" "}
        <a className="underline hover:text-ink" href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
          Privacy Policy
        </a>{" "}
        and{" "}
        <a className="underline hover:text-ink" href="https://policies.google.com/terms" target="_blank" rel="noreferrer">
          Terms
        </a>{" "}
        apply. Message and data rates may apply.
      </p>
    </div>
  );
}
