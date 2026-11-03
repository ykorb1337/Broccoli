'use strict';
window.HotTurkeyGoogleCalendar=(()=>{
 const D=HotTurkeyGoogleData,zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
 const hoursFormat=new Intl.NumberFormat('zh-CN',{maximumFractionDigits:1});
 const timeFormat=new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}),labelFormat=new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric'});
 let analysisOpen=false;const eventCache=D.createEventCache();let accountEpoch=0,layoutItems=null,layoutKey='',layoutDays=null,itemSignature='',detail=null,detailPopup=null,detailEpoch=0,detailLoading=false;
 const icon=(path,extra='')=>`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${path}</svg>`;
 const refreshIcon=icon('<path d="M19.5 8a8 8 0 1 0 .5 6M19.5 3.5V8H15"/>');
 const editIcon=icon('<path d="m15 4 5 5M4 20l4.5-1L20 7.5 16.5 4 5 15.5 4 20Z"/>');
 const externalIcon=icon('<path d="M14 4h6v6M20 4 10 14M10 5H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-5"/>');
 let source='blocks';try{source=localStorage.getItem('hot-calendar-source')==='google'?'google':'blocks';}catch{}
 let status=null,calendars=[],items=[],selected=new Set(),anchor=new Date(),view='week',epoch=0,loading=false,error='',synced=0,offline=false,editing=null,dragging=null,skipClick=false,editEpoch=0,eventColors={},overviewCache=null,monthLimit=3,dayPopup=null,dayPopupOrigin=null,loadedQuery='',labelDraft=null;
 const q=(path,values={})=>'google-calendar/'+path+(Object.keys(values).length?'?'+new URLSearchParams(values):'');
 const visible=()=>page==='schedule'&&source==='google'&&document.querySelector('#google-calendar');
 const color=c=>/^#[a-f\d]{6}$/i.test(c.backgroundColor||'')?c.backgroundColor:'#007aff';
 const time=date=>timeFormat.format(date);
 const label=date=>labelFormat.format(date);
 const name=e=>e.summary||'未命名事件';
 function switcher(){return `<div class="gc-source-header"><div class="schedule-source" role="group" aria-label="日程来源"><button data-gc-source="blocks" aria-pressed="${source==='blocks'}">拦截日程</button><button data-gc-source="google" aria-pressed="${source==='google'}">Google 日历</button></div><div class="gc-source-actions">${sourceTools()}</div></div>`;}
 function sourceTools(){return source==='google'&&status?.connected?`<button data-gc="analysis" class="gc-round-button" aria-label="时间分析" title="时间分析" aria-pressed="${analysisOpen}">${icon('<path d="M12 3v9h9M20.5 16A9 9 0 1 1 8 3.9M16 3.5A9 9 0 0 1 20.5 8"/>')}</button><button data-gc="account" class="gc-round-button" aria-label="Google 日历账户" title="账户">${icon('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="9" r="3"/><path d="M5.6 18a7 7 0 0 1 12.8 0"/>')}</button>`:'';}
 function external(link){
  const value=D.externalURL(link);
  if(window.HotTurkeyNativeShell)window.webkit.messageHandlers.native.postMessage({op:'google-calendar-open',url:value});else window.open(value,'_blank','noopener,noreferrer');
 }
 function render(force=false){if(!force&&visible()&&status)return;epoch++;$('#content').innerHTML=switcher()+'<section id="google-calendar" class="google-calendar"><div class="gc-empty">正在读取…</div></section>';if(!force&&status?.connected){paint();loadEvents();}else load();}
 function hide(){restoreDrag(dragging);labelDraft=null;accountEpoch++;eventCache.clear();closeEventDetails(false);itemSignature='';layoutItems=null;loadedQuery='';if(modal.open&&modal.dataset?.gcPrivate==='true')closeModal();overviewCache=null;epoch++;editEpoch++;dragging=null;editing=null;calendars=[];items=[];status=null;selected.clear();}
 function disconnected(){const title=!status?.configured?'连接 Google 日历':status.pending?'等待 Google 授权':'登录 Google 日历';const note=!status?.configured?'导入桌面应用客户端配置后，登录你的 Google 账号。':status.pending?'请在浏览器中完成登录，然后返回这里。':'查看和编辑你的 Google 日历。';return `<div class="gc-connect"><div class="gc-connect-inner"><div class="gc-mark" aria-hidden="true"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 10h18M8 14h3M14 14h2M8 17h2M14 17h2"/></svg></div><h2>${title}</h2><p>${note}</p><div class="toolbar">${!status?.configured?'<button class="primary" data-gc="configure">导入客户端配置…</button>':status.pending?'<button data-gc="cancel-connect">取消</button><button data-gc="status">已完成登录</button>':'<button class="primary" data-gc="connect">登录 Google</button><button data-gc="configure">客户端配置…</button>'}</div>${!status?.configured?'<button class="icon-button" data-gc="help">设置说明</button>':''}${status?.error?`<p role="alert">${esc(status.error)}</p>`:''}</div></div>`;}
 // Keep unchanged nodes and their compositing/scroll state across refreshes.
 function commit(root,markup){
  if(root._gcMarkup===markup)return;
  if(typeof document.createElement!=='function'||!root.childNodes){root.innerHTML=markup;root._gcMarkup=markup;return;}
  const template=document.createElement('template');template.innerHTML=markup;
  function reconcile(parent,fresh){
   const incoming=[...fresh.childNodes],key=node=>node?.nodeType===1?node.getAttribute('data-gc-node'):null;
   const previous=new Map([...parent.childNodes].map(node=>[key(node),node]).filter(([id])=>id)),wanted=new Set(incoming.map(key).filter(Boolean));
   for(const child of [...parent.childNodes])if(key(child)&&!wanted.has(key(child)))child.remove();
   incoming.forEach((next,i)=>{let current=parent.childNodes[i];const id=key(next);
    if(id){const retained=previous.get(id);if(retained){if(retained!==current)parent.insertBefore(retained,current||null);current=retained;}else{parent.insertBefore(next.cloneNode(true),current||null);return;}}
    else if(key(current)&&wanted.has(key(current))){parent.insertBefore(next.cloneNode(true),current);return;}
    if(!current){parent.appendChild(next.cloneNode(true));return;}
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
 function paint(direction=null){highlightCategory(null);closeDayPopup(false);const root=document.querySelector('#google-calendar');if(!root)return;if(!status?.connected){root.innerHTML=disconnected();return;}
  const tools=document.querySelector('.gc-source-actions');if(tools)commit(tools,sourceTools());
  const range=D.range(anchor,view),dates=Array.from({length:range.days},(_,i)=>D.addDays(range.start,i));
  const title=view==='month'?anchor.toLocaleDateString('zh-CN',{year:'numeric',month:'long'}):view==='day'?label(anchor):label(range.start)+' — '+label(D.addDays(range.end,-1));
  const markup=`<div class="gc-toolbar"><button data-gc="previous" aria-label="上一${view==='month'?'月':view==='day'?'天':'周'}">‹</button><button data-gc="today">今天</button><button data-gc="next" aria-label="下一${view==='month'?'月':view==='day'?'天':'周'}">›</button><h2>${esc(title)}</h2><span class="grow"></span><div class="gc-view" role="group" aria-label="Google 日历视图">${[['day','日'],['week','周'],['month','月'],['agenda','列表']].map(([key,text])=>`<button data-gc="view" data-view="${key}" aria-pressed="${view===key}">${text}</button>`).join('')}</div><button data-gc="refresh" class="gc-refresh ${loading?'syncing':''}" aria-label="刷新日历" title="刷新" aria-busy="${loading}" ${loading?'disabled':''}>${refreshIcon}</button><button data-gc="new" class="primary" ${offline||!calendars.some(c=>['owner','writer','writerWithoutPrivateAccess'].includes(c.accessRole))?'disabled':''}>新建事件</button></div><div class="gc-calendars">${calendars.map(c=>`<label class="gc-calendar-choice" style="--calendar-color:${color(c)}"><input type="checkbox" data-gc-calendar="${esc(c.id)}" ${selected.has(c.id)?'checked':''}>${esc(c.summaryOverride||c.summary||c.id)}</label>`).join('')}<span class="gc-status" role="status">${status?.preview_copy?'独立副本':status?.read_only?'只读预览':offline?'离线副本':synced?'更新于 '+time(new Date(synced*1000)):''}</span></div>${error?`<div class="gc-alert" role="alert">${esc(error)}</div>`:''}<div class="gc-workspace" data-gc-node="workspace"><div class="gc-scroller">${view==='month'?'<div class="gc-month-frame">'+month(dates)+'</div>':view==='agenda'?agenda():week(dates)}</div>${analysisOpen?analysisPanel():''}</div>`;const paintKey=view+':'+range.start.toISOString(),previous=root.querySelector?.('.gc-scroller'),scroll=root._gcPaintKey===paintKey?previous?.scrollTop||0:0;
  let surface=root.querySelector?.('.gc-surface');if(!surface&&typeof document.createElement==='function'&&root.replaceChildren){surface=document.createElement('div');surface.className='gc-surface';root.replaceChildren(surface);}commit(surface||root,markup);
  const scroller=root.querySelector?.('.gc-scroller');if(scroller&&scroller.scrollTop!==scroll)scroller.scrollTop=scroll;root._gcPaintKey=paintKey;setRefresh();updateNow();animateView(scroller,direction);observeMonthSize();
 }
 let appearanceItems=null,appearancePalette=null,appearances=new WeakMap();
 function eventAppearance(item){if(appearanceItems!==items||appearancePalette!==eventColors){appearances=new WeakMap();appearanceItems=items;appearancePalette=eventColors;}let value=appearances.get(item);if(!value){value=D.eventAppearance(item,eventColors);appearances.set(item,value);}return value;}
 function indexedDays(dates){const key=dates.map(D.dayKey).join('|');if(items!==layoutItems||key!==layoutKey){layoutItems=items;layoutKey=key;layoutDays=D.dayIndex(items,dates);}return layoutDays;}
 function spinRefresh(button){const svg=button?.querySelector?.('svg');if(!svg?.animate||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;let animation=svg._gcSpin;if(!animation||animation.playState!=='running'){animation=svg.animate([{transform:'rotate(0)'},{transform:'rotate(360deg)'}],{duration:650,iterations:Infinity,easing:'linear'});svg._gcSpin=animation;}else animation.effect?.updateTiming({iterations:Infinity});}
 function setRefresh(){const button=document.querySelector('[data-gc=refresh]');if(!button)return;button.disabled=loading;button.classList?.toggle('syncing',loading);button.setAttribute?.('aria-busy',String(loading));if(loading)spinRefresh(button);else{const animation=button.querySelector?.('svg')?._gcSpin;if(animation?.playState==='running')animation.effect?.updateTiming({iterations:Math.max(1,Math.ceil((animation.currentTime||0)/650))});}}
 function animateView(scroller,direction){const target=scroller?.querySelector?.('.gc-month')||scroller?.firstElementChild;if(direction===null||!target?.animate||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;scroller._gcAnimation?.cancel();scroller._gcAnimation=target.animate([{opacity:.65,transform:`translateX(${(direction||0)*14}px)`},{opacity:1,transform:'translateX(0)'}],{duration:170,easing:'cubic-bezier(.2,.7,.2,1)'});}
 function updateNow(){if(!visible()||!['day','week'].includes(view))return;const root=document.querySelector('#google-calendar'),now=new Date(),key=D.dayKey(now);root?.querySelectorAll?.('.gc-now-line').forEach(line=>{const active=line.parentElement.dataset.date===key;line.hidden=!active;if(active){line.style.top=(now.getHours()*60+now.getMinutes()+now.getSeconds()/60)/1440*100+'%';line.setAttribute('aria-label','当前时间 '+time(now));}});}
 async function decorateCalendars(values){
  const replies=await Promise.allSettled(values.map(async calendar=>{const response=await api(q('labels',{calendar:calendar.id}));return {...calendar,labels:response.items||[],labels_ready:!response.error&&!response.needs_authorization,labels_need_authorization:!!response.needs_authorization};}));
  return values.map((calendar,i)=>replies[i].status==='fulfilled'?replies[i].value:calendar);
 }
 function eventButton(item,index,extra='',content='',compact=false,spanning=false){
  const b=D.bounds(item.event),range=D.banner(item.event)?'全天':time(b.start)+'–'+time(b.end),declined=item.event.attendees?.some(a=>a.self&&a.responseStatus==='declined'),chosen=eventAppearance(item);const eventColor=chosen.color,rgb=eventColor.slice(1).match(/../g).map(v=>parseInt(v,16)),ink=rgb[0]*.299+rgb[1]*.587+rgb[2]*.114>160?'#1d1d1f':'#fff';
  return `<button class="gc-event${declined?' declined':''}${D.banner(item.event)||spanning?' banner':content?' entry':''}${compact?' compact':''}" data-gc="event" data-gc-node="${esc(JSON.stringify([item.calendar.id,item.event.id||item.event.start]))}" data-key="${index}" data-gc-category="${esc(D.analysisCategory(item).key)}" aria-label="${esc(name(item.event)+' · '+range)}" title="${esc(name(item.event)+' · '+range+(chosen.label?' · '+chosen.label:''))}" style="--event-color:${eventColor};--event-ink:${ink};${extra}"><b>${esc(content||name(item.event))}</b>${!content&&!compact?`<small>${range}</small>`:''}</button>`;
 }
 function week(dates){
  const today=D.dayKey(new Date()),days=indexedDays(dates),now=D.nowIndicator(dates);
  const banners=D.weekRows(items,dates,true),bannerLanes=Math.max(1,...banners.map(row=>row.lane+1));
  return `<div class="gc-week" style="--days:${dates.length}"><div class="gc-heading"></div>${dates.map(date=>`<div class="gc-heading ${D.dayKey(date)===today?'today':''}"><span>${date.toLocaleDateString('zh-CN',{weekday:'short'})}</span><strong>${date.getDate()}</strong></div>`).join('')}<div class="gc-all-label"><span>全天</span></div><div class="gc-all-strip" style="--banner-lanes:${bannerLanes}">${banners.map(row=>eventButton(row.item,row.index,`grid-column:${row.startDay+1} / ${row.endDay+1};grid-row:${row.lane+1}`,name(row.item.event))).join('')}</div><div class="gc-hours">${Array.from({length:24},(_,i)=>`<span style="top:${i/24*100}%">${String(i).padStart(2,'0')}:00</span>`).join('')}</div>${dates.map(date=>`<div class="gc-day ${D.dayKey(date)===today?'today':''}" data-date="${D.dayKey(date)}" aria-label="${D.dayKey(date)}">${D.segments(days.get(D.dayKey(date)).filter(row=>!row.banner).map(row=>row.item),date).map(item=>{
   const compact=item.endMinute-item.startMinute<45;
   const html=eventButton(item,item.key,`top:${item.startMinute/1440*100}%;height:max(2px,calc(${(item.endMinute-item.startMinute)/1440*100}% - 1px));left:calc(${item.lane/item.columns*100}% + 3px);width:calc(${item.span/item.columns*100}% - 6px)`, '',compact);
   return D.editable(item)&&!offline?html.replace('</button>','<span class="gc-resize" aria-hidden="true"></span></button>'):html;
  }).join('')}<div class="gc-now-line" ${D.dayKey(date)===today?'':'hidden'} role="img" aria-label="当前时间" style="top:${(now?.minute||0)/1440*100}%"></div></div>`).join('')}</div>`;
 }
 function dayItems(date){const key=D.dayKey(date);return (layoutItems===items&&layoutDays?.has(key)?layoutDays:indexedDays([date])).get(key)||[];}
 function monthEntry(row){return eventButton(row.item,row.index,'',(D.banner(row.item.event)?'':time(D.bounds(row.item.event).start)+' ')+name(row.item.event));}
 function month(dates){indexedDays(dates);const today=D.dayKey(new Date());return `<div class="gc-month">${dates.slice(0,7).map(d=>`<div class="gc-heading" style="min-height:32px;position:static">${d.toLocaleDateString('zh-CN',{weekday:'short'})}</div>`).join('')}${Array.from({length:6},(_,weekIndex)=>{
  const week=dates.slice(weekIndex*7,weekIndex*7+7),rows=D.weekRows(items,week),shown=rows.filter(row=>row.lane<monthLimit);
  return `<div class="gc-month-week">${week.map((date,index)=>{const hiddenRows=rows.filter(row=>row.lane>=monthLimit&&row.startDay<=index&&row.endDay>index),hidden=hiddenRows.length,hiddenCategories=[...new Set(hiddenRows.map(row=>D.analysisCategory(row.item).key))];return `<div class="gc-month-day ${date.getMonth()!==anchor.getMonth()?'outside':''} ${D.dayKey(date)===today?'today':''}" data-date="${D.dayKey(date)}"><button data-gc="day" data-date="${D.dayKey(date)}" aria-label="${D.dayKey(date)}">${date.getDate()}</button>${hidden?`<button class="gc-month-more" data-gc="day-more" data-date="${D.dayKey(date)}" data-gc-categories="${esc(JSON.stringify(hiddenCategories))}">另外 ${hidden} 项</button>`:''}</div>`;}).join('')}<div class="gc-month-events">${shown.map(row=>{
   const html=eventButton(row.item,row.index,`grid-column:${row.startDay+1} / ${row.endDay+1};grid-row:${row.lane+1}`,(D.banner(row.item.event)?'':time(row.start)+' ')+name(row.item.event),false,row.spanning);
   return html.replace('class="gc-event',`class="gc-event${row.start<week[0]?' continues-before':''}${row.end>D.addDays(week[6],1)?' continues-after':''}`);
  }).join('')}</div></div>`;
 }).join('')}</div>`;}
 function fitMonth(){if(!visible()||view!=='month')return;const cell=document.querySelector('.gc-month-day');if(!cell)return;const limit=D.monthCapacity(cell.clientHeight);if(limit!==monthLimit){monthLimit=limit;paint();}}
 let monthSizeObserver=null,monthSizeTarget=null,monthSizeFrame=null;
 function observeMonthSize(){
  const target=view==='month'?document.querySelector('.gc-month-week'):null;
  if(target!==monthSizeTarget){monthSizeObserver?.disconnect();monthSizeTarget=target;
   if(target&&typeof ResizeObserver==='function'){monthSizeObserver??=new ResizeObserver(scheduleMonthFit);monthSizeObserver.observe(target);}
  }
  if(target)scheduleMonthFit();
 }
 function scheduleMonthFit(){if(typeof requestAnimationFrame!=='function'||monthSizeFrame!==null)return;monthSizeFrame=requestAnimationFrame(()=>{monthSizeFrame=null;fitMonth();});}
 function closeDayPopup(focus=true){if(!dayPopup)return false;dayPopup.remove();dayPopup=null;const button=dayPopupOrigin;dayPopupOrigin=null;if(focus&&button?.isConnected)button.focus({preventScroll:true});return true;}
 function showDayPopup(button){closeDayPopup(false);const date=D.dateOnly(button.dataset.date),rows=dayItems(date);dayPopupOrigin=button;dayPopup=document.createElement('div');dayPopup.className='gc-day-popover';dayPopup.setAttribute('role','dialog');dayPopup.setAttribute('aria-label',label(date)+'日程');dayPopup.innerHTML=`<button class="gc-day-popover-close" data-gc="day-popup-close" aria-label="关闭当天日程">×</button><header><span>${date.toLocaleDateString('zh-CN',{weekday:'long'})}</span><strong>${date.getDate()}</strong></header><div class="gc-day-popover-events">${rows.map(monthEntry).join('')}</div>`;document.querySelector('#google-calendar').appendChild(dayPopup);highlightCategory(highlightedCategory,true);const rect=button.closest('.gc-month-day').getBoundingClientRect(),box=dayPopup.getBoundingClientRect(),scale=Number(document.body.style.zoom)||1;dayPopup.style.left=Math.max(12,Math.min(innerWidth-box.width-12,rect.left+(rect.width-box.width)/2))/scale+'px';dayPopup.style.top=Math.max(12,Math.min(innerHeight-box.height-12,rect.top-20))/scale+'px';dayPopup.querySelector('.gc-day-popover-close').focus({preventScroll:true});}
 function agenda(){let previous='',group=-1;return items.length?`<table class="gc-agenda"><tbody>${items.map((item,index)=>{
  const b=D.bounds(item.event),key=D.dayKey(b.start),first=key!==previous,allDay=D.banner(item.event);if(first){group++;previous=key;}
  const continuation=allDay&&!first&&index>0&&D.banner(items[index-1].event);let span=1;if(allDay&&!continuation)while(index+span<items.length&&D.dayKey(D.bounds(items[index+span].event).start)===key&&D.banner(items[index+span].event))span++;
  const clock=continuation?'':`<td class="gc-agenda-time"${span>1?` rowspan="${span}"`:''}>${first?`<strong>${label(b.start)} <small>${b.start.toLocaleDateString('zh-CN',{weekday:'short'})}</small></strong>`:''}<span>${allDay?'全天':time(b.start)+'–'+time(b.end)}</span></td>`;
  return `<tr class="${group%2?'day-alternate':''} ${first?'day-start':''}">${clock}<td>${eventButton(item,index,'',name(item.event))}</td></tr>`;
 }).join('')}</tbody></table>`:'<div class="gc-empty">此期间没有事件</div>';}

 async function load(){const ticket=++epoch,accountTicket=++accountEpoch;try{
  const value=await api(q('status'));if(!visible()||ticket!==epoch)return;status=value;overviewCache=null;
  if(!status.connected){paint();return;}
  const result=await api(q('calendars'));if(!visible()||ticket!==epoch)return;calendars=result.items;
  selected=new Set(calendars.filter(c=>c.primary||c.selected).map(c=>c.id));if(!selected.size&&calendars[0])selected.add(calendars[0].id);
  await loadEvents();
  // Show events first. Optional labels and colors must not delay the calendar.
  const [labels,colors]=await Promise.allSettled([decorateCalendars(calendars),api(q('colors'))]);
  if(accountTicket!==accountEpoch)return;
  if(labels.status==='fulfilled')calendars=labels.value;if(colors.status==='fulfilled')eventColors=colors.value.event||{};
  if(labelDraft&&status[labelDraft.labelWriteGrant?'label_write_permission':'label_permission']){editing=labelDraft;editing.calendar=calendars.find(c=>c.id===editing.calendar.id)||editing.calendar;labelDraft=null;renderEditor();}
  items=items.map(item=>({...item,calendar:calendars.find(c=>c.id===item.calendar.id)||item.calendar}));itemSignature='';if(visible())paint();
 }catch(e){if(visible()&&ticket===epoch){error=e.message;$('#google-calendar').innerHTML=`<div class="gc-empty">${esc(error)}<p><button data-gc="status">重试</button></p></div>`;}}}
 function eventQuery(){const range=D.range(anchor,view);return JSON.stringify([range.start.toISOString(),range.end.toISOString(),[...selected].sort()]);}
 function applyResults(results,query){
  const next=results.flatMap(result=>result.items.map(event=>({calendar:calendars.find(c=>c.id===result.calendarId),event}))).filter(item=>item.calendar).sort((a,b)=>D.bounds(a.event).start-D.bounds(b.event).start);
  const signature=JSON.stringify(next);if(signature!==itemSignature){items=next;items.forEach((item,index)=>item.key=index);itemSignature=signature;}
  loadedQuery=query;offline=results.some(r=>r.offline);synced=results.length?Math.min(...results.map(r=>r.synced_at||0)):0;error=results.filter(r=>r.offline).map(r=>r.error).filter(Boolean).join('；');
 }
 async function loadEvents(force=false,direction=null){
  const ticket=++epoch,range=D.range(anchor,view),query=eventQuery(),ids=calendars.filter(c=>selected.has(c.id)).map(c=>c.id),cached=!force&&eventCache.peek(ids,range.start,range.end);
  error='';if(cached){loading=false;applyResults(cached,query);paint(direction);return;}
  loading=true;if(query!==loadedQuery){
   const sameRange=loadedQuery&&JSON.parse(loadedQuery).slice(0,2).join('|')===JSON.parse(query).slice(0,2).join('|');
   items=sameRange?items.filter(item=>selected.has(item.calendar.id)).map((item,key)=>({...item,key})):[];itemSignature=JSON.stringify(items);paint(direction);direction=null;
  }setRefresh();
  try{
   const results=await eventCache.load(ids,range.start,range.end,(calendar,start,end)=>api(q('events',{calendar,since:start.toISOString(),until:end.toISOString()})),force);
   if(!visible()||ticket!==epoch)return;applyResults(results,query);
  }catch(e){if(!visible()||ticket!==epoch)return;error=e.message;offline=true;}
  finally{if(visible()&&ticket===epoch){loading=false;paint(direction);}}
 }
 function overviewRow(item,index,now,date,showAllDay=false){const b=D.bounds(item.event),appearance=eventAppearance(item),allDay=D.banner(item.event),declined=item.event.attendees?.some(a=>a.self&&a.responseStatus==='declined');return `<button class="gc-today-row ${b.end<now?'past':''}${allDay?'':' timed'}${declined?' declined':''}" data-gc="overview-event" data-key="${index}" data-date="${D.dayKey(date)}" style="--event-color:${appearance.color}" title="${esc([name(item.event),appearance.label].filter(Boolean).join(' · '))}"><span class="gc-today-time ${D.banner(item.event)?'':'timed'}">${D.banner(item.event)?(showAllDay?'全天':''):`<time>${time(b.start)}</time><i aria-hidden="true"></i><time>${time(b.end)}</time>`}</span><span class="gc-today-main"><b>${esc(name(item.event))}</b>${item.event.location?`<small>${esc(item.event.location)}</small>`:''}</span></button>`;}
 function overviewRows(rows,now,date){let shown=false;return rows.map(({item,index})=>{const first=D.banner(item.event)&&!shown;if(first)shown=true;return overviewRow(item,index,now,date,first);}).join('');}
 function assignOverview(root,html){if(root&&root._gcTodayHTML!==html){root.innerHTML=html;root._gcTodayHTML=html;}}
 function paintToday(){
  const root=document.querySelector('#gc-today');if(!root||page!=='overview')return;const value=overviewCache,future=document.querySelector('#gc-future'),now=new Date();
  const assign=html=>assignOverview(root,html);
  if(!value?.ready){assign('<div class="gc-today-header"><h2>今日</h2></div><div class="gc-empty">正在读取…</div>');assignOverview(future,'');return;}
  const header='<div class="gc-today-header"><h2>今日</h2><button class="icon-button" data-gc="overview-calendar">查看日历</button></div>';
  if(!value.connected){assign(header+'<div class="gc-empty"><button data-gc="overview-calendar">连接 Google 日历</button></div>');assignOverview(future,'');return;}
  if(value.error&&!value.items.length){assign(header+`<div class="gc-empty">${esc(value.error)} <button data-gc="overview-retry">重试</button></div>`);assignOverview(future,'');return;}
  const today=D.dateOnly(D.dayKey(now)),rows=value.items.map((item,index)=>({item,index}));
  const todays=rows.filter(row=>D.onDay(row.item.event,today));assign(header+(todays.length?`<div class="gc-today-list">${overviewRows(todays,now,today)}</div>`:'<div class="gc-today-list"><p class="gc-empty">今天没有日程</p></div>'));
  if(!future)return;
  const dates=Array.from({length:3},(_,i)=>D.addDays(today,i+1)),tomorrow=dates[0],end=D.addDays(today,4);
  const days=dates.map(date=>{const entries=rows.filter(row=>{const b=D.bounds(row.item.event);return b.start<end&&b.end>tomorrow&&D.dayKey(b.start<tomorrow?tomorrow:b.start)===D.dayKey(date);});return entries.length?`<div class="gc-future-day"><h3><span>${esc(label(date))}</span><small>${date.toLocaleDateString('zh-CN',{weekday:'short'})}</small></h3><div>${overviewRows(entries,now,date)}</div></div>`:'';}).join('');
  assignOverview(future,`<div class="gc-today-header"><h2>未来三天</h2></div><div class="gc-today-list gc-future-list">${days||'<p class="gc-empty">未来三天没有日程</p>'}</div>`);
 }
 function mountOverview(force=false){
  if(!document.querySelector('#gc-today')||page!=='overview')return;
  const showFuture=state.settings?.calendar_overview_future!==false,key=D.dayKey(new Date())+':'+showFuture+':'+[...selected].sort().join('|');
  if(!force&&overviewCache?.key===key&&(overviewCache.promise||Date.now()-overviewCache.at<60000)){paintToday();return;}
  const entry={key,at:Date.now(),items:[],ready:false,connected:false};overviewCache=entry;paintToday();
  entry.promise=(async()=>{try{
   const account=await api(q('status'));entry.connected=account.connected;if(!account.connected)return;
   let values=calendars.length?calendars:await decorateCalendars((await api(q('calendars'))).items);
   const colors=await api(q('colors')).catch(()=>({}));eventColors=colors.event||eventColors;
   const chosen=values.filter(c=>selected.size?selected.has(c.id):c.primary||c.selected);if(!chosen.length&&values[0]&&!selected.size)chosen.push(values[0]);
   const range=D.range(new Date(),'day');if(showFuture)range.end=D.addDays(range.start,4);const results=await Promise.allSettled(chosen.map(async calendar=>{const events=await api(q('events',{calendar:calendar.id,since:range.start.toISOString(),until:range.end.toISOString()}));return events.items.map(event=>({calendar,event}));}));
   entry.items=results.filter(r=>r.status==='fulfilled').flatMap(r=>r.value).sort((a,b)=>Number(D.banner(b.event))-Number(D.banner(a.event))||D.bounds(a.event).start-D.bounds(b.event).start);
   const failure=results.find(r=>r.status==='rejected');if(failure)entry.error=failure.reason.message;
  }catch(error){entry.error=error.message;}finally{entry.ready=true;entry.promise=null;entry.at=Date.now();if(overviewCache===entry)paintToday();}})();
 }
 function closeEventDetails(focus=true){detailEpoch++;if(!detailPopup){detail=null;return false;}detailPopup.remove();detailPopup=null;const origin=detail?.focusOrigin||detail?.origin;detail=null;if(focus&&origin?.isConnected)origin.focus({preventScroll:true});return true;}
 function positionDetails(){if(!detailPopup||!detail)return;const rect=detail.origin?.isConnected?detail.origin.getBoundingClientRect():detail.rect,box=detailPopup.getBoundingClientRect(),scale=Number(document.body.style.zoom)||1;let left=rect.right+12;if(left+box.width>innerWidth-12)left=rect.left-box.width-12;if(left<12)left=(innerWidth-box.width)/2;detailPopup.style.left=Math.max(12,Math.min(innerWidth-box.width-12,left))/scale+'px';detailPopup.style.top=Math.max(12,Math.min(innerHeight-box.height-12,rect.top-12))/scale+'px';}
 function drawDetails(){if(!detailPopup||!detail)return;const item=detail.item,e=item.event,b=D.bounds(e),appearance=eventAppearance(item),self=e.attendees?.find(a=>a.self),declined=self?.responseStatus==='declined',canReply=!!self&&!status?.read_only&&!offline&&['owner','writer','writerWithoutPrivateAccess'].includes(item.calendar.accessRole)&&e.status!=='cancelled';
  const date=D.banner(e)?label(b.start)+(D.dayKey(D.addDays(b.end,-1))!==D.dayKey(b.start)?' — '+label(D.addDays(b.end,-1)):'')+' · 全天':label(b.start)+' '+time(b.start)+' — '+(D.dayKey(b.end)!==D.dayKey(b.start)?label(b.end)+' ':'')+time(b.end);
  const description=D.descriptionText(e.description),attendees=e.attendees||[],organizer=e.organizer?.displayName||e.organizer?.email||'';
  const line=(path,body)=>`<div class="gc-detail-row">${icon(path)}<div>${body}</div></div>`;
  detailPopup.innerHTML=`<div class="gc-detail-actions"><button data-gc="edit-event" class="gc-round-button" aria-label="修改事件" title="${D.editable(item)&&!status?.read_only&&!offline?'修改':'此日历只读'}" ${!D.editable(item)||status?.read_only||offline?'disabled':''}>${editIcon}</button>${e.htmlLink?`<button data-gc="detail-original" class="gc-round-button" aria-label="在 Google 日历中打开" title="在 Google 日历中打开">${externalIcon}</button>`:''}<button data-gc="detail-close" class="gc-round-button" aria-label="关闭事件详情" title="关闭">${icon('<path d="m6 6 12 12M18 6 6 18"/>')}</button></div><div class="gc-detail-title ${declined?'declined':''}" style="--event-color:${appearance.color}"><span></span><h2>${esc(name(e))}</h2><p>${esc(date)}</p></div><div class="gc-detail-content">${e.location?line('<path d="M12 21s7-6.5 7-12A7 7 0 0 0 5 9c0 5.5 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/>',D.detailHTML(e.location)):''}${attendees.length?line('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.9"/><circle cx="9" cy="7" r="4"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',`<b>${attendees.length} 位邀请对象</b><div class="gc-detail-guests">${attendees.slice(0,6).map(a=>`<span>${esc(a.displayName||a.email||(a.self?'你':'参与者'))}${a.organizer?' <small>组织者</small>':''}<i class="response-${esc(a.responseStatus||'needsAction')}" aria-label="${({accepted:'已接受',declined:'已拒绝',tentative:'待定'})[a.responseStatus]||'未回复'}"></i></span>`).join('')}${attendees.length>6?`<small>另外 ${attendees.length-6} 位</small>`:''}</div>`):''}${description?line('<path d="M4 6h16M4 10h16M4 14h10M4 18h7"/>',`<p class="gc-detail-description">${D.detailHTML(e.description)}</p>`):''}${organizer?line('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18"/>',esc(organizer)):''}${e.hangoutLink?`<button data-gc="detail-meeting" class="gc-meeting-button">${icon('<rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10 6-3v10l-6-3"/>')}加入会议</button>`:''}</div>${self?`<div class="gc-rsvp"><span>参加？</span><div role="group" aria-label="参加状态">${[['accepted','是'],['declined','否'],['tentative','待定']].map(([value,text])=>`<button data-gc="respond" data-response="${value}" aria-pressed="${self.responseStatus===value}" ${!canReply||detailLoading?'disabled':''}>${text}</button>`).join('')}</div></div>`:''}`;
  positionDetails();
 }
 async function showEventDetails(item,origin,savedRect=null){closeEventDetails(false);if(typeof document.createElement!=='function')return;const rect=savedRect||(origin?.isConnected?origin.getBoundingClientRect():{left:innerWidth/2,right:innerWidth/2,top:100}),focusOrigin=dayPopup?.contains(origin)?dayPopupOrigin:origin;closeDayPopup(false);detail={item,origin,rect,focusOrigin};detailPopup=document.createElement('section');detailPopup.className='gc-event-popover';detailPopup.setAttribute('role','dialog');detailPopup.setAttribute('aria-label','事件详情');document.body.appendChild(detailPopup);drawDetails();detailPopup.querySelector('[data-gc=detail-close]')?.focus({preventScroll:true});const ticket=++detailEpoch;
  try{const event=await api(q('event',{calendar:item.calendar.id,event:item.event.id}));if(ticket!==detailEpoch||!detailPopup)return;detail.item={...item,event};drawDetails();}catch(error){if(ticket===detailEpoch&&detailPopup){const note=document.createElement('p');note.className='gc-detail-error';note.setAttribute('role','alert');note.textContent=error.message;detailPopup.appendChild(note);}}
 }
 async function respond(response){if(!detail||detailLoading||status?.read_only||offline)return;const item=detail.item,ticket=++detailEpoch;detailLoading=true;drawDetails();try{
  const result=await api(q('respond'),{calendar:item.calendar.id,event:item.event.id,etag:item.event.etag,response});eventCache.clear();overviewCache=null;
  const updated={...item.event,...result,attendees:result.attendees||item.event.attendees.map(a=>a.self?{...a,responseStatus:response}:a)};
  items=items.map(row=>row.calendar.id===item.calendar.id&&row.event.id===item.event.id?{...row,event:updated}:row);itemSignature='';if(ticket===detailEpoch&&detail)detail.item={...item,event:updated};paint();
 }finally{detailLoading=false;if(detailPopup)drawDetails();}}
 function analysisPanel(){const r=view==='month'?{start:new Date(anchor.getFullYear(),anchor.getMonth(),1),end:new Date(anchor.getFullYear(),anchor.getMonth()+1,1)}:D.range(anchor,view),data=D.analytics(items,r.start,r.end,calendars.filter(c=>selected.has(c.id))),length=2*Math.PI*58;let offset=0;
  const arcs=data.rows.filter(row=>row.seconds>0).map(row=>{const size=row.seconds/data.total*length,svg=`<circle cx="78" cy="78" r="58" fill="none" stroke="${row.color}" stroke-width="18" data-gc-analysis="${esc(row.key)}" stroke-dasharray="${size} ${length}" stroke-dashoffset="${-offset}" transform="rotate(-90 78 78)"/>`;offset+=size;return svg;}).join('');
  const hours=value=>hoursFormat.format(value/3600),help='优先使用日历标签，无可用标签时按标题分类。全天及已拒绝的事件不计入小时，重叠事件分别计时。';
  return `<section class="gc-insights" aria-label="时间分析"><header><div><span>${esc(label(r.start)+' — '+label(D.addDays(r.end,-1)))}</span><h3>时间分析</h3></div><button class="gc-round-button" data-gc="analysis-close" aria-label="关闭时间分析">${icon('<path d="m6 6 12 12M18 6 6 18"/>')}</button></header><div class="gc-insights-label">按标签<span class="gc-info" tabindex="0" aria-label="${help}">?<span role="tooltip">${help}</span></span></div><svg class="gc-donut" viewBox="0 0 156 156" role="img" aria-label="标签时长，总计 ${hours(data.total)} 小时"><circle cx="78" cy="78" r="58" fill="none" stroke="var(--line)" stroke-width="18"/>${arcs}<text x="78" y="77" text-anchor="middle" class="gc-donut-total">${hours(data.total)}</text><text x="78" y="97" text-anchor="middle" class="gc-donut-unit">小时</text></svg><div class="gc-insight-rows">${data.rows.map(row=>`<div class="gc-insight-row" data-gc-analysis="${esc(row.key)}" tabindex="0"><i style="background:${row.color}"></i><span>${esc(row.name)}</span><strong>${hours(row.seconds)} 小时</strong></div>`).join('')}</div></section>`;
 }
 function configure(){openModal('Google 日历客户端',`<div class="gc-config-note"><p>在 Google Cloud 中启用 Calendar API，创建“桌面应用”OAuth 客户端，然后导入下载的 JSON 配置。</p>${status?.connected?'<p>更换客户端会移除本机连接。</p>':''}</div>${status?.configured?field('客户端 ID',`<input readonly value="${esc(status.client_id)}">`):''}<label class="field full"><span>客户端配置</span><input id="gc-client-file" type="file" accept="application/json,.json"></label><div class="gc-config-note"><button data-gc="help">查看设置说明</button></div>`,`${btn('close','取消')}<button data-gc="import" class="primary">导入</button>`,'form');}
 function account(){if(status?.read_only||status?.preview_copy){openModal('Google 日历',`<p class="gc-config-note">${status.preview_copy?'独立日历副本':'只读日历快照'}</p>`,btn('close','关闭'),'compact');return;}openModal('Google 日历',`<div class="gc-config-note"><p>${esc(calendars.find(c=>c.primary)?.id||'Google 账号已连接')}</p></div><div class="toolbar"><button data-gc="configure">客户端配置…</button>${!status?.label_permission?'<button data-gc="connect">同步标签授权…</button>':''}<button data-gc="disconnect" class="danger">断开连接…</button></div>`,btn('close','完成'),'compact');}
 function baseEvent(date){const start=new Date(date||new Date());if(!date)start.setMinutes(Math.ceil(start.getMinutes()/15)*15,0,0);const end=new Date(+start+3600000);return {summary:'',start:{dateTime:start.toISOString(),timeZone:zone},end:{dateTime:end.toISOString(),timeZone:zone},reminders:{useDefault:true}};}
 async function editor(item=null,date=null){const ticket=++editEpoch;let event=item?.event||baseEvent(date);if(item){const value=await api(q('event',{calendar:item.calendar.id,event:event.id}));event=value;}if(ticket!==editEpoch||!visible())return;
  editing={calendar:item?.calendar||calendars.find(c=>selected.has(c.id)&&['owner','writer','writerWithoutPrivateAccess'].includes(c.accessRole))||calendars.find(c=>['owner','writer','writerWithoutPrivateAccess'].includes(c.accessRole)),event,existing:!!item,series:false,original:event};renderEditor();}
 function labelField(calendar,event,readOnly,full=true){
  const current=event.eventLabelId||'',labels=(calendar.labels||[]).filter(label=>label.id&&(String(label.name||'').trim()||label.id===current)),known=labels.some(label=>label.id===current),ready=calendar.labels_ready!==false;
  const selected=labels.find(label=>label.id===current),tint=selected?.backgroundColor||color(calendar),canCreate=calendar.accessRole==='owner'&&!readOnly;
  return field('标签',`<div class="gc-label-control"><span class="gc-label-swatch" style="background:${/^#[a-f\d]{6}$/i.test(tint)?tint:'#007aff'}" aria-hidden="true"></span><select id="gc-label" aria-label="事件标签" ${readOnly||!ready?'disabled':''}><option value="">默认</option>${current&&!known?`<option value="${esc(current)}" selected>当前标签</option>`:''}${labels.map(label=>`<option value="${esc(label.id)}" ${label.id===current?'selected':''}>${esc(label.name||'未命名标签')}</option>`).join('')}</select>${canCreate?`<button type="button" data-gc="label-new" class="gc-label-add" aria-label="添加标签" title="添加标签" aria-expanded="false" aria-controls="gc-new-label" aria-haspopup="dialog">${icon('<path d="M12 5v14M5 12h14"/>')}</button>`:''}${!ready&&!readOnly?'<button type="button" data-gc="authorize-labels">同步标签</button>':''}</div>${canCreate?`<div id="gc-new-label" role="dialog" aria-label="新增标签" hidden>${status?.label_write_permission?'<div class="gc-label-create"><input id="gc-label-name" aria-label="标签名称" placeholder="标签名称" maxlength="50"><input id="gc-label-color" aria-label="标签颜色" type="color" value="#007aff"><button type="button" data-gc="label-create" class="primary">添加</button></div>':'<button type="button" data-gc="authorize-labels" data-write="true">授权管理标签…</button>'}</div>`:''}`,full,true);
 }
 function labelPopover(open,restoreFocus=false){
  const form=$('#gc-new-label',modal),button=$('[data-gc="label-new"]',modal);if(!form)return;
  form.hidden=!open;if(button){button.setAttribute('aria-expanded',String(open));button.setAttribute('aria-label',open?'收起新增标签':'添加标签');button.title=open?'收起':'添加标签';}
  if(open)$('#gc-label-name',form)?.focus();else if(restoreFocus)button?.focus();
 }
 async function authorizeLabels(write){
  if(editing&&modal.open){const value=draft();labelDraft={...editing,draftValue:value.value,labelWriteGrant:write};}
  const result=await api(q('connect'),{manage_labels:write});if(modal.open)closeModal();external(result.url);status.pending=true;status.error='';paint();
 }
 function renderEditor(){window.HotTurkeyGooglePicker.close(false);const {calendar,existing}=editing,event={...editing.event,...editing.draftValue};const readOnly=existing&&(!D.editable({event,calendar})||offline),allDay=!!event.start.date,tz=event.start.timeZone||zone;
  const repeat=(event.recurrence||[]).join('\n'),repeatKey=repeat==='RRULE:FREQ=DAILY'?'DAILY':repeat==='RRULE:FREQ=WEEKLY'?'WEEKLY':repeat==='RRULE:FREQ=MONTHLY'?'MONTHLY':repeat==='RRULE:FREQ=YEARLY'?'YEARLY':repeat?'custom':'none';
  const reminder=event.reminders?.useDefault?'default':event.reminders?.overrides?.length===1&&event.reminders.overrides[0].method==='popup'?String(event.reminders.overrides[0].minutes):event.reminders?.overrides?.length?'custom':'none';
  let start=D.input(event.start,tz),end=D.input(event.end,tz);if(allDay)end=D.dayKey(D.addDays(D.dateOnly(end),-1));
  const timeFields=`<section class="gc-editor-time full" aria-label="事件时间"><div class="gc-editor-time-head"><span>时间</span><label class="gc-all-day-control"><span>全天</span><input id="gc-all-day" type="checkbox" role="switch" ${allDay?'checked':''} ${readOnly?'disabled':''}></label></div><div class="gc-editor-dates">${field('开始',window.HotTurkeyGooglePicker.field('gc-start',start,allDay,readOnly),false,true)}${field('结束',window.HotTurkeyGooglePicker.field('gc-end',end,allDay,readOnly),false,true)}</div><div class="gc-editor-zone" ${allDay?'hidden':''}>${field('时区',window.HotTurkeyGooglePicker.zone('gc-zone',tz,readOnly),false,true)}</div></section>`;
  const body=`<div class="gc-editor"><div class="form-grid gc-editor-grid">
   ${field('标题',`<input id="gc-title" value="${esc(event.summary||'')}" maxlength="1000" autofocus ${readOnly?'readonly':''}>`,true)}
   ${field('日历',`<select id="gc-target" ${existing?'disabled':''}>${calendars.filter(c=>c.id===calendar.id||['owner','writer','writerWithoutPrivateAccess'].includes(c.accessRole)).map(c=>`<option value="${esc(c.id)}" ${c.id===calendar.id?'selected':''}>${esc(c.summary||c.id)}</option>`).join('')}</select>`)}
   ${labelField(calendar,event,readOnly,false)}
   ${editing.series?'<p class="gc-event-meta full">正在编辑整组重复事件</p>':''}
   ${timeFields}
   ${event.recurringEventId?field('修改范围',`<select id="gc-scope" ${readOnly?'disabled':''}><option value="single">仅本次事件</option><option value="series" ${editing.series?'selected':''}>整组重复事件</option></select>`):field('重复',`<select id="gc-repeat" ${readOnly?'disabled':''}>${options({none:'不重复',DAILY:'每天',WEEKLY:'每周',MONTHLY:'每月',YEARLY:'每年',...(repeatKey==='custom'?{custom:'自定义重复规则'}:{})},repeatKey)}</select>`)}
   ${field('提醒',`<select id="gc-reminder" ${readOnly?'disabled':''}>${options({default:'日历默认',none:'无',5:'提前 5 分钟',10:'提前 10 分钟',15:'提前 15 分钟',30:'提前 30 分钟',60:'提前 1 小时',1440:'提前 1 天',...(!['default','none','5','10','15','30','60','1440'].includes(reminder)?{[reminder]:'保留原提醒'}:{})},reminder)}</select>`)}
   ${field('地点',`<input id="gc-location" value="${esc(event.location||'')}" maxlength="2000" ${readOnly?'readonly':''}>`)}
   ${field('参与者',`<input id="gc-attendees" value="${esc((event.attendees||[]).map(a=>a.email).filter(Boolean).join(', '))}" placeholder="邮箱，用逗号分隔" ${readOnly?'readonly':''}>`)}
   ${field('说明',`<textarea id="gc-description" maxlength="20000" ${readOnly?'readonly':''}>${esc(event.description||'')}</textarea>`,true)}
  </div>${event.attendees?.length&&!readOnly?'<p class="gc-event-meta">保存更改会通知参与者。</p>':''}${event.hangoutLink?'<div class="toolbar"><button data-gc="open-meeting">加入会议</button></div>':''}</div>`;
  openModal(existing?'事件详情':'新建事件',body,`${existing&&!readOnly?'<button data-gc="delete-confirm" class="danger">删除…</button><span class="grow"></span>':''}${btn('close',readOnly?'关闭':'取消')}${!readOnly?'<button data-gc="save" class="primary">保存</button>':''}`,'calendar-event',event.htmlLink?`<button data-gc="open-original" class="gc-editor-original">在 Google 日历中打开${externalIcon}</button>`:'');
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
  const label=$('#gc-label',root);if(label&&!label.disabled&&label.value!==(editing.event.eventLabelId||''))value.eventLabelId=label.value;
  const repeat=get('gc-repeat');if(repeat&&repeat!=='custom')value.recurrence=repeat==='none'?[]:['RRULE:FREQ='+repeat];
  const reminder=get('gc-reminder');if(reminder!=='custom'){if(reminder==='default')value.reminders={useDefault:true};else value.reminders={useDefault:false,overrides:reminder==='none'?[]:[{method:'popup',minutes:Number(reminder)}]};}
  return {calendar:get('gc-target'),event:editing.existing?editing.event.id:null,etag:editing.event.etag,value};
 }
 async function handle(action,element){
  if(action==='label-new'){const form=$('#gc-new-label',modal);if(form)labelPopover(form.hidden);return;}
  if(action==='authorize-labels')return authorizeLabels(element.dataset.write==='true');
  if(action==='label-create'){
   const calendar=calendars.find(c=>c.id===$('#gc-target',modal).value)||editing.calendar;
   const result=await api(q('labels/create'),{calendar:calendar.id,name:$('#gc-label-name',modal).value,color:$('#gc-label-color',modal).value});
   calendar.labels=result.items;calendar.labels_ready=true;editing.calendar=calendar;appearances=new WeakMap();overviewCache=null;
   const select=$('#gc-label',modal),option=document.createElement('option');option.value=result.label.id;option.textContent=result.label.name;select.appendChild(option);select.value=result.label.id;select.disabled=false;
   $('.gc-label-swatch',modal).style.background=result.label.backgroundColor;labelPopover(false,true);return;
  }
  if(action==='overview-retry'){mountOverview(true);return;}
  if(action==='overview-calendar'||action==='overview-event'){const item=action==='overview-event'?overviewCache?.items[Number(element.dataset.key)]:null,rect=item&&element.isConnected?element.getBoundingClientRect():null;if(item&&element.dataset.date)anchor=D.dateOnly(element.dataset.date);source='google';page='schedule';renderPage();if(item)await showEventDetails(item,element,rect);return;}
  if(action==='help'){openModal('设置 Google 日历',`<ol class="gc-config-note"><li>在 Google Cloud 中启用 Google Calendar API。</li><li>配置 OAuth 受众；个人测试时将自己的账号加入测试用户。</li><li>创建“桌面应用”客户端，下载 JSON 并在这里导入。</li></ol>`,`${btn('close','关闭')}<button data-gc="open-cloud">打开 Google Cloud</button><button data-gc="configure" class="primary">导入配置…</button>`,'form');return;}
  if(action==='open-cloud')return external('https://console.cloud.google.com/apis/credentials');
  if(action==='configure')return configure();
  if(action==='import'){const file=$('#gc-client-file',modal).files[0];if(!file)throw Error('请选择桌面应用客户端配置');if(file.size>65536)throw Error('配置文件过大');let configuration;try{configuration=JSON.parse(await file.text());}catch{throw Error('无法读取 JSON 配置');}eventCache.clear();status=await api(q('configure'),{configuration});closeModal();items=[];calendars=[];render(true);toast('配置已导入','saved');return;}
  if(action==='connect'){if(modal.open)closeModal();const value=await api(q('connect'),{});external(value.url);status.pending=true;status.error='';paint();return;}
  if(action==='cancel-connect'){await api(q('cancel'),{});await load();return;}
  if(action==='status'){await load();return;}
  if(action==='account')return account();
  if(action==='disconnect'){openModal('断开 Google 日历',`<p class="sheet-intro">从此 Mac 移除连接和日历缓存。Google 日历中的事件会保留。</p>`,`${btn('close','取消')}<button data-gc="disconnect-confirm" class="danger">断开连接</button>`,'compact');return;}
  if(action==='disconnect-confirm'){await api(q('disconnect'),{});closeModal();hide();render();return;}
  if(action==='previous'||action==='next'){closeEventDetails(false);const direction=action==='next'?1:-1;anchor=D.move(anchor,view,direction);return loadEvents(false,direction);}
  if(action==='today'){closeEventDetails(false);anchor=new Date();return loadEvents(false,0);}
  if(action==='view'){if(view===element.dataset.view)return;closeEventDetails(false);view=element.dataset.view;if(!loading&&loadedQuery===eventQuery()){paint(0);return;}return loadEvents(false,0);}
  if(action==='day-more'){showDayPopup(element);return;}
  if(action==='day-popup-close'){closeDayPopup();return;}
  if(action==='day'){anchor=D.dateOnly(element.dataset.date);view='day';return loadEvents();}
  if(action==='refresh'){spinRefresh(element);if(status?.pending)return load();return loadEvents(true);}
  if(action==='new')return editor();
  if(action==='event'){if(skipClick)return;if(items[Number(element.dataset.key)])return showEventDetails(items[Number(element.dataset.key)],element);return;}
  if(action==='detail-link'){if(window.HotTurkeyNativeShell){const url=D.detailURL(element.dataset.url);if(url)window.webkit.messageHandlers.native.postMessage({op:'google-calendar-detail-link',url});}return;}
  if(action==='detail-close'){closeEventDetails();return;}
  if(action==='edit-event'){if(!detail||status?.read_only||!D.editable(detail.item))return;const item=detail.item;closeEventDetails(false);return editor(item);}
  if(action==='detail-original')return external(detail.item.event.htmlLink);
  if(action==='detail-meeting')return external(detail.item.event.hangoutLink);
  if(action==='respond')return respond(element.dataset.response);
  if(action==='analysis'||action==='analysis-close'){analysisOpen=action==='analysis'?!analysisOpen:false;paint();return;}
  if(action==='save'){const value=draft();await api(q('save'),value);closeModal();editing=null;eventCache.clear();overviewCache=null;await loadEvents(true);return;}
  if(action==='delete-confirm'){openModal('删除事件',`<p class="sheet-intro">${esc(name(editing.event))}</p><p class="gc-config-note">${editing.series||editing.event.recurrence?'整组重复事件将从 Google 日历删除。':'此事件将从 Google 日历删除。'}</p>`,`${btn('close','取消')}<button data-gc="delete" class="danger">${editing.series||editing.event.recurrence?'删除整组事件':'删除事件'}</button>`,'compact');return;}
  if(action==='delete'){await api(q('delete'),{calendar:editing.calendar.id,event:editing.event.id,etag:editing.event.etag});closeModal();editing=null;eventCache.clear();overviewCache=null;return loadEvents(true);}
  if(action==='open-original')return external(editing.event.htmlLink);
  if(action==='open-meeting')return external(editing.event.hangoutLink);
 }
 let highlightedCategory=null;
 function highlightCategory(key,force=false){
  if(key===highlightedCategory&&!force)return;highlightedCategory=key;
  const root=document.querySelector('#google-calendar');if(!root)return;
  root.querySelector?.('.gc-scroller')?.classList.toggle('gc-analysis-highlight',key!==null);
  dayPopup?.classList.toggle('gc-analysis-highlight',key!==null);
  root.querySelectorAll?.('.gc-event').forEach(event=>event.classList.toggle('gc-analysis-match',key!==null&&event.dataset.gcCategory===key));
  root.querySelectorAll?.('.gc-month-more').forEach(button=>button.classList.toggle('gc-analysis-match',key!==null&&JSON.parse(button.dataset.gcCategories||'[]').includes(key)));
  root.querySelectorAll?.('[data-gc-analysis]').forEach(row=>row.classList.toggle('gc-analysis-active',key!==null&&row.dataset.gcAnalysis===key));
 }
 for(const [enter,leave] of [['pointerover','pointerout'],['focusin','focusout']]){
  document.addEventListener(enter,event=>{const row=event.target.closest('[data-gc-analysis]');if(row&&!row.contains(event.relatedTarget))highlightCategory(row.dataset.gcAnalysis);});
  document.addEventListener(leave,event=>{const row=event.target.closest('[data-gc-analysis]');if(row&&!row.contains(event.relatedTarget))highlightCategory(null);});
 }
 document.addEventListener('click',async event=>{
  if(detailPopup&&!detailPopup.contains(event.target)&&!event.target.closest('[data-gc=event]'))closeEventDetails(false);
  if(dayPopup&&!dayPopup.contains(event.target)&&!event.target.closest('[data-gc=day-more]'))closeDayPopup(false);
  const sourceButton=event.target.closest('[data-gc-source]');if(sourceButton){if(source===sourceButton.dataset.gcSource)return;source=sourceButton.dataset.gcSource;try{localStorage.setItem('hot-calendar-source',source);}catch{}epoch++;editEpoch++;renderCalendar();return;}
  const element=event.target.closest('[data-gc]');if(!element)return;const action=element.dataset.gc;if(action==='detail-link'&&window.HotTurkeyNativeShell)event.preventDefault();const mutation=['save','delete','import','disconnect-confirm','connect','respond','label-create','authorize-labels'].includes(action);if(element.disabled)return;
  if(mutation)element.disabled=true;try{await handle(action,element);}catch(error){if(modal.open)showModalError(error.message);else toast(error.message);}finally{if(mutation&&element.isConnected)element.disabled=false;}
 });
 document.addEventListener('change',async event=>{const el=event.target;try{
  if(el.dataset.gcCalendar){overviewCache=null;el.checked?selected.add(el.dataset.gcCalendar):selected.delete(el.dataset.gcCalendar);await loadEvents();}
  if(el.id==='gc-label'){const calendar=calendars.find(c=>c.id===$('#gc-target',modal).value)||editing?.calendar,label=calendar?.labels?.find(label=>label.id===el.value);const swatch=$('.gc-label-swatch',modal);if(swatch)swatch.style.background=label?.backgroundColor||color(calendar);}
  if(el.id==='gc-target'&&editing&&!editing.existing){const calendar=calendars.find(c=>c.id===el.value);if(calendar){editing.calendar=calendar;const field=$('#gc-label',modal)?.closest('.field');if(field)field.outerHTML=labelField(calendar,{},false,false);}}
  if(el.id==='gc-all-day'){const allDay=el.checked;for(const id of ['gc-start','gc-end'])window.HotTurkeyGooglePicker.setAllDay(id,allDay);$('.gc-editor-zone',modal).hidden=allDay;}
  if(el.id==='gc-scope'&&el.value==='series'){const series=await api(q('event',{calendar:editing.calendar.id,event:editing.event.recurringEventId}));editing.event=series;editing.series=true;renderEditor();}
 }catch(error){if(modal.open)showModalError(error.message);else toast(error.message);}});
 document.addEventListener('dblclick',event=>{const day=event.target.closest('.gc-day,.gc-month-day');if(!day||event.target.closest('.gc-event,button')||offline||!calendars.some(c=>['owner','writer','writerWithoutPrivateAccess'].includes(c.accessRole)))return;const date=D.dateOnly(day.dataset.date);if(day.classList.contains('gc-day')){const box=day.getBoundingClientRect(),minute=Math.min(1425,Math.max(0,Math.floor((event.clientY-box.top)/box.height*1440/15)*15));date.setMinutes(minute);}else date.setHours(9);editor(null,date).catch(e=>toast(e.message));});
 function restoreDrag(d){if(!d)return;d.el.setAttribute('style',d.style||'');d.el.classList.remove('dragging');for(const col of d.columns)col.day.classList.remove('gc-drop-target');}
 document.addEventListener('pointerdown',event=>{
  const labelPopup=$('#gc-new-label',modal);if(modal.open&&labelPopup?.hidden===false&&!labelPopup.contains(event.target)&&!event.target.closest('[data-gc=label-new]'))labelPopover(false);
  if(event.button!==0||!visible()||offline||loading||modal.open||detailPopup||dayPopup)return;
  const el=event.target.closest('.gc-day>.gc-event,.gc-month .gc-event,.gc-all-strip>.gc-event');if(!el)return;
  const item=items[Number(el.dataset.key)],month=!!el.closest('.gc-month'),banner=!!el.closest('.gc-all-strip');if(!item||!D.editable(item)||!month&&!banner&&item.event.start.date)return;
  const columns=[...document.querySelectorAll(month?'.gc-month-day':'.gc-day')].map(day=>({day,box:day.getBoundingClientRect()}));
  const origin=month||banner?columns.find(col=>event.clientX>=col.box.left&&event.clientX<col.box.right&&(banner||event.clientY>=col.box.top&&event.clientY<col.box.bottom))?.day:el.closest('.gc-day');if(!origin)return;
  dragging={el,item,month,banner,style:el.getAttribute('style'),x:event.clientX,y:event.clientY,resize:!month&&!!event.target.closest('.gc-resize'),date:origin.dataset.date,start:D.bounds(item.event).start,end:D.bounds(item.event).end,columns};el.setPointerCapture(event.pointerId);
 });
 document.addEventListener('pointermove',event=>{
  const d=dragging;if(!d||Math.hypot(event.clientX-d.x,event.clientY-d.y)<5&&!d.changed)return;d.changed=true;d.el.classList.add('dragging');
  if(d.month||d.banner){
   const target=d.columns.find(col=>event.clientX>=col.box.left&&event.clientX<col.box.right&&(d.banner||event.clientY>=col.box.top&&event.clientY<col.box.bottom));d.target=target?.day.dataset.date;
   for(const col of d.columns)col.day.classList.toggle('gc-drop-target',col===target);
   d.el.style.transform=`translate(${event.clientX-d.x}px,${event.clientY-d.y}px)`;return;
  }
  const day=d.columns.find(col=>event.clientX>=col.box.left&&event.clientX<col.box.right)?.day||d.el.closest('.gc-day'),box=day.getBoundingClientRect(),delta=Math.round((event.clientY-d.y)/box.height*1440/15)*15;
  const target=D.dateOnly(day.dataset.date),origin=D.dateOnly(d.date),dayDelta=Math.round((Date.UTC(target.getFullYear(),target.getMonth(),target.getDate())-Date.UTC(origin.getFullYear(),origin.getMonth(),origin.getDate()))/86400000);
  if(d.resize){d.newStart=new Date(d.start);d.newEnd=new Date(Math.max(+d.start+15*60000,+d.end+delta*60000));}else{d.newStart=D.addDays(d.start,dayDelta);d.newStart.setMinutes(d.newStart.getMinutes()+delta);d.newEnd=new Date(+d.newStart+(d.end-d.start));}
  const start=d.newStart.getHours()*60+d.newStart.getMinutes(),length=(d.newEnd-d.newStart)/60000;d.el.style.transform=`translate(${d.resize?0:(box.left-d.el.parentElement.getBoundingClientRect().left)}px,${(d.newStart-d.start-dayDelta*86400000)/60000/1440*box.height}px)`;d.el.style.height=`${Math.min(1440-start,length)/1440*100}%`;
 });
 document.addEventListener('pointerup',async()=>{
  const d=dragging;dragging=null;restoreDrag(d);if(!d?.changed)return;skipClick=true;setTimeout(()=>skipClick=false,180);
  if((d.month||d.banner)&&(!d.target||d.target===d.date))return;
  loading=true;try{
   const value=d.month||d.banner?D.shiftEvent(d.item.event,d.date,d.target,zone):{start:{dateTime:d.newStart.toISOString(),timeZone:d.item.event.start.timeZone||zone},end:{dateTime:d.newEnd.toISOString(),timeZone:d.item.event.end.timeZone||zone}};
   // Always use this rendered instance ID. Do not copy recurrence or labels.
   const saved=await api(q('save'),{calendar:d.item.calendar.id,event:d.item.event.id,etag:d.item.event.etag,value});
   items=items.map(item=>item===d.item?{...item,event:{...item.event,...value,...saved}}:item);itemSignature='';eventCache.clear();overviewCache=null;paint();await loadEvents(true);
  }catch(error){loading=false;paint();toast(error.message);}
 });
 document.addEventListener('pointercancel',()=>{restoreDrag(dragging);dragging=null;});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&modal.open&&$('#gc-new-label',modal)?.hidden===false){event.preventDefault();event.stopPropagation();labelPopover(false,true);return;}if(event.key==='Escape'&&detailPopup){event.preventDefault();event.stopPropagation();closeEventDetails();return;}if(event.key==='Escape'&&dayPopup){event.preventDefault();event.stopPropagation();closeDayPopup();}},true);
 const monthWheel={last:0,total:0,switched:false};
 document.addEventListener('wheel',event=>{
  if(!visible()||view!=='month'||modal.open||dayPopup||!event.deltaY||event.ctrlKey||Math.abs(event.deltaX)>Math.abs(event.deltaY)||!event.target.closest('.gc-month'))return;
  event.preventDefault();const now=Date.now();if(now-monthWheel.last>180){monthWheel.total=0;monthWheel.switched=false;}monthWheel.last=now;if(monthWheel.switched)return;
  const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?innerHeight:1);if(Math.sign(delta)!==Math.sign(monthWheel.total))monthWheel.total=0;monthWheel.total+=delta;
  monthWheel.switched=true;closeEventDetails(false);anchor=D.move(anchor,'month',Math.sign(monthWheel.total));loadEvents(false,Math.sign(monthWheel.total)).catch(error=>toast(error.message));
 },{passive:false});
 window.addEventListener('resize',()=>{closeDayPopup(false);positionDetails();if(view==='month'&&typeof requestAnimationFrame==='function')requestAnimationFrame(fitMonth);});
 setInterval(()=>{if(!visible()||modal.open||loading||dragging||dayPopup||detailPopup)return;if(status?.pending)load();else if(status?.connected)loadEvents(true);},60000);
 setInterval(async()=>{if(!visible()||!status?.pending||loading||modal.open)return;const ticket=epoch;try{const next=await api(q('status'));if(!visible()||ticket!==epoch)return;if(next.connected&&!next.pending){await load();return;}if(next.pending!==status.pending||next.error!==status.error){status=next;paint();}}catch{}},2500);
 setInterval(updateNow,15000);
 return {mountOverview,deactivate(){editEpoch++;restoreDrag(dragging);dragging=null;closeDayPopup(false);closeEventDetails(false);},isSelected:()=>source==='google',switcher,render,hide};
})();
