"""Statistics definitions, interval aggregation and dependency-free data export."""
import csv
import datetime as dt
import io
import math
import zipfile
from collections import defaultdict
from xml.sax.saxutils import escape
from .model import PolicyError
from .tracking import TIMELINES, bounds, color, filter_match, generated_color, seconds, text
from .tracking_search import compile_query,filter_records
from .tracking_day import display_runs

GROUPING={'none','day','week','month','year'}
TYPES={'top','custom','duration','attendance','untagged'}


def validate_series(value):
    if not isinstance(value,dict) or set(value)-{'name','timeline','groups','match','query','color','folder'}:raise PolicyError('统计系列无效')
    timeline=value.get('timeline','applications')
    if not isinstance(timeline,str) or timeline not in TIMELINES:raise PolicyError('统计时间线无效')
    groups=value.get('groups',[])
    if not isinstance(groups,list) or len(groups)>1000:raise PolicyError('统计分组选择无效')
    groups=list(dict.fromkeys(text(g,4096) for g in groups))
    match=value.get('match','any')
    if not isinstance(match,str) or match not in {'any','all'} or match=='all' and timeline!='tags':raise PolicyError('仅标签系列支持匹配所有分组')
    name=text(value.get('name',''),200).strip() or ', '.join(groups)[:200] or '所有记录'
    compile_query(text(value.get('query',''),4096))
    return {'name':name,'timeline':timeline,'groups':groups,'match':match,'query':text(value.get('query',''),4096),
            'color':color(value['color']) if value.get('color') else generated_color(name),'folder':text(value.get('folder',''),100)}


def validate_definition(value):
    if not isinstance(value,dict) or set(value)-{'id','name','type','timeline','query','limit','group_by','chart_type','show_average','folder','series','attendance_seconds'}:raise PolicyError('图表设置无效')
    kind=value.get('type','top');timeline=value.get('timeline','applications');group_by=value.get('group_by','day')
    limit=value.get('limit',10);chart=value.get('chart_type','bar');average=value.get('show_average',False);attendance=value.get('attendance_seconds',3600)
    if not all(isinstance(v,str) for v in [kind,timeline,group_by,chart]) or kind not in TYPES or timeline not in TIMELINES or group_by not in GROUPING or chart not in {'bar','line'} or type(average) is not bool:raise PolicyError('图表设置无效')
    if type(limit) is not int or not 1<=limit<=100 or type(attendance) is not int or not 0<=attendance<=86400:raise PolicyError('图表数值无效')
    series=value.get('series',[])
    if not isinstance(series,list) or len(series)>100:raise PolicyError('统计系列过多')
    compile_query(text(value.get('query',''),4096))
    return {'name':text(value.get('name','新图表'),200).strip() or '新图表','type':kind,'timeline':timeline,
            'query':text(value.get('query',''),4096),'limit':limit,'group_by':group_by,'chart_type':chart,'show_average':average,
            'folder':text(value.get('folder',''),100),'series':[validate_series(s) for s in series],'attendance_seconds':attendance}


def bucket_key(date,group_by):
    if group_by=='none':return '总计'
    if group_by=='day':return date.isoformat()
    if group_by=='week':return (date-dt.timedelta(days=date.weekday())).isoformat()
    if group_by=='month':return date.strftime('%Y-%m')
    return str(date.year)


def bucket_keys(since,until,group_by):
    if group_by not in GROUPING:raise PolicyError('日期分组无效')
    keys=[];date=dt.datetime.fromtimestamp(since).date()
    while dt.datetime.combine(date,dt.time()).timestamp()<until:
        key=bucket_key(date,group_by)
        if not keys or keys[-1]!=key:keys.append(key)
        if group_by=='none':break
        date+=dt.timedelta(days=1)
    return keys


def folder_rows(tracking,rows,timeline,folder):
    if not folder:return rows
    if timeline=='documents' and folder in {'websites','files'}:
        def website(row):return bool(row.get('url') or row.get('metadata',{}).get('kind')=='website')
        return [r for r in rows if website(r)==(folder=='websites')]
    entry=next((f for f in tracking.entities('folders') if f['id']==folder and f.get('timeline')==timeline),None)
    if not entry:raise PolicyError('统计文件夹不存在')
    return [r for r in rows if r['group_name'] in entry['groups']]


