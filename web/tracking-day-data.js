'use strict';
window.HotTurkeyDayData=(()=>{
 function union(ranges){const out=[];for(const [a,b] of ranges.filter(v=>v[1]>v[0]).sort((a,b)=>a[0]-b[0]||a[1]-b[1])){const last=out[out.length-1];if(last&&a<=last[1])last[1]=Math.max(last[1],b);else out.push([a,b]);}return out;}
 function intersection(a,b){let i=0,j=0;const out=[];while(i<a.length&&j<b.length){const x=Math.max(a[i][0],b[j][0]),y=Math.min(a[i][1],b[j][1]);if(y>x)out.push([x,y]);if(a[i][1]<b[j][1])i++;else j++;}return out;}
 const duration=r=>r.reduce((n,[a,b])=>n+b-a,0);
 function without(ranges,cuts){const out=[];let j=0;for(const [a,b] of ranges){let x=a;while(j<cuts.length&&cuts[j][1]<=a)j++;for(let k=j;k<cuts.length&&cuts[k][0]<b;k++){if(cuts[k][0]>x)out.push([x,Math.min(b,cuts[k][0])]);x=Math.max(x,cuts[k][1]);if(x>=b)break;}if(x<b)out.push([x,b]);}return out;}
 const appName=s=>String(s||'').normalize('NFKC').trim().toLocaleLowerCase();
 const collator=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
 const title=row=>row.domain|| (row.timeline==='documents'?(row.url||row.document||row.title):row.title);
 const suffixRules=new Set((window.HotTurkeyPublicSuffixes||[]).map(v=>v.split('.').map(part=>{try{return new URL('http://'+part).hostname;}catch{return part;}}).join('.')));
 function rootDomain(value){
  try{const u=new URL(value),host=u.hostname.toLowerCase().replace(/\.$/,'');if(!['http:','https:'].includes(u.protocol))return '';if(host.startsWith('[')||/^[\d.]+$/.test(host)||!host.includes('.'))return host;
   const parts=host.split('.');let suffix=1;
   for(let i=0;i<parts.length;i++){const tail=parts.slice(i).join('.');if(suffixRules.has('!'+tail)){suffix=parts.length-i-1;break;}if(suffixRules.has(tail)||i>0&&suffixRules.has('*.'+tail))suffix=Math.max(suffix,parts.length-i+(suffixRules.has('*.'+tail)&&i>0?1:0));}
   return parts.slice(-Math.min(parts.length,suffix+1)).join('.');
  }catch{return '';}
 }
 const ranges=row=>row.ranges||[[row.start,row.end]];
 function groupDocuments(rows,mode='adjacent'){
  if(mode==='all'){const groups=new Map(),out=[];for(const row of rows){const domain=rootDomain(row.url||row.document);if(!domain){out.push(row);continue;}if(!groups.has(domain)){const group={...row,id:'domain:'+domain,domain,title:domain,rows:[],ranges:[],start:row.start,end:row.end};groups.set(domain,group);out.push(group);}const group=groups.get(domain);group.rows.push(row);group.ranges.push(...ranges(row));group.start=Math.min(group.start,row.start);group.end=Math.max(group.end,row.end);}for(const group of groups.values()){group.ranges=union(group.ranges);group.seconds=duration(group.ranges);}return out;}
  const out=[];for(const row of sorted(rows,{key:'start',direction:'asc'})){
   const domain=rootDomain(row.url||row.document);if(!domain){out.push(row);continue;}
   const previous=out[out.length-1],sameBrowser=previous&&(previous.bundle&&row.bundle?previous.bundle===row.bundle:previous.application===row.application);
   if(previous?.domain===domain&&sameBrowser&&row.start<=previous.end+1e-6){previous.rows.push(row);previous.ranges=union([...previous.ranges,...ranges(row)]);previous.end=Math.max(previous.end,row.end);previous.seconds=duration(previous.ranges);}
   else out.push({...row,id:'domain:'+row.id,domain,title:domain,rows:[row],ranges:ranges(row),seconds:duration(ranges(row))});
  }return out;
 }

 function sorted(rows,sort={key:'start',direction:'asc'}){
  const key=['title','start','end','seconds'].includes(sort.key)?sort.key:'start',direction=sort.direction==='desc'?-1:1;
  return [...rows].sort((a,b)=>direction*(key==='title'?collator.compare(title(a)||'',title(b)||''):a[key]-b[key])||a.start-b.start||a.end-b.end||String(a.id).localeCompare(String(b.id)));
 }
 function sameApp(row,app){if(app.unknownBrowser)return row.timeline==='documents'&&row.source==='legacy'&&!row.application;if(row.bundle&&app.bundle)return row.bundle===app.bundle;return Boolean(row.application&&appName(row.application)===appName(app.application||app.name));}
 function create(data){
  const byId=new Map(),byTimeline=new Map(),rawTimeline=new Map(),plots=new Map(),detailViews=new Map(),matches=data.filtered_ids?new Set(data.filtered_ids):null;
  for(const row of data.activities){byId.set(row.id,row);if(!rawTimeline.has(row.timeline))rawTimeline.set(row.timeline,[]);rawTimeline.get(row.timeline).push(row);if(matches&&!matches.has(row.id))continue;if(!byTimeline.has(row.timeline))byTimeline.set(row.timeline,[]);byTimeline.get(row.timeline).push(row);}
  function groupIndex(source){const groups=new Map();for(const kind of ['tags','autotags','computer','applications','documents']){
   const map=new Map();for(const row of source.get(kind)||[]){const name=kind==='documents'?(rootDomain(row.url||row.document)||row.group_name):row.group_name;if(!map.has(name))map.set(name,{name,timeline:kind,application:row.application||'',bundle:row.bundle||'',color:row.color,rows:[],ranges:[]});const g=map.get(name);g.rows.push(row);g.ranges.push([row.start,row.end]);}
   if(kind==='applications'){
    const unknown=(source.get('documents')||[]).filter(r=>r.source==='legacy'&&!r.application);
    if(unknown.length)map.set('历史浏览器（归属未知）',{name:'历史浏览器（归属未知）',timeline:kind,application:'',bundle:'',color:'#8e8e93',unknownBrowser:true,rows:unknown,ranges:unknown.map(r=>[r.start,r.end])});
   }
   const values=[...map.values()];for(const g of values){g.ranges=union(g.ranges);g.seconds=duration(g.ranges);}values.sort((a,b)=>b.seconds-a.seconds||a.name.localeCompare(b.name));groups.set(kind,values);
  }return groups;}
  const groups=groupIndex(byTimeline),contextGroups=groupIndex(rawTimeline);
  const tags=data.tag_ranges||union((byTimeline.get('tags')||[]).map(r=>[r.start,r.end]));
  let searchApplications=null;
  function applicationSearchGroups(){
   if(searchApplications)return searchApplications;
   const documents=byTimeline.get('documents')||[],covered=new Set(),values=[];
   for(const group of contextGroups.get('applications')||[]){
    const direct=group.rows.filter(row=>row.timeline==='applications'&&(!matches||matches.has(row.id)));
    const owned=documents.filter(row=>sameApp(row,group));for(const row of owned)covered.add(row.id);
    const rows=[...direct,...owned],spans=union(rows.map(row=>[row.start,row.end]));
    if(spans.length)values.push({...group,rows,ranges:spans,seconds:duration(spans),documentMatch:owned.length>0});
   }
   const extra=new Map();for(const row of documents){if(covered.has(row.id)||!row.application&&!row.bundle)continue;const identity=row.bundle||appName(row.application),name=row.application||row.bundle;
    if(!extra.has(identity))extra.set(identity,{name,timeline:'applications',application:row.application||'',bundle:row.bundle||'',color:row.color,rows:[],ranges:[],documentMatch:true});const group=extra.get(identity);group.rows.push(row);group.ranges.push([row.start,row.end]);
   }
   for(const group of extra.values()){group.ranges=union(group.ranges);group.seconds=duration(group.ranges);values.push(group);}
   return searchApplications=values.sort((a,b)=>b.seconds-a.seconds||collator.compare(a.name,b.name));
  }
  function summaries(kind,selection,app,filterKind=kind){const values=kind==='applications'&&matches&&['applications','documents'].includes(filterKind)?applicationSearchGroups():((filterKind===kind?groups:contextGroups).get(kind)||[]);return values.map(g=>{let ranges=g.ranges;if(app&&kind==='documents')ranges=union(g.rows.filter(r=>sameApp(r,app)).map(r=>[r.start,r.end]));else if(app&&kind==='applications'&&!sameApp({...g,timeline:'applications'},app)&&!(app.unknownBrowser&&g.unknownBrowser))ranges=[];return {...g,ranges:kind==='documents'?ranges:g.ranges,selected_seconds:selection.length?duration(intersection(ranges,selection)):0};});}
  function details(kind,app,untagged=false,sort={key:'start',direction:'asc'},filtered=true,detailed=true,grouping='adjacent'){
   const key=JSON.stringify([kind,app?.unknownBrowser||false,app?.bundle||'',app?.application||app?.name||'',untagged,sort.key,sort.direction,filtered,detailed,grouping]);if(detailViews.has(key))return detailViews.get(key);
   let rows=(filtered?byTimeline:rawTimeline).get(kind)||[];
   if(app&&['applications','documents'].includes(kind))rows=rows.filter(r=>sameApp(r,app));
   if(untagged)rows=rows.flatMap(row=>without([[row.start,row.end]],tags).map(([start,end])=>({...row,id:row.id+'@'+start,original_id:row.id,start,end,seconds:end-start})));
   if(kind==='documents'&&!detailed)rows=groupDocuments(rows,grouping);
   rows=sorted(rows,sort);detailViews.set(key,rows);if(detailViews.size>32)detailViews.delete(detailViews.keys().next().value);return rows;
  }
  const hitRows=new Map([...rawTimeline].map(([kind,rows])=>[kind,[...rows].sort((a,b)=>a.start-b.start)]));
  function recordAt(kind,at){const rows=hitRows.get(kind)||[];let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>1;if(rows[mid].start<=at)lo=mid+1;else hi=mid;}const row=rows[lo-1];return row&&row.end>at?row:null;}
  function bars(kind,start,end){const key=kind+':'+start+':'+end;if(plots.has(key))return plots.get(key);const value=plot(rawTimeline.get(kind)||[],start,end);plots.set(key,value);if(plots.size>16)plots.delete(plots.keys().next().value);return value;}
  return {recordAt,byId,groups,summaries,details,bars,sameApp,hasDocuments:app=>(rawTimeline.get('documents')||[]).some(r=>sameApp(r,app)),selectionSeconds:ranges=>duration(union(ranges)),taggedSeconds:row=>duration(intersection(ranges(row),tags))};
 }
 function plot(rows,start,end,pixels=600){
  if(!(end>start))return [];const visible=rows.filter(r=>r.end>start&&r.start<end);
  if(visible.length<=pixels*2)return visible.map(row=>({...row,plot_start:Math.max(start,row.start),plot_end:Math.min(end,row.end)}));
  const slots=new Array(pixels),begins=new Array(pixels).fill(Infinity),ends=new Array(pixels).fill(-Infinity),step=(end-start)/pixels;
  for(const row of visible){const first=Math.max(0,Math.floor((row.start-start)/step)),last=Math.min(pixels,Math.ceil((row.end-start)/step));for(let i=first;i<last;i++){slots[i]=row;begins[i]=Math.min(begins[i],Math.max(row.start,start+i*step));ends[i]=Math.max(ends[i],Math.min(row.end,start+(i+1)*step));}}
  const out=[];for(let i=0;i<pixels;){const row=slots[i],first=i++;if(!row)continue;while(i<pixels&&slots[i]===row)i++;out.push({...row,plot_start:begins[first],plot_end:ends[i-1]});}return out;
 }
 function viewport(rows,scrollTop=0,height=480){const first=Math.min(Math.max(0,rows.length-1),Math.max(0,Math.floor(scrollTop/36)-8)),last=Math.min(rows.length,first+Math.min(160,Math.ceil(height/36)+16));return {first,last,rows:rows.slice(first,last),before:first*36,after:Math.max(0,(rows.length-last)*36)};}
 function selectionPlot(ranges,start,end,pixels=600){
  if(!(end>start))return [];const clipped=intersection(ranges,[[start,end]]);if(clipped.length<=pixels)return clipped;
  const step=(end-start)/pixels,bins=union(clipped.map(([a,b])=>[Math.floor((a-start)/step),Math.ceil((b-start)/step)]));
  return bins.map(([a,b])=>[start+a*step,Math.min(end,start+b*step)]);
 }
 return {rootDomain,groupDocuments,ranges,create,union,intersection,duration,without,viewport,plot,title,sorted,selectionPlot};
})();
