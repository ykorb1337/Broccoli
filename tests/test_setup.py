"""Reversible ordinary setup; all launchd/process effects are isolated fakes."""
import copy
import json
import os
import plistlib
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from broccoli.engine import Engine,password_hash
from broccoli.setup import Setup
from broccoli.store import Store

class SetupTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.home=Path(self.temp.name);self.commands=[]
        def runner(args,**kwargs):self.commands.append(args);return subprocess.CompletedProcess(args,0,'','')
        self.setup=Setup(self.home,runner);self.store=Store(self.setup.data);self.engine=Engine(self.store)
        for app,identifier in [(self.setup.app,'local.hotturkey.desktop'),(self.setup.uninstaller,'local.broccoli.uninstaller')]:
            (app/'Contents').mkdir(parents=True);(app/'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':identifier,'CFBundleShortVersionString':'0.7.0'}))
        self.setup.service.parent.mkdir(parents=True);self.setup.service.write_text('fixture');self.setup.desktop.write_text('fixture')
        (self.setup.data/'runtime').mkdir();(self.setup.data/'runtime/keep').write_text('program')
        (self.setup.data/'screenshots').mkdir();(self.setup.data/'screenshots/keep.png').write_bytes(b'private-image')
        (self.setup.data/'native-host').write_text('fixture');(self.setup.data/'installation.json').write_text('{}')
        self.stopped=patch.object(self.setup,'stop_processes');self.stopped.start()
        self.hosts=patch.object(self.setup,'stop_browser_hosts');self.hosts.start()
    def tearDown(self):self.hosts.stop();self.stopped.stop();self.store.db.close();self.temp.cleanup()
    def block(self,**values):return self.engine.save_block({'name':'Fixture','enabled':True,**values})
    def test_locked_rule_alone_does_not_trap_the_uninstaller(self):
        block=self.block(websites=['example.invalid']);self.engine.set_lock(block['id'],{'type':'timer','until':self.engine.now()+1800})
        self.assertFalse(self.setup.inspect()['uninstall_blocked'])
        self.setup.authorize(self.setup.uninstaller,removal=True)
    def test_explicit_bundle_rule_blocks_original_and_renamed_copies(self):
        self.block(applications=['bundle:local.broccoli.uninstaller'])
        for source in [self.setup.uninstaller,self.home/'Renamed.app']:
            with self.assertRaisesRegex(ValueError,'拦截'):self.setup.authorize(source,removal=True)
        self.assertTrue(self.setup.inspect()['uninstall_blocked'])
    def test_path_and_localized_name_rules_also_block(self):
        for target in [str(self.setup.uninstaller),'Broccoli Uninstaller','Broccoli Uninstaller']:
            self.store.state['blocks']=[];self.block(applications=[target]);self.store.save()
            with self.assertRaises(ValueError):self.setup.authorize(self.home/'Copy.app',removal=True)
    def test_installer_strictness_applies_only_during_a_lock(self):
        block=self.block();self.store.state['settings']['block_installer']=True;self.store.save()
        self.assertFalse(self.setup.inspect()['uninstall_blocked'])
        self.engine.set_lock(block['id'],{'type':'text','custom_text':'fixture'})
        self.assertTrue(self.setup.inspect()['uninstall_blocked'])
        with self.assertRaises(ValueError):self.setup.uninstall(self.setup.uninstaller)
        self.assertEqual(self.commands,[])
    def test_installer_and_uninstaller_have_blockable_identities(self):
        from broccoli.setup_policy import INSTALLER_BUNDLES
        self.assertIn('local.broccoli.installer',INSTALLER_BUNDLES)
        self.assertIn('local.broccoli.uninstaller',INSTALLER_BUNDLES)
        self.assertIn('com.apple.installer',INSTALLER_BUNDLES)
    def test_settings_password_is_required_and_not_exposed_by_inspection(self):
        self.store.state['settings']['settings_password']=password_hash('fixture-password');self.store.save()
        info=self.setup.inspect();self.assertTrue(info['requires_password']);self.assertNotIn('fixture-password',json.dumps(info))
        with self.assertRaises(ValueError):self.setup.authorize(self.setup.uninstaller,'wrong',True)
        self.setup.authorize(self.setup.uninstaller,'fixture-password',True)
    def test_inspection_never_saves_policy_or_runtime(self):
        self.block();before=copy.deepcopy(self.store.state);self.setup.inspect()
        value=json.loads(self.store.db.execute('SELECT value FROM state').fetchone()[0]);self.assertEqual(value,before)
    def test_uninstall_moves_programs_and_keeps_every_data_file(self):
        self.block();before=copy.deepcopy(self.store.state)
        result=self.setup.uninstall(self.setup.uninstaller)
        self.assertTrue(result['data_preserved']);self.assertFalse(self.setup.app.exists());self.assertTrue(self.setup.uninstaller.exists());self.assertFalse(self.setup.service.exists())
        self.assertTrue((self.setup.data/'screenshots/keep.png').exists());self.assertTrue((self.setup.data/'broccoli.sqlite3').exists())
        manifest=json.loads((Path(result['backup'])/'restore.json').read_text());self.assertGreaterEqual(len(manifest['moves']),6)
        self.assertEqual(json.loads(self.store.db.execute('SELECT value FROM state').fetchone()[0]),before)
        for move in reversed(manifest['moves']):Path(move['to']).rename(move['from'])
        self.assertTrue(self.setup.app.exists());self.assertTrue(self.setup.service.exists())
    def test_failure_restores_files_and_restarts_previously_loaded_jobs(self):
        original=Path.rename;count=0
        def rename(path,destination):
            nonlocal count;count+=1
            if count==3:raise OSError('fixture move failed')
            return original(path,destination)
        with patch.object(Path,'rename',rename),self.assertRaises(OSError):self.setup.uninstall(self.setup.uninstaller)
        self.assertTrue(self.setup.app.exists());self.assertTrue((self.setup.data/'runtime/keep').exists());self.assertTrue(self.setup.service.exists())
        self.assertTrue(any(c[1]=='bootstrap' for c in self.commands))
    def test_rule_added_during_stop_aborts_before_removing_any_program(self):
        def add_block(*args):self.block(applications=['bundle:local.broccoli.uninstaller'])
        with patch.object(self.setup,'stop_processes',side_effect=add_block),self.assertRaises(ValueError):self.setup.uninstall(self.setup.uninstaller)
        self.assertTrue(self.setup.app.exists());self.assertTrue(self.setup.service.exists())
    def test_external_browser_manifest_and_custom_screenshot_directory_are_untouched(self):
        browser=self.home/'Library/Application Support/Google/Chrome/NativeMessagingHosts/local.hotturkey.bridge.json';browser.parent.mkdir(parents=True)
        browser.write_text(json.dumps({'name':'local.hotturkey.bridge','path':'/other/program'}))
        external=self.home/'Pictures/Private';external.mkdir(parents=True);(external/'keep.png').write_bytes(b'private')
        self.setup.uninstall(self.setup.uninstaller)
        self.assertTrue(browser.exists());self.assertEqual((external/'keep.png').read_bytes(),b'private')
    def test_symlinked_program_cannot_be_followed(self):
        self.setup.app.rename(self.home/'other.app');self.setup.app.symlink_to(self.home/'other.app')
        with self.assertRaises(ValueError):self.setup.uninstall(self.setup.uninstaller)
        self.assertEqual(self.commands,[]);self.assertTrue((self.home/'other.app/Contents/Info.plist').exists())

if __name__=='__main__':unittest.main()
