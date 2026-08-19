/* ══════════════════════════════════════════════════════════════════
   06-tabs.js — parte 6/8 de la app del panel INGECO.
   Los 8 archivos son SCRIPTS CLÁSICOS que comparten el mismo scope
   global y se cargan EN ORDEN (defer) desde index.html: mover uno de
   lugar rompe las dependencias. No convertir a type=module sin
   revisar ACTIONS y el bootstrap del PIN.
══════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════
   COSTOS DOWNTIME · tab con costo mensual correctivo en USD
   Tres componentes por mes y por equipo (solo trabajos/entregas CORRECTIVOS,
   mismo clasificador que el resto del panel: Reparación + Neumáticos):
     · repuestos:   COSTO ENTREGA (ARS) / tipo de cambio
     · mano de obra: hr TIEMPO TRABAJO × tarifa MO (ARS/h) / tipo de cambio
     · oportunidad: hr TIEMPO PARADA / hs disponibles mes × alquiler USD/mes
   Parámetros y alquileres viven en el sheet COSTOS DOWNTIME (SHEET_IDS.costos),
   editable por Marcos. Se lee DIRECTO por gviz (sin snapshot) para que un
   cambio de precio impacte con solo recargar el panel.
═══════════════════════════════════════════════════════════════════ */
async function cargarCostosDowntime(){
  const cont=document.getElementById('costosParams');
  try{
    const[paramRows,alqRows]=await Promise.all([
      fetchGvizObj(SHEET_IDS.costos,'PARAMETROS'),
      fetchGvizObj(SHEET_IDS.costos,'ALQUILERES'),
    ]);
    // Defaults acordados jul-2026; el sheet los pisa si están cargados.
    const cfg={tc:1400,moArsH:6800,horasMes:176,alq:{}};
    for(const r of paramRows){
      const k=String(_pickCol(r,['PARAMETRO','PARÁMETRO'])||'').toUpperCase();
      const v=parseMoney(String(_pickCol(r,['VALOR'])||''));
      if(!v)continue;
      if(k.includes('CAMBIO'))cfg.tc=v;
      else if(k.includes('TARIFA'))cfg.moArsH=v;
      else if(k.includes('HORAS'))cfg.horasMes=v;
    }
    for(const r of alqRows){
      const codN=normCod(String(_pickCol(r,['CODIGO','CÓDIGO'])||''));
      const usd=parseMoney(String(_pickCol(r,['ALQUILER_USD_MES','ALQUILER USD MES','ALQUILER'])||''));
      if(codN&&usd>0)cfg.alq[codN]=usd;
    }
    window._costosCfg=cfg;
    renderCostosDowntime();
  }catch(e){
    console.warn('[INGECO] costos downtime:',e);
    if(cont)setHTML(cont,html`<span style="color:var(--red)">No se pudo leer el sheet COSTOS DOWNTIME (${e.message||e}).</span><br>Verificá que esté compartido como «cualquiera con el enlace puede ver» y recargá con el botón de abajo.<br><br><button class="refresh-btn" data-action="cargarCostosDowntime">↻ reintentar</button>`);
  }
}

// Montos del tab de costos en ARS. formatMoney abrevia ($2.4M / $850K);
// para celdas de tabla queremos el número completo con miles es-AR.
const _fmtARS=n=>'$ '+Math.round(n).toLocaleString('es-AR');

