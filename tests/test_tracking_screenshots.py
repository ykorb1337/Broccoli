import base64
import os
import sqlite3
import tempfile
import tracemalloc
import unittest
from pathlib import Path
from hotturkey.model import PolicyError
from hotturkey.store import Store
from hotturkey.tracking import TrackingStore,day_bounds
from hotturkey.tracking_recorder import TrackingRecorder

PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT+0AAAAASUVORK5CYII=')

class ScreenshotTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(self.temp.name);self.t=TrackingStore(self.store)
        self.a,self.b=day_bounds('2026-10-28');self.now=self.a+9*3600;self.mono=100
        self.r=TrackingRecorder(self.t,lambda:self.now,lambda:self.mono)
        self.front={'application':'Editor','bundle':'local.editor','path':'/Applications/Editor.app','title':'Draft','document':'file:///draft.txt'}
    def tearDown(self):self.t.close();self.store.db.close();self.temp.cleanup()
    def image(self,index=1,at=None,display='main',**kw):
        ident=f'{index:032x}';folder=self.store.directory/'screenshots/2026-10-28';folder.mkdir(parents=True,exist_ok=True,mode=0o700);folder.parent.chmod(0o700)
        path=folder/(ident+'.png');path.write_bytes(PNG);path.chmod(0o600)
        return {'id':ident,'at':self.now if at is None else at,'file':'2026-10-28/'+path.name,'display':display,'width':1,'height':1,'application':'Editor','bundle':'local.editor','title':'Draft',**kw}
    def sample(self,delta=1,**kwargs):
        self.now+=delta;self.mono+=delta
        return self.r.record({'front':self.front,'idle':0,'permissions':{'screen_recording':True},**kwargs})
    def start(self):self.t.configure({'screenshots_enabled':True});self.sample();return self.sample()
    def test_capture_waits_for_recording_metadata_warmup(self):
        self.t.configure({'screenshots_enabled':True});first=self.sample();second=self.sample()
        self.assertFalse(first['capture']);self.assertTrue(second['capture']);self.assertTrue(second['capture_id'])
    def test_screenshot_regex_does_not_hold_recording_lock(self):
        import threading
        from unittest.mock import patch
        self.t.add_screenshot(self.image());self.t.add_screenshot(self.image(index=2))
        entered=threading.Event();release=threading.Event();errors=[]
        def slow(pattern,values,**kwargs):entered.set();release.wait(2);return {value:['Draft'] for value in values}
        def read():
            try:self.t.screenshots(self.a,self.b,query=r'#"Draft"')
            except Exception as error:errors.append(error)
        with patch('hotturkey.tracking_search.REGEX.match',side_effect=slow):
            thread=threading.Thread(target=read);thread.start()
            try:
                self.assertTrue(entered.wait(1));self.assertTrue(self.t.lock.acquire(timeout=.2));self.t.lock.release()
                self.t.add_activity({'timeline':'applications','start':self.a,'end':self.a+1,'title':'Still recording'})
            finally:release.set();thread.join(2)
        self.assertFalse(errors)
    def test_capture_matches_issued_context_and_keeps_document(self):
        command=self.start();image=self.image(capture_id=command['capture_id']);self.sample(screenshots=[image])
        rows=self.t.screenshots(self.a,self.b);self.assertEqual(len(rows),1);self.assertEqual(rows[0]['document'],'file:///draft.txt');self.assertEqual(rows[0]['path'],'/Applications/Editor.app')
    def test_browser_url_and_title_use_matching_foreground_context(self):
        self.front={'application':'Edge','bundle':'com.microsoft.edgemac','path':'/Applications/Edge.app','title':'Native window','document':''}
        self.r.browser_sample('Edge',{'active':True,'url':'https://example.invalid/a','title':'Page title'})
        command=self.start();image=self.image(capture_id=command['capture_id'],bundle=self.front['bundle']);self.sample(screenshots=[image])
        row=self.t.screenshots(self.a,self.b,query='url:example.invalid')[0];self.assertEqual(row['title'],'Page title');self.assertEqual(row['url'],'https://example.invalid/a')
    def test_same_browser_bundle_with_new_url_discards_old_capture(self):
        self.front={'application':'Edge','bundle':'com.microsoft.edgemac'};self.r.browser_sample('Edge',{'active':True,'url':'https://one.invalid','title':'Same'})
        command=self.start();image=self.image(capture_id=command['capture_id'],bundle=self.front['bundle']);self.r.browser_sample('Edge',{'active':True,'url':'https://two.invalid','title':'Same'});self.sample(screenshots=[image])
        self.assertEqual(self.t.screenshots(self.a,self.b),[]);self.assertFalse((self.store.directory/'screenshots'/image['file']).exists())
    def test_unknown_capture_nonce_is_not_accepted(self):
        self.start();image=self.image(capture_id='not-issued');self.sample(screenshots=[image]);self.assertEqual(self.t.screenshots(self.a,self.b),[])
        self.assertFalse((self.store.directory/'screenshots'/image['file']).exists())
    def test_privacy_change_discards_in_flight_image(self):
        command=self.start();image=self.image(capture_id=command['capture_id']);self.t.configure({'titles':False});self.sample(screenshots=[image])
        self.assertEqual(self.t.screenshots(self.a,self.b),[])
    def test_titles_off_never_store_url_title_or_document(self):
        self.t.configure({'titles':False});command=self.start();image=self.image(capture_id=command['capture_id']);self.sample(screenshots=[image])
        row=self.t.screenshots(self.a,self.b)[0];self.assertEqual([row[k] for k in ['title','url','document']],['','',''])
    def test_expired_capture_is_removed(self):
        command=self.start();image=self.image(capture_id=command['capture_id']);self.sample(delta=21,screenshots=[image]);self.assertEqual(self.t.screenshots(self.a,self.b),[])
    def test_malformed_capture_metadata_cleans_unregistered_file(self):
        command=self.start();image=self.image(capture_id=command['capture_id'],at='invalid')
        with self.assertLogs('hotturkey',level='WARNING'):self.sample(screenshots=[image])
        self.assertFalse((self.store.directory/'screenshots'/image['file']).exists())
    def test_replayed_capture_cannot_delete_registered_image(self):
        command=self.start();image=self.image(capture_id=command['capture_id']);self.sample(screenshots=[image]);image['capture_id']='expired'
        self.sample(screenshots=[image]);self.assertEqual(len(self.t.screenshots(self.a,self.b)),1);self.assertTrue((self.store.directory/'screenshots'/image['file']).exists())
    def test_permission_grant_resets_capture_interval(self):
        self.t.configure({'screenshots_enabled':True});self.sample(permissions={'screen_recording':False});first=self.sample(permissions={'screen_recording':False});self.assertTrue(first['capture'])
        second=self.sample(permissions={'screen_recording':True});self.assertTrue(second['capture'])
    def test_sampler_capture_errors_are_reported_without_stopping_tracking(self):
        self.sample(capture_error='Unavailable format');self.assertEqual(self.r.status['screenshot_error'],'Unavailable format');self.assertTrue(self.r.status['connected'])
    def test_viewer_preferences_do_not_drop_tracking_or_pending_capture(self):
        command=self.start();before=self.t.activities(self.a,self.b,'applications')[0]['seconds'];image=self.image(capture_id=command['capture_id']);self.t.configure({'viewer_open':True,'viewer_dock':'bottom'})
        self.sample(screenshots=[image]);self.assertEqual(len(self.t.screenshots(self.a,self.b)),1)
        self.assertEqual(self.t.activities(self.a,self.b,'applications')[0]['seconds']-before,1)
    def test_full_browser_url_is_kept_without_stopping_recording(self):
        self.front={'application':'Edge','bundle':'com.microsoft.edgemac'};url='https://example.invalid/'+'x'*6000
        self.r.browser_sample('Edge',{'active':True,'url':url,'title':'Long URL'})
        command=self.start();image=self.image(capture_id=command['capture_id'],bundle='com.microsoft.edgemac');self.sample(screenshots=[image])
        self.assertEqual(self.t.activities(self.a,self.b,'documents')[0]['url'],url);self.assertEqual(self.t.screenshots(self.a,self.b)[0]['url'],url)
    def test_retention_removes_old_registered_images_but_keeps_recent_ones(self):
        old=self.image(1,at=self.a-8*86400);recent=self.image(2,at=self.a);self.t.add_screenshot(old);self.t.add_screenshot(recent)
        self.t.prune(self.a)
        self.assertFalse((self.store.directory/'screenshots'/old['file']).exists());self.assertTrue((self.store.directory/'screenshots'/recent['file']).exists())
        self.assertEqual([v['id'] for v in self.t.screenshots(self.a-10*86400,self.b)],[recent['id']])
    def test_nearest_query_and_navigation_are_filter_consistent(self):
        for index,offset,app in [(1,0,'Editor'),(2,60,'Browser'),(3,120,'Editor')]:self.t.add_screenshot(self.image(index,at=self.a+offset,application=app))
        nearest=self.t.screenshots(self.a,self.b,at=self.a+70,query='app:Editor',limit=1)
        self.assertEqual(nearest[0]['id'],f'{3:032x}')
        previous=self.t.screenshots(self.a,self.b,at=self.a+120,query='app:Editor',direction='previous',limit=1)
        self.assertEqual(previous[0]['id'],f'{1:032x}')
    def test_displays_are_separate_and_metadata_survives_reopen(self):
        for index,display in [(1,'main'),(2,'external')]:self.t.add_screenshot(self.image(index,display=display,url='https://example.invalid'))
        self.assertEqual(self.t.screenshot_displays(self.a,self.b),[{'id':'external','count':1},{'id':'main','count':1}])
        self.t.close();self.t=TrackingStore(self.store)
        rows=self.t.screenshots(self.a,self.b,display='main');self.assertEqual(len(rows),1);self.assertEqual(rows[0]['url'],'https://example.invalid')
    def test_navigation_options_are_strict(self):
        for kwargs in [{'direction':'random'},{'direction':'next'},{'limit':True},{'limit':501}]:
            with self.subTest(kwargs=kwargs),self.assertRaises(PolicyError):self.t.screenshots(self.a,self.b,**kwargs)
        with self.assertRaises(PolicyError):self.t.screenshots(self.a,self.b,query='"unfinished')
    def test_location_requires_registered_private_file(self):
        value=self.image();self.t.add_screenshot(value);self.assertEqual(self.t.screenshot_location(value['id']),{'file':value['file']})
        (self.store.directory/'screenshots'/value['file']).chmod(0o644)
        with self.assertRaises(PolicyError):self.t.screenshot_location(value['id'])
    def test_symlinks_hardlinks_and_traversal_are_rejected(self):
        value=self.image();original=self.store.directory/'screenshots'/value['file'];other=original.with_name('f'*32+'.png');original.rename(other);original.symlink_to(other)
        with self.assertRaises(PolicyError):self.t.add_screenshot(value)
        original.unlink();os.link(other,original)
        with self.assertRaises(PolicyError):self.t.add_screenshot(value)
        for path in ['../private.png','2026-10-28/../../private.png','/tmp/file.png']:
            with self.assertRaises(PolicyError):self.t.screenshot_path(path)
    def test_delete_removes_bytes_and_metadata_without_touching_policy(self):
        value=self.image();self.t.add_screenshot(value);self.store.charge(self.now,'rule',31)
        self.assertEqual(self.t.delete_screenshots([value['id']])['deleted'],1);self.assertFalse((self.store.directory/'screenshots'/value['file']).exists());self.assertEqual(self.store.used('rule',0),31)
    def test_nearest_unfiltered_query_fetches_only_needed_rows(self):
        for index in range(100):self.t.db.execute('INSERT INTO tracking_screenshots(id,at,display,file,width,height,application,bundle,title) VALUES(?,?,?,?,?,?,?,?,?)',(f'{index:032x}',self.a+index,'main',f'2026-10-28/{index:032x}.png',1,1,'Editor','',''))
        self.t.db.commit();visited=[]
        def factory(cursor,row):visited.append(1);return sqlite3.Row(cursor,row)
        self.t.db.row_factory=factory
        try:rows=self.t.screenshots(self.a,self.b,at=self.a+50,limit=3)
        finally:self.t.db.row_factory=sqlite3.Row
        self.assertEqual(len(rows),3);self.assertLessEqual(len(visited),5)
    def test_filtered_catalog_does_not_materialize_all_image_metadata(self):
        self.t.db.executemany('INSERT INTO tracking_screenshots(id,at,display,file,width,height,application,bundle,title) VALUES(?,?,?,?,?,?,?,?,?)',[(f'{i:032x}',self.a+i,'main',f'2026-10-28/{i:032x}.png',1,1,'Editor','','x'*2000+('rare' if i==2499 else '')) for i in range(2500)]);self.t.db.commit()
        tracemalloc.start()
        try:rows=self.t.screenshots(self.a,self.b,at=self.a,query='title:rare',limit=1);peak=tracemalloc.get_traced_memory()[1]
        finally:tracemalloc.stop()
        self.assertEqual(len(rows),1);self.assertLess(peak,2*1024*1024)

if __name__=='__main__':unittest.main()
