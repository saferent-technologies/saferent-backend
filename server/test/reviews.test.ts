import { describe, expect, it } from "vitest";
import { canEditResponse, contentProblem, isPublic, publicName, ratingStats, reviewEligibility, reviewerRoleOf, sanitizeText, shouldPublish, windowClosesAt } from "../src/lib/reviews";

const DAY = 86_400_000;
const now = new Date("2026-11-10T10:00:00Z");
const ended = new Date(now.getTime() - 3 * DAY);
const lease = { tenantId: "tenant", landlordId: "landlord", status: "TERMINATED", startDate: new Date("2026-01-01"), endedAt: ended };
const opts = { windowDays: 14, alreadyReviewed: false, now };

describe("review eligibility", () => {
  it("the tenant can review the landlord after the lease ends", () => {
    expect(reviewEligibility(lease, "tenant", opts)).toMatchObject({ eligible: true, role: "TENANT" });
  });
  it("the landlord can review the tenant after the lease ends", () => {
    expect(reviewEligibility(lease, "landlord", opts)).toMatchObject({ eligible: true, role: "LANDLORD" });
  });
  it("an unrelated user can't review", () => {
    expect(reviewEligibility(lease, "stranger", opts)).toEqual({ eligible: false, reason: "NOT_A_PARTY" });
  });
  it("a duplicate review is rejected", () => {
    expect(reviewEligibility(lease, "tenant", { ...opts, alreadyReviewed: true })).toEqual({ eligible: false, reason: "ALREADY_REVIEWED" });
  });
  it("an active lease can't be reviewed yet", () => {
    expect(reviewEligibility({ ...lease, status: "ACTIVE", endedAt: null }, "tenant", opts)).toEqual({ eligible: false, reason: "NOT_FINISHED" });
  });
  it("a lease cancelled before it started has no rental experience", () => {
    expect(reviewEligibility({ ...lease, startDate: new Date(now.getTime() + DAY), endedAt: ended }, "tenant", opts)).toEqual({ eligible: false, reason: "NO_RENTAL_EXPERIENCE" });
  });
  it("closes after the review window", () => {
    expect(reviewEligibility({ ...lease, endedAt: new Date(now.getTime() - 15 * DAY) }, "tenant", opts)).toEqual({ eligible: false, reason: "WINDOW_CLOSED" });
  });
  it("no self-reviews when one account is both tenant and landlord", () => {
    expect(reviewerRoleOf({ tenantId: "x", landlordId: "x" }, "x")).toBeNull();
  });
});

describe("double-blind publication", () => {
  const closesAt = windowClosesAt(ended, 14);
  it("waits while only one side has submitted and the window is open", () => {
    expect(shouldPublish({ tenantSubmitted: true, landlordSubmitted: false, closesAt, now })).toBe(false);
  });
  it("publishes both together once both have submitted", () => {
    expect(shouldPublish({ tenantSubmitted: true, landlordSubmitted: true, closesAt, now })).toBe(true);
  });
  it("publishes the one submitted review after the window closes", () => {
    expect(shouldPublish({ tenantSubmitted: false, landlordSubmitted: true, closesAt, now: new Date(closesAt.getTime() + 1) })).toBe(true);
  });
  it("publishes nothing when nobody reviewed", () => {
    expect(shouldPublish({ tenantSubmitted: false, landlordSubmitted: false, closesAt, now: new Date(closesAt.getTime() + DAY) })).toBe(false);
  });
  it("only published or flagged reviews are public", () => {
    expect(["SUBMITTED", "PUBLISHED", "FLAGGED", "REMOVED", "REJECTED"].map(isPublic)).toEqual([false, true, true, false, false]);
  });
});

describe("rating calculation", () => {
  it("averages published overall ratings with one decimal, plus categories and distribution", () => {
    const s = ratingStats([
      { overallRating: 5, categoryRatings: { overall: 5, maintenance: 4 } },
      { overallRating: 4, categoryRatings: { overall: 4, maintenance: 2 } },
      { overallRating: 2, categoryRatings: { overall: 2 } },
    ]);
    expect(s.average).toBe(3.7);
    expect(s.count).toBe(3);
    expect(s.distribution).toEqual({ "1": 0, "2": 1, "3": 0, "4": 1, "5": 1 });
    expect(s.categories.maintenance).toEqual({ average: 3, count: 2 });
  });
  it("is null with no reviews", () => {
    expect(ratingStats([]).average).toBeNull();
  });
  it("doesn't depend on order", () => {
    const rows = [1, 2, 3, 4, 5, 5, 4].map((n) => ({ overallRating: n, categoryRatings: null }));
    expect(ratingStats(rows).average).toBe(ratingStats([...rows].reverse()).average);
  });
});

describe("content and privacy", () => {
  it("rejects phone numbers, emails and links", () => {
    expect(contentProblem("call me on +91 79951 53536")).toMatch(/phone/);
    expect(contentProblem("mail ravi@example.com")).toMatch(/email/);
    expect(contentProblem("see www.example.com")).toMatch(/Links/);
    expect(contentProblem("Great landlord, fixed the geyser in 2 days.")).toBeNull();
  });
  it("strips control characters", () => {
    expect(sanitizeText("  hi\u0000 there\n\n\n\nok ")).toBe("hi there\n\nok");
  });
  it("shows only first name and last initial", () => {
    expect(publicName("Shaik Shabeer")).toBe("Shaik S.");
    expect(publicName("Ravi")).toBe("Ravi");
  });
  it("allows editing a reply only for 48 hours", () => {
    expect(canEditResponse(new Date(now.getTime() - 47 * 3600_000), now)).toBe(true);
    expect(canEditResponse(new Date(now.getTime() - 49 * 3600_000), now)).toBe(false);
  });
});
