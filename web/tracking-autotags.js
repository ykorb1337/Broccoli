'use strict';
window.HotTurkeyAutoTagsUI={create({model,apiCall,load,attr,button,length,time}){
 const q=(s,r=document)=>r.querySelector(s),qa=(s,r=document)=>[...r.querySelectorAll(s)],clone=v=>JSON.parse(JSON.stringify(v));
 const fieldNames={title:'标题',group_name:'分组',application:'应用名称',bundle:'应用标识',url:'完整网址',document:'文档路径',path:'应用路径',repository:'Git 仓库',branch:'Git 分支'};
 const operators={contains:'包含',equals:'等于',starts:'开头是',ends:'结尾是',glob:'通配符',regex:'正则表达式'};
 const defaults={first_match:false,manual_tags:'off',gap_seconds:0,highlight_guessed:true};
 let items=[],settings={...defaults},draft=null,original=null,selected=null,busy=false,sequence=0,previewSequence=0,scope=null;
 const condition=()=>({timeline:'applications',field:'application',operator:'contains',value:'',exclude:false});
 const blank=()=>({name:'',tags:[],notes:'',color:'',billable:false,enabled:true,match:'all',mode:'tag',targets:[],append_data:false,conditions:[condition()]});
 const owns=()=>modal.open&&q('#mt-auto-root')&&page==='statistics'&&state.authenticated===true;
 const conversion=()=>modal.open&&q('#mt-auto-convert')&&page==='statistics'&&state.authenticated===true;
 const choose=(row)=>{selected=row?.id||null;draft=row?{...blank(),...clone(row)}:blank();delete draft.id;original=clone(draft);};
 const select=(id,label,options,value,extra='')=>`<select id="${id}" aria-label="${label}" ${extra}>${Object.entries(options).map(([k,v])=>`<option value="${k}" ${k===value?'selected':''}>${v}</option>`).join('')}</select>`;
 function collect(){
  if(!draft||!q('#mt-auto-name'))return;
  Object.assign(draft,{name:q('#mt-auto-name').value,tags:q('#mt-auto-tags').value.split(',').map(v=>v.trim()).filter(Boolean),notes:q('#mt-auto-notes').value,
   color:q('#mt-auto-color-mode').value==='fixed'?q('#mt-auto-color').value:'',enabled:q('#mt-auto-enabled').checked,billable:q('#mt-auto-billable').checked,
   match:q('#mt-auto-match').value,mode:q('#mt-auto-mode').value,append_data:q('#mt-auto-append-data').checked,targets:qa('[data-auto-target]:checked').map(v=>v.dataset.autoTarget),
   conditions:draft.conditions.map((_,i)=>({timeline:q('#mt-auto-source-'+i).value,field:q('#mt-auto-field-'+i).value,operator:q('#mt-auto-op-'+i).value,value:q('#mt-auto-value-'+i).value,exclude:q('#mt-auto-exclude-'+i).checked}))});
 }
 const discard=()=>{collect();return !draft||JSON.stringify(draft)===JSON.stringify(original)||confirm('放弃尚未保存的自动标签修改？');};
 function editor(){
  if(!draft)return '';
  const d=draft;
  const rows=d.conditions.map((v,i)=>`<div class="mt-auto-condition" data-auto-condition="${i}"><div class="mt-auto-condition-head"><span>条件 ${i+1}</span><span class="grow"></span><label><input id="mt-auto-exclude-${i}" type="checkbox" ${v.exclude?'checked':''}>排除时段</label>${button('auto-remove-condition','−',`data-index="${i}" aria-label="移除条件 ${i+1}" ${d.conditions.length===1?'disabled':''}`)}</div><div class="mt-auto-condition-fields">${select('mt-auto-source-'+i,'条件 '+(i+1)+' 时间线',{applications:'应用程序',documents:'文档',computer:'电脑使用'},v.timeline)}${select('mt-auto-field-'+i,'条件 '+(i+1)+' 字段',fieldNames,v.field)}${select('mt-auto-op-'+i,'条件 '+(i+1)+' 匹配方式',operators,v.operator)}<input id="mt-auto-value-${i}" aria-label="条件 ${i+1} 内容" maxlength="4096" value="${attr(v.value)}"></div></div>`).join('');
  const targets=d.mode==='tag'?'':`<details class="mt-auto-targets"><summary>${d.mode==='absorb'?'可由哪些自动标签吸收':'应用到指定自动标签'}</summary><p class="sheet-note">不勾选时使用全部普通自动标签。</p>${items.filter(v=>v.id!==selected&&v.mode==='tag').map(v=>`<label class="sheet-check"><input type="checkbox" data-auto-target="${v.id}" ${d.targets.includes(v.id)?'checked':''}><span>${attr(v.name)}</span></label>`).join('')}</details>`;
  return sheetGroup(selected?'编辑自动标签':'新增自动标签',field('名称',`<input id="mt-auto-name" maxlength="100" value="${attr(d.name)}">`)+field('标签',`<input id="mt-auto-tags" maxlength="3000" value="${attr(d.tags.join(', '))}">`)+field('备注',`<textarea id="mt-auto-notes" rows="2" maxlength="10000">${attr(d.notes)}</textarea>`,true)+`<details class="mt-auto-variables"><summary>动态字段</summary><p class="sheet-note">标签与备注可使用 {{title}}、{{group}}、{{application}}、{{url}}、{{document}}、{{repository}} 和 {{branch}}。标签用逗号分隔；正则捕获组使用 {{1}}、{{2}} 等。“全部满足”取第一个正则条件的活动与捕获组；没有正则时取首个包含条件。“任一满足”分别取匹配活动。</p></details>`+
   field('方式',select('mt-auto-mode','自动标签方式',{tag:'普通标签',append:'追加到其他标签后',prepend:'添加到其他标签前',absorb:'由邻近任务吸收'},d.mode))+targets+
   `<label class="sheet-check" ${d.mode==='absorb'?'hidden':''}><input id="mt-auto-append-data" type="checkbox" ${d.append_data?'checked':''}><span>将匹配分组追加为标签</span></label>`+
   `<label class="sheet-check"><input id="mt-auto-enabled" type="checkbox" ${d.enabled?'checked':''}><span>启用</span></label><label class="sheet-check"><input id="mt-auto-billable" type="checkbox" ${d.billable?'checked':''}><span>可计费时间</span></label>`+field('颜色',select('mt-auto-color-mode','自动标签颜色方式',{default:'自动',fixed:'指定颜色'},d.color?'fixed':'default')+`<input id="mt-auto-color" aria-label="自动标签颜色" type="color" value="${d.color||'#007aff'}" ${d.color?'':'hidden'}>`))+
   sheetGroup('匹配条件',field('包含条件',select('mt-auto-match','包含条件组合方式',{all:'全部满足（共同时间）',any:'任一满足（合并时间）'},d.match))+rows+`<div class="mt-auto-tools">${button('auto-add-condition','添加条件',d.conditions.length>=30?'disabled':'')}<span class="grow"></span>${button('auto-preview','测试当前日期')}</div><div id="mt-auto-preview" aria-live="polite"></div>`,'排除条件会扣除对应时间。追加、前插与吸收需要其他基础标签；测试显示条件匹配，实际结果由时间线呈现。吸收会推断任务归属，不跨越已知离开、睡眠时段或本地午夜。');
 }
 function render(focusId){
  const list=`<div class="mt-library-tools">${button('auto-new','＋ 新增')}<span class="grow"></span>${button('auto-up','上移',selected?'':'disabled')}${button('auto-down','下移',selected?'':'disabled')}${button('auto-delete','删除',selected?'':'disabled','danger')}</div><div class="mt-library-list" role="listbox" aria-label="自动标签列表">${items.map(v=>button('auto-select',`<span class="mt-color" style="--item-color:${v.color||'#007aff'}"></span><span>${attr(v.name)}</span>${v.enabled?'':'<small>已停用</small>'}`,`data-id="${v.id}" role="option" aria-selected="${v.id===selected}"`)).join('')||'<p class="sheet-status">暂无自动标签</p>'}</div>`;
  const options=sheetGroup('计算方式',`<label class="sheet-check"><input id="mt-auto-first" type="checkbox" ${settings.first_match?'checked':''}><span>优先匹配靠前标签，后续只处理剩余时间</span></label>`+field('普通标签',select('mt-auto-manual','普通标签如何应用到自动标签',{off:'不复制到自动标签',override:'覆盖对应时段的自动标签',modify:'覆盖后继续应用追加、前插与吸收'},settings.manual_tags))+field('填补小于（秒）的空档',`<input id="mt-auto-gap" type="number" min="0" max="3600" value="${settings.gap_seconds}">`)+`<p class="sheet-note">0 表示关闭。两侧任务不同时各分一半；已知离开、睡眠及跨午夜空档不填补。</p><label class="sheet-check"><input id="mt-auto-highlight" type="checkbox" ${settings.highlight_guessed?'checked':''}><span>标出吸收和填补的推断时段</span></label>`+button('auto-save-settings','保存计算方式'));
  openModal('自动标签',`<div id="mt-auto-root">${list}${editor()}<details class="mt-auto-options"><summary>计算方式</summary>${options}</details></div>`,button('close','完成')+button('auto-save','保存标签',draft?'':'disabled','primary'),'form');
  if(focusId)requestAnimationFrame(()=>{if(owns())q('#'+focusId)?.focus();});
 }
 async function read(){
  const marker=q('#mt-auto-root'),ticket=++sequence;if(!marker||!owns())return;
  let result;try{result=await apiCall('autotags');}catch(error){if(ticket===sequence&&owns()&&q('#mt-auto-root')===marker)throw error;return;}
  if(ticket!==sequence||!owns()||q('#mt-auto-root')!==marker)return;
  items=result.items;settings={...defaults,...result.settings};render();
 }
 async function mutation(run){
  if(busy)return;busy=true;const controls=qa('#mt-auto-root input,#mt-auto-root select,#mt-auto-root textarea,[data-mt^="auto-"]').map(node=>[node,node.disabled]);controls.forEach(([node])=>node.disabled=true);
  const marker=q('#mt-auto-root')||q('#mt-auto-convert');
  try{return await run();}catch(error){if((owns()||conversion())&&marker===(q('#mt-auto-root')||q('#mt-auto-convert')))throw error;}
  finally{busy=false;controls.forEach(([node,disabled])=>{if(node.isConnected)node.disabled=disabled;});}
 }
 async function refresh(){if(state.authenticated===true&&page==='statistics')await load();}
 function range(){if(model.loading||!model.data||model.data.day!==model.day)throw Error('请先打开日视图');return {since:model.data.since,until:model.data.until,selection:model.selection.map(v=>[...v])};}
 async function preview(){
  collect();const snapshot=clone(draft),marker=q('#mt-auto-preview'),ticket=++previewSequence;
  marker.textContent='正在匹配…';const date=new Date(model.day+'T00:00:00'),next=new Date(date);next.setDate(next.getDate()+1);const since=date.getTime()/1000,until=next.getTime()/1000;
  let result;try{result=await apiCall('autotags/preview',{value:snapshot,since,until});}catch(error){if(ticket===previewSequence&&owns()&&q('#mt-auto-preview')===marker){marker.textContent='';throw error;}return;}
  if(ticket!==previewSequence||!owns()||q('#mt-auto-preview')!==marker)return;
  marker.innerHTML=`<p class="sheet-status">${result.items.length} 段 · ${length(result.seconds)}${result.errors.length?' · '+result.errors.length+' 项动态字段错误':''}</p><div class="mt-auto-preview-list">${result.items.slice(0,100).map(v=>`<div><time>${time(v.start)}–${time(v.end)}</time><span>${attr(v.tags.join(', '))}</span></div>`).join('')}</div>${result.items.length>100?'<p class="sheet-note">仅显示前 100 段。</p>':''}${result.errors.slice(0,3).map(v=>'<p class="sheet-status">'+attr(v.message)+'</p>').join('')}`;
 }
 const operations=new Set(['auto-manager','auto-new','auto-select','auto-save','auto-delete','auto-up','auto-down','auto-add-condition','auto-remove-condition','auto-preview','auto-save-settings','auto-convert','auto-convert-submit']);
 async function action(op,element={}){
  if(busy)return;
  if(op==='auto-manager'){items=[];draft=null;selected=null;original=null;previewSequence++;render();return read();}
  if(op==='auto-convert'){
   scope=range();const selection=scope.selection.length?scope.selection:[[scope.since,scope.until]];
   openModal('转为普通标签',`<div id="mt-auto-convert">${sheetGroup('范围',`<p class="sheet-status">${attr(model.day)} · ${scope.selection.length?'已选时间':'全天'}</p>`+field('已有标签',select('mt-auto-overlap','标签重叠处理方式',{untagged:'只填未标记时间',double:'允许重叠',overwrite:'覆盖已有标签'},'untagged')),'保存当前自动标签结果。之后修改自动标签条件，不会改变已转存的标签；覆盖仅影响有结果的时段。')}</div>`,button('close','取消')+button('auto-convert-submit','转为标签','','primary'),'compact');return;
  }
  if(op==='auto-convert-submit'){
   const marker=q('#mt-auto-convert'),value={...clone(scope),mode:q('#mt-auto-overlap').value};if(!value.selection.length)delete value.selection;
   return mutation(async()=>{const result=await apiCall('autotags/convert',value);if(conversion()&&q('#mt-auto-convert')===marker){closeModal();toast('已保存 '+result.count+' 段标签');}await refresh();});
  }
  if(!owns())return;
  collect();
  if(op==='auto-select'||op==='auto-new'){if(!discard())return;choose(op==='auto-select'?items.find(v=>v.id===element.dataset.id):null);previewSequence++;render();return;}
  if(op==='auto-add-condition'){draft.conditions.push(condition());previewSequence++;render('mt-auto-value-'+(draft.conditions.length-1));return;}
  if(op==='auto-remove-condition'){const index=Number(element.dataset.index);if(draft.conditions.length>1)draft.conditions.splice(index,1);previewSequence++;render('mt-auto-value-'+Math.min(index,draft.conditions.length-1));return;}
  if(op==='auto-preview')return preview();
  if(op==='auto-save')return mutation(async()=>{
   const marker=q('#mt-auto-root'),value=await apiCall('autotags/save',{id:selected,value:clone(draft)});
   if(owns()&&q('#mt-auto-root')===marker){choose(value);await read();}await refresh();
  });
  if(op==='auto-delete'){
   if(!selected||!confirm('删除此自动标签？历史计算结果会随之移除，已转存的普通标签保留。'))return;
   return mutation(async()=>{const marker=q('#mt-auto-root');await apiCall('autotags/delete',{id:selected});if(owns()&&q('#mt-auto-root')===marker){draft=null;selected=null;await read();}await refresh();});
  }
  if(op==='auto-up'||op==='auto-down'){
   if(!discard())return;
   return mutation(async()=>{const marker=q('#mt-auto-root');await apiCall('autotags/move',{id:selected,direction:op==='auto-up'?-1:1});if(owns()&&q('#mt-auto-root')===marker)await read();await refresh();});
  }
  if(op==='auto-save-settings'){
   const value={first_match:q('#mt-auto-first').checked,manual_tags:q('#mt-auto-manual').value,gap_seconds:Number(q('#mt-auto-gap').value),highlight_guessed:q('#mt-auto-highlight').checked};
   return mutation(async()=>{const marker=q('#mt-auto-root');await apiCall('autotags/settings',value);if(owns()&&q('#mt-auto-root')===marker){settings=value;toast('计算方式已保存');}await refresh();});
  }
 }
 document.addEventListener('input',event=>{if(event.target.closest?.('#mt-auto-root')){previewSequence++;const preview=q('#mt-auto-preview');if(preview)preview.innerHTML='';}});
 document.addEventListener('change',event=>{
  if(event.target.closest?.('#mt-auto-root')){previewSequence++;const preview=q('#mt-auto-preview');if(preview)preview.innerHTML='';}
  if(!owns()||busy)return;
  if(event.target.id==='mt-auto-mode'){collect();render();}
  if(event.target.id==='mt-auto-color-mode')q('#mt-auto-color').hidden=event.target.value!=='fixed';
 });
 return {handles:op=>operations.has(op),action,suspend(){sequence++;previewSequence++;items=[];draft=null;original=null;scope=null;}};
}};
