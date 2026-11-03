import csv,io,json,tempfile,unittest,zipfile
from broccoli.model import PolicyError
from broccoli.store import Store
from broccoli.tracking import TrackingStore,day_bounds
from broccoli.tracking_export import export

class ActivityExportTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.store=Store(self.temp.name);self.t=TrackingStore(self.store);self.a,self.b=day_bounds('2026-10-31')
 def tearDown(self):self.t.close();self.store.db.close();self.temp.cleanup()
 def payload(self,format='json',**options):return {'format':format,'definition':{'since':self.a,'until':self.b,'timeline':'documents','query':'','untagged':False,**options}}
 def test_cross_date_second_precision_and_no_policy_changes(self):
  before=json.dumps(self.store.state,sort_keys=True)
  self.t.add_activity({'timeline':'documents','start':self.a-10,'end':self.a+10,'title':'before','url':'https://example.org/a'})
  self.t.add_activity({'timeline':'documents','start':self.a+20,'end':self.a+40,'title':'today','url':'https://example.org/b'})
  data,mime=export(self.t,self.payload(since=self.a-5,until=self.a+25));value=json.loads(data)
  self.assertEqual([(r['start'],r['end'],r['seconds']) for r in value['activities']],[(self.a-5,self.a+10,15),(self.a+20,self.a+25,5)])
  self.assertEqual(json.dumps(self.store.state,sort_keys=True),before);self.assertIn('json',mime)
 def test_full_export_has_no_page_limit_and_filters_names(self):
  for i in range(130):self.t.add_activity({'timeline':'documents','start':self.a+i*10,'end':self.a+i*10+5,'title':'GPT notes','document':'/work/GPT.docx','application':'Word'})
  value=json.loads(export(self.t,self.payload(query='GPT'))[0]);self.assertEqual(len(value['activities']),130)
  self.assertEqual(len(json.loads(export(self.t,self.payload(query='unmatched'))[0])['activities']),0)
 def test_csv_excel_and_formula_titles(self):
  self.t.add_activity({'timeline':'documents','start':self.a,'end':self.a+12,'title':'=1+1','document':'/work/note'})
  data,mime=export(self.t,self.payload('csv'));rows=list(csv.reader(io.StringIO(data.decode('utf-8-sig'))));self.assertEqual(rows[1][5],"'=1+1");self.assertEqual(rows[1][3],'12.0')
  data,mime=export(self.t,self.payload('xlsx'))
  with zipfile.ZipFile(io.BytesIO(data)) as book:self.assertIn('inlineStr',book.read('xl/worksheets/sheet1.xml').decode())
 def test_invalid_ranges_and_formats(self):
  for payload in [self.payload(until=self.a),self.payload(since=float('nan')),self.payload(timeline='bad'),self.payload('png')]:
   with self.assertRaises(PolicyError):export(self.t,payload)

if __name__=='__main__':unittest.main()
