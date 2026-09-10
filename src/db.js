import { initializeApp, getApps } from "firebase/app";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc } from "firebase/firestore";

function cleanForDb(data) {
  return JSON.parse(JSON.stringify(data));
}

export function getFirebaseConfig() {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };
}

export function siteMode() {
  const path = (typeof location === "undefined" ? "/" : location.pathname || "/").replace(/\/+$/, "") || "/";
  if (path === "/admin" || path.endsWith("/admin.html")) return "admin";
  if (typeof location !== "undefined" && new URLSearchParams(location.search).has("admin")) return "admin";
  return "player";
}

export function siteWindowName() {
  return siteMode() === "admin" ? "dorado-admin" : "dorado-player";
}

export function getFirebaseApp() {
  const config = getFirebaseConfig();
  if (!config.apiKey || !config.projectId) return null;
  const name = siteMode() === "admin" ? "dorado-admin" : "dorado-player";
  const found = getApps().find((app) => app.name === name);
  return found || initializeApp(config, name);
}

export function connectFirestore() {
  const app = getFirebaseApp();
  if (!app) return null;
  const firestore = getFirestore(app);

  return {
    doc(path) {
      const [collectionName, documentId] = path.split("/");
      const ref = doc(firestore, collectionName, String(documentId));

      return {
        onSnapshot(onNext, onError) {
          return onSnapshot(
            ref,
            (snap) => {
              onNext({
                exists: snap.exists(),
                data: () => snap.data(),
              });
            },
            onError || (() => {}),
          );
        },
        set(data) {
          return setDoc(ref, cleanForDb(data));
        },
        patch(fields) {
          return updateDoc(ref, cleanForDb(fields));
        },
      };
    },
  };
}
