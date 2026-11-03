'use strict';
globalThis.HotTurkeyGoogleData=(()=>{
 const dayKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
 const addDays=(date,count)=>{const result=new Date(date);result.setDate(result.getDate()+count);return result;};
 function range(anchor,view,weekStart='monday'){
  let start=new Date(anchor);start.setHours(0,0,0,0);
  if(view==='month'){start.setDate(1);start=addDays(start,-((start.getDay()+(weekStart==='sunday'?0:6))%7));return {start,end:addDays(start,42),days:42};}
  if(view==='week'||view==='agenda')start=addDays(start,-((start.getDay()+(weekStart==='sunday'?0:6))%7));
  const days=view==='day'?1:7;return {start,end:addDays(start,days),days};
 }
 function move(anchor,view,step){const date=new Date(anchor);if(view==='month'){date.setDate(1);date.setMonth(date.getMonth()+step);}else date.setDate(date.getDate()+step*(view==='day'?1:7));return date;}
 const dateOnly=text=>{const [y,m,d]=text.split('-').map(Number);return new Date(y,m-1,d);};
 function bounds(event){return event.start?.date?{start:dateOnly(event.start.date),end:dateOnly(event.end.date),allDay:true}:{start:new Date(event.start?.dateTime),end:new Date(event.end?.dateTime),allDay:false};}
 // Midnight-to-midnight timed imports are displayed as banners, without
 // changing the original Google event type or its edit payload. Calendar-day
 // arithmetic deliberately handles 23/25-hour daylight-saving days.
 function banner(event){
  const {start,end,allDay}=bounds(event);if(allDay)return true;
  const midnight=date=>date.getHours()===0&&date.getMinutes()===0&&date.getSeconds()===0&&date.getMilliseconds()===0;
  return Number.isFinite(+start)&&end>start&&midnight(start)&&midnight(end)&&dayKey(start)!==dayKey(end);
 }
 function externalURL(link){
  let value;try{value=new URL(link);}catch{throw Error('链接无效');}
  const calendarLink=value.hostname==='www.google.com'&&(value.pathname==='/calendar'||value.pathname.startsWith('/calendar/'));
  if(value.protocol!=='https:'||value.username||value.password||value.port||!calendarLink&&!['accounts.google.com','calendar.google.com','meet.google.com','console.cloud.google.com','developers.google.com'].includes(value.hostname))throw Error('链接无效');
  return value.href;
 }
 function onDay(event,date){const {start,end}=bounds(event),endDay=addDays(date,1);return start<endDay&&end>date;}
 function segments(events,date){
  const next=addDays(date,1),rows=[];
  for(const item of events){const {event}=item,{start,end,allDay}=bounds(event);if(banner(event)||!(start<next&&end>date))continue;
   const startMinute=start<=date?0:start.getHours()*60+start.getMinutes(),endMinute=end>=next?1440:end.getHours()*60+end.getMinutes()+end.getSeconds()/60;
   rows.push({...item,startMinute,endMinute});
  }
  rows.sort((a,b)=>a.startMinute-b.startMinute||b.endMinute-a.endMinute);let group=[],ends=[],through=-1;
  const finish=()=>{for(const item of group){item.columns=ends.length;item.span=1;for(let lane=item.lane+1;lane<ends.length;lane++){if(group.some(other=>other.lane===lane&&other.startMinute<item.endMinute&&other.endMinute>item.startMinute))break;item.span++;}}group=[];ends=[];through=-1;};
  for(const item of rows){if(item.startMinute>=through)finish();let lane=ends.findIndex(end=>end<=item.startMinute);if(lane<0)lane=ends.length;item.lane=lane;ends[lane]=item.endMinute;through=Math.max(through,item.endMinute);group.push(item);}finish();return rows;
 }
 function input(point,zone){if(point.date)return point.date;const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(point.dateTime)).map(x=>[x.type,x.value]));return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;}
 // Move by calendar days in the event's timezone, preserving wall-clock
 // start/end independently across DST. Only time fields are returned: the
 // caller PATCHes the displayed instance ID, never its recurrence master.
 function shiftEvent(event,fromDay,toDay,defaultZone=Intl.DateTimeFormat().resolvedOptions().timeZone){
  const ordinal=text=>{const [y,m,d]=text.split('-').map(Number);return Date.UTC(y,m-1,d);};
  const delta=Math.round((ordinal(toDay)-ordinal(fromDay))/86400000);
  if(!Number.isFinite(delta))throw Error('请选择有效的日期');
  const shift=point=>{
   if(point.date){const date=new Date(ordinal(point.date)+delta*86400000);return {date:date.toISOString().slice(0,10)};}
   const timeZone=point.timeZone||defaultZone,instant=new Date(point.dateTime);
   const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(instant).map(x=>[x.type,x.value]));
   const date=new Date(Date.UTC(+parts.year,+parts.month-1,+parts.day+delta,+parts.hour,+parts.minute,+parts.second,instant.getUTCMilliseconds()));
   return {dateTime:date.toISOString().slice(0,-1),timeZone};
  };
  return {start:shift(event.start),end:shift(event.end)};
 }
 function monthCapacity(height){return Math.max(1,Math.floor((height-59)/24));}
 function classification(event){
  const text=String(event.summary||'');
  const rules=[
   [/\b(DDL|deadlines?|due)\b/i,'Deadlines','#d50000'],
   [/\brelease\b/i,'Release','#f6bf26'],
   [/\b(labs?|coding lab)\b/i,'Labs','#0b8043'],
   [/\b(career|networking|offer evaluation|negotiation)\b/i,'Career and Networking','#f09300'],
   [/\b(campus|registration|appointment)\b/i,'Campus','#009688'],
   [/\b(exams?|midterm|programming test)\b/i,'Exams','#8e24aa'],
   [/\b(lectures?|recitation|no class)\b/i,'Lectures','#4285f4'],
   [/\b(presentation|office hours|OH|oral|sign-up only)\b/i,'Presentation','#039be5'],
   [/\b(entertainment|concert|movie)\b/i,'Entertainment','#7986cb'],
   [/\bmisc(ellaneous)?\b/i,'Miscellaneous','#616161']
  ];
  const found=rules.find(([pattern])=>pattern.test(text));return found?{name:found[1],color:found[2]}:null;
 }
 function eventAppearance(item,palette={}){
  const valid=value=>typeof value==='string'&&/^#[a-f\d]{6}$/i.test(value);
  const label=item.calendar.labels?.find(label=>label.id===item.event.eventLabelId),legacy=palette[item.event.colorId]?.background;
  if(valid(label?.backgroundColor))return {color:label.backgroundColor,label:label.name||'',source:'google-label'};
  if(valid(legacy))return {color:legacy,label:'',source:'google-color'};
  const personal=item.calendar.primary||['owner','writer','writerWithoutPrivateAccess'].includes(item.calendar.accessRole),category=personal?classification(item.event):null;
  if(category)return {color:category.color,label:'',source:'local-display'};
  return {color:valid(item.calendar.backgroundColor)?item.calendar.backgroundColor:'#039be5',label:'',source:'calendar'};
 }
 function editable(item){return ['owner','writer','writerWithoutPrivateAccess'].includes(item.calendar.accessRole)&&!['birthday','fromGmail','workingLocation','focusTime','outOfOffice'].includes(item.event.eventType)&&item.event.status!=='cancelled'&&!(item.calendar.accessRole==='writerWithoutPrivateAccess'&&item.event.visibility==='private');}
 function dayIndex(items,dates){
  const points=items.map((item,index)=>({item,index,...bounds(item.event),banner:banner(item.event)})),days=new Map();
  for(const date of dates){const end=addDays(date,1);days.set(dayKey(date),points.filter(row=>row.start<end&&row.end>date).sort((a,b)=>Number(b.banner)-Number(a.banner)||a.start-b.start));}
  return days;
 }
 function nowIndicator(dates,now=new Date()){
  const key=dayKey(now),index=dates.findIndex(date=>dayKey(date)===key);
  return index<0?null:{index,day:key,minute:now.getHours()*60+now.getMinutes()+now.getSeconds()/60};
 }
 // End dates are exclusive. Reserve one continuous lane across each week,
 // using local day boundaries so midnight imports and DST remain correct.
 function weekRows(items,dates,bannersOnly=false){
  const rows=[];
  items.forEach((item,index)=>{if(bannersOnly&&!banner(item.event))return;const b=bounds(item.event),days=dates.map((date,i)=>b.start<addDays(date,1)&&b.end>date?i:-1).filter(i=>i>=0);if(!days.length)return;
   rows.push({item,index,startDay:days[0],endDay:days.at(-1)+1,start:b.start,end:b.end,banner:banner(item.event),spanning:dayKey(b.start)!==dayKey(new Date(+b.end-1))});
  });
  rows.sort((a,b)=>Number(b.banner||b.spanning)-Number(a.banner||a.spanning)||a.startDay-b.startDay||(b.endDay-b.startDay)-(a.endDay-a.startDay)||a.start-b.start||a.index-b.index);
  const occupied=[];
  for(const row of rows){let lane=0;while(occupied[lane]?.some(other=>other.startDay<row.endDay&&other.endDay>row.startDay))lane++;row.lane=lane;(occupied[lane]??=[]).push(row);}
  return rows;
 }
 function descriptionText(value){
  return String(value||'').slice(0,20000).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6])\s*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[a-f\d]+);/gi,entity=>{const named={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '};if(named[entity])return named[entity];const n=parseInt(entity.slice(entity[2].toLowerCase()==='x'?3:2,-1),entity[2].toLowerCase()==='x'?16:10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}).replace(/\n{3,}/g,'\n\n').trim();
 }
 function detailURL(text){try{const value=new URL(text.startsWith('www.')?'https://'+text:text);return ['https:','http:'].includes(value.protocol)&&value.hostname&&!value.username&&!value.password&&text.length<=8192?value.href:null;}catch{return null;}}
 function detailHTML(value){
  const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const link=(href,text)=>`<a href="${escape(href)}" data-gc="detail-link" data-url="${escape(href)}" target="_blank" rel="noopener noreferrer" title="${escape(href)}">${escape(text)}</a>`;
  const plain=text=>{text=descriptionText(text);let out='',at=0;for(const match of text.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi)){let raw=match[0],tail='';while(/[.,;!，。；！）\])}]$/.test(raw)){tail=raw.slice(-1)+tail;raw=raw.slice(0,-1);}const href=detailURL(raw);out+=escape(text.slice(at,match.index))+(href?link(href,raw):escape(raw))+escape(tail);at=match.index+match[0].length;}return out+escape(text.slice(at));};
  let out='',at=0;value=String(value||'').slice(0,20000);for(const match of value.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi)){const href=detailURL(descriptionText(match[2])),text=descriptionText(match[3]);out+=plain(value.slice(at,match.index))+(href?link(href,text||href):escape(text));at=match.index+match[0].length;}return out+plain(value.slice(at));
 }
 function analysisCategory(item){
  const label=item.calendar.labels?.find(v=>v.id===item.event.eventLabelId),category=String(label?.name||'').trim()?null:classification(item.event);
  const name=String(label?.name||'').trim()||category?.name||(label?'未命名标签':'默认'),color=label&&/^#[a-f\d]{6}$/i.test(label.backgroundColor||'')?label.backgroundColor:category?.color||'#039be5';
  return {key:name+'|'+color,name,color,inferred:!!category};
 }
 function analytics(items,start,end,calendars=[]){
  const rows=new Map(),defaults=[['Deadlines','#d50000'],['Career and Networking','#f09300'],['Labs','#0b8043'],['Campus','#009688'],['Presentation','#039be5'],['Lectures','#4285f4'],['Entertainment','#7986cb'],['Exams','#8e24aa'],['Miscellaneous','#616161']];
  function row(name,color){const key=name+'|'+color;if(!rows.has(key))rows.set(key,{key,name,color,seconds:0});return rows.get(key);}
  const labels=calendars.flatMap(c=>c.labels||[]).filter(label=>String(label.name||'').trim());for(const label of labels)row(label.name.trim(),/^#[a-f\d]{6}$/i.test(label.backgroundColor||'')?label.backgroundColor:'#039be5');
  if(!labels.length)for(const [name,color] of defaults)row(name,color);let inferred=false,total=0;
  row('默认','#039be5');
  for(const item of items){const event=item.event,b=bounds(event);if(event.status==='cancelled'||event.attendees?.some(a=>a.self&&a.responseStatus==='declined')||b.start>=end||b.end<=start)continue;
   const category=analysisCategory(item);if(category.inferred)inferred=true;const entry=row(category.name,category.color);
   if(banner(event))continue;
   const seconds=Math.max(0,Math.min(+b.end,+end)-Math.max(+b.start,+start))/1000;entry.seconds+=seconds;total+=seconds;
  }
  return {rows:[...rows.values()],total,inferred};
 }
 // Memory-only, account-scoped range cache. Covering month ranges can serve
 // week/day views without another request; writes invalidate pending results.
 function createEventCache(clock=()=>Date.now(),ttl=60000,limit=16){
  const entries=new Map(),pending=new Map();let generation=0;
  function read(calendar,start,end){
   const now=clock();let found;
   for(const [key,row] of entries){if(row.calendar===calendar&&row.start<=+start&&row.end>=+end&&now-row.at<(row.value.offline?3000:ttl))found=[key,row];}
   if(!found)return null;const [key,row]=found;entries.delete(key);entries.set(key,row);
   return {...row.value,items:row.value.items.filter(event=>{const b=bounds(event);return b.start<end&&b.end>start;})};
  }
  function peek(calendars,start,end){const result=calendars.map(id=>read(id,start,end));return result.some(value=>value===null)?null:result.map((value,i)=>({calendarId:calendars[i],...value}));}
  function request(calendar,start,end,fetcher,force){
   const cached=!force&&read(calendar,start,end);if(cached)return Promise.resolve({calendarId:calendar,...cached});
   const key=JSON.stringify([calendar,start.toISOString(),end.toISOString()]);if(pending.has(key))return pending.get(key);
   const ticket=generation;const promise=Promise.resolve().then(()=>fetcher(calendar,start,end)).then(value=>{
    if(ticket===generation){entries.delete(key);entries.set(key,{calendar,start:+start,end:+end,at:clock(),value});while(entries.size>limit)entries.delete(entries.keys().next().value);}
    return {calendarId:calendar,...value};
   }).finally(()=>{if(pending.get(key)===promise)pending.delete(key);});pending.set(key,promise);return promise;
  }
  return {peek,load:(calendars,start,end,fetcher,force=false)=>Promise.all(calendars.map(id=>request(id,start,end,fetcher,force))),clear(){generation++;entries.clear();pending.clear();}};
 }
 return {dayKey,addDays,dateOnly,range,move,bounds,banner,externalURL,onDay,segments,input,shiftEvent,classification,eventAppearance,monthCapacity,editable,dayIndex,weekRows,nowIndicator,descriptionText,detailURL,detailHTML,createEventCache,analytics,analysisCategory};
})();
