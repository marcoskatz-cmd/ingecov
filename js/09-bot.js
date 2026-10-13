/* ══════════════════════════════════════════════════════════════════
   09-bot.js — AlberBot: chat con Claude sobre los datos del panel.
   Script clásico, se carga DESPUÉS de 08-bootstrap.js (usa ACTIONS,
   setHTML/html, normCod, operatividadEquipo y los globales window._*).

   Arquitectura:
   - El navegador arma la conversación y un catálogo de HERRAMIENTAS
     (BOT_TOOLS) que se ejecutan ACÁ, sobre los datos que loadAll ya
     cargó. Claude nunca ve el snapshot entero: pide una herramienta,
     el browser la corre y le devuelve JSON compacto.
   - La API key vive en el Apps Script (bot.js, doPost). El panel manda
     {ep:'bot', nueva, tools, messages} por POST text/plain (sin preflight
     CORS) a REFRESH_URL y recibe los content blocks crudos de Claude.
   - El historial se guarda VERBATIM (incluidos bloques thinking/tool_use)
     y es append-only: nunca se recorta — cuando se pasa de largo, se
     empieza una conversación nueva.
══════════════════════════════════════════════════════════════════ */

const BOT_MAX_TOOL_ROUNDS = 8;      // rondas herramienta→modelo por pregunta
const BOT_MAX_TURNOS      = 20;     // preguntas por conversación antes de reiniciar
const BOT_MAX_FILAS       = 60;     // tope de filas por resultado de herramienta

let _botAbierto   = false;
let _botOcupado   = false;
let _botMessages  = [];             // historial crudo para la API
let _botCupo      = { usadas: null, cupo: null };
let _botTurnos    = 0;

/* ───────────────────────── helpers de datos ───────────────────────── */
function _botEq(codN){
  const info=(window._estadoEquipos||{})[codN];
  if(!info)return null;
  return {
    codigo: info.rawCod||codN,
    nombre: (typeof buildEquipoNombre==='function'?buildEquipoNombre(info.clasificacion,info.marca,info.modelo,info.equipo):'')||info.equipo||info.rawCod||codN,
    marca: info.marca||'', modelo: info.modelo||'', clasificacion: info.clasificacion||'',
    categoria: info.categoria||'', estado: info.estado||'', ubicacion: info.ubicacion||'',
    operario: info.operario||'', patente: info.patente||'', tenencia: info.tenencia||'', anio: info.anio||'',
  };
}
function _botResolverCod(codigo){
  const codN=normCod(codigo||'');
  if(!codN)return null;
  if((window._estadoEquipos||{})[codN])return codN;
  // match por prefijo/contención entre los códigos conocidos
  const keys=Object.keys(window._estadoEquipos||{});
  const hit=keys.find(k=>k===codN)||keys.find(k=>k.startsWith(codN))||keys.find(k=>k.includes(codN));
  return hit||codN;
}
function _botYmDe(fechaStr){
  const d=_parseDate(fechaStr);
  if(!d)return null;
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
}
function _botEnRango(ym,desde,hasta){
  if(!ym)return !desde&&!hasta;
  if(desde&&ym<desde)return false;
  if(hasta&&ym>hasta)return false;
  return true;
}
function _botTruncar(arr,label){
  const total=arr.length;
  if(total<=BOT_MAX_FILAS)return {total, filas:arr};
  return {total, mostrando:BOT_MAX_FILAS, nota:`mostrando ${BOT_MAX_FILAS} de ${total} ${label||'filas'}`, filas:arr.slice(0,BOT_MAX_FILAS)};
}
function _botNum(v){ const n=typeof v==='number'?v:parseFloat(String(v||'').replace(/\./g,'').replace(',','.')); return isFinite(n)?Math.round(n):null; }
function _botTexto(s){ return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase(); }

