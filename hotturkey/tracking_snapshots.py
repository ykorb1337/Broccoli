"""Short-lived private report snapshots; no extra files or enforcement state."""
import json
import re
import secrets
import threading
import time
from collections import OrderedDict
from .model import PolicyError


class ReportSnapshots:
    def __init__(self):self.entries=OrderedDict();self.bytes=0;self.lock=threading.RLock();self.clock=time.monotonic
    def _prune(self):
        expired=[k for k,v in self.entries.items() if self.clock()-v[0]>8*3600]
        for key in expired:self.bytes-=len(self.entries.pop(key)[2])
    def put(self,kind,value):
        encoded=json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()
        with self.lock:
            self._prune();key=secrets.token_hex(32);self.entries[key]=(self.clock(),kind,encoded);self.bytes+=len(encoded)
            # Retain a single large current report, rather than returning a
            # token that has already been evicted. Older reports are bounded.
            while len(self.entries)>1 and (len(self.entries)>64 or self.bytes>16*1024*1024):self.bytes-=len(self.entries.popitem(last=False)[1][2])
            return key
    def get(self,key,kind):
        if not isinstance(key,str) or not re.fullmatch('[a-f0-9]{64}',key):raise PolicyError('报表快照无效，请重新生成工时表')
        with self.lock:
            self._prune();entry=self.entries.get(key)
            if entry is None or entry[1]!=kind:raise PolicyError('报表快照已失效，请重新生成工时表')
            self.entries.move_to_end(key);return json.loads(entry[2])
