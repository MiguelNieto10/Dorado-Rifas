/**
 * Paneles solo para el administrador.
 * No cambia cómo juegan los demás: solo lee usuarios, compras y sorteos.
 */
import { getAuth } from "firebase/auth";
import { getFirestore, collection, getDocs, doc, setDoc } from "firebase/firestore";
import { getFirebaseApp } from "./db.js";
import { slugFromUsername, WHATSAPP_GROUP_LINK } from "./auth.js";
import { isWithinVideoRetention, pruneExpiredDrawArchives } from "./drawStore.js";

const CARD_VALUES = [2000, 5000, 10000, 20000, 50000, 100000];

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
    const snap = await getDocs(collection(firestore, name));
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

export async function loadAdminBundle(cardsCache) {
  const app = getFirebaseApp();
  if (!app) {
    return { users: [], plays: [], draws: [], resets: [], cardsCache: cardsCache || {} };
  }
  const firestore = getFirestore(app);
  const [users, plays, draws, resets] = await Promise.all([
    readCollection(firestore, "users"),
    readCollection(firestore, "plays"),
    readCollection(firestore, "draws"),
    readCollection(firestore, "passwordResets"),
  ]);
  return { users, plays, draws, resets, cardsCache: cardsCache || {} };
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
    bundle.plays.filter((p) => {
      const mine = (p.uid && p.uid === uid) || slugFromUsername(p.username) === slugFromUsername(username);
      return mine && inRange(p.ts, mode, dateStr);
    })
  );
  const numbersPaid = plays.reduce((n, p) => n + (Number(p.count) || (p.numbers || []).length || 0), 0);
  const spent = plays.reduce((n, p) => n + (Number(p.amount) || 0), 0);
  const cardsPlayed = new Set(plays.map((p) => p.cardValue).filter((v) => v != null)).size;
  const wins = bundle.draws.filter((d) => {
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
    createdAt: user.createdAt || 0,
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

function renderUsers(listEl, rows) {
  if (!rows.length) {
    listEl.innerHTML = '<div class="empty-note">Aún no hay cuentas registradas en este periodo.</div>';
    return;
  }
  listEl.innerHTML = rows
    .map((u, i) => {
      const active = u.active
        ? '<span class="admin-live">En tablero activo · ' + u.activeValues.map((v) => fmt(v)).join(", ") + "</span>"
        : '<span class="admin-idle">Sin tablero activo</span>';
      const wins = u.winDetails
        .map((d) => fmt(d.prize) + " (" + fmt(d.cardValue) + ")")
        .join(" · ") || "—";
      return (
        '<article class="admin-user">' +
          '<div class="admin-user-top">' +
            '<span class="admin-idx">' + (i + 1) + "</span>" +
            '<div><div class="admin-user-name">' + escapeHtml(u.username) + "</div>" +
            '<div class="admin-user-meta">Celular ' + escapeHtml(u.phone) + (u.email ? " · " + escapeHtml(u.email) : "") + "</div></div>" +
            active +
          "</div>" +
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
        "</article>"
      );
    })
    .join("");
}

function renderCaja(root, bundle, mode, dateStr) {
  const draws = bundle.draws.filter((d) => inRange(d.ts, mode, dateStr));
  const plays = collapsePlays(bundle.plays.filter((p) => inRange(p.ts, mode, dateStr)));
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

function renderVideos(root, bundle, mode, dateStr) {
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
  root.innerHTML = keys
    .map((key) => {
      const cards = groups[key]
        .map((d) => {
          const when = d.ts
            ? new Date(d.ts).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })
            : "—";
          const video = d.videoUrl
            ? '<video class="admin-video" controls playsinline src="' + escapeHtml(d.videoUrl) + '"></video>'
            : '<div class="empty-note">Video aún no disponible. El archivo se guarda al terminar el sorteo.</div>';
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
                  (d.videoUrl
                    ? '<a class="btn btn-outline btn-sm" href="' +
                      escapeHtml(d.videoUrl) +
                      '" download target="_blank" rel="noopener">Descargar</a>' +
                      '<button class="btn btn-gold btn-sm" type="button" data-share-video="' +
                      escapeHtml(d.id || "") +
                      '">Enviar al grupo</button>'
                    : "") +
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

  usersEl.innerHTML = '<div class="empty-note">Cargando…</div>';
  if (resetEl) resetEl.innerHTML = "";
  cajaEl.innerHTML = '<div class="empty-note">Cargando…</div>';
  videosEl.innerHTML = '<div class="empty-note">Cargando…</div>';

  await pruneExpiredDrawArchives();
  cachedBundle = await loadAdminBundle(cardsCache);
  const mode = document.getElementById("adminRange")?.value || "all";
  const dateStr = document.getElementById("adminDate")?.value || "";

  const rows = cachedBundle.users
    .map((u) => summarizeUser(u, u.id || u.uid, cachedBundle, mode, dateStr))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.username.localeCompare(b.username, "es"));

  if (countEl) countEl.textContent = String(rows.length);
  if (resetEl) renderResets(resetEl, cachedBundle.resets || []);
  renderUsers(usersEl, rows);
  renderCaja(cajaEl, cachedBundle, mode, dateStr);
  renderVideos(videosEl, cachedBundle, mode, dateStr);
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
    "🏆 *Dorado Rifas* — Evidencia del sorteo\n" +
    "Tablero: " + fmt(d.cardValue) + "\n" +
    "Número ganador: *" + (d.winningNumber || "—") + "*\n" +
    "Ganador(a): " + (d.winnerName || "—") + "\n" +
    "Ciudad: " + (d.winnerCity || "—") + "\n" +
    "Premio (50%): " + fmt(d.prize) + "\n" +
    "Fecha: " + (d.ts ? new Date(d.ts).toLocaleString("es-CO") : "—");
  try {
    const payload = { title: "Dorado Rifas", text };
    if (d.videoUrl) {
      const res = await fetch(d.videoUrl);
      const blob = await res.blob();
      const ext = (blob.type || "").indexOf("mp4") >= 0 ? "mp4" : "webm";
      const file = new File([blob], "sorteo-" + (d.winningNumber || "dorado") + "." + ext, { type: blob.type || "video/webm" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        payload.files = [file];
      }
    }
    if (navigator.share) {
      await navigator.share(payload);
      return;
    }
  } catch {
    /* canceló o el celular no adjuntó el video */
  }
  try {
    navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
  window.open(WHATSAPP_GROUP_LINK, "_blank", "noopener");
}
