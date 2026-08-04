/* ══════════════════════════════════════════════════════════════════
   07-auditoria.js — parte 7/8 de la app del panel INGECO.
   Los 8 archivos son SCRIPTS CLÁSICOS que comparten el mismo scope
   global y se cargan EN ORDEN (defer) desde index.html: mover uno de
   lugar rompe las dependencias. No convertir a type=module sin
   revisar ACTIONS y el bootstrap del PIN.
══════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════
   AUDITORÍA DE CARGAS · modal con PIN validado SERVER-SIDE
   El panel no tiene ni el PIN ni los datos: los sirve la webapp de
   refresh (?ep=audit&pin=…) leyendo un Script Property privado que
   escribe el builder (_auditar_) en cada rebuild. Acá solo UI + fetch.
═══════════════════════════════════════════════════════════════════ */
const AUD_REGLAS={
  R1:'Código no coincide con patente/serie',
  R2:'Horómetro retrocede en el tiempo',
  R3:'Próximo service mal calculado',
  R4:'RESUMEN de service desactualizado',
  R5:'Pipeline del snapshot',
  R6:'Código inexistente en LISTA DE EQUIPOS',
};
let _audPin=null;
function abrirAuditoria(){
  const ov=document.getElementById('audOverlay'); if(!ov)return;
  ov.classList.add('open'); document.body.style.overflow='hidden';
  _audPin=sessionStorage.getItem('_audPin')||null;
  if(_audPin)_audFetch(); else _audAskPin();
}
function cerrarAuditoria(){
  const ov=document.getElementById('audOverlay'); if(!ov)return;
  ov.classList.remove('open'); document.body.style.overflow='';
}
function _audAskPin(msg){
  const body=document.getElementById('audBody'); if(!body)return;
  const meta=document.getElementById('audMeta'); if(meta)meta.textContent='';
  setHTML(body, html`<div style="display:flex;flex-direction:column;gap:10px;align-items:center;padding:26px 0">
    ${msg?html`<div style="color:var(--red);font-size:12px">${msg}</div>`:''}
    <div style="display:flex;gap:8px">
      <input id="audPinInput" type="password" inputmode="numeric" maxlength="12" placeholder="PIN de auditoría" autocomplete="off"
        style="background:transparent;border:1px solid var(--border);color:var(--text);padding:8px 12px;font-size:14px;width:170px;letter-spacing:2px"/>
      <button class="refresh-btn" data-action="audSubmitPin">ver</button>
    </div>
    <div style="font-size:11px;color:var(--text3)">se valida en el servidor · el PIN no está en esta página</div>
  </div>`);
  const inp=document.getElementById('audPinInput');
  if(inp){inp.focus();inp.addEventListener('keydown',ev=>{if(ev.key==='Enter')audSubmitPin();});}
}
function audSubmitPin(){
  const inp=document.getElementById('audPinInput');
  const v=inp?String(inp.value||'').trim():'';
  if(!v)return;
  _audPin=v;_audFetch();
}
async function _audFetch(){
  const body=document.getElementById('audBody'); if(!body)return;
  setHTML(body, html`<div style="padding:30px;text-align:center;color:var(--text3);font-size:13px">consultando…</div>`);
  try{
    const r=await fetch(REFRESH_URL+'?ep=audit&pin='+encodeURIComponent(_audPin));
    const j=await r.json();
    if(!j.ok){
      sessionStorage.removeItem('_audPin');_audPin=null;
      _audAskPin(j.error==='pin'?'PIN incorrecto':'Error del servidor: '+(j.error||'desconocido'));
      return;
    }
    sessionStorage.setItem('_audPin',_audPin);
    _audRender(j.audit);
  }catch(e){
    setHTML(body, html`<div style="padding:24px;text-align:center;color:var(--red);font-size:13px">No se pudo consultar la auditoría: ${(e&&e.message)||e}</div>`);
  }
}
function _audRender(a){
  const body=document.getElementById('audBody'), meta=document.getElementById('audMeta');
  if(!body)return;
  if(!a){setHTML(body, html`<div style="padding:24px;text-align:center;color:var(--text3)">La auditoría todavía no corrió — esperá el próximo build del snapshot (30 min) o tocá sync.</div>`);return;}
  const f=new Date(a.at);
  if(meta)meta.textContent=' · '+a.total+' hallazgos · calculada '+f.toLocaleString('es-AR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  if(!a.findings||!a.findings.length){
    setHTML(body, html`<div style="padding:30px;text-align:center;color:var(--green);font-size:14px">✓ Sin inconsistencias detectadas</div>`);
    return;
  }
  const grupos={};
  a.findings.forEach(x=>{(grupos[x.r]=grupos[x.r]||[]).push(x);});
  const bloques=Object.keys(grupos).sort().map(r=>{
    const rows=grupos[r].map(x=>html`<div style="padding:7px 10px;border-bottom:1px solid var(--border);font-size:12px;line-height:1.5">
      <span class="mono" style="color:var(--accent);font-weight:600">${x.codigo||'—'}</span>
      <span style="color:var(--text3)"> · ${x.fuente}${x.fila?' fila '+x.fila:''}</span><br>
      <span>${x.msg}</span>
      <span style="color:var(--text3);font-size:11px"> · desde ${x.desde||'—'}</span>
    </div>`);
    return html`<div style="margin-bottom:14px">
      <div style="font-size:12px;font-weight:700;letter-spacing:.4px;margin-bottom:4px;color:var(--text2)">${r} · ${AUD_REGLAS[r]||''} <span style="color:var(--text3);font-weight:400">(${grupos[r].length})</span></div>
      <div style="border:1px solid var(--border)">${rows}</div>
    </div>`;
  });
  setHTML(body, html`${bloques}${a.truncado?html`<div style="color:var(--text3);font-size:11px;padding-top:4px">lista truncada — corregí lo visible y el resto aparece en el próximo build</div>`:''}`);
}

