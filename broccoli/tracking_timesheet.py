"""Tag timesheets: one interval calculation for the page, CSV and Excel.

Grouping is by selected fields (a single level is not a path prefix). Rounding
applies to the aggregated visible cells, never to individual observations.
"""
import datetime as dt
import hashlib
import math
from collections import defaultdict
from .model import PolicyError
from .tracking import bounds,day_bounds,filter_match,intervals,seconds,text
from .tracking_search import compile_query,filter_records

DEFAULTS={'sources':['tags'],'group_fields':['tags'],'total_by':'day','billable':None,'query':'',
          'round_minutes':0,'rounding':'nearest','never_zero':False,'include_unrounded':False,'include_notes':True,'sort_by':None}
LABELS={'tags':'标签','note':'备注','day':'日','month':'月','year':'年','timeline':'时间线','billable':'计费'}
SOURCE_LABELS={'tags':'普通标签','autotags':'自动标签'}


def validate(value):
    if not isinstance(value,dict) or set(value)-set(DEFAULTS):raise PolicyError('工时表选项无效')
    result={**DEFAULTS,**value};sources=result['sources'];fields=result['group_fields']
    if not isinstance(sources,list) or not sources or len(sources)>2 or any(v not in ['tags','autotags'] for v in sources):raise PolicyError('请选择标签来源')
    if not isinstance(fields,list) or not 1<=len(fields)<=6 or len(set(str(v) for v in fields))!=len(fields):raise PolicyError('请选择 1–6 个不同分组字段')
    for field in fields:
        if not isinstance(field,str):raise PolicyError('工时表分组无效')
        if field in LABELS:continue
        prefix,_,level=field.partition(':')
        if prefix not in ['level','prefix'] or not level.isdigit() or not 1<=int(level)<=30:raise PolicyError('工时表分组无效')
    if result['total_by'] not in ['none','day','week','month','year'] or result['rounding'] not in ['nearest','up','down','total']:raise PolicyError('工时表汇总方式无效')
    if result['billable'] is not None and type(result['billable']) is not bool:raise PolicyError('计费筛选无效')
    if type(result['round_minutes']) is not int or not 0<=result['round_minutes']<=60:raise PolicyError('舍入应为 0–60 分钟')
    if any(type(result[k]) is not bool for k in ['never_zero','include_unrounded','include_notes']):raise PolicyError('工时表开关无效')
    sort=result['sort_by']
    if sort is not None and (not isinstance(sort,dict) or set(sort)!={'column','descending'} or type(sort['column']) is not int or not 0<=sort['column']<=100000 or type(sort['descending']) is not bool):raise PolicyError('工时表排序无效')
    query=text(result['query'],4096);compile_query(query)
    return {**result,'sources':list(dict.fromkeys(sources)),'group_fields':list(fields),'query':query}


def validate_preset(value):
    if not isinstance(value,dict) or set(value)-{'name','definition','date_range'}:raise PolicyError('工时表设置无效')
    name=text(value.get('name',''),200).strip()
    if not name:raise PolicyError('请输入工时表名称')
    result={'name':name,'definition':validate(value.get('definition',{}))}
    if value.get('date_range') is not None:
        dates=value['date_range']
        if not isinstance(dates,dict) or set(dates)!={'from','through'}:raise PolicyError('日期范围无效')
        try:
            start=dt.date.fromisoformat(dates['from']);end=dt.date.fromisoformat(dates['through'])
            bounds(day_bounds(start.isoformat())[0],day_bounds(end.isoformat())[1])
        except (ValueError,TypeError):raise PolicyError('日期范围无效') from None
        result['date_range']={'from':start.isoformat(),'through':end.isoformat()}
    return result


def label(field):
    if field in LABELS:return LABELS[field]
    prefix,level=field.split(':');return ('第 '+level+' 级标签') if prefix=='level' else ('前 '+level+' 级标签')


