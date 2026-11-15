import type { NextFunction, Request, RequestHandler, Response } from "express";
import { REASONS } from "../config/constants";
import { completionView, demographicsSchema } from "../lib/profileCompletion";
import { fail } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { parseInput } from "../lib/validation";
import { enforceAppConfig } from "../middleware/appConfig";
import { loadUser, requirePermission, requireSession } from "../middleware/auth";
import { createPhoneAccount } from "./auth.controller";
import { consentStatusFor, saveConsents } from "./consents.controller";
import { grantsLegal, termsAccepted } from "../lib/consents";
import { updateDemographics } from "./profile.controller";
import { toProfile } from "./serializers";

/*
 * POST/PUT /api/v1/userProfile — ONE call for the user profile screen after OTP, whoever is signed in:
 *   - first-time user (no SafeRent account yet): creates the account with the chosen user type
 *     (same rules as POST /auth/register) → 201
 *   - existing user: saves the details (+ adds the chosen type as a role if the account lacks it) → 200
 * Consents sent with it (Terms / Privacy / WhatsApp) are recorded in user_consents; a new account must
 * accept the Terms and Privacy Policy (now or earlier).
 * Both answer { user, isProfileCompleted, missingFields, role, roles, termsAccepted, consents } — the app
 * opens `role`'s dashboard.
 */

const existingUser: RequestHandler[] = [loadUser, requireSession, enforceAppConfig, requirePermission("profile.manage"), updateDemographics as RequestHandler];

/** Runs a middleware chain by hand (sync or async handlers), forwarding errors to `next`. */
function runChain(handlers: RequestHandler[], req: Request, res: Response, next: NextFunction): void {
  let i = 0;
  const step = (err?: unknown): void => {
    if (err) return next(err);
    const handler = handlers[i++];
    if (!handler) return next();
    try {
      const result = handler(req, res, step) as unknown;
      if (result && typeof (result as Promise<void>).catch === "function") (result as Promise<void>).catch(step);
    } catch (e) {
      step(e);
    }
  };
  step();
}

export async function demographics(req: Request, res: Response, next: NextFunction): Promise<void> {
  const exists = await prisma.user.count({ where: { firebaseUid: req.auth!.uid } });
  if (exists) return runChain(existingUser, req, res, next);

  // First-time user: the screen creates the account.
  const input = parseInput(demographicsSchema, req.body);
  if (!input.fullName) fail("invalid-argument", REASONS.INVALID_INPUT, "Enter your full name.", { missingFields: ["fullName"] });
  const uid = req.auth!.uid;
  if (!grantsLegal(input.consents) && !termsAccepted(await consentStatusFor(uid))) {
    fail("invalid-argument", REASONS.INVALID_INPUT, "Please accept the Terms of Service and Privacy Policy to create your account.", { missingFields: ["consents"] });
  }
  const user = await createPhoneAccount(req, {
    fullName: input.fullName,
    role: input.role,
    email: input.email,
    gender: input.gender,
    dateOfBirth: input.dateOfBirth,
    city: input.city,
    state: input.state,
    occupation: input.occupation,
    referralCode: input.referralCode,
    isProfileCompleted: input.isProfileCompleted,
  });
  const consents = input.consents ? await saveConsents(req, uid, { ...input, consents: input.consents, role: input.role }) : await consentStatusFor(uid);
  res.status(201).json({ user: toProfile(user), ...completionView(user), role: user.role, roles: [user.role], termsAccepted: termsAccepted(consents), consents });
}
