"""Dedicated upcoming-sleep reminders, separate from regular rule warnings."""
import datetime as dt
import hashlib


def sleep_notice(engine,block):
    if block.get('device')!='sleep' or not block.get('enabled') or block.get('mode')!='scheduled':return None
    if block.get('users') and engine.user not in block['users']:return None
    if not engine.store.state['settings'].get('device_recovery_hash'):return None
    at=engine.next_start(block);now=engine.now()
    if at is None or not 0<at-now<=15*60:return None
    runtime=engine.runtime(block);key=str(at)
    if runtime.get('sleep_notice_at')==key:return None
    runtime['sleep_notice_at']=key;engine.store.save()
    remaining=max(1,int((at-now+59)//60))
    return {'id':hashlib.sha256((block['id']+':'+key).encode()).hexdigest(),'title':'睡眠提醒',
            'body':block['name']+' · '+str(remaining)+' 分钟后开始（'+dt.datetime.fromtimestamp(at).strftime('%H:%M')+'）'}
