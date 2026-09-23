import { extractItinerary, moveItem, FIELDS, CATEGORIES, safeLink } from './itinerary-model.js';
import {prepareSchedules,analyzeLane,recalculateLane,normalizeSchedule,displayTime,departureISO,placeOf,routeKey} from './schedule.js';
import {scheduleFields,scheduleBadge,daySummary} from './schedule-ui.js';

const city = location.pathname.split('/').filter(Boolean)[0];
const {data:initial,templates} = extractItinerary(document,city);
const baseline = new Map(initial.lanes.flatMap(l=>l.items).map(i=>[i.id,i]));
const baselineOrigins=new Map(initial.lanes.flatMap(l=>l.items.map((item,i)=>[item.id,l.items[i-1]?.id||null])));
const lanes = new Map(Array.from(document.querySelectorAll('.timeline')).map(el=>[el.dataset.lane,el]));
let saved=structuredClone(initial), draft=null, revision=null, ready=false, busy=false, dirty=false, authenticated=false;
const toolbar=document.createElement('section');
toolbar.className='editor-toolbar'; toolbar.setAttribute('aria-label','공유 일정 편집');
document.querySelector('.hero').after(toolbar);
const status=document.createElement('p'); status.className='editor-status'; status.setAttribute('role','status');
toolbar.after(status);
const modal=document.createElement('dialog'); modal.className='editor-dialog'; document.body.append(modal);
let modalResolve=null;
modal.addEventListener('cancel',()=>{modalResolve?.(null);modalResolve=null;});
function closeDialog() {const resolve=modalResolve;modalResolve=null;modal.close();resolve?.(null);}
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const button=(label,fn,cls='')=>{const b=el('button',cls,label);b.type='button';b.addEventListener('click',fn);return b;};
const message=(text,error=false)=>{status.textContent=text;status.classList.toggle('is-error',error);};
const markDirty=()=>{dirty=true;message('저장하지 않은 변경 사항이 있어요. 저장하면 함께 보는 사람에게 반영됩니다.');};
const data=()=>draft||saved;

