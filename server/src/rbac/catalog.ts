/**
 * SafeRent RBAC catalog — the single source of truth for roles, permissions and the default
 * role → permission matrix. Synced into MySQL (roles, permissions, role_permissions) at startup.
 *
 * Scopes:
 *   ALL      — every record of that type
 *   ASSIGNED — records the user is assigned to (property_assignments, assigned maintenance jobs, tickets)
 *   OWN      — records the user owns or is a party to (their properties, their leases, their payments)
 */

export const ROLES = [
  "SUPER_ADMIN",
  "ADMIN",
  "FINANCE_ADMIN",
  "PROPERTY_MANAGER",
  "SUPPORT",
  "MODERATOR",
  "VIEWER",
  "LANDLORD",
  "TENANT",
  "PROPERTY_AGENT",
  "SERVICE_PROVIDER",
] as const;
export type RoleKey = (typeof ROLES)[number];

export type Scope = "OWN" | "ASSIGNED" | "ALL";

export interface RoleInfo {
  name: string;
  description: string;
  /** Higher rank can manage lower rank. Equal rank cannot manage each other (except the founder). */
  rank: number;
  /** Staff sign in with a company email + email OTP. Others sign in with phone OTP. */
  isStaff: boolean;
  /** Can register themselves with phone OTP. */
  selfSignup: boolean;
}

export const ROLE_INFO: Record<RoleKey, RoleInfo> = {
  SUPER_ADMIN: { name: "Super Admin", description: "Complete platform access, ownership and security.", rank: 100, isStaff: true, selfSignup: false },
  ADMIN: { name: "Admin", description: "Platform operations, users, properties and support.", rank: 80, isStaff: true, selfSignup: false },
  FINANCE_ADMIN: { name: "Finance Admin", description: "Payments, rent collection, invoices, refunds and financial reports.", rank: 60, isStaff: true, selfSignup: false },
  PROPERTY_MANAGER: { name: "Property Manager", description: "Inspections, verification, tenants and leases for assigned properties.", rank: 50, isStaff: true, selfSignup: false },
  SUPPORT: { name: "Support", description: "Customer support tickets and complaints.", rank: 40, isStaff: true, selfSignup: false },
  MODERATOR: { name: "Moderator", description: "Listing, image and document review; fraud reports.", rank: 40, isStaff: true, selfSignup: false },
  VIEWER: { name: "Viewer", description: "Read-only access to permitted reports and records.", rank: 20, isStaff: true, selfSignup: false },
  LANDLORD: { name: "Landlord", description: "Property owner: listings, tenants, leases and rent income.", rank: 10, isStaff: false, selfSignup: true },
  TENANT: { name: "Tenant", description: "Renter: browse, apply, pay rent and raise requests.", rank: 10, isStaff: false, selfSignup: true },
  PROPERTY_AGENT: { name: "Property Agent", description: "Assigned listings, enquiries and property visits.", rank: 15, isStaff: false, selfSignup: false },
  SERVICE_PROVIDER: { name: "Service Provider", description: "Assigned maintenance jobs.", rank: 15, isStaff: false, selfSignup: false },
};

export interface PermissionInfo {
  category: string;
  description: string;
  /** Reserved permissions can only ever be held by SUPER_ADMIN (never granted to other roles/users). */
  reserved?: boolean;
}

