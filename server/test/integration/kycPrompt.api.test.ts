/**
 * "Verify as owner" prompt flag (kycPromptDone) against a REAL MySQL test database (same setup as consents.api.test.ts):
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

type Json = { success: boolean; message: string; data: any; meta: any; errorCode?: string };

describe.skipIf(!TEST_DB)("owner verification prompt flag (MySQL integration)", () => {
  let server: Server;
  let base = "";
  let prisma: PrismaClient;
  let landlordId = "";
  let tenantId = "";

  async function call(who: string, method: string, url: string, body?: unknown): Promise<{ status: number; json: Json }> {
    const headers: Record<string, string> = { "X-Client-Platform": "ANDROID", "User-Agent": "SafeRent-Android/1.0 (test)" };
    if (who) headers.Authorization = `Bearer t-${who}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${base}/api/v1${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
  }

  async function signedIn(uid: string, role: "LANDLORD" | "TENANT" | "SUPER_ADMIN", phone: string) {
    const u = await prisma.user.create({ data: { firebaseUid: uid, fullName: `Test ${role}`, role, phoneNumber: phone, phoneVerified: true, profileCompleted: true } });
    const authTime = Math.floor(Date.now() / 1000);
    await prisma.authSession.create({ data: { userId: u.id, authTime, method: "PHONE_OTP", expiresAt: new Date(Date.now() + 3600_000) } });
    tokens.set(`t-${uid}`, { uid, auth_time: authTime, firebase: { sign_in_provider: "phone" }, phone_number: phone });
    return u.id;
  }

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DB,
      FIREBASE_PROJECT_ID: "saferent-test",
      GOOGLE_APPLICATION_CREDENTIALS: "./not-used.json",
      OTP_PEPPER: "test-pepper-test-pepper-test-pepper-test-pepper",
      APP_CHECK_ENFORCE: "false",
      KYC_PROVIDER: "off",
      // A throwaway self-signed certificate (NOT UIDAI's): turns the Aadhaar Offline e-KYC option on.
      UIDAI_OFFLINE_CERT_PATH: path.resolve(__dirname, "../fixtures/uidai-test-cert.pem"),
      KYC_MANUAL_ID_REVIEW: "true",
    });
    const load = (file: string) => import(path.resolve(__dirname, "../../src", file));
    prisma = (await load("lib/prisma.ts")).prisma as PrismaClient;
    const { syncRbacCatalog } = (await load("rbac/service.ts")) as { syncRbacCatalog: () => Promise<void> };
    const { app } = (await load("app.ts")) as { app: Express };
    await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
    for (const t of ["kyc_tutorials", "kyc_id_type_settings", "identity_verifications", "rate_limits", "auth_sessions", "user_roles", "user_permissions", "tenant_profiles", "landlord_profiles", "notifications", "security_audit_logs", "admin_activity_logs", "users"]) {
      await prisma.$executeRawUnsafe(`DELETE FROM \`${t}\``).catch(() => undefined);
    }
    await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
    await syncRbacCatalog();
    landlordId = await signedIn("uid-landlord", "LANDLORD", "+919000000201");
    tenantId = await signedIn("uid-tenant", "TENANT", "+919000000202");
    await signedIn("uid-super", "SUPER_ADMIN", "+919000000203");
    await prisma.landlordProfile.create({ data: { userId: landlordId } });
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

  async function upload(who: string, fields: Record<string, string>, file?: { field: string; bytes: Buffer; name: string; type: string }) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    if (file) form.append(file.field, new Blob([file.bytes], { type: file.type }), file.name);
    const res = await fetch(`${base}/api/v1/kyc/identity`, { method: "POST", headers: { Authorization: `Bearer t-${who}`, "X-Client-Platform": "ANDROID" }, body: form });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
  }

  it("GET /kyc/me → idTypes reflects the configuration", async () => {
    const r = await call("uid-landlord", "GET", "/kyc/me");
    expect(r.status).toBe(200);
    // Aadhaar offline configured (test cert), e-Aadhaar PDF not built, staff review on.
    expect(r.json.data.idTypes).toEqual(["AADHAAR_XML", "PAN", "PASSPORT"]);
  });

  it("POST /kyc/identity with a type that isn't available → 412 ID_TYPE_UNAVAILABLE", async () => {
    const r = await upload("uid-landlord", { type: "EAADHAAR_PDF", secret: "ABCD1990" }, { field: "file", bytes: Buffer.from("%PDF-1.7 test"), name: "eaadhaar.pdf", type: "application/pdf" });
    expect(r.status).toBe(412);
    expect(r.json.errorCode).toBe("ID_TYPE_UNAVAILABLE");
    expect(r.json.message).toBe("This ID can't be checked right now. Please choose another ID.");
  });

  it("AADHAAR_XML with a file that isn't a ZIP (even if named .zip) → 422 INVALID_FILE", async () => {
    const r = await upload("uid-landlord", { type: "AADHAAR_XML", secret: "1234" }, { field: "file", bytes: Buffer.from("%PDF-1.7 not a zip"), name: "aadhaar.zip", type: "application/zip" });
    expect(r.status).toBe(422);
    expect(r.json.errorCode).toBe("INVALID_FILE");
    expect(r.json.message).toBe("Choose the Aadhaar ZIP file.");
  });

  it("AADHAAR_XML with no file → 422 INVALID_FILE", async () => {
    const r = await upload("uid-landlord", { type: "AADHAAR_XML", secret: "1234" });
    expect(r.status).toBe(422);
    expect(r.json.errorCode).toBe("INVALID_FILE");
  });

  it("GET /kyc/me → promptDone is false by default", async () => {
    const r = await call("uid-landlord", "GET", "/kyc/me");
    expect(r.status).toBe(200);
    expect(r.json.data.promptDone).toBe(false);
    expect(r.json.data.stage).toBe("NOT_STARTED"); // rest of the shape unchanged
  });

  it("POST /kyc/prompt-done → Saved, promptDone true (any role, body ignored)", async () => {
    const r = await call("uid-tenant", "POST", "/kyc/prompt-done", { anything: "ignored" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ success: true, message: "Saved", data: { promptDone: true } });
    const u = await prisma.user.findUniqueOrThrow({ where: { id: tenantId } });
    expect(u.kycPromptDone).toBe(true);
    expect(u.kycPromptDoneAt).toBeInstanceOf(Date);
  });

  it("a second call succeeds and keeps the first timestamp", async () => {
    const first = (await prisma.user.findUniqueOrThrow({ where: { id: tenantId } })).kycPromptDoneAt!;
    await new Promise((r) => setTimeout(r, 20));
    const r = await call("uid-tenant", "POST", "/kyc/prompt-done", {});
    expect(r.status).toBe(200);
    expect(r.json.data.promptDone).toBe(true);
    const again = (await prisma.user.findUniqueOrThrow({ where: { id: tenantId } })).kycPromptDoneAt!;
    expect(again.getTime()).toBe(first.getTime());
  });

  it("POST /kyc/submit sets promptDone true, and /kyc/me shows it", async () => {
    expect((await prisma.user.findUniqueOrThrow({ where: { id: landlordId } })).kycPromptDone).toBe(false);
    // Ready to submit: an ID document and a selfie are on file.
    await prisma.identityVerification.create({ data: { userId: landlordId, provider: "DOCUMENT", providerRef: `PAN-test-${Date.now()}`, documentType: "PAN", status: "COMPLETED", completedAt: new Date(), documentLast4: "234F" } });
    await prisma.landlordProfile.update({ where: { userId: landlordId }, data: { selfiePath: "kyc/test-selfie.jpg" } });
    const s = await call("uid-landlord", "POST", "/kyc/submit", {});
    expect(s.status).toBe(200);
    expect(s.json.data).toMatchObject({ ok: true, stage: "SUBMITTED" });
    const me = await call("uid-landlord", "GET", "/kyc/me");
    expect(me.json.data.promptDone).toBe(true);
    expect(me.json.data.stage).toBe("SUBMITTED");
  });

  it("needs sign-in", async () => {
    expect((await call("", "POST", "/kyc/prompt-done", {})).status).toBe(401);
  });

  /* ── Guides (tutorials) and the ID type switches ── */

  it("GET /kyc/tutorials → [] when there are none (any role), not in /kyc/me any more", async () => {
    const r = await call("uid-tenant", "GET", "/kyc/tutorials");
    expect(r.status).toBe(200);
    expect(r.json.data).toEqual({ tutorials: [] });
    expect((await call("uid-landlord", "GET", "/kyc/me")).json.data.tutorials).toBeUndefined();
    expect((await call("", "GET", "/kyc/tutorials")).status).toBe(401);
  });

  it("only Super Admin writes guides and switches", async () => {
    expect((await call("uid-landlord", "GET", "/admin/kyc-tutorials")).status).toBe(403);
    expect((await call("uid-landlord", "POST", "/admin/kyc-tutorials", { idType: "PAN", title: "PAN card", type: "IMAGE", url: "https://cdn.example.com/pan.png" })).status).toBe(403);
    expect((await call("uid-tenant", "PUT", "/admin/kyc-settings", { idTypes: { PAN: false } })).status).toBe(403);
  });

  it("validates type, link, title and ID type", async () => {
    const g = { idType: "AADHAAR_XML", title: "Aadhaar offline eKYC", type: "VIDEO" };
    expect((await call("uid-super", "POST", "/admin/kyc-tutorials", { ...g, url: "https://www.youtube.com/watch?v=x" })).status).toBe(400);
    expect((await call("uid-super", "POST", "/admin/kyc-tutorials", { ...g, type: "PDF", url: "https://cdn.example.com/a.mp4" })).status).toBe(400);
    expect((await call("uid-super", "POST", "/admin/kyc-tutorials", { ...g, type: "AUDIO", url: "https://cdn.example.com/a.mp3" })).status).toBe(400);
    expect((await call("uid-super", "POST", "/admin/kyc-tutorials", { ...g, title: "x".repeat(61), url: "https://cdn.example.com/a.mp4" })).status).toBe(400);
    expect((await call("uid-super", "POST", "/admin/kyc-tutorials", { ...g, idType: "aadhaar xml!", url: "https://cdn.example.com/a.mp4" })).status).toBe(400);
    // An uploaded "PDF" that isn't one → 422 INVALID_FILE.
    const form = new FormData();
    form.append("idType", "PAN");
    form.append("title", "PAN card steps");
    form.append("type", "PDF");
    form.append("file", new Blob([Buffer.from("PK\x03\x04 not a pdf")], { type: "application/pdf" }), "steps.pdf");
    const res = await fetch(`${base}/api/v1/admin/kyc-tutorials`, { method: "POST", headers: { Authorization: "Bearer t-uid-super", "X-Client-Platform": "ADMIN_PANEL" }, body: form });
    expect(res.status).toBe(422);
    expect(((await res.json()) as Json).errorCode).toBe("INVALID_FILE");
  });

  it("returns active guides in display order, hides inactive ones (new ID types too)", async () => {
    const add = (idType: string, title: string, order: number, active = true) =>
      call("uid-super", "POST", "/admin/kyc-tutorials", { idType, title, type: "VIDEO", url: `https://cdn.example.com/${order}.mp4`, order, active, description: "Short how to" });
    expect((await add("PAN", "PAN card", 2)).status).toBe(201);
    expect((await add("AADHAAR_XML", "Aadhaar offline eKYC", 1)).status).toBe(201);
    const hidden = await add("VOTER_ID", "Voter ID", 0, false);
    expect(hidden.status).toBe(201);
    const r = await call("uid-tenant", "GET", "/kyc/tutorials");
    expect(r.json.data.tutorials.map((t: { title: string }) => t.title)).toEqual(["Aadhaar offline eKYC", "PAN card"]);
    expect(r.json.data.tutorials[0]).toEqual({ id: expect.any(String), idType: "AADHAAR_XML", title: "Aadhaar offline eKYC", description: "Short how to", type: "VIDEO", url: "https://cdn.example.com/1.mp4" });
    expect(r.json.data.tutorials[0].order).toBeUndefined();
    // Activating the new ID type's guide shows it first (order 0), no app change needed.
    expect((await call("uid-super", "PATCH", `/admin/kyc-tutorials/${hidden.json.data.tutorial.id}`, { active: true })).status).toBe(200);
    const again = await call("uid-tenant", "GET", "/kyc/tutorials");
    expect(again.json.data.tutorials[0]).toMatchObject({ idType: "VOTER_ID", title: "Voter ID" });
  });

  it("ID type switch off removes it from idTypes and POST /kyc/identity refuses it (one pipeline)", async () => {
    const off = await call("uid-super", "PUT", "/admin/kyc-settings", { idTypes: { PAN: false } });
    expect(off.status).toBe(200);
    expect(off.json.data.idTypes.find((t: { type: string }) => t.type === "PAN")).toMatchObject({ enabled: false, configured: true, available: false });
    expect((await call("uid-tenant", "GET", "/kyc/me")).status).not.toBe(500);
    const me = await call("uid-landlord", "GET", "/kyc/me");
    expect(me.json.data.idTypes).not.toContain("PAN");
    const form = new FormData();
    form.append("type", "PAN");
    form.append("number", "ABCDE1234F");
    const res = await fetch(`${base}/api/v1/kyc/identity`, { method: "POST", headers: { Authorization: "Bearer t-uid-landlord", "X-Client-Platform": "ANDROID" }, body: form });
    expect(res.status).toBe(412);
    expect(((await res.json()) as Json).errorCode).toBe("ID_TYPE_UNAVAILABLE");
    await call("uid-super", "PUT", "/admin/kyc-settings", { idTypes: { PAN: true } });
  });
});
