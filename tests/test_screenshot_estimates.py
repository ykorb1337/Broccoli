import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from broccoli.store import Store
from broccoli.tracking import TrackingStore
from broccoli.screenshot_estimates import estimate

class ScreenshotEstimateTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=Store(self.tmp.name);self.t=TrackingStore(self.store)
        self.status={'displays':[{'id':'main','width':3000,'height':2000,'main':True},{'id':'external','width':1920,'height':1080,'main':False}]}
    def tearDown(self):self.t.close();self.store.db.close();self.tmp.cleanup()
    def test_resolution_only_estimates_have_explicit_basis_and_24_hour_multiplier(self):
        value=estimate(self.t,self.status);self.assertTrue(value['approximate']);self.assertEqual(value['basis'],'resolution');self.assertEqual(value['displays'],2)
        self.assertEqual(value['items'][0]['daily_bytes'],(3000*2000+1920*1080)*1440)
        sizes=[r['image_bytes'] for r in value['items']];self.assertGreater(sizes[0],sizes[1]);self.assertGreater(sizes[1],sizes[2])
    def test_interval_changes_recalculate_daily_budget(self):
        before=estimate(self.t,self.status);self.t.configure({'screenshot_interval':120});after=estimate(self.t,self.status)
        for a,b in zip(before['items'],after['items']):self.assertEqual(a['daily_bytes'],b['daily_bytes']*2);self.assertEqual(a['image_bytes'],b['image_bytes'])
    def test_main_display_excludes_other_displays(self):
        self.t.configure({'screenshot_displays':'main'});value=estimate(self.t,self.status);self.assertEqual(value['displays'],1);self.assertEqual(value['items'][0]['image_bytes'],6_000_000)
    def test_recent_sample_encodings_are_cached_without_modifying_original(self):
        folder=Path(self.tmp.name)/'screenshots/2026-11-01';folder.mkdir(parents=True,mode=0o700);folder.parent.chmod(0o700)
        source=folder/('a'*32+'.png');source.write_bytes(b'\x89PNG\r\n\x1a\nfixture');source.chmod(0o600)
        self.t.add_screenshot({'id':'a'*32,'at':1,'file':'2026-11-01/'+source.name,'width':3000,'height':2000})
        def encode(command,**kwargs):
            target=Path(command[-1]);target.write_bytes(b'x'*{'original':6000,'high':3000,'standard':1000}[target.stem])
        with patch('broccoli.screenshot_estimates.subprocess.run',side_effect=encode) as run:
            first=estimate(self.t,self.status);self.t.configure({'screenshot_interval':120});second=estimate(self.t,self.status);self.assertEqual(run.call_count,3)
        self.assertEqual(first['basis'],'recent');self.assertEqual(first['items'][0]['daily_bytes'],second['items'][0]['daily_bytes']*2);self.assertEqual(source.read_bytes(),b'\x89PNG\r\n\x1a\nfixture')
    def test_unavailable_encoder_uses_resolution_estimate(self):
        folder=Path(self.tmp.name)/'screenshots/2026-11-01';folder.mkdir(parents=True,mode=0o700);folder.parent.chmod(0o700)
        source=folder/('b'*32+'.png');source.write_bytes(b'fixture');source.chmod(0o600)
        self.t.add_screenshot({'id':'b'*32,'at':1,'file':'2026-11-01/'+source.name,'width':1000,'height':500})
        with patch('broccoli.screenshot_estimates.subprocess.run',side_effect=OSError):self.assertEqual(estimate(self.t,self.status)['basis'],'resolution')
    def test_unknown_display_dimensions_still_have_safe_fallback(self):
        value=estimate(self.t,{'displays':[{'width':-1,'height':400}]});self.assertEqual(value['displays'],1);self.assertGreater(value['items'][0]['daily_bytes'],0)

if __name__=='__main__':unittest.main()
