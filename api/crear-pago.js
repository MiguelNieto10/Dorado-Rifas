/**
 * Ruta de servidor para ePayco (Vercel: /api/crear-pago).
 *
 * Las llaves secretas se leen de process.env, no del HTML/JS del navegador.
 * Los cobros reales siguen desactivados (dinero simulado + Coljuegos).
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }

  const hasKeys = Boolean(process.env.EPAYCO_PUBLIC_KEY && process.env.EPAYCO_PRIVATE_KEY);

  res.status(200).json({
    ok: true,
    simulated: true,
    epaycoConfigured: hasKeys,
    message:
      "Los pagos reales aún no están activos. Esta ruta es el lugar del servidor donde se usarán las llaves de ePayco.",
  });
}
