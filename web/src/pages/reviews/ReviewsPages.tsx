import { Flag, MessageSquareReply, Star } from "lucide-react";
import { useState } from "react";
import { Pagination } from "@/components/data/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { Tabs } from "@/components/ui/Tabs";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import type { Paged } from "@/types/auth";
import { cn } from "@/utils/cn";
import { AppError, errorMessage } from "@/utils/errors";
import { formatDate, formatTimestamp, labelize } from "@/utils/format";

/* ─── Types (same JSON for Android, iOS and the Admin Panel) ─── */

export interface Review {
  id: string;
  code: string;
  leaseId: string;
  property: { id: string; code: string; name: string; city: string | null };
  place: string | null;
  stay: { from: string; to: string | null };
  reviewerRole: "TENANT" | "LANDLORD";
  revieweeRole: "TENANT" | "LANDLORD";
  reviewerName: string | null;
  revieweeName: string | null;
  status: string;
  submittedAt: string;
  publishedAt: string | null;
  overallRating: number | null;
  categoryRatings: Record<string, number> | null;
  reviewText: string | null;
  tags: string[] | null;
  response: { text: string; respondedAt: string; editedAt: string | null; hidden: boolean } | null;
  moderationNote: string | null;
  isMine: boolean;
  canRespond: boolean;
  canReport: boolean;
  openReports?: number;
}

export interface RatingStats {
  average: number | null;
  count: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
  categories: Record<string, { average: number; count: number }>;
}

interface LeaseReviewStatus {
  role: "TENANT" | "LANDLORD" | null;
  eligible: boolean;
  message: string | null;
  closesAt: string | null;
  otherPartySubmitted: boolean | null;
  myReview: Review | null;
  published: Review[];
  form: { categories: Array<{ key: string; label: string; required: boolean }>; tags: string[] } | null;
}

interface PendingReview {
  leaseId: string;
  leaseCode: string | null;
  role: "TENANT" | "LANDLORD";
  question: string;
  property: { id: string; name: string; city: string | null };
  place: string | null;
  otherPartyName: string;
  stay: { from: string; to: string | null };
  closesAt: string;
  otherPartySubmitted: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  overall: "Overall",
  propertyCondition: "Property condition",
  communication: "Communication",
  maintenance: "Maintenance response",
  rentTransparency: "Rent transparency",
  depositRefund: "Deposit refund",
  agreementTransparency: "Agreement transparency",
  problemResolution: "Problem resolution",
  rentPunctuality: "Rent punctuality",
  propertyCare: "Property care",
  cleanliness: "Cleanliness",
  agreementCompliance: "Agreement compliance",
  moveOutCondition: "Move-out condition",
};

const REPORT_REASONS = ["FALSE_INFORMATION", "HARASSMENT", "PERSONAL_INFORMATION", "DISCRIMINATORY", "SPAM", "IRRELEVANT", "OTHER"];

/* ─── Small pieces ─── */

export function Stars({ value, size = "sm" }: { value: number | null; size?: "sm" | "lg" }) {
  const n = value ?? 0;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={value ? `${value} out of 5` : "No rating"}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn(size === "lg" ? "size-5" : "size-4", i <= Math.round(n) ? "fill-amber-400 text-amber-400" : "text-line")} />
      ))}
    </span>
  );
}

function StarInput({ label, value, onChange, required }: { label: string; value: number | null; onChange: (v: number | null) => void; required: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
      <span className="text-sm">{label}{required && " *"}</span>
      <span className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" aria-label={`${label}: ${i} star${i > 1 ? "s" : ""}`} aria-pressed={value === i} onClick={() => onChange(i)} className="flex size-9 items-center justify-center rounded-lg hover:bg-subtle">
            <Star className={cn("size-6", value && i <= value ? "fill-amber-400 text-amber-400" : "text-line")} />
          </button>
        ))}
        {!required && (
          <button type="button" onClick={() => onChange(null)} className={cn("ml-1 rounded px-1.5 text-xs", value === null ? "bg-subtle font-semibold text-ink" : "text-muted")}>N/A</button>
        )}
      </span>
    </div>
  );
}

