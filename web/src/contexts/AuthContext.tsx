import { onIdTokenChanged, signOut, type User } from "firebase/auth";
import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { auth } from "@/firebase/config";
import { api, type MeResponse } from "@/services/api";
import { logoutEverywhere, reauthenticateWithPassword } from "@/services/authService";
import type { AdminSession, AuthStatus, Permissions, RoleInfo, Scope, UserProfile } from "@/types/auth";
import { AppError, toAppError } from "@/utils/errors";

export type NoticeKind = "info" | "success" | "warning" | "error";
export interface Notice {
  kind: NoticeKind;
  message: string;
}

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  /** Sign-in method used for the current Firebase session ("password" | "phone"). */
  signInProvider: string | null;
  session: AdminSession | null;
  profile: UserProfile | null;
  roleInfo: RoleInfo | null;
  /** Every role the account holds (primary first). */
  roles: RoleInfo[];
  /** The role whose dashboard / menu labels are shown (multi-role accounts can switch). */
  activeRole: RoleInfo | null;
  setActiveRole: (role: string) => void;
  /** Effective permissions from the API (UX only — the API enforces everything again). */
  permissions: Permissions;
  can: (permission: string, scope?: Scope) => boolean;
  /** Phone number verified by Firebase for a user who still has to register. */
  pendingPhone: string | null;
  notice: Notice | null;
  setNotice: (notice: Notice | null) => void;
  loginFlowActive: boolean;
  runLoginFlow: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Re-reads the account + session from the API and resolves once the second factor is complete. */
  waitForAuthenticated: () => Promise<void>;
  refresh: () => Promise<void>;
  reauthenticate: (password: string) => Promise<void>;
  logout: (notice?: Notice) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

interface TokenState {
  user: User;
  authTime: number;
  provider: string | null;
}

