import copy
import datetime as dt
import json
import tempfile
import time
import unittest
import urllib.parse as url
from pathlib import Path
from hotturkey.google_calendar import GoogleCalendar,CalendarHTTPError,PolicyError,SCOPES,dispatch,API,moment

CONFIG={'installed':{'client_id':'12345678-fixture.apps.googleusercontent.com','client_secret':'local-fixture-secret'}}
class Vault:
 def __init__(self):self.value={}
 def load(self):return copy.deepcopy(self.value)
 def save(self,value):self.value=copy.deepcopy(value)
 def delete(self):self.value={}
class CalendarTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.calls=[];self.vault=Vault();self.responses=[]
  def request(method,endpoint,data=None,headers=None,form=False):
   self.calls.append((method,endpoint,copy.deepcopy(data),headers,form));result=self.responses.pop(0) if self.responses else {}
   if isinstance(result,Exception):raise result
   return result
  self.client=GoogleCalendar(Path(self.tmp.name),request,self.vault)
 def tearDown(self):self.client.close();self.tmp.cleanup()
 def connected(self):
  self.client.configure(CONFIG);self.vault.save({'access_token':'access-fixture','refresh_token':'refresh-fixture','expires_at':time.time()+1000});self.client._credentials=None
 def value(self):return {'summary':'Reading','start':{'dateTime':'2026-11-01T09:00:00','timeZone':'America/New_York'},'end':{'dateTime':'2026-11-01T10:00:00','timeZone':'America/New_York'}}
 def test_configuration_private_and_desktop_only(self):
  self.assertFalse(self.client.status()['configured'])
  for value in [None,{}, {'web':CONFIG['installed']},{'installed':{'client_id':'https://example.com'}}]:
   with self.assertRaises(PolicyError):self.client.configure(value)
  status=self.client.configure(CONFIG);self.assertTrue(status['configured']);self.assertNotIn('client_secret',status)
  self.assertEqual(self.client.config_path.stat().st_mode&0o777,0o600);self.assertFalse((Path(self.tmp.name)/'hotturkey.sqlite3').exists())
 def test_pkce_state_one_use_callback_and_secret_not_public(self):
  self.client.configure(CONFIG);link=self.client.begin()['url'];params=url.parse_qs(url.urlsplit(link).query)
  self.assertEqual(params['code_challenge_method'],['S256']);self.assertNotIn('client_secret',params);self.assertEqual(set(params['scope'][0].split()),set(SCOPES))
  with self.assertRaises(PolicyError):self.client.complete({'state':['wrong'],'code':['value']})
  self.responses=[{'access_token':'access','refresh_token':'refresh','scope':' '.join(SCOPES),'expires_in':120}]
  self.client.complete({'state':params['state'],'code':['one-use']});self.assertTrue(self.client.status()['connected']);self.assertLess(self.vault.value['expires_at'],time.time()+61)
  with self.assertRaises(PolicyError):self.client.complete({'state':params['state'],'code':['one-use']})
  self.assertEqual(len(self.calls),1);self.assertNotIn('access',json.dumps(self.client.status()))
 def test_cancel_expire_and_denied_callback(self):
  self.client.configure(CONFIG);self.client.begin();self.client.cancel()
  with self.assertRaises(PolicyError):self.client.complete({'state':['x'],'code':['x']})
  self.client.begin();state=self.client.pending['state'];self.client.pending['expires']=0
  with self.assertRaises(PolicyError):self.client.complete({'state':[state],'code':['x']})
  self.client.begin();state=self.client.pending['state']
  with self.assertRaises(PolicyError):self.client.complete({'state':[state],'error':['access_denied']})
  self.assertFalse(self.client.status()['connected']);self.assertEqual(self.calls,[])
 def test_incomplete_scopes_do_not_store_credentials(self):
  self.client.configure(CONFIG);self.client.begin();state=self.client.pending['state'];self.responses=[{'access_token':'a','refresh_token':'r','scope':SCOPES[0]}]
  with self.assertRaises(PolicyError):self.client.complete({'state':[state],'code':['x']})
  self.assertEqual(self.vault.value,{})
 def test_refresh_token_and_expiry(self):
  self.connected();self.vault.value['expires_at']=0;self.client._credentials=None
  self.responses=[{'access_token':'new','expires_in':3600},{'items':[]}];self.client.calendars()
  self.assertEqual(self.calls[0][2]['grant_type'],'refresh_token');self.assertEqual(self.calls[1][3]['Authorization'],'Bearer new');self.assertEqual(self.vault.value['refresh_token'],'refresh-fixture')
 def test_refresh_revocation_requires_reconnect(self):
  self.connected();self.client.credentials()['expires_at']=0;self.responses=[CalendarHTTPError(400)]
  with self.assertRaises(PolicyError):self.client.calendars()
  self.assertFalse(self.client.status()['connected'])
 def test_calendars_pagination_and_no_internal_credentials(self):
  self.connected();self.responses=[{'items':[{'id':'a','summary':'A','accessRole':'reader','unknown':'hidden'}],'nextPageToken':'two'},{'items':[{'id':'b','accessRole':'owner'}]}]
  result=self.client.calendars();self.assertEqual([x['id'] for x in result['items']],['a','b']);self.assertNotIn('unknown',result['items'][0]);self.assertIn('pageToken=two',self.calls[-1][1])
 def test_events_time_range_pagination_cache_and_disconnect(self):
  self.connected();self.responses=[{'items':[{'id':'one'}],'nextPageToken':'two'},{'items':[{'id':'gone','status':'cancelled'},{'id':'two'}]}]
  value=self.client.events('private@example.com','2026-11-01T00:00:00-04:00','2026-11-02T00:00:00-05:00');self.assertEqual([x['id'] for x in value['items']],['one','two']);self.assertFalse(value['offline']);self.assertIn('private%40example.com',self.calls[0][1]);self.assertEqual(self.client.cache_path.stat().st_mode&0o777,0o600)
  self.responses=[PolicyError('offline')];cached=self.client.events('private@example.com','2026-11-01T00:00:00-04:00','2026-11-02T00:00:00-05:00');self.assertTrue(cached['offline']);self.assertEqual(cached['items'],value['items'])
  self.client.disconnect();self.assertFalse(self.client.cache_path.exists());self.assertEqual(self.vault.value,{})
 def test_range_and_time_validation_dst_gap(self):
  self.connected()
  for a,b in [('2026-11-01','2026-11-02'),('2026-11-02T00:00:00Z','2026-11-01T00:00:00Z'),('2026-01-01T00:00:00Z','2026-12-01T00:00:00Z')]:
   with self.assertRaises(PolicyError):self.client.events('a',a,b)
  with self.assertRaises(PolicyError):moment({'dateTime':'2026-03-08T02:30:00','timeZone':'America/New_York'})
  self.assertEqual(moment({'date':'2026-11-01'})[0],'date');self.assertEqual(self.calls,[])
 def test_create_and_patch_if_match_preserve_unknown_remote_fields(self):
  self.connected();self.responses=[{'id':'created'},{'id':'existing'}]
  self.client.save('calendar',None,self.value());self.client.save('calendar','instance/id',self.value(),'"v1"')
  self.assertEqual(self.calls[0][0],'POST');self.assertEqual(self.calls[1][0],'PATCH');self.assertIn('instance%2Fid',self.calls[1][1]);self.assertEqual(self.calls[1][3]['If-Match'],'"v1"');self.assertNotIn('attendees',self.calls[1][2]);self.assertIn('sendUpdates=all',self.calls[0][1])
 def test_concurrent_change_and_read_only_errors(self):
  self.connected()
  for code in [403,404,410,412,429]:
   self.responses=[CalendarHTTPError(code)]
   with self.assertRaises(PolicyError):self.client.save('a','event',self.value(),'"v1"')
 def test_attendee_response_preserved_when_editing_list(self):
  self.connected();self.responses=[{'attendees':[{'email':'a@example.com','responseStatus':'accepted'}]},{'id':'event'}]
  self.client.save('a','event',{**self.value(),'attendees':[{'email':'a@example.com'},{'email':'b@example.com'}]},'v1')
  self.assertEqual(self.calls[-1][2]['attendees'][0]['responseStatus'],'accepted')
 def test_invalid_writes_never_reach_google(self):
  self.connected()
  for value in [{},{**self.value(),'start':{'date':'bad'}},{**self.value(),'unknown':1},{**self.value(),'attendees':[{'email':'bad'}]},{**self.value(),'recurrence':['RRULE:FREQ=DAILY\nX:bad']},{**self.value(),'reminders':{'useDefault':False,'overrides':[{'method':'popup','minutes':-1}]}}]:
   with self.assertRaises(PolicyError):self.client.save('a',None,value)
  with self.assertRaises(PolicyError):self.client.save('a','event',self.value())
  with self.assertRaises(PolicyError):self.client.delete('a','event',None)
  self.assertEqual(self.calls,[])
 def test_delete_etag_and_paths(self):
  self.connected();self.client.delete('a/other','id','"version"');self.assertEqual(self.calls[0][0],'DELETE');self.assertIn('a%2Fother',self.calls[0][1]);self.assertEqual(self.calls[0][3]['If-Match'],'"version"')
 def test_get_requests_cannot_mutate(self):
  for path in ['configure','connect','disconnect','save','delete','cancel']:
   with self.assertRaises(PolicyError):dispatch(self.client,path,'GET',{}, {})
  self.assertEqual(self.calls,[])

