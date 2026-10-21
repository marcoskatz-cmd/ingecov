/* Tarja diaria de equipos (sistema tarja-flota) dentro del panel:
   - Pestaña "mapa": última posición conocida de cada equipo (GPS de la última
     foto de horómetro), con color por antigüedad del dato.
   - Sección "tarjas diarias" en el detalle de cada equipo: últimas jornadas,
     horas, operario y fallas abiertas del checklist.
   Lee la API pública de la tarja (solo lectura). Todo el DOM del mapa se arma
   con nodos, no con strings: el CSP exige Trusted Types. */

const TARJA_API = 'https://script.google.com/macros/s/AKfycbydf1RDfDnIPZs2uZaiXyZ7uPsmw67gUbQ1C2-NRcZkmg9OO4ZMQe45AyMTc75k0nEv/exec';
const TARJA_PANEL = 'https://marcoskatz-cmd.github.io/tarja-flota/panel.html';

async function tarjaFetch(action, datos) {
  const r = await fetch(TARJA_API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action }, datos || {}))
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'La tarja no respondió');
  return j.data;
}

function _tarjaNum(v) {
  return v === '' || v == null || !isFinite(Number(v)) ? '—' : Number(v).toLocaleString('es-AR', { maximumFractionDigits: 1 });
}

/* ───────── detalle del equipo ───────── */

/** Placeholder que se inserta en el detalle; cargarTarjasEquipo lo completa. */
function tarjasPlaceholder(codigo) {
  return eqSection('tarjas diarias',
    html`<div id="eqTarjasBody" data-cod="${normCod(codigo)}" style="padding:.6rem 0;font-family:var(--display);font-variant-numeric:tabular-nums;font-size:12px;color:var(--text3)">cargando tarjas…</div>`,
    false).value;
}

async function cargarTarjasEquipo(codigo) {
  const codN = normCod(codigo);
  let d;
  try {
    d = await tarjaFetch('publico_tarjas', { codigo, max: 20 });
  } catch (e) {
    const el0 = document.getElementById('eqTarjasBody');
    if (!el0 || el0.dataset.cod !== codN) return;
    // Equipo que no está en la tarja (camiones, livianos) o tarja caída.
    setHTML(el0, html`<span>${/no está en la lista/i.test(e.message) ? 'Este equipo no lleva tarja diaria.' : 'No se pudo leer la tarja: ' + e.message}</span>`);
    return;
  }
  const el = document.getElementById('eqTarjasBody');
  if (!el || el.dataset.cod !== codN) return; // el usuario ya abrió otro equipo

  const cab = html`<div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:8px;font-size:12px">
    <span>horómetro según tarja: <strong>${_tarjaNum(d.horom_tarja)}</strong></span>
    <span>última tarja: <strong>${d.ultima_tarja || '—'}</strong>${d.ultimo_operador ? ' · ' + d.ultimo_operador : ''}</span>
  </div>`;
  const fallas = d.fallas.length ? html`<div style="margin:6px 0 10px;padding:8px 10px;border-radius:8px;background:var(--ambar-suave);font-size:12px">
    <strong>fallas abiertas del checklist (${d.fallas.length})</strong>
    ${d.fallas.map(f => html`<div style="margin-top:4px">${f.fecha} · ${f.item}${f.comentario ? ' — ' + f.comentario : ''}${f.foto ? html` · <a href="${f.foto}" target="_blank" rel="noopener">foto</a>` : ''}</div>`)}
  </div>` : '';
  const filas = d.tarjas.map(t => html`<tr>
    <td>${t.fecha}</td>
    <td>${t.operador}${t.cierre_tercero === 'SI' ? html` <span style="color:var(--ambar-texto)">(cerró otro)</span>` : ''}</td>
    <td style="text-align:right;font-variant-numeric:tabular-nums">${_tarjaNum(t.horom_ini)} → ${_tarjaNum(t.horom_fin)}</td>
    <td style="text-align:right;font-variant-numeric:tabular-nums">${t.estado === 'cerrada' ? html`<strong>${_tarjaNum(t.horas)}</strong>` : t.estado}</td>
    <td>${t.foto_horom_ini ? html`<a href="${t.foto_horom_ini}" target="_blank" rel="noopener">ini</a>` : ''} ${t.foto_horom_fin ? html`<a href="${t.foto_horom_fin}" target="_blank" rel="noopener">fin</a>` : ''}</td>
  </tr>`);
  const tabla = d.tarjas.length
    ? html`<div style="overflow-x:auto"><table class="svc-mini" style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr><th style="text-align:left">fecha</th><th style="text-align:left">operario</th><th style="text-align:right">horómetro</th><th style="text-align:right">horas</th><th style="text-align:left">fotos</th></tr></thead>
        <tbody>${filas}</tbody></table></div>`
    : html`<div style="font-size:12px;color:var(--text3)">Todavía no tiene jornadas cargadas.</div>`;
  setHTML(el, html`${cab}${fallas}${tabla}`);
}

