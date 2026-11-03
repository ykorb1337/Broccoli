"""Local, approximate storage budgets. No pixels or file paths leave the service."""
from .model import PolicyError
import math
import subprocess
import tempfile
from pathlib import Path


def estimate(tracking,status):
    settings=tracking.settings()
    with tracking.lock:
        rows=tracking.db.execute('SELECT * FROM tracking_screenshots ORDER BY at DESC LIMIT 12').fetchall()
    sample=None
    for row in rows:
        try:
            path=tracking.screenshot_path(row['file'],row['storage_id'])
            sample=(row,path);break
        except (OSError,ValueError,PolicyError):continue
    displays=[v for v in status.get('displays',[]) if isinstance(v,dict) and all(type(v.get(k)) is int and 1<=v[k]<=16384 for k in ['width','height'])][:12]
    if settings['screenshot_displays']=='main' and displays:
        displays=[next((v for v in displays if v.get('main')),displays[0])]
    if not displays:
        dimensions={r['display']:{'width':r['width'],'height':r['height']} for r in reversed(rows)}
        displays=list(dimensions.values())[:12] or [{'width':1920,'height':1080}]
        if settings['screenshot_displays']=='main':displays=displays[:1]
    ratios={'original':1.0,'high':.22,'standard':.15};basis='resolution'
    if sample:
        row,path=sample;key=(row['id'],settings['screenshot_format'])
        cached=getattr(tracking,'_screenshot_estimate_cache',None)
        if cached and cached[0]==key:
            ratios=cached[1];basis=cached[2]
        else:
            measured={}
            # Measure three encodings of one recent local image. This is a
            # sample estimate, not a promise about future screen content.
            with tempfile.TemporaryDirectory(prefix='hotturkey-image-budget-') as tmp:
                for quality,width,compression in [('original',0,'100'),('high',2560,'90'),('standard',1600,'80')]:
                    fmt='png' if quality=='original' else settings['screenshot_format']
                    output=Path(tmp)/(quality+'.'+fmt)
                    command=['/usr/bin/sips','-s','format',fmt]
                    if fmt!='png':command+=['-s','formatOptions',compression]
                    if width:command+=['-Z',str(min(width,row['width']))]
                    command+=[str(path),'--out',str(output)]
                    try:
                        subprocess.run(command,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=5)
                        factor=min(1,width/row['width']) if width else 1
                        measured[quality]=output.stat().st_size/max(1,row['width']*row['height']*factor*factor)
                    except (OSError,subprocess.SubprocessError):pass
            ratios.update(measured);basis='recent' if measured else 'resolution'
            tracking._screenshot_estimate_cache=(key,dict(ratios),basis)
    interval=settings['screenshot_interval'];frames=math.ceil(86400/interval);items=[]
    for quality,max_width in [('original',0),('high',2560),('standard',1600)]:
        total=0
        for display in displays:
            factor=min(1,max_width/display['width']) if max_width else 1
            total+=max(1024,round(display['width']*display['height']*factor*factor*ratios[quality]))
        items.append({'quality':quality,'image_bytes':round(total/len(displays)),'daily_bytes':total*frames})
    return {'items':items,'interval':interval,'displays':len(displays),'hours':24,'basis':basis,'approximate':True}
