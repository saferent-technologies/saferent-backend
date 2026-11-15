import type { NextFunction, Request, Response } from "express";
import { REASONS } from "../config/constants";
import { featuresForPath, isPaymentPath, maintenanceActive } from "../appConfig/schema";
import { appConfig } from "../appConfig/service";
import { AppError } from "../lib/errors";
import { ROLE_INFO, type RoleKey } from "../rbac/catalog";
import { hasPermission } from "../rbac/policy";

/**
 * Enforces the app configuration on the server (never trusts the app's own flags):
 *   - Maintenance mode: only Super Admin, the roles allowed in the config, and people who manage
 *     the app configuration (so they can switch it off) get through.
 *   - Feature switches: a switched-off feature is refused for customer roles. Staff are not gated.
 *   - Payments: online payment endpoints need the payment module on.
 * Runs inside protect(), after the user is loaded.
 */
export async function enforceAppConfig(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const user = req.user;
  if (!user) return next();
  const cfg = await appConfig();
  const roles = user.roles as RoleKey[];
  const path = req.path;

  if (maintenanceActive(cfg.maintenance)) {
    const exempt =
      roles.includes("SUPER_ADMIN") ||
      roles.some((r) => cfg.maintenance.allowedRoles.includes(r)) ||
      (hasPermission(user.permissions, "app_config.manage") && path.startsWith("/admin/app-config"));
    if (!exempt) {
      return next(
        new AppError("unavailable", REASONS.MAINTENANCE_MODE, cfg.maintenance.message || "SafeRent is under maintenance.", {
          title: cfg.maintenance.title,
          expectedEndAt: cfg.maintenance.expectedEndAt,
        }),
      );
    }
  }

  const staff = ROLE_INFO[user.role as RoleKey]?.isStaff ?? false;
  if (!staff) {
    const off = featuresForPath(req.method, path).filter((f) => !cfg.features[f]);
    if (off.length) return next(new AppError("permission-denied", REASONS.FEATURE_DISABLED, "This feature is turned off right now.", { feature: off[0] }));
    if (isPaymentPath(req.method, path) && !cfg.payments.enabled) {
      return next(new AppError("permission-denied", REASONS.FEATURE_DISABLED, "Online payments are turned off right now.", { feature: "payments" }));
    }
  }
  next();
}
