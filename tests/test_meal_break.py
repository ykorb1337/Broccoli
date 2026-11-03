import copy
import datetime as dt
import tempfile
import threading
import unittest
from hotturkey.engine import Engine
from hotturkey.model import PolicyError,validate_break,validate_block
from hotturkey.store import Store

class Clock:
    def __init__(self):self.wall=dt.datetime(2026,11,2,12).timestamp();self.mono=1000
    def advance(self,seconds):self.wall+=seconds;self.mono+=seconds

class MealBreakTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(self.temp.name);self.clock=Clock();self.engine=self.make_engine()
    def tearDown(self):self.store.db.close();self.temp.cleanup()
    def make_engine(self):return Engine(self.store,lambda:self.clock.wall,lambda:self.clock.mono,user='alice')
    def block(self,**extra):
        value={'name':'Work','enabled':True,'websites':['example.com'],'break':{'type':'meal'},**extra}
        return self.engine.find(self.engine.save_block(value)['id'])
    def start(self,b):return self.engine.request_break(b['id'],{'id':b['id']})['break_status']
    def end(self,b):return self.engine.request_break(b['id'],{'id':b['id'],'finish':True})['break_status']
    def blocked(self,url='https://example.com'):return self.engine.evaluate(url)['blocked']
    def test_pause_is_scoped_to_one_rule_and_preserves_locks(self):
        first=self.block();second=self.block(name='Other',websites=['other.example'])
        self.engine.set_lock(first['id'],{'type':'timer','until':self.clock.wall+86400});before=copy.deepcopy(self.store.state['blocks'])
        result=self.start(first);self.assertTrue(result['allowed']);self.assertEqual(result['remaining'],1800);self.assertEqual(result['left'],1)
        self.assertFalse(self.blocked());self.assertTrue(self.blocked('https://other.example'));self.assertFalse(self.engine.break_state(second)['allowed']);self.assertTrue(self.engine.status(first)['locked']);self.assertEqual(self.engine.break_state(second)['used'],0)
        self.end(first);self.assertTrue(self.blocked());self.assertEqual(self.store.state['blocks'],before)
    def test_overlapping_rules_remain_independent(self):
        first=self.block();second=self.block(name='Second')
        self.start(first);self.assertTrue(self.blocked());self.start(second);self.assertFalse(self.blocked());self.end(first);self.assertTrue(self.blocked());self.assertTrue(self.engine.break_state(second)['allowed'])
    def test_repeated_start_is_idempotent_and_expiry_restores_rule(self):
        block=self.block();start=self.start(block);self.clock.advance(30);again=self.start(block)
        self.assertEqual(again['until'],start['until']);self.assertEqual(again['used'],1)
        self.clock.advance(1770);self.assertTrue(self.blocked());self.assertFalse(self.engine.break_state(block)['allowed'])
        self.start(block);self.end(block)
        with self.assertRaises(PolicyError):self.start(block)
        self.assertEqual(self.engine.break_state(block)['used'],2)
    def test_restart_preserves_deadline_and_consumed_rule_quota(self):
        block=self.block();start=self.start(block);self.clock.advance(120);self.store.db.close();self.store=Store(self.temp.name);self.engine=self.make_engine();block=self.engine.find(block['id'])
        self.assertEqual(self.engine.break_state(block)['until'],start['until']);self.assertEqual(self.engine.break_state(block)['used'],1)
        self.end(block);self.end(block);self.assertEqual(self.engine.break_state(block)['left'],1)
    def test_daily_refill_and_cross_midnight_rest(self):
        block=self.block();self.clock.advance(dt.datetime(2026,11,2,23,50).timestamp()-self.clock.wall)
        start=self.start(block);self.clock.advance(1200);next_day=self.engine.break_state(block)
        self.assertTrue(next_day['allowed']);self.assertEqual(next_day['used'],0);self.assertEqual(self.start(block)['until'],start['until'])
        self.end(block);self.assertEqual(self.start(block)['left'],1)
    def test_disabled_rule_does_not_consume_quota(self):
        block=self.block(enabled=False)
        with self.assertRaises(PolicyError):self.start(block)
        self.assertEqual(self.engine.break_state(block)['used'],0)
    def test_other_break_modes_and_allowances_are_not_paused(self):
        meal=self.block(websites=['meal.example']);normal=self.block(name='Allowance',**{'break':{'type':'allowance','allowance_minutes':1}})
        self.start(meal);self.engine.usage({'url':'https://example.com'},'fixture')
        for _ in range(3):self.clock.advance(10);self.engine.usage({'url':'https://example.com'},'fixture')
        self.assertEqual(self.store.used(normal['id'],0),30);self.assertEqual(self.engine.break_state(normal)['type'],'allowance')
        self.assertNotIn('meal_break',self.engine.snapshot());self.assertNotIn('__meal_break__',self.store.state['runtime'])
    def test_settings_live_in_rule_and_cannot_change_while_locked(self):
        block=self.block();self.engine.set_lock(block['id'],{'type':'timer','until':self.clock.wall+3600});before=copy.deepcopy(block)
        with self.assertRaises(PolicyError):self.engine.save_block({**block,'break':{'type':'meal','meal_daily_limit':6}},block['id'])
        self.assertEqual(block,before);self.assertEqual(validate_break({'type':'meal'})['break_minutes'],30)
        for extra in [{'meal_daily_limit':0},{'meal_daily_limit':7},{'meal_daily_limit':True},{'break_minutes':0},{'break_minutes':181}]:
            with self.assertRaises(PolicyError):validate_break({'type':'meal',**extra})
        self.assertFalse(any(k.startswith('meal_break_') for k in self.store.state['settings']))
    def test_device_rules_cannot_use_meal_break(self):
        for device in ['sleep','lock','logout','shutdown']:
            with self.assertRaises(PolicyError):validate_block({'name':'Device','device':device,'break':{'type':'meal'}})
        with self.assertRaises(PolicyError):validate_block({'name':'Device','device':'sleep','mode':'scheduled','schedule':[{'days':[0],'start':540,'end':600,'break':{'type':'meal'}}]})
    def test_concurrent_requests_consume_one_use_for_the_rule(self):
        block=self.block();results=[];errors=[]
        def start():
            try:results.append(self.start(block))
            except Exception as error:errors.append(error)
        threads=[threading.Thread(target=start) for _ in range(12)]
        for thread in threads:thread.start()
        for thread in threads:thread.join()
        self.assertEqual(errors,[]);self.assertEqual(len(results),12);self.assertEqual({r['used'] for r in results},{1});self.assertEqual(len({r['until'] for r in results}),1)
    def test_backwards_date_does_not_refill_quota(self):
        block=self.block();self.start(block);self.end(block);self.clock.wall-=86400;self.engine=self.make_engine();self.assertEqual(self.engine.break_state(block)['used'],1);self.assertFalse(self.engine.break_state(block)['allowed'])
    def test_schedule_override_ends_at_its_window_and_shares_daily_rule_count(self):
        self.clock.advance(dt.datetime(2026,11,2,9).timestamp()-self.clock.wall)
        block=self.block(mode='scheduled',**{'break':{'type':'none'},'schedule':[{'days':[0],'start':540,'end':550,'break':{'type':'meal','meal_daily_limit':1}},{'days':[0],'start':550,'end':600},{'days':[0],'start':600,'end':660,'break':{'type':'meal','meal_daily_limit':1}}]})
        self.start(block);self.clock.advance(600);self.assertTrue(self.blocked());self.assertEqual(self.engine.break_state(block)['type'],'none');self.clock.advance(3000)
        self.assertEqual(self.engine.break_state(block)['left'],0)
        with self.assertRaises(PolicyError):self.start(block)
    def test_rule_quota_survives_disable_enable(self):
        block=self.block();self.start(block);self.end(block);self.engine.toggle(block['id'],False);self.engine.toggle(block['id'],True);self.assertEqual(self.engine.break_state(block)['used'],1)
    def test_payload_cannot_set_time_or_quota(self):
        block=self.block()
        for data in [{'minutes':999},{'until':1e20},{'finish':'yes'}]:
            with self.assertRaises(PolicyError):self.engine.request_break(block['id'],{'id':block['id'],**data})
        self.assertEqual(self.engine.break_state(block)['used'],0)
