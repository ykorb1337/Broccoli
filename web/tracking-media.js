'use strict';
// Screenshots follow a timeline hover; enlarging pins the exact displayed frame.
window.HotTurkeyMedia={create({model,apiCall,attr,time,resolveBar}){
 const q=(s,r=document)=>r.querySelector(s);
 let sequence=0,timer=null,context=null,loadedId='',objectURL='',pending=null,pressed=null,dialog=null,preview=null,origin=null;
 Object.assign(model,{shot:null,shotMode:'idle',shotURL:'',shotMessage:''});
 const scale=()=>Number(document.body.style.zoom)||1;
 const available=()=>page==='statistics'&&['day','untagged'].includes(model.view)&&!modal.open;
 function eligible(element){return element?.closest?.('.mt-activity');}
 function clearImage(){if(objectURL)URL.revokeObjectURL(objectURL);objectURL='';loadedId='';model.shotURL='';model.shot=null;}
 function removePreview(){preview?.remove();preview=null;}
 function cancelHover(){sequence++;clearTimeout(timer);timer=null;pending=null;pressed=null;context=null;removePreview();}
 function hide(){if(model.shotMode==='expanded')return;cancelHover();clearImage();model.shotMode='idle';}
 function caption(shot){return time(shot.at)+' · '+shot.application;}
 function position(){
  if(!preview||!context)return;
  const zoom=scale(),r=preview.getBoundingClientRect(),bar=context.element.getBoundingClientRect();
  const x=Math.max(8,Math.min(innerWidth-r.width-8,context.x+16));
  const below=bar.bottom+10,y=below+r.height<=innerHeight-8?below:Math.max(8,bar.top-r.height-10);
  preview.style.left=x/zoom+'px';preview.style.top=y/zoom+'px';
 }
 function paintPreview(){
  if(!context||model.shotMode==='expanded'||!available())return;
  if(!preview){preview=document.createElement('div');preview.className='mt-shot-preview';preview.setAttribute('role','tooltip');preview.id='mt-shot-preview';document.body.appendChild(preview);}
  const row=context.row,duration=Math.max(0,Math.round(row.end-row.start)),elapsed=`${Math.floor(duration/3600)}:${String(Math.floor(duration%3600/60)).padStart(2,'0')}:${String(duration%60).padStart(2,'0')}`;
  const headline=String(row.application||row.group_name||row.title||'').trim(),seen=new Set([headline]);
  const details=[row.title,row.url||row.document].map(v=>String(v||'').trim()).filter(v=>{if(!v||seen.has(v))return false;seen.add(v);return true;});
  const html=`<header><b>${attr(time(context.at))}</b><span>${attr(time(row.start))} – ${attr(time(row.end))} · ${elapsed}</span></header><section><b>${attr(headline)}</b>${details.map(value=>`<span>${attr(value)}</span>`).join('')}</section>`+(objectURL?`<img src="${objectURL}" alt="屏幕截图预览">`:'');
  if(preview.innerHTML!==html)preview.innerHTML=html;
  const image=q('img',preview);if(image){image.onload=()=>{if(preview)position();};image.onerror=()=>{if(model.shotMode!=='expanded'){clearImage();paintPreview();}};}
  model.shotMode=objectURL?'preview':'details';position();
 }
 async function lookup(value,ticket){
  const query=model.query,day=model.day;
  const params=new URLSearchParams({since:String(value.start),until:String(value.end),at:String(value.at),q:query,limit:'1'});
  const response=await apiCall('screenshots?'+params);
  const valid=()=>ticket===sequence&&context?.id===value.id&&day===model.day&&query===model.query&&available()&&model.shotMode!=='expanded';
  if(!valid())return;
  const shot=response.items[0];
  if(!shot){clearImage();paintPreview();return;}
  if(shot.id!==loadedId||!objectURL){
   const response=await fetch('/api/tracking/screenshots/image?id='+encodeURIComponent(shot.id),{headers:{Authorization:'Bearer '+token,'X-HotTurkey-Session':auth}});
   if(!response.ok)throw Error('无法读取截图');const blob=await response.blob();if(!valid())return;
   const url=URL.createObjectURL(blob);if(objectURL)URL.revokeObjectURL(objectURL);objectURL=url;loadedId=shot.id;model.shotURL=url;
  }
  model.shot=shot;paintPreview();
 }
 function hover(element,x,y){
  if(model.shotMode==='expanded'||!available())return;
  const node=eligible(element);let row=node&&model.data?.activities.find(v=>v.id===node.dataset.id);
  if(!node||!row){hide();return;}
  const plot=node.closest('.mt-track-plot'),rect=plot.getBoundingClientRect(),range=model.range||[model.data.since,model.data.until];
  const point=range[0]+(x-rect.left)/rect.width*(range[1]-range[0]);row=resolveBar?.(node.dataset.timeline,point,node.dataset.id)||row;
  const at=Math.max(row.start,Math.min(row.end-.001,point));
  if(context?.id!==row.id){cancelHover();clearImage();model.shotMode='idle';}
  context={row,id:row.id,start:Math.max(row.start,model.data.since),end:Math.min(row.end,model.data.until),at,x,y,element:node};
  position();
  if(timer)return;
  timer=setTimeout(()=>{
   timer=null;if(!context||model.shotMode==='expanded')return;
   paintPreview();if(!['applications','computer'].includes(node.dataset.timeline))return;
   const value={...context},ticket=++sequence;
   pending=lookup(value,ticket).catch(error=>{if(ticket===sequence){hide();model.shotMessage=error.message;}});
  },140);
 }
 function expand(){
  if(model.shotMode!=='preview'||!preview||!q('img',preview)?.complete||!q('img',preview)?.naturalWidth||!model.shot||!objectURL)return false;
  origin=context?.element;const shot=model.shot,url=objectURL;sequence++;clearTimeout(timer);timer=null;pending=null;pressed=null;removePreview();
  model.shotMode='expanded';model.shotMessage='';
  dialog=document.createElement('dialog');dialog.className='mt-shot-expanded';dialog.id='mt-shot-expanded';dialog.setAttribute('aria-label','屏幕截图');
  dialog.innerHTML='<button type="button" class="mt-shot-close" aria-label="关闭放大截图"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6"/></svg></button><div class="mt-shot-large-image"><img src="'+url+'" alt="'+attr(caption(shot))+'"></div><div class="mt-shot-large-caption">'+attr(caption(shot))+'</div>';
  dialog.addEventListener('cancel',event=>event.preventDefault());
  q('.mt-shot-close',dialog).addEventListener('click',()=>close());
  document.body.appendChild(dialog);dialog.showModal();q('.mt-shot-close',dialog).focus({preventScroll:true});
  return true;
 }
 function close(restore=true){
  const focus=origin,wasOpen=model.shotMode==='expanded';dialog?.close();dialog?.remove();dialog=null;origin=null;
  model.shotMode='idle';cancelHover();clearImage();
  if(wasOpen&&restore&&focus?.isConnected)focus.focus({preventScroll:true});
 }
 document.addEventListener('focusin',event=>{const node=eligible(event.target);if(node){const r=node.getBoundingClientRect();hover(node,r.left+r.width/2,r.top+r.height/2);}});
 document.addEventListener('focusout',()=>{if(model.shotMode!=='expanded')hide();});
 document.addEventListener('pointermove',event=>{
  if(!event.buttons)hover(event.target,event.clientX,event.clientY);
  else if(pressed&&Math.hypot(event.clientX-pressed.x,event.clientY-pressed.y)>3)hide();
 },true);
 document.addEventListener('pointerout',event=>{if(!pressed&&model.shotMode!=='expanded'&&context&&!context.element.contains(event.relatedTarget))hide();});
 document.addEventListener('pointerdown',event=>{
  if(event.button===0&&model.shotMode==='preview'&&eligible(event.target)===context?.element){pressed={id:model.shot?.id,x:event.clientX,y:event.clientY};sequence++;clearTimeout(timer);timer=null;}
 },true);
 document.addEventListener('click',event=>{
  const target=eligible(event.target)===context?.element||pressed&&context?.element.closest('.mt-track-plot')===event.target;
  if(target&&model.shotMode==='preview'&&(!pressed||pressed.id===model.shot?.id)&&expand()){event.preventDefault();event.stopImmediatePropagation();}
 },true);
 document.addEventListener('pointercancel',()=>{if(model.shotMode!=='expanded')hide();});
 document.addEventListener('keydown',event=>{
  if(model.shotMode==='expanded'){
   if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();}
   return;
  }
  if(event.key==='Enter'&&eligible(event.target)===context?.element&&expand()){event.preventDefault();event.stopImmediatePropagation();}
 },true);
 window.addEventListener('blur',()=>{if(model.shotMode!=='expanded')hide();});
 window.addEventListener('resize',()=>{if(model.shotMode!=='expanded')hide();});
 document.addEventListener('scroll',()=>{if(model.shotMode!=='expanded')hide();},{capture:true,passive:true});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)hide();});
 function afterRender(){if(!available()){close(false);return;}if(model.shotMode!=='expanded'&&context&&!context.element.isConnected)hide();}
 return {afterRender,suspend:()=>close(false),resetDay:()=>close(false),syncQuery(){if(model.shotMode!=='expanded')hide();},restore(){},handles(){return false;},action(){},closed:()=>close(false),get pending(){return pending;}};
}};
