/* BoletaMax – seatmap.js: motor del mapa interactivo de asientos (v2),
   carrito de selección, zoom/pan y redirección al checkout */

import { showToast } from './toast.js';
import { openModal, showCheckoutTransition } from './modals.js';

/* ---- ZONE COLOUR PALETTE ---- */
const ZONE_COLORS = {
  fan: '#e2c46f',
  vip5: '#c99b3a',
  oro5: '#7492be',
  oro: '#516c95',
  gen: '#293a55',
};

/* ---- VENUE CONFIGS ---- */
// Each venue defines zones with arc geometry:
//   r       – base radius from center (SVG units)
//   rows    – number of row arcs
//   rowGap  – px between rows
//   nSeats  – seats in first row (increments by +2 per row)
//   startDeg / endDeg – arc span in degrees
//   tableSize – seats grouped per mesa (2 or 4)
const VENUE_CONFIGS = {

  /* ---- PALENQUE 360° — Escenario circular central ---- */
  palenque: {
    cx: 360, cy: 310,        // Centro exacto del viewport
    viewBox: '0 0 720 640',
    stageR: 80,              // Radio del escenario circular
    stageLabel: 'ESCENARIO',
    stageSubLabel: '360°',
    layoutLabel: 'Palenque 360°',
    bgR: 310,                // Radio del fondo oscuro
    zones: [
      { key: 'fan', label: 'FAN', r: 117, rows: 3, rowGap: 14, nSeats: 28, startDeg: 0, endDeg: 359, tableSize: 4, priceBase: 1700 },
      { key: 'vip5', label: 'VIP', r: 161, rows: 3, rowGap: 14, nSeats: 38, startDeg: 0, endDeg: 359, tableSize: 4, priceBase: 1150 },
      { key: 'oro5', label: 'ORO 5', r: 205, rows: 3, rowGap: 14, nSeats: 48, startDeg: 0, endDeg: 359, tableSize: 4, priceBase: 1000 },
      { key: 'oro', label: 'ORO', r: 249, rows: 3, rowGap: 14, nSeats: 56, startDeg: 0, endDeg: 359, tableSize: 2, priceBase: 750 },
      { key: 'gen', label: 'GENERAL', r: 291, rows: 2, rowGap: 14, nSeats: 64, startDeg: 0, endDeg: 359, tableSize: 2, priceBase: 480 },
    ],
  },

  /* ---- ARENA 360° — Ring central ---- */
  arena: {
    cx: 360, cy: 310,
    viewBox: '0 0 720 640',
    stageR: 75,
    stageLabel: 'RING',
    stageSubLabel: 'CENTRAL',
    layoutLabel: 'Arena circular',
    bgR: 305,
    zones: [
      { key: 'fan', label: 'RINGSIDE', r: 112, rows: 2, rowGap: 14, nSeats: 24, startDeg: 0, endDeg: 359, tableSize: 4, priceBase: 2000 },
      { key: 'vip5', label: 'VIP', r: 148, rows: 3, rowGap: 14, nSeats: 32, startDeg: 0, endDeg: 359, tableSize: 4, priceBase: 1400 },
      { key: 'oro5', label: 'PLATINO', r: 190, rows: 3, rowGap: 13, nSeats: 40, startDeg: 0, endDeg: 359, tableSize: 2, priceBase: 900 },
      { key: 'oro', label: 'ORO', r: 229, rows: 3, rowGap: 13, nSeats: 48, startDeg: 0, endDeg: 359, tableSize: 2, priceBase: 650 },
      { key: 'gen', label: 'GENERAL', r: 268, rows: 3, rowGap: 13, nSeats: 56, startDeg: 0, endDeg: 359, tableSize: 1, priceBase: 350 },
    ],
  },

  /* ---- TEATRO — Semicírculo frente al escenario ---- */
  teatro: {
    cx: 360, cy: 430,
    viewBox: '0 0 720 580',
    stageR: 68,
    stageRx: 150,
    stageRy: 42,
    stageLabel: 'ESCENARIO',
    stageSubLabel: 'FRONTAL',
    layoutLabel: 'Teatro frontal',
    bgR: 0,                  // Sin fondo circular para el teatro
    zones: [
      { key: 'fan', label: 'ORQUESTA', r: 108, rows: 3, rowGap: 14, nSeats: 20, startDeg: 195, endDeg: 345, tableSize: 4, priceBase: 1800 },
      { key: 'vip5', label: 'LUNETA', r: 152, rows: 4, rowGap: 13, nSeats: 28, startDeg: 192, endDeg: 348, tableSize: 2, priceBase: 1100 },
      { key: 'oro5', label: 'MEZZANINE', r: 198, rows: 3, rowGap: 13, nSeats: 34, startDeg: 190, endDeg: 350, tableSize: 2, priceBase: 800 },
      { key: 'oro', label: 'PALCO', r: 238, rows: 2, rowGap: 13, nSeats: 38, startDeg: 188, endDeg: 352, tableSize: 2, priceBase: 600 },
      { key: 'gen', label: 'GALERÍA', r: 274, rows: 3, rowGap: 13, nSeats: 42, startDeg: 186, endDeg: 354, tableSize: 1, priceBase: 380 },
    ],
  },

  /* ---- ESTADIO — escenario frontal amplio ---- */
  estadio: {
    cx: 360, cy: 505,
    viewBox: '0 0 720 640',
    stageR: 58,
    stageRx: 190,
    stageRy: 46,
    stageLabel: 'ESCENARIO',
    stageSubLabel: 'FRONTAL',
    layoutLabel: 'Estadio frontal',
    bgR: 0,
    zones: [
      { key: 'fan', label: 'FAN PIT', r: 112, rows: 3, rowGap: 15, nSeats: 20, startDeg: 205, endDeg: 335, tableSize: 2, priceBase: 1900 },
      { key: 'vip5', label: 'VIP', r: 158, rows: 3, rowGap: 15, nSeats: 28, startDeg: 198, endDeg: 342, tableSize: 2, priceBase: 1450 },
      { key: 'oro5', label: 'PREFERENTE', r: 204, rows: 3, rowGap: 15, nSeats: 36, startDeg: 193, endDeg: 347, tableSize: 1, priceBase: 980 },
      { key: 'oro', label: 'PLATEA', r: 249, rows: 3, rowGap: 15, nSeats: 42, startDeg: 188, endDeg: 352, tableSize: 1, priceBase: 720 },
      { key: 'gen', label: 'GRADA', r: 294, rows: 2, rowGap: 16, nSeats: 52, startDeg: 184, endDeg: 356, tableSize: 1, priceBase: 520 },
    ],
  },

  /* ---- FESTIVAL — campo abierto con escenario principal ---- */
  festival: {
    cx: 360, cy: 500,
    viewBox: '0 0 720 640',
    stageR: 54,
    stageRx: 170,
    stageRy: 44,
    stageLabel: 'MAIN STAGE',
    stageSubLabel: 'FESTIVAL',
    layoutLabel: 'Festival general',
    bgR: 0,
    zones: [
      { key: 'fan', label: 'FRONT STAGE', r: 104, rows: 3, rowGap: 15, nSeats: 20, startDeg: 208, endDeg: 332, tableSize: 2, priceBase: 1600 },
      { key: 'vip5', label: 'VIP DECK', r: 150, rows: 3, rowGap: 15, nSeats: 26, startDeg: 202, endDeg: 338, tableSize: 4, priceBase: 1180 },
      { key: 'oro5', label: 'PREFERENTE', r: 196, rows: 3, rowGap: 15, nSeats: 34, startDeg: 196, endDeg: 344, tableSize: 2, priceBase: 900 },
      { key: 'oro', label: 'GENERAL A', r: 242, rows: 3, rowGap: 15, nSeats: 42, startDeg: 190, endDeg: 350, tableSize: 1, priceBase: 650 },
      { key: 'gen', label: 'GENERAL B', r: 288, rows: 2, rowGap: 16, nSeats: 50, startDeg: 185, endDeg: 355, tableSize: 1, priceBase: 430 },
    ],
  },
};

