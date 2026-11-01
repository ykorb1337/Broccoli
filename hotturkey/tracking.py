"""Local interval-based time tracking, independent of enforcement accounting.

All durations are intersections/unions of half-open intervals. Editing or
removing tracking data never writes to the block policy or charges tables.
"""
import copy
import datetime as dt
import fnmatch
import hashlib
import json
import math
import os
import stat
import sqlite3
import threading
import time
import weakref
from pathlib import Path
import re
import uuid
from collections import defaultdict
from urllib.parse import urlsplit
from .model import PolicyError
from .tracking_search import compile_query,filter_records

TIMELINES=('tags','computer','applications','documents','autotags')
PALETTE=('#007aff','#af52de','#30a46c','#e18a12','#da5260','#00a3a3','#6b68d9','#a36c48')
DEFAULTS={'enabled':True,'paused_until':0,'titles':True,'idle_seconds':180,'retention_days':365,
 'schedule_enabled':False,'schedule':[],'application_mode':'exclude','applications':[],'website_mode':'exclude','websites':[],
 'document_mode':'exclude','documents':[],'title_mode':'exclude','window_titles':[],
 'screenshots_enabled':False,'screenshot_interval':60,'screenshot_retention_days':7,
 'screenshot_application_mode':'exclude','screenshot_applications':[],'screenshot_format':'jpeg',
 'screenshot_displays':'all','screenshot_max_width':2560,'snap_minutes':1,'viewer_dock':'right','viewer_open':False}

def finite(value,label='时间'):
    if isinstance(value,bool):raise PolicyError(label+'无效')
    try:value=float(value)
    except (ValueError,TypeError,OverflowError):raise PolicyError(label+'无效') from None
    if not math.isfinite(value) or not 0<=value<=4102444800:raise PolicyError(label+'无效')
    return value

def bounds(start,end):
    start,end=finite(start),finite(end)
    if end<=start:raise PolicyError('结束时间必须晚于开始时间')
    return start,end

def intervals(values):
    result=[]
    for a,b in sorted((float(a),float(b)) for a,b in values if b>a):
        if result and a<=result[-1][1]:result[-1][1]=max(result[-1][1],b)
        else:result.append([a,b])
    return result

def seconds(values):return sum(b-a for a,b in intervals(values))

def intersect(left,right):
    result=[];left=intervals(left);right=intervals(right);i=j=0
    while i<len(left) and j<len(right):
        a,b=max(left[i][0],right[j][0]),min(left[i][1],right[j][1])
        if b>a:result.append([a,b])
        if left[i][1]<right[j][1]:i+=1
        else:j+=1
    return result

def subtract(left,right):
    result=[];right=intervals(right)
    for a,b in intervals(left):
        cursor=a
        for start,end in right:
            if end<=cursor:continue
            if start>=b:break
            if start>cursor:result.append([cursor,min(start,b)])
            cursor=max(cursor,end)
            if cursor>=b:break
        if cursor<b:result.append([cursor,b])
    return result

def day_bounds(day):
    try:date=dt.date.fromisoformat(day)
    except (TypeError,ValueError):raise PolicyError('日期无效') from None
    # Local midnights, not a fixed 86400 seconds, preserve DST days.
    return dt.datetime.combine(date,dt.time()).timestamp(),dt.datetime.combine(date+dt.timedelta(days=1),dt.time()).timestamp()

def text(value,limit=4096):
    if not isinstance(value,str) or len(value)>limit or '\0' in value:raise PolicyError('文字无效或过长')
    return value

