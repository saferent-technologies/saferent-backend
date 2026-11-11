import { Plus } from "lucide-react";
import { useState, type ChangeEvent } from "react";
import { useSearchParams } from "react-router";
import { DataTable, Pagination } from "@/components/data/DataTable";
import { ListToolbar } from "@/components/data/ListToolbar";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { PhoneField } from "@/components/ui/PhoneField";
import { Spinner } from "@/components/ui/Spinner";
import { StatCard } from "@/components/ui/StatCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Tabs } from "@/components/ui/Tabs";
import { useAuth } from "@/hooks/useAuth";
import { useListParams } from "@/hooks/useListParams";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import type { Paged } from "@/types/auth";
import { errorMessage } from "@/utils/errors";
import { formatDate, formatMoney, formatTimestamp, labelize, toOptions } from "@/utils/format";

type Tab = "transactions" | "invoices" | "refunds" | "commission" | "reports";

/** Finance workspace. Each tab appears only with its finance permission (and the API checks it again). */
export function FinancePage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = (
    [
      { value: "transactions", label: "Transactions", perm: "payments.view" },
      { value: "invoices", label: "Invoices", perm: "invoices.manage" },
      { value: "refunds", label: "Refunds", perm: "refunds.manage" },
      { value: "commission", label: "Commission", perm: "commissions.manage" },
      { value: "reports", label: "Reports", perm: "finance.reports" },
    ] as const
  ).filter((t) => can(t.perm));
  const requested = params.get("tab") as Tab | null;
  const tab: Tab = tabs.find((t) => t.value === requested)?.value ?? tabs[0]?.value ?? "transactions";

  return (
    <>
      <PageHeader title="Finance" description="Every financial action is recorded in the audit log." />
      <Tabs<Tab> idPrefix="fin" className="mb-5 max-w-3xl" value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} items={tabs.map((t) => ({ value: t.value, label: t.label }))} />
      {tab === "transactions" && <TransactionsTab />}
      {tab === "invoices" && <InvoicesTab />}
      {tab === "refunds" && <RefundsTab />}
      {tab === "commission" && <CommissionTab />}
      {tab === "reports" && <ReportsTab />}
    </>
  );
}

interface Txn {
  id: string;
  type: string;
  status: string;
  amount: string;
  reference: string;
  method: string;
  notes: string | null;
  isTest: boolean;
  reconciled: boolean;
  payerName: string | null;
  payeeName: string | null;
  createdAt: string;
}

function TransactionsTab() {
  const { can } = useAuth();
  const list = useListParams(["type", "status", "reconciled"]);
  const { data, loading, error, reload } = useQuery(() => request<Paged<Txn>>("/finance/transactions", { query: list.query }), [list.query]);
  const [msg, setMsg] = useState<string | null>(null);
  const [refundFor, setRefundFor] = useState<Txn | null>(null);
  const { confirm, dialog } = useConfirm();

  return (
    <>
      {msg && <Alert kind="success" className="mb-4">{msg}</Alert>}
      <ListToolbar
        search={list.q}
        onSearch={list.setSearch}
        placeholder="Search reference or notes"
        filters={[
          { name: "type", label: "Type", options: toOptions(["RENT_PAYMENT", "REFUND", "COMMISSION", "SERVICE_CHARGE", "SUBSCRIPTION", "ADJUSTMENT"]) },
          { name: "status", label: "Status", options: toOptions(["PENDING", "SUCCESS", "FAILED", "REVERSED"]) },
          { name: "reconciled", label: "Reconciled", options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
        ]}
        values={list.filters}
        onFilter={list.setFilter}
      />
      <DataTable
        rows={data?.items}
        loading={loading}
        error={error}
        rowKey={(t) => t.id}
        empty="No transactions."
        columns={[
          { key: "ref", header: "Reference", render: (t) => <span><span className="block font-mono text-xs font-semibold">{t.reference}</span><span className="text-xs text-muted">{formatTimestamp(t.createdAt)}</span></span> },
          { key: "type", header: "Type", render: (t) => <span className="flex flex-wrap gap-1">{labelize(t.type)}{t.isTest && <Badge tone="warning">TEST</Badge>}</span> },
          { key: "parties", header: "From → To", render: (t) => <span className="text-xs">{t.payerName ?? "—"} → {t.payeeName ?? "—"}</span>, className: "hidden lg:table-cell" },
          { key: "amount", header: "Amount", render: (t) => <span className="font-semibold">{formatMoney(t.amount)}</span> },
          { key: "status", header: "Status", render: (t) => <span className="flex flex-wrap gap-1"><StatusBadge status={t.status} />{t.reconciled && <Badge tone="success">Reconciled</Badge>}</span> },
          {
            key: "actions",
            header: "",
            className: "text-right",
            render: (t) => (
              <span className="flex flex-wrap justify-end gap-2">
                {can("payments.manage") && !t.reconciled && t.status === "SUCCESS" && (
                  <Button size="sm" variant="secondary" onClick={() => confirm({ title: "Reconcile", message: `Mark ${t.reference} as matched with the bank/gateway statement?`, confirmLabel: "Reconcile", onConfirm: async () => { await request(`/finance/transactions/${t.id}/reconcile`, { method: "POST" }); setMsg("Transaction reconciled."); await reload(); } })}>
                    Reconcile
                  </Button>
                )}
                {can("commissions.manage") && t.type === "COMMISSION" && t.status === "PENDING" && (
                  <Button size="sm" variant="secondary" onClick={() => confirm({ title: "Settle commission", message: `Mark ${formatMoney(t.amount)} commission as collected?`, confirmLabel: "Settle", onConfirm: async () => { await request(`/finance/transactions/${t.id}/commission`, { method: "POST", body: { status: "SUCCESS" } }); setMsg("Commission settled."); await reload(); } })}>
                    Settle
                  </Button>
                )}
                {can("refunds.manage") && t.status === "SUCCESS" && ["RENT_PAYMENT", "SUBSCRIPTION", "SERVICE_CHARGE"].includes(t.type) && (
                  <Button size="sm" variant="ghost" onClick={() => setRefundFor(t)}>Refund</Button>
                )}
              </span>
            ),
          },
        ]}
      />
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={list.setPage} />}
      {refundFor && <RefundRequestModal txn={refundFor} onClose={() => setRefundFor(null)} onDone={async () => { setRefundFor(null); setMsg("Refund requested. Another finance admin must approve it."); await reload(); }} />}
      {dialog}
    </>
  );
}

