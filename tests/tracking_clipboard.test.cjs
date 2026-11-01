'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(native=false){
 const calls=[],timers=new Map();let n=0;const ctx={Date,Map,Promise,Error,setTimeout:fn=>{timers.set(++n,fn);return n;},clearTimeout:id=>timers.delete(id),navigator:{clipboard:{writeText:async text=>calls.push(text)}}};
 ctx.window=ctx;if(native)ctx.webkit={messageHandlers:{native:{postMessage:value=>calls.push(value)}}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('web/tracking-clipboard.js','utf8'),ctx);return {ctx,calls,timers,ui:ctx.HotTurkeyClipboard};
}
(async()=>{
 const web=setup();assert.equal(await web.ui.write('Selected\t123'),true);assert.equal(web.calls[0],'Selected\t123');assert.equal(await web.ui.write('Private',()=>false),false);assert.equal(web.calls.length,1);
 const native=setup(true),copy=native.ui.write('Rows');assert.equal(native.calls[0].text,'Rows');native.ui.receive({request:native.calls[0].request,ok:true});assert.equal(await copy,true);assert.equal(native.timers.size,0);
 const failed=setup(true),failure=failed.ui.write('Rows');failed.ui.receive({request:failed.calls[0].request,ok:false});await assert.rejects(failure,/复制失败/);
 const timeout=setup(true),pending=timeout.ui.write('Rows');[...timeout.timers.values()][0]();await assert.rejects(pending,/未完成/);timeout.ui.receive({request:timeout.calls[0].request,ok:true});
 const unsupported=setup();unsupported.ctx.navigator.clipboard=null;await assert.rejects(unsupported.ui.write('Rows'),/无法复制/);
 console.log('6 browser/native clipboard acknowledgement, authorization and failure checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
