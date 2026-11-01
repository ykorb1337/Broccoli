import datetime as dt
import tempfile
import unittest
from hotturkey.store import Store
from hotturkey.tracking import TrackingStore,day_bounds
class ReportTests(unittest.TestCase):
 def setUp(self):self.temp=tempfile.TemporaryDirectory();self.store=Store(self.temp.name);self.t=TrackingStore(self.store);self.a,self.b=day_bounds('2026-10-28')
 def tearDown(self):self.t.close();self.store.db.close();self.temp.cleanup()
 def add(self,a,b,group='Editor',timeline='applications'):self.t.add_activity({'start':a,'end':b,'timeline':timeline,'title':group,'group_name':group})
 def test_top_union_does_not_double_count_same_group(self):
  self.add(self.a,self.a+120);self.add(self.a+60,self.a+180)
  result=self.t.report(self.a,self.b,group_by='none');self.assertEqual(result['series'][0]['total'],180);self.assertEqual(result['table'],[['总计',180]])
 def test_daily_report_splits_midnight(self):
  self.add(self.b-120,self.b+60)
  r=self.t.report(self.a,self.b+3600);self.assertEqual(r['buckets'],['2026-10-28','2026-10-29']);self.assertEqual(r['series'][0]['values'],[120,60])
 def test_weekly_buckets_use_mondays(self):
  self.add(self.a,self.a+60)
  self.assertEqual(self.t.report(self.a,self.b,group_by='week')['buckets'],['2026-10-26'])
 def test_untagged_uses_intersection_with_active_time(self):
  self.add(self.a+3600,self.a+7200,'Active','computer');self.t.save_tag({'start':self.a,'end':self.a+5400,'tags':['Work']})
  row=self.t.day_statistics(self.a,self.b)[0];self.assertEqual(row['active'],3600);self.assertEqual(row['tagged'],1800);self.assertEqual(row['untagged'],1800)
 def test_attendance_duration_is_first_to_last_not_active_sum(self):
  self.add(self.a+3600,self.a+3660,'Active','computer');self.add(self.a+10740,self.a+10800,'Active','computer')
  row=self.t.day_statistics(self.a,self.b)[0];self.assertEqual(row['duration'],7200);self.assertEqual(row['active'],120)
 def test_timesheet_combines_overlaps_and_rounds_per_day(self):
  for start,end in [(0,90),(60,180)]:self.t.save_tag({'start':self.a+start,'end':self.a+end,'tags':['Client','Project'],'billable':True})
  result=self.t.timesheet(self.a,self.b,depth=1,billable=True,round_minutes=5)
  self.assertEqual(result['rows'][0]['tag'],'Client');self.assertEqual(result['seconds'],180);self.assertEqual(result['rounded_seconds'],300)
 def test_legacy_import_is_idempotent_and_does_not_fabricate_urls(self):
  self.store.event(self.a+60,'fixture','website','example.invalid',seconds=30)
  self.assertEqual(self.t.import_legacy(),1);self.assertEqual(self.t.import_legacy(),0)
  row=self.t.activities(self.a,self.b)[0];self.assertEqual(row['source'],'legacy');self.assertEqual(row['url'],'');self.assertEqual(row['seconds'],30)
 def test_idle_backdating_preserves_manual_and_tag_data(self):
  self.add(self.a,self.a+300,'Active','computer');self.add(self.a,self.a+300)
  self.t.add_activity({'timeline':'applications','start':self.a+100,'end':self.a+120,'title':'Manual','group_name':'Manual','source':'manual'})
  self.t.save_tag({'start':self.a,'end':self.a+300,'tags':['Work']})
  self.t.mark_idle(self.a+60,self.a+300)
  comp=self.t.activities(self.a,self.b,'computer');self.assertEqual({v['group_name']:v['seconds'] for v in comp},{'Active':60,'Away':240})
  self.assertEqual(sum(v['seconds'] for v in self.t.activities(self.a,self.b,'applications')),80);self.assertEqual(self.t.tags(self.a,self.b)[0]['seconds'],300)
 def test_untagged_details_only_include_true_gaps(self):
  self.add(self.a,self.a+300);self.t.save_tag({'start':self.a+60,'end':self.a+180,'tags':['Work']})
  day=self.t.day('2026-10-28',untagged=True)
  self.assertEqual([(r['start']-self.a,r['end']-self.a) for r in day['details']],[(0,60),(180,300)])
  self.assertEqual(day['summary'][0]['seconds'],180)
 def test_statistics_have_their_own_database_and_lock(self):
  self.assertIsNot(self.t.db,self.store.db);self.assertIsNot(self.t.lock,self.store.lock)
  self.assertTrue((self.store.directory/'tracking.sqlite3').exists())
 def test_privacy_check_never_waits_for_statistics_write_lock(self):
  import threading
  from hotturkey.tracking_recorder import TrackingRecorder
  recorder=TrackingRecorder(self.t,lambda:self.a,lambda:1);done=threading.Event()
  with self.t.lock:
   thread=threading.Thread(target=lambda:(recorder.allowed({'application':'Editor'}),done.set()));thread.start()
   self.assertTrue(done.wait(1))
  thread.join()
if __name__=='__main__':unittest.main()
