const TOUR_KEY = "dorado.playerTour.v1.";

const STEPS = [
  {
    title: "Bienvenido a Dorado",
    text: "Te voy a explicar, paso a paso, cómo jugar. Es fácil: eliges un tablero, marcas números, pagas y esperas el sorteo de las 9:00 p. m.",
  },
  {
    title: "Arriba de la pantalla",
    text: "Tableros: ahí eliges dónde jugar. Ganadores: ahí ves quién ganó, con número, nombre, ciudad y premio. Tutorial: si quieres, vuelves a ver esta explicación. Cómo funciona: las reglas cortas.",
  },
  {
    title: "Seis tableros",
    text: "Hay 6 tableros. Cada uno tiene un precio distinto: $2.000, $5.000, $10.000, $20.000, $50.000 y $100.000. Ese precio es lo que pagas por cada número que elijas.",
  },
  {
    title: "Números del 00 al 99",
    text: "Entras a un tablero y tocas los números que quieres. Gris: está libre. Dorado: los que tú marcaste. Amarillo: reservado un rato. Verde: ya está pago y entra al sorteo. Marcar no alcanza: hay que pagar.",
  },
  {
    title: "Pagar con Nequi",
    text: "Cuando ya tengas tus números, pulsa Pagar con Nequi. El total es el precio del tablero multiplicado por cuántos números elegiste. Envía ese dinero a la Nequi de Dorado: 3150505240.",
  },
  {
    title: "Manda el comprobante",
    text: "En el grupo de WhatsApp envía la foto del pago a uno de los administradores del grupo. En el mismo mensaje escribe tu nombre y apellido, el tablero y el número o números. Si no lo envías, en 1 hora esos números quedan libres para que un nuevo jugador los tome en tu lugar, por no verificar tu pago.",
  },
  {
    title: "Número Verde y Premio",
    text: "Cuando confirman tu pago, tu número se pone verde. Solo los números verdes juegan. El premio es la mitad de lo recaudado en ese tablero. Siempre hay un ganador entre los números verdes.",
  },
  {
    title: "Sorteo a las 9:00 p. m.",
    text: "Todos los días, a las 9:00 p. m. (hora de Col 🇨🇴), se realiza el sorteo. Comienza el sorteo del tablero de $2.000 y sigue en orden. Si un tablero no tiene números verdes o jugadores, se salta el sorteo al siguiente tablero. Podrás ver el sorteo en su cuenta regresiva de 10 a 0 segundos, anunciando al ganador.",
  },
  {
    title: "Si ganas",
    text: "Sale tu número, tu nombre, tu ciudad y el premio. El dinero te llega a tu Nequi en el transcurso de 1 hora. A los 10 segundos el tablero se abre otra vez con los 100 números libres para jugar en el sorteo del día siguiente a las 9:00 p. m.",
  },
  {
    title: "Listo",
    text: "Elige un tablero, marca, paga y manda el comprobante. El sorteo es todos los días a las 9:00 p. m. Si se te olvida, pulsa Tutorial arriba y lo ves otra vez.",
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