def source_rows(tracking,since,until,definition):
    timeline=definition['timeline']
    rows=tracking.tags(since,until) if timeline=='tags' else display_runs(tracking.activities(since,until,timeline))
    rows=folder_rows(tracking,rows,timeline,definition.get('folder',''))
    groups=definition.get('groups',[]);wanted={v.casefold() for v in groups};match=definition.get('match','any')
    result=[]
    for row in filter_records(rows,definition.get('query','')):
        if wanted:
            actual={v.casefold() for v in row['tags']} if timeline=='tags' else {row['group_name'].casefold()}
            if not (wanted<=actual if match=='all' else wanted&actual):continue
        result.append(row)
    return result


def group_choices(tracking,since,until,timeline):
    since,until=bounds(since,until)
    if timeline not in TIMELINES:raise PolicyError('统计时间线无效')
    rows=tracking.tags(since,until) if timeline=='tags' else tracking.activities(since,until,timeline)
    groups=defaultdict(list)
    for row in rows:
        for name in row['tags'] if timeline=='tags' else [row['group_name']]:groups[name].append([row['start'],row['end']])
    return [{'name':name,'seconds':seconds(groups[name])} for name in sorted(groups,key=str.casefold)]


def aggregate(rows,keys,group_by):
    spans=defaultdict(list)
    for row in rows:
        cursor=row['start']
        while cursor<row['end']:
            date=dt.datetime.fromtimestamp(cursor).date()
            end=min(row['end'],dt.datetime.combine(date+dt.timedelta(days=1),dt.time()).timestamp())
            spans[bucket_key(date,group_by)].append([cursor,end]);cursor=end
    return [seconds(spans[key]) for key in keys]


def result(since,until,definition,keys,series,**extra):
    for item in series:
        valid=[v for v in item['values'] if v is not None]
        item.setdefault('average',sum(valid)/len(keys) if keys else 0)
        item.setdefault('unit','seconds')
        item.setdefault('total',sum(valid))
    return {'since':since,'until':until,'type':definition['type'],'timeline':definition['timeline'],
            'group_by':definition['group_by'],'chart_type':definition['chart_type'],'show_average':definition['show_average'],
            'name':definition['name'],'buckets':keys,'series':series,
            'table':[[key]+[s['values'][i] for s in series] for i,key in enumerate(keys)],**extra}


def top(tracking,since,until,timeline='applications',query='',group_by='day',limit=10,groups=None,folder=''):
    since,until=bounds(since,until)
    definition=validate_definition({'type':'top','timeline':timeline,'query':query,'group_by':group_by,'limit':limit,'folder':folder})
    selection=validate_series({'timeline':timeline,'groups':[] if groups is None else groups,'query':query,'folder':folder})
    rows=source_rows(tracking,since,until,selection)
    by_name=defaultdict(list)
    for row in rows:by_name[row['group_name']].append(row)
    selected=sorted(by_name,key=lambda name:(-seconds([[r['start'],r['end']] for r in by_name[name]]),name))[:limit]
    keys=bucket_keys(since,until,group_by)
    series=[{'name':name,'color':by_name[name][0]['color'],'values':aggregate(by_name[name],keys,group_by)} for name in selected]
    return result(since,until,definition,keys,series)


