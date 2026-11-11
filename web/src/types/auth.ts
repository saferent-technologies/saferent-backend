export type Role =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "FINANCE_ADMIN"
  | "PROPERTY_MANAGER"
  | "SUPPORT"
  | "MODERATOR"
  | "VIEWER"
  | "LANDLORD"
  | "TENANT"
  | "PROPERTY_AGENT"
  | "SERVICE_PROVIDER";

export type Scope = "OWN" | "ASSIGNED" | "ALL";
export type Permissions = Partial<Record<string, Scope[]>>;

/** users row (MySQL) as returned by the API. Dates are ISO strings. */
export interface UserProfile {
  id: string;
  fullName: string;
  email: string | null;
  pendingEmail: string | null;
  phoneNumber: string | null;
  profileImage: string | null;
  role: Role;
  /** All roles held (primary first). */
  roles?: Role[];
  accountStatus: "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
  isFounder: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

/** Kept for older imports. */
export type AdminProfile = UserProfile;

export interface RoleInfo {
  key: Role;
  name: string;
  description: string;
  rank: number;
  isStaff: boolean;
  selfSignup: boolean;
}

/** The verified second-factor session for the current sign-in. */
export interface AdminSession {
  method: "EMAIL_OTP" | "PHONE_OTP";
  verifiedAt: string;
  expiresAt: string;
}

export interface EmailOtpChallenge {
  challengeId: string;
  maskedEmail: string;
  expiresAt: number;
  resendAvailableAt: number;
}

export type AuthStatus = "initializing" | "signed_out" | "registration_required" | "awaiting_second_factor" | "authenticated" | "unauthorized";

export interface AuditLogEntry {
  id: string;
  action: string;
  outcome: "success" | "failure";
  reason: string | null;
  ip: string | null;
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
