import { VideoOff } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchBlob } from "@/services/api";
import { cn } from "@/utils/cn";

/** <video> for protected files: fetched with the sign-in token, played from a temporary object URL. */
export function AuthVideo({ path, poster, className }: { path: string; poster?: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setFailed(false);
    setSrc(null);
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
      <div className={cn("flex items-center justify-center bg-subtle text-muted", className)} role="img" aria-label="Video not available">
        <VideoOff className="size-6" />
      </div>
    );
  }
  if (!src) return <div className={cn("animate-pulse bg-subtle", className)} />;
  return <video src={src} poster={poster} controls playsInline preload="metadata" className={cn("bg-ink", className)} />;
}
