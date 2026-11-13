import copy
import tempfile
import unittest
from unittest.mock import patch

from broccoli.model import PolicyError
from broccoli.store import Store
from broccoli.tracking import TrackingStore
from broccoli.tracking_day import display_runs
from broccoli.tracking_record_actions import delete_records, reveal_record


class RecordActionsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(self.temp.name)
        self.tracking = TrackingStore(self.store)

    def tearDown(self):
        self.tracking.close()
        self.store.db.close()
        self.temp.cleanup()

    def activity(self, timeline='documents', start=100, end=200, **extra):
        return self.tracking.add_activity({'timeline': timeline, 'start': start, 'end': end, **extra})

    def test_delete_identity_preserves_simultaneous_other_records_and_policy(self):
        selected = self.activity(title='selected')
        other = self.activity(title='other')
        application = self.activity('applications')
        before = copy.deepcopy(self.store.state)
        self.store.charge(100, 'rule', 15)
        delete_records(self.tracking, [{'timeline': 'documents', 'id': selected, 'ranges': [[120, 130], [150, 170]]}])
        rows = self.tracking.activities(1, 300, _derived=False)
        self.assertEqual(sum(row['seconds'] for row in rows if row['title'] == 'selected'), 70)
        self.assertEqual({row['id'] for row in rows if row['id'] in (other, application)}, {other, application})
        self.assertEqual(before, self.store.state)
        self.assertEqual(self.store.used('rule', 0), 15)

    def test_partial_day_and_retry_preserve_outside_range(self):
        selected = self.activity(start=50, end=250)
        request = [{'timeline': 'documents', 'id': selected, 'ranges': [[100, 200]]}]
        self.assertEqual(delete_records(self.tracking, request)['count'], 1)
        self.assertEqual(delete_records(self.tracking, request)['count'], 0)
        self.assertEqual([(row['start'], row['end']) for row in self.tracking.activities(1, 300, _derived=False)], [(50, 100), (200, 250)])

    def test_validation_is_atomic_and_timeline_cannot_delete_other_kind(self):
        selected = self.activity()
        request = [{'timeline': 'documents', 'id': selected, 'ranges': [[100, 200]]}]
        with self.assertRaises(PolicyError):
            delete_records(self.tracking, request + [{'timeline': 'documents', 'id': selected, 'ranges': [[150, 100]]}])
        delete_records(self.tracking, [{'timeline': 'applications', 'id': selected, 'ranges': [[100, 200]]}])
        self.assertEqual(len(self.tracking.activities(1, 300, _derived=False)), 1)

    def test_tag_cut_preserves_other_tags_and_override(self):
        selected = self.tracking.save_tag({'start': 100, 'end': 200, 'tags': ['Selected'], 'auto_override': True})['ids'][0]
        other = self.tracking.save_tag({'start': 100, 'end': 200, 'tags': ['Other']})['ids'][0]
        delete_records(self.tracking, [{'timeline': 'tags', 'id': selected, 'ranges': [[120, 180]]}])
        tags = self.tracking.tags(1, 300)
        self.assertEqual(next(row['seconds'] for row in tags if row['id'] == other), 100)
        self.assertTrue(all(row['auto_override'] for row in tags if row['tags'] == ['Selected']))
        self.assertEqual(sum(row['seconds'] for row in tags if row['tags'] == ['Selected']), 40)

    def test_legacy_display_run_retains_all_underlying_identities(self):
        first = self.activity(start=100, end=110, source='legacy')
        second = self.activity(start=110, end=120, source='legacy')
        rows = display_runs(self.tracking.activities(1, 300, _derived=False))
        self.assertEqual(rows[0]['activity_ids'], [first, second])
        delete_records(self.tracking, [{'timeline': 'documents', 'id': ident, 'ranges': [[100, 120]]} for ident in rows[0]['activity_ids']])
        self.assertEqual(self.tracking.activities(1, 300, _derived=False), [])

    def test_reveal_uses_recorded_local_file_and_never_opens_web_or_application(self):
        from pathlib import Path
        path = Path(self.temp.name) / 'report file.pdf'
        path.write_text('fixture')
        local = self.activity(url=path.as_uri())
        web = self.activity(url='https://example.org/file.pdf')
        app = self.activity('applications', document=str(path))
        with patch('broccoli.tracking_record_actions.subprocess.run') as launch:
            reveal_record(self.tracking, local)
            self.assertEqual(launch.call_args.args[0], ['/usr/bin/open', '-R', str(path)])
            for ident in (web, app, 'missing'):
                with self.assertRaises(PolicyError):
                    reveal_record(self.tracking, ident)
            self.assertEqual(launch.call_count, 1)


if __name__ == '__main__':
    unittest.main()
