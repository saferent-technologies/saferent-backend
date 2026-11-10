import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAppCheck } from "firebase-admin/app-check";
import { getAuth } from "firebase-admin/auth";

/**
 * Firebase Admin SDK — used ONLY for Authentication (verifying ID tokens, custom claims,
 * email action links). Credentials come from GOOGLE_APPLICATION_CREDENTIALS (service account
 * JSON kept outside git). All application data lives in MySQL.
 */
if (getApps().length === 0) {
  initializeApp({
    credential: applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

export const adminAuth = getAuth();
export const appCheck = getAppCheck();
