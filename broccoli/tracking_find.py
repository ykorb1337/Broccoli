"""Date-range activity search, private snapshots and exact bulk tagging."""
import datetime as dt
import hashlib
import json
from .model import PolicyError
from .tracking import TIMELINES,bounds,intervals,seconds,subtract,text
from .tracking_day import display_runs
from .tracking_search import compile_query

FIELDS=['id','timeline','start','end','seconds','title','group_name','application','bundle','url','document','source','color','notes','billable']
ORDER={'start','end','seconds','title','application','timeline'}


def definition(value):
    if not isinstance(value,dict) or set(value)-{'since','until','timeline','query','untagged'}:raise PolicyError('搜索选项无效')
    since,until=bounds(value.get('since'),value.get('until'));timeline=value.get('timeline','all');untagged=value.get('untagged',False)
    if not isinstance(timeline,str) or timeline not in ['all',*TIMELINES] or type(untagged) is not bool:raise PolicyError('搜索时间线或选项无效')
    query=text(value.get('query',''),4096);compile_query(query)
    return {'since':since,'until':until,'timeline':timeline,'query':query,'untagged':untagged}


def collect(tracking,value):
    since,until=value['since'],value['until'];kind=value['timeline'];search=compile_query(value['query']);errors=[]
    rows=[];tags=tracking.tags(since,until) if value['untagged'] or kind in ['all','tags'] else []
    if kind!='tags':
        raw=tracking.activities(since,until,None if kind in ['all','autotags'] else kind,_derived=False)
        if kind in ['all','autotags']:
            calculated=tracking.autotags.evaluate(since,until,records=raw);errors=calculated['errors']
            rows=display_runs(raw) if kind=='all' else [];rows+=calculated['items']
        else:rows=display_runs(raw)
    if kind in ['all','tags']:rows+=tags
    if value['untagged']:
        coverage=intervals([[r['start'],r['end']] for r in tags]);pieces=[]
        for row in rows:
            for a,b in subtract([[row['start'],row['end']]],coverage):pieces.append({**row,'start':a,'end':b,'seconds':b-a})
        rows=pieces
    result=[]
    for row in search.filter(rows):
        item={k:row.get(k,'') for k in FIELDS};item['display_title']=row.get('url') or row.get('document') or row['title'] if row['timeline']=='documents' else row['title']
        item['key']=hashlib.sha256(json.dumps([row['timeline'],row['id'],row['start'],row['end']],separators=(',',':')).encode()).hexdigest()
        item['first_range']=[row['start'],row['end']];item['first_activity_id']=row.get('original_id',row['id']);result.append(item)
    result.sort(key=lambda r:(r['start'],r['end'],r['timeline'],r['key']))
    return {'definition':value,'items':result,'errors':errors,'seconds':seconds([[r['start'],r['end']] for r in result])}


def snapshot(tracking,key):
    try:return tracking.report_snapshots.get(key,'search')
    except PolicyError:raise PolicyError('搜索结果已失效，请重新搜索') from None


def page(tracking,key,offset=0,limit=100,sort='start',direction='asc'):
    if type(offset) is not int or offset<0 or type(limit) is not int or not 1<=limit<=200 or not isinstance(sort,str) or sort not in ORDER or direction not in ['asc','desc']:raise PolicyError('搜索分页或排序无效')
    data=snapshot(tracking,key);items=data['items']
    if sort!='start' or direction!='asc':
        field='display_title' if sort=='title' else sort
        items=sorted(items,key=lambda r:(r[field].casefold() if isinstance(r[field],str) else r[field],r['start'],r['key']),reverse=direction=='desc')
    return {**{k:data[k] for k in ['definition','errors','seconds']},'snapshot':key,'items':items[offset:offset+limit],'total':len(items),'offset':offset,'limit':limit,'sort':sort,'direction':direction}


def render(tracking,value):
    data=collect(tracking,definition(value));key=tracking.report_snapshots.put('search',data);return page(tracking,key)


def selected(data,selection):
    if selection is None:return data['items']
    if not isinstance(selection,dict) or set(selection)!={'all','keys'} or type(selection['all']) is not bool:raise PolicyError('搜索结果选择无效')
    keys=selection['keys']
    if not isinstance(keys,list) or len(keys)>10000 or any(not isinstance(k,str) for k in keys):raise PolicyError('搜索选择过多，请使用全部结果或分批选择')
    keys=set(keys);known={r['key'] for r in data['items']}
    if not keys<=known:raise PolicyError('搜索结果选择已变化，请重新搜索')
    return [row for row in data['items'] if (row['key'] not in keys if selection['all'] else row['key'] in keys)]


def preview(tracking,key,selection):
    data=snapshot(tracking,key)
    if data['errors']:raise PolicyError('自动标签存在计算错误，请修正后重新搜索')
    rows=selected(data,selection);ranges=intervals([[r['start'],r['end']] for r in rows])
    return {'count':len(rows),'range_count':len(ranges),'seconds':seconds(ranges)}


def tag(tracking,key,selection,value):
    if not isinstance(value,dict) or set(value)-{'tags','notes','billable','auto_override','color'}:raise PolicyError('搜索标注无效')
    data=snapshot(tracking,key)
    if data['errors']:raise PolicyError('自动标签存在计算错误，请修正后重新搜索')
    rows=selected(data,selection);ranges=intervals([[r['start'],r['end']] for r in rows])
    if not ranges:raise PolicyError('请先选择要标注的搜索结果')
    count=0
    # Keep one atomic transaction even when thousands of separate result
    # intervals exceed the ordinary form's per-call range limit.
    with tracking.tag_library.transaction():
        for offset in range(0,len(ranges),1000):count+=len(tracking.save_tag({**value,'ranges':ranges[offset:offset+1000]})['ids'])
    return {'count':count,'seconds':seconds(ranges),'result_count':len(rows)}


def export(tracking,key,selection,format):
    from .tracking_reports import export_table
    data=snapshot(tracking,key)
    if data['errors']:raise PolicyError('自动标签存在计算错误，请修正后导出搜索结果')
    rows=selected(data,selection)
    if format=='json':return json.dumps({'definition':data['definition'],'items':rows,'seconds':seconds([[r['start'],r['end']] for r in rows])},ensure_ascii=False).encode(),'application/json; charset=utf-8'
    table=[['时间线','标题或网址/路径','分组','应用程序','开始（本地）','结束（本地）','时长（秒）','来源']]
    for row in rows:table.append([row['timeline'],row['display_title'],row['group_name'],row['application'],dt.datetime.fromtimestamp(row['start']).isoformat(),dt.datetime.fromtimestamp(row['end']).isoformat(),row['seconds'],row['source']])
    return export_table(table,format)
