"""Removal backend shipped only with the separately downloaded tool."""
import datetime as dt
import json
import os
from pathlib import Path
from .setup import application_info
from .setup_policy import UNINSTALLER_BUNDLE

def remove_application(self,source,password=''):
    self.authorize(source,password,True)
    for app in [self.app,self.legacy_app]:
        if app.exists():application_info(app,'local.hotturkey.desktop')
    if self.uninstaller.exists():application_info(self.uninstaller,UNINSTALLER_BUNDLE)
    module=self.installer();moves=[];loaded=[]
    with module.install_lock(self.data):
        self.authorize(source,password,True)
        targets=[*self.owned_browser_files(),self.desktop,self.service,self.data/'native-host',self.app,self.legacy_app,self.data/'installation.json',self.data/'runtime']
        archive=self.data/'Uninstall Backups'/dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        archive.mkdir(parents=True,mode=0o700)
        try:
            for path in [self.desktop,self.service]:
                if path.exists() and self.loaded(path):loaded.append(path)
                self.stop_job(path)
            self.stop_processes()
            # Check again after the writer exits, before moving any files.
            self.authorize(source,password,True)
            for index,path in enumerate(targets):
                if path.is_symlink():raise ValueError('安装文件变为符号链接，已停止操作。')
                if not path.exists():continue
                if path==self.data/'runtime':self.stop_browser_hosts()
                destination=archive/(str(index)+'-'+path.name);path.rename(destination);moves.append((path,destination))
            manifest={'version':1,'data_preserved':True,'moves':[{'from':str(a),'to':str(b)} for a,b in moves]}
            (archive/'restore.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2));(archive/'restore.json').chmod(0o600)
        except BaseException:
            for old,new in reversed(moves):
                if new.exists() and not old.exists():new.rename(old)
            for path in reversed(loaded):self.runner(['/bin/launchctl','bootstrap',f'gui/{os.getuid()}',str(path)],capture_output=True)
            raise
    return {'ok':True,'action':'uninstall','data_preserved':True,'backup':str(archive)}
