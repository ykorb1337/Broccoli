"""Registered private screenshot locations. Changing location never moves history."""
import os
import stat
import uuid
from pathlib import Path
from .model import PolicyError

class ScreenshotStorage:
    def __init__(self,tracking):
        self.tracking=tracking
        with tracking.lock,tracking.db:
            tracking.db.execute('CREATE TABLE IF NOT EXISTS tracking_screenshot_roots(id TEXT PRIMARY KEY,path TEXT NOT NULL UNIQUE)')
            tracking.db.execute('INSERT OR IGNORE INTO tracking_screenshot_roots VALUES(?,?)',('default',str(tracking.store.directory/'screenshots')))
    def root(self,ident='default'):
        if not isinstance(ident,str):raise PolicyError('截图目录无效')
        with self.tracking.lock:row=self.tracking.db.execute('SELECT path FROM tracking_screenshot_roots WHERE id=?',(ident,)).fetchone()
        if row is None:raise PolicyError('截图目录未登记')
        return Path(row[0])
    def current(self):
        path=self.tracking.settings().get('screenshot_directory','')
        with self.tracking.lock:row=self.tracking.db.execute('SELECT id,path FROM tracking_screenshot_roots WHERE path=?',(path,)).fetchone() if path else None
        root=self.root(row[0] if row else 'default')
        try:display='~/'+root.resolve().relative_to(Path.home().resolve()).as_posix()
        except ValueError:display=str(root)
        return {'id':row[0] if row else 'default','path':str(root),'display_path':display}
    def choose(self,selected):
        if not isinstance(selected,str) or not selected or len(selected)>4096 or '\x00' in selected:raise PolicyError('截图目录无效')
        parent=Path(selected).expanduser()
        if not parent.is_absolute() or not parent.is_dir():raise PolicyError('请选择已有文件夹')
        parent=parent.resolve()
        # Accept existing legacy locations without nesting another directory.
        root=parent if parent.name in {'Broccoli Screenshots','HotTurkey Screenshots'} else parent/'Broccoli Screenshots'
        try:
            root.mkdir(mode=0o700,exist_ok=True)
            info=root.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid!=os.getuid() or info.st_mode&0o077:raise PolicyError('请选择支持私有截图目录的位置')
            probe=root/('.write-check-'+uuid.uuid4().hex)
            fd=os.open(probe,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd);probe.unlink()
        except OSError:raise PolicyError('无法写入所选截图目录') from None
        with self.tracking.lock,self.tracking.db:
            self.tracking.db.execute('INSERT OR IGNORE INTO tracking_screenshot_roots VALUES(?,?)',(uuid.uuid4().hex,str(root)))
            settings=self.tracking.settings();settings['screenshot_directory']=str(root)
            import json,copy
            self.tracking.db.execute('UPDATE tracking_settings SET value=? WHERE id=1',(json.dumps(settings,ensure_ascii=False),));self.tracking._configuration=copy.deepcopy(settings)
        return self.current()
