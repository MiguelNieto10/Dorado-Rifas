/**
 * Confirma un pedido de clave nueva. Solo un administrador logueado
 * puede llamar. El servidor cambia la clave en Firebase Auth y la
 * devuelve una vez, para enviarla por WhatsApp. No se guarda en Firestore.
 */
import { randomInt } from "node:crypto";
import { getAuthAdmin, getFirestoreDb, isAdminUsername, slugFromUsername } from "./_lib/firebaseAdmin.js";

function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return {};
}

function bearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }

  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Entra como administrador para confirmar." });
    return;
  }

  let decoded;
  let db;
  let auth;
  try {
    auth = getAuthAdmin();
    db = getFirestoreDb();
    decoded = await auth.verifyIdToken(token);
  } catch (err) {
    const msg = err && err.message;
    if (msg && msg.indexOf("Falta configurar") >= 0) {
      res.status(503).json({
        error:
          "Falta la cuenta de servicio de Firebase en Vercel (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) para poder cambiar claves.",
      });
      return;
    }
    res.status(401).json({ error: "Sesión de administrador no válida." });
    return;
  }

  const adminSnap = await db.collection("users").doc(decoded.uid).get();
  const adminProfile = adminSnap.exists ? adminSnap.data() : {};
  if (!isAdminUsername(adminProfile, adminProfile.username || decoded.name)) {
    res.status(403).json({ error: "Solo un administrador puede confirmar esto." });
    return;
  }

  const body = readJson(req);
  const slug = slugFromUsername(body.slug || body.username || "");
  if (!slug) {
    res.status(400).json({ error: "Falta el usuario." });
    return;
  }

  const resetRef = db.collection("passwordResets").doc(slug);
  const resetSnap = await resetRef.get();
  if (!resetSnap.exists) {
    res.status(404).json({ error: "No hay un pedido de clave para ese usuario." });
    return;
  }
  const reset = resetSnap.data() || {};
  if (reset.status && reset.status !== "pending") {
    res.status(409).json({ error: "Ese pedido ya fue atendido." });
    return;
  }

  const uid = reset.uid;
  if (!uid) {
    res.status(400).json({ error: "Ese pedido no tiene cuenta asociada." });
    return;
  }

  const password = "Dorado-" + String(randomInt(1000, 10000));
  try {
    await auth.updateUser(uid, { password });
  } catch {
    res.status(500).json({ error: "No se pudo cambiar la clave en Firebase." });
    return;
  }

  await resetRef.set(
    {
      status: "done",
      resolvedAt: Date.now(),
      resolvedBy: decoded.uid,
    },
    { merge: true },
  );

  res.status(200).json({
    ok: true,
    username: reset.username || slug,
    phone: reset.phone || "",
    password,
  });
}
