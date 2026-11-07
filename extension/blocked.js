(()=>{
'use strict';
const api=typeof browser!=='undefined'?browser:typeof chrome!=='undefined'?chrome:null;
let info={blocks:[],url:''};
try{const raw=location.hash.slice(1);info=raw.startsWith('url=')?{url:raw.slice(4),blocks:[]}:JSON.parse(decodeURIComponent(raw));}catch{}
const error=document.querySelector('#error');
function message(text){error.textContent=text;}
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
  const label=document.createElement('strong');label.textContent=block.name;row.append(label);
  const method=block.locked?block.lock?.type:'none';
  if(!['none','text','password'].includes(method)){
    const note=document.createElement('p');note.textContent='此规则的锁定条件不允许临时放行。';row.append(note);return row;
  }
  const choice=document.createElement('label');choice.textContent='放行时长（分钟）';
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
    if(result.tab_unblock_available===1)tabs.append(tabAction(block));
    if(!['text','delay','meal'].includes(block.break?.type))continue;
    const row=document.createElement('div');row.className='break-item';row.dataset.block=block.id;
    const label=document.createElement('span');label.textContent=block.name;
    const button=document.createElement('button');button.textContent=block.break.type==='meal'?'用餐休息':block.break.type==='text'?'输入文本休息':'等待后休息';button.disabled=block.break.type==='meal'&&!block.break.left;button.onclick=()=>requestBreak(block.id);
    row.append(label,button);breaks.append(row);
  }
  const webPage=ids.length&&/^https?:\/\//.test(info.url);
  document.querySelector('#tab-section').hidden=!webPage||result.tab_unblock_available!==1;
  document.querySelector('#break-section').hidden=!breaks.children.length;
  document.querySelector('#options').hidden=document.querySelector('#tab-section').hidden&&!breaks.children.length;
}
async function retry(){
  if(!/^https?:|^file:/.test(info.url)){message('请在地址栏重新打开原网址以检查拦截状态。');return;}
  const result=await send('check',{url:info.url,record:false});
  if(!result.blocked&&!result.error)location.replace(info.url);
  else{message(result.error||'仍有规则在拦截此标签页。');await load();}
}
function renderAgenda(result){
  const root=document.querySelector('#agenda-days');root.replaceChildren();
  const today=new Date();today.setHours(0,0,0,0);
  for(const day of (Array.isArray(result.days)?result.days:[]).slice(0,3)){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day.date)||!Array.isArray(day.items)||!day.items.length)continue;
    const date=new Date(day.date+'T00:00:00');if(!Number.isFinite(+date))continue;
    const row=document.createElement('div');row.className='agenda-day';
    const stamp=document.createElement('div');stamp.className='agenda-date';
    const title=document.createElement('strong');title.textContent=day.date===localDay(today)?'今天':day.date===localDay(new Date(today.getFullYear(),today.getMonth(),today.getDate()+1))?'明天':date.toLocaleDateString('zh-CN',{weekday:'short'});
    const subtitle=document.createElement('small');subtitle.textContent=date.toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'});stamp.append(title,subtitle);
    const content=document.createElement('div'),list=document.createElement('ul');list.className='agenda-events';
    const item=value=>{const el=document.createElement('li');el.textContent=String(value.title||'未命名事件').slice(0,200);if(value.declined)el.className='declined';return el;};
    day.items.slice(0,3).forEach(value=>list.append(item(value)));content.append(list);
    if(day.items.length>3){const more=document.createElement('details');more.className='agenda-more';const summary=document.createElement('summary');summary.textContent='另外 '+(day.items.length-3)+' 项';const extra=document.createElement('ul');extra.className='agenda-events';day.items.slice(3,20).forEach(value=>extra.append(item(value)));more.append(summary,extra);content.append(more);}
    row.append(stamp,content);root.append(row);
  }
  document.querySelector('#agenda').hidden=!root.children.length;
}
function localDay(date){return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');}
try{const url=new URL(info.url);document.querySelector('#website').textContent=url.protocol==='file:'?decodeURIComponent(url.pathname.split('/').pop()||'本地文件'):url.hostname;}catch{}
send('blocked-agenda',{}).then(result=>{if(!result?.error)renderAgenda(result||{});}).catch(()=>{});
document.querySelector('#retry').onclick=()=>retry().catch(()=>message('无法连接扩展，请重新检查。'));
load().catch(()=>message('无法连接扩展，请重新检查。'));

})();
