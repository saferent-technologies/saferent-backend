/**
 * Converts Firebase / Cloud Functions errors into clean, user-facing messages.
 * Internal error text is never shown to users.
 */

export class AppError extends Error {
  readonly reason: string;
  readonly retryAfterSeconds?: number;
  readonly attemptsRemaining?: number;
  /** Extra API details, e.g. { issues: [{ path, message }] } or { problems: [...] }. */
  readonly details?: Record<string, unknown>;

  constructor(reason: string, message: string, extra: { retryAfterSeconds?: number; attemptsRemaining?: number; details?: Record<string, unknown> } = {}) {
    super(message);
    this.name = "AppError";
    this.reason = reason;
    this.retryAfterSeconds = extra.retryAfterSeconds;
    this.attemptsRemaining = extra.attemptsRemaining;
    this.details = extra.details;
  }
}

const GENERIC = "Something went wrong. Please try again.";

/** Reasons returned by the SafeRent API (error.reason). */
const REASON_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Please sign in to continue.",
  NOT_AUTHORIZED: "This account is not authorized to access the SafeRent admin portal.",
  ACCOUNT_DISABLED: "This account has been disabled. Contact your security administrator.",
  INVALID_DOMAIN: "This account is not authorized to access the SafeRent admin portal.",
  WRONG_SIGN_IN_METHOD: "Please start again from the sign-in page.",
  ACCOUNT_MISMATCH: "This account is not authorized to access the SafeRent admin portal.",
  OTP_INVALID: "That code is incorrect. Please check and try again.",
  OTP_EXPIRED: "This code has expired. Request a new code.",
  OTP_ALREADY_USED: "This code has already been used. Request a new code.",
  OTP_TOO_MANY_ATTEMPTS: "Too many incorrect attempts. Request a new code.",
  CHALLENGE_NOT_FOUND: "This code is no longer valid. Request a new code.",
  RESEND_COOLDOWN: "Please wait before requesting another code.",
  RATE_LIMITED: "Too many attempts. Please wait a while and try again.",
  SESSION_REQUIRED: "Your session has expired. Please sign in again.",
  RECENT_LOGIN_REQUIRED: "Please confirm your password to continue.",
  INVALID_INPUT: "Please check the information you entered.",
  EMAIL_IN_USE: "This email address is already in use.",
  EMAIL_DELIVERY_FAILED: "We couldn't send the email. Please try again in a moment.",
};

/** Firebase Authentication client error codes. */
const AUTH_CODE_MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/user-not-found": "Incorrect email or password.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/user-disabled": "This account has been disabled. Contact your security administrator.",
  "auth/too-many-requests": "Too many attempts. Please wait a while and try again.",
  "auth/network-request-failed": "Network error. Check your internet connection and try again.",
  "auth/invalid-phone-number": "Enter a valid phone number.",
  "auth/missing-phone-number": "Enter your phone number.",
  "auth/quota-exceeded": "SMS limit reached. Please try again later.",
  "auth/captcha-check-failed": "Security check failed. Please refresh the page and try again.",
  "auth/invalid-verification-code": "That code is incorrect. Please check and try again.",
  "auth/missing-verification-code": "Enter the 6-digit code.",
  "auth/code-expired": "This code has expired. Request a new code.",
  "auth/session-expired": "This code has expired. Request a new code.",
  "auth/expired-action-code": "This link has expired. Request a new one.",
  "auth/invalid-action-code": "This link is invalid or has already been used. Request a new one.",
  "auth/weak-password": "Choose a stronger password.",
  "auth/requires-recent-login": "Please confirm your password to continue.",
  "auth/credential-already-in-use": "This phone number is already linked to another account.",
  "auth/account-exists-with-different-credential": "This phone number is already linked to another account.",
  "auth/operation-not-allowed": "This sign-in method is not enabled.",
  // Blocking functions (no public sign-up / admin-only sign-in) surface as these:
  "auth/admin-restricted-operation": "This account is not authorized to access the SafeRent admin portal.",
  "auth/internal-error": GENERIC,
  "auth/firebase-app-check-token-is-invalid": "Security check failed. Please refresh the page and try again.",
};

/** API HTTP status codes (used when no reason is attached). */
const HTTP_CODE_MESSAGES: Record<string, string> = {
  "http/401": "Please sign in to continue.",
  "http/403": "You don't have permission to do that.",
  "http/429": "Too many attempts. Please wait a while and try again.",
  "http/500": GENERIC,
  "http/502": "The service is temporarily unavailable. Please try again.",
  "http/503": "The service is temporarily unavailable. Please try again.",
  "http/504": "The request timed out. Please try again.",
};

interface FirebaseLikeError {
  code?: string;
  message?: string;
  details?: { reason?: string; retryAfterSeconds?: number; attemptsRemaining?: number | null; [key: string]: unknown } | null;
}

/** SafeRent API reasons whose server message is written for users (it says exactly what to fix). */
const SPECIFIC_API_REASONS = new Set(["INVALID_INPUT", "INVALID_STATE", "CONFLICT", "VERSION_CONFLICT", "NOT_FOUND", "PERMISSION_DENIED", "ALREADY_REGISTERED", "FOUNDER_PROTECTED", "SERVICE_NOT_CONFIGURED"]);

function isBlockingFunctionRejection(err: FirebaseLikeError): boolean {
  // Errors thrown by beforeUserCreated / beforeUserSignedIn arrive as auth/internal-error
  // with "BLOCKING_FUNCTION_ERROR_RESPONSE" or "HTTP Cloud Function returned an error" in the message.
  return (
    err.code === "auth/internal-error" &&
    typeof err.message === "string" &&
    /BLOCKING_FUNCTION_ERROR_RESPONSE|Cloud Function returned an error|permission-denied/i.test(err.message)
  );
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const err = (error ?? {}) as FirebaseLikeError;

  const reason = err.details?.reason;
  if (reason && err.code?.startsWith("http/") && SPECIFIC_API_REASONS.has(reason) && err.message) {
    return new AppError(reason, err.message, { details: err.details ?? undefined });
  }
  if (reason && REASON_MESSAGES[reason]) {
    return new AppError(reason, REASON_MESSAGES[reason], {
      retryAfterSeconds: err.details?.retryAfterSeconds,
      attemptsRemaining: err.details?.attemptsRemaining ?? undefined,
    });
  }
  if (isBlockingFunctionRejection(err)) {
    const disabled = /disabled/i.test(err.message ?? "");
    return new AppError(disabled ? "ACCOUNT_DISABLED" : "NOT_AUTHORIZED", REASON_MESSAGES[disabled ? "ACCOUNT_DISABLED" : "NOT_AUTHORIZED"]);
  }
  if (err.code && AUTH_CODE_MESSAGES[err.code]) {
    return new AppError(err.code, AUTH_CODE_MESSAGES[err.code]);
  }
  if (err.code && HTTP_CODE_MESSAGES[err.code]) {
    return new AppError(err.code, HTTP_CODE_MESSAGES[err.code]);
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return new AppError("offline", AUTH_CODE_MESSAGES["auth/network-request-failed"]);
  }
  if (import.meta.env.DEV) console.error("[SafeRent] Unmapped error", error);
  return new AppError("unknown", GENERIC);
}

export function errorMessage(error: unknown): string {
  return toAppError(error).message;
}
