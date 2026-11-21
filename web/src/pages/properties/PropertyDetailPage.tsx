import { Archive, ArrowLeft, CheckCircle2, Eye, EyeOff, Pencil, Power, Send, ShieldAlert, Trash2, UserPlus, XCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Pagination } from "@/components/data/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/hooks/useAuth";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Select } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Tabs } from "@/components/ui/Tabs";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import type { Paged } from "@/types/auth";
import { errorMessage } from "@/utils/errors";
import { formatDate, formatMoney, formatTimestamp, labelize } from "@/utils/format";
import { CompletenessMeter, CostBreakdownView, Facts, ValueText } from "./components";
import { InvitationsTab, InviteTenantModal, inviteTargets } from "./TenantInvites";
import { PossibleDuplicates } from "./PossibleDuplicates";
import { PropertyVideosTab } from "./PropertyVideos";
import { PropertyFurnitureTab } from "./PropertyFurniture";
import { PropertyVisitsTab } from "./PropertyVisits";
import { PropertySafetyTab } from "./PropertySafety";
import { PropertyComplianceTab } from "./PropertyCompliance";
import { PropertySocietyTab } from "./PropertySociety";
import { PropertyQrTab } from "./PropertyQr";
import { InspectionsTab } from "./PropertyInspections";
import { PropertyPhotosTab } from "./PropertyPhotos";
import { PropertyDocumentsTab } from "./PropertyDocuments";
import { PropertyReviewsTab } from "@/pages/reviews/ReviewsPages";
import { rentRange, type Occupancy, type PendingRevision, type PropertyCan, type PropertyDetail } from "./types";

type Tab = "overview" | "units" | "tenants" | "reviews" | "details" | "photos" | "videos" | "furniture" | "visits" | "safety" | "compliance" | "society" | "qr" | "documents" | "inspections" | "team" | "history";

