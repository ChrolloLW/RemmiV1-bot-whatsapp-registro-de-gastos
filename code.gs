/**********************
 * CONFIGURACIÓN
 **********************/
const CFG = {
  SHEET_DATA: 'remmiV1',
  SHEET_CATS: 'categorias',
  TZ: 'America/Lima',
  CURRENCY: 'S/ ',
  PAYMENT_METHODS: ['yape','plin','tarjeta','transferencia','efectivo'],
};

// Credenciales desde Script Properties
function getMetaConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    VERIFY_TOKEN: props.getProperty('META_VERIFY_TOKEN'),
    PHONE_NUMBER_ID: props.getProperty('META_PHONE_NUMBER_ID'),
    ACCESS_TOKEN: props.getProperty('META_ACCESS_TOKEN'),
  };
}

/**********************
 * WEBHOOK META (VERIFY + RECEIVE)
 **********************/
function doGet(e) {
  const { VERIFY_TOKEN } = getMetaConfig();
  const mode = e.parameter['hub.mode'];
  const token = e.parameter['hub.verify_token'];
  const challenge = e.parameter['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return ContentService.createTextOutput(challenge);
  }
  return ContentService.createTextOutput('Error: token inválido');
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    Logger.log('INCOMING:\n' + JSON.stringify(body, null, 2));

    const change = (((body.entry||[])[0]||{}).changes||[])[0];
    const value  = (change||{}).value || {};
    const msg    = (value.messages||[])[0];
    if (!msg) return ok_('no message');

    const from = msg.from; // número internacional
    const profileName = (((value.contacts||[])[0]||{}).profile||{}).name || '';
    const text = (msg.text && msg.text.body) ? String(msg.text.body).trim() : '';
    if (!text) return ok_('empty text');

    // 0) pending
    if (handlePendingConfirmation(from, text)) return ok_('pending handled');

    // 1) ayuda
    if (/^(hola|ayuda|help|\?)$/i.test(text)) {
      sendHelp(from);
      return ok_('help sent');
    }

    // 2) categorias
    if (/^listar categorias$/i.test(text)) {
      handleListCategories(from);
      return ok_('list sent');
    }

    if (/^agregar categoria\s*:/i.test(text)) {
      handleCreateOrUpdateCategory(from,text);
      return ok_('cat upd');
    }

    // 3) reportes
    if (/^reporte|^copia/i.test(text)) {
      handleReportCommand(from,text);
      return ok_('report ok');
    }

    // 4) gasto
    handleExpenseNatural(from,text,profileName);
    return ok_('ok');

  } catch(err){
    Logger.log('ERR doPost: '+(err.stack||err));
    return ContentService.createTextOutput('err');
  }
}

function ok_(msg){ return ContentService.createTextOutput(msg); }

/**********************
 * AYUDA
 **********************/
function sendHelp(to) {
const cats = getCategoryNamesSorted();
const help =
`👋 Soy Remmi.

Registra gastos en lenguaje natural. **Regla importante**:
> La **palabra inmediatamente ANTES del monto** se toma como *categoría*.
Ejemplo: "ramen comida 35 tarjeta"
- categoría: comida
- monto: 35
- medio: tarjeta
- descripción: ramen

También intento clasificar por palabras clave (semi-inteligente).
Si no detecto categoría, te la pediré.

Comandos:
• reporte → Reporte del mes actual
• reporte octubre / reporte q2 2025 / reporte semestre 2025
• copia octubre → Envío CSV de ese periodo
• listar categorias → Ver categorías actuales
• agregar categoria: nombre | kw1, kw2, ... → Crear o añadir keywords

Categorías actuales:
${cats.map(c => `• ${cap(c)}`).join('\n')}

Ejemplos válidos:
• "pollo comida 20 yape"
• "cine ocio 35 tarjeta"
• "gasolina transporte 50 efectivo"`;

  sendWhatsAppText(to, help);
}

/**********************
 * CATEGORÍAS base + keyword dict
 **********************/
