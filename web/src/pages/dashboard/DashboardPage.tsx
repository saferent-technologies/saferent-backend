import type { ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Building2,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  FileSignature,
  IndianRupee,
  LifeBuoy,
  MessageSquare,
  Plus,
  Search,
  ShieldAlert,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { StatCard } from "@/components/ui/StatCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import type { Role } from "@/types/auth";
import { ROLE_LABELS } from "@/utils/constants";
import { formatDate, formatMoney, formatTimestamp, labelize } from "@/utils/format";

interface DashboardData {
  role: Role;
  cards: Array<{ key: string; label: string; value: number | string; tone?: "brand" | "success" | "warning" | "danger" }>;
  lists: Record<string, Array<Record<string, unknown>>>;
  unreadNotifications: number;
}

interface QuickAction {
  to: string;
  label: string;
  icon: LucideIcon;
  permission: string;
}

/** Per-role dashboard identity. Numbers come from GET /api/dashboard (scoped on the server). */
const ROLE_DASHBOARDS: Record<Role, { title: string; subtitle: string; actions: QuickAction[]; moneyCards?: string[] }> = {
  SUPER_ADMIN: {
    title: "Super Admin Dashboard",
    subtitle: "Complete control of the SafeRent platform.",
    moneyCards: ["revenue"],
    actions: [
      { to: "/users", label: "Manage users", icon: Users, permission: "users.manage" },
      { to: "/roles", label: "Roles & permissions", icon: ShieldAlert, permission: "roles.manage" },
      { to: "/finance", label: "Finance", icon: IndianRupee, permission: "payments.view" },
      { to: "/audit", label: "Audit logs", icon: Activity, permission: "audit_logs.view" },
    ],
  },
  ADMIN: {
    title: "Admin Dashboard",
    subtitle: "Platform operations at a glance.",
    actions: [
      { to: "/users", label: "Manage users", icon: Users, permission: "users.manage" },
      { to: "/moderation", label: "Review listings", icon: ClipboardCheck, permission: "listings.approve" },
      { to: "/support", label: "Support tickets", icon: LifeBuoy, permission: "support.manage" },
      { to: "/reports", label: "Reports", icon: BarChart3, permission: "reports.view" },
    ],
  },
  FINANCE_ADMIN: {
    title: "Finance Dashboard",
    subtitle: "Collections, dues, refunds and revenue.",
    moneyCards: ["collected", "due", "overdue", "commission"],
    actions: [
      { to: "/rent", label: "Rent collection", icon: Wallet, permission: "rent.collect" },
      { to: "/finance?tab=transactions", label: "Transactions", icon: IndianRupee, permission: "payments.view" },
      { to: "/finance?tab=refunds", label: "Refunds", icon: ClipboardList, permission: "refunds.manage" },
      { to: "/finance?tab=reports", label: "Revenue reports", icon: BarChart3, permission: "finance.reports" },
    ],
  },
  PROPERTY_MANAGER: {
    title: "Property Manager Dashboard",
    subtitle: "Your assigned properties, inspections and tenants.",
    actions: [
      { to: "/properties", label: "Assigned properties", icon: Building2, permission: "properties.view" },
      { to: "/applications", label: "Applications", icon: ClipboardList, permission: "applications.manage" },
      { to: "/leases", label: "Leases", icon: FileSignature, permission: "leases.view" },
      { to: "/maintenance", label: "Maintenance", icon: Wrench, permission: "maintenance.manage" },
    ],
  },
  SUPPORT: {
    title: "Support Dashboard",
    subtitle: "Tenant and landlord tickets that need you.",
    actions: [
      { to: "/support", label: "All tickets", icon: LifeBuoy, permission: "support.manage" },
      { to: "/support?assigned=me", label: "Assigned to me", icon: ClipboardList, permission: "support.manage" },
    ],
  },
  MODERATOR: {
    title: "Moderation Dashboard",
    subtitle: "Listings, photos and documents waiting for review.",
    actions: [
      { to: "/moderation", label: "Review queue", icon: ClipboardCheck, permission: "listings.approve" },
      { to: "/moderation?tab=fraud", label: "Fraud reports", icon: ShieldAlert, permission: "fraud.manage" },
    ],
  },
  VIEWER: {
    title: "Read-only Dashboard",
    subtitle: "Platform figures you are permitted to view.",
    actions: [
      { to: "/reports", label: "Reports", icon: BarChart3, permission: "reports.view" },
      { to: "/properties", label: "Properties", icon: Building2, permission: "properties.view" },
    ],
  },
  LANDLORD: {
    title: "Landlord Dashboard",
    subtitle: "Your properties, tenants and rent income.",
    moneyCards: ["income", "pendingRent"],
    actions: [
      { to: "/properties/new", label: "Add property", icon: Plus, permission: "properties.create" },
      { to: "/applications", label: "Tenant applications", icon: ClipboardList, permission: "applications.manage" },
      { to: "/rent", label: "Rent income", icon: Wallet, permission: "rent.view" },
      { to: "/maintenance", label: "Maintenance", icon: Wrench, permission: "maintenance.view" },
    ],
  },
  TENANT: {
    title: "Tenant Dashboard",
    subtitle: "Your home, rent and requests in one place.",
    moneyCards: ["rent"],
    actions: [
      { to: "/browse", label: "Find a home", icon: Search, permission: "properties.browse" },
      { to: "/rent", label: "Pay rent", icon: Wallet, permission: "rent.pay" },
      { to: "/maintenance?new=1", label: "Request repair", icon: Wrench, permission: "maintenance.create" },
      { to: "/support?new=1", label: "Raise complaint", icon: LifeBuoy, permission: "support.create" },
    ],
  },
  PROPERTY_AGENT: {
    title: "Agent Dashboard",
    subtitle: "Listings, enquiries and visits assigned to you.",
    actions: [
      { to: "/properties", label: "My listings", icon: Building2, permission: "properties.view" },
      { to: "/properties/new", label: "Add listing", icon: Plus, permission: "properties.create" },
      { to: "/enquiries", label: "Enquiries", icon: MessageSquare, permission: "enquiries.manage" },
      { to: "/enquiries?tab=visits", label: "Visits", icon: CalendarClock, permission: "visits.manage" },
    ],
  },
  SERVICE_PROVIDER: {
    title: "Service Provider Dashboard",
    subtitle: "Maintenance jobs assigned to you.",
    moneyCards: ["earnings"],
    actions: [{ to: "/maintenance", label: "My jobs", icon: Wrench, permission: "maintenance.work" }],
  },
};

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export function DashboardPage() {
  const { profile, can } = useAuth();
  const { data, loading, error } = useQuery(() => request<DashboardData>("/dashboard"), [profile?.role]);
  if (!profile) return null;

  const config = ROLE_DASHBOARDS[profile.role];
  const firstName = profile.fullName.split(" ")[0];
  const actions = config.actions.filter((a) => can(a.permission));

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{config.title}</Badge>
            <span>{config.subtitle}</span>
          </span>
        }
      />

      {error && <Alert kind="error" className="mb-6">{error}</Alert>}
      {loading && !data ? (
        <div className="flex justify-center py-16">
          <Spinner className="size-7 text-brand" />
        </div>
      ) : data ? (
        <div className="space-y-6">
          <section aria-label="Key figures" className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:gap-4 xl:grid-cols-3 2xl:grid-cols-6">
            {data.cards.map((c) => (
              <StatCard key={c.key} label={c.label} value={config.moneyCards?.includes(c.key) ? formatMoney(c.value) : c.value} tone={c.tone ?? "neutral"} />
            ))}
          </section>

          {actions.length > 0 && (
            <section aria-labelledby="actions-heading">
              <h2 id="actions-heading" className="mb-3 text-base font-semibold text-ink">
                Quick actions
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {actions.map(({ to, label, icon: Icon }) => (
                  <Link key={to} to={to} className="card flex min-h-14 items-center gap-3 p-4 text-sm font-semibold text-ink transition-colors hover:border-brand-light hover:bg-brand-bg">
                    <Icon className="size-5 shrink-0 text-brand" />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    <ArrowRight className="size-4 shrink-0 text-muted" />
                  </Link>
                ))}
              </div>
            </section>
          )}

          <RoleLists data={data} />
        </div>
      ) : null}
    </>
  );
}

