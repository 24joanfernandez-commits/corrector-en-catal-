# ♠ Royal Casino

Casino online para jugar con tus amigos en la misma WiFi: **Póker (Texas Hold'em)**, **Blackjack** y **Ruleta**.
Las fichas son virtuales, así que no se juega con dinero real.

## Cómo arrancarlo

1. Instala **Node.js** (gratis): https://nodejs.org → descarga la versión **LTS**.
2. Descomprime esta carpeta en tu portátil.
3. Haz doble clic en:
   - Windows: `INICIAR-WINDOWS.bat`
   - Mac / Linux: `INICIAR-MAC-LINUX.command`
   La primera vez tarda un poco porque instala lo necesario.
4. Se abre una ventana negra con algo así:

   ```
   En este ordenador:   http://localhost:3000
   Para tus amigos:     http://192.168.1.35:3000
   ```

5. Tú entra en `http://localhost:3000`. Tus amigos escriben **la segunda dirección** en el navegador de su móvil o portátil.
6. **No cierres la ventana negra** mientras jugáis, porque es el servidor.

> Si Windows pregunta por el **Firewall**, pulsa **Permitir acceso**. Si no lo haces, tus amigos no podrán entrar.

## Si tus amigos no pueden entrar

- Comprobad que estáis todos en **la misma WiFi**.
- Muchas WiFi de colegio **bloquean la conexión entre dispositivos** (se llama "aislamiento de clientes"). En ese caso no se puede jugar por esa red. Alternativas:
  - Crea una **zona WiFi (hotspot) con tu móvil** y conectad todos (también el portátil) a ella. Es lo que mejor funciona.
  - O usa un túnel gratis: instala `cloudflared` y ejecuta `cloudflared tunnel --url http://localhost:3000`. Te da un enlace `https://...trycloudflare.com` que funciona desde cualquier sitio.

## Qué incluye

- Cuentas con usuario y contraseña. Cada cuenta nueva recibe **1.000 fichas**.
- **Póker**: mesas de 3 a 10 jugadores, ciegas 10/20, subir, igualar, all-in, botes secundarios y temporizador de turno.
- **Blackjack**: mesas de 1 a 7 jugadores, doblar, la banca se planta en 17 y el blackjack paga 3:2.
- **Ruleta europea**: bola animada, plenos, colores, par/impar, docenas y columnas.
- Chat general en el lobby y chat en cada mesa.
- Animaciones de reparto de cartas y pantallas de **VICTORY** y **DEFEAT**.
- Ranking de jugadores y bono de 500 fichas si te quedas con menos de 100.

Las cuentas y las fichas se guardan en `data/db.json`. Si borras ese archivo, se reinicia todo.
Para usar otro puerto: `PORT=4000 node server.js`.
