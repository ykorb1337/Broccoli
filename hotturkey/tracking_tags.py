"""Local tag definitions, hierarchy and atomic edits of historical tag names."""
import datetime as dt
import hashlib
import json
import time
from contextlib import contextmanager
from .model import PolicyError
from .tracking import color, generated_color, text, day_bounds


def parts(value):
    if isinstance(value,str):value=[v.strip() for v in value.split(',') if v.strip()]
    if not isinstance(value,list) or not 1<=len(value)<=30:raise PolicyError('请填写 1–30 级标签')
    value=[text(v,100).strip() for v in value]
    if any(not v or ',' in v or any(ord(c)<32 or ord(c)==127 for c in v) for v in value):raise PolicyError('单个标签不能为空、包含逗号或换行符')
    return value


def wire(value):return json.dumps(value,ensure_ascii=False)
def identity(kind,value):return kind[0]+'_'+hashlib.sha256(wire(value).encode()).hexdigest()


class TagLibrary:
    def __init__(self,tracking):
        self.t=tracking;self.db=tracking.db;self.lock=tracking.lock
        with self.lock:
            self.db.execute('''CREATE TABLE IF NOT EXISTS tracking_tag_library(
                key TEXT PRIMARY KEY,kind TEXT NOT NULL,parts TEXT NOT NULL,name TEXT NOT NULL,
                search TEXT NOT NULL,color TEXT NOT NULL,skip INTEGER NOT NULL,position INTEGER NOT NULL)''')
            self.db.execute('CREATE INDEX IF NOT EXISTS tracking_tag_library_order ON tracking_tag_library(kind,position,key)')
            self.db.execute('''CREATE TABLE IF NOT EXISTS tracking_tag_nodes(
                path TEXT PRIMARY KEY,parent TEXT NOT NULL,part TEXT NOT NULL,tag_key TEXT NOT NULL,terminal INTEGER NOT NULL)''')
            self.db.execute('CREATE INDEX IF NOT EXISTS tracking_tag_node_parent ON tracking_tag_nodes(parent)')
            if not self.db.execute("SELECT 1 FROM tracking_meta WHERE key='tag-library-v1'").fetchone():
                cursor=self.db.execute('SELECT DISTINCT tags FROM tracking_tags')
                while True:
                    batch=cursor.fetchmany(128)
                    if not batch:break
                    for row in batch:self.register(parts(json.loads(row['tags'])))
                cursor.close()
                self.db.execute("INSERT INTO tracking_meta VALUES('tag-library-v1','1')")
            self.db.commit()

    @contextmanager
    def transaction(self):
        with self.lock:
            self.db.execute('SAVEPOINT tag_library_edit')
            try:
                yield
                self.db.execute('RELEASE tag_library_edit')
            except BaseException:
                self.db.execute('ROLLBACK TO tag_library_edit');self.db.execute('RELEASE tag_library_edit');raise

    def _insert(self,kind,value,tint='',skip=False,position=None):
        key=identity(kind,value)
        if position is None:position=self.db.execute('SELECT COALESCE(MAX(position),-1)+1 FROM tracking_tag_library WHERE kind=?',(kind,)).fetchone()[0]
        name=', '.join(value)
        self.db.execute('INSERT OR IGNORE INTO tracking_tag_library VALUES(?,?,?,?,?,?,?,?)',(key,kind,wire(value),name,name.casefold(),tint,int(skip),position))
        return key

    def _nodes(self,value):
        for n in range(1,len(value)+1):
            self.db.execute('INSERT INTO tracking_tag_nodes VALUES(?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET terminal=MAX(terminal,excluded.terminal)',
                (wire(value[:n]),wire(value[:n-1]),value[n-1],identity('tag',[value[n-1]]),int(n==len(value))))

    def register(self,value):
        # Called inside the tag save transaction, never commits on its own.
        for name in value:self._insert('tag',[name])
        key=self._insert('combination',value);self._nodes(value);return key

    def cut_ranges(self,ranges,ids=None):
        """Trim selected tags inside the caller's transaction, retaining gaps
        and any local automatic-tag override on the remaining pieces."""
        from .tracking import subtract
        import uuid
        if not ranges:return
        rows=self.db.execute('SELECT * FROM tracking_tags WHERE start<? AND end>?',(max(b for _,b in ranges),min(a for a,_ in ranges))).fetchall()
        for row in rows:
            if ids is not None and row['id'] not in ids:continue
            pieces=subtract([[row['start'],row['end']]],ranges)
            if pieces==[[row['start'],row['end']]]:continue
            override=bool(self.db.execute('SELECT 1 FROM tracking_autotag_overrides WHERE tag_id=?',(row['id'],)).fetchone())
            self.db.execute('DELETE FROM tracking_tags WHERE id=?',(row['id'],));self.db.execute('DELETE FROM tracking_autotag_overrides WHERE tag_id=?',(row['id'],))
            for a,b in pieces:
                ident=uuid.uuid4().hex
                self.db.execute('INSERT INTO tracking_tags VALUES(?,?,?,?,?,?,?,?)',(ident,a,b,row['tags'],row['notes'],row['billable'],row['color'],row['source']))
                if override:self.db.execute('INSERT INTO tracking_autotag_overrides VALUES(?)',(ident,))

    def palette(self):
        with self.lock:rows=self.db.execute('SELECT kind,parts,color,skip FROM tracking_tag_library').fetchall()
        tags={};combinations={}
        for row in rows:
            value=json.loads(row['parts'])
            if row['kind']=='tag':tags[value[0]]={'color':row['color'] or generated_color(value[0]),'skip':bool(row['skip'])}
            else:combinations[tuple(value)]=row['color']
        return tags,combinations

    @staticmethod
    def resolve(value,palette):
        tags,combinations=palette
        if combinations.get(tuple(value)):return combinations[tuple(value)]
        selected=next((v for v in value if not tags.get(v,{}).get('skip')),value[0])
        return tags.get(selected,{}).get('color') or generated_color(selected)

    def _item(self,row,palette=None):
        v=dict(row);v['parts']=json.loads(v['parts']);v['skip']=bool(v['skip']);v.pop('search',None)
        v['resolved_color']=(v['color'] or generated_color(v['parts'][0])) if v['kind']=='tag' else self.resolve(v['parts'],palette or self.palette());return v

    def catalog(self,kind='combination',query='',offset=0,limit=200):
        if kind not in ['tag','combination'] or type(offset) is not int or offset<0 or type(limit) is not int or not 1<=limit<=500:raise PolicyError('标签浏览选项无效')
        query=text(query,200).casefold()
        with self.lock:
            count=self.db.execute('SELECT COUNT(*) FROM tracking_tag_library WHERE kind=? AND instr(search,?)>0',(kind,query)).fetchone()[0]
            rows=self.db.execute('SELECT * FROM tracking_tag_library WHERE kind=? AND instr(search,?)>0 ORDER BY position,key LIMIT ? OFFSET ?',(kind,query,limit,offset)).fetchall()
            palette=self.palette()
            return {'items':[self._item(row,palette) for row in rows],'total':count,'offset':offset,'limit':limit}

    def children(self,prefix,offset=0,limit=200):
        if prefix!=[]:prefix=parts(prefix)
        if type(offset) is not int or offset<0 or type(limit) is not int or not 1<=limit<=500:raise PolicyError('标签浏览选项无效')
        with self.lock:
            count=self.db.execute('SELECT COUNT(*) FROM tracking_tag_nodes WHERE parent=?',(wire(prefix),)).fetchone()[0]
            rows=self.db.execute('''SELECT n.*,l.position FROM tracking_tag_nodes n JOIN tracking_tag_library l ON n.tag_key=l.key
                WHERE n.parent=? ORDER BY l.position,n.part LIMIT ? OFFSET ?''',(wire(prefix),limit,offset)).fetchall()
            return {'prefix':prefix,'terminal':bool(self.db.execute('SELECT 1 FROM tracking_tag_library WHERE key=?',(identity('combination',prefix),)).fetchone()),
                'items':[{'name':r['part'],'parts':json.loads(r['path']),'terminal':bool(r['terminal']),
                    'children':bool(self.db.execute('SELECT 1 FROM tracking_tag_nodes WHERE parent=? LIMIT 1',(r['path'],)).fetchone())} for r in rows],
                'total':count,'offset':offset,'limit':limit}

    def recent(self):
        with self.lock:
            rows=self.db.execute('SELECT tags,MAX(end) AS latest FROM tracking_tags GROUP BY tags ORDER BY latest DESC,tags LIMIT 12').fetchall()
            palette=self.palette();items=[]
            for row in rows:
                latest=self.db.execute('SELECT notes,billable FROM tracking_tags WHERE tags=? ORDER BY end DESC,id LIMIT 1',(row['tags'],)).fetchone()
                value=json.loads(row['tags']);items.append({'parts':value,'notes':latest['notes'],'billable':bool(latest['billable']),
                    'color':self.resolve(value,palette),'last_used':row['latest']})
            return {'items':items}

    def save(self,value):
        if not isinstance(value,dict) or set(value)-{'kind','parts','color','skip'}:raise PolicyError('标签设置无效')
        kind=value.get('kind');names=parts(value.get('parts'))
        if kind not in ['tag','combination'] or kind=='tag' and len(names)!=1:raise PolicyError('标签类型无效')
        tint=color(value['color']) if value.get('color') else '';skip=value.get('skip',False)
        if type(skip) is not bool or kind=='combination' and skip:raise PolicyError('颜色继承选项无效')
        with self.transaction():
            if kind=='combination':self.register(names)
            else:self._insert(kind,names)
            key=identity(kind,names);self.db.execute('UPDATE tracking_tag_library SET color=?,skip=? WHERE key=?',(tint,int(skip),key))
            return self._item(self.db.execute('SELECT * FROM tracking_tag_library WHERE key=?',(key,)).fetchone())

    def _entry(self,key):
        key=text(key,100)
        row=self.db.execute('SELECT * FROM tracking_tag_library WHERE key=?',(key,)).fetchone()
        if not row:raise PolicyError('标签已更改，请刷新后重试')
        return dict(row)

    def move(self,key,direction):
        if type(direction) is not int or direction not in [-1,1]:raise PolicyError('标签顺序无效')
        with self.transaction():
            row=self._entry(key)
            sign,order=('<','DESC') if direction<0 else ('>','ASC')
            adjacent=self.db.execute('SELECT key,position FROM tracking_tag_library WHERE kind=? AND position'+sign+'? ORDER BY position '+order+' LIMIT 1',(row['kind'],row['position'])).fetchone()
            if adjacent:
                self.db.execute('UPDATE tracking_tag_library SET position=? WHERE key=?',(adjacent['position'],key))
                self.db.execute('UPDATE tracking_tag_library SET position=? WHERE key=?',(row['position'],adjacent['key']))
            return {'ok':True}

    def update(self,key,value):
        if not isinstance(value,dict):raise PolicyError('标签设置无效')
        with self.transaction():
            entry=self._entry(key);names=parts(value.get('parts'))
            # Validate style and rename in one transaction. A failed color edit
            # must not leave a successful historical rename behind.
            changed=self.change(key,names)
            saved=self.save({**value,'kind':entry['kind']})
            return {**saved,**changed}

    def _rebuild(self):
        self.db.execute('DELETE FROM tracking_tag_nodes')
        cursor=self.db.execute("SELECT parts FROM tracking_tag_library WHERE kind='combination'")
        while True:
            rows=cursor.fetchmany(128)
            if not rows:break
            for row in rows:self._nodes(json.loads(row['parts']))
        cursor.close()

    def change(self,key,new_parts=None,delete=False):
        if not delete:new_parts=parts(new_parts)
        with self.transaction():
            entry=self._entry(key);old=json.loads(entry['parts']);kind=entry['kind']
            if not delete and kind=='tag' and len(new_parts)!=1:raise PolicyError('单个标签只能更改一个名称')
            if not delete and old==new_parts:return {'changed':0}
            def transform(value):
                if kind=='combination':return (None if delete else new_parts) if value==old else value
                return [new_parts[0] if v==old[0] else v for v in value] if not delete else [v for v in value if v!=old[0]] or None
            def sql_transform(encoded):
                value=transform(json.loads(encoded));return wire(value) if value else None
            if hasattr(self.t,'clock'):self.t.clock.transform_tags(transform)
            # SQLite streams the historical rows; a global rename does not load
            # an entire activity history into Python memory.
            self.db.create_function('ht_tag_transform',1,sql_transform)
            try:
                removed=self.db.execute('DELETE FROM tracking_tags WHERE ht_tag_transform(tags) IS NULL').rowcount
                changed=self.db.execute('UPDATE tracking_tags SET tags=ht_tag_transform(tags) WHERE tags<>ht_tag_transform(tags)').rowcount
            finally:self.db.create_function('ht_tag_transform',1,None)
            definitions=self.db.execute("SELECT * FROM tracking_tag_library WHERE kind='combination'").fetchall()
            affected=[(dict(row),transform(json.loads(row['parts']))) for row in definitions if transform(json.loads(row['parts']))!=json.loads(row['parts'])]
            for row,_ in affected:self.db.execute('DELETE FROM tracking_tag_library WHERE key=?',(row['key'],))
            if kind=='tag':self.db.execute('DELETE FROM tracking_tag_library WHERE key=?',(key,))
            if not delete and kind=='tag':self._insert('tag',new_parts,entry['color'],entry['skip'],entry['position'])
            for row,value in affected:
                if value:
                    for name in value:self._insert('tag',[name])
                    self._insert('combination',value,row['color'],False,row['position'])
            if kind=='tag' and not delete:
                # Structured report references follow a rename. Free-form filter
                # expressions remain the person's own text.
                reports=self.db.execute("SELECT id,value FROM tracking_entities WHERE kind='reports'").fetchall()
                for report in reports:
                    definition=json.loads(report['value'])
                    for series in definition.get('series',[]):
                        if series.get('timeline')=='tags':series['groups']=list(dict.fromkeys(new_parts[0] if v==old[0] else v for v in series.get('groups',[])))
                    self.db.execute("UPDATE tracking_entities SET value=? WHERE kind='reports' AND id=?",(wire(definition),report['id']))
            self.db.execute('DELETE FROM tracking_autotag_overrides WHERE tag_id NOT IN (SELECT id FROM tracking_tags)')
            self._rebuild()
            return {'changed':changed,'deleted':removed}

    def import_text(self,value):
        value=text(value,1_000_000).lstrip('\ufeff');lines=[v.strip() for v in value.splitlines() if v.strip()]
        if not lines or len(lines)>5000:raise PolicyError('一次可导入 1–5000 行标签组合')
        values=[parts(line) for line in lines]
        with self.transaction():
            before=self.db.execute("SELECT COUNT(*) FROM tracking_tag_library WHERE kind='combination'").fetchone()[0]
            for value in values:self.register(value)
            after=self.db.execute("SELECT COUNT(*) FROM tracking_tag_library WHERE kind='combination'").fetchone()[0]
            return {'added':after-before}

    def export_text(self):
        with self.lock:return {'text':'\n'.join(r['name'] for r in self.db.execute("SELECT name FROM tracking_tag_library WHERE kind='combination' ORDER BY position,key"))+'\n'}

    def last_untagged(self,now=None):
        now=time.time() if now is None else now;day=dt.datetime.fromtimestamp(now).date().isoformat();since,until=day_bounds(day)
        with self.lock:
            last=self.db.execute('SELECT MAX(end) FROM tracking_tags WHERE start<? AND end>?',(now,since)).fetchone()[0]
            first=self.db.execute("SELECT MIN(start) FROM tracking_activities WHERE timeline='computer' AND group_name='Active' AND end>? AND start<?",(since,now)).fetchone()[0]
        start=max(since,last if last is not None else first if first is not None else now)
        if start>=now:raise PolicyError('今天没有可补标的时间')
        return {'day':day,'range':[start,now]}
