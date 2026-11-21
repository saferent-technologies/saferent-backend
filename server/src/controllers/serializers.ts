import type { AuditLog, AuthSession, User } from "@prisma/client";

/** Shapes returned to the browser. Dates are ISO strings; internal fields are never exposed. */

export function toProfile(user: User) {
  return {
    id: user.id,
    fullName: user.fullName,
    // Verified legal name: the app shows the name read-only (changes → 412 NAME_LOCKED).
    nameLocked: user.nameLocked,
    email: user.email,
    pendingEmail: user.pendingEmail,
    phoneNumber: user.phoneNumber,
    safeRentId: user.safeRentId ?? null,
    profileImage: user.profileImage ? `/api/profile/image/${user.id}` : null,
    gender: user.gender ?? null,
    dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString().slice(0, 10) : null,
    city: user.city ?? null,
    state: user.state ?? null,
    isProfileCompleted: user.profileCompleted,
    role: user.role,
    accountStatus: user.accountStatus,
    isFounder: user.isFounder,
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

/** Minimal public identity shown to other parties (e.g. landlord ↔ tenant). No email, no full phone. */
export function toPublicUser(user: Pick<User, "id" | "fullName">) {
  return { id: user.id, fullName: user.fullName };
}

/** Contact details shared only with an active counterpart (landlord ↔ tenant on an ACTIVE lease). */
export function toContact(user: Pick<User, "id" | "fullName" | "phoneNumber" | "email">) {
  return { id: user.id, fullName: user.fullName, phoneNumber: user.phoneNumber, email: user.email };
}

export function toSession(session: AuthSession) {
  return {
    method: session.method,
    verifiedAt: session.verifiedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
  };
}

export function toAuditEntry(log: AuditLog) {
  return {
    id: log.id.toString(),
    action: log.action,
    outcome: log.outcome === "SUCCESS" ? "success" : "failure",
    reason: log.reason,
    ip: log.ip,
    createdAt: log.createdAt.toISOString(),
  };
}
