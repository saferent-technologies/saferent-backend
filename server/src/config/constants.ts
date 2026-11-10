/**
 * Central security constants for the SafeRent backend.
 * Keep these in sync with web/src/utils/constants.ts (UI copies are for display only;
 * the values here are the ones that are actually enforced).
 */


export const ALLOWED_EMAIL_DOMAIN = "saferenttechnologies.com";

export const OTP = {
  LENGTH: 6,
  TTL_MS: 5 * 60 * 1000, // 5 minutes
  RESEND_COOLDOWN_MS: 60 * 1000, // 60 seconds
  MAX_VERIFY_ATTEMPTS: 5, // per challenge
  MAX_SENDS_PER_WINDOW: 5, // per user
  SEND_WINDOW_MS: 60 * 60 * 1000, // 1 hour
} as const;

export const SESSION = {
  TTL_MS: 12 * 60 * 60 * 1000, // verified admin session lasts 12 hours
  RECENT_AUTH_MAX_AGE_S: 5 * 60, // sensitive changes require sign-in/re-auth within 5 minutes
} as const;

export const RATE_LIMITS = {
  PHONE_LOGIN: { limit: 10, windowMs: 60 * 60 * 1000 },
  PASSWORD_RESET_PER_EMAIL: { limit: 3, windowMs: 60 * 60 * 1000 },
  PASSWORD_RESET_PER_IP: { limit: 10, windowMs: 60 * 60 * 1000 },
  EMAIL_CHANGE: { limit: 3, windowMs: 60 * 60 * 1000 },
  PASSWORD_CHANGE: { limit: 5, windowMs: 60 * 60 * 1000 },
  REGISTRATION: { limit: 5, windowMs: 60 * 60 * 1000 },
  SUPPORT_TICKET: { limit: 20, windowMs: 60 * 60 * 1000 },
  UPLOAD: { limit: 60, windowMs: 60 * 60 * 1000 },
} as const;

/** Machine-readable reasons returned in error responses (error.reason). The web app maps these to friendly text. */
export const REASONS = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  ACCOUNT_DISABLED: "ACCOUNT_DISABLED",
  INVALID_DOMAIN: "INVALID_DOMAIN",
  WRONG_SIGN_IN_METHOD: "WRONG_SIGN_IN_METHOD",
  ACCOUNT_MISMATCH: "ACCOUNT_MISMATCH",
  OTP_INVALID: "OTP_INVALID",
  OTP_EXPIRED: "OTP_EXPIRED",
  OTP_ALREADY_USED: "OTP_ALREADY_USED",
  OTP_TOO_MANY_ATTEMPTS: "OTP_TOO_MANY_ATTEMPTS",
  CHALLENGE_NOT_FOUND: "CHALLENGE_NOT_FOUND",
  RESEND_COOLDOWN: "RESEND_COOLDOWN",
  RATE_LIMITED: "RATE_LIMITED",
  SESSION_REQUIRED: "SESSION_REQUIRED",
  RECENT_LOGIN_REQUIRED: "RECENT_LOGIN_REQUIRED",
  INVALID_INPUT: "INVALID_INPUT",
  EMAIL_IN_USE: "EMAIL_IN_USE",
  EMAIL_DELIVERY_FAILED: "EMAIL_DELIVERY_FAILED",
  REGISTRATION_REQUIRED: "REGISTRATION_REQUIRED",
  ALREADY_REGISTERED: "ALREADY_REGISTERED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  INVALID_STATE: "INVALID_STATE",
  FOUNDER_PROTECTED: "FOUNDER_PROTECTED",
  PAYMENTS_NOT_CONFIGURED: "PAYMENTS_NOT_CONFIGURED",
} as const;
export type Reason = (typeof REASONS)[keyof typeof REASONS];

export const UPLOADS = {
  MAX_BYTES: 5 * 1024 * 1024,
  IMAGE_TYPES: ["image/jpeg", "image/png", "image/webp"],
  DOCUMENT_TYPES: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
} as const;
