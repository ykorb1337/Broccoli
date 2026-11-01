'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync('web/tracking-media.js','utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const frame=(id,at=30)=>({id:id.repeat(32),at,application:'Editor'});
function setup(api,imageFetch){
 const listeners={},windowListeners={},timers=new Map(),roots=[],requests=[],fetches=[],created=[],revoked=[];let serial=0,ctx;
 class Element {
  constructor(tag='div'){this.tag=tag;this.listeners={};this.style={};this.dataset={};this.isConnected=true;this.attrs={};this.width=340;this.height=240;}
  addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
  getAttribute(name){return this.attrs[name];}
  setAttribute(name,value){this.attrs[name]=value;}
  set innerHTML(value){this.html=value;if(value.includes('<img')){this.image=new Element('img');this.image.attrs.src=value.match(/src="([^"]+)"/)[1];this.image.src=this.image.attrs.src;this.image.complete=true;this.image.naturalWidth=32;}
   this.caption=new Element();if(value.includes('mt-shot-close'))this.closeButton=new Element('button');}
  querySelector(s){if(s==='img')return this.image;if(s==='div')return this.caption;if(s==='.mt-shot-close')return this.closeButton;return null;}
  remove(){this.isConnected=false;const i=roots.indexOf(this);if(i>=0)roots.splice(i,1);}
  showModal(){this.open=true;}
  close(){this.open=false;}
  focus(){ctx.document.activeElement=this;}
  getBoundingClientRect(){return {left:100,top:150,bottom:170,width:this.width,height:this.height};}
  contains(other){return other===this;}
  closest(s){if(s==='.mt-track-plot')return this.plot;if(s.includes('.mt-activity'))return this.dataset.timeline?this:null;return null;}
  fire(name,event={}){for(const fn of this.listeners[name]||[])fn(event);}
 }
 const model={view:'day',day:'2026-10-28',query:'',range:[0,120],selection:[[10,20]],data:{since:0,until:120,activities:[]}};
 const plot=new Element();plot.getBoundingClientRect=()=>({left:100,width:400});
 const bars=['applications','computer','documents'].map((timeline,i)=>{const bar=new Element('button');bar.dataset={id:String(i),timeline};bar.plot=plot;model.data.activities.push({id:String(i),timeline,start:i===1?0:10,end:110});return bar;});
 const doc={body:{style:{zoom:'1'},appendChild:e=>roots.push(e)},activeElement:null,hidden:false,
  createElement:tag=>new Element(tag),addEventListener:(name,fn)=>(listeners[name]??=[]).push(fn),querySelector:s=>roots.find(v=>v.id===s.slice(1))};
 const TestURL={createObjectURL:()=>{const url='blob:fixture-'+(++serial);created.push(url);return url;},revokeObjectURL:url=>revoked.push(url)};
 ctx={console,Date,Promise,Set,Map,Error,Math,URL:TestURL,URLSearchParams,auth:'session',token:'token',page:'statistics',modal:{open:false},innerWidth:700,innerHeight:650,document:doc,
  setTimeout:fn=>{const id=++serial;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
  fetch:async(url,options)=>{fetches.push({url,options});return imageFetch?imageFetch(url):{ok:true,blob:async()=>({})};}};
 ctx.window=ctx;ctx.addEventListener=(name,fn)=>(windowListeners[name]??=[]).push(fn);vm.createContext(ctx);vm.runInContext(code,ctx);
 const media=ctx.HotTurkeyMedia.create({model,apiCall:path=>{requests.push(path);return api?api(path):Promise.resolve({items:[frame('a')]});},attr:String,time:String});
 const event=(target,extra={})=>({target,buttons:0,button:0,clientX:200,clientY:160,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra});
 function dispatch(name,target,extra={}){const e=event(target,extra);for(const fn of listeners[name]||[]){fn(e);if(e.stopped)break;}return e;}
 async function tick(){const queued=[...timers.values()];timers.clear();for(const fn of queued)fn();await new Promise(r=>setImmediate(r));}
 return {ctx,model,media,bars,plot,roots,requests,fetches,created,revoked,dispatch,tick,find:id=>roots.find(v=>v.id===id)};
}
let count=0;
async function test(name,fn){await fn();count++;}
const watchdog=setTimeout(()=>{console.error('Screenshot hover checks timed out');process.exit(1);},10000);
(async()=>{
 await test('Only application and computer bars request screenshots',async()=>{
  const s=setup();s.dispatch('pointermove',s.bars[2]);await s.tick();assert.equal(s.requests.length,0);assert.equal(s.model.shotMode,'details');
  s.dispatch('pointermove',s.bars[0]);assert.equal(s.requests.length,0);await s.tick();assert.equal(s.model.shotMode,'preview');
  const p=new URLSearchParams(s.requests[0].split('?')[1]);assert.equal(p.get('since'),'10');assert.equal(p.get('until'),'110');assert.equal(p.get('at'),'30');
  s.dispatch('pointermove',s.bars[1]);await s.tick();assert.equal(s.model.shotMode,'preview');
 });
 await test('Moving off a bar cancels an unresolved lookup',async()=>{
  const d=deferred(),s=setup(()=>d.promise);s.dispatch('pointermove',s.bars[0]);await s.tick();s.dispatch('pointerout',s.bars[0],{relatedTarget:null});d.resolve({items:[frame('a')]});await s.tick();assert.equal(s.model.shotMode,'idle');assert.equal(s.fetches.length,0);assert.equal(s.roots.length,0);
 });
 await test('A late image response cannot recreate a hidden preview',async()=>{
  const d=deferred(),s=setup(null,async()=>({ok:true,blob:()=>d.promise}));s.dispatch('pointermove',s.bars[0]);await s.tick();s.dispatch('pointermove',s.bars[2]);d.resolve({});await s.tick();assert.equal(s.created.length,0);assert.equal(s.model.shot,null);assert.equal(s.model.shotMode,'details');
 });
 await test('Changing bars discards old lookup results',async()=>{
  const a=deferred(),b=deferred();let n=0;const s=setup(()=>++n===1?a.promise:b.promise);
  s.dispatch('pointermove',s.bars[0]);await s.tick();s.dispatch('pointermove',s.bars[1]);await s.tick();b.resolve({items:[frame('b')]});await s.tick();a.resolve({items:[frame('a')]});await s.tick();assert.equal(s.model.shot.id,'b'.repeat(32));
 });
 await test('Click pins the same URL and frame without another request',async()=>{
  const s=setup();s.dispatch('pointermove',s.bars[0]);await s.tick();const url=s.model.shotURL,e=s.dispatch('click',s.bars[0]);assert(e.defaultPrevented&&e.stopped);assert.equal(s.model.shotMode,'expanded');assert.equal(s.find('mt-shot-expanded').image.src,url);assert.equal(s.fetches.length,1);assert.equal(s.find('mt-shot-preview'),undefined);
  s.dispatch('pointermove',s.bars[1]);await s.tick();assert.equal(s.requests.length,1);assert.equal(s.model.shotURL,url);
 });
 await test('Pending navigation cannot replace a pinned image',async()=>{
  const d=deferred();let n=0;const s=setup(()=>++n===1?Promise.resolve({items:[frame('a')]}):d.promise);
  s.dispatch('pointermove',s.bars[0]);await s.tick();s.dispatch('pointermove',s.bars[0]);await s.tick();s.dispatch('click',s.bars[0]);d.resolve({items:[frame('b')]});await s.tick();assert.equal(s.model.shot.id,'a'.repeat(32));assert.equal(s.fetches.length,1);
 });
 await test('Escape, backdrop and pointer leave do not dismiss a pinned frame',async()=>{
  const s=setup();s.dispatch('pointermove',s.bars[0]);await s.tick();s.dispatch('click',s.bars[0]);const dialog=s.find('mt-shot-expanded'),e=s.dispatch('keydown',dialog,{key:'Escape'});assert(e.defaultPrevented&&e.stopped);s.dispatch('pointerout',s.bars[0]);s.dispatch('click',dialog);const c={preventDefault(){this.prevented=true;}};dialog.fire('cancel',c);assert(c.prevented);assert(dialog.open);
 });
 await test('Circular close restores focus and releases private image data',async()=>{
  const s=setup();s.dispatch('pointermove',s.bars[0]);await s.tick();const url=s.model.shotURL;s.dispatch('click',s.bars[0]);s.find('mt-shot-expanded').closeButton.fire('click');assert.equal(s.model.shotMode,'idle');assert.equal(s.model.shot,null);assert(s.revoked.includes(url));assert.equal(s.ctx.document.activeElement,s.bars[0]);assert.deepEqual(s.model.selection,[[10,20]]);
  s.dispatch('pointermove',s.bars[1]);await s.tick();assert.equal(s.model.shotMode,'preview');
 });
 await test('Timeline drag remains available instead of opening screenshot',async()=>{
  const s=setup();s.dispatch('pointermove',s.bars[0]);await s.tick();s.dispatch('pointerdown',s.bars[0]);s.dispatch('pointermove',s.plot,{buttons:1,clientX:240});const e=s.dispatch('click',s.plot);assert.equal(s.model.shotMode,'idle');assert(!e.defaultPrevented);
 });
 await test('Pointer-captured click can enlarge without selecting the interval',async()=>{
  const s=setup();s.dispatch('pointermove',s.bars[0]);await s.tick();s.dispatch('pointerdown',s.bars[0]);s.dispatch('pointerout',s.bars[0],{relatedTarget:s.plot});assert.equal(s.model.shotMode,'preview');assert(s.dispatch('click',s.plot).defaultPrevented);assert.equal(s.model.shotMode,'expanded');
 });
 await test('Missing image does not substitute a different interval',async()=>{
  const s=setup(()=>Promise.resolve({items:[]}));s.dispatch('pointermove',s.bars[0]);await s.tick();assert.equal(s.roots.length,1);assert.equal(s.model.shotMode,'details');assert.equal(s.fetches.length,0);assert(!s.dispatch('click',s.bars[0]).defaultPrevented);
 });
 await test('Authentication failure never displays private image data',async()=>{
  const s=setup(null,async()=>({ok:false}));s.dispatch('pointermove',s.bars[0]);await s.tick();assert.equal(s.model.shotMode,'idle');assert.equal(s.model.shot,null);assert.equal(s.created.length,0);
 });
 await test('Management lock removes preview and pinned image',async()=>{
  const s=setup();s.dispatch('pointermove',s.bars[0]);await s.tick();s.dispatch('click',s.bars[0]);s.media.suspend();assert.equal(s.roots.length,0);assert.equal(s.model.shotURL,'');assert.equal(s.model.shotMode,'idle');
 });
 await test('Changing page clears screenshots after render',async()=>{
  const s=setup();s.dispatch('pointermove',s.bars[0]);await s.tick();s.ctx.page='settings';s.media.afterRender();assert.equal(s.roots.length,0);assert.equal(s.model.shot,null);
 });
 await test('Repeated application names and URL titles appear once in metadata',async()=>{
  const s=setup(()=>Promise.resolve({items:[]}));Object.assign(s.model.data.activities[0],{application:'Microsoft Edge',title:'Microsoft Edge'});
  s.dispatch('pointermove',s.bars[0]);await s.tick();assert.equal((s.find('mt-shot-preview').html.match(/Microsoft Edge/g)||[]).length,1);
  const url='https://edstem.org/us/courses/102065/discussion/new';Object.assign(s.model.data.activities[2],{application:'Microsoft Edge',title:url,url});
  s.dispatch('pointermove',s.bars[2]);await s.tick();const html=s.find('mt-shot-preview').html;assert.equal(html.split(url).length-1,1);assert.equal((html.match(/Microsoft Edge/g)||[]).length,1);
 });
 clearTimeout(watchdog);console.log(count+' floating screenshot, pinned frame and privacy checks passed');
})().catch(error=>{clearTimeout(watchdog);console.error(error);process.exitCode=1;});
