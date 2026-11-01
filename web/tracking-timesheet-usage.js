'use strict';
window.HotTurkeyUsageUI={create({model,apiCall,render,load,attr,button,length,tagTools,jumpTo}){
 const q=(s,r=document)=>r.querySelector(s);
 let active=false,work=null,keys=[],data=null,loading=false,error='',sequence=0,timer=null,editor=null,busy=false;
 const options={timeline:'applications',group_by:'details',query:'',offset:0,limit:200};
 const visible=()=>state.authenticated===true&&page==='statistics'&&model.view==='timesheet';
 const date=at=>new Date(at*1000).toLocaleString('zh-CN',{hour12:false});
 const select=(id,label,values,value)=>`<select id="${id}" aria-label="${label}">${Object.entries(values).map(([k,v])=>`<option value="${k}" ${k===value?'selected':''}>${v}</option>`).join('')}</select>`;
 function publish(){model.sheetUsage={active,report:data,loading,error};if(model.view==='timesheet')document.querySelectorAll('[data-mt=export]').forEach(v=>v.disabled=Boolean(model.sheetDirty||model.loading||work?.errors?.length||active&&(loading||!data)));}
 function bind(report,selected){
  const next=[...selected].sort();if(work?.snapshot!==report.snapshot||JSON.stringify(keys)!==JSON.stringify(next)){sequence++;clearTimeout(timer);data=null;error='';loading=false;options.offset=0;}
  work=report;keys=next;publish();
 }
 async function read(silent=false){
  if(!work||!active||!visible())return;
  clearTimeout(timer);timer=null;const ticket=++sequence,snapshot=work.snapshot;loading=true;error='';publish();if(!silent)render();
  try{
   const value=await apiCall('timesheet/usage',{snapshot,options:{...options,row_keys:keys.length?[...keys]:null}});
   if(ticket!==sequence||!active||!visible()||work?.snapshot!==snapshot)return;
   data=value;loading=false;publish();if(!silent)render();
  }catch(caught){if(ticket!==sequence||!active||!visible())return;loading=false;error=caught.message;data=null;publish();if(!silent)render();}
 }
 function icon(row){
  const app=row.bundle||row.application&&row.application!=='多个应用';
  return app?`<span class="activity-icon" data-activity-kind="application" data-activity-target="${attr(row.bundle?'bundle:'+row.bundle:row.application)}" aria-hidden="true"></span>`:`<span class="mt-color" style="--item-color:${attr(row.color||'#8e8e93')}" aria-hidden="true"></span>`;
 }
 function html(){
  const controls=`<div class="mt-usage-controls">${select('mt-usage-timeline','使用明细时间线',{applications:'应用程序',documents:'文档',computer:'电脑使用'},options.timeline)}${select('mt-usage-group','使用明细分组',{details:'所有片段',group:'按分组',title:'按标题'},options.group_by)}<input id="mt-usage-query" type="search" aria-label="筛选使用明细" value="${attr(options.query)}" placeholder="筛选活动">${button('usage-refresh','刷新明细',loading?'disabled':'')}${button('usage-copy','复制全部明细',loading||!data||model.sheetDirty?'disabled':'')}</div>`;
  const scope=`<div class="mt-usage-scope">${keys.length?'所选 '+keys.length+' 行':'全部生成行'}${data?' · 活动 '+length(data.seconds)+' / 工作区间 '+length(data.work_seconds):''}</div>`;
  if(error)return controls+scope+`<div class="mt-error" role="alert">${attr(error)}</div>`;
  if(loading||!data)return controls+scope+'<div class="mt-loading" role="status">正在读取使用明细…</div>';
  const detail=options.group_by==='details';
  const rows=data.items.map(r=>`<tr><td><button class="mt-record-title" data-mt="usage-jump" data-key="${r.key}">${icon(r)}<span>${attr(r.title)}</span>${r.legacy?'<small>旧版汇总</small>':''}</button></td><td>${attr(r.group_name)}</td><td>${attr(date(r.start))}</td><td>${attr(date(r.end))}</td><td class="mt-number">${length(r.seconds)}</td><td class="mt-number">${r.count}</td><td>${button('usage-menu','⋯',`data-key="${r.key}" aria-label="${attr(r.title)}的操作"`,'mt-more')}</td></tr>`).join('');
  return controls+scope+`<div class="mt-table-scroll"><table class="mt-usage-table"><thead><tr><th>标题</th><th>分组</th><th>${detail?'开始':'首次出现'}</th><th>${detail?'结束':'末次出现'}</th><th>时长</th><th>片段</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="mt-empty">所选工作时段内没有匹配的活动</td></tr>'}</tbody></table></div><div class="mt-usage-paging"><span>${data.total} 项</span><span class="grow"></span>${button('usage-prev','上一页',options.offset?'':'disabled')}${button('usage-next','下一页',options.offset+data.items.length<data.total?'':'disabled')}</div>`;
 }
 const ownsEditor=()=>modal.open&&q('#mt-usage-retag');
 function retagModal(){
  if(model.sheetDirty)throw Error('请先生成工时表，再重新标注使用片段');
  const r=editor.row,v=r.retag_defaults;
  openModal('重新标注使用片段',`<div id="mt-usage-retag">${sheetGroup('标签',field('标签',`<input id="mt-tag-text" autofocus maxlength="3000" value="${attr(v.tags.join(', '))}">`)+tagTools.tagEntryHTML(true)+field('备注',`<textarea id="mt-tag-notes" rows="2" maxlength="10000">${attr(v.notes)}</textarea>`,true)+`<label class="sheet-check"><input id="mt-tag-billable" type="checkbox" ${v.billable?'checked':''}><span>可计费时间</span></label><label class="sheet-check"><input id="mt-usage-override" type="checkbox" ${v.auto_override?'checked':''}><span>覆盖这些片段的自动标签</span></label>`,'自动标签覆盖只在所选片段内生效，不改变匹配条件。')}${sheetGroup('所选时间',`<p class="sheet-status">${r.ranges.length} 段 · ${length(r.seconds)}</p><ul class="sheet-list">${r.ranges.slice(0,20).map(([a,b])=>'<li>'+attr(date(a)+' — '+date(b))+'</li>').join('')}</ul>${r.ranges.length>20?'<p class="sheet-note">显示前 20 段，共 '+r.ranges.length+' 段。</p>':''}`,'仅替换这些工作片段中的原标签；保留中间空档和未选中的其他标签。')}</div>`,button('close','取消')+button('usage-retag-submit','重新标注','','primary'),'form');
  tagTools.prepare();
 }
 const operations=new Set(['sheet-show-summary','sheet-show-usage','usage-refresh','usage-prev','usage-next','usage-menu','usage-jump','usage-go-first','usage-retag','usage-retag-submit','usage-copy']);
 async function action(op,element={}){
  if(loading&&['usage-menu','usage-jump','usage-go-first','usage-retag','usage-retag-submit'].includes(op))return;
  if(op==='usage-copy'){
   if(loading||!data||model.sheetDirty||busy)return;const root=data,workId=work.snapshot;
   const authorized=()=>visible()&&active&&!loading&&!model.sheetDirty&&data===root&&work?.snapshot===workId;
   busy=true;try{const result=await apiCall('timesheet/copy',{snapshot:root.snapshot,kind:'usage'});if(authorized()&&await HotTurkeyClipboard.write(result.text,authorized)&&authorized())toast('已复制 '+result.row_count+' 行');}catch(caught){if(authorized())throw caught;}finally{busy=false;}return;
  }
  if(op==='sheet-show-summary'){active=false;sequence++;clearTimeout(timer);loading=false;publish();return render();}
  if(op==='sheet-show-usage'){active=true;publish();if(data)return render();return read();}
  if(op==='usage-refresh'){options.offset=0;const input=q('#mt-usage-query');if(input)options.query=input.value;return read();}
  if(op==='usage-prev'||op==='usage-next'){options.offset=Math.max(0,options.offset+(op==='usage-next'?options.limit:-options.limit));return read();}
  if(op==='usage-menu'||op==='usage-jump'){
   const row=data?.items.find(r=>r.key===element.dataset.key);if(!row)return;
   editor={snapshot:data.snapshot,key:row.key,row,work:work.snapshot};
   if(op==='usage-jump')return jumpTo(row);
   return openModal('使用片段',sheetGroup('',`<p class="sheet-status">${attr(row.title)}</p><p class="sheet-status">${row.ranges.length} 段 · ${length(row.seconds)}</p>`),button('close','关闭')+button('usage-go-first','去首次出现')+button('usage-retag','重新标注…',model.sheetDirty?'disabled':''),'compact');
  }
  if(op==='usage-go-first'){closeModal();return jumpTo(editor.row);}
  if(op==='usage-retag')return retagModal();
  if(op==='usage-retag-submit'){
   if(busy||!ownsEditor())return;const marker=q('#mt-usage-retag'),context=editor;
   const value={tags:q('#mt-tag-text').value,notes:q('#mt-tag-notes').value,billable:q('#mt-tag-billable').checked,auto_override:q('#mt-usage-override').checked};
   const control=q('[data-mt=usage-retag-submit]',modal);if(control)control.disabled=true;busy=true;
   try{const result=await apiCall('timesheet/retag',{snapshot:context.snapshot,key:context.key,tag:value});if(!visible())return;if(ownsEditor()&&q('#mt-usage-retag')===marker){closeModal();toast('已重新标注 '+result.range_count+' 段');}if(work?.snapshot===context.work)await load();}
   catch(caught){if(visible()&&ownsEditor()&&q('#mt-usage-retag')===marker)throw caught;}
   finally{busy=false;if(control?.isConnected)control.disabled=false;}return;
  }
 }
 const controls=new Set(['mt-usage-timeline','mt-usage-group']);
 async function change(el){options[el.id==='mt-usage-timeline'?'timeline':'group_by']=el.value;options.offset=0;return read();}
 document.addEventListener('input',event=>{
  if(event.target.id!=='mt-usage-query'||!active)return;options.query=event.target.value;options.offset=0;sequence++;loading=true;publish();clearTimeout(timer);timer=setTimeout(()=>read(),300);
 });
 document.addEventListener('keydown',event=>{if(event.target.id==='mt-usage-query'&&event.key==='Enter'&&!event.isComposing){event.preventDefault();action('usage-refresh').catch(error=>toast(error.message));}});
 return {bind,read,html,handles:op=>operations.has(op),action,handlesChange:el=>controls.has(el.id),change,ownsEditor,submit:()=>action('usage-retag-submit'),get active(){return active;},
  suspend(){sequence++;clearTimeout(timer);active=false;work=null;keys=[];data=null;editor=null;loading=false;error='';publish();}};
}};
