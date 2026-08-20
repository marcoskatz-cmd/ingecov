/* ══════════════════════════════════════════════════════════════════
   05-render.js — parte 5/8 de la app del panel INGECO.
   Los 8 archivos son SCRIPTS CLÁSICOS que comparten el mismo scope
   global y se cargan EN ORDEN (defer) desde index.html: mover uno de
   lugar rompe las dependencias. No convertir a type=module sin
   revisar ACTIONS y el bootstrap del PIN.
══════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════
   RENDER PRINCIPAL
═══════════════════════════════════════════════════════ */
function renderDashboard(pendientesRaw,entregasMesParsed){
  // Pedidos
  const todosLosPedidos=pendientesRaw
    .filter(r=>r[0]&&!isNaN(parseFloat(r[0]))&&r[2]&&r[5])
    .map(r=>({nro:r[0],fecha:r[1],equipo:r[2],codigo:normCod(r[3]),codigoRaw:r[3]||'—',desc:r[4],estado:r[5],orden:r[6]||'',nroEntrega:r[7]||''}));
  const pendActivos=todosLosPedidos.filter(p=>{const l=p.estado.toLowerCase();return l.includes('pendiente')||l.includes('parcial')||l.includes('comprado');}).length;
  window._pedidosAll=todosLosPedidos;

  // Set de códigos (normalizados) con AL MENOS un pedido activo — para marcar visualmente las cards
  window._equiposConPendientes=new Set(
    todosLosPedidos
      .filter(p=>{const l=p.estado.toLowerCase();return l.includes('pendiente')||l.includes('parcial')||l.includes('comprado');})
      .map(p=>p.codigo)
      .filter(Boolean)
  );

  // Lookup {N° PEDIDO → fecha de creación} desde PENDIENTES.
  // La hoja ENTREGADOS no carga FECHA PEDIDO; para calcular demora hay que cruzar por N°.
  // Si un N° aparece duplicado, conservamos la fecha más antigua (primer ingreso).
  window._fechaPedidoByNro={};
  for(const p of todosLosPedidos){
    const nro=String(p.nro||'').trim();
    if(!nro||!p.fecha)continue;
    const prev=window._fechaPedidoByNro[nro];
    if(!prev||toSortDate(p.fecha)<toSortDate(prev)){
      window._fechaPedidoByNro[nro]=p.fecha;
    }
  }

  // Entregas del mes actual (parser de formulario)
  const entregas=(entregasMesParsed||[]).filter(e=>e.equipo&&e.equipo.trim());
  entregas.sort((a,b)=>parseInt(b.nro||0)-parseInt(a.nro||0));
  // Adaptar al shape esperado por el modal (que lee e['EQUIPO']/e['CÓDIGO']/e['COSTO']/e['N° ENTREGA'])
  window._entregasAll=entregas.map(e=>({
    'EQUIPO':e.equipo||'',
    'CÓDIGO':e.codigo||'',
    'CODIGO':e.codigo||'',
    'COSTO':e.costo||'',
    'N° ENTREGA':e.nro||'',
    'FECHA':e.fecha||'',
  }));
  const totalCostoMes=entregas.reduce((s,e)=>s+(e.costoNum||0),0);
  const entConCosto=entregas.filter(e=>(e.costoNum||0)>0).length;

  // Equipos en reparación (estado amber según _estadoEquipos)
  const enReparacion=Object.values(window._estadoEquipos||{}).filter(info=>ESTADO_COLOR(info.estado)==='amber').length;

  // Horas totales en taller 2026 (sumadas de PANEL_TRABAJOS), con split correctivo/preventivo.
  const _hf=window._horasFlota||{prev:0,corr:0,total:0};
  const horasTotalFlota=_hf.total||0;
  const _horasCorr=_hf.corr||0, _horasPrev=_hf.prev||0;
  const _corrPct=horasTotalFlota>0?Math.round(_horasCorr/horasTotalFlota*100):0;
  const _prevPct=horasTotalFlota>0?100-_corrPct:0;

  // Operativos absolutos (estado green en _estadoEquipos)
  const operativosAbs=Object.values(window._estadoEquipos||{}).filter(info=>ESTADO_COLOR(info.estado)==='green').length;
  const totalEquipos=Object.keys(window._estadoEquipos||{}).length;

  // Service: operatividad de cada equipo del PROGRAMA DE TRABAJOS DE SERVICE.
  // operatividadEquipo() ya resuelve la hr/km actual (combustible > programa de service)
  // y clasifica en holgado / intermedio / critico. Armamos la lista de críticos para el modal.
  let serviceCritico=0, serviceAmber=0, serviceGreen=0, serviceConDatos=0;
  const sp=window._servicePanel||{};
  const _criticosList=[];
  for(const codN of Object.keys(sp)){
    const op=operatividadEquipo(codN);
    if(op.nivel==='sin-datos')continue;
    serviceConDatos++;
    if(op.nivel==='critico'){
      serviceCritico++;
      const info=(window._estadoEquipos||{})[codN]||{};
      _criticosList.push({
        codN,
        codigo: info.rawCod || sp[codN].codigo || codN,
        nombre: info.equipo || sp[codN].descripcion || '',
        hrActual: op.hrActual,
        hrActualFmt: op.hrActual!=null ? fmtInt(op.hrActual) : '—',
        estimado: op.hrProximo,
        estimadoFmt: op.hrProximo!=null ? fmtInt(op.hrProximo) : '—',
        restantes: op.restantes,
        fuente: op.fuente,
        ultFecha: sp[codN].ultFecha || '',
      });
    }
    else if(op.nivel==='intermedio')serviceAmber++;
    else serviceGreen++;
  }
  // Más pasado (restantes más negativo) primero.
  _criticosList.sort((a,b)=>{
    const ra=a.restantes==null?Infinity:a.restantes;
    const rb=b.restantes==null?Infinity:b.restantes;
    return ra-rb;
  });
  window._serviceCriticosList=_criticosList;
  try{ renderServiceTab(); }catch(e){ console.warn('[INGECO] service tab:',e); }

  const serviceClass=serviceCritico>0?'red':(serviceAmber>0?'amber':'green');
  const serviceSub=serviceConDatos>0
    ? `${serviceAmber} intermedio · ${serviceGreen} holgado · ${Object.keys(sp).length-serviceConDatos} sin datos`
    : (Object.keys(sp).length>0 ? 'falta cargar rangos/frecuencia' : 'sin datos en PROGRAMA DE SERVICE');

  // VTV crítica: vehículos con ≤VTV_UMBRAL_DIAS días para vencer, o ya vencidos
  // (días negativos). Lista incompleta a propósito (Marcos la va completando) →
  // el sub muestra cuántos equipos tienen VTV cargada sobre el total de la flota.
  const vtvAll=Object.values(window._vtvPorEquipo||{});
  const vtvCriticosArr=vtvAll.filter(v=>v.dias<=VTV_UMBRAL_DIAS).sort((a,b)=>a.dias-b.dias);
  window._vtvCriticosList=vtvCriticosArr.map(v=>{
    const info=(window._estadoEquipos||{})[v.codN]||{};
    return{
      codN:v.codN, codigo:v.codigo,
      nombre:buildEquipoNombre(info.clasificacion,info.marca,info.modelo,info.equipo)||v.equipo||v.codigo,
      patente:v.patente||info.patente||'',
      vencimiento:v.vencimiento, dias:v.dias,
    };
  });
  const vtvVencidas=vtvCriticosArr.filter(v=>v.dias<0).length;
  const vtvPorVencer=vtvCriticosArr.length-vtvVencidas;
  const vtvConDatos=vtvAll.length;
  const vtvClass=vtvCriticosArr.length>0?'red':'green';
  const _kpiVtvEmpty=!(vtvConDatos>0);
  const vtvSub=vtvConDatos>0
    ? `${vtvVencidas} vencida${vtvVencidas===1?'':'s'} · ${vtvPorVencer} por vencer · ${vtvConDatos}/${totalEquipos||'—'} con VTV cargada`
    : 'sin datos de VTV cargados';

  // KPIs (8: operativos, pedidos activos, reparación, service crítico, costo mes,
  // horas taller, combustible livianos, combustible pesados)
  // Cualquier KPI cuyo valor numérico real sea 0 o no haya dato se renderiza con clase
  // .kpi-empty para atenuar visualmente; los KPIs con valor compiten por la atención.
  const _kpiCostoEmpty = !(totalCostoMes>0);
  const _kpiHorasEmpty = !(horasTotalFlota>0);
  const _kpiServiceEmpty = !(serviceConDatos>0);
  // Combustible livianos: gasto por mes, con selector. Default = mes más reciente.
  const _gcMes=window._gastoCombLivianosPorMes||{};
  const _gcCargas=window._cargasCombLivianosPorMes||{};
  const _gcMeses=Object.keys(_gcMes).sort().reverse();
  const _gcDefault=_gcMeses[0]||'';
  const _gcVal=_gcDefault?(_gcMes[_gcDefault]||0):(window._gastoCombLivianos||0);
  const _gcOpts=['<option value="all">Acumulado</option>']
    .concat(_gcMeses.map(ym=>`<option value="${ym}"${ym===_gcDefault?' selected':''}>${ymLabel(ym)}</option>`))
    .join('');
  const _gcSub=_gcDefault?`${fmtInt(_gcCargas[_gcDefault]||0)} cargas · ${ymLabel(_gcDefault)}`:'gasto · vehículos livianos';
  const _gcEmpty=!(_gcVal>0)&&!(window._gastoCombLivianos>0);
  const svKpiAttrs = serviceCritico>0
    ? html` data-action="openServiceCriticoModal" title="Ver lista de equipos críticos"`
    : '';
  const vtvKpiAttrs = vtvCriticosArr.length>0
    ? html` data-action="openVtvCriticaModal" title="Ver lista de VTV críticas"`
    : '';
  setHTML(document.getElementById('kpiGrid'), html`
    <div class="kpi${totalEquipos?'':' kpi-empty'}"><div class="kpi-label">operativos</div><div class="kpi-val green">${fmtInt(operativosAbs)}<span style="font-size:18px;color:var(--text3);font-weight:400"> / ${totalEquipos?fmtInt(totalEquipos):'—'}</span></div><div class="kpi-sub">estado verde en CÓDIGOS</div><div class="kpi-accent-bar green"></div></div>
    <div class="kpi${pendActivos?'':' kpi-empty'}"><div class="kpi-label">pedidos activos</div><div class="kpi-val ${pendActivos>10?'red':'amber'}">${fmtInt(pendActivos)}</div><div class="kpi-sub">pendiente · parcial · comprado</div><div class="kpi-accent-bar ${pendActivos>10?'red':'amber'}"></div></div>
    <div class="kpi${enReparacion?'':' kpi-empty'}"><div class="kpi-label">equipos en reparación</div><div class="kpi-val amber">${fmtInt(enReparacion)}</div><div class="kpi-sub">estado naranja en CÓDIGOS</div><div class="kpi-accent-bar amber"></div></div>
    <div class="kpi${_kpiServiceEmpty?' kpi-empty':''}${serviceCritico>0?' kpi-clickable':''}"${svKpiAttrs}><div class="kpi-label">service crítico</div><div class="kpi-val ${serviceClass}">${fmtInt(serviceCritico)}</div><div class="kpi-sub">${serviceSub}</div><div class="kpi-accent-bar ${serviceClass}"></div></div>
    <div class="kpi${_kpiCostoEmpty?' kpi-empty':' kpi-clickable'}" id="kpiCostoCard" data-action="abrirDetalleKpi" data-arg="costo" title="Ver desglose por equipo"><div class="kpi-label">costo en repuestos</div><div class="kpi-val amber" id="kpiCostoVal">${totalCostoMes>0?formatMoney(totalCostoMes):'—'}</div><div class="kpi-sub" id="kpiCostoSub">${MES_ACTUAL.label} · ${fmtInt(entConCosto)} entregas con costo</div><div class="kpi-accent-bar amber"></div></div>
    <div class="kpi${_kpiHorasEmpty?' kpi-empty':' kpi-clickable'}" id="kpiHorasCard" data-action="abrirDetalleKpi" data-arg="horas" title="Ver desglose por equipo"><div class="kpi-label">horas en taller</div><div class="kpi-val" id="kpiHorasVal">${horasTotalFlota>0?fmtInt(Math.round(horasTotalFlota))+' hr':'—'}</div><div class="kpi-sub${horasTotalFlota>0?' hr-split':''}" id="kpiHorasSub">${horasTotalFlota>0?new RawHTML(`<div class="hr-split-bar"><span class="corr" style="width:${_corrPct}%"></span><span class="prev" style="width:${_prevPct}%"></span></div><span class="hr-split-leg"><i class="corr"></i>${fmtInt(Math.round(_horasCorr))} hr correctivo · ${_corrPct}%</span><span class="hr-split-leg"><i class="prev"></i>${fmtInt(Math.round(_horasPrev))} hr preventivo · ${_prevPct}%</span>`):'acumuladas · flota'}</div><div class="kpi-accent-bar blue"></div></div>
    <div class="kpi${_gcEmpty?' kpi-empty':' kpi-clickable'}" id="kpiCombCard" data-action="abrirDetalleKpi" data-arg="combustible" title="Ver desglose por equipo"><div class="kpi-label">combustible livianos</div><div class="kpi-val amber" id="kpiCombVal">${_gcVal>0?formatMoney(_gcVal):'—'}</div><div class="kpi-sub" id="kpiCombSub">${_gcSub}</div><div class="kpi-accent-bar amber"></div></div>
    <div class="kpi kpi-empty" id="kpiCombPesCard" data-action="abrirDetalleKpi" data-arg="combustiblePesados" title="Ver desglose por equipo"><div class="kpi-label">combustible pesados</div><div class="kpi-val" id="kpiCombPesVal">—</div><div class="kpi-sub" id="kpiCombPesSub">equipos pesados</div><div class="kpi-accent-bar blue"></div></div>
    <div class="kpi${_kpiVtvEmpty?' kpi-empty':''}${vtvCriticosArr.length>0?' kpi-clickable':''}"${vtvKpiAttrs}><div class="kpi-label">VTV crítica</div><div class="kpi-val ${vtvClass}">${fmtInt(vtvCriticosArr.length)}</div><div class="kpi-sub">${vtvSub}</div><div class="kpi-accent-bar ${vtvClass}"></div></div>
  `);

  // Cablear status bar superior — telemetría en vivo del estado de la flota
  (function updateStatusBar(){
    const states=Object.values(window._estadoEquipos||{});
    const total=states.length;
    const oper=states.filter(i=>ESTADO_COLOR(i.estado)==='green').length;
    const rep=states.filter(i=>ESTADO_COLOR(i.estado)==='amber').length;
    const down=states.filter(i=>ESTADO_COLOR(i.estado)==='red').length;
    const set=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=val;};
    set('hsEq', total?fmtInt(total):'—');
    set('hsOp', total?`${fmtInt(oper)}/${fmtInt(total)}`:'—');
    set('hsRep', fmtInt(rep));
    set('hsDown', fmtInt(down));
    set('hsPend', fmtInt(pendActivos));
  })();

  // Catálogo de equipos — única fuente: hoja de CÓDIGOS (ya parseada en _estadoEquipos)
  // Los datos de entregas/pedidos NO inyectan equipos nuevos; solo se adjuntan a los existentes.
  const equiposOrdenados=Object.entries(window._estadoEquipos||{}).map(([codN,info])=>({
    codigo:info.rawCod||codN,
    nombre:info.equipo||info.rawCod||codN,
    marca:info.marca||'',
    modelo:info.modelo||'',
    clasificacion:info.clasificacion||'',
    categoria:info.categoria||'',
    ingresos:0,
    costoTotal:0,
  })).sort((a,b)=>a.codigo.localeCompare(b.codigo));
  window._equiposOrdenados=equiposOrdenados;
  renderEquipoIndex(equiposOrdenados);
}

