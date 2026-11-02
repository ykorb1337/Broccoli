"""Read-only Google event snapshot for UI acceptance, with no OAuth credentials."""
import copy
import datetime as dt
import json
from pathlib import Path
from zoneinfo import ZoneInfo
from .model import PolicyError

class CalendarSnapshot:
    read_only=True
    def __init__(self,cache,calendars=None):
        self.records={};self.zones={};self.synced=0
        for key,value in cache.items():
            try:calendar,_,_=json.loads(key)
            except (ValueError,TypeError):continue
            self.zones[calendar]=value.get('timeZone','UTC');self.synced=max(self.synced,value.get('synced_at',0))
            for event in value.get('items',[]):
                fields=['id','summary','start','end','location','colorId','eventLabelId','htmlLink','eventType','visibility','status','etag']
                item={k:copy.deepcopy(event[k]) for k in fields if k in event}
                item['attendees']=[{'self':True,'responseStatus':a.get('responseStatus')} for a in event.get('attendees',[]) if a.get('self')]
                if item.get('id'):self.records[(calendar,item['id'])]=item
        metadata={c['id']:c for c in calendars or []}
        self.calendar_items=[{**{k:v for k,v in metadata.get(key,{'id':key,'summary':key}).items() if k in ['id','summary','summaryOverride','backgroundColor','foregroundColor','primary','selected','timeZone']},'accessRole':'reader','timeZone':self.zones[key]} for key in self.zones]
    def status(self):return {'configured':False,'client_id':'','connected':True,'pending':False,'error':'','read_only':True}
    def calendars(self):return {'items':copy.deepcopy(self.calendar_items)}
    def call(self,method,path,*args,**kwargs):
        if method=='GET' and path=='colors':return {'event':{}}
        raise PolicyError('只读日历预览不能连接或修改 Google 账号')
    def events(self,calendar,since,until):
        start=dt.datetime.fromisoformat(since.replace('Z','+00:00'));end=dt.datetime.fromisoformat(until.replace('Z','+00:00'));zone=ZoneInfo(self.zones.get(calendar,'UTC'))
        def point(value):return dt.datetime.fromisoformat(value['dateTime'].replace('Z','+00:00')) if value.get('dateTime') else dt.datetime.combine(dt.date.fromisoformat(value['date']),dt.time(),zone)
        result=[]
        for (key,_),event in self.records.items():
            if key!=calendar:continue
            if point(event['start'])<end and point(event['end'])>start:result.append(copy.deepcopy(event))
        return {'items':result,'timeZone':str(zone),'synced_at':self.synced,'offline':False,'read_only':True}
    def get(self,calendar,event):
        value=self.records.get((calendar,event))
        if value is None:raise PolicyError('快照中没有此事件')
        return copy.deepcopy(value)
    def labels(self,calendar):return {'items':[],'needs_authorization':False}
    def close(self):pass

def attach_snapshot(source,service):
    import urllib.request
    source=Path(source);path=source/'google-calendar/cache.json'
    if not path.exists():return {'calendar_snapshot_events':0}
    if path.stat().st_size>12*1024*1024:raise PolicyError('日历快照过大')
    metadata=[]
    try:
        connection=json.loads((source/'connection.json').read_text())
        request=urllib.request.Request('http://127.0.0.1:'+str(connection['port'])+'/api/google-calendar/calendars',headers={'Authorization':'Bearer '+connection['token']})
        with urllib.request.urlopen(request,timeout=10) as response:metadata=json.load(response).get('items',[])
    except (OSError,ValueError,KeyError):pass
    service.google_calendar=CalendarSnapshot(json.loads(path.read_text()),metadata)
    return {'calendar_snapshot_events':len(service.google_calendar.records),'calendar_snapshot_read_only':True,'google_credentials_copied':False}
