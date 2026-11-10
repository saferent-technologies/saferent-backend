/**
 * Display copies of backend limits (functions/src/config/constants.ts is authoritative —
 * the server enforces these; the UI only uses them for hints and timers).
 */
export const APP_NAME = "SafeRent";
export const COMPANY_NAME = "SafeRent Technologies";
export const ALLOWED_EMAIL_DOMAIN = "saferenttechnologies.com";

export const OTP_LENGTH = 6;
export const OTP_RESEND_SECONDS = 60;

/** App routes. */
export const PATHS = {
  login: "/login",
  forgotPassword: "/forgot-password",
  verifyOtp: "/verify-otp",
  authAction: "/auth/action",
  dashboard: "/dashboard",
  settings: "/settings",
  profile: "/profile",
  register: "/register",
} as const;

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  FINANCE_ADMIN: "Finance Admin",
  PROPERTY_MANAGER: "Property Manager",
  SUPPORT: "Support",
  MODERATOR: "Moderator",
  VIEWER: "Viewer",
  LANDLORD: "Landlord",
  TENANT: "Tenant",
  PROPERTY_AGENT: "Property Agent",
  SERVICE_PROVIDER: "Service Provider",
};

export const STAFF_ROLES = ["SUPER_ADMIN", "ADMIN", "FINANCE_ADMIN", "PROPERTY_MANAGER", "SUPPORT", "MODERATOR", "VIEWER"] as const;
export const ALL_ROLES = [...STAFF_ROLES, "LANDLORD", "TENANT", "PROPERTY_AGENT", "SERVICE_PROVIDER"] as const;
