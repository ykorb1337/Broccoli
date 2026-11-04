"""Local calendar reminders, independent of the policy and recording workers."""
import datetime as dt
import hashlib
import json
import logging
import math
import subprocess
import threading
import time
from pathlib import Path
from zoneinfo import ZoneInfo

from .google_calendar import private_json, moment
from .model import PolicyError

LOG = logging.getLogger('broccoli')
UTC = dt.timezone.utc
GRACE = 120


def reminders_for(calendar, event, default_minutes, fallback_zone='UTC'):
    """Google returns individual instances; never expand or mutate a series here."""
    if event.get('status') == 'cancelled' or any(a.get('self') and a.get('responseStatus') == 'declined' for a in event.get('attendees', [])):
        return []
    if not isinstance(event.get('id'), str):
        return []
    try:
        kind, start = moment(event['start'])
        zone = ZoneInfo(calendar.get('timeZone') or fallback_zone)
        if kind == 'date':
            start = dt.datetime.combine(start, dt.time(), zone)
        start_at = start.timestamp()
    except (KeyError, ValueError, TypeError):
        return []
    settings = event.get('reminders') or {}
    minutes = default_minutes if settings.get('useDefault', True) else [r.get('minutes') for r in settings.get('overrides', []) if r.get('method') == 'popup']
    result = []
    for lead in set(m for m in minutes if type(m) is int and 0 <= m <= 40320):
        identity = json.dumps([calendar['id'], event['id'], start_at, lead], separators=(',', ':'))
        result.append({'id': hashlib.sha256(identity.encode()).hexdigest(), 'at': start_at - lead * 60,
                       'start': start_at, 'minutes': lead, 'all_day': kind == 'date',
                       'title': str(event.get('summary') or '未命名事件')[:200],
                       'when': start.astimezone(zone).strftime('%m/%d %H:%M')})
    return result


def send_native(body):
    helper = Path(__file__).resolve().parent.parent / 'build/BroccoliCalendarNotice'
    if not helper.is_file():
        raise PolicyError('日历提醒组件尚未安装')
    try:
        result = subprocess.run([str(helper)], input=json.dumps({'body': body}, ensure_ascii=False),
                                text=True, capture_output=True, timeout=16)
    except (OSError, subprocess.TimeoutExpired):
        raise PolicyError('无法发送日历提醒，请重新打开 Broccoli') from None
    if result.returncode:
        raise PolicyError('无法发送日历提醒，请重新打开 Broccoli')


