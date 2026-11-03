'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/google-calendar.js','utf8');
// Verify identity and attachment, rather than comparing rendered HTML alone.
class Node {
 constructor(key,text=''){this.nodeType=1;this.nodeName='BUTTON';this.attrs=new Map(key?[['data-gc-node',key]]:[]);this.childNodes=[];this.text=text;this.detaches=0;}
 get attributes(){return [...this.attrs].map(([name,value])=>({name,value}));}get lastChild(){return this.childNodes.at(-1);}
 getAttribute(key){return this.attrs.get(key)??null;}hasAttribute(key){return this.attrs.has(key);}setAttribute(key,value){this.attrs.set(key,value);}removeAttribute(key){this.attrs.delete(key);}
 insertBefore(node,reference){if(node.parentElement)node.remove();const i=reference?this.childNodes.indexOf(reference):this.childNodes.length;this.childNodes.splice(i,0,node);node.parentElement=this;return node;}
 appendChild(node){return this.insertBefore(node,null);}remove(){if(this.parentElement){const p=this.parentElement;p.childNodes.splice(p.childNodes.indexOf(this),1);this.parentElement=null;this.detaches++;}}
 replaceChild(node,old){this.insertBefore(node,old);old.remove();}cloneNode(){const n=new Node(this.getAttribute('data-gc-node'),this.text);for(const child of this.childNodes)n.appendChild(child.cloneNode(true));return n;}
}
let fresh;const morph={document:{createElement:()=>({set innerHTML(_){},get content(){return fresh;}})}};vm.createContext(morph);vm.runInContext(source.slice(source.indexOf(' function commit('),source.indexOf(' function paint(')),morph);
const a=new Node('a'),holiday=new Node('holiday'),b=new Node('b'),root=new Node();[a,holiday,b].forEach(n=>root.appendChild(n));
for(let i=0;i<10;i++){fresh=new Node();[new Node('a'),...(i%2?[new Node('holiday')]:[]),new Node('b')].forEach(n=>fresh.appendChild(n));morph.commit(root,'toggle-'+i);assert.equal(root.childNodes[0],a);assert.equal(root.childNodes.at(-1),b);}
assert.equal(a.detaches,0);assert.equal(b.detaches,0,'unrelated event nodes must never be detached during repeated toggles');
const callbacks={},requests=[],pending=[];let html='';const viewRoot={get innerHTML(){return html;},set innerHTML(value){html=value;}},content={innerHTML:''};
const FixedDate=class extends Date {constructor(...args){super(...(args.length?args:['2026-11-03T12:00:00-05:00']));}static now(){return new Date('2026-11-03T12:00:00-05:00').getTime();}};
const regular={id:'work',summary:'Work',primary:true,accessRole:'owner'},other={id:'holiday',summary:'Holidays',selected:false,accessRole:'reader'};
const event={id:'meeting',summary:'Still visible',start:{dateTime:'2026-11-03T11:00:00-05:00'},end:{dateTime:'2026-11-03T12:00:00-05:00'}};
const ctx={Date:FixedDate,Intl,URL,URLSearchParams,Map,Set,page:'schedule',state:{settings:{}},localStorage:{getItem:()=>null,setItem(){}},setInterval(){},setTimeout,clearTimeout,
 document:{querySelector:selector=>selector==='#google-calendar'?viewRoot:null,querySelectorAll:()=>[],addEventListener:(key,fn)=>(callbacks[key]??=[]).push(fn)},
 api:async path=>{requests.push(path);if(path.includes('/status'))return {connected:true};if(path.includes('/calendars'))return {items:[regular,other]};if(path.includes('/events?')){if(new URLSearchParams(path.split('?')[1]).get('calendar')==='holiday')return new Promise(resolve=>pending.push(resolve));return {items:[event],synced_at:1};}return {};},
 $:selector=>selector==='#content'?content:viewRoot,esc:value=>String(value??''),modal:{open:false},closeModal(){},toast(){},showModalError(){},options(){},field(){}};
