import { getAuthAdmin, getFirestoreDb, slugFromUsername } from "./_lib/firebaseAdmin.js";
import { sendDoradoMail } from "./_lib/mailer.js";
import { resetHtml, resetSubject, resetText } from "./_lib/resetEmail.js";

const SITE = "https://dorado-rifas.vercel.app";

function json(res, status, body) {
  res.status(status).json(body);
}

function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return {};
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function emailDocId(email) {
  return String(email || "")
    .trim()
    .toLowerCase()
    .replace(/\//g, "_");
}

function isSynthetic(email) {
  return String(email || "").toLowerCase().endsWith("@dorado-rifas.app");
}

async function resolveAccount(db, auth, input) {
  const raw = String(input || "").trim();
  const asEmail = raw.toLowerCase();
  let uid = "";
  let email = "";
  let username = "";

  if (isValidEmail(raw) && !isSynthetic(asEmail)) {
    email = asEmail;
    const emailSnap = await db.collection("emails").doc(emailDocId(email)).get();
    if (emailSnap.exists) {
      const d = emailSnap.data() || {};
      uid = d.uid || "";
      username = d.slug || "";
    }
    try {
      const au = await auth.getUserByEmail(email);
      uid = uid || au.uid;
      email = String(au.email || email).toLowerCase();
      username = username || au.displayName || "";
    } catch {
      /* puede estar solo en Firestore */
    }
  } else {
    const slug = slugFromUsername(raw);
    if (slug) {
      const nameSnap = await db.collection("usernames").doc(slug).get();
      if (nameSnap.exists) {
        const d = nameSnap.data() || {};
        uid = d.uid || "";
        email = String(d.email || "").toLowerCase();
        username = raw;
      }
    }
  }

  if (uid) {
    const userSnap = await db.collection("users").doc(uid).get();
    if (userSnap.exists) {
      const d = userSnap.data() || {};
      username = d.username || username;
      if (d.email) email = String(d.email).toLowerCase();
    }
    try {
      const au = await auth.getUser(uid);
      if (au.email) email = String(au.email).toLowerCase();
      username = username || au.displayName || "";
    } catch {
      /* sigue con lo de Firestore */
    }
  }

  return { uid, email, username };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Método no permitido" });
    return;
  }

  const body = readJson(req);
  const input = String(body.input || body.email || body.username || "").trim();
  if (!input) {
    json(res, 400, { error: "Escribe tu correo o tu nombre de usuario." });
    return;
  }

  try {
    const db = getFirestoreDb();
    const auth = getAuthAdmin();
    const found = await resolveAccount(db, auth, input);

    if (!found.uid && !found.email) {
      json(res, 404, { error: "No encontramos esa cuenta. Revisa el correo o el usuario." });
      return;
    }

    if (!found.email || isSynthetic(found.email)) {
      if (found.uid) {
        const slug = slugFromUsername(found.username || input);
        await db.collection("passwordResets").doc(slug).set(
          {
            uid: found.uid,
            username: found.username || input,
            phone: "",
            status: "pending",
            createdAt: Date.now(),
          },
          { merge: true }
        );
      }
      json(res, 200, { ok: true, via: "admin" });
      return;
    }

    const link = await auth.generatePasswordResetLink(found.email, {
      url: SITE + "/",
      handleCodeInApp: false,
    });

    await sendDoradoMail({
      to: found.email,
      subject: resetSubject(),
      text: resetText(found.username, link),
      html: resetHtml(found.username, link),
    });

    json(res, 200, { ok: true, via: "email", email: found.email });
  } catch (err) {
    json(res, err.status || 500, {
      error: err.message || "No se pudo enviar el correo de recuperación.",
    });
  }
}
