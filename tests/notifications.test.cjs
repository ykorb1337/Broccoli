'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync('web/notifications.js','utf8');
function fixture(native=true){
 const listeners={},input={id:'notifications-toggle',checked:false,disabled:false},calls=[],posts=[],messages=[];
 const c={state:{settings:{notifications:true}},document:{querySelector:()=>input,addEventListener:(name,fn)=>listeners[name]=fn},setTimeout,clearTimeout,toast:m=>messages.push(m),api:async(path,value)=>{calls.push(value);c.state.settings.notifications=value.notifications;}};
 c.window={HotTurkeyNativeShell:native,addEventListener(){},refresh:async()=>{}};
 if(native)c.window.webkit={messageHandlers:{native:{postMessage:body=>posts.push(body)}}};
 vm.createContext(c);vm.runInContext(source,c);const controller=c.window.HotTurkeyNotifications;
 const answer=granted=>{const request=posts.shift();assert(request);controller.receive({request:request.request,granted});return request;};
 return {c,input,calls,posts,messages,controller,answer,change:enabled=>{input.checked=enabled;listeners.change({target:input});},tick:()=>new Promise(resolve=>setImmediate(resolve))};
}
(async()=>{
 let f=fixture();let mounted=f.controller.mount();assert.equal(f.answer(false).mode,'status');await mounted;assert(!f.input.checked);
 f.change(true);assert(f.input.disabled);assert.equal(f.answer(false).mode,'request');await f.tick();assert.equal(f.calls.length,0);assert(!f.input.checked);assert(f.messages[0].includes('系统设置'));
 f.change(true);f.answer(true);await f.tick();assert.equal(f.calls[0].notifications,true);assert(f.input.checked);
 f.change(false);await f.tick();assert.equal(f.calls[1].notifications,false);assert.equal(f.posts.length,0);assert(!f.input.checked);
 f=fixture(false);await f.controller.mount();assert(f.input.checked);f.change(false);await f.tick();assert.equal(f.calls[0].notifications,false);
 f=fixture();mounted=f.controller.mount();f.answer(true);await mounted;f.c.api=async()=>{throw Error('保存失败')};f.change(false);await f.tick();assert(f.input.checked);assert(f.messages.includes('保存失败'));
 console.log('6 notification permission, denial, enable, disable, preview and failed-save scenarios passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
