import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { CITIES,extractItinerary,moveItem,validateItinerary } from '../assets/itinerary-model.js';

for(const city of CITIES)test(city+': every event, choice and transport survives extraction',async()=>{
  const html=await readFile(`${city}/index.html`,'utf8');const {document}=parseHTML(html);
  const {data}=extractItinerary(document,city);const items=data.lanes.flatMap(l=>l.items);
  assert.equal(items.filter(i=>i.kind==='event').length,document.querySelectorAll('.event').length);
  assert.equal(items.reduce((sum,i)=>sum+(i.options?.length||0),0),document.querySelectorAll('.choice').length);
  assert.equal(items.reduce((sum,i)=>sum+i.transport.length,0),document.querySelectorAll('.transport').length);
  assert.ok(validateItinerary(data,data));
});
test('move preserves the card and its transport, including cross-day and empty destinations',()=>{
  const data={lanes:[{id:'one',items:[{id:'a',transport:[{title:'route'}]},{id:'b'}]},{id:'two',items:[]}]};
  assert.ok(moveItem(data,'a','two'));assert.equal(data.lanes[1].items[0].transport[0].title,'route');
  assert.ok(moveItem(data,'a','one','b'));assert.deepEqual(data.lanes[0].items.map(i=>i.id),['a','b']);
  assert.equal(moveItem(data,'a','one','missing'),false);
});
test('duplicate IDs and invalid lanes are rejected',async()=>{
  const {document}=parseHTML(await readFile('vienna/index.html','utf8'));const {data}=extractItinerary(document,'vienna');const draft=structuredClone(data);
  draft.lanes[0].items.push(draft.lanes[0].items[0]);assert.equal(validateItinerary(draft,data),false);
  const moved=structuredClone(data);moved.lanes[0].id='unknown';assert.equal(validateItinerary(moved,data),false);
});
