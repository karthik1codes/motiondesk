import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

/**
 * Server-only Firebase Admin for project deepmind-2a4e2.
 * Auth: GOOGLE_APPLICATION_CREDENTIALS (service account JSON) or ADC.
 */
export const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID?.trim() || "deepmind-2a4e2";

export const FIREBASE_STORAGE_BUCKET =
  process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
  `${FIREBASE_PROJECT_ID}.firebasestorage.app`;

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
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
      process.env.FIREBASE_ARCHIVE_ENABLED === "1",
  );
}