function Panel({ title, children, link }: { title: string; children: ReactNode; link?: { to: string; label: string } }) {
  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {link && (
          <Link to={link.to} className="text-sm font-semibold text-brand-dark hover:text-brand">
            {link.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ text }: { text: string }) => <p className="text-sm text-muted">{text}</p>;

function RoleLists({ data }: { data: DashboardData }) {
  const l = data.lists;
  const panels: ReactNode[] = [];

  if (l.currentRental) {
    const r = l.currentRental[0] as
      | { leaseId: string; property: { title: string; addressLine: string; city: string }; monthlyRent: string; endDate: string; rentDueDay: number; landlord: { fullName: string; phoneNumber: string | null } }
      | undefined;
    panels.push(
      <Panel key="rental" title="My current rental" link={{ to: "/leases", label: "View lease" }}>
        {r ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Info label="Home" value={`${r.property.title}, ${r.property.city}`} />
            <Info label="Monthly rent" value={`${formatMoney(r.monthlyRent)} · due on day ${r.rentDueDay}`} />
            <Info label="Lease ends" value={formatDate(r.endDate)} />
            <Info label="Landlord" value={`${r.landlord.fullName}${r.landlord.phoneNumber ? ` · ${r.landlord.phoneNumber}` : ""}`} />
          </dl>
        ) : (
          <Empty text="You don't have an active rental yet. Find a home and apply in a few taps." />
        )}
      </Panel>,
    );
  }
  if (l.usersByRole) {
    panels.push(
      <Panel key="roles" title="Users by role" link={{ to: "/users", label: "Manage" }}>
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {(l.usersByRole as Array<{ role: string; count: number }>).map((r) => (
            <li key={r.role} className="flex justify-between rounded-control bg-subtle px-3 py-2">
              <span>{ROLE_LABELS[r.role] ?? r.role}</span>
              <span className="font-semibold">{r.count}</span>
            </li>
          ))}
        </ul>
      </Panel>,
    );
  }
  const simpleList = (key: string, title: string, render: (row: Record<string, unknown>) => ReactNode, link?: { to: string; label: string }, empty = "Nothing to show.") => {
    if (!l[key]) return;
    panels.push(
      <Panel key={key} title={title} link={link}>
        {l[key].length ? <ul className="divide-y divide-line">{l[key].map((row, i) => <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">{render(row)}</li>)}</ul> : <Empty text={empty} />}
      </Panel>,
    );
  };

  simpleList("recentActivity", "Recent admin activity", (r) => (
    <>
      <span className="font-medium">{labelize(String(r.action))}</span>
      <span className="text-xs text-muted">{formatTimestamp(String(r.createdAt))}</span>
    </>
  ), { to: "/audit", label: "All logs" });
  simpleList("recentTransactions", "Recent transactions", (r) => (
    <>
      <span className="flex items-center gap-2">
        <span className="font-medium">{labelize(String(r.type))}</span>
        <StatusBadge status={String(r.status)} />
      </span>
      <span className="font-semibold">{formatMoney(String(r.amount))}</span>
    </>
  ), { to: "/finance?tab=transactions", label: "View all" });
  simpleList("upcomingInspections", "Upcoming inspections", (r) => (
    <>
      <span className="font-medium">{(r.property as { title: string }).title}</span>
      <span className="text-xs text-muted">{formatTimestamp(String(r.scheduledAt))}</span>
    </>
  ), undefined, "No inspections scheduled.");
  simpleList("unassigned", "Unassigned tickets", (r) => (
    <>
      <Link to={`/support/${r.id}`} className="font-medium hover:text-brand">
        {String(r.subject)}
      </Link>
      <StatusBadge status={String(r.priority)} />
    </>
  ), { to: "/support", label: "All tickets" }, "Every ticket has an owner. 🎉");
  simpleList("upcomingVisits", "Upcoming visits", (r) => (
    <>
      <span className="font-medium">{(r.property as { title: string }).title}</span>
      <span className="text-xs text-muted">{formatTimestamp(String(r.scheduledAt))}</span>
    </>
  ), { to: "/enquiries?tab=visits", label: "All visits" }, "No visits scheduled.");
  simpleList("propertiesByStatus", "My properties by status", (r) => (
    <>
      <StatusBadge status={String(r.status)} />
      <span className="font-semibold">{String(r.count)}</span>
    </>
  ), { to: "/properties", label: "Manage" }, "You haven't added a property yet.");

  if (!panels.length) return null;
  return <div className="grid gap-4 lg:grid-cols-2">{panels}</div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}
