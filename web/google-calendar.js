'use strict';
window.HotTurkeyGoogleCalendar=(()=>{
 const D=HotTurkeyGoogleData,zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
 let source='blocks';try{source=localStorage.getItem('hot-calendar-source')==='google'?'google':'blocks';}catch{}
 let status=null,calendars=[],items=[],selected=new Set(),anchor=new Date(),view='week',epoch=0,loading=false,error='',synced=0,offline=false,editing=null,dragging=null,skipClick=false,editEpoch=0,allDayExpanded=false,eventColors={},overviewCache=null,monthLimit=3,dayPopup=null,dayPopupOrigin=null,loadedQuery='';
 const q=(path,values={})=>'google-calendar/'+path+(Object.keys(values).length?'?'+new URLSearchParams(values):'');
 const visible=()=>page==='schedule'&&source==='google'&&document.querySelector('#google-calendar');
 const color=c=>/^#[a-f\d]{6}$/i.test(c.backgroundColor||'')?c.backgroundColor:'#007aff';
 const time=date=>date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
 const label=date=>date.toLocaleDateString('zh-CN',{month:'long',day:'numeric'});
 const name=e=>e.summary||'未命名事件';
 function switcher(){return `<div class="schedule-source" role="group" aria-label="日程来源"><button data-gc-source="blocks" aria-pressed="${source==='blocks'}">拦截日程</button><button data-gc-source="google" aria-pressed="${source==='google'}">Google 日历</button></div>`;}
 function external(link){
  const value=D.externalURL(link);
  if(window.HotTurkeyNativeShell)window.webkit.messageHandlers.native.postMessage({op:'google-calendar-open',url:value});else window.open(value,'_blank','noopener,noreferrer');
 }
 function render(force=false){if(!force&&visible()&&status)return;epoch++;$('#content').innerHTML=switcher()+'<section id="google-calendar" class="google-calendar"><div class="gc-empty">正在读取…</div></section>';load();}
 function hide(){loadedQuery='';if(modal.open&&modal.dataset?.gcPrivate==='true')closeModal();overviewCache=null;epoch++;editEpoch++;dragging=null;editing=null;calendars=[];items=[];status=null;selected.clear();}
 function disconnected(){const title=!status?.configured?'连接 Google 日历':status.pending?'等待 Google 授权':'登录 Google 日历';const note=!status?.configured?'导入桌面应用客户端配置后，登录你的 Google 账号。':status.pending?'请在浏览器中完成登录，然后返回这里。':'查看和编辑你的 Google 日历。';return `<div class="gc-connect"><div class="gc-connect-inner"><div class="gc-mark" aria-hidden="true"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 10h18M8 14h3M14 14h2M8 17h2M14 17h2"/></svg></div><h2>${title}</h2><p>${note}</p><div class="toolbar">${!status?.configured?'<button class="primary" data-gc="configure">导入客户端配置…</button>':status.pending?'<button data-gc="cancel-connect">取消</button><button data-gc="status">已完成登录</button>':'<button class="primary" data-gc="connect">登录 Google</button><button data-gc="configure">客户端配置…</button>'}</div>${!status?.configured?'<button class="icon-button" data-gc="help">设置说明</button>':''}${status?.error?`<p role="alert">${esc(status.error)}</p>`:''}</div></div>`;}
 // Keep unchanged nodes and their compositing/scroll state across refreshes.
 function commit(root,markup){
  if(root._gcMarkup===markup)return;
  if(typeof document.createElement!=='function'){root.innerHTML=markup;root._gcMarkup=markup;return;}
  const template=document.createElement('template');template.innerHTML=markup;
  function reconcile(parent,fresh){
   const incoming=[...fresh.childNodes];
   incoming.forEach((next,i)=>{const current=parent.childNodes[i];if(!current){parent.appendChild(next.cloneNode(true));return;}
    if(current.nodeType!==next.nodeType||current.nodeName!==next.nodeName){parent.replaceChild(next.cloneNode(true),current);return;}
    if(next.nodeType===3){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;return;}
    if(next.nodeType!==1)return;
    for(const attr of [...current.attributes])if(!next.hasAttribute(attr.name))current.removeAttribute(attr.name);
    for(const attr of [...next.attributes])if(current.getAttribute(attr.name)!==attr.value)current.setAttribute(attr.name,attr.value);
    reconcile(current,next);
   });
   while(parent.childNodes.length>incoming.length)parent.lastChild.remove();
  }
  reconcile(root,template.content);root._gcMarkup=markup;
 }
 function paint(){closeDayPopup(false);const root=document.querySelector('#google-calendar');if(!root)return;if(!status?.connected){root.innerHTML=disconnected();return;}
  const range=D.range(anchor,view),dates=Array.from({length:range.days},(_,i)=>D.addDays(range.start,i));
  const title=view==='month'?anchor.toLocaleDateString('zh-CN',{year:'numeric',month:'long'}):view==='day'?label(anchor):label(range.start)+' — '+label(D.addDays(range.end,-1));
  const markup=`<div class="gc-toolbar"><button data-gc="previous" aria-label="上一${view==='month'?'月':view==='day'?'天':'周'}">‹</button><button data-gc="today">今天</button><button data-gc="next" aria-label="下一${view==='month'?'月':view==='day'?'天':'周'}">›</button><h2>${esc(title)}</h2><span class="grow"></span><div class="gc-view" role="group" aria-label="Google 日历视图">${[['day','日'],['week','周'],['month','月'],['agenda','列表']].map(([key,text])=>`<button data-gc="view" data-view="${key}" aria-pressed="${view===key}">${text}</button>`).join('')}</div><button data-gc="refresh" ${loading?'disabled':''}>${loading?'同步中…':'刷新'}</button><button data-gc="account" aria-label="Google 日历账户">账户…</button><button data-gc="new" class="primary" ${offline||!calendars.some(c=>['owner','writer','writerWithoutPrivateAccess'].includes(c.accessRole))?'disabled':''}>新建事件</button></div><div class="gc-calendars">${calendars.map(c=>`<label class="gc-calendar-choice" style="--calendar-color:${color(c)}"><input type="checkbox" data-gc-calendar="${esc(c.id)}" ${selected.has(c.id)?'checked':''}>${esc(c.summaryOverride||c.summary||c.id)}</label>`).join('')}<span class="gc-status" role="status">${status?.read_only?'只读预览':offline?'离线副本':synced?'更新于 '+time(new Date(synced*1000)):''}</span></div>${error?`<div class="gc-alert" role="alert">${esc(error)}</div>`:''}<div class="gc-scroller">${view==='month'?month(dates):view==='agenda'?agenda():week(dates)}</div>`;const paintKey=view+':'+range.start.toISOString(),previous=root.querySelector?.('.gc-scroller'),scroll=root._gcPaintKey===paintKey?previous?.scrollTop||0:0;commit(root,markup);const scroller=root.querySelector?.('.gc-scroller');if(scroller&&scroller.scrollTop!==scroll)scroller.scrollTop=scroll;root._gcPaintKey=paintKey;if(view==='month'&&typeof requestAnimationFrame==='function')requestAnimationFrame(fitMonth);
 }
 function eventAppearance(item){return D.eventAppearance(item,eventColors);}
 async function decorateCalendars(values){
  const replies=await Promise.allSettled(values.map(async calendar=>{const response=await api(q('labels',{calendar:calendar.id}));return {...calendar,labels:response.items||[]};}));
  return values.map((calendar,i)=>replies[i].status==='fulfilled'?replies[i].value:calendar);
 }
 function eventButton(item,index,extra='',content='',compact=false){
  const b=D.bounds(item.event),range=D.banner(item.event)?'全天':time(b.start)+'–'+time(b.end),declined=item.event.attendees?.some(a=>a.self&&a.responseStatus==='declined'),chosen=eventAppearance(item);const eventColor=chosen.color,rgb=eventColor.slice(1).match(/../g).map(v=>parseInt(v,16)),ink=rgb[0]*.299+rgb[1]*.587+rgb[2]*.114>160?'#1d1d1f':'#fff';
  return `<button class="gc-event${declined?' declined':''}${D.banner(item.event)?' banner':content?' entry':''}${compact?' compact':''}" data-gc="event" data-key="${index}" aria-label="${esc(name(item.event)+' · '+range)}" title="${esc(name(item.event)+' · '+range+(chosen.label?' · '+chosen.label:''))}" style="--event-color:${eventColor};--event-ink:${ink};${extra}"><b>${esc(content||name(item.event))}</b>${!content&&!compact?`<small>${range}</small>`:''}</button>`;
 }
 function week(dates){
  const today=D.dayKey(new Date()),events=items;
  const banners=dates.map(date=>events.map((item,index)=>({item,index})).filter(({item})=>D.banner(item.event)&&D.onDay(item.event,date)));
  const more=banners.some(rows=>rows.length>2);
  return `<div class="gc-week" style="--days:${dates.length}"><div class="gc-heading"></div>${dates.map(date=>`<div class="gc-heading ${D.dayKey(date)===today?'today':''}"><span>${date.toLocaleDateString('zh-CN',{weekday:'short'})}</span><strong>${date.getDate()}</strong></div>`).join('')}<div class="gc-all-label"><span>全天</span>${more?`<button data-gc="all-day-toggle" aria-label="${allDayExpanded?'收起':'展开'}全天事件" aria-expanded="${allDayExpanded}">${allDayExpanded?'⌃':'⌄'}</button>`:''}</div>${banners.map(rows=>`<div class="gc-all-day">${rows.slice(0,allDayExpanded?rows.length:2).map(({item,index})=>eventButton(item,index,'',name(item.event))).join('')}${!allDayExpanded&&rows.length>2?`<button class="gc-all-more" data-gc="all-day-toggle">另外 ${rows.length-2} 项</button>`:''}</div>`).join('')}<div class="gc-hours">${Array.from({length:24},(_,i)=>`<span style="top:${i/24*100}%">${String(i).padStart(2,'0')}:00</span>`).join('')}</div>${dates.map(date=>`<div class="gc-day ${D.dayKey(date)===today?'today':''}" data-date="${D.dayKey(date)}" aria-label="${D.dayKey(date)}">${D.segments(events,date).map(item=>{
   const compact=item.endMinute-item.startMinute<45;
   const html=eventButton(item,item.key,`top:${item.startMinute/1440*100}%;height:max(2px,calc(${(item.endMinute-item.startMinute)/1440*100}% - 1px));left:calc(${item.lane/item.columns*100}% + 3px);width:calc(${item.span/item.columns*100}% - 6px)`, '',compact);
   return D.editable(item)&&!offline?html.replace('</button>','<span class="gc-resize" aria-hidden="true"></span></button>'):html;
  }).join('')}</div>`).join('')}</div>`;
 }
 function dayItems(date){return items.map((item,index)=>({item,index})).filter(({item})=>D.onDay(item.event,date)).sort((a,b)=>Number(D.banner(b.item.event))-Number(D.banner(a.item.event))||D.bounds(a.item.event).start-D.bounds(b.item.event).start);}
 function monthEntry(row){return eventButton(row.item,row.index,'',(D.banner(row.item.event)?'':time(D.bounds(row.item.event).start)+' ')+name(row.item.event));}
 function month(dates){const today=D.dayKey(new Date());return `<div class="gc-month">${dates.slice(0,7).map(d=>`<div class="gc-heading" style="min-height:32px;position:static">${d.toLocaleDateString('zh-CN',{weekday:'short'})}</div>`).join('')}${dates.map(date=>{const rows=dayItems(date);return `<div class="gc-month-day ${date.getMonth()!==anchor.getMonth()?'outside':''} ${D.dayKey(date)===today?'today':''}" data-date="${D.dayKey(date)}"><button data-gc="day" data-date="${D.dayKey(date)}" aria-label="${D.dayKey(date)}">${date.getDate()}</button>${rows.slice(0,monthLimit).map(monthEntry).join('')}${rows.length>monthLimit?`<button class="gc-month-more" data-gc="day-more" data-date="${D.dayKey(date)}">另外 ${rows.length-monthLimit} 项</button>`:''}</div>`;}).join('')}</div>`;}
 function fitMonth(){if(!visible()||view!=='month')return;const cell=document.querySelector('.gc-month-day');if(!cell)return;const limit=D.monthCapacity(cell.clientHeight);if(limit!==monthLimit){monthLimit=limit;paint();}}
 function closeDayPopup(focus=true){if(!dayPopup)return false;dayPopup.remove();dayPopup=null;const button=dayPopupOrigin;dayPopupOrigin=null;if(focus&&button?.isConnected)button.focus({preventScroll:true});return true;}
 function showDayPopup(button){closeDayPopup(false);const date=D.dateOnly(button.dataset.date),rows=dayItems(date);dayPopupOrigin=button;dayPopup=document.createElement('div');dayPopup.className='gc-day-popover';dayPopup.setAttribute('role','dialog');dayPopup.setAttribute('aria-label',label(date)+'日程');dayPopup.innerHTML=`<button class="gc-day-popover-close" data-gc="day-popup-close" aria-label="关闭当天日程">×</button><header><span>${date.toLocaleDateString('zh-CN',{weekday:'long'})}</span><strong>${date.getDate()}</strong></header><div class="gc-day-popover-events">${rows.map(monthEntry).join('')}</div>`;document.querySelector('#google-calendar').appendChild(dayPopup);const rect=button.closest('.gc-month-day').getBoundingClientRect(),box=dayPopup.getBoundingClientRect(),scale=Number(document.body.style.zoom)||1;dayPopup.style.left=Math.max(12,Math.min(innerWidth-box.width-12,rect.left+(rect.width-box.width)/2))/scale+'px';dayPopup.style.top=Math.max(12,Math.min(innerHeight-box.height-12,rect.top-20))/scale+'px';dayPopup.querySelector('.gc-day-popover-close').focus({preventScroll:true});}
 function agenda(){let previous='',group=-1;return items.length?`<table class="gc-agenda"><tbody>${items.map((item,index)=>{
  const b=D.bounds(item.event),key=D.dayKey(b.start),first=key!==previous,allDay=D.banner(item.event);if(first){group++;previous=key;}
  const continuation=allDay&&!first&&index>0&&D.banner(items[index-1].event);let span=1;if(allDay&&!continuation)while(index+span<items.length&&D.dayKey(D.bounds(items[index+span].event).start)===key&&D.banner(items[index+span].event))span++;
  const clock=continuation?'':`<td class="gc-agenda-time"${span>1?` rowspan="${span}"`:''}>${first?`<strong>${label(b.start)} <small>${b.start.toLocaleDateString('zh-CN',{weekday:'short'})}</small></strong>`:''}<span>${allDay?'全天':time(b.start)+'–'+time(b.end)}</span></td>`;
  return `<tr class="${group%2?'day-alternate':''} ${first?'day-start':''}">${clock}<td>${eventButton(item,index,'',name(item.event))}</td></tr>`;
 }).join('')}</tbody></table>`:'<div class="gc-empty">此期间没有事件</div>';}

 async function load(){const ticket=++epoch;try{const value=await api(q('status'));if(!visible()||ticket!==epoch)return;status=value;overviewCache=null;if(status.connected){const result=await api(q('calendars'));if(!visible()||ticket!==epoch)return;calendars=await decorateCalendars(result.items);if(!visible()||ticket!==epoch)return;try{const colors=await api(q('colors'));if(!visible()||ticket!==epoch)return;eventColors=colors.event||{};}catch{}selected=new Set(calendars.filter(c=>c.primary||c.selected).map(c=>c.id));if(!selected.size&&calendars[0])selected.add(calendars[0].id);await loadEvents();}else paint();}catch(e){if(visible()&&ticket===epoch){error=e.message;$('#google-calendar').innerHTML=`<div class="gc-empty">${esc(error)}<p><button data-gc="status">重试</button></p></div>`;}}}
 function eventQuery(){const range=D.range(anchor,view);return JSON.stringify([range.start.toISOString(),range.end.toISOString(),[...selected].sort()]);}
 async function loadEvents(){const ticket=++epoch,range=D.range(anchor,view),query=eventQuery();loading=true;error='';const refresh=document.querySelector('[data-gc=refresh]');if(refresh){refresh.disabled=true;refresh.textContent='同步中…';}try{
  const requests=calendars.filter(c=>selected.has(c.id)).map(async calendar=>{const value=await api(q('events',{calendar:calendar.id,since:range.start.toISOString(),until:range.end.toISOString()}));return {calendar,...value};});
  const results=await Promise.all(requests);if(!visible()||ticket!==epoch)return;
  loadedQuery=query;items=results.flatMap(result=>result.items.map(event=>({calendar:result.calendar,event}))).sort((a,b)=>D.bounds(a.event).start-D.bounds(b.event).start);items.forEach((item,index)=>item.key=index);offline=results.some(r=>r.offline);synced=results.length?Math.min(...results.map(r=>r.synced_at)):0;error=results.filter(r=>r.offline).map(r=>r.error).join('；');
 }catch(e){if(!visible()||ticket!==epoch)return;error=e.message;offline=true;items=[];}finally{if(visible()&&ticket===epoch){loading=false;const refresh=document.querySelector('[data-gc=refresh]');if(refresh){refresh.disabled=false;refresh.textContent='刷新';}paint();}}}
 function paintToday(){
  const root=document.querySelector('#gc-today');if(!root||page!=='overview')return;const value=overviewCache;const assign=html=>{if(root._gcTodayHTML!==html){root.innerHTML=html;root._gcTodayHTML=html;}};
  if(!value?.ready){assign('<div class="gc-today-header"><h2>今日</h2></div><div class="gc-empty">正在读取…</div>');return;}
  const header='<div class="gc-today-header"><h2>今日</h2><button class="icon-button" data-gc="overview-calendar">查看日历</button></div>';
  if(!value.connected){assign(header+'<div class="gc-empty"><button data-gc="overview-calendar">连接 Google 日历</button></div>');return;}
  if(value.error&&!value.items.length){assign(header+`<div class="gc-empty">${esc(value.error)} <button data-gc="overview-retry">重试</button></div>`);return;}
  const now=new Date();assign(header+(value.items.length?`<div class="gc-today-list">${value.items.map((item,index)=>{const b=D.bounds(item.event),range=D.banner(item.event)?'全天':time(b.start)+'–'+time(b.end),appearance=eventAppearance(item);return `<button class="gc-today-row ${b.end<now?'past':''}" data-gc="overview-event" data-key="${index}" style="--event-color:${appearance.color}" title="${esc(name(item.event))}"><span class="gc-today-time">${range}</span><span class="gc-today-main"><b>${esc(name(item.event))}</b>${item.event.location||appearance.label?`<small>${esc([appearance.label,item.event.location].filter(Boolean).join(' · '))}</small>`:''}</span></button>`;}).join('')}</div>`:'<div class="gc-today-list"><p class="gc-empty">今天没有日程</p></div>'));
 }
 function mountOverview(force=false){
  if(!document.querySelector('#gc-today')||page!=='overview')return;
  const key=D.dayKey(new Date())+':'+[...selected].sort().join('|');
  if(!force&&overviewCache?.key===key&&(overviewCache.promise||Date.now()-overviewCache.at<60000)){paintToday();return;}
  const entry={key,at:Date.now(),items:[],ready:false,connected:false};overviewCache=entry;paintToday();
  entry.promise=(async()=>{try{
   const account=await api(q('status'));entry.connected=account.connected;if(!account.connected)return;
   let values=calendars.length?calendars:await decorateCalendars((await api(q('calendars'))).items);
   const colors=await api(q('colors')).catch(()=>({}));eventColors=colors.event||eventColors;
   const chosen=values.filter(c=>selected.size?selected.has(c.id):c.primary||c.selected);if(!chosen.length&&values[0]&&!selected.size)chosen.push(values[0]);
   const range=D.range(new Date(),'day'),results=await Promise.allSettled(chosen.map(async calendar=>{const events=await api(q('events',{calendar:calendar.id,since:range.start.toISOString(),until:range.end.toISOString()}));return events.items.map(event=>({calendar,event}));}));
   entry.items=results.filter(r=>r.status==='fulfilled').flatMap(r=>r.value).sort((a,b)=>Number(D.banner(b.event))-Number(D.banner(a.event))||D.bounds(a.event).start-D.bounds(b.event).start);
   const failure=results.find(r=>r.status==='rejected');if(failure)entry.error=failure.reason.message;
  }catch(error){entry.error=error.message;}finally{entry.ready=true;entry.promise=null;entry.at=Date.now();if(overviewCache===entry)paintToday();}})();
 }
 function configure(){openModal('Google 日历客户端',`<div class="gc-config-note"><p>在 Google Cloud 中启用 Calendar API，创建“桌面应用”OAuth 客户端，然后导入下载的 JSON 配置。</p>${status?.connected?'<p>更换客户端会移除本机连接。</p>':''}</div>${status?.configured?field('客户端 ID',`<input readonly value="${esc(status.client_id)}">`):''}<label class="field full"><span>客户端配置</span><input id="gc-client-file" type="file" accept="application/json,.json"></label><div class="gc-config-note"><button data-gc="help">查看设置说明</button></div>`,`${btn('close','取消')}<button data-gc="import" class="primary">导入</button>`,'form');}
 function account(){if(status?.read_only){openModal('Google 日历','<p class="gc-config-note">只读日历快照</p>',btn('close','关闭'),'compact');return;}openModal('Google 日历',`<div class="gc-config-note"><p>${esc(calendars.find(c=>c.primary)?.id||'Google 账号已连接')}</p></div><div class="toolbar"><button data-gc="configure">客户端配置…</button>${!status?.label_permission?'<button data-gc="connect">同步标签授权…</button>':''}<button data-gc="disconnect" class="danger">断开连接…</button></div>`,btn('close','完成'),'compact');}
 function baseEvent(date){const start=new Date(date||new Date());if(!date)start.setMinutes(Math.ceil(start.getMinutes()/15)*15,0,0);const end=new Date(+start+3600000);return {summary:'',start:{dateTime:start.toISOString(),timeZone:zone},end:{dateTime:end.toISOString(),timeZone:zone},reminders:{useDefault:true}};}
 async function editor(item=null,date=null){const ticket=++editEpoch;let event=item?.event||baseEvent(date);if(item){const value=await api(q('event',{calendar:item.calendar.id,event:event.id}));event=value;}if(ticket!==editEpoch||!visible())return;
  editing={calendar:item?.calendar||calendars.find(c=>selected.has(c.id)&&['owner','writer','writerWithoutPrivateAccess'].includes(c.accessRole))||calendars.find(c=>['owner','writer','writerWithoutPrivateAccess'].includes(c.accessRole)),event,existing:!!item,series:false,original:event};renderEditor();}
 function renderEditor(){window.HotTurkeyGooglePicker.close(false);const {event,calendar,existing}=editing;const readOnly=existing&&(!D.editable({event,calendar})||offline),allDay=!!event.start.date,tz=event.start.timeZone||zone;
  const repeat=(event.recurrence||[]).join('\n'),repeatKey=repeat==='RRULE:FREQ=DAILY'?'DAILY':repeat==='RRULE:FREQ=WEEKLY'?'WEEKLY':repeat==='RRULE:FREQ=MONTHLY'?'MONTHLY':repeat==='RRULE:FREQ=YEARLY'?'YEARLY':repeat?'custom':'none';
  const reminder=event.reminders?.useDefault?'default':event.reminders?.overrides?.length===1&&event.reminders.overrides[0].method==='popup'?String(event.reminders.overrides[0].minutes):event.reminders?.overrides?.length?'custom':'none';
  let start=D.input(event.start,tz),end=D.input(event.end,tz);if(allDay)end=D.dayKey(D.addDays(D.dateOnly(end),-1));
  const body=`<div class="gc-editor"><div class="form-grid">${field('标题',`<input id="gc-title" value="${esc(event.summary||'')}" maxlength="1000" autofocus ${readOnly?'readonly':''}>`,true)}${field('日历',`<select id="gc-target" ${existing?'disabled':''}>${calendars.filter(c=>c.id===calendar.id||['owner','writer','writerWithoutPrivateAccess'].includes(c.accessRole)).map(c=>`<option value="${esc(c.id)}" ${c.id===calendar.id?'selected':''}>${esc(c.summary||c.id)}</option>`).join('')}</select>`,true)}${event.recurringEventId?field('修改范围',`<select id="gc-scope" ${readOnly?'disabled':''}><option value="single">仅本次事件</option><option value="series" ${editing.series?'selected':''}>整组重复事件</option></select>`,true):editing.series?'<p class="gc-event-meta">正在编辑整组重复事件</p>':''}<label class="gc-all-day-control full"><span>全天</span><input id="gc-all-day" type="checkbox" role="switch" ${allDay?'checked':''} ${readOnly?'disabled':''}></label>${field('开始',window.HotTurkeyGooglePicker.field('gc-start',start,allDay,readOnly))}${field('结束',window.HotTurkeyGooglePicker.field('gc-end',end,allDay,readOnly))}${!allDay?field('时区',window.HotTurkeyGooglePicker.zone('gc-zone',tz,readOnly),true):''}${eventAppearance({event,calendar}).label?field('标签',`<span class="gc-label-badge" style="--event-color:${eventAppearance({event,calendar}).color}">${esc(eventAppearance({event,calendar}).label)}</span>`,true):''}${!event.recurringEventId?field('重复',`<select id="gc-repeat" ${readOnly?'disabled':''}>${options({none:'不重复',DAILY:'每天',WEEKLY:'每周',MONTHLY:'每月',YEARLY:'每年',...(repeatKey==='custom'?{custom:'自定义重复规则'}:{})},repeatKey)}</select>`):''}${field('提醒',`<select id="gc-reminder" ${readOnly?'disabled':''}>${options({default:'日历默认',none:'无',5:'提前 5 分钟',10:'提前 10 分钟',15:'提前 15 分钟',30:'提前 30 分钟',60:'提前 1 小时',1440:'提前 1 天',...(!['default','none','5','10','15','30','60','1440'].includes(reminder)?{[reminder]:'保留原提醒'}:{})},reminder)}</select>`)}${field('地点',`<input id="gc-location" value="${esc(event.location||'')}" maxlength="2000" ${readOnly?'readonly':''}>`,true)}${field('参与者',`<input id="gc-attendees" value="${esc((event.attendees||[]).map(a=>a.email).filter(Boolean).join(', '))}" placeholder="邮箱，用逗号分隔" ${readOnly?'readonly':''}>`,true)}${field('说明',`<textarea id="gc-description" maxlength="20000" ${readOnly?'readonly':''}>${esc(event.description||'')}</textarea>`,true)}</div>${event.attendees?.length&&!readOnly?'<p class="gc-event-meta">保存更改会通知参与者。</p>':''}<div class="toolbar">${event.htmlLink?`<button data-gc="open-original">在 Google 日历中打开</button>`:''}${event.hangoutLink?'<button data-gc="open-meeting">加入会议</button>':''}</div></div>`;
  openModal(existing?'事件详情':'新建事件',body,`${existing&&!readOnly?'<button data-gc="delete-confirm" class="danger">删除…</button><span class="grow"></span>':''}${btn('close',readOnly?'关闭':'取消')}${!readOnly?'<button data-gc="save" class="primary">保存</button>':''}`,'form');
  if(modal.dataset)modal.dataset.gcPrivate='true';
 }
 function draft(){const root=modal,get=id=>$('#'+id,root)?.value,allDay=$('#gc-all-day',root).checked;let start=get('gc-start'),end=get('gc-end');if(!start||!end)throw Error('请选择开始和结束时间');
  const value={summary:get('gc-title'),start:allDay?{date:start}:{dateTime:start+':00',timeZone:get('gc-zone')},end:allDay?{date:D.dayKey(D.addDays(D.dateOnly(end),1))}:{dateTime:end+':00',timeZone:get('gc-zone')}};
  if(editing.existing&&allDay===!!editing.event.start.date){
   const originalZone=editing.event.start.timeZone||zone;
   for(const [key,shown] of [['start',start],['end',end]]){
    let original=D.input(editing.event[key],originalZone);if(allDay&&key==='end')original=D.dayKey(D.addDays(D.dateOnly(original),-1));
    if(shown===original&&(allDay||get('gc-zone')===originalZone))value[key]={...editing.event[key]};
   }
  }
  for(const [key,id] of [['location','gc-location'],['description','gc-description']])if(get(id)!==(editing.event[key]||''))value[key]=get(id);
  const attendees=get('gc-attendees');if(attendees!==(editing.event.attendees||[]).map(a=>a.email).filter(Boolean).join(', '))value.attendees=attendees.split(/[,，;]/).map(s=>s.trim()).filter(Boolean).map(email=>({email}));
  const repeat=get('gc-repeat');if(repeat&&repeat!=='custom')value.recurrence=repeat==='none'?[]:['RRULE:FREQ='+repeat];
  const reminder=get('gc-reminder');if(reminder!=='custom'){if(reminder==='default')value.reminders={useDefault:true};else value.reminders={useDefault:false,overrides:reminder==='none'?[]:[{method:'popup',minutes:Number(reminder)}]};}
  return {calendar:get('gc-target'),event:editing.existing?editing.event.id:null,etag:editing.event.etag,value};
 }
 async function handle(action,element){
  if(action==='overview-retry'){mountOverview(true);return;}
  if(action==='overview-calendar'||action==='overview-event'){const item=action==='overview-event'?overviewCache?.items[Number(element.dataset.key)]:null;source='google';page='schedule';renderPage();if(item)await editor(item);return;}
  if(action==='help'){openModal('设置 Google 日历',`<ol class="gc-config-note"><li>在 Google Cloud 中启用 Google Calendar API。</li><li>配置 OAuth 受众；个人测试时将自己的账号加入测试用户。</li><li>创建“桌面应用”客户端，下载 JSON 并在这里导入。</li></ol>`,`${btn('close','关闭')}<button data-gc="open-cloud">打开 Google Cloud</button><button data-gc="configure" class="primary">导入配置…</button>`,'form');return;}
  if(action==='open-cloud')return external('https://console.cloud.google.com/apis/credentials');
  if(action==='configure')return configure();
  if(action==='import'){const file=$('#gc-client-file',modal).files[0];if(!file)throw Error('请选择桌面应用客户端配置');if(file.size>65536)throw Error('配置文件过大');let configuration;try{configuration=JSON.parse(await file.text());}catch{throw Error('无法读取 JSON 配置');}status=await api(q('configure'),{configuration});closeModal();items=[];calendars=[];render(true);toast('配置已导入','saved');return;}
  if(action==='connect'){if(modal.open)closeModal();const value=await api(q('connect'),{});external(value.url);status.pending=true;status.error='';paint();return;}
  if(action==='cancel-connect'){await api(q('cancel'),{});await load();return;}
  if(action==='status'){await load();return;}
  if(action==='account')return account();
  if(action==='disconnect'){openModal('断开 Google 日历',`<p class="sheet-intro">从此 Mac 移除连接和日历缓存。Google 日历中的事件会保留。</p>`,`${btn('close','取消')}<button data-gc="disconnect-confirm" class="danger">断开连接</button>`,'compact');return;}
  if(action==='disconnect-confirm'){await api(q('disconnect'),{});closeModal();hide();render();return;}
  if(action==='all-day-toggle'){allDayExpanded=!allDayExpanded;paint();return;}
  if(action==='previous'||action==='next'){anchor=D.move(anchor,view,action==='next'?1:-1);return loadEvents();}
  if(action==='today'){anchor=new Date();return loadEvents();}
  if(action==='view'){if(view===element.dataset.view)return;view=element.dataset.view;if(!loading&&loadedQuery===eventQuery()){paint();return;}return loadEvents();}
  if(action==='day-more'){showDayPopup(element);return;}
  if(action==='day-popup-close'){closeDayPopup();return;}
  if(action==='day'){anchor=D.dateOnly(element.dataset.date);view='day';return loadEvents();}
  if(action==='refresh')return loadEvents();
  if(action==='new')return editor();
  if(action==='event'){if(skipClick)return;closeDayPopup(false);if(items[Number(element.dataset.key)])return editor(items[Number(element.dataset.key)]);return;}
  if(action==='save'){const value=draft();await api(q('save'),value);closeModal();editing=null;await loadEvents();return;}
  if(action==='delete-confirm'){openModal('删除事件',`<p class="sheet-intro">${esc(name(editing.event))}</p><p class="gc-config-note">${editing.series||editing.event.recurrence?'整组重复事件将从 Google 日历删除。':'此事件将从 Google 日历删除。'}</p>`,`${btn('close','取消')}<button data-gc="delete" class="danger">${editing.series||editing.event.recurrence?'删除整组事件':'删除事件'}</button>`,'compact');return;}
  if(action==='delete'){await api(q('delete'),{calendar:editing.calendar.id,event:editing.event.id,etag:editing.event.etag});closeModal();editing=null;return loadEvents();}
  if(action==='open-original')return external(editing.event.htmlLink);
  if(action==='open-meeting')return external(editing.event.hangoutLink);
 }
 document.addEventListener('click',async event=>{
  if(dayPopup&&!dayPopup.contains(event.target)&&!event.target.closest('[data-gc=day-more]'))closeDayPopup(false);
  const sourceButton=event.target.closest('[data-gc-source]');if(sourceButton){if(source===sourceButton.dataset.gcSource)return;source=sourceButton.dataset.gcSource;try{localStorage.setItem('hot-calendar-source',source);}catch{}epoch++;editEpoch++;renderCalendar();return;}
  const element=event.target.closest('[data-gc]');if(!element)return;const action=element.dataset.gc;const mutation=['save','delete','import','disconnect-confirm','connect'].includes(action);if(element.disabled)return;
  if(mutation)element.disabled=true;try{await handle(action,element);}catch(error){if(modal.open)showModalError(error.message);else toast(error.message);}finally{if(mutation&&element.isConnected)element.disabled=false;}
 });
 document.addEventListener('change',async event=>{const el=event.target;try{
  if(el.dataset.gcCalendar){overviewCache=null;el.checked?selected.add(el.dataset.gcCalendar):selected.delete(el.dataset.gcCalendar);await loadEvents();}
  if(el.id==='gc-all-day'){const allDay=el.checked;for(const id of ['gc-start','gc-end'])window.HotTurkeyGooglePicker.setAllDay(id,allDay);if(allDay){$('#gc-zone',modal)?.closest('.field').remove();}else{const holder=document.createElement('div');holder.innerHTML=field('时区',window.HotTurkeyGooglePicker.zone('gc-zone',zone),true);$('.form-grid',modal).appendChild(holder.firstElementChild);}}
  if(el.id==='gc-scope'&&el.value==='series'){const series=await api(q('event',{calendar:editing.calendar.id,event:editing.event.recurringEventId}));editing.event=series;editing.series=true;renderEditor();}
 }catch(error){if(modal.open)showModalError(error.message);else toast(error.message);}});
 document.addEventListener('dblclick',event=>{const day=event.target.closest('.gc-day,.gc-month-day');if(!day||event.target.closest('.gc-event,button')||offline||!calendars.some(c=>['owner','writer','writerWithoutPrivateAccess'].includes(c.accessRole)))return;const date=D.dateOnly(day.dataset.date);if(day.classList.contains('gc-day')){const box=day.getBoundingClientRect(),minute=Math.min(1425,Math.max(0,Math.floor((event.clientY-box.top)/box.height*1440/15)*15));date.setMinutes(minute);}else date.setHours(9);editor(null,date).catch(e=>toast(e.message));});
 document.addEventListener('pointerdown',event=>{if(event.button!==0||!visible()||offline||loading)return;const el=event.target.closest('.gc-day>.gc-event');if(!el)return;const item=items[Number(el.dataset.key)];if(!item||!D.editable(item)||item.event.start.date)return;dragging={el,item,x:event.clientX,y:event.clientY,resize:!!event.target.closest('.gc-resize'),date:el.closest('.gc-day').dataset.date,start:D.bounds(item.event).start,end:D.bounds(item.event).end,columns:[...document.querySelectorAll('.gc-day')].map(day=>({day,box:day.getBoundingClientRect()}))};el.setPointerCapture(event.pointerId);});
 document.addEventListener('pointermove',event=>{const d=dragging;if(!d||Math.hypot(event.clientX-d.x,event.clientY-d.y)<5&&!d.changed)return;const day=d.columns.find(col=>event.clientX>=col.box.left&&event.clientX<col.box.right)?.day||d.el.closest('.gc-day'),box=day.getBoundingClientRect(),delta=Math.round((event.clientY-d.y)/box.height*1440/15)*15;d.changed=true;d.el.classList.add('dragging');
  const target=D.dateOnly(day.dataset.date),origin=D.dateOnly(d.date);const dayDelta=Math.round((Date.UTC(target.getFullYear(),target.getMonth(),target.getDate())-Date.UTC(origin.getFullYear(),origin.getMonth(),origin.getDate()))/86400000);
  if(d.resize){d.newStart=new Date(d.start);d.newEnd=new Date(Math.max(+d.start+15*60000,+d.end+delta*60000));}else{d.newStart=D.addDays(d.start,dayDelta);d.newStart.setMinutes(d.newStart.getMinutes()+delta);d.newEnd=new Date(+d.newStart+(d.end-d.start));}
  const start=d.newStart.getHours()*60+d.newStart.getMinutes(),length=(d.newEnd-d.newStart)/60000;d.el.style.transform=`translate(${d.resize?0:(day.getBoundingClientRect().left-d.el.parentElement.getBoundingClientRect().left)}px,${(d.newStart-d.start-dayDelta*86400000)/60000/1440*box.height}px)`;d.el.style.height=`${Math.min(1440-start,length)/1440*100}%`;
 });
 document.addEventListener('pointerup',async()=>{const d=dragging;dragging=null;if(!d?.changed)return;skipClick=true;setTimeout(()=>skipClick=false,180);loading=true;try{await api(q('save'),{calendar:d.item.calendar.id,event:d.item.event.id,etag:d.item.event.etag,value:{start:{dateTime:d.newStart.toISOString(),timeZone:zone},end:{dateTime:d.newEnd.toISOString(),timeZone:zone}}});await loadEvents();}catch(error){loading=false;paint();toast(error.message);}});
 document.addEventListener('pointercancel',()=>{dragging=null;if(visible())paint();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&dayPopup){event.preventDefault();event.stopPropagation();closeDayPopup();}},true);
 const monthWheel={last:0,total:0,switched:false};
 document.addEventListener('wheel',event=>{
  if(!visible()||view!=='month'||modal.open||dayPopup||!event.deltaY||event.ctrlKey||Math.abs(event.deltaX)>Math.abs(event.deltaY)||!event.target.closest('.gc-month'))return;
  event.preventDefault();const now=Date.now();if(now-monthWheel.last>180){monthWheel.total=0;monthWheel.switched=false;}monthWheel.last=now;if(monthWheel.switched||loading)return;
  const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?innerHeight:1);if(Math.sign(delta)!==Math.sign(monthWheel.total))monthWheel.total=0;monthWheel.total+=delta;
  monthWheel.switched=true;anchor=D.move(anchor,'month',Math.sign(monthWheel.total));loadEvents().catch(error=>toast(error.message));
 },{passive:false});
 window.addEventListener('resize',()=>{closeDayPopup(false);if(view==='month'&&typeof requestAnimationFrame==='function')requestAnimationFrame(fitMonth);});
 setInterval(()=>{if(!visible()||modal.open||loading||dayPopup)return;if(status?.pending)load();else if(status?.connected)loadEvents();},60000);
 setInterval(async()=>{if(!visible()||!status?.pending||loading||modal.open)return;const ticket=epoch;try{const next=await api(q('status'));if(!visible()||ticket!==epoch)return;if(next.connected){await load();return;}if(next.pending!==status.pending||next.error!==status.error){status=next;paint();}}catch{}},2500);
 return {mountOverview,deactivate(){editEpoch++;dragging=null;closeDayPopup(false);},isSelected:()=>source==='google',switcher,render,hide};
})();
