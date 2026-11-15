/**
 * User profile (+ consent records) and FCM tokens against a REAL MySQL test database (same setup as properties.api.test.ts):
 *   TEST_DATABASE_URL in server/.env → npm --prefix server run test:migrate → npm --prefix server run test:integration
 * Firebase is replaced by a fake token verifier. Skipped when TEST_DATABASE_URL is not set.
 */
import type { Server } from "node:http";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const RAW_TEST_DB = process.env.TEST_DATABASE_URL;
const TEST_DB = RAW_TEST_DB && /test/i.test(new URL(RAW_TEST_DB).pathname) ? RAW_TEST_DB : undefined;

const tokens = new Map<string, { uid: string; auth_time: number; firebase: { sign_in_provider: string }; phone_number?: string }>();
vi.mock("../../src/lib/firebaseAdmin", () => ({
  messaging: { sendEachForMulticast: async () => ({ responses: [], successCount: 0, failureCount: 0 }) },
  adminAuth: {
    verifyIdToken: async (token: string) => {
      const decoded = tokens.get(token);
      if (!decoded) throw Object.assign(new Error("bad token"), { code: "auth/argument-error" });
      return decoded;
    },
    setCustomUserClaims: async () => undefined,
  },
  appCheck: { verifyToken: async () => ({}) },
}));

type Json = { success: boolean; message: string; data: any; meta: any; errorCode?: string; details?: any };

