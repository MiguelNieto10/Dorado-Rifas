/**
 * Paneles solo para el administrador.
 * No cambia cómo juegan los demás: solo lee usuarios, compras y sorteos.
 */
import { getAuth } from "firebase/auth";
import { getFirestore, collection, getDocs, getDoc, doc, setDoc } from "firebase/firestore";
import { getFirebaseApp } from "./db.js";
import { slugFromUsername, isAdminAccount, WHATSAPP_GROUP_LINK } from "./auth.js";
import { isWithinVideoRetention, loadLocalDrawMedia } from "./drawStore.js";
import { winnerPosterFile } from "./drawRecord.js";

const KEEP_ADMIN_SLUG = "miguel_np_10";
const CARD_VALUES = [2000, 5000, 10000, 20000, 50000, 100000];
const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

let cachedUserRows = [];
let pickedUserYear = 0;
let pickedUserMonth = 0;

function bogotaNowParts() {
  try {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  } catch (e) {
    return { year: 2026, month: 9 };
  }
}

function createdAtMs(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number" && isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (isFinite(n) && n > 0) return n;
    const parsed = Date.parse(value);
    return isNaN(parsed) ? 0 : parsed;
  }
  try {
    if (typeof value.toMillis === "function") return value.toMillis();
    if (value.seconds != null) return Number(value.seconds) * 1000;
  } catch (e) {}
  return 0;
}

function bogotaCreatedParts(ts) {
  const t = createdAtMs(ts);
  if (!t) return null;
  try {
    const d = new Date(t);
    if (isNaN(d.getTime())) return null;
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  } catch (e) {
    return null;
  }
}

function isKeptAdminRow(u) {
  return slugFromUsername(u.username) === KEEP_ADMIN_SLUG;
}

