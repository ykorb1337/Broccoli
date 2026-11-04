import copy
import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

from broccoli.calendar_reminders import CalendarReminders, reminders_for
from broccoli.management import settings_update
from broccoli.engine import Engine
from broccoli.model import PolicyError
from broccoli.store import Store
from broccoli.server import Service

UTC = dt.timezone.utc


class CalendarReminderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(self.tmp.name)
        self.store.state['settings'].update(calendar_notifications=True, calendar_reminder_minutes=[10, 30])
        self.now = dt.datetime(2026, 11, 3, 13, tzinfo=UTC).timestamp()
        self.event = {'id': 'instance', 'summary': 'Study', 'start': {'dateTime': '2026-11-03T14:00:00Z'},
                      'end': {'dateTime': '2026-11-03T15:00:00Z'}, 'reminders': {'useDefault': True}}
        self.calendar = {'id': 'work', 'timeZone': 'America/New_York', 'selected': True}
        self.sent, self.calls, self.fail, self.connected = [], [], False, True
        case = self
        class Client:
            def status(self):return {'connected': case.connected}
            def calendars(self):return {'items': [case.calendar]}
            def events(self, calendar, since, until, *, cache):
                case.assertFalse(cache, 'background reads must not replace the interactive cache')
                case.calls.append((calendar, since, until))
                if case.fail:raise PolicyError('offline')
                return {'items': [copy.deepcopy(case.event)], 'timeZone': 'America/New_York'}
        self.client = Client()
        self.worker = self.make_worker()

    def make_worker(self, sender=None):
        return CalendarReminders(self.store, lambda: self.client, sender or self.sent.append, lambda: self.now)

    def tearDown(self):
        self.store.db.close()
        self.tmp.cleanup()

    def advance(self, seconds):
        self.now += seconds
        self.worker.tick()

    def test_multiple_defaults_fire_once_across_restart(self):
        self.worker.tick()
        self.advance(1800)
        self.assertEqual(len(self.sent), 1)
        self.assertIn('30 分钟后', self.sent[0])
        self.worker = self.make_worker()
        self.worker.tick()
        self.assertEqual(len(self.sent), 1)
        self.advance(1200)
        self.assertEqual(len(self.sent), 2)
        self.assertIn('10 分钟后', self.sent[-1])
        self.worker.tick()
        self.assertEqual(len(self.sent), 2)

    def test_event_custom_popup_overrides_defaults_and_email_is_not_local(self):
        self.event['reminders'] = {'useDefault': False, 'overrides': [{'method': 'popup', 'minutes': 5}, {'method': 'email', 'minutes': 30}]}
        self.worker.tick()
        self.advance(1800)
        self.assertEqual(self.sent, [])
        self.advance(1500)
        self.assertEqual(len(self.sent), 1)
        self.assertIn('5 分钟后', self.sent[0])

    def test_explicit_none_empty_defaults_and_zero_minutes(self):
        self.event['reminders'] = {'useDefault': False}
        self.worker.tick()
        self.advance(3600)
        self.assertEqual(self.sent, [])
        self.event['reminders'] = {'useDefault': True}
        self.store.state['settings']['calendar_reminder_minutes'] = []
        self.worker.tick()
        self.assertEqual(self.sent, [])
        self.store.state['settings']['calendar_reminder_minutes'] = [0]
        self.worker.tick()
        self.assertEqual(len(self.sent), 1)
        self.assertIn('即将开始', self.sent[0])

    def test_disabled_master_or_calendar_sends_nothing_and_does_not_fetch(self):
        for key in ['notifications', 'calendar_notifications']:
            self.store.state['settings'][key] = False
            self.worker.tick()
            self.assertEqual(self.calls, [])
            self.store.state['settings'][key] = True

    def test_cancel_decline_and_unselected_calendar(self):
        for field, value in [('status', 'cancelled'), ('attendees', [{'self': True, 'responseStatus': 'declined'}])]:
            event = {**self.event, field: value}
            self.assertEqual(reminders_for(self.calendar, event, [10]), [])
        event = {**self.event, 'attendees': [{'self': False, 'responseStatus': 'declined'}]}
        self.assertEqual(len(reminders_for(self.calendar, event, [10])), 1)
        self.calendar['selected'] = False
        self.worker.tick()
        self.assertEqual(self.calls, [])

    def test_all_day_uses_calendar_zone_and_dst_and_keeps_event_unchanged(self):
        event = {'id': 'day', 'start': {'date': '2026-11-01'}, 'end': {'date': '2026-11-02'}}
        before = copy.deepcopy(event)
        first = reminders_for(self.calendar, event, [10])[0]
        event['start']['date'] = '2026-11-02'
        second = reminders_for(self.calendar, event, [10])[0]
        self.assertEqual(second['start'] - first['start'], 25 * 3600)
        self.assertEqual(first['start'] - first['at'], 600)
        self.assertTrue(first['all_day'])
        self.assertEqual(before['start']['date'], '2026-11-01')

    def test_reschedule_invalidates_old_time_and_deduplicates_each_instance(self):
        self.worker.tick()
        self.event['start']['dateTime'] = '2026-11-03T15:00:00Z'
        self.worker.invalidate()
        self.advance(1800)
        self.assertEqual(self.sent, [])
        self.advance(3600)
        self.assertEqual(len(self.sent), 1)
        old = reminders_for(self.calendar, self.event, [30])[0]['id']
        self.assertNotEqual(old, reminders_for(self.calendar, {**self.event, 'id': 'second-instance'}, [30])[0]['id'])

    def test_temporary_offline_uses_recent_plan_but_not_day_old_cache(self):
        self.worker.tick()
        self.fail = True
        self.advance(1800)
        self.assertEqual(len(self.sent), 1)
        self.worker = self.make_worker()
        self.advance(1200)
        self.assertEqual(len(self.sent), 2)
        self.now += 86401
        self.worker.tick()
        self.assertEqual(len(self.sent), 2)

    def test_startup_does_not_replay_old_reminders(self):
        self.now += 3000 + 121
        self.worker.tick()
        self.assertEqual(self.sent, [])

    def test_delivery_failure_retries_without_marking_sent(self):
        def fail(_):raise OSError('not ready')
        self.worker = self.make_worker(fail)
        self.worker.tick()
        self.advance(1800)
        self.assertEqual(self.worker.sent, {})
        self.worker.sender = self.sent.append
        self.advance(1)
        self.assertEqual(self.sent, [])
        self.advance(30)
        self.assertEqual(len(self.sent), 1)

    def test_disconnect_clears_cached_reminders(self):
        self.worker.tick()
        self.connected = False
        self.advance(1800)
        self.assertEqual(self.sent, [])
        self.assertEqual(json.loads(self.worker.path.read_text())['plan'], [])

    def test_invalidated_inflight_fetch_cannot_restore_old_plan(self):
        original = self.client.events
        def interrupted(*args, **kwargs):
            value = original(*args, **kwargs)
            self.worker.invalidate()
            return value
        self.client.events = interrupted
        self.worker.tick()
        self.assertEqual(self.worker.plan, [])

    def test_damaged_reminder_cache_cannot_stop_the_policy_service(self):
        self.worker.path.parent.mkdir(exist_ok=True)
        for value in ['[1]', '{"plan":"wrong"}', '{"plan":[{"at":"wrong"}]}']:
            self.worker.path.write_text(value)
            worker = self.make_worker()
            self.assertEqual(worker.plan, [])
            worker.tick()
            self.assertTrue(worker.plan)

    def test_settings_validation_and_locks_are_independent(self):
        engine = Engine(self.store)
        before = copy.deepcopy(self.store.state['blocks'])
        updated = settings_update(engine, {'calendar_reminder_minutes': [30, 0, 10, 10], 'calendar_notifications': True})
        self.assertEqual(updated['calendar_reminder_minutes'], [0, 10, 30])
        self.assertEqual(self.store.state['blocks'], before)
        for value in ['10,30', [True], [-1], [1.5], [40321], list(range(21))]:
            with self.subTest(value=value), self.assertRaises(PolicyError):
                settings_update(engine, {'calendar_reminder_minutes': value})
        with self.assertRaises(PolicyError):settings_update(engine, {'calendar_notifications': 'yes'})


class ReminderServiceTests(unittest.TestCase):
    def test_preview_never_sends_native_notification(self):
        with tempfile.TemporaryDirectory() as directory:
            service = Service(directory)
            try:
                notices = []
                service.calendar_reminders.sender = notices.append
                with self.assertRaises(PolicyError):
                    service.api('/api/google-calendar/reminders/test', 'POST', {}, {}, {})
                self.assertEqual(notices, [])
                self.assertFalse(service.api('/api/state', 'GET', {}, {}, {})['calendar_reminders']['enabled'])
            finally:
                service.http.server_close()
                service.tracking.close()
                service.store.db.close()
                service.singleton.close()