def color(value):
    if not isinstance(value,str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',value):raise PolicyError('颜色无效')
    return value.lower()

def generated_color(value):return PALETTE[int(hashlib.sha256(value.encode()).hexdigest()[:8],16)%len(PALETTE)]

def pattern_matches(pattern,value):
    pattern,value=pattern.strip().casefold(),value.casefold()
    if not pattern:return False
    if len(pattern)>=2 and pattern[0]==pattern[-1]=='"':return value==pattern[1:-1]
    return fnmatch.fnmatchcase(value,pattern) if any(c in pattern for c in '*?[') else pattern in value

def filter_match(record,query):
    return compile_query(query).matches(record)

class TrackingStore:
    def __init__(self,store):
        self.store=store;self.lock=threading.RLock()
        path=store.directory/'tracking.sqlite3'
        self.db=sqlite3.connect(str(path),check_same_thread=False,timeout=5)
        path.chmod(0o600);self.db.row_factory=sqlite3.Row
        self._finalizer=weakref.finalize(self,self.db.close)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=NORMAL')
        with self.lock:
            self.db.executescript('''
            CREATE TABLE IF NOT EXISTS tracking_settings(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS tracking_activities(id TEXT PRIMARY KEY,timeline TEXT NOT NULL,start REAL NOT NULL,end REAL NOT NULL,title TEXT NOT NULL,group_name TEXT NOT NULL,application TEXT NOT NULL,bundle TEXT NOT NULL,path TEXT NOT NULL,url TEXT NOT NULL,document TEXT NOT NULL,source TEXT NOT NULL,metadata TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS tracking_activity_time ON tracking_activities(timeline,start,end);
            CREATE TABLE IF NOT EXISTS tracking_tags(id TEXT PRIMARY KEY,start REAL NOT NULL,end REAL NOT NULL,tags TEXT NOT NULL,notes TEXT NOT NULL,billable INTEGER NOT NULL,color TEXT NOT NULL,source TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS tracking_tag_time ON tracking_tags(start,end);
            CREATE TABLE IF NOT EXISTS tracking_entities(kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id));
            CREATE TABLE IF NOT EXISTS tracking_screenshots(id TEXT PRIMARY KEY,at REAL NOT NULL,display TEXT NOT NULL,file TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,application TEXT NOT NULL,bundle TEXT NOT NULL,title TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS tracking_screenshot_time ON tracking_screenshots(at);
            CREATE TABLE IF NOT EXISTS tracking_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            ''')
            columns={row['name'] for row in self.db.execute('PRAGMA table_info(tracking_screenshots)')}
            for name in ['url','document','path']:
                if name not in columns:self.db.execute('ALTER TABLE tracking_screenshots ADD COLUMN '+name+" TEXT NOT NULL DEFAULT ''")
            self.db.execute('CREATE INDEX IF NOT EXISTS tracking_screenshot_display_time ON tracking_screenshots(display,at)')
            self.db.commit()
            if not self.db.execute('SELECT 1 FROM tracking_settings WHERE id=1').fetchone():
                self.db.execute('INSERT INTO tracking_settings VALUES(1,?)',(json.dumps(DEFAULTS),));self.db.commit()
            saved=json.loads(self.db.execute('SELECT value FROM tracking_settings WHERE id=1').fetchone()[0])
            self._configuration={**copy.deepcopy(DEFAULTS),**saved}
            if 'schedule_enabled' not in saved:self._configuration['schedule_enabled']=bool(saved.get('schedule'))
            from .tracking_tags import TagLibrary
            self.tag_library=TagLibrary(self)
            from .tracking_clock import TagClock
            self.clock=TagClock(self)
            from .tracking_autotags import AutoTags
            self.autotags=AutoTags(self)
            from .tracking_snapshots import ReportSnapshots
            self.report_snapshots=ReportSnapshots()
    def close(self):
        with self.lock:
            if self._finalizer.alive:self._finalizer()
    def settings(self):
        # Immutable snapshots keep the enforcement-side privacy check free of DB
        # waits while a large report or screenshot deletion holds the stats lock.
        return copy.deepcopy(self._configuration)
    def configure(self,data):
        if not isinstance(data,dict) or set(data)-set(DEFAULTS):raise PolicyError('统计设置无效')
        with self.lock:
            value=self.settings()
            for key,item in data.items():
                if key in ['enabled','titles','screenshots_enabled','schedule_enabled','viewer_open']:
                    if type(item) is not bool:raise PolicyError('开关值无效')
                elif key in ['idle_seconds','retention_days','screenshot_interval','screenshot_retention_days','screenshot_max_width','snap_minutes']:
                    limits={'idle_seconds':(30,3600),'retention_days':(1,3650),'screenshot_interval':(5,3600),'screenshot_retention_days':(1,365),'screenshot_max_width':(320,7680),'snap_minutes':(1,60)}
                    if type(item) is not int or not limits[key][0]<=item<=limits[key][1]:raise PolicyError('设置数值超出范围')
                elif key=='paused_until':item=finite(item)
                elif key.endswith('_mode'):
                    if item not in {'include','exclude'}:raise PolicyError('筛选方式无效')
                elif key in ['applications','websites','documents','window_titles','screenshot_applications']:
                    if not isinstance(item,list) or len(item)>1000:raise PolicyError('筛选列表无效')
                    item=[text(x,2048).strip() for x in item if x]
                elif key=='schedule':
                    if not isinstance(item,list) or len(item)>168:raise PolicyError('跟踪日程无效')
                    for row in item:
                        if not isinstance(row,dict) or set(row)!={'days','start','end'} or not isinstance(row['days'],list) or not row['days'] or any(type(d) is not int or not 0<=d<=6 for d in row['days']) or type(row['start']) is not int or not 0<=row['start']<1440 or type(row['end']) is not int or not 0<=row['end']<=1440 or row['start']==row['end']:raise PolicyError('跟踪日程无效')
                elif key=='screenshot_format':
                    if item not in {'jpeg','png','webp'}:raise PolicyError('截图格式无效')
                elif key=='screenshot_displays':
                    if item not in {'all','main'}:raise PolicyError('显示器选择无效')
                elif key=='viewer_dock':
                    if item not in {'left','right','bottom','window'}:raise PolicyError('截图位置无效')
                value[key]=item
            if 'schedule' in data and 'schedule_enabled' not in data:value['schedule_enabled']=bool(data['schedule'])
            self.db.execute('UPDATE tracking_settings SET value=? WHERE id=1',(json.dumps(value,ensure_ascii=False),));self.db.commit();self._configuration=copy.deepcopy(value);return copy.deepcopy(value)
    @staticmethod
    def hostname(url):
        try:return urlsplit(url).hostname or ''
        except ValueError:return ''
    def recording_allowed(self,at,application='',url='',document='',title='',screenshots=False,bundle=''):
        s=self.settings()
        if not s['enabled'] or s['paused_until']>at:return False
        if s['schedule_enabled']:
            now=dt.datetime.fromtimestamp(at);allowed=False
            for back in [0,1]:
                day=now.date()-dt.timedelta(days=back);midnight=dt.datetime.combine(day,dt.time())
                for row in s['schedule']:
                    start=(midnight+dt.timedelta(minutes=row['start'])).timestamp();end=(midnight+dt.timedelta(minutes=row['end']+(1440 if row['end']<row['start'] else 0))).timestamp()
                    if day.weekday() in row['days'] and start<=at<end:allowed=True
            if not allowed:return False
        checks=[('application',s['applications'],[application,bundle]),('website',s['websites'],[url,self.hostname(url)]),('document',s['documents'],[document]),('title',s['window_titles'],[title])]
        if screenshots:checks.append(('screenshot_application',s['screenshot_applications'],[application,bundle]))
        for key,patterns,values in checks:
            matched=any(pattern_matches(p,v) for p in patterns for v in values if v)
            if patterns and ((s[key+'_mode']=='include' and not matched) or (s[key+'_mode']=='exclude' and matched)):return False
        return not screenshots or s['screenshots_enabled']
    def recording_ranges(self,since,until,**context):
        """Clip a measured interval to configured local hours, including DST.

        A known sleep interval can span several schedule windows. Admission at
        both endpoints alone must never fill the excluded hours between them.
        """
        since,until=bounds(since,until);s=self.settings()
        since=max(since,s['paused_until'])
        if not s['enabled'] or since>=until:return []
        if not s['schedule_enabled']:
            return [[since,until]] if self.recording_allowed(since,**context) else []
        first=dt.datetime.fromtimestamp(since).date()-dt.timedelta(days=1)
        last=dt.datetime.fromtimestamp(until).date();windows=[]
        while first<=last:
            midnight=dt.datetime.combine(first,dt.time())
            for row in s['schedule']:
                if first.weekday() not in row['days']:continue
                a=(midnight+dt.timedelta(minutes=row['start'])).timestamp()
                b=(midnight+dt.timedelta(minutes=row['end']+(1440 if row['end']<row['start'] else 0))).timestamp()
                a,b=max(since,a),min(until,b)
                if b>a and self.recording_allowed(a,**context):windows.append([a,b])
            first+=dt.timedelta(days=1)
        return intervals(windows)
    def add_activity(self,record,merge=False):
        if not isinstance(record,dict):raise PolicyError('活动记录无效')
        start,end=bounds(record.get('start'),record.get('end'));timeline=record.get('timeline')
        if timeline not in TIMELINES[1:4]:raise PolicyError('时间线无效')
        value={k:text(record.get(k,''),8192 if k=='url' else 4096) for k in ['title','group_name','application','bundle','path','url','document']}
        source=text(record.get('source','recorded'),80);metadata=record.get('metadata',{})
        if not isinstance(metadata,dict) or len(json.dumps(metadata))>16384:raise PolicyError('活动信息过长')
        with self.lock:
            if merge:
                last=self.db.execute('SELECT * FROM tracking_activities WHERE timeline=? ORDER BY end DESC LIMIT 1',(timeline,)).fetchone()
                if last and abs(last['end']-start)<0.001 and all(last[k]==v for k,v in value.items()) and last['source']==source and json.loads(last['metadata'])==metadata:
                    self.db.execute('UPDATE tracking_activities SET end=? WHERE id=?',(end,last['id']));self.db.commit();return last['id']
            ident=uuid.uuid4().hex
            self.db.execute('INSERT INTO tracking_activities VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(ident,timeline,start,end,*(value[k] for k in ['title','group_name','application','bundle','path','url','document']),source,json.dumps(metadata,ensure_ascii=False)))
            self.db.commit();return ident
    def activities(self,since,until,timeline=None,query='',_derived=True):
        since,until=bounds(since,until)
        search=compile_query(query)
        if timeline and timeline not in TIMELINES:raise PolicyError('时间线无效')
        with self.lock:
            rows=self.db.execute('SELECT * FROM tracking_activities WHERE end>? AND start<?'+(' AND timeline=?' if timeline else '')+' ORDER BY start,end,id',(since,until,*([timeline] if timeline else []))).fetchall()
        result=[]
        palette={(v.get('timeline'),v.get('group')):v.get('color') for v in self.entities('colors')}
        for row in rows:
            value=dict(row);value['original_start']=value['start'];value['original_end']=value['end'];value['start']=max(since,value['start']);value['end']=min(until,value['end']);value['seconds']=value['end']-value['start'];value['metadata']=json.loads(value['metadata'])
            value.update({k:value['metadata'].get(k,'') for k in ['repository','branch']})
            value['color']=palette.get((value['timeline'],value['group_name'])) or {'Active':'#30a46c','Away':'#e9a23b','Locked':'#8e8e93','Sleep':'#7375bd','Power off':'#b5b5bc'}.get(value['group_name'],generated_color(value['group_name']))
            result.append(value)
        if _derived and timeline in [None,'autotags']:
            # Conditions always see complete raw observations; the view's text
            # filter applies to the calculated tag, not its source activities.
            result.extend(self.autotags.evaluate(since,until)['items'])
        return search.filter(result)
    def group_color(self,timeline,group):
        colors=self.entities('colors');item=next((v for v in colors if v.get('timeline')==timeline and v.get('group')==group),None)
        return item['color'] if item else {'Active':'#30a46c','Away':'#e9a23b','Locked':'#8e8e93','Sleep':'#7375bd','Power off':'#b5b5bc'}.get(group,generated_color(group))
    def entities(self,kind):
        if kind not in {'colors','folders','autotags','alerts','reports','timesheets','tagstyles','stopwatch'}:raise PolicyError('统计对象类型无效')
        with self.lock:return [dict(json.loads(r['value']),id=r['id']) for r in self.db.execute('SELECT id,value FROM tracking_entities WHERE kind=? ORDER BY rowid',(kind,))]
    def save_entity(self,kind,value,ident=None):
        self.entities(kind)
        if kind=='autotags':return self.autotags.save(value,ident)
        if not isinstance(value,dict) or len(json.dumps(value))>65536:raise PolicyError('统计对象无效或过长')
        value=copy.deepcopy(value);ident=ident or value.pop('id',None) or (hashlib.sha256((str(value.get('timeline'))+'\0'+str(value.get('group'))).encode()).hexdigest() if kind=='colors' else uuid.uuid4().hex)
        if not isinstance(ident,str) or not re.fullmatch('[a-zA-Z0-9_-]{1,100}',ident):raise PolicyError('统计对象标识无效')
        if kind=='colors':value={'timeline':text(value.get('timeline',''),30),'group':text(value.get('group','')),'color':color(value.get('color'))}
        if kind=='folders':
            if value.get('timeline') not in ['computer','applications','documents','autotags'] or not isinstance(value.get('groups'),list):raise PolicyError('文件夹无效')
            value={'name':text(value.get('name',''),100),'timeline':value['timeline'],'groups':[text(v) for v in value['groups']]}
        if kind=='reports':
            from .tracking_reports import validate_definition
            value=validate_definition(value)
        if kind=='timesheets':
            from .tracking_timesheet import validate_preset
            value=validate_preset(value)
        with self.lock:
            self.db.execute('INSERT INTO tracking_entities VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value',(kind,ident,json.dumps(value,ensure_ascii=False)));self.db.commit()
        return {**value,'id':ident}
    def delete_entity(self,kind,ident):
        self.entities(kind)
        if kind=='autotags':return self.autotags.delete(ident)
        with self.lock:self.db.execute('DELETE FROM tracking_entities WHERE kind=? AND id=?',(kind,text(ident,100)));self.db.commit()
    def save_tag(self,value,ident=None):
        if not isinstance(value,dict):raise PolicyError('标签无效')
        ranges=value.get('ranges',[[value.get('start'),value.get('end')]])
        if not isinstance(ranges,list) or not ranges or len(ranges)>1000:raise PolicyError('标签时间选择无效')
        if any(not isinstance(v,(list,tuple)) or len(v)!=2 for v in ranges):raise PolicyError('标签时间选择无效')
        ranges=intervals([bounds(*v) for v in ranges])
        tags=value.get('tags',[])
        if isinstance(tags,str):tags=[v.strip() for v in tags.split(',') if v.strip()]
        if not isinstance(tags,list) or not tags or len(tags)>30:raise PolicyError('请至少输入一个标签')
        tags=[text(v,100).strip() for v in tags]
        if any(not v or ',' in v for v in tags):raise PolicyError('单个标签无效')
        from .tracking_tags import parts
        tags=parts(tags)
        notes=text(value.get('notes',''),10000);billable=value.get('billable',False)
        if type(billable) is not bool:raise PolicyError('计费标记无效')
        if 'auto_override' in value and type(value['auto_override']) is not bool:raise PolicyError('自动标签覆盖选项无效')
        tint=color(value['color']) if value.get('color') else ''
        if ident and len(ranges)!=1:raise PolicyError('编辑标签只能修改一个时间段')
        if ident is not None and (not isinstance(ident,str) or not re.fullmatch('[a-f0-9]{32}',ident)):raise PolicyError('标签标识无效')
        ids=[]
        with self.tag_library.transaction():
            override=value.get('auto_override',bool(ident and self.db.execute('SELECT 1 FROM tracking_autotag_overrides WHERE tag_id=?',(ident,)).fetchone()))
            if ident:
                if not self.db.execute('SELECT 1 FROM tracking_tags WHERE id=?',(ident,)).fetchone():raise PolicyError('找不到该标签')
                self.db.execute('DELETE FROM tracking_tags WHERE id=?',(ident,))
                self.db.execute('DELETE FROM tracking_autotag_overrides WHERE tag_id=?',(ident,))
            self.tag_library.register(tags)
            for a,b in ranges:
                key=ident or uuid.uuid4().hex
                self.db.execute('INSERT INTO tracking_tags VALUES(?,?,?,?,?,?,?,?)',(key,a,b,json.dumps(tags,ensure_ascii=False),notes,int(billable),tint,'manual'));ids.append(key)
                if override:self.db.execute('INSERT INTO tracking_autotag_overrides VALUES(?)',(key,))
        return {'ids':ids}
    def tags(self,since,until):
        since,until=bounds(since,until)
        with self.lock:
            rows=self.db.execute('SELECT * FROM tracking_tags WHERE end>? AND start<? ORDER BY start,end,id',(since,until)).fetchall()
            overrides={r[0] for r in self.db.execute('SELECT tag_id FROM tracking_autotag_overrides')}
        result=[];palette=self.tag_library.palette()
        for row in rows:
            v=dict(row);v['tags']=json.loads(v['tags']);v['timeline']='tags';v['title']=', '.join(v['tags']);v['group_name']=v['title'];v['original_start']=v['start'];v['original_end']=v['end'];v['start']=max(since,v['start']);v['end']=min(until,v['end']);v['seconds']=v['end']-v['start'];v['billable']=bool(v['billable']);v['color']=v['color'] or self.tag_library.resolve(v['tags'],palette);v['auto_override']=v['id'] in overrides;result.append(v)
        return result
    def delete_tags(self,ids):
        if not isinstance(ids,list) or len(ids)>1000:raise PolicyError('标签选择无效')
        with self.tag_library.transaction():
            values=[(text(i,100),) for i in ids]
            self.db.executemany('DELETE FROM tracking_tags WHERE id=?',values);self.db.executemany('DELETE FROM tracking_autotag_overrides WHERE tag_id=?',values)
    def day(self,day,timeline='applications',query='',selection=None,untagged=False):
        since,until=day_bounds(day)
        search=compile_query(query)
        activities=self.activities(since,until,_derived=False);calculated=self.autotags.evaluate(since,until,records=activities)
        from .tracking_day import display_runs
        activities=display_runs(activities)+calculated['items'];tags=self.tags(since,until)
        all_rows=activities+tags
        if selection and (not isinstance(selection,list) or len(selection)>1000 or any(not isinstance(v,(list,tuple)) or len(v)!=2 for v in selection)):raise PolicyError('时间选择无效')
        selected=intervals([bounds(*v) for v in selection]) if selection else []
        matched=search.filter(all_rows)
        rows=[v for v in matched if v['timeline']==timeline]
        if untagged:
            parts=[]
            for row in rows:
                for a,b in subtract([[row['start'],row['end']]],[[v['start'],v['end']] for v in tags]):
                    parts.append({**row,'id':row['id']+'@'+str(int(a*1000)),'original_id':row['id'],'start':a,'end':b,'seconds':b-a})
            rows=parts
        grouped=defaultdict(list)
        for row in rows:grouped[row['group_name']].append(row)
        summary=[]
        for name,items in grouped.items():
            spans=[[v['start'],v['end']] for v in items]
            summary.append({'name':name,'seconds':seconds(spans),'selected_seconds':seconds(intersect(spans,selected)) if selected else 0,'color':items[0]['color'],'count':len(items),'ranges':intervals(spans),'application':items[0].get('application',''),'bundle':items[0].get('bundle','')})
        summary.sort(key=lambda v:(-v['seconds'],v['name']))
        tag_spans=intervals([[v['start'],v['end']] for v in tags])
        for row in rows:row['tagged_seconds']=seconds(intersect([[row['start'],row['end']]],tag_spans))
        computer=[v for v in activities if v['timeline']=='computer'];active=[v for v in computer if v['group_name']=='Active'];spans=[[v['start'],v['end']] for v in active]
        return {'day':day,'since':since,'until':until,'timeline':timeline,'activities':all_rows,'details':rows,'summary':summary,'selection':selected,'filtered_ids':[v['id'] for v in matched],'tag_ranges':tag_spans,
          'totals':{'active':seconds(spans),'away':seconds([[v['start'],v['end']] for v in computer if v['group_name']=='Away']),'tagged':seconds(intersect(spans,tag_spans)),'selected':seconds(selected),'first':min((v['start'] for v in active),default=None),'last':max((v['end'] for v in active),default=None)},'settings':self.settings(),'folders':self.entities('folders'),
          'autotags_enabled':any(v['enabled'] for v in self.entities('autotags')) or self.autotags.configuration()['manual_tags']!='off' or self.autotags.has_overrides(),'autotag_errors':calculated['errors']}
    def delete_range(self,since,until,timelines=None):
        since,until=bounds(since,until);timelines=timelines or list(TIMELINES)
        if not isinstance(timelines,list) or set(timelines)-set(TIMELINES):raise PolicyError('时间线无效')
        with self.tag_library.transaction():
            for timeline in timelines:
                if timeline=='tags':self.tag_library.cut_ranges([[since,until]]);continue
                table='tracking_tags' if timeline=='tags' else 'tracking_activities'
                if timeline=='autotags':continue
                where='end>? AND start<?'+(' AND timeline=?' if table=='tracking_activities' else '')
                args=(since,until,*([timeline] if table=='tracking_activities' else []))
                for row in self.db.execute('SELECT * FROM '+table+' WHERE '+where,args).fetchall():
                    original=dict(row);self.db.execute('DELETE FROM '+table+' WHERE id=?',(row['id'],))
                    pieces=[]
                    if row['start']<since:pieces.append((row['start'],since))
                    if row['end']>until:pieces.append((until,row['end']))
                    for a,b in pieces:
                        v={**original,'id':uuid.uuid4().hex,'start':a,'end':b};keys=list(v)
                        self.db.execute('INSERT INTO '+table+' ('+','.join(keys)+') VALUES('+','.join('?' for _ in keys)+')',list(v.values()))
        return {'ok':True}
    def screenshot_path(self,relative):
        if not isinstance(relative,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}/[a-f0-9]{32}\.(jpg|png|webp)',relative):raise PolicyError('截图路径无效')
        root=self.store.directory/'screenshots';path=root/relative
        for item in [root,path.parent,path]:
            try:info=item.lstat()
            except FileNotFoundError:raise PolicyError('截图文件不存在') from None
            if stat.S_ISLNK(info.st_mode) or info.st_uid!=os.getuid() or info.st_mode&0o077:raise PolicyError('截图文件权限无效')
        info=path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_size>64*1024*1024:raise PolicyError('截图文件无效')
        return path
    def add_screenshot(self,value):
        if not isinstance(value,dict) or not re.fullmatch('[a-f0-9]{32}',str(value.get('id',''))):raise PolicyError('截图标识无效')
        path=self.screenshot_path(value.get('file'))
        if path.stem!=value['id']:raise PolicyError('截图标识与文件不匹配')
        width,height=value.get('width'),value.get('height')
        if any(type(n) is not int or not 1<=n<=16384 for n in [width,height]):raise PolicyError('截图尺寸无效')
        at=finite(value.get('at'))
        with self.lock:
            fields=['id','at','display','file','width','height','application','bundle','title','url','document','path']
            values=[value['id'],at,text(value.get('display',''),40),value['file'],width,height]+[text(value.get(k,''),8192 if k=='url' else 4096) for k in fields[6:]]
            self.db.execute('INSERT OR IGNORE INTO tracking_screenshots ('+','.join(fields)+') VALUES('+','.join('?' for _ in fields)+')',values);self.db.commit()
        return value['id']
    def screenshots(self,since,until,at=None,query='',direction='',limit=200,display=''):
        since,until=bounds(since,until)
        if direction not in ['','next','previous'] or type(limit) is not int or not 1<=limit<=500:raise PolicyError('截图浏览选项无效')
        display=text(display,40);sql='SELECT * FROM tracking_screenshots WHERE at>=? AND at<?';args=[since,until]
        if display:sql+=' AND display=?';args.append(display)
        if direction and at is None:raise PolicyError('截图导航时间无效')
        if at is not None:
            at=finite(at)
        # Validate even an empty result without executing regex in the DB lock.
        search=compile_query(query);deadline=time.monotonic()+5
        with self.lock:
            cursors=[]
            if at is not None and not direction:
                cursors=[self.db.execute(sql+' AND at<=? ORDER BY at DESC,display,id',args+[at]),self.db.execute(sql+' AND at>? ORDER BY at,display,id',args+[at])]
            elif direction:
                cursors=[self.db.execute(sql+' AND at'+('>' if direction=='next' else '<')+'? ORDER BY at'+(' DESC' if direction=='previous' else '')+',display,id',args+[at])]
            else:cursors=[self.db.execute(sql+' ORDER BY at,display,id',args)]
            heads=[cursor.fetchone() for cursor in cursors]
        values=[]
        try:
            while any(row is not None for row in heads) and len(values)<limit:
                indices=[i for i,row in enumerate(heads) if row is not None]
                index=min(indices,key=lambda i:(abs(heads[i]['at']-at),heads[i]['at'],heads[i]['display'],heads[i]['id'])) if len(cursors)>1 else indices[0]
                row=heads[index]
                with self.lock:heads[index]=cursors[index].fetchone()
                value=dict(row);value['group_name']=value['application']
                if search.matches(value,deadline=deadline):value.pop('file');values.append(value)
            return values
        finally:
            with self.lock:
                for cursor in cursors:cursor.close()
    def screenshot_displays(self,since,until):
        since,until=bounds(since,until)
        with self.lock:return [{'id':row['display'],'count':row['count']} for row in self.db.execute('SELECT display,COUNT(*) AS count FROM tracking_screenshots WHERE at>=? AND at<? GROUP BY display ORDER BY display',(since,until))]
    def screenshot_location(self,ident):
        if not isinstance(ident,str) or not re.fullmatch('[a-f0-9]{32}',ident):raise PolicyError('截图标识无效')
        with self.lock:row=self.db.execute('SELECT file FROM tracking_screenshots WHERE id=?',(ident,)).fetchone()
        if not row:raise PolicyError('找不到该截图')
        self.screenshot_path(row['file'])
        return {'file':row['file']}
    def discard_unregistered_screenshot(self,relative):
        with self.lock:
            if self.db.execute('SELECT 1 FROM tracking_screenshots WHERE file=?',(relative,)).fetchone():return False
            self.screenshot_path(relative).unlink();return True
    def screenshot(self,ident):
        if not isinstance(ident,str) or not re.fullmatch('[a-f0-9]{32}',ident):raise PolicyError('截图标识无效')
        with self.lock:row=self.db.execute('SELECT * FROM tracking_screenshots WHERE id=?',(ident,)).fetchone()
        if not row:raise PolicyError('找不到该截图')
        path=self.screenshot_path(row['file']);data=path.read_bytes()
        mime={'.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp'}[path.suffix]
        valid=data.startswith(b'\xff\xd8\xff') if path.suffix=='.jpg' else data.startswith(b'\x89PNG\r\n\x1a\n') if path.suffix=='.png' else data.startswith(b'RIFF') and data[8:12]==b'WEBP'
        if not valid:raise PolicyError('截图内容损坏')
        return data,mime
    def delete_screenshots(self,ids=None,since=None,until=None):
        with self.lock:
            if ids is not None:
                if not isinstance(ids,list) or len(ids)>1000 or any(not isinstance(i,str) or not re.fullmatch('[a-f0-9]{32}',i) for i in ids):raise PolicyError('截图选择无效')
                rows=[self.db.execute('SELECT id,file FROM tracking_screenshots WHERE id=?',(i,)).fetchone() for i in ids]
            else:
                since,until=bounds(since,until);rows=self.db.execute('SELECT id,file FROM tracking_screenshots WHERE at>=? AND at<?',(since,until)).fetchall()
            count=0
            for row in rows:
                if row is None:continue
                try:self.screenshot_path(row['file']).unlink()
                except PolicyError as error:
                    if str(error)!='截图文件不存在':raise
                self.db.execute('DELETE FROM tracking_screenshots WHERE id=?',(row['id'],));count+=1
            self.db.commit();return {'deleted':count}
    def prune(self,now):
        s=self.settings();self.delete_screenshots(since=0,until=max(1,now-s['screenshot_retention_days']*86400))
        cutoff=now-s['retention_days']*86400
        with self.lock:self.db.execute('DELETE FROM tracking_activities WHERE end<?',(cutoff,));self.db.commit()
    def import_legacy(self):
        """One-time import of known durations; never invent missing window data."""
        with self.lock:
            if self.db.execute("SELECT 1 FROM tracking_meta WHERE key='legacy_imported'").fetchone():return 0
            with self.store.lock:rows=self.store.db.execute('SELECT id,at,kind,target,seconds FROM events WHERE seconds>0 ORDER BY id').fetchall()
            count=0
            for row in rows:
                at,duration=float(row['at']),float(row['seconds'])
                if not math.isfinite(at) or not math.isfinite(duration) or duration<=0 or at-duration<0:continue
                timeline='documents' if row['kind']=='website' else 'applications' if row['kind']=='application' else ''
                if not timeline:continue
                group=str(row['target']);application=group if timeline=='applications' else ''
                self.db.execute('INSERT OR IGNORE INTO tracking_activities VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',('legacy-'+str(row['id']),timeline,at-duration,at,group,group,application,'','','','','legacy',json.dumps({'precision':'aggregate','kind':row['kind']})));count+=1
            self.db.execute("INSERT INTO tracking_meta VALUES('legacy_imported',?)",(json.dumps({'rows':count}),));self.db.commit();return count
    def report(self,since,until,timeline='applications',query='',group_by='day',limit=10,groups=None,folder=''):
        from .tracking_reports import top
        return top(self,since,until,timeline,query,group_by,limit,groups,folder)
    def day_statistics(self,since,until,query=''):
        since,until=bounds(since,until)
        activities=self.activities(since,until,'computer',query);tags=self.tags(since,until)
        result=[];date=dt.datetime.fromtimestamp(since).date()
        while dt.datetime.combine(date,dt.time()).timestamp()<until:
            a,b=day_bounds(date.isoformat());a=max(a,since);b=min(b,until)
            spans=intersect([[v['start'],v['end']] for v in activities if v['group_name']=='Active'],[[a,b]])
            tagged=intersect(spans,[[v['start'],v['end']] for v in tags]);active=seconds(spans)
            first=min((v[0] for v in spans),default=None);last=max((v[1] for v in spans),default=None)
            result.append({'day':date.isoformat(),'first':first,'last':last,'duration':last-first if first is not None else 0,'active':active,'tagged':seconds(tagged),'untagged':max(0,active-seconds(tagged))})
            date+=dt.timedelta(days=1)
        return result
    def timesheet(self,since,until,depth=30,billable=None,round_minutes=0):
        from .tracking_timesheet import legacy
        return legacy(self,since,until,depth,billable,round_minutes)
    def edit_activity(self,ident,value):
        if not isinstance(value,dict) or set(value)-{'start','end','title','group_name'}:raise PolicyError('活动修改无效')
        with self.lock:
            row=self.db.execute('SELECT * FROM tracking_activities WHERE id=?',(text(ident,100),)).fetchone()
            if not row:raise PolicyError('找不到该活动')
            start,end=bounds(value.get('start',row['start']),value.get('end',row['end']))
            title=text(value.get('title',row['title']));group=text(value.get('group_name',row['group_name']))
            metadata=json.loads(row['metadata']);metadata['edited']=True
            self.db.execute('UPDATE tracking_activities SET start=?,end=?,title=?,group_name=?,source=?,metadata=? WHERE id=?',(start,end,title,group,'manual',json.dumps(metadata),ident));self.db.commit();return {'ok':True}
    def mark_idle(self,since,until):
        """Backdate a newly detected idle period without touching manual entries."""
        since,until=bounds(since,until)
        with self.lock:
            rows=self.db.execute("SELECT * FROM tracking_activities WHERE source='recorded' AND end>? AND start<? AND (timeline IN ('applications','documents') OR timeline='computer' AND group_name='Active')",(since,until)).fetchall()
            spans=[]
            for row in rows:
                old=dict(row);self.db.execute('DELETE FROM tracking_activities WHERE id=?',(row['id'],))
                if row['timeline']=='computer':spans.append([max(since,row['start']),min(until,row['end'])])
                pieces=[]
                if row['start']<since:pieces.append((row['start'],since))
                if row['end']>until:pieces.append((until,row['end']))
                for a,b in pieces:
                    value={**old,'id':uuid.uuid4().hex,'start':a,'end':b};keys=list(value)
                    self.db.execute('INSERT INTO tracking_activities ('+','.join(keys)+') VALUES('+','.join('?' for _ in keys)+')',list(value.values()))
            for a,b in intervals(spans):self.add_activity({'timeline':'computer','start':a,'end':b,'title':'Away','group_name':'Away'},merge=True)
            self.db.commit()
