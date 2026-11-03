"""Isolated Google event snapshot for UI acceptance, with no OAuth credentials."""
import copy
import datetime as dt
import json
import threading
import time
import uuid
import urllib.parse
from pathlib import Path
from zoneinfo import ZoneInfo
from .model import PolicyError
from .google_calendar import GoogleCalendar,moment

class CalendarSnapshot:
    read_only=True
    def __init__(self,cache,calendars=None,*,editable=False):
        self.read_only=not editable;self.preview_copy=editable;self.lock=threading.RLock()
        self.records={};self.zones={};self.synced=0;self.label_cache={};self.label_versions={}
        for key,value in cache.items():
            try:calendar,_,_=json.loads(key)
            except (ValueError,TypeError):continue
            self.zones[calendar]=value.get('timeZone','UTC');self.synced=max(self.synced,value.get('synced_at',0))
            for event in value.get('items',[]):
                fields=['id','summary','description','start','end','location','reminders','colorId','eventLabelId','htmlLink','eventType','visibility','status','etag','recurringEventId','originalStartTime','recurrence']
                item={k:copy.deepcopy(event[k]) for k in fields if k in event}
                item['attendees']=[{'self':True,'responseStatus':a.get('responseStatus')} for a in event.get('attendees',[]) if a.get('self')]
                if editable:
                    item['attendees']=[{**{k:copy.deepcopy(a[k]) for k in ['self','organizer','displayName','responseStatus'] if k in a},'email':('self' if a.get('self') else 'guest-'+str(i))+'@preview.invalid'} for i,a in enumerate(event.get('attendees',[]))]
                if item.get('id'):self.records[(calendar,item['id'])]=item
        metadata={c['id']:c for c in calendars or []}
        self.label_items={key:copy.deepcopy(value.get('labels',[])) for key,value in metadata.items()}
        self.calendar_items=[{**{k:v for k,v in metadata.get(key,{'id':key,'summary':key}).items() if k in ['id','summary','summaryOverride','backgroundColor','foregroundColor','primary','selected','timeZone']},'accessRole':'reader','timeZone':self.zones[key]} for key in self.zones]
        if editable:
            for item in self.calendar_items:item['accessRole']=metadata.get(item['id'],{}).get('accessRole','reader')
    def status(self):return {'configured':False,'client_id':'','connected':True,'pending':False,'error':'','read_only':self.read_only,'preview_copy':self.preview_copy,'label_permission':True,'label_write_permission':self.preview_copy}
    def calendars(self):return {'items':copy.deepcopy(self.calendar_items)}
    def call(self,method,path,*args,**kwargs):
        if method=='GET' and path=='colors':return {'event':{}}
        parts=path.split('/')
        if method=='GET' and path.startswith('users/me/calendarList/'):
            calendar=urllib.parse.unquote(parts[-1]);return copy.deepcopy(next((c for c in self.calendar_items if c['id']==calendar),{}))
        if len(parts)==2 and parts[0]=='calendars':
            calendar=urllib.parse.unquote(parts[1]);version=self.label_versions.setdefault(calendar,'"preview-labels-'+uuid.uuid4().hex+'"')
            if method=='PATCH' and self.preview_copy:
                if next((c.get('accessRole') for c in self.calendar_items if c['id']==calendar),'reader')!='owner':raise PolicyError('只有日历所有者可以添加标签')
                if kwargs.get('etag')!=version:raise PolicyError('标签已修改，请刷新后重试')
                self.label_items[calendar]=copy.deepcopy(args[0]['labelProperties']['eventLabels']);self.label_versions[calendar]='"preview-labels-'+uuid.uuid4().hex+'"'
            elif method!='GET':raise PolicyError('只读日历副本')
            return {'id':calendar,'etag':self.label_versions[calendar],'labelProperties':{'eventLabels':copy.deepcopy(self.label_items.get(calendar,[]))}}

        if self.preview_copy and method in ('POST','PATCH','DELETE'):
            parts=path.split('/')
            if len(parts) not in (3,4) or parts[0]!='calendars' or parts[2]!='events':raise PolicyError('副本操作无效')
            calendar=urllib.parse.unquote(parts[1]);event=urllib.parse.unquote(parts[3]) if len(parts)==4 else uuid.uuid4().hex
            role=next((c.get('accessRole') for c in self.calendar_items if c['id']==calendar),'reader')
            if role not in ('owner','writer','writerWithoutPrivateAccess'):raise PolicyError('此日历只读')
            key=(calendar,event);previous=self.records.get(key)
            if method!='POST' and (previous is None or previous.get('etag')!=kwargs.get('etag')):raise PolicyError('副本事件已修改，请刷新后重试')
            if method=='DELETE':del self.records[key];return {}
            value=copy.deepcopy(args[0]);result=copy.deepcopy(previous or {'id':event})
            if value.pop('attendeesOmitted',False):
                reply=value.pop('attendees')[0];result['attendees']=[{**a,'responseStatus':reply['responseStatus']} if a.get('self') and a.get('email')==reply['email'] else a for a in result.get('attendees',[])]
            for field in ['start','end']:
                if field not in value:continue
                point=copy.deepcopy(result.get(field,{}) if method=='PATCH' else {})
                for name,item in value[field].items():
                    if item is None:point.pop(name,None)
                    else:point[name]=item
                if point.get('dateTime'):point['dateTime']=moment(point)[1].isoformat()
                value[field]=point
            result.update(value);result['etag']='"preview-'+uuid.uuid4().hex+'"';self.records[key]=result;return copy.deepcopy(result)
        raise PolicyError('只读日历预览不能连接或修改 Google 账号')
    def events(self,calendar,since,until):
        start=dt.datetime.fromisoformat(since.replace('Z','+00:00'));end=dt.datetime.fromisoformat(until.replace('Z','+00:00'));zone=ZoneInfo(self.zones.get(calendar,'UTC'))
        def point(value):return dt.datetime.fromisoformat(value['dateTime'].replace('Z','+00:00')) if value.get('dateTime') else dt.datetime.combine(dt.date.fromisoformat(value['date']),dt.time(),zone)
        result=[]
        for (key,_),event in self.records.items():
            if key!=calendar:continue
            if point(event['start'])<end and point(event['end'])>start:result.append(copy.deepcopy(event))
        return {'items':result,'timeZone':str(zone),'synced_at':self.synced,'offline':False,'read_only':self.read_only}
    def get(self,calendar,event):
        value=self.records.get((calendar,event))
        if value is None:raise PolicyError('快照中没有此事件')
        return copy.deepcopy(value)
    def labels(self,calendar):return {'items':copy.deepcopy(self.label_items.get(calendar,[])),'needs_authorization':False}
    # Reuse production validation, but all transport terminates in call() above.
    create_label=GoogleCalendar.create_label
    save=GoogleCalendar.save
    respond=GoogleCalendar.respond
    delete=GoogleCalendar.delete
    def _clear_cache(self):self.synced=time.time()
    def close(self):pass

