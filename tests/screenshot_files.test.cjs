'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),messages=[];
const context={window:null,auth:'fixture-session',Date,Map,Promise,Error,webkit:{messageHandlers:{native:{postMessage:v=>messages.push(v)}}}};context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync('web/screenshot-files.js','utf8'),context);
(async()=>{
 const bridge=context.HotTurkeyMediaBridge,first=bridge.request({action:'save-as',id:'a'.repeat(32)});assert.equal(messages[0].op,'tracking-media');assert.equal(messages[0].session,'fixture-session');assert(!messages[0].file);
 bridge.receive({request:messages[0].request,ok:true,cancelled:true});assert.equal((await first).cancelled,true);
 const second=bridge.directory('choose');assert.equal(messages[1].op,'tracking-directory');assert.equal(messages[1].action,'choose');bridge.receive({request:messages[1].request,ok:true,path:'/fixture/HotTurkey Screenshots'});assert.equal((await second).path,'/fixture/HotTurkey Screenshots');
 const denied=bridge.request({action:'reveal',id:'b'.repeat(32)});bridge.receive({request:messages[2].request,ok:false,error:'Locked'});await assert.rejects(denied,/Locked/);
 context.webkit=null;await assert.rejects(bridge.directory('open'),/桌面应用/);
 console.log('4 screenshot native file, cancellation, session and unavailable-bridge checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
