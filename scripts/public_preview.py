#!/usr/bin/env python3
"""Publication-only UI: anonymous labels over today's real interval snapshot."""
import datetime as dt
import json
from pathlib import Path
import sys
import tempfile
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from preview_today import copy_today
from hotturkey.server import Service
from hotturkey.tracking import DEFAULTS

def redact(service):
    tracking=service.tracking;aliases={};sites={};documents={}
    apps=[('Safari','com.apple.Safari'),('备忘录','com.apple.Notes'),('文本编辑','com.apple.TextEdit'),('邮件','com.apple.mail'),('日历','com.apple.iCal'),('预览','com.apple.Preview'),('终端','com.apple.Terminal'),('音乐','com.apple.Music'),('提醒事项','com.apple.reminders'),('访达','com.apple.finder'),('计算器','com.apple.calculator'),('系统设置','com.apple.systempreferences')]
    hosts=['developer.apple.com','docs.python.org','github.com','developer.mozilla.org','swift.org','wikipedia.org','figma.com','notion.so','stackoverflow.com','arxiv.org','readthedocs.io','web.dev']
    labels=['项目方案','阅读笔记','周计划','界面草图','数据分析','发布清单','会议纪要','学习摘录','接口设计','功能规划','参考资料','测试记录']
    with tracking.lock,tracking.db:
        rows=tracking.db.execute('SELECT * FROM tracking_activities ORDER BY start').fetchall()
        for row in rows:
            browser=bool(row['url']) or row['bundle'] in ['com.microsoft.edgemac','com.google.Chrome','com.apple.Safari']
            original=row['bundle'] or row['application'] or 'unknown'
            if original not in aliases:aliases[original]=apps[0] if browser else apps[1+len(aliases)%(len(apps)-1)]
            app,bundle=aliases[original];title='阅读与整理';url='';document='';group=app
            if row['timeline']=='computer':
                title=group=next((v for v in ['Session lock','Power off','Inactive','Active'] if v.lower() in row['title'].lower()),'Active');app='';bundle=''
            elif row['timeline']=='documents':
                if browser:
                    key=urlsplit(row['url']).hostname or row['group_name']
                    if key not in sites:sites[key]=hosts[len(sites)%len(hosts)]
                    original_document=row['url'] or row['document'] or row['title']
                    if original_document not in documents:documents[original_document]=len(documents)
                    url='https://'+sites[key]+'/guide/'+str(documents[original_document]+1);title=labels[documents[original_document]%len(labels)];document=url;group=sites[key]
                else:
                    key=(original,row['document'] or row['title'])
                    if key not in documents:documents[key]=len(documents)
                    title=labels[documents[key]%len(labels)]+' · '+str(documents[key]+1);document=title;group=document
            tracking.db.execute('UPDATE tracking_activities SET title=?,group_name=?,application=?,bundle=?,path=?,url=?,document=?,source=?,metadata=? WHERE id=?',(title,group,app,bundle,'',url,document,'sampler','{}',row['id']))
        for table in ['tracking_screenshots','tracking_tags','tracking_entities','tracking_tag_library','tracking_tag_nodes','tracking_autotag_overrides','tracking_meta']:
            tracking.db.execute('DELETE FROM '+table)
        tracking.db.execute('UPDATE tracking_settings SET value=?',(json.dumps(DEFAULTS),))
    tracking.close();service.tracking=None;service.tracking_recorder=None;service.initialize_tracking();service.engine.user='Demo'
    spans=[(r['start'],r['end']) for r in rows if r['timeline']=='computer' and r['end']-r['start']>1800]
    for index,(start,end) in enumerate(spans[:8]):
        service.tracking.save_tag({'ranges':[[start,end]],'tags':[['项目','开发'],['学习','阅读'],['项目','设计']][index%3],'color':['#007aff','#30a46c','#af52de'][index%3]})
    return len(rows)

def examples(service):
    engine=service.engine
    first=engine.save_block({'name':'深度工作','enabled':True,'mode':'scheduled','websites':['youtube.com','reddit.com'],'applications':['bundle:com.apple.Music'],'schedule':[{'days':[0,1,2,3,4],'start':540,'end':720}]})
    engine.save_block({'name':'阅读时间','enabled':False,'mode':'scheduled','websites':['bilibili.com','x.com'],'schedule':[{'days':[0,1,2,3,4],'start':840,'end':960}]})
    engine.save_block({'name':'晚间休息','enabled':False,'device':'sleep','confirm_device':True,'mode':'scheduled','schedule':[{'days':[0,1,2,3,4,5,6],'start':1380,'end':420}]})
    engine.set_lock(first['id'],{'type':'timer','until':engine.now()+3600})

def main():
    with tempfile.TemporaryDirectory(prefix='hotturkey-public-',dir='/private/tmp') as directory:
        service=Service(directory,enforce=False)
        try:
            proof=copy_today(Path.home()/'Library/Application Support/HotTurkey',service,dt.datetime.now().astimezone().date().isoformat(),copy_images=False)
            count=redact(service);examples(service)
            from hotturkey.google_calendar_preview import CalendarSnapshot
            service.google_calendar=CalendarSnapshot({})
            proof.update(publication_preview=True,all_activity_text_replaced=True,private_images_copied=False,google_credentials_copied=False,interval_rows_preserved=count,data_directory=directory)
            output=ROOT/'build/public-preview.json';output.write_text(json.dumps({'url':service.origin+'/#token='+service.token,**proof},ensure_ascii=False,indent=2));output.chmod(0o600)
            print(json.dumps({'origin':service.origin,'data_directory':directory,'anonymous_interval_rows':count}),flush=True)
            service.http.serve_forever()
        except KeyboardInterrupt:pass
        finally:service.http.server_close()

if __name__=='__main__':main()
