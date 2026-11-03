"""Authenticated local tracking UI routes. No enforcement mutation endpoints."""
import datetime as dt
import json
import time
from .model import PolicyError
from .tracking import day_bounds

def dispatch(service,path,method,data,query):
    tracking=service.tracking
    get=lambda key,default='':query.get(key,[default])[0]
    def number(key,default):
        try:return int(get(key,str(default)))
        except (ValueError,TypeError):raise PolicyError('统计数值无效') from None
    if method=='GET':
        if path=='autotags':return tracking.autotags.catalog()
        if path=='clock':return tracking.clock.status()
        if path=='tag-library':return tracking.tag_library.catalog(get('kind','combination'),get('q'),number('offset',0),number('limit',200))
        if path=='tag-library/tree':
            try:prefix=json.loads(get('prefix','[]'))
            except (ValueError,TypeError):raise PolicyError('标签层级无效') from None
            return tracking.tag_library.children(prefix,number('offset',0),number('limit',200))
        if path=='tag-library/recent':return tracking.tag_library.recent()
        if path=='tag-library/export':return tracking.tag_library.export_text()
        if path=='tags/last-untagged':return tracking.tag_library.last_untagged()
        if path=='groups':
            from .tracking_reports import group_choices
            return {'items':group_choices(tracking,get('since'),get('until'),get('timeline','applications'))}
        if path=='settings':
            status=dict(service.tracking_recorder.status)
            with tracking.lock:status['last_screenshot_at']=tracking.db.execute('SELECT MAX(at) FROM tracking_screenshots').fetchone()[0]
            return {'settings':tracking.settings(),'status':status,'directory':tracking.screenshot_storage.current()}
        if path=='day':
            try:selection=json.loads(get('selection','[]'))
            except (ValueError,TypeError):raise PolicyError('时间选择无效') from None
            if not isinstance(selection,list) or len(selection)>1000:raise PolicyError('时间选择无效')
            value=tracking.day(get('day',dt.date.today().isoformat()),get('timeline','applications'),get('q'),selection,get('untagged')=='true')
            value['status']=dict(service.tracking_recorder.status);return value
        if path=='screenshots/estimate':
            from .screenshot_estimates import estimate
            return estimate(tracking,service.tracking_recorder.status)
        if path=='screenshots/directory':return tracking.screenshot_storage.current()
        if path=='screenshots/index':return {'items':tracking.screenshots(get('since'),get('until'),query=get('q'),limit=20000,index=True)}
        if path=='screenshots/thumbnail':return tracking.screenshot_thumbnail(get('id'))
        if path=='screenshots':return {'items':tracking.screenshots(get('since'),get('until'),get('at') or None,get('q'),get('direction'),number('limit',200),get('display'))}
        if path=='screenshots/displays':return {'items':tracking.screenshot_displays(get('since'),get('until'))}
        if path=='screenshots/location':return tracking.screenshot_location(get('id'))
        if path=='screenshots/image':return tracking.screenshot(get('id'))
        if path=='report':return tracking.report(get('since'),get('until'),get('timeline','applications'),get('q'),get('group_by','day'),number('limit',10),folder=get('folder'))
        if path=='day-statistics':return {'days':tracking.day_statistics(get('since'),get('until'),get('q'))}
        if path=='timesheet':return tracking.timesheet(get('since'),get('until'),number('depth',30),None if not get('billable') else get('billable')=='true',number('round_minutes',0))
        if path=='entities':return {'items':tracking.entities(get('kind'))}
    if method=='POST':
        if path=='screenshots/directory':return tracking.screenshot_storage.choose(data.get('path'))
        if path=='website-icons':
            from .website_icons import WebsiteIcons
            if not hasattr(service,'website_icons'):service.website_icons=WebsiteIcons()
            return service.website_icons.resolve(data.get('targets'))
        if path.startswith('search/'):
            from . import tracking_find as find
            if path=='search/render':return find.render(tracking,data.get('definition'))
            if path=='search/page':return find.page(tracking,data.get('snapshot'),data.get('offset',0),data.get('limit',100),data.get('sort','start'),data.get('direction','asc'))
            if path=='search/preview':return find.preview(tracking,data.get('snapshot'),data.get('selection'))
            if path=='search/tag':return find.tag(tracking,data.get('snapshot'),data.get('selection'),data.get('tag'))
            if path=='search/export':return find.export(tracking,data.get('snapshot'),data.get('selection'),data.get('format','csv'))
        if path=='timesheet/copy':
            from .tracking_clipboard import copy_rows
            return copy_rows(tracking,data.get('snapshot'),data.get('kind','work'),data.get('row_keys'))
        if path=='timesheet/usage':
            from .tracking_usage import render
            return render(tracking,data.get('snapshot'),data.get('options'))
        if path=='timesheet/retag':
            from .tracking_usage import retag
            return retag(tracking,data.get('snapshot'),data.get('key'),data.get('tag'))
        if path=='timesheet/render':
            from .tracking_timesheet import render
            return render(tracking,data.get('since'),data.get('until'),data.get('definition'))
        if path=='autotags/save':return tracking.autotags.save(data.get('value'),data.get('id'))
        if path=='autotags/delete':return tracking.autotags.delete(data.get('id'))
        if path=='autotags/move':return tracking.autotags.move(data.get('id'),data.get('direction'))
        if path=='autotags/settings':return tracking.autotags.configure(data)
        if path=='autotags/preview':return tracking.autotags.preview(data.get('value'),data.get('since'),data.get('until'))
        if path=='autotags/convert':return tracking.autotags.convert(data.get('since'),data.get('until'),data.get('selection'),data.get('mode','untagged'))
        if path=='clock/start':return tracking.clock.start(data)
        if path=='clock/start-last':return tracking.clock.start(data,use_last=True)
        if path=='clock/command':return tracking.clock.command(data.get('action'),data.get('id'),data.get('value'))
        if path=='tag-library/save':return tracking.tag_library.save(data)
        if path=='tag-library/update':return tracking.tag_library.update(data.get('key'),data.get('value'))
        if path=='tag-library/rename':return tracking.tag_library.change(data.get('key'),data.get('parts'))
        if path=='tag-library/delete':return tracking.tag_library.change(data.get('key'),delete=True)
        if path=='tag-library/move':return tracking.tag_library.move(data.get('key'),data.get('direction'))
        if path=='tag-library/import':return tracking.tag_library.import_text(data.get('text'))
        if path=='reports/render':
            from .tracking_reports import render
            return render(tracking,data.get('since'),data.get('until'),data.get('definition'))
        if path=='export':
            if data.get('kind')=='activities':
                from .tracking_export import export
                return export(tracking,data)
            from .tracking_reports import render,report_table,timesheet_table,export_table
            if data.get('kind','report')=='timesheet':
                if data.get('snapshot') is not None:
                    from .tracking_timesheet import table as timesheet_matrix
                    value=tracking.report_snapshots.get(data['snapshot'],'work')['report']
                    if data.get('definition',value['definition'])!=value['definition']:raise PolicyError('报表选项已变化，请重新生成后导出')
                    if value['errors']:raise PolicyError('自动标签存在计算错误，请修正规则后再导出工时表')
                    rows=timesheet_matrix(value)
                elif 'definition' in data:
                    from .tracking_timesheet import render as render_timesheet,table as timesheet_matrix
                    value=render_timesheet(tracking,data.get('since'),data.get('until'),data['definition'],create_snapshot=False)
                    if value['errors']:raise PolicyError('自动标签存在计算错误，请修正规则后再导出工时表')
                    rows=timesheet_matrix(value)
                else:
                    value=tracking.timesheet(data.get('since'),data.get('until'),data.get('depth',30),data.get('billable'),data.get('round_minutes',0));rows=timesheet_table(value)
            elif data.get('kind')=='timesheet-usage':
                from .tracking_timesheet import table as usage_table
                value=tracking.report_snapshots.get(data.get('snapshot'),'usage')['report']
                if value['errors']:raise PolicyError('自动标签存在计算错误，请先修正后导出')
                if data.get('format')=='json':return json.dumps(value,ensure_ascii=False).encode(),'application/json; charset=utf-8'
                rows=usage_table(value)
            elif data.get('kind','report')=='report':rows=report_table(render(tracking,data.get('since'),data.get('until'),data.get('definition')))
            else:raise PolicyError('导出对象无效')
            return export_table(rows,data.get('format'))
        if path=='screenshots/delete':return tracking.delete_screenshots(data.get('ids'),data.get('since'),data.get('until'))
        if path=='settings':return tracking.configure(data)
        if path=='pause':
            mode=data.get('mode')
            if mode=='resume':return tracking.configure({'enabled':True,'paused_until':0})
            if mode=='manual':return tracking.configure({'enabled':False,'paused_until':0})
            if mode not in ['15m','1h','tomorrow']:raise PolicyError('暂停方式无效')
            until=time.time()+(900 if mode=='15m' else 3600) if mode!='tomorrow' else day_bounds((dt.date.today()+dt.timedelta(days=1)).isoformat())[0]
            return tracking.configure({'enabled':True,'paused_until':until})
        if path=='activities/edit':return tracking.edit_activity(data.get('id'),data.get('activity'))
        if path=='tags/save':return tracking.save_tag(data.get('tag',{}),data.get('id'))
        if path=='tags/delete':tracking.delete_tags(data.get('ids'));return {'ok':True}
        if path=='delete':return tracking.delete_range(data.get('since'),data.get('until'),data.get('timelines'))
        if path=='entities/save':return tracking.save_entity(data.get('kind'),data.get('value'),data.get('id'))
        if path=='entities/delete':tracking.delete_entity(data.get('kind'),data.get('id'));return {'ok':True}
    raise PolicyError('统计操作不存在')
