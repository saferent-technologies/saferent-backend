import { CheckCircle2, Circle, Copy, Gift, MessageCircle, RefreshCw, Share2, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
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
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import type { Paged } from "@/types/auth";
import { cn } from "@/utils/cn";
import { AppError, errorMessage } from "@/utils/errors";
import { formatDate, formatMoney, formatTimestamp, labelize } from "@/utils/format";
import { savePendingReferral } from "@/routes/pendingReferral";

/* ─── Types (shared by Android, iOS and the Admin Panel) ─── */

interface Step {
  key: string;
  label: string;
  done: boolean;
}

interface MyReferrals {
  codes: Array<{ kind: "TENANT" | "LANDLORD"; code: string; url: string; expiresAt: string | null; opens: number; reward: string; shareText: string; terms: string | null }>;
  stats: {
    tenantToTenant: { total: number; successful: number; pending: number; rejected: number; earned: number; rewardPerReferral: number | null } | null;
    landlordToTenant: { total: number; successful: number; pending: number; rejected: number; earned: number; rewardPerReferral: number | null; invitations: Record<string, number> } | null;
    landlordToLandlord: { total: number; successful: number; pending: number; rejected: number; earned: number; monthsPerReferral: number | null } | null;
  };
  history: Array<{
    id: string;
    code: string;
    type: string;
    person: string;
    status: string;
    rewardStatus: string;
    onHold: boolean;
    reason: string | null;
    steps: Step[] | null;
    reward: { kind: "CREDIT"; amount: string } | { kind: "SUBSCRIPTION"; plan: string; months: number; status: string; endsAt: string | null } | null;
    createdAt: string;
    rewardedAt: string | null;
  }>;
  wallet: WalletSummary;
  entitlements: Array<{ id: string; planName: string; months: number; status: string; startsAt: string | null; endsAt: string | null; createdAt: string }>;
}

interface WalletSummary {
  balance: string;
  promoBalance?: string;
  cashBalance?: string;
  lifetimeEarned: string;
  currency: string;
  nextExpiry: { amount: string; on: string } | null;
  rules: string[];
}

interface WalletTxn {
  id: string;
  type: string;
  amount: string;
  balanceAfter: string;
  note: string | null;
  expiresAt: string | null;
  createdAt: string;
}

const TYPE_LABEL: Record<string, string> = { TENANT_TO_TENANT: "Tenant → tenant", LANDLORD_TO_TENANT: "Tenant invitation", LANDLORD_TO_LANDLORD: "Landlord → landlord" };
const STATUS_TONE: Record<string, "brand" | "success" | "neutral" | "danger" | "warning"> = {
  REGISTERED: "brand",
  PHONE_VERIFIED: "brand",
  ONBOARDING_PENDING: "brand",
  VERIFICATION_PENDING: "warning",
  ELIGIBLE: "warning",
  SUCCESSFUL: "success",
  EXPIRED: "neutral",
  REJECTED: "danger",
  REVERSED: "danger",
};

/* ─── /ref/:code — landing page from a shared link (before sign-up) ─── */

export function RefLandingPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const { status } = useAuth();
  const [info, setInfo] = useState<{ code: string; kind: "TENANT" | "LANDLORD"; referrerName: string; terms: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    request<{ code: string; kind: "TENANT" | "LANDLORD"; referrerName: string; terms: string | null }>(`/referrals/codes/${encodeURIComponent(code)}`, { auth: false })
      .then((r) => {
        setInfo(r);
        // First valid link opened before sign-up is the one that counts.
        savePendingReferral(r.code, r.kind);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [code]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-subtle p-4">
      <section className="card w-full max-w-md space-y-4 p-6 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-bg text-brand-dark"><Gift className="size-6" /></span>
        {!info && !error && <Spinner className="mx-auto size-6 text-brand" />}
        {error && <Alert kind="warning">{error}</Alert>}
        {info && (
          <>
            <h1 className="text-xl font-semibold">{info.referrerName} invited you to SafeRent</h1>
            <p className="text-sm text-muted">{info.kind === "TENANT" ? "Find verified rental homes, pay rent and raise requests in one place." : "List your property, find verified tenants and track rent in one place."}</p>
            {status === "authenticated" ? (
              <Alert kind="info">You already have a SafeRent account. Referral links are for new accounts.</Alert>
            ) : (
              <Button className="w-full" onClick={() => navigate("/login")}>Join SafeRent as a {info.kind === "TENANT" ? "tenant" : "landlord"}</Button>
            )}
            {info.terms && <p className="whitespace-pre-line text-left text-xs text-muted">{info.terms}</p>}
          </>
        )}
        <Link to="/dashboard" className="block text-sm font-semibold text-brand-dark">Go to SafeRent</Link>
      </section>
    </div>
  );
}

/* ─── /referrals — my links, rewards and wallet ─── */

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-control bg-subtle px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}

function CodeCard({ c, onRotate }: { c: MyReferrals["codes"][number]; onRotate: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="card space-y-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{c.kind === "TENANT" ? "Invite friends who rent" : "Invite other landlords"}</h2>
        <Badge tone="brand">{c.reward}</Badge>
      </div>
      <div className="flex items-center gap-2 rounded-control border border-line bg-subtle p-2">
        <span className="font-mono text-sm font-semibold">{c.code}</span>
        <input readOnly aria-label="Referral link" value={c.url} className="min-w-0 flex-1 bg-transparent text-sm text-muted outline-none" onFocus={(e) => e.target.select()} />
        <Button size="sm" variant="secondary" leftIcon={<Copy className="size-4" />} onClick={() => void navigator.clipboard.writeText(c.url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}>{copied ? "Copied" : "Copy"}</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <a className="inline-flex min-h-10 items-center gap-2 rounded-control bg-[#25D366] px-3 text-sm font-semibold text-white" href={`https://wa.me/?text=${encodeURIComponent(c.shareText)}`} target="_blank" rel="noreferrer"><MessageCircle className="size-4" /> WhatsApp</a>
        {typeof navigator.share === "function" && <Button variant="secondary" leftIcon={<Share2 className="size-4" />} onClick={() => void navigator.share({ text: c.shareText }).catch(() => undefined)}>Share</Button>}
        <Button variant="ghost" leftIcon={<RefreshCw className="size-4" />} onClick={onRotate}>New link</Button>
      </div>
      <p className="text-xs text-muted">Opened {c.opens} time{c.opens === 1 ? "" : "s"}{c.expiresAt ? ` · expires ${formatDate(c.expiresAt)}` : ""}. Rewards come only when the person signs up and completes the steps — not for clicks.</p>
      {c.terms && <p className="whitespace-pre-line text-xs text-muted">{c.terms}</p>}
    </section>
  );
}

export function MyReferralsPage() {
  const { data, loading, error, reload } = useQuery(() => request<MyReferrals>("/referrals/me"), []);
  const wallet = useQuery(() => request<{ wallet: WalletSummary; redeemablePlans: Array<{ id: string; name: string; priceMonthly: string; features: string | null }> }>("/wallet"), []);
  const [txPage, setTxPage] = useState(1);
  const txns = useQuery(() => request<Paged<WalletTxn>>("/wallet/transactions", { query: { page: txPage } }), [txPage]);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const { confirm, dialog } = useConfirm();

  const refreshAll = async () => {
    await Promise.all([reload(), wallet.reload(), txns.reload()]);
  };

  if (loading && !data) return <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>;
  if (error || !data) return <Alert kind="error">{error ?? "Couldn't load referrals."}</Alert>;
  const s = data.stats;
  const w = wallet.data?.wallet ?? data.wallet;

  return (
    <>
      <PageHeader title="Refer & earn" description="Invite people to SafeRent. Rewards are promotional credit or free subscription time — never cash." />
      {msg && <Alert kind={msg.kind} className="mb-4">{msg.text}</Alert>}
      <div className="grid gap-4 lg:grid-cols-2">
        {data.codes.map((c) => (
          <CodeCard
            key={c.kind}
            c={c}
            onRotate={() =>
              confirm({
                title: "Make a new link",
                message: "Your current link stops working. People who already signed up with it are not affected.",
                confirmLabel: "New link",
                onConfirm: async () => {
                  await request(`/referrals/codes/${c.kind}/rotate`, { method: "POST" });
                  setMsg({ kind: "success", text: "New referral link created." });
                  await reload();
                },
              })
            }
          />
        ))}
        {s.landlordToTenant && (
          <section className="card space-y-3 p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">Invite tenants to your flats</h2>
              <Badge tone="brand">₹{s.landlordToTenant.rewardPerReferral ?? 0} per new tenant</Badge>
            </div>
            <p className="text-sm text-muted">Open a property → Invite tenant. You earn when the tenant accepts and the lease is active (once per tenant; your identity must be verified).</p>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Waiting for tenant" value={s.landlordToTenant.invitations.PENDING ?? 0} />
              <Stat label="Accepted" value={s.landlordToTenant.invitations.ACCEPTED ?? 0} />
              <Stat label="Earned" value={formatMoney(s.landlordToTenant.earned)} />
            </div>
            <Link to="/properties" className="text-sm font-semibold text-brand-dark">Go to my properties →</Link>
          </section>
        )}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {s.tenantToTenant && (
          <section className="card p-5">
            <h3 className="mb-3 text-sm font-semibold text-muted">Tenant referrals</h3>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Successful" value={s.tenantToTenant.successful} />
              <Stat label="Pending" value={s.tenantToTenant.pending} />
              <Stat label="Per referral" value={formatMoney(s.tenantToTenant.rewardPerReferral ?? 0)} />
              <Stat label="Total earned" value={formatMoney(s.tenantToTenant.earned)} />
            </div>
          </section>
        )}
        {s.landlordToLandlord && (
          <section className="card p-5">
            <h3 className="mb-3 text-sm font-semibold text-muted">Landlord referrals</h3>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Invited" value={s.landlordToLandlord.total} />
              <Stat label="Verified" value={s.landlordToLandlord.successful} />
              <Stat label="Free months earned" value={s.landlordToLandlord.earned} />
              <Stat label="Pending" value={s.landlordToLandlord.pending} />
            </div>
          </section>
        )}
        <section className="card p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted"><Wallet className="size-4" /> Promotional wallet</h3>
          <p className="text-3xl font-bold">{formatMoney(w.balance)}</p>
          <p className="text-xs text-muted">Earned so far {formatMoney(w.lifetimeEarned)}{w.nextExpiry ? ` · ${formatMoney(w.nextExpiry.amount)} expires ${formatDate(w.nextExpiry.on)}` : ""}</p>
          <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-muted">{w.rules.map((r) => <li key={r}>{r}</li>)}</ul>
          {wallet.data && wallet.data.redeemablePlans.length > 0 && <RedeemBox plans={wallet.data.redeemablePlans} balance={Number(w.balance)} onDone={async (t) => { setMsg({ kind: "success", text: t }); await refreshAll(); }} onError={(t) => setMsg({ kind: "error", text: t })} />}
        </section>
      </div>

      {data.entitlements.length > 0 && (
        <section className="card mt-6 p-5">
          <h2 className="mb-3 font-semibold">Free subscription months</h2>
          <ul className="divide-y divide-line text-sm">
            {data.entitlements.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{e.months} month{e.months > 1 ? "s" : ""} of <strong>{e.planName}</strong></span>
                <span className="text-muted">{e.status === "NEXT_BILLING" ? "Applied to your next billing cycle" : e.status === "CANCELLED" ? "Cancelled" : `${formatDate(e.startsAt)} – ${formatDate(e.endsAt)}`}</span>
                <Badge tone={e.status === "CANCELLED" ? "danger" : "success"}>{labelize(e.status)}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card mt-6 p-5">
        <h2 className="mb-3 font-semibold">Referral history</h2>
        {data.history.length === 0 && <p className="text-sm text-muted">No referrals yet. Share your link to get started.</p>}
        <ul className="divide-y divide-line">
          {data.history.map((h) => (
            <li key={h.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{h.person} <span className="text-xs font-normal text-muted">{TYPE_LABEL[h.type]} · {h.code} · {formatDate(h.createdAt)}</span></p>
                <div className="flex items-center gap-2">
                  {h.onHold && <Badge tone="warning">Under review</Badge>}
                  <Badge tone={STATUS_TONE[h.status] ?? "neutral"}>{labelize(h.status)}</Badge>
                  {h.reward && <Badge tone="success">{h.reward.kind === "CREDIT" ? `+${formatMoney(h.reward.amount)}` : `${h.reward.months} free month · ${h.reward.plan}`}</Badge>}
                </div>
              </div>
              {h.reason && <p className="text-xs text-danger">{h.reason}</p>}
              {h.steps && (
                <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {h.steps.map((st) => (
                    <li key={st.key} className={cn("flex items-center gap-1", st.done ? "text-success" : "text-muted")}>{st.done ? <CheckCircle2 className="size-3.5" /> : <Circle className="size-3.5" />}{st.label}</li>
                  ))}
                </ol>
              )}
              {h.rewardedAt && <p className="text-xs text-muted">Rewarded {formatTimestamp(h.rewardedAt)}</p>}
            </li>
          ))}
        </ul>
      </section>

      <section className="card mt-6 p-5">
        <h2 className="mb-3 font-semibold">Wallet transactions</h2>
        {txns.data && txns.data.items.length === 0 && <p className="text-sm text-muted">No transactions yet.</p>}
        <ul className="divide-y divide-line text-sm">
          {txns.data?.items.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{labelize(t.type)}{t.note ? <span className="text-muted"> · {t.note}</span> : null}</span>
              <span className="text-muted">{formatTimestamp(t.createdAt)}{t.expiresAt ? ` · expires ${formatDate(t.expiresAt)}` : ""}</span>
              <span className={cn("font-semibold", Number(t.amount) >= 0 ? "text-success" : "text-danger")}>{Number(t.amount) >= 0 ? "+" : ""}{formatMoney(t.amount)}</span>
            </li>
          ))}
        </ul>
        {txns.data && txns.data.totalPages > 1 && <Pagination page={txns.data.page} totalPages={txns.data.totalPages} total={txns.data.total} onPage={setTxPage} />}
      </section>
      {dialog}
    </>
  );
}

function RedeemBox({ plans, balance, onDone, onError }: { plans: Array<{ id: string; name: string; priceMonthly: string }>; balance: number; onDone: (t: string) => void | Promise<void>; onError: (t: string) => void }) {
  const affordable = plans.filter((p) => Number(p.priceMonthly) <= balance);
  const [planId, setPlanId] = useState(affordable[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  if (!affordable.length) return <p className="mt-3 text-xs text-muted">Collect {formatMoney(Math.min(...plans.map((p) => Number(p.priceMonthly))))} to redeem a month of a SafeRent plan.</p>;
  return (
    <div className="mt-3 flex items-end gap-2">
      <div className="flex-1"><Select label="Redeem for 1 month of" options={affordable.map((p) => ({ value: p.id, label: `${p.name} · ${formatMoney(p.priceMonthly)}` }))} value={planId} onChange={(e) => setPlanId(e.target.value)} /></div>
      <Button
        loading={busy}
        disabled={!planId}
        onClick={async () => {
          setBusy(true);
          try {
            await request("/wallet/redeem", { method: "POST", body: { planId, requestId } });
            await onDone("Subscription activated with your credit.");
          } catch (err) {
            onError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        Redeem
      </Button>
    </div>
  );
}

/* ─── Admin: /admin/referrals ─── */

interface AdminRow {
  id: string;
  code: string;
  type: string;
  status: string;
  rewardStatus: string;
  onHold: boolean;
  holdReason: string | null;
  rejectionReason: string | null;
  createdAt: string;
  referrer: { fullName: string; phoneNumber: string | null } | null;
  referred: { fullName: string; phoneNumber: string | null } | null;
}

interface Summary {
  total: number;
  byType: Record<string, number>;
  successful: number;
  pending: number;
  rejected: number;
  onHold: number;
  creditsIssued: string;
  freeMonthsGranted: number;
  linkOpens: number;
  conversionRate: number;
}

interface CampaignRow {
  type: string;
  enabled: boolean;
  rewardAmount: number | null;
  durationMonths: number | null;
  maxRewardsPerUser: number | null;
  startsAt: string | null;
  endsAt: string | null;
  codeExpiryDays: number | null;
  rewardExpiryDays: number | null;
  tenantEligibility?: string;
  terms: string | null;
}

type AdminTab = "referrals" | "campaigns";

export function AdminReferralsPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<AdminTab>("referrals");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [onHold, setOnHold] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const summary = useQuery(() => request<Summary>("/admin/referrals/summary"), []);
  const list = useQuery(() => request<Paged<AdminRow>>("/admin/referrals", { query: { type: type || undefined, status: status || undefined, onHold: onHold ? "true" : undefined, q: q || undefined, page } }), [type, status, onHold, q, page]);
  const s = summary.data;

  return (
    <>
      <PageHeader title="Referral management" description="Referrals, rewards and campaign rules. Ledger entries can't be edited — reversals add a new entry." />
      {s && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
          <Stat label="Total referrals" value={s.total} />
          <Stat label="Tenant (link / invite)" value={`${s.byType.TENANT_TO_TENANT ?? 0} / ${s.byType.LANDLORD_TO_TENANT ?? 0}`} />
          <Stat label="Landlord referrals" value={s.byType.LANDLORD_TO_LANDLORD ?? 0} />
          <Stat label="Successful" value={s.successful} />
          <Stat label="Pending (on hold)" value={`${s.pending} (${s.onHold})`} />
          <Stat label="Rejected / reversed" value={s.rejected} />
          <Stat label="Credits issued" value={formatMoney(s.creditsIssued)} />
          <Stat label="Free months granted" value={s.freeMonthsGranted} />
          <Stat label="Link opens" value={s.linkOpens} />
          <Stat label="Conversion" value={`${s.conversionRate}%`} />
        </div>
      )}
      <div className="mb-4">
        <Tabs<AdminTab> idPrefix="refadm" value={tab} onChange={setTab} items={[{ value: "referrals", label: "Referrals" }, { value: "campaigns", label: "Campaigns" }]} />
      </div>
      {tab === "referrals" && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <Input label="Search" placeholder="Name, phone, email or SR-REF code" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            <Select label="Type" options={[{ value: "", label: "All types" }, ...Object.entries(TYPE_LABEL).map(([v, l]) => ({ value: v, label: l }))]} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} />
            <Select label="Status" options={[{ value: "", label: "All statuses" }, ...Object.keys(STATUS_TONE).map((v) => ({ value: v, label: labelize(v) }))]} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} />
            <label className="flex items-end gap-2 pb-2.5 text-sm"><input type="checkbox" checked={onHold} onChange={(e) => { setOnHold(e.target.checked); setPage(1); }} /> On hold only</label>
          </div>
          {list.error && <Alert kind="error">{list.error}</Alert>}
          <ul className="space-y-2">
            {list.data?.items.map((r) => (
              <li key={r.id} className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold">{r.referrer?.fullName} → {r.referred?.fullName} <span className="text-xs font-normal text-muted">{r.code} · {TYPE_LABEL[r.type]} · {formatDate(r.createdAt)}</span></p>
                  {(r.holdReason || r.rejectionReason) && <p className="text-xs text-muted">{r.holdReason ?? r.rejectionReason}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {r.onHold && <Badge tone="warning">On hold</Badge>}
                  <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{labelize(r.status)}</Badge>
                  <Badge>{labelize(r.rewardStatus)}</Badge>
                  <Button size="sm" variant="secondary" onClick={() => setOpenId(r.id)}>Open</Button>
                </div>
              </li>
            ))}
          </ul>
          {list.data && list.data.totalPages > 1 && <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={setPage} />}
        </>
      )}
      {tab === "campaigns" && <Campaigns canEdit={can("settings.manage")} />}
      {openId && <AdminReferralModal id={openId} onClose={() => setOpenId(null)} onChanged={() => { void list.reload(); void summary.reload(); }} />}
    </>
  );
}

function AdminReferralModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, error, reload } = useQuery(() => request<{ referral: AdminRow & { rewardedAt: string | null; eligibleAt: string | null }; steps: Step[]; ledger: Array<{ id: string; type: string; amount: string; createdAt: string; note: string | null }>; events: Array<{ id: string; event: string; createdAt: string; actor: string | null; data: Record<string, unknown> | null }> }>(`/admin/referrals/${id}`), [id]);
  const { confirm, dialog } = useConfirm();
  const [msg, setMsg] = useState<string | null>(null);
  const r = data?.referral;
  const act = (action: string, title: string, tone?: "danger") =>
    confirm({
      title,
      message: "Recorded in the referral history and audit log with your reason.",
      tone,
      confirmLabel: title,
      reason: { label: "Reason", required: true, minLength: 5 },
      onConfirm: async (reason) => {
        await request(`/admin/referrals/${id}/action`, { method: "POST", body: { action, reason } });
        setMsg(`${title} — done.`);
        await reload();
        onChanged();
      },
    });
  const open = r && ["REGISTERED", "PHONE_VERIFIED", "ONBOARDING_PENDING", "VERIFICATION_PENDING", "ELIGIBLE"].includes(r.status);
  return (
    <Modal open onClose={onClose} title={r ? `Referral ${r.code}` : "Referral"} description={r ? `${TYPE_LABEL[r.type]} · ${r.referrer?.fullName} (${r.referrer?.phoneNumber ?? "—"}) → ${r.referred?.fullName} (${r.referred?.phoneNumber ?? "—"})` : undefined}>
      <div className="max-h-[72vh] space-y-3 overflow-y-auto pr-1 text-sm">
        {error && <Alert kind="error">{error}</Alert>}
        {msg && <Alert kind="success">{msg}</Alert>}
        {r && data && (
          <>
            <div className="flex flex-wrap gap-2"><Badge tone={STATUS_TONE[r.status]}>{labelize(r.status)}</Badge><Badge>{labelize(r.rewardStatus)}</Badge>{r.onHold && <Badge tone="warning">On hold: {r.holdReason}</Badge>}</div>
            <ol className="space-y-1">{data.steps.map((st) => <li key={st.key} className={cn("flex items-center gap-1.5", st.done ? "text-success" : "text-muted")}>{st.done ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}{st.label}</li>)}</ol>
            <div className="flex flex-wrap gap-2">
              {open && !r.onHold && <Button size="sm" variant="secondary" onClick={() => act("HOLD", "Hold for review")}>Hold</Button>}
              {r.onHold && <Button size="sm" onClick={() => act("RELEASE", "Release")}>Release</Button>}
              {open && <Button size="sm" variant="danger" onClick={() => act("REJECT", "Reject referral", "danger")}>Reject</Button>}
              {r.rewardStatus === "REWARD_CREDITED" && <Button size="sm" variant="danger" onClick={() => act("REVERSE", "Reverse reward", "danger")}>Reverse reward</Button>}
              {open && <Button size="sm" variant="ghost" onClick={() => act("RECHECK", "Re-check eligibility")}>Re-check</Button>}
            </div>
            <h3 className="pt-2 font-semibold">Reward ledger</h3>
            {data.ledger.length === 0 ? <p className="text-muted">No ledger entries.</p> : data.ledger.map((l) => <p key={l.id}>{labelize(l.type)} · {formatMoney(l.amount)} · {formatTimestamp(l.createdAt)}{l.note ? ` · ${l.note}` : ""}</p>)}
            <h3 className="pt-2 font-semibold">History</h3>
            <ul className="space-y-1">{data.events.map((e) => <li key={e.id}><span className="font-medium">{labelize(e.event)}</span> · {formatTimestamp(e.createdAt)}{e.actor ? ` · ${e.actor}` : ""}{e.data && typeof e.data.reason === "string" ? ` — ${e.data.reason}` : ""}</li>)}</ul>
          </>
        )}
      </div>
      {dialog}
    </Modal>
  );
}

function Campaigns({ canEdit }: { canEdit: boolean }) {
  const { data, error, reload } = useQuery(() => request<{ items: CampaignRow[] }>("/admin/referral-campaigns"), []);
  const [edit, setEdit] = useState<CampaignRow | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const num = (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v));
  const day = (s: string | null) => (s ? s.slice(0, 10) : "");
  const save = async () => {
    if (!edit) return;
    setBusy(true);
    setMsg(null);
    try {
      await request(`/admin/referral-campaigns/${edit.type}`, {
        method: "PUT",
        body: {
          enabled: edit.enabled,
          rewardAmount: edit.type === "LANDLORD_TO_LANDLORD" ? null : num(edit.rewardAmount),
          durationMonths: edit.type === "LANDLORD_TO_LANDLORD" ? num(edit.durationMonths) : null,
          maxRewardsPerUser: num(edit.maxRewardsPerUser),
          startsAt: edit.startsAt || null,
          endsAt: edit.endsAt || null,
          codeExpiryDays: num(edit.codeExpiryDays),
          rewardExpiryDays: num(edit.rewardExpiryDays),
          tenantEligibility: edit.type === "TENANT_TO_TENANT" ? (edit.tenantEligibility ?? "PROFILE_COMPLETE") : null,
          terms: edit.terms || null,
        },
      });
      setMsg({ kind: "success", text: "Campaign saved." });
      setEdit(null);
      await reload();
    } catch (err) {
      const issues = err instanceof AppError ? (err.details?.issues as Array<{ message: string }> | undefined) : undefined;
      setMsg({ kind: "error", text: issues?.length ? issues.map((i) => i.message).join(" · ") : errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {!canEdit && <Alert kind="info">Only Super Admin can change campaign rules.</Alert>}
      {data?.items.map((c) => (
        <section key={c.type} className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">{TYPE_LABEL[c.type]} {c.enabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}</p>
            <p className="text-sm text-muted">
              {c.type === "LANDLORD_TO_LANDLORD" ? `${c.durationMonths} free month(s) of the highest landlord plan` : `₹${c.rewardAmount} promotional credit`}
              {c.maxRewardsPerUser ? ` · max ${c.maxRewardsPerUser} per person` : ""}
              {c.rewardExpiryDays ? ` · credit expires after ${c.rewardExpiryDays} days` : ""}
              {c.startsAt || c.endsAt ? ` · ${formatDate(c.startsAt)} – ${formatDate(c.endsAt)}` : ""}
            </p>
          </div>
          {canEdit && <Button size="sm" variant="secondary" onClick={() => setEdit({ ...c, startsAt: day(c.startsAt), endsAt: day(c.endsAt) })}>Edit</Button>}
        </section>
      ))}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? `Edit ${TYPE_LABEL[edit.type]}` : ""}>
        {edit && (
          <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.enabled} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} /> Enabled</label>
            {edit.type === "LANDLORD_TO_LANDLORD" ? (
              <Input label="Free months" type="number" min={1} max={12} value={edit.durationMonths ?? ""} onChange={(e) => setEdit({ ...edit, durationMonths: e.target.value as unknown as number })} />
            ) : (
              <Input label="Reward (₹ promotional credit)" type="number" min={1} value={edit.rewardAmount ?? ""} onChange={(e) => setEdit({ ...edit, rewardAmount: e.target.value as unknown as number })} />
            )}
            {edit.type === "TENANT_TO_TENANT" && (
              <Select label="Friend counts as onboarded when" options={[{ value: "PROFILE_COMPLETE", label: "Profile completed (or rented a home)" }, { value: "ACTIVE_LEASE", label: "Rented a home on SafeRent" }]} value={edit.tenantEligibility ?? "PROFILE_COMPLETE"} onChange={(e) => setEdit({ ...edit, tenantEligibility: e.target.value })} />
            )}
            <div className="grid grid-cols-2 gap-3">
              <Input label="Max rewards per person" type="number" min={1} value={edit.maxRewardsPerUser ?? ""} onChange={(e) => setEdit({ ...edit, maxRewardsPerUser: e.target.value as unknown as number })} />
              <Input label="Credit expires after (days)" type="number" min={1} value={edit.rewardExpiryDays ?? ""} onChange={(e) => setEdit({ ...edit, rewardExpiryDays: e.target.value as unknown as number })} />
              <Input label="Links expire after (days)" type="number" min={1} hint="Empty = never" value={edit.codeExpiryDays ?? ""} onChange={(e) => setEdit({ ...edit, codeExpiryDays: e.target.value as unknown as number })} />
              <span />
              <Input label="Campaign start" type="date" value={edit.startsAt ?? ""} onChange={(e) => setEdit({ ...edit, startsAt: e.target.value })} />
              <Input label="Campaign end" type="date" value={edit.endsAt ?? ""} onChange={(e) => setEdit({ ...edit, endsAt: e.target.value })} />
            </div>
            <Textarea label="Terms shown to users" rows={4} maxLength={5000} value={edit.terms ?? ""} onChange={(e) => setEdit({ ...edit, terms: e.target.value })} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button>
              <Button loading={busy} onClick={() => void save()}>Save</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ─── /wallet — balance + full history (opened from the top-bar chip) ─── */

const TXN_LABEL: Record<string, string> = {
  TOPUP: "Money added",
  REFERRAL_REWARD: "Referral reward",
  REDEMPTION: "Used for subscription",
  REVERSAL: "Reward reversed",
  EXPIRY: "Credit expired",
  ADMIN_CREDIT: "Added by SafeRent",
  ADMIN_DEBIT: "Deducted by SafeRent",
};

export function WalletPage() {
  const wallet = useQuery(() => request<{ wallet: WalletSummary; redeemablePlans: Array<{ id: string; name: string; priceMonthly: string; features: string | null }> }>("/wallet"), []);
  const [page, setPage] = useState(1);
  const txns = useQuery(() => request<Paged<WalletTxn>>("/wallet/transactions", { query: { page } }), [page]);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const w = wallet.data?.wallet;
  return (
    <>
      <PageHeader title="My wallet" description="SafeRent promotional balance and every transaction." actions={<Link to="/referrals" className="text-sm font-semibold text-brand-dark">Refer & earn →</Link>} />
      {msg && <Alert kind={msg.kind} className="mb-4">{msg.text}</Alert>}
      {wallet.error && <Alert kind="error">{wallet.error}</Alert>}
      {w && (
        <section className="card mb-6 grid gap-4 p-5 sm:grid-cols-[14rem_1fr]">
          <div>
            <p className="text-sm text-muted">Available balance</p>
            <p className="text-4xl font-bold">{formatMoney(w.balance)}</p>
            <p className="mt-1 text-xs text-muted">Added money {formatMoney(w.cashBalance ?? 0)} · Promotional {formatMoney(w.promoBalance ?? w.balance)}</p>
            <p className="text-xs text-muted">Rewards earned so far {formatMoney(w.lifetimeEarned)}</p>
            {w.nextExpiry && <p className="mt-1 text-xs text-warning">{formatMoney(w.nextExpiry.amount)} expires on {formatDate(w.nextExpiry.on)}</p>}
          </div>
          <div>
            <ul className="list-disc space-y-1 pl-4 text-sm text-muted">{w.rules.map((r) => <li key={r}>{r}</li>)}</ul>
            {wallet.data && wallet.data.redeemablePlans.length > 0 && (
              <RedeemBox plans={wallet.data.redeemablePlans} balance={Number(w.balance)} onDone={async (t) => { setMsg({ kind: "success", text: t }); await Promise.all([wallet.reload(), txns.reload()]); }} onError={(t) => setMsg({ kind: "error", text: t })} />
            )}
          </div>
        </section>
      )}
      <AddMoney onDone={async (t, kind) => { setMsg({ kind, text: t }); await Promise.all([wallet.reload(), txns.reload()]); }} />
      <section className="card p-5">
        <h2 className="mb-3 font-semibold">Transaction history</h2>
        {txns.loading && !txns.data && <Spinner className="size-6 text-brand" />}
        {txns.data && txns.data.items.length === 0 && <p className="text-sm text-muted">No transactions yet.</p>}
        <ul className="divide-y divide-line text-sm">
          {txns.data?.items.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="font-medium">{TXN_LABEL[t.type] ?? labelize(t.type)}</p>
                <p className="text-xs text-muted">{formatTimestamp(t.createdAt)}{t.note ? ` · ${t.note}` : ""}{t.expiresAt ? ` · expires ${formatDate(t.expiresAt)}` : ""}</p>
              </div>
              <div className="text-right">
                <p className={cn("font-semibold", Number(t.amount) >= 0 ? "text-success" : "text-danger")}>{Number(t.amount) >= 0 ? "+" : ""}{formatMoney(t.amount)}</p>
                <p className="text-xs text-muted">Balance {formatMoney(t.balanceAfter)}</p>
              </div>
            </li>
          ))}
        </ul>
        {txns.data && txns.data.totalPages > 1 && <Pagination page={txns.data.page} totalPages={txns.data.totalPages} total={txns.data.total} onPage={setPage} />}
      </section>
    </>
  );
}


/* ─── Add money (payment gateways switched ON by the admin) ─── */

interface Gateway {
  provider: "RAZORPAY" | "PAYTM" | "INSTAMOJO";
  label: string;
  minAmount: number;
  maxAmount: number;
  testMode: boolean;
}

interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (event: string, cb: (r: { error?: { description?: string } }) => void) => void };
  }
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Couldn't load Razorpay. Check your connection."));
    document.body.appendChild(script);
  });
}

