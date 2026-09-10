import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function readServiceAccount() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (privateKey) {
    privateKey = privateKey.trim();
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
      privateKey = privateKey.slice(1, -1);
    }
    privateKey = privateKey.replace(/\\n/g, "\n");
  }

  return { projectId, clientEmail, privateKey };
}

export function getAdminApp() {
  const { projectId, clientEmail, privateKey } = readServiceAccount();
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Falta configurar Firebase en el servidor.");
  }

  if (!getApps().length) {
    initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
  }

  return getApps()[0];
}

export function getFirestoreDb() {
  getAdminApp();
  return getFirestore();
}

export function getAuthAdmin() {
  getAdminApp();
  return getAuth();
}

export function slugFromUsername(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9._]/g, "");
}

export function isAdminUsername(profile, username) {
  const raw = process.env.VITE_ADMIN_USERNAMES || "";
  const slugs = String(raw + ",Miguel_NP_10")
    .split(",")
    .map((s) => slugFromUsername(s))
    .filter(Boolean);
  const fromEmail = String((profile && profile.email) || "").split("@")[0];
  const candidates = [username, profile && profile.username, fromEmail];
  return candidates.some((value) => {
    const slug = slugFromUsername(value);
    return !!slug && slugs.includes(slug);
  });
}
