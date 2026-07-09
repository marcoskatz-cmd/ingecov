# Tab "Conservar vs Reemplazar" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar al panel INGECOV un tab analítico que compara el costo mensual de conservar un equipo vs. comprar uno 0km y emite un veredicto CONSERVAR/REEMPLAZAR.

**Architecture:** Motor de decisión (funciones puras de Marcos) embebido en `js/app.js`, alimentado por un form. Al elegir equipo se autoprellenan campos desde globales del panel (`_costosCorrPorMes`, `_horasCorrPorMesYEquipo`, `_costosCfg`); el resto es manual con defaults. Estado en memoria + `localStorage`. UX con namespace propio `rep-*`, separada del dashboard.

**Tech Stack:** HTML/CSS vanilla + JS ES modules-free (IIFE-style app.js). Sin build, sin libs nuevas. Patrones obligatorios del panel: `setHTML`/`html` (Trusted Types), delegación `data-action` (CSP estricta, sin `onclick` inline).

**Spec:** `docs/superpowers/specs/2026-07-08-reemplazo-equipo-design.md`

---

## File Structure

- **Modify** `index.html`:
  - `#tabBar` (~línea 1645): botón nuevo del tab.
  - Tras `#tabService` (~línea 1800): panel `#tabReemplazo` con `#repRoot`.
  - `<style>` (~línea 514, junto a los estilos de tabs): bloque `rep-*`.
- **Modify** `js/app.js`:
  - Antes del `const ACTIONS` (~línea 4370): bloque completo del tab (motor + render + estado + acciones).
  - `setTab` (línea 1723): hook de carga perezosa.
  - `ACTIONS` (~línea 4374): entradas nuevas.

Todo el JS del tab vive en un solo bloque contiguo comentado `// ─── TAB CONSERVAR vs REEMPLAZAR ───` para mantenerlo aislado y legible.

**Convenciones existentes reutilizadas:** `_fmtARS(n)` (línea 3623), `formatMoney`, `normCod`, `setHTML`, `html`, `RawHTML`, `_equiposOrdenados`, `cargarCostosDowntime`.

---

## Task 1: Motor de cálculo (funciones puras)

**Files:**
- Modify: `js/app.js` (insertar antes de `const ACTIONS`, ~línea 4370)

- [ ] **Step 1: Insertar el bloque del motor**

Insertar al inicio del bloque nuevo `// ─── TAB CONSERVAR vs REEMPLAZAR ───`. Es la matemática de Marcos, con `CONFIG` convertida en parámetro `c`:

```javascript
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
```

- [ ] **Step 2: Validar sintaxis**

Run: `node --check js/app.js`
Expected: sin salida (exit 0).

- [ ] **Step 3: Smoke test del motor con los valores originales**

Run:
```bash
node -e "$(cat <<'EOF'
const src = require('fs').readFileSync('js/app.js','utf8');
const m = src.match(/function _repValorHora[\s\S]*?function _repEvaluar[\s\S]*?\n\}/);
eval(m[0]);
const CONFIG={mesesHorizonte:6,costos:{neumaticos:6034661.57,serviceOficial:3254674.95,fallaTotal:4815053.41,itemsUnicos:3156738.05},horas:{improductivasViejo:68,serviceYGomas:20},alquilerMensual:10000000,horasProductivasMes:164,factorServiceNoOficial:1/3,dolar:1480,nuevo:{precioUSD:180000,residualPct:0.5,vidaUtilAnios:10,tasaAnual:0,tradeInPct:0.5,plazoFinancMeses:24,reparacionesMensual:0},modosFalla:[{nombre:'Caja',p:.08,costo:15000000},{nombre:'Motor',p:.04,costo:25000000},{nombre:'Diferencial',p:.05,costo:9000000},{nombre:'Turbo',p:.08,costo:5000000},{nombre:'Embrague',p:.06,costo:4000000}]};
const r=_repEvaluar(CONFIG);
console.log('decision', r.decision, 'neto', Math.round(r.netoMensual), 'riesgoMes', Math.round(r.riesgo.mensual), 'cuota', Math.round(r.cuotaMensual));
EOF
)"
```
Expected: imprime una línea con `decision`, `neto`, `riesgoMes`, `cuota` (números finitos). Confirma que las funciones evalúan sin error y son autoconsistentes. Anotar el `decision` obtenido como baseline para la verificación en browser de la Task 4.

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat(reemplazo): motor de decision conservar vs reemplazar"
```

---

## Task 2: Markup del tab + estilos rep-*

**Files:**
- Modify: `index.html` (`#tabBar`, tras `#tabService`, `<style>`)