function AddMoney({ onDone }: { onDone: (text: string, kind: "success" | "error") => void | Promise<void> }) {
  const { data } = useQuery(() => request<{ items: Gateway[] }>("/wallet/gateways"), []);
  const [amount, setAmount] = useState("500");
  const [busy, setBusy] = useState<string | null>(null);
  const gateways = data?.items ?? [];
  if (!gateways.length) return null; // no gateway switched ON → no "Add money" at all
  const value = Number(amount);
  const min = Math.min(...gateways.map((g) => g.minAmount));
  const max = Math.max(...gateways.map((g) => g.maxAmount));

  const pay = async (g: Gateway) => {
    if (!(value >= g.minAmount && value <= g.maxAmount)) {
      await onDone(`Add between ${formatMoney(g.minAmount)} and ${formatMoney(g.maxAmount)} with ${g.label}.`, "error");
      return;
    }
    setBusy(g.provider);
    try {
      const start = await request<{ topupId: string; checkout: { key: string; orderId: string; amount: number; currency: string; name: string; description: string; prefill: Record<string, string | undefined> } }>("/wallet/topups", { method: "POST", body: { provider: g.provider, amount: value } });
      await loadRazorpay();
      const finish = async (path: string, body: unknown) => request<{ status: string; failureReason?: string | null }>(`/wallet/topups/${start.topupId}/${path}`, { method: "POST", body });
      const rz = new window.Razorpay!({
        key: start.checkout.key,
        order_id: start.checkout.orderId,
        amount: start.checkout.amount,
        currency: start.checkout.currency,
        name: start.checkout.name,
        description: start.checkout.description,
        prefill: start.checkout.prefill,
        theme: { color: "#F97316" },
        // The server verifies the signature and asks Razorpay before crediting.
        handler: async (r: RazorpayResponse) => {
          try {
            const v = await finish("verify", r);
            await onDone(v.status === "PAID" ? `${formatMoney(value)} added to your wallet.` : v.status === "PENDING" ? "Payment received — your wallet updates as soon as Razorpay confirms it." : `Payment failed${v.failureReason ? `: ${v.failureReason}` : "."}`, v.status === "FAILED" ? "error" : "success");
          } catch (err) {
            await onDone(errorMessage(err), "error");
          } finally {
            setBusy(null);
          }
        },
        modal: { ondismiss: () => { void finish("cancel", {}).catch(() => undefined); setBusy(null); } },
      });
      rz.on("payment.failed", (r) => void onDone(`Payment failed: ${r.error?.description ?? "please try again"}`, "error"));
      rz.open();
    } catch (err) {
      setBusy(null);
      await onDone(errorMessage(err), "error");
    }
  };

  return (
    <section className="card mb-6 space-y-3 p-5">
      <h2 className="font-semibold">Add money</h2>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40"><Input label="Amount (₹)" type="number" min={min} max={max} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        {[100, 500, 1000, 2000].filter((n) => n >= min && n <= max).map((n) => (
          <button key={n} type="button" onClick={() => setAmount(String(n))} className={cn("min-h-10 rounded-full border px-3 text-sm", value === n ? "border-brand bg-brand-bg font-semibold text-brand-dark" : "border-line")}>₹{n}</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {gateways.map((g) => (
          <Button key={g.provider} loading={busy === g.provider} disabled={!!busy || !(value > 0)} leftIcon={<Wallet className="size-4" />} onClick={() => void pay(g)}>
            Pay with {g.label}{g.testMode ? " (test)" : ""}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted">Added money can be used for SafeRent services. It can't be withdrawn, sent to others or used to pay rent. Limits: {formatMoney(min)} – {formatMoney(max)}.</p>
    </section>
  );
}

/* ─── Admin: /admin/wallets — add or deduct balance for selected users (wallet.adjust) ─── */

interface WalletUser {
  id: string;
  fullName: string;
  phoneNumber: string | null;
  email: string | null;
  roles: string[];
  accountStatus: string;
  balance: string;
  cashBalance?: string;
}

export function AdminWalletsPage() {
  const { profile } = useAuth();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Map<string, WalletUser>>(new Map());
  const [form, setForm] = useState({ direction: "CREDIT", bucket: "PROMO", amount: "", reason: "", expiresInDays: "" });
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [results, setResults] = useState<Array<{ userId: string; ok: boolean; balance?: string; message?: string }> | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [logPage, setLogPage] = useState(1);
  const { confirm, dialog } = useConfirm();
  const users = useQuery(() => request<Paged<WalletUser>>("/admin/wallets", { query: { q: q || undefined, role: role || undefined, page } }), [q, role, page]);
  const log = useQuery(() => request<Paged<{ id: string; type: string; amount: string; balanceAfter: string; note: string | null; createdAt: string; user: string | null; userId: string; by: string | null }>>("/admin/wallets/adjustments", { query: { page: logPage } }), [logPage]);

  const toggle = (u: WalletUser) => {
    const next = new Map(selected);
    if (next.has(u.id)) next.delete(u.id);
    else next.set(u.id, u);
    setSelected(next);
  };
  const amount = Number(form.amount);
  const ready = selected.size > 0 && amount > 0 && form.reason.trim().length >= 5;
  const submit = () =>
    confirm({
      title: form.direction === "CREDIT" ? "Add to wallets" : "Deduct from wallets",
      message: `${form.direction === "CREDIT" ? "Add" : "Deduct"} ${formatMoney(amount)} ${form.direction === "CREDIT" ? "to" : "from"} ${selected.size} user${selected.size > 1 ? "s" : ""}. Each user is notified and this is recorded with your name and reason. It can't be edited later — correct it with an opposite adjustment.`,
      tone: form.direction === "DEBIT" ? "danger" : undefined,
      confirmLabel: form.direction === "CREDIT" ? "Add" : "Deduct",
      onConfirm: async () => {
        setBusy(true);
        setMsg(null);
        try {
          const res = await request<{ results: Array<{ userId: string; ok: boolean; balance?: string; message?: string }> }>("/admin/wallets/adjust", {
            method: "POST",
            body: { userIds: [...selected.keys()], direction: form.direction, bucket: form.bucket, amount, reason: form.reason.trim(), expiresInDays: form.direction === "CREDIT" && form.bucket === "PROMO" && form.expiresInDays ? Number(form.expiresInDays) : null, requestId },
          });
          setResults(res.results);
          const ok = res.results.filter((r) => r.ok).length;
          setMsg({ kind: ok === res.results.length ? "success" : "error", text: `Done for ${ok} of ${res.results.length} user(s).` });
          setRequestId(crypto.randomUUID());
          setForm({ ...form, amount: "", reason: "" });
          setSelected(new Map());
          await Promise.all([users.reload(), log.reload()]);
        } catch (err) {
          const issues = err instanceof AppError ? (err.details?.issues as Array<{ message: string }> | undefined) : undefined;
          setMsg({ kind: "error", text: issues?.length ? issues.map((i) => i.message).join(" · ") : errorMessage(err) });
        } finally {
          setBusy(false);
        }
      },
    });

  return (
    <>
      <PageHeader title="Wallet adjustments" description="Add or deduct promotional balance for landlords and tenants. Balance is SafeRent credit — users can't withdraw it as cash." />
      {msg && <Alert kind={msg.kind} className="mb-4">{msg.text}</Alert>}
      {results && results.some((r) => !r.ok) && (
        <Alert kind="warning" className="mb-4">
          {results.filter((r) => !r.ok).map((r) => <span key={r.userId} className="block">{users.data?.items.find((u) => u.id === r.userId)?.fullName ?? r.userId}: {r.message}</span>)}
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section className="card p-5">
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <Input label="Search" placeholder="Name, phone or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            <Select label="Role" options={[{ value: "", label: "Landlords and tenants" }, { value: "LANDLORD", label: "Landlords" }, { value: "TENANT", label: "Tenants" }]} value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} />
          </div>
          {users.error && <Alert kind="error">{users.error}</Alert>}
          <ul className="divide-y divide-line">
            {users.data?.items.map((u) => (
              <li key={u.id} className="flex items-center gap-3 py-2.5">
                <input type="checkbox" aria-label={`Select ${u.fullName}`} className="size-5" disabled={u.id === profile?.id} checked={selected.has(u.id)} onChange={() => toggle(u)} />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setViewing(u.id)}>
                  <p className="truncate font-medium">{u.fullName} <span className="text-xs font-normal text-muted">{u.roles.filter((r) => r === "LANDLORD" || r === "TENANT").map((r) => labelize(r)).join(" + ")}{u.accountStatus !== "ACTIVE" ? ` · ${labelize(u.accountStatus)}` : ""}</span></p>
                  <p className="truncate text-xs text-muted">{u.phoneNumber ?? u.email ?? "—"}</p>
                </button>
                <span className="text-right"><span className="block font-semibold">{formatMoney(Number(u.balance) + Number(u.cashBalance ?? 0))}</span><span className="text-xs text-muted">promo {formatMoney(u.balance)} · added {formatMoney(u.cashBalance ?? 0)}</span></span>
              </li>
            ))}
          </ul>
          {users.data && users.data.totalPages > 1 && <Pagination page={users.data.page} totalPages={users.data.totalPages} total={users.data.total} onPage={setPage} />}
        </section>
        <section className="card h-max space-y-3 p-5">
          <h2 className="font-semibold">Adjust {selected.size ? `${selected.size} selected` : "selected users"}</h2>
          {selected.size > 0 && (
            <div className="flex flex-wrap gap-1.5">{[...selected.values()].map((u) => <Badge key={u.id}>{u.fullName} <button type="button" aria-label={`Remove ${u.fullName}`} onClick={() => toggle(u)}>×</button></Badge>)}</div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {(["CREDIT", "DEBIT"] as const).map((d) => (
              <button key={d} type="button" aria-pressed={form.direction === d} onClick={() => setForm({ ...form, direction: d })} className={cn("min-h-10 rounded-control border text-sm font-semibold", form.direction === d ? (d === "CREDIT" ? "border-success bg-success/10 text-success" : "border-danger bg-danger/10 text-danger") : "border-line")}>
                {d === "CREDIT" ? "Add" : "Deduct"}
              </button>
            ))}
          </div>
          <Select label="Balance" options={[{ value: "PROMO", label: "Promotional credit" }, { value: "CASH", label: "Added money (cash)" }]} value={form.bucket} onChange={(e) => setForm({ ...form, bucket: e.target.value })} />
          <Input label="Amount (₹) *" type="number" min={1} max={100000} step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <Textarea label="Reason *" hint="Shown to the user and kept in the audit log." rows={2} maxLength={255} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          {form.direction === "CREDIT" && form.bucket === "PROMO" && <Input label="Expires after (days)" type="number" min={1} hint="Empty = never expires" value={form.expiresInDays} onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })} />}
          <Button className="w-full" loading={busy} disabled={!ready} variant={form.direction === "DEBIT" ? "danger" : "primary"} onClick={submit}>
            {form.direction === "CREDIT" ? "Add" : "Deduct"} {amount > 0 ? formatMoney(amount) : ""}
          </Button>
        </section>
      </div>
      <section className="card mt-6 p-5">
        <h2 className="mb-3 font-semibold">Recent adjustments</h2>
        {log.data && log.data.items.length === 0 && <p className="text-sm text-muted">None yet.</p>}
        <ul className="divide-y divide-line text-sm">
          {log.data?.items.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><button type="button" className="font-medium text-brand-dark" onClick={() => setViewing(t.userId)}>{t.user}</button> · {t.note}</span>
              <span className="text-muted">by {t.by} · {formatTimestamp(t.createdAt)}</span>
              <span className={cn("font-semibold", Number(t.amount) >= 0 ? "text-success" : "text-danger")}>{Number(t.amount) >= 0 ? "+" : ""}{formatMoney(t.amount)}</span>
            </li>
          ))}
        </ul>
        {log.data && log.data.totalPages > 1 && <Pagination page={log.data.page} totalPages={log.data.totalPages} total={log.data.total} onPage={setLogPage} />}
      </section>
      {viewing && <UserWalletModal userId={viewing} onClose={() => setViewing(null)} />}
      {dialog}
    </>
  );
}

function UserWalletModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const { data, error } = useQuery(() => request<Paged<WalletTxn & { by: string | null }> & { user: { fullName: string; phoneNumber: string | null }; wallet: WalletSummary }>(`/admin/wallets/${userId}`, { query: { page } }), [userId, page]);
  return (
    <Modal open onClose={onClose} title={data ? `${data.user.fullName} · wallet` : "Wallet"} description={data ? `Balance ${formatMoney(data.wallet.balance)} · earned ${formatMoney(data.wallet.lifetimeEarned)}` : undefined}>
      <div className="max-h-[70vh] overflow-y-auto pr-1">
        {error && <Alert kind="error">{error}</Alert>}
        {data && data.items.length === 0 && <p className="text-sm text-muted">No transactions.</p>}
        <ul className="divide-y divide-line text-sm">
          {data?.items.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="font-medium">{TXN_LABEL[t.type] ?? labelize(t.type)}</p>
                <p className="text-xs text-muted">{formatTimestamp(t.createdAt)}{t.by ? ` · by ${t.by}` : ""}{t.note ? ` · ${t.note}` : ""}</p>
              </div>
              <div className="text-right">
                <p className={cn("font-semibold", Number(t.amount) >= 0 ? "text-success" : "text-danger")}>{Number(t.amount) >= 0 ? "+" : ""}{formatMoney(t.amount)}</p>
                <p className="text-xs text-muted">{formatMoney(t.balanceAfter)}</p>
              </div>
            </li>
          ))}
        </ul>
        {data && data.totalPages > 1 && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />}
      </div>
    </Modal>
  );
}

