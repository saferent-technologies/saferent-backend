import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { request } from "@/services/api";
import { errorMessage } from "@/utils/errors";

/** DigiLocker sends the owner back here (?id=…&success=True). We finish on the server, then go to /verify. */
export function DigiLockerReturnPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const id = params.get("id");
    if (!id) {
      setError("DigiLocker didn't return a session. Please start again.");
      return;
    }
    request("/kyc/digilocker/complete", { method: "POST", body: { id, success: params.get("success") ?? undefined, errMessage: params.get("errMessage") ?? undefined } })
      .then(() => navigate("/verify", { replace: true }))
      .catch((err) => setError(errorMessage(err)));
  }, [params, navigate]);

  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      {error ? (
        <>
          <Alert kind="error">{error}</Alert>
          <Button onClick={() => navigate("/verify", { replace: true })}>Back to verification</Button>
        </>
      ) : (
        <>
          <Spinner className="mx-auto size-8 text-brand" />
          <p className="text-muted">Reading your DigiLocker details…</p>
        </>
      )}
    </div>
  );
}