- [ ] **Step 1: Agregar el botón del tab en `#tabBar`**

Tras la línea del botón de service (~1645), agregar:

```html
      <button class="tab-btn" data-action="setTab" data-arg="tabReemplazo">conservar vs reemplazar<span class="tab-badge" id="reemplazoBadge">—</span></button>
```

- [ ] **Step 2: Agregar el panel del tab**

Después del cierre de `#tabService` (`</div>` de la línea ~1800) y antes del `</div>` que cierra el contenedor de tabs (~1802):

```html
    <div class="tab-panel" id="tabReemplazo">
      <div class="rep-console" id="repRoot">cargando…</div>
    </div>
```

- [ ] **Step 3: Agregar el bloque de estilos rep-***

En el `<style>`, tras los estilos de `.tab-panel` (~línea 516), insertar:

```css
  /* ───────────────────────────────────────────────────────────────
     TAB CONSERVAR vs REEMPLAZAR · estética de planilla analítica,
     deliberadamente distinta del dashboard (sin telemetria-card). */
  .rep-console{max-width:920px;margin:0 auto;font-size:13px;color:var(--text);}
  .rep-head{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;
    padding:14px 16px;border:1px solid var(--border);border-radius:10px;background:var(--bg2);margin-bottom:14px;}
  .rep-head-title{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--text3);}
  .rep-select{font-size:13px;padding:7px 10px;border:1px solid var(--border);border-radius:8px;
    background:var(--bg);color:var(--text);min-width:220px;}
  .rep-fieldset{border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:14px;background:var(--bg2);}
  .rep-legend{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--text3);margin-bottom:10px;}
  .rep-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;}
  .rep-row{display:flex;flex-direction:column;gap:3px;}
  .rep-row label{font-size:11px;color:var(--text2);}
  .rep-row .rep-unit{color:var(--text3);}
  .rep-input{font-size:13px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;
    background:var(--bg);color:var(--text);font-variant-numeric:tabular-nums;text-align:right;}
  .rep-input.rep-derived{border-color:var(--blue);}
  .rep-hint{font-size:11px;color:var(--text3);margin-top:4px;}
  .rep-warn{font-size:11px;color:var(--amber);margin-top:6px;}
  /* Modos de falla */
  .rep-falla-table{width:100%;border-collapse:collapse;font-size:12px;}
  .rep-falla-table th{text-align:left;font-size:10px;letter-spacing:.1em;text-transform:uppercase;
    color:var(--text3);padding:4px 6px;border-bottom:1px solid var(--border);}
  .rep-falla-table td{padding:4px 6px;}
  .rep-falla-table .rep-input{width:100%;}
  .rep-falla-del{cursor:pointer;color:var(--text3);border:none;background:none;font-size:15px;padding:0 4px;}
  .rep-falla-del:hover{color:var(--red);}
  .rep-btn{cursor:pointer;font-size:12px;padding:5px 11px;border:1px solid var(--border);border-radius:7px;
    background:var(--bg);color:var(--text2);}
  .rep-btn:hover{color:var(--text);border-color:var(--accent);}
  /* Resultado */
  .rep-verdict{padding:16px;border-radius:10px;text-align:center;margin-bottom:14px;border:1px solid var(--border);}
  .rep-verdict.conservar{background:color-mix(in srgb,var(--green) 12%,transparent);border-color:var(--green);}
  .rep-verdict.reemplazar{background:color-mix(in srgb,var(--amber) 12%,transparent);border-color:var(--amber);}
  .rep-verdict-word{font-size:26px;font-weight:700;letter-spacing:.04em;}
  .rep-verdict.conservar .rep-verdict-word{color:var(--green);}
  .rep-verdict.reemplazar .rep-verdict-word{color:var(--amber);}
  .rep-verdict-sub{font-size:13px;color:var(--text2);margin-top:4px;}
  .rep-ledger{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;}
  .rep-ledger-col{border:1px solid var(--border);border-radius:10px;padding:12px 14px;background:var(--bg2);}
  .rep-ledger-col h4{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);margin:0 0 8px;}
  .rep-line{display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0;font-variant-numeric:tabular-nums;}
  .rep-line span:last-child{color:var(--text);}
  .rep-line.rep-sub{border-top:1px solid var(--border);margin-top:6px;padding-top:7px;font-weight:600;}
  .rep-metrics{display:grid;grid-template-columns:repeat(2,1fr);gap:8px 18px;font-size:12.5px;
    border:1px solid var(--border);border-radius:10px;padding:12px 14px;background:var(--bg2);
    font-variant-numeric:tabular-nums;}
  .rep-metrics .rep-line span:first-child{color:var(--text2);}
  @media (max-width:640px){
    .rep-grid{grid-template-columns:1fr;}
    .rep-ledger{grid-template-columns:1fr;}
    .rep-metrics{grid-template-columns:1fr;}
  }
```

