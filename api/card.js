import { readSession, json } from "./_lib/session.js";
import {
  CARD_VALUES,
  HOLD_MS,
  bogotaStamp,
  cardForDb,
  emptyCard,
  expireHolds,
  isHeld,
  normalizeNums,
  reopenCard,
  recountSold,
  settleDraw,
  startDraw,
} from "./_lib/cardsLogic.js";

function asInt(v) {
  return parseInt(v, 10);
}

async function loadCard(db, value) {
  const ref = db.collection("cards").doc(String(value));
  const snap = await ref.get();
  if (snap.exists) {
    const card = snap.data() || {};
    if (!card.numbers) card.numbers = {};
    card.value = value;
    return { ref, card };
  }
  const card = emptyCard(value, []);
  await ref.set(cardForDb(card));
  return { ref, card };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Método no permitido" });
    return;
  }
  try {
    const session = await readSession(req);
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const action = String(body.action || "");
    const value = asInt(body.value);
    if (!CARD_VALUES.includes(value)) {
      json(res, 400, { error: "Tablero no válido." });
      return;
    }
    const { ref, card } = await loadCard(session.db, value);

    if (action === "reserve") {
      if (card.status && card.status !== "open") {
        json(res, 409, { error: "Ese tablero no está abierto." });
        return;
      }
      expireHolds(card);
      const nums = normalizeNums(body.numbers);
      if (!nums.length) {
        json(res, 400, { error: "Elige al menos un número." });
        return;
      }
      for (const n of nums) {
        const slot = card.numbers[n];
        if (slot && (isHeld(slot) || slot.confirmed || !slot.pending)) {
          json(res, 409, { error: "El número " + n + " ya no está libre." });
          return;
        }
      }
      const profile = session.profile || {};
      const hold = {
        owner: profile.username || "Jugador",
        fullName: profile.fullName || profile.username || "Jugador",
        phone: profile.phone || "",
        city: "Bogotá",
        isUser: true,
        ownerUid: session.uid,
        boughtAt: Date.now(),
        pending: true,
        confirmed: false,
        heldUntil: Date.now() + HOLD_MS,
      };
      nums.forEach((n) => {
        card.numbers[n] = hold;
      });
      recountSold(card);
      await ref.set(cardForDb(card));
      json(res, 200, { ok: true, card: cardForDb(card) });
      return;
    }

    if (action === "confirm") {
      if (!session.admin) {
        json(res, 403, { error: "Solo el administrador puede pasar un número a verde." });
        return;
      }
      const num = String(body.num || "").padStart(2, "0");
      const slot = card.numbers && card.numbers[num];
      if (!isHeld(slot)) {
        json(res, 409, { error: "Ese número no está reservado." });
        return;
      }
      slot.pending = false;
      slot.confirmed = true;
      delete slot.heldUntil;
      recountSold(card);
      await ref.set(cardForDb(card));
      json(res, 200, { ok: true, card: cardForDb(card) });
      return;
    }

    if (action === "expire") {
      if (!expireHolds(card)) {
        json(res, 200, { ok: true, card: cardForDb(card) });
        return;
      }
      await ref.set(cardForDb(card));
      json(res, 200, { ok: true, card: cardForDb(card) });
      return;
    }

    if (action === "start-draw") {
      if (!session.admin) {
        json(res, 403, { error: "Solo el administrador puede iniciar un sorteo." });
        return;
      }
      const result = startDraw(card, !!body.force);
      if (!result.ok && result.reason === "already") {
        json(res, 200, { ok: true, card: cardForDb(card) });
        return;
      }
      await ref.set(cardForDb(card));
      json(res, 200, { ok: true, card: cardForDb(card) });
      return;
    }

    if (action === "settle") {
      const result = settleDraw(card);
      if (!result.ok) {
        json(res, result.reason === "early" ? 409 : 400, { error: "El sorteo aún no se puede cerrar." });
        return;
      }
      if (!result.already) {
        await ref.set(cardForDb(card));
        const drawId = card.drawId || value + "-" + card.pendingWinner;
        await session.db
          .collection("draws")
          .doc(String(drawId))
          .set(
            Object.assign(result.draw, {
              dateKey: bogotaStamp().date,
              newCardOpen: true,
            }),
            { merge: true },
          );
      }
      json(res, 200, { ok: true, card: cardForDb(card) });
      return;
    }

    if (action === "reopen") {
      const result = reopenCard(card);
      if (!result.ok) {
        json(res, 409, { error: "Aún no se puede reabrir el tablero." });
        return;
      }
      await ref.set(cardForDb(result.card));
      json(res, 200, { ok: true, card: cardForDb(result.card) });
      return;
    }

    if (action === "save") {
      if (!session.admin) {
        json(res, 403, { error: "Solo el administrador puede guardar el tablero completo." });
        return;
      }
      const incoming = body.card && typeof body.card === "object" ? body.card : card;
      incoming.value = value;
      if (!incoming.numbers) incoming.numbers = {};
      await ref.set(cardForDb(incoming));
      json(res, 200, { ok: true, card: cardForDb(incoming) });
      return;
    }

    json(res, 400, { error: "Acción no válida." });
  } catch (err) {
    json(res, err.status || 500, { error: err.message || "No se pudo actualizar el tablero." });
  }
}
