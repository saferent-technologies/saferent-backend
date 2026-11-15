import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { FullScreenLoader } from "@/components/ui/FullScreenLoader";
import { useAuth } from "@/hooks/useAuth";
import { PATHS } from "@/utils/constants";
import { pendingInvite, savePendingInvite } from "./pendingInvite";
import { clearPendingReturn, pendingReturn } from "./pendingReturn";
import { isEmployeePath, toCustomerPath, toEmployeePath, usePortal } from "./portal";

/**
 * Route guards improve UX only. Real enforcement happens in the API: a user who bypasses these
 * guards still cannot read or change any data outside their permissions.
 */

/** /login, /employee and /employee/forgot-password: only for signed-out users. */
export function GuestRoute() {
  const { status, loginFlowActive } = useAuth();
  if (status === "initializing") return <FullScreenLoader />;
  if (!loginFlowActive) {
    // Signed in already: PortalGuard then sends employees to /employee/dashboard.
    if (status === "authenticated") return <Navigate to={PATHS.dashboard} replace />;
    if (status === "awaiting_second_factor") return <Navigate to={PATHS.verifyOtp} replace />;
    if (status === "registration_required") return <Navigate to={PATHS.register} replace />;
  }
  return <Outlet />;
}

/** /employee/verify-otp: only between a successful employee password sign-in and OTP verification. */
export function SecondFactorRoute() {
  const { status } = useAuth();
  if (status === "initializing") return <FullScreenLoader />;
  if (status === "authenticated") return <Navigate to={toEmployeePath(PATHS.dashboard)} replace />;
  if (status !== "awaiting_second_factor") return <Navigate to={PATHS.employeeLogin} replace />;
  return <Outlet />;
}

/** /register: phone verified with Firebase but no SafeRent account yet. */
export function RegistrationRoute() {
  const { status, loginFlowActive } = useAuth();
  if (status === "initializing") return <FullScreenLoader />;
  if (!loginFlowActive) {
    if (status === "authenticated") return <Navigate to={PATHS.dashboard} replace />;
    if (status !== "registration_required") return <Navigate to={PATHS.login} replace />;
  }
  return <Outlet />;
}

/** Everything inside the app: an active account with a verified session for this sign-in. */
export function ProtectedRoute() {
  const { status, profile } = useAuth();
  const location = useLocation();
  const employee = isEmployeePath(location.pathname);

  if (status === "initializing") return <FullScreenLoader />;
  // An invitation link opened while signed out: remember it and come back after sign-in / registration.
  if (status !== "authenticated" && location.pathname.startsWith("/invite/")) savePendingInvite(location.pathname);
  if (status === "awaiting_second_factor") return <Navigate to={PATHS.verifyOtp} replace />;
  if (status === "registration_required") return <Navigate to={PATHS.register} replace />;
  // Signed out: employees go back to the employee sign-in, everyone else to the customer sign-in.
  if (status !== "authenticated") return <Navigate to={employee ? PATHS.employeeLogin : PATHS.login} replace state={{ from: location.pathname }} />;
  if (!profile) return <FullScreenLoader label="Loading your workspace…" />;
  const invite = pendingInvite();
  if (invite && location.pathname !== invite && !profile.mustChangePassword) return <Navigate to={invite} replace />;
  const back = pendingReturn();
  if (back && !profile.mustChangePassword) {
    if (location.pathname === back) clearPendingReturn();
    else if (!employee) return <Navigate to={back} replace />;
  }

  // First sign-in with the bootstrap/temporary password: force a password change first.
  const settings = employee ? toEmployeePath(PATHS.settings) : PATHS.settings;
  if (profile.mustChangePassword && location.pathname !== settings) {
    return <Navigate to={`${settings}?tab=security&required=1`} replace />;
  }
  return <Outlet />;
}

/**
 * Keeps the two portals apart: employee accounts always work under /employee, landlords and
 * tenants never do (they are sent to the same page in the customer app).
 */
export function PortalGuard({ portal }: { portal: "customer" | "employee" }) {
  const { activeRole } = useAuth();
  const location = useLocation();
  const staff = !!activeRole?.isStaff;
  const target = `${location.search}${location.hash}`;
  if (portal === "customer" && staff) return <Navigate to={`${toEmployeePath(location.pathname)}${target}`} replace />;
  if (portal === "employee" && !staff) return <Navigate to={`${toCustomerPath(location.pathname)}${target}`} replace />;
  return <Outlet />;
}

/** Customer-only pages (referrals, reviews, wallet): staff accounts such as the founder are sent to the dashboard. */
export function RequireRole({ anyOf, children }: { anyOf: string[]; children: ReactNode }) {
  const { roles } = useAuth();
  const { dashboardPath } = usePortal();
  if (!roles.some((r) => anyOf.includes(r.key))) return <Navigate to={dashboardPath} replace />;
  return <>{children}</>;
}

/** Hides a page from roles without the permission (the API would refuse its data anyway). */
export function RequirePermission({ anyOf, children }: { anyOf: string[]; children: ReactNode }) {
  const { can } = useAuth();
  const { dashboardPath } = usePortal();
  if (!anyOf.some((p) => can(p))) return <Navigate to={dashboardPath} replace />;
  return <>{children}</>;
}
