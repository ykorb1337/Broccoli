'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/app.js','utf8'),handlers={},opened=[],writes=[],messages=[];let paints=0,hit;
const scope={contains:el=>el===col||el===other},preview=()=>({style:{},classList:{toggle(){},remove(){}},remove(){}});
const makeCol=day=>({dataset:{day:String(day)},getBoundingClientRect:()=>({top:0,height:720}),closest(selector){return selector==='.editor-weekly'?scope:selector==='.day-column'?this:null;},setPointerCapture(){},appendChild(){}});
const col=makeCol(0),other=makeCol(1);hit=col;
const ctx={Date,structuredClone,setTimeout:()=>{},state:{blocks:[]},editor:{id:'draft',locked:false,schedule:[]},modal:{open:true},drag:null,movedCalendar:false,
 canManage:()=>true,collectEditor(){},clone:structuredClone,renderEditor:()=>paints++,renderCalendar:()=>{},refresh:async()=>{},toast:msg=>messages.push(msg),hm:String,
 intervalModal:(...args)=>opened.push(args),$$:()=>[],$:selector=>selector==='.editor-weekly'?scope:null,
 api:async(...args)=>writes.push(args),document:{addEventListener:(key,fn)=>handlers[key]=fn,elementFromPoint:()=>hit,createElement:preview}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('web/calendar.js','utf8'),ctx);
vm.runInContext(source.slice(source.indexOf('function calendarY('),source.indexOf('async function loadResources(')),ctx);
const down=(target,y)=>handlers.pointerdown({button:0,target,clientY:y,pointerId:1}),move=y=>handlers.pointermove({clientY:y,clientX:1});
(async()=>{
 down(col,270);move(510);await handlers.pointerup();assert.deepEqual([...opened[0]],[null,0,540,1020]);assert.equal(writes.length,0);assert.equal(ctx.editor.schedule.length,0);
 down(col,510);move(270);await handlers.pointerup();assert.deepEqual([...opened[1]],[null,0,540,1020]);
 ctx.editor.schedule=[{days:[0,2],start:540,end:600,break:{type:'delay',delay_minutes:2}}];
 const event={setPointerCapture(){this.captured=true;},dataset:{index:'0',originDay:'0'},classList:{toggle(){},remove(){}},closest:selector=>selector==='.day-column'?col:selector==='.calendar-event'?event:null};
 down(event,280);assert.equal(event.captured,true);await handlers.pointerup();assert.equal(paints,0);assert.equal(opened.length,2,'a click is handled by the ordinary editor action');
 down(event,280);hit=other;move(340);await handlers.pointerup();assert.equal(paints,1);assert.equal(opened.length,2,'moving does not open a dialog');assert.equal(ctx.editor.schedule[1].start,660);assert.deepEqual([...ctx.editor.schedule[0].days],[2]);assert.deepEqual([...ctx.editor.schedule[1].days],[1]);assert.equal(writes.length,0,'draft moves never save to the installed backend');
 ctx.editor.schedule=[{days:[0],start:540,end:600}];hit=col;down(event,280);move(350);handlers.pointercancel();await handlers.pointerup();assert.equal(ctx.editor.schedule[0].start,540);
 ctx.editor.schedule=[{days:[0],start:540,end:600},{days:[1],start:660,end:720}];const before=JSON.stringify(ctx.editor.schedule);hit=other;down(event,280);move(340);await handlers.pointerup();assert.notEqual(JSON.stringify(ctx.editor.schedule),before);assert.equal(ctx.editor.schedule.length,1);assert.equal(ctx.editor.schedule[0].start,660);assert.equal(ctx.editor.schedule[0].end,720);assert.equal(messages.length,0);
 console.log('Draft creation, reverse drag, click-versus-move, grouped days, cancellation and conflict rollback checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
