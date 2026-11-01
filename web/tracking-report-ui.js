'use strict';
window.HotTurkeyReportUI={create({model,apiCall,load,render,attr,button,select,names}){
 const q=(s,r=document)=>r.querySelector(s),qa=(s,r=document)=>[...r.querySelectorAll(s)],clone=v=>JSON.parse(JSON.stringify(v));
 const kinds={top:'最多使用',duration:'每日时长',attendance:'出勤',untagged:'未标记时间',custom:'自定义图表'};
 const extra={saved:[],loaded:false,id:null,name:'应用使用',chart_type:'bar',show_average:false,limit:10,folder:'',series:[],attendance_seconds:3600,display:'chart',folders:[]};
 let seriesDraft=null,seriesIndex=null,seriesSequence=0,exportSequence=0;
 function definition(){return {name:extra.name,type:model.reportType,timeline:model.reportTimeline,group_by:model.groupBy,query:model.query,chart_type:extra.chart_type,show_average:extra.show_average,limit:extra.limit,folder:extra.folder,series:clone(extra.series),attendance_seconds:extra.attendance_seconds};}
 function activate(value){
  extra.id=value.id||null;extra.name=value.name;model.reportType=value.type;model.reportTimeline=value.timeline||'applications';model.groupBy=value.group_by||'day';model.query=value.query||'';
  for(const key of ['chart_type','show_average','limit','folder','series','attendance_seconds'])if(value[key]!==undefined)extra[key]=clone(value[key]);
 }
 async function read(since,until){
  if(!extra.loaded){const [saved,folders]=await Promise.all([apiCall('entities?kind=reports'),apiCall('entities?kind=folders')]);extra.saved=saved.items;extra.folders=folders.items;extra.loaded=true;if(extra.saved.length)activate(extra.saved[0]);}
  const value=definition(),report=await apiCall('reports/render',{since,until,definition:value});return {...report,definition:value};
 }
 function palette(){const s=getComputedStyle(document.body);return {ink:s.getPropertyValue('--ink').trim(),muted:s.getPropertyValue('--muted').trim(),line:s.getPropertyValue('--line').trim(),background:s.getPropertyValue('--panel').trim()};}
 function html(){
  const r=model.report;
  const tabs=`<div class="mt-report-tabs" role="tablist" aria-label="统计图表">${button('chart-default','临时图表',`role="tab" aria-selected="${!extra.id}"`)}${extra.saved.map(v=>button('chart-select',attr(v.name),`data-id="${attr(v.id)}" role="tab" aria-selected="${v.id===extra.id}"`)).join('')}${button('chart-new','＋','aria-label="新建统计图表"')}<span class="grow"></span>${button('chart-save','保存图表')}${extra.id?button('chart-rename','重命名')+button('chart-remove','删除图表'):''}</div>`;
  const folders={ '':'所有分组',...(model.reportTimeline==='documents'?{websites:'网站',files:'文件'}:{}),...Object.fromEntries(extra.folders.filter(v=>v.timeline===model.reportTimeline).map(v=>[v.id,v.name]))};
  const controls=`<div class="mt-report-controls">${select('mt-chart-type',kinds,model.reportType)}${model.reportType==='top'?select('mt-report-timeline',names,model.reportTimeline)+select('mt-report-folder',folders,extra.folder)+`<label>前 <input id="mt-top-limit" type="number" min="1" max="100" aria-label="最多显示分组数" value="${extra.limit}"> 项</label>`:''}${select('mt-group-by',{none:'总计',day:'按日',week:'按周',month:'按月',year:'按年'},model.groupBy)}${select('mt-chart-style',{bar:'柱状图',line:'折线图'},extra.chart_type)}<label><input id="mt-show-average" type="checkbox" ${extra.show_average?'checked':''}>平均值</label>${select('mt-report-display',{chart:'图表',table:'表格'},extra.display)}${model.reportType==='attendance'?`<label>出勤至少 <input id="mt-attendance-minutes" type="number" min="0" max="1440" value="${extra.attendance_seconds/60}" aria-label="出勤所需跨度（分钟）"> 分钟</label>`:''}</div>`;
  const series=model.reportType==='custom'?`<div class="mt-custom-series">${extra.series.map((s,i)=>`<div><span class="mt-color" style="--item-color:${attr(s.color||'#007aff')}"></span>${button('series-edit',attr(s.name),`data-index="${i}"`)}${button('series-remove','移除',`data-index="${i}" aria-label="移除 ${attr(s.name)}"`)}</div>`).join('')}${button('series-add','＋ 添加系列')}</div>`:'';
  const table=`<div class="mt-table-scroll"><table><thead><tr><th>日期</th>${r.series.map(v=>`<th>${attr(v.name)}</th>`).join('')}</tr></thead><tbody>${r.table.map(row=>`<tr><td>${attr(row[0])}</td>${row.slice(1).map((v,i)=>`<td>${attr(HotTurkeyChart.format(v,r.series[i].unit))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  return `<div class="mt-report">${tabs}${controls}${series}${extra.display==='table'?table:HotTurkeyChart.html(r,palette())}</div>`;
 }
 function createModal(rename=false){
  openModal(rename?'重命名图表':'新建图表',sheetGroup('',field('名称',`<input id="mt-chart-name" autofocus maxlength="200" value="${attr(rename?extra.name:kinds[model.reportType])}">`)+(rename?'':field('类型',select('mt-new-chart-type',kinds,model.reportType)))),`${button('close','取消')}${button(rename?'chart-rename-submit':'chart-new-submit','保存','','primary')}`,'compact');
 }
 async function save(asNew=false){
  const value=definition();if(asNew||!extra.id)value.name=q('#mt-chart-name')?.value||extra.name;
  const saved=await apiCall('entities/save',{kind:'reports',id:asNew?null:extra.id,value});
  const index=extra.saved.findIndex(v=>v.id===saved.id);if(index<0)extra.saved.push(saved);else extra.saved[index]=saved;activate(saved);return saved;
 }
 function collectSeries(){
  if(!q('#mt-series-name'))return;
  seriesDraft={name:q('#mt-series-name').value,timeline:q('#mt-series-timeline').value,query:q('#mt-series-query').value,color:q('#mt-series-color').value,match:q('#mt-series-match')?.value||'any',groups:qa('[data-mt-series-group]:checked',modal).map(v=>v.value),folder:seriesDraft?.folder||''};
 }
 async function seriesModal(index=null,existing=null){
  const sequence=++seriesSequence;seriesIndex=index;seriesDraft=existing||clone(index===null?{name:'新系列',timeline:'applications',groups:[],match:'any',query:'',color:['#007aff','#af52de','#30a46c','#e18a12','#da5260','#00a3a3'][extra.series.length%6]}:extra.series[index]);
  const report=model.report;if(!report)return;const params=new URLSearchParams({since:String(report.since),until:String(report.until),timeline:seriesDraft.timeline});
    const choices=(await apiCall('groups?'+params)).items;if(sequence!==seriesSequence||page!=='statistics'||model.view!=='statistics')return;
  const missing=seriesDraft.groups.filter(v=>!choices.some(c=>c.name===v));const items=[...choices,...missing.map(name=>({name,seconds:0}))];
  openModal(index===null?'添加统计系列':'编辑统计系列',`${sheetGroup('系列',field('名称',`<input id="mt-series-name" autofocus maxlength="200" value="${attr(seriesDraft.name)}">`)+field('时间线',select('mt-series-timeline',names,seriesDraft.timeline))+field('颜色',`<input id="mt-series-color" type="color" value="${attr(seriesDraft.color||'#007aff')}">`)+field('筛选',`<input id="mt-series-query" value="${attr(seriesDraft.query)}" placeholder="可选">`))}${sheetGroup('分组',`${seriesDraft.timeline==='tags'?field('匹配',select('mt-series-match',{any:'匹配任一标签',all:'匹配全部标签'},seriesDraft.match)):''}<input id="mt-series-search" type="search" aria-label="搜索系列分组" placeholder="搜索分组"><div class="mt-series-choices">${items.map(v=>`<label class="sheet-check" data-group-name="${attr(v.name.toLocaleLowerCase())}"><input type="checkbox" data-mt-series-group value="${attr(v.name)}" ${seriesDraft.groups.includes(v.name)?'checked':''}><span>${attr(v.name)}</span><small>${HotTurkeyChart.format(v.seconds)}</small></label>`).join('')||'<p class="sheet-status">这段时间没有可选分组</p>'}</div>`,'未勾选分组时统计整个时间线。')}`,`${button('close','取消')}${button('series-save','保存系列','','primary')}`,'form');
 }
 function exportModal(){
  if(model.loading)throw Error('统计正在更新，请稍后导出');
  if(model.view==='timesheet'&&model.sheetDirty)throw Error('工时表有未生成的修改，请先生成工时表');
  if(model.view==='timesheet'&&model.report?.errors?.length)throw Error('请先修正自动标签的计算错误');
  if(!model.report)throw Error('尚无可导出的报表');
  if(model.view==='timesheet'&&model.sheetUsage?.active&&(model.sheetUsage.loading||!model.sheetUsage.report))throw Error('请等待使用明细更新后再导出');
  const formats={csv:'CSV 数据',xlsx:'Excel 工作簿',json:'JSON 数据',...(model.view==='statistics'?{jpeg:'JPEG 图表'}:{})};
  openModal('导出统计',sheetGroup('',field('格式',select('mt-export-format',formats,'csv'))),`${button('close','取消')}${button('report-export-submit','导出','','primary')}`,'compact');
 }
 function saveBlob(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function closeForDownload(){
  closeModal();const deadline=Date.now()+4000;
  while(document.documentElement.classList.contains('native-sheet')){if(Date.now()>deadline)throw Error('请关闭编辑窗口后重试导出');await new Promise(resolve=>setTimeout(resolve,30));}
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 }
 async function exportReport(){
  if(model.loading||model.view==='timesheet'&&(model.sheetDirty||model.sheetUsage?.active&&model.sheetUsage.loading))return;
  const marker=q('#mt-export-format'),format=marker.value,root=model.report,view=model.view,usage=view==='timesheet'&&Boolean(model.sheetUsage?.active),report=usage?model.sheetUsage.report:root,ticket=++exportSequence;
  if(!report)return;
  const date=at=>{const d=new Date(at*1000);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
  const range=view==='timesheet'?date(report.since)+'_'+date(report.until-.001):model.day,name='HotTurkey-'+range+'-'+(usage?'timesheet-usage':view);
  const authorized=()=>ticket===exportSequence&&state.authenticated===true&&page==='statistics'&&model.report===root&&model.view===view&&(view!=='timesheet'||!model.sheetDirty&&Boolean(model.sheetUsage?.active)===usage&&(!usage||!model.sheetUsage.loading&&model.sheetUsage.report===report));
  const owns=()=>authorized()&&modal.open&&q('#mt-export-format')===marker;
  const control=q('[data-mt=report-export-submit]',modal);if(control)control.disabled=true;
  try{
   if(format==='json'&&!usage){if(!owns())return;await closeForDownload();if(authorized()){const value=report.snapshot?{...report}:report;if(report.snapshot)delete value.snapshot;download(name+'.json',value);}return;}
   if(format==='jpeg'){const blob=await HotTurkeyChart.image(report,palette());if(!owns())return;await closeForDownload();if(authorized())saveBlob(blob,name+'.jpg');return;}
   const payload=usage?{kind:'timesheet-usage',snapshot:report.snapshot}:{kind:view==='timesheet'?'timesheet':'report',since:report.since,until:report.until,definition:report.definition,...(view==='timesheet'&&report.snapshot?{snapshot:report.snapshot}:{})};
   const response=await fetch('/api/tracking/export',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-HotTurkey-Session':auth},body:JSON.stringify({...payload,format})});
   if(!owns())return;
   if(!response.ok)throw Error((await response.json()).error||'导出失败');const blob=await response.blob();if(!owns())return;await closeForDownload();if(authorized())saveBlob(blob,name+'.'+format);
  }catch(error){if(authorized()&&(owns()||!modal.open))throw error;}finally{if(control?.isConnected)control.disabled=false;}
 }
 const operations=new Set(['chart-default','chart-select','chart-new','chart-new-submit','chart-save','chart-rename','chart-rename-submit','chart-remove','series-add','series-edit','series-remove','series-save','report-export-submit']);
 async function action(op,element){
  if(op==='chart-default'){extra.id=null;extra.name='临时图表';return load();}
  if(op==='chart-select'){const value=extra.saved.find(v=>v.id===element.dataset.id);if(value)activate(value);return load();}
  if(op==='chart-new')return createModal();
  if(op==='chart-rename')return createModal(true);
  if(op==='chart-new-submit'){model.reportType=q('#mt-new-chart-type').value;extra.name=q('#mt-chart-name').value;if(model.reportType!=='custom')extra.series=[];await save(true);closeModal();return load();}
  if(op==='chart-save'){if(!extra.id)return createModal();await save();return render();}
  if(op==='chart-rename-submit'){extra.name=q('#mt-chart-name').value;await save();closeModal();return load();}
  if(op==='chart-remove'){if(!confirm('删除这张保存的图表？统计记录会保留。'))return;await apiCall('entities/delete',{kind:'reports',id:extra.id});extra.saved=extra.saved.filter(v=>v.id!==extra.id);extra.id=null;return load();}
  if(op==='series-add')return seriesModal();
  if(op==='series-edit')return seriesModal(Number(element.dataset.index));
  if(op==='series-remove'){extra.series.splice(Number(element.dataset.index),1);return load();}
  if(op==='series-save'){collectSeries();if(!seriesDraft.name.trim())throw Error('请输入系列名称');if(seriesIndex===null)extra.series.push(clone(seriesDraft));else extra.series[seriesIndex]=clone(seriesDraft);closeModal();return load();}
  if(op==='report-export-submit')return exportReport();
 }
 const controls=new Set(['mt-chart-type','mt-report-timeline','mt-group-by','mt-chart-style','mt-show-average','mt-report-display','mt-top-limit','mt-report-folder','mt-attendance-minutes','mt-series-timeline']);
 async function change(el){
  if(el.id==='mt-series-timeline'){const previous=seriesDraft.timeline;collectSeries();seriesDraft.groups=previous===el.value?seriesDraft.groups:[];seriesDraft.match='any';return seriesModal(seriesIndex,seriesDraft);}
  if(el.id==='mt-report-display'){extra.display=el.value;return render();}
  if(el.id==='mt-chart-type')model.reportType=el.value;
  if(el.id==='mt-report-timeline'){model.reportTimeline=el.value;extra.folder='';}
  if(el.id==='mt-group-by')model.groupBy=el.value;
  if(el.id==='mt-chart-style')extra.chart_type=el.value;
  if(el.id==='mt-show-average')extra.show_average=el.checked;
  if(el.id==='mt-top-limit'){const value=Number(el.value);if(!Number.isInteger(value)||value<1||value>100)throw Error('显示数量应为 1–100');extra.limit=value;}
  if(el.id==='mt-report-folder')extra.folder=el.value;
  if(el.id==='mt-attendance-minutes'){const value=Number(el.value)*60;if(!Number.isInteger(value)||value<0||value>86400)throw Error('出勤跨度应为 0–1440 分钟');extra.attendance_seconds=value;}
  return load();
 }
 document.addEventListener('input',event=>{if(event.target.id==='mt-series-search'){const needle=event.target.value.toLocaleLowerCase();qa('[data-group-name]',modal).forEach(v=>v.hidden=!v.dataset.groupName.includes(needle));}});
 return {read,html,export:exportModal,handles:op=>operations.has(op),action,handlesChange:el=>controls.has(el.id),change,definition};
}};