- [ ] **Step 2/verif: sin ruptura de HTML**

Servir local y confirmar que el tab "conservar vs reemplazar" aparece en la barra y muestra "cargando…" al abrirlo (todavía no hay JS de render — es esperado).

Run: `python -m http.server 8765` (en la raíz del clon), abrir `http://localhost:8765`, click en el tab.
Expected: el botón aparece; el panel dice "cargando…"; Console sin errores CSP.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(reemplazo): markup del tab y estilos rep-*"
```

---

## Task 3: Render del form + hook de setTab + wiring de ACTIONS

**Files:**
- Modify: `js/app.js` (bloque del tab; `setTab` línea 1723; `ACTIONS` ~4374)

- [ ] **Step 1: Defaults y estado**

Agregar al bloque del tab, después del motor:

```javascript
const REP_LS_KEY = 'ingecov_reemplazo_v1';
const REP_MANUAL = '__manual__';

function _repDefaults(){
  return {
    codN: null,
    mesesHorizonte: 6,
    costos: { neumaticos: 0, serviceOficial: 0, fallaTotal: 0, itemsUnicos: 0 },
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
```

- [ ] **Step 2: renderReemplazo() — dropdown + fieldsets + área de resultado**

Agregar. Puebla el dropdown desde `_equiposOrdenados`; el form se dibuja desde `_repState`.

```javascript
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
      const nom = e.nombre ? ' · '+e.nombre : '';
      return `<option value="${codN}"${sel}>${e.codigo}${nom}</option>`;
    })).join('');

  setHTML(root, new RawHTML(`
    <div class="rep-head">
      <div class="rep-head-title">conservar vs reemplazar · modelo de decisión</div>
      <select class="rep-select" id="repEquipoSel" data-action="repSelectEquipo" data-event="change">${opciones}</select>
    </div>
    <div id="repForm"></div>
    <div id="repResult"></div>
  `));
  _repRenderForm();
  repRecalc();
}
```

- [ ] **Step 3: _repRenderForm() — dibuja inputs desde _repState**

```javascript
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
      <td><input class="rep-input" style="text-align:left" id="rep_falla_nombre_${i}" type="text" value="${f.nombre}" data-action="repRecalc" data-event="input"></td>
      <td><input class="rep-input" id="rep_falla_p_${i}" type="number" step="0.01" value="${f.p}" data-action="repRecalc" data-event="input"></td>
      <td><input class="rep-input" id="rep_falla_costo_${i}" type="number" value="${f.costo}" data-action="repRecalc" data-event="input"></td>
      <td><button class="rep-falla-del" data-action="repDelFalla" data-arg="${i}" title="Quitar">×</button></td>
    </tr>`).join('');

  setHTML(cont, new RawHTML(`
    <div class="rep-fieldset">
      <div class="rep-legend">Equipo actual · período con datos${warn?'':''}</div>
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
```

- [ ] **Step 4: Hook en setTab (línea 1723)**

Reemplazar la función `setTab` por:

```javascript
function setTab(id,t){
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.id===id));
  document.querySelectorAll('#tabBar .tab-btn').forEach(b=>
    b.classList.toggle('active', b===t || b.dataset.arg===id));
  if(id==='tabTelemetria'&&_chartComboFlota){try{_chartComboFlota.resize();}catch(_){}}
  if(id==='tabReemplazo'){ renderReemplazo(); }
}
```

- [ ] **Step 5: Registrar acciones en el map ACTIONS (~4374)**

Agregar dentro del objeto `ACTIONS`:

```javascript
  repSelectEquipo:               (arg, t) => repSelectEquipo(t.value),
  repRecalc:                     () => repRecalc(),
  repAddFalla:                   () => repAddFalla(),
  repDelFalla:                   (arg) => repDelFalla(+arg),
  repReset:                      () => repReset(),
