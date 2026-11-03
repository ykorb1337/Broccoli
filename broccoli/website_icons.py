"""Read website icons from local Chromium caches; never contact a website."""
from contextlib import closing
import base64
import logging
import json
import os
import shutil
import sqlite3
import tempfile
import struct
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

from .model import PolicyError

LOG=logging.getLogger('broccoli')
BUNDLED=Path(__file__).resolve().parent.parent/'web/website-icons'
BUILTIN_HOSTS=frozenset(['python.org','swift.org','github.com','apple.com','notion.so','arxiv.org','wikipedia.org','readthedocs.io','figma.com','mozilla.org','stackoverflow.com','web.dev'])

def bundled_icon(host):
    # Fixed public assets only. Never send browsing targets to an icon service.
    domain=next((name for name in BUILTIN_HOSTS if host==name or host.endswith('.'+name)),None)
    if not domain:return None
    try:
        raw=(BUNDLED/(domain+'.png')).read_bytes()
        if len(raw)<=65536 and raw.startswith(b'\x89PNG\r\n\x1a\n') and all(1<=n<=256 for n in struct.unpack('>II',raw[16:24])):
            return 'data:image/png;base64,'+base64.b64encode(raw).decode()
    except (OSError,struct.error):pass
    return None


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
    def __init__(self,profiles=None,clock=time.monotonic,directory=None):
        self.profiles=profiles;self.clock=clock;self.cache={};self.lock=threading.RLock();self.reported_error=False;self.requested=set()
        self.file=Path(directory)/'website-icons.json' if directory is not None else None
        if self.file and self.file.is_file() and not self.file.is_symlink() and self.file.stat().st_size<=6*1024*1024:
            try:self.accept(json.loads(self.file.read_text()),persist=False)
            except (OSError,ValueError,PolicyError):pass

    def accept(self,items,persist=True):
        if not isinstance(items,list) or len(items)>512:raise PolicyError('网站图标请求无效')
        changed=False
        with self.lock:
            for item in items:
                if not isinstance(item,dict):continue
                host=hostname(item.get('target'));image=item.get('image')
                if not host or not isinstance(image,str) or len(image)>90000 or not image.startswith('data:image/png;base64,'):continue
                try:raw=base64.b64decode(image.split(',',1)[1],validate=True)
                except ValueError:continue
                if len(raw)<24 or len(raw)>65536 or not raw.startswith(b'\x89PNG\r\n\x1a\n') or not all(1<=n<=256 for n in struct.unpack('>II',raw[16:24])):continue
                changed=changed or self.cache.get(host,(0,None,False))[1]!=image
                self.cache[host]=(self.clock(),image,False);self.requested.discard(host)
            while len(self.cache)>512:self.cache.pop(next(iter(self.cache)))
            if changed and persist and self.file:
                try:
                    with tempfile.NamedTemporaryFile(mode='w',dir=self.file.parent,prefix='.website-icons-',delete=False) as stream:
                        temporary=Path(stream.name);os.fchmod(stream.fileno(),0o600)
                        values=[];size=0
                        for host,value in reversed(list(self.cache.items())):
                            if not value[1]:continue
                            size+=len(value[1])+len(host)+100
                            if size>5*1024*1024:break
                            values.append({'target':host,'image':value[1]})
                        json.dump(values,stream)
                    temporary.replace(self.file)
                except OSError:
                    if 'temporary' in locals():temporary.unlink(missing_ok=True)

    def requests(self):
        with self.lock:return sorted(self.requested)[:32]

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
            now=self.clock();missing=[h for h in hosts if h not in self.cache or now-self.cache[h][0]>(3 if self.cache[h][2] else 600)]
            images={};failed=set()
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
                    except (OSError,sqlite3.Error) as error:
                        # Busy browser files and interrupted bounded queries
                        # are temporary failures, not proof an icon is absent.
                        failed.update(h for h in missing if h not in images)
                        if not self.reported_error:
                            LOG.info('Local website icon cache read deferred: %s',error);self.reported_error=True
                        continue
                for host in missing:
                    image=images.get(host) or self.cache.get(host,(0,None,False))[1] or bundled_icon(host)
                    self.cache[host]=(now,image,host in failed and not image)
                for old in list(self.cache):
                    if len(self.cache)<=512:break
                    if old not in hosts:self.cache.pop(old)
            for host in hosts:
                if not self.cache[host][1]:self.requested.add(host)
            if len(self.requested)>512:self.requested=set(hosts)
            return {'items':[{'target':host,'image':self.cache[host][1],**({'retry_after':3} if self.cache[host][2] else {})} for host in hosts]}
