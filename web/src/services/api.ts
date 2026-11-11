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
  // Same API as the Android and iOS apps; the platform is recorded in audit logs.
  const h: Record<string, string> = { "X-Client-Platform": "ADMIN_PANEL", ...(json ? { "Content-Type": "application/json" } : {}) };
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
  return `${API_URL}/api/v1${path}${s ? `?${s}` : ""}`;
}

async function send(path: string, init: RequestInit, query?: RequestOptions["query"]): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url(path, query), init);
  } catch {
    throw new AppError("offline", "Can't reach the SafeRent server. Check your connection and that the API is running.");
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as Envelope | null;
    const details = { reason: payload?.reason ?? (response.status >= 500 ? "INTERNAL" : "UNKNOWN"), errorCode: payload?.errorCode, ...(payload?.details ?? {}) };
    throw toAppError({ code: `http/${response.status}`, details, message: String(payload?.message ?? "") });
  }
  return response;
}

/** v1 response envelope: { success, message, data, meta } / { success: false, message, errorCode, reason, details }. */
interface Envelope {
  success: boolean;
  message?: string;
  data?: unknown;
  meta?: Record<string, unknown> | null;
  errorCode?: string;
  reason?: string | null;
  details?: Record<string, unknown>;
}

/** Turns the envelope back into the shape pages use: paginated lists → { items, page, pageSize, total, totalPages }. */
export function unwrap<T>(body: Envelope): T {
  if (body.meta && Array.isArray(body.data) && typeof body.meta.total === "number") return { items: body.data, ...body.meta } as T;
  if (body.data === null || body.data === undefined) return { ok: true } as T;
  return body.data as T;
}

/**
 * Calls the SafeRent API with the current Firebase ID token.
 * Every request is re-authorized on the server; errors become friendly AppErrors.
 */
export async function request<T>(path: string, { method = "GET", body, auth: withAuth = true, query }: RequestOptions = {}): Promise<T> {
  const response = await send(path, { method, headers: await headers(withAuth, true), body: body === undefined ? undefined : JSON.stringify(body) }, query);
  return unwrap<T>((await response.json()) as Envelope);
}

/** multipart/form-data upload (images, documents). */
export async function upload<T>(path: string, form: FormData): Promise<T> {
  const response = await send(path, { method: "POST", headers: await headers(true, false), body: form });
  return unwrap<T>((await response.json()) as Envelope);
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
  /** Every role held (primary first) — multi-role accounts, e.g. landlord + tenant. */
  roles: RoleInfo[];
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
  register: (body: { fullName: string; role: "LANDLORD" | "TENANT"; email?: string; referralCode?: string }) => request<{ ok: true }>("/auth/register", { method: "POST", body }),
  rebindSession: (body: { previousIdToken: string }) => request<{ ok: true }>("/auth/session/rebind", { method: "POST", body }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  requestPasswordReset: (body: { email: string }) => request<{ ok: true }>("/auth/password-reset", { method: "POST", body, auth: false }),
  changePassword: (body: { newPassword: string }) => request<{ ok: true; reSignInRequired: boolean }>("/account/password", { method: "POST", body }),
  requestEmailChange: (body: { newEmail: string }) => request<{ ok: true; maskedEmail: string }>("/account/email", { method: "POST", body }),
  syncPhoneNumber: () => request<{ ok: true; maskedPhone: string }>("/account/phone/sync", { method: "POST" }),
  recentActivity: (limit = 8) => request<{ items: AuditLogEntry[] }>("/me/activity", { query: { limit } }),
};
