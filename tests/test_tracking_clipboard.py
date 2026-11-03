import csv,io,unittest
from tests import test_tracking_usage as fixture
from broccoli.tracking_clipboard import copy_rows
from broccoli.model import PolicyError


class ClipboardTests(unittest.TestCase):
    setUp=fixture.TimesheetUsageTests.setUp
    tearDown=fixture.TimesheetUsageTests.tearDown
    tag=fixture.TimesheetUsageTests.tag
    app=fixture.TimesheetUsageTests.app
    work=fixture.TimesheetUsageTests.work
    usage=fixture.TimesheetUsageTests.usage
    def test_selected_rows_keep_generated_sort_rounding_and_notes(self):
        self.tag(0,61,tags=['A'],notes='First\nSecond\tTabbed');self.tag(70,100,tags=['B'])
        w=self.work(total_by='none',round_minutes=5,include_unrounded=True,sort_by={'column':0,'descending':True})
        value=copy_rows(self.t,w['snapshot'],row_keys=[w['matrix'][1]['key']]);rows=list(csv.reader(io.StringIO(value['text']),delimiter='\t'))
        self.assertEqual(value['row_count'],1);self.assertEqual(rows[1],['A','0','61.0','First\nSecond\tTabbed'])
        self.tag(200,300,tags=['Later']);self.assertEqual(copy_rows(self.t,w['snapshot'])['row_count'],2)
    def test_usage_copy_includes_all_pages_and_safe_literal_cells(self):
        self.tag();self.app(0,10,title='=1+1');self.app(20,30,title='Next');u=self.usage(limit=1)
        value=copy_rows(self.t,u['snapshot'],'usage');rows=list(csv.reader(io.StringIO(value['text']),delimiter='\t'))
        self.assertEqual(value['row_count'],2);self.assertEqual(rows[1][0],"'=1+1");self.assertEqual(rows[2][0],'Next')
    def test_invalid_scope_and_wrong_snapshot_kind_are_rejected(self):
        self.tag();w=self.work()
        for kind,keys in [('wrong',None),('work',[]),('work',['missing']),('work','bad'),('usage',None)]:
            with self.assertRaises(PolicyError):copy_rows(self.t,w['snapshot'],kind,keys)
    def test_partial_autotag_errors_cannot_be_copied(self):
        self.tag();w=self.work();private=self.t.report_snapshots.get(w['snapshot'],'work');private['report']['errors']=[{}]
        token=self.t.report_snapshots.put('work',private)
        with self.assertRaises(PolicyError):copy_rows(self.t,token)
