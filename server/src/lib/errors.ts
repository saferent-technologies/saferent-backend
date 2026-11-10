import type { Reason } from "../config/constants";

export type ErrorCode =
  | "invalid-argument"
  | "unauthenticated"
  | "permission-denied"
  | "not-found"
  | "already-exists"
  | "failed-precondition"
  | "resource-exhausted"
  | "deadline-exceeded"
  | "unavailable"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  "invalid-argument": 400,
  unauthenticated: 401,
  "permission-denied": 403,
  "not-found": 404,
  "already-exists": 409,
  "failed-precondition": 412,
  "resource-exhausted": 429,
  "deadline-exceeded": 410,
  unavailable: 503,
  internal: 500,
};

/**
 * A client-safe error. `message` is generic; `reason` is a stable code the web app maps to
 * friendly text. Internal details are logged on the server, never returned.
 */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    readonly reason: Reason | "INTERNAL",
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AppError";
    this.status = STATUS[code];
  }
}

export function fail(code: ErrorCode, reason: Reason, message: string, extra: Record<string, unknown> = {}): never {
  throw new AppError(code, reason, message, extra);
}
