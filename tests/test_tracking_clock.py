import copy
import json
import tempfile
import unittest
from unittest.mock import patch
from hotturkey.model import PolicyError
from hotturkey.store import Store
from hotturkey.tracking import TrackingStore,day_bounds
from hotturkey.tracking_tags import identity


class TagClockTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(self.temp.name);self.t=TrackingStore(self.store)
        self.day,self.until=day_bounds('2026-10-29');self.start=self.day+9*3600;self.now=self.start;self.c=self.t.clock;self.c.clock=lambda:self.now
    def tearDown(self):self.t.close();self.store.db.close();self.temp.cleanup()
    def begin(self,**value):return self.c.start({'tags':['Work'],'notes':'Kept notes','billable':True,**value})
    def advance(self,seconds):self.now+=seconds;return self.c.tick()
    def records(self):return self.t.tags(self.day,self.until)
    def intervals(self):return [(r['start']-self.start,r['end']-self.start) for r in self.records()]
    def test_stopwatch_start_checkpoint_stop_writes_one_exact_tag(self):
        state=self.begin();self.assertEqual(self.records(),[]);self.advance(10);self.advance(15)
        result=self.c.command('stop',state['id']);self.assertEqual(result['status'],'stopped');self.assertEqual(result['elapsed'],25)
        rows=self.records();self.assertEqual(len(rows),1);self.assertEqual(rows[0]['seconds'],25);self.assertEqual(rows[0]['notes'],'Kept notes');self.assertTrue(rows[0]['billable']);self.assertEqual(rows[0]['source'],'clock')
    def test_pause_resume_preserves_gap_and_total(self):
        state=self.begin();self.advance(10);self.c.command('pause',state['id']);self.advance(300)
        self.assertEqual(self.c.status()['elapsed'],10);self.c.command('resume',state['id']);self.advance(20);self.c.command('stop',state['id'])
        self.assertEqual(self.intervals(),[(0,10),(310,330)]);self.assertEqual(self.c.status()['elapsed'],30)
    def test_countdown_late_tick_clips_to_deadline(self):
        self.begin(kind='countdown',duration_seconds=30);result=self.advance(200)
        self.assertEqual(result['status'],'finished');self.assertEqual(result['elapsed'],30);self.assertEqual(result['remaining'],0);self.assertEqual(self.intervals(),[(0,30)])
        self.assertEqual(result['events'][0]['at'],self.start+30);self.assertEqual(result['events'][0]['kind'],'timer_finished')
    def test_paused_countdown_uses_remaining_duration_on_resume(self):
        state=self.begin(kind='countdown',duration_seconds=30);self.advance(10);self.c.command('pause',state['id']);self.advance(100)
        result=self.c.command('resume',state['id']);self.assertEqual(result['deadline'],self.now+20);self.advance(90)
        self.assertEqual(self.intervals(),[(0,10),(110,130)]);self.assertEqual(self.c.status()['elapsed'],30)
    def test_pomodoro_waits_at_phase_boundary_without_backfilling_wait(self):
        state=self.begin(kind='pomodoro',work_seconds=5,break_seconds=3);result=self.advance(100)
        self.assertEqual(result['status'],'awaiting');self.assertEqual(result['phase'],'work');self.assertEqual(result['cycles'],1);self.assertEqual(self.intervals(),[(0,5)])
        self.c.command('next-phase',state['id'],{'tags':['Break'],'billable':False});self.advance(20)
        self.assertEqual(self.intervals(),[(0,5),(100,103)]);self.assertEqual(self.records()[1]['tags'],['Break'])
    def test_untagged_break_then_next_work_has_no_break_record(self):
        state=self.begin(kind='pomodoro',work_seconds=5,break_seconds=3);self.advance(5)
        self.c.command('next-phase',state['id'],{'untagged':True});self.advance(3)
        self.assertEqual(len(self.records()),1);self.c.command('next-phase',state['id']);result=self.advance(5)
        self.assertEqual(self.intervals(),[(0,5),(8,13)]);self.assertEqual(result['elapsed'],13);self.assertEqual(result['cycles'],2)
    def test_skip_break_starts_an_entire_new_work_interval(self):
        state=self.begin(kind='pomodoro',work_seconds=5,break_seconds=3);self.advance(5);self.now+=10
        result=self.c.command('skip-break',state['id']);self.assertEqual(result['remaining'],5);self.advance(5)
        self.assertEqual(self.intervals(),[(0,5),(15,20)]);self.assertEqual(self.c.status()['cycles'],2)
    def test_new_work_phase_can_change_task_notes_and_billable(self):
        state=self.begin(kind='pomodoro',work_seconds=5,break_seconds=3);self.advance(5);self.c.command('next-phase',state['id']);self.advance(3)
        result=self.c.command('next-phase',state['id'],{'tags':['New task'],'notes':'New notes','billable':False});self.advance(2)
        self.assertEqual(result['template']['tags'],['New task']);self.assertEqual(self.records()[-1]['notes'],'New notes');self.assertFalse(self.records()[-1]['billable'])
    def test_phase_validation_does_not_change_state(self):
        state=self.begin(kind='pomodoro',work_seconds=5,break_seconds=3)
        for action,value in [('next-phase',{}),('skip-break',{})]:
            with self.assertRaises(PolicyError):self.c.command(action,state['id'],value)
        self.advance(5);before=self.c.status()
        with self.assertRaises(PolicyError):self.c.command('next-phase',state['id'],{'tags':[]})
        self.assertEqual(self.c.status(),before)
    def test_reminder_is_emitted_once_until_acknowledged(self):
        state=self.begin(remind_seconds=60);result=self.advance(60);self.assertTrue(result['reminder_pending']);self.advance(100)
        self.assertEqual(len(self.c.status()['events']),1);self.c.command('ack-reminder',state['id']);self.assertFalse(self.c.status()['reminder_pending'])
        self.advance(60);self.assertEqual(len(self.c.status()['events']),1);self.assertEqual(self.c.status()['elapsed'],220)
    def test_notice_delivery_is_once_and_does_not_include_tag_text(self):
        self.begin(kind='countdown',duration_seconds=1,tags=['Private task']);self.advance(1)
        first=self.c.take_notices();self.assertEqual(len(first),1);self.assertNotIn('Private task',first[0]);self.assertEqual(self.c.take_notices(),[])
    def test_stop_clears_pending_notices(self):
        state=self.begin(remind_seconds=60);self.advance(60);self.c.command('stop',state['id']);self.assertEqual(self.c.take_notices(),[])
    def test_pause_clears_old_reminder_and_resume_starts_a_new_interval(self):
        state=self.begin(remind_seconds=60);self.advance(60);self.c.command('pause',state['id'])
        self.assertFalse(self.c.status()['reminder_pending']);self.assertEqual(self.c.take_notices(),[])
        self.advance(100);self.c.command('resume',state['id']);self.advance(59);self.assertFalse(self.c.status()['reminder_pending']);self.advance(1);self.assertTrue(self.c.status()['reminder_pending'])
    def test_service_restart_continues_manual_wall_clock_without_duplicate_rows(self):
        self.begin();self.advance(10);self.t.close();self.now+=90;self.t=TrackingStore(self.store);self.c=self.t.clock;self.c.clock=lambda:self.now
        result=self.c.tick();self.assertEqual(result['elapsed'],100);self.assertEqual(self.intervals(),[(0,100)])
    def test_restart_after_countdown_deadline_still_saves_exact_duration(self):
        self.begin(kind='countdown',duration_seconds=30);self.advance(10);self.t.close();self.now+=200;self.t=TrackingStore(self.store);self.c=self.t.clock;self.c.clock=lambda:self.now
        self.assertEqual(self.c.tick()['status'],'finished');self.assertEqual(self.intervals(),[(0,30)])
    def test_start_last_uses_last_tag_but_not_old_start_boundary(self):
        state=self.begin(tags=['Client','Design'],from_last=True);self.advance(10);self.c.command('stop',state['id']);self.now+=200
        result=self.c.start(use_last=True);self.assertEqual(result['tags'],['Client','Design']);self.assertFalse(result['template']['from_last']);self.advance(10)
        self.assertEqual(self.intervals(),[(0,10),(210,220)])
    def test_start_at_last_tag_end_is_limited_to_today(self):
        self.t.save_tag({'tags':['Earlier'],'start':self.start-100,'end':self.start-50});self.begin(from_last=True);self.advance(10)
        self.assertEqual(self.intervals(),[(-100,-50),(-50,10)])
    def test_no_previous_tag_starts_at_now(self):
        state=self.begin(from_last=True);self.assertEqual(state['elapsed'],0);self.advance(10);self.assertEqual(self.intervals(),[(0,10)])
    def test_idle_stop_backdates_provisional_time_to_last_interaction(self):
        self.begin(stop_on_idle=True);self.advance(100);self.c.observe('Away',self.now,80)
        result=self.c.status();self.assertEqual(result['reason'],'idle');self.assertEqual(result['elapsed'],20);self.assertEqual(self.intervals(),[(0,20)])
    def test_idle_stop_at_start_does_not_insert_a_zero_length_tag(self):
        self.begin(stop_on_idle=True);self.now+=200;self.c.observe('Away',self.now,300)
        self.assertEqual(self.c.status()['elapsed'],0);self.assertEqual(self.records(),[])
    def test_idle_detection_can_correct_a_just_finished_countdown(self):
        self.begin(kind='countdown',duration_seconds=100,stop_on_idle=True);self.advance(110);self.c.observe('Away',self.now,80)
        self.assertEqual(self.intervals(),[(0,30)]);self.assertEqual(self.c.status()['status'],'stopped');self.assertEqual(self.c.status()['cycles'],0)
        self.assertEqual(len(self.c.take_notices()),1)
    def test_idle_after_finished_timer_does_not_erase_valid_completion(self):
        self.begin(kind='countdown',duration_seconds=10,stop_on_idle=True);self.advance(100);self.c.observe('Away',self.now,30)
        self.assertEqual(self.c.status()['status'],'finished');self.assertEqual(self.intervals(),[(0,10)])
    def test_locked_or_sleep_observation_stops_at_observation_time(self):
        for activity in ['Locked','Sleep']:
            state=self.begin(stop_on_idle=True);self.advance(10);self.now+=5;self.c.observe(activity,self.now)
            self.assertEqual(self.c.status()['status'],'stopped');self.assertEqual(self.c.status()['elapsed'],15)
            self.now+=10
    def test_queued_sleep_sample_after_wake_uses_native_event_time(self):
        from hotturkey.tracking_recorder import TrackingRecorder
        self.begin(stop_on_idle=True);self.advance(100)
        recorder=TrackingRecorder(self.t,clock=lambda:self.now,monotonic=lambda:100)
        recorder.record({'front':{},'idle':0,'sleeping':True,'at':self.start+20})
        self.assertEqual(self.c.status()['elapsed'],20);self.assertEqual(self.intervals(),[(0,20)])
    def test_sleep_event_before_this_clock_started_does_not_stop_new_task(self):
        self.begin(stop_on_idle=True);self.c.observe('Sleep',self.start-20)
        self.assertEqual(self.c.status()['status'],'running')
    def test_idle_option_off_keeps_manual_timer_running(self):
        self.begin();self.advance(20);self.c.observe('Away',self.now,15);self.advance(10);self.assertEqual(self.c.status()['status'],'running');self.assertEqual(self.intervals(),[(0,30)])
    def test_deleting_recorded_time_is_not_undone_by_clock_checkpoint(self):
        self.begin();self.advance(20);self.t.delete_range(self.start+5,self.start+10,['tags']);self.advance(20);self.advance(10)
        self.assertEqual(self.intervals(),[(0,5),(10,20),(40,50)])
    def test_deleting_current_tag_row_never_resurrects_its_old_interval(self):
        self.begin();self.advance(20);self.t.delete_tags([self.records()[0]['id']]);self.advance(10);self.advance(5)
        self.assertEqual(self.intervals(),[(30,35)])
    def test_manual_edit_of_current_row_is_preserved(self):
        self.begin();self.advance(20);row=self.records()[0]
        self.t.save_tag({'tags':['Edited'],'notes':'Manual change','start':self.start,'end':self.start+10},row['id']);self.advance(10);self.advance(5)
        rows=self.records();self.assertEqual(rows[0]['tags'],['Edited']);self.assertEqual(rows[0]['notes'],'Manual change');self.assertEqual(self.intervals(),[(0,10),(30,35)])
    def test_global_tag_rename_updates_running_and_last_template(self):
        self.begin();self.advance(10);self.t.tag_library.change(identity('tag',['Work']),['Renamed']);self.advance(10)
        result=self.c.status();self.assertEqual(result['tags'],['Renamed']);self.assertEqual(result['last_template']['tags'],['Renamed']);self.assertEqual(self.records()[0]['tags'],['Renamed']);self.assertEqual(self.intervals(),[(0,20)])
    def test_deleting_active_task_stops_clock_and_clears_last_template(self):
        self.begin();self.advance(10);self.t.tag_library.change(identity('tag',['Work']),delete=True);self.advance(10)
        self.assertEqual(self.c.status()['reason'],'tag_deleted');self.assertEqual(self.records(),[])
        with self.assertRaises(PolicyError):self.c.start(use_last=True)
    def test_failed_historical_rename_rolls_back_running_clock_state(self):
        self.begin();self.advance(10);before=self.c.status()
        with patch.object(self.t.tag_library,'_rebuild',side_effect=RuntimeError('isolated failure')):
            with self.assertRaises(RuntimeError):self.t.tag_library.change(identity('tag',['Work']),['After'])
        self.assertEqual(self.c.status(),before);self.assertEqual(self.records()[0]['tags'],['Work'])
    def test_stale_commands_cannot_stop_another_clock(self):
        first=self.begin();self.c.command('stop',first['id']);second=self.begin(tags=['Second'])
        with self.assertRaises(PolicyError):self.c.command('stop',first['id'])
        self.assertEqual(self.c.status()['id'],second['id']);self.assertEqual(self.c.status()['status'],'running')
    def test_only_one_clock_can_be_active(self):
        self.begin()
        with self.assertRaises(PolicyError):self.begin(tags=['Other'])
        self.assertEqual(self.c.status()['tags'],['Work'])
    def test_backwards_system_time_stops_without_rewriting_saved_time(self):
        self.begin();self.advance(10);self.now-=30;result=self.c.tick()
        self.assertEqual(result['status'],'stopped');self.assertEqual(result['reason'],'clock_changed');self.assertEqual(self.intervals(),[(0,10)])
    def test_cross_midnight_tags_remain_correct_in_each_day(self):
        self.now=self.until-10;self.begin();self.advance(20)
        self.assertEqual(self.t.tags(self.day,self.until)[0]['seconds'],10);self.assertEqual(self.t.tags(self.until,self.until+86400)[0]['seconds'],10)
    def test_clock_does_not_change_policy_configuration_or_allowance(self):
        before=copy.deepcopy(self.store.state);settings=self.t.settings();self.store.charge(self.start,'rule',42)
        state=self.begin(kind='pomodoro',work_seconds=5,break_seconds=3);self.advance(5);self.c.command('skip-break',state['id']);self.advance(5);self.c.command('stop',state['id'])
        self.assertEqual(self.store.state,before);self.assertEqual(self.t.settings(),settings);self.assertEqual(self.store.used('rule',0),42)
    def test_invalid_configuration_and_actions_are_client_errors(self):
        for value in [{'tags':[]},{'tags':['A'],'kind':[]},{'tags':['A'],'kind':'bad'},{'tags':['A'],'work_seconds':True},{'tags':['A'],'duration_seconds':0},{'tags':['A'],'remind_seconds':1},{'tags':['A'],'billable':1},{'tags':['A'],'unknown':True}]:
            with self.assertRaises(PolicyError):self.c.start(value)
        with self.assertRaises(PolicyError):self.c.start(use_last=True)
        with self.assertRaises(PolicyError):self.c.command('stop',None)
        state=self.begin()
        with self.assertRaises(PolicyError):self.c.command('bad',state['id'])

if __name__=='__main__':unittest.main()
