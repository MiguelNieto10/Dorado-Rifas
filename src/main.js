import { connectFirestore } from "./db.js";
import { runAuthGate, signOutSession, isAdminEntry, WHATSAPP_GROUP_LINK } from "./auth.js";
import { createDrawRecorder } from "./drawRecord.js";
import { bogotaDateKey } from "./drawStore.js";
import { bindAdminFilters, refreshAdminViews } from "./admin.js";

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
  const REVEAL_HOLD_MS = 10000; // ganador visible 10 s, sin cuenta en pantalla, luego se reabre
  const HOLD_MS = 60 * 60 * 1000; // 1 hora para pagar y enviar el comprobante
  const DRAW_HOUR_BOGOTA = 21;

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

  function isHeld(slot){
    return !!(slot && slot.pending && !slot.confirmed && slot.heldUntil && Date.now() < slot.heldUntil);
  }
  function isPaid(slot){
    if(!slot) return false;
    if(isHeld(slot)) return false;
    if(slot.pending && !slot.confirmed) return false;
    return true;
  }
  function paidNumbers(card){
    return Object.keys(card.numbers || {}).filter((n)=> isPaid(card.numbers[n]));
  }
  function slotBelongsToMe(slot){
    if(!slot) return false;
    if(currentUid && slot.ownerUid && slot.ownerUid === currentUid) return true;
    return slot.owner === PROFILE.name || slot.owner === 'Tú' || slot.isUser === true;
  }
  function userHasPaidOn(card){
    return paidNumbers(card).some((n)=> slotBelongsToMe(card.numbers[n]));
  }
  function shouldWatchDraw(card){
    if(!card) return false;
    if(isAdmin) return true;
    return userHasPaidOn(card);
  }
  function isDrawLive(card){
    return !!(card && (card.status === 'drawing' || card.status === 'revealed'));
  }
  function recountSold(card){
    card.sold = paidNumbers(card).length;
  }
  function expireHolds(card){
    if(!card || !card.numbers) return false;
    let changed = false;
    Object.keys(card.numbers).forEach((n)=>{
      const slot = card.numbers[n];
      if(slot && slot.pending && !slot.confirmed && slot.heldUntil && Date.now() >= slot.heldUntil){
        card.numbers[n] = null;
        changed = true;
      }
    });
    if(changed) recountSold(card);
    return changed;
  }
  function bogotaStamp(){
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    });
    const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p)=>[p.type, p.value]));
    return { date: parts.year + '-' + parts.month + '-' + parts.day, hour: parseInt(parts.hour, 10), minute: parseInt(parts.minute, 10) };
  }
  function nextQueuedBoard(date){
    const busy = CARD_VALUES.some((value)=>{
      const card = cardsCache[value];
      return card && (card.status === 'drawing' || card.status === 'revealed');
    });
    if(busy) return null;
    return CARD_VALUES.find((value)=>{
      const card = cardsCache[value];
      if(!card || card.status !== 'open') return false;
      if(card.lastDrawDate === date) return false;
      return paidNumbers(card).length > 0;
    });
  }
  function startNextQueuedBoard(){
    const { date, hour } = bogotaStamp();
    if(hour < DRAW_HOUR_BOGOTA) return;
    const value = nextQueuedBoard(date);
    if(value == null) return;
    startCountdown(cardsCache[value], false);
  }
  function playerHasPaidTonight(){
    return CARD_VALUES.some((value)=>{
      const card = cardsCache[value];
      if(!card) return false;
      return paidNumbers(card).some((n)=> slotBelongsToMe(card.numbers[n]));
    });
  }
  const GROUP_ALERT_TEXT =
    'Dorado Rifas\n' +
    'En 5 minutos empieza el sorteo de hoy.\n\n' +
    'Orden:\n' +
    '1. Tablero de $2.000\n' +
    '2. Luego $5.000, $10.000, $20.000, $50.000 y $100.000, en ese orden.\n\n' +
    'Solo se sortea un tablero si tiene números en verde (pagos). Si no tiene verdes, se salta al siguiente.\n' +
    'Entra a https://dorado-rifas.vercel.app';
  const GROUP_ALERT_SCREEN =
    'En 5 minutos empieza el sorteo. Primero el tablero de $2.000. Después $5.000, $10.000, $20.000, $50.000 y $100.000, en ese orden, solo si tienen números verdes (pagos). Si un tablero no tiene verdes, se salta.';
  function copyText(text){
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        return navigator.clipboard.writeText(String(text || ''));
      }
    }catch(e){ /* el celular a veces bloquea copiar sin un clic */ }
    return Promise.resolve();
  }
  function openWhatsAppGroup(){
    window.open(WHATSAPP_GROUP_LINK, '_blank', 'noopener');
  }
  async function sendTextToGroup(text){
    await copyText(text);
    openWhatsAppGroup();
    toast('Mensaje copiado. Pégalo en el grupo de Dorado.');
  }
  async function sendDrawToGroup(){
    try{
      const payload = { title:'Dorado Rifas', text: lastWinnerMsg };
      if(lastDrawFile && navigator.canShare && navigator.canShare({ files:[lastDrawFile] })){
        payload.files = [lastDrawFile];
      }
      if(navigator.share){
        await navigator.share(payload);
        toast('Elige el grupo de Dorado y envía.');
        return;
      }
    }catch(e){ /* canceló o el celular no adjunta video */ }
    await copyText(lastWinnerMsg);
    openWhatsAppGroup();
    toast('Pega el mensaje en el grupo. Si sale el video, adjúntalo en el mismo chat.');
  }
  function showDrawAlertBanner(text){
    const { date } = bogotaStamp();
    const key = 'dorado.drawAlert.' + date;
    if(sessionStorage.getItem(key) === '1') return;
    const box = document.getElementById('drawAlert');
    const msg = document.getElementById('drawAlertText');
    if(!box || !msg) return;
    msg.textContent = text || GROUP_ALERT_SCREEN;
    const groupBtn = document.getElementById('drawAlertGroup');
    if(groupBtn) groupBtn.hidden = !isAdmin;
    box.hidden = false;
  }
  function hideDrawAlertBanner(){
    const box = document.getElementById('drawAlert');
    if(box) box.hidden = true;
    sessionStorage.setItem('dorado.drawAlert.' + bogotaStamp().date, '1');
  }
  let drawAlertPosted = false;
  async function kickDrawAlert(){
    const text = GROUP_ALERT_SCREEN;
    if(isAdmin || playerHasPaidTonight()) showDrawAlertBanner(text);
    if(drawAlertPosted) return;
    drawAlertPosted = true;
    if(usingDb && db){
      const date = bogotaStamp().date;
      const uids = [];
      CARD_VALUES.forEach((value)=>{
        const card = cardsCache[value];
        if(!card) return;
        paidNumbers(card).forEach((n)=>{
          const slot = card.numbers[n];
          if(slot && slot.ownerUid) uids.push(slot.ownerUid);
        });
      });
      db.doc('notices/draw-' + date).set({
        sent: true,
        sentAt: Date.now(),
        date,
        text: GROUP_ALERT_TEXT,
        uids,
        channel: 'group'
      }).catch(()=>{});
    }
  }
  function maybeScheduledDraws(){
    const { hour, minute } = bogotaStamp();
    if(hour === 20 && minute >= 55) kickDrawAlert();
    if(hour < DRAW_HOUR_BOGOTA) return;
    startNextQueuedBoard();
  }

  const BOARD_LIVE_GEN = 4;

  // Crea un tablero en blanco: sin números vendidos.
  function freshCard(value){
    const numbers = {};
    for(let i=0;i<100;i++) numbers[pad2(i)] = null;
    return { value, numbers, sold:0, status:'open', countdownEndsAt:null, spinEndsAt:null, pendingWinner:null, history:[], lastDrawDate:null, drawCollected:null, boardGen: BOARD_LIVE_GEN };
  }

  function emptyLiveBoard(value, history){
    const card = freshCard(value);
    card.history = history || [];
    return card;
  }

  // Crea un cartón ya parcialmente lleno, solo para que la app
  // arranque mostrando algo real en vez de una pantalla vacía.
  function seedCard(value, soldCount, userNumbers){
    const card = freshCard(value);
    const indices = Array.from({length:100}, (_,i)=>pad2(i)).sort(()=>Math.random()-0.5);
    let filled = 0;
    (userNumbers||[]).forEach(n=>{
      card.numbers[n] = Object.assign(randomBot(), { confirmed:true, pending:false });
      filled++;
    });
    for(const n of indices){
      if(filled >= soldCount) break;
      if(card.numbers[n]) continue;
      card.numbers[n] = Object.assign(randomBot(), { confirmed:true, pending:false });
      filled++;
    }
    card.sold = filled;
    return card;
  }

  function seedWallet(){
    return {
      balance: 0,
      activity: []
    };
  }

  // ---------- 2. ESTADO DE LA APP ----------
  // "state" guarda todo lo que la app necesita recordar mientras
  // está abierta. cardsCache refleja lo último que sabemos de cada
  // cartón (venga de la base de datos o de la simulación local).

  let db = null; // se llena si la capacidad "db" está disponible
  let usingDb = false;
  let currentUid = null;
  let isAdmin = false;
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
          if(!cardsCache[value].numbers) cardsCache[value].numbers = {};
          if(cardsCache[value].status !== 'drawing' && cardsCache[value].status !== 'revealed'){
            cardsCache[value].status = 'open';
          }
        } else {
          cardsCache[value] = emptyLiveBoard(value, []);
        }
        renderLobbyCard(value);
        if(openCardValue === value) renderCardDetail(value);
        renderAdminLiveLists();
        // Nota: ya no filtramos aquí por "!drawRunning[value]" — esa
        // decisión ahora vive DENTRO de runDrawAnimation (ver su propio
        // comentario), que revisa si el aviso de sorteo está realmente
        // visible en pantalla en vez de confiar ciegamente en la
        // bandera en memoria.
        if(isDrawLive(cardsCache[value])){
          runDrawAnimation(cardsCache[value]);
        }
      }, ()=>{});
    });

    const noticeDate = bogotaStamp().date;
    db.doc('notices/draw-' + noticeDate).onSnapshot((snap)=>{
      if(!snap.exists) return;
      const notice = snap.data() || {};
      if(!notice.sent) return;
      const mine = (notice.uids || []).includes(currentUid) || playerHasPaidTonight();
      if(isAdmin || mine) showDrawAlertBanner(notice.text);
    }, ()=>{});
  }

  function reloadBoardsFromDb(){
    if(!usingDb || !db){
      renderAll();
      toast('Tableros actualizados.');
      return;
    }
    toast('Actualizando…');
    Promise.all(CARD_VALUES.map((value)=>
      db.doc('cards/'+value).get().then((snap)=>{
        if(snap.exists){
          cardsCache[value] = JSON.parse(JSON.stringify(snap.data()));
          if(!cardsCache[value].numbers) cardsCache[value].numbers = {};
          if(cardsCache[value].status !== 'drawing' && cardsCache[value].status !== 'revealed'){
            cardsCache[value].status = 'open';
          }
        } else {
          cardsCache[value] = emptyLiveBoard(value, []);
        }
        renderLobbyCard(value);
        if(openCardValue === value) renderCardDetail(value);
      }).catch(()=>{})
    )).then(()=>{
      renderAdminLiveLists();
      if(isAdmin) refreshAdminViews(cardsCache);
      toast('Tableros actualizados.');
    });
  }

  function seedLocalIfEmpty(){
    CARD_VALUES.forEach((value)=>{
      if(!cardsCache[value]) cardsCache[value] = emptyLiveBoard(value, []);
    });
  }

  function saveWallet(){
    if(usingDb){ db.doc(walletDocPath()).set(wallet).catch(()=>{}); }
    renderWalletChip();
    if(currentView === 'wallet') renderWalletView();
  }

  function cardToDb(card){
    const numbers = {};
    Object.keys(card.numbers || {}).forEach((n)=>{
      if(card.numbers[n]) numbers[n] = card.numbers[n];
    });
    return Object.assign({}, card, { numbers, boardGen: BOARD_LIVE_GEN });
  }

  function persistSlots(value, keys){
    const card = cardsCache[value];
    if(!card) return;
    renderLobbyCard(value);
    if(openCardValue === value) renderCardDetail(value);
    renderAdminLiveLists();
    if(!usingDb) return;
    db.doc('cards/'+value).set(cardToDb(card)).catch((e)=>{
      console.error(e);
      toast('No se pudo reservar el número. Intenta de nuevo.');
    });
  }

  function saveCard(value){
    const card = cardsCache[value];
    if(usingDb){
      db.doc('cards/'+value).set(cardToDb(card)).catch((err)=>{
        console.error('No se guardó el tablero', value, err);
      });
    }
    renderLobbyCard(value);
    if(openCardValue === value) renderCardDetail(value);
    renderAdminLiveLists();
  }

  function addActivity(kind, desc, amount){
    wallet.activity.unshift({ id:'a'+Date.now()+Math.random().toString(16).slice(2), kind, desc, amount, ts:Date.now() });
    wallet.activity = wallet.activity.slice(0, 40);
  }

  // ---------- 5. NAVEGACIÓN ENTRE VISTAS ----------
  function showView(name){
    name = String(name || '').trim();
    if(name === 'wallet') name = 'lobby';
    const next = document.getElementById('view-'+name);
    if(!next) return;
    currentView = name;
    document.querySelectorAll('.view').forEach(v=>v.hidden = true);
    next.hidden = false;
    document.querySelectorAll('[data-nav]').forEach(b=>{
      b.classList.toggle('active', b.dataset.nav === name);
    });
    const live = document.getElementById('adminLiveLists');
    if(live) live.hidden = !(isAdmin && name === 'lobby');
    if(name === 'historial') renderHistorialView();
    if(isAdmin && (name === 'admin-users' || name === 'admin-caja' || name === 'admin-videos')){
      refreshAdminViews(cardsCache);
    }
    window.scrollTo({top:0, behavior:'instant'});
  }

  function openCard(value){
    openCardValue = value;
    showView('card');
    renderCardDetail(value);
    selectedNumbers.clear();
  }

  function confirmHold(value, num){
    const card = cardsCache[value];
    const slot = card && card.numbers && card.numbers[num];
    if(!isAdmin || !slot || !isHeld(slot)) return false;
    slot.pending = false;
    slot.confirmed = true;
    delete slot.heldUntil;
    recountSold(card);
    saveCard(value);
    toast('Número ' + num + ' del tablero ' + fmt(value) + ' asegurado en verde.');
    return true;
  }

  function escapeAdmin(s){
    return String(s ?? '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  function renderAdminLiveLists(){
    const root = document.getElementById('adminLiveLists');
    if(!root) return;
    if(!isAdmin){
      root.innerHTML = '';
      return;
    }
    const openIds = new Set(Array.from(root.querySelectorAll('details[open]')).map((d)=>d.dataset.board));
    const blocks = CARD_VALUES.map((value)=>{
      const card = cardsCache[value] || emptyLiveBoard(value, []);
      const rows = [];
      for(let i=0;i<100;i++){
        const n = pad2(i);
        const slot = card.numbers && card.numbers[n];
        if(!slot) continue;
        const held = isHeld(slot);
        const paid = isPaid(slot);
        const estado = held ? 'Reservado 1 h' : (paid ? 'Verde · asegurado' : 'Pendiente');
        const cls = held ? 'held' : (paid ? 'green' : '');
        const who = slot.fullName || slot.owner || '—';
        const user = slot.owner && slot.owner !== who ? ' · @' + slot.owner : '';
        const phone = slot.phone || '—';
        const btn = held
          ? '<button class="btn btn-gold btn-sm" type="button" data-confirm-hold="' + value + '" data-confirm-num="' + n + '">Pasar a verde</button>'
          : '';
        rows.push(
          '<tr class="' + cls + '">' +
            '<td class="mono">' + n + '</td>' +
            '<td>' + escapeAdmin(who) + escapeAdmin(user) + '</td>' +
            '<td class="mono">' + escapeAdmin(phone) + '</td>' +
            '<td>' + estado + '</td>' +
            '<td>' + btn + '</td>' +
          '</tr>'
        );
      }
      const heldCount = Object.keys(card.numbers||{}).filter((n)=>isHeld(card.numbers[n])).length;
      const greenCount = paidNumbers(card).length;
      const body = rows.length
        ? '<div class="admin-live-table-wrap"><table class="admin-live-table"><thead><tr><th>Nº</th><th>Nombre</th><th>Celular</th><th>Estado</th><th></th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>'
        : '<p class="admin-live-empty">Nadie ha tomado números en este tablero.</p>';
      const openAttr = (openIds.has(String(value)) || heldCount > 0) ? ' open' : '';
      return (
        '<details class="admin-live-board" data-board="' + value + '"' + openAttr + '>' +
          '<summary>Tablero ' + fmt(value) + ' <span>Reservados ' + heldCount + ' · Verdes ' + greenCount + '</span></summary>' +
          body +
        '</details>'
      );
    }).join('');
    root.innerHTML =
      '<span class="section-label">Números en vivo (para cruzar con el comprobante)</span>' +
      '<p class="admin-live-lead">Abre el tablero que te escribió el jugador. Si coincide nombre, tablero y números, pulsa Pasar a verde.</p>' +
      blocks;
  }

  // ---------- 6. RENDER: LOBBY ----------
  function renderAll(){
    renderWalletChip();
    CARD_VALUES.forEach(renderLobbyCard);
    renderLobbyStats();
    renderAdminLiveLists();
    if(openCardValue) renderCardDetail(openCardValue);
    if(currentView === 'wallet') renderWalletView();
    if(currentView === 'historial') renderHistorialView();
  }

  function statusLabel(status){
    if(status === 'open') return 'ABIERTO';
    if(status === 'drawing' || status === 'revealed') return 'EN SORTEO';
    return 'ABIERTO';
  }
  function statusPillClass(status){
    if(status === 'drawing' || status === 'revealed') return 'pill pill-drawing';
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
    if(expireHolds(card)) saveCard(value);
    let el = document.getElementById('ticket-'+value);
    if(!el){
      el = document.createElement('div');
      el.className = 'ticket';
      el.id = 'ticket-'+value;
      document.getElementById('cardsGrid').appendChild(el);
    }
    const heldCount = Object.keys(card.numbers || {}).filter((n)=>isHeld(card.numbers[n])).length;
    const pot = card.sold * value * 0.5;
    el.innerHTML =
      '<div class="ticket-top">' +
        '<span class="ticket-value">' + fmt(value) + '</span>' +
        '<span class="' + statusPillClass(card.status) + '">' + statusLabel(card.status) + '</span>' +
      '</div>' +
      '<div class="progress-track"><div class="progress-fill" style="width:' + card.sold + '%"></div></div>' +
      '<div class="progress-meta"><span>Números vendidos</span><span class="mono">' + card.sold + '/100</span></div>' +
      (heldCount ? '<div class="progress-meta"><span>Reservados (1 h)</span><span class="mono">' + heldCount + '</span></div>' : '') +
      '<div class="pot-line"><span class="k">Premio actual</span><span class="v">' + fmt(pot) + '</span></div>' +
      '<button class="btn btn-gold btn-block" data-open="' + value + '">Ver tablero</button>';
    // El clic en "Ver cartón" lo maneja el oyente central de la
    // sección 13 (busca elementos con el atributo data-open), así
    // que aquí no hace falta conectar nada manualmente.
    renderLobbyStats();
  }

  // ---------- 7. RENDER: VISTA DE CARTÓN ----------
  function renderCardDetail(value){
    const card = cardsCache[value];
    if(!card) return;
    if(expireHolds(card)) saveCard(value);
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
      cell.dataset.num = n;
      if(isHeld(owner)){
        cell.className = 'num-cell held';
        const dot = document.createElement('span');
        dot.className = 'owner-dot';
        dot.textContent = (owner.owner === PROFILE.name || owner.owner === 'Tú') ? 'Tú' : (owner.owner || '').split(' ')[0];
        cell.appendChild(dot);
        cell.title = 'Reservado 1 hora · envía el comprobante a un administrador';
        if(isAdmin) cell.title += ' · clic para asegurar (verde)';
      } else if(owner){
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
    const hist = (card.history || []).slice().sort((a,b)=> (b.ts||0) - (a.ts||0));
    if(hist.length){
      histWrap.hidden = false;
      const histKey = value + ':' + hist.map((h)=> (h.ts||'') + '-' + (h.winningNumber||'')).join('|');
      if(strip.dataset.histKey !== histKey){
        strip.dataset.histKey = histKey;
        const chips = hist.map((h)=>{
          const when = h.ts ? new Date(h.ts).toLocaleDateString('es-CO', { day:'numeric', month:'short' }) : '';
          return '<article class="history-chip">' +
            '<div class="hn">Nº ' + h.winningNumber + '</div>' +
            '<div class="hw">' + (h.wonByUser ? 'Tú' : (h.winnerName || '—')) + '</div>' +
            '<div class="hp">' + fmt(h.prize) + (h.winnerCity ? ' · ' + h.winnerCity : '') + '</div>' +
            (when ? '<div class="hd">' + when + '</div>' : '') +
          '</article>';
        }).join('');
        const copies = hist.length < 4 ? 4 : 2;
        const seconds = Math.max(22, hist.length * copies * 4);
        strip.innerHTML = '<div class="history-track" style="animation-duration:' + seconds + 's">' + chips.repeat(copies) + '</div>';
      }
    } else {
      histWrap.hidden = true;
      strip.innerHTML = '';
      delete strip.dataset.histKey;
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

  const NEQUI_DORADO = '3150505240';
  function openPaymentModal(){
    const value = openCardValue;
    const total = selectedNumbers.size * value;
    document.getElementById('payDesc').textContent = 'Tablero de ' + fmt(value) + ' · ' + selectedNumbers.size + ' número(s)';
    document.getElementById('payNums').textContent = Array.from(selectedNumbers).sort().join(', ');
    document.getElementById('payTotal').textContent = fmt(total);
    openModal('modalPayment');
  }

  function confirmPurchase(method){
    const value = openCardValue;
    const card = cardsCache[value];
    const nums = Array.from(selectedNumbers);
    const total = nums.length * value;

    addActivity('compra', 'Tablero ' + fmt(value) + ' · números ' + nums.join(', ') + ' (Nequi)', 0);
    saveWallet();

    nums.forEach(n=>{
      card.numbers[n] = {
        owner: PROFILE.name,
        city: PROFILE.city,
        phone: PROFILE.phone || '',
        fullName: PROFILE.fullName || PROFILE.name,
        isUser: true,
        ownerUid: currentUid || null,
        boughtAt: Date.now(),
        pending: true,
        confirmed: false,
        heldUntil: Date.now() + HOLD_MS
      };
    });
    recountSold(card);
    selectedNumbers.clear();

    if(usingDb && currentUid){
      const playId = currentUid + '-' + value + '-' + nums.map((n) => String(n).padStart(2, '0')).sort().join('-');
      db.doc('plays/' + playId).set({
        uid: currentUid,
        username: PROFILE.name,
        cardValue: value,
        numbers: nums,
        count: nums.length,
        amount: total,
        method,
        ts: Date.now()
      }).catch(()=>{});
    }

    persistSlots(value, nums);
    const sorted = nums.slice().sort();
    document.getElementById('nequiPayNums').textContent = sorted.join(', ');
    document.getElementById('nequiPayAmount').textContent = fmt(total);
    openModal('modalNequiPay');
    renderCardDetail(value);
  }

  function copyNequiNumber(){
    const n = NEQUI_DORADO;
    const done = () => toast('Número Nequi copiado: ' + n);
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(n).then(done).catch(()=>{
        window.prompt('Copia este número Nequi de Dorado:', n);
      });
    } else {
      window.prompt('Copia este número Nequi de Dorado:', n);
    }
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
    toFill.forEach(n=>{ card.numbers[n] = Object.assign(randomBot(), { confirmed:true, pending:false }); });
    recountSold(card);
    if(count === Infinity && paidNumbers(card).length > 0){ startCountdown(card, true); }
    saveCard(value);
    toast(toFill.length + ' jugadores simulados se unieron al tablero ' + fmt(value));
  }

  // ---------- 10. SORTEO ----------
  // En cuanto el cartón llega a 100/100 se llama esta función, que
  // arranca el sorteo YA MISMO: decide el número ganador, avisa con
  // un sonido y un mensaje, y abre la pantalla de sorteo con el
  // temporizador visible de 10 a 0.
  function startCountdown(card, force){
    const pool = paidNumbers(card);
    if(pool.length === 0) return;
    if(card.status === 'drawing' && card.pendingWinner) return;
    if(card.status === 'revealed') return;
    if(!force){
      card.lastDrawDate = bogotaStamp().date;
    }
    card.status = 'drawing';
    card.spinEndsAt = Date.now() + SPIN_MS;
    card.pendingWinner = pool[Math.floor(Math.random()*pool.length)];
    card.drawCollected = pool.length * card.value;
    card.drawId = card.value + '-' + Date.now();
    card.drawSettled = false;
    card.revealEndsAt = null;
    chime([660, 880], 0.5);
    toast('🔔 Sorteo del tablero ' + fmt(card.value) + ': cuenta 10 a 0 entre números verdes y pagos.');
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
  let lastDrawFile = null;
  let drawRec = null;
  const creditedDraws = {};
  const revealShown = {};
  let revealCloseTimer = null;
  function runDrawAnimation(card){
    if(!shouldWatchDraw(card)) return;
    const overlayEl = document.getElementById('drawOverlay');
    if(overlayEl && !overlayEl.hidden && overlayEl.dataset.cardValue && overlayEl.dataset.cardValue !== String(card.value)){
      return;
    }
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
    if(drawRunning[card.value] && overlayEl && !overlayEl.hidden){
      if(card.status === 'revealed' || (card.spinEndsAt && Date.now() >= card.spinEndsAt)){
        finishDraw(card);
      }
      return;
    }
    drawRunning[card.value] = true;
    if(openCardValue !== card.value){
      openCardValue = card.value;
      showView('card');
      renderCardDetail(card.value);
    }
    const stage = document.getElementById('drawStage');
    overlayEl.hidden = false;
    overlayEl.dataset.cardValue = String(card.value);
    // CORRECCIÓN ADICIONAL: este aviso usa "position:fixed", que se
    // ancla a la ventana visible. Si la página estaba desplazada hacia
    // abajo (por ejemplo, viendo los números 80-99 o la "Herramienta
    // de prueba" al fondo) en algunos navegadores ese anclaje puede
    // quedar fuera de la parte visible según cómo esté incrustada la
    // página. Para que el aviso SIEMPRE quede a la vista sin importar
    // dónde estabas mirando, subimos la página al inicio apenas
    // arranca el sorteo.
    window.scrollTo({top:0, left:0, behavior:'instant'});

    drawRec = createDrawRecorder();
    if(!drawRec.start()) drawRec = null;

    if(card.status === 'revealed' || (card.spinEndsAt && Date.now() >= card.spinEndsAt)){
      finishDraw(card);
      return;
    }

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
            '<span class="draw-kicker">Tablero ' + fmt(card.value) + ' · sorteo en vivo</span>' +
            '<div class="draw-ring" style="--pct:100"><span class="ring-num">0</span></div>' +
            '<div class="reel"><span class="reel-digit">' + card.pendingWinner[0] + '</span><span class="reel-digit">' + card.pendingWinner[1] + '</span></div>' +
            '<p class="draw-msg">¡Aquí está el número ganador!</p>';
          if(drawRec) drawRec.spin({ kicker:'Tablero ' + fmt(card.value) + ' · sorteo en vivo', sec:0, d0:card.pendingWinner[0], d1:card.pendingWinner[1] });
          chime([784], 0.4);
          setTimeout(finishOnce, 900);
          return;
        }

        const current = pad2(Math.floor(Math.random()*100));
        stage.innerHTML =
          '<span class="draw-kicker">Tablero ' + fmt(card.value) + ' · sorteo en vivo</span>' +
          '<div class="draw-ring" style="--pct:' + Math.min(100,pct) + '"><span class="ring-num">' + secLeft + '</span></div>' +
          '<div class="reel spinning"><span class="reel-digit">' + current[0] + '</span><span class="reel-digit">' + current[1] + '</span></div>' +
          '<p class="draw-msg">Girando… el número ganador aparecerá al llegar a 0</p>';
        if(drawRec) drawRec.spin({ kicker:'Tablero ' + fmt(card.value) + ' · sorteo en vivo', sec:secLeft, d0:current[0], d1:current[1] });
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
    if(!card || !card.pendingWinner) return;
    const winnerSlot = card.numbers[card.pendingWinner];
    const value = card.value;
    const prize = (card.drawCollected != null ? card.drawCollected : paidNumbers(card).length * value) * 0.5;
    const wonByUser = slotBelongsToMe(winnerSlot);
    const winnerName = winnerSlot ? winnerSlot.owner : 'Sin comprador';
    const winnerCity = winnerSlot ? winnerSlot.city : '—';
    const when = new Date().toLocaleString('es-CO',{dateStyle:'medium',timeStyle:'short'});
    const paidCount = card.drawCollected != null ? Math.round(card.drawCollected / value) : paidNumbers(card).length;
    const drawKey = card.drawId || (value + '-' + card.pendingWinner);

    if(!card.drawSettled){
      card.drawSettled = true;
      card.status = 'revealed';
      card.revealEndsAt = Date.now() + REVEAL_HOLD_MS;
      card.history = [{ winningNumber:card.pendingWinner, winnerName, winnerCity, prize, wonByUser:false, ts:Date.now(), winnerUid: winnerSlot && winnerSlot.ownerUid ? winnerSlot.ownerUid : null }]
        .concat(card.history||[]).slice(0, 365);
      saveCard(value);
      if(usingDb && db){
        db.doc('draws/' + drawKey).set({
          cardValue: value,
          winningNumber: card.pendingWinner,
          winnerName,
          winnerCity,
          winnerUid: winnerSlot && winnerSlot.ownerUid ? winnerSlot.ownerUid : null,
          prize,
          collected: card.drawCollected != null ? card.drawCollected : prize * 2,
          paidCount,
          ts: Date.now(),
          dateKey: bogotaDateKey(),
          newCardOpen: true
        }).catch(()=>{});
      }
    }

    if(currentView === 'historial') renderHistorialView();

    lastWinnerMsg = '🏆 *Dorado Rifas* — Sorteo oficial\n' +
      'Tablero de juego: ' + fmt(value) + '\n' +
      'Número ganador: *' + card.pendingWinner + '*\n' +
      'Ganador(a): ' + winnerName + '\n' +
      'Ciudad: ' + winnerCity + '\n' +
      'Premio (50% de lo recaudado): ' + fmt(prize) + '\n' +
      'Números pagos: ' + paidCount + '\n' +
      'Fecha: ' + when + '\n\n' +
      'El tablero de ' + fmt(value) + ' ya está *habilitado de nuevo*.\n' +
      'Únete y juega: ' + location.origin;

    if(wonByUser && !creditedDraws[drawKey]){
      creditedDraws[drawKey] = true;
    }

    if(!shouldWatchDraw(card)) return;

    if(revealShown[drawKey]){
      scheduleRevealClose(card);
      return;
    }
    revealShown[drawKey] = true;

    chime(wonByUser ? [523,659,784,1046] : [440,554], 0.7);

    const rec = drawRec;
    drawRec = null;
    const clip = {
      kicker: 'Tablero ' + fmt(value) + ' · sorteo en vivo',
      number: card.pendingWinner,
      name: winnerName,
      city: winnerCity,
      prize: fmt(prize)
    };
    let recorder = rec;
    if(!recorder){
      recorder = createDrawRecorder();
      if(!recorder.start()) recorder = null;
    }
    if(recorder){
      try{
        recorder.winner(clip);
        const hold = setInterval(()=>{ try{ recorder.winner(clip); }catch(e){} }, 200);
        setTimeout(()=>{
          clearInterval(hold);
          recorder.stop().then((blob)=>{
            if(!blob){ lastDrawFile = null; return; }
            const ext = blob.type.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
            lastDrawFile = new File([blob], 'sorteo-dorado-' + card.pendingWinner + '.' + ext, { type: blob.type });
          }).catch(()=>{ lastDrawFile = null; });
        }, 2800);
      }catch(e){
        lastDrawFile = null;
      }
    }

    const overlay = document.getElementById('drawOverlay');
    if(!overlay){
      scheduleRevealClose(card);
      return;
    }
    overlay.hidden = false;
    overlay.dataset.cardValue = String(value);
    overlay.classList.toggle('is-win', wonByUser);

    const stage = document.getElementById('drawStage');
    const shareRow = isAdmin
      ? ('<div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin-top:2px;">' +
          '<button class="btn btn-gold btn-sm" id="shareWaDrawBtn" type="button">Enviar al grupo de WhatsApp</button>' +
          '<button class="btn btn-outline btn-sm" id="copyWinnerMsgBtn" type="button">Copiar mensaje</button>' +
        '</div>')
      : '';
    if(stage){
      stage.innerHTML =
        '<div class="reveal-card' + (wonByUser ? ' won' : '') + '" id="revealCard">' +
          (wonByUser ? '<div class="reveal-congrats">¡Ganaste!</div>' : '<div class="reveal-congrats">Tenemos ganador</div>') +
          '<div class="reveal-kicker">Tablero de juego ' + fmt(value) + '</div>' +
          '<div class="reveal-num">' + card.pendingWinner + '</div>' +
          '<div class="reveal-winner">' + winnerName + '</div>' +
          '<div class="reveal-city">' + winnerCity + '</div>' +
          '<div class="reveal-prize">' + fmt(prize) + '</div>' +
          '<p class="draw-msg reveal-meta">Premio: 50% de lo recaudado · ' + paidCount + ' números pagos<br>' + when + '</p>' +
          (wonByUser
            ? '<p class="draw-msg" style="margin-top:10px;">El administrador te envía el premio a tu Nequi.</p>'
            : '<p class="draw-msg" style="margin-top:10px;">El tablero se abre de nuevo con los números disponibles.</p>') +
        '</div>' +
        shareRow;
    }

    try{ spawnConfetti(overlay, 180); }catch(e){ console.error(e); }
    if(isAdmin){ copyText(lastWinnerMsg).catch(()=>{}); }
    scheduleRevealClose(card);
  }

  function scheduleRevealClose(card){
    clearTimeout(revealCloseTimer);
    const wait = Math.max(0, (card.revealEndsAt || (Date.now() + REVEAL_HOLD_MS)) - Date.now());
    revealCloseTimer = setTimeout(()=>closeDrawAndReset(card), wait);
  }

  function closeDrawAndReset(card){
    const overlay = document.getElementById('drawOverlay');
    if(overlay && overlay.dataset.cardValue === String(card.value)){
      overlay.hidden = true;
      overlay.classList.remove('is-win');
      delete overlay.dataset.cardValue;
      const layer = overlay.querySelector('.confetti-layer');
      if(layer) layer.innerHTML = '';
    }
    drawRunning[card.value] = false;

    if(card.status === 'open' && card.sold === 0) return;

    const fresh = freshCard(card.value);
    fresh.history = card.history;
    fresh.lastDrawDate = card.lastDrawDate;
    cardsCache[card.value] = fresh;
    selectedNumbers.clear();
    saveCard(card.value);
    toast('El tablero de ' + fmt(card.value) + ' se habilitó de nuevo');
    startNextQueuedBoard();
  }

  // Botón de emergencia: deja el cartón abierto como el primer día
  // (números vacíos, nada seleccionado), por si alguna prueba lo deja
  // en un estado raro. No borra el historial de sorteos anteriores.
  function forceResetCard(value){
    document.getElementById('drawOverlay').hidden = true;
    document.getElementById('drawOverlay').classList.remove('is-win');
    delete document.getElementById('drawOverlay').dataset.cardValue;
    drawRunning[value] = false;
    const old = cardsCache[value];
    const fresh = freshCard(value);
    fresh.history = old ? old.history : [];
    cardsCache[value] = fresh;
    selectedNumbers.clear();
    saveCard(value);
    toast('Tablero de ' + fmt(value) + ' reiniciado');
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
    const colors = ['#0a0a0a','#111111','#1a1a1a','#e8c877','#c9a24b','#f4e4b0','#8a713a','#e8c877'];
    const n = count || 180;
    for(let i=0;i<n;i++){
      const p = document.createElement('div');
      const round = Math.random() > 0.5;
      const burst = Math.random() < 0.35;
      p.className = 'confetti-piece' + (round ? ' round' : '') + (burst ? ' burst' : '');
      p.style.background = colors[Math.floor(Math.random()*colors.length)];
      p.style.width = (round ? 6 + Math.random()*8 : 5 + Math.random()*6) + 'px';
      p.style.height = (round ? 6 + Math.random()*8 : 10 + Math.random()*16) + 'px';
      const angle = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 220;
      p.style.setProperty('--ex', Math.cos(angle) * dist + 'px');
      p.style.setProperty('--ey', Math.sin(angle) * dist * 0.55 + 'px');
      p.style.setProperty('--fall', (70 + Math.random()*40) + 'vh');
      p.style.animationDuration = (2.8 + Math.random()*1.6) + 's';
      p.style.animationDelay = (Math.random()*0.18) + 's';
      layer.appendChild(p);
    }
    setTimeout(()=>{ if(layer) layer.innerHTML = ''; }, 4800);
  }

  // ---------- 11. BILLETERA: recargar / retirar ----------
  function renderWalletChip(){
    const el = document.getElementById('walletBalance');
    if(el) el.textContent = fmt(wallet.balance);
  }

  function renderWalletView(){
    const bal = document.getElementById('wvBalance');
    const list = document.getElementById('activityList');
    if(!bal || !list) return;
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
        '<summary>Tablero ' + fmt(v) + '<span class="hist-count">' + countLbl + '</span></summary>' +
        '<div class="activity-list">' + rows + '</div>' +
      '</details>';
    }).join('');
  }

  function doDeposit(amount){
    if(!amount || amount <= 0) return;
    wallet.balance += amount;
    addActivity('recarga', 'Recarga de saldo (Nequi)', amount);
    saveWallet();
    closeModal();
    toast('Se agregaron ' + fmt(amount) + ' a tu billetera. Envía el comprobante Nequi a un administrador.');
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
    toastTimer = setTimeout(()=>{ el.hidden = true; }, 5200);
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
      let t = e.target;
      if(t && t.nodeType !== 1) t = t.parentElement;
      if(!t) return;

      // Seguridad extra: si un aviso anterior quedó pegado en pantalla
      // por más tiempo del que debería, lo escondemos apenas detectamos
      // CUALQUIER clic nuevo en la página (aunque ya no bloquee clics
      // gracias a pointer-events:none de arriba, así no queda un
      // mensaje viejo estorbando visualmente).
      const stuckToast = document.getElementById('toast');
      if(stuckToast && !stuckToast.hidden){ stuckToast.hidden = true; }

      const playSite = t.closest('a[target="dorado-player"]');
      if(playSite){
        e.preventDefault();
        window.open('/', 'dorado-player');
        return;
      }
      const navBtn = t.closest('[data-nav]');
      if(navBtn && (navBtn.tagName === 'BUTTON' || navBtn.getAttribute('role') === 'button')){
        showView(navBtn.dataset.nav);
        return;
      }
      if(t.closest('#logoutBtn')){ signOutSession(); return; }
      if(t.closest('#adminReload')){
        reloadBoardsFromDb();
        return;
      }
      if(t.closest('#adminWarnDraw') || t.closest('#drawAlertGroup')){
        sendTextToGroup(GROUP_ALERT_TEXT);
        showDrawAlertBanner(GROUP_ALERT_SCREEN);
        return;
      }
      if(t.closest('#drawAlertOk')){
        hideDrawAlertBanner();
        return;
      }
      if(t.closest('#walletChip')){ showView('wallet'); return; }
      if(t.closest('#backBtn')){ showView('lobby'); return; }
      if(t.closest('#howBtn2') || t.closest('#demoInfoBtn')){ openModal('modalHow'); return; }
      if(t.closest('#howClose')){ closeModal(); return; }

      const openBtn = t.closest('[data-open]');
      if(openBtn){ openCard(parseInt(openBtn.dataset.open, 10)); return; }

      const holdBtn = t.closest('[data-confirm-hold]');
      if(holdBtn && isAdmin){
        confirmHold(parseInt(holdBtn.dataset.confirmHold, 10), holdBtn.dataset.confirmNum);
        return;
      }

      const numCell = t.closest('.num-cell[data-num]');
      if(numCell && numCell.classList.contains('held') && isAdmin){
        confirmHold(openCardValue, numCell.dataset.num);
        return;
      }
      if(numCell && numCell.classList.contains('available')){ toggleNumber(numCell.dataset.num); return; }

      if(t.closest('#clearSelBtn')){ selectedNumbers.clear(); renderCardDetail(openCardValue); return; }
      if(t.closest('#payBtn')){ openPaymentModal(); return; }
      if(t.closest('#payCancel')){ closeModal(); return; }
      if(t.closest('#payNequi')){ confirmPurchase('nequi'); return; }
      if(t.closest('[data-copy-nequi]') || t.closest('#copyNequiBtn') || t.closest('#copyNequiBtn2')){
        copyNequiNumber();
        return;
      }
      if(t.closest('#nequiPayDone')){ closeModal(); return; }
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

      if(t.closest('#shareWaDrawBtn')){
        sendDrawToGroup();
        return;
      }

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
    PROFILE.phone = session.phone || '';
    PROFILE.fullName = session.fullName || session.username || '';
    currentUid = session.uid;
    isAdmin = !!session.isAdmin && isAdminEntry();
    document.body.classList.toggle('is-admin', isAdmin);
    seedLocalIfEmpty();
    renderAll();
    initDb();
    if(isAdmin){
      const dateEl = document.getElementById('adminDate');
      if(dateEl && !dateEl.value){
        const now = new Date();
        dateEl.value = now.getFullYear() + '-' + pad2(now.getMonth()+1) + '-' + pad2(now.getDate());
      }
      bindAdminFilters(() => cardsCache);
    }
    setInterval(()=>{
      CARD_VALUES.forEach((value)=>{
        const card = cardsCache[value];
        if(!card) return;
        if(expireHolds(card)) saveCard(value);
        if(card.status === 'drawing' && card.spinEndsAt && Date.now() >= card.spinEndsAt + 2000){
          finishDraw(card);
        }
        if(card.status === 'revealed' && card.revealEndsAt && Date.now() >= card.revealEndsAt){
          closeDrawAndReset(card);
        }
      });
      maybeScheduledDraws();
    }, 10000);
    maybeScheduledDraws();
  });
