import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";
import { EmailLoginForm } from "@/authentication/EmailLoginForm";
import { PhoneLoginForm } from "@/authentication/PhoneLoginForm";
import { Alert } from "@/components/ui/Alert";
import { useAuth } from "@/hooks/useAuth";
import { AuthCard, AuthLayout } from "@/layouts/AuthLayout";
import { PATHS } from "@/utils/constants";

function NoticeBanner() {
  const { notice } = useAuth();
  if (!notice) return null;
  return (
    <Alert kind={notice.kind} className="mb-5">
      {notice.message}
    </Alert>
  );
}

const backHome = (
  <Link to={PATHS.home} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-brand-dark">
    <ArrowLeft className="size-4" /> Back to homes
  </Link>
);

/** /login — landlords, tenants, agents and service providers: phone number + OTP only. */
export function LoginPage() {
  return (
    <AuthLayout>
      {backHome}
      <AuthCard title="Sign in or create an account" subtitle="Use your mobile number — we'll send you a one-time code.">
        <NoticeBanner />
        <PhoneLoginForm />
        <p className="mt-5 text-center text-xs text-muted">For landlords, tenants, property agents and service providers.</p>
      </AuthCard>
    </AuthLayout>
  );
}

/**
 * /employee — SafeRent team only: company email + password + email code. Landlord and tenant
 * accounts can't sign in here (the server only accepts staff accounts with a company email).
 */
export function EmployeeLoginPage() {
  return (
    <AuthLayout variant="employee">
      <AuthCard title="Employee sign in" subtitle="For SafeRent team members with an @saferenttechnologies.com email.">
        <NoticeBanner />
        <EmailLoginForm />
      </AuthCard>
      <p className="mt-6 text-center text-xs text-muted">Every sign-in is protected with a one-time code and recorded for security.</p>
    </AuthLayout>
  );
}
