import type { AuthSession, User } from "@prisma/client";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { EffectivePermissions } from "../rbac/policy";

export type AuthedUser = User & { permissions: EffectivePermissions };

declare global {
  namespace Express {
    interface Request {
      /** Verified Firebase ID token (set by `authenticate`). */
      auth?: DecodedIdToken;
      /** Active SafeRent user + effective permissions (set by `loadUser`). */
      user?: AuthedUser;
      /** Valid second-factor session (set by `requireSession`). */
      authSession?: AuthSession;
    }
  }
}

export {};
