import { Archive, ArrowLeft, CalendarPlus, CheckCircle2, Eye, EyeOff, Pencil, Power, Send, ShieldAlert, Trash2, UserPlus, XCircle } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Pagination } from "@/components/data/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/hooks/useAuth";
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
import { request } from "@/services/api";
import type { Paged } from "@/types/auth";
import { errorMessage } from "@/utils/errors";
import { formatDate, formatMoney, formatTimestamp, labelize } from "@/utils/format";
import { CompletenessMeter, CostBreakdownView, Facts, ValueText } from "./components";
import { InvitationsTab, InviteTenantModal } from "./TenantInvites";
import { PropertyDocumentsTab } from "./PropertyDocuments";
import { PropertyReviewsTab } from "@/pages/reviews/ReviewsPages";
import { imagePath, rentRange, type PropertyCan, type PropertyDetail } from "./types";

type Tab = "overview" | "units" | "tenants" | "reviews" | "details" | "photos" | "documents" | "inspections" | "team" | "history";

export function PropertyDetailPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const { can: hasPermission } = useAuth();
  const { data, loading, error, reload } = useQuery(() => request<{ property: PropertyDetail; can: PropertyCan }>(`/properties/${id}`), [id]);
  const { confirm, dialog } = useConfirm();
  const tab = (params.get("tab") as Tab | null) ?? "overview";
  const [invite, setInvite] = useState<{ target?: string } | null>(null);
  const [invitesKey, setInvitesKey] = useState(0);

  if (loading && !data) return <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>;
  if (error || !data) return <Alert kind="error">{error ?? "Property not found."}</Alert>;
  const p = data.property;
  const can = data.can;
  // The tenant view (/browse/:id) needs properties.browse; owners and staff have it.
  const canPreview = hasPermission("properties.browse");
  const done = (text: string) => async () => {
    setMsg({ kind: "success", text });
    await reload();
  };
  const fail = (text: string) => setMsg({ kind: "error", text });
  const act = (path: string, body: unknown, success: string) => async (reason?: string) => {
    await request(path, { method: "POST", body: typeof body === "function" ? (body as (r?: string) => unknown)(reason) : body });
    await done(success)();
  };
  const structure = p.structure;
  const unitLabel = p.type?.unitLabel ?? "Unit";

  const tabs: Array<{ value: Tab; label: string }> = [
    { value: "overview", label: "Overview" },
    { value: "units", label: structure === "ROOMS_BEDS" ? `Rooms (${p.rooms.length})` : `${unitLabel}s (${p.units.length})` },
    ...(can.manage ? [{ value: "tenants" as Tab, label: "Tenant invites" }] : []),
    { value: "reviews", label: "Reviews" },
    { value: "details", label: "Utilities & terms" },
    { value: "photos", label: `Photos (${p.images.filter((i) => !i.inspectionId).length})` },
    ...(can.manage || can.verifyDocuments ? [{ value: "documents" as Tab, label: "Documents" }] : []),
    { value: "inspections", label: "Inspections" },
    ...(can.assign || p.assignments.length ? [{ value: "team" as Tab, label: "Team" }] : []),
    { value: "history", label: "History" },
  ];

  const editable = can.manage && p.activeStatus !== "ARCHIVED" && p.publicationStatus !== "PENDING_VERIFICATION" && p.activeStatus !== "SUSPENDED";
  // A tenant who visited in person can be invited whether or not the listing is published.
  const canInvite = can.manage && p.activeStatus === "ACTIVE";
  const openInvite = (target?: string) => setInvite({ target });

  return (
    <>
      <Link to="/properties" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-dark hover:text-brand">
        <ArrowLeft className="size-4" /> Properties
      </Link>
      <PageHeader
        title={p.title ?? `${p.propertyTypeLabel} draft`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge>{p.code}</Badge>
            <StatusBadge status={p.publicationStatus} />
            {p.activeStatus !== "ACTIVE" && <StatusBadge status={p.activeStatus} />}
            {p.verificationStatus === "VERIFIED" && <Badge tone="success">Verified by SafeRent</Badge>}
            <span>{p.propertyTypeLabel} · {labelize(p.listingType)}{p.city ? ` · ${[p.locality, p.city].filter(Boolean).join(", ")}` : ""}</span>
          </span>
        }
        actions={
          <>
            {p.publicationStatus === "PUBLISHED" && p.activeStatus === "ACTIVE" && canPreview && (
              <Button variant="secondary" leftIcon={<Eye className="size-4" />} onClick={() => navigate(`/browse/${p.id}?preview=1`)}>Preview as tenant</Button>
            )}
            {canInvite && <Button variant="secondary" leftIcon={<UserPlus className="size-4" />} onClick={() => openInvite()}>Invite tenant</Button>}
            {editable && (
              <Button variant="secondary" leftIcon={<Pencil className="size-4" />} onClick={() => navigate(`/properties/${p.id}/edit?step=${p.publicationStatus === "DRAFT" ? Math.max(3, p.wizardStep) : 3}`)}>
                {p.publicationStatus === "DRAFT" ? "Continue draft" : "Edit"}
              </Button>
            )}
            {can.manage && p.publicationStatus === "DRAFT" && (
              <Button
                variant="ghost"
                leftIcon={<Trash2 className="size-4 text-danger" />}
                onClick={() =>
                  confirm({
                    title: "Delete draft",
                    message: "This draft and its photos and documents will be deleted permanently. This can't be undone.",
                    tone: "danger",
                    confirmLabel: "Delete",
                    onConfirm: async () => {
                      const res = await request<{ deleted?: boolean }>(`/properties/${p.id}`, { method: "DELETE" });
                      if (res.deleted) navigate("/properties", { replace: true });
                      else await done("This draft has activity, so it was archived instead.")();
                    },
                  })
                }
              >
                Delete draft
              </Button>
            )}
            {editable && ["DRAFT", "REJECTED"].includes(p.publicationStatus) && (
              <Button leftIcon={<Send className="size-4" />} onClick={() => navigate(`/properties/${p.id}/edit?step=12`)}>Submit for verification</Button>
            )}
            {(can.manage || can.review) && p.publicationStatus === "APPROVED" && p.activeStatus === "ACTIVE" && (
              <Button leftIcon={<Eye className="size-4" />} onClick={() => void act(`/properties/${p.id}/publish`, {}, "Published — tenants can now find it.")().catch((e) => fail(errorMessage(e)))}>Publish</Button>
            )}
            {(can.manage || can.review) && p.publicationStatus === "PUBLISHED" && (
              <Button variant="secondary" leftIcon={<EyeOff className="size-4" />} onClick={() => confirm({ title: "Unpublish", message: "Tenants will no longer see this listing.", confirmLabel: "Unpublish", onConfirm: act(`/properties/${p.id}/unpublish`, {}, "Unpublished.") })}>Unpublish</Button>
            )}
            {can.review && p.publicationStatus === "PENDING_VERIFICATION" && (
              <>
                <Button leftIcon={<CheckCircle2 className="size-4" />} onClick={() => confirm({ title: "Approve and verify", message: "Confirm the details, photos and documents match. Pending photos are approved too.", confirmLabel: "Approve", onConfirm: act(`/properties/${p.id}/review`, { decision: "APPROVE" }, "Approved and verified.") })}>Approve</Button>
                <Button variant="danger" leftIcon={<XCircle className="size-4" />} onClick={() => confirm({ title: "Reject", message: "Tell the owner what to fix.", tone: "danger", confirmLabel: "Reject", reason: { label: "Reason", required: true, minLength: 5 }, onConfirm: act(`/properties/${p.id}/review`, (reason?: string) => ({ decision: "REJECT", reason }), "Rejected with feedback.") })}>Reject</Button>
              </>
            )}
          </>
        }
      />
      {msg && <Alert kind={msg.kind} className="mb-4">{msg.text}</Alert>}
      {p.publicationStatus === "REJECTED" && p.moderationNote && <Alert kind="warning" title="Changes requested" className="mb-4">{p.moderationNote}</Alert>}
      {p.activeStatus === "SUSPENDED" && <Alert kind="error" title="Suspended" className="mb-4">{p.moderationNote ?? "This property is suspended by SafeRent."}</Alert>}
      {p.publicationStatus === "PENDING_VERIFICATION" && <Alert kind="info" className="mb-4">SafeRent is verifying this property. Editing is locked until the review is complete.</Alert>}

      <div className="mb-5 overflow-x-auto">
        <Tabs<Tab> idPrefix="prop" className="min-w-[44rem]" value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} items={tabs} />
      </div>

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="card space-y-5 p-5 sm:p-6 lg:col-span-2">
            <Facts
              items={[
                ["Rent", rentRange(p.rentFrom, p.rentTo, formatMoney)],
                ["Available / occupied", `${p.availableCount} / ${p.occupiedCount}`],
                ["Owner", p.owner?.fullName ?? "—"],
                ["Address", [p.addressLine, p.locality, p.city, p.state, p.pincode].filter(Boolean).join(", ") || "—"],
                ["Category", labelize(p.category)],
                ["Created", formatDate(p.createdAt)],
              ]}
            />
            {p.type && p.type.buildingFields.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">{p.propertyTypeLabel} details</h3>
                <Facts items={p.type.buildingFields.map((f) => [f.label, <ValueText key={f.key} value={p.building[f.key]} />])} />
              </div>
            )}
            <div>
              <h3 className="mb-1 text-sm font-semibold">Description</h3>
              <p className="whitespace-pre-line text-sm text-ink-2">{p.description ?? "—"}</p>
            </div>
            <div>
              {structure === "MULTI_UNIT" || structure === "ROOMS_BEDS" ? (
                <>
                  <h3 className="mb-2 text-sm font-semibold">Charges common to every {structure === "ROOMS_BEDS" ? "bed" : unitLabel.toLowerCase()}</h3>
                  <p className="mb-3 text-xs text-muted">Rent and deposit are set for each {structure === "ROOMS_BEDS" ? "room or bed" : unitLabel.toLowerCase()} — see the {structure === "ROOMS_BEDS" ? "Rooms" : `${unitLabel}s`} tab.</p>
                  <CostBreakdownView breakdown={p.pricing?.breakdown} chargesOnly />
                </>
              ) : (
                <>
                  <h3 className="mb-2 text-sm font-semibold">What tenants pay</h3>
                  <CostBreakdownView breakdown={p.pricing?.breakdown ?? p.units.find((u) => u.pricing)?.pricing?.breakdown} />
                </>
              )}
            </div>
          </section>
          <aside className="space-y-4">
            <section className="card p-5">
              <CompletenessMeter score={p.completeness.score} sections={p.completeness.sections} note={p.completeness.note} />
            </section>
            <StatusActions p={p} can={can} confirm={confirm} act={act} />
          </aside>
        </div>
      )}

      {tab === "units" && (structure === "ROOMS_BEDS" ? <RoomsTab p={p} canManage={can.manage} onDone={done} onError={fail} onInvite={canInvite ? openInvite : undefined} /> : <UnitsTab p={p} onInvite={canInvite ? openInvite : undefined} />)}
      {tab === "reviews" && (
        <PropertyReviewsTab
          propertyId={p.id}
          units={structure === "ROOMS_BEDS" ? p.rooms.flatMap((r) => r.beds.map((b) => ({ id: b.id, label: `Room ${r.roomNumber} · Bed ${b.bedNumber}` }))) : p.units.map((u) => ({ id: u.id, label: u.name || `${unitLabel} ${u.unitNumber ?? u.code}` }))}
        />
      )}
      {tab === "tenants" && <InvitationsTab p={p} canManage={canInvite} onInvite={() => openInvite()} reloadKey={invitesKey} />}
      {invite && (
        <InviteTenantModal
          p={p}
          open
          initialTarget={invite.target}
          onClose={() => setInvite(null)}
          onCreated={() => {
            setInvitesKey((k) => k + 1);
            void reload();
          }}
        />
      )}
      {tab === "details" && <DetailsTab p={p} />}
      {tab === "photos" && (
        <section className="card p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">New photos are reviewed before tenants see them.</p>
            {editable && <UploadButton path={`/properties/${p.id}/images`} label="Add photos" onDone={done("Photos uploaded.")} onError={fail} />}
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {p.images.filter((i) => !i.inspectionId).map((img) => (
              <li key={img.id} className="relative overflow-hidden rounded-control border border-line">
                <AuthImage path={imagePath(img.id)} alt={labelize(img.category)} className="aspect-[4/3] w-full" />
                <span className="absolute left-2 top-2"><StatusBadge status={img.status} /></span>
                <span className="absolute bottom-2 left-2 rounded bg-surface/90 px-1.5 py-0.5 text-xs font-medium">{labelize(img.category)}</span>
              </li>
            ))}
          </ul>
          {p.images.length === 0 && <p className="text-sm text-muted">No photos yet.</p>}
        </section>
      )}
      {tab === "documents" && <PropertyDocumentsTab p={p} canManage={can.manage && p.activeStatus !== "ARCHIVED"} canVerify={can.verifyDocuments} />}
      {tab === "inspections" && <InspectionsTab p={p} canInspect={can.inspect} onDone={done} />}
      {tab === "team" && <TeamTab p={p} canAssign={can.assign} onDone={done} />}
      {tab === "history" && <HistoryTab id={p.id} />}
      {dialog}
    </>
  );
}

