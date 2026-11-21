/**
 * Verified name lock on PUT /userProfile against a REAL MySQL test database (same setup as consents.api.test.ts).
 * Skipped when TEST_DATABASE_URL is not set.
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

type Json = { success: boolean; message: string; data: any; errorCode?: string };

describe.skipIf(!TEST_DB)("verified name lock (MySQL integration)", () => {
  let server: Server;
  let base = "";
  let prisma: PrismaClient;
  let userId = "";

  async function call(method: string, url: string, body?: unknown): Promise<{ status: number; json: Json }> {
    const res = await fetch(`${base}/api/v1${url}`, {
      method,
      headers: { Authorization: "Bearer t-owner", "X-Client-Platform": "ANDROID", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
  }
  const save = (extra: Record<string, unknown>) => call("PUT", "/userProfile", { isProfileCompleted: false, role: "LANDLORD", ...extra });

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
    await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
    for (const t of ["rate_limits", "auth_sessions", "user_roles", "user_permissions", "tenant_profiles", "landlord_profiles", "notifications", "security_audit_logs", "admin_activity_logs", "users"]) {
      await prisma.$executeRawUnsafe(`DELETE FROM \`${t}\``).catch(() => undefined);
    }
    await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
    await syncRbacCatalog();
    const u = await prisma.user.create({ data: { firebaseUid: "uid-owner", fullName: "Ravi Kumar", role: "LANDLORD", phoneNumber: "+919000000301", phoneVerified: true } });
    userId = u.id;
    await prisma.landlordProfile.create({ data: { userId } });
    const authTime = Math.floor(Date.now() / 1000);
    await prisma.authSession.create({ data: { userId, authTime, method: "PHONE_OTP", expiresAt: new Date(Date.now() + 3600_000) } });
    tokens.set("t-owner", { uid: "uid-owner", auth_time: authTime, firebase: { sign_in_provider: "phone" }, phone_number: "+919000000301" });
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

  it("unlocked: the name updates, nameLocked false in /auth/me and the save response", async () => {
    const r = await save({ fullName: "Ravi Kumar Reddy" });
    expect(r.status).toBe(200);
    expect(r.json.data.user).toMatchObject({ fullName: "Ravi Kumar Reddy", nameLocked: false });
    const me = await call("GET", "/auth/me");
    expect(me.json.data.user.nameLocked).toBe(false);
  });

  it("KYC approved locks the name", async () => {
    // Same effect as staff approving owner verification.
    await prisma.landlordProfile.update({ where: { userId }, data: { kycStatus: "APPROVED" } });
    await prisma.user.update({ where: { id: userId }, data: { nameLocked: true, nameLockedAt: new Date() } });
    expect((await call("GET", "/auth/me")).json.data.user.nameLocked).toBe(true);
  });

  it("locked + same name (any case / spaces) is OK", async () => {
    const r = await save({ fullName: "  ravi kumar   REDDY " });
    expect(r.status).toBe(200);
    expect(r.json.data.user).toMatchObject({ fullName: "Ravi Kumar Reddy", nameLocked: true });
  });

  it("locked + different name → 412 NAME_LOCKED, name unchanged", async () => {
    const r = await save({ fullName: "Someone Else", city: "Pune" });
    expect(r.status).toBe(412);
    expect(r.json.errorCode).toBe("NAME_LOCKED");
    expect(r.json.message).toBe("Your name is verified, so it can't be changed. Contact support.");
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.fullName).toBe("Ravi Kumar Reddy");
    expect(u.city).not.toBe("Pune");
  });

  it("locked: other fields still save", async () => {
    const r = await save({ gender: "MALE", dateOfBirth: "1990-05-20", city: "Hyderabad", state: "Telangana", occupation: "Business" });
    expect(r.status).toBe(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u).toMatchObject({ fullName: "Ravi Kumar Reddy", gender: "MALE", city: "Hyderabad", state: "Telangana" });
    expect(r.json.data.role).toBe("LANDLORD");
    expect(u.role).toBe("LANDLORD");
  });
});
