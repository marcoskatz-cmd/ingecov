/* ══════════════════════════════════════════════════════════════════
   03-ui.js — parte 3/8 de la app del panel INGECO.
   Los 8 archivos son SCRIPTS CLÁSICOS que comparten el mismo scope
   global y se cargan EN ORDEN (defer) desde index.html: mover uno de
   lugar rompe las dependencias. No convertir a type=module sin
   revisar ACTIONS y el bootstrap del PIN.
══════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════
   GRÁFICO
═══════════════════════════════════════════════════════ */
// Lee una CSS var del :root al momento del llamado (devuelve fallback si no existe).
// Permite que los charts se vean correctos al tema actual sin tener que redibujarlos al cambiar.
const _cssVar=(name,fallback='#888')=>{
  const v=getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v||fallback;
};
/* ═══════════════════════════════════════════════════════
   UI — SECCIONES, FILTROS, VISTAS
═══════════════════════════════════════════════════════ */
function toggleSection(id){
  const content=document.getElementById(id);const label=content.previousElementSibling;
  const chev=label.querySelector('.section-chevron');const now=content.classList.toggle('collapsed');
  label.classList.toggle('collapsed',now);chev.textContent=now?'▸':'▾';
}

// Navegación por tabs (reemplaza los desplegables). Los KPIs quedan siempre fijos.
function setTab(id,t){
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.id===id));
  document.querySelectorAll('#tabBar .tab-btn').forEach(b=>
    b.classList.toggle('active', b===t || b.dataset.arg===id));
  // Chart.js renderizado mientras el panel está oculto (display:none) colapsa a
  // 0px; al mostrar telemetría hay que reajustarlo.
  if(id==='tabTelemetria'&&_chartComboFlota){try{_chartComboFlota.resize();}catch(_){}}
  if(id==='tabReemplazo'){ renderReemplazo(); }
  if(id==='tabConsulta'){ try{ _renderConsultaRecientes(); }catch(_){} }
}

function toggleEqSec(uid){
  const body=document.getElementById('eqsec_'+uid);const chev=document.getElementById('echev_'+uid);
  if(!body||!chev)return;const hidden=body.style.display==='none';
  body.style.display=hidden?'':'none';chev.textContent=hidden?'▾':'▸';
}

let _secCounter=0;
function eqSection(title,content,open=true){
  const uid='sec'+(++_secCounter);
  // content y title pueden venir como RawHTML (de html``) o como string ya armado.
  // Los envolvemos en RawHTML si son strings que la app construyó, para no doble-escapar.
  const titleH = title instanceof RawHTML ? title : new RawHTML(String(title));
  const contH  = content instanceof RawHTML ? content : new RawHTML(String(content));
  return html`<div><div class="eq-sub-label" data-action="toggleEqSec" data-arg="${uid}">${titleH}<span class="eq-chev" id="echev_${uid}">${open?'▾':'▸'}</span></div>
  <div id="eqsec_${uid}" class="eq-sec-body" ${open?new RawHTML(''):new RawHTML('style="display:none"')}>${contH}</div></div>`;
}

// FILTRO DE ESTADO
let _filtroEstado='todos';
let _filtroBtn=null;
function setFiltroEstado(est,btn){
  _filtroEstado=est;
  // Scope: limpiar .active solo en el bar de estado, no afectar al bar de categoría
  document.querySelectorAll('#filterBar .filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');_filtroBtn=btn;
  aplicarFiltros();
}

