import { CheckCircle2, DoorOpen, XCircle } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import { AppError, errorMessage } from "@/utils/errors";
import { formatDate, formatTimestamp } from "@/utils/format";
import { ReviewFields, type ReviewDraft } from "@/pages/reviews/ReviewsPages";

interface ExitRequest {
  id: string;
  requestedByRole: "TENANT" | "LANDLORD";
  requestedBy: string | null;
  reason: string;
  moveOutDate: string;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED" | "COMPLETED";
  respondedBy: string | null;
  respondedAt: string | null;
  responseNote: string | null;
  createdAt: string;
  hasMyReview: boolean;
  canRespond: boolean;
  canCancel: boolean;
}

interface ExitState {
  leaseStatus: string;
  side: "TENANT" | "LANDLORD" | null;
  noticePeriodDays: number | null;
  endDate: string;
  open: ExitRequest | null;
  history: ExitRequest[];
  canRequest: boolean;
}

interface ReviewForm {
  form: { categories: Array<{ key: string; label: string; required: boolean }>; tags: string[] } | null;
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const emptyReview = (): ReviewDraft => ({ ratings: {}, text: "", tags: [] });

function explain(err: unknown): string {
  const issues = err instanceof AppError ? (err.details?.issues as Array<{ message: string }> | undefined) : undefined;
  return issues?.length ? issues.map((i) => i.message).join(" · ") : errorMessage(err);
}

/** Optional review section shown while asking / accepting. Sealed until the lease closes. */
function OptionalReview({ leaseId, on, setOn, value, onChange }: { leaseId: string; on: boolean; setOn: (v: boolean) => void; value: ReviewDraft; onChange: (v: ReviewDraft) => void }) {
  const form = useQuery(() => request<ReviewForm>(`/leases/${leaseId}/review`), [leaseId], on);
  return (
    <div className="rounded-control border border-line p-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> Add a review now (optional)
      </label>
      {on && (
        <div className="mt-3">
          <p className="mb-2 text-xs text-muted">It stays private and is submitted when the lease closes. Both reviews are revealed together.</p>
          {form.loading && !form.data && <Spinner className="size-5 text-brand" />}
          {form.data?.form && <ReviewFields form={form.data.form} value={value} onChange={onChange} />}
        </div>
      )}
    </div>
  );
}

const reviewBody = (on: boolean, r: ReviewDraft) => (on ? { ratings: r.ratings, text: r.text.trim() || undefined, tags: r.tags } : undefined);

/**
 * Lease popup → "Close lease". Tenant asks to move out / landlord asks to close; the other side must
 * accept. Optional review travels with the request and is submitted once the lease closes.
 */
export function LeaseExitPanel({ leaseId, onChanged }: { leaseId: string; onChanged: () => void }) {
  const { data, loading, error, reload } = useQuery(() => request<ExitState>(`/leases/${leaseId}/exit`), [leaseId]);
  const [mode, setMode] = useState<"none" | "request" | "accept" | "decline">("none");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [withReview, setWithReview] = useState(false);
  const [review, setReview] = useState<ReviewDraft>(emptyReview);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const run = async (path: string, body: unknown, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await request(path, { method: "POST", body });
      setMsg({ kind: "success", text: ok });
      setMode("none");
      setReason("");
      setNote("");
      setWithReview(false);
      setReview(emptyReview());
      await reload();
      onChanged();
    } catch (err) {
      setMsg({ kind: "error", text: explain(err) });
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Spinner className="size-5 text-brand" />;
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return null;
  const open = data.open;
  const other = data.side === "TENANT" ? "landlord" : "tenant";
  const startRequest = () => {
    const d = new Date();
    d.setDate(d.getDate() + (data.noticePeriodDays ?? 30));
    setDate(isoDay(d));
    setMode("request");
  };
  const reviewOk = !withReview || !!review.ratings.overall;

  return (
    <section className="space-y-3 rounded-control bg-subtle p-3">
      <h3 className="flex items-center gap-2 font-semibold"><DoorOpen className="size-4" /> Close lease</h3>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {open && (
        <div className="space-y-2 rounded-control border border-line bg-surface p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{open.requestedByRole === "TENANT" ? "Tenant" : "Landlord"} {open.requestedBy} asked to close on {formatDate(open.moveOutDate)}</p>
            <Badge tone={open.status === "ACCEPTED" ? "success" : "warning"}>{open.status === "ACCEPTED" ? `Agreed — closes ${formatDate(open.moveOutDate)}` : "Waiting for answer"}</Badge>
          </div>
          <p className="text-muted">Reason: {open.reason}</p>
          {open.responseNote && <p className="text-muted">Reply from {open.respondedBy}: {open.responseNote}</p>}
          <p className="text-xs text-muted">Asked {formatTimestamp(open.createdAt)}{open.hasMyReview ? " · your review is attached (sealed)" : ""}</p>
          {open.canRespond && mode === "none" && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" leftIcon={<CheckCircle2 className="size-4" />} onClick={() => setMode("accept")}>Accept</Button>
              <Button size="sm" variant="secondary" leftIcon={<XCircle className="size-4" />} onClick={() => setMode("decline")}>Decline</Button>
            </div>
          )}
          {open.canCancel && mode === "none" && <Button size="sm" variant="ghost" loading={busy} onClick={() => void run(`/leases/${leaseId}/exit/cancel`, {}, "Request cancelled.")}>Cancel my request</Button>}
        </div>
      )}

      {mode === "accept" && open && (
        <div className="space-y-3">
          <Alert kind="info">The lease closes on {formatDate(open.moveOutDate)}. After that the {data.side === "LANDLORD" ? "flat waits for your move-out check before you list it again" : "rent stops after the agreed date"}.</Alert>
          <Textarea label="Note (optional)" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          <OptionalReview leaseId={leaseId} on={withReview} setOn={setWithReview} value={review} onChange={setReview} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMode("none")}>Back</Button>
            <Button loading={busy} disabled={!reviewOk} onClick={() => void run(`/leases/${leaseId}/exit/accept`, { note: note.trim() || undefined, review: reviewBody(withReview, review) }, "Accepted.")}>Accept and close</Button>
          </div>
        </div>
      )}

      {mode === "decline" && (
        <div className="space-y-3">
          <Textarea label="Why are you declining? *" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMode("none")}>Back</Button>
            <Button variant="danger" loading={busy} disabled={note.trim().length < 5} onClick={() => void run(`/leases/${leaseId}/exit/decline`, { note: note.trim() }, "Declined. The lease stays active.")}>Decline</Button>
          </div>
        </div>
      )}

