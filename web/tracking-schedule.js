'use strict';
// Local week arithmetic. Input rows retain their exact minute boundaries.
(() => {
 const union=values=>{const out=[];for(const [a,b] of values.filter(v=>v[1]>v[0]).sort((a,b)=>a[0]-b[0])){const last=out[out.length-1];if(last&&a<=last[1])last[1]=Math.max(last[1],b);else out.push([a,b]);}return out;};
 function days(rows){
  const result=Array.from({length:7},()=>[]);
  for(const row of rows)for(const day of row.days){if(row.end<row.start){result[day].push([row.start,1440]);result[(day+1)%7].push([0,row.end]);}else result[day].push([row.start,row.end]);}
  return result.map(union);
 }
 function rows(week){
  const grouped=new Map();week.forEach((ranges,day)=>{for(const [start,end] of union(ranges)){const key=start+':'+end;if(!grouped.has(key))grouped.set(key,{days:[],start,end});grouped.get(key).days.push(day);}});return [...grouped.values()];
 }
 function edit(input,selected,start,end,add){
  const week=days(input);
  for(const day of selected){const pieces=end<start?[[day,start,1440],[(day+1)%7,0,end]]:[[day,start,end]];
   for(const [d,a,b] of pieces){if(add)week[d].push([a,b]);else week[d]=week[d].flatMap(([x,y])=>y<=a||x>=b?[[x,y]]:[[x,Math.min(a,y)],[Math.max(b,x),y]].filter(v=>v[1]>v[0]));}
  }
  return rows(week);
 }
 function coverage(week,day,start,end){return week[day].reduce((n,[a,b])=>n+Math.max(0,Math.min(b,end)-Math.max(a,start)),0);}
 const value={days,rows,edit,coverage};
 if(typeof module!=='undefined'&&module.exports)module.exports=value;
 else window.HotTurkeyTrackingSchedule=value;
})();