// ═══════════════════════════════════════════════════════════════════
// ─── TAB CONSERVAR vs REEMPLAZAR ───
// Modelo de decisión de recambio de equipo. Motor = funciones puras
// (matemática de Marcos, jul-2026). Todo en ARS; `dolar` convierte USD.
// ═══════════════════════════════════════════════════════════════════

function _repValorHora(c){ return c.alquilerMensual / c.horasProductivasMes; }

function _repCostoViejo(c){
  const m = c.mesesHorizonte || 1;
  const service        = c.costos.serviceOficial * c.factorServiceNoOficial / m;
  const fallaCorriente = (c.costos.fallaTotal - c.costos.itemsUnicos) / m;
  const neumaticos     = c.costos.neumaticos / m;
  const oportunidad    = c.horas.improductivasViejo * _repValorHora(c) / m;
  return { service, fallaCorriente, neumaticos, oportunidad,
           total: service + fallaCorriente + neumaticos + oportunidad };
}

function _repCostoNuevo(c){
  const m           = c.mesesHorizonte || 1;
  const residualUSD = c.nuevo.precioUSD * c.nuevo.residualPct;
  const vidaMeses   = c.nuevo.vidaUtilAnios * 12;
  const capFinanciado = c.nuevo.precioUSD * (1 - c.nuevo.tradeInPct);
  const interesMensual = c.nuevo.tasaAnual > 0
    ? capFinanciado * (1 + c.nuevo.residualPct) / 2 * c.nuevo.tasaAnual / 12 * c.dolar
    : 0;
  const depreciacion = (c.nuevo.precioUSD - residualUSD) / vidaMeses * c.dolar;
  const service      = c.costos.serviceOficial / m;
  const reparaciones = c.nuevo.reparacionesMensual;
  const neumaticos   = c.costos.neumaticos / m;
  const oportunidad  = c.horas.serviceYGomas * _repValorHora(c) / m;
  return { depreciacion, interesMensual, service, reparaciones, neumaticos, oportunidad,
           total: depreciacion + interesMensual + service + reparaciones + neumaticos + oportunidad };
}

function _repRiesgoCola(c){
  const anual = c.modosFalla.reduce((s,f)=> s + (f.p||0) * (f.costo||0), 0);
  return { anual, mensual: anual / 12 };
}

function _repVidaBreakEven(c){
  const viejo  = _repCostoViejo(c);
  const riesgo = _repRiesgoCola(c);
  const viejoTotal = viejo.total + riesgo.mensual;
  const residualUSD = c.nuevo.precioUSD * c.nuevo.residualPct;
  const m = c.mesesHorizonte || 1;
  const nuevoSinDep = c.costos.serviceOficial / m + c.nuevo.reparacionesMensual
                    + c.costos.neumaticos / m + c.horas.serviceYGomas * _repValorHora(c) / m;
  const depNecesaria = viejoTotal - nuevoSinDep;
  if (depNecesaria <= 0) return Infinity;
  return (c.nuevo.precioUSD - residualUSD) * c.dolar / (depNecesaria * 12);
}

function _repEvaluar(c){
  const viejo  = _repCostoViejo(c);
  const nuevo  = _repCostoNuevo(c);
  const riesgo = _repRiesgoCola(c);
  const viejoTotal  = viejo.total + riesgo.mensual;
  const nuevoTotal  = nuevo.total;
  const netoMensual = nuevoTotal - viejoTotal;
  const umbralRiesgoMensual = nuevo.total - viejo.total;
  const cuotaMensual = c.nuevo.precioUSD * (1 - c.nuevo.tradeInPct)
                     / c.nuevo.plazoFinancMeses * c.dolar;
  return {
    viejo, nuevo, riesgo, viejoTotal, nuevoTotal, netoMensual,
    decision: netoMensual > 0 ? 'CONSERVAR' : 'REEMPLAZAR',
    umbralRiesgoMensual,
    umbralRiesgoAnual: umbralRiesgoMensual * 12,
    factorEscalaRiesgo: riesgo.anual > 0 ? (umbralRiesgoMensual * 12) / riesgo.anual : Infinity,
    cuotaMensual,
    vidaBreakEvenAnios: _repVidaBreakEven(c),
  };
}

const REP_LS_KEY = 'ingecov_reemplazo_v1';
const REP_MANUAL = '__manual__';

function _repDefaults(){
  return {
    codN: null,
    mesesHorizonte: 6,
    costos: { neumaticos: 0, serviceOficial: 0, fallaTotal: 0, itemsUnicos: 0 },
    itemsUnicosSel: [], neumaticosSel: [],
    horas:  { improductivasViejo: 0, serviceYGomas: 0 },
    alquilerMensual: 0, horasProductivasMes: 176, factorServiceNoOficial: 1/3, dolar: 1400,
    nuevo: { precioUSD: 180000, residualPct: 0.5, vidaUtilAnios: 10, tasaAnual: 0,
             tradeInPct: 0.5, plazoFinancMeses: 24, reparacionesMensual: 0 },
    modosFalla: [
      { nombre:'Caja', p:0.08, costo:15000000 },
      { nombre:'Motor', p:0.04, costo:25000000 },
      { nombre:'Diferencial', p:0.05, costo:9000000 },
      { nombre:'Turbo/inyección', p:0.08, costo:5000000 },
      { nombre:'Embrague pesado', p:0.06, costo:4000000 },
    ],
  };
}
let _repState = _repDefaults();

