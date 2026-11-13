'use strict';
// Preview frames are indexed once and cached; the enlarged view pins one ID.
window.HotTurkeyMedia={create({model,apiCall,attr,time,resolveBar}){
 const q=(s,r=document)=>r.querySelector(s),cache=new Map(),inflight=new Map();
 let sequence=0,epoch=0,context=null,pending=null,pressed=null,dialog=null,preview=null,origin=null,objectURL='',loadedId='',originalURL='',index=[],indexKey='',indexAt=0,indexPending=null;
 Object.assign(model,{shot:null,shotMode:'idle',shotURL:'',shotMessage:''});
 const scale=()=>Number(document.body.style.zoom)||1;
 const available=()=>page==='statistics'&&['day','untagged'].includes(model.view)&&!modal.open&&!document.body.dataset?.trackingMenu;
 const eligible=element=>element?.closest?.('.mt-activity');
 function clearImage(){objectURL='';loadedId='';model.shotURL='';model.shot=null;}
 function clearCache(){epoch++;for(const url of cache.values())URL.revokeObjectURL(url);cache.clear();inflight.clear();index=[];indexKey='';indexAt=0;indexPending=null;}
 function removePreview(){preview?.remove();preview=null;}
 function cancelHover(){sequence++;pending=null;pressed=null;context=null;removePreview();}
 function hide(){if(model.shotMode==='expanded')return;cancelHover();clearImage();model.shotMode='idle';}
 function caption(shot){return time(shot.at)+' · '+shot.application;}
 function position(){
  if(!preview||!context)return;
  const zoom=scale(),r=preview.getBoundingClientRect(),bar=context.element.getBoundingClientRect();
  const x=Math.max(8,Math.min(innerWidth-r.width-8,context.x+16)),below=bar.bottom+10;
  const y=below+r.height<=innerHeight-8?below:Math.max(8,bar.top-r.height-10);
  preview.style.left=x/zoom+'px';preview.style.top=y/zoom+'px';
 }
 function paintPreview(){
  if(!context||model.shotMode==='expanded'||!available())return;
  if(!preview){preview=document.createElement('div');preview.className='mt-shot-preview';preview.setAttribute('role','tooltip');preview.id='mt-shot-preview';preview.innerHTML='<div class="mt-shot-info"></div><img alt="屏幕截图预览" hidden>';document.body.appendChild(preview);}
  const row=context.row,duration=Math.max(0,Math.round(row.end-row.start)),elapsed=`${Math.floor(duration/3600)}:${String(Math.floor(duration%3600/60)).padStart(2,'0')}:${String(duration%60).padStart(2,'0')}`;
  const headline=String(row.application||row.group_name||row.title||'').trim(),seen=new Set([headline]);
  const details=[row.title,row.url||row.document].map(v=>String(v||'').trim()).filter(v=>{if(!v||seen.has(v))return false;seen.add(v);return true;});
  const html=`<header><b>${attr(time(context.at))}</b><span>${attr(time(row.start))} – ${attr(time(row.end))} · ${elapsed}</span></header><section><b>${attr(headline)}</b>${details.map(v=>`<span>${attr(v)}</span>`).join('')}</section>`;
  const info=q('.mt-shot-info',preview);if(info.innerHTML!==html)info.innerHTML=html;
  const image=q('img',preview);image.hidden=!objectURL;
  if(objectURL&&image.getAttribute('src')!==objectURL){image.onload=position;image.src=objectURL;}
  model.shotMode=objectURL?'preview':'details';position();
 }
 function scope(){return JSON.stringify([model.day,model.data?.since,model.data?.until,model.query,auth,token]);}
 function metadata(){
  const key=scope();if(key!==indexKey){clearCache();indexKey=key;}
  if(indexPending)return indexPending;
  if(indexAt&&Date.now()-indexAt<60000)return Promise.resolve(index);
  const generation=epoch,params=new URLSearchParams({since:String(model.data.since),until:String(model.data.until),q:model.query});
  const task=apiCall('screenshots/index?'+params).then(value=>{if(generation!==epoch||key!==scope())return [];index=value.items;indexAt=Date.now();return index;}).finally(()=>{if(indexPending===task)indexPending=null;});
  indexPending=task;return task;
 }
 function nearest(items,value){
  let lo=0,hi=items.length;
  while(lo<hi){const m=(lo+hi)>>1;if(items[m].at<value.at)lo=m+1;else hi=m;}
  // Find the nearest frame inside this exact activity, including displays
  // captured at equal timestamps. Never substitute a neighbouring activity.
  let best=-1;for(const n of [lo-1,lo]){const shot=items[n];if(shot&&shot.at>=value.start&&shot.at<value.end&&(best<0||Math.abs(shot.at-value.at)<Math.abs(items[best].at-value.at)))best=n;}
  return best;
 }
 function thumbnail(shot){
  if(cache.has(shot.id)){const url=cache.get(shot.id);cache.delete(shot.id);cache.set(shot.id,url);return Promise.resolve(url);}
  if(inflight.has(shot.id))return inflight.get(shot.id);
  const generation=epoch;
  const task=fetch('/api/tracking/screenshots/thumbnail?id='+encodeURIComponent(shot.id),{headers:{Authorization:'Bearer '+token,'X-HotTurkey-Session':auth}}).then(async response=>{
   if(!response.ok)throw Error('无法读取截图');const blob=await response.blob();
   if(generation!==epoch||!available()||!context)return '';
   const url=URL.createObjectURL(blob);cache.set(shot.id,url);
   while(cache.size>24){const id=[...cache.keys()].find(id=>id!==loadedId&&id!==shot.id);if(!id)break;URL.revokeObjectURL(cache.get(id));cache.delete(id);}return url;
  }).finally(()=>{if(inflight.get(shot.id)===task)inflight.delete(shot.id);});
  inflight.set(shot.id,task);return task;
 }
 async function lookup(value,ticket){
  const key=scope(),items=await metadata();
  const valid=()=>ticket===sequence&&context?.id===value.id&&key===scope()&&available()&&model.shotMode!=='expanded';
  if(!valid())return;
  const n=nearest(items,value),shot=items[n];if(!shot){clearImage();paintPreview();return;}
  // Hide the previous frame immediately if the next one is not decoded yet.
  if(shot.id!==loadedId){clearImage();paintPreview();}
  const url=await thumbnail(shot);if(!valid()||!url)return;
  objectURL=url;loadedId=shot.id;model.shotURL=url;model.shot=shot;paintPreview();
  for(const next of [items[n-1],items[n+1]])if(next)thumbnail(next).catch(()=>{});
 }
 function hover(element,x,y){
  if(model.shotMode==='expanded'||!available())return;
  const node=eligible(element);let row=node&&model.data?.activities.find(v=>v.id===node.dataset.id);
  if(!node||!row){hide();return;}
  const plot=node.closest('.mt-track-plot'),rect=plot.getBoundingClientRect(),range=model.range||[model.data.since,model.data.until];
  const point=range[0]+(x-rect.left)/rect.width*(range[1]-range[0]);row=resolveBar?.(node.dataset.timeline,point,node.dataset.id)||row;
  const at=Math.max(row.start,Math.min(row.end-.001,point));
  if(context?.id!==row.id){sequence++;clearImage();}
  context={row,id:row.id,start:Math.max(row.start,model.data.since),end:Math.min(row.end,model.data.until),at,x,y,element:node};
  paintPreview();
  if(!['applications','computer'].includes(node.dataset.timeline))return;
  const value={...context},ticket=++sequence;
  pending=lookup(value,ticket).catch(error=>{if(ticket===sequence){hide();model.shotMessage=error.message;}});
 }
 async function fileAction(action,shot){
  try{
   if(window.webkit?.messageHandlers?.native){await HotTurkeyMediaBridge.request({action,id:shot.id});return;}
   if(action==='reveal')throw Error('请在桌面应用中操作');
   const response=await fetch('/api/tracking/screenshots/image?id='+encodeURIComponent(shot.id),{headers:{Authorization:'Bearer '+token,'X-HotTurkey-Session':auth}});
   if(!response.ok)throw Error('无法读取截图');const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=shot.id+(blob.type==='image/png'?'.png':blob.type==='image/webp'?'.webp':'.jpg');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){if(typeof toast==='function')toast(error.message);}
 }
 function expand(){
  if(!context||!available()||!['applications','computer'].includes(context.element.dataset.timeline))return false;
  const value={...context},key=scope();
  const loaded=model.shot&&objectURL?model.shot:null;
  // A known empty interval keeps its normal timeline click behaviour.
  if(!loaded&&indexKey===key&&indexAt&&nearest(index,value)<0)return false;
  origin=context.element;const previewURL=loaded?objectURL:'';sequence++;pending=null;pressed=null;removePreview();
  model.shotMode='expanded';model.shotMessage='';
  dialog=document.createElement('dialog');dialog.className='mt-shot-expanded';dialog.id='mt-shot-expanded';dialog.setAttribute('aria-label','屏幕截图');dialog.setAttribute('tabindex','-1');
  dialog.innerHTML='<button type="button" class="mt-shot-close" aria-label="关闭放大截图"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6"/></svg></button><div class="mt-shot-file-tools"><button type="button" data-shot-file="reveal" disabled>在访达中显示</button><button type="button" data-shot-file="save-as" disabled>另存为…</button></div><div class="mt-shot-large-image"><img '+(previewURL?'src="'+previewURL+'"':'hidden')+' alt="屏幕截图"></div><div class="mt-shot-large-caption">'+(loaded?attr(caption(loaded)):'')+'</div>';
  dialog.addEventListener('cancel',event=>event.preventDefault());q('.mt-shot-close',dialog).addEventListener('click',()=>close());
  dialog.addEventListener('click',event=>{const action=event.target.closest?.('[data-shot-file]')?.dataset.shotFile;if(action&&model.shot)fileAction(action,model.shot);});
  document.body.appendChild(dialog);dialog.showModal();dialog.focus({preventScroll:true});
  const current=dialog,valid=()=>dialog===current&&model.shotMode==='expanded'&&key===scope()&&available();
  const getShot=loaded?Promise.resolve(loaded):metadata().then(items=>items[nearest(items,value)]);
  getShot.then(async shot=>{
   if(!valid())return;
   if(!shot){close();return;}
   model.shot=shot;q('.mt-shot-large-caption',current).textContent=caption(shot);
   for(const action of ['reveal','save-as']){const button=q('[data-shot-file="'+action+'"]',current);if(button)button.disabled=false;}
   const response=await fetch('/api/tracking/screenshots/image?id='+encodeURIComponent(shot.id),{headers:{Authorization:'Bearer '+token,'X-HotTurkey-Session':auth}});
   if(!response.ok)throw Error('无法读取原图');const blob=await response.blob();if(!valid())return;
   originalURL=URL.createObjectURL(blob);const image=q('img',current);image.src=originalURL;image.hidden=false;
  }).catch(error=>{if(valid()){model.shotMessage=error.message;q('.mt-shot-large-caption',current).textContent=error.message;}});
  return true;
 }
 function close(restore=true){
  const focus=origin,wasOpen=model.shotMode==='expanded',old=dialog;dialog=null;origin=null;
  const release=()=>{old?.close();old?.remove();};
  if(old&&restore&&!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){old.classList.add('closing');setTimeout(release,140);}else release();
  if(originalURL)URL.revokeObjectURL(originalURL);originalURL='';
  model.shotMode='idle';cancelHover();clearImage();clearCache();indexAt=0;
  if(wasOpen&&restore&&focus?.isConnected)focus.focus({preventScroll:true});
 }
 document.addEventListener('focusin',event=>{if(pressed)return;const node=eligible(event.target);if(node){const r=node.getBoundingClientRect();hover(node,r.left+r.width/2,r.top+r.height/2);}});
 document.addEventListener('focusout',()=>{if(!pressed&&model.shotMode!=='expanded')hide();});
 document.addEventListener('pointermove',event=>{if(!event.buttons)hover(event.target,event.clientX,event.clientY);else if(pressed&&Math.hypot(event.clientX-pressed.x,event.clientY-pressed.y)>3)hide();},true);
 document.addEventListener('pointerout',event=>{if(!pressed&&model.shotMode!=='expanded'&&context&&!context.element.contains(event.relatedTarget))hide();});
 document.addEventListener('pointerdown',event=>{
  if(event.button!==0||model.shotMode==='expanded')return;
  const node=eligible(event.target);if(!node||!['applications','computer'].includes(node.dataset.timeline))return;
  // Focus and pointer capture can retarget the later click to the plot. Keep
  // the exact hovered frame through both events instead of seeking its centre.
  if(context?.element!==node)hover(node,event.clientX,event.clientY);
  if(context)pressed={id:model.shot?.id,x:event.clientX,y:event.clientY,element:node};
 },true);
 document.addEventListener('click',event=>{
  if(model.shotMode==='expanded')return;
  const node=eligible(event.target);
  if(!pressed&&node&&context?.element!==node)hover(node,event.clientX,event.clientY);
  const target=node===context?.element||pressed&&pressed.element.closest('.mt-track-plot')===event.target;
  if(target&&expand()){event.preventDefault();event.stopImmediatePropagation();}else pressed=null;
 },true);
 document.addEventListener('pointercancel',()=>{if(model.shotMode!=='expanded')hide();});
 document.addEventListener('keydown',event=>{if(model.shotMode==='expanded'){if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();}return;}if(event.key==='Enter'&&eligible(event.target)===context?.element&&expand()){event.preventDefault();event.stopImmediatePropagation();}},true);
 window.addEventListener('blur',()=>{if(model.shotMode!=='expanded')hide();});window.addEventListener('resize',()=>{if(model.shotMode!=='expanded')hide();});
 document.addEventListener('scroll',()=>{if(model.shotMode!=='expanded')hide();},{capture:true,passive:true});document.addEventListener('visibilitychange',()=>{if(document.hidden){close(false);}});
 function afterRender(){if(!available()){close(false);return;}if(indexKey&&indexKey!==scope()){close(false);return;}if(model.shotMode!=='expanded'&&context&&!context.element.isConnected)hide();}
 return {afterRender,suspend:()=>close(false),resetDay:()=>close(false),syncQuery:()=>close(false),restore(){},handles(){return false;},action(){},closed:()=>close(false),get pending(){return pending;}};
}};
