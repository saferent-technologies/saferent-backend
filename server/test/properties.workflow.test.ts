import { describe, expect, it } from "vitest";
import { formatCode, nextCode, nextCodes } from "../src/properties/ids";
import { canChangeActiveStatus, canEditContent, canPublish, canReview, canSubmit, canUnpublish, publicationAfterEdit } from "../src/properties/workflow";
import { bedCapacity } from "../src/properties/bedCapacity";
import { diff, sanitize } from "../src/properties/diff";

describe("draft → verification → publish workflow", () => {
  const draft = { activeStatus: "ACTIVE", publicationStatus: "DRAFT" } as const;
  it("drafts and rejected properties can be submitted; others cannot", () => {
    expect(canSubmit(draft).ok).toBe(true);
    expect(canSubmit({ ...draft, publicationStatus: "REJECTED" }).ok).toBe(true);
    expect(canSubmit({ ...draft, publicationStatus: "PENDING_VERIFICATION" }).ok).toBe(false);
    expect(canSubmit({ ...draft, publicationStatus: "PUBLISHED" }).ok).toBe(false);
    expect(canSubmit({ ...draft, activeStatus: "SUSPENDED" }).ok).toBe(false);
  });
  it("only pending properties can be reviewed and only approved ones published", () => {
    expect(canReview(draft).ok).toBe(false);
    expect(canReview({ ...draft, publicationStatus: "PENDING_VERIFICATION" }).ok).toBe(true);
    expect(canPublish(draft).ok).toBe(false);
    expect(canPublish({ ...draft, publicationStatus: "PENDING_VERIFICATION" }).ok).toBe(false);
    expect(canPublish({ ...draft, publicationStatus: "APPROVED" }).ok).toBe(true);
    expect(canPublish({ activeStatus: "INACTIVE", publicationStatus: "APPROVED" }).ok).toBe(false);
    expect(canUnpublish({ ...draft, publicationStatus: "PUBLISHED" }).ok).toBe(true);
  });
  it("material edits of a published listing require re-verification; other edits do not", () => {
    const published = { activeStatus: "ACTIVE", publicationStatus: "PUBLISHED" } as const;
    expect(publicationAfterEdit(published, ["title"])).toBe("PENDING_VERIFICATION");
    expect(publicationAfterEdit(published, ["building"])).toBe("PENDING_VERIFICATION");
    expect(publicationAfterEdit(published, ["wizardStep"])).toBe("PUBLISHED");
    expect(publicationAfterEdit(draft, ["title"])).toBe("DRAFT");
  });
  it("locks content while pending, suspended (for owners) or archived", () => {
    expect(canEditContent({ ...draft, publicationStatus: "PENDING_VERIFICATION" }, false).ok).toBe(false);
    expect(canEditContent({ ...draft, activeStatus: "SUSPENDED" }, false).ok).toBe(false);
    expect(canEditContent({ ...draft, activeStatus: "SUSPENDED" }, true).ok).toBe(true);
    expect(canEditContent({ ...draft, activeStatus: "ARCHIVED" }, true).ok).toBe(false);
  });
});

describe("active status changes", () => {
  const owner = { isModerator: false, isAdmin: false };
  const moderator = { isModerator: true, isAdmin: false };
  const admin = { isModerator: true, isAdmin: true };
  it("only moderators suspend and lift suspensions", () => {
    expect(canChangeActiveStatus("ACTIVE", "SUSPENDED", owner, false).ok).toBe(false);
    expect(canChangeActiveStatus("ACTIVE", "SUSPENDED", moderator, false).ok).toBe(true);
    expect(canChangeActiveStatus("SUSPENDED", "ACTIVE", owner, false).ok).toBe(false);
    expect(canChangeActiveStatus("SUSPENDED", "ACTIVE", moderator, false).ok).toBe(true);
  });
  it("blocks archiving / deactivating with active leases and restoring without admin rights", () => {
    expect(canChangeActiveStatus("ACTIVE", "ARCHIVED", owner, true).ok).toBe(false);
    expect(canChangeActiveStatus("ACTIVE", "INACTIVE", owner, true).ok).toBe(false);
    expect(canChangeActiveStatus("ACTIVE", "ARCHIVED", owner, false).ok).toBe(true);
    expect(canChangeActiveStatus("ARCHIVED", "ACTIVE", owner, false).ok).toBe(false);
    expect(canChangeActiveStatus("ARCHIVED", "ACTIVE", admin, false).ok).toBe(true);
    expect(canChangeActiveStatus("ACTIVE", "ACTIVE", admin, false).ok).toBe(false);
  });
});

