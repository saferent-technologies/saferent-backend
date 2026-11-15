import { Building2 } from "lucide-react";
import { useState } from "react";
import { API_URL } from "@/firebase/config";
import { cn } from "@/utils/cn";
import { AuthImage } from "./AuthImage";

/** Public photo URL (approved photos of published listings; no login, cacheable). */
export const publicImageUrl = (imageId: string) => `${API_URL}/api/v1/public/images/${imageId}`;

/**
 * Listing photo. On the public website it is a plain cacheable <img>; inside the app it goes
 * through the signed-in file endpoint (AuthImage).
 */
export function ListingPhoto({ imageId, alt, className, isPublic }: { imageId: string; alt: string; className?: string; isPublic: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!isPublic) return <AuthImage path={`/files/property-images/${imageId}`} alt={alt} className={className} />;
  if (failed) {
    return (
      <div className={cn("flex items-center justify-center bg-brand-bg text-brand", className)} role="img" aria-label={alt}>
        <Building2 className="size-10" />
      </div>
    );
  }
  return <img src={publicImageUrl(imageId)} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className={cn("bg-subtle object-cover", className)} />;
}