export function PropertyDetailPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const { can: hasPermission } = useAuth();
  const { data, loading, error, reload } = useQuery(() => request<{ property: PropertyDetail; can: PropertyCan; pendingRevision: PendingRevision | null; lastRevision: PendingRevision | null }>(`/properties/${id}`), [id]);
  const { confirm, dialog } = useConfirm();
  const tab = (params.get("tab") as Tab | null) ?? "overview";
  const [invite, setInvite] = useState<{ target?: string } | null>(null);
  const [invitesKey, setInvitesKey] = useState(0);
  const [editDate, setEditDate] = useState<MoveInTarget | null>(null);

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
  // A verified ownership document (sale deed / tax receipt / power bill) is needed to approve.
  const hasOwnershipProof = p.documents.some((d) => d.needsVerification && d.status === "APPROVED" && d.isCurrent !== false && !d.archivedAt);
  const structure = p.structure;
  const unitLabel = p.type?.unitLabel ?? "Unit";

  const tabs: Array<{ value: Tab; label: string }> = [
    { value: "overview", label: "Overview" },
    { value: "units", label: structure === "ROOMS_BEDS" ? `Rooms (${p.rooms.length})` : `${unitLabel}s (${p.units.length})` },
    ...(can.manage ? [{ value: "tenants" as Tab, label: "Tenant invites" }] : []),
    { value: "reviews", label: "Reviews" },
    { value: "details", label: "Utilities & terms" },
    { value: "photos", label: `Photos (${p.images.filter((i) => !i.inspectionId).length})` },
    { value: "videos", label: `Videos (${p.videos?.length ?? 0})` },
    { value: "furniture", label: "Furniture" },
    { value: "safety", label: "Safety" },
    { value: "qr", label: "QR codes" },
    ...(p.type?.category !== "LAND" ? [{ value: "society" as Tab, label: "Society" }] : []),
    ...(can.manage || can.verifyDocuments ? [{ value: "compliance" as Tab, label: "Compliance" }] : []),
    ...(can.manage ? [{ value: "visits" as Tab, label: "Visits" }] : []),
    ...(can.manage || can.verifyDocuments ? [{ value: "documents" as Tab, label: "Documents" }] : []),
    { value: "inspections", label: "Inspections" },
    ...(can.assign || p.assignments.length ? [{ value: "team" as Tab, label: "Team" }] : []),
    { value: "history", label: "History" },
  ];

  const editable = can.manage && p.activeStatus !== "ARCHIVED" && p.publicationStatus !== "PENDING_VERIFICATION" && p.activeStatus !== "SUSPENDED";
  // A tenant who visited in person can be invited whether or not the listing is published.
  // Hidden once every vacant flat / bed already has a pending invitation (or the whole property does).
  const canInvite = can.manage && p.activeStatus === "ACTIVE" && !p.pendingInvitation && (p.units.length + p.rooms.length === 0 || inviteTargets(p).length > 0);
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
                {p.publicationStatus === "DRAFT" ? "Continue draft" : data.pendingRevision && data.pendingRevision.status !== "PENDING_VERIFICATION" ? "Continue changes" : "Edit"}
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
                <Button
                  leftIcon={<CheckCircle2 className="size-4" />}
                  onClick={() => {
                    setMsg(null);
                    confirm({ title: "Approve and go live", message: "Confirm the details, photos and documents match. Pending photos are approved too, and the listing goes live for tenants right away.", confirmLabel: "Approve", onConfirm: act(`/properties/${p.id}/review`, { decision: "APPROVE" }, "Approved — the listing is live.") });
                  }}
                >
                  Approve
                </Button>
                {!hasOwnershipProof && hasPermission("listings.approve_manual") && (
                  <Button
                    variant="secondary"
                    leftIcon={<ShieldAlert className="size-4" />}
                    onClick={() =>
                      confirm({
                        title: "Approve without document",
                        message: "This listing has no verified ownership document. Approve it only after you've confirmed ownership another way — it goes live for tenants right away. Your name and reason are recorded.",
                        confirmLabel: "Approve",
                        reason: { label: "Reason (e.g. ownership checked at site visit)", required: true, minLength: 5 },
                        onConfirm: act(`/properties/${p.id}/review`, (reason?: string) => ({ decision: "APPROVE", withoutOwnershipDocument: true, reason }), "Approved without an ownership document — the listing is live."),
                      })
                    }
                  >
                    Approve without document
                  </Button>
                )}
                <Button variant="danger" leftIcon={<XCircle className="size-4" />} onClick={() => confirm({ title: "Reject", message: "Tell the owner what to fix.", tone: "danger", confirmLabel: "Reject", reason: { label: "Reason", required: true, minLength: 5 }, onConfirm: act(`/properties/${p.id}/review`, (reason?: string) => ({ decision: "REJECT", reason }), "Rejected with feedback.") })}>Reject</Button>
              </>
            )}
          </>
        }
      />
      {msg && <Alert kind={msg.kind} className="mb-4">{msg.text}</Alert>}
      {data.pendingRevision && (
        <ChangeRequestBanner
          revision={data.pendingRevision}
          can={can}
          onReview={can.review ? () => navigate(`/moderation/changes/${data.pendingRevision!.id}`) : undefined}
          onEdit={() => navigate(`/properties/${p.id}/edit?step=3`)}
          onSubmit={() => act(`/properties/${p.id}/revision/submit`, {}, "Changes sent for verification. Your listing stays live meanwhile.")().catch((e) => fail(errorMessage(e)))}
          onDiscard={() =>
            confirm({
              title: "Discard changes",
              message: "Your unsent changes are deleted. The live listing stays exactly as it is.",
              tone: "danger",
              confirmLabel: "Discard",
              onConfirm: async () => {
                await request(`/properties/${p.id}/revision`, { method: "DELETE" });
                await done("Changes discarded.")();
              },
            })
          }
        />
      )}
      {!data.pendingRevision && data.lastRevision?.status === "APPROVED" && data.lastRevision.decidedAt && Date.now() - new Date(data.lastRevision.decidedAt).getTime() < 7 * 86400_000 && (
        <Alert kind="success" className="mb-4">Your last changes were approved on {formatDate(data.lastRevision.decidedAt)} and are live.</Alert>
      )}
      {p.publicationStatus === "REJECTED" && p.moderationNote && <Alert kind="warning" title="Changes requested" className="mb-4">{p.moderationNote}</Alert>}
      {p.activeStatus === "SUSPENDED" && <Alert kind="error" title="Suspended" className="mb-4">{p.moderationNote ?? "This property is suspended by SafeRent."}</Alert>}
      {p.publicationStatus === "PENDING_VERIFICATION" && <Alert kind="info" className="mb-4">SafeRent is verifying this property. Editing is locked until the review is complete.</Alert>}
      {can.review && p.publicationStatus === "PENDING_VERIFICATION" && <PossibleDuplicates propertyId={p.id} />}

      <Tabs<Tab> idPrefix="prop" className="mb-5" value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} items={tabs} />

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="card space-y-5 p-5 sm:p-6 lg:col-span-2">
            <Facts
              items={[
                ["Rent", rentRange(p.rentFrom, p.rentTo, formatMoney)],
                ["Available / occupied", `${p.availableCount} / ${p.occupiedCount}`],
                ...(p.occupancy ? ([["Occupied", <OccupiedSince key="occ" occ={p.occupancy} place={p.title ?? p.code} onChangeDate={can.changeLeaseDates ? setEditDate : undefined} />]] as Array<[string, ReactNode]>) : []),
                ["Owner", p.owner?.fullName ?? "—"],
                ["Address", [p.addressLine, p.locality, p.city, p.state, p.pincode].filter(Boolean).join(", ") || "—"],
                ["Category", labelize(p.category)],
                ["Created", formatDate(p.createdAt)],
              ]}
            />
            {p.occupancy && <DateChangeHistory occ={p.occupancy} />}
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
            <OwnershipCard o={p.ownership ?? null} />
          </aside>
        </div>
      )}

      {tab === "units" && (structure === "ROOMS_BEDS" ? <RoomsTab p={p} canManage={can.manage} onDone={done} onError={fail} onInvite={canInvite ? openInvite : undefined} onChangeDate={can.changeLeaseDates ? setEditDate : undefined} /> : <UnitsTab p={p} onInvite={canInvite ? openInvite : undefined} onChangeDate={can.changeLeaseDates ? setEditDate : undefined} />)}
      {tab === "reviews" && (
        <PropertyReviewsTab
          propertyId={p.id}
          units={structure === "ROOMS_BEDS" ? p.rooms.flatMap((r) => r.beds.map((b) => ({ id: b.id, label: `Room ${r.roomNumber} · Bed ${b.bedNumber}` }))) : p.units.map((u) => ({ id: u.id, label: u.name || `${unitLabel} ${u.unitNumber ?? u.code}` }))}
        />
      )}
      {editDate && <ChangeMoveInModal target={editDate} onClose={() => setEditDate(null)} onSaved={(m) => { setEditDate(null); void done(m)(); }} />}
      {tab === "tenants" && <InvitationsTab p={p} canManage={can.manage && p.activeStatus === "ACTIVE"} canInvite={canInvite} onInvite={() => openInvite()} reloadKey={invitesKey} />}
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
      {tab === "photos" && <PropertyPhotosTab p={p} editable={editable} onDone={(m) => void done(m)()} onError={fail} />}
      {tab === "visits" && <PropertyVisitsTab p={p} canManage={can.manage} />}
      {tab === "qr" && <PropertyQrTab p={p} />}
      {tab === "society" && <PropertySocietyTab p={p} canManage={can.manage && p.activeStatus !== "ARCHIVED"} />}
      {tab === "compliance" && <PropertyComplianceTab p={p} canManage={can.manage && p.activeStatus !== "ARCHIVED"} />}
      {tab === "safety" && <PropertySafetyTab p={p} canManage={can.manage && p.activeStatus !== "ARCHIVED"} />}
      {tab === "furniture" && <PropertyFurnitureTab p={p} canManage={can.manage && p.activeStatus !== "ARCHIVED"} />}
      {tab === "videos" && <PropertyVideosTab p={p} editable={editable} canReview={can.review} onDone={(m) => void done(m)()} onError={fail} />}
      {tab === "documents" && <PropertyDocumentsTab p={p} canManage={can.manage && p.activeStatus !== "ARCHIVED"} canVerify={can.verifyDocuments} onChanged={() => void reload()} />}
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

