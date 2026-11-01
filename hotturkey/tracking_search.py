"""Local activity query grammar shared by day views, reports and timesheets."""
import datetime as dt
import math
import re
import time
from functools import lru_cache
from .model import PolicyError
from .tracking_regex import RegexMatcher,validate as validate_regex

ALIASES={'app':'application','application':'application','title':'title','group':'group_name','url':'url',
 'file':'document','document':'document','source':'source','tag':'title','note':'notes','notes':'notes',
 'git-repository':'repository','git-branch':'branch','workplace':'workplace','desktop':'desktop',
 'duration':'seconds','start':'start','end':'end','label':'billable'}
REGEX=RegexMatcher()
QUERY_SECONDS=5


def fail(message):raise PolicyError('筛选条件无效：'+message)


def tokenize(query):
    tokens=[];i=0
    while i<len(query):
        if query[i].isspace():i+=1;continue
        if query[i] in '()-':tokens.append((query[i],));i+=1;continue
        text='';quoted=False;pattern=None
        while i<len(query) and not query[i].isspace() and query[i] not in '()':
            regex=query[i:i+2]=='#"'
            if query[i] not in '\"\'' and not regex:text+=query[i];i+=1;continue
            quote='"' if regex else query[i];i+=2 if regex else 1;value='';quoted=True
            while i<len(query) and query[i]!=quote:
                if query[i]=='\\' and i+1<len(query) and query[i+1] in [quote,'\\']:
                    value+=query[i:i+2] if regex or query[i+1]=='\\' else quote;i+=2
                else:value+=query[i];i+=1
            if i>=len(query):fail('引号不完整')
            i+=1
            if regex:
                if pattern is not None:fail('请用 AND 或 OR 分隔正则表达式')
                pattern=value
                if i<len(query) and not query[i].isspace() and query[i]!=')':fail('正则表达式后需要空格或右括号')
            else:text+=value
        if not text and pattern is None and not quoted:fail('缺少搜索内容')
        operator=text.casefold() if not quoted and pattern is None else ''
        tokens.append((operator,) if operator in ['or','and'] else ('term',text,pattern))
        if len(tokens)>256:fail('条件过多，请分成几次查询')
    if len(tokens)>256:fail('条件过多，请分成几次查询')
    return tokens


def duration(value):
    value=value.casefold()
    if re.fullmatch(r'\d+(?:\.\d+)?',value):
        number=float(value)
        if not math.isfinite(number):fail('时长过大')
        return number
    matches=list(re.finditer(r'(\d+(?:\.\d+)?)(h|m|s)',value));order={'h':0,'m':1,'s':2}
    if not matches or ''.join(m.group() for m in matches)!=value or any(order[a[2]]>=order[b[2]] for a,b in zip(matches,matches[1:])):fail('时长示例为 1h、10m 或 1m10s')
    result=sum(float(m[1])*{'h':3600,'m':60,'s':1}[m[2]] for m in matches)
    if not math.isfinite(result):fail('时长过大')
    return result


def wall_time(value):
    match=re.fullmatch(r'(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*(AM|PM)?',value,re.I)
    if not match:fail('时间示例为 22:00 或 10:00PM')
    h,m,s=int(match[1]),int(match[2]),float(match[3] or 0);suffix=(match[4] or '').upper()
    if m>=60 or s>=60 or suffix and not 1<=h<=12 or not suffix and (h>24 or h==24 and (m or s)):fail('时间超出有效范围')
    if suffix:h=h%12+(12 if suffix=='PM' else 0)
    return h*3600+m*60+s


def clock_value(row,field):
    value=row.get(field)
    if not isinstance(value,(int,float)) or isinstance(value,bool) or not math.isfinite(value):return None
    try:local=dt.datetime.fromtimestamp(value)
    except (OSError,OverflowError,ValueError):return None
    result=local.hour*3600+local.minute*60+local.second+local.microsecond/1e6
    if field=='end' and result==0 and isinstance(row.get('start'),(int,float)):
        try:
            if dt.datetime.fromtimestamp(row['start']).date()<local.date():return 86400
        except (OSError,OverflowError,ValueError):pass
    return result


def field_text(row,field):
    if field=='default':
        title=row.get('title','')
        if row.get('timeline')=='documents':title=' '.join(str(row.get(k,'')) for k in ['url','document','title'])
        return str(title)+(' '+str(row.get('notes','')) if row.get('timeline') in ['tags','autotags'] else '')
    metadata=row.get('metadata',{})
    return str(row.get(field,metadata.get(field,'') if isinstance(metadata,dict) else '') or '')


