"""Emergency UI wording is backed by current-window-only engine behavior."""
import copy
import tempfile
import unittest
from broccoli.engine import Engine
from broccoli.model import PolicyError
from broccoli.store import Store
from test_authority import Clock

class EmergencyScopeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(self.temp.name);self.clock=Clock()
        self.e=Engine(self.store,self.clock.wall,self.clock.monotonic,'fixture-boot','alice')
        self.e.configure_device_recovery('fixture-safety-word')
    def tearDown(self):self.store.db.close();self.temp.cleanup()
    def plan(self,**values):
        return self.e.save_block({'name':'Sleep','device':'sleep','enabled':True,'mode':'scheduled','confirm_device':True,'schedule':[{'days':list(range(7)),'start':540,'end':600}],**values})
    def test_cannot_release_future_sleep_before_its_window(self):
        block=self.plan(schedule=[{'days':list(range(7)),'start':600,'end':660}]);before=copy.deepcopy(self.store.state)
        with self.assertRaisesRegex(PolicyError,'当前没有生效'):self.e.recover_device('fixture-safety-word')
        self.assertEqual(self.store.state,before);self.clock.advance(3600);self.assertTrue(self.e.active(self.e.find(block['id'])))
    def test_release_applies_to_all_current_device_actions_and_no_future_plan(self):
        current=[self.plan(name=action,device=action) for action in ['sleep','lock','logout','shutdown']]
        future=self.plan(name='Later sleep',schedule=[{'days':list(range(7)),'start':600,'end':660}])
        result=self.e.recover_device('fixture-safety-word');self.assertEqual(result['count'],4)
        self.assertTrue(all(not self.e.active(self.e.find(b['id'])) for b in current))
        self.clock.advance(3600);self.assertTrue(self.e.active(self.e.find(future['id'])))
    def test_website_application_rules_and_locks_are_unchanged(self):
        self.plan();web=self.e.save_block({'name':'Distractions','enabled':True,'websites':['blocked.invalid'],'applications':['bundle:local.fixture']})
        self.e.set_lock(web['id'],{'type':'password','password':'fixture-rule-password'});before=copy.deepcopy(self.e.find(web['id']))
        self.e.recover_device('fixture-safety-word')
        self.assertEqual(self.e.find(web['id']),before);self.assertTrue(self.e.locked(self.e.find(web['id'])))
        self.assertTrue(self.e.evaluate('https://blocked.invalid')['blocked'])
        self.assertTrue(self.e.app_matches(self.e.find(web['id']),{'bundle':'local.fixture'}))
    def test_default_release_keeps_next_day_but_stop_option_disables_it(self):
        block=self.plan();self.e.recover_device('fixture-safety-word');self.clock.advance(86400)
        self.assertTrue(self.e.active(self.e.find(block['id'])))
        self.e.recover_device('fixture-safety-word',stop_plan=True);self.clock.advance(86400)
        self.assertFalse(self.e.active(self.e.find(block['id'])));self.assertFalse(self.e.find(block['id'])['enabled'])
    def test_concurrent_long_rule_does_not_skip_short_rules_next_span(self):
        short=self.plan(name='Short periods',schedule=[{'days':list(range(7)),'start':540,'end':600},{'days':list(range(7)),'start':660,'end':720}])
        long=self.plan(name='Long period',schedule=[{'days':list(range(7)),'start':540,'end':1080}])
        self.e.recover_device('fixture-safety-word')
        short_rule=self.e.find(short['id']);long_rule=self.e.find(long['id'])
        self.assertLess(self.e.runtime(short_rule)['device_emergency_until'],self.e.runtime(long_rule)['device_emergency_until'])
        self.clock.advance(2*3600);self.assertTrue(self.e.active(short_rule));self.assertFalse(self.e.active(long_rule))

if __name__=='__main__':unittest.main()
