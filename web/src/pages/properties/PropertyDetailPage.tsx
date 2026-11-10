import { ArrowLeft, CalendarPlus, Download, FileUp, Pencil, Send, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { AuthImage } from "@/components/ui/AuthImage";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Select } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Tabs } from "@/components/ui/Tabs";
import { UploadButton } from "@/components/ui/UploadButton";
import { useQuery } from "@/hooks/useQuery";
import { fetchBlob, request } from "@/services/api";
import { errorMessage } from "@/utils/errors";
import { formatDate, formatMoney, formatTimestamp, labelize } from "@/utils/format";
import { imagePath, type PropertyDetail } from "./types";

interface DetailResponse {
  property: PropertyDetail;
  can: { manage: boolean; approve: boolean; verifyDocuments: boolean; assign: boolean; inspect: boolean };
}

type Tab = "overview" | "photos" | "documents" | "team" | "inspections";

export function PropertyDetailPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>(params.get("created") ? "photos" : ((params.get("tab") as Tab | null) ?? "overview"));
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(params.get("created") ? { kind: "success", text: "Draft saved. Add photos, then submit it for review." } : null);
  const { data, loading, error, reload } = useQuery(() => request<DetailResponse>(`/properties/${id}`), [id]);
  const { confirm, dialog } = useConfirm();

  if (loading && !data) return <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>;
  if (error || !data) return <Alert kind="error">{error ?? "Property not found."}</Alert>;
  const p = data.property;
  const can = data.can;
  const done = (text: string) => async () => {
    setMsg({ kind: "success", text });
    await reload();
  };
  const fail = (text: string) => setMsg({ kind: "error", text });

  const post = async (path: string, body: unknown, success: string) => {
    try {
      await request(path, { method: "POST", body });
      await done(success)();
    } catch (err) {
      fail(errorMessage(err));
    }
  };

  const tabs: Array<{ value: Tab; label: string }> = [
    { value: "overview", label: "Overview" },
    { value: "photos", label: `Photos (${p.images.length})` },
    ...(can.manage || can.verifyDocuments ? [{ value: "documents" as Tab, label: "Documents" }] : []),
    ...(can.assign || p.assignments.length ? [{ value: "team" as Tab, label: "Team" }] : []),
    ...(can.inspect || p.inspections.length ? [{ value: "inspections" as Tab, label: "Inspections" }] : []),
  ];

  return (
    <>
      <Link to="/properties" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-dark hover:text-brand">
        <ArrowLeft className="size-4" /> Properties
      </Link>
      <PageHeader
        title={p.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={p.status} />
            {p.verified && <Badge tone="success">Verified owner</Badge>}
            <span>{[p.locality, p.city].filter(Boolean).join(", ")}</span>
          </span>
        }
        actions={
          <>
            {can.manage && (
              <Button variant="secondary" leftIcon={<Pencil className="size-4" />} onClick={() => navigate(`/properties/${p.id}/edit`)}>
                Edit
              </Button>
            )}
            {can.manage && ["DRAFT", "REJECTED", "INACTIVE"].includes(p.status) && (
              <Button leftIcon={<Send className="size-4" />} onClick={() => void post(`/properties/${p.id}/submit`, {}, "Submitted for review. You'll be notified when it's live.")}>
                Submit for review
              </Button>
            )}
            {can.approve && p.status === "PENDING_REVIEW" && (
              <>
                <Button onClick={() => confirm({ title: "Approve listing", message: "The listing and its pending photos become visible to tenants.", confirmLabel: "Approve", onConfirm: async () => { await request(`/moderation/listings/${p.id}`, { method: "POST", body: { decision: "APPROVE" } }); await done("Listing approved.")(); } })}>
                  Approve
                </Button>
                <Button variant="danger" onClick={() => confirm({ title: "Reject listing", message: "Tell the owner what to fix.", tone: "danger", confirmLabel: "Reject", reason: { label: "Reason", required: true, minLength: 5 }, onConfirm: async (reason) => { await request(`/moderation/listings/${p.id}`, { method: "POST", body: { decision: "REJECT", note: reason } }); await done("Listing rejected.")(); } })}>
                  Reject
                </Button>
              </>
            )}
          </>
        }
      />
      {msg && <Alert kind={msg.kind} className="mb-4">{msg.text}</Alert>}
      {p.status === "REJECTED" && p.moderationNote && <Alert kind="warning" title="Changes requested" className="mb-4">{p.moderationNote}</Alert>}

      <Tabs<Tab> idPrefix="prop" className="mb-5 max-w-3xl" value={tab} onChange={setTab} items={tabs} />

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="card p-5 sm:p-6 lg:col-span-2">
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <Item label="Monthly rent" value={formatMoney(p.monthlyRent)} />
              <Item label="Security deposit" value={formatMoney(p.securityDeposit)} />
              <Item label="Type" value={labelize(p.propertyType)} />
              <Item label="Furnishing" value={labelize(p.furnishing)} />
              <Item label="Bedrooms / bathrooms" value={`${p.bedrooms} / ${p.bathrooms}`} />
              <Item label="Area" value={p.areaSqft ? `${p.areaSqft} sq ft` : "—"} />
              <Item label="Address" value={[p.addressLine, p.locality, p.city, p.state, p.pincode].filter(Boolean).join(", ")} />
              <Item label="Owner" value={p.owner?.fullName ?? "—"} />
              <Item label="Available from" value={formatDate(p.availableFrom)} />
              <Item label="Pending applications" value={String(p._count?.applications ?? 0)} />
            </dl>
            <h3 className="mb-1 mt-6 text-sm font-semibold">Description</h3>
            <p className="whitespace-pre-line text-sm text-ink-2">{p.description}</p>
          </section>
          {can.manage && (
            <section className="card space-y-3 p-5 sm:p-6">
              <h3 className="font-semibold">Availability</h3>
              <p className="text-sm text-muted">{p.isAvailable ? "Shown to tenants as available." : "Hidden from search."}</p>
              <Button variant="secondary" fullWidth onClick={() => void post(`/properties/${p.id}/availability`, { isAvailable: !p.isAvailable }, "Availability updated.")}>
                Mark as {p.isAvailable ? "unavailable" : "available"}
              </Button>
              {p.status !== "INACTIVE" && (
                <Button variant="ghost" fullWidth onClick={() => confirm({ title: "Deactivate property", message: "The listing is removed from search. You can resubmit it later.", tone: "danger", confirmLabel: "Deactivate", onConfirm: async () => { await request(`/properties/${p.id}/deactivate`, { method: "POST" }); await done("Property deactivated.")(); } })}>
                  Deactivate listing
                </Button>
              )}
            </section>
          )}
        </div>
      )}

      {tab === "photos" && (
        <section className="card p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">JPG, PNG or WebP up to 5 MB. New photos are reviewed before tenants see them.</p>
            {can.manage && <UploadButton path={`/properties/${p.id}/images`} label="Add photos" onDone={done("Photos uploaded.")} onError={fail} />}
          </div>
          {p.images.length === 0 ? (
            <p className="text-sm text-muted">No photos yet.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {p.images.map((img) => (
                <li key={img.id} className="relative overflow-hidden rounded-control border border-line">
                  <AuthImage path={imagePath(img.id)} alt="Property photo" className="aspect-[4/3] w-full" />
                  <span className="absolute left-2 top-2"><StatusBadge status={img.status} /></span>
                  {can.manage && (
                    <button type="button" aria-label="Delete photo" onClick={() => confirm({ title: "Delete photo", message: "This photo will be removed permanently.", tone: "danger", confirmLabel: "Delete", onConfirm: async () => { await request(`/properties/${p.id}/images/${img.id}`, { method: "DELETE" }); await done("Photo deleted.")(); } })} className="absolute right-2 top-2 flex size-9 items-center justify-center rounded-lg bg-surface/90 text-danger shadow-sm hover:bg-surface">
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "documents" && <DocumentsTab property={p} canUpload={can.manage} canVerify={can.verifyDocuments} onDone={done} onError={fail} />}
      {tab === "team" && <TeamTab property={p} canAssign={can.assign} onDone={done} />}
      {tab === "inspections" && <InspectionsTab property={p} canInspect={can.inspect} onDone={done} />}
      {dialog}
    </>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}

const DOC_TYPES = ["OWNERSHIP_DEED", "TAX_RECEIPT", "UTILITY_BILL", "ID_PROOF", "OTHER"];

function DocumentsTab({ property, canUpload, canVerify, onDone, onError }: { property: PropertyDetail; canUpload: boolean; canVerify: boolean; onDone: (t: string) => () => Promise<void>; onError: (t: string) => void }) {
  const [docType, setDocType] = useState("OWNERSHIP_DEED");
  const { confirm, dialog } = useConfirm();

  const download = async (doc: { id: string; originalName: string }) => {
    try {
      const blob = await fetchBlob(`/files/documents/${doc.id}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.originalName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  const verify = (docId: string, status: "APPROVED" | "REJECTED") =>
    confirm({
      title: status === "APPROVED" ? "Verify document" : "Reject document",
      message: status === "APPROVED" ? "Mark this document as verified." : "Tell the owner what's wrong.",
      tone: status === "APPROVED" ? "primary" : "danger",
      confirmLabel: status === "APPROVED" ? "Verify" : "Reject",
      reason: status === "REJECTED" ? { label: "Note to owner", required: true, minLength: 5 } : undefined,
      onConfirm: async (note) => {
        await request(`/documents/${docId}/verify`, { method: "POST", body: { status, note: note || undefined } });
        await onDone("Document updated.")();
      },
    });

  return (
    <section className="card p-5 sm:p-6">
      <p className="mb-4 text-sm text-muted">Ownership documents are private: only the owner, assigned managers and verifiers can open them.</p>
      {canUpload && (
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="sm:w-60">
            <Select label="Document type" options={DOC_TYPES.map((d) => ({ value: d, label: labelize(d) }))} value={docType} onChange={(e) => setDocType(e.target.value)} />
          </div>
          <UploadButton path={`/properties/${property.id}/documents`} field="file" multiple={false} accept="application/pdf,image/jpeg,image/png,image/webp" extra={{ docType }} label="Upload document" icon={<FileUp className="size-4" />} onDone={onDone("Document uploaded.")} onError={onError} />
        </div>
      )}
      <ul className="divide-y divide-line">
        {property.documents.map((d) => (
          <li key={d.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate font-medium">{d.originalName}</p>
              <p className="text-xs text-muted">{labelize(d.docType)} · {formatDate(d.createdAt)}{d.note ? ` · ${d.note}` : ""}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={d.status} />
              <Button size="sm" variant="ghost" leftIcon={<Download className="size-4" />} onClick={() => void download(d)}>Open</Button>
              {canVerify && d.status === "PENDING" && (
                <>
                  <Button size="sm" onClick={() => verify(d.id, "APPROVED")}>Verify</Button>
                  <Button size="sm" variant="secondary" onClick={() => verify(d.id, "REJECTED")}>Reject</Button>
                </>
              )}
            </div>
          </li>
        ))}
        {property.documents.length === 0 && <li className="py-3 text-sm text-muted">No documents uploaded.</li>}
      </ul>
      {dialog}
    </section>
  );
}

function TeamTab({ property, canAssign, onDone }: { property: PropertyDetail; canAssign: boolean; onDone: (t: string) => () => Promise<void> }) {
  const [type, setType] = useState<"MANAGER" | "AGENT">("MANAGER");
  const [userId, setUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const role = type === "MANAGER" ? "PROPERTY_MANAGER" : "PROPERTY_AGENT";
  const { data } = useQuery(() => request<{ items: Array<{ id: string; fullName: string }> }>("/users/lookup", { query: { role } }), [role], canAssign);
  const { confirm, dialog } = useConfirm();

  const add = async () => {
    setError(null);
    try {
      await request(`/properties/${property.id}/assignments`, { method: "POST", body: { userId, type } });
      setUserId("");
      await onDone("Assignment added.")();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <section className="card p-5 sm:p-6">
      <p className="mb-4 text-sm text-muted">Property managers and agents can only access properties assigned to them.</p>
      {canAssign && (
        <div className="mb-5 grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
          <Select label="Type" options={[{ value: "MANAGER", label: "Manager" }, { value: "AGENT", label: "Agent" }]} value={type} onChange={(e) => setType(e.target.value as "MANAGER" | "AGENT")} />
          <Select label="Person" placeholder="Choose…" options={(data?.items ?? []).map((u) => ({ value: u.id, label: u.fullName }))} value={userId} onChange={(e) => setUserId(e.target.value)} />
          <Button leftIcon={<UserPlus className="size-4" />} disabled={!userId} onClick={() => void add()}>Assign</Button>
        </div>
      )}
      {error && <Alert kind="error" className="mb-3">{error}</Alert>}
      <ul className="divide-y divide-line">
        {property.assignments.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3 py-3">
            <span>
              <span className="font-medium">{a.user.fullName}</span> <Badge tone="brand">{a.type === "MANAGER" ? "Manager" : "Agent"}</Badge>
            </span>
            {canAssign && (
              <Button size="sm" variant="ghost" onClick={() => confirm({ title: "Remove assignment", message: `${a.user.fullName} will lose access to this property.`, tone: "danger", confirmLabel: "Remove", onConfirm: async () => { await request(`/properties/${property.id}/assignments/${a.id}`, { method: "DELETE" }); await onDone("Assignment removed.")(); } })}>
                Remove
              </Button>
            )}
          </li>
        ))}
        {property.assignments.length === 0 && <li className="py-3 text-sm text-muted">Nobody is assigned yet.</li>}
      </ul>
      {dialog}
    </section>
  );
}

function InspectionsTab({ property, canInspect, onDone }: { property: PropertyDetail; canInspect: boolean; onDone: (t: string) => () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const schedule = async () => {
    setError(null);
    try {
      await request(`/properties/${property.id}/inspections`, { method: "POST", body: { scheduledAt: new Date(when).toISOString() } });
      setOpen(false);
      await onDone("Inspection scheduled.")();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const complete = (inspectionId: string, result: "PASSED" | "NEEDS_REPAIRS" | "FAILED") =>
    confirm({
      title: `Record result: ${labelize(result)}`,
      message: "Add inspection notes.",
      confirmLabel: "Save",
      reason: { label: "Notes", required: false },
      onConfirm: async (notes) => {
        await request(`/properties/${property.id}/inspections/${inspectionId}`, { method: "PATCH", body: { status: "COMPLETED", result, notes: notes || undefined } });
        await onDone("Inspection recorded.")();
      },
    });

  return (
    <section className="card p-5 sm:p-6">
      {canInspect && (
        <div className="mb-4 flex justify-end">
          <Button leftIcon={<CalendarPlus className="size-4" />} onClick={() => setOpen(true)}>Schedule inspection</Button>
        </div>
      )}
      <ul className="divide-y divide-line">
        {property.inspections.map((i) => (
          <li key={i.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">{formatTimestamp(i.scheduledAt)}</p>
              <p className="text-xs text-muted">{i.result ? labelize(i.result) : ""}{i.notes ? ` · ${i.notes}` : ""}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={i.status} />
              {canInspect && i.status === "SCHEDULED" && (
                <>
                  <Button size="sm" onClick={() => complete(i.id, "PASSED")}>Passed</Button>
                  <Button size="sm" variant="secondary" onClick={() => complete(i.id, "NEEDS_REPAIRS")}>Needs repairs</Button>
                  <Button size="sm" variant="ghost" onClick={() => complete(i.id, "FAILED")}>Failed</Button>
                </>
              )}
            </div>
          </li>
        ))}
        {property.inspections.length === 0 && <li className="py-3 text-sm text-muted">No inspections yet.</li>}
      </ul>
      <Modal open={open} onClose={() => setOpen(false)} title="Schedule inspection">
        {error && <Alert kind="error" className="mb-3">{error}</Alert>}
        <Input label="Date and time" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!when} onClick={() => void schedule()}>Schedule</Button>
        </div>
      </Modal>
      {dialog}
    </section>
  );
}