// Todas las filas de PANEL_TRABAJOS con claves canónicas (mismo mapeo que loadTrabajosRegistro).
function _botTrabajosTodos(){
  const raw=window._panelTrabajosRaw||[];
  const SIN={
    codigo:['CODIGO','COD','CODIGO EQUIPO'],
    equipo:['EQUIPO','NOMBRE EQUIPO','DESCRIPCION EQUIPO'],
    fecha :['FECHA TRABAJO','FECHA DE TRABAJO','FECHA'],
    lugar :['LUGAR TRABAJO','LUGAR DE TRABAJO','LUGAR','UBICACION'],
    desc  :['DESCRIPCION TRABAJOS','TRABAJOS REALIZADOS','TRABAJO REALIZADO','DESCRIPCION TRABAJO','DESCRIPCION'],
    tiempo:['TIEMPO TRABAJO','TIEMPO (HR)','TIEMPO TRABAJO (HR)','TIEMPO TRABAJO HR','TIEMPO HR','TIEMPO','HORAS','HS'],
    razon :['RAZON TRABAJO','RAZON DE TRABAJO','RAZON','MOTIVO TRABAJO','MOTIVO'],
  };
  return raw.map(r=>{
    const idx={}; for(const k of Object.keys(r))idx[normHead(k)]=r[k];
    const get=keys=>{for(const k of keys){const v=idx[k];if(v!=null&&String(v).trim()!=='')return String(v).trim();}return'';};
    return {codigo:get(SIN.codigo),codN:normCod(get(SIN.codigo)),equipo:get(SIN.equipo),fecha:get(SIN.fecha),lugar:get(SIN.lugar),desc:get(SIN.desc),horas:_botNum(get(SIN.tiempo)),razon:get(SIN.razon)};
  }).filter(r=>r.desc||r.fecha);
}
function _botEntregasEq(codN){
  const itemsMap=window._itemsPorEntrega||{};
  return ((window._entregasPorEquipo||{})[codN]||[]).map(e=>{
    const key=String(e.nro||'').split(/[-,]/)[0].trim();
    const items=(key&&itemsMap[key]&&itemsMap[key].length)
      ? itemsMap[key].map(it=>({cantidad:it.cantidad||'',descripcion:it.descripcion||'',proveedor:it.proveedor||''}))
      : (e.items&&e.items!=='—'?e.items:'');
    return {nro:e.nro,fecha:e.fecha,ym:_botYmDe(e.fecha),costo:Math.round(e.costo||0),razon:e.razon||'',tipo:e.tipo||'',equiposImputados:e.nEquipos||1,items};
  });
}

