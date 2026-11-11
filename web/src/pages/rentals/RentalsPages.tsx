import { FileText, Printer } from "lucide-react";
import { useState } from "react";
import { DataTable, Pagination } from "@/components/data/DataTable";
import { ListToolbar } from "@/components/data/ListToolbar";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/hooks/useAuth";
import { useListParams } from "@/hooks/useListParams";
import { useQuery } from "@/hooks/useQuery";
import { openProtected, request } from "@/services/api";
import { LeaseReviewModal } from "@/pages/reviews/ReviewsPages";
import { LeaseExitPanel } from "./LeaseExitPanel";
import { LandlordPanPanel } from "./LandlordPanPanel";
import { Badge } from "@/components/ui/Badge";
import type { Paged } from "@/types/auth";
import { errorMessage } from "@/utils/errors";
import { formatDate, formatMoney, toOptions } from "@/utils/format";

/* ═══════════ Applications ═══════════ */

interface Application {
  id: string;
  status: string;
  proposedMoveIn: string;
  occupants: number;
  message: string | null;
  decisionNote: string | null;
  createdAt: string;
  isMine: boolean;
  property: { id: string; title: string; city: string; monthlyRent: string };
  tenant: { id: string; fullName: string; profile: { occupation: string | null; familySize: number | null; currentCity: string | null } | null };
}

export function ApplicationsPage() {
  const { can, profile } = useAuth();
  const list = useListParams(["status"]);
  const { data, loading, error, reload } = useQuery(() => request<Paged<Application>>("/applications", { query: list.query }), [list.query]);
  const [deciding, setDeciding] = useState<Application | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const isTenant = profile?.role === "TENANT";

  return (
    <>
      <PageHeader title={isTenant ? "My applications" : "Rental applications"} description={isTenant ? "Track the homes you've applied for." : "Approve an application to create the lease automatically."} />
      {msg && <Alert kind="success" className="mb-4">{msg}</Alert>}
      <ListToolbar search={list.q} onSearch={list.setSearch} placeholder="Search by property" filters={[{ name: "status", label: "Status", options: toOptions(["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"]) }]} values={list.filters} onFilter={list.setFilter} />
      <DataTable
        rows={data?.items}
        loading={loading}
        error={error}
        rowKey={(a) => a.id}
        empty="No applications yet."
        columns={[
          { key: "property", header: "Property", render: (a) => <span><span className="block font-semibold">{a.property.title}</span><span className="text-xs text-muted">{a.property.city} · {formatMoney(a.property.monthlyRent)}/mo</span></span> },
          ...(!isTenant ? [{ key: "tenant", header: "Applicant", render: (a: Application) => <span><span className="block font-medium">{a.tenant.fullName}</span><span className="text-xs text-muted">{[a.tenant.profile?.occupation, a.occupants && `${a.occupants} occupant(s)`].filter(Boolean).join(" · ")}</span></span> }] : []),
          { key: "movein", header: "Move-in", render: (a) => formatDate(a.proposedMoveIn) },
          { key: "status", header: "Status", render: (a) => <StatusBadge status={a.status} /> },
          {
            key: "actions",
            header: "",
            className: "text-right",
            render: (a) =>
              a.status === "PENDING" ? (
                a.isMine ? (
                  <Button size="sm" variant="ghost" onClick={() => confirm({ title: "Withdraw application", message: `Withdraw your application for "${a.property.title}"?`, tone: "danger", confirmLabel: "Withdraw", onConfirm: async () => { await request(`/applications/${a.id}/withdraw`, { method: "POST" }); setMsg("Application withdrawn."); await reload(); } })}>
                    Withdraw
                  </Button>
                ) : can("applications.manage") ? (
                  <Button size="sm" onClick={() => setDeciding(a)}>Review</Button>
                ) : null
              ) : a.decisionNote ? (
                <span className="text-xs text-muted">{a.decisionNote}</span>
              ) : null,
          },
        ]}
      />
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={list.setPage} />}
      {deciding && <DecisionModal application={deciding} onClose={() => setDeciding(null)} onDone={async (text) => { setMsg(text); setDeciding(null); await reload(); }} />}
      {dialog}
    </>
  );
}

