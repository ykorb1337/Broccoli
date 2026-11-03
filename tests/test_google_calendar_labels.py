"""Label and single-instance mutation contracts, with a fake Google transport."""
import copy
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit,parse_qs
from broccoli.google_calendar import GoogleCalendar,PolicyError,CalendarHTTPError,BASE_SCOPES,LABEL_SCOPE,LABEL_WRITE_SCOPE
from broccoli.google_calendar_preview import CalendarSnapshot

class Vault:
 def __init__(self):self.value={}
 def load(self):return copy.deepcopy(self.value)
 def save(self,value):self.value=copy.deepcopy(value)
 def delete(self):self.value={}

class LabelTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.calls=[];self.replies=[];self.vault=Vault()
  def request(method,endpoint,data=None,headers=None,form=False):
   self.calls.append((method,endpoint,copy.deepcopy(data),headers));reply=self.replies.pop(0) if self.replies else {}
   if isinstance(reply,Exception):raise reply
   return reply
  self.client=GoogleCalendar(Path(self.tmp.name),request,self.vault)
  self.client.configure({'installed':{'client_id':'12345678-fixture.apps.googleusercontent.com'}})
  self.client._save_credentials({'access_token':'fixture-access','refresh_token':'fixture-refresh','scope':' '.join(BASE_SCOPES+[LABEL_WRITE_SCOPE])})
  self.label={'id':'existing','name':'Research','backgroundColor':'#123456','futureField':True}
  self.metadata={'etag':'"calendar-v1"','summary':'Unchanged','timeZone':'America/New_York','labelProperties':{'eventLabels':[self.label],'futureProperty':{'keep':True}}}
 def tearDown(self):self.client.close();self.tmp.cleanup()
 def points(self):return {'start':{'dateTime':'2026-11-03T09:00:00','timeZone':'America/New_York'},'end':{'dateTime':'2026-11-03T10:00:00','timeZone':'America/New_York'}}
 def test_creation_preserves_all_definitions_and_uses_calendar_etag(self):
  self.replies=[{'accessRole':'owner'},copy.deepcopy(self.metadata),{}]
  result=self.client.create_label('calendar@example.com',' Study ','#AABBCC')
  method,endpoint,value,headers=self.calls[-1]
  self.assertEqual(method,'PATCH');self.assertTrue(endpoint.endswith('/calendars/calendar%40example.com'));self.assertEqual(headers['If-Match'],'"calendar-v1"')
  self.assertEqual(set(value),{'labelProperties'});self.assertEqual(value['labelProperties']['eventLabels'][0],self.label);self.assertEqual(value['labelProperties']['futureProperty'],{'keep':True})
  self.assertEqual(result['label']['name'],'Study');self.assertEqual(result['label']['backgroundColor'],'#aabbcc');self.assertEqual(len(result['label']['id']),36)
  self.assertEqual(self.metadata['labelProperties']['eventLabels'],[self.label]);self.assertNotIn('futureField',result['items'][0])
 def test_missing_permission_nonowner_invalid_input_and_limit_never_write(self):
  self.client._credentials['granted_scopes']=BASE_SCOPES+[LABEL_SCOPE]
  with self.assertRaises(PolicyError):self.client.create_label('a','Study','#123456')
  self.assertEqual(self.calls,[]);self.client._credentials['granted_scopes']+=[LABEL_WRITE_SCOPE]
  for name,color in [('', '#123456'),('x'*51,'#123456'),('bad\nname','#123456'),('Name','red')]:
   with self.assertRaises(PolicyError):self.client.create_label('a',name,color)
  self.assertEqual(self.calls,[]);self.replies=[{'accessRole':'writer'}]
  with self.assertRaises(PolicyError):self.client.create_label('a','Study','#123456')
  self.replies=[{'accessRole':'owner'},{'etag':'v','labelProperties':{'eventLabels':[{'id':str(i),'name':str(i)} for i in range(200)]}}]
  with self.assertRaises(PolicyError):self.client.create_label('a','Study','#123456')
  self.assertTrue(all(c[0]=='GET' for c in self.calls))
 def test_idempotent_retry_and_concurrent_change(self):
  self.replies=[{'accessRole':'owner'},self.metadata]
  result=self.client.create_label('a','research','#123456');self.assertEqual(result['label']['id'],'existing');self.assertEqual(len(self.calls),2)
  self.replies=[{'accessRole':'owner'},self.metadata,CalendarHTTPError(412)]
  with self.assertRaisesRegex(PolicyError,'其他设备'):self.client.create_label('a','Study','#123456')
 def test_assignment_clear_and_drag_target_exact_instance(self):
  self.replies=[{'labelProperties':{'eventLabels':[self.label]}},{}]
  self.client.save('a','master_20261103T140000Z',{**self.points(),'eventLabelId':'existing'},'instance-etag')
  self.assertTrue(self.calls[-1][1].endswith('master_20261103T140000Z?sendUpdates=all&eventLabelVersion=1'))
  self.assertEqual(self.calls[-1][3]['If-Match'],'instance-etag');self.assertEqual(self.calls[-1][2]['eventLabelId'],'existing')
  self.client.save('a','instance',{**self.points(),'eventLabelId':''},'v');self.assertEqual(self.calls[-1][2]['eventLabelId'],'')
  self.client.save('a','master_20261103T140000Z',self.points(),'instance-etag')
  self.assertNotIn('eventLabelVersion',self.calls[-1][1]);self.assertNotIn('eventLabelId',self.calls[-1][2]);self.assertNotIn('recurrence',self.calls[-1][2])
  count=len(self.calls)
  with self.assertRaises(PolicyError):self.client.save('a','instance',{**self.points(),'eventLabelId':'missing'},'v')
  self.assertEqual(len(self.calls),count)
 def test_scope_expansion_is_opt_in_and_write_scope_allows_read(self):
  self.assertTrue(self.client.status()['label_permission']);self.assertTrue(self.client.status()['label_write_permission'])
  self.replies=[CalendarHTTPError(403)];self.assertFalse(self.client.labels('a')['needs_authorization'])
  # No callback server is needed to verify the authorization request contract.
  fake=type('Server',(),{'server_port':12345,'shutdown':lambda _:None,'server_close':lambda _:None})()
  self.client.oauth=fake
  ordinary=parse_qs(urlsplit(self.client.begin()['url']).query)['scope'][0].split();self.assertNotIn(LABEL_WRITE_SCOPE,ordinary)
  expanded=parse_qs(urlsplit(self.client.begin(True)['url']).query)['scope'][0].split();self.assertIn(LABEL_WRITE_SCOPE,expanded)
  with self.assertRaises(PolicyError):self.client.begin('true')
 def test_editable_snapshot_keeps_label_and_event_writes_in_memory(self):
  cache={json.dumps(['a','s','e']):{'timeZone':'America/New_York','items':[{'id':'one','etag':'v','eventLabelId':'existing',**self.points()}]}}
  before=json.dumps(cache,sort_keys=True)
  snapshot=CalendarSnapshot(cache,[{'id':'a','accessRole':'owner','labels':[self.label]}],editable=True)
  created=snapshot.create_label('a','Study','#abcdef');self.assertEqual(len(snapshot.labels('a')['items']),2)
  changed=snapshot.save('a','one',{**self.points(),'eventLabelId':created['label']['id']},'v');self.assertEqual(changed['eventLabelId'],created['label']['id'])
  self.assertEqual(json.dumps(cache,sort_keys=True),before);self.assertEqual(self.calls,[])

if __name__=='__main__':unittest.main()
