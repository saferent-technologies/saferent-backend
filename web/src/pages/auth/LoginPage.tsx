import { Mail, Smartphone } from "lucide-react";
import { useState } from "react";
import { EmailLoginForm } from "@/authentication/EmailLoginForm";
import { PhoneLoginForm } from "@/authentication/PhoneLoginForm";
import { Alert } from "@/components/ui/Alert";
import { Tabs } from "@/components/ui/Tabs";
import { useAuth } from "@/hooks/useAuth";
import { AuthCard, AuthLayout } from "@/layouts/AuthLayout";

type Method = "email" | "phone";

export function LoginPage() {
  const { notice } = useAuth();
  const [method, setMethod] = useState<Method>("phone");

  return (
    <AuthLayout>
      <AuthCard title="Welcome to SafeRent" subtitle="Sign in to your SafeRent account.">
        {notice && (
          <Alert kind={notice.kind} className="mb-5">
            {notice.message}
          </Alert>
        )}

        <Tabs<Method>
          idPrefix="login"
          className="mb-6"
          value={method}
          onChange={setMethod}
          items={[
            { value: "phone", label: "Phone", icon: <Smartphone className="size-4 shrink-0" /> },
            { value: "email", label: "Staff email", icon: <Mail className="size-4 shrink-0" /> },
          ]}
        />

        <div role="tabpanel" id={`login-panel-${method}`} aria-labelledby={`login-tab-${method}`}>
          {method === "email" ? <EmailLoginForm /> : <PhoneLoginForm />}
        </div>
        <p className="mt-5 text-center text-xs text-muted">
          {method === "phone" ? "Landlords, tenants, agents and service providers: sign in or create an account with your phone number." : "For SafeRent team members with an @saferenttechnologies.com email."}
        </p>
      </AuthCard>
      <p className="mt-6 text-center text-xs text-muted">Your sign-ins are protected with one-time codes and recorded for security.</p>
    </AuthLayout>
  );
}
