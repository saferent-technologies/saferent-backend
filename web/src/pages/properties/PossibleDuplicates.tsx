import { AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { Link } from "react-router";
import { Alert } from "@/components/ui/Alert";
import { AuthImage } from "@/components/ui/AuthImage";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useQuery } from "@/hooks/useQuery";
import { usePortal } from "@/routes/portal";
import { request } from "@/services/api";
import { formatDate } from "@/utils/format";
import { imagePath } from "./types";

interface NearbyProperty {
  id: string;
  code: string;
  title: string | null;
  name: string | null;
  propertyTypeLabel: string;
  address: string;
  distanceMeters: number;
  sameOwner: boolean;
  owner: { id: string; fullName: string; phoneNumber: string | null } | null;
  publicationStatus: string;
  activeStatus: string;
  coverImageId: string | null;
  createdAt: string;
}

interface Response {
  located: boolean;
  radiusMeters: number;
  items: NearbyProperty[];
}

/** Reviewer panel: other properties pinned within 40 m of this one. Open them, compare, then approve or reject. */
export function PossibleDuplicates({ propertyId }: { propertyId: string }) {
  const { data, loading, error } = useQuery(() => request<Response>(`/properties/${propertyId}/possible-duplicates`), [propertyId]);
  const { path } = usePortal();

  if (loading && !data) return <section className="card mb-4 flex justify-center p-5"><Spinner className="size-5 text-brand" /></section>;
  if (error) return <Alert kind="error" className="mb-4">{error}</Alert>;
  if (!data) return null;
  if (!data.located) return <Alert kind="info" className="mb-4">Duplicate check: this property has no map location, so nearby properties can't be checked.</Alert>;
  if (!data.items.length)
    return (
      <p className="card mb-4 flex items-center gap-2 p-4 text-sm text-muted">
        <CheckCircle2 className="size-4 text-success" /> No other property within {data.radiusMeters} m — no duplicates found.
      </p>
    );

  return (
    <section className="card mb-4 border-warning/40 p-5">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
        <AlertTriangle className="size-5 text-warning" /> Maybe a duplicate
        <Badge tone="warning">{data.items.length}</Badge>
      </h2>
      <p className="mb-3 text-sm text-muted">
        {data.items.length === 1 ? "Another property is" : `${data.items.length} properties are`} pinned within {data.radiusMeters} m of this one. Open and compare before you approve or reject.
      </p>
      <ul className="divide-y divide-line">
        {data.items.map((d) => (
          <li key={d.id} className="flex gap-3 py-3">
            {d.coverImageId ? (
              <AuthImage path={imagePath(d.coverImageId)} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="size-16 shrink-0 rounded-lg bg-subtle" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={path(`/properties/${d.id}`)} target="_blank" className="inline-flex items-center gap-1 truncate font-semibold hover:text-brand">
                  {d.title ?? d.name ?? d.code} <ExternalLink className="size-3.5" />
                </Link>
                <span className="text-xs text-muted">{d.code} · {d.propertyTypeLabel}</span>
                <Badge tone={d.distanceMeters <= 15 ? "danger" : "warning"}>{d.distanceMeters} m away</Badge>
                {d.sameOwner && <Badge tone="neutral">Same owner</Badge>}
                <StatusBadge status={d.publicationStatus} />
              </div>
              <p className="mt-1 truncate text-xs text-muted">{d.address || "—"}</p>
              <p className="mt-0.5 text-xs text-muted">
                Owner: {d.owner?.fullName ?? "—"}{d.owner?.phoneNumber ? ` · ${d.owner.phoneNumber}` : ""} · added {formatDate(d.createdAt)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
