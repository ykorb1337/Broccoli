import datetime as dt
import os
from pathlib import Path
import tempfile
import time
import unittest

from hotturkey.engine import Engine
from hotturkey.model import PolicyError
from hotturkey.server import Service
from hotturkey.store import Store
from hotturkey.tracking import TrackingStore,day_bounds
from hotturkey.tracking_recorder import TrackingRecorder


class TrackingBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(self.temp.name);self.t=TrackingStore(self.store)
        self.start,self.end=day_bounds('2026-10-28')
    def tearDown(self):self.t.close();self.store.db.close();self.temp.cleanup()
    def schedule(self,rows):self.t.configure({'schedule':rows})
    def test_empty_enabled_schedule_records_nothing(self):
        self.t.configure({'schedule_enabled':True})
        self.assertFalse(self.t.recording_allowed(self.start));self.assertEqual(self.t.recording_ranges(self.start,self.end),[])
    def test_disabling_schedule_keeps_its_windows(self):
        row={'days':[2],'start':540,'end':600};self.schedule([row])
        self.t.configure({'schedule_enabled':False})
        self.assertEqual(self.t.settings()['schedule'],[row]);self.assertTrue(self.t.recording_allowed(self.start))
    def test_multi_day_range_does_not_bridge_untracked_hours(self):
        self.schedule([{'days':[2,3],'start':540,'end':600}])
        result=self.t.recording_ranges(self.start+9.5*3600,self.end+9.5*3600)
        self.assertEqual(result,[[self.start+9.5*3600,self.start+10*3600],[self.end+9*3600,self.end+9.5*3600]])
    def test_cross_midnight_and_overlapping_windows_are_unioned(self):
        self.schedule([{'days':[2],'start':1380,'end':60},{'days':[3],'start':30,'end':120}])
        self.assertEqual(self.t.recording_ranges(self.start,self.end+3*3600),[[self.start+23*3600,self.end+2*3600]])
    def test_pause_expiry_clips_sleep_range(self):
        self.t.configure({'paused_until':self.start+3600})
        self.assertEqual(self.t.recording_ranges(self.start,self.start+7200),[[self.start+3600,self.start+7200]])
    def test_filters_apply_to_whole_recorded_range(self):
        self.schedule([{'days':[2],'start':0,'end':1440}]);self.t.configure({'website_mode':'include','websites':['example.com']})
        self.assertEqual(self.t.recording_ranges(self.start,self.end,application='Editor'),[])
        self.assertEqual(self.t.recording_ranges(self.start,self.end,url='https://example.com/a'),[[self.start,self.end]])
    def test_start_at_24_is_invalid_and_update_is_atomic(self):
        before=self.t.settings()
        with self.assertRaises(PolicyError):self.schedule([{'days':[2],'start':1440,'end':60}])
        self.assertEqual(self.t.settings(),before)
    @unittest.skipUnless(hasattr(time,'tzset'),'POSIX timezones')
    def test_dst_schedule_uses_local_wall_hours(self):
        old=os.environ.get('TZ');os.environ['TZ']='America/New_York';time.tzset()
        try:
            self.schedule([{'days':[6],'start':60,'end':180}])
            for date,expected in [('2026-03-08',3600),('2026-11-01',10800)]:
                a,b=day_bounds(date);ranges=self.t.recording_ranges(a,b)
                self.assertEqual(sum(y-x for x,y in ranges),expected)
        finally:
            if old is None:os.environ.pop('TZ',None)
            else:os.environ['TZ']=old
            time.tzset()
    def test_native_sleep_gap_is_clipped_to_schedule(self):
        self.schedule([{'days':[2,3],'start':540,'end':600}])
        now=[self.start+9.5*3600];mono=[100]
        recorder=TrackingRecorder(self.t,lambda:now[0],lambda:mono[0]);sample={'front':{'application':'Editor'},'sleeping':True}
        recorder.record(sample);gap=86400;now[0]+=gap;mono[0]+=gap;recorder.record(sample)
        rows=self.t.activities(self.start,self.end+86400,'computer')
        self.assertEqual([(v['start'],v['end']) for v in rows],[(self.start+9.5*3600,self.start+10*3600),(self.end+9*3600,self.end+9.5*3600)])
    def test_sample_crossing_schedule_end_is_cropped(self):
        self.schedule([{'days':[2],'start':540,'end':600}])
        now=[self.start+10*3600-1];mono=[100]
        recorder=TrackingRecorder(self.t,lambda:now[0],lambda:mono[0]);sample={'front':{'application':'Editor'}}
        recorder.record(sample);now[0]+=2;mono[0]+=2;recorder.record(sample)
        self.assertEqual(self.t.activities(self.start,self.end,'applications')[0]['seconds'],1)
    def test_title_privacy_change_discards_previous_in_flight_frame(self):
        now=[self.start];mono=[100];r=TrackingRecorder(self.t,lambda:now[0],lambda:mono[0]);sample={'front':{'application':'Editor','title':'Private title'}}
        r.record(sample);self.t.configure({'titles':False});now[0]+=1;mono[0]+=1;r.record(sample)
        now[0]+=1;mono[0]+=1;r.record(sample)
        rows=self.t.activities(self.start,self.end,'applications');self.assertEqual([v['title'] for v in rows],['Editor']);self.assertEqual(rows[0]['seconds'],1)
    def test_filter_failure_preserves_allowance_accounting_and_blocking(self):
        now=[self.start];e=Engine(self.store,wall=lambda:now[0],monotonic=lambda:now[0])
        block=e.save_block({'name':'Quota','enabled':True,'websites':['example.com'],'break':{'type':'allowance','minutes':1}})
        e.statistics_filter=lambda data:1/0
        with self.assertLogs('hotturkey',level='ERROR'):
            e.usage({'url':'https://example.com','active':True},'fixture');now[0]+=5;e.usage({'url':'https://example.com','active':True},'fixture')
        self.assertEqual(self.store.used(block['id'],0),5)
        e.save_block({'name':'Block','enabled':True,'websites':['blocked.invalid']})
        self.assertTrue(e.evaluate('https://blocked.invalid')['blocked'])
        e.record_block('https://example.com',[block['id']])


class StatisticsFailureIsolationTests(unittest.TestCase):
    def test_corrupt_sidecar_preserves_policy_and_recovers_without_deleting_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'tracking.sqlite3';original=b'not a sqlite database';path.write_bytes(original)
            with self.assertLogs('hotturkey',level='ERROR'):service=Service(directory,enforce=False)
            try:
                self.assertIsNone(service.tracking);self.assertEqual(path.read_bytes(),original)
                block=service.engine.save_block({'name':'Still blocks','enabled':True,'websites':['example.com']})
                snapshot=service.api('/api/state','GET',{}, {},{})
                self.assertFalse(snapshot['tracking']['available']);self.assertTrue(snapshot['blocks'])
                self.assertTrue(service.engine.evaluate('https://example.com')['blocked'])
                with self.assertRaises(PolicyError):service.api('/api/tracking/day','GET',{}, {},{})
                path.rename(path.with_suffix('.damaged'))
                self.assertTrue(service.api('/api/tracking/retry','POST',{}, {},{})['ok'])
                self.assertEqual(service.tracking.day('2026-10-28')['details'],[])
                self.assertEqual(service.engine.find(block['id'])['name'],'Still blocks')
            finally:
                service.http.server_close()
                if service.tracking:service.tracking.close()
                service.store.db.close();service.singleton.close()

if __name__=='__main__':unittest.main()
