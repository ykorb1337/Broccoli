'use strict';
// File access is resolved from registered screenshot IDs by the native bridge.
window.HotTurkeyMediaBridge=(()=>{
 const waiting=new Map();let serial=0;
 function request(op,value){
  if(!window.webkit?.messageHandlers?.native) return Promise.reject(Error('请在桌面应用中操作'));
  const request='shot-'+Date.now()+'-'+(++serial);
  return new Promise((resolve,reject)=>{waiting.set(request,{resolve,reject});window.webkit.messageHandlers.native.postMessage({...value,op,request,session:auth});});
 }
 return {request:value=>request('tracking-media',value),directory:action=>request('tracking-directory',{action}),receive(value){const item=waiting.get(value.request);if(!item)return;waiting.delete(value.request);if(value.ok)item.resolve(value);else item.reject(Error(value.error||'操作失败'));}};
})();