// FILTRO DE CATEGORÍA (tab de origen en la hoja de CÓDIGOS)
let _filtroCategoria='todas';
function setFiltroCategoria(cat,btn){
  _filtroCategoria=cat;
  document.querySelectorAll('#filterBarCat .filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  aplicarFiltros();
}

// FILTRO DE UBICACIÓN (lugar de trabajo / obra, viene de CÓDIGOS)
let _filtroUbicacion='todas';
// Normalización: trim + uppercase + sin tildes para deduplicar variantes
// ("Obra Tafí", "OBRA TAFI", "obra tafí") manteniendo la primera forma vista para mostrar
const normUbi=s=>String(s||'').trim().toUpperCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/\s+/g,' ');
function setFiltroUbicacion(ubi,btn){
  _filtroUbicacion=ubi;
  document.querySelectorAll('#filterBarUbi .filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  aplicarFiltros();
}

// FILTRO DE TENENCIA (propio / alquilado, viene de CÓDIGOS columna OBSERVACIÓN)
let _filtroTenencia='todas';
function setFiltroTenencia(ten,btn){
  _filtroTenencia=ten;
  document.querySelectorAll('#filterBarTen .filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  aplicarFiltros();
}

// BÚSQUEDA
let _searchQuery='';
function onSearch(val){
  _searchQuery=val.toLowerCase().trim();
  document.getElementById('searchClear').classList.toggle('visible',!!val);
  aplicarFiltros();
}
function clearSearch(){
  document.getElementById('equipoBuscador').value='';
  document.getElementById('searchClear').classList.remove('visible');
  _searchQuery='';aplicarFiltros();
}

function aplicarFiltros(){
  // Solo equipos activos: los inactivos no están en #equipoGrid ni cuentan acá.
  const eq=(window._equiposOrdenados||[]).filter(e=>!esEquipoInactivo(e.codigo));

  // ─── Pre-paso: validar selecciones de filtro contra el dataset absoluto.
  // Si la opción seleccionada no existe en los datos (recarga, dataset cambió),
  // resetear a 'todas' para evitar estados huérfanos. ───
  let sinUbiAbs=0;
  const ubiKeysAbs=new Set();
  let totalDescAbs=0;
  for(const e of eq){
    const info=(window._estadoEquipos||{})[normCod(e.codigo)]||{};
    const k=normUbi(info.ubicacion);
    if(!k)sinUbiAbs++; else ubiKeysAbs.add(k);
    if((info.tenencia||'desconocido')==='desconocido')totalDescAbs++;
  }
  if(_filtroUbicacion!=='todas'&&_filtroUbicacion!=='__sin__'&&!ubiKeysAbs.has(_filtroUbicacion)){
    _filtroUbicacion='todas';
  }
  if(_filtroUbicacion==='__sin__'&&sinUbiAbs===0){_filtroUbicacion='todas';}
  if(_filtroTenencia==='desconocido'&&totalDescAbs===0)_filtroTenencia='todas';

  // ─── Calcular flags de match por equipo (una sola pasada) ───
  const matches=eq.map(e=>{
    const info=(window._estadoEquipos||{})[normCod(e.codigo)]||{};
    const estKey=ESTADO_COLOR(info.estado);
    const estVal=estKey==='green'?'operativo':estKey==='amber'?'reparacion':estKey==='red'?'parado':'sin-estado';
    const catVal=info.categoria||'';
    const rawUbi=info.ubicacion||'';
    const ubiKey=normUbi(rawUbi);
    const tenVal=info.tenencia||'desconocido';
    const nom=(e.nombre||'').toLowerCase();
    const codStr=(e.codigo||'').toLowerCase();
    return{
      codigo:e.codigo, estVal, catVal, ubiKey, rawUbi, tenVal,
      mQ:!_searchQuery||codStr.includes(_searchQuery)||nom.includes(_searchQuery),
      mE:_filtroEstado==='todos'||estVal===_filtroEstado,
      mC:_filtroCategoria==='todas'||catVal===_filtroCategoria,
      mU:_filtroUbicacion==='todas'||(_filtroUbicacion==='__sin__'&&!ubiKey)||ubiKey===_filtroUbicacion,
      mT:_filtroTenencia==='todas'||tenVal===_filtroTenencia,
    };
  });
  const byCod={};for(const m of matches)byCod[m.codigo]=m;

  // ─── Aplicar visibilidad al DOM ───
  let totalVisible=0;
  document.querySelectorAll('#equipoGrid .equipo-card, #equipoGrid .equipo-list-row').forEach(el=>{
    const m=byCod[el.dataset.cod||''];
    const show=m&&m.mQ&&m.mE&&m.mC&&m.mU&&m.mT;
    el.classList.toggle('hidden',!show);
    if(show)totalVisible++;
  });

  // ─── Conteos faceteados: para cada barra X, contar los que cumplen TODOS
  // los filtros menos el de X. Así el número junto al botón muestra cuántos
  // equipos pasarían al seleccionarlo (manteniendo el resto de filtros). ───
  const cE={_total:0,operativo:0,reparacion:0,parado:0,'sin-estado':0};
  const cC={_total:0,viales:0,liviano:0,pesado:0,soporte:0};
  const cT={_total:0,propio:0,alquilado:0,desconocido:0};
  const ubiGrupos={};
  let sinUbiFacet=0;
  for(const m of matches){
    if(m.mQ&&m.mC&&m.mU&&m.mT){cE._total++;cE[m.estVal]=(cE[m.estVal]||0)+1;}
    if(m.mQ&&m.mE&&m.mU&&m.mT){cC._total++;if(cC.hasOwnProperty(m.catVal))cC[m.catVal]++;}
    if(m.mQ&&m.mE&&m.mC&&m.mT){
      if(!m.ubiKey)sinUbiFacet++;
      else{
        if(!ubiGrupos[m.ubiKey])ubiGrupos[m.ubiKey]={label:m.rawUbi.trim(),count:0};
        ubiGrupos[m.ubiKey].count++;
      }
    }
    if(m.mQ&&m.mE&&m.mC&&m.mU){cT._total++;cT[m.tenVal]=(cT[m.tenVal]||0)+1;}
  }
  // Asegurar que todas las ubicaciones del dataset aparezcan como botón,
  // aunque su conteo facetado sea 0 (para que el usuario pueda re-seleccionarlas).
  for(const k of ubiKeysAbs){
    if(!ubiGrupos[k]){
      const m=matches.find(x=>x.ubiKey===k);
      ubiGrupos[k]={label:(m?.rawUbi||k).trim(),count:0};
    }
  }
  const totalUbiFacet=Object.values(ubiGrupos).reduce((s,v)=>s+v.count,0)+sinUbiFacet;

  // ─── Actualizar contadores en el DOM ───
  const setN=(id,n)=>{const el=document.getElementById(id);if(el)el.textContent=n;};
  setN('fcTodos',cE._total);
  setN('fcOper',cE.operativo);
  setN('fcRep',cE.reparacion);
  setN('fcPar',cE.parado);
  setN('fcSin',cE['sin-estado']);
  setN('fcCatTodas',cC._total);
  setN('fcCatViales',cC.viales);
  setN('fcCatLiviano',cC.liviano);
  setN('fcCatPesado',cC.pesado);
  setN('fcCatSoporte',cC.soporte);
  setN('fcTenTodas',cT._total);
  setN('fcTenProp',cT.propio);
  setN('fcTenAlq',cT.alquilado);
  setN('fcTenDesc',cT.desconocido);
  const btnDesc=document.getElementById('btnTenDesc');
  if(btnDesc)btnDesc.style.display=totalDescAbs>0?'':'none';

  // ─── Barra de ubicación: regenerar para reflejar conteos faceteados.
  // Ordenar por conteo desc (las obras con más equipos primero). ───
  (function renderFiltroUbi(){
    const bar=document.getElementById('filterBarUbi');if(!bar)return;
    const ordenados=Object.entries(ubiGrupos).sort((a,b)=>b[1].count-a[1].count);
    // esc() ahora es global (helper de templating seguro definido al inicio del script).
    const btns=[
      html`<button class="filter-btn${_filtroUbicacion==='todas'?' active':''}" data-action="setFiltroUbicacion" data-arg="todas">Todas ubicaciones <span class="f-count">${totalUbiFacet}</span></button>`,
      ...ordenados.map(([k,v])=>
        html`<button class="filter-btn${_filtroUbicacion===k?' active':''}" data-action="setFiltroUbicacion" data-arg="${k}" title="${v.label}">${v.label} <span class="f-count">${v.count}</span></button>`
      ),
    ];
    if(sinUbiAbs>0){
      btns.push(html`<button class="filter-btn${_filtroUbicacion==='__sin__'?' active':''}" data-action="setFiltroUbicacion" data-arg="__sin__">Sin ubicación <span class="f-count">${sinUbiFacet}</span></button>`);
    }
    setHTML(bar, btns);
  })();

  // Total visible (todos los filtros aplicados)
  const cEq=document.getElementById('equipoCount');if(cEq)cEq.textContent=totalVisible+' equipos';

  // Si hay un detalle abierto: si la tarjeta activa quedó oculta por el filtro,
  // cerramos; si sigue visible, reubicamos el panel porque las filas cambiaron.
  if(_activeEqCard&&document.getElementById('equipoDetailPanel')?.classList.contains('open')){
    if(_activeEqCard.classList.contains('hidden'))closeEquipoDetail();
    else placeDetailPanelNearCard(_activeEqCard);
  }
}

/* ═══════════════════════════════════════════════════════
   SECCIÓN EQUIPOS INACTIVOS — desuso / no operativos
   Tabla read-only aparte de la grilla principal. Filtro propio
   que distingue "en desuso" de "no operativo".
═══════════════════════════════════════════════════════ */
let _filtroInactivo='todos';
function setFiltroInactivo(f,btn){
  _filtroInactivo=f;
  document.querySelectorAll('#filterBarInact .filter-btn').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  renderInactivos();
}
function renderInactivos(){
  const body=document.getElementById('inactivosBody');
  if(!body)return;
  // Si hay un detalle abierto dentro de esta sección, cerrarlo antes de re-render
  // (de lo contrario _activeEqCard quedaría apuntando a un nodo huérfano).
  if(_activeEqCard&&_activeEqCard.closest('#inactivosBody'))closeEquipoDetail();
  const CAT_LABEL={viales:'Viales/asfalto',liviano:'T. liviano',pesado:'T. pesado',soporte:'Soporte'};
  const inactivos=(window._equiposOrdenados||[])
    .filter(e=>esEquipoInactivo(e.codigo))
    .map(e=>{
      const info=(window._estadoEquipos||{})[normCod(e.codigo)]||{};
      const hor=(window._horometros||{})[normCod(e.codigo)];
      return{
        codigo:e.codigo,
        nombre:buildEquipoNombre(e.clasificacion||info.clasificacion,e.marca,e.modelo,e.nombre),
        categoria:e.categoria||info.categoria||'',
        estado:info.estado||'',
        subtipo:subtipoInactivo(info.estado),
        ubicacion:info.ubicacion||'',
        patente:hor?.patente||info.patente||'',
        costoTotal:e.costoTotal||0,
      };
    })
    .sort((a,b)=>a.codigo.localeCompare(b.codigo));

  const nDesuso=inactivos.filter(x=>x.subtipo==='desuso').length;
  const nNoOp  =inactivos.filter(x=>x.subtipo==='no-operativo').length;
  const nSinEst=inactivos.filter(x=>x.subtipo==='sin-estado').length;
  const setN=(id,n)=>{const el=document.getElementById(id);if(el)el.textContent=n;};
  setN('fcInactTodos',inactivos.length);
  setN('fcInactDesuso',nDesuso);
  setN('fcInactNoOp',nNoOp);
  setN('fcInactSinEst',nSinEst);
  const badge=document.getElementById('inactivosBadge');
  if(badge)badge.textContent=inactivos.length;

  const vis=inactivos.filter(x=>_filtroInactivo==='todos'||x.subtipo===_filtroInactivo);
  if(!vis.length){
    setHTML(body, html`<div class="no-data">Sin equipos inactivos${_filtroInactivo!=='todos'?' en este filtro':''}.</div>`);
    return;
  }
  // esc() es global (helper de templating seguro definido al inicio del script).
  // Recuadros con el mismo formato que la grilla principal de equipos.
  setHTML(body, html`<div class="equipo-grid">${vis.map(x=>{
    const est=ESTADO_COLOR(x.estado);
    const estLabel=x.subtipo==='sin-estado'?'Sin estado':(x.estado||'—');
    return html`<div class="equipo-card" id="eqcard_${x.codigo.replace(/[^a-z0-9]/gi,'_')}"
      data-cod="${x.codigo}" data-nom="${x.nombre}"
      data-action="toggleEquipoDetail" data-arg="${x.codigo}">
      <div class="eq-status-strip ${est}"></div>
      <div class="eq-code">${x.codigo}</div>
      <div class="eq-name">${x.nombre||'—'}</div>
      <div class="eq-meta">
        <span style="color:${ESTADO_CSS[est]}">${estLabel}</span>
        ${x.categoria?html`<span>${CAT_LABEL[x.categoria]||x.categoria}</span>`:''}
        ${x.patente?html`<span class="eq-patente" title="Patente">${x.patente}</span>`:''}
        ${x.ubicacion?html`<span>${x.ubicacion}</span>`:''}
        ${x.costoTotal>0?html`<span style="color:var(--amber)" title="Costo acumulado en repuestos">${formatMoney(x.costoTotal)}</span>`:''}
      </div>
    </div>`;
  })}</div>`);
}

// VISTA
let _viewMode='grid';
function setViewMode(mode){
  _viewMode=mode;
  document.getElementById('btnGrid').classList.toggle('active',mode==='grid');
  document.getElementById('btnList').classList.toggle('active',mode==='list');
  renderEquipoIndex();
}

// RENDER DEL ÍNDICE — incluye estado, patente, horómetro.
// Solo renderiza cards/lista; los contadores y la barra de ubicación los maneja
// aplicarFiltros() para que se recalculen facetados en cada cambio de filtro.
function renderEquipoIndex(equipos){
  if(equipos)window._equiposOrdenados=equipos;
  // La grilla principal muestra solo equipos activos. Los inactivos (desuso /
  // no operativos) se renderizan aparte en renderInactivos().
  const eq=(window._equiposOrdenados||[]).filter(e=>!esEquipoInactivo(e.codigo));
  const grid=document.getElementById('equipoGrid');if(!grid)return;

  // Si hay un detalle abierto, cerrarlo antes de reemplazar innerHTML.
  // De lo contrario _activeEqCard apuntaría a un nodo huérfano.
  if(_activeEqCard)closeEquipoDetail();

  const getPatente=cod=>{
    const hor=(window._horometros||{})[normCod(cod)];
    if(hor?.patente)return hor.patente;
    const info=(window._estadoEquipos||{})[normCod(cod)];
    return info?.patente||null;
  };

  if(_viewMode==='list'){
    grid.className='';
    setHTML(grid, eq.length?html`<div class="equipo-list-wrap">${eq.map(e=>{
      const info=(window._estadoEquipos||{})[normCod(e.codigo)];
      const hor=(window._horometros||{})[normCod(e.codigo)];
      const est=ESTADO_COLOR(info?.estado);const estCss=ESTADO_CSS[est];
      const patente=getPatente(e.codigo);
      const titulo=buildEquipoNombre(e.clasificacion,e.marca,e.modelo,e.nombre);
      const tienePend=(window._equiposConPendientes||new Set()).has(normCod(e.codigo));
      const ten=info?.tenencia;
      const tenLabel=info?.observacion||(ten==='propio'?'Propio':ten==='alquilado'?'Alquilado':'');
      const tenBadge=(ten==='propio'||ten==='alquilado')?html`<span class="eq-tenencia ${ten}" title="Tenencia: ${tenLabel}">${tenLabel}</span>`:'';
      const _dim = !(e.costoTotal>0) && !tienePend;
      const op=operatividadEquipo(normCod(e.codigo));
      return html`<div class="equipo-list-row${tienePend?' has-pending':''}${_dim?' dim':''}" id="eqcard_${e.codigo.replace(/[^a-z0-9]/gi,'_')}"
        data-cod="${e.codigo}" data-nom="${e.nombre}" data-est="${est==='green'?'operativo':est==='amber'?'reparacion':est==='red'?'parado':'sin-estado'}"
        title="${tienePend?'Tiene pedidos pendientes':''}"
        data-action="toggleEquipoDetail" data-arg="${e.codigo}">
        <span class="eq-list-dot" style="background:${estCss}" title="${info?.estado||'Sin estado'}"></span>
        <span class="eq-list-code">${e.codigo}</span>
        <span class="eq-list-name">${titulo}</span>
        <div class="eq-list-meta">
          ${tienePend?html`<span class="pending-dot" title="Pedidos pendientes"></span>`:''}
          ${op.nivel!=='sin-datos'?html`<span style="color:${op.color};font-weight:600" title="Operatividad de service · ${op.label}">● ${op.label}</span>`:''}
          ${tenBadge}
          ${patente?html`<span class="eq-patente">${patente}</span>`:''}
          ${info?.ubicacion?html`<span>${info.ubicacion}</span>`:''}
          ${e.costoTotal>0?html`<span style="color:var(--amber)">${formatMoney(e.costoTotal)}</span>`:''}
          ${hor?.actual?html`<span style="color:var(--blue)">${hor.actual}</span>`:''}
        </div>
      </div>`;
    })}</div>`:html`<div class="no-data">Sin equipos</div>`);
  }else{
    grid.className='equipo-grid';
    setHTML(grid, eq.length?eq.map(e=>{
      const info=(window._estadoEquipos||{})[normCod(e.codigo)];
      const hor=(window._horometros||{})[normCod(e.codigo)];
      const est=ESTADO_COLOR(info?.estado);
      const patente=getPatente(e.codigo);
      const titulo=buildEquipoNombre(e.clasificacion||info?.clasificacion||TIPO_EQUIPO(e.codigo),e.marca,e.modelo,e.nombre);
      const tienePend=(window._equiposConPendientes||new Set()).has(normCod(e.codigo));
      const ten=info?.tenencia;
      const tenLabel=info?.observacion||(ten==='propio'?'Propio':ten==='alquilado'?'Alquilado':'');
      const tenBadge=(ten==='propio'||ten==='alquilado')?html`<span class="eq-tenencia ${ten}" title="Tenencia: ${tenLabel}">${tenLabel}</span>`:'';
      const _dim = !(e.costoTotal>0) && !tienePend;
      const op=operatividadEquipo(normCod(e.codigo));
      return html`<div class="equipo-card${tienePend?' has-pending':''}${_dim?' dim':''}" id="eqcard_${e.codigo.replace(/[^a-z0-9]/gi,'_')}"
        data-cod="${e.codigo}" data-nom="${e.nombre}" data-est="${est==='green'?'operativo':est==='amber'?'reparacion':est==='red'?'parado':'sin-estado'}"
        title="${tienePend?'Tiene pedidos pendientes':''}"
        data-action="toggleEquipoDetail" data-arg="${e.codigo}">
        <div class="eq-status-strip ${est}"></div>
        <div class="eq-code">${e.codigo}</div>
        <div class="eq-name">${titulo}</div>
        <div class="eq-meta">
          ${op.nivel!=='sin-datos'?html`<span style="color:${op.color};font-weight:600" title="Operatividad de service · ${op.label}">● ${op.label}</span>`:''}
          ${tenBadge}
          ${patente?html`<span class="eq-patente" title="Patente">${patente}</span>`:''}
          ${info?.estado?html`<span style="color:${ESTADO_CSS[est]}">${info.estado}</span>`:''}
          ${e.costoTotal>0?html`<span style="color:var(--amber)">${formatMoney(e.costoTotal)}</span>`:''}
          ${hor?.actual?html`<span style="color:var(--blue)" title="Horómetro actual">${hor.actual}</span>`:''}
        </div>
      </div>`;
    }):html`<div class="no-data">Sin equipos</div>`);
  }
  aplicarFiltros();
}
