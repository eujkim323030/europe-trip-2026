import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSchedule, analyzeLane, recalculateLane, scheduleValid, routeKey,departureISO,prepareSchedules } from '../assets/schedule.js';
const item=(id,start,duration,travel=0,fixed=false)=>({id,title:id,time:'',mapLink:'',transport:[],schedule:{start,duration,travel,buffer:0,fixed,mode:'walking',place:id,from:null}});
test('legacy ranges are parsed, vague starts and unknown durations remain unknown',()=>{
  assert.equal(normalizeSchedule({time:'10:00\n~11:30',transport:[]}).duration,90);
  assert.equal(normalizeSchedule({time:'완주 후\n~17:30',transport:[]}).start,null);
  assert.equal(normalizeSchedule({time:'10:00',transport:[]}).duration,null);
  assert.equal(normalizeSchedule({time:'23:30 ~00:30',transport:[]}).duration,60);
});
test('gaps include travel and buffer, fixed bookings retain their time',()=>{
  const a=item('a',600,90),b=item('b',720,60,20,true);b.schedule.buffer=5;
  assert.equal(analyzeLane({items:[a,b]})[1].gap,5);
  a.schedule.duration=120;
  const lane=recalculateLane({items:[a,b]});
  assert.equal(lane.items[1].schedule.start,720);
  assert.equal(analyzeLane(lane)[1].gap,-25);
});
test('late arrival propagates without pretending a fixed appointment was reached on time',()=>{
  const lane=recalculateLane({items:[item('a',600,120),item('b',660,30,10,true),item('c',800,20,10)]});
  assert.equal(lane.items[1].schedule.start,660);
  assert.equal(lane.items[2].schedule.start,770);
});
test('unknown travel does not silently move later cards or promise free time',()=>{
  const lane={items:[item('a',600,60),item('b',720,30,null),item('c',800,20,10)]};
  assert.equal(analyzeLane(lane)[1].gap,null);
  assert.equal(recalculateLane(lane).items[2].schedule.start,800);
});
test('reflow changes flexible starts and handles midnight without mutating input',()=>{
  const lane={items:[item('a',1410,60),item('b',1500,30,15)]};
  const result=recalculateLane(lane);
  assert.equal(result.items[1].schedule.start,1485);
  assert.equal(lane.items[1].schedule.start,1500);
});
test('travel estimate becomes unknown after changing its origin',()=>{
  const a=item('a',600,30),b=item('b',650,30,10);b.schedule.from=routeKey(a,b);
  assert.equal(analyzeLane({items:[a,b]})[1].gap,10);
  a.schedule.place='another address';
  assert.equal(analyzeLane({items:[a,b]})[1].gap,null);
});
test('invalid schedule fields are rejected, legacy absence remains valid',()=>{
  assert.ok(scheduleValid(undefined));assert.ok(scheduleValid(item('a',600,60).schedule));
  for(const patch of [{duration:-1},{travel:'20'},{start:9999},{fixed:'yes'},{buffer:1.5}])assert.equal(scheduleValid({...item('a',600,60).schedule,...patch}),false);
});
test('only own reservation time is locked, not a mention of another booking',()=>{
  assert.equal(normalizeSchedule({time:'18:10 ~20:50',title:'Albertina',description:'피그뮐러 예약이 늦어져 여유롭게 관람.',transport:[]}).fixed,false);
  assert.equal(normalizeSchedule({time:'13:30 ~17:00',title:'Schönbrunn',menu:'13:30 지정 입장 기준',transport:[]}).fixed,true);
});
test('route departure uses city timezones, not the phone timezone, including midnight',()=>{
  assert.equal(departureISO('vienna',{label:'DAY 1 · 9/30 (수)'},600),'2026-09-30T08:00:00.000Z');
  assert.equal(departureISO('helsinki',{label:'DAY 1 · 9/24 (목)'},600),'2026-09-24T07:00:00.000Z');
  assert.equal(departureISO('vienna',{label:'DAY 1 · 9/30 (수)'},1470),'2026-09-30T22:30:00.000Z');
});
test('legacy migration adds metadata without changing text or existing explicit settings',()=>{
  const card={id:'a',title:'Museum',time:'10:00\n~11:30',transport:[],mapLink:''};
  const data=prepareSchedules({lanes:[{items:[card]}]});assert.equal(card.time,'10:00\n~11:30');
  card.schedule.duration=40;prepareSchedules(data);assert.equal(card.schedule.duration,40);
});
test('fixed time does not erase uncertainty about reaching the reservation',()=>{
  const lane={items:[item('a',600,60),item('b',720,30,null,true),item('c',800,20,10)]};
  assert.equal(analyzeLane(lane)[2].gap,null);
  assert.equal(recalculateLane(lane).items[2].schedule.start,800);
});
test('reservation is explicit, independent of fixed time, and survives recalculation',()=>{
  const a=item('a',600,60);a.schedule.reserved=true;
  assert.equal(recalculateLane({items:[a]}).items[0].schedule.reserved,true);
  assert.equal(a.schedule.fixed,false);
  assert.equal(scheduleValid({...a.schedule,reserved:'yes'}),false);
  assert.equal(normalizeSchedule({time:'10:00',description:'예약',transport:[]}).reserved,false);
});
