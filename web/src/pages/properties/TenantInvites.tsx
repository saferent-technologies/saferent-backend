import { Copy, Link2, MessageCircle, RefreshCw, Smartphone, UserPlus, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { PhoneField } from "@/components/ui/PhoneField";
import { Spinner } from "@/components/ui/Spinner";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import type { Paged } from "@/types/auth";
import { AppError, errorMessage } from "@/utils/errors";
import { formatDate, formatMoney, formatTimestamp } from "@/utils/format";
import type { PropertyDetail } from "./types";

export interface Invitation {
  id: string;
  code: string;
  target: string | null;
  unitId: string | null;
  bedId: string | null;
  recipientName: string;
  recipientPhone: string | null;
  monthlyRent: string;
  securityDeposit: string;
  startDate: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "REVOKED" | "EXPIRED";
  expiresAt: string;
  respondedAt: string | null;
  leaseId: string | null;
  createdAt: string;
}

interface InviteLink {
  url: string;
  expiresAt: string;
  shareText: string;
}

/** What can be rented right now: free flats / villas, or free beds for PG / hostel. */
export interface InviteTarget {
  key: string;
  unitId?: string;
  bedId?: string;
  label: string;
  rent: string | null;
  deposit: string | null;
}

export function inviteTargets(p: PropertyDetail): InviteTarget[] {
  if (p.structure === "ROOMS_BEDS") {
    return p.rooms.flatMap((r) =>
      r.beds
        .filter((b) => (b.activeStatus ?? "ACTIVE") === "ACTIVE" && !b.tenantId && b.availabilityStatus !== "OCCUPIED" && !b.pendingInvitation)
        .map((b) => ({ key: b.id, bedId: b.id, label: `Room ${r.roomNumber} · Bed ${b.bedNumber}`, rent: b.rent ?? r.rentPerBed, deposit: r.securityDeposit })),
    );
  }
  const unitLabel = p.type?.unitLabel ?? "Unit";
  return p.units
    .filter((u) => u.activeStatus === "ACTIVE" && u.availabilityStatus !== "OCCUPIED" && !u.pendingInvitation)
    .map((u) => ({ key: u.id, unitId: u.id, label: u.name || `${unitLabel} ${u.unitNumber ?? u.code}`, rent: u.pricing?.monthlyRent ?? p.pricing?.monthlyRent ?? null, deposit: u.pricing?.securityDeposit ?? p.pricing?.securityDeposit ?? null }));
}

const today = () => new Date().toISOString().slice(0, 10);

/** Copy / WhatsApp / SMS for a freshly made link. The link is shown only once, so say so. */
export function ShareLink({ link, phone }: { link: InviteLink; phone?: string | null }) {
  const [copied, setCopied] = useState(false);
  const digits = (phone ?? "").replace(/\D/g, "");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="space-y-3">
      <Alert kind="success">Share this link with the tenant. For security it is shown only now — if you lose it, make a new link.</Alert>
      <div className="flex items-center gap-2 rounded-control border border-line bg-subtle p-2">
        <Link2 className="size-4 shrink-0 text-muted" />
        <input readOnly aria-label="Invitation link" value={link.url} className="min-w-0 flex-1 bg-transparent text-sm outline-none" onFocus={(e) => e.target.select()} />
        <Button size="sm" variant="secondary" leftIcon={<Copy className="size-4" />} onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <a className="inline-flex min-h-10 items-center gap-2 rounded-control bg-[#25D366] px-3 text-sm font-semibold text-white" href={`https://wa.me/${digits}?text=${encodeURIComponent(link.shareText)}`} target="_blank" rel="noreferrer">
          <MessageCircle className="size-4" /> Share on WhatsApp
        </a>
        <a className="inline-flex min-h-10 items-center gap-2 rounded-control border border-line px-3 text-sm font-semibold" href={`sms:${phone ?? ""}?&body=${encodeURIComponent(link.shareText)}`}>
          <Smartphone className="size-4" /> Send SMS
        </a>
      </div>
      <p className="text-xs text-muted">Expires {formatTimestamp(link.expiresAt)}. Only the tenant with this phone number can accept it.</p>
    </div>
  );
}

