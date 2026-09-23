import {normalizeSchedule,analyzeLane,displayTime,clockTime,parseTime,routeKey,directionsLink,scheduleValid} from './schedule.js';
const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
export function scheduleFields(form,item,previous,{field,selector,lookup,isNew=false}) {
  const s=normalizeSchedule(item),group=el('fieldset','schedule-fields');
  group.append(el('legend','','시간과 이동'));form.append(group);
  group.append(el('p','','도시 현지 시간 기준 · 시작·소요시간을 바꾸고 적용하면 같은 날짜의 뒤 유동 일정이 자동 조정돼요. 고정 시간은 유지해요. 이동시간이 미정이면 기존 간격을 사용하므로 실제 경로를 확인해 주세요.'));
  const start=field(group,'시작 시간',s.start===null?'':clockTime(s.start),{type:'time'});
  const day=selector(group,'시작 날짜',s.start>=1440?'1':'0',[['0','해당 날짜'],['1','다음날 (자정 이후)']]);
  const duration=field(group,'소요시간 (분)',s.duration??'',{type:'number'});duration.min='0';duration.max='1440';duration.step='1';
  const reservationLabel=el('label','reservation-checkbox');
  const reserved=document.createElement('input');reserved.type='checkbox';reserved.checked=s.reserved===true;
  reservationLabel.append(reserved,el('span','','예약 완료'));group.append(reservationLabel);
  group.append(el('p','reservation-help','예약한 일정은 체크해 주세요. 정해진 입장·출발 시간은 아래 시간 고정도 설정해 주세요.'));
  const fixed=selector(group,'예약·기차 등 시간 고정',String(s.fixed),[['false','유동 일정 — 재계산 가능'],['true','🔒 고정 일정 — 시간 유지']]);
  const place=field(group,'장소명·주소 (길찾기용)',s.place,{max:500});
  const mode=selector(group,'이곳으로 오는 이동수단',s.mode,[['walking','도보'],['transit','대중교통'],['manual','직접 입력 / 기타']]);
  const stale=previous&&s.from!==null&&s.from!==routeKey(previous,item);
  const travel=field(group,'앞 일정에서 이동시간 (분)',stale?'':s.travel??'',{type:'number'});travel.min='0';travel.max='1440';travel.step='1';
  let placeRevision=0;
  place.addEventListener('input',()=>{placeRevision++;travel.value='';});
  const buffer=field(group,'이동 여유시간 (분)',s.buffer,{type:'number'});buffer.min='0';buffer.max='180';buffer.step='1';buffer.required=true;
  if(!previous&&!isNew)group.append(el('p','','하루 첫 일정에는 앞 일정 이동시간을 더하지 않아요.'));
  if(isNew)group.append(el('p','','입력한 시작 시간 앞에 있는 일정에서 오는 이동시간이에요. 경로 자동 조회는 추가 후 수정 화면에서 사용할 수 있어요.'));
  if(stale)group.append(el('p','form-error','출발지나 목적지가 바뀌었어요. 이동시간을 다시 확인해 주세요.'));
  const summary=el('p','duration-preview');group.append(summary);
  if(previous&&lookup){
    const fetchButton=el('button','recalculate','도보·대중교통 자동 비교');fetchButton.type='button';
    const resultBox=el('div','route-results');group.append(fetchButton,resultBox);
    place.addEventListener('input',()=>resultBox.replaceChildren(el('p','','장소가 바뀌었어요. 경로를 다시 조회하거나 이동시간을 입력해 주세요.')));
    const policy=el('a','route-policy','경로 조회 이용·개인정보 안내');policy.href='/route-policy.html';policy.target='_blank';policy.rel='noopener';group.append(policy);
    fetchButton.onclick=async()=>{
      const requestRevision=placeRevision;
      fetchButton.disabled=true;resultBox.replaceChildren(el('p','','경로를 조회하고 있어요…'));
      try{
        const result=await lookup(place.value.trim());if(requestRevision!==placeRevision)return;resultBox.replaceChildren();
        resultBox.append(el('p','','선택하면 이동시간을 채웁니다. 운행 변경은 당일 길찾기에서 확인해 주세요.'));
        const attribution=el('span','google-attribution','Google Maps');attribution.setAttribute('translate','no');resultBox.append(attribution);
        for(const route of result.routes){
          const b=el('button','recalculate',`${route.mode==='walking'?'도보':'대중교통'} ${route.minutes}분 · 도보 ${route.walkingMinutes}분 · 환승 ${route.transfers}회`);b.type='button';
          b.onclick=()=>{travel.value=String(route.minutes);mode.value=route.mode;buffer.value=String(Math.max(Number(buffer.value),5+route.transfers*3));resultBox.replaceChildren(el('p','',`${route.minutes}분을 입력했어요. 아래 적용을 눌러주세요.`));};
          resultBox.append(b);if(route.lines.length)resultBox.append(el('p','',route.lines.join(' / ')));
        }
        if(result.partial)resultBox.append(el('p','schedule-unknown','일부 이동수단은 조회되지 않았어요.'));
      }catch(e){resultBox.replaceChildren(el('p','form-error',e.message));}finally{fetchButton.disabled=false;}
    };
  }
  const update=()=>{const t=parseTime(start.value),d=duration.value===''?null:Number(duration.value);summary.textContent=t!==null&&d!==null?`예상 종료 ${displayTime(t+Number(day.value)*1440+d)}`:'시작 시간과 소요시간을 입력하면 종료 시간을 보여드려요.';};
  group.addEventListener('input',update);group.addEventListener('change',update);update();
  return ()=>{
    const t=parseTime(start.value);
    const schedule={start:t===null?null:t+Number(day.value)*1440,duration:duration.value===''?null:Number(duration.value),reserved:reserved.checked,fixed:fixed.value==='true',place:place.value.trim(),mode:mode.value,travel:travel.value===''?null:Number(travel.value),buffer:Number(buffer.value),from:null};
    schedule.from=previous?routeKey(previous,{...item,schedule}):null;
    if(!scheduleValid(schedule)||schedule.fixed&&schedule.start===null)throw new Error('고정 일정에는 시작 시간이 필요하고, 소요·이동시간은 0~1440분, 여유시간은 0~180분이어야 해요.');
    const time=schedule.start!==s.start||schedule.duration!==s.duration ? (schedule.start===null?'':displayTime(schedule.start)+(schedule.duration===null?'':'\n~'+displayTime(schedule.start+schedule.duration))) : item.time;
    return {schedule,time};
  };
}
export function scheduleBadge(item,row,previous) {
  const box=el('div','schedule-badge');
  const parts=[];
  if(item.schedule?.reserved)box.append(el('span','reservation-status','✓ 예약 완료'));
  if(row.fixed)parts.push('🔒 시간 고정');
  parts.push(row.duration===null?'소요시간 미정':`소요 ${row.duration}분`);
  if(row.end!==null)parts.push(`종료 ${displayTime(row.end)}`);
  box.append(el('div','schedule-meta',parts.join(' · ')));
  if(previous){
    box.append(el('div','schedule-meta',row.travel===null?'이동시간 미정':`이동 ${row.travel}분 + 여유 ${row.buffer}분`));
    if(row.gap!==null)box.append(el('div',row.gap<0?'schedule-late':'schedule-gap',row.gap<0?`⚠ ${-row.gap}분 부족 · 도착 예상 ${displayTime(row.arrival)}`:row.gap===0?'여유 0분 · 일정이 바로 이어져요':`여유 ${row.gap}분`));
    else box.append(el('div','schedule-unknown','앞 일정·이동 정보 확인 필요'));
    if(row.stale)box.append(el('div','schedule-late','순서·장소 변경됨 · 아래 기존 교통 안내는 재확인 필요'));
    const href=directionsLink(previous,item);
    if(href){const link=el('a','current-route','↗ 현재 순서로 실시간 길찾기');link.href=href;link.target='_blank';link.rel='noopener noreferrer';link.addEventListener('click',e=>e.stopPropagation());box.append(link);}
  }
  return box;
}
export function daySummary(lane,edit,onRecalculate,onRoutes) {
  const rows=analyzeLane(lane),box=el('section','schedule-summary');box.setAttribute('aria-label',lane.label+' 시간 점검');
  const gaps=rows.filter(r=>r.gap>0).reduce((n,r)=>n+r.gap,0),late=rows.filter(r=>r.gap<0),missing=rows.filter(r=>r.warnings.length);
  box.append(el('strong','','⏱ 하루 시간 점검'));
  box.append(el('p','',`확인된 빈 시간 ${gaps}분 · 부족 ${late.length}곳 · 입력·확인 필요 ${missing.length}곳`));
  if(missing.length)box.append(el('small','','미정인 구간은 합계에서 제외해요. 각 카드의 소요·이동시간을 채워 주세요.'));
  if(edit){const b=el('button','recalculate','시간 다시 계산');b.type='button';b.onclick=onRecalculate;box.append(b);}
  if(edit&&onRoutes){const b=el('button','recalculate','교통 포함 자동 계산');b.type='button';b.onclick=onRoutes;box.append(b);}
  return box;
}
