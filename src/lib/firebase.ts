"use client";
import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getDatabase, type Database } from "firebase/database";
import { getStorage, type FirebaseStorage } from "firebase/storage";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseConfigured = Boolean(config.apiKey && config.databaseURL && config.projectId);

let _app: FirebaseApp | null = null;
export function firebaseApp(): FirebaseApp {
  if (!_app) _app = getApps().length ? getApp() : initializeApp(config);
  return _app;
}
export function auth(): Auth {
  return getAuth(firebaseApp());
}
export function db(): Database {
  return getDatabase(firebaseApp());
}
export function storage(): FirebaseStorage {
  return getStorage(firebaseApp());
}

/** Human-readable message for Firebase / network errors. */
export function errorMessage(err: unknown): string {
  const e = err as { code?: string; message?: string };
  const code = e?.code ?? "";
  const msg = e?.message ?? String(err);
  if (/PERMISSION_DENIED|permission[_ -]denied/i.test(code + msg)) return "Permission denied by security rules.";
  if (/client is offline/i.test(msg)) return "You are offline. Check the internet connection and try again.";
  switch (code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Sign-in was cancelled.";
    case "auth/popup-blocked":
      return "The sign-in popup was blocked by the browser.";
    case "auth/unauthorized-domain":
      return "This website's domain is not authorised in Firebase Authentication (Authentication → Settings → Authorized domains).";
    case "auth/network-request-failed":
      return "Network error. Check the internet connection.";
    case "storage/unauthorized":
      return "Not allowed to upload this file (check Storage rules, file size and type).";
    case "storage/unknown":
    case "storage/bucket-not-found":
    case "storage/project-not-found":
      return "Firebase Storage is not set up for this project. Paste a photo URL instead, or enable Storage.";
  }
  return msg.replace(/^Firebase:\s*/, "");
}