/* ---- Event → venue mapping ---- */
// Debe coincidir con SERVER_EVENT_VENUE_MAP (server/pricing.mjs): el servidor
// cotiza con su propio mapa, y si divergen el precio mostrado no corresponde.
const EVENT_VENUE_MAP = {
  'Gran Festival de Banda': 'palenque',
  'El Fantasma de la Ópera': 'teatro',
  'Noche Urbana GDL': 'festival',
  'Feria del Estado CHH': 'palenque',
  'Comedy Night Puebla': 'teatro',
  'Lucha Libre CMLL': 'arena',
  'Noche de Rock Épica 2025': 'estadio',
  'Festival SolMaX 2025': 'festival',
  'Festival SolMaX': 'festival',
};

/* ---- State ---- */
const FEE_RATE = 0.14;
const AVAILABILITY_TIMEOUT_MS = 2500;
let selectedSeats = [];
let seatData = {};       // id → seat object
let currentVenueKey = 'palenque';
let _idCounter = 0;

// Zoom/pan state
let svgScale = 1;
let svgTx = 0, svgTy = 0;
let _panLock = false; // prevent re-init

/* ---- Degree → Radian ---- */
const toRad = deg => (deg / 180) * Math.PI;

/* ---- SVG Namespace shorthand ---- */
const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, text) {
  const el = document.createElementNS(NS, tag);
  Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
  if (text !== undefined) el.textContent = text;
  return el;
}

