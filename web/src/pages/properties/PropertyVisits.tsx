import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { DataTable, Pagination } from "@/components/data/DataTable";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import type { Paged } from "@/types/auth";
import { errorMessage } from "@/utils/errors";
import { formatTimestamp, labelize } from "@/utils/format";
import type { PropertyDetail } from "./types";

/*
 * Property visits: availability (days, time slots, capacity, approval, host) and the visits booked by
 * tenants in the app. Times are India time.
 */

export interface ManagedVisit {
  id: string;
  property: { id: string; code: string; title: string | null; locality: string | null; city: string | null } | null;
  scheduledAt: string;
  endsAt: string | null;
  status: "REQUESTED" | "SCHEDULED" | "REJECTED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  source: string;
  visitors: number;
  visitorNote: string | null;
  visitor: { id: string; fullName: string; phoneNumber: string | null } | null;
  host: { id: string; fullName: string } | null;
  rejectReason: string | null;
  cancelReason: string | null;
  cancelledBy: string | null;
  outcome: string | null;
  feedback: { rating: number | null; interested: boolean | null; comment: string | null } | null;
}

const STATUS_LABEL: Record<ManagedVisit["status"], string> = { REQUESTED: "Waiting for you", SCHEDULED: "Confirmed", REJECTED: "Declined", COMPLETED: "Done", CANCELLED: "Cancelled", NO_SHOW: "No-show" };
const STATUS_TONE: Record<ManagedVisit["status"], "brand" | "success" | "neutral" | "danger" | "warning"> = { REQUESTED: "warning", SCHEDULED: "brand", REJECTED: "danger", COMPLETED: "success", CANCELLED: "neutral", NO_SHOW: "danger" };

/** Visits I host or manage (all properties, or one). */
export function VisitsList({ propertyId }: { propertyId?: string }) {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useQuery(() => request<Paged<ManagedVisit>>("/visits", { query: { propertyId, status: status || undefined, page, pageSize: 20 } }), [propertyId, status, page]);
  const { confirm, dialog } = useConfirm();
  const [msg, setMsg] = useState<string | null>(null);
  const act = (v: ManagedVisit, path: string, body?: unknown) => async () => {
    setMsg(null);
    try {
      await request(`/visits/${v.id}/${path}`, { method: "POST", body });
      await reload();
    } catch (e) {
      setMsg(errorMessage(e));
      throw e;
    }
  };
  const past = (v: ManagedVisit) => new Date(v.scheduledAt).getTime() < Date.now();
  return (
    <>
      <div className="mb-3 max-w-xs">
        <Select label="Status" placeholder="All" options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} />
      </div>
      {msg && <Alert kind="error" className="mb-3">{msg}</Alert>}
      <DataTable
        rows={data?.items}
        loading={loading}
        error={error}
        rowKey={(v) => v.id}
        empty="No visits yet."
        columns={[
          { key: "when", header: "When", render: (v) => <span className="font-semibold">{formatTimestamp(v.scheduledAt)}</span> },
          ...(propertyId ? [] : [{ key: "property", header: "Property", render: (v: ManagedVisit) => <span>{v.property?.title ?? v.property?.code}<span className="block text-xs text-muted">{[v.property?.locality, v.property?.city].filter(Boolean).join(", ")}</span></span> }]),
          {
            key: "visitor",
            header: "Visitor",
            render: (v) => (
              <span>
                {v.visitor?.fullName ?? "—"} · {v.visitors} {v.visitors === 1 ? "person" : "people"}
                {v.visitor?.phoneNumber && <span className="block text-xs text-muted">{v.visitor.phoneNumber}</span>}
                {v.visitorNote && <span className="block text-xs text-muted">“{v.visitorNote}”</span>}
              </span>
            ),
          },
          { key: "host", header: "Host", render: (v) => v.host?.fullName ?? "—" },
          {
            key: "status",
            header: "Status",
            render: (v) => (
              <span>
                <Badge tone={STATUS_TONE[v.status]}>{STATUS_LABEL[v.status]}</Badge>
                {(v.cancelReason || v.rejectReason) && <span className="block text-xs text-muted">{v.cancelledBy === "VISITOR" ? "Visitor: " : ""}{v.cancelReason ?? v.rejectReason}</span>}
                {v.feedback && <span className="block text-xs text-muted">{"★".repeat(v.feedback.rating ?? 0)} · {v.feedback.interested ? "Interested" : "Not interested"}{v.feedback.comment ? ` · ${v.feedback.comment}` : ""}</span>}
                {v.outcome && <span className="block text-xs text-muted">Note: {v.outcome}</span>}
              </span>
            ),
          },
          {
            key: "actions",
            header: "",
            className: "text-right",
            render: (v) => (
              <span className="flex flex-wrap justify-end gap-1.5">
                {v.status === "REQUESTED" && !past(v) && <Button size="sm" onClick={() => void act(v, "confirm")().catch(() => undefined)}>Confirm</Button>}
                {v.status === "REQUESTED" && <Button size="sm" variant="ghost" onClick={() => confirm({ title: "Decline visit", message: "The visitor sees your reason.", tone: "danger", confirmLabel: "Decline", reason: { label: "Reason", required: true, minLength: 3 }, onConfirm: async (reason) => act(v, "reject", { reason })() })}>Decline</Button>}
                {v.status === "SCHEDULED" && past(v) && <Button size="sm" onClick={() => confirm({ title: "Visit done", message: "Add a note about how it went (optional).", confirmLabel: "Save", reason: { label: "Outcome note" }, onConfirm: async (note) => act(v, "complete", note ? { outcome: note } : {})() })}>Done</Button>}
                {v.status === "SCHEDULED" && past(v) && <Button size="sm" variant="ghost" onClick={() => void act(v, "no-show")().catch(() => undefined)}>No-show</Button>}
                {(v.status === "SCHEDULED" || v.status === "REQUESTED") && !past(v) && <Button size="sm" variant="ghost" onClick={() => confirm({ title: "Cancel visit", message: "The visitor sees your reason.", tone: "danger", confirmLabel: "Cancel visit", reason: { label: "Reason", required: true, minLength: 3 }, onConfirm: async (reason) => act(v, "cancel", { reason })() })}>Cancel</Button>}
              </span>
            ),
          },
        ]}
      />
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />}
      {dialog}
    </>
  );
}

