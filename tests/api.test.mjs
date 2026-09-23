import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../netlify/lib/api.mjs';
import seeds from '../netlify/data/seeds.json' with { type: 'json' };

class MemoryStore {
  map = new Map(); counter = 0;
  async getWithMetadata(key) { return structuredClone(this.map.get(key) || null); }
  async setJSON(key, data, options = {}) {
    const old = this.map.get(key);
    if ((options.onlyIfNew && old) || (options.onlyIfMatch && old?.etag !== options.onlyIfMatch)) return { modified: false };
    const etag = String(++this.counter);
    this.map.set(key, { data: structuredClone(data), etag });
    return { modified: true, etag };
  }
}
const origin = 'https://trip.example';
function setup(extra={}) {
  const store = new MemoryStore();
  const handler = createHandler({ store, seeds, pin: '3141592653', secret: 'a'.repeat(64),...extra });
  const request = (path, method='GET', body, cookie='', otherOrigin=origin) => handler(new Request(origin+'/api/trip/'+path, {
    method, headers: { Origin: otherOrigin, 'Content-Type':'application/json', Cookie:cookie },
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  }), { ip:'127.0.0.1' });
  const login = async () => (await request('session','POST',{pin:'3141592653'})).headers.get('set-cookie').split(';')[0];
  return { store, handler, request, login };
}
test('public reads return defaults, no cache and no credentials', async () => {
  const {request}=setup(); const r=await request('vienna');
  assert.equal(r.status,200); assert.equal(r.headers.get('cache-control'),'no-store');
  const body=await r.json(); assert.deepEqual(body.data,seeds.vienna); assert.equal(body.revision,null);
  assert.ok(!JSON.stringify(body).includes('3141592653'));
});
test('PIN is checked server-side; unauthorized saves and cross-origin login fail', async () => {
  const {request}=setup();
  assert.equal((await request('session','POST',{pin:'wrong'})).status,401);
  assert.equal((await request('vienna','PUT',{data:seeds.vienna,revision:null})).status,401);
  assert.equal((await request('session','POST',{pin:'3141592653'},'','https://evil.example')).status,403);
});
test('authenticated save is visible to independent reader, stale save conflicts', async () => {
  const {request,login}=setup(); const cookie=await login();
  const data=structuredClone(seeds.vienna); data.lanes[0].items[0].title='Shared edit';
  const r=await request('vienna','PUT',{data,revision:null},cookie); assert.equal(r.status,200);
  assert.deepEqual((await (await request('vienna')).json()).data,data);
  assert.equal((await request('vienna','PUT',{data,revision:null},cookie)).status,409);
});
test('concurrent saves from the same revision have only one winner', async () => {
  const {request,login}=setup(); const cookie=await login();
  const results=await Promise.all([1,2].map(()=>request('berlin','PUT',{data:seeds.berlin,revision:null},cookie)));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
});
test('invalid cities, payloads and javascript links cannot be saved', async () => {
  const {request,login}=setup(); const cookie=await login();
  assert.equal((await request('unknown')).status,404);
  const data=structuredClone(seeds.prague); data.lanes[0].items[0].mapLink='javascript:alert(1)';
  assert.equal((await request('prague','PUT',{data,revision:null},cookie)).status,400);
  assert.equal((await request('prague','PUT',{data:{},revision:null},cookie)).status,400);
});
test('missing server credentials disable login, excessive guesses are limited', async () => {
  const {store,request}=setup();
  const handler=createHandler({store,seeds,pin:'',secret:''});
  assert.equal((await handler(new Request(origin+'/api/trip/session',{method:'POST',headers:{Origin:origin},body:'{}'}),{ip:'x'})).status,503);
  for(let i=0;i<10;i++) assert.equal((await request('session','POST',{pin:'bad'})).status,401);
  assert.equal((await request('session','POST',{pin:'bad'})).status,429);
});
test('storage failure is an error, never a successful empty itinerary', async () => {
  const handler=createHandler({store:{getWithMetadata:async()=>{throw new Error('down');}},seeds,pin:'123',secret:'x'});
  assert.equal((await handler(new Request(origin+'/api/trip/vienna'),{})).status,503);
});
test('route API requires authenticated same-origin requests; no key fails closed',async()=>{
  const {request,login}=setup();const input={origin:'A',destination:'B',mode:'auto',departureTime:'2026-09-30T08:00:00Z'};
  assert.equal((await request('routes','POST',input)).status,401);
  assert.equal((await request('routes','POST',input,await login())).status,503);
  assert.equal((await (await request('routes')).json()).configured,false);
});
test('route API limits cost and does not publish the key',async()=>{
  let calls=0;const {request,login}=setup({routeKey:'private-key',routeLookup:async()=>{calls++;return {routes:[]};}});
  const cookie=await login(),input={origin:'A',destination:'B',mode:'walking',departureTime:'2026-09-30T08:00:00Z'};
  assert.equal((await request('routes','POST',{},cookie)).status,400);
  assert.equal((await request('routes','POST',input,cookie,'https://evil.example')).status,403);
  for(let i=0;i<60;i++)assert.equal((await request('routes','POST',input,cookie)).status,200);
  assert.equal((await request('routes','POST',input,cookie)).status,429);assert.equal(calls,60);
  assert.ok(!(await (await request('routes')).text()).includes('private-key'));
});
test('invalid new schedule fields cannot enter shared storage',async()=>{
  const {request,login}=setup(),data=structuredClone(seeds.vienna);
  data.lanes[0].items[0].schedule={start:600,duration:-20,travel:null,buffer:5,fixed:false,place:'Vienna',mode:'walking',from:null};
  assert.equal((await request('vienna','PUT',{data,revision:null},await login())).status,400);
});
