import { CalendarPlus, CheckCheck } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { DataTable, EmptyState, Pagination } from "@/components/data/DataTable";
import { ListToolbar } from "@/components/data/ListToolbar";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Tabs } from "@/components/ui/Tabs";
import { useAuth } from "@/hooks/useAuth";
import { useListParams } from "@/hooks/useListParams";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import type { Paged } from "@/types/auth";
import { cn } from "@/utils/cn";
import { ALL_ROLES, ROLE_LABELS } from "@/utils/constants";
import { errorMessage } from "@/utils/errors";
import { formatMoney, formatTimestamp, labelize, timeAgo, toOptions } from "@/utils/format";

/* ═══════════ Enquiries & visits ═══════════ */

interface Enquiry {
  id: string;
  message: string;
  status: string;
  followUpAt: string | null;
  notes: string | null;
  createdAt: string;
  property: { id: string; title: string; city: string };
  tenant?: { id: string; fullName?: string; phoneNumber?: string | null };
}
interface Visit {
  id: string;
  scheduledAt: string;
  status: string;
  notes: string | null;
  property: { id: string; title: string; addressLine: string; city: string };
}

export function EnquiriesPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "visits" ? "visits" : "enquiries";
  return (
    <>
      <PageHeader title="Enquiries & visits" description="Follow up with prospective tenants and schedule property visits." />
      <Tabs<"enquiries" | "visits"> idPrefix="enq" className="mb-5 max-w-md" value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} items={[{ value: "enquiries", label: "Enquiries" }, ...(can("visits.manage") ? [{ value: "visits" as const, label: "Visits" }] : [])]} />
      {tab === "enquiries" ? <EnquiriesTab /> : <VisitsTab />}
    </>
  );
}

function EnquiriesTab() {
  const { can } = useAuth();
  const list = useListParams(["status"]);
  const { data, loading, error, reload } = useQuery(() => request<Paged<Enquiry>>("/enquiries", { query: list.query }), [list.query]);
  const [open, setOpen] = useState<Enquiry | null>(null);
  return (
    <>
      <ListToolbar filters={[{ name: "status", label: "Status", options: toOptions(["NEW", "CONTACTED", "VISIT_SCHEDULED", "CLOSED"]) }]} values={list.filters} onFilter={list.setFilter} />
      <DataTable
        rows={data?.items}
        loading={loading}
        error={error}
        rowKey={(e) => e.id}
        onRowClick={can("enquiries.manage") ? setOpen : undefined}
        empty="No enquiries yet."
        columns={[
          { key: "who", header: "Prospect", render: (e) => <span><span className="block font-semibold">{e.tenant?.fullName ?? "—"}</span><span className="text-xs text-muted">{e.tenant?.phoneNumber ?? ""}</span></span> },
          { key: "property", header: "Property", render: (e) => e.property.title },
          { key: "message", header: "Message", render: (e) => <span className="line-clamp-2 text-sm">{e.message}</span>, className: "hidden lg:table-cell" },
          { key: "follow", header: "Follow-up", render: (e) => (e.followUpAt ? formatTimestamp(e.followUpAt) : "—"), className: "hidden xl:table-cell" },
          { key: "status", header: "Status", render: (e) => <StatusBadge status={e.status} /> },
        ]}
      />
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={list.setPage} />}
      {open && <EnquiryModal enquiry={open} onClose={() => setOpen(null)} onDone={async () => { setOpen(null); await reload(); }} />}
    </>
  );
}

