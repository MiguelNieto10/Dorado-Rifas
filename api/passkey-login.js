/**
 * Tras la huella en el celular, el servidor entrega un token corto
 * para entrar sin escribir la clave. El credId debe coincidir con
 * el guardado al registrar la huella.
 */
import { getAuthAdmin, getFirestoreDb } from "./_lib/firebaseAdmin.js";

function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return {};
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }

  const body = readJson(req);
  const credId = String(body.credId || "").trim();
  let uid = String(body.uid || "").trim();
  if (!credId && !uid) {
    res.status(400).json({ error: "No hay huella registrada en este celular." });
    return;
  }

  let auth;
  let db;
  try {
    auth = getAuthAdmin();
    db = getFirestoreDb();
  } catch {
    res.status(503).json({
      error: "Entra con tu usuario y clave, o restablece por correo. La huella quedará lista cuando el servidor tenga la cuenta de servicio.",
    });
    return;
  }

  try {
    if (credId) {
      const pk = await db.collection("passkeys").doc(credId).get();
      if (pk.exists && pk.data().uid) uid = pk.data().uid;
    }
    if (!uid) {
      res.status(404).json({ error: "No encontramos esa huella. Entra con tu clave o crea la cuenta de nuevo." });
      return;
    }
    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists) {
      res.status(404).json({ error: "Esa cuenta ya no existe. Crea la cuenta de nuevo." });
      return;
    }
    const token = await auth.createCustomToken(uid);
    res.status(200).json({ ok: true, token });
  } catch {
    res.status(500).json({ error: "No se pudo entrar con huella. Usa tu clave." });
  }
}
