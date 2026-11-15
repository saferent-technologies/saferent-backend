import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { DataTable, Pagination } from "@/components/data/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { AuthImage } from "@/components/ui/AuthImage";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Spinner";
import { useListParams } from "@/hooks/useListParams";
import { useQuery } from "@/hooks/useQuery";
import { usePortal } from "@/routes/portal";
import { request } from "@/services/api";
import type { Paged } from "@/types/auth";
import { errorMessage } from "@/utils/errors";
import { formatTimestamp, labelize } from "@/utils/format";
import { sectionLabel } from "../properties/PropertyDetailPage";
import { imagePath, type PendingRevision, type PropertyDetail, type PropertySummary } from "../properties/types";

type RevisionRow = PendingRevision & { property: (PropertySummary & { owner?: { fullName: string } | null }) | null };

/** Moderation → Changes: edits to live listings waiting for verification. */
export function ChangesTab() {
  const list = useListParams([]);
  const navigate = useNavigate();
  const { path } = usePortal();
  const { data, loading, error } = useQuery(() => request<Paged<RevisionRow>>("/admin/property-revisions", { query: { ...list.query, status: "PENDING_VERIFICATION" } }), [list.query]);
  return (
    <>
      {error && <Alert kind="error">{error}</Alert>}
      <DataTable
        rows={data?.items}
        loading={loading}
        error={null}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(path(`/moderation/changes/${r.id}`))}
        empty="No changes waiting for verification. 🎉"
        columns={[
          { key: "property", header: "Property", render: (r) => <span><span className="block font-semibold">{r.property?.title ?? r.property?.code ?? "—"}</span><span className="text-xs text-muted">{r.property?.code} · {r.property?.city ?? ""}</span></span> },
          { key: "owner", header: "Owner", render: (r) => r.property?.owner?.fullName ?? "—" },
          { key: "changed", header: "Changed", render: (r) => <span className="flex flex-wrap gap-1">{r.changedSections.map((s) => <Badge key={s}>{sectionLabel(s)}</Badge>)}</span> },
          { key: "sent", header: "Sent", render: (r) => formatTimestamp(r.submittedAt), className: "hidden lg:table-cell" },
          { key: "go", header: "", className: "text-right", render: () => <Button size="sm">Review</Button> },
        ]}
      />
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={list.setPage} />}
    </>
  );
}

interface RevisionDetail {
  revision: PendingRevision;
  live: PropertyDetail;
  changed: PropertyDetail | null;
  changedSections: string[];
  owner: { id: string; fullName: string; phoneNumber: string | null } | null;
}

const SKIP = new Set(["id", "propertyId", "unitId", "scopeKey", "updatedAt", "createdAt", "version", "code", "sourceId", "pricingId", "breakdown", "imageIds", "attributes"]);
const show = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.map(show).join(", ") : typeof v === "object" ? JSON.stringify(v) : labelize(String(v)) === String(v) ? String(v) : String(v));

