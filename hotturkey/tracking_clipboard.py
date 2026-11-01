"""Spreadsheet-friendly text from an immutable generated report."""
import csv
import io
from .model import PolicyError


def copy_rows(tracking,snapshot,kind='work',row_keys=None):
    if kind not in ['work','usage']:raise PolicyError('复制对象无效')
    report=tracking.report_snapshots.get(snapshot,kind)['report']
    if report['errors']:raise PolicyError('请先修正自动标签的计算错误')
    if row_keys is not None and (kind!='work' or not isinstance(row_keys,list) or not row_keys or len(row_keys)>10000 or any(not isinstance(k,str) for k in row_keys)):
        raise PolicyError('请选择有效的工时表行')
    rows=report['table']
    if row_keys is not None:
        valid={r['key'] for r in report['matrix']}
        if set(row_keys)-valid:raise PolicyError('所选行已变化，请重新生成')
        rows=[row for item,row in zip(report['matrix'],rows) if item['key'] in row_keys]
    output=io.StringIO(newline='');writer=csv.writer(output,delimiter='\t',lineterminator='\r\n')
    for row in [[c['name'] for c in report['columns']]]+rows:
        writer.writerow(["'"+v if isinstance(v,str) and v.lstrip(' \t\r\n').startswith(('=','+','-','@')) else v for v in row])
    value=output.getvalue()
    if len(value.encode())>4*1024*1024:raise PolicyError('内容过多，请使用文件导出')
    return {'text':value,'row_count':len(rows)}