function DecisionModal({ application, onClose, onDone }: { application: Application; onClose: () => void; onDone: (msg: string) => Promise<void> }) {
  const [startDate, setStartDate] = useState(application.proposedMoveIn.slice(0, 10));
  const [months, setMonths] = useState("11");
  const [dueDay, setDueDay] = useState("5");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"APPROVE" | "REJECT" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: "APPROVE" | "REJECT") => {
    setBusy(decision);
    setError(null);
    try {
      await request(`/applications/${application.id}/decision`, { method: "POST", body: { decision, note: note || undefined, startDate, months: Number(months), rentDueDay: Number(dueDay) } });
      await onDone(decision === "APPROVE" ? "Approved — the lease has been created and the tenant notified." : "Application rejected.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Application from ${application.tenant.fullName}`} description={application.property.title}>
      <div className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-muted">Occupation</dt><dd>{application.tenant.profile?.occupation ?? "—"}</dd></div>
          <div><dt className="text-muted">Occupants</dt><dd>{application.occupants}</dd></div>
          <div className="col-span-2"><dt className="text-muted">Message</dt><dd>{application.message ?? "—"}</dd></div>
        </dl>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="Lease start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <Input label="Months" type="number" min={1} max={60} value={months} onChange={(e) => setMonths(e.target.value)} />
          <Input label="Rent due day" type="number" min={1} max={28} value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
        </div>
        <Input label="Note to applicant (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" loading={busy === "REJECT"} disabled={!!busy} onClick={() => void decide("REJECT")}>Reject</Button>
          <Button loading={busy === "APPROVE"} disabled={!!busy} onClick={() => void decide("APPROVE")}>Approve & create lease</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ═══════════ Leases ═══════════ */

interface Party {
  id: string;
  fullName: string;
  phoneNumber?: string | null;
  email?: string | null;
}
interface Lease {
  id: string;
  status: string;
  startDate: string;
  endDate: string;
  monthlyRent: string;
  securityDeposit: string;
  rentDueDay: number;
  terms: string | null;
  place: string | null;
  exit: { status: string; requestedByRole: "TENANT" | "LANDLORD"; moveOutDate: string } | null;
  property: { id: string; title: string; addressLine: string; city: string };
  landlord: Party;
  tenant: Party;
}

export function LeasesPage() {
  const { can, profile } = useAuth();
  const list = useListParams(["status"]);
  const { data, loading, error, reload } = useQuery(() => request<Paged<Lease>>("/leases", { query: list.query }), [list.query]);
  const [open, setOpen] = useState<Lease | null>(null);
  const [reviewFor, setReviewFor] = useState<Lease | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const { confirm, dialog } = useConfirm();

  return (
    <>
      {reviewFor && <LeaseReviewModal leaseId={reviewFor.id} title={`${reviewFor.place ? `${reviewFor.place} · ` : ""}${reviewFor.property.title}`} onClose={() => setReviewFor(null)} />}
      <PageHeader title={profile?.role === "TENANT" ? "My rental" : "Leases"} description="Lease agreements, parties and terms." />
      {msg && <Alert kind={msg.kind} className="mb-4">{msg.text}</Alert>}
      <ListToolbar search={list.q} onSearch={list.setSearch} placeholder="Search by property" filters={[{ name: "status", label: "Status", options: toOptions(["ACTIVE", "ENDED", "TERMINATED"]) }]} values={list.filters} onFilter={list.setFilter} />
      <DataTable
        rows={data?.items}
        loading={loading}
        error={error}
        rowKey={(l) => l.id}
        onRowClick={setOpen}
        empty="No leases yet."
        columns={[
          { key: "property", header: "Property", render: (l) => <span className="font-semibold">{l.place ? `${l.place} · ` : ""}{l.property.title}</span> },
          { key: "parties", header: "Tenant / Landlord", render: (l) => <span className="text-sm">{l.tenant.fullName} · {l.landlord.fullName}</span>, className: "hidden lg:table-cell" },
          { key: "term", header: "Term", render: (l) => `${formatDate(l.startDate)} – ${formatDate(l.endDate)}` },
          { key: "rent", header: "Rent", render: (l) => formatMoney(l.monthlyRent) },
          { key: "status", header: "Status", render: (l) => <span className="flex flex-wrap gap-1"><StatusBadge status={l.status} />{l.exit && <Badge tone="warning">{l.exit.status === "ACCEPTED" ? `Closes ${formatDate(l.exit.moveOutDate)}` : `${l.exit.requestedByRole === "TENANT" ? "Tenant" : "Landlord"} asked to close`}</Badge>}</span> },
        ]}
      />
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={list.setPage} />}
      {open && (
        <Modal open onClose={() => setOpen(null)} title={open.place ? `${open.place} · ${open.property.title}` : open.property.title} description={`${open.property.addressLine}, ${open.property.city}`}>
          <div className="space-y-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <PartyCard title="Landlord" party={open.landlord} />
              <PartyCard title="Tenant" party={open.tenant} />
            </div>
            <dl className="grid grid-cols-2 gap-3">
              <div><dt className="text-muted">Term</dt><dd>{formatDate(open.startDate)} – {formatDate(open.endDate)}</dd></div>
              <div><dt className="text-muted">Status</dt><dd><StatusBadge status={open.status} /></dd></div>
              <div><dt className="text-muted">Monthly rent</dt><dd>{formatMoney(open.monthlyRent)} (day {open.rentDueDay})</dd></div>
              <div><dt className="text-muted">Deposit</dt><dd>{formatMoney(open.securityDeposit)}</dd></div>
            </dl>
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-control bg-subtle p-3 font-sans text-xs text-ink-2">{open.terms}</pre>
            {(open.tenant.id === profile?.id || open.landlord.id === profile?.id) && <LandlordPanPanel leaseId={open.id} />}
            {(open.tenant.id === profile?.id || open.landlord.id === profile?.id || can("leases.manage")) && <LeaseExitPanel leaseId={open.id} onChanged={() => void reload()} />}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {can("leases.manage", "ALL") && open.status === "ACTIVE" && open.tenant.id !== profile?.id && open.landlord.id !== profile?.id && (
                <Button variant="danger" onClick={() => confirm({ title: "Terminate lease", message: "Both parties are notified and the property becomes available again.", tone: "danger", confirmLabel: "Terminate", reason: { label: "Reason", required: true, minLength: 5 }, onConfirm: async (reason) => { await request(`/leases/${open.id}/terminate`, { method: "POST", body: { reason } }); setOpen(null); setMsg({ kind: "success", text: "Lease terminated." }); await reload(); } })}>
                  Terminate
                </Button>
              )}
              {open.status !== "ACTIVE" && (open.tenant.id === profile?.id || open.landlord.id === profile?.id) && (
                <Button variant="secondary" onClick={() => { setReviewFor(open); setOpen(null); }}>Review</Button>
              )}
              <Button variant="secondary" leftIcon={<Printer className="size-4" />} onClick={() => openProtected(`/leases/${open.id}/agreement`).catch((e) => setMsg({ kind: "error", text: errorMessage(e) }))}>
                Lease agreement
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {dialog}
    </>
  );
}

function PartyCard({ title, party }: { title: string; party: Party }) {
  return (
    <div className="rounded-control border border-line p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      <p className="font-medium">{party.fullName}</p>
      {party.phoneNumber && <p className="text-muted">{party.phoneNumber}</p>}
      {party.email && <p className="truncate text-muted">{party.email}</p>}
    </div>
  );
}

/* ═══════════ Rent ═══════════ */

interface RentRow {
  id: string;
  period: string;
  amount: string;
  dueDate: string;
  status: string;
  paidAt: string | null;
  method: string | null;
  receiptNumber: string | null;
  lease: { id: string; place: string | null; placeCode: string; property: { title: string; city: string }; tenant: { fullName: string }; landlord: { fullName: string } };
}
interface RentResponse extends Paged<RentRow> {
  summary: Record<string, { count: number; amount: string | number }>;
  paymentMode: "test" | "disabled";
}

export function RentPage() {
  const { can, profile } = useAuth();
  const list = useListParams(["status"]);
  const { data, loading, error, reload } = useQuery(() => request<RentResponse>("/rent", { query: list.query }), [list.query]);
  const [msg, setMsg] = useState<{ kind: "success" | "error" | "warning"; text: string } | null>(null);
  const { confirm, dialog } = useConfirm();
  const isTenant = profile?.role === "TENANT";
  const finance = can("rent.collect");

  const pay = (r: RentRow) =>
    confirm({
      title: `Pay ${formatMoney(r.amount)}`,
      message: data?.paymentMode === "test" ? "TEST MODE: the rent is marked as paid immediately and no money moves. A real payment gateway must be connected before launch." : "Online payment is not available yet.",
      confirmLabel: "Pay now",
      onConfirm: async () => {
        await request(`/rent/${r.id}/pay`, { method: "POST" });
        setMsg({ kind: "success", text: `Rent for ${r.period} paid. Download your receipt from the list.` });
        await reload();
      },
    });

  const record = (r: RentRow) =>
    confirm({
      title: `Record payment — ${r.period}`,
      message: `Record ${formatMoney(r.amount)} from ${r.lease.tenant.fullName} as received offline (bank transfer). This is logged.`,
      confirmLabel: "Record payment",
      onConfirm: async () => {
        await request(`/rent/${r.id}/record`, { method: "POST", body: { method: "BANK_TRANSFER" } });
        setMsg({ kind: "success", text: "Payment recorded." });
        await reload();
      },
    });

  const waive = (r: RentRow) =>
    confirm({
      title: `Waive rent — ${r.period}`,
      message: "Waivers are financial adjustments and are recorded in the audit log.",
      tone: "danger",
      confirmLabel: "Waive",
      reason: { label: "Reason", required: true, minLength: 5 },
      onConfirm: async (reason) => {
        await request(`/rent/${r.id}/waive`, { method: "POST", body: { reason } });
        setMsg({ kind: "success", text: "Rent waived." });
        await reload();
      },
    });

  const s = data?.summary ?? {};
  return (
    <>
      <PageHeader
        title={isTenant ? "Rent & payments" : profile?.role === "LANDLORD" ? "Rent income" : "Rent collection"}
        description="Dues are generated automatically each month from active leases."
        actions={finance && <Button variant="secondary" onClick={() => request<{ leases: number }>("/rent/generate", { method: "POST" }).then((r) => { setMsg({ kind: "success", text: `Dues generated for ${r.leases} active lease(s).` }); void reload(); }).catch((e) => setMsg({ kind: "error", text: errorMessage(e) }))}>Generate dues</Button>}
      />
      {data?.paymentMode === "test" && isTenant && <Alert kind="warning" className="mb-4">Payments are in TEST mode — no real money is collected.</Alert>}
      {msg && <Alert kind={msg.kind} className="mb-4">{msg.text}</Alert>}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(["DUE", "OVERDUE", "PAID", "WAIVED"] as const).map((k) => (
          <div key={k} className="card p-4">
            <p className="text-xs font-medium text-muted"><StatusBadge status={k} /> {s[k]?.count ?? 0}</p>
            <p className="mt-1 text-xl font-bold">{formatMoney(s[k]?.amount ?? 0)}</p>
          </div>
        ))}
      </div>
      <ListToolbar search={list.q} onSearch={list.setSearch} placeholder="Search period (2026-11) or receipt" filters={[{ name: "status", label: "Status", options: toOptions(["DUE", "OVERDUE", "PAID", "WAIVED"]) }]} values={list.filters} onFilter={list.setFilter} />
      <DataTable
        rows={data?.items}
        loading={loading}
        error={error}
        rowKey={(r) => r.id}
        empty="No rent records yet."
        columns={[
          { key: "period", header: "Period", render: (r) => <span><span className="block font-semibold">{r.period}</span>{r.receiptNumber && <span className="text-xs text-muted">{r.receiptNumber}</span>}</span> },
          { key: "property", header: "Property", render: (r) => <span><span className="font-medium">{r.lease.place ? `${r.lease.place} · ` : ""}{r.lease.property.title}</span><span className="block text-xs text-muted">{r.lease.placeCode}{!isTenant ? ` · ${r.lease.tenant.fullName}` : ""}</span></span> },
          { key: "due", header: "Due", render: (r) => formatDate(r.dueDate) },
          { key: "amount", header: "Amount", render: (r) => formatMoney(r.amount) },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          {
            key: "actions",
            header: "",
            className: "text-right",
            render: (r) => (
              <span className="flex flex-wrap justify-end gap-2">
                {["DUE", "OVERDUE"].includes(r.status) && can("rent.pay") && isTenant && data?.paymentMode === "test" && <Button size="sm" onClick={() => pay(r)}>Pay</Button>}
                {["DUE", "OVERDUE"].includes(r.status) && finance && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => record(r)}>Record</Button>
                    <Button size="sm" variant="ghost" onClick={() => waive(r)}>Waive</Button>
                  </>
                )}
                {r.status === "PAID" && (
                  <Button size="sm" variant="ghost" leftIcon={<FileText className="size-4" />} onClick={() => openProtected(`/rent/${r.id}/receipt`).catch((e) => setMsg({ kind: "error", text: errorMessage(e) }))}>
                    Receipt
                  </Button>
                )}
              </span>
            ),
          },
        ]}
      />
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={list.setPage} />}
      {dialog}
    </>
  );
}
