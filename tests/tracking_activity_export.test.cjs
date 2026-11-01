'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/tracking-export.js','utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function setup(response){
 const values={'#mt-activity-export-start':{value:'2026-10-30T22:15:01'},'#mt-activity-export-end':{value:'2026-10-31T20:24:44'},'#mt-activity-export-timeline':{value:'documents'},'#mt-activity-export-format':{value:'csv'}};
 const control={disabled:false,isConnected:true},calls=[],downloads=[],shown=[],modal={open:true,querySelector:()=>control},model={view:'day',day:'2026-10-31',timeline:'documents',query:''};
 const ctx={console,Date,Set,Promise,Error,Number,String,JSON,modal,model,page:'statistics',state:{authenticated:true},token:'fixture',auth:'fixture',
 document:{querySelector:s=>s==='[data-mt=activity-export-submit]'?control:values[s]||null,documentElement:{classList:{contains:()=>false}},createElement:()=>({click(){downloads.push(this.download);}})},
 openModal:(title,body,actions,kind)=>shown.push({title,body,actions,kind}),closeModal:()=>modal.open=false,field:(label,html)=>label+html,sheetGroup:(title,html)=>html,
 fetch:async(path,options)=>{calls.push(JSON.parse(options.body));return response?response():{ok:true,blob:async()=>({})};},URL:{createObjectURL:()=> 'blob:local',revokeObjectURL(){}},setTimeout:()=>0,requestAnimationFrame:f=>f()};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);const dateInput=at=>{const d=new Date(at*1000),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;};
 const ui=ctx.HotTurkeyActivityExport.create({model,attr:String,button:(op,label)=>op+label,select:()=>'',names:{documents:'文档'},dateInput});return {ctx,ui,model,values,control,calls,downloads,shown,dateInput};
}
(async()=>{
 const s=setup();s.ui.open();const now=s.dateInput(Date.now()/1000);assert(s.shown[0].body.includes(now.slice(0,10)+'T00:00:00'));assert(s.shown[0].body.includes('step="1"'));assert.equal(s.shown[0].kind,'export');
 await s.ui.action();assert.equal(s.calls[0].definition.since,new Date('2026-10-30T22:15:01').getTime()/1000);assert.equal(s.calls[0].definition.until,new Date('2026-10-31T20:24:44').getTime()/1000);assert(s.downloads[0].includes('2026-10-30_22-15-01_2026-10-31_20-24-44'));
 const invalid=setup();invalid.values['#mt-activity-export-end'].value='2026-10-29T00:00:00';await assert.rejects(invalid.ui.action(),/晚于/);assert.equal(invalid.calls.length,0);
 const d=deferred(),cancel=setup(()=>d.promise),pending=cancel.ui.action();cancel.ctx.modal.open=false;d.resolve({ok:true,blob:async()=>({})});await pending;assert.equal(cancel.downloads.length,0);
 const p=deferred(),lock=setup(()=>p.promise),running=lock.ui.action();lock.ctx.state.authenticated=false;lock.ui.suspend();p.resolve({ok:true,blob:async()=>({})});await running;assert.equal(lock.downloads.length,0);
 console.log('5 activity export default, precision, validation, cancellation and authorization scenarios passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