interface Settings {
  enabled: boolean;
  approvalMode: "AUTO" | "MANUAL";
  slotMinutes: 15 | 30 | 45 | 60;
  capacityPerSlot: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  weekly: Array<{ day: number; start: string; end: string }>;
  blockedDates: string[];
  hostId: string | null;
  instructions: string | null;
}
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Property page → "Visits" tab: availability + visits. */
export function PropertyVisitsTab({ p, canManage }: { p: PropertyDetail; canManage: boolean }) {
  const { data, reload } = useQuery(() => request<{ settings: Settings; hosts: Array<{ id: string; fullName: string | null; role: string }> }>(`/properties/${p.id}/visit-settings`), [p.id], canManage);
  const [s, setS] = useState<Settings | null>(null);
  const [blocked, setBlocked] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  useEffect(() => setS(data?.settings ?? null), [data]);

  const save = async () => {
    if (!s) return;
    setBusy(true);
    setMsg(null);
    try {
      await request(`/properties/${p.id}/visit-settings`, { method: "PUT", body: { ...s, instructions: s.instructions || null } });
      await reload();
      setMsg({ kind: "success", text: s.enabled ? "Visit booking is on." : "Visit booking is off." });
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {canManage && s && (
        <section className="card space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">Visit availability</h2>
              <p className="text-sm text-muted">Tenants book a free slot in the SafeRent app. Times are India time.</p>
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> Take visit bookings</label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="Approval" options={[{ value: "MANUAL", label: "I confirm each visit" }, { value: "AUTO", label: "Confirm automatically" }]} value={s.approvalMode} onChange={(e) => setS({ ...s, approvalMode: e.target.value as Settings["approvalMode"] })} />
            <Select label="Slot length" options={[15, 30, 45, 60].map((m) => ({ value: String(m), label: `${m} minutes` }))} value={String(s.slotMinutes)} onChange={(e) => setS({ ...s, slotMinutes: Number(e.target.value) as Settings["slotMinutes"] })} />
            <Input label="Visitors per slot" type="number" min={1} max={10} value={String(s.capacityPerSlot)} onChange={(e) => setS({ ...s, capacityPerSlot: Number(e.target.value) })} />
            <Input label="Book at least (hours ahead)" type="number" min={0} max={72} value={String(s.minNoticeHours)} onChange={(e) => setS({ ...s, minNoticeHours: Number(e.target.value) })} />
            <Input label="Book up to (days ahead)" type="number" min={1} max={60} value={String(s.maxDaysAhead)} onChange={(e) => setS({ ...s, maxDaysAhead: Number(e.target.value) })} />
            <Select label="Who shows the property" placeholder="Assigned manager / agent, else owner" options={(data?.hosts ?? []).map((h) => ({ value: h.id, label: `${h.fullName ?? "—"} (${labelize(h.role)})` }))} value={s.hostId ?? ""} onChange={(e) => setS({ ...s, hostId: e.target.value || null })} />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-sm font-semibold">Visiting days and times</p>
              <Button size="sm" variant="ghost" leftIcon={<Plus className="size-4" />} onClick={() => setS({ ...s, weekly: [...s.weekly, { day: 6, start: "10:00", end: "13:00" }] })}>Add time</Button>
            </div>
            {s.weekly.length === 0 && <p className="text-sm text-muted">No visiting times yet.</p>}
            {s.weekly.map((w, i) => (
              <div key={i} className="mb-2 grid grid-cols-[1fr_8rem_8rem_auto] items-end gap-2">
                <Select aria-label="Day" options={DAYS.map((d, n) => ({ value: String(n), label: d }))} value={String(w.day)} onChange={(e) => setS({ ...s, weekly: s.weekly.map((x, k) => (k === i ? { ...x, day: Number(e.target.value) } : x)) })} />
                <Input aria-label="From" type="time" value={w.start} onChange={(e) => setS({ ...s, weekly: s.weekly.map((x, k) => (k === i ? { ...x, start: e.target.value } : x)) })} />
                <Input aria-label="To" type="time" value={w.end} onChange={(e) => setS({ ...s, weekly: s.weekly.map((x, k) => (k === i ? { ...x, end: e.target.value } : x)) })} />
                <button type="button" aria-label="Remove" className="rounded-control p-2 text-muted hover:text-danger" onClick={() => setS({ ...s, weekly: s.weekly.filter((_, k) => k !== i) })}><Trash2 className="size-4" /></button>
              </div>
            ))}
          </div>
          <div>
            <p className="mb-1 text-sm font-semibold">No visits on</p>
            <div className="flex flex-wrap items-end gap-2">
              <Input aria-label="Date" type="date" value={blocked} onChange={(e) => setBlocked(e.target.value)} />
              <Button size="sm" variant="secondary" disabled={!blocked} onClick={() => { setS({ ...s, blockedDates: [...new Set([...s.blockedDates, blocked])].sort() }); setBlocked(""); }}>Add date</Button>
              {s.blockedDates.map((d) => (
                <button key={d} type="button" className="rounded-full border border-line px-2 py-0.5 text-xs hover:border-danger" onClick={() => setS({ ...s, blockedDates: s.blockedDates.filter((x) => x !== d) })}>{d} ✕</button>
              ))}
            </div>
          </div>
          <Textarea label="Instructions for visitors (shown after confirmation)" rows={2} maxLength={300} value={s.instructions ?? ""} onChange={(e) => setS({ ...s, instructions: e.target.value })} />
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
          <div className="flex justify-end"><Button loading={busy} onClick={() => void save()}>Save availability</Button></div>
        </section>
      )}
      <section className="card p-5 sm:p-6">
        <h2 className="mb-3 font-semibold">Visits</h2>
        <VisitsList propertyId={p.id} />
      </section>
    </div>
  );
}
