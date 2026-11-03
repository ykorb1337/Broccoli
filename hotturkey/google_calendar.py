"""Independent Google Calendar client. No policy/rule/recorder dependencies."""
import base64
import copy
import datetime as dt
import hashlib
import json
import os
import re
import secrets
import threading
import time
import uuid
import tempfile
from functools import wraps
import urllib.error
import urllib.parse as url
import urllib.request
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
from .model import PolicyError
from .calendar_credentials import CalendarCredentials

API='https://www.googleapis.com/calendar/v3/'
TOKEN='https://oauth2.googleapis.com/token'
BASE_SCOPES=['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events']
LABEL_SCOPE='https://www.googleapis.com/auth/calendar.calendars.readonly'
LABEL_WRITE_SCOPE='https://www.googleapis.com/auth/calendar.calendars'
SCOPES=BASE_SCOPES+[LABEL_SCOPE]
class CalendarHTTPError(Exception):
    def __init__(self,status):self.status=status
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args):return None

def transport(method,endpoint,data=None,headers=None,form=False):
    payload=None if data is None else (url.urlencode(data).encode() if form else json.dumps(data).encode())
    request=urllib.request.Request(endpoint,data=payload,method=method,headers={**(headers or {}),**({'Content-Type':'application/x-www-form-urlencoded' if form else 'application/json'} if payload is not None else {})})
    try:
        with urllib.request.build_opener(NoRedirect).open(request,timeout=15) as response:
            raw=response.read(12*1024*1024+1)
            if len(raw)>12*1024*1024:raise PolicyError('Google 日历返回的数据过大，请缩小日期范围')
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:raise CalendarHTTPError(error.code) from None
    except (OSError,ValueError):raise PolicyError('无法连接 Google 日历，请检查网络后重试') from None

def private_json(path,value):
    fd,name=tempfile.mkstemp(dir=path.parent,prefix='.calendar-');temp=Path(name)
    try:
        with os.fdopen(fd,'w') as stream:json.dump(value,stream,ensure_ascii=False);stream.flush();os.fsync(stream.fileno())
        temp.replace(path)
    finally:
        if temp.exists():temp.unlink()

def synchronized(fn):
    @wraps(fn)
    def run(self,*args,**kwargs):
        with self.lock:return fn(self,*args,**kwargs)
    return run

def identifier(value):
    if not isinstance(value,str) or not 1<=len(value)<=1024 or any(ord(c)<32 for c in value):raise PolicyError('日历或事件标识无效')
    return url.quote(value,safe='')

def moment(point):
    if not isinstance(point,dict):raise PolicyError('事件时间无效')
    if set(point)=={'date'}:
        try:return 'date',dt.date.fromisoformat(point['date'])
        except (ValueError,TypeError):raise PolicyError('事件日期无效') from None
    if set(point)-{'dateTime','timeZone'} or 'dateTime' not in point:raise PolicyError('事件时间无效')
    try:
        value=dt.datetime.fromisoformat(point['dateTime'].replace('Z','+00:00'));zone=point.get('timeZone')
        if zone:
            tz=ZoneInfo(zone)
            if value.tzinfo is None:
                value=value.replace(tzinfo=tz)
                if value.astimezone(dt.timezone.utc).astimezone(tz).replace(tzinfo=None)!=value.replace(tzinfo=None):raise ValueError()
        if value.tzinfo is None:raise ValueError()
        return 'dateTime',value.astimezone(dt.timezone.utc)
    except (ValueError,TypeError,ZoneInfoNotFoundError):raise PolicyError('事件时间或时区无效') from None

