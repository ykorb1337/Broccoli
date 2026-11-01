import copy
import json
import tempfile
import unittest
from unittest.mock import patch
from hotturkey.model import PolicyError
from hotturkey.store import Store
from hotturkey.tracking import TrackingStore,day_bounds
from hotturkey.tracking_timesheet import render as sheet
from hotturkey.tracking_usage import render,retag
from hotturkey.tracking_tags import identity


class TimesheetUsageTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(self.temp.name);self.t=TrackingStore(self.store);self.a,self.b=day_bounds('2026-10-29');self.a+=9*3600
    def tearDown(self):self.t.close();self.store.db.close();self.temp.cleanup()
    def tag(self,a=0,b=100,**extra):return self.t.save_tag({'start':self.a+a,'end':self.a+b,'tags':['Client','Work'],'notes':'Original','billable':True,**extra})
    def app(self,a=-20,b=200,**extra):return self.t.add_activity({'start':self.a+a,'end':self.a+b,'timeline':'applications','application':'Editor','title':'Draft','group_name':'Editor',**extra})
    def work(self,**options):return sheet(self.t,self.a-100,self.b,options)
    def usage(self,work=None,**options):return render(self.t,(work or self.work())['snapshot'],options)
    def spans(self,rows):return [(r['start']-self.a,r['end']-self.a) for r in rows]
    def test_details_clip_to_work_and_preserve_disjoint_gaps(self):
        self.tag(0,30);self.tag(60,100);self.app();u=self.usage()
        self.assertEqual(self.spans(u['items']),[(0,30),(60,100)]);self.assertEqual(u['seconds'],70);self.assertEqual(u['work_seconds'],70)
    def test_activities_outside_work_are_never_returned(self):
        self.tag();self.app(-50,-10,title='Before');self.app(100,200,title='After');self.assertEqual(self.usage()['items'],[])
    def test_overlapping_tags_do_not_duplicate_usage(self):
        self.tag(0,60);self.tag(30,100);self.app();u=self.usage();self.assertEqual(u['seconds'],100);self.assertEqual(len(u['items']),1)
    def test_grouping_by_title_retains_actual_ranges_instead_of_span_duration(self):
        self.tag();self.app(0,30);self.app(60,100);u=self.usage(group_by='title');r=u['items'][0]
        self.assertEqual(r['seconds'],70);self.assertEqual(r['end']-r['start'],100);self.assertEqual(r['count'],2);self.assertEqual(r['ranges'],[[self.a,self.a+30],[self.a+60,self.a+100]])
    def test_grouping_by_application_deduplicates_overlaps_but_preserves_titles_in_details(self):
        self.tag();self.app(0,60,title='One');self.app(30,100,title='Two');u=self.usage(group_by='group');self.assertEqual(len(u['items']),1);self.assertEqual(u['items'][0]['title'],'Editor');self.assertEqual(u['seconds'],100)
        self.assertEqual(self.usage()['total'],2)
    def test_title_group_across_apps_does_not_claim_one_application(self):
        self.tag();self.app(0,40,application='One',group_name='One');self.app(50,100,application='Two',group_name='Two');u=self.usage(group_by='title')
        self.assertEqual(u['items'][0]['application'],'多个应用');self.assertEqual(u['items'][0]['bundle'],'')
    def test_documents_and_computer_timelines_are_scoped_too(self):
        self.tag(30,60);self.app(0,100,timeline='documents',url='https://example.invalid');self.app(0,100,timeline='computer',group_name='Active')
        self.assertEqual(self.usage(timeline='documents')['seconds'],30);self.assertEqual(self.usage(timeline='computer')['seconds'],30)
    def test_activity_filter_does_not_modify_the_generated_tag_filter(self):
        self.tag();self.app(0,40,title='Writing');self.app(50,100,title='Meeting');work=self.work(query='Client')
        self.assertEqual(self.usage(work,query='title:Meeting')['seconds'],50);self.assertEqual(work['seconds'],100)
    def test_selected_matrix_rows_limit_usage_and_not_other_overlapping_projects(self):
        self.tag(0,40,tags=['A']);self.tag(50,100,tags=['B']);self.app();w=self.work();key=next(r['key'] for r in w['matrix'] if r['groups']==['B'])
        self.assertEqual(self.spans(self.usage(w,row_keys=[key])['items']),[(50,100)])
    def test_pagination_limits_page_but_snapshot_keeps_all_export_rows(self):
        self.tag();self.app(0,10,title='A');self.app(20,30,title='B');self.app(40,50,title='C');u=self.usage(offset=1,limit=1)
        self.assertEqual(u['total'],3);self.assertEqual(u['items'][0]['title'],'B');cached=self.t.report_snapshots.get(u['snapshot'],'usage')['report'];self.assertEqual(len(cached['table']),3);self.assertEqual(len(cached['items']),3)
    def test_first_occurrence_is_first_real_fragment_not_full_group(self):
        self.tag();self.app(60,90);self.app(10,20);u=self.usage(group_by='group');self.assertEqual(u['items'][0]['first_range'],[self.a+10,self.a+20])
    def test_legacy_precision_is_labeled_in_page_and_export(self):
        self.tag();self.app(source='legacy',metadata={'precision':'aggregate'});u=self.usage();self.assertTrue(u['items'][0]['legacy']);self.assertEqual(u['table'][0][-1],'旧版汇总')
    def test_frozen_work_does_not_expand_when_clock_or_tags_continue(self):
        saved=self.tag(0,30);self.app();w=self.work();self.t.save_tag({'start':self.a,'end':self.a+100,'tags':['Client','Work'],'notes':'Original','billable':True},saved['ids'][0])
        self.assertEqual(self.usage(w)['seconds'],30);self.assertEqual(self.usage()['seconds'],100)
    def test_snapshot_export_values_are_detached_from_later_data_changes(self):
        self.tag();w=self.work();self.tag(200,300);cached=self.t.report_snapshots.get(w['snapshot'],'work')['report'];self.assertEqual(cached['seconds'],100);self.assertEqual(self.work()['seconds'],200)
        cached['table'].clear();self.assertTrue(self.t.report_snapshots.get(w['snapshot'],'work')['report']['table'])
    def test_expired_unknown_and_wrong_kind_snapshots_fail_explicitly(self):
        self.tag();w=self.work();u=self.usage(w)
        for token in ['bad','f'*64,u['snapshot']]:
            with self.assertRaises(PolicyError):render(self.t,token,{})
        now=self.t.report_snapshots.clock();self.t.report_snapshots.clock=lambda:now+9*3600
        with self.assertRaises(PolicyError):self.usage(w)
    def test_invalid_usage_options_never_fall_back_to_an_unrestricted_view(self):
        self.tag();w=self.work()
        for options in [{'timeline':'tags'},{'group_by':'bad'},{'row_keys':[]},{'row_keys':['missing']},{'offset':True},{'limit':0},{'query':'"bad'},{'extra':1}]:
            with self.subTest(options=options),self.assertRaises(PolicyError):render(self.t,w['snapshot'],options)
    def test_retagging_group_only_replaces_observed_fragments_and_keeps_holes(self):
        self.tag();self.app(0,30);self.app(60,100);u=self.usage(group_by='title');r=u['items'][0]
        result=retag(self.t,u['snapshot'],r['key'],{'tags':['Personal'],'notes':'Changed','billable':False})
        self.assertEqual(result['seconds'],70);tags=self.t.tags(self.a,self.b);self.assertEqual([(r['start']-self.a,r['end']-self.a,r['tags']) for r in tags],[(0,30,['Personal']),(30,60,['Client','Work']),(60,100,['Personal'])]);self.assertEqual(tags[1]['notes'],'Original')
    def test_retagging_selected_work_does_not_remove_an_unselected_overlapping_tag(self):
        self.tag();other=self.tag(20,80,tags=['Other']);self.app();w=self.work(query='Client');u=self.usage(w)
        retag(self.t,u['snapshot'],u['items'][0]['key'],{'tags':['New']});tags=self.t.tags(self.a,self.b);self.assertTrue(any(r['id']==other['ids'][0] and r['tags']==['Other'] for r in tags))
    def test_invalid_retag_rolls_back_cuts_and_library_changes(self):
        self.tag();self.app();u=self.usage();before=[dict(r) for r in self.t.db.execute('SELECT * FROM tracking_tags')]
        for value in [{'tags':[]},{'tags':['New'],'auto_override':'yes'},{'tags':['New'],'ranges':[[0,1]]}]:
            with self.assertRaises(PolicyError):retag(self.t,u['snapshot'],u['items'][0]['key'],value)
            self.assertEqual([dict(r) for r in self.t.db.execute('SELECT * FROM tracking_tags')],before)
    def test_changed_or_deleted_source_tag_blocks_stale_retag(self):
        tag=self.tag();self.app();u=self.usage();self.t.delete_tags(tag['ids'])
        with self.assertRaisesRegex(PolicyError,'原标签已更改'):retag(self.t,u['snapshot'],u['items'][0]['key'],{'tags':['New']})
        self.assertEqual(self.t.tags(self.a,self.b),[])
    def auto_work(self):
        self.app(0,100,timeline='computer',group_name='Active');self.t.autotags.save({'tags':['Work'],'billable':True,'conditions':[{'timeline':'computer','field':'group_name','value':'Active'}]})
        self.app(0,30);self.app(60,100);w=self.work(sources=['autotags']);return self.usage(w,group_by='group')
    def test_retag_autotags_creates_local_override_without_changing_rules(self):
        u=self.auto_work();before=copy.deepcopy(self.t.autotags.catalog());r=u['items'][0];self.assertTrue(r['retag_defaults']['auto_override'])
        result=retag(self.t,u['snapshot'],r['key'],{'tags':['Personal']});self.assertTrue(result['auto_override']);self.assertEqual(self.t.autotags.catalog(),before)
        rows=self.t.autotags.evaluate(self.a,self.b)['items'];self.assertEqual([(r['start']-self.a,r['end']-self.a,r['tags']) for r in rows],[(0,30,['Personal']),(30,60,['Work']),(60,100,['Personal'])])
        self.t.delete_tags(result['ids']);self.assertEqual([(r['tags'],r['seconds']) for r in self.t.autotags.evaluate(self.a,self.b)['items']],[(['Work'],100)])
    def test_repeated_old_autotag_retag_is_rejected_instead_of_creating_overlapping_overrides(self):
        u=self.auto_work();retag(self.t,u['snapshot'],u['items'][0]['key'],{'tags':['Personal']})
        with self.assertRaisesRegex(PolicyError,'原标签已更改'):retag(self.t,u['snapshot'],u['items'][0]['key'],{'tags':['Again']})
    def test_fresh_autotag_override_can_be_retagged_again_without_duplicate_time(self):
        u=self.auto_work();retag(self.t,u['snapshot'],u['items'][0]['key'],{'tags':['Personal']})
        w=self.work(sources=['autotags'],query='Personal');fresh=self.usage(w,group_by='group');retag(self.t,fresh['snapshot'],fresh['items'][0]['key'],{'tags':['New']})
        self.assertEqual(sum(r['seconds'] for r in self.t.tags(self.a,self.b)),70);self.assertTrue(all(r['tags']==['New'] for r in self.t.tags(self.a,self.b)))
    def test_override_can_be_cleared_or_edited_in_normal_tag_editor(self):
        u=self.auto_work();result=retag(self.t,u['snapshot'],u['items'][0]['key'],{'tags':['Personal']});ident=result['ids'][0];r=self.t.tags(self.a,self.b)[0];self.assertTrue(r['auto_override'])
        self.t.save_tag({'start':r['start'],'end':r['end'],'tags':['Personal'],'auto_override':False},ident);self.assertFalse(next(v for v in self.t.tags(self.a,self.b) if v['id']==ident)['auto_override'])
    def test_partial_delete_keeps_override_on_remaining_pieces(self):
        self.tag(0,100,tags=['Manual'],auto_override=True);self.t.delete_range(self.a+30,self.a+60,['tags'])
        rows=self.t.tags(self.a,self.b);self.assertEqual(self.spans(rows),[(0,30),(60,100)]);self.assertTrue(all(r['auto_override'] for r in rows));self.assertEqual(sum(r['seconds'] for r in self.t.autotags.evaluate(self.a,self.b)['items']),70)
    def test_preview_is_not_contaminated_by_existing_local_overrides(self):
        self.tag(auto_override=True);self.app();rule={'tags':['Preview'],'conditions':[{'field':'application','value':'Editor'}]};r=self.t.autotags.preview(rule,self.a,self.b)
        self.assertEqual(r['items'][0]['tags'],['Preview'])
    def test_global_tag_rename_preserves_override_and_delete_removes_it(self):
        self.tag(tags=['Manual'],auto_override=True);self.t.tag_library.change(identity('tag',['Manual']),['Renamed']);self.assertEqual(self.t.autotags.evaluate(self.a,self.b)['items'][0]['tags'],['Renamed'])
        self.t.tag_library.change(identity('tag',['Renamed']),delete=True);self.assertFalse(self.t.autotags.has_overrides());self.assertEqual(self.t.db.execute('SELECT COUNT(*) FROM tracking_autotag_overrides').fetchone()[0],0)
    def test_retag_changes_neither_raw_observations_policy_nor_charges(self):
        u=self.auto_work();self.store.charge(self.a,'scope',17);raw=[dict(r) for r in self.t.db.execute('SELECT * FROM tracking_activities')];policy=copy.deepcopy(self.store.state)
        retag(self.t,u['snapshot'],u['items'][0]['key'],{'tags':['Personal']});self.assertEqual([dict(r) for r in self.t.db.execute('SELECT * FROM tracking_activities')],raw);self.assertEqual(self.store.state,policy);self.assertEqual(self.store.used('scope',0),17)


if __name__=='__main__':unittest.main()
