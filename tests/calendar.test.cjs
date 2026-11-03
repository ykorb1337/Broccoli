'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const c=vm.createContext({Date,structuredClone});vm.runInContext(fs.readFileSync('web/calendar.js','utf8'),c);const calendar=c.HotTurkeyCalendar;
const block=(id,start,end,days=[0])=>({id,name:id,color:'#b95636',mode:'scheduled',locked:false,schedule:[{start,end,days}]});
// Cross-midnight blocks continue into the following day; adjacent events share a lane.
const night=block('night',1380,120);
assert.deepEqual(Array.from(calendar.segments([night],0),v=>[v.start,v.end]),[[1380,1440]]);
assert.deepEqual(Array.from(calendar.segments([night],1),v=>[v.start,v.end]),[[0,120]]);
assert.equal(calendar.segments([night],2).length,0);
const events=calendar.segments([block('a',60,180),block('b',90,120),block('c',120,200),block('d',200,240)],0);
assert.deepEqual(Array.from(events,v=>[v.block.id,v.lane,v.columns]),[['a',0,2],['b',1,2],['c',1,2],['d',0,1]]);
const hm=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
const esc=v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const render=(blocks,extra={})=>calendar.render({blocks,selected:blocks[0]?.id,now:new Date(2026,10,1,12).getTime()/1000,weekStart:'monday',canManage:true,esc,hm,btn:(action,text,attrs)=>`<button data-action="${action}" ${attrs}>${text}</button>`,days:['一','二','三','四','五','六','日'],...extra});
let html=render([block('a',60,180)]).html;
assert(html.includes('height:calc(8.333333333333332% - 2px)'));assert(html.includes('24:00'));assert(html.includes('calendar-now'));
assert(!html.includes('height:60px'));assert.equal((html.match(/class="day-column/g)||[]).length,7);
assert(render([{...night,locked:true}]).html.includes('data-action="calendar-add" disabled'));
assert(!render([night],{canManage:false}).html.includes('data-action="calendar-add"'));
assert(render([{...night,name:'<script>"'}]).html.includes('&lt;script>&quot;'));
const week=calendar.week(new Date(2026,10,1,12).getTime()/1000,'monday');
assert.deepEqual(Array.from(week.dates,v=>[v.month,v.date]),[[10,26],[10,27],[10,28],[10,29],[10,30],[10,31],[11,1]]);
assert.deepEqual(Array.from(calendar.week(new Date(2026,10,1,12).getTime()/1000,'sunday').dates,v=>v.date),[1,2,3,4,5,6,7]);
assert.equal(render([]).selected,'');
console.log('10 calendar midnight, overlap, scale, permission, escaping and week-boundary scenarios passed');

// Main rule filtering and the editor share geometry but have distinct actions.
const pair=[block('only-a',60,180),block('only-b',240,300)];
assert(!render(pair,{selected:'only-a'}).html.includes('data-id="only-b"'));
const all=render(pair,{selected:'all'}).html;assert(all.includes('data-id="only-a"'));assert(all.includes('data-id="only-b"'));assert(all.includes('显示所有'));
assert(render(pair,{selected:'only-b'}).html.includes('data-id="only-b"'));assert(!render(pair,{selected:'only-b'}).html.includes('data-id="only-a"'));
const editor=render(pair.slice(0,1),{scope:'editor'}).html;assert(editor.includes('editor-calendar-event'));assert(!editor.includes('id="calendar-block"'));
assert.deepEqual({...calendar.selection(540,1020)},{start:540,end:1020});assert.deepEqual({...calendar.selection(1020,540)},{start:540,end:1020});assert.deepEqual({...calendar.selection(1439,1440)},{start:1425,end:1440});
const grouped=[{id:'same',days:[0,2],start:540,end:600,break:{type:'meal',break_minutes:30}}],before=JSON.stringify(grouped);
const moved=calendar.move(grouped,0,0,1,660);assert.equal(JSON.stringify(grouped),before);assert.deepEqual([...moved[0].days],[2]);assert.deepEqual([...moved[1].days],[1]);assert.equal(moved[1].start,660);assert.equal(moved[1].end,720);assert.equal(moved[1].break.type,'meal');assert(!('id' in moved[1]));
const mergedNight=calendar.replace([{days:[6],start:1380,end:120}],null,{days:[0],start:60,end:180});assert.equal(mergedNight.length,1);assert.equal(mergedNight[0].start,1380);assert.equal(mergedNight[0].end,180);assert.deepEqual([...mergedNight[0].days],[6]);
assert.equal(calendar.replace([{days:[0],start:540,end:600}],null,{days:[0],start:600,end:660}).length,2);
const mergedMove=calendar.move([{days:[0],start:540,end:600},{days:[1],start:660,end:720}],0,0,1,675);assert.equal(mergedMove.length,1);assert.equal(mergedMove[0].start,660);assert.equal(mergedMove[0].end,735);
assert.equal(calendar.segments([night],1)[0].originDay,0);
console.log('Selected-rule filtering, draft actions, reverse drag, repeat isolation and weekly overlap checks passed');

const restMerge=calendar.replace([{id:'old',days:[0,2],start:540,end:600,break:{type:'delay',delay_minutes:2}}],null,{days:[0],start:570,end:660,break:{type:'meal',break_minutes:30}});
assert.equal(restMerge.length,2);assert.deepEqual([...restMerge[0].days],[2]);assert.equal(restMerge[0].id,'old');assert.equal(restMerge[1].start,540);assert.equal(restMerge[1].end,660);assert.equal(restMerge[1].break.type,'meal');
const longMerge=calendar.replace([{days:[0],start:1200,end:600}],null,{days:[1],start:480,end:720});calendar.validate(longMerge);assert.equal(calendar.segments([{...block('long',0,1),schedule:longMerge}],1).reduce((n,v)=>n+v.end-v.start,0),720);
console.log('Overlap union, changed-break priority, untouched repeat days and midnight merging passed');