export function StatsSummary({ stats, title }: { stats: RatingStats; title: string }) {
  return (
    <section className="card p-5">
      <h3 className="mb-2 text-sm font-semibold text-muted">{title}</h3>
      {stats.count === 0 ? (
        <p className="text-sm text-muted">No published reviews yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <div>
            <p className="text-3xl font-bold">{stats.average?.toFixed(1)}</p>
            <Stars value={stats.average} size="lg" />
            <p className="mt-1 text-xs text-muted">{stats.count} verified rental review{stats.count === 1 ? "" : "s"}</p>
          </div>
          <div className="space-y-1">
            {(["5", "4", "3", "2", "1"] as const).map((k) => (
              <div key={k} className="flex items-center gap-2 text-xs">
                <span className="w-3">{k}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-subtle"><div className="h-full bg-amber-400" style={{ width: `${(stats.distribution[k] / stats.count) * 100}%` }} /></div>
                <span className="w-6 text-right text-muted">{stats.distribution[k]}</span>
              </div>
            ))}
          </div>
          {Object.keys(stats.categories).filter((k) => k !== "overall").length > 0 && (
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:col-span-2 sm:grid-cols-2">
              {Object.entries(stats.categories).filter(([k]) => k !== "overall").map(([k, c]) => (
                <div key={k} className="flex justify-between"><dt className="text-muted">{CATEGORY_LABELS[k] ?? labelize(k)}</dt><dd className="font-medium">{c.average.toFixed(1)}</dd></div>
              ))}
            </dl>
          )}
        </div>
      )}
    </section>
  );
}

const STATUS_TEXT: Record<string, string> = {
  SUBMITTED: "Waiting to publish",
  PUBLISHED: "Published",
  FLAGGED: "Reported",
  UNDER_REVIEW: "Under review",
  REMOVED: "Removed",
  REJECTED: "Rejected",
};

