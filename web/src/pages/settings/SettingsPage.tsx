import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, LogOut, Mail, Phone, Smartphone } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router";
import { PasswordRules } from "@/authentication/PasswordRules";
import { useReauthGate } from "@/authentication/ReauthDialog";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { CountrySelect } from "@/components/ui/CountrySelect";
import { Input } from "@/components/ui/Input";
import { OtpInput } from "@/components/ui/OtpInput";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Tabs } from "@/components/ui/Tabs";
import { useAuth } from "@/hooks/useAuth";
import { useRecaptcha } from "@/hooks/useRecaptcha";
import { api } from "@/services/api";
import { confirmPhoneChange, sendPhoneChangeCode } from "@/services/authService";
import { ALLOWED_EMAIL_DOMAIN, OTP_LENGTH, PATHS } from "@/utils/constants";
import { errorMessage } from "@/utils/errors";
import { maskPhone } from "@/utils/mask";
import { phoneNumberInputProps } from "@/utils/phoneInput";
import { DEFAULT_COUNTRY, findCountry, toE164 } from "@/utils/phone";
import {
  changeEmailSchema,
  newPasswordSchema,
  phoneLoginSchema,
  type ChangeEmailValues,
  type NewPasswordValues,
  type PhoneLoginValues,
} from "@/validations/auth.schemas";

type Tab = "security" | "email" | "phone";
const TABS: Tab[] = ["security", "email", "phone"];

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const { profile, roleInfo } = useAuth();
  const requested = params.get("tab") as Tab | null;
  const forced = !!profile?.mustChangePassword;
  // Staff sign in with email + password; everyone else signs in with their phone only.
  const staff = !!roleInfo?.isStaff;
  const available: Tab[] = staff ? TABS : ["phone"];
  const tab: Tab = forced ? "security" : requested && available.includes(requested) ? requested : available[0];

  return (
    <>
      <PageHeader title="Security settings" description={staff ? "Manage your password, sign-in email and phone number." : "Manage the phone number you sign in with."} />

      {forced && (
        <Alert kind="warning" title="Password change required" className="mb-6">
          You're signed in with a temporary password. Set a new password to continue using SafeRent.
        </Alert>
      )}

      <div className="max-w-2xl">
        {!forced && staff && (
          <Tabs<Tab>
            idPrefix="settings"
            className="mb-6"
            value={tab}
            onChange={(value) => setParams({ tab: value }, { replace: true })}
            items={[
              { value: "security", label: "Password", icon: <KeyRound className="size-4 shrink-0" /> },
              { value: "email", label: "Email", icon: <Mail className="size-4 shrink-0" /> },
              { value: "phone", label: "Phone", icon: <Smartphone className="size-4 shrink-0" /> },
            ]}
          />
        )}
        <section role="tabpanel" id={`settings-panel-${tab}`} className="card p-5 sm:p-6">
          {tab === "security" && <ChangePasswordSection />}
          {tab === "email" && <ChangeEmailSection />}
          {tab === "phone" && <ChangePhoneSection />}
        </section>
        {forced && <SignOutLink />}
      </div>
    </>
  );
}

function SignOutLink() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <Button
      variant="link"
      className="mt-4 text-muted"
      leftIcon={<LogOut className="size-4" />}
      onClick={async () => {
        await logout();
        navigate(PATHS.login, { replace: true });
      }}
    >
      Sign out
    </Button>
  );
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <p className="mt-1 text-sm text-muted">{description}</p>
    </div>
  );
}

/* --------------------------------- password --------------------------------- */

function ChangePasswordSection() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { requireReauth, dialog } = useReauthGate();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<NewPasswordValues>({ resolver: zodResolver(newPasswordSchema), defaultValues: { password: "", confirmPassword: "" }, mode: "onTouched" });

  const onSubmit = handleSubmit(({ password }) => {
    setError(null);
    requireReauth(async () => {
      setSaving(true);
      try {
        await api.changePassword({ newPassword: password });
        await logout({ kind: "success", message: "Password changed. Sign in with your new password." });
        navigate(PATHS.login, { replace: true });
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setSaving(false);
      }
    });
  });

  return (
    <>
      <SectionTitle title="Change password" description="You'll be signed out on all devices after changing your password." />
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <PasswordInput label="New password" autoComplete="new-password" error={errors.password?.message} {...register("password")} />
        <PasswordRules value={watch("password")} />
        <PasswordInput label="Confirm new password" autoComplete="new-password" error={errors.confirmPassword?.message} {...register("confirmPassword")} />
        <Button type="submit" loading={saving}>
          Update password
        </Button>
      </form>
      {dialog}
    </>
  );
}

/* ----------------------------------- email ----------------------------------- */