function getCategoriesDict() {
  const sh = SpreadsheetApp.getActive().getSheetByName(CFG.SHEET_CATS);
  const values = sh.getDataRange().getValues().slice(1);
  const dict = {};
  values.forEach(r=>{
    const cat=String(r[0]||'').trim().toLowerCase();
    const raw=String(r[1]||'').toLowerCase();
    const kws=raw?raw.split(',').map(s=>s.trim()).filter(Boolean):[];
    if(cat) dict[cat]=kws;
  });
  return dict;
}
function getCategoryNamesSorted(){
  return Object.keys(getCategoriesDict()).sort((a,b)=>a.localeCompare(b,'es'));
}
function ensureCategoryRow(category){
  const cat=(category||'').trim();
  if(!cat) return;
  const sh=SpreadsheetApp.getActive().getSheetByName(CFG.SHEET_CATS);
  const last=sh.getLastRow();
  const existing=last>=2 ? sh.getRange(2,1,last-1,1).getValues().flat().map(x=>String(x||'').toLowerCase()) : [];
  if(!existing.includes(cat.toLowerCase())){
    sh.appendRow([cat,'']);
  }
}

/**********************
 * PARSEO
 **********************/
function extractAmountNum(text){
  const nums=String(text||'').match(/(\d+[\,\.]?\d*)/g);
  if(!nums||!nums.length) return {amount:NaN,index:-1,match:''};
  const last=nums[nums.length-1];
  const idx=text.lastIndexOf(last);
  return {amount:Number(last.replace(',','.')),index:idx,match:last};
}
function categoryWordBeforeAmount(text,amountIndex){
  if(amountIndex<0) return '';
  const part=text.slice(0,amountIndex).trim();
  const tokens=part.split(/[\s,;:\-]+/).filter(Boolean);
  if(!tokens.length) return '';
  return tokens[tokens.length-1].toLowerCase();
}
function detectPayment(text){
  const t=String(text||'').toLowerCase();
  for(const m of CFG.PAYMENT_METHODS){
    if(t.includes(m)) return m;
  }
  return '';
}

/**********************
 * GASTO
 **********************/
function handleExpenseNatural(from,text,profileName){
  const {amount,index:amountIdx}=extractAmountNum(text);

  // caso: NO HAY monto → NO iniciar registro
  if(isNaN(amount)){
    sendWhatsAppText(from,
`No detecté un monto numérico.

Ejemplos válidos:
• "pollo comida 20 yape"
• "cine ocio 35 tarjeta"
• "gasolina transporte 50 efectivo"

Escribe *ayuda* para ver más instrucciones.`);
    return;
  }

  const medio=detectPayment(text)||'sin_medio';
  const descripcion=text.replace(/\s+\d+[\,\.]?\d*\s*$/,'').trim();

  // categoría vía palabra antes del monto
  let explicitCat='';
  if(amountIdx>=0){
    const raw=categoryWordBeforeAmount(text,amountIdx);
    explicitCat=raw||'';
  }

  const dict=getCategoriesDict();
  let categoria='';

  if(explicitCat && dict[explicitCat]) categoria=explicitCat;
  if(!categoria){
    const guess=classifyByKeywords(descripcion);
    if(guess) categoria=guess;
  }

  if(!categoria){
    const cats=getCategoryNamesSorted();
    setPending(from,{type:'ask_category',desc:descripcion,medio,monto:amount,profileName:profileName||''});
    sendWhatsAppText(from,
`No encontré la categoría para este gasto.

Necesito que me indiques la categoría.
Categorías actuales (A-Z):
${cats.map(c=>`• ${cap(c)}`).join('\n')}

Responde con una sola palabra de categoría.
Si quieres crear una nueva, escríbela directo (se creará).`);
    return;
  }

  registerExpenseRow(categoria,descripcion,medio,amount);

  const saludo=profileName?`Hola, *${profileName}*`:`Hola`;
  sendWhatsAppText(from,
`${saludo} — ¡ya quedó guardado!

Fecha/hora: ${Utilities.formatDate(new Date(),CFG.TZ,'dd/MM/yyyy HH:mm')}
Categoría: ${cap(categoria)}
Descripción: ${descripcion}
Medio de pago: ${medio}
Monto: ${formatSoles(amount)}

Escribe *reporte* para ver tu resumen del mes.`);
}

