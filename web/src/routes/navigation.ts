import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  ClipboardCheck,
  ClipboardList,
  FileSignature,
  FileText,
  Gift,
  Home,
  IndianRupee,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  MessageSquare,
  Search,
  Settings,
  Star,
  ShieldCheck,
  SlidersHorizontal,
  UserCheck,
  UserRound,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Shown when the user has ANY of these permissions. Empty = everyone. */
  anyOf: string[];
  /** Shown only while one of these roles is the active role (e.g. customer-only features). */
  roles?: string[];
  /** Optional label override per role (e.g. "My properties" for landlords). */
  labelFor?: Partial<Record<string, string>>;
}

/** Roles that use maintenance day to day (their own requests / jobs / assigned properties). */
const CUSTOMER_ROLES = ["LANDLORD", "TENANT", "SERVICE_PROVIDER", "PROPERTY_AGENT", "PROPERTY_MANAGER"];
/** Back-office roles: see maintenance only as an oversight list under Operations. */
const STAFF_ROLES = ["SUPER_ADMIN", "ADMIN", "FINANCE_ADMIN", "SUPPORT", "MODERATOR", "VIEWER"];

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Single navigation config. Items appear only if the user's effective permissions allow them,
 * so every role sees just its own menu (the API still enforces every request).
 */
export const NAVIGATION: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, anyOf: ["dashboard.view"] },
      { to: "/notifications", label: "Notifications", icon: Bell, anyOf: ["notifications.view"] },
    ],
  },
  {
    label: "Rentals",
    items: [
      { to: "/browse", label: "Find a home", icon: Search, anyOf: ["applications.create"], roles: ["TENANT"] },
      { to: "/properties", label: "Properties", icon: Building2, anyOf: ["properties.view"], labelFor: { LANDLORD: "My properties", PROPERTY_MANAGER: "Assigned properties", PROPERTY_AGENT: "My listings" } },
      { to: "/applications", label: "Applications", icon: ClipboardList, anyOf: ["applications.view"], labelFor: { TENANT: "My applications" } },
      { to: "/leases", label: "Leases", icon: FileSignature, anyOf: ["leases.view"], labelFor: { TENANT: "My rental" } },
      { to: "/my-documents", label: "Property documents", icon: FileText, anyOf: ["leases.view"], roles: ["TENANT"] },
      { to: "/verify", label: "Owner verification", icon: ShieldCheck, anyOf: [], roles: ["LANDLORD"] },
      { to: "/reviews", label: "Reviews", icon: Star, anyOf: ["leases.view"], roles: ["LANDLORD", "TENANT"] },
      { to: "/referrals", label: "Refer & earn", icon: Gift, anyOf: ["leases.view"], roles: ["LANDLORD", "TENANT"] },
      { to: "/enquiries", label: "Enquiries & visits", icon: MessageSquare, anyOf: ["enquiries.manage", "visits.manage"] },
      { to: "/maintenance", label: "Maintenance", icon: Wrench, anyOf: ["maintenance.view"], roles: CUSTOMER_ROLES, labelFor: { SERVICE_PROVIDER: "My jobs" } },
    ],
  },
  {
    label: "Money",
    items: [
      { to: "/rent", label: "Rent", icon: Wallet, anyOf: ["rent.view"], labelFor: { TENANT: "Rent & payments", LANDLORD: "Rent income" } },
      { to: "/finance", label: "Finance", icon: IndianRupee, anyOf: ["payments.view", "invoices.manage", "refunds.manage", "commissions.manage", "finance.reports"] },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/maintenance", label: "Maintenance (all)", icon: Wrench, anyOf: ["maintenance.view"], roles: STAFF_ROLES },
      { to: "/moderation", label: "Moderation", icon: ClipboardCheck, anyOf: ["listings.approve", "documents.verify", "fraud.manage"] },
      { to: "/support", label: "Support", icon: LifeBuoy, anyOf: ["support.manage", "support.create"], labelFor: { TENANT: "Help & complaints", LANDLORD: "Help & complaints" } },
      { to: "/review-moderation", label: "Review moderation", icon: Star, anyOf: ["reviews.moderate"] },
      { to: "/reports", label: "Reports", icon: BarChart3, anyOf: ["reports.view"] },
    ],
  },
  {
    label: "Administration",
    items: [
      { to: "/users", label: "Users", icon: Users, anyOf: ["users.view", "payments.view", "rent.view", "wallet.adjust", "support.manage"], labelFor: { FINANCE_ADMIN: "Customers", SUPPORT: "Customers" } },
      { to: "/admin/kyc", label: "Owner verification", icon: UserCheck, anyOf: ["users.manage"] },
      { to: "/roles", label: "Roles & permissions", icon: KeyRound, anyOf: ["roles.manage"] },
      { to: "/admin/referrals", label: "Referrals", icon: Gift, anyOf: ["referrals.manage"] },
      { to: "/admin/wallets", label: "Wallet adjustments", icon: Wallet, anyOf: ["wallet.adjust"] },
      { to: "/admin/payment-gateways", label: "Payment gateways", icon: IndianRupee, anyOf: ["settings.manage", "wallet.adjust"] },
      { to: "/property-types", label: "Property types", icon: Building2, anyOf: ["property_types.manage"] },
      { to: "/audit", label: "Audit logs", icon: Activity, anyOf: ["audit_logs.view"] },
      { to: "/platform", label: "Platform settings", icon: SlidersHorizontal, anyOf: ["settings.manage", "subscriptions.manage"] },
    ],
  },
  {
    label: "Account",
    items: [
      { to: "/profile", label: "Profile", icon: UserRound, anyOf: [] },
      { to: "/settings", label: "Security", icon: Settings, anyOf: [] },
    ],
  },
];

export const ROLE_ICON: Record<string, LucideIcon> = {
  SUPER_ADMIN: ShieldCheck,
  LANDLORD: Home,
  TENANT: KeyRound,
};

export function visibleNavigation(can: (p: string) => boolean, role: string | undefined): NavGroup[] {
  return NAVIGATION.map((g) => ({
    ...g,
    items: g.items
      .filter((i) => i.anyOf.length === 0 || i.anyOf.some((p) => can(p)))
      .filter((i) => !i.roles || (!!role && i.roles.includes(role)))
      .map((i) => ({ ...i, label: (role && i.labelFor?.[role]) || i.label })),
  })).filter((g) => g.items.length > 0);
}
