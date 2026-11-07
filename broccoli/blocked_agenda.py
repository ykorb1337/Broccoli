"""A small, cache-only calendar summary for the extension's blocked page."""
import datetime as dt
import json
import math
import re
from pathlib import Path

MAX_AGE = 86400


def event_color(event, calendar):
    palette={'1':'#7986cb','2':'#33b679','3':'#8e24aa','4':'#e67c73','5':'#f6bf26','6':'#f4511e','7':'#039be5','8':'#616161','9':'#3f51b5','10':'#0b8043','11':'#d50000'}
    if str(event.get('colorId')) in palette:return palette[str(event['colorId'])]
    title=str(event.get('summary',''))
    for pattern,color in [(r'\b(DDL|deadlines?|due)\b','#d50000'),(r'\brelease\b','#f6bf26'),(r'\b(labs?|coding lab)\b','#0b8043'),(r'\b(campus|registration|appointment)\b','#009688'),(r'\b(exams?|midterm|programming test)\b','#8e24aa')]:
        if re.search(pattern,title,re.I):return color
    return '#0b8043' if 'holiday' in calendar.lower() else '#4285f4'


def agenda_from_cache(cache, now=None):
    local = now is None
    now = now or dt.datetime.now().astimezone()
    zone = None if local else now.tzinfo
    first = now.date()
    feeds = []
    for key, feed in cache.items() if isinstance(cache, dict) else []:
        try:
            calendar, start, end = json.loads(key)
            start, end = dt.datetime.fromisoformat(start.replace('Z', '+00:00')), dt.datetime.fromisoformat(end.replace('Z', '+00:00'))
            synced = feed.get('synced_at', 0)
            if not start.tzinfo or not end.tzinfo or type(synced) not in (int, float) or not math.isfinite(synced) or not 0 <= now.timestamp() - synced <= MAX_AGE:
                continue
            if not isinstance(calendar, str) or not isinstance(feed.get('items'), list):continue
            feeds.append((calendar, start, end, synced, feed['items']))
        except (ValueError, TypeError, AttributeError):continue
    days = []
    for offset in range(3):
        day = first + dt.timedelta(days=offset)
        start = dt.datetime.combine(day, dt.time(), zone)
        end = dt.datetime.combine(day + dt.timedelta(days=1), dt.time(), zone)
        if local:start, end = start.astimezone(), end.astimezone()
        latest = {}
        for calendar, a, b, synced, items in feeds:
            if a <= start and b >= end and synced >= latest.get(calendar, (0, []))[0]:latest[calendar] = (synced, items)
        rows = []
        for calendar, (_, events) in latest.items():
            seen = set()
            for event in events:
                try:
                    if event.get('status') == 'cancelled':continue
                    points = event['start'], event['end']
                    if points[0].get('date'):
                        a, b = (dt.date.fromisoformat(p['date']) for p in points)
                    else:
                        a, b = (dt.datetime.fromisoformat(p['dateTime'].replace('Z', '+00:00')).astimezone(zone) for p in points)
                        if a.time() != dt.time() or b.time() != dt.time():continue
                        a, b = a.date(), b.date()
                    if not a <= day < b:continue
                    identity = event.get('id') or json.dumps(points, sort_keys=True)
                    if identity in seen:continue
                    seen.add(identity)
                    title = event.get('summary') or '未命名事件'
                    if not isinstance(title, str):continue
                    declined = any(a.get('self') and a.get('responseStatus') == 'declined' for a in event.get('attendees', []) if isinstance(a, dict))
                    rows.append({'title':title[:200], 'declined':bool(declined), 'color':event_color(event,calendar)})
                except (KeyError, ValueError, TypeError, AttributeError):continue
        if rows:
            rows.sort(key=lambda row:(row['declined'],row['title'].casefold()))
            days.append({'date':day.isoformat(),'items':rows[:20]})
    return {'days':days}


def cached_agenda(directory, now=None):
    path = Path(directory) / 'google-calendar/cache.json'
    try:
        if not path.is_file() or path.stat().st_size > 12 * 1024 * 1024:return {'days':[]}
        return agenda_from_cache(json.loads(path.read_text()), now)
    except (OSError, ValueError, TypeError):return {'days':[]}