function _repLoadLS(){ try{ return JSON.parse(localStorage.getItem(REP_LS_KEY)||'{}'); }catch(_){ return {}; } }
function _repSaveLS(){
  try{
    const all = _repLoadLS();
    all[_repState.codN || REP_MANUAL] = _repState;
    localStorage.setItem(REP_LS_KEY, JSON.stringify(all));
  }catch(_){}
}

async function renderReemplazo(){
  const root = document.getElementById('repRoot');
  if(!root) return;
  if(!window._costosCfg){ try{ await cargarCostosDowntime(); }catch(_){}}

  const equipos = (window._equiposOrdenados||[])
    .filter(e=>e.codigo)
    .sort((a,b)=>String(a.codigo).localeCompare(String(b.codigo),'es'));
  const opciones = [`<option value="${REP_MANUAL}">— manual / sin equipo —</option>`]
    .concat(equipos.map(e=>{
      const codN = normCod(e.codigo);
      const sel = _repState.codN===codN ? ' selected' : '';
      const nom = e.nombre ? ' · '+esc(e.nombre) : '';
      return `<option value="${codN}"${sel}>${esc(e.codigo)}${nom}</option>`;
    })).join('');

  setHTML(root, new RawHTML(`
    <div class="rep-head">
      <div class="rep-head-title">conservar vs reemplazar · modelo de decisión</div>
      <select class="rep-select" id="repEquipoSel" data-action="repSelectEquipo" data-event="change">${opciones}</select>
    </div>
    <div class="rep-toolbar">
      <button class="rep-btn" id="repGuideBtn" data-action="toggleRepGuide">ⓘ cómo usar esto</button>
      <button class="rep-btn primary" data-action="repDescargarPDF">⭳ descargar PDF del análisis</button>
    </div>
    <div class="rep-guide" id="repGuide" style="display:none"><div class="rep-guide-body">${_repInstructivoHTML()}</div></div>
    <div id="repForm"></div>
    <div id="repResult"></div>
  `));
  _repRenderForm();
  repRecalc();
}

function toggleRepGuide(){
  const g=document.getElementById('repGuide');
  const b=document.getElementById('repGuideBtn');
  if(!g)return;
  const open=g.style.display==='none';
  g.style.display=open?'':'none';
  if(b)b.textContent=open?'ⓘ ocultar instructivo':'ⓘ cómo usar esto';
}

