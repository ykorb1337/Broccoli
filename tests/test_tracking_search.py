import datetime as dt
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from hotturkey.model import PolicyError
from hotturkey.store import Store
from hotturkey.tracking import TrackingStore,day_bounds
from hotturkey.tracking_regex import RegexMatcher
from hotturkey.tracking_search import compile_query,filter_records


def activity(title='Microsoft research',hour=10,seconds=70,**fields):
    start=dt.datetime(2026,10,28,hour,0).timestamp()
    return {'timeline':'applications','title':title,'group_name':'Google Chrome','application':'Chrome','start':start,'end':start+seconds,'seconds':seconds,**fields}


class SearchGrammarTests(unittest.TestCase):
    def match(self,query,row=None):return compile_query(query).matches(activity() if row is None else row)
    def test_documented_boolean_group_and_clock_expression(self):
        query='group:"google chrome" (microsoft or yahoo) start<13:00'
        self.assertTrue(self.match(query));self.assertTrue(self.match(query,activity('Yahoo')))
        self.assertFalse(self.match(query,activity('Google')));self.assertFalse(self.match(query,activity(hour=15)))
    def test_and_has_precedence_over_or(self):
        self.assertTrue(self.match('microsoft or yahoo AND missing'))
        self.assertFalse(self.match('(microsoft or yahoo) AND missing'))
    def test_negated_groups_and_case_insensitive_operators(self):
        self.assertTrue(self.match('-(Private OR Chat) AND research'))
        self.assertFalse(self.match('-(research)'))
        self.assertTrue(self.match('-(-research)'))
        self.assertTrue(self.match('--research'))
    def test_literal_quotes_and_exact_title_generated_by_double_click(self):
        row=activity('New Tab - Google Chrome')
        self.assertTrue(self.match('title="New Tab - Google Chrome"',row))
        self.assertFalse(self.match('title="New Tab"',row))
        self.assertTrue(self.match('title!="New Tab"',row))
        self.assertTrue(self.match('"or"',activity('or')))
        self.assertTrue(self.match('title:"say \\"yes\\""',activity('Say "yes"')))
    def test_plain_terms_target_title_and_tag_notes(self):
        self.assertFalse(self.match('Chrome',activity('Draft')))
        self.assertTrue(self.match('app:Chrome',activity('Draft')))
        self.assertTrue(self.match('review',activity('Client',timeline='tags',notes='Review requested')))
        self.assertFalse(self.match('review',activity('Client',notes='Review requested')))
    def test_document_queries_search_full_url_and_page_title(self):
        row=activity('Course notes',timeline='documents',url='https://school.invalid/full/chapter')
        self.assertTrue(self.match('chapter',row));self.assertTrue(self.match('"Course notes"',row))
        self.assertTrue(self.match('url:"school.invalid/full"',row))
    def test_duration_units_decimals_and_strict_comparison(self):
        self.assertFalse(self.match('duration>1m10s'));self.assertTrue(self.match('duration>=1m10s'))
        self.assertTrue(self.match('duration<1h'));self.assertTrue(self.match('duration=70'))
        self.assertTrue(self.match('duration>1.1m'));self.assertFalse(self.match('duration!=70'))
    def test_twelve_hour_clock_and_second_boundaries(self):
        self.assertTrue(self.match('start=10:00AM end>10:01:09'))
        self.assertTrue(self.match('start>=12:00AM start<12:00PM'))
        self.assertTrue(self.match('start>10:00PM',activity(hour=23)))
    def test_midnight_end_is_twenty_four_hours(self):
        row=activity(hour=23,seconds=3600)
        self.assertTrue(self.match('end=24:00',row));self.assertFalse(self.match('end<01:00',row))
    def test_unknown_clock_and_duration_do_not_match(self):
        self.assertFalse(self.match('duration>1s',{}));self.assertFalse(self.match('start<13:00',{}))
    def test_metadata_and_existing_field_aliases(self):
        row=activity(metadata={'repository':'HotTurkey','branch':'feature/search','workplace':'Office','desktop':'Desktop 2'},source='recorded')
        self.assertTrue(self.match('git-repository:hot git-branch:search workplace:office desktop:"Desktop 2" source:recorded',row))
        self.assertTrue(self.match('label=billable',activity(billable=True)))
        self.assertTrue(self.match('-label=billable',activity(billable=False)))
    def test_wildcards_match_non_whitespace_only(self):
        self.assertTrue(self.match('Ca?s',activity('Cars and Cats')))
        self.assertTrue(self.match('C*s',activity('Cats')))
        self.assertFalse(self.match('C*s',activity('Car wheels')))
        self.assertFalse(self.match('C?s',activity('C s')))
        self.assertTrue(self.match('"Ca* wheels"',activity('Car wheels')))
    def test_regex_preserves_escapes_and_supports_fields(self):
        self.assertTrue(self.match(r'#"research\s+\d+"',activity('Research 42')))
        self.assertFalse(self.match(r'title:#"^research\d+$"',activity('Research 42')))
        self.assertTrue(self.match(r'group:#"^google\s+chrome$"'))
    def test_literal_urls_and_hyphenated_titles(self):
        self.assertTrue(self.match('https://example.invalid',activity('https://example.invalid/docs')))
        self.assertTrue(self.match('semi-final',activity('semi-final draft')))
    def test_bad_syntax_rejected_even_with_no_records(self):
        values=['(',')','()','foo or','or foo','foo and','-','"unclosed','foo )','group:','duration>','duration:2m','duration>1x','duration>1m1h','start>25:00','start>12:61','start>00:00PM','label=other','title>abc','typo>5',r'#"("','x'*4097,'('*25+'a'+')'*25,' '.join(['a']*257)]
        for value in values:
            with self.subTest(value=value[:80]),self.assertRaises(PolicyError):filter_records([],value)
    def test_invalid_query_type_and_overflow_rejected(self):
        for value in [None,{},[],False,'duration>'+('9'*400)]:
            with self.subTest(value=str(value)[:30]),self.assertRaises(PolicyError):compile_query(value)
    def test_validation_does_not_execute_expressions(self):
        with patch('hotturkey.tracking_search.REGEX.match',side_effect=AssertionError('must not execute')):
            compile_query(r'#"validation-only-\d+"')
    def test_batch_regex_evaluated_once_with_deduplicated_values(self):
        rows=[activity('Window '+str(i%130)) for i in range(500)]
        matcher=RegexMatcher()
        with patch('hotturkey.tracking_search.REGEX',matcher),patch.object(matcher,'match',wraps=matcher.match) as run:
            result=filter_records(rows,r'#"Window [12]$"')
            self.assertEqual(len(result),8);self.assertEqual(run.call_count,1)
            self.assertEqual(len(run.call_args.args[1]),130)
    def test_catastrophic_regex_is_terminated(self):
        with patch('hotturkey.tracking_search.REGEX',RegexMatcher()),patch('hotturkey.tracking_regex.TIMEOUT',.1):
            start=time.monotonic()
            with self.assertRaises(PolicyError):self.match(r'#"(a+)+$"',activity('a'*5000+'!'))
            self.assertLess(time.monotonic()-start,1.5)
    def test_query_deadline_rejects_incomplete_results(self):
        matcher=RegexMatcher()
        with self.assertRaises(PolicyError):matcher.match('x',['x'],deadline=time.monotonic()-1)


class SearchIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(self.temp.name);self.t=TrackingStore(self.store);self.a,self.b=day_bounds('2026-10-28')
    def tearDown(self):self.t.close();self.store.db.close();self.temp.cleanup()
    def app(self,start=0,seconds=60,**fields):
        return self.t.add_activity({'timeline':'applications','start':self.a+start,'end':self.a+start+seconds,'title':'Draft','group_name':'Editor','application':'Editor',**fields})
    def test_day_reports_timesheet_use_the_same_grammar(self):
        self.app();self.app(60,120,title='Review');self.app(180,10,title='Private')
        query='(Draft or Review) duration>=1m -Private'
        self.assertEqual(len(self.t.day('2026-10-28',query=query)['details']),2)
        self.assertEqual(sum(row['total'] for row in self.t.report(self.a,self.b,query=query)['series']),180)
        for start,end,title in [(0,60,'Draft'),(60,180,'Review'),(180,190,'Private')]:self.t.save_tag({'start':self.a+start,'end':self.a+end,'tags':[title]})
        from hotturkey.tracking_timesheet import render
        self.assertEqual(render(self.t,self.a,self.b,{'query':query})['seconds'],180)
    def test_global_and_series_or_queries_are_parenthesized(self):
        self.app(title='Draft',application='Editor');self.app(60,title='Brief',application='Browser')
        self.app(120,title='Draft',application='Reader');self.app(180,title='Other',application='Browser')
        from hotturkey.tracking_reports import render
        result=render(self.t,self.a,self.b,{'type':'custom','query':'Draft or Brief','series':[{'timeline':'applications','query':'app:Editor or app:Browser'}]})
        self.assertEqual(result['series'][0]['total'],120)
    def test_legacy_period_duration_agrees_in_day_and_reports(self):
        for i in range(15):self.app(i,1,source='legacy')
        self.assertEqual(len(self.t.activities(self.a,self.b)),15,'raw observations remain available unchanged')
        day=self.t.day('2026-10-28',query='duration>10s');self.assertEqual(len(day['details']),1);self.assertEqual(day['details'][0]['seconds'],15)
        result=self.t.report(self.a,self.b,query='duration>10s');self.assertEqual(result['series'][0]['total'],15)
    def test_invalid_empty_queries_rejected_and_saved_definition_not_written(self):
        with self.assertRaises(PolicyError):self.t.day('2026-10-28',query='duration>oops')
        with self.assertRaises(PolicyError):self.t.activities(self.a,self.b,query='start>99:00')
        with self.assertRaises(PolicyError):self.t.save_entity('reports',{'query':'foo OR'})
        self.assertEqual(self.t.entities('reports'),[])
    def test_regex_releases_recording_database_lock(self):
        self.app(title='Lock probe');entered=threading.Event();release=threading.Event();errors=[]
        def slow(pattern,values,**kwargs):entered.set();release.wait(2);return {value:None for value in values}
        def read():
            try:self.t.day('2026-10-28',query=r'#"lock-probe"')
            except Exception as error:errors.append(error)
        with patch('hotturkey.tracking_search.REGEX.match',side_effect=slow):
            thread=threading.Thread(target=read);thread.start()
            try:
                self.assertTrue(entered.wait(1));self.assertTrue(self.t.lock.acquire(timeout=.2));self.t.lock.release()
                self.app(100,title='Recording continues')
            finally:release.set();thread.join(2)
        self.assertFalse(errors);self.assertEqual(len(self.t.activities(self.a,self.b)),2)


if __name__=='__main__':unittest.main()