/** In-memory stand-in for the MySQL counter: INSERT … ON DUPLICATE KEY UPDATE is atomic per statement. */
function fakeDb() {
  const counters = new Map<string, bigint>();
  // Row lock: taken by the upsert, released when the transaction reads its value and commits.
  let lock: Promise<void> = Promise.resolve();
  /** One transaction per call, like prisma.$transaction(tx => nextCode(tx, …)). */
  return () => {
    let release: () => void = () => undefined;
    const tx = {
      $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
        const previous = lock;
        lock = new Promise<void>((r) => (release = r));
        await previous;
        const name = String(values[0]);
        // nextCode: VALUES (prefix, 1) … value + 1  → [prefix]; nextCodes: VALUES (prefix, n) … value + n → [prefix, n, n]
        const n = BigInt(values.length >= 3 ? Number(values[2]) : 1);
        counters.set(name, counters.has(name) ? counters.get(name)! + n : n);
        return 1;
      },
      $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
        await new Promise((r) => setTimeout(r, Math.random() * 3));
        const value = counters.get(String(values[0]))!;
        release();
        return [{ value }];
      },
    };
    return tx as unknown as Parameters<typeof nextCode>[0];
  };
}

describe("readable unique ids", () => {
  it("formats SR codes with 6+ digits", () => {
    expect(formatCode("SR-PROP", 1)).toBe("SR-PROP-000001");
    expect(formatCode("SR-BED", 1234567)).toBe("SR-BED-1234567");
    expect(() => formatCode("SR-PROP", 0)).toThrow();
  });
  it("generates sequential codes per prefix from the backend counter", async () => {
    const tx = fakeDb();
    expect(await nextCode(tx(), "SR-PROP")).toBe("SR-PROP-000001");
    expect(await nextCode(tx(), "SR-PROP")).toBe("SR-PROP-000002");
    expect(await nextCode(tx(), "SR-UNIT")).toBe("SR-UNIT-000001");
    expect(await nextCodes(tx(), "SR-UNIT", 3)).toEqual(["SR-UNIT-000002", "SR-UNIT-000003", "SR-UNIT-000004"]);
    expect(await nextCode(tx(), "SR-UNIT")).toBe("SR-UNIT-000005");
  });
  it("never hands out the same code twice under concurrency", async () => {
    const tx = fakeDb();
    const codes = await Promise.all(Array.from({ length: 50 }, () => nextCode(tx(), "SR-BED")));
    expect(new Set(codes).size).toBe(50);
  });
});

describe("beds and audit helpers", () => {
  it("derives bed capacity from the sharing type", () => {
    expect(bedCapacity({ sharingType: "SINGLE" })).toBe(1);
    expect(bedCapacity({ sharingType: "FOUR_SHARING" })).toBe(4);
    expect(bedCapacity({ sharingType: "CUSTOM", customSharing: 6 })).toBe(6);
  });
  it("records only changed fields and strips secrets", () => {
    expect(diff({ monthlyRent: "20000.00", city: "Hyderabad" }, { monthlyRent: "22000.00", city: "Hyderabad" })).toEqual({ old: { monthlyRent: "20000.00" }, new: { monthlyRent: "22000.00" } });
    expect(sanitize({ ok: 1, idToken: "abc", otpCode: "123456", nested: { password: "x", keep: true } })).toEqual({ ok: 1, nested: { keep: true } });
  });
});
