import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from broccoli.model import PolicyError
from broccoli.store import Store
from broccoli.tracking import TrackingStore,day_bounds,generated_color
from broccoli.tracking_tags import identity


class TagLibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(self.temp.name);self.t=TrackingStore(self.store);self.lib=self.t.tag_library
        self.a,self.b=day_bounds('2026-10-28')
    def tearDown(self):self.t.close();self.store.db.close();self.temp.cleanup()
    def tag(self,names,start=0,end=60,**extra):return self.t.save_tag({'tags':names,'start':self.a+start,'end':self.a+end,**extra})['ids'][0]
    def style(self,kind,names,**extra):return self.lib.save({'kind':kind,'parts':names,**extra})
    def key(self,kind,names):return identity(kind,names)
    def test_saving_time_registers_ordered_combinations_and_individual_names(self):
        self.tag(['Client','Project']);self.tag(['Client','Design']);self.tag(['Client','Project'],60,120)
        self.assertEqual([v['parts'] for v in self.lib.catalog()['items']],[['Client','Project'],['Client','Design']])
        self.assertEqual([v['name'] for v in self.lib.catalog('tag')['items']],['Client','Project','Design'])
    def test_hierarchy_preserves_shared_prefix_terminal_and_children(self):
        self.lib.import_text('Client\nClient, Project\nClient, Project, Design\nOther, Project')
        root=self.lib.children([]);self.assertEqual([v['name'] for v in root['items']],['Client','Other']);self.assertFalse(root['terminal'])
        node=self.lib.children(['Client']);self.assertTrue(node['terminal']);self.assertEqual(node['items'][0]['parts'],['Client','Project']);self.assertTrue(node['items'][0]['terminal']);self.assertTrue(node['items'][0]['children'])
    def test_color_inheritance_skip_and_combination_override(self):
        self.tag(['Client','Project','Design']);self.tag(['Client'],60,120)
        self.style('tag',['Client'],color='#112233');self.style('tag',['Project'],color='#445566')
        self.assertEqual(self.t.tags(self.a,self.b)[0]['color'],'#112233')
        self.style('tag',['Client'],color='#112233',skip=True)
        rows=self.t.tags(self.a,self.b);self.assertEqual(rows[0]['color'],'#445566');self.assertEqual(rows[1]['color'],'#112233')
        self.style('combination',['Client','Project','Design'],color='#abcdef');self.assertEqual(self.t.tags(self.a,self.b)[0]['color'],'#abcdef')
    def test_all_skipped_parts_fall_back_to_first(self):
        self.tag(['A','B']);self.style('tag',['A'],color='#112233',skip=True);self.style('tag',['B'],color='#445566',skip=True)
        self.assertEqual(self.t.tags(self.a,self.b)[0]['color'],'#112233')
    def test_event_color_override_is_not_lost_when_library_color_changes(self):
        self.tag(['A'],color='#112233');self.style('tag',['A'],color='#445566');self.assertEqual(self.t.tags(self.a,self.b)[0]['color'],'#112233')
    def test_rename_individual_changes_all_exact_parts_preserving_event_metadata(self):
        a=self.tag(['Client','Design'],notes='保留备注',billable=True);self.tag(['Client 2','Design'],60,120);self.tag(['Client','Testing'],120,180)
        before=self.t.tags(self.a,self.b);self.lib.change(self.key('tag',['Client']),['Alpha'])
        rows=self.t.tags(self.a,self.b);self.assertEqual([r['tags'] for r in rows],[['Alpha','Design'],['Client 2','Design'],['Alpha','Testing']])
        self.assertEqual(rows[0]['id'],a);self.assertEqual(rows[0]['notes'],'保留备注');self.assertTrue(rows[0]['billable'])
        self.assertEqual([(r['start'],r['end']) for r in rows],[(r['start'],r['end']) for r in before])
    def test_combination_rename_is_limited_to_complete_ordered_match(self):
        self.tag(['Client','Design']);self.tag(['Other','Design'],60,120);self.tag(['Design','Client'],120,180)
        self.lib.change(self.key('combination',['Client','Design']),['Client','UI'])
        self.assertEqual([r['tags'] for r in self.t.tags(self.a,self.b)],[['Client','UI'],['Other','Design'],['Design','Client']])
    def test_rename_merges_existing_target_definition_without_losing_style(self):
        self.tag(['A']);self.tag(['B'],60,120);self.style('tag',['A'],color='#112233');self.style('tag',['B'],color='#445566')
        self.lib.change(self.key('tag',['A']),['B']);self.assertEqual(self.lib.catalog('tag')['total'],1)
        self.assertEqual([r['color'] for r in self.t.tags(self.a,self.b)],['#445566','#445566'])
    def test_global_rename_updates_structured_saved_series_only(self):
        self.tag(['A']);saved=self.t.save_entity('reports',{'type':'custom','query':'title:A','series':[{'timeline':'tags','groups':['A'],'name':'Own label'},{'timeline':'applications','groups':['A']}]})
        self.lib.change(self.key('tag',['A']),['B']);report=self.t.entities('reports')[0]
        self.assertEqual(report['id'],saved['id']);self.assertEqual(report['query'],'title:A');self.assertEqual(report['series'][0]['groups'],['B']);self.assertEqual(report['series'][0]['name'],'Own label');self.assertEqual(report['series'][1]['groups'],['A'])
    def test_delete_individual_removes_part_and_only_drops_empty_tags(self):
        self.tag(['Client','Design']);self.tag(['Client'],60,120);self.tag(['Other'],120,180)
        result=self.lib.change(self.key('tag',['Client']),delete=True)
        self.assertEqual(result,{'changed':1,'deleted':1});self.assertEqual([r['tags'] for r in self.t.tags(self.a,self.b)],[['Design'],['Other']]);self.assertEqual(self.lib.children([])['total'],2)
    def test_delete_combination_keeps_raw_activity_and_other_combinations(self):
        self.tag(['Client','Design']);self.tag(['Other','Design'],60,120);self.t.add_activity({'timeline':'applications','start':self.a,'end':self.a+120,'group_name':'Editor'})
        self.lib.change(self.key('combination',['Client','Design']),delete=True)
        self.assertEqual(self.t.tags(self.a,self.b)[0]['tags'],['Other','Design']);self.assertEqual(len(self.t.activities(self.a,self.b)),1)
    def test_move_changes_picker_order_without_changing_part_order(self):
        self.lib.import_text('First, Task\nSecond, Task');self.lib.move(self.key('tag',['Second']),-1)
        self.assertEqual([v['name'] for v in self.lib.catalog('tag')['items']],['First','Second','Task'])
        self.lib.move(self.key('tag',['Second']),-1)
        self.assertEqual([v['name'] for v in self.lib.children([])['items']],['Second','First']);self.assertEqual(self.lib.catalog()['items'][0]['parts'],['First','Task'])
    def test_move_at_boundaries_is_noop(self):
        self.lib.import_text('A\nB');before=self.lib.catalog();self.lib.move(self.key('combination',['A']),-1);self.lib.move(self.key('combination',['B']),1);self.assertEqual(self.lib.catalog(),before)
    def test_catalog_pagination_and_unicode_literal_search(self):
        self.lib.import_text('Straße, 设计\nA_%, B\nOther')
        self.assertEqual(self.lib.catalog(query='STRASSE')['items'][0]['parts'],['Straße','设计']);self.assertEqual(self.lib.catalog(query='_%')['total'],1)
        self.assertEqual(len(self.lib.catalog(offset=1,limit=1)['items']),1);self.assertEqual(self.lib.catalog(offset=1,limit=1)['total'],3)
    def test_import_export_round_trip_does_not_create_time_records(self):
        self.assertEqual(self.lib.import_text('客户, 设计\n客户, 设计\nOther'),{'added':2});export=self.lib.export_text()['text'];self.assertEqual(export,'客户, 设计\nOther\n');self.assertEqual(self.t.tags(self.a,self.b),[])
    def test_invalid_import_is_atomic(self):
        with self.assertRaises(PolicyError):self.lib.import_text('Valid\n,')
        self.assertEqual(self.lib.catalog()['total'],0)
    def test_failed_style_update_rolls_back_historical_rename(self):
        self.tag(['Before']);before=self.t.tags(self.a,self.b);catalog=self.lib.catalog()
        with self.assertRaises(PolicyError):self.lib.update(self.key('tag',['Before']),{'parts':['After'],'color':'bad'})
        self.assertEqual(self.t.tags(self.a,self.b),before);self.assertEqual(self.lib.catalog(),catalog)
    def test_internal_failure_rolls_back_events_definitions_and_tree(self):
        self.tag(['Client','Project']);before=self.t.tags(self.a,self.b);catalog=self.lib.catalog();tree=self.lib.children([])
        with patch.object(self.lib,'_rebuild',side_effect=RuntimeError('isolated rewrite failure')):
            with self.assertRaises(RuntimeError):self.lib.change(self.key('tag',['Client']),['After'])
        self.assertEqual(self.t.tags(self.a,self.b),before);self.assertEqual(self.lib.catalog(),catalog);self.assertEqual(self.lib.children([]),tree);self.assertFalse(self.t.db.in_transaction)
    def test_failed_missing_event_edit_does_not_register_names_or_leave_transaction(self):
        with self.assertRaises(PolicyError):self.t.save_tag({'start':self.a,'end':self.a+60,'tags':['Should not exist']},'a'*32)
        self.assertEqual(self.lib.catalog()['total'],0);self.assertFalse(self.t.db.in_transaction)
    def test_historical_migration_and_reopen_preserve_library(self):
        self.tag(['A','B']);self.t.db.execute('DELETE FROM tracking_tag_library');self.t.db.execute('DELETE FROM tracking_tag_nodes');self.t.db.execute("DELETE FROM tracking_meta WHERE key='tag-library-v1'");self.t.db.commit();self.t.close()
        self.t=TrackingStore(self.store);self.lib=self.t.tag_library;self.assertEqual(self.lib.children([])['items'][0]['name'],'A');self.assertEqual(self.lib.catalog()['total'],1)
    def test_policy_locks_allowance_and_recording_configuration_are_unchanged(self):
        before=copy.deepcopy(self.store.state);settings=self.t.settings();self.store.charge(self.a,'rule',42)
        self.tag(['A']);self.lib.update(self.key('tag',['A']),{'parts':['B'],'color':'#123456','skip':True});self.lib.change(self.key('tag',['B']),delete=True)
        self.assertEqual(self.store.state,before);self.assertEqual(self.store.used('rule',0),42);self.assertEqual(self.t.settings(),settings)
    def test_recent_returns_latest_notes_and_billable_without_changing_tag_order(self):
        self.tag(['A','B'],notes='Old');self.tag(['Other'],60,120);self.tag(['A','B'],120,180,notes='Latest',billable=True)
        recent=self.lib.recent()['items'];self.assertEqual(recent[0]['parts'],['A','B']);self.assertEqual(recent[0]['notes'],'Latest');self.assertTrue(recent[0]['billable']);self.assertEqual(len(recent),2)
    def test_last_untagged_uses_first_interaction_or_last_tag_end(self):
        self.t.add_activity({'timeline':'computer','group_name':'Active','start':self.a+100,'end':self.a+200})
        self.assertEqual(self.lib.last_untagged(self.a+300)['range'],[self.a+100,self.a+300]);self.tag(['A'],120,180)
        self.assertEqual(self.lib.last_untagged(self.a+300)['range'],[self.a+180,self.a+300])
    def test_last_untagged_does_not_invent_start_or_go_backwards(self):
        with self.assertRaises(PolicyError):self.lib.last_untagged(self.a+300)
        self.tag(['A'],120,400)
        with self.assertRaises(PolicyError):self.lib.last_untagged(self.a+300)
    def test_invalid_inputs_are_rejected(self):
        for value in [{'kind':'no','parts':['A']},{'kind':'tag','parts':['A','B']},{'kind':'tag','parts':['A'],'skip':1},{'kind':'combination','parts':['A'],'skip':True},{'kind':'tag','parts':['A'],'color':'transparent'},{'kind':'tag','parts':['A'],'unknown':1}]:
            with self.assertRaises(PolicyError):self.lib.save(value)
        for prefix in [None,[''],[5]]:
            with self.assertRaises(PolicyError):self.lib.children(prefix)
        for limit in [0,True,501]:
            with self.assertRaises(PolicyError):self.lib.catalog(limit=limit)

if __name__=='__main__':unittest.main()
