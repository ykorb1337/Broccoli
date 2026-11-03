'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm');
let rootHTML='',rootWrites=0;const handlers={},root={get innerHTML(){return rootHTML;},set innerHTML(value){rootHTML=value;rootWrites++;}},content={innerHTML:''},calls=[],timers=[],modals=[];
let connected=false;const popups=[];
// Keep the rendered week independent of the machine's current date.
const ClockDate=class extends Date {constructor(...args){super(...(args.length?args:['2026-11-01T12:00:00-05:00']));}static now(){return new Date('2026-11-01T12:00:00-05:00').getTime();}};
const calendar={id:'remote@example.com',summary:'Remote',primary:true,accessRole:'owner',backgroundColor:'#336699'};
const fixtureEvent={id:'event',summary:'<unsafe>',start:{dateTime:'2026-11-01T01:30:00-05:00',timeZone:'America/New_York'},end:{dateTime:'2026-11-01T02:30:00-05:00',timeZone:'America/New_York'},etag:'v1',htmlLink:'https://calendar.google.com/calendar/event?eid=fixture',attendees:[{self:true,email:'self@example.com',responseStatus:'accepted'},{email:'guest@example.com'}],description:'<b>Meeting notes</b>',reminders:{useDefault:true}};
let fixtureEvents=[fixtureEvent];const response=path=>path.includes('/status')?{configured:false,connected}:path.includes('/calendars')?{items:[calendar]}:path.includes('/event?')?fixtureEvent:path.includes('/events?')?{items:fixtureEvents,synced_at:1}:{};
const c={Date:ClockDate,Intl,URL,URLSearchParams,Map,Set,page:'schedule',state:{blocks:[{id:'untouched'}]},localStorage:{getItem:()=>null,setItem(){}},document:{querySelector:selector=>selector==='#google-calendar'&&content.innerHTML.includes('id="google-calendar"')?root:null,querySelectorAll:()=>[],addEventListener:(name,fn)=>{(handlers[name]??=[]).push(fn);}},setInterval:fn=>timers.push(fn),setTimeout,clearTimeout,api:async(path,data)=>{calls.push({path,data});if(path.endsWith('/respond')){fixtureEvent.attendees[0].responseStatus=data.response;fixtureEvent.etag='v2';return fixtureEvent;}return response(path);},$:selector=>selector==='#content'?content:root,esc:value=>String(value??'').replace(/</g,'&lt;').replace(/"/g,'&quot;'),btn:()=>'',options:()=>'',field:()=>'',modal:{open:false},closeModal:()=>{},openModal:(...args)=>modals.push(args),toast:()=>{},showModalError:()=>{}};
c.innerHeight=900;c.HotTurkeyGooglePicker={close(){},field(){return '';},zone(){return '';}};c.addEventListener=()=>{};c.window=c;vm.createContext(c);for(const file of ['google-calendar-data.js','google-calendar.js'])vm.runInContext(fs.readFileSync('web/'+file,'utf8'),c);
c.innerWidth=1400;c.document.body={style:{},appendChild(node){popups.push(node);}};
c.document.createElement=()=>({innerHTML:'',style:{},setAttribute(){},remove(){this.removed=true;},contains(target){return target.inDetail;},querySelector(){return {focus(){}};},getBoundingClientRect(){return {width:420,height:500};}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 const before=JSON.stringify(c.state);assert(c.HotTurkeyGoogleCalendar.switcher().includes('拦截日程'));assert(!c.HotTurkeyGoogleCalendar.isSelected());
 c.renderCalendar=()=>c.HotTurkeyGoogleCalendar.render();
 await handlers.click[0]({target:{closest:selector=>selector==='[data-gc-source]'?{dataset:{gcSource:'google'}}:null}});await tick();
 assert(root.innerHTML.includes('导入客户端配置'));assert(!root.innerHTML.includes('新建拦截规则'));
 connected=true;content.innerHTML='';c.HotTurkeyGoogleCalendar.render();await tick();await tick();
 assert(root.innerHTML.includes('Remote'));assert(root.innerHTML.includes('&lt;unsafe>'));assert(!root.innerHTML.includes('<unsafe>'));
 assert(calls.every(call=>call.path.startsWith('google-calendar/')));assert(calls.every(call=>call.data===undefined));assert.equal(JSON.stringify(c.state),before);
 const click=async (action,view,response)=>{await handlers.click[0]({target:{inDetail:['edit-event','respond','detail-original','detail-close'].includes(action),closest:selector=>selector==='[data-gc]'?{dataset:{gc:action,key:'0',view,response},disabled:false,isConnected:false}:null}});await tick();};
 await click('analysis');assert(root.innerHTML.includes('<h3>时间分析</h3>'));await click('analysis-close');assert(!root.innerHTML.includes('<h3>时间分析</h3>'));
 // Hover/focus highlight only touches classes; it must not refetch or rebuild
 // the month, and moving between children of the same row must preserve it.
 const classes=()=>({values:new Set(),toggle(key,on){on?this.values.add(key):this.values.delete(key);}}),scroller={classList:classes()},match={dataset:{gcCategory:'Labs|#0b8043'},classList:classes()},other={dataset:{gcCategory:'Lectures|#4285f4'},classList:classes()},labelRow={dataset:{gcAnalysis:'Labs|#0b8043'},classList:classes(),contains:target=>target?.within===true};
 root.querySelector=selector=>selector==='.gc-scroller'?scroller:null;root.querySelectorAll=selector=>selector==='.gc-event'?[match,other]:[labelRow];
 const highlightWrites=rootWrites,highlightCalls=calls.length,target={closest:()=>labelRow};
 handlers.pointerover[0]({target,relatedTarget:null});assert(scroller.classList.values.has('gc-analysis-highlight'));assert(match.classList.values.has('gc-analysis-match'));assert(!other.classList.values.has('gc-analysis-match'));
 handlers.pointerout[0]({target,relatedTarget:{within:true}});assert(match.classList.values.has('gc-analysis-match'));
 handlers.pointerout[0]({target,relatedTarget:null});assert(!scroller.classList.values.has('gc-analysis-highlight'));assert(!match.classList.values.has('gc-analysis-match'));
 assert.equal(rootWrites,highlightWrites);assert.equal(calls.length,highlightCalls);delete root.querySelector;delete root.querySelectorAll;

 const repeatedCalls=calls.length,repeatedWrites=rootWrites;c.HotTurkeyGoogleCalendar.render();assert.equal(calls.length,repeatedCalls);assert.equal(rootWrites,repeatedWrites,'selecting the current calendar keeps its DOM');
 const reads=calls.length;await click('view','agenda');assert(root.innerHTML.includes('gc-agenda'));assert.equal(calls.length,reads,'same-week view switch reuses the loaded data');const settledWrites=rootWrites;await click('refresh');assert.equal(rootWrites,settledWrites,'unchanged refresh retains the list DOM');assert.equal(calls.filter(x=>x.path.includes('/events?')).at(-1).path.includes('until='),true);
 fixtureEvents=Array.from({length:3},(_,i)=>({...fixtureEvent,id:'all-'+i,start:{date:'2026-11-01'},end:{date:'2026-11-02'}}));await click('refresh');assert(root.innerHTML.includes('rowspan="3"'));assert.equal((root.innerHTML.match(/>全天</g)||[]).length,1,'consecutive all-day events share the clock cell');assert(root.innerHTML.includes('周日'));await click('view','week');assert(!root.innerHTML.includes('all-day-toggle'));assert.equal((root.innerHTML.match(/class="gc-event banner/g)||[]).length,3,'all all-day rows remain visible');await click('view','agenda');fixtureEvents=[fixtureEvent];await click('refresh');
 // Capture the clicked row before removing its parent day popover. Reading
 // the detached row afterwards returns zeros and used to jump to screen center.
 let dayPane,focusReturned=false;root.appendChild=node=>{dayPane=node;};
 const more={dataset:{gc:'day-more',date:'2026-11-01'},disabled:false,isConnected:true,focus(){focusReturned=true;},closest:()=>({getBoundingClientRect:()=>({left:150,width:300,top:300})})};
 await handlers.click[0]({target:{closest:selector=>selector==='[data-gc]'?more:null}});assert(dayPane);
 const row={dataset:{gc:'event',key:'0'},disabled:false,get isConnected(){return !dayPane.removed;},getBoundingClientRect(){return this.isConnected?{left:150,right:400,top:350}:{left:0,right:0,top:0};},closest:()=>null};
 dayPane.contains=target=>target===row;row.closest=selector=>selector==='[data-gc]'?row:null;await handlers.click[0]({target:row});await tick();
 // The event target and the resolved button represent the same contained row.
 assert(dayPane.removed);assert.equal(popups.at(-1).style.left,'412px');assert.equal(popups.at(-1).style.top,'338px');await click('detail-close');assert(focusReturned);delete root.appendChild;
 await click('event');assert.equal(modals.length,0,'clicking an event opens its summary, not the edit form');assert(popups.at(-1).innerHTML.includes('修改事件'));
 await click('respond',undefined,'declined');assert(root.innerHTML.includes('declined'));assert(popups.at(-1).innerHTML.includes('aria-pressed="true"'));const reply=calls.find(x=>x.path.endsWith('/respond'));assert.equal(reply.data.response,'declined');assert(!('email' in reply.data));
 await click('edit-event');assert.equal(modals.at(-1)[0],'事件详情');assert(!modals.at(-1)[1].includes('在 Google 日历中打开'));assert(modals.at(-1)[4].includes('在 Google 日历中打开'),'original link belongs to the heading');
 const form={'gc-title':{value:'<unsafe>'},'gc-start':{value:'2026-11-01T01:30'},'gc-end':{value:'2026-11-01T02:30'},'gc-zone':{value:'America/New_York'},'gc-all-day':{checked:false},'gc-target':{value:calendar.id},'gc-attendees':{value:'self@example.com, guest@example.com'},'gc-location':{value:''},'gc-description':{value:''},'gc-repeat':{value:'none'},'gc-reminder':{value:'default'}};
 c.$=selector=>form[selector.slice(1)]||root;await click('save');const saved=calls.find(call=>call.path.endsWith('/save'));
 assert(saved);assert.equal(saved.data.value.start.dateTime,'2026-11-01T01:30:00-05:00');assert.equal(saved.data.etag,'v2');assert.equal(saved.data.calendar,calendar.id);assert(!('attendees' in saved.data.value));assert.equal(JSON.stringify(c.state),before);
 await click('view','month');const beforeWheel=calls.length;let stopped=0;const wheel={target:{closest:()=>({})},deltaY:1,deltaX:0,deltaMode:0,preventDefault(){stopped++;}};handlers.wheel[0](wheel);await tick();const wheelCall=calls.at(-1);handlers.wheel[0](wheel);await tick();assert.equal(calls.length,beforeWheel+1,'continuous wheel gesture navigates one month');assert.equal(stopped,2);assert(wheelCall.path.includes('since='));
 c.HotTurkeyGoogleCalendar.hide();assert(!root.innerHTML.includes('access_token'));
 let overviewHTML='',overviewWrites=0;const overview={get innerHTML(){return overviewHTML;},set innerHTML(value){overviewHTML=value;overviewWrites++;}};c.page='overview';c.document.querySelector=selector=>selector==='#gc-today'?overview:selector==='#google-calendar'?root:null;c.HotTurkeyGoogleCalendar.mountOverview();await tick();await tick();assert(overview.innerHTML.includes('今日'));const count=calls.length,writes=overviewWrites;for(let i=0;i<10;i++)c.HotTurkeyGoogleCalendar.mountOverview();await tick();assert.equal(calls.length,count,'overview rerenders must reuse the minute cache');assert.equal(overviewWrites,writes,'unchanged today rows must retain their DOM');assert(calls.every(call=>call.path.startsWith('google-calendar/')));
 // The optional future card starts tomorrow, ends after three local days,
 // and renders a multi-day event once instead of once per covered date.
 let futureHTML='';const futureRoot={get innerHTML(){return futureHTML;},set innerHTML(value){futureHTML=value;}};
 c.state.settings={calendar_overview_future:true};c.document.querySelector=selector=>selector==='#gc-today'?overview:selector==='#gc-future'&&c.state.settings.calendar_overview_future?futureRoot:selector==='#google-calendar'?root:null;
 fixtureEvents=[{...fixtureEvent,summary:'Tomorrow fixture',start:{dateTime:'2026-11-02T09:00:00-05:00'},end:{dateTime:'2026-11-02T10:00:00-05:00'}},{...fixtureEvent,id:'span',summary:'Continuous future fixture',start:{date:'2026-11-03'},end:{date:'2026-11-06'}},{...fixtureEvent,id:'outside',summary:'Outside three days',start:{date:'2026-11-05'},end:{date:'2026-11-06'}}];
 c.HotTurkeyGoogleCalendar.mountOverview(true);await tick();await tick();assert(overview.innerHTML.includes('今天没有日程'));assert(futureHTML.includes('未来三天'));assert(futureHTML.includes('Tomorrow fixture'));assert.equal((futureHTML.match(/<b>Continuous future fixture<\/b>/g)||[]).length,1);assert(!futureHTML.includes('Outside three days'));
 const futureRequest=calls.filter(call=>call.path.includes('/events?')).at(-1),futureEnd=new URLSearchParams(futureRequest.path.split('?')[1]).get('until');assert.equal(new Date(futureEnd).getDate(),5);
 c.state.settings.calendar_overview_future=false;c.HotTurkeyGoogleCalendar.mountOverview();await tick();await tick();const todayRequest=calls.filter(call=>call.path.includes('/events?')).at(-1);assert.equal(new Date(new URLSearchParams(todayRequest.path.split('?')[1]).get('until')).getDate(),2,'disabled future card requests today only');
 console.log('7 independent source, configuration, escaped view, read-only startup and DST-preserving save scenarios passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
