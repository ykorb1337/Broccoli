"""Current-user activity recorder. It cannot terminate apps or change policy."""
import json
import logging
import secrets
import subprocess
import threading
import time
from pathlib import Path
from .tracking import finite

LOG=logging.getLogger('hotturkey')
BROWSERS={'com.google.Chrome':'Chrome','com.microsoft.edgemac':'Edge','org.mozilla.firefox':'Firefox','com.brave.Browser':'Brave','com.vivaldi.Vivaldi':'Vivaldi','com.operasoftware.Opera':'Opera','com.apple.Safari':'Safari'}
class TrackingRecorder:
    def __init__(self,tracking,clock=time.time,monotonic=time.monotonic):
        self.tracking=tracking;self.clock=clock;self.monotonic=monotonic;self.last=None;self.previous=None;self.browser={};self.lock=threading.RLock()
        self.status={'connected':False,'accessibility':False,'screen_recording':False,'formats':['jpeg','png'],'error':'','last_sample':None}
        self.last_capture=0;self.last_prune=0;self.continuous_start=0
        self.pending_captures={}
    def browser_sample(self,browser,item):
        if not isinstance(item,dict) or not item.get('active') or item.get('idle',0)>self.tracking.settings()['idle_seconds']:return
        with self.lock:self.browser[browser]={'at':self.clock(),'url':str(item.get('url',''))[:8192],'title':str(item.get('title',''))[:4096],'incognito':bool(item.get('incognito'))}
    def metadata(self,sample,now):
        front=sample.get('front',{})
        app={k:str(front.get(k,''))[:4096] for k in ['application','bundle','path','title','document']}
        app['url']=app['document'] if app['document'].startswith(('http://','https://')) else ''
        if app['url']:app['document']=''
        with self.lock:browser=self.browser.get(BROWSERS.get(app['bundle'],''))
        if browser and 0<=now-browser['at']<=8:
            if browser['incognito'] and not self.tracking.store.state['settings']['incognito_statistics']:return None
            app['url']=browser['url'];app['title']=browser['title'] or app['title']
        return app
    def allowed(self,data):
        if not self.tracking.store.state['settings']['statistics']:return False
        return self.tracking.recording_allowed(self.clock(),application=str(data.get('application','')),bundle=str(data.get('bundle','')),url=str(data.get('url','')),title=str(data.get('title','')),document=str(data.get('document','')))
    def legacy_allowed(self,data):
        if not self.tracking.settings()['titles'] and data.get('url'):return False
        return self.allowed(data)
    def record(self,sample):
        now=finite(self.clock());mono=self.monotonic();settings=self.tracking.settings();app=self.metadata(sample,now)
        policy={k:v for k,v in settings.items() if k not in ['viewer_dock','viewer_open','snap_minutes']}
        capture_ready=bool(self.previous and self.previous['allowed'] and self.previous['settings']==policy)
        permissions=sample.get('permissions',{})
        if permissions.get('screen_recording') is True and not self.status['screen_recording']:self.last_capture=0
        self.status.update(displays=permissions.get('displays',[]) if isinstance(permissions.get('displays',[]),list) else [],connected=True,accessibility=permissions.get('accessibility') is True,screen_recording=permissions.get('screen_recording') is True,last_sample=now,error='',screenshot_error=str(sample.get('capture_error',''))[:500],formats=permissions.get('formats',['jpeg','png']))
        state='Sleep' if sample.get('sleeping') else 'Locked' if sample.get('locked') else 'Away' if float(sample.get('idle',0))>=settings['idle_seconds'] else 'Active'
        try:self.tracking.clock.observe(state,min(now,finite(sample.get('at',now))),float(sample.get('idle',0)))
        except Exception:LOG.exception('Manual tag clock could not observe inactivity')
        allowed=bool(app is not None and self.allowed(app))
        if self.previous is None or not self.previous['allowed']:self.continuous_start=now
        if self.previous is not None and self.last is not None:
            before,previous_mono=self.last;delta=max(0,mono-previous_mono)
            previous=self.previous;metadata=previous['app'];old_state=previous['state']
            # Settings changes invalidate the in-flight interval. This also
            # prevents title/filter changes from persisting the preceding frame.
            admitted=bool(previous['allowed'] and previous['settings']==policy and app is not None and self.tracking.store.state['settings']['statistics'])
            context={k:metadata[k] for k in ['application','bundle','url','document','title']} if metadata else {}
            if delta>5 and old_state=='Sleep' and admitted and now>before:
                for start,end in self.tracking.recording_ranges(before,now,**context):
                    self.tracking.add_activity({'timeline':'computer','start':start,'end':end,'title':'Sleep','group_name':'Sleep'},merge=True)
            elif delta>5:self.continuous_start=now
            # Never bridge a hung/crashed sampler as invented active time.
            if 0<delta<=5 and now>before and admitted:
                for start,end in self.tracking.recording_ranges(max(before,now-delta),now,**context):
                    self.tracking.add_activity({'timeline':'computer','start':start,'end':end,'title':old_state,'group_name':old_state},merge=True)
                    if old_state=='Active' and metadata['application']:
                        title=metadata['title'] if settings['titles'] else ''
                        fields={k:metadata[k] for k in ['application','bundle','path']}
                        self.tracking.add_activity({'timeline':'applications','start':start,'end':end,'title':title or metadata['application'],'group_name':metadata['application'],**fields},merge=True)
                        document=(metadata['url'] or metadata['document']) if settings['titles'] else ''
                        if document:
                            host=self.tracking.hostname(document) if metadata['url'] else ''
                            self.tracking.add_activity({'timeline':'documents','start':start,'end':end,'title':metadata['title'] or document,'group_name':host or Path(document.removeprefix('file://')).name or document,'url':metadata['url'],'document':metadata['document'],**fields},merge=True)
        if state=='Away' and self.previous is not None and self.previous['state']=='Active' and self.previous['allowed'] and allowed:
            cutoff=max(self.continuous_start,now-float(sample.get('idle',0)))
            if cutoff<now:self.tracking.mark_idle(cutoff,now)
        self.previous={'state':state,'app':app,'allowed':allowed,'settings':policy};self.last=(now,mono)
        for image in sample.get('screenshots',[])[:12]:
            try:
                context=self.pending_captures.get(image.get('capture_id'))
                age=now-context['at'] if context else -1
                captured=finite(image.get('at'))
                if context and state=='Active' and permissions.get('screen_recording') is True and 0<=age<=20 and context['at']<=captured<=now+2 and context['settings']==policy and allowed and app==context['application'] and image.get('bundle')==app['bundle'] and self.tracking.recording_allowed(now,**{k:app[k] for k in ['application','bundle','url','document','title']},screenshots=True):
                    fields={k:app[k] for k in ['application','bundle','path']}
                    fields.update({k:app[k] if settings['titles'] else '' for k in ['title','url','document']})
                    self.tracking.add_screenshot({**image,**fields,'storage_id':context['storage']['id']})
                else:self.tracking.discard_unregistered_screenshot(image.get('file'),image.get('storage_id') or 'default')
            except Exception:
                try:self.tracking.discard_unregistered_screenshot(image.get('file'),image.get('storage_id') or 'default')
                except Exception:pass
                LOG.warning('A captured image could not be accepted')
        self.pending_captures={key:value for key,value in self.pending_captures.items() if 0<=now-value['at']<=20}
        if now-self.last_prune>=3600:
            self.tracking.prune(now);self.last_prune=now
        # Give the native collector one frame to apply record/title settings.
        # Otherwise a restart/resume could capture before AX metadata is ready.
        capture=bool(capture_ready and allowed and state=='Active' and permissions.get('screen_recording') is True and self.tracking.recording_allowed(now,**{k:app[k] for k in ['application','bundle','url','document','title']},screenshots=True) and now-self.last_capture>=settings['screenshot_interval'])
        capture_id=secrets.token_hex(16) if capture else ''
        if capture:
            self.last_capture=now
            self.pending_captures[capture_id]={'at':now,'application':dict(app),'settings':policy,'storage':self.tracking.screenshot_storage.current()}
        try:notices=self.tracking.clock.take_notices() if self.tracking.store.state['settings']['notifications'] else []
        except Exception:LOG.exception('Manual tag clock notices unavailable');notices=[]
        return {'record':allowed,'capture':capture,'capture_id':capture_id,'format':'png' if settings['screenshot_quality']=='original' else settings['screenshot_format'],'max_width':0 if settings['screenshot_quality']=='original' else 2560 if settings['screenshot_quality']=='high' else 1600,'quality':settings['screenshot_quality'],'storage':self.tracking.screenshot_storage.current(),'displays':settings['screenshot_displays'],'titles':settings['titles'],'notifications':notices}
    def run(self,stop,helper):
        from .platform_macos import native_samples,native_command
        delay=1
        while not stop.is_set():
            process=None
            try:
                if not Path(helper).is_file():raise RuntimeError('统计采样组件尚未安装')
                process=subprocess.Popen([str(helper),str(self.tracking.store.directory/'screenshots')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,start_new_session=True)
                self.last=None;self.previous=None;self.pending_captures.clear();self.last_capture=0
                for sample in native_samples(process,stop,lambda:None):
                    command=self.record(sample)
                    if not native_command(process,stop,command):break
                if not stop.is_set():raise RuntimeError('统计采样组件中断')
            except Exception as error:
                self.status.update(connected=False,error=str(error));LOG.warning('Tracking sampler unavailable: %s',error)
            finally:
                if process is not None:
                    if process.poll() is None:process.terminate()
                    try:process.wait(timeout=3)
                    except subprocess.TimeoutExpired:process.kill();process.wait(timeout=2)
                    process.stdin.close();process.stdout.close()
            if stop.wait(delay):break
            delay=min(30,delay*2)