function registerExpenseRow(categoria,desc,medio,monto){
  const sh=SpreadsheetApp.getActive().getSheetByName(CFG.SHEET_DATA);
  const now=new Date();
  sh.appendRow([now,categoria,desc,medio,Number(monto)||0]);
}

/**********************
 * CONFIRMACIONES PENDIENTES
 **********************/
function setPending(user,obj){
  PropertiesService.getUserProperties().setProperty('PENDING_'+user,JSON.stringify(obj));
}
function getPending(user){
  const r=PropertiesService.getUserProperties().getProperty('PENDING_'+user);
  return r?JSON.parse(r):null;
}
function clearPending(user){
  PropertiesService.getUserProperties().deleteProperty('PENDING_'+user);
}

function handlePendingConfirmation(from,text){
  const pending=getPending(from);
  if(!pending) return false;
  if(pending.type==='ask_category'){
    const cat=text.toLowerCase().trim();
    ensureCategoryRow(cat);
    registerExpenseRow(cat,pending.desc,pending.medio,pending.monto);
    clearPending(from);
    sendWhatsAppText(from,
`Listo ✅
Registré el gasto en categoría: ${cap(cat)}

Si quieres añadir palabras clave (para que detecte mejor esa categoría):
agregar categoria: ${cat} | palabra1, palabra2, ...`);
    return true;
  }
  return false;
}

/**********************
 * CLASIFICACION secundaria keywords base
 **********************/
function classifyByKeywords(desc){
  const t=(desc||'').toLowerCase();

  const heuristics={
    'transporte':['taxi','uber','bus','gasolina','combustible','estacionamiento','peaje','grifo','toll','metro'],
    'comida':['arroz','pollo','menu','almuerzo','cena','desayuno','pizza','hamburguesa','bebida','restaurante','ramen','chifa','ceviche','sushi','kfc','bk','bembos','snack'],
    'regalos':['regalo','detalle','flor','cumple','aniversario','obsequio'],
    'ocio':['cine','netflix','discoteca','bar','club','concierto','parque','museo','spotify','hbo','disney'],
    'salud':['farmacia','medicina','doctor','dentista','clinica','clínica','consulta','vitaminas'],
    'servicios':['luz','agua','internet','alquiler','celular','telefonia','telefonía','recibo','mantenimiento'],
  };

  for(const [cat,kws] of Object.entries(heuristics)){
    if(kws.some(kw=>t.includes(kw))) return cat;
  }
  return '';
}

/**********************
 * REPORTES
 **********************/
function handleReportCommand(from, text) {
  const lower = text.toLowerCase().trim();
  const isCopy = lower.startsWith('copia');
  const { start, end, label } = parsePeriod(lower);
  const { total, byCat, byPay, count, rows } = queryData(start, end);

  if (isCopy) {
    const csvBlob = makeCSV(rows);
    const mediaId = uploadMediaToWhatsApp(csvBlob, `copia_${label}.csv`, 'text/csv');
    sendWhatsAppDocument(from, mediaId, `Copia de gastos ${label}`);
    return;
  }

  const topCat = topEntry(byCat);
  const topPay = topEntry(byPay);

  const summary =
`REPORTE ${label}

• Total: ${formatSoles(total)}
• #Gastos: ${count}
• Categoría con mayor gasto: ${cap(topCat.key || '—')} (${formatSoles(topCat.val || 0)})
• Medio más usado: ${cap(topPay.key || '—')} (${topPay.count || 0} mov.)`;

  sendWhatsAppText(from, summary);

  if (Object.keys(byCat).length >= 1) {
    const png = buildPieChartPNG(byCat, `Gasto por categoría – ${label}`);
    const mediaId = uploadMediaToWhatsApp(png, `torta_${label}.png`, 'image/png');
    sendWhatsAppImage(from, mediaId, `Gasto por categoría – ${label}`);
  }
}

