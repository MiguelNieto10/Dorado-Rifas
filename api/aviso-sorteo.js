import { getFirestoreDb } from "./_lib/firebaseAdmin.js";
import { bogotaStamp } from "./_lib/cardsLogic.js";
import { sendDrawAlerts } from "./_lib/drawAlert.js";
import { json, readSession } from "./_lib/session.js";

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
  try {
    let allowed = isCron(req);
    if (!allowed) {
      try {
        const session = await readSession(req);
        allowed = !!(session && session.admin);
      } catch (err) {
        json(res, err.status || 401, { error: err.message || "No autorizado." });
        return;
      }
    }
    if (!allowed) {
      json(res, 401, { error: "No autorizado." });
      return;
    }
    const db = getFirestoreDb();
    const { date } = bogotaStamp();
    const out = await sendDrawAlerts(db, date);
    json(res, 200, out);
  } catch (err) {
    json(res, err.status || 500, { error: err.message || "No se pudo enviar el aviso." });
  }
}