/* ─── Admin: /admin/payment-gateways (Super Admin) ─── */

interface GatewayRow {
  provider: string;
  label: string;
  enabled: boolean;
  implemented: boolean;
  configured: boolean;
  mode: "TEST" | "LIVE" | null;
  webhookConfigured: boolean;
  minAmount: number;
  maxAmount: number;
  available: boolean;
}

interface TopupRow {
  id: string;
  code: string;
  provider: string;
  amount: string;
  status: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  method: string | null;
  failureReason: string | null;
  testMode: boolean;
  createdAt: string;
  paidAt: string | null;
  user: { fullName: string; phoneNumber: string | null } | null;
}

type GatewayTab = "gateways" | "topups";

export function PaymentGatewaysPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<GatewayTab>(can("settings.manage") ? "gateways" : "topups");
  return (
    <>
      <PageHeader title="Payment gateways" description="Switch on the gateways users can add wallet money with. Keys stay in server/.env — never in the browser." />
      <div className="mb-4">
        <Tabs<GatewayTab> idPrefix="pg" value={tab} onChange={setTab} items={[...(can("settings.manage") ? [{ value: "gateways" as GatewayTab, label: "Gateways" }] : []), { value: "topups", label: "Add-money payments" }]} />
      </div>
      {tab === "gateways" ? <GatewaysTab /> : <TopupsTab />}
    </>
  );
}

