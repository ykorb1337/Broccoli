"""Persistent manual tag clocks. They never change block policies or usage quotas."""
import copy
import datetime as dt
import json
import time
import uuid
from .model import PolicyError
from .tracking import finite,text,day_bounds
from .tracking_tags import parts,wire


def configuration(value):
    fields={'kind','tags','notes','billable','duration_seconds','work_seconds','break_seconds','stop_on_idle','remind_seconds','from_last'}
    if not isinstance(value,dict) or set(value)-fields:raise PolicyError('计时设置无效')
    result={'kind':value.get('kind','stopwatch'),'tags':parts(value.get('tags')),'notes':text(value.get('notes',''),10000),
        'billable':value.get('billable',False),'stop_on_idle':value.get('stop_on_idle',False),'from_last':value.get('from_last',False),
        'duration_seconds':value.get('duration_seconds',1500),'work_seconds':value.get('work_seconds',1500),
        'break_seconds':value.get('break_seconds',300),'remind_seconds':value.get('remind_seconds',0)}
    if result['kind'] not in ['stopwatch','countdown','pomodoro']:raise PolicyError('计时方式无效')
    for key in ['billable','stop_on_idle','from_last']:
        if type(result[key]) is not bool:raise PolicyError('计时开关无效')
    for key in ['duration_seconds','work_seconds','break_seconds']:
        if type(result[key]) is not int or not 1<=result[key]<=86400:raise PolicyError('计时时长应为 1 秒至 24 小时')
    reminder=result['remind_seconds']
    if type(reminder) is not int or reminder!=0 and not 60<=reminder<=86400:raise PolicyError('提醒间隔应为 1 分钟至 24 小时')
    return result


