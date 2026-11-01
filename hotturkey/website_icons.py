"""Read website icons from local Chromium caches; never contact a website."""
from contextlib import closing
import base64
import shutil
import sqlite3
import tempfile
import struct
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

from .model import PolicyError


def hostname(value):
    if not isinstance(value,str) or len(value)>8192:return ''
    try:
        url=urlsplit(value if '://' in value else 'https://'+value)
        if url.scheme not in ('http','https') or url.username or url.password:return ''
        host=url.hostname or ''
        if not host or any(c in host for c in '/\\\x00%'):return ''
        return host.encode('idna').decode('ascii').lower().rstrip('.')
    except (ValueError,UnicodeError):return ''


class WebsiteIcons:
    def __init__(self,profiles=None,clock=time.monotonic):
        self.profiles=profiles;self.clock=clock;self.cache={};self.lock=threading.Lock()

    def paths(self):
        if self.profiles is not None:return list(self.profiles)
        root=Path.home()/'Library/Application Support';paths=[]
        for app in ['Microsoft Edge','Google/Chrome','BraveSoftware/Brave-Browser','Vivaldi','Chromium']:
            base=root/app
            for profile in [base/'Default',*sorted(base.glob('Profile *'))[:7]]:
                path=profile/'Favicons'
                if path.is_file():paths.append(path)
        return paths[:16]

    def resolve(self,targets):
        if not isinstance(targets,list) or len(targets)>100:raise PolicyError('网站图标请求无效')
        hosts=list(dict.fromkeys(hostname(v) for v in targets));hosts=[v for v in hosts if v]
        with self.lock:
            now=self.clock();missing=[h for h in hosts if h not in self.cache or now-self.cache[h][0]>600]
            images={}
            if missing:
                for path in self.paths():
                    if len(images)==len(missing):break
                    try:
                        if path.stat().st_size>64*1024*1024:continue
                        # Chromium can hold an exclusive lock. A disposable copy
                        # reads the cache without modifying the browser database.
                        with tempfile.TemporaryDirectory(prefix='hotturkey-icons-') as directory:
                            copy=Path(directory)/'Favicons';shutil.copyfile(path,copy)
                            wal=Path(str(path)+'-wal')
                            if wal.exists() and wal.stat().st_size<=64*1024*1024:shutil.copyfile(wal,Path(str(copy)+'-wal'))
                            with closing(sqlite3.connect(copy,timeout=.1)) as db:
                                db.execute('PRAGMA query_only=ON')
                                deadline=self.clock()+.25
                                db.set_progress_handler(lambda: int(self.clock()>deadline),1000)
                                for host in missing:
                                    if host in images:continue
                                    for prefix in ('https://'+host+'/','http://'+host+'/'):
                                        row=db.execute('''SELECT b.image_data FROM icon_mapping m JOIN favicon_bitmaps b ON b.icon_id=m.icon_id
                                            WHERE m.page_url>=? AND m.page_url<? AND b.width BETWEEN 16 AND 256 AND length(b.image_data)<=65536
                                            ORDER BY CASE WHEN b.width>=32 THEN 0 ELSE 1 END,b.width LIMIT 1''',(prefix,prefix[:-1]+'0')).fetchone()
                                        if row and row[0] and len(row[0])>=24 and bytes(row[0]).startswith(b'\x89PNG\r\n\x1a\n') and all(1<=n<=256 for n in struct.unpack('>II',row[0][16:24])):
                                            images[host]='data:image/png;base64,'+base64.b64encode(row[0]).decode();break
                    except (OSError,sqlite3.Error):continue
                for host in missing:self.cache[host]=(now,images.get(host))
                while len(self.cache)>512:self.cache.pop(next(iter(self.cache)))
            return {'items':[{'target':host,'image':self.cache.get(host,(0,None))[1]} for host in hosts]}
