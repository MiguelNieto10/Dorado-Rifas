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

export async function archiveDrawVideo(blob, meta) {
  const app = getFirebaseApp();
  if (!app || !blob) return null;
  const dateKey = meta.dateKey || bogotaDateKey(meta.ts);
  const ext = blob.type && blob.type.indexOf("mp4") >= 0 ? "mp4" : "webm";
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
}

function fmtValue(n) {
  return String(n || 0);
}