class GoogleCalendar:
    def __init__(self,directory,request=transport,vault=None):
        self.directory=Path(directory)/'google-calendar';self.directory.mkdir(mode=0o700,exist_ok=True)
        self.config_path=self.directory/'client.json';self.cache_path=self.directory/'cache.json'
        self.vault=vault or CalendarCredentials(self.directory);self.request=request;self.lock=threading.RLock()
        self.pending=None;self.oauth=None;self.error='';self.generation=0;self._credentials=None;self.label_cache={}
    def config(self):
        if not self.config_path.exists():return {}
        return json.loads(self.config_path.read_text())
    def credentials(self):
        if self._credentials is None:self._credentials=self.vault.load()
        return self._credentials
    def status(self):
        with self.lock:
            config=self.config();connected=bool(self.credentials().get('refresh_token') or self.credentials().get('access_token')) if config else False
            if self.pending and self.pending['expires']<time.monotonic():self.pending=None;self.error='登录已过期，请重试'
            return {'configured':bool(config),'client_id':config.get('client_id',''),'connected':connected,'pending':bool(self.pending),'error':self.error,'label_permission':connected and bool({LABEL_SCOPE,LABEL_WRITE_SCOPE,'https://www.googleapis.com/auth/calendar'}&set(self.credentials().get('granted_scopes',[]))),'label_write_permission':connected and bool({LABEL_WRITE_SCOPE,'https://www.googleapis.com/auth/calendar'}&set(self.credentials().get('granted_scopes',[])))}
    def configure(self,value):
        with self.lock:
            installed=value.get('installed') if isinstance(value,dict) else None
            if not isinstance(installed,dict):raise PolicyError('请选择 Google 下载的桌面应用 OAuth JSON 文件')
            client=installed.get('client_id');secret=installed.get('client_secret','')
            if not isinstance(client,str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,200}\.apps\.googleusercontent\.com',client):raise PolicyError('桌面应用客户端 ID 无效')
            if not isinstance(secret,str) or len(secret)>4096:raise PolicyError('客户端配置无效')
            if self.config():self.disconnect()
            private_json(self.config_path,{'client_id':client,'client_secret':secret});self.error='';return self.status()
    def cancel(self):
        with self.lock:self.pending=None;self.generation+=1
        return {'ok':True}
    def begin(self,manage_labels=False):
        if type(manage_labels) is not bool:raise PolicyError('授权选项无效')
        with self.lock:
            config=self.config()
            if not config:raise PolicyError('请先导入桌面应用客户端配置')
            if self.oauth is None:
                client=self
                class Callback(BaseHTTPRequestHandler):
                    def log_message(self,*args):pass
                    def do_GET(self):
                        parsed=url.urlsplit(self.path);query=url.parse_qs(parsed.query)
                        try:
                            if self.headers.get('Host')!='127.0.0.1:'+str(self.server.server_port) or parsed.path!='/oauth2callback':raise PolicyError('回调地址无效')
                            client.complete(query);code=200;text='已连接 Google 日历。可以关闭此页面，返回 HotTurkey。'
                        except PolicyError as error:code=400;text=str(error)
                        raw=('<!doctype html><meta charset="utf-8"><title>HotTurkey</title><p>'+text+'</p>').encode()
                        self.send_response(code);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store');self.send_header('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");self.end_headers();self.wfile.write(raw)
                self.oauth=ThreadingHTTPServer(('127.0.0.1',0),Callback);self.oauth.daemon_threads=True
                threading.Thread(target=self.oauth.serve_forever,daemon=True).start()
            verifier=secrets.token_urlsafe(64);state=secrets.token_urlsafe(32);self.generation+=1
            redirect='http://127.0.0.1:'+str(self.oauth.server_port)+'/oauth2callback'
            self.pending={'state':state,'verifier':verifier,'redirect':redirect,'expires':time.monotonic()+600,'generation':self.generation}
            self.error=''
            params={'client_id':config['client_id'],'redirect_uri':redirect,'response_type':'code','scope':' '.join(SCOPES+([LABEL_WRITE_SCOPE] if manage_labels else [])),'state':state,'code_challenge':base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode(),'code_challenge_method':'S256','access_type':'offline','prompt':'consent'}
            return {'url':'https://accounts.google.com/o/oauth2/v2/auth?'+url.urlencode(params)}
    def complete(self,query):
        with self.lock:
            pending=self.pending
            if not pending or pending['expires']<time.monotonic() or len(query.get('state',[]))!=1 or not secrets.compare_digest(query['state'][0],pending['state']):raise PolicyError('登录请求无效或已过期，请返回应用重试')
            self.pending=None
            if query.get('error'):self.error='已取消 Google 登录';raise PolicyError(self.error)
            if len(query.get('code',[]))!=1 or len(query['code'][0])>8192:raise PolicyError('登录回调无效')
            config=self.config()
            try:value=self.request('POST',TOKEN,{**config,'code':query['code'][0],'code_verifier':pending['verifier'],'redirect_uri':pending['redirect'],'grant_type':'authorization_code'},form=True)
            except (CalendarHTTPError,PolicyError):self.error='Google 登录失败，请检查客户端配置后重试';raise PolicyError(self.error) from None
            if not value.get('access_token') or not value.get('refresh_token'):self.error='未取得离线授权，请重新连接 Google 日历';raise PolicyError(self.error)
            granted=set(value.get('scope','').split())
            if not set(BASE_SCOPES)<=granted:self.error='请允许查看日历列表及编辑日历事件后重试';raise PolicyError(self.error)
            self._save_credentials(value);self._clear_cache();self.label_cache.clear()
    def _save_credentials(self,value):
        if any(not isinstance(value.get(k),str) or not 1<=len(value[k])<=16384 for k in ['access_token','refresh_token']):raise PolicyError('Google 返回的授权无效')
        expires=max(0,min(float(value.get('expires_in',3600)),86400)-60)
        granted=value.get('scope','').split() if isinstance(value.get('scope'),str) else value.get('granted_scopes',[])
        value={k:value[k] for k in ['access_token','refresh_token'] if k in value};value['expires_at']=time.time()+expires;value['granted_scopes']=granted
        self.vault.save(value);self._credentials=value
    def _token(self):
        stored=self.credentials()
        if stored.get('access_token') and stored.get('expires_at',0)>time.time():return stored['access_token']
        if not stored.get('refresh_token'):raise PolicyError('请连接 Google 日历')
        try:
            result=self.request('POST',TOKEN,{**self.config(),'refresh_token':stored['refresh_token'],'grant_type':'refresh_token'},form=True)
        except CalendarHTTPError as error:
            if error.status in (400,401):self.vault.delete();self._credentials={};raise PolicyError('Google 授权已失效，请重新连接') from None
            raise PolicyError('暂时无法刷新 Google 授权，请稍后重试') from None
        if not result.get('access_token'):raise PolicyError('Google 未返回有效授权')
        self._save_credentials({**stored,**result});return self._credentials['access_token']
    def call(self,method,path,data=None,params=None,etag=None):
        with self.lock:
            headers={'Authorization':'Bearer '+self._token()}
            if etag:
                if not isinstance(etag,str) or len(etag)>512 or '\r' in etag or '\n' in etag:raise PolicyError('事件版本无效')
                headers['If-Match']=etag
            try:return self.request(method,API+path+('?' +url.urlencode(params) if params else ''),data,headers=headers)
            except CalendarHTTPError as error:
                if error.status==401:self._credentials['expires_at']=0;raise PolicyError('Google 授权需要刷新，请重试') from None
                message={403:'没有权限操作此日历，或 Google Calendar API 尚未启用',404:'事件已不存在，请刷新日历',410:'事件已被删除，请刷新日历',412:'日历内容已在其他设备修改，请刷新后重试',429:'请求过于频繁，请稍后重试'}.get(error.status,'Google 日历操作失败，请稍后重试')
                raise PolicyError(message) from None
    @synchronized
    def calendars(self):
        items=[];page=None
        for _ in range(10):
            result=self.call('GET','users/me/calendarList',params={**({'pageToken':page} if page else {}),'maxResults':250})
            items.extend({k:c[k] for k in ['id','summary','summaryOverride','backgroundColor','foregroundColor','primary','accessRole','timeZone','selected'] if k in c} for c in result.get('items',[]) if not c.get('deleted'))
            page=result.get('nextPageToken')
            if not page:return {'items':items}
        raise PolicyError('日历数量过多')
    @synchronized
    def labels(self,calendar):
        key=identifier(calendar);cached=self.label_cache.get(calendar)
        if cached and cached['until']>time.monotonic():return cached['value']
        try:
            value=self.call('GET','calendars/'+key)
            items=[{k:label[k] for k in ['id','name','backgroundColor'] if k in label} for label in value.get('labelProperties',{}).get('eventLabels',[])]
            result={'items':items,'needs_authorization':False}
        except PolicyError as error:
            result={'items':[],'needs_authorization':not self.status()['label_permission'],'error':str(error)}
        self.label_cache[calendar]={'until':time.monotonic()+300,'value':result};return result
    @synchronized
    def create_label(self,calendar,name,color):
        if not isinstance(name,str) or not 1<=len(name.strip())<=50 or any(ord(c)<32 for c in name):raise PolicyError('标签名称须为 1–50 个字符')
        if not isinstance(color,str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',color):raise PolicyError('请选择有效的标签颜色')
        if not self.status().get('label_write_permission'):raise PolicyError('请先授权管理日历标签')
        key=identifier(calendar)
        if self.call('GET','users/me/calendarList/'+key).get('accessRole')!='owner':raise PolicyError('只有日历所有者可以添加标签')
        current=self.call('GET','calendars/'+key);etag=current.get('etag')
        if not isinstance(etag,str) or not etag:raise PolicyError('请刷新日历后再添加标签')
        properties=copy.deepcopy(current.get('labelProperties') or {});labels=properties.setdefault('eventLabels',[])
        name=name.strip();color=color.lower()
        for label in labels:
            if str(label.get('name','')).strip().casefold()==name.casefold():
                if label.get('backgroundColor','').lower()==color:return {'label':{k:label[k] for k in ['id','name','backgroundColor'] if k in label},'items':[{k:item[k] for k in ['id','name','backgroundColor'] if k in item} for item in labels]}
                raise PolicyError('已存在同名标签')
        if len(labels)>=200:raise PolicyError('每个日历最多 200 个标签')
        label={'id':str(uuid.uuid4()),'name':name,'backgroundColor':color};labels.append(label)
        self.call('PATCH','calendars/'+key,{'labelProperties':properties},etag=etag)
        self.label_cache.pop(calendar,None)
        return {'label':label,'items':[{k:item[k] for k in ['id','name','backgroundColor'] if k in item} for item in labels]}
    @synchronized
    def events(self,calendar,since,until):
        a=moment({'dateTime':since})[1];b=moment({'dateTime':until})[1]
        if not a<b<=a+dt.timedelta(days=93):raise PolicyError('请选择不超过 93 天的日期范围')
        path='calendars/'+identifier(calendar)+'/events';key=json.dumps([calendar,since,until]);items=[];page=None
        try:
            for _ in range(20):
                result=self.call('GET',path,params={'timeMin':since,'timeMax':until,'singleEvents':'true','orderBy':'startTime','maxResults':2500,**({'pageToken':page} if page else {})})
                items.extend(e for e in result.get('items',[]) if e.get('status')!='cancelled');page=result.get('nextPageToken')
                if len(items)>5000:raise PolicyError('事件数量过多，请缩小日期范围')
                if not page:break
            else:raise PolicyError('事件数量过多，请缩小日期范围')
            value={'items':items,'timeZone':result.get('timeZone','UTC'),'synced_at':time.time(),'offline':False}
            with self.lock:
                cache=json.loads(self.cache_path.read_text()) if self.cache_path.exists() else {};cache[key]=value
                while len(cache)>8:cache.pop(next(iter(cache)))
                if len(json.dumps(cache))<=10*1024*1024:private_json(self.cache_path,cache)
            return value
        except PolicyError as error:
            with self.lock:
                cached=json.loads(self.cache_path.read_text()).get(key) if self.cache_path.exists() and self.credentials() else None
            if cached:return {**cached,'offline':True,'error':str(error)}
            raise
    @synchronized
    def get(self,calendar,event):return self.call('GET','calendars/'+identifier(calendar)+'/events/'+identifier(event))
    @synchronized
    def save(self,calendar,event,value,etag=None):
        if not isinstance(value,dict) or set(value)-{'summary','description','location','start','end','recurrence','attendees','reminders','eventLabelId'}:raise PolicyError('事件内容无效')
        for field,limit in [('summary',1000),('description',20000),('location',2000)]:
            if field in value and (not isinstance(value[field],str) or len(value[field])>limit):raise PolicyError('事件文本过长或无效')
        if 'start' not in value or 'end' not in value:raise PolicyError('请选择事件时间')
        kind,a=moment(value['start']);other,b=moment(value['end'])
        if kind!=other or b<=a:raise PolicyError('结束时间须晚于开始时间')
        if 'recurrence' in value:
            rows=value['recurrence']
            if not isinstance(rows,list) or len(rows)>10 or any(not isinstance(r,str) or len(r)>2000 or not re.match(r'^(RRULE|EXDATE|RDATE|EXRULE):[^\r\n]+$',r) for r in rows):raise PolicyError('重复规则无效')
        if 'attendees' in value:
            rows=value['attendees']
            if not isinstance(rows,list) or len(rows)>100 or any(not isinstance(r,dict) or set(r)!={'email'} or not isinstance(r['email'],str) or not re.fullmatch(r'[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+',r['email']) for r in rows):raise PolicyError('参与者邮箱无效')
        if 'reminders' in value:
            r=value['reminders']
            if not isinstance(r,dict) or set(r)-{'useDefault','overrides'} or type(r.get('useDefault')) is not bool:raise PolicyError('提醒无效')
            rows=r.get('overrides',[])
            if not isinstance(rows,list) or len(rows)>5 or any(not isinstance(x,dict) or set(x)!={'method','minutes'} or x['method'] not in ('popup','email') or type(x['minutes']) is not int or not 0<=x['minutes']<=40320 for x in rows):raise PolicyError('提醒无效')
        if 'eventLabelId' in value:
            label=value['eventLabelId']
            if not isinstance(label,str) or len(label)>128 or any(ord(c)<32 for c in label):raise PolicyError('标签无效')
            if label:
                definitions=self.labels(calendar)
                if definitions.get('error') or definitions.get('needs_authorization'):raise PolicyError('无法读取标签，请刷新或重新授权')
                if not any(row.get('id')==label for row in definitions['items']):raise PolicyError('标签已不存在，请刷新后重试')
        if event and not etag:raise PolicyError('请刷新事件后再保存')
        path='calendars/'+identifier(calendar)+'/events'+('/'+identifier(event) if event else '')
        if event and 'attendees' in value:
            previous=self.get(calendar,event);existing={row.get('email','').lower():row for row in previous.get('attendees',[])}
            value={**value,'attendees':[{**existing.get(row['email'].lower(),{}),**row} for row in value['attendees']]}
        # PATCH merges nested objects. A date-only update must explicitly remove
        # the existing clock fields (and vice versa), otherwise Google receives
        # both date and dateTime and rejects the event.
        payload=copy.deepcopy(value)
        if event:
            for key in ('start','end'):
                clear={'dateTime':None,'timeZone':None} if kind=='date' else {'date':None}
                payload[key]={**clear,**payload[key]}
        result=self.call('PATCH' if event else 'POST',path,payload,params={'sendUpdates':'all',**({'eventLabelVersion':1} if 'eventLabelId' in value else {})},etag=etag)
        self._clear_cache();return result
    @synchronized
    def respond(self,calendar,event,response,etag):
        if response not in ('accepted','declined','tentative') or not isinstance(etag,str) or not etag:raise PolicyError('请选择参加状态并刷新事件')
        previous=self.get(calendar,event)
        if previous.get('etag')!=etag:raise PolicyError('事件已在其他设备修改，请刷新后重试')
        attendees=[row for row in previous.get('attendees',[]) if row.get('self') is True]
        if len(attendees)!=1 or not isinstance(attendees[0].get('email'),str) or not re.fullmatch(r'[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+',attendees[0]['email']):raise PolicyError('此事件没有可回复的本人邀请')
        if previous.get('status')=='cancelled':raise PolicyError('此事件已取消')
        # attendeesOmitted updates this participant's response without replacing
        # the invitation list. The caller cannot nominate another participant.
        value={'attendeesOmitted':True,'attendees':[{'email':attendees[0]['email'],'responseStatus':response}]}
        result=self.call('PATCH','calendars/'+identifier(calendar)+'/events/'+identifier(event),value,etag=etag)
        self._clear_cache();return result
    @synchronized
    def delete(self,calendar,event,etag):
        if not etag:raise PolicyError('请刷新事件后再删除')
        self.call('DELETE','calendars/'+identifier(calendar)+'/events/'+identifier(event),params={'sendUpdates':'all'},etag=etag);self._clear_cache();return {'ok':True}
    def _clear_cache(self):
        with self.lock:
            if self.cache_path.exists():self.cache_path.unlink()
    def disconnect(self):
        with self.lock:
            self.cancel();self.vault.delete();self._credentials={};self._clear_cache();self.label_cache.clear();self.error=''
        return {'ok':True}
    def close(self):
        self.cancel()
        if self.oauth:self.oauth.shutdown();self.oauth.server_close();self.oauth=None

def dispatch(client,path,method,data,query):
    if getattr(client,'read_only',False) and method!='GET':raise PolicyError('只读日历预览不能连接或修改 Google 账号')
    if getattr(client,'preview_copy',False) and method=='POST' and path not in ('save','respond','delete','labels/create'):raise PolicyError('独立副本不能连接或更改 Google 账号')
    get=lambda key:query.get(key,[''])[0]
    if method=='GET':
        if path=='status':return client.status()
        if path=='calendars':return client.calendars()
        if path=='colors':return client.call('GET','colors')
        if path=='labels':return client.labels(get('calendar'))
        if path=='events':return client.events(get('calendar'),get('since'),get('until'))
        if path=='event':return client.get(get('calendar'),get('event'))
    if method=='POST':
        if path=='configure':return client.configure(data.get('configuration'))
        if path=='connect':return client.begin(data.get('manage_labels',False))
        if path=='labels/create':return client.create_label(data.get('calendar'),data.get('name'),data.get('color'))
        if path=='cancel':return client.cancel()
        if path=='disconnect':return client.disconnect()
        if path=='save':return client.save(data.get('calendar'),data.get('event'),data.get('value'),data.get('etag'))
        if path=='respond':return client.respond(data.get('calendar'),data.get('event'),data.get('response'),data.get('etag'))
        if path=='delete':return client.delete(data.get('calendar'),data.get('event'),data.get('etag'))
    raise PolicyError('Google 日历操作无效')
