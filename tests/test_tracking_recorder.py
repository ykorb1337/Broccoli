import copy
import tempfile
import unittest
from hotturkey.store import Store
from hotturkey.tracking import TrackingStore,day_bounds
from hotturkey.tracking_recorder import TrackingRecorder

class RecorderTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(self.temp.name);self.tracking=TrackingStore(self.store);self.now=day_bounds('2026-10-28')[0]+9*3600;self.mono=100
        self.recorder=TrackingRecorder(self.tracking,lambda:self.now,lambda:self.mono)
    def tearDown(self):self.tracking.close();self.store.db.close();self.temp.cleanup()
    def sample(self,delta=1,**kw):
        self.now+=delta;self.mono+=delta
        return self.recorder.record({'front':{'application':'Editor','bundle':'local.editor','path':'/Applications/Editor.app','title':'Project draft','document':'file:///project/draft.txt'},'apps':[],'idle':0,'permissions':{'screen_recording':False,'accessibility':False},**kw})
    def rows(self,timeline):return self.tracking.activities(self.now-86400,self.now+1,timeline)
    def test_first_sample_does_not_invent_prior_time(self):
        self.sample();self.assertEqual(self.rows('computer'),[])
    def test_foreground_and_document_intervals_merge(self):
        self.sample();self.sample();self.sample()
        self.assertEqual(len(self.rows('applications')),1);self.assertEqual(self.rows('applications')[0]['seconds'],2)
        self.assertEqual(self.rows('documents')[0]['document'],'file:///project/draft.txt')
    def test_other_running_apps_are_never_counted(self):
        self.sample(apps=[{'application':'Unused'}]);self.sample(apps=[{'application':'Unused'}])
        self.assertEqual([r['group_name'] for r in self.rows('applications')],['Editor'])
    def test_sampler_stall_is_not_counted_as_work(self):
        self.sample();self.sample(delta=120)
        self.assertEqual(self.rows('computer'),[])
        self.sample();self.assertEqual(self.rows('computer')[0]['seconds'],1)
    def test_wall_clock_jump_does_not_create_extra_hours(self):
        self.sample();self.now+=3600;self.sample()
        self.assertEqual(self.rows('computer')[0]['seconds'],1)
    def test_disabled_tracking_produces_no_legacy_or_new_records(self):
        self.tracking.configure({'enabled':False});self.sample();self.sample()
        self.assertFalse(self.recorder.allowed({'application':'Editor'}));self.assertEqual(self.rows('applications'),[])
    def test_paused_time_is_not_bridged_on_resume(self):
        self.sample();self.tracking.configure({'paused_until':self.now+60});self.sample();self.now+=60;self.mono+=60;self.sample();self.sample()
        self.assertEqual(sum(r['seconds'] for r in self.rows('computer')),1)
    def test_title_recording_can_be_disabled_independently(self):
        self.tracking.configure({'titles':False});self.sample();self.sample()
        self.assertEqual(self.rows('applications')[0]['title'],'Editor');self.assertEqual(self.rows('documents'),[])
    def test_locked_and_away_states_do_not_count_apps(self):
        for value in [{'locked':True},{'idle':500}]:
            self.sample(**value);self.sample(**value)
        self.assertEqual(self.rows('applications'),[]);self.assertEqual({r['group_name'] for r in self.rows('computer')},{'Locked','Away'})
    def test_browser_document_uses_foreground_fresh_tab_only(self):
        self.recorder.browser_sample('Edge',{'active':True,'url':'https://docs.invalid/page','title':'Web document','idle':0})
        front={'application':'Edge','bundle':'com.microsoft.edgemac','title':'','path':'','document':''}
        self.sample(front=front);self.sample(front=front)
        self.assertEqual(self.rows('documents')[0]['url'],'https://docs.invalid/page');self.assertEqual(self.rows('documents')[0]['title'],'Web document')
    def test_edge_application_and_url_share_one_continuous_period(self):
        front={'application':'Microsoft Edge','bundle':'com.microsoft.edgemac','title':'','path':'/Applications/Microsoft Edge.app','document':''}
        for _ in range(61):
            self.recorder.browser_sample('Edge',{'active':True,'url':'https://docs.invalid/full/path?chapter=2','title':'Course notes','idle':0})
            self.sample(front=front)
        apps,docs=self.rows('applications'),self.rows('documents')
        self.assertEqual(len(apps),1);self.assertEqual(len(docs),1);self.assertEqual(apps[0]['seconds'],60)
        self.assertEqual(apps[0]['application'],'Microsoft Edge');self.assertEqual(apps[0]['title'],'Course notes')
        self.assertEqual(docs[0]['bundle'],apps[0]['bundle']);self.assertEqual(docs[0]['start'],apps[0]['start']);self.assertEqual(docs[0]['end'],apps[0]['end'])
    def test_inactive_or_stale_browser_tab_is_not_attributed(self):
        self.recorder.browser_sample('Edge',{'active':False,'url':'https://private.invalid','idle':0})
        front={'application':'Edge','bundle':'com.microsoft.edgemac'}
        self.sample(front=front);self.sample(front=front);self.assertEqual(self.rows('documents'),[])
        self.recorder.browser_sample('Edge',{'active':True,'url':'https://old.invalid','idle':0});self.sample(delta=10,front=front);self.sample(front=front);self.assertEqual(self.rows('documents'),[])
    def test_screenshot_command_off_by_default_and_while_locked(self):
        self.sample();self.assertFalse(self.sample()['capture'])
        self.tracking.configure({'screenshots_enabled':True});self.recorder.last_capture=0
        self.assertFalse(self.sample()['capture']);self.assertTrue(self.sample()['capture']);self.assertFalse(self.sample()['capture'])
        self.recorder.last_capture=0;self.assertFalse(self.sample(locked=True)['capture'])
    def test_accounting_state_is_not_changed_by_tracker(self):
        before=copy.deepcopy(self.store.state);self.store.charge(self.now,'rule',19);self.sample();self.sample()
        self.assertEqual(self.store.state,before);self.assertEqual(self.store.used('rule',0),19)

if __name__=='__main__':unittest.main()