function fmt(n) {
  return "$" + Math.round(n || 0).toLocaleString("es-CO");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function startOfRange(mode, dateStr) {
  const d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  if (Number.isNaN(d.getTime())) return 0;
  if (mode === "day") return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (mode === "month") return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  if (mode === "year") return new Date(d.getFullYear(), 0, 1).getTime();
  return 0;
}

function endOfRange(mode, dateStr) {
  const d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  if (Number.isNaN(d.getTime())) return Date.now();
  if (mode === "day") return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1;
  if (mode === "month") return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() - 1;
  if (mode === "year") return new Date(d.getFullYear() + 1, 0, 1).getTime() - 1;
  return Number.MAX_SAFE_INTEGER;
}

function inRange(ts, mode, dateStr) {
  if (mode === "all") return true;
  const t = Number(ts) || 0;
  return t >= startOfRange(mode, dateStr) && t <= endOfRange(mode, dateStr);
}

async function readCollection(firestore, name) {
  try {
    const snap = await Promise.race([
      getDocs(collection(firestore, name)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 12000)),
    ]);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

function slotIsPaid(slot) {
  if (!slot) return false;
  if (slot.pending && !slot.confirmed) return false;
  return true;
}

function slotBelongsToUser(slot, uid, username) {
  if (!slot) return false;
  if (uid && slot.ownerUid && slot.ownerUid === uid) return true;
  const owner = String(slot.owner || "").trim().toLowerCase();
  const name = String(username || "").trim().toLowerCase();
  return !!(name && owner && owner === name);
}

function userIsActiveNow(cardsCache, uid, username) {
  return CARD_VALUES.some((value) => {
    const card = cardsCache[value];
    if (!card || !card.numbers) return false;
    return Object.values(card.numbers).some((slot) => slotIsPaid(slot) && slotBelongsToUser(slot, uid, username));
  });
}

function activeCardsForUser(cardsCache, uid, username) {
  return CARD_VALUES.filter((value) => {
    const card = cardsCache[value];
    if (!card || !card.numbers) return false;
    return Object.values(card.numbers).some((slot) => slotIsPaid(slot) && slotBelongsToUser(slot, uid, username));
  });
}

async function loadUsersViaApi() {
  try {
    const app = getFirebaseApp();
    if (!app) return null;
    const user = getAuth(app).currentUser;
    if (!user) return null;
    const token = await Promise.race([
      user.getIdToken(true),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
    ]);
    const res = await Promise.race([
      fetch("/api/admin-users", { headers: { Authorization: "Bearer " + token } }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 12000)),
    ]);
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return Array.isArray(data.users) ? data.users : null;
  } catch {
    return null;
  }
}

function usersFromCards(cardsCache) {
  const map = new Map();
  CARD_VALUES.forEach((value) => {
    const card = cardsCache && cardsCache[value];
    const numbers = (card && card.numbers) || {};
    Object.keys(numbers).forEach((n) => {
      const slot = numbers[n];
      if (!slot) return;
      const username = slot.owner || slot.fullName || "";
      const uid = slot.ownerUid || "";
      const key = uid || slugFromUsername(username);
      if (!key) return;
      const prev = map.get(key) || {
        id: uid || key,
        uid: uid || key,
        username,
        fullName: slot.fullName || username,
        phone: slot.phone || "",
        email: "",
        createdAt: createdAtMs(slot.boughtAt),
      };
      if (username && !prev.username) prev.username = username;
      if (slot.phone && !prev.phone) prev.phone = slot.phone;
      const bought = createdAtMs(slot.boughtAt);
      if (bought && (!prev.createdAt || bought < prev.createdAt)) prev.createdAt = bought;
      map.set(key, prev);
    });
  });
  return Array.from(map.values());
}

function mergeUserLists() {
  const map = new Map();
  Array.from(arguments).forEach((list) => {
    (list || []).forEach((u) => {
      if (!u) return;
      const key = String(u.uid || u.id || slugFromUsername(u.username) || "");
      if (!key) return;
      const prev = map.get(key) || {};
      const a = createdAtMs(prev.createdAt);
      const b = createdAtMs(u.createdAt);
      map.set(key, {
        ...prev,
        ...u,
        id: prev.id || u.id || key,
        uid: prev.uid || u.uid || key,
        username: u.username || prev.username || "",
        phone: u.phone || prev.phone || "",
        email: u.email || prev.email || "",
        createdAt: a && b ? Math.min(a, b) : b || a,
      });
    });
  });
  return Array.from(map.values());
}

async function loadOwnUser(firestore) {
  try {
    const app = getFirebaseApp();
    if (!app) return [];
    const user = getAuth(app).currentUser;
    if (!user) return [];
    const snap = await getDoc(doc(firestore, "users", user.uid));
    if (snap.exists()) return [{ id: snap.id, uid: snap.id, ...snap.data() }];
    return [
      {
        id: user.uid,
        uid: user.uid,
        username: user.displayName || "Miguel_NP_10",
        email: user.email || "",
        phone: "",
        role: "admin",
        createdAt: 0,
      },
    ];
  } catch {
    return [];
  }
}

export async function loadAdminBundle(cardsCache) {
  const empty = { users: [], plays: [], draws: [], resets: [], cardsCache: cardsCache || {} };
  try {
    const app = getFirebaseApp();
    if (!app) return empty;
    const firestore = getFirestore(app);
    const fromApi = await loadUsersViaApi();
    const [usersClient, usernames, plays, draws, resets, own] = await Promise.all([
      readCollection(firestore, "users"),
      readCollection(firestore, "usernames"),
      readCollection(firestore, "plays"),
      readCollection(firestore, "draws"),
      readCollection(firestore, "passwordResets"),
      loadOwnUser(firestore),
    ]);
    const fromNames = (usernames || []).map((row) => ({
      id: row.uid || row.id,
      uid: row.uid || row.id,
      username: row.username || row.id,
      email: row.email || "",
      phone: "",
      createdAt: createdAtMs(row.createdAt),
    }));
    const fromPlays = (plays || []).map((p) => ({
      id: p.uid || slugFromUsername(p.username),
      uid: p.uid || slugFromUsername(p.username),
      username: p.username || "",
      phone: p.phone || "",
      email: "",
      createdAt: createdAtMs(p.ts),
    }));
    const users = mergeUserLists(fromApi, usersClient, fromNames, fromPlays, usersFromCards(cardsCache), own);
    return { users, plays, draws, resets, cardsCache: cardsCache || {} };
  } catch {
    return {
      users: mergeUserLists(usersFromCards(cardsCache)),
      plays: [],
      draws: [],
      resets: [],
      cardsCache: cardsCache || {},
    };
  }
}

function playNumKey(play, num) {
  return String(play.uid || play.username || "") + ":" + String(play.cardValue) + ":" + String(num).padStart(2, "0");
}

function collapsePlays(plays) {
  const sorted = (plays || []).slice().sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
  const seen = new Set();
  const kept = [];
  sorted.forEach((p) => {
    const nums = (p.numbers || []).map((n) => String(n).padStart(2, "0"));
    if (!nums.length) {
      kept.push(p);
      return;
    }
    const fresh = nums.filter((n) => {
      const key = playNumKey(p, n);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!fresh.length) return;
    const all = nums.length || Number(p.count) || 1;
    const amountEach = (Number(p.amount) || 0) / all;
    kept.push({
      ...p,
      numbers: fresh,
      count: fresh.length,
      amount: Math.round(amountEach * fresh.length),
    });
  });
  return kept;
}

function summarizeUser(user, uid, bundle, mode, dateStr) {
  const username = user.username || "—";
  const plays = collapsePlays(
    (bundle.plays || []).filter((p) => {
      const mine = (p.uid && p.uid === uid) || slugFromUsername(p.username) === slugFromUsername(username);
      return mine && inRange(p.ts, mode, dateStr);
    })
  );
  const numbersPaid = plays.reduce((n, p) => n + (Number(p.count) || (p.numbers || []).length || 0), 0);
  const spent = plays.reduce((n, p) => n + (Number(p.amount) || 0), 0);
  const cardsPlayed = new Set(plays.map((p) => p.cardValue).filter((v) => v != null)).size;
  const wins = (bundle.draws || []).filter((d) => {
    const mine = (d.winnerUid && d.winnerUid === uid) || String(d.winnerName || "").trim().toLowerCase() === String(username).trim().toLowerCase();
    return mine && inRange(d.ts, mode, dateStr);
  });
  const wonAmount = wins.reduce((n, d) => n + (Number(d.prize) || 0), 0);
  const activeValues = activeCardsForUser(bundle.cardsCache, uid, username);
  return {
    uid,
    username,
    email: user.email || "",
    phone: user.phone || "—",
    createdAt: createdAtMs(user.createdAt),
    cardsPlayed,
    purchases: plays.length,
    numbersPaid,
    spent,
    wins: wins.length,
    wonAmount,
    winDetails: wins,
    active: activeValues.length > 0,
    activeValues,
  };
}

function waDigits(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("57") && d.length >= 12) return d;
  if (d.length === 10) return "57" + d;
  return d;
}

function renderResets(listEl, resets) {
  const pending = (resets || []).filter((r) => (r.status || "pending") === "pending");
  if (!pending.length) {
    listEl.innerHTML = "";
    return;
  }
  listEl.innerHTML =
    '<p class="section-label" style="margin-bottom:10px;">Pedidos de clave</p>' +
    pending
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map((r) => {
        const slug = escapeHtml(r.id || slugFromUsername(r.username));
        const when = r.createdAt ? new Date(r.createdAt).toLocaleString("es-CO") : "—";
        return (
          '<article class="admin-user admin-reset" data-reset-slug="' + slug + '">' +
            '<div class="admin-user-top">' +
              '<div><div class="admin-user-name">' + escapeHtml(r.username || r.id) + "</div>" +
              '<div class="admin-user-meta">Celular ' + escapeHtml(r.phone || "—") + " · " + escapeHtml(when) + "</div></div>" +
            "</div>" +
            '<p class="admin-win-line">Confirma solo si reconoces a esta persona. Se genera una clave nueva y la envías por WhatsApp.</p>' +
            '<div class="admin-reset-actions">' +
              '<button class="btn btn-gold btn-sm" type="button" data-approve-reset="' + slug + '">Confirmar y generar clave</button>' +
              '<button class="btn btn-outline btn-sm" type="button" data-reject-reset="' + slug + '">Rechazar</button>' +
            "</div>" +
          "</article>"
        );
      })
      .join("");
}

function userCardHtml(u, i, extraClass) {
  const active = u.active
        ? '<span class="admin-live">En tablero activo · ' + (u.activeValues || []).map((v) => fmt(v)).join(", ") + "</span>"
    : '<span class="admin-idle">Sin tablero activo</span>';
  const wins = (u.winDetails || [])
    .map((d) => fmt(d.prize) + " (" + fmt(d.cardValue) + ")")
    .join(" · ") || "—";
  const when = u.createdAt
    ? new Date(u.createdAt).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })
    : "—";
  return (
    '<details class="admin-user admin-user-tab' + (extraClass ? " " + extraClass : "") + '">' +
      '<summary class="admin-user-top">' +
        '<span class="admin-idx">' + (i + 1) + "</span>" +
        '<span class="admin-user-name">' + escapeHtml(u.username) + "</span>" +
        '<span class="admin-user-chevron" aria-hidden="true">▾</span>' +
      "</summary>" +
      '<div class="admin-user-body">' +
        '<p class="admin-user-meta">Celular ' + escapeHtml(u.phone) + (u.email ? " · " + escapeHtml(u.email) : "") + " · Llegó " + escapeHtml(when) + "</p>" +
        active +
        '<div class="admin-user-grid">' +
          "<div><span class=\"k\">Tableros jugados</span><span class=\"v\">" + u.cardsPlayed + "</span></div>" +
          "<div><span class=\"k\">Compras</span><span class=\"v\">" + u.purchases + "</span></div>" +
          "<div><span class=\"k\">Números pagos</span><span class=\"v\">" + u.numbersPaid + "</span></div>" +
          "<div><span class=\"k\">Veces que ganó</span><span class=\"v\">" + u.wins + "</span></div>" +
          "<div><span class=\"k\">Cifras ganadas</span><span class=\"v\">" + fmt(u.wonAmount) + "</span></div>" +
          "<div><span class=\"k\">Pagó</span><span class=\"v\">" + fmt(u.spent) + "</span></div>" +
        "</div>" +
        '<p class="admin-win-line">Premios: ' + escapeHtml(wins) + "</p>" +
        (u.email
          ? '<button class="btn btn-outline btn-sm" type="button" data-resend-welcome="' + escapeHtml(u.email) + '" data-resend-name="' + escapeHtml(u.username) + '">Reenviar correo de bienvenida</button>'
          : "") +
      "</div>" +
    "</details>"
  );
}