export const PERMISSIONS = {
  "dashboard.view": { category: "General", description: "View own dashboard" },
  "profile.manage": { category: "General", description: "Manage own profile" },
  "notifications.view": { category: "General", description: "View own notifications" },

  "users.view": { category: "Administration", description: "View user accounts" },
  "users.manage": { category: "Administration", description: "Create, edit, activate and deactivate users (lower roles only)" },
  "roles.manage": { category: "Administration", description: "Assign roles and individual permissions", reserved: true },
  "settings.manage": { category: "Administration", description: "Manage platform configuration", reserved: true },
  "subscriptions.manage": { category: "Administration", description: "Manage subscription plans" },
  "audit_logs.view": { category: "Administration", description: "View security and admin activity logs" },
  "reports.view": { category: "Administration", description: "View reports and analytics" },

  "properties.browse": { category: "Properties", description: "Browse active public listings" },
  "properties.view": { category: "Properties", description: "View property records" },
  "properties.create": { category: "Properties", description: "Add properties" },
  "property_types.manage": { category: "Properties", description: "Turn property types on or off for new listings" },
  "properties.manage": { category: "Properties", description: "Edit properties, images, documents and availability" },
  "assignments.manage": { category: "Properties", description: "Assign managers and agents to properties" },
  "inspections.manage": { category: "Properties", description: "Schedule and record inspections" },
  "listings.approve": { category: "Moderation", description: "Approve or reject listings and images" },
  "documents.verify": { category: "Moderation", description: "Verify ownership documents" },
  "fraud.report": { category: "Moderation", description: "Report suspicious listings" },
  "fraud.manage": { category: "Moderation", description: "Investigate fraud reports" },
  "reviews.moderate": { category: "Moderation", description: "Moderate rental reviews and review reports" },
  "wallet.adjust": { category: "Finance", description: "Add or deduct promotional wallet balance for landlords and tenants (logged, with reason)" },
  "referrals.manage": { category: "Administration", description: "Review referrals, hold or reject suspicious ones and view reward reports" },

  "applications.create": { category: "Rentals", description: "Apply for rental properties" },
  "applications.view": { category: "Rentals", description: "View rental applications" },
  "applications.manage": { category: "Rentals", description: "Approve or reject rental applications" },
  "leases.view": { category: "Rentals", description: "View leases" },
  "leases.manage": { category: "Rentals", description: "Manage and terminate leases" },
  "enquiries.create": { category: "Rentals", description: "Send enquiries about listings" },
  "enquiries.manage": { category: "Rentals", description: "Manage enquiries and follow-ups" },
  "visits.manage": { category: "Rentals", description: "Schedule and update property visits" },

  "rent.view": { category: "Finance", description: "View rent dues and payments" },
  "rent.pay": { category: "Finance", description: "Pay own rent" },
  "rent.collect": { category: "Finance", description: "Record rent collections and generate dues" },
  "payments.view": { category: "Finance", description: "View transactions" },
  "payments.manage": { category: "Finance", description: "Manage and reconcile transactions" },
  "invoices.manage": { category: "Finance", description: "Create and issue invoices" },
  "refunds.manage": { category: "Finance", description: "Request, approve and process refunds" },
  "commissions.manage": { category: "Finance", description: "Manage commission rate" },
  "finance.reports": { category: "Finance", description: "View financial reports and revenue analytics" },

  "maintenance.create": { category: "Maintenance", description: "Raise maintenance requests" },
  "maintenance.view": { category: "Maintenance", description: "View maintenance requests" },
  "maintenance.manage": { category: "Maintenance", description: "Assign providers and close requests" },
  "maintenance.work": { category: "Maintenance", description: "Accept jobs, update status, upload photos, submit charges" },

  "support.create": { category: "Support", description: "Raise support tickets / complaints" },
  "support.manage": { category: "Support", description: "Handle, assign and resolve support tickets" },
} as const satisfies Record<string, PermissionInfo>;

export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];
export const RESERVED_PERMISSIONS = PERMISSION_KEYS.filter((k) => (PERMISSIONS[k] as PermissionInfo).reserved);

type Matrix = Partial<Record<PermissionKey, Scope>>;

const BASE: Matrix = {
  "dashboard.view": "OWN",
  "profile.manage": "OWN",
  "notifications.view": "OWN",
  "support.create": "OWN",
  "fraud.report": "OWN",
};

