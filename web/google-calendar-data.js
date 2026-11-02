'use strict';
globalThis.HotTurkeyGoogleData=(()=>{
 const dayKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
 const addDays=(date,count)=>{const result=new Date(date);result.setDate(result.getDate()+count);return result;};
 function range(anchor,view,weekStart='monday'){
  let start=new Date(anchor);start.setHours(0,0,0,0);
  if(view==='month'){start.setDate(1);start=addDays(start,-((start.getDay()+(weekStart==='sunday'?0:6))%7));return {start,end:addDays(start,42),days:42};}
  if(view==='week')start=addDays(start,-((start.getDay()+(weekStart==='sunday'?0:6))%7));
  const days=view==='day'?1:view==='agenda'?30:7;return {start,end:addDays(start,days),days};
 }
 function move(anchor,view,step){const date=new Date(anchor);if(view==='month'){date.setDate(1);date.setMonth(date.getMonth()+step);}else date.setDate(date.getDate()+step*(view==='day'?1:view==='agenda'?30:7));return date;}
 const dateOnly=text=>{const [y,m,d]=text.split('-').map(Number);return new Date(y,m-1,d);};
 function bounds(event){return event.start?.date?{start:dateOnly(event.start.date),end:dateOnly(event.end.date),allDay:true}:{start:new Date(event.start?.dateTime),end:new Date(event.end?.dateTime),allDay:false};}
 function onDay(event,date){const {start,end}=bounds(event),endDay=addDays(date,1);return start<endDay&&end>date;}
 function segments(events,date){
  const next=addDays(date,1),rows=[];
  for(const item of events){const {event}=item,{start,end,allDay}=bounds(event);if(allDay||!(start<next&&end>date))continue;
   const startMinute=start<=date?0:start.getHours()*60+start.getMinutes(),endMinute=end>=next?1440:end.getHours()*60+end.getMinutes()+end.getSeconds()/60;
   rows.push({...item,startMinute,endMinute});
  }
  rows.sort((a,b)=>a.startMinute-b.startMinute||b.endMinute-a.endMinute);let group=[],ends=[],through=-1;
  const finish=()=>{for(const item of group)item.columns=ends.length;group=[];ends=[];through=-1;};
  for(const item of rows){if(item.startMinute>=through)finish();let lane=ends.findIndex(end=>end<=item.startMinute);if(lane<0)lane=ends.length;item.lane=lane;ends[lane]=item.endMinute;through=Math.max(through,item.endMinute);group.push(item);}finish();return rows;
 }
 function input(point,zone){if(point.date)return point.date;const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(point.dateTime)).map(x=>[x.type,x.value]));return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;}
 function editable(item){return ['owner','writer','writerWithoutPrivateAccess'].includes(item.calendar.accessRole)&&!['birthday','fromGmail','workingLocation','focusTime','outOfOffice'].includes(item.event.eventType)&&item.event.status!=='cancelled'&&!(item.calendar.accessRole==='writerWithoutPrivateAccess'&&item.event.visibility==='private');}
 return {dayKey,addDays,dateOnly,range,move,bounds,onDay,segments,input,editable};
})();
