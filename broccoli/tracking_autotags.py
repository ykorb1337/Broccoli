"""Derived local tags. Rules never mutate raw observations or blocking policy.

Each condition produces half-open intervals. AND intersects timelines, OR
unions them, and exclusions subtract time before priority/modifiers apply.
Nothing is cached as historical truth: edits immediately affect old dates.
"""
import copy
import fnmatch
import hashlib
import json
import re
import uuid
import datetime as dt
from .model import PolicyError
from .tracking import bounds, color, day_bounds, generated_color, intersect, intervals, seconds, subtract, text
from .tracking_tags import parts, wire
from .tracking_regex import RegexMatcher,validate as validate_regex

FIELDS=('title','group_name','application','bundle','path','url','document','repository','branch')
OPERATORS=('contains','equals','starts','ends','glob','regex')
OPTIONS={'first_match':False,'manual_tags':'off','gap_seconds':0,'highlight_guessed':True}
VARIABLE=re.compile(r'\{\{([^{}]+)\}\}')


def condition(value):
    if not isinstance(value,dict) or set(value)-{'timeline','field','operator','value','exclude'}:raise PolicyError('自动标签条件无效')
    result={'timeline':value.get('timeline','applications'),'field':value.get('field','title'),
            'operator':value.get('operator','contains'),'value':text(value.get('value',''),4096),'exclude':value.get('exclude',False)}
    if result['value'].startswith('#"') and result['value'].endswith('"'):
        result['operator']='regex';result['value']=result['value'][2:-1]
    if result['timeline'] not in ['applications','documents','computer'] or result['field'] not in FIELDS or result['operator'] not in OPERATORS or type(result['exclude']) is not bool or not result['value'].strip():raise PolicyError('请填写有效的自动标签条件')
    if result['operator']=='regex':validate_regex(result['value'])
    return result


def validate(value):
    if not isinstance(value,dict) or set(value)-{'name','tags','notes','color','billable','enabled','match','conditions','mode','targets','append_data'}:raise PolicyError('自动标签设置无效')
    result={'name':text(value.get('name',''),100).strip(),'tags':parts(value.get('tags')),
            'notes':text(value.get('notes',''),10000),'color':color(value['color']) if value.get('color') else '',
            'billable':value.get('billable',False),'enabled':value.get('enabled',True),'match':value.get('match','all'),
            'mode':value.get('mode','tag'),'targets':value.get('targets',[]),'append_data':value.get('append_data',False)}
    if not result['name']:result['name']=', '.join(result['tags'])
    if any(type(result[k]) is not bool for k in ['enabled','billable','append_data']) or result['match'] not in ['all','any'] or result['mode'] not in ['tag','append','prepend','absorb']:raise PolicyError('自动标签选项无效')
    targets=result['targets']
    if not isinstance(targets,list) or len(targets)>500 or any(not isinstance(v,str) or not re.fullmatch('[a-f0-9]{32}',v) for v in targets):raise PolicyError('应用的自动标签无效')
    result['targets']=list(dict.fromkeys(targets))
    rows=value.get('conditions')
    if not isinstance(rows,list) or not 1<=len(rows)<=30:raise PolicyError('请添加 1–30 个条件')
    result['conditions']=[condition(v) for v in rows]
    if not any(not v['exclude'] for v in result['conditions']):raise PolicyError('至少需要一个包含条件')
    positives=[v for v in result['conditions'] if not v['exclude']]
    regexes=[v for v in positives if v['operator']=='regex']
    captures=[validate_regex(v['value']) if v['operator']=='regex' else -1 for v in positives] if result['match']=='any' else [validate_regex(regexes[0]['value']) if regexes else -1]
    for template in result['tags']+[result['notes']]:
        for variable in VARIABLE.findall(template):
            if variable in ['title','group','application','url','document','repository','branch']:continue
            if not re.fullmatch(r'[0-9]{1,2}',variable) or any(int(variable)>n for n in captures):raise PolicyError('捕获组无效：每个动态来源都必须提供 {{'+variable+'}}')
    return result


def matches(row,value):
    source=str(row.get(value['field'],'')).casefold();pattern=value['value'].casefold()
    op=value['operator']
    return {'contains':lambda:pattern in source,'equals':lambda:source==pattern,'starts':lambda:source.startswith(pattern),
            'ends':lambda:source.endswith(pattern),'glob':lambda:fnmatch.fnmatchcase(source,pattern)}[op]()


