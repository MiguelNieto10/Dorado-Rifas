import { sendDoradoMail } from "./_lib/mailer.js";
import { welcomeHtml, welcomeSubject, welcomeText } from "./_lib/welcomeEmail.js";

function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return {};
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }

  const body = readJson(req);
  const email = String(body.email || "").trim().toLowerCase();
  const username = String(body.username || "").trim();
  if (!isValidEmail(email) || email.endsWith("@dorado-rifas.app")) {
    res.status(400).json({ error: "Falta un correo válido." });
    return;
  }

  try {
    await sendDoradoMail({
      to: email,
      subject: welcomeSubject(username),
      text: welcomeText(username),
      html: welcomeHtml(username),
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({
      ok: false,
      skipped: err.status === 503,
      error: (err && err.message) || "No se pudo enviar el correo de bienvenida.",
    });
  }
}
