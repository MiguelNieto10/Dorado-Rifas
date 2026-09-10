const SITE = "https://dorado-rifas.vercel.app";
const FROM_NAME = "Dorado Rifas";

function senderAddress() {
  return String(process.env.SMTP_USER || process.env.GMAIL_USER || "").trim();
}

export function welcomeFrom() {
  const sender = senderAddress();
  const named = String(process.env.MAIL_FROM || "").trim();
  const address = sender || named || "Administrador@dorado-rifas.vercel.app";
  return `${FROM_NAME} <${address}>`;
}

export function welcomeSubject(username) {
  const name = String(username || "").trim() || "jugador";
  return `Tu cuenta en Dorado ya está lista, ${name}`;
}

export function welcomeText(username) {
  const name = String(username || "").trim() || "jugador";
  return [
    `Hola, ${name}. Ya tienes tu lugar en Dorado.`,
    "",
    `Te doy la bienvenida. Tu nombre de usuario en Dorado es ${name}. Con esa cuenta entras, marcas números y, si ganas, el premio queda a tu nombre.`,
    "",
    "Quiero ser claro y honesto desde el primer mensaje, para que sepas exactamente cómo se juega y qué puedes esperar.",
    "",
    "Puedes empezar en el tablero de $2.000 por número, que es el monto mínimo, o subir al de $5.000, $10.000, $20.000, $50.000 o $100.000, según lo que prefieras para probar tu suerte. Tú eliges. No tienes que subir de tablero si no quieres.",
    "",
    "El 50% de lo recaudado en el tablero que elegiste jugar, según los números vendidos, puede ser tuyo. Siempre hay un ganador, pero solo entre los números que estén en verde y pagos. Un número amarillo (reservado) o sin pagar no entra al sorteo.",
    "",
    "Cómo se juega, paso a paso:",
    "",
    "1. Entras a " + SITE + " y eliges un tablero. Hay seis: $2.000, $5.000, $10.000, $20.000, $50.000 y $100.000 por número.",
    "",
    "2. Marcas uno o varios números del 00 al 99 y pagas. Cada número de ese tablero vale el precio del tablero.",
    "",
    "3. Me envías el comprobante a un administrador, en el grupo de WhatsApp. En el mismo mensaje informa tu nombre completo, en qué tablero estás jugando y el número o números que elegiste. Si no llega el comprobante, ese número se libera a la 1 hora y otra persona puede tomarlo. Cuando el administrador confirma, el número pasa a verde y queda asegurado: ya no se suelta y sí entra al sorteo.",
    "",
    "4. En el sorteo solo participan los números verdes y pagos. El 50% de lo recaudado en el tablero que elegiste jugar, según los números vendidos, puede ser tuyo. Si tu número no está en verde, no puedes ganar ese sorteo.",
    "",
    "5. El sorteo es todos los días, de lunes a domingo, a las 9:00 p. m., hora de Bogotá. Si tienes un número pago (verde) en ese tablero, ves la cuenta 10, 9, 8… hasta 0, y después el ganador: el número, el nombre, la ciudad y el premio.",
    "",
    "6. A los 10 segundos el tablero se abre otra vez, con los números disponibles. Si ganas, el administrador te envía el premio a tu Nequi.",
    "",
    "Si olvidas tu clave, en la pantalla de entrar usa “Olvidé mi clave” y te llega un correo para crear una nueva.",
    "",
    "Cuando quieras jugar: " + SITE,
    "",
    "Gracias por estar en Dorado.",
    "Te escribe el administrador.",
  ].join("\n");
}

