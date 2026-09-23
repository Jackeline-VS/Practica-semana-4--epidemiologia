/* PASO 2: la IIFE aísla el scope; nada de lo que declaramos aquí queda en window. */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);

  // Registro de listeners: permite contarlos y quitarlos todos (Paso 5).
  let listeners = 0;
  const offs = [];
  const bind = (el, ev, fn) => {
    el.addEventListener(ev, fn);
    listeners++;
    offs.push(() => { el.removeEventListener(ev, fn); listeners--; });
  };

  /* CLOSURE: valor, frames, clicks y ultima son variables privadas de crearEstado().
     Cuando crearEstado() termina, siguen vivas porque frame(), registrar(), cero() y leer()
     las referencian. Por eso el estado se conserva entre frames sin usar globales. */
  const crearEstado = () => {
    let frames = 0, clicks = 0, valor = 0, ultima = '—';
    return {
      frame: () => { frames++; },
      registrar: () => { valor++; clicks++; ultima = `Caso introducido #${valor}`; },
      cero: () => { valor = 0; clicks++; ultima = 'Contador reiniciado'; },
      limpiar: () => { valor = 0; },
      leer: () => ({ frames, clicks, valor, ultima }),
    };
  };
  const estado = crearEstado();

  const cv = $('#sim'), ctx = cv.getContext('2d');
  const cur = $('#curva'), cctx = cur.getContext('2d');
  const fpsCv = $('#fpsHist'), fctx = fpsCv.getContext('2d');
  const COL = { S: '#2f7fb5', I: '#d64a3a', R: '#7a9a45' };
  const MAX = 240; // muestras de la curva (cada 0.25 s simulados)
  const cfg = { n: 120, radio: 16, vel: 60, recup: 6, tasa: 1.5 };

  let gente = [], serie = [], tSim = 0, tMuestra = 0;
  let rafId = null, ultimo = 0, corriendo = false;
  let acc = 0, cuadros = 0, fps = 0;
  const histFps = [];

  // ---------- Modelo ----------
  const crear = () => {
    gente = Array.from({ length: cfg.n }, (_, i) => {
      const a = Math.random() * Math.PI * 2;
      return {
        x: 8 + Math.random() * (cv.width - 16), y: 8 + Math.random() * (cv.height - 16),
        vx: Math.cos(a), vy: Math.sin(a), e: i === 0 ? 'I' : 'S', t: 0,
      };
    });
    serie = []; tSim = 0; tMuestra = 0;
  };

  const contar = () => {
    const c = { S: 0, I: 0, R: 0 };
    for (const p of gente) c[p.e]++;
    return c;
  };

  const avanzar = (dt) => {
    for (const p of gente) {
      p.x += p.vx * cfg.vel * dt;
      p.y += p.vy * cfg.vel * dt;
      if (p.x < 4 || p.x > cv.width - 4) { p.vx *= -1; p.x = Math.min(Math.max(p.x, 4), cv.width - 4); }
      if (p.y < 4 || p.y > cv.height - 4) { p.vy *= -1; p.y = Math.min(Math.max(p.y, 4), cv.height - 4); }
      if (p.e === 'I' && (p.t += dt) > cfg.recup) p.e = 'R';
    }
    const r2 = cfg.radio ** 2;
    for (const a of gente) {
      if (a.e !== 'I') continue;
      for (const b of gente) {
        if (b.e !== 'S') continue;
        const dx = a.x - b.x, dy = a.y - b.y;
        if (dx * dx + dy * dy < r2 && Math.random() < cfg.tasa * dt) b.e = 'I';
      }
    }
  };

  // ---------- Dibujo (Canvas 2D) ----------
  const dibujar = () => {
    ctx.fillStyle = '#f4f8fa';
    ctx.fillRect(0, 0, cv.width, cv.height);
    for (const p of gente) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = COL[p.e];
      ctx.fill();
      if (p.e === 'I') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, cfg.radio, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(214,74,58,.25)';
        ctx.stroke();
      }
    }
  };

  const dibujarCurva = () => {
    cctx.fillStyle = '#f4f8fa';
    cctx.fillRect(0, 0, cur.width, cur.height);
    for (const k of ['S', 'I', 'R']) {
      cctx.beginPath();
      serie.forEach((c, i) => {
        const x = (i / (MAX - 1)) * cur.width;
        const y = cur.height - (c[k] / cfg.n) * (cur.height - 8) - 4;
        if (i) cctx.lineTo(x, y); else cctx.moveTo(x, y);
      });
      cctx.strokeStyle = COL[k];
      cctx.lineWidth = 2;
      cctx.stroke();
    }
  };

  // ---------- DOM ----------
  const log = (m) => {
    const ul = $('#log');
    const li = document.createElement('li');
    li.textContent = `${new Date().toLocaleTimeString()} ${m}`;
    ul.prepend(li);
    while (ul.children.length > 6) ul.lastElementChild.remove(); // evita que la lista crezca sin límite
  };

  const pintarConteo = () => {
    const c = contar(), e = estado.leer();
    $('#cS').textContent = c.S; $('#cI').textContent = c.I; $('#cR').textContent = c.R;
    $('#mContador').textContent = e.valor; $('#mFrames').textContent = e.frames; $('#mClicks').textContent = e.clicks; $('#mUlt').textContent = e.ultima;
  };

  const pintarMonitor = () => {
    $('#mFps').textContent = fps;
    $('#mHeap').textContent = performance.memory
      ? (performance.memory.usedJSHeapSize / 1048576).toFixed(1) : 'n/d';
    $('#mList').textContent = listeners;
    fctx.clearRect(0, 0, fpsCv.width, fpsCv.height);
    histFps.forEach((v, i) => {
      const h = Math.min(v / 144, 1) * (fpsCv.height - 4);
      fctx.fillStyle = v >= 50 ? '#4a9d6b' : '#d9a03a';
      fctx.fillRect(i * 4, fpsCv.height - h, 3, h);
    });
  };

  const marcar = () => {
    $('#btnPlay').classList.toggle('activo', corriendo);
    $('#btnPause').classList.toggle('activo', !corriendo);
    $('#rafEstado').textContent = rafId === null ? 'detenido' : 'activo';
  };

  // ---------- Bucle con requestAnimationFrame y delta time ----------
  const bucle = (t) => {
    const dt = Math.min((t - ultimo) / 1000, 0.05); // segundos; tope para no "saltar" tras cambiar de pestaña
    ultimo = t;
    avanzar(dt);
    dibujar();
    estado.frame();

    tSim += dt;
    if (tSim - tMuestra >= 0.25) {
      tMuestra = tSim;
      serie.push(contar());
      if (serie.length > MAX) serie.shift();
      dibujarCurva();
      pintarConteo();
      $('#dtTxt').textContent = (dt * 1000).toFixed(1);
      hue = (hue + 12) % 360; dibujarNeon(); // el neón cambia de color mientras corre la simulación
    }

    acc += dt; cuadros++;
    if (acc >= 1) {
      fps = Math.round(cuadros / acc); acc = 0; cuadros = 0;
      histFps.push(fps);
      if (histFps.length > 60) histFps.shift();
      pintarMonitor();
    }
    rafId = requestAnimationFrame(bucle);
  };

  const iniciar = () => {
    if (corriendo) return;
    corriendo = true;
    ultimo = performance.now();
    rafId = requestAnimationFrame(bucle);
    marcar(); log('Animación iniciada');
  };

  const pausar = () => {
    if (!corriendo) return;
    corriendo = false;
    cancelAnimationFrame(rafId);
    rafId = null;
    marcar(); log('cancelAnimationFrame: bucle detenido');
  };

  const reiniciar = () => { crear(); estado.limpiar(); dibujar(); dibujarCurva(); pintarConteo(); };

  // ---------- Nombre en neón (Paso 1) ----------
  const nc = $('#neon'), nctx = nc.getContext('2d');
  let hue = 190;
  const dibujarNeon = () => {
    const txt = ($('#inNombre').value.trim() || 'Nombre del brote').toUpperCase();
    nctx.fillStyle = '#0b1220';
    nctx.fillRect(0, 0, nc.width, nc.height);
    nctx.font = '700 64px Georgia, serif';
    nctx.textAlign = 'center';
    nctx.textBaseline = 'middle';
    const g = nctx.createLinearGradient(0, 0, nc.width, 0);
    g.addColorStop(0, `hsl(${hue},100%,65%)`);
    g.addColorStop(0.5, `hsl(${hue + 70},100%,70%)`);
    g.addColorStop(1, `hsl(${hue + 140},100%,65%)`);
    nctx.fillStyle = g;
    nctx.shadowColor = `hsl(${hue + 70},100%,60%)`;
    for (const b of [24, 12, 4]) { nctx.shadowBlur = b; nctx.fillText(txt, nc.width / 2, nc.height / 2, nc.width - 40); }
    nctx.shadowBlur = 0;
  };

  // ---------- Caja con efectos y correo (Paso 3) ----------
  const caja = $('#caja'), chk = $('#chkMover');
  const rotular = () => {
    caja.textContent = caja.classList.contains('infectada') ? 'Infectada'
      : caja.classList.contains('recuperada') ? 'Recuperada' : 'Susceptible';
  };

  // ---------- Validación (Paso 3) ----------
  const nIn = $('#inN'), rIn = $('#inR'), recIn = $('#inRec'), aplicar = $('#btnAplicar'), msg = $('#msg');
  const validar = (el, min, max) => {
    const v = Number(el.value);
    const ok = el.value.trim() !== '' && Number.isInteger(v) && v >= min && v <= max;
    el.classList.toggle('invalid', !ok);
    return ok;
  };
  const revisar = () => {
    const a = validar(nIn, 10, 300), b = validar(rIn, 5, 40), c = validar(recIn, 2, 20);
    const ok = a && b && c;
    aplicar.disabled = !ok;
    msg.textContent = ok ? 'Valores válidos.' : 'Población entre 10 y 300; radio entre 5 y 40; recuperación entre 2 y 20 s.';
    msg.classList.toggle('error', !ok);
  };

  // ---------- Eventos (arrow functions) ----------
  bind($('#btnPlay'), 'click', iniciar);
  bind($('#btnPause'), 'click', pausar);
  bind($('#btnReset'), 'click', reiniciar);
  bind($('#velocidad'), 'input', (e) => { cfg.vel = Number(e.target.value); $('#velTxt').textContent = e.target.value; });
  bind($('#btnMas'), 'click', () => {
    const s = gente.find((q) => q.e === 'S');
    if (!s) { log('No quedan personas susceptibles'); return; }
    s.e = 'I'; s.t = 0;
    estado.registrar(); dibujar(); pintarConteo();
  });
  bind($('#btnCero'), 'click', () => { estado.cero(); pintarConteo(); });
  bind($('#inNombre'), 'input', dibujarNeon);
  bind(chk, 'change', (e) => caja.classList.toggle('mueve', e.target.checked));
  bind($('#btnContagiar'), 'click', () => {
    caja.classList.remove('recuperada', 'pulso');
    caja.classList.add('infectada');
    void caja.offsetWidth; // fuerza un reflow para poder reiniciar la animación del pulso
    caja.classList.add('pulso');
    rotular();
  });
  bind($('#btnRecuperar'), 'click', () => { caja.classList.remove('infectada'); caja.classList.add('recuperada'); rotular(); });
  bind($('#btnAislar'), 'click', () => caja.classList.toggle('cuarentena'));
  bind(caja, 'animationend', (e) => { if (e.animationName === 'pulso') caja.classList.remove('pulso'); });
  bind($('#btnCajaReset'), 'click', () => { caja.classList.remove('infectada', 'recuperada', 'cuarentena', 'mueve', 'pulso'); chk.checked = false; rotular(); });
  bind(nIn, 'input', revisar);
  bind(rIn, 'input', revisar);
  bind(recIn, 'input', revisar);
  bind(aplicar, 'click', () => {
    cfg.n = Number(nIn.value); cfg.radio = Number(rIn.value); cfg.recup = Number(recIn.value);
    pausar(); reiniciar(); log(`Nueva simulación: ${cfg.n} personas, radio ${cfg.radio}`);
  });
  bind($('#btnContraste'), 'click', (e) => {
    const on = document.body.classList.toggle('contrast');
    e.currentTarget.setAttribute('aria-pressed', String(on));
  });
  // Paso 5: al salir de la página se detiene el bucle y se quitan todos los listeners.
  bind(window, 'pagehide', () => { pausar(); offs.forEach((f) => f()); });

  crear(); dibujar(); dibujarCurva(); pintarConteo(); pintarMonitor(); marcar(); revisar(); dibujarNeon(); rotular();
})();