const TOUR_KEY = "dorado.playerTour.v1.";

const STEPS = [
  {
    title: "Bienvenido a Dorado",
    text: "Este recorrido te muestra cómo apostar y participar en los sorteos. Solo ves tu plataforma de jugador: tableros, pagos y ganadores. No verás datos de otros jugadores ni nada de administrador.",
  },
  {
    title: "Arriba: Tableros, Ganadores y Tutorial",
    text: "En Tableros eliges dónde jugar. En Ganadores ves el número ganador, el premio y la fecha. Tutorial vuelve a abrir este recorrido cuando quieras. Cómo funciona resume las reglas. Cerrar sesión sale de tu cuenta.",
  },
  {
    title: "Seis tableros de juego",
    text: "Hay tableros de $2.000, $5.000, $10.000, $20.000, $50.000 y $100.000. El precio es lo que pagas por cada número. Entras al que quieras, cuando quieras.",
  },
  {
    title: "Números del 00 al 99",
    text: "Marcas uno o varios números. Gris: libre. Dorado: los que estás eligiendo. Ámbar: reservado 1 hora (el tuyo dice Tú). Verde: ya está pago. Los números de otras personas se ven ocupados, sin su nombre ni celular.",
  },
  {
    title: "Pagar con Nequi",
    text: "Cuando tengas números elegidos, pulsa Pagar con Nequi. El total es el valor del tablero por cada número. Envías el dinero a la Nequi de Dorado 3150505240.",
  },
  {
    title: "Comprobante en el grupo",
    text: "En el grupo de WhatsApp envía el comprobante a un administrador. En el mismo mensaje escribe tu nombre completo, el tablero y el número o números. Sin eso, a la 1 hora se libera.",
  },
  {
    title: "Verde y premio",
    text: "Cuando confirman tu pago, tu número pasa a verde. El premio es el 50% de lo recaudado en ese tablero. Siempre hay un ganador entre los números verdes y pagos.",
  },
  {
    title: "Sorteo todos los días a las 9:00 p. m.",
    text: "A las 9:00 p. m. (Bogotá) se sortea. Primero el tablero de $2.000; después $5.000, $10.000, $20.000, $50.000 y $100.000, en ese orden, solo si tienen verdes. Ves la cuenta 10 a 0 y el número ganador.",
  },
  {
    title: "Si ganas",
    text: "Si el número es tuyo, ves que ganaste y el administrador te envía el premio a tu Nequi. A los 10 segundos el tablero se abre otra vez.",
  },
  {
    title: "Listo para jugar",
    text: "Elige un tablero, marca, paga y manda el comprobante. El sorteo es a las 9:00 p. m. Si quieres ver esto otra vez, pulsa Tutorial arriba.",
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

function paintTour(i, force) {
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
}

export function startPlayerTour(uid, opts) {
  const force = !!(opts && opts.force);
  const onDone = opts && opts.onDone;
  if (!uid) return;
  if (!force && hasFinishedPlayerTour(uid)) return;

  const root = document.getElementById("playerTour");
  const prev = document.getElementById("playerTourPrev");
  const next = document.getElementById("playerTourNext");
  if (!root || !prev || !next) return;

  let i = 0;
  function finish() {
    try {
      localStorage.setItem(tourKey(uid), "1");
    } catch {
      /* ignore */
    }
    if (typeof onDone === "function") onDone();
    root.hidden = true;
    prev.onclick = null;
    next.onclick = null;
  }

  prev.onclick = function () {
    if (i > 0) i -= 1;
    paintTour(i, force);
  };
  next.onclick = function () {
    if (i < STEPS.length - 1) {
      i += 1;
      paintTour(i, force);
      return;
    }
    finish();
  };

  paintTour(i, force);
  root.hidden = false;
}

export function bindPlayerTourButton(uid, opts) {
  const btn = document.getElementById("playerTourBtn");
  if (!btn || !uid) return;
  btn.hidden = false;
  btn.onclick = function () {
    startPlayerTour(uid, { force: true, onDone: opts && opts.onDone });
  };
}