/* =============================================================
   REAL SEAT AVAILABILITY
   Los asientos ocupados vienen del inventario real del servidor
   (boletos ya vendidos), no de una simulación aleatoria.
   ============================================================= */

// Réplica exacta de normalizeZoneLabel + buildSeatKey del servidor
// (server/text.mjs y server/pricing.mjs) para que las llaves coincidan.
function normalizeZoneKey(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildSeatKey({ zoneLabel, fila, mesa, seatInMesa, asiento, tableSize }) {
  const zone = normalizeZoneKey(zoneLabel);
  const row = String(fila || 'A').trim().toUpperCase();
  if (tableSize > 1 && mesa) {
    return `${zone}|${row}|M${mesa}|L${seatInMesa || 1}`;
  }
  return `${zone}|${row}|A${asiento || 1}`;
}

async function fetchSeatAvailability(event) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AVAILABILITY_TIMEOUT_MS);
    const response = await fetch('/api/events/availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`availability failed: ${response.status}`);
    const payload = await response.json();
    return {
      soldKeys: new Set(payload.soldSeatKeys || []),
      zoneLabels: payload.zoneLabels || null,
    };
  } catch (_) {
    // Sin datos de disponibilidad mostramos todo libre; el servidor sigue
    // validando el inventario real al comprar.
    return { soldKeys: new Set(), zoneLabels: null };
  }
}