export function welcomeHtml(username) {
  const name = escapeHtml(String(username || "").trim() || "jugador");
  const p = "margin:0 0 14px;font-family:Jost,Segoe UI,sans-serif;font-size:15px;line-height:1.7;color:#cfc6b4;text-align:left;";
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bienvenido a Dorado</title>
</head>
<body style="margin:0;padding:0;background:#0a0b0d;color:#efe8d8;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0a0b0d;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#15171e;border:1px solid #8a713a;border-radius:20px;">
          <tr>
            <td style="padding:36px 32px 8px;text-align:left;">
              <p style="margin:0 0 18px;font-family:Jost,Segoe UI,sans-serif;letter-spacing:0.22em;font-size:11px;color:#c9a24b;text-transform:uppercase;">Dorado Rifas</p>
              <p style="margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.3;color:#e8c877;">Hola, ${name}. Ya tienes tu lugar en Dorado.</p>
              <p style="${p}">Te doy la bienvenida. Tu nombre de usuario en Dorado es <strong style="color:#e8c877;">${name}</strong>. Con esa cuenta entras, marcas números y, si ganas, el premio queda a tu nombre.</p>
              <p style="${p}">Quiero ser claro y honesto desde el primer mensaje, para que sepas exactamente cómo se juega y qué puedes esperar.</p>
              <p style="${p}">Puedes empezar en el tablero de <strong style="color:#e8c877;">$2.000</strong> por número, que es el monto mínimo, o subir al de $5.000, $10.000, $20.000, $50.000 o <strong style="color:#e8c877;">$100.000</strong>, según lo que prefieras para probar tu suerte. Tú eliges. No tienes que subir de tablero si no quieres.</p>
              <p style="${p}">El <strong style="color:#e8c877;">50% de lo recaudado</strong> en el tablero que elegiste jugar, según los números vendidos, puede ser tuyo. Siempre hay un ganador, pero <strong style="color:#efe8d8;">solo entre los números que estén en verde y pagos</strong>. Un número amarillo (reservado) o sin pagar no entra al sorteo.</p>
              <p style="margin:22px 0 12px;font-family:Jost,Segoe UI,sans-serif;letter-spacing:0.14em;font-size:11px;color:#c9a24b;text-transform:uppercase;">Cómo se juega, paso a paso</p>
              ${ruleBlock("1", "Eliges un tablero. Hay seis: $2.000, $5.000, $10.000, $20.000, $50.000 y $100.000 por número.")}
              ${ruleBlock("2", "Marcas uno o varios números del 00 al 99 y pagas. Cada número de ese tablero vale el precio del tablero.")}
              ${ruleBlock("3", "Me envías el comprobante a un administrador, en el grupo de WhatsApp. En el mismo mensaje informa tu nombre completo, en qué tablero estás jugando y el número o números que elegiste. Si no llega el comprobante, ese número se libera a la 1 hora y otra persona puede tomarlo. Cuando el administrador confirma, el número pasa a verde y queda asegurado: ya no se suelta y sí entra al sorteo.")}
              ${ruleBlock("4", "En el sorteo solo participan los números verdes y pagos. El 50% de lo recaudado en el tablero que elegiste jugar, según los números vendidos, puede ser tuyo. Si tu número no está en verde, no puedes ganar ese sorteo.")}
              ${ruleBlock("5", "El sorteo es todos los días, de lunes a domingo, a las 9:00 p. m., hora de Bogotá. Si tienes un número pago (verde) en ese tablero, ves la cuenta 10, 9, 8… hasta 0, y después el ganador: el número, el nombre, la ciudad y el premio.")}
              ${ruleBlock("6", "A los 10 segundos el tablero se abre otra vez, con los números disponibles. Si ganas, el administrador te envía el premio a tu Nequi.")}
              <p style="${p}">Si olvidas tu clave, en la pantalla de entrar usa “Olvidé mi clave” y te llega un correo para crear una nueva.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 36px;text-align:left;">
              <a href="${SITE}" style="display:inline-block;background:linear-gradient(#e8c877,#c9a24b);color:#1a1405;text-decoration:none;font-family:Jost,Segoe UI,sans-serif;font-weight:700;font-size:15px;padding:14px 28px;border-radius:100px;">Entrar a jugar</a>
              <p style="margin:20px 0 0;font-family:Jost,Segoe UI,sans-serif;font-size:14px;line-height:1.6;color:#cfc6b4;">Gracias por estar en Dorado.<br>Te escribe el administrador.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function ruleBlock(num, text) {
  return `<p style="margin:0 0 14px;font-family:Jost,Segoe UI,sans-serif;font-size:15px;line-height:1.7;color:#cfc6b4;"><span style="color:#e8c877;font-weight:700;font-family:Consolas,monospace;">${num}.</span> ${text}</p>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