describe.skipIf(!TEST_DB)("user profile, consents and FCM tokens (MySQL integration)", () => {
  let server: Server;
  let base = "";
  let prisma: PrismaClient;

  async function call(who: string, method: string, url: string, body?: unknown): Promise<{ status: number; json: Json }> {
    const headers: Record<string, string> = { "X-Client-Platform": "ANDROID", "User-Agent": "SafeRent-Android/1.0 (test)" };
    if (who) headers.Authorization = `Bearer t-${who}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${base}/api/v1${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
  }

  const consents = (whatsapp = false) => [
    { type: "TERMS", version: "2026-11-01", granted: true },
    { type: "PRIVACY", version: "2026-11-01", granted: true },
    { type: "WHATSAPP", version: "", granted: whatsapp },
  ];
  const profile = (extra: Record<string, unknown> = {}) => ({
    isProfileCompleted: true,
    role: "TENANT",
    fullName: "Visitor One",
    gender: "FEMALE",
    dateOfBirth: "1996-05-20",
    city: "Hyderabad",
    state: "Telangana",
    consents: consents(),
    clientAcceptedAt: Date.now() - 5000,
    source: "ANDROID",
    appVersion: "1.0",
    ...extra,
  });
  const rowsOf = (uid: string) => prisma.userConsent.findMany({ where: { userUid: uid }, orderBy: { id: "asc" } });
  const FCM = "fcm-token-abcdefghijklmnopqrstuvwxyz:APA91b_test-1234567890";

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DB,
      FIREBASE_PROJECT_ID: "saferent-test",
      GOOGLE_APPLICATION_CREDENTIALS: "./not-used.json",
      OTP_PEPPER: "test-pepper-test-pepper-test-pepper-test-pepper",
      APP_CHECK_ENFORCE: "false",
    });
    const load = (file: string) => import(path.resolve(__dirname, "../../src", file));
    prisma = (await load("lib/prisma.ts")).prisma as PrismaClient;
    const { syncRbacCatalog } = (await load("rbac/service.ts")) as { syncRbacCatalog: () => Promise<void> };
    const { app } = (await load("app.ts")) as { app: Express };
    // user_consents refuses DELETE (append-only trigger) — TRUNCATE is the only way to reset it.
    await prisma.$executeRawUnsafe("TRUNCATE TABLE `user_consents`");
    await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
    for (const t of ["user_devices", "app_config_versions", "rate_limits", "auth_sessions", "user_roles", "user_permissions", "tenant_profiles", "landlord_profiles", "notifications", "referrals", "referral_codes", "security_audit_logs", "admin_activity_logs", "users"]) {
      await prisma.$executeRawUnsafe(`DELETE FROM \`${t}\``).catch(() => undefined);
    }
    await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
    await syncRbacCatalog();
    const sa = await prisma.user.create({ data: { firebaseUid: "uid-super", fullName: "Test Super", role: "SUPER_ADMIN", isFounder: true, phoneNumber: "+919000000001" } });
    await prisma.authSession.create({ data: { userId: sa.id, authTime: 1_700_000_000, method: "PHONE_OTP", expiresAt: new Date(Date.now() + 3600_000) } });
    tokens.set("t-super", { uid: "uid-super", auth_time: 1_700_000_000, firebase: { sign_in_provider: "phone" } });
    // A first-time user who has just verified the OTP (recent sign-in, phone number in the token).
    tokens.set("t-visitor", { uid: "uid-visitor", auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: "phone" }, phone_number: "+919000000123" });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  }, 60_000);

  afterAll(async () => {
    server?.close();
    await prisma?.$disconnect();
  });

  it("missing or invalid token → 401", async () => {
    expect((await call("", "POST", "/userProfile", profile())).status).toBe(401);
    expect((await call("nobody", "POST", "/userProfile", profile())).status).toBe(401);
  });

  it("OTP complete saves the FCM token, also for a first-time user", async () => {
    const r = await call("visitor", "POST", "/auth/phone/complete", { fcmToken: FCM, platform: "ANDROID", appVersion: "1.0" });
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ registrationRequired: true, isProfileCompleted: false, termsAccepted: false, fcmTokenSaved: true });
    expect(await prisma.userDevice.findUnique({ where: { fcmToken: FCM } })).toMatchObject({ userUid: "uid-visitor", platform: "ANDROID" });
  });

  it("a new account must accept the Terms and Privacy Policy", async () => {
    const r = await call("visitor", "POST", "/userProfile", profile({ consents: undefined }));
    expect(r.status).toBe(400);
    expect(r.json.errorCode).toBe("VALIDATION_ERROR");
    expect(await prisma.user.count({ where: { firebaseUid: "uid-visitor" } })).toBe(0);
  });

  it("first POST /userProfile creates the account and records TERMS + PRIVACY (+ WHATSAPP) with SERVER time", async () => {
    const before = Date.now();
    const r = await call("visitor", "POST", "/userProfile", profile());
    expect(r.status).toBe(201);
    expect(r.json.data).toMatchObject({ isProfileCompleted: true, role: "TENANT", termsAccepted: true });
    expect(r.json.data.consents.terms).toMatchObject({ accepted: true, acceptedVersion: "2026-11-01" });
    const rows = await rowsOf("uid-visitor");
    expect(rows.map((x) => x.consentType)).toEqual(["TERMS", "PRIVACY", "WHATSAPP"]);
    for (const row of rows) {
      expect(row.acceptedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(row.clientAcceptedAt!.getTime()).toBeLessThan(before);
      expect(row.source).toBe("ANDROID");
      expect(row.role).toBe("TENANT");
      expect(row.userAgent).toContain("SafeRent-Android");
    }
  });

  it("same consents again (existing account, PUT) → no duplicate rows", async () => {
    const r = await call("visitor", "PUT", "/userProfile", profile());
    expect(r.status).toBe(200);
    expect(r.json.data.termsAccepted).toBe(true);
    expect(await rowsOf("uid-visitor")).toHaveLength(3);
  });

  it("WhatsApp opt-in / opt-out add new rows; existing rows are never updated or deleted", async () => {
    await call("visitor", "PUT", "/userProfile", profile({ consents: [{ type: "WHATSAPP", version: "", granted: true }] }));
    const r = await call("visitor", "PUT", "/userProfile", profile({ consents: [{ type: "WHATSAPP", version: "", granted: false }] }));
    expect(r.json.data.consents.whatsapp.granted).toBe(false);
    const rows = await rowsOf("uid-visitor");
    expect(rows.filter((x) => x.consentType === "WHATSAPP").map((x) => x.granted)).toEqual([false, true, false]);
    await expect(prisma.userConsent.updateMany({ where: { userUid: "uid-visitor" }, data: { granted: true } })).rejects.toThrow();
    await expect(prisma.userConsent.deleteMany({ where: { userUid: "uid-visitor" } })).rejects.toThrow();
    expect(await rowsOf("uid-visitor")).toHaveLength(rows.length);
  });

  it("auth/me shows termsAccepted; FCM token refresh and logout", async () => {
    expect((await call("visitor", "GET", "/auth/me")).json.data.termsAccepted).toBe(true);
    const NEW = `${FCM}-rotated`;
    expect((await call("visitor", "PUT", "/devices/fcm-token", { fcmToken: NEW, platform: "ANDROID", appVersion: "1.1" })).status).toBe(200);
    expect(await prisma.userDevice.findUnique({ where: { fcmToken: NEW } })).toMatchObject({ userUid: "uid-visitor", appVersion: "1.1" });
    expect((await call("visitor", "POST", "/auth/logout", { fcmToken: NEW })).status).toBe(200);
    expect(await prisma.userDevice.findUnique({ where: { fcmToken: NEW } })).toBeNull();
  });

  it("admin history: full list newest first, Super Admin only", async () => {
    const r = await call("super", "GET", "/admin/users/uid-visitor/consents");
    expect(r.status).toBe(200);
    const history = r.json.data.history as Array<{ acceptedAt: string }>;
    expect(history.length).toBe((await rowsOf("uid-visitor")).length);
    expect([...history].sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt))).toEqual(history);
    expect((await call("visitor", "GET", "/admin/users/uid-visitor/consents")).status).toBe(403);
  });
});
