import copy
import json
import tempfile
import unittest
import time
from unittest.mock import patch
from broccoli.model import PolicyError
from broccoli.store import Store
from broccoli.tracking import TrackingStore,day_bounds


class AutoTagTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(self.temp.name);self.t=TrackingStore(self.store);self.a=self.t.autotags
        self.start,self.end=day_bounds('2026-10-29')
    def tearDown(self):self.t.close();self.store.db.close();self.temp.cleanup()
    def record(self,a=0,b=100,timeline='applications',**value):
        return self.t.add_activity({'start':self.start+a,'end':self.start+b,'timeline':timeline,'application':'Editor','title':'Project A','group_name':'Editor',**value})
    def rule(self,**value):return self.a.save({'tags':['Work'],'conditions':[{'field':'application','value':'editor'}],**value})
    def result(self):return self.a.evaluate(self.start,self.end)
    def spans(self):return [(v['start']-self.start,v['end']-self.start,v['tags']) for v in self.result()['items']]
    def manual(self,a,b,**value):return self.t.save_tag({'start':self.start+a,'end':self.start+b,'tags':['Manual'],'notes':'Keep','billable':True,**value})
    def test_rules_derive_past_records_without_changing_raw_rows(self):
        self.record();before=[dict(v) for v in self.t.db.execute('SELECT * FROM tracking_activities')];rule=self.rule()
        self.assertEqual(self.spans(),[(0,100,['Work'])]);self.a.save({k:v for k,v in {**rule,'tags':['Changed']}.items() if k!='id'},rule['id'])
        self.assertEqual(self.spans(),[(0,100,['Changed'])]);self.assertEqual([dict(v) for v in self.t.db.execute('SELECT * FROM tracking_activities')],before)
        self.a.delete(rule['id']);self.assertEqual(self.spans(),[])
    def test_and_intersects_across_application_and_document_tracks(self):
        self.record();self.record(30,70,'documents',url='https://work.invalid/project')
        self.rule(conditions=[{'field':'application','value':'Editor'},{'timeline':'documents','field':'url','value':'work.invalid'}])
        self.assertEqual(self.spans(),[(30,70,['Work'])])
    def test_or_unions_overlapping_conditions_without_double_duration(self):
        self.record();self.record(30,150,'documents',url='https://work.invalid')
        self.rule(match='any',conditions=[{'field':'application','value':'Editor'},{'timeline':'documents','field':'url','value':'work.invalid'}])
        self.assertEqual(self.spans(),[(0,150,['Work'])]);self.assertEqual(self.t.report(self.start,self.end,'autotags')['series'][0]['total'],150)
    def test_exclusions_subtract_even_in_any_mode(self):
        self.record();self.record(20,40,'computer',title='Away')
        self.rule(match='any',conditions=[{'field':'application','value':'Editor'},{'timeline':'computer','field':'title','value':'Away','exclude':True}])
        self.assertEqual(self.spans(),[(0,20,['Work']),(40,100,['Work'])])
    def test_contains_equality_prefix_suffix_and_glob_are_case_insensitive(self):
        self.record(title='Alpha Project.txt')
        for op,value in [('contains','PROJECT'),('equals','alpha project.TXT'),('starts','ALPHA'),('ends','.TXT'),('glob','a*proj?ct.txt')]:
            with self.subTest(op=op):
                r=self.rule(conditions=[{'field':'title','operator':op,'value':value}]);self.assertEqual(self.spans(),[(0,100,['Work'])]);self.a.delete(r['id'])
    def test_literal_like_characters_do_not_become_sql_wildcards(self):
        self.record(title='100 percent');self.rule(conditions=[{'field':'title','value':'100%'}]);self.assertEqual(self.spans(),[])
    def test_disabled_rule_is_not_evaluated(self):self.record();self.rule(enabled=False);self.assertEqual(self.spans(),[])
    def test_first_match_splits_lower_priority_into_remaining_time(self):
        self.record();self.record(20,60,'documents',document='/work/file');first=self.rule(tags=['Specific'],conditions=[{'timeline':'documents','field':'document','value':'/work'}]);second=self.rule(tags=['General'])
        self.a.configure({'first_match':True});self.assertEqual(self.spans(),[(0,20,['General']),(20,60,['Specific']),(60,100,['General'])])
        self.a.move(second['id'],-1);self.assertEqual(self.spans(),[(0,100,['General'])]);self.assertEqual(self.a.catalog()['items'][1]['id'],first['id'])
    def test_unrestricted_rules_keep_overlapping_tags(self):
        self.record();self.rule(tags=['First']);self.rule(tags=['Second']);self.assertEqual(self.spans(),[(0,100,['First']),(0,100,['Second'])])
    def test_dynamic_title_group_and_metadata_come_from_and_anchor(self):
        self.record(title='Design',metadata={'repository':'repo','branch':'main'});self.record(20,50,'documents',title='Other',url='https://work.invalid')
        self.rule(tags=['Work','{{title}}','{{group}}','{{repository}}','{{branch}}'],notes='Window: {{title}} / {{application}}',conditions=[{'field':'application','value':'Editor'},{'timeline':'documents','field':'url','value':'work.invalid'}])
        row=self.result()['items'][0];self.assertEqual(row['tags'],['Work','Design','Editor','repo','main']);self.assertEqual(row['notes'],'Window: Design / Editor');self.assertEqual(row['seconds'],30)
    def test_or_dynamic_rules_do_not_mix_fields_between_activities(self):
        self.record(0,30,title='One');self.record(40,80,'documents',title='Two',document='/work')
        self.rule(tags=['{{title}}'],match='any',conditions=[{'field':'application','value':'Editor'},{'timeline':'documents','field':'document','value':'/work'}])
        self.assertEqual(self.spans(),[(0,30,['One']),(40,80,['Two'])])
    def test_dynamic_invalid_name_is_diagnosed_instead_of_breaking_day(self):
        self.record(title='bad,name');self.rule(tags=['{{title}}']);self.assertEqual(self.spans(),[]);self.assertEqual(len(self.result()['errors']),1)
        self.assertEqual(self.t.day('2026-10-29')['totals']['tagged'],0)
        with self.assertRaises(PolicyError):self.a.convert(self.start,self.end)
    def test_append_and_prepend_only_modify_overlapping_base_intervals(self):
        self.record();self.record(20,60,'documents',document='/work');self.rule(tags=['Work'])
        self.rule(tags=['Docs'],mode='append',conditions=[{'timeline':'documents','field':'document','value':'/work'}]);self.rule(tags=['Client'],mode='prepend',conditions=[{'timeline':'documents','field':'document','value':'/work'}])
        self.assertEqual(self.spans(),[(0,20,['Work']),(20,60,['Client','Work','Docs']),(60,100,['Work'])])
    def test_modifiers_never_create_standalone_tags_and_have_a_preview(self):
        self.record();rule=self.rule(tags=['Tools'],mode='append');self.assertEqual(self.spans(),[])
        self.assertEqual(self.a.preview({k:v for k,v in rule.items() if k!='id'},self.start,self.end)['seconds'],100)
    def test_modifier_target_selection_does_not_modify_other_rule(self):
        self.record();one=self.rule(tags=['One']);self.rule(tags=['Two']);self.rule(tags=['Extra'],mode='append',targets=[one['id']])
        self.assertEqual(self.spans(),[(0,100,['One','Extra']),(0,100,['Two'])])
    def test_manual_override_and_modify_modes_have_distinct_results(self):
        self.record();self.rule();self.rule(tags=['Tool'],mode='append');self.manual(20,60)
        self.a.configure({'manual_tags':'override'});self.assertEqual(self.spans(),[(0,20,['Work','Tool']),(20,60,['Manual']),(60,100,['Work','Tool'])])
        self.a.configure({'manual_tags':'modify'});self.assertEqual(self.spans(),[(0,20,['Work','Tool']),(20,60,['Manual','Tool']),(60,100,['Work','Tool'])])
    def test_manual_only_copy_to_autotags_works_without_rules(self):
        self.manual(10,40);self.a.configure({'manual_tags':'override'});self.assertEqual(self.spans(),[(10,40,['Manual'])])
    def test_derived_timeline_is_available_in_day_details_summary_filter_and_report(self):
        self.record();self.rule();day=self.t.day('2026-10-29','autotags','Work');self.assertEqual(day['details'][0]['title'],'Work');self.assertEqual(day['summary'][0]['seconds'],100)
        self.assertEqual(self.t.activities(self.start,self.end,'autotags','NoMatch'),[]);self.assertEqual(len([r for r in day['activities'] if r['timeline']=='autotags']),1)
        report=self.t.report(self.start,self.end,'autotags');self.assertEqual(report['series'][0]['total'],100)
    def test_derived_ids_and_diagnostics_are_stable(self):
        self.record();rule=self.rule(name='Client work');first=self.result()['items'][0];second=self.result()['items'][0]
        self.assertEqual(first['id'],second['id']);self.assertEqual(first['metadata']['rules'],['Client work']);self.assertEqual(first['rule_ids'],[rule['id']])
    def test_day_filter_does_not_filter_source_before_rule_calculation(self):
        self.record(title='No work word in observation');self.rule(tags=['UniqueOutput']);self.assertEqual(self.t.day('2026-10-29','autotags','UniqueOutput')['summary'][0]['seconds'],100)
    def test_interval_cropping_excludes_adjacent_day_without_fabricating_time(self):
        self.record(-50,50);self.rule();self.assertEqual(self.spans(),[(0,50,['Work'])]);self.assertEqual(self.a.evaluate(self.start+50,self.end)['items'],[])
    def test_conversion_only_untagged_preserves_existing_metadata_and_is_repeat_safe(self):
        self.record();self.rule(notes='Auto notes',billable=True);self.manual(20,60)
        result=self.a.convert(self.start,self.end,mode='untagged');self.assertEqual(result['seconds'],60);self.assertEqual(result['count'],2)
        rows=self.t.tags(self.start,self.end);self.assertEqual([(r['start']-self.start,r['end']-self.start) for r in rows],[(0,20),(20,60),(60,100)])
        self.assertEqual(rows[1]['notes'],'Keep');self.assertTrue(rows[0]['billable']);self.assertEqual(self.a.convert(self.start,self.end)['count'],0)
    def test_double_conversion_keeps_overlap_and_snapshot_survives_rule_deletion(self):
        self.record();rule=self.rule();self.manual(20,60);self.assertEqual(self.a.convert(self.start,self.end,mode='double')['count'],1)
        self.a.delete(rule['id']);self.assertEqual(len(self.t.tags(self.start,self.end)),2);self.assertEqual(self.spans(),[])
    def test_overwrite_crops_existing_tags_only_where_results_exist(self):
        self.record(20,40);self.rule();self.manual(0,100);self.a.convert(self.start,self.end,mode='overwrite')
        rows=self.t.tags(self.start,self.end);self.assertEqual([(r['start']-self.start,r['end']-self.start,r['tags']) for r in rows],[(0,20,['Manual']),(20,40,['Work']),(40,100,['Manual'])]);self.assertEqual(rows[-1]['notes'],'Keep')
    def test_conversion_selection_is_union_clipped_and_no_outside_deletion(self):
        self.record();self.rule();self.manual(0,100);result=self.a.convert(self.start,self.end,[[self.start+10,self.start+30],[self.start+20,self.start+40]],'overwrite')
        self.assertEqual(result['seconds'],30);self.assertEqual([(r['start']-self.start,r['end']-self.start) for r in self.t.tags(self.start,self.end)],[(0,10),(10,40),(40,100)])
    def test_failed_conversion_rolls_back_existing_tags_and_library(self):
        self.record();self.rule();self.manual(0,100);before=[dict(v) for v in self.t.db.execute('SELECT * FROM tracking_tags')]
        with patch.object(self.t.tag_library,'register',side_effect=RuntimeError('disk failure')):
            with self.assertRaises(RuntimeError):self.a.convert(self.start,self.end,mode='overwrite')
        self.assertEqual([dict(v) for v in self.t.db.execute('SELECT * FROM tracking_tags')],before)
    def test_conversion_and_rules_never_change_policy_or_charges(self):
        self.store.charge(self.start,'scope',42);before=copy.deepcopy(self.store.state);self.record();r=self.rule();self.a.convert(self.start,self.end);self.a.delete(r['id'])
        self.assertEqual(self.store.state,before);self.assertEqual(self.store.used('scope',0),42)
    def test_rules_options_and_priority_survive_database_restart(self):
        self.record();one=self.rule(tags=['One']);two=self.rule(tags=['Two']);self.a.move(two['id'],-1);self.a.configure({'first_match':True})
        self.t.close();self.t=TrackingStore(self.store);self.a=self.t.autotags;self.assertEqual(self.spans(),[(0,100,['Two'])]);self.assertEqual(self.a.catalog()['items'][1]['id'],one['id'])
    def test_validation_is_atomic_and_generic_entities_cannot_bypass_it(self):
        invalid=[{'conditions':[]},{'conditions':[{'field':'title','value':'x','exclude':True}]},{'conditions':[{'field':'unknown','value':'x'}]},
                 {'conditions':[{'value':''}]},{'match':'bad'},{'mode':'bad'},{'targets':['missing']},{'enabled':1},{'billable':1},{'tags':['{{unknown}}']},{'extra':True}]
        for value in invalid:
            with self.subTest(value=value),self.assertRaises(PolicyError):self.rule(**value)
        with self.assertRaises(PolicyError):self.t.save_entity('autotags',{'arbitrary':'object'})
        self.assertEqual(self.a.catalog()['items'],[])
    def test_bad_actions_and_ids_are_errors_without_mutation(self):
        rule=self.rule();before=self.a.catalog()
        for run in [lambda:self.a.move(rule['id'],0),lambda:self.a.move('missing',1),lambda:self.a.delete('missing'),lambda:self.a.configure({'first_match':1}),lambda:self.a.configure({'manual_tags':'bad'}),lambda:self.a.configure({'other':True}),lambda:self.a.convert(self.start,self.end,mode='bad'),lambda:self.a.convert(self.start,self.end,selection=[['bad',1]])]:
            with self.assertRaises(PolicyError):run()
        self.assertEqual(self.a.catalog(),before)
    def test_invalid_dynamic_names_are_visible_in_day_diagnostics(self):
        self.record(title='x'*101);self.rule(tags=['{{title}}']);day=self.t.day('2026-10-29','autotags')
        self.assertEqual(len(day['autotag_errors']),1);self.assertTrue(day['autotags_enabled']);self.assertEqual(day['summary'],[])
    def test_modifier_overflow_is_diagnosed_and_never_written(self):
        self.record();self.rule(notes='a'*6000);self.rule(mode='append',tags=['Tool'],notes='b'*6000)
        value=self.result();self.assertEqual(len(value['errors']),1);self.assertEqual(value['items'][0]['notes'],'a'*6000)
        with self.assertRaises(PolicyError):self.a.convert(self.start,self.end)
        self.assertEqual(self.t.tags(self.start,self.end),[])
    def test_regex_capture_groups_parse_client_project_and_filename(self):
        self.record(timeline='documents',title='/work/Client A/Project X/plan.docx',group_name='Word')
        self.rule(tags=['Work','{{1}}','{{2}}'],notes='{{3}} / {{group}}',conditions=[{'timeline':'documents','field':'title','operator':'regex','value':r'^/work/([^/]+)/([^/]+)/(.*)$'}])
        row=self.result()['items'][0];self.assertEqual(row['tags'],['Work','Client A','Project X']);self.assertEqual(row['notes'],'plan.docx / Word')
    def test_regex_case_insensitivity_preserves_capture_spelling(self):
        self.record(title='CLIENT Alpha');self.rule(tags=['{{1}}'],conditions=[{'field':'title','operator':'regex','value':r'client (.*)'}])
        self.assertEqual(self.spans(),[(0,100,['Alpha'])])
    def test_manictime_quoted_regex_is_recognized_without_losing_backslashes(self):
        self.record(title='Project 47');saved=self.rule(tags=['{{1}}'],conditions=[{'field':'title','value':r'#"Project (\d+)"'}])
        self.assertEqual(saved['conditions'][0]['operator'],'regex');self.assertEqual(self.spans(),[(0,100,['47'])])
    def test_regex_exclusion_is_subtracted_from_other_matches(self):
        self.record();self.record(30,60,'documents',url='https://private.invalid/account')
        self.rule(conditions=[{'field':'application','value':'Editor'},{'timeline':'documents','field':'url','operator':'regex','value':r'private\.(invalid|test)','exclude':True}])
        self.assertEqual(self.spans(),[(0,30,['Work']),(60,100,['Work'])])
    def test_regex_and_dynamic_source_is_first_positive_regex(self):
        self.record();self.record(30,60,'documents',title='/Client A/Design',group_name='Files')
        self.rule(tags=['{{1}}','{{title}}'],notes='{{group}}',conditions=[{'field':'application','value':'Editor'},{'timeline':'documents','field':'title','operator':'regex','value':r'^/([^/]+)/Design$'}])
        row=self.result()['items'][0];self.assertEqual(row['tags'],['Client A','/Client A/Design']);self.assertEqual(row['notes'],'Files');self.assertEqual(row['seconds'],30)
    def test_or_regex_captures_are_scoped_to_their_own_activity(self):
        self.record(0,30,title='Client One');self.record(40,70,title='Client Two')
        self.rule(tags=['{{1}}'],match='any',conditions=[{'field':'title','operator':'regex','value':r'Client (One)'},{'field':'title','operator':'regex','value':r'Client (Two)'}])
        self.assertEqual(self.spans(),[(0,30,['One']),(40,70,['Two'])])
    def test_invalid_regex_and_capture_references_are_rejected_before_save(self):
        for value in [{'tags':['{{1}}']},{'tags':['{{2}}'],'conditions':[{'field':'title','operator':'regex','value':'(one)'}]},
                      {'conditions':[{'field':'title','operator':'regex','value':'['}]},
                      {'tags':['{{1}}'],'match':'any','conditions':[{'value':'Editor'},{'field':'title','operator':'regex','value':'(one)'}]}]:
            with self.subTest(value=value),self.assertRaises(PolicyError):self.rule(**value)
        self.assertEqual(self.a.catalog()['items'],[])
    def test_optional_capture_in_notes_is_empty_and_full_match_zero_is_available(self):
        self.record(title='Client');self.rule(tags=['{{0}}'],notes='Optional {{1}}',conditions=[{'field':'title','operator':'regex','value':r'Client(?: (.+))?'}])
        row=self.result()['items'][0];self.assertEqual(row['tags'],['Client']);self.assertEqual(row['notes'],'Optional ')
    def test_hung_regex_is_terminated_reaped_and_reported_without_losing_other_rules(self):
        import subprocess
        self.record(title='a'*100+'!');self.rule(conditions=[{'field':'title','operator':'regex','value':'(a+)+$'}]);self.rule(tags=['Safe'])
        processes=[];original=subprocess.Popen
        def spawn(*args,**kwargs):
            process=original(*args,**kwargs);processes.append(process);return process
        before=time.monotonic()
        with patch('broccoli.tracking_regex.subprocess.Popen',side_effect=spawn):result=self.result()
        self.assertLess(time.monotonic()-before,3);self.assertEqual(result['items'][0]['tags'],['Safe']);self.assertIn('耗时过长',result['errors'][0]['message'])
        self.assertTrue(processes);self.assertTrue(all(p.poll() is not None for p in processes));self.assertEqual(self.t.day('2026-10-29')['totals']['active'],0)
        with self.assertRaises(PolicyError):self.a.convert(self.start,self.end)
    def test_repeated_regex_results_do_not_start_new_workers(self):
        self.record(title='Project One');self.rule(tags=['{{1}}'],conditions=[{'field':'title','operator':'regex','value':r'Project (.+)'}]);self.assertEqual(self.spans(),[(0,100,['One'])])
        with patch('broccoli.tracking_regex.subprocess.run',side_effect=AssertionError('Unnecessary repeat')):self.assertEqual(self.spans(),[(0,100,['One'])])
    def test_append_matched_group_data_keeps_applications_distinct(self):
        self.record(0,50,group_name='Editor');self.record(50,100,application='Mail',group_name='Mail')
        self.rule(append_data=True,match='any',conditions=[{'field':'application','value':'Editor'},{'field':'application','value':'Mail'}])
        self.assertEqual(self.spans(),[(0,50,['Work','Editor']),(50,100,['Work','Mail'])])
    def hard(self,a,b,name):
        self.record(a,b,title=name);return self.rule(tags=[name],conditions=[{'field':'title','operator':'equals','value':name}])
    def tool(self,a,b,**value):
        self.record(a,b,application='Browser',title='Search');return self.rule(tags=['General'],mode='absorb',conditions=[{'field':'application','value':'Browser'}],**value)
    def test_absorption_of_brief_tool_usage_between_same_task(self):
        self.hard(0,30,'Novel');self.hard(60,100,'Novel');self.tool(30,60)
        rows=self.result()['items'];self.assertEqual(sum(r['seconds'] for r in rows),100);self.assertTrue(all(r['tags']==['Novel'] for r in rows))
        inferred=[r for r in rows if r['inferred']];self.assertEqual(sum(r['seconds'] for r in inferred),30);self.assertTrue(all(r['highlighted'] for r in inferred));self.assertEqual(inferred[0]['metadata']['inferred'],'absorbed')
    def test_absorption_between_different_tasks_splits_at_nearest_midpoint(self):
        self.hard(0,30,'One');self.hard(70,100,'Two');self.tool(30,70)
        inferred=[(r['start']-self.start,r['end']-self.start,r['tags']) for r in self.result()['items'] if r['inferred']]
        self.assertEqual(inferred,[(30,50,['One']),(50,70,['Two'])])
    def test_absorption_without_a_neighbor_never_appears_by_itself(self):
        self.tool(20,60);self.assertEqual(self.spans(),[])
    def test_absorption_targets_do_not_use_an_unselected_neighbor(self):
        one=self.hard(0,30,'One');self.hard(70,100,'Two');self.tool(30,70,targets=[one['id']])
        inferred=[r for r in self.result()['items'] if r['inferred']];self.assertEqual(sum(r['seconds'] for r in inferred),40);self.assertTrue(all(r['tags']==['One'] for r in inferred))
    def test_absorption_does_not_cross_known_sleep_or_local_midnight(self):
        self.hard(0,30,'One');self.tool(60,90);self.record(30,60,'computer',group_name='Sleep')
        self.assertFalse(any(r['inferred'] for r in self.result()['items']))
        self.record(-20,-10,title='Before midnight');self.rule(tags=['Night'],conditions=[{'field':'title','value':'Before midnight'}])
        result=self.a.evaluate(self.start-100,self.end);self.assertFalse(any(r['inferred'] and r['tags']==['Night'] for r in result['items']))
    def test_absorption_is_confined_to_matched_tool_intervals_not_surrounding_gaps(self):
        self.hard(0,10,'Work');self.tool(30,50)
        self.assertEqual([(r['start']-self.start,r['end']-self.start) for r in self.result()['items'] if r['inferred']],[(30,50)])
    def test_append_applies_to_absorbed_intervals(self):
        self.hard(0,30,'Work');self.tool(30,60);self.rule(tags=['Browser'],mode='append',conditions=[{'field':'application','value':'Browser'}])
        self.assertIn((30,60,['Work','Browser']),self.spans())
    def test_small_gap_fill_uses_same_tag_and_remains_separately_identifiable(self):
        self.hard(0,30,'Work');self.hard(40,100,'Work');self.a.configure({'gap_seconds':11})
        result=self.result()['items'];self.assertEqual(sum(r['seconds'] for r in result),100)
        guess=next(r for r in result if r['inferred']);self.assertEqual(guess['inferred'],'gap');self.assertEqual(guess['seconds'],10)
    def test_small_gap_between_different_tags_is_split_equally(self):
        self.hard(0,30,'One');self.hard(50,100,'Two');self.a.configure({'gap_seconds':21})
        guesses=[(r['start']-self.start,r['end']-self.start,r['tags']) for r in self.result()['items'] if r['inferred']]
        self.assertEqual(guesses,[(30,40,['One']),(40,50,['Two'])])
    def test_gap_threshold_is_strict_and_never_extends_day_edges(self):
        self.hard(10,30,'One');self.hard(50,100,'Two');self.a.configure({'gap_seconds':20})
        self.assertFalse(any(r['inferred'] for r in self.result()['items']));self.a.configure({'gap_seconds':21});rows=self.result()['items'];self.assertEqual(min(r['start'] for r in rows),self.start+10);self.assertEqual(max(r['end'] for r in rows),self.start+100)
    def test_gap_fill_skips_away_and_cross_midnight_gaps(self):
        self.hard(0,30,'One');self.hard(50,100,'Two');self.record(30,50,'computer',group_name='Away');self.a.configure({'gap_seconds':3600})
        self.assertFalse(any(r['inferred'] for r in self.result()['items']))
        self.record(-20,-10,title='Night');self.rule(tags=['Night'],conditions=[{'field':'title','value':'Night'}]);self.assertFalse(any(r['inferred'] and r['start']<self.start for r in self.a.evaluate(self.start-100,self.end)['items']))
    def test_highlight_toggle_changes_presentation_without_changing_times(self):
        self.hard(0,30,'Work');self.hard(40,100,'Work');self.a.configure({'gap_seconds':11});before=self.result()['items'];self.a.configure({'highlight_guessed':False});after=self.result()['items']
        self.assertEqual([(r['start'],r['end'],r['tags']) for r in before],[(r['start'],r['end'],r['tags']) for r in after]);self.assertFalse(any(r['highlighted'] for r in after));self.assertTrue(any(r['inferred']=='gap' for r in after))
    def test_inferred_time_can_be_snapshotted_and_no_longer_tracks_rule_changes(self):
        self.hard(0,30,'Work');self.hard(40,100,'Work');self.a.configure({'gap_seconds':11});self.assertEqual(self.a.convert(self.start,self.end)['seconds'],100)
        self.a.configure({'gap_seconds':0});self.assertEqual(sum(r['seconds'] for r in self.t.tags(self.start,self.end)),100)
    def test_advanced_option_validation_is_atomic(self):
        before=self.a.catalog()
        for value in [{'gap_seconds':True},{'gap_seconds':-1},{'gap_seconds':3601},{'highlight_guessed':1}]:
            with self.assertRaises(PolicyError):self.a.configure(value)
        with self.assertRaises(PolicyError):self.rule(append_data=1)
        self.assertEqual(self.a.catalog(),before)
    def test_identical_rule_outputs_are_one_tag_with_all_contributing_rules(self):
        self.record();one=self.rule();two=self.rule()
        rows=self.result()['items'];self.assertEqual(len(rows),1);self.assertEqual(rows[0]['seconds'],100);self.assertEqual(rows[0]['rule_ids'],[one['id'],two['id']])
        self.assertEqual(self.a.convert(self.start,self.end)['count'],1)
    def test_deduplication_preserves_provenance_only_on_actual_intersection(self):
        self.record();self.record(30,60,'documents',document='/work');one=self.rule();two=self.rule(conditions=[{'timeline':'documents','field':'document','value':'/work'}])
        rows=self.result()['items'];self.assertEqual([(r['start']-self.start,r['end']-self.start,len(r['rule_ids'])) for r in rows],[(0,30,1),(30,60,2),(60,100,1)])
    def test_regex_query_releases_database_lock_while_matching(self):
        import threading
        self.record();self.rule(conditions=[{'field':'title','operator':'regex','value':'Project (.+)'}])
        entered=threading.Event();release=threading.Event();errors=[]
        def matching(pattern,values):entered.set();release.wait(3);return {v:['Project A','A'] for v in values}
        def query():
            try:self.result()
            except BaseException as error:errors.append(error)
        with patch.object(self.a.regex,'match',side_effect=matching):
            thread=threading.Thread(target=query);thread.start();self.assertTrue(entered.wait(1))
            try:
                before=time.monotonic();self.record(120,130);self.assertLess(time.monotonic()-before,.5)
            finally:release.set();thread.join(timeout=2)
        self.assertFalse(thread.is_alive());self.assertEqual(errors,[])
    def test_gap_fill_does_not_reclassify_a_protected_manual_tag(self):
        self.hard(0,30,'One');self.hard(50,100,'Two');self.manual(35,45);self.a.configure({'gap_seconds':11,'manual_tags':'override'})
        rows=self.result()['items'];manual=next(r for r in rows if r['tags']==['Manual'] and not r['inferred']);self.assertEqual(manual['seconds'],10);self.assertEqual(manual['notes'],'Keep')
    def test_regex_worker_failure_is_a_diagnostic_and_never_an_empty_success(self):
        self.record();self.rule(conditions=[{'field':'title','operator':'regex','value':'Project (.+)'}])
        with patch('broccoli.tracking_regex.subprocess.run',side_effect=OSError('missing runtime')):
            result=self.result();self.assertEqual(result['items'],[]);self.assertIn('组件暂不可用',result['errors'][0]['message'])
        self.assertEqual(self.t.tags(self.start,self.end),[])


if __name__=='__main__':unittest.main()
