# Dorado Rifas — estado del proyecto

Este archivo es una nota para quien retome el proyecto (tú mismo, o el asistente de IA de Cursor) sin tener que releer toda la conversación.

## Qué es esto

Una app de rifas/sorteos con cartones de 100 números (00-99), en 6 valores ($2.000 a $100.000). Cuando un cartón se llena al 100%, se dispara solo un sorteo animado (ruleta con cuenta regresiva) y el premio (50% de lo recaudado) se acredita al ganador. Hecha para practicar programación con ayuda de IA.

## Estado actual

- El **diseño y la lógica** (cartones, sorteo animado, billetera, comentarios "CORRECCIÓN CLAVE") se conservaron. Ya no viven en un solo `index.html`: se separaron en archivos para poder usar Vite, como en tus otras tiendas.
- Funciona 100% como demo con **dinero simulado**. No procesa pagos reales ni transferencias reales todavía.
- La base de datos de Claude (`window.claude.use('db')`) se reemplazó por **Firebase Firestore**. Si no hay claves de Firebase en `.env.local`, la app sigue funcionando en memoria (cada recarga empieza de cero).
- Hay una carpeta `api/` para código de servidor (llaves secretas de ePayco). Los pagos reales siguen desactivados.

- Al abrir el link, la persona crea **nombre de usuario, clave, celular**, puede **recordar la clave** y, si el celular lo permite, **huella / Face ID**. Al final debe unirse al **grupo de WhatsApp** (los ganadores se publican ahí). WhatsApp no deja agregar gente solo: hay que pulsar el link.
- El link del grupo está en `src/auth.js` (`WHATSAPP_GROUP_LINK`). Reemplázalo cuando tengas el grupo real.
- En Firebase Console hay que activar **Authentication → Sign-in method → Correo/contraseña**. Sin eso, “Crear cuenta” falla.

Copia de seguridad del archivo único original: `legacy/index.html`.

## Mapa de carpetas (palabras simples)

| Qué ves | Para qué sirve |
|---|---|
| `index.html` | La estructura de la página (títulos, botones, cartones). Es el "esqueleto". |
| `src/styles.css` | El aspecto visual (colores dorados, tipografía, layout). Es la "ropa". |
| `src/main.js` | El comportamiento (clics, sorteo, billetera). Es el "cerebro". Casi no se tocó. |
| `src/db.js` | El único archivo nuevo de lógica: traduce Firebase al mismo idioma que usaba Claude (`db.doc(...).set(...)`). |
| `package.json` | La lista de herramientas del proyecto. `npm install` lee este archivo. |
| `vite.config.js` | Configuración de Vite (el programa que sirve la app en local). |
| `api/` | Código que corre en el **servidor**, no en el navegador. Aquí irán las llaves secretas. |
| `.env.example` | Plantilla de secretos. Cópiala a `.env.local` y rellena. Nunca subas `.env.local` a internet. |
| `firestore.rules` | Quién puede leer/escribir en Firebase. Hoy está abierto porque es un demo. |

## Por qué el dinero es simulado

Operar rifas con dinero real en Colombia es una actividad regulada por Coljuegos (Ley 643 de 2001) — aplica igual así sea solo para familiares y amigos. Se necesita autorización antes de cobrar dinero real. Mientras esa autorización no exista, el dinero debe seguir simulado.

## Cómo ver la app en tu computador

1. Instala [Node.js](https://nodejs.org) (versión LTS) si aún no lo tienes. Eso te da el comando `npm`.
2. Abre una terminal en esta carpeta y corre:

```bash
npm install
npm run dev
```

3. Vite te da una dirección (casi siempre `http://localhost:5173`). Ábrela en el navegador.
4. Ya **no** abras el HTML con doble clic: Vite necesita servir los archivos para que funcionen los `import` y Firebase.

## Cómo conectar Firebase (para que todos vean los mismos cartones)

1. Entra a [Firebase Console](https://console.firebase.google.com) con tu cuenta Google.
2. Crea un proyecto (puedes llamarlo `dorado-rifas`).
3. Activa **Firestore Database** (modo de prueba está bien al principio).
4. En Configuración del proyecto → Tus apps → Web, copia las claves.
5. Copia `.env.example` a `.env.local` y pega ahí las claves `VITE_FIREBASE_*`.
6. En Firestore, publica las reglas del archivo `firestore.rules` (o pégalas a mano).
7. Reinicia `npm run dev`.

Sin esas claves, la app **no se rompe**: usa datos locales, como cuando abrías el HTML suelto.

## Lo que falta para ser un sitio real (en orden lógico)

1. **Cuenta de Firebase tuya** con las variables de `.env.local` rellenadas (arriba).
2. **Dominio + hosting**: Vercel (el mismo tipo de despliegue que Camisetas/URO). Las variables de entorno se pegan en el panel de Vercel, no en el código.
3. **Grupo de WhatsApp real**: reemplaza `WHATSAPP_GROUP_LINK` en `src/auth.js`.
4. **Pasarela de pago real**: cuenta de ePayco. Las llaves van en `EPAYCO_PUBLIC_KEY` / `EPAYCO_PRIVATE_KEY` (servidor). El esqueleto está en `api/crear-pago.js`. La app todavía cobra en simulado.
5. **Diseño de custodia del dinero** y pagos de salida a Nequi.
6. **Autorización de Coljuegos** antes de activar dinero real.

## Cómo seguir en Cursor

Abre esta carpeta completa (`Documentos\DoradoRifas`) como proyecto. Para instalar, arrancar Vite o desplegar, usa la terminal: el asistente de Cursor puede ejecutar esos comandos.
