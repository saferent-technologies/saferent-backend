import type { AuditLogEntry } from "@/types/auth";
import { api } from "./api";

/** Recent security events for the signed-in admin (verified session required — enforced by the API). */
export async function fetchRecentActivity(max = 8): Promise<AuditLogEntry[]> {
  return (await api.recentActivity(max)).items;
}

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.logout": "Signed out",
  "auth.otp.request": "Verification code requested",
  "auth.otp.verify": "Verification code checked",
  "auth.reauthenticate": "Password confirmed",
  "auth.password_reset.request": "Password reset requested",
  "account.password.change": "Password changed",
  "account.email.change_requested": "Email change requested",
  "account.email.change": "Email changed",
  "account.phone.change": "Phone number changed",
  "bootstrap.super_admin.created": "Account created",
};

export function describeAction(action: string): string {
  return ACTION_LABELS[action] ?? action;
}