type Confirm = ReturnType<typeof useConfirm>["confirm"];
type Act = (path: string, body: unknown, success: string) => (reason?: string) => Promise<void>;

function StatusActions({ p, can, confirm, act }: { p: PropertyDetail; can: PropertyCan; confirm: Confirm; act: Act }) {
  const status = (to: string, title: string, message: string, success: string, reason = false) =>
    confirm({ title, message, tone: to === "ACTIVE" ? "primary" : "danger", confirmLabel: title, reason: reason ? { label: "Reason", required: true, minLength: 5 } : undefined, onConfirm: act(`/properties/${p.id}/status`, (r?: string) => ({ activeStatus: to, reason: r || undefined }), success) });
  const items = [
    can.manage && p.activeStatus === "ACTIVE" && { label: "Deactivate", icon: Power, run: () => status("INACTIVE", "Deactivate", "The property is hidden from tenants until you activate it again.", "Deactivated.") },
    can.manage && p.activeStatus === "INACTIVE" && { label: "Activate", icon: Power, run: () => status("ACTIVE", "Activate", "The property becomes active again.", "Activated.") },
    can.suspend && p.activeStatus !== "SUSPENDED" && p.activeStatus !== "ARCHIVED" && { label: "Suspend", icon: ShieldAlert, run: () => status("SUSPENDED", "Suspend", "The owner can't edit or publish until the suspension is lifted.", "Suspended.", true) },
    can.suspend && p.activeStatus === "SUSPENDED" && { label: "Lift suspension", icon: ShieldAlert, run: () => status("ACTIVE", "Lift suspension", "The property becomes active again.", "Suspension lifted.") },
    can.manage && p.activeStatus !== "ARCHIVED" && p.activeStatus !== "SUSPENDED" && { label: "Archive", icon: Archive, run: () => status("ARCHIVED", "Archive", "Archived properties are hidden everywhere. Records and history are kept.", "Archived.") },
  ].filter(Boolean) as Array<{ label: string; icon: typeof Power; run: () => void }>;
  if (!items.length) return null;
  return (
    <section className="card space-y-2 p-5">
      <h3 className="font-semibold">Status</h3>
      <p className="text-sm text-muted">Active: <StatusBadge status={p.activeStatus} /> · Verification: <StatusBadge status={p.verificationStatus} /></p>
      {items.map(({ label, icon: Icon, run }) => (
        <Button key={label} variant={label === "Archive" || label === "Suspend" ? "ghost" : "secondary"} fullWidth leftIcon={<Icon className="size-4" />} onClick={run}>{label}</Button>
      ))}
    </section>
  );
}