function renderUsers(listEl, rows) {
  const now = bogotaNowParts();
  const players = (rows || []).filter((u) => !isKeptAdminRow(u));
  const admins = (rows || []).filter((u) => isKeptAdminRow(u));
  const years = new Set();
  players.forEach((u) => {
    const p = bogotaCreatedParts(u.createdAt);
    if (p && p.year) years.add(p.year);
  });
  years.add(now.year);
  const yearList = Array.from(years).sort((a, b) => b - a);
  let year = pickedUserYear || now.year;
  if (!yearList.includes(year)) year = yearList[0] || now.year;
  const month = pickedUserMonth;
  pickedUserYear = year;
  pickedUserMonth = month;

  const visible = players
    .filter((u) => {
      if (!month) return true;
      const p = bogotaCreatedParts(u.createdAt);
      if (!p) return false;
      return p.year === year && p.month === month;
    })
    .sort((a, b) => createdAtMs(a.createdAt) - createdAtMs(b.createdAt) || String(a.username || "").localeCompare(String(b.username || ""), "es"));

  const yearOpts = yearList
    .map((y) => '<option value="' + y + '"' + (y === year ? " selected" : "") + ">" + y + "</option>")
    .join("");
  const monthOpts =
    '<option value="0"' +
    (!month ? " selected" : "") +
    ">Todos</option>" +
    MONTH_NAMES.map(
      (name, i) =>
        '<option value="' +
        (i + 1) +
        '"' +
        (i + 1 === month ? " selected" : "") +
        ">" +
        name.toUpperCase() +
        "</option>"
    ).join("");

  const adminBlock = admins.length
    ? '<section class="admin-user-pin">' +
        '<p class="section-label">Administrador</p>' +
        admins.map((u, i) => userCardHtml(u, i, "admin-user-self")).join("") +
      "</section>"
    : "";

  const monthLabel = !month ? "desde el inicio" : MONTH_NAMES[month - 1] + " de " + year;
  const monthList = visible.length
    ? visible.map((u, i) => userCardHtml(u, i, "")).join("")
    : '<div class="empty-note">Nadie se registró en ' + monthLabel + ".</div>";

  listEl.innerHTML =
    adminBlock +
    '<section class="admin-user-month">' +
      '<p class="section-label">Usuarios registrados</p>' +
      '<div class="admin-month-bar">' +
        '<label class="admin-filter-item">Mes' +
          '<select id="adminUserMonth">' +
            monthOpts +
          "</select>" +
        "</label>" +
        '<label class="admin-filter-item">Año' +
          '<select id="adminUserYear"' +
            (!month ? " disabled" : "") +
            ">" +
            yearOpts +
          "</select>" +
        "</label>" +
        '<span class="admin-month-count">' +
        visible.length +
        " " +
        monthLabel +
        "</span>" +
      "</div>" +
      monthList +
    "</section>";
}

