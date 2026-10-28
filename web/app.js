'use strict';
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = v => JSON.parse(JSON.stringify(v));
const DAY = ['周一','周二','周三','周四','周五','周六','周日'];
const LOCK = {none:'不锁定',timer:'定时锁',range:'时段锁',text:'文本锁',password:'密码锁',delay:'等待锁',schedule:'日程锁',restart:'重启锁'};
const BREAK = {none:'不设休息',pomodoro:'番茄钟',allowance:'使用额度',reward:'专注奖励',text:'输入文本休息',delay:'等待后休息',sessions:'限制会话次数'};
const PERIOD = {day:'每天',week:'每周',month:'每月',rolling:'滚动窗口',schedule:'每个日程时段'};
let token = new URLSearchParams(location.hash.slice(1)).get('token') || sessionStorage.getItem('hot-token') || '';
if(token) sessionStorage.setItem('hot-token',token);
history.replaceState(null,'',location.pathname);
let auth = sessionStorage.getItem('hot-auth') || '';
let recoveryRequested=false;
let state, page='overview', editor=null, tab='websites', categories={}, apps=[], users=[], stats=null;
let statsSinceDate=localInput(Date.now()/1000-7*86400).slice(0,10),statsUntilDate=localInput(Date.now()/1000).slice(0,10);
let statsRange=7, statsKind='', statsQuery='', statsUser='', statsBlock='', statsMetric='seconds', statsLimit=10;
let filter='', calendarBlock='', scheduleDraft=null, drag=null, movedCalendar=false;
let editorAdditions={websites:[],applications:[]},editorImport=null,importDraft=null;
const modal=$('#modal');
const newBlock=()=>({name:'',websites:[],exceptions:['file://*'],applications:[],users:[],enabled:false,color:'#b95636',mode:'continuous',schedule:[],break:{type:'none',work_minutes:25,break_minutes:5,allowance_minutes:30,window_minutes:60,delay_minutes:1,sessions:3,text_length:30,period:'day',refill_minute:0,custom_text:'',text_mode:'characters'},autostart:{type:'none'},device:'none',device_minutes:15});
function options(values,selected){return Object.entries(values).map(([v,l])=>`<option value="${esc(v)}" ${String(v)===String(selected)?'selected':''}>${esc(l)}</option>`).join('');}
function duration(sec){sec=Math.max(0,Math.ceil(sec||0));return sec>=3600?`${Math.floor(sec/3600)} 小时 ${Math.floor(sec%3600/60)} 分`:sec>=60?`${Math.floor(sec/60)} 分 ${sec%60} 秒`:`${sec} 秒`;}
function hm(n){return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
function minute(v){const [h,m]=v.split(':').map(Number);return h*60+m;}
function dateTime(ts){return new Date(ts*1000).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:!state?.settings.clock_24});}
function field(label,html,full=false,group=false){const tag=group?'div':'label';return `<${tag} class="field ${full?'full':''}"${group?` role="group" aria-label="${esc(label)}"`:''}><span>${label}</span>${html}</${tag}>`;}
function select(name,values,value){return `<select name="${name}">${options(values,value)}</select>`;}
function num(name,value,min=1,max=57600){return `<input name="${name}" type="number" min="${min}" max="${max}" value="${esc(value)}" required>`;}
function btn(action,label,extra='',style=''){const name={'edit-interval':'编辑日程时段','remove-interval':'移除日程时段'}[action];return `<button data-action="${action}" ${extra} class="${style}"${name?` aria-label="${name}"`:''}>${label}</button>`;}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),3500);}
function canManage(){return state?.can_manage!==false;}
function allowedAction(a){return canManage()||['close','setup','break','confirm-break','export','export-stats','device-emergency','device-emergency-submit'].includes(a);}
async function api(path,data){const response=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json','X-HotTurkey-Session':auth},body:data===undefined?undefined:JSON.stringify(data)});const value=await response.json();if(!response.ok)throw Error(value.error||'操作失败');return value;}
window.HotTurkeyTextSize.configure({save:value=>api('settings',{text_scale:value}),notify:message=>toast(message)});
function openModal(title,body,actions='',kind='standard'){
 const oldFocus=modal.open&&modal.dataset.kind===kind&&$('#modal-title')?.textContent===title?document.activeElement:null;
 const focusKey=oldFocus?.dataset.action==='editor-tab'?`[data-action=editor-tab][data-tab="${CSS.escape(oldFocus.dataset.tab)}"]`:oldFocus?.id?'#'+CSS.escape(oldFocus.id):oldFocus?.name?`[name="${CSS.escape(oldFocus.name)}"]${oldFocus.type==='checkbox'?`[value="${CSS.escape(oldFocus.value)}"]`:''}`:null;
 const scrollTop=focusKey?$('.modal-content')?.scrollTop||0:0;
 modal.dataset.kind=kind;
 $('#modal-body').innerHTML=`<div class="modal-head"><h2 id="modal-title">${title}</h2>${btn('close','×','','icon-button')}</div><div class="modal-content"><div class="modal-inner">${body}<div id="modal-error" class="error" role="alert"></div></div></div><div class="modal-footer">${actions||btn('close','关闭')}</div>`;
 if(!modal.open){if(window.HotTurkeyNativeSheets&&window.HotTurkeySheet)window.HotTurkeySheet.present();else modal.showModal();}
 if(focusKey)requestAnimationFrame(()=>{const control=$(focusKey,modal);if(control){control.focus({preventScroll:true});$('.modal-content').scrollTop=scrollTop;}});
 else if(modal.open)requestAnimationFrame(()=>{const control=$('[autofocus],.modal-content input:not([type=hidden]):not(:disabled),.modal-content select:not(:disabled),.modal-content textarea:not(:disabled),.modal-content button:not(:disabled)',modal);control?.focus({preventScroll:true});});
}
function closeModal(){window.HotTurkeySheet?.cancelPending();modal.close();editor=null;scheduleDraft=null;editorImport=null;importDraft=null;}
function cancelModal(){if(scheduleDraft?.direct){$('[data-action="close"]',modal)?.click();return;}const back=$('.modal-footer [data-action="cancel-block-import"],.modal-footer [data-action="back-editor"]',modal);(back||$('[data-action="close"]',modal))?.click();}
window.HotTurkeyModal={cancel:cancelModal};
modal.addEventListener('cancel',event=>{event.preventDefault();cancelModal();});
const keyboardSubmitActions=new Set(['save-editor','save-interval','apply-block-import','auth-submit']);
modal.addEventListener('keydown',event=>{
 if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)&&!event.isComposing&&!event.defaultPrevented&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.shiftKey){
  const current=event.target.closest('.tabs>button[data-action=editor-tab]');
  if(current){const tabs=[...current.parentElement.querySelectorAll('button')],index=tabs.indexOf(current);const next=tabs[event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];event.preventDefault();next.focus();next.click();}return;
 }
 if(event.key!=='Enter'||event.defaultPrevented||event.repeat||event.isComposing||event.keyCode===229||event.altKey||event.ctrlKey||event.shiftKey)return;
 const target=event.target,primary=$('.modal-footer .primary',modal);
 if(!primary||primary.disabled||!keyboardSubmitActions.has(primary.dataset.action))return;
 if(target.closest('button,select,[contenteditable="true"]')||target.matches('input[type="date"],input[type="datetime-local"],input[type="time"],input[type="checkbox"],input[type="radio"]'))return;
 if(target.tagName==='TEXTAREA'&&!event.metaKey)return;
 event.preventDefault();primary.click();
});
function showModalError(message){const error=$('#modal-error');if(!error)return;error.textContent=message;requestAnimationFrame(()=>requestAnimationFrame(()=>error.scrollIntoView({block:'nearest'})));}
function sheetGroup(title,body,note=''){return `<section class="sheet-group">${title?`<h3>${title}</h3>`:''}<div class="sheet-group-content">${body}</div>${note?`<p class="sheet-note">${note}</p>`:''}</section>`;}
function weekdayPicker(name,days){return `<div class="weekdays">${DAY.map((day,i)=>`<label><input name="${name}" type="checkbox" value="${i}" ${days.includes(i)?'checked':''}><span>${day}</span></label>`).join('')}</div>`;}
const importOriginalNames=new WeakMap();
function prepareRuleImport(values){
 const used=new Set(state.blocks.map(block=>block.name));
 return values.map(value=>{
  const base=Array.from(String(value.name??'').trim()).slice(0,100).join('');let name=base,index=1;
  while(name&&used.has(name)){const suffix=index===1?'（导入）':`（导入 ${index}）`;name=Array.from(base).slice(0,100-Array.from(suffix).length).join('')+suffix;index++;}
  used.add(name);const draft={...value,name};if(name!==base)importOriginalNames.set(draft,base);return draft;
 });
}
function renderRuleImport(){
 const automatic=importDraft.filter(b=>b.autostart&&b.autostart.type&&b.autostart.type!=='none').length;
 const rows=importDraft.map(b=>`<li class="sheet-list-row"><span>${esc(b.name||'未命名规则')}</span>${importOriginalNames.has(b)?`<small>原名称：${esc(importOriginalNames.get(b))}</small>`:''}<small>${[Array.isArray(b.websites)&&b.websites.length?b.websites.length+' 个网站':'',Array.isArray(b.applications)&&b.applications.length?b.applications.length+' 个应用':'',b.device&&b.device!=='none'?'设备规则':''].filter(Boolean).join(' · ')}</small></li>`).join('');
 openModal('导入规则',`<p class="sheet-intro" id="import-summary" tabindex="-1" autofocus>${importDraft.length} 条规则 · 新规则默认停用</p>${sheetGroup('',`<ul class="sheet-list">${rows}</ul>`)}${automatic?sheetGroup('自动启动',`<label class="sheet-check"><input id="import-keep-autostart" type="checkbox"><span>保留 ${automatic} 条自动启动计划</span></label>`,'保留后会按原计划启用；设备规则仍需再次确认。未勾选时关闭自动启动，保留网站、应用和每周日程。'):''}`,`${btn('close','取消')}${btn('confirm-import','导入规则','','primary')}`,'form');
}
function deviceWizard(){
 const ready=state.settings.device_recovery_hash;
 const plan=field('计划名称','<input id="device-name" autofocus value="晚间强制休息" maxlength="100">')+field('开始睡眠','<input id="device-start" type="time" value="23:00">')+field('恢复使用','<input id="device-end" type="time" value="07:00">')+field('重复日期',weekdayPicker('device-day',[0,1,2,3,4,5,6]),true,true);
 const recovery=(ready?'<div class="sheet-status">已设置紧急安全词</div>':field('紧急安全词','<input id="device-word" type="password" autocomplete="new-password" minlength="6" placeholder="至少 6 个字符">')+field('再次输入','<input id="device-word-repeat" type="password" autocomplete="new-password">'))+`<label class="sheet-check"><input id="device-word-confirmed" type="checkbox"><span>我已记住安全词，知道可以紧急放行本次时段</span></label>`;
 openModal('定时睡眠',`<p class="sheet-consequence sheet-lead">生效后先倒计时 30 秒，再进入睡眠；唤醒或重新登录后仍受限制，直到时段结束。</p>${sheetGroup('计划',plan,'每周重复，支持跨午夜。')}${sheetGroup('紧急放行',recovery,'安全词只放行当前时段，之后的计划照常执行。')}${sheetGroup('启用',`<label class="sheet-check"><input id="device-enabled" type="checkbox"><span>保存后启用这项计划</span></label>`)}<p class="sheet-note">后台需要保持运行。当前用户版尚无系统级防停止保护。</p>`,`${btn('close','取消')}${btn('save-device','保存计划','','primary')}`,'form');
}
function theme(){window.HotTurkeyTextSize.sync(state.settings.text_scale);const value=state.settings.theme;document.body.dataset.appearance=value;document.body.classList.toggle('dark',value==='dark'||(value==='system'&&matchMedia('(prefers-color-scheme: dark)').matches));}
async function refresh(render=true){state=await api('state');theme();$('#clock').textContent=new Date(state.now*1000).toLocaleString('zh-CN',{weekday:'short',hour:'2-digit',minute:'2-digit',hour12:!state.settings.clock_24});const healthy=state.enforcement.enabled&&state.enforcement.desktop_connected&&!state.enforcement.worker_error;$('#connection').textContent=healthy?(state.mode==='system'?'● 系统后台正在守护':'● 本地后台正在守护'):'○ '+(state.enforcement.status==='recovering'||state.enforcement.worker_error?'正在恢复拦截':state.enforcement.enabled?'正在连接执行层':'预览模式 · 未开启系统拦截');$('#connection').classList.toggle('bad',!healthy);if(render)renderPage();}
function resetPomodoroButton(b){return b.mode==='continuous'&&b.break.type==='pomodoro'?btn('reset-pomodoro','↻ 重置番茄钟',`data-id="${b.id}" ${b.active?'':'disabled'}`,'icon-button'):'';}
function blockCard(b,compact=false){const rest=b.break_status;const detail=compact?[rest.type==='none'?'':BREAK[rest.type],rest.remaining?(rest.type==='sessions'?rest.remaining+' 次会话':duration(rest.remaining)):'',b.lock.type==='timer'&&b.locked?'解锁于 '+dateTime(b.lock.until):''].filter(Boolean).join(' · '):'';return `<article class="card"><div class="block-icon">${b.device!=='none'?'◴':'◈'}</div><div class="card-main"><h3>${canManage()?btn('edit',esc(b.name),`data-id="${b.id}"`):esc(b.name)}</h3><p>${b.device!=='none'?{lock:'锁定屏幕',sleep:'睡眠并限制使用',logout:'注销账号',shutdown:'关闭电脑'}[b.device]:[b.websites.length?`${b.websites.length} 个网站`:'',b.exceptions.length?`${b.exceptions.length} 个例外`:'',b.applications.length?`${b.applications.length} 个应用`:''].filter(Boolean).join(' · ')||'未添加拦截目标'}${b.mode==='scheduled'?`<span> · ${b.schedule.length} 组每周日程</span>`:''}</p>${detail?`<div class="card-detail">${esc(detail)}</div>`:''}</div><div class="tags"><span class="tag ${b.blocking?'green':b.active?'orange':''}">${b.device_recovery_required?'请先设置安全词':b.device_emergency_until>state.now?'本次已紧急放行':b.blocking?'正在拦截':b.active?'休息 / 额度中':b.enabled?'等待日程':'已暂停'}</span>${b.locked?`<span class="tag orange">♧ ${LOCK[b.lock.type]}</span>`:''}</div><div class="row-actions">${!canManage()?btn('break','休息',`data-id="${b.id}" ${!['text','delay'].includes(b.break.type)?'disabled':''}`,'icon-button'):compact?btn('break','休息',`data-id="${b.id}" ${!['text','delay'].includes(b.break.type)?'disabled':''}`,'icon-button'):`${btn('lock',b.locked?'解锁':'锁定',`data-id="${b.id}"`,'icon-button')}${btn('duplicate','⧉',`data-id="${b.id}" title="复制规则"`,'icon-button')}${btn('delete','×',`data-id="${b.id}" title="删除规则" ${b.locked?'disabled':''}`,'icon-button')}`}${canManage()?resetPomodoroButton(b):''}${canManage()?`<button role="switch" aria-checked="${b.enabled}" aria-label="启用 ${esc(b.name)}" class="switch ${b.enabled?'on':''}" data-action="toggle" data-id="${b.id}" ${b.locked?'disabled':''}></button>`:''}</div></article>`;}
function renderPage(){
  const titles={overview:['概览',''],blocks:['拦截规则',''],schedule:['每周日程',''],statistics:['使用统计',''],settings:['设置','']};
  $('#title').textContent=titles[page][0];$('#subtitle').textContent=titles[page][1];$$('nav button').forEach(b=>b.classList.toggle('selected',b.dataset.page===page));
  $('#header-actions').innerHTML=canManage()&&state.authenticated&&['overview','blocks','schedule'].includes(page)?(btn('new-device','◴ 定时睡眠')+btn('new','＋ 新建规则','','primary')):page==='statistics'?btn('export-stats','↓ 导出统计'):'';
  if(canManage()&&!state.authenticated&&page!=='overview'){ $('#content').innerHTML=`<div class="empty"><h2>设置已受密码保护</h2><p>输入设置密码后即可查看和管理。</p>${btn('authenticate','输入密码','','primary')}</div>`;return; }
  if(!canManage()&&page==='settings'){$('#content').innerHTML='<div class="empty"><h2>由管理账户设置</h2><p>此账户可以查看适用的规则、每周日程及自己的统计。修改规则和设置请使用管理账户。</p></div>';return;}
  if(page==='overview')renderOverview();if(page==='blocks')renderBlocks();if(page==='schedule')renderCalendar();if(page==='statistics')renderStats();if(page==='settings')renderSettings();
}
function renderOverview(){const active=state.blocks.filter(b=>b.active);const blocking=active.filter(b=>b.blocking);const upcoming=state.blocks.filter(b=>b.enabled&&b.next_start&&!b.active).sort((a,b)=>a.next_start-b.next_start);$('#content').innerHTML=`<div class="metrics"><div class="metric"><label>生效规则</label><strong>${blocking.length}</strong><small>/ ${state.blocks.length}</small></div><div class="metric"><label>拦截网站</label><strong>${new Set(blocking.flatMap(b=>b.websites)).size}</strong><small>项</small></div><div class="metric"><label>已锁定</label><strong>${state.blocks.filter(b=>b.locked).length}</strong><small>条</small></div></div><div class="section-head"><h2>正在运行</h2></div><div class="cards">${active.length?active.map(b=>blockCard(b,true)).join(''):`<div class="empty"><h3>暂无生效规则</h3>${canManage()?btn('new','新建规则'):'<p>共享规则由管理账户设置。</p>'}</div>`}</div><div class="section-head"><h2>即将开始</h2></div><div class="cards upcoming">${upcoming.length?upcoming.slice(0,5).map(b=>`<div class="card"><div class="block-icon">▦</div><div class="card-main"><h3>${esc(b.name)}</h3><p>${dateTime(b.next_start)} 开始</p></div>${b.break.type!=='none'?`<span class="tag">${BREAK[b.break.type]}</span>`:''}</div>`).join(''):'<div class="empty"><p>暂无即将开始的日程</p></div>'}</div>`;}
function renderBlocks(){const list=state.blocks.filter(b=>b.name.toLowerCase().includes(filter.toLowerCase()));$('#content').innerHTML=`<div class="toolbar"><input type="search" id="block-filter" aria-label="搜索规则" placeholder="搜索规则…" value="${esc(filter)}"><span class="grow"></span>${canManage()?btn('import','↑ 导入规则'):''}${btn('export','↓ 导出规则')}</div><div class="cards">${list.length?list.map(b=>blockCard(b)).join(''):`<div class="empty"><h3>${filter?'未找到规则':'暂无规则'}</h3>${canManage()?btn('new','＋ 新建规则','','primary'):''}</div>`}</div>`;}
function renderCalendar(){if(!state.blocks.some(b=>b.id===calendarBlock))calendarBlock=(state.blocks.find(b=>b.mode==='scheduled'&&b.schedule.length)||state.blocks[0])?.id||'';const selected=state.blocks.find(b=>b.id===calendarBlock);const today=(new Date(state.now*1000).getDay()+6)%7;const order=state.settings.week_start==='sunday'?[6,0,1,2,3,4,5]:[0,1,2,3,4,5,6];$('#content').innerHTML=`<div class="toolbar"><select id="calendar-block" aria-label="日程规则">${state.blocks.map(b=>`<option value="${b.id}" ${b.id===calendarBlock?'selected':''}>${esc(b.name)}${b.locked?' · 已锁定':''}</option>`).join('')}</select><span class="grow"></span>${canManage()?btn('calendar-add','＋ 添加时段',selected?'':'disabled'):''}</div><div class="schedule-scroller" tabindex="0" role="region" aria-label="每周日程"><div class="timeline"><div class="time-header">时间</div>${order.map(d=>`<div class="time-header ${d===today?'today':''}"><span>${DAY[d]}</span></div>`).join('')}<div class="time-labels">${Array.from({length:24},(_,i)=>`<span style="top:${i*30+5}px">${hm(i*60)}</span>`).join('')}</div>${order.map(day=>`<div class="day-column ${day===today?'today':''}" data-day="${day}">${state.blocks.flatMap(b=>b.mode==='scheduled'?b.schedule.flatMap((row,index)=>{let parts=[];if(row.days.includes(day))parts.push([row.start,row.end<row.start?1440:row.end]);if(row.end<row.start&&row.days.includes((day+6)%7))parts.push([0,row.end]);return parts.map(([s,e])=>`<button type="button" class="calendar-event" data-action="calendar-event" data-id="${b.id}" data-index="${index}" data-selected="${b.id===calendarBlock}" ${canManage()?'':'disabled'} style="top:${s/2}px;height:${Math.max(10,(e-s)/2)}px;--rule-color:${esc(b.color)}"><b>${esc(b.name)}</b><small>${hm(row.start)}–${hm(row.end)}</small></button>`);}).flat():[]).join('')}</div>`).join('')}</div></div>`;}
async function loadStats(){const since=statsRange?Date.now()/1000-statsRange*86400:new Date(statsSinceDate+'T00:00:00').getTime()/1000;const until=statsRange?Date.now()/1000:new Date(statsUntilDate+'T23:59:59').getTime()/1000;if(!Number.isFinite(since)||!Number.isFinite(until)||since>until){toast('统计日期范围无效');return;}stats=await api(`statistics?since=${since.toFixed(0)}&until=${until.toFixed(0)}&q=${encodeURIComponent(statsQuery)}&kind=${statsKind}&user=${encodeURIComponent(statsUser)}&block=${encodeURIComponent(statsBlock)}`);if(page==='statistics')renderStats();}
function renderStats(){const focused=$('#stats-query')===document.activeElement;const cursor=focused?$('#stats-query').selectionStart:0;const items=(stats?.items||[]).slice().sort((a,b)=>b[statsMetric]-a[statsMetric]).slice(0,statsLimit);const max=Math.max(1,...items.map(x=>x[statsMetric]));const days=stats?.days||[];const daymax=Math.max(1,...days.map(d=>d.seconds));$('#content').innerHTML=`<div class="toolbar"><select id="stats-range" aria-label="统计时间范围">${options({1:'最近 24 小时',7:'最近 7 天',30:'最近 30 天',90:'最近 90 天',0:'自定义日期'},statsRange)}</select>${statsRange===0?`<input id="stats-since" type="date" aria-label="统计开始日期" value="${statsSinceDate}"><span>至</span><input id="stats-until" type="date" aria-label="统计结束日期" value="${statsUntilDate}">`:''}<select id="stats-kind" aria-label="活动类型">${options({'':'所有活动',website:'网站',application:'应用'},statsKind)}</select><input type="search" id="stats-query" aria-label="搜索网站或应用" placeholder="搜索网站或应用…" value="${esc(statsQuery)}"><select id="stats-user" aria-label="统计用户">${options({'':'所有用户',...Object.fromEntries(users.map(u=>[u.name,u.label||u.name]))},statsUser)}</select><select id="stats-block" aria-label="统计规则">${options({'':'所有规则',...Object.fromEntries(state.blocks.map(b=>[b.id,b.name]))},statsBlock)}</select></div><div class="metrics"><div class="metric"><label>记录的使用时间</label><strong>${Math.round((stats?.totals?.seconds||0)/60)}</strong><small>分钟</small></div><div class="metric"><label>挡住的干扰</label><strong>${stats?.totals?.blocked||0}</strong><small>次</small></div><div class="metric"><label>活动项目</label><strong>${stats?.totals?.targets||0}</strong><small>个</small></div></div><div class="panel"><div class="section-head"><h2>使用情况</h2><div class="inline"><select id="stats-metric" aria-label="统计指标">${options({seconds:'按使用时长',blocked:'按拦截次数'},statsMetric)}</select><select id="stats-limit" aria-label="显示项目数量">${options({5:'前 5 项',10:'前 10 项',100:'全部'},statsLimit)}</select></div></div>${items.length?`<div class="usage-chart-list">${items.map(x=>`<div class="chart-row"><div class="chart-label" title="${esc(x.target)}"><span class="activity-icon" data-activity-kind="${x.kind==='website'?'website':'application'}" aria-hidden="true"></span><span>${esc(x.target)}</span></div><div class="chart-track"><div class="chart-bar" style="width:${Math.round(x[statsMetric]/max*100)}%"></div></div><div class="chart-value">${statsMetric==='seconds'?duration(x.seconds):x.blocked+' 次'}</div></div>`).join('')}</div>`:'<div class="empty"><p>暂无记录</p></div>'}</div><div class="panel"><h2>每日使用时间</h2><div class="day-chart">${days.map(d=>`<div class="day-bar" title="${d.day} ${duration(d.seconds)}"><div style="height:${Math.round(d.seconds/daymax*100)}px"></div><span>${esc(d.day.slice(5))}</span></div>`).join('')||'<p class="help">暂无记录</p>'}</div></div>`;if(focused){$('#stats-query').focus();$('#stats-query').setSelectionRange(cursor,cursor);}}
function settingToggle(key,title,description){const pending=state.mode==='system'&&!state.system_session?.desktop_login?.supported&&['open_at_login','start_in_tray'].includes(key);return `<div class="settings-row"><div><h3>${title}</h3><p>${pending?'系统模式的登录启动尚待安装支持。':state.mode==='system'&&['open_at_login','start_in_tray'].includes(key)?'在下次登录时生效；关闭界面或唤醒电脑不会重复弹出。':description}</p></div><input type="checkbox" data-setting="${key}" aria-label="${title}" ${state.settings[key]?'checked':''} ${pending?'disabled':''}></div>`;}
function renderSettings(){const s=state.settings;$('#content').innerHTML=`<div class="panel"><h2>通用</h2><div class="settings-row"><h3>界面主题</h3><select data-setting="theme" aria-label="界面主题">${options({light:'浅色',dark:'深色',system:'跟随系统'},s.theme)}</select></div><div class="settings-row"><div><h3>界面大小</h3></div><select id="text-scale" aria-label="界面大小">${options(Object.fromEntries([...new Set([...Array.from({length:16},(_,i)=>50+i*10),75,125,175,window.HotTurkeyTextSize.value])].sort((a,b)=>a-b).map(v=>[v,v+'%'])),window.HotTurkeyTextSize.value)}</select></div><div class="settings-row"><h3>每周起始日</h3><select data-setting="week_start" aria-label="每周起始日">${options({monday:'周一',sunday:'周日'},s.week_start)}</select></div>${settingToggle('clock_24','24 小时制','')}${settingToggle('open_at_login','登录时打开桌面界面','后台始终独立运行。')}${settingToggle('start_in_tray','登录时只显示菜单栏图标','')}${settingToggle('notifications','桌面通知','')}<div class="settings-row"><div><h3>提前提醒（分钟）</h3><p>多个时间用逗号分隔。</p></div><input id="warning-minutes" aria-label="提前提醒（分钟）" value="${s.warning_minutes.join(',')}"></div><p>${btn('notifications','允许 macOS 通知')}</p></div><div class="panel"><h2>拦截严格度</h2><p>锁定期间不可更改。</p>${settingToggle('block_inactive','拦截后台标签页','')}${settingToggle('block_embeds','拦截嵌入内容','')}${settingToggle('allow_files','始终允许本地文件','')}${settingToggle('require_extension','锁定时要求浏览器扩展在线','超过宽限期未收到扩展心跳后关闭受支持的浏览器。')}${settingToggle('block_unsupported','锁定时关闭已知不受支持浏览器','包括 Safari、Tor、Arc、Dia 和 Orion；当前版本尚无 Safari 签名扩展。')}${settingToggle('block_task_manager','锁定时拦截活动监视器','')}${settingToggle('block_settings','锁定时拦截系统设置','拦截整个“系统设置”应用。')}${settingToggle('block_installer','锁定时拦截安装器','')}<div class="settings-row"><div><h3>扩展连接宽限期（秒）</h3></div><input type="number" data-setting="extension_grace" aria-label="扩展连接宽限期（秒）" min="5" max="600" value="${s.extension_grace}"></div></div><div class="panel"><h2>隐私与额度计时</h2>${settingToggle('statistics','记录使用统计','网站只保存域名；拦截事件包含命中的地址。')}${settingToggle('incognito_statistics','记录隐私窗口统计','扩展必须获得隐私窗口运行权限。')}${settingToggle('strict_usage','严格计算使用额度','后台标签页也计入额度。')}<div class="settings-row"><div><h3>闲置停止计时（秒）</h3><p>视频播放期间继续计时。</p></div><input type="number" data-setting="idle_seconds" aria-label="闲置停止计时（秒）" min="30" max="3600" value="${s.idle_seconds}"></div><div class="settings-row"><h3>统计保留天数</h3><input type="number" data-setting="retention_days" aria-label="统计保留天数" min="1" max="3650" value="${s.retention_days}"></div><div class="toolbar">${btn('export-stats','导出统计 JSON')}${btn('clear-stats','删除统计记录','','danger')}</div></div><div class="panel"><h2>设备限制安全出口</h2><p>安全词只放行本次时段，下一次计划仍会执行。</p>${btn('device-recovery-configure',s.device_recovery_hash?'更改紧急安全词':'设置紧急安全词')}${btn('device-emergency','紧急放行设备限制')}</div><div class="panel"><h2>设置密码</h2><p>管理规则、设置和统计时需要验证。</p>${settingToggle('protect_overview','同时保护概览','未验证时隐藏规则列表。')}<div class="toolbar">${btn('settings-password',s.settings_password?'修改 / 移除密码':'设置密码')}${s.settings_password?btn('logout-auth','锁定管理界面'):''}</div></div><div class="panel"><h2>后台与浏览器</h2><p>执行层：${state.enforcement.enabled?'已启用':'预览模式'} · ${state.mode==='system'?'系统执行器与会话':'桌面执行器'}：${state.enforcement.desktop_connected?'在线':'未连接'}${state.mode==='system'?'':' · 登录启动：'+(state.enforcement.launch_agent?'已安装':'未安装')}</p>${state.enforcement.worker_error?`<div class="hint">${esc(state.enforcement.worker_error)}</div>`:''}<p>${state.mode==='system'?'当前管理系统后台中的共享规则；系统执行层与会话连接状态如下。':''}</p>${btn('setup','打开安装说明')}</div>`;}
function collectEditor(){if(!editor)return;const scope=$('#editor-panel');if(!scope)return;if(editor.locked){for(const key of ['websites','applications']){const input=$(`[name=append_${key}]`,scope);if(input)editorAdditions[key]=input.value.split('\n').map(s=>s.trim()).filter(Boolean);}return;}$$('[name]',scope).forEach(el=>{if(el.name.startsWith('break.')){const key=el.name.slice(6);editor.break[key]=el.type==='number'?Number(el.value):key==='refill_minute'?minute(el.value):el.value;}else if(el.name==='autostart.type'){editor.autostart.type=el.value;}else if(el.name==='auto_at'){editor.autostart.at=new Date(el.value).getTime()/1000;}else if(el.name==='auto_minute'){editor.autostart.minute=minute(el.value);editor.autostart.days=[0,1,2,3,4,5,6];}else if(['websites','exceptions','applications','users'].includes(el.name)){editor[el.name]=el.value.split('\n').map(s=>s.trim()).filter(Boolean);}else{editor[el.name]=el.type==='number'?Number(el.value):el.value;}});const name=$('#editor-name');if(name)editor.name=name.value;}
function editBlock(id){editorImport=null;editor=id?clone(state.blocks.find(b=>b.id===id)):newBlock();editorAdditions={websites:[],applications:[]};tab='websites';renderEditor();}
function renderEditor(){if(editor.locked)return renderLockedEditor();const b=editor;let body='';if(['websites','exceptions'].includes(tab)){body=`<textarea name="${tab}" aria-label="${tab==='websites'?'屏蔽的网站':'允许的网站例外'}" rows="10" placeholder="${tab==='websites'?'reddit.com\nyoutube.com/@channel\n*关键词*':'docs.google.com\nfile://*'}">${esc(b[tab].join('\n'))}</textarea><div class="toolbar">${btn('category','＋ 导入分类')}${btn('import-other-blocks','↑ 从其他规则导入')}${btn('import-lines','↑ 从文本导入')}${btn('export-lines','↓ 导出列表')}${tab==='websites'?btn('whole-internet','拦截整个互联网'):''}</div>`;}if(tab==='applications'){body=`<textarea name="applications" aria-label="屏蔽的应用" rows="7" placeholder="bundle:com.example.app\nfolder:/Applications/Games\nbinary:/path/to/program">${esc(b.applications.join('\n'))}</textarea><div class="toolbar">${btn('pick-app','＋ 选择应用')}${btn('pick-folder','＋ 文件夹')}${btn('pick-binary','＋ 可执行文件')}</div><select id="app-picker" aria-label="从已安装应用中添加"><option value="">从已安装应用中添加…</option>${apps.map(a=>`<option value="${esc(a.bundle?'bundle:'+a.bundle:a.path)}">${esc(a.name)}</option>`).join('')}</select>`;}if(tab==='schedule'){body=`${field('运行方式',select('mode',{continuous:'持续生效',scheduled:'按每周日程'},b.mode))}<p class="help">结束时间早于开始时间表示次日。</p>${b.schedule.map((r,i)=>`<div class="interval"><span>${r.days.map(d=>DAY[d]).join('、')} · ${hm(r.start)}–${hm(r.end)}${r.break?' · '+BREAK[r.break.type]:''}</span><div>${btn('edit-interval','编辑',`data-index="${i}"`,'icon-button')}${btn('remove-interval','×',`data-index="${i}"`,'icon-button')}</div></div>`).join('')}${btn('add-interval','＋ 添加日程时段')}`;}if(tab==='break'){body=breakForm(b.break);}if(tab==='other'){body=`<div class="form-grid">${field('规则颜色',`<input type="color" name="color" value="${esc(b.color)}">`)}${field('设备动作',select('device',{none:'常规网站 / 应用规则',lock:'锁屏',sleep:'睡眠',logout:'注销账号',shutdown:'关机'},b.device))}${field('持续设备拦截时长（分钟）',num('device_minutes',b.device_minutes||15,1,1440))}${field('自动启动',select('autostart.type',{none:'不自动启动',once:'指定时间启动一次',daily:'每天指定时间启动',signin:'登录或唤醒时启动',schedule:'下个日程时段启动'},b.autostart.type))}${b.autostart.type==='once'?field('启动时间',`<input name="auto_at" type="datetime-local" value="${localInput(b.autostart.at||Date.now()/1000+3600)}">`):b.autostart.type==='daily'?field('每天启动时间',`<input name="auto_minute" type="time" value="${hm(b.autostart.minute||540)}">`):''}${field('影响的用户（每行一个登录用户名，留空为当前服务用户）',`<textarea name="users" rows="3" placeholder="${esc(state.user)}">${esc(b.users.join('\n'))}</textarea>`,true)}</div><p class="help">可选用户：${users.map(u=>esc(u.name)).join('、')||esc(state.user)}。当前为每用户后台；影响其他账号需要在该账号安装后台。设备动作将在规则生效时执行，请先保存并检查日程。</p>`;}
  openModal(b.id?'编辑规则':'新建规则',`${field('规则名称',`<input id="editor-name" autofocus maxlength="100" value="${esc(b.name)}" placeholder="例如：深度工作">`)}<div class="tabs">${Object.entries({websites:'网站',exceptions:'网站例外',applications:'应用',schedule:'日程',break:'休息',other:'更多'}).map(([key,label])=>`<button data-action="editor-tab" data-tab="${key}" class="${tab===key?'active':''}">${label}</button>`).join('')}</div><div id="editor-panel">${body}</div>`,`${btn('close','取消')}${btn('save-editor','保存规则','','primary')}`);
}
function openBlockImport(){
  collectEditor();
  if(!['websites','exceptions'].includes(tab))throw Error('请先选择网站或网站例外');
  editorImport={target:tab,source:'websites',ids:[],blocks:state.blocks.filter(b=>b.id!==editor.id).map(b=>({id:b.id,name:b.name,websites:[...b.websites],exceptions:[...b.exceptions]}))};
  renderBlockImport();
}
function collectBlockImport(){
  editorImport.ids=$$('[name=block-import]:checked').map(el=>el.value);
  editorImport.source=$('#block-import-source').value;
}
function blockImportValues(){
  return [...new Set(editorImport.blocks.filter(b=>editorImport.ids.includes(b.id)).flatMap(b=>b[editorImport.source]))];
}
function renderBlockImport(){
  const value=editorImport,values=blockImportValues(),target=value.target==='websites'?'屏蔽网站':'网站例外';
  const existing=new Set([...editor[value.target],...(editor.locked?editorAdditions[value.target]:[])]);
  const additions=values.filter(v=>!existing.has(v));
  const sources=value.blocks.length?value.blocks.map(b=>`<label class="sheet-check"><input type="checkbox" name="block-import" value="${esc(b.id)}" ${value.ids.includes(b.id)?'checked':''} ${b[value.source].length?'':'disabled'}><span>${esc(b.name)} <small>· ${b[value.source].length} 项</small></span></label>`).join(''):'<div class="sheet-status">还没有可导入的其他规则</div>';
  openModal('从其他规则导入',`${sheetGroup('来源',field('导入内容',`<select id="block-import-source">${options({websites:'屏蔽网站',exceptions:'网站例外'},value.source)}</select>`)+sources,`复制到当前规则的${target}。来源规则保持不变，保存当前规则后生效。`)}<p class="sheet-note">已选择 ${values.length} 个不重复项目，其中 ${additions.length} 个为新增。</p>${values.length?sheetGroup('预览',field('前 20 项',`<textarea readonly rows="5">${esc(values.slice(0,20).join('\n'))}</textarea>`,true)):''}`,`${btn('cancel-block-import','返回编辑')}${btn('apply-block-import','合并到当前列表',values.length?'':'disabled','primary')}`,'form');
}
function editorTargets(){return editor.locked?editorAdditions:editor;}
function appendEditorTargets(key,values){const targets=editorTargets();targets[key]=[...new Set([...targets[key],...values])];}
function renderLockedEditor(){
  if(!['websites','applications'].includes(tab))tab='websites';
  const b=editor,isWeb=tab==='websites',label=isWeb?'网站':'应用';
  const existing=field('已屏蔽的'+label,`<textarea rows="3" readonly aria-label="已屏蔽的${label}">${esc(b[tab].join('\n'))}</textarea>`);
  const additions=field('新增屏蔽'+label,`<textarea name="append_${tab}" autofocus rows="5" placeholder="${isWeb?'每行一个网站，例如 reddit.com':'每行一个应用，例如 bundle:com.example.app'}">${esc(editorAdditions[tab].join('\n'))}</textarea>`);
  const tools=isWeb?`${btn('category','＋ 导入分类')}${btn('import-other-blocks','↑ 从其他规则导入')}${btn('import-lines','↑ 从文本导入')}${btn('whole-internet','拦截整个互联网')}`:`${btn('pick-app','＋ 选择应用')}${btn('pick-folder','＋ 文件夹')}${btn('pick-binary','＋ 可执行文件')}`;
  const picker=isWeb?'':`<select id="app-picker" aria-label="从已安装应用中添加" aria-label="从已安装应用中添加"><option value="">从已安装应用中添加…</option>${apps.map(a=>`<option value="${esc(a.bundle?'bundle:'+a.bundle:a.path)}">${esc(a.name)}</option>`).join('')}</select>`;
  const tabs=Object.entries({websites:'网站',applications:'应用'}).map(([key,title])=>`<button data-action="editor-tab" data-tab="${key}" class="${tab===key?'active':''}">${title}</button>`).join('');
  openModal('为锁定规则新增屏蔽',`<div class="hint">锁定期间只能追加网站和应用。其他修改须先解锁。</div>${field('规则名称',`<input value="${esc(b.name)}" readonly>`)}<div class="tabs">${tabs}</div><div id="editor-panel">${existing}${additions}<div class="toolbar">${tools}${btn('export-lines','↓ 导出列表')}</div>${picker}</div>`,`${btn('close','取消')}${btn('add-targets','保存新增屏蔽','','primary')}`);
}
function breakForm(b,prefix='break.'){
 let rows=field('休息方式',select(prefix+'type',BREAK,b.type));
 if(['pomodoro','reward'].includes(b.type))rows+=field('专注时长（分钟）',num(prefix+'work_minutes',b.work_minutes));
 if(['pomodoro','reward','text','delay'].includes(b.type))rows+=field('休息时长（分钟）',num(prefix+'break_minutes',b.break_minutes,1,1440));
 if(b.type==='allowance')rows+=field('可用额度（分钟）',num(prefix+'allowance_minutes',b.allowance_minutes));
 if(['allowance','reward','sessions'].includes(b.type)){
  rows+=field('补充周期',select(prefix+'period',b.type==='allowance'?PERIOD:Object.fromEntries(Object.entries(PERIOD).filter(([k])=>k!=='rolling')),b.period==='rolling'&&b.type!=='allowance'?'day':b.period));
  if(b.period==='rolling'&&b.type==='allowance')rows+=field('滚动窗口（分钟）',num(prefix+'window_minutes',b.window_minutes));
  else if(b.period!=='schedule')rows+=field('额度刷新时间',`<input name="${prefix}refill_minute" type="time" value="${hm(b.refill_minute||0)}">`);
 }
 if(b.type==='sessions')rows+=field('可用会话次数',num(prefix+'sessions',b.sessions,1,10000));
 if(b.type==='text')rows+=field('随机文本',select(prefix+'text_mode',{characters:'随机字符',words:'随机单词'},b.text_mode||'characters'))+field('文本长度',num(prefix+'text_length',b.text_length,1,5000))+field('自定义文本',`<textarea name="${prefix}custom_text" rows="3" placeholder="可选，留空则随机生成">${esc(b.custom_text)}</textarea>`,true);
 if(b.type==='delay')rows+=field('等待时间（分钟）',num(prefix+'delay_minutes',b.delay_minutes));
 const notes={none:'',pomodoro:'专注和休息按设定时长交替。',allowance:'额度只计算实际使用，闲置时暂停。',reward:'使用未被此规则拦截的网站或应用时累积专注奖励。',text:'输入指定文本后开始休息。',delay:'请求休息后，须先等待设定的时长。',sessions:'停止使用两分钟后结束本次会话。'};
 return sheetGroup('',rows,notes[b.type]||'');
}