/* ───────────────────────── catálogo de herramientas ───────────────────────── */
const BOT_TOOLS = [
  {
    name:'listar_equipos',
    description:'Lista equipos de la flota con código, nombre, marca, modelo, estado, ubicación y operario. Filtro opcional por texto libre (código, nombre, marca, categoría, ubicación, operario, estado). Usar para encontrar el código de un equipo nombrado por descripción.',
    input_schema:{type:'object',properties:{filtro:{type:'string',description:'texto a buscar (opcional)'}},required:[],additionalProperties:false},
    run:({filtro})=>{
      const q=_botTexto(filtro);
      const lista=Object.keys(window._estadoEquipos||{}).map(_botEq).filter(Boolean)
        .filter(e=>!q||_botTexto([e.codigo,e.nombre,e.marca,e.modelo,e.clasificacion,e.categoria,e.estado,e.ubicacion,e.operario,e.patente].join(' ')).includes(q))
        .map(e=>({codigo:e.codigo,nombre:e.nombre,marca:e.marca,modelo:e.modelo,anio:e.anio,estado:e.estado,ubicacion:e.ubicacion,operario:e.operario}));
      return _botTruncar(lista,'equipos');
    },
  },
  {
    name:'ficha_equipo',
    description:'Ficha completa de un equipo: datos, estado, horómetro actual y próximo service, nivel de service (holgado/intermedio/crítico), VTV, trabajos pendientes abiertos, últimos trabajos, últimas entregas de repuestos, pedidos activos y resumen de combustible.',
    input_schema:{type:'object',properties:{codigo:{type:'string',description:'código del equipo'}},required:['codigo'],additionalProperties:false},
    run:({codigo})=>{
      const codN=_botResolverCod(codigo);
      const eq=_botEq(codN);
      if(!eq)return {error:`No existe el equipo "${codigo}" en la lista de equipos.`};
      const op=operatividadEquipo(codN);
      const h=(window._horometros||{})[codN]||{};
      const vtv=(window._vtvPorEquipo||{})[codN]||null;
      const pend=((window._trabajosPendientesPorEquipo||{})[codN]||[]).filter(t=>!t.resuelto).map(t=>({fecha:t.fecha,descripcion:t.descripcion,responsable:t.responsable}));
      const trab=_botTrabajosTodos().filter(r=>r.codN===codN).sort((a,b)=>toSortDate(b.fecha)-toSortDate(a.fecha)).slice(0,10).map(r=>({fecha:r.fecha,desc:r.desc,horas:r.horas,razon:r.razon}));
      const ent=_botEntregasEq(codN).sort((a,b)=>toSortDate(b.fecha)-toSortDate(a.fecha)).slice(0,10);
      const ped=(window._pedidosAll||[]).filter(p=>p.codigo===codN&&/pendiente|parcial|comprado/i.test(p.estado)).map(p=>({nro:p.nro,fecha:p.fecha,desc:p.desc,estado:p.estado}));
      const c=(window._combustiblePorEquipo||{})[codN]||null;
      const comb=c?{unidad:c.unidad,cargas:c.cargas.length,totalLitros:Math.round(c.totalLitros||0),consumoPromedio:c.promedio!=null?+(+c.promedio).toFixed(2):null,ultimaLectura:c.ultimaHr,ultimaFecha:c.ultimaFecha,costoTotal:c.totalCosto!=null?Math.round(c.totalCosto):null,costoEstimado:!!c.costoEstimado}:null;
      return {
        equipo:eq,
        service:{nivel:op.label,restantes:op.restantes,actual:op.hrActual,proximo:op.hrProximo,frecuencia:op.frecuencia||''},
        horometro:{actual:h.actual||null,proximo:h.proximo||null,mes:h.mes||''},
        vtv:vtv?{vencimiento:vtv.vencimiento,dias:vtv.dias}:null,
        pendientesAbiertos:pend,
        ultimosTrabajos:trab,
        ultimasEntregas:ent,
        pedidosActivos:ped,
        combustible:comb,
      };
    },
  },
  {
    name:'entregas_equipo',
    description:'Entregas de repuestos de un equipo con fecha, ítems, proveedor y costo. Rango opcional de meses AAAA-MM. Incluye el total del rango.',
    input_schema:{type:'object',properties:{codigo:{type:'string'},desde:{type:'string',description:'AAAA-MM inclusive (opcional)'},hasta:{type:'string',description:'AAAA-MM inclusive (opcional)'}},required:['codigo'],additionalProperties:false},
    run:({codigo,desde,hasta})=>{
      const codN=_botResolverCod(codigo);
      if(!_botEq(codN))return {error:`No existe el equipo "${codigo}".`};
      const ent=_botEntregasEq(codN).filter(e=>_botEnRango(e.ym,desde,hasta)).sort((a,b)=>toSortDate(b.fecha)-toSortDate(a.fecha));
      const total=ent.reduce((s,e)=>s+(e.costo||0),0);
      return Object.assign({codigo:codN,totalCosto:Math.round(total)},_botTruncar(ent,'entregas'));
    },
  },
  {
    name:'trabajos_equipo',
    description:'Trabajos realizados sobre un equipo (fecha, descripción, horas, razón, lugar). Rango opcional de meses AAAA-MM. Incluye total de horas.',
    input_schema:{type:'object',properties:{codigo:{type:'string'},desde:{type:'string'},hasta:{type:'string'}},required:['codigo'],additionalProperties:false},
    run:({codigo,desde,hasta})=>{
      const codN=_botResolverCod(codigo);
      if(!_botEq(codN))return {error:`No existe el equipo "${codigo}".`};
      const eq=_botEq(codN); const nombreN=normCod(eq.nombre);
      const rows=_botTrabajosTodos().filter(r=>r.codN===codN||(!r.codN&&nombreN&&normCod(r.equipo)===nombreN))
        .filter(r=>_botEnRango(_botYmDe(r.fecha),desde,hasta))
        .sort((a,b)=>toSortDate(b.fecha)-toSortDate(a.fecha))
        .map(r=>({fecha:r.fecha,desc:r.desc,horas:r.horas,razon:r.razon,lugar:r.lugar}));
      const horas=rows.reduce((s,r)=>s+(r.horas||0),0);
      return Object.assign({codigo:codN,totalHoras:horas},_botTruncar(rows,'trabajos'));
    },
  },
  {
    name:'buscar_trabajos',
    description:'Busca un texto libre en la descripción y razón de TODOS los trabajos realizados de la flota (ej. "embrague", "neumático", "alternador"). Devuelve equipo, fecha, descripción y horas.',
    input_schema:{type:'object',properties:{texto:{type:'string'},desde:{type:'string'},hasta:{type:'string'}},required:['texto'],additionalProperties:false},
    run:({texto,desde,hasta})=>{
      const q=_botTexto(texto);
      const rows=_botTrabajosTodos().filter(r=>_botTexto(r.desc+' '+r.razon).includes(q))
        .filter(r=>_botEnRango(_botYmDe(r.fecha),desde,hasta))
        .sort((a,b)=>toSortDate(b.fecha)-toSortDate(a.fecha))
        .map(r=>({codigo:r.codigo||r.equipo,fecha:r.fecha,desc:r.desc,horas:r.horas}));
      return _botTruncar(rows,'trabajos');
    },
  },
  {
    name:'buscar_repuestos',
    description:'Busca un texto libre en los ítems de TODAS las entregas de repuestos de la flota (ej. "filtro", "batería", "cubierta"). Devuelve equipo, N° de entrega, fecha, ítem, cantidad, proveedor y costo de la entrega.',
    input_schema:{type:'object',properties:{texto:{type:'string'},desde:{type:'string'},hasta:{type:'string'}},required:['texto'],additionalProperties:false},
    run:({texto,desde,hasta})=>{
      const q=_botTexto(texto); const out=[];
      for(const codN of Object.keys(window._entregasPorEquipo||{})){
        for(const e of _botEntregasEq(codN)){
          if(!_botEnRango(e.ym,desde,hasta))continue;
          if(Array.isArray(e.items)){
            for(const it of e.items)if(_botTexto(it.descripcion).includes(q))out.push({codigo:codN,nro:e.nro,fecha:e.fecha,item:it.descripcion,cantidad:it.cantidad,proveedor:it.proveedor,costoEntrega:e.costo});
          }else if(_botTexto(e.items).includes(q))out.push({codigo:codN,nro:e.nro,fecha:e.fecha,item:e.items,costoEntrega:e.costo});
        }
      }
      out.sort((a,b)=>toSortDate(b.fecha)-toSortDate(a.fecha));
      return _botTruncar(out,'ítems');
    },
  },
  {
    name:'costos_por_mes',
    description:'Agregados mensuales: costo de repuestos, horas de taller, combustible (litros y gasto) para toda la flota o para un equipo. Rango opcional AAAA-MM. Para flota entera incluye gasto de combustible livianos y pesados por mes.',
    input_schema:{type:'object',properties:{codigo:{type:'string',description:'opcional; vacío = flota entera'},desde:{type:'string'},hasta:{type:'string'}},required:[],additionalProperties:false},
    run:({codigo,desde,hasta})=>{
      const cpm=window._costosPorMes||{}, hpm=window._horasPorMesYEquipo||{};
      const yms=new Set([...Object.keys(cpm),...Object.keys(hpm),...Object.keys(window._gastoCombLivianosPorMes||{}),...Object.keys(window._gastoCombPesadosPorMes||{})]);
      const filas=[];
      if(codigo){
        const codN=_botResolverCod(codigo);
        if(!_botEq(codN))return {error:`No existe el equipo "${codigo}".`};
        const c=(window._combustiblePorEquipo||{})[codN];
        const litrosPorMes={}, gastoPorMes={};
        if(c)for(const k of c.cargas){const ym=_botYmDe(k.fecha);if(!ym)continue;litrosPorMes[ym]=(litrosPorMes[ym]||0)+(k.litros||0);gastoPorMes[ym]=(gastoPorMes[ym]||0)+(k.costo||0);}
        for(const ym of Object.keys(litrosPorMes))yms.add(ym);
        for(const ym of [...yms].sort()){
          if(!_botEnRango(ym,desde,hasta))continue;
          const rep=(cpm[ym]||{})[codN]||0, hs=(hpm[ym]||{})[codN]||0;
          if(!rep&&!hs&&!litrosPorMes[ym])continue;
          filas.push({mes:ym,repuestos:Math.round(rep),horasTaller:Math.round(hs),litros:Math.round(litrosPorMes[ym]||0),gastoCombustible:Math.round(gastoPorMes[ym]||0)});
        }
        return {codigo:codN,filas,totales:{repuestos:filas.reduce((s,f)=>s+f.repuestos,0),horasTaller:filas.reduce((s,f)=>s+f.horasTaller,0),litros:filas.reduce((s,f)=>s+f.litros,0),gastoCombustible:filas.reduce((s,f)=>s+f.gastoCombustible,0)}};
      }
      for(const ym of [...yms].sort()){
        if(!_botEnRango(ym,desde,hasta))continue;
        const rep=Object.values(cpm[ym]||{}).reduce((s,v)=>s+(v||0),0);
        const hs=Object.values(hpm[ym]||{}).reduce((s,v)=>s+(v||0),0);
        const liv=(window._gastoCombLivianosPorMes||{})[ym]||0, pes=(window._gastoCombPesadosPorMes||{})[ym]||0;
        if(!rep&&!hs&&!liv&&!pes)continue;
        filas.push({mes:ym,repuestos:Math.round(rep),horasTaller:Math.round(hs),combustibleLivianos:Math.round(liv),combustiblePesadosEstimado:Math.round(pes)});
      }
      return {flota:true,filas,totales:{repuestos:filas.reduce((s,f)=>s+f.repuestos,0),horasTaller:filas.reduce((s,f)=>s+f.horasTaller,0),combustibleLivianos:filas.reduce((s,f)=>s+f.combustibleLivianos,0),combustiblePesadosEstimado:filas.reduce((s,f)=>s+f.combustiblePesadosEstimado,0)}};
    },
  },
  {
    name:'ranking',
    description:'Top de equipos por una métrica en un rango de meses: "repuestos" (costo), "horas_taller", "combustible_litros", "combustible_gasto", "cantidad_trabajos", "cantidad_entregas". Devuelve hasta `top` equipos (default 10).',
    input_schema:{type:'object',properties:{metrica:{type:'string',enum:['repuestos','horas_taller','combustible_litros','combustible_gasto','cantidad_trabajos','cantidad_entregas']},desde:{type:'string'},hasta:{type:'string'},top:{type:'integer'}},required:['metrica'],additionalProperties:false},
    run:({metrica,desde,hasta,top})=>{
      const acc={};
      const add=(codN,v)=>{if(codN&&v)acc[codN]=(acc[codN]||0)+v;};
      if(metrica==='repuestos'){for(const [ym,m] of Object.entries(window._costosPorMes||{}))if(_botEnRango(ym,desde,hasta))for(const [c,v] of Object.entries(m))add(c,v);}
      else if(metrica==='horas_taller'){for(const [ym,m] of Object.entries(window._horasPorMesYEquipo||{}))if(_botEnRango(ym,desde,hasta))for(const [c,v] of Object.entries(m))add(c,v);}
      else if(metrica==='combustible_litros'||metrica==='combustible_gasto'){for(const [c,e] of Object.entries(window._combustiblePorEquipo||{}))for(const k of e.cargas||[])if(_botEnRango(_botYmDe(k.fecha),desde,hasta))add(c,metrica==='combustible_litros'?(k.litros||0):(k.costo||0));}
      else if(metrica==='cantidad_trabajos'){for(const r of _botTrabajosTodos())if(_botEnRango(_botYmDe(r.fecha),desde,hasta))add(r.codN,1);}
      else if(metrica==='cantidad_entregas'){for(const c of Object.keys(window._entregasPorEquipo||{}))for(const e of _botEntregasEq(c))if(_botEnRango(e.ym,desde,hasta))add(c,1);}
      const n=Math.max(1,Math.min(+top||10,BOT_MAX_FILAS));
      const filas=Object.entries(acc).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([c,v],i)=>{const eq=_botEq(c);return {puesto:i+1,codigo:eq?eq.codigo:c,nombre:eq?eq.nombre:'',valor:Math.round(v)};});
      return {metrica,desde:desde||null,hasta:hasta||null,filas};
    },
  },
  {
    name:'service_criticos',
    description:'Equipos con service vencido o crítico según el resumen de service, ordenados del más atrasado al menos. Incluye hr/km restantes (negativo = vencido), actual y próximo.',
    input_schema:{type:'object',properties:{},required:[],additionalProperties:false},
    run:()=>({filas:(window._serviceCriticosList||[]).map(s=>({codigo:s.codigo||s.codN,nombre:s.nombre||'',restantes:s.restantes,actual:s.hrActual,proximo:s.hrProximo,frecuencia:s.frecuencia||''}))}),
  },
  {
    name:'vtv_criticos',
    description:'Vehículos con VTV vencida o por vencer en 14 días o menos (días negativos = vencida).',
    input_schema:{type:'object',properties:{},required:[],additionalProperties:false},
    run:()=>({filas:(window._vtvCriticosList||[]).map(v=>({codigo:v.codigo,nombre:v.nombre||'',patente:v.patente||'',vencimiento:v.vencimiento,dias:v.dias}))}),
  },
  {
    name:'pendientes',
    description:'Trabajos pendientes de taller de toda la flota (abiertos por defecto). Con incluir_resueltos=true devuelve también los resueltos con su fecha y descripción de resolución.',
    input_schema:{type:'object',properties:{incluir_resueltos:{type:'boolean'}},required:[],additionalProperties:false},
    run:({incluir_resueltos})=>_botTruncar((window._trabajosPendientes||[]).filter(t=>incluir_resueltos||!t.resuelto).map(t=>({codigo:t.codigo,equipo:t.equipo,fecha:t.fecha,descripcion:t.descripcion,responsable:t.responsable,estado:t.estado,fechaResolucion:t.fechaResolucion||'',resolucion:t.descripcionResolucion||''})),'pendientes'),
  },
  {
    name:'pedidos',
    description:'Pedidos de compra de repuestos: N°, fecha, equipo, descripción, estado (pendiente/parcial/comprado/entregado), N° de orden y N° de entrega vinculada. Filtros opcionales por estado y equipo.',
    input_schema:{type:'object',properties:{estado:{type:'string',description:'texto a matchear en el estado, ej. "pendiente" (opcional)'},codigo:{type:'string'}},required:[],additionalProperties:false},
    run:({estado,codigo})=>{
      const codN=codigo?_botResolverCod(codigo):null; const q=_botTexto(estado);
      const rows=(window._pedidosAll||[]).filter(p=>(!codN||p.codigo===codN)&&(!q||_botTexto(p.estado).includes(q)))
        .map(p=>({nro:p.nro,fecha:p.fecha,codigo:p.codigoRaw,equipo:p.equipo,desc:p.desc,estado:p.estado,orden:p.orden,nroEntrega:p.nroEntrega}));
      return _botTruncar(rows,'pedidos');
    },
  },
];

