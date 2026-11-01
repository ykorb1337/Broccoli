'use strict';
window.HotTurkeyNotifications=(()=>{
 const pending=new Map();let serial=0,permission=null,busy=false;
 const native=()=>window.HotTurkeyNativeShell&&window.webkit?.messageHandlers?.native;
 function request(mode){
  const id='notice-'+(++serial);
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('无法读取通知权限'));},15000);pending.set(id,{resolve,timer});native().postMessage({op:'notification-permission',request:id,mode});});
 }
 function paint(){const input=document.querySelector('#notifications-toggle');if(!input)return;input.checked=!!state.settings.notifications&&(!native()||permission===true);input.disabled=busy||!!native()&&permission===null;}
 async function refresh(){if(!native()){paint();return;}try{const result=await request('status');permission=result.granted;paint();}catch{permission=false;paint();}}
 async function change(input){
  if(busy)return;const enabled=input.checked;busy=true;paint();
  try{
   if(enabled&&native()){permission=(await request('request')).granted;if(!permission){toast('请在系统设置中允许 HotTurkey 通知。');return;}}
   await api('settings',{notifications:enabled});await window.refresh();
  }catch(error){toast(error.message);}finally{busy=false;paint();}
 }
 document.addEventListener('change',event=>{if(event.target.id==='notifications-toggle')change(event.target);});
 window.addEventListener('focus',()=>{if(document.querySelector('#notifications-toggle'))refresh();});
 return {mount:refresh,refresh,receive(value){const item=pending.get(value.request);if(!item)return;clearTimeout(item.timer);pending.delete(value.request);item.resolve({granted:value.granted===true});}};
})();