function describeArc(cx, cy, r, startDeg, endDeg) {
  const start = { x: cx + r * Math.cos(toRad(startDeg)), y: cy + r * Math.sin(toRad(startDeg)) };
  const end = { x: cx + r * Math.cos(toRad(endDeg)), y: cy + r * Math.sin(toRad(endDeg)) };
  const largeArcFlag = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${largeArcFlag} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function renderMapLegend(prices = {}) {
  const legend = document.querySelector('.map-legend');
  const cfg = VENUE_CONFIGS[currentVenueKey];
  if (!legend || !cfg) return;

  const items = cfg.zones.map(zone => {
    const price = prices[zone.key] ?? zone.priceBase;
    return `<span class="ml-item"><span class="ml-dot" style="background:${ZONE_COLORS[zone.key]}"></span>${zone.label} · $${price.toLocaleString('es-MX')}</span>`;
  });
  items.push('<span class="ml-item"><span class="ml-dot ml-dot-selected"></span>Seleccionado</span>');
  items.push('<span class="ml-item"><span class="ml-dot ml-dot-sold"></span>Ocupado</span>');
  legend.innerHTML = items.join('');
}

/* =============================================================
   generateSeats()
   Builds all <g> (group per seat) elements inside #svg-pan-group
   ============================================================= */
function generateSeats(prices, availability = { soldKeys: new Set(), zoneLabels: null }) {
  const group = document.getElementById('svg-pan-group');
  // Remove old seats, labels and separators
  group.querySelectorAll('.seat-group, .row-label, .zone-label, .zone-sep, .zone-band').forEach(el => el.remove());

  seatData = {};
  selectedSeats = [];
  _idCounter = 0;

  const cfg = VENUE_CONFIGS[currentVenueKey];
  const isFullCircle = z => z.endDeg >= 355;

  cfg.zones.forEach(zone => {
    const price = prices[zone.key] !== undefined ? prices[zone.key] : zone.priceBase;
    const color = ZONE_COLORS[zone.key];
    const full = isFullCircle(zone);

    let globalSeatInZone = 0;

    const bandR = zone.r + ((zone.rows - 1) * zone.rowGap) / 2;
    const bandWidth = Math.max(zone.rows * zone.rowGap + 7, 18);
    const bandAttrs = {
      fill: 'none',
      stroke: color,
      'stroke-width': bandWidth.toFixed(1),
      'stroke-opacity': full ? '0.075' : '0.095',
      'stroke-linecap': 'round',
      class: `zone-band zone-band-${zone.key}`,
      'pointer-events': 'none',
    };
    const zoneBand = full
      ? svgEl('circle', { ...bandAttrs, cx: cfg.cx, cy: cfg.cy, r: bandR.toFixed(1) })
      : svgEl('path', { ...bandAttrs, d: describeArc(cfg.cx, cfg.cy, bandR, zone.startDeg, zone.endDeg) });
    group.insertBefore(zoneBand, group.firstChild);

    // ── Zone separator ring (subtle) ────────────────────────────
    const sepR = zone.r - zone.rowGap * 0.5; // between this zone and previous
    if (zone !== cfg.zones[0]) {
      const sep = svgEl('circle', {
        cx: cfg.cx, cy: cfg.cy, r: sepR.toFixed(1),
        fill: 'none', stroke: 'rgba(255,255,255,0.06)',
        'stroke-width': '1.5', class: 'zone-sep',
        'pointer-events': 'none',
      });
      group.insertBefore(sep, group.firstChild);
    }

    // ── Zone label (one per zone, outside outermost row) ─────────
    const outerR = zone.r + (zone.rows - 1) * zone.rowGap + 12;
    let labelAngle;
    if (full) {
      // Place at 90° (below center, clear of seats on the ring)
      labelAngle = Math.PI / 2;
    } else {
      // Place outside the midpoint of the arc
      const midDeg = (zone.startDeg + zone.endDeg) / 2;
      labelAngle = toRad(midDeg + 180); // opposite side → outside arc
    }
    const zLx = (cfg.cx + outerR * Math.cos(labelAngle)).toFixed(1);
    const zLy = (cfg.cy + outerR * Math.sin(labelAngle)).toFixed(1);
    const zoneLbl = svgEl('text', {
      x: zLx, y: zLy,
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      fill: color, 'fill-opacity': '0.7',
      'font-size': '6.5', 'font-family': 'Manrope,sans-serif',
      'font-weight': '700', 'letter-spacing': '0.5',
      'pointer-events': 'none', class: 'zone-label',
    }, zone.label);
    group.appendChild(zoneLbl);

    // ── Seat rows ────────────────────────────────────────────────
    for (let row = 0; row < zone.rows; row++) {
      const r = zone.r + row * zone.rowGap;
      const rowLabel = String.fromCharCode(65 + row); // A, B, C …
      const startRad = toRad(zone.startDeg);
      const endRad = toRad(zone.endDeg);
      const totalAngle = endRad - startRad;
      const n = zone.nSeats + row * 2; // widen each row slightly

      for (let i = 0; i < n; i++) {
        // For last seat of full-circle arcs, use n (not n-1) so the last
        // seat doesn't land on top of the first seat.
        const divisor = full ? n : Math.max(n - 1, 1);
        const theta = startRad + (i / divisor) * totalAngle;
        const cx = cfg.cx + r * Math.cos(theta);
        const cy = cfg.cy + r * Math.sin(theta);

        const id = ++_idCounter;
        globalSeatInZone++;

        /* Mesa calculation */
        const mesaNum = Math.ceil(globalSeatInZone / zone.tableSize);
        const seatInMesa = ((globalSeatInZone - 1) % zone.tableSize) + 1;

        // Ocupado = vendido de verdad según el inventario del servidor.
        // La llave usa la etiqueta de zona del servidor (puede diferir de la
        // local cuando el layout del venue difiere entre cliente y servidor).
        const serverZoneLabel = availability.zoneLabels?.[zone.key] || zone.label;
        const seatKey = buildSeatKey({
          zoneLabel: serverZoneLabel,
          fila: rowLabel,
          mesa: mesaNum,
          seatInMesa,
          asiento: i + 1,
          tableSize: zone.tableSize,
        });
        const sold = availability.soldKeys.has(seatKey);

        /* The seat group: circle + number label */
        const seatLabel = zone.tableSize > 1
          ? `${zone.label}, fila ${rowLabel}, mesa ${mesaNum}, lugar ${seatInMesa}`
          : `${zone.label}, fila ${rowLabel}, asiento ${i + 1}`;
        const gAttrs = {
          class: 'seat-group',
          'data-id': id,
          role: sold ? 'img' : 'button',
          tabindex: sold ? '-1' : '0',
          'aria-label': sold ? `${seatLabel}, ocupado` : `${seatLabel}, $${price.toLocaleString('es-MX')} MXN`,
        };
        if (!sold) gAttrs['aria-pressed'] = 'false';
        const g = svgEl('g', gAttrs);

        const circle = svgEl('circle', {
          cx: cx.toFixed(2), cy: cy.toFixed(2), r: 3.75,
          fill: sold ? '#1e293b' : color,
          class: 'svg-seat' + (sold ? ' sold' : ''),
        });
        g.appendChild(circle);

        // Store seat data
        seatData[id] = {
          id, zone: zone.key, zoneLabel: zone.label, color,
          fila: rowLabel, asiento: i + 1,
          mesaNum, seatInMesa, tableSize: zone.tableSize,
          price, sold, el: g, circle,
        };

        if (!sold) {
          g.style.cursor = 'pointer';
          g.addEventListener('mouseenter', e => onSeatHover(e, id));
          g.addEventListener('mouseleave', hideSeatTooltip);
          g.addEventListener('click', () => onSeatClick(id));
          g.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSeatClick(id);
            }
          });
        } else {
          g.style.cursor = 'not-allowed';
          // Show "Ocupado" on hover for sold seats
          g.addEventListener('mouseenter', () => showSoldTooltip(g, cx, cy));
          g.addEventListener('mouseleave', hideSeatTooltip);
        }

        group.appendChild(g);
      }
    }
  });
}


