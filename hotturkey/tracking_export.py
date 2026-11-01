"""Exact date/time-range activity export, independent of block policies."""
import datetime as dt
import json
from .model import PolicyError
from .tracking_find import definition,collect
from .tracking_reports import export_table


def export(tracking,payload):
    value=definition(payload.get('definition'))
    format=payload.get('format','csv')
    if format not in ['csv','xlsx','json']:raise PolicyError('统计导出格式无效')
    result=collect(tracking,value)
    if result['errors']:raise PolicyError('自动标签存在计算错误，请修正后再导出')
    items=[{k:v for k,v in row.items() if k not in ['key','first_range','first_activity_id']} for row in result['items']]
    if format=='json':return json.dumps({'format':'hotturkey-activities-v1','definition':value,'activities':items},ensure_ascii=False,indent=2).encode(),'application/json; charset=utf-8'
    stamp=lambda at:dt.datetime.fromtimestamp(at).astimezone().isoformat(timespec='seconds')
    names={'applications':'应用程序','documents':'文档','computer':'电脑使用','tags':'标签','autotags':'自动标签'}
    rows=[['时间线','开始','结束','期间（秒）','应用程序','标题','网址或文件路径','备注','来源']]
    rows.extend([[names.get(r['timeline'],r['timeline']),stamp(r['start']),stamp(r['end']),r['seconds'],r['application'],r['title'],r['url'] or r['document'],r['notes'],r['source']] for r in items])
    return export_table(rows,format)
