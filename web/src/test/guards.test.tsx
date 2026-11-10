import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextValue } from "@/contexts/AuthContext";
import { ProtectedRoute, SecondFactorRoute } from "@/routes/guards";
import type { AdminProfile } from "@/types/auth";

let mockAuth: Partial<AuthContextValue>;
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

const profile = { id: "u1", fullName: "Shaik Shabeer", role: "SUPER_ADMIN", accountStatus: "ACTIVE", mustChangePassword: false } as unknown as AdminProfile;

// Declarative <MemoryRouter> avoids jsdom/undici AbortSignal issues of data routers in tests.
function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<p>login page</p>} />
        <Route element={<SecondFactorRoute />}>
          <Route path="/verify-otp" element={<p>otp page</p>} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<p>dashboard page</p>} />
          <Route path="/settings" element={<p>settings page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("route protection", () => {
  beforeEach(() => {
    mockAuth = { status: "signed_out", profile: null, loginFlowActive: false };
  });

  it("sends unauthenticated users to login", async () => {
    renderAt("/dashboard");
    expect(await screen.findByText("login page")).toBeInTheDocument();
  });

  it("denies non-admin (unauthorized) users", async () => {
    mockAuth = { status: "unauthorized", profile: null };
    renderAt("/dashboard");
    expect(await screen.findByText("login page")).toBeInTheDocument();
  });

  it("requires the second factor before the dashboard", async () => {
    mockAuth = { status: "awaiting_second_factor", profile: null };
    renderAt("/dashboard");
    expect(await screen.findByText("otp page")).toBeInTheDocument();
  });

  it("allows a verified Super Admin", async () => {
    mockAuth = { status: "authenticated", profile };
    renderAt("/dashboard");
    expect(await screen.findByText("dashboard page")).toBeInTheDocument();
  });

  it("forces a password change on first login", async () => {
    mockAuth = { status: "authenticated", profile: { ...profile, mustChangePassword: true } };
    renderAt("/dashboard");
    expect(await screen.findByText("settings page")).toBeInTheDocument();
  });

  it("keeps signed-out users away from the OTP page", async () => {
    renderAt("/verify-otp");
    expect(await screen.findByText("login page")).toBeInTheDocument();
  });
});
