"""Compact display runs without changing raw measurements or their precision."""
import json
from collections import defaultdict


def display_runs(records):
    timelines=defaultdict(list)
    for row in records:timelines[row['timeline']].append(row)
    result=[]
    for rows in timelines.values():
        previous=None;identity=None
        for row in sorted(rows,key=lambda r:(r['start'],r['end'],r['id'])):
            key=tuple(row.get(k,'') for k in ['title','group_name','application','bundle','path','url','document','color'])
            metadata=row.get('metadata',{})
            key+=(json.dumps(metadata,sort_keys=True,ensure_ascii=False),)
            if row.get('source')=='legacy' and previous is not None and previous.get('source')=='legacy' and key==identity and previous['end']<=row['start']+1e-6 and row['start']<=previous['end']+1e-6:
                previous['end']=row['end'];previous['original_end']=row.get('original_end',row['end']);previous['seconds']=previous['end']-previous['start'];previous['sample_count']+=1
            else:
                previous={**row,'sample_count':1};result.append(previous);identity=key
    return sorted(result,key=lambda r:(r['start'],r['end'],r['id']))
