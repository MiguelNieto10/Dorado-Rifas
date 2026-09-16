import nodemailer from "nodemailer";
import { welcomeFrom } from "./welcomeEmail.js";

export function smtpUser() {
  return String(process.env.SMTP_USER || process.env.GMAIL_USER || "").trim();
}

export function smtpPass() {
  return String(process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || "").trim();
}

export function createMailer() {
  const user = smtpUser();
  const pass = smtpPass();
  if (!user || !pass) return null;
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendDoradoMail({ to, subject, text, html }) {
  const transport = createMailer();
  const user = smtpUser();
  if (!transport || !user) {
    const err = new Error("Falta SMTP_USER y SMTP_PASS en Vercel para enviar correos.");
    err.status = 503;
    throw err;
  }
  await transport.sendMail({
    from: welcomeFrom(),
    sender: user,
    to,
    replyTo: user,
    envelope: { from: user, to },
    subject,
    text,
    html,
    headers: {
      "X-Priority": "1",
      "X-Auto-Response-Suppress": "OOF, AutoReply",
    },
  });
}
