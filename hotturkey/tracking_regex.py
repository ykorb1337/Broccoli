"""Bounded, cached regex evaluation. Captured text never leaves this computer."""
import hashlib
import json
import re
import subprocess
import sys
import threading
import time
from collections import OrderedDict
from pathlib import Path
from .model import PolicyError

TIMEOUT=.75


def validate(pattern):
    try:
        compiled=re.compile(pattern,re.IGNORECASE)
        if compiled.groups>99:raise PolicyError('最多支持 99 个捕获组')
        return compiled.groups
    except (re.error,RecursionError,OverflowError) as error:raise PolicyError('正则表达式无效：'+str(error)[:160]) from None


class RegexMatcher:
    def __init__(self):self.cache=OrderedDict();self.cache_bytes=0;self.failures=OrderedDict();self.lock=threading.Lock()

    def match(self,pattern,values,deadline=None):
        # Results key the complete original string. Case-insensitive matching
        # must still preserve the spelling of each capture in a dynamic tag.
        values=list(dict.fromkeys(values));result={}
        with self.lock:
            missing=[]
            for value in values:
                key=(pattern,value)
                if key in self.cache:result[value]=self.cache[key][0];self.cache.move_to_end(key)
                else:missing.append(value)
            for offset in range(0,len(missing),64):
                if deadline is not None and time.monotonic()>=deadline:raise PolicyError('正则筛选耗时过长，请缩小日期范围或简化条件')
                batch=missing[offset:offset+64];payload=json.dumps({'pattern':pattern,'values':batch},ensure_ascii=False).encode()
                signature=hashlib.sha256(payload).digest();failure=self.failures.get(signature)
                if failure and time.monotonic()<failure[0]:raise PolicyError(failure[1])
                try:
                    process=subprocess.run([sys.executable,'-I','-B',str(Path(__file__).with_name('tracking_regex_worker.py'))],
                        input=payload,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=TIMEOUT if deadline is None else min(TIMEOUT,max(.001,deadline-time.monotonic())),check=False)
                    if process.returncode:raise PolicyError('正则匹配未完成，请检查表达式')
                    response=json.loads(process.stdout)
                    if response.get('error'):raise PolicyError('正则匹配失败：'+response['error'])
                    matches=response['matches']
                    if len(matches)!=len(batch):raise PolicyError('正则匹配结果无效')
                except subprocess.TimeoutExpired:error='正则匹配耗时过长，请简化表达式后重试'
                except (OSError,ValueError,KeyError,TypeError):error='正则匹配组件暂不可用，请重试'
                except PolicyError as caught:error=str(caught)
                else:
                    for value,groups in zip(batch,matches):
                        size=len(payload)//len(batch)+len(json.dumps(groups,ensure_ascii=False).encode())
                        result[value]=groups;self.cache[(pattern,value)]=(groups,size);self.cache_bytes+=size;self.cache.move_to_end((pattern,value))
                    while len(self.cache)>512 or self.cache_bytes>8*1024*1024:self.cache_bytes-=self.cache.popitem(last=False)[1][1]
                    continue
                self.failures[signature]=(time.monotonic()+30,error);self.failures.move_to_end(signature)
                while len(self.failures)>32:self.failures.popitem(last=False)
                raise PolicyError(error)
        return result