function UnitsTab({ p, onInvite, onChangeDate }: { p: PropertyDetail; onInvite?: (target: string) => void; onChangeDate?: (t: MoveInTarget) => void }) {
  const fields = p.type?.unitFields ?? [];
  if (!p.units.length) return <section className="card p-5 text-sm text-muted">No {(p.type?.unitLabel ?? "unit").toLowerCase()}s added yet.</section>;
  return (
    <div className="space-y-3">
      {p.units.map((u) => (
        <section key={u.id} className="card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{p.type?.unitLabel ?? "Unit"} {u.unitNumber ?? ""} <span className="text-xs font-normal text-muted">{u.code}</span></p>
            <span className="flex flex-wrap items-center gap-2">
              {u.availabilityStatus === "AVAILABLE" && futureDate(u.availableFrom) ? <Badge tone="warning">Available from {formatDate(u.availableFrom!)}</Badge> : <StatusBadge status={u.availabilityStatus} />}
              {u.pricing?.monthlyRent && <Badge tone="brand">{formatMoney(u.pricing.monthlyRent)}/mo</Badge>}
              {u.pendingInvitation && <Badge tone="warning">Invited · {u.pendingInvitation.recipientName}</Badge>}
              {onInvite && u.activeStatus === "ACTIVE" && u.availabilityStatus !== "OCCUPIED" && !u.pendingInvitation && (
                <Button size="sm" variant="secondary" leftIcon={<UserPlus className="size-4" />} onClick={() => onInvite(u.id)}>Invite tenant</Button>
              )}
            </span>
          </div>
          <Facts
            items={fields
              // "Available from" is shown inside Availability (only matters while the flat is vacant).
              .filter((f) => f.key !== "unitNumber" && f.key !== "availableFrom")
              .map((f) => [
                f.label,
                f.key === "availabilityStatus" && u.availabilityStatus === "AVAILABLE" ? (
                  <span key={f.key} className={futureDate(u.availableFrom) ? "text-warning" : "text-success"}>{futureDate(u.availableFrom) ? `From ${formatDate(u.availableFrom!)}` : "Available now"}</span>
                ) : f.key === "availabilityStatus" && u.availabilityStatus === "OCCUPIED" && u.occupancy ? (
                  <OccupiedSince key={f.key} occ={u.occupancy} place={`${p.type?.unitLabel ?? "Unit"} ${u.unitNumber ?? u.code}`} onChangeDate={onChangeDate} />
                ) : (
                  <ValueText key={f.key} value={(u as unknown as Record<string, unknown>)[f.key] ?? u.attributes[f.key]} />
                ),
              ])}
          />
          {u.occupancy && <DateChangeHistory occ={u.occupancy} />}
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

function RoomsTab({ p, canManage, onDone, onError, onInvite, onChangeDate }: { p: PropertyDetail; canManage: boolean; onDone: (t: string) => () => Promise<void>; onError: (t: string) => void; onInvite?: (target: string) => void; onChangeDate?: (t: MoveInTarget) => void }) {
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
              <li key={b.id} className="flex flex-wrap items-center gap-2 rounded-control border border-line px-3 py-2 text-sm">
                <span className="font-semibold">{b.bedNumber}</span>
                <StatusBadge status={b.availabilityStatus} />
                {b.pendingInvitation && <Badge tone="warning">Invited · {b.pendingInvitation.recipientName}</Badge>}
                {onInvite && !b.tenantId && b.availabilityStatus !== "OCCUPIED" && !b.pendingInvitation && <Button size="sm" variant="ghost" onClick={() => onInvite(b.id)}>Invite tenant</Button>}
                {canManage && !b.tenantId && ["AVAILABLE", "RESERVED"].includes(b.availabilityStatus) && <Button size="sm" variant="ghost" onClick={() => setAssign({ roomId: r.id, bedId: b.id, bed: b.bedNumber })}>Assign</Button>}
                {canManage && b.tenantId && (
                  <Button size="sm" variant="ghost" onClick={() => confirm({ title: `Release bed ${b.bedNumber}`, message: "The bed becomes available again.", confirmLabel: "Release", onConfirm: async () => { await request(`/properties/${p.id}/rooms/${r.id}/beds/${b.id}/release`, { method: "POST" }); await onDone("Bed released.")(); } })}>Release</Button>
                )}
                {b.occupancy && (
                  <span className="basis-full text-xs">
                    <OccupiedSince occ={b.occupancy} place={`Room ${r.roomNumber} · Bed ${b.bedNumber}`} onChangeDate={onChangeDate} />
                    <DateChangeHistory occ={b.occupancy} />
                  </span>
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
        <Facts items={POLICY_LABELS.filter(([k]) => k !== "cookingAllowed" || p.structure === "ROOMS_BEDS").map(([k, l]) => [l, <ValueText key={k} value={pol[k] ?? (k.endsWith("Allowed") || k.endsWith("Required") || k.endsWith("Available") || k.endsWith("Applicable") ? "NOT_DISCLOSED" : null)} />])} />
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

const SECTION_LABELS: Record<string, string> = {
  basic: "Title & description",
  location: "Location",
  building: "Building details",
  units: "Units",
  rooms: "Rooms & beds",
  pricing: "Rent & charges",
  utilities: "Utilities",
  policies: "House rules",
  amenities: "Amenities",
  photos: "Photos",
  videos: "Video tours",
};
export const sectionLabel = (k: string) => SECTION_LABELS[k] ?? k;

/** Change request of a live listing: what's happening and what the owner can do. */
function ChangeRequestBanner({ revision, can, onEdit, onSubmit, onDiscard, onReview }: { revision: PendingRevision; can: PropertyCan; onEdit: () => void; onSubmit: () => void; onDiscard: () => void; onReview?: () => void }) {
  const pending = revision.status === "PENDING_VERIFICATION";
  const rejected = revision.status === "REJECTED";
  return (
    <section className={`card mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between ${rejected ? "border-danger/40" : pending ? "border-brand/40" : "border-warning/40"}`}>
      <div className="min-w-0">
        <p className="font-semibold">
          {pending ? "Your changes are being verified" : rejected ? "SafeRent asked for changes" : "You have unsent changes"}
        </p>
        <p className="mt-0.5 text-sm text-muted">
          {pending
            ? `Sent ${revision.submittedAt ? formatDate(revision.submittedAt) : ""}. The listing stays live with its current details until they're approved.`
            : rejected
              ? (revision.moderationNote ?? "Fix the changes and send them again.")
              : "Tenants still see the current listing. Submit your changes so SafeRent can verify them."}
        </p>
        {revision.changedSections.length > 0 && <p className="mt-1 text-xs text-muted">Changed: {revision.changedSections.map(sectionLabel).join(", ")}</p>}
      </div>
      {pending && onReview && (
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button leftIcon={<CheckCircle2 className="size-4" />} onClick={onReview}>Review changes</Button>
        </div>
      )}
      {!pending && (
        <div className="flex shrink-0 flex-wrap gap-2">
          {can.editRevision && <Button variant="secondary" leftIcon={<Pencil className="size-4" />} onClick={onEdit}>Continue editing</Button>}
          {can.discardRevision && <Button variant="ghost" onClick={onDiscard}>Discard</Button>}
          {can.submitRevision && <Button leftIcon={<Send className="size-4" />} onClick={onSubmit}>Submit changes</Button>}
        </div>
      )}
    </section>
  );
}

/** True when an ISO date is after today (a flat that frees up later). */
function futureDate(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getTime() > Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Super Admin / roles with leases.change_dates: change a tenant's move-in (occupied since) date, with a reason. */
function ChangeMoveInModal({ target, onClose, onSaved }: { target: MoveInTarget; onClose: () => void; onSaved: (message: string) => void }) {
  const [date, setDate] = useState(target.current);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const out = await request<{ note?: string }>(`/leases/${target.leaseId}/start-date`, { method: "POST", body: { date, reason: reason.trim() } });
      onSaved(`Move-in date changed.${out?.note ? ` ${out.note}` : ""}`);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Change move-in date — ${target.unit}`} description="Rent is due on this date every month, so unpaid rent months move with it. Paid months stay as they are. The change and your reason are recorded.">
      {err && <Alert kind="error" className="mb-3">{err}</Alert>}
      <Input label="Occupied since (move-in date)" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <div className="mt-3">
        <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Tenant actually moved in on 18 Nov" />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || reason.trim().length < 5 || !date || date === target.current} onClick={() => void save()}>Save</Button>
      </div>
    </Modal>
  );
}

type MoveInTarget = { leaseId: string; unit: string; current: string };

/** "Occupied by Ravi since 15 Nov 2026 [Change]" + lease end / agreed move-out. */
function OccupiedSince({ occ, place, onChangeDate }: { occ: Occupancy; place: string; onChangeDate?: (t: MoveInTarget) => void }) {
  return (
    <span>
      Occupied by {occ.tenantName} since {formatDate(occ.since)}
      {onChangeDate && (
        <button type="button" className="ml-2 text-xs font-semibold text-brand hover:underline" onClick={() => onChangeDate({ leaseId: occ.leaseId, unit: place, current: occ.since.slice(0, 10) })}>
          Change
        </button>
      )}
      {occ.movingOutOn ? <span className="block text-warning">Moving out on {formatDate(occ.movingOutOn)}</span> : <span className="block text-xs font-normal text-muted">Lease until {formatDate(occ.leaseEnds)}</span>}
    </span>
  );
}

/** Who changed the move-in date, when, from → to, and why. */
function DateChangeHistory({ occ }: { occ: Occupancy }) {
  if (!occ.dateChanges.length) return null;
  return (
    <div className="mt-3 rounded-control border border-line bg-surface p-3 text-xs">
      <p className="mb-1 font-semibold text-ink">Move-in date changes</p>
      <ul className="space-y-1 text-muted">
        {occ.dateChanges.map((c) => (
          <li key={c.id}>
            <span className="font-medium text-ink">{formatDate(c.from)} → {formatDate(c.to)}</span> by {c.changedBy} on {formatTimestamp(c.at)} — {c.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

const OWNER_TYPE_LABEL: Record<string, string> = { INDIVIDUAL: "Individual", JOINT: "Joint owners", COMPANY: "Company" };
const AUTHORITY_LABEL: Record<string, string> = { POWER_OF_ATTORNEY: "Power of Attorney", BOARD_RESOLUTION: "Board resolution", AUTHORIZATION_LETTER: "Authorization letter", OTHER: "Other" };

/** Who owns the property and who may act for the owner (private: owner, managers, staff). */
function OwnershipCard({ o }: { o: NonNullable<PropertyDetail["ownership"]> | null }) {
  return (
    <section className="card p-5 text-sm">
      <h3 className="mb-2 font-semibold">Ownership</h3>
      {!o ? (
        <p className="text-muted">Not given yet.</p>
      ) : (
        <dl className="space-y-1.5">
          <div className="flex justify-between gap-2"><dt className="text-muted">Owner type</dt><dd className="font-medium">{OWNER_TYPE_LABEL[o.ownerType] ?? o.ownerType}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-muted">Ownership</dt><dd className="font-medium">{o.ownershipType === "JOINT" ? "Joint" : "Sole"}</dd></div>
          {o.companyName && <div className="flex justify-between gap-2"><dt className="text-muted">Company</dt><dd className="font-medium">{o.companyName}</dd></div>}
          {o.ownershipType === "JOINT" && (
            <>
              <div className="flex justify-between gap-2"><dt className="text-muted">Listing owner's share</dt><dd className="font-medium">{o.ownerSharePercent ?? 0}%</dd></div>
              {o.coOwners.map((c, i) => (
                <div key={i} className="flex justify-between gap-2"><dt className="text-muted">{c.name}{c.relation ? ` (${c.relation})` : ""}</dt><dd className="font-medium">{c.sharePercent}%</dd></div>
              ))}
            </>
          )}
          {o.representative && (
            <div className="mt-2 rounded-control bg-subtle p-2">
              <p className="font-medium">Authorized representative</p>
              <p>{o.representative.name} ({o.representative.relation}) · {o.representative.phone}</p>
              <p className="text-xs text-muted">Authority: {AUTHORITY_LABEL[o.representative.authorityType] ?? o.representative.authorityType}{o.representative.authorityType === "POWER_OF_ATTORNEY" ? ". Check the Power of Attorney in Documents." : ""}</p>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
