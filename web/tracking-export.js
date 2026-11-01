'use strict';
window.HotTurkeyActivityExport={create({model,attr,button,select,names,dateInput}){
 const q=(s,r=document)=>r.querySelector(s);let sequence=0,busy=false;
 function open(){
  const now=new Date(),start=new Date(now);start.setHours(0,0,0,0);busy=false;
  openModal('导出统计',`<div class="mt-export-fields">${sheetGroup('',field('开始',`<input id="mt-activity-export-start" type="datetime-local" step="1" aria-label="导出开始时间" value="${dateInput(+start/1000)}">`)+field('结束',`<input id="mt-activity-export-end" type="datetime-local" step="1" aria-label="导出结束时间" value="${dateInput(+now/1000)}">`))}${sheetGroup('',field('内容',select('mt-activity-export-timeline',{all:'所有时间线',...names},model.timeline))+field('格式',select('mt-activity-export-format',{csv:'CSV',xlsx:'Excel',json:'JSON'},'csv'))+(model.query?field('筛选',`<input id="mt-activity-export-query" aria-label="导出筛选条件" value="${attr(model.query)}">`):''))}</div>`,button('close','取消')+button('activity-export-submit','导出','','primary'),'export');
 }
 async function submit(){
  if(busy)return;const marker=q('#mt-activity-export-start');if(!marker)return;
  const since=new Date(marker.value).getTime()/1000,until=new Date(q('#mt-activity-export-end').value).getTime()/1000;
  if(!Number.isFinite(since)||!Number.isFinite(until)||until<=since)throw Error('结束时间需晚于开始时间');
  const format=q('#mt-activity-export-format').value,view=model.view,day=model.day,payload={kind:'activities',format,definition:{since,until,timeline:q('#mt-activity-export-timeline').value,query:q('#mt-activity-export-query')?.value||'',untagged:view==='untagged'}};
  const ticket=++sequence,authorized=()=>ticket===sequence&&state.authenticated===true&&page==='statistics'&&model.view===view&&model.day===day;
  const owns=()=>authorized()&&modal.open&&q('#mt-activity-export-start')===marker,control=q('[data-mt=activity-export-submit]',modal);busy=true;if(control)control.disabled=true;
  try{
   const response=await fetch('/api/tracking/export',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-HotTurkey-Session':auth},body:JSON.stringify(payload)});
   if(!owns())return;if(!response.ok)throw Error((await response.json()).error||'导出失败');const blob=await response.blob();if(!owns())return;
   closeModal();const deadline=Date.now()+4000;
   while(document.documentElement.classList.contains('native-sheet')){if(Date.now()>deadline)throw Error('请关闭编辑窗口后重试导出');await new Promise(resolve=>setTimeout(resolve,30));}
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));if(!authorized()||modal.open)return;
   const name=at=>dateInput(at).replace('T','_').replace(/:/g,'-'),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='HotTurkey-'+name(since)+'_'+name(until)+'.'+format;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){if(authorized()&&(owns()||!modal.open))throw error;}finally{if(ticket===sequence)busy=false;if(control?.isConnected)control.disabled=false;}
 }
 return {open,handles:op=>op==='activity-export-submit',action:submit,suspend(){sequence++;busy=false;}};
}};
