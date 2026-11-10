import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { FullScreenLoader } from "@/components/ui/FullScreenLoader";
import { useAuth } from "@/hooks/useAuth";
import { PATHS } from "@/utils/constants";

/**
 * Route guards improve UX only. Real enforcement happens in the API: a user who bypasses these
 * guards still cannot read or change any data outside their permissions.
 */

/** /login and /forgot-password: only for signed-out users. */
export function GuestRoute() {
  const { status, loginFlowActive } = useAuth();
  if (status === "initializing") return <FullScreenLoader />;
  if (!loginFlowActive) {
    if (status === "authenticated") return <Navigate to={PATHS.dashboard} replace />;
    if (status === "awaiting_second_factor") return <Navigate to={PATHS.verifyOtp} replace />;
    if (status === "registration_required") return <Navigate to={PATHS.register} replace />;
  }
  return <Outlet />;
}

/** /verify-otp: only between a successful password sign-in and OTP verification. */
export function SecondFactorRoute() {
  const { status } = useAuth();
  if (status === "initializing") return <FullScreenLoader />;
  if (status === "authenticated") return <Navigate to={PATHS.dashboard} replace />;
  if (status !== "awaiting_second_factor") return <Navigate to={PATHS.login} replace />;
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

  if (status === "initializing") return <FullScreenLoader />;
  if (status === "awaiting_second_factor") return <Navigate to={PATHS.verifyOtp} replace />;
  if (status === "registration_required") return <Navigate to={PATHS.register} replace />;
  if (status !== "authenticated") return <Navigate to={PATHS.login} replace state={{ from: location.pathname }} />;
  if (!profile) return <FullScreenLoader label="Loading your workspace…" />;

  // First sign-in with the bootstrap/temporary password: force a password change first.
  if (profile.mustChangePassword && location.pathname !== PATHS.settings) {
    return <Navigate to={`${PATHS.settings}?tab=security&required=1`} replace />;
  }
  return <Outlet />;
}

/** Hides a page from roles without the permission (the API would refuse its data anyway). */
export function RequirePermission({ anyOf, children }: { anyOf: string[]; children: ReactNode }) {
  const { can } = useAuth();
  if (!anyOf.some((p) => can(p))) return <Navigate to={PATHS.dashboard} replace />;
  return <>{children}</>;
}
