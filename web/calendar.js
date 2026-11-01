'use strict';
// Calendar geometry is expressed in day fractions, so labels, blocks and drag
// previews share one scale at every window size.
globalThis.HotTurkeyCalendar=(()=>{
 function segments(blocks,day){
  const values=[];
  for(const block of blocks){
   if(block.mode!=='scheduled')continue;
   (block.schedule||[]).forEach((row,index)=>{
    if(!Array.isArray(row.days)||!Number.isFinite(row.start)||!Number.isFinite(row.end))return;
    if(row.days.includes(day)&&row.end!==row.start)values.push({block,row,index,start:row.start,end:row.end<row.start?1440:row.end});
    if(row.end<row.start&&row.end>0&&row.days.includes((day+6)%7))values.push({block,row,index,start:0,end:row.end});
   });
  }
  values.sort((a,b)=>a.start-b.start||b.end-a.end||String(a.block.id).localeCompare(String(b.block.id))||a.index-b.index);
  let group=[],ends=[],through=-1;
  function finish(){for(const item of group)item.columns=ends.length;group=[];ends=[];through=-1;}
  for(const item of values){
   if(item.start>=through)finish();
   let lane=ends.findIndex(end=>end<=item.start);if(lane<0)lane=ends.length;
   item.lane=lane;ends[lane]=item.end;through=Math.max(through,item.end);group.push(item);
  }
  finish();return values;
 }
 function week(now,weekStart){
  const date=new Date(now*1000),today=(date.getDay()+6)%7,order=weekStart==='sunday'?[6,0,1,2,3,4,5]:[0,1,2,3,4,5,6];
  const start=new Date(date);start.setHours(0,0,0,0);start.setDate(start.getDate()-order.indexOf(today));
  return {today,order,dates:order.map((day,index)=>{const d=new Date(start);d.setDate(start.getDate()+index);return {day,date:d.getDate(),month:d.getMonth()+1};})};
 }
 function render({blocks,selected,now,weekStart,canManage,esc,hm,btn,days}){
  if(!blocks.some(b=>b.id===selected))selected=(blocks.find(b=>b.mode==='scheduled'&&b.schedule.length)||blocks[0])?.id||'';
  const chosen=blocks.find(b=>b.id===selected),current=week(now,weekStart),date=new Date(now*1000),minute=date.getHours()*60+date.getMinutes();
  const disabled=!chosen||chosen.locked;
  const toolbar=`<div class="toolbar schedule-toolbar"><select id="calendar-block" aria-label="日程规则">${blocks.length?blocks.map(b=>`<option value="${esc(b.id)}" ${b.id===selected?'selected':''}>${esc(b.name)}${b.locked?' · 已锁定':''}</option>`).join(''):'<option>暂无规则</option>'}</select><span class="grow"></span>${canManage?btn('calendar-add','＋ 添加时段',disabled?'disabled':''):''}</div>`;
  const headings=`<div class="time-header time-corner">时间</div>`+current.dates.map(v=>`<div class="time-header ${v.day===current.today?'today':''}" id="calendar-day-${v.day}"><span class="calendar-weekday">${days[v.day]}</span><span class="calendar-date" aria-label="${v.month}月${v.date}日">${v.date}</span></div>`).join('');
  const labels=`<div class="time-labels">${Array.from({length:25},(_,i)=>`<span class="${i===0?'first':i===24?'last':''}" style="top:${i/24*100}%">${hm(i*60)}</span>`).join('')}</div>`;
  const columns=current.order.map(day=>`<div class="day-column ${day===current.today?'today':''}" data-day="${day}" role="group" aria-labelledby="calendar-day-${day}">${segments(blocks,day).map(item=>{
   const {block,row,index,start,end,lane,columns}=item,range=hm(start)+'–'+hm(end),duration=end-start;
   const description=block.name+' · '+range+(block.locked?' · 已锁定':'');
   return `<button type="button" class="calendar-event" data-action="calendar-event" data-id="${esc(block.id)}" data-index="${index}" data-selected="${block.id===selected}" data-compact="${duration<60}" data-overlap="${columns>1}" data-start-minute="${start}" data-end-minute="${end}" aria-label="${esc(description)}" title="${esc(description)}" ${canManage?'':'disabled'} style="top:calc(${start/1440*100}% + 1px);height:calc(${duration/1440*100}% - 2px);left:calc(${lane/columns*100}% + 4px);width:calc(${100/columns}% - 8px);--rule-color:${esc(block.color)}"><span class="calendar-event-content"><b>${esc(block.name)}</b><small><span>${hm(start)}</span><span>–${hm(end)}</span></small></span></button>`;
  }).join('')}${day===current.today?`<div class="calendar-now" id="calendar-now" style="top:${minute/1440*100}%" aria-label="现在 ${hm(minute)}"></div>`:''}</div>`).join('');
  return {selected,html:toolbar+`<div class="schedule-scroller" tabindex="0" role="region" aria-label="每周日程"><div class="timeline">${headings}${labels}${columns}</div></div>`};
 }
 return {segments,week,render};
})();
