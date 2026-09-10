import nodemailer from "nodemailer";
import { welcomeFrom, welcomeHtml, welcomeSubject, welcomeText } from "./_lib/welcomeEmail.js";

function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return {};
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function mailer() {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER || process.env.GMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
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

  const transport = mailer();
  if (!transport) {
    res.status(503).json({
      ok: false,
      skipped: true,
      error: "Falta SMTP_USER y SMTP_PASS (o GMAIL_USER y GMAIL_APP_PASSWORD) en Vercel.",
    });
    return;
  }

  try {
    await transport.sendMail({
      from: welcomeFrom(),
      to: email,
      replyTo: process.env.MAIL_FROM || "Administrador@dorado-rifas.vercel.app",
      subject: welcomeSubject(username),
      text: welcomeText(username),
      html: welcomeHtml(username),
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: (err && err.message) || "No se pudo enviar el correo de bienvenida.",
    });
  }
}