function renderCaja(root, bundle, mode, dateStr) {
  const draws = (bundle.draws || []).filter((d) => inRange(d.ts, mode, dateStr));
  const plays = collapsePlays((bundle.plays || []).filter((p) => inRange(p.ts, mode, dateStr)));
  const closedNumbers = draws.reduce((n, d) => {
    if (d.paidCount != null) return n + Number(d.paidCount);
    if (d.collected != null && d.cardValue) return n + Math.round(Number(d.collected) / Number(d.cardValue));
    return n + 100;
  }, 0);
  const closedCollected = draws.reduce((n, d) => {
    if (d.collected != null) return n + Number(d.collected);
    if (d.prize != null) return n + Number(d.prize) * 2;
    return n + (Number(d.cardValue) || 0) * 100;
  }, 0);
  const closedProfit = closedCollected * 0.5;
  const realNumbers = plays.reduce((n, p) => n + (Number(p.count) || (p.numbers || []).length || 0), 0);
  const realAmount = plays.reduce((n, p) => n + (Number(p.amount) || 0), 0);

  let openSold = 0;
  let openCollected = 0;
  CARD_VALUES.forEach((value) => {
    const card = bundle.cardsCache[value];
    if (!card) return;
    const sold = Number(card.sold) || 0;
    openSold += sold;
    openCollected += sold * value;
  });

  root.innerHTML =
    '<div class="stat-row admin-stats">' +
      '<div class="stat"><span class="v mono">' + closedNumbers.toLocaleString("es-CO") + '</span><span class="k">Números sorteados (periodo)</span></div>' +
      '<div class="stat"><span class="v mono">' + fmt(closedCollected) + '</span><span class="k">Recaudado en sorteos</span></div>' +
      '<div class="stat"><span class="v mono">' + fmt(closedProfit) + '</span><span class="k">Tu ganancia 50%</span></div>' +
    "</div>" +
    '<div class="stat-row admin-stats">' +
      '<div class="stat"><span class="v mono">' + realNumbers.toLocaleString("es-CO") + '</span><span class="k">Números pagos de cuentas</span></div>' +
      '<div class="stat"><span class="v mono">' + fmt(realAmount) + '</span><span class="k">Pagado por usuarios</span></div>' +
      '<div class="stat"><span class="v mono">' + draws.length + '</span><span class="k">Sorteos en el periodo</span></div>' +
    "</div>" +
    '<div class="admin-open">' +
      "<h3>Tableros abiertos ahora</h3>" +
      "<p>No usa el filtro de fecha: es lo que está en juego en este momento.</p>" +
      '<div class="stat-row">' +
        '<div class="stat"><span class="v mono">' + openSold + '/600</span><span class="k">Números vendidos</span></div>' +
        '<div class="stat"><span class="v mono">' + fmt(openCollected) + '</span><span class="k">Recaudo en juego</span></div>' +
        '<div class="stat"><span class="v mono">' + fmt(openCollected * 0.5) + '</span><span class="k">Ganancia 50% al cerrar</span></div>' +
      "</div>" +
    "</div>";
}

