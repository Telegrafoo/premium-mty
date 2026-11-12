/* Premium MTY: lee data/stations.json y data/history.json (los genera scripts/update_prices.py cada día) */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MON = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const ROAD = 1.3; // la distancia en línea recta se multiplica para aproximar la distancia por calle
  const CENTER = [25.686, -100.316];

  const ICON = {
    pump: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 17V4.5A1.5 1.5 0 0 1 5.5 3h5A1.5 1.5 0 0 1 12 4.5V17M3 17h10M4 8.5h8M12 7l2.5 2v5.5a1.2 1.2 0 0 0 2.4 0V7.5L15 5.5"/></svg>',
    car: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 1.8 17.5 17l-7.5-3.4L2.5 17z"/></svg>',
    waze: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 13.5c-.9-1-1.5-2.5-1.5-4C2 5.4 5.6 2.5 10 2.5s8 2.9 8 7-3.6 7-8 7H7.5"/><circle cx="7.5" cy="8.5" r=".6" fill="currentColor"/><circle cx="12.5" cy="8.5" r=".6" fill="currentColor"/><circle cx="5.5" cy="16.5" r="1.4"/><circle cx="13.5" cy="16.5" r="1.4"/></svg>',
    star: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="m10 2.5 2.3 4.8 5.2.7-3.8 3.6.9 5.2L10 14.3l-4.6 2.5.9-5.2L2.5 8l5.2-.7z"/></svg>',
    starOn: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="m10 2.5 2.3 4.8 5.2.7-3.8 3.6.9 5.2L10 14.3l-4.6 2.5.9-5.2L2.5 8l5.2-.7z"/></svg>',
    locate: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M17.6 2.4 2.8 8.7c-.6.3-.5 1.1.1 1.3l5.6 1.5 1.5 5.6c.2.6 1 .7 1.3.1z"/></svg>',
  };

  /* ---------- Preferencias guardadas en este navegador ---------- */
  const PKEY = 'premium-mty:prefs';
  const prefs = Object.assign({ kmpl: 12, liters: 40, favs: [], seen: {}, alertBelow: null }, read());
  function read() { try { return JSON.parse(localStorage.getItem(PKEY)) || {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(PKEY, JSON.stringify(prefs)); } catch (e) { /* sin almacenamiento */ } }

  const state = { data: null, hist: null, tab: 'hoy', back: 'hoy', sel: null, zone: 'Todas', withFlagged: false, me: null, radius: 5, query: '', fit: true };

  /* ---------- Formato ---------- */
  const money = (v) => '$' + Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const day = (iso, withDay) => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d); return (withDay ? DAYS[dt.getDay()] + ' ' : '') + d + ' ' + MON[m - 1]; };
  const km = (v) => (v < 1 ? Math.round(v * 1000) + ' m' : v.toFixed(1).replace('.0', '') + ' km');
  const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);
  const titleCase = (s) => s.toLowerCase().replace(/(^|\s|\.)(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(Sa|De|Cv|Sapi|Srl|Rl)\b/g, (w) => ({ Sa: 'SA', De: 'de', Cv: 'CV', Sapi: 'SAPI', Srl: 'SRL', Rl: 'RL' }[w]));

  function dist(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* ---------- Datos derivados ---------- */
  let byId = {}, verified = [], p10 = 0, firstDay = '';
  function prepare() {
    const st = state.data.stations;
    byId = {};
    st.forEach((s) => { s.title = titleCase(s.name); byId[s.id] = s; });
    verified = st.filter((s) => !s.flags.length).sort((a, b) => a.price - b.price);
    p10 = verified.length ? verified[Math.floor(verified.length * 0.1)].price : 0;
    firstDay = state.hist && state.hist.days.length ? state.hist.days[0].date : state.data.date;
  }
  function tier(s) {
    if (s.flags.length) return 'warn';
    if (s.price <= p10) return 'cheap';
    if (s.price >= state.data.stats.max) return 'top';
    return 'mid';
  }
  const TIER_LABEL = { cheap: 'De las más baratas', mid: 'Precio medio', top: 'Precio tope', warn: 'Por verificar' };
  const TIER_TAG = { cheap: 'green', mid: 'orange', top: '', warn: 'orange' };
  const FLAG_TEXT = {
    bajo: 'Reporta un precio $4 o más por debajo del resto de la ciudad. Puede ser una promoción real o un error de captura.',
    'bajo-nuevo': 'Reporta un precio nuevo bastante más bajo que el resto. Lo confirmamos si se mantiene 3 días seguidos.',
    'menor-que-regular': 'Reporta la Premium igual o más barata que su Magna, lo cual casi nunca ocurre.',
    duplicado: 'La fuente trae dos precios distintos para esta estación.',
  };
  const median = () => state.data.stats.median;
  const pool = () => (state.withFlagged ? state.data.stations.slice().sort((a, b) => a.price - b.price) : verified);
  const inZone = (list) => (state.zone === 'Todas' ? list : list.filter((s) => s.zone === state.zone));
  const zones = () => ['Todas'].concat(Array.from(new Set(state.data.stations.map((s) => s.zone))).sort((a, b) => a.localeCompare(b, 'es')));
  const tripCost = (s) => (state.me ? ((dist(state.me, s) * ROAD * 2) / prefs.kmpl) * s.price : 0);
  const gmaps = (s) => 'https://www.google.com/maps/dir/?api=1&destination=' + s.lat + ',' + s.lon;
  const waze = (s) => 'https://waze.com/ul?ll=' + s.lat + ',' + s.lon + '&navigate=yes';

  /* ---------- Mapa ---------- */
  const mapEl = $('#map');
  const panel = $('#panel');
  const isMobile = () => window.matchMedia('(max-width: 720px)').matches;
  let map = null, pins = null, extras = null;

  function initMap() {
    if (!window.L) { toast('No se pudo cargar el mapa. Revisa tu conexión.'); return; }
    map = L.map(mapEl, { zoomControl: false, attributionControl: true }).setView(CENTER, 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    map.attributionControl.setPrefix(false);
    pins = L.layerGroup().addTo(map);
    extras = L.layerGroup().addTo(map);
    const far = () => {
      mapEl.classList.toggle('far', map.getZoom() < 14);
      mapEl.classList.toggle('vfar', map.getZoom() < 12);
    };
    map.on('zoomend', far);
    far();
    map.on('click', (e) => {
      if (state.tab !== 'cerca') return;
      state.me = { lat: e.latlng.lat, lon: e.latlng.lng };
      state.fit = true;
      render();
    });
    $('#zoom-in').onclick = () => map.zoomIn();
    $('#zoom-out').onclick = () => map.zoomOut();
  }

  // Margen para que lo encuadrado no quede debajo del panel
  function pad() {
    if (isMobile()) return { paddingTopLeft: [24, 70], paddingBottomRight: [24, panel.offsetHeight + 24] };
    return { paddingTopLeft: [panel.offsetWidth + 40, 40], paddingBottomRight: [76, 40] };
  }
  function fitTo(points, maxZoom) {
    if (!map || !points.length) return;
    const b = L.latLngBounds(points);
    map.fitBounds(b, Object.assign({ maxZoom: maxZoom || 15 }, pad()));
  }

  function drawPins(list, keep, best) {
    pins.clearLayers();
    const keepSet = new Set(keep || []);
    list.forEach((s) => {
      const t = tier(s);
      const cls = ['pin', s.id === best ? 'best' : t];
      if (keepSet.has(s.id)) cls.push('keep');
      if (s.id === state.sel) cls.push('sel', 'keep');
      if (prefs.favs.includes(s.id)) cls.push('fav');
      const m = L.marker([s.lat, s.lon], {
        icon: L.divIcon({ className: '', html: '<span class="' + cls.join(' ') + '">' + s.price.toFixed(2) + '</span>', iconSize: [0, 0] }),
        title: s.title + ' · ' + money(s.price),
        riseOnHover: true,
        zIndexOffset: s.id === state.sel ? 2000 : s.id === best ? 1500 : keepSet.has(s.id) ? 1000 : t === 'cheap' ? 500 : 0,
      });
      m.on('click', () => openStation(s));
      pins.addLayer(m);
    });
  }
  function meMarker() {
    if (state.me) extras.addLayer(L.marker([state.me.lat, state.me.lon], { icon: L.divIcon({ className: '', html: '<span class="me-dot"></span>', iconSize: [0, 0] }), interactive: false, zIndexOffset: 3000 }));
  }

  function updateMap() {
    if (!map) return;
    extras.clearLayers();
    meMarker();
    const best = verified[0] && verified[0].id;
    const all = state.withFlagged ? state.data.stations : verified;
    if (state.tab === 'hoy') {
      const top = inZone(verified).slice(0, 10);
      drawPins(all, top.map((s) => s.id), inZone(verified)[0] && inZone(verified)[0].id);
      if (state.fit) fitTo(top.map((s) => [s.lat, s.lon]), 14);
    } else if (state.tab === 'cerca') {
      const res = nearby();
      drawPins(state.me ? res : all, res.slice(0, 15).map((s) => s.id), res[0] && res[0].id);
      if (state.me) {
        extras.addLayer(L.circle([state.me.lat, state.me.lon], { radius: state.radius * 1000, color: '#007aff', weight: 1.5, opacity: 0.6, fillColor: '#007aff', fillOpacity: 0.05, interactive: false }));
        if (state.fit) { const b = L.latLng(state.me.lat, state.me.lon).toBounds(state.radius * 2000); fitTo([b.getSouthWest(), b.getNorthEast()], 16); }
      }
    } else if (state.tab === 'buscar') {
      const res = searchResults();
      drawPins(all, res.map((s) => s.id), best);
      if (state.fit && res.length) fitTo(res.map((s) => [s.lat, s.lon]), 15);
    } else if (state.tab === 'detalle') {
      const s = byId[state.sel];
      drawPins(all, [], best);
      if (s && state.fit) map.fitBounds(L.latLng(s.lat, s.lon).toBounds(900), Object.assign({ maxZoom: 16 }, pad()));
    } else {
      drawPins(all, [], best);
      if (state.fit) map.fitBounds(L.latLng(CENTER[0], CENTER[1]).toBounds(30000), pad());
    }
    state.fit = false;
  }

  /* ---------- Piezas de la lista ---------- */
  function row(s, opts) {
    const o = opts || {};
    const t = tier(s);
    return '<button type="button" class="row" data-id="' + s.id + '">' +
      '<span class="glyph ' + t + '">' + (o.rank != null ? o.rank : ICON.pump) + '</span>' +
      '<span style="min-width:0"><span class="t">' + (prefs.favs.includes(s.id) ? '★ ' : '') + esc(s.title) + '</span><span class="s">' + esc(o.sub || s.zone) + '</span></span>' +
      '<span class="v"><b' + (t === 'cheap' ? ' class="green"' : '') + '>' + money(s.price) + '</b>' + (o.small ? '<small>' + o.small + '</small>' : '') + '</span></button>';
  }
  function bindRows(host) {
    $$('.row[data-id]', host).forEach((b) => b.addEventListener('click', () => openStation(byId[b.dataset.id])));
  }
  const section = (title, body, link) => '<section class="section"><div class="section-head"><h2>' + title + '</h2>' + (link || '') + '</div>' + body + '</section>';
  const group = (inner) => '<div class="group">' + inner + '</div>';
  const plainRow = (label, value, cls) => '<div class="row plain"><span class="t" style="font-weight:400">' + label + '</span><span class="val ' + (cls || '') + '">' + value + '</span></div>';

  /* ---------- Vistas del panel ---------- */
  const VIEWS = {};

  VIEWS.hoy = function (host) {
    const list = inZone(verified);
    const best = list[0];
    const s = state.data.stats;
    const share = Math.round((s.atMax / s.verified) * 100);
    const changed = state.data.stations.filter((x) => x.changed === state.data.date && x.last != null).sort((a, b) => (a.price - a.last) - (b.price - b.last));
    const flagged = state.data.stations.filter((x) => x.flags.length).sort((a, b) => a.price - b.price);
    const favs = prefs.favs.map((id) => byId[id]).filter(Boolean);

    host.innerHTML =
      (best
        ? '<div class="hero"><div class="hero-label">Premium más barata hoy · ' + esc(state.zone === 'Todas' ? 'área metropolitana' : state.zone) + '</div>' +
          '<div class="price-xl">' + money(best.price) + '<small>por litro</small></div>' +
          '<div><div class="hero-name">' + esc(best.title) + '</div><div class="sec" style="font-size:14px">' + esc(best.zone) + ' · ' + money(median() - best.price) + ' menos que la mediana</div></div>' +
          '<div class="actions"><a class="action primary" href="' + gmaps(best) + '" target="_blank" rel="noopener">' + ICON.car + 'Cómo llegar</a>' +
          '<a class="action" href="' + waze(best) + '" target="_blank" rel="noopener">' + ICON.waze + 'Waze</a>' +
          '<button class="action" type="button" data-open="' + best.id + '">' + ICON.pump + 'Detalles</button></div></div>'
        : '<div class="hero"><p class="empty">No hay estaciones con precio confirmado en esta zona.</p></div>') +
      section('Resumen', group(
        plainRow('Mediana de la ciudad', money(median())) +
        plainRow('Estaciones a ' + money(s.max), share + '%') +
        plainRow('Ahorro por ' + prefs.liters + ' L vs. la mediana', best ? money(Math.max(0, (median() - best.price) * prefs.liters)) : '—', 'green'))) +
      (favs.length ? favSection(favs) : '') +
      section('Las 10 más baratas',
        '<div class="pills" role="group" aria-label="Zona">' + zones().map((z) => '<button type="button" class="pill-btn" data-zone="' + esc(z) + '" aria-pressed="' + (z === state.zone) + '">' + esc(z) + '</button>').join('') + '</div>' +
        group(list.slice(0, 10).map((x, i) => row(x, { rank: i + 1, small: i === 0 ? 'la más barata' : '+' + money(x.price - best.price) })).join('') || '<p class="empty">Sin estaciones en esta zona.</p>')) +
      section('Cambios desde ayer', changed.length
        ? group(changed.slice(0, 8).map((x) => { const d = x.price - x.last; return row(x, { small: (d < 0 ? '▼ ' : '▲ ') + money(Math.abs(d)) }); }).join(''))
        : '<p class="caption">Aún no hay cambios. Empezamos a guardar los precios el ' + day(firstDay) + ' y cada mañana comparamos contra el día anterior.</p>') +
      (flagged.length
        ? section('Por verificar', '<p class="caption">Precios fuera de lo normal. No entran al ranking; si vas, confirma el letrero.</p>' +
            group(flagged.map((x) => row(x, { sub: x.zone + ' · por verificar' })).join('')))
        : '') +
      '<p class="footnote">Precios del ' + day(state.data.date, true) + ' reportados por cada estación al regulador de energía (CNE). Se actualizan cada mañana.</p>';

    $$('[data-zone]', host).forEach((b) => b.addEventListener('click', () => { state.zone = b.dataset.zone; state.fit = true; render(); }));
    $$('[data-open]', host).forEach((b) => b.addEventListener('click', () => openStation(byId[b.dataset.open])));
    bindRows(host);
    favs.forEach((f) => (prefs.seen[f.id] = f.price));
    save();
  };

  function favSection(favs) {
    const hit = prefs.alertBelow ? favs.filter((s) => s.price <= prefs.alertBelow) : [];
    return section('Favoritas',
      (hit.length ? '<div class="note"><b>Alerta:</b> ' + plural(hit.length, 'favorita está', 'favoritas están') + ' en ' + money(prefs.alertBelow) + ' o menos hoy.</div>' : '') +
      group(favs.map((s) => {
        const before = prefs.seen[s.id];
        const small = before != null && before !== s.price ? (s.price < before ? '▼ bajó ' : '▲ subió ') + money(Math.abs(s.price - before)) : '';
        return row(s, { small });
      }).join('')));
  }

  function nearby() {
    if (!state.me) return [];
    return pool().map((s) => Object.assign({}, s, { d: dist(state.me, s) })).filter((s) => s.d <= state.radius)
      .map((s) => Object.assign(s, { total: s.price * prefs.liters + tripCost(s) })).sort((a, b) => a.total - b.total);
  }

  VIEWS.cerca = function (host) {
    const res = nearby();
    const nearest = res.slice().sort((a, b) => a.d - b.d)[0];
    host.innerHTML =
      (state.me ? '' :
        '<div class="hero"><div class="hero-name">Encuentra la más conveniente cerca de ti</div>' +
        '<p class="sec" style="font-size:14px">Usa tu ubicación o toca el mapa para elegir un punto, como tu casa o tu trabajo.</p>' +
        '<button class="btn primary" type="button" id="locate">Usar mi ubicación</button></div>') +
      section('Radio', '<div class="segmented" role="group" aria-label="Radio">' + [2, 5, 10, 20].map((r) => '<button type="button" data-radius="' + r + '" aria-pressed="' + (r === state.radius) + '">' + r + ' km</button>').join('') + '</div>' +
        group('<label class="row plain"><span class="t" style="font-weight:400">Incluir precios por verificar</span><span class="switch"><input type="checkbox" id="flag-toggle"' + (state.withFlagged ? ' checked' : '') + '><span></span></span></label>')) +
      (state.me
        ? section(res.length ? 'Mejores opciones' : 'Nada a ' + state.radius + ' km',
            res.length
              ? group(res.slice(0, 15).map((s, i) => {
                  const vs = nearest && nearest.id !== s.id ? nearest.total - s.total : 0;
                  return row(s, { rank: i + 1, sub: km(s.d) + ' · ' + s.zone, small: vs > 0.5 ? 'ahorras ' + money(vs) : 'total ' + money(s.total) });
                }).join('')) +
                '<p class="footnote">Ordenadas por costo real: ' + prefs.liters + ' L más la gasolina de ir y volver a ' + prefs.kmpl + ' km/L. "Ahorras" compara contra la más cercana (' + esc(nearest.title) + ', ' + km(nearest.d) + '). Distancias aproximadas.</p>'
              : '<p class="caption">Amplía el radio para ver más estaciones.</p>',
            '<button type="button" class="link" id="relocate">Mi ubicación</button>')
        : '');
    $$('[data-radius]', host).forEach((b) => b.addEventListener('click', () => { state.radius = +b.dataset.radius; state.fit = true; render(); }));
    $('#flag-toggle', host).addEventListener('change', (e) => { state.withFlagged = e.target.checked; render(); });
    const loc = $('#locate', host) || $('#relocate', host);
    if (loc) loc.addEventListener('click', locate);
    bindRows(host);
  };

  function searchResults() {
    const q = state.query.trim().toLowerCase();
    if (!q) return [];
    return state.data.stations.filter((s) => s.name.toLowerCase().includes(q) || s.permit.toLowerCase().includes(q) || s.zone.toLowerCase().includes(q)).sort((a, b) => a.price - b.price);
  }
  VIEWS.buscar = function (host) {
    const res = searchResults();
    host.innerHTML = section('Resultados', res.length
      ? group(res.slice(0, 40).map((s) => row(s, { sub: s.zone + (s.flags.length ? ' · por verificar' : ''), small: TIER_LABEL[tier(s)].toLowerCase() })).join('')) + (res.length > 40 ? '<p class="footnote">Mostrando 40 de ' + res.length + '.</p>' : '')
      : '<p class="caption">Sin resultados para "' + esc(state.query) + '". Busca por razón social, permiso o zona.</p>',
      '<span class="sec" style="font-size:13px">' + res.length + '</span>');
    bindRows(host);
  };

  VIEWS.tendencia = function (host) {
    const days = (state.hist && state.hist.days) || [];
    const prices = verified.map((s) => s.price);
    const lo = Math.floor(Math.min(...prices) * 4) / 4, hi = Math.ceil(Math.max(...prices) * 4) / 4;
    const bins = [];
    for (let v = lo; v < hi + 0.001; v += 0.25) bins.push({ from: v, n: 0 });
    prices.forEach((p) => { bins[Math.min(bins.length - 1, Math.floor((p - lo) / 0.25))].n++; });
    const zrows = zones().slice(1).map((z) => {
      const l = verified.filter((s) => s.zone === z).map((s) => s.price).sort((a, b) => a - b);
      return l.length ? { z, n: l.length, min: l[0], med: l[Math.floor(l.length / 2)] } : null;
    }).filter(Boolean).sort((a, b) => a.min - b.min || a.med - b.med);

    host.innerHTML =
      section('Día a día', '<div class="chart-box">' + trendChart(days) +
        '<div class="legend"><span><i style="background:var(--green-dot)"></i>Mínimo</span><span><i style="background:var(--gray-dot)"></i>Mediana</span></div></div>' +
        (days.length < 3 ? '<p class="caption">La historia empieza el ' + day(firstDay) + ' y suma un punto cada mañana. En unas semanas verás si la Premium va subiendo o bajando.</p>' : '')) +
      section('Precios de hoy', '<div class="chart-box">' + histogram(bins) + '</div><p class="caption">' + Math.round((state.data.stats.atMax / state.data.stats.verified) * 100) + '% de las estaciones cobra ' + money(state.data.stats.max) + '.</p>') +
      section('Por zona', group(zrows.map((r) => '<div class="row plain"><span style="min-width:0"><span class="t">' + esc(r.z) + '</span><span class="s">' + plural(r.n, 'estación', 'estaciones') + ' · mediana ' + money(r.med) + '</span></span><span class="v"><b class="green">' + money(r.min) + '</b><small>mínimo</small></span></div>').join('')) +
        '<p class="footnote">La zona es aproximada: la fuente no trae municipio.</p>');
  };

  function trendChart(days) {
    const W = 340, H = 150, L0 = 38, R0 = 8, T0 = 12, B0 = 22;
    if (!days.length) return '<p class="empty">Sin datos todavía.</p>';
    const vals = days.flatMap((d) => [d.min, d.median]);
    const lo = Math.floor(Math.min(...vals) - 0.5), hi = Math.ceil(Math.max(...vals) + 0.5);
    const x = (i) => (days.length === 1 ? (L0 + W - R0) / 2 : L0 + (i / (days.length - 1)) * (W - L0 - R0));
    const y = (v) => T0 + (1 - (v - lo) / (hi - lo)) * (H - T0 - B0);
    let g = '';
    for (let v = lo; v <= hi; v++) g += '<line class="grid" x1="' + L0 + '" x2="' + (W - R0) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text x="' + (L0 - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">$' + v + '</text>';
    const line = (k, color) => {
      const last = days[days.length - 1][k];
      return (days.length > 1 ? '<polyline fill="none" stroke-width="2" stroke-linejoin="round" stroke="' + color + '" points="' + days.map((d, i) => x(i) + ',' + y(d[k])).join(' ') + '"/>' : '') +
        '<circle cx="' + x(days.length - 1) + '" cy="' + y(last) + '" r="4" fill="' + color + '"/>' +
        '<text x="' + (x(days.length - 1) - 8) + '" y="' + (y(last) - 8) + '" text-anchor="end" style="fill:var(--label);font-weight:600">' + money(last) + '</text>';
    };
    const step = Math.max(1, Math.ceil(days.length / 5));
    days.forEach((d, i) => { if (i % step === 0 || i === days.length - 1) g += '<text x="' + x(i) + '" y="' + (H - 5) + '" text-anchor="middle">' + day(d.date) + '</text>'; });
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Precio mínimo y mediana de la Premium por día">' + g + line('median', '#8e8e93') + line('min', '#34c759') + '</svg>';
  }

  function histogram(bins) {
    const W = 340, H = 140, B0 = 22, T0 = 14;
    const max = Math.max(...bins.map((b) => b.n)) || 1;
    const bw = W / bins.length;
    let g = '';
    bins.forEach((b, i) => {
      const h = (b.n / max) * (H - B0 - T0);
      const color = b.from >= state.data.stats.max - 0.249 ? '#8e8e93' : b.from <= p10 ? '#34c759' : '#ff9500';
      g += '<rect x="' + (i * bw + 1.5) + '" y="' + (H - B0 - h) + '" width="' + Math.max(2, bw - 3) + '" height="' + Math.max(b.n ? 2 : 0, h) + '" rx="2.5" fill="' + color + '"><title>' + money(b.from) + '–' + money(b.from + 0.24) + ': ' + plural(b.n, 'estación', 'estaciones') + '</title></rect>';
      if (b.n === max) g += '<text x="' + (i * bw + bw / 2) + '" y="' + (H - B0 - h - 4) + '" text-anchor="middle">' + b.n + '</text>';
      if (i % Math.max(1, Math.ceil(bins.length / 4)) === 0 || i === bins.length - 1) g += '<text x="' + (i * bw + bw / 2) + '" y="' + (H - 5) + '" text-anchor="middle">$' + b.from.toFixed(2) + '</text>';
    });
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Número de estaciones por rango de precio">' + g + '</svg>';
  }

  VIEWS.ajustes = function (host) {
    const input = (id, value, attrs) => '<input class="field-input" id="' + id + '" type="number" inputmode="decimal" value="' + (value == null ? '' : value) + '" ' + attrs + '>';
    host.innerHTML =
      '<div class="card-head"><h2>Ajustes</h2><button class="close-btn" type="button" id="close" aria-label="Cerrar">✕</button></div>' +
      section('Tu coche', group(
        '<label class="row plain"><span class="t" style="font-weight:400">Rendimiento (km/L)</span>' + input('kmpl', prefs.kmpl, 'min="3" max="40" step="0.5"') + '</label>' +
        '<label class="row plain"><span class="t" style="font-weight:400">Litros por carga</span>' + input('liters', prefs.liters, 'min="5" max="120" step="1"') + '</label>') +
        '<p class="caption">Se usan para el costo real en "Cerca de mí" y el ahorro por carga.</p>') +
      section('Alerta de precio', group(
        '<label class="row plain"><span class="t" style="font-weight:400">Avisar cuando una favorita esté en</span>' + input('alert', prefs.alertBelow, 'min="15" max="40" step="0.01" placeholder="28.50"') + '</label>') +
        '<p class="caption">El aviso aparece en "Más baratas" al abrir la app. Marca favoritas con la estrella en la ficha de cada estación.</p>') +
      section('Sobre los datos', '<div class="prose">' +
        '<p><b>Fuente.</b> Los precios que cada gasolinera reporta al regulador de energía (antes CRE, hoy Comisión Nacional de Energía), publicados en <a href="' + esc(state.data.source) + 'prices" target="_blank" rel="noopener">su servicio de consulta</a>. Se descargan una vez al día.</p>' +
        '<p><b>Última actualización:</b> ' + esc(new Date(state.data.updated).toLocaleString('es-MX', { dateStyle: 'full', timeStyle: 'short' })) + '.</p>' +
        '<p><b>Lo que no sabemos.</b> La fuente no dice cuándo reportó cada estación su precio. Por eso mostramos "precio sin cambio desde", contado desde el primer día en que lo vimos. Si el letrero dice otra cosa, confía en el letrero.</p>' +
        '<p><b>Filtros.</b> Descartamos precios menores a $20 o mayores a $40. Quedan "por verificar" los que están $4 o más debajo de la mediana, los menores a su propia Magna y los duplicados. Un precio entre $2.50 y $4 debajo de la mediana se confirma cuando se mantiene 3 días.</p>' +
        '<p><b>Privacidad.</b> Tu ubicación, favoritas y ajustes se quedan en este navegador.</p></div>');
    const num = (id, key, min) => $('#' + id, host).addEventListener('change', (e) => { const v = parseFloat(e.target.value); if (v >= min) { prefs[key] = v; save(); toast('Guardado'); } else e.target.value = prefs[key]; });
    num('kmpl', 'kmpl', 3);
    num('liters', 'liters', 5);
    $('#alert', host).addEventListener('change', (e) => { const v = parseFloat(e.target.value); prefs.alertBelow = v > 0 ? v : null; save(); toast(prefs.alertBelow ? 'Alerta en ' + money(prefs.alertBelow) : 'Alerta quitada'); });
    $('#close', host).addEventListener('click', () => go(state.back));
  };

  /* ---------- Ficha de estación ---------- */
  VIEWS.detalle = function (host) {
    const s = byId[state.sel];
    if (!s) { go('hoy'); return; }
    const t = tier(s);
    const fav = prefs.favs.includes(s.id);
    const log = (state.hist && state.hist.changes[s.id]) || [];
    const d = state.me ? dist(state.me, s) : null;
    const sinceTxt = s.since === firstDay ? 'Desde el ' + day(firstDay) + ' (inicio del registro)' : 'Desde el ' + day(s.since, true);
    const vsMed = s.price < median() ? money(median() - s.price) + ' menos' : s.price > median() ? money(s.price - median()) + ' más' : 'Igual';
    host.innerHTML =
      '<div class="card-head"><div style="min-width:0"><h2>' + esc(s.title) + '</h2><div class="s">Gasolinera · ' + esc(s.zone) + (d != null ? ' · ' + km(d) : '') + '</div></div>' +
      '<button class="close-btn" type="button" id="close" aria-label="Cerrar">✕</button></div>' +
      '<div class="actions"><a class="action primary" href="' + gmaps(s) + '" target="_blank" rel="noopener">' + ICON.car + 'Cómo llegar</a>' +
      '<a class="action" href="' + waze(s) + '" target="_blank" rel="noopener">' + ICON.waze + 'Waze</a>' +
      '<button class="action" type="button" id="fav">' + (fav ? ICON.starOn + 'Favorita' : ICON.star + 'Favorita') + '</button></div>' +
      '<div class="hero"><div class="hero-label">Gasolina Premium</div><div class="price-xl">' + money(s.price) + '<small>por litro</small></div>' +
      '<div><span class="tag ' + TIER_TAG[t] + '">' + TIER_LABEL[t] + '</span></div></div>' +
      s.flags.map((f) => '<div class="note"><b>Por verificar.</b> ' + FLAG_TEXT[f] + '</div>').join('') +
      section('Detalles', group(
        plainRow('Precio sin cambio', sinceTxt) +
        (s.last != null ? plainRow('Precio anterior', money(s.last) + ' · ' + day(s.changed)) : '') +
        plainRow('Contra la mediana', vsMed + ' por litro', s.price < median() ? 'green' : '') +
        plainRow('Permiso', esc(s.permit)))) +
      (log.length > 1 ? section('Historial', '<div class="chart-box">' + spark(log) + '</div>') : '') +
      section('Calcular carga', group(
        '<label class="row plain"><span class="t" style="font-weight:400">Litros</span><input class="field-input" id="sheet-l" type="number" inputmode="decimal" min="1" max="200" value="' + prefs.liters + '"></label>' +
        plainRow('Pagarías', '<b id="sheet-total" style="color:var(--label)">' + money(s.price * prefs.liters) + '</b>')));
    $('#close', host).addEventListener('click', () => { state.sel = null; go(state.back); });
    $('#sheet-l', host).addEventListener('input', (e) => { $('#sheet-total', host).textContent = money(s.price * (parseFloat(e.target.value) || 0)); });
    $('#fav', host).addEventListener('click', () => {
      const i = prefs.favs.indexOf(s.id);
      if (i >= 0) prefs.favs.splice(i, 1); else { prefs.favs.push(s.id); prefs.seen[s.id] = s.price; }
      save();
      toast(i >= 0 ? 'Quitada de favoritas' : 'Agregada a favoritas');
      render();
    });
  };

  function spark(log) {
    const W = 340, H = 64, P = 8;
    const v = log.map((x) => x[1]);
    const lo = Math.min(...v) - 0.1, hi = Math.max(...v) + 0.1;
    const pts = log.map((x, i) => (P + (i / (log.length - 1)) * (W - 2 * P)) + ',' + (P + (1 - (x[1] - lo) / (hi - lo)) * (H - 2 * P - 12)));
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Historial de precio"><polyline fill="none" stroke-width="2" stroke="#007aff" points="' + pts.join(' ') + '"/>' +
      '<text x="' + P + '" y="' + (H - 1) + '">' + day(log[0][0]) + '</text><text x="' + (W - P) + '" y="' + (H - 1) + '" text-anchor="end">' + money(v[v.length - 1]) + '</text></svg>';
  }

  function openStation(s) {
    if (!s) return;
    if (state.tab !== 'detalle') state.back = state.tab === 'ajustes' ? 'hoy' : state.tab;
    state.sel = s.id;
    state.tab = 'detalle';
    state.fit = true;
    if (isMobile() && panel.dataset.detent === 'full') setDetent('half');
    if (isMobile() && panel.dataset.detent === 'peek') setDetent('half');
    render();
  }

  /* ---------- Navegación ---------- */
  function render() {
    const body = $('#panel-body');
    VIEWS[state.tab](body);
    body.scrollTop = 0;
    const active = ['hoy', 'cerca', 'tendencia'].includes(state.tab) ? state.tab : ['hoy', 'cerca', 'tendencia'].includes(state.back) ? state.back : null;
    $$('#tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === active)));
    updateMap();
  }
  function go(tab) {
    if (!VIEWS[tab] || tab === 'detalle' || tab === 'buscar') tab = 'hoy';
    state.tab = tab;
    if (['hoy', 'cerca', 'tendencia'].includes(tab)) state.back = tab;
    state.sel = null;
    state.fit = true;
    if (location.hash.slice(1) !== tab) history.replaceState(null, '', '#' + tab);
    render();
  }
  $$('#tabs [data-tab]').forEach((b) => b.addEventListener('click', () => { $('#q').value = ''; state.query = ''; go(b.dataset.tab); }));
  $('#settings-btn').addEventListener('click', () => { if (state.tab !== 'ajustes') { state.tab = 'ajustes'; render(); } });
  let qT;
  $('#q').addEventListener('input', (e) => {
    state.query = e.target.value;
    clearTimeout(qT);
    qT = setTimeout(() => {
      if (state.query.trim()) { state.tab = 'buscar'; state.sel = null; state.fit = true; render(); }
      else go(state.back);
    }, 200);
  });
  $('#q').addEventListener('focus', () => { if (isMobile()) setDetent('full'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.tab === 'detalle') { state.sel = null; go(state.back); } });

  function locate() {
    if (!navigator.geolocation) { toast('Tu navegador no permite ubicación. Toca el mapa para elegir un punto.'); return; }
    toast('Buscando tu ubicación…');
    navigator.geolocation.getCurrentPosition(
      (p) => { state.me = { lat: p.coords.latitude, lon: p.coords.longitude }; go('cerca'); },
      () => { toast('No pudimos obtener tu ubicación. Toca el mapa para elegir un punto.'); if (state.tab !== 'cerca') go('cerca'); },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }
  $('#locate-btn').innerHTML = ICON.locate;
  $('#locate-btn').addEventListener('click', locate);

  /* ---------- Hoja inferior en el celular ---------- */
  function heights() {
    const vh = window.innerHeight;
    return { peek: 150, half: Math.round(vh * 0.52), full: vh - 56 };
  }
  function setDetent(d) { panel.dataset.detent = d; panel.style.removeProperty('--sheet-h'); }
  (function sheetDrag() {
    let startY = 0, startH = 0, moved = false, active = false;
    const handles = [$('#grabber'), $('#panel-head')];
    const down = (e) => {
      if (!isMobile() || e.target.closest('input, button:not(#grabber)')) return;
      active = true; moved = false;
      startY = e.clientY; startH = panel.offsetHeight;
      panel.classList.add('dragging');
      e.currentTarget.setPointerCapture(e.pointerId);
    };
    const move = (e) => {
      if (!active) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 4) moved = true;
      const h = heights();
      panel.style.setProperty('--sheet-h', Math.max(h.peek - 30, Math.min(h.full, startH - dy)) + 'px');
    };
    const up = (e) => {
      if (!active) return;
      active = false;
      panel.classList.remove('dragging');
      const h = heights();
      if (!moved) {
        if (e.currentTarget.id === 'grabber') setDetent(panel.dataset.detent === 'full' ? 'half' : panel.dataset.detent === 'half' ? 'full' : 'half');
        else panel.style.removeProperty('--sheet-h');
        return;
      }
      const cur = panel.offsetHeight;
      const pick = Object.keys(h).sort((a, b) => Math.abs(h[a] - cur) - Math.abs(h[b] - cur))[0];
      setDetent(pick);
    };
    handles.forEach((el) => {
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  })();
  $('#panel-body').addEventListener('scroll', (e) => panel.classList.toggle('scrolled', e.target.scrollTop > 2), { passive: true });

  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------- Arranque ---------- */
  async function boot() {
    initMap();
    try {
      const [a, b] = await Promise.all([fetch('data/stations.json', { cache: 'no-cache' }), fetch('data/history.json', { cache: 'no-cache' })]);
      if (!a.ok) throw new Error('stations ' + a.status);
      state.data = await a.json();
      state.hist = b.ok ? await b.json() : { days: [], changes: {} };
    } catch (e) {
      $('#panel-body').innerHTML = '<div class="hero"><div class="hero-name">No pudimos cargar los precios</div><p class="sec">Revisa tu conexión e intenta de nuevo en unos minutos.</p></div>';
      return;
    }
    prepare();
    const old = (Date.now() - new Date(state.data.updated).getTime()) / 36e5;
    if (old > 36) toast('Los precios no se han actualizado desde hace ' + Math.floor(old / 24) + ' días.');
    const h = location.hash.slice(1);
    go(h === 'mapa' ? 'hoy' : h || 'hoy');
  }
  boot();
})();
