const TOUR_KEY = "dorado.playerTour.v1.";

const STEPS = [
  {
    title: "Bienvenido a Dorado",
    text: "Te voy a explicar, paso a paso, cómo jugar. Es fácil: eliges un tablero, marcas números, pagas y esperas el sorteo de las 9:00 p. m.",
    view: "lobby",
    target: "#view-lobby .hero",
  },
  {
    title: "Arriba de la pantalla",
    text: "Tableros: ahí eliges dónde jugar. Ganadores: ahí ves quién ganó, con número, nombre, ciudad y premio. Tutorial: si quieres, vuelves a ver esta explicación. Cómo funciona: las reglas cortas.",
    view: "lobby",
    target: ".nav",
  },
  {
    title: "Seis tableros",
    text: "Hay 6 tableros. Cada uno tiene un precio distinto: $2.000, $5.000, $10.000, $20.000, $50.000 y $100.000. Ese precio es lo que pagas por cada número que elijas.",
    view: "lobby",
    target: "#cardsGrid",
  },
  {
    title: "Números del 00 al 99",
    text: "Entras a un tablero y tocas los números que quieres. Gris: está libre. Dorado: los que tú marcaste. Amarillo: reservado un rato. Verde: ya está pago y entra al sorteo. Marcar no alcanza: hay que pagar.",
    view: "card",
    target: [".grid-legend", "#numGrid"],
  },
  {
    title: "Pagar con Nequi",
    text: "Cuando ya tengas tus números, pulsa Pagar con Nequi. El total es el precio del tablero multiplicado por cuántos números elegiste. Envía ese dinero a la Nequi de Dorado: 3150505240.",
    view: "card",
    target: [".play-steps", "#selectionBar"],
    payBar: true,
  },
  {
    title: "Manda el comprobante",
    text: "En el grupo de WhatsApp envía la foto del pago a uno de los administradores del grupo. En el mismo mensaje escribe tu nombre y apellido, el tablero y el número o números. Si no lo envías, en 1 hora esos números quedan libres para que un nuevo jugador los tome en tu lugar, por no verificar tu pago.",
  },
  {
    title: "Número Verde y Premio",
    text: "Cuando confirman tu pago, tu número se pone verde. Solo los números verdes juegan. El premio es la mitad de lo recaudado en ese tablero. Siempre hay un ganador entre los números verdes.",
    view: "card",
    target: [".grid-legend", "#cdPot"],
  },
  {
    title: "Sorteo a las 9:00 p. m.",
    text: "Todos los días, a las 9:00 p. m. (hora de Col 🇨🇴), se realiza el sorteo. Comienza el sorteo del tablero de $2.000 y sigue en orden. Si un tablero no tiene números verdes o jugadores, se salta el sorteo al siguiente tablero. Podrás ver el sorteo en su cuenta regresiva de 10 a 0 segundos, anunciando al ganador.",
  },
  {
    title: "Si ganas",
    text: "Sale tu número, tu nombre, tu ciudad y el premio. El dinero te llega a tu Nequi en el transcurso de 1 hora. 10 segundos después del sorteo, el tablero se abre otra vez con los 100 números libres para jugar en el sorteo del día siguiente a las 9:00 p. m.",
  },
  {
    title: "Ya estás listo!",
    text: "Elige un tablero, marca tu número, paga y envía el comprobante. El sorteo es todos los días a las 9:00 p. m. Si se te olvida algo de lo explicado, pulsa Tutorial arriba y lo ves otra vez.",
    view: "lobby",
    target: "#cardsGrid",
  },
];

function tourKey(uid) {
  return TOUR_KEY + String(uid || "");
}

export function hasFinishedPlayerTour(uid) {
  if (!uid) return false;
  try {
    return localStorage.getItem(tourKey(uid)) === "1";
  } catch {
    return false;
  }
}

function queryTargets(target) {
  const list = Array.isArray(target) ? target : [target];
  const els = [];
  list.forEach(function (sel) {
    if (!sel) return;
    const el = document.querySelector(sel);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width || r.height) els.push(el);
  });
  return els;
}

function unionBox(els) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  els.forEach(function (el) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  });
  if (!isFinite(left)) return null;
  return { left, top, width: right - left, height: bottom - top };
}

