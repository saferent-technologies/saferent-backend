import { ImageOff } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchBlob } from "@/services/api";
import { cn } from "@/utils/cn";

/**
 * <img> for protected files. Browsers can't attach the Firebase token to a normal image request,
 * so the file is fetched with the token and shown from a temporary object URL.
 */
export function AuthImage({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setFailed(false);
    fetchBlob(path)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (failed) {
    return (
      <div className={cn("flex items-center justify-center bg-subtle text-muted", className)} role="img" aria-label={alt}>
        <ImageOff className="size-6" />
      </div>
    );
  }
  if (!src) return <div className={cn("animate-pulse bg-subtle", className)} aria-hidden />;
  return <img src={src} alt={alt} className={cn("object-cover", className)} />;
}
