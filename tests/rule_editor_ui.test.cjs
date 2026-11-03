'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/app.js','utf8');let html='',controls=[];
const c={Date,JSON,document:{},window:{HotTurkeyGooglePicker:{field:(id,value,allDay,disabled,label)=>`<picker id="${id}" value="${value}" label="${label}">`}},
 esc:String,clone:structuredClone,apps:[],tab:'schedule',editor:null,state:{now:Date.now()/1000,settings:{week_start:'monday'}},editorScheduleScroll:0,
 field:(label,body)=>label+body,select:(name,values,value)=>`<select name="${name}" value="${value}">${Object.values(values).join('|')}</select>`,num:(name,value)=>`<input name="${name}" value="${value}">`,sheetGroup:(_,body)=>body,
 btn:(action,label)=>`<button data-action="${action}">${label}</button>`,openModal:(_,body)=>{html=body;},BREAK:{none:'不设休息',text:'输入文本休息'},DAY:['周一'],minute:value=>Number(value.split(':')[0])*60+Number(value.split(':')[1]),hm:String,
 $$:()=>controls,$:selector=>selector==='#editor-panel'?{}:null};
vm.createContext(c);vm.runInContext(fs.readFileSync('web/calendar.js','utf8'),c);
for(const name of ['collectBreakFields','collectEditor','localInput'])vm.runInContext(source.match(new RegExp(`function ${name}\\([^\\n]+`))[0],c);
vm.runInContext(source.slice(source.indexOf('function renderEditor('),source.indexOf('function openBlockImport(')),c);
vm.runInContext(source.slice(source.indexOf('function breakForm('),source.indexOf('function localInput(')),c);
c.editor={name:'',mode:'continuous',schedule:[{days:[0],start:540,end:600}],break:{type:'text',text_mode:'characters',custom_text:'',text_length:30},users:['original-account'],color:'#127744',device:'none',autostart:{type:'none'}};
c.renderEditor();assert(!html.includes('add-interval'));c.editor.mode='scheduled';c.renderEditor();assert(html.includes('add-interval'));
c.tab='other';c.renderEditor();assert(!html.includes('device_minutes'));assert(!html.includes('影响的用户'));assert(html.includes('rule-color'));c.editor.device='sleep';c.renderEditor();assert(!html.includes('device_minutes'));c.editor.mode='continuous';c.renderEditor();assert(html.includes('启用后限制多久'));assert(html.includes('device_minutes'));
const br=c.editor.break;assert(!c.breakForm(br).includes('<textarea'));br.custom_text='legacy text';assert(c.breakForm(br).includes('value="custom"'));assert(!c.breakForm(br).includes('name="break.text_length"'));
// A random selection must stop using a legacy custom challenge even before its old textarea is replaced.
controls=[{name:'break.text_mode',value:'words'},{name:'break.custom_text',value:'legacy text'}];c.collectBreakFields(br,'break.');assert.equal(br.custom_text,'');assert.equal(br.text_mode,'words');
controls=[{name:'break.text_mode',value:'custom'}];c.collectBreakFields(br,'break.');assert(c.breakForm(br).includes('<textarea'));controls=[{name:'span.text_mode',value:'custom'},{name:'span.custom_text',value:'中文\nKeep focus'}];c.collectBreakFields(br,'span.');assert.equal(br.custom_text,'中文\nKeep focus');
controls=[{name:'mode',value:'continuous'}];c.collectEditor();assert.equal(c.editor.users[0],'original-account');assert.equal(c.editor.schedule.length,1);assert.equal(br.custom_text,'中文\nKeep focus');
c.editor.autostart={type:'once',at:Date.now()/1000};c.renderEditor();assert(html.includes('id="auto_at"'));
let lockFields={innerHTML:''};c.LOCK={timer:'定时锁'};c.lockField=(label,body)=>label+body;c.$=selector=>selector==='#lock-type'?{value:'timer'}:selector==='#lock-fields'?lockFields:{};
vm.runInContext(source.slice(source.indexOf('function renderLockFields('),source.indexOf('async function setup(')),c);c.renderLockFields();assert(lockFields.innerHTML.includes('<picker id="lock-until"'));assert(lockFields.innerHTML.includes('label="解锁"'));
console.log('Rule mode visibility, custom challenge changes, draft preservation, device duration and shared date picker checks passed');