function placeSpot(root, box) {
  const spot = document.getElementById("playerTourSpot");
  if (!spot) return;
  if (!box) {
    spot.hidden = true;
    root.classList.add("is-centered");
    root.classList.remove("spot-low");
    return;
  }
  const pad = 8;
  const top = Math.max(8, box.top - pad);
  const left = Math.max(8, box.left - pad);
  const width = Math.min(window.innerWidth - left - 8, box.width + pad * 2);
  const height = Math.min(window.innerHeight - top - 8, box.height + pad * 2);
  spot.hidden = false;
  spot.style.top = top + "px";
  spot.style.left = left + "px";
  spot.style.width = Math.max(40, width) + "px";
  spot.style.height = Math.max(28, height) + "px";
  root.classList.remove("is-centered");
  root.classList.toggle("spot-low", box.top + box.height / 2 > window.innerHeight * 0.48);
}

function layoutSpot(step, opts) {
  const root = document.getElementById("playerTour");
  if (!root || !step) return;
  const els = step.target ? queryTargets(step.target) : [];
  if ((!opts || opts.scroll !== false) && els[0] && typeof els[0].scrollIntoView === "function") {
    els[0].scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
  }
  placeSpot(root, els.length ? unionBox(els) : null);
}

function paintTour(i, force, host) {
  const title = document.getElementById("playerTourTitle");
  const text = document.getElementById("playerTourText");
  const stepEl = document.getElementById("playerTourStep");
  const prev = document.getElementById("playerTourPrev");
  const next = document.getElementById("playerTourNext");
  const step = STEPS[i];
  if (!title || !text || !stepEl || !prev || !next || !step) return;
  title.textContent = step.title;
  text.textContent = step.text;
  stepEl.textContent = i + 1 + " / " + STEPS.length;
  prev.hidden = i === 0;
  next.textContent = i === STEPS.length - 1 ? (force ? "Cerrar" : "Empezar a jugar") : "Siguiente";

  if (host && typeof host.forcePayBar === "function") host.forcePayBar(!!step.payBar);
  if (step.view && host && typeof host.show === "function") host.show(step.view);

  requestAnimationFrame(function () {
    layoutSpot(step);
    requestAnimationFrame(function () {
      layoutSpot(step);
    });
  });
}

export function startPlayerTour(uid, opts) {
  const force = !!(opts && opts.force);
  const onDone = opts && opts.onDone;
  const host = opts || {};
  if (!uid) return;
  if (!force && hasFinishedPlayerTour(uid)) return;

  const root = document.getElementById("playerTour");
  const prev = document.getElementById("playerTourPrev");
  const next = document.getElementById("playerTourNext");
  if (!root || !prev || !next) return;

  let i = 0;
  document.body.classList.add("player-tour-on");
  if (typeof host.onStart === "function") host.onStart();

  function relayout() {
    layoutSpot(STEPS[i], { scroll: false });
  }

  function finish() {
    try {
      localStorage.setItem(tourKey(uid), "1");
    } catch {
      /* ignore */
    }
    window.removeEventListener("resize", relayout);
    window.removeEventListener("scroll", relayout, true);
    if (typeof host.forcePayBar === "function") host.forcePayBar(false);
    if (typeof host.restore === "function") host.restore();
    document.body.classList.remove("player-tour-on");
    if (typeof onDone === "function") onDone();
    const spot = document.getElementById("playerTourSpot");
    if (spot) spot.hidden = true;
    root.classList.remove("is-centered", "spot-low");
    root.hidden = true;
    prev.onclick = null;
    next.onclick = null;
    root.onwheel = null;
  }

  prev.onclick = function () {
    if (i > 0) i -= 1;
    paintTour(i, force, host);
  };
  next.onclick = function () {
    if (i < STEPS.length - 1) {
      i += 1;
      paintTour(i, force, host);
      return;
    }
    finish();
  };

  window.addEventListener("resize", relayout);
  window.addEventListener("scroll", relayout, true);
  root.onwheel = function (e) {
    window.scrollBy(0, e.deltaY);
  };
  paintTour(i, force, host);
  root.hidden = false;
}

export function bindPlayerTourButton(uid, opts) {
  const btn = document.getElementById("playerTourBtn");
  if (!btn || !uid) return;
  btn.hidden = false;
  btn.onclick = function () {
    startPlayerTour(uid, Object.assign({}, opts, { force: true }));
  };
}