async function api(path,options={}) {
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),15000);
  try {
    const r=await fetch('/api/trip/'+path,{...options,signal:controller.signal,cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json',...options.headers}});
    const body=await r.json();
    if(!r.ok) {const e=new Error(body.error||'요청을 처리하지 못했어요.');e.status=r.status;throw e;}
    return body;
  } catch(e) {if(!e.status)throw new Error('연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.');throw e;}
  finally {clearTimeout(timeout);}
}

function actions() {
  toolbar.replaceChildren();
  if(!draft) {
    const edit=button('✏️ 일정 편집',startEdit,'primary');edit.disabled=busy||!ready;toolbar.append(edit);
    toolbar.append(button('새로고침',()=>load(),'quiet'));
  } else {
    for(const [label,fn,cls] of [['💾 저장',save,'primary'],['취소',cancel,'quiet'],['편집 잠그기',lock,'quiet']]) {
      const b=button(label,fn,cls);b.disabled=busy;toolbar.append(b);
    }
    toolbar.append(el('span','editor-hint','☰ 끌어서 순서 변경 · 카드 눌러 수정'));
  }
}

function setLink(element,href) {
  if(href && safeLink(href)) {element.href=href;element.target='_blank';element.rel='noopener noreferrer';}
  else {element.removeAttribute('href');element.removeAttribute('target');}
}

function cardView(card,template,base) {
  let node=template?.cloneNode(true);
  if(!node) {
    node=el('a','event link');
    node.innerHTML='<div class="row"><div class="time"></div><div class="icon"></div><div><div class="title"></div></div><div class="out">↗</div></div>';
  }
  const option=node.classList.contains('choice');
  const content=option?(node.querySelector('a')||node):node.querySelector('.row>div:nth-child(3)');
  const selectors={time:'.time',icon:'.icon',title:'.title,.ctitle,h3',description:'.desc,.cmeta,p',menu:'.menu',cost:'.cost,.ccost'};
  const classes={time:'time',icon:'icon',title:option?'ctitle':'title',description:option?'cmeta':'desc',menu:'menu',cost:'cost'};
  for(const [field,selector] of Object.entries(selectors)) {
    if(base && card[field]===base[field]) continue;
    let target=node.querySelector(selector);
    if(!target && card[field] && classes[field]) {target=el(field==='cost'?'span':'div',classes[field]);content.append(target);}
    if(target)target.textContent=card[field];
  }
  node.classList.remove(...CATEGORIES.filter(Boolean));if(card.category)node.classList.add(card.category);
  if(card.mapLink && !node.matches('a') && !node.querySelector('a')) {
    const anchor=el('a',node.className);anchor.append(...node.childNodes);node=anchor;
  }
  const link=node.matches('a')?node:node.querySelector('a');
  if(link)setLink(link,card.mapLink);
  node.classList.toggle('link',!!card.mapLink);
  return node;
}

function itemView(item,row,previous) {
  const base=baseline.get(item.sourceId);const template=templates.get(item.sourceId);
  const wrapper=el('div','itinerary-item');wrapper.dataset.item=item.id;
  if(row)wrapper.append(scheduleBadge(item,row,previous));
  if(item.transport.length&&item.sourceId&&baselineOrigins.get(item.sourceId)!==(previous?.sourceId||null))wrapper.append(el('p','schedule-late old-route-warning','⚠ 아래 교통 안내는 기존 순서 기준입니다. 현재 순서 길찾기로 확인해 주세요.'));
  for(const route of item.transport) {
    const transport=el('div','transport'+(route.description||route.mapLink?' transit-detail':''));
    const box=el(route.mapLink?'a':'span');if(route.mapLink)setLink(box,route.mapLink);
    if(route.description||route.mapLink) {
      box.append(el('b','',route.title));const small=el('small','',route.description);
      if(route.mapLink)small.append(el('em','','↗ 당일 실시간 경로 열기'));
      box.append(small);
    } else box.textContent=route.title;
    transport.append(box);wrapper.append(transport);
  }
  if(item.kind==='choices') {
    const group=el('div','choice-wrap');group.append(el('div','choice-title',item.title));
    const grid=el('div','choice-grid');
    const originals=template?Array.from(template.querySelectorAll('.choice')):[];
    item.options.forEach((option,i)=>grid.append(cardView(option,originals[i],base?.options[i])));
    group.append(grid);wrapper.append(group);
  } else wrapper.append(cardView(item,template,base));
  if(draft) {
    wrapper.classList.add('editable-item');
    const controls=el('div','card-edit-controls');
    const handle=button('☰',()=>{},'drag-handle');handle.setAttribute('aria-label',item.title+' 순서 끌어서 변경');
    handle.addEventListener('pointerdown',e=>dragStart(e,item.id,handle));
    controls.append(handle,button('수정',()=>editItem(item.id)),button('↑',()=>step(item.id,-1)),button('↓',()=>step(item.id,1)));
    controls.children[2].setAttribute('aria-label',item.title+' 위로 이동');controls.children[3].setAttribute('aria-label',item.title+' 아래로 이동');
    wrapper.prepend(controls);
    wrapper.addEventListener('click',e=>{if(busy)return;if(e.target.closest('.card-edit-controls'))return;e.preventDefault();editItem(item.id);});
  }
  return wrapper;
}

function render() {
  for(const lane of data().lanes) {
    const rows=analyzeLane(lane);
    const container=lanes.get(lane.id);container.replaceChildren(daySummary(lane,!!draft,()=>previewTimes(lane.id),()=>previewRoutes(lane.id)),...lane.items.map((item,i)=>itemView(item,rows[i],lane.items[i-1])));
    if(draft)container.append(button('+ 일정 추가',()=>addItem(lane.id),'add-event'));
  }
  document.body.classList.toggle('is-editing',!!draft);
  if(city==='helsinki') window.showOption(data().selectedOption);
  actions();
}

async function load() {
  if(draft||busy)return;
  busy=true;actions();message('공유 일정을 불러오는 중…');
  try {const result=await api(city);saved=prepareSchedules(result.data);revision=result.revision;ready=true;render();message(result.updatedAt?'공유 일정 · '+new Date(result.updatedAt).toLocaleString('ko-KR')+' 저장':'공유 일정 · 편집 후 저장하면 함께 볼 수 있어요.');}
  catch(e){ready=false;message(e.message+' 현재 화면의 일정은 계속 볼 수 있어요.',true);}
  finally{busy=false;actions();}
}

function formDialog(title) {
  if(modal.open)closeDialog();modal.replaceChildren();
  const form=el('form');form.append(el('h2','',title));
  const error=el('p','form-error');error.setAttribute('role','alert');
  const footer=el('div','dialog-actions');
  modal.append(form);return {form,error,footer};
}
function field(form,label,value,{type='text',multiline=false,max=4000}={}) {
  const wrap=el('label','editor-field');wrap.append(el('span','',label));
  const input=el(multiline?'textarea':'input');if(!multiline)input.type=type;else input.rows=3;
  input.value=value;input.maxLength=max;wrap.append(input);form.append(wrap);return input;
}
function selector(form,label,value,entries) {
  const wrap=el('label','editor-field');wrap.append(el('span','',label));const select=el('select');
  for(const [v,text] of entries){const o=el('option','',text);o.value=v;select.append(o);}select.value=value;wrap.append(select);form.append(wrap);return select;
}
function ask(title,text,confirmLabel='확인') {
  const {form,footer}=formDialog(title);form.append(el('p','',text));
  return new Promise(resolve=>{
    modalResolve=resolve;footer.append(button('돌아가기',closeDialog),button(confirmLabel,()=>{modalResolve=null;modal.close();resolve(true);},'primary'));
    form.append(footer);form.addEventListener('submit',e=>e.preventDefault());modal.showModal();
  });
}

async function login() {
  const state=await api('session');if(state.authenticated){authenticated=true;return true;}
  const {form,error,footer}=formDialog('편집 PIN');
  form.append(el('p','','PIN을 아는 사람만 일정을 변경할 수 있어요.'));
  const input=field(form,'PIN','',{type:'password',max:40});input.inputMode='numeric';input.autocomplete='current-password';input.required=true;
  const submit=el('button','primary','편집 시작');submit.type='submit';footer.append(button('취소',closeDialog),submit);form.append(error,footer);
  return new Promise(resolve=>{
    modalResolve=resolve;
    form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;error.textContent='';
      try{await api('session',{method:'POST',body:JSON.stringify({pin:input.value})});input.value='';authenticated=true;modalResolve=null;modal.close();resolve(true);}
      catch(err){error.textContent=err.message;}finally{submit.disabled=false;}
    });modal.showModal();input.focus();
  });
}
async function startEdit() {
  if(busy||!ready)return;
  busy=true;actions();
  try{if(!await login())return;const current=await api(city);saved=prepareSchedules(current.data);revision=current.revision;draft=structuredClone(saved);dirty=false;render();message('소요·이동시간을 입력하면 여유와 부족 시간을 보여드려요. 시간 다시 계산 → 확인 → 저장으로 공유하세요.');}
  catch(e){message(e.message,true);}finally{busy=false;actions();}
}
async function save() {
  if(busy||!draft)return;busy=true;actions();message('공유 일정 저장 중…');
  try{
    if(!authenticated && !await login())return;
    const snapshot=structuredClone(draft);
    const result=await api(city,{method:'PUT',body:JSON.stringify({data:snapshot,revision})});
    revision=result.revision;saved=snapshot;draft=null;dirty=false;render();
    message('저장 완료! 다른 기기에서 새로고침하면 같은 일정이 보여요.');
  }catch(e){if(e.status===401){authenticated=false;message(e.message+' 저장을 다시 누르면 PIN을 입력할 수 있어요.',true);}else message(e.message,true);}
  finally{busy=false;actions();}
}
async function cancel() {
  if(busy)return;if(dirty && !await ask('변경 취소','저장하지 않은 변경 사항을 취소할까요?','변경 취소'))return;
  draft=null;dirty=false;render();await load();
}
async function lock() {
  if(busy)return;if(dirty && !await ask('편집 잠그기','저장하지 않은 변경 사항을 취소하고 편집을 잠글까요?','잠그기'))return;
  try{await api('session',{method:'DELETE'});authenticated=false;draft=null;dirty=false;render();message('편집을 잠갔어요.');}catch(e){message(e.message,true);}
}

