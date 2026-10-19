/* ══════════════════════════════════════════════════════════════════
   10-combustible.js — tab "combustible" del panel INGECO.
   Script CLÁSICO (mismo scope global que 01..09). Corre SOBRE los datos
   que ya deja 04-carga en window._combustiblePorEquipo (3 fuentes
   fusionadas: Casares pesados, Sanz/Tiburcio livianos, camionetas).
   No vuelve a leer el snapshot.

   Dos grupos:
     · pesados  → equipos con horómetro, consumo en L/hr
     · livianos → vehículos con odómetro (CMT/CMN o categoría 'liviano'),
                  consumo en km/L (Marcos lo pidió así; el resto del panel
                  sigue en L/100km, no se toca)
   Por grupo: resumen del período, gráfico de litros por mes, ranking por
   consumo específico, ranking por litros totales, lista de equipos sin
   consumo medible y la tabla completa de cargas históricas.
══════════════════════════════════════════════════════════════════ */

let _chartComb=null;
window._combGrupo='pesados';
window._combYmsSel=null;        // null = default (últimos 6 meses con datos)
window._combFiltroEq='';
window._combBuscar='';
window._combLimite=200;

function _combEsLiviano(codN,e){
  const info=(window._estadoEquipos||{})[codN]||{};
  if(info.categoria==='liviano')return true;
  if(e&&e.unidad==='km')return true;
  return false;
}
function _combYm(c){
  const d=_parseDate(c.fecha);
  return d?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`:null;
}
// Meses con alguna carga de combustible (cualquier fuente).
function _combMesesDisponibles(){
  const s=new Set();
  for(const e of Object.values(window._combustiblePorEquipo||{})){
    for(const c of(e.cargas||[])){const ym=_combYm(c);if(ym)s.add(ym);}
  }
  return [...s].filter(ym=>/^\d{4}-\d{2}$/.test(ym)&&+ym.slice(0,4)>=2020).sort();
}
function _combYms(){
  if(Array.isArray(window._combYmsSel)&&window._combYmsSel.length)return window._combYmsSel;
  const meses=_combMesesDisponibles();
  return meses.slice(-6);
}
function _combLabelRango(){
  const yms=[..._combYms()].sort();
  if(!yms.length)return 'sin meses';
  if(yms.length===1)return ymLabel(yms[0]);
  const idx=ym=>{const[a,m]=ym.split('-');return +a*12+(+m-1);};
  const contiguo=yms.every((ym,i)=>i===0||idx(ym)-idx(yms[i-1])===1);
  return contiguo?`${ymLabel(yms[0])} – ${ymLabel(yms[yms.length-1])}`:`${yms.length} meses`;
}

/* Consumo de un equipo dentro de un conjunto de cargas (ya ordenadas por
   fecha), TOLERANTE a lecturas mal cargadas (pedido de Marcos 19-oct-2026:
   "omití el error y hacé el cálculo"):
     · se arma un tramo entre cada par de lecturas consecutivas; los litros
       del tramo son los de las cargas posteriores a la primera lectura hasta
       la segunda inclusive (misma regla que _recalcConsumo).
     · un tramo se DESCARTA si la lectura retrocede (typo, reseteo) o si el
       consumo que implica está fuera del rango plausible de la unidad.
     · consumo = Σ litros / Σ delta de los tramos válidos.
   Detección de unidad: varios camiones (CMN-03/04/22) tienen el odómetro
   roto y el chofer anota el HORÓMETRO en la misma columna. Si en km/L no
   queda ningún tramo plausible pero en L/hr sí, se informa en L/hr y se
   marca `unidadDetectada`. Devuelve {valor,unidad,segOk,segDesc} o null. */
const _COMB_RANGO={km:[1,30],hr:[0.5,80]};   // km/L · L/hr plausibles
// Camiones que tienen HORÓMETRO y no odómetro (confirmado por Marcos
// 19-oct-2026: Scania LT111 = CMN-22, Ford Cargo 1831 = CMN-03). Su consumo
// se informa en L/hr sin pasar por la detección automática.
const COMB_LECTURA_HORAS=new Set(['CMN03','CMN22']);
function _combTramos(cargas){
  const out=[]; let i0=-1, lit=0;
  for(let i=0;i<cargas.length;i++){
    const c=cargas[i];
    if(i0>=0)lit+=c.litros||0;
    if(c.hr==null)continue;
    if(i0>=0)out.push({delta:c.hr-cargas[i0].hr,litros:lit});
    i0=i; lit=0;
  }
  return out;
}
function _combConsumoUnidad(tramos,unidad){
  const[lo,hi]=_COMB_RANGO[unidad];
  let L=0,D=0,ok=0,desc=0;
  for(const t of tramos){
    if(!(t.delta>0&&t.litros>0)){desc++;continue;}
    const v=unidad==='km'?(t.delta/t.litros):(t.litros/t.delta);
    if(v<lo||v>hi){desc++;continue;}
    L+=t.litros; D+=t.delta; ok++;
  }
  if(!ok)return null;
  return{valor:unidad==='km'?(D/L):(L/D),unidad,segOk:ok,segDesc:desc};
}
function _combConsumo(cargas,unidad){
  const tramos=_combTramos(cargas);
  if(!tramos.length)return null;
  const otra=unidad==='km'?'hr':'km';
  const r=_combConsumoUnidad(tramos,unidad);
  const r2=_combConsumoUnidad(tramos,otra);
  // Gana la unidad que deja MÁS tramos plausibles (empate → la propia del
  // equipo). Con "la primera que funcione" CMN-04 salía en km/L por un
  // único salto accidental (122→400) y descartaba 11 tramos coherentes en hs.
  if(r&&(!r2||r.segOk>=r2.segOk))return r;
  if(r2){r2.unidadDetectada=true;return r2;}
  return null;
}

/* Arma los datos del grupo activo para el rango de meses activo. */
function _combDatosGrupo(){
  const grupo=window._combGrupo;
  const ymsSet=new Set(_combYms());
  const cpe=window._combustiblePorEquipo||{};
  const equipos=[];
  const cargasTodas=[];
  const litrosPorMes={}, costoPorMes={};
  for(const codN of Object.keys(cpe)){
    const e=cpe[codN];
    if(!e||!e.cargas||!e.cargas.length)continue;
    const liv=_combEsLiviano(codN,e);
    if((grupo==='livianos')!==liv)continue;
    const unidad=liv?'km':'hr';
    const{rawCod,nombre}=_equipoLabel(codN);
    // litros/costo por mes del grupo (todos los meses, para el gráfico)
    for(const c of e.cargas){
      const ym=_combYm(c);
      if(!ym)continue;
      litrosPorMes[ym]=(litrosPorMes[ym]||0)+(c.litros||0);
      costoPorMes[ym]=(costoPorMes[ym]||0)+(c.costo||0);
    }
    const sel=e.cargas.filter(c=>ymsSet.has(_combYm(c)));
    if(!sel.length)continue;
    const litros=sel.reduce((s,c)=>s+(c.litros||0),0);
    const costo=sel.reduce((s,c)=>s+(c.costo||0),0);
    const estimado=sel.some(c=>c.costoEstimado);
    const lecturas=sel.filter(c=>c.hr!=null).length;
    const forzadaHr=COMB_LECTURA_HORAS.has(codN);
    const cr=forzadaHr?_combConsumoUnidad(_combTramos(sel),'hr'):_combConsumo(sel,unidad);
    const consumo=cr?cr.valor:null;
    const consUnidad=cr?cr.unidad:(forzadaHr?'hr':unidad);
    const ult=[...sel].reverse().find(c=>c.hr!=null);
    equipos.push({codN,rawCod,nombre,unidad,consUnidad,unidadDetectada:!!(cr&&cr.unidadDetectada),horometro:forzadaHr,
      segOk:cr?cr.segOk:0,segDesc:cr?cr.segDesc:0,
      litros,costo,estimado,nCargas:sel.length,lecturas,consumo,
      ultimaHr:ult?ult.hr:null,ultimaFecha:ult?ult.fecha:null,horasEspejoDe:e.horasEspejoDe||null});
    for(const c of sel)cargasTodas.push({...c,codN,rawCod,nombre,unidad});
  }
  cargasTodas.sort((a,b)=>b.fechaSort-a.fechaSort);
  return{grupo,equipos,cargas:cargasTodas,litrosPorMes,costoPorMes};
}

function _combFmtConsumo(v,unidad){
  if(v==null)return '—';
  return unidad==='km'?v.toFixed(2)+' km/L':v.toFixed(2)+' L/hr';
}
function _combFmtLectura(v,unidad){
  return v==null?'—':fmtInt(v)+' '+unidad;
}

function renderCombRangeBar(){
  const bar=document.getElementById('combRangeBar');
  if(!bar)return;
  const sel=new Set(_combYms());
  const meses=_combMesesDisponibles();
  const now=new Date();
  const fmtYm=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  const ult=n=>{const o=[];for(let i=0;i<n;i++)o.push(fmtYm(new Date(now.getFullYear(),now.getMonth()-i,1)));return o.filter(ym=>meses.includes(ym));};
  const anios=[...new Set(meses.map(ym=>ym.slice(0,4)))];
  const fill=(label,yms)=>html`<button class="kpi-range-btn" data-action="setCombMeses" data-arg="${yms.join(',')}">${label}</button>`;
  const chip=ym=>html`<button class="kpi-range-btn kpi-mes-chip${sel.has(ym)?' active':''}" data-action="toggleCombMes" data-arg="${ym}">${_ymCorto(ym)}</button>`;
  const atajos=[fill('mes',meses.slice(-1)),fill('últ 3m',ult(3)),fill('últ 6m',ult(6)),
    ...anios.map(a=>fill(a,meses.filter(ym=>ym.startsWith(a+'-')))),fill('todo',meses)];
  setHTML(bar, html`<span class="lbl">meses ›</span>${atajos}<span class="kpi-range-sep"></span>${meses.map(chip)}`);
}
function setCombMeses(yms){
  const arr=Array.isArray(yms)?yms:String(yms||'').split(',');
  window._combYmsSel=[...new Set(arr.filter(Boolean))].sort();
  window._combLimite=200;
  renderCombustibleTab();
}
function toggleCombMes(ym){
  const sel=new Set(_combYms());
  if(sel.has(ym))sel.delete(ym); else sel.add(ym);
  setCombMeses([...sel]);
}
function setCombGrupo(g){
  window._combGrupo=g==='livianos'?'livianos':'pesados';
  window._combFiltroEq=''; window._combBuscar=''; window._combLimite=200;
  renderCombustibleTab();
}
function onCombFiltroEquipo(v){ window._combFiltroEq=String(v||''); window._combLimite=200; _renderCombCargas(); }
function onCombBuscar(v){ window._combBuscar=String(v||'').trim().toLowerCase(); window._combLimite=200; _renderCombCargas(); }
function combVerMas(){ window._combLimite+=300; _renderCombCargas(); }

let _combDatosCache=null;

function renderCombustibleTab(){
  const root=document.getElementById('combWrap');
  if(!root)return;
  if(!window._combustiblePorEquipo){ setHTML(root, html`<div class="svc-empty">cargando…</div>`); return; }
  const D=_combDatosGrupo();
  _combDatosCache=D;
  const esLiv=D.grupo==='livianos';
  const unidad=esLiv?'km':'hr';
  const labelCons=esLiv?'km/L':'L/hr';
  const rango=_combLabelRango();

  // Selector de grupo
  const gBar=document.getElementById('combGrupoBar');
  if(gBar)setHTML(gBar, html`
    <button class="kpi-range-btn${esLiv?'':' active'}" data-action="setCombGrupo" data-arg="pesados">pesados · L/hr</button>
    <button class="kpi-range-btn${esLiv?' active':''}" data-action="setCombGrupo" data-arg="livianos">livianos · km/L</button>`);
  renderCombRangeBar();

  // Resumen
  const litros=D.equipos.reduce((s,e)=>s+e.litros,0);
  const costo=D.equipos.reduce((s,e)=>s+e.costo,0);
  const estimado=D.equipos.some(e=>e.estimado);
  const nCargas=D.cargas.length;
  const medibles=D.equipos.filter(e=>e.consumo!=null);
  const sinMed=D.equipos.filter(e=>e.consumo==null);
  const kpis=html`
    <div class="cb-kpi"><div class="cb-kpi-val">${fmtInt(litros)} L</div><div class="cb-kpi-lbl">litros cargados · ${rango}</div></div>
    <div class="cb-kpi"><div class="cb-kpi-val amber">${costo>0?formatMoney(costo)+(estimado?' ~':''):'—'}</div><div class="cb-kpi-lbl">${estimado?(esLiv?'gasto (parte estimado ~)':'gasto estimado · litros × precio ⚙'):'gasto real'}</div></div>
    <div class="cb-kpi"><div class="cb-kpi-val">${fmtInt(nCargas)}</div><div class="cb-kpi-lbl">cargas · ${fmtInt(D.equipos.length)} ${esLiv?'vehículos':'equipos'}</div></div>
    <div class="cb-kpi"><div class="cb-kpi-val">${fmtInt(medibles.length)}<small>/${fmtInt(D.equipos.length)}</small></div><div class="cb-kpi-lbl">con consumo medible (lecturas erróneas descartadas)</div></div>`;
  setHTML(document.getElementById('combKpis'), kpis);

  // Rankings
  // peor primero; los de unidad detectada distinta (camiones con horómetro) van al final, en L/hr
  const rk1=[...medibles].sort((a,b)=>{
    const oa=a.consUnidad!==unidad, ob=b.consUnidad!==unidad;   // unidad distinta a la del grupo → al final
    if(oa!==ob)return oa?1:-1;
    if(a.consUnidad==='km')return a.consumo-b.consumo;
    return b.consumo-a.consumo;
  });
  const rk2=[...D.equipos].sort((a,b)=>b.litros-a.litros);
  const bar=(v,max)=>html`<div class="cb-bar"><div class="cb-bar-fill" style="width:${max>0?Math.round(v/max*100):0}%"></div></div>`;
  const _nat=rk1.filter(e=>e.consUnidad===unidad);
  const maxC=_nat.length?Math.max(..._nat.map(e=>e.consumo)):0;
  const maxL=rk2.length?rk2[0].litros:0;
  const fila=(e,i,valHtml,barHtml,sub)=>html`<div class="cb-row" data-action="_irAEquipoDesdeKpi" data-arg="${e.rawCod}" title="Abrir detalle del equipo">
      <div class="cb-pos">${i+1}</div>
      <div class="svc-cod">${e.rawCod}</div>
      <div class="svc-nom" title="${e.nombre}">${e.nombre||'—'}<small>${sub}</small></div>
      <div class="svc-num cb-val">${valHtml}</div>
      ${barHtml}
    </div>`;
  const r1=document.getElementById('combRank1');
  setHTML(document.getElementById('combRank1Title'), html`ranking por consumo específico — ${esLiv?'menos rendidor primero (km/L)':'más gastador primero (L/hr)'} · ${rango}`);
  const _desc=e=>e.segDesc>0?html` · <span class="cb-warn" title="Tramos entre lecturas descartados por lectura que retrocede o consumo implausible">${e.segDesc} descart.</span>`:'';
  const _det=e=>e.horometro?html` · <span title="Este camión tiene horómetro, no odómetro">horómetro</span>`
    :e.unidadDetectada?html` · <span class="cb-warn" title="El odómetro no da valores plausibles: la columna trae el horómetro. Se informa en L/hr.">lectura en ${e.consUnidad==='hr'?'horas':'km'}</span>`:'';
  setHTML(r1, rk1.length?rk1.map((e,i)=>fila(e,i,html`${_combFmtConsumo(e.consumo,e.consUnidad)}`,e.consUnidad!==unidad?html`<div class="cb-bar"></div>`:bar(e.consumo,maxC),
      html`${fmtInt(e.litros)} L · ${e.segOk} tramos · últ. ${_combFmtLectura(e.ultimaHr,e.consUnidad)}${e.ultimaFecha?' ('+e.ultimaFecha+')':''}${_desc(e)}${_det(e)}`))
    :html`<div class="svc-empty">Ningún ${esLiv?'vehículo':'equipo'} tiene 2 lecturas de ${esLiv?'odómetro':'horómetro'} en el rango: no se puede medir consumo.</div>`);
  const r2=document.getElementById('combRank2');
  setHTML(document.getElementById('combRank2Title'), html`ranking por litros cargados · ${rango}`);
  setHTML(r2, rk2.length?rk2.map((e,i)=>fila(e,i,html`${fmtInt(e.litros)} L<small>${litros>0?Math.round(e.litros/litros*100):0}%</small>`,bar(e.litros,maxL),
      html`${e.nCargas} cargas${e.costo>0?' · '+formatMoney(e.costo)+(e.estimado?' ~':''):''}${e.consumo!=null?' · '+_combFmtConsumo(e.consumo,e.consUnidad):' · sin consumo medible'}`))
    :html`<div class="svc-empty">Sin cargas en el rango seleccionado.</div>`);
  const sm=document.getElementById('combSinMed');
  setHTML(sm, sinMed.length?html`<div class="cb-sinmed-title">sin consumo medible en el rango (${sinMed.length}) — sin dos lecturas plausibles de ${esLiv?'odómetro':'horómetro'}</div>
    <div class="cb-chips">${sinMed.map(e=>html`<button class="cb-chip" data-action="_irAEquipoDesdeKpi" data-arg="${e.rawCod}" title="${e.nombre} · ${e.nCargas} cargas, ${e.lecturas} con lectura${e.horasEspejoDe?' · horas vía '+e.horasEspejoDe:''}">${e.rawCod}<small>${e.lecturas}/${e.nCargas}</small></button>`)}</div>`:'');

  // Filtro de equipo para el historial
  const selEq=document.getElementById('combFiltroEq');
  if(selEq){
    const opts=[...D.equipos].sort((a,b)=>a.rawCod.localeCompare(b.rawCod));
    setHTML(selEq, html`<option value="">todos (${opts.length})</option>${opts.map(e=>html`<option value="${e.codN}"${e.codN===window._combFiltroEq?new RawHTML(' selected'):''}>${e.rawCod} · ${e.nombre}</option>`)}`);
    if(!opts.some(e=>e.codN===window._combFiltroEq))window._combFiltroEq='';
  }
  const inp=document.getElementById('combBuscar');
  if(inp&&inp.value.trim().toLowerCase()!==window._combBuscar)inp.value=window._combBuscar;

  _renderCombCargas();
  _renderCombChart(D);
}

function _renderCombCargas(){
  const D=_combDatosCache; if(!D)return;
  const wrap=document.getElementById('combCargas'); if(!wrap)return;
  const esLiv=D.grupo==='livianos';
  const q=window._combBuscar;
  let rows=D.cargas;
  if(window._combFiltroEq)rows=rows.filter(c=>c.codN===window._combFiltroEq);
  if(q)rows=rows.filter(c=>[c.rawCod,c.nombre,c.tipo,c.lugar,c.operario,c.obs,c.fecha].join(' ').toLowerCase().includes(q));
  const total=rows.length;
  const vis=rows.slice(0,window._combLimite);
  setHTML(document.getElementById('combCargasTitle'), html`cargas históricas · ${fmtInt(total)} ${total===1?'carga':'cargas'} · ${fmtInt(vis.reduce((s,c)=>s+(c.litros||0),0))} L${total>vis.length?' (mostrando '+fmtInt(vis.length)+')':''}`);
  if(!total){ setHTML(wrap, html`<div class="svc-empty">Sin cargas que coincidan.</div>`); return; }
  const head=html`<div class="cb-crow svc-head"><div>fecha</div><div>código</div><div>equipo</div><div class="svc-num">litros</div><div>tipo</div><div class="svc-num">lectura</div><div class="svc-num">costo</div><div>lugar</div><div>operario</div></div>`;
  const body=vis.map(c=>html`<div class="cb-crow" data-action="_irAEquipoDesdeKpi" data-arg="${c.rawCod}" title="${c.obs||'Abrir detalle del equipo'}">
      <div class="svc-num cb-fecha">${c.fecha||'—'}</div>
      <div class="svc-cod">${c.rawCod}</div>
      <div class="svc-nom" title="${c.nombre}">${c.nombre||'—'}</div>
      <div class="svc-num">${c.litros>0?fmtInt(c.litros):'—'}</div>
      <div class="cb-tipo">${c.tipo||'—'}</div>
      <div class="svc-num${c.hr==null?' cb-dim':''}">${c.hr!=null?fmtInt(c.hr)+' '+c.unidad:'sin lectura'}</div>
      <div class="svc-num"${c.costoEstimado?new RawHTML(' title="Estimado: litros × precio, no un monto cargado"'):''}>${c.costo>0?formatMoney(c.costo)+(c.costoEstimado?' ~':''):'—'}</div>
      <div class="cb-txt" title="${c.lugar}">${c.lugar||'—'}</div>
      <div class="cb-txt" title="${c.operario}">${c.operario||'—'}</div>
    </div>`);
  const mas=total>vis.length?html`<div class="cb-more"><button class="kpi-range-btn" data-action="combVerMas">ver ${fmtInt(Math.min(300,total-vis.length))} más</button></div>`:'';
  setHTML(wrap, html`${head}${body}${mas}`);
}

function _renderCombChart(D){
  if(typeof Chart==='undefined')return;
  const el=document.getElementById('chartComb'); if(!el)return;
  if(_chartComb){_chartComb.destroy();_chartComb=null;}
  const yms=Object.keys(D.litrosPorMes).filter(ym=>/^\d{4}-\d{2}$/.test(ym)&&+ym.slice(0,4)>=2020).sort();
  if(!yms.length)return;
  const sel=new Set(_combYms());
  const BLUE=_cssVar('--blue','#5d80e8'), AMBER=_cssVar('--amber','#ffa030');
  const GRID=_cssVar('--chart-grid','#1a2030'), TEXT2=_cssVar('--text2','#aab3c8');
  const TOOLTIP_BG=_cssVar('--chart-tooltip-bg','#0d1019'), TOOLTIP_FG=_cssVar('--chart-tooltip-fg','#f1f4fb');
  _chartComb=new Chart(el.getContext('2d'),{
    type:'bar',
    data:{labels:yms.map(_ymCorto),datasets:[
      {type:'bar',label:'Litros',data:yms.map(ym=>Math.round(D.litrosPorMes[ym]||0)),
        backgroundColor:yms.map(ym=>sel.has(ym)?BLUE+'cc':BLUE+'45'),borderColor:BLUE,borderWidth:1,maxBarThickness:44,yAxisID:'yL',order:2},
      {type:'line',label:'Gasto',data:yms.map(ym=>Math.round(D.costoPorMes[ym]||0)),
        borderColor:AMBER,backgroundColor:AMBER+'20',borderWidth:2,pointRadius:3.5,pointBackgroundColor:AMBER,pointBorderColor:'#fff',pointBorderWidth:1,tension:.3,fill:false,yAxisID:'y$',order:1},
    ]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:false},tooltip:{backgroundColor:TOOLTIP_BG,titleColor:TOOLTIP_FG,bodyColor:TOOLTIP_FG,padding:10,borderColor:GRID,borderWidth:1,
        titleFont:{family:'JetBrains Mono',size:11,weight:'600'},bodyFont:{family:'Inter',size:12},
        callbacks:{label:c=>c.dataset.label==='Litros'?'  ▣ '+fmtInt(c.raw)+' L':'  ─ '+formatMoney(c.raw)+(D.grupo==='pesados'?' (estimado)':'')}}},
      scales:{
        x:{ticks:{color:TEXT2,font:{size:11,family:'JetBrains Mono',weight:'500'}},grid:{display:false},border:{color:GRID}},
        yL:{type:'linear',position:'left',beginAtZero:true,title:{display:true,text:'litros',color:BLUE,font:{size:10,family:'JetBrains Mono',weight:'600'}},
          ticks:{color:TEXT2,font:{size:10,family:'JetBrains Mono'},callback:v=>v>=1000?(v/1000).toFixed(v>=10000?0:1)+'K':v},grid:{color:GRID,drawTicks:false},border:{display:false}},
        'y$':{type:'linear',position:'right',beginAtZero:true,title:{display:true,text:'$',color:AMBER,font:{size:10,family:'JetBrains Mono',weight:'600'}},
          ticks:{color:AMBER,font:{size:10,family:'JetBrains Mono'},callback:v=>v>=1e6?'$'+(v/1e6).toFixed(1)+'M':v>=1e3?'$'+(v/1e3).toFixed(0)+'K':'$'+v},grid:{display:false},border:{display:false}},
      }}
  });
}
