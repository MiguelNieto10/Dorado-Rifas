import { readSession, json } from "./_lib/session.js";

function createdAtMs(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number" && isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (isFinite(n) && n > 0) return n;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (value.toMillis) return value.toMillis();
  if (value.seconds != null) return Number(value.seconds) * 1000;
  return 0;
}

function mergeUsers(lists) {
  const map = new Map();
  lists.forEach((list) => {
    (list || []).forEach((u) => {
      if (!u) return;
      const key = String(u.uid || u.id || "").trim();
      if (!key) return;
      const prev = map.get(key) || {};
      const a = createdAtMs(prev.createdAt);
      const b = createdAtMs(u.createdAt);
      map.set(key, {
        ...prev,
        ...u,
        id: prev.id || u.id || key,
        uid: prev.uid || u.uid || key,
        username: u.username || prev.username || "",
        fullName: u.fullName || prev.fullName || "",
        phone: u.phone || prev.phone || "",
        email: u.email || prev.email || "",
        role: u.role || prev.role || "",
        createdAt: a && b ? Math.min(a, b) : b || a,
      });
    });
  });
  return Array.from(map.values());
}

async function listAuthUsers(auth) {
  const out = [];
  let nextPageToken;
  do {
    const page = await auth.listUsers(1000, nextPageToken);
    page.users.forEach((u) => {
      const meta = u.metadata || {};
      out.push({
        id: u.uid,
        uid: u.uid,
        username: u.displayName || "",
        email: u.email || "",
        phone: u.phoneNumber || "",
        role: "",
        createdAt: meta.creationTime ? Date.parse(meta.creationTime) : 0,
      });
    });
    nextPageToken = page.pageToken;
  } while (nextPageToken);
  return out;
}

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
    const [usersSnap, namesSnap, authUsers] = await Promise.all([
      session.db.collection("users").get(),
      session.db.collection("usernames").get(),
      listAuthUsers(session.auth).catch(() => []),
    ]);
    const fromUsers = usersSnap.docs.map((d) => {
      const data = d.data() || {};
      return {
        id: d.id,
        uid: d.id,
        username: data.username || "",
        fullName: data.fullName || "",
        email: data.email || "",
        phone: data.phone || "",
        role: data.role || "",
        createdAt: createdAtMs(data.createdAt),
      };
    });
    const fromNames = namesSnap.docs.map((d) => {
      const data = d.data() || {};
      return {
        id: data.uid || "",
        uid: data.uid || "",
        username: data.username || d.id,
        email: data.email || "",
        phone: "",
        role: "",
        createdAt: createdAtMs(data.createdAt),
      };
    });
    json(res, 200, { users: mergeUsers([authUsers, fromNames, fromUsers]) });
  } catch (err) {
    json(res, err.status || 500, { error: err.message || "No se pudieron leer las cuentas." });
  }
}
