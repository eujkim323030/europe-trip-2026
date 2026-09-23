import { createHash, createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { validateItinerary } from '../../assets/itinerary-model.js';
import { lookupRoutes, validRouteRequest } from './routes.mjs';

const COOKIE = 'trip_editor';
const HOURS = 12 * 60 * 60;
const hash = value => createHash('sha256').update(value).digest();
const equal = (a, b) => timingSafeEqual(hash(a), hash(b));
const response = (status, data, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...headers },
});

export function createHandler({store, seeds, pin, secret, routeKey, routeLookup=lookupRoutes, now = () => Date.now(), secure = true}) {
  const configured = () => /^\d{10,}$/.test(pin || '') && (secret || '').length >= 32;
  const sign = value => createHmac('sha256', secret).update(value).digest('base64url');
  function session(request) {
    if (!configured()) return false;
    const token = request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
    if (!token || token.length > 300) return false;
    const [payload, signature] = token.split('.');
    if (!payload || !signature || !equal(signature, sign(payload))) return false;
    try { const value = JSON.parse(Buffer.from(payload,'base64url').toString()); return value.exp > now() && value.exp <= now()+HOURS*1000; } catch { return false; }
  }
  const cookie = (token, age=HOURS) => `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure?'; Secure':''}`;
  async function limit(ip,prefix='auth',maximum=10) {
    const key = prefix+'/'+createHmac('sha256',secret).update(ip || 'unknown').digest('hex');
    for(let i=0;i<5;i++) {
      const old = await store.getWithMetadata(key,{type:'json',consistency:'strong'});
      const state = old?.data.resetAt > now() ? old.data : {count:0,resetAt:now()+15*60*1000};
      if (state.count >= maximum) return false;
      const result = await store.setJSON(key,{count:state.count+1,resetAt:state.resetAt},old?{onlyIfMatch:old.etag}:{onlyIfNew:true});
      if(result.modified) return true;
    }
    return false;
  }
  return async (request, context = {}) => {
    try {
      const url = new URL(request.url);
      const resource = url.pathname.split('/').filter(Boolean).at(-1);
      if (!['GET','POST','PUT','DELETE'].includes(request.method)) return response(405,{error:'지원하지 않는 요청입니다.'});
      if (request.method !== 'GET' && request.headers.get('origin') !== url.origin) return response(403,{error:'같은 사이트에서만 편집할 수 있습니다.'});
      if(resource==='routes') {
        if(request.method==='GET')return response(200,{configured:!!routeKey});
        if(request.method!=='POST')return response(405,{error:'지원하지 않는 요청입니다.'});
        if(!session(request))return response(401,{error:'경로 조회에는 PIN 인증이 필요합니다.'});
        if(!routeKey)return response(503,{error:'자동 교통 조회 연결 전입니다. 실시간 길찾기로 확인한 이동시간을 입력해 주세요.'});
        const raw=await request.text();if(raw.length>3000)return response(400,{error:'장소·날짜를 확인해 주세요.'});
        let body;try{body=JSON.parse(raw);}catch{return response(400,{error:'장소·날짜를 확인해 주세요.'});}
        if(!validRouteRequest(body))return response(400,{error:'장소·날짜를 확인해 주세요.'});
        if(!await limit('site','routes',60))return response(429,{error:'경로 조회는 15분에 60회까지 가능해요. 잠시 뒤 다시 시도해 주세요.'});
        try{return response(200,await routeLookup(body,{key:routeKey}));}catch(e){return response(502,{error:e.message});}
      }
      if (resource === 'session') {
        if(request.method === 'GET') return response(200,{authenticated:session(request),configured:configured()});
        if(request.method === 'DELETE') return response(200,{authenticated:false},{'Set-Cookie':cookie('',0)});
        if(request.method !== 'POST') return response(405,{error:'지원하지 않는 요청입니다.'});
        if(!configured()) return response(503,{error:'편집 PIN 설정을 준비 중입니다. 일정은 볼 수 있어요.'});
        if(!await limit(context.ip)) return response(429,{error:'PIN 시도가 많습니다. 15분 뒤 다시 시도해 주세요.'},{'Retry-After':'900'});
        const raw = await request.text();
        if(raw.length > 1000) return response(400,{error:'PIN을 확인해 주세요.'});
        let body; try { body=JSON.parse(raw); } catch { return response(400,{error:'PIN을 확인해 주세요.'}); }
        if(typeof body.pin !== 'string' || !equal(body.pin,pin)) return response(401,{error:'PIN이 맞지 않습니다.'});
        const payload=Buffer.from(JSON.stringify({exp:now()+HOURS*1000,nonce:randomBytes(16).toString('hex')})).toString('base64url');
        return response(200,{authenticated:true},{'Set-Cookie':cookie(payload+'.'+sign(payload))});
      }
      if(!Object.hasOwn(seeds,resource)) return response(404,{error:'도시를 찾을 수 없습니다.'});
      const key='cities/'+resource;
      if(request.method === 'GET') {
        const current=await store.getWithMetadata(key,{type:'json',consistency:'strong'});
        return response(200,{data:current?.data.data || seeds[resource],revision:current?.etag || null,updatedAt:current?.data.updatedAt || null});
      }
      if(request.method !== 'PUT') return response(405,{error:'지원하지 않는 요청입니다.'});
      if(!session(request)) return response(401,{error:'PIN 인증이 필요합니다. 편집 내용은 유지됩니다.'});
      if(!request.headers.get('content-type')?.includes('application/json')) return response(415,{error:'JSON 요청이 필요합니다.'});
      const raw=await request.text();
      if(Buffer.byteLength(raw)>512000) return response(413,{error:'일정 내용이 너무 큽니다.'});
      let body; try{body=JSON.parse(raw);}catch{return response(400,{error:'일정 형식이 올바르지 않습니다.'});}
      if(!validateItinerary(body.data,seeds[resource]) || !(body.revision === null || (typeof body.revision==='string' && body.revision.length>0 && body.revision.length<200))) return response(400,{error:'일정이나 지도 링크를 확인해 주세요.'});
      const updatedAt = new Date(now()).toISOString();
      const result = await store.setJSON(key,{data:body.data,updatedAt},body.revision === null ? {onlyIfNew:true}:{onlyIfMatch:body.revision});
      if(!result.modified) return response(409,{error:'다른 기기에서 일정이 먼저 변경됐어요. 편집 내용을 복사한 뒤 취소하고 최신 일정을 불러와 주세요.'});
      return response(200,{revision:result.etag,updatedAt});
    } catch {
      return response(503,{error:'공유 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'});
    }
  };
}
