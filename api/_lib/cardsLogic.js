import { randomInt } from "node:crypto";

export const CARD_VALUES = [2000, 5000, 10000, 20000, 50000, 100000];
export const HOLD_MS = 60 * 60 * 1000;
export const SPIN_MS = 10000;
export const REVEAL_HOLD_MS = 10000;
export const DRAW_HOUR_BOGOTA = 21;
export const BOARD_LIVE_GEN = 4;

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function isHeld(slot) {
  return !!(slot && slot.pending && !slot.confirmed && slot.heldUntil && Date.now() < slot.heldUntil);
}

export function isPaid(slot) {
  if (!slot) return false;
  if (isHeld(slot)) return false;
  if (slot.pending && !slot.confirmed) return false;
  return true;
}

export function paidNumbers(card) {
  return Object.keys(card.numbers || {}).filter((n) => isPaid(card.numbers[n]));
}

export function recountSold(card) {
  card.sold = paidNumbers(card).length;
}

export function expireHolds(card) {
  if (!card || !card.numbers) return false;
  let changed = false;
  Object.keys(card.numbers).forEach((n) => {
    const slot = card.numbers[n];
    if (slot && slot.pending && !slot.confirmed && slot.heldUntil && Date.now() >= slot.heldUntil) {
      card.numbers[n] = null;
      changed = true;
    }
  });
  if (changed) recountSold(card);
  return changed;
}

export function emptyCard(value, history) {
  const numbers = {};
  for (let i = 0; i < 100; i++) numbers[pad2(i)] = null;
  return {
    value,
    numbers,
    sold: 0,
    status: "open",
    countdownEndsAt: null,
    spinEndsAt: null,
    pendingWinner: null,
    history: history || [],
    lastDrawDate: null,
    drawCollected: null,
    boardGen: BOARD_LIVE_GEN,
  };
}

export function cardForDb(card) {
  const numbers = {};
  Object.keys(card.numbers || {}).forEach((n) => {
    if (card.numbers[n]) numbers[n] = card.numbers[n];
  });
  return Object.assign({}, card, { numbers, boardGen: BOARD_LIVE_GEN });
}

export function bogotaStamp() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return {
    date: parts.year + "-" + parts.month + "-" + parts.day,
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
  };
}

export function startDraw(card, force) {
  expireHolds(card);
  const { date } = bogotaStamp();
  if (!force && card.lastDrawDate === date) return { ok: false, reason: "already" };
  const pool = paidNumbers(card);
  card.lastDrawDate = date;
  if (pool.length === 0) {
    card.status = "open";
    return { ok: true, empty: true };
  }
  if (card.status === "drawing" && card.pendingWinner) return { ok: true, already: true };
  card.status = "drawing";
  card.spinEndsAt = Date.now() + SPIN_MS;
  card.pendingWinner = pool[randomInt(pool.length)];
  card.drawCollected = pool.length * card.value;
  card.drawId = card.value + "-" + Date.now();
  card.drawSettled = false;
  card.revealEndsAt = null;
  return { ok: true };
}

export function settleDraw(card) {
  if (!card || !card.pendingWinner) return { ok: false, reason: "no-draw" };
  if (card.drawSettled) return { ok: true, already: true };
  if (card.status !== "drawing") return { ok: false, reason: "status" };
  if (card.spinEndsAt && Date.now() < card.spinEndsAt) return { ok: false, reason: "early" };
  const winnerSlot = card.numbers && card.numbers[card.pendingWinner];
  const value = card.value;
  const prize = (card.drawCollected != null ? card.drawCollected : paidNumbers(card).length * value) * 0.5;
  const paidCount = card.drawCollected != null ? Math.round(card.drawCollected / value) : paidNumbers(card).length;
  card.drawSettled = true;
  card.status = "revealed";
  card.revealEndsAt = Date.now() + REVEAL_HOLD_MS;
  card.history = [
    {
      winningNumber: card.pendingWinner,
      winnerName: winnerSlot ? winnerSlot.owner : "Sin comprador",
      winnerCity: winnerSlot ? winnerSlot.city : "—",
      prize,
      wonByUser: false,
      ts: Date.now(),
      winnerUid: winnerSlot && winnerSlot.ownerUid ? winnerSlot.ownerUid : null,
    },
  ]
    .concat(card.history || [])
    .slice(0, 365);
  return {
    ok: true,
    draw: {
      cardValue: value,
      winningNumber: card.pendingWinner,
      winnerName: winnerSlot ? winnerSlot.owner : "Sin comprador",
      winnerCity: winnerSlot ? winnerSlot.city : "—",
      winnerUid: winnerSlot && winnerSlot.ownerUid ? winnerSlot.ownerUid : null,
      prize,
      collected: card.drawCollected != null ? card.drawCollected : prize * 2,
      paidCount,
      ts: Date.now(),
    },
  };
}

export function reopenCard(card) {
  if (!card) return { ok: false };
  if (card.status !== "revealed") return { ok: false, reason: "status" };
  if (card.revealEndsAt && Date.now() < card.revealEndsAt) return { ok: false, reason: "early" };
  const fresh = emptyCard(card.value, card.history || []);
  fresh.lastDrawDate = card.lastDrawDate;
  return { ok: true, card: fresh };
}

export function normalizeNums(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  list.forEach((n) => {
    const s = String(n).padStart(2, "0");
    if (/^\d{2}$/.test(s) && parseInt(s, 10) <= 99 && !out.includes(s)) out.push(s);
  });
  return out.slice(0, 20);
}
