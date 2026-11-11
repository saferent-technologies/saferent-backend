import type { AuthSession, User } from "@prisma/client";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { RoleKey } from "../rbac/catalog";
import type { EffectivePermissions } from "../rbac/policy";

/** The signed-in account: primary role (users.role) + every role held (primary first) + effective permissions. */
export type AuthedUser = User & { roles: RoleKey[]; permissions: EffectivePermissions };

export type ClientPlatform = "ANDROID" | "IOS" | "ADMIN_PANEL" | "BACKEND";

declare global {
  namespace Express {
    interface Request {
      /** Verified Firebase ID token (set by `authenticate`). */
      auth?: DecodedIdToken;
      /** Active SafeRent user + effective permissions (set by `loadUser`). */
      user?: AuthedUser;
      /** Valid second-factor session (set by `requireSession`). */
      authSession?: AuthSession;
      /** Correlation id for logs and audit entries (X-Request-Id). */
      requestId?: string;
      /** Client that sent the request (X-Client-Platform). Informational only — never used for authorization. */
      platform?: ClientPlatform;
    }
  }
}

export {};