function GatewaysTab() {
  const { data, error, reload } = useQuery(() => request<{ items: GatewayRow[]; webhookUrl: string }>("/admin/payment-gateways"), []);
  const [edit, setEdit] = useState<Record<string, { min: string; max: string }>>({});
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const save = async (g: GatewayRow, enabled: boolean) => {
    setMsg(null);
    const e = edit[g.provider];
    try {
      await request(`/admin/payment-gateways/${g.provider}`, { method: "PUT", body: { enabled, minAmount: Number(e?.min ?? g.minAmount), maxAmount: Number(e?.max ?? g.maxAmount) } });
      setMsg({ kind: "success", text: `${g.label} ${enabled ? "is ON — users now see the button." : "is OFF."}` });
      await reload();
    } catch (err) {
      setMsg({ kind: "error", text: errorMessage(err) });
    }
  };
  return (
    <div className="space-y-3">
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {data?.items.map((g) => (
        <section key={g.provider} className="card space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{g.label}</h2>
              {g.available ? <Badge tone="success">ON — visible to users</Badge> : <Badge>OFF</Badge>}
              {g.mode && <Badge tone={g.mode === "LIVE" ? "brand" : "warning"}>{g.mode === "LIVE" ? "Live keys" : "Test keys"}</Badge>}
              {!g.implemented && <Badge tone="warning">Integration coming soon</Badge>}
              {g.implemented && !g.configured && <Badge tone="danger">Keys missing in server/.env</Badge>}
              {g.provider === "RAZORPAY" && g.configured && !g.webhookConfigured && <Badge tone="warning">Webhook secret missing</Badge>}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={g.enabled}
              aria-label={`${g.enabled ? "Turn off" : "Turn on"} ${g.label}`}
              disabled={!g.implemented || (!g.enabled && !g.configured)}
              onClick={() => void save(g, !g.enabled)}
              className={cn("relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-40", g.enabled ? "bg-brand" : "bg-line")}
            >
              <span className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform", g.enabled ? "translate-x-6" : "translate-x-1")} />
            </button>
          </div>
          {g.implemented && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-36"><Input label="Min per top-up (₹)" type="number" min={1} value={edit[g.provider]?.min ?? String(g.minAmount)} onChange={(e) => setEdit({ ...edit, [g.provider]: { min: e.target.value, max: edit[g.provider]?.max ?? String(g.maxAmount) } })} /></div>
              <div className="w-36"><Input label="Max per top-up (₹)" type="number" min={1} value={edit[g.provider]?.max ?? String(g.maxAmount)} onChange={(e) => setEdit({ ...edit, [g.provider]: { max: e.target.value, min: edit[g.provider]?.min ?? String(g.minAmount) } })} /></div>
              <Button variant="secondary" onClick={() => void save(g, g.enabled)}>Save limits</Button>
            </div>
          )}
          {g.provider === "RAZORPAY" && (
            <details className="text-sm text-muted">
              <summary className="cursor-pointer font-medium text-ink">How to set up Razorpay</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Razorpay Dashboard → Settings → API Keys: copy the Key ID and Key Secret (use test keys first).</li>
                <li>Put them in <code>server/.env</code> as <code>RAZORPAY_KEY_ID</code> and <code>RAZORPAY_KEY_SECRET</code>, then restart the server.</li>
                <li>Dashboard → Webhooks → Add: URL <code>{data.webhookUrl}</code>, events <code>payment.captured</code>, <code>payment.failed</code>, <code>order.paid</code>, and a secret → put it in <code>RAZORPAY_WEBHOOK_SECRET</code>.</li>
                <li>Switch Razorpay ON here. Users see "Pay with Razorpay" in My wallet.</li>
              </ol>
            </details>
          )}
        </section>
      ))}
    </div>
  );
}

