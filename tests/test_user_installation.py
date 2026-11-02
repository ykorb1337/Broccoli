"""Ordinary installer rename/rollback contracts without real launchd actions."""
import importlib.util
import json
import os
import plistlib
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('tested_user_installer',ROOT/'scripts/install.py');installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)

class UserInstallationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.home=self.root/'home';self.target=self.home/'Library/Application Support/HotTurkey';self.target.mkdir(parents=True)
        self.launch=self.home/'Library/LaunchAgents/local.hotturkey.service.plist';self.launch.parent.mkdir(parents=True);self.launch.write_text('previous launch')
        self.old=self.home/'Applications/HotTurkey.app';self.app=self.home/'Applications/Broccoli.app';self.source=self.root/'Broccoli.app'
        for app in [self.old,self.source]:
            (app/'Contents').mkdir(parents=True);(app/'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':'local.hotturkey.desktop'}))
        (self.old/'keep').write_text('old program');(self.target/'runtime').mkdir();(self.target/'runtime/keep').write_text('old runtime')
        self.project=self.root/'project';self.project.mkdir()
        for folder in ['web','extension','hotturkey','build']:(self.project/folder).mkdir()
        (self.project/'build/HotTurkeyAgent').write_bytes(b'fixture')
        self.ui=self.launch.with_name('local.hotturkey.desktop.plist');self.ui.write_bytes(plistlib.dumps({'Label':'local.hotturkey.desktop','ProgramArguments':['/usr/bin/open','-a',str(self.old),'--args','--login']}))
        self.commands=[];self.fail_bootstrap=False
        def run(args,**kwargs):
            self.commands.append(args)
            if self.fail_bootstrap and len(args)>1 and args[1]=='bootstrap':
                self.fail_bootstrap=False
                if kwargs.get('check'):raise subprocess.CalledProcessError(1,args)
                return subprocess.CompletedProcess(args,1)
            return subprocess.CompletedProcess(args,0)
        self.patches=[patch.object(installer,'ROOT',self.project),patch.object(installer,'application_python',return_value=Path('/fixture/python')),patch.object(installer,'manual_server',return_value=987654),patch.object(installer,'stop_desktops'),patch.object(installer,'restart_old_hosts'),patch.object(installer.subprocess,'run',side_effect=run)]
        for item in self.patches:item.start()
    def tearDown(self):
        for item in reversed(self.patches):item.stop()
        self.temp.cleanup()
    def install(self):return installer.install(self.source,self.target,self.app,self.launch,[],set())
    def test_upgrade_replaces_legacy_app_and_updates_login_path(self):
        self.install();self.assertTrue(self.app.exists());self.assertFalse(self.old.exists());self.assertFalse((self.target/'runtime/keep').exists())
        self.assertIn(str(self.app),plistlib.loads(self.ui.read_bytes())['ProgramArguments'])
        self.assertEqual(json.loads((self.target/'installation.json').read_text())['app_path'],str(self.app))
    def test_failed_activation_restores_legacy_app_runtime_and_login_path(self):
        before=self.ui.read_bytes();self.fail_bootstrap=True
        with self.assertRaises(subprocess.CalledProcessError):self.install()
        self.assertTrue((self.old/'keep').exists());self.assertFalse(self.app.exists());self.assertTrue((self.target/'runtime/keep').exists());self.assertEqual(self.ui.read_bytes(),before)
    def test_unrelated_application_in_legacy_location_is_not_moved(self):
        (self.old/'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':'other.app'}))
        with self.assertRaises(ValueError):self.install()
        self.assertTrue(self.old.exists());self.assertFalse(any(len(c)>1 and c[1] in {'bootout','bootstrap'} for c in self.commands))
    def test_symlinked_legacy_app_is_not_followed(self):
        other=self.root/'other.app';self.old.rename(other);self.old.symlink_to(other)
        with self.assertRaises(ValueError):self.install()
        self.assertTrue((other/'keep').exists());self.assertFalse(any(len(c)>1 and c[1] in {'bootout','bootstrap'} for c in self.commands))
    def test_only_exact_current_user_desktop_processes_are_closed(self):
        self.patches[3].stop()
        try:
            executable=str(self.old/'Contents/MacOS/HotTurkey')
            lines=f'111 {os.getuid()} {executable}\n112 {os.getuid()+1} {executable}\n113 {os.getuid()} {executable}-unrelated\n'
            with patch.object(installer.subprocess,'check_output',return_value=lines),patch.object(installer.os,'kill') as kill:
                installer.stop_desktops([self.old]);self.assertEqual([c.args[0] for c in kill.call_args_list],[111])
        finally:self.patches[3].start()

if __name__=='__main__':unittest.main()