def bucket(date,kind):
    if kind=='none':return '总计'
    if kind=='week':return (date-dt.timedelta(days=date.weekday())).isoformat()
    if kind=='month':return date.strftime('%Y-%m')
    if kind=='year':return str(date.year)
    return date.isoformat()


def group_value(row,field,date):
    if field=='tags':return ', '.join(row['tags'])
    if field=='note':return row['notes']
    if field=='day':return str(date.day)
    if field=='month':return str(date.month)
    if field=='year':return str(date.year)
    if field=='timeline':return SOURCE_LABELS[row['timeline']]
    if field=='billable':return '可计费' if row['billable'] else '不可计费'
    prefix,level=field.split(':');level=int(level)
    return ', '.join(row['tags'][:level]) if prefix=='prefix' else row['tags'][level-1] if len(row['tags'])>=level else '（无此级标签）'


def round_cells(rows,definition):
    quantum=definition['round_minutes']*60
    if not quantum:
        for row in rows:row['rounded_seconds']=row['seconds']
        return
    mode=definition['rounding'];minimum=definition['never_zero']
    if mode!='total':
        for row in rows:
            ratio=row['seconds']/quantum
            units=math.ceil(ratio) if mode=='up' else math.floor(ratio) if mode=='down' else math.floor(ratio+.5)
            row['rounded_seconds']=max(1 if minimum and ratio>0 else 0,units)*quantum
        return
    # Largest remainders keep the rounded grand total nearest to the raw total.
    # A minimum charge takes priority if its sum already exceeds that target.
    units=[max(1 if minimum and r['seconds']>0 else 0,math.floor(r['seconds']/quantum)) for r in rows]
    target=max(sum(units),math.floor(sum(r['seconds'] for r in rows)/quantum+.5))
    order=sorted(range(len(rows)),key=lambda i:(-(rows[i]['seconds']/quantum-units[i]),i))
    for i in order[:target-sum(units)]:units[i]+=1
    for row,value in zip(rows,units):row['rounded_seconds']=value*quantum


