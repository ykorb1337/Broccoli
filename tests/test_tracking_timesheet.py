import copy
import csv
import datetime as dt
import io
import json
import os
import tempfile
import time
import unittest
from hotturkey.model import PolicyError
from hotturkey.store import Store
from hotturkey.tracking import TrackingStore,day_bounds
from hotturkey.tracking_timesheet import render,validate,table
from hotturkey.tracking_reports import export_table


class TimesheetTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(self.temp.name);self.t=TrackingStore(self.store);self.a,self.b=day_bounds('2026-10-29')
    def tearDown(self):self.t.close();self.store.db.close();self.temp.cleanup()
    def tag(self,start=0,end=180,**value):return self.t.save_tag({'start':self.a+start,'end':self.a+end,'tags':['Client','Project','Design'],**value})
    def report(self,**definition):return render(self.t,self.a,self.b,definition)
    def test_defaults_create_a_date_matrix_and_numeric_export(self):
        self.tag();r=self.report();self.assertEqual(r['matrix'][0]['groups'],['Client, Project, Design']);self.assertEqual(r['matrix'][0]['seconds'],180)
        self.assertEqual(table(r),[['标签','2026-10-29（秒）','合计（秒）','备注'],['Client, Project, Design',180,180,'']])
    def test_second_level_is_second_field_not_first_two_levels(self):
        self.tag();self.tag(200,300,tags=['Other client','Project','Testing']);r=self.report(group_fields=['level:2'])
        self.assertEqual(len(r['matrix']),1);self.assertEqual(r['matrix'][0]['groups'],['Project']);self.assertEqual(r['seconds'],280)
        self.assertEqual(self.report(group_fields=['prefix:2'])['matrix'][0]['groups'],['Client, Project'])
    def test_missing_level_is_explicit_and_not_lost(self):
        self.tag(tags=['Client']);r=self.report(group_fields=['level:2']);self.assertEqual(r['matrix'][0]['groups'],['（无此级标签）']);self.assertEqual(r['seconds'],180)
    def test_multiple_fields_group_before_aggregation(self):
        self.tag(notes='Design');self.tag(200,300,tags=['Other','Project','Testing'],notes='Testing')
        r=self.report(group_fields=['level:2','note']);self.assertEqual([v['groups'] for v in r['matrix']],[['Project','Design'],['Project','Testing']])
    def test_repeated_notes_are_included_once_across_dates(self):
        self.tag(notes='Shared');self.tag(86400,86500,notes='Shared');r=render(self.t,self.a,self.b+86400,{})
        self.assertEqual(r['matrix'][0]['notes'],'Shared')
    def test_notes_can_be_hidden_without_removing_note_grouping(self):
        self.tag(notes='Private note');r=self.report(include_notes=False,group_fields=['note'])
        self.assertEqual(r['matrix'][0]['groups'],['Private note']);self.assertEqual(r['matrix'][0]['notes'],'');self.assertNotIn('备注',[v['name'] for v in r['columns']][1:])
    def test_overlaps_within_group_are_counted_once(self):
        self.tag(0,100);self.tag(50,150);self.assertEqual(self.report()['seconds'],150)
    def test_aggregate_by_second_level_deduplicates_different_child_tags(self):
        self.tag(0,100);self.tag(50,150,tags=['Client','Project','Testing']);self.assertEqual(self.report(group_fields=['level:2'])['seconds'],150)
    def test_distinct_groups_preserve_their_own_overlapping_work(self):
        self.tag(0,100);self.tag(50,150,tags=['Other']);self.assertEqual(self.report()['seconds'],200)
    def test_billable_and_nonbillable_filters_are_explicit(self):
        self.tag(billable=True);self.tag(200,300,billable=False)
        self.assertEqual(self.report(billable=True)['seconds'],180);self.assertEqual(self.report(billable=False)['seconds'],100)
    def test_billable_can_be_grouped(self):
        self.tag(billable=True);self.tag(200,300);r=self.report(group_fields=['billable'])
        self.assertEqual({r['groups'][0]:r['seconds'] for r in r['matrix']},{'不可计费':100,'可计费':180})
    def test_filter_respects_notes_quotes_negation_and_billable_label(self):
        self.tag(notes='Review design',billable=True);self.tag(200,300,tags=['Other'],notes='Meeting')
        self.assertEqual(self.report(query='note:review label=billable')['seconds'],180)
        self.assertEqual(self.report(query='-"Client" -label=billable')['seconds'],100)
    def test_invalid_filter_is_rejected_even_without_records(self):
        with self.assertRaises(PolicyError):self.report(query='"unfinished')
    def test_range_clips_both_ends_and_includes_empty_dates(self):
        self.tag(-100,100);r=render(self.t,self.a+50,self.b+86400,{})
        self.assertEqual(r['seconds'],50);self.assertEqual(r['buckets'],['2026-10-29','2026-10-30']);self.assertEqual(r['matrix'][0]['cells'][1]['seconds'],0)
    def test_split_at_midnight_assigns_calendar_fields_per_piece(self):
        self.tag(86300,86500);r=render(self.t,self.a,self.b+86400,{'group_fields':['year','month','day']})
        self.assertEqual([(v['groups'],v['seconds']) for v in r['matrix']],[(['2026','10','29'],100),(['2026','10','30'],100)])
    def test_week_month_year_and_no_date_grouping(self):
        self.tag();
        for kind,expected in [('week','2026-10-26'),('month','2026-10'),('year','2026'),('none','总计')]:
            with self.subTest(kind=kind):
                r=self.report(total_by=kind);self.assertEqual(r['buckets'],[expected]);self.assertEqual(r['matrix'][0]['seconds'],180)
        self.assertEqual(len(self.report(total_by='none')['columns']),3)
    def test_nearest_up_and_down_round_aggregated_cells_not_entries(self):
        self.tag(0,100);self.tag(200,300)
        self.assertEqual(self.report(round_minutes=5,rounding='nearest')['rounded_seconds'],300)
        self.assertEqual(self.report(round_minutes=5,rounding='up')['rounded_seconds'],300)
        self.assertEqual(self.report(round_minutes=5,rounding='down')['rounded_seconds'],0)
    def test_minimum_charge_prevents_nonzero_cells_rounding_to_zero(self):
        self.tag(0,1)
        for mode in ['nearest','up','down','total']:self.assertEqual(self.report(round_minutes=60,rounding=mode,never_zero=True)['rounded_seconds'],3600)
    def test_keep_total_distributes_rounding_by_largest_remainder(self):
        for name,start,duration in [('A',0,149),('B',300,149),('C',600,149)]:self.tag(start,start+duration,tags=[name])
        r=self.report(round_minutes=5,rounding='total');self.assertEqual(r['seconds'],447);self.assertEqual(r['rounded_seconds'],300)
        self.assertEqual([v['rounded_seconds'] for v in r['matrix']],[300,0,0]);self.assertEqual(self.report(round_minutes=5)['rounded_seconds'],0)
    def test_keep_total_plus_minimum_charge_reports_actual_minimum(self):
        self.tag(0,1,tags=['A']);self.tag(10,11,tags=['B']);r=self.report(round_minutes=60,rounding='total',never_zero=True)
        self.assertEqual(r['seconds'],2);self.assertEqual(r['rounded_seconds'],7200)
    def test_raw_and_rounded_export_columns_match_matrix_values(self):
        self.tag(0,181,notes='Kept');r=self.report(round_minutes=5,include_unrounded=True)
        self.assertEqual(table(r)[1],['Client, Project, Design',300,181,300,181,'Kept'])
        self.assertEqual(len(r['columns']),len(r['table'][0]))
    def test_rounding_does_not_modify_tags_or_charges(self):
        self.tag(0,181);self.store.charge(self.a,'scope',42);before=[dict(v) for v in self.t.db.execute('SELECT * FROM tracking_tags')];policy=copy.deepcopy(self.store.state)
        self.report(round_minutes=60,rounding='up',never_zero=True)
        self.assertEqual([dict(v) for v in self.t.db.execute('SELECT * FROM tracking_tags')],before);self.assertEqual(self.store.state,policy);self.assertEqual(self.store.used('scope',0),42)
    def test_autotags_and_combined_sources_use_same_interval_math(self):
        self.t.add_activity({'start':self.a,'end':self.a+180,'timeline':'applications','application':'Editor','title':'Design'})
        self.t.autotags.save({'tags':['Client','Project','Design'],'conditions':[{'field':'application','value':'Editor'}]});self.tag()
        self.assertEqual(self.report(sources=['autotags'])['seconds'],180);self.assertEqual(self.report(sources=['tags','autotags'])['seconds'],180)
        r=self.report(sources=['tags','autotags'],group_fields=['timeline']);self.assertEqual(r['seconds'],360);self.assertEqual({v['groups'][0] for v in r['matrix']},{'普通标签','自动标签'})
    def test_autotag_errors_remain_visible_in_timesheet(self):
        self.t.add_activity({'start':self.a,'end':self.a+180,'timeline':'applications','application':'Editor','title':'bad,name'})
        self.t.autotags.save({'tags':['{{title}}'],'conditions':[{'field':'application','value':'Editor'}]});r=self.report(sources=['autotags'])
        self.assertEqual(len(r['errors']),1);self.assertEqual(r['seconds'],0)
    def test_saved_options_can_include_date_range_and_survive_restart(self):
        saved=self.t.save_entity('timesheets',{'name':'Weekly project','definition':{'group_fields':['level:2'],'round_minutes':5},'date_range':{'from':'2026-10-01','through':'2026-10-29'}})
        self.t.close();self.t=TrackingStore(self.store);self.assertEqual(self.t.entities('timesheets')[0],saved)
        self.assertEqual(self.t.db.execute('SELECT COUNT(*) FROM tracking_tags').fetchone()[0],0)
    def test_saved_options_validate_range_and_definition_atomically(self):
        for value in [{'name':''},{'name':'Bad','definition':{'group_fields':[]}},{'name':'Bad','date_range':{'from':'2026-10-30','through':'2026-10-29'}},{'name':'Bad','date_range':{'from':'bad','through':'2026-10-29'}}]:
            with self.subTest(value=value),self.assertRaises(PolicyError):self.t.save_entity('timesheets',value)
        self.assertEqual(self.t.entities('timesheets'),[])
    def test_sorting_is_numeric_for_durations_and_stable_across_export(self):
        self.tag(0,10,tags=['A']);self.tag(100,200,tags=['B']);r=self.report(sort_by={'column':1,'descending':True})
        self.assertEqual([v[0] for v in r['table']],['B','A']);self.assertEqual([v['groups'][0] for v in r['matrix']],['B','A'])
        data,_=export_table(table(r),'csv');self.assertEqual(list(csv.reader(io.StringIO(data.decode('utf-8-sig'))))[1][0],'B')
    def test_sort_column_outside_new_range_falls_back_to_first_group(self):
        self.tag(tags=['Z']);self.tag(200,300,tags=['A']);self.assertEqual(self.report(sort_by={'column':999,'descending':False})['table'][0][0],'A')
    def test_formula_like_group_names_and_notes_are_safe_in_csv(self):
        self.tag(tags=['=1+1'],notes='@formula');data,_=export_table(table(self.report()),'csv');row=list(csv.reader(io.StringIO(data.decode('utf-8-sig'))))[1]
        self.assertEqual(row[0],"'=1+1");self.assertEqual(row[-1],"'@formula")
    def test_invalid_definitions_are_strict_without_mutating_defaults(self):
        for value in [[],{'sources':[]},{'sources':['computer']},{'group_fields':[]},{'group_fields':['level:0']},{'group_fields':['tags','tags']},{'total_by':'bad'},{'rounding':'bad'},{'billable':1},{'round_minutes':True},{'never_zero':1},{'sort_by':{'column':0,'descending':1}},{'extra':True}]:
            with self.subTest(value=value),self.assertRaises(PolicyError):render(self.t,self.a,self.b,value)
        default=validate({});default['sources'].append('autotags');self.assertEqual(validate({})['sources'],['tags'])
    @unittest.skipUnless(hasattr(time,'tzset'),'POSIX timezones')
    def test_dst_day_uses_real_elapsed_time_instead_of_24_hour_assumption(self):
        old=os.environ.get('TZ');os.environ['TZ']='America/New_York';time.tzset()
        try:
            a,b=day_bounds('2026-11-01');self.t.save_tag({'start':a,'end':b,'tags':['Night']});r=render(self.t,a,b,{})
            self.assertEqual(r['seconds'],25*3600);self.assertEqual(r['buckets'],['2026-11-01'])
        finally:
            if old is None:os.environ.pop('TZ',None)
            else:os.environ['TZ']=old
            time.tzset()


if __name__=='__main__':unittest.main()
