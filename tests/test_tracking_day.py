import copy,json,tempfile,unittest
from broccoli.tracking_day import display_runs
from broccoli.tracking import TrackingStore,day_bounds
from broccoli.store import Store


class DisplayRunTests(unittest.TestCase):
    def row(self,a,b,**value):return {'id':str(a),'timeline':'applications','source':'legacy','title':'Editor','group_name':'Editor','application':'Editor','start':a,'end':b,'seconds':b-a,'metadata':{'precision':'aggregate'},**value}
    def test_thousands_of_continuous_samples_become_one_exact_period(self):
        rows=[self.row(i*1.5,(i+1)*1.5) for i in range(10000)];before=copy.deepcopy(rows);out=display_runs(rows)
        self.assertEqual(len(out),1);self.assertEqual(out[0]['seconds'],15000);self.assertEqual(out[0]['sample_count'],10000);self.assertEqual(rows,before)
    def test_real_gaps_are_never_filled(self):
        out=display_runs([self.row(0,1),self.row(1.02,2),self.row(3,4)])
        self.assertEqual(len(out),3);self.assertAlmostEqual(sum(v['seconds'] for v in out),2.98)
    def test_application_title_metadata_and_source_changes_split_periods(self):
        for key,value in [('title','Other'),('application','Other'),('metadata',{'precision':'other'}),('source','recorded')]:
            with self.subTest(key=key):self.assertEqual(len(display_runs([self.row(0,1),self.row(1,2,**{key:value})])),2)
    def test_other_timeline_does_not_break_a_continuous_application_period(self):
        rows=[self.row(0,1),self.row(.5,1.5,timeline='documents'),self.row(1,2)]
        out=display_runs(rows);self.assertEqual(len(out),2);self.assertEqual(next(v for v in out if v['timeline']=='applications')['seconds'],2)
    def test_an_intervening_application_is_not_merged_away(self):
        self.assertEqual(len(display_runs([self.row(0,1),self.row(1,2,title='Other'),self.row(2,3)])),3)
    def test_overlapping_legacy_samples_are_not_silently_rewritten(self):
        self.assertEqual(len(display_runs([self.row(0,2),self.row(1,3)])),2)
    def test_day_compacts_display_but_preserves_raw_database_policy_and_time(self):
        with tempfile.TemporaryDirectory() as directory:
            s=Store(directory);t=TrackingStore(s);a,b=day_bounds('2026-10-29');before=json.dumps(s.state,sort_keys=True)
            try:
                for i in range(200):t.add_activity({**self.row(a+i,a+i+1),'metadata':{'precision':'aggregate'}})
                day=t.day('2026-10-29');self.assertEqual(len(day['details']),1);self.assertEqual(day['details'][0]['seconds'],200)
                self.assertEqual(day['summary'][0]['seconds'],200);self.assertEqual(len(day['filtered_ids']),1)
                self.assertEqual(t.db.execute('SELECT count(*) FROM tracking_activities').fetchone()[0],200);self.assertEqual(json.dumps(s.state,sort_keys=True),before)
            finally:t.close();s.db.close()
