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
  if(banner(item.event)&&personal)return {color:'#d50000',label:'',source:'local-display'};
  return {color:valid(item.calendar.backgroundColor)?item.calendar.backgroundColor:'#039be5',label:'',source:'calendar'};
 }
 function editable(item){return ['owner','writer','writerWithoutPrivateAccess'].includes(item.calendar.accessRole)&&!['birthday','fromGmail','workingLocation','focusTime','outOfOffice'].includes(item.event.eventType)&&item.event.status!=='cancelled'&&!(item.calendar.accessRole==='writerWithoutPrivateAccess'&&item.event.visibility==='private');}
 return {dayKey,addDays,dateOnly,range,move,bounds,banner,externalURL,onDay,segments,input,classification,eventAppearance,monthCapacity,editable};
})();
