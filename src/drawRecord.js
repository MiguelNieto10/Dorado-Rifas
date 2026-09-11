/**
 * Graba el sorteo en un canvas para compartirlo.
 * En muchos celulares Android el video no se puede grabar;
 * en ese caso se entrega una imagen del ganador (sí se puede enviar).
 */
function pickMime() {
  if (typeof MediaRecorder === "undefined") return "";
  const types = ["video/webm;codecs=vp8", "video/webm", "video/mp4", "video/webm;codecs=vp9"];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

function makeCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 1280;
  const ctx = canvas.getContext("2d");
  let logoImg = null;

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

  function brand() {
    if (!logoImg) {
      logoImg = new Image();
      logoImg.src = "/logo.png?v=7";
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

  function paintWinner({ kicker, number, name, city, prize }) {
    bg();
    brand();
    title(kicker || "Sorteo en vivo");
    ctx.fillStyle = "#e8c877";
    ctx.font = "600 28px 'Cormorant Garamond', Georgia, serif";
    ctx.fillText("¡Tenemos ganador!", 360, 280);
    ctx.font = "700 140px 'IBM Plex Mono', monospace";
    ctx.fillText(String(number || "—"), 360, 480);
    ctx.font = "600 44px 'Cormorant Garamond', Georgia, serif";
    ctx.fillStyle = "#efe8d8";
    ctx.fillText(String(name || "—"), 360, 580);
    ctx.fillStyle = "#a89e8c";
    ctx.font = "500 28px Jost, sans-serif";
    ctx.fillText(String(city || "—"), 360, 640);
    ctx.fillStyle = "#e8c877";
    ctx.font = "700 56px 'IBM Plex Mono', monospace";
    ctx.fillText(String(prize || ""), 360, 760);
    ctx.fillStyle = "#a89e8c";
    ctx.font = "500 24px Jost, sans-serif";
    ctx.fillText("Premio: 50% de lo recaudado", 360, 860);
  }

  function loadLogo() {
    if (!logoImg) {
      logoImg = new Image();
      logoImg.src = "/logo.png?v=7";
    }
    return new Promise((resolve) => {
      if (logoImg.complete && logoImg.naturalWidth) {
        resolve();
        return;
      }
      logoImg.onload = () => resolve();
      logoImg.onerror = () => resolve();
      setTimeout(resolve, 800);
    });
  }

  return { canvas, ctx, bg, brand, title, paintWinner, ensureLogo: brand, loadLogo };
}

export function createDrawRecorder() {
  const { canvas, ctx, bg, brand, title, paintWinner, ensureLogo } = makeCanvas();
  const chunks = [];
  let recorder = null;
  const mime = pickMime();

  return {
    start() {
      ensureLogo();
      bg();
      brand();
      if (typeof MediaRecorder === "undefined" || typeof canvas.captureStream !== "function") return false;
      try {
        chunks.length = 0;
        const stream = canvas.captureStream(24);
        recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size) chunks.push(e.data);
        };
        recorder.start(250);
        return recorder.state === "recording";
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
    winner(clip) {
      paintWinner(clip);
    },
    stop() {
      return new Promise((resolve) => {
        if (!recorder || recorder.state === "inactive") {
          resolve(null);
          return;
        }
        recorder.onstop = () => {
          resolve(chunks.length ? new Blob(chunks, { type: recorder.mimeType || mime || "video/webm" }) : null);
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

export async function winnerPosterFile(clip) {
  const { canvas, paintWinner, loadLogo } = makeCanvas();
  await loadLogo();
  paintWinner(clip);
  return new Promise((resolve) => {
    const finish = (blob) => {
      const file = new File([blob || new Blob()], "sorteo-dorado-" + (clip && clip.number ? clip.number : "ganador") + ".png", {
        type: "image/png",
      });
      resolve(file);
    };
    if (canvas.toBlob) {
      canvas.toBlob((blob) => finish(blob), "image/png");
    } else {
      fetch(canvas.toDataURL("image/png")).then((r) => r.blob()).then(finish).catch(() => finish(null));
    }
  });
}