function cardFields(form,card,includeTime=true) {
  const fields={};
  if(includeTime)fields.time=field(form,'시간 메모',card.time,{multiline:true,max:80});
  fields.title=field(form,'일정명',card.title,{multiline:true,max:300});fields.title.required=true;
  fields.description=field(form,'메모',card.description,{multiline:true});
  fields.menu=field(form,'메뉴·추가 안내',card.menu,{multiline:true,max:2000});
  fields.cost=field(form,'비용',card.cost,{max:500});
  fields.mapLink=field(form,'지도 링크',card.mapLink,{type:'url',max:2000});
  fields.icon=field(form,'아이콘',card.icon,{max:20});
  fields.category=selector(form,'종류',card.category,[['','관광·이동'],['food','식사·카페'],['rest','휴식'],['shop','쇼핑'],['culture','문화'],['spa','온천'],['night','야경']]);
  return ()=>Object.fromEntries(FIELDS.map(k=>[k,fields[k]?fields[k].value:card[k]]));
}
function blankItem() {return {id:crypto.randomUUID(),sourceId:null,kind:'event',time:'',title:'새 일정',description:'',menu:'',cost:'',icon:'📍',category:'',mapLink:'',transport:[]};}
function addItem(laneId) {if(!busy)editItem(null,laneId);}
function editItem(id,newLaneId) {
  if(!draft||busy)return;
  const lane=draft.lanes.find(l=>l.items.some(i=>i.id===id)) || draft.lanes.find(l=>l.id===newLaneId);
  const original=id?lane.items.find(i=>i.id===id):blankItem();
  const {form,error,footer}=formDialog(id?'일정 수정':'새 일정 추가');
  const destination=selector(form,'날짜·일정안',lane.id,draft.lanes.map(l=>[l.id,l.label]));
  const previous=lane.items[id?lane.items.findIndex(i=>i.id===id)-1:lane.items.length-1];
  const readSchedule=scheduleFields(form,original,previous,{field,selector,lookup:async destinationPlace=>{
    if(!placeOf(previous||{})||!destinationPlace)throw new Error('앞 일정과 현재 일정의 장소명·주소를 먼저 입력해 주세요.');
    const row=analyzeLane(lane).find(r=>r.id===previous.id);
    return api('routes',{method:'POST',body:JSON.stringify({origin:placeOf(previous),destination:destinationPlace,mode:'auto',departureTime:departureISO(city,lane,row?.actualEnd??null)})});
  }});
  let readMain,readOptions=[];
  if(original.kind==='choices') {
    const title=field(form,'선택 일정 제목',original.title,{max:300});
    readMain=()=>({...original,title:title.value});
    original.options.forEach((option,index)=>{const group=el('fieldset');group.append(el('legend','',`선택 ${index+1}`));form.append(group);readOptions.push(cardFields(group,option));});
  } else readMain=cardFields(form,original,false);
  const routes=el('details','transport-fields');routes.append(el('summary','','이 일정으로 오는 교통 안내'));form.append(routes);
  routes.append(el('p','','순서나 날짜를 바꿀 때 함께 이동합니다. 경로가 달라지면 안내도 확인해 주세요.'));
  const readers=[];
  for(const [i,route] of [...original.transport,{title:'',description:'',mapLink:''}].entries()) {
    const group=el('fieldset');group.append(el('legend','',`교통 ${i+1}${i===original.transport.length?' (추가)':''}`));routes.append(group);
    const title=field(group,'교통 요약',route.title,{max:500});
    const description=field(group,'교통 상세',route.description,{multiline:true});
    const mapLink=field(group,'실시간 경로 링크',route.mapLink,{type:'url',max:2000});
    readers.push(()=>({title:title.value,description:description.value,mapLink:mapLink.value}));
  }
  const submit=el('button','primary','적용');submit.type='submit';
  footer.append(button('취소',()=>modal.close()),submit);
  if(id)footer.prepend(button('🗑 삭제',async()=>{
    modal.close();if(!await ask('일정 삭제','이 일정과 연결된 교통 안내를 삭제할까요? 저장 전에는 전체 취소로 되돌릴 수 있어요.','삭제'))return;
    lane.items.splice(lane.items.findIndex(i=>i.id===id),1);render();markDirty();
  },'danger'));
  form.append(error,footer);
  form.addEventListener('submit',e=>{
    e.preventDefault();let timing;try{timing=readSchedule();}catch(err){error.textContent=err.message;return;}
    const next={...original,...readMain(),...timing,transport:readers.map(r=>r()).filter(r=>r.title||r.description||r.mapLink)};
    if(readOptions.length)next.options=readOptions.map(r=>r());
    if(!next.title.trim()||![next.mapLink,...next.transport.map(t=>t.mapLink),...(next.options||[]).map(o=>o.mapLink)].every(safeLink)){error.textContent='일정명과 http/https 지도 링크를 확인해 주세요.';return;}
    if(id)lane.items[lane.items.findIndex(i=>i.id===id)]=next;else lane.items.push(next);
    if(destination.value!==lane.id)moveItem(draft,next.id,destination.value);
    modal.close();render();markDirty();
  });modal.showModal();
}