function dateHeading(key) {
  const parts = String(key || "").split("-");
  if (parts.length !== 3) return key || "Sin fecha";
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return d.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function posterClip(d) {
  return {
    kicker: "Tablero " + fmt(d.cardValue) + " · sorteo en vivo",
    number: d.winningNumber,
    name: d.winnerName,
    city: d.winnerCity,
    prize: fmt(d.prize),
  };
}

async function evidenceFileForDraw(d) {
  if (d.videoUrl) {
    try {
      const res = await fetch(d.videoUrl);
      const blob = await res.blob();
      const ext = (blob.type || "").indexOf("png") >= 0 ? "png" : (blob.type || "").indexOf("mp4") >= 0 ? "mp4" : "webm";
      return new File([blob], "sorteo-" + (d.winningNumber || "dorado") + "." + ext, { type: blob.type || "video/webm" });
    } catch {
      /* sigue con el afiche */
    }
  }
  const local = await loadLocalDrawMedia(d.id);
  if (local) {
    const type = local.type || "image/png";
    const ext = type.indexOf("png") >= 0 ? "png" : type.indexOf("mp4") >= 0 ? "mp4" : "webm";
    return local instanceof File ? local : new File([local], "sorteo-" + (d.winningNumber || "dorado") + "." + ext, { type });
  }
  return winnerPosterFile(posterClip(d));
}

async function renderVideos(root, bundle, mode, dateStr) {
  const draws = bundle.draws
    .filter((d) => isWithinVideoRetention(d.ts) && inRange(d.ts, mode, dateStr))
    .slice()
    .sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
  if (!draws.length) {
    root.innerHTML = '<div class="empty-note">Aún no hay sorteos grabados en este periodo.</div>';
    return;
  }
  const groups = {};
  draws.forEach((d) => {
    const key = d.dateKey || bogotaDateFromTs(d.ts);
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  });
  const keys = Object.keys(groups).sort().reverse();
  const media = {};
  await Promise.all(
    draws.map(async (d) => {
      try {
        const file = await evidenceFileForDraw(d);
        media[d.id] = { file, url: URL.createObjectURL(file), image: (file.type || "").indexOf("video") < 0 };
      } catch {
        media[d.id] = null;
      }
    })
  );
  root.innerHTML = keys
    .map((key) => {
      const cards = groups[key]
        .map((d) => {
          const when = d.ts
            ? new Date(d.ts).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })
            : "—";
          const m = media[d.id];
          const video = m
            ? m.image
              ? '<img class="admin-video" alt="Ganador del sorteo" src="' + escapeHtml(m.url) + '">'
              : '<video class="admin-video" controls playsinline src="' + escapeHtml(m.url) + '"></video>'
            : '<div class="empty-note">No se pudo armar la evidencia de este sorteo.</div>';
          return (
            '<article class="admin-video-card">' +
              video +
              '<div class="admin-video-meta">' +
                "<strong>Tablero " +
                fmt(d.cardValue) +
                " · Nº " +
                escapeHtml(d.winningNumber || "—") +
                "</strong>" +
                "<p>Ganador: " +
                escapeHtml(d.winnerName || "—") +
                " · " +
                escapeHtml(d.winnerCity || "—") +
                "</p>" +
                "<p>Premio " +
                fmt(d.prize) +
                " · " +
                escapeHtml(when) +
                "</p>" +
                '<div class="admin-video-actions">' +
                  (m
                    ? '<a class="btn btn-outline btn-sm" href="' +
                      escapeHtml(m.url) +
                      '" download="sorteo-' +
                      escapeHtml(d.winningNumber || "dorado") +
                      '">Descargar</a>'
                    : "") +
                  '<button class="btn btn-gold btn-sm" type="button" data-share-video="' +
                  escapeHtml(d.id || "") +
                  '">Enviar al grupo</button>' +
                "</div>" +
              "</div>" +
            "</article>"
          );
        })
        .join("");
      return '<section class="admin-video-day"><h3>' + escapeHtml(dateHeading(key)) + "</h3>" + cards + "</section>";
    })
    .join("");
}