ctx.window=ctx;ctx.addEventListener=()=>{};vm.createContext(ctx);for(const file of ['google-calendar-data.js','google-calendar.js'])vm.runInContext(fs.readFileSync('web/'+file,'utf8'),ctx);ctx.renderCalendar=()=>ctx.HotTurkeyGoogleCalendar.render();
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 await callbacks.click[0]({target:{closest:selector=>selector==='[data-gc-source]'?{dataset:{gcSource:'google'}}:null}});await tick();await tick();assert(html.includes('Still visible'));
 const toggle=checked=>callbacks.change[0]({target:{dataset:{gcCalendar:'holiday'},checked}});
 const first=toggle(true);await tick();assert(html.includes('Still visible'),'an uncached selected calendar must not blank existing selected events');
 await toggle(false);assert(html.includes('Still visible'));const last=toggle(true);await tick();assert.equal(pending.length,1,'rapid reselect coalesces the pending request');
 pending[0]({items:[{id:'holiday-one',summary:'Holiday',start:{date:'2026-11-03'},end:{date:'2026-11-04'}}],synced_at:1});await Promise.all([first,last]);assert(html.includes('Still visible'));assert(html.includes('Holiday'));
 assert.equal(requests.filter(p=>p.includes('/events?')&&p.includes('calendar=work')).length,1,'cached unrelated calendar is not fetched on checkbox toggles');
 await toggle(false);assert(html.includes('Still visible'));assert(!html.includes('aria-label="Holiday · 全天"'));
 await toggle(true);const refresh=callbacks.click[0]({target:{closest:selector=>selector==='[data-gc]'?{dataset:{gc:'refresh'},disabled:false}:null}});await tick();assert.equal(pending.length,2);await toggle(false);pending[1]({items:[{id:'late',summary:'Late holiday',start:{date:'2026-11-03'},end:{date:'2026-11-04'}}],synced_at:2});await refresh;assert(html.includes('Still visible'));assert(!html.includes('Late holiday'),'a late refresh cannot undo the latest checkbox selection');
 ctx.D=ctx.HotTurkeyGoogleData;ctx.eventAppearance=()=>({color:'#007aff'});ctx.time=date=>date.toISOString().slice(11,16);ctx.name=event=>event.summary;
 vm.runInContext(source.match(/function overviewRow\([^\n]+/)[0],ctx);
 const allDay=ctx.overviewRow({calendar:regular,event:{id:'ddl',summary:'Deadline',start:{date:'2026-11-03'},end:{date:'2026-11-04'}}},0,new Date(),new Date(2026,10,3));assert(!allDay.includes('全天'));assert(allDay.includes('Deadline'));
 vm.runInContext(source.match(/function overviewRows\([^\n]+/)[0],ctx);
 const dayItem={calendar:regular,event:{id:'ddl',summary:'Deadline',start:{date:'2026-11-03'},end:{date:'2026-11-04'}}};
 const rows=[{item:dayItem,index:0},{item:{...dayItem,event:{...dayItem.event,id:'second'}},index:1},{item:{calendar:regular,event},index:2}];
 assert.equal((ctx.overviewRows(rows,new Date(),new Date(2026,10,3)).match(/>全天</g)||[]).length,1);
 assert.equal((ctx.overviewRows(rows,new Date(),new Date(2026,10,4)).match(/>全天</g)||[]).length,1,'each day keeps its own single all-day label');
 const timed=ctx.overviewRow({calendar:regular,event},1,new Date(),new Date(2026,10,3));assert.equal((timed.match(/<time>/g)||[]).length,2);assert(timed.includes('timed'));
 const declined=ctx.overviewRow({calendar:regular,event:{...event,attendees:[{self:true,responseStatus:'declined'}]}},2,new Date(),new Date(2026,10,3));assert(declined.includes(' timed declined'));
 const guestDeclined=ctx.overviewRow({calendar:regular,event:{...event,attendees:[{email:'guest@example.com',responseStatus:'declined'}]}},3,new Date(),new Date(2026,10,3));assert(!guestDeclined.includes(' declined'),'another guest declining must not strike through my event');
 const accepted=ctx.overviewRow({calendar:regular,event:{...event,attendees:[{self:true,responseStatus:'accepted'}]}},4,new Date(),new Date(2026,10,3));assert(!accepted.includes(' declined'));

 console.log('Rapid toggles retain nodes/data, discard stale responses; overview omits repeated all-day text and preserves clock times');
})().catch(error=>{console.error(error);process.exitCode=1;});