function previewTimes(laneId,prepared=null,routeNote='') {
  if(!draft||busy)return;
  const lane=draft.lanes.find(l=>l.id===laneId),next=recalculateLane(prepared||lane),rows=analyzeLane(next);
  const {form,footer}=formDialog('시간 다시 계산 · 미리보기');
  form.append(el('p','','첫 일정 시작부터 소요·이동·여유시간을 더해요. 🔒 고정 시간은 유지하고, 정보가 부족한 구간은 그대로 둡니다. 적용 후 저장해야 공유돼요.'));
  if(routeNote){form.append(el('p','',routeNote));const attribution=el('span','google-attribution','Google Maps');attribution.setAttribute('translate','no');form.append(attribution);}
  const list=el('div','time-preview');
  lane.items.forEach((item,i)=>{
    const row=el('div','time-preview-row');const before=normalizeSchedule(item).start,after=normalizeSchedule(next.items[i]).start;
    row.append(el('strong','',item.title),el('div','',`${displayTime(before)} → ${displayTime(after)}${rows[i].fixed?' · 🔒 고정':''}`));
    if(i)row.append(el('div','',rows[i].travel===null?'이동시간 미정':`이동 ${rows[i].travel}분 + 여유 ${rows[i].buffer}분`));
    if(rows[i].gap<0)row.append(el('p','schedule-late',`${-rows[i].gap}분 부족 · 도착 예상 ${displayTime(rows[i].arrival)}`));
    if(rows[i].warnings.length)row.append(el('p','schedule-unknown',rows[i].warnings.join(' · ')));
    list.append(row);
  });
  form.append(list);footer.append(button('돌아가기',closeDialog),button('재계산 적용',()=>{
    draft.lanes[draft.lanes.indexOf(lane)]=next;closeDialog();render();markDirty();
  },'primary'));form.append(footer);form.addEventListener('submit',e=>e.preventDefault());modal.showModal();
}

