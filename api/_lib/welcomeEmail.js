const SITE = "https://dorado-rifas.vercel.app";
const FROM_NAME = "Dorado Rifas";
const FROM_EMAIL = process.env.MAIL_FROM || "Administrador@dorado-rifas.vercel.app";

export function welcomeFrom() {
  return `${FROM_NAME} <${FROM_EMAIL}>`;
}

export function welcomeSubject(username) {
  const name = String(username || "").trim() || "jugador";
  return `${name}, bienvenido a Dorado — la suerte, con estilo`;
}

export function welcomeText(username) {
  const name = String(username || "").trim() || "jugador";
  return [
    `Hola, ${name}.`,
    "",
    "Bienvenido a Dorado. Aquí la suerte se viste de oro: seis tableros, números del 00 al 99 y un ganador todos los días.",
    "",
    "Empieza por el tablero más liviano ($2.000 por número) para probar tu suerte. Si quieres más emoción, sube al de $5.000, $10.000, $20.000, $50.000 o $100.000. Tú eliges el ritmo. El premio siempre es el 50% de lo recaudado en ese tablero, y siempre hay ganador entre los números verdes y pagos.",
    "",
    "Cómo se juega:",
    "1. Entra a " + SITE + " y elige un tablero.",
    "2. Marca uno o varios números del 00 al 99 y paga.",
    "3. Envía el comprobante a un administrador del grupo de WhatsApp. Sin comprobante, el número se libera a los 15 minutos. Cuando queda en verde, está asegurado.",
    "4. El sorteo es todos los días, lunes a domingo, a las 9:00 p. m. (hora de Bogotá). Quienes tienen número pago en ese tablero ven la cuenta 10, 9… 0 y al ganador: número, nombre, ciudad y premio.",
    "5. A los 10 segundos el tablero se abre de nuevo. Puedes dejar el saldo para otra ronda o retirarlo a Nequi.",
    "",
    "Hoy puede ser tu noche. Un número, un instante, y Dorado te nombra.",
    "",
    "Jugar: " + SITE,
    "",
    "— El equipo Dorado",
  ].join("\n");
}

export function welcomeHtml(username) {
  const name = escapeHtml(String(username || "").trim() || "jugador");
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bienvenido a Dorado</title>
</head>
<body style="margin:0;padding:0;background:#0a0b0d;color:#efe8d8;font-family:Georgia,'Times New Roman',serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0a0b0d;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:linear-gradient(#1c1f29,#15171e);border:1px solid #8a713a;border-radius:20px;overflow:hidden;">
          <tr>
            <td style="padding:36px 32px 12px;text-align:center;">
              <p style="margin:0;font-family:Jost,Segoe UI,sans-serif;letter-spacing:0.28em;font-size:11px;color:#c9a24b;text-transform:uppercase;">Dorado Rifas</p>
              <h1 style="margin:14px 0 0;font-size:32px;line-height:1.15;color:#e8c877;">La suerte, con estilo.</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 0;text-align:center;">
              <p style="margin:0;font-family:Jost,Segoe UI,sans-serif;font-size:16px;line-height:1.55;color:#efe8d8;">
                Hola, <strong style="color:#e8c877;">${name}</strong>. Ya tienes tu lugar en Dorado.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 32px 8px;font-family:Jost,Segoe UI,sans-serif;font-size:15px;line-height:1.65;color:#a89e8c;">
              <p style="margin:0 0 14px;">Esto no es un juego cualquiera: es una mesa oscura, una corona de oro y la posibilidad de que tu número brille esta noche. Puedes empezar suave, con el tablero de <strong style="color:#e8c877;">$2.000</strong> por número, o subir hasta <strong style="color:#e8c877;">$100.000</strong> si quieres más adrenalina. Tú decides hasta dónde probar tu suerte.</p>
              <p style="margin:0;">El premio es siempre el <strong style="color:#e8c877;">50% de lo recaudado</strong> en ese tablero. Y sí: siempre hay un ganador, elegido solo entre los números <strong style="color:#3aa47e;">verdes y pagos</strong>.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px 8px;">
              <p style="margin:0 0 12px;font-family:Jost,Segoe UI,sans-serif;letter-spacing:0.16em;font-size:11px;color:#c9a24b;text-transform:uppercase;">Reglas del juego</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-family:Jost,Segoe UI,sans-serif;font-size:14px;line-height:1.55;color:#efe8d8;">
                ${ruleRow("01", "Elige uno de los seis tableros: $2.000, $5.000, $10.000, $20.000, $50.000 o $100.000 por número.")}
                ${ruleRow("02", "Marca uno o varios números del 00 al 99 y paga.")}
                ${ruleRow("03", "Envía el comprobante a un administrador del grupo de WhatsApp. Sin comprobante, el número se libera a los 15 minutos. En verde queda asegurado.")}
                ${ruleRow("04", "Solo entran al sorteo los números verdes y pagos. El premio es el 50% de lo recaudado.")}
                ${ruleRow("05", "Todos los días, lunes a domingo, a las 9:00 p. m. (Bogotá). Quienes tienen número pago ven la cuenta 10 a 0 y al ganador: número, nombre, ciudad y premio.")}
                ${ruleRow("06", "A los 10 segundos el tablero se abre de nuevo. Deja el saldo para otra ronda o retíralo a Nequi.")}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 32px 36px;text-align:center;">
              <a href="${SITE}" style="display:inline-block;background:linear-gradient(#e8c877,#c9a24b);color:#1a1405;text-decoration:none;font-family:Jost,Segoe UI,sans-serif;font-weight:700;font-size:15px;padding:14px 28px;border-radius:100px;">Entrar a jugar</a>
              <p style="margin:18px 0 0;font-family:Jost,Segoe UI,sans-serif;font-size:13px;line-height:1.5;color:#6b6459;">Hoy puede ser tu noche. Un número. Un instante. Dorado te nombra.</p>
              <p style="margin:10px 0 0;font-family:Jost,Segoe UI,sans-serif;font-size:12px;color:#6b6459;">— El equipo Dorado<br>${escapeHtml(FROM_EMAIL)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function ruleRow(num, text) {
  return `<tr>
    <td valign="top" style="width:36px;padding:0 0 12px;color:#e8c877;font-weight:700;font-family:IBM Plex Mono,Consolas,monospace;">${num}</td>
    <td style="padding:0 0 12px;color:#a89e8c;">${text}</td>
  </tr>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
