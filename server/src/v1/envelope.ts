import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { ClientPlatform } from "../types/express";

const PLATFORMS: readonly ClientPlatform[] = ["ANDROID", "IOS", "ADMIN_PANEL"];

/** Adds a request id (echoed in X-Request-Id) and the client platform to every request. */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get("x-request-id");
  req.requestId = incoming && /^[\w.-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  const platform = (req.get("x-client-platform") ?? "").toUpperCase();
  req.platform = (PLATFORMS as readonly string[]).includes(platform) ? (platform as ClientPlatform) : "BACKEND";
  res.setHeader("X-Request-Id", req.requestId);
  next();
}

const ERROR_CODES: Record<number, string> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  410: "GONE",
  412: "PRECONDITION_FAILED",
  413: "PAYLOAD_TOO_LARGE",
  429: "RATE_LIMITED",
  503: "SERVICE_UNAVAILABLE",
};

/** Stable machine-readable error code for the v1 envelope (pure — unit tested). */
export function errorCodeFor(status: number, reason?: string): string {
  if (reason === "INVALID_STATE") return "INVALID_STATE";
  if (reason === "CONFLICT" || reason === "VERSION_CONFLICT") return "CONFLICT";
  if (reason === "REGISTRATION_REQUIRED") return "REGISTRATION_REQUIRED";
  if (reason === "SESSION_REQUIRED") return "SESSION_REQUIRED";
  return ERROR_CODES[status] ?? (status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST");
}

/** Converts a handler's JSON body into the v1 envelope (pure — unit tested). */
export function toEnvelope(status: number, body: unknown, message?: string): Record<string, unknown> {
  if (body && typeof body === "object" && "success" in (body as object)) return body as Record<string, unknown>;
  if (status >= 400) {
    const error = ((body as { error?: Record<string, unknown> } | null)?.error ?? {}) as Record<string, unknown>;
    const { reason, message: msg, ...rest } = error;
    return {
      success: false,
      message: typeof msg === "string" ? msg : "Request failed.",
      errorCode: errorCodeFor(status, typeof reason === "string" ? reason : undefined),
      reason: reason ?? null,
      ...(Object.keys(rest).length ? { details: rest } : {}),
      data: null,
    };
  }
  let data: unknown = body ?? null;
  let meta: Record<string, unknown> | null = null;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const rest = { ...(data as Record<string, unknown>) };
    delete rest.ok;
    if (Array.isArray(rest.items) && typeof rest.total === "number") {
      data = rest.items;
      delete rest.items;
      meta = rest;
    } else {
      data = Object.keys(rest).length ? rest : null;
    }
  }
  return { success: true, message: message ?? (status === 201 ? "Created successfully." : "OK"), data, meta };
}

/**
 * v1 response format:
 *   success: { success: true,  message, data, meta }
 *   error:   { success: false, message, errorCode, reason, data: null }
 * Handlers keep returning plain objects; this middleware wraps them. Set res.locals.message for a custom message.
 */
export function envelope(_req: Request, res: Response, next: NextFunction): void {
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    if (res.locals.rawJson) return json(body);
    return json(toEnvelope(res.statusCode, body, res.locals.message as string | undefined));
  };
  next();
}
