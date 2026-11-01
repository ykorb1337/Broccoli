import datetime as dt,tempfile,unittest
from hotturkey.store import Store
from hotturkey.engine import Engine
from hotturkey.sleep_notices import sleep_notice

class SleepNoticeTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.store=Store(self.temp.name);self.now=dt.datetime(2026,10,31,20,0).timestamp();self.e=Engine(self.store,lambda:self.now,lambda:self.now,'boot','tester')
  self.e.configure_device_recovery('fixture-safe-word');self.b=self.e.save_block({'name':'Bedtime','device':'sleep','mode':'scheduled','enabled':True,'confirm_device':True,'schedule':[{'days':list(range(7)),'start':21*60,'end':23*60}]});self.b=self.e.find(self.b['id'])
 def tearDown(self):self.store.db.close();self.temp.cleanup()
 def test_fifteen_minutes_independent_and_once_across_restart(self):
  self.store.state['settings'].update(notifications=False,warning_minutes=[2,5]);self.assertIsNone(sleep_notice(self.e,self.b))
  self.now+=45*60;notice=sleep_notice(self.e,self.b);self.assertEqual(notice['title'],'睡眠提醒');self.assertIn('15 分钟',notice['body']);self.assertIsNone(sleep_notice(self.e,self.b))
  second=Store(self.temp.name)
  try:self.assertIsNone(sleep_notice(Engine(second,lambda:self.now,lambda:self.now,'boot','tester'),second.state['blocks'][0]))
  finally:second.db.close()
  self.now=(dt.datetime.fromtimestamp(self.now)+dt.timedelta(days=1)).timestamp();self.assertIsNotNone(sleep_notice(self.e,self.b))
 def test_late_start_catches_up_without_ordinary_or_disabled_rules(self):
  self.now+=50*60;self.assertIn('10 分钟',sleep_notice(self.e,self.b)['body']);self.b['enabled']=False;self.assertIsNone(sleep_notice(self.e,self.b));self.b['enabled']=True;self.b['device']='none';self.assertIsNone(sleep_notice(self.e,self.b))
 def test_other_user_and_already_started_do_not_notify(self):
  self.now+=45*60;self.b['users']=['other'];self.assertIsNone(sleep_notice(self.e,self.b));self.b['users']=[];self.now+=15*60;self.assertIsNone(sleep_notice(self.e,self.b))
if __name__=='__main__':unittest.main()
