'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/tracking-report-ui.js','utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function setup(format='csv',response){
 const definition={sources:['autotags'],group_fields:['level:2'],round_minutes:5,billable:true};
 const report={since:new Date(2026,9,1).getTime()/1000,until:new Date(2026,9,4).getTime()/1000,definition,errors:[]};
 const model={view:'timesheet',day:'2026-10-29',loading:false,sheetDirty:false,report},marker={value:format},control={disabled:false,isConnected:true};
 const calls=[],downloads=[];let closes=0;
 const modal={open:true,querySelector:()=>control};
 const ctx={console,JSON,Date,Number,String,Promise,Set,Error,model,modal,page:'statistics',state:{authenticated:true},token:'fake',auth:'fake-session',
  document:{querySelector:s=>s==='#mt-export-format'?marker:s==='[data-mt=report-export-submit]'?control:null,querySelectorAll:()=>[],addEventListener:()=>{},documentElement:{classList:{contains:()=>false}},createElement:()=>({click(){downloads.push({name:this.download});}})},
  URL:{createObjectURL:()=> 'blob:fake',revokeObjectURL:()=>{}},requestAnimationFrame:fn=>fn(),setTimeout:()=>{},closeModal:()=>{modal.open=false;closes++;},
  openModal:()=>{},field:()=>'',sheetGroup:()=>'',fetch:async(path,options)=>{calls.push(JSON.parse(options.body));return response?response():{ok:true,blob:async()=>({})};},download:(name,data)=>downloads.push({name,data})};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);
 const ui=ctx.HotTurkeyReportUI.create({model,apiCall:async()=>{},load:async()=>{},render:()=>{},attr:String,button:()=>'',select:()=>'',names:{}});
 return {ctx,ui,model,marker,control,calls,downloads,get closes(){return closes;}};
}
(async()=>{
 const csv=setup();await csv.ui.action('report-export-submit',{});assert.deepEqual(csv.calls[0],{kind:'timesheet',since:csv.model.report.since,until:csv.model.report.until,definition:csv.model.report.definition,format:'csv'});assert.equal(csv.downloads[0].name,'HotTurkey-2026-10-01_2026-10-03-timesheet.csv');
 const json=setup('json');await json.ui.action('report-export-submit',{});assert.equal(json.downloads[0].data,json.model.report);assert.equal(json.downloads[0].name,'HotTurkey-2026-10-01_2026-10-03-timesheet.json');
 const dirty=setup();dirty.model.sheetDirty=true;assert.throws(()=>dirty.ui.export(),/未生成/);dirty.model.sheetDirty=false;dirty.model.report.errors=[{}];assert.throws(()=>dirty.ui.export(),/计算错误/);
 const pending=deferred(),locked=setup('xlsx',()=>pending.promise),call=locked.ui.action('report-export-submit',{});assert(locked.control.disabled);locked.ctx.state.authenticated=false;pending.resolve({ok:true,blob:async()=>({})});await call;assert.equal(locked.downloads.length,0);assert.equal(locked.closes,0);
 const cancelledResponse=deferred(),cancelled=setup('csv',()=>cancelledResponse.promise),old=cancelled.ui.action('report-export-submit',{});cancelled.ctx.modal.open=false;cancelledResponse.resolve({ok:false,json:async()=>({error:'Old error'})});await old;assert.equal(cancelled.downloads.length,0);assert.equal(cancelled.closes,0);
 const blob=deferred(),changed=setup('xlsx',()=>Promise.resolve({ok:true,blob:()=>blob.promise})),inflight=changed.ui.action('report-export-submit',{});await new Promise(r=>setImmediate(r));changed.model.report={...changed.model.report};blob.resolve({});await inflight;assert.equal(changed.downloads.length,0);
 const frozen=setup();frozen.model.report.snapshot='frozen-work';await frozen.ui.action('report-export-submit',{});assert.equal(frozen.calls[0].snapshot,'frozen-work');
 const privateJSON=setup('json');privateJSON.model.report.snapshot='private-nonce';await privateJSON.ui.action('report-export-submit',{});assert(!Object.hasOwn(privateJSON.downloads[0].data,'snapshot'));assert.equal(privateJSON.model.report.snapshot,'private-nonce');
 const usage=setup('json');usage.model.sheetUsage={active:true,loading:false,report:{...usage.model.report,snapshot:'usage-all-pages',items:[{}]}};await usage.ui.action('report-export-submit',{});assert.deepEqual(usage.calls[0],{kind:'timesheet-usage',snapshot:'usage-all-pages',format:'json'});assert(usage.downloads[0].name.endsWith('-timesheet-usage.json'));
 const wait=setup();wait.model.sheetUsage={active:true,loading:true,report:wait.model.report};assert.throws(()=>wait.ui.export(),/明细更新/);await wait.ui.action('report-export-submit',{});assert.equal(wait.calls.length,0);
 const late=deferred(),scope=setup('csv',()=>late.promise);scope.model.sheetUsage={active:true,loading:false,report:{...scope.model.report,snapshot:'old-scope'}};const oldScope=scope.ui.action('report-export-submit',{});scope.model.sheetUsage.report={...scope.model.sheetUsage.report,snapshot:'new-scope'};late.resolve({ok:true,blob:async()=>({})});await oldScope;assert.equal(scope.downloads.length,0);assert.equal(scope.closes,0);
 console.log('11 export snapshot, pagination, filename, cancellation and authentication checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
