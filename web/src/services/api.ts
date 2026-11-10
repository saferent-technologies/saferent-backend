import { getToken } from "firebase/app-check";
import { API_URL, appCheck, auth } from "@/firebase/config";
import type { AdminSession, AuditLogEntry, EmailOtpChallenge, Permissions, RoleInfo, UserProfile } from "@/types/auth";
import { AppError, toAppError } from "@/utils/errors";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface RequestOptions {
  method?: Method;
  body?: unknown;
  /** Send the Firebase ID token (default true). */
  auth?: boolean;
  /** Query string parameters (undefined/empty values are skipped). */
  query?: Record<string, string | number | boolean | undefined | null>;
}

async function headers(withAuth: boolean, json: boolean): Promise<Record<string, string>> {
  const h: Record<string, string> = json ? { "Content-Type": "application/json" } : {};
  if (withAuth) {
    const user = auth.currentUser;
    if (!user) throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");
    h.Authorization = `Bearer ${await user.getIdToken()}`;
  }
  if (appCheck) {
    try {
      h["X-Firebase-AppCheck"] = (await getToken(appCheck, false)).token;
    } catch {
      // The server decides whether App Check is required.
    }
  }
  return h;
}

function url(path: string, query?: RequestOptions["query"]): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return `${API_URL}/api${path}${s ? `?${s}` : ""}`;
}

async function send(path: string, init: RequestInit, query?: RequestOptions["query"]): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url(path, query), init);
  } catch {
    throw new AppError("offline", "Can't reach the SafeRent server. Check your connection and that the API is running.");
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: Record<string, unknown> } | null;
    throw toAppError({ code: `http/${response.status}`, details: payload?.error ?? { reason: response.status >= 500 ? "INTERNAL" : "UNKNOWN" }, message: String(payload?.error?.message ?? "") });
  }
  return response;
}

/**
 * Calls the SafeRent API with the current Firebase ID token.
 * Every request is re-authorized on the server; errors become friendly AppErrors.
 */
export async function request<T>(path: string, { method = "GET", body, auth: withAuth = true, query }: RequestOptions = {}): Promise<T> {
  const response = await send(path, { method, headers: await headers(withAuth, true), body: body === undefined ? undefined : JSON.stringify(body) }, query);
  return (await response.json()) as T;
}

/** multipart/form-data upload (images, documents). */
export async function upload<T>(path: string, form: FormData): Promise<T> {
  const response = await send(path, { method: "POST", headers: await headers(true, false), body: form });
  return (await response.json()) as T;
}

/** Downloads a protected file / document as a Blob (images, receipts, agreements). */
export async function fetchBlob(path: string): Promise<Blob> {
  const response = await send(path, { method: "GET", headers: await headers(true, false) });
  return response.blob();
}

/** Opens a protected HTML document (receipt / lease agreement) in a new tab. */
export async function openProtected(path: string): Promise<void> {
  const win = window.open("", "_blank");
  try {
    const blob = await fetchBlob(path);
    const objectUrl = URL.createObjectURL(blob);
    if (win) win.location.href = objectUrl;
    else window.location.href = objectUrl;
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (error) {
    win?.close();
    throw error;
  }
}

export interface MeResponse {
  registrationRequired: boolean;
  phoneNumber?: string | null;
  user: UserProfile;
  roleInfo: RoleInfo;
  permissions: Permissions;
  session: AdminSession | null;
  secondFactorRequired: boolean;
  signInProvider: string | null;
}

/** Auth & account endpoints (feature modules call `request` directly). */
export const api = {
  me: () => request<MeResponse>("/auth/me"),
  requestEmailOtp: () => request<EmailOtpChallenge>("/auth/email-otp/request", { method: "POST" }),
  verifyEmailOtp: (body: { challengeId: string; code: string }) => request<{ ok: true; mustChangePassword: boolean }>("/auth/email-otp/verify", { method: "POST", body }),
  completePhoneLogin: () => request<{ ok: true; registrationRequired: boolean; mustChangePassword?: boolean }>("/auth/phone/complete", { method: "POST" }),
  register: (body: { fullName: string; role: "LANDLORD" | "TENANT"; email?: string }) => request<{ ok: true }>("/auth/register", { method: "POST", body }),
  rebindSession: (body: { previousIdToken: string }) => request<{ ok: true }>("/auth/session/rebind", { method: "POST", body }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  requestPasswordReset: (body: { email: string }) => request<{ ok: true }>("/auth/password-reset", { method: "POST", body, auth: false }),
  changePassword: (body: { newPassword: string }) => request<{ ok: true; reSignInRequired: boolean }>("/account/password", { method: "POST", body }),
  requestEmailChange: (body: { newEmail: string }) => request<{ ok: true; maskedEmail: string }>("/account/email", { method: "POST", body }),
  syncPhoneNumber: () => request<{ ok: true; maskedPhone: string }>("/account/phone/sync", { method: "POST" }),
  recentActivity: (limit = 8) => request<{ items: AuditLogEntry[] }>("/me/activity", { query: { limit } }),
};
