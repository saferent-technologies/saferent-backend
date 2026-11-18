import { ArrowLeft, Lock, Plus, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { DataTable, Pagination } from "@/components/data/DataTable";
import { ListToolbar } from "@/components/data/ListToolbar";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/hooks/useAuth";
import { useListParams } from "@/hooks/useListParams";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import type { Paged } from "@/types/auth";
import { cn } from "@/utils/cn";
import { ROLE_LABELS } from "@/utils/constants";
import { errorMessage } from "@/utils/errors";
import { formatTimestamp, labelize, toOptions } from "@/utils/format";
import { playNotificationSound } from "@/utils/notificationSound";
import { useSupportAvailable } from "@/utils/supportPresence";

interface Ticket {
  id: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  raisedBy: { id: string; fullName: string; role: string };
  assignedTo: { id: string; fullName: string; role?: string } | null;
  queue?: { position: number; total: number } | null;
  /** Staff: assigned to me and new / has an owner reply I haven't opened. */
  unread?: boolean;
  _count?: { messages: number };
}

const CATEGORIES = ["TENANT_COMPLAINT", "LANDLORD_COMPLAINT", "PAYMENT", "ACCOUNT", "PROPERTY", "OTHER"];

export function SupportPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const list = useListParams(["status", "assigned"]);
  const staff = can("support.manage");
  const { data, loading, error, reload, setData } = useQuery(() => request<Paged<Ticket>>("/support/tickets", { query: list.query }), [list.query]);
  // Live list: refresh quietly every 15 s while visible (no loading flicker).
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void request<Paged<Ticket>>("/support/tickets", { query: list.query }).then(setData).catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [list.query, setData]);
  const [creating, setCreating] = useState(params.get("new") === "1");

  return (
    <>
      <PageHeader
        title={staff ? "Support tickets" : "Help & complaints"}
        description={staff ? "Assign, reply and resolve." : "Raise a complaint or ask for help — we'll reply here."}
        actions={can("support.create") && <Button leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New ticket</Button>}
      />
      {staff && <QueuePanel />}
      <ListToolbar
        search={list.q}
        onSearch={list.setSearch}
        placeholder="Search subject"
        filters={[
          { name: "status", label: "Status", options: toOptions(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]) },
          ...(staff ? [{ name: "assigned", label: "Assigned", options: [{ value: "me", label: "To me" }] }] : []),
        ]}
        values={list.filters}
        onFilter={list.setFilter}
      />
      <DataTable
        rows={data?.items}
        loading={loading}
        error={error}
        rowKey={(t) => t.id}
        onRowClick={(t) => navigate(`/support/${t.id}`)}
        empty="No tickets."
        columns={[
          { key: "subject", header: "Subject", render: (t) => <span><span className="flex items-center gap-2 font-semibold">{t.unread && <span className="size-2 shrink-0 rounded-full bg-brand" aria-label="New" />}{t.subject}</span><span className="text-xs text-muted">{labelize(t.category)}{staff ? ` · ${t.raisedBy.fullName} (${ROLE_LABELS[t.raisedBy.role]})` : ""}</span></span> },
          { key: "priority", header: "Priority", render: (t) => <StatusBadge status={t.priority} />, className: "hidden lg:table-cell" },
          ...(staff ? [{ key: "assignee", header: "Assignee", render: (t: Ticket) => t.assignedTo?.fullName ?? <span className="text-muted">{t.queue ? `In queue #${t.queue.position}` : "Unassigned"}</span>, className: "hidden lg:table-cell" }] : []),
          { key: "status", header: "Status", render: (t) => (t.queue && !staff ? <Badge>{`In queue #${t.queue.position}`}</Badge> : <StatusBadge status={t.status} />) },
          { key: "updated", header: "Updated", render: (t) => formatTimestamp(t.updatedAt), className: "hidden xl:table-cell" },
        ]}
      />
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={list.setPage} />}
      <NewTicketModal open={creating} onClose={() => setCreating(false)} onDone={async (id) => { setCreating(false); await reload(); navigate(`/support/${id}`); }} />
    </>
  );
}

interface QueueInfo {
  capacity: number;
  queued: number;
  me: { online: boolean; agent: boolean };
  agents: Array<{ id: string; fullName: string; openTickets: number; free: boolean }>;
}

