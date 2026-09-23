import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupRoutes,validRouteRequest} from '../netlify/lib/routes.mjs';
test('route request requires explicit places, mode and departure timestamp',()=>{
  assert.ok(validRouteRequest({origin:'Vienna Hbf',destination:'Belvedere Vienna',mode:'auto',departureTime:'2026-09-30T12:00:00Z'}));
  assert.equal(validRouteRequest({origin:'',destination:'Vienna',mode:'auto',departureTime:'bad'}),false);
});
test('walking and transit are compared; transit waits and transfers are included',async()=>{
  const calls=[];
  const fetcher=async(url,opt)=>{const body=JSON.parse(opt.body);calls.push(body);return Response.json({routes:body.travelMode==='WALK'?[{duration:'2400s',legs:[]}]:[{duration:'1200s',legs:[{steps:[{travelMode:'WALK',staticDuration:'300s'},{travelMode:'TRANSIT',transitDetails:{stopDetails:{departureTime:'2026-09-30T12:10:00Z',arrivalTime:'2026-09-30T12:25:00Z',departureStop:{name:'Station'},arrivalStop:{name:'Museum'}},transitLine:{nameShort:'D'}}},{travelMode:'WALK',staticDuration:'180s'}]}]}]});};
  const result=await lookupRoutes({origin:'A',destination:'B',mode:'auto',departureTime:'2026-09-30T12:00:00Z'},{key:'test',fetcher});
  assert.equal(calls.length,2);assert.equal(result.routes.find(r=>r.mode==='transit').minutes,28);
  assert.equal(result.routes.find(r=>r.mode==='transit').transfers,0);
});
test('unavailable provider never returns invented travel time',async()=>{
  await assert.rejects(()=>lookupRoutes({origin:'A',destination:'B',mode:'walking',departureTime:'2026-09-30T12:00:00Z'},{key:'x',fetcher:async()=>Response.json({routes:[]})}));
});
