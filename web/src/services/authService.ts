import {
  browserLocalPersistence,
  browserSessionPersistence,
  EmailAuthProvider,
  PhoneAuthProvider,
  reauthenticateWithCredential,
  RecaptchaVerifier,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signOut,
  updatePhoneNumber,
  type ConfirmationResult,
} from "firebase/auth";
import { auth } from "@/firebase/config";
import type { EmailOtpChallenge } from "@/types/auth";
import { AppError, toAppError } from "@/utils/errors";
import { api } from "./api";

const CHALLENGE_KEY = "saferent.otpChallenge";

/* ---------------------------- OTP challenge storage ---------------------------- */
// Only non-secret metadata (challenge id, masked email, timers) is kept — never the code.

export function saveChallenge(challenge: EmailOtpChallenge): void {
  sessionStorage.setItem(CHALLENGE_KEY, JSON.stringify(challenge));
}

export function loadChallenge(): EmailOtpChallenge | null {
  try {
    const raw = sessionStorage.getItem(CHALLENGE_KEY);
    return raw ? (JSON.parse(raw) as EmailOtpChallenge) : null;
  } catch {
    return null;
  }
}

export function clearChallenge(): void {
  sessionStorage.removeItem(CHALLENGE_KEY);
}

/* ---------------------------------- helpers ---------------------------------- */

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toAppError(error);
  }
}

/* --------------------------------- email login -------------------------------- */

/** Staff login steps 1–3: password sign-in, then the API checks the role and issues the email OTP. */
export async function signInWithEmailStep(email: string, password: string, rememberMe: boolean): Promise<EmailOtpChallenge> {
  return guard(async () => {
    await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
    await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    try {
      const challenge = await api.requestEmailOtp();
      saveChallenge(challenge);
      return challenge;
    } catch (error) {
      const appError = toAppError(error);
      // Keep the password session only for recoverable OTP errors (e.g. cooldown); otherwise sign out.
      if (!["RESEND_COOLDOWN", "EMAIL_DELIVERY_FAILED"].includes(appError.reason)) {
        await signOut(auth);
      }
      throw appError;
    }
  });
}

export async function resendEmailOtp(): Promise<EmailOtpChallenge> {
  const challenge = await api.requestEmailOtp();
  saveChallenge(challenge);
  return challenge;
}

export async function verifyEmailOtpCode(challengeId: string, code: string): Promise<{ mustChangePassword: boolean }> {
  const result = await api.verifyEmailOtp({ challengeId, code });
  clearChallenge();
  return result;
}

/* --------------------------------- phone login -------------------------------- */

/** Invisible reCAPTCHA required by Firebase Phone Authentication. */
export function createRecaptcha(containerId: string): RecaptchaVerifier {
  return new RecaptchaVerifier(auth, containerId, { size: "invisible" });
}

export async function sendPhoneLoginCode(phoneE164: string, verifier: RecaptchaVerifier): Promise<ConfirmationResult> {
  return guard(async () => {
    await setPersistence(auth, browserLocalPersistence);
    return signInWithPhoneNumber(auth, phoneE164, verifier);
  });
}

/**
 * Completes Firebase phone verification, then asks the API to start the session.
 * New landlords/tenants get `registrationRequired: true` and continue on the registration page.
 */
export async function confirmPhoneLoginCode(confirmation: ConfirmationResult, code: string): Promise<{ registrationRequired: boolean }> {
  return guard(async () => {
    await confirmation.confirm(code);
    try {
      const result = await api.completePhoneLogin();
      return { registrationRequired: result.registrationRequired };
    } catch (error) {
      await signOut(auth);
      throw error;
    }
  });
}

/* ---------------------------- re-auth & sensitive ops --------------------------- */

/**
 * Confirms the current password. Firebase issues a new sign-in time, so the backend "rebinds"
 * the verified session using the pre-re-auth token as proof.
 */
export async function reauthenticateWithPassword(password: string): Promise<void> {
  return guard(async () => {
    const user = auth.currentUser;
    if (!user?.email) throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");
    const previousIdToken = await user.getIdToken(true);
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
    await user.getIdToken(true);
    await api.rebindSession({ previousIdToken });
  });
}

/** Sends an SMS code to a NEW phone number (Settings → Phone). */
export async function sendPhoneChangeCode(phoneE164: string, verifier: RecaptchaVerifier): Promise<string> {
  return guard(() => new PhoneAuthProvider(auth).verifyPhoneNumber(phoneE164, verifier));
}

export async function confirmPhoneChange(verificationId: string, code: string): Promise<string> {
  return guard(async () => {
    const user = auth.currentUser;
    if (!user) throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");
    await updatePhoneNumber(user, PhoneAuthProvider.credential(verificationId, code));
    const result = await api.syncPhoneNumber();
    return result.maskedPhone;
  });
}

/* ------------------------------------ logout ------------------------------------ */

export async function logoutEverywhere(): Promise<void> {
  try {
    if (auth.currentUser) await api.logout();
  } catch {
    // The local sign-out below must still happen even if the network call fails.
  }
  clearChallenge();
  await signOut(auth);
}