/* =============================================================
   TOOLTIP
   ============================================================= */
const tooltip = document.getElementById('seat-tooltip');
const mapContainer = document.getElementById('seat-map-container');

function onSeatHover(e, id) {
  const s = seatData[id];
  if (!s || s.sold) return;

  const mesaLabel = s.tableSize > 1 ? `Mesa ${s.mesaNum}` : `Asiento ${s.asiento}`;
  document.getElementById('st-area').textContent = s.zoneLabel;
  document.getElementById('st-fila').textContent = `Fila ${s.fila}`;
  document.getElementById('st-asiento').textContent = mesaLabel;
  document.getElementById('st-precio').textContent =
    `$${s.price.toLocaleString('es-MX')} + $${Math.round(s.price * FEE_RATE).toLocaleString('es-MX')} servicio`;

  tooltip.style.display = 'block';
  moveTooltip(e);
  e.currentTarget.addEventListener('mousemove', moveTooltip, { passive: true });
}

function moveTooltip(e) {
  if (!mapContainer) return;
  const rect = mapContainer.getBoundingClientRect();
  let left = e.clientX - rect.left + 15;
  let top = e.clientY - rect.top - 12;
  const tw = tooltip.offsetWidth || 178;
  const th = tooltip.offsetHeight || 92;
  if (left + tw > mapContainer.clientWidth - 8) left = e.clientX - rect.left - tw - 12;
  if (top + th > mapContainer.clientHeight - 8) top = e.clientY - rect.top - th - 8;
  tooltip.style.left = left + 'px';
  tooltip.style.top = top + 'px';
}

function hideSeatTooltip(e) {
  tooltip.style.display = 'none';
  if (e) e.currentTarget.removeEventListener('mousemove', moveTooltip);
}

function showSoldTooltip(g, cx, cy) {
  document.getElementById('st-area').textContent = 'Asiento';
  document.getElementById('st-fila').textContent = '—';
  document.getElementById('st-asiento').textContent = 'OCUPADO';
  document.getElementById('st-precio').textContent = 'No disponible';
  tooltip.style.display = 'block';
  // Position near the seat group element
  const rect = mapContainer.getBoundingClientRect();
  const svg = document.getElementById('venue-svg');
  const svgRect = svg.getBoundingClientRect();
  const vb = svg.getAttribute('viewBox').split(' ').map(Number);
  const scaleX = svgRect.width / vb[2];
  const scaleY = svgRect.height / vb[3];
  const screenX = svgRect.left + (cx * svgScale + svgTx) * scaleX - rect.left + 16;
  const screenY = svgRect.top + (cy * svgScale + svgTy) * scaleY - rect.top - 12;
  tooltip.style.left = Math.max(0, Math.min(screenX, mapContainer.clientWidth - 190)) + 'px';
  tooltip.style.top = Math.max(0, screenY) + 'px';
}

/* =============================================================
   SEAT SELECTION
   ============================================================= */
function onSeatClick(id) {
  const s = seatData[id];
  if (!s || s.sold) return;

  const idx = selectedSeats.findIndex(x => x.id === id);
  if (idx >= 0) {
    // Deselect
    selectedSeats.splice(idx, 1);
    s.circle.setAttribute('fill', s.color);
    s.circle.classList.remove('seat-selected');
    s.el.setAttribute('aria-pressed', 'false');
  } else {
    if (selectedSeats.length >= 10) {
      showToast('Máximo 10 boletos por compra', 'error');
      return;
    }
    selectedSeats.push({ ...s });
    s.circle.setAttribute('fill', '#d4af37');
    s.circle.classList.add('seat-selected');
    s.el.setAttribute('aria-pressed', 'true');
  }
  renderCart();
}

