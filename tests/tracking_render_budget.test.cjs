'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let localeCalls=0,nowCalls=0,timelineWrites=0,selectionWrites=0;const frames=[],events={};
class CountDate extends Date{static now(){nowCalls++;return Date.now();}toLocaleDateString(...a){localeCalls++;return super.toLocaleDateString(...a);}toLocaleTimeString(...a){localeCalls++;return super.toLocaleTimeString(...a);}}
const root={innerHTML:'',classList:{add(){}}},timeline={set innerHTML(v){timelineWrites++;}},selection={set innerHTML(v){selectionWrites++;}},plot={dataset:{timeline:'documents'},getBoundingClientRect:()=>({left:0,width:1000}),setPointerCapture(){}};
const document={body:{style:{}},querySelector:s=>s==='#content'?root:s==='.mt-timelines'?timeline:s==='.mt-axis'?plot:s==='.mt-selection-layer'?selection:null,querySelectorAll:()=>[],addEventListener:(n,f)=>(events[n]??=[]).push(f)};
const empty=()=>({handles:()=>false,handlesChange:()=>false,afterRender(){},suspend(){},restore(){},syncQuery(){},resetDay(){},active:()=>false,barHTML:()=>'',read(){},prepare(){}});
const activities=Array.from({length:2000},(_,i)=>({id:'a'+i,timeline:i%2?'documents':'applications',start:i*10,end:i*10+8,seconds:8,title:'Window',application:'Browser',bundle:'browser',group_name:'example.org',url:i%2?'https://example.org/'+i:'',color:'#123456'}));
const data={since:0,until:86400,activities,tag_ranges:[],settings:{enabled:true,paused_until:0,snap_minutes:1},status:{connected:true},totals:{active:16000,selected:0,first:0,last:20000}};
const c={document,Date:CountDate,console,Math,JSON,Number,String,Set,Map,URL,URLSearchParams,Promise,Error,state:{tracking:{version:1},authenticated:true},page:'statistics',modal:{open:false},requestAnimationFrame:f=>{frames.push(f);return frames.length;},setTimeout:()=>0,clearTimeout(){},addEventListener(){},api:async()=>data,HotTurkeyReportUI:{create:empty},HotTurkeyTags:{create:empty},HotTurkeyTimesheetUI:{create:empty},HotTurkeyAutoTagsUI:{create:empty},HotTurkeyClockUI:{create:empty},HotTurkeyMedia:{create:empty}};
c.window=c;vm.createContext(c);for(const p of ['web/tracking-day-data.js','web/tracking.js'])vm.runInContext(fs.readFileSync(p,'utf8'),c);
const dispatch=(n,e)=>{for(const f of events[n]||[])f(e);};
(async()=>{
 await c.HotTurkeyTracking.refresh();frames.length=0;timelineWrites=0;
 const wheel={target:{closest:()=>true},clientX:500,deltaX:0,deltaY:-1,deltaMode:0,preventDefault(){}};
 for(let i=0;i<50;i++)dispatch('wheel',wheel);
 assert.equal(frames.length,1,'wheel bursts draw at most once in the next frame');localeCalls=0;nowCalls=0;frames.shift()();
 assert.equal(timelineWrites,1);assert.equal(localeCalls,0,'a draw must not construct locale formatters per bar');assert(nowCalls<=4,'the visible time bounds are calculated once, not for every bar');
 dispatch('pointerdown',{target:{closest:s=>s==='.mt-track-plot'?plot:null},clientX:100,pointerId:1});
 for(let i=0;i<50;i++)dispatch('pointermove',{clientX:150+i});
 assert.equal(frames.length,1,'drag bursts update the selection at most once per frame');assert.equal(selectionWrites,0);frames.shift()();assert.equal(selectionWrites,1);assert.equal(timelineWrites,1,'dragging does not rebuild the timeline bars');
 dispatch('pointerup',{});assert(c.HotTurkeyTracking.model.selection.length>0);
 console.log('5 bounded wheel/drag redraw, formatter and viewport-calculation checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
