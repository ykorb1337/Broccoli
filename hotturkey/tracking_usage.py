"""Activity details within a generated timesheet, including disjoint ranges."""
import datetime as dt
import hashlib
import json
from collections import defaultdict
from .model import PolicyError
from .tracking import filter_match,intersect,intervals,seconds,subtract,text
from .tracking_search import compile_query,filter_records
from .tracking_day import display_runs

DEFAULTS={'timeline':'applications','group_by':'details','query':'','row_keys':None,'offset':0,'limit':200}


def validate(value):
    if not isinstance(value,dict) or set(value)-set(DEFAULTS):raise PolicyError('使用明细选项无效')
    v={**DEFAULTS,**value}
    if v['timeline'] not in ['applications','documents','computer'] or v['group_by'] not in ['details','group','title']:raise PolicyError('使用明细分组无效')
    if type(v['offset']) is not int or v['offset']<0 or type(v['limit']) is not int or not 1<=v['limit']<=500:raise PolicyError('使用明细分页无效')
    keys=v['row_keys']
    if keys is not None and (not isinstance(keys,list) or not keys or len(keys)>10000 or any(not isinstance(k,str) for k in keys)):raise PolicyError('请选择有效的工时表行')
    v['row_keys']=list(dict.fromkeys(keys)) if keys is not None else None;v['query']=text(v['query'],4096);compile_query(v['query']);return v


def work_ranges(work,keys):
    mapping=work['ranges_by_row']
    if keys is not None and any(k not in mapping for k in keys):raise PolicyError('工时表行已变化，请重新生成')
    return intervals([span for key,ranges in mapping.items() if keys is None or key in keys for span in ranges])


def render(tracking,snapshot,options=None):
    options=validate({} if options is None else options);work=tracking.report_snapshots.get(snapshot,'work');report=work['report']
    coverage=work_ranges(work,options['row_keys']);pieces=[]
    if coverage:
        rows=display_runs(tracking.activities(report['since'],report['until'],options['timeline'],_derived=False))
        for row in filter_records(rows,options['query']):
            for a,b in intersect([[row['start'],row['end']]],coverage):
                pieces.append({**row,'start':a,'end':b,'seconds':b-a,'ranges':[[a,b]],'activity_id':row['id']})
    grouped=defaultdict(list)
    for piece in pieces:
        key=(piece['activity_id'],piece['start'],piece['end']) if options['group_by']=='details' else (piece['group_name'] if options['group_by']=='group' else piece['title'])
        grouped[key].append(piece)
    items=[]
    for rows in grouped.values():
        rows.sort(key=lambda r:(r['start'],r['end'],r['activity_id']));first=rows[0];ranges=intervals([span for row in rows for span in row['ranges']])
        title=first['group_name'] if options['group_by']=='group' else first['title'];groups=list(dict.fromkeys(r['group_name'] for r in rows));apps=list(dict.fromkeys(r['application'] for r in rows if r['application']))
        key=hashlib.sha256(json.dumps([options['timeline'],options['group_by'],title,first['activity_id'] if options['group_by']=='details' else '',ranges],ensure_ascii=False).encode()).hexdigest()
        refs=[ref for group,entries in work['refs_by_row'].items() if options['row_keys'] is None or group in options['row_keys'] for ref in entries if intersect([[ref['start'],ref['end']]],ranges)]
        suggested={tuple(ref['tags']) for ref in refs};note_values={ref['notes'] for ref in refs};auto=any(ref['timeline']=='autotags' for ref in refs)
        items.append({'key':key,'title':title,'group_name':groups[0] if len(groups)==1 else '多个分组','application':apps[0] if len(apps)==1 else '多个应用' if apps else '',
            'bundle':first.get('bundle','') if len(apps)<=1 else '','url':first.get('url','') if len(rows)==1 else '',
            'document':first.get('document','') if len(rows)==1 else '','timeline':options['timeline'],'start':ranges[0][0],'end':ranges[-1][1],
            'seconds':seconds(ranges),'ranges':ranges,'first_range':rows[0]['ranges'][0],'first_activity_id':rows[0]['activity_id'],'color':first['color'],'count':len(rows),'legacy':any(r['source']=='legacy' for r in rows),
            'retag_defaults':{'tags':list(next(iter(suggested))) if len(suggested)==1 else [],'notes':next(iter(note_values)) if len(note_values)==1 else '',
                'billable':bool(refs) and all(ref['billable'] for ref in refs),'auto_override':auto}})
    items.sort(key=lambda r:(r['start'],r['end'],r['title'],r['key']))
    detail=options['group_by']=='details';columns=[{'name':'标题','kind':'text'},{'name':'分组','kind':'text'},
        {'name':'开始' if detail else '首次出现','kind':'datetime'},{'name':'结束' if detail else '末次出现','kind':'datetime'},
        {'name':'时长（秒）','kind':'seconds'},{'name':'片段数','kind':'number'},{'name':'来源','kind':'text'}]
    table=[[r['title'],r['group_name'],dt.datetime.fromtimestamp(r['start']).isoformat(sep=' ',timespec='seconds'),
        dt.datetime.fromtimestamp(r['end']).isoformat(sep=' ',timespec='seconds'),r['seconds'],r['count'],'旧版汇总' if r['legacy'] else '活动记录'] for r in items]
    result={'kind':'timesheet-usage','since':report['since'],'until':report['until'],'definition':report['definition'],'options':options,'columns':columns,
        'table':table,'items':items,'total':len(items),'offset':options['offset'],'limit':options['limit'],
        'seconds':seconds([span for r in items for span in r['ranges']]),'work_seconds':seconds(coverage),'errors':report['errors']}
    token=tracking.report_snapshots.put('usage',{'report':result,'work':work})
    page={**result,'snapshot':token};page['items']=items[options['offset']:options['offset']+options['limit']];page['table']=table[options['offset']:options['offset']+options['limit']]
    return page


