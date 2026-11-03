'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm');
const handlers={},calls=[],forms=[],errors=[],nodes={},root={innerHTML:''},content={innerHTML:''},modal={open:false,dataset:{}};
const calendar={id:'a',summary:'Calendar',primary:true,accessRole:'owner',backgroundColor:'#007aff'};
let fixture={id:'series_20261103T140000Z',recurringEventId:'series',summary:'Study',etag:'v1',start:{dateTime:'2026-11-03T09:00:12-05:00',timeZone:'America/New_York'},end:{dateTime:'2026-11-03T10:20:12-05:00',timeZone:'America/New_York'},eventLabelId:'old'};
const label={id:'old',name:'Research',backgroundColor:'#123456'};
let write=true,fail=false,bannerMode=false;
const c={Intl,Date,URL,URLSearchParams,Map,Set,page:'schedule',innerWidth:1400,innerHeight:900,localStorage:{getItem:()=>null,setItem(){}},document:{querySelector:s=>s==='#google-calendar'&&content.innerHTML?root:null,querySelectorAll:s=>['.gc-month-day','.gc-day'].includes(s)?days:[],addEventListener:(name,fn)=>(handlers[name]??=[]).push(fn),createElement:()=>({})},setInterval(){},setTimeout,clearTimeout,addEventListener(){},$:s=>s==='#content'?content:(nodes[s]||root),esc:v=>String(v??''),btn:()=>'',field:(name,html)=>`<div class="field">${name}${html}</div>`,options:()=>'',modal,closeModal(){modal.open=false;},openModal(...args){forms.push(args);modal.open=true;},toast:m=>errors.push(m),showModalError:m=>errors.push(m),api:async(path,data)=>{
 calls.push({path,data});if(path.endsWith('/status'))return {connected:true,label_permission:true,label_write_permission:write};
 if(path.includes('/calendars'))return {items:[calendar]};if(path.includes('/labels?'))return {items:[label]};if(path.includes('/events?'))return {items:[fixture]};if(path.includes('/event?'))return fixture;
 if(path.endsWith('/labels/create'))return {label:{id:'new',name:data.name,backgroundColor:data.color},items:[label,{id:'new',name:data.name,backgroundColor:data.color}]};
 if(path.endsWith('/save')){if(fail)throw Error('concurrent change');fixture={...fixture,...data.value,etag:'v2'};return fixture;}return {};
}};
c.HotTurkeyGooglePicker={close(){},field:()=>'',zone:()=>''};c.window=c;vm.createContext(c);for(const file of ['google-calendar-data.js','google-calendar.js'])vm.runInContext(fs.readFileSync('web/'+file,'utf8'),c);
const classList=()=>{const values=new Set();return {values,add:v=>values.add(v),remove:v=>values.delete(v),toggle(v,yes){yes?values.add(v):values.delete(v);}};};
const days=['2026-11-03','2026-11-04'].map((date,i)=>({dataset:{date},classList:classList(),getBoundingClientRect:()=>({left:100+i*100,right:200+i*100,top:200,bottom:300})}));
const eventButton={dataset:{key:'0'},style:{},classList:classList(),getAttribute:()=> 'grid-column:2',setAttribute(k,v){this.restored=v;this.style={};},setPointerCapture(){},closest:s=>bannerMode?(s==='.gc-all-strip'?{}:null):(s.includes('.gc-month')?{}:null)};
const tick=()=>new Promise(r=>setImmediate(r));
const click=async(action,extra={})=>{const el={dataset:{gc:action,key:'0',...extra},disabled:false,closest:()=>null};await handlers.click[0]({target:{closest:s=>s==='[data-gc]'?el:null}});await tick();};
const pointer=(name,x,y)=>handlers[name][0]({button:0,pointerId:1,clientX:x,clientY:y,target:{closest:()=>eventButton}});
(async()=>{
 c.renderCalendar=()=>c.HotTurkeyGoogleCalendar.render();await handlers.click[0]({target:{closest:s=>s==='[data-gc-source]'?{dataset:{gcSource:'google'}}:null}});await tick();await tick();await click('view',{view:'month'});
 pointer('pointerdown',150,240);pointer('pointermove',250,240);assert(days[1].classList.values.has('gc-drop-target'));await pointer('pointerup',250,240);
 const saved=calls.filter(c=>c.path.endsWith('/save')).at(-1);assert.equal(saved.data.event,'series_20261103T140000Z');assert(!('recurrence' in saved.data.value));assert(!('eventLabelId' in saved.data.value));assert.equal(saved.data.value.start.dateTime,'2026-11-04T09:00:12.000');assert.equal(saved.data.value.end.dateTime,'2026-11-04T10:20:12.000');assert.equal(saved.data.etag,'v1');assert.equal(eventButton.restored,'grid-column:2');assert(!days[1].classList.values.has('gc-drop-target'));
 const count=calls.filter(c=>c.path.endsWith('/save')).length;
 pointer('pointerdown',150,240);pointer('pointermove',160,240);await pointer('pointerup',160,240);assert.equal(calls.filter(c=>c.path.endsWith('/save')).length,count,'same-day motion is a no-op');
 pointer('pointerdown',150,240);pointer('pointermove',250,240);handlers.pointercancel[0]();assert(!eventButton.classList.values.has('dragging'));assert(!days[1].classList.values.has('gc-drop-target'));
 fail=true;pointer('pointerdown',150,240);pointer('pointermove',250,240);await pointer('pointerup',250,240);assert(errors.includes('concurrent change'));assert.equal(eventButton.restored,'grid-column:2');fail=false;
 fixture={...fixture,id:'all-day',start:{date:'2026-11-03'},end:{date:'2026-11-05'}};await click('refresh');await click('view',{view:'week'});bannerMode=true;pointer('pointerdown',150,150);pointer('pointermove',250,150);await pointer('pointerup',250,150);assert.equal(fixture.start.date,'2026-11-04');assert.equal(fixture.end.date,'2026-11-06');bannerMode=false;
 await click('new');assert(forms.at(-1)[1].includes('aria-label="事件标签"'));assert(forms.at(-1)[1].includes('Research'));assert(forms.at(-1)[1].includes('添加标签'));
 const defaults={'#gc-title':'New event','#gc-target':'a','#gc-start':'2026-11-03T09:00','#gc-end':'2026-11-03T10:00','#gc-zone':'America/New_York','#gc-location':'','#gc-description':'','#gc-attendees':'','#gc-repeat':'none','#gc-reminder':'default','#gc-label':'old','#gc-label-name':'New label','#gc-label-color':'#abcdef'};
 for(const [id,value]of Object.entries(defaults))nodes[id]={value,disabled:false,focus(){},appendChild(){}};
 nodes['#gc-all-day']={checked:false};nodes['#gc-new-label']={hidden:true};nodes['.gc-label-swatch']={style:{}};nodes['[data-gc="label-new"]']={attributes:{},setAttribute(key,value){this.attributes[key]=value;},focus(){}};
 await click('label-new');assert.equal(nodes['#gc-new-label'].hidden,false);assert.equal(nodes['[data-gc="label-new"]'].attributes['aria-expanded'],'true');await click('label-new');assert.equal(nodes['#gc-new-label'].hidden,true);assert.equal(nodes['[data-gc="label-new"]'].attributes['aria-label'],'添加标签');await click('label-new');await click('label-create');assert.equal(nodes['#gc-label'].value,'new');assert.equal(nodes['#gc-new-label'].hidden,true);await click('save');assert.equal(calls.filter(c=>c.path.endsWith('/save')).at(-1).data.value.eventLabelId,'new');
 // DST calendar-day shift retains clocks, seconds and exclusive all-day end.
 const D=c.HotTurkeyGoogleData,shift=D.shiftEvent({start:{dateTime:'2026-10-31T09:15:42-04:00',timeZone:'America/New_York'},end:{dateTime:'2026-10-31T10:20:42-04:00',timeZone:'America/New_York'}},'2026-10-31','2026-11-01');assert.equal(shift.start.dateTime,'2026-11-01T09:15:42.000');assert.equal(shift.end.dateTime,'2026-11-01T10:20:42.000');
 const multi=D.shiftEvent({start:{date:'2026-11-02'},end:{date:'2026-11-05'}},'2026-11-03','2026-11-05');assert.equal(multi.start.date,'2026-11-04');assert.equal(multi.end.date,'2026-11-07');assert.deepEqual(Object.keys(multi).sort(),['end','start']);
 console.log('Instance-only month drag, no-op, cancel, conflict, DST, multiday and label editing passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