class CalendarServiceTests(unittest.TestCase):
 def setUp(self):
  import threading
  from hotturkey.server import Service
  self.tmp=tempfile.TemporaryDirectory();self.service=Service(self.tmp.name)
  self.client=GoogleCalendar(Path(self.tmp.name),request=lambda *a,**k:{},vault=Vault());self.service.google_calendar=self.client
  self.thread=threading.Thread(target=self.service.http.serve_forever);self.thread.start()
 def tearDown(self):
  self.client.close();self.service.http.shutdown();self.service.http.server_close();self.thread.join();self.service.tracking.close();self.service.store.db.close();self.service.singleton.close();self.tmp.cleanup()
 def request(self,path,method='GET',value=None,token=True,session=''):
  import urllib.request,urllib.error
  headers={'Content-Type':'application/json','X-HotTurkey-Session':session}
  if token:headers['Authorization']='Bearer '+self.service.token
  request=urllib.request.Request(self.service.origin+'/api/'+path,method=method,data=None if value is None else json.dumps(value).encode(),headers=headers)
  try:
   with urllib.request.urlopen(request,timeout=5) as reply:return reply.status,json.load(reply)
  except urllib.error.HTTPError as error:return error.code,json.load(error)
 def test_local_token_and_password_protect_all_routes(self):
  routes=['status','calendars','colors','labels','events','event','configure','connect','cancel','disconnect','save','delete']
  for route in routes:self.assertEqual(self.request('google-calendar/'+route,token=False)[0],401)
  self.request('settings','POST',{'password':'fixture-password'})
  for route in routes:self.assertEqual(self.request('google-calendar/'+route)[0],400)
  session=self.request('auth','POST',{'password':'fixture-password'})[1]['session'];self.assertEqual(self.request('google-calendar/status',session=session)[0],200)
 def test_google_routes_never_modify_policy_or_usage(self):
  before=copy.deepcopy(self.service.store.state);tables=['events','charges'];counts={t:self.service.store.db.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in tables}
  self.assertEqual(self.request('google-calendar/status')[0],200);self.assertEqual(self.request('google-calendar/configure','POST',{'configuration':CONFIG})[0],200)
  self.request('google-calendar/disconnect','POST',{})
  self.assertEqual(self.service.store.state,before)
  for table,count in counts.items():self.assertEqual(self.service.store.db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0],count)
 def test_mutations_require_post(self):
  for route in ['configure','connect','cancel','disconnect','save','delete']:self.assertEqual(self.request('google-calendar/'+route)[0],400)
 def test_static_calendar_assets_served(self):
  import urllib.request
  for name in ['google-calendar.js','google-calendar-data.js','google-calendar.css']:
   with urllib.request.urlopen(self.service.origin+'/'+name) as reply:self.assertEqual(reply.status,200)
 def test_preview_does_not_copy_google_credentials(self):
  import importlib.util,sqlite3
  from scripts.preview_today import copy_today
  # The existing real-statistics copy path ignores the independent calendar directory.
  source=Path(self.tmp.name);self.client.configure(CONFIG);target=tempfile.TemporaryDirectory()
  from hotturkey.server import Service
  preview=Service(target.name)
  try:
   copy_today(source,preview,'2026-11-01');self.assertFalse((Path(target.name)/'google-calendar').exists());self.assertEqual(preview.store.state['blocks'],[])
  finally:preview.http.server_close();preview.tracking.close();preview.store.db.close();preview.singleton.close();target.cleanup()