/* =============================================================
   CART
   ============================================================= */
function renderEmptyCart(list) {
  const empty = document.createElement('div');
  empty.className = 'cart-empty-msg';
  empty.id = 'cart-empty-msg';

  const icon = document.createElement('i');
  icon.className = 'fas fa-ticket';
  const text = document.createElement('p');
  text.textContent = 'Selecciona asientos en el mapa';

  empty.append(icon, text);
  list.replaceChildren(empty);
}

function renderCart() {
  const list = document.getElementById('cart-items-list');
  const totals = document.getElementById('cart-totals');
  const badge = document.getElementById('cart-count-badge');
  const btn = document.getElementById('btn-comprar');

  badge.textContent = `${selectedSeats.length} boleto${selectedSeats.length !== 1 ? 's' : ''}`;

  if (!selectedSeats.length) {
    renderEmptyCart(list);
    totals.style.display = 'none';
    btn.disabled = true;
    return;
  }

  list.replaceChildren();
  selectedSeats.forEach(s => {
    const item = document.createElement('div');
    item.className = 'cart-ticket-item';

    const zone = document.createElement('div');
    zone.className = 'cti-zone';
    const dot = document.createElement('span');
    dot.className = 'cti-dot';
    dot.style.background = s.color;
    zone.append(dot, document.createTextNode(s.zoneLabel));

    const detail = document.createElement('div');
    detail.className = 'cti-detail';
    detail.textContent = s.tableSize > 1
      ? `Fila ${s.fila} · Mesa ${s.mesaNum} · Lugar ${s.seatInMesa}`
      : `Fila ${s.fila} · Asiento ${s.asiento}`;

    const price = document.createElement('div');
    price.className = 'cti-price';
    price.textContent = `$${s.price.toLocaleString('es-MX')} MXN`;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'cti-remove';
    remove.setAttribute('aria-label', `Eliminar ${detail.textContent} del carrito`);
    remove.addEventListener('click', () => removeSeat(s.id));

    const removeIcon = document.createElement('i');
    removeIcon.className = 'fas fa-times';
    remove.appendChild(removeIcon);

    item.append(zone, detail, price, remove);
    list.appendChild(item);
  });

  const subtotal = selectedSeats.reduce((a, s) => a + s.price, 0);
  const fee = Math.round(subtotal * FEE_RATE);
  const total = subtotal + fee;

  document.getElementById('ct-subtotal').textContent = `$${subtotal.toLocaleString('es-MX')} MXN`;
  document.getElementById('ct-fee').textContent = `$${fee.toLocaleString('es-MX')} MXN`;
  document.getElementById('ct-total').textContent = `$${total.toLocaleString('es-MX')} MXN`;
  totals.style.display = 'block';
  btn.disabled = false;
}

export function removeSeat(id) {
  const s = seatData[id];
  if (s) {
    s.circle.setAttribute('fill', s.color);
    s.circle.classList.remove('seat-selected');
    s.el.setAttribute('aria-pressed', 'false');
  }
  selectedSeats = selectedSeats.filter(x => x.id !== id);
  renderCart();
}

/* =============================================================
   ZOOM + PAN  (Fixed: centered transform, wheel on cursor)
   ============================================================= */
