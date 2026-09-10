/**
 * Graba el sorteo en un canvas (misma cuenta y número que se ve
 * en pantalla) para compartirlo. WhatsApp no deja a una web pegar
 * un video sola en un grupo: el usuario elige el chat al compartir.
 */
export function createDrawRecorder() {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 1280;
  const ctx = canvas.getContext("2d");
  const chunks = [];
  let recorder = null;
  const mime = pickMime();

  function pickMime() {
    if (typeof MediaRecorder === "undefined") return "";
    const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
    return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
  }

  function bg() {
    const g = ctx.createRadialGradient(360, 380, 40, 360, 500, 700);
    g.addColorStop(0, "#191305");
    g.addColorStop(1, "#060608");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 720, 1280);
  }

  function title(text) {
    ctx.fillStyle = "#8a713a";
    ctx.font = "600 22px Jost, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(text, 360, 230);
  }

  let logoImg = null;
  function brand() {
    if (!logoImg) {
      logoImg = new Image();
      logoImg.src = "/logo.png?v=2";
    }
    if (logoImg.complete && logoImg.naturalWidth) {
      const w = 176;
      const h = w * (logoImg.naturalHeight / logoImg.naturalWidth);
      ctx.drawImage(logoImg, 360 - w / 2, 12, w, h);
      return;
    }
    ctx.fillStyle = "#e8c877";
    ctx.font = "700 42px 'Cormorant Garamond', Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("Dorado", 360, 100);
  }

  return {
    start() {
      if (!mime) return false;
      if (!logoImg) {
        logoImg = new Image();
        logoImg.src = "/logo.png?v=2";
      }
      try {
        chunks.length = 0;
        const stream = canvas.captureStream(24);
        recorder = new MediaRecorder(stream, { mimeType: mime });
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size) chunks.push(e.data);
        };
        recorder.start(250);
        return true;
      } catch {
        recorder = null;
        return false;
      }
    },
    spin({ kicker, sec, d0, d1 }) {
      bg();
      brand();
      title(kicker);
      ctx.fillStyle = "#e8c877";
      ctx.font = "700 120px 'IBM Plex Mono', monospace";
      ctx.fillText(String(sec), 360, 520);
      ctx.font = "700 96px 'IBM Plex Mono', monospace";
      ctx.fillStyle = "#efe8d8";
      ctx.fillText(d0 + "  " + d1, 360, 720);
      ctx.fillStyle = "#a89e8c";
      ctx.font = "500 26px Jost, sans-serif";
      ctx.fillText("Girando… el ganador aparece en 0", 360, 820);
    },
    winner({ kicker, number, name, city, prize }) {
      bg();
      brand();
      title(kicker);
      ctx.fillStyle = "#e8c877";
      ctx.font = "600 28px 'Cormorant Garamond', Georgia, serif";
      ctx.fillText("¡Tenemos ganador!", 360, 280);
      ctx.font = "700 140px 'IBM Plex Mono', monospace";
      ctx.fillText(String(number), 360, 480);
      ctx.font = "600 44px 'Cormorant Garamond', Georgia, serif";
      ctx.fillStyle = "#efe8d8";
      ctx.fillText(name, 360, 580);
      ctx.fillStyle = "#a89e8c";
      ctx.font = "500 28px Jost, sans-serif";
      ctx.fillText(city, 360, 640);
      ctx.fillStyle = "#e8c877";
      ctx.font = "700 56px 'IBM Plex Mono', monospace";
      ctx.fillText(prize, 360, 760);
      ctx.fillStyle = "#a89e8c";
      ctx.font = "500 24px Jost, sans-serif";
      ctx.fillText("El tablero se habilita de nuevo", 360, 860);
    },
    stop() {
      return new Promise((resolve) => {
        if (!recorder || recorder.state === "inactive") {
          resolve(null);
          return;
        }
        recorder.onstop = () => {
          resolve(chunks.length ? new Blob(chunks, { type: mime }) : null);
        };
        try {
          recorder.stop();
        } catch {
          resolve(null);
        }
      });
    },
  };
}
