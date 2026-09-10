import { getAuthAdmin, getFirestoreDb, isAdminUsername } from "./firebaseAdmin.js";

export function bearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

export async function readSession(req) {
  const token = bearerToken(req);
  if (!token) {
    const err = new Error("Entra con tu cuenta para continuar.");
    err.status = 401;
    throw err;
  }
  const auth = getAuthAdmin();
  const db = getFirestoreDb();
  let decoded;
  try {
    decoded = await auth.verifyIdToken(token);
  } catch {
    const err = new Error("Sesión no válida. Vuelve a entrar.");
    err.status = 401;
    throw err;
  }
  const snap = await db.collection("users").doc(decoded.uid).get();
  const profile = snap.exists ? snap.data() || {} : {};
  const admin =
    decoded.admin === true || isAdminUsername(profile, profile.username || decoded.name);
  return { uid: decoded.uid, decoded, profile, admin, db, auth };
}

export function json(res, status, body) {
  res.status(status).json(body);
}
