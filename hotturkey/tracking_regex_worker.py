"""One-shot regex matching over a private pipe; invoked with Python -I.

The parent bounds wall time and kills/reaps this process on timeout. Keeping
user expressions out of the server process prevents a backtracking expression
from holding the GIL used by the local rule service.
"""
import json
import re
import sys


def main():
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_CPU,(1,1))
    except (ImportError,ValueError,OSError):pass
    try:
        value=json.loads(sys.stdin.buffer.read(4*1024*1024+1))
        compiled=re.compile(value['pattern'],re.IGNORECASE)
        if compiled.groups>99:raise ValueError('最多支持 99 个捕获组')
        result=[];size=0
        for source in value['values']:
            match=compiled.search(source)
            groups=[match.group(0)]+list(match.groups()) if match is not None else None
            size+=len(json.dumps(groups,ensure_ascii=False).encode())
            if size>8*1024*1024:raise ValueError('正则匹配结果过大，请减少捕获内容')
            result.append(groups)
        response={'matches':result}
    except (ValueError,TypeError,KeyError,re.error,RecursionError,OverflowError,MemoryError) as error:
        response={'error':str(error)[:200]}
    sys.stdout.write(json.dumps(response,ensure_ascii=False))


if __name__=='__main__':main()
