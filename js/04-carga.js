/* ══════════════════════════════════════════════════════════════════
   04-carga.js — parte 4/8 de la app del panel INGECO.
   Los 8 archivos son SCRIPTS CLÁSICOS que comparten el mismo scope
   global y se cargan EN ORDEN (defer) desde index.html: mover uno de
   lugar rompe las dependencias. No convertir a type=module sin
   revisar ACTIONS y el bootstrap del PIN.
══════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════
   CARGA PRINCIPAL
═══════════════════════════════════════════════════════ */
function setLoadProgress(pct){
  const bar=document.getElementById('loadBar');const fill=document.getElementById('loadBarFill');
  if(pct===0){bar.style.display='block';fill.style.width='0';}
  else if(pct>=100){setTimeout(()=>{bar.style.display='none';fill.style.width='0';},400);}
  fill.style.width=pct+'%';
}

async function loadAll(){
  // Si ya hay datos cargados, este es un refresh manual (click en "sync") y
  // no el initial load. Cuando USE_API está activo, eso fuerza un refresh
  // server-side (corre los consolidadores e invalida cache server) antes
  // de re-fetchear los endpoints.
  const esManualRefresh = !!window._estadoEquipos;
  const btn=document.getElementById('refreshBtn');
  btn.classList.add('loading');btn.textContent='↻ cargando...';
  document.getElementById('loadingState').style.display='block';
  document.getElementById('dashboard').style.display='none';
  document.getElementById('errorState').style.display='none';
  setLoadProgress(0);

  try{
    if (esManualRefresh) await apiRefreshAll();
    setLoadProgress(15);
    // Carga primaria: TODO lo necesario para el primer render.
    // PANEL_REPUESTOS pasa a ser fuente única de entregas (reemplaza MESES_ENTREGAS).
    // PANEL_TRABAJOS se carga acá también para alimentar telemetría de flota (rankings + chart de horas).
    const[pendientesRaw,entregadosRaw,codV,codL,codP,codS,panelRepuestosLiveObj,panelRepuestosHistObj,panelTrabajosLiveObj,panelTrabajosHistObj,serviceFrecRows,serviceTrimRows,trim1Rows,trim2Rows,panelProgramaObj,combustibleObj,combLivianosRows,vtvRows,faltantesRows,trabPendRows,configResp]=await Promise.all([
      fetchGvizRaw(SHEET_IDS.pedidos,'PENDIENTES'),
      // ENTREGADOS tiene título y contadores en filas 1-10; headers reales en fila 11.
      // El range fuerza a gviz a usar la fila 11 como header (sin esto, los nombres se pierden).
      fetchGvizObj(SHEET_IDS.pedidos,'ENTREGADOS','A11:H').catch(()=>[]),
      fetchGvizRaw(SHEET_IDS.codigos,'VIALES, ASFALTO Y TRITURACIÓN').catch(()=>[]),
      fetchGvizRaw(SHEET_IDS.codigos,'TRANSPORTE LIVIANO').catch(()=>[]),
      fetchGvizRaw(SHEET_IDS.codigos,'TRANSPORTE PESADO').catch(()=>[]),
      fetchGvizRaw(SHEET_IDS.codigos,'SOPORTE').catch(()=>[]),
      // Repuestos LIVE (2026 diario) + HIST (2024-2025 + 2026 parcial, cambia cada tanto).
      // Filtramos abajo: live → fecha>=2026, hist → fecha en 2025.
      fetchGvizObj(SHEET_IDS.repuestos_hist,'PANEL_REPUESTOS').catch(()=>[]),
      fetchGvizObj(SHEET_IDS.repuestos_hist_old,'PANEL_REPUESTOS').catch(()=>[]),
      // Trabajos LIVE (2026 diario) + HIST (2024-2026, cambia cada tanto).
      // Mismo filtrado por año.
      fetchGvizObj(SHEET_IDS.trabajos_reg,'PANEL_TRABAJOS').catch(()=>[]),
      fetchGvizObj(SHEET_IDS.trabajos_hist,'PANEL_TRABAJOS').catch(()=>[]),
      // PROGRAMA DE TRABAJOS DE SERVICE 2026: rangos de operatividad + trimestre vigente.
      fetchGvizRaw(SHEET_IDS.programaService,SERVICE_FREC_SHEET).catch(()=>[]),
      fetchGvizRaw(SHEET_IDS.programaService,SERVICE_TRIM_SHEET).catch(()=>[]),
      // Ambos trimestres del PROGRAMA + PANEL_PROGRAMA del sheet de service:
      // services planificados/realizados que cruzamos con TRABAJOS REALIZADOS.
      fetchGvizRaw(SHEET_IDS.programaService,'1° TRIMESTRE').catch(()=>[]),
      fetchGvizRaw(SHEET_IDS.programaService,'2° TRIMESTRE').catch(()=>[]),
      fetchGvizObj(SHEET_IDS.service,'PANEL_PROGRAMA').catch(()=>[]),
      fetchGvizObj(SHEET_IDS.combustible,COMBUSTIBLE_SHEET).catch(()=>[]),
      // Combustible de livianos (Excel "Control General"); se procesa abajo.
      fetchGvizRaw(SHEET_IDS.combustibleLivianos,COMBUSTIBLE_LIVIANOS_SHEET).catch(()=>[]),
      // VTV: lista incompleta a propósito (Marcos la va completando). Sin fila
      // para un equipo → no aparece en la KPI, no se fabrica dato.
      fetchGvizObj(SHEET_IDS.vtv,'VTV').catch(()=>[]),
      // FALTANTES: pendientes de CARGA (qué falta anotar), no de control. La
      // arma el builder leyendo las demás pestañas del snapshot.
      fetchGvizObj(SNAPSHOT_ID,'FALTANTES').catch(()=>[]),
      // TRABAJOS PENDIENTES: tareas de taller detectadas y todavía sin resolver
      // (hoja nueva ago-2026, misma planilla que TRABAJOS REALIZADOS).
      fetchGvizObj(SNAPSHOT_ID,'TRAB_PEND').catch(()=>[]),
      // Config del panel (hoy: precio de combustible pesados). Lectura pública,
      // sin PIN — la edición sí lo pide (⚙ en el modal de auditoría).
      fetch(REFRESH_URL+'?ep=config').then(r=>r.json()).catch(()=>({ok:false})),
    ]);
    setLoadProgress(55);

    // Combinar LIVE + HIST con filtro por año: del live tomamos >=2026, del hist
    // tomamos solo 2025. Así evitamos duplicación (el hist también tiene 2026
    // parcial) y cubrimos "desde 2025 en adelante" como pidió Marcos.
    const _SIN_FECHA_TRAB=['FECHA TRABAJO','FECHA DE TRABAJO','FECHA'];
    const _SIN_FECHA_REP =['FECHA','FECHA ENTREGA','FECHA DE ENTREGA'];
    const _filtrarAnio=(rows,predicate,sinFecha)=>{
      const out=[];
      for(const r of (rows||[])){
        const idx={};
        for(const k of Object.keys(r))idx[normHead(k)]=r[k];
        const get=keys=>{for(const k of keys){const v=idx[k];if(v!=null&&String(v).trim()!=='')return String(v).trim();}return'';};
        const d=_parseDate(get(sinFecha));
        if(d&&predicate(d.getFullYear()))out.push(r);
      }
      return out;
    };
    // PANEL_TRABAJOS del HIST suele estar truncado a 2026 (lo trunca el script
    // consolidador del Drive). Para reconstruir el 2025 (y completar 2026 con
    // trabajos que están en las pestañas pero no en el archivo mensual del
    // Drive), leemos las pestañas POR EQUIPO del HIST y deduplicamos contra
    // el LIVE por (cod, fecha-normalizada, tiempo). El LIVE 2026 gana — solo
    // sumamos del HIST las filas que no aparecen ya en LIVE.
    // Filtro simple por año: LIVE para 2026 (al día), HIST pestañas por equipo
    // solo para 2025 (el LIVE no tiene histórico). Sin dedup compleja porque
    // las descripciones entre LIVE (consolidador) y pestañas (carga manual por
    // equipo) difieren con frecuencia → cualquier dedup por texto generaría
    // falsos positivos o falsos negativos. Trade-off aceptado: las ~700 hr de
    // 2026 que están solo en pestañas por equipo (cargas manuales sin pasar por
    // la planilla mensual del Drive) no aparecen en el panel.
    const panelTrabajosHist2025 = await fetchTrabajosHistPorEquipo(y=>y===2025);
    const panelTrabajosObj=[
      ..._filtrarAnio(panelTrabajosLiveObj,y=>y>=2026,_SIN_FECHA_TRAB),
      ..._filtrarAnio(panelTrabajosHistObj,y=>y===2025,_SIN_FECHA_TRAB),
      ...panelTrabajosHist2025,
    ];
    // El sheet HIST repuestos (1WCtB) tiene un header roto en col 0: aparece
    // como "#ERROR!" en lugar de "N° ENTREGA". Renombramos la key antes del
    // procesamiento para que _pickCol(['N° ENTREGA']) la encuentre y las
    // entregas se cuenten en entregaCostos.
    const _renormHistRep = rows => rows.map(r => {
      const o = {};
      for (const k of Object.keys(r)) {
        const nk = (k === '#ERROR!' || k === '#VALUE!' || k === '') ? 'N° ENTREGA' : k;
        o[nk] = r[k];
      }
      return o;
    });
    const panelRepuestosObj=[
      ..._filtrarAnio(panelRepuestosLiveObj,y=>y>=2026,_SIN_FECHA_REP),
      ..._filtrarAnio(_renormHistRep(panelRepuestosHistObj),y=>y===2025,_SIN_FECHA_REP),
    ];

    // Procesar PANEL_REPUESTOS: produce todos los derivados de una sola pasada
    const ctx=procesarPanelRepuestos(panelRepuestosObj);
    window._entregaCostos     = ctx.entregaCostos;
    window._itemsPorEntrega   = ctx.itemsPorEntrega;
    window._costosPorMes      = ctx.costosPorMes;
    window._costosCorrPorMes  = ctx.costosCorrPorMes;
    window._repuestosHistorial= ctx.repuestosHistorial;
    window._entregasPorEquipo = ctx.entregasPorEquipo;
    window._entregasCorrPorEquipo = ctx.entregasCorrPorEquipo;
    window._entregasPorPedido = ctx.entregasPorPedido;

    // Procesar PANEL_TRABAJOS para telemetría de flota (horas por equipo, por mes).
    // Cacheamos el raw para que loadTrabajosRegistro (modal de equipo) no re-descargue.
    window._panelTrabajosRaw = panelTrabajosObj;
    const tctx=procesarPanelTrabajos(panelTrabajosObj);
    window._horasPorEquipo  = tctx.horasPorEquipo;
    window._horasPorMesFlota= tctx.horasPorMesFlota;
    window._panelTrabajosTotal = tctx.totalFilas;
    window._horasFlota         = tctx.horasFlota;
    window._horasPrevPorMes    = tctx.horasPrevPorMes;
    window._horasCorrPorMes    = tctx.horasCorrPorMes;
    window._horasPrevPorEquipo = tctx.horasPrevPorEquipo;
    window._horasCorrPorEquipo = tctx.horasCorrPorEquipo;
    window._horasPorMesYEquipo = tctx.horasPorMesYEquipo;
    window._horasCorrPorMesYEquipo  = tctx.horasCorrPorMesYEquipo;
    window._trabajosCorrPorEquipo   = tctx.trabajosCorrPorEquipo;

    // Procesar SERVICES PLANIFICADOS y cruzar con PANEL_TRABAJOS.
    // Suma al preventivo horas estimadas de los services que el planning dice
    // que se hicieron pero no quedaron cargados en TRABAJOS REALIZADOS.
    window._servicesPlanning = procesarServicesPlanning(trim1Rows,trim2Rows,panelProgramaObj);
    const sctx = cruzarServicesEnTrabajos(panelTrabajosObj,window._servicesPlanning);
    window._serviceCumplimiento = sctx.cumplimiento;
    window._serviceFechasMatch  = sctx.serviceFechasMatch;
    window._serviceMedianas     = sctx.medianas;
    if(sctx.horasAgregadasFlota>0){
      window._horasFlota.prev += sctx.horasAgregadasFlota;
      window._horasFlota.total+= sctx.horasAgregadasFlota;
      for(const k of Object.keys(sctx.horasAgregadasPorEquipo)){
        window._horasPorEquipo[k]=(window._horasPorEquipo[k]||0)+sctx.horasAgregadasPorEquipo[k];
        window._horasPrevPorEquipo[k]=(window._horasPrevPorEquipo[k]||0)+sctx.horasAgregadasPorEquipo[k];
      }
      for(const ym of Object.keys(sctx.horasAgregadasPorMes)){
        window._horasPorMesFlota[ym]=(window._horasPorMesFlota[ym]||0)+sctx.horasAgregadasPorMes[ym];
        window._horasPrevPorMes[ym]=(window._horasPrevPorMes[ym]||0)+sctx.horasAgregadasPorMes[ym];
      }
      for(const ym of Object.keys(sctx.horasAgregadasPorMesYEquipo||{})){
        window._horasPorMesYEquipo[ym]=window._horasPorMesYEquipo[ym]||{};
        for(const k of Object.keys(sctx.horasAgregadasPorMesYEquipo[ym])){
          window._horasPorMesYEquipo[ym][k]=(window._horasPorMesYEquipo[ym][k]||0)+sctx.horasAgregadasPorMesYEquipo[ym][k];
        }
      }
    }

    // Estado de service por equipo (alimenta KPI y modal). Fuente: hoja
    // OPERATIVIDAD de SERVICES DE EQUIPOS (ya trae ESTADO pre-calculado:
    // VENCIDO/CRÍTICO/INTERMEDIO/HOLGADO), volcada a SVC_PANELPROG por el builder.
    window._servicePanel = procesarPanelPrograma(panelProgramaObj);

    // Procesar ENTREGA DE COMBUSTIBLE: por equipo, última hr/km + consumo promedio + historial.
    // No requiere Apps Script — la pestaña ya es plana (una fila = una carga).
    window._combustiblePorEquipo = procesarCombustible(combustibleObj);

    // Config del panel (⚙ en auditoría). Combustible pesados (Casares) no
    // trae costo por carga — se estima litros × precio configurado. Las
    // camionetas quedan afuera a propósito (Marcos: el precio es solo para
    // Casares): se identifican por el marcador "Remito " que el builder les
    // pone en OBSERVACIONES para esa 2ª fuente apilada al mismo stream.
    window._configPanel = (configResp && configResp.ok) ? configResp.config : {};
    const _precioPesados = window._configPanel.precioCombustiblePesados;
    // Gasto ESTIMADO de combustible pesados por mes (KPI superior + su rango
    // de meses) — separado de window._gastoCombLivianosPorMes (costo real)
    // para no mezclar un número inventado con uno cargado.
    const _gastoCombPesadosPorMes={};
    for(const codN of Object.keys(window._combustiblePorEquipo)){
      const eq=window._combustiblePorEquipo[codN];
      if(_precioPesados>0){
        for(const c of eq.cargas){
          if(c.costo==null && !(c.obs||'').startsWith('Remito') && c.litros>0){
            c.costo=c.litros*_precioPesados;
            c.costoEstimado=true; // litros×precio configurado, no un monto real cargado
            const d=_parseDate(c.fecha);
            if(d){
              const ym=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
              _gastoCombPesadosPorMes[ym]=(_gastoCombPesadosPorMes[ym]||0)+c.costo;
            }
          }
        }
      }
      // totalCosto recalculado sobre TODAS las cargas (incluye las recién
      // estimadas) — antes solo lo acumulaba procesarCombustibleLivianos,
      // acá queda consistente con lo que muestra cada fila de la tabla.
      eq.totalCosto=eq.cargas.reduce((s,c)=>s+(c.costo||0),0);
    }
    window._gastoCombPesadosPorMes=_gastoCombPesadosPorMes;

    window._pedidosEntregados=entregadosRaw.filter(p=>(p['N° PEDIDO']||p['N° ENTREGA']||'').trim()!=='');
    // Catálogo maestro: única fuente de equipos = 4 tabs de la hoja de CÓDIGOS
    window._estadoEquipos={
      ...parseCodigos(codV,'viales'),
      ...parseCodigos(codL,'liviano'),
      ...parseCodigos(codP,'pesado'),
      ...parseCodigos(codS,'soporte'),
    };

    // Combustible de livianos: matchea por patente al código de equipo y fusiona
    // en _combustiblePorEquipo (así detalle, consumo y operatividad lo toman igual).
    {
      const patenteToCarN={};
      for(const [codN,info] of Object.entries(window._estadoEquipos)){
        const p=normPat(info.patente);
        if(p)patenteToCarN[p]=codN;
      }
      const liv=procesarCombustibleLivianos(combLivianosRows,patenteToCarN);
      window._gastoCombLivianos=liv.gastoTotal;
      window._gastoCombLivianosPorMes=liv.gastoPorMes;
      window._cargasCombLivianosPorMes=liv.cargasPorMes;
      for(const codN of Object.keys(liv.porEquipo)){
        const e=liv.porEquipo[codN];
        const ex=window._combustiblePorEquipo[codN];
        if(!ex){ window._combustiblePorEquipo[codN]=e; continue; }
        // Colisión: NO es rara — 11 camionetas están en las DOS fuentes (la
        // planilla de camionetas entra a COMBUSTIBLE con lectura nula, y la de
        // Sanz trae el odómetro). Hay que fusionar cargas Y RECALCULAR el
        // consumo: antes solo se recomputaba la última lectura, así que el
        // promedio quedaba el de `ex` (null, porque esas filas no traen km) y
        // el consumo se mostraba "—" justo en las camionetas mejor cargadas.
        ex.cargas=(ex.cargas||[]).concat(e.cargas).sort((a,b)=>a.fechaSort-b.fechaSort);
        ex.totalLitros=(ex.totalLitros||0)+e.totalLitros;
        ex.totalCosto=(ex.totalCosto||0)+e.totalCosto;
        ex.unidad=e.unidad||ex.unidad;   // livianos manda: son km
        _recalcConsumo(ex);
      }
    }

    // Espejo de horas zaranda → trituradora. La trituradora (TRT-01) no tiene
    // horómetro propio: comparte tren de chancado con la zaranda (ZRN-01) y corre
    // las mismas horas. Copiamos la última lectura de la zaranda a la trituradora,
    // así se actualiza sola en cada carga de combustible de la zaranda. No tocamos
    // litros/costo de la trituradora (consume su propio gasoil) ni el promedio
    // (su L/hr no es medible con un horómetro muerto).
    {
      const zrn=window._combustiblePorEquipo['ZRN01'];
      if(zrn&&zrn.ultimaHr!=null){
        let trt=window._combustiblePorEquipo['TRT01'];
        if(!trt){ trt={unidad:'hr',cargas:[],ultimaHr:null,ultimaFecha:null,ultimaFechaSort:null,totalLitros:0,promedio:null}; window._combustiblePorEquipo['TRT01']=trt; }
        trt.ultimaHr=zrn.ultimaHr;
        trt.ultimaFecha=zrn.ultimaFecha;
        trt.ultimaFechaSort=zrn.ultimaFechaSort;
        trt.horasEspejoDe='ZRN-01';
      }
    }

    // VTV: lista incompleta a propósito, Marcos la va completando.
    window._vtvPorEquipo = procesarVTV(vtvRows);

    // Pendientes de carga (pestaña FALTANTES del snapshot).
    window._faltantes = (faltantesRows||[]).map(r=>({
      tipo:String(r['TIPO']||'').trim(),
      codigo:String(r['CODIGO']||'').trim(),
      equipo:String(r['EQUIPO']||'').trim(),
      detalle:String(r['DETALLE']||'').trim(),
      dias:String(r['DIAS']||'').trim(),
      prioridad:String(r['PRIORIDAD']||'').trim(),
    })).filter(f=>f.tipo&&f.codigo);
    renderFaltantes();

    // Trabajos pendientes de taller (pestaña TRAB_PEND del snapshot). Se
    // agrupan por equipo para el detalle Y se guardan planos para el tab
    // global. ESTADO por defecto es "Pendiente"; cualquier otra cosa cuenta
    // como resuelto (ej. "Resuelto", o vacío con FECHA_RESOLUCION cargada).
    {
      const lista=(trabPendRows||[]).map(r=>{
        const codigo=String(r['CODIGO']||'').trim();
        const estadoRaw=String(r['ESTADO']||'').trim();
        const fechaRes=String(r['FECHA_RESOLUCION']||'').trim();
        const resuelto=fechaRes!=='' || /resuel/i.test(estadoRaw);
        return {
          codigo, codN:normCod(codigo),
          equipo:String(r['EQUIPO']||'').trim(),
          fecha:String(r['FECHA']||'').trim(),
          descripcion:String(r['DESCRIPCION']||'').trim(),
          responsable:String(r['RESPONSABLE']||'').trim(),
          estado:estadoRaw||(resuelto?'Resuelto':'Pendiente'),
          fechaResolucion:fechaRes,
          descripcionResolucion:String(r['DESCRIPCION_RESOLUCION']||'').trim(),
          resuelto,
        };
      }).filter(t=>t.codN);
      lista.sort((a,b)=>(_parseDate(a.fecha)?.getTime()||0)-(_parseDate(b.fecha)?.getTime()||0));
      window._trabajosPendientes=lista;
      window._trabajosPendientesPorEquipo={};
      for(const t of lista)(window._trabajosPendientesPorEquipo[t.codN]=window._trabajosPendientesPorEquipo[t.codN]||[]).push(t);
      renderTrabajosPendientes();
    }

    // Render dashboard con entregas del mes actual (calculadas desde PANEL_REPUESTOS)
    renderDashboard(pendientesRaw,ctx.entregasMesActual);

    // Adjuntar costoTotal acumulado a cada equipo del catálogo (todos los meses)
    for(const eq of(window._equiposOrdenados||[])){
      const codN=normCod(eq.codigo);
      let total=0;
      for(const ym of Object.keys(ctx.costosPorMes||{})){
        total+=(ctx.costosPorMes[ym]||{})[codN]||0;
      }
      eq.costoTotal=total;
    }
    renderEquipoIndex();
    renderInactivos();

    // Barra de selección de rango de meses para los KPIs sensibles a tiempo
    // (costo, horas, combustible). Default = mes actual. Si el usuario ya había
    // cambiado el rango antes (refresh manual), respetar la selección.
    if(!Array.isArray(window._kpiMesesSel))window._kpiMesesSel=_ymsEnRango('mesActual');
    renderKpiRangeBar();
    _actualizarKpisDeRango();

    // Telemetría de flota — agregados que cruzan toda la flota
    renderTelemetriaFlota();

    const _hsl=document.getElementById('hsLast');
    if(_hsl)_hsl.textContent=fmtHora();
    document.getElementById('loadingState').style.display='none';
    document.getElementById('dashboard').style.display='block';
    setLoadProgress(80);

    setLoadProgress(100);

    // Tab costos downtime: lee el sheet COSTOS DOWNTIME (parámetros editables)
    // y renderiza. Fuera del flujo principal a propósito — si el sheet no está
    // accesible, el resto del panel no se entera.
    cargarCostosDowntime();

    precargarHorometros();
  }catch(e){
    document.getElementById('loadingState').style.display='none';
    document.getElementById('errorState').style.display='block';
    setHTML(document.getElementById('errorState'), html`<div style="color:var(--red);margin-bottom:8px">⚠ Error al cargar datos</div><div style="font-size:12px;color:var(--text3)">${e.message}</div><div style="margin-top:12px"><button data-action="loadAll" class="refresh-btn">Reintentar</button></div>`);
    setLoadProgress(100);
  }
  btn.classList.remove('loading');btn.textContent='↻ actualizar';
}