def lookup(tracking,snapshot,key):
    value=tracking.report_snapshots.get(snapshot,'usage')
    if not isinstance(key,str):raise PolicyError('请选择有效的使用片段')
    row=next((r for r in value['report']['items'] if r['key']==key),None)
    if row is None:raise PolicyError('使用明细已变化，请刷新后重试')
    return value,row


def retag(tracking,snapshot,key,tag):
    value,row=lookup(tracking,snapshot,key)
    if not isinstance(tag,dict) or set(tag)-{'tags','notes','billable','auto_override'}:raise PolicyError('重新标注选项无效')
    ranges=row['ranges']
    if len(ranges)>1000:raise PolicyError('所选片段过多，请缩小日期或使用明细范围')
    work=value['work'];keys=value['report']['options']['row_keys']
    refs=[ref for group,items in work['refs_by_row'].items() if keys is None or group in keys for ref in items if intersect([[ref['start'],ref['end']]],ranges)]
    ordinary=[r for r in refs if r['timeline']=='tags'];auto=any(r['timeline']=='autotags' for r in refs)
    with tracking.tag_library.transaction():
        if auto:
            current=tracking.db.execute('SELECT id,start,end FROM tracking_tags WHERE start<? AND end>?',(row['end'],row['start'])).fetchall()
            if any(r['id'] not in work['captured_tag_ids'] and intersect([[r['start'],r['end']]],ranges) for r in current):raise PolicyError('原标签已更改，请重新生成工时表后再标注')
        for ref in ordinary:
            current=tracking.db.execute('SELECT * FROM tracking_tags WHERE id=?',(ref['id'],)).fetchone()
            wanted=intersect([[ref['start'],ref['end']]],ranges)
            if current is None or json.loads(current['tags'])!=ref['tags'] or current['notes']!=ref['notes'] or bool(current['billable'])!=ref['billable'] or subtract(wanted,[[current['start'],current['end']]]):
                raise PolicyError('原标签已更改，请重新生成工时表后再标注')
        tracking.tag_library.cut_ranges(ranges,{r['id'] for r in ordinary})
        result=tracking.save_tag({**tag,'ranges':ranges,'auto_override':tag.get('auto_override',auto)})
    return {**result,'seconds':seconds(ranges),'range_count':len(ranges),'auto_override':tag.get('auto_override',auto)}
