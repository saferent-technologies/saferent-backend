import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextValue } from "@/contexts/AuthContext";
import { PortalGuard, ProtectedRoute, SecondFactorRoute } from "@/routes/guards";
import type { AdminProfile, RoleInfo } from "@/types/auth";

let mockAuth: Partial<AuthContextValue>;
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

const profile = { id: "u1", fullName: "Shaik Shabeer", role: "SUPER_ADMIN", accountStatus: "ACTIVE", mustChangePassword: false } as unknown as AdminProfile;
const staffRole = { key: "SUPER_ADMIN", name: "Super Admin", isStaff: true } as unknown as RoleInfo;
const tenantRole = { key: "TENANT", name: "Tenant", isStaff: false } as unknown as RoleInfo;

// Declarative <MemoryRouter> avoids jsdom/undici AbortSignal issues of data routers in tests.
function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<p>customer login page</p>} />
        <Route path="/employee" element={<p>employee login page</p>} />
        <Route element={<SecondFactorRoute />}>
          <Route path="/employee/verify-otp" element={<p>otp page</p>} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route element={<PortalGuard portal="customer" />}>
            <Route path="/dashboard" element={<p>customer dashboard</p>} />
            <Route path="/settings" element={<p>customer settings</p>} />
          </Route>
          <Route element={<PortalGuard portal="employee" />}>
            <Route path="/employee/dashboard" element={<p>employee dashboard</p>} />
            <Route path="/employee/settings" element={<p>employee settings</p>} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("route protection", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockAuth = { status: "signed_out", profile: null, loginFlowActive: false, activeRole: null };
  });

  it("sends signed-out customers to the customer login", async () => {
    renderAt("/dashboard");
    expect(await screen.findByText("customer login page")).toBeInTheDocument();
  });

  it("sends signed-out employees to the employee login", async () => {
    renderAt("/employee/dashboard");
    expect(await screen.findByText("employee login page")).toBeInTheDocument();
  });

  it("denies unauthorized users", async () => {
    mockAuth = { status: "unauthorized", profile: null, activeRole: null };
    renderAt("/dashboard");
    expect(await screen.findByText("customer login page")).toBeInTheDocument();
  });

  it("requires the second factor before the dashboard", async () => {
    mockAuth = { status: "awaiting_second_factor", profile: null, activeRole: null };
    renderAt("/employee/dashboard");
    expect(await screen.findByText("otp page")).toBeInTheDocument();
  });

  it("keeps signed-out users away from the OTP page", async () => {
    renderAt("/employee/verify-otp");
    expect(await screen.findByText("employee login page")).toBeInTheDocument();
  });

  it("moves a signed-in employee into the employee portal", async () => {
    mockAuth = { status: "authenticated", profile, activeRole: staffRole };
    renderAt("/dashboard");
    expect(await screen.findByText("employee dashboard")).toBeInTheDocument();
  });

  it("allows a verified employee in the employee portal", async () => {
    mockAuth = { status: "authenticated", profile, activeRole: staffRole };
    renderAt("/employee/dashboard");
    expect(await screen.findByText("employee dashboard")).toBeInTheDocument();
  });

  it("never lets a landlord or tenant into the employee portal", async () => {
    mockAuth = { status: "authenticated", profile: { ...profile, role: "TENANT" } as AdminProfile, activeRole: tenantRole };
    renderAt("/employee/dashboard");
    expect(await screen.findByText("customer dashboard")).toBeInTheDocument();
  });

  it("forces a password change on first login (employee portal)", async () => {
    mockAuth = { status: "authenticated", profile: { ...profile, mustChangePassword: true }, activeRole: staffRole };
    renderAt("/employee/dashboard");
    expect(await screen.findByText("employee settings")).toBeInTheDocument();
  });

  it("returns to the listing a visitor wanted after sign-in", async () => {
    sessionStorage.setItem("saferent.returnTo", "/browse/abc-123");
    mockAuth = { status: "authenticated", profile: { ...profile, role: "TENANT" } as AdminProfile, activeRole: tenantRole };
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<p>customer dashboard</p>} />
            <Route path="/browse/:id" element={<p>listing in app</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("listing in app")).toBeInTheDocument();
    expect(sessionStorage.getItem("saferent.returnTo")).toBeNull();
  });
});
