const SITE = "https://dorado-rifas.vercel.app";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function resetSubject() {
  return "Cambia tu clave de Dorado";
}

export function resetText(username, link) {
  const name = String(username || "").trim() || "jugador";
  return [
    "Hola, " + name + ".",
    "",
    "Pediste cambiar la clave de tu cuenta en Dorado Rifas.",
    "Abre este enlace (vale un rato y es solo para ti) y escribe una clave nueva:",
    "",
    link,
    "",
    "Si no pediste esto, ignora el mensaje. Tu clave actual sigue igual.",
    "",
    "Luego entra en " + SITE + " con Ya tengo cuenta.",
    "",
    "Te escribe el administrador de Dorado.",
  ].join("\n");
}

export function resetHtml(username, link) {
  const name = escapeHtml(String(username || "").trim() || "jugador");
  const href = escapeHtml(link);
  const p = "margin:0 0 14px;font-family:Jost,Segoe UI,sans-serif;font-size:15px;line-height:1.7;color:#cfc6b4;text-align:left;";
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Cambia tu clave</title></head>
<body style="margin:0;padding:0;background:#0a0b0d;color:#efe8d8;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0a0b0d;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#15171e;border:1px solid #8a713a;border-radius:20px;">
        <tr><td style="padding:36px 32px 8px;text-align:left;">
          <p style="margin:0 0 18px;font-family:Jost,Segoe UI,sans-serif;letter-spacing:0.22em;font-size:11px;color:#c9a24b;text-transform:uppercase;">Dorado Rifas</p>
          <p style="margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.3;color:#e8c877;">Cambia tu clave, ${name}</p>
          <p style="${p}">Pediste recuperar el acceso a tu cuenta. Pulsa el botón y escribe una clave nueva. El enlace es solo para ti y caduca.</p>
        </td></tr>
        <tr><td style="padding:8px 32px 36px;text-align:left;">
          <a href="${href}" style="display:inline-block;background:linear-gradient(#e8c877,#c9a24b);color:#1a1405;text-decoration:none;font-family:Jost,Segoe UI,sans-serif;font-weight:700;font-size:15px;padding:14px 28px;border-radius:100px;">Crear clave nueva</a>
          <p style="margin:20px 0 0;font-family:Jost,Segoe UI,sans-serif;font-size:13px;line-height:1.6;color:#8f8778;">Si no pediste esto, ignora el mensaje. Tu clave actual no cambia.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
