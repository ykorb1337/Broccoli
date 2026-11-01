import json
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from hotturkey.server import Service
from hotturkey.tracking import day_bounds

class TrackingServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.s=Service(self.temp.name,enforce=False);self.session=''
        self.thread=threading.Thread(target=self.s.http.serve_forever);self.thread.start();self.start,self.end=day_bounds('2026-10-28')
    def tearDown(self):
        self.s.http.shutdown();self.s.http.server_close();self.thread.join();self.s.tracking.close();self.s.store.db.close();self.s.singleton.close();self.temp.cleanup()
    def request(self,path,data=None,token=True):
        headers={'Content-Type':'application/json','X-HotTurkey-Session':self.session}
        if token:headers['Authorization']='Bearer '+self.s.token
        request=urllib.request.Request(self.s.origin+'/api/'+path,headers=headers,data=None if data is None else json.dumps(data).encode())
        try:
            with urllib.request.urlopen(request,timeout=5) as response:return response.status,json.load(response)
        except urllib.error.HTTPError as error:return error.code,json.load(error)
    def test_capability_and_real_interval_day(self):
        self.s.tracking.add_activity({'start':self.start,'end':self.start+60,'timeline':'applications','group_name':'Editor','title':'draft'})
        code,value=self.request('tracking/day?day=2026-10-28');self.assertEqual(code,200);self.assertEqual(value['summary'][0]['seconds'],60)
        self.assertEqual(self.request('state')[1]['tracking']['version'],1)
    def test_website_icons_route_local_and_authenticated(self):
        from hotturkey.website_icons import WebsiteIcons
        self.s.website_icons=WebsiteIcons([])
        self.assertEqual(self.request('tracking/website-icons',{'targets':['example.org']},token=False)[0],401)
        code,value=self.request('tracking/website-icons',{'targets':['example.org']})
        self.assertEqual(code,200);self.assertEqual(value,{'items':[{'target':'example.org','image':None}]})
        self.assertEqual(self.request('tracking/website-icons',{'targets':['x']*101})[0],400)

    def test_browser_native_host_can_fill_a_requested_icon_without_policy_changes(self):
        import base64
        from hotturkey.website_icons import WebsiteIcons
        image='data:image/png;base64,'+base64.b64encode(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')).decode()
        self.s.website_icons=WebsiteIcons([],directory=self.temp.name)
        before=json.dumps(self.s.store.state,sort_keys=True)
        self.request('tracking/website-icons',{'targets':['example.org']})
        code,reply=self.request('bridge',{'browser':'Edge','usage':[]})
        self.assertEqual(code,200);self.assertEqual(reply['website_icon_requests'],['example.org'])
        self.request('extension/website-icons',{'items':[{'target':'example.org','image':image}]})
        code,result=self.request('tracking/website-icons',{'targets':['example.org']})
        self.assertEqual(result['items'][0]['image'],image)
        self.assertEqual(json.dumps(self.s.store.state,sort_keys=True),before)
        self.assertEqual(WebsiteIcons([],directory=self.temp.name).resolve(['example.org'])['items'][0]['image'],image)
    def test_search_grammar_over_http_and_invalid_query_errors(self):
        from urllib.parse import urlencode
        for offset,title,duration in [(0,'Draft',60),(60,'Review',20),(80,'Private',120)]:
            self.s.tracking.add_activity({'start':self.start+offset,'end':self.start+offset+duration,'timeline':'applications','group_name':'Editor','title':title})
        params=urlencode({'day':'2026-10-28','q':'(Draft OR Review) duration>=1m'})
        code,value=self.request('tracking/day?'+params);self.assertEqual(code,200);self.assertEqual([r['title'] for r in value['details']],['Draft'])
        for query in ['Draft OR','duration>1x',r'#"("']:
            code,error=self.request('tracking/day?'+urlencode({'day':'2026-10-28','q':query}));self.assertEqual(code,400);self.assertIn('error',error)
        code,error=self.request('tracking/reports/render',{'since':self.start,'until':self.end,'definition':{'query':'(Draft'}});self.assertEqual(code,400)
    def test_password_protects_all_new_data_routes(self):
        self.request('settings',{'password':'fixture-password'})
        for path,data in [('tracking/day?day=2026-10-28',None),('tracking/settings',None),('tracking/tags/save',{'tag':{}}),('tracking/pause',{'mode':'manual'}),('tracking/screenshots?since=1&until=2',None),('tracking/screenshots/displays?since=1&until=2',None),('tracking/screenshots/location?id='+'a'*32,None),('tracking/reports/render',{'definition':{}}),('tracking/export',{'format':'csv'}),('tracking/tag-library',None),('tracking/tag-library/tree',None),('tracking/tag-library/recent',None),('tracking/tag-library/export',None),('tracking/tags/last-untagged',None),('tracking/tag-library/update',{}),('tracking/tag-library/delete',{}),('tracking/tag-library/import',{'text':'Private tag'}),('tracking/website-icons',{'targets':['example.org']}),('tracking/clock',None),('tracking/clock/start',{'tags':['Task']}),('tracking/clock/start-last',{}),('tracking/clock/command',{'action':'stop'})]:
            self.assertEqual(self.request(path,data)[0],400,path)
        self.session=self.request('auth',{'password':'fixture-password'})[1]['session'];self.assertEqual(self.request('tracking/settings')[0],200)
    def test_token_required_for_screenshots(self):self.assertEqual(self.request('tracking/screenshots/image?id='+'a'*32,token=False)[0],401)
    def test_autotags_real_http_preview_past_recalculation_and_conversion(self):
        self.s.tracking.add_activity({'start':self.start,'end':self.start+100,'timeline':'applications','application':'Editor','title':'Draft','group_name':'Editor'})
        value={'tags':['Client','{{title}}'],'notes':'From {{group}}','conditions':[{'field':'application','value':'Editor'}]}
        payload={'since':self.start,'until':self.end,'value':value}
        code,preview=self.request('tracking/autotags/preview',payload);self.assertEqual(code,200);self.assertEqual(preview['seconds'],100)
        self.assertEqual(self.request('tracking/autotags')[1]['items'],[])
        code,saved=self.request('tracking/autotags/save',{'value':value});self.assertEqual(code,200)
        day=self.request('tracking/day?day=2026-10-28&timeline=autotags')[1];self.assertEqual(day['summary'][0]['name'],'Client, Draft');self.assertTrue(day['autotags_enabled'])
        self.assertEqual(self.request('tracking/autotags/settings',{'first_match':True})[0],200)
        code,result=self.request('tracking/autotags/convert',{'since':self.start,'until':self.end,'selection':[[self.start+20,self.start+40]],'mode':'untagged'})
        self.assertEqual(code,200);self.assertEqual(result['seconds'],20)
        self.assertEqual(self.request('tracking/autotags/delete',{'id':saved['id']})[0],200)
        day=self.request('tracking/day?day=2026-10-28&timeline=tags')[1];self.assertEqual(day['summary'][0]['seconds'],20);self.assertEqual(day['details'][0]['notes'],'From Editor')
    def test_autotags_require_authentication_and_reject_invalid_and_get_mutations(self):
        routes=[('tracking/autotags',None),('tracking/autotags/save',{}),('tracking/autotags/delete',{}),('tracking/autotags/move',{}),('tracking/autotags/settings',{}),('tracking/autotags/preview',{}),('tracking/autotags/convert',{})]
        for route,data in routes:self.assertEqual(self.request(route,data,token=False)[0],401,route)
        self.request('settings',{'password':'fixture-password'})
        for route,data in routes:self.assertEqual(self.request(route,data)[0],400,route)
        self.session=self.request('auth',{'password':'fixture-password'})[1]['session']
        for route,_ in routes[1:]:self.assertEqual(self.request(route)[0],400,route)
        for route,data in [('tracking/autotags/save',{'value':{'conditions':[]}}),('tracking/autotags/delete',{'id':'missing'}),('tracking/autotags/settings',{'first_match':1}),('tracking/autotags/convert',{'since':1,'until':2,'mode':'bad'})]:
            self.assertEqual(self.request(route,data)[0],400,route)
    def test_autotag_regex_captures_and_inferred_gap_are_visible_over_http(self):
        for a,b,title in [(0,30,'/work/Client A/one.txt'),(40,100,'/work/Client A/two.txt')]:
            self.s.tracking.add_activity({'start':self.start+a,'end':self.start+b,'timeline':'documents','title':title,'group_name':'Files'})
        value={'tags':['Work','{{1}}'],'conditions':[{'timeline':'documents','field':'title','operator':'regex','value':r'^/work/([^/]+)/.*$'}]}
        code,preview=self.request('tracking/autotags/preview',{'since':self.start,'until':self.end,'value':value});self.assertEqual(code,200);self.assertEqual(preview['seconds'],90)
        self.assertEqual(self.request('tracking/autotags/save',{'value':value})[0],200);self.assertEqual(self.request('tracking/autotags/settings',{'gap_seconds':11})[0],200)
        code,day=self.request('tracking/day?day=2026-10-28&timeline=autotags');self.assertEqual(code,200);self.assertEqual(day['summary'][0]['seconds'],100)
        guess=next(r for r in day['details'] if r['inferred']);self.assertTrue(guess['highlighted']);self.assertEqual(guess['tags'],['Work','Client A']);self.assertEqual(guess['seconds'],10)
    def test_tag_save_and_delete_preserve_policy_locks_and_charges(self):
        self.s.store.charge(self.start,'rule',42);before=json.dumps(self.s.store.state,sort_keys=True)
        code,result=self.request('tracking/tags/save',{'tag':{'start':self.start,'end':self.start+60,'tags':['Study']}})
        self.assertEqual(code,200);self.assertEqual(self.request('tracking/tags/delete',{'ids':result['ids']})[0],200)
        self.assertEqual(json.dumps(self.s.store.state,sort_keys=True),before);self.assertEqual(self.s.store.used('rule',0),42)
    def test_bad_dates_selection_and_methods_return_client_error(self):
        for path in ['tracking/day?day=nope','tracking/day?day=2026-10-28&selection=nope','tracking/screenshots?since=5&until=1','tracking/report?since=1&until=2&limit=nope','tracking/timesheet?since=1&until=2&depth=nope']:
            self.assertEqual(self.request(path)[0],400,path)
        self.assertEqual(self.request('tracking/unknown')[0],400)
    def test_screenshot_deletion_requires_post(self):
        from unittest.mock import patch
        with patch.object(self.s.tracking,'delete_screenshots',return_value={'deleted':0}) as deletion:
            self.assertEqual(self.request('tracking/screenshots/delete?since=1&until=2')[0],400);deletion.assert_not_called()
            self.assertEqual(self.request('tracking/screenshots/delete',{'since':1,'until':2})[0],200);deletion.assert_called_once_with(None,1,2)
    def test_pause_and_resume_do_not_change_global_blocking_setting(self):
        self.assertEqual(self.request('tracking/pause',{'mode':'manual'})[0],200);self.assertFalse(self.s.tracking.settings()['enabled'])
        self.request('tracking/pause',{'mode':'resume'});self.assertTrue(self.s.tracking.settings()['enabled']);self.assertTrue(self.s.store.state['settings']['statistics'])
    def binary_export(self,data):
        request=urllib.request.Request(self.s.origin+'/api/tracking/export',headers={'Authorization':'Bearer '+self.s.token,'Content-Type':'application/json','X-HotTurkey-Session':self.session},data=json.dumps(data).encode())
        with urllib.request.urlopen(request,timeout=5) as response:return response.headers['Content-Type'],response.read()
    def test_custom_render_and_exports_share_authenticated_interval_data(self):
        import csv,io,zipfile,xml.etree.ElementTree as ET
        self.s.tracking.add_activity({'start':self.start,'end':self.start+180,'timeline':'applications','group_name':'Editor','title':'draft'})
        payload={'since':self.start,'until':self.end,'definition':{'type':'custom','series':[{'name':'Work','timeline':'applications','groups':['Editor']}]}}
        code,report=self.request('tracking/reports/render',payload);self.assertEqual(code,200);self.assertEqual(report['series'][0]['values'],[180])
        mime,data=self.binary_export({**payload,'format':'csv'});self.assertTrue(mime.startswith('text/csv'))
        self.assertEqual(list(csv.reader(io.StringIO(data.decode('utf-8-sig')))),[['日期','Work（秒）'],['2026-10-28','180.0']])
        mime,data=self.binary_export({**payload,'format':'xlsx'});self.assertTrue(mime.endswith('spreadsheetml.sheet'))
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            root=ET.fromstring(archive.read('xl/worksheets/sheet1.xml'));ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            self.assertEqual(float(root.find('.//s:c[@r="B2"]/s:v',ns).text),180)
    def test_timesheet_export_keeps_notes_and_rounding(self):
        import csv,io
        self.s.tracking.save_tag({'start':self.start,'end':self.start+180,'tags':['Client','Project'],'notes':'Unicode 中文\nSecond line'})
        mime,data=self.binary_export({'kind':'timesheet','since':self.start,'until':self.end,'depth':1,'round_minutes':5,'format':'csv'})
        rows=list(csv.reader(io.StringIO(data.decode('utf-8-sig'))));self.assertEqual(rows[1],['Client','2026-10-28','180.0','300','Unicode 中文\nSecond line'])
    def test_timesheet_matrix_options_and_exports_share_exact_values(self):
        import csv,io,zipfile,xml.etree.ElementTree as ET
        self.s.tracking.save_tag({'start':self.start,'end':self.start+181,'tags':['Client','Project'],'notes':'Kept','billable':True})
        payload={'since':self.start,'until':self.end,'definition':{'group_fields':['level:2'],'billable':True,'round_minutes':5,'include_unrounded':True,'total_by':'none'}}
        code,value=self.request('tracking/timesheet/render',payload);self.assertEqual(code,200);self.assertEqual(value['table'],[['Project',300,181.0,'Kept']])
        mime,data=self.binary_export({**payload,'kind':'timesheet','format':'csv'});rows=list(csv.reader(io.StringIO(data.decode('utf-8-sig'))))
        self.assertEqual(rows[0],[c['name'] for c in value['columns']]);self.assertEqual(rows[1],['Project','300','181.0','Kept'])
        mime,data=self.binary_export({**payload,'kind':'timesheet','format':'xlsx'})
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            root=ET.fromstring(archive.read('xl/worksheets/sheet1.xml'));ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            self.assertEqual(float(root.find('.//s:c[@r="B2"]/s:v',ns).text),300);self.assertEqual(float(root.find('.//s:c[@r="C2"]/s:v',ns).text),181)
    def test_timesheet_routes_presets_and_export_require_auth_and_validate_inputs(self):
        routes=[('tracking/timesheet/render',{'since':self.start,'until':self.end}),('tracking/entities?kind=timesheets',None),('tracking/entities/save',{'kind':'timesheets','value':{'name':'Saved','definition':{}}}),('tracking/export',{'kind':'timesheet','definition':{}})]
        for path,data in routes:self.assertEqual(self.request(path,data,token=False)[0],401,path)
        self.request('settings',{'password':'fixture-password'})
        for path,data in routes:self.assertEqual(self.request(path,data)[0],400,path)
        self.session=self.request('auth',{'password':'fixture-password'})[1]['session']
        code,saved=self.request('tracking/entities/save',{'kind':'timesheets','value':{'name':'Saved','definition':{'sources':['autotags']},'date_range':{'from':'2026-10-01','through':'2026-10-28'}}})
        self.assertEqual(code,200);self.assertEqual(self.request('tracking/entities?kind=timesheets')[1]['items'],[saved])
        self.assertEqual(self.request('tracking/timesheet/render')[0],400)
        for definition in [[],{'sources':[]},{'billable':1},{'group_fields':['level:0']},{'round_minutes':61},{'query':'"bad'}]:
            self.assertEqual(self.request('tracking/timesheet/render',{'since':self.start,'until':self.end,'definition':definition})[0],400)
    def test_timesheet_export_refuses_partial_autotag_results(self):
        self.s.tracking.add_activity({'start':self.start,'end':self.start+100,'timeline':'applications','application':'Editor','title':'bad,name'})
        self.s.tracking.autotags.save({'tags':['{{title}}'],'conditions':[{'field':'application','value':'Editor'}]})
        payload={'since':self.start,'until':self.end,'definition':{'sources':['autotags']}}
        code,result=self.request('tracking/timesheet/render',payload);self.assertEqual(code,200);self.assertEqual(len(result['errors']),1)
        self.assertEqual(self.request('tracking/export',{**payload,'kind':'timesheet','format':'csv'})[0],400)
    def test_timesheet_snapshots_export_generated_values_and_complete_usage_pages(self):
        import csv,io
        tags=self.s.tracking.save_tag({'ranges':[[self.start+10,self.start+30],[self.start+50,self.start+70]],'tags':['Work']})
        for a,b,title in [(0,40,'First'),(40,80,'Second'),(90,100,'Outside')]:
            self.s.tracking.add_activity({'start':self.start+a,'end':self.start+b,'timeline':'applications','application':'Editor','title':title})
        payload={'since':self.start,'until':self.end,'definition':{'total_by':'none'}}
        code,work=self.request('tracking/timesheet/render',payload);self.assertEqual(code,200)
        code,usage=self.request('tracking/timesheet/usage',{'snapshot':work['snapshot'],'options':{'limit':1}})
        self.assertEqual(code,200);self.assertEqual(usage['total'],2);self.assertEqual(len(usage['items']),1);self.assertEqual(usage['seconds'],40)
        self.s.tracking.delete_tags(tags['ids'])
        mime,data=self.binary_export({'kind':'timesheet','snapshot':work['snapshot'],'format':'csv'})
        self.assertEqual(list(csv.reader(io.StringIO(data.decode('utf-8-sig'))))[1][0:2],['Work','40.0'])
        mime,data=self.binary_export({'kind':'timesheet-usage','snapshot':usage['snapshot'],'format':'csv'})
        rows=list(csv.reader(io.StringIO(data.decode('utf-8-sig'))));self.assertEqual(len(rows),3);self.assertEqual([r[0] for r in rows[1:]],['First','Second'])
        mime,data=self.binary_export({'kind':'timesheet-usage','snapshot':usage['snapshot'],'format':'json'})
        value=json.loads(data);self.assertEqual(len(value['items']),2);self.assertNotIn('snapshot',value);self.assertNotIn('work',value)
        self.assertEqual(self.request('tracking/export',{'kind':'timesheet','snapshot':work['snapshot'],'definition':{},'format':'csv'})[0],400)
    def test_usage_retag_over_http_changes_only_the_selected_activity_intersections(self):
        t=self.s.tracking;t.save_tag({'start':self.start,'end':self.start+100,'tags':['Work']})
        t.add_activity({'start':self.start+10,'end':self.start+20,'timeline':'applications','application':'Editor','title':'Selected'})
        t.add_activity({'start':self.start+50,'end':self.start+70,'timeline':'applications','application':'Editor','title':'Selected'})
        before=json.dumps(self.s.store.state,sort_keys=True)
        work=self.request('tracking/timesheet/render',{'since':self.start,'until':self.end})[1]
        usage=self.request('tracking/timesheet/usage',{'snapshot':work['snapshot'],'options':{'group_by':'title'}})[1]
        code,result=self.request('tracking/timesheet/retag',{'snapshot':usage['snapshot'],'key':usage['items'][0]['key'],'tag':{'tags':['Other'],'billable':False}})
        self.assertEqual(code,200);self.assertEqual(result['range_count'],2);self.assertEqual(result['seconds'],30)
        rows=t.tags(self.start,self.end);self.assertEqual(sum(r['seconds'] for r in rows if r['tags']==['Other']),30)
        self.assertEqual(sum(r['seconds'] for r in rows if r['tags']==['Work']),70);self.assertEqual(json.dumps(self.s.store.state,sort_keys=True),before)
        self.assertEqual(self.request('tracking/timesheet/retag',{'snapshot':usage['snapshot'],'key':usage['items'][0]['key'],'tag':{'tags':['Again']}})[0],400)
    def test_usage_snapshot_routes_protect_private_data_and_require_post(self):
        routes=[('tracking/timesheet/usage',{'snapshot':'x'}),('tracking/timesheet/retag',{'snapshot':'x','key':'x','tag':{}}),('tracking/export',{'kind':'timesheet-usage','snapshot':'x','format':'json'}),('tracking/timesheet/copy',{'snapshot':'x'})]
        for route,data in routes:self.assertEqual(self.request(route,data,token=False)[0],401,route)
        self.request('settings',{'password':'fixture-password'})
        for route,data in routes:self.assertEqual(self.request(route,data)[0],400,route)
        self.session=self.request('auth',{'password':'fixture-password'})[1]['session']
        for route,data in routes:
            self.assertEqual(self.request(route,data)[0],400,route);self.assertEqual(self.request(route)[0],400,route)
    def test_report_definition_validation_is_client_error(self):
        for definition in [{'type':[]},{'limit':0},{'series':[{'timeline':'applications','match':'all'}]}]:
            self.assertEqual(self.request('tracking/reports/render',{'since':self.start,'until':self.end,'definition':definition})[0],400)
        self.assertEqual(self.request('tracking/export',{'since':self.start,'until':self.end,'definition':{},'format':'invalid'})[0],400)
    def test_tag_library_real_http_hierarchy_rename_and_delete(self):
        import time
        from hotturkey.tracking_tags import identity
        block=self.s.engine.save_block({'name':'Locked scope fixture','enabled':True,'websites':['scope.invalid']})
        self.s.engine.set_lock(block['id'],{'type':'timer','until':time.time()+3600});self.s.store.charge(self.start,block['id'],17)
        before=json.dumps(self.s.store.state,sort_keys=True)
        self.assertEqual(self.request('tracking/tag-library/import',{'text':'Client, Project\nClient, Project, Design'})[1]['added'],2)
        self.assertEqual(self.request('tracking/tag-library/tree?prefix=%5B%22Client%22%5D')[1]['items'][0]['name'],'Project')
        self.request('tracking/tags/save',{'tag':{'tags':['Client','Project'],'start':self.start,'end':self.start+60,'notes':'Kept','billable':True}})
        code,result=self.request('tracking/tag-library/update',{'key':identity('tag',['Client']),'value':{'parts':['Alpha'],'color':'#123456','skip':True}})
        self.assertEqual(code,200);self.assertEqual(result['changed'],1);self.assertEqual(self.request('tracking/tag-library/recent')[1]['items'][0]['parts'],['Alpha','Project'])
        self.assertEqual(self.request('tracking/tag-library/export')[1]['text'],'Alpha, Project\nAlpha, Project, Design\n')
        self.assertEqual(self.request('tracking/tag-library/delete',{'key':identity('combination',['Alpha','Project'])})[0],200)
        self.assertEqual(self.s.tracking.tags(self.start,self.end),[])
        self.assertEqual(json.dumps(self.s.store.state,sort_keys=True),before);self.assertEqual(self.s.store.used(block['id'],0),17)
    def test_tag_library_invalid_inputs_and_get_mutations_are_client_errors(self):
        for path,data in [('tracking/tag-library?limit=nope',None),('tracking/tag-library/tree?prefix=nope',None),('tracking/tag-library/tree?prefix=null',None),('tracking/tag-library?kind=bad',None),('tracking/tag-library/save',{'kind':'tag','parts':['Bad\nName']}),('tracking/tag-library/rename',{'key':'missing','parts':['Name']}),('tracking/tag-library/delete?key=missing',None)]:
            self.assertEqual(self.request(path,data)[0],400,path)
    def test_clock_http_commands_save_real_tag_intervals_and_reject_stale_id(self):
        now=[self.start];self.s.tracking.clock.clock=lambda:now[0]
        code,state=self.request('tracking/clock/start',{'tags':['HTTP task'],'kind':'countdown','duration_seconds':30});self.assertEqual(code,200)
        now[0]+=10;self.assertEqual(self.request('tracking/clock/command',{'id':state['id'],'action':'pause'})[1]['elapsed'],10)
        now[0]+=100;self.request('tracking/clock/command',{'id':state['id'],'action':'resume'});now[0]+=50
        result=self.request('tracking/clock')[1];self.assertEqual(result['status'],'finished');self.assertEqual(result['elapsed'],30)
        self.assertEqual([(r['start']-self.start,r['end']-self.start) for r in self.s.tracking.tags(self.start,self.end)],[(0,10),(110,130)])
        self.assertEqual(self.request('tracking/clock/command',{'id':'stale','action':'stop'})[0],400)
        self.assertEqual(self.request('tracking/clock/start?tags=bad')[0],400)
    def test_invalid_clock_inputs_do_not_create_time_or_change_policy(self):
        before=json.dumps(self.s.store.state,sort_keys=True)
        for path,value in [('tracking/clock/start',{'tags':[]}),('tracking/clock/start',{'tags':['A'],'kind':[]}),('tracking/clock/start-last',{}),('tracking/clock/command',{'action':'stop'})]:
            self.assertEqual(self.request(path,value)[0],400)
        self.assertEqual(self.s.tracking.tags(self.start,self.end),[]);self.assertEqual(json.dumps(self.s.store.state,sort_keys=True),before)


class TrackingClockBackgroundTests(unittest.TestCase):
    def test_real_service_finishes_countdown_with_no_ui_or_status_poll(self):
        import time
        with tempfile.TemporaryDirectory(dir='/private/tmp',prefix='ht-clock-worker-') as directory:
            service=Service(directory,enforce=False);service.store.charge(time.time(),'clock-proof-rule',42)
            state=service.tracking.clock.start({'tags':['Background fixture'],'kind':'countdown','duration_seconds':1})
            thread=threading.Thread(target=service.run);thread.start()
            try:
                until=time.monotonic()+6;stored={}
                while time.monotonic()<until:
                    with service.tracking.lock:stored=json.loads(service.tracking.db.execute('SELECT value FROM tracking_clock WHERE id=1').fetchone()[0])
                    if stored['status']=='finished':break
                    time.sleep(.05)
                self.assertEqual(stored['status'],'finished')
                with service.tracking.lock:row=service.tracking.db.execute("SELECT start,end,tags,source FROM tracking_tags WHERE source='clock'").fetchone()
                self.assertEqual(row['end']-row['start'],1);self.assertEqual(json.loads(row['tags']),['Background fixture']);self.assertEqual(service.store.used('clock-proof-rule',0),42)
            finally:
                service.http.shutdown();thread.join(timeout=10);self.assertFalse(thread.is_alive());service.store.db.close()

if __name__=='__main__':unittest.main()