// Instructivo de uso — qué va en cada campo y por qué. String HTML estático
// (sin datos de usuario), se envuelve en RawHTML en renderReemplazo.
function _repInstructivoHTML(){
  return `
    <p>Esta herramienta compara, <b>en ARS por mes</b>, lo que cuesta <b>seguir</b> con el equipo actual contra <b>comprar uno 0km</b>, y te dice cuál conviene. El costo de seguir incluye reparaciones, service, gomas, el equipo parado y el riesgo de una falla mayor; el de comprar incluye la depreciación, el interés de la financiación y los gastos del 0km.</p>
    <div class="g-tip">Elegí un equipo en el desplegable de arriba: los campos con borde azul y etiqueta <span class="g-auto">del panel</span> se completan solos con los datos reales del panel. Los campos en blanco son supuestos que cargás vos. Todo lo que edites queda guardado por equipo en este navegador.</div>

    <h5>Paso 1 · Equipo actual</h5>
    <ul>
      <li><b>Meses de horizonte</b> <span class="g-auto">del panel</span> — cuántos meses de datos se están promediando. Se autocompleta con la cantidad de meses que tienen gasto correctivo cargado. Sirve para pasar los montos acumulados a promedio mensual. Solo tocalo si querés forzar otro período.</li>
      <li><b>Falla total (repuestos correctivos)</b> <span class="g-auto">del panel</span> — suma de todos los repuestos correctivos del equipo (sin neumáticos), tomada del tab costos downtime. Es la base del gasto de reparaciones.</li>
      <li><b>Ítems únicos a excluir</b> — repuestos grandes que <b>no se van a repetir</b> (un eje que ya se cambió, una rotura puntual). Se <b>restan</b> de la falla total para no proyectar al futuro un gasto irrepetible. Usá el selector de entregas de abajo para tildarlos: la suma se carga sola acá.</li>
      <li><b>Service oficial</b> — lo que sale un service en concesionario. Para el 0km se paga completo; para el usado se ajusta con el factor de más abajo.</li>
      <li><b>Neumáticos</b> — gasto en cubiertas del equipo. Tildalas en el selector de abajo.</li>
      <li><b>Horas improductivas (correctivo)</b> <span class="g-auto">del panel</span> — horas que el equipo estuvo parado por reparación. Valorizan el tiempo fuera de servicio (costo de oportunidad) del equipo actual.</li>
      <li><b>Horas service+gomas</b> — horas por mes que el 0km igual estaría parado por su service y cambio de gomas. Es la oportunidad "inevitable" del equipo nuevo.</li>
      <li><b>Alquiler mensual</b> <span class="g-auto">del panel</span> — cuánto cuesta alquilar un equipo equivalente por mes. Es la base para valorizar cada hora parada. Sale de la pestaña ALQUILERES × dólar. Si el equipo no tiene alquiler cargado, aparece un aviso y lo podés poner a mano.</li>
      <li><b>Horas productivas/mes</b> — horas que el equipo puede trabajar en el mes (default 176). Es el divisor para sacar el valor de una hora.</li>
      <li><b>Factor service no oficial</b> — qué fracción del service oficial pagás en taller propio para el usado (default 1/3 ≈ 0,33). Refleja que al viejo no le hacés service de concesionario.</li>
      <li><b>Dólar</b> <span class="g-auto">del panel</span> — tipo de cambio para convertir los precios en USD (0km, alquiler).</li>
    </ul>

    <h5>Paso 2 · Selección de entregas (opcional pero recomendado)</h5>
    <ul>
      <li><b>Ítems únicos</b> — tildá las entregas correctivas que fueron gastos one-off; su suma se descuenta de la falla total.</li>
      <li><b>Neumáticos</b> — tildá las entregas de cubiertas; su suma se carga como gasto de neumáticos.</li>
    </ul>
    <p style="color:var(--text3)">Tildar acá evita tener que sumar a mano: el número entra solo en el campo de arriba.</p>

    <h5>Paso 3 · 0km + financiación</h5>
    <ul>
      <li><b>Precio 0km (USD)</b> — precio del equipo nuevo equivalente.</li>
      <li><b>Valor residual (0–1)</b> — qué fracción del precio recuperás al final de la vida útil (0,5 = te queda el 50%). Cuanto más alto, menos deprecia.</li>
      <li><b>Vida útil (años)</b> — sobre cuántos años se reparte la depreciación del 0km.</li>
      <li><b>Tasa anual financ. (0–1)</b> — interés de la financiación (0 = contado, 0,3 = 30% anual).</li>
      <li><b>Trade-in (0–1)</b> — qué fracción del precio cubrís entregando el usado como parte de pago (0,5 = la mitad).</li>
      <li><b>Plazo financ. (meses)</b> — en cuántas cuotas se financia el saldo. Afecta la cuota de flujo de caja, no el costo económico.</li>
      <li><b>Reparaciones/mes (ARS)</b> — reparaciones esperadas del 0km (normalmente bajo o cero los primeros años).</li>
    </ul>

    <h5>Paso 4 · Riesgo de cola (fallas mayores)</h5>
    <p>Cada fila es una falla grande posible (caja, motor, diferencial…). Cargá la <b>probabilidad anual</b> (0,08 = 8% de chance en el año) y el <b>costo</b> si ocurre. El modelo hace <b>probabilidad × costo</b> de cada una, las suma (riesgo esperado anual), lo pasa a mensual y lo agrega al costo de seguir. Agregá, editá o quitá modos según el estado real del equipo con <b>+ modo de falla</b> / la ✕.</p>

    <h5>Cómo leer el resultado</h5>
    <ul>
      <li><b>Veredicto</b> — CONSERVAR o REEMPLAZAR, con cuánto es la diferencia mensual.</li>
      <li><b>Las dos columnas</b> — el costo mensual de seguir vs. el de comprar, renglón por renglón.</li>
      <li><b>Neto mensual</b> — la diferencia entre ambos totales.</li>
      <li><b>Cuota</b> — el desembolso mensual de la cuota (flujo de caja); es otra cosa que el costo económico.</li>
      <li><b>Umbral de riesgo</b> — cuánto riesgo esperado por año haría falta para que convenga reemplazar.</li>
      <li><b>El riesgo debe escalar ×N</b> — cuántas veces más grande tendría que ser el riesgo que cargaste para dar vuelta la decisión. Si es ×5, hoy conservar gana con margen.</li>
      <li><b>Vida de indiferencia</b> — a cuántos años de vida útil del 0km da exactamente lo mismo seguir que comprar.</li>
    </ul>
    <div class="g-tip">Cuando termines de cargar todo, <b>⭳ descargar PDF del análisis</b> genera un informe imprimible con el veredicto, las dos columnas, las métricas, los supuestos usados y los modos de falla — listo para adjuntar o presentar.</div>`;
}

function _repInput(id, val, unit, step){
  const s = step!=null ? ` step="${step}"` : '';
  return `<div class="rep-row"><label>${unit||''}</label>`
       + `<input class="rep-input" id="${id}" type="number"${s} value="${val}" `
       + `data-action="repRecalc" data-event="input"></div>`;
}
function _repInputDerived(id, val, unit){
  return `<div class="rep-row"><label>${unit} <span class="rep-unit">(del panel)</span></label>`
       + `<input class="rep-input rep-derived" id="${id}" type="number" value="${val}" `
       + `data-action="repRecalc" data-event="input"></div>`;
}

