'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/app.js','utf8'),calls=[];
const block={id:'rule-one',device:'none',active:true,break_status:{type:'meal',allowed:false,left:2}};
const c={state:{can_manage:false,blocks:[block],now:1000},canManage:()=>false,
 btn:(action,label,extra='')=>`<button data-action="${action}" ${extra}>${label}</button>`,duration:s=>String(s),$$:()=>[],
 api:async(path,data)=>{calls.push({path,data});return {};},refresh:async()=>{},toast:()=>{},
 field:(label,html)=>label+html,select:()=>'',num:(name,value,min,max)=>`<input name="${name}" value="${value}" min="${min}" max="${max}">`,sheetGroup:(_,body)=>body,BREAK:{meal:'用餐休息'},hm:String};
vm.createContext(c);
for(const name of ['mealRuleActions','updateMealBreakTimers','allowedAction','resetPomodoroButton'])vm.runInContext(source.match(new RegExp(`function ${name}\\([^\\n]+`))[0],c);
vm.runInContext(source.slice(source.indexOf('function breakForm('),source.indexOf('function localInput(')),c);
vm.runInContext(source.slice(source.indexOf('async function action('),source.indexOf("document.addEventListener('click'")),c);
const button={disabled:false,isConnected:true,dataset:{id:'rule-one'}};
(async()=>{
 const control=c.mealRuleActions(block);assert(control.includes('今日剩余 2 次'));assert(control.includes('data-action="break"'));assert(control.includes('data-id="rule-one"'));assert(c.allowedAction('end-meal'));
 await c.action('break',button);assert.equal(calls[0].path,'blocks/break');assert.equal(calls[0].data.id,'rule-one');assert(!button.disabled);
 block.break_status={type:'meal',allowed:true,left:1,until:2800};const active=c.mealRuleActions(block);assert(active.includes('结束休息'));assert(!active.includes('data-action="break"'));assert(active.includes('data-meal-until="2800"'));
 let displayed;c.$$=()=>[{dataset:{mealUntil:'2800'},set textContent(value){displayed=value;}}];c.updateMealBreakTimers();assert.equal(displayed,'1800');assert.equal(c.resetPomodoroButton(block),'');
 await c.action('end-meal',button);assert.equal(calls.at(-1).path,'blocks/break');assert.equal(calls.at(-1).data.id,'rule-one');assert.equal(calls.at(-1).data.finish,true);
 block.break_status={type:'meal',allowed:false,left:0};assert(c.mealRuleActions(block).includes('disabled'));assert.equal(c.mealRuleActions({...block,device:'sleep'}),'');
 const form=c.breakForm({type:'meal'},'break.');assert(form.includes('每日次数'));assert(form.includes('name="break.meal_daily_limit" value="2"'));assert(form.includes('name="break.break_minutes" value="30"'));assert(!source.includes('mealBreakSettings'));assert(!source.includes('meal-break/start'));
 c.api=async()=>{throw Error('service unavailable');};await assert.rejects(()=>c.action('end-meal',button),/service unavailable/);assert(!button.disabled);
 console.log('Per-rule meal mode, scoped start/end, quota, defaults, countdown and error recovery checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
