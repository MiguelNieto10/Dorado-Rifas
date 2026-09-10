/**
 * Adaptador de Firebase Firestore.
 *
 * La app original pedía la base de datos así:
 *   db = await window.claude.use('db')
 * y luego usaba:
 *   db.doc('cards/2000').onSnapshot(...)
 *   db.doc('cards/2000').set(card)
 *
 * Ese `window.claude` SOLO existe dentro de Claude. Aquí devolvemos
 * un objeto con la MISMA forma (doc / onSnapshot / set / exists / data),
 * para no tener que reescribir la lógica de cartones, sorteo ni billetera.
 *
 * Las claves VITE_FIREBASE_* son públicas a propósito: Firebase las
 * diseñó para el navegador. La seguridad real se pone en las reglas
 * de Firestore (archivo firestore.rules). Las llaves SECRETAS de
 * ePayco NO van aquí: van en api/ y en variables de entorno del servidor.
 */
import { initializeApp } from "firebase/app";
import { getFirestore, doc, onSnapshot, setDoc } from "firebase/firestore";

export function connectFirestore() {
  const config = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };

  if (!config.apiKey || !config.projectId) {
    return null;
  }

  const app = initializeApp(config);
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
