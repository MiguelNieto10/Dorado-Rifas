import nodemailer from "nodemailer";
import { CARD_VALUES, isPaid, pad2 } from "./cardsLogic.js";
import { welcomeFrom } from "./welcomeEmail.js";

const SITE = "https://dorado-rifas.vercel.app";

export function alertMessage(boards) {
  const list = (boards || []).map((v) => "$" + Number(v).toLocaleString("es-CO")).join(", ");
  return (
    "Dorado Rifas: en 5 minutos inicia el sorteo. Se juega tablero por tablero, empezando por $2.000" +
    (list ? " (hoy: " + list + ")" : "") +
    ". Solo entran números verdes y pagos. Entra a " +
    SITE
  );
}

export function colombiaPhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("57") && d.length >= 12) return d.slice(0, 12);
  if (d.length === 10) return "57" + d;
  if (d.length === 11 && d.startsWith("3")) return "57" + d.slice(-10);
  return d.length >= 10 ? "57" + d.slice(-10) : "";
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

async function sendWhatsApp(phone, text) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId || !phone) return { ok: false, skipped: true };
  const res = await fetch("https://graph.facebook.com/v21.0/" + phoneId + "/messages", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: { body: text, preview_url: false },
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, error: data.error && data.error.message };
}

async function sendSms(phone, text) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !auth || !from || !phone) return { ok: false, skipped: true };
  const res = await fetch("https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Messages.json", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(sid + ":" + auth).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: from, To: "+" + phone, Body: text }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, error: data.message };
}

export async function collectDrawPlayers(db) {
  const byKey = new Map();
  const boards = [];
  for (const value of CARD_VALUES) {
    const snap = await db.collection("cards").doc(String(value)).get();
    if (!snap.exists) continue;
    const card = snap.data() || {};
    const nums = [];
    const numbers = card.numbers || {};
    for (let i = 0; i < 100; i++) {
      const n = pad2(i);
      const slot = numbers[n];
      if (!isPaid(slot)) continue;
      nums.push(n);
      const uid = slot.ownerUid || "";
      const phone = colombiaPhone(slot.phone);
      const key = uid || phone || String(slot.owner || "") + n;
      const prev = byKey.get(key) || {
        uid,
        phone,
        email: "",
        username: slot.owner || "",
        fullName: slot.fullName || slot.owner || "",
        boards: [],
      };
      if (!prev.boards.includes(value)) prev.boards.push(value);
      if (phone) prev.phone = phone;
      byKey.set(key, prev);
    }
    if (nums.length) boards.push(value);
  }

  const players = [...byKey.values()];
  for (const p of players) {
    if (!p.uid) continue;
    try {
      const u = await db.collection("users").doc(p.uid).get();
      if (!u.exists) continue;
      const data = u.data() || {};
      if (data.email) p.email = String(data.email).toLowerCase();
      if (!p.phone && data.phone) p.phone = colombiaPhone(data.phone);
      if (data.username) p.username = data.username;
    } catch {
      /* sigue con lo del tablero */
    }
  }
  return { boards, players };
}

export async function sendDrawAlerts(db, date) {
  const noticeRef = db.collection("notices").doc("draw-" + date);
  const existing = await noticeRef.get();
  if (existing.exists && existing.data() && existing.data().sent) {
    return { ok: true, already: true, notice: existing.data() };
  }

  const { boards, players } = await collectDrawPlayers(db);
  const text = alertMessage(boards);
  const transport = mailer();
  const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER;
  const results = [];

  for (const p of players) {
    const row = { username: p.username, phone: p.phone, email: p.email, wa: null, sms: null, mail: null };
    if (p.phone) {
      row.wa = await sendWhatsApp(p.phone, text);
      if (!row.wa.ok) row.sms = await sendSms(p.phone, text);
    }
    const email = p.email && !String(p.email).endsWith("@dorado-rifas.app") ? p.email : "";
    if (email && transport) {
      try {
        await transport.sendMail({
          from: welcomeFrom(),
          to: email,
          subject: "Dorado: el sorteo inicia en 5 minutos",
          text,
        });
        row.mail = { ok: true };
      } catch (err) {
        row.mail = { ok: false, error: err.message };
      }
    }
    results.push(row);
  }

  const notice = {
    sent: true,
    sentAt: Date.now(),
    date,
    boards,
    text,
    uids: players.map((p) => p.uid).filter(Boolean),
    phones: players.map((p) => p.phone).filter(Boolean),
    count: players.length,
  };
  await noticeRef.set(notice);
  return { ok: true, already: false, notice, results, smtp: !!(transport && smtpUser) };
}
