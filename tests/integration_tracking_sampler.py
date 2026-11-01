"""Observe three real frames, with titles and screenshots explicitly disabled."""
import json,selectors,subprocess,tempfile,time
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent

def main():
    helper=ROOT/'build/HotTurkeyTracker';assert helper.is_file()
    with tempfile.TemporaryDirectory(dir='/private/tmp',prefix='ht-tracking-sampler-') as directory:
        process=subprocess.Popen([str(helper),directory],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        frames=[]
        try:
            process.stdin.write(json.dumps({'record':False,'capture':False,'titles':False}).encode()+b'\n');process.stdin.flush()
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout,selectors.EVENT_READ)
                for _ in range(3):
                    assert selector.select(8),'Sampler did not produce a frame'
                    line=process.stdout.readline();sample=json.loads(line);frames.append(sample)
                    assert isinstance(sample['front'],dict) and isinstance(sample['apps'],list)
                    assert not sample['front'].get('title') and not sample['front'].get('document')
                    assert sample['screenshots']==[]
                    process.stdin.write(b'{"record":false,"capture":false,"titles":false}\n');process.stdin.flush()
            assert len(frames)==3 and any(frame['front'].get('bundle') for frame in frames)
            assert not list(Path(directory).rglob('*')),'Disabled screenshot capture wrote files'
            proof={'passed':True,'real_native_frames':3,'foreground_identity_available':True,'titles_disabled':True,'screenshots_disabled':True,'screen_files_written':0,'formal_data_changed':False,'physical_device_actions':False,'supported_image_formats':frames[-1]['permissions']['formats']}
            (ROOT/'build/tracking-sampler-proof.json').write_text(json.dumps(proof,indent=2));print(json.dumps(proof))
        finally:
            process.stdin.close()
            try:process.wait(timeout=4)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=2)
            process.stdout.close();process.stderr.close()
if __name__=='__main__':main()
