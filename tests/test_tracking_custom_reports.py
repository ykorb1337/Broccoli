import csv
import io
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile

from hotturkey.model import PolicyError
from hotturkey.store import Store
from hotturkey.tracking import TrackingStore,day_bounds
from hotturkey.tracking_reports import render,validate_definition,export_table,report_table,group_choices


class CustomReportTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(self.temp.name);self.t=TrackingStore(self.store)
        self.a,self.b=day_bounds('2026-10-28')
    def tearDown(self):self.t.close();self.store.db.close();self.temp.cleanup()
    def add(self,a,b,group='Editor',timeline='applications',**kw):
        return self.t.add_activity({'start':self.a+a,'end':self.a+b,'timeline':timeline,'group_name':group,'title':group,**kw})
    def tag(self,a,b,tags):return self.t.save_tag({'start':self.a+a,'end':self.a+b,'tags':tags})
    def report(self,definition,until=None):return render(self.t,self.a,until or self.b,definition)
    def test_top_includes_empty_dates_in_average(self):
        self.add(0,600)
        report=self.report({'type':'top','show_average':True},self.b+86400)
        self.assertEqual(report['buckets'],['2026-10-28','2026-10-29']);self.assertEqual(report['series'][0]['values'],[600,0]);self.assertEqual(report['series'][0]['average'],300)
    def test_zero_day_in_middle_is_not_removed(self):
        self.add(0,60);self.add(2*86400,2*86400+120)
        report=self.report({'type':'top'},self.b+2*86400)
        self.assertEqual(report['series'][0]['values'],[60,0,120])
    def test_empty_report_keeps_date_buckets_and_empty_series(self):
        report=self.report({'type':'top'},self.b+86400)
        self.assertEqual(len(report['buckets']),2);self.assertEqual(report['series'],[])
    def test_custom_series_can_compare_different_timelines(self):
        self.add(0,120);self.add(60,180,group='example.invalid',timeline='documents',url='https://example.invalid/page')
        report=self.report({'type':'custom','series':[{'name':'Writing','timeline':'applications','groups':['Editor']},{'name':'Web','timeline':'documents','groups':['example.invalid']}]})
        self.assertEqual([s['total'] for s in report['series']],[120,120])
    def test_tag_all_groups_matches_descendants_but_not_same_project_other_client(self):
        self.tag(0,60,['Client 1','Project 1']);self.tag(60,180,['Client 2','Project 1']);self.tag(180,240,['Client 1','Project 1','Activity'])
        report=self.report({'type':'custom','series':[{'timeline':'tags','groups':['Client 1','Project 1'],'match':'all'}]})
        self.assertEqual(report['series'][0]['total'],120)
    def test_tag_any_group_counts_interval_union_only_once(self):
        self.tag(0,120,['Client 1','Project 1']);self.tag(60,180,['Client 1','Project 2']);self.tag(180,240,['Client 2','Project 1'])
        report=self.report({'type':'custom','series':[{'timeline':'tags','groups':['Client 1','Project 1'],'match':'any'}]})
        self.assertEqual(report['series'][0]['total'],240)
    def test_series_query_and_global_query_both_apply(self):
        self.add(0,60,title='Draft One');self.add(60,180,title='Draft Two');self.add(180,300,title='Other Two')
        report=self.report({'type':'custom','query':'title:Draft','series':[{'timeline':'applications','query':'title:Two'}]})
        self.assertEqual(report['series'][0]['total'],120)
    def test_partial_date_range_is_clipped_before_grouping(self):
        self.add(0,600)
        report=render(self.t,self.a+120,self.a+300,{'type':'custom','series':[{'timeline':'applications'}]})
        self.assertEqual(report['series'][0]['values'],[180])
    def test_week_month_and_year_group_keys_keep_empty_periods(self):
        end=day_bounds('2027-01-02')[1]
        report=self.report({'type':'custom','group_by':'month','series':[{}]},end)
        self.assertEqual(report['buckets'],['2026-10','2026-11','2026-12','2027-01']);self.assertEqual(report['series'][0]['values'],[0,0,0,0])
        self.assertEqual(self.report({'type':'top','group_by':'year'},end)['buckets'],['2026','2027'])
    def test_top_one_and_top_hundred_preserve_rank_and_limit(self):
        for i in range(101):self.add(0,i+1,group='Application '+str(i))
        one=self.report({'type':'top','limit':1});self.assertEqual(one['series'][0]['total'],101)
        self.assertEqual(len(self.report({'type':'top','limit':100})['series']),100)
    def test_predefined_website_folder_includes_legacy_without_fabricating_url(self):
        self.add(0,60,'file.txt','documents',document='file:///file.txt');self.add(60,180,'site.invalid','documents',url='https://site.invalid/a')
        self.add(180,240,'old.invalid','documents',source='legacy',metadata={'kind':'website'})
        report=self.report({'type':'top','timeline':'documents','folder':'websites'})
        self.assertEqual({s['name'] for s in report['series']},{'site.invalid','old.invalid'})
        self.assertEqual(len(self.report({'type':'top','timeline':'documents','folder':'files'})['series']),1)
    def test_custom_folder_resolves_stable_identity(self):
        self.add(0,60);self.add(60,180,'Browser');folder=self.t.save_entity('folders',{'timeline':'applications','name':'Work','groups':['Editor']})
        report=self.report({'type':'top','folder':folder['id']});self.assertEqual([s['name'] for s in report['series']],['Editor'])
        with self.assertRaises(PolicyError):self.report({'type':'top','folder':'missing'})
    def test_saved_definition_survives_reopening_and_failed_edit_is_atomic(self):
        saved=self.t.save_entity('reports',{'name':'Projects','type':'custom','chart_type':'line','show_average':True,'series':[{'timeline':'tags','groups':['Client'],'match':'all'}]})
        with self.assertRaises(PolicyError):self.t.save_entity('reports',{'type':'custom','limit':0},saved['id'])
        self.t.close();self.t=TrackingStore(self.store)
        restored=self.t.entities('reports')[0];self.assertEqual(restored,saved)
        report=self.report(restored);self.assertEqual(report['chart_type'],'line');self.assertTrue(report['show_average'])
    def test_series_picker_lists_tag_parts_with_union_duration(self):
        self.tag(0,120,['Client','Project']);self.tag(60,180,['Client','Other'])
        choices=group_choices(self.t,self.a,self.b,'tags')
        self.assertEqual({v['name']:v['seconds'] for v in choices},{'Client':180,'Other':120,'Project':120})
    def test_editing_saved_chart_keeps_tab_order(self):
        first=self.t.save_entity('reports',{'name':'First'});second=self.t.save_entity('reports',{'name':'Second'})
        self.t.save_entity('reports',{'name':'Renamed'},first['id'])
        self.assertEqual([v['id'] for v in self.t.entities('reports')],[first['id'],second['id']])
    def test_daily_start_end_are_gaps_on_empty_dates(self):
        self.add(9*3600,9*3600+60,'Active','computer');self.add(17*3600,17*3600+60,'Active','computer')
        report=self.report({'type':'duration'},self.b+86400)
        self.assertEqual(report['series'][0]['values'],[9*3600,None]);self.assertEqual(report['series'][1]['values'],[17*3600+60,None]);self.assertEqual(report['series'][2]['values'],[8*3600+60,0])
    def test_attendance_uses_start_end_not_sum_of_active_seconds(self):
        self.add(9*3600,9*3600+60,'Active','computer');self.add(11*3600,11*3600+60,'Active','computer')
        report=self.report({'type':'attendance'},self.b+86400);self.assertEqual(report['series'][0]['values'],[1,0])
        self.assertEqual(report['series'][0]['average'],0.5)
    def test_attendance_threshold_zero_still_requires_activity(self):
        self.assertEqual(self.report({'type':'attendance','attendance_seconds':0})['series'][0]['values'],[0])
    def test_daily_report_query_is_not_silently_ignored(self):
        self.add(0,600,'Active','computer')
        report=self.report({'type':'duration','query':'-group:Active'})
        self.assertEqual(report['series'][0]['values'],[None]);self.assertEqual(report['series'][2]['values'],[0])
    def test_untagged_chart_matches_active_tag_intersection(self):
        self.add(0,600,'Active','computer');self.tag(0,120,['Project']);self.tag(60,180,['Other'])
        report=self.report({'type':'untagged'});self.assertEqual([v['values'] for v in report['series']],[[180],[420]])
    def test_invalid_definition_never_silently_changes_chart_kind(self):
        for definition in [{'type':[]},{'timeline':{}},{'group_by':[]},{'limit':True},{'show_average':1},{'series':[{'match':'all','timeline':'applications'}]},{'series':{}},{'series':[{'groups':'Editor'}]},{'unsupported':True}]:
            with self.subTest(definition=definition),self.assertRaises(PolicyError):validate_definition(definition)
    def test_export_uses_the_chart_table_without_recomputing_durations(self):
        self.add(0,60);report=self.report({'type':'top'},self.b+86400)
        rows=report_table(report);data,mime=export_table(rows,'csv');parsed=list(csv.reader(io.StringIO(data.decode('utf-8-sig'))))
        self.assertEqual(parsed[0],['日期','Editor（秒）']);self.assertEqual(parsed[1:],[[r[0],str(r[1])] for r in report['table']]);self.assertTrue(mime.startswith('text/csv'))


