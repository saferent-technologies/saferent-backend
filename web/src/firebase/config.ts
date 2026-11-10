import { initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from "firebase/app-check";
import { getAuth, type Auth } from "firebase/auth";

/**
 * Firebase is used ONLY for authentication (email/password + phone OTP).
 * All data comes from the SafeRent API (server/ — Express + MySQL).
 */
const env = import.meta.env;

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

const REQUIRED_KEYS = ["apiKey", "authDomain", "projectId", "appId"] as const;
export const missingFirebaseConfig: string[] = REQUIRED_KEYS.filter((key) => !firebaseConfig[key]);
export const isFirebaseConfigured = missingFirebaseConfig.length === 0;

let app: FirebaseApp;
let auth: Auth;
let appCheck: AppCheck | null = null;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);

  // App Check: proves API calls come from this genuine web app (enable APP_CHECK_ENFORCE on the server).
  if (env.DEV && env.VITE_APPCHECK_DEBUG_TOKEN) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = env.VITE_APPCHECK_DEBUG_TOKEN;
  }
  if (env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY) {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  }

  auth = getAuth(app);
  auth.useDeviceLanguage();
}

/** Base URL of the SafeRent API. Empty = same origin (Vite proxies /api to http://localhost:4000 in development). */
export const API_URL = (env.VITE_API_URL ?? "").replace(/\/$/, "");

export { app, appCheck, auth };
