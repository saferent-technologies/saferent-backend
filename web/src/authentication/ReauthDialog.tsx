import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { useAuth } from "@/hooks/useAuth";
import { errorMessage } from "@/utils/errors";
import { reauthSchema, type ReauthValues } from "@/validations/auth.schemas";

/** Asks for the current password before a sensitive change (Firebase re-authentication). */
export function ReauthDialog({ open, onClose, onConfirmed }: { open: boolean; onClose: () => void; onConfirmed: () => void | Promise<void> }) {
  const { reauthenticate } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ReauthValues>({ resolver: zodResolver(reauthSchema), defaultValues: { password: "" } });

  const close = () => {
    reset();
    setError(null);
    onClose();
  };

  const onSubmit = handleSubmit(async ({ password }) => {
    setError(null);
    try {
      await reauthenticate(password);
      reset();
      onClose();
      await onConfirmed();
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <Modal open={open} onClose={close} title="Confirm it's you" description="For your security, enter your current password to continue.">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <PasswordInput label="Current password" autoComplete="current-password" autoFocus error={errors.password?.message} {...register("password")} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting}>
            Confirm
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Small helper: run `action` only after the user re-confirms their password. */
export function useReauthGate() {
  const [pending, setPending] = useState<null | (() => void | Promise<void>)>(null);
  return {
    requireReauth: (action: () => void | Promise<void>) => setPending(() => action),
    dialog: <ReauthDialog open={pending !== null} onClose={() => setPending(null)} onConfirmed={() => pending?.()} />,
  };
}
