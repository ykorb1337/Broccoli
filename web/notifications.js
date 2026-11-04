'use strict';
window.HotTurkeyNotifications=(()=>{
 const pending=new Map();let serial=0,permission=null,busy=false;
 const native=()=>window.HotTurkeyNativeShell&&window.webkit?.messageHandlers?.native;
 function request(mode){
  const id='notice-'+(++serial);
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('无法读取通知权限'));},15000);pending.set(id,{resolve,timer});native().postMessage({op:'notification-permission',request:id,mode});});
 }
 function paint(){
  const granted=!native()||permission===true,master=!!state.settings.notifications;
  for(const [id,key] of [['notifications-toggle','notifications'],['calendar-notifications-toggle','calendar_notifications']]){
   const input=document.querySelector('#'+id);if(!input)continue;
   input.checked=!!state.settings[key]&&granted;input.disabled=busy||!!native()&&permission===null||key==='calendar_notifications'&&!master;
   input.title=key==='calendar_notifications'&&!master?'请先开启 macOS 通知':'';
  }
 }
 async function refresh(){if(!native()){paint();return;}try{const result=await request('status');permission=result.granted;paint();}catch{permission=false;paint();}}
 async function change(input,key='notifications'){
  if(busy)return;const enabled=input.checked;busy=true;paint();
  try{
   if(enabled&&native()){permission=(await request('request')).granted;if(!permission){toast('请在系统设置中允许 Broccoli 通知。');return;}}
   await api('settings',{[key]:enabled});await window.refresh();
  }catch(error){toast(error.message);}finally{busy=false;paint();}
 }
 document.addEventListener('change',async event=>{
  const input=event.target;
  if(input.id==='notifications-toggle')change(input);
  if(input.id==='calendar-notifications-toggle')change(input,'calendar_notifications');
  if(input.id==='calendar-reminder-minutes'){
   try{const values=input.value.trim()?input.value.split(/[,，]/).map(v=>v.trim()?Number(v):NaN):[];if(values.some(v=>!Number.isInteger(v)||v<0||v>40320))throw Error('请输入逗号分隔的提醒分钟');await api('settings',{calendar_reminder_minutes:values});await window.refresh();}
   catch(error){input.value=(state.settings.calendar_reminder_minutes||[10]).join(',');toast(error.message);}
  }
 });
 window.addEventListener('focus',()=>{if(document.querySelector('#notifications-toggle'))refresh();});
 return {mount:refresh,refresh,receive(value){const item=pending.get(value.request);if(!item)return;clearTimeout(item.timer);pending.delete(value.request);item.resolve({granted:value.granted===true});}};
})();