export function ReviewCard({ review, onChanged, showStatus = false }: { review: Review; onChanged: () => void; showStatus?: boolean }) {
  const [reply, setReply] = useState<string | null>(null);
  const [report, setReport] = useState<{ reason: string; description: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, after: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after();
      onChanged();
    } catch (err) {
      const issues = err instanceof AppError ? (err.details?.issues as Array<{ message: string }> | undefined) : undefined;
      setError(issues?.length ? issues.map((i) => i.message).join(" · ") : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const sealed = review.overallRating === null;
  return (
    <article className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">
            {review.reviewerRole === "TENANT" ? "Tenant" : "Landlord"} {review.reviewerName} → {review.revieweeRole === "TENANT" ? "tenant" : "landlord"} {review.revieweeName}
          </p>
          <p className="text-xs text-muted">
            Verified stay · {review.place ? `${review.place}, ` : ""}{review.property.name}{review.property.city ? `, ${review.property.city}` : ""} · {formatDate(review.stay.from)} – {formatDate(review.stay.to)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(showStatus || review.status !== "PUBLISHED") && <Badge tone={review.status === "PUBLISHED" ? "success" : review.status === "SUBMITTED" ? "brand" : "warning"}>{STATUS_TEXT[review.status] ?? review.status}</Badge>}
          {!sealed && <Stars value={review.overallRating} />}
        </div>
      </div>
      {sealed ? (
        <p className="mt-3 text-sm text-muted">Hidden until published.</p>
      ) : (
        <>
          {review.categoryRatings && (
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {Object.entries(review.categoryRatings).filter(([k]) => k !== "overall").map(([k, v]) => (
                <div key={k} className="flex justify-between"><dt className="text-muted">{CATEGORY_LABELS[k] ?? labelize(k)}</dt><dd><Stars value={v} /></dd></div>
              ))}
            </dl>
          )}
          {review.reviewText && <p className="mt-3 whitespace-pre-line text-sm">{review.reviewText}</p>}
          {review.tags && review.tags.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{review.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>}
        </>
      )}
      {review.moderationNote && review.status !== "PUBLISHED" && <Alert kind="warning" className="mt-3">SafeRent: {review.moderationNote}</Alert>}
      {review.response && (
        <div className="mt-3 rounded-control bg-subtle p-3 text-sm">
          <p className="mb-1 text-xs font-semibold text-muted">Reply from {review.revieweeName}{review.response.hidden ? " (hidden by SafeRent)" : ""}</p>
          <p className="whitespace-pre-line">{review.response.text}</p>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">{review.code} · {review.publishedAt ? `Published ${formatTimestamp(review.publishedAt)}` : `Submitted ${formatTimestamp(review.submittedAt)}`}</p>
      {error && <Alert kind="error" className="mt-3">{error}</Alert>}
      {(review.canRespond || review.canReport) && reply === null && report === null && (
        <div className="mt-3 flex flex-wrap gap-2">
          {review.canRespond && <Button size="sm" variant="secondary" leftIcon={<MessageSquareReply className="size-4" />} onClick={() => setReply(review.response?.text ?? "")}>{review.response ? "Edit reply" : "Reply publicly"}</Button>}
          {review.canReport && <Button size="sm" variant="ghost" leftIcon={<Flag className="size-4" />} onClick={() => setReport({ reason: "FALSE_INFORMATION", description: "" })}>Report</Button>}
        </div>
      )}
      {reply !== null && (
        <div className="mt-3 space-y-2">
          <Textarea label="Your public reply" hint="One reply per review. You can edit it for 48 hours." rows={3} maxLength={1500} value={reply} onChange={(e) => setReply(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setReply(null)}>Cancel</Button>
            <Button size="sm" loading={busy} disabled={reply.trim().length < 2} onClick={() => void run(() => request(`/reviews/${review.id}/response`, { method: "PUT", body: { text: reply } }), () => setReply(null))}>Post reply</Button>
          </div>
        </div>
      )}
      {report !== null && (
        <div className="mt-3 space-y-2">
          <Select label="Why are you reporting this review?" options={REPORT_REASONS.map((r) => ({ value: r, label: labelize(r) }))} value={report.reason} onChange={(e) => setReport({ ...report, reason: e.target.value })} />
          <Textarea label="Details" rows={2} maxLength={1000} value={report.description} onChange={(e) => setReport({ ...report, description: e.target.value })} />
          <p className="text-xs text-muted">The review stays visible until SafeRent decides. Reports are never shown to the reviewer.</p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setReport(null)}>Cancel</Button>
            <Button size="sm" variant="danger" loading={busy} onClick={() => void run(() => request(`/reviews/${review.id}/report`, { method: "POST", body: { reason: report.reason, description: report.description || undefined } }), () => setReport(null))}>Send report</Button>
          </div>
        </div>
      )}
    </article>
  );
}

export interface ReviewDraft {
  ratings: Record<string, number | null>;
  text: string;
  tags: string[];
}

/** Star ratings + text + tags for one side of a lease (used in the review modal and the lease-close flow). */
export function ReviewFields({ form, value, onChange }: { form: { categories: Array<{ key: string; label: string; required: boolean }>; tags: string[] }; value: ReviewDraft; onChange: (v: ReviewDraft) => void }) {
  return (
    <div className="space-y-3">
      <div className="divide-y divide-line">
        {form.categories.map((c) => (
          <StarInput key={c.key} label={c.label} required={c.required} value={value.ratings[c.key] ?? null} onChange={(v) => onChange({ ...value, ratings: { ...value.ratings, [c.key]: v } })} />
        ))}
      </div>
      <Textarea label="Your review" hint="No phone numbers, emails, links or personal remarks." rows={3} maxLength={3000} value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} />
      <div className="flex flex-wrap gap-1.5">
        {form.tags.map((t) => (
          <button key={t} type="button" aria-pressed={value.tags.includes(t)} onClick={() => onChange({ ...value, tags: value.tags.includes(t) ? value.tags.filter((x) => x !== t) : [...value.tags, t] })} className={cn("rounded-full border px-3 py-1 text-xs", value.tags.includes(t) ? "border-brand bg-brand-bg font-semibold text-brand-dark" : "border-line")}>{t}</button>
        ))}
      </div>
    </div>
  );
}

/** Review status + form for one lease. Opened from My rental / Leases and from the pending list. */
export function LeaseReviewModal({ leaseId, title, onClose, onSubmitted }: { leaseId: string; title: string; onClose: () => void; onSubmitted?: () => void }) {
  const { data, loading, error, reload } = useQuery(() => request<LeaseReviewStatus>(`/leases/${leaseId}/review`), [leaseId]);
  const [ratings, setRatings] = useState<Record<string, number | null>>({});
  const [text, setText] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await request<{ status: string }>(`/leases/${leaseId}/review`, { method: "POST", body: { ratings, text: text.trim() || undefined, tags } });
      setMsg({ kind: "success", text: res.status === "PUBLISHED" ? "Thanks! Both reviews are now published." : "Thanks! Your review stays hidden until the other side reviews or the review window closes." });
      await reload();
      onSubmitted?.();
    } catch (err) {
      const issues = err instanceof AppError ? (err.details?.issues as Array<{ message: string }> | undefined) : undefined;
      setMsg({ kind: "error", text: issues?.length ? issues.map((i) => i.message).join(" · ") : errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={title} description={data?.role === "TENANT" ? "How was your rental experience with this landlord?" : data?.role === "LANDLORD" ? "How was your rental experience with this tenant?" : undefined}>
      <div className="max-h-[72vh] space-y-3 overflow-y-auto pr-1">
        {loading && !data && <div className="flex justify-center py-8"><Spinner className="size-6 text-brand" /></div>}
        {error && <Alert kind="error">{error}</Alert>}
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        {data && (
          <>
            {data.myReview && <ReviewCard review={data.myReview} onChanged={() => void reload()} showStatus />}
            {data.myReview?.status === "SUBMITTED" && (
              <p className="text-sm text-muted">
                {data.otherPartySubmitted ? "The other side has reviewed too — both will appear shortly." : `Reviews are revealed together when the other side reviews, or on ${formatTimestamp(data.closesAt)}.`}
              </p>
            )}
            {!data.myReview && !data.eligible && <Alert kind="info">{data.message}</Alert>}
            {data.eligible && data.form && (
              <>
                <Alert kind="info">
                  Optional. Your review stays private until the other side reviews or the window closes on {formatTimestamp(data.closesAt)}. Reviews can't be edited after you submit.
                  {data.otherPartySubmitted ? " The other side has already reviewed." : ""}
                </Alert>
                <div className="divide-y divide-line">
                  {data.form.categories.map((c) => (
                    <StarInput key={c.key} label={c.label} required={c.required} value={ratings[c.key] ?? null} onChange={(v) => setRatings({ ...ratings, [c.key]: v })} />
                  ))}
                </div>
                <Textarea label="Your review" hint="Describe the experience. No phone numbers, emails, links or personal remarks." rows={4} maxLength={3000} value={text} onChange={(e) => setText(e.target.value)} />
                <div>
                  <p className="mb-1.5 text-sm">Tags (optional)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.form.tags.map((t) => (
                      <button key={t} type="button" aria-pressed={tags.includes(t)} onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])} className={cn("rounded-full border px-3 py-1 text-xs", tags.includes(t) ? "border-brand bg-brand-bg font-semibold text-brand-dark" : "border-line")}>{t}</button>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="secondary" onClick={onClose}>Not now</Button>
                  <Button loading={busy} disabled={!ratings.overall} leftIcon={<Star className="size-4" />} onClick={() => void submit()}>Submit review</Button>
                </div>
              </>
            )}
            {data.published.filter((r) => !r.isMine).map((r) => <ReviewCard key={r.id} review={r} onChanged={() => void reload()} />)}
          </>
        )}
      </div>
    </Modal>
  );
}

/* ─── /reviews — my rating, pending reviews, received and written ─── */

type MyTab = "received" | "written";

export function MyReviewsPage() {
  const [tab, setTab] = useState<MyTab>("received");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<PendingReview | null>(null);
  const pending = useQuery(() => request<{ items: PendingReview[] }>("/reviews/pending"), []);
  const list = useQuery(() => request<Paged<Review> & { stats: { asLandlord: RatingStats; asTenant: RatingStats } | null }>("/reviews/mine", { query: { direction: tab, page } }), [tab, page]);
  const stats = list.data?.stats;

  return (
    <>
      <PageHeader title="Reviews" description="Two-way reviews from verified rentals. Reviews are optional and revealed together." />
      {pending.data && pending.data.items.length > 0 && (
        <section className="card mb-6 p-5">
          <h2 className="mb-3 font-semibold">Waiting for your review</h2>
          <ul className="divide-y divide-line">
            {pending.data.items.map((p) => (
              <li key={p.leaseId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{p.place ? `${p.place} · ` : ""}{p.property.name} <span className="text-sm font-normal text-muted">with {p.otherPartyName}</span></p>
                  <p className="text-xs text-muted">{formatDate(p.stay.from)} – {formatDate(p.stay.to)} · open until {formatTimestamp(p.closesAt)}{p.otherPartySubmitted ? " · the other side has reviewed" : ""}</p>
                </div>
                <Button size="sm" leftIcon={<Star className="size-4" />} onClick={() => setOpen(p)}>Write review</Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {tab === "received" && stats && (stats.asLandlord.count > 0 || stats.asTenant.count > 0) && (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          {stats.asLandlord.count > 0 && <StatsSummary stats={stats.asLandlord} title="Your rating as a landlord" />}
          {stats.asTenant.count > 0 && <StatsSummary stats={stats.asTenant} title="Your rating as a tenant" />}
        </div>
      )}
      <div className="mb-4">
        <Tabs<MyTab> idPrefix="rev" value={tab} onChange={(t) => { setTab(t); setPage(1); }} items={[{ value: "received", label: "About me" }, { value: "written", label: "Written by me" }]} />
      </div>
      {list.loading && !list.data && <div className="flex justify-center py-12"><Spinner className="size-7 text-brand" /></div>}
      {list.error && <Alert kind="error">{list.error}</Alert>}
      {list.data && list.data.items.length === 0 && <p className="card p-5 text-sm text-muted">{tab === "received" ? "No published reviews about you yet." : "You haven't written any reviews yet."}</p>}
      <div className="space-y-3">
        {list.data?.items.map((r) => <ReviewCard key={r.id} review={r} onChanged={() => void list.reload()} showStatus={tab === "written"} />)}
      </div>
      {list.data && list.data.totalPages > 1 && <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={setPage} />}
      {open && (
        <LeaseReviewModal
          leaseId={open.leaseId}
          title={`${open.place ? `${open.place} · ` : ""}${open.property.name}`}
          onClose={() => setOpen(null)}
          onSubmitted={() => {
            void pending.reload();
            void list.reload();
          }}
        />
      )}
    </>
  );
}

/* ─── Property page → Reviews tab ─── */

export function PropertyReviewsTab({ propertyId, units }: { propertyId: string; units: Array<{ id: string; label: string }> }) {
  const [unitId, setUnitId] = useState("");
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useQuery(() => request<Paged<Review> & { stats: RatingStats }>(`/properties/${propertyId}/reviews`, { query: { unitId: unitId || undefined, page } }), [propertyId, unitId, page]);
  return (
    <div className="space-y-4">
      {units.length > 1 && (
        <div className="max-w-xs">
          <Select label="Show" options={[{ value: "", label: "Whole property" }, ...units.map((u) => ({ value: u.id, label: u.label }))]} value={unitId} onChange={(e) => { setUnitId(e.target.value); setPage(1); }} />
        </div>
      )}
      {loading && !data && <div className="flex justify-center py-10"><Spinner className="size-6 text-brand" /></div>}
      {error && <Alert kind="error">{error}</Alert>}
      {data && <StatsSummary stats={data.stats} title={unitId ? "Rating for this unit (tenant reviews)" : "Property rating (tenant reviews)"} />}
      {data?.items.map((r) => <ReviewCard key={r.id} review={r} onChanged={() => void reload()} />)}
      {data && data.totalPages > 1 && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />}
    </div>
  );
}

/* ─── Admin: /review-moderation ─── */

interface ReportRow {
  id: string;
  reason: string;
  description: string | null;
  status: string;
  createdAt: string;
  reportedBy: string | null;
  review: { id: string; code: string; status: string; overallRating: number; reviewText: string | null; property: { title: string | null; code: string } };
}

interface ModerationDetail {
  review: Review;
  reports: Array<{ id: string; reason: string; description: string | null; status: string; resolution: string | null; createdAt: string; reportedBy: string | null; reviewedBy: string | null }>;
  history: Array<{ id: string; action: string; fromStatus: string | null; toStatus: string | null; reason: string; createdAt: string; moderator: string | null }>;
}

type ModTab = "reports" | "reviews";

export function ReviewModerationPage() {
  const [tab, setTab] = useState<ModTab>("reports");
  const [status, setStatus] = useState("");
  const [rating, setRating] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const reports = useQuery(() => request<Paged<ReportRow>>("/moderation/review-reports", { query: { status: "OPEN", page } }), [page], tab === "reports");
  const reviews = useQuery(() => request<Paged<Review>>("/moderation/reviews", { query: { status: status || undefined, rating: rating || undefined, q: q || undefined, page } }), [status, rating, q, page], tab === "reviews");

  return (
    <>
      <PageHeader title="Review moderation" description="Hide or restore reviews with a reason. Ratings and text are never edited; every action is logged." />
      <div className="mb-4">
        <Tabs<ModTab> idPrefix="mod" value={tab} onChange={(t) => { setTab(t); setPage(1); }} items={[{ value: "reports", label: "Open reports" }, { value: "reviews", label: "All reviews" }]} />
      </div>
      {tab === "reports" && (
        <>
          {reports.error && <Alert kind="error">{reports.error}</Alert>}
          {reports.data && reports.data.items.length === 0 && <p className="card p-5 text-sm text-muted">No open reports.</p>}
          <ul className="space-y-2">
            {reports.data?.items.map((r) => (
              <li key={r.id} className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold">{labelize(r.reason)} <span className="text-xs font-normal text-muted">by {r.reportedBy} · {formatTimestamp(r.createdAt)}</span></p>
                  <p className="truncate text-sm text-muted">{r.review.code} · {r.review.property.title ?? r.review.property.code} · {r.review.overallRating}★ · {r.review.reviewText ?? "(no text)"}</p>
                  {r.description && <p className="text-sm">“{r.description}”</p>}
                </div>
                <Button size="sm" variant="secondary" onClick={() => setOpenId(r.review.id)}>Open</Button>
              </li>
            ))}
          </ul>
          {reports.data && reports.data.totalPages > 1 && <Pagination page={reports.data.page} totalPages={reports.data.totalPages} total={reports.data.total} onPage={setPage} />}
        </>
      )}
      {tab === "reviews" && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Input label="Search" placeholder="Landlord, tenant, property or review ID" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            <Select label="Status" options={[{ value: "", label: "All (except unpublished)" }, ...["PUBLISHED", "FLAGGED", "UNDER_REVIEW", "REMOVED", "REJECTED"].map((s) => ({ value: s, label: labelize(s) }))]} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} />
            <Select label="Rating" options={[{ value: "", label: "Any" }, ...["1", "2", "3", "4", "5"].map((s) => ({ value: s, label: `${s} star${s === "1" ? "" : "s"}` }))]} value={rating} onChange={(e) => { setRating(e.target.value); setPage(1); }} />
          </div>
          {reviews.error && <Alert kind="error">{reviews.error}</Alert>}
          <ul className="space-y-2">
            {reviews.data?.items.map((r) => (
              <li key={r.id} className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold">{r.reviewerName} → {r.revieweeName} <span className="text-xs font-normal text-muted">{r.code}</span></p>
                  <p className="truncate text-sm text-muted">{r.place ? `${r.place}, ` : ""}{r.property.name} · {r.overallRating}★ · {r.reviewText ?? "(no text)"}</p>
                </div>
                <div className="flex items-center gap-2">
                  {!!r.openReports && <Badge tone="danger">{r.openReports} report{r.openReports > 1 ? "s" : ""}</Badge>}
                  <Badge tone={r.status === "PUBLISHED" ? "success" : "warning"}>{STATUS_TEXT[r.status] ?? r.status}</Badge>
                  <Button size="sm" variant="secondary" onClick={() => setOpenId(r.id)}>Open</Button>
                </div>
              </li>
            ))}
          </ul>
          {reviews.data && reviews.data.totalPages > 1 && <Pagination page={reviews.data.page} totalPages={reviews.data.totalPages} total={reviews.data.total} onPage={setPage} />}
        </>
      )}
      {openId && (
        <ModerationModal
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            void reports.reload();
            void reviews.reload();
          }}
        />
      )}
    </>
  );
}

function ModerationModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, error, reload } = useQuery(() => request<ModerationDetail>(`/moderation/reviews/${id}`), [id]);
  const { confirm, dialog } = useConfirm();
  const [msg, setMsg] = useState<string | null>(null);
  const act = (title: string, path: string, body: (reason: string) => unknown, tone?: "danger") =>
    confirm({
      title,
      message: "This is recorded in the moderation history with your reason.",
      tone,
      confirmLabel: title,
      reason: { label: "Reason", required: true, minLength: 5 },
      onConfirm: async (reason) => {
        await request(path, { method: "POST", body: body(reason ?? "") });
        setMsg(`${title} — done.`);
        await reload();
        onChanged();
      },
    });
  const r = data?.review;
  const actions: Array<[string, string, boolean]> = r
    ? ([
        ["HIDE", "Hide review", ["PUBLISHED", "FLAGGED", "UNDER_REVIEW"].includes(r.status)],
        ["RESTORE", "Restore review", ["REMOVED", "FLAGGED", "UNDER_REVIEW", "REJECTED"].includes(r.status)],
        ["UNDER_REVIEW", "Mark under review", ["PUBLISHED", "FLAGGED"].includes(r.status)],
        ["HIDE_RESPONSE", "Hide reply", !!r.response && !r.response.hidden],
        ["RESTORE_RESPONSE", "Restore reply", !!r.response?.hidden],
      ] as Array<[string, string, boolean]>)
    : [];
  return (
    <Modal open onClose={onClose} title={r ? `Review ${r.code}` : "Review"}>
      <div className="max-h-[72vh] space-y-3 overflow-y-auto pr-1">
        {error && <Alert kind="error">{error}</Alert>}
        {msg && <Alert kind="success">{msg}</Alert>}
        {r && (
          <>
            <ReviewCard review={{ ...r, canReport: false, canRespond: false }} onChanged={() => undefined} showStatus />
            <div className="flex flex-wrap gap-2">
              {actions.filter(([, , show]) => show).map(([action, label]) => (
                <Button key={action} size="sm" variant={action.startsWith("HIDE") ? "danger" : "secondary"} onClick={() => act(label, `/moderation/reviews/${id}`, (reason) => ({ action, reason }), action.startsWith("HIDE") ? "danger" : undefined)}>{label}</Button>
              ))}
            </div>
            <h3 className="pt-2 text-sm font-semibold">Reports</h3>
            {data.reports.length === 0 && <p className="text-sm text-muted">None.</p>}
            {data.reports.map((rep) => (
              <div key={rep.id} className="rounded-control border border-line p-3 text-sm">
                <p className="font-medium">{labelize(rep.reason)} · {rep.reportedBy} <Badge>{rep.status}</Badge></p>
                {rep.description && <p className="text-muted">{rep.description}</p>}
                {rep.resolution && <p className="text-xs text-muted">Resolution: {rep.resolution} ({rep.reviewedBy})</p>}
                {rep.status === "OPEN" && (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => act("Dismiss report", `/moderation/review-reports/${rep.id}`, (resolution) => ({ decision: "DISMISSED", resolution }))}>Dismiss</Button>
                    <Button size="sm" onClick={() => act("Uphold report", `/moderation/review-reports/${rep.id}`, (resolution) => ({ decision: "UPHELD", resolution }))}>Uphold</Button>
                  </div>
                )}
              </div>
            ))}
            <h3 className="pt-2 text-sm font-semibold">Moderation history</h3>
            {data.history.length === 0 && <p className="text-sm text-muted">No actions yet.</p>}
            <ul className="space-y-1 text-sm">
              {data.history.map((h) => (
                <li key={h.id}><span className="font-medium">{labelize(h.action)}</span> by {h.moderator} · {formatTimestamp(h.createdAt)} — {h.reason}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      {dialog}
    </Modal>
  );
}
