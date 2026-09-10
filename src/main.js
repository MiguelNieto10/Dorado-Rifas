import { connectFirestore } from "./db.js";
import { runAuthGate, WHATSAPP_GROUP_LINK } from "./auth.js";

/* ================================================================
   DORADO — RIFAS & SORTEOS (prototipo con dinero simulado)
   ----------------------------------------------------------------
   Notas para quien está aprendiendo a programar (Miguel 👋):
   - El diseño y la lógica siguen igual. Solo se separaron archivos:
     HTML en index.html, CSS en src/styles.css, y este JS en src/main.js.
     La base de datos ya no usa window.claude.use('db') (solo funcionaba
     dentro de Claude): ahora usa Firebase, con la misma forma doc/set.
   - "const" y "let" crean variables. "const" no se puede reasignar
     después; "let" sí. Se usa "const" casi siempre por costumbre
     de buenas prácticas, aunque el contenido de un objeto sí se
     pueda modificar por dentro.
   - Una "función" (function) es un bloque de código con nombre que
     se puede volver a usar. Una "función flecha" (arrow function)
     es solo otra forma de escribirlas: (x) => x * 2.
   - "async/await" se usa para esperar tareas que tardan (como leer
     o guardar datos) sin congelar la app mientras tanto.
   - "addEventListener" conecta un elemento (un botón, por ejemplo)
     con una función que se ejecuta cuando pasa algo (un "evento",
     como un click).
   ================================================================ */

  // ---------- 1. CONFIGURACIÓN Y "SEMILLA" DE DATOS ----------

  // Los 6 cartones disponibles, con su valor en pesos colombianos.
  const CARD_VALUES = [2000, 5000, 10000, 20000, 50000, 100000];

  // ⏱️ Tiempos del sorteo.
  // En producción real, cuando el cartón se llena al 100% se
  // guardaría una espera de 5 minutos y se le avisaría a los
  // jugadores con una notificación (la "alarma" de la que hablamos).
  // En MODO PRUEBA (DEMO_SPEED = true) esa espera se salta por
  // completo: el sorteo arranca de inmediato con un temporizador
  // visible de 10 a 0 mientras los números giran, para que puedas
  // ver el proceso entero ahora mismo sin esperar.
  const DEMO_SPEED = true;
  const SPIN_MS = 10000; // 10 segundos: el temporizador cuenta 10, 9, 8… hasta 0
  const REVEAL_HOLD_MS = 7000; // cuánto se queda visible el resultado antes de reabrir el cartón

  const PROFILE = { name: 'Jugador', city: 'Bogotá' };

  const BOT_NAMES = ['Camila Rojas','Santiago Gómez','Valentina Torres','Andrés Muñoz','Isabella Ramírez',
    'Juan Pablo Castro','Mariana Duarte','Felipe Herrera','Laura Cárdenas','Nicolás Peña','Daniela Ríos',
    'Sebastián Vargas','Gabriela Molano','Alejandro Salazar','Sofía Beltrán','Camilo Restrepo','Valeria Ocampo'];
  const BOT_CITIES = ['Bogotá','Medellín','Cali','Barranquilla','Cartagena','Bucaramanga','Pereira',
    'Manizales','Santa Marta','Cúcuta','Ibagué','Armenia'];

  function randomBot(){
    return {
      owner: BOT_NAMES[Math.floor(Math.random()*BOT_NAMES.length)],
      city: BOT_CITIES[Math.floor(Math.random()*BOT_CITIES.length)],
      isUser:false
    };
  }

  function fmt(n){
    return '$' + Math.round(n).toLocaleString('es-CO');
  }

  function pad2(n){ return String(n).padStart(2,'0'); }

  // Crea un cartón "en blanco": sin números vendidos.
  function freshCard(value){
    const numbers = {};
    for(let i=0;i<100;i++) numbers[pad2(i)] = null;
    return { value, numbers, sold:0, status:'open', countdownEndsAt:null, spinEndsAt:null, pendingWinner:null, history:[] };
  }

  // Crea un cartón ya parcialmente lleno, solo para que la app
  // arranque mostrando algo real en vez de una pantalla vacía.
  function seedCard(value, soldCount, userNumbers){
    const card = freshCard(value);
    const indices = Array.from({length:100}, (_,i)=>pad2(i)).sort(()=>Math.random()-0.5);
    let filled = 0;
    (userNumbers||[]).forEach(n=>{
      card.numbers[n] = randomBot();
      filled++;
    });
    for(const n of indices){
      if(filled >= soldCount) break;
      if(card.numbers[n]) continue;
      card.numbers[n] = randomBot();
      filled++;
    }
    card.sold = filled;
    return card;
  }

  function seedWallet(){
    return {
      balance: 45000,
      activity: [
        { id:'seed1', kind:'recarga', desc:'Recarga inicial de saldo', amount:45000, ts:Date.now() - 1000*60*60*30 }
      ]
    };
  }

  // ---------- 2. ESTADO DE LA APP ----------
  // "state" guarda todo lo que la app necesita recordar mientras
  // está abierta. cardsCache refleja lo último que sabemos de cada
  // cartón (venga de la base de datos o de la simulación local).

  let db = null; // se llena si la capacidad "db" está disponible
  let usingDb = false;
  let currentUid = null;
  const cardsCache = {};
  let wallet = seedWallet();
  let currentView = 'lobby';
  let openCardValue = null;
  let selectedNumbers = new Set();
  let audioCtx = null;

  // ---------- 3. SONIDO SUAVE (opcional, casino discreto) ----------
  function chime(freqs, dur){
    try{
      if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = audioCtx.currentTime;
      freqs.forEach((f,i)=>{
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.05, t0 + 0.02 + i*0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t0 + i*0.05);
        osc.stop(t0 + dur + 0.1);
      });
    }catch(e){ /* el navegador puede bloquear audio sin interacción — no pasa nada */ }
  }

  // ---------- 4. CONEXIÓN CON LA BASE DE DATOS (db) ----------
  // Antes esto pedía window.claude.use('db'), que solo existe
  // dentro de Claude. Ahora connectFirestore() (en src/db.js)
  // habla con Firebase usando el mismo "idioma": db.doc(...).
  // Si no hay claves en .env.local, db queda null y la app
  // sigue en memoria local (se reinicia al recargar).

  function walletDocPath(){
    return currentUid ? ('wallets/' + currentUid) : 'state/wallet';
  }

  async function initDb(){
    try{
      db = connectFirestore();
    }catch(e){ db = null; }

    if(!db){
      usingDb = false;
      return; // ya se sembraron datos locales y se pintó la app antes de llegar aquí
    }
    usingDb = true;

    db.doc(walletDocPath()).onSnapshot((snap)=>{
      if(snap.exists){
        // CORRECCIÓN CLAVE: lo que entrega la base de datos en tiempo
        // real viene "congelado" (de solo lectura) para que nadie lo
        // modifique por accidente sin guardar. Si lo guardamos tal
        // cual y luego intentamos cambiarle algo (por ejemplo
        // wallet.balance += premio), ese cambio se pierde en
        // silencio, sin ningún error. Por eso hacemos una COPIA
        // propia y editable con JSON.parse(JSON.stringify(...)).
        wallet = JSON.parse(JSON.stringify(snap.data()));
      } else {
        wallet = seedWallet();
        db.doc(walletDocPath()).set(wallet).catch(()=>{});
      }
      renderWalletChip();
      if(currentView === 'wallet') renderWalletView();
    }, ()=>{ /* si falla la lectura, seguimos con el último estado conocido */ });

    const seeds = { 2000:41, 5000:78, 10000:12, 20000:0, 50000:55, 100000:3 };
    CARD_VALUES.forEach((value)=>{
      db.doc('cards/'+value).onSnapshot((snap)=>{
        if(snap.exists){
          // CORRECCIÓN CLAVE (el bug real de todo este problema): lo
          // que entrega la base de datos en tiempo real viene
          // "congelado" (de solo lectura) para evitar cambios
          // accidentales sin guardar. Como más abajo hacíamos cosas
          // como "card.sold += 45" directamente sobre ese objeto
          // congelado, esa suma se perdía en silencio (sin ningún
          // error) — los números SÍ se marcaban como vendidos, pero
          // el contador "sold" se quedaba pegado en el valor viejo, y
          // por eso nunca llegaba a 100 y el sorteo nunca arrancaba.
          // La solución es trabajar siempre sobre una COPIA propia y
          // editable, nunca sobre el objeto que entrega la base de
          // datos directamente.
          cardsCache[value] = JSON.parse(JSON.stringify(snap.data()));
          // "Sanamos" datos guardados por una versión anterior de la
          // app: hoy solo existen dos estados posibles ('open' y
          // 'drawing'). Cualquier otro valor guardado antes (como el
          // viejo estado intermedio de cuenta regresiva) se trata
          // como cartón abierto normal, para que nunca quede
          // "atascado" sin poder venderse ni sortearse.
          if(cardsCache[value].status !== 'drawing'){
            cardsCache[value].status = 'open';
            // Si ya estaba 100% vendido (por ejemplo, quedó así de
            // una prueba anterior), disparamos el sorteo de una vez
            // en lugar de dejarlo esperando un clic más.
            if(cardsCache[value].sold >= 100){
              startCountdown(cardsCache[value]);
            }
          }
        } else {
          const userNums = value===5000 ? ['07','42'] : [];
          const fresh = seedCard(value, seeds[value]||0, userNums);
          cardsCache[value] = fresh;
          db.doc('cards/'+value).set(fresh).catch(()=>{});
        }
        renderLobbyCard(value);
        if(openCardValue === value) renderCardDetail(value);
        // Nota: ya no filtramos aquí por "!drawRunning[value]" — esa
        // decisión ahora vive DENTRO de runDrawAnimation (ver su propio
        // comentario), que revisa si el aviso de sorteo está realmente
        // visible en pantalla en vez de confiar ciegamente en la
        // bandera en memoria.
        if(cardsCache[value].status === 'drawing'){
          runDrawAnimation(cardsCache[value]);
        }
      }, ()=>{});
    });
  }

  function seedLocalIfEmpty(){
    const seeds = { 2000:41, 5000:78, 10000:12, 20000:0, 50000:55, 100000:3 };
    CARD_VALUES.forEach((value)=>{
      if(!cardsCache[value]){
        const userNums = value===5000 ? ['07','42'] : [];
        cardsCache[value] = seedCard(value, seeds[value]||0, userNums);
      }
    });
  }

  function saveWallet(){
    if(usingDb){ db.doc(walletDocPath()).set(wallet).catch(()=>{}); }
    renderWalletChip();
    if(currentView === 'wallet') renderWalletView();
  }

  function saveCard(value){
    const card = cardsCache[value];
    if(usingDb){ db.doc('cards/'+value).set(card).catch(()=>{}); }
    renderLobbyCard(value);
    if(openCardValue === value) renderCardDetail(value);
  }

  function addActivity(kind, desc, amount){
    wallet.activity.unshift({ id:'a'+Date.now()+Math.random().toString(16).slice(2), kind, desc, amount, ts:Date.now() });
    wallet.activity = wallet.activity.slice(0, 40);
  }

  // ---------- 5. NAVEGACIÓN ENTRE VISTAS ----------
  function showView(name){
    currentView = name;
    document.querySelectorAll('.view').forEach(v=>v.hidden = true);
    document.getElementById('view-'+name).hidden = false;
    document.querySelectorAll('.nav button[data-nav]').forEach(b=>{
      b.classList.toggle('active', b.dataset.nav === name);
    });
    if(name === 'wallet') renderWalletView();
    if(name === 'historial') renderHistorialView();
    window.scrollTo({top:0, behavior:'instant'});
  }

  function openCard(value){
    openCardValue = value;
    showView('card');
    renderCardDetail(value);
    selectedNumbers.clear();
  }

  // ---------- 6. RENDER: LOBBY ----------
  function renderAll(){
    renderWalletChip();
    CARD_VALUES.forEach(renderLobbyCard);
    renderLobbyStats();
    if(openCardValue) renderCardDetail(openCardValue);
    if(currentView === 'wallet') renderWalletView();
    if(currentView === 'historial') renderHistorialView();
  }

  function statusLabel(status){
    if(status === 'open') return 'ABIERTO';
    if(status === 'drawing') return 'EN SORTEO';
    return 'ABIERTO';
  }
  function statusPillClass(status){
    if(status === 'drawing') return 'pill pill-drawing';
    return 'pill pill-open';
  }

  function renderLobbyStats(){
    const activeCount = CARD_VALUES.filter(v=>cardsCache[v] && cardsCache[v].sold > 0).length;
    let maxPot = 0;
    CARD_VALUES.forEach(v=>{
      const c = cardsCache[v];
      if(c) maxPot = Math.max(maxPot, c.sold * v * 0.5);
    });
    document.getElementById('statActive').textContent = activeCount + ' / ' + CARD_VALUES.length;
    document.getElementById('statPot').textContent = fmt(maxPot);
  }

  function renderLobbyCard(value){
    const card = cardsCache[value];
    if(!card) return;
    let el = document.getElementById('ticket-'+value);
    if(!el){
      el = document.createElement('div');
      el.className = 'ticket';
      el.id = 'ticket-'+value;
      document.getElementById('cardsGrid').appendChild(el);
    }
    const pot = card.sold * value * 0.5;
    el.innerHTML =
      '<div class="ticket-top">' +
        '<span class="ticket-value">' + fmt(value) + '</span>' +
        '<span class="' + statusPillClass(card.status) + '">' + statusLabel(card.status) + '</span>' +
      '</div>' +
      '<div class="progress-track"><div class="progress-fill" style="width:' + card.sold + '%"></div></div>' +
      '<div class="progress-meta"><span>Números vendidos</span><span class="mono">' + card.sold + '/100</span></div>' +
      '<div class="pot-line"><span class="k">Premio actual</span><span class="v">' + fmt(pot) + '</span></div>' +
      '<button class="btn btn-gold btn-block" data-open="' + value + '">Ver cartón</button>';
    // El clic en "Ver cartón" lo maneja el oyente central de la
    // sección 13 (busca elementos con el atributo data-open), así
    // que aquí no hace falta conectar nada manualmente.
    renderLobbyStats();
  }

  // ---------- 7. RENDER: VISTA DE CARTÓN ----------
  function renderCardDetail(value){
    const card = cardsCache[value];
    if(!card) return;
    document.getElementById('cdTitle').textContent = fmt(value);
    document.getElementById('cdSold').textContent = card.sold + '/100';
    document.getElementById('cdPot').textContent = fmt(card.sold * value * 0.5);
    document.getElementById('cdPer').textContent = fmt(value);
    const statusEl = document.getElementById('cdStatus');
    statusEl.textContent = statusLabel(card.status);
    statusEl.className = statusPillClass(card.status);

    const grid = document.getElementById('numGrid');
    grid.innerHTML = '';
    for(let i=0;i<100;i++){
      const n = pad2(i);
      const owner = card.numbers[n];
      const cell = document.createElement('div');
      cell.textContent = n;
      cell.dataset.num = n; // el oyente central de clics usa este dato para saber qué número tocaron
      if(owner){
        cell.className = 'num-cell taken' + ((owner.owner === PROFILE.name || owner.owner === 'Tú') ? ' taken-user' : '');
        const dot = document.createElement('span');
        dot.className = 'owner-dot';
        dot.textContent = (owner.owner === PROFILE.name || owner.owner === 'Tú') ? 'Tú' : owner.owner.split(' ')[0];
        cell.appendChild(dot);
        cell.title = owner.owner + ' · ' + owner.city;
      } else if(card.status === 'open'){
        cell.className = 'num-cell available' + (selectedNumbers.has(n) ? ' selected' : '');
      } else {
        cell.className = 'num-cell';
      }
      grid.appendChild(cell);
    }
    renderSelectionBar(value);

    const histWrap = document.getElementById('historySection');
    const strip = document.getElementById('historyStrip');
    if(card.history && card.history.length){
      histWrap.hidden = false;
      strip.innerHTML = card.history.map(h=>
        '<div class="history-chip"><div class="hn">Nº ' + h.winningNumber + '</div>' +
        '<div class="hw">' + (h.wonByUser ? '🏆 Tú' : h.winnerName) + '</div>' +
        '<div class="hp">' + fmt(h.prize) + ' · ' + h.winnerCity + '</div></div>'
      ).join('');
    } else {
      histWrap.hidden = true;
    }
  }

  function toggleNumber(n){
    if(selectedNumbers.has(n)) selectedNumbers.delete(n); else selectedNumbers.add(n);
    renderCardDetail(openCardValue);
  }

  function renderSelectionBar(value){
    const bar = document.getElementById('selectionBar');
    if(selectedNumbers.size === 0){ bar.hidden = true; return; }
    bar.hidden = false;
    document.getElementById('selCount').textContent = selectedNumbers.size;
    document.getElementById('selTotal').textContent = fmt(selectedNumbers.size * value);
  }

  // ---------- 8. COMPRA Y PAGO (simulado) ----------
  function openPaymentModal(){
    const value = openCardValue;
    const total = selectedNumbers.size * value;
    document.getElementById('payDesc').textContent = 'Cartón de ' + fmt(value) + ' · ' + selectedNumbers.size + ' número(s)';
    document.getElementById('payNums').textContent = Array.from(selectedNumbers).sort().join(', ');
    document.getElementById('payTotal').textContent = fmt(total);
    document.getElementById('payWalletSub').textContent = 'Disponible: ' + fmt(wallet.balance);
    document.getElementById('payWallet').disabled = wallet.balance < total;
    document.getElementById('payWallet').style.opacity = wallet.balance < total ? 0.45 : 1;
    openModal('modalPayment');
  }

  function confirmPurchase(method){
    const value = openCardValue;
    const card = cardsCache[value];
    const nums = Array.from(selectedNumbers);
    const total = nums.length * value;

    if(method === 'wallet'){
      if(wallet.balance < total){ toast('Saldo insuficiente en tu billetera'); return; }
      wallet.balance -= total;
      addActivity('compra', 'Cartón ' + fmt(value) + ' · números ' + nums.join(', ') + ' (saldo billetera)', -total);
    } else {
      addActivity('compra', 'Cartón ' + fmt(value) + ' · números ' + nums.join(', '), 0);
    }
    saveWallet();

    nums.forEach(n=>{ card.numbers[n] = { owner: PROFILE.name, city: PROFILE.city, isUser:true }; });
    card.sold += nums.length;
    selectedNumbers.clear();

    if(card.sold >= 100){
      startCountdown(card);
    }
    saveCard(value);
    closeModal();
    toast('¡Listo! Compraste ' + nums.length + ' número(s) del cartón ' + fmt(value));
  }

  // ---------- 9. SIMULAR OTROS JUGADORES (herramienta de prueba) ----------
  function simulatePlayers(value, count){
    const card = cardsCache[value];
    if(!card || card.status !== 'open') return;
    const available = Object.keys(card.numbers).filter(n=>!card.numbers[n]);
    // "count" puede ser Infinity (botón "completar cartón"): en ese
    // caso siempre llenamos TODO lo que quede disponible, sin importar
    // cuántos números falten.
    const toFill = available.sort(()=>Math.random()-0.5).slice(0, Math.min(count, available.length));
    toFill.forEach(n=>{ card.numbers[n] = randomBot(); });
    card.sold += toFill.length;
    if(card.sold >= 100){ startCountdown(card); }
    saveCard(value);
    toast(toFill.length + ' jugadores simulados se unieron al cartón ' + fmt(value));
  }

  // ---------- 10. SORTEO ----------
  // En cuanto el cartón llega a 100/100 se llama esta función, que
  // arranca el sorteo YA MISMO: decide el número ganador, avisa con
  // un sonido y un mensaje, y abre la pantalla de sorteo con el
  // temporizador visible de 10 a 0.
  function startCountdown(card){
    card.status = 'drawing';
    card.spinEndsAt = Date.now() + SPIN_MS;
    // El número ganador ya se decide aquí (server-side en un caso
    // real), pero no se muestra hasta que el temporizador llegue a 0.
    const allNums = Object.keys(card.numbers);
    card.pendingWinner = allNums[Math.floor(Math.random()*allNums.length)];
    chime([660, 880], 0.5);
    toast('🔔 ¡Cartón de ' + fmt(card.value) + ' completo! Comienza el sorteo…');
    // Importante: guardamos YA el estado "en sorteo". Si no lo
    // guardáramos aquí, la base de datos seguiría diciendo "abierto
    // y lleno", y cada vez que llegara una actualización (incluso
    // una rutinaria, sin cambios reales) la app pensaría que hay que
    // volver a arrancar el sorteo desde cero.
    saveCard(card.value);
    runDrawAnimation(card);
  }

  let drawRunning = {};
  let lastWinnerMsg = '';
  function runDrawAnimation(card){
    const overlayEl = document.getElementById('drawOverlay');
    // CORRECCIÓN CLAVE: la bandera "drawRunning" es solo una variable
    // en memoria. Si una prueba anterior se interrumpió a medias
    // (recargaste a mitad de un sorteo, cerraste el aviso a la fuerza,
    // etc.) esta bandera podía quedar encendida para siempre para ese
    // cartón, y entonces CUALQUIER clic futuro en "Completar cartón y
    // sortear ahora" para ese mismo cartón no hacía nada visible (los
    // números sí se llenaban, pero el aviso de sorteo nunca aparecía).
    // La única prueba confiable de que un sorteo está REALMENTE
    // ocurriendo ahora en pantalla es si el aviso de sorteo está
    // visible. Si no lo está, ignoramos la bandera vieja y dejamos que
    // el sorteo arranque de nuevo — así un cartón nunca queda
    // "trabado" de forma silenciosa.
    if(drawRunning[card.value] && overlayEl && !overlayEl.hidden) return;
    drawRunning[card.value] = true;
    const stage = document.getElementById('drawStage');
    document.getElementById('drawOverlay').hidden = false;
    // CORRECCIÓN ADICIONAL: este aviso usa "position:fixed", que se
    // ancla a la ventana visible. Si la página estaba desplazada hacia
    // abajo (por ejemplo, viendo los números 80-99 o la "Herramienta
    // de prueba" al fondo) en algunos navegadores ese anclaje puede
    // quedar fuera de la parte visible según cómo esté incrustada la
    // página. Para que el aviso SIEMPRE quede a la vista sin importar
    // dónde estabas mirando, subimos la página al inicio apenas
    // arranca el sorteo.
    window.scrollTo({top:0, left:0, behavior:'instant'});

    // Si la app se recargó a mitad de un sorteo, retomamos el
    // conteo desde donde iba en vez de empezar de cero.
    const startedAt = card.spinEndsAt ? (card.spinEndsAt - SPIN_MS) : Date.now();

    // "alreadyFinished" evita que el resultado se procese dos veces
    // (por ejemplo, si la red de seguridad de abajo y el giro normal
    // terminaran casi al mismo tiempo): solo la primera llamada cuenta.
    let alreadyFinished = false;
    function finishOnce(){
      if(alreadyFinished) return;
      alreadyFinished = true;
      clearTimeout(watchdog);
      try{
        finishDraw(card);
      }catch(e){
        console.error('Error terminando el sorteo:', e);
      }
    }

    // Red de seguridad: si por lo que sea (el navegador puso en
    // pausa la pestaña, algo tardó más de la cuenta, etc.) la
    // animación no llega sola a mostrar el resultado, esto la
    // fuerza a terminar de todas formas, un segundo y medio después
    // de que el temporizador debía llegar a 0. Así nunca se queda
    // "trabada" para siempre.
    const watchdog = setTimeout(finishOnce, SPIN_MS + 1500);

    function frame(){
      try{
        if(alreadyFinished) return; // ya se resolvió por otra vía; no seguir animando
        const elapsed = Date.now() - startedAt;
        const left = Math.max(0, SPIN_MS - elapsed);
        const pct = Math.round((elapsed/SPIN_MS)*100);
        const secLeft = Math.ceil(left/1000);

        if(left <= 0){
          // Aquí es cuando la cuenta regresiva llega a 0: la ruleta
          // se detiene exactamente en el número ganador.
          stage.innerHTML =
            '<span class="draw-kicker">Cartón ' + fmt(card.value) + ' · sorteo en vivo</span>' +
            '<div class="draw-ring" style="--pct:100"><span class="ring-num">0</span></div>' +
            '<div class="reel"><span class="reel-digit">' + card.pendingWinner[0] + '</span><span class="reel-digit">' + card.pendingWinner[1] + '</span></div>' +
            '<p class="draw-msg">¡Aquí está el número ganador!</p>';
          chime([784], 0.4);
          setTimeout(finishOnce, 900);
          return;
        }

        const current = pad2(Math.floor(Math.random()*100));
        stage.innerHTML =
          '<span class="draw-kicker">Cartón ' + fmt(card.value) + ' · sorteo en vivo</span>' +
          '<div class="draw-ring" style="--pct:' + Math.min(100,pct) + '"><span class="ring-num">' + secLeft + '</span></div>' +
          '<div class="reel spinning"><span class="reel-digit">' + current[0] + '</span><span class="reel-digit">' + current[1] + '</span></div>' +
          '<p class="draw-msg">Girando… el número ganador aparecerá al llegar a 0</p>';
        requestAnimationFrame(frame);
      }catch(e){
        // Si algo inesperado falla a mitad del giro, no dejamos la
        // pantalla trabada: forzamos el resultado final igual.
        finishOnce();
      }
    }
    requestAnimationFrame(frame);
  }

  function finishDraw(card){
    const winnerSlot = card.numbers[card.pendingWinner];
    const value = card.value;
    const prize = value * 50; // 50% de (100 números * valor)
    const wonByUser = !!(winnerSlot && (winnerSlot.owner === PROFILE.name || winnerSlot.owner === 'Tú'));
    const winnerName = winnerSlot ? winnerSlot.owner : 'Sin comprador';
    const winnerCity = winnerSlot ? winnerSlot.city : '—';

    chime(wonByUser ? [523,659,784,1046] : [440,554], 0.7);

    if(wonByUser){
      wallet.balance += prize;
      addActivity('premio', 'Ganaste el sorteo del cartón ' + fmt(value) + ' (número ' + card.pendingWinner + ')', prize);
      saveWallet();
    }

    card.history = [{ winningNumber:card.pendingWinner, winnerName, winnerCity, prize, wonByUser, ts:Date.now() }]
      .concat(card.history||[]).slice(0,5);
    if(currentView === 'historial') renderHistorialView();

    // Mensaje listo para pegar en el grupo de WhatsApp: sirve como
    // "constancia" pública de que el premio se entregó de verdad.
    lastWinnerMsg = '🏆 *Dorado Rifas* — ¡Tenemos ganador!\n' +
      'Cartón: ' + fmt(value) + '\n' +
      'Número ganador: ' + card.pendingWinner + '\n' +
      'Ganador(a): ' + winnerName + '\n' +
      'Ciudad: ' + winnerCity + '\n' +
      'Premio: ' + fmt(prize) + '\n' +
      'Fecha: ' + new Date().toLocaleString('es-CO',{dateStyle:'medium',timeStyle:'short'}) + '\n\n' +
      '¡Gracias por jugar! 🎉';

    const overlay = document.getElementById('drawOverlay');
    overlay.classList.toggle('is-win', wonByUser);

    const stage = document.getElementById('drawStage');
    stage.innerHTML =
      '<div class="reveal-card' + (wonByUser ? ' won' : '') + '" id="revealCard">' +
        (wonByUser ? '<div class="reveal-congrats">¡Ganaste!</div>' : '<div class="reveal-congrats">Número ganador</div>') +
        '<div class="reveal-num">' + card.pendingWinner + '</div>' +
        '<div class="reveal-winner">' + (wonByUser ? 'El premio es tuyo' : winnerName) + '</div>' +
        '<div class="reveal-city">' + winnerCity + '</div>' +
        '<div class="reveal-prize">' + fmt(prize) + '</div>' +
        (wonByUser ? '<p class="draw-msg" style="margin-top:10px;">Ya está en tu billetera. Úsalo en otro cartón o retíralo a Nequi.</p>'
                   : '<p class="draw-msg" style="margin-top:10px;">Este cartón se reabre en unos segundos para todo el público.</p>') +
      '</div>' +
      '<div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin-top:2px;">' +
        '<button class="btn btn-outline btn-sm" id="copyWinnerMsgBtn" type="button">📋 Copiar mensaje para el grupo</button>' +
        '<button class="btn btn-outline" id="drawCloseBtn" type="button" data-value="' + card.value + '">Cerrar</button>' +
      '</div>';

    spawnConfetti(overlay, wonByUser ? 90 : 36);

    // El botón "Cerrar" lo maneja el oyente central de clics (sección
    // 13), que lee data-value para saber a qué cartón cerrar/reabrir.
    setTimeout(()=>closeDrawAndReset(card), REVEAL_HOLD_MS);
  }

  function closeDrawAndReset(card){
    if(!drawRunning[card.value]) return; // ya se cerró
    document.getElementById('drawOverlay').hidden = true;
    document.getElementById('drawOverlay').classList.remove('is-win');
    drawRunning[card.value] = false;

    const fresh = freshCard(card.value);
    fresh.history = card.history;
    cardsCache[card.value] = fresh;
    saveCard(card.value);
    toast('El cartón de ' + fmt(card.value) + ' se reabrió para todo el público 🎟️');
  }

  // Botón de emergencia: deja el cartón abierto como el primer día
  // (números vacíos, nada seleccionado), por si alguna prueba lo deja
  // en un estado raro. No borra el historial de sorteos anteriores.
  function forceResetCard(value){
    document.getElementById('drawOverlay').hidden = true;
    document.getElementById('drawOverlay').classList.remove('is-win');
    drawRunning[value] = false;
    const old = cardsCache[value];
    const fresh = freshCard(value);
    fresh.history = old ? old.history : [];
    cardsCache[value] = fresh;
    selectedNumbers.clear();
    saveCard(value);
    toast('Cartón de ' + fmt(value) + ' reiniciado');
  }

  function spawnConfetti(container, count){
    if(!container) return;
    let layer = container.querySelector('.confetti-layer');
    if(!layer){
      layer = document.createElement('div');
      layer.className = 'confetti-layer';
      container.appendChild(layer);
    }
    layer.innerHTML = '';
    // Paleta solo dorada / marfil / ámbar: el verde se salía de la gama casino.
    const colors = ['#e8c877','#c9a24b','#f4e4b0','#efe8d8','#8a713a','#c98a2f'];
    const n = count || 70;
    for(let i=0;i<n;i++){
      const p = document.createElement('div');
      const round = Math.random() > 0.55;
      p.className = 'confetti-piece' + (round ? ' round' : '');
      p.style.left = (Math.random()*100) + '%';
      p.style.background = colors[Math.floor(Math.random()*colors.length)];
      p.style.width = (round ? 6 + Math.random()*7 : 5 + Math.random()*5) + 'px';
      p.style.height = (round ? 6 + Math.random()*7 : 10 + Math.random()*14) + 'px';
      p.style.setProperty('--dx', (Math.random()*160 - 80) + 'px');
      p.style.animationDuration = (2.4 + Math.random()*2.2) + 's';
      p.style.animationDelay = (Math.random()*0.7) + 's';
      layer.appendChild(p);
      setTimeout(()=>p.remove(), 5200);
    }
  }

  // ---------- 11. BILLETERA: recargar / retirar ----------
  function renderWalletChip(){
    document.getElementById('walletBalance').textContent = fmt(wallet.balance);
  }

  function renderWalletView(){
    document.getElementById('wvBalance').textContent = fmt(wallet.balance);
    const list = document.getElementById('activityList');
    if(!wallet.activity || wallet.activity.length === 0){
      list.innerHTML = '<div class="empty-note">Todavía no tienes movimientos.</div>';
      return;
    }
    const icons = { compra:'🎟️', premio:'🏆', retiro:'📲', recarga:'➕' };
    list.innerHTML = wallet.activity.map(a=>{
      const showAmt = a.amount !== 0;
      const cls = a.amount > 0 ? 'amt-pos' : 'amt-neg';
      const sign = a.amount > 0 ? '+' : (a.amount < 0 ? '−' : '');
      return '<div class="activity-row">' +
        '<div class="activity-icon ai-' + a.kind + '">' + (icons[a.kind]||'•') + '</div>' +
        '<div class="activity-body"><div class="activity-desc">' + a.desc + '</div>' +
        '<div class="activity-date">' + new Date(a.ts).toLocaleString('es-CO',{dateStyle:'medium',timeStyle:'short'}) + '</div></div>' +
        (showAmt ? '<div class="activity-amt ' + cls + '">' + sign + fmt(Math.abs(a.amount)) + '</div>' : '') +
        '</div>';
    }).join('');
  }

  // Muestra el historial separado por cartón: un bloque por cada
  // valor ($2.000, $5.000, etc.), cada uno con sus propios ganadores
  // ordenados del sorteo más reciente al más antiguo.
  function renderHistorialView(){
    const list = document.getElementById('historialList');
    const cardsWithHistory = CARD_VALUES.filter(v=> cardsCache[v] && cardsCache[v].history && cardsCache[v].history.length);

    if(cardsWithHistory.length === 0){
      list.innerHTML = '<div class="empty-note">Todavía no se ha realizado ningún sorteo.</div>';
      return;
    }

    list.innerHTML = cardsWithHistory.map(v=>{
      const winners = cardsCache[v].history.slice().sort((a,b)=> b.ts - a.ts);
      const rows = winners.map(h=>{
        const name = h.wonByUser ? 'Tú' : h.winnerName;
        return '<div class="activity-row">' +
          '<div class="activity-icon ai-premio">🏆</div>' +
          '<div class="activity-body"><div class="activity-desc">' + name + ' · ' + h.winnerCity + ' · Nº ' + h.winningNumber + '</div>' +
          '<div class="activity-date">' + new Date(h.ts).toLocaleString('es-CO',{dateStyle:'medium',timeStyle:'short'}) + '</div></div>' +
          '<div class="activity-amt amt-pos">' + fmt(h.prize) + '</div>' +
          '</div>';
      }).join('');
      const countLbl = winners.length + (winners.length === 1 ? ' ganador' : ' ganadores');
      return '<details class="hist-group">' +
        '<summary>Cartón ' + fmt(v) + '<span class="hist-count">' + countLbl + '</span></summary>' +
        '<div class="activity-list">' + rows + '</div>' +
      '</details>';
    }).join('');
  }

  function doDeposit(amount){
    if(!amount || amount <= 0) return;
    wallet.balance += amount;
    addActivity('recarga', 'Recarga de saldo', amount);
    saveWallet();
    closeModal();
    toast('Se agregaron ' + fmt(amount) + ' a tu billetera');
  }

  function doWithdraw(amount){
    if(!amount || amount <= 0) return;
    if(amount > wallet.balance){ toast('No puedes retirar más de tu saldo disponible'); return; }
    wallet.balance -= amount;
    addActivity('retiro', 'Retiro a Nequi', -amount);
    saveWallet();
    closeModal();
    toast(fmt(amount) + ' enviados a tu cuenta Nequi');
  }

  // ---------- 12. MODALES Y TOAST (utilidades de interfaz) ----------
  function openModal(id){
    document.getElementById('modalOverlay').hidden = false;
    document.querySelectorAll('#modalOverlay .modal').forEach(m=>m.hidden = (m.id !== id));
  }
  function closeModal(){
    document.getElementById('modalOverlay').hidden = true;
  }

  let toastTimer = null;
  function toast(msg){
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>{ el.hidden = true; }, 3200);
  }

  // ---------- 13. CONECTAR BOTONES (un solo "oyente" para toda la app) ----------
  // En vez de conectar cada botón por separado (document.getElementById('x')
  // .addEventListener(...) una y otra vez), ponemos UN SOLO "oyente" de
  // clics en todo el documento. Cuando pasa un clic en cualquier parte,
  // revisamos en qué elemento cayó (con "closest", que busca hacia
  // arriba el elemento más cercano que coincida) y decidimos qué hacer.
  //
  // ¿Por qué así? Porque conectar botones uno por uno es fràgil: si
  // uno solo de esos "document.getElementById(...)" no encuentra su
  // elemento (por cualquier motivo raro del navegador), TODO el
  // código que viene después se detiene silenciosamente y ningún
  // botón posterior queda conectado. Con un solo oyente, y protegido
  // con try/catch, un problema en una parte nunca apaga el resto de
  // la app — y además funciona automáticamente con botones que se
  // crean después (como los números del cartón o "Cerrar" del sorteo).
  document.addEventListener('click', function(e){
    try{
      const t = e.target;

      // Seguridad extra: si un aviso anterior quedó pegado en pantalla
      // por más tiempo del que debería, lo escondemos apenas detectamos
      // CUALQUIER clic nuevo en la página (aunque ya no bloquee clics
      // gracias a pointer-events:none de arriba, así no queda un
      // mensaje viejo estorbando visualmente).
      const stuckToast = document.getElementById('toast');
      if(stuckToast && !stuckToast.hidden){ stuckToast.hidden = true; }

      const navBtn = t.closest('.nav button[data-nav]');
      if(navBtn){ showView(navBtn.dataset.nav); return; }

      if(t.closest('#walletChip')){ showView('wallet'); return; }
      if(t.closest('#backBtn')){ showView('lobby'); return; }
      if(t.closest('#howBtn2') || t.closest('#demoInfoBtn')){ openModal('modalHow'); return; }
      if(t.closest('#howClose')){ closeModal(); return; }
      if(t.closest('#joinWhatsappBtn')){ window.open(WHATSAPP_GROUP_LINK, '_blank', 'noopener'); return; }

      const openBtn = t.closest('[data-open]');
      if(openBtn){ openCard(parseInt(openBtn.dataset.open, 10)); return; }

      const numCell = t.closest('.num-cell[data-num]');
      if(numCell && numCell.classList.contains('available')){ toggleNumber(numCell.dataset.num); return; }

      if(t.closest('#clearSelBtn')){ selectedNumbers.clear(); renderCardDetail(openCardValue); return; }
      if(t.closest('#payBtn')){ openPaymentModal(); return; }
      if(t.closest('#payCancel')){ closeModal(); return; }
      if(t.closest('#payEpayco')){ confirmPurchase('epayco'); return; }
      if(t.closest('#payWallet')){
        if(wallet.balance >= selectedNumbers.size * openCardValue) confirmPurchase('wallet');
        return;
      }

      const simBtn = t.closest('[data-sim]');
      if(simBtn){
        const raw = simBtn.dataset.sim;
        const count = raw === 'all' ? Infinity : parseInt(raw, 10);
        simulatePlayers(openCardValue, count);
        return;
      }
      if(t.closest('#resetCardBtn')){ forceResetCard(openCardValue); return; }

      if(t.closest('#depositBtn')){
        document.getElementById('depositInput').value = '';
        openModal('modalDeposit');
        return;
      }
      if(t.closest('#depositCancel')){ closeModal(); return; }
      if(t.closest('#depositConfirm')){ doDeposit(parseInt(document.getElementById('depositInput').value, 10)); return; }
      const amtBtn = t.closest('#modalDeposit [data-amt]');
      if(amtBtn){ document.getElementById('depositInput').value = amtBtn.dataset.amt; return; }

      if(t.closest('#withdrawBtn')){
        document.getElementById('withdrawSub').textContent = 'Disponible: ' + fmt(wallet.balance);
        document.getElementById('withdrawInput').value = '';
        openModal('modalWithdraw');
        return;
      }
      if(t.closest('#withdrawCancel')){ closeModal(); return; }
      if(t.closest('#withdrawConfirm')){ doWithdraw(parseInt(document.getElementById('withdrawInput').value, 10)); return; }

      if(t.closest('#copyWinnerMsgBtn')){
        try{
          navigator.clipboard.writeText(lastWinnerMsg);
          toast('📋 Mensaje copiado — pégalo en el grupo de WhatsApp');
        }catch(e){
          toast('No se pudo copiar solo. Mantén presionado el texto para copiarlo.');
        }
        return;
      }

      const closeBtn = t.closest('#drawCloseBtn');
      if(closeBtn){
        const v = parseInt(closeBtn.dataset.value, 10);
        if(cardsCache[v]) closeDrawAndReset(cardsCache[v]);
        return;
      }

      if(t.id === 'modalOverlay'){ closeModal(); return; }
    }catch(err){
      // Nunca dejamos que un error inesperado deje la app "muda":
      // lo dejamos anotado en la consola y seguimos funcionando.
      console.error('Error manejando un clic:', err);
      toast('Ups, algo falló con esa acción. Intenta de nuevo.');
    }
  });

  // ---------- 14. ARRANQUE ----------
  // Primero la cuenta (nombre, clave, celular, WhatsApp). Después
  // se pintan los cartones y se conecta Firestore.
  runAuthGate().then((session)=>{
    PROFILE.name = session.username || 'Jugador';
    currentUid = session.uid;
    seedLocalIfEmpty();
    renderAll();
    initDb();
  });