function renderCostosDowntime(){
  const cfg=window._costosCfg;
  if(!cfg)return;
  const nomMes=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  const repCorr=window._costosCorrPorMes||{};        // {ym:{codN: ARS}}
  // Horas de mantenimiento correctivo (TIEMPO TRABAJO): alimentan MO y también
  // el costo de oportunidad. Definición de Marcos (jul-2026) — TIEMPO PARADA
  // se descartó porque el taller lo carga en 0 en casi todos los registros.
  const hCorr  =window._horasCorrPorMesYEquipo||{};  // {ym:{codN: hr correctivas}}

  const _anioAct=new Date().getFullYear();
  const yms=[...new Set([...Object.keys(repCorr),...Object.keys(hCorr)])]
    .filter(ym=>/^\d{4}-\d{2}$/.test(ym)&&+ym.slice(0,4)>=2020&&+ym.slice(0,4)<=_anioAct+1)
    .sort();
  const labels=yms.map(ym=>{const[y,mm]=ym.split('-');return`${nomMes[+mm-1]}'${y.slice(2)}`;});

  // Series por mes (ARS) + acumulado por equipo para el ranking.
  // Repuestos y MO son ARS nativos; la oportunidad convierte el alquiler
  // (USD/mes del sheet) a ARS con el tipo de cambio.
  const serRep=[],serMo=[],serOp=[];
  const porEquipo={};       // codN → {rep,mo,op,total}
  const sinAlq=new Set();   // equipos con horas de parada pero sin alquiler cargado
  const acc=(codN,campo,ars)=>{
    porEquipo[codN]=porEquipo[codN]||{rep:0,mo:0,op:0,total:0};
    porEquipo[codN][campo]+=ars;porEquipo[codN].total+=ars;
  };
  for(const ym of yms){
    let rep=0,mo=0,op=0;
    for(const[codN,ars]of Object.entries(repCorr[ym]||{})){rep+=ars;acc(codN,'rep',ars);}
    for(const[codN,hr]of Object.entries(hCorr[ym]||{})){
      const u=hr*cfg.moArsH;mo+=u;acc(codN,'mo',u);
      // Oportunidad con las MISMAS horas correctivas: hs / hs-mes × alquiler × TC
      const alq=cfg.alq[codN];
      if(!alq){if(hr>0)sinAlq.add(codN);continue;}
      const o=hr/cfg.horasMes*alq*cfg.tc;op+=o;acc(codN,'op',o);
    }
    serRep.push(Math.round(rep));serMo.push(Math.round(mo));serOp.push(Math.round(op));
  }
  const totRep=serRep.reduce((s,v)=>s+v,0);
  const totMo =serMo.reduce((s,v)=>s+v,0);
  const totOp =serOp.reduce((s,v)=>s+v,0);
  const totAll=totRep+totMo+totOp;
  const nMeses=yms.length||1;

  // Resumen arriba del chart + badge del tab
  const totalsEl=document.getElementById('costosTotals');
  if(totalsEl){
    const periodo=yms.length?(labels[0]===labels[labels.length-1]?labels[0]:`${labels[0]}–${labels[labels.length-1]}`):'';
    setHTML(totalsEl,yms.length
      ?html`promedio mensual <span class="v-costo">${_fmtARS(totAll/nMeses)}</span><span class="sep">·</span>acumulado ${periodo} <span class="v-costo">${_fmtARS(totAll)}</span><span class="sep">·</span>repuestos ${Math.round(totRep/totAll*100)||0}% · MO ${Math.round(totMo/totAll*100)||0}% · oportunidad ${Math.round(totOp/totAll*100)||0}%`
      :'sin datos correctivos para graficar');
  }
  const badge=document.getElementById('costosBadge');
  if(badge)badge.textContent=yms.length?formatMoney(totAll/nMeses)+'/mes':'—';

  // Tabla: costo mensual operativo por equipo, ordenada de mayor a menor.
  // Click en una fila → despliega debajo el gráfico mes a mes de ese equipo.
  // (El chart mensual de flota se sacó a pedido de Marcos — jul-2026; las
  // series serRep/serMo/serOp siguen calculadas por si se reincorpora.)
  const _eqByCodN=codN=>(window._equiposOrdenados||[]).find(e=>normCod(e.codigo)===codN);
  const filas=Object.entries(porEquipo)
    .filter(([,v])=>v.total>0)
    .sort((a,b)=>b[1].total-a[1].total);
  // Contexto para el gráfico desplegable (toggleCostoEquipo)
  window._costosYms=yms;
  window._costosYmLabels=labels;
  _cerrarCostoChart(); // si la tabla se re-renderiza, el chart abierto muere con ella
  const tablaEl=document.getElementById('costosTablaWrap');
  if(tablaEl){
    if(!filas.length){
      setHTML(tablaEl,'Sin datos correctivos.');
    }else{
      const cuerpo=filas.map(([codN,v],i)=>{
        const eq=_eqByCodN(codN);
        const codDisplay=eq?eq.codigo:codN;
        const nombre=eq?(eq.nombre||''):'';
        const conAlq=cfg.alq[codN]!=null;
        const opCell=conAlq
          ?html`<td style="text-align:right">${_fmtARS(v.op/nMeses)}</td>`
          :html`<td style="text-align:right;color:var(--text3)" title="Sin alquiler cargado en el sheet — costo de oportunidad no computable">N/A</td>`;
        return html`<tr id="costoRow_${codN}" data-action="toggleCostoEquipo" data-arg="${codN}" style="cursor:pointer" title="Ver gasto mensual del equipo">
          <td style="color:var(--text3)">${String(i+1).padStart(2,'0')}</td>
          <td class="mono" style="white-space:nowrap"><b>${codDisplay}</b> <span class="eq-chev" id="costoChev_${codN}">▸</span></td>
          <td>${nombre}</td>
          <td style="text-align:right">${_fmtARS(v.rep/nMeses)}</td>
          <td style="text-align:right">${_fmtARS(v.mo/nMeses)}</td>
          ${opCell}
          <td style="text-align:right;color:var(--amber)"><b>${_fmtARS(v.total/nMeses)}</b></td>
          <td style="text-align:right;color:var(--text3)">${_fmtARS(v.total)}</td>
        </tr>`.value;
      }).join('');
      setHTML(tablaEl,new RawHTML(`<div class="table-wrap"><table class="eq-inner-table">
        <thead><tr>
          <th>#</th><th>Código</th><th>Equipo</th>
          <th style="text-align:right">Repuestos /mes</th>
          <th style="text-align:right">Mano obra /mes</th>
          <th style="text-align:right">Oportunidad /mes</th>
          <th style="text-align:right">TOTAL ARS/mes</th>
          <th style="text-align:right">Acum. período</th>
        </tr></thead>
        <tbody>${cuerpo}</tbody>
      </table></div>`));
    }
  }

  // Card de parámetros: valores vigentes + advertencias + link para editar
  const paramsEl=document.getElementById('costosParams');
  if(paramsEl){
    const nAlq=Object.keys(cfg.alq).length;
    const sinAlqArr=[...sinAlq].sort();
    const sinAlqTxt=sinAlqArr.length
      ?html`<br><span style="color:var(--amber)">⚠ ${String(sinAlqArr.length)} equipos con horas correctivas pero SIN alquiler cargado (oportunidad no computada): ${sinAlqArr.slice(0,12).map(c=>{const eq=_eqByCodN(c);return eq?eq.codigo:c;}).join(', ')}${sinAlqArr.length>12?'…':''}. Cargalos en la pestaña ALQUILERES.</span>`
      :new RawHTML('');
    setHTML(paramsEl,html`
      <b>Tipo de cambio:</b> ${cfg.tc.toLocaleString('es-AR')} ARS/USD ·
      <b>Mano de obra:</b> ${cfg.moArsH.toLocaleString('es-AR')} ARS/h ·
      <b>Hs disp./mes:</b> ${String(cfg.horasMes)} ·
      <b>Alquileres cargados:</b> ${String(nAlq)} equipos<br>
      <b>Criterio correctivo:</b> RAZÓN = Reparación. Neumáticos EXCLUIDOS de este cálculo (en el KPI de horas del panel siguen contando como correctivo).<br>
      <b>Moneda:</b> todos los montos en ARS. Repuestos y mano de obra son ARS nativos; el tipo de cambio se usa solo para pasar el alquiler (USD/mes del sheet) a ARS en el costo de oportunidad.<br>
      <b>Oportunidad:</b> hs de mantenimiento correctivo (las mismas de MO) / ${String(cfg.horasMes)} hs × alquiler mensual × TC. No incluye esperas de repuestos ni traslados → es un piso, no el tiempo total fuera de servicio.${sinAlqTxt}<br><br>
      <a href="https://docs.google.com/spreadsheets/d/${SHEET_IDS.costos}/edit" target="_blank" rel="noopener noreferrer" style="color:var(--blue);text-decoration:none">Editar parámetros y alquileres ↗</a> ·
      <a style="color:var(--blue);cursor:pointer" data-action="cargarCostosDowntime">↻ releer sheet</a>`);
  }
}

/* ── Gráfico desplegable: gasto mensual de UN equipo ──────────────────
   Click en una fila de la tabla → se inserta una fila debajo con un chart
   de barras apiladas (repuestos + MO + oportunidad, USD) mes a mes.
   Un solo chart abierto a la vez. Segundo click en la misma fila: colapsa. */
let _costoChartEq=null;   // instancia Chart abierta
let _costoChartCod=null;  // codN de la fila expandida

function _cerrarCostoChart(){
  if(_costoChartEq){try{_costoChartEq.destroy();}catch(_){}_costoChartEq=null;}
  const row=document.getElementById('costoChartRow');
  if(row)row.remove();
  if(_costoChartCod){
    const chev=document.getElementById('costoChev_'+_costoChartCod);
    if(chev)chev.textContent='▸';
  }
  _costoChartCod=null;
}

/* Desglose "de dónde sale cada gasto y cómo se calculó" para UN equipo.
   Reconstruye los 3 componentes a partir de los MISMOS line items que
   alimentaron los totales (entregasCorrPorEquipo + trabajosCorrPorEquipo,
   capturados con idéntico predicado esCorrectivoCosto), así los subtotales
   cierran exacto con la fila de la tabla. Devuelve RawHTML. */