function queryData(start, end) {
  const sh = SpreadsheetApp.getActive().getSheetByName(CFG.SHEET_DATA);
  const values = sh.getDataRange().getValues().slice(1);
  let total = 0, count = 0;
  const byCat = {}, byPay = {};
  const rows = [];

  values.forEach(r => {
    const ts = r[0], cat = String(r[1]||'').toLowerCase();
    const desc = String(r[2]||'');
    const pay  = String(r[3]||'').toLowerCase();
    const amt  = Number(r[4]||0);

    if (!(ts instanceof Date)) return;
    if (ts < start || ts >= end) return;

    total += amt; count++;
    byCat[cat] = (byCat[cat]||0) + amt;
    byPay[pay] = byPay[pay] || {sum:0,count:0};
    byPay[pay].sum += amt; byPay[pay].count++;

    rows.push([ts, cat, desc, pay, amt]);
  });

  return { total, byCat, byPay, count, rows };
}

function topEntry(obj) {
  let bestKey='—', bestVal=0, bestCount=0;
  for (const [k,v] of Object.entries(obj)) {
    let sum,cnt;
    if (typeof v==='object' && v!=null && 'sum' in v) { sum=v.sum; cnt=v.count; }
    else { sum=v; cnt=0; }
    if (sum>bestVal) { bestVal=sum; bestKey=k; bestCount=cnt; }
  }
  return {key:bestKey,val:bestVal,count:bestCount};
}

/**********************
 * GRÁFICO PIE
 **********************/
function buildPieChartPNG(byCat, title) {
  const dataTableBuilder = Charts.newDataTable();
  dataTableBuilder.addColumn(Charts.ColumnType.STRING, 'Categoría');
  dataTableBuilder.addColumn(Charts.ColumnType.NUMBER, 'Monto');
  Object.entries(byCat).forEach(([k,v])=>{
    dataTableBuilder.addRow([cap(k), Number(v||0)]);
  });
  const dataTable = dataTableBuilder.build();
  const chart = Charts.newPieChart()
    .setTitle(title)
    .setDataTable(dataTable)
    .setDimensions(900,600)
    .build();
  return chart.getAs('image/png').setName(slug(title)+'.png');
}

/**********************
 * CSV
 **********************/
function makeCSV(rows) {
  const header=['timestamp','categoria','descripcion','medioPago','monto'];
  const all=[header].concat(rows.map(r=>[
    Utilities.formatDate(r[0],CFG.TZ,'yyyy-MM-dd HH:mm:ss'),
    r[1],r[2],r[3],r[4]
  ]));
  const csv=all.map(a=>a.map(csvEscape).join(',')).join('\n');
  return Utilities.newBlob(csv,'text/csv','copia.csv');
}
function csvEscape(s){
  s=String(s??'');
  if(s.includes('"')||s.includes(',')||s.includes('\n')){
    return `"${s.replace(/"/g,'""')}"`;
  }
  return s;
}

/**********************
 * PERIODOS (mes / trimestre / semestre)
 **********************/
