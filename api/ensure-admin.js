import { readSession, json } from "./_lib/session.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Método no permitido" });
    return;
  }
  try {
    const session = await readSession(req);
    if (!session.admin) {
      json(res, 403, { error: "Solo el administrador puede activar este permiso." });
      return;
    }
    await session.auth.setCustomUserClaims(session.uid, { admin: true });
    await session.db.collection("admins").doc(session.uid).set(
      {
        username: session.profile.username || "",
        at: Date.now(),
      },
      { merge: true },
    );
    await session.db.collection("users").doc(session.uid).set({ role: "admin" }, { merge: true });
    json(res, 200, { ok: true });
  } catch (err) {
    json(res, err.status || 500, { error: err.message || "No se pudo verificar el administrador." });
  }
}
