/**
 * Ruta de servidor para pagos (Vercel: /api/crear-pago).
 * Los cobros en la app se marcan como Nequi; el dinero sigue simulado.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }

  res.status(200).json({
    ok: true,
    simulated: true,
    method: "nequi",
    message: "El pago se registra como Nequi. Envía el comprobante a un administrador del grupo.",
  });
}