class CalendarReminders:
    def __init__(self, store, get_calendar, sender=send_native, clock=time.time):
        self.store, self.get_calendar, self.sender, self.clock = store, get_calendar, sender, clock
        self.lock = threading.RLock()
        self.path = store.directory / 'google-calendar/reminders.json'
        self.plan, self.sent, self.retry = [], {}, {}
        self.synced, self.next_sync, self.generation = 0, 0, 0
        self.signature, self.error, self.last_sent = None, '', 0
        self.stop = threading.Event()
        try:
            if self.path.is_file() and self.path.stat().st_size < 4 * 1024 * 1024:
                saved = json.loads(self.path.read_text())
                if not isinstance(saved, dict):raise ValueError('invalid reminder cache')
                plan, sent, synced = saved.get('plan', []), saved.get('sent', {}), saved.get('synced', 0)
                numeric = lambda value: type(value) in (int, float) and math.isfinite(value)
                if not isinstance(plan, list) or not isinstance(sent, dict) or not numeric(synced):raise ValueError('invalid reminder cache')
                for row in plan:
                    if not isinstance(row, dict) or not all(numeric(row.get(k)) for k in ('at', 'start')) or type(row.get('minutes')) is not int or not 0 <= row['minutes'] <= 40320:raise ValueError('invalid reminder cache')
                    if not all(isinstance(row.get(k), str) for k in ('id', 'title', 'when')) or type(row.get('all_day')) is not bool:raise ValueError('invalid reminder cache')
                if not all(isinstance(k, str) and numeric(v) for k, v in sent.items()):raise ValueError('invalid reminder cache')
                self.plan, self.sent, self.synced = plan, sent, synced
                self.signature = tuple(saved['minutes']) if isinstance(saved.get('minutes'), list) else None
        except (ValueError, TypeError, OSError):
            self.plan, self.sent, self.synced, self.signature = [], {}, 0, None
            LOG.warning('Calendar reminder cache unavailable; rebuilding')

    def configuration(self):
        with self.store.lock:
            settings = self.store.state['settings']
            return (bool(settings['notifications'] and settings.get('calendar_notifications', False)),
                    tuple(settings.get('calendar_reminder_minutes', [10])))

    def _save(self):
        now = self.clock()
        self.sent = {k: v for k, v in self.sent.items() if isinstance(v, (int, float)) and now - v < 35 * 86400}
        if len(self.sent) > 10000:
            self.sent = dict(sorted(self.sent.items(), key=lambda item: item[1])[-10000:])
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        private_json(self.path, {'plan': self.plan, 'sent': self.sent, 'synced': self.synced, 'minutes': self.signature})

    def invalidate(self):
        with self.lock:
            self.generation += 1
            self.plan, self.next_sync, self.synced = [], 0, 0
            try:self._save()
            except OSError:LOG.warning('Calendar reminder cache could not be invalidated on disk')

    def refresh(self, now, minutes):
        with self.lock:
            generation = self.generation
            self.next_sync = now + 60
        calendar = self.get_calendar()
        if not calendar.status().get('connected'):
            with self.lock:
                self.plan, self.synced, self.error = [], 0, ''
                self._save()
            return
        day = dt.datetime.fromtimestamp(now, UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        since, until = (day - dt.timedelta(days=1)).isoformat(), (day + dt.timedelta(days=29)).isoformat()
        plans = []
        for item in calendar.calendars().get('items', []):
            if self.stop.is_set():return
            if item.get('selected') is False or item.get('accessRole') == 'freeBusyReader':
                continue
            feed = calendar.events(item['id'], since, until, cache=False)
            for event in feed.get('items', []):
                plans.extend(reminders_for(item, event, minutes, feed.get('timeZone', 'UTC')))
        with self.lock:
            if self.stop.is_set() or generation != self.generation or self.configuration() != (True, minutes):
                return
            self.plan = sorted((p for p in plans if p['at'] >= now - GRACE), key=lambda p: p['at'])
            self.synced, self.signature, self.error = now, minutes, ''
            identities = {p['id'] for p in self.plan}
            self.retry = {key: value for key, value in self.retry.items() if key in identities}
            self._save()

    def tick(self):
        now = self.clock()
        enabled, minutes = self.configuration()
        if not enabled:
            with self.lock:
                self.next_sync = 0
                self.retry.clear()
            return
        with self.lock:
            if minutes != self.signature:
                self.plan, self.next_sync = [], 0
            refresh = now >= self.next_sync
        if refresh:
            try:
                self.refresh(now, minutes)
            except Exception:
                with self.lock:
                    self.error = '日历暂时无法同步，将继续使用最近的提醒'
                    self.next_sync = now + 60
                LOG.warning('Calendar reminder sync unavailable')
        with self.lock:
            if not self.synced or not 0 <= now - self.synced <= 86400:
                return
            due = [dict(p) for p in self.plan if now - GRACE <= p['at'] <= now
                   and p['id'] not in self.sent and self.retry.get(p['id'], 0) <= now]
            generation = self.generation
        for notice in due[:8]:
            with self.lock:
                if self.stop.is_set() or generation != self.generation or self.configuration() != (True, minutes):
                    return
            lead = '即将开始' if notice['minutes'] == 0 else str(notice['minutes']) + ' 分钟后'
            body = '日程提醒 · ' + lead + '\n' + notice['title'] + '\n' + notice['when'] + (' · 全天' if notice['all_day'] else '')
            try:
                self.sender(body[:300])
            except Exception:
                with self.lock:
                    self.retry[notice['id']] = now + 30
                    self.error = '无法发送日历提醒，请检查 macOS 通知权限'
                continue
            with self.lock:
                self.sent[notice['id']] = now
                self.last_sent = now
                self._save()

    def run(self, stop):
        self.stop = stop
        while not stop.is_set():
            try:
                self.tick()
            except Exception:
                LOG.exception('Calendar reminder worker recovered from an error')
            stop.wait(1)

    def status(self):
        with self.lock:
            return {'enabled': self.configuration()[0], 'synced_at': self.synced,
                    'last_sent_at': self.last_sent, 'error': self.error}
