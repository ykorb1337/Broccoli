'use strict';
window.HotTurkeyFind={create({model,apiCall,render,attr,button,names,length,tagTools,jumpTo}){
 const q=(s,r=document)=>r.querySelector(s),date=at=>new Date(at*1000).toLocaleDateString('en-CA'),stamp=at=>new Date(at*1000).toLocaleString('zh-CN',{hour12:false});
 let draft=null,data=null,dirty=false,loading=false,busy=false,error='',sequence=0,exportSequence=0,editor=null,selection={all:false,keys:new Set()},sort='start',direction='asc',format='csv',scope='all';
 const active=()=>page==='statistics'&&model.view==='search'&&state.authenticated===true;
 const selectedCount=()=>data?(selection.all?data.total-selection.keys.size:selection.keys.size):0;
 const wire=()=>({all:selection.all,keys:[...selection.keys]});
 const ready=()=>data&&!loading&&!busy&&!dirty&&!data.errors.length;
 function open(){if(!draft){const d=new Date(model.day+'T00:00:00');d.setDate(d.getDate()-6);draft={from:d.toLocaleDateString('en-CA'),through:model.day,timeline:model.timeline,query:model.query,untagged:false};}model.view='search';model.report=null;model.seq++;model.loading=false;model.error='';model.queryError='';render();}
 function definition(){const a=new Date(draft.from+'T00:00:00'),b=new Date(draft.through+'T00:00:00');b.setDate(b.getDate()+1);if(!Number.isFinite(+a)||!Number.isFinite(+b)||b<=a)throw Error('请选择有效的起止日期');return {since:+a/1000,until:+b/1000,timeline:draft.timeline,query:draft.query,untagged:draft.untagged};}
 async function run(){
  const ticket=++sequence;exportSequence++;loading=true;error='';dirty=true;render();
  try{const value=await apiCall('search/render',{definition:definition()});if(ticket!==sequence||!active())return;data=value;dirty=false;sort='start';direction='asc';selection={all:false,keys:new Set()};}
  catch(caught){if(ticket!==sequence||!active())return;error=caught.message;}
  finally{if(ticket===sequence&&active()){loading=false;render();}}
 }
 async function pageTo(offset,nextSort=sort,nextDirection=direction){
  if(!data||loading||dirty)return;const root=data,ticket=++sequence;exportSequence++;loading=true;error='';render();
  try{const value=await apiCall('search/page',{snapshot:root.snapshot,offset,limit:100,sort:nextSort,direction:nextDirection});if(ticket!==sequence||!active())return;data=value;sort=nextSort;direction=nextDirection;}
  catch(caught){if(ticket===sequence&&active())error=caught.message;}
  finally{if(ticket===sequence&&active()){loading=false;render();}}
 }
 function select(id,label,values,value){return `<select id="${id}" aria-label="${label}">${Object.entries(values).map(([key,name])=>`<option value="${key}" ${value===key?'selected':''}>${attr(name)}</option>`).join('')}</select>`;}
 function icon(row){return row.application?`<span class="activity-icon" data-activity-kind="application" data-activity-target="${attr(row.bundle?'bundle:'+row.bundle:row.application)}" aria-hidden="true"></span>`:`<span class="mt-color" style="--item-color:${attr(row.color)}" aria-hidden="true"></span>`;}
 function html(){
  if(!draft)return '';
  const controls=`<div class="mt-find-controls"><label for="mt-find-timeline">时间线</label>${select('mt-find-timeline','搜索时间线',{all:'所有本地时间线',...names},draft.timeline)}<label for="mt-find-query">筛选</label><input id="mt-find-query" type="search" aria-label="高级搜索条件" value="${attr(draft.query)}" placeholder="标题、分组或组合条件"><label for="mt-find-from">从</label><input id="mt-find-from" type="date" aria-label="搜索开始日期" value="${attr(draft.from)}"><label for="mt-find-through">至</label><input id="mt-find-through" type="date" aria-label="搜索结束日期" value="${attr(draft.through)}"><label class="mt-find-untagged"><input id="mt-find-untagged" type="checkbox" ${draft.untagged?'checked':''}>仅未标记时间</label>${button('find-run',loading?'搜索中…':'搜索',loading?'disabled':'','primary')}</div>`;
  const message=error?`<div class="mt-find-message" role="alert">${attr(error)}</div>`:data?.errors?.length?`<div class="mt-find-message" role="alert">自动标签存在 ${data.errors.length} 项计算错误，请修正后重新搜索。</div>`:'';
  if(!data)return `<section class="mt-find">${controls}${message}<div class="mt-empty">选择时间线和日期范围后搜索</div></section>`;
  const header=(key,label)=>`<th scope="col" aria-sort="${key===sort?(direction==='asc'?'ascending':'descending'):'none'}">${button('find-sort',label+(key===sort?(direction==='asc'?' ↑':' ↓'):''),`data-key="${key}"`,'mt-sort')}</th>`;
  const rows=data.items.map(row=>`<tr data-find-row="${row.key}"><td><input type="checkbox" data-find-check="${row.key}" aria-label="选择搜索结果 ${attr(row.display_title)}" ${selection.all?!selection.keys.has(row.key)?'checked':'':selection.keys.has(row.key)?'checked':''} ${loading||dirty?'disabled':''}></td><td>${attr(names[row.timeline])}</td><td><button class="mt-record-title" data-mt="find-jump" data-key="${row.key}" title="${attr(row.display_title)}">${icon(row)}<span>${attr(row.display_title)}</span>${row.source==='legacy'?'<small>旧版汇总</small>':''}</button></td><td>${attr(row.application||row.group_name)}</td><td>${attr(stamp(row.start))}</td><td>${attr(stamp(row.end))}</td><td class="mt-number">${length(row.seconds)}</td></tr>`).join('');
  return `<section class="mt-find">${controls}${message}<div class="mt-find-caption">${attr(date(data.definition.since))} — ${attr(date(data.definition.until-.001))} · ${data.total} 项 · ${length(data.seconds)}${dirty?' · 条件已更改，请重新搜索':''}</div><div class="mt-table-scroll"><table class="mt-find-table"><colgroup><col class="mt-check-col"><col class="mt-find-kind-col"><col><col class="mt-find-app-col"><col class="mt-find-date-col"><col class="mt-find-date-col"><col class="mt-time-col"></colgroup><thead><tr><th><input id="mt-find-all" type="checkbox" aria-label="选择全部搜索结果" ${data.total&&selectedCount()===data.total?'checked':''} ${loading||dirty||!data.total?'disabled':''}></th>${header('timeline','时间线')}${header('title','标题或网址 / 路径')}${header('application','应用 / 分组')}${header('start','开始')}${header('end','结束')}${header('seconds','期间')}</tr></thead><tbody>${rows||'<tr><td colspan="7" class="mt-empty">没有匹配的记录</td></tr>'}</tbody></table></div><div class="mt-find-paging"><span>已选择 ${selectedCount()} / ${data.total} 项</span><span class="grow"></span>${button('find-prev','上一页',loading||dirty||!data.offset?'disabled':'')}${button('find-next','下一页',loading||dirty||data.offset+data.items.length>=data.total?'disabled':'')}</div></section>`;
 }
 function footer(){return `${button('find-tag-all','标注全部…',ready()&&data.total?'':'disabled')}${button('find-tag-selected','标注所选…',ready()&&selectedCount()?'':'disabled')}<span class="grow"></span>${select('mt-find-export-scope','导出搜索范围',{all:'全部结果',selected:'所选结果'},scope)}${select('mt-find-export-format','搜索导出格式',{csv:'CSV',xlsx:'Excel',json:'JSON'},format)}${button('find-export','导出',ready()&&(scope==='all'||selectedCount())?'':'disabled')}`;}
 function afterRender(){const all=q('#mt-find-all');if(all)all.indeterminate=Boolean(selectedCount()&&selectedCount()!==data.total);}
 function change(el){
  if(el.id==='mt-find-all'){selection={all:el.checked,keys:new Set()};render();q('#mt-find-all')?.focus();return;}
  if(el.dataset.findCheck){if(selection.keys.has(el.dataset.findCheck))selection.keys.delete(el.dataset.findCheck);else selection.keys.add(el.dataset.findCheck);render();[...document.querySelectorAll('[data-find-check]')].find(v=>v.dataset.findCheck===el.dataset.findCheck)?.focus();return;}
  if(el.id==='mt-find-export-format'){format=el.value;return;}
  if(el.id==='mt-find-export-scope'){scope=el.value;render();return;}
  const fields={'mt-find-timeline':'timeline','mt-find-query':'query','mt-find-from':'from','mt-find-through':'through','mt-find-untagged':'untagged'};
  if(fields[el.id]){draft[fields[el.id]]=el.id==='mt-find-untagged'?el.checked:el.value;dirty=true;error='';exportSequence++;}
 }
 function input(el){if(el.id!=='mt-find-query')return;draft.query=el.value;dirty=true;exportSequence++;document.querySelectorAll('[data-mt="find-export"],[data-mt^="find-tag-"]').forEach(v=>v.disabled=true);}
 async function tagModal(all){
  if(!ready())return;const root=data,chosen=all?null:wire(),ticket=++sequence;busy=true;
  openModal('标注搜索结果','<div id="mt-find-tag" role="status">正在计算所选时间…</div>',button('close','取消'),'form');const marker=q('#mt-find-tag');
  const owns=()=>active()&&data===root&&ticket===sequence&&modal.open&&q('#mt-find-tag')===marker;
  try{
   const preview=await apiCall('search/preview',{snapshot:root.snapshot,selection:chosen});if(!owns())return;
   editor={root,chosen};openModal('标注搜索结果',`<div id="mt-find-tag">${sheetGroup('标签',field('标签','<input id="mt-tag-text" autofocus maxlength="3000">')+tagTools.tagEntryHTML(false)+field('备注','<textarea id="mt-tag-notes" rows="2" maxlength="10000"></textarea>')+'<label class="sheet-check"><input id="mt-tag-billable" type="checkbox"><span>可计费时间</span></label>')}<p class="sheet-status">${preview.count} 项结果 · ${preview.range_count} 段 · ${length(preview.seconds)}</p></div>`,button('close','取消')+button('find-tag-submit','添加标签','','primary'),'form');tagTools.prepare();
  }catch(caught){if(owns())showModalError(caught.message);}
  finally{if(ticket===sequence)busy=false;}
 }
 const ownsEditor=()=>Boolean(editor&&modal.open&&q('#mt-find-tag'));
 async function submit(){
  if(!ownsEditor()||busy||!ready())return;const current=editor,marker=q('#mt-find-tag');busy=true;const control=q('[data-mt="find-tag-submit"]');if(control)control.disabled=true;
  try{const saved=await apiCall('search/tag',{snapshot:current.root.snapshot,selection:current.chosen,tag:{tags:q('#mt-tag-text').value,notes:q('#mt-tag-notes').value,billable:q('#mt-tag-billable').checked}});if(!active()||!modal.open||q('#mt-find-tag')!==marker||data!==current.root)return;closeModal();editor=null;toast('已添加 '+saved.count+' 段标签');busy=false;await run();}
  catch(caught){if(ownsEditor()&&editor===current)showModalError(caught.message);}
  finally{if(editor===current||!active())busy=false;if(control?.isConnected)control.disabled=false;}
 }
 async function exportResults(){
  if(!ready()||scope==='selected'&&!selectedCount()||modal.open)return;const root=data,ticket=++exportSequence,selection=scope==='all'?null:wire(),fileFormat=format;busy=true;render();
  const owns=()=>active()&&state.authenticated===true&&data===root&&ticket===exportSequence&&!dirty;
  try{const response=await fetch('/api/tracking/search/export',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-HotTurkey-Session':auth},body:JSON.stringify({snapshot:root.snapshot,selection,format:fileFormat})});if(!owns())return;if(!response.ok)throw Error((await response.json()).error||'导出失败');const blob=await response.blob();if(!owns())return;const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='HotTurkey-search-'+date(root.definition.since)+'_'+date(root.definition.until-.001)+'.'+fileFormat;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  catch(caught){if(owns())error=caught.message;}
  finally{if(ticket===exportSequence){busy=false;if(active())render();}}
 }
 const operations=new Set(['find-open','find-run','find-prev','find-next','find-sort','find-jump','find-tag-all','find-tag-selected','find-tag-submit','find-export']);
 async function action(op,el={}){
  if(op==='find-open')return open();if(op==='find-run')return run();if(op==='find-export')return exportResults();
  if(op==='find-prev')return pageTo(Math.max(0,data.offset-100));if(op==='find-next')return pageTo(data.offset+100);
  if(op==='find-sort')return pageTo(0,el.dataset.key,sort===el.dataset.key&&direction==='asc'?'desc':'asc');
  if(op==='find-jump'){if(loading||dirty)return;const row=data?.items.find(v=>v.key===el.dataset.key);if(row){sequence++;exportSequence++;return jumpTo(row);}}
  if(op==='find-tag-all'||op==='find-tag-selected')return tagModal(op==='find-tag-all');if(op==='find-tag-submit')return submit();
 }
 return {open,html,footer,afterRender,action,export:exportResults,ownsEditor,submit,handles:op=>operations.has(op),handlesChange:el=>el.id?.startsWith('mt-find-')||Boolean(el.dataset.findCheck),change,input,enter:run,leave(){sequence++;exportSequence++;loading=false;busy=false;},suspend(){sequence++;exportSequence++;data=null;draft=null;editor=null;loading=false;busy=false;error='';selection={all:false,keys:new Set()};}};
}};
