'use strict';
window.HotTurkeyTags={create({model,apiCall,load,attr,button,tagModal}){
 const q=(s,r=document)=>r.querySelector(s),qa=(s,r=document)=>[...r.querySelectorAll(s)],clone=v=>JSON.parse(JSON.stringify(v));
 let busy=false;
 let recent=[],pickerSequence=0,librarySequence=0,searchTimer=null;
 const library={kind:'combination',query:'',offset:0,total:0,items:[],selected:null,draft:null,original:null};
 let prefix=[],treeOffset=0,treeItems=[];
 const split=value=>String(value||'').split(',').map(v=>v.trim()).filter(Boolean);
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 function tagEntryHTML(editing=false){
  const last=!editing&&model.day===new Date().toLocaleDateString('en-CA')?button('tag-last-untagged','补标至现在'):'';
  return '<div class="mt-tag-entry-tools">'+button('tag-picker','选择标签…')+'<span class="grow"></span>'+last+'</div><div id="mt-recent-tags" class="mt-recent-tags" hidden></div><section id="mt-tag-picker" class="mt-tag-picker" hidden aria-label="标签层级选择"></section>';
 }
 async function prepare(){
  const input=q('#mt-tag-text');if(!input)return;
  try{
   const value=await apiCall('tag-library/recent');if(q('#mt-tag-text')!==input||!modal.open)return;recent=value.items;
   const root=q('#mt-recent-tags');if(!root)return;root.hidden=!recent.length;
   root.innerHTML=recent.slice(0,6).map((v,i)=>button('tag-recent',`<span class="mt-color" style="--item-color:${attr(v.color)}"></span>${attr(v.parts.join(', '))}${v.billable?'<span aria-label="可计费">$</span>':''}`,`data-index="${i}" title="${attr(v.parts.join(', '))}"`)).join('');
  }catch(error){if(q('#mt-tag-text')===input)showModalError(error.message);}
 }
 async function picker(value=[],offset=0){
  const root=q('#mt-tag-picker');if(!root)return;root.hidden=false;
  const sequence=++pickerSequence,input=q('#mt-tag-text');prefix=value;treeOffset=offset;
  let result;
  try{result=await apiCall('tag-library/tree?'+new URLSearchParams({prefix:JSON.stringify(prefix),offset:String(offset)}));}
  catch(error){if(sequence!==pickerSequence||q('#mt-tag-text')!==input||!modal.open)return;throw error;}
  if(sequence!==pickerSequence||q('#mt-tag-text')!==input||!modal.open)return;
  treeItems=result.items;
  root.innerHTML=`<div class="mt-tag-breadcrumbs">${button('tag-picker-up','所有标签','data-depth="0"')}${prefix.map((v,i)=>'<span>›</span>'+button('tag-picker-up',attr(v),`data-depth="${i+1}"`)).join('')}</div><div class="mt-tag-children">${result.items.map((v,i)=>button('tag-picker-child',`<span>${attr(v.name)}</span><span aria-hidden="true">${v.children?'›':''}</span>`,`data-index="${i}"`)).join('')||'<p class="sheet-status">没有下级标签</p>'}</div><div class="mt-tag-picker-actions">${result.total>200?button('tag-picker-prev','上一页',offset?'':'disabled')+button('tag-picker-next','下一页',offset+result.items.length<result.total?'':'disabled'):''}<span class="grow"></span>${button('tag-picker-hide','取消')}${button('tag-picker-use','使用所选标签',prefix.length?'':'disabled','primary')}</div>`;
 }
 function closePicker(){pickerSequence++;const root=q('#mt-tag-picker');if(root)root.hidden=true;}
 function collect(){
  if(!q('#mt-library-name'))return;
  library.draft={parts:split(q('#mt-library-name').value),color:q('#mt-library-color-mode').value==='inherit'?'':q('#mt-library-color').value,skip:q('#mt-library-skip')?.checked===true};
 }
 function dirty(){collect();return library.draft&&library.original&&!same(library.draft,library.original);}
 function choose(item){library.selected=item?.key||null;library.draft={parts:item?.parts||[],color:item?.color||'',skip:item?.skip||false};library.original=clone(library.draft);}
 function managerHTML(){
  const d=library.draft,kind=library.kind;
  const tabs=`<div class="mt-settings-tabs" role="tablist" aria-label="标签管理分类">${button('library-tab','标签组合',`data-value="combination" role="tab" aria-selected="${kind==='combination'}"`)}${button('library-tab','单个标签',`data-value="tag" role="tab" aria-selected="${kind==='tag'}"`)}</div>`;
  const tools=`<div class="mt-library-tools"><input type="search" id="mt-library-search" aria-label="搜索标签" placeholder="搜索标签" value="${attr(library.query)}">${button('library-new','＋','aria-label="新增标签"')}${button('library-import','导入…')}${button('library-export','导出…')}</div>`;
  const list=`<div class="mt-library-list" role="listbox" aria-label="${kind==='tag'?'单个标签':'标签组合'}">${library.items.map(v=>button('library-select',`<span class="mt-color" style="--item-color:${attr(v.resolved_color)}"></span><span>${attr(v.name)}</span>`,`data-key="${v.key}" role="option" aria-selected="${v.key===library.selected}"`)).join('')||'<p class="sheet-status">暂无标签</p>'}</div><div class="mt-library-paging"><span>${library.total} 项</span><span class="grow"></span>${button('library-prev','上一页',library.offset?'':'disabled')}${button('library-next','下一页',library.offset+library.items.length<library.total?'':'disabled')}</div>`;
  let editor='';
  if(d){
   const mode=`<select id="mt-library-color-mode" aria-label="标签颜色方式"><option value="inherit" ${d.color?'':'selected'}>${kind==='tag'?'默认颜色':'继承标签颜色'}</option><option value="fixed" ${d.color?'selected':''}>指定颜色</option></select><input id="mt-library-color" aria-label="标签颜色" type="color" value="${attr(d.color||library.items.find(v=>v.key===library.selected)?.resolved_color||'#007aff')}" ${d.color?'':'hidden'}>`;
   const skip=kind==='tag'?`<label class="sheet-check"><input id="mt-library-skip" type="checkbox" ${d.skip?'checked':''}><span>组合取色时跳过这个标签</span></label>`:'';
   editor=sheetGroup(library.selected?'编辑':'新增',field(kind==='tag'?'名称':'标签组合',`<input id="mt-library-name" maxlength="3000" value="${attr(d.parts.join(', '))}">`)+field('颜色',`<span class="mt-library-color-choice">${mode}</span>`)+skip+(library.selected?`<div class="mt-library-row-actions">${button('library-up','上移',library.query?'disabled':'')}${button('library-down','下移',library.query?'disabled':'')}<span class="grow"></span>${button('library-delete','删除所有实例','','danger')}</div>`:''),kind==='tag'?'重命名会更新所有包含此标签的历史组合。':'重命名只更新这个完整组合的历史记录。');
  }
  return tabs+tools+list+editor;
 }
 function renderManager(){openModal('标签管理','<div id="mt-library-root">'+managerHTML()+'</div>',`${button('close','完成')}${button('library-save','保存',library.draft?'':'disabled','primary')}`,'form');}
 async function readManager(){
  const marker=q('#mt-library-root');if(!marker||!modal.open)return;
  const seq=++librarySequence;let result;
  try{result=await apiCall('tag-library?'+new URLSearchParams({kind:library.kind,q:library.query,offset:String(library.offset)}));}
  catch(error){if(seq!==librarySequence||q('#mt-library-root')!==marker||!modal.open)return;throw error;}
  if(seq!==librarySequence||page!=='statistics'||q('#mt-library-root')!==marker||!modal.open)return;
  library.items=result.items;library.total=result.total;renderManager();
 }
 async function manager(){
  librarySequence++;Object.assign(library,{kind:'combination',query:'',offset:0,total:0,items:[],selected:null,draft:null,original:null});renderManager();await readManager();
 }
 async function lastUntagged(inEditor=false){
  const input=q('#mt-tag-text'),result=await apiCall('tags/last-untagged');
  if(inEditor&&(q('#mt-tag-text')!==input||!modal.open))return;
  if(inEditor&&q('#mt-tag-start')){
   const local=value=>{const d=new Date(value*1000),pad=v=>String(v).padStart(2,'0');return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());};
   q('#mt-tag-start').value=local(result.range[0]);q('#mt-tag-end').value=local(result.range[1]);model.tagRanges=[result.range];q('#mt-tag-start').closest('.sheet-group')?.querySelector('.sheet-note')?.remove();return;
  }
  model.day=result.day;model.selection=[result.range];model.dayKey='';await load();tagModal();
 }
 const operations=new Set(['tag-picker','tag-picker-child','tag-picker-up','tag-picker-use','tag-picker-hide','tag-picker-prev','tag-picker-next','tag-recent','tag-last-untagged','tag-manager','library-tab','library-select','library-new','library-save','library-delete','library-up','library-down','library-prev','library-next','library-import','library-export']);
 async function mutation(run){
  busy=true;const controls=qa('[data-mt^="library-"],#mt-library-root input,#mt-library-root select',modal).map(node=>[node,node.disabled]);
  controls.forEach(([node])=>{node.disabled=true;});
  try{return await run();}finally{busy=false;controls.forEach(([node,disabled])=>{if(node.isConnected)node.disabled=disabled;});}
 }
 async function action(op,element){
  if(op.startsWith('library-')&&busy)return;
  if(op.startsWith('library-'))collect();
  if(op==='tag-manager')return manager();
  if(op==='tag-last-untagged')return lastUntagged(Boolean(q('#mt-tag-text')));
  if(op==='tag-picker')return q('#mt-tag-picker')?.hidden?picker():closePicker();
  if(op==='tag-picker-child'){const item=treeItems[Number(element.dataset.index)];if(item)return picker(item.parts);return;}
  if(op==='tag-picker-up')return picker(prefix.slice(0,Number(element.dataset.depth)));
  if(op==='tag-picker-prev')return picker(prefix,Math.max(0,treeOffset-200));
  if(op==='tag-picker-next')return picker(prefix,treeOffset+200);
  if(op==='tag-picker-hide')return closePicker();
  if(op==='tag-picker-use'){q('#mt-tag-text').value=prefix.join(', ');closePicker();q('#mt-tag-text').focus();return;}
  if(op==='tag-recent'){const item=recent[Number(element.dataset.index)];if(item)q('#mt-tag-text').value=item.parts.join(', ');q('#mt-tag-text').focus();return;}
  if(op==='library-tab'){
   if(dirty()&&!confirm('放弃尚未保存的标签修改？'))return;
   library.kind=element.dataset.value;library.offset=0;choose(null);library.draft=null;return readManager();
  }
  if(op==='library-select'||op==='library-new'){
   if(dirty()&&!confirm('放弃尚未保存的标签修改？'))return;
   choose(op==='library-select'?library.items.find(v=>v.key===element.dataset.key):null);return renderManager();
  }
  if(op==='library-prev'||op==='library-next'){collect();library.offset=Math.max(0,library.offset+(op==='library-next'?200:-200));return readManager();}
  if(op==='library-save'){
   collect();const d=library.draft;if(!d?.parts.length)throw Error('请输入标签');
   if(library.kind==='tag'&&d.parts.length!==1)throw Error('单个标签不能包含逗号');
   if(library.selected&&!same(d.parts,library.original.parts)&&!confirm('将「'+library.original.parts.join(', ')+'」改为「'+d.parts.join(', ')+'」，并同步更新所有历史记录？时间、备注和计费标记保持原样。'))return;
   return mutation(async()=>{const value=library.selected?await apiCall('tag-library/update',{key:library.selected,value:d}):await apiCall('tag-library/save',{kind:library.kind,...d});
    choose(value);await readManager();await load();toast('标签已保存');});
  }
  if(op==='library-delete'){
   if(!library.selected)return;
   const message=library.kind==='tag'?'从所有历史组合中移除这个标签？仅含此标签的时间标记会删除，其他活动记录保留。':'删除这个组合及其所有历史时间标记？其他活动记录保留。';
   if(!confirm(message))return;
   return mutation(async()=>{await apiCall('tag-library/delete',{key:library.selected});choose(null);library.draft=null;await readManager();return load();});
  }
  if(op==='library-up'||op==='library-down')return mutation(async()=>{await apiCall('tag-library/move',{key:library.selected,direction:op==='library-up'?-1:1});return readManager();});
  if(op==='library-import'){
   return mutation(async()=>{const content=await readFile('.txt');if(content===null)return;
    const result=await apiCall('tag-library/import',{text:content});await readManager();toast('已导入 '+result.added+' 个标签组合');});
  }
  if(op==='library-export')return mutation(async()=>{const result=await apiCall('tag-library/export');download('HotTurkey-tags.txt',result.text,'text/plain;charset=utf-8');});
 }
 document.addEventListener('input',event=>{
  if(event.target.id==='mt-library-search'){
   if(busy)return;
   collect();library.query=event.target.value;library.offset=0;clearTimeout(searchTimer);
   searchTimer=setTimeout(()=>readManager().catch(error=>showModalError(error.message)),250);
  }
 });
 document.addEventListener('change',event=>{
  if(event.target.id==='mt-library-color-mode'){q('#mt-library-color').hidden=event.target.value==='inherit';collect();}
 });
 return {tagEntryHTML,prepare,handles:op=>operations.has(op),action};
}};