function bogotaDateFromTs(ts) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(ts ? new Date(ts) : new Date());
  } catch {
    return "sin-fecha";
  }
}

let cachedBundle = null;

async function rejectReset(slug, getCardsCache) {
  const app = getFirebaseApp();
  if (!app || !slug) return;
  const firestore = getFirestore(app);
  await setDoc(doc(firestore, "passwordResets", slug), { status: "rejected", resolvedAt: Date.now() }, { merge: true });
  await refreshAdminViews(getCardsCache());
}

async function approveReset(slug, getCardsCache) {
  const app = getFirebaseApp();
  if (!app || !slug) return;
  const user = getAuth(app).currentUser;
  if (!user) return;
  const token = await user.getIdToken();
  const res = await fetch("/api/reset-clave", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ slug }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    window.alert(data.error || "No se pudo confirmar el pedido.");
    return;
  }
  const card = document.querySelector('[data-reset-slug="' + CSS.escape(slug) + '"]');
  if (!card) {
    await refreshAdminViews(getCardsCache());
    return;
  }
  const phone = waDigits(data.phone);
  const msg = encodeURIComponent(
    "Hola, soy el administrador de Dorado. Tu usuario " +
      data.username +
      " ya tiene clave nueva: " +
      data.password +
      " Entra en https://dorado-rifas.vercel.app con Ya tengo cuenta.",
  );
  const waHref = phone ? "https://wa.me/" + phone + "?text=" + msg : WHATSAPP_GROUP_LINK;
  card.innerHTML =
    '<div class="admin-user-name">' + escapeHtml(data.username) + "</div>" +
    '<p class="admin-win-line">Clave nueva (cópiala y envíala ahora; no se vuelve a mostrar):</p>' +
    '<p class="admin-temp-key">' + escapeHtml(data.password) + "</p>" +
    '<div class="admin-reset-actions">' +
      '<button class="btn btn-outline btn-sm" type="button" data-copy-reset="' + escapeHtml(data.password) + '">Copiar clave</button>' +
      '<a class="btn btn-gold btn-sm" data-wa-reset href="' + waHref + '" target="_blank" rel="noopener">Enviar por WhatsApp</a>' +
    "</div>";
}

