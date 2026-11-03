"""Current-user setup. Removal is reversible and never deletes user data."""
import argparse
import contextlib
import datetime as dt
import importlib.util
import json
import os
import plistlib
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from .engine import Engine,password_ok
from .model import DEFAULT_SETTINGS
from .paths import user_data_directory,policy_database
from .setup_policy import UNINSTALLER_BUNDLE,uninstall_blocked

ROOT=Path(__file__).resolve().parent.parent
BROWSERS=('Google/Chrome','Microsoft Edge','BraveSoftware/Brave-Browser','Chromium','Vivaldi','Mozilla')

def application_info(path,identifier=None):
    path=Path(path)
    if path.is_symlink():raise ValueError('应用位置不能是符号链接。')
    value=plistlib.loads((path/'Contents/Info.plist').read_bytes())
    if identifier and value.get('CFBundleIdentifier')!=identifier:raise ValueError('此位置不是 Broccoli 应用。')
    return value

class Setup:
    def __init__(self,home=None,runner=subprocess.run,*,job_prefix='local.hotturkey'):
        self.home=Path(home) if home is not None else Path.home()
        self.data=user_data_directory(self.home)
        self.app=self.home/'Applications/Broccoli.app'
        self.legacy_app=self.home/'Applications/HotTurkey.app'
        self.uninstaller=self.home/'Applications/Broccoli Uninstaller.app'
        self.job_prefix=job_prefix
        self.service=self.home/('Library/LaunchAgents/'+job_prefix+'.service.plist')
        self.desktop=self.home/('Library/LaunchAgents/'+job_prefix+'.desktop.plist')
        self.runner=runner

    def state(self):
        path=policy_database(self.data)
        if not path.exists():return None
        if path.is_symlink():raise ValueError('数据位置不能是符号链接。')
        with contextlib.closing(sqlite3.connect(path.as_uri()+'?mode=ro',uri=True)) as db:
            db.execute('BEGIN');row=db.execute('SELECT value FROM state WHERE id=1').fetchone()
            value=json.loads(row[0]);value['settings']={**DEFAULT_SETTINGS,**value.get('settings',{})}
            charges=db.execute('SELECT block_id,at,seconds FROM charges').fetchall()
        store=SimpleNamespace(state=value,save=lambda:None,used=lambda ident,since:sum(seconds for key,at,seconds in charges if key==ident and at>=since))
        from .app_targets import ApplicationTargets
        from .platform_macos import boot_id
        engine=Engine(store,boot_id=boot_id());engine.application_targets=ApplicationTargets(app_roots=[self.home/'Applications','/Applications','/System/Applications'])
        return engine

    def identities(self,source=None):
        paths=[self.uninstaller]
        if source is not None:paths.append(Path(source))
        return [{'bundle':UNINSTALLER_BUNDLE,'path':str(path),'executable':str(path/'Contents/MacOS/BroccoliSetup'),'application':name} for path in paths for name in ['Broccoli Uninstaller','Broccoli Uninstaller','BroccoliSetup']]

    def inspect(self,source=None):
        engine=self.state();reason=uninstall_blocked(engine,self.identities(source)) if engine else ''
        version=''
        if self.app.exists() or self.legacy_app.exists():version=str(application_info(self.app if self.app.exists() else self.legacy_app,'local.hotturkey.desktop').get('CFBundleShortVersionString',''))
        return {'installed':self.app.exists() or self.legacy_app.exists() or self.service.exists(),'version':version,'has_data':engine is not None,'requires_password':bool(engine and engine.store.state['settings']['settings_password']),'uninstall_blocked':bool(reason),'reason':reason,'location':'~/Applications','data_location':'~/'+self.data.relative_to(self.home).as_posix()}

    def authorize(self,source,password='',removal=False):
        for path in [self.data,self.app,self.legacy_app,self.uninstaller,self.service,self.desktop,self.data/'runtime']:
            if path.is_symlink():raise ValueError('安装位置包含符号链接，已停止操作。')
        engine=self.state()
        if not engine:return
        if removal:
            reason=uninstall_blocked(engine,self.identities(source))
            if reason:raise ValueError(reason)
        stored=engine.store.state['settings']['settings_password']
        if stored and not password_ok(password,stored):raise ValueError('请输入正确的设置密码。')

    def installer(self):
        spec=importlib.util.spec_from_file_location('hotturkey_user_installer',ROOT/'scripts/install.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

    def install(self,source,password=''):
        source=Path(source);application_info(source,'local.hotturkey.desktop')
        self.authorize(source,password)
        self.runner(['/usr/bin/codesign','--verify','--deep','--strict',str(source)],check=True,capture_output=True)
        module=self.installer();browser_files=[self.home/'Library/Application Support'/b/'NativeMessagingHosts/local.hotturkey.bridge.json' for b in BROWSERS]
        # The existing transactional installer retains its ordinary lock gate.
        module.install(source,self.data,self.app,self.service,browser_files,set(),False)
        return {'ok':True,'action':'install','location':'~/Applications/Broccoli.app'}

    def owned_browser_files(self):
        result=[]
        for browser in BROWSERS:
            path=self.home/'Library/Application Support'/browser/'NativeMessagingHosts/local.hotturkey.bridge.json'
            if path.is_symlink():raise ValueError('浏览器连接位置包含符号链接。')
            if not path.exists():continue
            value=json.loads(path.read_text())
            if value.get('name')=='local.hotturkey.bridge' and value.get('path')==str(self.data/'native-host'):result.append(path)
        return result

    def loaded(self,path):
        return self.runner(['/bin/launchctl','print',f'gui/{os.getuid()}/'+self.job_prefix+('.service' if path==self.service else '.desktop')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0

    def stop_job(self,path):
        if not path.exists():return
        result=self.runner(['/bin/launchctl','bootout',f'gui/{os.getuid()}',str(path)],capture_output=True)
        if result.returncode and self.loaded(path):raise RuntimeError('无法停止 Broccoli 后台。')

    def stop_processes(self):
        result=self.runner(['/bin/ps','-axo','pid=,uid=,command='],capture_output=True,text=True,check=True)
        allowed={str(path/'Contents/MacOS/HotTurkey') for path in [self.app,self.legacy_app]}|{str(self.data/'runtime/build'/n) for n in ['HotTurkeyAgent','HotTurkeyTracker']}
        pids=[]
        for line in result.stdout.splitlines():
            fields=line.strip().split(None,2)
            if len(fields)!=3 or not fields[0].isdigit() or fields[1]!=str(os.getuid()):continue
            if any(fields[2]==value or fields[2].startswith(value+' ') for value in allowed):pids.append(int(fields[0]))
        # A manual background is identified by its authenticated connection and cwd.
        pid=self.installer().manual_server(self.data)
        if pid:
            cwd=self.runner(['/usr/sbin/lsof','-a','-p',str(pid),'-d','cwd','-Fn'],capture_output=True,text=True,check=True).stdout
            if 'n'+str(self.data/'runtime') in cwd.splitlines():pids.append(pid)
        for pid in set(pids):
            try:os.kill(pid,signal.SIGTERM)
            except ProcessLookupError:pass
        deadline=time.monotonic()+6
        while pids and time.monotonic()<deadline:
            pending=[]
            for pid in pids:
                try:os.kill(pid,0);pending.append(pid)
                except ProcessLookupError:pass
            pids=pending
            if pids:time.sleep(.05)
        if pids:raise RuntimeError('后台尚未完全退出，请稍后重试。')

    def uninstall(self,source,password=''):
        try:from .uninstall import remove_application
        except ImportError:raise ValueError('请使用独立的 Broccoli Uninstaller。') from None
        return remove_application(self,source,password)

    def stop_browser_hosts(self):
        self.installer().restart_old_hosts(self.data/'runtime')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['inspect','install','uninstall']);parser.add_argument('--source',type=Path,required=True);args=parser.parse_args()
    try:
        data={} if args.action=='inspect' else json.loads(sys.stdin.buffer.read(32769).decode('utf-8'))
        if not isinstance(data,dict) or set(data)-{'password'}:raise ValueError('安装请求无效。')
        setup=Setup();result=setup.inspect(args.source) if args.action=='inspect' else getattr(setup,args.action)(args.source,data.get('password',''))
        print(json.dumps(result,ensure_ascii=False),flush=True)
    except Exception as error:
        print(json.dumps({'ok':False,'error':str(error)},ensure_ascii=False),flush=True);raise SystemExit(1)

if __name__=='__main__':main()
