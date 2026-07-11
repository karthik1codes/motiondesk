import { existsSync } from "fs";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

/**
 * Server-only Firebase Admin for project deepmind-2a4e2.
 * Auth: FIREBASE_SERVICE_ACCOUNT_JSON (preferred on Vercel) or ADC.
 */
export const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID?.trim() || "deepmind-2a4e2";

export const FIREBASE_STORAGE_BUCKET =
  process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
  `${FIREBASE_PROJECT_ID}.firebasestorage.app`;

function hasUsableCredentialFile(): boolean {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!path) return false;
  // Vercel often inherits a laptop path like E:\…\sa.json — that is not a file in /var/task.
  if (process.env.VERCEL && /^[a-zA-Z]:[\\/]/.test(path)) return false;
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

function initAdmin(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (json) {
    const serviceAccount = JSON.parse(json) as {
      project_id?: string;
      client_email: string;
      private_key: string;
    };
    return initializeApp({
      credential: cert({
        projectId: serviceAccount.project_id ?? FIREBASE_PROJECT_ID,
        clientEmail: serviceAccount.client_email,
        privateKey: serviceAccount.private_key.replace(/\\n/g, "\n"),
      }),
      projectId: FIREBASE_PROJECT_ID,
      storageBucket: FIREBASE_STORAGE_BUCKET,
    });
  }

  if (process.env.VERCEL && !hasUsableCredentialFile()) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is required on Vercel (local GOOGLE_APPLICATION_CREDENTIALS paths are ignored)",
    );
  }

  // Application Default Credentials (gcloud / local ADC / Cloud Run).
  return initializeApp({
    projectId: FIREBASE_PROJECT_ID,
    storageBucket: FIREBASE_STORAGE_BUCKET,
  });
}

export function getFirebaseApp(): App {
  return initAdmin();
}

export function getDb() {
  return getFirestore(getFirebaseApp());
}

export function getBucket() {
  return getStorage(getFirebaseApp()).bucket();
}

export function isCloudArchiveEnabled(): boolean {
  if (process.env.FIREBASE_ARCHIVE_DISABLED === "1") return false;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()) return true;
  if (hasUsableCredentialFile()) return true;
  // Explicit opt-in only when a real credential source exists.
  return false;
}