function parsePeriod(text) {
  const now = new Date();
  let y=now.getFullYear();
  let mStart=new Date(y,now.getMonth(),1);
  let mEnd=new Date(y,now.getMonth()+1,1);
  let label=monthLabel(mStart)+' '+y;

  const meses=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  for(let i=0;i<12;i++){
    if(text.includes(meses[i])){
      const yMatch=text.match(/20\d{2}/);
      if(yMatch)y=Number(yMatch[0]);
      mStart=new Date(y,i,1);
      mEnd=new Date(y,i+1,1);
      label=cap(meses[i])+' '+y;
      return {start:mStart,end:mEnd,label};
    }
  }

  const q=text.match(/q([1-4])\s*(20\d{2})?/i);
  if(q){
    const qi=Number(q[1]);
    if(q[2])y=Number(q[2]);
    const m0=(qi-1)*3;
    return {start:new Date(y,m0,1),end:new Date(y,m0+3,1),label:`Q${qi} ${y}`};
  }

  const sem=text.match(/semestre\s*(1|2)?\s*(20\d{2})?/i);
  if(sem){
    let sIdx=Number(sem[1]||(now.getMonth()<6?1:2));
    if(sem[2])y=Number(sem[2]);
    const m0=(sIdx-1)*6;
    return{start:new Date(y,m0,1),end:new Date(y,m0+6,1),label:`Semestre ${sIdx} ${y}`};
  }

  return {start:mStart,end:mEnd,label};
}
function monthLabel(d){
  const m=['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
  return m[d.getMonth()];
}

/**********************
 * ENVÍO WA
 **********************/
function sendWhatsAppText(to,body) {
  const {PHONE_NUMBER_ID,ACCESS_TOKEN}=getMetaConfig();
  const url=`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  const payload={messaging_product:'whatsapp',to,to,type:'text',text:{preview_url:false,body}};
  UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',headers:{Authorization:`Bearer ${ACCESS_TOKEN}`},payload:JSON.stringify(payload),muteHttpExceptions:true});
}
function uploadMediaToWhatsApp(blob,filename,mimetype) {
  const {PHONE_NUMBER_ID,ACCESS_TOKEN}=getMetaConfig();
  const url=`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/media`;
  const form={messaging_product:'whatsapp',file:Utilities.newBlob(blob.getBytes(),mimetype,filename)};
  const res=UrlFetchApp.fetch(url,{method:'post',headers:{Authorization:`Bearer ${ACCESS_TOKEN}`},payload:form,muteHttpExceptions:true});
  const json=JSON.parse(res.getContentText());
  return json.id;
}
function sendWhatsAppImage(to,mediaId,caption) {
  const {PHONE_NUMBER_ID,ACCESS_TOKEN}=getMetaConfig();
  const url=`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  const payload={messaging_product:'whatsapp',to,type:'image',image:{id:mediaId,caption}};
  UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',headers:{Authorization:`Bearer ${ACCESS_TOKEN}`},payload:JSON.stringify(payload),muteHttpExceptions:true});
}
function sendWhatsAppDocument(to,mediaId,caption) {
  const {PHONE_NUMBER_ID,ACCESS_TOKEN}=getMetaConfig();
  const url=`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  const payload={messaging_product:'whatsapp',to,type:'document',document:{id:mediaId,caption}};
  UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',headers:{Authorization:`Bearer ${ACCESS_TOKEN}`},payload:JSON.stringify(payload),muteHttpExceptions:true});
}

/**********************
 * HELPERS
 **********************/
function cap(s){return String(s||'').replace(/\b\w/g,c=>c.toUpperCase());}
function slug(s){return String(s||'').toLowerCase().replace(/[^\w]+/g,'-').replace(/^\-|-\$/g,'');}
function formatSoles(n){return CFG.CURRENCY+Number(n||0).toFixed(2);}

/**********************
 * TESTS
 **********************/
function testPostLocal() {
  const body={entry:[{changes:[{value:{contacts:[{profile:{name:"Manuel"}}],messages:[{from:"51999999999",text:{body:"ramen comida 35 tarjeta"}}]}}]}]};
  doPost({postData:{contents:JSON.stringify(body)}});
}
function testSendMessageDirect() {
  const{PHONE_NUMBER_ID,ACCESS_TOKEN}=getMetaConfig();
  const url=`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  const payload={messaging_product:"whatsapp",to:"51999999999",type:"text",text:{body:"test directo"}};
  const res=UrlFetchApp.fetch(url,{method:"post",contentType:"application/json",headers:{Authorization:`Bearer ${ACCESS_TOKEN}`},payload:JSON.stringify(payload),muteHttpExceptions:false});
  Logger.log(res.getContentText());
}


