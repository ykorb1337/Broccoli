'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync('web/notifications.js','utf8');
function fixture(native=true){
 const listeners={},input={id:'notifications-toggle',checked:false,disabled:false},calendarInput={id:'calendar-notifications-toggle',checked:false,disabled:false},minutesInput={id:'calendar-reminder-minutes',value:'10'},calls=[],posts=[],messages=[];
 const nodes={'#notifications-toggle':input,'#calendar-notifications-toggle':calendarInput,'#calendar-reminder-minutes':minutesInput};
 const c={state:{settings:{notifications:true,calendar_notifications:false,calendar_reminder_minutes:[10]},enforcement:{enabled:native}},document:{querySelector:selector=>nodes[selector],addEventListener:(name,fn)=>listeners[name]=fn},setTimeout,clearTimeout,toast:m=>messages.push(m),api:async(path,value)=>{calls.push(value);Object.assign(c.state.settings,value);}};
 c.window={HotTurkeyNativeShell:native,addEventListener(){},refresh:async()=>{}};
 if(native)c.window.webkit={messageHandlers:{native:{postMessage:body=>posts.push(body)}}};
 vm.createContext(c);vm.runInContext(source,c);const controller=c.window.HotTurkeyNotifications;
 const answer=granted=>{const request=posts.shift();assert(request);controller.receive({request:request.request,granted});return request;};
 return {c,input,calendarInput,minutesInput,calls,posts,messages,controller,answer,change:enabled=>{input.checked=enabled;listeners.change({target:input});},calendar:enabled=>{calendarInput.checked=enabled;listeners.change({target:calendarInput});},minutes:async value=>{minutesInput.value=value;await listeners.change({target:minutesInput});},tick:()=>new Promise(resolve=>setImmediate(resolve))};
}
(async()=>{
 let f=fixture();let mounted=f.controller.mount();assert.equal(f.answer(false).mode,'status');await mounted;assert(!f.input.checked);
 f.change(true);assert(f.input.disabled);assert.equal(f.answer(false).mode,'request');await f.tick();assert.equal(f.calls.length,0);assert(!f.input.checked);assert(f.messages[0].includes('系统设置'));
 f.change(true);f.answer(true);await f.tick();assert.equal(f.calls[0].notifications,true);assert(f.input.checked);
 f.change(false);await f.tick();assert.equal(f.calls[1].notifications,false);assert.equal(f.posts.length,0);assert(!f.input.checked);
 f=fixture(false);await f.controller.mount();assert(f.input.checked);f.change(false);await f.tick();assert.equal(f.calls[0].notifications,false);
 f=fixture();mounted=f.controller.mount();f.answer(true);await mounted;f.c.api=async()=>{throw Error('保存失败')};f.change(false);await f.tick();assert(f.input.checked);assert(f.messages.includes('保存失败'));
 f=fixture();mounted=f.controller.mount();f.answer(true);await mounted;f.calendar(true);assert.equal(f.answer(true).mode,'request');await f.tick();assert.equal(f.calls[0].calendar_notifications,true);assert.equal(f.c.state.settings.notifications,true,'calendar toggle must not change rule notifications');assert(f.calendarInput.checked);
 await f.minutes('10, 30，60');assert.deepEqual(Array.from(f.calls.at(-1).calendar_reminder_minutes),[10,30,60]);const count=f.calls.length;await f.minutes('10,,30');assert.equal(f.calls.length,count);assert.equal(f.minutesInput.value,'10,30,60');
 f.change(false);await f.tick();assert(f.calendarInput.disabled);assert.equal(f.c.state.settings.calendar_notifications,true,'master switch retains the calendar preference');
 console.log('Notification permissions, calendar toggle, comma-separated defaults, invalid values, master switch passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
