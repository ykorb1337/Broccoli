import base64
import importlib.util
import tempfile
import unittest
from pathlib import Path
from hotturkey.server import Service
from hotturkey.tracking import day_bounds

spec=importlib.util.spec_from_file_location('preview_today',Path(__file__).resolve().parent.parent/'scripts/preview_today.py')
preview=importlib.util.module_from_spec(spec);spec.loader.exec_module(preview)

class PreviewTodayTests(unittest.TestCase):
    def test_only_requested_day_is_copied_and_edits_stay_isolated(self):
        with tempfile.TemporaryDirectory() as src,tempfile.TemporaryDirectory() as dst:
            source=Service(src,enforce=False);target=Service(dst,enforce=False)
            try:
                a,b=day_bounds('2026-10-31')
                source.store.state['settings']['device_recovery_hash']='private-fixture';source.store.save()
                source.tracking.add_activity({'timeline':'applications','start':a-30,'end':a+30,'title':'Cross midnight','application':'Editor'})
                source.tracking.add_activity({'timeline':'applications','start':a-100,'end':a-60,'title':'Yesterday'})
                source.tracking.add_activity({'timeline':'documents','start':a+50,'end':b+30,'url':'https://example.org/','title':'Today'})
                source.tracking.save_tag({'start':a-10,'end':a+40,'tags':['Today']})
                source.tracking.configure({'titles':False})
                image=Path(src)/'screenshots/2026-10-31'/('a'*32+'.png')
                image.parent.parent.mkdir(mode=0o700);image.parent.mkdir(mode=0o700)
                image.write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='));image.chmod(0o600)
                source.tracking.add_screenshot({'id':'a'*32,'at':a+20,'file':'2026-10-31/'+image.name,'width':1,'height':1})
                original=[tuple(v) for v in source.tracking.db.execute('SELECT * FROM tracking_activities')]
                result=preview.copy_today(src,target,'2026-10-31')
                self.assertEqual(result['counts']['tracking_activities'],2)
                copied=target.tracking.screenshot_path('2026-10-31/'+image.name)
                self.assertEqual(copied.read_bytes(),image.read_bytes());self.assertNotEqual(copied.stat().st_ino,image.stat().st_ino)
                rows=target.tracking.activities(a,b,_derived=False)
                self.assertEqual([(r['start'],r['end']) for r in rows],[(a,a+30),(a+50,b)])
                self.assertEqual(target.tracking.tags(a,b)[0]['start'],a)
                self.assertFalse(target.tracking.settings()['titles'])
                self.assertEqual(target.store.state['blocks'],[])
                self.assertNotEqual(target.store.state['settings'].get('device_recovery_hash'),'private-fixture')
                target.tracking.delete_range(a,b,['applications','documents'])
                self.assertEqual([tuple(v) for v in source.tracking.db.execute('SELECT * FROM tracking_activities')],original)
                with self.assertRaises(ValueError):preview.copy_today(dst,target,'2026-10-31')
            finally:
                for service in [source,target]:
                    service.http.server_close();service.tracking.close();service.store.db.close();service.singleton.close()

if __name__=='__main__':unittest.main()
