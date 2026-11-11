import { randomUUID } from "node:crypto";
import { env } from "../config/env";
import { AppError } from "./errors";
import { REASONS } from "../config/constants";
import { aadhaarLast4 } from "./kyc";

/*
 * DigiLocker providers. Today: Setu (https://docs.setu.co/data/digilocker/quickstart) and a fake
 * "mock" DigiLocker for local testing. To switch provider later, add one here — controllers don't change.
 * Keys live in server/.env only.
 */

export interface AadhaarIdentity {
  name: string;
  dob: string | null;
  gender: string | null;
  aadhaarLast4: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  /** JPEG bytes of the Aadhaar photo, when DigiLocker shares one. */
  photo: Buffer | null;
}

export interface DigiLockerProvider {
  key: "SETU" | "MOCK";
  /** Creates a DigiLocker consent session; the owner is sent to `url`. */
  start(redirectUrl: string): Promise<{ ref: string; url: string }>;
  /** After the owner returns: the Aadhaar identity they consented to share. */
  fetchAadhaar(ref: string, fallbackName: string): Promise<AadhaarIdentity>;
  /** Ends access to the owner's DigiLocker (best effort). */
  revoke(ref: string): Promise<void>;
}

export function kycProviderKey(): "setu" | "mock" | "off" {
  if (env.KYC_PROVIDER) return env.KYC_PROVIDER;
  if (env.SETU_DG_CLIENT_ID && env.SETU_DG_CLIENT_SECRET && env.SETU_DG_PRODUCT_INSTANCE_ID) return "setu";
  return env.NODE_ENV === "production" ? "off" : "mock";
}

const unavailable = (msg = "Identity verification is temporarily unavailable. Please try again later.") =>
  new AppError("unavailable", "INTERNAL", msg);

class SetuDigiLocker implements DigiLockerProvider {
  key = "SETU" as const;
  private base = env.SETU_DG_SANDBOX ? "https://dg-sandbox.setu.co" : "https://dg.setu.co";

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    if (!env.SETU_DG_CLIENT_ID || !env.SETU_DG_CLIENT_SECRET || !env.SETU_DG_PRODUCT_INSTANCE_ID) throw unavailable("DigiLocker keys are not set on the server.");
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          "x-client-id": env.SETU_DG_CLIENT_ID,
          "x-client-secret": env.SETU_DG_CLIENT_SECRET,
          "x-product-instance-id": env.SETU_DG_PRODUCT_INSTANCE_ID,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw unavailable();
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const code = String((json.error as { code?: string } | undefined)?.code ?? json.code ?? res.status);
      if (code.includes("aadhaar_not_linked")) throw new AppError("failed-precondition", REASONS.INVALID_STATE, "Your Aadhaar isn't linked to a mobile number, so DigiLocker can't share it. Link it at an Aadhaar centre and try again.");
      if (res.status === 404) throw new AppError("failed-precondition", REASONS.INVALID_STATE, "This DigiLocker session expired. Please start again.");
      console.error("[digilocker] Setu error", res.status, code);
      throw unavailable();
    }
    return json as T;
  }

  async start(redirectUrl: string) {
    const r = await this.call<{ id: string; url: string }>("POST", "/api/digilocker/", { redirectUrl });
    return { ref: r.id, url: r.url };
  }

  async fetchAadhaar(ref: string): Promise<AadhaarIdentity> {
    const status = await this.call<{ status: string }>("GET", `/api/digilocker/${encodeURIComponent(ref)}/status`);
    if (status.status !== "authenticated") throw new AppError("failed-precondition", REASONS.INVALID_STATE, "DigiLocker sign-in wasn't completed. Please start again.");
    const r = await this.call<{ aadhaar?: { name?: string; dateOfBirth?: string; gender?: string; maskedNumber?: string; photo?: string; address?: { district?: string; vtc?: string; state?: string; pin?: string } } }>(
      "GET",
      `/api/digilocker/${encodeURIComponent(ref)}/aadhaar`,
    );
    const a = r.aadhaar;
    if (!a?.name) throw new AppError("failed-precondition", REASONS.INVALID_STATE, "Aadhaar wasn't shared. Please allow Aadhaar on the DigiLocker consent screen.");
    const photo = a.photo ? Buffer.from(a.photo.replace(/^data:image\/\w+;base64,/, ""), "base64") : null;
    return {
      name: a.name.trim(),
      dob: a.dateOfBirth ?? null,
      gender: a.gender ?? null,
      aadhaarLast4: aadhaarLast4(a.maskedNumber),
      city: a.address?.district ?? a.address?.vtc ?? null,
      state: a.address?.state ?? null,
      pincode: a.address?.pin ?? null,
      photo: photo && photo.length > 100 ? photo : null,
    };
  }

  async revoke(ref: string) {
    await this.call("GET", `/api/digilocker/${encodeURIComponent(ref)}/revoke`).catch(() => undefined);
  }
}

/** Fake DigiLocker for development: returns straight to the app with the profile name. Refused in production. */
class MockDigiLocker implements DigiLockerProvider {
  key = "MOCK" as const;
  async start(redirectUrl: string) {
    const ref = `MOCK-${randomUUID()}`;
    const u = new URL(redirectUrl);
    u.searchParams.set("id", ref);
    u.searchParams.set("success", "True");
    u.searchParams.set("scope", "ADHAR");
    return { ref, url: u.toString() };
  }
  async fetchAadhaar(_ref: string, fallbackName: string): Promise<AadhaarIdentity> {
    return { name: fallbackName, dob: "1990-01-01", gender: "M", aadhaarLast4: "0000", city: "Hyderabad", state: "Telangana", pincode: "500001", photo: null };
  }
  async revoke() {}
}

export function digiLocker(): DigiLockerProvider | null {
  const key = kycProviderKey();
  if (key === "setu") return new SetuDigiLocker();
  if (key === "mock" && env.NODE_ENV !== "production") return new MockDigiLocker();
  return null;
}