/* ───────── pestaña mapa ───────── */

let _mapaFlota = null;
let _mapaCapa = null;
// Antigüedad del último reporte: teal = hoy, azul = esta semana, ámbar = más antiguo (tokens comunes).
const _MAPA_TOKEN = { hoy: 'teal', semana: 'azul', viejo: 'ambar' };

function _antiguedadPos(tsPos) {
  if (!tsPos) return 'viejo';
  const f = String(tsPos).slice(0, 10);
  const hoy = new Date();
  const a = Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10));
  const b = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const d = Math.round((b - a) / 86400000);
  return d <= 0 ? 'hoy' : d <= 7 ? 'semana' : 'viejo';
}

function _el(tag, attrs, hijos) {
  const e = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (k === 'style') e.style.cssText = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
  });
  (hijos || []).forEach(h => { if (h) e.appendChild(typeof h === 'string' ? document.createTextNode(h) : h); });
  return e;
}

async function renderMapaTab() {
  const cont = document.getElementById('mapaFlota');
  const estado = document.getElementById('mapaEstado');
  if (!cont) return;
  if (typeof L === 'undefined') { estado.textContent = 'No se pudo cargar el mapa (sin conexión con el CDN).'; return; }
  if (!_mapaFlota) {
    _mapaFlota = L.map(cont, { attributionControl: false, zoomControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(_mapaFlota);
    _mapaCapa = L.layerGroup().addTo(_mapaFlota);
    _mapaFlota.setView([-26.83, -65.22], 8);
  }
  setTimeout(() => _mapaFlota.invalidateSize(), 60);
  estado.textContent = 'cargando posiciones…';
  let d;
  try { d = await tarjaFetch('publico_mapa'); }
  catch (e) { estado.textContent = 'No se pudo leer la tarja: ' + e.message; return; }
  _mapaCapa.clearLayers();
  const limites = [];
  d.puntos.forEach(p => {
    const ant = _antiguedadPos(p.ts_pos);
    const pin = _el('div', { class: 'mapa-pin' }, [
      _el('span', { class: 'mapa-punto', style: 'background:' + _igColor(_MAPA_TOKEN[ant]) }),
      p.codigo
    ]);
    const icono = L.divIcon({ className: 'mapa-pin-wrap', html: pin, iconSize: null, iconAnchor: [10, 10] });
    const pop = _el('div', { style: 'font-size:12px;line-height:1.5' }, [
      _el('strong', { style: 'font-size:14px', text: p.codigo }), _el('br'),
      p.descripcion || '', _el('br'),
      p.lugar ? 'Obra: ' + p.lugar : '', p.lugar ? _el('br') : null,
      p.operador ? 'Operario: ' + p.operador : '', p.operador ? _el('br') : null,
      p.horom_tarja !== '' && p.horom_tarja != null ? 'Horómetro: ' + _tarjaNum(p.horom_tarja) + ' hs' : '', _el('br'),
      'Posición del ' + String(p.ts_pos || '').slice(0, 16)
    ]);
    L.marker([p.lat, p.lon], { icon: icono }).bindPopup(pop).addTo(_mapaCapa);
    limites.push([p.lat, p.lon]);
  });
  if (limites.length) _mapaFlota.fitBounds(limites, { padding: [30, 30], maxZoom: 14 });
  estado.textContent = limites.length
    ? `${limites.length} equipo${limites.length === 1 ? '' : 's'} con posición. Se actualiza con cada foto de horómetro de la tarja.`
    : 'Todavía ningún equipo mandó una foto con GPS desde la tarja.';
}