async function previewRoutes(laneId) {
  if(!draft||busy)return;
  busy=true;actions();const lane=structuredClone(draft.lanes.find(l=>l.id===laneId));let checked=0,skipped=0;
  try{
    const configuration=await api('routes');if(!configuration.configured)throw new Error('자동 교통 조회 연결 전입니다. 이동시간을 직접 입력한 뒤 시간 다시 계산을 사용해 주세요.');
    for(let i=1;i<lane.items.length;i++){
      const previous=lane.items[i-1],item=lane.items[i];
      const end=analyzeLane(recalculateLane(lane))[i-1].actualEnd;
      if(!placeOf(previous)||!placeOf(item)||end===null){skipped++;continue;}
      message(`교통 조회 중 ${i}/${lane.items.length-1} · ${item.title}`);
      const result=await api('routes',{method:'POST',body:JSON.stringify({origin:placeOf(previous),destination:placeOf(item),mode:'auto',departureTime:departureISO(city,lane,end)})});
      const best=result.routes[0];item.schedule.travel=best.minutes;item.schedule.mode=best.mode;item.schedule.buffer=Math.max(item.schedule.buffer,5+best.transfers*3);item.schedule.from=routeKey(previous,item);checked++;
    }
    busy=false;previewTimes(laneId,lane,`${checked}구간 조회 · 정보 부족 ${skipped}구간. 빠른 경로를 선택하고 기본 5분 + 환승당 3분의 여유를 확보했어요. 실제 운행은 당일 확인해 주세요.`);
    message('조회 결과를 미리보기에서 확인한 뒤 적용해 주세요.');
  }catch(e){message(e.message+' 현재 편집 내용은 그대로 유지됩니다.',true);}finally{busy=false;actions();}
}