function flat(obj: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (SKIP.has(k)) continue;
    const key = prefix ? `${prefix} · ${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flat(v, key));
    else if (Array.isArray(v) && v.some((x) => x && typeof x === "object")) v.forEach((x, i) => Object.assign(out, flat(x, `${key} ${i + 1}`)));
    else out[key] = show(v);
  }
  return out;
}

/** The comparable values of one section of a listing. */
function sectionValues(p: PropertyDetail, section: string): Record<string, string> {
  const any = p as unknown as Record<string, unknown>;
  switch (section) {
    case "basic":
      return { Title: show(p.title), Description: show(any.description), "Listing type": show(p.listingType) };
    case "location":
      return { Address: show(any.addressLine), Locality: show(p.locality), City: show(p.city), State: show(p.state), "PIN code": show(any.pincode), "Map pin": `${show(any.latitude)}, ${show(any.longitude)}` };
    case "building":
      return flat(any.building);
    case "units":
      return Object.fromEntries(
        p.units.map((u) => {
          const x = u as unknown as Record<string, unknown>;
          const label = `${p.type?.unitLabel ?? "Unit"} ${show(x.unitNumber ?? x.name)}`;
          const rent = (x.pricing as { monthlyRent?: string } | null)?.monthlyRent;
          return [label, [x.bhkType ?? (x.attributes as Record<string, unknown> | null)?.bhkType, x.bedrooms && `${x.bedrooms} bed`, x.bathrooms && `${x.bathrooms} bath`, x.furnishing && labelize(String(x.furnishing)), x.floorNumber !== null && x.floorNumber !== undefined && `floor ${x.floorNumber}`, rent && `₹${rent}`, labelize(String(x.availabilityStatus))].filter(Boolean).join(" · ")];
        }),
      );
    case "rooms":
      return Object.fromEntries(
        (any.rooms as Array<Record<string, unknown>>).map((r) => [`Room ${show(r.roomNumber)}`, [labelize(String(r.sharingType)), `${r.bedCount ?? 0} beds`, r.rentPerBed && `₹${r.rentPerBed}/bed`].filter(Boolean).join(" · ")]),
      );
    case "pricing":
      return flat(any.pricing);
    case "utilities":
      return flat(any.utilities);
    case "policies":
      return flat(any.policy);
    case "amenities":
      return Object.fromEntries((any.amenities as Array<{ label: string; status: string }>).map((a) => [a.label, labelize(a.status)]));
    default:
      return {};
  }
}

function SectionDiff({ section, live, changed }: { section: string; live: PropertyDetail; changed: PropertyDetail }) {
  if (section === "photos") {
    const photos = (p: PropertyDetail) => (p as unknown as { images: Array<{ id: string; category: string; inspectionId?: string | null }> }).images.filter((i) => !i.inspectionId);
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {[["Live", live], ["Changed", changed]].map(([label, p]) => (
          <div key={label as string}>
            <p className="mb-2 text-xs font-semibold text-muted">{label as string} · {photos(p as PropertyDetail).length} photos</p>
            <div className="grid grid-cols-3 gap-2">
              {photos(p as PropertyDetail).map((i) => (
                <figure key={i.id}>
                  <AuthImage path={imagePath(i.id)} alt="" className="aspect-[4/3] w-full rounded-lg object-cover" />
                  <figcaption className="mt-0.5 truncate text-[11px] text-muted">{labelize(i.category)}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  const a = sectionValues(live, section);
  const b = sectionValues(changed, section);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="w-48 py-2 pr-3 font-semibold">Field</th>
            <th className="py-2 pr-3 font-semibold">Live</th>
            <th className="py-2 font-semibold">Changed</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const before = a[k] ?? "— (not there)";
            const after = b[k] ?? "— (removed)";
            const diff = before !== after;
            return (
              <tr key={k} className={`border-b border-line align-top ${diff ? "bg-warning/5" : ""}`}>
                <td className="py-2 pr-3 text-xs font-semibold text-muted">{labelize(k)}</td>
                <td className={`whitespace-pre-wrap py-2 pr-3 ${diff ? "text-muted line-through decoration-danger/60" : ""}`}>{before}</td>
                <td className={`whitespace-pre-wrap py-2 ${diff ? "font-semibold text-ink" : ""}`}>{after}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** /moderation/changes/:revisionId — live listing vs changed listing, approve or reject. */
export function PropertyChangeReviewPage() {
  const { revisionId = "" } = useParams();
  const navigate = useNavigate();
  const { path } = usePortal();
  const { data, loading, error } = useQuery(() => request<RevisionDetail>(`/admin/property-revisions/${revisionId}`), [revisionId]);
  const { confirm, dialog } = useConfirm();
  const [msg, setMsg] = useState<string | null>(null);

  if (loading && !data) return <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>;
  if (error || !data) return <Alert kind="error">{error ?? "Change request not found."}</Alert>;
  const { revision, live, changed, changedSections } = data;
  const pending = revision.status === "PENDING_VERIFICATION";
  const back = () => navigate(path("/moderation?tab=changes"));

  const decide = (decision: "APPROVE" | "REJECT") =>
    confirm({
      title: decision === "APPROVE" ? "Approve changes" : "Reject changes",
      message: decision === "APPROVE" ? "The live listing is updated with these changes right away. Active leases are not affected." : "The owner sees your note and can fix the changes. The live listing stays as it is.",
      tone: decision === "APPROVE" ? "primary" : "danger",
      confirmLabel: decision === "APPROVE" ? "Approve" : "Reject",
      reason: decision === "REJECT" ? { label: "What should the owner fix?", required: true, minLength: 5 } : undefined,
      onConfirm: async (reason) => {
        try {
          await request(`/admin/property-revisions/${revision.id}/review`, { method: "POST", body: { decision, reason: reason || undefined } });
          back();
        } catch (e) {
          setMsg(errorMessage(e));
          throw e;
        }
      },
    });

  return (
    <>
      <Link to={path("/moderation?tab=changes")} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-dark hover:text-brand">
        <ArrowLeft className="size-4" /> Changes
      </Link>
      <PageHeader
        title={`Changes to ${live.title ?? live.code}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link to={path(`/properties/${live.id}`)} className="font-semibold hover:text-brand">{live.code}</Link>
            <span>· Owner: {data.owner?.fullName ?? "—"}</span>
            <span>· Sent {formatTimestamp(revision.submittedAt)}</span>
            <Badge tone={pending ? "brand" : "neutral"}>{labelize(revision.status)}</Badge>
          </span>
        }
        actions={
          pending && (
            <>
              <Button variant="danger" leftIcon={<XCircle className="size-4" />} onClick={() => decide("REJECT")}>Reject</Button>
              <Button leftIcon={<CheckCircle2 className="size-4" />} onClick={() => decide("APPROVE")}>Approve changes</Button>
            </>
          )
        }
      />
      {msg && <Alert kind="error" className="mb-4">{msg}</Alert>}
      {!changed && <Alert kind="info">The changed listing is no longer available.</Alert>}
      {changed && changedSections.length === 0 && <Alert kind="info">No differences found.</Alert>}
      {changed &&
        changedSections.map((s) => (
          <section key={s} className="card mb-4 p-5">
            <h2 className="mb-3 font-semibold">{sectionLabel(s)}</h2>
            <SectionDiff section={s} live={live} changed={changed} />
          </section>
        ))}
      {dialog}
    </>
  );
}