/* ═══════════════════════════════════════════════════════
   DETALLE DE EQUIPO
═══════════════════════════════════════════════════════ */
let _activeEqCard=null;

/**
 * Reubica el panel detalle en el DOM para que aparezca inmediatamente debajo de la
 * tarjeta clickeada (modo grid: al final de la fila visual; modo lista: justo después
 * de la fila). Evita el scroll de "subir-y-bajar" cuando hay muchos equipos.
 */
function placeDetailPanelNearCard(cardEl){
  const panel=document.getElementById('equipoDetailPanel');
  if(!panel||!cardEl)return;
  // El grid puede ser el principal (#equipoGrid) o el de la sección de inactivos.
  const grid=cardEl.closest('#equipoGrid, .equipo-grid')||document.getElementById('equipoGrid');
  if(!grid)return;

  // Modo lista: el wrap es el contenedor; insertamos después de la fila clickeada.
  const wrap=grid.querySelector('.equipo-list-wrap');
  if(wrap&&wrap.contains(cardEl)){
    if(cardEl.nextElementSibling!==panel)cardEl.insertAdjacentElement('afterend',panel);
    return;
  }

  // Modo grid: detectamos qué tarjetas comparten fila visual (mismo offsetTop)
  // y colgamos el panel después de la última de esa fila.
  // Filtramos las ocultas (display:none → offsetTop=0) para no contaminar el match.
  const cards=Array.from(grid.querySelectorAll(':scope > .equipo-card'))
    .filter(c=>!c.classList.contains('hidden'));
  if(!cards.length)return;
  const top=cardEl.offsetTop;
  let lastInRow=cardEl;
  for(const c of cards){
    if(c.offsetTop===top)lastInRow=c;
  }
  if(lastInRow.nextElementSibling!==panel)lastInRow.insertAdjacentElement('afterend',panel);
}

// Reubicar el panel si cambia el ancho de ventana (las filas del grid cambian).
window.addEventListener('resize',()=>{
  if(_activeEqCard&&document.getElementById('equipoDetailPanel')?.classList.contains('open')){
    placeDetailPanelNearCard(_activeEqCard);
  }
});