class ExportTests(unittest.TestCase):
    def test_csv_unicode_multiline_and_formula_text(self):
        data,_=export_table([['标题','秒'],['微信, 项目\n说明',123.5],['=HYPERLINK("https://invalid")',0],[' \t+SUM(1)',0]],'csv')
        rows=list(csv.reader(io.StringIO(data.decode('utf-8-sig'))));self.assertEqual(rows[1],['微信, 项目\n说明','123.5']);self.assertTrue(rows[2][0].startswith("'="));self.assertTrue(rows[3][0].startswith("'"))
    def test_xlsx_has_real_numeric_cells_and_literal_formula_text(self):
        data,mime=export_table([['名称','秒'],['=not-a-formula',180.5],['微信<&>\x01',0],['空',None]],'xlsx')
        ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        with zipfile.ZipFile(io.BytesIO(data)) as book:
            self.assertIsNone(book.testzip());root=ET.fromstring(book.read('xl/worksheets/sheet1.xml'))
            self.assertEqual(root.find('.//s:c[@r="A2"]',ns).attrib['t'],'inlineStr');self.assertEqual(root.find('.//s:c[@r="B2"]/s:v',ns).text,'180.5')
            self.assertEqual(root.find('.//s:c[@r="A3"]//s:t',ns).text,'微信<&>');self.assertEqual(root.findall('.//s:f',ns),[])
        self.assertTrue(mime.endswith('spreadsheetml.sheet'))
    def test_wide_xlsx_column_references_are_valid(self):
        data,_=export_table([list(range(100))],'xlsx')
        with zipfile.ZipFile(io.BytesIO(data)) as book:self.assertIn(b'r="CV1"',book.read('xl/worksheets/sheet1.xml'))
    def test_unknown_export_format_is_rejected(self):
        with self.assertRaises(PolicyError):export_table([['a']],'html')

if __name__=='__main__':unittest.main()
