import { useState, type ReactNode } from "react";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { Textarea } from "./Field";
import { errorMessage } from "@/utils/errors";

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  /** Ask for a reason (passed to onConfirm). */
  reason?: { label: string; required?: boolean; minLength?: number };
  onConfirm: (reason: string) => Promise<unknown> | unknown;
}

/** useConfirm(): returns `confirm(options)` + the dialog element to render once. */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setOptions(null);
    setReason("");
    setError(null);
  };

  const run = async () => {
    if (!options) return;
    const min = options.reason?.minLength ?? (options.reason?.required ? 1 : 0);
    if (options.reason && reason.trim().length < min) {
      setError(min > 1 ? `Please enter at least ${min} characters.` : "This field is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await options.onConfirm(reason.trim());
      setOptions(null);
      setReason("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const dialog = (
    <Modal open={options !== null} onClose={close} title={options?.title ?? ""}>
      <div className="space-y-4">
        <div className="text-sm text-ink-2">{options?.message}</div>
        {options?.reason && <Textarea label={options.reason.label} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}
        {error && <Alert kind="error">{error}</Alert>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant={options?.tone === "danger" ? "danger" : "primary"} onClick={() => void run()} loading={busy}>
            {options?.confirmLabel ?? "Confirm"}
          </Button>
        </div>
      </div>
    </Modal>
  );

  return { confirm: (o: ConfirmOptions) => setOptions(o), dialog };
}