function EnquiryModal({ enquiry, onClose, onDone }: { enquiry: Enquiry; onClose: () => void; onDone: () => Promise<void> }) {
  const { can } = useAuth();
  const [status, setStatus] = useState(enquiry.status);
  const [followUpAt, setFollowUpAt] = useState(enquiry.followUpAt?.slice(0, 16) ?? "");
  const [notes, setNotes] = useState(enquiry.notes ?? "");
  const [visitAt, setVisitAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={enquiry.tenant?.fullName ?? "Enquiry"} description={enquiry.property.title}>
      <div className="space-y-4 text-sm">
        {error && <Alert kind="error">{error}</Alert>}
        <p className="rounded-control bg-subtle p-3">{enquiry.message}</p>
        {enquiry.tenant?.phoneNumber && <p>Phone: <a className="font-semibold text-brand-dark" href={`tel:${enquiry.tenant.phoneNumber}`}>{enquiry.tenant.phoneNumber}</a></p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Status" options={toOptions(["NEW", "CONTACTED", "VISIT_SCHEDULED", "CLOSED"])} value={status} onChange={(e) => setStatus(e.target.value)} />
          <Input label="Follow up on" type="datetime-local" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} />
        </div>
        <Textarea label="Notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
        <Button loading={busy} onClick={() => void run(() => request(`/enquiries/${enquiry.id}`, { method: "PATCH", body: { status, notes, followUpAt: followUpAt ? new Date(followUpAt).toISOString() : null } }))}>Save follow-up</Button>
        {can("visits.manage") && (
          <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-end">
            <div className="flex-1"><Input label="Schedule a visit" type="datetime-local" value={visitAt} onChange={(e) => setVisitAt(e.target.value)} /></div>
            <Button variant="secondary" leftIcon={<CalendarPlus className="size-4" />} disabled={!visitAt || busy} onClick={() => void run(() => request("/visits", { method: "POST", body: { propertyId: enquiry.property.id, enquiryId: enquiry.id, scheduledAt: new Date(visitAt).toISOString() } }))}>
              Schedule
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function VisitsTab() {
  const list = useListParams(["upcoming"]);
  const { data, loading, error, reload } = useQuery(() => request<Paged<Visit>>("/visits", { query: list.query }), [list.query]);
  const { confirm, dialog } = useConfirm();
  const set = (v: Visit, status: string) =>
    confirm({ title: `Mark as ${labelize(status).toLowerCase()}`, message: v.property.title, confirmLabel: "Save", reason: { label: "Notes (optional)" }, onConfirm: async (notes) => { await request(`/visits/${v.id}`, { method: "PATCH", body: { status, notes: notes || undefined } }); await reload(); } });
  return (
    <>
      <ListToolbar filters={[{ name: "upcoming", label: "When", options: [{ value: "true", label: "Upcoming only" }] }]} values={list.filters} onFilter={list.setFilter} />
      <DataTable
        rows={data?.items}
        loading={loading}
        error={error}
        rowKey={(v) => v.id}
        empty="No visits scheduled."
        columns={[
          { key: "when", header: "When", render: (v) => <span className="font-semibold">{formatTimestamp(v.scheduledAt)}</span> },
          { key: "property", header: "Property", render: (v) => <span>{v.property.title}<span className="block text-xs text-muted">{v.property.addressLine}, {v.property.city}</span></span> },
          { key: "status", header: "Status", render: (v) => <StatusBadge status={v.status} /> },
          { key: "actions", header: "", className: "text-right", render: (v) => v.status === "SCHEDULED" ? <span className="flex flex-wrap justify-end gap-2"><Button size="sm" onClick={() => set(v, "COMPLETED")}>Done</Button><Button size="sm" variant="ghost" onClick={() => set(v, "NO_SHOW")}>No-show</Button><Button size="sm" variant="ghost" onClick={() => set(v, "CANCELLED")}>Cancel</Button></span> : null },
        ]}
      />
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={list.setPage} />}
      {dialog}
    </>
  );
}

/* ═══════════ Notifications ═══════════ */

interface Notification {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export function NotificationsPage() {
  const navigate = useNavigate();
  const list = useListParams(["unread"]);
  const { data, loading, error, reload } = useQuery(() => request<Paged<Notification> & { unread: number }>("/notifications", { query: list.query }), [list.query]);
  const markRead = async (id?: string) => {
    await request("/notifications/read", { method: "POST", body: id ? { id } : {} });
    await reload();
  };
  return (
    <>
      <PageHeader title="Notifications" description={data ? `${data.unread} unread` : undefined} actions={!!data?.unread && <Button variant="secondary" leftIcon={<CheckCheck className="size-4" />} onClick={() => void markRead()}>Mark all read</Button>} />
      <ListToolbar filters={[{ name: "unread", label: "Show", options: [{ value: "true", label: "Unread only" }] }]} values={list.filters} onFilter={list.setFilter} />
      {error && <Alert kind="error">{error}</Alert>}
      {loading && !data ? (
        <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>
      ) : !data?.items.length ? (
        <EmptyState text="You're all caught up." />
      ) : (
        <ul className="card divide-y divide-line">
          {data.items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={async () => {
                  if (!n.readAt) await markRead(n.id);
                  if (n.link) navigate(n.link);
                }}
                className={cn("flex w-full gap-3 p-4 text-left hover:bg-subtle/60", !n.readAt && "bg-brand-bg/40")}
              >
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-line" : "bg-brand")} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">{n.title}</span>
                  <span className="block text-sm text-ink-2">{n.body}</span>
                  <span className="block text-xs text-muted">{timeAgo(n.createdAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={list.setPage} />}
    </>
  );
}

/* ═══════════ Reports ═══════════ */

interface PropertyReportRow {
  id: string;
  code: string;
  title: string | null;
  city: string | null;
  publicationStatus: string;
  activeStatus: string;
  rentFrom: string | null;
  rentTo: string | null;
  occupied: boolean;
  openMaintenance: number;
  rentCollected?: number;
  rentPending?: number;
}
interface Overview {
  usersByRole: Array<{ key: string; count: number }>;
  propertiesByStatus: Array<{ key: string; count: number }>;
  leasesByStatus: Array<{ key: string; count: number }>;
  ticketsByStatus: Array<{ key: string; count: number }>;
  maintenanceByStatus: Array<{ key: string; count: number }>;
}

export function ReportsPage() {
  const { permissions } = useAuth();
  const global = !!permissions["reports.view"]?.includes("ALL");
  const list = useListParams([]);
  const overview = useQuery(() => request<Overview>("/reports/overview"), [], global);
  const props = useQuery(() => request<Paged<PropertyReportRow>>("/reports/properties", { query: list.query }), [list.query]);
  const showMoney = props.data?.items.some((r) => r.rentCollected !== undefined);

  return (
    <>
      <PageHeader title="Reports" description={global ? "Platform-wide analytics." : "Reports for your properties."} />
      {global && overview.data && (
        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Breakdown title="Users by role" rows={overview.data.usersByRole} label={(k) => ROLE_LABELS[k] ?? k} />
          <Breakdown title="Properties by status" rows={overview.data.propertiesByStatus} />
          <Breakdown title="Leases" rows={overview.data.leasesByStatus} />
          <Breakdown title="Support tickets" rows={overview.data.ticketsByStatus} />
          <Breakdown title="Maintenance" rows={overview.data.maintenanceByStatus} />
        </div>
      )}
      <h2 className="mb-3 text-base font-semibold">Property report</h2>
      <DataTable
        rows={props.data?.items}
        loading={props.loading}
        error={props.error}
        rowKey={(r) => r.id}
        empty="No properties in your report."
        columns={[
          { key: "title", header: "Property", render: (r) => <Link to={`/properties/${r.id}`} className="font-semibold hover:text-brand">{r.title ?? r.code}</Link> },
          { key: "status", header: "Status", render: (r) => <span className="flex flex-wrap gap-1"><StatusBadge status={r.publicationStatus} />{r.activeStatus !== "ACTIVE" && <StatusBadge status={r.activeStatus} />}{r.occupied ? <Badge tone="success">Occupied</Badge> : <Badge>Vacant</Badge>}</span> },
          { key: "rent", header: "Rent", render: (r) => (r.rentFrom ? (r.rentTo && r.rentTo !== r.rentFrom ? `${formatMoney(r.rentFrom)} – ${formatMoney(r.rentTo)}` : formatMoney(r.rentFrom)) : "—") },
          ...(showMoney
            ? [
                { key: "collected", header: "Collected", render: (r: PropertyReportRow) => formatMoney(r.rentCollected) },
                { key: "pending", header: "Pending", render: (r: PropertyReportRow) => formatMoney(r.rentPending) },
              ]
            : []),
          { key: "maint", header: "Open maintenance", render: (r) => r.openMaintenance, className: "hidden lg:table-cell" },
        ]}
      />
      {props.data && <Pagination page={props.data.page} totalPages={props.data.totalPages} total={props.data.total} onPage={list.setPage} />}
    </>
  );
}

function Breakdown({ title, rows, label = labelize }: { title: string; rows: Array<{ key: string; count: number }>; label?: (k: string) => string }) {
  const total = rows.reduce((s, r) => s + r.count, 0) || 1;
  return (
    <section className="card p-5">
      <h3 className="mb-3 font-semibold">{title}</h3>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.key} className="text-sm">
            <div className="flex justify-between"><span>{label(r.key)}</span><span className="font-semibold">{r.count}</span></div>
            <div className="mt-1 h-1.5 rounded-full bg-subtle"><div className="h-1.5 rounded-full bg-brand" style={{ width: `${(r.count / total) * 100}%` }} /></div>
          </li>
        ))}
        {!rows.length && <li className="text-sm text-muted">No data yet.</li>}
      </ul>
    </section>
  );
}

/* ═══════════ Audit logs ═══════════ */

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "activity" ? "activity" : "security";
  const list = useListParams(["outcome", "targetType"]);
  const security = useQuery(() => request<Paged<{ id: string; action: string; outcome: string; reason: string | null; ip: string | null; userName: string | null; createdAt: string }>>("/audit/security", { query: list.query }), [list.query], tab === "security");
  const activity = useQuery(() => request<Paged<{ id: string; action: string; targetType: string; targetId: string | null; actorName: string | null; changes: unknown; createdAt: string }>>("/audit/activity", { query: list.query }), [list.query], tab === "activity");
  return (
    <>
      <PageHeader title="Audit logs" description="Security events and every administrative / financial change. Logs are append-only." />
      <Tabs<"security" | "activity"> idPrefix="audit" className="mb-5 max-w-md" value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} items={[{ value: "security", label: "Security" }, { value: "activity", label: "Admin activity" }]} />
      <ListToolbar search={list.q} onSearch={list.setSearch} placeholder="Search action (e.g. refund, login)" filters={tab === "security" ? [{ name: "outcome", label: "Outcome", options: toOptions(["SUCCESS", "FAILURE"]) }] : [{ name: "targetType", label: "Target", options: toOptions(["user", "role", "property", "rent_payment", "transaction", "refund", "invoice", "platform_setting"]) }]} values={list.filters} onFilter={list.setFilter} />
      {tab === "security" ? (
        <>
          <DataTable rows={security.data?.items} loading={security.loading} error={security.error} rowKey={(r) => r.id} empty="No events." columns={[
            { key: "when", header: "When", render: (r) => formatTimestamp(r.createdAt) },
            { key: "action", header: "Event", render: (r) => <span className="font-medium">{labelize(r.action)}{r.reason ? <span className="block text-xs text-muted">{labelize(r.reason)}</span> : null}</span> },
            { key: "user", header: "User", render: (r) => r.userName ?? "—" },
            { key: "outcome", header: "Outcome", render: (r) => <StatusBadge status={r.outcome} /> },
            { key: "ip", header: "IP", render: (r) => r.ip ?? "—", className: "hidden lg:table-cell" },
          ]} />
          {security.data && <Pagination page={security.data.page} totalPages={security.data.totalPages} total={security.data.total} onPage={list.setPage} />}
        </>
      ) : (
        <>
          <DataTable rows={activity.data?.items} loading={activity.loading} error={activity.error} rowKey={(r) => r.id} empty="No activity." columns={[
            { key: "when", header: "When", render: (r) => formatTimestamp(r.createdAt) },
            { key: "actor", header: "By", render: (r) => r.actorName ?? "—" },
            { key: "action", header: "Action", render: (r) => <span className="font-medium">{labelize(r.action)}</span> },
            { key: "target", header: "Target", render: (r) => `${labelize(r.targetType)}${r.targetId ? ` · ${r.targetId.slice(0, 8)}` : ""}`, className: "hidden lg:table-cell" },
            { key: "changes", header: "Details", render: (r) => <code className="line-clamp-2 break-all text-[11px] text-muted">{JSON.stringify(r.changes)}</code>, className: "hidden xl:table-cell" },
          ]} />
          {activity.data && <Pagination page={activity.data.page} totalPages={activity.data.totalPages} total={activity.data.total} onPage={list.setPage} />}
        </>
      )}
    </>
  );
}

/* ═══════════ Platform settings & subscriptions ═══════════ */

interface Plan {
  id: string;
  name: string;
  audience: string;
  priceMonthly: string;
  features: string | null;
  active: boolean;
  _count: { subscriptions: number };
}

export function PlatformPage() {
  const { can } = useAuth();
  const settings = useQuery(() => request<{ settings: Record<string, string> }>("/settings"), [], can("settings.manage"));
  const plans = useQuery(() => request<{ items: Plan[] }>("/subscriptions/plans"), [], can("subscriptions.manage"));
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const { confirm, dialog } = useConfirm();
  const values = { ...(settings.data?.settings ?? {}), ...draft };

  const saveSettings = () =>
    confirm({
      title: "Save platform settings",
      message: "These changes affect the whole platform and are recorded in the audit log.",
      confirmLabel: "Save",
      onConfirm: async () => {
        await request("/settings", { method: "PUT", body: { settings: draft } });
        setDraft({});
        setMsg({ kind: "success", text: "Settings saved." });
        await settings.reload();
      },
    });

  return (
    <>
      <PageHeader title="Platform settings" description="Configuration and subscription plans (Super Admin)." />
      {msg && <Alert kind={msg.kind} className="mb-4">{msg.text}</Alert>}
      <div className="grid gap-6 xl:grid-cols-2">
        {can("settings.manage") && (
          <section className="card space-y-4 p-5 sm:p-6">
            <h2 className="font-semibold">Configuration</h2>
            {settings.loading && !settings.data ? <Spinner className="text-brand" /> : Object.keys(values).map((key) => (
              <Input key={key} label={labelize(key)} value={values[key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} />
            ))}
            <Button disabled={!Object.keys(draft).length} onClick={saveSettings}>Save settings</Button>
          </section>
        )}
        {can("subscriptions.manage") && (
          <section className="card p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Subscription plans</h2>
              <Button size="sm" onClick={() => setPlanOpen(true)}>Add plan</Button>
            </div>
            <ul className="divide-y divide-line">
              {(plans.data?.items ?? []).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <span>
                    <span className="block font-semibold">{p.name} {!p.active && <Badge>Inactive</Badge>}</span>
                    <span className="text-xs text-muted">{ROLE_LABELS[p.audience]} · {formatMoney(p.priceMonthly)}/mo · {p._count.subscriptions} active</span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => request(`/subscriptions/plans/${p.id}`, { method: "PATCH", body: { active: !p.active } }).then(() => plans.reload()).catch((e) => setMsg({ kind: "error", text: errorMessage(e) }))}>
                    {p.active ? "Deactivate" : "Activate"}
                  </Button>
                </li>
              ))}
              {!plans.data?.items.length && <li className="py-3 text-sm text-muted">No plans yet.</li>}
            </ul>
          </section>
        )}
      </div>
      <PlanModal open={planOpen} onClose={() => setPlanOpen(false)} onDone={async () => { setPlanOpen(false); await plans.reload(); }} />
      {dialog}
    </>
  );
}

function PlanModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [form, setForm] = useState({ name: "", audience: "LANDLORD", priceMonthly: "", features: "" });
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    try {
      await request("/subscriptions/plans", { method: "POST", body: { ...form, priceMonthly: Number(form.priceMonthly) } });
      setForm({ name: "", audience: "LANDLORD", priceMonthly: "", features: "" });
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="New subscription plan">
      <div className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="For" options={ALL_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} />
          <Input label="Price / month (₹)" type="number" min={0} value={form.priceMonthly} onChange={(e) => setForm({ ...form, priceMonthly: e.target.value })} />
        </div>
        <Textarea label="Features" rows={3} value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={form.name.length < 2 || form.priceMonthly === ""} onClick={() => void submit()}>Create plan</Button>
        </div>
      </div>
    </Modal>
  );
}

