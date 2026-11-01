'use strict';
window.HotTurkeyTimesheetUI={create({model,apiCall,load,render,attr,button,length,tagTools,jumpTo}){
 const q=(s,r=document)=>r.querySelector(s),qa=(s,r=document)=>[...r.querySelectorAll(s)],clone=v=>JSON.parse(JSON.stringify(v));
 const defaults={sources:['tags'],group_fields:['tags'],total_by:'day',billable:null,query:'',round_minutes:0,rounding:'nearest',never_zero:false,include_unrounded:false,include_notes:true,sort_by:null};
 const groupChoices={tags:'完整标签组合',...Object.fromEntries(Array.from({length:30},(_,i)=>['level:'+(i+1),'第 '+(i+1)+' 级标签'])),note:'备注',day:'日',month:'月',year:'年',timeline:'时间线',billable:'计费',...Object.fromEntries(Array.from({length:30},(_,i)=>['prefix:'+(i+1),'前 '+(i+1)+' 级标签路径']))};
 let form=null,applied=null,presets=[],loaded=false,presetId=null,sequence=0,busy=false,roundDraft=5;
 const selectedRows=new Set(),usage=HotTurkeyUsageUI.create({model,apiCall,load,render,attr,button,length,tagTools,jumpTo});
 function endBusy(){busy=false;const control=q('[data-mt=sheet-generate]');if(control)control.disabled=false;}
 const active=()=>state.authenticated===true&&page==='statistics'&&model.view==='timesheet';
 const select=(id,label,values,value,extra='')=>`<select id="${id}" aria-label="${label}" ${extra}>${Object.entries(values).map(([k,v])=>`<option value="${attr(k)}" ${String(value)===k?'selected':''}>${attr(v)}</option>`).join('')}</select>`;
 const day=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
 const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
 function initialize(){if(form)return;const end=new Date(model.day+'T12:00:00'),start=new Date(end);start.setDate(start.getDate()-(model.period||7)+1);form={from:day(start),through:day(end),definition:clone(defaults)};applied=clone(form);}
 function range(value){
  const start=new Date(value.from+'T00:00:00'),end=new Date(value.through+'T00:00:00');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value.from)||!/^\d{4}-\d{2}-\d{2}$/.test(value.through)||!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||day(start)!==value.from||day(end)!==value.through||end<start)throw Error('请选择有效的开始与结束日期');
  end.setDate(end.getDate()+1);return {since:start.getTime()/1000,until:end.getTime()/1000};
 }
 function collect(){
  if(!q('#mt-sheet-options')||!form)return;
  roundDraft=Number(q('#mt-sheet-round-minutes').value);
  form={from:q('#mt-sheet-from').value,through:q('#mt-sheet-through').value,definition:{...form.definition,
   sources:qa('[data-sheet-source]:checked').map(v=>v.dataset.sheetSource),group_fields:qa('[data-sheet-group]').map(v=>v.value),
   total_by:q('#mt-sheet-total').value,billable:q('#mt-sheet-billable').value==='all'?null:q('#mt-sheet-billable').value==='true',query:q('#mt-sheet-query').value,
   round_minutes:q('#mt-sheet-round-enabled').checked?roundDraft:0,rounding:q('#mt-sheet-rounding').value,
   never_zero:q('#mt-sheet-never-zero').checked,include_unrounded:q('#mt-sheet-raw').checked,include_notes:q('#mt-sheet-notes').checked}};
 }
 const dirty=()=>Boolean(form&&applied&&canonical(form)!==canonical(applied));
 function updateDraft(){
  collect();model.sheetDirty=dirty();const status=q('#mt-sheet-dirty');if(status)status.textContent=model.sheetDirty?'有未生成的修改':'';
  qa('[data-mt=export]').forEach(v=>v.disabled=Boolean(model.sheetDirty||model.loading||model.report?.errors?.length||model.sheetUsage?.active&&(model.sheetUsage.loading||!model.sheetUsage.report)));
  const options=q('#mt-sheet-round-options');if(options)options.hidden=!q('#mt-sheet-round-enabled').checked;
  const note=q('#mt-sheet-minimum-note');if(note)note.hidden=!(form?.definition.never_zero&&form.definition.rounding==='total');
 }
 async function read(){
  initialize();const ticket=++sequence,value=clone(applied);
  if(!loaded){let result;try{result=await apiCall('entities?kind=timesheets');}catch(error){if(ticket!==sequence||!active())return;throw error;}if(ticket!==sequence||!active())return;presets=result.items;loaded=true;}
  const result=await apiCall('timesheet/render',{...range(value),definition:value.definition});
  if(ticket!==sequence||!active())return;
  const valid=new Set(result.matrix.map(v=>v.key));for(const key of selectedRows)if(!valid.has(key))selectedRows.delete(key);
  usage.bind(result,selectedRows);if(usage.active)await usage.read(true);
  if(ticket!==sequence||!active())return;
  model.sheetDirty=dirty();return result;
 }
 function optionsHTML(){
  const d=form.definition;
  const saved=select('mt-sheet-preset','已保存的工时表选项',{'':'当前选项',...Object.fromEntries(presets.map(v=>[v.id,v.name]))},presetId||'');
  const fields=d.group_fields.map((v,i)=>`<div class="mt-sheet-group-field">${select('mt-sheet-group-'+i,'分组字段 '+(i+1),groupChoices,v,`data-sheet-group="${i}"`)}${button('sheet-remove-group','−',`data-index="${i}" aria-label="移除分组字段 ${i+1}" ${d.group_fields.length<2?'disabled':''}`)}</div>`).join('');
  const rounding=`<label class="sheet-check"><input id="mt-sheet-round-enabled" type="checkbox" ${d.round_minutes?'checked':''}><span>启用舍入</span></label><div id="mt-sheet-round-options" ${d.round_minutes?'':'hidden'}>${field('单位（分钟）',`<input id="mt-sheet-round-minutes" type="number" min="1" max="60" value="${d.round_minutes||roundDraft}">`)}${field('方式',select('mt-sheet-rounding','舍入方式',{nearest:'最近值',up:'向上',down:'向下',total:'保持总计接近原值'},d.rounding))}<label class="sheet-check"><input id="mt-sheet-never-zero" type="checkbox" ${d.never_zero?'checked':''}><span>非零项目至少计一个单位</span></label><p id="mt-sheet-minimum-note" class="sheet-note" ${d.never_zero&&d.rounding==='total'?'':'hidden'}>最小计费优先，总计可能高于原始总计。</p><label class="sheet-check"><input id="mt-sheet-raw" type="checkbox" ${d.include_unrounded?'checked':''}><span>同时显示原始时长</span></label></div>`;
  return `<div role="region" id="mt-sheet-options" class="mt-sheet-options" aria-label="工时表选项"><div class="mt-sheet-preset">${saved}${button('sheet-save','保存选项…')}${presetId?button('sheet-delete-preset','删除保存选项','','subtle'):''}</div>`+
   sheetGroup('日期',field('从',`<input id="mt-sheet-from" type="date" value="${attr(form.from)}">`)+field('至（含当天）',`<input id="mt-sheet-through" type="date" value="${attr(form.through)}">`)+`<div class="mt-sheet-date-shortcuts">${button('sheet-dates','本周','data-value="week"')}${button('sheet-dates','本月','data-value="month"')}${button('sheet-dates','最近 7 天','data-value="7"')}</div>`)+
   sheetGroup('来源',Object.entries({tags:'普通标签',autotags:'自动标签'}).map(([v,name])=>`<label class="sheet-check"><input type="checkbox" data-sheet-source="${v}" ${d.sources.includes(v)?'checked':''}><span>${name}</span></label>`).join(''),d.sources.length>1?'相同分组内的重叠时间只计算一次。':'')+
   sheetGroup('分组',fields+button('sheet-add-group','添加分组字段',d.group_fields.length>=6?'disabled':'')+field('日期汇总',select('mt-sheet-total','日期汇总',{none:'只显示总计',day:'按日',week:'按周',month:'按月',year:'按年'},d.total_by)))+
   sheetGroup('筛选',field('计费',select('mt-sheet-billable','计费筛选',{all:'全部',true:'仅可计费',false:'仅不可计费'},d.billable===null?'all':String(d.billable)))+field('标签或备注',`<input id="mt-sheet-query" type="search" value="${attr(d.query)}" placeholder="可选">`))+
   sheetGroup('呈现',rounding+`<label class="sheet-check"><input id="mt-sheet-notes" type="checkbox" ${d.include_notes?'checked':''}><span>包含备注</span></label>`)+
   `<div class="mt-sheet-generate">${button('sheet-generate','生成工时表',busy?'disabled':'','primary')}<span id="mt-sheet-dirty" role="status">${dirty()?'有未生成的修改':''}</span></div></div>`;
 }
 function html(){
  initialize();const r=model.report;if(!r)return '';
  usage.bind(r,selectedRows);
  const caption=r.definition.round_minutes?'原始 '+length(r.seconds)+' · 舍入 '+length(r.rounded_seconds):'合计 '+length(r.seconds);
  const label=v=>v.replace('（舍入秒）','（舍入）').replace('（原始秒）','（原始）').replace('（秒）','');
  const all=r.matrix.length>0&&r.matrix.every(v=>selectedRows.has(v.key));
  const heading=`<th><input id="mt-sheet-select-all" type="checkbox" aria-label="选择所有工时表行" ${all?'checked':''}></th>`+r.columns.map((v,i)=>`<th aria-sort="${r.definition.sort_by?.column===i?(r.definition.sort_by.descending?'descending':'ascending'):'none'}">${button('sheet-sort',attr(label(v.name))+(r.definition.sort_by?.column===i?(r.definition.sort_by.descending?' ↓':' ↑'):''),`data-column="${i}"`)}</th>`).join('');
  const rows=r.table.map((row,index)=>'<tr><td><input type="checkbox" data-sheet-row="'+r.matrix[index].key+'" aria-label="选择 '+attr(r.matrix[index].groups.join(', '))+'" '+(selectedRows.has(r.matrix[index].key)?'checked':'')+'></td>'+row.map((v,i)=>`<td class="${r.columns[i].kind==='seconds'?'mt-number':'mt-sheet-text'}">${r.columns[i].kind==='seconds'?length(v):attr(v)}</td>`).join('')+'</tr>').join('');
  const error=r.errors.length?`<div class="mt-sheet-error" role="alert">自动标签有 ${r.errors.length} 项计算错误；修正后才可导出。</div>`:'';
  const tabs=`<div class="mt-sheet-view-tabs" role="tablist" aria-label="工时表内容">${button('sheet-show-summary','工时表',`role="tab" aria-selected="${!usage.active}"`)}${button('sheet-show-usage','使用明细',`role="tab" aria-selected="${usage.active}"`)}<span class="grow"></span>${!usage.active?button('sheet-copy',selectedRows.size?'复制所选行':'复制全部行',dirty()||r.errors.length?'disabled':''):''}${selectedRows.size?'<span>'+selectedRows.size+' 行已选</span>'+button('sheet-clear-rows','清除选择'):''}</div>`;
  return `<div class="mt-report mt-timesheet">${optionsHTML()}<section class="mt-sheet-results" aria-label="工时表结果"><div class="mt-pane-head"><h2>工时表</h2><span class="grow"></span><small>${caption}</small></div>${tabs}${error}${usage.active?usage.html():`<div class="mt-table-scroll"><table class="mt-sheet-table"><thead><tr>${heading}</tr></thead><tbody>${rows||'<tr><td colspan="'+(r.columns.length+1)+'" class="mt-empty">这段时间暂无匹配的标签</td></tr>'}</tbody></table></div><div class="mt-pane-total">${r.matrix.length} 行 · ${caption}</div>`}</section></div>`;
 }
 function saveModal(){collect();const current=presets.find(v=>v.id===presetId);openModal('保存工时表选项',sheetGroup('',field('名称',`<input id="mt-sheet-save-name" autofocus maxlength="200" value="${attr(current?.name||'标签工时表')}">`)+`<label class="sheet-check"><input id="mt-sheet-save-dates" type="checkbox" ${current?.date_range?'checked':''}><span>同时保存日期范围</span></label>`),' '+button('close','取消')+(presetId?button('sheet-save-new','另存为'):'')+button('sheet-save-submit','保存','','primary'),'compact');}
 const operations=new Set(['sheet-generate','sheet-dates','sheet-add-group','sheet-remove-group','sheet-save','sheet-save-submit','sheet-save-new','sheet-delete-preset','sheet-sort','sheet-clear-rows','sheet-copy']);
 async function action(op,element={}){
  if(usage.handles(op))return usage.action(op,element);
  if(busy)return;initialize();collect();
  if(op==='sheet-copy'){
   if(dirty()||model.loading)throw Error('请先生成工时表，再复制结果');
   const root=model.report,keys=[...selectedRows].sort(),authorized=()=>active()&&model.report===root&&!usage.active&&!dirty()&&JSON.stringify([...selectedRows].sort())===JSON.stringify(keys);
   busy=true;try{const result=await apiCall('timesheet/copy',{snapshot:root.snapshot,kind:'work',row_keys:keys.length?keys:null});if(authorized()&&await HotTurkeyClipboard.write(result.text,authorized)&&authorized())toast('已复制 '+result.row_count+' 行');}catch(error){if(authorized())throw error;}finally{endBusy();}return;
  }
  if(op==='sheet-clear-rows'){selectedRows.clear();usage.bind(model.report,selectedRows);if(usage.active)return usage.read();return render();}
  if(op==='sheet-save')return saveModal();
  if(op==='sheet-save-submit'||op==='sheet-save-new'){
   const marker=q('#mt-sheet-save-name'),name=marker.value,value={name,definition:clone(form.definition)};
   if(q('#mt-sheet-save-dates').checked){range(form);value.date_range={from:form.from,through:form.through};}
   busy=true;try{const result=await apiCall('entities/save',{kind:'timesheets',id:op==='sheet-save-new'?null:presetId,value});if(!active())return;const i=presets.findIndex(v=>v.id===result.id);if(i<0)presets.push(result);else presets[i]=result;presetId=result.id;
    if(modal.open&&q('#mt-sheet-save-name')===marker){closeModal();render();toast('工时表选项已保存');}
   }catch(error){if(active()&&modal.open&&q('#mt-sheet-save-name')===marker)throw error;}finally{endBusy();}return;
  }
  if(op==='sheet-delete-preset'){
   if(!presetId||!confirm('删除这份保存选项？标签与时间记录保留。'))return;busy=true;
   try{const id=presetId;await apiCall('entities/delete',{kind:'timesheets',id});if(active()){presets=presets.filter(v=>v.id!==id);presetId=null;render();}}finally{endBusy();}return;
  }
  if(op==='sheet-dates'){
   const now=new Date(),end=new Date(now),start=new Date(now);
   if(element.dataset.value==='week'){start.setDate(start.getDate()-(start.getDay()+6)%7);end.setTime(start.getTime());end.setDate(end.getDate()+6);}
   else if(element.dataset.value==='month'){start.setDate(1);end.setMonth(end.getMonth()+1,0);}
   else start.setDate(start.getDate()-6);
   form.from=day(start);form.through=day(end);model.sheetDirty=dirty();return render();
  }
  if(op==='sheet-add-group'){const next=Object.keys(groupChoices).find(v=>!form.definition.group_fields.includes(v));if(next&&form.definition.group_fields.length<6)form.definition.group_fields.push(next);model.sheetDirty=dirty();return render();}
  if(op==='sheet-remove-group'){if(form.definition.group_fields.length>1)form.definition.group_fields.splice(Number(element.dataset.index),1);model.sheetDirty=dirty();return render();}
  if(op==='sheet-sort'){
   const column=Number(element.dataset.column),old=applied.definition.sort_by,sort={column,descending:old?.column===column?!old.descending:false};
   form.definition.sort_by=sort;applied.definition.sort_by=clone(sort);model.sheetDirty=dirty();return load();
  }
  if(op==='sheet-generate'){
   range(form);if(!form.definition.sources.length)throw Error('请选择至少一个标签来源');if(new Set(form.definition.group_fields).size!==form.definition.group_fields.length)throw Error('分组字段不能重复');
   applied=clone(form);model.query=form.definition.query;model.sheetDirty=false;busy=true;try{return await load();}finally{endBusy();}
  }
 }
 const ids=new Set(['mt-sheet-from','mt-sheet-through','mt-sheet-total','mt-sheet-billable','mt-sheet-query','mt-sheet-round-enabled','mt-sheet-round-minutes','mt-sheet-rounding','mt-sheet-never-zero','mt-sheet-raw','mt-sheet-notes','mt-sheet-preset']);
 function change(el){
  if(usage.handlesChange(el))return usage.change(el);
  if(el.dataset?.sheetRow!==undefined||el.id==='mt-sheet-select-all'){
   if(el.id==='mt-sheet-select-all'){selectedRows.clear();if(el.checked)model.report.matrix.forEach(v=>selectedRows.add(v.key));}
   else if(el.checked)selectedRows.add(el.dataset.sheetRow);else selectedRows.delete(el.dataset.sheetRow);
   usage.bind(model.report,selectedRows);if(usage.active)return usage.read();return render();
  }
  if(el.id==='mt-sheet-preset'){
   collect();presetId=el.value||null;const value=presets.find(v=>v.id===presetId);if(value){form.definition={...clone(defaults),...clone(value.definition)};if(value.date_range){form.from=value.date_range.from;form.through=value.date_range.through;}roundDraft=form.definition.round_minutes||5;}model.sheetDirty=dirty();return render();
  }
  updateDraft();
 }
 document.addEventListener('input',event=>{if(ids.has(event.target.id)||event.target.dataset?.sheetSource!==undefined||event.target.dataset?.sheetGroup!==undefined)updateDraft();});
 return {read,html,handles:op=>operations.has(op)||usage.handles(op),action,handlesChange:el=>usage.handlesChange(el)||ids.has(el.id)||el.id==='mt-sheet-select-all'||el.dataset?.sheetRow!==undefined||el.dataset?.sheetSource!==undefined||el.dataset?.sheetGroup!==undefined,change,
  afterRender(){const control=q('#mt-sheet-select-all');if(control)control.indeterminate=selectedRows.size>0&&selectedRows.size<(model.report?.matrix.length||0);},ownsUsageEditor:usage.ownsEditor,submitUsage:usage.submit,
  suspend(){sequence++;presets=[];loaded=false;presetId=null;form=null;applied=null;selectedRows.clear();usage.suspend();model.sheetDirty=false;},get dirty(){collect();return dirty();}};
}};