async function toggleEquipoDetail(codigo,cardEl){
  const panel=document.getElementById('equipoDetailPanel');
  if(_activeEqCard===cardEl&&panel.classList.contains('open')){closeEquipoDetail();return;}
  if(_activeEqCard)_activeEqCard.classList.remove('active');
  _activeEqCard=cardEl;cardEl.classList.add('active');
  placeDetailPanelNearCard(cardEl);
  const codN=normCod(codigo);
  const info0=(window._estadoEquipos||{})[codN];
  const entMes=(window._entregasAll||[]).filter(e=>normCod(e['CÓDIGO']||e['CODIGO']||'')===codN);
  const marca=info0?.marca||'';
  const modelo=info0?.modelo||'';
  const descripcion=info0?.equipo||entMes[0]?.['EQUIPO']||(window._pedidosAll||[]).find(p=>p.codigo===codN)?.equipo||'';
  const clasif=info0?.clasificacion||TIPO_EQUIPO(codigo);
  const nombre=buildEquipoNombre(clasif,marca,modelo,descripcion||codigo);
  const patente=(window._horometros||{})[normCod(codigo)]?.patente||info0?.patente||null;

  // Suma TODOS los meses 2026 con datos para este equipo (antes recorría la
  // lista fija MESES_ENTREGAS, que se dejó de actualizar en mayo y sub-contaba
  // jun/jul/ago — window._costosPorMes es la fuente viva, con todos los meses).
  const costosPorMes=window._costosPorMes||{};
  const costoTotal2026=Object.keys(costosPorMes)
    .filter(ym=>ym.startsWith('2026-'))
    .reduce((s,ym)=>s+((costosPorMes[ym]||{})[codN]||0),0);

  // Subtítulo: la clasif ya está en el título principal, así que solo mostramos
  // tags complementarios (patente y descripción del catálogo cuando agrega info).
  const mostrarDesc=descripcion&&normCod(descripcion)!==normCod(nombre);
  const subTags=[
    patente?html`<span class="eq-detail-tag">📋 ${patente}</span>`:'',
    mostrarDesc?html`<span class="eq-detail-tag" style="opacity:.85">${descripcion}</span>`:'',
  ].filter(Boolean);

  document.getElementById('eqDetailTitle').textContent=nombre;
  setHTML(document.getElementById('eqDetailSub'), html`<span>${codigo}</span>${subTags}`);
  setHTML(document.getElementById('eqDetailBody'),
    html`<div style="padding:2rem;text-align:center;font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--text3)">cargando historial...</div>`);
  panel.classList.add('open');
  setTimeout(()=>panel.scrollIntoView({behavior:'smooth',block:'nearest'}),60);
  _secCounter=0;

  const[serviceRows,trabajosRows]=await Promise.all([
    (async()=>{
      // Service por equipo: leido del snapshot (SERVICE_EQ, una fila por planilla-equipo-mes).
      // Cacheado por precargarHorometros() en window._serviceEqRows; fallback al snapshot directo.
      let rows=window._serviceEqRows;
      if(!rows){ try{ rows=await fetchGvizObj(SNAPSHOT_ID,'SERVICE_EQ'); window._serviceEqRows=rows; }catch(_){ rows=[]; } }
      const _sp=s=>String(s||'').toUpperCase().replace(/\s+/g,'');
      const out=[];
      for(const r of rows){
        if(String(r['CODN']||'').trim()!==normCod(codigo))continue;
        if(_sp(r['KVCOD'])!==_sp(codigo))continue;
        out.push({
          planilla:String(r['PLANILLA']||'').trim()||'\u2014',
          fecha:String(r['FECHA']||'').trim()||'\u2014',
          personal:String(r['PERSONAL']||'').trim()||'\u2014',
          horActual:r['ACTUAL']||null,
          horProximo:r['PROXIMO']||null,
          serie:r['SERIE']||null,
          mes:r['MES']||'',sheetId:r['SHEET_ID']||'',
        });
      }
      return out.sort((a,b)=>toSortDate(b.fecha)-toSortDate(a.fecha));
    })(),
    loadTrabajosRegistro(codigo),
  ]);

  // El más reciente alimenta la caja de horómetro y el link a planilla
  const serviceRow=serviceRows[0]||null;

  // Helper: lookup tolerante de columnas en un objeto-fila (tolera tildes, espacios, mayúsculas, °/º/N°/Nº)
  const normH=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase().replace(/º/g,'').replace(/°/g,'').replace(/[#]/g,'').replace(/\s+/g,'').trim();
  const pickCol=(obj,candidates)=>{
    if(!obj)return'';
    const idx={};
    for(const k of Object.keys(obj))idx[normH(k)]=obj[k];
    for(const c of candidates){
      const v=idx[normH(c)];
      if(v!=null&&String(v).trim()!==''&&String(v).trim()!=='-')return String(v).trim();
    }
    return'';
  };
  const COLS_PED={
    codigo:    ['CODIGO','COD','CODIGO EQUIPO','COD EQUIPO'],
    nroPedido: ['N° PEDIDO','Nº PEDIDO','N PEDIDO','NRO PEDIDO','NUMERO PEDIDO','PEDIDO','N° DE PEDIDO'],
    fechaPed:  ['FECHA PEDIDO','FECHA DEL PEDIDO','FECHA DE PEDIDO','F PEDIDO','F. PEDIDO','FECHA INGRESO','FECHA DE INGRESO','FECHA DEL INGRESO','F INGRESO','F. INGRESO','INGRESO','FECHA CREACION','FECHA DE CREACION','FECHA'],
    desc:      ['DESCRIPCIÓN DE REPUESTOS ENTREGADOS','DESCRIPCION DE REPUESTOS ENTREGADOS','DESCRIPCIÓN DE REPUESTOS','DESCRIPCION DE REPUESTOS','DESCRIPCION REPUESTOS','DESCRIPCION','DESCRIPCIÓN','DETALLE DE REPUESTOS','DETALLE','REPUESTOS','REPUESTOS PEDIDOS'],
    nroEntrega:['N° ENTREGA','Nº ENTREGA','N ENTREGA','NRO ENTREGA','NUMERO ENTREGA','ENTREGA','N° DE ENTREGA'],
    fechaEnt:  ['FECHA ENTREGA','FECHA DE ENTREGA','F ENTREGA','F. ENTREGA'],
  };

  const pedidosHist=(window._pedidosEntregados||[]).filter(p=>normCod(pickCol(p,COLS_PED.codigo))===codN);
  const pedidosActivos=(window._pedidosAll||[]).filter(p=>p.codigo===codN);
  const totalPedidos=pedidosHist.length+pedidosActivos.length;

  // Info de estado
  const info=(window._estadoEquipos||{})[codN];
  const est=ESTADO_COLOR(info?.estado);

  // Combustible: resumen del equipo (puede ser undefined si nunca cargó combustible)
  const comb=(window._combustiblePorEquipo||{})[codN];
  const _unidad=comb?.unidad||unidadDeEquipo(codigo);
  const _consumoLabel=_unidad==='km'?'L/100km':'L/hr';
  const _consumoTxt=comb?.promedio!=null
    ? `${comb.promedio.toFixed(_unidad==='km'?1:2)} <span style="font-size:13px;color:var(--text3);font-weight:400">${_consumoLabel}</span>`
    : '—';
  const _consumoSub=comb?.cargas?.length
    ? `${fmtInt(comb.totalLitros)} L en ${comb.cargas.length} cargas`
    : 'sin cargas registradas';

  // Gasto de combustible del MES EN CURSO (antes mostraba comb.totalCosto,
  // el acumulado histórico completo — engañoso al lado de un KPI "entregas
  // <mes>"). Mes real del reloj, no MES_ACTUAL (ese queda pisado en mayo
  // desde que se dejaron de sumar archivos a MESES_ENTREGAS).
  const _hoyYm=(()=>{const h=new Date();return h.getFullYear()+'-'+String(h.getMonth()+1).padStart(2,'0');})();
  const _cargasMes=(comb?.cargas||[]).filter(c=>{
    const d=_parseDate(c.fecha);
    return d&&(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'))===_hoyYm;
  });
  const _gastoCombMes=_cargasMes.reduce((s,c)=>s+(c.costo||0),0);
  const _gastoCombEstimado=_cargasMes.some(c=>c.costoEstimado);
  const _gastoCombMesSub=_cargasMes.length
    ?`${fmtInt(_cargasMes.length)} cargas · ${ymLabel(_hoyYm)}${_gastoCombEstimado?' · estimado (litros × precio configurado)':''}`
    :'sin cargas este mes';

  // KPIs
  const kpisHTML=`
    <div class="eq-kpis">
      <div class="eq-kpi"><div class="eq-kpi-val amber">${costoTotal2026>0?formatMoney(costoTotal2026):'—'}</div><div class="eq-kpi-label">costo repuestos 2026</div></div>
      <div class="eq-kpi"><div class="eq-kpi-val">${entMes.length}</div><div class="eq-kpi-label">entregas ${MES_ACTUAL.label}</div></div>
      <div class="eq-kpi"><div class="eq-kpi-val">${totalPedidos}</div><div class="eq-kpi-label">pedidos 2026</div></div>
      <div class="eq-kpi" title="${_consumoSub}"><div class="eq-kpi-val">${_consumoTxt}</div><div class="eq-kpi-label">consumo promedio</div></div>
      <div class="eq-kpi" title="${_gastoCombMesSub}"><div class="eq-kpi-val amber">${_gastoCombMes>0?formatMoney(_gastoCombMes):'—'}</div><div class="eq-kpi-label">gasto combustible ${ymLabel(_hoyYm)}</div></div>
    </div>`;

  // Estado operativo
  const tenInfo=(info?.tenencia==='propio'||info?.tenencia==='alquilado')?info:null;
  const tenColor=tenInfo?.tenencia==='propio'?'var(--green)':'var(--amber)';
  const tenLabelDet=tenInfo?(tenInfo.observacion||(tenInfo.tenencia==='propio'?'Propio':'Alquilado')):'';
  const tenTag=tenInfo?`<span style="color:${tenColor};font-weight:600;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase">◆ ${tenLabelDet}</span>`:'';
  const infoBar=info?.estado?`
    <div style="display:flex;gap:14px;background:var(--bg3);border:1px solid var(--border);padding:9px 14px;margin-bottom:12px;font-size:12px;flex-wrap:wrap;align-items:center;border-left:3px solid ${ESTADO_CSS[est]}">
      <span style="font-weight:600;color:${ESTADO_CSS[est]}">${info.estado}</span>
      ${tenTag}
      ${info.ubicacion?`<span style="color:var(--text2)">📍 ${info.ubicacion}</span>`:''}
      ${info.operario?`<span style="color:var(--text2)">👤 ${info.operario}</span>`:''}
      ${info.fecha?`<span style="color:var(--text3);font-size:11px;font-family:'IBM Plex Mono',monospace">act. ${info.fecha}</span>`:''}
    </div>`:
    (tenInfo?`
    <div style="display:flex;gap:14px;background:var(--bg3);border:1px solid var(--border);padding:9px 14px;margin-bottom:12px;font-size:12px;flex-wrap:wrap;align-items:center">
      ${tenTag}
      <span style="color:var(--text3)">Sin datos de estado operativo</span>
    </div>`:
    `<div style="background:var(--bg3);border:1px solid var(--border);padding:9px 14px;margin-bottom:12px;font-size:12px;color:var(--text3)">Sin datos de estado operativo</div>`);

  // Service / Horómetro — preferimos PANEL_PROGRAMA, fallback a planilla del mes (serviceRow)
  const sp=(window._servicePanel||{})[codN]||null;
  let horHTML='';
  if(sp){
    // Operatividad del resumen de service. operatividadEquipo() toma la hr/km
    // actual SOLO del RESUMEN (fuente única curada; ver nota en la función).
    const op=operatividadEquipo(codN);
    const ultHr = op.hrActual!=null ? op.hrActual : (sp.ultHrKm||serviceRow?.horActual||'—');
    const ultFecha = sp.ultFecha||serviceRow?.fecha||serviceRow?.mes||'—';
    const ultFuente = op.fuente?`vía ${op.fuente}`:'';
    const estHr=sp.estHrKm||serviceRow?.horProximo||'—';
    const frec=sp.frecuencia||'—';
    const estadoColor=op.color;
    const estadoLabel=op.label.toUpperCase();
    const restantes=op.restantes;
    const restantesTxt=restantes!=null?(restantes>=0?`faltan ${restantes.toLocaleString('es-AR')}`:`vencido ${Math.abs(restantes).toLocaleString('es-AR')}`):'';

    horHTML=`
    <div style="background:var(--bg3);border:1px solid var(--border);border-left:3px solid ${estadoColor};margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border-bottom:1px solid var(--border);background:var(--bg2)">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;color:${estadoColor};letter-spacing:.1em">● OPERATIVIDAD ${estadoLabel}</span>
          ${restantesTxt?`<span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--text2)">${restantesTxt}</span>`:''}
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap">
        <div style="flex:1;min-width:140px;padding:10px 14px;border-right:1px solid var(--border)">
          <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:3px">Última lectura hr/km</div>
          <div style="font-size:15px;color:var(--blue);font-family:'IBM Plex Mono',monospace;font-weight:500">${typeof ultHr==='number'?fmtInt(ultHr):ultHr}</div>
          <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text3);margin-top:2px">${ultFecha}${ultFuente?` <span style="color:var(--amber)">· ${ultFuente}</span>`:''}</div>
        </div>
        <div style="flex:1;min-width:140px;padding:10px 14px;border-right:1px solid var(--border)">
          <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:3px">Próximo service</div>
          <div style="font-size:15px;color:${estadoColor};font-family:'IBM Plex Mono',monospace;font-weight:500">${typeof estHr==='number'?fmtInt(estHr):estHr}</div>
        </div>
        <div style="flex:1;min-width:120px;padding:10px 14px">
          <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:3px">Frecuencia</div>
          <div style="font-size:15px;color:var(--text2);font-family:'IBM Plex Mono',monospace;font-weight:500">${frec}</div>
          ${sp.patente?`<div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text3);margin-top:2px">${sp.patente}</div>`:''}
        </div>
      </div>
    </div>`;
  } else if(serviceRow?.horActual){
    // Fallback al sistema viejo (SERVICE_MESES) cuando PANEL_PROGRAMA no tiene al equipo
    horHTML=`
    <div style="display:flex;background:var(--bg3);border:1px solid var(--border);margin-bottom:12px;overflow:hidden">
      <div style="flex:1;padding:10px 14px;border-right:1px solid var(--border)">
        <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:3px">Horóm./Odóm. actual</div>
        <div style="font-size:15px;color:var(--blue);font-family:'IBM Plex Mono',monospace;font-weight:500">${serviceRow.horActual}</div>
      </div>
      <div style="flex:1;padding:10px 14px;border-right:1px solid var(--border)">
        <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:3px">Próximo service</div>
        <div style="font-size:15px;color:var(--amber);font-family:'IBM Plex Mono',monospace;font-weight:500">${serviceRow.horProximo||'—'}</div>
      </div>
      <div style="padding:10px 14px;min-width:120px">
        <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:3px">Último service</div>
        <div style="font-size:12px;color:var(--text2)">${serviceRow.mes}</div>
        ${serviceRow.serie?`<div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text3);margin-top:2px">${serviceRow.serie}</div>`:''}
      </div>
    </div>`;
  } else if(comb?.ultimaHr!=null){
    // Equipo sin planilla de service pero con lectura de horómetro/odómetro vía
    // combustible. Cubre el caso espejo: la trituradora (sin horómetro propio)
    // hereda la última lectura de la zaranda con la que comparte tren de chancado.
    const _hu=_unidad==='km'?'km':'hr';
    const _fc=comb.ultimaFecha?formatFechaCorta(comb.ultimaFecha):'';
    const _src=comb.horasEspejoDe?`vía zaranda ${comb.horasEspejoDe}`:'vía combustible';
    horHTML=`
    <div style="display:flex;background:var(--bg3);border:1px solid var(--border);border-left:3px solid var(--blue);margin-bottom:12px;overflow:hidden">
      <div style="flex:1;padding:10px 14px">
        <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:3px">Última lectura ${_hu}</div>
        <div style="font-size:15px;color:var(--blue);font-family:'IBM Plex Mono',monospace;font-weight:500">${fmtInt(comb.ultimaHr)} ${_hu}</div>
        <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text3);margin-top:2px">${_fc}${_fc?' ':''}<span style="color:var(--amber)">· ${_src}</span></div>
      </div>
    </div>`;
  }

  // Sección 1: Servicios y reparaciones
  const filasServicio=[];
  for(const sr of serviceRows){
    filasServicio.push({ref:`Nº ${sr.planilla}`,fecha:sr.fecha,tipo:'service',
      desc:`Service — Personal: ${sr.personal}`,lugar:sr.mes,tiempo:'—',_ts:toSortDate(sr.fecha)});
  }
  // Acumulador de horas totales + split correctivo/preventivo
  let totalHoras=0, horasPrevEq=0, horasCorrEq=0;
  for(const r of trabajosRows){
    const desc=r.desc;
    if(!desc)continue;
    const fecha=r.fecha;
    // Parsear horas: acepta "3", "3 horas", "0,5 horas", "1 hora", etc.
    // parseFloat ya ignora el sufijo de texto. La coma decimal se cambia a punto.
    const tNum=parseFloat(String(r.tiempo||'').replace(',','.'));
    const tiempoFmt=isFinite(tNum)&&tNum>0
      ?(Number.isInteger(tNum)?tNum:tNum.toFixed(1))+' hr'
      :'—';
    // Clasificar este trabajo: preventivo (service/mantenimiento) o correctivo (reparación/neumáticos)
    const tipoTrabajo=clasificarTrabajo(r.razon,desc);
    if(isFinite(tNum)&&tNum>0){
      totalHoras+=tNum;
      if(tipoTrabajo==='preventivo')horasPrevEq+=tNum; else horasCorrEq+=tNum;
    }
    filasServicio.push({ref:'—',fecha,tipo:tipoTrabajo,
      desc:desc.length>200?desc.slice(0,197)+'…':desc,
      lugar:r.lugar||'—',
      tiempo:tiempoFmt,_ts:toSortDate(fecha)});
  }
  filasServicio.sort((a,b)=>b._ts-a._ts);

  // Tag "service planificado": si la fecha de la fila coincide (±SERVICE_VENTANA_DIAS)
  // con un service del planning para este equipo, mostramos un chip. Útil para
  // distinguir las paradas conjuntas service+reparación que el operario cargó como
  // RAZÓN="Reparación" porque la mayor parte del tiempo fue reparación.
  const _svcFechas = (window._serviceFechasMatch||{})[codN];
  const _ventanaMs = (typeof SERVICE_VENTANA_DIAS!=='undefined'?SERVICE_VENTANA_DIAS:7)*86400000;
  const _svcFechasArr = _svcFechas ? [..._svcFechas].map(ymd=>{const [y,m,d]=ymd.split('-');return new Date(+y,+m-1,+d);}) : [];
  const _matchSvcPlan = (fechaStr)=>{
    if(!_svcFechasArr.length)return false;
    const rango = _parseFechaRango(fechaStr);
    if(!rango)return false;
    for(const fp of _svcFechasArr) if(_distAlRango(fp,rango)<=_ventanaMs) return true;
    return false;
  };

  const contServicio=filasServicio.length
    ?`<div class="table-wrap"><table class="eq-inner-table">
        <thead><tr><th>Planilla</th><th>Fecha</th><th>Tipo</th><th>Descripción</th><th>Lugar</th><th style="text-align:right">Tiempo</th></tr></thead>
        <tbody>${filasServicio.map(f=>`<tr>
          <td class="mono" style="font-size:10px;color:var(--text3)">${f.ref}</td>
          <td class="mono" style="font-size:10px;color:var(--text3);white-space:nowrap">${formatFechaCorta(f.fecha)}${_matchSvcPlan(f.fecha)?' <span class="badge badge-blue" style="font-size:8px;padding:1px 4px;margin-left:3px" title="Coincide con un service planificado para este equipo">🔧 svc</span>':''}</td>
          <td>${(f.tipo==='service'||f.tipo==='preventivo')?'<span class="badge badge-blue" style="font-size:9px">Preventivo</span>':'<span class="badge badge-green" style="font-size:9px">Correctivo</span>'}</td>
          <td style="font-size:12px;color:var(--text2)">${f.desc}</td>
          <td style="font-size:11px;color:var(--text3);white-space:nowrap">${f.lugar}</td>
          <td style="text-align:right;font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--text3)">${f.tiempo}</td>
        </tr>`).join('')}</tbody>
        <tfoot>
          ${(horasPrevEq>0||horasCorrEq>0)?`<tr style="border-top:2px solid var(--border);background:var(--bg3)">
            <td colspan="5" style="text-align:right;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;padding:6px 12px">Correctivo · Preventivo</td>
            <td style="text-align:right;font-family:'IBM Plex Mono',monospace;font-size:11px;padding:6px 12px;white-space:nowrap"><span style="color:var(--green)">${horasCorrEq.toFixed(1)}</span> · <span style="color:var(--blue)">${horasPrevEq.toFixed(1)}</span></td>
          </tr>`:''}
          <tr style="border-top:1px solid var(--border);background:var(--bg3)">
          <td colspan="5" style="text-align:right;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;padding:8px 12px">Total horas trabajadas</td>
          <td style="text-align:right;font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--amber);font-weight:500;padding:8px 12px">${totalHoras>0?totalHoras.toFixed(1)+' hr':'—'}</td>
        </tr></tfoot>
      </table></div>`
    :`<div class="no-data">Sin trabajos registrados para este equipo.${
      window._panelTrabajosTotal===0
        ? '<br><span style=\"font-size:11px;color:var(--amber)\">PANEL_TRABAJOS no encontrado — actualizá PANEL_TRABAJOS desde el menú del Sheet maestro.</span>'
        : window._panelTrabajosTotal>0&&trabajosRows.length===0
          ? '<br><span style=\"font-size:11px\">Script B corrió pero este equipo no tiene trabajos registrados, o la columna CÓDIGO está vacía en la planilla.</span>'
          : ''
    }</div>`;

  // Sección 2: Pedidos de repuestos, con su entrega vinculada en el MISMO renglón.
  // El vínculo pedido→entrega vive en la columna N° ENTREGA de la hoja PEDIDOS
  // (back-ref: "1168", o "648-650"/"627,628" cuando la entrega fue parcial o
  // múltiple). El builder ahora lo copia a PED_PEND (cols N° ORDEN + N° ENTREGA).
  // Con el N° ENTREGA cruzamos a REP_LIVE (_entregaCostos) y traemos fecha y
  // costo de la entrega a la fila del pedido. Lo no entregado queda Pendiente;
  // las entregas parciales/múltiples se listan y su costo (la parte de ESTE
  // equipo, total/nEquipos) se suma. N° OC = orden de compra.
  const escapeHTML=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  // Badge por ESTADO nativo del pedido. Match por substring (la fuente escribe
  // "Entregado parcialmente", "Pendiente", "Entregado", etc.). Parcial gana a
  // "entregado" porque el texto contiene ambas raíces.
  const badgeEstado=est=>{
    const l=String(est||'').toLowerCase();
    if(l.includes('parcial'))   return '<span class="badge badge-amber" style="font-size:9px">Entrega parcial</span>';
    if(l.includes('anulad'))    return '<span class="badge badge-gray"  style="font-size:9px">Anulado</span>';
    if(l.includes('comprad'))   return '<span class="badge badge-blue"  style="font-size:9px">Comprado</span>';
    if(l.includes('entregad'))  return '<span class="badge badge-green" style="font-size:9px">Entregado</span>';
    if(l.includes('pendiente')) return '<span class="badge badge-red"   style="font-size:9px">Pendiente</span>';
    return `<span class="badge badge-gray" style="font-size:9px">${escapeHTML(est||'—')}</span>`;
  };
  // Expande el campo N° ENTREGA del pedido a lista de números. Soporta:
  //  · listas por coma/espacio/barra ("627,628" / "627 628")
  //  · rango corto de DOS números ("648-650" → 648,649,650)
  //  · lista con guiones de TRES o más ("988-990-991" → 988,990,991), que NO es
  //    un rango — por eso el guion solo se interpreta como rango cuando el token
  //    tiene exactamente 2 partes.
  const expandEntregas=campo=>{
    const s=String(campo||'').trim();
    if(!s||s==='-'||s==='—')return[];
    const out=[];
    for(const tok of s.split(/[,\s/]+/)){
      if(!tok)continue;
      const parts=tok.split('-').filter(Boolean);
      if(parts.length===2&&/^\d+$/.test(parts[0])&&/^\d+$/.test(parts[1])){
        const a=+parts[0],b=+parts[1];
        if(b>=a&&b-a<40){for(let i=a;i<=b;i++)out.push(String(i));continue;}
      }
      for(const pt of parts){const t=pt.replace(/[^\d]/g,'');if(t)out.push(t);}
    }
    return out;
  };
  const _entCosto=n=>{const e=(window._entregaCostos||{})[String(n).trim()];if(!(e?.costo>0))return null;return e.costo/Math.max(1,e.nEquipos||1);};
  const _entFecha=n=>{const e=(window._entregaCostos||{})[String(n).trim()];return e?.fecha||'';};

  // N° ENTREGA ya vinculadas a un pedido de este equipo (para no re-listarlas
  // en la tabla secundaria de entregas sueltas).
  const entregasVinculadas=new Set();

  // (A) Pedidos de este equipo (PED_PEND → _pedidosAll), una fila por pedido,
  // con su entrega cruzada. ESTADO tal cual lo lleva la planilla.
  const entregasDePedido=window._entregasPorPedido||{};
  const pedidosEquipo=[...pedidosActivos].map(p=>{
    // Unión de los dos sentidos del vínculo: (a) back-ref N° ENTREGA del pedido,
    // (b) entregas que declararon este N° PEDIDO en REP_LIVE.
    const ents=[...new Set([
      ...expandEntregas(p.nroEntrega),
      ...(entregasDePedido[String(p.nro).trim()]||[]),
    ])].filter(n=>(window._entregaCostos||{})[n]);   // solo entregas reales (presentes en REP_LIVE); descarta artefactos de parseo
    ents.forEach(n=>entregasVinculadas.add(n));
    let costoSum=0,tieneCosto=false,fEnt='',fEntTs=-Infinity;
    for(const n of ents){
      const c=_entCosto(n); if(c!=null){costoSum+=c;tieneCosto=true;}
      const f=_entFecha(n); if(f){const ts=toSortDate(f); if(ts>fEntTs){fEntTs=ts;fEnt=f;}}
    }
    return {
      nro:p.nro||'—', orden:(p.orden&&p.orden!=='-')?p.orden:'', fecha:p.fecha||'—',
      desc:p.desc||'—', estado:p.estado||'—',
      entTxt:ents.join(', '), fEnt, costo:tieneCosto?costoSum:null,
      _ts:toSortDate(p.fecha),
    };
  }).sort((a,b)=>b._ts-a._ts);

  const demoraHTML=(fPed,fEnt)=>{
    const d1=_parseDate(fPed),d2=_parseDate(fEnt);
    if(!d1||!d2)return'<span style="color:var(--text3)">—</span>';
    const dias=Math.round((d2-d1)/86400000);
    if(dias<0)return'<span style="color:var(--text3)">—</span>';
    let color='var(--text2)';
    if(dias<=7)color='var(--green)';else if(dias<=21)color='var(--text2)';else if(dias<=45)color='var(--amber)';else color='var(--red)';
    return`<span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:${color};font-weight:500">${dias}d</span>`;
  };

  const contPedidos=pedidosEquipo.length
    ?`<div class="table-wrap"><table class="eq-inner-table">
        <thead><tr><th>N° Pedido</th><th>N° OC</th><th>F. Pedido</th><th>Descripción</th><th>N° Entrega</th><th>F. Entrega</th><th style="text-align:center">Demora</th><th style="text-align:right">Costo</th><th>Estado</th></tr></thead>
        <tbody>${pedidosEquipo.map(p=>`<tr>
          <td class="mono" style="font-size:10px">${p.nro}</td>
          <td class="mono" style="font-size:10px;color:var(--text3)">${p.orden?escapeHTML(p.orden):'—'}</td>
          <td class="mono" style="font-size:10px;color:var(--text3);white-space:nowrap">${formatFechaCorta(p.fecha)}</td>
          <td style="font-size:12px;color:var(--text2)">${escapeHTML(p.desc)}</td>
          <td class="mono" style="font-size:10px;color:var(--text3)">${p.entTxt||'—'}</td>
          <td class="mono" style="font-size:10px;color:var(--text3);white-space:nowrap">${p.fEnt?formatFechaCorta(p.fEnt):'—'}</td>
          <td style="text-align:center;white-space:nowrap">${demoraHTML(p.fecha,p.fEnt)}</td>
          <td style="text-align:right;font-family:'IBM Plex Mono',monospace;font-size:11px;color:${p.costo!=null?'var(--amber)':'var(--text3)'};white-space:nowrap">${p.costo!=null?formatMoney(p.costo):'—'}</td>
          <td>${badgeEstado(p.estado)}</td>
        </tr>`).join('')}</tbody>
      </table></div>`
    :`<div class="no-data">Sin pedidos de repuestos registrados para este equipo.</div>`;

  // (B) Entregas de este equipo que NO quedaron vinculadas a ningún pedido
  // (entrega cargada sin back-ref en la hoja PEDIDOS, o el pedido no está en la
  // lista). Se muestran aparte para no perder el costo. Sección colapsada.
  // Las de TIPO ENTREGA = Caja chica quedan afuera: esas nunca tienen (ni
  // necesitan) un pedido formal vinculado, así que no son una falla de carga.
  const esCajaChica=t=>/caja\s*chica/i.test(String(t||''));
  const getCE=nroEnt=>{
    if(!nroEnt||nroEnt==='—')return null;
    const e=(window._entregaCostos||{})[String(nroEnt).split(/[-,]/)[0].trim()];
    if(!(e?.costo>0))return null;
    const n=Math.max(1,e.nEquipos||1);
    return {txt:formatMoney(e.costo/n),nEquipos:n};
  };
  const renderItems=(nroEnt,fallback)=>{
    const map=window._itemsPorEntrega||{};
    const key=String(nroEnt||'').split(/[-,]/)[0].trim();
    const items=key?map[key]:null;
    if(items&&items.length){
      return items.map(it=>{
        const cant=it.cantidad&&it.cantidad!=='-'&&it.cantidad!=='—'
          ?`<span style="color:var(--text3);font-family:'IBM Plex Mono',monospace;font-size:10px">${escapeHTML(it.cantidad)}×</span> `:'';
        const desc=escapeHTML(it.descripcion||'');
        const prov=it.proveedor&&it.proveedor!=='-'&&it.proveedor!=='—'
          ?` <span style="color:var(--text3);font-size:10px">· ${escapeHTML(it.proveedor)}</span>`:'';
        return `<div style="margin-bottom:2px">${cant}${desc}${prov}</div>`;
      }).join('');
    }
    return escapeHTML(fallback||'—');
  };
  const entregasEquipo=[...((window._entregasPorEquipo||{})[codN]||[])]
    .filter(e=>!esCajaChica(e.tipo))
    .map(e=>({nro:e.nro||'—',fecha:e.fecha||'—',items:e.items||'—',_ts:toSortDate(e.fecha)}))
    .filter(e=>!entregasVinculadas.has(String(e.nro).split(/[-,]/)[0].trim()))
    .sort((a,b)=>b._ts-a._ts);

  const contEntregas=entregasEquipo.length
    ?`<div class="table-wrap"><table class="eq-inner-table">
        <thead><tr><th>N° Entrega</th><th>Fecha</th><th>Repuestos entregados</th><th style="text-align:right">Costo</th></tr></thead>
        <tbody>${entregasEquipo.map(e=>{const costo=getCE(e.nro);return`<tr>
          <td class="mono" style="font-size:10px">${e.nro}</td>
          <td class="mono" style="font-size:10px;color:var(--text3);white-space:nowrap">${formatFechaCorta(e.fecha)}</td>
          <td style="font-size:12px;color:var(--text2)">${renderItems(e.nro,e.items)}</td>
          <td style="text-align:right;font-family:'IBM Plex Mono',monospace;font-size:11px;color:${costo?'var(--amber)':'var(--text3)'};white-space:nowrap">${costo?costo.txt:'—'}${costo&&costo.nEquipos>1?` <span style="color:var(--text3)" title="Entrega imputada a ${costo.nEquipos} equipos: el costo se reparte en partes iguales">1/${costo.nEquipos}</span>`:''}</td>
        </tr>`;}).join('')}</tbody>
      </table></div>`
    :`<div class="no-data">Sin entregas de repuestos con costo para este equipo.</div>`;

  // (La sección "costos y horas de mantenimiento mes a mes" se eliminó el
  // 2026-08-04 a pedido de Marcos: no aportaba — con pocos meses cargados el
  // gráfico combinado era ilegible. El costo mensual por equipo vive en el tab
  // "costos downtime", que sí se usa.)

  // Sección 3: Fuentes
  // rel="noopener noreferrer": evita que la pestaña destino acceda a window.opener
  // (tabnabbing) y omite el header Referer hacia docs.google.com.
  const _lnk=(id,txt,title)=>`<a href="https://docs.google.com/spreadsheets/d/${id}/edit" target="_blank" rel="noopener noreferrer"${title?` title="${title}"`:''} style="color:var(--blue);text-decoration:none">${txt} ↗</a>`;

  // Trabajos pendientes de taller para este equipo (pestaña TRAB_PEND).
  const trabPendEq = (window._trabajosPendientesPorEquipo||{})[codN]||[];
  const trabPendAbiertos = trabPendEq.filter(t=>!t.resuelto);
  const contTrabPend = trabPendEq.length
    ? `<div class="table-wrap"><table class="eq-inner-table">
        <thead><tr><th>Fecha</th><th>Estado</th><th>Descripción</th><th>Responsable</th></tr></thead>
        <tbody>${trabPendEq.map(t=>`<tr>
          <td class="mono" style="font-size:10.5px;color:var(--text3);white-space:nowrap">${formatFechaCorta(t.fecha)}</td>
          <td style="font-size:11px"><span class="badge ${t.resuelto?'badge-gray':'badge-amber'}">${t.estado||(t.resuelto?'Resuelto':'Pendiente')}</span></td>
          <td style="font-size:12px;color:var(--text2)">${t.descripcion||'—'}${t.resuelto&&t.descripcionResolucion?`<div style="font-size:11px;color:var(--text3);margin-top:2px">↳ ${t.descripcionResolucion}</div>`:''}</td>
          <td style="font-size:11px;color:var(--text3)">${t.responsable||'—'}</td>
        </tr>`).join('')}</tbody>
      </table></div>`
    : `<div class="no-data">Sin trabajos pendientes cargados para este equipo.</div>`;

  // Filas de la sección "fuentes de información": apuntan a FUENTES_REALES
  // (01-core.js), que son los archivos que HOY lee el builder del snapshot
  // (SNAP_SRC en apps-scripts/snapshot-builder.gs) — no SHEET_IDS, que quedó
  // como llave legacy de redirección y en su mayoría ya no son los archivos
  // reales (ver comentario junto a FUENTES_REALES).
  const _row=(label,content)=>`<div style="background:var(--bg3);padding:11px 14px;font-size:11px;color:var(--text2);line-height:1.7">
      <span style="display:inline-block;min-width:140px;color:var(--text-mute);text-transform:uppercase;letter-spacing:.12em;font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace">${label}</span>
      ${content}
    </div>`;

  const contFuentes=`
    <div style="display:grid;gap:1px;background:var(--border);border:1px solid var(--border)">
      ${_row('Catálogo',_lnk(FUENTES_REALES.equipos,'Lista de equipos (maestro)','Hoja maestra de equipos: estado, ubicación, marca/modelo, tenencia, operario'))}
      ${_row('Trabajos en taller',_lnk(FUENTES_REALES.trabajos,'Trabajos realizados y pendientes','Pestañas TRABAJOS REALIZADOS y TRABAJOS PENDIENTES'))}
      ${_row('Service',_lnk(FUENTES_REALES.service,'Services de equipos','Pestañas REGISTROS y RESUMEN: último/próximo service, estado por equipo'))}
      ${_row('Pedidos y repuestos',_lnk(FUENTES_REALES.repuestos,'Pedidos y entregas de repuestos','Pestañas PEDIDOS y ENTREGAS'))}
      ${_row('Combustible · pesados',_lnk(FUENTES_REALES.combPesados,'Entrega de combustible (Casares)','Equipos pesados, con lectura de horómetro/odómetro'))}
      ${_row('Combustible · livianos',_lnk(FUENTES_REALES.combLivianos,'Entrega de combustible (Sanz)','Vehículos livianos, con costo'))}
      ${_row('Combustible · camionetas',_lnk(FUENTES_REALES.combCamionetas,'Entrega de combustible camionetas','Solo auditoría de cargas — sin horómetro ni costo'))}
      ${_row('VTV',_lnk(FUENTES_REALES.vtv,'Verificación técnica vehicular','Marcos la carga a mano, incompleta a propósito'))}
    </div>`;

  // Sección: historial de cargas de combustible (más reciente arriba)
  const _hrUnit = _unidad==='km'?'km':'hr';
  const cargasOrdenadas = comb?.cargas ? [...comb.cargas].reverse() : [];
  const contCombustible = cargasOrdenadas.length
    ? `<div class="table-wrap"><table class="eq-inner-table">
        <thead><tr>
          <th>Fecha</th>
          <th style="text-align:right">${_hrUnit==='km'?'Odómetro':'Horóm.'}</th>
          <th style="text-align:right">Litros</th>
          <th style="text-align:right">Costo</th>
          <th>Tipo</th>
          <th>Lugar</th>
          <th>Operario</th>
          <th>Obs.</th>
        </tr></thead>
        <tbody>${cargasOrdenadas.map(c=>`<tr>
          <td class="mono" style="font-size:10.5px;color:var(--text2);white-space:nowrap">${formatFechaCorta(c.fecha)}</td>
          <td class="mono" style="font-size:11px;text-align:right;color:${c.hr!=null?'var(--blue)':'var(--text3)'}">${c.hr!=null?fmtInt(c.hr)+' '+_hrUnit:'<span title="Horómetro/odómetro sin lectura">—</span>'}</td>
          <td class="mono" style="font-size:11px;text-align:right;color:var(--amber);font-weight:500">${fmtInt(c.litros)} L</td>
          <td class="mono" style="font-size:11px;text-align:right;color:${c.costo>0?'var(--amber)':'var(--text3)'}"${c.costoEstimado?' title="Estimado: litros × precio configurado (⚙ auditoría), no un monto cargado"':''}>${c.costo>0?formatMoney(c.costo)+(c.costoEstimado?' ~':''):'—'}</td>
          <td style="font-size:11px;color:var(--text2)">${c.tipo||'—'}</td>
          <td style="font-size:11px;color:var(--text3)">${c.lugar||'—'}</td>
          <td style="font-size:11px;color:var(--text3)">${c.operario||'—'}</td>
          <td style="font-size:11px;color:var(--text3)">${c.obs||''}</td>
        </tr>`).join('')}</tbody>
        ${(comb?.promedio!=null||comb?.totalCosto>0)?`<tfoot><tr style="background:var(--bg3);font-weight:500">
          <td colspan="2" style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em">Acumulado</td>
          <td colspan="6" style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--text)">${comb?.promedio!=null?`${comb.promedio.toFixed(_unidad==='km'?1:2)} ${_consumoLabel} · `:''}${fmtInt(comb.totalLitros)} L${comb?.totalCosto>0?` · ${formatMoney(comb.totalCosto)} en combustible${cargasOrdenadas.some(c=>c.costoEstimado)?' (parte estimado, ~)':''}`:''}</td>
        </tr></tfoot>`:''}
      </table></div>`
    : `<div class="no-data">Sin cargas de combustible registradas para este equipo.</div>`;

  // VTV: solo se muestra si Marcos ya cargó la fila de este equipo (lista
  // incompleta a propósito). Mismo estilo compacto que el bloque de service.
  const vtv=(window._vtvPorEquipo||{})[codN]||null;
  let vtvHTML='';
  if(vtv){
    const vtvColor = vtv.dias<=0 ? 'var(--red)' : vtv.dias<=VTV_UMBRAL_DIAS ? 'var(--amber)' : 'var(--green)';
    const vtvTxt = vtv.dias<=0 ? `vencida hace ${fmtInt(Math.abs(vtv.dias))} días` : `faltan ${fmtInt(vtv.dias)} días`;
    vtvHTML=`
    <div style="display:flex;background:var(--bg3);border:1px solid var(--border);border-left:3px solid ${vtvColor};margin-bottom:12px;overflow:hidden">
      <div style="flex:1;padding:10px 14px;border-right:1px solid var(--border)">
        <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:3px">VTV — vencimiento</div>
        <div style="font-size:15px;color:${vtvColor};font-family:'IBM Plex Mono',monospace;font-weight:500">${formatFechaCorta(vtv.vencimiento)||vtv.vencimiento}</div>
        <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:${vtvColor};margin-top:2px">${vtvTxt}</div>
      </div>
      ${vtv.patente?`<div style="padding:10px 14px;min-width:120px">
        <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:3px">Patente</div>
        <div style="font-size:15px;color:var(--text2);font-family:'IBM Plex Mono',monospace;font-weight:500">${vtv.patente}</div>
      </div>`:''}
    </div>`;
  }

  setHTML(document.getElementById('eqDetailBody'),
    new RawHTML(
      (kpisHTML instanceof RawHTML ? kpisHTML.value : String(kpisHTML))+
      (infoBar instanceof RawHTML ? infoBar.value : String(infoBar))+
      (horHTML instanceof RawHTML ? horHTML.value : String(horHTML))+
      vtvHTML+
      eqSection('servicios y reparaciones en taller',contServicio,false).value+
      (trabPendEq.length?eqSection(`trabajos pendientes (${trabPendAbiertos.length})`,contTrabPend,false).value:'')+
      eqSection(`pedidos de repuestos (${pedidosEquipo.length})`,contPedidos,false).value+
      (entregasEquipo.length?eqSection(`entregas sin pedido vinculado (${entregasEquipo.length})`,contEntregas,false).value:'')+
      eqSection(`cargas de combustible${comb?.cargas?.length?` (${comb.cargas.length})`:''}`,contCombustible,false).value+
      eqSection('fuentes de información',contFuentes,false).value
    ));

}

