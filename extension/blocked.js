(()=>{
'use strict';
const api=typeof browser!=='undefined'?browser:typeof chrome!=='undefined'?chrome:null;
let info={blocks:[],url:''};
try{const raw=location.hash.slice(1);info=raw.startsWith('url=')?{url:raw.slice(4),blocks:[]}:JSON.parse(decodeURIComponent(raw));}catch{}
const error=document.querySelector('#error');
function message(text){const status=document.querySelector('#rest-status'),popup=document.querySelector('#rest-popover');if(status&&popup?.matches?.(':popover-open'))status.textContent=text;else error.textContent=text;}
async function send(op,data){if(!api?.runtime)throw Error('extension unavailable');return api.runtime.sendMessage({op,data});}
async function requestBreak(id,answer){
  const result=await send('break',{id,...(answer!==undefined?{answer}:{})});
  if(result.error){message(result.error);return;}
  const target=document.querySelector(`[data-block="${id}"]`);
  if(result.challenge){
    target.replaceChildren();
    const challenge=document.createElement('div');challenge.className='challenge';challenge.textContent=result.challenge;
    const input=document.createElement('textarea');input.placeholder='手动输入以上文本';input.addEventListener('paste',e=>e.preventDefault());
    const button=document.createElement('button');button.textContent='验证并休息';button.onclick=()=>requestBreak(id,input.value);
    target.append(challenge,input,button);
  }else if(result.ready_at){message('等待至 '+new Date(result.ready_at*1000).toLocaleTimeString()+'，然后再次申请休息。');}
  else{message('休息已开始。');await retry();}
}
function tabAction(block){
  const row=document.createElement('div');row.className='break-item';
  const label=document.createElement('strong');label.textContent='只访问这个网站';row.append(label);
  const note=document.createElement('p');note.textContent='仅当前标签页临时可用，应用拦截保持不变。';row.append(note);
  const method=block.locked?block.lock?.type:'none';
  if(!['none','text','password'].includes(method))return null;
  const choice=document.createElement('label');choice.textContent='可访问时长（分钟）';
  const minutes=document.createElement('input');minutes.type='number';minutes.min='1';minutes.max='1440';minutes.value='5';minutes.setAttribute('aria-label',block.name+'放行分钟');choice.append(minutes);row.append(choice);
  const controls=document.createElement('div');row.append(controls);
  let answer;
  const button=document.createElement('button');
  button.textContent=method==='text'?'输入文本':method==='password'?'输入密码':'临时放行';
  button.onclick=async()=>{
    button.disabled=true;message('');
    try{
      const result=await send('tab-unblock',{id:block.id,minutes:Number(minutes.value),...(answer?{answer:answer.value}:{})});
      if(result.error){message(result.error);return;}
      if(result.granted){message('当前标签页已临时放行，其他标签页保持拦截。');await retry();return;}
      if(!answer){
        if(result.challenge){const challenge=document.createElement('div');challenge.className='challenge';challenge.textContent=result.challenge;controls.append(challenge);}
        answer=document.createElement(result.method==='password'?'input':'textarea');
        answer.maxLength=5000;answer.setAttribute('aria-label',result.method==='password'?'规则密码':'验证文本');
        if(result.method==='password'){answer.type='password';answer.autocomplete='off';answer.placeholder='输入此规则的锁定密码';}
        else{answer.placeholder='手动输入以上文本';answer.addEventListener('paste',e=>e.preventDefault());answer.addEventListener('drop',e=>e.preventDefault());}
        controls.append(answer);button.textContent='验证并放行';answer.focus();
      }
    }catch{message('无法连接扩展，请重新检查。');}
    finally{button.disabled=false;}
  };
  row.append(button);return row;
}
async function load(){
  const decision=await send('check',{url:info.url,record:false});
  if(decision.error){message(decision.error);return;}
  info.blocks=decision.blocks||[];
  document.querySelector('#details').textContent=info.blocks.length?info.blocks.map(b=>b.name).join(' · '):'';
  document.querySelector('#heading').textContent=decision.blocked?'此网站已被拦截':'此网站可以访问';
  document.querySelector('#retry').textContent=decision.blocked?'重新检查':'继续访问';
  const result=await send('status');
  const ids=info.blocks.map(b=>b.id);
  const breaks=document.querySelector('#breaks');breaks.replaceChildren();
  const tabs=document.querySelector('#tab-actions');tabs.replaceChildren();
  for(const block of result.blocks||[]){
    if(!ids.includes(block.id))continue;
    if(result.tab_unblock_available===1){const action=tabAction(block);if(action)tabs.append(action);}
    const status=block.break_status||block.break||{},type=status.type;
    if(!['text','delay','meal'].includes(type))continue;
    const row=document.createElement('div');row.className='break-item';row.dataset.block=block.id;
    const label=document.createElement('strong');label.textContent=type==='meal'?'用餐休息':type==='text'?'验证后休息':'等待后休息';
    const note=document.createElement('p');note.textContent='暂停「'+block.name+'」的网站和应用拦截。';
    const button=document.createElement('button');button.className='primary';button.textContent=type==='meal'?'开始休息':type==='text'?'输入验证文本':'开始等待';button.disabled=type==='meal'&&status.left===0;
    button.onclick=async()=>{button.disabled=true;try{await requestBreak(block.id);}catch{message('暂时无法开始休息，请重试。');}finally{button.disabled=type==='meal'&&status.left===0;}};
    row.append(label,note);
    if(type==='meal'&&Number.isInteger(status.left)){const remaining=document.createElement('small');remaining.textContent=status.left?'今天还可用 '+status.left+' 次':'今天已用完';row.append(remaining);}
    row.append(button);breaks.append(row);
  }
  const webPage=ids.length&&/^https?:\/\//.test(info.url);
  document.querySelector('#tab-section').hidden=!webPage||result.tab_unblock_available!==1||!tabs.children.length;
  document.querySelector('#break-section').hidden=!breaks.children.length;
  document.querySelector('#options').hidden=document.querySelector('#tab-section').hidden&&!breaks.children.length;
  if(document.querySelector('#options').hidden&&document.querySelector('#rest-popover')?.matches?.(':popover-open'))document.querySelector('#rest-popover').hidePopover();
}
async function retry(){
  if(!/^https?:|^file:/.test(info.url)){message('请在地址栏重新打开原网址以检查拦截状态。');return;}
  const result=await send('check',{url:info.url,record:false});
  if(!result.blocked&&!result.error)location.replace(info.url);
  else{message(result.error||'');await load();await loadAgenda();}
}
function agendaStatus(text){
  const root=document.querySelector('#agenda-days'),note=document.createElement('p');note.className='agenda-status';note.textContent=text;root.replaceChildren(note);document.querySelector('#agenda').hidden=false;
}
function renderAgenda(result){
  const root=document.querySelector('#agenda-days');root.replaceChildren();
  if(result.enabled===false){document.querySelector('#agenda').hidden=true;return;}
  const days=(Array.isArray(result.days)?result.days:[]).filter(day=>/^\d{4}-\d{2}-\d{2}$/.test(day.date)&&Array.isArray(day.items));
  if(!days.some(day=>day.items.length)){agendaStatus('近三日暂无全天日程');return;}
  const today=new Date();today.setHours(0,0,0,0);
  for(let offset=0;offset<3;offset++){
    const date=new Date(today.getFullYear(),today.getMonth(),today.getDate()+offset),day=days.find(day=>day.date===localDay(date))||{date:localDay(date),items:[]};
    if(!day.items.length)continue;
    const row=document.createElement('div');row.className='agenda-day';
    const stamp=document.createElement('div');stamp.className='agenda-date';
    const title=document.createElement('strong');title.textContent=offset===0?'今天':offset===1?'明天':date.toLocaleDateString('zh-CN',{weekday:'short'});
    const subtitle=document.createElement('small');subtitle.textContent=date.toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'});stamp.append(title,subtitle);
    const content=document.createElement('div'),list=document.createElement('ul');list.className='agenda-events';
    const item=value=>{const el=document.createElement('li');el.textContent=String(value.title||'未命名事件').slice(0,200);if(value.declined)el.className='declined';const color=typeof value.color==='string'&&/^#[a-f0-9]{6}$/i.test(value.color)?value.color:'#4285f4';el.style.setProperty('--event-color',color);return el;};
    day.items.slice(0,3).forEach(value=>list.append(item(value)));content.append(list);
    if(day.items.length>3){const more=document.createElement('details');more.className='agenda-more';const summary=document.createElement('summary');summary.textContent='另外 '+(day.items.length-3)+' 项';const extra=document.createElement('ul');extra.className='agenda-events';day.items.slice(3,20).forEach(value=>extra.append(item(value)));more.append(summary,extra);content.append(more);}
    row.append(stamp,content);root.append(row);
  }
  document.querySelector('#agenda').hidden=false;
}
async function loadAgenda(){
  try{
    const current=await api?.tabs?.getCurrent?.();
    const result=await send('blocked-agenda',Number.isInteger(current?.id)?{tab:current.id}:{});
    if(result?.error){console.warn('Broccoli agenda:',result.error);agendaStatus('日程暂不可用');return;}
    renderAgenda(result||{});
  }catch(error){console.warn('Broccoli agenda unavailable');agendaStatus('日程暂不可用');}
}
function localDay(date){return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');}
try{const url=new URL(info.url);document.querySelector('#website').textContent=url.protocol==='file:'?decodeURIComponent(url.pathname.split('/').pop()||'本地文件'):url.hostname;}catch{}
const restPopup=document.querySelector('#rest-popover'),restTrigger=document.querySelector('#rest-options');
function closeRest(){restPopup.hidePopover();}
restTrigger.onclick=()=>{
  if(restPopup.matches(':popover-open')){closeRest();return;}
  document.querySelector('#rest-status').textContent='';restPopup.showPopover();
  const anchor=restTrigger.getBoundingClientRect(),box=restPopup.getBoundingClientRect();
  restPopup.style.left=Math.max(16,Math.min(innerWidth-box.width-16,anchor.left))+'px';
  restPopup.style.top=Math.max(16,anchor.bottom+10+box.height<=innerHeight-16?anchor.bottom+10:anchor.top-box.height-10)+'px';
};
document.querySelector('#rest-close').onclick=closeRest;
restPopup.addEventListener('toggle',()=>restTrigger.setAttribute('aria-expanded',String(restPopup.matches(':popover-open'))));
loadAgenda();
document.querySelector('#retry').onclick=()=>retry().catch(()=>message('无法连接扩展，请重新检查。'));
load().catch(()=>message('无法连接扩展，请重新检查。'));

})();
