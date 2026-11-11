import type { ReactNode } from "react";
import { Link } from "react-router";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import { cn } from "@/utils/cn";
import { formatDate, formatMoney, formatTimestamp, labelize } from "@/utils/format";

/* Shape of GET /users/:id/overview — every section is optional (present only if the viewer may see it). */
type Money = string | null;
interface Overview {
  sections: string[];
  properties?: { total: number; byStatus: Record<string, number>; items: Array<{ id: string; code: string; title: string | null; city: string | null; publicationStatus: string; activeStatus: string; availableCount: number; occupiedCount: number }> };
  leases?: { total: number; active: number; items: Array<{ id: string; code: string | null; status: string; startDate: string; endDate: string; endedAt: string | null; monthlyRent: Money; as: string; otherParty: string | null; place: string | null; property: { id: string; title: string | null; code: string } }> };
  applications?: { total: number; items: Array<{ id: string; status: string; createdAt: string; property: { id: string; title: string | null; code: string } }> };
  rent?: { asTenant: Record<string, { count: number; amount: Money }>; asLandlord: Record<string, { count: number; amount: Money }>; items: Array<{ id: string; period: string; amount: Money; dueDate: string; status: string; paidAt: string | null; method: string | null; receiptNumber: string | null; as: string; place: string | null; property: { title: string | null; code: string } }> };
  transactions?: { total: number; items: Array<{ id: string; type: string; status: string; amount: Money; method: string; reference: string; isTest: boolean; direction: "IN" | "OUT"; createdAt: string }>; invoices: Array<{ id: string; number: string; description: string; total: Money; status: string; createdAt: string }>; refunds: Array<{ id: string; amount: Money; reason: string; status: string; createdAt: string }> };
  wallet?: {
    summary: { balance: string; promoBalance?: string; cashBalance?: string; lifetimeEarned: string };
    ledger: Array<{ id: string; type: string; bucket: string; amount: Money; balanceAfter: Money; note: string | null; createdAt: string }>;
    topups: Array<{ id: string; code: string; provider: string; amount: Money; status: string; providerPaymentId: string | null; testMode: boolean; createdAt: string; failureReason: string | null }>;
    subscriptions: Array<{ id: string; status: string; startsAt: string; endsAt: string | null; source: string; plan: { name: string; priceMonthly: Money } }>;
  };
  referrals?: { byStatus: Record<string, number>; asReferrer: Array<{ id: string; code: string; type: string; status: string; rewardStatus: string; onHold: boolean; createdAt: string }>; asReferred: Array<{ id: string; code: string; type: string; status: string; createdAt: string }>; codes: Array<{ code: string; kind: string; status: string; opens: number }> };
  reviews?: { asLandlord: { average: number | null; count: number }; asTenant: { average: number | null; count: number }; written: Array<{ id: string; code: string; status: string; overallRating: number; reviewerRole: string; submittedAt: string; property: { title: string | null; code: string } }> };
  maintenance?: { total: number; items: Array<{ id: string; title: string; category: string; status: string; priority: string; createdAt: string; as: string; property: { title: string | null; code: string } }> };
  support?: { total: number; items: Array<{ id: string; subject: string; category: string; status: string; priority: string; createdAt: string }> };
  activity?: { logins: Array<{ id: string; action: string; outcome: string; reason: string | null; ip: string | null; userAgent: string | null; createdAt: string }>; adminChanges: Array<{ id: string; action: string; actor: string | null; createdAt: string }> };
}

function Card({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Rows({ children, empty }: { children: ReactNode[]; empty: string }) {
  if (!children.length) return <p className="text-sm text-muted">{empty}</p>;
  return <ul className="divide-y divide-line text-sm">{children}</ul>;
}

const Amount = ({ v, sign }: { v: Money; sign?: "+" | "-" | null }) => (
  <span className={cn("font-semibold", sign === "+" ? "text-success" : sign === "-" ? "text-danger" : "")}>{sign === "+" ? "+" : sign === "-" ? "−" : ""}{formatMoney(v?.replace("-", "") ?? 0)}</span>
);

function Tiles({ items }: { items: Array<[string, string | number]> }) {
  return (
    <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-control bg-subtle px-3 py-2">
          <p className="text-xs text-muted">{k}</p>
          <p className="font-bold">{v}</p>
        </div>
      ))}
    </div>
  );
}

