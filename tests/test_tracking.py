import copy
import datetime as dt
import json
import os
import tempfile
import time
import unittest
from hotturkey.model import PolicyError
from hotturkey.store import Store
from hotturkey.tracking import TrackingStore,day_bounds,intervals,seconds,intersect,filter_match

class TrackingTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(self.temp.name);self.t=TrackingStore(self.store)
        self.start,self.end=day_bounds('2026-10-28')
    def tearDown(self):self.t.close();self.store.db.close();self.temp.cleanup()
    def activity(self,a,b,**kw):return self.t.add_activity({'timeline':'applications','start':self.start+a,'end':self.start+b,'title':'Draft','group_name':'Editor','application':'Editor',**kw})
    def test_interval_union_intersection_and_touching_edges(self):
        self.assertEqual(intervals([[1,4],[3,7],[7,8],[10,12],[4,4]]),[[1,8],[10,12]])
        self.assertEqual(seconds([[1,7],[3,8]]),7)
        self.assertEqual(intersect([[0,5],[5,10]],[[3,4],[8,12]]),[[3,4],[8,10]])
    def test_day_crops_spanning_activities(self):
        self.activity(-60,60);self.activity(120,180)
        rows=self.t.activities(self.start,self.start+150)
        self.assertEqual([r['seconds'] for r in rows],[60,30]);self.assertEqual(rows[0]['original_start'],self.start-60)
    def test_activity_merge_only_same_metadata_and_contiguous(self):
        a=self.activity(0,60);b=self.t.add_activity({'timeline':'applications','start':self.start+60,'end':self.start+120,'title':'Draft','group_name':'Editor','application':'Editor'},merge=True)
        self.assertEqual(a,b);self.assertEqual(len(self.t.activities(self.start,self.end)),1)
        self.activity(120,180,title='Another');self.assertEqual(len(self.t.activities(self.start,self.end)),2)
    def test_invalid_timestamps_and_timeline_are_rejected(self):
        for a,b in [(0,0),(20,10),(float('nan'),20),(0,float('inf'))]:
            with self.assertRaises(PolicyError):self.t.add_activity({'timeline':'applications','start':a,'end':b})
        with self.assertRaises(PolicyError):self.t.add_activity({'timeline':'invented','start':1,'end':2})
    def test_summary_deduplicates_overlaps_and_crops_selection(self):
        self.activity(0,120);self.activity(60,180)
        day=self.t.day('2026-10-28',selection=[[self.start+90,self.start+150]])
        self.assertEqual(day['summary'][0]['seconds'],180);self.assertEqual(day['summary'][0]['selected_seconds'],60)
    def test_tags_union_ranges_without_duplicate_time(self):
        self.t.save_tag({'ranges':[[self.start,self.start+120],[self.start+60,self.start+180]],'tags':'Client, Project','billable':True,'notes':'hello'})
        tags=self.t.tags(self.start,self.end);self.assertEqual(len(tags),1);self.assertEqual(tags[0]['seconds'],180);self.assertTrue(tags[0]['billable'])
    def test_tag_coverage_intersection_avoids_double_counting(self):
        self.activity(0,300)
        for a,b in [(0,100),(50,150)]:self.t.save_tag({'start':self.start+a,'end':self.start+b,'tags':['Project']})
        self.assertEqual(self.t.day('2026-10-28')['details'][0]['tagged_seconds'],150)
    def test_delete_middle_splits_activities_and_tags(self):
        self.activity(0,300);self.t.save_tag({'start':self.start,'end':self.start+300,'tags':['Project']})
        self.t.delete_range(self.start+60,self.start+120)
        self.assertEqual([(r['start']-self.start,r['end']-self.start) for r in self.t.activities(self.start,self.end)],[(0,60),(120,300)])
        self.assertEqual(sum(t['seconds'] for t in self.t.tags(self.start,self.end)),240)
    def test_tracking_mutations_preserve_policy_and_spent_allowance(self):
        before=copy.deepcopy(self.store.state);self.store.charge(self.start,'fixture-block',27)
        self.activity(0,120);self.t.configure({'enabled':False,'screenshots_enabled':True})
        self.t.delete_range(self.start,self.end)
        self.assertEqual(self.store.state,before);self.assertEqual(self.store.used('fixture-block',0),27)
    def test_paused_and_disabled_tracking(self):
        self.t.configure({'paused_until':self.start+120})
        self.assertFalse(self.t.recording_allowed(self.start+60));self.assertTrue(self.t.recording_allowed(self.start+121))
        self.t.configure({'enabled':False});self.assertFalse(self.t.recording_allowed(self.start+121))
    def test_schedule_crosses_midnight(self):
        weekday=dt.date(2026,10,28).weekday();self.t.configure({'schedule':[{'days':[weekday],'start':1380,'end':60}]})
        self.assertFalse(self.t.recording_allowed(self.start+22*3600));self.assertTrue(self.t.recording_allowed(self.start+23.5*3600));self.assertTrue(self.t.recording_allowed(self.end+1800));self.assertFalse(self.t.recording_allowed(self.end+3600))
    def test_exact_quoted_and_substring_exclusions(self):
        self.t.configure({'applications':['"Editor"']})
        self.assertFalse(self.t.recording_allowed(self.start,application='Editor'));self.assertTrue(self.t.recording_allowed(self.start,application='Editor Pro'))
        self.t.configure({'applications':['Editor']});self.assertFalse(self.t.recording_allowed(self.start,application='Editor Pro'))
    def test_screenshots_are_off_by_default_and_have_independent_exclusions(self):
        self.assertFalse(self.t.recording_allowed(self.start,application='Editor',screenshots=True))
        self.t.configure({'screenshots_enabled':True,'screenshot_applications':['Private']})
        self.assertFalse(self.t.recording_allowed(self.start,application='Private app',screenshots=True));self.assertTrue(self.t.recording_allowed(self.start,application='Private app'))
    def test_settings_are_strict_and_failed_updates_atomic(self):
        for value in [{'idle_seconds':True},{'screenshots_enabled':'yes'},{'screenshot_interval':0},{'schedule':[{'days':[8],'start':1,'end':2}]},{'unknown':True}]:
            old=self.t.settings()
            with self.assertRaises(PolicyError):self.t.configure(value)
            self.assertEqual(self.t.settings(),old)
    def test_day_filter_applies_to_details_and_summary(self):
        self.activity(0,60,title='Private note');self.activity(60,120,title='Public note')
        result=self.t.day('2026-10-28',query='app:Editor -title:Private')
        self.assertEqual(len(result['details']),1);self.assertEqual(result['summary'][0]['seconds'],60)
    def test_group_color_persists_and_does_not_change_other_group(self):
        self.t.save_entity('colors',{'timeline':'applications','group':'Editor','color':'#123456'})
        self.assertEqual(self.t.group_color('applications','Editor'),'#123456');self.assertNotEqual(self.t.group_color('applications','Other'),'#123456')
    def test_missing_tag_and_malformed_tag_do_not_delete_existing(self):
        self.t.save_tag({'start':self.start,'end':self.start+60,'tags':['Project']})
        for data in [{'start':self.start,'end':self.start+60,'tags':[]},{'start':self.start,'end':self.start+60,'tags':['a,b']}]:
            with self.assertRaises(PolicyError):self.t.save_tag(data)
        self.assertEqual(len(self.t.tags(self.start,self.end)),1)
    @unittest.skipUnless(hasattr(time,'tzset'),'requires POSIX timezones')
    def test_local_days_respect_dst(self):
        old=os.environ.get('TZ');os.environ['TZ']='America/New_York';time.tzset()
        try:
            a,b=day_bounds('2026-03-08');self.assertEqual(b-a,23*3600)
            a,b=day_bounds('2026-11-01');self.assertEqual(b-a,25*3600)
        finally:
            if old is None:os.environ.pop('TZ',None)
            else:os.environ['TZ']=old
            time.tzset()
    def test_reopen_keeps_tracking_records(self):
        self.activity(0,60);self.t.save_tag({'start':self.start,'end':self.start+60,'tags':['Saved']})
        other=Store(self.temp.name)
        try:self.assertEqual(len(TrackingStore(other).day('2026-10-28')['details']),1)
        finally:other.db.close()

if __name__=='__main__':unittest.main()