function UnitsTab({ p, onInvite }: { p: PropertyDetail; onInvite?: (target: string) => void }) {
  const fields = p.type?.unitFields ?? [];
  if (!p.units.length) return <section className="card p-5 text-sm text-muted">No {(p.type?.unitLabel ?? "unit").toLowerCase()}s added yet.</section>;
  return (
    <div className="space-y-3">
      {p.units.map((u) => (
        <section key={u.id} className="card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{p.type?.unitLabel ?? "Unit"} {u.unitNumber ?? ""} <span className="text-xs font-normal text-muted">{u.code}</span></p>
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge status={u.availabilityStatus} />
              {u.pricing?.monthlyRent && <Badge tone="brand">{formatMoney(u.pricing.monthlyRent)}/mo</Badge>}
              {onInvite && u.activeStatus === "ACTIVE" && u.availabilityStatus !== "OCCUPIED" && (
                <Button size="sm" variant="secondary" leftIcon={<UserPlus className="size-4" />} onClick={() => onInvite(u.id)}>Invite tenant</Button>
              )}
            </span>
          </div>
          <Facts items={fields.filter((f) => f.key !== "unitNumber").map((f) => [f.label, <ValueText key={f.key} value={(u as unknown as Record<string, unknown>)[f.key] ?? u.attributes[f.key]} />])} />
          {u.floors && u.floors.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted"><tr><th className="py-1">Floor</th><th>Bedrooms</th><th>Bathrooms</th><th>Kitchens</th><th>Living rooms</th><th>Balconies</th></tr></thead>
                <tbody>{u.floors.map((f) => <tr key={f.id} className="border-t border-line"><td className="py-1.5">{f.label ?? f.floorNumber}</td><td>{f.bedrooms}</td><td>{f.bathrooms}</td><td>{f.kitchens}</td><td>{f.livingRooms}</td><td>{f.balconies}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function RoomsTab({ p, canManage, onDone, onError, onInvite }: { p: PropertyDetail; canManage: boolean; onDone: (t: string) => () => Promise<void>; onError: (t: string) => void; onInvite?: (target: string) => void }) {
  const [assign, setAssign] = useState<{ roomId: string; bedId: string; bed: string } | null>(null);
  const [tenantId, setTenantId] = useState("");
  const { confirm, dialog } = useConfirm();
  const submit = async () => {
    if (!assign) return;
    try {
      await request(`/properties/${p.id}/rooms/${assign.roomId}/beds/${assign.bedId}/assign`, { method: "POST", body: { tenantId } });
      setAssign(null);
      setTenantId("");
      await onDone("Tenant assigned to the bed.")();
    } catch (err) {
      onError(errorMessage(err));
    }
  };
  return (
    <div className="space-y-3">
      {p.rooms.map((r) => (
        <section key={r.id} className="card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">Room {r.roomNumber} <span className="text-xs font-normal text-muted">{r.code} · {labelize(r.sharingType)} · Floor {r.floorNumber ?? "—"}</span></p>
            <span className="text-sm text-muted">{r.rentPerBed ? `${formatMoney(r.rentPerBed)}/bed · ` : ""}{r.availableBeds} available · {r.occupiedBeds} occupied</span>
          </div>
          <p className="mb-3 text-sm">Attached bathroom: <ValueText value={r.attachedBathroom} /> · AC: <ValueText value={r.acAvailable} /></p>
          <ul className="flex flex-wrap gap-2">
            {r.beds.map((b) => (
              <li key={b.id} className="flex items-center gap-2 rounded-control border border-line px-3 py-2 text-sm">
                <span className="font-semibold">{b.bedNumber}</span>
                <StatusBadge status={b.availabilityStatus} />
                {onInvite && !b.tenantId && b.availabilityStatus !== "OCCUPIED" && <Button size="sm" variant="ghost" onClick={() => onInvite(b.id)}>Invite tenant</Button>}
                {canManage && !b.tenantId && ["AVAILABLE", "RESERVED"].includes(b.availabilityStatus) && <Button size="sm" variant="ghost" onClick={() => setAssign({ roomId: r.id, bedId: b.id, bed: b.bedNumber })}>Assign</Button>}
                {canManage && b.tenantId && (
                  <Button size="sm" variant="ghost" onClick={() => confirm({ title: `Release bed ${b.bedNumber}`, message: "The bed becomes available again.", confirmLabel: "Release", onConfirm: async () => { await request(`/properties/${p.id}/rooms/${r.id}/beds/${b.id}/release`, { method: "POST" }); await onDone("Bed released.")(); } })}>Release</Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {p.rooms.length === 0 && <section className="card p-5 text-sm text-muted">No rooms added yet.</section>}
      <Modal open={!!assign} onClose={() => setAssign(null)} title={`Assign bed ${assign?.bed ?? ""}`} description="Usually beds are assigned automatically when you approve a tenant's application. Use this for offline tenants.">
        <Input label="Tenant ID (SafeRent user ID)" value={tenantId} onChange={(e) => setTenantId(e.target.value.trim())} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setAssign(null)}>Cancel</Button>
          <Button disabled={tenantId.length !== 36} onClick={() => void submit()}>Assign</Button>
        </div>
      </Modal>
      {dialog}
    </div>
  );
}

const UTILITY_LABELS: Array<[string, string]> = [
  ["separateElectricityMeter", "Separate electricity meter"],
  ["separateWaterMeter", "Separate water meter"],
  ["gasConnectionType", "Gas connection"],
  ["internetAvailable", "Internet"],
  ["powerBackup", "Power backup"],
  ["generatorAvailable", "Generator"],
  ["sewageFacilities", "Sewage"],
  ["wasteCollection", "Waste collection"],
];

const POLICY_LABELS: Array<[string, string]> = [
  ["guestsAllowed", "Guests"],
  ["overnightGuestsAllowed", "Overnight guests"],
  ["maximumGuestStayDays", "Max guest stay (days)"],
  ["guestRegistrationRequired", "Guest registration"],
  ["visitorTimingRestrictions", "Visitor timings"],
  ["landlordApprovalRequired", "Landlord approval"],
  ["guestParkingAvailable", "Guest parking"],
  ["guestChargesApplicable", "Guest charges"],
  ["petsAllowed", "Pets"],
  ["smokingAllowed", "Smoking"],
  ["partiesAllowed", "Parties"],
  ["loudMusicPolicy", "Loud music"],
  ["cookingAllowed", "Cooking"],
  ["sublettingAllowed", "Subletting"],
  ["workFromHomeAllowed", "Work from home"],
];

function DetailsTab({ p }: { p: PropertyDetail }) {
  const u = p.utilities ?? {};
  const pol = p.policy ?? {};
  const pr = p.pricing;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card p-5">
        <h3 className="mb-3 font-semibold">Utilities</h3>
        <Facts items={UTILITY_LABELS.map(([k, l]) => [l, <ValueText key={k} value={u[k] ?? "NOT_DISCLOSED"} />])} />
      </section>
      <section className="card p-5">
        <h3 className="mb-3 font-semibold">Guest policies & restrictions</h3>
        <Facts items={POLICY_LABELS.map(([k, l]) => [l, <ValueText key={k} value={pol[k] ?? (k.endsWith("Allowed") || k.endsWith("Required") || k.endsWith("Available") || k.endsWith("Applicable") ? "NOT_DISCLOSED" : null)} />])} />
        {(pol.additionalRules ?? []).length > 0 && (
          <ul className="mt-3 list-disc pl-5 text-sm">{(pol.additionalRules ?? []).map((r) => <li key={r.title}><span className="font-medium">{r.title}</span>{r.description ? ` — ${r.description}` : ""}</li>)}</ul>
        )}
      </section>
      <section className="card p-5">
        <h3 className="mb-3 font-semibold">Amenities</h3>
        <div className="flex flex-wrap gap-2">
          {p.amenities.map((a) => <Badge key={a.id} tone={a.status === "YES" ? "success" : a.status === "NOT_DISCLOSED" ? "warning" : "neutral"}>{a.label}: {a.status === "YES" ? "Yes" : labelize(a.status)}</Badge>)}
          {p.amenities.length === 0 && <span className="text-sm text-muted">Not added.</span>}
        </div>
      </section>
      <section className="card p-5">
        <h3 className="mb-3 font-semibold">Rent & terms</h3>
        {pr ? (
          <Facts
            items={[
              ["Rent due day", pr.rentDueDay ?? "—"],
              ["Advance rent", pr.advanceRentMonths !== null ? `${pr.advanceRentMonths} months` : "—"],
              ["Lock-in", pr.lockInPeriodMonths !== null ? `${pr.lockInPeriodMonths} months` : "—"],
              ["Notice period", pr.noticePeriodDays !== null ? `${pr.noticePeriodDays} days` : "—"],
              ["Agreement charges", pr.agreementCharges ? `${formatMoney(pr.agreementCharges)} (${labelize(pr.agreementChargesPaidBy)})` : <ValueText key="pb" value={pr.agreementChargesPaidBy} />],
              ["Late fee", pr.lateFeePolicy ?? "—"],
              ["Rent increase", pr.rentIncreasePolicy ?? "—"],
              ["Refund policy", pr.refundPolicy ?? "—"],
            ]}
          />
        ) : (
          <p className="text-sm text-muted">Not added.</p>
        )}
      </section>
    </div>
  );
}

interface Inspection {
  id: string;
  type: string;
  status: string;
  scheduledAt: string;
  inspectionDate: string | null;
  propertyCondition: string;
  wallCondition: string;
  doorsAndWindows: string;
  electricalCondition: string;
  plumbingCondition: string;
  existingDamages: string | null;
  handoverMeterReading: string | null;
  keysHandedOver: number | null;
  result: string | null;
  notes: string | null;
  leaseId: string | null;
  landlordAcknowledgedAt: string | null;
  tenantAcknowledgedAt: string | null;
}

const CONDITIONS = ["GOOD", "FAIR", "POOR", "NOT_APPLICABLE", "NOT_INSPECTED"];

function InspectionsTab({ p, canInspect, onDone }: { p: PropertyDetail; canInspect: boolean; onDone: (t: string) => () => Promise<void> }) {
  const { data, reload } = useQuery(() => request<Paged<Inspection>>(`/properties/${p.id}/inspections`), [p.id]);
  const [open, setOpen] = useState(false);
  const [record, setRecord] = useState<Inspection | null>(null);
  const [form, setForm] = useState({ type: "ROUTINE", when: "", leaseId: "", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const schedule = async () => {
    setError(null);
    try {
      await request(`/properties/${p.id}/inspections`, { method: "POST", body: { type: form.type, scheduledAt: new Date(form.when).toISOString(), leaseId: form.leaseId || undefined, notes: form.notes || undefined } });
      setOpen(false);
      await reload();
      await onDone("Inspection scheduled.")();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <section className="card p-5 sm:p-6">
      {canInspect && <div className="mb-4 flex justify-end"><Button leftIcon={<CalendarPlus className="size-4" />} onClick={() => setOpen(true)}>Schedule inspection</Button></div>}
      <ul className="divide-y divide-line">
        {data?.items.map((i) => (
          <li key={i.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">{labelize(i.type)} · {formatTimestamp(i.inspectionDate ?? i.scheduledAt)}</p>
              <p className="text-xs text-muted">Condition: {labelize(i.propertyCondition)}{i.result ? ` · ${labelize(i.result)}` : ""}{i.landlordAcknowledgedAt ? " · landlord acknowledged" : ""}{i.tenantAcknowledgedAt ? " · tenant acknowledged" : ""}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={i.status} />
              {canInspect && !i.landlordAcknowledgedAt && !i.tenantAcknowledgedAt && <Button size="sm" variant="secondary" onClick={() => setRecord(i)}>Record report</Button>}
            </div>
          </li>
        ))}
        {data?.items.length === 0 && <li className="py-3 text-sm text-muted">No inspections yet.</li>}
      </ul>
      <Modal open={open} onClose={() => setOpen(false)} title="Schedule inspection">
        {error && <Alert kind="error" className="mb-3">{error}</Alert>}
        <div className="space-y-3">
          <Select label="Type" options={["ROUTINE", "VERIFICATION", "MOVE_IN", "MOVE_OUT"].map((t) => ({ value: t, label: labelize(t) }))} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} />
          {(form.type === "MOVE_IN" || form.type === "MOVE_OUT") && <Input label="Lease ID" value={form.leaseId} onChange={(e) => setForm({ ...form, leaseId: e.target.value.trim() })} />}
          <Input label="Date and time" type="datetime-local" value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} />
          <Input label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!form.when} onClick={() => void schedule()}>Schedule</Button>
        </div>
      </Modal>
      {record && <RecordInspection p={p} inspection={record} onClose={() => setRecord(null)} onSaved={async () => { setRecord(null); await reload(); await onDone("Inspection saved.")(); }} />}
    </section>
  );
}

function RecordInspection({ p, inspection, onClose, onSaved }: { p: PropertyDetail; inspection: Inspection; onClose: () => void; onSaved: () => Promise<void> }) {
  const [v, setV] = useState({
    inspectionDate: (inspection.inspectionDate ?? inspection.scheduledAt).slice(0, 16),
    propertyCondition: inspection.propertyCondition,
    wallCondition: inspection.wallCondition,
    doorsAndWindows: inspection.doorsAndWindows,
    electricalCondition: inspection.electricalCondition,
    plumbingCondition: inspection.plumbingCondition,
    existingDamages: inspection.existingDamages ?? "",
    handoverMeterReading: inspection.handoverMeterReading ?? "",
    keysHandedOver: inspection.keysHandedOver?.toString() ?? "",
    result: inspection.result ?? "",
    notes: inspection.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      await request(`/properties/${p.id}/inspections/${inspection.id}`, {
        method: "PATCH",
        body: {
          status: "COMPLETED",
          inspectionDate: new Date(v.inspectionDate).toISOString(),
          propertyCondition: v.propertyCondition,
          wallCondition: v.wallCondition,
          doorsAndWindows: v.doorsAndWindows,
          electricalCondition: v.electricalCondition,
          plumbingCondition: v.plumbingCondition,
          existingDamages: v.existingDamages || null,
          handoverMeterReading: v.handoverMeterReading === "" ? null : String(v.handoverMeterReading),
          keysHandedOver: v.keysHandedOver === "" ? null : Number(v.keysHandedOver),
          result: v.result || null,
          notes: v.notes || null,
        },
      });
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const cond = (k: keyof typeof v, label: string) => <Select label={label} options={CONDITIONS.map((c) => ({ value: c, label: labelize(c) }))} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />;
  return (
    <Modal open onClose={onClose} title={`${labelize(inspection.type)} inspection report`}>
      {error && <Alert kind="error" className="mb-3">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Inspection date" type="datetime-local" value={v.inspectionDate} onChange={(e) => setV({ ...v, inspectionDate: e.target.value })} />
        {cond("propertyCondition", "Overall condition")}
        {cond("wallCondition", "Walls")}
        {cond("doorsAndWindows", "Doors & windows")}
        {cond("electricalCondition", "Electrical")}
        {cond("plumbingCondition", "Plumbing")}
        <Input label="Meter reading" type="number" min={0} value={v.handoverMeterReading} onChange={(e) => setV({ ...v, handoverMeterReading: e.target.value })} />
        <Input label="Keys handed over" type="number" min={0} value={v.keysHandedOver} onChange={(e) => setV({ ...v, keysHandedOver: e.target.value })} />
        <Select label="Result" placeholder="—" options={["PASSED", "NEEDS_REPAIRS", "FAILED"].map((r) => ({ value: r, label: labelize(r) }))} value={v.result} onChange={(e) => setV({ ...v, result: e.target.value })} />
        <Input label="Existing damages" value={v.existingDamages} onChange={(e) => setV({ ...v, existingDamages: e.target.value })} />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <UploadButton path={`/properties/${p.id}/images`} extra={{ inspectionId: inspection.id }} label="Add photos" onDone={() => undefined} onError={setError} />
        <Button onClick={() => void save()}>Save report</Button>
      </div>
    </Modal>
  );
}

function TeamTab({ p, canAssign, onDone }: { p: PropertyDetail; canAssign: boolean; onDone: (t: string) => () => Promise<void> }) {
  const [type, setType] = useState<"MANAGER" | "AGENT">("MANAGER");
  const [userId, setUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const role = type === "MANAGER" ? "PROPERTY_MANAGER" : "PROPERTY_AGENT";
  const { data } = useQuery(() => request<{ items: Array<{ id: string; fullName: string }> }>("/users/lookup", { query: { role } }), [role], canAssign);
  const { confirm, dialog } = useConfirm();
  const add = async () => {
    setError(null);
    try {
      await request(`/properties/${p.id}/assignments`, { method: "POST", body: { userId, type } });
      setUserId("");
      await onDone("Assignment added.")();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <section className="card p-5 sm:p-6">
      <p className="mb-4 text-sm text-muted">Managers and agents only access properties assigned to them and can never change ownership.</p>
      {canAssign && (
        <div className="mb-5 grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
          <Select label="Type" options={[{ value: "MANAGER", label: "Manager" }, { value: "AGENT", label: "Agent" }]} value={type} onChange={(e) => setType(e.target.value as "MANAGER" | "AGENT")} />
          <Select label="Person" placeholder="Choose…" options={(data?.items ?? []).map((u) => ({ value: u.id, label: u.fullName }))} value={userId} onChange={(e) => setUserId(e.target.value)} />
          <Button leftIcon={<UserPlus className="size-4" />} disabled={!userId} onClick={() => void add()}>Assign</Button>
        </div>
      )}
      {error && <Alert kind="error" className="mb-3">{error}</Alert>}
      <ul className="divide-y divide-line">
        {p.assignments.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3 py-3">
            <span><span className="font-medium">{a.user.fullName}</span> <Badge tone="brand">{a.type === "MANAGER" ? "Manager" : "Agent"}</Badge></span>
            {canAssign && <Button size="sm" variant="ghost" onClick={() => confirm({ title: "Remove assignment", message: `${a.user.fullName} will lose access to this property.`, tone: "danger", confirmLabel: "Remove", onConfirm: async () => { await request(`/properties/${p.id}/assignments/${a.id}`, { method: "DELETE" }); await onDone("Assignment removed.")(); } })}>Remove</Button>}
          </li>
        ))}
        {p.assignments.length === 0 && <li className="py-3 text-sm text-muted">Nobody is assigned yet.</li>}
      </ul>
      {dialog}
    </section>
  );
}

interface HistoryRow {
  id: string;
  field: string;
  entityType: string;
  fromValue: string | null;
  toValue: string;
  reason: string | null;
  createdAt: string;
  actor: { fullName: string } | null;
}
interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  oldValue: unknown;
  newValue: unknown;
  sourcePlatform: string;
  createdAt: string;
  actor: { fullName: string } | null;
}

function HistoryTab({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const history = useQuery(() => request<Paged<HistoryRow>>(`/properties/${id}/status-history`, { query: { pageSize: 50 } }), [id]);
  const audit = useQuery(() => request<Paged<AuditRow>>(`/properties/${id}/audit`, { query: { page, pageSize: 20 } }), [id, page]);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="card p-5">
        <h3 className="mb-3 font-semibold">Status changes</h3>
        <ul className="space-y-2 text-sm">
          {history.data?.items.map((h) => (
            <li key={h.id} className="rounded-control bg-subtle px-3 py-2">
              <p><span className="font-medium">{labelize(h.entityType)} {labelize(h.field.replace("Status", "_status"))}</span>: {h.fromValue ? labelize(h.fromValue) : "—"} → <span className="font-semibold">{labelize(h.toValue)}</span></p>
              <p className="text-xs text-muted">{formatTimestamp(h.createdAt)} · {h.actor?.fullName ?? "System"}{h.reason ? ` · ${h.reason}` : ""}</p>
            </li>
          ))}
          {history.data?.items.length === 0 && <li className="text-muted">No changes yet.</li>}
        </ul>
      </section>
      <section className="card p-5">
        <h3 className="mb-3 font-semibold">Audit trail</h3>
        <p className="mb-3 text-xs text-muted">Immutable record of every change, including rent, deposit, utility and policy changes.</p>
        <ul className="space-y-2 text-sm">
          {audit.data?.items.map((a) => (
            <li key={a.id} className="rounded-control border border-line px-3 py-2">
              <p className="font-medium">{labelize(a.action)} <span className="text-xs font-normal text-muted">· {labelize(a.entityType)} · {labelize(a.sourcePlatform)}</span></p>
              <p className="text-xs text-muted">{formatTimestamp(a.createdAt)} · {a.actor?.fullName ?? "System"}</p>
              {a.newValue !== null && a.newValue !== undefined && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-xs text-ink-2">{JSON.stringify(a.newValue)}</pre>}
            </li>
          ))}
        </ul>
        {audit.data && <Pagination page={audit.data.page} totalPages={audit.data.totalPages} total={audit.data.total} onPage={setPage} />}
      </section>
    </div>
  );
}