export async function refreshAdminViews(cardsCache) {
  const usersEl = document.getElementById("adminUserList");
  const resetEl = document.getElementById("adminResetList");
  const cajaEl = document.getElementById("adminCajaBody");
  const videosEl = document.getElementById("adminVideosBody");
  const countEl = document.getElementById("adminUserCount");
  if (!usersEl || !cajaEl || !videosEl) return;

  const mode = document.getElementById("adminRange") ? document.getElementById("adminRange").value : "all";
  const dateStr = document.getElementById("adminDate") ? document.getElementById("adminDate").value : "";

  function paint(bundle) {
    const keepAdminSlug = KEEP_ADMIN_SLUG;
    let keptAdmin = false;
    const rows = (bundle.users || [])
      .filter((u) => {
        const slug = slugFromUsername(u.username);
        const admin = isAdminAccount(u, u.username, u.email) || u.role === "admin";
        if (!admin) return true;
        if (slug !== keepAdminSlug || keptAdmin) return false;
        keptAdmin = true;
        return true;
      })
      .map((u) => summarizeUser(u, u.id || u.uid, bundle, mode, dateStr))
      .sort((a, b) => createdAtMs(a.createdAt) - createdAtMs(b.createdAt) || String(a.username || "").localeCompare(String(b.username || ""), "es"));
    cachedUserRows = rows;
    if (countEl) countEl.textContent = String(rows.filter((u) => !isKeptAdminRow(u)).length);
    renderUsers(usersEl, rows);
  }

  try {
    const quick = {
      users: mergeUserLists(
        cachedBundle && cachedBundle.users,
        usersFromCards(cardsCache),
        (function () {
          try {
            const app = getFirebaseApp();
            const user = app ? getAuth(app).currentUser : null;
            if (!user) return [];
            return [
              {
                id: user.uid,
                uid: user.uid,
                username: user.displayName || "Miguel_NP_10",
                email: user.email || "",
                phone: "",
                role: "admin",
                createdAt: 0,
              },
            ];
          } catch (e) {
            return [];
          }
        })()
      ),
      plays: (cachedBundle && cachedBundle.plays) || [],
      draws: (cachedBundle && cachedBundle.draws) || [],
      resets: (cachedBundle && cachedBundle.resets) || [],
      cardsCache: cardsCache || {},
    };
    paint(quick);

    cachedBundle = await loadAdminBundle(cardsCache);
    if (resetEl) renderResets(resetEl, cachedBundle.resets || []);
    paint(cachedBundle);
    renderCaja(cajaEl, cachedBundle, mode, dateStr);
    renderVideos(videosEl, cachedBundle, mode, dateStr).catch(function () {});
  } catch (err) {
    console.error(err);
    try {
      paint({
        users: (cachedBundle && cachedBundle.users) || [],
        plays: (cachedBundle && cachedBundle.plays) || [],
        draws: (cachedBundle && cachedBundle.draws) || [],
        resets: [],
        cardsCache: cardsCache || {},
      });
    } catch (e) {}
    try {
      renderCaja(cajaEl, cachedBundle || { cardsCache: cardsCache || {}, plays: [], draws: [] }, mode, dateStr);
    } catch (e) {}
  }
}