function initZoomPan() {
  if (_panLock) return;
  _panLock = true;

  const svg = document.getElementById('venue-svg');
  const group = document.getElementById('svg-pan-group');
  svgScale = 1; svgTx = 0; svgTy = 0;

  function applyTransform() {
    group.setAttribute('transform', `translate(${svgTx.toFixed(2)},${svgTy.toFixed(2)}) scale(${svgScale.toFixed(4)})`);
    // Show seat numbers at high zoom
    group.classList.toggle('zoom-labels', svgScale >= 2.2);
  }

  function zoomAt(factor, originX, originY) {
    const newScale = Math.max(0.55, Math.min(5.5, svgScale * factor));
    if (newScale === svgScale) return;
    // Adjust translation so the zoom is centred on (originX, originY) in svg coords
    const r = newScale / svgScale;
    svgTx = originX - r * (originX - svgTx);
    svgTy = originY - r * (originY - svgTy);
    svgScale = newScale;
    applyTransform();
  }

  // Button controls — zoom around SVG centre
  const vb = svg.getAttribute('viewBox').split(' ').map(Number);
  const vcx = vb[2] / 2, vcy = vb[3] / 2;

  document.getElementById('btn-map-in').onclick = () => zoomAt(1.35, vcx, vcy);
  document.getElementById('btn-map-out').onclick = () => zoomAt(1 / 1.35, vcx, vcy);
  document.getElementById('btn-map-home').onclick = () => {
    svgScale = 1; svgTx = 0; svgTy = 0; applyTransform();
  };

  // Mouse-wheel zoom (centered on cursor)
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    // Convert mouse position to SVG coordinate space
    const mouseX = (e.clientX - rect.left) / rect.width * vb[2];
    const mouseY = (e.clientY - rect.top) / rect.height * vb[3];
    // cursor in group coordinate space
    const gx = (mouseX - svgTx) / svgScale;
    const gy = (mouseY - svgTy) / svgScale;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newScale = Math.max(0.55, Math.min(5.5, svgScale * factor));
    svgTx = mouseX - gx * newScale;
    svgTy = mouseY - gy * newScale;
    svgScale = newScale;
    applyTransform();
  }, { passive: false });

  // Mouse drag to pan
  let dragging = false, dragSX, dragSY, dragTX, dragTY;
  svg.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    dragging = true;
    dragSX = e.clientX; dragSY = e.clientY;
    dragTX = svgTx; dragTY = svgTy;
    svg.style.cursor = 'grabbing';
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = vb[2] / rect.width;
    const scaleY = vb[3] / rect.height;
    svgTx = dragTX + (e.clientX - dragSX) * scaleX;
    svgTy = dragTY + (e.clientY - dragSY) * scaleY;
    applyTransform();
  });
  window.addEventListener('mouseup', () => { dragging = false; svg.style.cursor = 'grab'; });

  // Touch
  let tc0 = null, tTX, tTY;
  svg.addEventListener('touchstart', e => {
    if (e.touches.length === 1) { tc0 = e.touches[0]; tTX = svgTx; tTY = svgTy; }
  }, { passive: true });
  svg.addEventListener('touchmove', e => {
    if (e.touches.length === 1 && tc0) {
      const rect = svg.getBoundingClientRect();
      const sx = vb[2] / rect.width, sy = vb[3] / rect.height;
      svgTx = tTX + (e.touches[0].clientX - tc0.clientX) * sx;
      svgTy = tTY + (e.touches[0].clientY - tc0.clientY) * sy;
      applyTransform();
    }
  }, { passive: true });

  // Touch pinch‑zoom
  let lastPinchDist = null;
  svg.addEventListener('touchstart', e => {
    if (e.touches.length === 2) lastPinchDist = null;
  }, { passive: true });
  svg.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (lastPinchDist !== null) {
        const factor = dist / lastPinchDist;
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const rect = svg.getBoundingClientRect();
        const ox = (mx - rect.left) / rect.width * vb[2];
        const oy = (my - rect.top) / rect.height * vb[3];
        zoomAt(factor, ox, oy);
      }
      lastPinchDist = dist;
    }
  }, { passive: true });
}

/* =============================================================
   UPDATE SVG VIEWBOX when venue changes
   ============================================================= */
function updateSvgStructure() {
  const cfg = VENUE_CONFIGS[currentVenueKey];
  const svg = document.getElementById('venue-svg');
  svg.setAttribute('viewBox', cfg.viewBox);
  svg.dataset.venue = currentVenueKey;

  const stageEl = svg.querySelector('.stage-ellipse');
  const stageT1 = svg.querySelector('text.stage-text1');
  const stageT2 = svg.querySelector('text.stage-text2');
  const bgEl = svg.querySelector('.bg-ellipse');
  const modal = document.getElementById('ticket-modal');
  const layoutLabel = document.getElementById('map-layout-label');

  if (modal) modal.dataset.venue = currentVenueKey;
  if (layoutLabel) layoutLabel.textContent = cfg.layoutLabel || 'Vista del recinto';

  const scy = cfg.cy; // Stage and arc share the same center

  if (stageEl) {
    stageEl.setAttribute('cx', cfg.cx);
    stageEl.setAttribute('cy', scy);
    stageEl.setAttribute('rx', cfg.stageRx || cfg.stageR);
    stageEl.setAttribute('ry', cfg.stageRy || cfg.stageR);
  }
  if (stageT1) {
    stageT1.setAttribute('x', cfg.cx);
    stageT1.setAttribute('y', scy - 6);
    stageT1.textContent = cfg.stageLabel || 'ESCENARIO';
  }
  if (stageT2) {
    stageT2.setAttribute('x', cfg.cx);
    stageT2.setAttribute('y', scy + 10);
    stageT2.textContent = cfg.stageSubLabel || '360°';
  }
  if (bgEl) {
    if (cfg.bgR && cfg.bgR > 0) {
      bgEl.style.display = '';
      bgEl.setAttribute('cx', cfg.cx);
      bgEl.setAttribute('cy', cfg.cy);
      bgEl.setAttribute('rx', cfg.bgR);
      bgEl.setAttribute('ry', cfg.bgR);
    } else {
      bgEl.style.display = 'none';
    }
  }
}

