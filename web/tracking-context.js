'use strict';
window.HotTurkeyTrackingContext=(()=>{
 const paths={open:'M14 4h6v6M20 4 10 14M10 5H5v14h14v-5',copy:'M9 9h11v11H9zM15 5V3H3v12h2',info:'M12 11v6M12 7h.01',locate:'M4 5v14M20 5v14M8 12h8m-3-3 3 3-3 3',select:'m5 12 4 4L19 6',tag:'M3 3h8l10 10-8 8L3 11ZM7 7h.01',filter:'M4 5h16l-6 7v7l-4-2v-5Z',color:'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4 2 2 0 0 1 1-4h3a3 3 0 0 0 3-3 9 9 0 0 0-9-7ZM7 9h.01M11 6h.01M16 7h.01M6 14h.01',trash:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',file:'M14 3H5v18h14V8ZM14 3v6h5',export:'M12 3v12m-4-8 4-4 4 4M5 13v8h14v-8'};
 const icon=key=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[key]||paths.info}"/></svg>`;
 function resource(context){
  if(context.rows[0]?.timeline!=='documents')return null;
  if(context.group)return null;
  const row=context.rows[0],identity=HotTurkeyDayData.documentIdentity(row,true);
  if(!identity)return null;
  if(identity.website){
   try{const url=new URL(identity.website);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)return {kind:'website',value:url.href};}catch{}
  }
  if(identity.kind==='file')return {kind:'file',value:identity.key.slice(5)};
  return null;
 }
 function records(context){
  const selected=new Map();
  for(const row of context.rows){
   const ranges=HotTurkeyDayData.ranges(row),ids=row.activity_ids||[row.original_id||row.id];
   for(const id of ids){
    const key=row.timeline+'\0'+id;
    if(!selected.has(key))selected.set(key,{timeline:row.timeline,id,ranges:[]});
    selected.get(key).ranges.push(...ranges);
   }
  }
  return [...selected.values()].map(row=>({...row,ranges:HotTurkeyDayData.union(row.ranges)}));
 }
 function query(context){
  const row=context.rows[0],resource=HotTurkeyDayData.documentIdentity(row,true);
  const escape=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/"/g,'\\"');
  if(context.row?.domain)return 'url:#"^https?://(?:[^/]+\\.)?'+escape(context.row.domain)+'(?::[0-9]+)?(?:[/?#]|$)"';
  if(row.url)return 'url:#"^'+escape(row.url)+'$"';
  if(resource?.kind==='file')return 'file:'+JSON.stringify(resource.key.slice(5));
  return 'title:'+JSON.stringify(row.title||row.group_name||'');
 }
 function options(context){
  const target=resource(context),first=context.rows[0],items=[];
  const add=(id,label,icon,group=0)=>items.push({id,label,icon,group});
  if(target?.kind==='website')add('open','在浏览器中打开','open');
  if(target?.kind==='file')add('reveal','在访达中显示','file');
  add('copy-name','复制名称','copy');
  if(target)add('copy-resource',target.kind==='website'?'复制网址':'复制文件路径','copy');
  add('copy-records','复制记录','copy');
  add('details','查看详情','info',1);
  add('locate','在时间线中定位','locate',1);
  add('select','选择这些时段','select',1);
  add('tag','添加标签…','tag',1);
  if(first?.timeline==='tags'&&context.rows.length===1)add('edit-tag','编辑标签…','tag',1);
  if(first?.timeline==='autotags')add('auto-source','查看自动标签来源…','info',1);
  add('filter',context.group?'仅显示此分组':'筛选相同条目','filter',2);
  if(context.group&&!context.group.unknownBrowser)add('color','更改颜色…','color',2);
  add('export','导出记录（CSV）','export',2);
  if(first?.timeline!=='autotags')add('delete','删除这些记录…','trash',3);
  return items;
 }
 function create({run,authorized}){
  let menu=null,origin=null,highlight=null;
  function close(restore=false){
   const old=menu;menu=null;delete document.body.dataset.trackingMenu;
   highlight?.classList.remove('mt-menu-target');highlight=null;
   if(old){if(old.matches(':popover-open'))old.hidePopover();old.remove();}
   if(restore&&origin?.isConnected)origin.focus({preventScroll:true});
  }
  function show(context,x,y,focus){
   close();if(!authorized()||!context?.rows?.length)return;
   origin=focus;menu=document.createElement('div');menu.className='mt-record-menu';menu.setAttribute('popover','auto');menu.setAttribute('role','menu');menu.setAttribute('aria-label',context.title+'的操作');
   highlight=focus?.closest('.mt-summary-row,.mt-detail-row');highlight?.classList.add('mt-menu-target');
   const title=document.createElement('div');title.className='mt-record-menu-title';title.textContent=context.title;menu.append(title);
   let previous=-1;
   for(const item of options(context)){
    if(previous>=0&&item.group!==previous){const line=document.createElement('div');line.className='mt-record-menu-divider';line.setAttribute('role','separator');menu.append(line);}previous=item.group;
    const button=document.createElement('button');button.type='button';button.setAttribute('role','menuitem');button.dataset.recordAction=item.id;button.innerHTML=icon(item.icon);const label=document.createElement('span');label.textContent=item.label;button.append(label);if(item.id==='delete')button.className='destructive';
    button.onclick=()=>{close();if(authorized())Promise.resolve(run(item.id,context)).catch(error=>toast(error.message));};menu.append(button);
   }
   const current=menu;menu.addEventListener('toggle',()=>{if(menu===current&&!current.matches(':popover-open'))close();});
   document.body.append(menu);document.body.dataset.trackingMenu='open';menu.showPopover();
   const box=menu.getBoundingClientRect(),zoom=Number(document.body.style.zoom)||1;
   menu.style.left=Math.max(8,Math.min(x,innerWidth-box.width-8))/zoom+'px';menu.style.top=Math.max(8,Math.min(y,innerHeight-box.height-8))/zoom+'px';
   menu.querySelector('button')?.focus({preventScroll:true});
  }
  document.addEventListener('keydown',event=>{
   if(!menu)return;
   if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close(true);return;}
   const keys=['ArrowDown','ArrowUp','Home','End'];if(!keys.includes(event.key))return;
   event.preventDefault();event.stopImmediatePropagation();const buttons=[...menu.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);
   const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();
  },true);
  document.addEventListener('scroll',event=>{if(menu&&!menu.contains(event.target))close();},true);
  window.addEventListener('resize',()=>close());window.addEventListener('blur',()=>close());
  return {show,close};
 }
 return {create,resource,records,options,query};
})();
