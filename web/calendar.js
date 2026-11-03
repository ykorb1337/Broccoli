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
    if(row.days.includes(day)&&row.end!==row.start)values.push({block,row,index,originDay:day,start:row.start,end:row.end<row.start?1440:row.end});
    if(row.end<row.start&&row.end>0&&row.days.includes((day+6)%7))values.push({block,row,index,originDay:(day+6)%7,start:0,end:row.end});
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
 function render({blocks,selected,now,weekStart,canManage,esc,hm,btn,days,scope='main'}){
  if(selected!=='all'&&!blocks.some(b=>b.id===selected))selected=(blocks.find(b=>b.mode==='scheduled'&&b.schedule.length)||blocks[0])?.id||'';
  const chosen=blocks.find(b=>b.id===selected),current=week(now,weekStart),date=new Date(now*1000),minute=date.getHours()*60+date.getMinutes();
  const disabled=!chosen||chosen.locked,draft=scope==='editor',prefix=draft?'editor-calendar-day-':'calendar-day-',shown=selected==='all'?blocks:blocks.filter(b=>b.id===selected);
  const toolbar=draft?'':`<div class="toolbar schedule-toolbar"><select id="calendar-block" aria-label="日程规则">${blocks.length?'<option value="all" '+(selected==='all'?'selected':'')+'>显示所有</option>'+blocks.map(b=>`<option value="${esc(b.id)}" ${b.id===selected?'selected':''}>${esc(b.name)}${b.locked?' · 已锁定':''}</option>`).join(''):'<option>暂无规则</option>'}</select><span class="grow"></span>${canManage?btn('calendar-add','＋ 添加时段',disabled?'disabled':''):''}</div>`;
  const headings=`<div class="time-header time-corner">时间</div>`+current.dates.map(v=>`<div class="time-header ${v.day===current.today?'today':''}" id="${prefix}${v.day}"><span class="calendar-weekday">${days[v.day]}</span><span class="calendar-date" aria-label="${v.month}月${v.date}日">${v.date}</span></div>`).join('');
  const labels=`<div class="time-labels">${Array.from({length:25},(_,i)=>`<span class="${i===0?'first':i===24?'last':''}" style="top:${i/24*100}%">${hm(i*60)}</span>`).join('')}</div>`;
  const columns=current.order.map(day=>`<div class="day-column ${day===current.today?'today':''}" data-day="${day}" role="group" aria-labelledby="${prefix}${day}">${segments(shown,day).map(item=>{
   const {block,row,index,start,end,lane,columns}=item,range=hm(start)+'–'+hm(end),duration=end-start;
   const description=block.name+' · '+range+(block.locked?' · 已锁定':'');
   return `<button type="button" class="calendar-event" data-action="${draft?'editor-calendar-event':'calendar-event'}" data-origin-day="${item.originDay}" data-id="${esc(block.id)}" data-index="${index}" data-selected="${block.id===selected}" data-compact="${duration<60}" data-overlap="${columns>1}" data-start-minute="${start}" data-end-minute="${end}" aria-label="${esc(description)}" title="${esc(description)}" ${canManage?'':'disabled'} style="top:calc(${start/1440*100}% + 1px);height:calc(${duration/1440*100}% - 2px);left:calc(${lane/columns*100}% + 4px);width:calc(${100/columns}% - 8px);--rule-color:${esc(block.color)}"><span class="calendar-event-content"><b>${esc(draft?range:block.name)}</b><small><span>${hm(start)}</span><span>–${hm(end)}</span></small></span></button>`;
  }).join('')}${day===current.today?`<div class="calendar-now" id="calendar-now" style="top:${minute/1440*100}%" aria-label="现在 ${hm(minute)}"></div>`:''}</div>`).join('');
  return {selected,html:toolbar+`<div class="schedule-scroller" tabindex="0" role="region" aria-label="每周日程"><div class="timeline">${headings}${labels}${columns}</div></div>`};
 }
 function selection(anchor,current){
  const start=Math.max(0,Math.min(1425,Math.round(Math.min(anchor,current)/15)*15));
  return {start,end:Math.max(start+15,Math.min(1440,Math.round(Math.max(anchor,current)/15)*15))};
 }
 function validate(schedule){
  if(schedule.length>200)throw Error('日程最多 200 组');
  const week=10080,ranges=[];
  for(const row of schedule){
   if(!Array.isArray(row.days)||!row.days.length||row.days.some(d=>!Number.isInteger(d)||d<0||d>6)||!Number.isInteger(row.start)||row.start<0||row.start>1439||!Number.isInteger(row.end)||row.end<1||row.end>1440||row.start===row.end)throw Error('请选择日期，并填写不同的开始和结束时间');
   const length=(row.end-row.start+1440)%1440||1440;
   for(const day of new Set(row.days)){const start=day*1440+row.start,end=start+length;ranges.push([start,Math.min(end,week)]);if(end>week)ranges.push([0,end-week]);}
  }
  ranges.sort((a,b)=>a[0]-b[0]);for(let i=1;i<ranges.length;i++)if(ranges[i][0]<ranges[i-1][1])throw Error('同一规则内的日程不能重叠');
  return schedule;
 }
 // Minute cells match the policy model's precision. Union overlapping
 // occurrences, while the last (edited) row supplies each merged group's break.
 function combine(schedule){
  const nodes=[];
  schedule.forEach((row,source)=>{validate([{...row,days:[row.days?.[0]]}]);for(const day of new Set(row.days)){if(!Number.isInteger(day)||day<0||day>6)throw Error('请选择有效日期');nodes.push({row,source,day,start:day*1440+row.start,length:(row.end-row.start+1440)%1440||1440});}});
  const parent=nodes.map((_,i)=>i),owner=new Int32Array(10080);
  function find(i){while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;}
  for(let i=0;i<nodes.length;i++){const node=nodes[i];for(let offset=0;offset<node.length;offset++){const cell=(node.start+offset)%10080,old=owner[cell]-1;if(old>=0){const a=find(i),b=find(old);if(a!==b)parent[b]=a;}owner[cell]=i+1;}}
  const winner=new Map(),counts=new Map();nodes.forEach((_,i)=>{const root=find(i);winner.set(root,i);counts.set(root,(counts.get(root)||0)+1);});
  const runs=[];let previous=-1,start=0;
  for(let at=0;at<=10080;at++){const root=at===10080||!owner[at]?-1:find(owner[at]-1);if(root!==previous){if(previous>=0)runs.push({root:previous,start,end:at});start=at;previous=root;}}
  if(runs.length>1&&runs[0].start===0&&runs.at(-1).end===10080&&runs[0].root===runs.at(-1).root){const first=runs.shift(),last=runs.pop();runs.push({...last,end:10080+first.end});}
  const groups=new Map();
  function emit(run,start,end){
   const node=nodes[winner.get(run.root)],merged=counts.get(run.root)>1,key=[node.source,start%1440,end%1440,merged].join(':'),day=Math.floor(start/1440)%7;
   if(!groups.has(key)){const row=structuredClone(node.row);row.days=[];row.start=start%1440;row.end=end%1440||1440;if(merged)delete row.id;groups.set(key,{row,source:node.source});}
   groups.get(key).row.days.push(day);
  }
  for(const run of runs){let at=run.start;if(run.end-at<=1440&&!(run.end-at===1440&&at%1440)){emit(run,at,run.end);continue;}while(at<run.end){const end=Math.min(run.end,(Math.floor(at/1440)+1)*1440);emit(run,at,end);at=end;}}
  return validate([...groups.values()].sort((a,b)=>a.source-b.source||a.row.start-b.row.start).map(({row})=>({...row,days:[...new Set(row.days)].sort((a,b)=>a-b)})));
 }
 function replace(schedule,index,row){const next=structuredClone(schedule);if(index!==null)next.splice(index,1);next.push(structuredClone(row));return combine(next);}
 function move(schedule,index,day,targetDay,start){
  const next=structuredClone(schedule),row=next[index];if(!row?.days.includes(day))throw Error('日程已更新，请重新选择');
  const length=(row.end-row.start+1440)%1440||1440;if(length===1440)start=0;
  const moved={...row,days:[targetDay],start,end:(start+length)%1440||1440};
  if(row.days.length===1)next.splice(index,1);else{row.days=row.days.filter(d=>d!==day);delete moved.id;}next.push(moved);
  return combine(next);
 }
 return {segments,week,render,selection,validate,combine,replace,move};
})();