// Filtra las entregas de un equipo por tipo para los pickers:
//   'neum' → items con neumático/cubierta/pinchadura
//   'corr' → correctivo NO neumático (las que alimentan fallaTotal)
function _repEntregasDe(codN, tipo){
  const list = (window._entregasPorEquipo||{})[codN]||[];
  return list.filter(e=>{
    const d = String(e.items||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
    const esNeum = d.includes('neumatic')||d.includes('cubierta')||d.includes('pinchad');
    if(tipo==='neum') return esNeum;
    return !esNeum && esCorrectivoCosto(e.razon, e.items);
  });
}
// Suma el costo de las entregas seleccionadas para un campo.
function _repSumEntregas(codN, selKey){
  const list = (window._entregasPorEquipo||{})[codN]||[];
  const sel = _repState[selKey]||[];
  let s=0;
  for(const e of list){ if(sel.includes(String(e.nro))) s+=(e.costo||0); }
  return Math.round(s);
}
// Widget de selección de entregas (checkbox → auto-suma al campo).
function _repEntregaPicker(field, codN){
  if(!codN) return '';
  const tipo = field==='neumaticos' ? 'neum' : 'corr';
  const selKey = field==='neumaticos' ? 'neumaticosSel' : 'itemsUnicosSel';
  const sel = _repState[selKey]||[];
  const list = _repEntregasDe(codN, tipo);
  if(!list.length){
    return `<div class="rep-picker-empty">Sin entregas ${tipo==='neum'?'de neumáticos':'correctivas'} registradas para este equipo.</div>`;
  }
  const rows = list.map(e=>{
    const nro = String(e.nro);
    const chk = sel.includes(nro) ? ' checked' : '';
    const snip = esc(String(e.items||'—').slice(0,70));
    return `<label class="rep-pick-row">`
         + `<input type="checkbox"${chk} data-action="repToggleEntrega" data-arg="${esc(field+':'+nro)}" data-event="change">`
         + `<span class="rep-pick-nro">N°${esc(nro)}</span>`
         + `<span class="rep-pick-fecha">${esc(String(e.fecha||'—'))}</span>`
         + `<span class="rep-pick-costo">${_fmtARS(e.costo||0)}</span>`
         + `<span class="rep-pick-items">${snip}</span>`
         + `</label>`;
  }).join('');
  return `<div class="rep-picker">${rows}</div>`;
}

function _repRenderForm(){
  const c = _repState;
  const cont = document.getElementById('repForm');
  if(!cont) return;
  const sinAlq = c.codN && window._costosCfg && window._costosCfg.alq[c.codN]==null;
  const warn = sinAlq
    ? `<div class="rep-warn">⚠ Este equipo no tiene alquiler cargado en el sheet (pestaña ALQUILERES). El costo de oportunidad no se computa; cargalo o completá "alquiler mensual" a mano.</div>`
    : '';
  const fallas = c.modosFalla.map((f,i)=>`
    <tr>
      <td><input class="rep-input" style="text-align:left" id="rep_falla_nombre_${i}" type="text" value="${esc(f.nombre)}" data-action="repRecalc" data-event="input"></td>
      <td><input class="rep-input" id="rep_falla_p_${i}" type="number" step="0.01" value="${f.p}" data-action="repRecalc" data-event="input"></td>
      <td><input class="rep-input" id="rep_falla_costo_${i}" type="number" value="${f.costo}" data-action="repRecalc" data-event="input"></td>
      <td><button class="rep-falla-del" data-action="repDelFalla" data-arg="${i}" title="Quitar">×</button></td>
    </tr>`).join('');

  setHTML(cont, new RawHTML(`
    <div class="rep-fieldset">
      <div class="rep-legend">Equipo actual · período con datos</div>
      <div class="rep-grid">
        ${_repInput('rep_mesesHorizonte', c.mesesHorizonte, 'Meses de horizonte')}
        ${_repInputDerived('rep_fallaTotal', c.costos.fallaTotal, 'Falla total (repuestos correctivos ARS)')}
        ${_repInput('rep_itemsUnicos', c.costos.itemsUnicos, 'Ítems únicos a excluir (ARS)')}
        ${_repInput('rep_serviceOficial', c.costos.serviceOficial, 'Service oficial (ARS)')}
        ${_repInput('rep_neumaticos', c.costos.neumaticos, 'Neumáticos (ARS)')}
        ${_repInputDerived('rep_improductivasViejo', c.horas.improductivasViejo, 'Horas improductivas (correctivo)')}
        ${_repInput('rep_serviceYGomas', c.horas.serviceYGomas, 'Horas service+gomas')}
        ${_repInputDerived('rep_alquilerMensual', c.alquilerMensual, 'Alquiler mensual (ARS)')}
        ${_repInput('rep_horasProductivasMes', c.horasProductivasMes, 'Horas productivas/mes')}
        ${_repInput('rep_factorServiceNoOficial', c.factorServiceNoOficial, 'Factor service no oficial', 0.01)}
        ${_repInputDerived('rep_dolar', c.dolar, 'Dólar (ARS/USD)')}
      </div>
      ${c.codN ? `
      <div class="rep-picker-block">
        <div class="rep-picker-legend">Ítems únicos a excluir · tildá entregas correctivas one-off (se restan de Falla total)</div>
        ${_repEntregaPicker('itemsUnicos', c.codN)}
      </div>
      <div class="rep-picker-block">
        <div class="rep-picker-legend">Neumáticos · tildá entregas de cubiertas (se suman al costo del equipo)</div>
        ${_repEntregaPicker('neumaticos', c.codN)}
      </div>` : ''}
      ${warn}
    </div>
    <div class="rep-fieldset">
      <div class="rep-legend">0km + financiación</div>
      <div class="rep-grid">
        ${_repInput('rep_precioUSD', c.nuevo.precioUSD, 'Precio 0km (USD)')}
        ${_repInput('rep_residualPct', c.nuevo.residualPct, 'Valor residual (0–1)', 0.05)}
        ${_repInput('rep_vidaUtilAnios', c.nuevo.vidaUtilAnios, 'Vida útil (años)')}
        ${_repInput('rep_tasaAnual', c.nuevo.tasaAnual, 'Tasa anual financ. (0–1)', 0.01)}
        ${_repInput('rep_tradeInPct', c.nuevo.tradeInPct, 'Trade-in (0–1)', 0.05)}
        ${_repInput('rep_plazoFinancMeses', c.nuevo.plazoFinancMeses, 'Plazo financ. (meses)')}
        ${_repInput('rep_reparacionesMensual', c.nuevo.reparacionesMensual, 'Reparaciones/mes (ARS)')}
      </div>
    </div>
    <div class="rep-fieldset">
      <div class="rep-legend">Riesgo de cola · modos de falla mayores</div>
      <table class="rep-falla-table">
        <thead><tr><th>Modo</th><th>Prob. anual</th><th>Costo (ARS)</th><th></th></tr></thead>
        <tbody>${fallas}</tbody>
      </table>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="rep-btn" data-action="repAddFalla">+ modo de falla</button>
        <button class="rep-btn" data-action="repReset">↻ restaurar defaults del equipo</button>
      </div>
    </div>
  `));
}

function _repDerivarEquipo(codN){
  const d = _repDefaults();
  d.codN = codN;
  const cfg = window._costosCfg;
  const corr = window._costosCorrPorMes || {};        // {ym:{codN:ARS}}
  const hCorr = window._horasCorrPorMesYEquipo || {};  // {ym:{codN:hr}}
  let fallaTotal = 0, horas = 0;
  const meses = new Set();
  for(const ym of Object.keys(corr)){
    const v = corr[ym][codN]; if(v){ fallaTotal += v; meses.add(ym); }
  }
  for(const ym of Object.keys(hCorr)){
    const v = hCorr[ym][codN]; if(v){ horas += v; meses.add(ym); }
  }
  d.costos.fallaTotal = Math.round(fallaTotal);
  d.horas.improductivasViejo = Math.round(horas*10)/10;
  d.mesesHorizonte = meses.size || 1;
  if(cfg){
    d.dolar = cfg.tc;
    d.horasProductivasMes = cfg.horasMes;
    const alqUSD = cfg.alq[codN];
    d.alquilerMensual = alqUSD!=null ? Math.round(alqUSD*cfg.tc) : 0;
  }
  return d;
}

function repSelectEquipo(val){
  if(val===REP_MANUAL){
    const saved = _repLoadLS()[REP_MANUAL];
    _repState = saved || _repDefaults();
    _repState.codN = null;
  }else{
    const codN = val;
    const derived = _repDerivarEquipo(codN);
    const saved = _repLoadLS()[codN];
    _repState = saved ? Object.assign(derived, saved, {codN}) : derived;
  }
  _repRenderForm();
  repRecalc();
}

function _repNum(id){ const el=document.getElementById(id); const v=el?parseFloat(el.value):NaN; return isFinite(v)?v:0; }
function _repStr(id){ const el=document.getElementById(id); return el?el.value:''; }

function repReadForm(){
  const c = _repState;
  c.mesesHorizonte        = _repNum('rep_mesesHorizonte') || 1;
  c.costos.fallaTotal     = _repNum('rep_fallaTotal');
  c.costos.itemsUnicos    = _repNum('rep_itemsUnicos');
  c.costos.serviceOficial = _repNum('rep_serviceOficial');
  c.costos.neumaticos     = _repNum('rep_neumaticos');
  c.horas.improductivasViejo = _repNum('rep_improductivasViejo');
  c.horas.serviceYGomas   = _repNum('rep_serviceYGomas');
  c.alquilerMensual       = _repNum('rep_alquilerMensual');
  c.horasProductivasMes   = _repNum('rep_horasProductivasMes') || 1;
  c.factorServiceNoOficial = _repNum('rep_factorServiceNoOficial');
  c.dolar                 = _repNum('rep_dolar');
  c.nuevo.precioUSD          = _repNum('rep_precioUSD');
  c.nuevo.residualPct        = _repNum('rep_residualPct');
  c.nuevo.vidaUtilAnios      = _repNum('rep_vidaUtilAnios') || 1;
  c.nuevo.tasaAnual          = _repNum('rep_tasaAnual');
  c.nuevo.tradeInPct         = _repNum('rep_tradeInPct');
  c.nuevo.plazoFinancMeses   = _repNum('rep_plazoFinancMeses') || 1;
  c.nuevo.reparacionesMensual = _repNum('rep_reparacionesMensual');
  c.modosFalla = c.modosFalla.map((_,i)=>({
    nombre: _repStr('rep_falla_nombre_'+i),
    p:      _repNum('rep_falla_p_'+i),
    costo:  _repNum('rep_falla_costo_'+i),
  }));
}

function repRecalc(){
  if(!document.getElementById('repResult')) return;
  repReadForm();
  const r = _repEvaluar(_repState);
  _repSaveLS();

  const f = _fmtARS;
  const cls = r.decision==='CONSERVAR' ? 'conservar' : 'reemplazar';
  const factor = isFinite(r.factorEscalaRiesgo) ? '×'+r.factorEscalaRiesgo.toFixed(2) : 'n/a';
  const vida = isFinite(r.vidaBreakEvenAnios) ? r.vidaBreakEvenAnios.toFixed(1)+' años' : 'a cualquier vida';
  const netoAbs = f(Math.abs(r.netoMensual));
  const sub = r.decision==='CONSERVAR'
    ? `Seguir cuesta ${netoAbs}/mes menos que comprar 0km.`
    : `Comprar 0km cuesta ${netoAbs}/mes menos que seguir.`;

  setHTML(document.getElementById('repResult'), new RawHTML(`
    <div class="rep-verdict ${cls}">
      <div class="rep-verdict-word">${r.decision}</div>
      <div class="rep-verdict-sub">${sub}</div>
    </div>
    <div class="rep-ledger">
      <div class="rep-ledger-col">
        <h4>Seguir con el actual · ARS/mes</h4>
        <div class="rep-line"><span>Service (no oficial)</span><span>${f(r.viejo.service)}</span></div>
        <div class="rep-line"><span>Falla corriente</span><span>${f(r.viejo.fallaCorriente)}</span></div>
        <div class="rep-line"><span>Neumáticos</span><span>${f(r.viejo.neumaticos)}</span></div>
        <div class="rep-line"><span>Oportunidad</span><span>${f(r.viejo.oportunidad)}</span></div>
        <div class="rep-line"><span>Riesgo esperado</span><span>${f(r.riesgo.mensual)}</span></div>
        <div class="rep-line rep-sub"><span>Total seguir</span><span>${f(r.viejoTotal)}</span></div>
      </div>
      <div class="rep-ledger-col">
        <h4>Comprar 0km · ARS/mes</h4>
        <div class="rep-line"><span>Depreciación</span><span>${f(r.nuevo.depreciacion)}</span></div>
        <div class="rep-line"><span>Interés financ.</span><span>${f(r.nuevo.interesMensual)}</span></div>
        <div class="rep-line"><span>Service oficial</span><span>${f(r.nuevo.service)}</span></div>
        <div class="rep-line"><span>Reparaciones</span><span>${f(r.nuevo.reparaciones)}</span></div>
        <div class="rep-line"><span>Neumáticos</span><span>${f(r.nuevo.neumaticos)}</span></div>
        <div class="rep-line"><span>Oportunidad</span><span>${f(r.nuevo.oportunidad)}</span></div>
        <div class="rep-line rep-sub"><span>Total comprar</span><span>${f(r.nuevoTotal)}</span></div>
      </div>
    </div>
    <div class="rep-metrics">
      <div class="rep-line"><span>Neto mensual</span><span>${f(r.netoMensual)}</span></div>
      <div class="rep-line"><span>Cuota 24m (flujo caja)</span><span>${f(r.cuotaMensual)}</span></div>
      <div class="rep-line"><span>Umbral de riesgo</span><span>${f(r.umbralRiesgoMensual)}/mes · ${f(r.umbralRiesgoAnual)}/año</span></div>
      <div class="rep-line"><span>El riesgo debe escalar</span><span>${factor}</span></div>
      <div class="rep-line"><span>Vida de indiferencia</span><span>${vida}</span></div>
    </div>
  `));

  const badge = document.getElementById('reemplazoBadge');
  if(badge) badge.textContent = r.decision==='CONSERVAR' ? 'conservar' : 'reemplazar';
}

function repAddFalla(){
  repReadForm();
  _repState.modosFalla.push({ nombre:'Nuevo modo', p:0.05, costo:1000000 });
  _repRenderForm();
  repRecalc();
}
function repDelFalla(i){
  repReadForm();
  _repState.modosFalla.splice(i,1);
  _repRenderForm();
  repRecalc();
}
function repToggleEntrega(arg){
  const i = arg.indexOf(':');
  const field = arg.slice(0,i);            // 'itemsUnicos' | 'neumaticos'
  const nro = arg.slice(i+1);
  const selKey = field==='neumaticos' ? 'neumaticosSel' : 'itemsUnicosSel';
  repReadForm();
  const sel = _repState[selKey] || (_repState[selKey]=[]);
  const idx = sel.indexOf(nro);
  if(idx>=0) sel.splice(idx,1); else sel.push(nro);
  _repState.costos[field] = _repSumEntregas(_repState.codN, selKey);
  _repRenderForm();
  repRecalc();
}
function repReset(){
  const codN = _repState.codN;
  const all = _repLoadLS();
  delete all[codN || REP_MANUAL];
  try{ localStorage.setItem(REP_LS_KEY, JSON.stringify(all)); }catch(_){}
  _repState = codN ? _repDerivarEquipo(codN) : _repDefaults();
  _repRenderForm();
  repRecalc();
}

/* PDF del análisis: arma un documento imprimible estático en #repPrintDoc y
   dispara window.print(). El navegador ofrece "Guardar como PDF" (PC y celular).
   CSP-safe: sin librerías externas ni document.write; solo setHTML + print(). */
function repDescargarPDF(){
  repReadForm();                      // volcar los inputs actuales a _repState
  const c = _repState;
  const r = _repEvaluar(c);
  _repBuildPrintDoc(c, r);
  window.print();
}

function _repBuildPrintDoc(c, r){
  const doc = document.getElementById('repPrintDoc');
  if(!doc) return;
  const fARS = n => '$ ' + fmtInt(n);
  const pct  = n => (Math.round(n*1000)/10).toLocaleString('es-AR') + '%';
  const eq = (window._equiposOrdenados||[]).find(e=>normCod(e.codigo)===c.codN);
  const equipoLabel = c.codN
    ? (eq ? (eq.codigo + (eq.nombre?' · '+eq.nombre:'')) : c.codN)
    : 'Manual / sin equipo';
  const d = new Date();
  const p2 = n => String(n).padStart(2,'0');
  const fecha = `${p2(d.getDate())}/${p2(d.getMonth()+1)}/${d.getFullYear()}`;
  const factor = isFinite(r.factorEscalaRiesgo) ? '×'+r.factorEscalaRiesgo.toFixed(2) : 'n/a';
  const vida   = isFinite(r.vidaBreakEvenAnios) ? r.vidaBreakEvenAnios.toFixed(1)+' años' : 'a cualquier vida';
  const netoAbs = fARS(Math.abs(r.netoMensual));
  const sub = r.decision==='CONSERVAR'
    ? `Seguir cuesta ${netoAbs}/mes menos que comprar 0km.`
    : `Comprar 0km cuesta ${netoAbs}/mes menos que seguir.`;

  const fallasRows = c.modosFalla.map(f=>
    `<tr><td>${esc(f.nombre||'—')}</td><td class="n">${pct(f.p||0)}</td><td class="n">${fARS(f.costo||0)}</td><td class="n">${fARS((f.p||0)*(f.costo||0))}</td></tr>`
  ).join('');

  const supuestos = [
    ['Meses de horizonte', String(c.mesesHorizonte)],
    ['Dólar (ARS/USD)', fmtInt(c.dolar)],
    ['Alquiler mensual', fARS(c.alquilerMensual)],
    ['Horas productivas/mes', String(c.horasProductivasMes)],
    ['Factor service no oficial', (Math.round(c.factorServiceNoOficial*100)/100).toLocaleString('es-AR')],
    ['Precio 0km (USD)', 'US$ '+fmtInt(c.nuevo.precioUSD)],
    ['Valor residual', pct(c.nuevo.residualPct)],
    ['Vida útil', c.nuevo.vidaUtilAnios+' años'],
    ['Tasa anual financ.', pct(c.nuevo.tasaAnual)],
    ['Trade-in', pct(c.nuevo.tradeInPct)],
    ['Plazo financiación', c.nuevo.plazoFinancMeses+' meses'],
    ['Reparaciones 0km/mes', fARS(c.nuevo.reparacionesMensual)],
  ].map(([k,v])=>`<tr><td>${k}</td><td class="n">${v}</td></tr>`).join('');

  const html_ = `
    <div class="pd-h1">Análisis conservar vs reemplazar</div>
    <div class="pd-meta">Equipo: <b>${esc(equipoLabel)}</b> · Período analizado: ${c.mesesHorizonte} ${c.mesesHorizonte===1?'mes':'meses'} · Generado el ${fecha} · Panel INGECO</div>

    <div class="pd-verdict">
      <div class="w">${r.decision}</div>
      <div class="s">${sub}</div>
    </div>

    <h2>Costo mensual comparado (ARS/mes)</h2>
    <div class="pd-two">
      <table>
        <tr><th>Seguir con el actual</th><th class="n"></th></tr>
        <tr><td>Service (no oficial)</td><td class="n">${fARS(r.viejo.service)}</td></tr>
        <tr><td>Falla corriente</td><td class="n">${fARS(r.viejo.fallaCorriente)}</td></tr>
        <tr><td>Neumáticos</td><td class="n">${fARS(r.viejo.neumaticos)}</td></tr>
        <tr><td>Oportunidad (parado)</td><td class="n">${fARS(r.viejo.oportunidad)}</td></tr>
        <tr><td>Riesgo esperado</td><td class="n">${fARS(r.riesgo.mensual)}</td></tr>
        <tr class="tot"><td>Total seguir</td><td class="n">${fARS(r.viejoTotal)}</td></tr>
      </table>
      <table>
        <tr><th>Comprar 0km</th><th class="n"></th></tr>
        <tr><td>Depreciación</td><td class="n">${fARS(r.nuevo.depreciacion)}</td></tr>
        <tr><td>Interés financiación</td><td class="n">${fARS(r.nuevo.interesMensual)}</td></tr>
        <tr><td>Service oficial</td><td class="n">${fARS(r.nuevo.service)}</td></tr>
        <tr><td>Reparaciones</td><td class="n">${fARS(r.nuevo.reparaciones)}</td></tr>
        <tr><td>Neumáticos</td><td class="n">${fARS(r.nuevo.neumaticos)}</td></tr>
        <tr><td>Oportunidad (service+gomas)</td><td class="n">${fARS(r.nuevo.oportunidad)}</td></tr>
        <tr class="tot"><td>Total comprar</td><td class="n">${fARS(r.nuevoTotal)}</td></tr>
      </table>
    </div>

    <h2>Métricas de decisión</h2>
    <table>
      <tr><td>Neto mensual (comprar − seguir)</td><td class="n">${fARS(r.netoMensual)}</td></tr>
      <tr><td>Cuota mensual (flujo de caja)</td><td class="n">${fARS(r.cuotaMensual)}</td></tr>
      <tr><td>Umbral de riesgo para reemplazar</td><td class="n">${fARS(r.umbralRiesgoMensual)}/mes · ${fARS(r.umbralRiesgoAnual)}/año</td></tr>
      <tr><td>El riesgo debe escalar</td><td class="n">${factor}</td></tr>
      <tr><td>Vida de indiferencia del 0km</td><td class="n">${vida}</td></tr>
    </table>

    <h2>Riesgo de cola · modos de falla mayores</h2>
    <table>
      <tr><th>Modo</th><th class="n">Prob. anual</th><th class="n">Costo</th><th class="n">Esperado/año</th></tr>
      ${fallasRows}
      <tr class="tot"><td>Riesgo esperado total</td><td class="n"></td><td class="n"></td><td class="n">${fARS(r.riesgo.anual)}</td></tr>
    </table>

    <h2>Supuestos usados</h2>
    <table>${supuestos}</table>

    <div class="pd-foot">
      <b>Metodología.</b> Todos los importes en ARS/mes. <b>Seguir</b> = service no oficial (service oficial × factor) + falla corriente (repuestos correctivos − ítems únicos) + neumáticos + oportunidad (horas paradas × valor-hora) + riesgo esperado (Σ prob × costo ÷ 12). <b>Comprar</b> = depreciación ((precio − residual) ÷ vida útil) + interés de financiación + service oficial + reparaciones + neumáticos + oportunidad inevitable. <b>Valor-hora</b> = alquiler mensual ÷ horas productivas/mes. La decisión compara ambos totales; el <b>umbral de riesgo</b> indica cuánto debería crecer la probabilidad de falla mayor para invertir el resultado.
      <br>Informe generado automáticamente por el Panel de Mantenimiento INGECO. Los supuestos de financiación y 0km son editables en el tab y quedan guardados por equipo.
    </div>`;

  setHTML(doc, new RawHTML(html_));
}
