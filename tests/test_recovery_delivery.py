"""Current-user decision loop: no native process or physical action is run."""
import copy
import os
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from broccoli.engine import Engine
from broccoli.store import Store
from broccoli.platform_macos import enforce_loop
from test_authority import Clock


class RecoveryDeliveryTests(unittest.TestCase):
    def run_loop(self,protocol=2,ready=True,alter=None,word=None,game=False):
        with tempfile.TemporaryDirectory() as directory:
            store=Store(directory);clock=Clock();engine=Engine(store,clock.wall,clock.monotonic,'fixture','alice')
            try:
                store.state['settings']['statistics']=False;store.state['settings']['notifications']=False
                engine.configure_device_recovery('fixture-escape')
                engine.save_block({'name':'Sleep fixture','enabled':True,'device':'sleep','device_minutes':5,'confirm_device':True})
                if game:engine.save_block({'name':'App fixture','enabled':True,'applications':['bundle:fixture.game']})
                before=copy.deepcopy(store.state['blocks']);service=SimpleNamespace(native_session_initialized=True,helper_starts=0,engine=engine,store=store,stop=threading.Event(),singleton=SimpleNamespace(fileno=lambda:123),browser_notices=[])
                commands=[]
                def samples():
                    for i in range(38):
                        clock.advance(1);state=service.device_gate.status(os.getuid());report=None
                        if state:report={'until':state['until'],'action':state['action'],'ready':ready(i) if callable(ready) else ready}
                        if alter and report:report=alter(report)
                        sample={'apps':[{'pid':999999,'bundle':'fixture.game','application':'Game','path':'/fixture/Game.app'}] if game else [],'front':{},'idle':0,'signin':False}
                        if protocol is not None:sample['recovery_protocol']=protocol
                        if report is not None:sample['recovery_ui']=report
                        if word is not None:sample['recovery_word']=word
                        yield sample
                    service.stop.set()
                # The transport is mocked. Do not depend on a previous native build.
                root=Path(directory)/'project';(root/'build').mkdir(parents=True)
                (root/'build/HotTurkeyAgent').touch()
                with patch('broccoli.platform_macos.ROOT',root),patch('broccoli.platform_macos.subprocess.Popen',return_value=object()),patch('broccoli.platform_macos.native_samples',side_effect=lambda *args:samples()),patch('broccoli.platform_macos.native_command',side_effect=lambda p,s,c:commands.append(c) or True),patch('broccoli.platform_macos.stop_native'):
                    enforce_loop(service)
                self.assertEqual(store.state['blocks'],before,'readiness cannot edit locks or rules')
                return commands,service.device_recovery_protocol
            finally:store.db.close()
    def test_legacy_or_malformed_helpers_never_get_device_commands(self):
        for value in [None,0,1,True,2.0,'2',[],{}]:
            with self.subTest(protocol=value):
                commands,protocol=self.run_loop(protocol=value)
                self.assertFalse(any(c['device'] for c in commands));self.assertEqual(protocol,0)
                self.assertTrue(all(c['sleep_guard'] is None for c in commands),'legacy helpers must not show an unusable cover')
    def test_healthy_current_protocol_can_proceed_after_countdown(self):
        commands,protocol=self.run_loop();self.assertEqual(protocol,2)
        self.assertTrue(any(c['device']=='sleep' for c in commands));self.assertFalse(any(c['device'] for c in commands[:30]))
    def test_unusable_input_and_wrong_episode_cannot_proceed(self):
        commands,_=self.run_loop(ready=False);self.assertFalse(any(c['device'] for c in commands))
        commands,_=self.run_loop(alter=lambda r:{**r,'until':r['until']+1});self.assertFalse(any(c['device'] for c in commands))
    def test_losing_input_immediately_revokes_the_lease(self):
        commands,_=self.run_loop(ready=lambda i:i<33)
        self.assertTrue(any(c['device'] for c in commands[:33]));self.assertFalse(any(c['device'] for c in commands[33:]))
    def test_recovery_submission_is_never_a_device_action_frame(self):
        commands,_=self.run_loop(word='wrong-fixture-word');self.assertFalse(any(c['device'] for c in commands))
    def test_unavailable_recovery_does_not_disable_application_blocking(self):
        commands,_=self.run_loop(protocol=None,game=True)
        self.assertTrue(any(999999 in c['kill'] for c in commands));self.assertFalse(any(c['device'] for c in commands))


if __name__=='__main__':unittest.main()