function localInput(ts){const d=new Date(ts*1000);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
function intervalModal(index,day=0,start=540,end=1020){
 collectEditor();scheduleDraft={index,row:index===null?{days:[day],start,end}:clone(editor.schedule[index]),back:tab};const r=scheduleDraft.row;
 const period=field('开始时间',`<input type="time" id="span-start" value="${hm(r.start)}">`)+field('结束时间',`<input type="time" id="span-end" value="${hm(r.end%1440)}">`)+field('重复日期',weekdayPicker('span-day',r.days),true,true);
 openModal('编辑日程时段',`${sheetGroup('时间',period,'结束早于开始时跨午夜；00:00 表示午夜。同一规则的时段不能重叠。')}${sheetGroup('休息',`<label class="sheet-check"><input id="span-custom" type="checkbox" ${r.break?'checked':''}><span>此时段使用独立休息设置</span></label>`)}<div id="span-break">${r.break?breakForm(r.break,'span.'):''}</div>`,`${btn('back-editor','返回')}${btn('save-interval','保存时段','','primary')}`,'form');
}

function lockModal(id){const b=state.blocks.find(b=>b.id===id);if(b.lock.automatic_device)return openModal('强制休息时段中',`<p>此设备计划在当前时段自动保护。${b.device_until?'结束于 '+dateTime(b.device_until):''}；如需紧急使用，请输入安全词。</p>`,`${btn('close','关闭')}${btn('device-emergency','输入紧急安全词','','primary')}`);if(b.locked)return lockedRuleModal(b);openModal('锁定规则',`<div class="lock-form"><div class="lock-row"><span>规则</span><strong class="lock-rule-name">${esc(b.name)}</strong></div>${lockField('锁定方式',`<span class="lock-picker"><select id="lock-type" aria-label="锁定方式">${options(LOCK,'timer')}</select><svg viewBox="0 0 12 16" aria-hidden="true"><path d="m3 6 3-3 3 3M3 10l3 3 3-3"/></svg></span>`)}<div id="lock-fields"></div></div><p id="lock-description" class="lock-note" aria-live="polite"></p><p class="lock-note lock-permission">锁定期间仍可新增屏蔽的网站和应用。</p>`,`${btn('close','取消')}${btn('apply-lock','锁定规则',`data-id="${id}"`,'primary')}`,'lock');renderLockFields();}
function lockedRuleModal(b){
 const l=b.lock,id=b.id,textLength=Array.from(l.text||'').length;
 let details=lockField('规则',`<strong class="lock-rule-name">${esc(b.name)}</strong>`)+lockField('锁定方式',`<span>${LOCK[l.type]}</span>`);
 if(l.until)details+=lockField('解锁时间',`<span class="lock-date">${dateTime(l.until)}</span>`);
 if(l.type==='timer')details+=lockField('延长至',`<input id="extend-until" type="datetime-local" aria-label="延长锁定至" value="${localInput(l.until+1800)}">`);
 if(l.type==='password')details+=lockField('密码','<input id="unlock-answer" type="password" autofocus aria-label="解锁密码" autocomplete="off">');
 if(l.type==='delay')details+=lockField('等待时间',`<span>${l.minutes} 分钟</span>`)+(l.ready_at?lockField('可解锁于',`<span class="lock-date">${dateTime(l.ready_at)}</span>`):'');
 let body=`<div class="lock-form">${details}</div>`;
 if(l.type==='text')body+=`<div class="lock-challenge"><p class="lock-note">输入以下文本</p><div class="challenge">${esc(l.text)}</div></div><div class="lock-form">${lockField('验证文本','<textarea id="unlock-answer" rows="3" aria-label="验证文本" autocomplete="off" spellcheck="false"></textarea>',true)}${textLength<5000?lockField('增加至',`<span class="lock-unit"><input id="extend-text-length" type="number" aria-label="增加验证文本长度" min="${textLength+1}" max="5000" value="${Math.min(5000,textLength+50)}"><span>字符</span></span>`):''}</div>`;
 const notes={timer:'结束时间只能延后，到期后自动解除。',password:'输入设置的密码以解锁规则。',text:`当前 ${textLength} 字符。增加长度会保留原文，并在末尾追加内容。`,delay:l.ready_at?'等待结束后，再次验证即可解锁。':'开始等待后，须经过设定的时长才能解锁。',restart:'重启电脑后解除锁定。',range:'当前处于受保护的时段，时段结束后可修改。',schedule:'当前日程正在保护中，结束后可修改。'};
 body+=`<p class="lock-note">${notes[l.type]||''}</p><p class="lock-note lock-permission">锁定期间仍可新增屏蔽的网站和应用。</p>`;
 const canVerify=['password','text','delay'].includes(l.type);
 const controls=btn('close',canVerify?'取消':'完成')+(l.type==='timer'?btn('extend-lock','延长锁定',`data-id="${id}"`,'primary'):'')+(l.type==='text'&&textLength<5000?btn('extend-text-lock','增加长度',`data-id="${id}"`):'')+(canVerify?btn('unlock',l.type==='delay'&&!l.ready_at?'开始等待':'解锁规则',`data-id="${id}"`,'primary'):'');
 openModal(canVerify?'解锁规则':'规则已锁定',body,controls,'lock');
}
function lockField(label,html,wide=false,group=false){const tag=group?'div':'label';return `<${tag} class="lock-row${wide?' lock-row-wide':''}"${group?` role="group" aria-label="${esc(label)}"`:''}><span>${label}</span><span class="lock-value">${html}</span></${tag}>`;}
function renderLockFields(){
 const type=$('#lock-type').value;
 const descriptions={none:'规则可以随时修改。',timer:'到期前无法暂停或删除规则。结束时间只能延后。',password:'输入密码后才能修改、暂停或删除规则。',text:'输入指定文本后才能解锁。锁定后只能增加文本长度。',delay:'请求解锁后，须等待设定的时长。',schedule:'日程生效期间禁止修改；可提前保护即将开始的日程。',range:'在选定日期和时段内限制修改。结束时间早于开始时间表示次日。',restart:'锁定后需要重启电脑才能解锁。'};
 $('#lock-description').textContent=descriptions[type];
 $('#lock-fields').innerHTML=type==='timer'?lockField('解锁时间',`<input id="lock-until" type="datetime-local" aria-label="解锁时间" value="${localInput(Date.now()/1000+3600)}">`)
 :type==='password'?lockField('密码','<input id="lock-password" type="password" aria-label="锁定密码" autocomplete="new-password" placeholder="输入密码">')
 :type==='text'?lockField('文本内容','<select id="lock-text-mode" aria-label="文本内容"><option value="characters">随机字符</option><option value="words">随机单词</option></select>')+lockField('文本长度',num('lock-length',50,1,5000))+lockField('自定义文本','<textarea id="lock-custom" rows="3" aria-label="自定义文本" placeholder="可选，留空则随机生成"></textarea>',true)
 :type==='delay'?lockField('等待时间',`<span class="lock-unit">${num('lock-delay',1)}<span>分钟</span></span>`)
 :type==='schedule'?lockField('提前保护',`<span class="lock-unit">${num('lock-before',0,0,1440)}<span>分钟</span></span>`)
 :type==='range'?lockField('开始时间','<input id="lock-start" type="time" aria-label="开始时间" value="09:00">')+lockField('结束时间','<input id="lock-end" type="time" aria-label="结束时间" value="17:00">')+lockField('重复',`<span class="lock-days">${DAY.map((d,i)=>`<label><input name="lock-day" type="checkbox" aria-label="${d}" value="${i}" checked><span>${d.slice(1)}</span></label>`).join('')}</span>`,true,true)+`<label class="lock-row lock-row-wide check"><input id="lock-allow" type="checkbox">仅在此时段允许修改</label>`:'';
}

async function setup(){
 if(state?.mode==='system')return openModal('系统保护模式','<p>此窗口管理系统后台中的共享规则。当前用户安装器不适用于此模式。</p><p>如执行层或会话代理离线，请检查系统安装与会话服务。规则和锁定仍由系统后台保存。</p>','','compact');
 const desktop=!!window.webkit?.messageHandlers?.native;
 openModal('连接浏览器与后台',`<div class="hint">${state.enforcement.enabled?'本地拦截已启用。':'请在 macOS 桌面应用中安装后台。'} ${state.enforcement.desktop_connected?'桌面执行器在线。':''}</div>
 <div class="setup-list"><div><b>1 · 安装当前用户后台</b><p>应用已包含所需运行时。安装后会登录自动启动，并保留现有规则和浏览器连接。首次安装时扩展 ID 可以留空，完成下面两步后再填入并更新一次。</p>
 ${desktop?`${field('浏览器扩展 ID（已有连接可留空；多个 ID 用空格分隔）','<input id="install-extension-ids" placeholder="32 位扩展 ID" autocomplete="off">')}${btn('install-backend','安装 / 更新当前用户后台','','primary')}`:'<p>请打开 HotTurkey 桌面应用，点击本页的安装按钮。</p>'}</div>
 <div><b>2 · 在浏览器中加载扩展</b><p>安装后台后，在 Edge、Chrome 或 Brave 的扩展管理页开启开发者模式，选择“加载解压缩的扩展”，再选取下面的文件夹。</p>
 ${field('扩展文件夹',`<input readonly value="${esc(state.enforcement.extension_path||'请先安装后台')}" aria-label="扩展文件夹">`)}
 <p>复制浏览器显示的扩展 ID，填入上方，再点击“安装 / 更新当前用户后台”。</p></div>
 <div><b>3 · 允许扩展运行</b><p>如需在隐私窗口中拦截，请在浏览器里允许扩展在隐私窗口运行；拦截本地文件还需允许访问文件网址。</p><p>Firefox 扩展永久安装仍需要 Mozilla 签名；Safari 扩展尚未完成。</p></div>
 <div><b>连接状态</b>${Object.entries(state.extensions).map(([name,e])=>`<p>${esc(name)} · ${state.now-e.at<15?'在线':'离线'} · 隐私窗口 ${e.incognito?'✓':'未授权'} · 本地文件 ${e.files?'✓':'未授权'}</p>`).join('')||'<p>尚未收到扩展心跳。</p>'}</div>
 <div><b>当前保护范围</b><p>后台只运行在当前用户账户中。系统级防卸载、防篡改和跨账号强制保护尚未完成。</p></div></div>`);
}
function download(name,value,type='application/json'){const blob=new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)],{type});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
async function readFile(accept){return new Promise((resolve,reject)=>{
 const input=document.createElement('input');input.type='file';input.accept=accept;input.hidden=true;
 const finish=value=>{input.remove();resolve(value);};
 input.onchange=async()=>{try{finish(input.files[0]?await input.files[0].text():null);}catch(error){input.remove();reject(error);}};
 input.oncancel=()=>finish(null);
 // WebKit must retain the input while its native chooser is open. Keep it in
 // the active dialog, where it is not made inert by HTML modal presentation.
 (modal.open?modal:document.body).appendChild(input);
 try{input.click();}catch(error){input.remove();reject(error);}
});}

