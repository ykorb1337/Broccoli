'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync('web/tracking-media.js','utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const frame=(id,at=30)=>({id:id.repeat(32),at,application:'Editor'});
function setup(api,imageFetch){
 const listeners={},windowListeners={},timers=new Map(),roots=[],requests=[],fetches=[],created=[],revoked=[];let serial=0,ctx;
 class Element {
  constructor(tag='div'){this.tag=tag;this.listeners={};this.style={};this.dataset={};this.isConnected=true;this.attrs={};this.width=540;this.height=300;this.classList={add(){}};}
  addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
  getAttribute(name){return this.attrs[name];}
  setAttribute(name,value){this.attrs[name]=value;}
  set innerHTML(value){this.html=value;if(value.includes('<img')){this.image=new Element('img');this.image.attrs.src=value.match(/src="([^"]+)"/)?.[1];this.image.src=this.image.attrs.src;this.image.complete=true;this.image.naturalWidth=32;}
   if(value.includes('mt-shot-info'))this.info=new Element();this.caption=new Element();if(value.includes('mt-shot-close'))this.closeButton=new Element('button');}
  querySelector(s){if(s==='.mt-shot-info')return this.info;if(s==='img')return this.image;if(s==='div'||s==='.mt-shot-large-caption')return this.caption;if(s==='.mt-shot-close')return this.closeButton;return null;}
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
 ctx.matchMedia=()=>({matches:true});ctx.window=ctx;ctx.addEventListener=(name,fn)=>(windowListeners[name]??=[]).push(fn);vm.createContext(ctx);vm.runInContext(code,ctx);
 const media=ctx.HotTurkeyMedia.create({model,apiCall:path=>{requests.push(path);return api?api(path):Promise.resolve({items:[frame('a')]});},attr:String,time:String});
 const event=(target,extra={})=>({target,buttons:0,button:0,clientX:200,clientY:160,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra});
 function dispatch(name,target,extra={}){const e=event(target,extra);for(const fn of listeners[name]||[]){fn(e);if(e.stopped)break;}return e;}
 async function tick(){const queued=[...timers.values()];timers.clear();for(const fn of queued)fn();await new Promise(r=>setImmediate(r));}
 return {ctx,model,media,bars,plot,roots,requests,fetches,created,revoked,dispatch,tick,find:id=>roots.find(v=>v.id===id)};
}
let count=0;
async function test(name,fn){try{await fn();count++;}catch(error){error.message=name+': '+error.message;throw error;}}
(async()=>{
 await test('Metadata appears immediately without waiting for a timer',async()=>{
  const s=setup();s.dispatch('pointermove',s.bars[2]);assert.equal(s.model.shotMode,'details');assert.equal(s.requests.length,0);
  s.dispatch('pointermove',s.bars[0]);assert.equal(s.requests.length,1);assert(s.requests[0].startsWith('screenshots/index?'));await s.tick();assert.equal(s.model.shotMode,'preview');
 });
 await test('One index and one thumbnail serve repeated hover within a frame',async()=>{
  const s=setup();s.dispatch('pointermove',s.bars[0]);await s.tick();for(let n=0;n<20;n++)s.dispatch('pointermove',s.bars[0],{clientX:180+n});await s.tick();assert.equal(s.requests.length,1);assert.equal(s.fetches.length,1);assert(s.fetches[0].url.includes('/thumbnail?'));
 });
 await test('Nearest adjacent frames are prefetched and reused without HTTP',async()=>{
  const s=setup(()=>Promise.resolve({items:[frame('a',20),frame('b',60),frame('c',100)]}));s.dispatch('pointermove',s.bars[0],{clientX:165});await s.tick();assert.equal(s.model.shot.id,frame('a').id);assert.equal(s.fetches.length,2);
  s.dispatch('pointermove',s.bars[0],{clientX:300});await s.tick();assert.equal(s.model.shot.id,frame('b').id);assert.equal(s.fetches.length,3);
  s.dispatch('pointermove',s.bars[0],{clientX:165});await s.tick();assert.equal(s.fetches.length,3);
 });
 await test('Pointer leave cancels unresolved metadata',async()=>{
  const d=deferred(),s=setup(()=>d.promise);s.dispatch('pointermove',s.bars[0]);s.dispatch('pointerout',s.bars[0],{relatedTarget:null});d.resolve({items:[frame('a')]});await s.tick();assert.equal(s.model.shotMode,'idle');assert.equal(s.fetches.length,0);
 });
 await test('Late thumbnail cannot recreate hidden or document previews',async()=>{
  const d=deferred(),s=setup(null,async()=>({ok:true,blob:()=>d.promise}));s.dispatch('pointermove',s.bars[0]);await s.tick();s.dispatch('pointermove',s.bars[2]);d.resolve({});await s.tick();assert.equal(s.model.shot,null);assert.equal(s.model.shotMode,'details');assert(!s.find('mt-shot-preview').image.src);
 });
 await test('Click pins thumbnail immediately then upgrades only that original',async()=>{
  const d=deferred(),s=setup(null,async url=>({ok:true,blob:()=>url.includes('/image?')?d.promise:Promise.resolve({})}));s.dispatch('pointermove',s.bars[0]);await s.tick();const url=s.model.shotURL,e=s.dispatch('click',s.bars[0]);assert(e.defaultPrevented&&e.stopped);assert.equal(s.model.shotMode,'expanded');assert.equal(s.find('mt-shot-expanded').image.src,url);await s.tick();assert.equal(s.fetches.length,2);
  s.dispatch('pointermove',s.bars[1]);d.resolve({});await s.tick();assert.notEqual(s.find('mt-shot-expanded').image.src,url);assert.equal(s.model.shot.id,frame('a').id);assert.equal(s.requests.length,1);
 });
 await test('Closing before original arrives discards response',async()=>{
  const d=deferred(),s=setup(null,async url=>({ok:true,blob:()=>url.includes('/image?')?d.promise:Promise.resolve({})}));s.dispatch('pointermove',s.bars[0]);await s.tick();s.dispatch('click',s.bars[0]);await s.tick();s.media.suspend();const before=s.created.length;d.resolve({});await s.tick();assert.equal(s.created.length,before);assert.equal(s.roots.length,0);
 });
 await test('Escape and backdrop keep screenshot pinned',async()=>{
  const s=setup();s.dispatch('pointermove',s.bars[0]);await s.tick();s.dispatch('click',s.bars[0]);const dialog=s.find('mt-shot-expanded'),e=s.dispatch('keydown',dialog,{key:'Escape'});assert(e.defaultPrevented);s.dispatch('click',dialog);assert(dialog.open);
 });
 await test('Close releases cached image and retains timeline selection',async()=>{
  const s=setup();s.dispatch('pointermove',s.bars[0]);await s.tick();const url=s.model.shotURL;s.dispatch('click',s.bars[0]);s.find('mt-shot-expanded').closeButton.fire('click');assert.equal(s.model.shotMode,'idle');assert(s.revoked.includes(url));assert.equal(s.ctx.document.activeElement,s.bars[0]);assert.deepEqual(s.model.selection,[[10,20]]);
 });
 await test('Timeline drag keeps selection interaction',async()=>{
  const s=setup();s.dispatch('pointermove',s.bars[0]);await s.tick();s.dispatch('pointerdown',s.bars[0]);s.dispatch('pointermove',s.plot,{buttons:1,clientX:240});assert(!s.dispatch('click',s.plot).defaultPrevented);assert.equal(s.model.shotMode,'idle');
 });
 await test('Captured click still pins the frame',async()=>{
  const s=setup();s.dispatch('pointermove',s.bars[0]);await s.tick();s.dispatch('pointerdown',s.bars[0]);s.dispatch('pointerout',s.bars[0],{relatedTarget:s.plot});assert(s.dispatch('click',s.plot).defaultPrevented);
 });
 await test('Frame outside exact bar interval is never substituted',async()=>{
  const s=setup(()=>Promise.resolve({items:[frame('a',5),frame('b',115)]}));s.dispatch('pointermove',s.bars[0]);await s.tick();assert.equal(s.model.shotMode,'details');assert.equal(s.fetches.length,0);
 });
 await test('Authentication failure exposes no image',async()=>{
  const s=setup(null,async()=>({ok:false}));s.dispatch('pointermove',s.bars[0]);await s.tick();assert.equal(s.model.shotMode,'idle');assert.equal(s.created.length,0);
 });
 await test('Changing query or navigation clears image caches',async()=>{
  const s=setup();s.dispatch('pointermove',s.bars[0]);await s.tick();const url=s.model.shotURL;s.model.query='private';s.media.syncQuery();assert(s.revoked.includes(url));assert.equal(s.roots.length,0);s.dispatch('pointermove',s.bars[0]);await s.tick();assert.equal(s.requests.length,2);s.ctx.page='settings';s.media.afterRender();assert.equal(s.roots.length,0);
 });
 await test('Repeated application and URL metadata appears once',async()=>{
  const s=setup(()=>Promise.resolve({items:[]}));Object.assign(s.model.data.activities[0],{application:'Microsoft Edge',title:'Microsoft Edge'});s.dispatch('pointermove',s.bars[0]);await s.tick();assert.equal((s.find('mt-shot-preview').info.html.match(/Microsoft Edge/g)||[]).length,1);
 });
 await test('Focus changes during a loaded off-centre click never seek a different frame',async()=>{
  const s=setup(()=>Promise.resolve({items:[frame('a',20),frame('b',60)]}));s.dispatch('pointermove',s.bars[0],{clientX:165});await s.tick();assert.equal(s.model.shot.id,frame('a').id);
  s.dispatch('pointerdown',s.bars[0],{clientX:165});s.dispatch('focusout',s.bars[1]);s.dispatch('focusin',s.bars[0]);s.dispatch('pointerout',s.bars[0],{relatedTarget:s.plot});const e=s.dispatch('click',s.plot,{clientX:165});assert(e.defaultPrevented);assert.equal(s.model.shotMode,'expanded');assert.equal(s.model.shot.id,frame('a').id);await s.tick();assert.equal(s.model.shot.id,frame('a').id);
 });
 await test('A loaded image can enlarge while the browser has not decoded its new src',async()=>{
  const s=setup();s.dispatch('pointermove',s.bars[0]);await s.tick();s.find('mt-shot-preview').image.complete=false;s.find('mt-shot-preview').image.naturalWidth=0;assert(s.dispatch('click',s.bars[0]).defaultPrevented);assert.equal(s.model.shotMode,'expanded');
 });
 await test('Click before metadata arrives pins the clicked interval and opens when it arrives',async()=>{
  const d=deferred(),s=setup(()=>d.promise);s.dispatch('pointermove',s.bars[0]);s.dispatch('pointerdown',s.bars[0]);const e=s.dispatch('click',s.plot);assert(e.defaultPrevented);assert.equal(s.model.shotMode,'expanded');d.resolve({items:[frame('a')]});await s.tick();assert.equal(s.model.shot.id,frame('a').id);assert.equal(s.fetches.length,1);assert(s.fetches[0].url.includes('/image?'));
 });
 await test('Expanded file buttons use registered ID',async()=>{
  const s=setup(),calls=[];s.ctx.webkit={messageHandlers:{native:{}}};s.ctx.HotTurkeyMediaBridge={request:async v=>calls.push(v)};s.dispatch('pointermove',s.bars[0]);await s.tick();s.dispatch('click',s.bars[0]);const button={closest:()=>({dataset:{shotFile:'save-as'}})};s.find('mt-shot-expanded').fire('click',{target:button});await s.tick();assert.equal(calls[0].action,'save-as');assert.equal(calls[0].id,frame('a').id);assert(!calls[0].file);
 });
 console.log(count+' immediate hover, cached frames, pinned originals and privacy checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