/** User page → "All data": properties, leases, rent, transactions, wallet, referrals, reviews, tickets, logins — as permitted. */
export function UserOverviewTab({ userId }: { userId: string }) {
  const { data, loading, error } = useQuery(() => request<Overview>(`/users/${userId}/overview`), [userId]);
  if (loading && !data) return <div className="flex justify-center py-12"><Spinner className="size-7 text-brand" /></div>;
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return null;
  if (!data.sections.length) return <Alert kind="info">Your role doesn't have access to this user's records.</Alert>;
  const d = data;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {d.wallet && (
        <Card title="Wallet" right={<span className="text-lg font-bold">{formatMoney(d.wallet.summary.balance)}</span>}>
          <Tiles items={[["Added money", formatMoney(d.wallet.summary.cashBalance ?? 0)], ["Promotional", formatMoney(d.wallet.summary.promoBalance ?? d.wallet.summary.balance)], ["Rewards earned", formatMoney(d.wallet.summary.lifetimeEarned)], ["Top-ups", d.wallet.topups.filter((t) => t.status === "PAID").length]]} />
          <Rows empty="No wallet transactions.">
            {d.wallet.ledger.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0"><span className="font-medium">{labelize(t.type)}</span> <Badge>{t.bucket === "CASH" ? "Added money" : "Promo"}</Badge><span className="block truncate text-xs text-muted">{formatTimestamp(t.createdAt)}{t.note ? ` · ${t.note}` : ""}</span></span>
                <Amount v={t.amount} sign={Number(t.amount) >= 0 ? "+" : "-"} />
              </li>
            ))}
          </Rows>
          {d.wallet.topups.length > 0 && (
            <>
              <h4 className="mb-1 mt-4 text-sm font-semibold text-muted">Add-money payments</h4>
              <Rows empty="">
                {d.wallet.topups.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="text-xs text-muted">{t.code} · {t.provider} · {t.providerPaymentId ?? "—"} · {formatTimestamp(t.createdAt)}{t.failureReason ? ` · ${t.failureReason}` : ""}</span>
                    <span className="flex items-center gap-2">{t.testMode && <Badge tone="warning">Test</Badge>}<StatusBadge status={t.status} /><Amount v={t.amount} /></span>
                  </li>
                ))}
              </Rows>
            </>
          )}
          {d.wallet.subscriptions.length > 0 && (
            <>
              <h4 className="mb-1 mt-4 text-sm font-semibold text-muted">Subscriptions</h4>
              <Rows empty="">
                {d.wallet.subscriptions.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                    <span>{s.plan.name} <span className="text-xs text-muted">{labelize(s.source)} · {formatDate(s.startsAt)} – {formatDate(s.endsAt)}</span></span>
                    <StatusBadge status={s.status} />
                  </li>
                ))}
              </Rows>
            </>
          )}
        </Card>
      )}

      {d.transactions && (
        <Card title="Transactions" right={<span className="text-sm text-muted">{d.transactions.total} total</span>}>
          <Rows empty="No transactions.">
            {d.transactions.items.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0"><span className="font-medium">{labelize(t.type)}</span> {t.isTest && <Badge tone="warning">Test</Badge>}<span className="block truncate text-xs text-muted">{t.reference} · {t.method} · {formatTimestamp(t.createdAt)}</span></span>
                <span className="flex items-center gap-2"><StatusBadge status={t.status} /><Amount v={t.amount} sign={t.direction === "IN" ? "+" : "-"} /></span>
              </li>
            ))}
          </Rows>
          {d.transactions.invoices.length > 0 && (
            <>
              <h4 className="mb-1 mt-4 text-sm font-semibold text-muted">Invoices</h4>
              <Rows empty="">{d.transactions.invoices.map((i) => <li key={i.id} className="flex justify-between gap-2 py-2"><span>{i.number} <span className="text-xs text-muted">{i.description}</span></span><span className="flex items-center gap-2"><StatusBadge status={i.status} /><Amount v={i.total} /></span></li>)}</Rows>
            </>
          )}
          {d.transactions.refunds.length > 0 && (
            <>
              <h4 className="mb-1 mt-4 text-sm font-semibold text-muted">Refunds</h4>
              <Rows empty="">{d.transactions.refunds.map((r) => <li key={r.id} className="flex justify-between gap-2 py-2"><span className="text-xs text-muted">{r.reason} · {formatDate(r.createdAt)}</span><span className="flex items-center gap-2"><StatusBadge status={r.status} /><Amount v={r.amount} /></span></li>)}</Rows>
            </>
          )}
        </Card>
      )}

      {d.rent && (
        <Card title="Rent">
          <Tiles
            items={[
              ["Paid (as tenant)", formatMoney(d.rent.asTenant.PAID?.amount ?? 0)],
              ["Due / overdue (as tenant)", formatMoney(Number(d.rent.asTenant.DUE?.amount ?? 0) + Number(d.rent.asTenant.OVERDUE?.amount ?? 0))],
              ["Received (as landlord)", formatMoney(d.rent.asLandlord.PAID?.amount ?? 0)],
              ["Pending (as landlord)", formatMoney(Number(d.rent.asLandlord.DUE?.amount ?? 0) + Number(d.rent.asLandlord.OVERDUE?.amount ?? 0))],
            ]}
          />
          <Rows empty="No rent records.">
            {d.rent.items.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0"><span className="font-medium">{r.period}</span> <span className="text-xs text-muted">{r.as === "TENANT" ? "pays" : "receives"} · {r.place ? `${r.place}, ` : ""}{r.property.title ?? r.property.code}{r.receiptNumber ? ` · ${r.receiptNumber}` : ""}</span></span>
                <span className="flex items-center gap-2"><StatusBadge status={r.status} /><Amount v={r.amount} /></span>
              </li>
            ))}
          </Rows>
        </Card>
      )}

      {d.leases && (
        <Card title="Leases" right={<span className="text-sm text-muted">{d.leases.active} active · {d.leases.total} total</span>}>
          <Rows empty="No leases.">
            {d.leases.items.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0"><span className="font-medium">{l.place ? `${l.place} · ` : ""}{l.property.title ?? l.property.code}</span><span className="block text-xs text-muted">{l.code} · as {l.as.toLowerCase()} · with {l.otherParty} · {formatDate(l.startDate)} – {formatDate(l.endedAt ?? l.endDate)} · {formatMoney(l.monthlyRent)}/mo</span></span>
                <StatusBadge status={l.status} />
              </li>
            ))}
          </Rows>
        </Card>
      )}

      {d.properties && (
        <Card title="Properties owned" right={<span className="text-sm text-muted">{d.properties.total} total</span>}>
          <Rows empty="No properties.">
            {d.properties.items.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                <Link to={`/properties/${p.id}`} className="min-w-0 font-medium text-brand-dark hover:text-brand">{p.title ?? p.code} <span className="text-xs font-normal text-muted">{p.code}{p.city ? ` · ${p.city}` : ""} · {p.occupiedCount} occupied / {p.availableCount} free</span></Link>
                <StatusBadge status={p.publicationStatus} />
              </li>
            ))}
          </Rows>
        </Card>
      )}

      {d.applications && (
        <Card title="Rental applications" right={<span className="text-sm text-muted">{d.applications.total} total</span>}>
          <Rows empty="No applications.">{d.applications.items.map((a) => <li key={a.id} className="flex items-center justify-between gap-2 py-2"><span>{a.property.title ?? a.property.code} <span className="text-xs text-muted">{formatDate(a.createdAt)}</span></span><StatusBadge status={a.status} /></li>)}</Rows>
        </Card>
      )}

      {d.referrals && (
        <Card title="Referrals">
          <Tiles items={[["Successful", d.referrals.byStatus.SUCCESSFUL ?? 0], ["In progress", Object.entries(d.referrals.byStatus).filter(([k]) => !["SUCCESSFUL", "REJECTED", "EXPIRED", "REVERSED"].includes(k)).reduce((n, [, v]) => n + v, 0)], ["Rejected / reversed", (d.referrals.byStatus.REJECTED ?? 0) + (d.referrals.byStatus.REVERSED ?? 0)], ["Joined via referral", d.referrals.asReferred.length ? "Yes" : "No"]]} />
          {d.referrals.codes.length > 0 && <p className="mb-2 text-xs text-muted">Codes: {d.referrals.codes.map((c) => `${c.code} (${c.status.toLowerCase()}, ${c.opens} opens)`).join(" · ")}</p>}
          <Rows empty="No referrals made.">{d.referrals.asReferrer.map((r) => <li key={r.id} className="flex items-center justify-between gap-2 py-2"><span>{r.code} <span className="text-xs text-muted">{labelize(r.type)} · {formatDate(r.createdAt)}</span></span><span className="flex gap-1">{r.onHold && <Badge tone="warning">On hold</Badge>}<StatusBadge status={r.status} /></span></li>)}</Rows>
          <Link to="/admin/referrals" className="mt-2 inline-block text-sm font-semibold text-brand-dark">Open referral management →</Link>
        </Card>
      )}

      {d.reviews && (
        <Card title="Reviews">
          <Tiles items={[["As landlord", d.reviews.asLandlord.count ? `${d.reviews.asLandlord.average}★ (${d.reviews.asLandlord.count})` : "—"], ["As tenant", d.reviews.asTenant.count ? `${d.reviews.asTenant.average}★ (${d.reviews.asTenant.count})` : "—"], ["Written", d.reviews.written.length], ["", ""]]} />
          <Rows empty="No reviews written.">{d.reviews.written.map((r) => <li key={r.id} className="flex items-center justify-between gap-2 py-2"><span>{r.property.title ?? r.property.code} <span className="text-xs text-muted">{r.code} · as {r.reviewerRole.toLowerCase()} · {formatDate(r.submittedAt)}</span></span><span className="flex items-center gap-2">{r.overallRating}★ <StatusBadge status={r.status} /></span></li>)}</Rows>
        </Card>
      )}

      {d.maintenance && (
        <Card title="Maintenance" right={<span className="text-sm text-muted">{d.maintenance.total} total</span>}>
          <Rows empty="No maintenance requests.">{d.maintenance.items.map((m) => <li key={m.id} className="flex items-center justify-between gap-2 py-2"><span className="min-w-0">{m.title} <span className="text-xs text-muted">{m.property.title ?? m.property.code} · {labelize(m.category)} · {formatDate(m.createdAt)}</span></span><StatusBadge status={m.status} /></li>)}</Rows>
        </Card>
      )}

      {d.support && (
        <Card title="Support tickets" right={<span className="text-sm text-muted">{d.support.total} total</span>}>
          <Rows empty="No tickets.">{d.support.items.map((t) => <li key={t.id} className="flex items-center justify-between gap-2 py-2"><Link to={`/support/${t.id}`} className="min-w-0 text-brand-dark">{t.subject} <span className="text-xs text-muted">{labelize(t.category)} · {formatDate(t.createdAt)}</span></Link><StatusBadge status={t.status} /></li>)}</Rows>
        </Card>
      )}

      {d.activity && (
        <Card title="Logins & security">
          <Rows empty="No sign-in activity.">
            {d.activity.logins.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0"><span className="font-medium">{labelize(l.action.replace(/\./g, "_"))}</span><span className="block truncate text-xs text-muted">{formatTimestamp(l.createdAt)}{l.ip ? ` · ${l.ip}` : ""}{l.userAgent ? ` · ${l.userAgent}` : ""}{l.reason ? ` · ${l.reason}` : ""}</span></span>
                <Badge tone={l.outcome === "success" ? "success" : "danger"}>{l.outcome}</Badge>
              </li>
            ))}
          </Rows>
          {d.activity.adminChanges.length > 0 && (
            <>
              <h4 className="mb-1 mt-4 text-sm font-semibold text-muted">Changes made by staff</h4>
              <Rows empty="">{d.activity.adminChanges.map((c) => <li key={c.id} className="py-2">{labelize(c.action.replace(/\./g, "_"))} <span className="text-xs text-muted">by {c.actor ?? "—"} · {formatTimestamp(c.createdAt)}</span></li>)}</Rows>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