/* ═══════════════════════════════════════════════════════
   RANGO DE MESES PARA LOS KPIs (costo, horas, combustible)
═══════════════════════════════════════════════════════ */
// Devuelve la lista de años (4 dígitos) presentes en los datos con dato>0.
function _yearsDisponibles(){
  const yms=new Set([
    ...Object.keys(window._costosPorMes||{}),
    ...Object.keys(window._horasPorMesFlota||{}),
    ...Object.keys(window._gastoCombLivianosPorMes||{}),
  ]);
  // Filtrar años válidos (4 dígitos, entre 2020 y año actual + 1). Si una fila
  // de datos vino con fecha mal formateada (ej. "01/02/205"), el ym derivado
  // sería "205-02" y se filtra acá para no mostrar un botón inválido.
  const anioAct=new Date().getFullYear();
  return [...new Set([...yms].map(ym=>ym.slice(0,4)))]
    .filter(y=>/^\d{4}$/.test(y)&&+y>=2020&&+y<=anioAct+1)
    .sort();
}
// Devuelve los YMs (formato "YYYY-MM") correspondientes al rango pedido.
function _ymsEnRango(key){
  const todos=[...new Set([
    ...Object.keys(window._costosPorMes||{}),
    ...Object.keys(window._horasPorMesFlota||{}),
    ...Object.keys(window._gastoCombLivianosPorMes||{}),
  ])].sort();
  const now=new Date();
  const fmtYm=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  if(key==='mesActual'){
    // "mes" = mes actual SI ya tiene datos; si no (típico a principio de mes, o
    // meses todavía sin carga), caemos al mes MÁS RECIENTE con datos. Antes
    // devolvíamos el mes actual a secas → al arrancar junio los 3 KPIs sensibles
    // a tiempo quedaban en "—" (junio sin datos aún) y el panel parecía roto. El
    // label se deriva del ym devuelto, así que el subtítulo refleja el mes real.
    const cur=fmtYm(now);
    const validos=todos.filter(ym=>/^\d{4}-\d{2}$/.test(ym)&&+ym.slice(0,4)>=2020&&+ym.slice(0,4)<=now.getFullYear()+1);
    if(validos.includes(cur))return [cur];
    const previos=validos.filter(ym=>ym<=cur);
    if(previos.length)return [previos[previos.length-1]];
    return [validos.length?validos[validos.length-1]:cur];
  }
  if(key==='ult3'){
    const out=[];
    for(let i=0;i<3;i++)out.push(fmtYm(new Date(now.getFullYear(),now.getMonth()-i,1)));
    return out;
  }
  if(key==='ult6'){
    const out=[];
    for(let i=0;i<6;i++)out.push(fmtYm(new Date(now.getFullYear(),now.getMonth()-i,1)));
    return out;
  }
  if(/^\d{4}$/.test(key))return todos.filter(ym=>ym.startsWith(key+'-'));
  if(key==='todo')return todos;
  return [fmtYm(now)];
}
// Meses (YYYY-MM) con datos en algún KPI sensible a tiempo, ordenados.
function _mesesDisponibles(){
  return [...new Set([
    ...Object.keys(window._costosPorMes||{}),
    ...Object.keys(window._horasPorMesFlota||{}),
    ...Object.keys(window._gastoCombLivianosPorMes||{}),
    ...Object.keys(window._litrosCombPesadosPorMes||{}),
  ])].filter(ym=>/^\d{4}-\d{2}$/.test(ym)).sort();
}
// Meses seleccionados para los KPIs. Default = mes actual (o el más reciente con datos).
function _kpiYms(){
  const s=window._kpiMesesSel;
  if(Array.isArray(s)&&s.length)return s;
  return _ymsEnRango('mesActual');
}
// "2026-06" → "Jun'26"
function _ymCorto(ym){
  const M=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const p=String(ym||'').split('-');
  if(p.length<2)return String(ym||'');
  return (M[+p[1]-1]||'?')+"'"+p[0].slice(2);
}
// Label legible de la selección activa (1 mes, rango contiguo, o "N meses").
function _kpiLabel(){
  const yms=[..._kpiYms()].sort();
  if(!yms.length)return 'sin meses';
  if(yms.length===1)return ymLabel(yms[0]);
  const idx=ym=>{const[a,m]=ym.split('-');return +a*12+(+m-1);};
  const contiguo=yms.every((ym,i)=>i===0||idx(ym)-idx(yms[i-1])===1);
  return contiguo?`${ymLabel(yms[0])} – ${ymLabel(yms[yms.length-1])}`:`${yms.length} meses`;
}
// Suma valores por YM (acepta map ym→número o ym→objeto).
function _sumarPorMes(map,yms){
  let s=0;
  for(const ym of yms){
    const v=(map||{})[ym];
    if(v==null)continue;
    if(typeof v==='number')s+=v;
    else if(typeof v==='object')s+=Object.values(v).reduce((a,b)=>a+(b||0),0);
  }
  return s;
}
function renderKpiRangeBar(){
  const bar=document.getElementById('kpiRangeBar');
  if(!bar)return;
  const sel=new Set(_kpiYms());
  const meses=_mesesDisponibles();
  const now=new Date();
  const fmtYm=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  const ult=n=>{const o=[];for(let i=0;i<n;i++)o.push(fmtYm(new Date(now.getFullYear(),now.getMonth()-i,1)));return o.filter(ym=>meses.includes(ym));};
  // Atajos: fijan la selección. Chips: togglean un mes (multi-selección).
  const fill=(label,yms)=>html`<button class="kpi-range-btn" data-action="setKpiMeses" data-arg="${yms.join(',')}">${label}</button>`;
  const chip=ym=>html`<button class="kpi-range-btn kpi-mes-chip${sel.has(ym)?' active':''}" data-action="toggleKpiMes" data-arg="${ym}">${_ymCorto(ym)}</button>`;
  const atajos=[fill('mes',_ymsEnRango('mesActual')),fill('últ 3m',ult(3)),fill('últ 6m',ult(6)),fill('todo',meses)];
  setHTML(bar, html`<span class="lbl">meses ›</span>${atajos}<span class="kpi-range-sep"></span>${meses.map(chip)}`);
}
// Fija la selección de meses (reemplaza la actual). Acepta array o string "ym,ym".
function setKpiMeses(yms){
  const arr=Array.isArray(yms)?yms:String(yms||'').split(',');
  window._kpiMesesSel=[...new Set(arr.filter(Boolean))].sort();
  renderKpiRangeBar();
  _actualizarKpisDeRango();
}
// Agrega/quita un mes de la selección.
function toggleKpiMes(ym){
  const sel=new Set(_kpiYms());
  if(sel.has(ym))sel.delete(ym); else sel.add(ym);
  setKpiMeses([...sel]);
}
// Recalcula y re-renderea los 3 KPIs sensibles a tiempo (costo, horas, combustible).
function _actualizarKpisDeRango(){
  const yms=_kpiYms();
  const labelRango=_kpiLabel();
  // --- Costo en repuestos ---
  const costo=_sumarPorMes(window._costosPorMes||{},yms);
  const entregaCostos=window._entregaCostos||{};
  const ymsSet=new Set(yms);
  // entregaCostos[nro].mes viene como "Ene 2026" (label), no YM. Convertimos.
  const _MES_MAP={ene:'01',feb:'02',mar:'03',abr:'04',may:'05',jun:'06',jul:'07',ago:'08',sep:'09',oct:'10',nov:'11',dic:'12'};
  const _mesLabelToYm=label=>{
    const m=String(label||'').toLowerCase().match(/([a-z]{3})\s*(\d{4})/);
    if(!m)return'';
    const mm=_MES_MAP[m[1]];
    return mm?`${m[2]}-${mm}`:'';
  };
  let entConCosto=0;
  for(const nro of Object.keys(entregaCostos)){
    const e=entregaCostos[nro];
    if(e&&e.costo>0&&ymsSet.has(_mesLabelToYm(e.mes)))entConCosto++;
  }
  const cardC=document.getElementById('kpiCostoCard');
  const valC=document.getElementById('kpiCostoVal');
  const subC=document.getElementById('kpiCostoSub');
  if(valC)valC.textContent=costo>0?formatMoney(costo):'—';
  if(subC)subC.textContent=`${labelRango} · ${fmtInt(entConCosto)} entregas con costo`;
  if(cardC){cardC.classList.toggle('kpi-empty',!(costo>0));cardC.classList.toggle('kpi-clickable',costo>0);}
  // --- Horas en taller ---
  const horasTotal=_sumarPorMes(window._horasPorMesFlota||{},yms);
  const horasCorr=_sumarPorMes(window._horasCorrPorMes||{},yms);
  const horasPrev=_sumarPorMes(window._horasPrevPorMes||{},yms);
  const corrPct=horasTotal>0?Math.round(horasCorr/horasTotal*100):0;
  const prevPct=horasTotal>0?100-corrPct:0;
  const cardH=document.getElementById('kpiHorasCard');
  const valH=document.getElementById('kpiHorasVal');
  const subH=document.getElementById('kpiHorasSub');
  if(valH)valH.textContent=horasTotal>0?fmtInt(Math.round(horasTotal))+' hr':'—';
  if(subH){
    if(horasTotal>0){
      subH.classList.add('hr-split');
      setHTML(subH, new RawHTML(`<div class="hr-split-bar"><span class="corr" style="width:${corrPct}%"></span><span class="prev" style="width:${prevPct}%"></span></div><span class="hr-split-leg"><i class="corr"></i>${fmtInt(Math.round(horasCorr))} hr correctivo · ${corrPct}%</span><span class="hr-split-leg"><i class="prev"></i>${fmtInt(Math.round(horasPrev))} hr preventivo · ${prevPct}%</span>`));
    }else{
      subH.classList.remove('hr-split');
      subH.textContent=`${labelRango} · sin horas registradas`;
    }
  }
  if(cardH){cardH.classList.toggle('kpi-empty',!(horasTotal>0));cardH.classList.toggle('kpi-clickable',horasTotal>0);}
  // --- Combustible livianos ---
  const gastoComb=_sumarPorMes(window._gastoCombLivianosPorMes||{},yms);
  const cargasComb=_sumarPorMes(window._cargasCombLivianosPorMes||{},yms);
  const cardG=document.getElementById('kpiCombCard');
  const valG=document.getElementById('kpiCombVal');
  const subG=document.getElementById('kpiCombSub');
  if(valG)valG.textContent=gastoComb>0?formatMoney(gastoComb):'—';
  if(subG)subG.textContent=gastoComb>0?`${fmtInt(cargasComb)} cargas · ${labelRango}`:'sin cargas en el rango';
  if(cardG){cardG.classList.toggle('kpi-empty',!(gastoComb>0));cardG.classList.toggle('kpi-clickable',gastoComb>0);}
  // --- Combustible pesados (litros × precio configurado — Casares no trae
  // costo por carga, ver ⚙ auditoría). window._gastoCombPesadosPorMes queda
  // vacío si no hay precio cargado: no se inventa un número sin base. ---
  const litrosPes=_sumarPorMes(window._litrosCombPesadosPorMes||{},yms);
  const cargasPes=_sumarPorMes(window._cargasCombPesadosPorMes||{},yms);
  const gastoPes=_sumarPorMes(window._gastoCombPesadosPorMes||{},yms);
  const cardP=document.getElementById('kpiCombPesCard');
  const valP=document.getElementById('kpiCombPesVal');
  const subP=document.getElementById('kpiCombPesSub');
  if(valP)valP.textContent=gastoPes>0?formatMoney(gastoPes):'—';
  if(subP){
    subP.textContent = gastoPes>0
      ? `${fmtInt(cargasPes)} cargas · ${fmtInt(Math.round(litrosPes))} L · ${labelRango} · estimado`
      : litrosPes>0
        ? `${fmtInt(litrosPes)} L sin precio — cargalo en ⚙ auditoría`
        : 'sin cargas en el rango';
  }
  if(cardP){cardP.classList.toggle('kpi-empty',!(gastoPes>0));cardP.classList.toggle('kpi-clickable',gastoPes>0);}
}
