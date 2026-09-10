/**
 * Guarda el video del sorteo en Firebase Storage y deja
 * el enlace en el documento de Firestore (draws/{id}),
 * para que el administrador lo tenga por fecha.
 */
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getFirestore, doc, setDoc } from "firebase/firestore";
import { getFirebaseApp } from "./db.js";

export function bogotaDateKey(ts) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(ts ? new Date(ts) : new Date());
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
