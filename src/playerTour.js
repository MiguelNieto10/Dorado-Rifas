const TOUR_KEY = "dorado.playerTour.v1.";

const STEPS = [
  {
    title: "Bienvenido a Dorado",
    text: "Este recorrido es obligatorio la primera vez. Te muestra cómo apostar y participar en los sorteos. Solo verás la plataforma de jugador: tableros, pagos y ganadores.",
  },
  {
    title: "Arriba: Tableros y Ganadores",
    text: "En Tableros eliges dónde jugar. En Ganadores ves los sorteos ya hechos, con número, nombre, ciudad y premio. Cómo funciona resume las reglas. Cerrar sesión sale de tu cuenta.",
  },
  {
    title: "Seis tableros de juego",
    text: "Hay tableros de $2.000, $5.000, $10.000, $20.000, $50.000 y $100.000. El precio es lo que pagas por cada número. Entras al que quieras, cuando quieras.",
  },
  {
    title: "Números del 00 al 99",
    text: "Dentro del tablero marcas uno o varios números. Gris: libre. Dorado: los que estás eligiendo. Ámbar: reservado 1 hora. Verde: ya está pago y asegurado. Marcar no reserva: solo queda tuyo cuando pagas.",
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
    text: "Cuando el administrador confirma el pago, tu número pasa a verde. El premio es el 50% de lo recaudado en ese tablero. Siempre hay un ganador entre los números verdes y pagos.",
  },
  {
    title: "Sorteo todos los días a las 9:00 p. m.",
    text: "A las 9:00 p. m. (Bogotá) se sortea. Primero el tablero de $2.000; después $5.000, $10.000, $20.000, $50.000 y $100.000, en ese orden, solo si tienen verdes. Ves la cuenta 10 a 0 y al ganador.",
  },
  {
    title: "Si ganas",
    text: "Sale tu número, tu nombre, la ciudad y el premio. El administrador te envía el premio a tu Nequi. A los 10 segundos el tablero se abre otra vez.",
  },
  {
    title: "Listo para jugar",
    text: "Ya conoces el recorrido del jugador. Elige un tablero, marca, paga, manda el comprobante y espera el verde. El sorteo es a las 9:00 p. m. Pulsa Empezar a jugar.",
  },
];

export function startPlayerTour(uid) {
  if (!uid) return;
  try {
    if (localStorage.getItem(TOUR_KEY + uid) === "1") return;
  } catch {
    /* sigue el tutorial */
  }
  const root = document.getElementById("playerTour");
  const title = document.getElementById("playerTourTitle");
  const text = document.getElementById("playerTourText");
  const stepEl = document.getElementById("playerTourStep");
  const prev = document.getElementById("playerTourPrev");
  const next = document.getElementById("playerTourNext");
  if (!root || !title || !text || !stepEl || !prev || !next) return;

  let i = 0;
  function paint() {
    const step = STEPS[i];
    title.textContent = step.title;
    text.textContent = step.text;
    stepEl.textContent = i + 1 + " / " + STEPS.length;
    prev.hidden = i === 0;
    next.textContent = i === STEPS.length - 1 ? "Empezar a jugar" : "Siguiente";
  }

  function finish() {
    try {
      localStorage.setItem(TOUR_KEY + uid, "1");
    } catch {
      /* ignore */
    }
    root.hidden = true;
    prev.onclick = null;
    next.onclick = null;
  }

  prev.onclick = function () {
    if (i > 0) i -= 1;
    paint();
  };
  next.onclick = function () {
    if (i < STEPS.length - 1) {
      i += 1;
      paint();
      return;
    }
    finish();
  };

  paint();
  root.hidden = false;
}
