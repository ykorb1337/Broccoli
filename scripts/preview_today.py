#!/usr/bin/env python3
"""Interactive preview using an isolated copy of today's installed statistics."""
import argparse
from contextlib import closing
import datetime as dt
import json
import re
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from hotturkey.server import Service
from hotturkey.tracking import day_bounds


def copy_today(source,service,day):
    """One read transaction, allowlisted tables, no policy or credential copy."""
    source=Path(source).resolve();destination=service.store.directory.resolve()
    if source==destination:raise ValueError('预览目录不能是安装版数据目录')
    since,until=day_bounds(day);tracking=service.tracking
    if tracking is None:raise RuntimeError('无法初始化预览统计资料库')
    counts={};shot_files=[]
    with closing(sqlite3.connect((source/'tracking.sqlite3').as_uri()+'?mode=ro',uri=True,timeout=5)) as reader:
        reader.row_factory=sqlite3.Row;reader.execute('PRAGMA query_only=ON');reader.execute('BEGIN')
        tables={r[0] for r in reader.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        required={'tracking_activities','tracking_tags','tracking_screenshots','tracking_settings'}
        if not required<=tables:raise ValueError('安装版统计资料格式不完整')
        with tracking.lock,tracking.db:
            for table in ['tracking_activities','tracking_tags','tracking_screenshots','tracking_settings','tracking_entities','tracking_tag_library','tracking_tag_nodes','tracking_autotag_overrides']:
                if table not in tables:continue
                target_columns={r[1] for r in tracking.db.execute('PRAGMA table_info('+table+')')}
                columns=[r[1] for r in reader.execute('PRAGMA table_info('+table+')') if r[1] in target_columns]
                if not columns:continue
                sql='SELECT '+','.join(columns)+' FROM '+table;params=()
                if table in ['tracking_activities','tracking_tags']:
                    sql+=' WHERE end>? AND start<?';params=(since,until)
                elif table=='tracking_screenshots':sql+=' WHERE at>=? AND at<?';params=(since,until)
                tracking.db.execute('DELETE FROM '+table);count=0
                for item in reader.execute(sql,params):
                    row=dict(item)
                    if table in ['tracking_activities','tracking_tags']:row['start']=max(since,row['start']);row['end']=min(until,row['end'])
                    if table=='tracking_screenshots':shot_files.append(row['file'])
                    tracking.db.execute('INSERT INTO '+table+' ('+','.join(columns)+') VALUES ('+','.join('?' for _ in columns)+')',[row[c] for c in columns]);count+=1
                counts[table]=count
            if 'tracking_meta' in tables:
                for key,value in reader.execute("SELECT key,value FROM tracking_meta WHERE key='autotag-options'"):
                    tracking.db.execute('INSERT OR REPLACE INTO tracking_meta VALUES(?,?)',(key,value))
            tracking.db.execute('DELETE FROM tracking_autotag_overrides WHERE tag_id NOT IN (SELECT id FROM tracking_tags)')
        reader.rollback()
    # Reload settings from the copied row; no recorder, clock or device worker
    # is started by this preview process.
    tracking.close();service.tracking=None;service.tracking_recorder=None
    if not service.initialize_tracking():raise RuntimeError('无法读取复制的统计资料')
    missing_images=0
    for relative in shot_files:
        if not isinstance(relative,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}/[a-f0-9]{32}\.(jpg|png|webp)',relative):missing_images+=1;continue
        image=(source/'screenshots'/relative).resolve();base=(source/'screenshots').resolve()
        if base not in image.parents or not image.is_file():missing_images+=1;continue
        shot_root=destination/'screenshots';shot_root.mkdir(exist_ok=True,mode=0o700)
        target=shot_root/relative;target.parent.mkdir(parents=True,exist_ok=True,mode=0o700);shutil.copyfile(image,target);target.chmod(0o600)
        service.tracking.screenshot_path(relative)
    if service.store.state['blocks'] or service.enforce:raise RuntimeError('预览隔离检查失败')
    result={'day':day,'copied_at':dt.datetime.now().astimezone().isoformat(),'source':'installed-local-statistics','counts':counts,'missing_screenshot_files':missing_images,'enforcement':False,'policy_rules_copied':False,'installed_data_modified':False,'snapshot':True}
    (destination/'preview-source.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));(destination/'preview-source.json').chmod(0o600)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,default=Path.home()/'Library/Application Support/HotTurkey')
    parser.add_argument('--day',default=dt.datetime.now().astimezone().date().isoformat())
    parser.add_argument('--port',type=int,default=0)
    parser.add_argument('--output',type=Path,default=ROOT/'build/current-day-preview-url.txt')
    args=parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='hotturkey-today-preview-') as directory:
        service=Service(directory,port=args.port,enforce=False)
        try:
            proof=copy_today(args.source,service,args.day)
            args.output.parent.mkdir(parents=True,exist_ok=True)
            args.output.write_text(service.origin+'/#token='+service.token);args.output.chmod(0o600)
            args.output.with_name(args.output.stem+'-proof.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2))
            print(json.dumps({'origin':service.origin,**proof},ensure_ascii=False),flush=True)
            service.http.serve_forever()
        except KeyboardInterrupt:pass
        finally:
            service.http.server_close()
            if service.tracking:service.tracking.close()
            service.store.db.close();service.singleton.close()

if __name__=='__main__':main()
