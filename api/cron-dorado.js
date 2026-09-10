import { getFirestoreDb } from "./_lib/firebaseAdmin.js";
import { json } from "./_lib/session.js";
import {
  CARD_VALUES,
  bogotaStamp,
  cardForDb,
  DRAW_HOUR_BOGOTA,
  emptyCard,
  expireHolds,
  startDraw,
} from "./_lib/cardsLogic.js";

function isCron(req) {
  if (req.headers["x-vercel-cron"] === "1") return true;
  const secret = process.env.CRON_SECRET;
  const auth = String(req.headers.authorization || "");
  return !!(secret && auth === "Bearer " + secret);
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    json(res, 405, { error: "Método no permitido" });
    return;
  }
  if (!isCron(req)) {
    json(res, 401, { error: "No autorizado." });
    return;
  }
  try {
    const db = getFirestoreDb();
    const { date, hour } = bogotaStamp();
    const runDraw = hour >= DRAW_HOUR_BOGOTA;
    const result = [];
    for (const value of CARD_VALUES) {
      const ref = db.collection("cards").doc(String(value));
      const snap = await ref.get();
      const card = snap.exists ? snap.data() : emptyCard(value, []);
      card.value = value;
      if (!card.numbers) card.numbers = {};
      expireHolds(card);
      if (runDraw && card.status === "open") {
        startDraw(card, false);
      }
      await ref.set(cardForDb(card));
      result.push({ value, status: card.status, lastDrawDate: card.lastDrawDate, date });
    }
    json(res, 200, { ok: true, result });
  } catch (err) {
    json(res, 500, { error: err.message || "No se pudo ejecutar el mantenimiento." });
  }
}