def predicate(text,pattern):
    found=re.fullmatch(r'([A-Za-z][\w-]*)(:|!=|>=|<=|=|>|<)(.*)',text,re.S)
    field='default';op=':';value=text
    if found and found[1].casefold() in ALIASES:field=ALIASES[found[1].casefold()];op=found[2];value=found[3]
    elif found and found[2]!=':':fail('未知字段 '+found[1])
    if pattern is not None and value:fail('正则表达式前只能添加字段名')
    if pattern is None and not value:fail('字段后需要搜索内容')
    if field in ['seconds','start','end']:
        if pattern is not None or op==':':fail('时长和时间需要 >、<、>=、<= 或 =')
        number=duration(value) if field=='seconds' else wall_time(value)
        return ('number',field,op,number)
    if op not in [':','=','!=']:fail('文字字段仅支持 :、= 或 !=')
    if field=='billable':
        if pattern is not None or value.casefold()!='billable':fail('标签属性仅支持 label=billable')
        return ('billable',op!='!=')
    if pattern is None and any(c in value for c in '*?'):
        pattern=''.join(r'\S*' if c=='*' else r'\S' if c=='?' else re.escape(c) for c in value)
    if pattern is not None:
        if op in ['=','!=']:pattern=r'\A(?:'+pattern+r')\Z'
        validate_regex(pattern);return ('regex',field,op,pattern)
    return ('text',field,op,value.casefold())


class Parser:
    def __init__(self,tokens):self.tokens=tokens;self.at=0
    def kind(self):return self.tokens[self.at][0] if self.at<len(self.tokens) else ''
    def parse(self,depth=0):
        if depth>24:fail('括号或排除嵌套过深')
        branches=[self.conjunction(depth)]
        while self.kind()=='or':self.at+=1;branches.append(self.conjunction(depth))
        return branches[0] if len(branches)==1 else ('or',branches)
    def conjunction(self,depth):
        parts=[self.primary(depth)]
        while self.kind() and self.kind() not in [')','or']:
            if self.kind()=='and':self.at+=1
            parts.append(self.primary(depth))
        return parts[0] if len(parts)==1 else ('and',parts)
    def primary(self,depth):
        if depth>24:fail('括号或排除嵌套过深')
        kind=self.kind()
        if kind=='-':self.at+=1;return ('not',self.primary(depth+1))
        if kind=='(':
            self.at+=1;node=self.parse(depth+1)
            if self.kind()!=')':fail('缺少右括号')
            self.at+=1;return node
        if kind!='term':fail('条件之间缺少搜索内容')
        token=self.tokens[self.at];self.at+=1;return predicate(token[1],token[2])


class Query:
    def __init__(self,query):
        self.patterns=[]
        if not query.strip():self.node=('all',);return
        parser=Parser(tokenize(query));self.node=parser.parse()
        if parser.kind():fail('多余的右括号')
        def visit(node):
            if node[0] in ['or','and']:
                for child in node[1]:visit(child)
            elif node[0]=='not':visit(node[1])
            elif node[0]=='regex':self.patterns.append((node[3],node[1]))
        visit(self.node);self.patterns=list(dict.fromkeys(self.patterns))
        if len(self.patterns)>16:fail('每次最多使用 16 个正则或通配符条件')
    def matches(self,row,results=None,deadline=None):
        def evaluate(node):
            kind=node[0]
            if kind=='all':return True
            if kind=='or':return any(evaluate(child) for child in node[1])
            if kind=='and':return all(evaluate(child) for child in node[1])
            if kind=='not':return not evaluate(node[1])
            if kind=='billable':return bool(row.get('billable'))==node[1]
            _,field,op,wanted=node
            if kind=='number':
                actual=clock_value(row,field) if field in ['start','end'] else row.get('seconds')
                if not isinstance(actual,(int,float)) or isinstance(actual,bool) or not math.isfinite(actual):return False
                return {'>':lambda:actual>wanted,'<':lambda:actual<wanted,'>=':lambda:actual>=wanted,'<=':lambda:actual<=wanted,'=':lambda:actual==wanted,'!=':lambda:actual!=wanted}[op]()
            text=field_text(row,field)
            if kind=='regex':
                match=results[(wanted,text)] if results is not None else REGEX.match(wanted,[text],deadline=deadline)[text] is not None
            else:match=text.casefold()==wanted if op in ['=','!='] else wanted in text.casefold()
            return not match if op=='!=' else match
        return evaluate(self.node)
    def filter(self,rows):
        if not self.patterns:return [row for row in rows if self.matches(row)]
        deadline=time.monotonic()+QUERY_SECONDS;results={}
        for pattern,field in self.patterns:
            values=list(dict.fromkeys(field_text(row,field) for row in rows))
            matches=REGEX.match(pattern,values,deadline=deadline)
            results.update({(pattern,value):groups is not None for value,groups in matches.items()})
        return [row for row in rows if self.matches(row,results)]


@lru_cache(maxsize=128)
def cached_query(query):return Query(query)


def compile_query(query):
    if not isinstance(query,str) or len(query)>4096:fail('搜索文字过长')
    return cached_query(query)


def filter_records(rows,query):return compile_query(query).filter(rows)
