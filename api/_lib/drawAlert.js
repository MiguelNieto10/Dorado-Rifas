import { CARD_VALUES, isPaid, pad2 } from "./cardsLogic.js";

const SITE = "https://dorado-rifas.vercel.app";

export function alertMessage(boards) {
  const list = (boards || []).map((v) => "$" + Number(v).toLocaleString("es-CO")).join(", ");
  return [
    "🏆 *Dorado Rifas*",
    "En 5 minutos inicia el sorteo.",
    "Se juega tablero por tablero, empezando por *$2.000*" + (list ? " (hoy: " + list + ")" : "") + ".",
    "Solo entran números *verdes y pagos*.",
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