class AutoTags:
    def __init__(self,tracking):
        self.t=tracking;self.db=tracking.db;self.lock=tracking.lock;self.regex=RegexMatcher()
        with self.lock:self.db.execute('CREATE TABLE IF NOT EXISTS tracking_autotag_overrides(tag_id TEXT PRIMARY KEY)');self.db.commit()
    def has_overrides(self):
        with self.lock:return bool(self.db.execute('SELECT 1 FROM tracking_autotag_overrides o JOIN tracking_tags t ON o.tag_id=t.id LIMIT 1').fetchone())

    def configuration(self):
        with self.lock:row=self.db.execute("SELECT value FROM tracking_meta WHERE key='autotag-options'").fetchone()
        return {**OPTIONS,**(json.loads(row[0]) if row else {})}

    def configure(self,value):
        if not isinstance(value,dict) or set(value)-set(OPTIONS):raise PolicyError('自动标签选项无效')
        with self.t.tag_library.transaction():
            result={**self.configuration(),**value}
            if type(result['first_match']) is not bool or type(result['highlight_guessed']) is not bool or result['manual_tags'] not in ['off','override','modify'] or type(result['gap_seconds']) is not int or not 0<=result['gap_seconds']<=3600:raise PolicyError('自动标签选项无效')
            self.db.execute("INSERT INTO tracking_meta VALUES('autotag-options',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(wire(result),))
        return result

    def catalog(self):return {'items':self.t.entities('autotags'),'settings':self.configuration()}

    def save(self,value,ident=None):
        value=validate(value)
        if ident is not None and (not isinstance(ident,str) or not re.fullmatch('[a-f0-9]{32}',ident)):raise PolicyError('自动标签标识无效')
        with self.t.tag_library.transaction():
            if ident and not self.db.execute("SELECT 1 FROM tracking_entities WHERE kind='autotags' AND id=?",(ident,)).fetchone():raise PolicyError('自动标签已更改，请刷新后重试')
            if not ident and self.db.execute("SELECT COUNT(*) FROM tracking_entities WHERE kind='autotags'").fetchone()[0]>=500:raise PolicyError('最多保存 500 个自动标签')
            ident=ident or uuid.uuid4().hex
            self.db.execute("INSERT INTO tracking_entities VALUES('autotags',?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value",(ident,wire(value)))
        return {**value,'id':ident}

    def delete(self,ident):
        if not isinstance(ident,str) or not re.fullmatch('[a-f0-9]{32}',ident):raise PolicyError('自动标签标识无效')
        with self.t.tag_library.transaction():
            if not self.db.execute("DELETE FROM tracking_entities WHERE kind='autotags' AND id=?",(ident,)).rowcount:raise PolicyError('找不到该自动标签')
        return {'ok':True}

    def move(self,ident,direction):
        if type(direction) is not int or direction not in [-1,1]:raise PolicyError('自动标签顺序无效')
        with self.t.tag_library.transaction():
            rules=self.t.entities('autotags');index=next((i for i,v in enumerate(rules) if v['id']==ident),None)
            if index is None:raise PolicyError('找不到该自动标签')
            target=index+direction
            if 0<=target<len(rules):
                rules[index],rules[target]=rules[target],rules[index]
                self.db.execute("DELETE FROM tracking_entities WHERE kind='autotags'")
                self.db.executemany("INSERT INTO tracking_entities VALUES('autotags',?,?)",[(v['id'],wire({k:x for k,x in v.items() if k!='id'})) for v in rules])
        return {'ok':True}

    @staticmethod
    def _expand(template,row,captures):
        fields={**row,'group':row.get('group_name',''),**{str(i):value or '' for i,value in enumerate(captures or [])}}
        return VARIABLE.sub(lambda v:str(fields.get(v[1],'')),template)

    def _matches(self,value,records):
        rows=[r for r in records if r['timeline']==value['timeline']]
        if value['operator']=='regex':
            matched=self.regex.match(value['value'],[str(r.get(value['field'],'')) for r in rows])
            return [(r,[r['start'],r['end']],matched[str(r.get(value['field'],''))]) for r in rows if matched[str(r.get(value['field'],''))] is not None]
        return [(r,[r['start'],r['end']],[]) for r in rows if matches(r,value)]

    def _rule(self,rule,records):
        conditions=rule['conditions'];positives=[v for v in conditions if not v['exclude']]
        try:results=[self._matches(v,records) for v in positives];exclusions=[self._matches(v,records) for v in conditions if v['exclude']]
        except PolicyError as error:return [],[{'rule_id':rule['id'],'message':str(error)}]
        allowed=None
        if rule['match']=='all':
            allowed=intervals([span for _,span,_ in results[0]])
            for rows in results[1:]:allowed=intersect(allowed,[span for _,span,_ in rows])
        excluded=intervals([span for rows in exclusions for _,span,_ in rows])
        # A regex is the dynamic source for AND, so its path/title and captures
        # stay together. Otherwise use the first inclusion; OR uses each match.
        anchor=next((i for i,v in enumerate(positives) if v['operator']=='regex'),0)
        anchors=results[anchor] if allowed is not None else [r for rows in results for r in rows]
        result=[];errors=[]
        for row,span,captures in anchors:
            spans=subtract(intersect([span],allowed) if allowed is not None else [span],excluded)
            if not spans:continue
            try:names=parts([self._expand(v,row,captures) for v in rule['tags']]+([row.get('group_name','')] if rule.get('append_data') else []))
            except PolicyError as error:
                errors.append({'rule_id':rule['id'],'activity_id':row['id'],'message':str(error)});continue
            notes=self._expand(rule['notes'],row,captures)
            if len(notes)>10000:
                errors.append({'rule_id':rule['id'],'activity_id':row['id'],'message':'动态备注超过 10000 字'});continue
            for a,b in spans:result.append({'start':a,'end':b,'tags':names,'notes':notes,'billable':rule['billable'],
                'color':rule['color'] or generated_color(names[0]),'rule_ids':[rule['id']],'rule_names':[rule['name']],'origin_tag_ids':[],'inferred':''})
        return result,errors

    @staticmethod
    def _merge(rows):
        groups={}
        for row in rows:
            key=wire({k:v for k,v in row.items() if k not in ['start','end','rule_ids','rule_names','origin_tag_ids']});groups.setdefault(key,[]).append(row)
        output=[]
        for key,values in groups.items():
            events={}
            for i,row in enumerate(values):
                events.setdefault(row['start'],[]).append((True,i));events.setdefault(row['end'],[]).append((False,i))
            active=set();previous=None;last=None
            for at,changes in sorted(events.items()):
                if active and previous is not None and at>previous:
                    # Identical outputs are one tag, even if several rules
                    # matched. Preserve the exact contributing rules per span.
                    row={**json.loads(key),'rule_ids':list(dict.fromkeys(v for i in sorted(active) for v in values[i]['rule_ids'])),
                        'rule_names':list(dict.fromkeys(v for i in sorted(active) for v in values[i]['rule_names'])),
                        'origin_tag_ids':list(dict.fromkeys(v for i in sorted(active) for v in values[i].get('origin_tag_ids',[]))),'start':previous,'end':at}
                    if last and last['end']==previous and all(last[k]==v for k,v in row.items() if k not in ['start','end']):last['end']=at
                    else:output.append(row);last=row
                else:last=None
                for start,i in changes:
                    if start:active.add(i)
                    else:active.discard(i)
                previous=at
        return output

    @staticmethod
    def _days(a,b):
        while a<b:
            end=min(b,day_bounds(dt.datetime.fromtimestamp(a).date().isoformat())[1])
            yield a,end
            a=end

    @staticmethod
    def _barriers(records):
        return intervals([[r['start'],r['end']] for r in records if r['timeline']=='computer' and r['group_name'] in ['Away','Locked','Sleep','Power off']])

    def _infer(self,a,b,base,barriers,reason,targets=None,rule=None):
        """Assign only the requested observed span to its nearest hard anchors.

        Never infer across a known away/power interval or local midnight. When
        neighbors differ, the midpoint between their boundaries divides time.
        Guessed rows remain separate so the UI can identify every guessed part.
        """
        output=[]
        for start,end in self._days(a,b):
            date=dt.datetime.fromtimestamp(start).date()
            allowed=[r for r in base if not targets or set(targets).intersection(r['rule_ids'])]
            left=[r for r in allowed if r['end']<=start and dt.datetime.fromtimestamp(r['end']-.000001).date()==date and not intersect([[r['end'],end]],barriers)]
            right=[r for r in allowed if r['start']>=end and dt.datetime.fromtimestamp(r['start']).date()==date and not intersect([[start,r['start']]],barriers)]
            before=max(left,key=lambda r:r['end'],default=None);after=min(right,key=lambda r:r['start'],default=None)
            split=(before['end']+after['start'])/2 if before and after else end if before else start
            for neighbor,x,y in [(before,start,min(end,split)),(after,max(start,split),end)]:
                if neighbor is None or y<=x:continue
                row={**neighbor,'start':x,'end':y,'inferred':reason}
                if rule:
                    row['rule_ids']=list(dict.fromkeys(row['rule_ids']+[rule['id']]))
                    row['rule_names']=list(dict.fromkeys(row['rule_names']+[rule['name']]))
                output.append(row)
        return output

    def _absorb(self,base,calculated,barriers):
        occupied=intervals([[r['start'],r['end']] for r in base]);inferred=[]
        for rule,rows in calculated:
            if rule['mode']!='absorb':continue
            for row in rows:
                for a,b in subtract([[row['start'],row['end']]],occupied+barriers):
                    additions=self._infer(a,b,base,barriers,'absorbed',rule['targets'],rule)
                    inferred+=additions;occupied=intervals(occupied+[[r['start'],r['end']] for r in additions])
        return base+inferred

    def _fill(self,rows,barriers,threshold):
        if not threshold:return rows
        occupied=intervals([[r['start'],r['end']] for r in rows]);guesses=[]
        for (_,a),(b,_) in zip(occupied,occupied[1:]):
            if b-a>=threshold or intersect([[a,b]],barriers):continue
            # Requiring both boundaries avoids inventing activity outside the
            # observed day or extending an isolated last task indefinitely.
            if dt.datetime.fromtimestamp(a-.000001).date()!=dt.datetime.fromtimestamp(b).date():continue
            guesses+=self._infer(a,b,rows,barriers,'gap')
        return rows+guesses

    def evaluate(self,since,until,records=None,rules=None,options=None,include_overrides=True):
        since,until=bounds(since,until)
        with self.lock:
            rules=self.t.entities('autotags') if rules is None else copy.deepcopy(rules);options=self.configuration() if options is None else {**OPTIONS,**options}
            override_ids={r[0] for r in self.db.execute('SELECT tag_id FROM tracking_autotag_overrides')} if include_overrides else set()
            if not rules and options['manual_tags']=='off' and not override_ids:return {'items':[],'errors':[]}
            records=self.t.activities(since,until,_derived=False) if records is None else records
            tags=self.t.tags(since,until) if options['manual_tags']!='off' or override_ids else []
            manual=tags if options['manual_tags']!='off' else [];forced=[r for r in tags if r['id'] in override_ids]
        return self._calculate(since,until,records,rules,options,manual,forced)

    def _calculate(self,since,until,records,rules,options,manual,forced):
        # Regex workers run after releasing the tracking DB lock. A statistics
        # query cannot hold up foreground recording or clock checkpoints.
        calculated=[];errors=[]
        for rule in rules:
            if not rule['enabled']:continue
            rows,messages=self._rule(rule,records);calculated.append((rule,self._merge(rows)));errors+=messages
        base=[];occupied=[]
        for rule,rows in calculated:
            if rule['mode']!='tag':continue
            if options['first_match']:
                rows=[{**r,'start':a,'end':b} for r in rows for a,b in subtract([[r['start'],r['end']]],occupied)]
            base+=rows;occupied=intervals(occupied+[[r['start'],r['end']] for r in rows])
        copied=[]
        if options['manual_tags']!='off':
            copied=[{k:r[k] for k in ['start','end','tags','notes','billable','color']}|{'rule_ids':[],'rule_names':['普通标签'],'origin_tag_ids':[r['id']],'inferred':''} for r in manual]
            coverage=[[r['start'],r['end']] for r in copied]
            base=[{**r,'start':a,'end':b} for r in base for a,b in subtract([[r['start'],r['end']]],coverage)]
            if options['manual_tags']=='modify':base+=copied;copied=[]
        forced=[{k:r[k] for k in ['start','end','tags','notes','billable','color']}|{'rule_ids':[],'rule_names':['手动改标'],'origin_tag_ids':[r['id']],'inferred':''} for r in forced]
        forced_ranges=[[r['start'],r['end']] for r in forced]
        base=[{**r,'start':a,'end':b} for r in base for a,b in subtract([[r['start'],r['end']]],forced_ranges)]
        copied=[{**r,'start':a,'end':b} for r in copied for a,b in subtract([[r['start'],r['end']]],forced_ranges)]
        base=self._merge(base)
        barriers=self._barriers(records)
        # Protected manual copies participate in occupancy, but are not
        # themselves modified by absorption, append or prepend.
        absorbed=self._absorb(base+copied+forced,calculated,barriers)
        base+=absorbed[len(base)+len(copied)+len(forced):]
        for rule,modifiers in calculated:
            if rule['mode'] not in ['append','prepend']:continue
            changed=[]
            for row in base:
                pieces=[row]
                for modifier in modifiers:
                    next_pieces=[]
                    for piece in pieces:
                        spans=intersect([[piece['start'],piece['end']]],[[modifier['start'],modifier['end']]])
                        if not spans or rule['targets'] and not set(rule['targets']).intersection(piece['rule_ids']):next_pieces.append(piece);continue
                        next_pieces.extend({**piece,'start':a,'end':b} for a,b in subtract([[piece['start'],piece['end']]],spans))
                        for a,b in spans:
                            tags=modifier['tags']+piece['tags'] if rule['mode']=='prepend' else piece['tags']+modifier['tags']
                            notes='\n'.join(v for v in [piece['notes'],modifier['notes']] if v)
                            if len(tags)>30 or len(notes)>10000:
                                errors.append({'rule_id':rule['id'],'message':'追加后的标签超过 30 级或备注超过 10000 字'});next_pieces.append({**piece,'start':a,'end':b});continue
                            next_pieces.append({**piece,'start':a,'end':b,'tags':tags,'rule_ids':list(dict.fromkeys(piece['rule_ids']+modifier['rule_ids'])),
                                'rule_names':list(dict.fromkeys(piece['rule_names']+modifier['rule_names'])),
                                'notes':notes})
                    pieces=next_pieces
                changed+=pieces
            base=changed
        rows=self._merge(self._fill(base+copied+forced,barriers,options['gap_seconds']));items=[]
        for row in sorted(rows,key=lambda r:(r['start'],r['end'],r['tags'])):
            key=hashlib.sha256(wire(row).encode()).hexdigest()
            items.append({**row,'id':'auto-'+key,'timeline':'autotags','title':', '.join(row['tags']),'group_name':', '.join(row['tags']),
                'source':'autotag','seconds':row['end']-row['start'],'original_start':row['start'],'original_end':row['end'],
                'metadata':{'rule_ids':row['rule_ids'],'rules':row['rule_names'],'inferred':row['inferred']},
                'highlighted':bool(row['inferred'] and options['highlight_guessed']),'application':'','bundle':''})
        return {'items':items,'errors':errors}

    def preview(self,value,since,until):
        rule={**validate(value),'id':'preview'}
        result=self.evaluate(since,until,rules=[rule],options=OPTIONS,include_overrides=False)
        # Modifiers also need to be testable before any base tag exists.
        if rule['mode']!='tag':
            rows,errors=self._rule(rule,self.t.activities(since,until,_derived=False))
            result={'items':self._merge(rows),'errors':errors}
        result['seconds']=seconds([[v['start'],v['end']] for v in result['items']]);return result

    def convert(self,since,until,selection=None,mode='untagged'):
        since,until=bounds(since,until)
        if mode not in ['double','untagged','overwrite']:raise PolicyError('重叠处理方式无效')
        if selection is None:selection=[[since,until]]
        if not isinstance(selection,list) or not selection or len(selection)>1000 or any(not isinstance(v,list) or len(v)!=2 for v in selection):raise PolicyError('时间选择无效')
        selected=intersect([bounds(*v) for v in selection],[[since,until]])
        ids=[]
        with self.t.tag_library.transaction():
            result=self.evaluate(since,until)
            if result['errors']:raise PolicyError('部分动态标签无效，请先检查规则预览')
            existing=self.t.tags(since,until);occupied=[[r['start'],r['end']] for r in existing]
            rows=[{**r,'start':a,'end':b} for r in result['items'] for a,b in intersect([[r['start'],r['end']]],selected)]
            if mode=='untagged':rows=[{**r,'start':a,'end':b} for r in rows for a,b in subtract([[r['start'],r['end']]],occupied)]
            if mode=='overwrite':
                coverage=intervals([[r['start'],r['end']] for r in rows])
                self.t.tag_library.cut_ranges(coverage)
            for row in rows:
                self.t.tag_library.register(row['tags']);ident=uuid.uuid4().hex;ids.append(ident)
                self.db.execute('INSERT INTO tracking_tags VALUES(?,?,?,?,?,?,?,?)',(ident,row['start'],row['end'],wire(row['tags']),row['notes'],int(row['billable']),row['color'],'autotag-copy'))
        return {'ids':ids,'count':len(ids),'seconds':seconds([[r['start'],r['end']] for r in rows])}