function TopupsTab() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const { data, error } = useQuery(() => request<Paged<TopupRow> & { livePaidTotal: string }>("/admin/wallet-topups", { query: { status: status || undefined, q: q || undefined, page } }), [status, q, page]);
  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input label="Search" placeholder="Name, phone, SR-TOP code, order or payment id" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <Select label="Status" options={[{ value: "", label: "All" }, ...["PAID", "PENDING", "CREATED", "FAILED"].map((s) => ({ value: s, label: labelize(s) }))]} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} />
        {data && <Stat label="Live money added (paid)" value={formatMoney(data.livePaidTotal)} />}
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {data && data.items.length === 0 && <p className="card p-5 text-sm text-muted">No payments yet.</p>}
      <ul className="space-y-2">
        {data?.items.map((t) => (
          <li key={t.id} className="card flex flex-col gap-1 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-semibold">{t.user?.fullName ?? "—"} <span className="text-xs font-normal text-muted">{t.user?.phoneNumber} · {t.code}</span></p>
              <p className="truncate text-xs text-muted">{t.provider} · {t.providerOrderId ?? "—"} · {t.providerPaymentId ?? "no payment yet"}{t.method ? ` · ${t.method}` : ""} · {formatTimestamp(t.createdAt)}{t.failureReason ? ` · ${t.failureReason}` : ""}</p>
            </div>
            <div className="flex items-center gap-2">
              {t.testMode && <Badge tone="warning">Test</Badge>}
              <Badge tone={t.status === "PAID" ? "success" : t.status === "FAILED" ? "danger" : "brand"}>{labelize(t.status)}</Badge>
              <span className="font-semibold">{formatMoney(t.amount)}</span>
            </div>
          </li>
        ))}
      </ul>
      {data && data.totalPages > 1 && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />}
    </>
  );
}