      {data.canRequest && mode === "none" && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted">{data.side === "TENANT" ? "Moving out? Ask your landlord to close the lease." : "Want to end this lease? Ask the tenant to agree."} It closes only when the {other} accepts.</p>
          <Button size="sm" variant="secondary" leftIcon={<DoorOpen className="size-4" />} onClick={startRequest}>{data.side === "TENANT" ? "Request to move out" : "Request to close lease"}</Button>
        </div>
      )}

      {mode === "request" && (
        <div className="space-y-3">
          <Textarea label="Reason *" hint={`The ${other} sees this.`} rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
          <Input label="Move-out / closing date *" type="date" min={isoDay(new Date())} hint={data.noticePeriodDays !== null ? `Notice period in your lease: ${data.noticePeriodDays} days.` : `Lease ends ${formatDate(data.endDate)}.`} value={date} onChange={(e) => setDate(e.target.value)} />
          <OptionalReview leaseId={leaseId} on={withReview} setOn={setWithReview} value={review} onChange={setReview} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMode("none")}>Back</Button>
            <Button loading={busy} disabled={reason.trim().length < 10 || !date || !reviewOk} onClick={() => void run(`/leases/${leaseId}/exit`, { reason: reason.trim(), moveOutDate: date, review: reviewBody(withReview, review) }, `Request sent to the ${other}.`)}>Send request</Button>
          </div>
        </div>
      )}

      {data.leaseStatus !== "ACTIVE" && !open && <p className="text-muted">This lease is {data.leaseStatus.toLowerCase()}.</p>}
      {data.history.length > 0 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">Earlier requests ({data.history.length})</summary>
          <ul className="mt-2 space-y-1">
            {data.history.map((h) => <li key={h.id}>{formatDate(h.createdAt)} · {h.requestedByRole.toLowerCase()} asked · {h.status.toLowerCase()}{h.responseNote ? ` — ${h.responseNote}` : ""}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