/* =============================================================
   OPEN TICKET MODAL (entry point from event cards)
   ============================================================= */
let _openTicketSeq = 0;

export async function openTicketModal(name, date, venue, price, venueType) {
  const openSeq = ++_openTicketSeq;
  const base = parseInt(String(price).replace(/[^0-9]/g, '')) || 650;

  // Pick venue layout
  currentVenueKey = venueType || EVENT_VENUE_MAP[name] || 'palenque';

  const cfg = VENUE_CONFIGS[currentVenueKey];
  const prices = {};
  cfg.zones.forEach(z => {
    const ratio = z.priceBase / cfg.zones[cfg.zones.length - 1].priceBase;
    prices[z.key] = Math.round(base * ratio);
  });

  // Update header
  document.getElementById('tm-event-name').textContent = name;
  document.getElementById('tm-date-text').textContent = date;
  document.getElementById('tm-venue-text').textContent = venue;

  // Update legend bar
  cfg.zones.forEach(z => {
    const el = document.getElementById(`plb-${z.key}`);
    if (el) el.textContent = `$${prices[z.key].toLocaleString('es-MX')}`;
  });
  renderMapLegend(prices);

  // Save cart info in session for checkout page
  sessionStorage.setItem('bm_event', JSON.stringify({ name, date, venue }));

  // Reset SVG structure
  updateSvgStructure();

  // Reset zoom
  svgScale = 1; svgTx = 0; svgTy = 0;
  const group = document.getElementById('svg-pan-group');
  if (group) {
    group.setAttribute('transform', 'translate(0,0) scale(1)');
    group.classList.remove('zoom-labels');
    // Quitar de inmediato los asientos del evento anterior; los nuevos se
    // generan cuando llega la disponibilidad real del servidor.
    group.querySelectorAll('.seat-group, .row-label, .zone-label, .zone-sep, .zone-band').forEach(el => el.remove());
  }

  // Reset cart UI
  selectedSeats = [];
  renderEmptyCart(document.getElementById('cart-items-list'));
  document.getElementById('cart-totals').style.display = 'none';
  document.getElementById('cart-count-badge').textContent = '0 boletos';
  const btn = document.getElementById('btn-comprar');
  if (btn) btn.disabled = true;

  // Allow zoom/pan re-init each time modal opens
  _panLock = false;
  openModal('ticket-modal');

  // Los asientos ocupados salen del inventario real del servidor; si otro
  // openTicketModal se disparó mientras esperábamos, este render se descarta.
  const availability = await fetchSeatAvailability({ name, date, venue });
  if (openSeq !== _openTicketSeq) return;

  // Generate fresh seats
  generateSeats(prices, availability);

  // Init after modal is visible
  requestAnimationFrame(() => initZoomPan());
}

/* =============================================================
   CHECKOUT REDIRECT
   ============================================================= */
export function proceedCheckout() {
  if (!selectedSeats.length) { showToast('⚠️ Selecciona al menos un asiento primero', 'error'); return; }

  // Save cart to session storage
  const subtotal = selectedSeats.reduce((a, s) => a + s.price, 0);
  const fee = Math.round(subtotal * FEE_RATE);
  const total = subtotal + fee;

  const cartPayload = {
    seats: selectedSeats.map(s => ({
      zone: s.zoneLabel, fila: s.fila,
      mesa: s.mesaNum, asiento: s.asiento, seatInMesa: s.seatInMesa,
      tableSize: s.tableSize, price: s.price,
    })),
    subtotal, fee, total,
    event: JSON.parse(sessionStorage.getItem('bm_event') || '{}'),
  };
  sessionStorage.setItem('bm_cart', JSON.stringify(cartPayload));

  showCheckoutTransition();
  setTimeout(() => {
    window.location.href = 'checkout.html';
  }, 720);
}
