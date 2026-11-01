'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/tracking-clock.js','utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function value(extra={}){return {id:'clock-one',status:'running',kind:'stopwatch',phase:'work',tags:['Task'],notes:'Notes',billable:true,elapsed:5,remaining:null,cycles:0,events:[],reminder_pending:false,last_template:null,last_break:null,template:{kind:'stopwatch',tags:['Task'],notes:'Notes',billable:true,duration_seconds:1500,work_seconds:1500,break_seconds:300,stop_on_idle:false,from_last:false,remind_seconds:0},...extra};}
function setup(api){
 const elements=new Map(),listeners={},calls=[],dialogs=[],toasts=[],model={shotMode:'idle'};let ui,renders=0,loads=0,server=value({status:'stopped',id:null});
 const ctx={console,Date,Math,JSON,Number,String,Promise,Set,Map,Error,page:'statistics',state:{authenticated:true,tracking:{version:1,available:true}},setInterval:()=>{},
  document:{hidden:false,activeElement:null,querySelector:key=>elements.get(key)||null,querySelectorAll:()=>[],addEventListener:(key,fn)=>(listeners[key]??=[]).push(fn)}};
 function node(value=''){return {value,checked:false,dataset:{},disabled:false,isConnected:true,textContent:'',focus(){ctx.document.activeElement=this;},querySelector:()=>null,contains:()=>false};}
 const modal={open:false};ctx.modal=modal;
 function close(){modal.open=false;elements.delete('#mt-clock-form');ctx.document.activeElement=null;}
 function bar(){
  if(!ui.active()){elements.delete('#mt-clock-bar');return;}
  const html=ui.barHTML(),n=node(),counter=node(),task=node();n.dataset.clockState=html.match(/data-clock-state="([^"]*)"/)[1];n.querySelector=s=>s==='time'?counter:task;
  n.contains=e=>e?.inBar===true;
  Object.defineProperty(n,'outerHTML',{set(){bar();renders++;}});elements.set('#mt-clock-bar',n);
 }
 function render(){renders++;bar();}
 ctx.openModal=(title,body,footer)=>{
  modal.open=true;dialogs.push({title,body,footer});const form=node();form.dataset.phase=body.includes('data-phase="true"')?'true':'false';elements.set('#mt-clock-form',form);
  for(const id of ['mt-tag-text','mt-clock-duration','mt-clock-work','mt-clock-break','mt-clock-reminder']){const found=body.match(new RegExp('id="'+id+'"[^>]*value="([^"]*)"'));elements.set('#'+id,node(found?.[1]||''));}
  elements.set('#mt-tag-notes',node(body.match(/id="mt-tag-notes"[^>]*>([^<]*)/)[1]));
  elements.set('#mt-clock-kind',node(body.match(/option value="([^"]*)" selected/)?.[1]||''));
  for(const id of ['mt-tag-billable','mt-clock-idle','mt-clock-last']){const n=node();n.checked=new RegExp('id="'+id+'"[^>]* checked').test(body);elements.set('#'+id,n);}
 };
 ctx.closeModal=close;ctx.toast=text=>toasts.push(text);ctx.sheetGroup=(title,body,note='')=>title+body+note;ctx.field=(label,html)=>label+html;
 const header=node();header.dataset.mt='clock-setup';elements.set('[data-mt=clock-setup]',header);elements.set('[data-mt="clock-setup"]',header);
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);
 ui=ctx.HotTurkeyClockUI.create({model,apiCall:(path,data)=>{calls.push({path,data});return api?api(path,data):Promise.resolve(server);},render,load:async()=>{loads++;render();},attr:String,button:(op,label)=>'<button data-mt="'+op+'">'+label+'</button>',tagTools:{tagEntryHTML:()=>'',prepare:()=>{}},length:v=>String(v)});
 return {ctx,ui,model,calls,dialogs,toasts,elements,node,close,setServer:v=>{server=v;},get renders(){return renders;},get loads(){return loads;},dispatch(type,target){for(const fn of listeners[type]||[])fn({target});}};
}
let count=0;async function test(name,fn){await fn();count++;}
const watchdog=setTimeout(()=>{console.error('Clock UI checks timed out');process.exit(1);},10000);
(async()=>{
 await test('Opening setup never starts a clock',async()=>{
  const s=setup();await s.ui.action('clock-setup');assert.equal(s.dialogs[0].title,'开始计时');assert.equal(s.calls.length,1);assert.equal(s.calls[0].path,'clock');
 });
 await test('Countdown setup sends task, notes, billable and numeric seconds',async()=>{
  const s=setup((path,data)=>Promise.resolve(path==='clock'?value({status:'stopped',id:null}):value({kind:data.kind})));await s.ui.action('clock-setup');
  s.elements.get('#mt-tag-text').value='Client, Design';s.elements.get('#mt-tag-notes').value='Keep notes';s.elements.get('#mt-tag-billable').checked=true;s.elements.get('#mt-clock-kind').value='countdown';s.elements.get('#mt-clock-duration').value='2';s.elements.get('#mt-clock-idle').checked=true;
  await s.ui.action('clock-start-submit');const call=s.calls.find(v=>v.path==='clock/start');assert.equal(call.data.duration_seconds,120);assert.equal(call.data.notes,'Keep notes');assert.deepEqual([...call.data.tags],['Client','Design']);assert(call.data.billable&&call.data.stop_on_idle);assert(!s.ctx.modal.open);
 });
 await test('Changing timer kind retains the task draft',async()=>{
  const s=setup();await s.ui.action('clock-setup');s.elements.get('#mt-tag-text').value='Draft task';s.elements.get('#mt-tag-notes').value='Draft notes';s.elements.get('#mt-tag-billable').checked=true;
  const field=s.elements.get('#mt-clock-kind');field.id='mt-clock-kind';field.value='pomodoro';s.dispatch('change',field);assert.equal(s.elements.get('#mt-tag-text').value,'Draft task');assert.equal(s.elements.get('#mt-tag-notes').value,'Draft notes');assert(s.elements.get('#mt-tag-billable').checked);
 });
 await test('A stale poll cannot overwrite paused state',async()=>{
  const old=deferred();let polls=0;const s=setup(path=>path==='clock'?(++polls===1?Promise.resolve(value()):old.promise):Promise.resolve(value({status:'paused'})));
  await s.ui.read();const pending=s.ui.read();await s.ui.action('clock-pause');old.resolve(value({elapsed:100}));await pending;assert.equal(s.model.tagClock.status,'paused');assert.equal(s.model.tagClock.elapsed,5);
 });
 await test('An awaiting phase opens only once and does not replace another editor',async()=>{
  const s=setup();s.setServer(value({kind:'pomodoro',status:'awaiting',cycles:1}));s.ctx.modal.open=true;await s.ui.read();assert.equal(s.dialogs.length,0);s.close();await s.ui.read();assert.equal(s.dialogs.length,1);await s.ui.read();assert.equal(s.dialogs.length,1);
 });
 await test('A pinned screenshot is not interrupted by a phase prompt',async()=>{
  const s=setup();s.setServer(value({kind:'pomodoro',status:'awaiting',cycles:1}));s.model.shotMode='expanded';await s.ui.read();assert.equal(s.dialogs.length,0);s.model.shotMode='idle';await s.ui.read();assert.equal(s.dialogs.length,1);
 });
 await test('Closing a phase sends stop with the current clock identity',async()=>{
  const s=setup(path=>Promise.resolve(value({kind:'pomodoro',status:path==='clock'?'awaiting':'stopped',cycles:1})));await s.ui.read();await s.ui.cancelPhase();const command=s.calls.find(v=>v.path==='clock/command');assert.equal(command.data.action,'stop');assert.equal(command.data.id,'clock-one');assert(!s.ctx.modal.open);
 });
 await test('Closing during a pending phase start queues stop after it',async()=>{
  const d=deferred(),s=setup((path,data)=>path==='clock'?Promise.resolve(value({kind:'pomodoro',status:'awaiting',cycles:1})):data.action==='next-phase'?d.promise:Promise.resolve(value({status:'stopped'})));
  await s.ui.read();const start=s.ui.action('clock-phase-submit');await s.ui.cancelPhase();d.resolve(value({kind:'pomodoro',phase:'break'}));await start;
  assert.deepEqual(s.calls.filter(v=>v.path==='clock/command').map(v=>v.data.action),['next-phase','stop']);assert.equal(s.model.tagClock.status,'stopped');
 });
 await test('Late clock responses cannot restore private data after management lock',async()=>{
  const d=deferred(),s=setup(path=>path==='clock'?Promise.resolve(value()):d.promise);await s.ui.read();const pending=s.ui.action('clock-pause');s.ctx.state.authenticated=false;s.ui.suspend();d.resolve(value({status:'paused'}));await pending;assert.equal(s.model.tagClock,null);assert.equal(s.loads,0);
 });
 await test('Suspending the view never stops the backend clock',async()=>{
  const s=setup();s.setServer(value());await s.ui.read();s.ui.suspend();assert.equal(s.calls.filter(v=>v.path==='clock/command').length,0);assert.equal(s.model.tagClock,null);
 });
 await test('Ordinary tick updates do not replace focused control nodes',async()=>{
  const s=setup();s.setServer(value());await s.ui.read();const first=s.elements.get('#mt-clock-bar'),renders=s.renders;s.setServer(value({elapsed:6}));await s.ui.read();assert.equal(s.elements.get('#mt-clock-bar'),first);assert.equal(s.renders,renders);assert.equal(first.querySelector('time').textContent,'6');
 });
 await test('No clock polling happens while the page or management is hidden',async()=>{
  const s=setup();s.ctx.page='settings';await s.ui.read();s.ctx.page='statistics';s.ctx.state.authenticated=false;await s.ui.read();assert.equal(s.calls.length,0);
 });
 await test('Older backends never receive unsupported clock requests',async()=>{
  const s=setup();delete s.ctx.state.tracking;await s.ui.read();assert.equal(s.calls.length,0);
 });
 clearTimeout(watchdog);console.log(count+' clock setup, phase, focus and privacy checks passed');
})().catch(error=>{clearTimeout(watchdog);console.error(error);process.exitCode=1;});
