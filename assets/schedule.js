const integer=(v,max)=>Number.isInteger(v)&&v>=0&&v<=max;
export function scheduleValid(s) {
  return s===undefined || !!s && ['start','duration','travel'].every(k=>s[k]===null||integer(s[k],k==='start'?2879:1440)) && integer(s.buffer,180) && typeof s.fixed==='boolean' && (s.reserved===undefined||typeof s.reserved==='boolean') && ['walking','transit','manual'].includes(s.mode) && typeof s.place==='string' && s.place.length<=500 && (s.from===null||typeof s.from==='string'&&s.from.length<=2200);
}
export function parseTime(text) {
  const match=String(text||'').match(/^(\d{1,2}):(\d{2})$/);
  return match&&+match[1]<24&&+match[2]<60?+match[1]*60 + +match[2]:null;
}
export function clockTime(minutes) {
  if(minutes===null)return '미정';
  const m=((minutes%1440)+1440)%1440;
  return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
}
export function displayTime(minutes) {return minutes===null?'미정':`${minutes>=1440?'다음날 ':''}${clockTime(minutes)}`;}
export function placeOf(card) {
  if(card.schedule)return card.schedule.place;
  try {const url=new URL(card.mapLink);return url.searchParams.get('query')||'';}catch{return '';}
}
export function normalizeSchedule(card) {
  if(card.schedule)return {reserved:false,...card.schedule};
  const text=card.time || (card.kind==='choices'?card.title:'') || '';
  const range=text.trim().match(/^(\d{1,2}:\d{2})(?:\s*[~–—-]\s*(\d{1,2}:\d{2}))?/);
  const start=range?parseTime(range[1]):null,end=range?.[2]?parseTime(range[2]):null;
  const duration=start!==null&&end!==null?(end-start+1440)%1440:null;
  const routeText=(card.transport||[]).map(t=>t.title).join(' ');
  const walk=(card.transport||[]).length===1&&/^🚶/.test(routeText)?routeText.match(/(?:약\s*)?(\d+)(?:\s*[~–-]\s*(\d+))?분/):null;
  return {start,duration,reserved:false,travel:walk?Number(walk[2]||walk[1]):null,buffer:5,
    fixed:start!==null&&(new RegExp(clockTime(start)+'\\s*(예약|지정\\s*입장)').test([card.description,card.menu].join(' '))||/MARATHON START/.test(card.title||'')||/🚆|✈/.test(card.icon||'')&&/출발|도착/.test(card.title||'')),
    mode:/🚶/.test(routeText)?'walking':'transit',place:placeOf(card),from:null};
}
export function routeKey(previous,current) {return JSON.stringify([previous?.id||'',placeOf(previous||{}),current.id,placeOf(current)]);}
export function prepareSchedules(data) {
  for(const lane of data.lanes)lane.items.forEach((item,index)=>{
    if(!item.schedule){item.schedule=normalizeSchedule(item);item.schedule.from=index?routeKey(lane.items[index-1],item):null;}
  });
  return data;
}
export function analyzeLane(lane,{reflow=false}={}) {
  let cursor=null,uncertain=false;
  return lane.items.map((item,index)=>{
    const s=normalizeSchedule(item),previous=lane.items[index-1];
    const stale=index>0&&s.from!==null&&s.from!==routeKey(previous,item);
    const travel=stale?null:s.travel;
    const arrival=index===0?null:cursor!==null&&travel!==null?cursor+travel+s.buffer:null;
    const warnings=[];
    if(stale)warnings.push('순서·장소 변경: 이동시간과 교통 안내 재확인');
    if(index>0&&travel===null)warnings.push('이동시간 입력 필요');
    if(s.duration===null)warnings.push('소요시간 입력 필요');
    if(s.start===null&&(!reflow||arrival===null))warnings.push('시작 시간 입력 필요');
    const start=reflow&&index>0&&!s.fixed&&arrival!==null&&!uncertain?arrival:s.start;
    const gap=arrival!==null&&!uncertain&&start!==null?start-arrival:null;
    const actualStart=start===null?null:arrival===null?start:Math.max(start,arrival);
    if(index>0&&(arrival===null||uncertain))warnings.push('앞 일정 정보 부족: 도착 가능 여부 확인 필요');
    if(index>0&&(arrival===null||uncertain))uncertain=true;
    cursor=actualStart!==null&&s.duration!==null&&!uncertain?actualStart+s.duration:null;
    const end=start!==null&&s.duration!==null?start+s.duration:null;
    if(end!==null&&end>2879)warnings.push('일정이 이틀을 넘어요. 날짜를 나눠 주세요.');
    return {id:item.id,start,end,actualEnd:cursor,arrival,gap,travel,stale,warnings,fixed:s.fixed,duration:s.duration,buffer:s.buffer};
  });
}
export function recalculateLane(lane) {
  const next=structuredClone(lane),rows=analyzeLane(lane,{reflow:true});
  next.items.forEach((item,i)=>{
    item.schedule=normalizeSchedule(item);
    if(rows[i].start!==null&&rows[i].start<=2879) {
      item.schedule.start=rows[i].start;
      item.time=displayTime(rows[i].start)+(item.schedule.duration!==null?'\n~'+displayTime(rows[i].start+item.schedule.duration):'');
    }
  });
  return next;
}
export function reflowAfterEdit(lane,edited) {
  const next=structuredClone(lane),index=next.items.findIndex(item=>item.id===edited.id),notes=[];
  next.items[index]=structuredClone(edited);
  let previous=normalizeSchedule(edited),cursor=previous.start===null||previous.duration===null?null:previous.start+previous.duration,changed=0;
  for(let i=index+1;i<next.items.length;i++) {
    if(cursor===null){notes.push('시작·소요시간이 미정인 구간 이후는 유지했어요.');break;}
    const item=next.items[i],s=normalizeSchedule(item),oldPrevious=normalizeSchedule(lane.items[i-1]);
    const stale=s.from!==null&&s.from!==routeKey(next.items[i-1],item);
    let interval;
    if(!stale&&s.travel!==null)interval=s.travel+s.buffer;
    else {
      notes.push('이동시간 미정 구간은 기존 간격을 유지했어요. 이동시간을 확인해 주세요.');
      if(s.start===null||oldPrevious.start===null||oldPrevious.duration===null)break;
      interval=Math.max(0,s.start-oldPrevious.start-oldPrevious.duration);
    }
    const arrival=cursor+interval,start=s.fixed?s.start:arrival;
    if(start===null)break;
    if(start>2879||(s.duration!==null&&start+s.duration>2879))throw new Error('자동 조정하면 일정이 이틀을 넘어요. 날짜를 나눠 주세요.');
    if(s.fixed&&arrival>start)notes.push(`${item.title}: 고정 시간까지 ${arrival-start}분 부족해요.`);
    if(start!==s.start){
      item.schedule={...s,start};
      item.time=displayTime(start)+(s.duration===null?'':'\n~'+displayTime(start+s.duration));changed++;
    }
    cursor=s.duration===null?null:Math.max(start,arrival)+s.duration;
  }
  return {lane:next,changed,notes:[...new Set(notes)]};
}
export function directionsLink(previous,item) {
  const origin=placeOf(previous||{}),destination=placeOf(item);
  if(!origin||!destination)return '';
  const query=new URLSearchParams({api:'1',origin,destination,travelmode:normalizeSchedule(item).mode==='walking'?'walking':'transit'});
  return 'https://www.google.com/maps/dir/?'+query;
}
export function departureISO(city,lane,minute) {
  const date=lane.label.match(/(\d{1,2})\/(\d{1,2})/);
  if(!date||minute===null)throw new Error('앞 일정의 종료 시간과 날짜를 입력해 주세요.');
  const zone={helsinki:'Europe/Helsinki',berlin:'Europe/Berlin',prague:'Europe/Prague',vienna:'Europe/Vienna',budapest:'Europe/Budapest'}[city];
  if(!zone)throw new Error('도시를 확인해 주세요.');
  const local=Date.UTC(2026,+date[1]-1,+date[2],0,minute);
  let utc=local;
  for(let i=0;i<2;i++){
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(utc)).map(p=>[p.type,p.value]));
    const shown=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
    utc=local-(shown-utc);
  }
  return new Date(utc).toISOString();
}