function RefundRequestModal({ txn, onClose, onDone }: { txn: Txn; onClose: () => void; onDone: () => Promise<void> }) {
  const [amount, setAmount] = useState(String(Number(txn.amount)));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await request("/finance/refunds", { method: "POST", body: { transactionId: txn.id, amount: Number(amount), reason } });
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Request refund" description={`${txn.reference} · ${formatMoney(txn.amount)}`}>
      <div className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <Input label="Amount (₹)" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Textarea label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={reason.trim().length < 5 || !(Number(amount) > 0)} onClick={() => void submit()}>Request refund</Button>
        </div>
      </div>
    </Modal>
  );
}

interface Invoice {
  id: string;
  number: string;
  description: string;
  total: string;
  status: string;
  dueDate: string | null;
  issuedToName: string | null;
  createdAt: string;
}

function InvoicesTab() {
  const list = useListParams(["status"]);
  const { data, loading, error, reload } = useQuery(() => request<Paged<Invoice>>("/finance/invoices", { query: list.query }), [list.query]);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const action = (inv: Invoice, act: "ISSUE" | "MARK_PAID" | "VOID") =>
    confirm({
      title: `${labelize(act)} ${inv.number}`,
      message: act === "VOID" ? "Voided invoices cannot be reopened." : act === "MARK_PAID" ? "A payment transaction will be recorded." : "The customer will be notified.",
      tone: act === "VOID" ? "danger" : "primary",
      confirmLabel: labelize(act),
      onConfirm: async () => {
        await request(`/finance/invoices/${inv.id}/action`, { method: "POST", body: { action: act } });
        setMsg(`Invoice ${inv.number} updated.`);
        await reload();
      },
    });
  return (
    <>
      {msg && <Alert kind="success" className="mb-4">{msg}</Alert>}
      <ListToolbar search={list.q} onSearch={list.setSearch} placeholder="Search invoice number" filters={[{ name: "status", label: "Status", options: toOptions(["DRAFT", "ISSUED", "PAID", "VOID"]) }]} values={list.filters} onFilter={list.setFilter} actions={<Button leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New invoice</Button>} />
      <DataTable
        rows={data?.items}
        loading={loading}
        error={error}
        rowKey={(i) => i.id}
        empty="No invoices."
        columns={[
          { key: "number", header: "Invoice", render: (i) => <span><span className="block font-semibold">{i.number}</span><span className="text-xs text-muted">{i.description}</span></span> },
          { key: "to", header: "Customer", render: (i) => i.issuedToName ?? "—" },
          { key: "total", header: "Total", render: (i) => formatMoney(i.total) },
          { key: "due", header: "Due", render: (i) => formatDate(i.dueDate), className: "hidden lg:table-cell" },
          { key: "status", header: "Status", render: (i) => <StatusBadge status={i.status} /> },
          {
            key: "actions",
            header: "",
            className: "text-right",
            render: (i) => (
              <span className="flex flex-wrap justify-end gap-2">
                {i.status === "DRAFT" && <Button size="sm" onClick={() => action(i, "ISSUE")}>Issue</Button>}
                {i.status === "ISSUED" && <Button size="sm" variant="secondary" onClick={() => action(i, "MARK_PAID")}>Mark paid</Button>}
                {["DRAFT", "ISSUED"].includes(i.status) && <Button size="sm" variant="ghost" onClick={() => action(i, "VOID")}>Void</Button>}
              </span>
            ),
          },
        ]}
      />
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={list.setPage} />}
      <InvoiceModal open={creating} onClose={() => setCreating(false)} onDone={async () => { setCreating(false); setMsg("Draft invoice created."); await reload(); }} />
      {dialog}
    </>
  );
}

function InvoiceModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [form, setForm] = useState({ issuedToPhone: "", description: "", amount: "", taxPercent: "18", dueDate: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await request("/finance/invoices", { method: "POST", body: { ...form, amount: Number(form.amount), taxPercent: Number(form.taxPercent), dueDate: form.dueDate || undefined } });
      setForm({ issuedToPhone: "", description: "", amount: "", taxPercent: "18", dueDate: "" });
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="New invoice">
      <div className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <PhoneField label="Customer phone" value={form.issuedToPhone} onChange={(v) => setForm((f) => ({ ...f, issuedToPhone: v }))} />
        <Input label="Description" value={form.description} onChange={set("description")} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="Amount (₹)" type="number" value={form.amount} onChange={set("amount")} />
          <Input label="GST %" type="number" value={form.taxPercent} onChange={set("taxPercent")} />
          <Input label="Due date" type="date" value={form.dueDate} onChange={set("dueDate")} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={() => void submit()}>Create draft</Button>
        </div>
      </div>
    </Modal>
  );
}

interface Refund {
  id: string;
  amount: string;
  reason: string;
  status: string;
  requestedById: string;
  createdAt: string;
  transaction: { reference: string; amount: string; type: string };
}

function RefundsTab() {
  const { profile } = useAuth();
  const list = useListParams(["status"]);
  const { data, loading, error, reload } = useQuery(() => request<Paged<Refund>>("/finance/refunds", { query: list.query }), [list.query]);
  const [msg, setMsg] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const act = (r: Refund, action: "APPROVE" | "REJECT" | "PROCESS") =>
    confirm({
      title: `${labelize(action)} refund`,
      message: `${formatMoney(r.amount)} on ${r.transaction.reference}. ${action === "PROCESS" ? "This records the refund payment." : ""}`,
      tone: action === "REJECT" ? "danger" : "primary",
      confirmLabel: labelize(action),
      onConfirm: async () => {
        await request(`/finance/refunds/${r.id}/decision`, { method: "POST", body: { action } });
        setMsg(`Refund ${action.toLowerCase()}${action === "PROCESS" ? "ed" : "d"}.`);
        await reload();
      },
    });
  return (
    <>
      <Alert kind="info" className="mb-4">Four-eyes rule: a refund must be approved by someone other than the person who requested it.</Alert>
      {msg && <Alert kind="success" className="mb-4">{msg}</Alert>}
      <ListToolbar filters={[{ name: "status", label: "Status", options: toOptions(["REQUESTED", "APPROVED", "REJECTED", "PROCESSED"]) }]} values={list.filters} onFilter={list.setFilter} />
      <DataTable
        rows={data?.items}
        loading={loading}
        error={error}
        rowKey={(r) => r.id}
        empty="No refunds."
        columns={[
          { key: "txn", header: "Transaction", render: (r) => <span className="font-mono text-xs">{r.transaction.reference}</span> },
          { key: "amount", header: "Amount", render: (r) => formatMoney(r.amount) },
          { key: "reason", header: "Reason", render: (r) => <span className="line-clamp-2 text-sm">{r.reason}</span>, className: "hidden lg:table-cell" },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          {
            key: "actions",
            header: "",
            className: "text-right",
            render: (r) => (
              <span className="flex flex-wrap justify-end gap-2">
                {r.status === "REQUESTED" && (r.requestedById !== profile?.id || profile?.isFounder) && (
                  <>
                    <Button size="sm" onClick={() => act(r, "APPROVE")}>Approve</Button>
                    <Button size="sm" variant="ghost" onClick={() => act(r, "REJECT")}>Reject</Button>
                  </>
                )}
                {r.status === "REQUESTED" && r.requestedById === profile?.id && !profile?.isFounder && <span className="text-xs text-muted">Awaiting another approver</span>}
                {r.status === "APPROVED" && <Button size="sm" variant="secondary" onClick={() => act(r, "PROCESS")}>Process</Button>}
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

function CommissionTab() {
  const { data, loading, reload } = useQuery(() => request<{ percent: number; pending: { count: number; amount: string }; earned: string }>("/finance/commission"), []);
  const [percent, setPercent] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const { confirm, dialog } = useConfirm();
  if (loading && !data) return <Spinner className="text-brand" />;
  const value = percent ?? String(data?.percent ?? 0);
  return (
    <div className="space-y-4">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Current rate" value={`${data?.percent ?? 0}%`} tone="brand" />
        <StatCard label={`Pending (${data?.pending.count ?? 0})`} value={formatMoney(data?.pending.amount)} tone="warning" />
        <StatCard label="Earned (settled)" value={formatMoney(data?.earned)} tone="success" />
      </div>
      <section className="card max-w-md space-y-3 p-5">
        <h2 className="font-semibold">Commission rate</h2>
        <p className="text-sm text-muted">Charged to the landlord on every rent payment. Changes apply to future payments only.</p>
        <Input label="Percent of rent" type="number" min={0} max={50} step="0.5" value={value} onChange={(e) => setPercent(e.target.value)} />
        <Button
          onClick={() =>
            confirm({
              title: "Change commission",
              message: `Set commission to ${value}%? This is recorded in the audit log.`,
              confirmLabel: "Save",
              onConfirm: async () => {
                await request("/finance/commission", { method: "PUT", body: { percent: Number(value) } });
                setMsg({ kind: "success", text: "Commission updated." });
                setPercent(null);
                await reload();
              },
            })
          }
        >
          Save rate
        </Button>
      </section>
      {dialog}
    </div>
  );
}

interface FinanceReport {
  monthly: Array<{ period: string; rent: number; commission: number; refunds: number }>;
  totals: { collectedThisMonth: number; dues: Record<string, { count: number; amount: number }>; refundsProcessed: { count: number; amount: number }; testTransactions: number };
}

function ReportsTab() {
  const { data, loading, error } = useQuery(() => request<FinanceReport>("/finance/reports"), []);
  if (loading && !data) return <Spinner className="text-brand" />;
  if (error || !data) return <Alert kind="error">{error}</Alert>;
  const max = Math.max(1, ...data.monthly.map((m) => m.rent));
  return (
    <div className="space-y-4">
      {data.totals.testTransactions > 0 && <Alert kind="warning">{data.totals.testTransactions} TEST transaction(s) are included in these figures.</Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Collected this month" value={formatMoney(data.totals.collectedThisMonth)} tone="success" />
        <StatCard label="Pending dues" value={formatMoney(data.totals.dues.DUE?.amount ?? 0)} tone="warning" />
        <StatCard label="Overdue" value={formatMoney(data.totals.dues.OVERDUE?.amount ?? 0)} tone="danger" />
        <StatCard label="Refunds processed" value={formatMoney(data.totals.refundsProcessed.amount)} />
      </div>
      <section className="card p-5">
        <h2 className="mb-4 font-semibold">Rent collected — last 12 months</h2>
        <div className="flex h-48 items-end gap-1.5 sm:gap-3" role="img" aria-label="Monthly rent collected bar chart">
          {data.monthly.map((m) => (
            <div key={m.period} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div className="w-full rounded-t-md bg-brand" style={{ height: `${Math.max(2, (m.rent / max) * 100)}%` }} title={`${m.period}: ${formatMoney(m.rent)}`} />
              <span className="text-[10px] text-muted sm:text-xs">{m.period.slice(5)}</span>
            </div>
          ))}
        </div>
      </section>
      <DataTable
        rows={[...data.monthly].reverse()}
        rowKey={(m) => m.period}
        columns={[
          { key: "period", header: "Month", render: (m) => m.period },
          { key: "rent", header: "Rent collected", render: (m) => formatMoney(m.rent) },
          { key: "commission", header: "Commission earned", render: (m) => formatMoney(m.commission) },
          { key: "refunds", header: "Refunds", render: (m) => formatMoney(m.refunds) },
        ]}
      />
    </div>
  );
}