class TagClock:
    def __init__(self,tracking,clock=time.time):
        self.t=tracking;self.db=tracking.db;self.lock=tracking.lock;self.clock=clock
        with self.lock:
            self.db.execute('CREATE TABLE IF NOT EXISTS tracking_clock(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL)')
            self.db.execute('''CREATE TABLE IF NOT EXISTS tracking_clock_events(
                id TEXT PRIMARY KEY,at REAL NOT NULL,kind TEXT NOT NULL,clock_id TEXT NOT NULL,notified INTEGER NOT NULL,acknowledged INTEGER NOT NULL)''')
            self.db.execute('CREATE INDEX IF NOT EXISTS tracking_clock_pending ON tracking_clock_events(notified,at)')
            self.db.commit()

    def _read(self):
        row=self.db.execute('SELECT value FROM tracking_clock WHERE id=1').fetchone()
        return json.loads(row[0]) if row else {'status':'stopped','id':None,'last_template':None}

    def _save(self,state):
        self.db.execute('INSERT INTO tracking_clock VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',(wire(state),))

    def _event(self,state,kind,at):
        self.db.execute('INSERT INTO tracking_clock_events VALUES(?,?,?,?,0,0)',(uuid.uuid4().hex,at,kind,state['id']))
        self.db.execute('DELETE FROM tracking_clock_events WHERE id NOT IN(SELECT id FROM tracking_clock_events ORDER BY at DESC,id DESC LIMIT 100)')

    @staticmethod
    def _chunk(state):
        return max(0,state.get('last_tick',0)-state['segment_start']) if state.get('segment_start') is not None else 0

    def _public(self,state,now):
        if not state.get('id'):return {'status':'stopped','id':None,'last_template':state.get('last_template'),'now':now,'events':[]}
        chunk=self._chunk(state)
        elapsed=state['phase_base']+chunk
        remaining=max(0,state['phase_duration']-elapsed) if state['phase_duration'] is not None else None
        events=[dict(r) for r in self.db.execute('SELECT id,at,kind FROM tracking_clock_events WHERE clock_id=? AND acknowledged=0 ORDER BY at,id',(state['id'],))]
        return {'id':state['id'],'status':state['status'],'kind':state['template']['kind'],'phase':state['phase'],
            'tags':state['tags'],'notes':state['notes'],'billable':state['billable'],'elapsed':state['total_base']+chunk,
            'phase_elapsed':elapsed,'remaining':remaining,'deadline':state.get('deadline'),'cycles':state['cycles'],
            'template':copy.deepcopy(state['template']),'last_template':copy.deepcopy(state.get('last_template')),
            'last_break':copy.deepcopy(state.get('last_break')),'reason':state.get('reason',''),
            'reminder_pending':state.get('reminder_pending',False),'events':events,'now':now}

    def _new_segment(self,state,now):
        state.update(segment_start=now,segment_id=uuid.uuid4().hex,written=False,last_written_end=None,last_tick=now)
        if state['phase_duration'] is not None:state['deadline']=now+max(0,state['phase_duration']-state['phase_base'])
        else:state['deadline']=None

    def _archive(self,state):
        chunk=self._chunk(state);state['total_base']+=chunk;state['phase_base']+=chunk
        state['segment_start']=None;state['written']=False;state['last_written_end']=None

    def _write_segment(self,state,end):
        if state.get('segment_start') is None:return
        row=self.db.execute('SELECT * FROM tracking_tags WHERE id=?',(state['segment_id'],)).fetchone()
        if state['written'] and (row is None or row['source']!='clock' or row['start']!=state['segment_start'] or row['end']!=state['last_written_end'] or json.loads(row['tags'])!=state['tags'] or row['notes']!=state['notes'] or bool(row['billable'])!=state['billable']):
            # A person deleted/edited this row. Keep their edit and resume only
            # from this checkpoint; never recreate the removed past interval.
            state['last_tick']=end;self._archive(state);self._new_segment(state,end)
            return
        if not state['tags'] or end<=state['segment_start']:return
        self.db.execute('INSERT INTO tracking_tags VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET end=excluded.end',
            (state['segment_id'],state['segment_start'],end,wire(state['tags']),state['notes'],int(state['billable']),'','clock'))
        state['written']=True;state['last_written_end']=end

    def _advance(self,state,now):
        if state['status']!='running':return
        if now<state['last_tick']:
            state.update(status='stopped',reason='clock_changed',deadline=None)
            self._event(state,'clock_changed',now);return
        deadline=state.get('deadline');end=min(now,deadline) if deadline is not None else now
        self._write_segment(state,end);state['last_tick']=end
        if deadline is not None and now>=deadline:
            state['status']='awaiting' if state['template']['kind']=='pomodoro' else 'finished'
            state['deadline']=None;state['reminder_pending']=False
            if state['phase']=='work':state['cycles']+=1
            self._event(state,('work_finished' if state['phase']=='work' else 'break_finished') if state['template']['kind']=='pomodoro' else 'timer_finished',deadline)
        elif state.get('next_reminder') is not None and now>=state['next_reminder'] and not state.get('reminder_pending'):
            state['reminder_pending']=True;self._event(state,'reminder',now)

    def status(self):
        now=finite(self.clock())
        with self.t.tag_library.transaction():
            state=self._read();before=wire(state);self._advance(state,now)
            if wire(state)!=before:self._save(state)
            return self._public(state,now)

    def tick(self):return self.status()

    def start(self,value=None,use_last=False):
        now=finite(self.clock())
        with self.t.tag_library.transaction():
            old=self._read();self._advance(old,now)
            if old['status'] in ['running','paused','awaiting']:raise PolicyError('请先结束当前计时')
            if use_last:
                if not old.get('last_template'):raise PolicyError('尚无上次计时标签')
                if value not in [None,{}]:raise PolicyError('沿用上次计时不接受额外设置')
                config=configuration(old['last_template']);config['from_last']=False
            else:config=configuration(value)
            start=now
            if config['from_last']:
                since,_=day_bounds(dt.datetime.fromtimestamp(now).date().isoformat())
                last=self.db.execute('SELECT MAX(end) FROM tracking_tags WHERE end>? AND end<=? AND start<?',(since,now,now)).fetchone()[0]
                if last is not None:start=max(since,last)
            duration=None if config['kind']=='stopwatch' else config['duration_seconds'] if config['kind']=='countdown' else config['work_seconds']
            state={'id':uuid.uuid4().hex,'status':'running','phase':'work','template':config,'last_template':copy.deepcopy(config),
                'tags':config['tags'][:],'notes':config['notes'],'billable':config['billable'],'phase_duration':duration,
                'phase_base':0,'total_base':0,'cycles':0,'reason':'','reminder_pending':False,'last_break':None,
                'next_reminder':now+config['remind_seconds'] if config['remind_seconds'] else None}
            self.t.tag_library.register(config['tags']);self._new_segment(state,start);self._advance(state,now);self._save(state)
            return self._public(state,now)

    def _checked(self,ident):
        state=self._read()
        if not isinstance(ident,str) or not ident or ident!=state.get('id'):raise PolicyError('计时已更改，请刷新后重试')
        return state

    def command(self,action,ident,value=None):
        now=finite(self.clock())
        with self.t.tag_library.transaction():
            state=self._checked(ident);self._advance(state,now)
            if action=='pause':
                if state['status']!='running':raise PolicyError('当前计时无法暂停')
                self._archive(state);state.update(status='paused',deadline=None,reminder_pending=False)
                self.db.execute("UPDATE tracking_clock_events SET acknowledged=1 WHERE clock_id=? AND kind='reminder'",(ident,))
            elif action=='resume':
                if state['status']!='paused':raise PolicyError('当前计时无法继续')
                state['status']='running';self._new_segment(state,now)
                if state['template']['remind_seconds']:state['next_reminder']=now+state['template']['remind_seconds']
            elif action=='stop':
                state.update(status='stopped',deadline=None,reminder_pending=False,reason='manual')
                self.db.execute('UPDATE tracking_clock_events SET acknowledged=1 WHERE clock_id=?',(ident,))
            elif action=='ack-reminder':
                state['reminder_pending']=False
                state['next_reminder']=now+state['template']['remind_seconds'] if state['template']['remind_seconds'] else None
                self.db.execute("UPDATE tracking_clock_events SET acknowledged=1 WHERE clock_id=? AND kind='reminder'",(ident,))
            elif action=='ack-events':self.db.execute('UPDATE tracking_clock_events SET acknowledged=1 WHERE clock_id=?',(ident,))
            elif action in ['next-phase','skip-break']:
                if state['status']!='awaiting' or state['template']['kind']!='pomodoro':raise PolicyError('当前没有待确认的番茄时段')
                if action=='skip-break' and state['phase']!='work':raise PolicyError('当前不是休息前的确认')
                target='work' if action=='skip-break' or state['phase']=='break' else 'break'
                if value is None:value={}
                if not isinstance(value,dict) or set(value)-{'tags','notes','billable','untagged'}:raise PolicyError('下一段计时设置无效')
                untagged=value.get('untagged',False)
                if type(untagged) is not bool or untagged and target!='break':raise PolicyError('只有休息时段可不标记标签')
                defaults=state['template'] if target=='work' else state.get('last_break') or {'tags':['休息'],'notes':'','billable':False}
                names=[] if untagged else parts(value.get('tags',defaults['tags']))
                notes=text(value.get('notes',defaults['notes']),10000);billable=value.get('billable',defaults['billable'])
                if type(billable) is not bool:raise PolicyError('计费标记无效')
                self._archive(state);state.update(phase=target,phase_base=0,status='running',tags=names,notes=notes,billable=billable,reminder_pending=False)
                state['phase_duration']=state['template']['work_seconds'] if target=='work' else state['template']['break_seconds']
                if target=='work':
                    state['template'].update(tags=names[:],notes=notes,billable=billable);state['last_template']=copy.deepcopy(state['template'])
                elif not untagged:state['last_break']={'tags':names[:],'notes':notes,'billable':billable}
                if names:self.t.tag_library.register(names)
                self._new_segment(state,now)
                state['next_reminder']=now+state['template']['remind_seconds'] if state['template']['remind_seconds'] else None
                self.db.execute('UPDATE tracking_clock_events SET acknowledged=1 WHERE clock_id=?',(ident,))
            else:raise PolicyError('计时操作无效')
            self._save(state);return self._public(state,now)

    def observe(self,activity,now,idle=0):
        now=finite(now)
        if activity not in ['Away','Locked','Sleep']:return
        idle=finite(idle,'闲置时长')
        with self.t.tag_library.transaction():
            state=self._read()
            if not state.get('id') or not state['template']['stop_on_idle'] or state['status'] in ['stopped','paused']:return
            start=state.get('segment_start')
            if start is None:return
            if now<start:return
            end=max(start,now-idle) if activity=='Away' else now
            latest=(state.get('deadline') or now) if state['status']=='running' else state['last_tick']
            end=min(end,latest)
            if state['status']=='finished' and end>=state['last_tick']:return
            if state['status'] in ['awaiting','finished'] and state['phase']=='work' and end<state['last_tick']:state['cycles']=max(0,state['cycles']-1)
            row=self.db.execute('SELECT source,start,end FROM tracking_tags WHERE id=?',(state['segment_id'],)).fetchone()
            if row and row['source']=='clock' and row['start']==start and row['end']==state['last_written_end']:
                if end>start:self.db.execute('UPDATE tracking_tags SET end=? WHERE id=?',(end,state['segment_id']))
                else:self.db.execute('DELETE FROM tracking_tags WHERE id=?',(state['segment_id'],))
                state['written']=end>start;state['last_written_end']=end if end>start else None
            elif state['status']=='running':self._write_segment(state,end)
            state.update(last_tick=end,status='stopped',deadline=None,reason='idle',reminder_pending=False)
            self.db.execute('UPDATE tracking_clock_events SET acknowledged=1,notified=1 WHERE clock_id=?',(state['id'],))
            self._event(state,'idle_stopped',now);self._save(state)

    def transform_tags(self,transform):
        # Called by the tag library inside its historical-edit transaction.
        state=self._read()
        if not state.get('id'):return
        for key in ['template','last_template','last_break']:
            if state.get(key):
                value=transform(state[key]['tags'])
                if value:state[key]['tags']=value
                elif key=='last_template':state[key]=None
                else:state[key]['tags']=[]
        if state['tags']:
            state['tags']=transform(state['tags']) or []
            if not state['tags']:state.update(status='stopped',deadline=None,reason='tag_deleted',reminder_pending=False)
        self._save(state)

    def take_notices(self):
        labels={'timer_finished':'计时已结束','work_finished':'学习计时已结束，请选择休息安排','break_finished':'休息计时已结束','reminder':'当前任务是否仍在进行？','idle_stopped':'因离开电脑，计时已停止','clock_changed':'系统时间发生变化，计时已停止'}
        with self.t.tag_library.transaction():
            rows=self.db.execute('SELECT id,kind FROM tracking_clock_events WHERE notified=0 AND acknowledged=0 ORDER BY at,id LIMIT 8').fetchall()
            for row in rows:self.db.execute('UPDATE tracking_clock_events SET notified=1 WHERE id=?',(row['id'],))
            return [labels.get(row['kind'],'计时状态已更新') for row in rows]
