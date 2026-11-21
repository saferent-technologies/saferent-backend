import { QrCode } from "lucide-react";
import { useParams } from "react-router";

/**
 * A SafeRent property QR opened in a browser (the app normally opens /p/… itself via App Links).
 * No sign-in, nothing is loaded: it only says what to do.
 */
export function QrLandingPage() {
  const { code = "", unit } = useParams();
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <QrCode className="size-12 text-brand" aria-hidden />
      <h1 className="text-xl font-bold text-ink">SafeRent property {code}{unit ? ` · ${unit}` : ""}</h1>
      <p className="text-muted">Open this with the SafeRent app to see the listing, book a visit, or — if you live here — raise a request and see emergency numbers.</p>
      <p className="text-sm text-muted">Don't have the app? Search "SafeRent" on Google Play.</p>
    </div>
  );
}
