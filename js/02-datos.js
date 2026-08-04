/* ══════════════════════════════════════════════════════════════════
   02-datos.js — parte 2/8 de la app del panel INGECO.
   Los 8 archivos son SCRIPTS CLÁSICOS que comparten el mismo scope
   global y se cargan EN ORDEN (defer) desde index.html: mover uno de
   lugar rompe las dependencias. No convertir a type=module sin
   revisar ACTIONS y el bootstrap del PIN.
══════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════ */
// Normaliza CÓDIGO: quita tildes, mayúsculas, trim
// normCod: quita tildes, espacios, guiones, cualquier caracter no alfanumérico.
// "RN - 03" = "RN-03" = "RN 03" = "RN03" → todos dan "RN03"
const normCod = s => String(s||'')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Za-z0-9]/g, '')
  .toUpperCase();

// Normaliza PATENTE/dominio para matchear sin importar espacios ni guiones:
// "AB 262 XX", "AB-262-XX", "ab262xx" \u2192 todos "AB262XX".
const normPat = s => String(s||'')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Za-z0-9]/g, '')
  .toUpperCase();

// Normaliza HEADERS de columna: tildes fuera, espacios y guiones-bajo colapsados a un solo
// espacio, mayúsculas, trim. Para matchear nombres de columna sin importar si vienen
// 'EST_FECHA', 'Est Fecha' o 'est  fecha'.
const normHead = s => String(s||'')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[_\s]+/g, ' ')
  .toUpperCase()
  .trim();

function parseMoney(s){
  if(!s||s==='-')return 0;
  let c=String(s).replace(/[^0-9.,]/g,'');
  if(!c)return 0;
  // Formato argentino con decimales: 1.234,56 → 1234.56
  if(c.includes(',')){
    c=c.replace(/\./g,'').replace(',','.');
  }
  // Formato argentino con separador de miles (sin decimales): 158.000 o 1.234.567 → 158000 / 1234567
  else if(/^\d{1,3}(\.\d{3})+$/.test(c)){
    c=c.replace(/\./g,'');
  }
  // Else: número entero (158) o decimal estilo US (158.50) → parseFloat directo
  return parseFloat(c)||0;
}
function formatMoney(n){
  if(n>=1e6)return'$'+(n/1e6).toFixed(1)+'M';
  if(n>=1e3)return'$'+(n/1e3).toFixed(0)+'K';
  return'$'+Math.round(n);
}

// Separadores de miles estilo es-AR (punto). Para enteros >=1000.
// Números chicos quedan sin formato. Decimales no se tocan: pasar entero.
function fmtInt(n){
  const v=Math.round(Number(n)||0);
  return v.toLocaleString('es-AR');
}

// Etiqueta corta de un ym "2026-05" → "May 2026".
function ymLabel(ym){
  const M=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const p=String(ym||'').split('-');
  if(p.length<2)return String(ym||'');
  return (M[+p[1]-1]||'?')+' '+p[0];
}

// Hora corta 24h consistente (es-AR a veces devuelve 12h con "p. m." que rompe layout).
function fmtHora(d){
  return (d||new Date()).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',hour12:false});
}

// Arma "Tipo Marca Modelo" — ej. "Camioneta Ford Ranger", "Rodillo liso Volvo SD105".
// Cada parte se suma si no está vacía. Si no hay nada, devuelve fallback.
// Evita duplicados case-insensitive (si el modelo ya contiene la marca, etc.).
function buildEquipoNombre(clasif,marca,modelo,fallback){
  const norm=s=>String(s||'').trim().toLowerCase();
  const partes=[];
  const vista=new Set();
  for(const raw of [clasif,marca,modelo]){
    const v=String(raw||'').trim();
    if(!v)continue;
    const k=norm(v);
    // Saltar si esta parte ya está contenida en alguna anterior (ej. modelo "Ford Ranger" cuando marca ya es "Ford")
    let dup=false;
    for(const prev of vista){if(prev.includes(k)||k.includes(prev)){dup=true;break;}}
    if(dup)continue;
    partes.push(v);
    vista.add(k);
  }
  return partes.length?partes.join(' '):(fallback||'');
}

const HOY=(()=>{const d=new Date();d.setHours(23,59,59,999);return d;})();

// Helper interno: parsea UNA fecha simple (sin rangos). Devuelve Date o null.
function _parseDateSingle(str){
  if(!str)return null;
  const mg=str.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})\)$/);
  if(mg){const d=new Date(+mg[1],+mg[2],+mg[3]);return isNaN(d)?null:d;}
  const mi=str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(mi){const d=new Date(+mi[1],+mi[2]-1,+mi[3]);return isNaN(d)?null:d;}
  // dd/mm/yyyy o mm/dd/yyyy (con separador / o -). Heurística: si segundo número > 12,
  // entonces el primero es día. Si el primero > 12, el primero es día. Si ambos ≤ 12,
  // se asume dd/mm (formato argentino). Sirve para los forms de Google ("05-15-2026" →
  // mes 5 día 15 detectado vía swap, ya que el "15" se descubre > 12).
  const m4=str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if(m4){let[,a,b,y]=m4.map(Number);if(b>12&&a<=12)[a,b]=[b,a];if(b>=1&&b<=12&&a>=1&&a<=31)return new Date(y,b-1,a);}
  const m2=str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if(m2){let[,a,b,y]=m2.map(Number);if(b>12&&a<=12)[a,b]=[b,a];if(b>=1&&b<=12&&a>=1&&a<=31)return new Date(2000+y,b-1,a);}
  return null;
}

// Detecta rangos del tipo "3/12/2024 - 31/12/2024" con separadores -, –, —, "a".
function _parseDateRange(s){
  if(!s)return null;
  const str=String(s).trim();
  const m=str.match(/^(.+?)\s*(?:[-–—]|\ba\b)\s*(.+)$/);
  if(!m)return null;
  const d1=_parseDateSingle(m[1].trim());
  const d2=_parseDateSingle(m[2].trim());
  if(d1&&d2)return[d1,d2];
  return null;
}

// _parseDate: si es rango devuelve la fecha FIN (relevante para agrupar por mes);
// si es fecha simple, devuelve esa.
function _parseDate(s){
  if(!s)return null;
  const str=String(s).trim();
  if(!str||str==='—'||str==='-')return null;
  const single=_parseDateSingle(str);
  if(single)return single;
  const range=_parseDateRange(str);
  if(range)return range[1];
  return null;
}
function toSortDate(s){return _parseDate(s)||new Date(0);}
function formatFechaCorta(s){
  if(!s||['—','-'].includes(String(s).trim()))return'—';
  const str=String(s).trim();
  const range=_parseDateRange(str);
  if(range){
    const fmt=d=>`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`;
    return`${fmt(range[0])} – ${fmt(range[1])}`;
  }
  const d=_parseDateSingle(str);
  if(!d)return str;
  return`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`;
}

// ESTADO_COLOR: clasifica el texto de estado del equipo en red/amber/green/gray
// Acepta variaciones de escritura del personal de campo
const ESTADO_COLOR=st=>{
  // Vacío o placeholder ("-", "—", "s/d", "n/a") → sin estado (gris)
  if(!st||!st.trim()||['-','—','s/d','n/a'].includes(st.trim().toLowerCase()))return'gray';
  const l=st.toLowerCase();
  // Reparación / taller (ámbar)
  if(l.includes('reparaci')||l.includes('taller')||l.includes('en servicio de')||l.includes('service'))return'amber';
  // No operativo / fuera de servicio / parado / en desuso (rojo = inactivo)
  if(l.includes('no oper')||l.includes('inoper')||l.includes('fuera de')||
     l.includes('parad')||l.includes('baja')||l.includes('detenid')||
     l.includes('inutiliz')||l.includes('desuso'))return'red';
  // Cualquier texto que tenga contenido = operativo por defecto (verde)
  return'green';
};