window.receiveInstallationResult=result=>{const button=$('[data-action=install-backend]');if(button)button.disabled=false;if(result.ok){closeModal();toast('当前用户后台已安装，浏览器连接已保留');}else{const error=$('#modal-error');if(error)error.textContent=result.message||'安装失败';}};
window.receiveApps=values=>{if(!editor)return;collectEditor();appendEditorTargets('applications',values);renderEditor();};
async function action(a,el){if(!allowedAction(a))throw Error('此账户可查看规则和自己的统计，修改请使用管理账户');const id=el.dataset.id;const b=state.blocks.find(b=>b.id===id);
 if(a==='new-device')return deviceWizard();
 if(a==='save-device'){
  if(!$('#device-word-confirmed').checked)throw Error('请先确认已记住紧急安全词');
  const days=$$('[name=device-day]:checked').map(x=>Number(x.value));if(!days.length)throw Error('请至少选择一天');
  const start=minute($('#device-start').value),end=minute($('#device-end').value)||1440;
  if(!Number.isFinite(start)||!Number.isFinite(end)||start===end)throw Error('请设置不同的开始与结束时间');
  const name=$('#device-name').value.trim();if(!name)throw Error('请输入计划名称');
  const enabled=$('#device-enabled').checked;
  const configured=state.settings.device_recovery_hash;
  const word=$('#device-word')?.value;
  if(!configured&&(typeof word!=='string'||Array.from(word).length<6||word!==$('#device-word-repeat').value))throw Error('安全词至少 6 个字符，且两次输入须一致');
  if(enabled&&!confirm(`启用“${name}”：${days.map(day=>DAY[day]).join('、')} ${hm(start)}–${hm(end)}${end<start?'（次日恢复）':''}？时段内唤醒或重新登录后仍会受到限制；安全词可紧急放行本次时段。`))return;
  if(!configured){await api('device/configure-recovery',{word});await refresh(false);}
  await api('blocks/save',{block:{...newBlock(),name,device:'sleep',mode:'scheduled',schedule:[{days,start,end}],enabled,confirm_device:true}});
  closeModal();await refresh();toast(enabled?'睡眠计划已启用':'睡眠计划已保存，暂未启用');return;
 }
 if(a==='device-emergency')return openModal('紧急放行',`${sheetGroup('',field('安全词','<input id="device-emergency-word" type="password" autofocus autocomplete="off">'),'只放行当前这一次限制，下一次计划仍会执行。无需管理密码。')}${canManage()&&state.authenticated?sheetGroup('计划',`<label class="sheet-check"><input id="device-stop-plan" type="checkbox"><span>同时停用当前设备计划及自动启动（管理员）</span></label>`):''}`,`${btn('close','取消')}${btn('device-emergency-submit','放行本次限制','','primary')}`,'form');
 if(a==='device-emergency-submit'){const stop_plan=$('#device-stop-plan')?.checked===true;if(stop_plan&&!confirm('永久停用当前设备计划并取消其自动启动？网站和应用规则保持原样。'))return;const result=await api('device/recover',{word:$('#device-emergency-word').value,stop_plan});closeModal();await refresh();toast(result.stopped?'设备计划已紧急停用':'本次设备限制已放行至 '+dateTime(result.until));return;}
 if(a==='device-recovery-configure')return openModal('设置安全词',sheetGroup('',field('新安全词','<input id="recovery-new" type="password" autofocus autocomplete="new-password" placeholder="至少 6 个字符">')+field('再次输入','<input id="recovery-repeat" type="password" autocomplete="new-password">')+(state.settings.device_recovery_hash?field('原安全词','<input id="recovery-old" type="password" autocomplete="off">'):''),'设备规则锁定时，需要原安全词才能更改。'),`${btn('close','取消')}${btn('device-recovery-save','保存安全词','','primary')}`,'form');
 if(a==='device-recovery-save'){const word=$('#recovery-new').value;if(word!==$('#recovery-repeat').value)throw Error('两次安全词不一致');await api('device/configure-recovery',{word,previous_word:$('#recovery-old')?.value});closeModal();toast('紧急安全词已保存');await refresh();return;}
 if(a==='close'){if(editorImport){editorImport=null;return renderEditor();}return closeModal();}
 if(a==='new')return editBlock();if(a==='edit')return editBlock(id);
 if(a==='setup')return setup();
 if(a==='install-backend'){if(!window.webkit?.messageHandlers?.native)throw Error('请在 macOS 桌面应用中安装后台');const ids=($('#install-extension-ids')?.value||'').split(/[\s,]+/).filter(Boolean);if(ids.some(id=>!/^[a-p]{32}$/.test(id)))throw Error('扩展 ID 应为 32 位 a–p 字母');el.disabled=true;window.webkit.messageHandlers.native.postMessage({op:'install',extensionIDs:ids});return;}
 if(a==='toggle'){const enabled=!b.enabled;const yes=!enabled||b.device==='none'||confirm(`启用“${b.name}”将执行${{lock:'锁屏',sleep:'睡眠',logout:'注销',shutdown:'关机'}[b.device]}。${b.mode==='continuous'?'持续 '+(b.device_minutes||15)+' 分钟并自动定时锁定。':''}确认启用？`);if(yes)await api('blocks/toggle',{id,enabled,confirm_device:b.device!=='none'});}
 if(a==='duplicate'){await api('blocks/duplicate',{id,name:b.name+' 副本 '+String(Date.now()).slice(-4)});toast('已复制为停用规则');}
 if(a==='delete'&&confirm(`删除“${b.name}”？`))await api('blocks/delete',{id});
 if(a==='editor-tab'){collectEditor();tab=el.dataset.tab;return renderEditor();}
 if(a==='add-targets'){collectEditor();if(!editorAdditions.websites.length&&!editorAdditions.applications.length)throw Error('请先添加网站或应用');await api('blocks/add-targets',{id:editor.id,...editorAdditions});closeModal();toast('屏蔽项目已添加，原有锁定与计时已保留');}
 if(a==='save-editor'){collectEditor();const payload={id:editor.id,block:editor};if(editor.device!=='none'&&(!editor.id||editor.device!==state.blocks.find(x=>x.id===editor.id).device||JSON.stringify(editor.autostart)!==JSON.stringify(state.blocks.find(x=>x.id===editor.id).autostart))){if(!confirm('设备规则生效时将锁屏、睡眠、注销或关机。确认保存此动作？'))return;payload.block.confirm_device=true;}await api('blocks/save',payload);closeModal();toast('规则已保存');}
 if(a==='import-other-blocks')return openBlockImport();
 if(a==='cancel-block-import'){editorImport=null;return renderEditor();}
 if(a==='apply-block-import'){collectBlockImport();const values=blockImportValues();if(!values.length)throw Error('请选择包含项目的来源规则');const target=editorImport.target,present=new Set([...editor[target],...editorTargets()[target]]),additions=values.filter(value=>!present.has(value));if(present.size+additions.length>10000)throw Error('合并后超过 10000 项，请减少来源规则');appendEditorTargets(target,additions);editorImport=null;renderEditor();toast(additions.length?'列表已合并，保存当前规则后生效':'所选项目均已存在，当前列表保持原样');return;}
 if(a==='category'){collectEditor();const rows=Object.entries(categories).map(([key,values])=>`<button class="choice-row" data-action="select-category" data-category="${esc(key)}"><span>${esc(key)}</span><small>${values.length} 项</small></button>`).join('');openModal('添加分类',sheetGroup('',rows||'<div class="sheet-status">暂无可用分类</div>'),btn('back-editor','返回编辑'),'form');return;}
 if(a==='select-category'){const key=el.dataset.category;if(!Object.prototype.hasOwnProperty.call(categories,key))throw Error('该分类已不可用');appendEditorTargets(tab,categories[key]);return renderEditor();}
 if(a==='whole-internet'){collectEditor();appendEditorTargets('websites',['*.*']);return renderEditor();}
 if(a==='import-lines'){collectEditor();const text=await readFile('.txt');if(text!==null){appendEditorTargets(tab,text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean));renderEditor();}return;}
 if(a==='export-lines'){collectEditor();return download(`${editor.name||'rules'}-${tab}.txt`,[...new Set([...editor[tab],...(editor.locked?editorAdditions[tab]:[])])].join('\n'),'text/plain');}
 if(a==='pick-app'||a==='pick-folder'||a==='pick-binary'){const command={'pick-app':'pickApp','pick-folder':'pickFolder','pick-binary':'pickBinary'}[a];if(window.webkit?.messageHandlers?.native)window.webkit.messageHandlers.native.postMessage(command);else toast('请使用 macOS 桌面应用，或在列表中选择应用');return;}
 if(a==='add-interval')return intervalModal(null);if(a==='edit-interval')return intervalModal(Number(el.dataset.index));
 if(a==='remove-interval'){collectEditor();editor.schedule.splice(Number(el.dataset.index),1);return renderEditor();}
 if(a==='back-editor'){scheduleDraft=null;return renderEditor();}
 if(a==='save-interval'){const r={...scheduleDraft.row,days:$$('[name=span-day]:checked').map(x=>Number(x.value)),start:minute($('#span-start').value),end:minute($('#span-end').value)||1440};if(!r.days.length)throw Error('请至少选择一天');if($('#span-custom').checked){r.break=r.break||clone(editor.break);$$('[name^="span."]').forEach(x=>r.break[x.name.slice(5)]=x.type==='number'?Number(x.value):x.name.endsWith('refill_minute')?minute(x.value):x.value);}else delete r.break;if(scheduleDraft.index===null)editor.schedule.push(r);else editor.schedule[scheduleDraft.index]=r;editor.mode='scheduled';const direct=scheduleDraft.direct;scheduleDraft=null;if(direct){await api('blocks/save',{id:editor.id,block:editor});closeModal();}else return renderEditor();}
 if(a==='calendar-add'){const block=state.blocks.find(x=>x.id===calendarBlock);if(!block)return;if(block.locked)throw Error('规则已锁定');editor=clone(block);tab='schedule';intervalModal(null);scheduleDraft.direct=true;return;}
 if(a==='calendar-event'){if(b.locked)return lockModal(id);editor=clone(b);tab='schedule';intervalModal(Number(el.dataset.index));scheduleDraft.direct=true;return;}
 if(a==='lock')return lockModal(id);
 if(a==='apply-lock'){const type=$('#lock-type').value;const d={id,type};if(type==='timer')d.until=new Date($('#lock-until').value).getTime()/1000;if(type==='password')d.password=$('#lock-password').value;if(type==='text'){d.length=Number($('[name=lock-length]').value);d.custom_text=$('#lock-custom').value;d.text_mode=$('#lock-text-mode').value;}if(type==='delay')d.minutes=Number($('[name=lock-delay]').value);if(type==='schedule')d.before_minutes=Number($('[name=lock-before]').value);if(type==='range'){d.schedule=[{days:$$('[name=lock-day]:checked').map(x=>Number(x.value)),start:minute($('#lock-start').value),end:minute($('#lock-end').value)||1440}];d.allow_inside=$('#lock-allow').checked;}await api('blocks/lock',d);closeModal();toast('锁定条件已保存');}
 if(a==='reset-pomodoro'){if(!confirm('重新开始一个完整的专注时段？当前休息会立即结束，下一次休息将从新的专注时段结束后开始。'))return;await api('blocks/reset-pomodoro',{id});toast('番茄钟已从新的专注时段开始');}
 if(a==='extend-text-lock'){await api('blocks/lock',{id,type:'text',length:Number($('#extend-text-length').value)});await refresh(false);toast('验证文本已延长，规则保持锁定');return lockModal(id);}
 if(a==='extend-lock'){await api('blocks/lock',{id,type:'timer',until:new Date($('#extend-until').value).getTime()/1000});closeModal();toast('锁定已延长');}
 if(a==='unlock'){const result=await api('blocks/unlock',{id,answer:$('#unlock-answer')?.value});if(result.ready_at){toast('等待至 '+dateTime(result.ready_at));await refresh(false);return lockModal(id);}closeModal();toast('已解锁');}
 if(a==='break'){const result=await api('blocks/break',{id});if(result.challenge)openModal('输入文本后休息',`<div class="challenge">${esc(result.challenge)}</div>${sheetGroup('',field('验证文本','<textarea id="break-answer" autofocus rows="3" autocomplete="off" spellcheck="false"></textarea>',true))}`,`${btn('close','取消')}${btn('confirm-break','开始休息',`data-id="${id}"`,'primary')}`,'form');else toast(result.ready_at?'等待至 '+dateTime(result.ready_at):'休息已开始');return;}
 if(a==='confirm-break'){await api('blocks/break',{id,answer:$('#break-answer').value});closeModal();toast('休息已开始');}
 if(a==='export')return download('hotturkey-blocks.json',await api('export'));
 if(a==='import'){
  const text=await readFile('.json');if(!text)return;
  const value=JSON.parse(text);if(!Array.isArray(value.blocks)||value.blocks.length>200||value.blocks.some(b=>!b||typeof b!=='object'||Array.isArray(b)))throw Error('请选择包含规则列表的 HotTurkey 导出文件（最多 200 条）');
  importDraft=prepareRuleImport(value.blocks);
  renderRuleImport();return;
 }
 if(a==='confirm-import'){
  if(!importDraft)throw Error('请重新选择导入文件');
  const allow_autostart=$('#import-keep-autostart')?.checked===true;
  const device=allow_autostart&&importDraft.some(b=>b.device&&b.device!=='none'&&b.autostart&&b.autostart.type!=='none');
  if(device&&!confirm('自动启动计划包含设备规则，生效时可能锁屏、睡眠、注销或关机。确认保留这些设备动作？'))return;
  const blocks=allow_autostart?importDraft:importDraft.map(b=>({...b,autostart:{type:'none'}}));
  const result=await api('import',{blocks,allow_autostart,confirm_device:device});
  closeModal();toast(`已导入 ${result.count} 条规则`+(allow_autostart?'，自动启动计划已保留':'，新规则保持停用'));await refresh();return;
 }
 if(a==='export-stats')return download('hotturkey-statistics.json',await api('statistics/export'));
 if(a==='clear-stats'&&confirm('删除全部统计记录？使用额度不会被重置。')){await api('statistics/clear',{});toast('统计记录已删除');}
 if(a==='notifications'){if(window.webkit?.messageHandlers?.native)window.webkit.messageHandlers.native.postMessage('notifications');else toast('请从 macOS 桌面应用启用通知');return;}
 if(a==='settings-password')return openModal('设置密码',`${field('新密码（留空移除）','<input id="new-settings-password" type="password" autofocus autocomplete="new-password">')}`,`${btn('close','取消')}${btn('save-settings-password','保存','','primary')}`,'compact');
 if(a==='save-settings-password'){await api('settings',{password:$('#new-settings-password').value});closeModal();toast('设置密码已更新');}
 if(a==='authenticate')return openModal('解锁管理界面',field('设置密码','<input id="auth-password" type="password" autofocus autocomplete="current-password">'),`${btn('close','取消')}${btn('auth-submit','解锁','','primary')}`,'compact');
 if(a==='auth-submit'){const value=await api('auth',{password:$('#auth-password').value});auth=value.session;sessionStorage.setItem('hot-auth',auth);closeModal();await loadResources();}
 if(a==='logout-auth'){auth='';sessionStorage.removeItem('hot-auth');}
 await refresh();if(page==='statistics')await loadStats();
}
document.addEventListener('click',async event=>{if(event.target.closest('[data-action=retry-connection]')){await boot();return;}if(event.target.closest('.brand')){event.preventDefault();page='overview';renderPage();return;}const nav=event.target.closest('[data-page]');if(nav){page=nav.dataset.page;renderPage();if(page==='statistics')await loadStats();return;}const el=event.target.closest('[data-action]');if(!el)return;if(movedCalendar&&el.dataset.action==='calendar-event'){movedCalendar=false;return;}try{await action(el.dataset.action,el);}catch(error){if(modal.open&&$('#modal-error'))showModalError(error.message);else toast(error.message);}});
document.addEventListener('change',async event=>{const el=event.target;try{if(el.name==='block-import'||el.id==='block-import-source'){collectBlockImport();renderBlockImport();return;}if(el.dataset.setting){let value=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;await api('settings',{[el.dataset.setting]:value});await refresh();toast('设置已保存');}if(el.id==='warning-minutes'){await api('settings',{warning_minutes:el.value.split(',').map(x=>Number(x.trim())).filter(Boolean)});await refresh();toast('提醒已保存');}if(el.id==='device-enabled')$('[data-action=save-device]',modal).textContent=el.checked?'保存并启用':'保存计划';if(el.id==='lock-type')renderLockFields();if(el.name==='break.type'||el.name==='break.period'||el.name==='autostart.type'){collectEditor();renderEditor();}if(el.id==='app-picker'&&el.value){collectEditor();appendEditorTargets('applications',[el.value]);renderEditor();}if(el.id==='calendar-block'){calendarBlock=el.value;renderCalendar();}if(el.id==='span-custom'){if(el.checked){scheduleDraft.row.break=clone(editor.break);$('#span-break').innerHTML=breakForm(scheduleDraft.row.break,'span.');}else $('#span-break').innerHTML='';}if(el.name==='span.type'||el.name==='span.period'){const br=scheduleDraft.row.break;$$('[name^="span."]').forEach(x=>br[x.name.slice(5)]=x.type==='number'?Number(x.value):x.name.endsWith('refill_minute')?minute(x.value):x.value);$('#span-break').innerHTML=breakForm(br,'span.');}if(el.id==='stats-since')statsSinceDate=el.value;if(el.id==='stats-until')statsUntilDate=el.value;if(el.id==='stats-range')statsRange=Number(el.value);if(el.id==='stats-kind')statsKind=el.value;if(el.id==='stats-user')statsUser=el.value;if(el.id==='stats-block')statsBlock=el.value;if(el.id==='stats-metric')statsMetric=el.value;if(el.id==='stats-limit')statsLimit=Number(el.value);if(el.id.startsWith('stats-'))await loadStats();}catch(error){toast(error.message);await refresh(false);if(page==='settings')renderSettings();}});
document.addEventListener('input',event=>{if(event.target.id==='block-filter'){filter=event.target.value;const position=event.target.selectionStart;renderBlocks();$('#block-filter').focus();$('#block-filter').setSelectionRange(position,position);}if(event.target.id==='stats-query'){statsQuery=event.target.value;clearTimeout(loadStats.timer);loadStats.timer=setTimeout(loadStats,500);}});
document.addEventListener('paste',event=>{if(event.target.id==='unlock-answer'&&state.blocks.some(b=>b.lock.type==='text'&&b.locked)||event.target.id==='break-answer'){event.preventDefault();toast('请手动输入验证文本');}});
function calendarY(col,clientY){const rect=col.getBoundingClientRect();return Math.max(0,Math.min(719,(clientY-rect.top)*720/rect.height));}
document.addEventListener('pointerdown',event=>{
 if(!canManage())return;
 const col=event.target.closest('.day-column');if(!col)return;
 const existing=event.target.closest('.calendar-event');
 const b=state.blocks.find(b=>b.id===(existing?.dataset.id||calendarBlock));if(!b||b.locked)return;
 const y=calendarY(col,event.clientY);
 if(existing){const row=b.schedule[Number(existing.dataset.index)];if(!row.days.includes(Number(col.dataset.day)))return;drag={col,day:Number(col.dataset.day),moving:true,id:b.id,index:Number(existing.dataset.index),row:clone(row),anchorY:y,start:row.start,end:row.end,targetDay:Number(col.dataset.day),changed:false};}
 else drag={col,day:Number(col.dataset.day),start:Math.floor(y/7.5)*15,end:Math.floor(y/7.5)*15+15};
 col.setPointerCapture(event.pointerId);
});
document.addEventListener('pointermove',event=>{
 if(!drag)return;
 if(drag.moving){
  const col=document.elementFromPoint(event.clientX,event.clientY)?.closest('.day-column')||drag.col;
  const y=calendarY(col,event.clientY);
  const delta=Math.round((y-drag.anchorY)/7.5)*15;
  drag.start=Math.max(0,Math.min(1425,drag.row.start+delta));drag.targetDay=Number(col.dataset.day);
  drag.changed=delta!==0||drag.targetDay!==drag.day;
  $$('.calendar-event.preview').forEach(e=>e.remove());
  if(drag.changed){const length=(drag.row.end-drag.row.start+1440)%1440||1440;drag.end=(drag.start+length)%1440||1440;const preview=document.createElement('div');preview.className='calendar-event preview';preview.style.top=drag.start/2+'px';preview.style.height=Math.max(10,Math.min(length,1440-drag.start)/2)+'px';preview.textContent=hm(drag.start)+'–'+hm(drag.end);col.appendChild(preview);}
 }else{const y=calendarY(drag.col,event.clientY);drag.end=Math.floor(y/7.5)*15+15;$('.preview',drag.col)?.remove();const div=document.createElement('div');div.className='calendar-event preview';div.style.top=Math.min(drag.start,drag.end-15)/2+'px';div.style.height=(Math.abs(drag.end-15-drag.start)+15)/2+'px';drag.col.appendChild(div);}
});
document.addEventListener('pointerup',async()=>{
 if(!drag)return;const d=drag;drag=null;$$('.calendar-event.preview').forEach(e=>e.remove());
 if(d.moving){if(!d.changed)return;movedCalendar=true;setTimeout(()=>movedCalendar=false,150);const b=clone(state.blocks.find(b=>b.id===d.id));const row=b.schedule[d.index];row.days=row.days.filter(day=>day!==d.day);if(!row.days.length)b.schedule.splice(d.index,1);b.schedule.push({...d.row,id:undefined,days:[d.targetDay],start:d.start,end:d.end});try{await api('blocks/save',{id:b.id,block:b});await refresh();toast('时段已移动');}catch(error){toast(error.message);renderCalendar();}return;}
 editor=clone(state.blocks.find(b=>b.id===calendarBlock));tab='schedule';intervalModal(null,d.day,Math.min(d.start,d.end-15),Math.max(d.start+15,d.end));scheduleDraft.direct=true;
});
document.addEventListener('pointercancel',()=>{drag=null;$$('.calendar-event.preview').forEach(e=>e.remove());});
async function loadResources(){const values=await Promise.allSettled([api('categories'),canManage()?api('apps'):Promise.resolve([]),api('users')]);categories=values[0].status==='fulfilled'?values[0].value:{};apps=values[1].status==='fulfilled'?values[1].value:[];users=values[2].status==='fulfilled'?values[2].value:[];if(values.some(v=>v.status==='rejected'))toast('部分本机信息暂不可用，仍可手动添加规则');}
async function boot(){try{await refresh();window.webkit?.messageHandlers?.native?.postMessage({op:'ready',tray:state.settings.start_in_tray});if(state.authenticated||!canManage())await loadResources();}catch(error){$('#content').innerHTML=`<div class="empty"><h2>无法连接本地后台</h2><p>${esc(error.message)}</p><p>请确认后台已启动，再重新连接。系统模式需要先完成系统安装。</p>${btn('retry-connection','重新连接','','primary')}</div>`;}}
function recoverDesktop(){if(!recoveryRequested&&window.webkit?.messageHandlers?.native){recoveryRequested=true;window.webkit.messageHandlers.native.postMessage('reconnect');}}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(state)theme();});
boot();setInterval(()=>{if(state)refresh(!modal.open&&!['statistics','settings','schedule','blocks'].includes(page)).catch(()=>{recoverDesktop();$('#connection').textContent='○ 后台连接中断，正在恢复';$('#connection').classList.add('bad');});},3000);