def render(tracking,since,until,value):
    since,until=bounds(since,until);definition=validate_definition(value);kind=definition['type'];group_by=definition['group_by']
    keys=bucket_keys(since,until,group_by)
    if kind=='top':
        report=top(tracking,since,until,definition['timeline'],definition['query'],group_by,definition['limit'],folder=definition['folder'])
        return {**report,'name':definition['name'],'chart_type':definition['chart_type'],'show_average':definition['show_average']}
    if kind=='custom':
        series=[]
        for entry in definition['series']:
            combined=' AND '.join('('+q+')' for q in [definition['query'],entry['query']] if q)
            rows=source_rows(tracking,since,until,{**entry,'query':combined})
            series.append({'name':entry['name'],'color':entry['color'],'values':aggregate(rows,keys,group_by)})
        return result(since,until,definition,keys,series)
    days=tracking.day_statistics(since,until,definition['query'])
    grouped={key:[d for d in days if bucket_key(dt.date.fromisoformat(d['day']),group_by)==key] for key in keys}
    if kind=='duration':
        def clock(at):
            date=dt.datetime.fromtimestamp(at);return date.hour*3600+date.minute*60+date.second
        def average_clock(key,field):
            values=[clock(d[field]) for d in grouped[key] if d[field] is not None]
            return sum(values)/len(values) if values else None
        series=[{'name':'开始时间','color':'#30a46c','unit':'clock','values':[average_clock(k,'first') for k in keys]},
                {'name':'结束时间','color':'#da5260','unit':'clock','values':[average_clock(k,'last') for k in keys]},
                {'name':'每日时长','color':'#007aff','values':[sum(d['duration'] for d in grouped[k]) for k in keys]}]
        # Missing clock values are gaps, not midnight starts in the graph.
        for entry in series:
            valid=[v for v in entry['values'] if v is not None]
            entry['average']=sum(valid)/len(valid) if valid else 0
            entry['total']=sum(valid) if entry.get('unit','seconds')=='seconds' else None
    elif kind=='attendance':
        series=[{'name':'出勤天数','color':'#30a46c','unit':'days','values':[sum(d['first'] is not None and d['duration']>=definition['attendance_seconds'] for d in grouped[k]) for k in keys]}]
    else:
        series=[{'name':'已标记','color':'#30a46c','values':[sum(d['tagged'] for d in grouped[k]) for k in keys]},
                {'name':'未标记','color':'#e18a12','values':[sum(d['untagged'] for d in grouped[k]) for k in keys]}]
    return result(since,until,definition,keys,series,days=days)


def report_table(report):
    units={'seconds':'秒','clock':'当天秒数','days':'天'}
    header=['日期']+[entry['name']+'（'+units.get(entry.get('unit','seconds'),'秒')+'）' for entry in report['series']]
    return [header]+report['table']


def timesheet_table(value):
    return [['标签','日期','时长（秒）','舍入后时长（秒）','备注']]+[[r['tag'],r['day'],r['seconds'],r['rounded_seconds'],r['notes']] for r in value['rows']]


def xml_text(value):
    return escape(''.join(c for c in str(value) if c in '\t\n\r' or 0x20<=ord(c)<=0xd7ff or 0xe000<=ord(c)<=0xfffd or 0x10000<=ord(c)<=0x10ffff))


def export_table(rows,format):
    if format=='csv':
        output=io.StringIO(newline='');writer=csv.writer(output)
        for row in rows:
            # Titles and notes are data, never spreadsheet formulas.
            writer.writerow(["'"+v if isinstance(v,str) and v.lstrip(' \t\r\n').startswith(('=','+','-','@')) else v for v in row])
        return ('\ufeff'+output.getvalue()).encode('utf-8'),'text/csv; charset=utf-8'
    if format!='xlsx':raise PolicyError('统计导出格式无效')
    output=io.BytesIO();ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        archive.writestr('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        archive.writestr('xl/workbook.xml',f'<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="{ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="统计" sheetId="1" r:id="rId1"/></sheets></workbook>')
        archive.writestr('xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        with archive.open('xl/worksheets/sheet1.xml','w') as sheet:
            sheet.write(f'<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="{ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>'.encode())
            for index,row in enumerate(rows,1):
                if index>1048576 or len(row)>16384:raise PolicyError('导出数据超出工作表范围')
                cells=[]
                for column,value in enumerate(row,1):
                    name='';number=column
                    while number:number,remainder=divmod(number-1,26);name=chr(65+remainder)+name
                    reference=name+str(index)
                    if value is None:cells.append(f'<c r="{reference}"/>')
                    elif isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value):cells.append(f'<c r="{reference}" t="n"><v>{value}</v></c>')
                    else:cells.append(f'<c r="{reference}" t="inlineStr"><is><t xml:space="preserve">{xml_text(value)}</t></is></c>')
                sheet.write((f'<row r="{index}">'+''.join(cells)+'</row>').encode('utf-8'))
            sheet.write(b'</sheetData></worksheet>')
    return output.getvalue(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