function ChangeEmailSection() {
  const { profile, refresh } = useAuth();
  const { requireReauth, dialog } = useReauthGate();
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ChangeEmailValues>({ resolver: zodResolver(changeEmailSchema), defaultValues: { newEmail: "" }, mode: "onTouched" });

  const onSubmit = handleSubmit(({ newEmail }) => {
    setError(null);
    setSentTo(null);
    requireReauth(async () => {
      setSaving(true);
      try {
        const result = await api.requestEmailChange({ newEmail: newEmail.trim().toLowerCase() });
        setSentTo(result.maskedEmail);
        reset();
        await refresh();
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setSaving(false);
      }
    });
  });

  return (
    <>
      <SectionTitle title="Update email" description={`Your sign-in email must be a @${ALLOWED_EMAIL_DOMAIN} address. We'll send a confirmation link to the new address.`} />
      <p className="mb-4 text-sm text-ink-2">
        Current email: <strong>{profile?.email}</strong>
        {profile?.pendingEmail && <span className="block text-muted">Pending confirmation: {profile.pendingEmail}</span>}
      </p>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        {sentTo && (
          <Alert kind="success" title="Check the new inbox">
            We sent a confirmation link to {sentTo}. Your email changes after you open it; then sign in again with the new address.
          </Alert>
        )}
        <Input label="New email" type="email" inputMode="email" autoCapitalize="none" placeholder={`name@${ALLOWED_EMAIL_DOMAIN}`} leftIcon={<Mail className="size-4" />} error={errors.newEmail?.message} {...register("newEmail")} />
        <Button type="submit" loading={saving}>
          Send confirmation link
        </Button>
      </form>
      {dialog}
    </>
  );
}

/* ----------------------------------- phone ----------------------------------- */

const PHONE_RECAPTCHA_ID = "settings-phone-recaptcha";

function ChangePhoneSection() {
  const { profile, refresh } = useAuth();
  const { requireReauth, dialog } = useReauthGate();
  const { getVerifier, reset: resetRecaptcha } = useRecaptcha(PHONE_RECAPTCHA_ID);
  const [step, setStep] = useState<"number" | "code">("number");
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [newPhone, setNewPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<PhoneLoginValues>({ resolver: zodResolver(phoneLoginSchema), defaultValues: { countryIso: DEFAULT_COUNTRY.iso, phone: "" }, mode: "onTouched" });

  const onSubmitNumber = handleSubmit(({ countryIso, phone }) => {
    const e164 = toE164(findCountry(countryIso), phone);
    setError(null);
    setSuccess(null);
    if (e164 === profile?.phoneNumber) {
      setError("This is already your phone number.");
      return;
    }
    requireReauth(async () => {
      setBusy(true);
      try {
        const id = await sendPhoneChangeCode(e164, getVerifier());
        setVerificationId(id);
        setNewPhone(e164);
        setCode("");
        setStep("code");
      } catch (err) {
        resetRecaptcha();
        setError(errorMessage(err));
      } finally {
        setBusy(false);
      }
    });
  });

  const verify = async (value = code) => {
    if (!verificationId || value.length !== OTP_LENGTH || busy) return;
    setError(null);
    setBusy(true);
    try {
      const masked = await confirmPhoneChange(verificationId, value);
      setSuccess(`Your phone number was updated to ${masked}.`);
      await refresh();
      setStep("number");
      setVerificationId(null);
    } catch (err) {
      setError(errorMessage(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle title="Update phone number" description="Used for “Continue with Phone Number” sign-in. We'll text a code to verify the new number." />
      <p className="mb-4 text-sm text-ink-2">
        Current phone: <strong>{profile?.phoneNumber ? maskPhone(profile.phoneNumber) : "Not set"}</strong>
      </p>
      <div className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        {success && <Alert kind="success">{success}</Alert>}
        {step === "number" ? (
          <form onSubmit={onSubmitNumber} noValidate className="space-y-4">
            <div>
              <label htmlFor="new-phone" className="mb-1.5 block text-sm font-medium text-ink-2">
                New phone number
              </label>
              <div className="flex gap-2">
                <CountrySelect className="w-[7.5rem] sm:w-36" {...register("countryIso")} />
                <div className="min-w-0 flex-1">
                  <Input id="new-phone" autoComplete="tel-national" {...phoneNumberInputProps(watch("countryIso"))} leftIcon={<Phone className="size-4" />} error={errors.phone?.message} {...register("phone")} />
                </div>
              </div>
            </div>
            <Button type="submit" loading={busy}>
              Send verification code
            </Button>
          </form>
        ) : (
          <form
            noValidate
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
          >
            <p className="text-sm text-muted">Enter the code sent to {maskPhone(newPhone)}.</p>
            <OtpInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} disabled={busy} invalid={!!error} label="SMS verification code" />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy} disabled={code.length !== OTP_LENGTH}>
                Verify & update
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setStep("number");
                  resetRecaptcha();
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
        <div id={PHONE_RECAPTCHA_ID} />
      </div>
      {dialog}
    </>
  );
}
