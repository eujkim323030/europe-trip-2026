export function validRouteRequest(body) {
  return !!body&&['origin','destination'].every(k=>typeof body[k]==='string'&&body[k].trim().length>0&&body[k].length<=500)&&['walking','transit','auto'].includes(body.mode)&&typeof body.departureTime==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(body.departureTime)&&Number.isFinite(Date.parse(body.departureTime));
}
const seconds=value=>typeof value==='string'&&/^\d+(?:\.\d+)?s$/.test(value)?parseFloat(value):null;
export async function lookupRoutes(input,{key,fetcher=fetch}) {
  if(!key)throw new Error('경로 자동 조회는 아직 연결되지 않았어요. 길찾기로 확인한 이동시간을 직접 입력해 주세요.');
  const modes=input.mode==='auto'?['walking','transit']:[input.mode];
  const results=await Promise.allSettled(modes.map(async mode=>{
    const body={origin:{address:input.origin},destination:{address:input.destination},travelMode:mode==='walking'?'WALK':'TRANSIT',languageCode:'ko',units:'METRIC'};
    if(mode==='transit'){body.departureTime=input.departureTime;body.transitPreferences={routingPreference:'FEWER_TRANSFERS'};}
    const result=await fetcher('https://routes.googleapis.com/directions/v2:computeRoutes',{
      method:'POST',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'routes.duration,routes.legs.steps.travelMode,routes.legs.steps.staticDuration,routes.legs.steps.transitDetails'},body:JSON.stringify(body),
    });
    if(!result.ok)throw new Error('경로 서비스 오류');
    const response=await result.json(),route=response.routes?.[0];
    let duration=seconds(route?.duration);if(duration===null)throw new Error('경로 없음');
    const steps=(route.legs||[]).flatMap(l=>l.steps||[]),transit=steps.filter(s=>s.transitDetails);
    if(mode==='transit'&&transit.length){
      const last=steps.findLastIndex(s=>s.transitDetails);
      const arrival=Date.parse(steps[last].transitDetails.stopDetails?.arrivalTime);
      const tail=steps.slice(last+1).reduce((n,s)=>n+(seconds(s.staticDuration)||0),0);
      if(Number.isFinite(arrival))duration=Math.max(duration,(arrival-Date.parse(input.departureTime))/1000+tail);
    }
    const minutes=Math.ceil(duration/60);if(minutes<0||minutes>1440)throw new Error('계산 범위 밖');
    const lines=transit.map(s=>{const t=s.transitDetails;return `${t.transitLine?.nameShort||t.transitLine?.name||'대중교통'} · ${t.stopDetails?.departureStop?.name||''} → ${t.stopDetails?.arrivalStop?.name||''}`;});
    return {mode,minutes,walkingMinutes:Math.ceil(steps.filter(s=>s.travelMode==='WALK').reduce((n,s)=>n+(seconds(s.staticDuration)||0),0)/60),transfers:Math.max(0,transit.length-1),lines};
  }));
  const routes=results.filter(r=>r.status==='fulfilled').map(r=>r.value).sort((a,b)=>a.minutes-b.minutes);
  if(!routes.length)throw new Error('해당 날짜의 경로를 가져오지 못했어요. 장소·날짜를 확인하거나 이동시간을 직접 입력해 주세요.');
  return {routes,partial:routes.length<modes.length,checkedAt:new Date().toISOString()};
}