function step(id,delta) {
  if(busy)return;const lane=draft.lanes.find(l=>l.items.some(i=>i.id===id));const i=lane.items.findIndex(v=>v.id===id);
  if(i+delta<0||i+delta>=lane.items.length)return;
  [lane.items[i],lane.items[i+delta]]=[lane.items[i+delta],lane.items[i]];render();markDirty();
  document.querySelector(`[data-item="${id}"] .drag-handle`)?.focus();
}
function dragStart(event,id,handle) {
  if(busy||event.button!==0)return;event.preventDefault();handle.setPointerCapture(event.pointerId);
  const source=handle.closest('.itinerary-item');source.classList.add('dragging');let targetId=null,after=false;
  const move=e=>{
    document.querySelectorAll('.drop-before,.drop-after').forEach(n=>n.classList.remove('drop-before','drop-after'));
    const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('.editable-item');
    if(target && target.dataset.item!==id){targetId=target.dataset.item;after=e.clientY>target.getBoundingClientRect().top+target.offsetHeight/2;target.classList.add(after?'drop-after':'drop-before');}
    else targetId=null;
    if(e.clientY<70)window.scrollBy(0,-24);else if(e.clientY>innerHeight-70)window.scrollBy(0,24);
  };
  const end=e=>{
    handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);
    source.classList.remove('dragging');document.querySelectorAll('.drop-before,.drop-after').forEach(n=>n.classList.remove('drop-before','drop-after'));
    if(e.type==='pointercancel'||!targetId)return;
    const lane=draft.lanes.find(l=>l.items.some(i=>i.id===targetId));const index=lane.items.findIndex(i=>i.id===targetId);
    const before=after?lane.items[index+1]?.id||null:targetId;
    if(moveItem(draft,id,lane.id,before)){render();markDirty();}
  };
  handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
}

if(city==='helsinki') {
  const original=window.showOption;
  window.showOption=option=>{if(busy&&draft&&draft.selectedOption!==option)return;original(option);if(draft&&draft.selectedOption!==option){draft.selectedOption=option;markDirty();}};
}
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('focus',()=>{if(!draft&&!modal.open)load();});
actions();load();
