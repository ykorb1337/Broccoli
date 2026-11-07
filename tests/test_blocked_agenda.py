import datetime as dt
import io
import json
import struct
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

from broccoli.blocked_agenda import agenda_from_cache, cached_agenda
from broccoli import native_host


class BlockedAgendaTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026,11,7,12,tzinfo=ZoneInfo('America/New_York'))
        self.key = json.dumps(['private@example.com','2026-11-01T00:00:00-05:00','2026-12-01T00:00:00-05:00'])
        self.event = {'id':'one','summary':'Deadline','start':{'date':'2026-11-07'},'end':{'date':'2026-11-08'},'description':'private description','location':'private location','attendees':[{'email':'private@example.com'}]}
        self.feed = {'synced_at':self.now.timestamp(),'items':[self.event]}

    def test_three_local_days_all_day_and_midnight_imports_only(self):
        self.feed['items'] += [
            {**self.event,'id':'span','summary':'Break','start':{'date':'2026-11-08'},'end':{'date':'2026-11-10'}},
            {**self.event,'id':'midnight','start':{'dateTime':'2026-11-07T05:00:00Z'},'end':{'dateTime':'2026-11-08T05:00:00Z'}},
            {**self.event,'id':'timed','start':{'dateTime':'2026-11-07T11:00:00-05:00'},'end':{'dateTime':'2026-11-07T12:00:00-05:00'}},
            {**self.event,'id':'outside','start':{'date':'2026-11-10'},'end':{'date':'2026-11-11'}},
        ]
        result=agenda_from_cache({self.key:self.feed},self.now)
        self.assertEqual([d['date'] for d in result['days']],['2026-11-07','2026-11-08','2026-11-09'])
        self.assertEqual(len(result['days'][0]['items']),2)
        self.assertNotIn('private',json.dumps(result))
        self.assertEqual(set(result['days'][0]['items'][0]),{'title','declined'})

    def test_latest_covering_feed_prevents_deleted_events_reappearing(self):
        newer=json.dumps(['private@example.com','2026-11-07T00:00:00-05:00','2026-11-08T00:00:00-05:00'])
        self.assertEqual(agenda_from_cache({self.key:{**self.feed,'synced_at':self.now.timestamp()-10},newer:{'synced_at':self.now.timestamp(),'items':[]}},self.now),{'days':[]})

    def test_cancelled_hidden_declined_struck_and_duplicates_removed(self):
        self.feed['items'] += [self.event,{**self.event,'id':'cancelled','status':'cancelled'}, {**self.event,'id':'declined','attendees':[{'self':True,'responseStatus':'declined'}]}]
        values=agenda_from_cache({self.key:self.feed},self.now)['days'][0]['items']
        self.assertEqual(len(values),2)
        self.assertEqual([v['declined'] for v in values],[False,True])

    def test_stale_malformed_and_incomplete_cache_is_silent(self):
        for cache in [None,[],{'bad':{}},{self.key:{**self.feed,'synced_at':self.now.timestamp()-86401}},{self.key:{**self.feed,'synced_at':float('nan')}},{self.key:{**self.feed,'items':None}}]:
            with self.subTest(cache=cache):self.assertEqual(agenda_from_cache(cache,self.now),{'days':[]})
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(cached_agenda(directory),{'days':[]})
            folder=Path(directory)/'google-calendar';folder.mkdir();(folder/'cache.json').write_text('{')
            self.assertEqual(cached_agenda(directory),{'days':[]})

    def test_bounded_titles_and_rows(self):
        self.feed['items']=[{**self.event,'id':str(n),'summary':'x'*1000} for n in range(50)]
        rows=agenda_from_cache({self.key:self.feed},self.now)['days'][0]['items']
        self.assertEqual(len(rows),20);self.assertEqual(len(rows[0]['title']),200)

    def test_setting_is_independent_of_overview_protection(self):
        from broccoli.store import Store
        from broccoli.engine import Engine
        from broccoli.management import settings_update
        from broccoli.model import PolicyError
        with tempfile.TemporaryDirectory() as directory:
            store=Store(directory)
            try:
                store.state['settings']['protect_overview']=True
                engine=Engine(store)
                updated=settings_update(engine,{'blocked_page_calendar':True})
                self.assertTrue(updated['blocked_page_calendar']);self.assertTrue(updated['protect_overview'])
                with self.assertRaises(PolicyError):settings_update(engine,{'blocked_page_calendar':'yes'})
            finally:store.db.close()

    def test_native_summary_never_returns_state_and_requires_own_opt_in(self):
        for enabled in [False,True]:
            with self.subTest(enabled=enabled),tempfile.TemporaryDirectory() as directory:
                path=Path(directory);(path/'connection.json').write_text(json.dumps({'port':1,'token':'private'}))
                state={'settings':{'protect_overview':True,'blocked_page_calendar':enabled,'settings_password':'private'},'blocks':[{'name':'private'}]}
                body=json.dumps({'op':'blocked-agenda','data':{'since':'arbitrary','directory':'/tmp'}}).encode();stream=io.BytesIO(struct.pack('<I',len(body))+body);out=io.BytesIO()
                response=io.BytesIO(json.dumps(state).encode())
                with patch.object(native_host,'default_data',return_value=path),patch.object(native_host.urllib.request,'urlopen',return_value=response) as request,patch('broccoli.blocked_agenda.cached_agenda',return_value={'days':[]}) as summary,patch.object(native_host.sys,'stdin',types.SimpleNamespace(buffer=stream)),patch.object(native_host.sys,'stdout',types.SimpleNamespace(buffer=out)):
                    native_host.main()
                payload=out.getvalue();result=json.loads(payload[4:]);self.assertEqual(result,{'days':[]})
                self.assertEqual(request.call_args.args[0].get_method(),'GET')
                self.assertEqual(summary.call_count,1 if enabled else 0)
