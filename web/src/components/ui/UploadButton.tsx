import { Upload } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { upload } from "@/services/api";
import { errorMessage } from "@/utils/errors";
import { Button } from "./Button";

const MAX_BYTES = 5 * 1024 * 1024;

/** File picker that uploads straight to an API endpoint (multipart). */
export function UploadButton({
  path,
  field = "files",
  accept = "image/jpeg,image/png,image/webp",
  multiple = true,
  extra,
  label = "Upload",
  icon,
  onDone,
  onError,
}: {
  path: string;
  field?: string;
  accept?: string;
  multiple?: boolean;
  extra?: Record<string, string>;
  label?: string;
  icon?: ReactNode;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onChange = async (files: FileList | null) => {
    if (!files?.length) return;
    const tooBig = Array.from(files).find((f) => f.size > MAX_BYTES);
    if (tooBig) {
      onError(`${tooBig.name} is larger than 5 MB.`);
      return;
    }
    const form = new FormData();
    Array.from(files).forEach((f) => form.append(field, f));
    for (const [k, v] of Object.entries(extra ?? {})) form.append(k, v);
    setBusy(true);
    try {
      await upload(path, form);
      onDone();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <>
      <input ref={input} type="file" hidden accept={accept} multiple={multiple} onChange={(e) => void onChange(e.target.files)} />
      <Button variant="secondary" size="sm" loading={busy} leftIcon={icon ?? <Upload className="size-4" />} onClick={() => input.current?.click()}>
        {label}
      </Button>
    </>
  );
}
