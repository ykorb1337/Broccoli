'use strict';
window.HotTurkeyClockUI={create({model,apiCall,render,load,attr,button,tagTools,length}){
 const q=(s,r=document)=>r.querySelector(s);
 const kinds={stopwatch:'秒表',countdown:'倒计时',pomodoro:'番茄计时'};
 let data=null,sequence=0,busy=false,draft=null,prompted='',error='',seenFinish='',queuedStop=null;
 const visible=()=>page==='statistics'&&state?.authenticated===true&&state?.tracking?.version===1&&state.tracking.available!==false;
 const active=()=>data&&['running','paused','awaiting'].includes(data.status);
 const owns=()=>Boolean(modal.open&&q('#mt-clock-form'));
 const phaseDialog=()=>owns()&&q('#mt-clock-form').dataset.phase==='true';
 const barKey=()=>data?[data.id,data.status,data.phase,data.reminder_pending,Boolean(error)].join('|'):'';
 const counter=()=>length(data.remaining==null?data.elapsed:Math.ceil(data.remaining));
 function focusControl(op){
  const target={'clock-pause':'clock-resume','clock-resume':'clock-pause','clock-stop':'clock-setup'}[op]||op;
  q('[data-mt="'+target+'"]')?.focus({preventScroll:true});
 }
 function setupHTML(isPhase=false){
  const c=data,breakPhase=isPhase&&c.phase==='work',name=isPhase?(breakPhase?'开始休息':'开始下一段学习'):'开始计时';
  const settings=isPhase?'':field('方式',`<select id="mt-clock-kind" aria-label="计时方式">${Object.entries(kinds).map(([v,label])=>`<option value="${v}" ${v===draft.kind?'selected':''}>${label}</option>`).join('')}</select>`);
  const timing=isPhase?`<p class="sheet-status">${breakPhase?c.template.break_seconds/60:c.template.work_seconds/60} 分钟，从确认后开始计时。</p>`:
   `<div class="mt-clock-duration" ${draft.kind==='countdown'?'':'hidden'}>${field('时长（分钟）',`<input id="mt-clock-duration" type="number" min="1" max="1440" value="${draft.duration_seconds/60}">`)}</div><div class="mt-clock-duration" ${draft.kind==='pomodoro'?'':'hidden'}>${field('学习（分钟）',`<input id="mt-clock-work" type="number" min="1" max="1440" value="${draft.work_seconds/60}">`)}${field('休息（分钟）',`<input id="mt-clock-break" type="number" min="1" max="1440" value="${draft.break_seconds/60}">`)}</div>`;
  const extras=isPhase?'':sheetGroup('选项',`<label class="sheet-check"><input id="mt-clock-idle" type="checkbox" ${draft.stop_on_idle?'checked':''}><span>离开、锁屏或睡眠时停止计时</span></label><label class="sheet-check"><input id="mt-clock-last" type="checkbox" ${draft.from_last?'checked':''}><span>从今天上次标签结束处开始</span></label>`+field('提醒间隔（分钟）',`<input id="mt-clock-reminder" type="number" min="0" max="1440" value="${draft.remind_seconds/60}">`),'0 表示不提醒。'+(!model.trackingInfo?.status?.connected?' 离开检测需要记录组件在线。':''));
  const timingSection=`<div class="mt-clock-time-group" ${!isPhase&&draft.kind==='stopwatch'?'hidden':''}>${sheetGroup('时间',timing)}</div>`;
  const body=`<div id="mt-clock-form" data-phase="${isPhase}">${sheetGroup('任务',settings+field('标签',`<input id="mt-tag-text" autofocus maxlength="3000" value="${attr(draft.tags.join(', '))}">`)+tagTools.tagEntryHTML(true)+field('备注',`<textarea id="mt-tag-notes" rows="2">${attr(draft.notes)}</textarea>`,true)+`<label class="sheet-check"><input id="mt-tag-billable" type="checkbox" ${draft.billable?'checked':''}><span>可计费时间</span></label>`)}${timingSection}${extras}</div>`;
  const actions=isPhase?button('clock-stop','结束番茄')+(breakPhase?button('clock-skip','跳过休息')+button('clock-untagged','休息，不标记'):'')+button('clock-phase-submit',breakPhase?'开始休息':'开始学习','','primary'):
   button('close','取消')+(data?.last_template?button('clock-last','沿用上次计时'):'')+button('clock-start-submit','开始','','primary');
  openModal(name,body,actions,'form');tagTools.prepare();
 }
 function defaults(){return {kind:'stopwatch',tags:[],notes:'',billable:false,duration_seconds:1500,work_seconds:1500,break_seconds:300,stop_on_idle:false,remind_seconds:0,from_last:false};}
 function collect(){
  if(!owns())return;
  draft={...draft,tags:q('#mt-tag-text').value.split(',').map(v=>v.trim()).filter(Boolean),notes:q('#mt-tag-notes').value,billable:q('#mt-tag-billable').checked};
  if(phaseDialog())return;
  draft={...draft,kind:q('#mt-clock-kind').value,duration_seconds:Number(q('#mt-clock-duration').value)*60,
   work_seconds:Number(q('#mt-clock-work').value)*60,break_seconds:Number(q('#mt-clock-break').value)*60,
   stop_on_idle:q('#mt-clock-idle').checked,from_last:q('#mt-clock-last').checked,remind_seconds:Number(q('#mt-clock-reminder').value)*60};
 }
 function barHTML(){
  if(!active())return '';
  const c=data,phase=c.kind==='pomodoro'?(c.phase==='work'?'学习':'休息'):kinds[c.kind];
  const label=c.status==='awaiting'?phase+'计时已结束':c.status==='paused'?'已暂停 · '+phase:phase;
  const task=c.reminder_pending?'还在进行当前任务吗？':c.tags.join(', ')||'不标记标签';
  const commands=c.status==='awaiting'?button('clock-phase',c.phase==='work'?'安排休息':'下一段学习')+(c.phase==='work'?button('clock-skip','跳过休息'):''):
   c.reminder_pending?button('clock-reminder','继续计时'):button(c.status==='paused'?'clock-resume':'clock-pause',c.status==='paused'?'继续':'暂停');
  return `<div id="mt-clock-bar" class="mt-clock-bar" data-clock-state="${attr(barKey())}" aria-label="当前标签计时"><span class="mt-clock-state">${attr(label)}</span><span class="mt-clock-task" title="${attr(task)}">${attr(task)}</span><time aria-label="计时时长">${counter()}</time>${error?'<span id="mt-clock-error" role="status">无法更新计时</span>':''}${commands}${button('clock-stop','停止')}</div>`;
 }
 function paint(){
  if(!visible())return;
  const node=q('#mt-clock-bar');
  if(!modal.open){
   if(Boolean(node)!==Boolean(active()))render();
   else if(node){
    if(node.dataset.clockState===barKey()){
     q('time',node).textContent=counter();const task=q('.mt-clock-task',node),text=data.reminder_pending?'还在进行当前任务吗？':data.tags.join(', ')||'不标记标签';task.textContent=text;task.title=text;
    }else{const focused=node.contains(document.activeElement)?document.activeElement?.dataset.mt:null;node.outerHTML=barHTML();if(focused)focusControl(focused);}
   }
  }
  const setup=q('[data-mt=clock-setup]');if(setup)setup.disabled=Boolean(active());
  if(error)return;
  if(data?.status==='finished'&&data.events.length&&seenFinish!==data.id){
   seenFinish=data.id;toast('计时已结束，时间已保存');apiCall('clock/command',{id:data.id,action:'ack-events'}).catch(()=>{});
  }
  if(data?.status==='awaiting'&&!modal.open&&!document.hidden&&model.shotMode!=='expanded'){
   const key=data.id+'|'+data.phase+'|'+data.cycles;
   if(prompted!==key){prompted=key;openPhase();}
  }
 }
 async function read(){
  if(!visible()||busy)return;
  const ticket=++sequence;
  try{const value=await apiCall('clock');if(ticket!==sequence||!visible()||busy)return;data=value;model.tagClock=value;error='';paint();}
  catch(failure){if(ticket===sequence){error=failure.message;paint();}}
 }
 function openPhase(){
  if(!data||data.status!=='awaiting')return;
  const value=data.phase==='work'?(data.last_break||{tags:['休息'],notes:'',billable:false}):data.template;
  draft={...defaults(),...value};setupHTML(true);
 }
 async function perform(path,payload,close=false){
  if(busy)return;busy=true;const ticket=++sequence,focus=document.activeElement?.dataset.mt;
  try{
   const value=await apiCall(path,payload);if(ticket!==sequence||!visible())return value;
   data=value;model.tagClock=value;error='';
   if(close&&owns())closeModal();await load();paint();return value;
  }finally{
   busy=false;
   if(queuedStop){const id=queuedStop;queuedStop=null;await perform('clock/command',{id,action:'stop'});if(visible()&&!modal.open)focusControl('clock-stop');}
   if(visible()&&!modal.open&&focus)focusControl(focus);
  }
 }
 const operations=new Set(['clock-setup','clock-start-submit','clock-last','clock-pause','clock-resume','clock-stop','clock-reminder','clock-phase','clock-phase-submit','clock-skip','clock-untagged']);
 async function action(op){
  if(busy){if(op==='clock-stop'&&data?.id)queuedStop=data.id;return;}
  if(op==='clock-setup'){
   await read();if(error)throw Error(error);if(active())return;
   draft={...defaults(),...(data?.last_template||{}),from_last:false};setupHTML();return;
  }
  if(op==='clock-start-submit'){collect();return perform('clock/start',draft,true);}
  if(op==='clock-last')return perform('clock/start-last',{},true);
  if(op==='clock-phase')return openPhase();
  if(!data?.id)throw Error('计时状态已更改，请刷新后重试');
  const mapped={'clock-pause':'pause','clock-resume':'resume','clock-stop':'stop','clock-reminder':'ack-reminder','clock-skip':'skip-break'};
  if(mapped[op])return perform('clock/command',{id:data.id,action:mapped[op]},owns());
  if(op==='clock-phase-submit'||op==='clock-untagged'){
   collect();const value=op==='clock-untagged'?{untagged:true}:{tags:draft.tags,notes:draft.notes,billable:draft.billable};
   return perform('clock/command',{id:data.id,action:'next-phase',value},true);
  }
 }
 async function cancelPhase(){const id=data?.id;closeModal();if(id){if(busy){queuedStop=id;return;}const result=await perform('clock/command',{id,action:'stop'});if(visible()&&!modal.open)focusControl('clock-stop');return result;}}
 document.addEventListener('change',event=>{if(event.target.id==='mt-clock-kind'){collect();setupHTML();}});
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&phaseDialog())cancelPhase().catch(failure=>toast(failure.message));});
 setInterval(()=>{if(!document.hidden)read();},1000);
 function suspend(){sequence++;data=null;model.tagClock=null;prompted='';queuedStop=null;}
 return {read,barHTML,active,owns,phaseDialog,cancelPhase,suspend,handles:op=>operations.has(op),action,
  submit:()=>action(phaseDialog()?'clock-phase-submit':'clock-start-submit'),get error(){return error;}};
}};