function _botToolsParaApi(){
  return BOT_TOOLS.map(t=>({name:t.name,description:t.description,input_schema:t.input_schema}));
}
function _botEjecutarTool(name,input){
  const t=BOT_TOOLS.find(x=>x.name===name);
  if(!t)return {error:`herramienta desconocida: ${name}`};
  try{ return t.run(input||{}); }
  catch(err){ return {error:'falló la herramienta: '+(err?.message||String(err))}; }
}

/* ───────────────────────── red ───────────────────────── */
async function _botLlamar(nueva){
  const resp=await fetch(REFRESH_URL,{
    method:'POST', redirect:'follow',
    headers:{'Content-Type':'text/plain;charset=utf-8'},   // simple request: sin preflight CORS
    body:JSON.stringify({ep:'bot',nueva,tools:_botToolsParaApi(),messages:_botMessages}),
  });
  if(!resp.ok)throw new Error('HTTP '+resp.status);
  const data=await resp.json();
  if(data.usadas!=null){_botCupo={usadas:data.usadas,cupo:data.cupo};_botRenderCupo();}
  if(!data.ok){
    if(data.error==='cupo_agotado')throw new Error(`Se agotó el cupo de ${data.cupo} preguntas de hoy. Mañana se renueva.`);
    if(data.error==='fusible_agotado')throw new Error('Se agotó el fusible diario de llamadas. Mañana se renueva.');
    if(data.error==='api_key_no_configurada')throw new Error('Falta configurar la API key en el Apps Script (ANTHROPIC_API_KEY).');
    throw new Error(data.error||'error desconocido');
  }
  return data;
}

