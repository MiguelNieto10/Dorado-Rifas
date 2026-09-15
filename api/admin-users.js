import { readSession, json } from "./_lib/session.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    json(res, 405, { error: "Método no permitido" });
    return;
  }
  try {
    const session = await readSession(req);
    if (!session.admin) {
      json(res, 403, { error: "Solo el administrador puede ver las cuentas." });
      return;
    }
    const snap = await session.db.collection("users").get();
    const users = snap.docs.map((d) => {
      const data = d.data() || {};
      return {
        id: d.id,
        uid: d.id,
        username: data.username || "",
        fullName: data.fullName || "",
        email: data.email || "",
        phone: data.phone || "",
        role: data.role || "",
        createdAt: data.createdAt || 0,
      };
    });
    json(res, 200, { users });
  } catch (err) {
    json(res, err.status || 500, { error: err.message || "No se pudieron leer las cuentas." });
  }
}
