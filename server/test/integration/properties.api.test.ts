/**
 * End-to-end tests of the property APIs against a REAL MySQL test database.
 *
 *   1. Create an empty database:   CREATE DATABASE saferent_test;
 *   2. Add to server/.env:          TEST_DATABASE_URL="mysql://root:PASSWORD@localhost:3306/saferent_test"
 *   3. Run:                         npm --prefix server run test:integration
 *
 * Firebase is replaced by a fake token verifier; everything else (Express, RBAC, Prisma, MySQL,
 * transactions, row locks) is the real stack. Skipped automatically when TEST_DATABASE_URL is not set.
 */
import type { Server } from "node:http";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Safety: only ever runs against a database whose name contains "test" (all rows are deleted).
const RAW_TEST_DB = process.env.TEST_DATABASE_URL;
const TEST_DB = RAW_TEST_DB && /test/i.test(new URL(RAW_TEST_DB).pathname) ? RAW_TEST_DB : undefined;

const tokens = new Map<string, { uid: string; auth_time: number; firebase: { sign_in_provider: string }; phone_number?: string }>();
vi.mock("../../src/lib/firebaseAdmin", () => ({
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
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const PDF = new TextEncoder().encode("%PDF-1.4\n%test\n");

describe.skipIf(!TEST_DB)("property APIs (MySQL integration)", () => {
  let server: Server;
  let base = "";
  let prisma: PrismaClient;
  const ids: Record<string, string> = {};

  async function call(who: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
    const headers: Record<string, string> = { "X-Client-Platform": "ANDROID" };
    if (who) headers.Authorization = `Bearer t-${who}`;
    let payload: RequestInit["body"] | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${base}/api/v1${path}`, { method, headers, body: payload });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
  }

  async function makeUser(key: string, role: string, extra: Record<string, unknown> = {}) {
    const uid = `uid-${key}`;
    const user = await prisma.user.create({ data: { firebaseUid: uid, fullName: `Test ${key}`, role: role as never, phoneNumber: `+9190000${String(Object.keys(ids).length).padStart(5, "0")}`, ...extra } });
    await prisma.authSession.create({ data: { userId: user.id, authTime: 1_700_000_000, method: "PHONE_OTP", expiresAt: new Date(Date.now() + 3600_000) } });
    tokens.set(`t-${key}`, { uid, auth_time: 1_700_000_000, firebase: { sign_in_provider: "phone" } });
    ids[key] = user.id;
    return user;
  }

  async function createApartment(who: string, title = "Green Valley Apartments") {
    const r = await call(who, "POST", "/properties", { propertyTypeKey: "APARTMENT", title });
    expect(r.status).toBe(201);
    return r.json.data.property as { id: string; code: string; version: number };
  }

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DB,
      FIREBASE_PROJECT_ID: "saferent-test",
      GOOGLE_APPLICATION_CREDENTIALS: "./not-used.json",
      OTP_PEPPER: "test-pepper-test-pepper-test-pepper-test-pepper",
      APP_CHECK_ENFORCE: "false",
    });
    // Imported only now, after the environment is set (config/env validates on import).
    const load = (file: string) => import(path.resolve(__dirname, "../../src", file));
    prisma = (await load("lib/prisma.ts")).prisma as PrismaClient;
    const { syncRbacCatalog } = (await load("rbac/service.ts")) as { syncRbacCatalog: () => Promise<void> };
    const { syncPropertyCatalog } = (await load("properties/sync.ts")) as { syncPropertyCatalog: () => Promise<void> };
    const { app } = (await load("app.ts")) as { app: Express };
    // Clean slate (child tables first).
    for (const table of [
      "property_audit_logs", "property_status_history", "bed_assignments", "pricing_charges", "property_pricing", "property_amenities", "property_policies", "property_utilities",
      "property_beds", "property_rooms", "duplex_floors", "rent_payments", "leases", "rental_applications", "property_images", "property_documents", "property_inspections",
      "property_assignments", "enquiries", "property_visits", "maintenance_photos", "maintenance_requests", "properties", "property_units", "id_counters", "notifications",
      "rate_limits", "auth_sessions", "user_roles", "user_permissions", "landlord_profiles", "tenant_profiles", "security_audit_logs", "admin_activity_logs", "users",
    ]) {
      await prisma.$executeRawUnsafe(`SET FOREIGN_KEY_CHECKS = 0`);
      await prisma.$executeRawUnsafe(`DELETE FROM \`${table}\``);
      await prisma.$executeRawUnsafe(`SET FOREIGN_KEY_CHECKS = 1`);
    }
    await syncRbacCatalog();
    await syncPropertyCatalog();
    await makeUser("super", "SUPER_ADMIN", { isFounder: true });
    await makeUser("admin", "ADMIN");
    await makeUser("landlordA", "LANDLORD");
    await makeUser("landlordB", "LANDLORD");
    await makeUser("tenant", "TENANT");
    await makeUser("tenant2", "TENANT");
    await makeUser("manager", "PROPERTY_MANAGER");
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

  it("rejects requests without a valid Firebase token", async () => {
    expect((await call("", "GET", "/properties")).status).toBe(401);
    expect((await call("nobody", "GET", "/properties")).json.errorCode).toBe("UNAUTHENTICATED");
  });

  it("1. Super Admin can create a property", async () => {
    const r = await call("super", "POST", "/properties", { propertyTypeKey: "OFFICE_SPACE", listingType: "LEASE", title: "SafeRent office" });
    expect(r.status).toBe(201);
    expect(r.json.success).toBe(true);
    expect(r.json.data.property.code).toMatch(/^SR-PROP-\d{6}$/);
    expect(r.json.data.property.publicationStatus).toBe("DRAFT");
    ids.superProperty = r.json.data.property.id;
  });

  it("2. A landlord creates a draft; the owner comes from the token", async () => {
    const p = await createApartment("landlordA");
    const row = await prisma.property.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.ownerId).toBe(ids.landlordA);
    expect(row.publicationStatus).toBe("DRAFT");
    ids.aptA = p.id;
  });

  it("3 & 4. Landlords only see and change their own properties", async () => {
    const b = await createApartment("landlordB", "B's apartment");
    ids.aptB = b.id;
    const list = await call("landlordA", "GET", "/properties");
    expect(list.json.data.map((x: { id: string }) => x.id)).toContain(ids.aptA);
    expect(list.json.data.map((x: { id: string }) => x.id)).not.toContain(ids.aptB);
    expect((await call("landlordA", "GET", `/properties/${ids.aptB}`)).status).toBe(404);
    expect((await call("landlordA", "PATCH", `/properties/${ids.aptB}`, { title: "Hijacked title" })).status).toBe(404);
    expect((await call("landlordA", "DELETE", `/properties/${ids.aptB}`)).status).toBe(404);
    expect((await call("landlordA", "PUT", `/properties/${ids.aptB}/pricing`, { monthlyRent: 1 })).status).toBe(404);
  });

  it("5. Tenants cannot create properties", async () => {
    const r = await call("tenant", "POST", "/properties", { propertyTypeKey: "APARTMENT" });
    expect(r.status).toBe(403);
    expect(r.json.errorCode).toBe("FORBIDDEN");
  });

  it("multi-role: a tenant who adds the LANDLORD role can list a property", async () => {
    expect((await call("tenant2", "POST", "/me/roles", { role: "LANDLORD" })).status).toBe(201);
    const r = await call("tenant2", "POST", "/properties", { propertyTypeKey: "INDIVIDUAL_HOUSE", title: "Tenant2 house" });
    expect(r.status).toBe(201);
    expect((await call("tenant2", "POST", "/me/roles", { role: "ADMIN" })).status).toBe(403);
  });

  it("7. Apartment: one building, many flats, no repeated building details", async () => {
    const patch = await call("landlordA", "PATCH", `/properties/${ids.aptA}`, {
      description: "Spacious, well-ventilated flats close to the Madhapur metro station and IT parks.",
      addressLine: "Plot 12, Road 5",
      locality: "Madhapur",
      city: "Hyderabad",
      state: "Telangana",
      pincode: "500081",
      latitude: 17.44,
      longitude: 78.39,
      building: { name: "Green Valley Apartments", totalFloors: 5, totalUnits: 40, liftAvailable: "YES", securityAvailable: "YES", parkingAvailable: "NOT_DISCLOSED" },
    });
    expect(patch.status).toBe(200);
    const flat = (n: string, floor: number, bhk: string, rent: number) => ({ unitNumber: n, floorNumber: floor, bhkType: bhk, bedrooms: Number(bhk[0]), bathrooms: 2, furnishing: "SEMI_FURNISHED", availabilityStatus: "AVAILABLE", pricing: { monthlyRent: rent, securityDeposit: rent * 3 } });
    const bulk = await call("landlordA", "POST", `/properties/${ids.aptA}/units/bulk`, { units: [flat("101", 1, "1BHK", 15000), flat("102", 1, "2BHK", 22000), flat("201", 2, "3BHK", 30000)] });
    expect(bulk.status).toBe(201);
    expect(bulk.json.data.units).toHaveLength(3);
    for (const u of bulk.json.data.units) expect(u.code).toMatch(/^SR-UNIT-\d{6}$/);
    ids.flat101 = bulk.json.data.units[0].id;
    expect((await call("landlordA", "POST", `/properties/${ids.aptA}/units`, flat("101", 1, "1BHK", 15000))).status).toBe(409);
    const detail = await call("landlordA", "GET", `/properties/${ids.aptA}`);
    expect(detail.json.data.property.units).toHaveLength(3);
    expect(detail.json.data.property.rentFrom).toBe("15000");
    expect(await prisma.property.count({ where: { ownerId: ids.landlordA, propertyTypeKey: "APARTMENT" } })).toBe(1);
  });

  it("8. Villa: configuration + standalone villa allows exactly one villa", async () => {
    const r = await call("landlordA", "POST", "/properties", { propertyTypeKey: "VILLA", title: "Lake view villa" });
    const id = r.json.data.property.id;
    await call("landlordA", "PATCH", `/properties/${id}`, { building: { villaListing: "STANDALONE", name: "Lake View" } });
    const villa = await call("landlordA", "POST", `/properties/${id}/units`, { unitNumber: "V1", configuration: "B+G+1", basementAvailable: "YES", bedrooms: 4, bathrooms: 4, furnishing: "FULLY_FURNISHED", availabilityStatus: "AVAILABLE" });
    expect(villa.status).toBe(201);
    expect(villa.json.data.unit.code).toMatch(/^SR-VILLA-\d{6}$/);
    expect(villa.json.data.unit.attributes.basementAvailable).toBe("YES");
    expect((await call("landlordA", "POST", `/properties/${id}/units`, { unitNumber: "V2", configuration: "G" })).status).toBe(412);
    expect((await call("landlordA", "POST", `/properties/${id}/units`, { unitNumber: "V3", configuration: "G+7" })).status).toBe(400);
  });

  it("9. Individual house is one record with exactly one unit", async () => {
    const r = await call("landlordA", "POST", "/properties", { propertyTypeKey: "INDIVIDUAL_HOUSE", title: "Independent house" });
    const id = r.json.data.property.id;
    expect(r.json.data.property.units).toHaveLength(1);
    const unitId = r.json.data.property.units[0].id;
    expect((await call("landlordA", "POST", `/properties/${id}/units`, { unitNumber: "2" })).status).toBe(412);
    const upd = await call("landlordA", "PATCH", `/properties/${id}/units/${unitId}`, { unitNumber: "12-3", bedrooms: 3, bathrooms: 2, waterFacilities: "Municipal + borewell", furnishing: "UNFURNISHED", availabilityStatus: "AVAILABLE" });
    expect(upd.status).toBe(200);
    expect(upd.json.data.unit.attributes.waterFacilities).toBe("Municipal + borewell");
  });

  it("10. Duplex floor-wise details", async () => {
    const r = await call("landlordA", "POST", "/properties", { propertyTypeKey: "DUPLEX_HOUSE", title: "Duplex" });
    const id = r.json.data.property.id;
    const unitId = r.json.data.property.units[0].id;
    await call("landlordA", "PATCH", `/properties/${id}/units/${unitId}`, { configuration: "G+1", totalFloors: 2 });
    expect((await call("landlordA", "PUT", `/properties/${id}/units/${unitId}/floors`, { floors: [{ floorNumber: 0, bedrooms: 1 }] })).status).toBe(400);
    const ok = await call("landlordA", "PUT", `/properties/${id}/units/${unitId}/floors`, { floors: [{ floorNumber: 0, bedrooms: 1, bathrooms: 1, kitchens: 1, livingRooms: 1 }, { floorNumber: 1, bedrooms: 2, bathrooms: 2, balconies: 1 }] });
    expect(ok.status).toBe(200);
    expect(ok.json.data.unit.floors).toHaveLength(2);
    expect(ok.json.data.unit.bedrooms).toBe(3);
  });

  it("11 & 12. PG rooms and beds; a bed can never get two active tenants", async () => {
    const r = await call("landlordA", "POST", "/properties", { propertyTypeKey: "PG", title: "SafeStay PG" });
    const id = r.json.data.property.id;
    const room = await call("landlordA", "POST", `/properties/${id}/rooms`, { roomNumber: "203", floorNumber: 2, sharingType: "DOUBLE", rentPerBed: 7000, availabilityStatus: "AVAILABLE" });
    expect(room.status).toBe(201);
    expect(room.json.data.room.beds.map((b: { bedNumber: string }) => b.bedNumber)).toEqual(["B1", "B2"]);
    const roomId = room.json.data.room.id;
    expect((await call("landlordA", "POST", `/properties/${id}/rooms/${roomId}/beds`, { bedNumber: "B3" })).status).toBe(412);
    const bedId = room.json.data.room.beds[0].id;
    const [a, b] = await Promise.all([
      call("landlordA", "POST", `/properties/${id}/rooms/${roomId}/beds/${bedId}/assign`, { tenantId: ids.tenant }),
      call("landlordA", "POST", `/properties/${id}/rooms/${roomId}/beds/${bedId}/assign`, { tenantId: ids.tenant2 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const detail = await call("landlordA", "GET", `/properties/${id}`);
    expect(detail.json.data.property.availableCount).toBe(1);
    expect(detail.json.data.property.occupiedCount).toBe(1);
  });

  it("13. Utility validation rejects contradictions", async () => {
    const bad = await call("landlordA", "PUT", `/properties/${ids.aptA}/utilities`, { electricityBillingType: "INCLUDED_IN_RENT", electricityIncludedInRent: "NO" });
    expect(bad.status).toBe(400);
    expect(bad.json.errorCode).toBe("VALIDATION_ERROR");
    const ok = await call("landlordA", "PUT", `/properties/${ids.aptA}/utilities`, {
      separateElectricityMeter: "YES", electricityBillingType: "ACTUAL_BILL", electricityRatePerUnit: 8, meterPaymentType: "POSTPAID", electricityIncludedInRent: "NO",
      separateWaterMeter: "NO", waterSupplyType: "MUNICIPAL", waterChargesType: "FIXED_MONTHLY", waterChargesAmount: 300, waterIncludedInRent: "NO",
      gasConnectionType: "PIPED", internetAvailable: "NOT_DISCLOSED", powerBackup: "YES", generatorAvailable: "YES", sewageFacilities: "YES", wasteCollection: "YES",
    });
    expect(ok.status).toBe(200);
    expect(ok.json.data.utilities.internetAvailable).toBe("NOT_DISCLOSED");
  });

  it("14. Guest policy validation", async () => {
    expect((await call("landlordA", "PUT", `/properties/${ids.aptA}/policies`, { guestsAllowed: "NO", overnightGuestsAllowed: "YES" })).status).toBe(400);
    const ok = await call("landlordA", "PUT", `/properties/${ids.aptA}/policies`, {
      guestsAllowed: "YES", overnightGuestsAllowed: "YES", maximumGuestStayDays: 3, guestRegistrationRequired: "YES", landlordApprovalRequired: "NO", guestParkingAvailable: "NO", guestChargesApplicable: "NO",
      petsAllowed: "NO", smokingAllowed: "NO", partiesAllowed: "NO", cookingAllowed: "YES", sublettingAllowed: "NO", workFromHomeAllowed: "YES",
      additionalRules: [{ title: "Quiet hours", description: "No loud music after 10 PM." }],
    });
    expect(ok.status).toBe(200);
  });

  it("15. Rent and deposit validation + itemised charges", async () => {
    expect((await call("landlordA", "PUT", `/properties/${ids.aptA}/pricing`, { monthlyRent: 0 })).status).toBe(400);
    expect((await call("landlordA", "PUT", `/properties/${ids.aptA}/pricing`, { salePrice: 5000000 })).status).toBe(400);
    const ok = await call("landlordA", "PUT", `/properties/${ids.aptA}/pricing`, {
      securityDeposit: 66000, rentDueDay: 5, lockInPeriodMonths: 6, noticePeriodDays: 30, agreementChargesPaidBy: "SHARED",
      charges: [{ kind: "MAINTENANCE", billing: "FIXED_MONTHLY", amount: 2500 }, { kind: "PARKING", billing: "NOT_DISCLOSED" }],
    });
    expect(ok.status).toBe(200);
    expect(ok.json.data.breakdown.notDisclosed.map((l: { kind: string }) => l.kind)).toContain("PARKING");
  });

  it("concurrent updates: a stale version gets 409", async () => {
    const current = (await call("landlordA", "GET", `/properties/${ids.aptA}`)).json.data.property;
    expect((await call("landlordA", "PATCH", `/properties/${ids.aptA}`, { version: current.version, wizardStep: 6 })).status).toBe(200);
    const stale = await call("landlordA", "PATCH", `/properties/${ids.aptA}`, { version: current.version, title: "Stale edit" });
    expect(stale.status).toBe(409);
    expect(stale.json.errorCode).toBe("CONFLICT");
  });

  it("16. Readable IDs are unique under concurrent creation", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => call("landlordB", "POST", "/properties", { propertyTypeKey: "SHOP", title: `Shop ${i}` })));
    const codes = results.map((r) => r.json.data.property.code);
    expect(new Set(codes).size).toBe(6);
  });

  it("17. Draft → submit → verify → publish", async () => {
    const early = await call("landlordA", "POST", `/properties/${ids.aptA}/submit`);
    expect(early.status).toBe(412);
    expect(early.json.details.problems).toContain("Add at least one photo.");
    const form = new FormData();
    form.append("category", "FRONT_VIEW");
    form.append("files", new Blob([PNG], { type: "image/png" }), "front.png");
    const upload = await call("landlordA", "POST", `/properties/${ids.aptA}/images`, form);
    expect(upload.status).toBe(201);
    const fake = new FormData();
    fake.append("files", new Blob([new TextEncoder().encode("<script>")], { type: "image/png" }), "evil.png");
    expect((await call("landlordA", "POST", `/properties/${ids.aptA}/images`, fake)).status).toBe(400);

    expect((await call("landlordA", "POST", `/properties/${ids.aptA}/submit`)).status).toBe(200);
    expect((await call("landlordA", "PATCH", `/properties/${ids.aptA}`, { title: "Edit while pending" })).status).toBe(412);
    expect((await call("landlordA", "POST", `/properties/${ids.aptA}/publish`)).status).toBe(412);
    expect((await call("landlordA", "POST", `/properties/${ids.aptA}/review`, { decision: "APPROVE" })).status).toBe(403);
    expect((await call("admin", "POST", `/properties/${ids.aptA}/review`, { decision: "REJECT" })).status).toBe(400);
    // Owner verification gate: unverified owner → 412; then verified owner but no verified ownership proof → 412.
    expect((await call("admin", "POST", `/properties/${ids.aptA}/review`, { decision: "APPROVE" })).status).toBe(412);
    await prisma.landlordProfile.upsert({ where: { userId: ids.landlordA }, create: { userId: ids.landlordA, kycStatus: "APPROVED" }, update: { kycStatus: "APPROVED" } });
    expect((await call("admin", "POST", `/properties/${ids.aptA}/review`, { decision: "APPROVE" })).status).toBe(412);
    await prisma.propertyDocument.create({ data: { code: "DOC-TEST-OWN1", propertyId: ids.aptA, docType: "SALE_DEED", filePath: "documents/test.pdf", originalName: "deed.pdf", mimeType: "application/pdf", uploadedById: ids.landlordA, status: "APPROVED", needsVerification: true } });
    const approved = await call("admin", "POST", `/properties/${ids.aptA}/review`, { decision: "APPROVE" });
    expect(approved.status).toBe(200);
    expect(approved.json.data.property.verificationStatus).toBe("VERIFIED");
    const published = await call("landlordA", "POST", `/properties/${ids.aptA}/publish`);
    expect(published.json.data.property.publicationStatus).toBe("PUBLISHED");

    const browse = await call("tenant", "GET", "/browse?city=Hyderabad");
    expect(browse.json.data.map((x: { id: string }) => x.id)).toContain(ids.aptA);
    const listing = await call("tenant", "GET", `/browse/${ids.aptA}`);
    expect(listing.json.data.property.ownerId).toBeUndefined();
    expect(listing.json.data.property.utilities.meterNumber).toBeUndefined();
    expect(listing.json.data.property.policy.petsAllowed).toBe("NO");
    // Super Admin cannot verify their own property.
    expect((await call("super", "POST", `/properties/${ids.superProperty}/review`, { decision: "APPROVE" })).status).toBe(403);
  });

  it("tenants apply for a specific available flat; approval occupies it", async () => {
    const apply = await call("tenant", "POST", `/browse/${ids.aptA}/apply`, { unitId: ids.flat101, proposedMoveIn: "2026-12-01", occupants: 2 });
    expect(apply.status).toBe(201);
    const decision = await call("landlordA", "POST", `/applications/${apply.json.data.application.id}/decision`, { decision: "APPROVE" });
    expect(decision.status).toBe(200);
    expect(decision.json.data.leaseCode).toMatch(/^SR-LEASE-\d{6}$/);
    const unit = await prisma.propertyUnit.findUniqueOrThrow({ where: { id: ids.flat101 } });
    expect(unit.availabilityStatus).toBe("OCCUPIED");
    expect((await call("tenant2", "POST", `/browse/${ids.aptA}/apply`, { unitId: ids.flat101, proposedMoveIn: "2026-12-01" })).status).toBe(412);
  });

  it("18. Status changes are permission-checked and recorded", async () => {
    expect((await call("landlordB", "POST", `/properties/${ids.aptB}/status`, { activeStatus: "SUSPENDED", reason: "Testing suspension" })).status).toBe(412);
    const suspended = await call("admin", "POST", `/properties/${ids.aptB}/status`, { activeStatus: "SUSPENDED", reason: "Suspicious listing" });
    expect(suspended.status).toBe(200);
    expect(suspended.json.data.property.activeStatus).toBe("SUSPENDED");
    const history = await call("landlordB", "GET", `/properties/${ids.aptB}/status-history`);
    expect(history.json.data.some((h: { field: string; toValue: string }) => h.field === "activeStatus" && h.toValue === "SUSPENDED")).toBe(true);
    expect((await call("landlordB", "PATCH", `/properties/${ids.aptB}`, { title: "Edit while suspended" })).status).toBe(412);
  });

  it("19. Audit logs record who changed what, from which platform", async () => {
    const audit = await call("landlordA", "GET", `/properties/${ids.aptA}/audit?pageSize=100`);
    const actions = audit.json.data.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["property.create", "pricing.update", "utilities.update", "policies.update", "status.publicationStatus", "verification.approve"]));
    expect(audit.json.data.every((a: { sourcePlatform: string }) => a.sourcePlatform === "ANDROID")).toBe(true);
    expect(JSON.stringify(audit.json.data)).not.toMatch(/t-landlordA/);
    // No API can modify the audit trail.
    expect((await call("super", "DELETE", `/properties/${ids.aptA}/audit`)).status).toBe(404);
  });

  it("20. Private documents are only visible to the owner, assigned staff and verifiers", async () => {
    const form = new FormData();
    form.append("docType", "OWNERSHIP_PROOF");
    form.append("file", new Blob([PDF], { type: "application/pdf" }), "deed.pdf");
    const property = await createApartment("landlordB", "Documents test");
    const up = await call("landlordB", "POST", `/properties/${property.id}/documents`, form);
    expect(up.status).toBe(201);
    const docId = up.json.data.document.id;
    expect(up.json.data.document.code).toMatch(/^SR-DOC-\d{6}$/);
    const get = (who: string) => fetch(`${base}/api/v1/files/documents/${docId}`, { headers: { Authorization: `Bearer t-${who}` } }).then((r) => r.status);
    expect(await get("landlordB")).toBe(200);
    expect(await get("tenant")).toBe(404);
    expect(await get("landlordA")).toBe(404);
    expect(await get("manager")).toBe(404);
    expect(await get("admin")).toBe(200);
    expect((await call("landlordB", "POST", `/documents/${docId}/verify`, { status: "APPROVED" })).status).toBe(403);
    expect((await call("admin", "POST", `/documents/${docId}/verify`, { status: "APPROVED" })).status).toBe(200);
  });

  it("property managers only work on assigned properties and cannot transfer ownership", async () => {
    expect((await call("manager", "GET", `/properties/${ids.aptA}`)).status).toBe(404);
    expect((await call("admin", "POST", `/properties/${ids.aptA}/assignments`, { userId: ids.manager, type: "MANAGER" })).status).toBe(201);
    expect((await call("manager", "GET", `/properties/${ids.aptA}`)).status).toBe(200);
    expect((await call("manager", "POST", `/properties/${ids.aptA}/transfer-ownership`, { newOwnerId: ids.landlordB, reason: "Not allowed" })).status).toBe(403);
  });
});