/** Default role → permission matrix (see docs/RBAC.md). Least privilege: nobody gets everything except SUPER_ADMIN. */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, Matrix> = {
  SUPER_ADMIN: Object.fromEntries(PERMISSION_KEYS.map((k) => [k, "ALL"])) as Matrix,

  ADMIN: {
    ...BASE,
    "referrals.manage": "ALL",
    "reviews.moderate": "ALL",
    "property_types.manage": "ALL",
    "users.view": "ALL",
    "users.manage": "ALL",
    "audit_logs.view": "ALL",
    "reports.view": "ALL",
    "properties.browse": "ALL",
    "properties.view": "ALL",
    "properties.create": "ALL",
    "properties.manage": "ALL",
    "assignments.manage": "ALL",
    "inspections.manage": "ALL",
    "listings.approve": "ALL",
    "documents.verify": "ALL",
    "fraud.manage": "ALL",
    "applications.view": "ALL",
    "applications.manage": "ALL",
    "leases.view": "ALL",
    "leases.manage": "ALL",
    "enquiries.manage": "ALL",
    "visits.manage": "ALL",
    "maintenance.view": "ALL",
    "maintenance.manage": "ALL",
    "support.manage": "ALL",
  },

  FINANCE_ADMIN: {
    ...BASE,
    "reports.view": "ALL",
    "properties.view": "ALL",
    "leases.view": "ALL",
    "rent.view": "ALL",
    "rent.collect": "ALL",
    "payments.view": "ALL",
    "payments.manage": "ALL",
    "invoices.manage": "ALL",
    "refunds.manage": "ALL",
    "commissions.manage": "ALL",
    "finance.reports": "ALL",
  },

  PROPERTY_MANAGER: {
    ...BASE,
    "reports.view": "ASSIGNED",
    "properties.view": "ASSIGNED",
    "properties.manage": "ASSIGNED",
    "inspections.manage": "ASSIGNED",
    "documents.verify": "ASSIGNED",
    "applications.view": "ASSIGNED",
    "applications.manage": "ASSIGNED",
    "leases.view": "ASSIGNED",
    "leases.manage": "ASSIGNED",
    "maintenance.view": "ASSIGNED",
    "maintenance.manage": "ASSIGNED",
  },

  SUPPORT: {
    ...BASE,
    "support.manage": "ALL",
    "properties.view": "ALL",
  },

  MODERATOR: {
    ...BASE,
    "reviews.moderate": "ALL",
    "properties.view": "ALL",
    "listings.approve": "ALL",
    "documents.verify": "ALL",
    "fraud.manage": "ALL",
  },

  VIEWER: {
    "dashboard.view": "OWN",
    "profile.manage": "OWN",
    "notifications.view": "OWN",
    "reports.view": "ALL",
    "properties.view": "ALL",
  },

  LANDLORD: {
    ...BASE,
    "properties.browse": "ALL",
    "properties.view": "OWN",
    "properties.create": "OWN",
    "properties.manage": "OWN",
    "applications.view": "OWN",
    "applications.manage": "OWN",
    "leases.view": "OWN",
    "leases.manage": "OWN",
    "enquiries.manage": "OWN",
    "rent.view": "OWN",
    "reports.view": "OWN",
    "maintenance.create": "OWN",
    "maintenance.view": "OWN",
    "maintenance.manage": "OWN",
  },

  TENANT: {
    ...BASE,
    "properties.browse": "ALL",
    "applications.create": "OWN",
    "applications.view": "OWN",
    "leases.view": "OWN",
    "enquiries.create": "OWN",
    "rent.view": "OWN",
    "rent.pay": "OWN",
    "maintenance.create": "OWN",
    "maintenance.view": "OWN",
  },

  PROPERTY_AGENT: {
    ...BASE,
    "properties.browse": "ALL",
    "properties.view": "ASSIGNED",
    "properties.create": "ASSIGNED",
    "properties.manage": "ASSIGNED",
    "enquiries.manage": "ASSIGNED",
    "visits.manage": "ASSIGNED",
  },

  SERVICE_PROVIDER: {
    ...BASE,
    "maintenance.view": "ASSIGNED",
    "maintenance.work": "ASSIGNED",
  },
};

/** Default settings stored in platform_settings. */
export const DEFAULT_SETTINGS: Record<string, string> = {
  commission_percent: "5",
  late_fee_percent: "2",
  support_email: "support@saferenttechnologies.com",
  platform_name: "SafeRent",
  /** Days after a lease ends during which both sides can review (double-blind). */
  review_window_days: "14",
};