function _costoBreakdownHTML(codN, cfg, yms){
  const fARS=n=>'$ '+fmtInt(n);
  const fHs=n=>Number(n).toLocaleString('es-AR',{maximumFractionDigits:1});
  const ymsSet=new Set(yms);
  const nMeses=yms.length||1;
  const M=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const periodo=(()=>{const a=yms[0],b=yms[yms.length-1];const lab=y=>{const[yy,mm]=y.split('-');return M[+mm-1]+"'"+yy.slice(2);};return a===b?lab(a):lab(a)+'–'+lab(b);})();

  const entregas=((window._entregasCorrPorEquipo||{})[codN]||[])
    .filter(e=>ymsSet.has(e.ym)).slice().sort((a,b)=>String(a.ym).localeCompare(b.ym));
  const trabajos=((window._trabajosCorrPorEquipo||{})[codN]||[])
    .filter(t=>ymsSet.has(t.ym)).slice().sort((a,b)=>String(a.ym).localeCompare(b.ym));

  const repTotal=entregas.reduce((s,e)=>s+e.costo,0);
  const hsTotal =trabajos.reduce((s,t)=>s+t.hs,0);
  const moTotal =hsTotal*cfg.moArsH;
  const alq=cfg.alq[codN];
  const opTotal=(alq!=null)?(hsTotal/cfg.horasMes*alq*cfg.tc):null;
  const total=repTotal+moTotal+(opTotal||0);

  const secStyle='background:var(--bg3);border:1px solid var(--border);margin-bottom:10px';
  const headStyle='padding:8px 12px;border-bottom:1px solid var(--border);background:var(--bg2);font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:600;letter-spacing:.04em';
  const formulaStyle='padding:8px 12px;font-family:\'IBM Plex Mono\',monospace;font-size:12px;color:var(--text)';
  const noteStyle='padding:0 12px 8px;font-size:11px;color:var(--text3);line-height:1.5';
  const liWrap='max-height:190px;overflow:auto;border-top:1px solid var(--border)';
  const liRow='display:grid;grid-template-columns:70px 1fr auto;gap:10px;padding:5px 12px;border-bottom:1px solid var(--border);font-size:11.5px;align-items:baseline';

  // ① Repuestos
  const repItems = entregas.length
    ? entregas.map(e=>html`<div style="${new RawHTML(liRow)}">
        <span class="mono" style="color:var(--text3)">${e.fecha}</span>
        <span>${e.items}${e.nro&&e.nro!=='—'?html` <span style="color:var(--text3)">· Nº ${e.nro}</span>`:''}${e.nEquipos>1?html` <span style="color:var(--text3)" title="Entrega imputada a ${e.nEquipos} equipos: se reparte en partes iguales">· 1/${e.nEquipos}</span>`:''}</span>
        <span class="mono" style="text-align:right;white-space:nowrap">${new RawHTML(fARS(e.costo))}</span>
      </div>`)
    : [html`<div style="${new RawHTML(liRow)};color:var(--text3)">Sin entregas correctivas en el período.</div>`];

  // ② Mano de obra
  const moItems = trabajos.length
    ? trabajos.map(t=>html`<div style="${new RawHTML(liRow)}">
        <span class="mono" style="color:var(--text3)">${t.fecha}</span>
        <span>${t.desc}</span>
        <span class="mono" style="text-align:right;white-space:nowrap">${new RawHTML(fHs(t.hs))} hs</span>
      </div>`)
    : [html`<div style="${new RawHTML(liRow)};color:var(--text3)">Sin horas correctivas registradas.</div>`];

  return html`
  <div style="margin-bottom:14px">
    <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text2);margin-bottom:10px;letter-spacing:.03em">
      CÓMO SE CALCULA · ${periodo} · ${String(nMeses)} ${nMeses===1?'mes':'meses'} · todos los importes en ARS
    </div>

    <div style="${new RawHTML(secStyle)}">
      <div style="${new RawHTML(headStyle)};color:var(--amber)">① REPUESTOS · ${new RawHTML(fARS(repTotal))}</div>
      <div style="${new RawHTML(noteStyle)};padding-top:8px">Suma de las entregas de repuestos con RAZÓN = Reparación (neumáticos excluidos). Importe en ARS nativo, sin conversión.</div>
      <div style="${new RawHTML(liWrap)}">${repItems}</div>
    </div>

    <div style="${new RawHTML(secStyle)}">
      <div style="${new RawHTML(headStyle)};color:var(--corp,#5d80e8)">② MANO DE OBRA · ${new RawHTML(fARS(moTotal))}</div>
      <div style="${new RawHTML(formulaStyle)}">${new RawHTML(fHs(hsTotal))} hs correctivas × ${new RawHTML(fARS(cfg.moArsH))}/h = <b>${new RawHTML(fARS(moTotal))}</b></div>
      <div style="${new RawHTML(noteStyle)}">Horas de TIEMPO TRABAJO de las reparaciones (mismas que alimentan la oportunidad). Tarifa editable en el sheet COSTOS DOWNTIME.</div>
      <div style="${new RawHTML(liWrap)}">${moItems}</div>
    </div>

    <div style="${new RawHTML(secStyle)}">
      <div style="${new RawHTML(headStyle)};color:var(--red)">③ OPORTUNIDAD · ${opTotal!=null?new RawHTML(fARS(opTotal)):'N/A'}</div>
      ${opTotal!=null
        ? html`<div style="${new RawHTML(formulaStyle)}">(${new RawHTML(fHs(hsTotal))} hs ÷ ${String(cfg.horasMes)} hs/mes) × US$ ${new RawHTML(fmtInt(alq))}/mes × ${new RawHTML(fmtInt(cfg.tc))} ARS/US$ = <b>${new RawHTML(fARS(opTotal))}</b></div>
           <div style="${new RawHTML(noteStyle)}">Lucro cesante: la fracción del mes que el equipo estuvo parado por reparación, valuada al alquiler mensual. Único componente que usa el tipo de cambio (el alquiler está en USD).</div>`
        : html`<div style="${new RawHTML(noteStyle)};padding-top:8px;color:var(--amber)">Sin alquiler cargado para este equipo en la pestaña ALQUILERES → no se computa. Cargá su alquiler mensual (USD) para incluir el lucro cesante.</div>`}
    </div>

    <div style="background:var(--bg2);border:1px solid var(--border);padding:10px 12px;font-family:'IBM Plex Mono',monospace;font-size:12px">
      <span style="color:var(--text3)">TOTAL ${periodo} =</span>
      ${new RawHTML(fARS(repTotal))} <span style="color:var(--text3)">+</span> ${new RawHTML(fARS(moTotal))} <span style="color:var(--text3)">+</span> ${opTotal!=null?new RawHTML(fARS(opTotal)):'0'}
      <span style="color:var(--text3)">=</span> <b style="color:var(--amber)">${new RawHTML(fARS(total))}</b>
      <span style="color:var(--text3)"> · promedio ${new RawHTML(fARS(total/nMeses))}/mes</span>
    </div>
  </div>`;
}