def render(tracking,since,until,definition=None,create_snapshot=True):
    since,until=bounds(since,until);definition=validate({} if definition is None else definition)
    records=[];errors=[]
    for source in definition['sources']:
        if source=='tags':records+=tracking.tags(since,until)
        else:
            result=tracking.autotags.evaluate(since,until);records+=result['items'];errors+=result['errors']
    selected=filter_records([r for r in records if definition['billable'] is None or r['billable']==definition['billable']],definition['query'])
    ordinary=tracking.tags(since,until) if 'autotags' in definition['sources'] else [r for r in records if r['timeline']=='tags']
    origin={r['id']:r for r in ordinary}
    grouped=defaultdict(list);notes=defaultdict(set);group_notes=defaultdict(set);group_ranges=defaultdict(list);group_refs=defaultdict(list);names=set();buckets=[]
    date=dt.datetime.fromtimestamp(since).date()
    while dt.datetime.combine(date,dt.time()).timestamp()<until:
        value=bucket(date,definition['total_by'])
        if not buckets or buckets[-1]!=value:buckets.append(value)
        if definition['total_by']=='none':break
        date+=dt.timedelta(days=1)
    for row in selected:
        cursor=row['start']
        while cursor<row['end']:
            date=dt.datetime.fromtimestamp(cursor).date();end=min(row['end'],day_bounds(date.isoformat())[1])
            values=tuple(group_value(row,field,date) for field in definition['group_fields']);key=(values,bucket(date,definition['total_by']))
            span=[cursor,end];names.add(values);grouped[key].append(span);group_ranges[values].append(span)
            group_refs[values].append({k:row[k] for k in ['id','timeline','tags','notes','billable','source']}|{'start':cursor,'end':end})
            for ident in row.get('origin_tag_ids',[]):
                if ident in origin:
                    original=origin[ident]
                    a,b=max(cursor,original['start']),min(end,original['end'])
                    if b>a:group_refs[values].append({k:original[k] for k in ['id','timeline','tags','notes','billable','source']}|{'start':a,'end':b})
            notes[key].add(row['notes']);group_notes[values].add(row['notes']);cursor=end
    rows=[]
    for (values,value),ranges in sorted(grouped.items()):
        rows.append({'group_values':list(values),'tag':' · '.join(values),'bucket':value,'day':value,'seconds':seconds(ranges),
                     'notes':'\n'.join(sorted(n for n in notes[(values,value)] if n)) if definition['include_notes'] else ''})
    round_cells(rows,definition)
    index={(tuple(r['group_values']),r['bucket']):r for r in rows};matrix=[]
    for values in sorted(names):
        cells=[index.get((values,b),{'seconds':0,'rounded_seconds':0,'notes':''}) for b in buckets]
        combined_notes=sorted(n for n in group_notes[values] if n) if definition['include_notes'] else []
        matrix.append({'key':hashlib.sha256(repr(values).encode()).hexdigest(),'groups':list(values),'cells':[{'seconds':v['seconds'],'rounded_seconds':v['rounded_seconds']} for v in cells],
                       'seconds':sum(v['seconds'] for v in cells),'rounded_seconds':sum(v['rounded_seconds'] for v in cells),
                       'notes':'\n'.join(combined_notes)})
    rounded=bool(definition['round_minutes']);raw=rounded and definition['include_unrounded'];columns=[]
    for field in definition['group_fields']:columns.append({'name':label(field),'kind':'text'})
    for value in buckets+([] if definition['total_by']=='none' else ['合计']):
        columns.append({'name':value+('（舍入秒）' if rounded else '（秒）'),'kind':'seconds'})
        if raw:columns.append({'name':value+'（原始秒）','kind':'seconds'})
    if definition['include_notes']:columns.append({'name':'备注','kind':'text'})
    table=[]
    for row in matrix:
        values=list(row['groups'])
        for cell in row['cells']+([] if definition['total_by']=='none' else [row]):
            values.append(cell['rounded_seconds'])
            if raw:values.append(cell['seconds'])
        if definition['include_notes']:values.append(row['notes'])
        table.append(values)
    if definition['sort_by'] and table:
        sort=definition['sort_by'];column=sort['column'] if sort['column']<len(columns) else 0
        order=sorted(range(len(table)),key=lambda i:table[i][column].casefold() if isinstance(table[i][column],str) else table[i][column],reverse=sort['descending'])
        table=[table[i] for i in order];matrix=[matrix[i] for i in order]
    result={'version':2,'definition':definition,'since':since,'until':until,'group_labels':[label(v) for v in definition['group_fields']],
            'buckets':buckets,'rows':rows,'matrix':matrix,'columns':columns,'table':table,'errors':errors,
            'seconds':sum(r['seconds'] for r in rows),'rounded_seconds':sum(r['rounded_seconds'] for r in rows)}
    if create_snapshot:
        by_row={r['key']:intervals(group_ranges[tuple(r['groups'])]) for r in matrix}
        refs={r['key']:group_refs[tuple(r['groups'])] for r in matrix}
        result['snapshot']=tracking.report_snapshots.put('work',{'report':result,'ranges_by_row':by_row,'refs_by_row':refs,'captured_tag_ids':list(origin)})
    return result


def legacy(tracking,since,until,depth=30,billable=None,round_minutes=0):
    if type(depth) is not int or not 1<=depth<=30:raise PolicyError('工时表设置无效')
    result=render(tracking,since,until,{'group_fields':['prefix:'+str(depth)],'billable':billable,'round_minutes':round_minutes},create_snapshot=False)
    return {'rows':[{k:r[k] for k in ['tag','day','seconds','rounded_seconds','notes']} for r in result['rows']],
            'seconds':result['seconds'],'rounded_seconds':result['rounded_seconds']}


def table(value):return [[v['name'] for v in value['columns']]]+value['table']
