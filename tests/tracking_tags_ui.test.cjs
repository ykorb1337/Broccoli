'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/tracking-tags.js','utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const item={key:'c_one',kind:'combination',parts:['Client'],name:'Client',color:'',skip:false,resolved_color:'#007aff'};
function setup(api){
 const elements=new Map(),listeners={},calls=[],renders=[],errors=[],timers=new Map();let serial=0,loads=0;
 const node=value=>({value,hidden:false,checked:false,innerHTML:'',focus(){this.focused=true;}});
 const modal={open:false,querySelectorAll:()=>[]};
 const ctx={console,Date,JSON,Number,String,Promise,Set,Map,Error,URLSearchParams,page:'statistics',modal,
  setTimeout:fn=>{const id=++serial;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
  document:{querySelector:key=>elements.get(key)||null,querySelectorAll:()=>[],addEventListener:(key,fn)=>(listeners[key]??=[]).push(fn)},
  sheetGroup:(title,body,note='')=>title+body+note,field:(label,html)=>label+html,
  openModal:(title,body,footer)=>{modal.open=true;renders.push({title,body,footer});if(title==='标签管理')elements.set('#mt-library-root',{});},
  confirm:()=>true,showModalError:error=>errors.push(error),toast:()=>{},download:()=>{},readFile:async()=>null};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);
 const ui=ctx.HotTurkeyTags.create({model:{day:'2026-10-28'},apiCall:(path,data)=>{calls.push({path,data});return api?api(path,data):Promise.resolve({items:[item],total:1});},load:async()=>{loads++;},attr:String,button:(op,label,attrs='')=>'<button data-mt="'+op+'" '+attrs+'>'+label+'</button>',tagModal:()=>{renders.push({title:'Tag editor'});}});
 const close=()=>{modal.open=false;elements.delete('#mt-library-root');elements.delete('#mt-tag-text');};
 const tick=async()=>{const all=[...timers.values()];timers.clear();for(const fn of all)fn();await new Promise(r=>setImmediate(r));};
 return {ctx,ui,elements,calls,renders,errors,node,close,tick,get loads(){return loads;},input(id,value){const n=node(value);elements.set(id,n);return n;},dispatch(name,target){for(const fn of listeners[name]||[])fn({target});}};
}
let count=0;async function test(name,fn){await fn();count++;}
const watchdog=setTimeout(()=>{console.error('Tag UI checks timed out');process.exit(1);},10000);
(async()=>{
 await test('Closing manager before catalog reply cannot reopen it',async()=>{
  const d=deferred(),s=setup(()=>d.promise),opening=s.ui.action('tag-manager',{});assert.equal(s.renders.length,1);s.close();d.resolve({items:[item],total:1});await opening;assert.equal(s.renders.length,1);assert(!s.ctx.modal.open);
 });
 await test('An error from a cancelled catalog request stays cancelled',async()=>{
  const d=deferred(),s=setup(()=>d.promise),opening=s.ui.action('tag-manager',{});s.close();d.reject(Error('Cancelled request'));await opening;assert.equal(s.renders.length,1);assert.equal(s.errors.length,0);
 });
 await test('Older tab response cannot replace current tab',async()=>{
  const a=deferred(),b=deferred();let n=0;const s=setup(()=>++n===1?a.promise:b.promise),one=s.ui.action('tag-manager',{}),two=s.ui.action('library-tab',{dataset:{value:'tag'}});
  b.resolve({items:[{...item,key:'t_two',kind:'tag',name:'New tab'}],total:1});await two;a.resolve({items:[{...item,name:'Stale tab'}],total:1});await one;
  assert(s.renders.at(-1).body.includes('New tab'));assert(!s.renders.at(-1).body.includes('Stale tab'));
 });
 await test('Late recent tags never overwrite another tag editor',async()=>{
  const d=deferred(),s=setup(()=>d.promise);s.ctx.modal.open=true;s.input('#mt-tag-text','Old');const recent=s.input('#mt-recent-tags','');const request=s.ui.prepare();s.input('#mt-tag-text','New draft');d.resolve({items:[{parts:['Old choice'],color:'#123456'}]});await request;assert.equal(recent.innerHTML,'');assert.equal(s.elements.get('#mt-tag-text').value,'New draft');
 });
 await test('Cancelling hierarchy ignores its pending response',async()=>{
  const d=deferred(),s=setup(()=>d.promise);s.ctx.modal.open=true;s.input('#mt-tag-text','Draft');const root=s.input('#mt-tag-picker','');root.hidden=true;
  const opening=s.ui.action('tag-picker',{});await s.ui.action('tag-picker-hide',{});d.resolve({items:[{name:'Late',parts:['Late']}],total:1});await opening;assert(root.hidden);assert.equal(root.innerHTML,'');
 });
 await test('Choosing hierarchy only changes tag text',async()=>{
  const s=setup(path=>Promise.resolve(path.includes('prefix=%5B%5D')?{items:[{name:'Client',parts:['Client'],children:true}],total:1}:{items:[{name:'Project',parts:['Client','Project']}],total:1}));s.ctx.modal.open=true;
  const input=s.input('#mt-tag-text','');s.input('#mt-tag-notes','Private notes');const bill=s.input('#mt-tag-billable','');bill.checked=true;const root=s.input('#mt-tag-picker','');root.hidden=true;
  await s.ui.action('tag-picker',{});await s.ui.action('tag-picker-child',{dataset:{index:'0'}});await s.ui.action('tag-picker-child',{dataset:{index:'0'}});await s.ui.action('tag-picker-use',{});
  assert.equal(input.value,'Client, Project');assert.equal(s.elements.get('#mt-tag-notes').value,'Private notes');assert(bill.checked);assert(root.hidden);assert(input.focused);
 });
 await test('Search preserves the unsaved library draft',async()=>{
  const s=setup();await s.ui.action('tag-manager',{});await s.ui.action('library-select',{dataset:{key:'c_one'}});
  s.input('#mt-library-name','Unsaved name');s.input('#mt-library-color-mode','inherit');s.input('#mt-library-color','#123456');const search=s.input('#mt-library-search','Search');search.id='mt-library-search';s.dispatch('input',search);await s.tick();assert(s.renders.at(-1).body.includes('Unsaved name'));
 });
 await test('Rejecting draft discard does not change selection',async()=>{
  const s=setup();await s.ui.action('tag-manager',{});await s.ui.action('library-select',{dataset:{key:'c_one'}});s.input('#mt-library-name','Unsaved');s.input('#mt-library-color-mode','inherit');s.input('#mt-library-color','#123456');s.ctx.confirm=()=>false;
  const renders=s.renders.length;await s.ui.action('library-new',{});assert.equal(s.renders.length,renders);assert.equal(s.elements.get('#mt-library-name').value,'Unsaved');
 });
 await test('Save cannot submit twice or reopen a closed manager',async()=>{
  const d=deferred(),s=setup((path)=>path==='tag-library/update'?d.promise:Promise.resolve({items:[item],total:1}));await s.ui.action('tag-manager',{});await s.ui.action('library-select',{dataset:{key:'c_one'}});
  s.input('#mt-library-name','Client');s.input('#mt-library-color-mode','inherit');s.input('#mt-library-color','#123456');const save=s.ui.action('library-save',{});await s.ui.action('library-save',{});assert.equal(s.calls.filter(v=>v.path==='tag-library/update').length,1);
  const renders=s.renders.length;s.close();d.resolve(item);await save;assert.equal(s.renders.length,renders);assert.equal(s.loads,1);
 });
 await test('Cancelled last-untagged lookup does not create another editor',async()=>{
  const d=deferred(),s=setup(()=>d.promise);s.ctx.modal.open=true;s.input('#mt-tag-text','Draft');const call=s.ui.action('tag-last-untagged',{});s.close();d.resolve({day:'2026-10-28',range:[100,200]});await call;assert.equal(s.renders.length,0);assert.equal(s.loads,0);
 });
 clearTimeout(watchdog);console.log(count+' tag editor draft, hierarchy and asynchronous cancellation checks passed');
})().catch(error=>{clearTimeout(watchdog);console.error(error);process.exitCode=1;});
