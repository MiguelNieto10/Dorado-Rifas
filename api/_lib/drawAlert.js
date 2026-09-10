import { CARD_VALUES, isPaid, pad2 } from "./cardsLogic.js";

const SITE = "https://dorado-rifas.vercel.app";

export function alertMessage(boards) {
  const list = (boards || []).map((v) => "$" + Number(v).toLocaleString("es-CO"));
  const today = list.length ? "Hoy hay verdes en: " + list.join(", ") + "." : "Hoy solo se sortean tableros con números verdes.";
  return [
    "Dorado Rifas",
    "En 5 minutos empieza el sorteo de hoy.",
    "",
    "Orden:",
    "1. Tablero de $2.000",
    "2. Luego $5.000, $10.000, $20.000, $50.000 y $100.000, en ese orden.",
    "",
    "Solo se sortea un tablero si tiene números en verde (pagos). Si no tiene verdes, se salta al siguiente.",
    today,
    "Entra a " + SITE,
  ].join("\n");
}

export async function collectDrawPlayers(db) {
  const byKey = new Map();
  const boards = [];
  for (const value of CARD_VALUES) {
    const snap = await db.collection("cards").doc(String(value)).get();
    if (!snap.exists) continue;
    const card = snap.data() || {};
    const numbers = card.numbers || {};
    let hasPaid = false;
    for (let i = 0; i < 100; i++) {
      const n = pad2(i);
      const slot = numbers[n];
      if (!isPaid(slot)) continue;
      hasPaid = true;
      const uid = slot.ownerUid || "";
      const key = uid || String(slot.owner || "") + n;
      const prev = byKey.get(key) || {
        uid,
        username: slot.owner || "",
        boards: [],
      };
      if (!prev.boards.includes(value)) prev.boards.push(value);
      byKey.set(key, prev);
    }
    if (hasPaid) boards.push(value);
  }
  return { boards, players: [...byKey.values()] };
}

export async function sendDrawAlerts(db, date) {
  const noticeRef = db.collection("notices").doc("draw-" + date);
  const existing = await noticeRef.get();
  if (existing.exists && existing.data() && existing.data().sent) {
    return { ok: true, already: true, notice: existing.data() };
  }

  const { boards, players } = await collectDrawPlayers(db);
  const text = alertMessage(boards);
  const notice = {
    sent: true,
    sentAt: Date.now(),
    date,
    boards,
    text,
    uids: players.map((p) => p.uid).filter(Boolean),
    count: players.length,
    channel: "group",
  };
  await noticeRef.set(notice);
  return { ok: true, already: false, notice };
}
