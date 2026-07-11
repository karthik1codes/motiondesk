"use client";

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

/**
 * Browser Firebase app for Auth (Google sign-in).
 * Active-session reads/writes go through Next API + Admin SDK.
 */
/** Public web config for deepmind-2a4e2 (safe to ship in the client). */
const DEFAULTS = {
  apiKey: "AIzaSyDKj1wx6UEHLubtHeICNI5WXI0O5hE9cDk",
  authDomain: "deepmind-2a4e2.firebaseapp.com",
  projectId: "deepmind-2a4e2",
  storageBucket: "deepmind-2a4e2.firebasestorage.app",
  messagingSenderId: "967930356377",
  appId: "1:967930356377:web:1ee9ac8ce6c1438f1bce08",
} as const;

function clientConfig() {
  return {
    apiKey:
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() || DEFAULTS.apiKey,
    authDomain:
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() ||
      DEFAULTS.authDomain,
    projectId:
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() || DEFAULTS.projectId,
    storageBucket:
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() ||
      DEFAULTS.storageBucket,
    messagingSenderId:
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim() ||
      DEFAULTS.messagingSenderId,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim() || DEFAULTS.appId,
  };
}

export function isFirebaseClientConfigured(): boolean {
  const c = clientConfig();
  return Boolean(c.apiKey && c.appId);
}

export function getFirebaseClientApp(): FirebaseApp | null {
  if (typeof window === "undefined") return null;
  if (!isFirebaseClientConfigured()) return null;
  const existing = getApps()[0];
  if (existing) return existing;
  return initializeApp(clientConfig());
}

export function getFirebaseAuth(): Auth | null {
  const app = getFirebaseClientApp();
  if (!app) return null;
  return getAuth(app);
}