def attach_snapshot(source,service,*,editable=False):
    import urllib.request
    source=Path(source);path=source/'google-calendar/cache.json'
    if not path.exists():return {'calendar_snapshot_events':0}
    if path.stat().st_size>12*1024*1024:raise PolicyError('日历快照过大')
    metadata=[]
    try:
        connection=json.loads((source/'connection.json').read_text())
        request=urllib.request.Request('http://127.0.0.1:'+str(connection['port'])+'/api/google-calendar/calendars',headers={'Authorization':'Bearer '+connection['token']})
        with urllib.request.urlopen(request,timeout=10) as response:metadata=json.load(response).get('items',[])
        for calendar in metadata:
            try:
                request=urllib.request.Request('http://127.0.0.1:'+str(connection['port'])+'/api/google-calendar/labels?'+urllib.parse.urlencode({'calendar':calendar['id']}),headers={'Authorization':'Bearer '+connection['token']})
                with urllib.request.urlopen(request,timeout=10) as response:calendar['labels']=json.load(response).get('items',[])
            except (OSError,ValueError,KeyError):pass
    except (OSError,ValueError,KeyError):pass
    service.google_calendar=CalendarSnapshot(json.loads(path.read_text()),metadata,editable=editable)
    return {'calendar_snapshot_events':len(service.google_calendar.records),'calendar_snapshot_read_only':not editable,'calendar_snapshot_local_edits':editable,'google_credentials_copied':False}