export function InviteTenantModal({ p, open, initialTarget, onClose, onCreated }: { p: PropertyDetail; open: boolean; initialTarget?: string; onClose: () => void; onCreated: () => void }) {
  const targets = useMemo(() => inviteTargets(p), [p]);
  const needsTarget = p.structure === "ROOMS_BEDS" || p.units.length > 1;
  const first = targets.find((t) => t.key === initialTarget) ?? (needsTarget ? undefined : targets[0]);
  const [v, setV] = useState(() => ({
    target: first?.key ?? "",
    recipientName: "",
    recipientPhone: "",
    recipientEmail: "",
    monthlyRent: first?.rent ?? "",
    securityDeposit: first?.deposit ?? "",
    maintenanceCharges: "",
    startDate: today(),
    endDate: "",
    rentDueDay: String(p.pricing?.rentDueDay ?? 5),
    noticePeriodDays: p.pricing?.noticePeriodDays?.toString() ?? "",
    lockInMonths: p.pricing?.lockInPeriodMonths?.toString() ?? "",
    additionalTerms: "",
    expiresInDays: "7",
  }));
  // What the tenant answers / shares when accepting (minimum data only).
  const [ask, setAsk] = useState({ askDetails: true, companyName: "OFF" as "OFF" | "OPTIONAL" | "REQUIRED", references: "0", backgroundVerification: false, documents: [] as string[] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<InviteLink | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  const pick = (key: string) => {
    const t = targets.find((x) => x.key === key);
    setV({ ...v, target: key, monthlyRent: t?.rent ?? v.monthlyRent, securityDeposit: t?.deposit ?? v.securityDeposit });
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const t = targets.find((x) => x.key === v.target);
      const opt = (s: string) => (s.trim() === "" ? undefined : s.trim());
      const res = await request<{ link: InviteLink }>(`/properties/${p.id}/invitations`, {
        method: "POST",
        body: {
          unitId: t?.unitId,
          bedId: t?.bedId,
          recipientName: v.recipientName.trim(),
          recipientPhone: v.recipientPhone,
          recipientEmail: opt(v.recipientEmail),
          monthlyRent: v.monthlyRent,
          securityDeposit: opt(v.securityDeposit) ?? "0",
          maintenanceCharges: opt(v.maintenanceCharges),
          startDate: v.startDate,
          endDate: opt(v.endDate),
          rentDueDay: Number(v.rentDueDay),
          noticePeriodDays: opt(v.noticePeriodDays) ? Number(v.noticePeriodDays) : undefined,
          lockInMonths: opt(v.lockInMonths) ? Number(v.lockInMonths) : undefined,
          additionalTerms: opt(v.additionalTerms),
          expiresInDays: Number(v.expiresInDays),
          requirements: { ...ask, references: Number(ask.references) },
        },
      });
      setLink(res.link);
      onCreated();
    } catch (err) {
      const issues = err instanceof AppError ? (err.details?.issues as Array<{ message: string }> | undefined) : undefined;
      setError(issues?.length ? issues.map((i) => i.message).join(" · ") : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const ready = v.recipientName.trim().length >= 2 && v.recipientPhone && Number(v.monthlyRent) > 0 && v.startDate && (!needsTarget || v.target);

  return (
    <Modal open={open} onClose={onClose} title={link ? "Invitation ready" : "Invite tenant"} description={link ? undefined : "The tenant signs in with this phone number and accepts. The flat is marked occupied only after they accept."}>
      {link ? (
        <>
          <ShareLink link={link} phone={v.recipientPhone} />
          <div className="mt-4 flex justify-end"><Button onClick={onClose}>Done</Button></div>
        </>
      ) : targets.length === 0 ? (
        <>
          <Alert kind="info">Everything in this property is occupied or already has a pending invitation. Add a {p.structure === "ROOMS_BEDS" ? "bed" : (p.type?.unitLabel ?? "unit").toLowerCase()} first, or end a lease.</Alert>
          <div className="mt-4 flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
        </>
      ) : (
        <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
          {needsTarget && (
            <Select label={p.structure === "ROOMS_BEDS" ? "Bed *" : `${p.type?.unitLabel ?? "Unit"} *`} placeholder="Choose" options={targets.map((t) => ({ value: t.key, label: t.label }))} value={v.target} onChange={(e) => pick(e.target.value)} />
          )}
          <Input label="Tenant full name *" maxLength={120} value={v.recipientName} onChange={set("recipientName")} />
          <PhoneField label="Tenant phone *" hint="They must sign in with this number to accept." value={v.recipientPhone} onChange={(val) => setV({ ...v, recipientPhone: val })} />
          <Input label="Tenant email (optional)" type="email" value={v.recipientEmail} onChange={set("recipientEmail")} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Monthly rent (₹) *" type="number" min={0} value={v.monthlyRent} onChange={set("monthlyRent")} />
            <Input label="Security deposit (₹)" type="number" min={0} value={v.securityDeposit} onChange={set("securityDeposit")} />
            <Input label="Maintenance (₹/month)" type="number" min={0} value={v.maintenanceCharges} onChange={set("maintenanceCharges")} />
            <Input label="Rent due day (1–28) *" type="number" min={1} max={28} value={v.rentDueDay} onChange={set("rentDueDay")} />
            <Input label="Start date *" type="date" value={v.startDate} onChange={set("startDate")} />
            <Input label="End date (optional)" type="date" hint="Default: 11 months" value={v.endDate} onChange={set("endDate")} />
            <Input label="Notice period (days)" type="number" min={0} value={v.noticePeriodDays} onChange={set("noticePeriodDays")} />
            <Input label="Lock-in (months)" type="number" min={0} value={v.lockInMonths} onChange={set("lockInMonths")} />
          </div>
          <Textarea label="Additional terms" rows={2} maxLength={5000} value={v.additionalTerms} onChange={set("additionalTerms")} />
          <fieldset className="space-y-2 rounded-lg border border-line p-3">
            <legend className="px-1 text-sm font-semibold">Ask the tenant</legend>
            <p className="text-xs text-muted">Ask only what you need. SafeRent never asks religion, caste, food habits, marital status, salary or ID numbers.</p>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ask.askDetails} onChange={(e) => setAsk({ ...ask, askDetails: e.target.checked })} /> Basic details: student / working / family, employment type, people staying, pets, smoking, planned stay</label>
            <div className="grid grid-cols-2 gap-3">
              <Select label="Company name" options={[{ value: "OFF", label: "Don't ask" }, { value: "OPTIONAL", label: "Optional" }, { value: "REQUIRED", label: "Required" }]} value={ask.companyName} onChange={(e) => setAsk({ ...ask, companyName: e.target.value as typeof ask.companyName })} />
              <Select label="References" options={[{ value: "0", label: "None" }, { value: "1", label: "1 reference" }, { value: "2", label: "2 references" }]} value={ask.references} onChange={(e) => setAsk({ ...ask, references: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ask.backgroundVerification} onChange={(e) => setAsk({ ...ask, backgroundVerification: e.target.checked })} /> Tenant must agree to a background verification</label>
            <div>
              <p className="mb-1 text-sm">Documents to share after accepting</p>
              <div className="flex flex-wrap gap-3 text-sm">
                {[["ID_PROOF", "Government ID (any one)"], ["PAN", "PAN card"], ["EMPLOYMENT_OR_STUDENT_ID", "Employee or student ID"], ["OTHER", "Other document"]].map(([k, label]) => (
                  <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={ask.documents.includes(k)} onChange={(e) => setAsk({ ...ask, documents: e.target.checked ? [...ask.documents, k] : ask.documents.filter((x) => x !== k) })} /> {label}</label>
                ))}
              </div>
            </div>
          </fieldset>
          <Select label="Link valid for" options={["1", "3", "7", "14", "30"].map((d) => ({ value: d, label: `${d} day${d === "1" ? "" : "s"}` }))} value={v.expiresInDays} onChange={set("expiresInDays")} />
          {error && <Alert kind="error">{error}</Alert>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button loading={busy} disabled={!ready} leftIcon={<UserPlus className="size-4" />} onClick={() => void submit()}>Create link</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

const STATUS_TONE: Record<Invitation["status"], "brand" | "success" | "neutral" | "danger" | "warning"> = { PENDING: "brand", ACCEPTED: "success", REJECTED: "danger", REVOKED: "neutral", EXPIRED: "warning" };

/** Property page → "Tenant invites" tab. */
/** canManage = New link / Revoke on existing invitations; canInvite = the "Invite tenant" button (hidden when nothing is free to invite). */
export function InvitationsTab({ p, canManage, canInvite = canManage, onInvite, reloadKey }: { p: PropertyDetail; canManage: boolean; canInvite?: boolean; onInvite: () => void; reloadKey: number }) {
  const { data, loading, error, reload } = useQuery(() => request<Paged<Invitation>>("/invitations", { query: { propertyId: p.id, pageSize: 50 } }), [p.id, reloadKey]);
  const { confirm, dialog } = useConfirm();
  const [shown, setShown] = useState<{ link: InviteLink; phone: string | null } | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [detailsOf, setDetailsOf] = useState<Invitation | null>(null);

  const newLink = async (inv: Invitation) => {
    setMsg(null);
    try {
      const res = await request<{ link: InviteLink }>(`/invitations/${inv.id}/link`, { method: "POST", body: { expiresInDays: 7 } });
      setShown({ link: res.link, phone: inv.recipientPhone });
      await reload();
    } catch (err) {
      setMsg({ kind: "error", text: errorMessage(err) });
    }
  };

  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Tenant invitations</h2>
          <p className="text-sm text-muted">Tenant visited you and agreed? Send them a link — they sign in and accept, and the lease starts.</p>
        </div>
        {canInvite && <Button leftIcon={<UserPlus className="size-4" />} onClick={onInvite}>Invite tenant</Button>}
      </div>
      {msg && <Alert kind={msg.kind} className="mb-3">{msg.text}</Alert>}
      {loading && !data && <div className="flex justify-center py-8"><Spinner className="size-6 text-brand" /></div>}
      {error && <Alert kind="error">{error}</Alert>}
      {data && data.items.length === 0 && <p className="text-sm text-muted">No invitations yet.</p>}
      <ul className="divide-y divide-line">
        {data?.items.map((inv) => (
          <li key={inv.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-semibold">
                {inv.recipientName} <span className="text-xs font-normal text-muted">{inv.recipientPhone} · {inv.code}</span>
              </p>
              <p className="text-sm text-muted">
                {inv.target ?? "Whole property"} · {formatMoney(inv.monthlyRent)}/mo · from {formatDate(inv.startDate)}
                {inv.status === "PENDING" && ` · expires ${formatTimestamp(inv.expiresAt)}`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[inv.status]}>{inv.status === "PENDING" ? "Waiting for tenant" : inv.status.charAt(0) + inv.status.slice(1).toLowerCase()}</Badge>
              {inv.status === "ACCEPTED" && <Button size="sm" variant="secondary" onClick={() => setDetailsOf(inv)}>Tenant details</Button>}
              {inv.leaseId && <Link className="text-sm font-semibold text-brand-dark hover:text-brand" to="/leases">View lease</Link>}
              {canManage && ["PENDING", "EXPIRED"].includes(inv.status) && (
                <Button size="sm" variant="secondary" leftIcon={<RefreshCw className="size-4" />} onClick={() => void newLink(inv)}>New link</Button>
              )}
              {canManage && inv.status === "PENDING" && (
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<XCircle className="size-4 text-danger" />}
                  onClick={() =>
                    confirm({
                      title: "Revoke invitation",
                      message: "The link stops working immediately.",
                      tone: "danger",
                      confirmLabel: "Revoke",
                      onConfirm: async () => {
                        await request(`/invitations/${inv.id}/revoke`, { method: "POST" });
                        setMsg({ kind: "success", text: "Invitation revoked." });
                        await reload();
                      },
                    })
                  }
                >
                  Revoke
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Modal open={!!shown} onClose={() => setShown(null)} title="New invitation link" description="The old link no longer works.">
        {shown && <ShareLink link={shown.link} phone={shown.phone} />}
        <div className="mt-4 flex justify-end"><Button onClick={() => setShown(null)}>Done</Button></div>
      </Modal>
      {detailsOf && <TenantDetailsModal inv={detailsOf} onClose={() => setDetailsOf(null)} />}
      {dialog}
    </section>
  );
}

interface TenantDetailsResponse {
  details: null | {
    tenantType: string | null;
    employmentType: string | null;
    companyName: string | null;
    adults: number | null;
    children: number | null;
    hasPets: boolean | null;
    petDetails: string | null;
    smokes: boolean | null;
    stayMonths: number | null;
    references: Array<{ name: string; relation: string; phone: string }>;
    backgroundConsentAt: string | null;
    leaseActive: boolean;
  };
  documents: Array<{ key: string; label: string; shared: boolean }>;
  conflicts: string[];
}

const nice = (s: string | null | undefined) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ") : "—");
const yn = (b: boolean | null | undefined) => (b == null ? "—" : b ? "Yes" : "No");

/** What the tenant answered when accepting (company and references only while the lease is active). */
function TenantDetailsModal({ inv, onClose }: { inv: Invitation; onClose: () => void }) {
  const { data, loading, error } = useQuery(() => request<TenantDetailsResponse>(`/invitations/${inv.id}/tenant-details`), [inv.id]);
  const d = data?.details;
  return (
    <Modal open onClose={onClose} title={`Tenant details · ${inv.recipientName}`}>
      {loading && !data && <div className="flex justify-center py-6"><Spinner className="size-6 text-brand" /></div>}
      {error && <Alert kind="error">{error}</Alert>}
      {data && !d && <p className="text-sm text-muted">Nothing was asked on this invitation.</p>}
      {d && (
        <div className="space-y-3 text-sm">
          {data.conflicts.length > 0 && <Alert kind="warning">{data.conflicts.join(" ")}</Alert>}
          <dl className="grid grid-cols-2 gap-2">
            <dt className="text-muted">Tenant type</dt><dd>{nice(d.tenantType)}</dd>
            <dt className="text-muted">Employment</dt><dd>{nice(d.employmentType)}</dd>
            <dt className="text-muted">Company</dt><dd>{d.companyName ?? "—"}</dd>
            <dt className="text-muted">People staying</dt><dd>{d.adults ?? "—"} adults{d.children ? `, ${d.children} children` : ""}</dd>
            <dt className="text-muted">Pets</dt><dd>{yn(d.hasPets)}{d.petDetails ? ` (${d.petDetails})` : ""}</dd>
            <dt className="text-muted">Smokes</dt><dd>{yn(d.smokes)}</dd>
            <dt className="text-muted">Planned stay</dt><dd>{d.stayMonths ? `${d.stayMonths} months` : "—"}</dd>
            <dt className="text-muted">Background check</dt><dd>{d.backgroundConsentAt ? `Agreed ${formatDate(d.backgroundConsentAt)}` : "Not asked"}</dd>
          </dl>
          {d.references.length > 0 && (
            <div>
              <p className="mb-1 font-semibold">References</p>
              <ul>{d.references.map((r, i) => <li key={i}>{r.name} ({r.relation}) · {r.phone}</li>)}</ul>
            </div>
          )}
          {!d.leaseActive && <p className="text-xs text-muted">Company name and references are hidden because the lease is not active.</p>}
          {data.documents.length > 0 && (
            <div>
              <p className="mb-1 font-semibold">Documents</p>
              <ul>{data.documents.map((x) => <li key={x.key}>{x.label}: {x.shared ? <Badge tone="success">Shared</Badge> : <Badge tone="warning">Not shared yet</Badge>}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      <div className="mt-4 flex justify-end"><Button onClick={onClose}>Close</Button></div>
    </Modal>
  );
}