export function bindAdminFilters(getCardsCache) {
  ["adminRange", "adminDate"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
      refreshAdminViews(getCardsCache());
    });
  });
  const usersEl = document.getElementById("adminUserList");
  if (usersEl) {
    usersEl.addEventListener("change", (e) => {
      const sel = e.target.closest("#adminUserMonth, #adminUserYear");
      if (!sel) return;
      if (sel.id === "adminUserMonth") pickedUserMonth = parseInt(sel.value, 10) || 0;
      if (sel.id === "adminUserYear") pickedUserYear = parseInt(sel.value, 10) || 0;
      renderUsers(usersEl, cachedUserRows);
    });
    usersEl.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-resend-welcome]");
      if (!btn) return;
      btn.disabled = true;
      const prev = btn.textContent;
      btn.textContent = "Enviando…";
      try {
        const res = await fetch("/api/enviar-bienvenida", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: btn.dataset.resendWelcome, username: btn.dataset.resendName }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) btn.textContent = "Correo enviado";
        else {
          btn.disabled = false;
          btn.textContent = prev;
          window.alert(data.error || "No se pudo enviar. Revisa SMTP_USER y SMTP_PASS en Vercel.");
        }
      } catch {
        btn.disabled = false;
        btn.textContent = prev;
        window.alert("No se pudo enviar el correo.");
      }
    });
  }
  const resetEl = document.getElementById("adminResetList");
  if (resetEl) {
    resetEl.addEventListener("click", (e) => {
      const approve = e.target.closest("[data-approve-reset]");
      const reject = e.target.closest("[data-reject-reset]");
      const copy = e.target.closest("[data-copy-reset]");
      const wa = e.target.closest("[data-wa-reset]");
      if (approve) {
        approveReset(approve.dataset.approveReset, getCardsCache);
        return;
      }
      if (reject) {
        rejectReset(reject.dataset.rejectReset, getCardsCache);
        return;
      }
      if (copy && copy.dataset.copyReset) {
        navigator.clipboard.writeText(copy.dataset.copyReset).catch(() => {});
        copy.textContent = "Copiada";
        return;
      }
      if (wa && wa.href) return;
    });
  }
  const videosEl = document.getElementById("adminVideosBody");
  if (videosEl) {
    videosEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-share-video]");
      if (!btn) return;
      const id = btn.dataset.shareVideo;
      const d = (cachedBundle && cachedBundle.draws || []).find((x) => x.id === id);
      if (!d) return;
      shareDrawEvidence(d);
    });
  }
}

async function shareDrawEvidence(d) {
  const text =
    "🏆 *Dorado Rifas* — Sorteo oficial\n" +
    "Tablero de juego: " + fmt(d.cardValue) + "\n" +
    "Número ganador: *" + (d.winningNumber || "—") + "*\n" +
    "Ganador(a): " + (d.winnerName || "—") + "\n" +
    "Ciudad: " + (d.winnerCity || "—") + "\n" +
    "Premio (50% de lo recaudado): " + fmt(d.prize) + "\n" +
    "Fecha: " + (d.ts ? new Date(d.ts).toLocaleString("es-CO") : "—") + "\n\n" +
    "Únete y juega: https://dorado-rifas.vercel.app";
  try {
    const payload = { title: "Dorado Rifas", text };
    const file = await evidenceFileForDraw(d);
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      payload.files = [file];
    }
    if (navigator.share) {
      await navigator.share(payload);
      return;
    }
    if (file) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      a.click();
    }
  } catch {
    /* canceló o el celular no adjuntó el archivo */
  }
  try {
    navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
  window.open(WHATSAPP_GROUP_LINK, "_blank", "noopener");
}