function toggleCostoEquipo(codN){
  if(typeof Chart==='undefined')return;
  const mismo=(_costoChartCod===codN);
  _cerrarCostoChart();
  if(mismo)return; // era un colapso
  const filaEq=document.getElementById('costoRow_'+codN);
  const cfg=window._costosCfg;
  const yms=window._costosYms||[];
  if(!filaEq||!cfg||!yms.length)return;

  // Series mensuales del equipo desde los mapas correctivos globales.
  // ARS: repuestos y MO nativos; oportunidad usa las MISMAS horas correctivas
  // que la MO y convierte el alquiler USD→ARS con el TC.
  const repCorr=window._costosCorrPorMes||{};
  const hCorr=window._horasCorrPorMesYEquipo||{};
  const alq=cfg.alq[codN];
  const dRep=yms.map(ym=>Math.round((repCorr[ym]||{})[codN]||0));
  const dMo =yms.map(ym=>Math.round(((hCorr[ym]||{})[codN]||0)*cfg.moArsH));
  const dOp =yms.map(ym=>alq?Math.round(((hCorr[ym]||{})[codN]||0)/cfg.horasMes*alq*cfg.tc):0);

  // Fila nueva debajo de la del equipo, con canvas creado por DOM API (CSP-safe)
  const tr=document.createElement('tr');
  tr.id='costoChartRow';
  const td=document.createElement('td');
  td.colSpan=filaEq.children.length;
  td.style.cssText='padding:14px 12px;background:var(--bg2)';
  // Desglose "de dónde sale cada gasto" (CSP-safe vía setHTML) + chart mensual.
  const brk=document.createElement('div');
  setHTML(brk,_costoBreakdownHTML(codN,cfg,yms));
  td.appendChild(brk);
  const wrap=document.createElement('div');
  wrap.style.cssText='position:relative;height:240px';
  const canvas=document.createElement('canvas');
  wrap.appendChild(canvas);td.appendChild(wrap);tr.appendChild(td);
  filaEq.after(tr);
  const chev=document.getElementById('costoChev_'+codN);
  if(chev)chev.textContent='▾';
  _costoChartCod=codN;

  const AMBER=_cssVar('--amber','#ffa030');
  const CORP =_cssVar('--corp','#5d80e8');
  const RED  =_cssVar('--red','#e5484d');
  const GRID =_cssVar('--chart-grid','#1a2030');
  const TEXT2=_cssVar('--text2','#aab3c8');
  const TOOLTIP_BG=_cssVar('--chart-tooltip-bg','#0d1019');
  const TOOLTIP_FG=_cssVar('--chart-tooltip-fg','#f1f4fb');
  const mkDs=(label,data,color)=>({type:'bar',label,data,backgroundColor:color+'cc',borderColor:color,borderWidth:1,maxBarThickness:44,stack:'usd'});
  _costoChartEq=new Chart(canvas.getContext('2d'),{
    type:'bar',
    data:{labels:window._costosYmLabels||yms,datasets:[
      mkDs('Repuestos',dRep,AMBER),
      mkDs('Mano de obra',dMo,CORP),
      mkDs('Oportunidad',dOp,RED),
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:true,position:'top',labels:{color:TEXT2,font:{size:10,family:'JetBrains Mono'},boxWidth:10}},
        tooltip:{
          backgroundColor:TOOLTIP_BG,titleColor:TOOLTIP_FG,bodyColor:TOOLTIP_FG,
          padding:12,borderColor:GRID,borderWidth:1,
          titleFont:{family:'JetBrains Mono',size:11,weight:'600'},
          bodyFont:{family:'Inter',size:12},bodySpacing:6,
          callbacks:{
            label:c=>`  ${c.dataset.label}: ${_fmtARS(c.raw)}`,
            footer:items=>'Total: '+_fmtARS(items.reduce((s,i)=>s+i.raw,0)),
          }
        }
      },
      scales:{
        x:{stacked:true,ticks:{color:TEXT2,font:{size:11,family:'JetBrains Mono',weight:'500'}},grid:{display:false},border:{color:GRID}},
        y:{stacked:true,beginAtZero:true,
          ticks:{color:TEXT2,font:{size:10,family:'JetBrains Mono'},callback:v=>formatMoney(v)},
          grid:{color:GRID,drawTicks:false},border:{display:false}},
      }
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════
   AUTO-REFRESH · dropdown con countdown
═══════════════════════════════════════════════════════════════════ */
let _autoTimer=null, _autoSecs=0, _autoInterval=0;
function setAutoRefresh(){
  const sel=document.getElementById('autoSelect');
  const secs=parseInt(sel?.value||'0',10);
  _autoInterval=secs;
  if(_autoTimer){clearInterval(_autoTimer);_autoTimer=null;}
  const cd=document.getElementById('autoCountdown');
  if(!secs){cd.classList.remove('visible');cd.textContent='—';return;}
  _autoSecs=secs;
  cd.classList.add('visible');
  _renderAutoCD();
  _autoTimer=setInterval(()=>{
    _autoSecs--;
    if(_autoSecs<=0){
      _autoSecs=_autoInterval;
      loadAll();
    }
    _renderAutoCD();
  },1000);
}
function _renderAutoCD(){
  const cd=document.getElementById('autoCountdown');if(!cd)return;
  const m=Math.floor(_autoSecs/60),s=_autoSecs%60;
  cd.textContent=m>0?`${m}m ${String(s).padStart(2,'0')}s`:`${s}s`;
}

// ═══════════════════════════════════════════════════════════════════
// DIAGNÓSTICO TEMPORAL — Ejecutar desde la consola: diag('RTP-01')
// Remover esta función cuando se resuelva el problema.
// ═══════════════════════════════════════════════════════════════════
window.diag=function(codigo){
  const cn=normCod(codigo||'');
  console.log('%c═══ diag("'+codigo+'") · normalizado: '+cn+' ═══','color:#3b82f6;font-weight:bold');

  // 1) Hoja ENTREGADOS
  const pedEnt=window._pedidosEntregados||[];
  console.log('%c[1] _pedidosEntregados — '+pedEnt.length+' filas totales','color:#10b981;font-weight:bold');
  if(pedEnt.length){
    console.log('    Keys (nombres de columna reales):',Object.keys(pedEnt[0]));
    console.log('    Primer objeto completo:',pedEnt[0]);
    const mias=pedEnt.filter(p=>normCod((window.pickCol||((o,c)=>''))(p,(window.COLS_PED||{codigo:['CODIGO']}).codigo))===cn);
    console.log('    Filas que matchean "'+cn+'":',mias.length);
    if(mias.length)console.log('    Primer match:',mias[0]);
  }

  // 2) Hoja PENDIENTES
  const pedAll=window._pedidosAll||[];
  console.log('%c[2] _pedidosAll (pendientes) — '+pedAll.length+' filas','color:#10b981;font-weight:bold');
  if(pedAll.length){
    console.log('    Keys del primer objeto:',Object.keys(pedAll[0]));
    console.log('    Primer objeto:',pedAll[0]);
    const mp=pedAll.filter(p=>p.codigo===cn);
    console.log('    Filas que matchean:',mp.length);
    if(mp.length)console.log('    Primer match:',mp[0]);
  }

  // 3) Costos por mes (de hojas MESES_ENTREGAS)
  const cpm=window._costosPorMes||{};
  console.log('%c[3] _costosPorMes para "'+cn+'"','color:#f59e0b;font-weight:bold');
  let total=0;
  for(const ym of Object.keys(cpm).sort()){
    const v=(cpm[ym]||{})[cn]||0;
    console.log('    '+ym+': $'+v);
    total+=v;
  }
  console.log('    %cTOTAL 2026: $'+total,'font-weight:bold');

  // 4) Items detallados (de hojas mensuales)
  const ipe=window._itemsPorEntrega||{};
  console.log('%c[4] _itemsPorEntrega — '+Object.keys(ipe).length+' N° entrega con items detallados','color:#f59e0b;font-weight:bold');
  const sample=Object.keys(ipe).slice(0,3);
  for(const k of sample){console.log('    Entrega "'+k+'":',ipe[k]);}

  // 5) Costos por entrega
  const ec=window._entregaCostos||{};
  console.log('%c[5] _entregaCostos — '+Object.keys(ec).length+' entregas con costo registrado','color:#f59e0b;font-weight:bold');
  const sampleEc=Object.keys(ec).slice(0,3);
  for(const k of sampleEc){console.log('    Entrega "'+k+'":',ec[k]);}

  // 6) Entregas por equipo (PANEL_REPUESTOS)
  const epe=(window._entregasPorEquipo||{})[cn]||[];
  console.log('%c[6] _entregasPorEquipo["'+cn+'"] — '+epe.length+' filas (de PANEL_REPUESTOS)','color:#8b5cf6;font-weight:bold');
  epe.slice(0,5).forEach((e,i)=>console.log('    ['+i+']:',e));

  // 7) Lookup N° PEDIDO → fecha (para calcular demora cruzando ENTREGADOS con PENDIENTES)
  const fpn=window._fechaPedidoByNro||{};
  const totalLookup=Object.keys(fpn).length;
  console.log('%c[7] _fechaPedidoByNro — '+totalLookup+' N° pedido con fecha en PENDIENTES','color:#06b6d4;font-weight:bold');
  // Para cada pedido entregado del equipo, ver si tiene match en el lookup
  if(pedEnt.length){
    const pickC=(o,c)=>{for(const k of c){if(o[k]!=null&&String(o[k]).trim()!=='')return String(o[k]).trim();}return'';};
    const candNro=['N° PEDIDO','Nº PEDIDO','N PEDIDO','NRO PEDIDO','NUMERO PEDIDO','PEDIDO','N° DE PEDIDO'];
    const candFecP=['FECHA PEDIDO','FECHA DEL PEDIDO','F PEDIDO','F. PEDIDO','FECHA DE PEDIDO'];
    const candFecE=['FECHA ENTREGA','FECHA DE ENTREGA','F ENTREGA','F. ENTREGA'];
    const candCod=['CODIGO','CÓDIGO','COD','CODIGO EQUIPO'];
    const mias=pedEnt.filter(p=>normCod(pickC(p,candCod))===cn);
    console.log('    Pedidos entregados de "'+cn+'": '+mias.length);
    mias.slice(0,8).forEach((p,i)=>{
      const nro=pickC(p,candNro);
      const fechaPedHoja=pickC(p,candFecP);
      const fechaPedLookup=nro?fpn[nro]:null;
      const fechaEnt=pickC(p,candFecE);
      const fuente=fechaPedHoja?'hoja ENTREGADOS':(fechaPedLookup?'cruce PENDIENTES':'NO RESUELTA');
      console.log('    ['+i+'] N°='+nro+' | F.Ped='+(fechaPedHoja||fechaPedLookup||'∅')+' ('+fuente+') | F.Ent='+fechaEnt);
    });
  }

  return '✓ diag completo — revisá los bloques [1]–[7] arriba';
};
// Exponer también pickCol y COLS_PED para que diag los use (están dentro de openEquipoDetail por ahora)
// Si están definidos en otro scope, diag igual funciona con la guarda inline.

/* ═══════════════════════════════════════════════════════════════════
   MODAL: Service crítico — lista clickeable de equipos pasados/al borde
═══════════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════
   MODAL DE DETALLE DE KPI · listado de equipos clickeable
═══════════════════════════════════════════════════════ */
// Devuelve nombre legible del equipo a partir del cód normalizado.
function _equipoLabel(codN){
  const info=(window._estadoEquipos||{})[codN]||{};
  const eq=(window._equiposOrdenados||[]).find(e=>normCod(e.codigo)===codN);
  const rawCod=info.rawCod||eq?.codigo||codN;
  const nombre=buildEquipoNombre(eq?.clasificacion||info.clasificacion,eq?.marca||info.marca,eq?.modelo||info.modelo,eq?.nombre||info.equipo);
  return{rawCod,nombre:nombre||codN};
}
// Listado de equipos por costo en repuestos para un rango de YMs.
function _listadoEquiposCosto(yms){
  const cpm=window._costosPorMes||{};
  const acc={};
  for(const ym of yms){
    const m=cpm[ym]||{};
    for(const codN of Object.keys(m))acc[codN]=(acc[codN]||0)+(m[codN]||0);
  }
  const arr=Object.entries(acc).filter(([_,v])=>v>0).map(([codN,v])=>{
    const{rawCod,nombre}=_equipoLabel(codN);
    return{codN,rawCod,nombre,valor:v};
  });
  arr.sort((a,b)=>b.valor-a.valor);
  return arr;
}
// Listado de equipos por horas en taller para un rango de YMs.
function _listadoEquiposHoras(yms){
  const hpme=window._horasPorMesYEquipo||{};
  const acc={};
  for(const ym of yms){
    const m=hpme[ym]||{};
    for(const codN of Object.keys(m))acc[codN]=(acc[codN]||0)+(m[codN]||0);
  }
  const arr=Object.entries(acc).filter(([_,v])=>v>0).map(([codN,v])=>{
    const{rawCod,nombre}=_equipoLabel(codN);
    return{codN,rawCod,nombre,valor:v};
  });
  arr.sort((a,b)=>b.valor-a.valor);
  return arr;
}
// Listado de equipos por gasto en combustible livianos para un rango de YMs.
function _listadoEquiposCombustible(yms){
  const cpe=window._combustiblePorEquipo||{};
  const ymsSet=new Set(yms);
  const acc={};
  for(const codN of Object.keys(cpe)){
    const e=cpe[codN];
    if(!e||!e.cargas)continue;
    let total=0;
    for(const c of e.cargas){
      const d=_parseDate(c.fecha);
      if(!d)continue;
      const ym=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      if(ymsSet.has(ym))total+=(c.costo||0);
    }
    if(total>0)acc[codN]=total;
  }
  const arr=Object.entries(acc).map(([codN,v])=>{
    const{rawCod,nombre}=_equipoLabel(codN);
    return{codN,rawCod,nombre,valor:v};
  });
  arr.sort((a,b)=>b.valor-a.valor);
  return arr;
}
const _KPI_DETAIL_CFG={
  costo:{label:'Costo en repuestos',getList:_listadoEquiposCosto,formatVal:v=>formatMoney(v),unitLabel:'$'},
  horas:{label:'Horas en taller',  getList:_listadoEquiposHoras,formatVal:v=>fmtInt(Math.round(v))+' hr',unitLabel:'hr'},
  combustible:{label:'Combustible livianos',getList:_listadoEquiposCombustible,formatVal:v=>formatMoney(v),unitLabel:'$'},
};
function abrirDetalleKpi(tipo){
  const cfg=_KPI_DETAIL_CFG[tipo];
  if(!cfg)return;
  const yms=_kpiYms();
  const labelRango=_kpiLabel();
  const lista=cfg.getList(yms);
  const total=lista.reduce((s,x)=>s+x.valor,0);
  const overlay=document.getElementById('kpiDetailOverlay');
  const titleEl=document.getElementById('kpiDetailTitle');
  const subEl=document.getElementById('kpiDetailSub');
  const listEl=document.getElementById('kpiDetailList');
  if(!overlay||!listEl)return;
  titleEl.textContent=`${cfg.label} · ${labelRango}`;
  setHTML(subEl, html`<span class="v-total">${cfg.formatVal(total)}</span> · ${fmtInt(lista.length)} ${lista.length===1?'equipo':'equipos'}`);
  if(!lista.length){
    setHTML(listEl, html`<div style="padding:36px;text-align:center;color:var(--text3);font-size:13px">Sin datos en el rango seleccionado.</div>`);
  }else{
    const maxVal=lista[0].valor||1;
    setHTML(listEl, lista.map(x=>{
      const pct=Math.round(x.valor/maxVal*100);
      const pctTotal=total>0?Math.round(x.valor/total*100):0;
      return html`<div class="kd-row" data-action="_irAEquipoDesdeKpiDetail" data-arg="${x.rawCod}" title="Abrir detalle del equipo">
        <div class="kd-cod">${x.rawCod}</div>
        <div class="kd-nom">${x.nombre}</div>
        <div class="kd-val">${cfg.formatVal(x.valor)}<small>${pctTotal}% del total</small></div>
        <div class="kd-bar"><div class="kd-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
    }));
  }
  overlay.classList.add('open');
  document.body.style.overflow='hidden';
}
function cerrarDetalleKpi(){
  const overlay=document.getElementById('kpiDetailOverlay');
  if(!overlay)return;
  overlay.classList.remove('open');
  document.body.style.overflow='';
}
function _irAEquipoDesdeKpiDetail(codigo){
  cerrarDetalleKpi();
  setTab('tabEquipos');
  const id='eqcard_'+String(codigo).replace(/[^a-z0-9]/gi,'_');
  const open=()=>{
    const card=document.getElementById(id);
    if(!card)return false;
    card.classList.remove('hidden');
    toggleEquipoDetail(codigo,card);
    card.scrollIntoView({behavior:'smooth',block:'center'});
    return true;
  };
  if(!open())setTimeout(open,80);
}

function openServiceCriticoModal(){
  const list=window._serviceCriticosList||[];
  const wrap=document.getElementById('svModalList');
  const count=document.getElementById('svModalCount');
  const overlay=document.getElementById('svModalOverlay');
  if(!wrap||!overlay)return;
  count.textContent=fmtInt(list.length);
  if(!list.length){
    setHTML(wrap, html`<div style="padding:36px;text-align:center;color:var(--text3);font-size:13px">Sin equipos en estado crítico.</div>`);
  }else{
    setHTML(wrap, list.map(c=>{
      const restCls = (c.restantes!=null && c.restantes>0) ? ' amber' : '';
      const restStr = c.restantes==null ? '—'
        : c.restantes<=0 ? `−${fmtInt(Math.abs(c.restantes))}`
        : fmtInt(c.restantes);
      const restLbl = c.restantes==null ? 'sin estimado'
        : c.restantes<=0 ? 'pasado'
        : 'restantes';
      return html`<div class="sv-row" data-action="_irAEquipoDesdeKpi" data-arg="${c.codigo}" title="Abrir detalle del equipo">
        <div class="sv-cod">${c.codigo}</div>
        <div class="sv-nom">${c.nombre||'—'}</div>
        <div class="sv-hr"><small>actual</small>${c.hrActualFmt||'—'}</div>
        <div class="sv-hr"><small>próximo</small>${c.estimadoFmt||'—'}</div>
        <div class="sv-rest${restCls}"><small>${restLbl}</small>${restStr}</div>
      </div>`;
    }));
  }
  overlay.classList.add('open');
  document.body.style.overflow='hidden';
}
function closeServiceCriticoModal(){
  const overlay=document.getElementById('svModalOverlay');
  if(!overlay)return;
  overlay.classList.remove('open');
  document.body.style.overflow='';
}
function openVtvCriticaModal(){
  const list=window._vtvCriticosList||[];
  const wrap=document.getElementById('vtvModalList');
  const count=document.getElementById('vtvModalCount');
  const overlay=document.getElementById('vtvModalOverlay');
  if(!wrap||!overlay)return;
  count.textContent=fmtInt(list.length);
  if(!list.length){
    setHTML(wrap, html`<div style="padding:36px;text-align:center;color:var(--text3);font-size:13px">Sin vehículos con VTV crítica.</div>`);
  }else{
    setHTML(wrap, list.map(v=>{
      const diasCls = v.dias>0 ? ' amber' : '';
      const diasStr = v.dias<=0 ? `−${fmtInt(Math.abs(v.dias))}` : fmtInt(v.dias);
      const diasLbl = v.dias<=0 ? 'vencida hace' : 'restantes';
      return html`<div class="sv-row" data-action="_irAEquipoDesdeKpi" data-arg="${v.codigo}" title="Abrir detalle del equipo">
        <div class="sv-cod">${v.codigo}</div>
        <div class="sv-nom">${v.nombre||'—'}</div>
        <div class="sv-hr"><small>patente</small>${v.patente||'—'}</div>
        <div class="sv-hr"><small>vence</small>${formatFechaCorta(v.vencimiento)||'—'}</div>
        <div class="sv-rest${diasCls}"><small>${diasLbl}</small>${diasStr}</div>
      </div>`;
    }));
  }
  overlay.classList.add('open');
  document.body.style.overflow='hidden';
}
function closeVtvCriticaModal(){
  const overlay=document.getElementById('vtvModalOverlay');
  if(!overlay)return;
  overlay.classList.remove('open');
  document.body.style.overflow='';
}
/* Tab "service": TODOS los equipos con datos de service, ordenados por prioridad
   (tier de estado VENCIDO/CRÍTICO → INTERMEDIO → HOLGADO → sin-datos; dentro de
   cada tier, restantes ascendente = más pasado primero). Reusa operatividadEquipo
   (misma lógica del modal crítico). Solo lee del snapshot ya procesado — sin builder. */
/* ═══════════════════════════════════════════════════════
   TAB "PENDIENTES DE CARGA"
   Lista lo que FALTA anotar en las planillas (pestaña FALTANTES del
   snapshot, armada por el builder). Es visible sin PIN: es la lista de
   tareas del encargado, no la auditoría de control (esa sigue privada).
═══════════════════════════════════════════════════════ */
const FALT_TIPOS=[
  {k:'VTV_VENCIDA',       t:'VTV vencida',                       d:'Circular así es multa y el seguro puede no responder.', c:'var(--red)'},
  {k:'VTV_POR_VENCER',    t:'VTV por vencer (30 días)',          d:'Sacar turno antes de que venza.',                      c:'var(--amber)'},
  {k:'SIN_SERVICE',       t:'Equipos sin ficha de service',      d:'Sin ficha el panel no sabe horas ni próximo service.',  c:'var(--amber)'},
  {k:'HOROMETRO_VIEJO',   t:'Horómetro sin actualizar',          d:'Hace más de 30 días que no se anota una lectura.',      c:'var(--amber)'},
  {k:'SIN_VTV',           t:'Vehículos sin VTV cargada',         d:'Falta cargar la fecha de vencimiento en la planilla.',  c:'var(--text2)'},
  {k:'CARGA_SIN_ODOMETRO',t:'Cargas sin horómetro/odómetro',     d:'Sin la lectura no se puede calcular el consumo.',        c:'var(--text2)'},
];

function renderFaltantes(){
  const wrap=document.getElementById('faltantesWrap');
  const badge=document.getElementById('faltantesBadge');
  if(!wrap)return;
  const items=window._faltantes||[];
  if(badge)badge.textContent=items.length?String(items.length):'0';
  if(!items.length){
    setHTML(wrap,html`<div class="no-data">No hay pendientes de carga. Todo al día.</div>`);
    return;
  }
  const porTipo={};
  for(const f of items)(porTipo[f.tipo]=porTipo[f.tipo]||[]).push(f);
  const bloques=FALT_TIPOS.map(def=>{
    const g=porTipo[def.k];
    if(!g||!g.length)return '';
    // Más días = más urgente en vencidas (días negativos primero).
    g.sort((a,b)=>(parseInt(a.dias,10)||0)-(parseInt(b.dias,10)||0));
    // esc() ya sabe aplanar arrays de RawHTML: no usar .join('') acá (daría
    // "[object Object]", porque html`` devuelve RawHTML y no string).
    const filas=g.map(f=>html`<tr>
        <td class="mono" style="font-size:11px;white-space:nowrap"><a style="color:var(--accent);cursor:pointer;text-decoration:none" data-action="scrollToEquipo" data-arg="${f.codigo}" title="Ver detalle del equipo">${f.codigo}</a></td>
        <td style="font-size:12px;color:var(--text2)">${f.equipo}</td>
        <td style="font-size:12px;color:var(--text3)">${f.detalle}</td>
      </tr>`);
    return html`<div style="margin-bottom:22px">
        <div style="display:flex;align-items:baseline;gap:9px;margin-bottom:2px">
          <span style="width:9px;height:9px;background:${def.c};display:inline-block;border-radius:50%"></span>
          <span style="font-size:13px;color:var(--text);font-weight:600">${def.t}</span>
          <span class="mono" style="font-size:11px;color:var(--text3)">${g.length}</span>
        </div>
        <div style="font-size:11px;color:var(--text3);margin:0 0 8px 18px">${def.d}</div>
        <div class="table-wrap"><table class="eq-inner-table"><tbody>${filas}</tbody></table></div>
      </div>`;
  }).filter(Boolean);
  setHTML(wrap,html`${bloques}`);
}

/* ═══════════════════════════════════════════════════════
   TAB "TRABAJOS PENDIENTES"
   Lista de tareas de taller detectadas y aún sin resolver (pestaña TRAB_PEND
   del snapshot, hoja nueva que Marcos agregó ago-2026 junto a TRABAJOS
   REALIZADOS). El badge cuenta solo las abiertas; las resueltas quedan
   colapsadas debajo, no se ocultan (quedan como historial corto).
═══════════════════════════════════════════════════════ */
function renderTrabajosPendientes(){
  const wrap=document.getElementById('trabPendWrap');
  const badge=document.getElementById('trabPendBadge');
  if(!wrap)return;
  const items=window._trabajosPendientes||[];
  const abiertos=items.filter(t=>!t.resuelto);
  const resueltos=items.filter(t=>t.resuelto);
  if(badge)badge.textContent=String(abiertos.length);
  if(!items.length){
    setHTML(wrap,html`<div class="no-data">No hay trabajos pendientes cargados.</div>`);
    return;
  }
  const hoy=new Date();
  const fila=t=>{
    const d=_parseDate(t.fecha);
    const dias=d?Math.round((hoy-d)/86400000):null;
    const diasCls=dias!=null&&dias>30?' style="color:var(--red)"':dias!=null&&dias>14?' style="color:var(--amber)"':'';
    return html`<tr>
      <td class="mono" style="font-size:11px;white-space:nowrap"><a style="color:var(--accent);cursor:pointer;text-decoration:none" data-action="scrollToEquipo" data-arg="${t.codigo}" title="Ver detalle del equipo">${t.codigo}</a></td>
      <td class="mono" style="font-size:10.5px;color:var(--text3);white-space:nowrap">${formatFechaCorta(t.fecha)}</td>
      <td${new RawHTML(diasCls)} class="mono" style="font-size:11px;text-align:right;white-space:nowrap">${dias!=null?fmtInt(dias)+' d':'—'}</td>
      <td style="font-size:12px;color:var(--text2)">${t.descripcion||'—'}${t.resuelto&&t.descripcionResolucion?html`<div style="font-size:11px;color:var(--text3);margin-top:2px">↳ ${t.descripcionResolucion}</div>`:''}</td>
      <td style="font-size:11px;color:var(--text3)">${t.responsable||'—'}</td>
    </tr>`;
  };
  // Sin columna Estado: cada tabla ya vive dentro de un bloque homogéneo
  // (Pendientes / resueltos), la etiqueta por fila sería redundante acá.
  // Solo hace falta en el detalle de equipo, donde las dos listas se mezclan.
  const tabla=(rows,vacio)=>rows.length
    ? html`<div class="table-wrap"><table class="eq-inner-table">
        <thead><tr><th>Código</th><th>Fecha</th><th style="text-align:right">Antigüedad</th><th>Descripción</th><th>Responsable</th></tr></thead>
        <tbody>${rows.map(fila)}</tbody>
      </table></div>`
    : html`<div class="no-data">${vacio}</div>`;
  const bloqueAbiertos=html`<div style="margin-bottom:22px">
      <div style="display:flex;align-items:baseline;gap:9px;margin-bottom:8px">
        <span style="width:9px;height:9px;background:var(--amber);display:inline-block;border-radius:50%"></span>
        <span style="font-size:13px;color:var(--text);font-weight:600">Pendientes</span>
        <span class="mono" style="font-size:11px;color:var(--text3)">${abiertos.length}</span>
      </div>
      ${tabla(abiertos,'Sin trabajos pendientes abiertos.')}
    </div>`;
  const bloqueResueltos=eqSection(`resueltos recientes (${resueltos.length})`,tabla(resueltos,'—'),false);
  setHTML(wrap,html`${bloqueAbiertos}${resueltos.length?bloqueResueltos:''}`);
}

function renderServiceTab(){
  const wrap=document.getElementById('svcTablaWrap');
  const badge=document.getElementById('serviceBadge');
  const sp=window._servicePanel||{};
  const est=window._estadoEquipos||{};
  const TIER={critico:0,intermedio:1,holgado:2,'sin-datos':3};
  // Parser numérico tolerante (miles con punto, decimal coma; descarta '-', fechas, S/H).
  const num=v=>{const s=String(v==null?'':v).trim();if(!s||s==='-'||/\//.test(s)||/s\/?h/i.test(s))return null;const n=parseFloat(s.replace(/\./g,'').replace(',','.').replace(/[^\d.-]/g,''));return isFinite(n)?n:null;};
  const rows=Object.keys(sp).map(codN=>{
    const op=operatividadEquipo(codN);
    const info=est[codN]||{};
    const codigo=info.rawCod||sp[codN].codigo||codN;
    // Texto del badge: ESTADO real de la fuente (VENCIDO/CRÍTICO/INTERMEDIO/
    // HOLGADO) sin el símbolo ⚠, para distinguir vencido de crítico. Color = tier.
    const estadoTxt=String(sp[codN].estado||'').replace(/[^\p{L} ]/gu,'').trim();
    // Sin flags de inconsistencia acá (jul-2026): que el último service quede
    // por encima del horómetro "actual" es NORMAL (la lectura del service es
    // más fresca que la del horómetro) y llenaba el tab de falsos ⚠. La calidad
    // de datos se vigila en la auditoría privada, no en este tablero.
    return {
      codigo,
      nombre: info.equipo||sp[codN].descripcion||'',
      nivel: op.nivel, label: estadoTxt||op.label,
      hrActual: op.hrActual, hrProximo: op.hrProximo, restantes: op.restantes,
      frecuencia: op.frecuencia||sp[codN].frecuencia||'',
      unidad: unidadDeEquipo(codigo),
      ultFecha: sp[codN].ultFecha||'',
    };
  });
  rows.sort((a,b)=>{
    const ta=TIER[a.nivel]==null?9:TIER[a.nivel], tb=TIER[b.nivel]==null?9:TIER[b.nivel];
    if(ta!==tb)return ta-tb;
    const ra=a.restantes==null?Infinity:a.restantes, rb=b.restantes==null?Infinity:b.restantes;
    return ra-rb;
  });
  if(badge)badge.textContent=fmtInt(rows.filter(r=>r.nivel==='critico').length);
  if(!wrap)return;
  if(!rows.length){ setHTML(wrap, html`<div class="svc-empty">Sin datos de service en el snapshot.</div>`); return; }
  const badgeCls=n=>n==='critico'?'red':n==='intermedio'?'amber':n==='holgado'?'blue':'gray';
  const fmtU=(v,u)=> v==null?'—':fmtInt(v)+' '+u;
  const head=html`<div class="svc-row svc-head">
    <div>código</div><div>equipo</div><div>estado</div>
    <div class="svc-num">actual</div><div class="svc-num">próximo</div>
    <div class="svc-num">restantes</div><div class="svc-num">frec.</div><div class="svc-num">últ. service</div>
  </div>`;
  const body=rows.map(r=>{
    const rest=r.restantes==null?'—':r.restantes<=0?'−'+fmtInt(Math.abs(r.restantes)):'+'+fmtInt(r.restantes);
    const restCls=r.restantes==null?'':r.restantes<=0?' red':' amber';
    const rowCls=r.nivel==='sin-datos'?' svc-dim':'';
    return html`<div class="svc-row${new RawHTML(rowCls)}" data-action="_irAEquipoDesdeKpi" data-arg="${r.codigo}" title="Abrir detalle del equipo">
      <div class="svc-cod">${r.codigo}</div>
      <div class="svc-nom" title="${r.nombre}">${r.nombre||'—'}</div>
      <div><span class="svc-badge ${new RawHTML(badgeCls(r.nivel))}">${r.label||'sin datos'}</span></div>
      <div class="svc-num">${fmtU(r.hrActual,r.unidad)}</div>
      <div class="svc-num">${fmtU(r.hrProximo,r.unidad)}</div>
      <div class="svc-num svc-rest2${new RawHTML(restCls)}">${rest}</div>
      <div class="svc-num">${r.frecuencia||'—'}</div>
      <div class="svc-num">${r.ultFecha||'—'}</div>
    </div>`;
  });
  setHTML(wrap, html`${head}${body}`);
}
function _irAEquipoDesdeKpi(codigo){
  closeServiceCriticoModal();
  closeVtvCriticaModal();
  setTab('tabEquipos');
  const id='eqcard_'+String(codigo).replace(/[^a-z0-9]/gi,'_');
  const open=()=>{
    const card=document.getElementById(id);
    if(!card)return false;
    // Si los filtros lo dejaron oculto, lo des-ocultamos puntualmente para que aparezca.
    card.classList.remove('hidden');
    toggleEquipoDetail(codigo,card);
    card.scrollIntoView({behavior:'smooth',block:'center'});
    return true;
  };
  if(!open())setTimeout(open,80);
}
// Esc cierra el modal de service crítico, VTV crítica, el de detalle de KPI o el de auditoría.
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  const ovSv=document.getElementById('svModalOverlay');
  if(ovSv&&ovSv.classList.contains('open'))closeServiceCriticoModal();
  const ovVtv=document.getElementById('vtvModalOverlay');
  if(ovVtv&&ovVtv.classList.contains('open'))closeVtvCriticaModal();
  const ovKd=document.getElementById('kpiDetailOverlay');
  if(ovKd&&ovKd.classList.contains('open'))cerrarDetalleKpi();
  const ovAu=document.getElementById('audOverlay');
  if(ovAu&&ovAu.classList.contains('open'))cerrarAuditoria();
});
