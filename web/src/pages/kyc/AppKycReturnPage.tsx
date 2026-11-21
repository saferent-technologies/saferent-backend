import { CheckCircle2 } from "lucide-react";

/**
 * DigiLocker sends app users here (APP_LINK_ORIGIN/app/kyc/return?id=…&success=…). The installed app normally
 * opens this link itself (App Link); if the browser shows it instead, the app finishes the check when you
 * switch back to it. No sign-in needed and nothing is sent from this page.
 */
export function AppKycReturnPage() {
  const params = new URLSearchParams(window.location.search);
  const ok = (params.get("success") ?? "true").toLowerCase() === "true";
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <CheckCircle2 className={ok ? "size-12 text-brand" : "size-12 text-muted"} aria-hidden />
      <h1 className="text-xl font-bold text-ink">{ok ? "DigiLocker done" : "DigiLocker not completed"}</h1>
      <p className="text-muted">{ok ? "Go back to the SafeRent app to finish your verification." : "Go back to the SafeRent app and try again."}</p>
      <p className="text-sm text-muted">You can close this page.</p>
    </div>
  );
}