/** Staff: Available / Away switch, who is online and how many tickets wait. Refreshes every 15 s. */
function QueuePanel() {
  const [available, setAvailable] = useSupportAvailable();
  const { data, reload, setData } = useQuery(() => request<QueueInfo>("/support/queue"), [available]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void request<QueueInfo>("/support/queue").then(setData).catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [setData]);
  const toggle = async () => {
    setAvailable(!available);
    await request("/support/presence", { method: "POST", body: { available: !available } }).catch(() => undefined);
    await reload();
  };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-line bg-surface p-4 text-sm">
      {data?.me.agent && (
        <div className="flex items-center gap-3">
          <span className={cn("size-2.5 rounded-full", available ? "bg-green-500" : "bg-gray-400")} aria-hidden />
          <span className="font-semibold">{available ? "Available" : "Away"}</span>
          <Button size="sm" variant="secondary" onClick={() => void toggle()}>{available ? "Go away" : "Go available"}</Button>
        </div>
      )}
      <div>
        <span className="font-semibold">{data?.queued ?? 0}</span> <span className="text-muted">waiting in queue</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">Online agents:</span>
        {data && data.agents.length === 0 && <span className="text-muted">none</span>}
        {data?.agents.map((a) => (
          <Badge key={a.id}>{`${a.fullName} · ${a.free ? "free" : "busy"} (${a.openTickets}/${data.capacity})`}</Badge>
        ))}
      </div>
    </div>
  );
}

function NewTicketModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (id: string) => Promise<void> }) {
  const { profile } = useAuth();
  const [form, setForm] = useState({ category: profile?.role === "LANDLORD" ? "TENANT_COMPLAINT" : profile?.role === "TENANT" ? "LANDLORD_COMPLAINT" : "OTHER", subject: "", description: "", priority: "MEDIUM" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await request<{ ticket: { id: string } }>("/support/tickets", { method: "POST", body: form });
      setForm({ ...form, subject: "", description: "" });
      await onDone(res.ticket.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="New ticket">
      <div className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Category" options={toOptions(CATEGORIES)} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <Select label="Priority" options={toOptions(["LOW", "MEDIUM", "HIGH", "URGENT"])} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
        </div>
        <Input label="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} maxLength={150} />
        <Textarea label="Describe the issue" rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={5000} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={form.subject.length < 5 || form.description.length < 10} onClick={() => void submit()}>Submit</Button>
        </div>
      </div>
    </Modal>
  );
}

interface TicketDetail {
  ticket: Ticket & {
    description: string;
    raisedBy: Ticket["raisedBy"] & { phoneNumber?: string | null; email?: string | null };
    messages: Array<{ id: string; body: string; internal: boolean; createdAt: string; authorId: string; author: { id: string; fullName: string; role: string } | null }>;
  };
  canManage: boolean;
}

export function TicketPage() {
  const { id = "" } = useParams();
  const { profile } = useAuth();
  const { data, loading, error, reload } = useQuery(() => request<TicketDetail>(`/support/tickets/${id}`), [id]);
  const { data: agents } = useQuery(() => request<{ items: Array<{ id: string; fullName: string }> }>("/users/lookup", { query: { role: "SUPPORT" } }), [], !!data?.canManage);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Live chat: re-check every 4 s while this tab is visible (and at once when it comes back).
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void reload();
    };
    const timer = window.setInterval(tick, 4000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [reload]);

  // New message → scroll to it; a reply from the other side also rings the bell.
  const listEnd = useRef<HTMLDivElement>(null);
  const seen = useRef<number | null>(null);
  const messages = data?.ticket.messages ?? [];
  useEffect(() => {
    if (!data) return;
    const count = messages.length;
    const prev = seen.current;
    seen.current = count;
    if (prev === null || count > prev) listEnd.current?.scrollIntoView({ behavior: prev === null ? "auto" : "smooth", block: "end" });
    if (prev !== null && count > prev && messages.slice(prev).some((m) => m.authorId !== profile?.id)) playNotificationSound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (loading && !data) return <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>;
  if (error || !data) return <Alert kind="error">{error ?? "Ticket not found."}</Alert>;
  const t = data.ticket;

  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      await request(`/support/tickets/${t.id}/messages`, { method: "POST", body: { body, internal } });
      setBody("");
      setInternal(false);
      await reload();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const update = async (patch: Record<string, unknown>) => {
    setErr(null);
    try {
      await request(`/support/tickets/${t.id}`, { method: "PATCH", body: patch });
      await reload();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  return (
    <>
      <Link to="/support" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-dark hover:text-brand"><ArrowLeft className="size-4" /> Tickets</Link>
      <PageHeader title={t.subject} description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={t.status} /><StatusBadge status={t.priority} /><span>{labelize(t.category)}</span>{t.assignedTo ? <span className="text-muted">Handled by {t.assignedTo.fullName}</span> : t.queue ? <Badge tone="warning">{`In queue #${t.queue.position} of ${t.queue.total}`}</Badge> : null}</span>} />
      {err && <Alert kind="error" className="mb-4">{err}</Alert>}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card flex min-h-[24rem] flex-col p-4 sm:p-5 lg:col-span-2">
          <p className="mb-2 flex items-center gap-1.5 text-xs text-muted"><span className="size-2 animate-pulse rounded-full bg-success" /> Live: new replies appear automatically</p>
          <ol className="max-h-[60vh] flex-1 space-y-3 overflow-y-auto pr-1">
            <li className="rounded-control bg-subtle p-3 text-sm">
              <p className="mb-1 text-xs font-semibold text-muted">{t.raisedBy.fullName} · {formatTimestamp(t.createdAt)}</p>
              <p className="whitespace-pre-line">{t.description}</p>
            </li>
            {t.messages.map((m) => {
              const mine = m.authorId === profile?.id;
              return (
                <li key={m.id} className={cn("max-w-[90%] rounded-control p-3 text-sm", m.internal ? "border border-warning/30 bg-warning/5" : mine ? "ml-auto bg-brand-bg" : "bg-subtle")}>
                  <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted">
                    {m.internal && <Lock className="size-3" />}
                    {m.author?.fullName ?? "SafeRent"} · {formatTimestamp(m.createdAt)}
                  </p>
                  <p className="whitespace-pre-line">{m.body}</p>
                </li>
              );
            })}
            <div ref={listEnd} />
          </ol>
          {t.status !== "CLOSED" && (
            <div className="mt-4 space-y-2 border-t border-line pt-4">
              <Textarea
                aria-label="Reply"
                rows={3}
                placeholder="Write a reply… (Ctrl + Enter to send)"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && body.trim() && !busy) {
                    e.preventDefault();
                    void send();
                  }
                }}
                maxLength={5000}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                {data.canManage ? <Checkbox label="Internal note (hidden from customer)" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> : <span />}
                <Button leftIcon={<Send className="size-4" />} loading={busy} disabled={!body.trim()} onClick={() => void send()}>Send</Button>
              </div>
            </div>
          )}
        </section>
        {data.canManage && (
          <aside className="card h-fit space-y-4 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Customer</p>
              <p className="font-medium">{t.raisedBy.fullName} <Badge>{ROLE_LABELS[t.raisedBy.role]}</Badge></p>
              {t.raisedBy.phoneNumber && <p className="text-sm text-muted">{t.raisedBy.phoneNumber}</p>}
              {t.raisedBy.email && <p className="truncate text-sm text-muted">{t.raisedBy.email}</p>}
            </div>
            <Select label="Assignee" placeholder="Unassigned" options={[...(profile ? [{ value: profile.id, label: `Me (${profile.fullName})` }] : []), ...(agents?.items ?? []).filter((a) => a.id !== profile?.id).map((a) => ({ value: a.id, label: a.fullName }))]} value={t.assignedTo?.id ?? ""} onChange={(e) => void update({ assignedToId: e.target.value || null })} />
            <Select label="Status" options={toOptions(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"])} value={t.status} onChange={(e) => void update({ status: e.target.value })} />
            <Select label="Priority" options={toOptions(["LOW", "MEDIUM", "HIGH", "URGENT"])} value={t.priority} onChange={(e) => void update({ priority: e.target.value })} />
          </aside>
        )}
      </div>
    </>
  );
}