class CalendarSnapshotTests(unittest.TestCase):
 def test_snapshot_is_read_only_without_credentials(self):
  from hotturkey.google_calendar_preview import CalendarSnapshot
  event={'id':'one','summary':'Real source shape','start':{'date':'2026-11-01'},'end':{'date':'2026-11-02'},'attendees':[{'email':'private@example.com','self':True,'responseStatus':'declined'}]}
  cache={json.dumps(['a','start','end']):{'items':[event],'timeZone':'America/New_York','synced_at':1}}
  snapshot=CalendarSnapshot(cache);self.assertTrue(snapshot.status()['read_only']);self.assertEqual(snapshot.calendars()['items'][0]['accessRole'],'reader')
  self.assertEqual(len(snapshot.events('a','2026-11-01T04:00:00Z','2026-11-02T05:00:00Z')['items']),1)
  self.assertNotIn('email',snapshot.get('a','one')['attendees'][0])
  for path in ['configure','connect','cancel','disconnect','save','delete']:
   with self.assertRaises(PolicyError):dispatch(snapshot,path,'POST',{}, {})

class CalendarLabelTests(unittest.TestCase):
 setUp=CalendarTests.setUp
 tearDown=CalendarTests.tearDown
 connected=CalendarTests.connected
 def test_label_definitions_and_scope_flag(self):
  self.connected();self.responses=[{'labelProperties':{'eventLabels':[{'id':'ddl','name':'Deadlines','backgroundColor':'#d50000','ignored':1}]}}]
  result=self.client.labels('a');self.assertEqual(result['items'],[{'id':'ddl','name':'Deadlines','backgroundColor':'#d50000'}]);self.assertNotIn('ignored',result['items'][0])
  self.client.labels('a');self.assertEqual(len(self.calls),1)
 def test_partial_label_consent_keeps_base_calendar_access(self):
  from hotturkey.google_calendar import BASE_SCOPES
  self.client.configure(CONFIG);self.client.begin();state=self.client.pending['state'];self.responses=[{'access_token':'access','refresh_token':'refresh','scope':' '.join(BASE_SCOPES)}]
  self.client.complete({'state':[state],'code':['value']});self.assertTrue(self.client.status()['connected']);self.assertFalse(self.client.status()['label_permission'])
 def test_missing_label_permission_is_nonfatal(self):
  self.connected();self.responses=[CalendarHTTPError(403)]
  result=self.client.labels('a');self.assertTrue(result['needs_authorization']);self.assertTrue(self.client.status()['connected'])