// Inactivo = equipo en desuso, no operativo (estado rojo) o sin estado cargado
// (estado gris). Estos no van a la grilla principal sino a la sección
// "equipos inactivos".
function esEquipoInactivo(codigo){
  const info=(window._estadoEquipos||{})[normCod(codigo)];
  if(!info)return false;
  const c=ESTADO_COLOR(info.estado);
  return c==='red'||c==='gray';
}
// Subtipo de inactivo: 'desuso' | 'no-operativo' | 'sin-estado'.
function subtipoInactivo(estado){
  if(ESTADO_COLOR(estado)==='gray')return'sin-estado';
  const l=String(estado||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  return l.includes('desuso')?'desuso':'no-operativo';
}
const ESTADO_CSS={green:'var(--green)',amber:'var(--amber)',red:'var(--red)',gray:'var(--text3)'};

// Tipo de equipo por prefijo de código → etiqueta corta (spec verificada INGECO)
const TIPO_EQUIPO=cod=>{
  const p=(cod||'').split('-')[0].toUpperCase();
  const tipos={
    AUT:'Autoelevador',
    BAT:'Batea',
    BRD:'Barredora',
    CF :'Cargador frontal',
    CMN:'Camión',
    CMP:'Compresor',
    CMT:'Camioneta',
    CRT:'Carretón',
    EXC:'Retroexcavadora',
    GEN:'Generador',
    MNV:'Motoniveladora',
    PLN:'Planta de asfalto',
    RDL:'Rodillo doble liso',
    RL :'Rodillo liso',
    RN :'Rodillo neumático',
    RTP:'Retropala',
    TPD:'Topadora',
    TRM:'Terminadora de asfalto',
    TRT:'Trituradora',
    ZRN:'Zaranda',
  };
  return tipos[p]||null;
};

/* ═══════════════════════════════════════════════════════
   PARSERS
═══════════════════════════════════════════════════════ */
function parseCodigos(rows,categoria){
  const result={};
  const hIdx=rows.findIndex(r=>r.some(c=>normCod(c)==='CODIGO'));
  if(hIdx<0)return result;

  // Leer fecha de actualización del encabezado de la tab (aplica a todos los equipos)
  // La fecha está en alguna celda de las primeras filas antes de los headers
  let sheetFecha=null;
  for(let i=0;i<hIdx&&i<8;i++){
    for(const cell of rows[i]){
      const s=String(cell||'').trim();
      if(!s)continue;
      const d=_parseDate(s);
      if(d&&d<=HOY&&d.getFullYear()>=2020){sheetFecha=formatFechaCorta(s);break;}
    }
    if(sheetFecha)break;
  }

  const hdr=rows[hIdx].map(c=>normCod(c));
  const iCod=hdr.findIndex(h=>h==='CODIGO');
  const iEqu=hdr.findIndex(h=>h==='EQUIPO'||h.includes('NOMBRE')||h.includes('DESCRIPCION'));
  const iEst=hdr.findIndex(h=>h==='ESTADO');
  const iUbi=hdr.findIndex(h=>h.includes('LUGAR'));
  const iOpe=hdr.findIndex(h=>h.includes('OPERARIO')||h.includes('RESPONSABLE'));
  const iFec=hdr.findIndex(h=>h.includes('FECHA')||h.includes('ACTUALIZACION'));
  const iPat=hdr.findIndex(h=>h.includes('PATENTE')||h.includes('DOMINIO'));
  const iMar=hdr.findIndex(h=>h==='MARCA');
  const iMod=hdr.findIndex(h=>h==='MODELO');
  const iCla=hdr.findIndex(h=>h.includes('CLASIF')||h.includes('TIPO')||h.includes('CATEGORIA'));
  // Columna OBSERVACIÓN: indica propiedad del equipo. Valores observados en la hoja:
  //   "Propio" (mayoría), "Alquiler"/"Alquilado", "Externo" (transporte pesado tercerizado),
  //   "-" o vacío (sin datos). También se acepta "TENENCIA" o "PROPIEDAD" como nombre alternativo.
  const iObs=hdr.findIndex(h=>h.includes('OBSERV')||h==='TENENCIA'||h==='PROPIEDAD');
  for(let i=hIdx+1;i<rows.length;i++){
    const r=rows[i];const cod=normCod(r[iCod]);
    if(!cod||cod==='CODIGO')continue;
    // Datos de la fila
    const equipo      =iEqu>=0?String(r[iEqu]||'').trim():'';
    const estado      =iEst>=0?String(r[iEst]||'').trim():'';
    const ubicacion   =iUbi>=0?String(r[iUbi]||'').trim():'';
    const operario    =iOpe>=0?String(r[iOpe]||'').trim():'';
    const patente     =iPat>=0?String(r[iPat]||'').trim():'';
    const marca       =iMar>=0?String(r[iMar]||'').trim():'';
    const modelo      =iMod>=0?String(r[iMod]||'').trim():'';
    const clasificacion=iCla>=0?String(r[iCla]||'').trim():'';
    const observacion =iObs>=0?String(r[iObs]||'').trim():'';
    // Filtrar filas-ruido: código presente pero sin ningún dato real
    if(!equipo&&!estado&&!ubicacion&&!operario&&!patente&&!marca&&!modelo)continue;
    const fechaCelda=iFec>=0?formatFechaCorta(String(r[iFec]||'').trim()):null;
    // Normalizar tenencia: 'propio' | 'alquilado' | 'desconocido'
    // PROP* → propio · ALQUIL*/EXTERN*/RENT*/LEASING → alquilado · resto/vacío/"-" → desconocido
    const obsN=observacion.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
    let tenencia='desconocido';
    if(obsN.startsWith('prop'))tenencia='propio';
    else if(obsN.includes('alquil')||obsN.startsWith('extern')||obsN.includes('rent')||obsN.includes('leasing'))tenencia='alquilado';
    result[cod]={
      rawCod:String(r[iCod]||'').trim(),
      equipo:equipo||null,
      estado,
      ubicacion,
      operario,
      fecha:fechaCelda||sheetFecha,
      patente,
      marca,
      modelo,
      clasificacion,
      categoria:categoria||'',
      observacion,
      tenencia,
    };
  }
  return result;
}

/* ═══════════════════════════════════════════════════════
   PANEL_REPUESTOS — Procesamiento consolidado
   Toma las filas del panel maestro (output del Apps Script
   "actualizarPanelRepuestos") y produce todos los derivados
   que antes se calculaban combinando MESES_ENTREGAS + PANEL.
═══════════════════════════════════════════════════════ */
const MES_NOMBRE_TO_NUM = {
  ENERO:1,FEBRERO:2,MARZO:3,ABRIL:4,MAYO:5,JUNIO:6,
  JULIO:7,AGOSTO:8,SEPTIEMBRE:9,OCTUBRE:10,NOVIEMBRE:11,DICIEMBRE:12,
};
const MES_NOMBRE_TO_LABEL = {
  ENERO:'Ene',FEBRERO:'Feb',MARZO:'Mar',ABRIL:'Abr',MAYO:'May',JUNIO:'Jun',
  JULIO:'Jul',AGOSTO:'Ago',SEPTIEMBRE:'Sep',OCTUBRE:'Oct',NOVIEMBRE:'Nov',DICIEMBRE:'Dic',
};

function mesAnioToYm(mes,anio){
  const m=MES_NOMBRE_TO_NUM[String(mes||'').toUpperCase().trim()];
  const y=String(anio||'').trim();
  if(!m||!/^\d{4}$/.test(y))return null;
  return `${y}-${String(m).padStart(2,'0')}`;
}
function mesAnioToLabel(mes,anio){
  const ab=MES_NOMBRE_TO_LABEL[String(mes||'').toUpperCase().trim()];
  const y=String(anio||'').trim();
  if(!ab||!/^\d{4}$/.test(y))return '';
  return `${ab} ${y}`;
}

// Parsea el campo ITEMS DETALLE (string concatenado) de vuelta a array de items.
// Formato producido por el Apps Script:
//   "3x Filtro de aceite (cód ABC, prov XYZ, obs: ...) | 2x Aceite 15W40"
function parseItemsDetalle(str){
  const s=String(str||'').trim();
  if(!s||s==='—'||s==='-')return [];
  return s.split(' | ').map(chunk=>{
    const trozo=chunk.trim();
    if(!trozo)return null;
    const item={};
    // Detectar paréntesis con extras
    const mParen=trozo.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    const main=mParen?mParen[1].trim():trozo;
    const extras=mParen?mParen[2]:'';
    // Cantidad: "<N>x descripcion"  o  "<N unidad>x descripcion"
    // Ej: "1x Filtro", "20 litrosx Aceite", "0,4 metrosx Goma", "-x Service"
    const mCant=main.match(/^(\S+(?:\s+\S+)?)x\s+(.+)$/);
    if(mCant){item.cantidad=mCant[1];item.descripcion=mCant[2].trim();}
    else{item.descripcion=main;}
    // Extras separados por coma
    if(extras){
      extras.split(',').forEach(e=>{
        const t=e.trim();
        if(/^c[óo]d\s+/i.test(t))item.codigo=t.replace(/^c[óo]d\s+/i,'').trim();
        else if(/^prov\s+/i.test(t))item.proveedor=t.replace(/^prov\s+/i,'').trim();
        else if(/^obs:/i.test(t))item.observacion=t.replace(/^obs:/i,'').trim();
      });
    }
    return item;
  }).filter(Boolean);
}

// Lookup tolerante de columna (acentos/espacios/símbolos)
function _pickCol(obj,candidatos){
  // normCod ya hace exactamente lo que necesitamos: tildes fuera, solo alfanum, may\u00fasculas.
  // "N\u00b0 ENTREGA", "n entrega", "NENTREGA" \u2192 todos "NENTREGA".
  const cand=candidatos.map(normCod);
  for(const k of Object.keys(obj)){
    if(cand.includes(normCod(k)))return obj[k];
  }
  return '';
}

// Procesa las filas (formato fetchGvizObj) del PANEL_REPUESTOS consolidado.
// Devuelve todo el contexto derivado: costos, items, entregas por equipo, etc.
function procesarPanelRepuestos(panelObj){
  const ctx={
    entregaCostos:{},      // { nro: {costo, mes} }
    itemsPorEntrega:{},    // { nro: [items...] }
    costosPorMes:{},       // { ym: { codN: costo } }
    costosCorrPorMes:{},   // { ym: { codN: costo } } — solo entregas correctivas (tab costos downtime)
    entregasCorrPorEquipo:{}, // { codN: [{nro,fecha,ym,items,costo}] } — line items del tab costos (desglose "de dónde sale")
    entregasPorEquipo:{},  // { codN: [{nro,fecha,items,costo}] }
    repuestosHistorial:{}, // { codN: { ym: costoTotal } }
    entregasMesActual:[],  // entregas del mes actual: {nro,fecha,equipo,codigo,costo,costoNum,razon,responsable,nroPedido,items}
    entregasPorPedido:{},  // { nroPedido: [nroEntrega...] } — vínculo entrega→pedido (N° PEDIDO de REP_LIVE)
  };
  if(!panelObj||!panelObj.length)return ctx;

  const MES_ACTUAL_YM=MES_ACTUAL?MES_ACTUAL.ym:null;
  const _mesActualVistos={};   // dedupe de entregas multi-equipo en el dashboard

  for(const r of panelObj){
    const mes=_pickCol(r,['MES']);
    const anio=_pickCol(r,['AÑO ARCHIVO','ANO ARCHIVO','ANIO ARCHIVO','AÑO','ANO','ANIO']);
    const nro=String(_pickCol(r,['N° ENTREGA','N ENTREGA','NRO ENTREGA','NUMERO ENTREGA'])||'').trim();
    const nroPedido=String(_pickCol(r,['N° PEDIDO ENTREGADO','N PEDIDO ENTREGADO','N° PEDIDO','NRO PEDIDO'])||'').trim();
    const fechaRaw=_pickCol(r,['FECHA']);
    const fecha=String(fechaRaw||'').trim();
    const equipo=String(_pickCol(r,['EQUIPO'])||'').trim();
    const codigoRaw=String(_pickCol(r,['CÓDIGO','CODIGO'])||'').trim();
    const codN=normCod(codigoRaw);
    const costoStr=String(_pickCol(r,['COSTO ENTREGA','COSTO'])||'').trim();
    const costo=parseMoney(costoStr);
    // Una entrega puede estar imputada a varios equipos: el builder emite una
    // fila por equipo con el COSTO completo y publica cuántos la comparten.
    // El costo de la entrega sigue siendo el total; lo que se reparte en partes
    // iguales es lo que se ATRIBUYE a cada equipo.
    const nEquipos=Math.max(1,parseInt(_pickCol(r,['EQUIPOS IMPUTADOS'])||'1',10)||1);
    const costoEq=costo/nEquipos;
    const razon=String(_pickCol(r,['RAZÓN ENTREGA','RAZON ENTREGA','RAZON','MOTIVO'])||'').trim();
    const tipoEntrega=String(_pickCol(r,['TIPO ENTREGA'])||'').trim();
    const resp=String(_pickCol(r,['RESPONSABLE ENTREGA','RESPONSABLE'])||'').trim();
    const itemsStr=String(_pickCol(r,['ITEMS DETALLE','ITEMS','REPUESTOS ENTREGADOS','REPUESTOS'])||'').trim();
    const items=parseItemsDetalle(itemsStr);

    // Fallback: si MES/AÑO ARCHIVO no están (sheet sin esa metadata), derivamos
    // ym y label de la FECHA. Necesario para el sheet histórico nuevo (1WCtB...)
    // que solo trae N° ENTREGA, FECHA, EQUIPO, CÓDIGO, REPUESTOS, COSTO.
    let ym=mesAnioToYm(mes,anio);
    let label=mesAnioToLabel(mes,anio);
    if(!ym){
      const d=_parseDate(fechaRaw);
      if(d){
        ym=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        const _ab=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
        label=`${_ab[d.getMonth()]} ${d.getFullYear()}`;
      }
    }

    // 1) _entregaCostos[nro] — costo TOTAL de la entrega (no la parte de cada
    // equipo). Guardamos también entre cuántos equipos se reparte para que el
    // modal pueda mostrar la parte que le toca a cada uno.
    if(nro){
      ctx.entregaCostos[nro]={costo:costo,mes:label||'',nEquipos:nEquipos,fecha:fecha||''};
    }
    // 1b) _entregasPorPedido[nroPedido] — vínculo entrega→pedido leído de la
    // columna N° PEDIDO de REP_LIVE. Cubre las entregas que registran su pedido
    // aunque el pedido no tenga el back-ref N° ENTREGA cargado. Dedup por nro.
    if(nroPedido&&nro){
      const k=String(nroPedido).trim();
      const arr=(ctx.entregasPorPedido[k]=ctx.entregasPorPedido[k]||[]);
      if(!arr.includes(nro))arr.push(nro);
    }
    // 2) _itemsPorEntrega[nro]
    if(nro&&items.length){
      ctx.itemsPorEntrega[nro]=items;
    }
    // 3) _costosPorMes[ym][codN]
    if(ym&&codN&&costo>0){
      (ctx.costosPorMes[ym]=ctx.costosPorMes[ym]||{});
      ctx.costosPorMes[ym][codN]=(ctx.costosPorMes[ym][codN]||0)+costoEq;
      // 4) _repuestosHistorial[codN][ym]
      (ctx.repuestosHistorial[codN]=ctx.repuestosHistorial[codN]||{});
      ctx.repuestosHistorial[codN][ym]=(ctx.repuestosHistorial[codN][ym]||0)+costoEq;
      // 4b) Solo correctivo SIN neumáticos (criterio del tab de costos:
      // RAZÓN manda, fallback por texto de items). Alimenta costos downtime.
      if(esCorrectivoCosto(razon,itemsStr)){
        (ctx.costosCorrPorMes[ym]=ctx.costosCorrPorMes[ym]||{});
        ctx.costosCorrPorMes[ym][codN]=(ctx.costosCorrPorMes[ym][codN]||0)+costoEq;
        // Mismo predicado/monto que el total → el desglove reconcilia exacto.
        (ctx.entregasCorrPorEquipo[codN]=ctx.entregasCorrPorEquipo[codN]||[]).push({
          nro:nro||'—', fecha:fecha||'—', ym, items:itemsStr||'—', razon:razon||'',
          costo:costoEq, nEquipos:nEquipos,
        });
      }
    }
    // 5) _entregasPorEquipo[codN]
    if(codN&&codN!=='-'){
      (ctx.entregasPorEquipo[codN]=ctx.entregasPorEquipo[codN]||[]).push({
        nro:nro||'—', fecha:fecha||'—',
        items:itemsStr||'—', costo:costoEq, razon:razon||'', nEquipos:nEquipos,
        tipo:tipoEntrega||'',
      });
    }
    // 6) Entregas del mes actual (para el dashboard inicial). Una entrega
    // imputada a varios equipos llega como N filas: la listamos UNA sola vez,
    // con su costo total (no la parte de cada equipo).
    if(MES_ACTUAL_YM&&ym===MES_ACTUAL_YM&&!(nro&&_mesActualVistos[nro])){
      if(nro)_mesActualVistos[nro]=1;
      ctx.entregasMesActual.push({
        nro,fecha,equipo,codigo:codigoRaw,
        costo:costoStr,costoNum:costo,
        razon,responsable:resp,nroPedido,
        items,nEquipos,
      });
    }
  }
  return ctx;
}

/* ═══════════════════════════════════════════════════════
   CARGA LAZY
═══════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════
   PROCESAMIENTO PANEL_TRABAJOS · agregados a nivel flota
═══════════════════════════════════════════════════════ */
// Clasifica un trabajo de PANEL_TRABAJOS como 'preventivo' (mantenimiento programado:
// service, mantenimiento básico) o 'correctivo' (reparación, neumáticos, rotura).
// Prioridad: columna RAZÓN TRABAJO cuando está cargada > heurística por palabras clave
// en la descripción. Criterio definido por Marcos (may-2026):
//   - neumáticos = correctivo
//   - si RAZÓN tiene rasgos de reparación Y de mantenimiento, gana correctivo
//   - filas sin RAZÓN se adivinan por descripción; si nada matchea → correctivo
function clasificarTrabajo(razon,descripcion){
  const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  const r=norm(razon);
  if(r){
    if(r.includes('reparacion')||r.includes('neumatico'))return'correctivo';
    if(r.includes('service')||r.includes('mantenimiento'))return'preventivo';
  }
  // RAZÓN vacía o no reconocida → heurística por descripción
  const d=norm(descripcion);
  const KW_PREV=['service','mantenimiento','cambio de aceite','cambio de filtro',
    'cambio de filtros','filtro de aceite','engrase','lubricacion','lubricado'];
  for(const kw of KW_PREV)if(d.includes(kw))return'preventivo';
  return'correctivo';
}

// Criterio del TAB DE COSTOS (pedido de Marcos jul-2026): correctivo SIN
// neumáticos. Las gomas infladan el costo de downtime (son consumo de desgaste
// más que falla mecánica), así que se separan. OJO: clasificarTrabajo (KPI de
// horas del panel) NO cambia — neumáticos siguen siendo correctivo ahí.
function esCorrectivoCosto(razon,descripcion){
  const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  const r=norm(razon), d=norm(descripcion);
  if(r.includes('neumatic'))return false;
  // filas sin razón: si la descripción/items delatan gomería, también afuera
  if(!r&&(d.includes('neumatic')||d.includes('cubierta')||d.includes('pinchad')))return false;
  return clasificarTrabajo(razon,descripcion)==='correctivo';
}

// Toma las filas de PANEL_TRABAJOS (formato fetchGvizObj) y produce:
//   _horasPorEquipo  : { codN: totalHoras }
//   _horasPorMesFlota: { ym: totalHorasFlota }
//   _horasFlota      : { prev, corr, total }   ← split preventivo/correctivo de la flota
//   _horasPrev/CorrPorMes    : { ym: horas }
//   _horasPrev/CorrPorEquipo : { codN: horas }
// Tolera nombres de columna variantes (igual que loadTrabajosRegistro).
function procesarPanelTrabajos(rawRows){
  const out={
    horasPorEquipo:{},horasPorMesFlota:{},totalFilas:0,
    horasFlota:{prev:0,corr:0,total:0},
    horasPrevPorMes:{},horasCorrPorMes:{},
    horasPrevPorEquipo:{},horasCorrPorEquipo:{},
    horasPorMesYEquipo:{}, // {ym: {codN: horas}} — para listado de horas filtrado por rango
    horasCorrPorMesYEquipo:{},  // {ym: {codN: hr correctivas}} — tab costos downtime (MO + oportunidad)
    trabajosCorrPorEquipo:{},   // {codN: [{fecha,ym,desc,hs}]} — line items del tab costos (desglose MO/oportunidad)
  };
  if(!rawRows||!rawRows.length)return out;
  const SINONIMOS={
    codigo:['CODIGO','COD','CODIGO EQUIPO'],
    equipo:['EQUIPO','NOMBRE EQUIPO','DESCRIPCION EQUIPO'],
    fecha :['FECHA TRABAJO','FECHA DE TRABAJO','FECHA'],
    tiempo:['TIEMPO TRABAJO','TIEMPO (HR)','TIEMPO TRABAJO (HR)','TIEMPO TRABAJO HR','TIEMPO HR','TIEMPO','HORAS','HS'],
    razon :['RAZON TRABAJO','RAZON DE TRABAJO','RAZON','MOTIVO TRABAJO','MOTIVO'],
    desc  :['DESCRIPCION TRABAJOS','TRABAJOS REALIZADOS','TRABAJO REALIZADO','DESCRIPCION TRABAJO','DESCRIPCION'],
  };
  // Mapa nombre-normalizado → codN para fallback cuando CÓDIGO viene vacío
  const nombreToCod={};
  for(const eq of(window._equiposOrdenados||[])){
    const n=normCod(eq.nombre||'');
    if(n)nombreToCod[n]=normCod(eq.codigo);
  }
  let totalFilas=0;
  for(const r of rawRows){
    const idx={};
    for(const k of Object.keys(r))idx[normHead(k)]=r[k];
    const get=keys=>{
      for(const k of keys){const v=idx[k];if(v!=null&&String(v).trim()!=='')return String(v).trim();}
      return'';
    };
    const codRaw=get(SINONIMOS.codigo);
    let codN=normCod(codRaw);
    if(!codN){
      const nomN=normCod(get(SINONIMOS.equipo));
      if(nomN&&nombreToCod[nomN])codN=nombreToCod[nomN];
    }
    const tiempo=get(SINONIMOS.tiempo);
    const fecha=get(SINONIMOS.fecha);
    if(!codN&&!tiempo&&!fecha)continue;
    totalFilas++;
    const tNum=parseFloat(String(tiempo||'').replace(',','.'));
    if(!isFinite(tNum)||tNum<=0)continue;
    // Clasificar preventivo / correctivo
    const tipo=clasificarTrabajo(get(SINONIMOS.razon),get(SINONIMOS.desc));
    const esPrev=tipo==='preventivo';
    // total flota + split
    out.horasFlota.total+=tNum;
    if(esPrev)out.horasFlota.prev+=tNum; else out.horasFlota.corr+=tNum;
    // horas por equipo (cualquier fecha cuenta para el ranking 2026)
    if(codN){
      out.horasPorEquipo[codN]=(out.horasPorEquipo[codN]||0)+tNum;
      if(esPrev)out.horasPrevPorEquipo[codN]=(out.horasPrevPorEquipo[codN]||0)+tNum;
      else      out.horasCorrPorEquipo[codN]=(out.horasCorrPorEquipo[codN]||0)+tNum;
    }
    // horas por mes a nivel flota + por mes y equipo (para listado filtrado)
    const d=_parseDate(fecha);
    if(d){
      const ym=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      out.horasPorMesFlota[ym]=(out.horasPorMesFlota[ym]||0)+tNum;
      if(esPrev)out.horasPrevPorMes[ym]=(out.horasPrevPorMes[ym]||0)+tNum;
      else      out.horasCorrPorMes[ym]=(out.horasCorrPorMes[ym]||0)+tNum;
      if(codN){
        out.horasPorMesYEquipo[ym]=out.horasPorMesYEquipo[ym]||{};
        out.horasPorMesYEquipo[ym][codN]=(out.horasPorMesYEquipo[ym][codN]||0)+tNum;
        // Correctivos SIN neumáticos (criterio del tab de costos): las horas
        // de mantenimiento correctivo (TIEMPO TRABAJO) alimentan MO y también
        // el costo de oportunidad. TIEMPO PARADA se descartó: el taller lo
        // carga en 0 en casi todos los registros 2026 (definición jul-2026).
        if(esCorrectivoCosto(get(SINONIMOS.razon),get(SINONIMOS.desc))){
          out.horasCorrPorMesYEquipo[ym]=out.horasCorrPorMesYEquipo[ym]||{};
          out.horasCorrPorMesYEquipo[ym][codN]=(out.horasCorrPorMesYEquipo[ym][codN]||0)+tNum;
          // Mismo predicado/horas que el total → el desglose reconcilia exacto.
          (out.trabajosCorrPorEquipo[codN]=out.trabajosCorrPorEquipo[codN]||[]).push({
            fecha:fecha||'—', ym, desc:get(SINONIMOS.desc)||get(SINONIMOS.razon)||'—', hs:tNum,
          });
        }
      }
    }
  }
  out.totalFilas=totalFilas;
  return out;
}

/* ═══════════════════════════════════════════════════════
   SERVICES PLANIFICADOS — fuentes externas a TRABAJOS REALIZADOS
   Regla operativa: cuando el service es PURO (sin reparaciones asociadas) se
   carga SOLO en los sheets de service ("PROGRAMA DE TRABAJOS DE SERVICE 2026"
   + PANEL_PROGRAMA del "TRABAJO DE SERVICE 2026"). Cuando hay reparación o
   parada conjunta service+reparación, se carga en las planillas mensuales
   TRABAJOS REALIZADOS. Por eso este cruce NO es para detectar fallas de carga
   sino para clasificar y completar la métrica:
     - cargadosService:    el operario también cargó como service en planilla
                           (puede haber reparación pequeña en la misma parada)
     - cargadosOtraRazon:  parada conjunta service+reparación cargada como
                           "Reparación" (la razón del operario manda)
     - sinCarga:           service PURO — solo está en el planning porque no
                           hubo reparación. Estimamos horas con la mediana de
                           services registrados del prefijo del equipo y las
                           sumamos al preventivo (las planillas TRABAJOS DE
                           SERVICE no registran tiempo trabajado).
═══════════════════════════════════════════════════════ */
// Pestañas POR EQUIPO del sheet HIST de trabajos (1cNWQ). El consolidador del
// Drive periódicamente trunca PANEL_TRABAJOS dejando solo el año en curso, pero
// estas pestañas operativas se mantienen con datos de años anteriores. Las
// leemos en paralelo para reconstruir el histórico 2025. Si se agrega un equipo
// nuevo al sheet, hay que sumarlo acá (o se pierde su histórico 2025).
const TRABAJOS_HIST_PESTANAS_EQUIPOS=[
  'Automóvil Chevrolet Prisma','Barredora Guillermo Fracchia','Batea Patronelli',
  'Camión Ford Cargo 1831','Camión Ford Cargo 1832E','Camión Mercedes Benz 1720',
  'Camión Mercedes Benz 1725','Camión Mercedes Benz L1114','Camión Mercedes Benz L1514',
  'Camión Mercedes Benz L1620','Camión Scania LT111','Camión Volvo FM380',
  'Camioneta Chevrolet S10','Camioneta Fiat Fiorino','Camioneta Fiat Strada',
  'Camioneta Fiat Toro','Camioneta Ford Ranger','Camioneta Nissan Frontier',
  'Camioneta Renault Kangoo','Camioneta Toyota Hilux','Camioneta Volkswagen Amarok',
  'Cargador John Deere 544K','Cargador John Deere 624K','Cargador Volvo L110F',
  'Cargador Volvo L90F','Carretón Marcelini SRC12NA','Carretón LEO-COR Agro 21',
  'Compresor Atlas Copco','Compresor Ingersoll Rand','Compresor Schulz',
  'Generador CETEC CD-530','Generador CRAM','Generador MWM MS3.9A',
  'Motoniveladora CAT 140K','Motoniveladora CAT 140M','Motoniveladora CAT 14G',
  'Planta Ammann Prime 140','Retroexcavadora John Deere 210G',
  'Retroexcavadora Komatsu PC200','Retroexcavadora Komatsu PC210',
  'Retropala CAT 416E','Retropala Hidromek 102B','Retropala John Deere 310J',
  'Retropala John Deere 310K','Retropala John Deere 310L','Rodillo Bomag BW24RH',
  'Rodillo CAT CB534D','Rodillo CAT CS-533C','Rodillo CAT CS-533E',
  'Rodillo Dynapac CC424HF','Rodillo Dynapac CP221','Rodillo Dynapac CP224',
  'Rodillo Volvo SD105','Terminadora Dynapac F121C','Terminadora Dynapac F2500C',
  'Topadora CAT D6E','Trituradora Metso HP300','Zaranda ASTEC GT145S',
];

// HIST de trabajos por equipo: el aplanado de las 58 pestañas (con la
// heurística de fechas-rango que gviz devolvía null) ahora lo hace el builder
// server-side y queda en la pestaña TRAB_HIST58 del snapshot. El browser solo
// la lee y filtra por año (ver fetchTrabajosHistPorEquipo más abajo). La lógica
// de las 3 pasadas vive en _construirHist58_ de apps-scripts/snapshot-builder.gs.
async function fetchTrabajosHistPorEquipo(predicateAnio){
  // El builder ya aplanó las 58 pestañas por equipo en la pestaña TRAB_HIST58
  // del snapshot, con la heurística de fechas-rango aplicada server-side (que
  // además recupera fechas que gviz devolvía null en columnas Date). Acá solo
  // leemos esa pestaña y filtramos por año: 1 request en vez de 58.
  let rows=[];
  try{ rows=await fetchGvizObj(SNAPSHOT_ID,'TRAB_HIST58'); }
  catch(e){ window._fetchTrabajosHistErrores=[{pest:'TRAB_HIST58',error:e.message}]; return []; }
  window._fetchTrabajosHistErrores=[];
  // Lookup de FECHA tolerante al nombre exacto de columna (defensa en profundidad):
  // si el builder renombra el header o gviz no lo detecta, igual encontramos la fecha.
  const _SIN_FECHA=['FECHA TRABAJO','FECHA DE TRABAJO','FECHA'];
  const out=[];
  let conFecha=0;
  for(const r of rows){
    const idx={};
    for(const k of Object.keys(r))idx[normHead(k)]=r[k];
    let fechaStr='';
    for(const k of _SIN_FECHA){const v=idx[k];if(v!=null&&String(v).trim()!==''){fechaStr=String(v).trim();break;}}
    if(!fechaStr)continue;
    conFecha++;
    const d=_parseDate(fechaStr);
    if(!d||!predicateAnio(d.getFullYear()))continue;
    out.push(r);
  }
  // Guard de regresión: si llegaron filas pero NINGUNA tenía columna de fecha
  // reconocible, es el síntoma del header no detectado → lo dejamos visible en
  // lugar de perder el histórico en silencio (como pasó con el bug del format '@').
  if(rows.length && conFecha===0){
    window._fetchTrabajosHistErrores=[{pest:'TRAB_HIST58',error:`header no detectado: ${rows.length} filas sin columna FECHA reconocible (cols: ${Object.keys(rows[0]||{}).join(',')})`}];
    console.warn('[TRAB_HIST58]',window._fetchTrabajosHistErrores[0].error);
  }
  return out;
}

const SERVICE_VENTANA_DIAS=7;
function _prefijoCod(codN){const m=String(codN||'').match(/^([A-Z]+)/);return m?m[1]:'';}
function _ymd(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function _ym(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
function _mediana(arr){const s=[...arr].sort((a,b)=>a-b);const n=s.length;if(!n)return null;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;}
// Parsea fecha simple o rango ("3/3/2026 - 12/3/2026", "3/3/2026 – 12/3/2026").
// Devuelve {inicio, fin} (Date) o null. Para fecha simple, inicio === fin.
// _parseDate por sí solo devuelve solo la primera fecha que matchea — para rangos
// con guion/em-dash, perdería un extremo. Acá detectamos el separador y partimos.
function _parseFechaRango(s){
  if(s==null)return null;
  const str=String(s).trim();
  if(!str)return null;
  const partes=str.split(/\s*[-–—]\s*/);
  if(partes.length>=2){
    const ini=_parseDate(partes[0]);
    const fin=_parseDate(partes[partes.length-1]);
    if(ini&&fin)return{inicio:ini<=fin?ini:fin,fin:ini<=fin?fin:ini};
    if(ini)return{inicio:ini,fin:ini};
    if(fin)return{inicio:fin,fin:fin};
  }
  const d=_parseDate(str);
  return d?{inicio:d,fin:d}:null;
}
// Distancia mínima en ms entre un punto y un rango [inicio, fin]. 0 si está dentro.
function _distAlRango(punto,rango){
  if(!rango)return Infinity;
  if(punto<rango.inicio)return rango.inicio-punto;
  if(punto>rango.fin)return punto-rango.fin;
  return 0;
}

// Lee los 3 sheets de planning y devuelve eventos únicos {cod, fecha, ym}.
// trim1Rows/trim2Rows vienen como arrays de arrays (gvizRaw); cols [1]=codigo,
// [6]=ULT_FECHA, [11]/[13]/[15]=fechas mensuales del trimestre.
// panelProgramaRows viene como array de objetos (gvizObj); CODIGO, ULT_FECHA.
function procesarServicesPlanning(trim1Rows,trim2Rows,panelProgramaRows){
  const eventos=[];
  const COLS_TRIM_FECHA=[6,11,13,15];
  for(const rows of [trim1Rows||[],trim2Rows||[]]){
    for(const r of rows){
      const cod=normCod(r&&r[1]);
      if(!cod)continue;
      for(const idx of COLS_TRIM_FECHA){
        const d=_parseDate(r[idx]);
        if(d)eventos.push({cod,fecha:d});
      }
    }
  }
  for(const r of (panelProgramaRows||[])){
    const idx={};
    for(const k of Object.keys(r||{}))idx[normHead(k)]=r[k];
    const cod=normCod(idx['CODIGO']||idx['COD']||'');
    if(!cod)continue;
    const d=_parseDate(idx['ULT FECHA']||idx['ULTIMA FECHA']||'');
    if(d)eventos.push({cod,fecha:d});
  }
  // Deduplicar por (cod, ymd)
  const seen=new Set();
  const unicos=[];
  const fechasPorCod={};
  for(const e of eventos){
    const ymd=_ymd(e.fecha);
    const k=`${e.cod}|${ymd}`;
    if(seen.has(k))continue;
    seen.add(k);
    unicos.push({cod:e.cod,fecha:e.fecha,ym:_ym(e.fecha),ymd});
    if(!fechasPorCod[e.cod])fechasPorCod[e.cod]=new Set();
    fechasPorCod[e.cod].add(ymd);
  }
  return{eventos:unicos,fechasPorCod,total:unicos.length};
}

// Cruza services del planning con PANEL_TRABAJOS. Suma horas estimadas (mediana
// de horas de service registradas por prefijo) al preventivo SOLO para los que
// no tienen ninguna fila en ±7d (services puros sin reparación, no se cargaron
// en la planilla porque fueron rápidos).
function cruzarServicesEnTrabajos(rawTrabajos,servicesPlanning){
  const out={
    horasAgregadasFlota:0,
    horasAgregadasPorEquipo:{},
    horasAgregadasPorMes:{},
    horasAgregadasPorMesYEquipo:{}, // {ym: {codN: horas}} para listado filtrado
    serviceFechasMatch:{}, // codN -> Set<ymd> con TODAS las fechas con service planificado del equipo
    cumplimiento:{total:0,cargadosService:0,cargadosOtraRazon:0,sinCarga:0},
    medianas:{global:null,porPrefijo:{}},
  };
  if(!servicesPlanning||!servicesPlanning.eventos.length)return out;

  // 1) Calcular mediana de horas por prefijo a partir de PANEL_TRABAJOS, mirando
  //    solo filas con RAZÓN service/mantenimiento y tiempo > 0.
  const SIN_TIEMPO=['TIEMPO TRABAJO','TIEMPO (HR)','TIEMPO TRABAJO (HR)','TIEMPO TRABAJO HR','TIEMPO HR','TIEMPO','HORAS','HS'];
  const SIN_FECHA=['FECHA TRABAJO','FECHA DE TRABAJO','FECHA'];
  const SIN_RAZON=['RAZON TRABAJO','RAZON DE TRABAJO','RAZON','MOTIVO TRABAJO','MOTIVO'];
  const SIN_COD=['CODIGO','COD','CODIGO EQUIPO'];
  const horasPorPref={};const horasGlobal=[];
  const filasTrab=[]; // {codN, rango:{inicio,fin}|null, razon, tNum}
  for(const r of (rawTrabajos||[])){
    const idx={};
    for(const k of Object.keys(r))idx[normHead(k)]=r[k];
    const get=keys=>{for(const k of keys){const v=idx[k];if(v!=null&&String(v).trim()!=='')return String(v).trim();}return'';};
    const codN=normCod(get(SIN_COD));
    if(!codN)continue;
    const tNum=parseFloat(String(get(SIN_TIEMPO)).replace(',','.'));
    const razon=get(SIN_RAZON);
    // Soporta rangos "3/3/2026 - 12/3/2026": el cruce contra services planificados
    // matchea si el service cae adentro del rango (o dentro de ±7d del rango).
    const rango=_parseFechaRango(get(SIN_FECHA));
    filasTrab.push({codN,rango,razon,tNum:isFinite(tNum)&&tNum>0?tNum:0});
    if(isFinite(tNum)&&tNum>0&&/service|mantenimiento/i.test(razon)){
      const pref=_prefijoCod(codN);
      if(!horasPorPref[pref])horasPorPref[pref]=[];
      horasPorPref[pref].push(tNum);
      horasGlobal.push(tNum);
    }
  }
  const medianaGlobal=_mediana(horasGlobal);
  out.medianas.global=medianaGlobal;
  for(const k of Object.keys(horasPorPref))out.medianas.porPrefijo[k]=_mediana(horasPorPref[k]);

  // 2) Indexar filas de TRABAJOS por codN + calcular cobertura por año.
  // Sólo sumamos horas estimadas de services en AÑOS donde PANEL_TRABAJOS
  // tiene >=100 hr reales. Si un año tiene apenas una o dos filas perdidas
  // (ej. una fila con rango "2/1/2025 - 7/1/2025" en un panel que es
  // mayoritariamente 2026), no tiene sentido sumar todos los services
  // planificados de ese año porque no hay con qué contrastar.
  const trabajosPorCod={};
  const horasPorAnio={};
  for(const f of filasTrab){
    if(!trabajosPorCod[f.codN])trabajosPorCod[f.codN]=[];
    trabajosPorCod[f.codN].push(f);
    if(f.rango && f.tNum>0){
      const y=f.rango.inicio.getFullYear();
      horasPorAnio[y]=(horasPorAnio[y]||0)+f.tNum;
    }
  }
  const MIN_HORAS_ANIO=100;
  const aniosConCobertura=new Set(
    Object.keys(horasPorAnio).filter(y=>horasPorAnio[y]>=MIN_HORAS_ANIO).map(y=>+y)
  );

  // 3) Cruce: service "en ventana" si su fecha cae dentro del rango del trabajo o
  // a ≤SERVICE_VENTANA_DIAS de cualquiera de los extremos.
  const ventanaMs=SERVICE_VENTANA_DIAS*86400000;
  for(const ev of servicesPlanning.eventos){
    // Filtro por año: ignorar services en años sin cobertura sustancial de trabajos.
    if(aniosConCobertura.size>0 && !aniosConCobertura.has(ev.fecha.getFullYear())) continue;
    out.cumplimiento.total++;
    if(!out.serviceFechasMatch[ev.cod])out.serviceFechasMatch[ev.cod]=new Set();
    out.serviceFechasMatch[ev.cod].add(ev.ymd);
    const filas=trabajosPorCod[ev.cod]||[];
    const enVentana=filas.filter(f=>f.rango&&_distAlRango(ev.fecha,f.rango)<=ventanaMs);
    if(enVentana.length===0){
      out.cumplimiento.sinCarga++;
      const pref=_prefijoCod(ev.cod);
      const h=(out.medianas.porPrefijo[pref]!=null?out.medianas.porPrefijo[pref]:medianaGlobal)||0;
      if(h>0){
        out.horasAgregadasFlota+=h;
        out.horasAgregadasPorEquipo[ev.cod]=(out.horasAgregadasPorEquipo[ev.cod]||0)+h;
        out.horasAgregadasPorMes[ev.ym]=(out.horasAgregadasPorMes[ev.ym]||0)+h;
        out.horasAgregadasPorMesYEquipo[ev.ym]=out.horasAgregadasPorMesYEquipo[ev.ym]||{};
        out.horasAgregadasPorMesYEquipo[ev.ym][ev.cod]=(out.horasAgregadasPorMesYEquipo[ev.ym][ev.cod]||0)+h;
      }
      continue;
    }
    if(enVentana.some(f=>/service|mantenimiento/i.test(f.razon)))out.cumplimiento.cargadosService++;
    else out.cumplimiento.cargadosOtraRazon++;
  }
  return out;
}

/* ═══════════════════════════════════════════════════════
   PANEL_PROGRAMA — Estado de service por equipo
   Lee la consolidación del Sheet de service (TRABAJOS DE SERVICE 2026)
   y produce un índice por código normalizado.
   Columnas esperadas:
     CODIGO, DESCRIPCION, PATENTE, EST_FECHA, EST_HRKM,
     ULT_FECHA, ULT_HRKM, PROX_INFO, OPERATIVIDAD, FRECUENCIA,
     RANGO_HOLGADA, RANGO_INTERMEDIA, RANGO_CRITICA
═══════════════════════════════════════════════════════ */
function procesarPanelPrograma(rawRows){
  const out={};
  if(!rawRows||!rawRows.length)return out;
  const SIN={
    codigo:        ['CODIGO','COD'],
    descripcion:   ['DESCRIPCION','DESCRIPCIÓN','EQUIPO'],
    patente:       ['PATENTE','N SERIE N PATENTE','N° SERIE N° PATENTE'],
    estFecha:      ['EST FECHA','FECHA ESTIMADA','PROXIMO FECHA'],
    estHrKm:       ['EST HRKM','EST HR KM','HRKM ESTIMADO','PROXIMO HRKM'],
    ultFecha:      ['ULT FECHA','ULTIMA FECHA','FECHA ULTIMO'],
    ultHrKm:       ['ULT HRKM','ULT HR KM','HRKM ULTIMO','HRKM ACTUAL'],
    proxInfo:      ['PROX INFO','PROXIMO','PROX'],
    operatividad:  ['OPERATIVIDAD','OPERATIVO'],
    frecuencia:    ['FRECUENCIA','FREC'],
    rangoHolgada:  ['RANGO HOLGADA','HOLGADA','RANGO VERDE'],
    rangoIntermedia:['RANGO INTERMEDIA','INTERMEDIA','RANGO AMARILLO'],
    rangoCritica:  ['RANGO CRITICA','CRITICA','CRÍTICA','RANGO ROJO'],
    estado:        ['ESTADO'],                              // label pre-calculado (VENCIDO/CRÍTICO/…)
    hrActual:      ['HRKM ACTUAL','HR/KM ACTUAL','ACTUAL'],  // hr/km actual del equipo
  };
  for(const r of rawRows){
    const idx={};
    for(const k of Object.keys(r))idx[normHead(k)]=r[k];
    const get=keys=>{
      for(const k of keys){const v=idx[k];if(v!=null&&String(v).trim()!=='')return String(v).trim();}
      return'';
    };
    const codN=normCod(get(SIN.codigo));
    if(!codN)continue;
    out[codN]={
      codigo:get(SIN.codigo),
      descripcion:get(SIN.descripcion),
      patente:get(SIN.patente),
      estFecha:get(SIN.estFecha),
      estHrKm:get(SIN.estHrKm),
      ultFecha:get(SIN.ultFecha),
      ultHrKm:get(SIN.ultHrKm),
      proxInfo:get(SIN.proxInfo),
      operatividad:get(SIN.operatividad),
      frecuencia:get(SIN.frecuencia),
      rangoHolgada:get(SIN.rangoHolgada),
      rangoIntermedia:get(SIN.rangoIntermedia),
      rangoCritica:get(SIN.rangoCritica),
      estado:get(SIN.estado),
      hrActual:get(SIN.hrActual),
    };
  }
  return out;
}

/* ═══════════════════════════════════════════════════════
   PROGRAMA DE TRABAJOS DE SERVICE 2026 — fuente nueva.
   Combina FRECUENCIA-OPERATIVIDAD (rangos por equipo) con el trimestre
   vigente (estado actual, último y próximo service). Produce _servicePanel
   con shape compatible con el resto del panel.
   - frecRows: [descripcion, codigo, serie, frecuencia, holgada, intermedia, critica]
   - trimRows: [desc, cod, serie, _, fechaActual, hrActual, fechaUltService,
                hrUltService, hrProximoService, operatividad, ...]
═══════════════════════════════════════════════════════ */
function procesarProgramaService(frecRows,trimRows){
  const out={};
  for(const r of(frecRows||[])){
    const codN=normCod(r[1]);
    if(!codN)continue;
    out[codN]={
      codigo:String(r[1]||'').trim(),
      descripcion:String(r[0]||'').trim(),
      patente:String(r[2]||'').trim(),
      frecuencia:String(r[3]||'').trim(),
      rangoHolgada:String(r[4]||'').trim(),
      rangoIntermedia:String(r[5]||'').trim(),
      rangoCritica:String(r[6]||'').trim(),
      ultFecha:'',ultHrKm:'',estFecha:'',estHrKm:'',
      ultServiceFecha:'',ultServiceHrKm:'',operatividad:'',
    };
  }
  for(const r of(trimRows||[])){
    const codN=normCod(r[1]);
    if(!codN)continue;
    const e=out[codN]||(out[codN]={
      codigo:String(r[1]||'').trim(),descripcion:String(r[0]||'').trim(),
      patente:String(r[2]||'').trim(),frecuencia:'',
      rangoHolgada:'',rangoIntermedia:'',rangoCritica:'',
    });
    e.ultFecha       =String(r[4]||'').trim();
    e.ultHrKm        =String(r[5]||'').trim();
    e.ultServiceFecha=String(r[6]||'').trim();
    e.ultServiceHrKm =String(r[7]||'').trim();
    e.estHrKm        =String(r[8]||'').trim();
    e.operatividad   =String(r[9]||'').trim();
  }
  return out;
}

// Operatividad de service: clasifica un equipo en holgado / intermedio / critico
// según los hr/km restantes hasta el próximo service. La hr/km "actual" sale
// EXCLUSIVAMENTE del RESUMEN de service (SVC_PANELPROG). Antes se prefería la
// última carga de combustible por ser "más fresca", pero los typos de carga
// (dígitos comidos, códigos cruzados) contaminaban la operatividad — decisión
// jul-2026: una sola fuente curada, la del encargado de mantenimiento.
function operatividadEquipo(codN){
  const SD={nivel:'sin-datos',color:'var(--text3)',label:'Sin datos',
            restantes:null,hrActual:null,hrProximo:null,fuente:'',frecuencia:''};
  const sp=(window._servicePanel||{})[codN];
  if(!sp)return SD;
  // El nivel sale del ESTADO ya calculado en la hoja OPERATIVIDAD (vía SVC_PANELPROG).
  const est=String(sp.estado||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase();
  let nivel,color,label;
  if(/VENCIDO|CRITICO/.test(est)){ nivel='critico'; color='var(--red)'; label='Crítico'; }
  else if(/INTERMEDIO/.test(est)){ nivel='intermedio'; color='var(--amber)'; label='Intermedio'; }
  else if(/HOLGADO/.test(est)){ nivel='holgado'; color='var(--blue)'; label='Holgado'; }
  else return SD;
  // Números para el detalle/modal (descarta vacíos, "-", "S/H" y fechas).
  const numHr=v=>{
    const s=String(v||'').trim();
    if(!s||s==='-'||/\//.test(s)||/s\/?h/i.test(s))return null;
    const n=parseFloat(s.replace(/\./g,'').replace(',','.').replace(/[^\d.-]/g,''));
    return isFinite(n)?n:null;
  };
  const hrProximo=numHr(sp.estHrKm);
  const restantes=numHr(sp.operatividad);  // columna OPERATIVIDAD = hr/km restantes (ya calculado)
  let hrActual=numHr(sp.hrActual);
  if(hrActual==null)hrActual=numHr(sp.ultHrKm);
  const fuente='resumen de service';
  return{nivel,color,label,restantes,hrActual,hrProximo,fuente,frecuencia:sp.frecuencia};
}

/* ═══════════════════════════════════════════════════════
   COMBUSTIBLE — Procesamiento de la pestaña ENTREGA DE COMBUSTIBLE
   Una fila = una carga. Acumulamos por código de equipo y derivamos:
     - últimas hr/km registradas (y su fecha)
     - litros totales 2026
     - consumo promedio (L/hr o L/100km según prefijo del código)
     - historial ordenado de cargas
═══════════════════════════════════════════════════════ */
// Devuelve 'km' para prefijos en PREFIJOS_KM; 'hr' para todo lo demás.
function unidadDeEquipo(codigo){
  const p=(codigo||'').toUpperCase().match(/^[A-Z]+/)?.[0]||'';
  return PREFIJOS_KM.has(p)?'km':'hr';
}

// Procesa filas (objetos fetchGvizObj) de la pestaña de combustible.
// Salida:
//   _porEquipo[codN] = { unidad, cargas:[{fecha,fechaSort,hr,litros,tipo,lugar,operario,obs,estado}],
//                        ultimaHr, ultimaFecha, totalLitros, promedio }
// "promedio" se calcula como totalLitros / (hr_max - hr_min) usando solo cargas con hr funcional.
function procesarCombustible(rows){
  const porEquipo={};
  // Litros por mes (alimenta el KPI de combustible pesados con selector de rango).
  const _litrosPorMes={}, _cargasPorMes={};
  window._litrosCombPesadosPorMes=_litrosPorMes;
  window._cargasCombPesadosPorMes=_cargasPorMes;
  if(!rows||!rows.length)return porEquipo;

  // Lookup tolerante de columnas (estos headers vienen de un Form, no van a cambiar fácil,
  // pero usamos _pickCol por las dudas).
  for(const r of rows){
    const codRaw=String(_pickCol(r,['CODIGO INTERNO DE EQUIPO NUMERO DE PATENTE DE EQUIPO',
      'CODIGO INTERNO DE EQUIPO','CODIGO INTERNO','CODIGO EQUIPO','CODIGO'])||'').trim();
    if(!codRaw)continue;
    const codN=normCod(codRaw);
    if(!codN)continue;
    const fechaStr=String(_pickCol(r,['FECHA'])||'').trim();
    const fechaD=_parseDate(fechaStr);
    const estadoHr=String(_pickCol(r,['ESTADO DE HOROMETRO U ODOMETRO DE EQUIPO','ESTADO HOROMETRO','ESTADO ODOMETRO','ESTADO'])||'').trim();
    const hrRaw=_pickCol(r,['HOROMETRO U ODOMETRO ACTUAL DE EQUIPO HORAS MAQUINA O KILOMETROS',
      'HOROMETRO U ODOMETRO ACTUAL DE EQUIPO','HOROMETRO U ODOMETRO ACTUAL','HOROMETRO ACTUAL','ODOMETRO ACTUAL']);
    const hrNum=parseFloat(String(hrRaw||'').replace(/[^\d.,-]/g,'').replace(',','.'));
    const litrosRaw=_pickCol(r,['CANTIDAD DE ENTREGA DE COMBUSTIBLE LITROS','CANTIDAD DE ENTREGA DE COMBUSTIBLE','LITROS','CANTIDAD']);
    const litros=parseFloat(String(litrosRaw||'').replace(/[^\d.,-]/g,'').replace(',','.'))||0;
    if(fechaD){
      const _ym=fechaD.getFullYear()+'-'+String(fechaD.getMonth()+1).padStart(2,'0');
      _litrosPorMes[_ym]=(_litrosPorMes[_ym]||0)+litros;
      _cargasPorMes[_ym]=(_cargasPorMes[_ym]||0)+1;
    }
    const tipo=String(_pickCol(r,['TIPO DE COMBUSTIBLE ENTREGADO DIESEL 500 O DIESEL INFINIA','TIPO DE COMBUSTIBLE ENTREGADO','TIPO DE COMBUSTIBLE','TIPO'])||'').trim();
    const lugar=String(_pickCol(r,['LUGAR DE ENTREGA DE COMBUSTIBLE','LUGAR ENTREGA','LUGAR'])||'').trim();
    const operario=String(_pickCol(r,['OPERARIO DE EQUIPO NOMBRE Y APELLIDO','OPERARIO DE EQUIPO','OPERARIO'])||'').trim();
    const obs=String(_pickCol(r,['OBSERVACIONES GENERALES','OBSERVACIONES','OBS'])||'').trim();
    // El form a veces graba 0 cuando "No funciona" el horómetro. Esos no aportan al consumo
    // pero los conservamos en el historial con hr=null para no perder la carga.
    const hrFunc = estadoHr.toLowerCase().startsWith('sí') || estadoHr.toLowerCase().startsWith('si');
    const hrUsable = hrFunc && isFinite(hrNum) && hrNum>0 ? hrNum : null;

    if(!porEquipo[codN]){
      porEquipo[codN]={
        unidad:unidadDeEquipo(codRaw),
        cargas:[],
        ultimaHr:null, ultimaFecha:null, ultimaFechaSort:null,
        totalLitros:0, promedio:null,
      };
    }
    porEquipo[codN].cargas.push({
      fecha:fechaStr, fechaSort:fechaD?fechaD.getTime():0,
      hr:hrUsable, litros, tipo, lugar, operario, obs,
      estado:hrFunc?'ok':'sin lectura',
    });
    porEquipo[codN].totalLitros+=litros;
  }

  // Postproceso por equipo: ordenar, calcular última y promedio
  for(const codN of Object.keys(porEquipo)){
    const eq=porEquipo[codN];
    eq.cargas.sort((a,b)=>a.fechaSort-b.fechaSort);
    // última lectura válida (la más reciente con hr funcional)
    for(let i=eq.cargas.length-1;i>=0;i--){
      const c=eq.cargas[i];
      if(c.hr!=null){
        eq.ultimaHr=c.hr; eq.ultimaFecha=c.fecha; eq.ultimaFechaSort=c.fechaSort;
        break;
      }
    }
    // consumo: usamos litros entre primera y última lectura con hr funcional
    // (ver _litrosEntreLecturas: entran TODAS las cargas del período, tengan o
    // no lectura). Excluimos los litros de la PRIMERA carga (no sabemos qué hr
    // tenía al empezar el período de medición), que es la práctica estándar.
    const conHr=eq.cargas.filter(c=>c.hr!=null);
    if(conHr.length>=2){
      const hrPrimera=conHr[0].hr, hrUltima=conHr[conHr.length-1].hr;
      const delta=hrUltima-hrPrimera;
      const litrosPeriodo=_litrosEntreLecturas(eq.cargas);
      if(delta>0 && litrosPeriodo>0){
        // L/hr para horómetro; L/100km para odómetro
        eq.promedio = eq.unidad==='km' ? (litrosPeriodo/delta*100) : (litrosPeriodo/delta);
      }
    }
  }
  return porEquipo;
}

/* ═══════════════════════════════════════════════════════
   VTV — verificación técnica vehicular
   Marcos carga la planilla a mano y la va completando de a poco (incompleta
   a propósito). Copiamos EQUIPO/CÓDIGO/PATENTE/VENCIMIENTO verbatim del
   snapshot; acá calculamos los días restantes al vuelo (negativo = vencida)
   así el KPI siempre está al día sin depender de una fórmula en el sheet.
   Sin fila para un equipo → no aparece, no se fabrica dato.
═══════════════════════════════════════════════════════ */
function procesarVTV(rows){
  const porEquipo={};
  const hoy=new Date();hoy.setHours(0,0,0,0);
  for(const r of(rows||[])){
    const codRaw=String(_pickCol(r,['CÓDIGO','CODIGO'])||'').trim();
    const codN=normCod(codRaw);
    if(!codN)continue;
    const equipo=String(_pickCol(r,['EQUIPO'])||'').trim();
    const patente=String(_pickCol(r,['PATENTE','N° SERIE/PATENTE'])||'').trim();
    const vencStr=String(_pickCol(r,['VENCIMIENTO VTV','VENCIMIENTO'])||'').trim();
    const venc=_parseDate(vencStr);
    if(!venc)continue;
    const dias=Math.round((venc-hoy)/86400000);
    porEquipo[codN]={codN,codigo:codRaw||codN,equipo,patente,vencimiento:vencStr,dias};
  }
  return porEquipo;
}
const VTV_UMBRAL_DIAS=14; // "2 semanas o menos" — incluye ya vencidas (días negativos)

/* Litros consumidos entre la primera y la última lectura de horómetro/odómetro.
   Cuenta TODAS las cargas del período (con lectura o sin ella): el equipo quemó
   ese combustible igual, y el delta de hr/km ya cubre todo el intervalo. Antes se
   sumaban solo los litros de las cargas CON lectura → con la mitad de las cargas
   sin odómetro el consumo salía casi a la mitad (CMT-03 daba 1,6 L/100km).
   Se excluyen los litros de la primera carga con lectura (práctica estándar: no
   sabemos con cuánto tanque arrancó el período) y los posteriores a la última. */
/* Recalcula última lectura + consumo promedio de un equipo a partir de sus
   cargas (ya ordenadas por fecha). Se usa al fusionar las dos fuentes de
   combustible de una misma camioneta. Unidad 'km' → L/100km; 'hr' → L/hr. */
function _recalcConsumo(e){
  e.ultimaHr=null; e.ultimaFecha=null; e.ultimaFechaSort=null; e.promedio=null;
  for(let i=e.cargas.length-1;i>=0;i--){
    if(e.cargas[i].hr!=null){e.ultimaHr=e.cargas[i].hr;e.ultimaFecha=e.cargas[i].fecha;e.ultimaFechaSort=e.cargas[i].fechaSort;break;}
  }
  const conHr=e.cargas.filter(c=>c.hr!=null);
  if(conHr.length<2)return;
  const delta=conHr[conHr.length-1].hr-conHr[0].hr;
  const litros=_litrosEntreLecturas(e.cargas);
  if(delta>0&&litros>0)e.promedio=(e.unidad==='km')?(litros/delta*100):(litros/delta);
}

function _litrosEntreLecturas(cargasOrdenadas){
  let i0=-1,i1=-1;
  for(let i=0;i<cargasOrdenadas.length;i++){
    if(cargasOrdenadas[i].hr!=null){ if(i0<0)i0=i; i1=i; }
  }
  if(i0<0||i1<=i0)return 0;
  let s=0;
  for(let i=i0+1;i<=i1;i++)s+=cargasOrdenadas[i].litros||0;
  return s;
}

/* ═══════════════════════════════════════════════════════
   COMBUSTIBLE LIVIANOS — Excel "Control General"
   Una fila = una carga. Columnas (0-indexadas):
     0 fecha · 1 factura · 2 remito · 3 tipo · 4 litros ·
     5 dominio(patente) · 6 odómetro(km) · 7 obra · 8 chofer ·
     10 precio unitario · 11 total $
   Solo se toman los registros desde COMBUSTIBLE_LIVIANOS_DESDE (lo anterior
   es histórico viejo). Se matchea por patente al código de equipo.
═══════════════════════════════════════════════════════ */
function procesarCombustibleLivianos(rawRows,patenteToCarN){
  const out={porEquipo:{},gastoTotal:0,cargasTotal:0,sinMatch:0,gastoPorMes:{},cargasPorMes:{}};
  if(!rawRows||!rawRows.length)return out;
  const numLitros=v=>{const n=parseFloat(String(v||'').trim().replace(',','.'));return isFinite(n)&&n>0?n:null;};
  const numKm=v=>{const s=String(v||'').replace(/[^\d]/g,'');return s?parseInt(s,10):null;};
  for(let i=0;i<rawRows.length;i++){
    const r=rawRows[i];
    if(!r)continue;
    const fecha=String(r[0]||'').trim();
    const patRaw=String(r[5]||'').trim();
    if(!fecha&&!patRaw)continue;            // fila vacía / basura
    const d=_parseDate(fecha);
    if(!d||d<COMBUSTIBLE_LIVIANOS_DESDE)continue;  // solo enero 2025 en adelante
    const litros=numLitros(r[4]);
    const costo=parseMoney(r[11]);
    const ym=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    // gasto total + por mes: cuenta TODAS las cargas (incluye "Bidones" y no matcheadas)
    if(costo>0){
      out.gastoTotal+=costo;
      if(ym)out.gastoPorMes[ym]=(out.gastoPorMes[ym]||0)+costo;
    }
    out.cargasTotal++;
    if(ym)out.cargasPorMes[ym]=(out.cargasPorMes[ym]||0)+1;
    const codN=patenteToCarN[normPat(patRaw)];
    if(!codN){ out.sinMatch++; continue; }  // "Bidones", patentes no mapeadas
    const km=numKm(r[6]);
    const e=out.porEquipo[codN]||(out.porEquipo[codN]={
      unidad:'km',cargas:[],ultimaHr:null,ultimaFecha:null,ultimaFechaSort:null,
      totalLitros:0,totalCosto:0,promedio:null,
    });
    e.cargas.push({
      fecha,fechaSort:d?d.getTime():0,
      hr:(km!=null&&km>0)?km:null,litros:litros||0,costo:costo||0,
      tipo:String(r[3]||'').trim(),lugar:String(r[7]||'').trim(),
      operario:String(r[8]||'').trim(),obs:'',estado:(km!=null&&km>0)?'ok':'sin lectura',
    });
    e.totalLitros+=litros||0;
    e.totalCosto+=costo||0;
  }
  // Postproceso por equipo: ordenar, última lectura, consumo L/100km.
  for(const codN of Object.keys(out.porEquipo)){
    const e=out.porEquipo[codN];
    e.cargas.sort((a,b)=>a.fechaSort-b.fechaSort);
    for(let i=e.cargas.length-1;i>=0;i--){
      if(e.cargas[i].hr!=null){e.ultimaHr=e.cargas[i].hr;e.ultimaFecha=e.cargas[i].fecha;e.ultimaFechaSort=e.cargas[i].fechaSort;break;}
    }
    const conHr=e.cargas.filter(c=>c.hr!=null);
    if(conHr.length>=2){
      const delta=conHr[conHr.length-1].hr-conHr[0].hr;
      const litrosPeriodo=_litrosEntreLecturas(e.cargas);
      if(delta>0&&litrosPeriodo>0)e.promedio=litrosPeriodo/delta*100; // L/100km
    }
  }
  return out;
}

// Clasifica el estado de service de un equipo: 'red' | 'amber' | 'green' | 'gray'
// Compara hr/km actual del equipo contra estimación del próximo service y rangos
// (umbrales en hr/km restantes). Si no hay datos suficientes devuelve 'gray'.
function clasificarServicio(sp, hrActualEquipo){
  if(!sp)return'gray';
  const num=v=>{const n=parseFloat(String(v||'').replace(/[^\d.,-]/g,'').replace(',','.'));return isFinite(n)?n:null;};
  const est=num(sp.estHrKm);
  const hr=num(hrActualEquipo)??num(sp.ultHrKm);
  if(est==null||hr==null)return'gray';
  const restantes=est-hr;
  // Si ya pasó el estimado → crítico
  if(restantes<=0)return'red';
  // Umbrales por equipo (si están cargados); si no, defaults razonables.
  const rCrit=num(sp.rangoCritica)??50;   // hr restantes para considerarse crítico
  const rInt =num(sp.rangoIntermedia)??150;// hr restantes para amarillo
  if(restantes<=rCrit)return'red';
  if(restantes<=rInt)return'amber';
  return'green';
}

async function loadTrabajosRegistro(codigo){
  // Cache: PANEL_TRABAJOS ya se descarga en loadAll. Reusar si está.
  let rawRows = window._panelTrabajosRaw;
  if (!rawRows) {
    try{ rawRows = await fetchGvizObj(SHEET_IDS.trabajos_reg,'PANEL_TRABAJOS'); }
    catch(_){ rawRows = []; }
    window._panelTrabajosRaw = rawRows;
  }

  const SINONIMOS={
    codigo:['CODIGO','COD','CODIGO EQUIPO'],
    equipo:['EQUIPO','NOMBRE EQUIPO','DESCRIPCION EQUIPO'],
    fecha :['FECHA TRABAJO','FECHA DE TRABAJO','FECHA'],
    lugar :['LUGAR TRABAJO','LUGAR DE TRABAJO','LUGAR','UBICACION'],
    desc  :['DESCRIPCION TRABAJOS','TRABAJOS REALIZADOS','TRABAJO REALIZADO','DESCRIPCION TRABAJO','DESCRIPCION'],
    tiempo:['TIEMPO TRABAJO','TIEMPO (HR)','TIEMPO TRABAJO (HR)','TIEMPO TRABAJO HR','TIEMPO HR','TIEMPO','HORAS','HS'],
    razon :['RAZON TRABAJO','RAZON DE TRABAJO','RAZON','MOTIVO TRABAJO','MOTIVO'],
  };
  // Remapear cada fila a claves canónicas tolerando variaciones de header
  const rows=rawRows.map(r=>{
    const idx={};
    for(const k of Object.keys(r))idx[normHead(k)]=r[k];
    const get=keys=>{
      for(const k of keys){const v=idx[k];if(v!=null&&String(v).trim()!=='')return String(v).trim();}
      return'';
    };
    return{
      codigo:get(SINONIMOS.codigo),
      equipo:get(SINONIMOS.equipo),
      fecha :get(SINONIMOS.fecha),
      lugar :get(SINONIMOS.lugar),
      desc  :get(SINONIMOS.desc),
      tiempo:get(SINONIMOS.tiempo),
      razon :get(SINONIMOS.razon),
    };
  });

  // Validador endurecido: exige identificador + descripción/fecha en alguna fila
  const tieneSenales=rows.some(r=>(r.codigo||r.equipo)&&(r.desc||r.fecha));
  if(!tieneSenales){window._panelTrabajosTotal=0;return[];}

  window._panelTrabajosTotal=rows.length;
  const codN=normCod(codigo);
  const eqEntry=(window._equiposOrdenados||[]).find(e=>normCod(e.codigo)===codN);
  const nombreN=eqEntry?normCod(eqEntry.nombre):'';

  return rows.filter(r=>{
    const codR=normCod(r.codigo);
    if(codR&&codR===codN)return true;
    // Fallback por nombre cuando CÓDIGO está vacío en la planilla
    if(!codR&&nombreN&&normCod(r.equipo)===nombreN)return true;
    return false;
  });
}

async function precargarHorometros(){
  // El builder aplano los horometros de todas las pestanas de service por mes
  // en SERVICE_EQ (una fila por equipo-mes, en orden Abril->Enero = first-wins,
  // igual que el SERVICE_MESES viejo). Lo cacheamos para que el modal de equipo
  // no tenga que re-leer.
  window._horometros={};
  let rows=[];
  try{ rows=await fetchGvizObj(SNAPSHOT_ID,'SERVICE_EQ'); }catch(_){ rows=[]; }
  window._serviceEqRows=rows;
  for(const r of rows){
    const codN=String(r['CODN']||'').trim();
    if(!codN||window._horometros[codN])continue;   // first-wins por orden de filas
    if(normCod(r['KVCOD']||'')!==codN)continue;      // misma validacion que el fetch viejo
    window._horometros[codN]={
      actual:r['ACTUAL']||null,
      proximo:r['PROXIMO']||null,
      patente:r['SERIE']||null,
      mes:r['MES']||'',rawCod:r['RAWCOD']||codN,
    };
  }
  // Espejo zaranda → trituradora en _horometros. La trituradora (TRT-01) no tiene
  // horómetro propio: corre las mismas horas que la zaranda (ZRN-01).
  if(window._horometros['ZRN01']&&!window._horometros['TRT01']){
    const zrn=window._horometros['ZRN01'];
    window._horometros['TRT01']={actual:zrn.actual,proximo:null,patente:null,mes:zrn.mes,rawCod:'TRT01'};
  }
  renderEquipoIndex();
}
