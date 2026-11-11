import { describe, expect, it } from "vitest";
import { documentName, documentState, leaseCovers, needsVerification, tenantCanSee } from "../src/lib/documentAccess";

const base = { propertyId: "P", unitId: null, roomId: null, bedId: null, sharedWithTenant: true, isCurrent: true, archivedAt: null };
const flat102 = { propertyId: "P", unitId: "U102", bedId: null, roomId: null, status: "ACTIVE" };
const flat101 = { propertyId: "P", unitId: "U101", bedId: null, roomId: null, status: "ACTIVE" };
const bedB1 = { propertyId: "P", unitId: null, bedId: "B1", roomId: "R203", status: "ACTIVE" };

describe("tenant document access", () => {
  it("property-level shared documents reach every active tenant of that property", () => {
    expect(tenantCanSee(base, [flat102])).toBe(true);
    expect(tenantCanSee(base, [bedB1])).toBe(true);
  });
  it("a flat's document reaches only that flat's tenant", () => {
    const doc = { ...base, unitId: "U102" };
    expect(tenantCanSee(doc, [flat102])).toBe(true);
    expect(tenantCanSee(doc, [flat101])).toBe(false);
  });
  it("PG room documents reach tenants of beds in that room; bed documents only that bed", () => {
    expect(tenantCanSee({ ...base, roomId: "R203" }, [bedB1])).toBe(true);
    expect(tenantCanSee({ ...base, roomId: "R204" }, [bedB1])).toBe(false);
    expect(tenantCanSee({ ...base, bedId: "B1" }, [bedB1])).toBe(true);
    expect(tenantCanSee({ ...base, bedId: "B2" }, [bedB1])).toBe(false);
  });
  it("private, old-version, archived or other-property documents are never visible", () => {
    expect(tenantCanSee({ ...base, sharedWithTenant: false }, [flat102])).toBe(false);
    expect(tenantCanSee({ ...base, isCurrent: false }, [flat102])).toBe(false);
    expect(tenantCanSee({ ...base, archivedAt: new Date() }, [flat102])).toBe(false);
    expect(tenantCanSee({ ...base, propertyId: "Q" }, [flat102])).toBe(false);
  });
  it("an ended lease gives no access", () => {
    expect(leaseCovers(base, { ...flat102, status: "TERMINATED" })).toBe(false);
    expect(tenantCanSee(base, [])).toBe(false);
  });
});

describe("document helpers", () => {
  it("names custom documents by their custom name", () => {
    expect(documentName({ docType: "OTHER", customName: "Parking Allotment Letter" })).toBe("Parking Allotment Letter");
    expect(documentName({ docType: "RENTAL_AGREEMENT", customName: null })).toBe("Rental agreement");
  });
  it("only ownership documents need SafeRent verification", () => {
    expect(needsVerification("OWNERSHIP_PROOF")).toBe(true);
    expect(needsVerification("RENTAL_AGREEMENT")).toBe(false);
    expect(needsVerification("OTHER")).toBe(false);
  });
  it("shows expired / verified / active", () => {
    const now = new Date(2026, 10, 10);
    expect(documentState({ expiryDate: new Date(2026, 0, 1), status: "APPROVED", needsVerification: true }, now)).toBe("EXPIRED");
    expect(documentState({ expiryDate: null, status: "APPROVED", needsVerification: true }, now)).toBe("VERIFIED");
    expect(documentState({ expiryDate: null, status: "PENDING", needsVerification: false }, now)).toBe("ACTIVE");
  });
});