function closeEquipoDetail(){
  const panel=document.getElementById('equipoDetailPanel');
  panel.classList.remove('open');
  // Devolver el panel a su home estable: si quedó dentro del grid, al próximo
  // re-render (filtro / cambio de vista) se destruiría junto con las tarjetas.
  const home=document.getElementById('equipoDetailHome');
  if(home&&panel.parentElement!==home)home.appendChild(panel);
  if(_activeEqCard){_activeEqCard.classList.remove('active');_activeEqCard=null;}
}

document.addEventListener('keydown',e=>{if(e.key==='Escape')closeEquipoDetail();});

/* ═══════════════════════════════════════════════════════════════════
   TELEMETRÍA DE FLOTA · 2 gráficos + 2 rankings
═══════════════════════════════════════════════════════════════════ */
let _chartComboFlota=null;

function renderTelemetriaFlota(){
  if(typeof Chart==='undefined')return;
  const AMBER=_cssVar('--amber','#ffa030');
  const ACCENT=_cssVar('--accent','#3a5fc8');
  const CORP =_cssVar('--corp','#5d80e8');
  const RED  =_cssVar('--red','#e5484d');
  const TICK =_cssVar('--chart-tick','#6a7287');
  const GRID =_cssVar('--chart-grid','#1a2030');
  const TEXT2=_cssVar('--text2','#aab3c8');
  const TOOLTIP_BG=_cssVar('--chart-tooltip-bg','#0d1019');
  const TOOLTIP_FG=_cssVar('--chart-tooltip-fg','#f1f4fb');
  const nomMes=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  // ─── Combo chart: costo (barras, eje izq) + horas (línea, eje der) ──
  // Mismos labels de mes; los meses con dato 0 quedan vacíos en su serie.
  const costosPorMes=window._costosPorMes||{};
  const horasPorMesFlota=window._horasPorMesFlota||{};
  const horasCorrPorMes=window._horasCorrPorMes||{};
  const horasPrevPorMes=window._horasPrevPorMes||{};

  // Union de meses presentes en cualquiera de las series (ordenados).
  // Filtramos YMs inválidos (año fuera del rango razonable): alguna fila de datos
  // puede venir con fecha mal formateada (ej. "01/02/205" → ym "205-02") y no
  // queremos que genere un punto "Feb'5" en el chart.
  const _anioAct=new Date().getFullYear();
  const ymsAll=[...new Set([...Object.keys(costosPorMes),...Object.keys(horasPorMesFlota)])]
    .filter(ym=>/^\d{4}-\d{2}$/.test(ym)&&+ym.slice(0,4)>=2020&&+ym.slice(0,4)<=_anioAct+1)
    .sort();
  const labels=ymsAll.map(ym=>{const[y,mm]=ym.split('-');return`${nomMes[+mm-1]}'${y.slice(2)}`;});
  const dataCosto=ymsAll.map(ym=>{
    const m=costosPorMes[ym]||{};
    return Object.values(m).reduce((s,v)=>s+(v||0),0);
  });
  const dataHorasCorr=ymsAll.map(ym=>Math.round((horasCorrPorMes[ym]||0)*10)/10);
  const dataHorasPrev=ymsAll.map(ym=>Math.round((horasPrevPorMes[ym]||0)*10)/10);

  // Resumen numérico arriba del chart
  const totC=dataCosto.reduce((s,v)=>s+v,0);
  const totHc=dataHorasCorr.reduce((s,v)=>s+v,0);
  const totHp=dataHorasPrev.reduce((s,v)=>s+v,0);
  const totalsEl=document.getElementById('comboTotals');
  if(totalsEl){
    // El resumen suma TODOS los meses graficados (no solo 2026), así que el label
    // refleja el período real mostrado en vez de un "2026" fijo que mentía cuando
    // el chart incluye histórico 2025.
    const periodo=ymsAll.length?(labels[0]===labels[labels.length-1]?labels[0]:`${labels[0]}–${labels[labels.length-1]}`):'';
    setHTML(totalsEl, ymsAll.length
      ?html`acumulado ${periodo} · <span class="v-costo">${formatMoney(totC)}</span> en repuestos<span class="sep">·</span><span class="v-corr">${totHc.toFixed(0)} hr</span> correctivo<span class="sep">·</span><span class="v-prev">${totHp.toFixed(0)} hr</span> preventivo`
      :'sin datos para graficar');
  }

  if(_chartComboFlota){_chartComboFlota.destroy();_chartComboFlota=null;}
  const elCombo=document.getElementById('chartComboFlota');
  if(elCombo&&ymsAll.length){
    _chartComboFlota=new Chart(elCombo.getContext('2d'),{
      type:'bar',
      data:{
        labels,
        datasets:[
          {
            type:'bar',
            label:'Costo en repuestos',
            data:dataCosto,
            backgroundColor:AMBER+'cc',
            borderColor:AMBER,
            borderWidth:1,
            maxBarThickness:48,
            yAxisID:'yCosto',
            order:2,  // las barras detrás de la línea
          },
          {
            type:'line',
            label:'Horas correctivo',
            data:dataHorasCorr,
            borderColor:RED,
            backgroundColor:RED+'20',
            borderWidth:2.5,
            pointBackgroundColor:RED,
            pointBorderColor:'#fff',
            pointBorderWidth:1.5,
            pointRadius:4.5,
            pointHoverRadius:6.5,
            fill:false,
            tension:0.35,
            yAxisID:'yHoras',
            order:1,  // líneas delante de las barras
          },
          {
            type:'line',
            label:'Horas preventivo',
            data:dataHorasPrev,
            borderColor:CORP,
            backgroundColor:CORP+'20',
            borderWidth:2.5,
            pointBackgroundColor:CORP,
            pointBorderColor:'#fff',
            pointBorderWidth:1.5,
            pointRadius:4.5,
            pointHoverRadius:6.5,
            fill:false,
            tension:0.35,
            yAxisID:'yHoras',
            order:0,
          }
        ]
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        interaction:{mode:'index',intersect:false}, // hover sobre el mes muestra ambos
        plugins:{
          legend:{display:false}, // la leyenda la pinto a mano arriba (más linda)
          tooltip:{
            backgroundColor:TOOLTIP_BG,
            titleColor:TOOLTIP_FG,
            bodyColor:TOOLTIP_FG,
            padding:12,
            borderColor:GRID,
            borderWidth:1,
            titleFont:{family:'JetBrains Mono',size:11,weight:'600'},
            bodyFont:{family:'Inter',size:12},
            bodySpacing:6,
            callbacks:{
              label:c=>{
                if(c.dataset.label==='Costo en repuestos')return '  ▣ '+formatMoney(c.raw)+' en repuestos';
                if(c.dataset.label==='Horas correctivo')   return '  ─ '+c.raw.toFixed(1)+' hr correctivo';
                if(c.dataset.label==='Horas preventivo')   return '  ─ '+c.raw.toFixed(1)+' hr preventivo';
                return c.raw;
              }
            }
          }
        },
        scales:{
          x:{
            ticks:{color:TEXT2,font:{size:11,family:'JetBrains Mono',weight:'500'}},
            grid:{display:false},
            border:{color:GRID}
          },
          yCosto:{
            type:'linear',
            position:'left',
            beginAtZero:true,
            title:{display:true,text:'$ repuestos',color:AMBER,font:{size:10,family:'JetBrains Mono',weight:'600'},padding:{bottom:8}},
            ticks:{color:AMBER,font:{size:10,family:'JetBrains Mono'},callback:v=>v>=1e6?'$'+(v/1e6).toFixed(1)+'M':v>=1e3?'$'+(v/1e3).toFixed(0)+'K':'$'+v},
            grid:{color:GRID,drawTicks:false},
            border:{display:false}
          },
          yHoras:{
            type:'linear',
            position:'right',
            beginAtZero:true,
            title:{display:true,text:'horas',color:CORP,font:{size:10,family:'JetBrains Mono',weight:'600'},padding:{bottom:8}},
            ticks:{color:CORP,font:{size:10,family:'JetBrains Mono'},callback:v=>v+' h'},
            grid:{display:false}, // sin grid del eje derecho para no saturar
            border:{display:false}
          }
        }
      }
    });
  }

  // ─── Ranking 1: top 10 más costosos ───────────────────────────────
  // Suma costo total por equipo desde _costosPorMes
  const costoPorEquipo={};
  for(const ym of Object.keys(costosPorMes)){
    for(const[codN,v]of Object.entries(costosPorMes[ym]||{})){
      costoPorEquipo[codN]=(costoPorEquipo[codN]||0)+(v||0);
    }
  }
  const topCosto=Object.entries(costoPorEquipo)
    .filter(([,v])=>v>0)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,10);
  const maxCosto=topCosto[0]?.[1]||1;
  const _eqByCodN=codN=>(window._equiposOrdenados||[]).find(e=>normCod(e.codigo)===codN);
  setHTML(document.getElementById('rankCosto'), topCosto.length
    ?topCosto.map(([codN,v],i)=>{
      const eq=_eqByCodN(codN);const codDisplay=eq?eq.codigo:codN;
      return html`<div class="rank-row" data-action="scrollToEquipo" data-arg="${codDisplay}" title="Ver detalle">
        <span class="rank-pos${i<3?' top':''}">${String(i+1).padStart(2,'0')}</span>
        <span class="rank-cod">${codDisplay}</span>
        <div class="rank-bar-wrap"><div class="rank-bar-fill" style="width:${Math.round(v/maxCosto*100)}%;background:${AMBER};box-shadow:0 0 8px ${AMBER}80"></div></div>
        <span class="rank-val">${formatMoney(v)}</span>
      </div>`;
    })
    :html`<div class="no-data">Sin datos de costos.</div>`);

  // ─── Ranking 2: top 10 más horas en taller ───────────────────────
  const horasPorEq=window._horasPorEquipo||{};
  const topHoras=Object.entries(horasPorEq)
    .filter(([,v])=>v>0)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,10);
  const maxHoras=topHoras[0]?.[1]||1;
  setHTML(document.getElementById('rankHoras'), topHoras.length
    ?topHoras.map(([codN,v],i)=>{
      const eq=_eqByCodN(codN);const codDisplay=eq?eq.codigo:codN;
      return html`<div class="rank-row" data-action="scrollToEquipo" data-arg="${codDisplay}" title="Ver detalle">
        <span class="rank-pos${i<3?' top':''}">${String(i+1).padStart(2,'0')}</span>
        <span class="rank-cod">${codDisplay}</span>
        <div class="rank-bar-wrap"><div class="rank-bar-fill" style="width:${Math.round(v/maxHoras*100)}%;background:${ACCENT};box-shadow:0 0 8px ${ACCENT}80"></div></div>
        <span class="rank-val">${v.toFixed(1)} hr</span>
      </div>`;
    })
    :html`<div class="no-data">Sin datos de horas trabajadas.<br><span style="font-size:10px;color:var(--amber)">Si PANEL_TRABAJOS está vacío, actualizalo desde el menú del Sheet maestro.</span></div>`);

  // Badge resumen en el header de la sección
  const badge=document.getElementById('telemetriaBadge');
  if(badge){
    const totalCosto=Object.values(costoPorEquipo).reduce((s,v)=>s+v,0);
    const totalHoras=Object.values(horasPorEq).reduce((s,v)=>s+v,0);
    badge.textContent=`${formatMoney(totalCosto)} · ${totalHoras.toFixed(0)} hr`;
  }
}