async function _botPreguntar(texto){
  if(_botOcupado)return;
  if(!window._equiposOrdenados||!window._estadoEquipos){
    _botAgregarBurbuja('bot','Todavía se están cargando los datos del panel. Esperá a que termine y volvé a preguntar.');
    return;
  }
  if(_botTurnos>=BOT_MAX_TURNOS){
    _botNuevaConversacion();
    _botAgregarBurbuja('sys','Conversación reiniciada (se alcanzó el largo máximo). Tu pregunta se envía en una conversación nueva.');
  }
  _botOcupado=true; _botTurnos++;
  _botAgregarBurbuja('user',texto);
  _botMessages.push({role:'user',content:[{type:'text',text:texto}]});
  const pensando=_botAgregarBurbuja('bot','',true);
  _botSetEstado('AlberBot está pensando…');
  try{
    let nueva=true;
    for(let ronda=0;ronda<=BOT_MAX_TOOL_ROUNDS;ronda++){
      const data=await _botLlamar(nueva); nueva=false;
      // Historial VERBATIM: thinking + text + tool_use, tal cual vinieron.
      _botMessages.push({role:'assistant',content:data.content});
      const toolUses=(data.content||[]).filter(b=>b.type==='tool_use');
      if(data.stop_reason==='tool_use'&&toolUses.length){
        _botSetEstado('AlberBot está consultando el panel… ('+toolUses.map(t=>t.name).join(', ')+')');
        const results=toolUses.map(tu=>{
          const out=_botEjecutarTool(tu.name,tu.input);
          return {type:'tool_result',tool_use_id:tu.id,content:JSON.stringify(out),is_error:!!(out&&out.error)};
        });
        _botMessages.push({role:'user',content:results});
        continue;
      }
      const texto=(data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n').trim();
      if(data.stop_reason==='refusal'){
        _botReemplazarBurbuja(pensando,'No puedo responder esa consulta.'+(data.stop_details?.explanation?' '+data.stop_details.explanation:''));
      }else if(data.stop_reason==='max_tokens'){
        _botReemplazarBurbuja(pensando,(texto||'')+'\n\n_(respuesta cortada por largo)_');
      }else{
        _botReemplazarBurbuja(pensando,texto||'(sin respuesta)');
      }
      _botSetEstado('');
      _botOcupado=false;
      return;
    }
    _botReemplazarBurbuja(pensando,'Me quedé sin rondas de consulta para esta pregunta. Probá acotarla (un equipo, un rango de meses).');
  }catch(err){
    console.error('[AlberBot]',err);
    // Si falló a mitad de ronda, el último user turn puede haber quedado sin
    // respuesta: lo sacamos para que el historial siga válido.
    if(_botMessages.length&&_botMessages[_botMessages.length-1].role==='user')_botMessages.pop();
    _botReemplazarBurbuja(pensando,'⚠ '+(err?.message||String(err)));
  }
  _botSetEstado('');
  _botOcupado=false;
}

/* ───────────────────────── UI ───────────────────────── */
function _botRenderMd(md){
  // Markdown mínimo → RawHTML seguro: escapa todo primero, después marca.
  const inline=s=>esc(s)
    .replace(/\*\*(.+?)\*\*/g,'<b>$1</b>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/_([^_\n]+)_/g,'<i>$1</i>');
  const lines=String(md||'').replace(/\r/g,'').split('\n');
  let out='',i=0;
  while(i<lines.length){
    const l=lines[i];
    if(/^\s*\|/.test(l)){
      const rows=[]; while(i<lines.length&&/^\s*\|/.test(lines[i])){rows.push(lines[i]);i++;}
      const cells=r=>r.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
      const body=rows.filter(r=>!/^\s*\|?\s*:?-{2,}/.test(r));
      if(body.length){
        out+='<table class="bot-table"><thead><tr>'+cells(body[0]).map(c=>'<th>'+inline(c)+'</th>').join('')+'</tr></thead><tbody>';
        for(const r of body.slice(1))out+='<tr>'+cells(r).map(c=>'<td>'+inline(c)+'</td>').join('')+'</tr>';
        out+='</tbody></table>';
      }
      continue;
    }
    if(/^\s*([-*•]|\d+[.)])\s+/.test(l)){
      out+='<ul>'; while(i<lines.length&&/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])){out+='<li>'+inline(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/,''))+'</li>';i++;}
      out+='</ul>'; continue;
    }
    if(/^\s*#{1,6}\s+/.test(l)){out+='<p><b>'+inline(l.replace(/^\s*#{1,6}\s+/,''))+'</b></p>';i++;continue;}
    if(l.trim()===''){i++;continue;}
    let p=inline(l); i++;
    while(i<lines.length&&lines[i].trim()!==''&&!/^\s*(\||[-*•]|\d+[.)]\s|#)/.test(lines[i])){p+='<br>'+inline(lines[i]);i++;}
    out+='<p>'+p+'</p>';
  }
  return new RawHTML(out);
}
function _botAgregarBurbuja(rol,texto,pensando){
  const log=document.getElementById('botLog'); if(!log)return null;
  const div=document.createElement('div');
  div.className='bot-msg bot-'+rol+(pensando?' bot-pensando':'');
  if(rol==='bot'&&!pensando)setHTML(div,_botRenderMd(texto));
  else if(pensando)setHTML(div,html`<span class="bot-dots"><i></i><i></i><i></i></span>`);
  else div.textContent=texto;
  log.appendChild(div); log.scrollTop=log.scrollHeight;
  return div;
}
function _botReemplazarBurbuja(div,texto){
  if(!div)return;
  div.classList.remove('bot-pensando');
  setHTML(div,_botRenderMd(texto));
  const log=document.getElementById('botLog'); if(log)log.scrollTop=log.scrollHeight;
}
function _botSetEstado(t){ const el=document.getElementById('botEstado'); if(el)el.textContent=t; }
function _botRenderCupo(){
  const el=document.getElementById('botCupo'); if(!el)return;
  if(_botCupo.usadas==null||_botCupo.cupo==null){el.textContent='';return;}
  el.textContent=`quedan ${Math.max(0,_botCupo.cupo-_botCupo.usadas)} de ${_botCupo.cupo} preguntas hoy`;
}
function _botNuevaConversacion(){
  _botMessages=[]; _botTurnos=0;
  const log=document.getElementById('botLog'); if(log)log.textContent='';
  _botAgregarBurbuja('bot','Hola. Preguntame lo que necesites sobre la flota: un equipo, costos de un período, qué se cambió de un repuesto, service vencidos, pendientes.');
}
async function _botCargarCupo(){
  try{
    const r=await fetch(REFRESH_URL+'?ep=bot_estado',{cache:'no-store'});
    const d=await r.json();
    if(d&&d.ok){_botCupo={usadas:d.usadas,cupo:d.cupo};_botRenderCupo();}
  }catch(_){}
}
function botToggle(){
  _botAbierto=!_botAbierto;
  const panel=document.getElementById('botPanel'); const fab=document.getElementById('botFab');
  if(panel)panel.classList.toggle('open',_botAbierto);
  if(fab)fab.classList.toggle('open',_botAbierto);
  if(_botAbierto){
    if(!_botMessages.length&&!document.getElementById('botLog')?.children.length)_botNuevaConversacion();
    if(_botCupo.usadas==null)_botCargarCupo();
    setTimeout(()=>document.getElementById('botInput')?.focus(),50);
  }
}
function botEnviar(){
  const inp=document.getElementById('botInput'); if(!inp)return;
  const t=inp.value.trim(); if(!t||_botOcupado)return;
  inp.value=''; inp.style.height='';
  _botPreguntar(t);
}
function botReiniciar(){ if(_botOcupado)return; _botNuevaConversacion(); }

ACTIONS.botToggle    = () => botToggle();
ACTIONS.botEnviar    = () => botEnviar();
ACTIONS.botReiniciar = () => botReiniciar();

document.addEventListener('keydown',e=>{
  if(e.target&&e.target.id==='botInput'&&e.key==='Enter'&&!e.shiftKey){e.preventDefault();botEnviar();}
  if(e.key==='Escape'&&_botAbierto)botToggle();
});
document.addEventListener('input',e=>{
  if(e.target&&e.target.id==='botInput'){e.target.style.height='';e.target.style.height=Math.min(e.target.scrollHeight,120)+'px';}
});
