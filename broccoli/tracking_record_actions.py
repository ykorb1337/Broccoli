"""Operations on explicit recorded identities and their visible intervals."""
import uuid
from pathlib import Path
from urllib.parse import unquote, urlsplit
import subprocess

from .model import PolicyError
from .tracking import TIMELINES, bounds, intervals, subtract


def delete_records(tracking, records):
    if not isinstance(records, list) or not 1 <= len(records) <= 20000:
        raise PolicyError('请选择 1–20000 条记录')
    selected = {}
    for record in records:
        if not isinstance(record, dict):
            raise PolicyError('记录选择无效')
        timeline, ident = record.get('timeline'), record.get('id')
        if timeline not in TIMELINES or timeline == 'autotags':
            raise PolicyError('自动标签请通过标签规则修改')
        if not isinstance(ident, str) or not ident or len(ident) > 100:
            raise PolicyError('记录标识无效')
        ranges = record.get('ranges')
        if not isinstance(ranges, list) or not 1 <= len(ranges) <= 1000:
            raise PolicyError('记录时段无效')
        if any(not isinstance(span, list) or len(span) != 2 for span in ranges):
            raise PolicyError('记录时段无效')
        selected.setdefault((timeline, ident), []).extend(bounds(*span) for span in ranges)

    deleted = 0
    with tracking.tag_library.transaction():
        for (timeline, ident), ranges in selected.items():
            ranges = intervals(ranges)
            if timeline == 'tags':
                exists = tracking.db.execute('SELECT 1 FROM tracking_tags WHERE id=?', (ident,)).fetchone()
                tracking.tag_library.cut_ranges(ranges, ids={ident})
                deleted += bool(exists)
                continue
            row = tracking.db.execute('SELECT * FROM tracking_activities WHERE id=? AND timeline=?', (ident, timeline)).fetchone()
            if row is None:
                continue
            pieces = subtract([[row['start'], row['end']]], ranges)
            if pieces == [[row['start'], row['end']]]:
                continue
            tracking.db.execute('DELETE FROM tracking_activities WHERE id=?', (ident,))
            for start, end in pieces:
                value = {**dict(row), 'id': uuid.uuid4().hex, 'start': start, 'end': end}
                columns = list(value)
                tracking.db.execute('INSERT INTO tracking_activities (' + ','.join(columns) + ') VALUES (' + ','.join('?' for _ in columns) + ')', list(value.values()))
            deleted += 1
    return {'ok': True, 'count': deleted}


def reveal_record(tracking, ident):
    if not isinstance(ident, str) or len(ident) > 100:
        raise PolicyError('记录标识无效')
    with tracking.lock:
        row = tracking.db.execute("SELECT url,document FROM tracking_activities WHERE id=? AND timeline='documents'", (ident,)).fetchone()
    if row is None:
        raise PolicyError('找不到文件记录')
    value = row['url'] or row['document']
    if value.startswith('/'):
        path = Path(value)
    else:
        url = urlsplit(value)
        if url.scheme != 'file' or url.netloc not in ('', 'localhost'):
            raise PolicyError('此记录不是本地文件')
        path = Path(unquote(url.path))
    if not path.is_file():
        raise PolicyError('文件已移动或不存在')
    try:
        subprocess.run(['/usr/bin/open', '-R', str(path)], check=True, timeout=10, capture_output=True)
    except (OSError, subprocess.SubprocessError):
        raise PolicyError('无法在访达中显示文件，请稍后重试') from None
    return {'ok': True}