// Click en una fila del ranking → scroll al equipo y abrir su detalle
// Sección desplegable "equipos inactivos" al pie del tab de equipos (default
// minimizada; los inactivos dejaron de tener tab propio, jul-2026).
function toggleInactivosSec(forceOpen){
  const sec=document.getElementById('inactivosSec');
  const chev=document.getElementById('inactChev');
  if(!sec||!chev)return;
  const hidden=sec.style.display==='none';
  const abrir=forceOpen===true?true:hidden;
  sec.style.display=abrir?'':'none';
  chev.textContent=abrir?'▾':'▸';
}

function scrollToEquipo(codigo){
  setTab('tabEquipos'); // los rankings viven en telemetría; la tarjeta está en el tab de equipos
  const id='eqcard_'+codigo.replace(/[^a-z0-9]/gi,'_');
  const el=document.getElementById(id);
  if(!el)return;
  // Si la tarjeta vive en la sección de inactivos y está colapsada, expandirla.
  if(el.closest('#inactivosSec'))toggleInactivosSec(true);
  el.scrollIntoView({behavior:'smooth',block:'center'});
  // breve highlight visual
  el.style.transition='box-shadow .3s ease';
  el.style.boxShadow='0 0 0 2px var(--accent), 0 0 20px var(--accent-tint)';
  setTimeout(()=>{el.style.boxShadow='';setTimeout(()=>{el.style.transition='';},300);},900);
}
