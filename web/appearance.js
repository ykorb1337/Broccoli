'use strict';
// Presentation only. Existing buttons remain the single source of actions.
(() => {
 const paths = {
  overview:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  shield:'M12 3 20 6v6c0 5-8 9-8 9s-8-4-8-9V6z M8.5 12l2.5 2.5 4.5-5',
  calendar:'M7 3v4 M17 3v4 M3 10h18 M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2 M7 14h2 M15 14h2 M7 18h2',
  chart:'M4 20V5 M4 20h17 M8 16v-5 M13 16V6 M18 16V9',
  settings:'M10 3h4l.7 2.5 2.3 1.3 2.5-.6 2 3.5-1.8 1.9v2.7l1.8 1.8-2 3.5-2.5-.6-2.3 1.3L14 23h-4l-.7-2.2L7 19.5l-2.5.6-2-3.5 1.8-1.8v-2.7L2.5 10l2-3.5 2.5.6 2.3-1.3z M15.5 13a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0',
  moon:'M20.5 14a8.7 8.7 0 0 1-10.8-10.8A9 9 0 1 0 20.5 14z',
  bed:'M3 18V7 M3 14h18v4 M3 11h18v3 M7 11V8h5v3 M12 11V8h5v3 M21 11v7',
  plus:'M12 5v14 M5 12h14', close:'M6 6l12 12 M18 6 6 18',
  copy:'M9 8V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3 M5 9h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2',
  download:'M12 3v12 M7 10l5 5 5-5 M4 15v5h16v-5',
  upload:'M12 16V4 M7 9l5-5 5 5 M4 15v5h16v-5',
  lock:'M7 10V7a5 5 0 0 1 10 0v3 M6 10h12v11H6z M12 14v3',
  reset:'M4 10a8 8 0 1 1 1 8 M4 4v6h6',
  trash:'M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14 M10 10v7 M14 10v7',
  folder:'M3 6h7l2 3h9v11H3z', app:'M4 4h16v16H4z M4 9h16 M9 9v11',
  application:'M7 3h10a2 2 0 0 1 2 2v2 M5 7h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2 M3 12h16 M7 9.5h.01 M10 9.5h.01',
  terminal:'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2 M7 9l3 3-3 3 M13 15h4',
  globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M5 6.5h14 M5 17.5h14 M12 3c-5 4-5 14 0 18 M12 3c5 4 5 14 0 18'
 };
 function icon(name) {
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','symbol');svg.setAttribute('aria-hidden','true');
  svg.dataset.symbol=name;svg.style.setProperty('--symbol-mask',`var(--symbol-${name})`);
  svg.innerHTML=`<path d="${paths[name]||paths.shield}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`;
  return svg;
 }
 const navigation={overview:'overview',blocks:'shield',schedule:'calendar',statistics:'chart',settings:'settings'};
 const buttons={new:['plus','新建拦截规则'],'new-device':['bed','新建睡眠计划'],duplicate:['copy','复制规则'],delete:['trash','删除规则'],close:['close','关闭'],
  export:['upload','导出规则'],'export-stats':['upload','导出统计'],import:['download','导入规则'],'calendar-add':['plus','添加时段'],
  'reset-pomodoro':['reset','重置番茄钟'],'pick-app':['application','选择应用'],'pick-folder':['folder','选择文件夹'],'pick-binary':['terminal','选择可执行文件']};
 const activityImages=new Map(),activityPending=new Set();
 function applyActivityImage(element){
  const target=element.dataset.activityTarget||'';
  const source=activityImages.get(target);
  if(source){
   const image=document.createElement('img');image.src=source;image.alt='';image.decoding='async';
   element.replaceChildren(image);element.classList.remove('application-monogram');element.dataset.iconSource='application';
  }
 }
 window.HotTurkeyActivityIcons={apply(values){
  if(!Array.isArray(values))return;
  for(const value of values){
   if(!value||typeof value.target!=='string'||!activityPending.has(value.target))continue;
   const source=typeof value.image==='string'&&value.image.length<=90000&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value.image)?value.image:null;
   activityImages.set(value.target,source);activityPending.delete(value.target);
  }
  if(activityImages.size>512){activityImages.clear();activityPending.clear();}
  document.querySelectorAll('.activity-icon[data-activity-kind="application"]').forEach(applyActivityImage);
 }};
 const websiteImages=new Map(),websitePending=new Set(),websiteRetries=new Map();
 function websiteHost(value){try{const u=new URL(value.includes('://')?value:'https://'+value);return ['http:','https:'].includes(u.protocol)?u.hostname.toLowerCase():'';}catch{return '';}}
 function paintWebsite(element){
  const host=websiteHost(element.dataset.activityTarget||''),source=websiteImages.get(host);
  if(source){const image=document.createElement('img');image.src=source;image.alt='';image.decoding='async';image.onerror=()=>{websiteImages.set(host,null);paintWebsite(element);};element.replaceChildren(image);element.classList.remove('website-monogram');element.dataset.iconSource='website';}
  else if(host){delete element.dataset.iconSource;element.textContent=Array.from(host.replace(/^www\./,''))[0].toUpperCase();element.classList.add('website-monogram');let hash=0;for(const c of host)hash=(hash*31+c.charCodeAt(0))|0;element.style.setProperty('--website-hue',Math.abs(hash)%360);}
  else element.replaceChildren(icon('globe'));
 }
 async function requestWebsites(hosts){
  const retry=new Set();
  try{const value=await api('tracking/website-icons',{targets:hosts});for(const item of value.items||[]){if(!hosts.includes(item.target))continue;const image=typeof item.image==='string'&&item.image.length<=90000&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(item.image)?item.image:null;if(!image&&item.retry_after===3)retry.add(item.target);else{websiteImages.set(item.target,image);websiteRetries.delete(item.target);}}}
  catch{for(const host of hosts)retry.add(host);}
  finally{
   const later=[];
   for(const host of hosts){const count=websiteRetries.get(host)||0;if(retry.has(host)&&count<4){websiteRetries.set(host,count+1);later.push(host);}else{websitePending.delete(host);if(!websiteImages.has(host))websiteImages.set(host,null);}}
   if(later.length)setTimeout(()=>{const visible=new Set([...document.querySelectorAll('.activity-icon[data-activity-kind="website"]')].map(el=>websiteHost(el.dataset.activityTarget||''))),needed=later.filter(host=>visible.has(host));for(const host of later)if(!visible.has(host))websitePending.delete(host);if(needed.length)requestWebsites(needed);},3200);
   if(websiteImages.size>512)websiteImages.clear();document.querySelectorAll('.activity-icon[data-activity-kind="website"]').forEach(paintWebsite);
  }
 }
 let pending=false,lastNative='';
 const semanticColors=new Set(['--bg','--panel','--ink','--muted','--line','--accent','--tint','--field','--hover','--green','--green-text','--green-tint','--danger','--warning','--warning-text','--warning-tint','--focus','--selection','--selection-ink','--primary-ink','--inactive-selection','--disabled','--link']);
 window.HotTurkeyAppearance={sync(){decorate();},apply(value){
  if(!window.HotTurkeyNativeShell||!value||typeof value!=='object')return;
  for(const [key,color] of Object.entries(value.colors||{}))if(semanticColors.has(key)&&typeof color==='string'&&CSS.supports('color',color))document.body.style.setProperty(key,color);
  let nativeSymbols=0;
  for(const [key,data] of Object.entries(value.symbols||{}))if(Object.prototype.hasOwnProperty.call(paths,key)&&typeof data==='string'&&data.length<65536&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data)){
   document.documentElement.style.setProperty(`--symbol-${key}`,`url("${data}")`);nativeSymbols++;
  }
  document.documentElement.classList.toggle('native-symbols',nativeSymbols===Object.keys(paths).length);
  for(const [key,name] of [['reduceMotion','reduce-motion'],['reduceTransparency','reduce-transparency'],['increaseContrast','increase-contrast']])document.documentElement.classList.toggle(name,value[key]===true);
  document.body.dataset.nativePalette='true';document.body.dataset.windowActive=String(value.active===true);
  schedule();
 }};
 let sheetPending=false;
 window.HotTurkeySheet={
  present(){if(sheetPending)return;sheetPending=true;window.webkit?.messageHandlers?.native?.postMessage({op:'present-editor'});},
  show(){sheetPending=false;document.documentElement.classList.add('native-sheet');const modal=document.querySelector('#modal');if(!modal.open)modal.showModal();decorate();},
  cancelPending(){if(sheetPending){sheetPending=false;window.webkit?.messageHandlers?.native?.postMessage({op:'cancel-editor'});}},
  cancel(){if(window.HotTurkeyModal)window.HotTurkeyModal.cancel();else document.querySelector('#modal [data-action="close"]')?.click();},
  fallback(){sheetPending=false;window.HotTurkeyNativeSheets=false;document.documentElement.classList.remove('native-sheet');const modal=document.querySelector('#modal');if(!modal.open)modal.showModal();schedule();}
 };
 function decorate() {
  pending=false;
  document.querySelectorAll('nav [data-page]').forEach(button=>{
   button.setAttribute('aria-current',button.classList.contains('selected')?'page':'false');
   if(button.dataset.decorated)return;
   [...button.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE).forEach(node=>node.remove());
   button.prepend(icon(navigation[button.dataset.page]));button.dataset.decorated='true';
  });
  document.querySelectorAll('.tabs>button').forEach(button=>{
   const selected=button.classList.contains('active');button.setAttribute('aria-pressed',String(selected));
   if(button.dataset.action==='editor-tab'){
    button.parentElement.setAttribute('role','tablist');button.setAttribute('role','tab');
    button.setAttribute('aria-selected',String(selected));button.setAttribute('aria-controls','editor-panel');button.tabIndex=selected?0:-1;
    button.id='editor-tab-'+button.dataset.tab;
    const panel=document.querySelector('#editor-panel');if(panel&&selected){panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);}
   }
  });
  document.querySelectorAll('[data-action]').forEach(button=>{
   const spec=buttons[button.dataset.action];if(!spec||button.dataset.decorated)return;
   const label=button.textContent.replace(/^[＋+↑↓↻×⧉◴]\s*/, '');
   if(button.children.length)return;
   button.textContent=label;button.prepend(icon(spec[0]));button.dataset.decorated='true';
   if(!label)button.setAttribute('aria-label',button.title||spec[1]);
  });
  document.querySelectorAll('.block-icon,.hero-icon').forEach(element=>{
   if(element.dataset.decorated)return;
   const name=element.classList.contains('hero-icon')?'shield':element.dataset.device==='sleep'?'bed':element.textContent==='◴'?'lock':element.textContent==='▦'?'calendar':'shield';
   element.replaceChildren(icon(name));element.dataset.decorated='true';
  });
  const requested=[],websites=[];
  document.querySelectorAll('.activity-icon:not([data-decorated])').forEach(element=>{
   element.dataset.decorated='true';
   if(element.dataset.activityKind==='website'){paintWebsite(element);const host=websiteHost(element.dataset.activityTarget||'');if(host&&!websiteImages.has(host)&&!websitePending.has(host)){websitePending.add(host);websites.push(host);}return;}
   const target=element.dataset.activityTarget||'';
   element.textContent=Array.from(target.replace(/^bundle:/,''))[0]?.toLocaleUpperCase()||'·';
   element.classList.add('application-monogram');
   applyActivityImage(element);
   if(target&&!activityImages.has(target)&&!activityPending.has(target)&&window.webkit?.messageHandlers?.native){
    activityPending.add(target);requested.push(target);
   }
  });
  for(let i=0;i<websites.length;i+=100)requestWebsites(websites.slice(i,i+100));
  if(requested.length)window.webkit.messageHandlers.native.postMessage({op:'application-icons',targets:requested.slice(0,100)});
  document.querySelectorAll('.tag').forEach(element=>{
   if(element.dataset.decorated||!element.textContent.startsWith('♧'))return;
   element.textContent=element.textContent.replace(/^♧\s*/, '');element.prepend(icon('lock'));element.dataset.decorated='true';
  });
  const page=document.querySelector('nav .selected')?.dataset.page||'overview';document.body.dataset.view=page;
  if(page==='settings')document.querySelectorAll('#content>.panel:not(.settings-group)').forEach(section=>{
   const title=section.querySelector(':scope>h2');if(!title)return;
   const group=document.createElement('div');group.className='settings-group-body';
   section.classList.add('settings-group');
   [...section.childNodes].filter(node=>node!==title).forEach(node=>group.appendChild(node));section.appendChild(group);
  });
  if(!window.HotTurkeyNativeShell)return;
  const value={op:'appearance',page,dark:document.body.classList.contains('dark'),theme:document.body.dataset.appearance||'system',paletteReady:document.body.dataset.nativePalette==='true',canManage:typeof canManage==='function'&&canManage()&&state?.authenticated===true,textScale:window.HotTurkeyTextSize?.value||100,
   connection:document.querySelector('#connection')?.textContent||'',connected:!document.querySelector('#connection')?.classList.contains('bad'),
   modal:Boolean(document.querySelector('dialog[open]')),actions:['new-device','new','export-stats'].filter(action=>document.querySelector(`#header-actions [data-action="${action}"]`))};
  if(document.querySelector('#modal')?.open&&window.HotTurkeyNativeSheets){
   const scale=Number(document.body.style.zoom)||1,modal=document.querySelector('#modal');
   const height=selector=>modal.querySelector(selector)?.getBoundingClientRect().height||0;
   const padding=parseFloat(getComputedStyle(modal.querySelector('.modal-content')).paddingBottom)||0;
   value.modalWidth=Math.min(16000,(parseFloat(getComputedStyle(modal).getPropertyValue('--modal-width'))||720)*scale);value.modalHeight=Math.min(16000,Math.max(160,height('.modal-head')+height('.modal-inner')+height('.modal-footer')+padding*scale));
   const preferredHeight=parseFloat(getComputedStyle(modal).getPropertyValue('--modal-height'));if(preferredHeight)value.modalHeight=preferredHeight*scale;
   const picker=modal.querySelector('.gc-picker-popover');if(picker)value.modalHeight=Math.max(value.modalHeight,(picker.scrollHeight+22)*scale);
   value.modalTitle=modal.querySelector('.modal-head h2')?.textContent||'编辑';
  }
  const key=JSON.stringify(value);if(key!==lastNative){lastNative=key;window.webkit?.messageHandlers?.native?.postMessage(value);}
 }
 function schedule(){if(!pending){pending=true;requestAnimationFrame(decorate);}}
 window.addEventListener('resize',schedule);
 document.addEventListener('hotturkey:text-size',schedule);
 new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','open','hidden','data-appearance']});
 decorate();
})();