```

> Nota: agregar stubs vacíos `function repSelectEquipo(){}` `function repRecalc(){}` `function repAddFalla(){}` `function repDelFalla(){}` `function repReset(){}` al final del bloque del tab si se ejecuta esta task antes que la Task 4, para que `node --check` pase. La Task 4 los reemplaza por la implementación real.

- [ ] **Step 6: Validar sintaxis y render base**

Run: `node --check js/app.js` → exit 0.
Servir local, abrir el tab: aparece el dropdown poblado con los equipos, los tres fieldsets con inputs, la tabla de modos de falla con 5 filas. Console limpia. (Aún no recalcula ni prellena — Task 4.)

- [ ] **Step 7: Commit**

```bash
git add js/app.js
git commit -m "feat(reemplazo): render del form, dropdown y wiring de acciones"
```

---

## Task 4: Estado interactivo — prellenado, recálculo, persistencia

**Files:**
- Modify: `js/app.js` (reemplaza los stubs de la Task 3 por implementación real)

- [ ] **Step 1: repSelectEquipo — deriva del panel + overlay localStorage**

```javascript
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
```

- [ ] **Step 2: repReadForm — reconstruye _repState desde el DOM**

```javascript
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
```

- [ ] **Step 3: repRecalc — evalúa, pinta el resultado, persiste, actualiza badge**

```javascript
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
```

- [ ] **Step 4: node --check**

Run: `node --check js/app.js` → exit 0.

- [ ] **Step 5: Verificación en browser (end-to-end)**

Servir local, abrir el tab:
1. Elegir un equipo con datos correctivos conocidos (mirar el tab **costos downtime**: tomar un código y su "Acum. período" de repuestos). En el tab de reemplazo, `Falla total` autoprellenada debe coincidir con ese acumulado, y `Meses de horizonte` con la cantidad de meses del período.
2. El resultado se pinta al instante (veredicto + dos libros mayores + métricas).
3. Editar `Precio 0km` o un modo de falla → recalcula en vivo; el veredicto cambia de lado al cruzar el break-even.
4. Recargar la página (Ctrl+F5), reabrir el tab, reelegir el mismo equipo → los overrides persisten.
5. Elegir "manual / sin equipo" → campos en default editables, sin crash.
6. Equipo sin alquiler → aparece la advertencia ámbar, oportunidad en 0, sin error.
7. Console sin errores CSP ni Trusted Types.

- [ ] **Step 6: Commit**

```bash
git add js/app.js
git commit -m "feat(reemplazo): prellenado desde panel, recalculo en vivo y persistencia"
```

---

## Task 5: Modos de falla dinámicos + reset

**Files:**
- Modify: `js/app.js` (reemplaza stubs `repAddFalla`/`repDelFalla`/`repReset`)

- [ ] **Step 1: Implementar las tres acciones**

```javascript
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
function repReset(){
  const codN = _repState.codN;
  const all = _repLoadLS();
  delete all[codN || REP_MANUAL];
  try{ localStorage.setItem(REP_LS_KEY, JSON.stringify(all)); }catch(_){}
  _repState = codN ? _repDerivarEquipo(codN) : _repDefaults();
  _repRenderForm();
  repRecalc();
}
```

- [ ] **Step 2: node --check**

Run: `node --check js/app.js` → exit 0.

- [ ] **Step 3: Verificación en browser**

1. "+ modo de falla" agrega una fila; editar sus valores recalcula el riesgo.
2. "×" en una fila la quita; el riesgo baja acorde.
3. "↻ restaurar defaults del equipo" descarta overrides y vuelve a los valores derivados del panel (o defaults si es manual).
4. Console limpia.

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat(reemplazo): modos de falla dinamicos y reset de overrides"
```