const BLOCKING_REASONS = new Set(["NOT_AUTHORIZED", "ACCOUNT_DISABLED", "ACCOUNT_MISMATCH", "SESSION_REQUIRED", "UNAUTHENTICATED"]);
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<TokenState | null | undefined>(undefined); // undefined = loading
  const [me, setMe] = useState<MeResponse | null | undefined>(undefined); // undefined = loading
  const [notice, setNotice] = useState<Notice | null>(null);
  const [flowActive, setFlowActive] = useState(false);
  const requestSeq = useRef(0);
  const [preferredRole, setPreferredRole] = useState<string | null>(() => {
    try {
      return localStorage.getItem("saferent.activeRole");
    } catch {
      return null;
    }
  });
  const setActiveRole = useCallback((role: string) => {
    setPreferredRole(role);
    try {
      localStorage.setItem("saferent.activeRole", role);
    } catch {
      // storage unavailable — keep it for this tab only
    }
  }, []);
  const reauthActive = useRef(false);

  // 1) Firebase Auth state (sign-in, re-auth, hourly token refresh).
  useEffect(() => {
    return onIdTokenChanged(auth, async (user) => {
      if (!user) {
        setToken(null);
        setMe(undefined);
        return;
      }
      try {
        const result = await user.getIdTokenResult();
        setToken({ user, authTime: Number(result.claims.auth_time), provider: result.signInProvider });
      } catch {
        setToken(null);
      }
    });
  }, []);

  /** Fetches /api/auth/me; only the most recent request may update state. */
  const loadMe = useCallback(async (): Promise<MeResponse | null> => {
    const seq = ++requestSeq.current;
    try {
      const result = await api.me();
      if (seq === requestSeq.current) setMe(result);
      return result;
    } catch (error) {
      const appError = toAppError(error);
      if (seq !== requestSeq.current) throw appError;
      setMe(null);
      setNotice({ kind: "error", message: appError.message });
      if (BLOCKING_REASONS.has(appError.reason)) await signOut(auth);
      throw appError;
    }
  }, []);

  // 2) Load the SafeRent account whenever the Firebase sign-in changes (not on hourly refresh).
  const signInKey = token ? `${token.user.uid}:${token.authTime}` : null;
  useEffect(() => {
    if (!signInKey || reauthActive.current) return;
    setMe(undefined);
    loadMe().catch(() => undefined);
  }, [signInKey, loadMe]);

  const status: AuthStatus = useMemo(() => {
    if (token === undefined) return "initializing";
    if (token === null) return "signed_out";
    if (me === undefined) return "initializing";
    if (me === null) return "signed_out";
    if (me.registrationRequired) return "registration_required";
    return me.secondFactorRequired ? "awaiting_second_factor" : "authenticated";
  }, [token, me]);

  // 3) Keep the account fresh (role/permission changes, disabled accounts) — every 5 min and on focus.
  useEffect(() => {
    if (status !== "authenticated") return;
    const refresh = () => void loadMe().catch(() => undefined);
    const id = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", refresh);
    };
  }, [status, loadMe]);

  // 4) Session expiry.
  const expiresAt = me && !me.registrationRequired ? me.session?.expiresAt : undefined;
  useEffect(() => {
    if (status !== "authenticated" || !expiresAt) return;
    const remaining = new Date(expiresAt).getTime() - Date.now();
    const id = window.setTimeout(() => {
      setNotice({ kind: "warning", message: "Your session has expired. Please sign in again." });
      void logoutEverywhere();
    }, Math.max(0, Math.min(remaining, 2_147_000_000)));
    return () => window.clearTimeout(id);
  }, [status, expiresAt]);

  const runLoginFlow = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setFlowActive(true);
    try {
      return await fn();
    } finally {
      setFlowActive(false);
    }
  }, []);

  const waitForAuthenticated = useCallback(async () => {
    const result = await loadMe();
    if (!result || result.registrationRequired || result.secondFactorRequired) {
      throw new AppError("SESSION_REQUIRED", "We couldn't complete sign-in. Please try again.");
    }
  }, [loadMe]);

  const refresh = useCallback(async () => {
    await loadMe();
  }, [loadMe]);

  const reauthenticate = useCallback(
    async (password: string) => {
      reauthActive.current = true;
      try {
        await reauthenticateWithPassword(password);
      } finally {
        reauthActive.current = false;
      }
      await loadMe();
    },
    [loadMe],
  );

  const logout = useCallback(async (nextNotice?: Notice) => {
    await logoutEverywhere();
    setNotice(nextNotice ?? { kind: "success", message: "You have been signed out." });
  }, []);

  const permissions: Permissions = useMemo(() => (me && !me.registrationRequired && status === "authenticated" ? me.permissions : {}), [me, status]);
  const can = useCallback(
    (permission: string, scope?: Scope) => {
      const scopes = permissions[permission];
      if (!scopes?.length) return false;
      return scope ? scopes.includes("ALL") || scopes.includes(scope) : true;
    },
    [permissions],
  );

  const roles = useMemo<RoleInfo[]>(() => (status === "authenticated" && me && !me.registrationRequired ? (me.roles?.length ? me.roles : [me.roleInfo]) : []), [status, me]);
  const activeRole = useMemo(() => roles.find((r) => r.key === preferredRole) ?? roles[0] ?? null, [roles, preferredRole]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: token?.user ?? null,
      signInProvider: token?.provider ?? null,
      session: me && !me.registrationRequired ? me.session : null,
      profile: status === "authenticated" && me && !me.registrationRequired ? me.user : null,
      roleInfo: status === "authenticated" && me && !me.registrationRequired ? me.roleInfo : null,
      roles,
      activeRole,
      setActiveRole,
      permissions,
      can,
      pendingPhone: me?.registrationRequired ? (me.phoneNumber ?? token?.user.phoneNumber ?? null) : null,
      notice,
      setNotice,
      loginFlowActive: flowActive,
      runLoginFlow,
      waitForAuthenticated,
      refresh,
      reauthenticate,
      logout,
    }),
    [status, token, me, roles, activeRole, setActiveRole, permissions, can, notice, flowActive, runLoginFlow, waitForAuthenticated, refresh, reauthenticate, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
