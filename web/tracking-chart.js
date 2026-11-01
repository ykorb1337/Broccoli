'use strict';
// Geometry shared by the visible SVG and exported image; no chart library/CDN.
(() => {
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const valid=v=>typeof v==='number'&&Number.isFinite(v);
 const ink=(v,fallback)=>{
  if(/^#[a-f\d]{6}$/i.test(v||''))return v;
  const parts=/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?))?\s*\)$/.exec(v||'');
  return parts&&parts.slice(1,4).every(n=>Number(n)<=255)?v:fallback;
 };
 function format(value,unit='seconds'){
  if(value==null)return '—';if(unit==='days')return Number(value.toFixed(2))+' 天';
  const n=Math.round(Math.max(0,value)),hours=Math.floor(n/3600),minutes=String(Math.floor(n%3600/60)).padStart(2,'0'),seconds=String(n%60).padStart(2,'0');return `${hours}:${minutes}:${seconds}`;
 }
 function geometry(report){
  const count=report.buckets.length,series=report.series,width=Math.min(12000,Math.max(640,count*42,count*Math.min(140,series.length*10))),height=260;
  const box={left:64,right:width-18,top:20,bottom:212},span=box.right-box.left,step=span/Math.max(1,count);
  let maximum=1;for(const item of series)for(const value of item.values)if(valid(value))maximum=Math.max(maximum,value);
  if(report.show_average)for(const item of series)if(valid(item.average))maximum=Math.max(maximum,item.average);
  if(series.some(v=>v.unit==='clock'))maximum=Math.max(maximum,86400);
  if(series[0]?.unit==='days')maximum=Math.max(1,Math.ceil(maximum));
  else{
   maximum=Math.max(maximum,60);const steps=[1,5,10,15,30,60,300,600,900,1800,3600,7200,10800,21600,43200,86400,172800,604800,2592000,31536000];
   const step=steps.find(v=>v>=maximum/4)||Math.pow(10,Math.ceil(Math.log10(maximum/4)));maximum=Math.ceil(maximum/step)*step;
  }
  const y=value=>box.bottom-(box.bottom-box.top)*value/maximum;
  const points=series.map((item,index)=>({name:item.name,color:ink(item.color,'#007aff'),unit:item.unit||'seconds',average:item.average,
   points:item.values.map((value,i)=>valid(value)?{value,bucket:report.buckets[i],x:box.left+(i+.5)*step,y:y(value),
     left:box.left+i*step+step*.1+index*(step*.8/Math.max(1,series.length)),width:step*.8/Math.max(1,series.length),height:box.bottom-y(value)}:null)}));
  return {width,height,box,step,maximum,points,y};
 }
 function svg(report,palette={}){
  const p=geometry(report),{box}=p,foreground=ink(palette.ink,'#1d1d1f'),muted=ink(palette.muted,'#6e6e73'),line=ink(palette.line,'#e5e5e7'),background=ink(palette.background,'#ffffff');
  const axes=Array.from({length:5},(_,i)=>{const value=p.maximum*i/4,y=p.y(value);return `<path d="M${box.left} ${y}H${box.right}" stroke="${line}"/><text x="${box.left-8}" y="${y+4}" fill="${muted}" text-anchor="end">${esc(format(value,report.series[0]?.unit))}</text>`;}).join('');
  const labels=report.buckets.map((key,i)=>i%Math.max(1,Math.ceil(report.buckets.length/10))===0||i===report.buckets.length-1?`<text x="${box.left+(i+.5)*p.step}" y="238" fill="${muted}" text-anchor="middle">${esc(key)}</text>`:'').join('');
  const plots=p.points.map(item=>{
   const label=point=>`${item.name} · ${point.bucket} · ${format(point.value,item.unit)}`;
   let marks='';
   if(report.chart_type==='line'){
    let path='';for(const point of item.points){if(!point){if(path)marks+=`<path class="mt-chart-line" d="${path}" fill="none" stroke="${item.color}" stroke-width="2"/>`;path='';}else path+=(path?'L':'M')+point.x+' '+point.y+' ';}if(path)marks+=`<path class="mt-chart-line" d="${path}" fill="none" stroke="${item.color}" stroke-width="2"/>`;
    marks+=item.points.filter(Boolean).map(point=>`<circle tabindex="0" aria-label="${esc(label(point))}" cx="${point.x}" cy="${point.y}" r="3" fill="${item.color}"><title>${esc(label(point))}</title></circle>`).join('');
   }else marks=item.points.filter(Boolean).map(point=>`<rect tabindex="0" aria-label="${esc(label(point))}" x="${point.left}" y="${point.y}" width="${point.width}" height="${point.height}" rx="2" fill="${item.color}"><title>${esc(label(point))}</title></rect>`).join('');
   if(report.show_average&&valid(item.average))marks+=`<path class="mt-chart-average" d="M${box.left} ${p.y(item.average)}H${box.right}" fill="none" stroke="${item.color}" stroke-width="1.3" stroke-dasharray="5 4"><title>${esc(item.name+' 平均 '+format(item.average,item.unit))}</title></path>`;
   return `<g data-series="${esc(item.name)}">${marks}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="mt-chart-svg" role="img" aria-label="${esc(report.name||'使用统计图表')}" width="${p.width}" height="${p.height}" viewBox="0 0 ${p.width} ${p.height}" style="font:12px -apple-system,BlinkMacSystemFont,sans-serif"><title>${esc(report.name||'使用统计图表')}</title><rect width="100%" height="100%" fill="${background}"/>${axes}${labels}${plots}</svg>`;
 }
 function html(report,palette){
  if(!report.series.length)return '<div class="mt-empty">这段时间暂无统计记录</div>';
  const legend=report.series.map(item=>`<div class="mt-series"><span class="mt-color" style="--item-color:${ink(item.color,'#007aff')}"></span><span>${esc(item.name)}</span><b>${item.total==null?'':esc(format(item.total,item.unit))}</b>${report.show_average?`<small>平均 ${esc(format(item.average,item.unit))}</small>`:''}</div>`).join('');
  return `<div class="mt-chart-scroll">${svg(report,palette)}</div><div class="mt-chart-legend">${legend}</div>`;
 }
 async function image(report,palette,type='image/jpeg'){
  const source=new Blob([svg(report,palette)],{type:'image/svg+xml'}),url=URL.createObjectURL(source);
  try{
   const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('无法生成图表图片'));img.src=url;});
   const p=geometry(report),canvas=document.createElement('canvas');canvas.width=Math.min(8192,p.width*2);canvas.height=Math.round(p.height*canvas.width/p.width);
   const context=canvas.getContext('2d');if(!context)throw Error('无法生成图表图片');context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(img,0,0,canvas.width,canvas.height);
   return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('无法生成图表图片')),type,.95));
  }finally{URL.revokeObjectURL(url);}
 }
 const exported={format,geometry,svg,html,image};if(typeof module!=='undefined'&&module.exports)module.exports=exported;else window.HotTurkeyChart=exported;
})();
