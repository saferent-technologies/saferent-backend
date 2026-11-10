import { Alert } from "@/components/ui/Alert";
import { AuthCard, AuthLayout } from "@/layouts/AuthLayout";

/** Shown instead of crashing when web/.env.local hasn't been filled in yet. */
export function ConfigMissingPage({ missing }: { missing: string[] }) {
  return (
    <AuthLayout>
      <AuthCard title="Firebase is not configured" subtitle="Finish the setup to start the SafeRent admin portal.">
        <Alert kind="warning" title="Missing settings">
          Copy <code>web/.env.example</code> to <code>web/.env.local</code> and fill in your Firebase web app config. Missing:{" "}
          <strong>{missing.join(", ")}</strong>
        </Alert>
        <p className="mt-4 text-sm text-muted">See docs/SETUP.md, step 2 (“Register the web app”). Restart <code>npm run dev</code> after saving.</p>
      </AuthCard>
    </AuthLayout>
  );
}
