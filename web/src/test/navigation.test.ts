import { describe, expect, it } from "vitest";
import { visibleNavigation } from "@/routes/navigation";

const canFrom = (perms: string[]) => (p: string) => perms.includes(p);
const paths = (perms: string[], role: string) => visibleNavigation(canFrom(perms), role).flatMap((g) => g.items.map((i) => i.to));

describe("role-based navigation", () => {
  it("tenants see tenant pages only", () => {
    const p = paths(["dashboard.view", "notifications.view", "properties.browse", "applications.create", "applications.view", "leases.view", "rent.view", "rent.pay", "maintenance.create", "maintenance.view", "support.create"], "TENANT");
    expect(p).toEqual(expect.arrayContaining(["/dashboard", "/browse", "/applications", "/leases", "/rent", "/maintenance", "/support", "/profile", "/settings"]));
    for (const hidden of ["/users", "/roles", "/finance", "/moderation", "/audit", "/platform", "/properties"]) expect(p).not.toContain(hidden);
  });

  it("finance admins see finance but not user or role management", () => {
    const p = paths(["dashboard.view", "rent.view", "rent.collect", "payments.view", "refunds.manage", "finance.reports", "reports.view"], "FINANCE_ADMIN");
    expect(p).toEqual(expect.arrayContaining(["/rent", "/finance", "/reports"]));
    expect(p).not.toContain("/users");
    expect(p).not.toContain("/roles");
  });

  it("service providers only see their jobs", () => {
    const p = paths(["dashboard.view", "maintenance.view", "maintenance.work", "support.create"], "SERVICE_PROVIDER");
    expect(p).toEqual(["/dashboard", "/maintenance", "/support", "/profile", "/settings"]);
  });

  it("labels adapt to the role", () => {
    const groups = visibleNavigation(canFrom(["properties.view"]), "LANDLORD");
    expect(groups.flatMap((g) => g.items).find((i) => i.to === "/properties")?.label).toBe("My properties");
  });
});
