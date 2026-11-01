'use strict';
// Windows-style Day/Details/Summary workflow, using the app's native palette.
window.HotTurkeyTracking=(()=>{
 const names={tags:'标签',autotags:'自动标签',computer:'电脑使用',applications:'应用程序',documents:'文档'};
 const localDayKey=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 const model={view:'day',day:localDayKey(),timeline:'documents',summaryKind:'applications',detailedURLs:false,chronological:false,query:'',queries:{},selection:[],data:null,range:null,loading:false,seq:0,report:null,reportType:'top',reportTimeline:'applications',groupBy:'day',period:7,dayKey:'',selected:new Set(),detailWidth:38,detailSort:{key:'seconds',direction:'desc'}};
 let pointer=null,refreshTimer=null,dayIndex=null,detailScroll=0,summaryScroll=0,detailFrame=0,initialLoad=null;
 const q=(s,r=document)=>r.querySelector(s),qa=(s,r=document)=>[...r.querySelectorAll(s)];
 const attr=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const time=(v,seconds=true)=>{if(v==null)return '—';const d=new Date(v*1000);return [d.getHours(),d.getMinutes(),...(seconds?[d.getSeconds()]:[])].map(n=>String(n).padStart(2,'0')).join(':');};
 const inferredLabel=v=>v.inferred==='absorbed'?'推断：吸收':v.inferred==='gap'?'推断：填补空档':'';
 const length=v=>{v=Math.round(Math.max(0,v||0));return `${Math.floor(v/3600)}:${String(Math.floor(v%3600/60)).padStart(2,'0')}:${String(v%60).padStart(2,'0')}`;};
 const dateInput=v=>{const d=new Date(v*1000);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;};
 const button=(op,label,extra='',kind='')=>`<button type="button" data-mt="${op}" ${extra} class="${kind}">${label}</button>`;
 const selectLabels={'mt-activity-export-timeline':'导出内容','mt-activity-export-format':'导出格式','mt-timeline':'时间线','mt-summary-kind':'汇总类型','mt-chart-type':'统计类型','mt-group-by':'日期分组','mt-period':'日期范围','mt-displays':'截图显示器','mt-image-format':'截图格式','mt-image-quality':'截图清晰度','mt-delete-kind':'删除范围','mt-report-timeline':'统计时间线','mt-report-folder':'统计文件夹','mt-chart-style':'图表类型','mt-report-display':'显示图表或表格','mt-new-chart-type':'新图表类型','mt-series-timeline':'系列时间线','mt-series-match':'标签匹配方式','mt-export-format':'统计导出格式'};
 const select=(id,values,current)=>`<select id="${id}" aria-label="${selectLabels[id]||'统计选项'}">${Object.entries(values).map(([v,label])=>`<option value="${attr(v)}" ${v===String(current)?'selected':''}>${label}</option>`).join('')}</select>`;
 const apiCall=(path,data)=>api('tracking/'+path,data);
 const available=()=>state?.tracking?.version===1;
 const visible=()=>page==='statistics'&&available();
 const activityExport=window.HotTurkeyActivityExport?.create({model,attr,button,select,names,dateInput});
 const reports=HotTurkeyReportUI.create({model,apiCall,load,render,attr,button,select,names});
 const tags=HotTurkeyTags.create({model,apiCall,load,attr,button,tagModal});
 const timesheet=HotTurkeyTimesheetUI.create({model,apiCall,load,render,attr,button,length,tagTools:tags,jumpTo:jumpToUsage});
 const find=window.HotTurkeyFind?.create({model,apiCall,render,attr,button,names,length,tagTools:tags,jumpTo:jumpToUsage});
 const autotags=HotTurkeyAutoTagsUI.create({model,apiCall,load,attr,button,length,time});
 const clock=HotTurkeyClockUI.create({model,apiCall,render,load,attr,button,tagTools:tags,length});
 const media=HotTurkeyMedia.create({model,apiCall,render,load,tagModal,attr,button,select,time,resolveBar:(kind,at)=>dayIndex?.recordAt(kind,at)});
 function icon(record){
  if(record.timeline==='documents'){
   const target=HotTurkeyDayData.rootDomain(record.url||record.document)?(record.url||record.document):record.domain||'';
   if(target)return `<span class="activity-icon" data-activity-kind="website" data-activity-target="${attr(target)}" aria-hidden="true"></span>`;
   return `<span class="mt-color" style="--item-color:${attr(record.color)}" aria-hidden="true"></span>`;
  }
  const app=record.timeline==='applications'||record.application,target=record.bundle?'bundle:'+record.bundle:record.application||record.group_name||record.name;
  return app?`<span class="activity-icon" data-activity-kind="application" data-activity-target="${attr(target)}" aria-hidden="true"></span>`:`<span class="mt-color" style="--item-color:${attr(record.color)}" aria-hidden="true"></span>`;
 }
 function dayEnd(){const d=model.data;if(!d)return 1;return model.day===localDayKey()?Math.max(d.since+1,Math.min(d.until,Date.now()/1000)):d.until;}
 function constrain(a,b){const min=model.data.since,max=dayEnd(),width=Math.min(max-min,Math.max(60,b-a));a=Math.max(min,Math.min(max-width,a));return [a,a+width];}
 function bounds(){if(!model.data)return [0,1];return model.range?constrain(...model.range):[model.data.since,dayEnd()];}
 function zoom(factor,anchor=.5){const [a,b]=bounds(),at=a+(b-a)*anchor,width=(b-a)*factor;model.range=constrain(at-width*anchor,at+width*(1-anchor));}
 let timelineFrame=0;
 let selectionFrame=0;
 function queueSelection(){if(selectionFrame)return;selectionFrame=requestAnimationFrame(()=>{selectionFrame=0;const layer=q('.mt-selection-layer');if(layer&&visible())layer.innerHTML=selectionHTML();});}
 function paintTimeline(){const node=q('.mt-timelines');if(node){node.innerHTML=timelineHTML(true);media.afterRender();}}
 function queueTimeline(){if(timelineFrame)return;timelineFrame=requestAnimationFrame(()=>{timelineFrame=0;if(visible())paintTimeline();});}
 const rowRanges=row=>HotTurkeyDayData.ranges(row);
 function checkState(ranges){const spans=HotTurkeyDayData.union(ranges),selected=HotTurkeyDayData.duration(HotTurkeyDayData.intersection(spans,model.selection)),total=HotTurkeyDayData.duration(spans);return {full:total>0&&selected>=total-1e-6,partial:selected>0&&selected<total-1e-6,empty:!total};}
 function allCheckbox(id,label,ranges){const v=checkState(ranges);return `<input type="checkbox" id="${id}" aria-label="${label}" data-partial="${v.partial}" ${v.full?'checked':''} ${v.empty?'disabled':''}>`;}
 function summaryValues(){return dayIndex.summaries(model.summaryKind,model.selection,model.appScope,model.query?model.timeline:null);}

 const projection=(a,b)=>at=>Math.max(0,Math.min(100,(at-a)/(b-a)*100));
 function selectionHTML(windowBounds=bounds()){const [from,through]=windowBounds,fraction=projection(from,through),pixels=q('.mt-axis')?.getBoundingClientRect().width||600;return HotTurkeyDayData.selectionPlot(model.selection,from,through,pixels).map(([a,b])=>`<span class="mt-selection" style="left:${fraction(a)}%;width:${Math.max(0,fraction(b)-fraction(a))}%"></span>`).join('');}
 function load(){
  if(model.view==='search'){model.seq++;model.loading=false;render();return Promise.resolve();}
  const initial=['day','untagged'].includes(model.view)&&!model.data,key=[model.view,model.day,model.timeline,model.query].join('\0');
  if(initial&&initialLoad?.key===key)return initialLoad.job;
  const job=read();if(initial){const entry={key,job};initialLoad=entry;const clear=()=>{if(initialLoad===entry)initialLoad=null;};job.then(clear,clear);}return job;
 }
 async function read(){
  const seq=++model.seq,requestQuery=model.query;model.loading=true;model.error='';model.queryError='';
  try{
   if(['day','untagged'].includes(model.view)){
    // Time selection stays in the local index. Sending thousands of ranges in
    // a GET URL can exceed request limits and is redundant with computeDay().
    const params=new URLSearchParams({day:model.day,timeline:model.timeline,q:model.query,untagged:String(model.view==='untagged')});
    const data=await apiCall('day?'+params);
    if(seq!==model.seq)return;
    const changedDay=model.dayKey!==model.day;if(model.appliedQuery!==requestQuery)detailScroll=0;model.appliedQuery=requestQuery;model.appliedTimeline=model.timeline;model.queries[model.timeline]=requestQuery;model.data=data;dayIndex=HotTurkeyDayData.create(data);if(changedDay){model.appScope=null;detailScroll=0;summaryScroll=0;}computeDay();media.restore(data.settings);media.syncQuery();model.trackingInfo={settings:data.settings,status:data.status};if(changedDay)fit();model.dayKey=model.day;
   }else{
    const end=new Date(model.day+'T00:00:00');end.setDate(end.getDate()+1);const begin=new Date(end);begin.setDate(begin.getDate()-model.period);
    const params=new URLSearchParams({since:String(begin.getTime()/1000),until:String(end.getTime()/1000),timeline:model.reportTimeline,group_by:model.groupBy,limit:'10',q:model.query});
    const report=model.view==='timesheet'?await timesheet.read():await reports.read(begin.getTime()/1000,end.getTime()/1000);
    const info=await apiCall('settings');if(seq!==model.seq)return;model.report=report;model.trackingInfo=info;
   }
   model.loading=false;if(visible()){render();clock.read();}
  }catch(error){if(seq!==model.seq)return;model.loading=false;const current=['day','untagged'].includes(model.view)?model.data&&model.dayKey===model.day&&model.appliedTimeline===model.timeline:model.report;if(current&&/^(筛选条件无效|正则)/.test(error.message))model.queryError=error.message;else model.error=error.message;if(visible())render();}
 }
 function computeDay(){if(!dayIndex||!model.data)return;model.selection=HotTurkeyDayData.union(model.selection);model.data.details=dayIndex.details(model.timeline,model.appScope,model.view==='untagged',model.detailSort,Boolean(model.query),model.detailedURLs,model.chronological?'adjacent':'all');model.data.summary=dayIndex.summaries(model.timeline,model.selection,model.appScope,model.query?model.timeline:null);model.data.totals.selected=HotTurkeyDayData.duration(model.selection);}
 function localDay(reset=false,cleanOrphans=false){if(reset)detailScroll=0;if(cleanOrphans&&model.selection.length){computeDay();const visible=HotTurkeyDayData.union([...summaryValues().flatMap(v=>v.ranges),...model.data.details.flatMap(rowRanges)]);if(!HotTurkeyDayData.intersection(model.selection,visible).length)model.selection=[];}render();}
 function setTimeline(kind){if(kind!==model.timeline)model.detailSort=kind==='documents'?(model.chronological?{key:'start',direction:'asc'}:{key:'seconds',direction:'desc'}):{key:'start',direction:'asc'};clearTimeout(refreshTimer);model.queries[model.timeline]=model.query;model.timeline=kind;model.query=model.queries[kind]||'';model.seq++;model.loading=false;model.error='';model.queryError='';if(model.query&&model.query!==model.appliedQuery)return load();model.appliedTimeline=kind;return localDay(true);}
 function fit(){const d=model.data;if(!d)return;const rows=d.activities.filter(r=>r.timeline!=='tags'&&r.end>r.start);if(!rows.length){model.range=[d.since,d.until];return;}const a=Math.min(...rows.map(v=>v.start)),b=Math.max(...rows.map(v=>v.end));const padding=Math.max(300,(b-a)*.03);model.range=[Math.max(d.since,a-padding),Math.min(dayEnd(),Math.max(a+1800,b+padding))];}
 function mount(){
  if(!available())return false;
  if(!model.data&&!model.loading){model.error='';load();}
  render();return true;
 }
 function render(){
  if(!visible())return;
  const root=q('#content');root.classList.add('tracking-mode');
  const dayView=['day','untagged'].includes(model.view),d=model.data;if(dayView&&d)computeDay();
  const tabs=`<div class="mt-tabs" role="tablist" aria-label="使用统计视图">${Object.entries({day:'日视图',untagged:'未标记时间',timesheet:'工时表',statistics:'统计',search:'高级搜索'}).map(([value,title])=>button('view',title,`data-value="${value}" role="tab" aria-selected="${model.view===value}"`,model.view===value?'active':'')).join('')}<span class="grow"></span>${button('clock-setup','计时…')}${button('tag-manager','标签管理')}${button('auto-manager','自动标签')}</div>`;
  const sheet=model.view==='timesheet',exportDisabled=model.queryError||sheet&&(model.sheetDirty||model.loading||model.report?.errors?.length||model.sheetUsage?.active&&(model.sheetUsage.loading||!model.sheetUsage.report))?'disabled':'';
  const toolbar=model.view==='search'?`<div class="mt-toolbar">${button('view','返回日视图','data-value="day"')}<span class="grow"></span>${button('query-help','筛选用法')}</div>`:sheet?`<div class="mt-toolbar"><span>标签工时表</span><span class="grow"></span>${button('export','导出',exportDisabled)}</div>`:`<div class="mt-toolbar"><input id="mt-day" aria-label="统计日期" type="date" value="${attr(model.day)}">${button('previous-day','‹','aria-label="前一天" title="前一天"')}${button('next-day','›','aria-label="后一天" title="后一天"')}${button('today','今天')}<span class="mt-toolbar-divider"></span>${dayView?button('add-tag','＋ 添加标签','','primary')+button('clear-selection','取消选择','title="清除当前时间选择"')+`<span class="grow"></span>${button('zoom-out','−','aria-label="缩小时间线"')}${button('zoom-in','＋','aria-label="放大时间线"')}${button('fit','还原')}`:select('mt-period',{1:'当天',7:'最近 7 天',30:'最近 30 天',90:'最近 90 天',365:'最近一年'},model.period)+`<span class="grow"></span>${button('export','导出')}`}</div>`;
  const t=model.trackingInfo||d;
  const rangeStatus=model.report?`<span>${new Date(model.report.since*1000).toLocaleDateString('zh-CN')} — ${new Date((model.report.until-.001)*1000).toLocaleDateString('zh-CN')}</span><span>${sheet&&model.sheetUsage?.active?(model.sheetUsage.report?.total??'—')+' 项活动':model.report.series?model.report.series.length+' 个系列':(model.report.matrix?model.report.matrix.length:(model.report.rows||[]).length)+' 行'}</span>`:'';
  const status=t?`<div class="mt-status"><span class="mt-recording ${t.status?.connected&&t.settings.enabled&&t.settings.paused_until<=Date.now()/1000?'on':''}"></span>${button('pause',!t.status?.connected?'记录组件未连接':!t.settings.enabled?'恢复记录':t.settings.paused_until>Date.now()/1000?'记录已暂停':'跟踪已开启','','subtle')}<span class="grow"></span>${dayView&&d?.autotag_errors?.length?button('auto-manager','自动标签有 '+d.autotag_errors.length+' 项字段错误','','subtle'):''}${dayView&&d?`<span>开始 ${time(d.totals.first,false)}</span><span>结束 ${time(d.totals.last,false)}</span><span>活跃 ${length(d.totals.active)}</span><span>${model.selection.length?'已选择 '+length(d.totals.selected):''}</span>`:rangeStatus}</div>`:'';
  const body=model.view==='search'?find.html():model.error?`<div class="mt-error" role="alert">${attr(model.error)} ${button('reload','重试')}</div>`:dayView&&d?timelineHTML()+panesHTML():!dayView&&model.report?reportHTML():`<div class="mt-loading">正在读取记录…</div>`;
  root.innerHTML=`<section class="mt-workspace ${dayView?'day-view':'report-view'} ${clock.active()?'with-clock':''} ">${tabs}${toolbar}${clock.barHTML()}${body}<div class="mt-filter">${model.view==='search'?find.footer():`${sheet?'<span class="grow"></span>':`<label for="mt-query">筛选</label><div class="mt-query-field"><input id="mt-query" type="search" aria-label="筛选活动" aria-invalid="${Boolean(model.queryError)}" ${model.queryError?'aria-describedby="mt-query-error"':''} placeholder="标题、group:应用、duration>1m…" value="${attr(model.query)}">${button('query-help','?','aria-label="筛选用法"','mt-query-help')}</div>`}${dayView?button('delete','删除…','title="删除选中时间内的统计数据"'):''}`}${model.queryError?`<p id="mt-query-error" class="mt-query-error" role="alert">筛选未应用，仍显示上次结果。${attr(model.queryError)}</p>`:''}</div>${status}</section>`;
  timesheet.afterRender();media.afterRender();if(model.view==='search')find.afterRender();const detail=q('.mt-details-scroll'),summary=q('.mt-summary-scroll');if(detail){detail.scrollTop=detailScroll;paintDetailWindow();}if(summary)summary.scrollTop=summaryScroll;qa('[data-partial]').forEach(v=>v.indeterminate=v.dataset.partial==='true');
 }
 async function jumpToUsage(row){
  const [a,b]=row.first_range;model.view='day';model.report=null;model.day=new Date(a*1000).toLocaleDateString('en-CA');model.timeline=row.timeline;model.query='';model.selection=[[a,b]];model.selected=new Set([row.first_activity_id]);model.range=null;model.dayKey='';media.resetDay();
  await load();if(page!=='statistics'||model.view!=='day'||!model.data||!state.authenticated)return;
  const padding=Math.max(60,(b-a)*.1);model.range=[Math.max(model.data.since,a-padding),Math.min(model.data.until,b+padding)];render();
 }
 function timelineHTML(inner=false){
  const d=model.data,[a,b]=bounds(),fraction=projection(a,b);const order=['tags',...((d.autotags_enabled||d.activities.some(v=>v.timeline==='autotags'))?['autotags']:[]),'computer','applications','documents'];
  const ticks=Array.from({length:9},(_,i)=>{const t=a+(b-a)*i/8;return `<span style="left:${i/8*100}%">${time(t,false)}</span>`;}).join('');
  const rows=order.map(kind=>{
   const records=dayIndex.bars(kind,a,b);
   return `<div class="mt-track ${model.timeline===kind?'selected':''}">${button('timeline',names[kind],`data-value="${kind}"`,'mt-track-label')}<div class="mt-track-plot" data-timeline="${kind}" aria-label="${names[kind]}时间线">${records.map(v=>`<button class="mt-activity${v.highlighted?' mt-inferred':''}" type="button" data-mt="activity" data-id="${v.id}" data-timeline="${kind}"  aria-label="${attr(v.title+(inferredLabel(v)?' · '+inferredLabel(v):''))}，${time(v.start)}至${time(v.end)}" style="left:${fraction(v.plot_start)}%;width:${fraction(v.plot_end)-fraction(v.plot_start)}%;--item-color:${v.color}"></button>`).join('')}</div></div>`;
  }).join('');
  const end=dayEnd(),overviewTicks=Array.from({length:5},(_,i)=>`<small>${time(d.since+(end-d.since)*i/4,false)}</small>`).join('');
  const content=`<div class="mt-time-grid"><div class="mt-ruler"><span class="mt-track-label">${model.day}</span><div class="mt-track-plot mt-axis" data-timeline="${model.timeline}">${ticks}</div></div>${rows}<div class="mt-selection-layer" aria-hidden="true">${selectionHTML([a,b])}</div></div><div class="mt-overview"><span class="mt-track-label">${button('full-day','全天')}</span><div class="mt-overview-bar" tabindex="0" role="slider" aria-label="可见时间范围" aria-valuemin="${d.since}" aria-valuemax="${end}" aria-valuenow="${a}" aria-valuetext="${time(a,false)} 至 ${time(b,false)}"><span class="mt-overview-window" style="left:${(a-d.since)/(end-d.since)*100}%;width:${(b-a)/(end-d.since)*100}%"><i data-edge="start"></i><i data-edge="end"></i></span>${overviewTicks}</div></div>`;
  return inner?content:`<div class="mt-timeline-shell"><div class="mt-timelines">${content}</div></div>`;
 }
 function detailWindowHTML(rows,height=480){
  const window=HotTurkeyDayData.viewport(rows,detailScroll,height),spacer=n=>n?`<tr aria-hidden="true" class="mt-virtual-spacer"><td colspan="5" style="height:${n}px"></td></tr>`:'';
  return spacer(window.before)+window.rows.map(v=>{
   const selected=HotTurkeyDayData.duration(HotTurkeyDayData.intersection(rowRanges(v),model.selection)),title=HotTurkeyDayData.title(v);
   const legacy=v.source==='legacy'?`<small title="${v.sample_count>1?'合并 '+v.sample_count+' 条连续采样；':''}旧版汇总未保留窗口标题及完整网址">旧版汇总</small>`:'';
   return `<tr class="mt-detail-row ${dayIndex.taggedSeconds(v)>=v.seconds-.5?'tagged':''}" data-id="${attr(v.id)}"><td><input type="checkbox" data-mt-check="${attr(v.id)}" aria-label="选择 ${attr(title)}" data-partial="${selected>0&&selected<v.seconds-.001}" ${model.selection.length&&selected>0&&selected>=v.seconds-1e-6?'checked':''}></td><td><button type="button" data-mt="edit-activity" data-id="${attr(v.id)}" class="mt-record-title">${icon(v)}<span title="${attr(title+(v.timeline==='autotags'?' · '+(v.rule_names||[]).join('、')+(inferredLabel(v)?' · '+inferredLabel(v):''):''))}">${attr(title)}</span>${v.highlighted?'<small class="mt-inferred-badge">推断</small>':''}${v.billable?'<small>$</small>':''}${legacy}</button></td><td>${time(v.start)}</td><td>${time(v.end)}</td><td>${length(v.seconds)}</td></tr>`;
  }).join('')+spacer(window.after)||(rows.length?'':'<tr><td colspan="5" class="mt-empty">这段时间暂无匹配记录</td></tr>');
 }
 function paintDetailWindow(){
  const scroll=q('.mt-details-scroll'),body=q('.mt-details tbody');if(!scroll||!body||!model.data)return;
  const rows=model.data.details,key=HotTurkeyDayData.viewport(rows,detailScroll,scroll.clientHeight).first+':'+rows.length;
  const all=q('#mt-select-all');if(all){const spans=HotTurkeyDayData.union(rows.flatMap(rowRanges));all.disabled=!rows.length;all.checked=Boolean(rows.length&&model.selection.length&&!HotTurkeyDayData.without(spans,model.selection).length);all.indeterminate=!all.checked&&HotTurkeyDayData.intersection(spans,model.selection).length>0;}if(body.dataset.window===key)return;body.dataset.window=key;body.innerHTML=detailWindowHTML(rows,scroll.clientHeight);qa('[data-partial]',body).forEach(v=>v.indeterminate=v.dataset.partial==='true');
 }
 function panesHTML(){
  const d=model.data,rows=d.details,scope=model.appScope;
  const fullDetails=dayIndex.details(model.timeline,null,model.view==='untagged',model.detailSort,false,model.detailedURLs,model.chronological?'adjacent':'all'),detailRanges=HotTurkeyDayData.union(fullDetails.flatMap(rowRanges)),detailTotal=HotTurkeyDayData.duration(detailRanges),detailSelected=HotTurkeyDayData.duration(HotTurkeyDayData.intersection(detailRanges,model.selection));
  const headers=Object.entries({title:model.timeline==='documents'?(model.detailedURLs?'网址或文件路径':'网站或文件'):'窗口标题',start:'开始',end:'结束',seconds:'期间'}).map(([key,label])=>{const current=model.detailSort.key===key;return `<th scope="col" aria-sort="${current?(model.detailSort.direction==='asc'?'ascending':'descending'):'none'}">${button('detail-sort',label+`<span aria-hidden="true">${current?(model.detailSort.direction==='asc'?'↑':'↓'):''}</span>`,`data-key="${key}" aria-label="按${label}排序"`,'mt-sort')}</th>`;}).join('');
  const details=`<section class="mt-data-pane mt-detail-pane"><div class="mt-pane-head"><h2>明细</h2>${select('mt-timeline',names,model.timeline)}${model.timeline==='documents'?button('chronological','时序',`aria-pressed="${model.chronological}" title="按时间顺序，仅合并相邻访问"`,'mt-time-order')+button('detailed-urls','详细',`aria-pressed="${model.detailedURLs}" title="显示完整网址和逐次访问"`,'mt-time-order'):''}${scope?button('clear-context',attr(scope.name)+' ×','aria-label="清除应用筛选"','mt-context'):''}<span class="grow"></span>${model.timeline==='autotags'?button('auto-convert','转为标签…'):''}<small>${rows.length} ${model.timeline==='documents'&&!model.detailedURLs?'项':'段'}</small></div><div class="mt-table-scroll mt-details-scroll" tabindex="0" role="region" aria-label="活动明细滚动区域"><table class="mt-details"><colgroup><col class="mt-check-col"><col><col class="mt-time-col"><col class="mt-time-col"><col class="mt-time-col"></colgroup><thead><tr><th scope="col"><input type="checkbox" id="mt-select-all" aria-label="选择全部明细"></th>${headers}</tr></thead><tbody>${detailWindowHTML(rows)}</tbody></table></div><div class="mt-pane-total">${length(detailSelected)} / ${length(detailTotal)}</div></section>`;
  const kinds=[model.summaryKind];
  const summaries=kinds.map(kind=>{
   const values=dayIndex.summaries(kind,model.selection,scope,model.query?model.timeline:null),maximum=values[0]?.seconds||1;
   return `<section class="mt-summary-section">${values.map((v,i)=>{
    const selected=model.selection.length>0||Boolean(scope),partial=selected&&v.selected_seconds>0&&v.selected_seconds<v.seconds-.001,full=selected&&v.seconds>0&&v.selected_seconds>=v.seconds-.001;
    const attrs=`data-kind="${kind}" data-index="${i}"`,image=v.unknownBrowser?'<span class="activity-icon" data-activity-kind="website" aria-hidden="true"></span>':icon({...v,...v.rows[0],timeline:kind});
    return `<div class="mt-summary-row ${selected&&!v.selected_seconds?'mt-unselected':''}"><input type="checkbox" data-mt-group="${i}" ${attrs} aria-label="选择 ${attr(v.name)}" data-partial="${partial}" ${full?'checked':''}><button data-mt="group" ${attrs} class="mt-group-name" title="${v.unknownBrowser?'旧版网站统计未记录浏览器归属；新记录按实际应用关联':attr(v.name)}">${image}<span>${attr(v.name)}</span></button><div class="mt-summary-bar"><span style="width:${v.seconds/maximum*100}%;--item-color:${v.color}"></span></div><span class="mt-number">${selected?length(v.selected_seconds)+' / ':''}${length(v.seconds)}</span>${button('group-menu','⋯',attrs+` aria-label="${attr(v.name)}的操作"`,'mt-more')}</div>`;
   }).join('')||'<div class="mt-empty">暂无分组</div>'}</section>`;
  }).join('');
  const summaryRanges=HotTurkeyDayData.union(dayIndex.summaries(model.summaryKind,[],null,null).flatMap(v=>v.ranges)),summaryTotal=HotTurkeyDayData.duration(summaryRanges),summarySelected=HotTurkeyDayData.duration(HotTurkeyDayData.intersection(summaryRanges,model.selection));
  const summary=`<section class="mt-data-pane mt-summary-pane"><div class="mt-pane-head">${allCheckbox('mt-summary-all','选择全部汇总',summaryValues().flatMap(v=>v.ranges))}<h2>汇总</h2>${select('mt-summary-kind',Object.fromEntries(Object.entries(names).filter(([kind])=>kind!=='documents')),model.summaryKind)}<span class="grow"></span><small>${model.selection.length||scope?'选中 / 全天':'全天'}</small></div><div class="mt-summary-scroll">${summaries}</div><div class="mt-pane-total">${length(summarySelected)} / ${length(summaryTotal)}</div></section>`;
  return `<div class="mt-data-area"><div class="mt-data-grid" style="--mt-detail-width:${model.detailWidth}%">${summary}<div class="mt-split" role="separator" aria-label="调整汇总与明细宽度" tabindex="0"></div>${details}</div></div>`;
 }
 function selectedGroup(element){return dayIndex.summaries(element.dataset.kind||model.timeline,model.selection,model.appScope,model.query?model.timeline:null)[Number(element.dataset.index??element.dataset.mtGroup)];}
 function chooseGroup(element,checked=true,combine=false){
  const group=selectedGroup(element);if(!group)return;
  if(combine){let ranges=group.ranges;if(model.appScope&&group.timeline==='documents')ranges=HotTurkeyDayData.union(group.rows.filter(r=>dayIndex.sameApp(r,model.appScope)).map(r=>[r.start,r.end]));model.selection=checked?HotTurkeyDayData.union([...model.selection,...ranges]):HotTurkeyDayData.without(model.selection,ranges);model.appScope=null;model.selected.clear();localDay(false,!checked);qa('[data-mt-group]').find(v=>v.dataset.kind===element.dataset.kind&&v.dataset.index===element.dataset.index)?.focus();return;}
  model.selected.clear();model.appScope=null;model.selection=checked?group.ranges:[];
  if(checked&&group.timeline==='applications'){
   model.appScope={name:group.name,application:group.application,bundle:group.bundle,unknownBrowser:Boolean(group.unknownBrowser)};
   const browser=group.unknownBrowser||['com.microsoft.edgemac','com.google.chrome','org.mozilla.firefox','com.brave.browser','com.apple.safari'].includes((group.bundle||'').toLowerCase())||/^(Microsoft Edge|Edge|Google Chrome|Chrome|Safari|Firefox|Brave|Vivaldi|Opera)$/i.test(group.name);
   const documentSearch=Boolean(model.query&&group.documentMatch);if(documentSearch)model.queries.documents=model.query;
   return setTimeline(browser||documentSearch?'documents':'applications');
  }else if(checked)return setTimeline(group.timeline);
  localDay(true);
 }
 function reportHTML(){
  const r=model.report;
  if(model.view==='timesheet')return timesheet.html();
  return reports.html();
 }
 function tagModal(row=null){
  const d=model.data;if(!d)return;
  const selected=model.selection.length?model.selection:[[d.totals.first||d.since,d.totals.last||Math.min(d.until,Date.now()/1000)]];
  model.tagRanges=row?[[row.start,row.end]]:selected;model.editTag=row?.id||null;
  const a=Math.min(...model.tagRanges.map(v=>v[0])),b=Math.max(...model.tagRanges.map(v=>v[1]));
  openModal(row?'编辑标签':'添加标签',`${sheetGroup('标签',field('标签','<input id="mt-tag-text" autofocus maxlength="3000" placeholder="项目, 任务" value="'+attr(row?.tags?.join(', ')||'')+'">')+tags.tagEntryHTML(Boolean(row))+field('备注','<textarea id="mt-tag-notes" rows="2">'+attr(row?.notes||'')+'</textarea>',true)+`<label class="sheet-check"><input id="mt-tag-billable" type="checkbox" ${row?.billable?'checked':''}><span>可计费时间</span></label><label class="sheet-check"><input id="mt-tag-auto-override" type="checkbox" ${row?.auto_override?'checked':''}><span>覆盖此标签时段的自动标签</span></label>`)}${sheetGroup('时间',field('开始',`<input id="mt-tag-start" type="datetime-local" step="1" value="${dateInput(a)}">`)+field('结束',`<input id="mt-tag-end" type="datetime-local" step="1" value="${dateInput(b)}">`),selected.length>1?`已选择 ${selected.length} 个独立时间段，保持各段之间的间隔。`:'')}`,`${button('close','取消')}${row?button('delete-tag','删除标签','', 'danger'):''}${button('save-tag','保存','','primary')}`,'form');
  tags.prepare();
 }
 const weekNames=['周一','周二','周三','周四','周五','周六','周日'];
 const clockMinute=v=>`${String(Math.floor(v/60)).padStart(2,'0')}:${String(v%60).padStart(2,'0')}`;
 function paintSchedule(){
  const grid=q('#mt-schedule-grid');if(!grid)return;
  const week=HotTurkeyTrackingSchedule.days(model.scheduleDraft);
  qa('[data-mt-slot]',grid).forEach(cell=>{
   const minutes=HotTurkeyTrackingSchedule.coverage(week,Number(cell.dataset.day),Number(cell.dataset.mtSlot),Number(cell.dataset.mtSlot)+30);
   cell.dataset.selected=minutes>=30?'true':minutes>0?'partial':'false';cell.setAttribute('aria-pressed',minutes>=30?'true':minutes>0?'mixed':'false');
  });
 }
 function scheduleHTML(){
  const headings='<span></span>'+weekNames.map(v=>`<span>${v}</span>`).join('');
  const cells=Array.from({length:48},(_,slot)=>`<span class="mt-schedule-time">${slot%2?'':clockMinute(slot*30)}</span>`+weekNames.map((v,day)=>`<button type="button" data-mt="schedule-cell" data-mt-slot="${slot*30}" data-day="${day}" aria-label="${v} ${clockMinute(slot*30)}至${clockMinute(slot*30+30)}" aria-pressed="false"></button>`).join('')).join('');
  return `<div class="mt-schedule-scroll"><div class="mt-schedule-grid" id="mt-schedule-grid" aria-label="每周记录时段">${headings}${cells}</div></div><div class="mt-schedule-days">${weekNames.map((v,i)=>`<label><input type="checkbox" data-mt-schedule-day="${i}" ${i<5?'checked':''}>${v}</label>`).join('')}</div><div class="mt-schedule-edit">${field('从','<input id="mt-schedule-from" type="time" value="09:00">')}${field('至','<input id="mt-schedule-to" type="time" value="17:00">')}${button('schedule-add','添加')}${button('schedule-remove','移除')}</div>`;
 }
 function trackingFilter(s,key,list,label){
  return sheetGroup(label,field('记录范围',`<select id="mt-filter-${key}-mode" aria-label="${label}记录范围"><option value="exclude" ${s[key+'_mode']==='exclude'?'selected':''}>排除以下项目</option><option value="include" ${s[key+'_mode']==='include'?'selected':''}>仅记录以下项目</option></select>`)+field('匹配内容',`<textarea id="mt-filter-${key}" rows="3" aria-label="${label}匹配内容">${attr(s[list].join('\n'))}</textarea>`,true));
 }
 function settingsModal(initial='record'){
  const d=model.trackingInfo||model.data;if(!d)return;const s=d.settings;
  if(initial==='screenshots'){
   const format=s.screenshot_quality==='original'?'':field('格式',select('mt-image-format',Object.fromEntries((d.status?.formats||['jpeg','png']).map(v=>[v,v.toUpperCase()])),s.screenshot_format));
   const content=(format?sheetGroup('',format):'')+trackingFilter(s,'screenshot_application','screenshot_applications','截图应用程序');
   openModal('截图选项',content,`${button('close','取消')}${button('save-shot-options','保存','','primary')}`,'form');return;
  }
  model.scheduleDraft=JSON.parse(JSON.stringify(s.schedule));
  const schedule=sheetGroup('记录时段',`<label class="sheet-check"><input id="mt-schedule-enabled" type="checkbox" ${s.schedule_enabled?'checked':''}><span>只在指定时段记录</span></label><div id="mt-schedule-editor" ${s.schedule_enabled?'':'hidden'}>${scheduleHTML()}</div>`);
  const privacy=sheetGroup('',`<label class="sheet-check"><input id="mt-incognito" type="checkbox" ${state.settings.incognito_statistics?'checked':''}><span>记录隐私窗口统计</span></label>`)+schedule+trackingFilter(s,'application','applications','应用程序')+trackingFilter(s,'website','websites','网站')+trackingFilter(s,'document','documents','文档')+trackingFilter(s,'title','window_titles','窗口标题');
  openModal('隐私',privacy,`${button('close','取消')}${button('save-settings','保存','','primary')}`,'form');
  paintSchedule();
 }
 async function action(op,element){
  model.error='';
  if(op==='close'&&clock.phaseDialog())return clock.cancelPhase();
  if(clock.handles(op))return clock.action(op,element);
  if(timesheet.handles(op))return timesheet.action(op,element);
  if(autotags.handles(op))return autotags.action(op,element);
  if(find?.handles(op))return find.action(op,element);
  if(tags.handles(op))return tags.action(op,element);
  if(reports.handles(op))return reports.action(op,element);
  if(activityExport?.handles(op))return activityExport.action(op);
  if(media.handles(op))return media.action(op);
  if(op==='view'){if(element.dataset.value==='search')return find.open();find?.leave();model.view=element.dataset.value;model.report=null;return load();}
  if(['previous-day','next-day','today'].includes(op)){const date=new Date(model.day+'T12:00:00');if(op==='today')model.day=new Date().toLocaleDateString('en-CA');else{date.setDate(date.getDate()+(op==='next-day'?1:-1));model.day=date.toLocaleDateString('en-CA');}media.resetDay();model.selection=[];model.range=null;model.dayKey='';return load();}
  if(op==='timeline'){model.selected.clear();return setTimeline(element.dataset.value);}
  if(op==='query-help')return openModal('筛选用法',sheetGroup('',`<dl class="mt-query-guide"><dt>组合与排除</dt><dd><code>group:Edge (notes or calendar) -Private</code></dd><dt>时长</dt><dd><code>duration&gt;1m10s</code></dd><dt>本地时间</dt><dd><code>start&gt;09:00 end&lt;6:00PM</code></dd><dt>完整标题</dt><dd><code>title="Course notes"</code></dd><dt>通配符与正则</dt><dd><code>Draft*</code> · <code>#"chapter [0-9]+"</code></dd><dt>标签备注与计费</dt><dd><code>note:review label=billable</code></dd></dl>`),button('close','关闭'),'compact');
  if(op==='detailed-urls'){model.detailedURLs=!model.detailedURLs;localDay(true);q('[data-mt="detailed-urls"]')?.focus();return;}
  if(op==='chronological'){model.chronological=!model.chronological;model.detailSort=model.chronological?{key:'start',direction:'asc'}:{key:'seconds',direction:'desc'};localDay(true);q('[data-mt="chronological"]')?.focus();return;}
  if(op==='detail-sort'){const key=element.dataset.key;if(!['title','start','end','seconds'].includes(key))return;model.detailSort={key,direction:model.detailSort.key===key&&model.detailSort.direction==='asc'?'desc':'asc'};localDay(true);q(`[data-mt="detail-sort"][data-key="${key}"]`)?.focus();return;}
  if(op==='fit'){clearTimeout(refreshTimer);model.seq++;model.loading=false;model.query='';model.queries={};model.appScope=null;model.queryError='';model.error='';model.appliedQuery='';model.appliedTimeline=model.timeline;model.selection=[];model.selected.clear();media.syncQuery();if(!model.data||model.dayKey!==model.day)return load();fit();return localDay(true);}
  if(op==='full-day'){model.range=[model.data.since,dayEnd()];return render();}
  if(op==='zoom-in'||op==='zoom-out'){zoom(op==='zoom-in'?.5:2);return paintTimeline();}
  if(op==='clear-selection'||op==='clear-context'){model.selection=[];model.appScope=null;model.selected.clear();return localDay(true);}
  if(op==='activity'){if(Date.now()<(model.dragClickSuppressed||0))return;const row=dayIndex.byId.get(element.dataset.id);if(!row)return;model.appScope=null;model.selection=[[row.start,row.end]];model.selected=new Set([row.id]);return setTimeline(row.timeline);}
  if(op==='add-tag')return tagModal();
  if(op==='edit-activity'){const row=model.data.details.find(v=>v.id===element.dataset.id);if(row?.timeline==='tags')return tagModal(row);if(row?.timeline==='autotags'){const rules=(row.rule_names||[]).map(v=>'<li>'+attr(v)+'</li>').join('');return openModal('自动标签来源',sheetGroup(row.title,'<ul class="sheet-list">'+rules+'</ul>'+(row.inferred?'<p class="sheet-status">'+(row.inferred==='absorbed'?'吸收：将匹配的临时工具时段归入邻近任务。':'填补：根据两侧任务推断短空档；任务不同时各分一半。')+'</p>':'')+(row.notes?'<p class="sheet-status">'+attr(row.notes)+'</p>':'')),button('close','关闭')+button('auto-manager','编辑自动标签'),'compact');}if(row){model.selection=rowRanges(row);return localDay();}}
  if(op==='save-tag'){
   const editedStart=new Date(q('#mt-tag-start').value).getTime()/1000,editedEnd=new Date(q('#mt-tag-end').value).getTime()/1000;
   const ranges=model.tagRanges.length>1?model.tagRanges.map(([a,b])=>[Math.max(a,editedStart),Math.min(b,editedEnd)]).filter(([a,b])=>b>a):[[editedStart,editedEnd]];
   await apiCall('tags/save',{id:model.editTag,tag:{ranges,tags:q('#mt-tag-text').value,notes:q('#mt-tag-notes').value,billable:q('#mt-tag-billable').checked,auto_override:q('#mt-tag-auto-override').checked}});closeModal();return load();
  }
  if(op==='delete-tag'){await apiCall('tags/delete',{ids:[model.editTag]});closeModal();return load();}
  if(op==='settings'){model.trackingInfo=await apiCall('settings');return settingsModal();}
  if(op==='settings-tab'){
   qa('.mt-settings-tabs button',modal).forEach(v=>v.setAttribute('aria-selected',String(v===element)));
   qa('[id^="mt-settings-"][role=tabpanel]',modal).forEach(v=>v.hidden=v.id!=='mt-settings-'+element.dataset.value);
   const content=q('.modal-content',modal);if(content)content.scrollTop=0;window.HotTurkeyAppearance?.sync();
   return;
  }
  if(op==='schedule-cell'){
   if(Date.now()<(model.scheduleClickSuppressed||0))return;
   const start=Number(element.dataset.mtSlot);model.scheduleDraft=HotTurkeyTrackingSchedule.edit(model.scheduleDraft,[Number(element.dataset.day)],start,start+30,element.dataset.selected!=='true');paintSchedule();return;
  }
  if(op==='schedule-add'||op==='schedule-remove'){
   const parse=id=>{const value=q(id).value;if(!/^\d{2}:\d{2}$/.test(value))throw Error('请选择有效时间');const [h,m]=value.split(':').map(Number);return h*60+m;};
   const start=parse('#mt-schedule-from'),end=parse('#mt-schedule-to')||1440,days=qa('[data-mt-schedule-day]:checked',modal).map(v=>Number(v.dataset.mtScheduleDay));
   if(!days.length)throw Error('请选择星期');if(start===end)throw Error('开始和结束时间不能相同');
   model.scheduleDraft=HotTurkeyTrackingSchedule.edit(model.scheduleDraft,days,start,end,op==='schedule-add');paintSchedule();return;
  }
  if(op==='save-shot-options'){
   const settings={screenshot_application_mode:q('#mt-filter-screenshot_application-mode').value,screenshot_applications:q('#mt-filter-screenshot_application').value.split('\n').map(v=>v.trim()).filter(Boolean)};
   if(q('#mt-image-format'))settings.screenshot_format=q('#mt-image-format').value;
   await apiCall('settings',settings);closeModal();toast('已保存','saved');return window.HotTurkeyScreenshotSettings?.refresh();
  }
  if(op==='save-settings'){
   const filters={};for(const [key,list] of [['application','applications'],['website','websites'],['document','documents'],['title','window_titles']]){filters[key+'_mode']=q('#mt-filter-'+key+'-mode').value;filters[list]=q('#mt-filter-'+key).value.split('\n').map(v=>v.trim()).filter(Boolean);}
   await apiCall('settings',{...filters,schedule_enabled:q('#mt-schedule-enabled').checked,schedule:model.scheduleDraft});
   const incognito=q('#mt-incognito').checked;if(incognito!==state.settings.incognito_statistics){await api('settings',{incognito_statistics:incognito});state.settings.incognito_statistics=incognito;}closeModal();toast('已保存','saved');if(page==='settings')return window.HotTurkeyScreenshotSettings?.refresh();return load();
  }
  if(op==='permission'){window.webkit?.messageHandlers?.native?.postMessage({op:'tracking-permission',kind:element.dataset.kind});return;}
  if(op==='pause')return openModal('记录状态',`${sheetGroup('',Object.entries({resume:'开始记录',manual:'暂停，直到手动恢复','15m':'暂停 15 分钟','1h':'暂停 1 小时',tomorrow:'暂停到明天'}).map(([v,label])=>button('set-pause',label,`data-value="${v}"`,'choice-row')).join(''))}`,button('close','关闭'),'compact');
  if(op==='set-pause'){await apiCall('pause',{mode:element.dataset.value});closeModal();return load();}
  if(op==='group')return chooseGroup(element);
  if(op==='group-menu'){const group=selectedGroup(element);if(group.unknownBrowser)return openModal(group.name,sheetGroup('','<p class="sheet-status">旧版网站统计只保存了域名和时长，未保留所属浏览器、网页标题或完整网址。新记录会按实际浏览器关联。</p>'),button('close','关闭'),'compact');model.groupEdit=group;return openModal(group.name,`${sheetGroup('',field('分组颜色',`<input id="mt-group-color" type="color" value="${group.color}">`))}`,`${button('close','取消')}${button('save-color','保存','','primary')}`,'compact');}
  if(op==='save-color'){await apiCall('entities/save',{kind:'colors',value:{timeline:model.groupEdit.timeline,group:model.groupEdit.name,color:q('#mt-group-color').value}});closeModal();return load();}
  if(op==='delete'&&model.timeline==='autotags')return autotags.action('auto-manager');
  if(op==='delete')return openModal('删除统计记录',`${sheetGroup('',`<p class="sheet-status">${model.selection.length?'删除所选时间内的数据。':'删除当前日期的数据。'}</p>`+field('范围',select('mt-delete-kind',{selected:names[model.timeline],screenshots:'仅截图',all:'全部记录、标签和截图'},'selected')))}`,`${button('close','取消')}${button('confirm-delete','删除','','danger')}`,'compact');
  if(op==='confirm-delete'){const kind=q('#mt-delete-kind').value,ranges=model.selection.length?model.selection:[[model.data.since,model.data.until]];for(const [since,until] of ranges){if(kind!=='screenshots')await apiCall('delete',{since,until,timelines:kind==='all'?Object.keys(names):[model.timeline]});if(kind!=='selected')await apiCall('screenshots/delete',{since,until});}closeModal();return load();}
  if(op==='export')return exportData();
  if(op==='reload'){if(state.tracking?.available===false){await apiCall('retry',{});await refresh(false);}return load();}
  if(op==='close')return closeModal();
 }
 function exportData(){if(model.view==='search')return find.export();if(model.queryError)return toast('请先修正筛选条件');if(['statistics','timesheet'].includes(model.view))return reports.export();return activityExport.open();}
 document.addEventListener('click',event=>{const el=event.target.closest('[data-mt]');if(!el)return;event.preventDefault();action(el.dataset.mt,el).catch(error=>{if(modal.open)showModalError(error.message);else{model.error=error.message;render();}});});
 document.addEventListener('change',event=>{
  const el=event.target;
  if(find?.handlesChange(el)){find.change(el);if(el.id!=='mt-find-query')render();return;}
  if(timesheet.handlesChange(el)){Promise.resolve(timesheet.change(el)).catch(error=>{if(modal.open)showModalError(error.message);else toast(error.message);});return;}
  if(reports.handlesChange(el)){reports.change(el).catch(error=>{if(modal.open)showModalError(error.message);else{model.error=error.message;render();}});return;}
  if(el.id==='mt-schedule-enabled'){q('#mt-schedule-editor').hidden=!el.checked;return;}
  if(el.id==='mt-day'){model.day=el.value;model.range=null;model.dayKey='';media.resetDay();model.selection=[];load();}
  if(el.id==='mt-timeline')setTimeline(el.value);
  if(el.id==='mt-summary-kind'&&el.value!=='documents'&&names[el.value]){model.summaryKind=el.value;summaryScroll=0;localDay(false,true);}
  if(el.id==='mt-summary-all'){const ranges=HotTurkeyDayData.union(summaryValues().flatMap(v=>v.ranges));model.selection=el.checked?HotTurkeyDayData.union([...model.selection,...ranges]):[];localDay();q('#mt-summary-all')?.focus();}
  if(el.id==='mt-period'){model.period=Number(el.value);load();}
  if(el.id==='mt-chart-type'){model.reportType=el.value;load();}
  if(el.id==='mt-report-timeline'){model.reportTimeline=el.value;load();}
  if(el.id==='mt-group-by'){model.groupBy=el.value;load();}
  if(el.dataset.mtCheck){const row=model.data.details.find(r=>r.id===el.dataset.mtCheck);if(!row)return;model.selection=el.checked?HotTurkeyDayData.union([...model.selection,...rowRanges(row)]):HotTurkeyDayData.without(model.selection,rowRanges(row));localDay(false,!el.checked);qa('[data-mt-check]').find(v=>v.dataset.mtCheck===el.dataset.mtCheck)?.focus();}
  if(el.dataset.mtGroup!==undefined)chooseGroup(el,el.checked,true);
  if(el.id==='mt-select-all'){const spans=HotTurkeyDayData.union(model.data.details.flatMap(rowRanges));model.selection=el.checked?HotTurkeyDayData.union([...model.selection,...spans]):[];localDay();q('#mt-select-all')?.focus();}
 });
 function applyQuery(input){clearTimeout(refreshTimer);model.query=input.value;model.queries[model.timeline]=model.query;const start=input.selectionStart,end=input.selectionEnd;return load().then(()=>{if(!visible())return;const fresh=q('#mt-query');fresh?.focus();fresh?.setSelectionRange(start,end);});}
 document.addEventListener('input',event=>{find?.input(event.target);if(event.target.id==='mt-query'){const input=event.target;model.query=input.value;clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>applyQuery(input),300);}});
 document.addEventListener('keydown',event=>{if(event.target.id==='mt-find-query'&&event.key==='Enter'&&!event.isComposing){event.preventDefault();find.enter();return;}if(event.target.id==='mt-query'&&event.key==='Enter'&&!event.isComposing){event.preventDefault();applyQuery(event.target);}});
 document.addEventListener('scroll',event=>{const target=event.target;if(target.classList?.contains('mt-summary-scroll')){summaryScroll=target.scrollTop;return;}if(!target.classList?.contains('mt-details-scroll'))return;detailScroll=target.scrollTop;if(detailFrame)return;detailFrame=requestAnimationFrame(()=>{detailFrame=0;paintDetailWindow();});},true);
 document.addEventListener('pointerdown',event=>{
  const cell=event.target.closest('[data-mt-slot]');if(cell){
   const grid=cell.parentElement;pointer={schedule:grid,add:cell.dataset.selected!=='true',visited:new Set()};
   model.scheduleClickSuppressed=Date.now()+2000;paintScheduleCell(cell);grid.setPointerCapture(event.pointerId);event.preventDefault();return;
  }
  const overview=event.target.closest('.mt-overview-bar');if(overview&&event.button!==2){const r=overview.getBoundingClientRect(),range=bounds(),at=model.data.since+(event.clientX-r.left)/r.width*(dayEnd()-model.data.since),edge=event.target.dataset?.edge;pointer={overview:true,range,rect:r,startX:event.clientX,edge};if(!edge&&(at<range[0]||at>range[1])){model.range=constrain(at-(range[1]-range[0])/2,at+(range[1]-range[0])/2);pointer.range=[...model.range];}overview.closest('.mt-timeline-shell').setPointerCapture(event.pointerId);event.preventDefault();queueTimeline();return;}
  const split=event.target.closest('.mt-split');if(split){pointer={split,container:split.parentElement};split.setPointerCapture(event.pointerId);return;}
  const plot=event.target.closest('.mt-track-plot');if(!plot)return;
  const [a,b]=bounds(),rect=plot.getBoundingClientRect(),at=a+(event.clientX-rect.left)/rect.width*(b-a);pointer={plot,start:at,startX:event.clientX,timeline:plot.dataset.timeline,moved:false,selection:model.selection,combine:event.ctrlKey||event.metaKey};plot.setPointerCapture(event.pointerId);
 });
 document.addEventListener('pointermove',event=>{
  if(pointer?.schedule){const cell=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-mt-slot]');if(cell&&cell.parentElement===pointer.schedule)paintScheduleCell(cell);return;}
  if(pointer?.overview){const p=pointer,delta=(event.clientX-p.startX)/p.rect.width*(dayEnd()-model.data.since),[a,b]=p.range;model.range=p.edge==='start'?constrain(Math.min(b-60,a+delta),b):p.edge==='end'?constrain(a,Math.max(a+60,b+delta)):constrain(a+delta,b+delta);queueTimeline();return;}
  if(pointer?.split){const r=pointer.container.getBoundingClientRect();model.detailWidth=Math.max(25,Math.min(75,(event.clientX-r.left)/r.width*100));pointer.container.style.setProperty('--mt-detail-width',model.detailWidth+'%');return;}
  if(pointer?.plot){const [a,b]=bounds(),r=pointer.plot.getBoundingClientRect(),at=Math.max(a,Math.min(b,a+(event.clientX-r.left)/r.width*(b-a)));pointer.end=at;pointer.moved ||= Math.abs(event.clientX-pointer.startX)>3;if(pointer.moved){const step=(model.data.settings.snap_minutes||1)*60,ranges=[[Math.max(a,Math.round(Math.min(pointer.start,at)/step)*step),Math.min(b,Math.round(Math.max(pointer.start,at)/step)*step)]];model.selection=HotTurkeyDayData.union(pointer.combine?[...pointer.selection,...ranges]:ranges);queueSelection();}return;}
 });
 function paintScheduleCell(cell){const key=cell.dataset.day+':'+cell.dataset.mtSlot;if(pointer.visited.has(key))return;pointer.visited.add(key);const a=Number(cell.dataset.mtSlot);model.scheduleDraft=HotTurkeyTrackingSchedule.edit(model.scheduleDraft,[Number(cell.dataset.day)],a,a+30,pointer.add);paintSchedule();}
 document.addEventListener('pointerup',()=>{const p=pointer;pointer=null;if(p?.schedule)model.scheduleClickSuppressed=Date.now()+300;if(p?.plot&&p.moved){model.dragClickSuppressed=Date.now()+300;model.selection=model.selection.filter(([a,b])=>b>a);model.selected.clear();model.appScope=null;setTimeline(p.timeline);}});
 document.addEventListener('pointercancel',()=>{const p=pointer;pointer=null;if(p?.overview){model.range=p.range;paintTimeline();}if(p?.plot&&p.moved){model.selection=p.selection;localDay();}});
 document.addEventListener('wheel',event=>{if(!visible()||modal.open||pointer||!event.target.closest('.mt-timeline-shell'))return;event.preventDefault();const plot=q('.mt-axis'),r=plot.getBoundingClientRect();if(Math.abs(event.deltaX)>Math.abs(event.deltaY)&&!event.ctrlKey){const [a,b]=bounds(),shift=event.deltaX/r.width*(b-a);model.range=constrain(a+shift,b+shift);}else{const amount=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?r.width:1);zoom(Math.exp(Math.max(-.7,Math.min(.7,amount*.002))),Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)));}queueTimeline();},{passive:false});
 document.addEventListener('keydown',event=>{if(!event.target.matches?.('.mt-overview-bar')||!['ArrowLeft','ArrowRight','+','-','=','Home','End'].includes(event.key))return;event.preventDefault();const [a,b]=bounds(),shift=(b-a)*.1;if(['+','='].includes(event.key))zoom(.8);else if(event.key==='-')zoom(1.25);else if(event.key==='Home')model.range=constrain(model.data.since,model.data.since+b-a);else if(event.key==='End')model.range=constrain(dayEnd()-b+a,dayEnd());else model.range=constrain(a+(event.key==='ArrowLeft'?-shift:shift),b+(event.key==='ArrowLeft'?-shift:shift));paintTimeline();q('.mt-overview-bar')?.focus();});
 document.addEventListener('keydown',event=>{if(event.defaultPrevented||!visible())return;if(modal.open&&find?.ownsEditor()&&event.key==='Enter'&&!event.isComposing&&(event.target.id==='mt-tag-text'||event.target.id==='mt-tag-notes'&&(event.ctrlKey||event.metaKey))){event.preventDefault();find.submit().catch(error=>showModalError(error.message));return;}if(modal.open&&timesheet.ownsUsageEditor()&&event.key==='Enter'&&!event.isComposing&&(event.target.id==='mt-tag-text'||event.target.id==='mt-tag-notes'&&(event.ctrlKey||event.metaKey))){event.preventDefault();timesheet.submitUsage().catch(error=>showModalError(error.message));return;}if(modal.open&&clock.owns()&&event.key==='Enter'&&!event.isComposing&&(event.target.id==='mt-tag-text'||event.target.id==='mt-tag-notes'&&(event.ctrlKey||event.metaKey))){event.preventDefault();clock.submit().catch(error=>showModalError(error.message));return;}if(modal.open&&event.key==='Enter'&&!event.isComposing&&(event.target.id==='mt-tag-text'||event.target.id==='mt-tag-notes'&&(event.ctrlKey||event.metaKey))){event.preventDefault();action('save-tag',{}).catch(error=>showModalError(error.message));return;}if(event.target.matches('.mt-split')&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();model.detailWidth=Math.max(25,Math.min(75,model.detailWidth+(event.key==='ArrowRight'?5:-5)));event.target.parentElement.style.setProperty('--mt-detail-width',model.detailWidth+'%');return;}if(event.key==='Escape'&&!modal.open){model.selection=[];model.selected.clear();model.appScope=null;localDay();}});
 if(typeof setInterval==='function')setInterval(()=>{if(visible()&&!document.hidden&&!modal.open&&!pointer&&model.data&&['day','untagged'].includes(model.view)&&model.day===localDayKey())paintTimeline();},60000);
 return {available,mount,refresh:load,async openSettings(section='record'){const origin=page,value=await apiCall('settings');if(page!==origin||!state.authenticated)return;model.trackingInfo=value;settingsModal(section);},hidePrivateViews(){model.seq++;model.loading=false;initialLoad=null;model.data=null;model.queries={};model.query='';model.queryError='';model.error='';dayIndex=null;model.appScope=null;detailScroll=0;summaryScroll=0;model.report=null;model.trackingInfo=null;find?.suspend();activityExport?.suspend();clock.suspend();timesheet.suspend();autotags.suspend();media.suspend();if(page==='statistics'&&modal.open&&q('[data-mt]',modal))closeModal();},mediaAction(op){return action(op,{}).catch(error=>{if(modal.open)showModalError(error.message);else toast(error.message);});},mediaClosed:media.closed,dismissScreenshots:media.suspend,export:exportData,cancelModal(){if(clock.phaseDialog()){clock.cancelPhase().catch(error=>toast(error.message));return true;}if(modal.open&&q('[data-mt]',modal)){closeModal();return true;}return false;},get model(){return model;},setView(view){model.view=view;return load();},setDay(day){model.day=day;model.range=null;model.dayKey='';media.resetDay();model.selection=[];return load();}};
})();
// A navigation can finish while deferred tracking resources are still loading.
// Upgrade an already visible statistics page when this entrypoint becomes ready.
if(typeof page!=='undefined'&&page==='statistics'&&document.querySelector('#content')&&window.HotTurkeyTracking.available())window.HotTurkeyTracking.mount();
