'use strict';
window.HotTurkeyScreenshotSettings=(()=>{
 let info=null,sequence=0,saving=false,reading=false,qualityMenu=null,menuKind='quality',pathTip=null,pathTarget=null;
 const node=()=>document.querySelector('#screenshot-settings');
 const active=()=>page==='settings'&&state?.authenticated&&state?.can_manage!==false&&node();
 const row=(title,control,note='',kind='')=>`<div class="settings-row ${kind}"><div><h3>${title}</h3>${note?`<p>${note}</p>`:''}</div>${control}</div>`;
 const choices=(values,current,label)=>Object.fromEntries([...new Set([...values,Number(current)])].sort((a,b)=>a-b).map(v=>[v,label(v)]));
 function renderRecording(){
  const root=document.querySelector('#tracking-record-settings');if(!root||!info)return;
  const s=info.settings,status=info.status||{},disabled=saving?'disabled':'',focus=document.activeElement?.dataset?.recordSetting;
  const permission=status.accessibility?'已允许':window.webkit?.messageHandlers?.native?'<button type="button" data-shot-action="window-permission">允许读取窗口信息</button>':'请在桌面应用中允许';
  root.classList.remove('settings-group');root.innerHTML='<h2>使用统计</h2>'+settingToggle('statistics','记录使用统计','')+
   row('记录窗口标题与文档',`<button type="button" role="switch" class="switch ${s.titles?'on':''}" aria-label="记录窗口标题与文档" aria-checked="${s.titles}" data-record-setting="titles" ${disabled}></button>`)+
   row('离开判断（秒）',`<input type="number" min="30" max="3600" data-record-setting="idle_seconds" aria-label="离开判断（秒）" value="${s.idle_seconds}" ${disabled}>`)+
   row('活动保留（天）',`<input type="number" min="1" max="3650" data-record-setting="retention_days" aria-label="活动保留（天）" value="${s.retention_days}" ${disabled}>`)+
   row('窗口信息',`<span id="record-permission">${permission}</span>`)+row('隐私','<button type="button" data-shot-action="privacy">更改…</button>');
  if(focus)root.querySelector(`[data-record-setting="${focus}"]`)?.focus({preventScroll:true});
 }
 function render(){
  const root=active();if(!root||!info)return;renderRecording();
  hidePath();const s=info.settings,status=info.status||{},disabled=saving?'disabled':'';
  const permission=status.screen_recording?'已允许':window.webkit?.messageHandlers?.native?'<button type="button" data-shot-action="permission">允许屏幕录制</button>':'请在桌面应用中允许';
  const captureState=!s.screenshots_enabled?'已关闭':!status.connected?'后台未连接':!status.screen_recording?'等待屏幕录制权限':!state.settings.statistics||!s.enabled||s.paused_until>Date.now()/1000?'记录已暂停':'已开启';
  const focus=document.activeElement?.dataset?.shotSetting,top=window.scrollY;
  root.classList.remove('settings-group');root.innerHTML='<h2>截图</h2>'+row('自动截图',`<button type="button" role="switch" class="switch ${s.screenshots_enabled?'on':''}" aria-label="自动截图" aria-checked="${s.screenshots_enabled}" data-shot-setting="screenshots_enabled" ${disabled}></button>`)+
   row('截图间隔',`<button type="button" class="shot-quality-trigger" data-shot-action="interval" aria-label="截图间隔" aria-haspopup="menu" aria-expanded="false" ${disabled}><span>${s.screenshot_interval%60?s.screenshot_interval+' 秒':s.screenshot_interval/60+' 分钟'}</span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m4 4 2-2 2 2m-4 4 2 2 2-2"/></svg></button>`)+
   row('清晰度',`<button type="button" class="shot-quality-trigger" data-shot-action="quality" aria-label="截图清晰度" aria-haspopup="menu" aria-expanded="false" ${disabled}><span>${{original:'原图',high:'高',standard:'标准'}[s.screenshot_quality||'original']}</span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m4 4 2-2 2 2m-4 4 2 2 2-2"/></svg></button>`)+
   row('显示器',`<select aria-label="截图显示器" data-shot-setting="screenshot_displays" ${disabled}>${options({all:'所有显示器',main:'主显示器'},s.screenshot_displays||'all')}</select>`)+
   row('保留时间',`<button type="button" class="shot-quality-trigger" data-shot-action="retention" aria-label="截图保留时间" aria-haspopup="menu" aria-expanded="false" ${disabled}><span>${s.screenshot_retention_days} 天</span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m4 4 2-2 2 2m-4 4 2 2 2-2"/></svg></button>`)+
   row('储存位置',`<div class="shot-directory-controls"><span class="shot-path" tabindex="0" data-full-path="${esc(info.directory?.path||'')}" aria-label="储存位置：${esc(info.directory?.path||'')}"><span class="shot-path-parent">${esc((info.directory?.display_path||info.directory?.path||'').split('/').slice(0,-1).join('/'))}</span><span class="shot-path-chevron" aria-hidden="true">›</span><span class="shot-path-leaf">${esc((info.directory?.path||'').split('/').at(-1)||'')}</span></span><div><button type="button" data-shot-action="directory">更改…</button><button type="button" data-shot-action="open-directory">打开文件夹</button></div></div>`,'','shot-directory-row')+
   row('屏幕录制',`<span id="shot-permission">${permission}</span>`)+row('状态',`<span id="shot-status" class="muted">${captureState}</span>`)+
   '<div class="settings-row"><button type="button" data-shot-action="advanced">更多选项…</button><span id="shot-error" class="muted" role="status">'+esc(status.screenshot_error||'')+'</span></div>';
  if(focus)root.querySelector(`[data-shot-setting="${focus}"]`)?.focus({preventScroll:true});window.scrollTo(window.scrollX,top);
 }
 async function refresh(){
  if(!active()||saving||reading||qualityMenu)return;
  const current=++sequence,root=node();reading=true;
  try{const value=await api('tracking/settings');if(current!==sequence||!active()||node()!==root)return;const changed=!info||JSON.stringify(info.settings)!==JSON.stringify(value.settings)||info.status?.screen_recording!==value.status?.screen_recording||info.status?.accessibility!==value.status?.accessibility;info=value;if(changed||!root.querySelector('#shot-status'))render();else{const status=value.status||{},s=value.settings;root.querySelector('#shot-status').textContent=!s.screenshots_enabled?'已关闭':!status.connected?'后台未连接':!status.screen_recording?'等待屏幕录制权限':!state.settings.statistics||!s.enabled||s.paused_until>Date.now()/1000?'记录已暂停':'已开启';root.querySelector('#shot-error').textContent=status.screenshot_error||'';}}
  catch(error){if(current===sequence&&active()&&node()===root){root.classList.remove('settings-group');root.innerHTML='<h2>截图</h2><p role="status">'+esc(error.message)+'</p><button type="button" data-shot-action="reload">重试</button>';}}
  finally{if(current===sequence)reading=false;}
 }
 function hidePath(){pathTip?.remove();pathTip=null;pathTarget=null;}
 function showPath(element){
  if(!active()||!element?.dataset.fullPath||pathTarget===element)return;hidePath();pathTarget=element;
  pathTip=document.createElement('div');pathTip.className='shot-path-tooltip';pathTip.setAttribute('role','tooltip');pathTip.textContent=element.dataset.fullPath;document.body.appendChild(pathTip);
  const r=element.getBoundingClientRect(),b=pathTip.getBoundingClientRect(),zoom=Number(document.body.style.zoom)||1;
  pathTip.style.left=Math.max(8,Math.min(innerWidth-b.width-8,r.left))/zoom+'px';pathTip.style.top=(r.bottom+b.height+10<innerHeight?r.bottom+6:Math.max(8,r.top-b.height-6))/zoom+'px';
 }
 function closeQuality(restore=false){
  if(!qualityMenu)return;try{qualityMenu.hidePopover?.();}catch{}qualityMenu.remove();qualityMenu=null;
  const trigger=node()?.querySelector(`[data-shot-action="${menuKind}"]`);trigger?.setAttribute('aria-expanded','false');if(restore)trigger?.focus({preventScroll:true});
 }
 function positionQuality(){
  const trigger=node()?.querySelector(`[data-shot-action="${menuKind}"]`);if(!qualityMenu||!trigger)return;
  const r=trigger.getBoundingClientRect(),box=qualityMenu.getBoundingClientRect(),zoom=Number(document.body.style.zoom)||1;
  qualityMenu.style.left=Math.max(8,Math.min(innerWidth-box.width-8,r.right-box.width))/zoom+'px';
  qualityMenu.style.top=(r.bottom+box.height+8<innerHeight?r.bottom+6:Math.max(8,r.top-box.height-6))/zoom+'px';
 }
 async function openQuality(kind='quality'){
  if(saving)return;
  if(qualityMenu){const same=menuKind===kind;closeQuality(same);if(same)return;}
  menuKind=kind;const interval=kind==='interval',retention=kind==='retention',setting=retention?'screenshot_retention_days':interval?'screenshot_interval':'screenshot_quality';
  const menu=document.createElement('div');menu.className='shot-quality-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label',retention?'截图保留时间':interval?'截图间隔':'截图清晰度');menu.setAttribute('popover','manual');qualityMenu=menu;
  const size=bytes=>bytes>=1e9?(bytes/1e9).toFixed(1)+' GB':bytes>=1e6?(bytes/1e6).toFixed(1)+' MB':Math.max(1,Math.round(bytes/1000))+' KB';
  const labels=retention?choices([1,3,7,14,30,90],info.settings.screenshot_retention_days,v=>v+' 天'):interval?choices([30,60,120,300,600],info.settings.screenshot_interval,v=>v%60?v+' 秒':v/60+' 分钟'):{original:'原图',high:'高',standard:'标准'};
  function paint(value){
   const helpFocused=document.activeElement?.classList?.contains('shot-budget-help'),focused=document.activeElement?.dataset?.shotQuality,displays=value?.displays||1;
   const current=value?.items.find(v=>v.quality===(info.settings.screenshot_quality||'original'));
   const help=retention?'以当前清晰度、截图间隔和显示器设置，估算对应保留天数的用量。每天按连续记录 24 小时计算。':interval?'以当前清晰度和显示器设置，估算连续记录 24 小时的用量。':'以当前截图间隔和显示器设置，估算连续记录 24 小时的用量。';
   menu.innerHTML='<div class="shot-quality-menu-head"><span></span><span>'+(retention?'截图数':interval?'张 / 天':'单张')+'</span><span class="shot-budget-heading">'+(retention?'储存空间':'24 小时')+' <span class="shot-budget-help" tabindex="0" role="button" aria-label="储存估算说明">?<span role="tooltip" class="shot-budget-tooltip">'+help+'</span></span></span></div>'+Object.entries(labels).map(([key,label])=>{
    const item=value?.items.find(v=>v.quality===key),selected=String(info.settings[setting]??'original')===key;
    const count=retention?Math.ceil(86400/(value?.interval||info.settings.screenshot_interval))*displays*Number(key):interval?Math.ceil(86400/Number(key))*displays:0;
    const bytes=retention?(current?current.daily_bytes*Number(key):null):interval?(current?current.daily_bytes/Math.ceil(86400/value.interval)*Math.ceil(86400/Number(key)):null):item?.daily_bytes;
    const detail=value?(interval||retention?count.toLocaleString():item?'约 '+size(item.image_bytes):'—'):'—';
    return `<button type="button" role="menuitemradio" aria-checked="${selected}" data-shot-quality="${key}" data-shot-preference="${setting}" tabindex="${selected?0:-1}"><span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m2 6 3 3 5-6"/></svg>${label}</span><span>${detail}</span><span>${bytes==null?'—':'约 '+size(bytes)}</span></button>`;
   }).join('');
   if(helpFocused)menu.querySelector('.shot-budget-help')?.focus({preventScroll:true});
   if(focused)menu.querySelector(`[data-shot-quality="${focused}"]`)?.focus({preventScroll:true});positionQuality();
  }
  paint();document.body.appendChild(menu);try{menu.showPopover?.();}catch{}positionQuality();node().querySelector(`[data-shot-action="${kind}"]`).setAttribute('aria-expanded','true');menu.querySelector('[aria-checked="true"]')?.focus({preventScroll:true});
  try{const value=await api('tracking/screenshots/estimate');if(qualityMenu===menu&&active())paint(value);}
  catch{if(qualityMenu===menu)paint();}
 }
 async function save(key,value){
  if(!active()||saving||!info)return;
  sequence++;reading=false;saving=true;const root=node();render();
  try{const settings=await api('tracking/settings',{[key]:value});if(active()&&node()===root){info={...info,settings};}}
  catch(error){if(active()&&node()===root)toast(error.message);}
  finally{saving=false;if(active()&&node()===root){render();refresh();}}
 }
 document.addEventListener('click',event=>{
  const target=event.target.closest('[data-shot-action],[data-shot-setting],[data-shot-quality],[data-record-setting]');if(!target||!active())return;
  if(target.dataset.recordSetting==='titles'){save('titles',!info.settings.titles);return;}
  if(target.dataset.shotQuality){const key=target.dataset.shotPreference||'screenshot_quality',value=key==='screenshot_quality'?target.dataset.shotQuality:Number(target.dataset.shotQuality),kind=key==='screenshot_retention_days'?'retention':key==='screenshot_interval'?'interval':'quality';closeQuality();save(key,value).then(()=>node()?.querySelector(`[data-shot-action=${kind}]`)?.focus({preventScroll:true}));return;}
  if(target.dataset.shotSetting==='screenshots_enabled'){save('screenshots_enabled',!info.settings.screenshots_enabled);return;}
  const action=target.dataset.shotAction;
  if(['quality','interval','retention'].includes(action))openQuality(action);
  if(action==='privacy')window.HotTurkeyTracking?.openSettings?.('privacy')?.catch(error=>toast(error.message));
  if(action==='window-permission')window.webkit?.messageHandlers?.native?.postMessage({op:'tracking-permission',kind:'accessibility'});
  if(action==='permission')window.webkit?.messageHandlers?.native?.postMessage({op:'tracking-permission',kind:'screen'});
  if(action==='advanced')window.HotTurkeyTracking?.openSettings?.('screenshots')?.catch(error=>toast(error.message));
  if(action==='directory'||action==='open-directory')HotTurkeyMediaBridge.directory(action==='directory'?'choose':'open').then(()=>{info=null;return refresh();}).catch(error=>toast(error.message));
  if(action==='reload')refresh();
 });
 document.addEventListener('change',event=>{if(event.target.dataset.recordSetting&&active()){save(event.target.dataset.recordSetting,Number(event.target.value));return;}const key=event.target.dataset.shotSetting;if(key&&key!=='screenshots_enabled'&&active())save(key,['screenshot_quality','screenshot_displays'].includes(key)?event.target.value:Number(event.target.value));});
 if(typeof setInterval==='function')setInterval(()=>{if(active()&&!document.hidden&&!saving&&!modal.open)refresh();},3000);
 document.addEventListener('pointerdown',event=>{if(qualityMenu&&!qualityMenu.contains(event.target)&&!event.target.closest('[data-shot-action="quality"],[data-shot-action="interval"],[data-shot-action="retention"]'))closeQuality();},true);
 document.addEventListener('keydown',event=>{
  if(!qualityMenu)return;
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeQuality(true);return;}
  if(event.key==='Tab'){closeQuality(true);return;}
  if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
  event.preventDefault();const rows=[...qualityMenu.querySelectorAll('[data-shot-quality]')],index=rows.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?rows.length-1:(index+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length;rows[next]?.focus();
 },true);
 document.addEventListener('pointerover',event=>{const element=event.target.closest?.('.shot-path');if(element)showPath(element);});
 document.addEventListener('pointerout',event=>{if(pathTarget&&!pathTarget.contains(event.relatedTarget))hidePath();});
 document.addEventListener('focusin',event=>{const element=event.target.closest?.('.shot-path');if(element)showPath(element);});
 document.addEventListener('focusout',()=>hidePath());
 window.addEventListener?.('blur',()=>{closeQuality();hidePath();});window.addEventListener?.('resize',()=>{closeQuality();hidePath();});
 document.addEventListener('scroll',()=>{if(pathTarget&&document.activeElement===pathTarget){const target=pathTarget;hidePath();showPath(target);}else hidePath();if(qualityMenu){const trigger=node()?.querySelector(`[data-shot-action="${menuKind}"]`),r=trigger?.getBoundingClientRect();if(!r||r.bottom<0||r.top>innerHeight)closeQuality();else positionQuality();}},{capture:true,passive:true});
 const controller={closeMenus(){closeQuality();hidePath();},mount(){closeQuality();hidePath();sequence++;info=null;reading=false;return refresh();},refresh};
 if(typeof page!=='undefined'&&page==='settings')controller.mount();
 return controller;
})();
