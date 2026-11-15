import { useLocation } from "react-router";
import { PATHS } from "@/utils/constants";

/**
 * Two portals share the same pages:
 *  - customers (landlords, tenants, agents, service providers) use /dashboard, /properties, …
 *  - SafeRent employees use the same pages under /employee (/employee/dashboard, /employee/users, …)
 * PortalGuard moves anyone who lands in the wrong one; the API enforces permissions regardless.
 */
export const EMPLOYEE_BASE = "/employee";

export function isEmployeePath(pathname: string): boolean {
  return pathname === EMPLOYEE_BASE || pathname.startsWith(`${EMPLOYEE_BASE}/`);
}

/** "/users" → "/employee/users" (idempotent). */
export function toEmployeePath(path: string): string {
  return isEmployeePath(path) ? path : `${EMPLOYEE_BASE}${path === "/" ? "" : path}`;
}

/** "/employee/users" → "/users". */
export function toCustomerPath(path: string): string {
  if (!isEmployeePath(path)) return path;
  return path.slice(EMPLOYEE_BASE.length) || PATHS.dashboard;
}

/** Portal-aware paths for links and redirects inside the app. */
export function usePortal() {
  const { pathname } = useLocation();
  const employee = isEmployeePath(pathname);
  return {
    employee,
    /** App path in the current portal: path("/users") → "/employee/users" for employees. */
    path: (to: string) => (employee ? toEmployeePath(to) : to),
    loginPath: employee ? PATHS.employeeLogin : PATHS.login,
    dashboardPath: employee ? toEmployeePath(PATHS.dashboard) : PATHS.dashboard,
  };
}
