import { initializeApp, getApps } from "firebase/app";
import { getFirestore, doc, onSnapshot, setDoc } from "firebase/firestore";

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

export function getFirebaseApp() {
  const config = getFirebaseConfig();
  if (!config.apiKey || !config.projectId) return null;
  return getApps().length ? getApps()[0] : initializeApp(config);
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
          return setDoc(ref, data);
        },
      };
    },
  };
}