---

## Task 6: Verificación final + graph update

**Files:** ninguno (verificación)

- [ ] **Step 1: Checklist completo del spec (sección Testing)**

Recorrer los 9 puntos de verificación del spec en el browser, tema claro y oscuro. Cualquier discrepancia entre `Falla total`/`improductivas` del tab y lo que muestra el tab de costos = revisar el mapeo de `_repDerivarEquipo` (no parchear números a mano).

- [ ] **Step 2: node --check final**

Run: `node --check js/app.js` → exit 0.

- [ ] **Step 3: Actualizar el knowledge graph**

Run: `graphify update .`

- [ ] **Step 4: Confirmar con Marcos antes de pushear**

NO pushear sin OK explícito. Mostrar el resultado (screenshot del tab funcionando) y esperar aprobación. Recordar: si se pushea, GitHub Pages redeploya en 1-3 min; `sw.js` no cambió (sin assets nuevos), así que no hace falta bumpear `CACHE_VERSION`.

---

## Self-Review

**Spec coverage:**
- UX separada (rep-*) → Task 2 (CSS) ✓
- Motor intacto como cfg param → Task 1 ✓
- Markup tab + badge → Task 2, badge actualizado en Task 4 ✓
- repState + estructura → Task 3 ✓
- Autoprellenado (mapeo tabla) → Task 4 `_repDerivarEquipo` ✓
- Manual/defaults → Task 3 `_repDefaults` ✓
- Sin alquiler → warning en `_repRenderForm` (Task 3), oportunidad 0 en derivar (Task 4) ✓
- Persistencia localStorage → Task 3 (helpers) + Task 4 (save) + Task 5 (reset borra) ✓
- Resultado (veredicto/ledger/métricas) → Task 4 `repRecalc` ✓
- Modos falla editables → Task 3 (render) + Task 5 (add/del) ✓
- Opción manual → Task 4 `repSelectEquipo` ✓
- setTab hook + ACTIONS → Task 3 ✓
- CSP/Trusted Types (setHTML/data-action) → todas las tasks usan setHTML/RawHTML ✓
- Verificación manual (9 puntos) → Task 6 ✓

**Placeholder scan:** el único stub declarado (Task 3 Step 5) se reemplaza explícitamente en Tasks 4-5; documentado. Sin TBD/TODO.

**Type consistency:** `_repState` shape idéntico en `_repDefaults`, `_repDerivarEquipo`, `repReadForm`, y consumido por `_repEvaluar` (mismos paths `costos.*`, `horas.*`, `nuevo.*`, `modosFalla[]`). Ids de inputs (`rep_*`) coinciden entre `_repRenderForm` (escritura) y `repReadForm` (lectura). Nombres de acciones coinciden entre HTML `data-action`, `ACTIONS` y funciones.
