/**
 * Guarda el video del sorteo en Firebase Storage y deja
 * el enlace en el documento de Firestore (draws/{id}),
 * para que el administrador lo tenga por fecha.
 * Solo se conservan los archivos de los últimos 6 meses.
 */
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { getFirestore, doc, setDoc, collection, getDocs, deleteField } from "firebase/firestore";
import { getFirebaseApp } from "./db.js";

export const DRAW_VIDEO_MONTHS = 6;

export function bogotaDateKey(ts) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(ts ? new Date(ts) : new Date());
}

export function retentionCutoffTs() {
  const d = new Date();
  d.setMonth(d.getMonth() - DRAW_VIDEO_MONTHS);
  return d.getTime();
}

export function isWithinVideoRetention(ts) {
  return (Number(ts) || 0) >= retentionCutoffTs();
}

export async function pruneExpiredDrawArchives() {
  const app = getFirebaseApp();
  if (!app) return 0;
  const firestore = getFirestore(app);
  const storage = getStorage(app);
  const cutoff = retentionCutoffTs();
  let removed = 0;
  try {
    const snap = await getDocs(collection(firestore, "draws"));
    for (const item of snap.docs) {
      const data = item.data() || {};
      if ((Number(data.ts) || 0) >= cutoff) continue;
      if (data.videoPath) {
        try {
          await deleteObject(ref(storage, data.videoPath));
        } catch {
          /* el archivo ya no estaba */
        }
      }
      if (data.videoUrl || data.videoPath) {
        await setDoc(
          doc(firestore, "draws", item.id),
          { videoUrl: deleteField(), videoPath: deleteField() },
          { merge: true }
        );
        removed++;
      }
    }
  } catch {
    return removed;
  }
  return removed;
}

const LOCAL_DB = "dorado-draw-media";
const LOCAL_STORE = "files";

function openLocalDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("no-idb"));
      return;
    }
    const req = indexedDB.open(LOCAL_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LOCAL_STORE)) db.createObjectStore(LOCAL_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLocalDrawMedia(id, file) {
  if (!id || !file) return;
  try {
    const db = await openLocalDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(LOCAL_STORE).put(file, String(id));
    });
  } catch {
    /* el celular puede bloquear IndexedDB; el sorteo sigue */
  }
}

export async function loadLocalDrawMedia(id) {
  if (!id) return null;
  try {
    const db = await openLocalDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_STORE, "readonly");
      const req = tx.objectStore(LOCAL_STORE).get(String(id));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function archiveDrawVideo(blob, meta) {
  try {
    const app = getFirebaseApp();
    if (!app || !blob) return null;
    const dateKey = meta.dateKey || bogotaDateKey(meta.ts);
    const ext = blob.type && blob.type.indexOf("png") >= 0 ? "png" : blob.type && blob.type.indexOf("mp4") >= 0 ? "mp4" : "webm";
    const drawId = String(meta.drawId || dateKey + "-" + Date.now());
    const path = "draw-videos/" + dateKey + "/" + drawId + "." + ext;
    const storage = getStorage(app);
    const fileRef = ref(storage, path);
    await uploadBytes(fileRef, blob, { contentType: blob.type || "video/webm" });
    const videoUrl = await getDownloadURL(fileRef);
    const payload = {
      cardValue: meta.cardValue,
      winningNumber: meta.winningNumber,
      winnerName: meta.winnerName,
      winnerCity: meta.winnerCity,
      winnerUid: meta.winnerUid || null,
      prize: meta.prize,
      collected: meta.collected || null,
      paidCount: meta.paidCount || null,
      ts: meta.ts || Date.now(),
      dateKey,
      videoUrl,
      videoPath: path,
    };
    await setDoc(doc(getFirestore(app), "draws", drawId), payload, { merge: true });
    pruneExpiredDrawArchives().catch(() => {});
    const fileName = "sorteo-" + dateKey + "-" + fmtValue(meta.cardValue) + "-" + meta.winningNumber + "." + ext;
    return {
      url: videoUrl,
      path,
      file: new File([blob], fileName, { type: blob.type || "video/webm" }),
    };
  } catch {
    return null;
  }
}

function fmtValue(n) {
  return String(n || 0);
}
