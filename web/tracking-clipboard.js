'use strict';
window.HotTurkeyClipboard=(()=>{
 const pending=new Map();let sequence=0;
 async function write(text,authorized=()=>true){
  if(!authorized())return false;
  const bridge=window.webkit?.messageHandlers?.native;
  if(bridge){
   const request='copy-'+Date.now()+'-'+(++sequence);
   return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{pending.delete(request);reject(Error('复制未完成，请重试'));},10000);
    pending.set(request,{resolve,reject,timeout});bridge.postMessage({op:'tracking-copy',request,text});
   });
  }
  if(!navigator.clipboard?.writeText)throw Error('当前浏览器无法复制，请使用文件导出');
  await navigator.clipboard.writeText(text);return true;
 }
 function receive(value){const item=pending.get(value.request);if(!item)return;pending.delete(value.request);clearTimeout(item.timeout);if(value.ok)item.resolve(true);else item.reject(Error('复制失败，请使用文件导出'));}
 return {write,receive};
})();
